-- supabase/migrations/ontvangen_fair_use_per_document.sql
-- [ONTVANGEN] Eén ontvangen document kost hoogstens ÉÉN keer een aiDocument — ook als wij crashen.
--
-- WAAROM catch/finally NIET GENOEG IS
-- De eerlijk-gebruikpoort reserveert vóór de modelaanroep en geeft terug via release(). Dat dekt
-- elke fout die we KUNNEN vangen. Het dekt deze niet:
--
--     fair_use_consume slaagt   → teller +1
--     het proces sterft         → geen catch, geen finally, geen release
--     de drain probeert opnieuw → teller +1
--
-- Geen enkele foutafhandeling ziet dat. Onder de synchrone deur was het begrensd: de eigenaar zag
-- een fout en koos zelf of hij het nog eens deed. Na receive-first probeert een achtergrondpas het
-- uit zichzelf, dus een storingslus kost de eigenaar één document per poging — voor ONZE fout, met
-- niemand die meekijkt.
--
-- Dus moet de reservering zelf duurzaam zijn, en aan het DOCUMENT hangen.

alter table public.documents
  add column if not exists intake_ai_counted_period text;

comment on column public.documents.intake_ai_counted_period is
  '[ONTVANGEN] De maand waarin dit document al een aiDocument heeft gekost (YYYY-MM, UTC — dezelfde sleutel als usage_counters.period). Gevuld = betaald, dus een herstart leest opnieuw zonder nogmaals te tellen. Null = nog niet geteld.';

-- WAAROM DE PERIODE WORDT BEWAARD EN NIET ALLEEN EEN VLAGGETJE
-- 30 september: gereserveerd, proces crasht. 1 oktober: opnieuw. Zonder de OORSPRONKELIJKE periode
-- zou een teruggave in oktober afboeken van een teller die in september is opgehoogd — en dan
-- klopt geen van beide maanden meer. De periode reist dus mee met het document.

-- Zoeken op "wat heeft deze eigenaar deze maand al geteld" blijft goedkoop.
create index if not exists idx_documents_ai_counted
  on public.documents (user_id, intake_ai_counted_period)
  where intake_ai_counted_period is not null;

-- ── DE RESERVERING, ATOMAIR EN DOCUMENT-BEWUST ──────────────────────────────────────────────

-- WAAROM HIER GEEN p_metric STAAT
-- De markering op het document is ÉÉN waarde: "dit document heeft zijn aiDocument betaald". Zij kan
-- niet uitdrukken welke teller er betaald is. Een generieke metric-parameter zou dus een val zijn:
-- reserveer metric A → markering gevuld; roep later metric B aan → de functie ziet de markering,
-- meldt replayed, en B wordt NOOIT geteld. Geen fout, geen log, een teller die stilstaat.
-- Bouw geen algemeenheid die het schema niet kan dragen: deze functie gaat over aiDocuments, en
-- dat staat hieronder één keer uitgeschreven in plaats van als argument binnen te komen.
CREATE OR REPLACE FUNCTION public.fair_use_consume_for_document(
  p_user_id     uuid,
  p_document_id uuid,
  p_period      text,
  p_limit       integer
)
RETURNS TABLE (allowed boolean, used integer, remaining integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metric  constant text := 'aiDocuments';
  v_counted text;
  v_current integer;
  v_new     integer;
BEGIN
  -- Het document is de sleutel EN de eigendomscontrole. RLS staat uit op deze lijn, dus de
  -- predicaat hieronder is de enige grens die er is. FOR UPDATE serialiseert twee workers die
  -- tegelijk aan hetzelfde document beginnen: de tweede wacht en ziet dan de markering staan.
  SELECT d.intake_ai_counted_period INTO v_counted
    FROM public.documents d
   WHERE d.id = p_document_id AND d.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Geen document, of niet van deze eigenaar. Wij tellen niets en beweren niets.
    RAISE EXCEPTION '[ONTVANGEN] document not found / not owned' USING ERRCODE = '55000';
  END IF;

  -- AL BETAALD. Dit is de hele reden dat deze functie bestaat: een herstart na een crash leest
  -- opnieuw, maar rekent niet opnieuw af.
  IF v_counted IS NOT NULL THEN
    SELECT c.count INTO v_current
      FROM public.usage_counters c
     WHERE c.user_id = p_user_id AND c.period = v_counted AND c.metric = v_metric;
    RETURN QUERY SELECT true, COALESCE(v_current, 0),
                        CASE WHEN p_limit > 0 THEN GREATEST(0, p_limit - COALESCE(v_current, 0)) ELSE -1 END,
                        true;
    RETURN;
  END IF;

  -- Nog niet geteld: dezelfde rekensom als fair_use_consume, in dezelfde vorm.
  INSERT INTO public.usage_counters (user_id, period, metric, count)
  VALUES (p_user_id, p_period, v_metric, 0)
  ON CONFLICT (user_id, period, metric) DO NOTHING;

  SELECT c.count INTO v_current
    FROM public.usage_counters c
   WHERE c.user_id = p_user_id AND c.period = p_period AND c.metric = v_metric
   FOR UPDATE;

  v_new := v_current + 1;

  -- Boven de grens: NIET ophogen, en GEEN markering zetten. Er is niets gereserveerd, dus er valt
  -- later ook niets terug te geven — het document gaat naar wacht_op_limiet.
  IF p_limit > 0 AND v_new > p_limit THEN
    RETURN QUERY SELECT false, v_current, GREATEST(0, p_limit - v_current), false;
    RETURN;
  END IF;

  UPDATE public.usage_counters c
     SET count = v_new, updated_at = now()
   WHERE c.user_id = p_user_id AND c.period = p_period AND c.metric = v_metric;

  -- De markering en de ophoging staan in DEZELFDE transactie. Precies dat maakt de crash
  -- onschadelijk: er bestaat geen moment waarop de teller is opgehoogd en het document dat niet weet.
  UPDATE public.documents d
     SET intake_ai_counted_period = p_period
   WHERE d.id = p_document_id AND d.user_id = p_user_id;

  RETURN QUERY SELECT true, v_new,
                      CASE WHEN p_limit > 0 THEN GREATEST(0, p_limit - v_new) ELSE -1 END,
                      false;
END;
$$;

COMMENT ON FUNCTION public.fair_use_consume_for_document IS
  '[ONTVANGEN] Reserveer hoogstens één aiDocument per document, atomair met de markering erop. Een tweede aanroep voor hetzelfde document geeft allowed=true, replayed=true en hoogt niets op.';

-- ── DE TERUGGAVE, OP DE BEWAARDE PERIODE ────────────────────────────────────────────────────

-- Zelfde reden als hierboven: één markering, één teller, geen parameter om hem mis te wijzen.
CREATE OR REPLACE FUNCTION public.fair_use_release_for_document(
  p_user_id     uuid,
  p_document_id uuid
)
RETURNS TABLE (released boolean, period text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metric  constant text := 'aiDocuments';
  v_counted text;
BEGIN
  SELECT d.intake_ai_counted_period INTO v_counted
    FROM public.documents d
   WHERE d.id = p_document_id AND d.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND OR v_counted IS NULL THEN
    -- Niets gereserveerd, of niet van ons. Teruggeven wat er niet is, is hoe een dubbele
    -- teruggave gratis tegoed wordt — dus doen we niets en zeggen we dat.
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  -- Af van de maand waarin het IS opgehoogd, niet van de maand waarin wij nu toevallig zijn.
  UPDATE public.usage_counters c
     SET count = GREATEST(0, c.count - 1), updated_at = now()
   WHERE c.user_id = p_user_id AND c.period = v_counted AND c.metric = v_metric;

  UPDATE public.documents d
     SET intake_ai_counted_period = NULL
   WHERE d.id = p_document_id AND d.user_id = p_user_id;

  RETURN QUERY SELECT true, v_counted;
END;
$$;

COMMENT ON FUNCTION public.fair_use_release_for_document IS
  '[ONTVANGEN] Geef de reservering van dit document terug, op de BEWAARDE periode. Idempotent: een tweede aanroep vindt geen markering meer en geeft niets terug.';

-- ── WIE MAG DIT AANROEPEN ───────────────────────────────────────────────────────────────────
--
-- PostgreSQL geeft EXECUTE op een nieuwe functie standaard aan PUBLIC. Een GRANT aan service_role
-- haalt dat er NIET af — hij zet er alleen iets naast. En deze twee zijn SECURITY DEFINER en nemen
-- p_user_id als argument: wie ze mag aanroepen, mag namens iedereen tellen en teruggeven.
--
-- Dus eerst intrekken, dan geven. Dezelfde volgorde als fair_use_usage.sql, en om dezelfde reden:
-- dit zijn interne serverprimitieven, geen browser-API. anon en authenticated horen er niet bij te
-- kunnen, en een seam-test bewijst dat per rol in plaats van het aan te nemen.
--
-- FROM PUBLIC IS NIET GENOEG OP SUPABASE. Dit stond hier eerst alleen als `FROM PUBLIC`, en dat is
-- op een kale PostgreSQL correct: daar is het standaardrecht van anon en authenticated geërfd via
-- PUBLIC. Supabase draait echter op elk project `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated, service_role` — een DIRECTE toekenning, die een
-- REVOKE van PUBLIC niet aanraakt. In productie bleven beide functies daardoor aanroepbaar vanaf
-- elke ingelogde browser via PostgREST, en fair_use_release_for_document verlaagt usage_counters:
-- wie hem op zijn eigen document aanriep, zette zijn eigen maandverbruik terug op nul.
--
-- Het te bewijzen recht is dus niet "PUBLIC heeft niets" maar de hele matrix:
--
--     PUBLIC        ✗
--     anon          ✗
--     authenticated ✗
--     service_role  ✓
--
-- tests/sql/fair_use_per_document.test.sql toetst die vier per rol, en tests/sql/fixture.sql bootst
-- het Supabase-standaardrecht na — anders slaagt die toets in een wereld waarin de fout niet kan
-- bestaan, wat hier letterlijk is gebeurd.
REVOKE ALL ON FUNCTION public.fair_use_consume_for_document(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fair_use_release_for_document(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fair_use_consume_for_document(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fair_use_release_for_document(uuid, uuid) TO service_role;

-- ── WANNEER WEL EN NIET TERUGGEVEN ──────────────────────────────────────────────────────────
--
--   de lezer zelf faalt          → teruggeven. /eerlijk-gebruik §3: "een bestand dat wij niet
--                                  konden lezen telt ook niet mee".
--   de poort weigert             → er is niets gereserveerd → wacht_op_limiet, niets teruggeven.
--   de lezer slaagt, daarna gaat → NIET teruggeven en NIET opnieuw rekenen. De markering blijft
--   iets stuk in onze keten        staan, dus een herstart leest desnoods opnieuw voor ONZE
--                                  rekening en de eigenaar betaalt één keer.
--
-- REIKWIJDTE: dit is de verse ontvangst-levenscyclus. Een BEWUSTE herlezing later door de
-- eigenaar van een oud overgeslagen document is een andere handeling met een eigen prijs; die
-- hoort deze markering niet te erven.
--
-- ── CONTROLE ──
--   select count(*) from pg_proc where proname in
--     ('fair_use_consume_for_document','fair_use_release_for_document');   -- 2
--   select count(*) from information_schema.columns
--    where table_name='documents' and column_name='intake_ai_counted_period';  -- 1
