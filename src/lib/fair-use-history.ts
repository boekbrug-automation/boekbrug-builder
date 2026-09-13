// src/lib/fair-use-history.ts
// [GRENS-BLIJFT] §5.5.1 of the Terms, in code. Pure: no I/O, no clock beyond the one it is handed.
// Run: npx tsx --test src/lib/fair-use-history.test.ts
//
// ── THE PROMISE THIS IMPLEMENTS ─────────────────────────────────────────────────────────────
//
// The Algemene Voorwaarden say, in these words:
//
//   "5.5.1 Een grens die je al hebt, raak je niet meer kwijt. Bestond je account al op de dag dat
//    wij een verlaging van een grens van het eerlijk gebruik aankondigen, dan blijft voor jou de
//    grens gelden die je op dat moment had. Wij verlagen hem daarna niet — niet met aankondiging,
//    niet na een overgangstermijn, niet bij een latere herziening."
//
//   "van een bestaande gebruiker pakken wij een grens **niet af**"
//
// It is a binding clause with three loopholes closed by name, and it had no mechanism whatsoever:
// FAIR_USE_LIMITS is a flat constant, and evaluateFairUse() and limitForPlan() read whatever it
// says today. Lower one `free:` number and every account that already existed silently gets the
// lower one — which is the breach, exactly as the clause describes it.
//
// ── WHAT THE CLAUSE DOES *NOT* PROMISE, SO NOBODY WIDENS IT BY ACCIDENT ─────────────────────
//
// Not the PRICE. §5.5 keeps the ordinary arrangement for tariffs: 30 days' notice by e-mail and
// free cancellation before the effective date. A future reader looking for grandfathered pricing
// will not find it here, because it was never given.
//
// ── ONE RULE, BOTH DIRECTIONS ───────────────────────────────────────────────────────────────
//
// An account is entitled to the HIGHEST of: the limit published today, and every limit that was in
// force at an announcement it lived through. That single sentence covers both cases:
//
//   · a LOWERING — the old, higher value is among the candidates, so the account keeps it;
//   · a RAISE    — today's value is the highest, so the account gets the raise too. The clause
//                  forbids taking away, never giving; an account frozen out of an improvement
//                  would be honouring the letter and breaking the point.
//
// ── WHY THE HISTORY IS CODE AND NOT A TABLE ─────────────────────────────────────────────────
//
// A limit change is announced 30 days ahead by e-mail and happens perhaps once in years. As a
// row it would be editable by whoever holds the database; as a constant it is in git, reviewed,
// and a gate can hold it against the published Terms. The row would also need a writer, a
// permission and an audit trail to be trustworthy — three things, for a list that will hold
// single-digit entries.
//
// ── THE LIST IS EMPTY, AND THAT IS THE RECORD ───────────────────────────────────────────────
//
// No limit has ever been lowered. §5.5.2 says the promise was written while it cost nothing; this
// file is that promise made mechanical at the same moment, before there is a case to bend it
// around. An entry added later is append-only: editing or deleting one would rewrite what an
// existing account is entitled to, which is the breach wearing a different hat.

// TYPE ONLY, and that is load-bearing. fair-use.ts imports the list below at RUNTIME, so a value
// import back the other way would close a cycle between the two modules that define the same rule.
// TypeScript erases this line, leaving one direction: fair-use → fair-use-history.
import type { FairUseKey } from "./fair-use";

/** Which of the two published ceilings a change is about. */
export type LimitPlan = "free" | "plus";

/** One announced change to a published limit. Append-only: never edited, never removed. */
export interface LimitChange {
  key: FairUseKey;
  plan: LimitPlan;
  /**
   * The day the change was ANNOUNCED, ISO "YYYY-MM-DD".
   *
   * The announcement and not the effective date, because that is what §5.5.1 keys on: "bestond je
   * account al op de dag dat wij een verlaging aankondigen". The 30 days between the two exist so
   * somebody can leave; an account created inside that window knew what it was joining.
   */
  announcedOn: string;
  /** The value that was in force UNTIL this announcement — what an older account keeps. */
  was: number;
  /** Why, in words a reader will need in five years. Kept with the number, never in a commit. */
  note: string;
}

/**
 * Every announced change, oldest first.
 *
 * EMPTY. Nothing has ever been announced, and that emptiness is a fact worth keeping visible: it
 * is the difference between "we never lowered a limit" and "we lost track of whether we did".
 */
export const LIMIT_CHANGES: readonly LimitChange[] = [];

/** ISO date → epoch ms at the START of that day (UTC), or null when unreadable. */
function dayMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(String(iso).slice(0, 10));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The ceiling this account is entitled to — the published one, or the better one it kept.
 *
 * `publishedToday` is handed in rather than looked up, so this module never needs the current
 * limits and the two files stay one-directional (see the import note above). fair-use.ts wraps it
 * as entitledLimit(), which is what the rest of the app calls.
 *
 * `accountStartedAt` is profiles.created_at. An account that cannot be dated gets the MOST
 * GENEROUS answer, and that direction is deliberate: the two ways to be wrong are not equal.
 * Reading an unknown date as "new" would quietly withhold a limit the Terms promise — the failure
 * this file exists to prevent, and the one nobody would ever see. Reading it as "old" costs at
 * most what the oldest account costs, and the account demonstrably exists; it simply cannot say
 * since when.
 */
export function keptCeiling(
  key: FairUseKey,
  plan: LimitPlan,
  accountStartedAt: string | null | undefined,
  publishedToday: number,
): number {
  const started = dayMs(accountStartedAt);

  let best = publishedToday;
  for (const change of LIMIT_CHANGES) {
    if (change.key !== key || change.plan !== plan) continue;
    const announced = dayMs(change.announcedOn);
    // An unreadable announcement date counts as "the account lived through it", same generosity
    // rule as above: a broken row in our own list may not cost somebody their ceiling.
    if (announced !== null && started !== null && started > announced) continue;
    if (change.was > best) best = change.was;
  }
  return best;
}
