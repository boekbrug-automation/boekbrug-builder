// src/lib/deploy-health.ts
// [DEPLOY-HEALTH] Klopt de bedrading van deze installatie? Puur, geen I/O.
// Run: npx tsx --test src/lib/deploy-health.test.ts
//
// WAAROM
// Na een deploy weet je dat de code er staat. Je weet níet of de omgeving compleet is — en de
// duurste variabelen zijn juist die waarvan het ontbreken NIETS zichtbaars doet. CRON_SECRET is
// het voorbeeld: staat hij er niet, dan antwoorden alle crons 401 en doen niets. Geen scherm
// verandert, geen mail blijft uit die iemand mist. Je ontdekt het bij de eerste kwartaalafsluiting
// die nooit kwam — vier keer per jaar, dus mogelijk een jaar later.
//
// Deze module beoordeelt de omgeving. Wat er NOOIT in staat: een waarde. Alleen aanwezig of niet.
// Een gezondheidsrapport dat sleutels lekt is zelf het lek.

export type Severity = "blokkeert" | "stil" | "optioneel";

export interface EnvCheck {
  key: string;
  severity: Severity;
  /** Wat er gebeurt als hij ontbreekt. In het Nederlands, want dit lees je onder tijdsdruk. */
  gevolg: string;
}

/**
 * De variabelen die ertoe doen, met de reden waarom.
 *
 * 'blokkeert' — er gaat zichtbaar iets stuk; je merkt het bij de eerste poging.
 * 'stil'      — er gaat iets stuk zonder dat iemand het merkt. Dit is de gevaarlijke categorie
 *               en de reden dat dit bestand bestaat.
 * 'optioneel' — een functie werkt niet; de rest van de app heeft er geen last van.
 */
export const ENV_CHECKS: readonly EnvCheck[] = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    severity: "blokkeert",
    gevolg: "de app start niet — geen enkele pagina laadt",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    severity: "blokkeert",
    gevolg: "de app start niet — geen enkele pagina laadt",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    severity: "blokkeert",
    gevolg: "elke cron, elke webhook en elke ondertekende bestands-URL faalt",
  },
  {
    key: "CRON_SECRET",
    severity: "stil",
    gevolg:
      "alle crons antwoorden 401 en doen niets: geen mailimport, geen herinneringen, geen kwartaalafsluiting. Niets op een scherm verandert, dus je merkt het pas als een klant vraagt waarom zijn boekhouder nooit iets kreeg",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    severity: "stil",
    gevolg:
      "links in de app vallen terug op de origin van het verzoek, maar de kwartaal-cron heeft geen verzoek en valt terug op https://boekbrug.nl — draai je op een ander domein, dan krijgt de boekhouder een link naar een andere site",
  },
  {
    key: "RESEND_API_KEY",
    severity: "blokkeert",
    gevolg: "er vertrekt geen enkele mail: geen uitnodigingen, geen herinneringen, geen kwartaalmail",
  },
  {
    key: "ANTHROPIC_API_KEY",
    severity: "blokkeert",
    gevolg: "bonnen scannen geeft een nette foutmelding in plaats van een resultaat",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    // [VOORWAARDELIJK] Alleen 'stil' als afrekenen überhaupt AAN staat — zie checkEnv.
    severity: "stil",
    gevolg:
      "iemand betaalt, de webhook wordt geweigerd en het account springt nooit op plus. Het geld is binnen, de toegang niet",
  },
  {
    key: "STRIPE_SECRET_KEY",
    severity: "optioneel",
    gevolg: "afrekenen werkt niet; de rest van de app heeft er geen last van",
  },
  // [DEPLOY-HEALTH] De twee prijs-id's. Ze horen bij dezelfde familie als het webhook-geheim: pas
  // een zorg zodra afrekenen AAN staat — zie STRIPE_ALS_AFREKENEN_AAN hieronder.
  //
  // Waarom 'stil' en niet 'blokkeert'. isBillingConfigured() eist de sleutel ÉN de maandprijs, en
  // isAnnualBillingConfigured() de sleutel én de jaarprijs. Ontbreekt er een, dan gooit er niets:
  // de knop verdwijnt gewoon. De pagina rendert, er staat geen foutmelding, en het enige wat er
  // gebeurt is dat niemand meer kan kopen. Dat is de definitie van stil — je ontdekt het aan
  // omzet die niet komt, niet aan een melding.
  //
  // Het gemeten voorval: de jaarprijs stond gepubliceerd in de FAQ en in de meta-omschrijving van
  // alle vier de prijspagina's, terwijl STRIPE_PRICE_ID_PLUS_YEAR nog niet bestond. Een bezoeker
  // las het bedrag en had geen knop om het te kopen — en dit rapport meldde een complete omgeving.
  {
    key: "STRIPE_PRICE_ID_PLUS",
    severity: "stil",
    gevolg:
      "de maandknop op /prijzen verdwijnt zonder foutmelding: niemand kan Plus nemen, de pagina ziet er normaal uit en er komt alleen geen omzet",
  },
  {
    key: "STRIPE_PRICE_ID_PLUS_YEAR",
    severity: "stil",
    gevolg:
      "de jaarknop verdwijnt terwijl het jaarbedrag wél op de prijspagina's staat: de bezoeker leest een prijs die hij nergens kan afrekenen",
  },
  {
    key: "SNELSTART_SUBSCRIPTION_KEY",
    severity: "optioneel",
    gevolg: "de SnelStart-koppeling toont zich als 'nog niet beschikbaar' — bewust, geen fout",
  },
  // [ENABLEBANKING] Twee sleutels, één functie: zonder ALLEBEI is er geen bankkoppeling. Ze staan
  // los in deze lijst zodat het rapport de ONTBREKENDE bij naam noemt — "de bankkoppeling doet
  // het niet" met twee kandidaten is precies het rapport waar je niets aan hebt.
  //
  // 'optioneel', niet 'stil': ontbreken ze, dan verbergt de koppelkaart zichzelf en blijft
  // uploaden gewoon werken. Er gaat dus niets stil kapot — er staat alleen iets niet aan.
  {
    key: "ENABLEBANKING_APPLICATION_ID",
    severity: "optioneel",
    gevolg: "de bankkoppeling verbergt zich; een bankafschrift uploaden werkt gewoon door",
  },
  {
    key: "ENABLEBANKING_PRIVATE_KEY",
    severity: "optioneel",
    gevolg: "de bankkoppeling verbergt zich; een bankafschrift uploaden werkt gewoon door",
  },
];

export interface EnvResult extends EnvCheck {
  aanwezig: boolean;
}

/**
 * Beoordeelt de omgeving. Leest ALLEEN of een sleutel een niet-lege waarde heeft.
 *
 * De waarde zelf verlaat deze functie nooit, ook niet ingekort of gehasht: dit rapport is bedoeld
 * om na een deploy op te vragen, en een rapport dat sleutels lekt is zelf het lek.
 */
/**
 * De sleutels die pas een zorg zijn zodra afrekenen AAN staat.
 *
 * Alle drie beschrijven een storing die alleen kan bestaan als er betaald kan worden: een webhook
 * die een betaling niet verwerkt, en twee prijs-id's zonder welke er geen knop is om mee te
 * betalen. Zonder STRIPE_SECRET_KEY bestaat die betaling niet, en dan is een ontbrekende sleutel
 * geen storing maar een uitstaande stap.
 *
 * Een SET en geen `c.key === ...`, omdat dit de derde sleutel is die dezelfde behandeling nodig
 * heeft: de volgende krijgt hem door één regel, niet door een conditie te herschrijven.
 */
const STRIPE_ALS_AFREKENEN_AAN: ReadonlySet<string> = new Set([
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_PLUS",
  "STRIPE_PRICE_ID_PLUS_YEAR",
]);

export function checkEnv(env: Readonly<Record<string, string | undefined>>): EnvResult[] {
  // [VOORWAARDELIJK] Zonder STRIPE_SECRET_KEY kan er niemand afrekenen, dus kan er ook geen
  // betaling zijn waarvan de webhook zoekraakt. Het ontbrekende webhook-geheim is dan geen stille
  // storing maar een uitstaande stap in een functie die nog niet aan staat.
  //
  // Dit is geen kosmetiek. De eerste echte meting meldde "iemand betaalt, de webhook wordt
  // geweigerd" op een installatie waar afrekenen helemaal uit stond — een alarm dat afgaat zonder
  // dat het ergens over kan gaan. Dat is precies hoe je mensen leert alarmen te negeren, en dan
  // missen ze het alarm dat er wél toe doet.
  const afrekenenAan = hasValue(env["STRIPE_SECRET_KEY"]);
  return ENV_CHECKS.map((c) => {
    const wachtOpStripe = STRIPE_ALS_AFREKENEN_AAN.has(c.key) && !afrekenenAan;
    const severity: Severity = wachtOpStripe ? "optioneel" : c.severity;
    const gevolg = wachtOpStripe
      ? "nog in te stellen zodra je Stripe aanzet; nu kan er niemand afrekenen, dus er is ook geen betaling die zoekraakt"
      : c.gevolg;
    return { ...c, severity, gevolg, aanwezig: hasValue(env[c.key]) };
  });
}

/**
 * Het eindoordeel over de omgeving.
 *
 * 'kapot' zodra iets blokkerends ontbreekt; 'let-op' zodra iets STILS ontbreekt. Die tweede is de
 * hele reden voor dit bestand: zonder deze check ziet een installatie met een ontbrekende
 * CRON_SECRET er volkomen gezond uit.
 */
export function envVerdict(results: readonly EnvResult[]): "gezond" | "let-op" | "kapot" {
  if (results.some((r) => !r.aanwezig && r.severity === "blokkeert")) return "kapot";
  if (results.some((r) => !r.aanwezig && r.severity === "stil")) return "let-op";
  return "gezond";
}

/** Alleen wat mist, in de volgorde waarin je het wilt lezen: blokkerend, dan stil, dan de rest. */
export function missingEnv(results: readonly EnvResult[]): EnvResult[] {
  const rang: Record<Severity, number> = { blokkeert: 0, stil: 1, optioneel: 2 };
  return results.filter((r) => !r.aanwezig).sort((a, b) => rang[a.severity] - rang[b.severity]);
}

/**
 * Een niet-lege waarde. Placeholders tellen NIET mee.
 *
 * `your-key-here` en `${SOMETHING}` zijn precies wat er in een omgeving belandt die iemand half
 * heeft ingevuld, en die moeten hier opvallen — anders meldt de check "aanwezig" over een sleutel
 * waarmee niets werkt.
 */
function hasValue(v: string | undefined): boolean {
  const s = (v ?? "").trim();
  if (!s) return false;
  if (s === "undefined" || s === "null") return false;
  if (/^\$\{.*\}$/.test(s)) return false;
  if (/^(your|my|change|replace|todo|xxx)[-_]/i.test(s)) return false;
  if (/^(here|placeholder|example)$/i.test(s)) return false;
  return true;
}
