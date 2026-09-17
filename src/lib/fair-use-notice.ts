// src/lib/fair-use-notice.ts
// [EERLIJK-GEBRUIK-UITLEG] What the owner is told when the free allowance runs out. Pure, no I/O.
// Run: npx tsx --test src/lib/fair-use-notice.test.ts
//
// ── WHAT WAS WRONG ──
//
// Hitting the monthly limit is the single most consequential thing this app can say to an owner:
// from that moment their documents are stored but no longer read, and every screen they check
// afterwards is missing invoices they believe were processed. It was said as a TOAST — a black
// strip that fades after a few seconds, over the dashboard, competing with two cards behind it.
//
// And the sentence it faded away with was the `onExceed` clause alone:
//
//     "Nieuwe documenten worden nog wel bewaard, maar niet meer automatisch gelezen tot de
//      volgende maand of tot je upgradet. Je kunt ze zelf invullen."
//
// True, and it never says the one thing that makes it comprehensible: THAT A LIMIT WAS REACHED,
// which limit, and where they now stand against it. An owner who reads it in the two seconds it
// exists learns that something stopped working, not why, and not that it will start again.
//
// ── WHAT THIS MODULE IS ──
//
// The content of the replacement, decided once. The screen renders it; it does not compose it.
// Two reasons that matters here specifically:
//
//   · the numbers must agree with /eerlijk-gebruik and with Instellingen › Facturering, which both
//     read FAIR_USE_LIMITS. A hand-written "50 documenten" in a component is a fourth place that
//     can disagree with the published policy, and the policy is a promise;
//   · every metric pauses something DIFFERENT — reading, sending, uploading, connecting — so
//     "what still works" is per-limit and comes from the same table.

import { FAIR_USE_LIMITS, type FairUseKey } from "./fair-use";

/** The 402 body from fair-use-gate.ts, as the browser receives it. */
export interface FairUsePayload {
  reason?: string | null;
  metric?: string | null;
  used?: number | null;
  limit?: number | null;
  plan?: string | null;
  error?: string | null;
  wachten?: string | null;
  upgradeUrl?: string | null;
  beleidUrl?: string | null;
}

export interface FairUseNotice {
  /** Names the event. The toast never did. */
  title: string;
  /** "Je hebt deze maand 10 van de 10 documenten laten lezen." Null when the count is unknown. */
  count: string | null;
  /** What is NOT broken — first, because that is the owner's real question. */
  stillWorks: string;
  /** What pauses, verbatim from the published policy. */
  pauses: string;
  /** When it comes back on its own. */
  resets: string;
  upgradeUrl: string;
  beleidUrl: string;
}

/**
 * Is this response the fair-use gate refusing, rather than any other 402?
 *
 * Keyed on `reason`, never on the HTTP status alone: a payment provider can answer 402 too, and a
 * modal explaining a monthly allowance would be nonsense there.
 */
export function isFairUseRefusal(payload: unknown): payload is FairUsePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { reason?: unknown }).reason === "fair_use"
  );
}

/** What still works while this particular limit is reached. Per metric, because they differ. */
const STILL_WORKS: Record<FairUseKey, string> = {
  aiDocuments:
    "Je documenten komen gewoon binnen en blijven bewaard — er gaat niets verloren. Alleen het " +
    "automatisch uitlezen pauzeert; je kunt de gegevens zelf invullen en alles telt daarna normaal mee.",
  invoicesSent:
    "Je kunt facturen blijven opstellen, opslaan en als PDF downloaden. Alleen versturen vanuit " +
    "BoekBrug pauzeert — je kunt de PDF zelf mailen.",
  storageMb:
    "Alles wat er al staat blijft bereikbaar en kan altijd geëxporteerd worden. Alleen nieuwe " +
    "bestanden uploaden pauzeert.",
  mailboxes: "Je bestaande mailbox blijft gewoon lezen. Alleen een EXTRA mailbox koppelen vraagt Plus.",
  administrations:
    "Je huidige administratie werkt volledig. Alleen een tweede onderneming toevoegen vraagt Plus.",
};

const TITLE: Record<FairUseKey, string> = {
  aiDocuments: "Je gratis documenten voor deze maand zijn op",
  invoicesSent: "Je gratis facturen voor deze maand zijn op",
  storageMb: "Je gratis opslag is vol",
  mailboxes: "Meer mailboxen koppelen vraagt Plus",
  administrations: "Een tweede onderneming vraagt Plus",
};

function isKnownMetric(m: unknown): m is FairUseKey {
  return FAIR_USE_LIMITS.some((l) => l.key === m);
}

/**
 * Build what the modal shows, or null when this is not a fair-use refusal.
 *
 * Degrades rather than guesses. An unknown metric, or a body without the numbers, still produces a
 * usable notice — because the alternative is falling back to the toast this replaces, and a
 * half-explained pause is still better explained than a pause that faded away.
 */
export function fairUseNotice(payload: unknown): FairUseNotice | null {
  if (!isFairUseRefusal(payload)) return null;
  const p = payload;

  const metric = isKnownMetric(p.metric) ? p.metric : null;
  const limitRow = metric ? FAIR_USE_LIMITS.find((l) => l.key === metric)! : null;

  // The count is stated only when BOTH numbers are real. "50 van de 0" or "0 van de 50" would each
  // be a sentence the owner can prove wrong, and one wrong number costs more trust than a missing
  // line does.
  const used = typeof p.used === "number" && Number.isFinite(p.used) ? p.used : null;
  // A missing or nonsensical limit falls back to the PUBLISHED one for the plan the owner is on —
  // not to nothing. The table is the promise; a server that sent 0 is the thing that is wrong, and
  // quoting the published figure is more honest than going silent. Plus falls back to the Plus
  // number, never to the free one they are no longer on.
  const published = limitRow ? (p.plan === "plus" ? limitRow.plus : limitRow.free) : null;
  const limit =
    typeof p.limit === "number" && Number.isFinite(p.limit) && p.limit > 0 ? p.limit : published;

  const count =
    used !== null && limit !== null && limitRow
      ? `Je hebt deze maand ${used} van de ${limit} gebruikt${limitRow.perMonth ? "" : " van je totaal"}.`
      : null;

  return {
    title: metric ? TITLE[metric] : "Je zit aan een grens van het gratis gebruik",
    count,
    stillWorks: metric
      ? STILL_WORKS[metric]
      : "Wat er al is blijft gewoon werken en bereikbaar; alleen deze ene handeling pauzeert.",
    // Verbatim from the published policy, so the screen never says something we did not publish.
    pauses: p.error?.trim() || limitRow?.onExceed || "Deze handeling pauzeert tot de volgende maand.",
    resets:
      p.wachten?.trim() ||
      (limitRow?.perMonth === false
        ? "Deze grens is niet per maand — hij loopt niet vanzelf af."
        : "De teller begint op de 1e van de volgende maand weer bij nul."),
    upgradeUrl: p.upgradeUrl?.trim() || "/prijzen",
    beleidUrl: p.beleidUrl?.trim() || "/eerlijk-gebruik",
  };
}
