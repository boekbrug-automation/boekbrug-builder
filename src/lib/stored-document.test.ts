// src/lib/stored-document.test.ts
// [ONTVANGEN] The processor's inputs, reconstructed from durable state alone.
//
// Two things are being pinned here, and the second is the financial one:
//
//   1. everything the reader needs comes back out of the row and the object — no request, no
//      browser File, no FormData;
//   2. a document that is NOT waiting on us is never picked up again. That is the guard against
//      reading and booking one invoice twice, and it has to hold for a drain that sweeps blindly.

import { test } from "node:test"
import assert from "node:assert/strict"
import { loadStoredDocument, mayResume, type ProcessMode } from "./stored-document"
import {
  DOC_TYPE_WACHT_OP_LEZEN,
  DOC_TYPE_WACHT_OP_BESLUIT,
  DOC_TYPE_COULD_NOT_READ,
  DOC_TYPE_UNSUPPORTED,
} from "./skipped-import"

const USER = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"
const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46])

type Row = Record<string, unknown>

/**
 * A stand-in for the service-role client, which records the filters it was given.
 *
 * The recording is the point of the ownership test: asserting on the returned row would pass just
 * as happily against a query with no user_id filter at all, because the fake would have handed
 * back the only row it holds.
 */
class FakePipeline {
  row: Row | null = null
  selectError: { message: string } | null = null
  selectThrows = false
  downloadError: { message: string } | null = null
  downloadThrows = false
  filters: Array<[string, unknown]> = []
  downloaded: string[] = []

  from() {
    const eq = (column: string, value: unknown) => {
      this.filters.push([column, value])
      return {
        eq,
        maybeSingle: async () => {
          if (this.selectThrows) throw new Error("connection reset")
          if (this.selectError) return { data: null, error: this.selectError }
          // The filters really are applied, so a row belonging to someone else is not returned.
          const owner = this.filters.find(([c]) => c === "user_id")?.[1]
          const match = this.row && (owner === undefined || this.row.user_id === owner)
          return { data: match ? this.row : null, error: null }
        },
      }
    }
    return { select: () => ({ eq }) }
  }

  storage = {
    from: () => ({
      download: async (path: string) => {
        this.downloaded.push(path)
        if (this.downloadThrows) throw new Error("socket hang up")
        if (this.downloadError) return { data: null, error: this.downloadError }
        return { data: new Blob([BYTES]), error: null }
      },
    }),
  }
}

type Deps = Parameters<typeof loadStoredDocument>[3]
const deps = (p: FakePipeline): Deps => ({ pipeline: p as unknown as NonNullable<Deps>["pipeline"] })

function waitingRow(overrides: Row = {}): Row {
  return {
    id: "doc-1",
    user_id: USER,
    file_url: `${USER}/incoming/1758000000000-bon.pdf`,
    file_name: "bon.pdf",
    file_type: "application/pdf",
    ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN,
    content_hash: "abc123",
    intake_paid_method: "kas",
    intake_paid_date: "2026-09-18",
    duplicate_decision: null,
    duplicate_candidate_invoice_id: null,
    ...overrides,
  }
}

const load = (p: FakePipeline, mode: ProcessMode = "fresh_intake", user = USER) =>
  loadStoredDocument("doc-1", user, mode, deps(p))

// ── 1. The inputs come back ───────────────────────────────────────────────────────────────────

test("[ONTVANGEN] the reader's inputs are rebuilt from the row and the object, with no request", async () => {
  const p = new FakePipeline()
  p.row = waitingRow()

  const got = await load(p)
  assert.equal(got.kind, "ready")
  if (got.kind !== "ready") return
  assert.deepEqual(got.doc.buffer, BYTES, "the bytes come from storage, not from a browser")
  assert.equal(got.doc.fileName, "bon.pdf")
  assert.equal(got.doc.fileType, "application/pdf")
  assert.equal(got.doc.contentHash, "abc123")
  // The owner's payment choice survived the tab closing — this is the whole point of the intent.
  assert.deepEqual(got.doc.intent, { paidMethod: "kas", paidDate: "2026-09-18" })
  assert.deepEqual(p.downloaded, [waitingRow().file_url], "and it read the path the row names")
})

test("[ONTVANGEN] a document with no intent loads perfectly well — most have none", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ intake_paid_method: null, intake_paid_date: null })
  const got = await load(p)
  assert.equal(got.kind, "ready")
  if (got.kind !== "ready") return
  assert.deepEqual(got.doc.intent, { paidMethod: null, paidDate: null })
})

// ── 2. Ownership ──────────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN] the owner is a filter the caller supplies, never a fact read off the row", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ user_id: OTHER })

  const got = await load(p, "fresh_intake", USER)
  assert.equal(got.kind, "gone", "someone else's document is not ours to read, and not ours to name")

  // RLS is off on this table, so the filter in the query is the only tenant boundary there is.
  assert.ok(
    p.filters.some(([c, v]) => c === "user_id" && v === USER),
    "the query did not scope to the owner — the row is then reachable by id alone",
  )
  assert.ok(p.filters.some(([c, v]) => c === "id" && v === "doc-1"))
  assert.deepEqual(p.downloaded, [], "and nothing was downloaded on the way to finding out")
})

// ── 3. The double-booking guard ───────────────────────────────────────────────────────────────

/** Every state a finished or otherwise-not-ours-to-touch document can be in. */
const FINISHED_STATES = ["invoice", "receipt", "overig", "reminder", "other", "", null]

test("[ONTVANGEN] a document that is not waiting on us is never picked up again", async () => {
  for (const mode of ["fresh_intake", "retry_skipped"] as const) {
    for (const state of FINISHED_STATES) {
      const p = new FakePipeline()
      p.row = waitingRow({ ai_doc_type: state })
      const got = await load(p, mode)
      assert.equal(got.kind, "not_waiting", `${mode} resumed a document in state "${state}"`)
      assert.deepEqual(p.downloaded, [], "…and it did not even pay for the bytes to find out")
    }
  }
})

test("[ONTVANGEN] a question for the owner is never answered by running again", async () => {
  // The state exists precisely so that a drain does not loop on it forever. Both modes refuse it:
  // more compute does not turn an open owner-decision into a closed one.
  for (const mode of ["fresh_intake", "retry_skipped"] as const) {
    assert.equal(mayResume(mode, DOC_TYPE_WACHT_OP_BESLUIT), false, `${mode} would re-read an open question`)
    const p = new FakePipeline()
    p.row = waitingRow({ ai_doc_type: DOC_TYPE_WACHT_OP_BESLUIT })
    const got = await load(p, mode)
    assert.equal(got.kind, "not_waiting")
    assert.equal(got.kind === "not_waiting" ? got.state : "", DOC_TYPE_WACHT_OP_BESLUIT, "…and says which state it found")
  }
})

test("[ONTVANGEN] the two modes are different work, not two names for one thing", async () => {
  // fresh_intake reads a document for the FIRST time. retry_skipped gives a second chance to one
  // we already tried and failed on — what the "Lees opnieuw" button over the overgeslagen panel
  // offers. Collapsing them would let a sweep re-read every skipped file as if it were new.
  assert.equal(mayResume("fresh_intake", DOC_TYPE_WACHT_OP_LEZEN), true)
  assert.equal(mayResume("retry_skipped", DOC_TYPE_WACHT_OP_LEZEN), false)

  for (const skipped of [DOC_TYPE_COULD_NOT_READ, DOC_TYPE_UNSUPPORTED]) {
    assert.equal(mayResume("retry_skipped", skipped), true, `the second chance must cover ${skipped}`)
    assert.equal(mayResume("fresh_intake", skipped), false, `a first reading must not claim ${skipped}`)
  }
})

// ── 4. The failure kinds stay apart ───────────────────────────────────────────────────────────

test("[ONTVANGEN] no row at all is 'gone' — finished, not retryable", async () => {
  const p = new FakePipeline()
  p.row = null
  assert.equal((await load(p)).kind, "gone")
})

test("[ONTVANGEN] a database that did not answer is retryable, and is NOT 'gone'", async () => {
  // The difference decides whether a document is dropped or picked up again. A read error that
  // read as "gone" would quietly abandon a file the owner was told we had.
  const err = new FakePipeline()
  err.row = waitingRow()
  err.selectError = { message: "statement timeout" }
  assert.deepEqual(await load(err), { kind: "unavailable", where: "row" })

  const thrown = new FakePipeline()
  thrown.row = waitingRow()
  thrown.selectThrows = true
  assert.deepEqual(await load(thrown), { kind: "unavailable", where: "row" })
})

test("[ONTVANGEN] the row says stored and storage says no → that is reported, not retried forever", async () => {
  const p = new FakePipeline()
  p.row = waitingRow()
  p.downloadError = { message: "Object not found" }
  const got = await load(p)
  assert.equal(got.kind, "bytes_missing")
  assert.equal(got.kind === "bytes_missing" ? got.storagePath : "", waitingRow().file_url)
})

test("[ONTVANGEN] storage being unreachable is retryable, and is NOT the same as the bytes being gone", async () => {
  const p = new FakePipeline()
  p.row = waitingRow()
  p.downloadThrows = true
  assert.deepEqual(await load(p), { kind: "unavailable", where: "bytes" })
})

test("[ONTVANGEN] a waiting row with no file is noticed rather than downloaded", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ file_url: null })
  assert.equal((await load(p)).kind, "bytes_missing")
  assert.deepEqual(p.downloaded, [])
})

// ── 5. The owner's duplicate answer travels with the document ─────────────────────────────────

test("[ONTVANGEN] an answered duplicate question is carried, and an unrecognised answer is not guessed at", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ duplicate_decision: "add_anyway", duplicate_candidate_invoice_id: "inv-9" })
  const got = await load(p)
  assert.equal(got.kind, "ready")
  if (got.kind !== "ready") return
  assert.equal(got.doc.duplicateDecision, "add_anyway")
  assert.equal(got.doc.duplicateCandidateInvoiceId, "inv-9")

  const junk = new FakePipeline()
  junk.row = waitingRow({ duplicate_decision: "maybe" })
  const got2 = await load(junk)
  assert.equal(got2.kind === "ready" ? got2.doc.duplicateDecision : "x", null,
    "an answer we do not recognise is no answer — and 'add anyway' is not the safe guess")
})

// ── [ONTVANGEN] The month's allowance: paused, not lost and not failed ────────────────────────

import { DOC_TYPE_WACHT_OP_LIMIET } from "./skipped-import"
import { pauseDocumentForFairUse, wakePausedDocumentsForPlanChange } from "./stored-document"
import { resumeVerdict } from "./stored-document"

/** Records updates the way the real client applies them: filters included, rows returned. */
class FakeUpdater {
  rows: Row[] = []
  updateError: { message: string } | null = null
  updates: Array<{ patch: Row; filters: Array<[string, unknown]>; negated: Array<[string, unknown]> }> = []

  from() {
    return {
      update: (patch: Row) => {
        const filters: Array<[string, unknown]> = []
        const negated: Array<[string, unknown]> = []
        const builder = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return builder },
          neq: (c: string, v: unknown) => { negated.push([c, v]); return builder },
          select: async () => {
            this.updates.push({ patch, filters, negated })
            if (this.updateError) return { data: null, error: this.updateError }
            const hit = this.rows.filter(
              (r) =>
                filters.every(([c, v]) => r[c] === v) &&
                negated.every(([c, v]) => r[c] !== v),
            )
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return builder
      },
    }
  }
}

const updateDeps = (u: FakeUpdater): Deps => ({ pipeline: u as unknown as NonNullable<Deps>["pipeline"] })
const SEPT = new Date("2026-09-18T13:00:00Z")

test("[ONTVANGEN] a refusal pauses the document — it is not lost and not called a read failure", async () => {
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]

  const r = await pauseDocumentForFairUse({
    documentId: "doc-1", userId: USER, metric: "aiDocuments", now: SEPT, deps: updateDeps(u),
  })
  assert.equal(r.kind, "entered")
  assert.equal(r.kind === "entered" ? r.retryAfter : "", "2026-10-01T00:00:00.000Z")

  // The row still exists and still points at its file — nothing was deleted, nothing was skipped.
  const row = u.rows[0]
  assert.equal(row.ai_doc_type, DOC_TYPE_WACHT_OP_LIMIET)
  assert.notEqual(row.ai_doc_type, DOC_TYPE_COULD_NOT_READ, "we did not try and fail; we declined to spend")
  assert.equal(row.intake_pause_reason, "fair_use")
  assert.equal(row.intake_pause_metric, "aiDocuments")
  assert.equal(row.ai_processed, false)
})

test("[ONTVANGEN] the owner is told once — the write decides that, not a comparison in code", async () => {
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  const call = () => pauseDocumentForFairUse({
    documentId: "doc-1", userId: USER, metric: "aiDocuments", now: SEPT, deps: updateDeps(u),
  })

  assert.equal((await call()).kind, "entered", "the first pass moved the state and owes the notice")
  for (let i = 0; i < 3; i++) {
    assert.equal((await call()).kind, "refreshed", "every later pass refreshes the date and tells nobody")
  }

  // The transition update refuses a row already in the state. Two passes that both read
  // "not paused yet" before either writes cannot therefore both be told they transitioned.
  assert.ok(
    u.updates[0].negated.some(([c, v]) => c === "ai_doc_type" && v === DOC_TYPE_WACHT_OP_LIMIET),
    "without the neq, exactly-once is a hope rather than a guarantee",
  )
  assert.ok(u.updates.every((x) => x.filters.some(([c, v]) => c === "user_id" && v === USER)))
})

test("[ONTVANGEN] a month that is full again moves the date forward instead of leaving a stale one", async () => {
  // September's pause said 1 October. Woken on 1 October, refused again: it must now say
  // 1 November. A stale past date would have the drain pick this row up on every single pass.
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" }]
  const again = await pauseDocumentForFairUse({
    documentId: "doc-1", userId: USER, metric: "aiDocuments",
    now: new Date("2026-10-01T00:05:00Z"), deps: updateDeps(u),
  })
  assert.equal(again.kind, "refreshed")
  assert.equal(u.rows[0].intake_retry_after, "2026-11-01T00:00:00.000Z")
})

test("[ONTVANGEN] a pause cannot be written onto someone else's document", async () => {
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: OTHER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  const r = await pauseDocumentForFairUse({
    documentId: "doc-1", userId: USER, metric: "aiDocuments", now: SEPT, deps: updateDeps(u),
  })
  assert.equal(r.kind, "failed")
  assert.equal(u.rows[0].ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN, "…and the row is untouched")
})

test("[ONTVANGEN] a write that did not land is reported, never reported as a transition", async () => {
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  u.updateError = { message: "statement timeout" }
  assert.deepEqual(
    await pauseDocumentForFairUse({
      documentId: "doc-1", userId: USER, metric: "aiDocuments", now: SEPT, deps: updateDeps(u),
    }),
    { kind: "failed" },
  )
})

test("[ONTVANGEN] the drain does not touch a paused document before its date — and never reads it", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" })

  const early = await loadStoredDocument("doc-1", USER, "fresh_intake", deps(p), new Date("2026-09-30T23:59:59Z"))
  assert.equal(early.kind, "paused")
  assert.equal(early.kind === "paused" ? early.until : "", "2026-10-01T00:00:00.000Z")
  assert.deepEqual(p.downloaded, [], "the bytes were not fetched, so no reader could have been invoked")

  // …and it is NOT reported as finished, which would drop it out of the queue for good.
  assert.notEqual(early.kind, "not_waiting")
})

test("[ONTVANGEN] once the date passes, the document is eligible again — and the gate still decides", async () => {
  const p = new FakePipeline()
  p.row = waitingRow({ ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" })

  const late = await loadStoredDocument("doc-1", USER, "fresh_intake", deps(p), new Date("2026-10-01T00:00:00Z"))
  assert.equal(late.kind, "ready", "eligible to ASK again")

  // Eligible is not allowed. Nothing in the loader or the verdict grants allowance; reaching the
  // date only means the answer CAN be different, and fair_use_consume is what answers.
  assert.equal(resumeVerdict("fresh_intake", DOC_TYPE_WACHT_OP_LIMIET, "2026-10-01T00:00:00.000Z", new Date("2026-10-02T00:00:00Z")), "resume")
  assert.equal(resumeVerdict("fresh_intake", DOC_TYPE_WACHT_OP_LIMIET, "2026-10-01T00:00:00.000Z", new Date("2026-09-20T00:00:00Z")), "paused")
  assert.equal(resumeVerdict("fresh_intake", "invoice", null, SEPT), "not_waiting")
})

test("[ONTVANGEN] an upgrade wakes the paused documents early — without reading or spending anything", async () => {
  const u = new FakeUpdater()
  u.rows = [
    { id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" },
    { id: "doc-2", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" },
    { id: "doc-3", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN },
    { id: "doc-4", user_id: OTHER, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-10-01T00:00:00.000Z" },
  ]

  const { woken } = await wakePausedDocumentsForPlanChange({ userId: USER, now: SEPT, deps: updateDeps(u) })
  assert.equal(woken, 2, "only this owner's paused rows")
  assert.equal(u.rows[0].intake_retry_after, SEPT.toISOString())
  assert.equal(u.rows[3].intake_retry_after, "2026-10-01T00:00:00.000Z", "another account is untouched")

  // The state stays what it is: still paused, now merely eligible to ask. The gate is what says
  // yes, and an upgrade is not an allowance.
  assert.equal(u.rows[0].ai_doc_type, DOC_TYPE_WACHT_OP_LIMIET)
  assert.equal(resumeVerdict("fresh_intake", DOC_TYPE_WACHT_OP_LIMIET, SEPT.toISOString(), SEPT), "resume")

  // Nothing is re-announced: a second webhook for the same subscription must not ring the bell.
  const patch = u.updates.at(-1)!.patch
  assert.deepEqual(Object.keys(patch), ["intake_retry_after"], "it moves a date and touches nothing else")
})

test("[ONTVANGEN] a failed wake-up is reported and never claimed as success", async () => {
  const u = new FakeUpdater()
  u.rows = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET }]
  u.updateError = { message: "statement timeout" }
  assert.deepEqual(await wakePausedDocumentsForPlanChange({ userId: USER, now: SEPT, deps: updateDeps(u) }), { woken: 0 })
})
