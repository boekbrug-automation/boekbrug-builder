-- migrations: bank_confirm_atomic.sql, bank_rpc_never_payable_states.sql
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
