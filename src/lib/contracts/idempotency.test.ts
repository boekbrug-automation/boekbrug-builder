// [CONTRACT] Pure node test — run: npx tsx --test src/lib/contracts/idempotency.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { deriveKey, isKeyShaped } from "./idempotency";
import { feeClientKey } from "../mollie-settlement";

test("[CONTRACT] the same event always derives the same key", () => {
  const a = deriveKey("mollie-fee", "stl_1", "inv_1");
  assert.equal(a, deriveKey("mollie-fee", "stl_1", "inv_1"));
  // Different parts, different key — including a swap, which a naive concat could collide on.
  assert.notEqual(a, deriveKey("mollie-fee", "inv_1", "stl_1"));
  assert.notEqual(a, deriveKey("email-confirm-pay", "stl_1", "inv_1"));
});

test("[CONTRACT] the key is uuid-shaped, because the column is uuid", () => {
  for (const k of [
    deriveKey("mollie-fee", "a", "b"),
    deriveKey("email-confirm-pay", ""),
    deriveKey("email-confirm-pay", "een naam met spaties en éé"),
  ]) {
    assert.ok(isKeyShaped(k), `${k} would be refused by a uuid column`);
  }
  for (const bad of ["", "not-a-uuid", "12345678-1234-1234-1234-12345678901", null, 7]) {
    assert.equal(isKeyShaped(bad), false, `${String(bad)} passed the shape test`);
  }
});

test("[CONTRACT] feeClientKey is BYTE-IDENTICAL to what it wrote before this module existed", () => {
  // THE test of this file. feeClientKey has been keying Mollie fee bookings since August; the
  // partial unique index on client_key is what stops the same settlement's fee being booked twice.
  // A different derivation would re-key an event we already booked, and the index would then let
  // the second booking through — the exact double booking this module exists to prevent.
  //
  // These two literals were computed from the ORIGINAL implementation before it was changed to
  // delegate. If this test goes red, the delegation changed the answer: revert it, do not
  // re-record the literals.
  assert.equal(
    feeClientKey("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"),
    "35416a54-4674-5b8e-aad3-8cba5ce9f496",
  );
  assert.equal(feeClientKey("stl_abc", "inv_xyz"), "bf3395b2-2a3b-5c53-ade9-7ed7588fa1a2");
  // …and it is now literally the shared derivation, not a second copy that happens to agree today.
  assert.equal(feeClientKey("stl_abc", "inv_xyz"), deriveKey("mollie-fee", "stl_abc", "inv_xyz"));
});
