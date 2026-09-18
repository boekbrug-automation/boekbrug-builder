// src/lib/stored-document-processor.test.ts
// [ONTVANGEN-CRASH] The eight checkpoints: kill the run after each step, run the same document
// again, and prove nothing happened twice.
//
// ── WHAT THIS PROVES, AND WHAT IT DOES NOT ───────────────────────────────────────────────────
//
// The world below is a stand-in for the database that enforces the REAL constraints, not a mock
// that agrees with whatever the code does:
//
//     invoices          partial UNIQUE on document_id           → 23505
//     notifications     partial UNIQUE (user_id, event_key)     → 23505
//     intake_claims     UNIQUE (user_id, claim_key)             → 23505
//     apply_manual_payment                                      → replays on (client_key, user, invoice)
//     documents.intake_ai_counted_period                        → the allowance is charged at most once
//
// The RESUME half is the real code: processStoredDocument claims, loads, finds the invoice and runs
// resumeStoredTail — the path every crash recovery actually takes. The FRESH half is a script that
// performs the same durable writes, in the same order, as the door does on the stored path; what
// keeps that script honest is the [ONTVANGEN-VOLGORDE] gate in lifecycle-gates.test.ts, which reads
// the order out of intake-processor.ts rather than out of this file.
//
// So: this file proves that GIVEN those constraints, a crash at any checkpoint converges to exactly
// one of everything. It does not prove PostgREST behaves like the world below, and it does not
// re-prove the reader.

import { test } from "node:test"
import assert from "node:assert/strict"

import { processStoredDocument } from "./stored-document-processor"
import { autoSettlementKey } from "./settlement-key"
import { autoFinishedEventKey } from "./stored-document"
import { DOC_TYPE_WACHT_OP_LEZEN } from "./skipped-import"
import { STORED_DOCUMENT_CLAIM_TTL_MS } from "./stored-document-claim"

const OWNER = "11111111-1111-1111-1111-111111111111"
const DOCUMENT = "33333333-3333-3333-3333-333333333333"
const PATH = `${OWNER}/incoming/1758000000000-bon.pdf`
/** Older than STORED_DOCUMENT_CLAIM_TTL_MS: the age at which a dead worker's claim may be taken. */
const STALE_MS = STORED_DOCUMENT_CLAIM_TTL_MS + 60_000

// ── The world ─────────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

class Crash extends Error {}

class World {
  documents: Row[] = []
  invoices: Row[] = []
  notifications: Row[] = []
  claims: Row[] = []
  /** Every instalment apply_manual_payment actually made. Length is the money question. */
  payments: Array<{ invoiceId: string; clientKey: string }> = []
  /** usage_counters, as one number: how many aiDocuments this owner has been charged. */
  charged = 0
  blobs = new Map<string, string>()
  readerCalls = 0
  cashReconciles = 0
  bankConfirms = 0
  nextId = 1

  table(name: string): Row[] {
    switch (name) {
      case "documents": return this.documents
      case "invoices": return this.invoices
      case "notifications": return this.notifications
      case "intake_claims": return this.claims
    }
    throw new Error(`the stored pass touched an unexpected table: ${name}`)
  }

  from = (name: string) => {
    const rows = this.table(name)
    const world = this as World
    const build = (op: "select" | "insert" | "update" | "delete", payload?: Row) => {
      const filters: Array<[string, unknown]> = []
      const q = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
        is: (c: string, v: unknown) => { filters.push([c, v]); return q },
        neq: (c: string, v: unknown) => { filters.push([`!${c}`, v]); return q },
        lt: () => q,
        limit: () => q,
        select: () => q,
        maybeSingle: async () => {
          const { data, error } = await q.run()
          return { data: data[0] ?? null, error }
        },
        single: async () => {
          const { data, error } = await q.run()
          return { data: data[0] ?? null, error: error ?? (data.length ? null : { message: "no rows" }) }
        },
        then: <A, B>(ok?: (v: { data: Row[]; error: { code?: string; message?: string } | null }) => A | PromiseLike<A>, bad?: (e: unknown) => B) =>
          q.run().then(ok, bad),
        run: async (): Promise<{ data: Row[]; error: { code?: string; message?: string } | null }> => {
          await Promise.resolve()
          const match = (r: Row) => filters.every(([c, v]) =>
            c.startsWith("!") ? r[c.slice(1)] !== v : (v === null ? (r[c] ?? null) === null : r[c] === v))
          switch (op) {
            case "select": return { data: rows.filter(match), error: null }
            case "update": {
              const hit = rows.filter(match)
              for (const r of hit) Object.assign(r, payload)
              return { data: hit, error: null }
            }
            case "delete": {
              const hit = rows.filter(match)
              for (const r of hit) rows.splice(rows.indexOf(r), 1)
              return { data: hit, error: null }
            }
            case "insert": {
              const row = { ...(payload as Row) }
              if (name === "intake_claims" &&
                  rows.some((r) => r.user_id === row.user_id && r.claim_key === row.claim_key)) {
                return { data: [], error: { code: "23505", message: "duplicate claim" } }
              }
              // The money boundary: one document, at most one invoice.
              if (name === "invoices" && row.document_id != null &&
                  rows.some((r) => r.document_id === row.document_id)) {
                return { data: [], error: { code: "23505", message: "uq_invoices_document_id" } }
              }
              // The bell boundary: one event, at most one row.
              if (name === "notifications" && row.event_key != null &&
                  rows.some((r) => r.user_id === row.user_id && r.event_key === row.event_key)) {
                return { data: [], error: { code: "23505", message: "uq_notifications_event_key" } }
              }
              row.id = row.id ?? `${name}-${world.nextId++}`
              rows.push(row)
              return { data: [row], error: null }
            }
          }
        },
      }
      return q
    }
    return {
      select: () => build("select"),
      insert: (payload: Row) => build("insert", payload),
      update: (payload: Row) => build("update", payload),
      delete: () => build("delete"),
    }
  }

  storage = {
    from: (bucket: string) => {
      assert.equal(bucket, "documents")
      return {
        download: async (path: string) => {
          const body = this.blobs.get(path)
          if (body === undefined) return { data: null, error: { message: "not found" } }
          return { data: new Blob([body]), error: null }
        },
        remove: async (paths: string[]) => {
          // The assertion that matters most on this path, and it is here rather than in a test so
          // that EVERY case below carries it: after "Ontvangen", nothing removes the owner's file.
          assert.fail(`the stored pass removed the owner's file: ${paths.join(", ")}`)
        },
      }
    },
  }

  async rpc(name: string, params: Record<string, unknown>) {
    await Promise.resolve()
    if (name !== "apply_manual_payment") throw new Error(`unexpected rpc: ${name}`)
    const key = params.p_client_key as string
    const invoiceId = params.p_invoice_id as string
    // [EEN-SCHRIJFPAD] The replay rule, as the RPC has it: the same key against the same money is
    // answered, not applied. Nothing moves, and nothing fails.
    if (this.payments.some((p) => p.clientKey === key && p.invoiceId === invoiceId)) {
      return { data: [{ replayed: true }], error: null }
    }
    this.payments.push({ invoiceId, clientKey: key })
    const inv = this.invoices.find((i) => i.id === invoiceId)
    if (inv) inv.status = "paid"
    return { data: [{ replayed: false }], error: null }
  }
}

// ── The door's write sequence on the stored path ──────────────────────────────────────────────
//
// Nine steps in the order intake-processor.ts performs them. `crashAfter` kills the run the way a
// dying process does: no catch, no finally, no release.

const STEPS = [
  "allowance", "reader", "invoice", "reverse_link",
  "payment", "cash", "bank", "notification", "final_state",
] as const
type Step = (typeof STEPS)[number]

function scriptedDoor(world: World, crashAfter: Step | null) {
  const stop = (done: Step) => { if (crashAfter === done) throw new Crash(`crashed after ${done}`) }
  return async (ctx: { stored?: { documentId: string; expectedAiDocType: string; folderId: string | null } }) => {
    const stored = ctx.stored!
    const doc = world.documents.find((d) => d.id === stored.documentId)!

    // 1. The allowance, against the DOCUMENT and in one transaction with the counter.
    if (doc.intake_ai_counted_period == null) {
      doc.intake_ai_counted_period = "2026-09"
      world.charged += 1
    }
    stop("allowance")

    // 2. The reader. The expensive step, and the one a resume must never reach again.
    world.readerCalls += 1
    stop("reader")

    // 3. The invoice.
    const { data: made, error } = await world.from("invoices").insert({
      receiver_id: OWNER, direction: "incoming", status: "received",
      document_id: stored.documentId, client_name: "Leverancier", invoice_number: "F-1",
      field_confidence: { _auto_paid: { method: "kas", date: "2026-09-18" }, _intake_kind: "receipt" },
    }).select().run()
    let invoiceId: string
    if (error?.code === "23505") {
      // The 23505 arm: adopt what THIS document already has, never mint a second cost.
      invoiceId = world.invoices.find((i) => i.document_id === stored.documentId)!.id as string
    } else {
      invoiceId = made[0].id as string
    }
    stop("invoice")

    // 4. The reverse link. Repairable state, never financial identity.
    await world.from("documents").update({ invoice_id: invoiceId })
      .eq("id", stored.documentId).eq("user_id", OWNER).is("invoice_id", null).run()
    stop("reverse_link")

    // 5. The payment, on a key derived from the document.
    await world.rpc("apply_manual_payment", {
      p_user_id: OWNER, p_invoice_id: invoiceId, p_client_key: autoSettlementKey(stored.documentId),
      p_pay_date: "2026-09-18", p_method: "kas",
    })
    stop("payment")

    world.cashReconciles += 1
    stop("cash")
    world.bankConfirms += 1
    stop("bank")

    // 8. The bell, on its own durable event key.
    await world.from("notifications").insert({
      user_id: OWNER, title: "Bon automatisch verwerkt en afgeboekt", type: "invoice",
      event_key: autoFinishedEventKey(stored.documentId),
    }).run()
    stop("notification")

    // 9. And only now the final state, as a compare-and-set on what this run loaded.
    await world.from("documents").update({ ai_doc_type: "receipt", ai_processed: true })
      .eq("id", stored.documentId).eq("user_id", OWNER)
      .eq("ai_doc_type", stored.expectedAiDocType).run()
    stop("final_state")

    return { kind: "json" as const, status: 200, body: { ok: true } }
  }
}

function freshWorld(): World {
  const w = new World()
  w.documents.push({
    id: DOCUMENT, user_id: OWNER, file_url: PATH, file_name: "bon.pdf", file_type: "application/pdf",
    folder_id: "folder-maart", ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN, ai_processed: false,
    content_hash: "abc123", invoice_id: null, intake_ai_counted_period: null,
  })
  w.blobs.set(PATH, "%PDF-1.4 de bon")
  return w
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runOnce(world: World, crashAfter: Step | null): Promise<any> {
  return processStoredDocument({
    documentId: DOCUMENT, ownerId: OWNER, mode: "fresh_intake", trigger: "drain", source: "upload",
    deps: {
      pipeline: world,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      process: scriptedDoor(world, crashAfter) as any,
      notify: async (args: { eventKey?: string | null; userId: string; title: string; type: string }) => {
        const { error } = await world.from("notifications").insert({
          user_id: args.userId, title: args.title, type: args.type, event_key: args.eventKey ?? null,
        }).run()
        if (error?.code === "23505") return { ok: true, error: null, duplicate: true }
        return { ok: true, error: null }
      },
      reconcileCash: async () => { world.cashReconciles += 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bankConfirm: (async () => { world.bankConfirms += 1 }) as any,
    },
  })
}

/** Everything the owner's list asks to be at most one of. */
function tally(world: World) {
  return {
    invoices: world.invoices.filter((i) => i.document_id === DOCUMENT).length,
    payments: world.payments.length,
    charged: world.charged,
    // Every bell this owner got, not only the ones carrying the key. What the owner sees is ROWS:
    // a second notification written without a key is exactly as duplicated on their screen, and a
    // tally that counted keys would be blind to the one failure it exists to catch.
    bells: world.notifications.filter((n) => n.user_id === OWNER).length,
    documents: world.documents.filter((d) => d.id === DOCUMENT).length,
    blob: world.blobs.has(PATH),
    finalState: world.documents.find((d) => d.id === DOCUMENT)?.ai_doc_type,
  }
}

// ── The matrix ────────────────────────────────────────────────────────────────────────────────

for (const checkpoint of STEPS) {
  test(`[ONTVANGEN-CRASH] killed after ${checkpoint}, then run again: one of everything`, async () => {
    const world = freshWorld()

    // The run that dies.
    //
    // Driven WITHOUT the orchestrator on purpose: a crash is not an exception somebody catches, it
    // is the process ending — so the orchestrator's own catch never runs, its finally never runs,
    // and the claim it took is never released. Routing the dying run through it would model a
    // tidy failure, which is the one thing a crash is not.
    const dood = new Date(Date.now() - STALE_MS)
    world.claims.push({
      id: "claim-dood", user_id: OWNER, claim_key: `doc:${DOCUMENT}`, created_at: dood.toISOString(),
    })
    await assert.rejects(
      () => scriptedDoor(world, checkpoint)({
        stored: { documentId: DOCUMENT, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN, folderId: "folder-maart" },
      }),
      Crash,
    )
    const afterCrash = tally(world)
    assert.ok(afterCrash.blob, "the crash must not have taken the owner's file with it")
    assert.equal(afterCrash.documents, 1, "…nor the row")
    assert.equal(world.claims.length, 1, "a dead worker releases nothing — its claim stands until the TTL")

    // The successor. It finds the dead claim, sees it is past its life, and takes it over — which
    // is what stops one crash wedging a document forever.
    const readerBefore = world.readerCalls
    const again = await runOnce(world, null)
    const t = tally(world)

    assert.ok(t.invoices <= 1, `invoice rows ≤ 1 (found ${t.invoices})`)
    assert.ok(t.payments <= 1, `manual payment effect ≤ 1 (found ${t.payments})`)
    assert.ok(t.charged <= 1, `AI allowance charge ≤ 1 (found ${t.charged})`)
    assert.ok(t.bells <= 1, `notification row ≤ 1 (found ${t.bells})`)
    assert.equal(t.documents, 1, "the document survives")
    assert.ok(t.blob, "the bytes survive")
    assert.equal(t.finalState, "receipt", "the final state converges")

    // [ONTVANGEN-CRASH] And the assertion that is about COST rather than correctness: once the
    // invoice exists, the retry must not pay for a read whose answer is already on the row.
    if (STEPS.indexOf(checkpoint) >= STEPS.indexOf("invoice")) {
      assert.equal(world.readerCalls - readerBefore, 0,
        "the retry read the document again although its invoice already existed")
      assert.equal(
        again.kind, checkpoint === "final_state" ? "not_waiting" : "resumed",
        "a document with an invoice resumes; one whose final state already landed is simply done",
      )
    }
  })
}

test("[ONTVANGEN-CRASH] two workers that both reach the insert still produce one invoice", async () => {
  // The claim keeps two LIVE workers apart, and the crash matrix above proves the retry path. This
  // is the case neither covers: a worker that was merely SLOW, whose claim went stale, and whose
  // successor took it over and caught up. Both are alive, both hold a read, both insert.
  //
  // Nothing in the application can separate them at that point. The partial UNIQUE on
  // invoices.document_id is the only thing that can, so it is the only thing this test allows to.
  const world = freshWorld()
  const ctx = {
    stored: { documentId: DOCUMENT, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN, folderId: "folder-maart" },
  }
  await Promise.all([
    scriptedDoor(world, null)(ctx),
    scriptedDoor(world, null)(ctx),
  ])

  const t = tally(world)
  assert.equal(t.invoices, 1, "one document, one invoice — the second cost is the doubled expense")
  assert.equal(t.payments, 1, "…and one instalment against it")
  assert.equal(t.bells, 1, "…and one bell")
  assert.equal(t.charged, 1, "…and one document off the month's allowance")
  assert.equal(world.readerCalls, 2, "both really did read — this is a race, not a queue")
})

// ── The two refusals that must not start any work ─────────────────────────────────────────────

test("[ONTVANGEN-CRASH] a document another worker is holding is left alone", async () => {
  const world = freshWorld()
  world.claims.push({
    id: "claim-1", user_id: OWNER, claim_key: `doc:${DOCUMENT}`, created_at: new Date().toISOString(),
  })
  const r = await runOnce(world, null)
  assert.equal(r.kind, "busy")
  assert.equal(world.readerCalls, 0, "a busy document must cost nothing at all")
  assert.equal(world.invoices.length, 0)
})

test("[ONTVANGEN-CRASH] a document whose invoice cannot be looked up starts nothing", async () => {
  // Not knowing whether financial identity exists is not the same as knowing it does not. Reading
  // on would charge the owner for a read whose result the partial UNIQUE may then refuse anyway.
  const world = freshWorld()
  const realFrom = world.from.bind(world)
  world.from = (name: string) => {
    if (name !== "invoices") return realFrom(name)
    throw new Error("statement timeout")
  }
  const r = await runOnce(world, null)
  assert.equal(r.kind, "unavailable")
  assert.equal(world.readerCalls, 0)
  assert.equal(world.charged, 0, "an allowance may not be spent on a run that never started")
})

test("[ONTVANGEN-CRASH] a finished run leaves no claim standing", async () => {
  const world = freshWorld()
  const r = await runOnce(world, null)
  assert.equal(r.kind, "processed")
  assert.equal(world.claims.length, 0, "the next pass must not have to wait out a TTL for nothing")
})

test("[ONTVANGEN-CRASH] a claim that is still ALIVE is not taken over, however tempting", async () => {
  // The other half of the takeover: a worker that is merely slow is not a worker that is dead.
  const world = freshWorld()
  world.claims.push({
    id: "claim-levend", user_id: OWNER, claim_key: `doc:${DOCUMENT}`,
    created_at: new Date(Date.now() - 1000).toISOString(),
  })
  const r = await runOnce(world, null)
  assert.equal(r.kind, "busy")
  assert.equal(world.invoices.length, 0, "two live workers on one document is the doubled cost")
})
