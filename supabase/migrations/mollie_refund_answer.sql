-- supabase/migrations/mollie_refund_answer.sql
-- [TERUGBETALING-DEUR] Eén afgedwongen schrijfpad voor "wat de eigenaar over deze terugbetaling zei".
--
-- ── WAT ER STUK WAS ─────────────────────────────────────────────────────────────────────────
--
-- /api/mollie/terugbetaling deed TWEE schrijfacties in TWEE transacties: de RPC die de betaling
-- van de factuur haalt, en daarna een losse .update() die het antwoord vastlegt. De route noemde
-- het gat zelf, met zoveel woorden: "De betaling is er wél af en het antwoord niet vastgelegd:
-- dat is de enige half-af toestand hier."
--
-- supabase-js kent geen transactie. Twee aanroepen zijn altijd twee transacties, dus geen enkele
-- hoeveelheid TypeScript sluit dat gat. Het werd geheeld doordat de volgende afrekeningssyn-
-- chronisatie het feit opnieuw afleidde — de boeking klopte dus alleen omdat er toevallig een
-- cron langskwam.
--
-- Dit is dezelfde beweging als [EEN-SCHRIJFPAD] op "deze factuur is betaald": twee schrijvers van
-- één feit worden één deur. De terugdraaiing en het antwoord zijn nu één transactie, en de
-- half-af toestand kan niet meer bestaan.
--
-- ── WAT DIT NADRUKKELIJK NIET DOET ──────────────────────────────────────────────────────────
--
-- Het herimplementeert mayReverse() niet. De regel over de gedeeltelijke terugbetaling blijft in
-- src/lib/mollie-refund.ts, waar hij zuiver is, op zijn grenzen getest, en uitgelegd. Wat hier
-- binnenkomt is niet de REGEL maar het GETAL waarop die regel is toegepast: p_expected_applied.
-- Wijkt de vergrendelde rij daarvan af, dan wordt het antwoord geweigerd.
--
-- Waarde vastgepind, regel niet gekopieerd — dezelfde discipline als invoice_corrections.before
-- met isStale() bij de correctiedeur, maar dan BINNEN het slot in plaats van ervoor.

BEGIN;

-- De boodschap die een geldfunctie opwierp, als code. Dit is de regex-triage die vandaag in de
-- route staat (/verwerkt/i → accountant_lock), één laag omlaag verplaatst naar waar de boodschap
-- ontstaat — zodat elke volgende aanroeper dezelfde afbeelding krijgt in plaats van zijn eigen.
CREATE OR REPLACE FUNCTION public.mollie_refund_reason_of(p_msg text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_msg ~* 'verwerkt'            THEN 'refund.accountant_lock'
    WHEN p_msg ~* 'bank line'           THEN 'refund.has_bank_line'
    WHEN p_msg ~* 'not found'           THEN 'refund.payment_gone'
    WHEN p_msg ~* 'no recorded amount'  THEN 'refund.payment_gone'
    ELSE 'refund.reverse_failed'
  END;
$$;

CREATE OR REPLACE FUNCTION public.answer_mollie_refund(
  p_user_id          uuid,
  p_refund_id        text,
  p_answer           text,     -- 'reversed' | 'credited' | 'not_ours'
  p_expected_applied numeric   -- wat de poort op de koppelrij zag; NULL tenzij p_answer='reversed'
)
-- [BANK-BATCH-AMBIGU] De uitvoerkolommen dragen een voorvoegsel, zodat geen ervan óók een kolom is
-- die deze functie schrijft: plpgsql weigert een dubbelzinnige verwijzing tijdens de UITVOERING,
-- dus de functie zou bij elke aanroep opwerpen en een aanroeper die een raise als "niet van
-- toepassing" leest merkt daar nooit iets van. Zelfde reden als bij move_invoice_payment.
RETURNS TABLE (
  answer_ok          boolean,
  answer_reason_code text,
  answer_amount      numeric,
  answer_remaining   numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund_row_id uuid;
  v_resolution    text;
  v_link_key      uuid;
  v_invoice_id    uuid;
  v_link_id       uuid;
  v_applied       numeric;
  v_amount        numeric;
  v_remain        numeric;
  v_eps           numeric := 0.01;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[TERUGBETALING] caller % may not answer refunds for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_answer NOT IN ('reversed', 'credited', 'not_ours') THEN
    RETURN QUERY SELECT false, 'refund.invalid_answer'::text, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  -- HET SLOT. Dit vervangt de `.eq('resolution','open')` van de route: "staat hij nog open" en
  -- "schrijf het antwoord" zijn nu één transactie in plaats van twee.
  SELECT r.id, r.resolution, r.link_id, r.invoice_id
    INTO v_refund_row_id, v_resolution, v_link_key, v_invoice_id
  FROM public.mollie_refunds r
  WHERE r.user_id = p_user_id AND r.refund_id = p_refund_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'refund.not_found'::text, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;
  IF v_resolution <> 'open' THEN
    RETURN QUERY SELECT false, 'refund.already_answered'::text, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  IF p_answer = 'reversed' THEN
    IF v_link_key IS NULL OR v_invoice_id IS NULL THEN
      RETURN QUERY SELECT false, 'refund.no_invoice'::text, NULL::numeric, NULL::numeric;
      RETURN;
    END IF;

    -- De geboekte betaling is de bank_tx_invoices-rij die de webhook schreef met het rij-id van de
    -- betaallink als client_key. Hier vergrendeld, zodat het bedrag waartegen de pin vergelijkt
    -- niet onder ons vandaan kan bewegen.
    SELECT l.id, coalesce(l.amount_applied, 0) INTO v_link_id, v_applied
    FROM public.bank_tx_invoices l
    WHERE l.user_id = p_user_id AND l.client_key = v_link_key
    ORDER BY l.created_at
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'refund.payment_gone'::text, NULL::numeric, NULL::numeric;
      RETURN;
    END IF;

    -- DE WAARDEPIN. Niet de regel over gedeeltelijke terugbetalingen — het GETAL waarop die regel
    -- is toegepast. Een gelijktijdige verplaatsing of deelterugdraaiing tussen de lezing van de
    -- poort en dit slot verandert het, en dan beantwoordt de eigenaar een betaling die niet meer
    -- de betaling is die hij te zien kreeg.
    IF p_expected_applied IS NULL OR abs(v_applied - p_expected_applied) > v_eps THEN
      RETURN QUERY SELECT false, 'refund.payment_changed'::text, NULL::numeric, NULL::numeric;
      RETURN;
    END IF;

    -- Een opgevangen exception opent een impliciet savepoint: een 55000 uit de geldfunctie draait
    -- alleen haar EIGEN werk terug en laat deze transactie in leven om de weigering te melden. Dat
    -- is wat een opwerpende geldfunctie in een antwoordende domeinopdracht verandert zónder er één
    -- regel aan te wijzigen — en die zes functies wijzigen is precies wat hier nooit lichtvaardig
    -- mag gebeuren. 42501 wordt met opzet NIET gevangen: een doorbroken aanroepwacht hoort af te
    -- breken, niet beleefd beantwoord te worden.
    BEGIN
      SELECT r.reversed_amount, r.remaining_paid INTO v_amount, v_remain
      FROM public.reverse_invoice_payment(p_user_id, v_link_id) r;
    EXCEPTION WHEN SQLSTATE '55000' THEN
      RETURN QUERY SELECT false, public.mollie_refund_reason_of(SQLERRM), NULL::numeric, NULL::numeric;
      RETURN;
    END;
  END IF;

  UPDATE public.mollie_refunds
     SET resolution = p_answer, resolved_at = now(), updated_at = now()
   WHERE id = v_refund_row_id;

  RETURN QUERY SELECT true, NULL::text, v_amount, v_remain;
END;
$$;

COMMENT ON FUNCTION public.answer_mollie_refund(uuid, text, text, numeric) IS
  '[TERUGBETALING-DEUR] Legt ATOMISCH vast wat de eigenaar over één Mollie-terugbetaling antwoordde: bij ''reversed'' haalt hij de betaling van de factuur (reverse_invoice_payment) én schrijft hij mollie_refunds.resolution in dezelfde transactie, zodat de half-af toestand "betaling eraf, antwoord niet vastgelegd" niet kan bestaan. p_expected_applied is een WAARDEPIN op het bedrag dat de poort zag — de regel over gedeeltelijke terugbetalingen blijft in mollie-refund.ts. Geeft codes terug, nooit zinnen.';

REVOKE ALL ON FUNCTION public.answer_mollie_refund(uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.answer_mollie_refund(uuid, text, text, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.mollie_refund_reason_of(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mollie_refund_reason_of(text) TO service_role;

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Beide moeten waar zijn.
SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'answer_mollie_refund') AS has_answer_fn;
SELECT provolatile = 'i' AS reason_of_is_immutable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'mollie_refund_reason_of';
