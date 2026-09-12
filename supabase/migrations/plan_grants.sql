-- supabase/migrations/plan_grants.sql
-- [TOEKENNING] Why an account has more than the free plan — as a row, with a reason and an end.
--
-- ── WHAT THIS REPLACES, BEFORE IT EXISTED ───────────────────────────────────
-- The first version of this was one column, profiles.plus_until. It worked and it was wrong: the
-- next three things the business already wants — an office piloting twenty clients for six months,
-- a customer kept on an old price, a support extension of somebody's first months — are all the
-- same sentence ("this account has X until Y, because Z, granted by W") and a bare timestamp can
-- hold only the first half of it. Two of those would have become two more columns, and the answer
-- to "why does this account have Plus" would have been spread across three places, none of which
-- remembers who decided.
--
-- So: one row per grant. What, from when, until when, why, and who.
--
-- ── THE WELCOME PERIOD IS THE FIRST GRANT, NOT A SPECIAL CASE ───────────────
-- Every new account gets 90 days of Plus, written by a trigger on profiles rather than by the
-- signup route — because there is more than one way a profile comes into existence (register, an
-- accountant's invitation, a team invite, and whatever is written next year), and a grant living
-- in one path is a grant the other paths silently skip. The person who finds out is the owner who
-- got 90 days less than his neighbour.
--
-- ── WHAT A GRANT IS NOT ─────────────────────────────────────────────────────
-- It is not a trial that ends in a charge. Nothing here reads a card and nothing schedules one;
-- billing_subscription.sql still has no trial_ends_at, and "nooit automatisch afgeschreven" in
-- belofte.ts stays a contractual sentence. When a grant ends the account is on the free plan, with
-- everything still readable, searchable and exportable (ALWAYS_FREE in fair-use.ts).
--
-- It is also not an accounting record. Nothing in this table can move a euro, a btw figure or a
-- journal line: it decides CEILINGS. That separation is the whole point of the commercial layer —
-- commercial state may be flexible, accounting state must stay authoritative and traceable.
--
-- ── WHO MAY WRITE ONE ───────────────────────────────────────────────────────
-- Nobody, from the app. There is no INSERT, UPDATE or DELETE policy on this table, so under RLS an
-- owner cannot grant himself Plus and an accountant cannot grant it to a client. Writes come from
-- the trigger (SECURITY DEFINER) and from the service role. An account may READ its own grants,
-- because "why do I have this until March" is a fair question to be able to answer on screen.

CREATE TABLE IF NOT EXISTS public.plan_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- What the account gets. Only 'plus' exists today; the column is text with a CHECK so a second
  -- tier is a migration and not a schema redesign.
  plan        text        NOT NULL CHECK (plan IN ('plus')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  -- NULL means open-ended. Deliberately allowed: a founding-partner arrangement has no end date,
  -- and encoding "forever" as the year 9999 is how a date arithmetic bug becomes a billing bug.
  expires_at  timestamptz,
  -- Why, in words a human will read back in a year. Not an enum: the reasons are commercial and
  -- they will not stop being invented.
  reason      text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  -- Who decided. NULL = the system (the welcome grant below). An admin's uuid otherwise.
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A grant is withdrawn by ending it, never by deleting the row: the reason it existed is part of
  -- the record. revoked_at is when someone stopped it early; expires_at is when it was always
  -- going to stop.
  revoked_at  timestamptz,
  revoked_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT plan_grants_ends_after_it_starts CHECK (expires_at IS NULL OR expires_at > starts_at)
);

-- The only query this table is asked in the hot path: "what is active for this user, right now".
CREATE INDEX IF NOT EXISTS plan_grants_active_idx
  ON public.plan_grants (user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.plan_grants ENABLE ROW LEVEL SECURITY;

-- Read your own. No write policy of any kind — see the header.
DROP POLICY IF EXISTS plan_grants_own_read ON public.plan_grants;
CREATE POLICY plan_grants_own_read ON public.plan_grants
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- ── The welcome grant ───────────────────────────────────────────────────────
-- SECURITY DEFINER because the table has no INSERT policy: the trigger writes what no session may.
CREATE OR REPLACE FUNCTION public.grant_welcome_plus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The accountant portal is already free without limits; a welcome grant there would be a row
  -- that means nothing and an expiry date that scares someone for no reason.
  IF NEW.role = 'accountant' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.plan_grants (user_id, plan, starts_at, expires_at, reason, created_by)
  VALUES (NEW.id, 'plus', now(), now() + interval '90 days', 'Welkomstperiode: eerste 90 dagen', NULL);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_welcome_plus ON public.profiles;
CREATE TRIGGER profiles_welcome_plus
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_welcome_plus();

-- ── Existing accounts ───────────────────────────────────────────────────────
-- The remainder of their OWN first 90 days, not a fresh 90 from today. For an account from last
-- week that is what it would have had; for one from last spring the date is already past, so
-- nothing changes for them. Handing an old account three new months would be a gift with a cliff:
-- something appears that was never there and vanishes again in March.
INSERT INTO public.plan_grants (user_id, plan, starts_at, expires_at, reason, created_by)
SELECT p.id, 'plus', p.created_at, p.created_at + interval '90 days',
       'Welkomstperiode: eerste 90 dagen', NULL
  FROM public.profiles p
 WHERE p.created_at IS NOT NULL
   AND COALESCE(p.role, 'zzper') <> 'accountant'
   AND NOT EXISTS (
     SELECT 1 FROM public.plan_grants g
      WHERE g.user_id = p.id AND g.reason = 'Welkomstperiode: eerste 90 dagen'
   );

COMMENT ON TABLE public.plan_grants IS
  '[TOEKENNING] Waarom een account meer heeft dan het gratis plan: wat, vanaf wanneer, tot wanneer, waarom en door wie. Geen schrijfbeleid — alleen de trigger en de service role schrijven; een gebruiker leest alleen zijn eigen rijen. Bepaalt GRENZEN, nooit een bedrag: niets hier kan een euro, een btw-cijfer of een boekingsregel verplaatsen.';

COMMENT ON FUNCTION public.grant_welcome_plus() IS
  '[WELKOM-90] Elke nieuwe niet-boekhouder krijgt 90 dagen Plus. Staat op de tabel en niet in een route, omdat een profielrij langs meer dan één pad ontstaat en een toekenning in één pad de andere paden overslaat.';
