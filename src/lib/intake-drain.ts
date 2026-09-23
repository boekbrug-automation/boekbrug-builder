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
import {
  DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_LIMIET, DOC_TYPE_COULD_NOT_READ,
} from "@/lib/skipped-import"
import { processStoredDocument, type StoredRunResult } from "@/lib/stored-document-processor"
// [UPLOAD-TRUTH-1] Delivery only. This import is the whole reach of the notice pass — there is
// deliberately no path from it to the reader.
import { deliverUnreadableNotice } from "@/lib/unreadable-delivery"

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
  /** [UPLOAD-TRUTH-1] The notice pass's only side effect, injectable so a test can refuse it. */
  deliver?: typeof deliverUnreadableNotice
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

// ── [UPLOAD-TRUTH-1] The notice pass: delivery without a reader ──────────────────────────────
//
// ── WHY THIS IS A SECOND SELECTOR AND NOT THREE MORE STATES IN THE FIRST ─────────────────────
//
// This is the trap, and it is expensive rather than merely wrong.
//
// runIntakeDrain hands every candidate to processStoredDocument with `mode: "retry_skipped"`, and
// mayResume("retry_skipped", …) consults SKIPPED_DOC_TYPES — which CONTAINS 'could_not_read',
// because that list is what the "Lees opnieuw" button offers. So adding could_not_read to
// selectDrainCandidates would not merely widen the reader loop: every terminal unreadable document
// in the system would be handed to the AI reader again, every fifteen minutes, on behalf of an
// owner who is not waiting for anything. Silently, and billably.
//
// The only thing standing between that and production today is the `.in()` filter in
// selectDrainCandidates. It stays exactly as it is, and delivery gets its own selection and its
// own loop.
//
// What keeps the loop away from the reader is a GATE, not an import boundary. An earlier version
// of this comment claimed the separation held "because it does not import a path to it", which is
// simply false: unreadable-delivery.ts imports INTAKE_SOURCES from intake-processor.ts, so the
// module graph offers a path and always did. Only the constant is used — but a claim that is
// false in the file next door is worth nothing on the day someone adds a second import. The
// [UPLOAD-TRUTH-1] gates assert the absence of a reader CALL in both this loop and that module,
// which is the thing that actually matters and the thing a test can hold.
//
// ── WHY IT CONVERGES ─────────────────────────────────────────────────────────────────────────
//
// `intake_retry_after IS NOT NULL` on a terminal unreadable row means "still owes its owner the
// telling", and delivery clears it. So a document leaves this set permanently the moment the owner
// has been told, and the steady state is an empty selection — not an anti-join that re-examines
// every could_not_read document ever written, forever.

/** How many unreadable notices one pass will attempt. Bounded like the reader batch, and cheaper. */
export const NOTICE_BATCH = 25

/** One document that is terminal, unreadable, and has not yet reached its owner. */
export interface NoticeCandidate {
  documentId: string
  ownerId: string
}

/**
 * [NO-SILENT-EMPTY] What the scan FOUND, or that it could not find out.
 *
 * These are different facts and the type says so, because a bare array cannot. "No document is
 * owed a notice" and "we could not read the list of documents owed a notice" collapse into the
 * same `[]`, and the second one then reports itself as a clean pass with nothing to do — on the
 * one surface in this slice whose entire purpose is that an outcome is never lost quietly.
 *
 * The first version of this function returned `[]` on a read error, under a comment saying that a
 * failed read is not an empty work list. The comment was right and the code was not.
 */
export type NoticeScan =
  | { kind: "ok"; candidates: NoticeCandidate[] }
  | { kind: "unavailable"; error: string }

/**
 * The documents whose owner still has to be told the reader gave up.
 *
 * Every predicate earns its place:
 *
 *   ai_doc_type = could_not_read   the terminal truth. Nothing else is announced here.
 *   intake_retry_after IS NOT NULL armed, i.e. not yet delivered. This is what makes the set
 *                                  shrink to nothing instead of growing forever.
 *   trashed = false                the owner threw it away. Announcing it now would send them to
 *                                  a panel that correctly no longer lists it.
 *   invoice_id IS NULL             it became an invoice after all — through "Lees opnieuw", or a
 *                                  race. There is nothing left to tell.
 *   source IN INTAKE_SOURCES       this door only. The e-mail road writes could_not_read too,
 *                                  through its own pipeline and its own skipped registry.
 */
export async function selectUnreadableNoticeCandidates(deps: DrainDeps = {}): Promise<NoticeScan> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = deps.pipeline ?? createPipelineClient()
  try {
    const { data, error } = await pipeline
      .from("documents")
      .select("id, user_id")
      .eq("ai_doc_type", DOC_TYPE_COULD_NOT_READ)
      .not("intake_retry_after", "is", null)
      .eq("trashed", false)
      .is("invoice_id", null)
      .in("source", [...INTAKE_SOURCES])
      // Oldest first: the owner who has been waiting longest to hear is told first, and a pass
      // that runs out of room keeps starting with the same rows rather than churning.
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .limit(NOTICE_BATCH)
    if (error) {
      // [NO-SILENT-EMPTY] Not an empty list. The caller must be able to tell this apart, and the
      // documents stay armed either way — nothing is lost, but nothing may be reported as done.
      console.error("[UPLOAD-TRUTH-1] could not read the undelivered unreadable notices", {
        error: error.message,
      })
      return { kind: "unavailable", error: String(error.message ?? "read failed") }
    }
    return {
      kind: "ok",
      candidates: ((data ?? []) as Array<{ id: string; user_id: string }>)
        .map((r) => ({ documentId: r.id, ownerId: r.user_id })),
    }
  } catch (e) {
    console.error("[UPLOAD-TRUTH-1] the notice candidate read threw", {
      error: e instanceof Error ? e.message : String(e),
    })
    return { kind: "unavailable", error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * [NO-SILENT-EMPTY] What one notice pass did — or that it could not find out what there was to do.
 *
 * `picked: 0` is a claim: nobody was owed anything. A pass whose scan failed has not earned that
 * claim, so it cannot make it — the shape does not allow it.
 */
export type NoticeReport =
  | { kind: "scanned"; picked: number; outcomes: Record<string, number> }
  | { kind: "unavailable"; error: string }

/**
 * Deliver the outstanding unreadable notices.
 *
 * No claim, no clock gate, no reader. A second worker running this at the same time is harmless:
 * the partial UNIQUE on (user_id, event_key) lets exactly one notification exist, the loser is
 * told `already_reported`, and both clear the same arm to the same value.
 */
export async function runUnreadableNotices(deps: DrainDeps = {}): Promise<NoticeReport> {
  const deliver = deps.deliver ?? deliverUnreadableNotice
  const scan = await selectUnreadableNoticeCandidates(deps)
  // [NO-SILENT-EMPTY] A pass that could not read its work list reports exactly that. Turning it
  // into `picked: 0` would put "nothing to do" in the cron log over a backlog nobody measured.
  if (scan.kind === "unavailable") return { kind: "unavailable", error: scan.error }

  const outcomes: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = deps.pipeline ?? createPipelineClient()

  for (const c of scan.candidates) {
    let result: Awaited<ReturnType<typeof deliverUnreadableNotice>>
    try {
      result = await deliver({ documentId: c.documentId, userId: c.ownerId, deps: { pipeline, now: deps.now } })
    } catch (e) {
      // deliverUnreadableNotice does not throw. If it ever does, this pass loses one notice and
      // the document stays armed — which is the recoverable half of every failure here.
      console.error("[UPLOAD-TRUTH-1] one notice threw; the rest of the pass continues", {
        documentId: c.documentId, error: e instanceof Error ? e.message : String(e),
      })
      outcomes.threw = (outcomes.threw ?? 0) + 1
      continue
    }
    outcomes[result.kind] = (outcomes[result.kind] ?? 0) + 1
  }

  return { kind: "scanned", picked: scan.candidates.length, outcomes }
}

export interface DrainReport {
  picked: number
  /** Counted by what processStoredDocument answered, purely so a human can read the log. */
  outcomes: Record<string, number>
  /** [UPLOAD-TRUTH-1] What the notice pass did, counted apart: it reads no file and spends nothing. */
  notices: NoticeReport
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

  // [UPLOAD-TRUTH-1] After the reader loop, never inside it. These documents are FINISHED — there
  // is nothing left to read and nothing left to spend; all that is owed is the telling. It rides
  // the same fifteen-minute pass rather than a cron of its own, because a second schedule is a
  // second thing to forget, and because the promise it keeps is the same promise.
  const notices = await runUnreadableNotices(deps)

  return { picked: candidates.length, outcomes, notices }
}
