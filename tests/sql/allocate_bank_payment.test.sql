-- migrations: allocate_bank_payment.sql, bank_rpc_never_payable_states.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] allocate_bank_payment, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS FILE EXISTS ──
--
-- Every other test in this repo is pure. payment-plan.ts has 22 of them and they prove the PLAN is
-- arithmetically sound; not one crosses into SQL. The seam between a proven plan and the function
-- that writes it is the one place nothing tested, and it has now produced two separate defects
-- that passed the entire gate set:
--
--   1. The route looped apply_bank_payment, which consumes the bank line on its first call. Every
--      multi-invoice allocation failed after its first invoice — the whole feature.
--   2. allocate_bank_payment was sign-blind, so the creditnota case payment-plan.ts was written FOR
--      booked a €1.000 invoice as €850 paid and never settled the credit.
--
-- Both are invisible to TypeScript by construction: the contract that was wrong lives in plpgsql.
-- So this file asserts against a database that actually runs the function.
--
-- Every assertion RAISEs on failure and psql runs with ON_ERROR_STOP, so a broken contract exits
-- non-zero. Read a passing run as: the function does what its header claims.
-- =====================================================================

\set ON_ERROR_STOP on

\set u    '11111111-1111-1111-1111-111111111111'
\set tx   '22222222-2222-2222-2222-222222222222'
\set inv  '33333333-3333-3333-3333-333333333333'
\set cn   '44444444-4444-4444-4444-444444444444'
\set alien '99999999-9999-9999-9999-999999999999'

-- ── helpers ──────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────
\echo ''
\echo '— [BETAALPLAN] one payment over three invoices: the line survives every call —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
        b uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
        c uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
        r record;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -5000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'received', 'factuur', 1200, 0),
         (b, u, 'received', 'factuur',  800, 0),
         (c, u, 'received', 'factuur', 3000, 0);

  -- This is the exact sequence that used to return NOTHING after the first call, because
  -- apply_bank_payment flipped the line to 'matched' and then refused any line that is not pending.
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, a, 1200, DATE '2026-08-07');
  PERFORM public.t_eq('first invoice books 1200', r.applied, 1200);
  PERFORM public.t_eq('and the line still has 3800', r.line_remaining, 3800);

  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, b, 800, DATE '2026-08-07');
  PERFORM public.t_eq('the SECOND call is not empty', r.applied, 800);

  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, c, 3000, DATE '2026-08-07');
  PERFORM public.t_eq('the third empties the line', r.line_remaining, 0);
  PERFORM public.t_is('and only NOW is it done', r.line_done::text, 'true');

  PERFORM public.t_is('the transaction is matched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_eq('and every euro is linked',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 5000);
END $$;

\echo ''
\echo '— [CREDITNOTA] a supplier bills 1.000, credits 150, debits 850 —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        cn uuid := '44444444-4444-4444-4444-444444444444';
        r record;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -850, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur',    1000, 0),
         (cn,  u, 'received', 'creditnota', -150, 0);

  -- Credit FIRST — the order /api/bank/allocate now sends, held by [CREDITNOTA-VOLGORDE].
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, cn, 150, DATE '2026-08-07');
  PERFORM public.t_eq('the credit books its full 150', r.applied, 150);
  -- The assertion the whole round is about: a credit RAISES what the line has to give.
  PERFORM public.t_eq('and the line goes UP to 1000, not down to 700', r.line_remaining, 1000);
  PERFORM public.t_is('the line is not finished by a credit',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');

  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  PERFORM public.t_eq('the invoice can now be settled in FULL', r.applied, 1000);
  PERFORM public.t_is('so it is paid, not left standing at 850', r.is_paid::text, 'true');

  PERFORM public.t_eq('amount_paid is the invoice total',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 1000);
  PERFORM public.t_is('and its status says so',
    (SELECT status FROM public.invoices WHERE id = inv), 'paid');
  PERFORM public.t_eq('the credit is settled too',
    (SELECT amount_paid FROM public.invoices WHERE id = cn), 150);
  PERFORM public.t_is('the line is matched at the end',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  -- The link rows stay MAGNITUDES: 1000 + 150. The sign is derived where a budget is computed,
  -- never stored — recompute_invoice_amount_paid and the unlink reversal both depend on that.
  PERFORM public.t_eq('links are stored as magnitudes',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1150);
END $$;

\echo ''
\echo '— [CREDITNOTA] a credit with no type, only a negative total, counts the same —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        cn uuid := '44444444-4444-4444-4444-444444444444';
        r record;
BEGIN
  -- An import can leave a credit behind as a 'factuur' with a negative total. payment-plan.ts's
  -- isCreditnota accepts both spellings, so the database has to as well or the two disagree about
  -- the same invoice.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -850, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur',  1000, 0),
         (cn,  u, 'received', 'factuur',  -150, 0);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, cn, 150, DATE '2026-08-07');
  PERFORM public.t_eq('a negative total alone makes it a credit', r.line_remaining, 1000);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
  PERFORM public.t_eq('so the invoice still settles in full', r.applied, 1000);
END $$;

\echo ''
\echo '— [BETAALPLAN] shave a cent, refuse a euro —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        cn uuid := '44444444-4444-4444-4444-444444444444';
        r record;
        msg text;
BEGIN
  -- A cent of drift is absorbed, as it always was.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100.00, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 100.01, 0);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, inv, 100.01, DATE '2026-08-07');
  PERFORM public.t_eq('a cent over is shaved, not refused', r.applied, 100.00);

  -- A material gap is refused. This is the wrong-ORDER case: the €1.000 invoice measured against a
  -- line that still looks like €850 because the batch's credit has not been booked yet. It used to
  -- book 850 and report success; now nothing at all is written.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -850, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur',    1000, 0),
         (cn,  u, 'received', 'creditnota', -150, 0);
  BEGIN
    PERFORM public.allocate_bank_payment(u, tx, inv, 1000, DATE '2026-08-07');
    RAISE EXCEPTION 'FAIL · a 150-euro shortfall was booked silently';
  EXCEPTION WHEN sqlstate '55000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    RAISE NOTICE '  ok · refused: %', msg;
  END;
  PERFORM public.t_eq('and the invoice is untouched',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);
  PERFORM public.t_eq('no link was written',
    (SELECT count(*) FROM public.bank_tx_invoices), 0);
  PERFORM public.t_is('the line is still spendable',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');
END $$;

\echo ''
\echo '— [BETAALPLAN] the ceilings and the refusals —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  -- An invoice already part paid can take only its remainder.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 500, 200);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, inv, 300, DATE '2026-08-07');
  PERFORM public.t_eq('a part-paid invoice takes its remainder', r.applied, 300);
  PERFORM public.t_is('and is then paid', r.is_paid::text, 'true');
  PERFORM public.t_eq('the line keeps what it did not give', r.line_remaining, 700);

  -- A line that another booking already claimed returns EMPTY, which is how the route knows to
  -- stop rather than press on.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -100, DATE '2026-08-07', 'matched', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 100, 0);
  PERFORM public.t_eq('a non-pending line returns no rows',
    (SELECT count(*) FROM public.allocate_bank_payment(u, tx, inv, 100, DATE '2026-08-07')), 0);
END $$;

\echo ''
\echo '— [BETAALPLAN] the refusals that are exceptions, not empty results —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, accountant_status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'verwerkt', 'factuur', 500, 0);

  caught := false;
  BEGIN PERFORM public.allocate_bank_payment(u, tx, inv, 100, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice the accountant processed is closed to new money', caught::text, 'true');

  -- Not owned: the predicate is on the ARGUMENT, so this is the one that made the caller guard
  -- necessary — without it a stranger could probe which of these four exceptions comes back.
  caught := false;
  BEGIN PERFORM public.allocate_bank_payment(u, tx, '55555555-5555-5555-5555-555555555555', 100, DATE '2026-08-07');
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice that is not the user''s is refused', caught::text, 'true');
END $$;

\echo ''
\echo '— [BETAALPLAN] the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean := false;
BEGIN
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 500, 0);

  -- Impersonate a logged-in stranger. This function is SECURITY DEFINER and GRANTed to
  -- `authenticated`, and PostgREST exposes it at /rest/v1/rpc/ with the anon key that ships in the
  -- browser bundle — so without this guard any registered user could name a stranger's uuid.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.allocate_bank_payment(u, tx, inv, 100, DATE '2026-08-07');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not allocate for someone else', caught::text, 'true');

  -- Back to service-role (NULL), where the call is pinned by p_user_id alone.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.allocate_bank_payment(u, tx, inv, 100, DATE '2026-08-07');
  PERFORM public.t_eq('service-role still works', (SELECT amount_paid FROM public.invoices WHERE id = inv), 100);
END $$;

\echo ''
\echo '— [CREDITNOTA] the SAME credit note spends a refund line and gives back to a debit —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
        b uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
        r record;
BEGIN
  -- The case a type-only sign gets wrong, and the reason this rule is about DIRECTION.
  --
  -- A supplier refunds EUR 250 in ONE credit line, covering two credit notes of EUR 150 and
  -- EUR 100. Both are incoming creditnotas — and here they SPEND the line, because the refund IS
  -- the money. Signed "creditnota → gives back", the first would have counted as -150 and the
  -- second been measured against a budget of EUR 400 that does not exist.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, 250, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'received', 'creditnota', -150, 0),
         (b, u, 'incoming', 'received', 'creditnota', -100, 0);

  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, a, 150, DATE '2026-08-07');
  PERFORM public.t_eq('the first credit note settles', r.applied, 150);
  PERFORM public.t_eq('and it SPENT the refund — 100 left, not 400', r.line_remaining, 100);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, b, 100, DATE '2026-08-07');
  PERFORM public.t_eq('the second takes the rest', r.applied, 100);
  PERFORM public.t_is('and the line is finished', r.line_done::text, 'true');

  -- Same creditnota shape, opposite line: on a DEBIT it gives money back. Both readings are
  -- correct; only the line tells you which.
  PERFORM public.t_reset();
  INSERT INTO public.bank_transactions VALUES (tx, u, -850, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'received', 'creditnota', -150, 0),
         (b, u, 'incoming', 'received', 'factuur',    1000, 0);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, a, 150, DATE '2026-08-07');
  PERFORM public.t_eq('on a debit the very same credit RAISES the line', r.line_remaining, 1000);
  SELECT * INTO r FROM public.allocate_bank_payment(u, tx, b, 1000, DATE '2026-08-07');
  PERFORM public.t_eq('so the invoice settles in full', r.applied, 1000);
END $$;

\echo ''
\echo '✅ allocate_bank_payment: every assertion held against a real PostgreSQL.'

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
      PERFORM public.allocate_bank_payment(u, tx, inv, 500, DATE '2026-08-07');
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
