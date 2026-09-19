// src/lib/duplicate-recheck.ts
// [ONTVANGEN-WAAR] How long to keep looking for a question that does not exist yet. Pure.
// Run: npx tsx --test src/lib/duplicate-recheck.test.ts
//
// ── THE LIFECYCLE THAT DID NOT WORK ──────────────────────────────────────────────────────────
//
//   /dashboard/upload is open       → the panel asks once, is handed [], and draws nothing
//   the owner uploads               → "Ontvangen ✓ — BoekBrug verwerkt dit verder."
//   the background reader runs      → it finds a semantic duplicate
//   the document reaches            wacht_op_besluit
//   the panel                       → still shows nothing, and never will
//
// The panel had already loaded its list and had no reason to ask again. So the one question the
// owner can answer appeared on a screen they were not on, while they stood on the screen that had
// just told them everything was fine. The bell rings, but the page in front of them stays silent.
//
// ── WHY THIS IS A WINDOW AND NOT A POLLER ────────────────────────────────────────────────────
//
// The product promise is "you handed it over, your work is done" — not "watch this bar". So there
// is no live job tracking here, and no permanent background traffic: a re-check is armed ONLY by a
// fresh receive-first handoff, it backs off, and it STOPS. Two ways to stop, and the first one is
// the one that usually fires:
//
//   · every document we are waiting on has a question → there is nothing left to discover;
//   · the attempts run out → the window closes and the screen is quiet again.
//
// A document that reads cleanly never produces a question, so the common case runs the window to
// its end and finds nothing. That is the cost, and it is bounded by DELAYS_MS: five small reads of
// one endpoint over about a minute and a half, after an upload, and never otherwise. An interval
// that ran forever would be the same code with the stop condition removed, which is exactly why
// the stop condition lives in a tested module rather than inside a component.
//
// ── THE SHAPE OF THE BACKOFF ─────────────────────────────────────────────────────────────────
//
// Measured, not guessed: the receive leg answered in 3.2s and 4.7s in production, and the READ
// behind it is the work the synchronous road used to make the owner sit through — 29.6s on the
// trace that caused this whole change. So the first look is early enough to feel immediate, the
// last is late enough to still be there when a slow read lands, and the total stays inside the
// minute-and-a-half an owner might plausibly still be looking at the screen.

/** Waits before attempt 1, 2, 3… The length of this list IS the number of attempts. */
export const RECHECK_DELAYS_MS: readonly number[] = [4000, 8000, 15000, 25000, 40000];

/** The whole window, for the comment above and for the test that keeps it honest. */
export const RECHECK_WINDOW_MS: number = RECHECK_DELAYS_MS.reduce((a, b) => a + b, 0);

export interface RecheckState {
  /** How many attempts have COMPLETED. Zero before the first one. */
  attempt: number;
  /** documentIds of fresh receive-first handoffs we are waiting on. */
  awaited: readonly string[];
  /** documentIds that currently carry an open question. */
  answered: readonly string[];
}

/**
 * Keep looking?
 *
 * Nothing awaited is not a reason to look at all — an idle screen must generate no traffic, which
 * is the difference between this and a poller. Everything awaited already answered means the
 * discovery succeeded and there is nothing further to find. And the attempt ceiling is absolute:
 * whatever else is true, the window closes.
 */
export function keepRechecking(state: RecheckState): boolean {
  if (state.awaited.length === 0) return false;
  if (state.attempt >= RECHECK_DELAYS_MS.length) return false;
  const answered = new Set(state.answered);
  return !state.awaited.every((id) => answered.has(id));
}

/**
 * The wait before the NEXT attempt, or null when the window is closed.
 *
 * Reading the delay through the same guard means a caller cannot schedule one more attempt than
 * the guard allows by indexing the array itself — the two could otherwise disagree by one, and an
 * off-by-one here is an extra request nobody asked for.
 */
export function nextRecheckDelayMs(state: RecheckState): number | null {
  if (!keepRechecking(state)) return null;
  return RECHECK_DELAYS_MS[state.attempt] ?? null;
}
