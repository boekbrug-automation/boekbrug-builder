// src/lib/bank-auto-announce.ts
// [REGEL-DEUR] Which bank lines the screen ANNOUNCES before the auto-confirm pass runs.
//
// This is not a rule and it decides nothing about money. The rule is autoConfirmTier in
// bank-matching.ts; the decision to book is that rule plus applyConfidenceVeto plus
// decideKasAutoBook plus the database guards, and all of it runs on the server. This module
// reads the server's answer and adds the one thing that is genuinely a screen concern.
//
// ── WHY IT IS A MODULE AND NOT THREE LINES IN THE COMPONENT ─────────────────────────────────
//
// Because the three lines it replaces were twenty, and those twenty were a partial copy of the
// tier tree living in the browser. Measured, against the owner it was copying:
//
//   · it did not know the 'supplier_iban' tier — an MT940 line with the supplier's account and
//     no name and no number, which is the exact case that tier was built for;
//   · it did not know the 'prepared' tier — the invoice the owner opened the pay sheet on;
//   · it did not apply the name bar (HIGH_NAME_SIM), the date signal, the identity check, or
//     either contradiction veto.
//
// So it was wrong in BOTH directions, and the direction that cost something was the first one.
// The component fires the auto-confirm pass only when it believes there is something to book;
// a statement whose only bookable payments were supplier_iban- or prepared-tier therefore did
// not fire it at all and waited for the daily cron. That is the same defect [BANK-BATCH-ONLOAD]
// fixed for multi-invoice batches, still open for two tiers, found by measuring rather than by
// anything going red — which is the argument for the module: here it can be run by a test.
//
// ── WHAT THE TIER IS NOT ────────────────────────────────────────────────────────────────────
//
// It is a PREDICTION. applyConfidenceVeto, decideKasAutoBook and the database guards all run
// after it and can only refuse, so a row announced here may still not book. And the pool the
// pass matches over is narrower than the one this answer came from — its batch pass books first
// — so in the one case that is not one-directional, a line can book that was never announced.
// See the note on the field in /api/bank/match/route.ts; it is stated in both places on purpose,
// because a field believed to be the final answer is how a check downstream gets deleted.
//
// A component holds no decision of its own. It renders what it is handed.

import type { AutoConfirmTier } from "./bank-matching";

/** The fields the announcement needs. A superset arrives from /api/bank/match. */
export interface AnnounceableLine {
  /**
   * The server's tier for this line, from /api/bank/match. `null` when no tier would book it.
   *
   * Optional on purpose: a response that predates this field must not read as "everything
   * books". See the positive test in announcesAutoBooking.
   */
  tier?: AutoConfirmTier | null;
  /** [AL-GEBOEKT] The invoice this payment NAMES, when it is already settled. */
  quotedSettled?: unknown | null;
  /** [SOM-KLOPT] Every invoice this payment names, and whether they are all settled. */
  quotedSet?: { fullySettled?: boolean } | null;
}

/**
 * The two tiers, as a runtime set.
 *
 * `s.tier !== null` is the obvious test and it is wrong: `undefined !== null` is true, so a
 * response without the field — an older deploy, an in-flight reply from before a release —
 * would announce EVERY line, including the ones with no candidate at all, and fire the pass on
 * every page load. A missing answer is not a yes.
 */
const BOOKABLE_TIERS: readonly string[] = ["certain", "amount_only"];

/**
 * Does the screen announce this line as one the pass will try to book?
 *
 * Two clauses, and they are different KINDS of thing on purpose:
 *
 *   · the tier is the server's answer, asked and not re-derived;
 *   · the quoted-invoice checks are screen policy. They overlap a server rule — the tiers
 *     already refuse a winner the printed text contradicts, more broadly than this does — but
 *     they are here for what the screen does with the row, not for what the server does with
 *     the money: a payment naming a settled invoice gets the "al geboekt" card instead of a
 *     chooser, and must not be pre-selected or listed as about to be booked.
 */
export function announcesAutoBooking(line: AnnounceableLine): boolean {
  if (line.quotedSettled) return false;
  if (line.quotedSet?.fullySettled === true) return false;
  return typeof line.tier === "string" && BOOKABLE_TIERS.includes(line.tier);
}
