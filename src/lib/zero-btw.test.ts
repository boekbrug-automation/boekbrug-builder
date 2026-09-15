import test from "node:test";
import assert from "node:assert/strict";
import { zeroBtwUnexplained } from "./zero-btw";

test("[NUL-BTW-STIL] a materially-priced document with no BTW and no rate is a hole", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0 }), true);
});

test("[NUL-BTW-STIL] an explicit 0 % rate explains the zero", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0, btwRate: 0 }), false);
});

test("[NUL-BTW-STIL] a reverse charge explains the zero", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0, shifted: true }), false);
});

test("[NUL-BTW-STIL] a real BTW is never a hole", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 21, btwRate: 21 }), false);
});

test("[NUL-BTW-STIL] a rate that was read but is not zero does NOT explain a zero BTW", () => {
  // 21 % read, zero booked: that is precisely the misread the rule exists for.
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0, btwRate: 21 }), true);
});

test("[NUL-BTW-STIL] an absent BTW answers like a read zero — no voorbelasting either way", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121 }), true);
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: null }), true);
});

test("[NUL-BTW-STIL] no material total, nothing to lose", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 0, btwAmount: 0 }), false);
  assert.equal(zeroBtwUnexplained({ totalIncBtw: null, btwAmount: 0 }), false);
  assert.equal(zeroBtwUnexplained({ totalIncBtw: Number.NaN, btwAmount: 0 }), false);
});

test("[NUL-BTW-STIL] a credit note's negative gross is material too", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: -121, btwAmount: 0 }), true);
});

test("[NUL-BTW-STIL] a BTW of a few cents is real BTW, not a rounding hole", () => {
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0.01 }), false);
  assert.equal(zeroBtwUnexplained({ totalIncBtw: 121, btwAmount: 0.004 }), true);
});
