-- supabase/migrations/acting_for_hardening.sql
-- [ACTING-FOR] Twee dingen die company_members_sales_role.sql aan de code overliet, en die in het
-- schema horen. Additief en idempotent; er verandert niets aan wat er al werkt.
--
-- ── 1. HET UITNODIGINGSTOKEN STOND ONVERSLEUTELD IN DE TABEL ────────────────────────────────
--
-- `token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE` is precies de sleutel die in de mail
-- gaat. Wie de tabel kan lezen — een back-up, een export, een read-only rol, een tweede paar ogen
-- in de Supabase-console — heeft daarmee werkende uitnodigingslinks naar elk bedrijf dat er een
-- open heeft staan. En het token is de helft van de toegang: de andere helft is het e-mailadres,
-- dat er in dezelfde rij naast staat.
--
-- Dus: alleen de HASH wordt bewaard. De link draagt het geheim, de tabel draagt het bewijs. Wie de
-- tabel leest kan een link niet meer namaken, en wie een link heeft kan hem nog steeds gebruiken.
--
-- DIT IS HET GOEDKOOPSTE MOMENT DAT ER OOIT VOOR IS. Er staan nul uitnodigingen in productie, dus
-- er is niets te migreren en niemand raakt een lopende link kwijt. Over een jaar was dit een
-- keuze geweest tussen "iedereen opnieuw uitnodigen" en "de kolom maar laten staan".
--
-- ── 2. "ÉÉN MENS, ÉÉN BOEKHOUDING" STOND ALLEEN IN DE ROUTE ─────────────────────────────────
--
-- De accept-route weigert een tweede werkgever, en schrijft er de reden bij op: anders is
-- "namens wie?" opnieuw een gok, want acting_for_owner() doet LIMIT 1 zonder ORDER BY. Maar die
-- controle is een SELECT gevolgd door een INSERT, en de unieke index die er lag gaat over
-- (owner_id, member_id) — dus twee uitnodigingen die tegelijk worden aangenomen passeren allebei
-- de controle en maken samen precies de toestand die de code onmogelijk noemt.
--
-- Een regel die het verschil maakt tussen twee administraties hoort niet in een race te liggen.

BEGIN;

-- ── 1. Token: hash in plaats van geheim ─────────────────────────────────────────────────────
ALTER TABLE public.company_member_invites
  ADD COLUMN IF NOT EXISTS token_hash text;

-- Twee uitnodigingen mogen nooit dezelfde hash dragen; dat zou betekenen dat één link er twee
-- opent. Partieel, zodat de kolom in één migratiestap kan bestaan zonder al gevuld te zijn.
CREATE UNIQUE INDEX IF NOT EXISTS company_member_invites_token_hash_uidx
  ON public.company_member_invites (token_hash)
  WHERE token_hash IS NOT NULL;

-- De ruwe kolom gaat weg. Niet leeggemaakt maar VERWIJDERD: een kolom die niemand meer schrijft
-- maar die er nog staat, is een kolom die de volgende schrijver weer vult — en dan staat het
-- geheim er opnieuw, zonder dat iemand dat besluit heeft genomen.
--
-- Veilig omdat er nul rijen zijn. Zou dit ooit op een database met openstaande uitnodigingen
-- draaien, dan vervallen die uitnodigingen; dat is de bedoelde uitkomst en niet een ongeluk —
-- een link waarvan wij het geheim niet kunnen herleiden hoort niet meer te werken.
ALTER TABLE public.company_member_invites
  DROP COLUMN IF EXISTS token;

COMMENT ON COLUMN public.company_member_invites.token_hash IS
  '[ACTING-FOR] SHA-256 van het uitnodigingsgeheim uit de link. Het geheim zelf wordt nooit bewaard: wie deze tabel leest kan geen link namaken. Het e-mailadres in dezelfde rij is de tweede helft van de toegang — de accept-route eist dat de ingelogde gebruiker het draagt.';

-- ── 2. Eén lopende koppeling per mens ───────────────────────────────────────────────────────
-- Ingetrokken koppelingen tellen niet mee: wie ergens weggaat mag ergens anders beginnen, en de
-- oude rij blijft staan omdat de facturen die hij maakte aan een mens toewijsbaar moeten blijven.
CREATE UNIQUE INDEX IF NOT EXISTS company_members_one_employer_uidx
  ON public.company_members (member_id)
  WHERE revoked_at IS NULL;

COMMENT ON INDEX public.company_members_one_employer_uidx IS
  '[ACTING-FOR] Eén mens handelt namens ten hoogste één bedrijf tegelijk. acting_for_owner() kiest met LIMIT 1 zonder ORDER BY, dus een tweede lopende koppeling maakt "namens wie?" een gok. De accept-route weigert het ook, maar dat is een SELECT vóór een INSERT en dus een race; dit is de regel zelf.';

COMMIT;
