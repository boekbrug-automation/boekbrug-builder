// src/lib/intake-drain.ts
// [ONTVANGEN-DRAIN] The recovery pass. Small, bounded, and not a queue engine.
//
// ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────────────────
//
// After receive-first, the immediate kick is an optimisation: it makes the common case fast. The
// DRAIN is what makes the promise true. A kick that never started, a process that died at its
// ceiling, a platform that dropped the work — every one of them leaves a document sitting in
// `wacht_op_lezen`, and this is what comes back for it.
//
// ── WHY NOT A QUEUE TABLE ────────────────────────────────────────────────────────────────────
//
// Because there is already a queue: the documents themselves. `ai_doc_type` says what each one is
// waiting for, `intake_retry_after` says when it may be tried again, and `intake_claims` says who
// is working on it. A second table would be a second truth about the same rows, and the first
// thing it would do is disagree — a document deleted by its owner, still queued; a document
// finished by a worker, still queued.
//
// ── THE SELECTION, AND THE TWO FILTERS IT MUST HAVE ──────────────────────────────────────────
//
// `ai_doc_type` alone is not enough, and the reason is measured rather than theoretical: production
// holds 549 documents with source='email', which came in through a pipeline of their own. A drain
// that selected on state alone would hand one of those to the intake processor every run, get
// `wrong_door` back every run, and do it forever. So `source` is a filter, not a check.
//
// The states, and why each is or is not here:
//
//   wacht_op_lezen    yes — waiting on US, and a retry is exactly what it needs.
//   wacht_op_limiet   yes, but only once intake_retry_after has passed. Before that the month's
//                     allowance still says no, and asking again is asking the same question.
//   wacht_op_besluit  NO. It waits on a HUMAN. More compute cannot answer it, and every attempt
//                     would pay for the same AI read of the same document.
//   could_not_read    NO, not here. It has its own second-chance door ([TWEEDE-KANS]) which the
//                     owner presses, because a reader outage that has not lifted is not a thing to
//                     retry on a timer.
//   invoice/receipt/  NO. Finished. mayDrainRetry() is the one place that decides this, and this
//   everything else       file does not keep a second list.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import { INTAKE_SOURCES } from "@/lib/intake-processor"
import { DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET } from "@/lib/skipped-import"
import { processStoredDocument, type StoredRunResult } from "@/lib/stored-document-processor"

/**
 * How many documents one drain pass will touch.
 *
 * Bounded, because a pass that tries to finish everything finishes nothing: the cron has a ceiling
 * (300 s) and each document can hold a model call. What is left over is not lost — it is still
 * waiting, and the next pass starts with the oldest again.
 */
export const DRAIN_BATCH = 25

/** One candidate, in the only three facts the pass needs to act. */
export interface DrainCandidate {
  documentId: string
  ownerId: string
  state: string
}

export interface DrainDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline?: any
  run?: typeof processStoredDocument
  now?: Date
}

/**
 * Which documents this pass may pick up.
 *
 * Owner-blind on purpose: the drain is a system pass, not a user action, and it walks every
 * account. What it is NOT blind to is the door a document came in through, or the state it waits
 * in — both are filters in the statement, because a filter applied afterwards is a filter that
 * fetched the rows anyway.
 */
export async function selectDrainCandidates(deps: DrainDeps = {}): Promise<DrainCandidate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = deps.pipeline ?? createPipelineClient()
  const now = deps.now ?? new Date()

  try {
    const { data, error } = await pipeline
      .from("documents")
      .select("id, user_id, ai_doc_type, intake_retry_after")
      .in("source", [...INTAKE_SOURCES])
      .in("ai_doc_type", [DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET])
      // Oldest first, and by id after that: a deterministic order means a pass that keeps running
      // out of time keeps starting with the SAME documents, which is how a backlog drains rather
      // than churns. `created_at` is when the owner handed it over, so the longest wait goes first.
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(DRAIN_BATCH * 2)
    if (error) {
      console.error("[ONTVANGEN-DRAIN] could not read the waiting documents", { error: error.message })
      return []
    }
    const rows = (data ?? []) as Array<{
      id: string; user_id: string; ai_doc_type: string | null; intake_retry_after: string | null
    }>
    // The time gate is applied here rather than in the statement because "not before this moment"
    // is a rule about ONE state. Writing it as SQL would mean `(state = A) OR (state = B AND date
    // <= now)`, and the day a third waiting state arrives that expression is where it is forgotten.
    const eligible = rows.filter((r) => {
      const state = (r.ai_doc_type ?? "").trim()
      if (state === DOC_TYPE_WACHT_OP_LEZEN) return true
      if (state !== DOC_TYPE_WACHT_OP_LIMIET) return false
      const until = r.intake_retry_after ? Date.parse(r.intake_retry_after) : NaN
      // No date on a paused document is a row we cannot judge. Leave it: the plan-change wake-up
      // and the next month both set the date, and guessing "now" would re-run a refused read.
      return Number.isFinite(until) && until <= now.getTime()
    })
    return eligible.slice(0, DRAIN_BATCH).map((r) => ({
      documentId: r.id, ownerId: r.user_id, state: (r.ai_doc_type ?? "").trim(),
    }))
  } catch (e) {
    console.error("[ONTVANGEN-DRAIN] the candidate read threw", {
      error: e instanceof Error ? e.message : String(e),
    })
    return []
  }
}

export interface DrainReport {
  picked: number
  /** Counted by what processStoredDocument answered, purely so a human can read the log. */
  outcomes: Record<string, number>
}

/**
 * Run one pass.
 *
 * Sequential, and that is a decision: each document can hold a model call, and a fan-out of
 * twenty-five of those is a way to hit every rate limit at once on behalf of people who are not
 * even waiting. One at a time, oldest first, until the batch is done.
 *
 * One document's failure never stops the rest — and the claim, not this loop, is what keeps a
 * document from being worked on twice.
 *
 * ── WHAT THIS PASS DELIBERATELY DOES NOT WRITE ───────────────────────────────────────────────
 *
 * Nothing. No "done" marker, no cursor, no per-document bookkeeping of its own.
 *
 * processStoredDocument can answer `resumed` while its tail left the document WAITING — a
 * notification that would not write, a folder that could not be resolved. A drain that recorded
 * "handled" off that label would be recording something that is not true, and the document would
 * stop being picked up while still unfinished. The durable state on the row is the only truth
 * about whether a document is done, and the next pass re-reads it.
 */
export async function runIntakeDrain(deps: DrainDeps = {}): Promise<DrainReport> {
  const run = deps.run ?? processStoredDocument
  const candidates = await selectDrainCandidates(deps)
  const outcomes: Record<string, number> = {}

  for (const c of candidates) {
    let result: StoredRunResult
    try {
      result = await run({
        documentId: c.documentId,
        ownerId: c.ownerId,
        mode: "retry_skipped",
        trigger: "drain",
      })
    } catch (e) {
      // processStoredDocument does not throw. If it ever does, this pass loses one document, not
      // the batch — which is the entire reason the loop is written this way.
      console.error("[ONTVANGEN-DRAIN] one document threw; the rest of the pass continues", {
        documentId: c.documentId, error: e instanceof Error ? e.message : String(e),
      })
      outcomes.threw = (outcomes.threw ?? 0) + 1
      continue
    }
    outcomes[result.kind] = (outcomes[result.kind] ?? 0) + 1
  }

  return { picked: candidates.length, outcomes }
}
