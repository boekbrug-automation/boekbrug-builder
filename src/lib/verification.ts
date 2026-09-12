// src/lib/verification.ts
// [DERDE-BRON] What an outside register said — and the third answer that must never be swallowed.
// Pure: no I/O. Run: npx tsx --test src/lib/verification.test.ts
//
// ── WHY THIS TYPE EXISTS BEFORE ANY CLIENT DOES ─────────────────────────────────────────────
//
// BoekBrug is about to ask outside registers things it cannot answer itself: does this EU VAT
// number belong to a real business (VIES), does this postcode and house number exist (PDOK/BAG),
// is this KvK number a real company. Each of those has an obvious pair of answers and a third one
// that decides whether the feature helps or harms:
//
//     confirmed  — the register said yes, and here is what it holds
//     refused    — the register said no, in so many words
//     unknown    — we could not ask, or the answer was not one we recognise
//
// A boolean cannot hold the third, and every design that tries collapses it into one of the other
// two. Both collapses are damaging in a bookkeeping product:
//
//   · unknown → refused tells an owner his customer's VAT number is wrong because a European
//     service was down. He then re-types a correct number, doubts it, and calls the customer.
//   · unknown → confirmed is worse and quieter: a green tick over a number nobody checked, on an
//     invoice where a wrong VAT number moves who owes the tax.
//
// This is the same rule the reader already follows for amounts it could not ground, and the same
// rule [NO-SILENT-EMPTY] applies to counts: a check that could not run SAYS it could not run.
//
// ── WHY THE SCREEN NEVER SEES A BARE BOOLEAN ────────────────────────────────────────────────
//
// `isConfirmed()` exists so a caller can branch, but the sentence a screen shows comes from
// `verificationLabel()`, which has three answers by construction. A component that renders a tick
// for anything that is "not refused" is the collapse above, written by accident.

/** Which register answered. Free-form on purpose: it is shown to a person, not switched on. */
export type VerificationSource = "VIES" | "PDOK" | "KvK";

export type VerificationOutcome = "confirmed" | "refused" | "unknown";

export interface Verification<T> {
  outcome: VerificationOutcome;
  source: VerificationSource;
  /** What the register holds. Present only when confirmed — there is nothing to hold otherwise. */
  data: T | null;
  /**
   * Why, in Dutch, for the screen. Required for `refused` and `unknown`, because both need to say
   * something, and empty for `confirmed`, where the data IS the answer.
   */
  reason: string | null;
  /** When the answer was obtained, ISO. Injected, never read from a clock in here. */
  checkedAt: string | null;
}

export function confirmed<T>(source: VerificationSource, data: T, checkedAt: string): Verification<T> {
  return { outcome: "confirmed", source, data, reason: null, checkedAt };
}

export function refused<T>(source: VerificationSource, reason: string, checkedAt: string): Verification<T> {
  return { outcome: "refused", source, data: null, reason, checkedAt };
}

/**
 * Could not ask, or did not understand the answer.
 *
 * `checkedAt` is deliberately null: nothing was established, so stamping a time on it would make
 * an unanswered question look like an answered one in any list sorted by "last checked".
 */
export function unknown<T>(source: VerificationSource, reason: string): Verification<T> {
  return { outcome: "unknown", source, data: null, reason, checkedAt: null };
}

/** True only for a real yes. Anything else — including "we could not ask" — is not a yes. */
export function isConfirmed<T>(v: Verification<T> | null | undefined): boolean {
  return v?.outcome === "confirmed";
}

/**
 * The sentence a screen shows. Three answers by construction, so a caller cannot render a tick
 * for "not refused".
 *
 * Dutch, because it is read by the owner; the register's own name is included because "kon niet
 * controleren" without saying WHO could not is a sentence nobody can act on.
 */
export function verificationLabel<T>(v: Verification<T> | null | undefined): string {
  if (!v) return "Nog niet gecontroleerd";
  switch (v.outcome) {
    case "confirmed":
      return `Gecontroleerd bij ${v.source}`;
    case "refused":
      return v.reason ?? `${v.source} kent dit niet`;
    case "unknown":
    default:
      return `Niet gecontroleerd: ${v.reason ?? `${v.source} was niet bereikbaar`}`;
  }
}

/**
 * May this answer be stored as the truth about the record?
 *
 * Only a confirmation may overwrite what the owner typed. A refusal is shown beside his input and
 * a failure is shown as a failure — neither of them may quietly replace an address or a name,
 * because the owner is the one who will be held to what is on the invoice.
 */
export function mayOverwriteInput<T>(v: Verification<T> | null | undefined): boolean {
  return isConfirmed(v);
}
