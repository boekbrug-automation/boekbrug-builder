-- [BOEKHOUDER-DEUR] Who said 'verwerkt', and one door that may say it.
-- BoekBrug · September 2026
--
-- WHAT WAS MEASURED, AND WHY THIS IS TWO THINGS AND NOT ONE
--
-- invoices.accountant_status = 'verwerkt' is the app's hardest money refusal: while it stands,
-- eleven SQL guards and eighteen TypeScript sites refuse to move the invoice's paid state. The
-- measurement found three things about the column that carries it:
--
--   1. NOBODY is recorded as having asserted it. The column has no actor, and 'verwerkt' is always
--      a human act — zero SQL writers, zero service-role writers, no trigger, no RPC, no cron.
--   2. NOTHING decides who may write it. prevent_verwerkt_invoice_changes freezes 23 other columns
--      while the lock stands and deliberately not this one; prevent_accountant_amount_changes
--      protects 19 others and exempts the owner outright; RLS admits the owner, the receiver and
--      every linked accountant of a shared invoice — and PostgreSQL RLS cannot be scoped to a
--      column, so admitting any UPDATE admits this one.
--   3. The only writer of 'verwerkt' was a direct UPDATE from the browser, with no route, no
--      permission check and no audit row.
--
-- So: an attribution column, and a door. Both minimal.
--
-- WHAT THIS DOES NOT DO — each of these was considered and refused
--
--   · It does NOT freeze accountant_status. Undo is a LEGAL operation here and the repo says so in
--     two places (database.sql's note on the freeze, and the [VAST-IN-DE-DB] gate, which asserts
--     this column stays writable). The rule enforced below is "only the door may change it", never
--     "nobody may change it once set".
--   · It adds NO timestamp. The write contract is status + actor; nothing in it needs a third
--     column, and updated_at already moves on every write.
--   · It touches accountant_subject_status not at all. No mirror, no sync, no shared key.
--
-- THE DOOR, IN ONE SENTENCE
--
-- auth.uid() is NULL for the service-role client and non-NULL for every browser and every
-- session-client route. The server door writes with service-role; therefore a session write of
-- either column is refused, and the door is the only way in.
--
-- THE ERROR TEXT IS CHOSEN, NOT DESCRIBED. Fourteen callers in this app triage money refusals by
-- substring, and 'verwerkt' is the substring eight of them look for. A refusal from this trigger
-- containing that word would be read as "the accountant has locked this invoice" — a different
-- fact with a dedicated dialog. So the message says 'boekhouderstand' and never the lock's name.
--
-- APPLY: run in the Supabase SQL editor. Deletes nothing. Idempotent.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS accountant_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.accountant_id IS
  'The accountant who asserted accountant_status = ''verwerkt'', derived from the authenticated '
  'session by the server door — never accepted from a client. NULL whenever the status is not '
  '''verwerkt''. Attribution for this one act; NOT a delegation identity.';

CREATE OR REPLACE FUNCTION public.accountant_status_door_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The door writes with the service-role client, where auth.uid() is NULL. Everything else —
  -- every browser, every session-client route, every PostgREST call with the anon or a user key —
  -- has a uid and is refused.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.accountant_status IS NOT NULL OR NEW.accountant_id IS NOT NULL THEN
      RAISE EXCEPTION
        '[BOEKHOUDER-DEUR] de boekhouderstand wordt alleen via de server gezet, niet bij het aanmaken'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.accountant_status IS DISTINCT FROM OLD.accountant_status)
     OR (NEW.accountant_id IS DISTINCT FROM OLD.accountant_id) THEN
    RAISE EXCEPTION
      '[BOEKHOUDER-DEUR] de boekhouderstand wordt alleen via de server gezet'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_accountant_door ON public.invoices;
CREATE TRIGGER invoices_accountant_door
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.accountant_status_door_only();

-- ── STATE CHECK ─────────────────────────────────────────────────────────────────────────
-- SELECT to_regclass('public.invoices') IS NOT NULL
--    AND EXISTS (SELECT 1 FROM information_schema.columns
--                 WHERE table_schema='public' AND table_name='invoices' AND column_name='accountant_id')
--    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoices_accountant_door');   → true
-- SELECT count(*) FROM public.invoices
--  WHERE accountant_id IS NOT NULL AND accountant_status IS DISTINCT FROM 'verwerkt';   → 0
