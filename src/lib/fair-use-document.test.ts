// src/lib/fair-use-document.test.ts
// [ONTVANGEN] One received document costs at most one aiDocument — across crashes, not just
// across caught errors.

import { test } from "node:test"
import assert from "node:assert/strict"
import { reserveAiDocument, releaseAiDocument } from "./fair-use-document"
import { limitForPlan, type UsagePlan } from "./fair-use-usage"

const USER = "11111111-1111-1111-1111-111111111111"
const DOC = "0cbc765a-7244-4722-bbce-dc8e7ecfaeb3"

/**
 * A stand-in for the two RPCs, implementing the SQL's own rules — including the one that matters:
 * the counter and the document marker move in one step, so there is no instant where one has
 * happened and the other has not.
 */
class FakeDb {
  counters: Record<string, number> = {}
  marker: string | null = null
  owned = true
  rpcError: { message: string } | null = null
  throws = false

  async rpc(name: string, args: Record<string, unknown>) {
    if (this.throws) throw new Error("connection reset")
    if (this.rpcError) return { data: null, error: this.rpcError }
    if (!this.owned) return { data: null, error: { message: "[ONTVANGEN] document not found / not owned" } }

    if (name === "fair_use_consume_for_document") {
      const period = String(args.p_period)
      const limit = Number(args.p_limit)
      assert.equal(args.p_metric, undefined, "the RPC takes no metric — the marker cannot represent one")
      if (this.marker !== null) {
        const used = this.counters[this.marker] ?? 0
        return { data: [{ allowed: true, used, remaining: limit > 0 ? Math.max(0, limit - used) : -1, replayed: true }], error: null }
      }
      const current = this.counters[period] ?? 0
      if (limit > 0 && current + 1 > limit) {
        return { data: [{ allowed: false, used: current, remaining: Math.max(0, limit - current), replayed: false }], error: null }
      }
      this.counters[period] = current + 1
      this.marker = period
      return { data: [{ allowed: true, used: current + 1, remaining: limit > 0 ? Math.max(0, limit - current - 1) : -1, replayed: false }], error: null }
    }

    if (name === "fair_use_release_for_document") {
      assert.equal(args.p_metric, undefined, "the release takes no metric either")
      if (this.marker === null) return { data: [{ released: false, period: null }], error: null }
      const p = this.marker
      this.counters[p] = Math.max(0, (this.counters[p] ?? 0) - 1)
      this.marker = null
      return { data: [{ released: true, period: p }], error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  }
}

type Pipe = NonNullable<Parameters<typeof reserveAiDocument>[0]["pipeline"]>
const call = (db: FakeDb, now: Date, plan: UsagePlan = "free") =>
  reserveAiDocument({ userId: USER, documentId: DOC, plan, now, pipeline: db as unknown as Pipe })

const SEPT = new Date("2026-09-18T13:00:00Z")

test("[ONTVANGEN] a crash after the counter moved does not charge the document again", () => {
  // The crash catch/finally cannot see: consume succeeds, the process dies, the drain retries.
  // The marker is written in the SAME transaction as the increment, so the retry finds it.
  const db = new FakeDb()
  return (async () => {
    const first = await call(db, SEPT)
    assert.equal(first.kind, "reserved")
    assert.equal(db.counters["2026-09"], 1)

    // …process dies here. No release, no catch. Now the drain comes back.
    for (let i = 0; i < 4; i++) {
      const again = await call(db, SEPT)
      assert.equal(again.kind, "replayed", "a retry must not be a second charge")
    }
    assert.equal(db.counters["2026-09"], 1, "the month still shows exactly one document")
  })()
})

test("[ONTVANGEN] a retry in a NEW month still does not charge twice", async () => {
  // 30 September: reserved, crash. 1 October: the drain returns. The calendar changing is not a
  // reason to bill the same document again — which is why the PERIOD is stored, not a flag.
  const db = new FakeDb()
  assert.equal((await call(db, new Date("2026-09-30T23:00:00Z"))).kind, "reserved")
  assert.equal(db.counters["2026-09"], 1)

  const october = await call(db, new Date("2026-10-01T00:05:00Z"))
  assert.equal(october.kind, "replayed")
  assert.equal(db.counters["2026-10"], undefined, "October was never touched")
  assert.equal(db.counters["2026-09"], 1)
})

test("[ONTVANGEN] a refusal reserves nothing, so there is nothing to give back", async () => {
  const db = new FakeDb()
  db.counters["2026-09"] = 50 // the free ceiling for aiDocuments
  const r = await call(db, SEPT)
  assert.equal(r.kind, "refused")
  assert.equal(db.marker, null, "no marker…")
  assert.equal(db.counters["2026-09"], 50, "…and the counter did not move")
})

test("[ONTVANGEN] the release gives back the month it was taken in, not the month we are in now", async () => {
  const db = new FakeDb()
  await call(db, new Date("2026-09-30T23:00:00Z"))
  assert.equal(db.counters["2026-09"], 1)

  // The reader failed, but only in October did we get round to saying so.
  const back = await releaseAiDocument({ userId: USER, documentId: DOC, pipeline: db as unknown as Pipe })
  assert.deepEqual(back, { released: true, period: "2026-09" })
  assert.equal(db.counters["2026-09"], 0, "September was made whole…")
  assert.equal(db.counters["2026-10"], undefined, "…and October was never involved")
})

test("[ONTVANGEN] a double release cannot mint free credit", async () => {
  const db = new FakeDb()
  await call(db, SEPT)
  const opts = { userId: USER, documentId: DOC, pipeline: db as unknown as Pipe }
  assert.equal((await releaseAiDocument(opts)).released, true)
  assert.equal((await releaseAiDocument(opts)).released, false, "the second finds no marker")
  assert.equal(db.counters["2026-09"], 0, "and the counter never goes below what was really used")
})

test("[ONTVANGEN] after a release the document may be charged again — it is a fresh read", async () => {
  // Release means "that read never happened". The next attempt is a real read and a real charge.
  const db = new FakeDb()
  await call(db, SEPT)
  await releaseAiDocument({ userId: USER, documentId: DOC, pipeline: db as unknown as Pipe })
  const second = await call(db, SEPT)
  assert.equal(second.kind, "reserved")
  assert.equal(db.counters["2026-09"], 1)
})

test("[ONTVANGEN] the reservation fails OPEN, like every other fair-use door", async () => {
  // A counter we cannot read is not evidence that anyone is over, and refusing on our own outage
  // would stop an owner filing a bill they are legally required to keep.
  const broken = new FakeDb()
  broken.rpcError = { message: "statement timeout" }
  assert.deepEqual(await call(broken, SEPT), { kind: "unavailable" })

  const thrown = new FakeDb()
  thrown.throws = true
  assert.deepEqual(await call(thrown, SEPT), { kind: "unavailable" })
})

test("[ONTVANGEN] a document that is not this owner's reserves nothing", async () => {
  const db = new FakeDb()
  db.owned = false
  assert.deepEqual(await call(db, SEPT), { kind: "unavailable" })
  assert.equal(db.marker, null)
  assert.deepEqual(db.counters, {}, "nobody's counter moved")
})


test("[ONTVANGEN] every plan gets the ceiling limitForPlan says it gets", async () => {
  // The rule already has an owner: free gets the published ceiling, and EVERY paid plan gets 0,
  // which the counter reads as "count, do not bound". Rebuilding it here as
  // `plan === "plus" ? … : free` put boekhouder on the FREE ceiling — a plan that is supposed to
  // have none. The defect was not the branch; it was owning a second copy of someone else's rule.
  const seen: Record<string, number> = {}
  for (const plan of ["free", "plus", "boekhouder"] as UsagePlan[]) {
    const db = new FakeDb()
    const spy = { rpc: async (n: string, a: Record<string, unknown>) => { seen[plan] = Number(a.p_limit); return db.rpc(n, a) } }
    await reserveAiDocument({ userId: USER, documentId: DOC, plan, now: SEPT, pipeline: spy as unknown as Pipe })
  }
  assert.equal(seen.free, limitForPlan("aiDocuments", "free"), "free gets the published ceiling")
  assert.equal(seen.free, 10, "…which is 10 aiDocuments a month")
  assert.equal(seen.plus, 0, "plus is counted, not bounded")
  assert.equal(seen.boekhouder, 0, "and so is boekhouder — the regression this test exists for")
  assert.notEqual(seen.boekhouder, seen.free)
})
