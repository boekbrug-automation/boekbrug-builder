-- paid_invoice_money_frozen.sql
-- [VAST-IN-DE-DB] A PAID outgoing invoice's money identity is frozen at the database.
--
-- ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
-- The app has said "een verstuurde factuur pas je niet meer aan — een fout corrigeer je met een
-- creditnota" since it had invoices, and isInvoiceEditable / sentEditBlockers enforce it on every
-- route. But invoices_zzp_update is
--
--     FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid())
--
-- with no status test and no column list. So the owner's OWN session token, used against PostgREST
-- outside every route in this app, could rewrite the amount, the btw, the date or the number of an
-- invoice their customer is already holding — with no audit row, because the audit rows are written
-- by the correction flow the write went around.
--
-- Two triggers already sit on this table and neither catches it: prevent_accountant_amount_changes
-- guards the ACCOUNTANT and exempts the owner, and invoices_verwerkt_guard only fires once the
-- accountant has marked the invoice verwerkt. The owner's own path on their own paid invoice was
-- the hole between them.
--
-- ── WHY *PAID* AND NOT EVERY SENT INVOICE ───────────────────────────────────
-- Because editing a sent-but-unpaid invoice is a DELIBERATE, guarded feature, not an oversight:
-- /api/invoice/[id] allows it under a compare-and-swap that requires the number to be unchanged,
-- no payment to have landed, and the accountant not to have marked it verwerkt (sentEditBlockers).
-- Freezing every non-draft invoice here would break that on purpose-built behaviour.
--
-- What the app treats as absolute is the case where MONEY HAS MOVED against the document. That is
-- the line this trigger draws, and it is the same line sentEditBlockers draws — moved one layer
-- down, where a request that never passes through a route cannot step over it.
--
-- ── WHY OUTGOING ONLY ───────────────────────────────────────────────────────
-- An outgoing invoice is a document the CUSTOMER holds a copy of; ours may never silently diverge
-- from theirs, and the Belastingdienst expects the invoice to be kept as it was sent. An INCOMING
-- invoice is a document we received and had a model read: correcting its btw split or its amount
-- is exactly what [SPLIT-CORRECTIE] and [GEGROND-STAAT-IN] exist for, and stays possible.
--
-- ── WHAT MAY STILL CHANGE ───────────────────────────────────────────────────
-- Everything that is ABOUT the payment rather than the document: status (a storno puts a paid
-- invoice back to open — see [STORNO]), amount_paid, the payment fields, document_id, the
-- accountant's own accountant_status, pay_token, and the credited_invoice_* back-references.
-- Freezing those would break booking, unbooking and reversal, which are not rewrites of the
-- document but records of what happened to it.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). service_role (auth.uid() IS NULL)
-- bypasses, the same convention the two existing guards use: pipeline paths re-assert their own
-- preconditions, and bank_confirm_atomic / apply_manual_payment must keep working.

CREATE OR REPLACE FUNCTION public.prevent_paid_invoice_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Exception 1: service_role / pipeline. Same as the sibling guards on this table.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only an OUTGOING invoice against which money has moved. A partial payment counts: the customer
  -- has paid against THESE amounts, so these amounts are what the payment refers to.
  IF OLD.direction IS DISTINCT FROM 'outgoing' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.amount_paid, 0) <= 0 AND OLD.status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;

  -- The document's own identity: what it says, who it is between, and what it is.
  IF (NEW.invoice_number  IS DISTINCT FROM OLD.invoice_number) OR
     (NEW.invoice_date    IS DISTINCT FROM OLD.invoice_date) OR
     (NEW.total_ex_btw    IS DISTINCT FROM OLD.total_ex_btw) OR
     (NEW.btw_amount      IS DISTINCT FROM OLD.btw_amount) OR
     (NEW.total_inc_btw   IS DISTINCT FROM OLD.total_inc_btw) OR
     (NEW.direction       IS DISTINCT FROM OLD.direction) OR
     (NEW.sender_id       IS DISTINCT FROM OLD.sender_id) OR
     (NEW.receiver_id     IS DISTINCT FROM OLD.receiver_id) OR
     (NEW.invoice_type    IS DISTINCT FROM OLD.invoice_type)
  THEN
    RAISE EXCEPTION
      'Factuur % is betaald — een betaalde factuur pas je niet meer aan, een fout corrigeer je met een creditnota',
      COALESCE(OLD.invoice_number, OLD.id::text);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_paid_money_frozen ON public.invoices;
CREATE TRIGGER invoices_paid_money_frozen
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_invoice_rewrite();

-- [MIGRATIE-STAND] State check — run this to see whether the trigger is live:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'invoices_paid_money_frozen' AND NOT tgisinternal;
