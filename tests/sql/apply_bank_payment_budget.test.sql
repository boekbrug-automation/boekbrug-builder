-- migrations: invoice_partial_payments.sql, bank_rpc_never_payable_states.sql
-- =====================================================================
-- [LIJN-BUDGET] apply_bank_payment measures against what the LINE STILL HAS.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS FILE EXISTS ──
--
-- Four functions in this product turn a bank line into a paid invoice and each requires the line
-- to be 'pending' and ends by setting it 'matched'. Three of them — confirm_bank_payment,
-- allocate_bank_payment, book_bank_batch — read what the line has ALREADY given before deciding.
-- This one did not read bank_tx_invoices at all. Its ceiling was the line's GROSS amount, and that
-- single word was the defect. It cost in both directions:
--
--   OVER-ALLOCATION.  allocate_bank_payment(40) on a EUR 100 line leaves it 'pending' with 60
--   left. apply_bank_payment(100) then passed the guard — 100 is not < 100 − 0.02 — and spent 100.
--   140 on a 100 line. On an exhausted line, 200. One caller, no concurrency, no direct table
--   write: both are SECURITY DEFINER, GRANTed to `authenticated`, and PostgREST exposes them.
--
--   FALSE REFUSAL.    /api/bank/confirm hands this function payAvailable, already net of the
--   siblings. On a partly-spent line that net figure IS below the gross, so the guard refused a
--   booking that was correct.
--
-- The cases below are the A–G matrix the measurement ran. A, F and G must be UNCHANGED by the fix;
-- C and E are the over-allocation; B and D are the false refusal. Each asserts the exact amount
-- applied AND the line's signed total, because a guard checked only by "did the sum stay under the
-- ceiling" is blind to under-booking — measured: four of six mutations survived such a check.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want; END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

CREATE OR REPLACE FUNCTION public.t_refused(what text, got text, needle text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF position(needle in got) = 0 THEN
    RAISE EXCEPTION 'FAIL · % — expected a refusal containing "%", got "%"', what, needle, got;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, needle;
END $$;

/** A EUR `line` debit, one target invoice, and optionally one sibling link already on the line. */
CREATE OR REPLACE FUNCTION public.t_fixture(
  u uuid, tx uuid, target uuid, sibling uuid,
  line numeric, prior numeric, prior_is_credit boolean, target_total numeric
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.bank_tx_invoices; DELETE FROM public.bank_transactions; DELETE FROM public.invoices;
  INSERT INTO public.profiles (id) VALUES (u) ON CONFLICT DO NOTHING;
  INSERT INTO public.bank_transactions (id, user_id, amount, date, status)
  VALUES (tx, u, -line, current_date, 'pending');
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid, invoice_number, invoice_date)
  VALUES (target, u, 'incoming', 'received', 'factuur', target_total, 0, 'TGT', current_date);
  IF prior > 0 THEN
    INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid, invoice_number, invoice_date)
    VALUES (sibling, u, 'incoming', 'received',
            CASE WHEN prior_is_credit THEN 'creditnota' ELSE 'factuur' END, prior, 0, 'PRIOR', current_date);
    INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
    VALUES (u, tx, sibling, prior);
  END IF;
END $$;

/** The SIGNED total on a line — the invariant itself, not a sum of magnitudes. */
CREATE OR REPLACE FUNCTION public.t_signed(tx uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(
    CASE WHEN ((i.direction = 'incoming')
                <> (coalesce(i.invoice_type, 'factuur') = 'creditnota' OR coalesce(i.total_inc_btw, 0) < 0))
              = (coalesce(t.amount, 0) < 0)
         THEN  abs(coalesce(l.amount_applied, 0))
         ELSE -abs(coalesce(l.amount_applied, 0)) END), 0)
  FROM public.bank_tx_invoices l
  JOIN public.invoices i ON i.id = l.invoice_id
  JOIN public.bank_transactions t ON t.id = l.transaction_id
  WHERE l.transaction_id = tx;
$$;

DO $$
DECLARE
  u   uuid := '11111111-1111-4111-8111-111111111111';
  tx  uuid := '22222222-2222-4222-8222-222222222222';
  tgt uuid := '33333333-3333-4333-8333-333333333333';
  sib uuid := '44444444-4444-4444-8444-444444444444';
  r   record; msg text;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '— A · first payment, whole line: unchanged by the guard —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 0, false, 100);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, tgt, 100, current_date);
  PERFORM public.t_eq('applied', r.applied, 100);
  PERFORM public.t_eq('is_paid', (r.is_paid)::int, 1);
  PERFORM public.t_eq('signed total on the line', public.t_signed(tx), 100);

  RAISE NOTICE '';
  RAISE NOTICE '— B · 40 already on the line, caller passes the NET 60 (the live caller''s shape) —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 40, false, 100);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, tgt, 60, current_date);
  PERFORM public.t_eq('applied', r.applied, 60);
  PERFORM public.t_eq('signed total on the line', public.t_signed(tx), 100);

  RAISE NOTICE '';
  RAISE NOTICE '— C · THE DEFECT: 40 already on the line, caller passes the GROSS 100 —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 40, false, 100);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, tgt, 100, current_date);
  PERFORM public.t_eq('applied is capped at what the line has left', r.applied, 60);
  PERFORM public.t_eq('signed total is the line, never 140', public.t_signed(tx), 100);
  PERFORM public.t_eq('the invoice is NOT marked fully paid', (r.is_paid)::int, 0);

  RAISE NOTICE '';
  RAISE NOTICE '— D · exact remaining: invoice 60, line has 60 left —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 40, false, 60);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, tgt, 60, current_date);
  PERFORM public.t_eq('applied', r.applied, 60);
  PERFORM public.t_eq('is_paid', (r.is_paid)::int, 1);
  PERFORM public.t_eq('signed total on the line', public.t_signed(tx), 100);

  RAISE NOTICE '';
  RAISE NOTICE '— E · the line is already fully allocated: refuse, never book a second 100 —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 100, false, 100);
  msg := '(no refusal)';
  BEGIN
    PERFORM public.apply_bank_payment(u, tx, tgt, 100, current_date);
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  PERFORM public.t_refused('refusal wording', msg, 'payment fully applied');
  PERFORM public.t_eq('signed total unchanged, never 200', public.t_signed(tx), 100);

  RAISE NOTICE '';
  RAISE NOTICE '— F · [CREDITNOTA] a 40 supplier credit GAVE money to the line: 140 to give —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 40, true, 140);
  SELECT * INTO r FROM public.apply_bank_payment(u, tx, tgt, 140, current_date);
  PERFORM public.t_eq('applied is 140, not 60 — the sign is not a magnitude', r.applied, 140);
  PERFORM public.t_eq('signed total is the line exactly', public.t_signed(tx), 100);

  RAISE NOTICE '';
  RAISE NOTICE '— G · a 50 invoice on a fresh 100 line still belongs to allocate_bank_payment —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 0, false, 50);
  msg := '(no refusal)';
  BEGIN
    PERFORM public.apply_bank_payment(u, tx, tgt, 50, current_date);
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  PERFORM public.t_refused('refusal wording', msg, 'consumes the whole line');
  PERFORM public.t_eq('nothing was written', public.t_signed(tx), 0);

  RAISE NOTICE '';
  RAISE NOTICE '— the refusal wording stays inside the triaged vocabulary —';
  PERFORM public.t_fixture(u, tx, tgt, sib, 100, 100, false, 100);
  msg := '';
  BEGIN PERFORM public.apply_bank_payment(u, tx, tgt, 100, current_date);
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  -- "fully applied" is one of the six substrings fourteen callers switch on. A refusal here that
  -- invented its own sentence would be triaged as an unexpected fault and alarmed on.
  PERFORM public.t_refused('uses the contracted substring', msg, 'fully applied');
END $$;

\echo ''
\echo '✅ [LIJN-BUDGET] apply_bank_payment respects the signed line budget'
