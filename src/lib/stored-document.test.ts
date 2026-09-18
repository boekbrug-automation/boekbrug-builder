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

// ── [ONTVANGEN-BESLUIT] Asking the owner a question, and asking it about THEIR invoice ──────────
//
// Three things are pinned below, and two of them are about money:
//
//   1. the candidate is proved to be this owner's BEFORE it is written onto their document. The
//      reader finds candidates through an owner-scoped query today, so no live path can point this
//      at a stranger's invoice — which is exactly why the proof has to be here rather than there:
//      the invariant must survive the next caller, not only the current one.
//   2. an unprovable candidate asks NOTHING. Not a question with the candidate quietly dropped:
//      "deze factuur lijkt al te bestaan" beside an invoice the owner cannot see is a question they
//      can only answer wrongly, and one of the two answers deletes their file.
//   3. the transition rings the bell exactly once. The CAS is the authority — a second pass that
//      reads the same state writes nothing and therefore says nothing.

import { holdForDuplicateDecision, duplicateQuestionEventKey } from "./stored-document"

const INV = "44444444-4444-4444-4444-444444444444"

/** Records what was asked of `invoices` and what was written to `documents`, separately. */
class FakeHoldClient {
  /** The invoice rows that exist, by id, with their owner. */
  invoices: Array<{ id: string; receiver_id: string }> = []
  invoiceError: { message: string } | null = null
  invoiceLookups: Array<Array<[string, unknown]>> = []
  docs: Row[] = []
  updateError: { message: string } | null = null
  updates: Array<{ patch: Row; filters: Array<[string, unknown]> }> = []

  from = (table: string) => {
    if (table === "invoices") {
      const filters: Array<[string, unknown]> = []
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
        maybeSingle: async () => {
          this.invoiceLookups.push(filters)
          if (this.invoiceError) return { data: null, error: this.invoiceError }
          const hit = this.invoices.find((i) =>
            filters.every(([c, v]) => (i as unknown as Row)[c] === v))
          return { data: hit ? { id: hit.id } : null, error: null }
        },
      }
      return q
    }
    return {
      update: (patch: Row) => {
        const filters: Array<[string, unknown]> = []
        const builder = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return builder },
          select: async () => {
            this.updates.push({ patch, filters })
            if (this.updateError) return { data: null, error: this.updateError }
            const hit = this.docs.filter((r) => filters.every(([c, v]) => r[c] === v))
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return builder
      },
    }
  }
}

/** A notification writer that records, and can be told to fail. */
function recordingNotify(result: { ok: boolean; error: string | null } = { ok: true, error: null }) {
  const sent: Array<Record<string, unknown>> = []
  const notify = (async (opts: Record<string, unknown>) => { sent.push(opts); return result }) as never
  return { sent, notify }
}

function holdClientWithWaitingDoc(): FakeHoldClient {
  const c = new FakeHoldClient()
  c.docs = [{ id: "doc-1", user_id: USER, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  return c
}

test("[ONTVANGEN-BESLUIT] the candidate is proved to be this owner's before it is written down", async () => {
  const c = holdClientWithWaitingDoc()
  c.invoices = [{ id: INV, receiver_id: USER }]
  const { sent, notify } = recordingNotify()

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })
  assert.equal(held.kind, "held")

  // The proof is a filter on the STATEMENT, not a comparison after the fact: a lookup without
  // receiver_id would return a stranger's invoice and this test would pass on the returned row.
  assert.equal(c.invoiceLookups.length, 1, "the candidate was looked up exactly once")
  assert.ok(c.invoiceLookups[0].some(([col, v]) => col === "id" && v === INV))
  assert.ok(
    c.invoiceLookups[0].some(([col, v]) => col === "receiver_id" && v === USER),
    "without receiver_id in the statement, the FK is the only thing checked — and it is not ownership",
  )
  assert.equal(c.docs[0].duplicate_candidate_invoice_id, INV)
  assert.equal(c.docs[0].ai_doc_type, DOC_TYPE_WACHT_OP_BESLUIT)
  assert.equal(c.docs[0].ai_processed, true, "the read DID run; the reader-quality panel must not count it as a failure")
  assert.equal(sent.length, 1)
})

test("[ONTVANGEN-BESLUIT] a candidate belonging to somebody else asks nothing at all", async () => {
  const c = holdClientWithWaitingDoc()
  c.invoices = [{ id: INV, receiver_id: OTHER }]   // the FK would be satisfied; ownership is not
  const { sent, notify } = recordingNotify()

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })
  assert.equal(held.kind, "failed")

  // Nothing was written: not the state, and above all not the candidate. A question pointing at
  // another administration must not exist on the row for a later pass to find and act on.
  assert.equal(c.updates.length, 0, "the hold must not be attempted once the candidate is unprovable")
  assert.equal(c.docs[0].ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN)
  assert.equal(c.docs[0].duplicate_candidate_invoice_id, undefined)
  assert.equal(sent.length, 0, "and the owner is not asked about an invoice they cannot see")
})

test("[ONTVANGEN-BESLUIT] a candidate we could not verify is refused, not assumed", async () => {
  // A statement timeout is not evidence that the invoice is theirs, and it is not evidence that it
  // is not. Failing closed costs one more pass; failing open writes a question about somebody
  // else's money onto this owner's document.
  const c = holdClientWithWaitingDoc()
  c.invoiceError = { message: "statement timeout" }
  const { sent, notify } = recordingNotify()

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })
  assert.equal(held.kind, "failed")
  assert.equal(c.updates.length, 0)
  assert.equal(sent.length, 0)
})

test("[ONTVANGEN-BESLUIT] a reader that named no candidate still asks its question", async () => {
  // Most useful questions name one. Some do not — and the owner is still being asked about THEIR
  // document, so there is simply nothing to prove ownership of.
  const c = holdClientWithWaitingDoc()
  const { sent, notify } = recordingNotify()

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: null, pipeline: c, notify,
  })
  assert.equal(held.kind, "held")
  assert.equal(c.invoiceLookups.length, 0, "nothing to look up")
  assert.equal(c.docs[0].ai_doc_type, DOC_TYPE_WACHT_OP_BESLUIT)
  assert.equal(sent.length, 1)
})

test("[ONTVANGEN-BESLUIT] the hold cannot be written onto somebody else's document", async () => {
  const c = holdClientWithWaitingDoc()
  c.invoices = [{ id: INV, receiver_id: OTHER }]
  const { sent, notify } = recordingNotify()

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: OTHER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })
  // The candidate IS this caller's; the document is not. Both sides are filtered, so the CAS hits
  // no row and the owner of doc-1 is never told a question they did not get.
  assert.equal(held.kind, "failed")
  assert.equal(c.docs[0].ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN)
  assert.equal(sent.length, 0)
})

test("[ONTVANGEN-MELDING] the transition tells the owner — once, however many passes run", async () => {
  const c = holdClientWithWaitingDoc()
  c.invoices = [{ id: INV, receiver_id: USER }]
  const { sent, notify } = recordingNotify()
  const call = () => holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })

  assert.equal((await call()).kind, "held")
  // Three more passes read a row that is already in wacht_op_besluit. The CAS refuses each one, so
  // no second bell is even attempted — the authority for "a new question" is the write, never a
  // comparison in code that two concurrent workers could both make.
  for (let i = 0; i < 3; i++) assert.equal((await call()).kind, "failed")
  assert.equal(sent.length, 1, "at most one owner-facing question notification per document")

  const bel = sent[0]
  assert.equal(bel.title, "1 vraag voor jou")
  assert.equal(bel.body, "Deze factuur lijkt al te bestaan.")
  assert.equal(bel.link, "/dashboard/incoming")
  assert.equal(bel.userId, USER)
  assert.equal(
    bel.eventKey, duplicateQuestionEventKey("doc-1"),
    "the key is what stops a crash between the bell and the end of the run from asking twice",
  )
})

test("[ONTVANGEN-MELDING] a bell that could not be rung does not undo the question", async () => {
  // Undoing the hold would put the document back in the queue to be READ again — paying for an
  // answer we already have — to avoid a missing line in a list. The question is durable and is
  // already on the screen; the bell is how someone not looking at that screen finds out.
  const c = holdClientWithWaitingDoc()
  c.invoices = [{ id: INV, receiver_id: USER }]
  const { sent, notify } = recordingNotify({ ok: false, error: "notifications unreachable" })

  const held = await holdForDuplicateDecision({
    documentId: "doc-1", userId: USER, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN,
    candidateInvoiceId: INV, pipeline: c, notify,
  })
  assert.equal(held.kind, "held", "financial state is never gated on a notification")
  assert.equal(c.docs[0].ai_doc_type, DOC_TYPE_WACHT_OP_BESLUIT)
  assert.equal(sent.length, 1)
})
