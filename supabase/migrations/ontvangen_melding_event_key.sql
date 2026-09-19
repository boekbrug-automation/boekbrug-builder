-- supabase/migrations/ontvangen_melding_event_key.sql
-- [ONTVANGEN-MELDING] Eén gebeurtenis, hoogstens één melding — afgedwongen door de database.
--
-- WAAROM DIT NODIG IS
-- De achtergrondverwerking van een opgeslagen document eindigt met "klaar, kijk maar". Alles wat
-- daarvóór gebeurt is inmiddels crash-bestendig gemaakt: de factuur door een partiële UNIQUE op
-- invoices.document_id, de betaling door haar replay-sleutel, het AI-tegoed door een merk op het
-- document zelf. De bel niet. Er is niets unieks aan "voor document X is een factuur geboekt", dus:
--
--     worker A → factuur geboekt → melding geschreven → push verstuurd → proces sterft
--     claim verloopt
--     worker B → ziet de factuur al staan (23505, geen tweede kostenpost) → en meldt het NOG EENS
--
-- Geen cent verkeerd, en tóch schade: een eigenaar die dezelfde factuur twee keer aangekondigd
-- ziet, concludeert niet "er is een worker herstart". Die gaat de tweede factuur zoeken.
--
-- GEMETEN, NIET AANGENOMEN (18 september 2026, productie, alleen lezen)
--   1.134 meldingen, geen kolom event_key, geen index met deze naam, 2 indexen op de tabel.
--   Alle bestaande rijen krijgen dus NULL en vallen buiten de partiële index — hij kan bij het
--   bouwen op de huidige data niet botsen.
--
-- WAAROM PARTIEEL, EN WAAROM NULLABLE
-- Veertig bestaande aanroepers melden dingen die één keer gebeuren omdat een mens iets indrukte.
-- Die hebben geen sleutel, horen er geen te krijgen, en moeten precies de rij blijven schrijven die
-- ze altijd schreven — ook op een database waar deze kolom nog niet bestaat. Alleen een aanroeper
-- die om de garantie vraagt, stuurt de kolom mee (src/lib/notifications.ts).
--
-- CONCURRENTLY, EN DUS GEEN TRANSACTIE
-- Dit bestand heeft BEWUST geen BEGIN/COMMIT. CREATE INDEX CONCURRENTLY mag niet in een
-- transactieblok draaien. Draai de twee statements los, in deze volgorde.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key text;

COMMENT ON COLUMN public.notifications.event_key IS
  '[ONTVANGEN-MELDING] Duurzame naam van de GEBEURTENIS die deze melding verslaat, vorm "<domein>:<gebeurtenis>:<id>" (bv. intake:auto-finished:<documentId>). NULL voor elke melding die een mens zelf uitlokte. Niet-NULL is uniek per gebruiker, zodat een herstart dezelfde gebeurtenis niet nog eens meldt.';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notifications_event_key
  ON public.notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

COMMENT ON INDEX public.uq_notifications_event_key IS
  '[ONTVANGEN-MELDING] Eén gebeurtenis levert hoogstens één melding op. De laatste grens tegen een crash tussen de melding en het einde van de verwerking: een tweede poging krijgt 23505 en stuurt geen tweede push. Partieel, omdat meldingen die een mens uitlokte terecht geen sleutel dragen.';

-- ── UITROLVOLGORDE — DEZE VOLGORDE IS NIET VRIJBLIJVEND ─────────────────────────────────────
--
--   1. ZET EERST DE 23505-AFHANDELING LIVE (createNotification leest hem al; zonder die code
--      verandert deze index een dubbele melding in een harde fout).
--   2. Draai ALTER TABLE. Los.
--   3. Draai CREATE INDEX CONCURRENTLY. Los, en niet in een transactie.
--   4. Bewijs dat hij ook echt staat — zie de controle hieronder. CONCURRENTLY kan MISLUKKEN en
--      een INVALID index achterlaten die niets afdwingt en er in \d wél uitziet als een index.
--   5. Daarna pas de opgeslagen verwerking aanzetten.
--
-- ── STAP 4: STAAT HIJ ER ÉCHT, EN DOET HIJ WAT ER STAAT? ──
-- indisvalid=false betekent: gebouwd, mislukt, dwingt NIETS af. Dat is de gevaarlijke uitkomst,
-- want alles ziet er verder normaal uit.
--   select i.indisunique, i.indisvalid, i.indisready, i.indislive,
--          pg_get_expr(i.indpred, i.indrelid) as partieel_op
--     from pg_index i
--     join pg_class c on c.oid = i.indexrelid
--    where c.relname = 'uq_notifications_event_key';
--
-- Verwacht: indisunique=t, indisvalid=t, indisready=t, indislive=t,
--           partieel_op = (event_key IS NOT NULL)
--
-- ── ALS DIE CONTROLE NIET KLOPT: DE HERSTELWEG ──────────────────────────────────────────────
--
-- Dezelfde val als bij uq_invoices_document_id, en om dezelfde reden gevaarlijk: een afgebroken
-- CONCURRENTLY laat een index MET DE GEVRAAGDE NAAM achter die INVALID is en niets afdwingt, en een
-- tweede poging met IF NOT EXISTS ziet de NAAM, zegt "staat er al", en slaat het aanmaken over. De
-- migratie meldt succes en er is geen grens.
--
-- Dus: geeft de controle iets anders dan vier keer 't, eerst weg en dan opnieuw. Met de hand, los,
-- en NOOIT binnen een transactie of als automatische stap in een andere migratie.
--
--   DROP INDEX CONCURRENTLY public.uq_notifications_event_key;
--   -- daarna het CREATE-statement hierboven opnieuw, los, en daarna de pg_index-controle opnieuw.
