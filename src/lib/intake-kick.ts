// src/lib/intake-kick.ts
// [ONTVANGEN] Start the work, and let the answer go.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────────────────────
//
// The response does not wait for this, and saying "Ontvangen" does not depend on it.
//
// That is not an optimisation, it is the whole point of receive-first: the moment the bytes, the
// row and the owner's intent are durable, the browser has nothing left to do. Making the kick a
// precondition would put the promise back on a network connection that may already be gone — and
// on a phone in a van, it usually is.
//
// So a kick that never starts, or dies halfway, costs exactly one thing: time. The document is
// still sitting in `wacht_op_lezen`, and the drain owns it from there. Nothing is lost, nothing is
// duplicated, and nobody has to be told.
//
// ── WHY next/server's after() ────────────────────────────────────────────────────────────────
//
// Because the platform this runs on is the one that has to keep the process alive after the
// response is flushed, and on Vercel `after` is what reaches `waitUntil` (node_modules/next/dist/
// docs/01-app/03-api-reference/04-functions/after.md). A bare floating promise would work in dev
// and be killed in production the instant the response goes out — the worst shape of bug, because
// the drain would quietly cover for it and the whole mechanism would look fine while never
// actually running.
//
// It inherits the ROUTE's maxDuration, which on /api/intake is 120 s. The document claim outlives
// that by design (STORED_DOCUMENT_CLAIM_TTL_MS is 420 s), so a kick killed at the ceiling still
// holds its claim as it dies and nobody joins it in its last second.

import { after } from "next/server"
import { processStoredDocument } from "@/lib/stored-document-processor"

/** A seam. Production passes nothing and gets `after`; a test passes its own and runs the task. */
export type Scheduler = (task: () => Promise<void>) => void

/**
 * Ask for this document to be processed, without waiting for it.
 *
 * Returns nothing and throws nothing, deliberately: there is no outcome here a caller may act on.
 * A caller that could see this fail would be tempted to tell the owner about it, and the owner has
 * already been told the only thing that is true — that we have their file.
 */
export function kickStoredDocument(args: {
  documentId: string
  ownerId: string
  deps?: {
    schedule?: Scheduler
    run?: typeof processStoredDocument
  }
}): void {
  const schedule = args.deps?.schedule ?? after
  const run = args.deps?.run ?? processStoredDocument
  try {
    schedule(async () => {
      try {
        await run({
          documentId: args.documentId,
          ownerId: args.ownerId,
          mode: "fresh_intake",
          trigger: "after_receive",
        })
      } catch (e) {
        // processStoredDocument does not throw; this is the belt for the day it does. A throw
        // inside after() is an unhandled rejection in a process nobody is watching.
        console.error("[ONTVANGEN] the after-receive pass threw", {
          documentId: args.documentId, error: e instanceof Error ? e.message : String(e),
        })
      }
    })
  } catch (e) {
    // after() itself refusing (outside a request scope, a platform without waitUntil) must not
    // reach the owner: the handoff is already durable and the drain will find it.
    console.error("[ONTVANGEN] could not schedule the after-receive pass — the drain will pick it up", {
      documentId: args.documentId, error: e instanceof Error ? e.message : String(e),
    })
  }
}
