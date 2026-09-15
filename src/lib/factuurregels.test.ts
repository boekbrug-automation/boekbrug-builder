// npx tsx --test src/lib/factuurregels.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFromLines } from "./factuurregels";

test("[REGELS] the Albert Heijn shape: two rates, no summary block, lines that add up", () => {
  const r = splitFromLines({
    lines: [
      { description: "Boodschappen", btwRate: 9, amount: 8.5 },
      { description: "Kantoorartikelen", btwRate: 21, amount: 12.95 },
    ],
    totalExBtw: 21.45,
    btwAmount: 3.48, // 0,765 + 2,7195 → 0,77 + 2,72
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.rows, [
    { rate: 9, base: 8.5, btw: 0.77 },
    { rate: 21, base: 12.95, btw: 2.72 },
  ]);
  assert.equal(r.btw, 3.49);
});

test("[REGELS] the constraint it restores: a misread line breaks the BTW anchor", () => {
  // The Enka Horeca shape from btw-split.ts — but with the base right and one line's rate wrong.
  // On a mixed-rate invoice nothing else in this app can see that; here the printed BTW does.
  const r = splitFromLines({
    lines: [
      { btwRate: 9, amount: 1101.38 },
      { btwRate: 9, amount: 112.12 }, // truly 21 %
    ],
    totalExBtw: 1213.5,
    btwAmount: 122.64, // what 9 % + 21 % actually gives
  });
  assert.deepEqual(r, { ok: false, reason: "btw_mismatch" });
});

test("[REGELS] and it PASSES when the lines do reproduce the printed BTW", () => {
  const r = splitFromLines({
    lines: [{ btwRate: 9, amount: 1101.38 }, { btwRate: 21, amount: 112.12 }],
    totalExBtw: 1213.5,
    btwAmount: 122.66, // 99,12 + 23,55  (rounded per group)
  });
  assert.equal(r.ok, true);
});

test("[REGELS] lines that do not add up to the document's base are not a split OF it", () => {
  const r = splitFromLines({
    lines: [{ btwRate: 21, amount: 50 }],
    totalExBtw: 100,
    btwAmount: 21,
  });
  assert.deepEqual(r, { ok: false, reason: "base_mismatch" });
});

test("[REGELS] one line without a rate makes the whole grouping a guess", () => {
  for (const bad of [null, undefined, 6, 12.5, Number.NaN] as (number | null | undefined)[]) {
    const r = splitFromLines({
      lines: [{ btwRate: 21, amount: 100 }, { btwRate: bad as number, amount: 100 }],
      totalExBtw: 200, btwAmount: 42,
    });
    assert.deepEqual(r, { ok: false, reason: "rate_missing" }, String(bad));
  }
});

test("[REGELS] one line without an amount refuses the document, not just the line", () => {
  const r = splitFromLines({
    lines: [{ btwRate: 21, amount: 100 }, { btwRate: 9, amount: null }],
    totalExBtw: 100, btwAmount: 21,
  });
  assert.deepEqual(r, { ok: false, reason: "amount_missing" });
});

test("[REGELS] no lines is no answer, never an empty split", () => {
  assert.deepEqual(splitFromLines({ lines: [], totalExBtw: 100, btwAmount: 21 }), { ok: false, reason: "no_lines" });
  assert.deepEqual(splitFromLines({ lines: null, totalExBtw: 100, btwAmount: 21 }), { ok: false, reason: "no_lines" });
  assert.deepEqual(splitFromLines({ lines: undefined, totalExBtw: 100, btwAmount: 21 }), { ok: false, reason: "no_lines" });
});

test("[REGELS] both anchors are REQUIRED — a missing one is a refusal, not a pass", () => {
  const lines = [{ btwRate: 21, amount: 100 }];
  assert.deepEqual(splitFromLines({ lines, totalExBtw: null, btwAmount: 21 }), { ok: false, reason: "base_mismatch" });
  assert.deepEqual(splitFromLines({ lines, totalExBtw: 100, btwAmount: null }), { ok: false, reason: "btw_mismatch" });
});

test("[REGELS] many lines at one rate are one row, and cent-drift does not scale with them", () => {
  const lines = Array.from({ length: 40 }, () => ({ btwRate: 21, amount: 2.5 }));
  const r = splitFromLines({ lines, totalExBtw: 100, btwAmount: 21 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.rows.length, 1, "one rate is one row however many lines carry it");
  assert.deepEqual(r.rows[0], { rate: 21, base: 100, btw: 21 });
});

test("[REGELS] a 0 %-line is a real line and belongs in the split", () => {
  // Statiegeld: printed, part of the base, and carrying no BTW at all.
  const r = splitFromLines({
    lines: [{ description: "Frisdrank", btwRate: 9, amount: 100 }, { description: "Statiegeld", btwRate: 0, amount: 15 }],
    totalExBtw: 115,
    btwAmount: 9,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.rows, [{ rate: 0, base: 15, btw: 0 }, { rate: 9, base: 100, btw: 9 }]);
});

test("[REGELS] a creditnota's negative lines split like any other", () => {
  const r = splitFromLines({
    lines: [{ btwRate: 21, amount: -100 }],
    totalExBtw: -100,
    btwAmount: -21,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.rows[0], { rate: 21, base: -100, btw: -21 });
});
