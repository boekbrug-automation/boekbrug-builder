-- =====================================================================
-- [MOVE-PAYMENT] Move a booked payment from ONE invoice to ANOTHER.
-- BoekBrug - July 2026
-- =====================================================================
-- WHY: money lands on the wrong invoice. A supplier sends the same bill twice (the second one
-- corrected), the matcher picks the wrong one of two equal amounts, or the owner taps the payment
-- onto the row above. Until now the answer was: undo the payment on A, find the bank line again,
-- book it on B. Three actions - and between the first and the last the money exists nowhere: the
-- invoice that did receive it reads as open, the bank line is back under "Te bevestigen", and an
-- owner who stops there (the phone rings, the battery dies) leaves the books in that half state.
-- Exactly the kind of silent damage a bookkeeping app must not deal in.
--
-- Moving is one action and therefore has to be one TRANSACTION. Everything below happens inside
-- this function: the link row moves, both invoices have their amount_paid RE-DERIVED from the
-- surviving links, and both statuses follow. There is no moment where the money sits on zero
-- invoices, and none where it sits on two.
--
-- MODEL: a payment IS a row in bank_tx_invoices (amount_applied), with or without a bank line
-- behind it (a manual instalment has transaction_id NULL + paid_on + method). Moving = giving
-- that one row a different invoice_id. That keeps intact the single truth the rest of the system
-- already relies on:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
-- WHAT THIS FUNCTION REFUSES, and why it refuses instead of doing something clever:
--   - The target invoice does not have enough left open. Moving would either over-pay it, or
--     silently SPLIT the amount (move part, leave the rest). Both are an answer the owner never
--     gave, and the second one is not even visible. So: refuse, with both amounts in the message,
--     so the screen can say what IS still open.
--   - The same bank line is already linked to the target. Merging would turn two bookings into
--     one with no trace; that is not a move any more.
--   - Different direction. Money that went to a supplier can never settle a sales invoice.
--   - The accountant has processed one of the two. That lock wins, on either side.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.move_invoice_payment(
  p_user_id           uuid,
  p_link_id           uuid,   -- bank_tx_invoices.id - THE payment, not "the payments of"
  p_target_invoice_id uuid
)
RETURNS TABLE (
  applied            numeric,
  source_invoice_id  uuid,
  source_amount_paid numeric,
  source_status      text,
  target_amount_paid numeric,
  target_status      text,
  target_is_paid     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id        uuid;
  v_src_id       uuid;
  v_amount       numeric;
  v_paid_on      date;
  v_method       text;
  v_first_id     uuid;
  v_second_id    uuid;
  v_src_status   text;
  v_src_acc      text;
  v_src_dir      text;
  v_src_total    numeric;
  v_tgt_status   text;
  v_tgt_type     text;
  v_tgt_acc      text;
  v_tgt_dir      text;
  v_tgt_total    numeric;
  v_tgt_paid     numeric;
  v_tgt_remain   numeric;
  v_src_sum      numeric;
  v_tgt_sum      numeric;
  v_src_new_st   text;
  v_tgt_new_st   text;
  v_tgt_is_paid  boolean;
  v_pay_date     date;
  v_src_date     date;
  v_src_method   text;
  v_pay_method   text;
  v_tx_left      integer;
  -- One cent of slack, same as apply_bank_payment: OCR totals can be a rounding tick short, and
  -- "covered within a cent" counts as paid.
  -- [VERPLAATS-TEKEN] The line's own signed amount, and both documents read as SIGNED rather than
  -- through abs(), because the sign is exactly what this guard is about.
  v_tx_amount    numeric;
  v_src_type     text;
  v_src_signed   numeric;
  v_tgt_signed   numeric;
  v_src_spends   boolean;
  v_tgt_spends   boolean;
  v_eps          numeric := 0.01;
BEGIN
  -- Caller guard, same contract as apply_bank_payment/book_bank_batch: session client -> auth.uid()
  -- = the user; service-role -> NULL (pinned via p_user_id). A different logged-in user: refused.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] caller % may not move payments for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- The payment itself. Locked: a concurrent unlink or a second move of the same row blocks here
  -- and sees the new reality once we commit.
  SELECT l.transaction_id, l.invoice_id, coalesce(l.amount_applied, 0), l.paid_on, l.method
    INTO v_tx_id, v_src_id, v_amount, v_paid_on, v_method
  FROM public.bank_tx_invoices l
  WHERE l.id = p_link_id AND l.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] payment not found' USING ERRCODE = '55000';
  END IF;

  IF v_src_id = p_target_invoice_id THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] same invoice' USING ERRCODE = '55000';
  END IF;

  -- A link row from before [PARTIAL-PAY] carries no amount. We would not know WHAT we are moving,
  -- and inventing an amount is the one thing forbidden here. For those rows, unlinking and
  -- re-booking is the honest route.
  IF v_amount <= 0 THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] payment has no recorded amount' USING ERRCODE = '55000';
  END IF;

  -- Same bank line already on the target? The move would collide with
  -- bank_tx_invoices_unique_pair, and merging silently turns two bookings into one.
  IF v_tx_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bank_tx_invoices
    WHERE transaction_id = v_tx_id AND invoice_id = p_target_invoice_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target already linked to this transaction' USING ERRCODE = '55000';
  END IF;

  -- [VERPLAATS-TEKEN] The bank line itself, locked SECOND — after the link row above and before the
  -- two invoices below, so this function takes its locks in one fixed order for every caller.
  --
  -- It was not locked at all. Every other path that changes what a line has spent
  -- (apply_bank_payment, confirm_bank_payment, allocate_bank_payment, book_bank_batch) takes this
  -- row FIRST and decides under it. This one repointed an allocation with no lock on the line and
  -- no look at its budget, so the sibling sum it is about to change could move underneath it.
  --
  -- A NULL transaction_id is a MANUAL instalment: it belongs to no bank line, so there is no line
  -- to lock and no line budget to change. Nothing in this paragraph applies to it.
  IF v_tx_id IS NOT NULL THEN
    SELECT coalesce(t.amount, 0) INTO v_tx_amount
    FROM public.bank_transactions t
    WHERE t.id = v_tx_id AND t.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[MOVE-PAYMENT] the bank line behind this payment is gone'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Lock BOTH invoices, in a FIXED order by id. Two moves running concurrently in opposite
  -- directions would otherwise deadlock each other; ascending by id makes that impossible by
  -- construction.
  v_first_id  := LEAST(v_src_id, p_target_invoice_id);
  v_second_id := GREATEST(v_src_id, p_target_invoice_id);
  PERFORM 1 FROM public.invoices
    WHERE id = v_first_id AND (sender_id = p_user_id OR receiver_id = p_user_id)
    FOR UPDATE;
  PERFORM 1 FROM public.invoices
    WHERE id = v_second_id AND (sender_id = p_user_id OR receiver_id = p_user_id)
    FOR UPDATE;

  SELECT i.status, i.accountant_status, i.direction, abs(coalesce(i.total_inc_btw, 0)),
         i.invoice_type, coalesce(i.total_inc_btw, 0)
    INTO v_src_status, v_src_acc, v_src_dir, v_src_total,
         v_src_type, v_src_signed
  FROM public.invoices i
  WHERE i.id = v_src_id AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] source invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  SELECT i.status, i.accountant_status, i.direction, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0), i.invoice_type,
         coalesce(i.total_inc_btw, 0)
    INTO v_tgt_status, v_tgt_acc, v_tgt_dir, v_tgt_total, v_tgt_paid, v_tgt_type,
         v_tgt_signed
  FROM public.invoices i
  WHERE i.id = p_target_invoice_id AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  -- The accountant's lock wins, on BOTH sides: moving changes a figure they have already worked
  -- with, whether that is the source or the target.
  IF v_src_acc = 'verwerkt' OR v_tgt_acc = 'verwerkt' THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;

  -- Money that went to a supplier cannot settle a sales invoice, and vice versa.
  IF v_src_dir IS DISTINCT FROM v_tgt_dir THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] direction mismatch' USING ERRCODE = '55000';
  END IF;

  -- The target has to be an invoice that CAN receive money. 'processing' is deliberately absent:
  -- an unverified purchase invoice must not become paid through this door (its amounts came from
  -- the AI and nobody has read them, and 'paid' feeds the BTW figures). Nor 'archived' or 'draft'.
  IF v_tgt_status NOT IN ('received', 'sent', 'overdue') THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target not payable' USING ERRCODE = '55000';
  END IF;

  -- [MOVE-CREDITNOTA] A creditnota is money the business OWES the customer (a negative document);
  -- it is settled by PAYING out or by offsetting, never by RECEIVING money. Moving a received
  -- payment onto it marked it 'paid' at abs(total) — the RPC guards direction, status, fit and
  -- ownership but read the type through abs() and never checked it. Measured: a EUR 100 payment
  -- moved onto a 'sent' creditnota set its amount_paid to 100 and status to 'paid', stripping the
  -- real invoice it belonged to. The SOURCE may be a creditnota (so a wrongly-attached payment can
  -- be moved OFF one); only the TARGET is refused.
  IF v_tgt_type = 'creditnota' THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target is a creditnota — a refund is not settled by receiving money' USING ERRCODE = '55000';
  END IF;
  IF v_tgt_total <= 0 THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target has no total to settle' USING ERRCODE = '55000';
  END IF;

  -- [VERPLAATS-TEKEN] A move may not change WHICH WAY this allocation counts against the bank line.
  --
  -- The line's budget is not a sum of magnitudes. A link either SPENDS the line or GIVES money back
  -- to it, and which one it does is decided by whether the invoice moves money the same way the
  -- line did -- identical to spendsTheLine in bank-line-budget.ts and to the signed sibling sum all
  -- four payment doors compute. amount_applied itself never changes here; only the document it
  -- hangs on does, and that is enough to change its sign.
  --
  -- The SOURCE may be a creditnota -- the guard above refuses only the TARGET, deliberately, so a
  -- payment wrongly attached to a credit can be moved back off it. But those two sit on OPPOSITE
  -- sides of the test above, so moving a link across them flips its contribution from -a to +a and
  -- the line's spend rises by 2a, with no budget check anywhere in this function.
  --
  -- Measured on a real PostgreSQL before this guard existed: a EUR 850 debit carrying a EUR 1.000
  -- purchase invoice and a EUR 150 supplier credit is exactly tied at 850. Moving the credit's
  -- EUR 150 onto an ordinary EUR 500 purchase invoice left EUR 1.150 booked against EUR 850 --
  -- EUR 300 out of a line that never had it -- and the function answered ok.
  --
  -- ONLY the flip is refused. A same-sign move changes nothing about the line and is untouched,
  -- which is every move the screen offers today. The target's own protections above are unchanged
  -- and still run first.
  --
  -- A manual instalment (transaction_id NULL) belongs to no line and is not measured here.
  --
  -- The wording deliberately carries none of the six substrings the callers triage on ("verwerkt",
  -- "already fully paid", "already covered", "fully applied", "no longer payable", "tie no longer
  -- exact"): this is a different refusal, with a different answer.
  IF v_tx_id IS NOT NULL THEN
    v_src_spends := ((v_src_dir = 'incoming')
                      <> (coalesce(v_src_type, 'factuur') = 'creditnota' OR v_src_signed < 0))
                    = (v_tx_amount < 0);
    v_tgt_spends := ((v_tgt_dir = 'incoming')
                      <> (coalesce(v_tgt_type, 'factuur') = 'creditnota' OR v_tgt_signed < 0))
                    = (v_tx_amount < 0);
    IF v_src_spends IS DISTINCT FROM v_tgt_spends THEN
      RAISE EXCEPTION '[VERPLAATS-TEKEN] this move would change what the bank line has spent'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Does it fit? Not fitting means over-paying OR silently splitting. Both are an answer the owner
  -- never gave. The amount that IS still open travels with the message, so the screen can say what
  -- is possible instead of only that this is not.
  v_tgt_remain := v_tgt_total - v_tgt_paid;
  IF v_amount > v_tgt_remain + v_eps THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target remaining % is less than payment %', v_tgt_remain, v_amount
      USING ERRCODE = '55000';
  END IF;

  -- The move itself: one row, one column. Amount, date and method travel unchanged - it is the
  -- same payment, it just belongs somewhere else.
  UPDATE public.bank_tx_invoices
  SET invoice_id = p_target_invoice_id
  WHERE id = p_link_id AND user_id = p_user_id;

  -- The bank line carries one "representative" invoice_id for the screen. If it pointed at the
  -- source and nothing of this line is left on that source, it has to follow - otherwise the Bank
  -- page points at an invoice that no longer holds this payment.
  IF v_tx_id IS NOT NULL THEN
    SELECT count(*) INTO v_tx_left
    FROM public.bank_tx_invoices
    WHERE transaction_id = v_tx_id AND invoice_id = v_src_id AND user_id = p_user_id;
    IF v_tx_left = 0 THEN
      UPDATE public.bank_transactions
      SET invoice_id = p_target_invoice_id
      WHERE id = v_tx_id AND user_id = p_user_id AND invoice_id = v_src_id;
    END IF;
  END IF;

  -- RE-DERIVE both amount_paid values from the surviving links. Not add-and-subtract: derive.
  -- That way this function cannot introduce drift, not even when other instalments sit on either
  -- invoice alongside this payment.
  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_src_sum
  FROM public.bank_tx_invoices WHERE invoice_id = v_src_id AND user_id = p_user_id;
  IF v_src_total > 0 AND v_src_sum > v_src_total THEN v_src_sum := v_src_total; END IF;
  IF v_src_sum < 0 THEN v_src_sum := 0; END IF;

  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_tgt_sum
  FROM public.bank_tx_invoices WHERE invoice_id = p_target_invoice_id AND user_id = p_user_id;
  IF v_tgt_total > 0 AND v_tgt_sum > v_tgt_total THEN v_tgt_sum := v_tgt_total; END IF;
  IF v_tgt_sum < 0 THEN v_tgt_sum := 0; END IF;

  -- Source: the money is gone, so a 'paid' that rested on this payment must not stand. Back to
  -- the open status the direction proves (same rule as /api/bank/unlink). If nothing survives, the
  -- payment fields are cleared too - otherwise the invoice reads as paid on a date where nothing
  -- is booked any more.
  v_src_new_st := v_src_status;
  IF v_src_status = 'paid' AND v_src_sum < v_src_total - v_eps THEN
    v_src_new_st := CASE WHEN v_src_dir = 'incoming' THEN 'received' ELSE 'sent' END;
  END IF;
  IF v_src_sum <= 0 THEN
    UPDATE public.invoices
    SET amount_paid = 0, status = v_src_new_st,
        payment_method = NULL, marked_paid_at = NULL, payment_date = NULL
    WHERE id = v_src_id;
  ELSE
    -- If instalments remain, the source's payment date has to be RE-DERIVED. Leaving it is a
    -- silent error with consequences: payment_date decides which quarter a payment counts in under
    -- the kasstelsel, and after removing the FIRST instalment the invoice would keep claiming it
    -- was paid in May while the money still on it arrived in June. That is a wrong return with no
    -- warning anywhere. So: the EARLIEST surviving payment sets both date and method - a bank line
    -- supplies its own date, a manual instalment carries paid_on/method itself.
    SELECT coalesce(l.paid_on, bt.date), coalesce(l.method, 'bank')
      INTO v_src_date, v_src_method
    FROM public.bank_tx_invoices l
    LEFT JOIN public.bank_transactions bt ON bt.id = l.transaction_id AND bt.user_id = p_user_id
    WHERE l.invoice_id = v_src_id AND l.user_id = p_user_id
    ORDER BY coalesce(l.paid_on, bt.date) NULLS LAST, l.created_at
    LIMIT 1;

    UPDATE public.invoices
    SET amount_paid    = v_src_sum,
        status         = v_src_new_st,
        payment_date   = coalesce(v_src_date, payment_date),
        payment_method = coalesce(v_src_method, payment_method)
    WHERE id = v_src_id;
  END IF;

  -- Target: the date and method of THIS payment, not of today. A bank line supplies its own date;
  -- a manual instalment carries paid_on/method itself. The kasstelsel return hangs on that date, so
  -- filling in "now" would shift the payment into a different quarter.
  v_pay_method := coalesce(v_method, 'bank');
  v_pay_date   := v_paid_on;
  IF v_pay_date IS NULL AND v_tx_id IS NOT NULL THEN
    SELECT date INTO v_pay_date FROM public.bank_transactions WHERE id = v_tx_id AND user_id = p_user_id;
  END IF;

  v_tgt_is_paid := v_tgt_sum >= v_tgt_total - v_eps;
  IF v_tgt_is_paid THEN
    v_tgt_new_st := 'paid';
    UPDATE public.invoices
    SET amount_paid = v_tgt_total, status = 'paid',
        payment_method = v_pay_method, marked_paid_at = now(),
        payment_date = coalesce(payment_date, v_pay_date)
    WHERE id = p_target_invoice_id;
  ELSE
    v_tgt_new_st := v_tgt_status;
    UPDATE public.invoices
    SET amount_paid = v_tgt_sum,
        payment_method = coalesce(payment_method, v_pay_method),
        payment_date = coalesce(payment_date, v_pay_date)
    WHERE id = p_target_invoice_id;
  END IF;

  RETURN QUERY SELECT v_amount, v_src_id, v_src_sum, v_src_new_st, v_tgt_sum, v_tgt_new_st, v_tgt_is_paid;
END;
$$;

COMMENT ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) IS
  '[MOVE-PAYMENT] ATOMICALLY moves one booked payment (a bank_tx_invoices row, bank or manual) to another invoice: the link row moves, the bank line follows when nothing of it is left on the source, and both amount_paid values are re-derived from the surviving links with the statuses following. Refuses (55000) on too little left open at the target, a target already linked to the same bank line, a direction mismatch, a non-payable target status, an accountant lock on either side, and on a link row with no recorded amount.';

REVOKE ALL ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
-- The function exists. Must be true.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'move_invoice_payment'
) AS has_move_invoice_payment;
