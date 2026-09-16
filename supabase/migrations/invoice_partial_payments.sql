-- =====================================================================
-- [PARTIAL-PAY] Deelbetaling / instalments — an invoice paid across several
-- bank payments. Migration. BoekBrug · July 2026
-- =====================================================================
-- WHY: the model had NO partial-paid state — an invoice was either fully
-- 'paid' or unpaid. Linking a €400 payment to a €1000 invoice flipped it to
-- fully 'paid' (a WRONG NUMBER: €600 was still openstaand). Instalments were
-- only DETECTED ("lijkt een deelbetaling — controleer") and held, never
-- processed.
--
-- MODEL (minimal, correct, reversible):
--   · invoices.amount_paid       — running total actually settled (sum of the
--                                   amounts applied by each linked payment).
--   · bank_tx_invoices.amount_applied — how much of THAT payment was applied to
--                                   THAT invoice (so an unlink decrements by the
--                                   exact amount, never guesses).
--   Openstaand is derived as: status='paid' ? 0 : max(0, |total| − amount_paid).
--   So a FULLY-paid invoice reads 0 by status (its amount_paid is irrelevant),
--   and only a PARTIAL invoice (still open, amount_paid>0) needs the column —
--   which is exactly why the existing full-pay paths (auto-confirm, batch,
--   multi-confirm) need no change: they set status='paid' and openstaand is 0.
--   P&L / BTW are on accrual (invoice date), so partial payments never touch
--   omzet / voorbelasting / the aangifte — only the paid/openstaand view.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

--
-- ── [RPC-ANON-REVOKE] DIT BESTAND HEROPENT EEN DEUR DIE BEWUST DICHT IS ─────────────────────
--
-- De GRANT onderaan geeft `authenticated` EXECUTE op recompute_invoice_amount_paid — en rpc_anon_revoke.sql neemt dat
-- recht juist WEG, omdat geen enkele call site die functie met een sessieclient aanroept. Wie dit
-- bestand (opnieuw) in de SQL-editor draait, zet die deur dus weer open, en DEEL 2 van
-- docs/WELKE_MIGRATIES_STAAN_ER.sql meldt rpc_anon_revoke.sql daarna als OPEN.
--
-- Gemeten: na het toepassen van invoice_payment_date_rederive.sql stond
-- has_function_privilege('authenticated', 'recompute_invoice_amount_paid', 'EXECUTE') op true.
--
-- DUS: draai na dit bestand ALTIJD rpc_anon_revoke.sql opnieuw. Die is idempotent en herstelt de
-- grens in één keer. De GRANT hieronder blijft staan zoals hij is — dit bestand is toegepast en
-- byte-identiek geverifieerd, en het achteraf anders spellen dan wat er werkelijk gedraaid heeft
-- is precies wat een migratiemap onbetrouwbaar maakt.
--

BEGIN;

-- ── 1) Columns ───────────────────────────────────────────────────────
--    amount_paid: NOT NULL default 0 so every existing + future row has a
--    concrete number (openstaand math never meets NULL). Stored as the same
--    sign-free magnitude as |total_inc_btw| (a creditnota's negative total is
--    handled by the app via abs()).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.amount_paid IS
  '[PARTIAL-PAY] Running total settled against this invoice (magnitude). Openstaand = status=paid ? 0 : max(0, abs(total_inc_btw) - amount_paid). Maintained by apply_bank_payment / book_bank_batch and decremented on unlink.';

--    amount_applied: how much of one payment landed on one invoice. Nullable
--    (older rows predate it; the unlink path falls back to the tx amount when
--    NULL). New writes always set it.
ALTER TABLE public.bank_tx_invoices
  ADD COLUMN IF NOT EXISTS amount_applied numeric;

COMMENT ON COLUMN public.bank_tx_invoices.amount_applied IS
  '[PARTIAL-PAY] Amount of this transaction applied to this invoice. Sum over an invoice''s links = invoices.amount_paid. NULL on pre-migration rows (unlink then falls back to abs(tx.amount)).';

-- ── 2) Backfill ──────────────────────────────────────────────────────
--    Every invoice ALREADY 'paid' is, by definition, fully settled → its
--    amount_paid is its own magnitude. Unpaid invoices stay 0. Idempotent:
--    the WHERE keeps it a no-op on re-run (only lifts 0 → magnitude).
UPDATE public.invoices
SET amount_paid = abs(coalesce(total_inc_btw, 0))
WHERE status = 'paid'
  AND amount_paid = 0
  AND coalesce(total_inc_btw, 0) <> 0;

--    Existing links carried no per-link amount. Each was a FULL settlement of
--    its invoice (1:1 or a batch line that paid that invoice in full), so the
--    applied amount is that invoice's magnitude. Only fill NULLs (idempotent).
UPDATE public.bank_tx_invoices bti
SET amount_applied = abs(coalesce(i.total_inc_btw, 0))
FROM public.invoices i
WHERE bti.invoice_id = i.id
  AND bti.amount_applied IS NULL;

-- ── 3) apply_bank_payment — atomic single-invoice (full OR partial) booking ──
--    The write path for /api/bank/confirm's single-invoice case. Locks the
--    invoice + tx, applies LEAST(payment, remaining) so an invoice is NEVER
--    over-paid, flips to 'paid' ONLY when fully covered, links the tx, and
--    records the exact per-link amount — all in ONE transaction (all-or-
--    nothing). Mirrors book_bank_batch's discipline (mutex + re-verify under
--    lock + reversible + verwerkt guard).
CREATE OR REPLACE FUNCTION public.apply_bank_payment(
  p_user_id   uuid,
  p_tx_id     uuid,
  p_invoice_id uuid,
  p_amount    numeric,   -- the payment magnitude (abs of the bank line)
  p_pay_date  date
)
RETURNS TABLE(applied numeric, amount_paid numeric, total numeric, is_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_status   text;
  v_tx_amount   numeric;
  v_inv_status  text;
  v_acc_status  text;
  v_total       numeric;
  v_paid        numeric;
  v_remaining   numeric;
  -- [LIJN-BUDGET] What the LINE has already given elsewhere, and what that leaves it.
  v_elsewhere   numeric;
  v_available   numeric;
  v_applied     numeric;
  v_now_paid    numeric;
  v_is_paid     boolean;
  -- One cent of slack: floating totals from OCR/xlsx can be a rounding tick
  -- short of the payment. Covered-within-a-cent counts as fully paid.
  v_eps         numeric := 0.01;
BEGIN
  -- Caller guard (same contract as book_bank_batch): session client → auth.uid()
  -- = user; service-role → NULL (user-pinned by p_user_id). Reject a mismatched
  -- authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[PARTIAL-PAY] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] payment amount must be > 0' USING ERRCODE = '22023';
  END IF;

  -- MUTEX on the bank line — a concurrent booker for the same tx blocks here and,
  -- after we commit, sees status <> 'pending' → returns empty (caller skips).
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;   -- already claimed / not ours → empty result
  END IF;

  -- [PARTIAL-PAY-HEEL] This function CONSUMES the line: it ends by setting the transaction to
  -- 'matched' unconditionally, because its semantics are one tx → one invoice. That is only honest
  -- while the amount it is given IS the line. Called with less, it books the smaller number and
  -- retires the line anyway, and the difference stops existing — no link row, no pending line, no
  -- warning. A EUR 300 split of a EUR 1.000 debit loses EUR 700 that the owner will never be
  -- asked about again.
  --
  -- Unreachable from /api/bank/confirm today: a stated amount routes to allocate_bank_payment,
  -- which exists exactly to spend part of a line. But this is the LEGACY fallback that runs when
  -- that function is not installed, and it is SECURITY DEFINER + GRANTed to authenticated, so
  -- PostgREST will call it with whatever it is handed. Two cents of rounding drift are absorbed;
  -- a real shortfall is refused, and the caller is told which function it wanted.
  -- ── [LIJN-BUDGET] WHAT THE LINE STILL HAS, NOT WHAT IT ONCE WAS ────────────────────────────
  --
  -- This was the only one of the four bank-line doors that never read bank_tx_invoices at all.
  -- confirm_bank_payment, allocate_bank_payment and book_bank_batch each subtract what the line
  -- has already given before deciding; this one measured against the line's GROSS amount, and
  -- that single word is the whole defect. It cost in both directions:
  --
  --   · OVER-ALLOCATION. allocate_bank_payment(40) on a EUR 100 line leaves it 'pending' with 60
  --     left. apply_bank_payment(100) then passed the guard below — 100 is not < 100 − 0.02 — and
  --     spent 100, putting 140 on a 100 line. On an already-exhausted line it put 200. One
  --     authenticated caller, no concurrency, no direct table write: both functions are
  --     SECURITY DEFINER, GRANTed to `authenticated`, and PostgREST exposes them by name.
  --   · FALSE REFUSAL. /api/bank/confirm hands this function alloc.amount — payAvailable, already
  --     net of the siblings. On a partly-spent line that net figure IS less than the gross, so the
  --     guard refused a booking that was correct. The same correction fixes both.
  --
  -- Read under the bank-line lock taken immediately above, so it is exact rather than a snapshot a
  -- concurrent booking can invalidate. No new lock, no new abstraction.
  --
  -- [CREDITNOTA] SIGNED, character-for-character the CASE confirm_bank_payment and
  -- allocate_bank_payment already use, and the same rule as bank-line-budget.ts's spendsTheLine.
  -- amount_applied is stored as a MAGNITUDE per invoice, but the LINE's budget is not a sum of
  -- magnitudes: a credit in the same batch GAVE money to the line rather than taking it, so a
  -- EUR 100 debit carrying a EUR 40 supplier creditnota has EUR 140 to give, not 60. Read as
  -- magnitudes this function would cap that invoice at 60 and report success.
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
  WHERE l.transaction_id = p_tx_id AND l.user_id = p_user_id
    AND l.invoice_id <> p_invoice_id;

  v_available := v_tx_amount - v_elsewhere;

  -- Nothing left to spend. Worded exactly as confirm_bank_payment and allocate_bank_payment word
  -- it, because "fully applied" is one of the six substrings fourteen callers triage on: a
  -- different sentence here would be read as a different refusal, with a different dialog.
  IF v_available <= v_eps THEN
    RAISE EXCEPTION '[PARTIAL-PAY] payment fully applied' USING ERRCODE = '55000';
  END IF;

  -- [PARTIAL-PAY-HEEL] …measured against v_available. The function still CONSUMES the line — it
  -- ends by setting the transaction to 'matched' unconditionally — and that stays honest precisely
  -- because the amount it may spend is now capped at what the line still has.
  IF v_available > 0 AND p_amount < v_available - 0.02 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] this function consumes the whole line (% of %) — use allocate_bank_payment to spend part of it',
      p_amount, v_available USING ERRCODE = '55000';
  END IF;

  -- Lock + read the invoice under the lock (its amount_paid/status can't change
  -- beneath us). Ownership enforced (sender OR receiver = caller).
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;
  -- [NOOIT-BETAALBAAR] The same never-payable set that isPayableInvoiceState and book_bank_batch
  -- already refuse: a draft was never issued, an archived invoice is out of the books, and
  -- 'processing' is the verify queue, where the number and the amount are still an unread OCR
  -- reading. Those three facts are about the INVOICE. They say nothing about how much of a bank
  -- line a function spends -- which is the only thing that distinguishes these three doors from
  -- each other -- so the rule is identical on all three and does not touch their semantics.
  --
  -- It sits HERE: after the row is locked and read, and before the first write. A refusal must
  -- never leave a partial allocation behind.
  --
  -- The wording deliberately carries none of the six substrings the callers triage on
  -- ("verwerkt", "already fully paid", "already covered", "fully applied", "no longer payable",
  -- "tie no longer exact"). A message containing one would be read as a different refusal, with a
  -- different dialog, about money.
  IF v_inv_status IN ('draft', 'archived', 'processing') THEN
    RAISE EXCEPTION '[NOOIT-BETAALBAAR] invoice state % cannot receive a bank payment', v_inv_status
      USING ERRCODE = '55000';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  -- Apply at most the remaining balance — an invoice is NEVER over-paid, so any
  -- excess in the payment simply isn't applied to this invoice.
  v_remaining := v_total - v_paid;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice already covered' USING ERRCODE = '55000';
  END IF;
  -- [LIJN-BUDGET] Capped by the LINE's remaining budget as well as the invoice's. This is the
  -- assertion that makes the guard above unbypassable: a caller handing the gross amount is
  -- clamped to what the line can still give rather than spending money that is already gone.
  v_applied  := LEAST(p_amount, v_remaining, v_available);
  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  -- Write the invoice: amount_paid always advances; status flips to 'paid' ONLY
  -- when fully covered (else it stays whatever open state it was — still openstaand).
  IF v_is_paid THEN
    UPDATE public.invoices
    SET amount_paid    = v_total,          -- clamp exactly to total on completion
        status         = 'paid',
        payment_method = 'bank',
        marked_paid_at = now(),
        payment_date   = p_pay_date
    WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices
    SET amount_paid  = v_now_paid,
        payment_date = coalesce(payment_date, p_pay_date)  -- first instalment stamps the date
    WHERE id = p_invoice_id;
  END IF;

  -- Link the bank line. The whole payment is allocated to this one invoice
  -- (instalment semantics: one tx → one invoice), so the tx is fully consumed.
  UPDATE public.bank_transactions
  SET status = 'matched', invoice_id = p_invoice_id
  WHERE id = p_tx_id AND user_id = p_user_id;

  -- Record the exact per-link amount (reversal index; unlink decrements by this).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid;
END;
$$;

COMMENT ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) IS
  '[PARTIAL-PAY] Atomically applies one bank payment to one invoice: applied=LEAST(payment, remaining); amount_paid advances; status→paid only when fully covered; links the tx (matched); records bank_tx_invoices.amount_applied. Empty result = tx already claimed. Exception = invoice not payable.';

REVOKE ALL ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) TO authenticated, service_role;

-- ── 4) recompute_invoice_amount_paid — atomic, drift-free reversal helper ─────
--    The unlink paths remove a payment link, then call this to re-derive
--    amount_paid = SUM(amount_applied) over the invoice's SURVIVING links, under
--    a row lock. This is the authoritative reconciliation of amount_paid to the
--    join table: it is order-independent (two concurrent unlinks each recompute
--    under the lock and both converge on the true remaining sum — no lost-update
--    phantom), and self-healing (a batch unlink that clears every link recomputes
--    to 0, so a pre-migration batch invoice never stays stuck at amount_paid=|total|,
--    which would read €0-openstaand and block re-booking). Clamped to [0, |total|].
--    Call it AFTER the link rows are cleared. Returns the new amount_paid.
CREATE OR REPLACE FUNCTION public.recompute_invoice_amount_paid(
  p_user_id    uuid,
  p_invoice_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_sum   numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[PARTIAL-PAY] caller % may not recompute for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- Lock the invoice; a concurrent apply/recompute serializes on this row.
  SELECT abs(coalesce(total_inc_btw, 0)) INTO v_total
  FROM public.invoices
  WHERE id = p_invoice_id
    AND (sender_id = p_user_id OR receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;   -- not ours / gone → nothing to do
  END IF;

  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_sum
  FROM public.bank_tx_invoices
  WHERE invoice_id = p_invoice_id AND user_id = p_user_id;

  -- Never let the running total exceed the invoice magnitude (defence in depth).
  IF v_total > 0 AND v_sum > v_total THEN
    v_sum := v_total;
  END IF;
  IF v_sum < 0 THEN
    v_sum := 0;
  END IF;

  UPDATE public.invoices SET amount_paid = v_sum WHERE id = p_invoice_id;
  RETURN v_sum;
END;
$$;

COMMENT ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) IS
  '[PARTIAL-PAY] Atomically re-derives invoices.amount_paid = SUM(bank_tx_invoices.amount_applied) for an invoice under a row lock. Called by the unlink paths after clearing link rows — order-independent (no concurrent-unlink lost-update) and self-healing (fully-unlinked → 0).';

REVOKE ALL ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) TO authenticated, service_role;

COMMIT;
