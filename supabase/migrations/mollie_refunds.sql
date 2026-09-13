-- supabase/migrations/mollie_refunds.sql
-- [TERUGBETALING] Geld dat via Mollie TERUGGING, als vastgelegd feit.
--
-- ── WAT ER MIS WAS ──────────────────────────────────────────────────────────────────────────
--
-- mollie-settlement-sync.ts LAS terugbetalingen en chargebacks al per afrekening, en hield de
-- afrekening tegen zodra er één in zat. Dat voorkwam een verkeerde boeking van de uitbetaling.
-- Maar het legde niets vast: geen rij, geen factuurnaam, geen bedrag, geen datum. De zin op de
-- afrekening was het enige spoor, en die wordt bij de volgende run overschreven.
--
-- Ondertussen staat de factuur die met die betaling is voldaan gewoon op 'paid'. Het geld is weg
-- en de boekhouding weet het niet. Dat is de enige plek in het hele betaalvlak waar ECHT geld
-- stil de boeken uit kan lopen — en daarmee de enige die deze tabel rechtvaardigt.
--
-- ── WAAROM EEN TABEL EN NIET EEN VELD OP DE AFREKENING ──────────────────────────────────────
--
-- Eén afrekening kan meerdere terugbetalingen bevatten, elk over een ANDERE factuur, en elk met
-- zijn eigen antwoord. Een tekstveld op de afrekening kan dat niet dragen. En het unieke paar
-- (user_id, refund_id) is precies wat de synchronisatie idempotent maakt: Mollie's eigen id van
-- de gebeurtenis is de sleutel, dus een tweede run over dezelfde afrekening ziet dat hij dit
-- feit al kent in plaats van het opnieuw te melden.
--
-- ── WAAROM DE APP HET ANTWOORD NIET ZELF GEEFT ──────────────────────────────────────────────
--
-- Een chargeback en een terugbetaling zijn niet hetzelfde gebeuren, en ze leiden tot twee
-- verschillende boekingen:
--
--   · chargeback  — de klant heeft het geld teruggehaald. De factuur is niet betaald. De
--     betaling hoort van de factuur af.
--   · terugbetaling — de ondernemer heeft geld teruggegeven. In de Nederlandse boekhouding is
--     dat normaal een CREDITNOTA, en de oorspronkelijke factuur blijft betaald staan.
--
-- Alleen de ondernemer weet welke van de twee dit was; het is soms zelfs een terugbetaling die
-- tóch een terugdraaiing hoort te zijn (een dubbele betaling die is teruggestort). Dus: de app
-- legt het feit vast, noemt de factuur, en vraagt het. `resolution` is dat antwoord.
--
-- ── STATUS ──────────────────────────────────────────────────────────────────────────────────
--   'open'      — nog niet beantwoord. De afrekening blijft 'held' zolang er één openstaat.
--   'reversed'  — de betaling is van de factuur gehaald (reverse_invoice_payment).
--   'credited'  — de ondernemer maakt er een creditnota voor; de factuur blijft betaald.
--   'not_ours'  — de betaling hoorde niet bij een BoekBrug-factuur. Niets te doen in de boeken.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mollie_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Mollie's eigen ids. settlement_id is tekst en géén foreign key: de afrekeningrij kan later
  -- komen dan het feit, en een feit over geld mag nooit wachten op een administratieve rij.
  settlement_id text NOT NULL,
  refund_id text NOT NULL,
  kind text NOT NULL,
  -- De betaling (tr_…) waar dit overheen ging, en — als wij die betaling kennen — onze eigen
  -- betaallinkrij en de factuur eronder. Alle drie mogen NULL zijn: geld dat wij niet herkennen
  -- is nog steeds geld dat terugging, en het wordt vastgelegd in plaats van weggegooid.
  payment_id text,
  link_id uuid,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  -- Wat er terugging, positief, in euro's. Cents-exact zoals Mollie het meldde.
  amount numeric(12,2) NOT NULL,
  created_on date,
  -- invoices.amount_paid op het moment dat wij dit feit voor het eerst zagen. Daarmee is
  -- "de terugdraaiing is al gebeurd" een BEWIJSBARE uitspraak in plaats van een gok: het
  -- bedrag moet met minstens dit bedrag omlaag zijn. Zonder momentopname is er geen nulpunt.
  paid_snapshot numeric(12,2),
  resolution text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  noted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mollie_refunds_user_refund_uidx UNIQUE (user_id, refund_id),
  CONSTRAINT mollie_refunds_kind_check CHECK (kind IN ('refund', 'chargeback')),
  CONSTRAINT mollie_refunds_amount_check CHECK (amount > 0),
  CONSTRAINT mollie_refunds_resolution_check
    CHECK (resolution IN ('open', 'reversed', 'credited', 'not_ours'))
);

-- De twee vragen die gesteld worden: "wat staat er nog open?" (elke synchronisatie, de melding)
-- en "hoort er iets bij DEZE factuur?" (het paneel op het factuurscherm).
CREATE INDEX IF NOT EXISTS mollie_refunds_open_idx
  ON public.mollie_refunds (user_id, noted_at DESC) WHERE resolution = 'open';
CREATE INDEX IF NOT EXISTS mollie_refunds_invoice_idx
  ON public.mollie_refunds (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mollie_refunds_settlement_idx
  ON public.mollie_refunds (user_id, settlement_id);

ALTER TABLE public.mollie_refunds ENABLE ROW LEVEL SECURITY;
-- Lezen mag de eigenaar; schrijven doet uitsluitend de cron en de antwoordroute (service_role).
-- Zelfde vorm als mollie_settlements, en om dezelfde reden: een rij die zegt dat geld terugging
-- mag niet door de browser gemaakt of gewijzigd kunnen worden.
DROP POLICY IF EXISTS mollie_refunds_select_own ON public.mollie_refunds;
CREATE POLICY mollie_refunds_select_own ON public.mollie_refunds
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

COMMENT ON TABLE public.mollie_refunds IS
  '[TERUGBETALING] Eén rij per terugbetaling of chargeback die Mollie in een afrekening meldde. Uniek op (user_id, refund_id), dus de synchronisatie is idempotent op Mollies eigen gebeurtenis-id. De app boekt niets uit zichzelf: resolution is het antwoord van de ondernemer, want een chargeback hoort van de factuur af en een terugbetaling is normaal een creditnota.';

COMMENT ON COLUMN public.mollie_refunds.paid_snapshot IS
  '[TERUGBETALING] invoices.amount_paid toen dit feit voor het eerst werd gezien — het nulpunt waartegen "is de terugdraaiing al gebeurd?" bewijsbaar is.';

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Alle drie moeten waar zijn.
SELECT EXISTS (SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'mollie_refunds') AS has_table;
SELECT count(*) AS has_unique FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'mollie_refunds_user_refund_uidx';
SELECT relrowsecurity AS rls_on FROM pg_class WHERE oid = 'public.mollie_refunds'::regclass;
