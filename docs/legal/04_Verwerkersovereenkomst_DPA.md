# Verwerkersovereenkomst (DPA)
## BoekBrug Platform — Accountant Edition

**Versie:** 1.0
**Laatst bijgewerkt:** 25 mei 2026

---

Deze Verwerkersovereenkomst ("DPA") maakt deel uit van de gebruiksvoorwaarden tussen BoekBrug en de Accountant en regelt de verwerking van persoonsgegevens van eindklanten (ZZP'ers) op het BoekBrug-platform.

---

## 1. Partijen

**Verwerkingsverantwoordelijke ("Accountant"):**
- Bedrijfsnaam: _________________________
- KVK-nummer: _________________________
- Adres: _____________________________
- Contactpersoon: _____________________
- E-mail: ____________________________

**Verwerker ("BoekBrug"):**
- Bedrijfsnaam: [JOUW NAAM]
- KVK-nummer: [INVULLEN ZODRA INGESCHREVEN]
- Adres: [JOUW ADRES IN TILBURG]
- E-mail: privacy@boekbrug.nl

---

## 2. Definities

- **"Persoonsgegevens"**: zoals gedefinieerd in artikel 4 AVG
- **"Verwerking"**: zoals gedefinieerd in artikel 4 AVG
- **"Betrokkenen"**: eindklanten (ZZP'ers) van de Accountant die het Platform gebruiken
- **"Subverwerkers"**: derden die door BoekBrug worden ingeschakeld
- **"Datalek"**: inbreuk in verband met persoonsgegevens conform AVG

---

## 3. Onderwerp en doel

### 3.1 Onderwerp
De Accountant maakt gebruik van het BoekBrug-platform om de administratie van zijn/haar klanten (ZZP'ers) te beheren. BoekBrug verwerkt hierbij persoonsgegevens in opdracht van de Accountant.

### 3.2 Doel
Verwerking gebeurt uitsluitend voor:
- Het beschikbaar stellen van het Platform
- Het tonen van klantgegevens (alleen na expliciete koppeling)
- Het opslaan van facturen, bestanden en BTW-data
- Het verzenden van notificaties en communicatie

### 3.3 Looptijd
Deze overeenkomst geldt zolang de Accountant het Platform gebruikt en daarna voor de wettelijke bewaartermijn (7 jaar).

---

## 4. Categorieën gegevens en betrokkenen

### 4.1 Categorieën van persoonsgegevens
- Naam, e-mail, telefoonnummer (van ZZP'ers en hun klanten)
- KVK- en BTW-nummers
- Adres- en bedrijfsgegevens
- Bankrekeningnummers (IBAN)
- Facturatiegegevens
- Documenten en bestanden
- Audit logs en gebruiksgegevens

### 4.2 Categorieën van betrokkenen
- ZZP'ers (klanten van de Accountant)
- Klanten van die ZZP'ers
- Werknemers van die ZZP'ers (indien van toepassing)

### 4.3 Geen bijzondere persoonsgegevens
Het Platform is **niet** bedoeld voor verwerking van:
- Gezondheidsgegevens
- Religieuze overtuigingen
- Politieke voorkeuren
- Biometrische gegevens
- Genetische gegevens

Mocht de Accountant dergelijke gegevens uploaden, gebeurt dit op eigen verantwoordelijkheid en zijn de strengere bepalingen van AVG van toepassing.

---

## 5. Instructies en doelbinding

### 5.1 Verwerking conform instructies
BoekBrug verwerkt persoonsgegevens uitsluitend op basis van schriftelijke instructies van de Accountant, zoals vastgelegd in:
- Deze DPA
- De gebruiksvoorwaarden (Algemene Voorwaarden)
- Specifieke schriftelijke instructies

### 5.2 Geen secundaire verwerking
BoekBrug zal persoonsgegevens niet gebruiken voor:
- Marketingdoeleinden
- Verkoop aan derden
- Training van AI-modellen (Anthropic API met opt-out)
- Profiling buiten platformfunctionaliteit

### 5.3 Conflict met wetgeving
Indien een instructie in strijd is met AVG of Nederlandse wetgeving, informeert BoekBrug de Accountant onmiddellijk.

---

## 6. Beveiligingsmaatregelen

BoekBrug treft passende technische en organisatorische maatregelen (TOM's):

### 6.1 Technische maatregelen
- ✅ Encryptie in transit (HTTPS/TLS 1.3)
- ✅ Encryptie at rest (AES-256)
- ✅ Vault-encryptie voor gevoelige tokens
- ✅ Row-Level Security (RLS) in database
- ✅ Sterke wachtwoordvereisten
- ✅ Sessie-management met automatische logout
- ✅ Real-time foutmonitoring (Sentry)
- ✅ Audit logging van kritieke handelingen

### 6.2 Organisatorische maatregelen
- ✅ Toegang tot productiedata beperkt
- ✅ Privacy-by-design en privacy-by-default
- ✅ Reguliere security reviews
- ✅ Documentatie van verwerkingsactiviteiten

### 6.3 Continue verbetering
BoekBrug houdt beveiligingsmaatregelen up-to-date conform de stand der techniek en zal indien nodig aanvullende maatregelen treffen.

---

## 7. Subverwerkers

### 7.1 Goedkeuring voor huidige subverwerkers
De Accountant geeft hierbij algemene toestemming voor de volgende subverwerkers:

| Subverwerker | Doel | Locatie | DPA-grondslag |
|--------------|------|---------|---------------|
| **Supabase Inc.** | Databasehosting, opslag, authenticatie | VS (EU-datalocatie) | SCCs |
| **Vercel Inc.** | Hosting webapplicatie en cookieloze bezoekstatistiek | VS (EU edge) | SCCs |
| **Anthropic PBC** | AI-classificatie van documenten | VS | SCCs |
| **Resend Inc.** | Transactionele e-mails | VS | SCCs |
| **Sentry / Functional Software Inc.** | Foutmonitoring | VS | SCCs |
| **Enable Banking Oy** (alleen bij bankkoppeling) | Ophalen van rekeninggegevens en transacties onder PSD2 | Finland (EU) | Verwerkersovereenkomst; geen doorgifte buiten de EER |
| **Stripe Payments Europe, Ltd.** (alleen bij een betaald abonnement) | Betaalverwerking en abonnementsbeheer | Ierland (EU), met doorgifte naar Stripe, Inc. (VS) | Stripe DPA met SCCs |
| **Mollie B.V.** (alleen bij een eigen Mollie-koppeling) | iDEAL-betaallinks op facturen en het ophalen van uitbetalingen | Nederland (EU) | Verwerkersovereenkomst; geen doorgifte buiten de EER |
| **SnelStart B.V.** (alleen bij een eigen SnelStart-koppeling) | Doorgifte van jouw boekingen naar jouw eigen SnelStart-administratie | Nederland (EU) | Doorgifte op jouw instructie naar een systeem dat jij zelf beheert; geen doorgifte buiten de EER |
| **Google LLC** (alleen bij Gmail-koppeling) | OAuth en API-toegang | VS | Google Cloud DPA |
| **Microsoft Corporation** (alleen bij Outlook-koppeling) | OAuth en API-toegang | VS | Microsoft DPA |

### 7.2 Wijzigingen in subverwerkers
- BoekBrug informeert Accountant minimaal 30 dagen vooraf bij wijziging
- Accountant heeft recht om gemotiveerd bezwaar te maken
- Bij gegrond bezwaar: BoekBrug en Accountant zoeken samen naar oplossing

### 7.3 Eisen aan subverwerkers
Alle subverwerkers zijn gebonden aan minimaal dezelfde AVG-verplichtingen als in deze DPA.

---

## 8. Rechten van betrokkenen

### 8.1 Bijstand bij verzoeken
BoekBrug ondersteunt de Accountant bij het uitoefenen van rechten van betrokkenen (ZZP'ers en eindklanten):
- Recht op inzage
- Recht op rectificatie
- Recht op verwijdering (binnen wettelijke kaders)
- Recht op dataportabiliteit
- Recht op beperking

### 8.2 Directe verzoeken
Indien een betrokkene direct contact opneemt met BoekBrug, verwijst BoekBrug deze door naar de Accountant, tenzij de wet anders bepaalt.

### 8.3 Faciliteiten
- Data-export via Platform mogelijk (CSV/JSON/UBL)
- Verwijderingsverzoeken via Platform of e-mail

---

## 9. Datalekken

### 9.1 Meldplicht aan Accountant
Bij een datalek dat persoonsgegevens van de Accountant of zijn klanten betreft, informeert BoekBrug de Accountant **binnen 24 uur na ontdekking** via:
- E-mail naar contactpersoon
- Voorlopige informatie over aard en omvang

### 9.2 Volledige informatie binnen 72 uur
Binnen 72 uur ontvangt de Accountant:
- Aard van de inbreuk
- Categorieën en aantal betrokkenen
- Categorieën en aantal records
- Genomen en voorgestelde maatregelen
- Contactgegevens FG/contactpersoon

### 9.3 Melding aan AP
De Accountant is verantwoordelijk voor melding bij Autoriteit Persoonsgegevens (binnen 72 uur na ontdekking). BoekBrug ondersteunt waar nodig.

### 9.4 Melding aan betrokkenen
Bij hoog risico voor betrokkenen: gezamenlijke beslissing over directe communicatie.

---

## 10. Audit en controle

### 10.1 Recht op controle
De Accountant heeft het recht om BoekBrug te controleren op naleving van deze DPA, maximaal 1x per jaar tijdens kantooruren, na schriftelijke aankondiging van minimaal 30 dagen.

### 10.2 Wijze van audit
- Vragenlijsten (eerste keuze)
- Bewijs van compliance documenten
- Externe certificeringen (indien beschikbaar)
- On-site audit alleen bij gerechtvaardigde reden

### 10.3 Kosten
- Eerste audit per jaar: kosteloos
- Aanvullende audits op kosten van Accountant
- Bij vastgestelde overtreding: BoekBrug draagt redelijke kosten

---

## 11. Internationale doorgifte

### 11.1 Doorgifte buiten EU
Sommige subverwerkers zijn gevestigd in de VS. BoekBrug zorgt voor passende waarborgen:
- Standard Contractual Clauses (SCCs) van EU-Commissie
- Aanvullende technische maatregelen waar nodig
- EU-datalocaties waar mogelijk

### 11.2 Geen doorgifte buiten EU/VS
Geen doorgifte naar andere landen zonder voorafgaande toestemming van de Accountant.

---

## 12. Beëindiging

### 12.1 Beëindigingsgronden
- Beëindiging gebruiksovereenkomst
- Schending van deze DPA
- Wettelijke verplichting

### 12.2 Bij beëindiging
- BoekBrug stopt verwerking onmiddellijk
- Verplichte volledige export van data wordt aangeboden
- Data wordt gearchiveerd conform wettelijke bewaarplicht (7 jaar)
- Na bewaartermijn: definitieve verwijdering op verzoek

### 12.3 Archief voor Accountant
Reeds verwerkte data blijft toegankelijk voor de Accountant gedurende de wettelijke bewaartermijn, in een afgesloten archiefmap.

---

## 13. Aansprakelijkheid

### 13.1 Schadevergoeding
Voor de aansprakelijkheid van BoekBrug onder deze DPA geldt artikel 9 van de Algemene Voorwaarden:
- Beperkt tot directe schade
- Maximaal 12 maanden betaalde bedragen, met maximum €1.000

### 13.2 Vrijwaring door Accountant
De Accountant vrijwaart BoekBrug van aanspraken van derden voor zover deze voortvloeien uit:
- Onjuiste data ingevoerd door Accountant of klanten
- Niet-naleven van wettelijke verplichtingen door Accountant
- Onrechtmatig verkregen klantgegevens

---

## 14. Geheimhouding

### 14.1 Algemene plicht
Beide partijen zijn gehouden tot strikte geheimhouding van:
- Persoonsgegevens
- Technische informatie over het Platform
- Bedrijfsgevoelige informatie

### 14.2 Werknemers en hulppersonen
BoekBrug zorgt dat alle medewerkers en hulppersonen vertrouwelijkheidsverklaringen hebben getekend.

### 14.3 Looptijd
De geheimhoudingsplicht blijft van kracht na beëindiging van de overeenkomst.

---

## 15. Slotbepalingen

### 15.1 Wijzigingen
Wijzigingen aan deze DPA worden 30 dagen vooraf schriftelijk gecommuniceerd. Bij weigering: opzeggingsrecht.

### 15.2 Voorrang
Bij conflict tussen deze DPA en andere documenten geldt de volgende rangorde:
1. Dwingend recht (AVG, UAVG, etc.)
2. Deze DPA
3. Algemene Voorwaarden
4. Privacyverklaring

### 15.3 Toepasselijk recht
Op deze DPA is uitsluitend Nederlands recht van toepassing. Geschillen worden voorgelegd aan de rechter te Tilburg.

---

## Ondertekening

**Voor de Accountant:**

Naam: _________________________
Functie: _______________________
Datum: ________________________
Handtekening: __________________

**Voor BoekBrug:**

Naam: _________________________
Functie: _______________________
Datum: ________________________
Handtekening: __________________

---

*Deze DPA is opgesteld in overeenstemming met de AVG (Verordening (EU) 2016/679) en de Uitvoeringswet AVG.*
