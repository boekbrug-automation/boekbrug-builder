// src/lib/plan-grants.test.ts
// [TOEKENNING] Run: npx tsx --test src/lib/plan-grants.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { daysLeftOnGrant, grantStanding, type PlanGrantRow } from "./plan-grants";

const NOW = Date.parse("2026-09-12T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

const rij = (over: Partial<PlanGrantRow> = {}): PlanGrantRow => ({
  plan: "plus",
  starts_at: day(-1),
  expires_at: day(30),
  revoked_at: null,
  ...over,
});

test("[TOEKENNING] no rows is no grant, and never a crash", () => {
  for (const leeg of [null, undefined, [] as PlanGrantRow[]]) {
    assert.deepStrictEqual(grantStanding(leeg, NOW), { grantedPlusUntil: null, grantOpenEnded: false });
  }
});

test("[TOEKENNING] a running grant gives its end date", () => {
  const standing = grantStanding([rij()], NOW);
  assert.strictEqual(standing.grantOpenEnded, false);
  assert.strictEqual(Date.parse(standing.grantedPlusUntil!), Date.parse(day(30)));
});

test("[TOEKENNING] the three ways a grant does not count", () => {
  // Revoked early — the row stays, because the reason it existed is part of the record.
  assert.strictEqual(grantStanding([rij({ revoked_at: day(-1) })], NOW).grantedPlusUntil, null);
  // Starts next month: a promise, not an entitlement.
  assert.strictEqual(grantStanding([rij({ starts_at: day(10), expires_at: day(40) })], NOW).grantedPlusUntil, null);
  // Expired.
  assert.strictEqual(grantStanding([rij({ expires_at: day(-1) })], NOW).grantedPlusUntil, null);
  // Exactly now is over: an inclusive end would keep a grant alive on the millisecond it dies.
  assert.strictEqual(grantStanding([rij({ expires_at: new Date(NOW).toISOString() })], NOW).grantedPlusUntil, null);
});

test("[TOEKENNING] the LAST end date wins when several run at once", () => {
  const standing = grantStanding(
    [rij({ expires_at: day(5) }), rij({ expires_at: day(60) }), rij({ expires_at: day(20) })],
    NOW,
  );
  assert.strictEqual(Date.parse(standing.grantedPlusUntil!), Date.parse(day(60)),
    "an office pilot must not be shortened by a welcome period that ends sooner");
});

test("[TOEKENNING] an open-ended grant is its own fact, never a fake year", () => {
  const standing = grantStanding([rij({ expires_at: null })], NOW);
  assert.strictEqual(standing.grantOpenEnded, true);
  assert.strictEqual(standing.grantedPlusUntil, null,
    "an open grant invented an end date — 9999 in a date field is how date maths becomes a billing bug");
  // And it survives beside a dated one.
  const beide = grantStanding([rij({ expires_at: null }), rij({ expires_at: day(10) })], NOW);
  assert.strictEqual(beide.grantOpenEnded, true);
  assert.strictEqual(Date.parse(beide.grantedPlusUntil!), Date.parse(day(10)));
});

test("[TOEKENNING] an unreadable or unknown row grants nothing", () => {
  for (const kapot of [
    rij({ expires_at: "morgen" }),
    rij({ starts_at: "" }),
    rij({ starts_at: null }),
    rij({ plan: "goud" }),
    rij({ plan: null }),
  ]) {
    assert.deepStrictEqual(grantStanding([kapot], NOW), { grantedPlusUntil: null, grantOpenEnded: false },
      `a broken row granted Plus: ${JSON.stringify(kapot)}`);
  }
});

test("[TOEKENNING] the days left are whole, never zero and never infinite", () => {
  assert.strictEqual(daysLeftOnGrant(grantStanding([rij({ expires_at: day(30) })], NOW), NOW), 30);
  // Part of a day still reads as a day: "nog 0 dagen" beside a working account is a lie.
  const bijna = grantStanding([rij({ expires_at: new Date(NOW + 3_600_000).toISOString() })], NOW);
  assert.strictEqual(daysLeftOnGrant(bijna, NOW), 1);
  // Nothing running, and never-ending, both say nothing rather than a number.
  assert.strictEqual(daysLeftOnGrant(grantStanding([], NOW), NOW), null);
  assert.strictEqual(daysLeftOnGrant(grantStanding([rij({ expires_at: null })], NOW), NOW), null);
});
