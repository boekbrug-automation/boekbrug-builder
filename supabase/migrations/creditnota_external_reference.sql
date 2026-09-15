-- supabase/migrations/creditnota_external_reference.sql
-- [CREDITNOTA-EXTERN] The invoice a STANDALONE creditnota corrects — one issued outside BoekBrug.
--
-- WHY
-- Art. 219 Richtlijn 2006/112/EG (art. 35 Wet OB): a document that amends an earlier invoice is
-- only equated with an invoice when it "refers specifically and unambiguously to the initial
-- invoice". A creditnota made from an invoice in this app carries that reference through
-- invoices.original_invoice_id, and the PDF and the e-factuur print the original's number and
-- date from it. A creditnota for an invoice issued OUTSIDE BoekBrug — the case the create screen
-- exists for — had nowhere to hold that reference, so every such document went out naming only
-- itself: formally deficient, and the owner's btw correction without its documentary basis.
--
-- Two columns, only meaningful on invoice_type = 'creditnota' with original_invoice_id IS NULL:
-- the number as the owner reads it off the paper, and the date that makes it unambiguous when a
-- number was ever reused across years. Free text for the number: it is another system's number.
--
-- Additive and nullable. The app reads them off the row it already selects, writes them in their
-- own best-effort step, and refuses to issue a standalone creditnota without the number only on
-- an installation where the column exists — so a database behind on this file keeps issuing.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credited_invoice_number text
  CHECK (credited_invoice_number IS NULL OR length(btrim(credited_invoice_number)) > 0);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credited_invoice_date date;

COMMENT ON COLUMN public.invoices.credited_invoice_number IS
  '[CREDITNOTA-EXTERN] Nummer van de factuur die deze losse creditnota corrigeert (factuur buiten BoekBrug). Leeg bij een creditnota met original_invoice_id.';
COMMENT ON COLUMN public.invoices.credited_invoice_date IS
  '[CREDITNOTA-EXTERN] Datum van die factuur — maakt de verwijzing ondubbelzinnig (art. 219 btw-richtlijn).';
