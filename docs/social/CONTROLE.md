# Control sheet — every post in the 30-day plan

What an audit of 74 agents found in the plan as it was written, post by post. This is the
DIAGNOSIS, not the replacement copy: a second pass rewrote every post to be true and a counter-read
found 206 new false claims in those rewrites, so the corrected prose is not published here. Write
new copy from `src/lib/belofte.ts` and `src/lib/i18n/messages.ts` and run the gate
(`npx tsx scripts/check-social-copy.mts`) — see README.md for why.

Severity: **blocking** would publish something untrue · **important** misleads or points at a
label that does not exist · **minor** is a wording or precision fix.


**88 blocking · 95 important · 45 minor**, across 51 posts.


## Dag 1 · Instagram · Carrousel, 6 slides

Verdict: **GECORRIGEERD** · asset: Slide 5: schermfoto van het startscherm met de blauwe kaart 'Ben ik klaar?' bovenaan en daaronder het raster 'Mijn administratie' (Facturen, Inkomend, Bank). VEREIST EEN INGELOGDE 

- **[blocking]** «Slide 6: 'Probeer BoekBrug gratis.'»  
  MOET WEG. 'Probeer' is proefperiode-taal en het product zegt met zoveel woorden het tegenovergestelde: 'Echt gratis. Er is geen proefperiode en er loopt geen klok.' Gratis is het hoofdplan, niet de instapvariant. De eigen knoppen heten 'Gratis account maken' en 'Gratis beginnen'. Vervangen door de echte knoptekst.  
  → `src/app/prijzen/page.tsx:281-284 ('Is het echt gratis, of is dit een proefperiode?' → 'Echt gratis. Er is geen proefperiode'), :113 ('Gratis — het hoofdplan, ni`
- **[important]** «Slide 4: "En aan het einde van het kwartaal? 'Heb ik eigenlijk alles?'"»  
  'Heb ik eigenlijk alles?' bestaat nergens in de app. De vraag die de post stelt IS een knop op het startscherm, en die heet 'Ben ik klaar?'. AGENTS.md eist dat een zin die naar een knop wijst die knop noemt zoals hij geschreven staat — anders zoekt de lezer na registratie naar een woord dat er niet is. Door de echte na  
  → `src/lib/i18n/messages.ts:503 ('start.klaar': nl: 'Ben ik klaar?'); de knop staat op de home: src/app/dashboard/zzp/ZzpDashboard.tsx:243-259 (router.push('/dashb`
- **[important]** «Ontbrak: de geruststelling onder de knop»  
  De post eindigde met een lege CTA. Het product heeft hier een vaste, contractueel gedekte regel voor — en die bevat een feit dat de post mist: elk nieuw account krijgt 90 dagen de Plus-grenzen. Toegevoegd aan de caption, niet aan de slide (te lang voor beeld).  
  → `src/lib/belofte.ts:73-74 (BELOFTE_GERUST); de toekenning is echt: src/lib/subscription.ts:151-162 ('de welkomstperiode van 90 dagen')`
- **[minor]** «Slide 1 + 2: 'Je hoeft geen boekhouding te doen / Je hoeft alleen niets kwijt te raken'»  
  Geen fout — dit is letterlijk de belofte van het product, woord voor woord. Alleen de punten ontbraken; het product schrijft ze als twee afgemaakte zinnen. Ongewijzigd overgenomen.  
  → `src/lib/belofte.ts:38-39 (BELOFTE_KOP = 'Je hoeft geen boekhouding te doen.', BELOFTE_KOP_2 = 'Je hoeft alleen niets kwijt te raken.'), gerenderd in src/app/pag`
- **[minor]** «Slide 3: 'Bonnetjes in je tas, facturen in je mail, bankafschrift ergens op je computer'»  
  Inhoudelijk waar, maar het product heeft deze zin al — en die staat op de homepage die de lezer na het aantikken van de link ziet. Dezelfde zin twee keer net anders formuleren is precies waar belofte.ts tegen bestaat. Overgenomen in de woorden van het product zelf (jaszak, laptop).  
  → `src/lib/belofte.ts:118-121 (PROBLEEM_1: 'Bonnetjes in een jaszak, facturen in je mail, een bankafschrift ergens op een laptop.'), gerenderd in src/app/page.tsx:`
- **[minor]** «Slide 5: 'BoekBrug brengt je administratie bij elkaar. Facturen. Bonnetjes. Bank. BTW.'»  
  Mag blijven — 'Facturen', 'Bank' en 'BTW' zijn alle drie echte namen op het startscherm, en 'Bonnetjes' is het vakwoord dat de app zelf naar het uploadscherm doorstuurt. Eén risico afgedekt: 'Bank' mag in de bijschrift nooit een bankkoppeling suggereren (zie caption — daar staat 'bankafschrift', het bestand dat je zelf  
  → `src/lib/i18n/messages.ts:437 (start.tegel.facturen 'Facturen'), :441 (start.tegel.bank 'Bank'), :444 (start.conceptBtw 'Concept BTW-aangifte'); src/lib/vakwoord`

## Dag 1 · LinkedIn · Tekstpost (geen beeld verplicht); 'slides' = de alinea's, in volgorde

Verdict: **HERSCHREVEN** · asset: Geen beeld verplicht. Optioneel: één schermfoto van de kaart 'Ben ik klaar?' met de stand eronder (groen/oranje bolletje + oordeel). VEREIST EEN INGELOGDE TENANT met een gevuld kwa

- **[blocking]** «VERMEDEN: 'het kwartaal doet zichzelf' / 'je aangifte is gedaan'»  
  Die formulering is expliciet verboden in het product zelf, en niet om stilistische redenen: §4.3 van de Algemene Voorwaarden legt vast dat een AI-uitkomst een SUGGESTIE is en nooit een feit. Overal staat daarom 'staat klaar' en nooit 'is gedaan'. De post volgt dat woord voor woord. BoekBrug doet ook de aangifte niet ze  
  → `src/lib/belofte.ts:26-31 ('Er staat NERGENS "het kwartaal doet zichzelf" … Vandaar overal `staat klaar` en nooit `is gedaan`')`
- **[blocking]** «VERMEDEN: 'koppel je bank'»  
  Er is geen bruikbare bankkoppeling voor een gebruiker. De PSD2-integratie is gebouwd, maar het paneel verbergt zichzelf zolang de server er niet voor is ingesteld — en dat is hij niet. De post zegt daarom 'je bankafschrift erbij', wat de waarheid is en toevallig ook de eigen stap 2 van de homepage.  
  → `src/app/dashboard/bank/BankConnectPanel.tsx:243 (`if (!state?.configured) return null`); src/app/dashboard/bank/BankClient.tsx:2054-2057 (`{setupZichtbaar && <B`
- **[important]** «VERMEDEN: 'gratis proberen' en elke featurevergelijking met Moneybird/SnelStart»  
  Twee redenen. Eén: er is geen proefperiode, gratis is het hoofdplan. Twee: belofte.ts legt vast dat een opsomming van functies BoekBrug in een vergelijkingstabel plaatst die het verliest (geen PSD2, geen indiening bij de Belastingdienst, geen Peppol) en die het ook niet hoeft te voeren. De post is dus een rangorde, gee  
  → `src/lib/belofte.ts:10-17 ('Dat plaatst BoekBrug in een vergelijking … op een featuretabel waarin het verliest'); src/app/prijzen/page.tsx:281-284`
- **[minor]** «Er was geen concept aangeleverd — alleen het thema 'zelfde als de carrousel'»  
  Niets om te corrigeren, dus geheel geschreven. De feitencontrole zit hieronder: dit zijn de drie claims die een post op dit thema bijna altijd maakt en die hier NIET in staan, met de reden.  
  → `n.v.t. — zie de drie punten hieronder`

## Dag 2 · Instagram · Carrousel, 6 slides

Verdict: **GECORRIGEERD** · asset: Slide 3 en 4: schermfoto van het startscherm, sectie 'Mijn administratie' (het 3-koloms tegelraster) plus de sectiekop 'Cijfers & aangifte' eronder. VEREIST EEN INGELOGDE TENANT. F

- **[blocking]** «Slide 3, deel 4: 'BTW & resultaat bekijken'»  
  MOET WEG. Er bestaat geen scherm 'resultaat'. Het heette 'Financieel overzicht', is samengevoegd met 'Je waarheid' en /dashboard/resultaat is nu een kale redirect. De naam leeft alleen nog in de codecommentaren die de verwijdering vastleggen. Een post die een lezer naar 'resultaat' stuurt, stuurt hem naar een scherm da  
  → `src/app/dashboard/resultaat/page.tsx:26-45 (alleen `redirect('/dashboard/waarheid')`); src/app/dashboard/zzp/ZzpDashboard.tsx:379-385 ('"Financieel overzicht" (`
- **[blocking]** «Slide 3, deel 2: 'Bonnetjes scannen'»  
  Twee fouten in twee woorden. (a) Er is geen knop en geen scherm dat zo heet; de knop heet 'Bon of factuur toevoegen' en de stapel waar het in landt heet 'Inkomend'. (b) 'Scannen' verkoopt dit als een OCR-scanner — precies de positionering die de homepage bewust heeft geschrapt, met de reden erbij: lezen is de eerste va  
  → `src/lib/i18n/messages.ts:1695 ('int.toevoegen': 'Bon of factuur toevoegen'), :438 ('start.tegel.inkomend': 'Inkomend'), :72 ('nav.incoming': 'Inkomend'); src/ap`
- **[blocking]** «DE ROL-VRAAG: mag slide 3 één set noemen, terwijl de navigatie per vak verschilt?»  
  JA — mits de slide over de TEGELS op het startscherm gaat en niet over de balk onderin. Het raster 'Mijn administratie' rendert Facturen, Inkomend, Inkoopfacturen, Leveranciers, Bank, Kas, Dagomzet, Artikelen en Uren voor ELKE ondernemer, ongeacht vak; alleen Voertuigen en Werk staan achter een voorwaarde. De ONDERBALK  
  → `src/app/dashboard/zzp/ZzpDashboard.tsx:313-350 (AdminTile's, onvoorwaardelijk) tegenover :352-361 (`{vehicleTrade && …}`, `{workPluralKey && …}`); src/lib/nav-d`
- **[important]** «Slide 3, deel 3: 'Bankafschriften importeren'»  
  De tegel heet 'Bank', niet 'Bankafschriften', en het scherm zegt 'Upload je afschrift als…', niet 'importeren'. Verder klopt de zaak wel: het scherm leest CAMT.053 (.xml), MT940 (.940/.sta/.txt) of CSV. PDF NIET — dat mag de post nergens suggereren.  
  → `src/lib/i18n/messages.ts:441 ('start.tegel.bank': 'Bank'), :1176 ('bank.upload.als': 'Upload je afschrift als'), :3827-3830 ('bank.formaten': 'CAMT.053 (.xml), `
- **[important]** «LET OP voor de rest van het plan: de aangeleverde feitenlijst klopt niet meer op de navigatie»  
  Punt 10 van de vastgestelde feiten zegt 'Start / Facturen / Inkomend / Bestanden / Klanten / Kwartaal'. Dat is één lijst van twee verschillende balken. De ondernemer ziet er VIJF: Start / Facturen / Vandaag / Inkomend / Bestanden — met 'Vandaag' op de derde plek. 'Klanten' en 'Kwartaal' staan op de BOEKHOUDERS-balk, ni  
  → `src/lib/nav-destinations.ts:62 (VANDAAG, label 'chrome.vandaag'), :99-104 (OWNER), :106-111 (ACCOUNTANT met nav.clients + nav.quarter); src/lib/i18n/messages.ts`
- **[minor]** «Slide 3, deel 1: 'Facturen maken'»  
  Enige van de vier die al bijna goed was. De tegel heet 'Facturen' en de knop erop heet 'Nieuwe factuur'. Aangehouden als 'Facturen — maken en versturen', want versturen is echt: de app mailt de PDF plus de e-factuur XML.  
  → `src/lib/i18n/messages.ts:437 ('start.tegel.facturen': 'Facturen'), :356 ('lijst.nieuw': 'Nieuwe factuur'); knop: src/app/dashboard/facturen/FacturenClient.tsx:2`
- **[minor]** «Slide 4: 'En alles netjes bewaren.'»  
  Waar, maar leeg — 'bewaren' is nergens een woord in de app. Er is wél een scherm dat precies dit is en dat 'Bestanden' heet, en het staat in de onderbalk van elke ondernemer. Aangescherpt tot de echte naam, zodat de lezer na registratie het woord terugvindt.  
  → `src/lib/i18n/messages.ts:73 ('nav.files': 'Bestanden'); src/lib/nav-destinations.ts:103 (in OWNER, dus bij élk vak in de balk)`
- **[minor]** «Slide 6: 'BoekBrug = de brug tussen jou en je boekhouder.'»  
  De zin is letterlijk goed — het is de eigen omschrijving van het product. Alleen het '=' is codetaal; het product schrijft het als zin. Gecorrigeerd naar de geschreven vorm.  
  → `src/app/page.tsx:32 ('BoekBrug is de brug tussen jou en je boekhouder.')`

## Dag 2 · LinkedIn · Tekstpost, productfilosofie (geen beeld verplicht); 'slides' = de alinea's, in volgorde

Verdict: **HERSCHREVEN** · asset: Geen beeld verplicht; dit is een tekstpost en wint bij alleen tekst. Optioneel één beeld: dezelfde schermkop in het Nederlands en het Arabisch naast elkaar (rechts-naar-links zicht

- **[blocking]** «VERMEDEN: 'wij lezen alleen je factuur-bijlagen, nooit je persoonlijke mail'»  
  Die zin is onwaar en zou een privacybelofte zijn die we niet kunnen nakomen. De mailkoppeling is leestoegang tot de hele mailbox met een intern trefwoordfilter. De post zegt daarom precies dat: we vragen leestoegang, en we filteren zelf.  
  → `vastgesteld feit 16 van de audit; de koppeling loopt via src/app/api/email/callback/gmail en /outlook`
- **[blocking]** «VERMEDEN: 'jij controleert alles' én 'volledig automatisch'»  
  Allebei onwaar, in tegengestelde richting. De app boekt de zekere gevallen zonder tik — een duidelijke factuur, een kassabon met een afgedrukte betaalregel, een bankregel die op de cent aansluit op een factuurnummer. Maar de eigenaar kan dat uitzetten, en dan wacht alles op zijn tik. De post zegt daarom: wat zeker is b  
  → `src/lib/auto-boeken.ts:1-14 ('May the app book a read WITHOUT the owner's tap … OFF means every read — invoice and bon alike — waits in the verify queue'), :29-`
- **[important]** «VERMEDEN: de featureopsomming als filosofie verkopen»  
  De verleiding bij een 'wat is het eigenlijk'-post is om breder te worden: werk én geld én administratie. belofte.ts weigert dat expliciet — niet uit bescheidenheid maar omdat breedte de vergelijking oproept die BoekBrug verliest. De post houdt daarom de rangorde aan: alles wat de app doet, dient één zin.  
  → `src/lib/belofte.ts:104-114 ('De verleiding is dan om de belofte te VERBREDEN … Dat is precies de featurevergelijking die de rest van dit bestand weigert te voer`
- **[important]** «TOEGEVOEGD: de drie talen — een feit dat het hele plan mist»  
  De schermen spreken Nederlands, Engels en Arabisch, en de app weet dat Arabisch van rechts naar links loopt. Dat is voor een Nederlands boekhoudpakket zeldzaam en het is precies een filosofie-argument: de documenten blijven Nederlands (factuur, e-factuur, de wet leest mee), de knoppen erboven niet. Turks is bewust nog   
  → `src/lib/i18n/locale.ts:53-55 (Locale = 'nl' | 'en' | 'ar' | 'tr'), :83 (ar: dir 'rtl'); src/lib/i18n/messages.ts:28-33 ('TURKISH — Deliberately absent for now …`
- **[minor]** «Er was geen concept aangeleverd — alleen het thema 'productfilosofie'»  
  Geheel geschreven. De filosofie is niet verzonnen voor de post: hij staat uitgeschreven in het product zelf, in het bestand dat de belofte bewaakt. Elke stelling hieronder is daaruit overgenomen, niet eromheen bedacht.  
  → `src/lib/belofte.ts (volledig bestand: 'De ene zin waarmee BoekBrug zichzelf uitlegt — op élke plek dezelfde')`

## 3 · Instagram · carrousel, 6 slides

Verdict: **GECORRIGEERD** · asset: Slides 1-4: eigen fotografie, geen app nodig (bon in jaszak, bon in het autodashboard, vervaagde thermobon). Slide 5: still uit een schermopname van Inkomend met de blauwe knop 'Fo

- **[blocking]** «Slide 6: 'Foto -> controleren -> opslaan. Klaar.'»  
  Er bestaat in geen van beide paden een knop 'Opslaan'. In de app is uploaden zelf het bewaren (het bestand gaat direct naar storage en krijgt een documents-rij); op de gratis tool wordt er juist niets bewaard. De post belooft een handeling die de gebruiker gaat zoeken en niet vindt.  
  → `src/app/api/intake/route.ts:346-360 (upload + insert, geen bevestigingsstap); src/app/dashboard/upload/UploadClient.tsx:581-588 met messages.ts:10773 ('Bestande`
- **[blocking]** «Slide 6: 'controleren' als verplichte tussenstap»  
  Een kassabon waarvan het papier de betaalwijze afdrukt (PIN, Kontant, Wisselgeld, Bankpas, Maestro) wordt zonder enige tik als betaald geboekt. 'Jij controleert alles' is hier onwaar; de app handelt zelf. Omgekeerd mag de post niet 'volledig automatisch' worden, want een zwijgende bon gaat wél naar de wachtrij.  
  → `src/lib/receipt-auto-settle.ts:27-34 en 100-138 (de gate); aangeroepen in src/app/api/intake/route.ts:1322; melding in src/lib/receipt-auto-settle.ts:154-161`
- **[important]** «De hele carrousel gaat uit van een bestaand account»  
  Geen fout in de tekst, wel een gat in de post: wie nog geen account heeft kan niets doen met 'maak een foto'. De gratis, login-vrije scan is er en hoort in het bijschrift — met de echte grens (3 per dag) en de echte belofte (er wordt niets bewaard), nooit met 'onbeperkt'.  
  → `src/app/factuur-scannen/FactuurScanner.tsx:17 (DAILY_CAP = 3); src/app/factuur-scannen/page.tsx:44-45; src/lib/fair-use.ts:95-105 (50 gratis per kalendermaand, `
- **[minor]** «Slide 4: 'is een kostenpost die je misschien niet meer kunt meenemen'»  
  Onnodig vaag én zwakker dan wat het product zelf publiceert. De eigen kennisbank zegt het hard en correct, en de vage variant leest als een slag om de arm die het punt doodmaakt.  
  → `content/blog/nl/aftrekposten-zzp-2026.mdx:43 ('Geen bewijs = geen aftrek'); content/blog/nl/bonnetjes-scannen-app.mdx:19 ('elk bonnetje dat je kwijtraakt, is bt`
- **[minor]** «Slide 5: 'BoekBrug leest de belangrijkste gegevens uit' zonder schermnaam»  
  De carrousel vertelt nergens waar je die foto maakt, terwijl 'Foto maken' een bestaande knop op een bestaand navigatie-item is. Zonder die naam moet de lezer raden; met die naam is de post uitvoerbaar.  
  → `messages.ts:72 (nav.incoming = 'Inkomend'); messages.ts:8352 (ink.upload.foto = 'Foto maken'), gerenderd in src/app/dashboard/incoming/IncomingInvoicesClient.ts`

## Dag 3 · Instagram Stories · Story — Interaction (poll-sticker) + antwoordframe, 3 frames

Verdict: **GECORRIGEERD** · asset: Frame 1 en 3: puur typografisch, geen asset nodig. Frame 2 VEREIST een ingelogde demo-tenant: schermopname van het intake-sheet (Bon of factuur toevoegen → Foto maken) plus de land

- **[blocking]** «Risico dat het antwoordframe zegt dat de bon in 'Bestanden' of 'Inkomende facturen' belandt.»  
  De app meldt letterlijk 'bon → Inkoopfacturen'. 'Inkomend' is de balknaam van /dashboard/incoming; 'Inkoopfacturen' is de naam van /dashboard/incoming/manage. 'Inkomende facturen' bestaat als schermnaam niet.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:8962-8966 ('int.landed.bon' = 'bon → Inkoopfacturen'); messages.ts:72 ('nav.incoming' = 'Inkomend'); /home/user/boe`
- **[important]** «De poll 'Ben jij wel eens een bonnetje kwijtgeraakt?' staat los, zonder antwoordframe dat de echte deur in de app noemt.»  
  Een poll die niets uitbetaalt is een verspilde beat, en het antwoordframe is precies de plek waar een schermnaam verzonnen wordt. De knop heet 'Bon of factuur toevoegen' met daaronder 'Foto maken' en 'Bestand uploaden' — niet 'scan', niet 'upload bonnetje'.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:1695-1698 ('int.toevoegen' = 'Bon of factuur toevoegen', 'int.fotoMaken' = 'Foto maken', 'int.bestand' = 'Bestand u`

## 4 · Instagram · Reel, ~30s (10 beats)

Verdict: **HERSCHREVEN** · asset: Eén schermopname in twee helften, duidelijk gescheiden door de tekstkaart 'Wil je hem bewaren? Dan met een account.'
Helft 1 (beats 2-5): /factuur-scannen in een UITGELOGD browserv

- **[blocking]** «'Opslaan. Klaar.'»  
  Die knop bestaat niet — niet op de gratis scan en niet in de app. Op de gratis tool zijn de enige knoppen 'Nog een factuur scannen' en 'Overnemen in een factuur →'; in de app is uploaden zelf het opslaan. Een Reel die een niet-bestaande knop laat zien, is een Reel die de kijker in de app laat zoeken naar iets wat er ni  
  → `src/app/factuur-scannen/FactuurScanner.tsx:266-306; src/app/api/intake/route.ts:346-360; src/app/dashboard/upload/UploadClient.tsx:581-588`
- **[blocking]** «De Reel maakt geen onderscheid tussen de gratis scan en de app»  
  'BoekBrug leest het bonnetje' over een uitgelogd scherm suggereert dat je boekhouding hiermee gevuld wordt. Dat gebeurt niet: de publieke route slaat niets op en retourneert alleen JSON. De kijker denkt klaar te zijn terwijl er niets bewaard is — precies de fout die de post zegt op te lossen.  
  → `src/app/api/tools/scan-invoice/route.ts (geen enkele storage- of insert-aanroep; alleen NextResponse.json({data})); src/app/factuur-scannen/page.tsx:44-45`
- **[important]** «Veldenlijst 'Leverancier, Bedrag, BTW, Datum'»  
  Te smal én niet de woorden van het scherm. Het resultaatblok heet 'Uitgelezen gegevens' en toont elf labels; 'Bedrag' en 'Datum' staan er niet tussen — er staat 'Factuurdatum', 'Subtotaal (excl. BTW)', 'BTW 21%', 'BTW totaal', 'Totaal (incl. BTW)'. Ook btw-nummer, KvK, factuurnummer, vervaldatum, iban en de losse regel  
  → `src/app/factuur-scannen/FactuurScanner.tsx:231-252 (Field-labels) en 254-264 (Regels)`
- **[important]** «'Even controleren' als algemene stap»  
  Op de gratis tool klopt het (de pagina zegt zelf dat de herkenning een hulpmiddel is en dat je bedragen en btw-tarief controleert). In de app klopt het niet voor de zekere gevallen: een bon met afgedrukte tenderregel wordt zonder tik geboekt. Eén zin kan dus niet allebei de paden dekken — vandaar de splitsing.  
  → `src/app/factuur-scannen/page.tsx:132-135; src/lib/receipt-auto-settle.ts:100-138 met src/app/api/intake/route.ts:1322`
- **[minor]** «'Nog steeds bonnetjes overtypen?' + 'Doe dit.'»  
  Geen feitelijk probleem — de hook blijft staan. 'Doe dit.' is vervangen door de plek waar je het doet, omdat een Reel zonder route geen actie oplevert.  
  → `messages.ts:72 ('Inkomend'); messages.ts:8352 ('Foto maken'); src/lib/site.ts:6 (boekbrug.nl, zonder www — www-URL's worden doorgestuurd, zie site.ts:28)`

## 4 · LinkedIn · tekstpost (~250 woorden)

Verdict: **HERSCHREVEN** · asset: Geen screenshot nodig; LinkedIn beloont hier tekst. Wil je er één bij: de melding uit de app — 'Deze bon is al afgerekend contant — op de bon staat "Wisselgeld". Wij hebben hem daa

- **[blocking]** «Briefing: 'een LinkedIn-post over de juiste rol van AI' — geen tekst aangeleverd»  
  De standaardvorm van die post ('de AI doet het werk, jij controleert alles') is voor dit product onwaar in beide richtingen: de app boekt de zekere gevallen zelf, en de onzekere gevallen boekt hij juist bewust níét. Daarom is de post geschreven vanuit de regel die de code echt hanteert, niet vanuit het genre.  
  → `src/lib/receipt-auto-settle.ts:17-34 (wat het veilig maakt om het zonder mens te doen) en 100-138 (de gate); src/lib/auto-advance.ts:113-153 (wat nooit automati`
- **[blocking]** «Risico: 'volledig automatisch' als claim»  
  Mag nergens vallen. Een bon zonder afgedrukte betaalwijze gaat naar de wachtrij, en een hele klasse documenten wordt per definitie nooit automatisch geboekt. Daar is de post op gebouwd: het is de these, niet het kleine lettertje.  
  → `src/lib/receipt-auto-settle.ts:110-112 (method_not_printed → HOLD); src/lib/auto-advance.ts:117-128`
- **[important]** «Risico: de tenderwoorden verzinnen»  
  De post noemt de woorden die de code echt herkent en die de app letterlijk overneemt in de melding aan de eigenaar. Verzonnen voorbeelden zouden precies het argument van de post ondergraven — dat je onze conclusie aan je eigen bon moet kunnen narekenen.  
  → `src/lib/receipt-auto-settle.ts:27-29 ('Kontant', 'Wisselgeld', 'Bankpas', 'PIN', 'Maestro'); src/lib/receipt-auto-settle.ts:154-161 (settleNoticeText neemt het `

## Dag 4 · Instagram Stories · Story — Product-demo (schermopname), 4 frames

Verdict: **GECORRIGEERD** · asset: Frames 1-3 VEREISEN een ingelogde demo-tenant: schermopname van het intake-sheet, de gelezen velden en de controlewachtrij. Frame 4 kan typografisch. De CTA-shot kan van de publiek

- **[blocking]** «'AI scan' zonder te zeggen WELKE scan. Er zijn er twee met heel verschillende beloftes: de publieke tool (geen account, 3 per dag, bewaart niets) en het lezen binnen een account (50 documenten per maa»  
  Wie na deze story de publieke tool opent en 50 bonnen wil doen, loopt na drie stuks vast. Wie een account maakt en 'onbeperkt' verwacht, loopt na 50 vast.  
  → `/home/user/boekbrug/src/app/factuur-scannen/FactuurScanner.tsx:17 (DAILY_CAP = 3); /home/user/boekbrug/src/lib/fair-use.ts:96-105 (aiDocuments free: 50, plus: 5`
- **[blocking]** «Kans op het woord 'onbeperkt' — de app zegt het zelf op de scanpagina ('maak een gratis account voor onbeperkt scannen').»  
  Dat is in de app zelf al onjuist tegenover fair-use.ts. Neem die fout niet over in de campagne. (Los hiervan: die zin in de app hoort ook gerepareerd te worden — apart ticket.)  
  → `/home/user/boekbrug/src/app/factuur-scannen/FactuurScanner.tsx:124 tegenover /home/user/boekbrug/src/lib/fair-use.ts:99-100`
- **[important]** «Kans op 'jij controleert elke regel' als geruststelling.»  
  Bij een duidelijke factuur boekt de app zonder tik. Beloven dat jij alles controleert is even onwaar als beloven dat niets gecontroleerd hoeft te worden.  
  → `/home/user/boekbrug/src/lib/auto-boeken.ts:26-44 (auto-boeken staat aan tenzij de eigenaar hem uitzet); /home/user/boekbrug/src/lib/intake-router.ts:222-260`

## DAG 5 · Instagram · Carrousel, 7 slides

Verdict: **HERSCHREVEN** · asset: Vijf schermafdrukken van /dashboard/invoice/new, ingelogde tenant nodig met minstens een klant en een ingevuld bedrijfsprofiel: (a) de kaart 'Aan' met het zoekveld 'Zoek of typ kla

- **[blocking]** «De caption eindigt met de belofte dat je je werk in gewone taal beschrijft en de AI de factuur maakt.»  
  Die functie bestaat niet. Er is geen route die uit een zin een verkoopfactuur bouwt; de claim moet zonder vervanging weg.  
  → `Vastgesteld in de eerdere audit: de enige AI-routes zijn /api/tools/scan-invoice (publiek), /api/ai/draft-email (boekhoudersscherm) en /api/email/reimport. Het `
- **[blocking]** «De stappen gaan van '1. Kies je klant' rechtstreeks naar '2. Voeg je werkzaamheden toe'.»  
  Tussen die twee zit de verplichte kaart Datums met Factuurdatum, Vervaldatum en Leverdatum. Wie de carrousel letterlijk volgt, loopt vast op drie rode velden. Leverdatum is geen detail: dat is de eis die de eigen gids als meest vergeten noemt.  
  → `Kaart 'Datums' in src/app/dashboard/invoice/new/page.tsx:1748-1876; validatie die versturen EN opslaan blokkeert op page.tsx:1120-1133; labels in src/lib/i18n/m`
- **[important]** «'(Omschrijving, Aantal, Prijs, BTW)'»  
  Twee van de vier velden heten anders op het scherm. Het prijsveld heet 'Prijs excl. (€)' of 'Prijs incl. (€)', afhankelijk van de schakelaar 'Prijzen invoeren' (standaard excl.), en het btw-veld heet 'BTW %'. Een post die naar velden wijst, schrijft ze zoals de app ze schrijft.  
  → `src/lib/i18n/messages.ts:208-214 en :221; het label 'BTW %' staat hard in src/app/dashboard/invoice/new/page.tsx:1957; standaardstand 'excl' op page.tsx:935. De`
- **[important]** «'4. Opslaan & versturen'»  
  De knop schrijft 'en', niet '&' — en hij verstuurt niet meteen: er komt eerst het venster 'Factuur versturen?' met de knop 'Ja, verstuur'. Die bevestiging weglaten maakt van een onomkeerbare stap een terloopse tik.  
  → `src/lib/i18n/messages.ts:243 ('Opslaan en versturen'), :281 ('Factuur versturen?'), :286 (uitleg: definitief nummer + PDF per e-mail, niet ongedaan te maken), :`
- **[minor]** «'BoekBrug geeft automatisch een opvolgend factuurnummer' staat bij stap 4, en de volgende slide zegt dat je hem ook als concept kunt bewaren.»  
  Zo gelezen heeft een concept al een nummer. Dat heeft het niet: het nummer wordt pas bij verzenden uit de doorlopende reeks geslagen, en het scherm noemt het tot dat moment uitdrukkelijk een verwachting.  
  → `src/app/dashboard/invoice/new/page.tsx:703-706 (leeg nummer = 'Concept'); messages.ts:262-266 ('Volgend factuurnummer' / 'Verwacht — het nummer wordt definitief`
- **[minor]** «'Je eerste factuur? Maak hem gratis met BoekBrug.'»  
  Waar is, maar het verzwijgt welke van de twee gratis wegen je krijgt. De browser-tool vraagt geen account en levert dezelfde PDF, maar kan niet mailen; in een gratis account verstuur je tot 100 facturen per maand. De CTA noemt nu de weg die bij 'je eerste factuur' hoort.  
  → `src/app/factuur-maken/GratisFactuur.tsx:662 ('Geen account nodig — je gegevens blijven in je browser') en :987 ('↓ Download PDF'), geen mailpad in dat bestand; `

## DAG 6 · LinkedIn · Tekstpost

Verdict: **GECORRIGEERD** · asset: Geen beeld nodig — tekstpost. Wil je er toch een beeld bij: een uitsnede van de factuur-PDF waarop de regels 'Leverdatum:', 'BTW nr.:' en 'KvK nr.:' en het totalenblok per tarief z

- **[blocking]** «De lijst telt zes punten: factuurdatum, factuurnummer, gegevens van jou, gegevens van je klant, omschrijving, BTW.»  
  De leverdatum ontbreekt, terwijl de eigen gids hem apart noemt en bij de veelgemaakte fouten herhaalt ('Geen leverdatum'). De app behandelt hem als verplicht: zonder leverdatum komt een factuur er niet doorheen. Een checklistpost die de eis weglaat, laat lezers een factuur sturen die de app zelf zou weigeren.  
  → `content/blog/nl/factuur-eisen.mdx:35 (de leverdatum als eigen punt) en :67 (veelgemaakte fout); verplicht veld en blokkerende validatie in src/app/dashboard/inv`
- **[important]** «'BTW' als een enkel punt.»  
  Er moeten vier bedragen op staan: het bedrag zonder btw, het btw-tarief, het btw-bedrag en het totaal. 'BTW' dekt dat niet, en juist daar gaat het mis bij een factuur met twee tarieven.  
  → `content/blog/nl/factuur-eisen.mdx:37 en het voorbeeldtabelletje op :41-47; de PDF drukt per tarief een regel '21,00% BTW over € 100,00' (src/lib/invoice-pdf.tsx`
- **[important]** «'gegevens van jou'»  
  Te vaag voor het punt dat het vaakst ontbreekt. De gids vraagt naam, adres, btw-id en KvK-nummer, en de verstuurroute weigert de factuur als een van die vier ontbreekt — nog voordat er een nummer aan hangt.  
  → `content/blog/nl/factuur-eisen.mdx:33; weigering op naam, adres, BTW-nummer en KvK-nummer in src/app/api/invoice/send/route.ts:415-429 (en de opmerking daarboven`
- **[important]** «Geen woord over de KOR of over verlegde btw.»  
  Een flink deel van het LinkedIn-publiek zit in de KOR. Voor hen is 'zet de BTW erop' precies het verkeerde advies: zij zetten geen btw op de factuur en wel de vermelding erbij. De app dwingt dat af door onder de KOR alleen 0% aan te bieden.  
  → `content/blog/nl/factuur-eisen.mdx:49-59; src/lib/kor-invoice.ts:92-94 (KOR_RATE_HINT: 'je brengt geen BTW in rekening — 0% is het enige tarief'), getoond op src`
- **[minor]** «Niets over het btw-nummer van je klant bij levering aan een bedrijf in de EU.»  
  Kleine groep, grote gevolgen: zonder dat nummer mag de btw niet verlegd worden en weigert de app de 0%-factuur naar een EU-bedrijf.  
  → `content/blog/nl/factuur-eisen.mdx:39; de weigering in src/app/dashboard/invoice/new/page.tsx:1152-1160 (checkEuZeroRatedInvoice) en de eis bij verlegde btw op m`

## DAY 7 · Instagram · Carrousel, 5 slides

Verdict: **HERSCHREVEN** · asset: Ingelogde demo-tenant vereist (echte schermen, geen mockup). Nodig: (1) /dashboard/uren met het formulier open na 'Uur toevoegen' — Datum, Klant, Uren, Uurtarief, 'Wat heb je gedaa

- **[blocking]** «Je typt op het startscherm 'Stuur 4 uur advies aan klant X' en de AI maakt daar een factuur van.»  
  Die functie bestaat niet. Geen enkele route bouwt een factuur uit een getypte zin; de AI in dit product leest documenten (publieke scan) en schrijft één e-mailconcept op het boekhouderscherm. De post belooft dus een product dat de gebruiker na installatie niet terugvindt.  
  → `src/app/api/ai/ bevat alleen draft-email en translate; src/app/api/tools/scan-invoice is de publieke, inlogvrije scan; er is geen route onder src/app/api die vr`
- **[blocking]** «De suggestie dat de factuur zichzelf afmaakt ('AI vult de factuur').»  
  De uren-deur levert een CONCEPT op; versturen is een aparte menselijke handeling met een bevestiging, en pas dan valt het factuurnummer (art. 35 Wet OB). 'Volledig automatisch' beloven waar een mens moet drukken, is precies wat AGENTS.md verbiedt.  
  → `src/app/api/invoice/draft/route.ts:437 zet status 'draft'; src/app/dashboard/uren/UrenClient.tsx:246 stuurt door naar /dashboard/invoice/{id}/edit; src/app/dash`
- **[important]** «'startscherm' en 'de app maakt de factuur' als schermnamen.»  
  Een zin die naar een scherm wijst, noemt het zoals de app het schrijft. De navigatie schrijft 'Start'; het scherm waar dit gebeurt heet 'Uren'; het tabblad heet 'Nog te factureren' en de knop 'Maak factuur'.  
  → `src/lib/i18n/messages.ts:69 ('nav.start' = 'Start'), :14470 ('uren.titel' = 'Uren'), :14518 ('uren.teFactureren' = 'Nog te factureren'), :14520 ('uren.maakFactu`
- **[important]** «Een bedrag/tarief dat uit het niets verschijnt in de oude slides.»  
  Het tarief vult zich alleen in als de klant een Uurtarief heeft, en een zelf getypt bedrag wordt nooit overschreven. Dat voorbehoud moet in de copy, anders belooft de post een bedrag dat bij een lege klantkaart niet komt.  
  → `src/lib/uren.ts:465-486 (prefillHourlyRate: getypt tarief blijft staan; zonder klanttarief blijft het veld leeg); src/app/dashboard/uren/UrenClient.tsx:369-400;`

## Dag 7 · Instagram Stories · Story — Product-demo (schermopname), 4 frames

Verdict: **HERSCHREVEN** · asset: VEREIST een ingelogde demo-tenant met dienstverlener-rol (Werk staat alleen in de balk bij die rol), met minstens één klant mét vast tarief en 3-4 afgeronde klussen. Zonder die dat

- **[blocking]** «'AI invoice creation' — je beschrijft je werk in gewone taal en de AI schrijft de factuur.»  
  Die functie bestaat niet. De enige AI-routes zijn /api/tools/scan-invoice (publiek, zonder login), /api/ai/draft-email (alleen het boekhoudersscherm) en /api/email/reimport. Geen daarvan maakt een verkoopfactuur uit een zin. Dit is geen overdrijving maar een verzonnen functie — de hele story moet weg.  
  → `/home/user/boekbrug/src/app/api/tools/scan-invoice/route.ts:1-20; /home/user/boekbrug/src/app/api/ai/ (alleen draft-email); geen route onder /home/user/boekbrug`
- **[blocking]** «De Engelse term 'invoice creation' / 'invoice creator'.»  
  De app schrijft Nederlands op het scherm. De knop heet 'Maak factuur', het scherm 'Nieuwe factuur'.  
  → `/home/user/boekbrug/AGENTS.md (Dutch on the screen); /home/user/boekbrug/src/lib/i18n/messages.ts:14043 ('werk.factuurMaken' = 'Maak factuur')`
- **[blocking]** «Vervanging die de vorm behoudt (weinig typen → hele factuur): de echte uren-naar-factuur weg.»  
  Op Werk bouwt één knop uit meerdere afgeronde klussen voor dezelfde klant één verzamelfactuur, met het tarief van die klant al ingevuld. Het resultaat is nadrukkelijk een concept, niet een verstuurde factuur — dat verschil moet in de copy staan.  
  → `/home/user/boekbrug/src/app/api/werk/factuur/route.ts; /home/user/boekbrug/src/lib/i18n/messages.ts:14043 ('Maak factuur'), :14045 ('De factuur staat klaar als `

## DAG 8 · Instagram · Carrousel, 6 slides

Verdict: **HERSCHREVEN** · asset: Ingelogde testtenant nodig, met minstens één verstuurde factuur waarvan de vervaldatum voorbij is. Slide 3: screenshot van /dashboard/facturen met het filtermenu OPEN (alle zeven o

- **[blocking]** «Te laat? Stuur een vriendelijke herinnering»  
  De ondernemer heeft die knop niet. /api/invoice/[id]/reminder wordt in de hele app maar vanaf twee schermen aangeroepen: het werkbord van een verkoopMEDEWERKER en het debiteurenscherm van de BOEKHOUDER. Een eigenaar die /dashboard/verkoop opent wordt weggestuurd naar /dashboard/facturen. Wat hij wel heeft is de automat  
  → `src/app/dashboard/verkoop/VerkoopClient.tsx:100 en src/modules/accountant/pages/AccountantDebiteuren.tsx:86 zijn de enige aanroepers; src/app/dashboard/verkoop/`
- **[blocking]** «Filter op openstaande of verlopen facturen»  
  Er is geen filteroptie 'Openstaand'. Het filter kent zeven opties en 'Openstaand' zit daar niet bij. 'Openstaand' bestaat wel, maar als BEDRAG-tegel boven de lijst, naast de tegel 'Te laat' — en die tweede tegel is een knop die het filter op Verlopen zet. De post stuurt de lezer dus naar een knop die niet bestaat, terw  
  → `src/app/dashboard/facturen/FacturenClient.tsx:183-191 (FILTERS: all/sent/paid/draft/overdue/offerte/credit); :1333-1341 (de twee tegels; onClick={() => setFilte`
- **[important]** «In BoekBrug zie je: Concept, Verzonden, Betaald, Verlopen»  
  Dat zijn vier van de zeven opties. Wie de lijst opent ziet ook Alles, Offerte en Creditnota staan, en het is geen rij tabbladen maar één dropdown-knop die de actieve keuze toont. Vier van de zeven noemen maakt de belofte kleiner dan het scherm.  
  → `src/app/dashboard/facturen/FacturenClient.tsx:183-191; :1230-1272 (de dropdown: één knop met de actieve filternaam, daaronder een menu met alle zeven)`
- **[minor]** «(impliciet) Verlopen als vierde stempel naast Concept/Verzonden/Betaald»  
  Verlopen wordt nergens opgeslagen — het is verstuurd + vervaldatum voorbij, elke dag opnieuw berekend in Amsterdamse dagen. Het gevolg is copy-waardig: een factuur zonder vervaldatum heet nooit te laat. Dat verzint de app niet.  
  → `src/hooks/useInfiniteInvoices.ts:161-167 (q.eq('status','sent').lt('due_date', today)) en :260-262 ('Overdue is computed, not stored'); src/lib/overdue.ts:29-43`

## DAG 9 · LinkedIn · Tekstpost

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig; dit werkt als tekstpost. Wil je er toch één bij: screenshot van /dashboard/facturen met de tegels Openstaand en Te laat naast elkaar, met het bedrag in Te laat ro

- **[blocking]** «je wilt weten: betaald / openstaand / verlopen»  
  Drie woorden van drie verschillende plekken, alsof het één rijtje is. 'Betaald' en 'Verlopen' staan in het filter, 'Openstaand' is een bedrag-tegel boven de lijst en bestaat niet als filteroptie. Wie dit leest en gaat zoeken, zoekt zich suf naar een tabblad Openstaand.  
  → `src/app/dashboard/facturen/FacturenClient.tsx:183-191 (de zeven filteropties); :1333-1341 (de tegels); src/lib/i18n/messages.ts:10090-10091`
- **[important]** «en boven alles: welke actie moet ik vandaag nemen?»  
  Voor een te late factuur is het eerlijke antwoord meestal: geen. De herinnering is vanochtend al verstuurd door de cron, zonder dat er iemand ingelogd was. De post stelt dus een vraag die de app juist heeft afgeschaft — en dat is het interessantere verhaal voor LinkedIn dan 'wij geven je overzicht'.  
  → `vercel.json:22-25 ('/api/cron/reminders', '0 7 * * *'); src/app/api/cron/reminders/route.ts:1-7 en :696-707 (sendInvoiceReminder); supabase/migrations/reminders`
- **[important]** «(risico in de uitwerking) 'er zit geen knop herinnering sturen in BoekBrug'»  
  Die knop bestaat wel — alleen niet op de schermen van de ondernemer. Een verkoopmedewerker en een boekhouder met mandaat hebben hem. De zin moet dus over JOU gaan, niet over de app.  
  → `src/app/dashboard/verkoop/VerkoopClient.tsx:100 en src/modules/accountant/pages/AccountantDebiteuren.tsx:86 (de enige aanroepers van /api/invoice/[id]/reminder)`
- **[important]** «(aanvulling, ontbrak) hoe een factuur op Betaald komt»  
  De post gaat over cashflow en laat het slot weg: staat het factuurnummer met het bedrag tot op de cent in je bankafschrift, dan koppelt de app de betaling zelf en zet hem op Betaald. Dat is precies het moment waarop de herinneringen stoppen.  
  → `src/app/api/cron/reconcile/route.ts:1-14 ('runBankAutoConfirm only touches isSafeAutoConfirm matches (reference printed + amount to the cent, single invoice), f`

## Sectie 9 · Alle kanalen (herbruikbaar blok) · CTA-bibliotheek

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig; dit is een tekstsectie. Waar een CTA in beeld staat, hoort het schermbeeld bij de bestemming: /factuur-scannen en /factuur-maken zijn uitgelogd te fotograferen, /

- **[blocking]** «Product-CTA: 'Bekijk hoe het werkt'»  
  Er is geen bestemming. Geen enkele route, pagina of sectie heet 'Hoe het werkt'; een grep op 'Hoe het werkt' en 'hoe-het-werkt' over src/app en src/components levert nul treffers. De publieke bestemmingen zijn uitputtend: /, /tools, /blog, /prijzen, /bewaarplicht, /beveiliging, /eerlijk-gebruik, /privacy, /voorwaarden,  
  → `src/components/public-header.tsx:31-44 en src/components/public-footer.tsx:34-60 (volledige publieke navigatie); geen treffer op 'Hoe het werkt' in src/app of s`
- **[blocking]** «Product-CTA 'Scan je eerste bonnetje' en conversie-CTA 'Scan gratis je eerste bonnetje'»  
  Twee problemen tegelijk. (1) De landingspagina heet 'Factuur scannen met AI' en het woord bonnetje staat er nergens op — de kop, de ondertitel en de FAQ zeggen allemaal 'je factuur'. Wie op 'bonnetje' klikt, landt op een pagina die een ander woord voert en denkt dat hij verkeerd zit. De route LEEST een bon wel (documen  
  → `src/lib/tools.ts:35-37 en src/app/factuur-scannen/page.tsx:88 ('Factuur scannen met AI'), :91-92, :39-46; src/app/api/tools/scan-invoice/route.ts:86 en :101 (do`
- **[blocking]** «Product-CTA 'Maak je eerste factuur' en conversie-CTA 'Maak vandaag je eerste factuur'»  
  Eén zin, twee producten met verschillende beloften. /factuur-maken draait volledig in de browser, vraagt geen account en levert dezelfde PDF als een betalende gebruiker — maar kan NIET versturen. Pas in een account mailt 'Versturen' de PDF plus de e-factuur-XML. Dezelfde CTA op beide bestemmingen laat de helft van de k  
  → `src/app/factuur-maken/page.tsx:1-6 (login-vrije generator) en :18-20; src/lib/tools.ts:27-29; homepage-knop src/app/page.tsx:147 ('Direct een factuur maken')`
- **[important]** «Product-CTA 'Probeer het gratis' en conversie-CTA 'Probeer BoekBrug gratis'»  
  'Proberen' is precies het woord dat dit product over zichzelf weigert te gebruiken, en niet uit stijl maar omdat er niets te proberen valt: het gratis plan IS het product en loopt niet af. De app schrijft zelf: 'er is geen proefperiode die stilzwijgend een abonnement wordt'. Een CTA die 'probeer' zegt, zet de klok teru  
  → `src/lib/plan.ts:23-25 ('Geen proefperiode. Er is niets om te proberen'); src/lib/i18n/messages.ts:10595-10597; src/lib/subscription.ts:165-167 (gratis plan = 'g`
- **[important]** «De scan-CTA vermeldt geen enkele grens»  
  De publieke scan stopt na 3 per dag per browser en bewaart niets. Beide feiten horen bij de CTA: het eerste omdat iemand die vijf bonnen bij zich heeft anders halverwege stukloopt, het tweede omdat het het sterkste argument is om überhaupt te klikken.  
  → `src/app/factuur-scannen/FactuurScanner.tsx:8 en :52-69 (3-scans-per-dag-plafond in localStorage); src/app/factuur-scannen/page.tsx:45 ('Daarna bewaren we het ni`
- **[minor]** «Awareness-CTA's 'Volg BoekBrug…', 'Bewaar deze post…', 'Stuur dit naar een ZZP'er…'»  
  Geen productclaim, dus feitelijk niets mis. Ze blijven staan zoals ze zijn.  
  → `n.v.t. — bevatten geen verwijzing naar een scherm, knop, route of prijs`

## Sectie 9 — bijlage · Alle kanalen (herbruikbaar blok) · Prijsclaims onder elke CTA

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig. Wie de prijskaarten fotografeert, gebruikt /prijzen uitgelogd; die pagina is publiek en indexeerbaar en heeft geen tenant nodig.

- **[blocking]** «Waar de plannen genoemd worden ontbreekt de prijs van Plus, of staat er € 12,99»  
  Het geldende bedrag is € 19,99 per maand incl. btw. De 12,99 die in commentaar door de repo zwerft is achterstallig — de enige bron is PLUS_PRICE_EUR, en de prijzenpagina typt geen bedrag in maar leidt het daaruit af.  
  → `src/lib/fair-use.ts:57 (PLUS_PRICE_EUR = 19.99); src/lib/plus-price.ts:9-17; verouderd commentaar: src/lib/plan.ts:16 en :42, src/lib/fair-use.ts:93`
- **[important]** «Elke CTA impliceert 'gratis' zonder te zeggen tot waar»  
  'Gratis' klopt en is de kern van het aanbod — het gratis plan is het hoofdplan, niet de instapvariant — maar het kent grenzen, en een CTA die die verzwijgt maakt van 'gratis' een fuik. Zonder cijfer ligt 'onbeperkt' er bovendien altijd in te wachten, en dat is verboden.  
  → `src/app/prijzen/page.tsx:114-136 (€ 0, 'alle functies, binnen het eerlijk gebruik'); src/lib/fair-use.ts:95-144 (50 AI-documenten p/m gratis, 500 op Plus; 100 v`
- **[important]** «De 90 dagen worden nergens genoemd — en dreigen 'proefperiode' te gaan heten»  
  Elk nieuw account (behalve een boekhoudersaccount) krijgt automatisch 90 dagen de Plus-grenzen, geschreven door een trigger op profiles. Er hangt geen kaart aan en er volgt geen incasso: na afloop geldt gewoon het gratis plan. Dat is het sterkste argument in de hele bibliotheek en het staat er niet. Maar het mag nooit   
  → `supabase/migrations/plan_grants.sql:76-99 (grant_welcome_plus + trigger profiles_welcome_plus, 90 days) en :16-20; toegepast in productie volgens docs/WELKE_MIG`
- **[minor]** «Geen enkele CTA noemt de boekhouder, terwijl die gratis is»  
  Het portaal is kosteloos tot en met 10 gekoppelde klanten, en dat is een grens over klanten, nooit over tijd. Voor een post die zich op boekhouders richt is dat de hele propositie.  
  → `src/lib/fair-use.ts:54 (ACCOUNTANT_FREE_CLIENTS = 10); src/app/prijzen/page.tsx:170-196; src/lib/subscription.ts:129-131`

## DAG 10 · Instagram · Carrousel, 7 slides

Verdict: **HERSCHREVEN** · asset: Schermafbeelding van /dashboard/bank met (a) de sleepzone inclusief de regel 'CAMT.053 (.xml), MT940 (.940 / .sta / .txt) of CSV', (b) de groene melding 'Ik heb 7 betalingen automa

- **[blocking]** «Caption bevatte de kwalificatie dat CSV niet als transacties wordt gelezen.»  
  Onwaar, en het spreekt boekbrug.nl zelf tegen. Een CSV wordt volwaardig geparsed naar dezelfde BankTransaction-vorm als MT940/CAMT, via dezelfde route (/api/bank/upload -> importBankStatement -> parseBankFile). Bovendien noemt het bankscherm CSV zelf op, en de publieke /tools-pagina adverteert 'CSV, MT940 of CAMT.053'.  
  → `src/lib/bank-csv.ts:1-25 (CSV-parser, header-gedreven, zelfde BankTransaction-vorm); src/lib/bank-csv.test.ts:70 ('routes via parseBankFile by .csv extension') `
- **[blocking]** «Slide 6: 'Jij controleert de matches'»  
  Overdrijft de menselijke stap en botst met AGENTS-regel 'never promise a human step where the app in fact acts on its own'. De zekere set wordt zonder tik geboekt: bij upload, bij het openen van het scherm, en door de cron ook als er geen browser openstaat. De eigenaar ziet die betalingen al geboekt voordat hij kijkt.  
  → `src/app/api/bank/auto-confirm/route.ts:1-6 en :39-41; src/app/dashboard/bank/BankClient.tsx:625-640 (auto-run bij load, autoRanRef) en :793 (na upload); src/app`
- **[important]** «Slide 5: 'automatisch gematcht met facturen en kosten'»  
  Kosten worden niet gematcht. Facturen worden gematcht (en in beide richtingen: verkoop en inkoop); kosten worden gecategoriseerd, en alleen automatisch als de eigenaar diezelfde tegenpartij eerder zelf heeft gecodeerd. Zonder dat geheugen blijft de regel ongecategoriseerd staan.  
  → `src/lib/bank-matching.ts:12-14 (richting: outgoing <-> credit, incoming <-> debit); src/lib/bank-auto-categorize.ts:1-15 en :40-45 (alleen CONFIDENT = eerder be`
- **[important]** «Slide 3: 'Importeer je bankafschrift in BoekBrug' (geen schermnaam, geen knopnaam)»  
  AGENTS-regel: een zin die naar een knop wijst noemt hem zoals de app hem schrijft. Het scherm heet 'Bank' en de knop 'Kies bankafschrift'. De tegel staat op Start, niet in de onderbalk (die is rolafhankelijk).  
  → `src/app/dashboard/bank/page.tsx:13 (title 'Bank | BoekBrug'); src/lib/i18n/messages.ts:441 start.tegel.bank = 'Bank'; src/app/dashboard/zzp/ZzpDashboard.tsx:331`
- **[important]** «Niets over de bestandskiezer die CSV wegfiltert.»  
  Klopt feitelijk niet met wat de lezer gaat doen. De sleepzone zegt CSV, maar het accept-attribuut van dezelfde input noemt .csv niet, dus het keuzevenster verbergt hem. Slepen werkt wel: onDropZone filtert niets en stuurt het bestand direct door processFile. Dit moet in de caption, anders belooft de post iets dat bij d  
  → `src/app/dashboard/bank/BankClient.tsx:2065 accept='.xml,.940,.sta,.mt940,.txt' tegenover src/lib/i18n/messages.ts:3827-3831; src/app/dashboard/bank/BankClient.t`
- **[minor]** «Slide 7: 'Minder zoeken. Meer overzicht.'»  
  Niet onwaar, wel leeg, en het verspilt de enige slide waar de echte belofte kon staan. Vervangen door de uitkomst die uit de code volgt: alleen de twijfelgevallen blijven over, zichtbaar op het tabblad 'Te bevestigen'. De payoff-zin verhuist naar de caption.  
  → `src/lib/i18n/messages.ts:4318 bank.tab.teBevestigen = 'Te bevestigen'; src/app/dashboard/bank/BankClient.tsx:1723-1727 (tabbladen Te bevestigen / Geen factuur /`

## Dag 10 · Instagram Stories · Story — Product-demo (schermopname), 4 frames

Verdict: **GECORRIGEERD** · asset: Frames 1, 3 en 4 VEREISEN een ingelogde demo-tenant met een geïmporteerd afschrift en openstaande facturen die matchen. Frame 2 en de CTA kunnen van de publieke /bankafschrift-naar

- **[blocking]** «'Bank import' zonder de formaten te noemen zoals het scherm ze noemt.»  
  Het bankscherm schrijft de zin voluit. Een andere formulering stuurt de kijker naar een download bij zijn bank die de app niet leest.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:1176 ('bank.upload.als' = 'Upload je afschrift als'), :3827-3831 ('bank.formaten' = 'CAMT.053 (.xml), MT940 (.940 /`
- **[blocking]** «Risico op de belofte van een directe bankkoppeling in dezelfde story.»  
  Het koppelpaneel verbergt zichzelf zolang de serverinstellingen ontbreken, dus een kijker die erop afkomt ziet het niet eens staan. Niet noemen — en ook niet uitleggen waaróm het er niet staat.  
  → `/home/user/boekbrug/src/components/bank/BankConnectPanel.tsx:243 (`if (!state?.configured) return null`)`
- **[important]** «Als de demo laat zien dat je in het bankscherm op de knop tikt en een .csv kiest: dat lukt niet in beeld.»  
  Het bestandsveld van het bankscherm filtert op .xml,.940,.sta,.mt940,.txt — .csv staat er niet bij en wordt in de bestandskiezer grijs. De CSV moet je op de sleepzone SLEPEN (die heeft een eigen onDrop), of via 'Bon of factuur toevoegen' binnenbrengen, waar .csv wél in de acceptlijst staat. Regieaanwijzing voor de opna  
  → `/home/user/boekbrug/src/app/dashboard/bank/BankClient.tsx:2065 (accept-lijst zonder .csv) vs. :2113-2115 (onDrop op de sleepzone); /home/user/boekbrug/src/compo`

## Sectie 10 · Alle kanalen (herbruikbaar blok) · Landingsstrategie

Verdict: **HERSCHREVEN** · asset: Per bestemming één uitgelogd schermbeeld: /factuur-scannen, /factuur-maken, /btw-aangifte-berekenen, /bankafschrift-naar-excel en /tools zijn allemaal publiek. Geen ingelogde tenan

- **[blocking]** «'BTW post -> BTW calculator'»  
  Er zijn er twee, en ze beantwoorden verschillende vragen. /btw-berekenen rekent een bedrag met en zonder btw. /btw-aangifte-berekenen rekent btw over je omzet minus de voorbelasting en zegt wat je betaalt of terugkrijgt. Een post over de kwartaalaangifte die op de eerste landt, laat de bezoeker met een percentageknop a  
  → `src/lib/tools.ts:51-53 en :59-61`
- **[blocking]** «'invoice post -> gratis invoice creator'»  
  Twee fouten. 'Invoice creator' is Engels op een Nederlands scherm en mag nergens in de copy staan; het product heet 'Factuur maken'. En de bestemming bepaalt de belofte: /factuur-maken maakt een PDF zonder account maar kan niet mailen, dus een post die over versturen gaat mag daar niet landen.  
  → `AGENTS.md (Nederlands op het scherm, geen Engelse producttermen); src/lib/tools.ts:27-29 ('Factuur maken'); src/app/factuur-maken/page.tsx:1-6`
- **[important]** «'bonnetjes post -> gratis AI bon/factuur scan'»  
  De route klopt (/factuur-scannen bestaat en leest ook bonnen), de naam niet. Er is geen 'bon scan'; de pagina en de toolkaart heten allebei 'Factuur scannen met AI'. Een plan dat de bestemming anders noemt dan de bestemming zichzelf noemt, laat de designer een woord in beeld zetten dat de bezoeker na de klik niet terug  
  → `src/lib/tools.ts:35-37; src/app/factuur-scannen/page.tsx:88; bonherkenning: src/app/api/tools/scan-invoice/route.ts:86 en :101`
- **[important]** «De lijst mist de bankpagina»  
  /bankafschrift-naar-excel is de enige publieke pagina die CSV, MT940 en CAMT.053 met naam noemt en draait in de browser van de bezoeker. Het is de hoogste intentie die dit product publiek heeft staan, en er is geen enkele post die erheen wijst.  
  → `src/lib/tools.ts:43-45; pagina bestaat als src/app/bankafschrift-naar-excel/page.tsx`
- **[minor]** «'BoekBrug post -> account'»  
  Klopt — /register bestaat en is de bestemming van elke gratis-account-knop op de site. Enige aanvulling: zet de geruststelling erbij die de site er zelf onder zet, anders leest 'account maken' als een verplichting.  
  → `src/app/page.tsx:146 en :220; src/lib/belofte.ts:73-74`

## DAG 11 · LinkedIn · Tekstpost

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig; dit is een tekstpost. Optioneel één schermafbeelding van de sleepzone op /dashboard/bank waarop de regel 'CAMT.053 (.xml), MT940 (.940 / .sta / .txt) of CSV' lees

- **[blocking]** «'BoekBrug werkt via import: MT940 of CAMT.053 only.'»  
  Te smal en in tegenspraak met het eigen product. CSV wordt geparsed en zowel het bankscherm als de publieke /tools-pagina noemen CSV expliciet. De post zou lezers met een CSV-download wegsturen die BoekBrug wél kan lezen.  
  → `src/lib/bank-csv.ts:1-25; src/lib/bank-csv.test.ts:70-71; src/lib/i18n/messages.ts:3827-3831; src/lib/tools.ts:43-46 ('Zet je bankafschrift (CSV, MT940 of CAMT.`
- **[blocking]** «Het verbod op 'bank koppelen' zonder reden, of met de reden 'die functie bestaat niet'.»  
  De koppeling is gebouwd (Enable Banking / PSD2, zes routes onder /api/bank/enablebanking/*). Hij is niet beschikbaar, en de kaart verbergt zichzelf als de server er niet voor is ingesteld. 'Bestaat niet' zou dus onwaar zijn; beloven mag ook niet. De post beschrijft daarom alleen wat er vandaag in je scherm staat — impo  
  → `src/app/dashboard/bank/BankConnectPanel.tsx:243 `if (!state?.configured) return null`; src/app/dashboard/bank/BankClient.tsx:2070-2076 (panel alleen gerenderd a`
- **[important]** «De impliciete suggestie dat import 'minder' is dan koppelen.»  
  Na binnenkomst is er geen verschil: bestand en koppeling voeden dezelfde pijplijn (importBankStatement -> matching -> auto-confirm). Dat is het sterkste en meest controleerbare punt van de post, en het ontbrak.  
  → `src/app/api/bank/upload/route.ts:2-5 ('Thin shell over importBankStatement — the SINGLE source of truth ... shared with the intake bank path so the two entry po`
- **[important]** «Geen woord over PDF.»  
  Dit is de enige echte beperking en hoort er juist wél in — dan is de rest van de post geloofwaardig. Er is geen PDF-pad in bank-parser.ts; een PDF levert nul transacties op.  
  → `grep op 'pdf' in src/lib/bank-parser.ts: geen treffers; src/lib/bank-ingest.ts:83-110 (buffer wordt als utf8 door parseBankFile gehaald, geen PDF-tak).`

## DAG 11 · Instagram Stories · Quizsticker + antwoordframe (2 frames)

Verdict: **HERSCHREVEN** · asset: Frame 1: alleen typografie op merkvlak, quizsticker met drie opties (B als juiste antwoord instellen). Frame 2: uitsnede van de sleepzone op /dashboard/bank waarop de formatenregel

- **[blocking]** «Antwoordsleutel: 'MT940 of CAMT.053' als het juiste antwoord.»  
  Fout antwoord in een quiz is het duurst denkbare type fout: je leert je publiek actief iets onjuists, en het spreekt het eigen bankscherm én de publieke /tools-pagina tegen. CSV hoort in het goede antwoord.  
  → `src/lib/i18n/messages.ts:3827-3831 bank.formaten; src/lib/bank-csv.ts:1-25; src/lib/bank-csv.test.ts:70; src/lib/tools.ts:43-46.`
- **[important]** «Geen foute-antwoordoptie die de échte beperking afdekt.»  
  De quiz kan in één zet twee dingen rechtzetten: CSV kán wel, PDF kán niet. Door PDF als afleider op te nemen wordt het antwoordframe meteen de nuttigste informatie van de hele Story.  
  → `Geen PDF-pad in src/lib/bank-parser.ts (grep op 'pdf': geen treffers); src/lib/bank-ingest.ts:83-110.`

## Dag 11 · Instagram Stories · Story — Interaction (quiz-sticker) + antwoordframe, 3 frames

Verdict: **HERSCHREVEN** · asset: GEEN demo-tenant nodig. Frame 1 en 2 typografisch met de quiz-sticker; frame 3 en de CTA kunnen met een schermopname van de publieke /bankafschrift-naar-excel, die volledig zonder 

- **[blocking]** «Quiz 'Welke bankformaten leest BoekBrug? A. PDF B. CSV C. MT940/CAMT.053' met antwoord C.»  
  Het antwoord is fout én de vraag is kapot. CSV WORDT gelezen — bank-csv.ts is er precies voor gebouwd en parseBankFile routeert .csv — dus B is net zo goed als C. Met twee juiste opties heeft een quiz geen verdedigbaar antwoord. Iemand die B kiest en 'fout' te zien krijgt, downloadt voortaan de verkeerde export.  
  → `/home/user/boekbrug/src/lib/bank-csv.ts:1-25 (module-kop: een .csv viel eerder door naar parseMT940 en importeerde stil nul transacties — dat gat is gedicht); /`
- **[blocking]** «De optie 'D. JPG' als tweede foute antwoord.»  
  Ook A (PDF) is fout, dus er zijn twee foute en twee goede opties. De vraag moet omgedraaid: vraag naar het ENE formaat dat NIET tot transacties wordt gelezen. Dan is er precies één antwoord en is het bovendien de bruikbare informatie.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:3822-3826 ('Een PDF-afschrift kan niet worden uitgelezen.'); /home/user/boekbrug/src/lib/intake-router.ts:44-70 (ba`

## DAG 12 · Instagram · Carousel, 6 slides

Verdict: **HERSCHREVEN** · asset: Schermopname op een ingelogde tenant (verplicht). Drie shots: (1) Inkomend zonder koppeling — paneel 'Verbind je e-mail' met de twee knoppen Verbind Gmail / Verbind Outlook; (2) In

- **[blocking]** «Slide 5: 'Je controleert de gegevens. Daarna verwerk je de factuur.'»  
  Onwaar als algemene regel, en het verkoopt het product te laag. Een foutloos gelezen factuur wordt zonder tik ingeboekt; de instelling die dat doet staat standaard AAN. Alleen wat de app niet zeker weet, wacht op jou.  
  → `src/app/api/intake/route.ts:1465 (status 'received' zodra autoAdv.advance, anders 'processing'); src/lib/email-integration.ts:2511 (magAutoBoeken per sync); src`
- **[important]** «Slide 3: 'Met BoekBrug kun je Gmail optioneel koppelen'»  
  Outlook is geen bijvangst maar de tweede van exact twee gelijkwaardige knoppen. Alleen Gmail noemen zegt tegen elke ondernemer met een Microsoft-mailbox dat het product niet voor hem is, terwijl de OAuth-route provider-agnostisch is.  
  → `src/app/api/email/connect/route.ts:22-27 accepteert alleen 'gmail' of 'outlook'; src/app/api/email/callback/outlook/route.ts bestaat; het paneel rendert een map`
- **[important]** «Slide 4: 'Inkomende facturen komen klaar te staan in BoekBrug'»  
  Het scherm heet 'Inkomend'. Een zin die naar een scherm wijst, schrijft het zoals de app het schrijft — anders zoekt de lezer naar een woord dat nergens in de navigatie staat.  
  → `src/lib/i18n/messages.ts:72 ('nav.incoming' → nl: 'Inkomend'), :131 ('chrome.inkomend'), :438 ('start.tegel.inkomend')`
- **[minor]** «Slide 2: 'Downloaden. Opslaan. Uploaden. Verwerken.'»  
  'Verwerken/Verwerkt' is in de app een statuswoord op datzelfde scherm. Het hier gebruiken voor het handwerk laat twee betekenissen van één woord op twee slides botsen. 'Overtypen' zegt bovendien scherper wat de pijn is.  
  → `src/lib/i18n/messages.ts:57 ('status.processed' → nl: 'Verwerkt'), :597 ('Alles verwerkt')`
- **[minor]** «Impliciet in slide 4: dat je mailbox wordt ingelezen»  
  De sync begint bij de registratiedatum, niet bij het begin van je mailbox. 'Al je facturen komen binnen' zou een verwachting wekken die het eerste kwartaal niet waarmaakt. Ouder haal je er zelf bij met een knop.  
  → `src/lib/email-integration.ts:2529-2534 (floorMs = profile.created_at tenzij SYNC_START_DATE); knop 'Mis je een factuur? Oudere e-mails opnieuw ophalen…' in src/`

## Dag 12 · Instagram Stories · Story — Product-demo (schermopname), 5 frames

Verdict: **GECORRIGEERD** · asset: VEREIST een ingelogde demo-tenant voor frames 2, 3 en 5 (het Inkomend-scherm met de verbindknop, de binnengekomen facturen en het verwijder-dialoog). Frame 4 vraagt het OAuth-toest

- **[blocking]** «'Gmail incoming' — de story doet alsof BoekBrug alleen Gmail koppelt.»  
  Outlook is een volwaardige tweede optie met een eigen callback-route, en de fair-use-lijst noemt de twee in één adem. Een Outlook-gebruiker die deze story ziet, concludeert dat het product niet voor hem is.  
  → `/home/user/boekbrug/src/app/api/email/callback/outlook/route.ts; /home/user/boekbrug/src/lib/fair-use.ts:125-134 ('Gekoppelde mailboxen (Gmail/Outlook)'); /home`
- **[blocking]** «'Inkomende facturen' als schermnaam.»  
  Het scherm heet 'Inkomend'. 'Inkoopfacturen' is de naam van het onderliggende beheerscherm. 'Inkomende facturen' staat nergens als titel.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:72 ('nav.incoming' = 'Inkomend'); /home/user/boekbrug/src/components/nav/DashboardChrome.tsx:119`
- **[blocking]** «Elke variant van 'we lezen alleen je factuur-bijlagen, nooit je persoonlijke mail'.»  
  De toestemming die je geeft is gmail.readonly respectievelijk Mail.Read: leestoegang tot de hele mailbox. Het filter op factuurkenmerken zit aan ONZE kant, niet in de toestemming. Dat zo zeggen is de enige eerlijke formulering — en het is nog steeds een goede, want de intrekking is één tik.  
  → `/home/user/boekbrug/src/lib/email-integration.ts:593-606 (GMAIL_SCOPES bevat gmail.readonly; OUTLOOK_SCOPES bevat Mail.Read)`
- **[minor]** «Onduidelijk of het echt vanzelf loopt.»  
  Dat mág je hier wél beloven: de sync-cron draait elke twee uur in productie. Dit is de zeldzame plek waar terughoudendheid het product tekortdoet.  
  → `/home/user/boekbrug/vercel.json:3-6 ('/api/cron/email-sync', schedule '0 */2 * * *')`

## DAG 13 · Instagram · Reel (7 beats)

Verdict: **HERSCHREVEN** · asset: Twee bronnen, gemonteerd. (1) Telefoonvideo van een echte kassabon in de hand, jaszak, en het fotomoment. (2) Schermopname op een ingelogde tenant (verplicht): Inkomend → knop Foto

- **[blocking]** «Beat 6: '"Opslaan"'»  
  Er is geen knop Opslaan in dit pad. De knoppen op de bevestigkaart heten 'Bevestig / verifieer' en 'Markeer als betaald'. Een knopnaam verzinnen laat de kijker in de app zoeken naar iets wat er niet staat.  
  → `src/app/dashboard/incoming/IncomingInvoicesClient.tsx:1881 en :1912 renderen t('ink.markeerBetaald') en t('ink.bevestigVerifieer'); src/lib/i18n/messages.ts:103`
- **[blocking]** «Beat 5: '"Controleer"' als vaste stap voor elke bon»  
  Precies bij de kassabon is dit vaak onwaar — en dat is de pointe van de functie. Drukt het papier de betaalregel af, dan boekt de app de bon meteen als betaald, zonder tik. Alleen een bon die zwijgt over de betaalwijze komt in de wachtrij.  
  → `src/lib/receipt-auto-settle.ts:17-33 (twee vragen; alleen een afgedrukte tenderregel opent de poort) en :154-162 (settleNoticeText: 'Deze bon is al afgerekend …`
- **[important]** «Beat 3: 'photo' (knop niet benoemd)»  
  De knop heeft een naam en die hoort in beeld. Op Inkomend is dat 'Foto maken', op Uploaden 'Foto's maken' — twee schermen, twee schrijfwijzen, allebei letterlijk zo.  
  → `src/lib/i18n/messages.ts:8351-8352 ('ink.upload.foto' → 'Foto maken'), gerenderd in src/app/dashboard/incoming/IncomingInvoicesClient.tsx:3526-3537; src/lib/i18`
- **[minor]** «Beat 4: 'AI reads leverancier + bedrag + BTW'»  
  Inhoudelijk waar — dat zijn de velden op de bevestigkaart — maar in Engelse steno. De app zegt het zelf in het Nederlands, en die zin is sterker dan een parafrase.  
  → `src/lib/i18n/messages.ts:1020 ('Controleer de bedragen. AI heeft ze automatisch uitgelezen.'); velden leverancier/factuurnummer/factuurdatum/ex-btw/btw/totaal i`

## DAY 14 · LinkedIn · Tekstpost (geen beeld verplicht)

Verdict: **GECORRIGEERD** · asset: Geen schermafbeelding nodig en dus geen ingelogde tenant. Eventueel één sfeerfoto (bureau, bonnetjes, vrijdagmiddaglicht). Wil je toch een schermafbeelding bij punt 4: de 'Je waarh

- **[blocking]** «Slotlijst: "een factuur opvolgen" als vrijdagmiddagklus.»  
  De ZZP'er volgt geen factuur op — de app doet het. Betalingsherinneringen zijn automatisch en oplopend (hoogst bereikte trap), met een hoofdschakelaar in Instellingen en een pauze per factuur. Er is voor de ondernemer geen verstuurknop: de sectie 'Herinner je klant' op Vandaag is een LIJST, met expliciet geen actie (on  
  → `src/lib/invoice-reminders.ts:1-21 en :84-88; src/app/dashboard/vandaag/VandaagClient.tsx:578-584; src/lib/i18n/messages.ts:1439 ('Stuur automatisch betalingsher`
- **[important]** «Slotlijst: "een betaling matchen".»  
  De zekere gevallen matchen zichzelf: een bankregel waarin het factuurnummer staat (of het IBAN van de leverancier) én die tot op de cent klopt, wordt stil geboekt. 'Matchen' als handmatige klus presenteren is een blanket 'jij controleert alles' — precies wat niet waar is. Wat blijft liggen is de onzekere rest, en dat i  
  → `src/lib/bank-auto-confirm.ts:1-10 (tier 'certain' — booked silently; tier 'amount_only' — booked but flagged 'controleer')`
- **[important]** «Slotlijst: "een kwartaaloverzicht bekijken".»  
  'Kwartaaloverzicht' bestaat als scherm, maar de ondernemer heeft er geen deur naartoe: het staat niet in zijn onderbalk, niet op zijn startscherm en niet in de zijbalk (het is een tegel van de BOEKHOUDER). Hij komt er via de melding na afloop van het kwartaal. Het scherm dat een ZZP'er wél elke week opent voor zijn cij  
  → `src/lib/nav-destinations.ts:109-115 (OWNER-balk: Start/Facturen/Vandaag/Inkomend/Bestanden) en :276-300 (zijbalk zonder /dashboard/quarterly); :118-121 (Kwartaa`
- **[minor]** «Slotlijst: "een bonnetje bewaren".»  
  Klopt, maar verzwijgt de helft. Staat de betaalwijze op de bon gedrukt, dan boekt de app hem meteen als betaald — en noemt daarbij het woord dat op de bon staat, zodat de ondernemer het kan nacontroleren. 'Bewaren' maakt er een archiefhandeling van in plaats van een boeking.  
  → `src/lib/receipt-auto-settle.ts:147-161 (settleNoticeText: 'Deze bon is al afgerekend … Wij hebben hem daarom meteen als betaald geboekt')`

## DAY 15 · Instagram · Carrousel, 6 slides

Verdict: **HERSCHREVEN** · asset: Slide 5: schermafbeelding van /dashboard/waarheid — vereist ingelogde tenant met gevulde cijfers (facturen + bankregels), anders staan de kaarten op € 0,00. NIET /dashboard/resulta

- **[blocking]** «Slide 5: "Bij Financieel overzicht zie je: …"»  
  Er is geen scherm dat 'Financieel overzicht' heet. /dashboard/resultaat is een kale redirect naar /dashboard/waarheid; de naam leeft alleen nog in codecommentaar dat de verwijdering uitlegt. Het scherm dat deze cijfers wél toont heet in de balk 'Waarheid' en op het startscherm 'Je waarheid'.  
  → `src/app/dashboard/resultaat/page.tsx:1-4 en :40-47 (redirect(…'/dashboard/waarheid')); src/app/dashboard/zzp/ZzpDashboard.tsx:381-388; src/lib/i18n/messages.ts:`
- **[blocking]** «Slide 5: "Omzet, Kosten, Resultaat, BTW verschuldigd, Voorbelasting, Saldo"»  
  Vier van de zes zijn boekhoudtermen die het scherm met opzet vermijdt. Alleen 'Omzet' en 'Kosten' staan er echt als label. Het grote getal heet 'Wat je overhoudt' (met 'omzet − kosten · je winst' eronder, niet 'Resultaat'); het BTW-getal heet 'BTW die je moet betalen' of 'BTW die je terugkrijgt', niet 'Saldo'; en de tw  
  → `src/lib/i18n/messages.ts:1457-1461 en :11719-11743; src/app/dashboard/waarheid/WaarheidClient.tsx:556-570 (Wat je overhoudt · Omzet · Kosten) en :585-596, :624-`
- **[important]** «Slide 4: "… je facturen, kosten en bankgegevens bij elkaar"»  
  'Bankgegevens' leest als een bankkoppeling. Die is er niet bruikbaar: het paneel dat een bank zou koppelen verbergt zichzelf volledig zolang de koppeling niet is ingericht, dus geen enkele gebruiker ziet hem. Wat er wél is: je leest je bankafschrift zelf in op het Bank-scherm (MT940/CAMT-bestanden). 'Bankafschrift' is   
  → `src/app/dashboard/bank/BankConnectPanel.tsx:241-243 (if (!state?.configured) return null); src/app/dashboard/bank/BankClient.tsx:2065 (accept=".xml,.940,.sta,.m`
- **[important]** «Slide 6: "En je kunt je kwartaal exporteren voor je boekhouder."»  
  Waar is het, maar het noemt geen enkele knop, dus de lezer weet niet waar hij moet zijn. De echte weg: 'Ben ik klaar?' op het startscherm → de knop 'Download voor de boekhouder'. Daar staat ook wat erin zit: 'Eén ZIP: facturen, bonnen, bankafschrift, dagomzet én je concept BTW-aangifte.' En de slide mag niet de indruk   
  → `src/app/dashboard/zzp/ZzpDashboard.tsx:242-264 (de 'Ben ik klaar?'-hero); src/app/dashboard/klaar/KlaarClient.tsx:325 en :333; src/lib/i18n/messages.ts:9462-946`
- **[important]** «Caption: "CSV of ZIP kwartaalpakket" zonder onderscheid.»  
  De twee zijn niet uitwisselbaar en de app zegt dat zelf: de CSV is 'Alleen de facturen (CSV). Voor de volledige BTW-cijfers incl. pin & contant: gebruik het Kwartaalpakket.' De CSV noemen zonder die beperking laat een winkelier of kapper zijn pin- en contante omzet aan zijn boekhouder onthouden. Daarbij: de CSV-knop st  
  → `src/lib/i18n/messages.ts:9537-9541 ('kw.exportTitel') en :9542 ('kw.csv' = 'CSV'); src/components/quarterly/QuarterlyOverview.tsx:287-310 (beide knoppen in de Z`

## Sectie 15 · Alle kanalen (herbruikbaar blok) · Verbodslijst

Verdict: **HERSCHREVEN** · asset: Geen beeld. Item 14 geldt wel voor alle andere posts: ingelogde schermbeelden komen uit de demo-administratie (scripts/seed-demo-account.sql), niet uit een klantaccount — een video

- **[blocking]** «Het Outlook-item: BoekBrug zou alleen Gmail ondersteunen»  
  Onjuist, en het geeft een echte functie weg. Outlook is volwaardig ondersteund: er is een callback-route naast die van Gmail, de Microsoft-scope staat naast de Google-scope, en het scherm Inkomend rendert exact twee knoppen — 'Verbind Gmail' en 'Verbind Outlook'. Een verbod dat een bestaande functie ontkent, kost klant  
  → `src/app/api/email/callback/outlook/route.ts (naast .../callback/gmail/); src/lib/email-integration.ts:594 (gmail.readonly) en :605 (Mail.Read); src/app/dashboar`
- **[blocking]** «Het bank-item: geen bankkoppeling beloven, want die bestaat niet»  
  De conclusie is goed, de reden niet — en de reden staat in de post zodra iemand hem uitschrijft. De PSD2-koppeling via Enable Banking is gebouwd; het paneel verbergt zichzelf omdat de server geen inloggegevens heeft, niet omdat de functie ontbreekt. 'Het bestaat niet' is dus onwaar en wordt onhoudbaar op de dag dat de   
  → `src/app/dashboard/bank/BankConnectPanel.tsx:241-243 ('A server without Enable Banking credentials has no bank link to offer' / `if (!state?.configured) return n`
- **[blocking]** «De lijst dekt de AI-claims niet»  
  De duurste onwaarheid in het hele plan — 'beschrijf je werk in gewone taal en de AI maakt de factuur' — heeft geen verbodsregel. Zo'n functie bestaat niet: de enige AI-routes zijn de publieke scan, het mailconcept op het boekhoudersscherm en de herimport.  
  → `src/app/api/tools/scan-invoice/route.ts, src/app/api/ai/draft-email, src/app/api/email/reimport; de urenroute /api/werk/factuur bouwt een verzamelfactuur uit af`
- **[blocking]** «De lijst dekt de mailbox-toegang niet»  
  De koppeling vraagt leestoegang tot de hele mailbox, met een filter dat binnen BoekBrug draait. Schrijven dat wij 'alleen factuur-bijlagen lezen, nooit persoonlijke e-mail' is onwaar tegenover de toestemming die de gebruiker zelf aan Google of Microsoft geeft — en dat is precies het soort belofte waar iemand gelijk in   
  → `src/lib/email-integration.ts:594 en :605 (gmail.readonly resp. Mail.Read — volledige leesrechten)`
- **[important]** «De lijst dekt de schermnamen niet»  
  De navigatie heet Start / Facturen / Inkomend / Bestanden / Klanten / Kwartaal, en is rolafhankelijk. 'Inkomende facturen' bestaat niet, 'Financieel overzicht' bestaat niet meer, en er is geen tabblad 'Openstaand'. Een post die een verzonnen schermnaam noemt, laat de nieuwe gebruiker zoeken naar iets dat er niet is.  
  → `src/lib/i18n/messages.ts:75-81 (nav.start t/m nav.quarter); statuslabels :44-58; banktabbladen :4303-4321 ('Te bevestigen', 'Bevestigd', 'Geen factuur', 'Pinont`
- **[important]** «De lijst dekt de e-factuur-deadlines niet»  
  Er circuleert een onjuiste urgentie: e-facturatie zou vanaf 2027 of 2028 verplicht worden. De enige Nederlandse verplichting vandaag is B2G via Peppol; binnenlands B2B is nog geen wetsvoorstel, en de eerste harde EU-datum is 1 juli 2030 voor grensoverschrijdend B2B. Een post die met een verzonnen deadline dreigt, is ee  
  → `src/lib/e-invoice.ts:23-42 (de correctie staat er met de reden erbij: 'A claim does not become verified by being committed')`

## DAY 16 · LinkedIn · Tekstpost (geen beeld verplicht)

Verdict: **GECORRIGEERD** · asset: Geen schermafbeelding nodig. Wil je er één bij: de 'Ben ik klaar?'-hero op het startscherm met de statusregel eronder, of het blok 'Wat moet er nog gebeuren' op /dashboard/klaar. B

- **[blocking]** «Risico in dit soort kwartaalposts: 'je kwartaal is klaar / geregeld / gedaan'.»  
  De app mag dat nergens zeggen en de post dus ook niet. De regel staat expliciet in de code: overal 'staat klaar', nooit 'is gedaan' — omdat een AI-uitkomst volgens de voorwaarden een suggestie is en de controle bij de gebruiker blijft. De melding die de ondernemer na afloop van het kwartaal krijgt heet daarom letterlij  
  → `src/lib/belofte.ts:26-31; src/lib/quarter-close.ts:78-90 (ownerTitle = `${quarterLabel} staat klaar`); src/lib/quarter-close.test.ts:23 en :33; src/lib/i18n/mes`
- **[blocking]** «Risico: de kwartaalafsluiting voorstellen als iets wat de app voor je afrondt.»  
  De app verzamelt, leest, koppelt en zet klaar; indienen bij de Belastingdienst gebeurt nooit door BoekBrug. Dat is geen voorbehoud in de kleine lettertjes maar het verschil tussen een belofte die wordt nagekomen en een belofte waarop je wordt aangesproken. De post moet dat zelf zeggen, niet ontwijken.  
  → `src/lib/belofte.ts:10-31 (geen indiening bij de Belastingdienst, geen PSD2, geen Peppol); src/lib/quarter-close.ts:84-92`
- **[important]** «Het hele frame 'de kwartaalafsluiting als toets over de afgelopen drie maanden' — zonder één echt scherm erin.»  
  Het frame klopt en is precies de zin die de app zelf uitdraagt, maar zonder een naam die de lezer kan terugvinden blijft het een gedachte. De app heeft er twee echte gezichten voor: de 'Ben ik klaar?'-hero op het startscherm, met het antwoord er meteen onder ('Klaar voor je boekhouder' / 'Bijna klaar — nog {count} punt  
  → `src/app/dashboard/zzp/ZzpDashboard.tsx:242-264; src/lib/i18n/messages.ts:479-481, :503, :1632-1633, :1466-1467; src/app/dashboard/waarheid/WaarheidClient.tsx:75`

## Dag 16 · Instagram Stories · Story — Value (screenshot + annotatie), 5 frames

Verdict: **GECORRIGEERD** · asset: VEREIST een ingelogde demo-tenant met een kwartaal aan echte data (verkoop, inkoop, en liefst wat pin/contant, anders is frame 4 een lege bewering). Maak de screenshot op /dashboar

- **[blocking]** «'Financieel overzicht' als schermnaam.»  
  Dat scherm bestaat niet meer. De naam leeft alleen nog in codecommentaar over de verwijdering, en /dashboard/resultaat is een kale redirect. Het scherm heet Kwartaaloverzicht.  
  → `/home/user/boekbrug/src/app/dashboard/quarterly/page.tsx:13-15 (metadata title 'Kwartaaloverzicht — BoekBrug'); /home/user/boekbrug/src/components/nav/Dashboard`
- **[blocking]** «Als de copy zegt 'tik op Kwartaal onderin je balk'.»  
  'Kwartaal' staat in de ONDERBALK VAN DE BOEKHOUDER, niet in die van de ondernemer. De ondernemer heeft Start · Facturen · Vandaag · Inkomend · Bestanden en bereikt het Kwartaaloverzicht via een tegel op zijn startscherm. Een ZZP'er die onderin zoekt, vindt niets.  
  → `/home/user/boekbrug/src/lib/nav-destinations.ts:108-114 (OWNER) tegenover :117-122 (ACCOUNTANT, met nav.quarter)`
- **[blocking]** «Elke suggestie dat BoekBrug de aangifte doet.»  
  De app levert de cijfers en een concept-aangifte; indienen doet de ondernemer zelf, en 'Markeer als ingediend' is een handmatige vinkje op Waarheid.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:9532-9536 ('Concept BTW-aangifte Q{q} {jaar}'), :9618-9622 ('Markeer als ingediend op Waarheid')`
- **[important]** «Kans op 'download je hele BTW in één CSV'.»  
  De CSV op dit scherm bevat alleen de facturen. Pin en contant zitten er niet in; daarvoor is het Kwartaalpakket. Het scherm waarschuwt daar zelf voor, en die waarschuwing hoort in de copy.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:9537-9541 ('kw.exportTitel'), :9613-9617 ('kw.kwartaalpakket')`

## Sectie 16 · Alle kanalen (herbruikbaar blok) · De AI-regel

Verdict: **HERSCHREVEN** · asset: Voor de bankregel is een ingelogd schermbeeld nodig: het tabblad Bevestigd op het Bank-scherm, uit de demo-administratie. De schakelaar 'Duidelijke facturen automatisch inboeken' s

- **[blocking]** «'AI leest de gegevens uit. Jij controleert.'»  
  De tweede zin is onwaar voor precies de gevallen waar het product zijn tijdwinst haalt. De app boekt de zekere gevallen zonder tik: een foutloos gelezen factuur wordt vanzelf geboekt (en nooit op betaald gezet), en een banktransactie waarvan de omschrijving het factuurnummer bevat of het IBAN van de leverancier klopt é  
  → `src/lib/i18n/messages.ts:1443 ('Aan: een foutloos gelezen factuur wordt vanzelf geboekt (nooit betaald), altijd terug te draaien'); src/lib/bank-auto-confirm.ts`
- **[blocking]** «De regel dekt de aansprakelijkheid niet meer af»  
  De oude zin deed dat per ongeluk wel. Nu de app zelf boekt, moet de regel expliciet zeggen wat de voorwaarden zeggen: een AI-uitkomst is een suggestie en geen feit, en de verantwoordelijkheid voor wat er in je administratie staat blijft bij de ondernemer. Dat kan naast automatisch boeken bestaan — juist omdat elke auto  
  → `docs/legal/02_Algemene_Voorwaarden.md §4.3 ('AI-suggesties zijn suggesties, geen feiten' / 'Jij blijft verantwoordelijk voor controle en goedkeuring'); src/lib/`
- **[important]** «De regel verzwijgt de kassabon»  
  Een kassabon waarvan het papier zelf de betaalwijze afdrukt — Kontant, Wisselgeld, Bankpas, PIN, Maestro — wordt zonder tik op betaald gezet. Is het papier stil over de betaalwijze, dan gaat de bon juist wél naar de rij die op jou wacht. Dat onderscheid is het eerlijke verhaal en het is bovendien het betere verhaal: de  
  → `src/lib/receipt-auto-settle.ts:17-34 en :38-41 (een pengeschreven 'betaald' op een factuur telt uitdrukkelijk NIET als bewijs)`
- **[important]** «De regel noemt de knop niet die de eigenaar hierover heeft»  
  Er is één schakelaar in Instellingen die dit bestuurt, met zijn eigen uitleg. Wie de autopilot niet vertrouwt, zet hem uit en alles wacht weer op zijn controle. Een AI-regel die die knop niet noemt, laat de kijker denken dat het hem overkomt.  
  → `src/lib/i18n/messages.ts:1442 ('Duidelijke facturen automatisch inboeken') en :1443; src/app/dashboard/settings/page.tsx:860-869`

## DAY 17 · Instagram · Carousel, 7 slides

Verdict: **HERSCHREVEN** · asset: Drie schermafdrukken, ingelogde tenant nodig. (1) Instellingen, blok 'Boekhouder koppelen' met het e-mailveld en de knop 'Uitnodigen' — voor slide 6. (2) Bestanden met het regelmen

- **[blocking]** «Slide 3: 'Jij doet wat jij makkelijk kunt doen: facturen, bonnetjes, documenten, betalingen controleren'»  
  De zin zet de ondernemer neer als degene die alles nakijkt. De app boekt de zekere gevallen juist zonder tik: een foutloos gelezen inkoopfactuur gaat vanzelf naar Inkoopfacturen, en een bankregel die het factuurnummer noemt en tot op de cent klopt wordt zwijgend gekoppeld. 'Jij controleert alles' is daarmee onwaar én v  
  → `src/lib/auto-advance.ts:1-21 ('a CONFIDENT, clean invoice moves itself … WITHOUT a manual tap'); src/app/api/intake/route.ts:1358 (autoBoekenAllowed → autoAdv);`
- **[blocking]** «Slide 3: 'betalingen controleren' als vaste taak van de ondernemer»  
  Onwaar voor de zekere match en te vaag voor de rest. De zwakkere tier (alleen het bedrag klopt) wordt WEL geboekt maar krijgt 'controleer' mee — dat verschil is het interessante deel en verdient een eigen slide.  
  → `src/lib/bank-auto-confirm.ts:6-9 (tier 'amount_only' → 'booked but flagged "controleer"')`
- **[important]** «Slide 5: 'Je boekhouder krijgt een administratie die beter voorbereid is'»  
  Onderschat het product. Een gekoppelde boekhouder krijgt niet 'iets beter voorbereids' aan het eind van het kwartaal; hij ziet je verstuurde, ontvangen en betaalde facturen meteen, zonder export. Het delen van FACTUREN is niet opt-in per stuk: de zichtbaarheid volgt automatisch uit de status.  
  → `database.sql:346 (invoices.shared GENERATED ALWAYS AS (status IN ('sent','received','paid'))); database.sql:818-823 (policy invoices_accountant_read); src/app/d`
- **[important]** «Slide 6: 'Je kunt je boekhouder uitnodigen en documenten delen'»  
  Klopt, maar noemt de app niet zoals hij geschreven staat, en laat het sterkste feit liggen: een boekhouder die GEEN account wil, kan gewoon meedoen via een downloadlink van 30 dagen. De app schrijft: Instellingen › 'Boekhouder koppelen' → knop 'Uitnodigen'; in Bestanden › 'Delen met boekhouder' (per bestand, en 'Niet m  
  → `src/lib/i18n/messages.ts:1448 ('Boekhouder koppelen'), :8812 ('Uitnodigen'), :4721-4725 ('Delen met boekhouder'), :4901-4905 ('Niet meer delen'), :14707-14708 (`
- **[minor]** «Slide 4: 'BoekBrug houdt het bij elkaar'»  
  Waar, maar leeg — elke administratie-app zegt dit. Op de plek in de carrousel waar het mechanisme uitgelegd moet worden, staat nu een sfeerzin. Vervangen door wat er feitelijk gebeurt.  
  → `src/lib/i18n/messages.ts:1442-1443 ('Duidelijke facturen automatisch inboeken' / 'Aan: een foutloos gelezen factuur wordt vanzelf geboekt (nooit betaald), altij`
- **[minor]** «Impliciete belofte van de hele carrousel: BoekBrug doet het boekhoudwerk, de boekhouder blijft erbij»  
  De post kan dit sterker en waar maken door te noemen wat de app expliciet NIET doet: de aangifte indienen. Dat staat letterlijk op het aangiftescherm en is precies de bewering van slide 1.  
  → `src/lib/i18n/messages.ts:1895-1903 ('Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte.' + 'Je boekhouder controleert en dient i`

## DAY 18 · Instagram · Statische quote-card (1 beeld)

Verdict: **GECORRIGEERD** · asset: Het beeld is een quote-card, puur typografie — geen schermafdruk nodig, dus ook geen ingelogde tenant. Wil je er tóch een echt scherm bij (aanrader voor de tweede regel), dan een u

- **[blocking]** «Risico in de caption: 'stuur je bonnen door naar je Gmail-adres'»  
  BoekBrug is niet Gmail-only. Op Inkomend staan exact twee knoppen: 'Verbind Gmail' en 'Verbind Outlook'. En het is geen doorsturen: de koppeling leest zelf mee, elke twee uur.  
  → `src/app/dashboard/incoming/IncomingInvoicesClient.tsx:1003-1018 (beide providers); src/lib/i18n/messages.ts:6702-6706 ('Verbind {provider}'), :1077 ('Facturen k`
- **[blocking]** «Risico in de caption: 'we lezen alleen je factuur-bijlagen, nooit je persoonlijke e-mail'»  
  Die zin mag niet vallen. De machtiging is leestoegang tot de hele mailbox met een filter aan onze kant; de belofte zou meer beloven dan de techniek waarmaakt.  
  → `Vastgesteld in de eerdere audit (punt 16); de koppeling loopt via /api/email/connect naar de provider-callbacks`
- **[important]** «'Waar is dat bonnetje?' als quote, met een caption die nog geschreven moest worden»  
  De vraag nodigt uit tot de generieke belofte 'BoekBrug bewaart al je bonnetjes' — waar, maar dat doet elke map in je telefoon ook. Het controleerbare, eigen antwoord van dit product is de omgekeerde vraag: de app meldt uit zichzelf wélke bon ontbreekt, op basis van een bankregel waar niets aan hangt. Die zin staat er i  
  → `src/lib/betaling-zonder-stuk.ts:1-25; src/lib/i18n/messages.ts:7683-7697 ('ink.betaaldGeenStuk.een' / '.regel'); src/app/dashboard/incoming/IncomingInvoicesClie`
- **[minor]** «Risico in de caption: 'zoek op het bedrag en je vindt elk bestand terug'»  
  Half waar, dus niet zo schrijven. Een GELEZEN bon is een inkoopfactuurregel en die wordt wél op leveranciersnaam én op bedrag gevonden. Een los bestand in Bestanden wordt alleen op bestandsnaam, soort en notitie gevonden — niet op bedrag.  
  → `src/app/api/search/route.ts:307-312 (invoices: invoice_number, client_name, client_email + amountOrConditions op total_inc_btw) versus :317-324 (documents: file`

## DAY 19 · LinkedIn · Tekstpost

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig; dit werkt als tekstpost. Wil de feed toch een kaart, gebruik dan de quote-card uit het slides-veld — pure typografie, geen schermafdruk, geen ingelogde tenant. Ee

- **[blocking]** «Briefing: 'wat software wel en niet zou moeten automatiseren' — zonder tekst»  
  Het voor de hand liggende sjabloon ('software rekent, de mens controleert alles') is in dit product onwaar: een foutloos gelezen inkoopfactuur boekt zichzelf in, en een bankregel die het factuurnummer noemt en tot op de cent klopt wordt zonder tik gekoppeld. Een post die nederigheid claimt die het product niet heeft, i  
  → `src/lib/auto-advance.ts:1-21; src/lib/bank-auto-confirm.ts:4-9; src/app/api/intake/route.ts:1358`
- **[blocking]** «Valkuil: 'stel zelf je grenzen in — per leverancier, tot een maximumbedrag'»  
  Die knoppen bestaan niet voor een gebruiker. De module die per leverancier en per bedrag beslist is geschreven en getest, maar wordt door geen enkele route of scherm aangeroepen — alleen door de test. De ENIGE schakelaar die een ondernemer echt heeft, is 'Duidelijke facturen automatisch inboeken' in Instellingen. Beloo  
  → `src/lib/autonomy-scope.ts (volledig geïmplementeerd); grep op AutonomyScope/autonomy-scope in src/ levert buiten het bestand zelf alleen src/lib/lifecycle-gates`
- **[important]** «Valkuil: 'BoekBrug zet nooit automatisch iets op betaald'»  
  Zou onwaar zijn. Een kassabon waarvan het papier zelf de betaalwijze afdrukt (Kontant, Wisselgeld, PIN, Maestro) wordt wél automatisch afgeboekt als betaald — juist omdát het geen gok is. Een handgeschreven 'betaald' op een factuur blijft daarentegen een suggestie in de wachtrij. Dat onderscheid IS het onderwerp van de  
  → `src/lib/receipt-auto-settle.ts:1-33 ('refuses unless the PAPER ITSELF names the method'); src/lib/intake-router.ts:183-215 (pen-mark is nooit 'zeker')`
- **[important]** «Valkuil: 'de app stuurt nooit uit zichzelf iets naar jouw klant'»  
  Onwaar. Betalingsherinneringen gaan wél automatisch en oplopend naar je klant, tot en met een ingebrekestelling met incassokosten. Wat de app nooit uit zichzelf doet, is een NIEUWE factuur versturen: een herhaalfactuur staat klaar als concept en het factuurnummer ontstaat pas bij jouw tik.  
  → `src/app/api/cron/reminders/route.ts:1-30; vercel.json (cron /api/cron/reminders, '0 7 * * *'); src/app/api/cron/recurring/route.ts:2-8 ('The app does the typing`

## DAG 20 · Instagram · carrousel, 6 slides

Verdict: **HERSCHREVEN** · asset: Drie schermafdrukken van /factuur-scannen en /tools — allemaal login-vrij, dus GEEN ingelogde tenant nodig: (1) de sleepzone met de regel 'Nog 3 gratis scans vandaag' eronder, (2) 

- **[blocking]** «"Upload je factuur of bon. Laat AI de gegevens uitlezen"»  
  De publieke scanpagina praat uitsluitend over facturen: de kop, de sleepzone en de FAQ noemen het woord bon niet, en bij twijfel zegt het scherm letterlijk "Dit lijkt geen factuur te zijn". De motor erachter leest een bon technisch wel (de systeemprompt accepteert 'invoice, receipt, or quote' en kent document_type 'bon  
  → `src/app/factuur-scannen/FactuurScanner.tsx:195 ('Sleep je factuur hierheen…') en :226 ('Dit lijkt geen factuur te zijn'); src/app/factuur-scannen/page.tsx:34-51`
- **[blocking]** «Caption noemt "bonnetjes scannen" als aparte gratis tool»  
  Die publieke tool bestaat niet. De volledige lijst gratis tools staat in één bestand en er zit geen bonnen-tool bij. Bonnen gaan pas in een account naar binnen, via Uploaden.  
  → `src/lib/tools.ts:15-218 (volledige TOOLS-lijst); src/app/dashboard/bonnetjes/page.tsx (redirect naar Uploaden); src/lib/i18n/messages.ts:1538 ('up.alles': 'Fact`
- **[important]** «"Probeer bijvoorbeeld de gratis AI-factuurscan"»  
  De app kent die naam niet. Op de tools-hub en op de pagina zelf heet het ding "Factuur scannen met AI". Een bezoeker zoekt op /tools naar een kaart die "AI-factuurscan" heet en vindt die nergens.  
  → `src/lib/tools.ts:37 (title: 'Factuur scannen met AI'); src/app/factuur-scannen/page.tsx:88 (h1)`
- **[important]** «Geen enkele slide noemt een grens»  
  De gratis scan is 3 per dag per browser; het scherm zet die teller er zelf bij ("Nog 3 gratis scans vandaag"). Een post die dat weglaat belooft meer dan het scherm geeft, en de bezoeker loopt bij scan 4 tegen een foutmelding aan.  
  → `src/app/factuur-scannen/FactuurScanner.tsx:17 (DAILY_CAP = 3) en :208-210 (teller)`
- **[important]** «Risico: de app zegt zelf 'maak een gratis account voor onbeperkt scannen' — niet overnemen»  
  Die zin staat haaks op het eerlijk gebruik: in een account leest de AI 50 documenten per maand gratis, 500 met Plus. De post mag het woord 'onbeperkt' dus niet lenen van de scanpagina. (Dit is ook een fout in het product zelf: FactuurScanner.tsx:124 en :313 beloven onbeperkt scannen.)  
  → `src/app/factuur-scannen/FactuurScanner.tsx:124 en :313 vs. src/lib/fair-use.ts:95-104 (aiDocuments free: 50, plus: 500)`
- **[minor]** «Caption noemt één "BTW-calculator"»  
  Er zijn er twee, met eigen namen en eigen werk: 'BTW berekenen' (één bedrag) en 'BTW-aangifte berekenen' (omzet min voorbelasting). Eén noemen verbergt precies de tool met de hoogste intentie.  
  → `src/lib/tools.ts:51-57 en :58-65`
- **[minor]** «"andere handige administratie-tools"»  
  Vaag, en het laat juist de tool weg waar dezelfde koopintentie zit als bij de scan: Bankafschrift naar Excel. Die is gratis, zonder account, en draait volledig in de browser.  
  → `src/lib/tools.ts:42-49; src/app/bankafschrift-naar-excel/page.tsx:44-46 (FAQ: 'volledig in je eigen browser')`

## Dag 20 · Instagram Stories · Story — CTA (schermopname publieke tool), 4 frames

Verdict: **GECORRIGEERD** · asset: GEEN demo-tenant nodig. Alles op de publieke pagina /factuur-scannen op te nemen, inclusief de teller 'Nog 3 gratis scans vandaag'. Neem die teller expliciet in beeld in frame 3 — 

- **[blocking]** «'Gratis AI scan' zonder het dagplafond.»  
  Drie per dag per browser. Dat noemen is niet alleen eerlijk, het is een betere CTA: het maakt de scan schaars en concreet in plaats van vaag.  
  → `/home/user/boekbrug/src/app/factuur-scannen/FactuurScanner.tsx:17 (DAILY_CAP = 3), :209-210 ('Nog {remaining} gratis scan(s) vandaag')`
- **[blocking]** «Kans op 'maak een account voor onbeperkt scannen' als vervolgstap.»  
  In een account is het 50 documenten per maand gratis, 500 met Plus. 'Onbeperkt' bestaat nergens.  
  → `/home/user/boekbrug/src/lib/fair-use.ts:96-105`
- **[important]** «Kans op de belofte dat de gescande factuur meteen een complete nieuwe factuur wordt.»  
  De doorgifte naar /factuur-maken bevat bewust de regels, bedragen en datum — NIET de tegenpartij, omdat een gescande factuur er een is die jij ONTVING en zijn leverancier dus niet jouw klant is. Zeg dus 'de regels en bedragen', niet 'alles'.  
  → `/home/user/boekbrug/src/app/factuur-scannen/FactuurScanner.tsx:270-296 (commentaar en de sessionStorage-handoff)`

## DAG 21 · LinkedIn · tekstpost, geen beeld

Verdict: **GECORRIGEERD** · asset: Geen beeld nodig; dit is een tekstpost. Wil je er toch één bij: een schermafdruk van /tools of van het resultaatblok op /factuur-scannen. Beide zijn publiek, dus GEEN ingelogde ten

- **[important]** «"Gewoon: uploaden -> proberen -> resultaat zien"»  
  Uploaden past bij twee van de vier tools. Bij 'Gratis factuur maken' upload je niets — je vult in en downloadt een PDF; bij de twee BTW-tools typ je bedragen. Wie op 'uploaden' binnenkomt en een leeg formulier ziet, denkt dat hij op de verkeerde pagina staat.  
  → `src/app/factuur-maken/GratisFactuur.tsx:638 (h1 'Gratis factuur maken'), :987 (knop '↓ Download PDF'), :656-657 ('Geen account nodig… je gegevens blijven in je `
- **[important]** «De post noemt geen enkele grens»  
  Op LinkedIn leest 'gewoon uitproberen' zonder getal als onbeperkt. De publieke scan is 3 per dag per browser; in een account leest de AI 50 documenten per maand gratis, 500 met Plus. Zonder die twee getallen belooft de post iets wat de app afkapt.  
  → `src/app/factuur-scannen/FactuurScanner.tsx:17 en :208-210; src/lib/fair-use.ts:95-104`
- **[minor]** «"Geen demo aanvragen. Geen salesgesprek. Geen creditcard." — blijft staan, met één nuance»  
  Dit klopt: op de publieke site staat geen demo-aanvraag of salesformulier, registreren gaat zelf met naam, bedrijf, kvk, btw, e-mail en wachtwoord, en /prijzen zegt letterlijk 'geen creditcard vooraf'. Er bestaat wél een vast demo-account voor de Play Store-review, maar dat is geen aanvraagflow en hoort niet in de post  
  → `src/app/prijzen/page.tsx:96 ('geen creditcard vooraf'); src/app/register/page.tsx:613-661 (alleen deze velden); src/lib/demo-tenant.ts:1-60 (review-account, gee`
- **[minor]** «De hoge-intentie tool ontbreekt»  
  'Bankafschrift naar Excel' is precies de zoekvraag van iemand die op maandagavond met zijn boekhouding zit, en hij is gratis, zonder account en volledig in de browser. Die hoort in een post over 'zelf proberen'.  
  → `src/lib/tools.ts:42-49; src/app/bankafschrift-naar-excel/page.tsx:44-46; src/app/bankafschrift-naar-excel/BankConverter.tsx:241 (knop '⬇︎ Download als Excel (.x`

## DAG 22 · Instagram · carrousel, 5 slides

Verdict: **HERSCHREVEN** · asset: Vijf ingelogde schermen: Start, Nieuwe factuur (met de kaart Datums en de knop Opslaan en versturen), Uploaden (de sleepzone 'Facturen, bonnen én bankafschriften'), Bank (met de re

- **[blocking]** «"BTW & resultaat bekijken"»  
  Er is geen scherm dat 'resultaat' of 'Financieel overzicht' heet. Die route is een kale redirect naar Waarheid, en in de navigatie heet het kwartaalscherm 'Kwartaal'. Een kijker die 'resultaat' zoekt, zoekt naar een woord dat nergens in de app staat.  
  → `src/app/dashboard/resultaat/page.tsx (redirect naar /dashboard/waarheid); src/lib/i18n/messages.ts:75 ('nav.quarter': 'Kwartaal'); messages.ts:9532 ('kw.concept`
- **[important]** «"bonnetjes scannen met AI" als eigen stap/scherm»  
  Er is geen scherm Bonnetjes: die route stuurt door naar Uploaden, en dat is de ene deur voor facturen, bonnen én bankafschriften. De stap heet dus Uploaden, niet 'bonnetjes scannen'.  
  → `src/app/dashboard/bonnetjes/page.tsx (redirect via vakwoordNaar); src/lib/i18n/messages.ts:1538 ('up.alles'); src/app/dashboard/upload/page.tsx:1-5 (alles naar `
- **[important]** «"bankafschrift importeren + transacties matchen"»  
  Twee dingen. 'Matchen' is niet het woord van de app — die zegt koppelen ('Koppelen', 'Automatisch gekoppeld op'). En het bankscherm neemt via de bestandskiezer .xml, .940, .sta, .mt940 en .txt aan, géén .csv; wie met een CSV komt omdat de post dat suggereerde, kan zijn bestand niet eens selecteren. (CSV kan wél op de g  
  → `src/app/dashboard/bank/BankClient.tsx:2065 (accept=".xml,.940,.sta,.mt940,.txt"); src/lib/i18n/messages.ts:1185 ('bank.koppelen': 'Koppelen') en :1256 ('Automat`
- **[important]** «Ontbreekt: dat de app de zekere gevallen zelf boekt»  
  Zonder die zin leest de carrousel als handwerk in vier stappen, terwijl de app precies het omgekeerde belooft op het bankscherm: staan nummer én bedrag exact in het afschrift, dan koppelt hij zelf en zet de factuur op betaald. Dat is het verschil waar iemand voor blijft.  
  → `src/lib/i18n/messages.ts:3638 ('bank.auto.uitleg': 'Nummer én bedrag exact in je bankafschrift? Dan koppel ik zelf en zet ik op betaald. De rest is aan jou. Ong`
- **[important]** «"facturen maken" zonder de knoppen die er staan»  
  De stap is herkenbaar te maken met de woorden die op het scherm staan: Nieuwe factuur → Opslaan en versturen → de bevestiging 'Factuur versturen?' → 'Ja, verstuur'. En wat er dan echt gebeurt: de klant krijgt de PDF én de e-factuur.  
  → `src/lib/i18n/messages.ts:132 ('chrome.nieuweFactuur'), :243 ('nieuw.actie.versturen': 'Opslaan en versturen'), :281 ('nieuw.bevestig.titel': 'Factuur versturen?`
- **[minor]** «De carrousel suggereert één vaste navigatie voor iedereen»  
  De balk hangt af van het werk van de eigenaar: een winkel ziet Kassa, een dienstverlener ziet Werk. Een kijker die in het beeld een tegel zoekt die bij hem niet bestaat, denkt dat hij iets mist. Hoort in de caption, niet op een slide.  
  → `src/lib/i18n/messages.ts:68-75 (nav.start/invoices/incoming/files/clients/quarter); messages.ts:449 ('start.tegel.uren'), :437 ('start.tegel.kas')`

## DAY 23 · Instagram · Reel (verticale video, ~20 sec, 9 tekstshots)

Verdict: **HERSCHREVEN** · asset: Schermopname in een ingelogde tenant, en die is hier verplicht: alle drie de shots zitten achter de login. Nodig: (1) een account met minstens één afgesloten kwartaal aan echte dat

- **[blocking]** «De tweede helft stuurt de kijker naar 'kwartaaloverzicht' als de plek waar de ZZP'er zijn kwartaal afsluit.»  
  Kwartaaloverzicht bestaat (/dashboard/quarterly, schermnaam 'Kwartaaloverzicht'), maar de ondernemer heeft er geen deur naartoe. Zijn balk is Start / Facturen / Vandaag / Inkomend / Bestanden; 'Kwartaal' staat uitsluitend in de balk van de BOEKHOUDER. Geen enkel scherm van de ondernemer linkt ernaartoe — de enige link   
  → `src/lib/nav-destinations.ts:109-115 (OWNER) vs :117-121 (ACCOUNTANT); src/app/api/cron/quarter-close/route.ts:142 (enige link); src/app/dashboard/zzp/ZzpDashboa`
- **[important]** «'exporteren -> boekhouder'»  
  Het woord 'exporteren' staat nergens op dat scherm. De knop heet 'Download voor de boekhouder' en er staat één zin onder die precies zegt wat eruit komt.  
  → `src/lib/i18n/messages.ts:9462-9466 ('klr.download' = 'Download voor de boekhouder'); :9522 ('klr.zipUitleg'); src/app/dashboard/klaar/KlaarClient.tsx:325 en :33`
- **[important]** «'BoekBrug met Facturen/Bonnetjes/Bank aangevinkt'»  
  Er zijn geen vinkjes. 'Ben ik klaar?' toont vier rubrieken met elk een percentage en een gewicht: Facturen & bonnen (30%), Bank verwerkt (30%), Kassa & kas sluit aan (20%), BTW compleet (20%) — en een rubriek die niet van toepassing is, telt niet mee. Daarnaast is 'Bonnetjes' geen schermnaam: /dashboard/bonnetjes is ee  
  → `src/lib/readiness.ts:257-263 (DIM_LABEL + DIM_WEIGHT); src/app/dashboard/bonnetjes/page.tsx (redirect) via src/lib/vakwoorden.ts:57`
- **[important]** «Ontbrak: waar het ZIP-pakket uit bestaat en dat de aangifte erin een CONCEPT is.»  
  Zonder die zin leest de reel als 'en dan is je aangifte geregeld'. De app bouwt concept-btw-aangifte.csv nadrukkelijk als concept en dient nooit in.  
  → `src/lib/i18n/messages.ts:9522 ('Eén ZIP: facturen, bonnen, bankafschrift, dagomzet én je concept BTW-aangifte.'); src/lib/closing-package.ts:1132-1137 en :840 (`
- **[minor]** «Gemist: de tweede, sterkere uitgang — de deel-link naar een boekhouder zonder account.»  
  Onder de downloadknop staat 'Of stuur het naar je boekhouder': BoekBrug mailt hem een downloadlink, hij heeft géén account nodig, de link werkt 30 dagen en is intrekbaar. Dat is exact de POV van de reel en het stond er niet in.  
  → `src/lib/i18n/messages.ts:14707-14708; src/lib/package-share.ts:14 (SHARE_VALIDITY_DAYS = 30); src/app/api/closing-package/share/route.ts:1-15 en :35-60 (intrekk`

## DAY 24 · LinkedIn · Tekstpost (geen beeld verplicht)

Verdict: **GECORRIGEERD** · asset: Geen beeld nodig — dit werkt als kale tekstpost en LinkedIn straft een link-preview af. Wil je er tóch één screenshot bij, dan is de enige die de post waarmaakt /dashboard/accounta

- **[important]** «Risico in de tweede helft: dat de post leest als 'BoekBrug weet welke bon ontbreekt'.»  
  De route weigert die claim expliciet. Het bericht is van de BOEKHOUDER, niet van BoekBrug — de tekst zegt 'dit is wat ik in BoekBrug zie ontbreken' en nergens 'BoekBrug heeft vastgesteld dat'. En een bon die nooit is geüpload is voor de app onzichtbaar. Die twee zinnen moeten in de post staan, anders belooft hij iets d  
  → `src/app/api/accountant/vraag-stukken/route.ts:16-23`
- **[important]** «Risico: 'één knop en de klant krijgt de hele lijst'.»  
  Die knop bestaat met opzet niet. De boekhouder vinkt zelf aan; alleen de punten uit `missing` (wat de klant kan dichten) komen in aanmerking, `risks` (aansluitverschillen voor de boekhouder) nadrukkelijk niet. Boven MAX_ITEMS weigert de bouwer met 'meer dan zoveel punten leest niemand'.  
  → `src/modules/accountant/pages/AccountantOpvragen.tsx:12-21; src/lib/document-request.ts:93-101`
- **[important]** «Schermnamen ontbraken.»  
  Een post die naar schermen wijst, moet ze noemen zoals de app ze schrijft: bij de boekhouder 'Stukken opvragen', bij de ondernemer 'Vragen van je boekhouder' en 'Uploaden'.  
  → `src/lib/i18n/messages.ts:118 ('chrome.opvragen'), :103 ('chrome.vragen'), :91 ('chrome.uploaden'); src/app/dashboard/vragen/VragenClient.tsx:133-143 (de kaart '`
- **[minor]** «De premisse zelf — een ontbrekende bon kost een bericht, een wachttijd, een herinnering, nog een wachttijd.»  
  Die is waar en wordt bevestigd door de code zelf: het opvraagscherm is gebouwd op precies deze diagnose, in die woorden. Blijft staan.  
  → `src/modules/accountant/pages/AccountantOpvragen.tsx:6-10 ('Het najagen van papier is wat een boekhoudersmaand leegzuigt … een appje met "kun je de rest nog stur`
- **[minor]** «Risico: het verzoek beschrijven als 'een aparte mail' of 'een eigen verzoekenlijst'.»  
  Het landt in dezelfde messages-tabel, met dezelfde melding en dezelfde e-mail als een handmatig bericht. Eén inbox, met opzet: 'een verzoek dat ergens anders terechtkomt is een verzoek dat hij mist'.  
  → `src/app/api/accountant/vraag-stukken/route.ts:11-15 en :28-31 (createNotification + sendMessageNotification)`

## Dag 24 · Instagram Stories · Story — Product-demo, 6 frames

Verdict: **GECORRIGEERD** · asset: ZWAARSTE ASSET VAN DE SET — vereist TWEE ingelogde tenants: een ondernemersaccount (frames 2, 3, 4, 5) en een gekoppeld boekhoudersaccount om de Brug-kant te tonen in frame 1. Fram

- **[blocking]** «Kans op 'hij ziet je hele administratie' of juist 'hij krijgt alleen een export'.»  
  Allebei fout. Hij kijkt live mee via de Brug, maar het delen van BESTANDEN is per bestand en jij zet het aan — met een tik zet je het ook weer uit.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:3282 ('Gedeeld met boekhouder — tik om te stoppen'), :4812 ('Gedeeld met je boekhouder')`
- **[blocking]** «'Voor je boekhouder is BoekBrug altijd gratis.'»  
  Het portaal is gratis tot en met 10 gekoppelde klanten; daarboven geldt een staffel. (De app zegt zelf ergens 'altijd gratis' — dat is een fout in de app, niet een feit om uit te dragen.)  
  → `/home/user/boekbrug/src/lib/fair-use.ts:54 (ACCOUNTANT_FREE_CLIENTS = 10); /home/user/boekbrug/src/app/prijzen/page.tsx:371 en :189-192; de te-mijden zin staat `
- **[important]** «'Samenwerken met je boekhouder' zonder te zeggen hoe hij binnenkomt.»  
  Het is zelfbediening in beide richtingen en het begint op één plek: Instellingen → Boekhouder koppelen, waarna hij een uitnodiging per mail krijgt. Die knopnaam moet erin, anders zoekt de kijker.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:1448 ('inst.boekhouderKoppelen' = 'Boekhouder koppelen'), :8587 ('Vul het e-mailadres van je boekhouder in. Hij ont`

## DAY 25 · Instagram · Carrousel, 7 slides

Verdict: **GECORRIGEERD** · asset: Zes screenshots uit een ingelogde tenant met echte data (slide 1 en 7 zijn typografie, geen screenshot). Slide 2: /dashboard/upload met de knop “Foto’s maken” zichtbaar. Slide 3: /

- **[blocking]** «'einde kwartaal -> overzicht controleren'»  
  Hetzelfde probleem als DAG 23: het kwartaalscherm waar de ondernemer wél bij kan is 'Ben ik klaar?', één tik vanaf zijn startscherm. Kwartaaloverzicht is de deur van de boekhouder. 'Overzicht' zonder schermnaam stuurt hem bovendien nergens heen.  
  → `src/lib/nav-destinations.ts:109-115 vs :117-121; src/app/dashboard/zzp/ZzpDashboard.tsx:243; src/lib/i18n/messages.ts:104 ('chrome.klaar' = 'Ben ik klaar?')`
- **[blocking]** «'inkoopfactuur -> uploaden of via de mailbox' zonder schermnamen, en met het risico op 'Inkomende facturen'.»  
  Het scherm heet 'Inkomend', nooit 'Inkomende facturen'. Daar staan exact twee koppelknoppen: 'Verbind Gmail' en 'Verbind Outlook' — BoekBrug is dus niet Gmail-only. De belofte eronder is letterlijk 'Facturen komen automatisch binnen — je hoeft niets meer door te sturen.' Ophalen gebeurt elke twee uur.  
  → `src/lib/i18n/messages.ts:72 ('nav.incoming' = 'Inkomend'), :1076-1077, :6702-6706; src/app/dashboard/incoming/IncomingInvoicesClient.tsx:993 en :1004-1019 (de t`
- **[important]** «'werk gedaan -> factuur maken' — leest als 'en dan staat je factuur bij de klant'.»  
  De knop heet 'Maak factuur' en wat je krijgt is een CONCEPT, geen verstuurde factuur. Op Uren land je in de factuur om hem af te maken; op Werk krijg je de melding 'De factuur staat klaar als concept.' Het tarief van die klant staat al ingevuld. Let op de rolafhankelijkheid: 'Werk' bestaat alleen voor een profiel met e  
  → `src/lib/i18n/messages.ts:14520 ('uren.maakFactuur' = 'Maak factuur'), :14043 en :14045, :1577 ('uren.tariefVanKlant'); src/app/dashboard/uren/UrenClient.tsx:225`
- **[important]** «'betalingen -> bankafschrift importeren' zonder formaten.»  
  Het scherm heet 'Bank', de knop 'Kies bankafschrift', en eronder staat precies welke bestanden het leest: CAMT.053 (.xml), MT940 (.940 / .sta / .txt) of CSV. Een PDF-afschrift kan niet worden uitgelezen, en dat is de allervaakste vergissing — die zin hoort er dus in. Beloof hier géén bankkoppeling.  
  → `src/lib/i18n/messages.ts:107 ('chrome.bank'), :3982-3986 ('bank.kiesAfschrift'), :3827-3831 ('bank.formaten'), :3822-3826 ('Een PDF-afschrift kan niet worden ui`
- **[important]** «Ontbrak: dat de app een deel zelf boekt.»  
  'Jij controleert alles' zou onwaar zijn. Een bankregel waarop het factuurnummer staat en waarvan het bedrag tot op de cent klopt, wordt bij de import zelf gekoppeld; een kassabon met de betaalregel erop gedrukt gaat vanzelf op betaald. Wat niet zeker is, komt in 'Te verifiëren'.  
  → `src/lib/bank-ingest.ts:52-54 en :350-354 (autoBooked); src/lib/i18n/messages.ts:57 ('status.processing' = 'Te verifiëren')`
- **[important]** «'bonnetje -> foto' zonder waar.»  
  Het scherm heet 'Uploaden' (home-tegel: 'Alles uploaden'), en de knop is 'Foto’s maken'. 'Bonnetjes' is geen scherm — die URL is een doorverwijzing.  
  → `src/lib/i18n/messages.ts:91, :470 ('start.allesUploaden'), :10862-10866 ('up.fotosMaken'); src/app/dashboard/upload/UploadClient.tsx:589; src/lib/vakwoorden.ts:`
- **[minor]** «Nergens een grens genoemd.»  
  Het lezen van documenten is niet onbeperkt: gratis 50 per maand, met Plus 500. Een routinepost die dat weglaat, belooft impliciet 'onbeperkt'.  
  → `src/lib/fair-use.ts:95-105 (aiDocuments: free 50, plus 500, per maand)`

## DAY 26 · Instagram · Carrousel, 6 slides

Verdict: **HERSCHREVEN** · asset: Vier screenshots uit een ingelogde tenant plus twee typografische slides (1 en 6). Slide 2: /dashboard/invoice/new met de segmented button Factuur · Offerte · Losse creditnota, met

- **[blocking]** «Slide 3: “Klant akkoord? Eén klik”»  
  Onwaar, en niet per ongeluk: die knop is er met opzet uitgehaald en de weg terug is dichtgezet. /api/invoice/send weigert een offerte hard (409) en weigert de oude conversie-parameter met 410; de foutmelding stuurt je zelf naar “Maak factuur aan”. Wat je krijgt is een VOORINGEVULD FORMULIER, geen klik. De reden staat e  
  → `src/app/api/invoice/send/route.ts:168-179 (convertOnly → 410) en :237-244 (offerte → 409); src/app/dashboard/facturen/FacturenClient.tsx:1794-1830 (de enige weg`
- **[blocking]** «Slide 5: “Factuur fout? Maak een creditnota”»  
  Dat is niet het eerste antwoord van de app, en voor de meeste gevallen het verkeerde. Een verstuurde factuur mag volledig worden bewerkt zolang er niets aan vastzit: het nummer blijft, en bij opslaan krijgt de klant automatisch de gecorrigeerde factuur met de melding dat de eerdere versie vervalt. Bewerken gaat pas dic  
  → `src/lib/invoice-editable.ts:75-96 (de vier sloten) en :148-165; src/lib/i18n/messages.ts:551-555 ('bewerk.herstel.uitleg'), :543-544 ('detail.foutIn' + 'detail.`
- **[important]** «Slide 2: “Maak in BoekBrug een offerte” — klopt, maar noemt de weg niet.»  
  Een zin die naar een scherm wijst, noemt het zoals de app het schrijft. Je gaat naar Nieuwe factuur en zet “Type document” op Offerte; de derde optie heet “Losse creditnota”. De banner die dan verschijnt zegt letterlijk: “geen factuurnummer. Gebruik ‘Maak factuur aan’ als de klant akkoord gaat.” Dat is de beste slide-t  
  → `src/lib/i18n/messages.ts:161-164, :10431-10435, :469 ('start.nieuweFactuur'); src/app/dashboard/invoice/new/page.tsx:1514 en :233-243`
- **[important]** «Ontbrak: wat de klant zelf doet.»  
  De offerte gaat als offerte de deur uit (“Offerte versturen”), krijgt geen nummer en blijft daardoor bewerkbaar — onderhandelen is de normale volgende stap. De klant opent een eigen link en antwoordt daar zelf: “Akkoord” of “Niet akkoord”. Dat antwoord komt met naam en datum terug bij de offerte. Dat is de mooiste helf  
  → `src/app/api/invoice/[id]/send-offerte/route.ts:1-25; src/app/offerte/[token]/OfferteClient.tsx:180 en :187 (de twee knoppen); src/lib/i18n/messages.ts:10149-101`
- **[minor]** «Slide 4: “De gegevens blijven staan” — waar, maar te vaag om te controleren.»  
  Wat er meereist is specifiek: de regels mét eenheid en btw-behandeling, de korting en een eventuele aanbetaling. De offerte wordt daarna gearchiveerd (behalve bij een aanbetaling — dan blijft hij open voor de eindfactuur). Dat mag je concreet zeggen.  
  → `src/app/dashboard/invoice/new/page.tsx:723-740 (unit + vat_treatment) en :1318-1328 (archiveren, niet bij aanbetaling); src/lib/aanbetaling.test.ts:74-93 (aanbe`
- **[minor]** «Kandidaat om te schrappen was er niet — de post kan intact blijven op 6 slides.»  
  Alleen slide 3 en 5 worden vervangen; de vorm, de volgorde en het aantal blijven.  
  → `n.v.t. — redactionele vaststelling`

## Dag 26 · Instagram Stories · Story — Product-demo (schermopname), 5 frames

Verdict: **GECORRIGEERD** · asset: VEREIST een ingelogde demo-tenant met een verstuurde offerte (frames 2, 4, 5). Frame 3 speelt zich af op de publieke pagina /offerte/[token] — die opent zonder login, maar de token

- **[blocking]** «'Van offerte naar factuur in één klik.'»  
  Die knop is er geweest en is er bewust uitgehaald, met de reden erbij in de code: hij zette een concept-offerte ter plekke om in een genummerde en gemailde factuur, zonder aanbetalingsverrekening, zonder korting als regels en zonder gearchiveerde offerte. Wat je nu krijgt is een VOORINGEVULD factuurformulier.  
  → `/home/user/boekbrug/src/app/dashboard/facturen/FacturenClient.tsx:1711-1716 (blok [OFFERTE-GEEN-OMZETTING]) en :1816-1829 (push naar /dashboard/invoice/new?from`
- **[important]** «Kans op de suggestie dat de offerte al een factuurnummer heeft.»  
  De offerte gaat als offerte de deur uit, zonder factuurnummer. Het nummer wordt pas uitgegeven bij het versturen van de factuur.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:573-577 ('Deze offerte gaat als offerte naar je klant, zonder factuurnummer. Een factuur maak je later via "Maak fa`
- **[minor]** «De klantkant ontbreekt.»  
  De klant krijgt een eigen pagina met twee knoppen en antwoordt daar zelf. Dat is de mooiste beat van deze story en hij stond er niet in.  
  → `/home/user/boekbrug/src/app/offerte/[token]/OfferteClient.tsx:180 ('Akkoord') en :187 ('Niet akkoord')`

## DAY 27 · LinkedIn · Tekstpost (geen beeld)

Verdict: **GECORRIGEERD** · asset: Geen beeld nodig; dit is een tekstpost. Wil de designer er tóch één visual bij, dan één schermafdruk van de tabbalk op Facturen met alle zeven tabbladen zichtbaar (Alles · Verzonde

- **[blocking]** «'Eén klik. Offerte → Factuur.'»  
  De omzetting-in-één-tik is er bewust uitgehaald en een test bewaakt dat hij wegblijft: hij sloeg de aanbetaling, de korting-als-regels en het bewaren van de offerte over. Je krijgt een vooringevuld factuurformulier.  
  → `src/lib/lifecycle-gates.test.ts:4524-4545 ([OFFERTE-GEEN-OMZETTING], eist dat 'lijst.omzetten' weg is en dat de lijst naar /dashboard/invoice/new?from_offerte=…`
- **[important]** «'een betaalde factuur markeren' — zonder de knopnaam, en met de suggestie dat je alles zelf afvinkt.»  
  De knop heet 'Betaald?' en staat alleen op een verzonden of verlopen factuur. Bovendien boekt de app de zekere gevallen zelf: een bankregel met het factuurnummer erop en een bedrag dat tot op de cent klopt, gaat vanzelf op betaald. 'Jij markeert alles' is dus onwaar.  
  → `messages.ts:9761 'lijst.betaaldVraag' = 'Betaald?'; src/app/dashboard/facturen/FacturenClient.tsx:1733-1751 (alleen bij status 'sent' of 'overdue', opent bedrag`
- **[important]** «'een verlopen factuur opvolgen' als iets wat jij handmatig doet.»  
  De ZZP'er heeft geen knop 'herinnering sturen'. Het opvolgen is automatisch en getrapt en eindigt in de wettelijke aanmaning met incassokosten; wat de eigenaar wél zelf doet is pauzeren of een 'Betaalverzoek' sturen. (De enige handmatige herinnerknop, 'Herinnering sturen', zit op het medewerkersbord, niet bij de eigena  
  → `src/app/api/cron/reminders/route.ts:376-378 (standaardschema [14,30]), :625 en :644-665 (laatste trap = WIK-aanmaning); src/lib/incasso.ts:200-236 (uiterste dat`
- **[important]** «'een creditnota maken' als een correctie binnen de app.»  
  Het is een nieuw, wettelijk document: eigen nummer in de CR-reeks, per e-mail naar de klant met pdf én e-factuur, en de originele factuur blijft ongewijzigd staan. Crediteren kan bovendien per regel, dus voor een deel.  
  → `src/app/api/invoice/creditnota/route.ts:8-22 (CR-nummering, aflevering als echte factuur) en :669-693 (mail met pdf + ublAttachmentForInvoice); src/lib/invoice-`
- **[important]** «'een kwartaalpakket exporteren'.»  
  Er is geen knop 'Exporteren' voor het pakket. Op 'Ben ik klaar?' heet hij 'Download voor de boekhouder' (met ernaast 'Of stuur het naar je boekhouder'), op Kwartaaloverzicht heet dezelfde knop 'Kwartaalpakket'. De CSV daar is iets anders: alleen de facturen.  
  → `src/app/dashboard/klaar/KlaarClient.tsx:325 (t('klr.download'), messages.ts:9462 = 'Download voor de boekhouder'); messages.ts:14707 'Of stuur het naar je boekh`
- **[minor]** «'een factuur als concept bewaren' — zonder knopnaam en zonder het nummervoorbehoud.»  
  De knop heet 'Opslaan als concept', 'Concept' is een echt tabblad op Facturen, en een concept heeft nog géén factuurnummer — de app toont 'Volgend factuurnummer' met 'Verwacht'. Dat weglaten wekt de indruk dat een concept al een genummerde factuur is.  
  → `messages.ts:250 'nieuw.actie.concept' = 'Opslaan als concept'; src/app/dashboard/invoice/new/page.tsx:2241; messages.ts:262-267 ('Volgend factuurnummer' / 'Verw`

## Dag 27 · Instagram Stories · Story — Product-demo (schermopname), 5 frames

Verdict: **GECORRIGEERD** · asset: VEREIST een ingelogde demo-tenant met minstens één VERSTUURDE factuur (het foutscherm uit frame 2 verschijnt alleen op een verstuurde factuur) en een tweede om deels te crediteren 

- **[blocking]** «Kans op 'pas je factuur aan' of 'maak hem ongedaan'.»  
  Een verstuurde factuur is wettelijk vastgelegd en verandert niet meer. De creditnota is de correctie, en de originele factuur blijft gewoon staan. Dat is precies de reden dat deze story bestaat — die reden moet er dus in.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:5056 ('Deze factuur is verstuurd en wettelijk vastgelegd — wijzigen kan niet meer. Maak een creditnota aan om te co`
- **[blocking]** «De knopnaam moet zijn zoals de app hem schrijft.»  
  'Creditnota maken', en de bevestiging 'Creditnota maken voor {number}?'. Niet 'credit factuur', niet 'terugboeken'. En 'creditnota' blijft creditnota — geen vertaling verzinnen.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:5551-5555, :5561-5565; /home/user/boekbrug/AGENTS.md (btw, kvk, iban, aangifte, creditnota, zzp blijven staan)`
- **[important]** «Als de copy doet alsof crediteren alles-of-niets is.»  
  Een deelcreditering kan, met een harde bovengrens op wat er nog te crediteren valt.  
  → `/home/user/boekbrug/src/lib/i18n/messages.ts:5530-5534 ('Deels gecrediteerd: {credited} terug, {open} staat nog open.'), :5546-5550 ('Dat is meer dan er nog van`

## 28 · Instagram · Carrousel, 7 slides

Verdict: **GECORRIGEERD** · asset: Geen screenshot nodig: typografische carrousel op merkkleur, één letter per slide. Wil je er tóch één beeld bij, dan de tegel 'Ben ik klaar?' op het startscherm — dat vereist een i

- **[important]** «Slide 7: 'Als je D bent: BoekBrug is waarschijnlijk iets voor jou.'»  
  Het is geen belofte maar een vage pasvorm-claim: er staat niets in dat iemand kan narekenen, en het schrijft C ('mijn boekhouder heeft alles') af terwijl de boekhouderskant een echt, gratis en zelfbedienbaar deel van het product is. Vervangen door het mechanisme dat voor D wél waar is: de mailbox-koppeling die elke twe  
  → `src/app/prijzen/page.tsx:169-195 (Boekhouder € 0, 'Portaal openen'); src/lib/i18n/messages.ts:8793 ('Je boekhouder kan je administratie wel inzien…'); vercel.js`
- **[important]** «Slide 7 impliceerde dat de stapel vanzelf verdwijnt, zonder te zeggen dat je daarvoor eerst je mailbox koppelt.»  
  Het automatisch ophalen begint pas na 'Verbind Gmail' of 'Verbind Outlook' op Inkomend. Zonder die voorwaarde is het een belofte die bij een nieuw account niet uitkomt. De koppeling staat nu in de slide zelf.  
  → `src/app/dashboard/incoming/IncomingInvoicesClient.tsx:1004-1017 (twee knoppen, ink.email.verbindProvider 'Verbind {provider}'); src/lib/i18n/messages.ts:6702-67`
- **[minor]** «Caption bevatte alleen de vraag om een reactie, zonder één gecontroleerde productzin.»  
  Een quizpost zonder product is een gemiste slot; maar alles wat je toevoegt moet de knop heten zoals de app hem schrijft. De caption noemt nu 'Bon of factuur toevoegen', 'Duidelijke facturen automatisch inboeken' (Instellingen) en 'Ben ik klaar?' — letterlijk uit de catalogus.  
  → `src/lib/i18n/messages.ts:1695 ('int.toevoegen'), 9007-9011 ('int.maakFotoUpload'), 1442-1443 ('inst.autoBoeken' + uitleg), 1631 ('klr.titel')`

## 29 · LinkedIn · Tekstpost

Verdict: **HERSCHREVEN** · asset: Geen asset nodig; LinkedIn-tekstpost leest beter zonder beeld. Wil je er één bij, gebruik dan de taalkaart uit Instellingen ('Taal · اللغة · Language', src/components/settings/Lang

- **[important]** «De brief gaf alleen een thema ('ZZP'ers zijn geen boekhouders geworden; administratie moet zich aanpassen aan de ondernemer'), geen copy.»  
  Zo'n thema zakt vanzelf richting 'wij regelen je boekhouding'. Dat doet het product niet: de aangifte wordt niet ingediend door de app. De tekst noemt dat nu expliciet als grens, en verder alleen mechanismen die in de code staan.  
  → `src/lib/i18n/messages.ts:1906-1910 ('aang.conceptZelf': 'Je dient hem zelf in bij de Belastingdienst — hieronder staat hoe.') en 1901-1905 ('aang.conceptBoekhou`
- **[important]** «Risico in elk merkverhaal over automatisering: 'de app boekt alles voor je' of andersom 'jij controleert alles'.»  
  Allebei onwaar. De app boekt een foutloos gelezen factuur zelf in (openstaand, nooit betaald, terug te draaien) en boekt een kassabon mét afgedrukte betaalregel wél meteen af; tegelijk kan de eigenaar dat uitzetten. De tekst zegt precies dat, in de woorden van de schakelaar.  
  → `src/lib/i18n/messages.ts:1442-1443 ('Duidelijke facturen automatisch inboeken' + uitleg); src/app/api/intake/route.ts:1446-1449 en 1560-1600 ([BON-AUTO] afboeke`
- **[important]** «Risico: betalingsherinneringen als 'wij jagen al je openstaande facturen na'.»  
  De herinneringen staan standaard aan en lopen op tot de ingebrekestelling met incassokosten, maar alleen voor facturen die vervallen ná het moment dat het account begon — een geïmporteerde oude stapel wordt niet aangemaand. Die nuance staat er nu bij; hij is bovendien het beste vertrouwensargument van de hele post.  
  → `src/app/api/cron/reminders/route.ts:26-31 ([HERINNER-AAN] reminders_enabled standaard aan, reminderTierDue jaagt alleen op facturen die ná reminders_enabled_at `

## 30 · Instagram · Carrousel, 7 slides

Verdict: **HERSCHREVEN** · asset: Vereist een ingelogd demo-account met echte data (de smoke-test komt niet achter de login, dus screenshots moeten handmatig). Per slide: 2 = /dashboard/invoice/new met de knop 'Ops

- **[blocking]** «'inkomende facturen via Gmail verwerken'»  
  Onwaar als exclusiviteit: Outlook is de tweede van exact twee mailboxknoppen op Inkomend, met een eigen OAuth-callback. 'via Gmail' vertelt elke Outlook-gebruiker dat het product niets voor hem is. Vervangen door 'Verbind Gmail of Outlook'.  
  → `src/app/dashboard/incoming/IncomingInvoicesClient.tsx:1004-1017 ((['gmail','outlook']).map → 'Verbind {provider}'); src/app/api/email/callback/outlook/route.ts;`
- **[blocking]** «'BTW, resultaat en kwartaaloverzicht bekijken'»  
  Er is geen 'resultaat'-scherm en geen 'Financieel overzicht' meer: /dashboard/resultaat is een kale redirect naar /dashboard/waarheid. Het scherm heet op het startscherm 'Je waarheid'. Een recap-post die een niet-bestaand scherm noemt, is precies de zin die teruggequote wordt.  
  → `src/app/dashboard/resultaat/page.tsx:1-35 (redirect naar /dashboard/waarheid); src/lib/i18n/messages.ts:474 ('start.waarheid' = 'Je waarheid'), 106 ('chrome.waa`
- **[blocking]** «'BTW ... bekijken' zonder grens»  
  De app bouwt de concept-BTW-aangifte maar dient niets in. Zonder die zin leest de bullet als 'BoekBrug doet je aangifte'. De slide eindigt nu met 'Indienen doe je zelf'.  
  → `src/lib/i18n/messages.ts:1906-1910 ('Je dient hem zelf in bij de Belastingdienst — hieronder staat hoe.'); src/lib/i18n/messages.ts:9532-9536 ('kw.conceptAangif`
- **[important]** «'bankafschriften importeren en transacties matchen'»  
  Waar, maar te vaag om te controleren en op één punt misleidend in de praktijk: een PDF-afschrift wordt niet uitgelezen, en het bestandsveld op Bank filtert op .xml/.940/.sta/.mt940/.txt terwijl de regel eronder óók CSV belooft. Een CSV komt wél binnen via 'Alles uploaden' (dat accepteert .csv) en wordt door de intake-r  
  → `src/app/dashboard/bank/BankClient.tsx:2065 (accept=".xml,.940,.sta,.mt940,.txt") tegenover :2133 met src/lib/i18n/messages.ts:3827-3831 ('CAMT.053 (.xml), MT940`
- **[important]** «'bonnetjes scannen met AI' als losse bullet»  
  Klopt, maar het verzwijgt wat de app hier echt onderscheidt: er is één ingang die zelf beslist of iets een bon, een factuur, een bankafschrift of een gewoon bestand is (/api/intake). Dat is de gemiste centrale functie van de hele maand. Bullet samengevoegd met de upload-slide, in de woorden van de app: 'Maak een foto o  
  → `src/lib/intake-router.ts:1-22 (vier bestemmingen: bank/invoice/receipt/document); src/app/dashboard/upload/page.tsx:1-6 (alle schermen POSTen naar /api/intake);`
- **[important]** «'facturen maken' zonder wat er de deur uit gaat»  
  De verzendknop e-mailt de PDF én hangt de e-factuur (UBL) erbij zodra die te bouwen is — dat is de tweede gemiste functie van de maand, en precies het argument bij zakelijke klanten. Voorwaarde (compleet kvk/btw-profiel) staat in de caption, niet op de slide.  
  → `src/app/api/invoice/send/route.ts:47 (ublAttachmentForInvoice); src/lib/ubl-for-email.ts:1-16 (best-effort: zonder kvk of bij een geweigerde generator gaat alle`
- **[minor]** «'alles samenbrengen voor jou en je boekhouder'»  
  Te vaag om te controleren. Vervangen door de drie dingen die echt bestaan en die de app zelf zo noemt: 'Ben ik klaar?' → één ZIP, 'Of stuur het naar je boekhouder' (link, 30 dagen, geen account), en live meekijken via de Brug met delen per bestand.  
  → `src/lib/i18n/messages.ts:9522-9526 ('klr.zipUitleg'), 9462-9466 ('Download voor de boekhouder'), 14707-14708 ('Of stuur het naar je boekhouder' / link 30 dagen,`
- **[minor]** «De hele maand noemt nergens dat het scherm meer dan Nederlands spreekt.»  
  Het product is vertaald in Nederlands, Engels en Arabisch (Turks valt bewust terug op Nederlands, dus níét noemen), terwijl de documenten Nederlands blijven. Dat is een echt verkoopargument bij een groep die de blog al in het Arabisch leest. Eén regel op de slotslide, uitgeschreven in de caption.  
  → `src/lib/i18n/locale.ts:53-64 (LOCALES, DEFAULT_LOCALE 'nl'); src/lib/i18n/messages.ts:28-34 (Turks bewust afwezig, valt terug op Nederlands); src/components/set`
- **[minor]** «Opdracht noemde 'DAY 22' als tweede post die bullet-voor-bullet gecontroleerd moest worden.»  
  DAY 22 zat niet in deze batch; alleen 28, 29 en 30 zijn aangeleverd. De bullets van DAY 22 zijn hier dus NIET gecontroleerd — dat is 'niet gezien', niet 'goedgekeurd'.  
  → `Opdrachttekst, sectie '=== YOUR POSTS ===' bevat alleen DAY 28, 29 en 30.`

## 30 · LinkedIn · Tekstpost (oprichters-/productverhaal)

Verdict: **HERSCHREVEN** · asset: Geen beeld nodig. Wil je er één: /dashboard/waarheid ('Je waarheid') als één schoon scherm, ingelogd demo-account met data. Gebruik géén beeld van een offerte-scherm bij punt 1 — e

- **[important]** «Brief vraagt om een 'founder story' zonder feiten over de oprichter aan te leveren.»  
  Een factcheckdesk verzint geen biografie. Het verhaal is daarom gebouwd op productbeslissingen die in de repo naleesbaar zijn — drie keer iets weggehaald. Als de oprichter een persoonlijke opening wil (waarom hij begon), moet die zin van hem komen; alles daaronder is gecontroleerd.  
  → `Geen bron in de repo voor persoonlijke achtergrond; wel voor elke productbewering hieronder.`
- **[important]** «Voor de hand liggende claim in zo'n verhaal: 'van offerte naar factuur met één klik'.»  
  Die knop is bewust verwijderd en een gate houdt de verwijdering vast; er staat nu een voorgevuld formulier achter 'Maak factuur aan'. De post gebruikt die schrapping juist als verhaal in plaats van de oude belofte te herhalen.  
  → `src/lib/lifecycle-gates.test.ts:7396-7402 ('Omzetten naar factuur' — een knop die drie weken eerder was verwijderd, in drie talen tegelijk) en :4190-4209; src/l`
- **[minor]** «Risico: 'we hebben één cijferscherm' klinkt als een feature-claim.»  
  Het is precies andersom en dat is controleerbaar: 'Financieel overzicht' en 'Je waarheid' rekenden dezelfde zes getallen uit, het eerste is weggehaald en het oude adres redirect. Zo geschreven in de post.  
  → `src/app/dashboard/resultaat/page.tsx:1-35 (inclusief de zes eerlijkheidsgaten die alleen op waarheid gedicht waren)`