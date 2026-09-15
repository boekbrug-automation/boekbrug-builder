// npx tsx --test src/lib/btw-ongecontroleerd.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { btwUncheckable } from "./btw-ongecontroleerd";

test("[BTW-ONGECONTROLEERD] a blended rate with no block is the case nothing else sees", () => {
  // The shape: 9 % food and 21 % non-food on one wholesale invoice, summarised into one figure.
  // ex + btw = incl holds by construction, and 12,4 % is not a rate anyone can check.
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 124 }), true);
});

test("[BTW-ONGECONTROLEERD] the per-rate block IS the check — with it, nothing to say", () => {
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 124, hasRateBlock: true }), false);
});

test("[BTW-ONGECONTROLEERD] a legal rate proves itself", () => {
  for (const [ex, btw] of [[100, 21], [100, 9], [100, 0.001], [3413.92, 716.92]] as const) {
    assert.equal(btwUncheckable({ totalExBtw: ex, btwAmount: btw }), false, `${ex}/${btw}`);
  }
});

test("[BTW-ONGECONTROLEERD] a few cents of rounding is still that rate, not a blend", () => {
  // A supplier who rounds per line drifts from the product; that is not an unverifiable document.
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 210.4 }), false, "21,04 %");
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 89.5 }), false, "8,95 %");
  // …but a real blend is far outside that.
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 150 }), true, "15 %");
});

test("[BTW-ONGECONTROLEERD] above 21 % is WRONG, not unverifiable — the gates refuse it already", () => {
  assert.equal(btwUncheckable({ totalExBtw: 100, btwAmount: 30 }), false, "30 % is impossible here");
  // Just inside the rounding tolerance is still 21 %. The value EXACTLY on the boundary is not
  // tested on purpose: (21.6 / 100) * 100 is 21.600000000000005 in IEEE754, so an assertion there
  // would be about floating point rather than about this rule.
  assert.equal(btwUncheckable({ totalExBtw: 100, btwAmount: 21.5 }), false, "still 21 %");
  assert.equal(btwUncheckable({ totalExBtw: 100, btwAmount: 22.5 }), false, "over the top rate");
});

test("[BTW-ONGECONTROLEERD] nothing reclaimed, nothing to doubt", () => {
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 0 }), false);
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: null }), false);
});

test("[BTW-ONGECONTROLEERD] a reverse charge is a different mechanism", () => {
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: 124, shifted: true }), false);
});

test("[BTW-ONGECONTROLEERD] no base, no rate to compute", () => {
  assert.equal(btwUncheckable({ totalExBtw: 0, btwAmount: 124 }), false);
  assert.equal(btwUncheckable({ totalExBtw: null, btwAmount: 124 }), false);
  assert.equal(btwUncheckable({ totalExBtw: Number.NaN, btwAmount: 124 }), false);
  assert.equal(btwUncheckable({ totalExBtw: 1000, btwAmount: Number.POSITIVE_INFINITY }), false);
});

test("[BTW-ONGECONTROLEERD] a creditnota's negative pair reads by its rate, not its sign", () => {
  assert.equal(btwUncheckable({ totalExBtw: -1000, btwAmount: -124 }), true);
  assert.equal(btwUncheckable({ totalExBtw: -100, btwAmount: -21 }), false);
});
