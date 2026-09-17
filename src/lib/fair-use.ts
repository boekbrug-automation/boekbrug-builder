// src/lib/fair-use.ts
// [FAIR-USE] Eerlijk gebruik: de grenzen van het gratis plan — juli 2026
//
// Waarom dit bestand bestaat: de grenzen staan op DRIE plekken voor de gebruiker
// (de pagina /eerlijk-gebruik, de Algemene Voorwaarden §5, en straks een teller in de app).
// Staan die getallen los van elkaar, dan lopen ze een keer uiteen — en dan beloven de
// voorwaarden iets anders dan de app doet. Dat is precies het soort verschil waar een
// gebruiker gelijk in krijgt. Daarom is DIT bestand de enige bron; de andere twee lezen
// eruit.
//
// Het model, in gewone taal:
//   • Het boekhoudersportaal is gratis tot ACCOUNTANT_FREE_CLIENTS gekoppelde klanten; het
//     tarief daarboven is nog niet vastgesteld (voorwaarden §5.8). Een grens over KLANTEN,
//     nooit over tijd — en een bestaande koppeling wordt er nooit door geraakt.
//   • De ondernemer betaalt niets zolang hij binnen het eerlijk gebruik blijft.
//   • Wie er structureel overheen gaat, kiest zelf: wachten tot de volgende maand of
//     upgraden naar Plus.
//
// Vier regels die juridisch en moreel niet onderhandelbaar zijn — ze staan hier in code
// zodat een latere wijziging bewust moet gebeuren:
//   1. NOOIT automatisch afschrijven bij overschrijding. Een gratis account wordt nooit
//      stilzwijgend een betaald account.
//   2. NOOIT data verwijderen of ontoegankelijk maken wegens overschrijding. Lezen,
//      zoeken, exporteren en je boekhouder toegang geven blijven ALTIJD werken — ook boven
//      de grens, ook na afloop van een abonnement.
//   3. Alleen de KOSTBARE handelingen pauzeren (een nieuw document door de AI laten lezen,
//      een nieuwe factuur versturen). Nooit het inzien van wat er al staat.
//   4. Waarschuwen vóórdat het gebeurt, niet erna.

/**
 * [BOEKHOUDER-GRENS] Hoeveel gekoppelde klanten een boekhouder gratis mag hebben.
 *
 * WAAROM ER EEN GRENS KOMT WAAR ER EERST GEEN WAS
 * Het portaal was "altijd gratis, ongeacht het aantal klanten". Dat is genereus, maar het geeft
 * het product weg aan precies de partij die er het meeste aan verdient: een kantoor met tachtig
 * klanten dat per klant een kwartier per kwartaal bespaart, bespaart meer dan honderd uur per
 * jaar. De ondernemer is de gebruiker; de boekhouder is de klant.
 *
 * WAAROM 10, EN NIET 3 OF 20
 * De grens hoort BOVEN "ik probeer het" en ONDER "ik heb mijn kantoor verhuisd" te liggen. Bij 3
 * of 5 loopt iemand ertegenaan vóórdat de gewoonte is ontstaan — en een boekhouder is niet één
 * gebruiker maar een distributiekanaal: één kantoor brengt vijftig ondernemers mee. Bij 20 bindt
 * hij niemand en is hij decoratie. Bij 10 blijft de kleine boekhouder permanent gratis (echte
 * goodwill, en zij zouden toch nooit veel betalen) en betaalt alleen wie het product tot zijn
 * werkwijze heeft gemaakt.
 *
 * WAAROM HIER GEEN PRIJS STAAT
 * Er is nog geen enkele boekhouder. Een tarief dat nooit is getoetst is een gok, en een
 * gepubliceerd tarief omhoog bijstellen is precies het afpakken waar dit product niet aan doet.
 * De GRENS staat daarom nu al vast — dat kost niets zolang er niemand is, en voorkomt dat hij
 * later van bestaande kantoren wordt afgenomen. Het TARIEF volgt de weg van §5.6: aangekondigd
 * vóór activering, minstens 30 dagen van tevoren, nooit met terugwerkende kracht.
 */
export const ACCOUNTANT_FREE_CLIENTS = 10;

/** De prijs van het betaalde klantplan, in euro per maand, inclusief btw. */
export const PLUS_PRICE_EUR = 19.99;

/**
 * [PROEF-WERKPLEK] Hetzelfde plan, per jaar vooruit: twaalf maanden dienst voor de prijs van negen.
 *
 * 179,91 = 9 × 19,99, en dat is met opzet exact zo uitgerekend in plaats van afgerond naar 179,00:
 * de korting is het GETAL drie maanden, niet een marketingprijs die er toevallig bij in de buurt
 * ligt. Zo blijft de belofte narekenbaar voor wie hem natelt.
 *
 * ÉÉN prijs, geen constructie. Niet drie gratis maanden plus negen betaalde, geen
 * subscription schedule, geen fase van nul euro. Dat scheelt een renewal die halverwege van vorm
 * verandert, een opzegging die per fase anders uitpakt, en een btw-behandeling die per periode
 * moet worden uitgelegd — alledrie dingen die een boekhoudpakket niet aan zijn eigen facturen
 * hoort te hebben.
 */
export const PLUS_ANNUAL_PRICE_EUR = 179.91;

/**
 * [PROEF-WERKPLEK] Wat er in de tabel staat waar Plus geen getal heeft.
 *
 * Eén constante, omdat deze zin op /prijzen, op /eerlijk-gebruik én in de Algemene Voorwaarden
 * terechtkomt via dezelfde tabel. Drie plekken die hetzelfde moeten beloven, uit één bron.
 */
export const FAIR_USE_NO_CEILING = "Ruim — eerlijk gebruik";

/** Hoeveel procent van een grens telt als "bijna vol" — bij deze stand waarschuwen we. */
export const NEAR_LIMIT_RATIO = 0.8;

/** Meetperiode: een kalendermaand. Op de 1e van de maand begint alles opnieuw. */
export const FAIR_USE_PERIOD = "kalendermaand" as const;

export type FairUseKey =
  | "aiDocuments"
  | "invoicesSent"
  | "storageMb"
  | "mailboxes"
  | "administrations";

export interface FairUseLimit {
  key: FairUseKey;
  /** Wat er geteld wordt, in de taal van de gebruiker. */
  label: string;
  /** De grens per meetperiode (of absoluut, zie `perMonth`). */
  free: number;
  plus: number;
  unit: string;
  /** False = een absolute grens (niet per maand, bv. aantal administraties). */
  perMonth: boolean;
  /** Wat er gebeurt bij overschrijding — letterlijk zo getoond aan de gebruiker. */
  onExceed: string;
}

/**
 * De grenzen zelf.
 *
 * [PROEF-WERKPLEK] DEZE TEKST STOND OMGEKEERD, EN DAT WAS HET VORIGE PRODUCT. Er stond dat de
 * grenzen zijn gekozen op wat een échte kleine ondernemer per maand doet, met de grens "daar
 * ruim boven", zodat gratis geen fuik zou zijn. Dat beschreef een gratis plan waarop je een
 * onderneming kon draaien — precies wat gratis niet meer is.
 *
 * Gratis is nu de PROEFWERKPLEK: genoeg om te zien hoe BoekBrug werkt, te weinig om een jaar op
 * te draaien. Gemeten op de enige echte administratie die er is: 116 gelezen documenten en
 * 282 MB in één maand. Werkelijk zakelijk gebruik gaat er met gemak overheen, en dat is het
 * ontwerp — een gratis plan dat niemand ontgroeit heeft geen upgrade-moment.
 *
 * Plus is zakelijk gebruik onder eerlijk gebruik: 0 = geen gepubliceerd plafond. Wat een prijs
 * kost staat NIET in dit blok; hij staat één keer in PLUS_PRICE_EUR en wordt overal afgeleid.
 * Hier stond ooit "€12,99 is een eerlijke prijs" overgetypt, en dat was al onwaar voordat
 * iemand het merkte.
 */
export const FAIR_USE_LIMITS: readonly FairUseLimit[] = [
  {
    key: "aiDocuments",
    label: "Documenten die de AI voor je leest (bonnen, inkoopfacturen, bankafschriften)",
    // [PROEF-WERKPLEK] Free = 10 gelezen documenten per maand. Gratis is de proefwerkplek waarin
    // je BoekBrug leert kennen, niet een goedkope versie waarop je een onderneming draait.
    free: 10,
    // 0 = GEEN gepubliceerd plafond. Plus is zakelijk gebruik onder eerlijk gebruik, met een
    // operationele bescherming per account ([EIGEN-AANDEEL]) die iets anders is dan een quotum:
    // die beschermt de dagzekering van het hele huis, en is geen getal dat wij verkopen.
    // Het stond hier op 500 terwijl limitForPlan() voor Plus al 0 teruggaf — het gepubliceerde
    // getal handhaafde dus niets. Nu zegt de tabel wat de app doet.
    plus: 0,
    unit: "per maand",
    perMonth: true,
    onExceed:
      "Nieuwe documenten worden nog wel bewaard, maar niet meer automatisch gelezen tot de volgende maand of tot je upgradet. Je kunt ze zelf invullen.",
  },
  {
    key: "invoicesSent",
    // [EERLIJK-WOORD] "of als PDF aanmaakt" stond hier en was onwaar. De teller staat achter
    // `if (!resend)` in /api/invoice/send: hij telt de EERSTE verzending en verder niets — geen
    // hernieuwde verzending, en een PDF downloaden telt helemaal nooit mee. Het label beloofde
    // dus een strengere grens dan de app hanteert, en dat is de verkeerde richting om je eigen
    // gratis plan verkeerd voor te stellen. De tekst volgt de teller; de teller is niet
    // aangepast om de tekst te redden.
    label: "Facturen die je verstuurt",
    // [PROEF-WERKPLEK] Free = 5 verstuurde facturen per maand. Genoeg om te zien hoe het werkt,
    // te weinig om een jaar op te draaien — precies het punt waarop Plus het antwoord is.
    free: 5,
    plus: 0,
    unit: "per maand",
    perMonth: true,
    onExceed:
      "Je kunt facturen blijven opstellen en opslaan; versturen vanuit BoekBrug pauzeert tot de volgende maand of tot je upgradet.",
  },
  {
    key: "storageMb",
    label: "Opslag voor je documenten",
    // [PROEF-WERKPLEK] Free = 50 MB. Opslag is een systeemmiddel, geen product waarvan wij
    // gigabytes verkopen, dus voor Plus staat er geen getal: niet 20 GB, niet 25 GB, niet 2 GB.
    // De 20 GB die hier stond was een restant van een ouder model en nooit een eis.
    free: 50,
    plus: 0,
    unit: "MB",
    perMonth: false,
    onExceed:
      "Uploaden pauzeert. Alles wat er al staat blijft bereikbaar en kan altijd geëxporteerd worden.",
  },
  {
    key: "mailboxes",
    label: "Gekoppelde mailboxen (Gmail/Outlook)",
    free: 1,
    // [MAILBOX-WAAR] Two, not three — and three was never reachable. email_connections carries
    // UNIQUE (user_id, provider) with CHECK (provider IN ('gmail','outlook')), so an account can
    // hold at most one Gmail and one Outlook. A second Gmail address does not fail: saveEmailTokens
    // upserts on (user_id, provider), so it silently REPLACES the first one.
    //
    // Publishing 3 was therefore a number the app could not honour on any plan. Corrected down
    // rather than up because the alternative is a migration on the table the e-mail sync keys on —
    // a product decision, not a typo fix. Verified on production before changing it: no account
    // holds more than one connection, so nobody loses a limit they already had (§5.5.1).
    plus: 2,
    unit: "actief",
    perMonth: false,
    onExceed: "Een extra mailbox koppelen vraagt Plus.",
  },
  {
    key: "administrations",
    label: "Ondernemingen (administraties) per account",
    free: 1,
    plus: 3,
    unit: "actief",
    perMonth: false,
    onExceed: "Een tweede onderneming in hetzelfde account vraagt Plus.",
  },
] as const;

/** Wat NOOIT onder een grens valt. Staat hier zodat het niet per ongeluk verdwijnt. */
export const ALWAYS_FREE: readonly string[] = [
  "Je eigen gegevens inzien, zoeken en doorlopen — ongeacht hoeveel het er zijn",
  "Alles exporteren (CSV, UBL, PDF, volledige accountexport)",
  "Je boekhouder toegang geven en het kwartaal met hem delen",
  // [BOEKHOUDER-GRENS] Het PORTAAL kent sinds §5.8 een grens (ACCOUNTANT_FREE_CLIENTS). Wat
  // hier onbegrensd blijft is het delen zelf: een bestaande koppeling wordt nooit geraakt, en
  // boven de grens pauzeert alleen het KOPPELEN van een nieuwe klant — nooit de toegang tot
  // wie er al is. Dat is dezelfde regel als toezegging 3 hierboven.
  "Toegang tot klanten die al aan je gekoppeld zijn — ongeacht hoeveel het er zijn",
  "Betalingen registreren, bankafschriften afletteren en je BTW-overzicht berekenen",
  "Beveiliging: inloggen, wachtwoord herstellen, account verwijderen",
];

export type UsageCounts = Partial<Record<FairUseKey, number>>;

export interface FairUseStatus {
  /** Alle grenzen gerespecteerd. */
  withinLimits: boolean;
  /** Grenzen die (over)schreden zijn. */
  exceeded: FairUseKey[];
  /** Grenzen op ≥80% — hier hoort een waarschuwing bij, geen blokkade. */
  nearLimit: FairUseKey[];
}

/** Zoek een grens op. */
export function fairUseLimit(key: FairUseKey): FairUseLimit {
  const found = FAIR_USE_LIMITS.find((l) => l.key === key);
  if (!found) throw new Error(`[FAIR-USE] onbekende grens: ${key}`);
  return found;
}

/**
 * Toets het verbruik van een gratis account tegen de grenzen.
 *
 * Ontbrekende of onzinnige tellers (NaN, negatief) tellen als 0: bij twijfel is een
 * gebruiker binnen de grens. Iemand blokkeren op een kapotte teller is erger dan een maand
 * te veel weggeven.
 */
export function evaluateFairUse(usage: UsageCounts, plan: "free" | "plus" = "free"): FairUseStatus {
  const exceeded: FairUseKey[] = [];
  const nearLimit: FairUseKey[] = [];

  for (const limit of FAIR_USE_LIMITS) {
    const raw = usage[limit.key];
    const used = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    const ceiling = plan === "plus" ? limit.plus : limit.free;

    // [PROEF-WERKPLEK] 0 = geen plafond, dezelfde afspraak als in fair_use_consume(),
    // limitForPlan() en gateStorage(). Zonder deze regel zou `used > 0` elke Plus-gebruiker met
    // één gelezen document als OVERSCHREDEN aanmerken — het scherm zou rood staan voor precies de
    // klanten die betalen. Bewust vóór de vergelijking, niet erin verstopt.
    if (ceiling <= 0) continue;

    if (used > ceiling) {
      exceeded.push(limit.key);
      continue;
    }

    // "Bijna vol" bestaat alleen bij een grens waar je bíjna aan kunt zitten. Bij een grens
    // van 1 — één mailbox, één onderneming — is er geen tussentoestand: je zit op 0 of je
    // zit erop, en op 1 van 1 zitten is de normale, bedoelde toestand van elke gratis
    // gebruiker. Zonder deze uitzondering kreeg iedereen die zijn mailbox koppelt een
    // waarschuwing die nooit meer weggaat, en een waarschuwing die altijd aan staat is een
    // waarschuwing die niemand meer leest — precies het tegenovergestelde van regel 4
    // ("waarschuwen vóórdat het gebeurt, niet erna").
    if (ceiling > 1 && used >= ceiling * NEAR_LIMIT_RATIO) nearLimit.push(limit.key);
  }

  return { withinLimits: exceeded.length === 0, exceeded, nearLimit };
}

/** Leesbare weergave van een grens: "5 per maand", "50 MB", of de zin voor "geen plafond". */
export function formatLimit(limit: FairUseLimit, plan: "free" | "plus"): string {
  const value = plan === "plus" ? limit.plus : limit.free;
  // [PROEF-WERKPLEK] 0 betekent overal in dit bestand "geen plafond", en een tabel die daar "0"
  // van maakt publiceert het strengste denkbare getal op de plek waar het ruimste bedoeld is.
  // Deze zin is dus geen opmaak maar de gepubliceerde grens zelf — zie de rij hierboven.
  if (value <= 0) return FAIR_USE_NO_CEILING;
  if (limit.unit === "MB") {
    return value >= 1024 ? `${Math.round(value / 1024)} GB` : `${value} MB`;
  }
  return `${value} ${limit.unit}`;
}

/**
 * De grenzentabel als markdown — gebruikt door de pagina /eerlijk-gebruik én door de
 * Algemene Voorwaarden. Zo staat één getal op één plek en kan de gepubliceerde tekst nooit
 * afwijken van wat de app doet.
 */
export function fairUseTableMarkdown(): string {
  const head =
    "| Wat we tellen | Gratis | Plus (€ " +
    PLUS_PRICE_EUR.toFixed(2).replace(".", ",") +
    "/maand) |\n|---|---|---|";
  const rows = FAIR_USE_LIMITS.map(
    (l) => `| ${l.label} | ${formatLimit(l, "free")} | ${formatLimit(l, "plus")} |`,
  );
  return [head, ...rows].join("\n");
}
