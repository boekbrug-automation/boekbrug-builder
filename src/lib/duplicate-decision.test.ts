// src/lib/duplicate-decision.test.ts
// [ONTVANGEN-BESLUIT] The owner answers, once, and the answer is durable.
//
// Three of these are about money rather than tidiness:
//
//   · a decision may never be pointed at another owner's invoice — the FK proves the row EXISTS,
//     and says nothing about whose it is;
//   · `keep_existing` must not touch the invoice it duplicates: that is the one the owner is
//     keeping, and it is already in the books;
//   · two taps, or a tap racing a worker, must resolve to ONE outcome. The compare-and-set on
//     `wacht_op_besluit` is the only thing that decides which.

import { test } from "node:test"
import assert from "node:assert/strict"

import { applyDuplicateDecision, isDuplicateDecision } from "./duplicate-decision"
import {
  DOC_TYPE_WACHT_OP_BESLUIT, DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_COULD_NOT_READ,
} from "./skipped-import"

const OWNER = "11111111-1111-1111-1111-111111111111"
const STRANGER = "22222222-2222-2222-2222-222222222222"
const DOCUMENT = "33333333-3333-3333-3333-333333333333"
const CANDIDATE = "44444444-4444-4444-4444-444444444444"
const PATH = `${OWNER}/incoming/bon.pdf`

type Row = Record<string, unknown>

/** A world that enforces what the statements filter on, and nothing more. */
class World {
  documents: Row[] = []
  invoices: Row[] = []
  removed: string[] = []
  removeFails = false

  from = (table: string) => {
    const rows = table === "documents" ? this.documents : this.invoices
    const build = (op: "select" | "update" | "delete", payload?: Row) => {
      const filters: Array<[string, unknown]> = []
      const q = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
        in: (c: string, v: unknown[]) => { filters.push([c, v]); return q },
        select: () => q,
        maybeSingle: async () => {
          const { data, error } = await q.run()
          return { data: data[0] ?? null, error }
        },
        then: <A, B>(ok?: (v: { data: Row[]; error: unknown }) => A | PromiseLike<A>, bad?: (e: unknown) => B) =>
          q.run().then(ok as never, bad as never),
        run: async (): Promise<{ data: Row[]; error: { message?: string } | null }> => {
          await Promise.resolve()
          const match = (r: Row) => filters.every(([c, v]) =>
            Array.isArray(v) ? v.includes(r[c] as never) : r[c] === v)
          const hit = rows.filter(match)
          if (op === "select") return { data: hit, error: null }
          if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: hit, error: null } }
          for (const r of hit) rows.splice(rows.indexOf(r), 1)
          return { data: hit, error: null }
        },
      }
      return q
    }
    return {
      select: () => build("select"),
      update: (payload: Row) => build("update", payload),
      delete: () => build("delete"),
    }
  }

  deps() {
    return {
      pipeline: this,
      removeObject: async (path: string) => {
        if (this.removeFails) return false
        this.removed.push(path)
        return true
      },
    }
  }
}

function asking(over: Row = {}): World {
  const w = new World()
  w.documents.push({
    id: DOCUMENT, user_id: OWNER, file_url: PATH,
    ai_doc_type: DOC_TYPE_WACHT_OP_BESLUIT,
    duplicate_candidate_invoice_id: CANDIDATE, duplicate_decision: null,
    ...over,
  })
  w.invoices.push({ id: CANDIDATE, receiver_id: OWNER, invoice_number: "F-14" })
  return w
}

// ── What the client may say ───────────────────────────────────────────────────────────────────

test("[ONTVANGEN-BESLUIT] only the two answers the column accepts are answers", () => {
  assert.equal(isDuplicateDecision("keep_existing"), true)
  assert.equal(isDuplicateDecision("add_anyway"), true)
  for (const nope of ["force", "yes", "", null, 1, {}, "KEEP_EXISTING"]) {
    assert.equal(isDuplicateDecision(nope), false, String(nope))
  }
})

// ── add_anyway ────────────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN-BESLUIT] add_anyway puts the SAME document back in the queue, with the override", async () => {
  // No re-upload, no second document, no second AI charge — the allowance is already marked on
  // this row and a replay of it is free. What changes is one column and the state.
  const w = asking()
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps(),
  })
  assert.deepEqual(r, { kind: "resumed", documentId: DOCUMENT, candidateInvoiceId: CANDIDATE })
  assert.equal(w.documents.length, 1, "the same document, not a second one")
  assert.equal(w.documents[0].duplicate_decision, "add_anyway", "the override is durable…")
  assert.equal(w.documents[0].ai_doc_type, DOC_TYPE_WACHT_OP_LEZEN, "…and the state lets a pass pick it up")
  assert.deepEqual(w.removed, [], "nothing was deleted")
  assert.equal(w.invoices.length, 1, "and the invoice it duplicates is untouched")
})

test("[ONTVANGEN-BESLUIT] the state and the reason move together", async () => {
  // A state without its reason asks the same question again on the next pass; a reason without
  // the state is an answer nothing acts on. One statement, or neither.
  const w = asking()
  await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps(),
  })
  const doc = w.documents[0]
  assert.ok(
    doc.duplicate_decision === "add_anyway" && doc.ai_doc_type === DOC_TYPE_WACHT_OP_LEZEN,
    "both, or the document either loops or stalls",
  )
})

// ── keep_existing ─────────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN-BESLUIT] keep_existing removes the redundant copy and leaves the books alone", async () => {
  const w = asking()
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.deepEqual(r, { kind: "discarded", documentId: DOCUMENT, storageRemoved: true, candidateInvoiceId: CANDIDATE })
  assert.equal(w.documents.length, 0, "the second copy is gone…")
  assert.deepEqual(w.removed, [PATH], "…object and all, so the storage allowance comes back")
  assert.equal(w.invoices.length, 1, "and the invoice the owner is KEEPING is untouched")
})

test("[ONTVANGEN-BESLUIT] the row goes first, so a failed object delete is an orphan and not a loss", async () => {
  // The other order loses evidence invisibly: object gone, row still pointing at it. This way the
  // owner's answer stands, and what is left behind is an object the storage sweep can find.
  const w = asking()
  w.removeFails = true
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.equal(r.kind, "discarded")
  assert.equal(r.kind === "discarded" ? r.storageRemoved : true, false,
    "the answer must say the cleanup was partial rather than claim it finished")
  assert.equal(w.documents.length, 0)
})

// ── Ownership ─────────────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN-BESLUIT] a candidate that is not this owner's refuses — and deletes nothing", async () => {
  // The foreign key proved the invoice exists. Only this proves it is theirs.
  const w = asking()
  w.invoices[0].receiver_id = STRANGER
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.deepEqual(r, { kind: "refused", why: "not_yours" })
  assert.equal(w.documents.length, 1, "no delete")
  assert.deepEqual(w.removed, [], "no object removed")
  assert.equal(w.invoices.length, 1, "and the stranger's invoice is untouched")
})

test("[ONTVANGEN-BESLUIT] another owner's document answers the same as one that is not there", async () => {
  // Telling those two apart confirms the id is real, which is a thing this door may not confirm.
  const w = asking({ user_id: STRANGER })
  for (const decision of ["keep_existing", "add_anyway"] as const) {
    const r = await applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision, deps: w.deps() })
    assert.deepEqual(r, { kind: "refused", why: "gone" })
  }
  assert.equal(w.documents.length, 1, "the stranger's document is untouched")
})

test("[ONTVANGEN-BESLUIT] a question with no candidate is still the owner's to answer", async () => {
  // The reader could not always name one. The document is still theirs, and there is simply
  // nothing to prove ownership of.
  const w = asking({ duplicate_candidate_invoice_id: null })
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps(),
  })
  assert.equal(r.kind, "resumed")
})

// ── The question has to be OPEN ───────────────────────────────────────────────────────────────

test("[ONTVANGEN-BESLUIT] a document that is not asking anything is refused", async () => {
  for (const state of [DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_COULD_NOT_READ, "invoice", "receipt"]) {
    const w = asking({ ai_doc_type: state })
    const r = await applyDuplicateDecision({
      documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
    })
    assert.deepEqual(r, { kind: "refused", why: "not_asked" }, `state ${state}`)
    assert.equal(w.documents.length, 1, `state ${state}: nothing deleted`)
  }
})

test("[ONTVANGEN-BESLUIT] two answers to one question resolve to exactly one outcome", async () => {
  // Two taps, a double-tap, a tab from yesterday, or a tap racing the worker that is about to
  // change the state. The compare-and-set decides; the loser is told the question is closed.
  const w = asking()
  const [a, b] = await Promise.all([
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps() }),
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps() }),
  ])
  const winners = [a, b].filter((r) => r.kind === "resumed" || r.kind === "discarded")
  assert.equal(winners.length, 1, "one durable outcome, never two")
  const loser = [a, b].find((r) => r.kind === "refused")
  assert.deepEqual(loser, { kind: "refused", why: "not_asked" })
})

test("[ONTVANGEN-BESLUIT] the SAME answer twice is still one outcome", async () => {
  // The double-tap, and the case the mixed race above cannot see: two `add_anyway` answers take
  // the same path, so only the compare-and-set separates them. Without it both would succeed, the
  // document would be resumed twice, and two passes would race for one invoice.
  const w = asking()
  const [a, b] = await Promise.all([
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps() }),
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps() }),
  ])
  assert.equal([a, b].filter((r) => r.kind === "resumed").length, 1, "one resume, never two")
  assert.deepEqual([a, b].find((r) => r.kind === "refused"), { kind: "refused", why: "not_asked" })

  // …and the same for two "keep_existing" taps: one delete, one closed question.
  const w2 = asking()
  const [c, d] = await Promise.all([
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w2.deps() }),
    applyDuplicateDecision({ documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w2.deps() }),
  ])
  assert.equal([c, d].filter((r) => r.kind === "discarded").length, 1, "one delete, never two")
  assert.equal(w2.removed.length, 1, "and one object removed")
})

test("[ONTVANGEN-BESLUIT] a worker that moved the document first wins over a late tap", async () => {
  const w = asking()
  // The pass finished it while the owner's screen still showed the question.
  w.documents[0].ai_doc_type = "invoice"
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.deepEqual(r, { kind: "refused", why: "not_asked" })
  assert.equal(w.documents.length, 1, "a booked document is not deleted by a stale tap")
})

// ── [ONTVANGEN-BESLUIT] What the audit trail can still say afterwards ──────────────────────────
//
// WHICH invoice the owner chose to keep is the part of this decision that still has consequences
// next year: the file is gone, the invoice stands, and the only record of why is the audit row.
//
// On `keep_existing` that id is unrecoverable the instant the document row is deleted — there is
// nowhere left to read `duplicate_candidate_invoice_id` from. So it has to travel OUT of the
// function that last held it, and it is the id the SERVER read; the request never carried one.

test("[ONTVANGEN-BESLUIT] the kept invoice is still nameable after the document is gone", async () => {
  const w = asking()
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.equal(w.documents.length, 0, "there is nothing left to look the candidate up from")
  assert.equal(r.kind, "discarded")
  assert.equal(
    r.kind === "discarded" ? r.candidateInvoiceId : "missing", CANDIDATE,
    "without this the audit row can only say 'a duplicate was discarded' — never which one was kept",
  )
})

test("[ONTVANGEN-BESLUIT] add_anyway names the invoice it was answered against too", async () => {
  const w = asking()
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "add_anyway", deps: w.deps(),
  })
  assert.equal(r.kind === "resumed" ? r.candidateInvoiceId : "missing", CANDIDATE)
})

test("[ONTVANGEN-BESLUIT] a question with no candidate records no candidate, never a guess", async () => {
  const w = asking({ duplicate_candidate_invoice_id: null })
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.equal(r.kind === "discarded" ? r.candidateInvoiceId : "missing", null)
})

test("[ONTVANGEN-BESLUIT] the recorded candidate is the one on the row, not one a caller could name", async () => {
  // The client sends a decision and nothing else. If a request could name the candidate, this
  // number would be the caller's claim rather than the server's reading — and the audit trail
  // would be recording what somebody said instead of what happened.
  const w = asking({ duplicate_candidate_invoice_id: CANDIDATE })
  const r = await applyDuplicateDecision({
    documentId: DOCUMENT, ownerId: OWNER, decision: "keep_existing", deps: w.deps(),
  })
  assert.equal(r.kind === "discarded" ? r.candidateInvoiceId : "missing", CANDIDATE)
  assert.equal(
    applyDuplicateDecision.length, 1,
    "one argument object; a candidateInvoiceId parameter is the shape this refuses to have",
  )
})
