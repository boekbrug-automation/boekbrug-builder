# RUSTIG — wat een scherm zegt, en wat het niet zegt

*De maatstaf voor elke zin die een ondernemer of boekhouder op het scherm leest. Gemeten
vóór er iets veranderde, en met een poort die het niet meer laat groeien.*

De opdracht van de eigenaar, letterlijk: elke pagina makkelijker, sneller, minder ingewikkeld,
minder gepraat in het gezicht van de klant — en hetzelfde voor de boekhouder. Een schone, simpele
app waar je niet in verdwaalt.

Zie ook `docs/UX_REVIEW_2026.md` (beweging en aanraking) en `docs/HEADER_SYSTEM.md` (de balken).
Dit document gaat over WOORDEN.

---

## Gemeten, 7 september 2026

| | schermen | zinnen op het scherm | woorden | > 20 woorden | > 50 woorden |
|---|---|---|---|---|---|
| ondernemer | 123 | 3.193 | 21.946 | 233 | 10 |
| boekhouder | 15 | — | 2.794 | 40 | 0 |

Na batch 2 (de drie dagelijkse schermen, dezelfde dag):

| | woorden | > 20 woorden | waarvan in rust |
|---|---|---|---|
| betalen | 2.741 → 2.487 | 25 → 10 | 0 |
| bank | 2.189 → 1.986 | 25 → 8 | 0 |
| controlewachtrij | 2.023 → 1.877 | 15 → 5 | 0 |

Wat er wegging: uitleg over ons binnenwerk ("ze staan hier zodat ze je werk niet in de weg
zitten"), een tooltip die het paneel herhaalde dat hij opent, en dezelfde alinea onder een
bank-sleutel én een betaal-sleutel. Wat er bleef, staat bij een beslissing: het bevestigvenster
van "vervangen", het betaalblad, de creditvraag.

Na batch 3 (de boekhoudermodule): 15 schermen, 2.794 → 2.537 woorden, 40 → 24 zinnen boven de
twintig. De wet bleef woord voor woord staan — art. 52 AWR, art. 35 en 35a Wet OB, art. 6:96 BW —
en de zes sleutels die elk zeiden "dit konden we niet lezen, en dat zegt niets over X" zeggen dat
nog steeds, in veertien woorden of minder.

Na batch 4 (de rest, op meting): elke zin in rust van 33 woorden of meer is geweest, en van de
46 kopieën zijn er 5 over — elk uitgelegd in de poort. De langste zin op het scherm is nu 38
woorden (de ene instructie van het bevestigscherm, met art. 52 AWR erin); alles boven de 35 staat
bij een beslissing. Gemeten over alle schermen: 263 → 197 zinnen boven de twintig, en 23.111 → 22.327 woorden sinds
batch 2 begon.

Na [KANTOOR-RUST] batch 1 (de stem van de boekhouder, september 2026): de aangeraakte
boekhouderschermen — bevestigen, debiteuren, factureren namens, machtiging vragen, stukken
opvragen, de Brug, de klantkaart, het kwartaalscherm en de twee gedeelde controlepanelen — van
2.209 naar 1.975 woorden, 23 → 16 zinnen boven de twintig. Wat er wegging: zinnen aan de
ondernemer gericht die de boekhouder las ("noteer dat even voor je boekhouder"), gezonde
controles die een alinea innamen (voor de boekhouder zwijgen ze nu), lege staten van drie tot
vijf zinnen vóór de ene knop, en de wetsartikelen in rust (art. 52 AWR, 35/35a Wet OB, 6:96 BW —
het feit blijft, het artikel opent op verzoek of staat bij de beslissing). Langste zin op het
scherm: 38 → 37; kopieën: 5 → 4.

De 233 zinnen langer dan twintig woorden zijn 7% van de zinnen en dragen ~30% van de woorden.
De drie dagelijkse schermen — betalen, bank, controlewachtrij — dragen 8.577 woorden: een derde
van alles.

De tien langste zinnen stonden allemaal *in rust*: een `<p>` op een scherm, naast niets dat ze
nodig had. Een van 67 woorden legt uit waarom de app een lijst apparaten NIET kan tonen. Dezelfde
bewaarplicht-voetnoot stond twee keer, onder twee sleutels, 102 woorden. Een van 63 woorden geeft
belastingles naast een vinkje.

---

## De regel

**Een scherm zegt wat het is en biedt aan wat je kunt doen. Verder niets, in rust.**

1. **Lengte verdien je bij een beslissing, nooit in rust.** Een zin naast de knop die geld
   verplaatst mag lang zijn. Een alinea op een scherm waar iemand doorheen loopt niet.
2. **Leg nooit onze eigen machinerie uit.** De ondernemer hoeft niet te weten waarom een dienst
   ons geen lijst geeft. Hij moet weten wat hij kan doen.
3. **Eén zin per gedachte.** Heeft hij een tweede nodig, dan zijn het twee gedachten en is er één
   waarschijnlijk nu niet nodig.
4. **Zeg het één keer in de app.** Dezelfde waarschuwing op twee schermen is één waarschuwing en
   één kopie die gaat afwijken.
5. **Een getal wint van een zin.** "2 facturen wachten" boven een alinea over wachten.
6. **Een waarschuwing mag niets zeggen wat de kaart eronder weerlegt.** "Bedragen kloppen niet"
   boven drie bedragen die optellen leert de eigenaar de volgende waarschuwing over te slaan.

## Wat NOOIT korter wordt

Dit zijn geen woorden, dit is geld of recht:

- een **bedrag** dat de eigenaar moet vergelijken (twee rekeningnummers, twee totalen);
- een **fraude-instructie** ("bel op een nummer dat je zelf opzoekt");
- de mededeling dat een controle **NIET kon lopen** — een stilte leest als "in orde"
  ([NO-SILENT-EMPTY]);
- een **wettelijke** zin die waar moet zijn (bewaarplicht, art. 52 AWR, verantwoordelijkheid);
- de zin die zegt **welke kant** een cijfer op is, of dat we dat niet weten.

Korter maken mag; de FEITEN erin weglaten niet.

De rendertests (`tests/render/`) pinnen zulke feiten als letterlijke zinsdelen in de gerenderde
HTML — "precies het bedrag van deze betaling", "staat nog niet in je administratie", "Deze hoef je
niet na te kijken". Batch 2 sneed er zeven door en de rendertests vingen ze alle zeven. Dat is
de bedoeling: zo'n zinsdeel is het feit, en de zin eromheen wordt korter.

En één die de eerste batch leerde: **wat de app UIT ZICHZELF nog gaat doen** is geen machinerie
maar een feit voor de eigenaar. "Die bijlage halen wij niet opnieuw op — behalve een .zip, die
wél" leek uitleg over ons binnenwerk en werd geschrapt; de `[BIJLAGE-TERUGWEG]`-poort ving het:
zonder die bijzin gaat de eigenaar 29 kassa-afsluitingen met de hand uploaden die vanzelf
binnenkomen. De toets is niet "gaat dit over ons?" maar "verandert dit wat de eigenaar nu doet?".

## Hoe je een zin beoordeelt

Stel drie vragen, in deze volgorde:

1. Staat hij in rust of bij een beslissing? *(in rust → hoort hij er überhaupt?)*
2. Zegt hij wat de ondernemer kan DOEN, of waarom WIJ iets niet kunnen? *(het tweede gaat weg)*
3. Staat dezelfde gedachte ergens anders in de app? *(dan één keer, op de plek van de beslissing)*

Wat overblijft, schrijf je als één zin per gedachte, en je telt de woorden.

## De poort

`[RUSTIG]` in `lifecycle-gates.test.ts` meet dit bij elke run: de langste zin die gerenderd wordt,
het aantal boven twintig woorden, en of een lange zin twee keer voorkomt. Het is een **ratel**: hij
kent de stand van vandaag en weigert elke verslechtering. Bij elke schoongemaakte batch wordt het
plafond verlaagd. Zo kan de app na deze ronde niet stilletjes weer vol lopen.

## Volgorde van het werk

1. de alinea's boven veertig woorden in rust, en elke dubbele;
2. de drie dagelijkse schermen;
3. de boekhoudermodule;
4. de rest, op meting.
