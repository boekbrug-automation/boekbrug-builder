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

import {
  selectDrainCandidates, runIntakeDrain, DRAIN_BATCH,
  selectUnreadableNoticeCandidates, NOTICE_BATCH,
  type DrainCandidate, type DrainScan, type DrainReport,
} from "./intake-drain"
import {
  DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET, DOC_TYPE_WACHT_OP_BESLUIT,
  DOC_TYPE_COULD_NOT_READ,
} from "./skipped-import"
// The REAL gate and the REAL loader. Imported rather than restated, so a test cannot agree with
// the drain while both disagree with the processor that actually refuses the work.
import { resumeVerdict, loadStoredDocument, type ProcessMode } from "./stored-document"

const OWNER = "11111111-1111-1111-1111-111111111111"
const NOW = new Date("2026-09-18T10:00:00Z")

type Row = Record<string, unknown>

/** One predicate the statement asked for, recorded so a test can prove it is IN the query. */
type Pred = { op: "in" | "eq" | "is" | "not-is"; column: string; value: unknown }

function matches(row: Row, preds: Pred[]): boolean {
  return preds.every((p) => {
    const v = row[p.column]
    if (p.op === "in") return (p.value as unknown[]).includes(v as never)
    if (p.op === "eq") return v === p.value
    if (p.op === "is") return p.value === null ? v == null : v === p.value
    // not-is null → the column must carry something
    return p.value === null ? v != null : v !== p.value
  })
}

/**
 * A stand-in for the documents table that applies the filters the statement asks for.
 *
 * [UPLOAD-TRUTH-1] It answers UPDATE as well as SELECT now, because the notice pass's safety is in
 * the predicates of a write: an arm repair that dropped `intake_retry_after IS NULL` would re-arm
 * a document whose owner has already been told, on every pass, forever.
 */
class Fake {
  rows: Row[] = []
  selectError: { message: string } | null = null
  /** Set to make the read THROW rather than answer with an error — a different failure, same truth. */
  throwOnSelect: Error | null = null
  updateError: { message: string } | null = null
  /** The (column, values) pairs the SELECT filtered on — proof the filters are in the statement. */
  filters: Array<[string, unknown]> = []
  /** Every predicate of every statement, by operator. */
  preds: Pred[] = []
  /** Each UPDATE: the patch and the predicates it was aimed with. */
  updates: Array<{ patch: Row; preds: Pred[] }> = []
  /**
   * [UPLOAD-TRUTH-1] Every `.order(column, opts)` the statement asked for.
   *
   * The first version of this fake sorted by created_at then id unconditionally and threw
   * `.order()`'s arguments away — so "oldest owed first" was a property of the FAKE, and a
   * selector that asked for no ordering at all, or the wrong one, passed that test. Rows now come
   * back in the order they were given, and the ordering is asserted on what was REQUESTED.
   */
  orders: Array<[string, unknown]> = []

  from = (table: string) => {
    assert.equal(table, "documents")
    const self = this as Fake
    const preds: Pred[] = []
    let patch: Row | null = null
    // [UPLOAD-TRUTH-1] The limit is MODELLED, not ignored. selectDrainCandidates bounds itself in
    // JS after the read; the notice selector bounds itself in the statement, and a fake that drops
    // `.limit()` would let an unbounded pass look bounded.
    let cap: number | null = null

    const add = (op: Pred["op"], column: string, value: unknown) => {
      const p: Pred = { op, column, value }
      preds.push(p)
      self.preds.push(p)
      if (op === "in") self.filters.push([column, value])
      return q
    }

    const run = () => {
      if (patch === null) {
        if (self.throwOnSelect) throw self.throwOnSelect
        if (self.selectError) return { data: null, error: self.selectError }
        // Rows come back in the order they were GIVEN. The fake does not sort: a fake that sorts
        // proves its own ordering, not the statement's.
        const hit = self.rows.filter((r) => matches(r, preds))
        return { data: cap === null ? hit : hit.slice(0, cap), error: null }
      }
      self.updates.push({ patch, preds: [...preds] })
      if (self.updateError) return { data: null, error: self.updateError }
      const hit = self.rows.filter((r) => matches(r, preds))
      for (const r of hit) Object.assign(r, patch)
      return { data: hit.map((r) => ({ id: r.id })), error: null }
    }

    const q = {
      select: () => q,
      update: (p: Row) => { patch = p; return q },
      in: (column: string, values: unknown[]) => add("in", column, values),
      eq: (column: string, value: unknown) => add("eq", column, value),
      is: (column: string, value: unknown) => add("is", column, value),
      not: (column: string, op: string, value: unknown) => {
        assert.equal(op, "is", "only `.not(col, 'is', null)` is modelled")
        return add("not-is", column, value)
      },
      order: (column: string, opts?: unknown) => { self.orders.push([column, opts]); return q },
      limit: (n: number) => { cap = n; return q },
      // loadStoredDocument reads ONE row this way. Modelled so the trash guard can be tested
      // against the real loader rather than against a second copy of its rule.
      maybeSingle: async () => {
        const { data, error } = run() as { data: Row[] | null; error: unknown }
        return { data: (data ?? [])[0] ?? null, error }
      },
      then: <A, B>(ok?: (v: { data: Row[] | null; error: unknown }) => A | PromiseLike<A>, bad?: (e: unknown) => B) =>
        Promise.resolve().then(run).then(ok as never, bad as never),
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
    // [ONTVANGEN-DRAIN] The Fake applies whatever predicates the statement asks for, so a fixture
    // without this column is invisible to a selector that filters on it. Default: not thrown away.
    trashed: false,
    created_at: "2026-09-18T09:00:00Z",
    ...over,
  }
}

/**
 * The candidates of a scan that MUST have succeeded.
 *
 * A helper rather than `(scan as …).candidates`, because the assertion is the point: a selector
 * that regressed to `unavailable` would otherwise read as "picked nothing" in every test below,
 * which is precisely the confusion this batch exists to remove.
 */
function picked(scan: DrainScan): DrainCandidate[] {
  assert.equal(scan.kind, "ok", `the scan was ${scan.kind}, so nothing below is measuring selection`)
  return scan.kind === "ok" ? scan.candidates : []
}

/** The reader half of a report that MUST have scanned. Same reasoning as picked(). */
function readerOf(report: DrainReport): { picked: number; outcomes: Record<string, number> } {
  assert.equal(report.reader.kind, "scanned", "the reader pass did not scan")
  return report.reader.kind === "scanned" ? report.reader : { picked: -1, outcomes: {} }
}

// ── What is picked up, and what is not ────────────────────────────────────────────────────────

test("[ONTVANGEN-DRAIN] a document waiting on US is picked up", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a" })]
  const got = picked(await selectDrainCandidates({ pipeline: db, now: NOW }))
  assert.deepEqual(got.map((c) => c.documentId), ["a"])
  assert.equal(got[0].ownerId, OWNER)
})

test("[ONTVANGEN-DRAIN] a document waiting on the OWNER is never picked up", async () => {
  // wacht_op_besluit is a question only a human can answer. Every pass that touched it would pay
  // for the same AI read of the same document and get the same question back.
  const db = new Fake()
  db.rows = [doc({ id: "a", ai_doc_type: DOC_TYPE_WACHT_OP_BESLUIT })]
  assert.deepEqual(picked(await selectDrainCandidates({ pipeline: db, now: NOW })), [])
})

test("[ONTVANGEN-DRAIN] a paused document waits for its date, and then goes", async () => {
  const db = new Fake()
  db.rows = [doc({
    id: "nog-niet", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET,
    intake_retry_after: "2026-10-01T00:00:00Z",
  })]
  assert.deepEqual(
    picked(await selectDrainCandidates({ pipeline: db, now: NOW })).map((c) => c.documentId), [],
    "before the date, asking again asks the same question of the same full month",
  )
  const later = new Date("2026-10-01T00:00:01Z")
  assert.deepEqual(
    picked(await selectDrainCandidates({ pipeline: db, now: later })).map((c) => c.documentId), ["nog-niet"],
  )
})

test("[ONTVANGEN-DRAIN] a paused document with no date is left alone rather than guessed at", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "a", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: null })]
  assert.deepEqual(picked(await selectDrainCandidates({ pipeline: db, now: NOW })), [])
})

test("[ONTVANGEN-DRAIN] an e-mail attachment is never selected — source is a FILTER", async () => {
  // Measured: 549 of production's documents came in by e-mail. Without this the drain would offer
  // one of them to the intake processor on every single pass, get wrong_door back, and repeat.
  const db = new Fake()
  db.rows = [doc({ id: "mail", source: "email" }), doc({ id: "foto", source: "camera" })]
  const got = picked(await selectDrainCandidates({ pipeline: db, now: NOW }))
  assert.deepEqual(got.map((c) => c.documentId), ["foto"])
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
  assert.deepEqual(picked(await selectDrainCandidates({ pipeline: db, now: NOW })), [])
})

test("[ONTVANGEN-DRAIN] oldest first, and bounded", async () => {
  const db = new Fake()
  db.rows = Array.from({ length: DRAIN_BATCH + 10 }, (_, i) =>
    doc({ id: `d-${String(i).padStart(3, "0")}`, created_at: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z` }))
  const got = picked(await selectDrainCandidates({ pipeline: db, now: NOW }))
  assert.equal(got.length, DRAIN_BATCH, "a pass that tries to finish everything finishes nothing")
  assert.equal(got[0].documentId, "d-000", "the longest wait goes first")
  // …and the order is what the STATEMENT asked for. The fake no longer sorts, so without this the
  // assertion above would only be reporting the order the fixture happened to be written in.
  assert.deepEqual(db.orders, [
    ["created_at", { ascending: true, nullsFirst: true }],
    ["id", { ascending: true }],
  ], "deterministic order, or a backlog churns instead of draining")
  assert.equal(got[DRAIN_BATCH - 1].documentId, `d-${String(DRAIN_BATCH - 1).padStart(3, "0")}`)
})

test("[NO-SILENT-EMPTY] a failed reader read is not an empty work list", async () => {
  // This test used to assert `[]`, which is the defect written down as a requirement: a timeout
  // and a genuinely empty backlog answered the same thing, and the pass above then reported
  // `picked: 0` over documents nobody had measured.
  const db = new Fake()
  db.rows = [doc()]
  db.selectError = { message: "statement timeout" }
  const scan = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.equal(scan.kind, "unavailable", "a read that failed must never read as a measured zero")
  assert.match(scan.kind === "unavailable" ? scan.error : "", /statement timeout/,
    "and it must carry WHY, or the heartbeat cannot say what was wrong")
})

test("[NO-SILENT-EMPTY] a reader read that THREW is unavailable too", async () => {
  // A throw tells us strictly less than an error does. The old code caught it and returned `[]`,
  // which is the more confident of the two answers.
  const db = new Fake()
  db.rows = [doc()]
  db.throwOnSelect = new Error("socket hang up")
  const scan = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.equal(scan.kind, "unavailable")
  assert.match(scan.kind === "unavailable" ? scan.error : "", /socket hang up/)
})

test("[NO-SILENT-EMPTY] a genuinely empty backlog still reports a measured zero", async () => {
  // The other half, and the reason `unavailable` is a separate arm rather than a pessimistic
  // default: a pass that looked and found nothing has earned `picked: 0`, and must keep saying so.
  const db = new Fake()
  db.rows = []
  const scan = await selectDrainCandidates({ pipeline: db, now: NOW })
  assert.equal(scan.kind, "ok")
  assert.deepEqual(picked(scan), [])

  const report = await runIntakeDrain({ pipeline: db, now: NOW, run: (async () => ({ kind: "gone" as const })) })
  assert.equal(report.reader.kind, "scanned",
    "an honest zero is a zero, and must not be degraded into 'unavailable' by caution")
  assert.equal(readerOf(report).picked, 0)
  assert.deepEqual(readerOf(report).outcomes, {})
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
  const reader = readerOf(report)
  assert.equal(reader.picked, 3)
  assert.equal(reader.outcomes.processed, 2)
  assert.equal(reader.outcomes.threw, 1)
})

test("[ONTVANGEN-DRAIN] the drain asks for the intake pass these documents are waiting for", async () => {
  // ── THE DEFECT THIS PINS ──
  //
  // This assertion used to read `assert.equal(seen[0].mode, "retry_skipped")` — the test wrote the
  // bug down as the requirement. `retry_skipped` is the mode behind the "Lees opnieuw" button, and
  // mayResume("retry_skipped", …) consults SKIPPED_DOC_TYPES, which holds the terminal unreadable
  // states and NOTHING this selector picks. Every candidate the drain handed over came back
  // `not_waiting`. The recovery pass processed nothing, on any document, ever — while the cron log
  // showed `picked: 25` and read like work being done.
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
  assert.equal(seen[0].mode, "fresh_intake",
    "these documents are waiting on their FIRST reading; retry_skipped refuses every one of them")
  assert.equal(seen[0].trigger, "drain")
  assert.ok(!("source" in seen[0]), "source is receive identity and comes off the row")
})

test("[ONTVANGEN-DRAIN] the mode the drain sends is one the REAL gate accepts", async () => {
  // The assertion above pins a string. This one pins the CONSEQUENCE, by putting the production
  // rule between the drain and its outcome: resumeVerdict is imported, not restated, so the two
  // cannot drift into agreeing with each other while disagreeing with the processor.
  //
  // With mode `retry_skipped` every verdict below is "not_waiting" and `processed` is 0 — which is
  // exactly what production did.
  const db = new Fake()
  db.rows = [
    doc({ id: "wacht" }),
    doc({ id: "gepauzeerd-voorbij", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: "2026-09-18T09:00:00Z" }),
  ]
  const verdicts: string[] = []
  const report = await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async (args: { documentId: string; mode: ProcessMode }) => {
      const row = db.rows.find((r) => r.id === args.documentId)!
      // The real rule, applied to the real row, with the mode the drain really chose.
      const verdict = resumeVerdict(args.mode, row.ai_doc_type as string, row.intake_retry_after as string | null, NOW)
      verdicts.push(verdict)
      if (verdict === "not_waiting") return { kind: "not_waiting" as const, state: String(row.ai_doc_type) }
      if (verdict === "paused") return { kind: "paused" as const, until: String(row.intake_retry_after) }
      return { kind: "processed" as const, outcome: { kind: "json" as const, status: 200, body: {} } }
    }),
  })
  assert.deepEqual(verdicts, ["resume", "resume"],
    "a drain whose mode the gate refuses is a recovery pass that recovers nothing")
  assert.equal(readerOf(report).outcomes.processed, 2)
  assert.equal(readerOf(report).outcomes.not_waiting, undefined)
})

test("[ONTVANGEN-DRAIN] a paused document past its date is resumed; before it, it is left paused", async () => {
  // The retry-date rule is not the selector's alone. resumeVerdict applies it again at the
  // execution boundary under `fresh_intake`, and it must keep applying it: a document selected a
  // second before its date, or woken by a plan change that moved the date forward, must still cost
  // nothing. Both halves are asserted against the REAL rule.
  const row = { ai: DOC_TYPE_WACHT_OP_LIMIET, until: "2026-09-18T12:00:00Z" }
  assert.equal(resumeVerdict("fresh_intake", row.ai, row.until, NOW), "paused",
    "before the date, the month's allowance still says no and asking again buys the same refusal")
  assert.equal(resumeVerdict("fresh_intake", row.ai, row.until, new Date("2026-09-18T12:00:01Z")), "resume")

  // And the selector agrees with it, so the two gates cannot disagree about the same document.
  const db = new Fake()
  db.rows = [doc({ id: "p", ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, intake_retry_after: row.until })]
  assert.deepEqual(picked(await selectDrainCandidates({ pipeline: db, now: NOW })).map((c) => c.documentId), [])
  assert.deepEqual(
    picked(await selectDrainCandidates({ pipeline: db, now: new Date("2026-09-18T12:00:01Z") })).map((c) => c.documentId),
    ["p"],
  )
})

// ── Trash safety: at selection, and at execution ──────────────────────────────────────────────

test("[ONTVANGEN-DRAIN] a trashed document is never selected, and the filter is in the STATEMENT", async () => {
  const db = new Fake()
  db.rows = [doc({ id: "weg", trashed: true }), doc({ id: "blijft", trashed: false })]
  const got = picked(await selectDrainCandidates({ pipeline: db, now: NOW }))
  assert.deepEqual(got.map((c) => c.documentId), ["blijft"],
    "reading a document the owner threw away spends a model call nobody is waiting for")
  assert.ok(
    db.preds.some((p) => p.op === "eq" && p.column === "trashed" && p.value === false),
    "the trash filter must be part of the query, not a check applied after fetching the rows anyway",
  )
})

test("[ONTVANGEN-DRAIN] trash BETWEEN the selection and the run does not become a booked invoice", async () => {
  // The selection is not the execution. A pass holds up to DRAIN_BATCH documents and walks them one
  // at a time, each with its own model call — so an owner emptying their incoming folder halfway
  // through is an ordinary event, not a race to dismiss. The guard is loadStoredDocument re-reading
  // `trashed` under the claim, and the real function is what this test calls.
  const db = new Fake()
  db.rows = [doc({ id: "eerst" }), doc({ id: "daarna" })]
  const got = picked(await selectDrainCandidates({ pipeline: db, now: NOW }))
  assert.deepEqual(got.map((c) => c.documentId), ["eerst", "daarna"], "both were eligible when we looked")

  // The owner empties the folder while the first document is being worked on.
  for (const r of db.rows) r.trashed = true

  for (const c of got) {
    const load = await loadStoredDocument(c.documentId, c.ownerId, "fresh_intake", { pipeline: db as never }, NOW)
    assert.equal(load.kind, "gone",
      "a document its owner threw away is gone to this pass — never read, never booked")
  }
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

// ── [UPLOAD-TRUTH-1] The notice pass ──────────────────────────────────────────────────────────
//
// The defect it closes: a stored document reaches terminal `could_not_read`, the file is safe, and
// nothing ever tells its owner. The reader drain may not be widened to cover it — `could_not_read`
// is in SKIPPED_DOC_TYPES, so a candidate handed to processStoredDocument in `retry_skipped` mode
// would be read by the AI again, every pass, on behalf of nobody.

function unread(over: Row = {}): Row {
  return doc({
    ai_doc_type: DOC_TYPE_COULD_NOT_READ,
    intake_retry_after: "2026-09-18T09:30:00Z", // armed = not yet delivered
    trashed: false,
    invoice_id: null,
    ...over,
  })
}

test("[UPLOAD-TRUTH-1] an armed terminal unreadable document is a notice candidate", async () => {
  const db = new Fake()
  db.rows = [unread({ id: "a" })]
  const scan = await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  assert.equal(scan.kind, "ok")
  assert.deepEqual(scan.kind === "ok" ? scan.candidates : null, [{ documentId: "a", ownerId: OWNER }])
})

test("[UPLOAD-TRUTH-1] every predicate is in the STATEMENT, and each one forbids something", async () => {
  const db = new Fake()
  db.rows = [unread({ id: "a" })]
  await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  const has = (op: string, column: string, test: (v: unknown) => boolean) =>
    db.preds.some((p) => p.op === op && p.column === column && test(p.value))

  assert.ok(has("eq", "ai_doc_type", (v) => v === DOC_TYPE_COULD_NOT_READ), "terminal unreadable only")
  assert.ok(has("not-is", "intake_retry_after", (v) => v === null), "armed only — this is what makes the set shrink")
  assert.ok(has("eq", "trashed", (v) => v === false), "never announce a file the owner threw away")
  assert.ok(has("is", "invoice_id", (v) => v === null), "never announce a file that became an invoice")
  assert.ok(
    has("in", "source", (v) => Array.isArray(v) && v.includes("camera") && v.includes("upload") && !v.includes("email")),
    "this door only — the e-mail road has its own registry",
  )
})

test("[UPLOAD-TRUTH-1] a delivered document leaves the set permanently", async () => {
  // The arm is the work list, and delivery clears it. Steady state is an empty selection — not an
  // anti-join that re-examines every could_not_read document ever written.
  const db = new Fake()
  db.rows = [unread({ id: "a", intake_retry_after: null })]
  const scan = await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  assert.deepEqual(scan, { kind: "ok", candidates: [] },
    "an EMPTY work list is a successful answer, and says so")
})

test("[UPLOAD-TRUTH-1] trashed, already-an-invoice and e-mail rows are never announced", async () => {
  const db = new Fake()
  db.rows = [
    unread({ id: "weg", trashed: true }),
    unread({ id: "geboekt", invoice_id: "inv-1" }),
    unread({ id: "mail", source: "email" }),
    unread({ id: "nog-wachtend", ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }),
    unread({ id: "goed" }),
  ]
  const scan = await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  assert.deepEqual(scan.kind === "ok" ? scan.candidates.map((c) => c.documentId) : null, ["goed"])
})

test("[NO-SILENT-EMPTY] a failed candidate read is not an empty work list", async () => {
  // This test asserted the OPPOSITE of its own name in its first version: the selector returned
  // `[]` on a read error and the assertion agreed with it. "Nobody is owed anything" and "we could
  // not find out" are different facts, and the one surface whose whole job is that an outcome is
  // never lost quietly is the last place to collapse them.
  const db = new Fake()
  db.rows = [unread({ id: "a" })]
  db.selectError = { message: "statement timeout" }

  const scan = await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  assert.equal(scan.kind, "unavailable", "a failed read must NOT look like an empty list")
  assert.match(scan.kind === "unavailable" ? scan.error : "", /statement timeout/,
    "…and it must carry why, or the log cannot tell the two apart either")

  // The regression, stated as a value: the two answers are not deep-equal, so a future `return []`
  // in the error arm cannot satisfy both this and the empty-list test above.
  const empty = await selectUnreadableNoticeCandidates({ pipeline: new Fake(), now: NOW })
  assert.notDeepEqual(scan, empty, "an unavailable scan and an empty scan are different values")
})

test("[NO-SILENT-EMPTY] a pass that could not read its work list never reports 'nothing to do'", async () => {
  // picked: 0 is a CLAIM — that nobody was owed anything. A pass whose scan failed has not earned
  // it, and the report shape must make that claim impossible rather than merely discouraged.
  const db = new Fake()
  db.rows = [unread({ id: "a" }), unread({ id: "b" })]
  db.selectError = { message: "connection reset" }
  let delivered = 0
  const report = await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async () => ({ kind: "gone" as const })),
    deliver: (async () => { delivered += 1; return { kind: "delivered" as const } }),
  })
  assert.equal(report.notices.kind, "unavailable", "the pass says it could not find out")
  assert.ok(!("picked" in report.notices), "…and cannot be read as a clean pass over zero documents")
  assert.equal(delivered, 0, "nothing was delivered off a list we never read")
})

test("[UPLOAD-TRUTH-1] oldest owed first, and bounded", async () => {
  const db = new Fake()
  db.rows = Array.from({ length: NOTICE_BATCH + 5 }, (_, i) =>
    unread({ id: `n-${String(i).padStart(3, "0")}`, created_at: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z` }))
  const scan = await selectUnreadableNoticeCandidates({ pipeline: db, now: NOW })
  const picked = scan.kind === "ok" ? scan.candidates : []
  assert.equal(picked.length, NOTICE_BATCH, "bounded in the statement, not by the caller")
  // The ORDER is asserted on what the statement asked the database for. The fake deliberately does
  // not sort — proving ordering against a fake that sorts proves only that the fake sorts.
  assert.deepEqual(db.orders, [
    ["created_at", { ascending: true, nullsFirst: true }],
    ["id", { ascending: true }],
  ], "oldest owed first, then id — a total order, so a capped pass keeps starting with the same rows")
})

test("[UPLOAD-TRUTH-1] terminal unreadable documents are never handed to the reader loop", async () => {
  // The expensive trap: could_not_read is in SKIPPED_DOC_TYPES, so a candidate handed to
  // processStoredDocument in retry_skipped mode is read by the AI again.
  //
  // What this test proves, exactly: with ONLY terminal unreadable documents present, the reader
  // loop receives nothing and the notice loop receives them all. It does NOT prove that the notice
  // loop is incapable of calling a reader — `run` is a dependency only the reader loop reads, so
  // counting it can never show that. The absence of a reader CALL inside the notice loop and
  // inside unreadable-delivery.ts is a source-level guarantee, asserted by the [UPLOAD-TRUTH-1]
  // gates in lifecycle-gates.test.ts. Naming that split here so the two are not confused again.
  const db = new Fake()
  db.rows = [unread({ id: "a" }), unread({ id: "b" })]
  let readerCalls = 0
  const delivered: string[] = []
  const report = await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async () => { readerCalls += 1; return { kind: "gone" as const } }),
    deliver: (async ({ documentId }: { documentId: string }) => {
      delivered.push(documentId)
      return { kind: "delivered" as const }
    }),
  })
  assert.equal(readerCalls, 0, "the reader loop was offered nothing — no paid re-read of a finished document")
  assert.deepEqual(delivered, ["a", "b"], "both owed owners were told")
  assert.deepEqual(report.notices, { kind: "scanned", picked: 2, outcomes: { delivered: 2 } })
  // [NO-SILENT-EMPTY] And the reader half MEASURED its zero rather than failing into one. Without
  // this the test would still pass if the reader scan had collapsed — the notice pass would be
  // vouching for a backlog nobody read, which is the flattening this batch removes.
  assert.deepEqual(readerOf(report), { kind: "scanned", picked: 0, outcomes: {} })
})

test("[UPLOAD-TRUTH-1] one notice that throws does not stop the rest of the pass", async () => {
  const db = new Fake()
  db.rows = [unread({ id: "a" }), unread({ id: "b" }), unread({ id: "c" })]
  const seen: string[] = []
  const report = await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async () => ({ kind: "gone" as const })),
    deliver: (async ({ documentId }: { documentId: string }) => {
      seen.push(documentId)
      if (documentId === "b") throw new Error("boom")
      return { kind: "delivered" as const }
    }),
  })
  assert.deepEqual(seen, ["a", "b", "c"])
  assert.equal(report.notices.kind === "scanned" ? report.notices.outcomes.threw : 0, 1)
  assert.equal(report.notices.kind === "scanned" ? report.notices.outcomes.delivered : 0, 2)
})

test("[UPLOAD-TRUTH-1] the reader loop and the notice loop stay separate sets", async () => {
  // A waiting document is read; a terminal unreadable one is only announced. Neither crosses.
  const db = new Fake()
  db.rows = [doc({ id: "wachtend" }), unread({ id: "onleesbaar" })]
  const read: string[] = []
  const told: string[] = []
  await runIntakeDrain({
    pipeline: db, now: NOW,
    run: (async (args: { documentId: string }) => { read.push(args.documentId); return { kind: "gone" as const } }),
    deliver: (async ({ documentId }: { documentId: string }) => { told.push(documentId); return { kind: "delivered" as const } }),
  })
  assert.deepEqual(read, ["wachtend"], "only the waiting document reaches the reader")
  assert.deepEqual(told, ["onleesbaar"], "only the terminal one is announced")
})
