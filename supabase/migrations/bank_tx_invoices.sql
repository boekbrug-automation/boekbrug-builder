-- [BANK-TX-INVOICES] The payment ↔ invoice link as a first-class, COMPLETE relationship.
--
-- Why: a bank payment can settle SEVERAL invoices (a wholesaler batches a week of deliveries into
-- one debit). The old model stored only ONE representative invoice_id on the transaction, so the
-- other N−1 invoices a batch paid were invisible on the transaction. That under-representation made
-- reversal UNSAFE: to undo a batch you had to re-match by invoice NUMBER, and invoice numbers are
-- not unique (two suppliers both issue "1002"; a sales number can equal a purchase number), so a
-- number-based reversal could un-pay an unrelated invoice — a wrong-number event. It also made an
-- auto-booked payment unreachable to unlink after a page reload.
--
-- This join table records EVERY (transaction, invoice) that a booking paid. Every reversal
-- (unlink, batch-unlink, delete-statement cascade, auto-confirm rollback) then reverses by exact
-- invoice_id — never by number — so it can only ever touch the invoices this payment actually paid.
--
-- ON DELETE CASCADE on both FKs: deleting a transaction or an invoice removes its links
-- automatically (no dangling rows). One row per (transaction, invoice) — idempotent re-booking.

CREATE TABLE IF NOT EXISTS public.bank_tx_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_tx_invoices_unique_pair
  ON public.bank_tx_invoices (transaction_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoices_tx ON public.bank_tx_invoices (transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoices_inv ON public.bank_tx_invoices (invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoices_user ON public.bank_tx_invoices (user_id);

ALTER TABLE public.bank_tx_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_tx_invoices_select_own ON public.bank_tx_invoices;
CREATE POLICY bank_tx_invoices_select_own ON public.bank_tx_invoices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- [ALLOCATIE-DEUR] An INSERT and a DELETE policy stood here, each scoped to `user_id = auth.uid()`.
-- Scoped is not guarded: the INSERT check asked only that the row carry your own user_id, and said
-- nothing about the bank line it hangs on — no budget, no ownership of the transaction or the
-- invoice it names, no lock, no recompute. DELETE was the mirror. Both were reachable from any
-- logged-in session through PostgREST, around every payment door.
--
-- They are gone, here AND in bank_tx_invoices_read_only_policy.sql, so no apply order can bring
-- them back. Measured before removing them: all four TypeScript write sites use the service-role
-- pipeline client and all six SQL writers are SECURITY DEFINER, so not one application write
-- depended on them. The SELECT policy above stays — /dashboard/facturen reads this table from the
-- browser with the owner's own session.

-- Backfill from the existing single-invoice links so already-booked payments are reversible by id
-- too. (A pre-existing BATCH only carried its representative invoice_id, so only that one backfills
-- here — the reversal paths recover the older siblings via a DIRECTION-GUARDED number gap-fill for
-- exactly the reference numbers no id-link covers; every NEW booking records the full set up front,
-- so new batches are 100% id-reversed with no number-collision surface at all.)
INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id)
  SELECT user_id, id, invoice_id
  FROM public.bank_transactions
  WHERE invoice_id IS NOT NULL AND user_id IS NOT NULL
ON CONFLICT (transaction_id, invoice_id) DO NOTHING;
