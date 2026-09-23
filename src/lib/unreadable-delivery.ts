// src/lib/unreadable-delivery.ts
// [UPLOAD-TRUTH-1] Getting the "we could not read it" outcome back to the owner, and proving it.
// Run: npx tsx --test src/lib/unreadable-delivery.test.ts
//
// ── THE TWO TRUTHS, AND WHY THEY ARE DIFFERENT COLUMNS ───────────────────────────────────────
//
//   documents.ai_doc_type = 'could_not_read'   WHAT HAPPENED. Terminal. The drain's reader never
//                                              returns to it, and nothing here ever changes it.
//   notifications.event_key                    WHETHER THE OWNER WAS TOLD. A live partial UNIQUE
//                                              (user_id, event_key) makes it exactly-once.
//   documents.intake_retry_after               A WORK LIST, and nothing more: "this terminal row
//                                              still owes its owner the telling".
//
// The middle one is the guarantee; the last one is only how the work is found again. That split is
// what lets delivery be retried without the reader ever running twice.
//
// ── WHY intake_retry_after, AND WHY NOT intake_pause_reason ──────────────────────────────────
//
// `intake_retry_after` already means "this row still owes the drain a pass, not before this
// moment", and on a `could_not_read` row no READER consults it: the drain's own time gate returns
// false before reading it unless the state is `wacht_op_limiet`, and resumeVerdict() consults it
// only under isTimeGatedWait(). So nothing acts on the value we write here, and it needs no
// migration.
//
// On the WRITERS, precisely, because an earlier version of this note was wrong about one of them:
//
//   wakePausedDocumentsForPlanChange   .eq("ai_doc_type", wacht_op_limiet)   — cannot touch us
//   pauseDocumentForFairUse            .neq("ai_doc_type", wacht_op_limiet)  — NOT so filtered
//
// The second matches every state except the paused one, terminal unreadable included. It is
// aimed by id at the single document a background pass is working on, and a pass only reaches it
// through mayResume(), which refuses a terminal row — so it cannot in fact land on one. That is a
// reachability argument, not a filter, and it is the honest version. The earlier claim that "both
// are filtered on wacht_op_limiet" read like a constraint the database enforces. It is not one.
//
// `intake_pause_reason` would have been the more descriptive flag and cannot be used:
//   CHECK (intake_pause_reason IS NULL OR intake_pause_reason = 'fair_use')
// A second value there is an ALTER, and this slice is designed to require none.
//
// ── WHY THE ARM CONVERGES ────────────────────────────────────────────────────────────────────
//
// Cleared on success, so the row leaves the candidate set permanently. Steady state is zero
// candidates: no growing scan, no anti-join over every could_not_read document ever written.

import { createNotification } from "@/lib/notifications"
import { unreadableEventKey } from "@/lib/stored-document"
import { unreadableNotice } from "@/lib/unreadable-notice"
import { DOC_TYPE_COULD_NOT_READ } from "@/lib/skipped-import"
import { INTAKE_SOURCES } from "@/lib/intake-processor"

/**
 * The column written beside the terminal state to arm delivery.
 *
 * A function rather than a literal so the ONE spelling lives here, and so the gate can assert that
 * the terminal write and the repair arm the same field with the same shape.
 */
export function unreadableArmColumns(now: Date): { intake_retry_after: string } {
  return { intake_retry_after: now.toISOString() }
}

/** What one delivery attempt did. Every arm is a thing the drain has to be able to count. */
export type UnreadableDelivery =
  /** The notification row was written and the push sent. The arm is cleared. */
  | { kind: "delivered" }
  /** This event was already reported. No second row, no second push. The arm is cleared. */
  | { kind: "already_reported" }
  /** The notification did not write. The arm STAYS, and the next notice pass tries again. */
  | { kind: "failed"; error: string | null }
  /**
   * The owner WAS told, but the arm could not be cleared. Harmless and self-healing: the next pass
   * attempts the same event key, gets the uniqueness refusal, and clears again. Reported
   * separately only so a log can tell it apart from a clean run.
   */
  | { kind: "delivered_arm_kept" }
  /**
   * [UPLOAD-TRUTH-1] The document is no longer owed this notice, as of a read taken immediately
   * before the write. Nothing was sent and nothing was written.
   *
   * Reached when the owner acted between the work list being read and this delivery running:
   * pressed "Lees opnieuw" and turned the file into an invoice, or threw it away. Both take the
   * row out of the notice set, and a bell about it would point at a panel that correctly no
   * longer lists it.
   */
  | { kind: "no_longer_owed" }
  /**
   * [NO-SILENT-EMPTY] We could not establish whether this notice is still owed. NOT the same as
   * "not owed": nothing was sent, the arm stays, and the next pass asks again. Treating an
   * unreadable row as a resolved one is how a document falls silent for good.
   */
  | { kind: "unavailable"; error: string }

export interface DeliveryDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any
  notify?: typeof createNotification
  now?: Date
}

/**
 * Tell one owner that one document could not be read, and take it off the work list.
 *
 * Never throws — a delivery problem may not take down the pass that called it, and on the
 * background road there is no request to fail.
 *
 * The clear is guarded on `ai_doc_type` so a document that has MOVED on since the notification —
 * the owner pressed "Lees opnieuw" and it became an invoice — is never written to by this
 * function. The guard costs nothing and makes the write impossible to aim at the wrong row.
 */
export async function deliverUnreadableNotice(args: {
  documentId: string
  userId: string
  deps: DeliveryDeps
}): Promise<UnreadableDelivery> {
  const { documentId, userId } = args
  const notify = args.deps.notify ?? createNotification

  // [UPLOAD-TRUTH-1] Ask again, at the door.
  //
  // The work list was read at the top of the pass; this runs per document, afterwards. In between,
  // the owner can press "Lees opnieuw" and turn the file into an invoice, or throw it away — both
  // of which take the row out of the notice set. The arm-clear below is guarded and so protects
  // the WRITE, but a notification cannot be unsent: by the time the clear refuses, the bell has
  // already rung.
  //
  // This narrows that window from "the whole pass" to "one read and one insert". It does NOT
  // eliminate it — see the note on stillOwedNotice for exactly what remains and why a transaction
  // is not the answer.
  const owed = await stillOwedNotice({ documentId, userId, deps: args.deps })
  if (owed.kind === "unavailable") {
    // Not "not owed". The arm stays and the next pass asks again.
    console.error("[UPLOAD-TRUTH-1] could not confirm the notice is still owed — leaving it armed", {
      documentId, error: owed.error,
    })
    return { kind: "unavailable", error: owed.error }
  }
  if (!owed.owed) return { kind: "no_longer_owed" }

  const notice = unreadableNotice(documentId)

  // [NO-SILENT-EMPTY] createNotification does not throw; it REPORTS. `ok: false` is a failure and
  // is read as one — a caller that ignored the return value would log a success over a silence.
  const bell = await notify({
    userId,
    title: notice.title,
    body: notice.body,
    type: "status",
    link: notice.link,
    // The whole reason a retry is safe.
    eventKey: unreadableEventKey(documentId),
  })

  if (!bell.ok) {
    console.error("[UPLOAD-TRUTH-1] the unreadable notice did not write — the document stays armed", {
      documentId, error: bell.error,
    })
    return { kind: "failed", error: bell.error }
  }

  const cleared = await clearUnreadableArm({ documentId, userId, deps: args.deps })
  if (!cleared) {
    console.warn("[UPLOAD-TRUTH-1] the owner was told but the arm did not clear — the next pass will", {
      documentId,
    })
    return { kind: "delivered_arm_kept" }
  }
  return bell.duplicate === true ? { kind: "already_reported" } : { kind: "delivered" }
}

/**
 * [UPLOAD-TRUTH-1] Is this document still owed its notice, right now?
 *
 * The same five predicates the work-list selector uses, asked again about one row at the moment
 * of delivery. Re-stated here rather than shared with the selector on purpose: that one is a
 * bounded LIST query with ordering and a limit, this is a single-row existence check, and a
 * helper bent to serve both would be a helper neither reads clearly.
 *
 * ── WHAT THIS DOES AND DOES NOT GUARANTEE ────────────────────────────────────────────────────
 *
 * It does NOT make delivery serializable. There is no transaction around the read and the
 * notification insert, so a document can still change in the gap between them, and a bell can
 * still be sent for a document that stopped being owed one microseconds earlier. Nothing short of
 * a transaction or a conditional insert closes that, and neither is worth what it would cost here.
 *
 * What it does is bound the exposure to that gap instead of to the whole pass, and the residual is
 * benign in both directions:
 *
 *   over-delivery   at most ONE obsolete bell per document, ever — the partial UNIQUE on
 *                   (user_id, event_key) sees to that — pointing at a panel that simply does not
 *                   list the file. Confusing for a moment; nothing is lost.
 *   under-delivery  impossible from here. A read that fails answers `unavailable`, never "not
 *                   owed", so a document is never dropped from the work list by this check.
 *
 * Under-delivery is the thing the product guarantee is about ("any later actionable terminal
 * outcome must find its way back to the owner"), and this cannot cause it. That is why the small
 * revalidation is enough and a transactional notification path is not needed.
 */
async function stillOwedNotice(args: {
  documentId: string
  userId: string
  deps: DeliveryDeps
}): Promise<{ kind: "ok"; owed: boolean } | { kind: "unavailable"; error: string }> {
  try {
    const { data, error } = await args.deps.pipeline
      .from("documents")
      .select("id")
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      .eq("ai_doc_type", DOC_TYPE_COULD_NOT_READ)
      .not("intake_retry_after", "is", null)
      .eq("trashed", false)
      .is("invoice_id", null)
      .in("source", [...INTAKE_SOURCES])
    // [NO-SILENT-EMPTY] The error is read FIRST. `data` is null on a failed read, and `?? []`
    // would turn that into "no row matched", which reads as "not owed" — the same silent lie in
    // a smaller place.
    if (error) return { kind: "unavailable", error: String(error.message ?? "read failed") }
    return { kind: "ok", owed: ((data ?? []) as unknown[]).length > 0 }
  } catch (e) {
    return { kind: "unavailable", error: e instanceof Error ? e.message : String(e) }
  }
}

/** Take a delivered document off the work list. True when the write went through. */
async function clearUnreadableArm(args: {
  documentId: string
  userId: string
  deps: DeliveryDeps
}): Promise<boolean> {
  try {
    const { data, error } = await args.deps.pipeline
      .from("documents")
      .update({ intake_retry_after: null })
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      // Only ever the row this notice was about, in the state it was about.
      .eq("ai_doc_type", DOC_TYPE_COULD_NOT_READ)
      .select("id")
    // [UPLOAD-TRUTH-1] Rows AFFECTED, not merely "no error". A guarded UPDATE that matches nothing
    // succeeds — so `!error` would report a clear that did not happen, on exactly the row where it
    // did not happen: one that moved on between the notification and this write. Saying so keeps
    // the outcome honest and puts a line in the log where there would otherwise be silence.
    if (error) return false
    return ((data ?? []) as unknown[]).length > 0
  } catch {
    return false
  }
}

/**
 * [UPLOAD-TRUTH-1] Re-arm a terminal unreadable document whose winner armed nothing.
 *
 * The race this exists for, and it is a ROLLING DEPLOY as much as a crash:
 *
 *   worker A  loads the document, expecting `wacht_op_lezen`
 *   worker B  writes terminal `could_not_read` — on a build that knows nothing about arming
 *   worker A  compare-and-set matches zero rows, re-reads, finds a final state identical to its
 *             own conclusion, and calls it `completed_elsewhere`
 *
 * Without this, A walks away from a terminal unreadable document that carries no arm. No notice
 * pass can see it, B's build will never ring, and the owner is never told — the exact silence this
 * slice closes, reintroduced by the deploy that closes it.
 *
 * ── THE FOUR PREDICATES, AND WHAT EACH ONE FORBIDS ───────────────────────────────────────────
 *
 *   id + user_id                    this document, this owner. The tenant boundary: RLS is off on
 *                                   the pipeline client, so the statement is the only one there is.
 *   ai_doc_type = could_not_read    never arm a row that has moved on. Between the read and this
 *                                   write the owner can have pressed "Lees opnieuw" and turned it
 *                                   into an invoice; arming that would announce a failure that is
 *                                   no longer true.
 *   intake_retry_after IS NULL      idempotent. If the winner DID arm it, this writes nothing —
 *                                   and it must not refresh a date that is already ticking.
 *   source IN INTAKE_SOURCES        this door only. The e-mail road writes could_not_read too,
 *                                   through its own pipeline and its own skipped registry, and is
 *                                   not this slice's to announce.
 *
 * Deliberately NOT gated on `identical`. A terminal unreadable row owes its owner a notice whether
 * or not the winner happened to file it in the same folder this run would have chosen; folder
 * disagreement is a placement question, and silence is not its punishment.
 *
 * No AI call, no reader, no claim. One UPDATE.
 */
export async function repairUnreadableArm(args: {
  documentId: string
  userId: string
  deps: DeliveryDeps
}): Promise<boolean> {
  const now = args.deps.now ?? new Date()
  try {
    const { data, error } = await args.deps.pipeline
      .from("documents")
      .update(unreadableArmColumns(now))
      .eq("id", args.documentId)
      .eq("user_id", args.userId)
      .eq("ai_doc_type", DOC_TYPE_COULD_NOT_READ)
      .is("intake_retry_after", null)
      .in("source", [...INTAKE_SOURCES])
      .select("id")
    if (error) {
      console.error("[UPLOAD-TRUTH-1] could not repair the delivery arm", {
        documentId: args.documentId, error: error.message,
      })
      return false
    }
    return (data ?? []).length > 0
  } catch (e) {
    console.error("[UPLOAD-TRUTH-1] the arm repair threw", {
      documentId: args.documentId, error: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
