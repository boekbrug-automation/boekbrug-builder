-- =====================================================================
-- [TERUGBETALING] Reverse ONE booked payment: the money came back.
-- BoekBrug - September 2026
-- =====================================================================
-- WHY THIS DID NOT EXIST YET
--
-- Every reversal the app had was a BANK reversal: /api/bank/unlink detaches a bank line and puts
-- its invoices back to open. That covers a wrong match. It does not cover the case where the
-- payment was right and the MONEY LATER LEFT AGAIN: a Mollie refund, a chargeback, a payment
-- returned by hand. Those payments have no bank line at all - they are manual rows in
-- bank_tx_invoices (transaction_id NULL, paid_on, method), booked by apply_manual_payment.
--
-- The only door that could undo one was the invoice-wide "Betaald" toggle, which reverses
-- EVERYTHING on the invoice. On an invoice settled in three instalments of which one was charged
-- back, that is not an undo, it is a demolition.
--
-- MODEL - unchanged, and that is the point:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
-- A payment IS one row of that table (invoice_move_payment.sql says so in the same words).
-- Moving it = giving the row another invoice_id. Reversing it = DELETING the row and re-deriving.
-- One invariant, two verbs; no second notion of "a payment" anywhere in the schema.
--
-- WHY NOT A NEGATIVE ROW INSTEAD OF A DELETE
-- A -300 row beside the +300 keeps a longer history, and it was the first design. It breaks two
-- things that are already load-bearing: recompute_invoice_amount_paid clamps its sum at zero and
-- at the invoice total, so a pair that nets to zero is indistinguishable from no payment at all
-- while the ROW COUNT (which /api/bank/match reads to decide whether a line is finished) says
-- two payments happened; and bank_tx_invoices_origin_check plus the amount_applied semantics in
-- bank-tx-links.ts both assume a row is money that ARRIVED. The history lives in mollie_refunds
-- and in the audit log, which is where a reversal's story belongs anyway - it has a cause, a date
-- and a person, none of which fit in a join row.
--
-- WHAT THIS REFUSES, AND WHY IT REFUSES INSTEAD OF BEING CLEVER
--   - A payment WITH a bank line. /api/bank/unlink owns that reversal and does four more things
--     (the line back to 'pending', the category cleared, the batch siblings, the audit shape).
--     Two doors reversing the same thing differently is how they drift apart; this one says so.
--   - The accountant has processed the invoice ('verwerkt'). Same lock as everywhere: their work
--     rests on this figure. Ask them to undo processing first.
--   - A row with no recorded amount (pre-[PARTIAL-PAY]). We would not know what we are removing.
--
-- DELIBERATELY IDENTICAL to move_invoice_payment's source half, down to the one-cent epsilon and
-- to the fact that marked_paid_at survives a PARTIAL reversal. `status` is the authority on
-- whether an invoice is paid (the invoice screen states that in as many words, because the live
-- data proved payment_date and marked_paid_at disagree with it). Two sibling money functions that
-- differ in one column is how a difference becomes a bug nobody can date.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here changes existing data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_user_id uuid,
  p_link_id uuid   -- bank_tx_invoices.id - THE payment, not "the payments of"
)
-- [BANK-BATCH-AMBIGU] The output columns are named so that NONE of them is also a column this
-- function writes. `amount_paid`, `status` and `invoice_id` would each be ambiguous inside the
-- UPDATEs below, and plpgsql refuses that at RUNTIME — so the function would raise on every single
-- call, and a caller that reads a raise as "not applicable" would never notice. Same shape as
-- move_invoice_payment, which prefixes its outputs for exactly this reason.
RETURNS TABLE (
  reversed_amount     numeric,
  reversed_invoice_id uuid,
  remaining_paid      numeric,
  new_status          text,
  still_paid          boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id      uuid;
  v_inv_id     uuid;
  v_amount     numeric;
  v_status     text;
  v_acc        text;
  v_dir        text;
  v_total      numeric;
  v_sum        numeric;
  v_new_st     text;
  v_date       date;
  v_method     text;
  -- One cent of slack, same as apply_bank_payment and move_invoice_payment.
  v_eps        numeric := 0.01;
BEGIN
  -- Caller guard, same contract as every other money RPC: session client -> auth.uid() = the
  -- user; service-role -> NULL (pinned via p_user_id). A different logged-in user: refused.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[TERUGBETALING] caller % may not reverse payments for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- The payment itself. Locked: a concurrent move or a second reversal of the same row blocks
  -- here and sees the new reality once we commit.
  SELECT l.transaction_id, l.invoice_id, coalesce(l.amount_applied, 0)
    INTO v_tx_id, v_inv_id, v_amount
  FROM public.bank_tx_invoices l
  WHERE l.id = p_link_id AND l.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TERUGBETALING] payment not found' USING ERRCODE = '55000';
  END IF;

  IF v_tx_id IS NOT NULL THEN
    RAISE EXCEPTION '[TERUGBETALING] payment has a bank line - reverse it through unlink'
      USING ERRCODE = '55000';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION '[TERUGBETALING] payment has no recorded amount' USING ERRCODE = '55000';
  END IF;

  -- Lock the invoice; a concurrent apply/recompute serializes on this row.
  SELECT i.status, i.accountant_status, i.direction, abs(coalesce(i.total_inc_btw, 0))
    INTO v_status, v_acc, v_dir, v_total
  FROM public.invoices i
  WHERE i.id = v_inv_id AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[TERUGBETALING] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  IF v_acc = 'verwerkt' THEN
    RAISE EXCEPTION '[TERUGBETALING] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.bank_tx_invoices WHERE id = p_link_id AND user_id = p_user_id;

  -- RE-DERIVE from the surviving links. Not subtract: derive. That way this function cannot
  -- introduce drift, not even when other instalments sit on the same invoice.
  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_sum
  FROM public.bank_tx_invoices WHERE invoice_id = v_inv_id AND user_id = p_user_id;
  IF v_total > 0 AND v_sum > v_total THEN v_sum := v_total; END IF;
  IF v_sum < 0 THEN v_sum := 0; END IF;

  -- A 'paid' that rested on this payment must not stand. Back to the open status the direction
  -- proves - the same rule /api/bank/unlink and move_invoice_payment apply.
  v_new_st := v_status;
  IF v_status = 'paid' AND v_sum < v_total - v_eps THEN
    v_new_st := CASE WHEN v_dir = 'incoming' THEN 'received' ELSE 'sent' END;
  END IF;

  IF v_sum <= 0 THEN
    UPDATE public.invoices
    SET amount_paid = 0, status = v_new_st,
        payment_method = NULL, marked_paid_at = NULL, payment_date = NULL
    WHERE id = v_inv_id;
  ELSE
    -- Instalments remain, so the payment date has to be RE-DERIVED: it decides which quarter the
    -- payment counts in under the kasstelsel, and after removing the FIRST instalment the invoice
    -- would keep claiming it was paid in May while the money still on it arrived in June.
    SELECT coalesce(l.paid_on, bt.date), coalesce(l.method, 'bank')
      INTO v_date, v_method
    FROM public.bank_tx_invoices l
    LEFT JOIN public.bank_transactions bt ON bt.id = l.transaction_id AND bt.user_id = p_user_id
    WHERE l.invoice_id = v_inv_id AND l.user_id = p_user_id
    ORDER BY coalesce(l.paid_on, bt.date) NULLS LAST, l.created_at
    LIMIT 1;

    UPDATE public.invoices
    SET amount_paid    = v_sum,
        status         = v_new_st,
        payment_date   = coalesce(v_date, payment_date),
        payment_method = coalesce(v_method, payment_method)
    WHERE id = v_inv_id;
  END IF;

  RETURN QUERY SELECT v_amount, v_inv_id, v_sum, v_new_st, (v_sum >= v_total - v_eps AND v_total > 0);
END;
$$;

COMMENT ON FUNCTION public.reverse_invoice_payment(uuid, uuid) IS
  '[TERUGBETALING] ATOMICALLY removes ONE booked payment (a bank_tx_invoices row WITHOUT a bank line) because the money came back - a Mollie refund, a chargeback, a returned transfer. The row is deleted, amount_paid is re-derived from the surviving links, the status follows and the payment date is re-derived from the earliest survivor. Refuses (55000) on a payment with a bank line (that reversal belongs to /api/bank/unlink), on an accountant lock, and on a link row with no recorded amount.';

REVOKE ALL ON FUNCTION public.reverse_invoice_payment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
-- The function exists. Must be true.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reverse_invoice_payment'
) AS has_reverse_invoice_payment;
