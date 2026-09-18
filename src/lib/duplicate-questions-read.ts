// src/lib/duplicate-questions-read.ts
// [VRAAG-BLIJFT] Turning rows into questions — and surviving a lookup that does not come back.
//
// This lives beside the route rather than inside it because the thing worth proving is a decision,
// not a query: an enrichment failure must cost the DECORATION and never the question. Inside a
// Next route that decision can only be checked by reading the source; here it can be run.
//
// ── THE FAILURE THIS EXISTS TO PREVENT ───────────────────────────────────────────────────────
//
// fetchAllRowsForIds throws on the first error, deliberately: a partial read must never pass as a
// complete one. Uncaught, that throw became a 500, the panel read `!res.ok` and rendered nothing,
// and the owner saw a screen that said — by saying nothing — that nothing was waiting for them.
// They had an open question about their own money and no way to know it.
//
// The question is the primary truth. The candidate's number and supplier are what we print beside
// it. One of those may be missing; the other may not.

import type { DuplicateQuestion } from "@/lib/duplicate-question"

/** One `documents` row, as the question list selects it. */
export interface QuestionRow {
  id: string
  file_name: string | null
  duplicate_candidate_invoice_id: string | null
}

/** One `invoices` row, as the enrichment selects it. */
export interface CandidateRow {
  id: string
  invoice_number: string | null
  client_name: string | null
}

export interface CandidateLookup {
  byId: Map<string, CandidateRow>
  /** The lookup was attempted and did not come back. NOT "there were none". */
  unavailable: boolean
}

/** The distinct candidate ids these rows point at, in the order they first appear. */
export function candidateIdsOf(rows: QuestionRow[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) {
    const id = r.duplicate_candidate_invoice_id
    if (id && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out
}

/**
 * Read the candidates, and treat a failure as missing decoration rather than as a failure.
 *
 * `read` is the owner-scoped, chunked lookup; it throws on any error, which is why it is called
 * from inside here and nowhere else.
 */
export async function lookUpCandidates(
  ids: string[],
  read: (ids: string[]) => Promise<CandidateRow[]>,
  onFailure?: (error: string) => void,
): Promise<CandidateLookup> {
  const byId = new Map<string, CandidateRow>()
  if (ids.length === 0) return { byId, unavailable: false }
  try {
    for (const row of await read(ids)) byId.set(row.id, row)
    return { byId, unavailable: false }
  } catch (e) {
    onFailure?.(e instanceof Error ? e.message : String(e))
    // Deliberately an EMPTY map and a raised flag, not a rethrow: every question below still
    // travels to the screen, and the screen is told why it has no invoice beside it.
    return { byId, unavailable: true }
  }
}

/**
 * The questions, one per row — always one per row.
 *
 * A row whose candidate could not be looked up becomes a question with `candidate: null`, which is
 * exactly what a row the reader never named a candidate for becomes. The two are told apart by
 * `unavailable` on the lookup, which the screen prints once; they are never told apart by dropping
 * one of them.
 */
export function buildQuestions(rows: QuestionRow[], found: CandidateLookup): DuplicateQuestion[] {
  return rows.map((r) => {
    const id = r.duplicate_candidate_invoice_id
    const hit = id ? found.byId.get(id) : undefined
    return {
      documentId: r.id,
      fileName: r.file_name ?? "document",
      candidate: hit && id
        ? { invoiceId: id, invoiceNumber: hit.invoice_number ?? null, vendor: hit.client_name ?? null }
        : null,
    }
  })
}
