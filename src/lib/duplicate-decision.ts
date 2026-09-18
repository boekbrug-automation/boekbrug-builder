// src/lib/duplicate-decision.ts
// [ONTVANGEN-BESLUIT] The owner answers the one question a reader cannot.
//
// ── THE QUESTION ─────────────────────────────────────────────────────────────────────────────
//
// The reader found an invoice that is already booked from a DIFFERENT file — same number, same
// supplier, same amount, different bytes. That can be the same bill photographed twice, and it can
// be a genuinely separate invoice a supplier numbered the same way. No amount of compute settles
// it, so the document waits in `wacht_op_besluit` until a human says which it is.
//
// Under the synchronous road that answer arrived as `force=true` on a SECOND upload of the same
// file. After receive-first there is no second upload: the document is already here, already read,
// already paid for. The answer is written on it instead.
//
// ── WHAT THE CLIENT MAY SAY, AND WHAT IT MAY NOT ─────────────────────────────────────────────
//
// It may say `keep_existing` or `add_anyway`. That is all.
//
// It may NOT name the candidate invoice. The browser is holding a screen that was rendered some
// time ago and can be replayed, edited or replayed by somebody else; an id it sends is a claim
// about which invoice this is a duplicate of, and accepting that claim would let one owner point a
// decision at another owner's row. The candidate is read from
// `documents.duplicate_candidate_invoice_id`, which this app wrote.
//
// ── AND THE FOREIGN KEY IS NOT OWNERSHIP ─────────────────────────────────────────────────────
//
// `duplicate_candidate_invoice_id` references `invoices(id)`. That proves the invoice EXISTS; it
// says nothing about whose it is. Ownership of both sides is established here, in the statement,
// because RLS is off on the money line ([RLS-UIT]) and this pass runs with the service role.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import { DOC_TYPE_WACHT_OP_BESLUIT, DOC_TYPE_WACHT_OP_LEZEN } from "@/lib/skipped-import"

export const DUPLICATE_DECISIONS = ["keep_existing", "add_anyway"] as const
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number]

/** Narrow an untrusted request body to something the CHECK constraint will accept. */
export function isDuplicateDecision(value: unknown): value is DuplicateDecision {
  return typeof value === "string" && (DUPLICATE_DECISIONS as readonly string[]).includes(value)
}

export type DecisionOutcome =
  /** `add_anyway`: the same stored document is back in the queue, with the override on its row. */
  | { kind: "resumed"; documentId: string }
  /** `keep_existing`: the redundant copy is gone, and the invoice it duplicated is untouched. */
  | { kind: "discarded"; documentId: string; storageRemoved: boolean }
  /**
   * Nothing was written, and the reason is one the owner may be shown.
   *
   *   · gone        — no such document for this owner.
   *   · not_asked   — it is not waiting on an answer. Somebody already answered, or it never asked.
   *   · not_yours   — the candidate invoice is not this owner's. A refusal, never a repair.
   */
  | { kind: "refused"; why: "gone" | "not_asked" | "not_yours" }
  | { kind: "failed"; error: string | null }

interface Deps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline?: any
  /** Remove the redundant object. Injected in tests; production uses the storage client. */
  removeObject?: (path: string) => Promise<boolean>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultRemove(pipeline: any) {
  return async (path: string): Promise<boolean> => {
    try {
      const { error } = await pipeline.storage.from("documents").remove([path])
      return !error
    } catch {
      return false
    }
  }
}

/**
 * Apply the owner's answer to the duplicate question.
 *
 * Every write here is a compare-and-set on `wacht_op_besluit`, so two taps, a tap racing a worker,
 * and a tap on a screen that was rendered yesterday all resolve to ONE durable outcome. The loser
 * is told the question is no longer open — which is true — rather than overwriting the winner.
 */
export async function applyDuplicateDecision(args: {
  documentId: string
  ownerId: string
  decision: DuplicateDecision
  deps?: Deps
}): Promise<DecisionOutcome> {
  const pipeline = args.deps?.pipeline ?? createPipelineClient()
  const removeObject = args.deps?.removeObject ?? defaultRemove(pipeline)

  try {
    // ── 1. What are we actually looking at? ───────────────────────────────────────────────────
    const { data: doc, error: readErr } = await pipeline
      .from("documents")
      .select("id, user_id, file_url, ai_doc_type, duplicate_candidate_invoice_id")
      .eq("id", args.documentId)
      .eq("user_id", args.ownerId)
      .maybeSingle()
    if (readErr) return { kind: "failed", error: readErr.message ?? null }
    // A document belonging to somebody else answers the same as one that does not exist: from this
    // caller's position those are the same fact, and telling them apart confirms the id is real.
    if (!doc) return { kind: "refused", why: "gone" }
    if ((doc.ai_doc_type ?? "").trim() !== DOC_TYPE_WACHT_OP_BESLUIT) {
      return { kind: "refused", why: "not_asked" }
    }

    // ── 2. Is the candidate this owner's? ─────────────────────────────────────────────────────
    //
    // The FK proved it exists. Only this proves it is theirs — and without it, a decision could be
    // pointed at a stranger's invoice by whatever wrote the candidate, now or in some future path.
    const candidateId = (doc.duplicate_candidate_invoice_id ?? null) as string | null
    if (candidateId) {
      const { data: candidate, error: invErr } = await pipeline
        .from("invoices")
        .select("id")
        .eq("id", candidateId)
        .eq("receiver_id", args.ownerId)
        .maybeSingle()
      if (invErr) return { kind: "failed", error: invErr.message ?? null }
      if (!candidate) {
        console.error("[ONTVANGEN-BESLUIT] the candidate invoice is not this owner's — refusing", {
          documentId: args.documentId,
        })
        return { kind: "refused", why: "not_yours" }
      }
    }
    // No candidate at all is allowed: the reader could not always name one, and the owner is still
    // answering a question about THEIR document. There is simply nothing to prove ownership of.

    if (args.decision === "add_anyway") {
      // ── 3a. Put it back in the queue, with the override on the row ──────────────────────────
      //
      // The state moves back to a processing state so the pass may pick it up, and the decision
      // stays on the row so the pass knows why it is allowed past the block that stopped it. Both
      // in one statement: a state without its reason is a document that asks the same question
      // again, and a reason without the state is an answer nothing acts on.
      const { data, error } = await pipeline
        .from("documents")
        .update({ duplicate_decision: "add_anyway", ai_doc_type: DOC_TYPE_WACHT_OP_LEZEN })
        .eq("id", args.documentId)
        .eq("user_id", args.ownerId)
        .eq("ai_doc_type", DOC_TYPE_WACHT_OP_BESLUIT)
        .select("id")
      if (error) return { kind: "failed", error: error.message ?? null }
      if (!(data ?? []).length) return { kind: "refused", why: "not_asked" }
      return { kind: "resumed", documentId: args.documentId }
    }

    // ── 3b. keep_existing: this really is a second copy ─────────────────────────────────────
    //
    // The invoice it duplicates is untouched — it is the one the owner is keeping. What goes is the
    // redundant copy: the row first, as a compare-and-set, and only then the object.
    //
    // That order is deliberate. Deleting the object first and then failing on the row leaves a
    // document whose evidence is gone — an invisible loss. Deleting the row first and then failing
    // on the object leaves an object with no row, which the storage sweep can find and which costs
    // the owner nothing they can see. One of those is recoverable.
    const { data: removed, error: delErr } = await pipeline
      .from("documents")
      .delete()
      .eq("id", args.documentId)
      .eq("user_id", args.ownerId)
      .eq("ai_doc_type", DOC_TYPE_WACHT_OP_BESLUIT)
      .select("id")
    if (delErr) return { kind: "failed", error: delErr.message ?? null }
    if (!(removed ?? []).length) return { kind: "refused", why: "not_asked" }

    const path = (doc.file_url ?? "") as string
    const storageRemoved = path ? await removeObject(path) : false
    if (path && !storageRemoved) {
      // Not a failure of the decision — the document is gone and the owner's answer stands — but
      // an orphan nobody would otherwise know about. Named, so it is findable.
      console.error("[ONTVANGEN-BESLUIT] the redundant object outlived its row", {
        documentId: args.documentId, path,
      })
    }
    return { kind: "discarded", documentId: args.documentId, storageRemoved }
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}
