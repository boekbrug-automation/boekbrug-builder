// [TOEKENNING-DEUR] Pure node test — run: npx tsx --test src/lib/plan-grant-actions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  planGrantVerdict,
  isRevokable,
  GRANT_MAX_YEARS,
  GRANT_REASON_MAX,
  type GrantRequest,
} from "./plan-grant-actions";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ask = (over: Partial<GrantRequest> = {}): GrantRequest => ({
  plan: "plus",
  reason: "Pilot kantoor Van Dijk, 20 klanten",
  expiresAt: "2027-03-01T00:00:00Z",
  openEnded: false,
  ...over,
});

test("[TOEKENNING-DEUR] an ordinary dated grant passes, cleaned", () => {
  const v = planGrantVerdict(ask({ reason: "  Pilot kantoor Van Dijk  " }), NOW);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.plan, "plus");
  // The CLEANED reason comes back, so the route writes what was judged and not what was posted.
  assert.equal(v.reason, "Pilot kantoor Van Dijk");
  assert.equal(v.expiresAt, "2027-03-01T00:00:00.000Z");
});

test("[TOEKENNING-DEUR] a blank end date is refused, never read as forever", () => {
  // THE trap. In SQL `expires_at NULL` is the deliberate founding-partner case; through a form it
  // is a field somebody did not fill in. The same value cannot be both.
  for (const blank of ["", "   ", null]) {
    const v = planGrantVerdict(ask({ expiresAt: blank as string | null, openEnded: false }), NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.refusal, "end-not-declared", `${JSON.stringify(blank)} was read as a decision`);
  }
  // …and the deliberate path works, because it was ticked.
  const open = planGrantVerdict(ask({ expiresAt: null, openEnded: true }), NOW);
  assert.equal(open.ok, true);
  if (!open.ok) return;
  assert.equal(open.expiresAt, null);
});

test("[TOEKENNING-DEUR] a date AND 'no end' together is unclear, so it is refused", () => {
  const v = planGrantVerdict(ask({ expiresAt: "2027-03-01", openEnded: true }), NOW);
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.refusal, "end-with-open-ended");
});

test("[TOEKENNING-DEUR] a mistyped year is caught, which the table's own CHECK cannot do", () => {
  // 2035 for 2025 is in the future and after the start, so every constraint on plan_grants is
  // satisfied. Only a horizon catches it.
  const far = planGrantVerdict(ask({ expiresAt: "2035-03-01T00:00:00Z" }), NOW);
  assert.equal(far.ok, false);
  if (far.ok) return;
  assert.equal(far.refusal, "end-too-far");

  // Just inside the horizon still passes — the bound is a guard, not a policy about arrangements.
  const inside = new Date(NOW + (GRANT_MAX_YEARS * 365 - 1) * 86_400_000).toISOString();
  assert.equal(planGrantVerdict(ask({ expiresAt: inside }), NOW).ok, true);
});

test("[TOEKENNING-DEUR] a grant that is already over is refused", () => {
  for (const past of ["2026-09-13T11:59:59Z", "2020-01-01"]) {
    const v = planGrantVerdict(ask({ expiresAt: past }), NOW);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.refusal, "end-in-past");
  }
  // Exactly now is not the future either.
  const exact = planGrantVerdict(ask({ expiresAt: new Date(NOW).toISOString() }), NOW);
  assert.equal(exact.ok, false);
});

test("[TOEKENNING-DEUR] the reason bounds mirror the table, so the refusal is a sentence", () => {
  assert.equal(planGrantVerdict(ask({ reason: "  " }), NOW).ok, false);
  assert.equal(planGrantVerdict(ask({ reason: "ab" }), NOW).ok, false);
  assert.equal(planGrantVerdict(ask({ reason: "abc" }), NOW).ok, true);
  assert.equal(planGrantVerdict(ask({ reason: "x".repeat(GRANT_REASON_MAX) }), NOW).ok, true);
  const long = planGrantVerdict(ask({ reason: "x".repeat(GRANT_REASON_MAX + 1) }), NOW);
  assert.equal(long.ok, false);
  if (long.ok) return;
  assert.equal(long.refusal, "reason-too-long");
});

test("[TOEKENNING-DEUR] a plan the table cannot hold is refused here, not by the database", () => {
  for (const plan of ["", "gratis", "premium", "PLUS", "boekhouder"]) {
    const v = planGrantVerdict(ask({ plan }), NOW);
    assert.equal(v.ok, false, `${plan} was accepted`);
    if (v.ok) return;
    assert.equal(v.refusal, "unknown-plan");
  }
});

test("[TOEKENNING-DEUR] an unreadable date is refused rather than becoming an open grant", () => {
  const v = planGrantVerdict(ask({ expiresAt: "volgende lente" }), NOW);
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.refusal, "end-not-readable");
});

test("[TOEKENNING-DEUR] a withdrawal happens once: the second click writes nothing", () => {
  assert.equal(isRevokable({ revoked_at: null }), true);
  // Re-stamping would replace who stopped it and when — the one fact a withdrawal records.
  assert.equal(isRevokable({ revoked_at: "2026-09-01T10:00:00Z" }), false);
  assert.equal(isRevokable(null), false);
  assert.equal(isRevokable(undefined), false);
});
