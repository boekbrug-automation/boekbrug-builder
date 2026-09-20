-- migrations: bank_tx_invoices.sql, invoice_partial_payments.sql, allocate_bank_payment.sql, book_bank_batch_atomic.sql, invoice_manual_payments.sql, invoice_manual_payment_idempotency_scope.sql, bank_rpc_never_payable_states.sql, invoice_move_payment_creditnota_guard.sql, invoice_paid_requires_allocation.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [BETAALD-GEDEKT] An invoice enters 'paid' only when an allocation backs it.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- Every refusal below is paired with a door that must still commit. A harness that refuses
-- everything — trigger too broad, fixture unowned, doors absent — fails on the doors first.
--
-- WHY THE OUTCOMES ARE READ FROM STATE AND NOT FROM A CAUGHT EXCEPTION. This is a DEFERRABLE
-- INITIALLY DEFERRED constraint: it is raised at COMMIT, so a plpgsql EXCEPTION handler around the
-- statement never sees it — the handler reports success and the transaction dies afterwards.
-- Measured while writing this file. So each case runs as its own real transaction and the verdict
-- is the state that survived it.
-- =====================================================================

\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
\set U '11111111-1111-1111-1111-111111111111'
\set X '99999999-9999-9999-9999-999999999999'

CREATE TABLE IF NOT EXISTS t_result (label text, got text, want text);
TRUNCATE t_result;

-- The fixture seeds an ALREADY-paid invoice, so it must be one transaction: under this rule a paid
-- row committed before its link exists is exactly what is refused. (This caught the test's own
-- setup the first time — worth stating, because a future author will hit it too.)
CREATE OR REPLACE FUNCTION seed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;
  INSERT INTO public.profiles (id, role) VALUES
    ('11111111-1111-1111-1111-111111111111','zzper'),
    ('99999999-9999-9999-9999-999999999999','zzper') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.invoices (id, receiver_id, direction, invoice_type, status, total_inc_btw, amount_paid) VALUES
    ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','incoming','factuur','received',100,0),
    ('a0000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','incoming','factuur','received',100,0);
  INSERT INTO public.bank_transactions (id,user_id,amount,date,status,invoice_id) VALUES
    ('ba000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111',-100,'2026-03-01','pending',NULL);
END $$;

-- ═══ 1. The shape this migration leaves behind ═══════════════════════════════════════════════
DO $$
DECLARE d boolean; i boolean;
BEGIN
  SELECT tgdeferrable, tginitdeferred INTO d, i FROM pg_trigger
   WHERE tgrelid='public.invoices'::regclass AND tgname='assert_paid_is_backed';
  IF NOT FOUND THEN RAISE EXCEPTION '[BETAALD-GEDEKT] the trigger is not installed'; END IF;
  IF NOT d OR NOT i THEN
    RAISE EXCEPTION '[BETAALD-GEDEKT] the trigger is not DEFERRABLE INITIALLY DEFERRED (%/%) — an immediate check refuses apply_bank_payment, which writes the invoice before its allocation', d, i;
  END IF;
  RAISE NOTICE '  ok · constraint trigger installed, DEFERRABLE INITIALLY DEFERRED';
END $$;

-- ═══ 2. Every legitimate door still commits ══════════════════════════════════════════════════
SELECT seed();
SELECT set_config('test.uid', :'U', false);
BEGIN;
  SELECT public.confirm_bank_payment(:'U','ba000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000a1','2026-03-01'::date);
COMMIT;
INSERT INTO t_result VALUES ('confirm_bank_payment',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

SELECT seed();
BEGIN;
  SELECT public.apply_bank_payment(:'U','ba000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000a1',100,'2026-03-01'::date);
COMMIT;
INSERT INTO t_result VALUES ('apply_bank_payment',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

SELECT seed();
BEGIN;
  SELECT public.allocate_bank_payment(:'U','ba000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000a1',100,'2026-03-01'::date);
COMMIT;
INSERT INTO t_result VALUES ('allocate_bank_payment',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

SELECT seed();
BEGIN;
  SELECT public.book_bank_batch(:'U','ba000000-0000-0000-0000-0000000000c1',ARRAY['a0000000-0000-0000-0000-0000000000a1']::uuid[],'2026-03-01'::date);
COMMIT;
INSERT INTO t_result VALUES ('book_bank_batch',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

SELECT seed();
BEGIN;
  SELECT public.apply_manual_payment(:'U','a0000000-0000-0000-0000-0000000000a1',100,'2026-03-01'::date,'kas',ARRAY['received','sent']::text[],gen_random_uuid());
COMMIT;
INSERT INTO t_result VALUES ('apply_manual_payment',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

-- move: A is paid and linked, the payment moves to B, B becomes paid inside that transaction.
SELECT seed();
BEGIN;
  SELECT public.apply_bank_payment(:'U','ba000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000a1',100,'2026-03-01'::date);
COMMIT;
BEGIN;
  SELECT public.move_invoice_payment(:'U',
    (SELECT id FROM public.bank_tx_invoices WHERE invoice_id='a0000000-0000-0000-0000-0000000000a1'),
    'a0000000-0000-0000-0000-0000000000b1');
COMMIT;
INSERT INTO t_result VALUES ('move_invoice_payment',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000b1'), 'paid');

-- ═══ 3. The compensating rollback shape: restore paid while the link still exists ════════════
SELECT seed();
BEGIN;
  SELECT public.apply_bank_payment(:'U','ba000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000a1',100,'2026-03-01'::date);
COMMIT;
UPDATE public.invoices SET status='received' WHERE id='a0000000-0000-0000-0000-0000000000a1';
UPDATE public.invoices SET status='paid'     WHERE id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO t_result VALUES ('rollback restores paid',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'paid');

-- ═══ 4. The scope stays narrow ═══════════════════════════════════════════════════════════════
DELETE FROM public.bank_tx_invoices;   -- the rule WOULD fail now if it fired
UPDATE public.invoices SET payment_reference='gewijzigd' WHERE id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO t_result VALUES ('unrelated column on a paid invoice',
  (SELECT payment_reference FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'gewijzigd');
UPDATE public.invoices SET status='received' WHERE id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO t_result VALUES ('leaving paid',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'received');

-- ═══ 5. The refusals ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
SELECT seed();
UPDATE public.invoices SET status='paid', amount_paid=100 WHERE id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO t_result VALUES ('forged: paid with no allocation',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'received');

-- Another tenant's allocation may not vouch for this invoice. The link must be a REAL one, or
-- this case passes for the wrong reason: a rejected insert leaves ZERO allocations, and the rule
-- then refuses on "none at all" while never testing the tenant predicate. Measured: the first
-- version of this case did exactly that — bank_tx_invoices_origin_check rejected a row with a
-- NULL transaction_id and no paid_on. So X gets a bank line of their own and a valid link.
\set ON_ERROR_STOP on
SELECT seed();
INSERT INTO public.bank_transactions (id,user_id,amount,date,status,invoice_id)
VALUES ('ba000000-0000-0000-0000-0000000000d1', :'X', -100, '2026-03-01', 'pending', NULL);
INSERT INTO public.bank_tx_invoices (user_id,transaction_id,invoice_id,amount_applied)
VALUES (:'X', 'ba000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000a1', 100);
-- the link really is there, and really belongs to the other tenant
INSERT INTO t_result VALUES ('the other tenant''s link exists',
  (SELECT count(*)::text FROM public.bank_tx_invoices l
    WHERE l.invoice_id='a0000000-0000-0000-0000-0000000000a1' AND l.user_id = :'X'), '1');
\set ON_ERROR_STOP off
UPDATE public.invoices SET status='paid' WHERE id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO t_result VALUES ('another tenant''s allocation does not back it',
  (SELECT status FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000a1'), 'received');
\set ON_ERROR_STOP on

-- ═══ 6. Verdict ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN SELECT * FROM t_result LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      RAISE WARNING 'FAIL · % — got %, expected %', r.label, coalesce(r.got,'<null>'), r.want;
      bad := bad + 1;
    ELSE
      RAISE NOTICE '  ok · % (%)', r.label, r.got;
    END IF;
  END LOOP;
  IF bad > 0 THEN RAISE EXCEPTION '[BETAALD-GEDEKT] % case(s) failed', bad; END IF;
END $$;

DROP FUNCTION seed();
DROP TABLE t_result;
SELECT '[BETAALD-GEDEKT] held: all six paid-producing doors and the compensating rollback still commit, an unrelated column and leaving paid do not fire the rule, and a paid state with no tenant-valid allocation is refused at COMMIT' AS result;
