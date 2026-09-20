-- migrations: invoice_partial_payments.sql, bank_rpc_never_payable_states.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] apply_bank_payment, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHAT IT IS FOR, AND WHAT MAKES IT DANGEROUS ──
--
-- The one-to-one confirm: this payment settles this invoice. It is /api/bank/confirm's LEGACY
-- path — the route prefers confirm_bank_payment / allocate_bank_payment and falls back here when
-- those are not installed, which is the state of any deployment that has not run the migrations.
--
-- Its defining property is also the sharp edge: it CONSUMES the line. The last thing it does is
-- set the transaction to 'matched', unconditionally, because its semantics are one tx → one
-- invoice. That is honest while the amount it is given IS the line. Given less, it books the
-- smaller number and retires the line anyway, and the difference stops existing — no link row, no
-- pending line, no warning. This file pins that boundary rather than leaving it to a caller.
--
-- It is also the function whose "the tx is fully consumed" comment made looping it break every
-- multi-invoice allocation (see allocate_bank_payment.sql's header). Reading the contract here is
-- how that stops being a surprise.
-- =====================================================================

\set ON_ERROR_STOP on

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

CREATE OR REPLACE FUNCTION public.t_setup(u uuid, tx uuid, inv uuid, line numeric, total numeric, paid numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, line, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'incoming', 'received', 'factuur', total, paid);
END $$;

\echo ''
\echo '— [PARTIAL-PAY] a payment that settles its invoice exactly —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  PERFORM public.t_setup(u, tx, inv, -1210, 1210, 0);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, inv, 1210, DATE '2026-08-07');
  PERFORM public.t_eq('the whole line lands', r.applied, 1210);
  PERFORM public.t_is('the invoice is paid', r.is_paid::text, 'true');
  PERFORM public.t_is('and the line is consumed — this function''s whole contract',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_eq('with a link row carrying the exact amount',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices), 1210);
  PERFORM public.t_is('and the payment date is stamped',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-08-07');
END $$;

\echo ''
\echo '— [PARTIAL-PAY] a payment SMALLER than the invoice is an instalment —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  -- A EUR 400 debit against a EUR 1.000 invoice. The invoice keeps its status — there is no
  -- 'partial' state in this app, only amount_paid moves — and the line is fully spent.
  PERFORM public.t_setup(u, tx, inv, -400, 1000, 0);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, inv, 400, DATE '2026-06-01');
  PERFORM public.t_eq('400 of the 1.000 is settled', r.applied, 400);
  PERFORM public.t_is('the invoice is NOT paid', r.is_paid::text, 'false');
  PERFORM public.t_is('and keeps the status it had',
    (SELECT status FROM public.invoices WHERE id = inv), 'received');
  PERFORM public.t_is('the line is still consumed — it gave everything it had',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_is('and the first instalment stamps the date',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-06-01');
END $$;

\echo ''
\echo '— [PARTIAL-PAY] an over-payment is clamped to what the invoice still owes —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 900);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  PERFORM public.t_eq('only the remaining 100 is applied', r.applied, 100);
  PERFORM public.t_eq('amount_paid lands exactly on the total', r.amount_paid, 1000);
  PERFORM public.t_is('and the invoice is paid', r.is_paid::text, 'true');
  -- NOTE what this leaves behind: the line was worth EUR 1.000, EUR 100 of it is on an invoice,
  -- and it is 'matched'. The other EUR 900 is explained by nothing. That is why the route only
  -- reaches this function when the payment FITS inside the invoice, and why the guard below
  -- exists for every other caller.
  PERFORM public.t_is('the line is consumed regardless',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
END $$;

\echo ''
\echo '— [PARTIAL-PAY-HEEL] it refuses to be handed less than the line —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean;
        r record;
BEGIN
  -- A EUR 300 split of a EUR 1.000 debit. This function would book 300 and retire the line, and
  -- EUR 700 would stop existing — no link row, no pending line, no warning, and the owner is never
  -- asked about it again. allocate_bank_payment exists precisely to spend part of a line.
  --
  -- Unreachable from /api/bank/confirm today (a stated amount routes to allocate_bank_payment),
  -- but this IS the fallback that runs when that function is not installed, and it is SECURITY
  -- DEFINER + GRANTed to authenticated, so PostgREST will call it with whatever it is handed.
  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 0);
  caught := false;
  BEGIN PERFORM public.apply_bank_payment(u, tx, inv, 300, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a partial spend of the line is refused', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);
  PERFORM public.t_is('the line is still spendable',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');

  -- Two cents of drift are still absorbed: an OCR'd total can be a rounding tick short of the
  -- payment, and blowing up a correct confirmation over a cent would be the other kind of wrong.
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, inv, 999.99, DATE '2026-08-07');
  PERFORM public.t_eq('a cent short is absorbed, not refused', r.applied, 999.99);
END $$;

\echo ''
\echo '— [PARTIAL-PAY] what it refuses —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean;
BEGIN
  -- A line another booking already claimed returns EMPTY, not an error — the caller reads that as
  -- "someone got here first" and answers 409.
  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 0);
  UPDATE public.bank_transactions SET status = 'matched' WHERE id = tx;
  PERFORM public.t_eq('a claimed line returns no rows',
    (SELECT count(*) FROM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07')), 0);

  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 0);
  UPDATE public.invoices SET accountant_status = 'verwerkt' WHERE id = inv;
  caught := false;
  BEGIN PERFORM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice the accountant processed', caught::text, 'true');

  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 1000);
  UPDATE public.invoices SET status = 'paid' WHERE id = inv;
  caught := false;
  BEGIN PERFORM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice already paid', caught::text, 'true');

  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 0);
  caught := false;
  BEGIN PERFORM public.apply_bank_payment(u, tx, '55555555-5555-5555-5555-555555555555', 1000, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice that is not the user''s', caught::text, 'true');

  caught := false;
  BEGIN PERFORM public.apply_bank_payment(u, tx, inv, 0, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a payment of nothing', caught::text, 'true');

  PERFORM public.t_eq('and none of them wrote anything',
    (SELECT count(*) FROM public.bank_tx_invoices), 0);
END $$;

\echo ''
\echo '— [PARTIAL-PAY] the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean := false;
BEGIN
  PERFORM public.t_setup(u, tx, inv, -1000, 1000, 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not book for someone else', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.apply_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  PERFORM public.t_eq('service-role still works',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 1000);
END $$;

\echo ''
\echo '✅ apply_bank_payment: every assertion held against a real PostgreSQL.'

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
      PERFORM public.apply_bank_payment(u, tx, inv, 1210, DATE '2026-08-07');
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
