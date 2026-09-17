# Jouw lijst — alles wat alleen jij kunt doen

*Bijgewerkt 29 juli 2026, met een aanvulling van 19 augustus bovenaan. Elk codepunt op deze tak
is af, getest en gepusht; wat hier staat is de rest.*

> **Lees dit als één ding:** de app is vandaag veilig live te zetten. Er wordt niemand
> gefactureerd, niemand buitengesloten en er wordt niets verwijderd, ongeacht wat je van
> deze lijst wel of niet doet. Alles hieronder maakt iets *mogelijk* — geen enkel punt
> repareert iets dat stuk is.

---

## −2. Eén punt erbij, van 2 september: het demowachtwoord

**☐ Draai het wachtwoord van `demo@boekbrug.nl`**

Supabase → Authentication → Users → `demo@boekbrug.nl` → wachtwoord opnieuw instellen. Zet de
nieuwe waarde in je wachtwoordkluis en nergens anders.

Waarom het erbij komt: dit account bestaat expres, met een werkend wachtwoord, omdat Google Play
zijn reviewers ermee moet kunnen inloggen en omdat de winkelfoto's op een eigen administratie
worden geschoten in plaats van op die van een echt bedrijf. Allebei goede redenen. Wat er niet uit
volgt is dat het wachtwoord vóluit in de repository staat — en deze repository is openbaar. Het
stond op vijf plekken, waarvan drie er op 2 september bij kwamen, door twee verschillende sessies
op dezelfde dag. De afspraak om het weg te laten bestond al (`PLAY_STORE_LISTING.md` schreef altijd
`SHOT_PASSWORD=…`); er was alleen niets dat hem afdwong. Nu wel.

**Dit punt is minder dringend dan het klinkt, en dat is gemeten en niet gehoopt:**

- Er heeft nog nooit iemand mee ingelogd (`last_sign_in_at` was leeg).
- Het account kan sinds 2 september geen mail meer versturen en geen documenten meer laten inlezen
  — de twee dingen die geld kosten of bij een vreemde in de bus belanden.
- En het ziet niemand anders. Dat is nagemeten op de productiedatabase, in een proef die
  terugdraaide: van 612 facturen zag het er 17, allemaal zijn eigen; een wijziging op de 555 rijen
  van jouw administratie raakte er nul; en een poging om een factuur ín jouw boeken te schrijven
  werd geweigerd. Andersom net zo: jij ziet zijn rijen niet.

Draai hem dus met een gerust hart, niet met haast. Het oude wachtwoord blijft in de
geschiedenis van de repository staan — daar is niets meer aan te doen, en daarom is het account
afgeschermd in plaats van alleen hernoemd.

`scripts/seed-demo-account.sql` leest het wachtwoord nu uit `DEMO_PASSWORD` en weigert te draaien
zonder. Aanroepen als:

```bash
DEMO_PASSWORD="$NIEUW" psql "$DATABASE_URL" -v demo_pw="$DEMO_PASSWORD" -f scripts/seed-demo-account.sql
```

---

## −1. Wat er in de nacht van 1 september van deze lijst af is gegaan

*Deze nacht was er voor het eerst directe toegang tot de productiedatabase. Alles hieronder is
gedaan én nagemeten; wat eronder staat vanaf punt 0 blijft gelden, behalve waar hier staat dat het
af is. Alles is teruggezet in `supabase/migrations/`, dus de code en de database zeggen weer
hetzelfde.*

**☑ De migratielijst is leeg**

Van de vier die nog openstonden bleken er twee al toegepast (`accountant_discount_guard`,
`accountant_clients_insert_consent` — de open insert-policy op `accountant_clients` is weg, dus dat
gat is dicht). De andere twee zijn nu toegepast:

- `verwerkt_freeze_level` — vooraf gemeten: er stonden NUL facturen op `verwerkt`, dus deze kon op
  de dag zelf niets tegenhouden dat werkt. Hij staat er voor de eerste factuur die je boekhouder
  verwerkt.
- `creditnota_per_rate_ceiling` — dit was de migratie waarvan in de kop stond dat hij als enige
  nooit tegen een database was nagemeten. Dat is nu wel gebeurd, in een proef die zichzelf
  terugdraaide (17 factuurregels vóór, 17 ná): een gewone regel mocht door, een terechte
  creditregel van 600 van 1000 mocht door, en de tweede 600 werd geweigerd met precies de code
  die de app al omzet in een leesbare melding.

**☑ De adviseur van Supabase: 271 meldingen → 103**

- **157 policies riepen `auth.uid()` per RIJ aan.** Nu één keer, via `(select auth.uid())`.
  Dezelfde uitkomst, en het verschil groeit met je administratie — dít was het antwoord op "hoe
  moet dat dan bij een groot bedrijf". Vooraf ging de hele oude stand naar
  `rls_backup.policies_20260901`; achteraf is elke policy teruggerekend en vergeleken: 162 vóór,
  162 ná, 0 verdwenen, 0 nieuw, 0 met een andere betekenis. En daarna een echte proef als
  ingelogde eigenaar: van 610 facturen zag hij zijn eigen 554 en 0 vreemde.
- **7 dubbele indexen weg.** Elke rij die je schrijft onderhield ze allebei.
- **De bedragbewaker draait op een vast zoekpad**, en zes triggerbewakers hangen niet langer als
  `/rest/v1/rpc/...` aan de buitenkant.

**☑ De storing van 27 augustus was al gerepareerd**

In het foutenlog van Vercel stond er één, drie keer, bij één gebruiker: een 500 op `/api/intake`.
Die is op 27 augustus al opgelost én afgedekt met een poort. Sindsdien nul fouten — ook in de twee
uur ná al het bovenstaande.

### Wat hier BEWUST niet is gedaan

- **33 meldingen "multiple permissive policies".** Beleid samenvoegen VERANDERT wie wat mag; dat is
  geen mechanische ingreep maar een besluit per tabel. Dit hoort overdag, met iemand die meekijkt.
- **19 refererende sleutels zonder index.** Een index toevoegen kost bij élke schrijfactie iets.
  Welke van de negentien het waard zijn, hangt af van wat er echt wordt opgevraagd — dat is een
  meting, geen lijstje afwerken.
- **49 "ongebruikte" indexen.** "Ongebruikt" betekent hier "niet gebruikt sinds de teller voor het
  laatst op nul ging". In een jonge database is dat geen bewijs.

### Wat ALLEEN JIJ nog kunt doen

1. **Leaked Password Protection aanzetten** — Supabase → Authentication → Policies. Eén schakelaar;
   hij toetst nieuwe wachtwoorden aan HaveIBeenPwned. De enige beveiligingsmelding die overblijft
   en die van buitenaf niet te zetten is.
2. **`CRON_SECRET` vervangen** (zie hieronder, punt 0) — nog steeds open, en zonder geldige waarde
   doen alle zes de crons stil niets.
3. **`BEHEER_EMAILS=mofwim@gmail.com`** in Vercel, anders is `/dashboard/beheer` voor jou een 404.
4. **Google-toestemmingsscherm** (naam van de app) — zie `docs/AUTH_SETUP_GUIDE.md §A.1`.
5. **DMARC van `p=none` naar `p=quarantine`**, als de rapporten een week schoon zijn.
6. **`rls_backup.policies_20260901` mag weg** zodra de wijziging een tijdje meedraait. Hij staat
   buiten de PostgREST-gevel en is alleen met de service-rol te lezen; hij is er als herstelpunt.

---

## 0. Vóór de eerste tester — augustus 2026

*Deze lijst is van 29 juli. Sindsdien zijn er **43 migraties** bijgekomen en is er drie weken aan
functionaliteit op `main` gezet. Wat hieronder staat is wat daardoor is veranderd aan de vraag
"kan ik dit aan iemand geven". De rest van dit document blijft gelden.*

**☐ Eén query, en die is het belangrijkst van allemaal**

```
docs/WELKE_MIGRATIES_STAAN_ER.sql
```

Punt 1 hieronder zegt "de migraties zijn af", en dat was waar op 29 juli. Er zijn er daarna 43
bij gekomen — de bankbevestiging, de deelcreditnota, de regelkorting, het offerte-akkoord, de
factuurbijlage, `ai_budget_settle`, de opslagharding. Welke daarvan in jouw database staan, weet
dit bestand niet en ik ook niet; die query wel. Hij leest alleen de catalogus en verandert niets.

De uitkomst die telt is de MIDDELSTE. `OPEN` is ongemakkelijk maar eerlijk: de functie doet niets
en de code weet dat. **`GEDEELTELIJK` is het gevaarlijke geval** — halverwege gestopt, dus een
deel van de bescherming staat er en een deel niet. Lees dan het CONTROLE-blok van dát bestand.

**☐ `CRON_SECRET` vervangen — niet omdat hij zwak is**

Hij is tijdens het bouwen gegenereerd in een terminal waarvan de uitvoer werd meegeschreven. Zie
`LIVE_GAAN.md §2`: een geheim dat ergens is afgedrukt is geen geheim meer. Vervangen is één
handeling (Vercel → Generate → deploy) en er verhuist geen enkele staat mee. Zolang het niet
gebeurt is het geen storing die je ziet — en zonder een geldige waarde antwoorden **alle zes
crons 401 en doen niets**, stil.

**☐ `SYNC_START_DATE` moet LEEG zijn in Vercel**

Hij is gezet voor de pilot, om historische facturen van Kiwi op te halen. Maar hij is **globaal**:
hij vervangt de ondergrens van *iedere* gebruiker, niet die van één. Staat hij nog gevuld als je
tester zich aanmeldt, dan haalt diens eerste sync maanden aan vreemde post op — zijn maandtegoed
op, jouw AI-rekening, en een verificatiewachtrij vol dingen die hij nooit heeft gevraagd. Leeg
laten betekent: vanaf zijn eigen registratiedatum, wat de bedoeling is.

**☐ `NEXT_PUBLIC_COMPANY_LEGAL_NAME` en `_ADDRESS`**

Deze twee gelden **vanaf de eerste gebruiker**, niet vanaf de eerste euro: de privacyverklaring
noemt daarmee de verwerkingsverantwoordelijke, en dat is wat AVG art. 13 verlangt. Zonder ze leest
er "BoekBrug, gevestigd te Tilburg" met "(adres volgt)". `_KVK` en `_BTW` mogen wachten tot je geld
aanneemt — die staan al in punt 6 van `LIVE_GAAN.md`.

Voor tien mensen die jou persoonlijk kennen is dat te verdedigen. Voor een open aanmeldknop niet.

**☐ Leaked Password Protection aanzetten (Supabase → Auth)**

Kost één schakelaar. Sinds augustus staat er verificatie in twee stappen in de app
(`/dashboard/beveiliging`), maar die zet de eigenaar zelf aan; dit werkt vanaf de eerste
registratie en zonder dat iemand iets hoeft te doen.

**☐ De twee losse SQL-blokken die nog wachten**

- `ai_budget_settle.sql` — regels **48 t/m 92** (BEGIN → COMMIT, niet de commentaarstaart).
  Zonder dit rekent de dagzekering af op `max_tokens` in plaats van op werkelijk verbruik, en
  slaat hij dus te vroeg door.
- `storage_bucket_hardening.sql` — het **CONTROLE**-blok, vóór de eerste echte gebruiker.

**☑ Wat sinds 29 juli aantoonbaar beter is geworden**

Niet om gerust te stellen, maar omdat het de vraag "is het klaar" verplaatst: de geldpaden zijn in
augustus doorgelicht (`MONEY_PATH_AUDIT_2026-08.md`), er staat nu een slot op het account én op de
programmakant ervan, elke handeling is terug te lezen in een logboek dat de eigenaar zelf opent, de
doorlopende nummerreeks wordt gecontroleerd op gaten — inclusief het gat aan het eind dat alleen de
teller ziet — en van de e-mailimport en de betalingskoppeling is gemeten welke waarborgen kapot
konden zonder dat één test rood werd. Dat waren er zes; ze zijn nu vastgepind.

**Wat dat NIET is:** bewijs dat het bij een echte administratie klopt. Geen enkele controle in dit
document vervangt één ondernemer die één volledig kwartaal doorloopt en zijn boekhouder het laat
ophalen. Dat is precies de poort in `LIVE_GAAN.md §7`, en die staat er niet voor niets.

---

## 1. Nu — de migraties zijn af

**☑ Alles wat de veiligheid van je boekhouding raakt, staat erin**
Op 29 juli 2026 gelezen uit je eigen database met `docs/WELKE_MIGRATIES_STAAN_ER.sql` (niet
gemeld, maar gemeten): 10 t/m 17 zijn toegepast. Daarmee zijn beide gaten met een echte
scherpe kant dicht — het IBAN-schrijfgat in de boekhoudersgrens, en het gat waarin twee
gelijktijdige verzoeken dezelfde factuur twee keer in het wettelijke inkoopboek van je
boekhouder konden zetten.

**☐ Eén staat nog open, en die mag wachten: `search_engine_clients_kvk_city.sql`**
Twee trigram-indexen zodat zoeken op KVK-nummer en plaats van een klant een index gebruikt in
plaats van een scan. Het bestand zegt het zelf: *"puur snelheid"* — geen schema-, data- of
gedragswijziging. Zoeken werkt vandaag al. Twee regels, vijf seconden, geen risico; doe het
wanneer je klantenregister groeit, of nu omdat het niets kost.

**⚠ Één ding om NU te controleren — één query**

De ontdubbelings-migratie `documents_content_hash_unique.sql` heeft hier al gelopen (de index
`uq_documents_user_content_hash` bestaat). De versie die toen liep, verwijderde documenten en
spaarde er één alleen als `documents.invoice_id` gezet was — met als argument "geen boekhoudregel
hangt ervan af". Dat argument was fout: er zijn zes verwijzingen naar een document, en vijf laten
`invoice_id` leeg. Een contante bon die aan een kasregel hing, kon dus als wees worden verwijderd.

Deze query zegt of dat is gebeurd:

```sql
select id, entry_date, amount, btw_rate, description
  from public.cash_entries
 where category = 'kosten' and btw_rate is not null and document_id is null
 order by entry_date;
```

**Nul rijen = er is geen contante bon geraakt.** Dat is het verwachte antwoord: byte-identieke
duplicaten zijn zeldzaam (twee foto's van dezelfde bon hebben verschillende bytes), dus dit treft
vooral een tweemaal geüploade PDF.

Komt er wél iets uit, dan is dat sluitend bewijs — deze toestand kan de app niet maken
(`/api/cash/route.ts:119` zet het tarief op null zodra er geen bon is). Die bonnen zijn weg en niet
terug te halen; wat je nog kunt doen is het papier opnieuw fotograferen en aan de kasregel koppelen,
zodat de voorbelasting terugkomt. De migratie is inmiddels gerepareerd en veilig opnieuw te draaien.

**☑ Wat de meting verder liet zien — allemaal goed**
De bucket staat op privé met een limiet van 25 MB · de drie storage-policies staan er ·
**élke tabel in `public` heeft RLS aan** (`relrowsecurity = false` gaf nul rijen). Dat laatste
beantwoordt in één regel de hele beveiligingsvraag van het doorgestuurde readiness-rapport.

**☐ `AI_DAILY_BUDGET_EUR=0` in Vercel**
Nul betekent: **wél tellen, niet begrenzen**. Dat is de juiste stand voor je eerste weken —
je leert je echte uitgaven kennen voordat je een getal kiest. Laat je hem leeg, dan geldt
€ 5/dag, en dat is bij ± € 0,019 per gescand document zo'n 260 documenten per dag over
*alle* gebruikers samen. Ruim voor de eerste gebruikers, krap voor tien tegelijk.

Meekijken: `select * from ai_spend_daily order by day desc limit 7;`

**☐ `RETENTION_PURGE_ENABLED` leeg laten**
Dit is de enige schakelaar in de app die data vernietigt. Leeg = dry run. Er kan niets vóór
2033 aan de beurt zijn; meldt een dry run nu al een kandidaat, dan is er een datum verkeerd
gezet — uitzoeken, niet aanzetten.

**☑ `boekbrug.nl` kan post ONTVANGEN — opgelost op 30 juli**

Dit stond hier een halve dag als het enige punt op deze lijst dat iets kapots repareerde in
plaats van iets mogelijk te maken, en het is af. De aanleiding: `boekbrug.nl` had **geen
enkel MX-record**, terwijl de app drie adressen publiceert als het officiële loket —
`privacy@` (Privacyverklaring §1, §6, §12, §13, mét de beloofde termijnen van 30 en 7 dagen),
`legal@` (Voorwaarden) en `support@` (Voorwaarden + privacy §13). Alle drie bouncden. Dat is
iets anders dan een leeg KVK-veld: "(volgt)" is een eerlijke lege plek, een gepubliceerd
adres dat weigert is een belofte die de app niet waarmaakt — en het is precies het kanaal
dat de AVG (art. 13) verplicht stelt, dus het telde vanaf de eerste gebruiker, niet vanaf de
eerste euro.

Opgelost met doorsturen in plaats van mailboxen: vier regels in de TransIP DNS-tabel, en de
aliassen bij de doorstuurdienst. Nagemeten vanaf een externe resolver, niet aangenomen:

| Record | Stand |
|---|---|
| `MX boekbrug.nl` | `10 mx1.improvmx.com` · `20 mx2.improvmx.com` |
| `TXT boekbrug.nl` (SPF) | `v=spf1 include:spf.improvmx.com ~all` — en **precies één** |
| `TXT _dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@boekbrug.nl; fo=1` |
| CONTROLE `MX send.boekbrug.nl` | ongewijzigd (Resend-retourpad) |
| CONTROLE `TXT send.boekbrug.nl` | ongewijzigd (`include:amazonses.com`) |
| CONTROLE `TXT resend._domainkey` | ongewijzigd (DKIM, 218 tekens) |
| CONTROLE `A boekbrug.nl` + `www` | ongewijzigd (Vercel) |

Twee dingen aan die SPF-regel zijn het onthouden waard. Een domein mag er **maar één** hebben:
een tweede maakt ze allebei ongeldig, dus een latere afzender wordt in dezelfde regel gemengd
en er komt nooit een rij bij. En er staat bewust géén `include:amazonses.com` in — dat zou
iedere SES-klant ter wereld laten afzenden namens dit domein. Resend zet die include daarom
zelf op de subnaam `send.`, en daar hoort hij te blijven.

Die laatste drie staan er met opzet bij. Een MX op de hoofdnaam en het verzendpad van Resend
lijken op elkaar te botsen maar doen dat niet — Resend hangt op de subnaam `send.` — en dat
is nu gemeten in plaats van beredeneerd. DMARC stond al beschreven in
`docs/AUTH_SETUP_GUIDE.md §C.3` en was nooit aangezet; dat is meteen meegenomen, met `rua` op
het eigen domein omdat rapportage naar een extern adres een autorisatierecord vereist bij die
andere partij.

Wat hier NIET aan lag, voor de volgende lezer: Resend verzorgt het **verzenden**
(`noreply@boekbrug.nl`) en werkte de hele tijd. Ontvangen is een losse zaak die Resend niet
doet. De doorstuurbestemming wordt nergens gepubliceerd, dus welk privé-adres daarachter
hangt maakt voor de buitenwereld niets uit.

**☑ En één echte mail is er doorheen gegaan**
Kloppende DNS bewijst dat de weg getekend is, niet dat er iets aankomt. Een testbericht is de
hele keten door gegaan — Google → `mx1.improvmx.com` → de doorstuurbestemming — dus ontvangen
werkt aantoonbaar, niet theoretisch.

**☐ Maar hij belandde in de ongewenste map, en dát is geen schoonheidsfoutje**
Dit hoort bij doorsturen en het gaat niet vanzelf over: een doorgestuurd bericht komt binnen
vanaf de doorstuurdienst en niet vanaf de server van de oorspronkelijke afzender, dus diens
SPF-controle faalt per definitie. Elke volgende mail heeft hetzelfde.

Waarom dat hier zwaarder weegt dan bij gewone post: de privacyverklaring belooft antwoord
binnen **30 dagen** op een AVG-verzoek en binnen **7 dagen** op een klacht. Een verzoek dat
ongelezen in de spambak ligt, is een gepubliceerde termijn die verloopt zonder dat iemand het
merkt. De inbox is hier onderdeel van de belofte.

Eén keer "geen spam" aanvinken lost het niet op, want de afzender verschilt per bericht —
filteren op **wie het stuurt** kan dus niet. Wat wel werkt is filteren op **waar het heen
ging**: een regel op het `To`-adres `@boekbrug.nl` met "nooit als spam markeren", plus een
eigen label zodat zakelijke post niet tussen privémail verdwijnt. Niet elke mailprovider
biedt dat op het To-veld; kies de bestemming daarop uit.

**☐ De catch-all hoort uit**
De vier expliciete aliassen dekken alles wat de documenten noemen, terwijl `*@boekbrug.nl`
elk verzonnen adres accepteert en daarmee vooral spam binnenhaalt.

## 2. Voordat je geld kunt aannemen

**☐ KVK-inschrijving en een zakelijke bankrekening**
Zonder deze twee keert Stripe niet uit, en zolang er geen echt KVK-nummer is blijft `/steun`
bewust een 404: er wordt nooit om geld gevraagd zonder identificeerbare rechtspersoon.

**☐ De bedrijfsidentiteit in Vercel**
`NEXT_PUBLIC_COMPANY_LEGAL_NAME` · `_KVK` · `_BTW` · `_ADDRESS` · `_CITY`
Nu tonen de voorwaarden "(volgt)". Dat is opzet — een leeg veld mag nooit als een
echt-maar-onjuist KVK-nummer kunnen lezen — maar het is geen eindtoestand.

Twee dingen die hier eerder onduidelijk stonden, want ze vallen niet allebei onder "geld":

*Het werkt al, en er staat nergens een blokhaak op je scherm.* De vervanging zit in
`src/content/legal/company.ts` en draait bij het bouwen over de drie juridische teksten
(voorwaarden, privacy, eerlijk gebruik). Zonder ingevulde variabelen leest de bezoeker
vandaag "geëxploiteerd door **BoekBrug**, gevestigd te Tilburg, KVK-nummer **(volgt)**" —
niet `[JOUW NAAM]`. Nagemeten door de drie modules te importeren en op overgebleven
placeholders te zoeken: nul.

*Alleen `_KVK` en `_BTW` horen echt bij "voordat je geld aanneemt".* `_LEGAL_NAME` en
`_ADDRESS` staan in de privacyverklaring als de verwerkingsverantwoordelijke, en die vraag
stelt de AVG bij de eerste gebruiker. Zolang je nog niets int, is "(volgt)" verdedigbaar
mits het loket hierboven wél openstaat — een bereikbaar adres is waar een betrokkene je
daadwerkelijk mee vindt.

**☐ Stripe: drie prijzen, niet één**

| | Bedrag | Vorm |
|---|---|---|
| `STRIPE_PRICE_ID_PLUS` | **€ 19,99 per maand**, incl. btw | terugkerend, interval `month`, elke 1 maand |
| `STRIPE_PRICE_ID_PLUS_YEAR` | **€ 179,91 per jaar**, incl. btw | terugkerend, interval `year`, elke 1 jaar |
| `STRIPE_PRICE_ID_KLUIS_YEAR` | **€ 19 per bewaarjaar**, incl. btw | eenmalig |

Het bedrag in Stripe moet **exact** gelijk zijn aan wat de voorwaarden publiceren. De
checkout dwingt acceptatie van die voorwaarden af, dus een verschil is precies het gat waar
de klant gelijk in krijgt.

[JAARPRIJS] De jaarprijs is **één doorlopende prijs** van € 179,91 — twaalf maanden voor de
prijs van negen (9 × 19,99). Maak er géén constructie van: geen subscription schedule, geen
fase van nul euro, geen drie gratis maanden plus negen betaalde. Zo'n opzet verandert
halverwege van vorm, pakt per fase anders uit bij opzeggen, en moet per periode fiscaal
worden uitgelegd.

> **De duurste verwisseling op deze hele lijst.** Die twee prijs-id's zien er identiek uit
> (`price_1Abc…`). Zet je de maandprijs in `STRIPE_PRICE_ID_PLUS_YEAR`, dan betaalt een
> jaarklant € 19,99 **per jaar** — daar klaagt niemand over, dus dat loopt door tot je de
> boeken leest. Andersom gaat er € 179,91 **per maand** af bij iemand die om een maand vroeg,
> en dat meldt een klant bij zijn bank. Beide bedragen zijn echte BoekBrug-bedragen, dus een
> controle op het bedrag alleen ziet het verschil niet. De app vergelijkt daarom ook het
> interval en weigert de checkout vóórdat er een kaart wordt belast — maar een geweigerde
> checkout is nog steeds een verkoop die niet doorgaat, dus controleer het één keer goed.

Laat je `STRIPE_PRICE_ID_PLUS_YEAR` leeg, dan is er simpelweg geen jaarknop en werkt de
maandprijs gewoon door. Dat is met opzet: een halve inrichting mag de maandflow nooit
meenemen.

> **Zet de variabele vóórdat je deployt, of deploy opnieuw nadat je hem hebt gezet.**
> `/prijzen` is een dynamische pagina en leest hem bij elk bezoek, dus daar verschijnt de
> jaarknop meteen. `/en/prijzen`, `/ar/prijzen` en `/tr/prijzen` zijn statisch: daar wordt bij
> het BOUWEN vastgelegd of er een jaarprijs is. Zet je de variabele ná een deploy, dan blijft de
> jaarknop op die drie pagina's weg tot de volgende build.

**☐ Stripe: iDEAL aan, Invoicing aan, Billing Portal met zelf-opzeggen aan**
Kaart-alleen verliest echte Nederlandse klanten bij de laatste klik. Zelf kunnen opzeggen is
onder EU-consumentenrecht geen keuze.

**☐ Webhook**
Endpoint `https://boekbrug.nl/api/billing/webhook`, events:
`checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`,
`invoice.payment_failed`. Het ondertekengeheim in `STRIPE_WEBHOOK_SECRET` — dat is het enige
dat tussen een publiek eindpunt en willekeurig wie op internet staat.

**☐ Testen in testmodus, en pas daarna live**
Kaart `4242 4242 4242 4242`, dan test-iDEAL. Kijk of de webhook aankomt en het profiel op
`active`/`plus` springt. Zeg op → toegang loopt door tot het einde van de betaalde periode.
Laat een betaling mislukken → de mail komt en **de toegang blijft**. Pas als dat allemaal
klopt: live sleutels, één echte betaling op je eigen account, en kijken of de btw-factuur
klopt.

---

## 3. Eén beveiligingspunt dat ik niet kon afmaken

**☐ `xlsx` naar 0.20.3**
Twee CVE's op de gepinde 0.18.5. De reparatie staat alleen op `cdn.sheetjs.com` (SheetJS is
van npm af) en die host geeft 403 in deze omgeving — in de andere sessie ook. Je hebt er een
omgeving voor nodig die erbij kan:

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm audit && npx tsc --noEmit && npx tsx --test src/lib/*.test.ts && npm run build
```

Daarna één echte Z-rapportage, één grootboekexport en één bank-`.xlsx` uploaden om te zien
dat het parsen niet is veranderd. **Je bent intussen niet blootgesteld aan de ergste helft**:
de prototype-pollution is ingedamd op de parsergrens (`xlsx-adapter.ts`) en de ReDoS is
begrensd. Doe dit vóór je mensen onboardt die bestanden uploaden.

---

## 4. Het experiment waar dit allemaal voor was

Tien mensen, persoonlijk begeleid. Geen advertenties tot deze poort door is.

De poort is **niet** meer "vraag om de kaart" — het product is gratis, er is niets te vragen.
Dat is een echte prijs van het model dat je hebt gekozen: **er is geen vroeg
inkomstensignaal.** De vervanging:

> ≥ 3 van de 10 nog actief **ná één volledig afgesloten kwartaal**, en
> ≥ 1 boekhouder die dat kwartaal daadwerkelijk heeft opgehaald.

Betalen komt later, uit Plus en uit de Bewaarkluis. Haal je die poort niet, interview dan
alle tien — hun antwoord is meer waard dan welk strategiedocument ook, dit inbegrepen.

### 4.1 De trechter lekte op het duurste punt — dat is gedicht (31 juli)

`/factuur-maken` is de sterkste instappagina die er is: geen account, echte uitkomst, en de
bezoeker heeft er vijf minuten werk in zitten voordat hij iets van ons vraagt. Onderaan stond
een knop met de tekst **"Maak een gratis account. Bewaar je facturen"** — en daarachter een
kale link naar `/register`. De ingevulde gegevens stonden wél in localStorage, maar een
zoekopdracht over `register`, `onboarding` en `dashboard` gaf **nul** verwijzingen naar die
sleutels.

Wat de bezoeker dus meemaakte: factuur invullen, lezen dat hij hem kan bewaren, registreren,
en dan een leeg scherm — bedrijfsnaam, adres, KVK, BTW, IBAN, de klant en alle regels opnieuw.
Precies op het moment dat hij besloot te blijven. Dat is geen ontbrekende functie maar een
belofte die het product zelf doet en niet nakomt, en meer bezoekers door zo'n trechter leveren
geen extra gebruikers op — alleen meer teleurgestelde onbekenden. In een kleine, hechte
gemeenschap wordt dat doorverteld.

Nu gaat de hele factuur mee, via één contractmodule (`src/lib/factuur-handoff.ts`) met drie
lezers. De volledige beschrijving — inclusief wat er bewust NIET is gebouwd — staat in
**`docs/TRECHTER.md`**; lees dat voordat je een van die schermen aanpast, want het ontwerp ligt
over vijf bestanden verspreid en laat zich makkelijk per ongeluk "opruimen".

| Waar | Wat er gebeurt | Waarom zo |
|---|---|---|
| `/factuur-maken` | schrijft de hele factuur weg terwijl je typt | niets verliezen bij wegklikken |
| onboarding | vult het bedrijfsblok **stil** voor | eigen gegevens van minuten geleden — herkenning, geen verrassing |
| `/dashboard/invoice/new` | **vraagt** of je de factuur overneemt | een compleet ingevulde factuur die vanzelf verschijnt is iets anders dan je eigen adres |

Drie besluiten die vastliggen in tests, omdat ze zonder uitleg fout gerepareerd zouden worden:

- **localStorage, geen sessionStorage.** Tussen de gratis pagina en het account zit een
  bevestigingsmail, en die opent vaak een nieuw tabblad. sessionStorage zou juist falen bij de
  gebruiker die het netjes doet. Houdbaarheid: zeven dagen, daarna vervalt hij stil.
- **Het factuurNUMMER komt niet mee.** In de gratis tool is dat een gewoon invoerveld; in het
  product komt het uit de doorlopende reeks van art. 35 Wet OB. Een zelfgekozen nummer laten
  binnenwandelen maakt precies het gat waar de rest van deze codebase voor waakt.
- **Een ontbrekend BTW-tarief wordt 21%, nooit 0%.** 0% leest als vrijgesteld, en dat is de
  duurste van de twee fouten.

### 4.2 Vakpaginas: waar de concurrentie niet staat (31 juli)

`boekhoudprogramma zzp` is onwinbaar — daar zitten partijen die er jaren geld in stoppen.
`factuur maken loodgieter` doet vrijwel niemand iets mee. Er staat nu een pagina per beroep
onder `/factuur-maken/<vak>` (11 stuks, statisch geprerenderd, in de sitemap).

De tijdwinst van kant-en-klare regels is het kleinste deel. Wat deze pagina's echt verkopen is
het **BTW-tarief**, en dat is een juistheidsfunctie in het jasje van een snelheidsfunctie:

- schilderwerk aan een woning **ouder dan twee jaar**: 9% over het arbeidsloon, materiaal blijft 21%
- **personen**vervoer 9%, **goederen**vervoer 21% — beide heten "transport"
- schoonmaak **binnen een woning** 9%, in een kantoorpand 21%
- fietsREPARATIE 9%, een fiets VERKOPEN 21%
- werk voor een aannemer: vaak *BTW verlegd*, en dat is iets ánders dan 0%

Twee ontwerpregels die dit uit de onderhoudsval houden, allebei met een test eromheen:
**nooit prijzen** (een voorgevuld uurtarief is fout voor iedereen behalve toevallig één
iemand), en **twijfel wordt zichtbaar** — waar het tarief van de situatie afhangt staat de
veilige 21% ingevuld mét de uitleg wanneer 9% mag, nooit andersom.

---

## 5. Wat je in week één in de gaten houdt

| Waar | Waarop |
|---|---|
| Stripe → Webhooks | elke aflevering die geen 200 is. Een falende webhook = iemand betaalde en de app weet het niet |
| Vercel-logs `[BILLING]` | `UNATTRIBUTED subscription` — een echte betaling zonder account erbij |
| Vercel-logs `[KLUIS]` | `UNATTRIBUTED bewaarkluis payment` — hetzelfde, maar voor het archiefproduct |
| Vercel-logs `[COST-GUARD]` | `DAILY AI BUDGET EXHAUSTED` — de zekering is doorgeslagen, er moet iemand kijken |
| Vercel-logs `[CRON-RETENTION]` | élke kandidaat. Er kan niets vóór 2033 aan de beurt zijn |
| Sentry | nieuwe fouten in `/api/billing/*`, `/api/kluis/*` en de crons |

---

## 6. Wat bewust NIET is gebouwd

Jaarabonnementen · boekhoudersplannen · kortingscodes · proration · een volledige
dunning-reeks · Mollie · meerdere valuta · een proefperiode.

Elk daarvan is een antwoord op een vraag die je nog niet hebt verdiend. En de proefperiode
staat er niet tussen bij toeval: die is uit de andere tak bewust **niet** overgenomen, want
een klok die stil begint te lopen en later toegang kan intrekken is precies het gedrag waar
dit product zich van onderscheidt. Zie `docs/PORT_VAN_BILLING_TAK.md` §3.

---

## 7. Twee open punten, eerlijk benoemd

1. **De mailrobot telt nog niet mee in het eerlijk gebruik.** `/api/cron/email-sync` draait
   namens de gebruiker via service_role; per binnengekomen bijlage door de poort sturen
   vraagt een aparte ronde. Tot die er is draagt de begrenzing daar op de dagzekering, en
   blijft een verlaten mailbox van een gratis account meelopen. Betaalbaar, niet gratis.
2. **Eén `deletion_requests`-rij heeft `data_eligible_for_deletion_at = null`** — een account
   dat is verwijderd voordat de tijdstempel bestond. De purge laat hem met rust (hij eist
   twee kloppende datums), dus er gaat niets mis. Verdient ooit een blik, niet vandaag.

---

## 8. Wat de stille-foutenjacht heeft veranderd (juli 2026)

Een volledige doorloop van de brug — opname bij jou, aflevering bij de boekhouder — met tien
lenzen en per bevinding twee sceptici. Negen fouten van het gevaarlijkste soort zijn gerepareerd:
een verkeerd of ontbrekend antwoord **zonder** foutmelding, logregel of enig spoor.

Wat je ervan merkt:

| Vroeger | Nu |
|---|---|
| Een contante terugbetaling aan een klant *verhoogde* je omzet en je af te dragen BTW | De la beweegt de kant op die hij echt op ging |
| Eén databasehapering en je zag het groene "Alles is bij" met € 12.000 openstaand | Een eerlijk paneel met een opnieuw-knop |
| Het kwartaalpakket kon een concept-aangifte meesturen waarin je hele kasboek ontbrak | Geen concept, wél de reden — en alle bewijsstukken gaan onverkort mee |
| Een verwijderd bankafschrift liet de factuur onbetaald staan met € 0 openstaand: nooit meer een herinnering | De omkering zet ook `amount_paid` terug |
| Élke klant op het werkbord van je boekhouder droeg het label "zonder bank" | De telling mag nu lezen wat ze moet lezen |
| "Herinnering verstuurd" voor een mail die de provider had geweigerd | Je hoort het als hij niet aankwam |
| "Niets overgeslagen" terwijl een onleesbare bon of een bijlage van 12 MB stil verdween | Beide staan in het overgeslagen-paneel, met de reden |
| "100% klaar" terwijl een factuur zonder datum buiten elk kwartaal viel | Een risico dat 100% onmogelijk maakt — geen blokkade, want al ingediende kwartalen mogen niet rood worden |
| "Opnieuw inlezen" wiste de dubbel-waarschuwing die het kwam hercontroleren | Het rekenoordeel wordt vernieuwd, de dubbel-signalen blijven |

Wat de jacht **niet** heeft gedekt, en waar dus geen uitspraak over is: OAuth-tokenvernieuwing,
de Storage-bucketpolicies en de levensduur van ondertekende URL's, push-aflevering, Stripe buiten
de webhook, en de kwaliteit van de AI-extractie zelf (de audit keek naar wat de code met een
gelezen bedrag doet, niet of dat bedrag klopte).

---

*Verwant: `docs/WELKE_MIGRATIES_STAAN_ER.sql` (wat er écht in je database staat) ·
`docs/MIGRATIES_VOLGORDE.md` (de volgorde en het waarom) ·
`docs/PORT_VAN_BILLING_TAK.md` (wat er uit de andere tak is overgenomen en wat niet) ·
`docs/BEWAARKLUIS_BUSINESS_CASE.md` (waarom de bewaarplicht een voordeur is).*
