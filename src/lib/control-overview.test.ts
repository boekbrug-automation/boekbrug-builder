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
let grantNr = 0;
const grant = (expires: string | null, over: { reason?: string; revoked_at?: string | null } = {}) => ({
  id: `g${++grantNr}`,
  plan: "plus", starts_at: dag(-1), expires_at: expires, revoked_at: null,
  reason: "Welkomstperiode: eerste 90 dagen",
  ...over,
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

// ── [TOEKENNING-DEUR] Which grants the console may offer to withdraw ─────────────────────────

test("[TOEKENNING-DEUR] only a RUNNING grant is offered for withdrawal", () => {
  const o = buildControlOverview([
    acc({ id: "loopt", grants: [grant(dag(30), { reason: "Pilot kantoor Van Dijk" })] }),
    acc({ id: "open", grants: [grant(null, { reason: "Partnerafspraak" })] }),
    acc({ id: "verlopen", grants: [grant(dag(-5))] }),
    acc({ id: "ingetrokken", grants: [grant(dag(30), { revoked_at: dag(-1) })] }),
    acc({ id: "geen", grants: [] }),
  ], NU);
  const byId = new Map(o.rows.map((r) => [r.id, r]));

  // A running grant, dated: one entry, carrying the id a withdrawal names and the reason a person
  // recognises it by.
  const loopt = byId.get("loopt")!.openGrants;
  assert.strictEqual(loopt.length, 1);
  assert.strictEqual(loopt[0].reason, "Pilot kantoor Van Dijk");
  assert.ok(loopt[0].id.length > 0);

  // Open-ended is running too — no end date is not the same as no grant.
  assert.strictEqual(byId.get("open")!.openGrants.length, 1);
  assert.strictEqual(byId.get("open")!.openGrants[0].expiresAt, null);

  // Expired, revoked and absent are all "nothing to stop". Offering to withdraw something that is
  // not doing anything is how an operator convinces themselves they fixed a problem.
  assert.strictEqual(byId.get("verlopen")!.openGrants.length, 0);
  assert.strictEqual(byId.get("ingetrokken")!.openGrants.length, 0);
  assert.strictEqual(byId.get("geen")!.openGrants.length, 0);
});

test("[TOEKENNING-DEUR] a grant that has not started yet is not offered either", () => {
  const later = { ...grant(dag(60)), starts_at: dag(7) };
  const o = buildControlOverview([acc({ id: "straks", grants: [later] })], NU);
  assert.strictEqual(o.rows[0].openGrants.length, 0);
  // …and it is not counted as a reason for the plan, for the same reason.
  assert.strictEqual(o.rows[0].plan, "free");
});
