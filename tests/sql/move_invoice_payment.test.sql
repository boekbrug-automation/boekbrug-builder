-- migrations: invoice_move_payment.sql, invoice_move_payment_creditnota_guard.sql
-- =====================================================================
-- [MOVE-PAYMENT] move_invoice_payment, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- The most intricate of the four money RPCs, and the only one that shipped with NO seam test. It
-- moves ONE booked payment (a bank_tx_invoices row) from one invoice to another and RE-DERIVES both
-- amount_paid values from the surviving links — not add-and-subtract, derive, so it cannot introduce
-- drift. This file holds that promise, and the refusals that keep money from going somewhere the
-- owner never sent it.
--
-- Two lessons this file's own negative controls taught, written in so they are not re-learned:
--   · every amount/date/status compare uses IS DISTINCT FROM, never <>. A payment_date that fails
--     to re-derive comes back NULL, and `NULL <> date` is NULL, not true — so a plain <> check
--     passes on exactly the bug it was meant to catch.
--   · to test a RE-DERIVE you must first create DRIFT: a stored amount_paid that disagrees with the
--     sum of the links. On a clean invoice add-and-subtract and re-derive give the same number, so a
--     clean move proves nothing about which one the code does. The target below is seeded WRONG on
--     purpose, and the move must correct it.
--   · a refusal case must not be masked by an EARLIER guard. The "does not fit" target is payable
--     with partial room, so the fit check is the only thing that can refuse it.
--
-- auth.uid() is stubbed NULL (the service-role path); the caller guard is pinned by p_user_id.

\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
\set U '11111111-1111-1111-1111-111111111111'
\set X '99999999-9999-9999-9999-999999999999'

-- ═══ 1. RE-DERIVE corrects drift on BOTH sides, and re-derives the source date ═══════════════════
-- Source S: total 300, links are the movable 100 (bank, May) + a 50 instalment (kas, April) that
--   stays. Its STORED amount_paid is seeded to 999 — a lie the re-derive must overwrite with 50.
-- Target T: total 500, one 200 link. STORED amount_paid seeded to 0 — also a lie; after the move it
--   must read 300 (200 + moved 100), which add-and-subtract on the stored 0 would get wrong (100).
TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;

INSERT INTO public.invoices (id, sender_id, direction, status, total_inc_btw, amount_paid, payment_date) VALUES
  ('50000000-0000-0000-0000-000000000000', :'U', 'outgoing', 'paid', 300, 999, '2026-05-10'),  -- stored WRONG on purpose
  ('70000000-0000-0000-0000-000000000000', :'U', 'outgoing', 'sent', 500,   0, NULL);           -- stored WRONG on purpose
INSERT INTO public.bank_transactions (id, user_id, amount, date, status) VALUES
  ('ba000000-0000-0000-0000-000000000000', :'U', 100, '2026-05-10', 'matched');
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied, paid_on, method, created_at) VALUES
  ('11110000-0000-0000-0000-000000000000', :'U', 'ba000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000000', 100, '2026-05-10', 'bank', '2026-05-10'),
  ('11120000-0000-0000-0000-000000000000', :'U', NULL, '50000000-0000-0000-0000-000000000000', 50, '2026-04-01', 'kas', '2026-04-01'),
  ('22220000-0000-0000-0000-000000000000', :'U', NULL, '70000000-0000-0000-0000-000000000000', 200, '2026-03-01', 'kas', '2026-03-01');

SELECT set_config('test.uid', '', false);
SELECT * FROM public.move_invoice_payment(:'U'::uuid, '11110000-0000-0000-0000-000000000000'::uuid, '70000000-0000-0000-0000-000000000000'::uuid);

DO $$
DECLARE s_paid numeric; s_st text; s_date date; t_paid numeric; t_st text; total numeric; moved uuid;
BEGIN
  SELECT amount_paid, status, payment_date INTO s_paid, s_st, s_date FROM public.invoices WHERE id='50000000-0000-0000-0000-000000000000';
  SELECT amount_paid, status INTO t_paid, t_st FROM public.invoices WHERE id='70000000-0000-0000-0000-000000000000';
  IF s_paid IS DISTINCT FROM 50 THEN RAISE EXCEPTION '[MOVE-PAYMENT] source must RE-DERIVE to 50 over the stored 999, got %', s_paid; END IF;
  IF s_st IS DISTINCT FROM 'sent' THEN RAISE EXCEPTION '[MOVE-PAYMENT] source was paid and is now under-paid; must reopen to sent, got %', s_st; END IF;
  IF s_date IS DISTINCT FROM DATE '2026-04-01' THEN RAISE EXCEPTION '[MOVE-PAYMENT] source date must re-derive to the EARLIEST surviving link (2026-04-01) for the kasstelsel, got %', s_date; END IF;
  IF t_paid IS DISTINCT FROM 300 THEN RAISE EXCEPTION '[MOVE-PAYMENT] target must RE-DERIVE to 300 from its links, not add-and-subtract on the stored 0, got %', t_paid; END IF;
  IF t_st IS DISTINCT FROM 'sent' THEN RAISE EXCEPTION '[MOVE-PAYMENT] target still has 200 open, must stay sent, got %', t_st; END IF;
  -- the link moved, and booked money is conserved: 50 + 300 = 350 = sum of all three links
  SELECT invoice_id INTO moved FROM public.bank_tx_invoices WHERE id='11110000-0000-0000-0000-000000000000';
  IF moved IS DISTINCT FROM '70000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION '[MOVE-PAYMENT] the link did not move'; END IF;
  SELECT sum(amount_applied) INTO total FROM public.bank_tx_invoices;
  IF total IS DISTINCT FROM 350 THEN RAISE EXCEPTION '[MOVE-PAYMENT] booked money changed in the move: %', total; END IF;
END $$;

-- ═══ 2. A move that FILLS the target flips it to paid, on THIS payment's own date ════════════════
TRUNCATE public.invoices, public.bank_transactions, public.bank_tx_invoices;
INSERT INTO public.invoices (id, sender_id, direction, status, total_inc_btw, amount_paid) VALUES
  ('50000000-0000-0000-0000-000000000001', :'U', 'outgoing', 'sent', 100, 0),
  ('70000000-0000-0000-0000-000000000001', :'U', 'outgoing', 'sent', 100, 0);
INSERT INTO public.bank_transactions (id, user_id, amount, date, status) VALUES
  ('ba000000-0000-0000-0000-000000000001', :'U', 100, '2026-06-15', 'matched');
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied, paid_on, method, created_at) VALUES
  ('11110000-0000-0000-0000-000000000001', :'U', 'ba000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 100, '2026-06-15', 'bank', now());
SELECT public.move_invoice_payment(:'U'::uuid, '11110000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000001'::uuid);
DO $$
DECLARE t_paid numeric; t_st text; t_date date; s_paid numeric; s_st text;
BEGIN
  SELECT amount_paid, status, payment_date INTO t_paid, t_st, t_date FROM public.invoices WHERE id='70000000-0000-0000-0000-000000000001';
  SELECT amount_paid, status INTO s_paid, s_st FROM public.invoices WHERE id='50000000-0000-0000-0000-000000000001';
  IF t_paid IS DISTINCT FROM 100 OR t_st IS DISTINCT FROM 'paid' THEN RAISE EXCEPTION '[MOVE-PAYMENT] filled target must be paid/100, got %/%', t_paid, t_st; END IF;
  IF t_date IS DISTINCT FROM DATE '2026-06-15' THEN RAISE EXCEPTION '[MOVE-PAYMENT] target must take the payment''s OWN date, not today, got %', t_date; END IF;
  IF s_paid IS DISTINCT FROM 0 OR s_st = 'paid' THEN RAISE EXCEPTION '[MOVE-PAYMENT] emptied source must be 0 and not paid, got %/%', s_paid, s_st; END IF;
END $$;

-- ═══ 3. THE REFUSALS — money must not go where the owner never sent it ═══════════════════════════
TRUNCATE public.invoices, public.bank_transactions, public.bank_tx_invoices;
INSERT INTO public.invoices (id, sender_id, direction, invoice_type, status, total_inc_btw, amount_paid) VALUES
  ('50000000-0000-0000-0000-000000000002', :'U', 'outgoing', 'factuur', 'sent', 100, 0),      -- source, owned by U
  ('70000000-0000-0000-0000-000000000003', :'X', 'outgoing', 'factuur', 'sent', 999, 0),      -- target owned by STRANGER X
  ('70000000-0000-0000-0000-000000000004', :'U', 'incoming', 'factuur', 'received', 100, 0),  -- target, WRONG direction
  ('70000000-0000-0000-0000-000000000005', :'U', 'outgoing', 'factuur', 'draft', 100, 0),     -- target, not payable
  ('70000000-0000-0000-0000-000000000006', :'U', 'outgoing', 'factuur', 'sent', 100, 80),      -- target PAYABLE but only 20 open
  ('70000000-0000-0000-0000-00000000000c', :'U', 'outgoing', 'creditnota', 'sent', -100, 0);     -- a CREDITNOTA (money owed BACK), must never receive a payment
INSERT INTO public.bank_transactions (id, user_id, amount, date, status) VALUES
  ('ba000000-0000-0000-0000-000000000002', :'U', 100, '2026-06-15', 'matched');
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied, paid_on, method, created_at) VALUES
  -- the 80 already on the partial-room target, so it is genuinely payable with 20 open
  ('88880000-0000-0000-0000-000000000006', :'U', NULL, '70000000-0000-0000-0000-000000000006', 80, '2026-01-01', 'kas', now()),
  ('11110000-0000-0000-0000-000000000002', :'U', 'ba000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 100, '2026-06-15', 'bank', now());

CREATE OR REPLACE FUNCTION _expect_refused(p_target uuid, p_why text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.move_invoice_payment('11111111-1111-1111-1111-111111111111'::uuid,
                                        '11110000-0000-0000-0000-000000000002'::uuid, p_target);
    RAISE EXCEPTION '[MOVE-PAYMENT] the move was ALLOWED but must be refused: %', p_why;
  EXCEPTION WHEN sqlstate '55000' OR sqlstate '42501' THEN
    IF (SELECT amount_paid FROM public.invoices WHERE id='50000000-0000-0000-0000-000000000002') IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '[MOVE-PAYMENT] refusal (%) still mutated the source', p_why;
    END IF;
    IF (SELECT invoice_id FROM public.bank_tx_invoices WHERE id='11110000-0000-0000-0000-000000000002')
       IS DISTINCT FROM '50000000-0000-0000-0000-000000000002'::uuid THEN
      RAISE EXCEPTION '[MOVE-PAYMENT] refusal (%) still moved the link', p_why;
    END IF;
  END;
END $$;

SELECT _expect_refused('70000000-0000-0000-0000-000000000003', 'target owned by a stranger');
SELECT _expect_refused('70000000-0000-0000-0000-000000000004', 'direction mismatch');
SELECT _expect_refused('70000000-0000-0000-0000-000000000005', 'target not payable (draft)');
SELECT _expect_refused('70000000-0000-0000-0000-000000000006', 'payable target with only 20 open, 100 does not fit');
SELECT _expect_refused('70000000-0000-0000-0000-00000000000c', 'target is a creditnota — a refund is not settled by receiving money');
SELECT _expect_refused('50000000-0000-0000-0000-000000000002', 'same invoice');

-- a DIFFERENT logged-in user may not move U's payment, even naming U as p_user_id
DO $$ BEGIN
  PERFORM set_config('test.uid', '99999999-9999-9999-9999-999999999999', false);
  BEGIN
    PERFORM public.move_invoice_payment('11111111-1111-1111-1111-111111111111'::uuid,
      '11110000-0000-0000-0000-000000000002'::uuid, '70000000-0000-0000-0000-000000000006'::uuid);
    RAISE EXCEPTION '[MOVE-PAYMENT] a stranger moved U''s payment';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  PERFORM set_config('test.uid', '', false);
END $$;

DROP FUNCTION _expect_refused(uuid, text);


-- ═══ 4. [VERPLAATS-TEKEN] A move may not change which way the link counts against the line ═══════
--
-- The line's budget is SIGNED. A link either spends the line or gives money back to it, decided by
-- whether the invoice moves money the same way the line did. move_invoice_payment refuses a
-- creditnota TARGET but deliberately allows a creditnota SOURCE, and those two sit on opposite
-- sides of that test — so before this guard a move across them flipped the link from -a to +a and
-- the line's spend rose by 2a, with no budget check anywhere in the function.
--
-- The fixture is the measured one: an EUR 850 debit carrying a EUR 1.000 purchase invoice and a
-- EUR 150 supplier credit is EXACTLY TIED at 850. That exactness is the point — it is the state
-- every door leaves, and the state the flip breaks.
TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;

-- The invariant as the four doors compute it, over the TABLES.
CREATE OR REPLACE FUNCTION t_signed_spend(p_tx uuid, p_user uuid) RETURNS numeric
LANGUAGE sql AS $f$
  SELECT coalesce(sum(
    CASE WHEN ((i.direction = 'incoming')
                <> (coalesce(i.invoice_type, 'factuur') = 'creditnota'
                    OR coalesce(i.total_inc_btw, 0) < 0))
              = (coalesce(t.amount, 0) < 0)
         THEN  abs(coalesce(l.amount_applied, 0))
         ELSE -abs(coalesce(l.amount_applied, 0)) END), 0)
  FROM public.bank_tx_invoices l
  JOIN public.invoices i ON i.id = l.invoice_id
  JOIN public.bank_transactions t ON t.id = l.transaction_id
  WHERE l.transaction_id = p_tx AND l.user_id = p_user;
$f$;

INSERT INTO public.invoices (id, receiver_id, direction, invoice_type, status, total_inc_btw, amount_paid) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', :'U', 'incoming', 'factuur',     'paid',     1000, 1000),  -- SPENDS the debit
  ('a0000000-0000-0000-0000-0000000000c1', :'U', 'incoming', 'creditnota',  'paid',     -150,  150),  -- GIVES money back
  ('a0000000-0000-0000-0000-0000000000b1', :'U', 'incoming', 'factuur',     'received',  500,    0),  -- an ordinary target
  ('a0000000-0000-0000-0000-0000000000d1', :'U', 'incoming', 'factuur',     'received', 1200,    0);  -- a same-sign target, with room for the whole 1.000
INSERT INTO public.bank_transactions (id, user_id, amount, date, status, invoice_id) VALUES
  ('ba000000-0000-0000-0000-0000000000a1', :'U', -850, '2026-03-01', 'matched', 'a0000000-0000-0000-0000-0000000000a1');
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied) VALUES
  ('11110000-0000-0000-0000-0000000000a1', :'U', 'ba000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 1000),
  ('11110000-0000-0000-0000-0000000000c1', :'U', 'ba000000-0000-0000-0000-0000000000c1'::uuid, 'a0000000-0000-0000-0000-0000000000c1', 150);
-- the credit's link belongs to the SAME line (written separately so the id above stays readable)
UPDATE public.bank_tx_invoices SET transaction_id = 'ba000000-0000-0000-0000-0000000000a1'
WHERE id = '11110000-0000-0000-0000-0000000000c1';

SELECT set_config('test.uid', '', false);

DO $$
DECLARE before_spend numeric; after_spend numeric; c_inv uuid; c_amt numeric; tgt_paid numeric; tgt_st text;
BEGIN
  before_spend := t_signed_spend('ba000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  IF before_spend IS DISTINCT FROM 850 THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] fixture is not the tied state: signed spend is %, expected 850', before_spend;
  END IF;

  -- THE FLIP: the credit's 150 onto an ordinary invoice of the same direction. Every other guard in
  -- the function passes — same direction, target payable, target not a creditnota, 150 fits in 500.
  BEGIN
    PERFORM public.move_invoice_payment('11111111-1111-1111-1111-111111111111'::uuid,
      '11110000-0000-0000-0000-0000000000c1'::uuid, 'a0000000-0000-0000-0000-0000000000b1'::uuid);
    RAISE EXCEPTION '[VERPLAATS-TEKEN] the sign-flipping move was ACCEPTED — the line would carry 1150 of an 850 line';
  EXCEPTION WHEN sqlstate '55000' THEN
    IF position('change what the bank line has spent' in SQLERRM) = 0 THEN
      RAISE EXCEPTION '[VERPLAATS-TEKEN] refused for a different reason: %', SQLERRM;
    END IF;
  END;

  -- …and it left everything exactly as it found it.
  after_spend := t_signed_spend('ba000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  IF after_spend IS DISTINCT FROM 850 THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] a refusal moved money: signed spend is now %, was 850', after_spend;
  END IF;
  SELECT invoice_id, amount_applied INTO c_inv, c_amt FROM public.bank_tx_invoices WHERE id='11110000-0000-0000-0000-0000000000c1';
  IF c_inv IS DISTINCT FROM 'a0000000-0000-0000-0000-0000000000c1'::uuid THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] the link moved anyway, to %', c_inv;
  END IF;
  IF c_amt IS DISTINCT FROM 150 THEN RAISE EXCEPTION '[VERPLAATS-TEKEN] the amount changed to %', c_amt; END IF;
  SELECT amount_paid, status INTO tgt_paid, tgt_st FROM public.invoices WHERE id='a0000000-0000-0000-0000-0000000000b1';
  IF tgt_paid IS DISTINCT FROM 0 OR tgt_st IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] the refused target was written anyway: paid=% status=%', tgt_paid, tgt_st;
  END IF;
  RAISE NOTICE '  ok · the sign-flipping move is refused, and the line is still tied at % ', after_spend;

  -- SAME SIGN: the 1.000 invoice's own link onto another ordinary purchase invoice. Both spend the
  -- line, so the line's total spend is unchanged and the move must go through untouched.
  PERFORM public.move_invoice_payment('11111111-1111-1111-1111-111111111111'::uuid,
    '11110000-0000-0000-0000-0000000000a1'::uuid, 'a0000000-0000-0000-0000-0000000000d1'::uuid);
  after_spend := t_signed_spend('ba000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  IF after_spend IS DISTINCT FROM 850 THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] a same-sign move changed the line spend to %, must stay 850', after_spend;
  END IF;
  SELECT invoice_id INTO c_inv FROM public.bank_tx_invoices WHERE id='11110000-0000-0000-0000-0000000000a1';
  IF c_inv IS DISTINCT FROM 'a0000000-0000-0000-0000-0000000000d1'::uuid THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] the same-sign move did NOT happen — the guard is too wide';
  END IF;
  RAISE NOTICE '  ok · a same-sign move still goes through, and the line still reads %', after_spend;

  -- The line's own pointer must still be backed by an allocation on that line.
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_transactions t
    JOIN public.bank_tx_invoices l
      ON l.transaction_id = t.id AND l.invoice_id = t.invoice_id AND l.user_id = t.user_id
    WHERE t.id = 'ba000000-0000-0000-0000-0000000000a1'
  ) THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] the line now names an invoice no allocation backs';
  END IF;
  RAISE NOTICE '  ok · the line''s named invoice is still backed by an allocation on that line';
END $$;

-- A MANUAL instalment has no bank line, so the sign rule cannot apply to it and must not block it.
TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;
INSERT INTO public.invoices (id, receiver_id, direction, invoice_type, status, total_inc_btw, amount_paid) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', :'U', 'incoming', 'creditnota', 'paid',     -100, 100),
  ('a0000000-0000-0000-0000-0000000000f1', :'U', 'incoming', 'factuur',    'received',  300,   0);
INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied, paid_on, method) VALUES
  ('11110000-0000-0000-0000-0000000000e1', :'U', NULL, 'a0000000-0000-0000-0000-0000000000e1', 100, '2026-02-01', 'kas');

DO $$
DECLARE moved uuid;
BEGIN
  PERFORM public.move_invoice_payment('11111111-1111-1111-1111-111111111111'::uuid,
    '11110000-0000-0000-0000-0000000000e1'::uuid, 'a0000000-0000-0000-0000-0000000000f1'::uuid);
  SELECT invoice_id INTO moved FROM public.bank_tx_invoices WHERE id='11110000-0000-0000-0000-0000000000e1';
  IF moved IS DISTINCT FROM 'a0000000-0000-0000-0000-0000000000f1'::uuid THEN
    RAISE EXCEPTION '[VERPLAATS-TEKEN] a manual instalment belongs to no line, yet the line guard blocked it';
  END IF;
  RAISE NOTICE '  ok · a manual instalment (transaction_id NULL) is not measured against any line';
END $$;

DROP FUNCTION t_signed_spend(uuid, uuid);

SELECT '[VERPLAATS-TEKEN] held: a move that would change the sign of the line''s spend is refused and writes nothing, a same-sign move is untouched, the line stays backed, and a manual instalment is unaffected' AS result;

SELECT '[MOVE-PAYMENT] held: both sides re-derive over stored drift to the cent, dates re-derive for the kasstelsel, money is conserved, and every refusal leaves the payment where it was' AS result;
