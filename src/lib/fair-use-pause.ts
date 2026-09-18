// src/lib/fair-use-pause.ts
// [ONTVANGEN] The month's allowance is reached — the document is paused, not lost and not failed.
//
// ── WHY A STATE AND NOT A RETRY ──────────────────────────────────────────────────────────────
//
// Until #129 the Fair Use gate refused inside the owner's own request: they uploaded, hit the
// monthly ceiling, and were told immediately — with the count, the limit, the plan, and both ways
// out. Receive-first removes the listener. The owner has been told "Ontvangen — je kunt verder"
// and has closed the tab, so the refusal now happens with nobody watching.
//
// Leaving the row as ordinary waiting work would be technically safe and product-dishonest: the
// owner was told they could carry on, and would then hear nothing while an invoice they may need
// for the aangifte sat unread for weeks. Calling it a read failure would be a lie — we did not
// try and fail, we declined to spend. And retrying it every hour would be pure waste: the counter
// is per calendar month, so nothing an hourly pass does can change the answer.
//
// So: its own state, its own honest sentence, and one date after which the answer can genuinely
// be different.
//
// ── THE GATE REMAINS THE AUTHORITY ───────────────────────────────────────────────────────────
//
// Nothing here decides that a retry will succeed. `retryAfter` says only "before this moment the
// answer cannot have changed". Reaching it means the document becomes eligible to ASK again —
// through the same atomic fair_use_consume that sits immediately before the cost-bearing read.
// The quota gate stays beside the work that spends quota; this module never pre-consumes, never
// reserves, and never infers an allowance from a calendar.

import type { FairUseKey } from "@/lib/fair-use"

/** The one reason this state exists today. A column value, so it is spelled once. */
export const PAUSE_REASON_FAIR_USE = "fair_use" as const

export interface FairUsePause {
  reason: typeof PAUSE_REASON_FAIR_USE
  /** Which allowance ran out — aiDocuments today. */
  metric: FairUseKey
  /** ISO. The first moment at which asking again can give a different answer. */
  retryAfter: string
}

/**
 * The first instant of the next UTC calendar month.
 *
 * UTC because currentPeriod() in fair-use-usage.ts is UTC: the counter's key is the UTC month, so
 * a boundary computed in any other zone would either wake the document early — against a counter
 * that has not rolled over yet, wasting the attempt — or late, leaving it paused into a month it
 * could already have been read in.
 *
 * Date.UTC handles December by rolling the year; month 12 is January of the next year.
 */
export function nextPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

/** What to persist when the gate refuses. Carries why and when — never a stale count. */
export function pauseForFairUse(metric: FairUseKey, now: Date): FairUsePause {
  return {
    reason: PAUSE_REASON_FAIR_USE,
    metric,
    retryAfter: nextPeriodStart(now).toISOString(),
  }
}

/**
 * Has the pause run out?
 *
 * A missing or unreadable timestamp answers TRUE — eligible. A paused document whose date we
 * cannot read would otherwise be paused forever, and "we lost the date" is not a reason to keep a
 * file unread; the gate will refuse again in a second if the month really is still full, which
 * costs one refusal and no quota.
 */
export function pauseIsOver(retryAfter: string | null | undefined, now: Date): boolean {
  if (!retryAfter) return true
  const at = Date.parse(retryAfter)
  return Number.isNaN(at) ? true : at <= now.getTime()
}

/** The columns this state writes. Explicit and typed — never a date inside ai_doc_type or notes. */
export function pauseColumns(pause: FairUsePause): {
  intake_retry_after: string
  intake_pause_reason: string
  intake_pause_metric: string
} {
  return {
    intake_retry_after: pause.retryAfter,
    intake_pause_reason: pause.reason,
    intake_pause_metric: pause.metric,
  }
}

// ── [ONTVANGEN] What the owner hears, once ────────────────────────────────────────────────────

/** Dutch month names for the one sentence that names a date. Content, not code — see AGENTS.md. */
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
] as const

export interface PauseNotice {
  title: string
  body: string
}

/**
 * The single notification sent on entering the paused state.
 *
 * Deliberately NOT "1 vraag voor jou". That phrase is reserved for a decision only the owner can
 * make — a semantic duplicate, where the app genuinely cannot proceed without them. Here there is
 * no question: the file is safe, the date is known, and nothing is being asked. Borrowing the
 * question wording would teach an owner that "1 vraag voor jou" sometimes means "no action
 * needed", and the next time it really is a decision they would leave it.
 *
 * Three facts and no machinery: the file is safe, why it is waiting, and when we try again. The
 * two existing exits — wait, or Plus — are what the screen already offers; this sentence does not
 * repeat them, because /eerlijk-gebruik and the limit modal both say it once already.
 */
export function pauseNotice(retryAfter: string): PauseNotice {
  const at = new Date(retryAfter)
  const when = Number.isNaN(at.getTime())
    ? "zodra je limiet weer ruimte heeft"
    : `vanaf ${at.getUTCDate()} ${MAANDEN[at.getUTCMonth()]}`
  return {
    title: "Ontvangen — lezen wacht op je maandlimiet",
    body:
      `Je document is ontvangen en veilig bewaard. Je maandlimiet voor automatisch lezen is ` +
      `bereikt, dus BoekBrug probeert het ${when} automatisch opnieuw. Je hoeft niets opnieuw te uploaden.`,
  }
}
