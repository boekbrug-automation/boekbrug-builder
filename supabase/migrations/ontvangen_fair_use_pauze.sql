-- supabase/migrations/ontvangen_fair_use_pauze.sql
-- [ONTVANGEN] Een document dat wacht op de maandgrens — niet mislukt, niet overgeslagen, niet weg.
--
-- WAAROM DIT BESTAAT
-- Vóór #129 weigerde de eerlijk-gebruikpoort binnen het verzoek van de eigenaar zelf: hij uploadde,
-- liep tegen de maandgrens, en hoorde dat meteen — met het aantal, de grens, zijn plan en de twee
-- uitwegen. Receive-first haalt die luisteraar weg. De eigenaar heeft "Ontvangen — je kunt verder"
-- gehoord en het tabblad gesloten; de weigering gebeurt nu terwijl er niemand kijkt.
--
-- De rij gewoon laten staan als gewoon wachtwerk zou technisch veilig zijn en product-oneerlijk:
-- we hebben gezegd dat hij verder kon, en dan hoort hij weken niets terwijl er een factuur
-- ongelezen ligt die hij voor zijn aangifte nodig kan hebben. Het een leesfout noemen zou een
-- leugen zijn — wij hebben het niet geprobeerd en gefaald, wij hebben besloten niet uit te geven.
--
-- WAT ER GEMETEN IS VOORDAT DIT ER KWAM
-- documents had geen enkel veld met de betekenis "niet vóór": alleen created_at, trashed_at,
-- period en year. Er was dus niets om op mee te liften, en een datum verstoppen in ai_doc_type of
-- in het vrije-tekstveld notes is precies wat dit bestand niet doet.

alter table public.documents
  add column if not exists intake_retry_after  timestamptz,
  add column if not exists intake_pause_reason text,
  add column if not exists intake_pause_metric text;

-- Eén reden, en hij staat er uitgeschreven. Komt er ooit een tweede soort pauze, dan hoort die
-- hier bij te komen en niet stilletjes als vrije tekst binnen te lopen.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_intake_pause_reason_check') then
    alter table public.documents
      add constraint documents_intake_pause_reason_check
      check (intake_pause_reason is null or intake_pause_reason in ('fair_use'));
  end if;
end $$;

comment on column public.documents.intake_retry_after is
  '[ONTVANGEN] Het eerste moment waarop opnieuw vragen een ander antwoord KAN geven — bij de maandgrens: het eerste moment van de volgende UTC-kalendermaand, want currentPeriod() in fair-use-usage.ts telt in UTC. Het is GEEN belofte dat er dan ruimte is; de poort blijft de enige die dat beslist.';
comment on column public.documents.intake_pause_reason is
  '[ONTVANGEN] Waarom dit document gepauzeerd staat. Nu alleen fair_use. Bewust geen bewaarde stand van used/limit: de eerlijk-gebruikteller is en blijft de bron voor het HUIDIGE verbruik, en een bevroren getal ernaast zou daar vroeg of laat mee in tegenspraak zijn.';
comment on column public.documents.intake_pause_metric is
  '[ONTVANGEN] Welke grens op was — aiDocuments vandaag. Genoeg om de toestand later uit te leggen, meer niet.';

-- De drain zoekt hierop: wat staat gepauzeerd en is die pauze al voorbij? Partieel, want dit zijn
-- de enige rijen die de vraag stellen, en een index over de hele tabel zou de rest laten betalen.
create index if not exists idx_documents_wacht_op_limiet
  on public.documents (user_id, intake_retry_after)
  where ai_doc_type = 'wacht_op_limiet';

-- ── DE MELDING IS EENMALIG, EN DAT WORDT HIER AFGEDWONGEN ───────────────────────────────────
--
-- De eigenaar hoort dit één keer: bij het INGAAN van de toestand. Dat in de applicatie beslissen
-- zou betekenen: rij lezen, besluiten, schrijven — en twee passes die allebei "nog niet
-- gepauzeerd" lezen vóórdat een van beide schrijft, sturen allebei de melding.
--
-- Daarom beslist de SCHRIJFACTIE het: de update die de toestand verzet weigert een rij die er al
-- in staat (neq op ai_doc_type), dus precies één aanroeper kan ooit te horen krijgen dat hij hem
-- verzette. Zie pauseDocumentForFairUse() in src/lib/stored-document.ts. Dezelfde vorm als de
-- [EB-RACE] claim: de database hakt de knoop door, niet een vergelijking in code.

-- ── ROLLOUT ────────────────────────────────────────────────────────────────────────────────
--
-- Zelfde regel als ontvangen_intake_intent.sql: eerst bewijzen dat het schema live staat, dan pas
-- receive-first aanzetten. Zonder deze kolommen kan een geweigerd document zijn eigen toestand
-- niet onthouden, en dan is het stil op precies het moment waarop het iets moet zeggen.
--
-- ── CONTROLE ──
--   select
--     (select count(*) from information_schema.columns
--       where table_schema='public' and table_name='documents'
--         and column_name in ('intake_retry_after','intake_pause_reason','intake_pause_metric')) as kolommen_3,
--     exists (select 1 from pg_constraint where conname='documents_intake_pause_reason_check') as slot_reden,
--     exists (select 1 from pg_indexes where indexname='idx_documents_wacht_op_limiet') as index_limiet;
--
-- En hoeveel staan er gepauzeerd, en tot wanneer? (hoort klein te blijven)
--   select date_trunc('day', intake_retry_after) as weer_proberen, count(*)
--     from public.documents where ai_doc_type = 'wacht_op_limiet'
--    group by 1 order by 1;
