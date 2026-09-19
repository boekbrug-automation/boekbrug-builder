// [INTAKE-DEST-DEKKING] Kent elk uploadscherm alle bestemmingen die /api/intake kan teruggeven?
// Run: npx tsx --test src/lib/intake-destinations.test.ts
//
// WAAROM DIT EEN TEST IS EN GEEN AFSPRAAK
//
// /api/intake beslist zelf waar een bestand heen gaat en zet die keuze in `destination`. Drie
// schermen vertalen dat antwoord naar wat de eigenaar ziet: de camera-knop, de uploadpagina en
// de inkomend-lijst. Elk van die drie heeft een reeks takken, en elk sluit af met een restbak.
//
// Die restbak is het probleem. Komt er een bestemming bij in de route, dan BREEKT er niets: het
// bestand valt gewoon in de restbak en de eigenaar krijgt een algemene melding. Geen typefout,
// geen rode build, geen test die valt — de app blijft draaien en zegt iets vaags. Dat is precies
// de vorm waar dit product niet tegen kan.
//
// Het is ook geen hypothese. Het is twee keer gebeurd:
//   · 'statement' kwam erbij; de camera-knop liep achter.
//   · 'turnover' en 'ledger' kwamen erbij; de camera-knop liep opnieuw achter — en 'turnover' is
//     GEBOEKTE OMZET. Je fotografeert een kassabon-overzicht, de app boekt de dagen echt in
//     daily_turnover, en jij blijft staan waar je stond met "Toegevoegd ✓".
//
// Tweemaal dezelfde fout in hetzelfde bestand is een patroon, en een patroon hoort in een poort.
//
// WAT DEZE TEST WEL EN NIET BEWIJST
// Hij leest de bronbestanden als tekst en controleert dat elke bestemming er letterlijk in
// voorkomt. Dat is grof: het bewijst dat het scherm de bestemming KENT, niet dat het er iets
// verstandigs mee doet. Dat is bewust — de fijne beoordeling ("waar hoort de eigenaar heen?") is
// een ontwerpvraag die een test niet moet willen beantwoorden. De vraag die hij WEL beantwoordt
// is die ene die twee keer fout ging: is dit scherm de bestemming simpelweg vergeten?

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// [ONTVANGEN] The intake DOOR is two files since #129: the route keeps the guards and the
// deterministic branches, intake-processor.ts holds everything that needs the reader. Reading
// both is reading the door — which is what this test was always asking about.
const ROUTE = "src/app/api/intake/route.ts";
const ROUTE_HALVES = [ROUTE, "src/lib/intake-processor.ts"] as const;
const routeSource = () => ROUTE_HALVES.map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * De schermen die het antwoord van /api/intake vertalen naar wat de eigenaar ziet.
 * Komt er een vierde bij, zet hem hier neer — dan bewaakt deze test hem meteen mee.
 */
const SCHERMEN = [
  "src/components/intake/IntakeButton.tsx",
  "src/app/dashboard/incoming/IncomingInvoicesClient.tsx",
  "src/app/dashboard/upload/UploadClient.tsx",
] as const;

/**
 * Bestemmingen die de route NIET als letterlijke tekst schrijft en die dus niet uit de bron te
 * halen zijn. 'receipt' komt uit `destination: decision.destination` (een bon volgt hetzelfde pad
 * als een factuur). Hij hoort er wel bij, dus staat hij hier met de hand.
 */
const NIET_LETTERLIJK_IN_DE_ROUTE = ["receipt"] as const;

function bestemmingenUitDeRoute(): string[] {
  const bron = routeSource();
  const gevonden = new Set<string>(NIET_LETTERLIJK_IN_DE_ROUTE);
  for (const m of bron.matchAll(/destination:\s*["']([a-z_]+)["']/g)) gevonden.add(m[1]);
  return [...gevonden].sort();
}

test("de route geeft de bestemmingen terug die we denken", () => {
  // Een vangnet onder het vangnet: verandert de vorm van de route zo dat de regex niets meer
  // vindt, dan zou de dekkingstest hieronder stilletjes over een lege lijst lopen en altijd
  // slagen. Een lege poort is erger dan geen poort.
  const dests = bestemmingenUitDeRoute();
  assert.ok(dests.length >= 6, `slechts ${dests.length} bestemmingen gevonden in ${ROUTE} — leest de regex nog wel mee?`);
  for (const verwacht of ["invoice", "receipt", "bank", "document", "statement", "turnover", "ledger"]) {
    assert.ok(dests.includes(verwacht), `'${verwacht}' hoort een bestemming te zijn`);
  }
});

test("elk uploadscherm kent élke bestemming die de route kan teruggeven", () => {
  const dests = bestemmingenUitDeRoute();
  for (const scherm of SCHERMEN) {
    const bron = readFileSync(scherm, "utf8");
    for (const d of dests) {
      assert.ok(
        new RegExp(`['"]${d}['"]`).test(bron),
        `${scherm} noemt '${d}' nergens — dan valt die bestemming in de restbak en krijgt de ` +
          `eigenaar een algemene melding in plaats van te horen wat er met zijn bestand gebeurde.`,
      );
    }
  }
});

test("'turnover' is geboekt geld en moet naar Dagomzet leiden, niet naar een toast", () => {
  // De zwaarste uitkomst die de camera-knop kan hebben: er staat geld in de boeken. De route zegt
  // het zelf in zijn boodschap ("Controleer in Dagomzet"), dus die pagina moet bereikbaar zijn
  // vanaf het moment dat de eigenaar dat leest.
  const knop = readFileSync("src/components/intake/IntakeButton.tsx", "utf8");
  assert.ok(/destination === 'turnover'/.test(knop), "een eigen tak, niet de restbak");
  assert.ok(/\/dashboard\/dagomzet/.test(knop), "en een weg naar de pagina die de melding noemt");
});

test("de restbak blijft bestaan — hij mag alleen niet meer de gewone weg zijn", () => {
  // Weghalen zou erger zijn dan het probleem: een antwoord zonder `destination` (een oudere
  // deploy, een half antwoord) moet nog steeds íets tegen de eigenaar zeggen.
  for (const scherm of SCHERMEN) {
    const bron = readFileSync(scherm, "utf8");
    assert.ok(/else\s*\{|status: "error"|catch/.test(bron), `${scherm} heeft nog een vangnet nodig`);
  }
});
