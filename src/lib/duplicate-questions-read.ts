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

import type { DuplicateQuestion, CandidateFacts, CandidateWhere } from "@/lib/duplicate-question"
import { betaalstandVan } from "@/lib/factuurstaat"

/** One `documents` row, as the question list selects it. */
export interface QuestionRow {
  id: string
  file_name: string | null
  duplicate_candidate_invoice_id: string | null
}

/**
 * One `invoices` row, as the enrichment selects it.
 *
 * ── [ONTVANGEN-WAAR] WHY THE MONEY COLUMNS ARE HERE ──────────────────────────────────────────
 *
 * The question used to carry a number and a supplier, and nothing else. So the owner saw the SAME
 * question whether the invoice already in the books was €500 completely unpaid, €500 fully paid, or
 * €200 paid with €300 still open. Those are three different risks and one of them is a double
 * payment, which makes "not enough context" the wrong amount of context for a money decision.
 *
 * Nothing here is new: every column already exists on the row and is already true. What was missing
 * was reading it.
 */
export interface CandidateRow {
  id: string
  invoice_number: string | null
  client_name: string | null
  total_inc_btw: number | null
  amount_paid: number | null
  status: string | null
  accountant_status: string | null
  invoice_type: string | null
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
        ? {
            invoiceId: id,
            invoiceNumber: hit.invoice_number ?? null,
            vendor: hit.client_name ?? null,
            ...candidateFactsOf(hit),
          }
        : null,
    }
  })
}

/**
 * [ONTVANGEN-WAAR] What is TRUE about the invoice already in the books, as facts and not as words.
 *
 * Three rules, and each one is a thing this could get wrong in a way that costs money:
 *
 *  1. **Payment comes from the amounts, through the one authority.** `betaalstandVan` reads
 *     total_inc_btw and amount_paid and nothing else, because `status` is not the payment truth —
 *     a row can say 'paid' while carrying a part payment. Re-deriving that here would make a
 *     seventieth place in this app that decides "is it paid" for itself.
 *
 *  2. **`onbekend` is an answer and is passed through as one.** An invoice whose total could not be
 *     read is not unpaid. Printing "Nog niet betaald" over it would invent the single fact most
 *     likely to make an owner pay a bill twice, and it would look exactly as confident as a fact we
 *     actually know.
 *
 *  3. **Payment state is context, never identity.** Nothing derived here says whether this is a
 *     duplicate. If the document IS the same invoice it stays the same invoice whether the original
 *     is unpaid, half paid, paid or overpaid — those change what the owner risks, not what the
 *     document is. The only way to a second invoice remains the owner saying so.
 */
function candidateFactsOf(row: CandidateRow): CandidateFacts {
  const { stand, openstaand } = betaalstandVan({
    status: row.status,
    direction: "incoming",
    invoice_type: row.invoice_type,
    total_inc_btw: row.total_inc_btw,
    amount_paid: row.amount_paid,
  })
  return {
    total: typeof row.total_inc_btw === "number" && Number.isFinite(row.total_inc_btw)
      ? row.total_inc_btw
      : null,
    payment: stand,
    outstanding: openstaand,
    where: whereOf(row.status),
    // The accountant's lock. Not changeable from this panel — this only says that it is there.
    accountantProcessed: row.accountant_status === "verwerkt",
  }
}

/**
 * [ONTVANGEN-WAAR] Which screen holds an invoice with this status.
 *
 * Read off the two screens rather than invented here:
 *
 *   `/dashboard/incoming`        → `.eq("status","archived")` and `.eq("status","processing")`
 *   `/dashboard/incoming/manage` → `.in('status', ['received','paid'])`
 *
 * The sets are disjoint and the hard semantic gate filters on no status at all, so all four are
 * reachable as a candidate. Anything outside them is `unknown` on purpose: a status this function
 * has not been taught about must produce NO link rather than a guess, because a link to the wrong
 * screen is indistinguishable from a working one until the owner is already lost.
 *
 * [DUP-ARCHIVED] `archived` doubles as what the owner is told — the invoice is in Genegeerd, which
 * is why "deze factuur bestaat al" was useless on its own: it named something invisible.
 */
function whereOf(status: string | null): CandidateWhere {
  switch (status) {
    case "processing": return "queue"
    case "archived": return "archived"
    case "received":
    case "paid": return "books"
    default: return "unknown"
  }
}
