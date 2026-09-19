// src/lib/fair-use-pause.test.ts
// [ONTVANGEN] The month's allowance pauses a document. It does not lose it, fail it, or ask
// anything of the owner.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  nextPeriodStart,
  pauseForFairUse,
  pauseIsOver,
  pauseColumns,
  pauseNotice,
  PAUSE_REASON_FAIR_USE,
} from "./fair-use-pause"
import { currentPeriod } from "./fair-use-usage"
import {
  DOC_TYPE_WACHT_OP_LIMIET,
  DOC_TYPE_WACHT_OP_LEZEN,
  DOC_TYPE_COULD_NOT_READ,
  SKIPPED_DOC_TYPES,
  isSkippedDocType,
  isWachtendDocType,
  mayDrainRetry,
  isTimeGatedWait,
} from "./skipped-import"

// ── 7. wacht_op_limiet is never "overgeslagen" ────────────────────────────────────────────────

test("[ONTVANGEN] a paused document is not a skipped one, on any reader", () => {
  // The panel's one job is to admit what came in and was NOT processed. A paused file was
  // processed exactly as far as policy allows, needs nothing from the owner, and will be picked
  // up on its own. Listing it would make that panel cry wolf on a file with nothing wrong with it.
  assert.ok(!SKIPPED_DOC_TYPES.includes(DOC_TYPE_WACHT_OP_LIMIET))
  assert.equal(isSkippedDocType(DOC_TYPE_WACHT_OP_LIMIET), false)
  // It IS a waiting state, so every screen asking "is anything still going on here?" sees it.
  assert.equal(isWachtendDocType(DOC_TYPE_WACHT_OP_LIMIET), true)
})

test("[ONTVANGEN] the four waiting truths stay four different answers", () => {
  // waits on us now · paused by policy · waits on the owner · the read itself failed.
  assert.equal(mayDrainRetry(DOC_TYPE_WACHT_OP_LEZEN), true)
  assert.equal(mayDrainRetry(DOC_TYPE_WACHT_OP_LIMIET), false, "a paused file is not ordinary work")
  assert.equal(isTimeGatedWait(DOC_TYPE_WACHT_OP_LIMIET), true)
  assert.equal(isTimeGatedWait(DOC_TYPE_WACHT_OP_LEZEN), false)
  assert.equal(isSkippedDocType(DOC_TYPE_COULD_NOT_READ), true)
  assert.equal(isSkippedDocType(DOC_TYPE_WACHT_OP_LEZEN), false)
})

// ── The retry moment ──────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN] the retry point is the first instant of the next UTC month — the counter's own boundary", () => {
  // currentPeriod() keys the counter by UTC month. A boundary in any other zone would wake the
  // document against a counter that has not rolled over, wasting the attempt — or leave it paused
  // into a month it could already have been read in.
  assert.equal(nextPeriodStart(new Date("2026-09-18T13:00:00Z")).toISOString(), "2026-10-01T00:00:00.000Z")
  assert.equal(nextPeriodStart(new Date("2026-09-30T23:59:59Z")).toISOString(), "2026-10-01T00:00:00.000Z")
  // December rolls the year, which is the one arithmetic anyone gets wrong.
  assert.equal(nextPeriodStart(new Date("2026-12-31T23:59:59Z")).toISOString(), "2027-01-01T00:00:00.000Z")
  // The instant itself belongs to the NEW period, which is what makes waking at it correct.
  const boundary = nextPeriodStart(new Date("2026-09-18T13:00:00Z"))
  assert.notEqual(currentPeriod(boundary), currentPeriod(new Date("2026-09-18T13:00:00Z")))
  assert.equal(currentPeriod(boundary), "2026-10")
})

test("[ONTVANGEN] the pause carries why and when, and no frozen count", () => {
  const pause = pauseForFairUse("aiDocuments", new Date("2026-09-18T13:00:00Z"))
  assert.deepEqual(pause, {
    reason: PAUSE_REASON_FAIR_USE,
    metric: "aiDocuments",
    retryAfter: "2026-10-01T00:00:00.000Z",
  })
  // A stored `used`/`limit` would be a second source of truth about current usage, and the Fair
  // Use counter is the only one. The state explains WHY this document is paused, nothing more.
  assert.deepEqual(Object.keys(pauseColumns(pause)).sort(), [
    "intake_pause_metric", "intake_pause_reason", "intake_retry_after",
  ])
  assert.ok(!JSON.stringify(pauseColumns(pause)).includes("used"))
})

// ── 4 + 5. The drain waits, and then asks again ───────────────────────────────────────────────

test("[ONTVANGEN] before the retry point the pause holds; at it, the document becomes askable again", () => {
  const retryAfter = "2026-10-01T00:00:00.000Z"
  assert.equal(pauseIsOver(retryAfter, new Date("2026-09-30T23:59:59Z")), false)
  assert.equal(pauseIsOver(retryAfter, new Date("2026-10-01T00:00:00.000Z")), true, "the boundary itself counts")
  assert.equal(pauseIsOver(retryAfter, new Date("2026-10-02T09:00:00Z")), true)
})

test("[ONTVANGEN] a pause whose date we cannot read is eligible, not imprisoned", () => {
  // A file we promised to keep must not stay unread because a timestamp went missing. Asking again
  // costs one refusal and no quota — fair_use_consume does not increment when it says no.
  const now = new Date("2026-09-18T13:00:00Z")
  assert.equal(pauseIsOver(null, now), true)
  assert.equal(pauseIsOver(undefined, now), true)
  assert.equal(pauseIsOver("niet een datum", now), true)
})

// ── 6. The sentence the owner reads ───────────────────────────────────────────────────────────

test("[ONTVANGEN] the notice states three facts and asks nothing", () => {
  const notice = pauseNotice("2026-10-01T00:00:00.000Z")
  assert.match(notice.body, /veilig bewaard/, "the file is safe")
  assert.match(notice.body, /maandlimiet/, "…this is why it waits")
  assert.match(notice.body, /vanaf 1 oktober/, "…and this is when we try again, in Dutch")
  assert.match(notice.body, /niets opnieuw te uploaden/, "…and nothing is being asked of them")

  // "1 vraag voor jou" is reserved for a decision only the owner can make. Borrowing it here would
  // teach them that the phrase sometimes means "no action needed" — and the next time it really is
  // a decision, they would leave it.
  for (const text of [notice.title, notice.body]) {
    assert.doesNotMatch(text, /vraag voor jou/i, "a pause is not a question")
  }
})

test("[ONTVANGEN] an unreadable retry date still produces an honest sentence, never 'vanaf NaN'", () => {
  const notice = pauseNotice("niet een datum")
  assert.doesNotMatch(notice.body, /NaN|Invalid|undefined/)
  assert.match(notice.body, /zodra je limiet weer ruimte heeft/)
})
