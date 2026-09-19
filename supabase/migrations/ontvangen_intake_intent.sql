-- supabase/migrations/ontvangen_intake_intent.sql
-- [ONTVANGEN] Wat de eigenaar bedoelde, bewaard vóórdat wij "Ontvangen" zeggen.
--
-- WAAROM DIT BESTAAT
-- /api/intake hield de browser vast tot het hele werk klaar was. #129 draait dat om: eerst veilig
-- ontvangen, dan pas lezen en boeken. Alles wat de eigenaar op het uploadmoment MEEGEEFT en wat
-- later nog van invloed is op geld, moet die omslag overleven — anders is het weg zodra hij het
-- tabblad sluit, en dat is precies het moment waarop wij zeiden dat hij verder kon.
--
-- Gemeten, niet geraden: het formulier draagt vijf velden, en drie daarvan zijn bedoeling die
-- nergens anders uit is af te leiden.
--
--   file          → wordt het opgeslagen bestand
--   source        → stond al in documents.source
--   paid_method   → HIER
--   paid_date     → HIER
--   force         → bewust NIET; zie onderaan
--
-- WAAROM TYPED KOLOMMEN EN GEEN JSON
-- Deze twee sturen geld: paid_method bepaalt of een bon via de kas of via de bank wordt afgerekend
-- (cash-settle zoekt letterlijk op payment_method = 'kas'), en paid_date is de datum die in de
-- boeking belandt. Een waarde die een boeking stuurt hoort een kolom met een CHECK te zijn, geen
-- sleutel in een blob die niemand valideert. De vrije-tekst 'notes' is helemaal geen optie: dat
-- veld is van de eigenaar, niet van ons.

alter table public.documents
  add column if not exists intake_paid_method text,
  add column if not exists intake_paid_date   date;

-- Dezelfde twee waarden die de rest van de app kan lezen. normaliseerBetaalwijze() in
-- bon-betaalwijze.ts vertaalt "pin"/"contant"/"creditcard" naar deze twee; wat hier binnenkomt is
-- al genormaliseerd, en een derde waarde valt tussen wal en schip.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_intake_paid_method_check') then
    alter table public.documents
      add constraint documents_intake_paid_method_check
      check (intake_paid_method is null or intake_paid_method in ('bank', 'kas'));
  end if;
end $$;

comment on column public.documents.intake_paid_method is
  '[ONTVANGEN] De betaalwijze die de eigenaar bij het uploaden zelf koos (bank|kas), bewaard voordat er "Ontvangen" is gezegd. Null = hij koos niets en de lezing beslist.';
comment on column public.documents.intake_paid_date is
  '[ONTVANGEN] De betaaldatum die de eigenaar bij het uploaden zelf gaf. Null = geen keuze; de lezing of de mens in de controlewachtrij vult hem.';

-- ── De vraag die pas NA "Ontvangen" kan ontstaan ──────────────────────────────────────────────
--
-- Een semantisch dubbele factuur — dezelfde factuur, ander bestand — wordt gevonden door de lezer,
-- en die draait nu achteraf. De eigenaar is dan allang weer aan het werk. Vroeger blokkeerde dit
-- het antwoord en stuurde het scherm hetzelfde bestand nog een keer op met force=true; dat kan niet
-- meer, en het hoeft ook niet: de bytes zijn al van ons.
--
-- Dus wordt het een DUURZAME vraag aan de eigenaar, op het document dat er al staat.
alter table public.documents
  add column if not exists duplicate_candidate_invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists duplicate_decision text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_duplicate_decision_check') then
    alter table public.documents
      add constraint documents_duplicate_decision_check
      check (duplicate_decision is null or duplicate_decision in ('keep_existing', 'add_anyway'));
  end if;
end $$;

comment on column public.documents.duplicate_candidate_invoice_id is
  '[ONTVANGEN] De factuur die dit document volgens de lezer dubbel zou zijn. Alleen de KANDIDAAT — niets is besloten tot de eigenaar antwoordt. LET OP: de foreign key bewijst BESTAAN, niet EIGENDOM — zie de notitie hieronder.';

-- ── [ONTVANGEN] De foreign key bewijst bestaan, niet eigendom ────────────────────────────────
--
-- references invoices(id) zegt dat die factuur ERGENS bestaat. Het zegt niets over van WIE hij is,
-- en RLS staat uit op de geldlijn (zie [RLS-UIT]). Een kandidaat-uuid dat van een client komt is
-- dus precies zo veel waard als de uuid die iemand zelf verzint.
--
-- De deur die dit straks schrijft en de deur die "hou de bestaande" / "toch toevoegen" afhandelt,
-- moeten allebei ZELF vaststellen, server-side, uit de ingelogde eigenaar en het opgeslagen
-- document:
--
--     document.user_id            = de ingelogde eigenaar
--     kandidaatfactuur.receiver_id = diezelfde eigenaar
--
-- Nooit uit het verzoek. Een besluit over een factuur van iemand anders is niet alleen een lek —
-- "hou de bestaande" gooit dan een bestand weg op gezag van een vreemde.
--
-- Er komt een regressie op zodra die deur er is; dit staat hier omdat het schema er eerder is dan
-- de deur, en een invariant die alleen in een hoofd zit, is er niet.
comment on column public.documents.duplicate_decision is
  '[ONTVANGEN] Het antwoord van de eigenaar: keep_existing (dit bestand is overbodig, de bytes gaan weg) of add_anyway (toch boeken, dit is een andere factuur). Null = de vraag staat nog open.';

-- De drain zoekt hierop: wat wacht er op ons, en wat wacht er op de eigenaar?
create index if not exists idx_documents_wachtend
  on public.documents (user_id, ai_doc_type)
  where ai_processed = false;

-- ── WAAROM ER GEEN intake_force KOLOM IS ─────────────────────────────────────────────────────
--
-- Het oude force=true was een eigenschap van HET VERZOEK: de browser had het bestand nog vast en
-- stuurde het opnieuw. In het nieuwe model bestaat dat moment niet meer — er is geen tweede upload,
-- want de bytes staan er al. De override is daarom geen vlag bij binnenkomst maar een BESLUIT op
-- een opgeslagen document: duplicate_decision = 'add_anyway'.
--
-- Zolang de oude synchrone weg nog leeft, blijft /api/intake force=true accepteren; die vlag is
-- overgangsmateriaal en hoort te verdwijnen met het pad dat hem nodig had. Hem hier vastleggen zou
-- een verzoek-eigenschap tot duurzame staat promoveren, en dat is precies de verwarring die dit
-- hele stuk werk opruimt.

-- ── ROLLOUT: DIT IS EEN VOORWAARDE, GEEN VERBETERING ────────────────────────────────────────
--
-- Zonder deze kolommen WEIGERT de nieuwe ontvangstweg de overdracht: hij rolt de bytes terug en
-- zegt géén "Ontvangen". Dat is met opzet — de belofte is dat wij alles hebben wat de eigenaar
-- zojuist afgaf, en de helft onthouden is erger dan netjes nee zeggen.
--
-- Dus dezelfde regel als [EB-RACE] bij intake_claims: eerst bewijzen dat het schema live staat,
-- dan pas receive-first aanzetten. Productie draait nog op de oude synchrone weg, dus er is geen
-- enkele reden om een half-schema-venster te accepteren.
--
-- ── CONTROLE ──
-- Staan de vier kolommen en hun twee sloten er? Alles 't is goed.
--   select
--     (select count(*) from information_schema.columns
--       where table_schema='public' and table_name='documents'
--         and column_name in ('intake_paid_method','intake_paid_date','duplicate_candidate_invoice_id','duplicate_decision')) as kolommen_4,
--     exists (select 1 from pg_constraint where conname='documents_intake_paid_method_check') as slot_betaalwijze,
--     exists (select 1 from pg_constraint where conname='documents_duplicate_decision_check') as slot_besluit,
--     exists (select 1 from pg_indexes where indexname='idx_documents_wachtend') as index_wachtend;
--
-- En blijft de wachtrij klein? (dit hoort in de tientallen te blijven, nooit duizenden)
--   select ai_doc_type, count(*) from public.documents
--    where ai_processed = false group by ai_doc_type order by 2 desc;
