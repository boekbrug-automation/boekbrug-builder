// src/lib/stored-document-claim.ts
// [ONTVANGEN-CLAIM] One worker at a time per stored document.
//
// ── WHAT IT GUARDS ───────────────────────────────────────────────────────────────────────────
//
// After the owner hears "Ontvangen", the document is processed away from the browser. That work is
// reachable from more than one direction — the request that received it may kick it off, a drain
// may pick it up, and the owner may press something that retries it — and it ends in financial
// effect: an invoice row, a manual payment, an AI allowance charge, a notification.
//
// Two workers on the same document is therefore not an untidiness. It is the same expense booked
// twice, in omzet, in the btw-aangifte, and in the quarter an accountant signs.
//
// ── WHAT IT IS NOT ───────────────────────────────────────────────────────────────────────────
//
// It is NOT the at-most-once guarantee. That is the partial UNIQUE index on invoices.document_id,
// the replay key on apply_manual_payment, the per-document Fair Use mark, and the notification
// event_key — each of which survives a crash, which no claim can. A claim held by a process that
// dies mid-write releases nothing and knows nothing.
//
// This is the cheap half: it keeps two LIVE workers apart, so the durable guards are a backstop
// rather than the everyday mechanism, and so the logs of a healthy system do not read like a
// system constantly recovering from collisions.
//
// ── HOW ──────────────────────────────────────────────────────────────────────────────────────
//
// The [EB-RACE] primitive, unchanged, under its own key namespace. The measurement that allowed
// sharing the table: intake_claims currently holds a single row for the whole product, no "doc:"
// key has ever existed, and the longest key in it is 18 characters. The namespace is free.
//
// No in-memory lock: Vercel runs concurrent instances, and a mutex inside one of them protects
// nothing from the other.

import { acquireClaimLease, type ClaimLease, type ClaimOutcome } from "@/lib/claim-lease";

/**
 * The longest a single stored-document run can live.
 *
 * The two doors that can carry it: /api/intake sets maxDuration 120, and a drain runs on the cron
 * ceiling of 300. The claim must outlive the LONGER of them, or a slow-but-alive worker gets its
 * document taken over by the next caller and the two run together — the thing this prevents.
 */
export const STORED_DOCUMENT_MAX_SECONDS = 300;

/** The claim's life. The margin is for a worker killed AT its ceiling: its claim must still be
 *  standing when it dies, so nobody joins it in its last second. Well inside the hour-old sweep
 *  that /api/intake performs without reading the key. */
export const STORED_DOCUMENT_CLAIM_TTL_MS = (STORED_DOCUMENT_MAX_SECONDS + 120) * 1000;

/** The one key shape. A namespace, because intake_claims also holds the intake door's own keys
 *  ("nr:…") and Enable Banking's ("ebsync:…"). */
export function storedDocumentClaimKey(documentId: string): string {
  return `doc:${documentId}`;
}

export type { ClaimLease, ClaimOutcome };

/**
 * Take this document's processing claim, or refuse.
 *
 *   · held        — we are the only worker on this document. ("acquired".)
 *   · busy        — another worker has it and is alive. Leave it alone; it is being processed.
 *   · unavailable — the guarantee could not be established. Do not start: the durable guards are
 *                   a backstop against a crash, not a licence to run two workers on purpose.
 *
 * Fails CLOSED, for the [EB-RACE] reason: a document processed a minute later is recoverable, a
 * document given financial effect twice is a wrong tax return.
 */
export async function claimStoredDocument(
  ownerId: string,
  documentId: string,
  now: Date = new Date(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimStore?: { from: (table: string) => any },
): Promise<ClaimLease> {
  return acquireClaimLease({
    userId: ownerId,
    claimKey: storedDocumentClaimKey(documentId),
    ttlMs: STORED_DOCUMENT_CLAIM_TTL_MS,
    tag: "[ONTVANGEN-CLAIM]",
    // Ids only. A stored document's file name is something the owner typed or photographed.
    subject: { documentId },
    now,
    claimStore,
  });
}
