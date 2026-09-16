-- =====================================================================
-- [ALLOCATIE-DEUR] bank_tx_invoices is READ-ONLY to a logged-in session.
-- BoekBrug · September 2026
-- =====================================================================
-- WHAT WAS OPEN. bank_tx_invoices.sql gave `authenticated` three policies: select_own, insert_own
-- and delete_own, each scoped to `user_id = auth.uid()`. Scoped is not the same as guarded. The
-- INSERT policy checks exactly one thing — that the row you write carries YOUR user_id — and says
-- nothing about the bank line it hangs on:
--
--   · no line budget. A row may claim any amount_applied against any transaction_id, so the signed
--     sum every payment door computes can be pushed past the line's own amount with one POST.
--   · no ownership of the two things it names. transaction_id and invoice_id are FK-checked to
--     EXIST, not to belong to the caller.
--   · no lock, no recompute. invoices.amount_paid is derived from this table by
--     recompute_invoice_amount_paid; a row written beside it simply makes the derivation wrong.
--
-- DELETE is the mirror: removing a link silently un-backs bank_transactions.invoice_id and leaves
-- amount_paid standing on money no row records any more.
--
-- Both are reachable from any logged-in session through PostgREST — the table is in the exposed
-- `public` schema and `authenticated` holds the default Supabase table grants.
--
-- WHY CLOSING THEM COSTS NOTHING. Measured over the whole of src/ at main: the table has exactly
-- four write sites in TypeScript — recordPaymentLinks and clearPaymentLinks in bank-tx-links.ts,
-- and the two in /api/invoice/pay-toggle — and every one of them runs on the service-role
-- `pipeline` client, which bypasses RLS entirely. The six SQL writers (apply_bank_payment,
-- confirm_bank_payment, allocate_bank_payment, book_bank_batch, apply_manual_payment,
-- move_invoice_payment) are SECURITY DEFINER and run as the owner. NOT ONE application write uses
-- the session client, so no policy is holding any of them up.
--
-- READS DO use the session, and they keep working. /dashboard/facturen reads this table from the
-- BROWSER with the owner's own session (collectPaymentEvidence, called with the browser client),
-- and several server components read it the same way. That is precisely why select_own STAYS.
--
-- WHAT THIS IS NOT. Not a trigger, not a CHECK on the aggregate sum, not an RLS redesign, and not
-- a new door. The doors already exist and already carry the budget rules; this removes the way
-- around them. UPDATE was never granted a policy at all — that is why move_invoice_payment has to
-- be SECURITY DEFINER — so after this the table's shape is: read your own, write only through a
-- door.
-- =====================================================================

BEGIN;

-- The read stays exactly as it was. Re-asserted rather than assumed, so this file states the whole
-- policy set it leaves behind instead of only the half it removes.
DROP POLICY IF EXISTS bank_tx_invoices_select_own ON public.bank_tx_invoices;
CREATE POLICY bank_tx_invoices_select_own ON public.bank_tx_invoices
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- And the two write doors that bypassed every payment door are gone.
DROP POLICY IF EXISTS bank_tx_invoices_insert_own ON public.bank_tx_invoices;
DROP POLICY IF EXISTS bank_tx_invoices_delete_own ON public.bank_tx_invoices;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
-- Exactly one policy must remain, and it must be the SELECT one:
--
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.bank_tx_invoices'::regclass;
--     → bank_tx_invoices_select_own | r      (one row)
