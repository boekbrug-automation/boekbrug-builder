-- migrations: bank_tx_invoices.sql, bank_tx_invoices_read_only_policy.sql, invoice_partial_payments.sql
-- =====================================================================
-- [ALLOCATIE-DEUR] bank_tx_invoices is read-only to a session, and the doors still write.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- The [ALLOCATIE-DEUR] gate in lifecycle-gates.test.ts is STATIC: it proves no application code
-- writes this table with a session client, and that the migration leaves exactly one policy. Static
-- is not enough for a permission — what a role may actually DO is a property of the database, not
-- of the text. So this file tries it, under SET ROLE authenticated, and reads the answer.
--
-- Three halves, and the third is the one that makes the first two mean anything:
--   1. a session INSERT is refused, and a session DELETE is refused;
--   2. the session can still SELECT its own rows — /dashboard/facturen reads this table from the
--      BROWSER with the owner's session, so a closed read would be a regression, not a hardening;
--   3. a real payment door (SECURITY DEFINER) still writes, called BY that same session role.
--      Without this, "nothing can write" would pass on a table nobody can use at all.
--
-- The positive controls are deliberate: every refusal below is paired with something that must
-- still succeed, so a harness that refuses everything (RLS misconfigured, role unbound, table
-- ungranted) fails here rather than reporting a clean gate.
--
-- WHAT THIS FILE DOES NOT COVER, on purpose. It loads the migrations in ONE order — the table's
-- own file, then the read-only policy file — so a write policy re-added to the earlier file is
-- dropped again by the later one and this file stays green. Measured: it does. The apply-ORDER
-- hazard is the static gate's half ("[ALLOCATIE-DEUR] no migration creates the write policies, in
-- any apply order"), which reads every migration in the directory and refuses a CREATE POLICY
-- anywhere. Two halves, neither sufficient alone.

\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
\set U '11111111-1111-1111-1111-111111111111'
\set X '99999999-9999-9999-9999-999999999999'

TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;
INSERT INTO public.profiles (id, role) VALUES (:'U', 'zzper') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.invoices (id, receiver_id, direction, invoice_type, status, total_inc_btw, amount_paid) VALUES
  ('a0000000-0000-0000-0000-00000000c001', :'U', 'incoming', 'factuur', 'received', 500, 0);
INSERT INTO public.bank_transactions (id, user_id, amount, date, status) VALUES
  ('ba000000-0000-0000-0000-00000000c001', :'U', -500, '2026-03-01', 'pending');
-- One row the owner is allowed to READ, written before the role is dropped.
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied) VALUES
  ('11110000-0000-0000-0000-00000000c001', :'U', 'ba000000-0000-0000-0000-00000000c001', 'a0000000-0000-0000-0000-00000000c001', 1);

-- ═══ 0. The policy set this migration leaves behind ══════════════════════════════════════════════
DO $$
DECLARE cmds text;
BEGIN
  SELECT string_agg(polname || ':' || polcmd::text, ', ' ORDER BY polname) INTO cmds
  FROM pg_policy WHERE polrelid = 'public.bank_tx_invoices'::regclass;
  IF cmds IS DISTINCT FROM 'bank_tx_invoices_select_own:r' THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] the policy set is "%", expected exactly bank_tx_invoices_select_own:r', cmds;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_tx_invoices'::regclass) THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] row level security is OFF — every policy below is decoration';
  END IF;
  RAISE NOTICE '  ok · exactly one policy remains, and it is the SELECT one';
END $$;

-- ═══ 1. As a logged-in session: read yes, write no ══════════════════════════════════════════════
SELECT set_config('test.uid', :'U', false);
SET ROLE authenticated;

DO $$
DECLARE n int; failed boolean;
BEGIN
  -- CONTROL FIRST. If this is 0 the harness is broken and every refusal below proves nothing.
  SELECT count(*) INTO n FROM public.bank_tx_invoices;
  IF n <> 1 THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] the owner cannot read their own allocation (% rows) — the read was closed, not the write', n;
  END IF;
  RAISE NOTICE '  ok · the owner still reads their own allocation rows (%)', n;

  -- INSERT: the whole point. A row naming this user, this line and this invoice — everything the
  -- old WITH CHECK asked for — and an amount far past what the line has.
  failed := false;
  BEGIN
    INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'ba000000-0000-0000-0000-00000000c001',
            'a0000000-0000-0000-0000-00000000c001', 99999);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] a session INSERTED an allocation of 99999 on a 500 line — the door is still open';
  END IF;
  RAISE NOTICE '  ok · a direct session INSERT is refused (42501)';

  -- DELETE: the mirror. Removing this row would un-back the line and leave amount_paid standing.
  --
  -- It does NOT raise, and that asymmetry is the database's, not this test's. PostgreSQL enforces
  -- INSERT through WITH CHECK, which errors 42501 on a row it will not accept; it enforces
  -- DELETE (and UPDATE, and SELECT) through USING, which FILTERS. With no DELETE policy the
  -- visible set is empty, so the statement matches nothing and returns success having removed
  -- nothing. The first version of this test asserted a raise and failed here — correctly.
  --
  -- So the assertion is on the OUTCOME, which is what actually matters: zero rows removed, and the
  -- row still there afterwards. A caller that believed its delete worked is a separate problem and
  -- not one any application path has, because no application path deletes with a session client.
  DELETE FROM public.bank_tx_invoices WHERE id = '11110000-0000-0000-0000-00000000c001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] a session DELETED % allocation row(s)', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices WHERE id = '11110000-0000-0000-0000-00000000c001') THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] the allocation row is gone after a session DELETE';
  END IF;
  RAISE NOTICE '  ok · a direct session DELETE removes nothing (filtered by USING, not raised)';

  -- …and nothing moved.
  SELECT count(*) INTO n FROM public.bank_tx_invoices;
  IF n <> 1 THEN RAISE EXCEPTION '[ALLOCATIE-DEUR] the table changed under a refused write (% rows)', n; END IF;
  RAISE NOTICE '  ok · and the table is exactly as it was (% row)', n;
END $$;

-- ═══ 2. The door still writes, called by that same session role ═════════════════════════════════
-- Without this the gate above would also pass on a table nobody can write at all, which is a
-- broken product, not a closed door.
DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM public.apply_bank_payment(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'ba000000-0000-0000-0000-00000000c001'::uuid,
    'a0000000-0000-0000-0000-00000000c001'::uuid,
    500, '2026-03-01'::date);
  IF r.applied IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION '[ALLOCATIE-DEUR] the door did not book: applied=%', r.applied;
  END IF;
  SELECT count(*) INTO n FROM public.bank_tx_invoices
  WHERE transaction_id = 'ba000000-0000-0000-0000-00000000c001'
    AND invoice_id = 'a0000000-0000-0000-0000-00000000c001';
  IF n <> 1 THEN RAISE EXCEPTION '[ALLOCATIE-DEUR] the door wrote % allocation rows', n; END IF;
  RAISE NOTICE '  ok · a SECURITY DEFINER payment door still writes for the same session (applied %)', r.applied;
END $$;

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT '[ALLOCATIE-DEUR] held: a logged-in session may READ its allocations and may not INSERT or DELETE one, while the payment doors still write for that same session' AS result;
