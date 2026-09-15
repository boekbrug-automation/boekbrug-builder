// npx tsx --test src/lib/geleerd-sindsdien.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnedSince, READER_CAPABILITIES } from "./geleerd-sindsdien";

const ignored = (over: Partial<Parameters<typeof learnedSince>[0]> = {}) => ({
  status: "archived", direction: "incoming", hasFile: true,
  flags: ["sum_mismatch"], heldAt: "2026-07-09T09:03:04.319Z", ...over,
});

test("[GELEERD-SINDSDIEN] the production case: held in July, the reader learned in August", () => {
  // ATAPACK Cash & Carry, held 2026-07-09 on sum_mismatch, file still attached.
  const v = learnedSince(ignored());
  assert.equal(v.worthOffering, true);
  assert.deepEqual(v.gained, ["btw_split", "statiegeld"]);
});

test("[GELEERD-SINDSDIEN] held AFTER the reader learned is not offered — it already knew", () => {
  // Five of the 45 are this shape. Offering them a second read promises something we have no
  // reason to believe.
  assert.deepEqual(learnedSince(ignored({ heldAt: "2026-09-01T10:00:00Z" })), {
    worthOffering: false, gained: [],
  });
  // Between the two capabilities: only the later one is new to this invoice.
  const between = learnedSince(ignored({ heldAt: "2026-08-20T10:00:00Z" }));
  assert.deepEqual(between.gained, ["statiegeld"]);
  assert.equal(between.worthOffering, true);
});

test("[GELEERD-SINDSDIEN] the day it landed is not 'before' it", () => {
  assert.deepEqual(learnedSince(ignored({ heldAt: "2026-08-18T00:00:01Z" })).gained, ["statiegeld"]);
  assert.deepEqual(learnedSince(ignored({ heldAt: "2026-08-26T23:59:59Z" })), { worthOffering: false, gained: [] });
});

test("[GELEERD-SINDSDIEN] a hold with no date claims nothing", () => {
  for (const heldAt of [null, undefined, "", "  ", "onbekend", "gisteren"]) {
    assert.equal(learnedSince(ignored({ heldAt })).worthOffering, false, String(heldAt));
  }
});

test("[GELEERD-SINDSDIEN] no file means nothing to read again", () => {
  assert.equal(learnedSince(ignored({ hasFile: false })).worthOffering, false);
  assert.equal(learnedSince(ignored({ hasFile: undefined })).worthOffering, false);
});

test("[GELEERD-SINDSDIEN] only what the owner actually set aside, and only a purchase", () => {
  assert.equal(learnedSince(ignored({ status: "processing" })).worthOffering, false);
  assert.equal(learnedSince(ignored({ status: "paid" })).worthOffering, false);
  assert.equal(learnedSince(ignored({ direction: "outgoing" })).worthOffering, false);
});

test("[GELEERD-SINDSDIEN] a hold for a reason no capability answers is left alone", () => {
  assert.equal(learnedSince(ignored({ flags: ["duplicate"] })).worthOffering, false);
  assert.equal(learnedSince(ignored({ flags: [] })).worthOffering, false);
  assert.equal(learnedSince(ignored({ flags: null })).worthOffering, false);
  // …and a real flag beside an unknown one still counts.
  assert.equal(learnedSince(ignored({ flags: ["duplicate", "sum_mismatch"] })).worthOffering, true);
});

test("[GELEERD-SINDSDIEN] blank and null entries in the flag list are not flags", () => {
  assert.equal(learnedSince(ignored({ flags: ["", "  "] })).worthOffering, false);
});

test("[GELEERD-SINDSDIEN] every capability names a real day and something it explains", () => {
  assert.ok(READER_CAPABILITIES.length > 0);
  for (const c of READER_CAPABILITIES) {
    assert.match(c.since, /^\d{4}-\d{2}-\d{2}$/, `${c.key} has no landing day`);
    assert.ok(c.explains.length > 0, `${c.key} explains nothing, so it can never fire`);
  }
});
