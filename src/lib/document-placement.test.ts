// src/lib/document-placement.test.ts
// [ONTVANGEN] The processor says what a document IS. It never says where it lives.

import { test } from "node:test"
import assert from "node:assert/strict"
// [OBSERVABILITY] The constant, never the string. A literal here would stay green through a
// rename while the code it claims to test had moved on — which is the drift skipped-import.ts
// exists to prevent, and the gate scans test files for exactly that reason.
import { DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET } from "./skipped-import"
import {
  insertClassifiedDocument,
  updateClassification,
  IDENTITY_KEYS,
  CLASSIFICATION_KEYS,
  type DocumentIdentity,
  type DocumentClassification,
} from "./document-placement"

type Row = Record<string, unknown>

class FakePipeline {
  rows: Row[] = []
  insertError: { code?: string; message?: string } | null = null
  updateError: { message: string } | null = null
  readError: { message: string } | null = null
  lastUpdate: { patch: Row; filters: Array<[string, unknown]> } | null = null
  /** Every re-read the compare-and-set performed, so a test can prove it looked rather than guessed. */
  reads = 0
  inserted: Row[] = []

  from() {
    return {
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (this.insertError) return { data: null, error: this.insertError }
            this.inserted.push(row)
            return { data: { id: `doc-${this.inserted.length}` }, error: null }
          },
        }),
      }),
      update: (patch: Row) => {
        const filters: Array<[string, unknown]> = []
        const b = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
          // PostgREST's IS NULL. Recorded as its own filter shape, because a fake that let `.eq`
          // stand in for it would pass the one case the production call has to get right.
          is: (c: string, v: unknown) => { filters.push([c, v === null ? null : v]); return b },
          select: async () => {
            this.lastUpdate = { patch, filters }
            if (this.updateError) return { data: null, error: this.updateError }
            const hit = this.rows.filter((r) =>
              filters.every(([c, v]) => (v === null ? (r[c] ?? null) === null : r[c] === v)),
            )
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return b
      },
      select: () => {
        const filters: Array<[string, unknown]> = []
        const b = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
          maybeSingle: async () => {
            this.reads += 1
            if (this.readError) return { data: null, error: this.readError }
            const hit = this.rows.filter((r) => filters.every(([c, v]) => r[c] === v))
            return { data: hit[0] ?? null, error: null }
          },
        }
        return b
      },
    }
  }
}

const USER = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"

const IDENTITY: DocumentIdentity = {
  user_id: USER,
  file_name: "bon.pdf",
  file_url: `${USER}/incoming/1758000000000-bon.pdf`,
  file_size: 4096,
  file_type: "application/pdf",
  content_hash: "abc123",
  source: "camera",
}

const AS_INVOICE: DocumentClassification = {
  doc_type: "factuur",
  folder_id: "folder-maart",
  year: 2026,
  ai_processed: true,
  ai_doc_type: "invoice",
}

// ── The split itself ──────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN] a classification cannot name an identity field — the type is the guard", () => {
  // Not a style rule. file_url is how the closing package resolves an invoice's evidence,
  // content_hash is the duplicate gate, file_size is the storage meter. A processor that could
  // rewrite any of them would break a different thing each time, and none of them at the moment
  // it was written.
  const classificationKeys = Object.keys(AS_INVOICE)
  for (const key of IDENTITY_KEYS) {
    assert.ok(
      !classificationKeys.includes(key),
      `"${key}" is identity and must not travel on a classification`,
    )
  }
  // And the other direction: everything RECEIVE writes really is in the identity list, so the
  // list cannot quietly shrink and let a field slip across.
  assert.deepEqual([...IDENTITY_KEYS].sort(), Object.keys(IDENTITY).sort())
})

// ── The synchronous door: identity and classification in one statement ────────────────────────

test("[ONTVANGEN] the door that knows both writes both, exactly as it always has", async () => {
  const p = new FakePipeline()
  const r = await insertClassifiedDocument(IDENTITY, AS_INVOICE, p)
  assert.equal(r.kind, "placed")
  assert.deepEqual(p.inserted[0], { ...IDENTITY, ...AS_INVOICE })
})

test("[ONTVANGEN] a lost race on the byte hash is a duplicate, not a 500", async () => {
  // Two passes on the same bytes: the (user_id, content_hash) UNIQUE index refuses the second.
  // Reporting that as a failure would tell an owner to retry an upload that already succeeded.
  const p = new FakePipeline()
  p.insertError = { code: "23505", message: "duplicate key value violates unique constraint" }
  assert.deepEqual(await insertClassifiedDocument(IDENTITY, AS_INVOICE, p), { kind: "duplicate" })
})

test("[ONTVANGEN] any other insert failure is reported as one", async () => {
  const p = new FakePipeline()
  p.insertError = { code: "42501", message: "permission denied" }
  const r = await insertClassifiedDocument(IDENTITY, AS_INVOICE, p)
  assert.equal(r.kind, "failed")
  assert.equal(r.kind === "failed" ? r.error : "", "permission denied")
})

// ── The background pass: classification only ──────────────────────────────────────────────────

test("[ONTVANGEN] the later reading writes what the document IS, and nothing about where it lives", async () => {
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, doc_type: "overig", ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN, ai_processed: false }]

  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "placed")

  // The reading landed…
  assert.equal(p.rows[0].doc_type, "factuur")
  assert.equal(p.rows[0].ai_doc_type, "invoice")
  assert.equal(p.rows[0].ai_processed, true)
  assert.equal(p.rows[0].year, 2026)

  // …and every identity field is byte-for-byte what the handoff wrote.
  for (const key of IDENTITY_KEYS) {
    assert.equal(p.rows[0][key], IDENTITY[key], `the reading rewrote ${key}`)
  }
  // Proved at the statement too, not only at the result: the patch never mentioned them.
  for (const key of IDENTITY_KEYS) {
    assert.ok(!(key in (p.lastUpdate?.patch ?? {})), `${key} was sent in the UPDATE`)
  }
})

test("[ONTVANGEN] a classification is never written onto another owner's document", async () => {
  // RLS is off on this table, so the filter in the statement is the only tenant boundary. Writing
  // here would move a stranger's file into a folder and a year they never chose.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, user_id: OTHER, doc_type: "overig", ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]

  assert.deepEqual(
    await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p),
    { kind: "gone" },
  )
  assert.equal(p.rows[0].doc_type, "overig", "…and the row is untouched")
  assert.ok(p.lastUpdate?.filters.some(([c, v]) => c === "user_id" && v === USER))
  assert.ok(p.lastUpdate?.filters.some(([c, v]) => c === "id" && v === "doc-1"))
})

test("[ONTVANGEN] a document deleted while we were reading it is 'gone', never a retry", async () => {
  // The real case: the owner answered "hou de bestaande" on a duplicate, or emptied their
  // prullenbak, in the seconds the reader was busy. Retrying would queue a deleted file forever;
  // calling it success would book an invoice whose evidence no longer exists.
  const p = new FakePipeline()
  p.rows = []
  assert.deepEqual(
    await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p),
    { kind: "gone" },
  )
})

test("[ONTVANGEN] a database that did not answer is a failure, and is NOT 'gone'", async () => {
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  p.updateError = { message: "statement timeout" }
  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "failed", "a timeout must not be read as 'the owner deleted it'")
})

test("[ONTVANGEN] the bestanden road leaves the year alone rather than writing null over it", async () => {
  // Only the invoice/receipt road knows a year. A file going to bestanden has no opinion, and an
  // opinionless write of null would erase a year a previous reading had correctly established.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, year: 2026, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  const asDocument: DocumentClassification = {
    doc_type: "overig", folder_id: "folder-import", ai_processed: true, ai_doc_type: "other",
  }
  await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, asDocument, p)
  assert.ok(!("year" in (p.lastUpdate?.patch ?? {})), "an absent year must not be sent as null")
  assert.equal(p.rows[0].year, 2026)
})

// ── The compare-and-set: what "zero rows" actually meant ──────────────────────────────────────

test("[ONTVANGEN-CAS] the write states what it believed the document still was", async () => {
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.ok(
    p.lastUpdate?.filters.some(([c, v]) => c === "ai_doc_type" && v === DOC_TYPE_WACHT_OP_LEZEN),
    "without the expected state in the statement this is a blind UPDATE, whatever it is called",
  )
  // And it did not need to look afterwards: the row matched.
  assert.equal(p.reads, 0)
})

test("[ONTVANGEN-CAS] a document another pass moved to a different WAIT is superseded", async () => {
  // Still waiting, but on something else: Fair Use paused it while this run was reading. Nothing
  // final was decided, and nothing is lost — but this run's conclusion is about a state that is
  // gone, and writing it would un-pause a document the limit says must wait.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_processed: false, ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET }]

  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "superseded")
  assert.equal(r.kind === "superseded" ? r.aiDocType : null, DOC_TYPE_WACHT_OP_LIMIET, "say what it became")
  assert.equal(p.rows[0].ai_doc_type, DOC_TYPE_WACHT_OP_LIMIET, "…and the row is untouched")
  assert.equal(p.reads, 1, "the distinction must be read, not assumed")
})

test("[ONTVANGEN-CAS] a document finished by somebody else is 'completed elsewhere', never overwritten", async () => {
  // The real sequence: this run's claim went stale, a successor finished the whole job, the owner
  // checked the invoice — and only then does this worker come back with its conclusion. Writing it
  // would move a booked document back into an AI classification the owner has already answered.
  const p = new FakePipeline()
  p.rows = [{
    id: "doc-1", ...IDENTITY,
    doc_type: "factuur", folder_id: "folder-maart", year: 2026,
    ai_processed: true, ai_doc_type: "receipt",
  }]

  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "completed_elsewhere")
  assert.equal(r.kind === "completed_elsewhere" ? r.identical : true, false,
    "somebody else's conclusion, not ours")
  assert.equal(p.rows[0].ai_doc_type, "receipt", "…and the row is untouched")
})

test("[ONTVANGEN-CAS] a replay of a write that already landed is identical, not a conflict", async () => {
  // A crash between the UPDATE committing and the run finishing. The retry arrives with exactly
  // the conclusion that already stands, so the caller may carry on with its idempotent tail
  // instead of treating the document as somebody else's.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ...AS_INVOICE }]
  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  // [UPLOAD-TRUTH-1] `noticeArmed` rides along: a document that is already final can still owe its
  // owner the telling, and the loser of this race is the last thing that can notice. It is read
  // from the same row and is deliberately NOT part of `identical` — see document-placement.ts.
  assert.deepEqual(r, {
    kind: "completed_elsewhere", aiDocType: "invoice", identical: true, noticeArmed: false,
  })
})

test("[UPLOAD-TRUTH-1] a lost race reports whether the winner armed the owner's notice", async () => {
  // The rolling-deploy case: the winner can be a build that never heard of arming, and then the
  // terminal row carries no delivery work-list entry at all. Without this field the loser walks
  // away calling it finished, and the owner is never told.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ...AS_INVOICE, intake_retry_after: null }]
  const unarmed = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(unarmed.kind === "completed_elsewhere" ? unarmed.noticeArmed : true, false,
    "a winner that armed nothing must be visible as such")

  const q = new FakePipeline()
  q.rows = [{ id: "doc-1", ...IDENTITY, ...AS_INVOICE, intake_retry_after: "2026-09-23T10:00:00Z" }]
  const armed = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, q)
  assert.equal(armed.kind === "completed_elsewhere" ? armed.noticeArmed : false, true,
    "…and a winner that DID arm must not be repaired a second time")
})

test("[UPLOAD-TRUTH-1] a non-classification column travels in the same UPDATE, and only there", async () => {
  // The whole point of `alsoSet`: the delivery arm must land in the statement that writes the
  // terminal state, because a second write is a second place for a crash to lose it.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  const r = await updateClassification(
    "doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p,
    { intake_retry_after: "2026-09-23T10:00:00Z" },
  )
  assert.equal(r.kind, "placed")
  assert.equal(p.rows[0].intake_retry_after, "2026-09-23T10:00:00Z",
    "the arm landed in the same statement as the classification")
  assert.equal(p.rows[0].ai_doc_type, "invoice", "…and the classification landed too")
})

test("[ONTVANGEN-CAS] the same doc type in a different folder is NOT our write having happened", async () => {
  // ai_doc_type alone would say "identical" here. It is not: the owner (or another pass) filed it
  // somewhere else, and reporting our write as landed would leave the document where we did not
  // put it — with nothing to show that the two disagreed.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ...AS_INVOICE, folder_id: "folder-elders" }]
  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "completed_elsewhere")
  assert.equal(r.kind === "completed_elsewhere" ? r.identical : true, false)
})

test("[ONTVANGEN-CAS] ai_processed is deliberately NOT a second predicate", async () => {
  // A document that is waiting but already carries ai_processed = true must still be classifiable.
  // With `AND ai_processed = false` in the statement it would match nothing, and every run would
  // report superseded on a document nobody had touched — a wedge, produced by a redundant lock.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_processed: true, ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN }]
  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "placed")
  assert.ok(
    !p.lastUpdate?.filters.some(([c]) => c === "ai_processed"),
    "the waiting doc types ARE the not-yet-final states; a second lock is a second thing to agree",
  )
})

test("[ONTVANGEN-CAS] every classification field is compared, so the list cannot quietly shrink", () => {
  // The comparison is driven by CLASSIFICATION_KEYS. A field added to the type but not to the list
  // would fall outside it, and a replay that differs only in that field would read as already_done.
  assert.deepEqual([...CLASSIFICATION_KEYS].sort(), Object.keys(AS_INVOICE).sort())
  for (const key of IDENTITY_KEYS) {
    assert.ok(!CLASSIFICATION_KEYS.includes(key as never), `"${key}" is identity, not classification`)
  }
})

test("[ONTVANGEN-CAS] a document with no ai_doc_type yet is matched with IS NULL, not = NULL", async () => {
  // PostgREST has no `= NULL`. If this degraded to .eq, the compare-and-set would match nothing and
  // every first classification of such a row would report superseded and never write.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_doc_type: null }]
  const r = await updateClassification("doc-1", USER, null, AS_INVOICE, p)
  assert.equal(r.kind, "placed")
  assert.equal(p.rows[0].ai_doc_type, "invoice")
})

test("[ONTVANGEN-CAS] a re-read that fails is a failure, not a verdict about the document", async () => {
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, ai_doc_type: "receipt" }]
  p.readError = { message: "statement timeout" }
  const r = await updateClassification("doc-1", USER, DOC_TYPE_WACHT_OP_LEZEN, AS_INVOICE, p)
  assert.equal(r.kind, "failed", "a timeout must not be read as 'the owner deleted it'")
})

// ── [ONTVANGEN] LINKAGE — repairable, owner-scoped, and never a reason to mint ────────────────

import { linkDocumentToInvoice, findInvoiceForDocument } from "./document-placement"

/** A fake that holds both tables, because linkage is the one operation that spans them. */
class FakePair {
  documents: Row[] = []
  invoices: Row[] = []
  selectError: { message: string } | null = null
  updates: Array<{ patch: Row; filters: Array<[string, unknown]> }> = []
  /** Fired once, between the CAS read and the CAS write. */
  beforeWrite: (() => void) | null = null

  from(table: string) {
    const rows = () => (table === "documents" ? this.documents : this.invoices)
    const build = (filters: Array<[string, unknown]>) => ({
      eq: (c: string, v: unknown) => build([...filters, [c, v]]),
      limit: () => build(filters),
      maybeSingle: async () => {
        if (this.selectError) return { data: null, error: this.selectError }
        const hit = rows().find((r) => filters.every(([c, v]) => r[c] === v))
        return { data: hit ?? null, error: null }
      },
    })
    return {
      select: () => build([]),
      update: (patch: Row) => {
        const filters: Array<[string, unknown]> = []
        /** Runs between the read and the write, so a race can be staged exactly where it happens. */
        const b = {
          eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
          is: (c: string, v: unknown) => { filters.push([c, v]); return b },
          select: async () => {
            this.updates.push({ patch, filters })
            if (this.beforeWrite) { const f = this.beforeWrite; this.beforeWrite = null; f() }
            const hit = rows().filter((r) => filters.every(([c, v]) => (r[c] ?? null) === v))
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return b
      },
    }
  }
}

const pair = () => {
  const p = new FakePair()
  p.documents = [{ id: "doc-1", user_id: USER, invoice_id: null }]
  p.invoices = [{ id: "inv-1", receiver_id: USER, document_id: "doc-1", status: "received" }]
  return p
}
type Pipe = Parameters<typeof linkDocumentToInvoice>[3]
const asPipe = (p: FakePair) => p as unknown as Pipe

test("[ONTVANGEN] a missing reverse link is repaired once the pair proves itself", async () => {
  const p = pair()
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)), { kind: "linked" })
  assert.equal(p.documents[0].invoice_id, "inv-1")
  // Idempotent: repairing a repaired link is not an error and writes nothing new.
  const before = p.updates.length
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)), { kind: "already_linked" })
  assert.equal(p.updates.length, before)
})

test("[ONTVANGEN] linkage refuses a pair the FORWARD link does not already assert", async () => {
  // Without this check the repair path could attach any document to any of the owner's invoices —
  // fabricating evidence for a bill, which is the mistake an accountant finds and nobody can
  // explain. The invoice must already name this document as its evidence.
  const p = pair()
  p.invoices.push({ id: "inv-2", receiver_id: USER, document_id: "doc-99", status: "received" })
  assert.deepEqual(
    await linkDocumentToInvoice("doc-1", USER, "inv-2", asPipe(p)),
    { kind: "refused", why: "not_evidence" },
  )
  assert.equal(p.documents[0].invoice_id, null, "…and nothing was written")
})

test("[ONTVANGEN] linkage proves BOTH sides belong to this owner", async () => {
  // RLS is off on both tables, so these predicates are the whole boundary.
  const strangersDoc = pair()
  strangersDoc.documents[0].user_id = OTHER
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(strangersDoc)), { kind: "refused", why: "document" })

  const strangersInvoice = pair()
  strangersInvoice.invoices[0].receiver_id = OTHER
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(strangersInvoice)), { kind: "refused", why: "invoice" })
  assert.equal(strangersInvoice.documents[0].invoice_id, null)
})

test("[ONTVANGEN] 'has this document already produced an invoice?' is asked of the FORWARD link", async () => {
  // The production row that proves it: an invoice pointing at a document whose invoice_id is null.
  // Asking documents.invoice_id would answer "no invoice" and a retry would mint a second one.
  const p = pair()
  assert.equal(p.documents[0].invoice_id, null, "precondition: the reverse link is missing")
  assert.deepEqual(
    await findInvoiceForDocument("doc-1", USER, asPipe(p)),
    { kind: "found", invoiceId: "inv-1", status: "received" },
  )
})

test("[ONTVANGEN] the resume lookup is owner-scoped and honest about not knowing", async () => {
  const strangers = pair()
  strangers.invoices[0].receiver_id = OTHER
  assert.deepEqual(await findInvoiceForDocument("doc-1", USER, asPipe(strangers)), { kind: "none" })

  const broken = pair()
  broken.selectError = { message: "statement timeout" }
  assert.deepEqual(await findInvoiceForDocument("doc-1", USER, asPipe(broken)), { kind: "failed" },
    "a read that failed must not be reported as 'no invoice exists' — that is how a second one gets made")
})


// ── [ONTVANGEN] Linkage is a repair tool: it fills a gap, it never moves a relationship ───────

test("[ONTVANGEN] a document already backing ANOTHER invoice is never re-pointed", async () => {
  // Overwriting here would silently detach the invoice that row belongs to — its evidence link is
  // how the closing package resolves its PDF. A repair tool may fill a missing relation. It may
  // not move a financial one.
  const p = pair()
  p.documents[0].invoice_id = "inv-oud"
  p.invoices.push({ id: "inv-oud", receiver_id: USER, document_id: "doc-1", status: "paid" })

  assert.deepEqual(
    await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)),
    { kind: "refused", why: "linked_elsewhere" },
  )
  assert.equal(p.documents[0].invoice_id, "inv-oud", "…and the old link still stands")
})

test("[ONTVANGEN] a link written while we were reading is not overwritten", async () => {
  // The stale-worker race: we read null, someone links the row, our UPDATE lands later. The
  // compare-and-set on invoice_id IS NULL is what makes our write miss instead of win.
  const p = pair()
  p.invoices.push({ id: "inv-ander", receiver_id: USER, document_id: "doc-1", status: "received" })
  p.beforeWrite = () => { p.documents[0].invoice_id = "inv-ander" }

  assert.deepEqual(
    await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)),
    { kind: "refused", why: "linked_elsewhere" },
  )
  assert.equal(p.documents[0].invoice_id, "inv-ander", "the newer truth survived")

  // And the write really did carry the predicate, rather than merely losing by luck.
  assert.ok(
    p.updates.at(-1)!.filters.some(([c, v]) => c === "invoice_id" && v === null),
    "without `.is(invoice_id, null)` the UPDATE would have landed on top of the newer link",
  )
})

test("[ONTVANGEN] a twin winning the same repair is benign, not an error", async () => {
  // Two workers repairing the SAME missing link is the ordinary case for a retried pass. The
  // loser must report already_linked — telling a caller the repair failed would send it looking
  // for a problem that does not exist.
  const p = pair()
  p.beforeWrite = () => { p.documents[0].invoice_id = "inv-1" }
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)), { kind: "already_linked" })
  assert.equal(p.documents[0].invoice_id, "inv-1")
})

test("[ONTVANGEN] a document that vanished mid-repair is refused, never reported as linked", async () => {
  const p = pair()
  p.beforeWrite = () => { p.documents.length = 0 }
  assert.deepEqual(await linkDocumentToInvoice("doc-1", USER, "inv-1", asPipe(p)), { kind: "refused", why: "document" })
})
