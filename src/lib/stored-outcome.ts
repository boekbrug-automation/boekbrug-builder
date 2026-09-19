// src/lib/stored-outcome.ts
// [ONTVANGEN] What a background pass must WRITE, read off what the door answered.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// The door answers a REQUEST: a status, a body, sometimes a library-built Response with headers a
// browser reads. Under receive-first there is no browser. The same answers now have to become
// durable state, because the only thing that decides whether this document is ever looked at again
// is the state on its row.
//
// Get that mapping wrong in one direction and a document is dropped; wrong in the other and it is
// re-read forever. Both are silent. So the mapping is a pure function over the answer, with no
// database in it, and it is tested by value.
//
// ── THE ONE THAT COSTS REAL MONEY ────────────────────────────────────────────────────────────
//
// A SEMANTIC duplicate ("deze factuur bestaat al — F-2026-14 van Jansen") is a question for the
// owner, and the reader has already run by the time it is asked. If that answered "try again
// later", every drain pass would pay for the same AI read of the same document, forever, and
// nothing would fail: the owner would see one waiting document and we would see the bill.
//
// It is therefore an OWNER DECISION state, which mayDrainRetry() refuses to pick up — the owner
// answers it in the app, and the answer is what moves it on. The owner's rule, in their words:
// "the processor may retry infrastructure failures automatically; it may NOT retry a genuine
// owner-decision state as if more compute will solve it."

import { PAUSE_REASON_FAIR_USE } from "@/lib/fair-use-pause"
import type { FairUseKey } from "@/lib/fair-use"
import type { IntakeOutcome } from "@/lib/intake-processor"

export type StoredVerdict =
  /** The door finished. It has already written the final state itself (the compare-and-set). */
  | { kind: "done" }
  /** The month's allowance refused the read. Pause until the 1st, and tell the owner once. */
  | { kind: "pause_fair_use"; reason: typeof PAUSE_REASON_FAIR_USE; metric: FairUseKey }
  /**
   * The reader ran and found this invoice already booked from a DIFFERENT file. Only a human can
   * say whether that is the same bill; more compute cannot. Hold it for the owner.
   */
  | { kind: "owner_decision"; candidateInvoiceId: string | null }
  /** Something transient. Leave the document waiting exactly as it is; the next pass tries again. */
  | { kind: "retry_later"; why: string }

/** Narrow a json body without pretending to know more about it than it says. */
function body(outcome: IntakeOutcome): Record<string, unknown> | null {
  if (outcome.kind !== "json") return null
  return typeof outcome.body === "object" && outcome.body !== null
    ? (outcome.body as Record<string, unknown>)
    : null
}

export function readStoredOutcome(outcome: IntakeOutcome): StoredVerdict {
  // The quota gate is a DOMAIN outcome precisely so it does not have to be recognised from a
  // status code. See IntakeOutcome's "paused" arm.
  if (outcome.kind === "paused") {
    return { kind: "pause_fair_use", reason: outcome.reason, metric: outcome.metric }
  }
  // A library-built Response (rate limit, storage) carries no domain fact we can act on, and both
  // of the things that produce one are transient by nature.
  if (outcome.kind === "response") {
    return { kind: "retry_later", why: `response:${outcome.response.status}` }
  }

  const b = body(outcome)
  if (outcome.status === 409 && b?.duplicate === true) {
    // [INTAKE-CLAIM] The in-flight 409 is another WORKER, not another invoice. It is the claim
    // doing its job, and the answer is to come back — never to ask the owner a question about a
    // document that is being processed right now.
    if (b.inFlight === true) return { kind: "retry_later", why: "in_flight" }
    // [INTAKE-FORCE] canForce marks the SEMANTIC match: same invoice, different file, and it can
    // be a false positive. That is exactly the judgement a human makes and a retry cannot.
    if (b.canForce === true) {
      const candidate = typeof b.original_id === "string" ? b.original_id : null
      return { kind: "owner_decision", candidateInvoiceId: candidate }
    }
    // A byte-hash 409 cannot reach a stored run — the row IS the document this pass loaded — so
    // reaching here means the door changed shape. Retrying is the safe reading: it writes nothing.
    return { kind: "retry_later", why: "duplicate_unexpected" }
  }

  if (outcome.status >= 200 && outcome.status < 300) return { kind: "done" }
  return { kind: "retry_later", why: `status:${outcome.status}` }
}
