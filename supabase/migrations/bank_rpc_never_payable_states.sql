-- [NOOIT-BETAALBAAR] The three bank-payment doors refuse the states that are not a bill to pay.
-- BoekBrug · September 2026
--
-- WHAT WAS MEASURED
--
-- Three functions move bank money onto an invoice, and they differ in exactly one way: how much
-- of the bank line they spend. apply_bank_payment consumes the whole line, confirm_bank_payment
-- consumes whatever fits, allocate_bank_payment consumes a stated part. That difference is real
-- domain behaviour and is left untouched here.
--
-- What they SHARED was a two-item denial list: not already paid, not locked by the accountant.
-- The application has a wider rule -- isPayableInvoiceState in src/lib/bank-matching.ts, over
-- {paid, draft, archived, processing} plus verwerkt -- and book_bank_batch enforces that wider
-- rule in production at the database door, under the same row lock, for the same mutation. These
-- three did not. All three are SECURITY DEFINER and EXECUTE-granted to `authenticated`, so the
-- application layer is not a boundary: a crafted PostgREST call could pay a draft, an archived or
-- a still-unverified invoice that every screen in the product refuses.
--
-- Measured exposure when this was written: 69 invoices in those states (0 draft, 59 archived,
-- 10 processing), 1.332 pending bank lines, and 0 of those 69 carrying any money. Nothing to
-- repair -- this closes a door before it is used, it does not clean up after it.
--
-- WHAT THIS DOES NOT DO -- each considered and refused
--
--   · It does NOT introduce a shared payable/payability abstraction. The measurement did not
--     justify one: the deny half is shared, the allow half is not a concept these functions have.
--   · It does NOT change the three spending semantics, any signature, or any caller.
--   · It does NOT touch the existing `paid` and `verwerkt` refusals, which keep their own wording.
--   · It does NOT touch book_bank_batch. That function is declared twice in this repo and its
--     production definition is ahead of main; both are recorded as separate reconciliation items
--     and are deliberately out of scope here.
--
-- OWNERSHIP, AND WHY THE DEFINITIONS APPEAR TWICE
--
-- This migration owns the three definitions below. They are byte-identical to the ones in
-- invoice_partial_payments.sql, bank_confirm_atomic.sql and allocate_bank_payment.sql, which were
-- updated in the same change -- so a database built from those files in any order ends at the
-- same definition this file installs, and neither copy can quietly become the stale one. A gate
-- asserts the two copies agree. (That is the failure book_bank_batch already has, and the reason
-- it is worth the duplication here rather than leaving the originals lying.)
--
-- APPLY: run in the Supabase SQL editor. Deletes nothing. Idempotent.

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

CREATE OR REPLACE FUNCTION public.confirm_bank_payment(
  p_user_id    uuid,
  p_tx_id      uuid,
  p_invoice_id uuid,
  p_pay_date   date
)
RETURNS TABLE(
  applied        numeric,
  amount_paid    numeric,
  total          numeric,
  is_paid        boolean,
  all_covered    boolean,
  line_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_status  text;
  v_tx_amount  numeric;
  v_inv_status text;
  v_acc_status text;
  v_total      numeric;
  v_paid       numeric;
  v_open       numeric;
  v_elsewhere  numeric;
  v_available  numeric;
  v_applied    numeric;
  v_now_paid   numeric;
  v_is_paid    boolean;
  v_line_rest  numeric;
  -- One cent of slack, same as apply_bank_payment: floating totals from
  -- OCR/xlsx can be a rounding tick short. Covered-within-a-cent counts.
  v_eps        numeric := 0.01;
BEGIN
  -- Caller guard (same contract as apply_bank_payment / book_bank_batch):
  -- session client → auth.uid() = user; service-role → NULL (user-pinned by
  -- p_user_id). Reject a mismatched authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BANK-CONFIRM] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- MUTEX on the bank line. Every path that spends this line's money
  -- (apply_bank_payment, book_bank_batch, this function) takes this lock
  -- first, so the sibling-links sum below cannot change beneath us.
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;   -- already claimed / not ours → empty result (caller answers 409)
  END IF;
  IF v_tx_amount <= 0 THEN
    RAISE EXCEPTION '[BANK-CONFIRM] transaction has no amount to spend' USING ERRCODE = '55000';
  END IF;

  -- Lock + re-verify the invoice under the lock.
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
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
    RAISE EXCEPTION '[BANK-CONFIRM] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  v_open := v_total - v_paid;
  IF v_open <= 0 THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice already covered' USING ERRCODE = '55000';
  END IF;

  -- What this line already gave to OTHER invoices — read under the tx lock,
  -- so it is exact, not a snapshot a concurrent confirm can invalidate.
  --
  -- [CREDITNOTA] SIGNED. amount_applied is a MAGNITUDE per invoice — a EUR 150 credit really was
  -- settled by EUR 150, which is what recompute_invoice_amount_paid and the unlink reversal both
  -- read. But the LINE's budget is not a sum of magnitudes: a credit in the same batch GAVE money
  -- to the line rather than taking it, so a EUR 850 debit carrying a EUR 150 credit has EUR 1.000
  -- to give, not EUR 700.
  --
  -- Read as magnitudes this function capped a EUR 1.000 invoice at EUR 700 and reported success —
  -- the same defect allocate_bank_payment had, in the sibling that /api/bank/confirm actually calls
  -- for a single invoice. The realistic path is not exotic: /api/bank/allocate books the credit,
  -- the owner then confirms the invoice on the ordinary bank screen, and this function decides.
  --
  -- The sign is NOT "is it a creditnota". A creditnota is not inherently one or the other: a
  -- supplier credit gives EUR 150 back to a DEBIT, and SPENDS a EUR 150 credit line that is the
  -- supplier actually refunding it. Signed by type alone, two credit notes settled from one refund
  -- would each count negative and the second be measured against a budget that does not exist.
  -- What decides is whether the invoice moves money the same way this line did -- identical to
  -- bank-line-budget.ts's spendsTheLine, so the database and the screen answer alike.
  SELECT coalesce(sum(
           -- Does this link SPEND the line, or give money back to it? Not "is it a creditnota" —
           -- a supplier credit gives €150 back to a DEBIT, and spends a €150 CREDIT that is the
           -- supplier actually refunding it. What decides is whether the invoice moves money the
           -- same way this line did. Same rule as bank-line-budget.ts's spendsTheLine.
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
  IF v_available <= v_eps THEN
    RAISE EXCEPTION '[BANK-CONFIRM] payment fully applied' USING ERRCODE = '55000';
  END IF;

  -- The single money decision, under both locks: give this invoice what the
  -- line still has, capped at what the invoice can absorb.
  v_applied  := LEAST(v_available, v_open);
  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

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
        payment_date = coalesce(payment_date, p_pay_date)
    WHERE id = p_invoice_id;
  END IF;

  -- Reversal index, exact per-link amount (unlink decrements by this).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  -- Is the LINE finished? Same cent rule as bankLineFullyApplied app-side.
  v_line_rest := v_tx_amount - (v_elsewhere + v_applied);
  IF v_line_rest <= v_eps THEN
    UPDATE public.bank_transactions
    SET status = 'matched', invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  ELSE
    -- Money of this line is still unassigned: keep it 'pending' (visible,
    -- actionable) and record the most recent invoice — the same shape the
    -- app's multi-confirm flow has always written.
    UPDATE public.bank_transactions
    SET invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid,
                      (v_line_rest <= v_eps), GREATEST(0, v_line_rest);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_bank_payment(
  p_user_id    uuid,
  p_tx_id      uuid,
  p_invoice_id uuid,
  p_amount     numeric,
  p_pay_date   date
)
RETURNS TABLE(applied numeric, amount_paid numeric, total numeric, is_paid boolean, line_done boolean, line_remaining numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_eps         numeric := 0.005;
  v_tx_status   text;
  v_tx_amount   numeric;
  v_inv_status  text;
  v_acc_status  text;
  v_inv_type    text;
  v_inv_total   numeric;   -- SIGNED, as stored: a creditnota is negative
  v_inv_direction text;
  v_tx_signed   numeric;   -- SIGNED: negative is money OUT. Decides which way each link counts.
  v_sign        integer;   -- +1 this invoice takes money from the line, -1 it gives money back
  v_total       numeric;
  v_paid        numeric;
  v_open        numeric;
  v_elsewhere   numeric;
  v_available   numeric;
  v_want        numeric;
  v_cap         numeric;
  v_applied     numeric;
  v_now_paid    numeric;
  v_is_paid     boolean;
  v_line_rest   numeric;
BEGIN
  -- ── CALLER GUARD — the one line this function was written without ──
  --
  -- Same contract as apply_bank_payment, confirm_bank_payment and book_bank_batch: with the session
  -- client auth.uid() is the caller, so it must equal p_user_id; with service-role it is NULL and
  -- the call is pinned by p_user_id alone.
  --
  -- Its absence was not theoretical. This function is SECURITY DEFINER, so RLS does not apply to
  -- anything it touches, and it is GRANTed to `authenticated` — and PostgREST exposes every such
  -- function directly at /rest/v1/rpc/, with the anon key that ships in the browser bundle. Both
  -- scoping predicates below match on the ARGUMENT (`user_id = p_user_id`, `sender_id = p_user_id
  -- OR receiver_id = p_user_id`), never on the session. So any registered user could name a
  -- stranger's uuid, transaction and invoice and have this function read and lock them.
  --
  -- The money write was blocked today by prevent_accountant_amount_changes, whose deny list
  -- includes amount_paid — but that is a trigger on a DIFFERENT table whose exception list other
  -- migrations edit, so the protection was accidental and one edit from gone. What was reachable
  -- without any trigger help was a cross-tenant oracle: the distinct exceptions below ("invoice not
  -- found / not owned" vs "already fully paid" vs "locked by accountant" vs "already covered") tell
  -- a stranger whether a named invoice of a named user exists, is paid, is locked, and still owes.
  --
  -- The file header claims every refusal was copied from the two functions this one was built from.
  -- This is the one that was not, and it is why a sweep for "SECURITY DEFINER + p_user_id + GRANT
  -- authenticated + no auth.uid()" over every migration returned exactly one hit: this file.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BETAALPLAN] caller % may not allocate for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- The line, locked. 'pending' is the only state that may still be spent; anything else means
  -- another booking already claimed it, and an empty result tells the caller to stop.
  SELECT status, abs(coalesce(amount, 0)), coalesce(amount, 0)
    INTO v_tx_status, v_tx_amount, v_tx_signed
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;
  IF v_tx_amount <= 0 THEN
    RAISE EXCEPTION '[BETAALPLAN] transaction has no amount to spend' USING ERRCODE = '55000';
  END IF;

  -- The invoice, locked and re-verified under that lock. Every refusal here is one the caller
  -- also checks before writing anything; they are repeated because a plan proven a second ago is
  -- not a plan proven now.
  SELECT i.status, i.accountant_status, i.invoice_type, i.direction, coalesce(i.total_inc_btw, 0),
         abs(coalesce(i.total_inc_btw, 0)), abs(coalesce(i.amount_paid, 0))
    INTO v_inv_status, v_acc_status, v_inv_type, v_inv_direction, v_inv_total, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  -- [CREDITNOTA] Which way this invoice moves the line's money.
  --
  -- NOT "is it a creditnota", which is what this line said first. A creditnota is not inherently
  -- one or the other: a supplier credit gives €150 back to a DEBIT, and SPENDS a €150 credit line
  -- that is the supplier actually refunding it. What decides is whether the invoice moves money the
  -- same way this bank line did — identical to bank-line-budget.ts's spendsTheLine, and to the CASE
  -- in the sibling sum below.
  --
  -- The credit test itself is unchanged from everywhere else in this app (payment-plan.ts's
  -- isCreditnota, money-invariants.ts's creditnotaIds): the type OR a negative total, because both
  -- are how a credit reaches this table.
  v_sign := CASE WHEN ((v_inv_direction = 'incoming')
                        <> (coalesce(v_inv_type, 'factuur') = 'creditnota' OR v_inv_total < 0))
                      = (v_tx_signed < 0)
                 THEN 1 ELSE -1 END;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
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
    RAISE EXCEPTION '[BETAALPLAN] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  v_open := v_total - v_paid;
  IF v_open <= v_eps THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice already covered' USING ERRCODE = '55000';
  END IF;

  -- What this line already gave to OTHER invoices, read under the tx lock so it is exact rather
  -- than a snapshot a concurrent booking can invalidate. This is the sum guard the caller performs
  -- in TypeScript — here it is atomic, which is what makes it true.
  --
  -- [CREDITNOTA] SIGNED. amount_applied is stored as a magnitude — per invoice the link means
  -- "this much of it was settled", which is positive for a creditnota too, and that is what
  -- recompute_invoice_amount_paid and the unlink reversal both need. But the LINE's budget is not
  -- a sum of magnitudes: a credit of €150 in the same batch means the €850 debit has €1.000 to
  -- give, not €700. So the sign is re-derived here from each linked invoice's own type, exactly
  -- as money-invariants.ts does for the same sum. Read as magnitudes this returned 150 where the
  -- truth is −150 — a €300 error on one small credit, in the direction that books too little.
  SELECT coalesce(sum(
           -- Does this link SPEND the line, or give money back to it? Not "is it a creditnota" —
           -- a supplier credit gives €150 back to a DEBIT, and spends a €150 CREDIT that is the
           -- supplier actually refunding it. What decides is whether the invoice moves money the
           -- same way this line did. Same rule as bank-line-budget.ts's spendsTheLine.
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

  IF v_sign = 1 THEN
    -- An ordinary invoice SPENDS the line, so what is left is its ceiling.
    IF v_available <= v_eps THEN
      RAISE EXCEPTION '[BETAALPLAN] payment fully applied' USING ERRCODE = '55000';
    END IF;
    -- ── SHAVE A CENT, REFUSE A EURO ──
    --
    -- The first version capped silently against both ceilings, and the reasoning was sound as far
    -- as it went: the caller has already proven the plan, so reaching a ceiling means something
    -- shifted underneath it, and booking the smaller provable number beats blowing up a valid
    -- batch over a cent of rounding drift.
    --
    -- What it did not survive is a MATERIAL gap. A €1.000 invoice measured against a line that
    -- still looks like €850 — because the batch's €150 credit has not been booked yet — was capped
    -- to 850 and reported as a success. The invoice then stands at 850 paid and still open, the
    -- line is spent to the cent so it flips to 'matched', and the credit that follows finds a line
    -- that is no longer pending. Nothing anywhere says a number was changed.
    --
    -- Ordering fixes that case (the route sends credits first) and ordering is not a guarantee: it
    -- is one caller's discipline, and this function is reachable from PostgREST by anything holding
    -- a session. So the rule is now about SIZE, which is the thing that actually distinguishes the
    -- two situations. Up to two cents is rounding and is absorbed exactly as before. Beyond that
    -- the plan and the world genuinely disagree, and this function refuses — which the route turns
    -- into "de verdeling is halverwege gestopt" with the lines that did land listed underneath it.
    -- A batch that says it stopped can be finished by hand; one that claims success cannot be
    -- found again.
    v_want := GREATEST(coalesce(p_amount, 0), 0);
    v_cap  := LEAST(v_available, v_open);
    IF v_want > v_cap + 0.02 THEN
      RAISE EXCEPTION '[BETAALPLAN] asked % but only % is left for this invoice (line %, open %)',
        v_want, v_cap, v_available, v_open USING ERRCODE = '55000';
    END IF;
    v_applied := LEAST(v_want, v_cap);
  ELSE
    -- [CREDITNOTA] A credit does not spend the line, it RAISES what the line has to give — so
    -- v_available is not a ceiling on it and "payment fully applied" is not a refusal that can
    -- apply. Its only ceiling is what the creditnota itself still has open. Capping it at
    -- v_available is the bug this branch exists to not have: on the €850 debit above, v_available
    -- is 850 before anything is booked and the credit would be measured against it for no reason.
    v_applied := LEAST(GREATEST(coalesce(p_amount, 0), 0), v_open);
  END IF;

  IF v_applied <= v_eps THEN
    RAISE EXCEPTION '[BETAALPLAN] nothing left to allocate to this invoice' USING ERRCODE = '55000';
  END IF;

  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  IF v_is_paid THEN
    UPDATE public.invoices
    SET amount_paid    = v_total,
        status         = 'paid',
        payment_method = 'bank',
        marked_paid_at = now(),
        payment_date   = p_pay_date
    WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices
    SET amount_paid  = v_now_paid,
        payment_date = coalesce(payment_date, p_pay_date)
    WHERE id = p_invoice_id;
  END IF;

  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  -- ── THE LINE IS ONLY FINISHED WHEN IT IS SPENT ──
  -- This is the whole difference from apply_bank_payment, and the reason this function exists.
  -- A line with money left stays 'pending' so the next invoice of the same plan can still reach
  -- it; only a line spent to the cent becomes 'matched'.
  --
  -- [CREDITNOTA] Signed here too, and this is the half that decides whether the batch survives.
  -- Booking a €150 credit must make the line's remainder GO UP (850 → 1.000), so the €1.000
  -- invoice that follows it can be settled in full. Added as a magnitude it went down to 700, the
  -- invoice was capped to 700, and a batch describing a perfectly ordinary supplier payment came
  -- out wrong in three places at once.
  v_line_rest := v_tx_amount - (v_elsewhere + v_sign * v_applied);
  IF v_line_rest <= v_eps THEN
    UPDATE public.bank_transactions
    SET status = 'matched', invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  ELSE
    UPDATE public.bank_transactions
    SET invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid,
                      (v_line_rest <= v_eps), GREATEST(0, v_line_rest);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_bank_payment(uuid, uuid, uuid, date)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_bank_payment(uuid, uuid, uuid, numeric, date) TO authenticated, service_role;

-- ── STATE CHECK ─────────────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('apply_bank_payment','confirm_bank_payment','allocate_bank_payment')
--    AND p.prosrc LIKE '%[NOOIT-BETAALBAAR]%';                                          → 3
-- SELECT count(*) FROM public.invoices i
--   JOIN public.bank_tx_invoices l ON l.invoice_id = i.id
--  WHERE i.status IN ('draft','archived','processing');                                 → 0
