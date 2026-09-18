-- supabase/migrations/ontvangen_uniek_document_per_factuur.sql
-- [ONTVANGEN] Eén opgeslagen document levert hoogstens ÉÉN factuur op — afgedwongen door de database.
--
-- WAAROM DIT NODIG IS
-- Een claim geeft wederzijdse uitsluiting zolang een worker ademt. Over deze crash zegt hij niets:
--
--     worker A  → insert factuur COMMIT → proces sterft vóór de koppeling/eindtoestand
--     claim verloopt
--     worker B  → ziet een wachtend document → leest opnieuw → INSERT TWEEDE FACTUUR
--
-- Dat is dubbele kosten en dubbele voorbelasting, en niets faalt. De enige grens die een harde
-- crash overleeft staat in de database zelf.
--
-- GEMETEN, NIET AANGENOMEN (18 september 2026, productie, alleen lezen)
--   643 facturen, 613 met een document, 0 gedeelde document_id-waarden;
--   count(*) - count(distinct document_id) = 0, dus deze index HOUDT op de huidige data;
--   0 facturen met meerdere documenten in de omgekeerde richting;
--   geen enkele deur wil delen — zie docs/ONTVANGEN_IDEMPOTENTIE.md voor alle zes.
--
-- WAAROM PARTIEEL
-- document_id is NIET overal gevuld, en dat hoort zo: 9 inkomende facturen komen uit
-- [REGEL-FACTUUR] (een boeking vanaf een bankregel, er is geen bestand), en alle 21 uitgaande
-- facturen hebben er geen — die pdf maken wij zelf en staat in pdf_url. Een volledige unique zou
-- die rijen op elkaar laten botsen op NULL... nee, sterker: hij zou ze toestaan maar zinloos zijn.
-- Partieel zegt precies wat we bedoelen en niets meer.
--
-- CONCURRENTLY, EN DUS GEEN TRANSACTIE
-- Deze migratie heeft BEWUST geen BEGIN/COMMIT. CREATE INDEX CONCURRENTLY mag niet in een
-- transactieblok draaien, en een gewone CREATE INDEX zou schrijvers op invoices blokkeren terwijl
-- hij bouwt. Draai dit statement los.
--
-- DE OUDE ZOEK-INDEX BLIJFT STAAN
-- idx_invoices_document_id blijft voorlopig bestaan. Hem droppen om de naam te hergebruiken zou
-- een venster openen waarin er GEEN index op deze kolom is, en dat venster is precies de tijd
-- waarin de nieuwe nog niet klaar is. Twee indexen kosten schijfruimte; een gat kost een grens.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_invoices_document_id
  ON public.invoices (document_id)
  WHERE document_id IS NOT NULL;

COMMENT ON INDEX public.uq_invoices_document_id IS
  '[ONTVANGEN] Eén opgeslagen document levert hoogstens één factuur op. De laatste grens tegen een crash tussen de factuur-insert en de afronding: een tweede poging krijgt 23505 in plaats van een tweede kostenpost. Partieel omdat [REGEL-FACTUUR] en elke uitgaande factuur terecht geen document hebben.';

-- ── UITROLVOLGORDE — DEZE VOLGORDE IS NIET VRIJBLIJVEND ─────────────────────────────────────
--
--   1. ZET EERST DE 23505-AFHANDELING LIVE. Code die een conflict niet kan lezen, verandert door
--      deze index een stille dubbele boeking in een harde 500. Eerst de vangnetten, dan het slot.
--   2. Draai de telling hieronder opnieuw op LIVE data. Tussen meten en aanzetten kan er van alles
--      zijn binnengekomen.
--   3. Pas dan dit statement, los, CONCURRENTLY.
--   4. Bewijs dat hij ook echt staat — zie de controle hieronder. CONCURRENTLY kan MISLUKKEN en
--      een INVALID index achterlaten die niets afdwingt en er in \d wél uitziet als een index.
--   5. Daarna pas receive-first aanzetten.
--
-- ── STAP 2: HOUDT HIJ NOG? (moet 0 teruggeven) ──
--   select count(*) - count(distinct document_id) as schendingen
--     from public.invoices where document_id is not null;
--
-- ── STAP 4: STAAT HIJ ER ÉCHT, EN DOET HIJ WAT ER STAAT? ──
-- indisvalid=false betekent: gebouwd, mislukt, dwingt NIETS af. Dat is de gevaarlijke uitkomst,
-- want alles ziet er verder normaal uit.
--   select i.indisunique, i.indisvalid, i.indisready, i.indislive,
--          pg_get_expr(i.indpred, i.indrelid) as partieel_op
--     from pg_index i
--     join pg_class c on c.oid = i.indexrelid
--    where c.relname = 'uq_invoices_document_id';
--
-- Verwacht: indisunique=t, indisvalid=t, indisready=t, indislive=t,
--           partieel_op = (document_id IS NOT NULL)
