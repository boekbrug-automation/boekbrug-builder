// src/lib/settlement-key.ts
// [ONTVANGEN] The same document, settled twice, must be one booking — not two.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// apply_manual_payment is already crash-safe. Measured in the migration that defines it: given a
// client_key it has seen before on the SAME (user_id, invoice_id) it returns the original applied
// amount with `replayed = true` and writes no money; given a key spent on other money it raises
// 55000, with wording chosen so the incasso triage cannot mistake a refusal for a no-op.
//
// The engine is right. The caller is the defect: the intake processor hands it randomUUID(), so
// every attempt is a booking the RPC has never seen. Under the synchronous door that was almost
// harmless — one request, one attempt, an error the owner could see. After receive-first a drain
// retries on its own, and each retry would pay the same bon again.
//
// So the key must be a FUNCTION of what is being settled, not of when we happened to try.
//
// ── WHY v5 AND NOT A COUNTER OR A COLUMN ─────────────────────────────────────────────────────
//
// The RPC's column is a uuid, so the key has to be one. A stored column would work too, but it
// needs a migration, a write before the first settlement, and a read on every retry — three more
// things that can be half-done at a crash. A derived key needs none of that: it is the same value
// on every machine, on every deploy, forever, with nothing to persist and nothing to lose.
//
// Namespaces keep the domains apart. The owner's own "Markeer als betaald" must never be able to
// collide with an automatic settlement of the same invoice — a collision there would make one of
// them a silent replay of the other, which is the one outcome worse than a duplicate.

import { createHash } from "node:crypto"

/** RFC 4122 §4.3 — SHA-1 of (namespace bytes ‖ name), with the version and variant bits set. */
function uuidV5(name: string, namespaceUuid: string): string {
  const ns = Buffer.from(namespaceUuid.replace(/-/g, ""), "hex")
  if (ns.length !== 16) throw new Error("[ONTVANGEN] a uuid namespace must be 16 bytes")
  const digest = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest()
  const b = Buffer.from(digest.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = b.toString("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** The standard URL namespace, so our own namespaces are derived rather than invented. */
const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"

/**
 * One namespace per kind of settlement.
 *
 * Written as URLs rather than opaque uuids so the next reader can see what each one IS, and so a
 * third kind is added by naming it rather than by generating a constant nobody can check.
 */
export const SETTLEMENT_NAMESPACES = {
  /** A bon that pays itself off at intake — [BON-AUTO]. */
  intakeAutoSettle: uuidV5("https://boekbrug.nl/ns/intake-auto-settle", URL_NAMESPACE),
} as const

/**
 * The idempotency key for automatically settling the receipt stored as `documentId`.
 *
 * One document, one automatic settlement, one key — forever. A retry after any crash hands the
 * RPC the key it already has, and the RPC answers with the booking it already made.
 */
export function autoSettlementKey(documentId: string): string {
  const id = String(documentId ?? "").trim()
  if (!id) throw new Error("[ONTVANGEN] an auto-settlement key needs the document it settles")
  return uuidV5(id, SETTLEMENT_NAMESPACES.intakeAutoSettle)
}
