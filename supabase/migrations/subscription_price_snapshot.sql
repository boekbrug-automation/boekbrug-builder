-- supabase/migrations/subscription_price_snapshot.sql
-- [PRIJS-MOMENT] Wat dit account betaalt, vastgelegd op het moment dat het werd afgesproken.
--
-- ── HET PROBLEEM DAT ER NOG NIET IS, EN DAAROM NU GRATIS IS ─────────────────────────────────
--
-- De prijs staat op één plek in de code: PLUS_PRICE_EUR in fair-use.ts. Daar komt de prijspagina
-- vandaan, de voorwaarden, en de regel "Prijs" op het factureringsscherm. [PRIJS-KLOPT] zorgt er
-- bovendien voor dat Stripe nooit een ander bedrag incasseert dan wij publiceren: de checkout
-- leest het prijsobject na en weigert bij verschil.
--
-- Maar dat is een controle op het MOMENT VAN KOPEN. Daarna lopen de twee uit elkaar zodra de
-- prijs verandert: Stripe blijft een bestaand abonnement afrekenen tegen het prijsobject waarop
-- het is aangegaan, terwijl elk scherm in deze app het NIEUWE bedrag toont. De ondernemer leest
-- dan € 24,99 op zijn factureringspagina en ziet € 19,99 van zijn rekening gaan — of andersom.
--
-- Nergens in dit schema staat wat er is afgesproken. Er is niets om op terug te vallen, en het
-- is niet af te leiden: uit "de prijs is vandaag X" volgt niet wat hij was toen deze klant tekende.
--
-- DIT IS HET GOEDKOOPSTE MOMENT DAT ER OOIT VOOR IS. Er is nul betalende klant, dus er is niets
-- te herstellen en niets te migreren. Bij de eerste is het een reconstructie uit Stripe-exports;
-- bij de honderdste is het dat honderd keer.
--
-- ── WAT ER NIET WORDT BELOOFD ──────────────────────────────────────────────────────────────
--
-- Dit is een VASTLEGGING, geen bevriezing. §5.5 van de voorwaarden houdt de gewone tariefregeling
-- aan: 30 dagen aankondiging per e-mail en vrij opzeggen vóór de ingangsdatum. Alleen GRENZEN
-- zijn onvervreemdbaar (§5.5.1, zie fair-use-history.ts). Deze kolommen zeggen wat er is
-- afgesproken, niet dat het nooit verandert.
--
-- ── GESCHREVEN DOOR DE WEBHOOK, DOOR NIEMAND ANDERS ────────────────────────────────────────
--
-- Dezelfde deur en hetzelfde slot als de andere abonnementskolommen. Een bedrag dat de browser
-- kan zetten is geen vastlegging maar een invoerveld, en het zou op het scherm net zo betrouwbaar
-- lijken als een echte.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_price_cents integer,
  ADD COLUMN IF NOT EXISTS subscription_price_currency text,
  ADD COLUMN IF NOT EXISTS subscription_priced_at timestamptz;

COMMENT ON COLUMN public.profiles.subscription_price_cents IS
  '[PRIJS-MOMENT] Wat Stripe voor dit abonnement incasseert, in centen, zoals gelezen van het prijsobject bij de laatste webhook. NIET de gepubliceerde prijs: die staat in PLUS_PRICE_EUR en beschrijft het aanbod van vandaag, niet de afspraak van deze klant.';
COMMENT ON COLUMN public.profiles.subscription_priced_at IS
  '[PRIJS-MOMENT] Wanneer dit bedrag voor het laatst bij Stripe is nagelezen. Een oude datum bij een lopend abonnement betekent dat de webhook de prijs niet kon vastleggen — het scherm zegt dan liever niets dan een bedrag dat het niet weet.';

-- Het slot uitgebreid: de drie nieuwe kolommen gaan door dezelfde deur als de rest. Woordelijk
-- hetzelfde als in billing_subscription.sql, met drie regels erbij — de functie wordt in haar
-- geheel herschreven omdat een trigger geen "voeg toe" kent.
CREATE OR REPLACE FUNCTION public.prevent_billing_self_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Uitzondering: service_role / pipeline (auth.uid() = NULL) — de Stripe-webhook.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status)    OR
     (NEW.subscription_plan      IS DISTINCT FROM OLD.subscription_plan)      OR
     (NEW.subscription_stripe_id IS DISTINCT FROM OLD.subscription_stripe_id) OR
     (NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id)     OR
     (NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end)     OR
     -- [PRIJS-MOMENT] Wat er is afgesproken is net zo goed een abonnementsfeit als de status.
     (NEW.subscription_price_cents    IS DISTINCT FROM OLD.subscription_price_cents)    OR
     (NEW.subscription_price_currency IS DISTINCT FROM OLD.subscription_price_currency) OR
     (NEW.subscription_priced_at      IS DISTINCT FROM OLD.subscription_priced_at)
  THEN
    RAISE EXCEPTION
      'Permission denied: subscription fields are set by the Stripe webhook only (profile_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Drie kolommen erbij, en het slot dekt ze. Beide moeten waar zijn.
SELECT count(*) AS has_three_columns FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name IN ('subscription_price_cents', 'subscription_price_currency', 'subscription_priced_at');
SELECT prosrc LIKE '%subscription_price_cents%' AS guard_covers_price
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'prevent_billing_self_grant';
