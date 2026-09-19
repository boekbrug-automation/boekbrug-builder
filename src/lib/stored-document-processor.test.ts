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
import { selectDrainCandidates, runIntakeDrain } from "./intake-drain"
import { STORED_DOCUMENT_CLAIM_TTL_MS } from "./stored-document-claim"

const OWNER = "11111111-1111-1111-1111-111111111111"
const DOCUMENT = "33333333-3333-3333-3333-333333333333"
const PATH = `${OWNER}/incoming/1758000000000-bon.pdf`
/** The invoice date the reader finds on the paper. The folder and the year both hang off it. */
const INVOICE_DATE = "2026-03-15"
/** Where RECEIVE filed it: "Geïmporteerde bestanden", which is NOT where a booked invoice lives. */
const RECEIVE_FOLDER = "folder-geimporteerd"
/** What resolveImportTarget answers for that date — facturen/2026/Q1. */
const FINAL_FOLDER = "folder-facturen-2026-Q1"
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
  /** Set to make the notifications INSERT fail the way a transient database problem does. */
  notifyFails = false
  /** Every (date) the final placement was resolved for — proof both roads ask the same question. */
  folderLookups: Array<string | null> = []
  /** The `source` the door was handed — read from the row, never from the caller. */
  doorSawSource: string | null = null
  /** Whether the door was told it may pass the semantic duplicate block. */
  doorSawForce: boolean | null = null

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
      // The membership filter the drain selects with, and the ordering it relies on. Modelled
      // rather than stubbed: a fake that ignored `.in` would let a drain test pass while the
      // e-mail rows it must never pick up were being handed straight to the processor.
      const members: Array<[string, unknown[]]> = []
      let cap = Infinity
      const q = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
        is: (c: string, v: unknown) => { filters.push([c, v]); return q },
        neq: (c: string, v: unknown) => { filters.push([`!${c}`, v]); return q },
        in: (c: string, v: unknown[]) => { members.push([c, v]); return q },
        order: () => q,
        lt: () => q,
        limit: (n: number) => { cap = n; return q },
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
            && members.every(([c, vs]) => vs.includes(r[c] as never))
          switch (op) {
            case "select": return { data: rows.filter(match).slice(0, cap), error: null }
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
              if (name === "notifications" && world.notifyFails) {
                return { data: [], error: { code: "08006", message: "connection failure" } }
              }
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
  return async (ctx: {
    stored?: { documentId: string; expectedAiDocType: string; folderId: string | null }
    source?: string
    force?: boolean
  }) => {
    // [ONTVANGEN] What the door was told this document IS. Recorded so a test can prove it came
    // from the row and not from whoever started the run.
    if (ctx.source) world.doorSawSource = ctx.source
    if (typeof ctx.force === "boolean") world.doorSawForce = ctx.force
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
      invoice_date: INVOICE_DATE,
      field_confidence: {
        // The auto road was taken: this is what tells a resume that a bell, a reconcile and a
        // settlement were part of the original run rather than things it is inventing.
        _auto_verified: { at: "2026-09-18T10:00:00.000Z", reason: "clean" },
        _auto_paid: { method: "kas", date: "2026-09-18" },
        _intake_kind: "receipt",
      },
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

    // 9. And only now the final state, as a compare-and-set on what this run loaded. The fresh
    // road files a booked invoice under facturen/<year>, resolved from the invoice date — NOT
    // where receive put the file.
    world.folderLookups.push(INVOICE_DATE)
    await world.from("documents")
      .update({ ai_doc_type: "receipt", ai_processed: true, folder_id: FINAL_FOLDER, year: 2026 })
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
    folder_id: RECEIVE_FOLDER, source: "camera",
    ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN, ai_processed: false,
    content_hash: "abc123", invoice_id: null, intake_ai_counted_period: null, year: null,
    intake_retry_after: null, created_at: "2026-09-18T09:00:00Z",
  })
  w.blobs.set(PATH, "%PDF-1.4 de bon")
  return w
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runOnce(world: World, crashAfter: Step | null): Promise<any> {
  return processStoredDocument({
    documentId: DOCUMENT, ownerId: OWNER, mode: "fresh_intake", trigger: "drain",
    deps: {
      pipeline: world,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      process: scriptedDoor(world, crashAfter) as any,
      notify: async (args: { eventKey?: string | null; userId: string; title: string; type: string }) => {
        const { error } = await world.from("notifications").insert({
          user_id: args.userId, title: args.title, type: args.type, event_key: args.eventKey ?? null,
        }).run()
        if (error?.code === "23505") return { ok: true, error: null, duplicate: true }
        if (error) return { ok: false, error: error.message ?? null }
        return { ok: true, error: null }
      },
      // The same call the fresh road makes, seamed only so this test can run without a database.
      // That both roads really make THAT call, with the invoice's own date, is [ONTVANGEN-PLAATS]
      // in lifecycle-gates.test.ts.
      resolveFolder: async (_userId: string, invoiceDate: string | null) => {
        world.folderLookups.push(invoiceDate)
        return invoiceDate === INVOICE_DATE ? FINAL_FOLDER : RECEIVE_FOLDER
      },
      reconcileCash: async () => { world.cashReconciles += 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bankConfirm: (async () => { world.bankConfirms += 1 }) as any,
    },
  })
}

/** The same run, addressed the way the drain addresses it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runOnceAs(world: World, crashAfter: Step | null, args: { documentId: string; ownerId: string }): Promise<any> {
  assert.equal(args.documentId, DOCUMENT)
  assert.equal(args.ownerId, OWNER)
  return runOnce(world, crashAfter)
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
    folder: world.documents.find((d) => d.id === DOCUMENT)?.folder_id,
    year: world.documents.find((d) => d.id === DOCUMENT)?.year,
  }
}

// ── The matrix ────────────────────────────────────────────────────────────────────────────────

/** What an uninterrupted run leaves behind. Everything below must converge to exactly this. */
async function cleanRun() {
  const world = freshWorld()
  await runOnce(world, null)
  return tally(world)
}

for (const checkpoint of STEPS) {
  test(`[ONTVANGEN-CRASH] killed after ${checkpoint}, then run again: one of everything`, async () => {
    const clean = await cleanRun()
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

    // [ONTVANGEN-PLAATS] …and so does WHERE it ends up. A crash that leaves the same money in a
    // different folder or a different year is a document the accountant cannot find, with no cent
    // wrong and nothing failing. `doc.folderId` is where RECEIVE put the file; the booked invoice
    // belongs under facturen/<year>, resolved from the invoice's own date on both roads.
    assert.equal(t.folder, clean.folder,
      `folder after crash/retry (${t.folder}) differs from an uninterrupted run (${clean.folder})`)
    assert.equal(t.year, clean.year,
      `year after crash/retry (${t.year}) differs from an uninterrupted run (${clean.year})`)
    assert.notEqual(t.folder, RECEIVE_FOLDER,
      "the booked invoice was left in the receive folder — the resume used doc.folderId")

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

test("[ONTVANGEN-MELDING] a bell that could not be written leaves the document waiting", async () => {
  // The order exists for this case. Everything financial is done and idempotent; only the bell is
  // missing. Writing the final state anyway would take the document out of the queue with no
  // notification — and nothing would ever look at it again, so the owner would simply never learn
  // that their invoice was booked.
  const clean = await cleanRun()
  const world = freshWorld()

  // A crashed run that got as far as the invoice, so the retry takes the resume road.
  world.claims.push({
    id: "claim-dood", user_id: OWNER, claim_key: `doc:${DOCUMENT}`,
    created_at: new Date(Date.now() - STALE_MS).toISOString(),
  })
  await assert.rejects(
    () => scriptedDoor(world, "invoice")({
      stored: { documentId: DOCUMENT, expectedAiDocType: DOC_TYPE_WACHT_OP_LEZEN, folderId: RECEIVE_FOLDER },
    }),
    Crash,
  )

  // First retry: the notifications table refuses the write.
  world.notifyFails = true
  await runOnce(world, null)

  const halverwege = tally(world)
  assert.equal(halverwege.bells, 0, "nothing was written")
  assert.equal(
    world.documents.find((d) => d.id === DOCUMENT)?.ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN,
    "the document must still be WAITING — a final state here is a document nobody comes back to",
  )
  assert.ok(halverwege.invoices <= 1 && halverwege.payments <= 1,
    "…and the money that was already done stays done exactly once")

  // Second retry: the table answers.
  world.notifyFails = false
  const readerBefore = world.readerCalls
  const again = await runOnce(world, null)
  const t = tally(world)

  assert.equal(again.kind, "resumed")
  assert.equal(t.bells, 1, "exactly one notification")
  assert.equal(t.finalState, "receipt", "the final state converges")
  assert.equal(t.folder, clean.folder, "…in the same folder as an uninterrupted run")
  assert.equal(t.year, clean.year, "…and the same year")
  assert.equal(world.readerCalls - readerBefore, 0, "and it never paid for the read again")
  assert.ok(t.invoices <= 1 && t.payments <= 1 && t.charged <= 1, "money still ≤ 1 of everything")
})

test("[ONTVANGEN] the source the processor is handed comes from the row, not from the caller", async () => {
  // `source` describes the RECEIVED document — it is identity, like the file name and the hash.
  // There is no source argument on the orchestrator at all; a camera photo stays a camera photo
  // however the run that reads it was started.
  const world = freshWorld()
  await runOnce(world, null)
  assert.equal(world.doorSawSource, "camera")

  const other = freshWorld()
  other.documents[0].source = "upload"
  await runOnce(other, null)
  assert.equal(other.doorSawSource, "upload")
})

test("[ONTVANGEN] a document from another door is refused, never processed", async () => {
  // An e-mail attachment has its own pipeline, its own dedup and its own supplier resolution.
  // Running it through this one would book it a second time under a second set of rules.
  const world = freshWorld()
  world.documents[0].source = "email"
  const r = await runOnce(world, null)
  assert.equal(r.kind, "wrong_door")
  assert.equal(r.kind === "wrong_door" ? r.source : "", "email")
  assert.equal(world.readerCalls, 0, "nothing was read")
  assert.equal(world.invoices.length, 0, "and nothing was booked")
  assert.equal(world.claims.length, 0, "…and the claim it took was given back")
})

// ── [ONTVANGEN-CUTOVER] The browser is gone, and the promise still holds ──────────────────────

test("[ONTVANGEN-CUTOVER] the browser dies, the kick never starts, and the drain finishes the job", async () => {
  // The whole point of receive-first: the bytes and the row are durable, the owner has been told,
  // and the immediate worker never ran — a cold start that lost it, a platform that dropped it, a
  // process killed the instant the response flushed. Nothing about the document says so.
  const clean = await cleanRun()
  const world = freshWorld()

  // No kick. The document simply sits there in wacht_op_lezen, exactly as the handoff left it.
  assert.equal(world.documents[0].ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN)
  assert.equal(world.invoices.length, 0)
  assert.equal(world.readerCalls, 0)

  // Later, the drain comes past. It is a different trigger and a different mode, and it walks the
  // same road.
  const picked = await selectDrainCandidates({ pipeline: world, now: new Date() })
  assert.deepEqual(picked.map((c) => c.documentId), [DOCUMENT],
    "a document whose kick never ran must be visible to the drain")

  await runIntakeDrain({
    pipeline: world, now: new Date(),
    run: (async (args: { documentId: string; ownerId: string }) =>
      runOnceAs(world, null, args)),
  })

  const t = tally(world)
  assert.equal(t.invoices, 1, "invoice ≤ 1")
  assert.equal(t.charged, 1, "AI allowance charge ≤ 1")
  assert.equal(t.payments, 1)
  assert.equal(t.bells, 1)
  assert.equal(t.finalState, clean.finalState, "and it converges to what an uninterrupted run leaves")
  assert.equal(t.folder, clean.folder)
  assert.equal(t.year, clean.year)
})

test("[ONTVANGEN-CUTOVER] the kick and the drain reach the same document — one of them runs", async () => {
  // Both are alive, both start, and neither knows about the other. The claim is what separates
  // them; the durable guards are what make the loser's arrival harmless either way.
  const world = freshWorld()
  const [a, b] = await Promise.all([
    runOnce(world, null),                                     // the after-receive kick
    runOnce(world, null),                                     // the drain, a moment later
  ])

  const ran = [a, b].filter((r) => r.kind === "processed" || r.kind === "resumed")
  const stood = [a, b].filter((r) => r.kind === "busy")
  assert.equal(stood.length, 1, "exactly one of the two must be told to stand down")
  assert.equal(ran.length, 1)

  const t = tally(world)
  assert.equal(t.invoices, 1, "one document, one invoice")
  assert.equal(t.charged, 1)
  assert.equal(t.payments, 1)
  assert.equal(t.bells, 1)
  assert.equal(world.readerCalls, 1, "and only one of them paid for the read")
})

test("[ONTVANGEN-BESLUIT] the owner's durable answer is what lets the pass past the block", async () => {
  // Under the synchronous road "toch toevoegen" was force=true on a SECOND upload. After
  // receive-first the answer is on the row, and it has to reach the door — otherwise the pass
  // walks into the same semantic duplicate block and asks the same question again, forever.
  const zonder = freshWorld()
  await runOnce(zonder, null)
  assert.equal(zonder.doorSawForce, false, "an unanswered document is never forced")

  const met = freshWorld()
  met.documents[0].duplicate_decision = "add_anyway"
  await runOnce(met, null)
  assert.equal(met.doorSawForce, true, "the owner's answer must travel with the run")

  // And it is the ANSWER, not the state: a document the owner answered "keep_existing" for is
  // gone by then, and one with no answer is not forced by having been asked.
  const geweigerd = freshWorld()
  geweigerd.documents[0].duplicate_decision = "keep_existing"
  await runOnce(geweigerd, null)
  assert.equal(geweigerd.doorSawForce, false)
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
