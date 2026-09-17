// src/lib/subscription.ts
// [BILLING] Welk plan geldt er voor dit account — puur, geen I/O, geen Stripe, geen Supabase.
//
// ─────────────────────────────────────────────────────────────────────────────
// WAT DEZE MODULE WÉL EN NIET DOET — lees dit voordat je er iets aan toevoegt.
//
// Deze module beantwoordt één vraag: **gelden de ruimere Plus-grenzen voor dit account?**
//
// Zij beantwoordt NIET de vraag "mag dit account de app gebruiken". Die vraag bestaat hier
// niet, en dat is het hele verschil met het billing-experiment waar deze code vandaan komt.
// Daar besliste `decideAccess()` of iemand de app in mocht, met een proefklok, een
// betaalmuur en een read-only Archief voor wie eruit viel. Wij voeren dat model niet:
//
//   • de app is gratis voor de ondernemer en gratis voor zijn boekhouder;
//   • er is geen proefperiode, dus er is niets dat kan aflopen;
//   • overschrijding van het eerlijk gebruik pauzeert alleen de handeling die geld kost
//     (een document laten uitlezen, een factuur versturen) — nooit het inzien, doorzoeken
//     of exporteren van je eigen administratie. Zie de vier regels in src/lib/fair-use.ts.
//
// Daarom zijn `decideAccess`, `trialBanner`, `isArchivePath`/`ARCHIVE_PATHS` en de
// BILLING_ENFORCED-schakelaar hier bewust NIET overgenomen. Er is geen pad in deze app dat
// een gebruiker wegstuurt wegens geld, dus er hoort ook geen functie te bestaan die zoiets
// kan beslissen. Zet die niet terug zonder de voorwaarden §5 en /eerlijk-gebruik mee te
// herschrijven — daar staat het als contractuele toezegging.
//
// WAT ER WEL IS OVERGENOMEN: het normaliseren van de Stripe-status en het rekenen met de
// betaalde periode. Dat is nodig zodra iemand Plus neemt, en het is precies het stuk dat
// nergens van afhangt.
// ─────────────────────────────────────────────────────────────────────────────

/** Genormaliseerde levensloopstatus — spiegelt de CHECK in billing_subscription.sql. */
export type SubscriptionStatus =
  | "none"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "incomplete"
  | "canceled";

/** Het plan dat de grenzen bepaalt. 'boekhouder' betaalt nooit en kent geen grenzen. */
export type Plan = "free" | "plus" | "boekhouder";

/** Wat de planbepaling nodig heeft. Bewust primitieven, inclusief null. */
export type PlanInput = {
  /** profiles.role — 'zzper' | 'accountant' | 'client' | null */
  role: string | null;
  /** profiles.subscription_status — null wanneer de migratie nog niet is toegepast. */
  subscriptionStatus: string | null;
  /** profiles.current_period_end als ISO-string, of null. */
  currentPeriodEnd: string | null;
  /**
   * [TOEKENNING] Tot wanneer een lopende toekenning dit account de Plus-grenzen geeft zonder te
   * betalen — de LAATSTE einddatum van zijn actieve toekenningen, of null als er geen is.
   * `undefined` betekent: de aanroeper heeft er niet naar gekeken (een oud aanroeppad, of de
   * migratie is nog niet toegepast). Beide lezen als "geen toekenning", en dat is de veilige
   * kant: het gratis plan ontzegt niemand zijn gegevens.
   *
   * Een OPEN toekenning (geen einddatum) geeft de aanroeper door als een datum ver in de
   * toekomst? Nee — daarvoor is `grantOpenEnded`. Een verzonnen jaartal 9999 in een datumveld is
   * hoe een rekenfout in datums een factureerfout wordt.
   */
  grantedPlusUntil?: string | null;
  /** Er loopt een toekenning zonder einddatum (bijvoorbeeld een partnerafspraak). */
  grantOpenEnded?: boolean;
  /** Nu, in epoch-ms. Geïnjecteerd zodat tests deterministisch zijn. */
  nowMs: number;
};

export type PlanDecision = {
  plan: Plan;
  /** Waarom — voor de UI en de logs. */
  reason:
    | "boekhouder" // het portaal is gratis, altijd, ongeacht status
    | "active" // betaalt
    | "grace_period" // opgezegd of incasso hapert, maar de betaalde periode loopt nog
    | "toekenning" // [TOEKENNING] een lopende toekenning: welkomstperiode, pilot of verlenging
    | "free"; // het gratis plan — de normale toestand, geen gebrek
};

const MS_PER_DAY = 86_400_000;

/**
 * ISO-tijdstempel naar epoch-ms. null bij null/leeg/onzin — een onleesbare datum mag nooit
 * als "verlopen" lezen.
 */
export function parseTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Hele dagen tot `endMs`, naar boven afgerond, minimaal 0. */
export function daysUntil(endMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endMs - nowMs) / MS_PER_DAY));
}

/**
 * Welk plan geldt er. Puur: zelfde invoer → zelfde uitvoer.
 *
 * ── De faalrichting, expliciet ──
 * Bij twijfel is het antwoord **'free'**, niet 'plus'. Dat lijkt de strenge kant, maar is het
 * niet, en het is de moeite waard om te begrijpen waarom:
 *
 *   • 'free' kost hier niemand toegang. Alles wat er staat blijft leesbaar, doorzoekbaar en
 *     exporteerbaar; alleen twee handelingen die ons per stuk geld kosten pauzeren, en pas
 *     bóven een grens waar een normale kleine onderneming nooit aan komt.
 *   • de tellers zelf falen al open: evaluateFairUse() rekent een ontbrekende, negatieve of
 *     NaN-teller als 0, dus een kapotte meting blokkeert sowieso niemand.
 *
 * De twee vangnetten staan dus achter elkaar, en samen leveren ze het gewenste gedrag: een
 * databasestoring kan iemand hooguit een pauze op één handeling opleveren, nooit een slot op
 * zijn administratie. Draai deze richting niet om zonder dat tweede vangnet mee te wegen.
 */
export function decidePlan(input: PlanInput): PlanDecision {
  const { role, subscriptionStatus, nowMs } = input;
  const periodEnd = parseTimestamp(input.currentPeriodEnd);

  // 1. Het boekhoudersportaal is gratis tot ACCOUNTANT_FREE_CLIENTS gekoppelde klanten; het
  //    tarief daarboven is nog niet vastgesteld en niet geactiveerd (voorwaarden §5.8). Zolang
  //    dat zo is betaalt geen enkele boekhouder. Dit staat als toezegging in de voorwaarden §5
  //    en wordt afgedwongen door een test in fair-use.test.ts.
  //
  //    Anders dan bij een betaalmuur heeft deze vrijstelling GEEN bewijs nodig. Op de
  //    billing-tak moest een boekhouder een bevestigde klantkoppeling hebben, omdat `role`
  //    bij registratie zelf wordt gekozen en dus een gratis-voor-altijd-knop zou zijn. Bij
  //    ons is er niets te ontwijken: de app is toch al gratis. Iemand die ten onrechte
  //    "boekhouder" aanvinkt wint alleen ruimere grenzen, en dat is geen aanval waard.
  if (role === "accountant") {
    return { plan: "boekhouder", reason: "boekhouder" };
  }

  // 2. Betaalt. Het normale geval voor Plus.
  if (subscriptionStatus === "active") {
    return { plan: "plus", reason: "active" };
  }

  // 3. De incasso hapert (past_due) of de inning is gepauzeerd. De kaart is verlopen; de
  //    klant is niet weg. Hem nu terugzetten naar de gratis grenzen is hoe je een
  //    herstelbaar kaartprobleem verandert in een opzegging.
  if (subscriptionStatus === "past_due" || subscriptionStatus === "paused") {
    return { plan: "plus", reason: "grace_period" };
  }

  // 4. Opgezegd, maar Stripe heeft al geïnd voor een periode die nog loopt. Die dagen zijn
  //    betaald, dus die dagen krijgt hij.
  if (periodEnd !== null && periodEnd > nowMs) {
    return { plan: "plus", reason: "grace_period" };
  }

  // 5. [TOEKENNING] Een lopende toekenning: een pilot van een kantoor, een verlenging, een open
  //    toekenning. [LAUNCH-CONTRACT] Niet meer de automatische welkomstperiode — die is ingetrokken
  //    (welcome_grant_retired.sql); wie er een HEEFT, houdt hem. Staat hier en niet hoger om twee redenen: wie betaalt hoort
  //    "active" te lezen en niet "toekenning" (het scherm zou hem anders vertellen dat zijn
  //    periode afloopt terwijl hij een abonnement heeft), en een onleesbare datum mag nooit Plus
  //    opleveren — parseTimestamp geeft dan null en we vallen door naar gratis.
  if (input.grantOpenEnded === true) {
    return { plan: "plus", reason: "toekenning" };
  }
  const grantEnd = parseTimestamp(input.grantedPlusUntil ?? null);
  if (grantEnd !== null && grantEnd > nowMs) {
    return { plan: "plus", reason: "toekenning" };
  }

  // 6. Het gratis plan. Dit is geen straf en geen restcategorie — het is het plan waar dit
  //    product voor gemaakt is en waar de meeste gebruikers permanent op horen te zitten.
  return { plan: "free", reason: "free" };
}

/** De grenzen die gelden. 'boekhouder' kent er geen; die valt buiten evaluateFairUse(). */
export function limitsPlanFor(plan: Plan): "free" | "plus" {
  return plan === "free" ? "free" : "plus";
}

const KNOWN_STATUSES: readonly string[] = [
  "none",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "canceled",
];

/** Is dit een status die wij modelleren? */
export function isKnownStatus(status: string): status is SubscriptionStatus {
  return KNOWN_STATUSES.includes(status);
}

/**
 * Een ruwe Stripe-status naar onze verzameling.
 *
 * Onbekende invoer wordt 'none' — wat decidePlan() vervolgens als 'free' leest. Een
 * onverwachte Stripe-waarde kan dus nooit iets ergers doen dan de gratis grenzen opleggen,
 * en nooit iemand buitensluiten.
 *
 * 'trialing' bestaat bij ons niet als toestand — wij kennen geen proefperiode — maar Stripe
 * kan hem sturen als er ooit een proefperiode op de prijs staat. Dan is hij, net als
 * 'active', gewoon een lopend abonnement.
 */
/**
 * [EERLIJK-WOORD] HIER STOND trialEligible(), en die is met de proefmaand meegegaan.
 *
 * Hij beantwoordde één vraag — "heeft dit account al eens een abonnement gehad?" — om te
 * beslissen of de checkout 30 gratis dagen meegaf. Er is nu niets meer te beslissen: gratis IS
 * de proef, dus iedereen die afrekent rekent af vanaf dag één. Een functie die nog bestaat maar
 * niemand meer aanroept is de volgende die per ongeluk weer wordt aangeroepen.
 *
 * WAT WEL BLIJFT, en dat is geen restant: normalizeStripeStatus hieronder blijft 'trialing'
 * lezen als een lopend abonnement. Wij vragen er niet meer om, maar Stripe kan die status om
 * eigen redenen sturen — een handmatige proef in het dashboard, een coupon, een migratie — en
 * een status die wij niet herkennen valt hier door naar 'none'. Dat zou een BETALENDE klant op
 * het gratis plan zetten. De veilige kant is dus: niet meer aanbieden, wel blijven herkennen.
 */

export function normalizeStripeStatus(raw: string | null | undefined): SubscriptionStatus {
  switch (raw) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
    case "canceled":
      return "canceled";
    default:
      return "none";
  }
}
