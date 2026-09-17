// src/content/legal/eerlijk-gebruik.ts
// [FAIR-USE] Publiek beleid eerlijk gebruik — juli 2026
//
// De grenzentabel en de "altijd gratis"-lijst worden NIET hier getypt maar uit
// src/lib/fair-use.ts gehaald. Dat is opzet: een gepubliceerde belofte die afwijkt van wat
// de code doet, is een belofte die de gebruiker terecht kan afdwingen. Één bron dus.

import {
  ALWAYS_FREE,
  FAIR_USE_LIMITS,
  FAIR_USE_NO_CEILING,
  fairUseTableMarkdown,
  PLUS_ANNUAL_PRICE_EUR,
  PLUS_PRICE_EUR,
} from "@/lib/fair-use";
import {
  BEWAARPLICHT_YEARS,
  KLUIS_DELETE_NOTICE_DAYS,
  KLUIS_GRACE_MONTHS,
} from "@/lib/bewaarkluis";
import { fillCompanyIdentity } from "./company";

const prijs = PLUS_PRICE_EUR.toFixed(2).replace(".", ",");
const jaarprijs = PLUS_ANNUAL_PRICE_EUR.toFixed(2).replace(".", ",");

const gevolgen = FAIR_USE_LIMITS.map((l) => `- **${l.label}** — ${l.onExceed}`).join("\n");
const altijdGratis = ALWAYS_FREE.map((r) => `- ${r}`).join("\n");

const md = `# Eerlijk gebruik

**Laatst bijgewerkt:** 17 september 2026
**Versie:** 2.0

---

## In één zin

Gratis laat je BoekBrug proberen; Plus laat je je onderneming erop draaien, voor
**€ ${prijs} per maand** of **€ ${jaarprijs} per jaar** — en je wordt daar nooit ongevraagd
voor afgeschreven.

---

## 1. Waarom er een grens is

Twee dingen aan BoekBrug kosten ons per stuk geld: een document door de AI laten lezen, en
het jarenlang bewaren van je bestanden. De rest kost nagenoeg niets. Zonder enige grens
betaalt de rustige gebruiker mee aan de zwaarste, of gaat het product op een dag gewoon
dicht. Met een grens die openlijk opgeschreven staat, weet je vooraf waar je aan toe bent.

Daarom zijn er twee vormen, en ze doen iets verschillends.

**Gratis is de proefwerkplek.** Een vaste, kleine hoeveelheid per maand: genoeg om te zien hoe
BoekBrug werkt, te weinig om er een jaar op te draaien. Dat is geen versobering maar het
ontwerp — een gratis plan dat niemand ontgroeit heeft geen moment waarop betalen logisch wordt.

**Plus is zakelijk gebruik onder eerlijk gebruik.** Daar publiceren wij géén getal voor
facturen, gelezen documenten of opslag. Niet omdat er geen grens bestaat — een systeem heeft
altijd een grens — maar omdat een getal dat wij niet handhaven een belofte is die niets
betekent. Wat wij wél beloven staat hieronder in §5 en §6: nooit ongevraagd afschrijven, nooit
stilzwijgend verlagen, en nooit je eigen gegevens op slot.

---

## 2. Wie betaalt wat

| | Kosten |
|---|---|
| **Boekhouder / administratiekantoor** | **Gratis tot en met 10 gekoppelde klanten** — het volledige portaal, het werkbord en het ophalen van het kwartaal per klant. Geen proefperiode en geen klok: blijf je onder de tien, dan blijft het gratis. Daarboven een tarief per gekoppelde klant per maand, dat pas gaat gelden nadat wij het minstens 30 dagen vooraf hebben aangekondigd — zie voorwaarden §5.8 |
| **Ondernemer — Gratis** | **€ 0.** Alle functies, om uit te proberen, binnen de grenzen hieronder |
| **Ondernemer — Plus** | **€ ${prijs} per maand** of **€ ${jaarprijs} per jaar**, inclusief btw. Altijd opzegbaar; je houdt Plus tot het einde van de termijn die je al betaald hebt |

De jaarprijs is twaalf maanden voor de prijs van negen (9 × € ${prijs}). Het is één bedrag per
jaar: geen constructie met gratis maanden erin, en geen abonnement dat halverwege van vorm
verandert.

Er is geen instapkorting die later verdwijnt, **geen proefperiode van Plus** die stilzwijgend
overgaat in een abonnement, en geen functie die we later achter een betaalmuur schuiven zonder
het minstens 30 dagen vooraf te melden. Wie Plus neemt, betaalt vanaf dag één — het gratis plan
ís de proef.

---

## 3. De grenzen

${fairUseTableMarkdown()}

Waar **${FAIR_USE_NO_CEILING}** staat, publiceren wij voor Plus geen getal. Dat is de
afspraak zelf en niet een weggelaten cijfer: het gebruik moet passen bij één onderneming, en
wat daarbuiten valt staat in §7.

**Meetperiode:** een kalendermaand. Op de 1e van elke maand beginnen de maandtellers weer
bij nul. Opslag en aantallen die niet per maand gelden (mailboxen, ondernemingen) worden
gemeten zoals ze op dat moment zijn.

**Wat telt als "een verstuurde factuur"?** De eerste keer dat een factuur je administratie
verlaat. Een factuur opnieuw versturen telt niet nog een keer mee, en een factuur als PDF
downloaden telt helemaal nooit mee — opstellen, opslaan en downloaden blijven werken, ook
boven de grens.

**Wat telt als "een document dat de AI leest"?** Elke bon, inkoopfactuur of bankafschrift
die je uploadt, fotografeert of via je gekoppelde mailbox binnenkomt en die wij automatisch
uitlezen. Een bestand dat je zelf invult telt niet mee. Een bestand dat wij niet konden
lezen telt ook niet mee — mislukte pogingen komen nooit op jouw rekening.

---

## 4. Wat er gebeurt als je erboven komt

Eerst: **je hoort het vóórdat het gebeurt.** Bij 80% van een grens krijg je een melding in
de app, met het exacte aantal. Er gebeurt op dat moment niets anders.

Kom je er toch overheen, dan pauzeert alléén de handeling die geld kost:

${gevolgen}

En dan heb je twee keuzes, allebei goed: **wachten tot de volgende maand** (de tellers gaan
naar nul en alles werkt weer), of **overstappen naar Plus** (per direct; je kiest zelf of je
per maand of per jaar betaalt, en opzeggen kan altijd).

**En als je Plus later weer opzegt?** Dan wordt er niets verwijderd, blijft je gekoppelde
mailbox gekoppeld en blijft alles leesbaar en exporteerbaar. Wat je boven de gratis grenzen
hebt staan, blijft staan. Alleen nieuwe groei daarboven pauzeert weer — precies zoals
hierboven.

---

## 5. Wat altijd gratis blijft — op elk plan, ook boven de grens

${altijdGratis}

Dit is de belangrijkste regel van dit hele beleid: **een grens raakt nooit je toegang tot je
eigen administratie.** Je gegevens zijn van jou. Ook als je nooit een cent betaalt en ook
als je jaren boven de grens zit: inzien, doorzoeken en exporteren blijven werken.

**En als je stopt?** Dan bewaren wij je administratie nog **${KLUIS_GRACE_MONTHS} maanden
kosteloos**, en blijft exporteren in die hele periode werken. Vóór wij daarna iets
verwijderen krijg je **minstens ${KLUIS_DELETE_NOTICE_DAYS} dagen van tevoren** een e-mail,
met de gelegenheid alsnog alles te downloaden. Wil je dat je stukken langer online blijven
staan omdat je fiscale bewaarplicht van ${BEWAARPLICHT_YEARS} jaar doorloopt, dan is daar de
[Bewaarkluis](/prijzen) voor — een aparte, optionele dienst. Zonder die dienst verlies je
niets, zolang je binnen die ${KLUIS_GRACE_MONTHS} maanden je export veiligstelt.

---

## 6. Wat wij nooit doen

- **Nooit automatisch afschrijven.** Een gratis account wordt nooit stilzwijgend een betaald
  account. Plus gaat alleen in nadat jij er zelf op klikt.
- **Nooit met terugwerkende kracht factureren.** Wat je vóór je upgrade hebt gebruikt, blijft
  gratis — ook als je er ver overheen ging.
- **Nooit gegevens verwijderen wegens overschrijding.**
- **Nooit stilzwijgend de grens verlagen.** Wijzigingen worden minstens 30 dagen vooraf per
  e-mail aangekondigd. Ben je het er niet mee eens, dan kun je zonder kosten opzeggen en je
  gegevens meenemen.
- **Nooit je gegevens gebruiken om AI-modellen te trainen.** Zie de
  [Privacyverklaring](/privacy).

---

## 7. Waar eerlijk gebruik ophoudt

Het gratis plan is bedoeld voor één onderneming en de mensen die daarin werken. Niet eerlijk
— en reden om in gesprek te gaan, en bij herhaling om het account te beperken — is:

- de administratie van andere ondernemingen via één gratis account voeren (dat is een
  boekhouderspraktijk; daarvoor is het **gratis boekhoudersportaal**);
- BoekBrug doorverkopen of als dienst aan derden aanbieden;
- geautomatiseerd of via scripts documenten of verzoeken afvuren buiten normaal gebruik om;
- de beveiliging omzeilen, of meerdere gratis accounts aanmaken om de grenzen te ontlopen.

Wij nemen bij zoiets **eerst contact op** en geven je minstens 14 dagen om het recht te
zetten, tenzij er sprake is van fraude of van misbruik dat de dienst voor anderen verstoort.

---

## 8. Vragen of een uitzondering nodig?

Loop je tegen een grens aan door iets eenmaligs — een verhuizing van je oude administratie,
een piek na de feestdagen, een kwartaal dat je in één keer inhaalt — mail dan gewoon. Voor
zulke gevallen zetten we de grens tijdelijk ruimer, zonder kosten.

**support@boekbrug.nl** — onderwerp: "Eerlijk gebruik"

---

*Dit beleid maakt onderdeel uit van de [Algemene Voorwaarden](/voorwaarden). Bij strijd
tussen beide teksten geldt wat voor jou het gunstigst is.*
`;

export default fillCompanyIdentity(md);
