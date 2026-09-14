// src/lib/contracts/idempotency.ts
// [CONTRACT] The one way this app derives an idempotency key. Pure, no I/O.
// Run: npx tsx --test src/lib/contracts/idempotency.test.ts
//
// ── WHY A CONTRACT MODULE AT ALL ────────────────────────────────────────────────────────────
//
// Measured before this file existed: idempotency exists in the repo in seven mutually unrelated
// notions, nineteen modules mention the word, and `ls src/lib | grep -i idempot` returned nothing.
// The single column that carries it — bank_tx_invoices.client_key, a uuid guarded by a partial
// unique index — was fed by FOUR different derivation schemes, one of which minted a fresh random
// uuid per call and was therefore decorative rather than idempotent ([PAY-IDEMPOTENT] found and
// fixed that one; nothing stopped the next).
//
// A key is not a formatting detail. Two writers that derive it differently for the same event do
// not collide, and not colliding is exactly what a double booking IS. So there is one derivation,
// it is here, and it is tested against the literal values already in production.
//
// ── TWO KINDS OF KEY, AND ONLY ONE OF THEM IS THIS FILE'S ───────────────────────────────────
//
//   · DERIVED — the same event always yields the same key: a Mollie settlement's fee, a
//     confirmation of invoice X. The caller names the event; this file names the key. That is
//     what deriveKey() is for.
//   · MINTED — a key the CLIENT creates once and re-sends on retry (a browser dialog opening,
//     a webhook we did not originate). Those are crypto.randomUUID() at the edge and must be
//     minted once and held, never re-minted per attempt. This file deliberately offers no
//     mint(): a helper here would be called inside a retry loop within the week.
//
// ── UUID-SHAPED, BECAUSE THE COLUMN IS ─────────────────────────────────────────────────────
//
// client_key is `uuid`. The shape below is the one mollie-settlement.ts's feeClientKey has been
// writing since August, byte for byte — see the test, which pins its historical output. Changing
// the shape would silently re-key every future booking of an event we already booked, and the
// unique index would then let the second one through. That is the failure this file prevents,
// so it may not be the failure this file causes.

import { createHash } from "crypto";

/**
 * The namespace of an event class. One per kind of thing that can be booked twice.
 *
 * A closed union rather than a free string: the whole value of one derivation is lost if two
 * callers spell the same namespace differently, and "mollie-fee" vs "mollie_fee" is a Tuesday.
 */
export type IdempotencyNamespace =
  /** The Mollie settlement fee invoice, keyed on (settlement row, invoice). Since August 2026. */
  | "mollie-fee"
  /** A purchase invoice the owner confirmed as already paid from the verify queue. */
  | "email-confirm-pay"
  /**
   * A manual payment booked through /api/invoice/pay-toggle, keyed on the BOOKING — invoice,
   * amount, date, method — and not on the attempt.
   *
   * The browser mints its own key per dialog opening and that one wins when it is sent, because
   * it can tell two identical instalments apart and this derivation cannot. What this namespace
   * is for is the caller that sends NONE: the key was optional at that door, and optional means a
   * retried POST or a double tap books the instalment twice, since LEAST() clamps over-payment
   * but does not deduplicate. Deriving from the booking refuses the retry and still allows a
   * genuinely different instalment, which is the safe direction for the one case it cannot
   * separate.
   */
  | "manual-pay";

/**
 * A stable uuid-shaped key for one event.
 *
 * Deterministic: the same parts always give the same key, on every server, forever. That is the
 * whole point — a retry, a redelivery and a second tab must all arrive at the SAME key so the
 * unique index can refuse the second write.
 *
 * SHA-1 and not SHA-256: this is not a security primitive, it is a collision-resistant name, and
 * the digest already in production is SHA-1. Truncating a different hash to the same 32 hex
 * characters would produce different keys for events already booked.
 */
export function deriveKey(namespace: IdempotencyNamespace, ...parts: string[]): string {
  const h = createHash("sha1").update([namespace, ...parts].join(":")).digest("hex");
  // Formatted as a v5-shaped uuid: version nibble 5, variant nibble a. Not a real RFC-4122 v5
  // (that hashes a namespace uuid); it only has to be a valid uuid literal and stable.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Is this a value the uuid column will accept? Used by routes that receive a key from a client. */
export function isKeyShaped(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
