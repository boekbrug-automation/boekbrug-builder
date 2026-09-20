-- migrations: invoice_manual_payments.sql, invoice_manual_payment_idempotency_scope.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] Archiving an invoice while a payment lands on it, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- /api/invoice/[id]/archive and /api/invoice/[id]/supersede both check for a booked payment with a
-- READ, and then write. Between those two statements the invoice is unprotected, and this is not a
-- quiet corner of the app: apply_manual_payment, apply_bank_payment, book_bank_batch and
-- allocate_bank_payment all reach the same row, and the owner's phone and the reconcile cron run
-- while this request is in flight.
--
-- Both routes answer that with a WHERE clause that re-asserts the status and the accountant lock.
-- The archive route's own comment says why it cannot do more: "it cannot re-assert a bank link".
--
-- The gap is the DEELBETALING. A payment that COMPLETES the invoice moves the status to 'paid',
-- which the WHERE already refuses. A partial one moves only amount_paid — the status stays exactly
-- where it was, every clause still matches, and the invoice is archived with a booked bank payment
-- hanging off it. The invoice then leaves every ledger while the bank line that paid it is skipped
-- as "payment of an already-counted invoice", so the debit counts NOWHERE and the quarter's kosten
-- and voorbelasting are quietly too low.
--
-- Below: the interleaving, with the real payment function booking the real instalment.
--
-- What this file does NOT prove: that the routes issue these statements. The [GELD-IN-WHERE] gates
-- in lifecycle-gates.test.ts hold that. Neither half is sufficient alone.
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

/** One unpaid EUR 1.000 purchase invoice, verified and archivable. */
CREATE OR REPLACE FUNCTION public.t_archivable(u uuid, inv uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, direction, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'incoming', 'factuur', 1000, 0);
END $$;

\echo ''
\echo '— [GELD-IN-WHERE] a FULL payment in the window was already refused —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        links int;
        rows_hit int;
BEGIN
  PERFORM public.t_archivable(u, inv);

  -- The route's pre-check: no payment is attached, so it walks on.
  SELECT count(*) INTO links FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv;
  PERFORM public.t_eq('the pre-check finds no payment', links, 0);

  -- …and in that window the invoice is settled IN FULL.
  PERFORM public.apply_manual_payment(u, inv, NULL, DATE '2026-08-07', 'bank', ARRAY['received'], NULL);
  PERFORM public.t_is('the invoice is now paid', (SELECT status FROM public.invoices WHERE id = inv), 'paid');

  -- The OLD where clause. 'paid' is not in the status list, so this was always safe.
  UPDATE public.invoices SET status = 'archived'
   WHERE id = inv
     AND (sender_id = u OR receiver_id = u)
     AND status IN ('sent','overdue','processing','received')
     AND (accountant_status IS NULL OR accountant_status <> 'verwerkt');
  GET DIAGNOSTICS rows_hit = ROW_COUNT;
  PERFORM public.t_eq('the status clause alone already refused a completed payment', rows_hit, 0);
END $$;

\echo ''
\echo '— [GELD-IN-WHERE] the bug: a DEELBETALING slipped straight through it —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        rows_hit int;
BEGIN
  PERFORM public.t_archivable(u, inv);

  -- Pre-check passes (no links), then EUR 400 of the EUR 1.000 is booked in the window.
  PERFORM public.apply_manual_payment(u, inv, 400, DATE '2026-08-07', 'bank', ARRAY['received'], NULL);
  PERFORM public.t_eq('EUR 400 is booked', (SELECT amount_paid FROM public.invoices WHERE id = inv), 400);
  PERFORM public.t_is('…and the status has NOT moved — there is no "partial" status in this app',
    (SELECT status FROM public.invoices WHERE id = inv), 'received');
  PERFORM public.t_eq('the money has a link row behind it',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv), 1);

  -- The OLD where clause: status still matches, accountant still matches. Nothing refuses.
  UPDATE public.invoices SET status = 'archived'
   WHERE id = inv
     AND (sender_id = u OR receiver_id = u)
     AND status IN ('sent','overdue','processing','received')
     AND (accountant_status IS NULL OR accountant_status <> 'verwerkt');
  GET DIAGNOSTICS rows_hit = ROW_COUNT;
  PERFORM public.t_eq('the old clause ARCHIVED it', rows_hit, 1);
  PERFORM public.t_is('the invoice is out of every ledger…',
    (SELECT status FROM public.invoices WHERE id = inv), 'archived');
  PERFORM public.t_eq('…while EUR 400 of booked bank payment is still attached to it',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE invoice_id = inv), 400);
END $$;

\echo ''
\echo '— [GELD-IN-WHERE] the fix: the money is re-asserted in the WHERE —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        rows_hit int;
BEGIN
  PERFORM public.t_archivable(u, inv);
  PERFORM public.apply_manual_payment(u, inv, 400, DATE '2026-08-07', 'bank', ARRAY['received'], NULL);

  UPDATE public.invoices SET status = 'archived'
   WHERE id = inv
     AND (sender_id = u OR receiver_id = u)
     AND status IN ('sent','overdue','processing','received')
     AND (accountant_status IS NULL OR accountant_status <> 'verwerkt')
     AND (amount_paid IS NULL OR amount_paid <= 0);
  GET DIAGNOSTICS rows_hit = ROW_COUNT;
  PERFORM public.t_eq('the deelbetaling is refused', rows_hit, 0);
  PERFORM public.t_is('the invoice stays where the owner can still see it',
    (SELECT status FROM public.invoices WHERE id = inv), 'received');

  -- And the owner is told WHICH gate closed, from a re-read of the row. Anything else is
  -- "kan niet op deze manier verwijderd worden" about an invoice that looks perfectly ordinary.
  PERFORM public.t_is('…and the reason is readable from the row',
    (SELECT CASE
       WHEN accountant_status = 'verwerkt' THEN 'verwerkt'
       WHEN coalesce(amount_paid, 0) > 0   THEN 'money_settled'
       WHEN status = 'archived'            THEN 'already_archived'
       ELSE 'not_archivable' END
     FROM public.invoices WHERE id = inv), 'money_settled');
END $$;

\echo ''
\echo '— [GELD-IN-WHERE] an invoice with no payment still archives —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        rows_hit int;
BEGIN
  -- The clause must not turn into a blanket refusal: the ordinary case is the whole point of the
  -- button. amount_paid 0 and amount_paid NULL both have to pass — a column default is not a
  -- guarantee, and `NULL <= 0` is NULL, not true.
  PERFORM public.t_archivable(u, inv);
  UPDATE public.invoices SET status = 'archived'
   WHERE id = inv AND (sender_id = u OR receiver_id = u)
     AND status IN ('sent','overdue','processing','received')
     AND (accountant_status IS NULL OR accountant_status <> 'verwerkt')
     AND (amount_paid IS NULL OR amount_paid <= 0);
  GET DIAGNOSTICS rows_hit = ROW_COUNT;
  PERFORM public.t_eq('an unpaid invoice archives, amount_paid = 0', rows_hit, 1);

  PERFORM public.t_archivable(u, inv);
  UPDATE public.invoices SET amount_paid = NULL WHERE id = inv;
  UPDATE public.invoices SET status = 'archived'
   WHERE id = inv AND (sender_id = u OR receiver_id = u)
     AND status IN ('sent','overdue','processing','received')
     AND (accountant_status IS NULL OR accountant_status <> 'verwerkt')
     AND (amount_paid IS NULL OR amount_paid <= 0);
  GET DIAGNOSTICS rows_hit = ROW_COUNT;
  PERFORM public.t_eq('…and so does one whose amount_paid was never written', rows_hit, 1);
END $$;

SELECT '[GELD-IN-WHERE] held: a completing payment was always refused by the status clause, a deelbetaling was not and now is, the owner is told which gate closed, and an unpaid invoice still archives on 0 and on NULL' AS result;
