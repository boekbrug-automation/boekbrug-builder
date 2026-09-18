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
 * Say what an ALREADY RECEIVED document turned out to be.
 *
 * Scoped to the owner because RLS is off on this table, so the filter in the statement is the
 * only tenant boundary there is — and because a classification written onto a stranger's document
 * would move their file into a folder and a year they never chose.
 *
 * Takes no identity argument at all. There is nowhere to pass one.
 */
export async function updateClassification(
  documentId: string,
  userId: string,
  classification: DocumentClassification,
  pipeline: Pipeline = createPipelineClient(),
): Promise<PlaceOutcome> {
  try {
    const { data, error } = await pipeline
      .from("documents")
      .update(classification)
      .eq("id", documentId)
      .eq("user_id", userId)
      .select("id")
    if (error) return { kind: "failed", error: error.message ?? null }
    if (!(data ?? []).length) return { kind: "gone" }
    return { kind: "placed", documentId }
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}
