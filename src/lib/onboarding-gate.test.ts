// [ONBOARDING-GATE] Pure node test — run: npx tsx --test src/lib/onboarding-gate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { onboardingGate, HOME_PATH, ONBOARDING_PATH } from "./onboarding-gate";
import type { ProfileRead } from "./profile-read";

type Read = ProfileRead<{ onboarding_done: boolean | null }>;
const done: Read = { kind: "row", row: { onboarding_done: true } };
const notDone: Read = { kind: "row", row: { onboarding_done: false } };
const missing: Read = { kind: "missing" };
const failed: Read = { kind: "failed", code: "42501", message: "permission denied for table profiles" };

const DEEP = [
  "/dashboard/bank",
  "/dashboard/facturen",
  "/dashboard/kas",
  "/dashboard/incoming/manage",
  "/dashboard/invoice/abc-123",
  "/dashboard/settings/team",
  "/dashboard/accountant",
  "/dashboard/verkoop",
];

test("1. a row with onboarding done is allowed through, on the home and on every deep route", () => {
  assert.deepEqual(onboardingGate({ read: done, pathname: "/dashboard/bank" }), { action: "allow" });
  for (const p of [HOME_PATH, ...DEEP]) {
    assert.deepEqual(onboardingGate({ read: done, pathname: p }), { action: "allow" }, p);
  }
});

test("2. a row with onboarding not done goes to the wizard, wherever it was heading", () => {
  for (const p of [HOME_PATH, ...DEEP]) {
    assert.deepEqual(onboardingGate({ read: notDone, pathname: p }), { action: "redirect", to: ONBOARDING_PATH }, p);
  }
  // null is not done either: the trigger writes false, and a null here is nobody's proof.
  assert.deepEqual(
    onboardingGate({ read: { kind: "row", row: { onboarding_done: null } }, pathname: HOME_PATH }),
    { action: "redirect", to: ONBOARDING_PATH },
  );
});

test("3. a genuinely missing profile goes to the wizard, which is where the row gets created", () => {
  for (const p of [HOME_PATH, ...DEEP]) {
    assert.deepEqual(onboardingGate({ read: missing, pathname: p }), { action: "redirect", to: ONBOARDING_PATH }, p);
  }
});

test("4. a failed read on exactly /dashboard is left to the page, which classifies it and fails honestly", () => {
  assert.deepEqual(onboardingGate({ read: failed, pathname: "/dashboard" }), { action: "allow" });
  // A trailing slash is the same page.
  assert.deepEqual(onboardingGate({ read: failed, pathname: "/dashboard/" }), { action: "allow" });
});

test("5. a failed read on a deep route is sent to /dashboard — never allowed through, never to the wizard", () => {
  assert.deepEqual(onboardingGate({ read: failed, pathname: "/dashboard/bank" }), { action: "redirect", to: HOME_PATH });
  for (const p of DEEP) {
    const gate = onboardingGate({ read: failed, pathname: p });
    assert.notEqual(gate.action, "allow", `${p}: an unreadable profile opened a deep route as though the gate had passed`);
    assert.deepEqual(gate, { action: "redirect", to: HOME_PATH }, p);
  }
});

test("[NO-SILENT-EMPTY] the invariant: an unreadable profile is never onboarding state, and never a deeper route", () => {
  // Every path shape a dashboard link can take, including ones nobody has written a rule for.
  const paths = [HOME_PATH, "/dashboard/", ...DEEP, "/dashboard/x/y/z", "/dashboard/bank?quarter=2026-Q2"];
  for (const p of paths) {
    const gate = onboardingGate({ read: failed, pathname: p.split("?")[0] });
    if (gate.action === "redirect") assert.notEqual(gate.to, ONBOARDING_PATH, `${p}: a failed read became an onboarding decision`);
    if (gate.action === "allow") assert.equal(p.replace(/\/+$/, ""), HOME_PATH, `${p}: a failed read continued into a deeper route`);
  }
  // …and nothing in the "failed" branch depends on the row it does not have.
  const failedWithoutMessage: Read = { kind: "failed", code: null, message: "unknown error" };
  assert.deepEqual(onboardingGate({ read: failedWithoutMessage, pathname: "/dashboard/kas" }), { action: "redirect", to: HOME_PATH });
});
