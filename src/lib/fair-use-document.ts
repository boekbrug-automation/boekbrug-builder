// src/lib/fair-use-document.ts
// [ONTVANGEN] The allowance is reserved against the DOCUMENT, so a crash cannot charge it twice.
//
// The gate in fair-use-gate.ts reserves before the model call and gives back through release().
// That covers every failure we can CATCH. It does not cover this one:
//
//     fair_use_consume succeeds  → counter +1
//     the process dies           → no catch, no finally, no release
//     the drain retries          → counter +1 again
//
// Nothing sees it. Under the synchronous door it was bounded — the owner saw an error and chose
// whether to try again. After receive-first a background pass retries on its own, so an
// infrastructure loop costs the owner one document per attempt, for OUR fault.
//
// So the reservation is durable and belongs to the document: `documents.intake_ai_counted_period`
// is written in the SAME transaction that increments the counter. There is no instant at which
// the counter has moved and the document does not know it.
//
// ── AND IT IS ABOUT ONE METRIC, ON PURPOSE ───────────────────────────────────────────────────
//
// The marker is a single value. It can say "this document has paid" and nothing about WHICH
// allowance it paid. A metric parameter here would therefore be a trap rather than a feature:
// reserve metric A, the marker fills; ask later for metric B, the function sees a marker and
// answers `replayed` — and B is never counted. Nothing fails, nothing logs, a counter simply
// stands still. So there is no metric argument in this module and none in the SQL: the schema
// cannot represent the generality, so the API does not offer it.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import { currentPeriod, limitForPlan } from "@/lib/fair-use-usage"
import type { UsagePlan } from "@/lib/fair-use-usage"

export type DocumentAllowance =
  /** Reserved now, and the counter moved. */
  | { kind: "reserved"; used: number; remaining: number }
  /** This document had already paid — a crash-safe replay. The counter did NOT move. */
  | { kind: "replayed"; used: number; remaining: number }
  /** The month is full. Nothing was reserved, so there is nothing to give back. */
  | { kind: "refused"; used: number; remaining: number }
  /** The counter could not be reached. Fails OPEN, like every other fair-use door. */
  | { kind: "unavailable" }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any

/**
 * Reserve one aiDocument against this document, at most once in its lifetime.
 *
 * Fails OPEN on infrastructure trouble, exactly like gateFairUse: a counter we cannot read is not
 * evidence that anyone is over, and refusing on our own outage would stop an owner filing a bill
 * they are legally required to keep. The difference from the old door is that "allowed" here is
 * durable — it leaves a mark that survives the process.
 */
export async function reserveAiDocument(args: {
  userId: string
  documentId: string
  plan: UsagePlan
  now?: Date
  pipeline?: Pipeline
}): Promise<DocumentAllowance> {
  const period = currentPeriod(args.now)
  // [ONTVANGEN] limitForPlan, not a ternary of my own. The rule is already written down once:
  // free gets the published ceiling and EVERY paid plan gets 0, which means "count, do not bound".
  // Rebuilding it here as `plan === "plus" ? … : free` quietly put boekhouder on the free ceiling —
  // a plan that is supposed to have none. The bug is not the branch; it is having a second copy of
  // a rule that already has an owner.
  const limit = limitForPlan("aiDocuments", args.plan)
  const pipeline: Pipeline = args.pipeline ?? createPipelineClient()
  try {
    const { data, error } = await pipeline.rpc("fair_use_consume_for_document", {
      p_user_id: args.userId,
      p_document_id: args.documentId,
      p_period: period,
      p_limit: limit,
    })
    if (error || !data || !data.length) {
      console.warn("[ONTVANGEN] the per-document allowance could not be reached — allowing", error?.message)
      return { kind: "unavailable" }
    }
    const row = data[0] as { allowed: boolean; used: number; remaining: number; replayed: boolean }
    const used = Number(row.used ?? 0)
    const remaining = Number(row.remaining ?? -1)
    if (!row.allowed) return { kind: "refused", used, remaining }
    return { kind: row.replayed ? "replayed" : "reserved", used, remaining }
  } catch (e) {
    console.warn("[ONTVANGEN] the per-document allowance threw — allowing", e instanceof Error ? e.message : String(e))
    return { kind: "unavailable" }
  }
}

/**
 * Give this document's reservation back, on the period it was taken in.
 *
 * Called when the READER itself failed — /eerlijk-gebruik §3 promises a file we could not read
 * never lands on the owner's bill. NOT called when the reader succeeded and something downstream
 * broke: the mark stays, so a retry re-reads at our expense and the owner pays once.
 *
 * Idempotent: a second call finds no mark and gives nothing back, so a double release cannot mint
 * free credit.
 */
export async function releaseAiDocument(args: {
  userId: string
  documentId: string
  pipeline?: Pipeline
}): Promise<{ released: boolean; period: string | null }> {
  const pipeline: Pipeline = args.pipeline ?? createPipelineClient()
  try {
    const { data, error } = await pipeline.rpc("fair_use_release_for_document", {
      p_user_id: args.userId,
      p_document_id: args.documentId,
    })
    if (error || !data || !data.length) {
      console.error("[ONTVANGEN] the per-document release failed", { documentId: args.documentId, error: error?.message })
      return { released: false, period: null }
    }
    const row = data[0] as { released: boolean; period: string | null }
    return { released: Boolean(row.released), period: row.period ?? null }
  } catch (e) {
    console.error("[ONTVANGEN] the per-document release threw", { documentId: args.documentId, error: e instanceof Error ? e.message : String(e) })
    return { released: false, period: null }
  }
}
