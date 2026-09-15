// src/lib/office-offer.ts
// [GEEN-PROVISIE] What an accounting office gets from BoekBrug — and the one thing it never gets.
// Pure: no I/O, no clock, no price. Run: npx tsx --test src/lib/office-offer.test.ts
//
// The string VALUES here are Dutch because they are rendered verbatim on /voor-boekhouders; the
// same arrangement as belofte.ts and segment-pages.ts, and for the same reason — this is copy, not
// code. Everything a developer reads stays English.
//
// ── WHY A MODULE, AND NOT A PARAGRAPH ON A PAGE ─────────────────────────────────────────────
//
// Every office asks the same question within ten minutes: what do I get for putting my clients in
// here, and what is my cut? The answer to the second half is "there is none", and that answer has
// to be the same in June and in December, from whoever happens to be typing. A sentence on a page
// is not a position — it is one edit away from "let's see what they'll take", and the first office
// that is quietly given a percentage is the day the answer stops being true for the other nine.
//
// So the position lives here, with its reasons attached, and the page renders it. Retired ideas are
// listed too — not out of tidiness, but because the next reader's instinct is to re-open exactly
// the ones that were closed, and re-deciding a question in a place where the reason is invisible is
// how a company ends up paying for its own recommendations.
//
// ── THE POSITION, IN ONE LINE ───────────────────────────────────────────────────────────────
//
// BoekBrug does not pay to be recommended. It pays for work, and it sends work back.
//
// Three arguments hold it up, and the money one is the weakest of the three:
//
//   1. WHAT IT DOES TO THE ADVICE. An office's recommendation is the only thing it sells that
//      cannot be bought elsewhere. A paid recommendation is worth less to the client who receives
//      it — and the client is entitled to ask which of the two reasons was the real one.
//   2. WHAT IT DOES TO US. A commission is a permanent share of every euro, taken before any cost
//      is paid, in a product whose largest variable cost is reading documents. Software that pays
//      for its own distribution is priced as a channel, not as a tool, and it never stops being
//      one. See the arithmetic in accountant-pricing.ts: at its most generous the commission is
//      worth less to the office than the portal it would have to be billed for.
//   3. WHAT IT DOES TO THE PRODUCT. Every euro that leaves as commission is a euro not spent on
//      the reader, the checks and the restore drills — which is what the office was actually
//      asking about when it asked whether this is ready for its clients' data.
//
// None of that is an argument for giving an office nothing. It is an argument for giving it
// something other than a share of the subscription — see OFFICE_GETS.

/** One thing an office gets, and what makes it real rather than a promise. */
export interface OfficeBenefit {
  /** Short heading, as the office reads it. */
  heading: string;
  /** What it is. One or two sentences — this is a landing page, not a contract. */
  body: string;
  /**
   * True when the office has it TODAY, without signing anything and without us building
   * something first. A page that mixes the two reads as a roadmap, and an office that discovers
   * halfway through which half was real stops believing the other half as well.
   */
  availableNow: boolean;
}

/**
 * What an office gets. Ordered by what an office can verify soonest, not by what sells hardest —
 * the free portal is checkable in a minute, the referrals take a quarter.
 */
export const OFFICE_GETS: readonly OfficeBenefit[] = [
  {
    heading: "Het portaal kost je niets",
    body:
      "Alle klanten van je kantoor in één werkbak, met de uitzonderingen bovenaan en de rest stil. " +
      "Wat dat volgens onze eigen staffel zou kosten staat hierboven bij Wat het kost — je betaalt het niet.",
    availableNow: true,
  },
  {
    heading: "De app telt wat ze voor je deed",
    body:
      "Zes soorten handelingen, per klant en per periode die jij kiest. Geen schatting en geen " +
      "urenbelofte: een telling van wat er is gebeurd, met jouw eigen minuten ernaast als je die invult.",
    availableNow: true,
  },
  {
    heading: "Wij betalen voor werk, niet voor een aanbeveling",
    body:
      "Zet je een bestaande administratie over, of doen we samen een migratie? Dat is werk, en werk " +
      "factureer je ons. Wat we niet doen is je betalen voor de zin die je tegen je klant zegt.",
    availableNow: true,
  },
];

/** The thing an office does not get, with the reason that belongs to the office and not to us. */
export const OFFICE_NEVER_GETS = {
  heading: "Een provisie per klant",
  body:
    "Nee — en niet 'nog niet'. Je aanbeveling is het enige dat je verkoopt dat een klant nergens " +
    "anders koopt, en een betaalde aanbeveling is voor hem minder waard dan een onbetaalde. " +
    "Wij willen niet dat je BoekBrug aanraadt omdat je eraan verdient. Wij willen dat je het " +
    "aanraadt omdat het je werk beter maakt.",
} as const;

/**
 * The shapes that were considered and closed, each with the reason. Listed in public because an
 * office that has been offered a percentage by four other platforms this month deserves to see
 * that this is a position rather than an oversight — and because the next person to reopen one of
 * these should have to argue with the reason, not with a blank.
 */
export const REJECTED_MODELS: readonly { model: string; reason: string }[] = [
  {
    model: "Provisie per aangebrachte klant",
    reason:
      "Maakt van een adviseur een verkoopkanaal, en van zijn advies iets dat hij moet melden.",
  },
  {
    model: "Marge op het abonnement van de klant",
    reason:
      "Dezelfde afhankelijkheid, alleen minder zichtbaar: de klant betaalt dan meer omdat hij via " +
      "een kantoor binnenkwam, zonder dat hij dat weet.",
  },
  {
    model: "Wederverkoop onder de naam van het kantoor",
    reason:
      "Kan pas als het kantoor de contractpartij wordt — met facturatie, eerstelijns support en een " +
      "eigen plek in de verwerkersketen. Dat is een productbesluit, geen korting.",
  },
];

/**
 * Everything on this page must be true today. Nothing else is a benefit; it is a plan.
 *
 * Exported for the gate rather than for a screen: the page renders OFFICE_GETS as it stands, and
 * this is what keeps a "binnenkort" from ever entering that list. An office reading a promise it
 * cannot check is an office that discounts the checkable ones too.
 */
export function unavailableBenefits(): readonly OfficeBenefit[] {
  return OFFICE_GETS.filter((b) => !b.availableNow);
}
