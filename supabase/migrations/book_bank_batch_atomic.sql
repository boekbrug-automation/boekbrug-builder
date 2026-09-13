-- =====================================================================
-- [BANK-BATCH-ATOMIC] Atomic multi-invoice batch booking — migration
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: runBankAutoConfirm's batch pass booked a multi-invoice tie in
-- several separate statements (pay each invoice, THEN link the tx, THEN
-- record the join rows). Two overlapping runs over the SAME batch tx could
-- interleave so that one run paid invoice A + won the tx link while the
-- other paid invoice B, lost the link, and rolled B back — leaving the tx
-- 'matched' but B 'received' (unpaid) and never retried. A paid invoice
-- shown "te laat" forever = a payment-linkage LOSS.
--
-- FIX: do the whole tie in ONE database transaction (this function). It
-- takes a row lock on the bank line FIRST (the mutex), re-verifies every
-- invoice is still payable UNDER that lock, then pays + links + records —
-- all-or-nothing. A concurrent booker blocks on the lock and, after we
-- commit, sees the tx is no longer 'pending' and gets zero rows back (it
-- skips cleanly, never double-books). Any invoice that turned unpayable in
-- the window aborts the WHOLE batch (RAISE → rollback), so a batch is never
-- half-booked.
--
-- SAFETY: identical money discipline to the app path it replaces —
--   · only pays invoices that are currently UNPAID and not accountant-
--     'verwerkt' (B.4), owned by the caller,
--   · links exactly one representative invoice_id onto the tx (the same
--     shape the manual allCovered path writes),
--   · records EVERY paid invoice in bank_tx_invoices (collision-free undo
--     index), so unlink / delete-statement still reverses by id.
-- Fully reversible; the caller still writes the audit row.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable (CREATE OR REPLACE).
-- The CODE that calls book_bank_batch degrades safely if this is not yet
-- applied (the rpc errors → the batch simply isn't auto-booked that run),
-- so there is no hard ordering requirement, but apply this FIRST to enable
-- the feature.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.book_bank_batch(
  p_user_id     uuid,
  p_tx_id       uuid,
  p_invoice_ids uuid[],
  p_pay_date    date
)
RETURNS TABLE(invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- [BANK-BATCH-AMBIGU] This function RETURNS TABLE(invoice_id uuid), which declares a plpgsql
-- variable of that name -- and step (3) below says ON CONFLICT (transaction_id, invoice_id).
-- plpgsql cannot tell whether that means the variable or the column, and its default
-- (variable_conflict = error) refuses to guess. So EVERY call raised
--
--     column reference "invoice_id" is ambiguous
--
-- on the simplest possible input: two invoices tying exactly to the line. The batch pass in
-- bank-auto-confirm.ts answers a raise with `if (batchErr) continue`, and its comment reads
-- "error => not payable / migration not applied => the batch stays for the human" -- so the
-- failure looked like an expected outcome, every time, forever. Multi-invoice auto-confirmation
-- has never booked anything.
--
-- One line settles it: inside the conflict target a bare name means the COLUMN. Nothing else in
-- this function shares a name with a column, so this directive touches exactly that identifier.
#variable_conflict use_column
DECLARE
  v_tx_status text;
  v_tx_amount numeric;
  v_sum_open  numeric;
  v_elsewhere numeric;
  v_rep       uuid;
  v_bad       int;
BEGIN
  -- Caller identity guard. This function runs from BOTH a session client
  -- (the verify/pay route → auth.uid() = the user) AND service-role (cron /
  -- import → auth.uid() IS NULL, already user-pinned by the caller). Allow a
  -- NULL uid (service-role) but reject a MISMATCHED authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BANK-BATCH] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';   -- insufficient_privilege
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RAISE EXCEPTION '[BANK-BATCH] no invoices supplied' USING ERRCODE = '22023';
  END IF;

  -- [BANK-BATCH-DUBBEL] The same invoice twice in one batch is not a batch. Left as given, the tie
  -- below counted that invoice's open balance once per occurrence while the INSERT wrote a single
  -- link row: measured, ARRAY[a, a] on a EUR 500 invoice tied against a EUR 1.000 line, booked
  -- EUR 500, and flipped the line to 'matched' with EUR 500 explained by nothing. De-duplicating
  -- makes the tie fail on its own arithmetic (500 <> 1000) and the batch abort, which is the
  -- honest answer — the caller planned something that only works if one invoice counts twice.
  SELECT array_agg(DISTINCT id) INTO p_invoice_ids FROM unnest(p_invoice_ids) AS u(id);

  -- (1) MUTEX — lock the bank line. A concurrent booker for the same tx blocks
  --     here; after we commit it re-reads the row and sees status <> 'pending'
  --     and returns 0 rows. This empty-return path assumes READ COMMITTED (the
  --     PostgREST default): the loser's FOR UPDATE re-reads our committed
  --     'matched' row. Under REPEATABLE READ / SERIALIZABLE the loser's FOR
  --     UPDATE instead raises a serialization error — which the caller catches
  --     as batchErr and skips, so it still fails SAFE (never double-books).
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;

  -- Not ours, gone, or already booked/linked by a concurrent run → nothing to
  -- do. Return an EMPTY set (no error): the caller treats this as "skip".
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;

  -- (2) Lock every invoice in a deterministic order (id) to avoid deadlocks
  --     between two overlapping batches that share an invoice, then re-verify
  --     each is still payable UNDER the lock: exists, owned by this user, not
  --     already 'paid' (by another tx or a manual/cash payment), and not
  --     accountant-'verwerkt' (B.4). ANY failure aborts the whole batch.
  PERFORM 1
  FROM public.invoices
  WHERE id = ANY (p_invoice_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*) INTO v_bad
  FROM unnest(p_invoice_ids) AS want(id)
  LEFT JOIN public.invoices i
    ON i.id = want.id
   AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  WHERE i.id IS NULL                        -- missing / not owned by caller
     OR i.status = 'paid'                   -- already paid → would double-count
     -- [BUNDEL-DREMPEL] The same never-payable set the app refuses on the 1:1 door: a draft was
     -- never issued, an archived invoice is closed, and 'processing' is the verify queue, where
     -- the number and the amount are still an unread OCR reading. The batch planner used to ask
     -- only "not paid", so a bundle could be planned, offered and confirmed against one of these.
     OR i.status IN ('draft', 'archived', 'processing')
     OR i.accountant_status = 'verwerkt';   -- B.4 locked by the accountant

  IF v_bad > 0 THEN
    RAISE EXCEPTION '[BANK-BATCH] % invoice(s) no longer payable — batch aborted', v_bad
      USING ERRCODE = '55000';   -- object_not_in_prerequisite_state
  END IF;

  -- [BANK-BATCH-GELIJK] This file and bank_confirm_atomic.sql BOTH define book_bank_batch, and
  -- whichever is applied last wins. That is an ordering hazard with money on the end of it: the
  -- newer file added the tie re-proof, and applying this one afterwards would have removed it
  -- again, silently. The two bodies are therefore kept IDENTICAL — the tie block below is the same
  -- one that lives there. Duplication is the lesser evil; a function whose behaviour depends on
  -- migration order is not.

  -- (2b) [BANK-BATCH-TIE-LOCKED] Re-prove the cent-exact tie on the CURRENT
  --      open balances, under the lock. The caller planned against a snapshot;
  --      if an instalment landed since, these amounts no longer sum to the
  --      line and booking them would settle invoices with money that is not
  --      there. A broken tie aborts everything — nothing half-books.
  --
  --      [BANK-BATCH-ELDERS] Against what the line STILL HAS, not its face amount. This comparison
  --      ignored the euros already sitting on OTHER invoices of the same line, and a bank line
  --      stays 'pending' precisely while part of it is spent (confirm_bank_payment leaves it so).
  --      Measured: a EUR 1.000 debit with EUR 400 already booked elsewhere accepted a batch of
  --      EUR 1.000 and left Σ amount_applied at EUR 1.400 — the same euros booked twice, which is
  --      the exact state [BANK-OVERAPPLIED-LOUD] exists to shout about after the fact.
  --
  --      Signed, and by the LINE's direction: identical to the sum in confirm_bank_payment and to
  --      bank-line-budget.ts's spendsTheLine. A credit note gives money back to a debit and spends
  --      a refund, so summing magnitudes here would refuse a batch that fits.
  SELECT coalesce(sum(
           CASE WHEN ((i.direction = 'incoming')
                       <> (coalesce(i.invoice_type, 'factuur') = 'creditnota'
                           OR coalesce(i.total_inc_btw, 0) < 0))
                     = (coalesce(t.amount, 0) < 0)
                THEN  abs(coalesce(l.amount_applied, 0))
                ELSE -abs(coalesce(l.amount_applied, 0)) END
         ), 0) INTO v_elsewhere
  FROM public.bank_tx_invoices l
  JOIN public.invoices i ON i.id = l.invoice_id
  JOIN public.bank_transactions t ON t.id = l.transaction_id
  WHERE l.transaction_id = p_tx_id AND l.user_id = p_user_id;
  -- EVERY link on the line, including ones to invoices IN this batch. Excluding those was the
  -- first version of this fix and it double-counts: an invoice the line already part-paid carries
  -- that money BOTH in its own reduced open balance and in the link row, so leaving the link out
  -- of `elsewhere` lets the batch spend it twice. Measured on a EUR 1.000 line with EUR 200 already
  -- on one of its own batch invoices: Σ amount_applied came out at EUR 1.200.

  SELECT coalesce(sum(GREATEST(0, abs(coalesce(i.total_inc_btw, 0)) - coalesce(i.amount_paid, 0))), 0)
    INTO v_sum_open
  FROM unnest(p_invoice_ids) AS ids(id)
  JOIN public.invoices i ON i.id = ids.id;

  IF abs(v_sum_open - (v_tx_amount - v_elsewhere)) > 0.01 THEN
    RAISE EXCEPTION '[BANK-BATCH] tie no longer exact (open sum % vs line % with % already applied) — batch aborted',
      v_sum_open, v_tx_amount, v_elsewhere USING ERRCODE = '55000';
  END IF;


  -- (3) [PARTIAL-PAY] Record EVERY invoice this payment paid, WITH the amount applied —
  --     and do it BEFORE the invoices are updated, because the amount this batch applies is
  --     the balance that is still OPEN right now: abs(total) − amount_paid. Using the full
  --     total here would make SUM(amount_applied) exceed the invoice whenever the batch
  --     completes an invoice that earlier instalments had already partly settled, and
  --     recompute_invoice_amount_paid (which re-derives amount_paid from that SUM on every
  --     unlink) would then clamp/overstate. The rows are locked FOR UPDATE above, so this
  --     pre-update read is stable. Also the collision-free reversal index (unchanged role).
  -- [BANK-BATCH-ELDERS] ACCUMULATE on conflict, never DO NOTHING. When this same line had already
  -- put money on one of these invoices, dropping the new row left amount_paid at the invoice's full
  -- magnitude (step 4) while Σ amount_applied still read the older, smaller figure — and
  -- amount_paid = Σ amount_applied is the one invariant this whole system rests on. The next unlink
  -- would then recompute the invoice back to that smaller number, silently reopening a paid bill.
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  SELECT p_user_id, p_tx_id, i.id,
         GREATEST(0, abs(coalesce(i.total_inc_btw, 0)) - coalesce(i.amount_paid, 0))
  FROM unnest(p_invoice_ids) AS ids(id)
  JOIN public.invoices i ON i.id = ids.id
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + EXCLUDED.amount_applied;

  -- (4) Pay every invoice. All verified unpaid above → each flips exactly once.
  --     [PARTIAL-PAY] amount_paid must land on the FULL magnitude: this batch settles the
  --     invoice completely. Leaving it at its mid-instalment figure (the old behaviour) made
  --     a fully-paid invoice read as still-partly-open, and under KASSTELSEL the uncounted
  --     portion silently dropped out of the BTW-aangifte.
  UPDATE public.invoices
  SET status         = 'paid',
      payment_method = 'bank',
      marked_paid_at = now(),
      payment_date   = p_pay_date,
      amount_paid    = abs(coalesce(total_inc_btw, 0))
  WHERE id = ANY (p_invoice_ids);

  -- (5) Link the bank line → matched, with a representative invoice_id (the
  --     last id — the same element the prior app code used as `rep`).
  v_rep := p_invoice_ids[array_upper(p_invoice_ids, 1)];
  UPDATE public.bank_transactions
  SET status = 'matched', invoice_id = v_rep
  WHERE id = p_tx_id AND user_id = p_user_id;

  -- Hand the paid ids back so the caller builds its result + audit row.
  RETURN QUERY SELECT ids.id FROM unnest(p_invoice_ids) AS ids(id);
END;
$$;

COMMENT ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) IS
  '[BANK-BATCH-ATOMIC] Atomically books one multi-invoice batch tie: locks the bank line (mutex), re-verifies every invoice is still unpaid + not verwerkt under the lock, records bank_tx_invoices join rows with amount_applied = the still-open balance (pre-update), pays them all (amount_paid → full magnitude), and links the tx (matched + representative invoice_id) — all-or-nothing. Empty result = tx already claimed (skip). Exception = an invoice turned unpayable (whole batch rolled back).';

-- Both the authenticated session client and the service-role pipeline call this.
REVOKE ALL ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) TO authenticated, service_role;

COMMIT;
