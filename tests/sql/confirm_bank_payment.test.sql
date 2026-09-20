-- migrations: bank_confirm_atomic.sql, bank_rpc_never_payable_states.sql, rpc_anon_revoke.sql, confirm_bank_payment_regrant.sql
-- =====================================================================
-- [SEAM] confirm_bank_payment, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- The most-travelled money path in the app: /api/bank/confirm calls this for every single-invoice
-- confirmation, which is what an owner does dozens of times a quarter on the bank screen.
--
-- It is also the function that carried the SAME sign-blind sum allocate_bank_payment did, in a
-- sibling nobody thought to look at. That is the shape of this defect class: the fix was written
-- into one function, the header explained the reasoning, and the other function with the identical
-- line was left alone — because nothing runs either of them.
--
--   An EUR 850 debit carrying an EUR 150 supplier credit has EUR 1.000 to give. Summed as
--   magnitudes this function computed available = 850 − 150 = 700, capped an EUR 1.000 invoice at
--   EUR 700, and reported success. The path is ordinary: /api/bank/allocate books the credit, the
--   owner then confirms the invoice on the ordinary bank screen, and this function decides.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_reset() RETURNS void LANGUAGE sql AS $$
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
$$;

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

CREATE OR REPLACE FUNCTION public.t_is(what text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

\echo ''
\echo '— [BANK-CONFIRM] the ordinary confirmation: one line, one invoice —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -1210, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur', 1210, 0);

  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  PERFORM public.t_eq('the whole line lands on the invoice', r.applied, 1210);
  PERFORM public.t_is('which is then paid', r.is_paid::text, 'true');
  PERFORM public.t_is('and the line is covered', r.all_covered::text, 'true');
  PERFORM public.t_is('so the transaction is matched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_eq('with exactly one link row',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1);
END $$;

\echo ''
\echo '— [BANK-CONFIRM] a line larger than the invoice stays open for the rest —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
        b uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
        r record;
BEGIN
  -- A supplier combines two invoices in one transfer. Confirming the first must NOT hide the line:
  -- money of it still belongs to the second, and a hidden line is money nobody looks for again.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'received', 'factuur', 600, 0),
         (b, u, 'incoming', 'received', 'factuur', 400, 0);

  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, a, DATE '2026-08-07');
  PERFORM public.t_eq('the first invoice takes what it can absorb', r.applied, 600);
  PERFORM public.t_is('and the line is NOT covered', r.all_covered::text, 'false');
  PERFORM public.t_eq('400 is still to assign', r.line_remaining, 400);
  PERFORM public.t_is('so it stays pending, where the owner can see it',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');

  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, b, DATE '2026-08-07');
  PERFORM public.t_eq('the second takes the rest', r.applied, 400);
  PERFORM public.t_is('and only now is the line matched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_eq('every euro of the line is on an invoice',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1000);
END $$;

\echo ''
\echo '— [CREDITNOTA] a credit already on the line RAISES what it has to give —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        cn uuid := '44444444-4444-4444-4444-444444444444';
        r record;
BEGIN
  -- THE DEFECT. An EUR 850 debit made of an EUR 1.000 supplier invoice and an EUR 150 credit. The
  -- credit is already booked (by /api/bank/allocate); the owner now confirms the invoice here.
  --
  -- Summed as magnitudes: available = 850 − 150 = 700, the EUR 1.000 invoice is capped at EUR 700
  -- and left standing as underpaid, and the function reports success. Signed: 850 − (−150) = 1.000.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -850, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur',    1000, 0),
         (cn,  u, 'incoming', 'received', 'creditnota', -150, 150);
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (u, tx, cn, 150);

  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  PERFORM public.t_eq('the invoice settles in FULL, not at 700', r.applied, 1000);
  PERFORM public.t_is('so it is paid', r.is_paid::text, 'true');
  PERFORM public.t_eq('and the line is spent to the cent', r.line_remaining, 0);
  PERFORM public.t_is('the transaction is matched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
END $$;

\echo ''
\echo '— [CREDITNOTA] on a REFUND line the same credit note SPENDS it —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
        b uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
        r record;
BEGIN
  -- Why the sign is about DIRECTION and not about the invoice type. A supplier refunds EUR 250 in
  -- one credit line, covering two credit notes. Here they consume the line — the refund IS the
  -- money. Signed "creditnota → gives back", the first would count as −150 and the second be
  -- measured against a budget of EUR 400 that does not exist.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, 250, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'received', 'creditnota', -150, 0),
         (b, u, 'incoming', 'received', 'creditnota', -100, 0);

  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, a, DATE '2026-08-07');
  PERFORM public.t_eq('the first credit note settles', r.applied, 150);
  PERFORM public.t_eq('and it SPENT the refund — 100 left, not 400', r.line_remaining, 100);
  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, b, DATE '2026-08-07');
  PERFORM public.t_eq('the second takes the rest', r.applied, 100);
  PERFORM public.t_is('and the line is finished', r.all_covered::text, 'true');
END $$;

\echo ''
\echo '— [BANK-CONFIRM] what it refuses, and how —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean;
BEGIN
  -- A line another booking already claimed returns EMPTY rather than raising — that is the mutex
  -- speaking, and the route answers 409 from it.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'matched', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur', 100, 0);
  PERFORM public.t_eq('a non-pending line returns no rows',
    (SELECT count(*) FROM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07')), 0);

  -- An invoice the accountant has processed is closed to new money.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, accountant_status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'verwerkt', 'factuur', 100, 0);
  caught := false;
  BEGIN PERFORM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice locked by the accountant', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);

  -- A line whose every euro is already elsewhere has nothing left to give.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -500, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur', 500, 0),
         ('aaaaaaaa-0000-0000-0000-000000000009', u, 'incoming', 'received', 'factuur', 500, 500);
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (u, tx, 'aaaaaaaa-0000-0000-0000-000000000009', 500);
  caught := false;
  BEGIN PERFORM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a payment that is fully applied', caught::text, 'true');
END $$;

\echo ''
\echo '— [BANK-CONFIRM] the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean := false;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur', 100, 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not confirm for someone else', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
  PERFORM public.t_eq('service-role still works',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 100);
END $$;

\echo ''
\echo '✅ confirm_bank_payment: every assertion held against a real PostgreSQL.'

\echo ''
\echo '— [NOOIT-BETAALBAAR] a state that is not a bill to pay is refused, and nothing is written —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        tx  uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        st  text;
        msg text;
        code text;
BEGIN
  -- All three never-payable states, one at a time. Each asserts THREE things, because a refusal
  -- that still moved money would pass a test that only looked at the exception.
  FOREACH st IN ARRAY ARRAY['draft', 'archived', 'processing'] LOOP
    TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
    INSERT INTO public.bank_transactions (id, user_id, amount, date, status, invoice_id)
    VALUES (tx, u, -1210, DATE '2026-08-07', 'pending', NULL);
    INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
    VALUES (inv, u, 'incoming', 'received', 'factuur', 1210, 0);
    UPDATE public.invoices SET status = st WHERE id = inv;
    msg := NULL; code := NULL;
    BEGIN
      PERFORM public.confirm_bank_payment(u, tx, inv, DATE '2026-08-07');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    END;
    PERFORM public.t_is(format('%s is refused', st), (msg IS NOT NULL)::text, 'true');
    PERFORM public.t_is(format('%s · refused as a business rule', st), code, '55000');
    -- The refusal happened BEFORE any write: the invoice is untouched and no allocation exists.
    PERFORM public.t_is(format('%s · the invoice did not move', st),
      (SELECT status || '/' || coalesce(amount_paid, 0)::text FROM public.invoices WHERE id = inv),
      st || '/0');
    PERFORM public.t_eq(format('%s · no allocation row was written', st),
      (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv), 0);
    PERFORM public.t_is(format('%s · the bank line is still pending', st),
      (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');
    -- And the wording: none of the six substrings the callers triage on.
    PERFORM public.t_is(format('%s · the refusal names no other refusal', st),
      (msg ILIKE '%verwerkt%' OR msg ILIKE '%already fully paid%' OR msg ILIKE '%already covered%'
       OR msg ILIKE '%fully applied%' OR msg ILIKE '%no longer payable%'
       OR msg ILIKE '%tie no longer exact%')::text, 'false');
  END LOOP;
END $$;

\echo ''
\echo '— [HANDGESCHREVEN-BOEKING] the line claim: invoice_id, and what backs it —'
-- ── WHY THESE ──
--
-- /api/bank/line-invoice enforced `invoice_id IS NULL` in its own UPDATE, beside two other
-- hand-written statements. Moving the mutation into this function would have dropped that
-- condition on the floor, so it moved INTO the claim instead — but NOT as a blanket
-- `invoice_id IS NULL`, which would refuse the second confirm of every multi-invoice payment
-- (case B below, the flow /api/bank/confirm runs).
--
-- What is unsafe is narrower: a line naming an invoice that NO allocation row backs.
-- /api/bank/attach-invoice writes the invoice and the line and treats its link write as
-- non-fatal, so {pending, invoice_id set, no link} is a state this database tolerates — and
-- against it the signed sibling sum reads ZERO, so the whole line is offered a second time.
-- Measured before the guard existed: a EUR 100 line gave EUR 100 to a second invoice while the
-- first already carried amount_paid = 100. EUR 200 booked out of EUR 100.
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        tx  uuid := '22222222-2222-2222-2222-222222222222';
        ia  uuid := '33333333-3333-3333-3333-333333333333';
        ib  uuid := '44444444-4444-4444-4444-444444444444';
        r record; msg text; code text;
BEGIN
  -- ── A · a VIRGIN line books, which is the state line-invoice guarded for ────────────────────
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 100, 0);
  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, ia, DATE '2026-08-07');
  PERFORM public.t_eq('A · invoice_id NULL — the whole line books', r.applied, 100);
  PERFORM public.t_is('A · the line is spent and hidden',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');

  -- ── B · POSITIVE CONTROL. The line names invoice A and a link backs it, so the second
  --        confirm of a multi-invoice payment must still book. Without this control the guard
  --        below could grow into "no line may be confirmed twice" and nothing would notice.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 40, 0),
         (ib, u, 'incoming', 'received', 'factuur', 40, 0);
  PERFORM public.confirm_bank_payment(u, tx, ia, DATE '2026-08-07');
  PERFORM public.t_is('B · after the first confirm the line is pending and names A',
    (SELECT status || '/' || (invoice_id = ia)::text FROM public.bank_transactions WHERE id = tx),
    'pending/true');
  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, ib, DATE '2026-08-07');
  PERFORM public.t_eq('B · the SECOND confirm books its own 40', r.applied, 40);
  PERFORM public.t_eq('B · and the line has 20 left', r.line_remaining, 20);

  -- ── C · THE GUARD. pending + invoice_id set + NO link backing it. ───────────────────────────
  PERFORM public.t_reset();
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 100, 100),   -- already carries the money…
         (ib, u, 'incoming', 'received', 'factuur', 100, 0);
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', ia);
  -- …and NO row in bank_tx_invoices to back it: the state attach-invoice's non-fatal link write
  -- leaves behind. v_elsewhere reads 0 here, which is what made the whole line available again.
  msg := NULL; code := NULL;
  BEGIN
    PERFORM public.confirm_bank_payment(u, tx, ib, DATE '2026-08-07');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
  END;
  PERFORM public.t_is('C · refused', (msg IS NOT NULL)::text, 'true');
  PERFORM public.t_is('C · refused as a business rule', code, '55000');
  PERFORM public.t_is('C · and it says WHY',
    (msg ILIKE '%no allocation backs%')::text, 'true');
  -- Four properties of "unchanged", because a refusal that still moved money reads exactly like
  -- a passing gate if only the exception is asserted.
  PERFORM public.t_is('C · the second invoice did not move',
    (SELECT status || '/' || coalesce(amount_paid, 0)::text || '/' || coalesce(payment_method, '-')
       FROM public.invoices WHERE id = ib), 'received/0/-');
  PERFORM public.t_is('C · the first invoice did not move either',
    (SELECT status || '/' || coalesce(amount_paid, 0)::text FROM public.invoices WHERE id = ia),
    'received/100');
  PERFORM public.t_eq('C · no allocation row was written',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = tx), 0);
  PERFORM public.t_is('C · the line is still pending, still naming A',
    (SELECT status || '/' || (invoice_id = ia)::text FROM public.bank_transactions WHERE id = tx),
    'pending/true');
  -- The wording: none of the six substrings the callers triage on. A refusal carrying one would
  -- be read as a DIFFERENT refusal, with a different dialog, about money.
  PERFORM public.t_is('C · the refusal names no other refusal',
    (msg ILIKE '%verwerkt%' OR msg ILIKE '%already fully paid%' OR msg ILIKE '%already covered%'
     OR msg ILIKE '%fully applied%' OR msg ILIKE '%no longer payable%'
     OR msg ILIKE '%tie no longer exact%')::text, 'false');

  -- ── D · the line names THIS invoice with no link. Not the double-spend shape: the invoice's
  --        own amount_paid already bounds what it can still absorb, so it books the remainder
  --        rather than being refused. Asserted so the guard cannot quietly widen to cover it.
  PERFORM public.t_reset();
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 100, 30);
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'pending', ia);
  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, ia, DATE '2026-08-07');
  PERFORM public.t_eq('D · the line names THIS invoice — it books the remaining 70', r.applied, 70);
  PERFORM public.t_is('D · and the invoice is settled', r.is_paid::text, 'true');
END $$;

\echo ''
\echo '— [HANDGESCHREVEN-BOEKING] one cent is the floor, and it is the SAME floor either side —'
-- The routes now book through this door, so their own minimum must be the door's. v_eps is a
-- ROUNDING tolerance ("covered within a cent counts as paid") and the same constant decides
-- whether a line still has anything worth giving — so a line worth a cent has nothing.
-- Production evidence: the only line at or under a cent is a EUR 0.01 Mollie account-verification
-- deposit; no invoice anywhere is that small; no allocation has ever been written from such a
-- line. line-invoice.ts refuses <= 0.01 before it ever gets here, so the owner reads a sentence
-- that is true; this asserts the two floors cannot drift apart.
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        tx  uuid := '22222222-2222-2222-2222-222222222222';
        ia  uuid := '33333333-3333-3333-3333-333333333333';
        r record; msg text;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -0.01, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 0.01, 0);
  msg := NULL;
  BEGIN
    PERFORM public.confirm_bank_payment(u, tx, ia, DATE '2026-08-07');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  PERFORM public.t_is('a EUR 0.01 line is not worth booking', (msg IS NOT NULL)::text, 'true');
  PERFORM public.t_eq('…and nothing was written',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = tx), 0);

  -- Two cents IS. The floor is a floor, not a general refusal of small money.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -0.02, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (ia, u, 'incoming', 'received', 'factuur', 0.02, 0);
  SELECT * INTO r FROM public.confirm_bank_payment(u, tx, ia, DATE '2026-08-07');
  PERFORM public.t_eq('a EUR 0.02 line books normally', r.applied, 0.02);
END $$;

\echo ''
\echo '— [HANDGESCHREVEN-BOEKING] R6 · no payment door may leave a line naming an invoice nothing backs —'
-- ── THE INVARIANT, AND WHY IT IS STATED OVER THE TABLES ────────────────────────────────────────
--
--   A bank line that names an invoice must carry an allocation row for THAT invoice.
--
-- This is a property of the DATA, not of any one function. The [HANDGESCHREVEN-BOEKING] guard
-- higher up refuses to SPEND a line that violates it; this asserts that no door PRODUCES one —
-- the half a refusal can never prove about itself.
--
-- ── THIS GATE HAS PASSED FOR THE WRONG REASON TWICE. BOTH TIMES ARE WHY IT LOOKS LIKE THIS. ────
--
--   1. It ran all four doors down ONE line. A mutation making book_bank_batch point the line at
--      an invoice it had written no link for passed GREEN, because confirm had written that
--      invoice's link two calls earlier. The invariant held for a reason that had nothing to do
--      with the door under test.
--   2. book_bank_batch then refused all 48 of its shapes on a precondition of its own
--      ([BANK-BATCH] "tie no longer exact"), so the gate still could not see that door at all.
--      "The door ran" is not "the door exercised the protected write".
--
-- So every door below gets its OWN virgin line, its OWN positive control proving it really wrote
-- the allocation, and its OWN mutation — installed into pg_proc and verified there, not in a
-- file — which must make THIS gate red. A passing result from one door can never carry another.
CREATE OR REPLACE FUNCTION public.t_unbacked() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.bank_transactions t
  WHERE t.invoice_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices l
                    WHERE l.transaction_id = t.id AND l.invoice_id = t.invoice_id);
$$;

-- A virgin line for one door, with every precondition ASSERTED rather than assumed. The whole
-- point of the first failure above was a line that was not virgin, so "virgin" is checked here.
CREATE OR REPLACE FUNCTION public.t_r6_virgin(
  p_door text, OUT u uuid, OUT tx uuid, OUT i1 uuid, OUT i2 uuid, OUT amt numeric)
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM public.t_reset();
  u := gen_random_uuid(); tx := gen_random_uuid(); i1 := gen_random_uuid(); i2 := gen_random_uuid();
  -- book_bank_batch refuses unless the batch ties to the line to the cent, so its line is the sum
  -- of its two invoices. Without this it refused every shape and the gate was blind to it.
  amt := CASE WHEN p_door = 'book_bank_batch' THEN -140 ELSE -100 END;
  INSERT INTO public.bank_transactions VALUES (tx, u, amt, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (i1, u, 'incoming', 'received', 'factuur', 100, 0),
         (i2, u, 'incoming', 'received', 'factuur', 40, 0);

  -- PRECONDITIONS. Each is a way the previous two versions of this gate went green wrongly.
  IF (SELECT count(*) FROM public.bank_tx_invoices) <> 0 THEN
    RAISE EXCEPTION 'FAIL · R6/% · residue: the allocation table is not empty at setup', p_door; END IF;
  IF (SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = tx) <> 0 THEN
    RAISE EXCEPTION 'FAIL · R6/% · the line already has a sibling allocation', p_door; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_transactions
                 WHERE id = tx AND user_id = u AND status = 'pending'
                   AND invoice_id IS NULL AND amount = amt) THEN
    RAISE EXCEPTION 'FAIL · R6/% · the line is not a virgin pending line of the expected amount', p_door; END IF;
  IF (SELECT count(*) FROM public.invoices
      WHERE id IN (i1, i2) AND receiver_id = u AND status = 'received' AND amount_paid = 0) <> 2 THEN
    RAISE EXCEPTION 'FAIL · R6/% · the invoices are not open, unpaid and owned by this line''s owner', p_door; END IF;
  IF public.t_unbacked() <> 0 THEN
    RAISE EXCEPTION 'FAIL · R6/% · the invariant is already violated before the door ran', p_door; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.t_r6_call(p_door text, u uuid, tx uuid, i1 uuid, i2 uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  CASE p_door
    WHEN 'confirm_bank_payment'  THEN PERFORM public.confirm_bank_payment(u, tx, i1, DATE '2026-08-07');
    WHEN 'allocate_bank_payment' THEN PERFORM public.allocate_bank_payment(u, tx, i1, 40, DATE '2026-08-07');
    WHEN 'apply_bank_payment'    THEN PERFORM public.apply_bank_payment(u, tx, i1, 100, DATE '2026-08-07');
    WHEN 'book_bank_batch'       THEN PERFORM public.book_bank_batch(u, tx, ARRAY[i1, i2], DATE '2026-08-07');
    ELSE RAISE EXCEPTION 'FAIL · R6 · unknown door %', p_door;
  END CASE;
END $fn$;

DO $r6$
DECLARE
  d text; u uuid; tx uuid; i1 uuid; i2 uuid; amt numeric;
  v_oid oid; v_def text; v_md5 text; v_mut text; v_from text; v_to text;
  want_rows int; want_sum numeric; want_status text; want_names uuid;
  got_rows int; got_sum numeric; got_status text; caught text;
  detected boolean; report text := '';
BEGIN
  FOREACH d IN ARRAY ARRAY['confirm_bank_payment', 'allocate_bank_payment',
                           'apply_bank_payment', 'book_bank_batch'] LOOP

    SELECT count(*) INTO got_rows FROM pg_proc WHERE proname = d;
    IF got_rows <> 1 THEN
      RAISE EXCEPTION 'FAIL · R6/% · % definitions of this door — the mutation would be ambiguous', d, got_rows;
    END IF;
    SELECT oid, pg_get_functiondef(oid), md5(prosrc) INTO v_oid, v_def, v_md5
    FROM pg_proc WHERE proname = d;

    -- ── 1 · POSITIVE CONTROL. The door must really write the allocation. "It ran" is not enough:
    --        a door that refuses every shape makes this gate a non-test, which is exactly what
    --        book_bank_batch silently was.
    SELECT * INTO u, tx, i1, i2, amt FROM public.t_r6_virgin(d);
    -- [R6-NIET-ALLEEN-WEIGEREN] A refusal here is a FAILURE of this gate, not of the fixture, and
    -- it is caught so it says so. book_bank_batch refused all 48 of its shapes on its tie
    -- precondition and this gate reported green for months of shapes it could not see. If a future
    -- change makes a door refuse the shape below, fix the SHAPE — never delete this control.
    BEGIN
      PERFORM public.t_r6_call(d, u, tx, i1, i2);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS caught = MESSAGE_TEXT;
      RAISE EXCEPTION 'FAIL · R6/% · POSITIVE CONTROL: the door REFUSED its own shape (%) — it never reaches the protected write, so this gate is blind to it', d, caught;
    END;
    SELECT count(*), coalesce(sum(amount_applied), 0) INTO got_rows, got_sum
    FROM public.bank_tx_invoices WHERE transaction_id = tx;
    SELECT status INTO got_status FROM public.bank_transactions WHERE id = tx;
    want_rows   := CASE WHEN d = 'book_bank_batch' THEN 2 ELSE 1 END;
    want_sum    := CASE d WHEN 'allocate_bank_payment' THEN 40 WHEN 'book_bank_batch' THEN 140 ELSE 100 END;
    want_status := CASE WHEN d = 'allocate_bank_payment' THEN 'pending' ELSE 'matched' END;
    -- book_bank_batch normalises its list with array_agg(DISTINCT id) (bank_confirm_atomic.sql:358),
    -- which SORTS BY UUID, so its representative is the GREATER of the two random ids — not the
    -- one passed last. Hard-coding i2 here made this gate fail about half the time; the flake was
    -- found by running it five times rather than once, and the lesson is in the assertion below:
    -- assert the property R6 is about (the named invoice is in the batch AND is backed), not an
    -- implementation detail of which one got picked.
    want_names  := CASE WHEN d = 'book_bank_batch' THEN greatest(i1, i2) ELSE i1 END;
    IF got_rows <> want_rows OR got_sum <> want_sum THEN
      RAISE EXCEPTION 'FAIL · R6/% · POSITIVE CONTROL: the door wrote % allocation(s) summing % — expected % summing %. A door that no longer books is a door this gate cannot see.',
        d, got_rows, got_sum, want_rows, want_sum;
    END IF;
    IF got_status <> want_status THEN
      RAISE EXCEPTION 'FAIL · R6/% · POSITIVE CONTROL: the line ended % — expected %', d, got_status, want_status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bank_transactions WHERE id = tx AND invoice_id = want_names) THEN
      RAISE EXCEPTION 'FAIL · R6/% · POSITIVE CONTROL: the line names % — expected the invoice this door settles (%)',
        d, (SELECT invoice_id FROM public.bank_transactions WHERE id = tx), want_names;
    END IF;
    -- …and the named invoice must be BACKED, which is the property this whole gate exists for.
    IF NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices
                   WHERE transaction_id = tx AND invoice_id = want_names) THEN
      RAISE EXCEPTION 'FAIL · R6/% · POSITIVE CONTROL: the invoice the line names carries no allocation', d;
    END IF;
    IF public.t_unbacked() <> 0 THEN
      RAISE EXCEPTION 'FAIL · R6/% · the door left a line naming an invoice nothing backs', d;
    END IF;

    -- ── 2 · MUTATION, INSTALLED INTO pg_proc AND VERIFIED THERE. A mutation that never reaches
    --        the database reads exactly like a passing gate.
    IF d = 'book_bank_batch' THEN
      v_from := '  FROM unnest(p_invoice_ids) AS ids(id)' || chr(10) ||
                '  JOIN public.invoices i ON i.id = ids.id' || chr(10) ||
                '  ON CONFLICT (transaction_id, invoice_id)';
      v_to   := '  FROM unnest(p_invoice_ids) AS ids(id)' || chr(10) ||
                '  JOIN public.invoices i ON i.id = ids.id' || chr(10) ||
                '  WHERE ids.id <> p_invoice_ids[array_upper(p_invoice_ids, 1)] -- R6MUT' || chr(10) ||
                '  ON CONFLICT (transaction_id, invoice_id)';
    ELSE
      v_from := '  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)';
      v_to   := '  SELECT p_user_id, p_tx_id, p_invoice_id, v_applied WHERE false -- R6MUT';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
      RAISE EXCEPTION 'FAIL · R6/% · the mutation anchor occurs % times in the installed body, not once',
        d, (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from);
    END IF;
    v_mut := replace(v_def, v_from, v_to);
    EXECUTE v_mut;
    IF (SELECT position('R6MUT' in prosrc) FROM pg_proc WHERE oid = v_oid) = 0 THEN
      RAISE EXCEPTION 'FAIL · R6/% · the mutation did not reach pg_proc — any verdict below would be meaningless', d;
    END IF;

    -- ── 3 · THE MUTATION MUST MAKE THIS GATE RED, on a line of its own.
    SELECT * INTO u, tx, i1, i2, amt FROM public.t_r6_virgin(d);
    caught := NULL;
    BEGIN PERFORM public.t_r6_call(d, u, tx, i1, i2);
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught = MESSAGE_TEXT; END;
    detected := public.t_unbacked() > 0;

    -- ── 4 · RESTORE, and prove the original body is back byte for byte.
    EXECUTE v_def;
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM v_md5 THEN
      RAISE EXCEPTION 'FAIL · R6/% · the door was NOT restored — this database is now mutated', d;
    END IF;
    IF (SELECT position('R6MUT' in prosrc) FROM pg_proc WHERE oid = v_oid) <> 0 THEN
      RAISE EXCEPTION 'FAIL · R6/% · mutation residue survived the restore', d;
    END IF;

    IF NOT detected THEN
      RAISE EXCEPTION 'FAIL · R6/% · THE MUTATION SURVIVED: the door skipped its allocation write and this gate did not notice (door said: %)',
        d, coalesce(caught, 'no error');
    END IF;

    -- ── 5 · GREEN AGAIN on the restored door, so the red above was the mutation and not drift.
    SELECT * INTO u, tx, i1, i2, amt FROM public.t_r6_virgin(d);
    PERFORM public.t_r6_call(d, u, tx, i1, i2);
    IF public.t_unbacked() <> 0 THEN
      RAISE EXCEPTION 'FAIL · R6/% · still red after restore — the restore did not take', d;
    END IF;
    SELECT count(*), coalesce(sum(amount_applied), 0) INTO got_rows, got_sum
    FROM public.bank_tx_invoices WHERE transaction_id = tx;

    report := report || format(E'\n  ok · R6/%s · booked %s allocation(s) summing %s, line %s · mutation installed in pg_proc, DETECTED, restored (md5 %s)',
      rpad(d, 21), got_rows, got_sum, want_status, left(v_md5, 8));
  END LOOP;
  RAISE NOTICE '%', report;
END $r6$;

\echo ''
\echo '— [HANDGESCHREVEN-BOEKING] R6 breadth · the same invariant across 240 virgin-line shapes —'
-- The four proofs above are DEPTH: one door, one line, one mutation, proven red. This is BREADTH:
-- the same invariant over every amount, direction, type and size combination the doors meet, each
-- on a line of its own, so no door is ever measured against another door's already-safe state.
DO $r6b$
DECLARE
  u uuid; tx uuid; i1 uuid; i2 uuid;
  amt numeric; t1 numeric; t2 numeric; kind text; dir text; door text; d text;
  calls int := 0; shapes int := 0; refused int := 0; booked_by jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.t_reset();
  FOREACH amt IN ARRAY ARRAY[-100, 100, -0.02, -5000] LOOP
  FOREACH t1  IN ARRAY ARRAY[40, 100, 250] LOOP
  FOREACH t2  IN ARRAY ARRAY[40, 100] LOOP
  FOREACH kind IN ARRAY ARRAY['factuur', 'creditnota'] LOOP
  FOREACH door IN ARRAY ARRAY['confirm', 'allocate', 'apply', 'batch', 'stacked'] LOOP
    dir := CASE WHEN amt < 0 THEN 'incoming' ELSE 'outgoing' END;
    u := gen_random_uuid(); tx := gen_random_uuid();
    i1 := gen_random_uuid(); i2 := gen_random_uuid();
    INSERT INTO public.bank_transactions
    VALUES (tx, u, CASE WHEN door = 'batch' THEN sign(amt) * (t1 + t2) ELSE amt END,
            DATE '2026-08-07', 'pending', NULL);
    INSERT INTO public.invoices (id, receiver_id, sender_id, direction, status, invoice_type, total_inc_btw, amount_paid)
    VALUES (i1, u, u, dir, 'received', 'factuur', t1, 0),
           (i2, u, u, dir, 'received', kind,      CASE WHEN kind = 'creditnota' THEN -t2 ELSE t2 END, 0);
    shapes := shapes + 1;

    BEGIN
      CASE door
        WHEN 'confirm'  THEN PERFORM public.confirm_bank_payment(u, tx, i1, DATE '2026-08-07');
        WHEN 'allocate' THEN PERFORM public.allocate_bank_payment(u, tx, i2, 10, DATE '2026-08-07');
        WHEN 'apply'    THEN PERFORM public.apply_bank_payment(u, tx, i2, abs(amt), DATE '2026-08-07');
        WHEN 'batch'    THEN PERFORM public.book_bank_batch(u, tx, ARRAY[i1, i2], DATE '2026-08-07');
        ELSE
          BEGIN PERFORM public.confirm_bank_payment(u, tx, i1, DATE '2026-08-07');
            EXCEPTION WHEN OTHERS THEN refused := refused + 1; END;
          IF public.t_unbacked() > 0 THEN
            RAISE EXCEPTION 'FAIL · R6 · stacked/confirm left an unbacked line (amt=%, t1=%)', amt, t1; END IF;
          BEGIN PERFORM public.allocate_bank_payment(u, tx, i2, 10, DATE '2026-08-07');
            EXCEPTION WHEN OTHERS THEN refused := refused + 1; END;
          IF public.t_unbacked() > 0 THEN
            RAISE EXCEPTION 'FAIL · R6 · stacked/allocate left an unbacked line (amt=%, t2=%, %)', amt, t2, kind; END IF;
          BEGIN PERFORM public.book_bank_batch(u, tx, ARRAY[i1, i2], DATE '2026-08-07');
            EXCEPTION WHEN OTHERS THEN refused := refused + 1; END;
          calls := calls + 2;
      END CASE;
    EXCEPTION WHEN OTHERS THEN refused := refused + 1;
    END;
    calls := calls + 1;

    IF public.t_unbacked() > 0 THEN
      RAISE EXCEPTION 'FAIL · R6 · % left a line naming an invoice that no allocation backs (amt=%, t1=%, t2=%, %)',
        door, amt, t1, t2, kind;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bank_tx_invoices WHERE transaction_id = tx) THEN
      booked_by := jsonb_set(booked_by, ARRAY[door], to_jsonb(coalesce((booked_by ->> door)::int, 0) + 1));
    END IF;
  END LOOP; END LOOP; END LOOP; END LOOP; END LOOP;

  IF (SELECT count(*) FROM public.bank_tx_invoices) = 0 THEN
    RAISE EXCEPTION 'FAIL · R6 · not one allocation was written — the breadth sweep proved nothing'; END IF;
  -- [R6-BATCH-NIET-ALLEEN-WEIGEREN] Every door must have booked at least once. This is the
  -- assertion that would have caught the second wrong-reason pass: book_bank_batch refusing every
  -- shape on its tie precondition turned this sweep into a non-test, silently.
  FOREACH d IN ARRAY ARRAY['confirm', 'allocate', 'apply', 'batch', 'stacked'] LOOP
    IF coalesce((booked_by ->> d)::int, 0) = 0 THEN
      RAISE EXCEPTION 'FAIL · R6 · the % door never booked once in % shapes — this sweep is blind to it (booked: %)',
        d, shapes, booked_by;
    END IF;
  END LOOP;

  RAISE NOTICE '  ok · R6 breadth · % calls over % virgin-line shapes (% refused), 0 unbacked lines, booked per door %',
    calls, shapes, refused, booked_by;
END $r6b$;
