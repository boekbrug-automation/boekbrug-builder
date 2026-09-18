// src/lib/stored-document.ts
// [ONTVANGEN] Everything the processor needs, from durable state alone.
//
// ── WHAT THIS REPLACES ───────────────────────────────────────────────────────────────────────
//
// The intake processor used to be handed a browser File, its Buffer, the FormData it arrived in
// and the NextRequest around all three. After #129 it runs when none of those exist any more: the
// owner has been told "Ontvangen" and has closed the tab. So the inputs have to come back out of
// the two things that DID survive — the documents row and the object in storage.
//
// ── WHY THE ANSWER IS A VERDICT AND NOT A DOCUMENT-OR-NULL ───────────────────────────────────
//
// A background pass that gets `null` learns nothing it can act on. These five outcomes each want
// a different response, and collapsing them is how a document either gets processed twice or
// waits forever:
//
//   ready         — go ahead.
//   gone          — the row is not there. Nothing to do, and nothing wrong: the owner may have
//                   deleted it, or answered "hou de bestaande" on a duplicate. Never retry.
//   not_waiting   — the row is there and is NOT waiting on us. This is the double-booking guard:
//                   a document that is already read, already booked, or waiting on the OWNER's
//                   answer must not be picked up again because a drain happened to see it.
//   bytes_missing — the row says a file is stored and storage disagrees. Retrying cannot fix that;
//                   it needs to be visible, not swept.
//   unavailable   — the database or storage did not answer. Retry later; decide nothing now.
//
// ── OWNERSHIP IS A FILTER, NOT AN ASSUMPTION ─────────────────────────────────────────────────
//
// RLS is off on the money line ([RLS-UIT]), and this loader runs with a service-role client
// because the background pass has no session. The `user_id` filter in the query is therefore the
// ONLY tenant boundary there is, and the caller must say whose document it believes this is
// rather than learn it from the row. A loader that read the owner out of the row it just fetched
// would happily hand a background pass somebody else's invoice.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import { intentFromStoredDocument, type IntakeIntent } from "@/lib/intake-intent"
import { mayDrainRetry, SKIPPED_DOC_TYPES } from "@/lib/skipped-import"

/** Why the processor was woken. A fresh handoff and a later sweep may pick up different states. */
export type ProcessMode = "fresh_intake" | "retry_skipped"

export interface StoredDocument {
  id: string
  userId: string
  /** The object key inside the `documents` bucket. */
  storagePath: string
  fileName: string
  fileType: string
  /** What the owner chose at upload time — see intake-intent.ts. */
  intent: IntakeIntent
  contentHash: string | null
  /** The state it was waiting in, so the caller can say what it resumed. */
  waitingState: string
  /** The owner's answer to a duplicate question, when one was asked and answered. */
  duplicateDecision: "keep_existing" | "add_anyway" | null
  duplicateCandidateInvoiceId: string | null
  /** The bytes, read back out of storage. */
  buffer: Buffer
}

export type StoredDocumentLoad =
  | { kind: "ready"; doc: StoredDocument }
  | { kind: "gone" }
  | { kind: "not_waiting"; state: string }
  | { kind: "bytes_missing"; storagePath: string }
  | { kind: "unavailable"; where: "row" | "bytes" }

/** The columns the processor actually reads. Named once so the query and the type cannot drift. */
const COLUMNS =
  "id, user_id, file_url, file_name, file_type, ai_doc_type, content_hash, " +
  "intake_paid_method, intake_paid_date, duplicate_decision, duplicate_candidate_invoice_id"

type Row = {
  id: string
  user_id: string
  file_url: string | null
  file_name: string | null
  file_type: string | null
  ai_doc_type: string | null
  content_hash: string | null
  intake_paid_method?: string | null
  intake_paid_date?: string | null
  duplicate_decision?: string | null
  duplicate_candidate_invoice_id?: string | null
}

/**
 * May this mode resume a document sitting in this state?
 *
 * Kept as its own exported rule because it is the double-booking guard, and a guard that only
 * exists inside an `if` in a loader is a guard nobody can test on its own.
 *
 * The two modes are different WORK, not two names for one thing:
 *
 *   fresh_intake  — the first reading of a document that came through the handoff. Eligible only
 *                   while it is still waiting on US (`wacht_op_lezen`). Whether that reading
 *                   happens immediately after the handoff or hours later through the drain is a
 *                   question about what WOKE it — see intake-provenance.ts — not about what it is.
 *   retry_skipped — a second chance for a document we already tried and failed to read, which is
 *                   what the "Lees opnieuw" button offers over the overgeslagen panel. Eligible
 *                   exactly for what that panel lists, and for nothing else.
 *
 * Neither may touch `wacht_op_besluit`. An open question for a human is not something more compute
 * solves, and a pass that kept re-reading it would loop on the same document forever, stopping at
 * the same point every time.
 *
 * And neither may touch a finished document. A row that is read and booked is in neither list, so
 * a drain that happens to see it does nothing — which is the guard against booking one invoice
 * twice.
 */
export function mayResume(mode: ProcessMode, aiDocType: string | null | undefined): boolean {
  const state = (aiDocType ?? "").trim()
  return mode === "fresh_intake" ? mayDrainRetry(state) : SKIPPED_DOC_TYPES.includes(state)
}

export interface LoadDeps {
  /** Injected in tests. Defaults to the service-role client the background pass must use. */
  pipeline?: ReturnType<typeof createPipelineClient>
}

/**
 * Read one stored document back into memory, or say why that cannot be done.
 *
 * `userId` is the owner the CALLER believes this document belongs to, and it is applied as a
 * filter. A document belonging to anyone else answers `gone` — the same answer as a document that
 * does not exist, because from this caller's position those are the same fact and distinguishing
 * them would leak that the id is real.
 */
export async function loadStoredDocument(
  documentId: string,
  userId: string,
  mode: ProcessMode,
  deps: LoadDeps = {},
): Promise<StoredDocumentLoad> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = deps.pipeline ?? createPipelineClient()

  let row: Row | null = null
  try {
    const { data, error } = await pipeline
      .from("documents")
      .select(COLUMNS)
      .eq("id", documentId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) {
      console.error("[ONTVANGEN] could not read the stored document row", { documentId, error: error.message })
      return { kind: "unavailable", where: "row" }
    }
    row = (data as Row | null) ?? null
  } catch (e) {
    console.error("[ONTVANGEN] the documents read threw", { documentId, error: e instanceof Error ? e.message : String(e) })
    return { kind: "unavailable", where: "row" }
  }

  if (!row) return { kind: "gone" }
  if (!mayResume(mode, row.ai_doc_type)) return { kind: "not_waiting", state: row.ai_doc_type ?? "" }
  // A waiting row with no file is not something to read; it is something to notice.
  if (!row.file_url) return { kind: "bytes_missing", storagePath: "" }

  let buffer: Buffer
  try {
    const { data, error } = await pipeline.storage.from("documents").download(row.file_url)
    if (error || !data) {
      // Storage answering "not found" and storage being unreachable are different problems, and
      // supabase-js reports both as an error here. The row said the bytes are there, so treating
      // the absence as retryable would hide a real loss behind an endless queue; the caller gets
      // the distinguishable outcome and decides.
      console.error("[ONTVANGEN] the stored bytes could not be read back", { documentId, path: row.file_url, error: error?.message })
      return { kind: "bytes_missing", storagePath: row.file_url }
    }
    buffer = Buffer.from(await (data as Blob).arrayBuffer())
  } catch (e) {
    console.error("[ONTVANGEN] the storage download threw", { documentId, error: e instanceof Error ? e.message : String(e) })
    return { kind: "unavailable", where: "bytes" }
  }

  const decision = row.duplicate_decision
  return {
    kind: "ready",
    doc: {
      id: row.id,
      userId: row.user_id,
      storagePath: row.file_url,
      fileName: row.file_name ?? "document",
      fileType: row.file_type ?? "application/octet-stream",
      intent: intentFromStoredDocument(row),
      contentHash: row.content_hash ?? null,
      waitingState: row.ai_doc_type ?? "",
      duplicateDecision:
        decision === "keep_existing" || decision === "add_anyway" ? decision : null,
      duplicateCandidateInvoiceId: row.duplicate_candidate_invoice_id ?? null,
      buffer,
    },
  }
}
