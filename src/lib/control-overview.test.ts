// src/lib/control-overview.test.ts
// [CONTROL] Run: npx tsx --test src/lib/control-overview.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { buildControlOverview, type ControlAccount } from "./control-overview";

const NU = Date.parse("2026-09-12T12:00:00Z");
const dag = (n: number) => new Date(NU + n * 86_400_000).toISOString();

const acc = (over: Partial<ControlAccount> = {}): ControlAccount => ({
  id: "a", name: "Kiwi", role: "zzper", createdAt: dag(-10),
  subscriptionStatus: null, currentPeriodEnd: null, grants: [], ...over,
});
const grant = (expires: string | null) => ({
  plan: "plus", starts_at: dag(-1), expires_at: expires, revoked_at: null,
});

test("[CONTROL] every account lands in exactly one bucket", () => {
  const o = buildControlOverview([
    acc({ id: "1", grants: [] }),                                   // free
    acc({ id: "2", grants: [grant(dag(30))] }),                     // welcome / pilot
    acc({ id: "3", subscriptionStatus: "active" }),                 // paying
    acc({ id: "4", subscriptionStatus: "past_due" }),               // grace, still paying
    acc({ id: "5", role: "accountant" }),                           // portal
  ], NU);

  assert.strictEqual(o.counts.total, 5);
  assert.strictEqual(o.counts.free, 1);
  assert.strictEqual(o.counts.granted, 1);
  assert.strictEqual(o.counts.paying, 2);
  assert.strictEqual(o.counts.accountants, 1);
  // The buckets are a partition: nothing counted twice, nothing lost.
  assert.strictEqual(o.counts.free + o.counts.granted + o.counts.paying + o.counts.accountants, o.counts.total);
});

test("[CONTROL] a payer with a grant reads as paying, not as granted", () => {
  // Otherwise the console reports a customer as being on a free period while his card is charged.
  const o = buildControlOverview([acc({ subscriptionStatus: "active", grants: [grant(dag(30))] })], NU);
  assert.strictEqual(o.counts.paying, 1);
  assert.strictEqual(o.counts.granted, 0);
  assert.strictEqual(o.rows[0]!.reason, "active");
});

test("[CONTROL] an open-ended grant is shown as open, never as a date", () => {
  const o = buildControlOverview([acc({ grants: [grant(null)] })], NU);
  assert.strictEqual(o.rows[0]!.grantOpenEnded, true);
  assert.strictEqual(o.rows[0]!.grantUntil, null);
  assert.strictEqual(o.rows[0]!.plan, "plus");
});

test("[CONTROL] newest first, and a nameless account still has a label", () => {
  const o = buildControlOverview([
    acc({ id: "oud", createdAt: dag(-100) }),
    acc({ id: "nieuw", createdAt: dag(-1), name: "   " }),
  ], NU);
  assert.deepStrictEqual(o.rows.map((r) => r.id), ["nieuw", "oud"]);
  assert.strictEqual(o.rows[0]!.name, "(zonder naam)");
});

test("[CONTROL] no revenue is computed, and that is deliberate", () => {
  const o = buildControlOverview([acc({ subscriptionStatus: "active" })], NU);
  // A `paying × price` line would be wrong in both directions on the day it is printed: a grace
  // period is not revenue, a cancellation still counts here, and Stripe knows about tax and
  // failed collections that this code does not. The figure comes from Stripe or not at all.
  assert.ok(!("mrr" in o.counts), "the console invented a revenue figure");
  assert.ok(!("revenue" in o.counts));
  assert.deepStrictEqual(
    Object.keys(o.counts).sort(),
    ["accountants", "free", "granted", "paying", "total"],
  );
});

test("[CONTROL] an empty product is an empty console, not a crash", () => {
  const o = buildControlOverview([], NU);
  assert.deepStrictEqual(o.rows, []);
  assert.strictEqual(o.counts.total, 0);
});
