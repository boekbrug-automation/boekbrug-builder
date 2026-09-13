// [WERKSTROOM-REDEN] Pure node test — run: npx tsx --test src/lib/contracts/reason-codes.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { REASON_CODES, REFUND_REASON_CODES, isReasonCode, reasonDomain } from "./reason-codes";

test("[WERKSTROOM-REDEN] every code carries the domain that refused", () => {
  // Two domains will both want `not_found`, and they are not the same refusal. The namespace is
  // the OWNER of the rule, which is also what makes "who decided this" answerable.
  for (const c of REASON_CODES) {
    assert.match(c, /^[a-z]+\.[a-z_]+$/, `${c} carries no domain`);
    assert.ok(reasonDomain(c).length > 0);
  }
  assert.equal(reasonDomain("refund.payment_gone"), "refund");
});

test("[WERKSTROOM-REDEN] the list has no duplicates and the union is the list", () => {
  assert.equal(new Set(REASON_CODES).size, REASON_CODES.length, "a code is declared twice");
  // The runtime array and the compile-time union are two spellings of one thing; they drift the
  // moment somebody adds to only one. TypeScript checks one direction, this checks the other.
  assert.deepEqual([...REASON_CODES].sort(), [...REFUND_REASON_CODES].sort());
});

test("[WERKSTROOM-REDEN] isReasonCode refuses what is not one", () => {
  for (const ok of REASON_CODES) assert.equal(isReasonCode(ok), true, `${ok} was refused`);
  for (const no of [
    "payment_gone",        // unnamespaced — the old spelling, which is exactly the drift
    "refund.",             // a namespace with no refusal
    "Refund.Payment_Gone", // casing is not a matter of taste on the wire
    "dubbel",              // an owner's disposition note, not a refusal this app produced
    "", null, undefined, 7, {},
  ]) {
    assert.equal(isReasonCode(no), false, `${String(no)} was accepted`);
  }
});
