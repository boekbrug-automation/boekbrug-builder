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
import {
  mayDrainRetry, isTimeGatedWait, SKIPPED_DOC_TYPES,
  DOC_TYPE_WACHT_OP_LIMIET, DOC_TYPE_WACHT_OP_BESLUIT,
} from "@/lib/skipped-import"
import { pauseIsOver, pauseForFairUse, pauseColumns } from "@/lib/fair-use-pause"
import type { FairUseKey } from "@/lib/fair-use"
import { createNotification } from "@/lib/notifications"

/** Why the processor was woken. A fresh handoff and a later sweep may pick up different states. */
export type ProcessMode = "fresh_intake" | "retry_skipped"

export interface StoredDocument {
  id: string
  userId: string
  /** The object key inside the `documents` bucket. */
  storagePath: string
  fileName: string
  fileType: string
  /**
   * Where the handoff already filed it.
   *
   * Carried because a classification names where a document LIVES, and a background pass that had
   * to invent a folder would move a file the owner may already have found in Bestanden.
   */
  folderId: string | null
  /**
   * Which door this document came in through, as the handoff recorded it.
   *
   * Read from the row and never taken from the caller: `source` describes the RECEIVED document —
   * it is identity, the same as the file name and the hash — and a background pass that accepted
   * it as an argument could label a camera photo an upload months later, in the audit trail and in
   * the row, with nothing to contradict it.
   */
  source: string
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
  /** Waiting on us, but not before this moment — the month's allowance. Not a failure. */
  | { kind: "paused"; until: string | null }
  | { kind: "bytes_missing"; storagePath: string }
  | { kind: "unavailable"; where: "row" | "bytes" }

/** The columns the processor actually reads. Named once so the query and the type cannot drift. */
const COLUMNS =
  "id, user_id, file_url, file_name, file_type, folder_id, source, ai_doc_type, content_hash, " +
  "intake_paid_method, intake_paid_date, duplicate_decision, duplicate_candidate_invoice_id, " +
  // [ONTVANGEN-DRAIN] `trashed` is read at the EXECUTION boundary, not only at selection. The
  // drain filters on it when it picks, but a pass is not instant: the owner can empty their
  // incoming folder in the seconds between the select and the claim, and every waiting document
  // this run holds would still be read and booked. This is the same row, re-read under the claim.
  "trashed, " +
  "intake_retry_after"

type Row = {
  id: string
  user_id: string
  file_url: string | null
  file_name: string | null
  file_type: string | null
  folder_id?: string | null
  source?: string | null
  ai_doc_type: string | null
  content_hash: string | null
  intake_paid_method?: string | null
  intake_paid_date?: string | null
  duplicate_decision?: string | null
  duplicate_candidate_invoice_id?: string | null
  trashed?: boolean | null
  intake_retry_after?: string | null
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
  if (mode === "retry_skipped") return SKIPPED_DOC_TYPES.includes(state)
  // A first reading covers what waits on us AND what is merely paused. Whether the pause has run
  // out is a separate question with a separate answer — see resumeVerdict.
  return mayDrainRetry(state) || isTimeGatedWait(state)
}

/**
 * The full answer: may this run start, and if not, why not?
 *
 * Three outcomes rather than a boolean, because a paused document and a finished one want opposite
 * treatment. "Not waiting" means never again; "paused" means not yet, and the drain must leave it
 * alone WITHOUT treating it as done, without reading it, and without spending anything on it.
 *
 * The date is the only thing consulted here. Reaching it does not mean there is room — it means
 * asking again can give a different answer, and the Fair Use gate remains the one that answers.
 */
export function resumeVerdict(
  mode: ProcessMode,
  aiDocType: string | null | undefined,
  retryAfter: string | null | undefined,
  now: Date,
): "resume" | "not_waiting" | "paused" {
  if (!mayResume(mode, aiDocType)) return "not_waiting"
  if (isTimeGatedWait(aiDocType) && !pauseIsOver(retryAfter, now)) return "paused"
  return "resume"
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
  now: Date = new Date(),
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
  // [ONTVANGEN-DRAIN] Thrown away between the selection and this moment.
  //
  // `gone` rather than a state of its own, and deliberately: the caller's contract for `gone` is
  // already "the row is not there, or is not this owner's — never retry", and that is exactly what
  // a trashed document is to every road that reaches here. The drain leaves it, the after-receive
  // kick leaves it, and "Lees opnieuw" cannot offer it because the panel no longer lists it.
  //
  // Checked BEFORE resumeVerdict, because the question is not what this document is waiting for.
  // It is whether anyone is still waiting.
  if (row.trashed === true) return { kind: "gone" }
  const verdict = resumeVerdict(mode, row.ai_doc_type, row.intake_retry_after, now)
  if (verdict === "not_waiting") return { kind: "not_waiting", state: row.ai_doc_type ?? "" }
  if (verdict === "paused") return { kind: "paused", until: row.intake_retry_after ?? null }
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
      folderId: row.folder_id ?? null,
      source: (row.source ?? "").trim(),
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

// ── [ONTVANGEN] Moving a document INTO the paused state ───────────────────────────────────────

export type PauseWrite =
  /** The state changed. This run, and only this run, owes the owner the one notification. */
  | { kind: "entered"; retryAfter: string }
  /** It was already paused; the date was refreshed. Nobody is told anything again. */
  | { kind: "refreshed"; retryAfter: string }
  /** Nothing was written — the row is gone, or is not this owner's. */
  | { kind: "failed" }

/**
 * Record that the month's allowance has paused this document, and say whether that was a
 * TRANSITION or a repeat.
 *
 * ── WHY THE ANSWER CARRIES THAT DISTINCTION ──
 *
 * The owner is told once, on entering the state. Deciding that in the caller would mean reading
 * the row, deciding, then writing — and two passes that both read "not paused yet" before either
 * writes would both send the notification. The rule is therefore decided BY the write: the update
 * that moves the state refuses to match a row already in it, so exactly one caller can ever be
 * told it transitioned. Same shape as the [EB-RACE] claim: the database settles it, not a
 * comparison in application code.
 *
 * A second update then refreshes the date on a row that was already paused. That case is real and
 * must not be skipped: a document paused in September, woken on 1 October and refused again
 * because the new month is full too, needs November — not a date in the past that would have the
 * drain pick it up on every pass for a month.
 */
export async function pauseDocumentForFairUse(args: {
  documentId: string
  userId: string
  metric: FairUseKey
  now?: Date
  deps?: LoadDeps
}): Promise<PauseWrite> {
  const now = args.now ?? new Date()
  const pause = pauseForFairUse(args.metric, now)
  const columns = pauseColumns(pause)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = args.deps?.pipeline ?? createPipelineClient()

  try {
    // The transition. `neq` is what makes the notification exactly-once.
    const entered = await pipeline
      .from("documents")
      .update({ ai_doc_type: DOC_TYPE_WACHT_OP_LIMIET, ai_processed: false, ...columns })
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      .neq("ai_doc_type", DOC_TYPE_WACHT_OP_LIMIET)
      .select("id")
    if (entered.error) {
      console.error("[ONTVANGEN] could not pause the document for fair use", {
        documentId: args.documentId, error: entered.error.message,
      })
      return { kind: "failed" }
    }
    if ((entered.data ?? []).length > 0) return { kind: "entered", retryAfter: pause.retryAfter }

    // Already paused — move the date, tell nobody.
    const refreshed = await pipeline
      .from("documents")
      .update(columns)
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      .eq("ai_doc_type", DOC_TYPE_WACHT_OP_LIMIET)
      .select("id")
    if (refreshed.error || (refreshed.data ?? []).length === 0) {
      if (refreshed.error) {
        console.error("[ONTVANGEN] could not refresh the pause date", {
          documentId: args.documentId, error: refreshed.error.message,
        })
      }
      return { kind: "failed" }
    }
    return { kind: "refreshed", retryAfter: pause.retryAfter }
  } catch (e) {
    console.error("[ONTVANGEN] the pause write threw", {
      documentId: args.documentId, error: e instanceof Error ? e.message : String(e),
    })
    return { kind: "failed" }
  }
}

/**
 * [ONTVANGEN] A plan that grew may wake a paused document early.
 *
 * An owner who upgrades while a document waits should not be told to come back on the 1st. The
 * measurement that made this cheap: the billing webhook already writes the plan label in one
 * best-effort statement, so the wake-up is one more statement in the same place — no polling, no
 * new billing architecture, and no drain that has to keep asking whether anyone upgraded.
 *
 * ── WHAT IT DOES AND DELIBERATELY DOES NOT DO ──
 *
 * It moves the retry point to now. That is all. The state stays `wacht_op_limiet`, because that is
 * still what the row IS until something reads it; no allowance is consumed, no reader is invoked,
 * and nobody is notified a second time. The next ordinary drain pass finds the pause over, asks
 * the Fair Use gate, and the gate answers — with the new plan, which is the whole point.
 *
 * Never inferring an allowance from an upgrade is the same rule the retry date follows: reaching
 * the moment means the answer CAN be different, not that it is.
 *
 * Best-effort by design, like the plan-label write it sits beside: a failure here costs an owner
 * a wait they were already expecting, and must never take down the write that grants them access.
 */
export async function wakePausedDocumentsForPlanChange(args: {
  userId: string
  now?: Date
  deps?: LoadDeps
}): Promise<{ woken: number }> {
  const now = args.now ?? new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any = args.deps?.pipeline ?? createPipelineClient()
  try {
    const { data, error } = await pipeline
      .from("documents")
      .update({ intake_retry_after: now.toISOString() })
      .eq("user_id", args.userId)
      .eq("ai_doc_type", DOC_TYPE_WACHT_OP_LIMIET)
      .select("id")
    if (error) {
      console.error("[ONTVANGEN] could not wake the paused documents after a plan change", {
        userId: args.userId, error: error.message,
      })
      return { woken: 0 }
    }
    return { woken: (data ?? []).length }
  } catch (e) {
    console.error("[ONTVANGEN] the plan-change wake-up threw", {
      userId: args.userId, error: e instanceof Error ? e.message : String(e),
    })
    return { woken: 0 }
  }
}

// ── [ONTVANGEN-MELDING] The name of the event, not of the row ────────────────────────────────

/**
 * The durable idempotency key for "this stored document finished processing by itself".
 *
 * One key per document, per event. It is handed to createNotification({ eventKey }), where the
 * partial UNIQUE (user_id, event_key) turns a second attempt into a no-op instead of a second
 * bell — see supabase/migrations/ontvangen_melding_event_key.sql.
 *
 * Derived from the document id and nothing else: not from the clock, not from the run, not from
 * what the reader concluded. A retry of a crashed run must produce the SAME key, or the guarantee
 * is a comment rather than a constraint.
 */
export function autoFinishedEventKey(documentId: string): string {
  return `intake:auto-finished:${documentId}`;
}

/**
 * [ONTVANGEN-MELDING] The durable name of "this document started waiting on you".
 *
 * One per document, for the same reason the finished-bell has one: the run that rings it can die
 * between the bell and its own end, and the owner must not be asked the same question twice from
 * two different lines in the list.
 */
export function duplicateQuestionEventKey(documentId: string): string {
  return `intake:duplicate-question:${documentId}`;
}

/**
 * [UPLOAD-TRUTH-1] The durable name of "we could not read this file, and it is waiting for you".
 *
 * The third and last terminal outcome an owner has to hear about, and the one that had no voice.
 * A finished read rings `auto-finished`; a question rings `duplicate-question`; a file the reader
 * gave up on wrote `could_not_read` to the row and told nobody. The document is safe, the file is
 * in Bestanden, and the only place it surfaces is a panel nothing points at.
 *
 * Same shape and same guarantee as its two siblings: one key per document, derived from the
 * document id alone. It is what makes the delivery RETRY safe — the notice loop may attempt this
 * notification on every pass, and the partial UNIQUE turns every attempt after the first into a
 * no-op with no second push.
 */
export function unreadableEventKey(documentId: string): string {
  return `intake:unreadable:${documentId}`;
}

// ── [ONTVANGEN] Moving a document into the owner's hands ──────────────────────────────────────

export type HoldWrite =
  /** The state changed; the document now waits on a human. */
  | { kind: "held" }
  /** Nothing was written — the row is gone, is not this owner's, or has moved on. */
  | { kind: "failed" }

/**
 * Hold a document for the owner's answer to a semantic duplicate.
 *
 * A compare-and-set on the state this run loaded, for the same reason every other final write on
 * this road is one: the owner may already have deleted the file, or a successor may already have
 * finished the job, while this run was busy asking the model.
 *
 * `wacht_op_besluit` is deliberately NOT `could_not_read`: the read succeeded, and labelling it as
 * a failure would put the document in the "Overgeslagen bij import" panel with a "Lees opnieuw"
 * button — an offer to spend another AI read on a question no read can answer. mayDrainRetry()
 * refuses this state, so the drain will not pick it up again either.
 */
export async function holdForDuplicateDecision(args: {
  documentId: string
  userId: string
  /** The waiting state this run loaded. */
  expectedAiDocType: string
  /** The invoice the reader believes this is a second copy of, when it could name one. */
  candidateInvoiceId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline?: any
  /** Injected in tests; production rings the app's one notification writer. */
  notify?: typeof createNotification
}): Promise<HoldWrite> {
  const client = args.pipeline ?? createPipelineClient()
  const notify = args.notify ?? createNotification
  try {
    // ── The candidate must be THIS owner's, proved here and not assumed ──────────────────────
    //
    // duplicate_candidate_invoice_id references invoices(id), and a foreign key proves the row
    // EXISTS — never whose it is. Today's caller finds the candidate through an owner-scoped
    // query, so there is no path that could point this at a stranger's invoice; the invariant is
    // kept anyway, because "the writer proves it too" is what stops the next caller from being the
    // one that does not.
    //
    // Unprovable means the question is not asked at all: a document held against an invoice we
    // cannot show the owner is a question they can only answer wrongly.
    if (args.candidateInvoiceId) {
      const { data: candidate, error: invErr } = await client
        .from("invoices")
        .select("id")
        .eq("id", args.candidateInvoiceId)
        .eq("receiver_id", args.userId)
        .maybeSingle()
      if (invErr) {
        console.error("[ONTVANGEN-BESLUIT] could not verify the duplicate candidate — not asking", {
          documentId: args.documentId, error: invErr.message,
        })
        return { kind: "failed" }
      }
      if (!candidate) {
        console.error("[ONTVANGEN-BESLUIT] the duplicate candidate is not this owner's — refusing to ask", {
          documentId: args.documentId,
        })
        return { kind: "failed" }
      }
    }

    const { data, error } = await client
      .from("documents")
      .update({
        ai_doc_type: DOC_TYPE_WACHT_OP_BESLUIT,
        // The reader DID run: saying otherwise would make the reader-quality panel count a
        // successful read as a failure, and would offer the owner a second read to pay for.
        ai_processed: true,
        duplicate_candidate_invoice_id: args.candidateInvoiceId,
      })
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      .eq("ai_doc_type", args.expectedAiDocType)
      .select("id")
    if (error) {
      console.error("[ONTVANGEN] could not hold the document for the owner's answer", {
        documentId: args.documentId, error: error.message,
      })
      return { kind: "failed" }
    }
    if (!(data ?? []).length) return { kind: "failed" }

    // ── The owner is told, ONCE, and by the transition ──────────────────────────────────────────
    //
    // Here rather than at the caller, because the authority for "there is a new question" is the
    // statement above: it moved the state, or it did not. A notification written from anywhere that
    // merely OBSERVES `wacht_op_besluit` would fire again on every pass that reads the row.
    //
    // And it is the last thing this function does, deliberately. The question is already durable
    // and already on the screen; the bell is how an owner who is not looking at that screen finds
    // out. A bell that could not be written must therefore not undo the hold — that would put the
    // document back in the queue to be READ again, paying for an answer we already have, to avoid
    // a missing line in a list. Logged, so it is findable, and nothing more.
    await notify({
      userId: args.userId,
      title: "1 vraag voor jou",
      body: "Deze factuur lijkt al te bestaan.",
      type: "status",
      link: "/dashboard/incoming",
      eventKey: duplicateQuestionEventKey(args.documentId),
    }).then((bel) => {
      if (!bel.ok) {
        console.error("[ONTVANGEN-MELDING] the question stands, but the owner was not told", {
          documentId: args.documentId, error: bel.error,
        })
      }
    }).catch(() => { /* createNotification does not throw; this is belt and braces */ })

    return { kind: "held" }
  } catch (e) {
    console.error("[ONTVANGEN] the duplicate hold threw", {
      documentId: args.documentId, error: e instanceof Error ? e.message : String(e),
    })
    return { kind: "failed" }
  }
}
