// npx tsx --test src/lib/read-amounts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountsToStore } from "./read-amounts";
import { zeroBtwUnexplained } from "./zero-btw";

test("[NUL-GRONDSLAG] a read split is stored exactly as read — nothing is repaired here", () => {
  assert.deepEqual(amountsToStore({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 }), {
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, baseFromGross: false,
  });
  // A split that does not add up is stored as read too: the disagreement is the only evidence
  // that something was misread, and the arithmetic gates are what judge it.
  assert.deepEqual(amountsToStore({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 130 }), {
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130, baseFromGross: false,
  });
});

test("[NUL-GRONDSLAG] an unread base becomes the GROSS, never zero — the production case", () => {
  // ATAPACK Cash & Carry 26302362, as it actually stands: € 4.917,90 of gross with a base of 0.
  const stored = amountsToStore({ totalExBtw: null, btwAmount: null, totalIncBtw: 4917.9 });
  assert.equal(stored.total_ex_btw, 4917.9, "the engine books cost from this field");
  assert.equal(stored.btw_amount, 0, "and claims nothing back on a document we could not read");
  assert.equal(stored.baseFromGross, true);
});

test("[NUL-GRONDSLAG] the fallback is never silent: its zero BTW is an unexplained one", () => {
  const stored = amountsToStore({ totalIncBtw: 4917.9 });
  assert.equal(
    zeroBtwUnexplained({ totalIncBtw: stored.total_inc_btw, btwAmount: stored.btw_amount }),
    true,
    "a row the fallback produced must land in the human queue, not book itself",
  );
});

test("[NUL-GRONDSLAG] a base of zero that was actually READ stays zero", () => {
  const stored = amountsToStore({ totalExBtw: 0, btwAmount: 0, totalIncBtw: 0 });
  assert.equal(stored.total_ex_btw, 0);
  assert.equal(stored.baseFromGross, false, "0 read is not 0 invented");
});

test("[NUL-GRONDSLAG] no money at all is not a fallback anybody needs to be told about", () => {
  assert.equal(amountsToStore({}).baseFromGross, false);
  assert.equal(amountsToStore({ totalIncBtw: 0 }).baseFromGross, false);
  assert.equal(amountsToStore({ totalIncBtw: 0.004 }).baseFromGross, false);
  assert.equal(amountsToStore({ totalIncBtw: 0.005 }).baseFromGross, true);
});

test("[NUL-GRONDSLAG] the loose 'amount' stands in for a gross that was not read", () => {
  assert.deepEqual(amountsToStore({ amount: 250 }), {
    total_ex_btw: 250, btw_amount: 0, total_inc_btw: 250, baseFromGross: true,
  });
  // …and never OVER a gross that was.
  assert.equal(amountsToStore({ totalIncBtw: 121, amount: 999 }).total_inc_btw, 121);
});

test("[NUL-GRONDSLAG] a creditnota keeps its sign — 'never zero' holds in both directions", () => {
  const stored = amountsToStore({ totalIncBtw: -121 });
  assert.equal(stored.total_ex_btw, -121);
  assert.equal(stored.baseFromGross, true, "a credit we could not split is just as unread");
});

test("[NUL-GRONDSLAG] a base read with no BTW keeps the base and deducts nothing", () => {
  const stored = amountsToStore({ totalExBtw: 100, btwAmount: null, totalIncBtw: 121 });
  assert.deepEqual([stored.total_ex_btw, stored.btw_amount, stored.baseFromGross], [100, 0, false]);
});

test("[NUL-GRONDSLAG] NaN and Infinity are not amounts", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const stored = amountsToStore({ totalExBtw: bad, btwAmount: bad, totalIncBtw: 121 });
    assert.equal(stored.total_ex_btw, 121, "an unusable base falls back like an absent one");
    assert.equal(stored.btw_amount, 0);
  }
  assert.equal(amountsToStore({ totalIncBtw: Number.NaN, amount: 50 }).total_inc_btw, 50);
});

test("[NUL-GRONDSLAG] it never invents a split out of a gross", () => {
  // 21 % of 4917,90 would be € 853,44 of voorbelasting no document supports.
  assert.equal(amountsToStore({ totalIncBtw: 4917.9 }).btw_amount, 0);
});
