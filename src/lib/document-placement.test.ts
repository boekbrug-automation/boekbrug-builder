// src/lib/document-placement.test.ts
// [ONTVANGEN] The processor says what a document IS. It never says where it lives.

import { test } from "node:test"
import assert from "node:assert/strict"
// [OBSERVABILITY] The constant, never the string. A literal here would stay green through a
// rename while the code it claims to test had moved on — which is the drift skipped-import.ts
// exists to prevent, and the gate scans test files for exactly that reason.
import { DOC_TYPE_WACHT_OP_LEZEN } from "./skipped-import"
import {
  insertClassifiedDocument,
  updateClassification,
  IDENTITY_KEYS,
  type DocumentIdentity,
  type DocumentClassification,
} from "./document-placement"

type Row = Record<string, unknown>

class FakePipeline {
  rows: Row[] = []
  insertError: { code?: string; message?: string } | null = null
  updateError: { message: string } | null = null
  lastUpdate: { patch: Row; filters: Array<[string, unknown]> } | null = null
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
          select: async () => {
            this.lastUpdate = { patch, filters }
            if (this.updateError) return { data: null, error: this.updateError }
            const hit = this.rows.filter((r) => filters.every(([c, v]) => r[c] === v))
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ id: r.id })), error: null }
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

  const r = await updateClassification("doc-1", USER, AS_INVOICE, p)
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
  p.rows = [{ id: "doc-1", ...IDENTITY, user_id: OTHER, doc_type: "overig" }]

  assert.deepEqual(await updateClassification("doc-1", USER, AS_INVOICE, p), { kind: "gone" })
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
  assert.deepEqual(await updateClassification("doc-1", USER, AS_INVOICE, p), { kind: "gone" })
})

test("[ONTVANGEN] a database that did not answer is a failure, and is NOT 'gone'", async () => {
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY }]
  p.updateError = { message: "statement timeout" }
  const r = await updateClassification("doc-1", USER, AS_INVOICE, p)
  assert.equal(r.kind, "failed", "a timeout must not be read as 'the owner deleted it'")
})

test("[ONTVANGEN] the bestanden road leaves the year alone rather than writing null over it", async () => {
  // Only the invoice/receipt road knows a year. A file going to bestanden has no opinion, and an
  // opinionless write of null would erase a year a previous reading had correctly established.
  const p = new FakePipeline()
  p.rows = [{ id: "doc-1", ...IDENTITY, year: 2026 }]
  const asDocument: DocumentClassification = {
    doc_type: "overig", folder_id: "folder-import", ai_processed: true, ai_doc_type: "other",
  }
  await updateClassification("doc-1", USER, asDocument, p)
  assert.ok(!("year" in (p.lastUpdate?.patch ?? {})), "an absent year must not be sent as null")
  assert.equal(p.rows[0].year, 2026)
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
