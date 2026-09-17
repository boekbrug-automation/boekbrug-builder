# Migraties — de volgorde waarin je ze toepast

*Stand van tak `claude/snelstart-integration-opix9l`, 29 juli 2026.*

> ## ⚠️ LEES DIT EERST: DEZE LIJST IS NIET DE WAARHEID
>
> Een handmatig bijgehouden "wat staat er nog open" is een BEWERING over een database die
> niemand meer heeft bekeken. Hij loopt achter zodra iemand een migratie draait zonder deze
> markdown bij te werken, of zodra een tweede tak er een migratie bij zet.
>
> **En dat is precies wat er is gebeurd.** Twee takken werkten tegelijk aan deze lijst. De ene
> meldde 13 en 14 als toegepast en noemde 10, 11 en 12 nog open; de eigenaar had 10, 11 en 12
> op 26–28 juli juist wél toegepast, mét CONTROLE. Beide lijsten hadden het dus deels mis, en
> geen van beide kon dat zelf weten. Een lijst die het mis heeft over de veiligheid van iemands
> boekhouding is erger dan geen lijst.
>
> **Vraag het daarom aan de database zelf:**
>
> ```
> docs/WELKE_MIGRATIES_STAAN_ER.sql
> ```
>
> Één query in de Supabase SQL-editor, leest alleen de catalogus, verandert niets. Dat antwoord
> klopt altijd; dit document niet noodzakelijk.
>
> **Sinds 15 augustus 2026 wordt die query GEGENEREERD** uit `supabase/migrations/`, door
> `scripts/migration-inventory.ts`. Dat is geen nettigheid maar de reparatie van dezelfde fout één
> verdieping hoger: het antwoord kwam altijd al uit de database, maar de VRAAG stond met de hand
> in dat bestand — en een migratie die er niet in stond, kon er ook nooit als OPEN uit komen. Dat
> ging twee keer mis; de laatste keer dekte de lijst 28 van de 104 migraties op schijf en gaf een
> schoon "alles toegepast" terug. Nu dekt hij ze alle 104, en een poort
> (`[MIGRATIE-JOURNAAL]`) faalt zodra de map en het bestand uit elkaar lopen.
>
> Drie uitkomsten, en de middelste is de belangrijke:
>
> | | |
> |---|---|
> | `TOEGEPAST` | elk object dat de migratie aanmaakt, bestaat |
> | `GEDEELTELIJK` | **halverwege gestopt** — lees het CONTROLE-blok van dát bestand |
> | `OPEN` | geen enkel object bestaat |
>
> Negen migraties maken niets aan (ze trekken rechten in, wijzigen, of verplaatsen data). Die
> staan onderaan met naam als "niet vast te stellen" — met opzet geen verzonnen vingerafdruk,
> want een verkeerd antwoord is erger dan geen antwoord.
>
> ### De stand op 29 juli 2026 — GELEZEN UIT DE DATABASE, niet gemeld
>
> Dit is de uitkomst van `WELKE_MIGRATIES_STAAN_ER.sql` tegen de productiedatabase. Dat is een
> ander soort zekerheid dan de rest van dit document: geen bewering van een tak, maar wat er
> daadwerkelijk staat.
>
> | # | Bestand | Wat het dichtte |
> |---|---------|-----------------|
> | 10 | `kluis_subscriptions.sql` | Geld aannemen zonder de bewaarverplichting ergens vast te leggen |
> | 11 | `accountant_write_holes.sql` | Het IBAN-schrijfgat in de boekhoudersgrens + vier ontbrekende indexen |
> | 12 | `invoice_lines_accountant_gate.sql` | Een verstuurde factuur toonde de boekhouder een lege regelset |
> | 13 | `invoice_archive_reason.sql` | `archive_reason` + `archived_at` + CHECK + partiële index |
> | 14 | `email_sender_rules.sql` | Tabel + unieke index + RLS met vier policies |
> | 15 | `snelstart_claim_before_push.sql` | Twee gelijktijdige verzoeken konden dezelfde factuur twee keer in het wettelijke inkoopboek zetten |
> | 16 | `cash_settlement_per_instalment.sql` | Kasboekregels per termijn in plaats van één per factuur |
> | 17 | `invoice_schedules.sql` | Terugkerende facturen |
>
> ### ~~Nog open: vijf~~ — ACHTERHAALD op 15 augustus 2026
>
> **Vier van deze vijf zijn gemeten als TOEGEPAST**, met de volledige inventarislijst tegen de
> productiedatabase: `cron_runs.sql`, `bank_ignore_reason.sql`, `bank_statement_periods.sql` en
> `search_engine_clients_kvk_city.sql`. Ze stonden hier bijna drie weken als "nog open" terwijl ze
> er allang stonden — precies waar de waarschuwing bovenaan dit document voor is.
>
> **De vijfde, `storage_bucket_hardening.sql`, blijft onbeantwoord** — en dat is een ander soort
> onbeantwoord. Hij maakt niets aan (hij zet drie standen goed), dus geen enkele probe kan hem
> vinden; hij staat in de lijst onder "niet vast te stellen". Uitgerekend de migratie die hieronder
> "de enige die vóór livegang moet" heet, is dus de enige die geen automatische controle kan halen.
> Daarom heeft hij sinds vandaag een eigen CONTROLE-blok onderaan het bestand: één query die zegt
> of de `documents`-bucket privé staat, wat de limiet is en of RLS op `storage.objects` aan staat.
> **Draai die vóór de eerste echte gebruiker.** Staat `public` op true, dan is elk bonnetje van elke
> gebruiker met een geraden URL op te halen, en er gaat niets stuk dat iemand zou opmerken.
>
> De tekst hieronder is bewaard zoals ze op 29 juli was.
>
> ### (29 juli) Nog open: vijf — één daarvan vóór de eerste echte gebruiker
>
> **`storage_bucket_hardening.sql`** — de enige op deze lijst die vóór livegang moet. Hij
> verandert vandaag NIETS: op 29 juli is gemeten dat de `documents`-bucket privé staat en de app
> deelt uitsluitend via ondertekende URL's. Het probleem is de herkomst van die stand — één
> vinkje in een dashboard, in geen enkel bestand, door geen enkele test bewaakt. Zet je ooit een
> tweede omgeving op (staging, herstel na een incident), dan begint die op de Supabase-standaard
> en staat elk bonnetje, elk bankafschrift en elke factuur-PDF publiek zonder dat er iets misgaat
> op een manier die opvalt. Dit legt de stand vast in code. Draai hem.
>
> **`cron_runs.sql`** — legt vast DÁT een cron gedraaid heeft. Zonder deze tabel blijft de
> hartslag in `/api/health` leeg: valt email-sync, reminders of quarter-close stil, dan is er geen
> scherm dat het toont en geen mail die uitblijft die iemand mist. Je merkt het bij de
> kwartaalafsluiting die nooit kwam. Niet stukmakend, wel de reden dat je health-pagina anders
> minder weet dan ze suggereert.
>
> **`bank_ignore_reason.sql`** — een reden bij een genegeerde bankregel. Kolom is NULL voor alles
> wat er al staat; zonder de migratie blijft de reden simpelweg leeg. Mag wachten.
>
> **19 · `bank_statement_periods.sql`** — onthoudt per bankafschrift welke periode het beslaat
> en met welke begin- en eindsaldi. Zonder deze tabel kan niemand zien dat er een MAAND
> ontbreekt: wie januari en maart uploadt heeft twee bestanden die allebei perfect kloppen, en
> `bankTxCount` is niet nul, dus ook de readiness zwijgt. De parser las die saldi al; ze werden
> nergens bewaard.
>
> Draait de migratie niet, dan vervalt stil alleen deze ene controle — de app draait er verder
> ongewijzigd zonder. Genummerd 19, niet 13: die tak was los ontstaan en had 13 al vergeven aan
> `invoice_archive_reason.sql`. Dat is precies het soort botsing waar de waarschuwing bovenaan
> dit document over gaat, dus geldt ook hier: `WELKE_MIGRATIES_STAAN_ER.sql` is de waarheid,
> deze regel is een bewering.
>
> **18 · `search_engine_clients_kvk_city.sql`** — twee trigram-indexen op `clients.kvk_number`
> en `clients.city`, plus `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
>
> Dit is de enige in de hele reeks die je met een gerust hart kunt laten liggen, en dat is geen
> inschatting maar wat het bestand over zichzelf zegt: *"Geen schema-, data- of
> gedragswijziging — puur snelheid."* Zoeken op KVK-nummer en plaats **werkt vandaag al**; het
> doet een scan die door `.eq(user_id)` per gebruiker begrensd blijft. Bij een handvol klanten
> is dat microseconden; bij een groot klantenregister loont de index. Twee CREATE INDEX-regels,
> vijf seconden, geen risico — dus draai hem gerust, maar er is niets stuk tot je dat doet.
>
> ### De terugvalpaden blijven staan
>
> Ze kosten niets (ze vuren alleen op een fout) en ze houden een verse dev- of
> staging-database werkend zolang die migraties daar nog niet gedraaid zijn. Elke migratie in
> dit project is zo geschreven dat de code er ZONDER ook werkt: de negeer-API archiveert dan
> zonder notitie, het kasboek maakt één regel per factuur in plaats van per termijn, de
> SnelStart-push valt terug op het oude pad. De eigenaar mist dan een label of een verbetering
> — nooit een functie die stukgaat, en nooit stille schade.
>
> Eén terugvalpad is bij het toepassen wél aangescherpt: het regels-eindpunt slikte vóórdien
> élke fout en antwoordde "geen regels". Dat was verdedigbaar toen de tabel nog niet bestond,
> maar nu gevaarlijk — bij een RLS- of verbindingsfout zou het beheerscherm "geen regels"
> tonen terwijl er regels zijn die post tegenhouden, en dan kan de eigenaar ze niet opheffen.
> Het onderscheidt nu "tabel bestaat niet" (stille lege lijst) van een echte fout (die wordt
> gezegd).
>
> ### En draai altijd het CONTROLE-blok
>
> Waar er één staat: draaien. Dat is het verschil tussen "toegepast" en "toegepast en
> gecontroleerd", en het heeft in deze codebase al twee echte fouten opgeleverd die op geen andere
> manier zichtbaar waren: een 42P10 op een partiële index, en een functie die vijf kolommen noemde
> die niet bestonden.
>
> *(Deze alinea zei "onderaan elk migratiebestand staat er één". Op 15 augustus 2026 geteld: 35
> van de 104. Zie de correctie verderop — en `ai_budget_settle.sql`, dat er geen had en daardoor
> maandenlang ongemerkt niet toegepast was.)*
>
> ### Wat ik NIET weet
>
> `invoice_archive_reason.sql`, `email_sender_rules.sql`, en de drie die uit andere takken
> bij kwamen (`cash_settlement_per_instalment.sql`, `invoice_schedules.sql`,
> `search_engine_clients_kvk_city.sql`). Geen van deze is urgent — de code werkt er zonder
> ook, zie de noot hieronder — maar raad er niet naar: draai de query.
>
> ### Waarom "niet urgent" hier echt niet urgent betekent
>
> Elke migratie in dit project is zo geschreven dat de code er ZONDER ook werkt. De
> negeer-API valt bij een ontbrekende kolom terug op archiveren *zonder* notitie, de
> Genegeerd-query op de kale kolomlijst (geen leeg tabblad), het regels-eindpunt antwoordt
> "geen regels", het kasboek maakt één regel per factuur in plaats van per termijn, en de
> SnelStart-push valt terug op het oude pad. De eigenaar mist tot die tijd een label of een
> verbetering — nooit een functie die stukgaat, en nooit stille schade.
>
> De twee met een échte scherpe kant waren 11 (een gekoppelde boekhouder kon het IBAN op een
> openstaande inkoopfactuur herschrijven) en 15 (twee gelijktijdige verzoeken konden dezelfde
> factuur twee keer in het wettelijke inkoopboek zetten). **Beide zijn toegepast.**
>
> ### En draai altijd het CONTROLE-blok
>
> Onderaan elk migratiebestand staat er één. Dat is het verschil tussen "toegepast" en
> "toegepast en gecontroleerd", en het heeft in deze codebase al twee echte fouten
> opgeleverd die op geen andere manier zichtbaar waren: een 42P10 op een partiële index, en
> een functie die vijf kolommen noemde die niet bestonden.

> ### Over de urgentie van 11 — eerlijk bijgesteld
>
> Bij het overbrengen is dit gat te scherp gerapporteerd. De correctie, zelf geverifieerd:
>
> `acc_status_owner_all` staat inderdaad als `FOR ALL` zonder koppelingseis, dus élke
> ingelogde gebruiker kan met de anon-sleutel rijen schrijven tegen een willekeurige
> document-uuid. Maar **geen enkel eigenaarsscherm rendert `vraag_text`**:
> `dashboard/brug/page.tsx:189-201` leest die kolom alleen wanneer `isAccountant`, en het
> comment daar zegt het zelf ("A ZZP owner gets an empty map"). Een grep op `vraag_text`
> geeft precies twee levende plekken: de schrijver en die boekhouder-only lezer. De unieke
> index `(accountant_id, subject_type, subject_id)` sluit bovendien uit dat een aanvaller de
> rij van een échte boekhouder overschrijft.
>
> Dus: **een latent schrijfgat dat dicht moet, geen live injectie in andermans dashboard.**
> Het wordt pas live op de dag dat er een eigenaarsscherm bijkomt dat die vraag toont — en
> dat scherm is precies het volgende dat gebouwd zou moeten worden. Vandaar: eerst 11, dan
> dat scherm. Niet andersom.
>
> Het IBAN-gat in dezelfde migratie is wél onmiddellijk echt: een gekoppelde boekhouder kan
> `vendor_iban` op een openstaande inkoopfactuur herschrijven en de klant tikt dat nummer
> over in zijn bank.

> **Alles hieronder is idempotent en verwijdert niets.** Twijfel je of iets al is toegepast:
> gewoon opnieuw draaien. Een migratie die er al staat is een no-op.
>
> Draai ze in de **Supabase SQL-editor**. Die draait als `service_role`, en dat is nodig:
> het slot uit stap 3 blokkeert wijzigingen aan abonnementskolommen door gewone gebruikers.

---

## Stap 0 — Controleer drie dingen die géén migratie aanmaakt

Drie migraties hieronder bouwen voort op objecten die in productie bestaan maar die door
**geen enkel bestand in deze repo** worden aangemaakt (ze zijn ooit direct in het
Supabase-dashboard gemaakt). Ze bestaan vrijwel zeker — de bijbehorende functies werken —
maar dit kost vijf seconden en bespaart een onbegrijpelijke foutmelding halverwege:

```sql
select
  to_regclass('public.rate_limits')        as rate_limits,        -- nodig voor stap 5
  to_regclass('public.deletion_requests')  as deletion_requests,  -- nodig voor stap 6
  (select count(*) from pg_trigger
    where tgname = 'on_auth_user_created') as signup_trigger;     -- nodig voor stap 4
```

Verwacht: twee tabelnamen en `1`. Is er iets `null` of `0`, meld dat dan even — die stap
moet dan anders.

---

## De volgorde

### 1. `circle_integrity_and_indexes.sql` — *blokkeert bestaande functies*

Kolommen waar de code al van uitgaat (`content_hash`, `shared`, `needs_reauth`) plus
FK-indexen. Stond al langer open in `docs/WORK_QUEUE.md`. Niets nieuws van deze tak, maar
dit is het enige dat *nu al* iets stuk laat gaan.

### 2. `ledger_daily.sql` — *blokkeert bestaande functies*

De grootboek-kruiscontrole (hoek 3 van de afletterdriehoek). **Zonder deze tabel kan een
grootboek-upload niet opslaan.** Ook al langer open.

### 3. `subscription_plans_fair_use.sql`

Trekt `subscription_plan` gelijk met wat de voorwaarden publiceren: `free | plus |
boekhouder`. Het oude model kende `pro` en `boekhouder_pro` — plannen die nooit zijn
geactiveerd en die de voorwaarden niet meer kennen.

**Moet vóór stap 4 en 5.** De Stripe-webhook schrijft de waarde `'plus'`; staat de oude
CHECK er nog, dan weigert Postgres de **hele rij** — inclusief de statuskolom die bepaalt of
iemand Plus heeft.

### 4. `billing_subscription.sql`

`subscription_status`, `stripe_customer_id`, `current_period_end`, plus het **slot tegen
zelfbediening**. Zonder die trigger kan elke ingelogde gebruiker zichzelf vanuit de
browserconsole `active` geven: `profiles_update_own` kent geen kolombeperking.

Deze versie heeft **geen proefklok** — geen `trial_ends_at`, en de controlequery onderaan
vraagt expliciet of die kolom afwezig is. Zie `docs/PORT_VAN_BILLING_TAK.md` §2.4.

### 5. `account_purpose_archief.sql`

`profiles.account_purpose` (`boekhouden | archief`) en de aangepaste `handle_new_user()`.
Maakt de voordeur van `/bewaarplicht` echt: wie via `?doel=archief` binnenkomt slaat de
wizard over en landt in zijn kluis.

**Hangt af van de trigger uit stap 0.** Bestaat die niet, dan valt de app terug op het
zelfherstel in `/register` en `/dashboard/kluis` — het werkt dan nog steeds, alleen via een
omweg.

### 6. `fair_use_usage.sql`

`usage_counters` + `fair_use_consume()` + `fair_use_release()`. Hierna meet het beleid
eerlijk gebruik werkelijk, in plaats van alleen gepubliceerd te zijn.

Tot je dit toepast faalt alles **open**: er wordt niets geteld en niemand wordt gepauzeerd.
Dat is de veilige kant, maar het betekent ook dat de begrenzing zolang volledig op de
dagzekering uit stap 7 rust.

### 7. `ai_spend_guard.sql` — ⚠️ **de belangrijkste als je er maar één doet**

Het euro-plafond per dag op Anthropic-uitgaven, plus een wérkende anonieme ratelimiet.

Waarom die urgentie: de limiet op `/api/tools/scan-invoice` bucketde op `'scan-ip:<ip>'`
tegen een `uuid`-kolom met foreign key naar `profiles`. Elke aanroep gaf een cast-fout en de
limiter faalde open — de **login-vrije scanner die de betaalde API aanroept had in de
praktijk nooit een plafond**.

> ⚠️ **Deze migratie is één keer gecorrigeerd nadat hij was toegepast.** De eerste versie
> gebruikte een kaal `ON CONFLICT (bucket_key, endpoint)` terwijl de unieke index PARTIEEL
> is; Postgres leidt een partiële index daar niet uit af en gaf `42P10` bij elke aanroep.
> Omdat `checkRateLimitByKey()` bewust DICHT faalt, betekende dat: de login-vrije scanner
> zou ELK verzoek hebben geweigerd — een dichte deur op een marketingpagina.
>
> Gevonden door de CONTROLE tegen een echte database te draaien, niet door te lezen: `tsc`,
> 183 tests en de productiebuild raken geen SQL aan. **Draai deze migratie opnieuw als je
> hem vóór 26 juli 2026 had toegepast** — hij is idempotent en vervangt alleen de functie.

*(Hij staat op 7 en niet op 1 omdat 1 en 2 bestaande functies blokkeren. Zit je in tijdnood:
doe deze eerst en de rest morgen.)*

### 8. `retention_purge.sql`

`deletion_requests.purged_at` + de index, zodat AVG-verwijdering idempotent kan draaien.

**Zet `RETENTION_PURGE_ENABLED` NIET op `true`** vóór stap 10. Zonder die tabel weet de purge
niet wie hij *niet* mag aanraken. Sinds stap 10 bestaat die koppeling wél, en faalt de cron
bovendien DICHT als hij `kluis_subscriptions` niet kan lezen: dan wist hij niets. Niets in deze app kan vóór 2033 aan de beurt zijn; meldt
een dry run nu al een kandidaat, dan is er een datum verkeerd gezet.

### 9. `snelstart_connection.sql` — *alleen als je de koppeling wilt*

Twee tabellen voor de SnelStart B2B-koppeling. De maatwerksleutel gaat in Supabase Vault,
nooit in een gewone kolom. **Vereist ook `SNELSTART_SUBSCRIPTION_KEY` in de omgeving** — die
heb je nog niet, dus deze mag gerust wachten.

### 10. `kluis_subscriptions.sql` — ⚠️ **nieuw, vóór er één euro binnenkomt**

Wie er een Bewaarkluis heeft gekocht en tot welk jaar.

Dit moet er zijn **voordat** `STRIPE_PRICE_ID_KLUIS_YEAR` wordt ingevuld. De Bewaarkluis
rekent af met `mode: "payment"` — een eenmalige betaling zonder abonnement — en de webhook
zocht bij elk event een subscription id. Zonder deze tabel en de bijbehorende
webhook-afhandeling betekende een Bewaarkluis-betaling letterlijk: *geld aangenomen,
verplichting nergens vastgelegd.* Erger dan het product niet hebben.

Het is ook het hek dat `RETENTION_PURGE_ENABLED` eindelijk aan mag laten: een account met
een lopende kluis wordt overgeslagen, ook als zijn eigen zeven jaar verstreken zijn.

---

## Samengevat

| # | Bestand | Waarom nu |
|---|---------|-----------|
| 1 | `circle_integrity_and_indexes.sql` | blokkeert bestaande functies |
| 2 | `ledger_daily.sql` | blokkeert bestaande functies |
| 3 | `subscription_plans_fair_use.sql` | moet vóór 4 en 5 |
| 4 | `billing_subscription.sql` | sluit een gat dat pas ontstaat als de kolommen er zijn |
| 5 | `account_purpose_archief.sql` | maakt de archief-voordeur echt |
| 6 | `fair_use_usage.sql` | laat het eerlijk gebruik meten |
| 7 | `ai_spend_guard.sql` | **de enige harde bodem onder je Anthropic-rekening** |
| 8 | `retention_purge.sql` | AVG-verwijdering; blijft dry run |
| 9 | `snelstart_connection.sql` | pas nodig met een subscription key |
| 10 | `kluis_subscriptions.sql` | **vóór de eerste Bewaarkluis-betaling** |
| 11 | `cash_entry_soft_delete.sql` | zet zachte verwijdering in het kasboek AAN; tot dan blijft een kasboeking hard verwijderd |
| 12 | `invoice_line_discount.sql` | korting per factuurregel |
| 13 | `creditnota_partial.sql` | een creditnota voor een DEEL van een factuur |
| 14 | `offerte_akkoord.sql` | de klant kan zelf akkoord geven op een offerte |
| 15 | `invoice_bijlage.sql` | één eigen bestand met de factuurmail mee |
| 16 | `rpc_anon_revoke.sql` | ⚠️ **de geld-functies zijn aanroepbaar zonder account — draai deze als eerste** |
| 17 | `function_search_path.sql` | een vast zoekpad op de negen eigen functies — hygiëne, geen haast |
| 18 | `bank_auto_book_blocked.sql` | een teruggedraaide automatische boeking komt nu binnen het uur terug |
| 19 | `accountant_vat_deduction_guard.sql` | een gekoppelde boekhouder kan rubriek 5b van de klant verzetten |
| 20 | `creditnota_per_rate_ceiling.sql` | twee gelijktijdige deel-creditnota's crediteren dezelfde regel twee keer |

**Over 18 — wat er zonder gebeurt.** runBankAutoConfirm koppelt een bankregel aan een factuur en
zet die op betaald, en belooft in zijn eigen kop dat het omkeerbaar is: *"fully reversible (owner
can unlink)"*. Het scherm zegt het tegen de eigenaar in nog kortere woorden — *"One tap on
Ontkoppelen above undoes it."*

Die belofte houdt geen uur stand. Ontkoppelen zet de regel terug op `pending` en de factuur op
`received` — precies de toestand waaruit auto-confirm boekt. Het bewijs is niet veranderd
(hetzelfde bedrag, dezelfde IBAN, dezelfde tegenpartij), dus de volgende cron-ronde neemt dezelfde
beslissing en legt dezelfde koppeling terug. Een leverancier die maandelijks € 89,00 incasseert,
een openstaande januarifactuur en een afschrijving in maart: de cron zet januari op betaald met
betaaldatum 03-03, de eigenaar ziet de verkeerde maand en ontkoppelt, en binnen het uur staat het
er weer. Onder het kasstelsel staat de BTW van die factuur dan in het verkeerde kwartaal.

Zonder de kolom gedraagt de app zich exact zoals nu: de code vraagt eerst of hij bestaat
(`columnExists`) en laat het filter anders weg — een ontbrekende kolom in dat filter zou de hele
lezing laten falen, en dat is geen degradatie maar een auto-confirm die voor iedereen stilvalt.

**Over 16 — dit is de enige met haast.** De andere migraties voegen iets toe; deze sluit iets af
dat open staat. Een reeks `SECURITY DEFINER`-functies bewaakt zichzelf met
`IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id`, waarvan de gedachte is: "service_role
heeft geen uid, dus dat is de server". Klopt — maar `anon` heeft óók geen uid, en `anon` is de rol
achter de publieke sleutel die in elke browserbundel meegaat. Nagemeten op de productiedatabase:
`SET LOCAL ROLE anon; SELECT auth.uid() IS NULL` → true, en `anon` had EXECUTE op alle dertien.

Het zwaarste geval is niet het grootste bedrag maar het onomkeerbare: `seed_invoice_counter` kan
door `GREATEST` alleen vooruit, dus verlagen kan niemand — maar de teller van een vreemde op
999999999 zetten wél, en een kapotte Art. 35-reeks is niet te herstellen. Daarnaast staan het
boeken en verplaatsen van betalingen open op andermans administratie.

Intrekken in plaats van dertien guards aanscherpen: een rechtencontrole draait vóór de body en is
niet te omzeilen door `SECURITY DEFINER`. De guards blijven staan voor ingelogde gebruikers
onderling. Geen enkele aanroep in deze app gebeurt als `anon` — alle call sites nagelopen — dus er
gaat niets van kapot; `service_role` wordt in de migratie expliciet opnieuw gemachtigd.

> **Stand op 15 augustus 2026, gelezen uit de productiedatabase:** deze migratie is TOEGEPAST.
> `has_function_privilege('anon', …)` is nu false voor alle dertien, `service_role` houdt overal
> EXECUTE, en de zes functies die het scherm aanroept houden `authenticated`. De linter noemt onder
> `anon` alleen nog de vijf leeshulpjes die met opzet buiten deze migratie bleven — zie hieronder.

> **Stand op 15 augustus 2026, gelezen uit de productiedatabase:** 17 is TOEGEPAST. Alle negen
> tonen `search_path=public, pg_catalog, pg_temp`; nul staan er nog los. Daarna een UPDATE op
> `invoices` binnen een teruggedraaide transactie: de hele triggerketen liep zonder fout, dus elke
> functie vindt haar namen onder het nieuwe pad. Er is niets geschreven.

**Over 17.** Alleen metadata: `ALTER FUNCTION … SET search_path`, geen functie wordt herschreven.
Er is **geen haast**, en dat staat er expliciet bij omdat de vorige regel wél haast had. Op de
productiedatabase nagemeten: geen van de negen is `SECURITY DEFINER`, en noch `anon` noch
`authenticated` heeft CREATE op énig schema — twee onafhankelijke redenen waarom er niets te kapen
valt. Het wordt toch vastgezet omdat dat omstandigheden zijn en geen afspraken: wie morgen één van
deze bewakers `SECURITY DEFINER` maakt, erft anders stilzwijgend een echte kwetsbaarheid.
Terugdraaien is één regel per functie (`RESET search_path`).

---

## De eerste echte draai van de inventarislijst — 15 augustus 2026

Vier meldingen kwamen eruit. **Twee waren een meetfout, twee zijn echt open.** Dat onderscheid is
het halve werk: een migratie opnieuw draaien omdat een lijst zich vergiste, is hoe je dubbele
indexen en dubbele policies krijgt.

### Meetfout — er is niets aan de hand, de vraag was verkeerd

**`documents_shared_and_storage_policies.sql`** meldde drie ontbrekende policies
(`documents_upload`, `documents_read`, `documents_delete`). Die staan op **`storage.objects`**, want
daar staan de bestanden — en de query keek alleen in `public`. De generator is nu schema-bewust en
zoekt ze waar ze horen. *Niet opnieuw aanmaken.*

> De `*_own`-policies op `public.documents` die je ernaast zag (`documents_select_own`,
> `documents_insert_own`, `documents_delete_own`, `documents_owner_all`, `documents_update_own`)
> zijn géén hernoemde versies hiervan. Ze komen uit andere migraties en gaan over een andere tabel.
> Ze als "alternatieve namen" behandelen zou twee onafhankelijke dingen aan elkaar knopen.

**`documents_content_hash_unique.sql`** meldde `document_is_referenced` als ontbrekend. Die functie
is **steiger, geen fundament**: ze bestaat alleen om binnen diezelfde migratie de eenmalige
dedup-`DELETE` te rangschikken, en geen regel in `src/` roept haar aan. Het blijvende resultaat is
de unieke index `uq_documents_user_content_hash` — en die staat er. De migratie is dus toegepast.
*Niets herstellen.*

De vierde melding uit dat bestand, de index `idx_documents_user_content_hash`, ontbreekt **echt** —
en hoort te ontbreken. Hij is er ooit gekomen met het argument dat een UNIQUE de "nog een keer
uploaden"-functie zou breken; `documents_content_hash_unique.sql` heeft die afweging later
omgedraaid en legt `uq_documents_user_content_hash` op dezelfde twee kolommen. Die dekt dezelfde
lookups. Hem alsnog aanmaken is een tweede index op dezelfde kolommen: schrijfkosten zonder
leeswinst. *Niet aanmaken.*

Beide staan nu in `NIETS_BEWIJZEND` in `scripts/migration-inventory.ts`, **met de reden**, en die
reden komt onderaan de gegenereerde lijst terecht. Een poort eist dat zo'n uitzondering naar een
object wijst dat de migratie écht aanmaakt — anders wordt die tabel de plek waar een falende
migratie zich verstopt.

### Inmiddels gesloten: `bookkeeping_date_sane.sql` — TOEGEPAST, en volledig

> **Gemeten met het CONTROLE-blok van de migratie zelf, 15 augustus 2026.** Alle vier de triggers
> staan er, en de namen komen exact overeen met wat de `DO`-lus hoort te zetten:
>
> | tabel | trigger |
> |---|---|
> | `invoices` | `invoices_payment_date_sane` |
> | `bank_tx_invoices` | `bank_tx_invoices_paid_on_sane` |
> | `cash_entries` | `cash_entries_entry_date_sane` |
> | `daily_turnover` | `daily_turnover_turnover_date_sane` |
>
> Vier van de vier is hier het hele punt: die lus SLAAT EEN TABEL OVER als de kolom er nog niet is
> (`RAISE NOTICE 'overgeslagen'`). Geen enkele is overgeslagen, dus het vangnet ligt onder alle vier
> de geldkolommen en niet onder drie.
>
> En daarmee staat de functie er ook — dat is een gevolgtrekking, geen aanname: een trigger kán niet
> bestaan zonder de functie die hij aanroept, en die functie laten vallen vereist `CASCADE`, wat de
> triggers zou meenemen. De eerdere melding `OPEN` was dus juist op het moment van meten, en is nu
> achterhaald.

**Wat hierna nog één keer gecontroleerd moet worden.** Het CONTROLE-blok heeft een DERDE deel dat
de bestaande rijen mét een onmogelijke datum opsomt. Dat is het deel dat nu kan bijten: de triggers
binden alleen nieuwe schrijfacties, maar zodra ze staan mislukt **élke** `UPDATE` van een rij die
al fout was — en dat merkt de ondernemer pas als hij zo'n factuur probeert aan te passen, met een
foutmelding over een datum waar hij niets aan deed. Komen er regels uit, repareer die datums
voordat iemand ertegenaan loopt.

### De volledige inventarislijst, gedraaid — 15 augustus 2026

**95 meetbare migraties: 94 TOEGEPAST, 1 OPEN, en nul GEDEELTELIJK.**

Die laatste nul is de belangrijkste uitkomst en de makkelijkste om overheen te lezen. GEDEELTELIJK
betekent halverwege gestopt — een kolom toegevoegd en de index eronder niet, een functie zonder
haar trigger. Dat is de stand waar geen enkel scherm iets van laat zien en waar niemand naar keek
omdat er geen manier was om te kijken. Er is er geen.

De negen die geen objecten aanmaken staan apart; van die negen is er één die er echt toe doet, en
dat is `storage_bucket_hardening.sql` — zie de correctie bovenaan.

### Niet gesloten: `ai_budget_settle.sql` — de melding en de meting spreken elkaar tegen

> **Gemeld als toegepast; de lijst zegt `OPEN`, 0 / 1, `function public.ai_budget_settle`
> ontbreekt.** Bij een verschil tussen een melding en een lezing wint de lezing — dat is de hele
> reden dat deze lijst bestaat.
>
> Het is géén meetfout. De probe vraagt naar `public.ai_budget_settle` en matcht op `proname`, dus
> los van de argumenten; de migratie maakt exact die naam; en `src/lib/ai-budget.ts` roept exact
> die naam aan. Anders dan bij de storage-policies is hier niets mis met de vraag.
>
> De waarschijnlijkste oorzaak is de vorm van het bestand. Het is één `BEGIN; … COMMIT;` — faalt er
> binnenin iets, dan rolt ALLES terug en blijft er niets over. En sinds gisteren staat er onderaan
> een CONTROLE-blok dat volledig uit commentaar bestaat: wie alleen dat staartje uitvoert, krijgt
> "Success. No rows returned" te zien terwijl er niets is gebeurd. Dat blok is er op mijn verzoek
> bij gekomen, dus die valkuil heb ik zelf gelegd.
>
> **Doe dit:** voer het bestand uit vanaf `BEGIN;` tot en met `COMMIT;` — de regels **48 t/m 92**, niet het
> commentaar eronder — en kijk of de editor een fout meldt in plaats van alleen naar het
> groene vinkje. Draai daarna de eerste query uit het CONTROLE-blok: één rij, `anon` en
> `authenticated` false, `service_role` true.

> **(Eerder genoteerd:) GEMELD door de eigenaar, nog niet nagemeten.** De verbinding
> met de database was weg op dat moment, dus dit is een bewering en geen lezing. Draai
> `docs/WELKE_MIGRATIES_STAAN_ER.sql` (die vraagt naar `function ai_budget_settle`) of het
> CONTROLE-blok dat nu onderaan die migratie staat.
>
> **En lees dit vóór je een grens kiest.** De functie raakt alleen de rij van VANDAAG aan en maakt
> nooit een dag aan. Elke dag die vóór het toepassen is weggeschreven draagt dus nog de
> RESERVERING — bewust aan de ruime kant — en niet het werkelijke verbruik. Het advies hierboven om
> met `AI_DAILY_BUDGET_EUR=0` "je werkelijke uitgaven te leren kennen" geldt dus vanaf vandaag; de
> oudere rijen lezen te hoog, en een grens die daarop wordt gekozen valt te ruim uit — de verkeerde
> kant op voor een zekering.

### De migratie waar dit over ging

| | `ai_budget_settle.sql` |
|---|---|
| Wat mist | functie `ai_budget_settle` |
| Weggegooid door een latere migratie? | nee, door geen enkele |
| Aangeroepen door | `settleAiBudget` in `src/lib/ai-budget.ts` |
| Wat er nu gebeurt | de aanroep faalt, wordt opgevangen, en logt "the estimate stands" |

**`ai_budget_settle.sql`.** De zekering onder de Anthropic-rekening werkt in twee tellen:
`ai_budget_consume` RESERVEERT een schatting vóór de call, `ai_budget_settle` corrigeert die
achteraf naar het echte verbruik. De tweede helft ontbreekt, dus de schatting blijft staan. De
schatting is bewust aan de ruime kant — dus de zekering slaat te VROEG door, niet te laat. Geen
weglopend geld.

Wat het wél kost is de meting zelf, en die is de reden dat dit hier staat: dit document adviseert
`AI_DAILY_BUDGET_EUR=0` voor de eerste dagen, *"dat telt wél maar begrenst niet, zodat je je
werkelijke uitgaven leert kennen voordat je een getal kiest"*. Zonder de settle is dat getal te
hoog. Je kiest een grens op basis van een cijfer dat niet klopt.

**`bookkeeping_date_sane.sql`.** Zet `BEFORE INSERT OR UPDATE`-triggers op vier geldkolommen —
`invoices.payment_date`, `bank_tx_invoices.paid_on`, `cash_entries.entry_date`,
`daily_turnover.turnover_date` — die een datum buiten `[2000-01-01, vandaag + 7]` weigeren. Het is
uitdrukkelijk *"de absolute ondergrens onder de striktere regel van de app, niet een tweede mening
erover"*. De app bewaakt dus nog steeds; wat ontbreekt is het vangnet eronder, voor elke weg die
`payment-date.ts` niet passeert — een import, het service-role-pad, een route die er later bij komt.
Een typefout als `0202` in plaats van `2026` zou nu blijven staan en een btw-tijdvak verschuiven.

**Vóór het toepassen, en dit is geen formaliteit:** onderaan dat bestand staan `SELECT`-regels die
bestaande rijen mét zo'n onmogelijke datum opsommen. Draai die eerst. De triggers gelden alleen voor
nieuwe schrijfacties, maar zodra ze staan mislukt élke UPDATE van een rij die al fout is. Staan er
regels in die uitkomst, repareer die eerst.

Allebei zijn idempotent (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` gevolgd door
`CREATE TRIGGER`, met een kolomcontrole eromheen) en maken dus niets dubbel aan.

### `rpc_anon_revoke.sql` — geen bevinding, en dat klopt

Die maakt niets aan en kan dus niet via een object worden bewezen; ze staat bij "niet vast te
stellen". Daarom heeft ze een eigen CONTROLE-blok, en dat is gedraaid.

> **Gemeten, 15 augustus 2026 — dertien rijen, en alle drie de kolommen kloppen.**
>
> `anon` is **false** op alle dertien. `service_role` is **true** op alle dertien — dat is de regel
> die ertoe doet als het misgaat, want zonder die kolom zou deze migratie de app zelf buitensluiten.
>
> En `authenticated` staat op **precies zes**: `next_invoice_seq`, `apply_manual_payment`,
> `apply_bank_payment`, `allocate_bank_payment`, `book_bank_batch`, `move_invoice_payment` — exact
> de zes die een scherm met de sessieclient aanroept. De zeven die alleen via de pipeline lopen
> (`seed_invoice_counter`, `recompute_invoice_amount_paid`, `fair_use_consume`, `fair_use_release`,
> `confirm_bank_payment`, `handle_new_user`, `assert_credit_within_original`) staan op false. Dat is
> niet "ook dicht": het is de tweede lijst uit de migratie, en hij is regel voor regel geraakt.
>
> Dat er dertien rijen TERUGKOMEN is zelf ook een uitkomst: geen van de functies is bij het
> intrekken per ongeluk verdwenen.
>
> Een poort (`[ANON-RPC]`) houdt die zes-tegen-zeven verdeling vast: voegt iemand een aanroep met
> de sessieclient toe aan een van de zeven, dan faalt hij vóór een gebruiker het merkt.

Ongemoeid laten.

---

## Wat de linter meldt en met opzet zo blijft

Niet elke melding is een taak. Deze drie zijn nagekeken en blijven staan, met de reden erbij — een
lijst waar bekende-en-geaccepteerde meldingen tussen staan zonder uitleg is een lijst die niemand
meer leest.

- **Vijf `SECURITY DEFINER`-functies die `anon` mag aanroepen** — `acting_for_owner`,
  `is_my_accountant_client`, `has_active_invoice_mandate`, `has_active_confirm_mandate`,
  `audit_row_is_about_me`. Alle vijf zijn `STABLE`/`IMMUTABLE`: ze veranderen niets en geven een
  boolean of één uuid terug. Ze worden samen in **19 RLS-policies** aangeroepen, en een policy
  draait als de bevragende rol — `anon` het recht afnemen zou dus LEZEN breken op de publieke
  pagina's in plaats van schrijven dichtzetten. Dat is de verkeerde kant op.
- **`rls_enabled_no_policy` op `ai_spend_daily`, `cron_runs`, `email_skipped_attachments`** — RLS
  aan met nul policies betekent **alles geweigerd** voor `anon` en `authenticated`; alleen
  `service_role` komt erlangs, en dat is precies wat deze drie tabellen nodig hebben. De linter
  meldt het als INFO omdat het meestal een vergeten policy is; hier is het de bedoeling.
- **`extension_in_public` op `pg_trgm`** — verplaatsen betekent elke index en elke functie die
  eraan hangt opnieuw opbouwen, voor een melding die geen rechten verruimt.

Eén melding is **wél** een taak en staat niet in SQL: **Leaked Password Protection** staat uit.
Aanzetten is één schakelaar in het Supabase-dashboard onder *Authentication → Policies*; Supabase
controleert een nieuw wachtwoord dan tegen HaveIBeenPwned.

**Over 12 t/m 15.** Deze horen bij vier functies die al op `main` staan. Ze hebben geen onderlinge
volgorde en mogen los van elkaar. **Zonder de migratie werkt de app precies als de dag ervoor** —
elke functie is aan de kolom vastgeknoopt, niet aan een schakelaar, en de code weigert het NIEUWE
in plaats van het bestaande stuk te maken:

- **12** — een concept met een regelkorting wordt teruggedraaid en de ondernemer leest waarom
  (`/api/invoice/draft`, HTTP 503). Een factuur zonder regelkorting merkt niets.
- **13** — de oude unieke index laat één creditnota per factuur toe, dus een tweede deelcreditnota
  wordt door de database geweigerd. Het plafond (Σ|credits| ≤ |origineel|) staat óók in de route en
  in `partial-credit.ts`, dus het bedrag kan nooit te hoog worden; de migratie voegt de
  vergrendeling tegen twee gelijktijdige verzoeken toe.
- **14** — de offertemail gaat zonder akkoordknop de deur uit, met een luide regel in het log
  (`send-offerte`). De offerte zelf verstuurt gewoon.
- **15** — de bijlage kan per verzending worden meegegeven maar wordt niet op de factuur onthouden.
  De weigering blijft vóór het factuurnummer staan, dus er ontstaat nooit een gat in de reeks.

> **Stand op 15 augustus 2026 — 11 is TOEGEPAST, GEMELD door de eigenaar en niet nagemeten.**
> Dat onderscheid staat er omdat de waarschuwing bovenaan dit document er precies over gaat: de
> verbinding met de database was weg op het moment van melden, dus dit is een bewering en geen
> lezing. Draai `docs/WELKE_MIGRATIES_STAAN_ER.sql` of het CONTROLE-blok onderin de migratie om er
> een lezing van te maken. Let daarbij vooral op de definitie van
> `cash_entries_one_settlement_per_instalment`: staat `deleted_at` er niet in, dan is de DROP/CREATE
> niet gedraaid en houdt een verwijderde tegenboeking haar plek bezet.
>
> Wat er vóór toepassing wél is gemeten: beide voorwaarden stonden er (`invoice_id`,
> `settlement_id`), de index stond nog in zijn oude vorm, en de tabel telde 14 rijen. Dat was geen
> formaliteit — dit bestand faalt halverwege, ná de geslaagde ALTER, op een database waar die twee
> kolommen ontbreken.
>
> **De code-kant is wél gemeten, en die is compleet.** Alle 24 aanroepen op `cash_entries` in
> `src/` en `scripts/` vallen aan de goede kant: 18 gaan door `cash-live.ts`, 5 zijn zelf een
> schrijfactie, 1 is de capability-probe. Nul werden alleen vrijgesteld doordat er toevallig een
> insert in de buurt stond — de poort is dus niet groen bij toeval.

**Over 11.** Deze mag op elk moment, ook los van de rest, en er zit geen haast bij: de app werkt er
volledig zonder. De code PROBEERT de kolom (`src/lib/cash-live.ts`) en gedraagt zich zonder hem
precies zoals de dag ervoor — een verwijderde kasboeking wordt dan echt verwijderd, met alleen het
auditspoor als bewijs. Zodra deze SQL staat, gaat zachte verwijdering vanzelf aan: een verwijderde
regel telt nergens meer mee (saldo, kasboek, resultaat, aangifte, readiness, de blokkade op indienen,
zoeken, het pakket voor de boekhouder) maar blijft leesbaar en omkeerbaar. Draai hem NA
`cash_settlement_invoice_link.sql` en `cash_settlement_per_instalment.sql`: onderin wordt hún unieke
index opnieuw gebouwd, en die noemt `invoice_id` en `settlement_id`.

Onderaan een migratiebestand hoort een **CONTROLE**-blok: één query, en het verschil tussen
"toegepast" en "toegepast en gecontroleerd".

> **Geteld op 15 augustus 2026: 35 van de 104 bestanden hebben er een.** Deze regel zei tot vandaag
> "onderaan **elk** bestand", en dat was niet waar — inclusief een paar migraties die in deze
> sessie zelf zijn geschreven. Precies de soort bewering waar de waarschuwing bovenaan dit document
> over gaat, en hier stond ze in dat document zelf.
>
> Het is ook niet vrijblijvend gebleken: `ai_budget_settle.sql` hád er geen, en is maandenlang
> ongemerkt níét toegepast. De zekering onder de Anthropic-rekening telde wel, maar corrigeerde
> nooit. Er was geen query om dat mee te zien.
>
> De 69 zonder blok worden niet met terugwerkende kracht voorzien — dat is veel werk voor weinig,
> en de generieke vraag ("staat deze migratie er?") wordt sinds vandaag beantwoord door
> `docs/WELKE_MIGRATIES_STAAN_ER.sql` voor alle 104. Een CONTROLE-blok beantwoordt de fijnere
> vraag: liep ze ook *goed*. Schrijf er dus een bij elke nieuwe migratie, en bij elke oude die je
> toch al openslaat.

---

## Wat er daarna nog moet (geen SQL)

- **De bedrijfsidentiteit in Vercel**: `NEXT_PUBLIC_COMPANY_KVK`, `_LEGAL_NAME`, `_BTW`,
  `_ADDRESS`. Nu tonen de voorwaarden "(volgt)" — bewust, zodat een leeg veld nooit als een
  echt-maar-onjuist KVK-nummer kan lezen. `/steun` blijft 404 tot er een echt KVK staat.
- **Drie Stripe-prijzen**: `STRIPE_PRICE_ID_PLUS` (€ 19,99/maand, terugkerend, incl. btw),
  `STRIPE_PRICE_ID_PLUS_YEAR` (€ 179,91/jaar, terugkerend, incl. btw) en
  `STRIPE_PRICE_ID_KLUIS_YEAR` (€ 19 per bewaarjaar, eenmalig, incl. btw). Plus
  `STRIPE_WEBHOOK_SECRET`.
- **`AI_DAILY_BUDGET_EUR=0`** voor de eerste dagen: dat telt wél maar begrenst niet, zodat je
  je werkelijke uitgaven leert kennen voordat je een getal kiest.
- **`xlsx` naar 0.20.3**, in een omgeving die `cdn.sheetjs.com` kan bereiken (hier én in de
  andere sessie geeft die host 403).
