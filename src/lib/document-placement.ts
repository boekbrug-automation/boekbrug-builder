// src/lib/document-placement.ts
// [ONTVANGEN] Identity is RECEIVE's. Classification is the processor's. One row, two owners.
//
// ── THE SPLIT, AND WHY IT IS THE WHOLE SAFETY ARGUMENT ───────────────────────────────────────
//
// Until #129 one statement created the documents row: it said where the file is AND what the file
// is, because both were worked out in the same request. Receive-first cuts that in half.
//
//   IDENTITY      written once, at the handoff, and never again.
//                 user_id · file_name · file_url · file_size · file_type · content_hash · source
//
//   CLASSIFICATION  written by the reading, possibly much later, possibly more than once.
//                 doc_type · folder_id · year · ai_processed · ai_doc_type
//
// The danger is not that the processor writes the wrong classification — that is a reading
// mistake, visible and correctable. The danger is that it writes identity: a second file_url over
// the one the owner's bytes actually live at, a recomputed content_hash that no longer matches
// what arrived, a file_size describing something else. Each of those quietly breaks a different
// thing — the closing package resolves evidence through file_url, the duplicate gate through
// content_hash, the storage meter through file_size — and none of them fails at the moment it is
// written.
//
// So the split is a TYPE, not a convention. DocumentClassification cannot name an identity field,
// and a test asserts the two sets never overlap. The update path can then be given the whole
// classification object and still be unable to touch what it must not.
//
// ── WHY THE OUTCOMES ARE FOUR ────────────────────────────────────────────────────────────────
//
// `gone` is the one that would otherwise be missed. An update that matches no row is not a
// failure to retry: the owner may have deleted the document, or answered "hou de bestaande" on a
// duplicate question, in the seconds while we were reading it. Treating that as an error would put
// a deleted file back in the queue forever; treating it as success would have the processor go on
// to book an invoice whose evidence no longer exists.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import { isWachtendDocType } from "@/lib/skipped-import"

/** Written once, at the handoff. The processor may never write any of these. */
export interface DocumentIdentity {
  user_id: string
  file_name: string
  file_url: string
  file_size: number
  file_type: string
  content_hash: string
  source: string
}

/** Written by the reading. The only thing the processor may write on a row that already exists. */
export interface DocumentClassification {
  doc_type: string
  folder_id: string | null
  /** Only the invoice/receipt road sets a year; the bestanden road leaves it alone. */
  year?: number | null
  ai_processed: boolean
  ai_doc_type: string
}

/** The identity keys, as data, so a test can assert the classification never names one. */
export const IDENTITY_KEYS: readonly (keyof DocumentIdentity)[] = [
  "user_id", "file_name", "file_url", "file_size", "file_type", "content_hash", "source",
]

/**
 * The classification keys, as data, so the compare-and-set re-reads exactly the fields it would
 * have written — and so a field added to DocumentClassification cannot quietly fall outside the
 * "already done" comparison and turn a replay into a superseded.
 */
export const CLASSIFICATION_KEYS: readonly (keyof DocumentClassification)[] = [
  "doc_type", "folder_id", "year", "ai_processed", "ai_doc_type",
]

export type PlaceOutcome =
  | { kind: "placed"; documentId: string }
  /** The (user_id, content_hash) UNIQUE index refused it — another pass got there first. */
  | { kind: "duplicate" }
  /** The row is not there any more, or never was this owner's. Never a retry. */
  | { kind: "gone" }
  | { kind: "failed"; error: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any

const UNIQUE_VIOLATION = "23505"

/**
 * Create the row, the way the synchronous door always has: identity and classification together,
 * because it has just worked out both.
 */
export async function insertClassifiedDocument(
  identity: DocumentIdentity,
  classification: DocumentClassification,
  pipeline: Pipeline = createPipelineClient(),
): Promise<PlaceOutcome> {
  try {
    const { data, error } = await pipeline
      .from("documents")
      .insert({ ...identity, ...classification })
      .select("id")
      .single()
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return { kind: "duplicate" }
      return { kind: "failed", error: error.message ?? null }
    }
    if (!data?.id) return { kind: "failed", error: null }
    return { kind: "placed", documentId: data.id }
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * What a compare-and-set classification did, or why it did nothing.
 *
 * `placed` is the only one that wrote. The other three are the ways "zero rows matched" can mean
 * different things, and collapsing them is how a stale worker either overwrites a decision the
 * owner has already made, or retries forever against a document that has moved on:
 *
 *   · gone                — the row is not there any more, or never was this owner's. Stop.
 *   · superseded          — it is still waiting, but on something else: another pass paused it on
 *                           Fair Use, or the owner was asked a question. Our conclusion is stale.
 *   · completed_elsewhere — it is already final. `identical` says whether that final state is
 *                           exactly what we were going to write, which is the difference between
 *                           "our own write landed and then we crashed" and "somebody else
 *                           concluded something else". Neither is a retry, and neither is an error.
 */
/**
 * [ONTVANGEN] The year a classified invoice document is filed under.
 *
 * One expression, two callers: the run that reads the document and the run that RESUMES after it
 * crashed. Both must produce the same number, or a crash changes where an owner finds their bill
 * without changing a cent — the kind of difference nobody notices until an accountant asks for the
 * year and half of it is in the wrong folder.
 *
 * Derived from the invoice date and nothing else. A document whose date could not be read has no
 * year, and null is the honest answer: the folder it lands in says the same thing.
 */
export function placementYear(invoiceDate: string | null): number | null {
  return invoiceDate ? new Date(invoiceDate).getFullYear() : null
}

export type ClassifyOutcome =
  | { kind: "placed"; documentId: string }
  | { kind: "gone" }
  | { kind: "superseded"; aiDocType: string | null }
  | { kind: "completed_elsewhere"; aiDocType: string | null; identical: boolean }
  | { kind: "failed"; error: string | null }

/**
 * Say what an ALREADY RECEIVED document turned out to be — as a compare-and-set.
 *
 * Scoped to the owner because RLS is off on this table, so the filter in the statement is the only
 * tenant boundary there is — and because a classification written onto a stranger's document would
 * move their file into a folder and a year they never chose.
 *
 * Takes no identity argument at all. There is nowhere to pass one.
 *
 * ── WHY EXPECTED-STATE, AND NOT A CLAIM ──────────────────────────────────────────────────────
 *
 * The claim ([ONTVANGEN-CLAIM]) keeps two LIVE workers apart. It cannot keep a worker apart from
 * its own crashed predecessor, nor from the owner: while a run was reading a document, its claim
 * can go stale, a successor can finish the whole job, and the first worker can then wake up with a
 * conclusion about a document that has since been booked, corrected or deleted.
 *
 * A blind UPDATE at that moment is not a late write. It moves a booked document back into an AI
 * classification the owner has already acted on. So the write states what it believed the document
 * still was, and the database decides whether that is still true.
 *
 * `expectedAiDocType` is that belief — normally one of the waiting states (wacht_op_lezen,
 * wacht_op_limiet, wacht_op_besluit), read from the same row this run loaded.
 *
 * It is the ONLY predicate beyond identity and owner, deliberately. `ai_processed = false` looks
 * like a free second lock and is not one: it would be a second place that has to agree with the
 * waiting states, and the day one of them is written with ai_processed already true, the write
 * stops matching and every run reports superseded on a document nobody touched. The waiting doc
 * types ARE the not-yet-final states; one predicate says that, and says it in one place.
 */
export async function updateClassification(
  documentId: string,
  userId: string,
  expectedAiDocType: string | null,
  classification: DocumentClassification,
  pipeline: Pipeline = createPipelineClient(),
): Promise<ClassifyOutcome> {
  try {
    const owned = pipeline
      .from("documents")
      .update(classification)
      .eq("id", documentId)
      .eq("user_id", userId)
    // PostgREST has no `= NULL`: a document that never carried an ai_doc_type must be matched with
    // IS NULL, or the compare-and-set silently matches nothing and every run reports superseded.
    const { data, error } = await (
      expectedAiDocType === null
        ? owned.is("ai_doc_type", null)
        : owned.eq("ai_doc_type", expectedAiDocType)
    ).select("id")
    if (error) return { kind: "failed", error: error.message ?? null }
    if ((data ?? []).length) return { kind: "placed", documentId }

    // Zero rows. Three different facts look identical from here, so read the row and say which.
    const { data: row, error: readError } = await pipeline
      .from("documents")
      .select(CLASSIFICATION_KEYS.join(", "))
      .eq("id", documentId)
      .eq("user_id", userId)
      .maybeSingle()
    if (readError) return { kind: "failed", error: readError.message ?? null }
    if (!row) return { kind: "gone" }

    const aiDocType = (row as { ai_doc_type?: string | null }).ai_doc_type ?? null
    // Still waiting, but on something else. Nothing final has been decided, so nothing has been
    // lost — but this run's conclusion is about a state that no longer exists.
    if (isWachtendDocType(aiDocType)) return { kind: "superseded", aiDocType }

    // Final. Compare every field we would have set, not only ai_doc_type — a row can carry our doc
    // type and still sit in a different folder or year, and that is not our write having happened.
    const identical = CLASSIFICATION_KEYS.every(
      (key) => classification[key] === undefined || row[key] === classification[key],
    )
    return { kind: "completed_elsewhere", aiDocType, identical }
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}

// ── [ONTVANGEN] LINKAGE — the third concern, and the one that is repairable ───────────────────
//
// `documents.invoice_id` is neither identity nor classification. It is the REVERSE of
// `invoices.document_id`, and the two are not equally important:
//
//   invoices.document_id   the evidence link. The closing package resolves an invoice's PDF
//                          through it. It is written in the same statement that creates the
//                          invoice, so it exists exactly when the financial identity exists.
//
//   documents.invoice_id   a convenience, written afterwards, in a second statement.
//
// Production proves they can disagree: one live invoice points at a document whose invoice_id is
// null (measured 18 September — see docs/ONTVANGEN_IDEMPOTENTIE.md). Whatever produced it, the
// consequence is fixed:
//
//   `documents.invoice_id IS NULL` DOES NOT MEAN "no invoice exists".
//
// A retry that concluded otherwise would mint a second invoice for a document that already has
// one. So a missing reverse link is a REPAIR, and repair may never re-enter invoice creation.

export type LinkOutcome =
  | { kind: "linked" }
  /** Already pointing at this invoice. Nothing to do, and not an error. */
  | { kind: "already_linked" }
  /**
   * The pair does not hold together for this owner, OR the document is already the evidence of a
   * DIFFERENT invoice. Never repaired, never guessed at, and above all never overwritten.
   */
  | { kind: "refused"; why: "document" | "invoice" | "not_evidence" | "linked_elsewhere" }
  | { kind: "failed"; error: string | null }

/**
 * Repair `documents.invoice_id`, having proved the pair belongs together and to this owner.
 *
 * Four facts are established server-side before a byte is written, and none of them is taken from
 * the caller's word:
 *
 *     document.id       = documentId      document.user_id     = ownerId
 *     invoice.id        = invoiceId       invoice.receiver_id  = ownerId
 *     invoice.document_id = documentId
 *
 * The last is the one that makes this safe to call from a recovery path. It refuses to write a
 * link the FORWARD direction does not already assert — so this function can only ever finish a
 * relationship the invoice itself already claims, never invent one. Pointing a document at an
 * invoice that does not name it back would fabricate evidence for a bill, which is the shape of
 * mistake an accountant finds and nobody can explain.
 *
 * RLS is off on both tables, so the owner predicates in these statements are the whole boundary.
 */
/** One read of the document's current link, so the CAS and its re-read cannot ask differently. */
async function readDocumentLink(
  documentId: string,
  ownerId: string,
  pipeline: Pipeline,
): Promise<{ kind: "read"; linkedTo: string | null } | { kind: "refused"; why: "document" } | { kind: "failed"; error: string | null }> {
  const { data, error } = await pipeline
    .from("documents")
    .select("id, invoice_id")
    .eq("id", documentId)
    .eq("user_id", ownerId)
    .maybeSingle()
  if (error) return { kind: "failed", error: error.message ?? null }
  if (!data) return { kind: "refused", why: "document" }
  return { kind: "read", linkedTo: (data.invoice_id as string | null) ?? null }
}

export async function linkDocumentToInvoice(
  documentId: string,
  ownerId: string,
  invoiceId: string,
  pipeline: Pipeline = createPipelineClient(),
): Promise<LinkOutcome> {
  try {
    const read = await readDocumentLink(documentId, ownerId, pipeline)
    if (read.kind !== "read") return read
    // Already the evidence of ANOTHER invoice. A repair tool fills a missing relation; it does not
    // move a financial one. Overwriting here would silently detach the invoice that row belongs to.
    if (read.linkedTo && read.linkedTo !== invoiceId) return { kind: "refused", why: "linked_elsewhere" }
    if (read.linkedTo === invoiceId) return { kind: "already_linked" }

    const { data: inv, error: invErr } = await pipeline
      .from("invoices")
      .select("id, document_id")
      .eq("id", invoiceId)
      .eq("receiver_id", ownerId)
      .maybeSingle()
    if (invErr) return { kind: "failed", error: invErr.message ?? null }
    if (!inv) return { kind: "refused", why: "invoice" }
    // The forward link must already say this document is its evidence. Without this check the
    // repair path could attach any document to any of the owner's invoices.
    if (inv.document_id !== documentId) return { kind: "refused", why: "not_evidence" }

    // ── The compare-and-set ──────────────────────────────────────────────────────────────────
    //
    // `.is("invoice_id", null)` is what makes this safe against a slow worker. Between the read
    // above and this write, an owner action or a successor may have linked the row; without the
    // predicate our UPDATE would land anyway and overwrite a newer truth with an older one.
    //
    // Matching zero rows is therefore NOT a failure and NOT a reason to retry. It means the world
    // moved, so we re-read and report what it moved to.
    const { data: written, error: wErr } = await pipeline
      .from("documents")
      .update({ invoice_id: invoiceId })
      .eq("id", documentId)
      .eq("user_id", ownerId)
      .is("invoice_id", null)
      .select("id")
    if (wErr) return { kind: "failed", error: wErr.message ?? null }
    if ((written ?? []).length) return { kind: "linked" }

    const after = await readDocumentLink(documentId, ownerId, pipeline)
    if (after.kind !== "read") return after
    if (after.linkedTo === invoiceId) return { kind: "already_linked" }   // a twin won; benign
    if (after.linkedTo) return { kind: "refused", why: "linked_elsewhere" }
    // Still null and still ours, yet the write matched nothing: something we cannot explain.
    // Reporting "linked" here would claim a repair that did not happen.
    return { kind: "failed", error: null }
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Has this document already produced financial identity?
 *
 * The cheap recovery path, asked BEFORE the reader runs. It is not a replacement for the database
 * boundary — a unique index on invoices(document_id) is what actually prevents the second insert —
 * but it is what stops a retry paying for an AI read it does not need, and what lets a crashed run
 * resume instead of starting again.
 *
 * Deliberately keyed on the FORWARD link and scoped to the owner. Asking `documents.invoice_id`
 * instead would answer "no invoice" for the row production already has.
 */
export async function findInvoiceForDocument(
  documentId: string,
  ownerId: string,
  pipeline: Pipeline = createPipelineClient(),
): Promise<{ kind: "found"; invoiceId: string; status: string | null } | { kind: "none" } | { kind: "failed" }> {
  try {
    const { data, error } = await pipeline
      .from("invoices")
      .select("id, status")
      .eq("document_id", documentId)
      .eq("receiver_id", ownerId)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error("[ONTVANGEN] could not look for an existing invoice", { documentId, error: error.message })
      return { kind: "failed" }
    }
    return data?.id ? { kind: "found", invoiceId: data.id, status: data.status ?? null } : { kind: "none" }
  } catch (e) {
    console.error("[ONTVANGEN] the existing-invoice lookup threw", { documentId, error: e instanceof Error ? e.message : String(e) })
    return { kind: "failed" }
  }
}
