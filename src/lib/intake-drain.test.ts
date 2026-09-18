// src/lib/intake-drain.test.ts
// [ONTVANGEN-DRAIN] What the recovery pass picks up, and what it must leave alone.
//
// Two of these assertions are about money rather than tidiness:
//
//   · `source` is a FILTER. Production holds 549 documents that came in by e-mail, through a
//     pipeline with its own dedup and its own supplier resolution. A drain that selected on state
//     alone would hand one of those to the intake processor every run, forever.
//   · `wacht_op_besluit` waits on a HUMAN, and the reader has already been paid for. Picking it up
//     buys the same answer to the same question, every pass, at our cost.

import { test } from "node:test"
import assert from "node:assert/strict"

import { selectDrainCandidates, runIntakeDrain, DRAIN_BATCH } from "./intake-drain"
import {
  DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET, DOC_TYPE_WACHT_OP_BESLUIT,
  DOC_TYPE_COULD_NOT_READ,
} from "./skipped-import"

const OWNER = "11111111-1111-1111-1111-111111111111"
const NOW = new Date("2026-09-18T10:00:00Z")

type Row = Record<string, unknown>

/** A stand-in for the documents table that applies the filters the statement asks for. */
class Fake {
  rows: Row[] = []
  selectError: { message: string } | null = null
  /** The (column, values) pairs the SELECT filtered on — proof the filters are in the statement. */
  filters: Array<[string, unknown]> = []

  from = (table: string) => {
    assert.equal(table, "documents")
    const self = this as Fake
    const inFilters: Array<[string, unknown[]]> = []
    const q = {
      select: () => q,
      in: (column: string, values: unknown[]) => {
        inFilters.push([column, values])
        self.filters.push([column, values])
        return q
      },
      order: () => q,
      limit: () => q,
      then: <A, B>(ok?: (v: { data: Row[]; error: unknown }) => A | PromiseLike<A>, bad?: (e: unknown) => B) =>
        Promise.resolve().then(() => {
          if (self.selectError) return { data: null, error: self.selectError }
          const hit = self.rows.filter((r) =>
            inFilters.every(([c, vs]) => vs.includes(r[c] as never)))
          // created_at ascending, then id — the deterministic order the pass relies on.
          hit.sort((a, b) =>
            String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
            String(a.id).localeCompare(String(b.id)))
          return { data: hit, error: null }
        }).then(ok as never, bad as never),
    }
    return q
  }
}

function doc(over: Row = {}): Row {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    user_id: OWNER,
    source: "camera",
    ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN,
    intake_retry_after: null,
    created_at: "2026-09-18T09:00:00Z",
    ...over,
  }
}

// ── What is picked up, and what is not ────────────────────────────────────────────────────────

test("[ONTVANGEN-DRAIN] a document waiting on US is picked up", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a" })]
  const picked = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.deepEqual(picked.map((c) => c.documentId), ["a"])
  assert.equal(picked[0].ownerId, OWNER)
})

test("[ONTVANGEN-DRAIN] a document waiting on the OWNER is never picked up", async () => {
  // wacht_op_besluit is a question only a human can answer. Every pass that touched it would pay
  // for the same AI read of the same document and get the same question back.
  const db = new Fake()
  db.rows = [doc({ id: "a", ai_doc_type: DOC_TYPE_WACHT_OP_BESLUIT })]
  assert.deepEqual(await selectDrainCandidates({ pipeline: db, now: NOW }), [])
})

test("[ONTVANGEN-DRAIN] a paused document waits for its date, and then goes", async () => {
  const db = new Fake()
  db.rows = [doc({
    id: "nog-niet", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET,
    intake_retry_after: "2026-10-01T00:00:00Z",
  })]
  assert.deepEqual(
    (await selectDrainCandidates({ pipeline: db, now: NOW })).map((c) => c.documentId), [],
    "before the date, asking again asks the same question of the same full month",
  )
  const later = new Date("2026-10-01T00:00:01Z")
  assert.deepEqual(
    (await selectDrainCandidates({ pipeline: db, now: later })).map((c) => c.documentId), ["nog-niet"],
  )
})

test("[ONTVANGEN-DRAIN] a paused document with no date is left alone rather than guessed at", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: null })]
  assert.deepEqual(await selectDrainCandidates({ pipeline: db, now: NOW }), [])
})

test("[ONTVANGEN-DRAIN] an e-mail attachment is never selected — source is a FILTER", async () => {
  // Measured: 549 of production's documents came in by e-mail. Without this the drain would offer
  // one of them to the intake processor on every single pass, get wrong_door back, and repeat.
  const db = new Fake()
  db.rows = [doc({ id: "mail", source: "email" }), doc({ id: "foto", source: "camera" })]
  const picked = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.deepEqual(picked.map((c) => c.documentId), ["foto"])
  // And it is in the STATEMENT, not a filter applied after fetching them anyway.
  assert.ok(
    db.filters.some(([c, v]) => c === "source" && Array.isArray(v) && v.includes("camera") && v.includes("upload")),
    "the door filter must be part of the query",
  )
  assert.ok(
    db.filters.some(([c, v]) => c === "ai_doc_type" && Array.isArray(v) && !v.includes(DOC_TYPE_WACHT_OP_BESLUIT)),
    "the state filter must be part of the query, and must not include the owner-decision state",
  )
})

test("[ONTVANGEN-DRAIN] a finished or skipped document is not work", async () => {
  const db = new Fake()
  db.rows = [
    doc({ id: "geboekt", ai_doc_type: "invoice" }),
    doc({ id: "bon", ai_doc_type: "receipt" }),
    doc({ id: "onleesbaar", ai_doc_type: DOC_TYPE_COULD_NOT_READ }),
    doc({ id: "overig", ai_doc_type: "other" }),
  ]
  assert.deepEqual(await selectDrainCandidates({ pipeline: db, now: NOW }), [])
})

test("[ONTVANGEN-DRAIN] oldest first, and bounded", async () => {
  const db = new Fake()
  db.rows = Array.from({ length: DRAIN_BATCH + 10 }, (_, i) =>
    doc({ id: `d-${String(i).padStart(3, "0")}`, created_at: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z` }))
  const picked = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.equal(picked.length, DRAIN_BATCH, "a pass that tries to finish everything finishes nothing")
  assert.equal(picked[0].documentId, "d-000", "the longest wait goes first")
  assert.equal(picked[DRAIN_BATCH - 1].documentId, `d-${String(DRAIN_BATCH - 1).padStart(3, "0")}`)
})

test("[ONTVANGEN-DRAIN] a read that fails picks nothing, rather than guessing", async () => {
  const db = new Fake()
  db.rows = [doc()]
  db.selectError = { message: "statement timeout" }
  assert.deepEqual(await selectDrainCandidates({ pipeline: db, now: NOW }), [])
})

// ── The pass itself ───────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN-DRAIN] each document is its own run, and one failure does not stop the rest", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })]
  const seen: string[] = []
  const report = await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async (args: { documentId: string }) => {
      seen.push(args.documentId)
      if (args.documentId === "b") throw new Error("boom")
      return { kind: "processed" as const, outcome: { kind: "json" as const, status: 200, body: {} } }
    }),
  })
  assert.deepEqual(seen, ["a", "b", "c"], "the batch continues past the one that threw")
  assert.equal(report.picked, 3)
  assert.equal(report.outcomes.processed, 2)
  assert.equal(report.outcomes.threw, 1)
})

test("[ONTVANGEN-DRAIN] the drain asks for a retry of a skipped document, from the drain", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a" })]
  const seen: Array<Record<string, unknown>> = []
  await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async (args: Record<string, unknown>) => {
      seen.push(args)
      return { kind: "gone" as const }
    }),
  })
  assert.equal(seen[0].mode, "retry_skipped")
  assert.equal(seen[0].trigger, "drain")
  assert.ok(!("source" in seen[0]), "source is receive identity and comes off the row")
})

test("[ONTVANGEN-DRAIN] the pass writes no 'done' state of its own", async () => {
  // processStoredDocument can answer `resumed` while its tail left the document WAITING — a bell
  // that would not write, a folder it could not resolve. A drain that recorded "handled" off that
  // label would stop picking up a document that is not finished. The row is the only truth.
  const db = new Fake()
  db.rows = [doc({ id: "a" })]
  const before = JSON.stringify(db.rows)
  await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async () => ({ kind: "resumed" as const, invoiceId: "inv-1" })),
  })
  assert.equal(JSON.stringify(db.rows), before, "the drain must not mark the row itself")
})
