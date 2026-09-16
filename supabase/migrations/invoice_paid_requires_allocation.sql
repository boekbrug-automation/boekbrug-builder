-- =====================================================================
-- [BETAALD-GEDEKT] An invoice enters 'paid' only when an allocation backs it.
-- BoekBrug · September 2026
-- =====================================================================
-- THE INVARIANT, AND WHY IT IS THE ONE BEING PROTECTED.
--
-- `invoices` grants `authenticated` UPDATE on all 73 of its columns, and none of its eight
-- triggers reads bank_tx_invoices. So a logged-in session could write status='paid' on its own
-- invoice with no money behind it at all. Measured on production, rollback-only: it wrote
-- status='paid' with amount_paid=999999 and zero allocations, in both directions.
--
-- That is not cosmetic. The kasstelsel BTW engine admits an invoice to the settled set on the
-- invoice row ALONE — kas-payment-events-fetch.ts:125 reads `isSettled(i) || linkedIds.has(i.id)`,
-- so the allocation table is an OR-branch and not a requirement, and paidMagnitude then falls back
-- to the full header. Traced through the real engine: one forged row put EUR 1.000 omzet and
-- EUR 210 BTW into Q2, with undatedPaidCount = 0, so nothing warned.
--
-- And the existing money audit does not reliably catch it. findMoneyViolations flags
-- status='paid' with amount_paid=0 (status_paid_but_open) and an absurd amount (overpaid), but
-- reports NOTHING for status='paid' with amount_paid = the invoice total — which is exactly the
-- shape a forgery would take. That audit also runs on no cron; only opening GeldPaneel triggers it.
--
-- WHY NOT DISCRIMINATE ON THE CALLER. Measured on production: inside a SECURITY DEFINER function
-- current_user becomes `postgres`, but auth.uid() is UNCHANGED — it is still the session's uid,
-- because the payment doors are called BY the session. So the [BOEKHOUDER-DEUR] pattern (refuse
-- when auth.uid() is non-NULL) cannot transfer here. current_user COULD discriminate, but the two
-- compensating rollbacks in /api/bank/unlink and /api/bank/delete-statement restore 'paid' on the
-- SESSION client, so a caller-identity rule would break them and would need an application change
-- sequenced first. The invariant needs neither.
--
-- WHY DEFERRED, AND THIS IS LOAD-BEARING. apply_bank_payment updates the invoice BEFORE it inserts
-- the allocation row, inside one transaction. An immediate check would refuse a legitimate booking
-- that is perfectly valid by the time the transaction completes. DEFERRABLE INITIALLY DEFERRED
-- moves the question to COMMIT, which is where the invariant is actually stated.
--
-- Consequence worth knowing before reading a future failure: a deferred constraint is raised at
-- COMMIT and cannot be caught by a per-statement handler. It aborts the whole transaction.
--
-- PROVEN BEFORE THIS FILE WAS WRITTEN. Every legitimate path that produces 'paid' was executed on
-- scratch with this exact definition armed, one transaction each:
--   confirm_bank_payment · apply_bank_payment · allocate_bank_payment · book_bank_batch ·
--   apply_manual_payment · move_invoice_payment            -> all PASS
--   both compensating rollbacks (links still present)      -> PASS
--   a forged raw session write                             -> BLOCKED
--   the two-transaction pattern (paid committed alone)     -> BLOCKED
-- and the narrow scope was proven too: an unrelated column on a paid invoice does not fire, and
-- leaving 'paid' does not fire.
--
-- WHAT THIS IS NOT. Not a paid-state integrity system. It protects ONE invariant at ONE boundary:
-- ENTRY into 'paid'. It does not promise the allocation stays there afterwards — an invoice that
-- later loses its links is outside this rule, deliberately, because that is not what was measured.
-- [ALLOCATIE-DEUR] already made bank_tx_invoices read-only to a session, which reduces that
-- exposure without closing it. Do not describe this trigger as a perpetual guarantee.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_paid_is_backed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.status = 'paid'
          AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid')) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bank_tx_invoices l
    WHERE l.invoice_id = NEW.id
      AND (l.user_id = NEW.sender_id OR l.user_id = NEW.receiver_id)
  ) THEN
    RAISE EXCEPTION '[BETAALD-GEDEKT] invoice % became paid with no allocation backing it', NEW.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS assert_paid_is_backed ON public.invoices;
CREATE CONSTRAINT TRIGGER assert_paid_is_backed
  AFTER INSERT OR UPDATE OF status ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_paid_is_backed();

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
--   SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger
--    WHERE tgrelid='public.invoices'::regclass AND tgname='assert_paid_is_backed';
--     -> assert_paid_is_backed | t | t
--
--   SELECT count(*) FROM public.invoices i WHERE i.status='paid'
--     AND NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices l WHERE l.invoice_id=i.id
--                      AND (l.user_id=i.sender_id OR l.user_id=i.receiver_id));
--     -> 0        (a CONSTRAINT TRIGGER does not validate existing rows; this is informational)
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
--   DROP TRIGGER assert_paid_is_backed ON public.invoices;
