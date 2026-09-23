// src/lib/unreadable-delivery.test.ts
// [UPLOAD-TRUTH-1] The failure/crash matrix for "the owner is told, exactly once, eventually".
// Run: npx tsx --test src/lib/unreadable-delivery.test.ts
//
// Every case below is a point at which a process can die or a write can be refused between
//
//     documents.ai_doc_type = 'could_not_read'      (the truth, terminal)
//     notifications.event_key = intake:unreadable:… (the telling, exactly-once)
//
// and the rule each one proves is the same: the telling survives, and the AI reader is never run
// a second time to make it happen.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  deliverUnreadableNotice, repairUnreadableArm, unreadableArmColumns,
} from "./unreadable-delivery"
import { unreadableEventKey } from "./stored-document"
import { DOC_TYPE_COULD_NOT_READ, DOC_TYPE_WACHT_OP_LEZEN } from "./skipped-import"

const OWNER = "11111111-1111-1111-1111-111111111111"
const DOC = "a4f2c95e-31ed-4523-a9fa-6ff9f131af8f"
const NOW = new Date("2026-09-23T10:00:00Z")

type Row = Record<string, unknown>
type Pred = { op: "eq" | "is" | "in" | "not-is"; column: string; value: unknown }

function matches(row: Row, preds: Pred[]): boolean {
  return preds.every((p) => {
    const v = row[p.column]
    if (p.op === "in") return (p.value as unknown[]).includes(v as never)
    if (p.op === "is") return p.value === null ? v == null : v === p.value
    if (p.op === "not-is") return p.value === null ? v != null : v !== p.value
    return v === p.value
  })
}

/** documents, with the predicates of every statement recorded. */
class Docs {
  rows: Row[] = []
  updateError: { message: string } | null = null
  /** [NO-SILENT-EMPTY] A failing READ is its own case: it must never read as "no row matched". */
  selectError: { message: string } | null = null
  updates: Array<{ patch: Row; preds: Pred[] }> = []
  /** Every SELECT's predicates, so a test can prove the revalidation asks the full question. */
  reads: Pred[][] = []

  from = (table: string) => {
    assert.equal(table, "documents")
    const preds: Pred[] = []
    let patch: Row | null = null
    const add = (op: Pred["op"], column: string, value: unknown) => {
      preds.push({ op, column, value })
      return q
    }
    const q = {
      update: (p: Row) => { patch = p; return q },
      select: () => q,
      eq: (c: string, v: unknown) => add("eq", c, v),
      is: (c: string, v: unknown) => add("is", c, v),
      in: (c: string, v: unknown) => add("in", c, v),
      // [UPLOAD-TRUTH-1] `.not(col, "is", null)` — the armed-only predicate, on both the work-list
      // query and the delivery-boundary revalidation.
      not: (c: string, op: string, v: unknown) => {
        assert.equal(op, "is", "only `.not(col, 'is', null)` is modelled")
        return add("not-is", c, v)
      },
      then: <A, B>(ok?: (v: { data: Row[] | null; error: unknown }) => A | PromiseLike<A>, bad?: (e: unknown) => B) =>
        Promise.resolve().then(() => {
          if (patch === null) {
            this.reads.push([...preds])
            if (this.selectError) return { data: null, error: this.selectError }
            return { data: this.rows.filter((r) => matches(r, preds)).map((r) => ({ id: r.id })), error: null }
          }
          this.updates.push({ patch, preds: [...preds] })
          if (this.updateError) return { data: null, error: this.updateError }
          const hit = this.rows.filter((r) => matches(r, preds))
          for (const r of hit) Object.assign(r, patch)
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        }).then(ok as never, bad as never),
    }
    return q
  }
}

/** The notifications table, behaving like the live partial UNIQUE (user_id, event_key). */
function fakeNotify(opts: { fail?: string; onBeforeWrite?: () => void } = {}) {
  const written: Array<{ userId: string; eventKey: string | null | undefined; link: string | null | undefined }> = []
  const pushes: string[] = []
  const notify = async (args: {
    userId: string; title: string; body?: string | null; type: string
    link?: string | null; eventKey?: string | null
  }) => {
    if (opts.fail) return { ok: false as const, error: opts.fail }
    // [UPLOAD-TRUTH-1] The seam for the read-to-insert race: the world changes here, after the
    // revalidation passed and before the notification row exists.
    opts.onBeforeWrite?.()
    const key = args.eventKey ?? null
    if (key && written.some((w) => w.userId === args.userId && w.eventKey === key)) {
      // 23505 on the partial UNIQUE. createNotification returns BEFORE sendPushToUser.
      return { ok: true as const, error: null, duplicate: true }
    }
    written.push({ userId: args.userId, eventKey: key, link: args.link })
    pushes.push(args.title)
    return { ok: true as const, error: null }
  }
  return { notify: notify as never, written, pushes }
}

function armedRow(over: Row = {}): Row {
  return {
    id: DOC, user_id: OWNER, source: "camera",
    ai_doc_type: DOC_TYPE_COULD_NOT_READ,
    intake_retry_after: NOW.toISOString(),
    // [UPLOAD-TRUTH-1] The delivery boundary re-asks the full eligibility question, so the row has
    // to carry the full answer — a fixture missing `trashed` would make every test look ineligible.
    trashed: false,
    invoice_id: null,
    ...over,
  }
}

// ── Case 7: the clean run ─────────────────────────────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] a delivered notice clears the arm and leaves the set for good", async () => {
  const db = new Docs()
  db.rows = [armedRow()]
  const bell = fakeNotify()
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.deepEqual(out, { kind: "delivered" })
  assert.equal(bell.written.length, 1, "one notification row")
  assert.equal(bell.written[0].eventKey, unreadableEventKey(DOC), "keyed on the document alone")
  assert.match(String(bell.written[0].link), /^\/dashboard\/incoming\?onleesbaar=/, "into the recovery door")
  assert.equal(db.rows[0].intake_retry_after, null, "the work list no longer holds it")
})

// ── Case 4: the notification write is refused ─────────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] a refused notification leaves the document ARMED for the next pass", async () => {
  // The hole this whole design closes: a non-blocking failure here used to mean the owner was
  // never told, because the drain's reader never returns to a terminal document.
  const db = new Docs()
  db.rows = [armedRow()]
  const bell = fakeNotify({ fail: "connection reset" })
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.deepEqual(out, { kind: "failed", error: "connection reset" })
  assert.equal(db.rows[0].intake_retry_after, NOW.toISOString(), "still armed — the next pass owns it")
  assert.equal(db.rows[0].ai_doc_type, DOC_TYPE_COULD_NOT_READ, "and the truth is untouched")
  assert.equal(db.updates.length, 0, "a failed telling writes nothing at all")
})

test("[UPLOAD-TRUTH-1] …and the next pass delivers it, with no reader in sight", async () => {
  const db = new Docs()
  db.rows = [armedRow()]
  const failing = fakeNotify({ fail: "down" })
  await deliverUnreadableNotice({ documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: failing.notify } })
  const working = fakeNotify()
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: working.notify },
  })
  assert.deepEqual(out, { kind: "delivered" })
  assert.equal(db.rows[0].intake_retry_after, null)
})

// ── Cases 5 + 6 + 10: told already, arm still set ─────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] a retry after a lost clear tells nobody twice and clears the arm", async () => {
  // Crash between the notification and the clear — or a clear that was refused. The next attempt
  // hits the partial UNIQUE, gets `duplicate`, sends NO second push, and finishes the clear.
  const db = new Docs()
  db.rows = [armedRow()]
  const bell = fakeNotify()
  const first = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.deepEqual(first, { kind: "delivered" })
  // Simulate the clear having been lost: re-arm the row exactly as a crash would have left it.
  db.rows[0].intake_retry_after = NOW.toISOString()

  const second = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.deepEqual(second, { kind: "already_reported" })
  assert.equal(bell.written.length, 1, "exactly one notification event survives")
  assert.equal(bell.pushes.length, 1, "and exactly one push — the refusal returns before the send")
  assert.equal(db.rows[0].intake_retry_after, null, "the arm is cleared on the duplicate too")
})

test("[UPLOAD-TRUTH-1] a clear that fails is reported, not mistaken for a clean run", async () => {
  const db = new Docs()
  db.rows = [armedRow()]
  db.updateError = { message: "deadlock detected" }
  const bell = fakeNotify()
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.deepEqual(out, { kind: "delivered_arm_kept" }, "the owner was told; the bookkeeping was not")
  assert.equal(db.rows[0].intake_retry_after, NOW.toISOString(), "so the next pass will finish it")
})

test("[UPLOAD-TRUTH-1] two workers racing one document produce one event and one push", async () => {
  const db = new Docs()
  db.rows = [armedRow()]
  const bell = fakeNotify()
  const both = await Promise.all([
    deliverUnreadableNotice({ documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify } }),
    deliverUnreadableNotice({ documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify } }),
  ])
  assert.equal(bell.written.length, 1)
  assert.equal(bell.pushes.length, 1)
  assert.equal(both.filter((r) => r.kind === "delivered").length, 1, "one wrote")
  assert.equal(both.filter((r) => r.kind === "already_reported").length, 1, "the other was refused")
})

// ── Case 8: the document moved on ─────────────────────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] the clear is aimed at a could_not_read row and nothing else", async () => {
  // Between the notice and the clear an owner can press "Lees opnieuw" and turn this into an
  // invoice. This write must not land on that row.
  const db = new Docs()
  db.rows = [armedRow()]
  const bell = fakeNotify()
  await deliverUnreadableNotice({ documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify } })
  const clear = db.updates.at(-1)!
  assert.deepEqual(clear.patch, { intake_retry_after: null })
  const on = (c: string) => clear.preds.find((p) => p.column === c)
  assert.deepEqual(on("id"), { op: "eq", column: "id", value: DOC })
  assert.deepEqual(on("user_id"), { op: "eq", column: "user_id", value: OWNER })
  assert.deepEqual(on("ai_doc_type"), { op: "eq", column: "ai_doc_type", value: DOC_TYPE_COULD_NOT_READ })
})

// ── Case 3: the CAS loser / rolling-deploy repair ─────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] the repair arms a terminal row a previous build left unarmed", async () => {
  const db = new Docs()
  db.rows = [armedRow({ intake_retry_after: null })] // the winner armed nothing
  const armed = await repairUnreadableArm({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, now: NOW },
  })
  assert.equal(armed, true)
  assert.equal(db.rows[0].intake_retry_after, NOW.toISOString())
  assert.deepEqual(db.updates[0].patch, unreadableArmColumns(NOW), "the same arm the terminal write uses")
})

test("[UPLOAD-TRUTH-1] the repair carries all four safety predicates", async () => {
  // Each one forbids a specific wrong write. Dropping `intake_retry_after IS NULL` in particular
  // would refresh the date of a document whose owner has already been told, on every pass.
  const db = new Docs()
  db.rows = [armedRow({ intake_retry_after: null })]
  await repairUnreadableArm({ documentId: DOC, userId: OWNER, deps: { pipeline: db, now: NOW } })
  const preds = db.updates[0].preds
  const on = (c: string) => preds.find((p) => p.column === c)
  assert.deepEqual(on("id"), { op: "eq", column: "id", value: DOC })
  assert.deepEqual(on("user_id"), { op: "eq", column: "user_id", value: OWNER })
  assert.deepEqual(on("ai_doc_type"), { op: "eq", column: "ai_doc_type", value: DOC_TYPE_COULD_NOT_READ })
  assert.deepEqual(on("intake_retry_after"), { op: "is", column: "intake_retry_after", value: null })
  const source = on("source")
  assert.equal(source?.op, "in")
  assert.ok(Array.isArray(source?.value) && (source.value as string[]).includes("camera")
    && (source.value as string[]).includes("upload") && !(source.value as string[]).includes("email"))
})

test("[UPLOAD-TRUTH-1] the repair never touches a row that has moved on, or one already armed", async () => {
  for (const [why, row] of [
    ["already armed — the winner did its job", armedRow()],
    ["became an invoice through Lees opnieuw", armedRow({ intake_retry_after: null, ai_doc_type: "invoice" })],
    ["still waiting, not terminal", armedRow({ intake_retry_after: null, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN })],
    ["came in by e-mail", armedRow({ intake_retry_after: null, source: "email" })],
  ] as const) {
    const db = new Docs()
    db.rows = [{ ...row }]
    const before = db.rows[0].intake_retry_after
    const armed = await repairUnreadableArm({ documentId: DOC, userId: OWNER, deps: { pipeline: db, now: NOW } })
    assert.equal(armed, false, `no repair: ${why}`)
    assert.equal(db.rows[0].intake_retry_after, before, `and nothing was written: ${why}`)
  }
})

test("[UPLOAD-TRUTH-1] a repair that cannot write says so instead of claiming the arm", async () => {
  const db = new Docs()
  db.rows = [armedRow({ intake_retry_after: null })]
  db.updateError = { message: "permission denied" }
  assert.equal(await repairUnreadableArm({ documentId: DOC, userId: OWNER, deps: { pipeline: db, now: NOW } }), false)
})

// ── The arm itself ────────────────────────────────────────────────────────────────────────────

test("[UPLOAD-TRUTH-1] the arm is intake_retry_after and nothing else", async () => {
  // intake_pause_reason carries CHECK (… = 'fair_use') and cannot hold a second meaning without a
  // migration. This slice is designed to require none.
  const cols = unreadableArmColumns(NOW)
  assert.deepEqual(Object.keys(cols), ["intake_retry_after"])
  assert.equal(cols.intake_retry_after, NOW.toISOString())
  assert.ok(!("intake_pause_reason" in cols), "never a value the CHECK constraint would refuse")
})

// ── [UPLOAD-TRUTH-1] Case #8, restated honestly: revalidation at the delivery boundary ────────
//
// The first version of this slice claimed case #8 was closed because the WORK LIST filters
// trashed/invoice_id. It does — at selection time. But the owner can act between the list being
// read and one document's delivery running, and a notification cannot be unsent: the guarded
// arm-clear protects the write, and by the time it refuses, the bell has already rung.

test("[UPLOAD-TRUTH-1] a document resolved after selection is NOT notified", async () => {
  for (const [why, mutate] of [
    ["the owner pressed Lees opnieuw and it became an invoice",
      (r: Row) => { r.ai_doc_type = "invoice"; r.invoice_id = "inv-1" }],
    ["the owner threw it away", (r: Row) => { r.trashed = true }],
    ["another worker already delivered and cleared the arm", (r: Row) => { r.intake_retry_after = null }],
  ] as const) {
    const db = new Docs()
    db.rows = [armedRow()]
    mutate(db.rows[0])                       // …after the work list was read, before delivery runs
    const bell = fakeNotify()
    const out = await deliverUnreadableNotice({
      documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
    })
    assert.deepEqual(out, { kind: "no_longer_owed" }, why)
    assert.equal(bell.written.length, 0, `no bell: ${why}`)
    assert.equal(bell.pushes.length, 0, `no push: ${why}`)
    assert.equal(db.updates.length, 0, `and no write at all: ${why}`)
  }
})

test("[UPLOAD-TRUTH-1] the revalidation asks the SAME five questions the work list asks", async () => {
  // A narrower question at the door than in the list would let exactly the rows the list excludes
  // slip through one at a time.
  const db = new Docs()
  db.rows = [armedRow()]
  await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: fakeNotify().notify },
  })
  const preds = db.reads[0]
  const on = (c: string) => preds.find((p) => p.column === c)
  assert.deepEqual(on("id"), { op: "eq", column: "id", value: DOC })
  assert.deepEqual(on("user_id"), { op: "eq", column: "user_id", value: OWNER })
  assert.deepEqual(on("ai_doc_type"), { op: "eq", column: "ai_doc_type", value: DOC_TYPE_COULD_NOT_READ })
  assert.deepEqual(on("intake_retry_after"), { op: "not-is", column: "intake_retry_after", value: null })
  assert.deepEqual(on("trashed"), { op: "eq", column: "trashed", value: false })
  assert.deepEqual(on("invoice_id"), { op: "is", column: "invoice_id", value: null })
  const src = on("source")
  assert.equal(src?.op, "in")
  assert.ok(Array.isArray(src?.value) && (src.value as string[]).includes("camera")
    && (src.value as string[]).includes("upload") && !(src.value as string[]).includes("email"))
})

test("[NO-SILENT-EMPTY] a revalidation that cannot be read is not 'not owed'", async () => {
  // The same lie as the selector's, one level down: `data` is null on a failed read, and `?? []`
  // would make "we could not ask" indistinguishable from "no row matched" — which reads as
  // resolved, drops the document, and is under-delivery. The arm must survive this.
  const db = new Docs()
  db.rows = [armedRow()]
  db.selectError = { message: "statement timeout" }
  const bell = fakeNotify()
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.equal(out.kind, "unavailable", "never 'no_longer_owed' off a read we could not perform")
  assert.equal(bell.written.length, 0)
  assert.equal(db.rows[0].intake_retry_after, NOW.toISOString(), "still armed — the next pass asks again")
  assert.equal(db.updates.length, 0, "and nothing was written")
})

test("[UPLOAD-TRUTH-1] what revalidation does NOT close: the read-to-insert gap", async () => {
  // Stated as a test so the limit is recorded rather than assumed. There is no transaction around
  // the revalidation read and the notification insert, so a document that resolves BETWEEN them is
  // still notified. The fake reproduces exactly that ordering.
  const db = new Docs()
  db.rows = [armedRow()]
  // the owner resolves the document after the check passed and before the row is written
  const bell = fakeNotify({ onBeforeWrite: () => { db.rows[0].ai_doc_type = "invoice" } })
  const out = await deliverUnreadableNotice({
    documentId: DOC, userId: OWNER, deps: { pipeline: db, notify: bell.notify },
  })
  assert.equal(bell.written.length, 1, "the bell DID go out — this window is real and is not claimed closed")
  // What IS guaranteed even here: the guarded clear matched nothing, so no write landed on the
  // row that had become an invoice — and the outcome SAYS the arm was kept rather than pretending
  // to a clean run.
  assert.deepEqual(out, { kind: "delivered_arm_kept" })
  assert.equal(db.rows[0].intake_retry_after, NOW.toISOString(),
    "the clear refused the moved-on row, so nothing was written to the invoice")
  // And it can never be repeated: the row no longer matches the work list, and the event key would
  // refuse a second notification anyway.
  assert.equal(db.rows[0].ai_doc_type, "invoice")
})
