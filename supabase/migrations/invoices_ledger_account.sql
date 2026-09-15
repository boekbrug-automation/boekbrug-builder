-- supabase/migrations/invoices_ledger_account.sql
-- [GROOTBOEK] Which cost account a purchase invoice belongs on.
--
-- The auditfile carries ONE cost account today: 4000 "Kosten", on the RGS GROUP code WBed. Every
-- purchase invoice, whatever it was for, lands on that same line — which is the first thing an
-- accountant notices and the difference between an export they can import and one they re-code by
-- hand. See src/lib/grootboek.ts for the chart and the verified RGS references.
--
-- NULL is the honest default and is what every existing row keeps: it means "nobody has said yet",
-- and the export goes on writing 4000 for those exactly as it does now. It does NOT mean 4000 was
-- chosen — the two have to stay distinguishable, or a screen that asks the owner to confirm cannot
-- tell an unanswered invoice from an answered one.
--
-- Additive, nullable, no backfill and no default: a backfill here would be this migration deciding
-- somebody's bookkeeping, silently, for every invoice they ever imported.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS ledger_account text
  CHECK (ledger_account IS NULL OR ledger_account ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.invoices.ledger_account IS
  '[GROOTBOEK] The cost account this invoice books to (see src/lib/grootboek.ts). Null = not yet decided; the auditfile then writes the 4000 fallback. Never backfilled.';

-- The screen that asks "which of these still needs an account?" reads exactly this shape, and the
-- accountant''s board asks it per owner. Partial, so it costs nothing for the answered rows.
CREATE INDEX IF NOT EXISTS invoices_ledger_todo_idx
  ON public.invoices (receiver_id, invoice_date)
  WHERE direction = 'incoming' AND ledger_account IS NULL;
