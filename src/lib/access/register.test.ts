// [EEN-POORT] Pure node test — run: npx tsx --test src/lib/access/register.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { ACCESS_REGISTER, FROZEN_CLASSES, mechanism } from "./register";

test("[EEN-POORT] the register names each mechanism once and says what it decides", () => {
  const keys = ACCESS_REGISTER.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, "a mechanism is registered twice");
  for (const m of ACCESS_REGISTER) {
    assert.ok(m.decides.length > 10, `${m.key} does not say what it decides`);
    assert.ok(m.note.length > 30, `${m.key} does not say why its ceiling is where it is`);
    assert.ok(m.needle.length > 3, `${m.key} cannot be measured`);
    assert.ok(m.ceiling >= 0, `${m.key} has a negative ceiling`);
  }
});

test("[EEN-POORT] forbidden means zero, and canonical is the only class allowed to grow", () => {
  for (const m of ACCESS_REGISTER) {
    if (m.klass === "forbidden") assert.equal(m.ceiling, 0, `${m.key} is forbidden but allowed ${m.ceiling}`);
    if (FROZEN_CLASSES.includes(m.klass) && m.klass !== "forbidden") {
      assert.ok(m.ceiling > 0, `${m.key} is frozen at zero — that is 'forbidden', say so`);
    }
  }
  // There is at least one canonical answer for the question the legacy ones also answer, or the
  // register describes a migration with no destination.
  assert.ok(ACCESS_REGISTER.some((m) => m.klass === "canonical" && m.key === "resolveActingContext"));
  assert.ok(ACCESS_REGISTER.some((m) => m.klass === "canonical" && m.key === "authorize"));
});

test("[EEN-POORT] the one thing the browser may never decide is registered as forbidden", () => {
  const m = mechanism("frontend-organization");
  assert.ok(m, "an acting organization supplied by the client is not even registered");
  assert.equal(m.klass, "forbidden");
  assert.equal(m.ceiling, 0);
});

test("[EEN-POORT] RLS and the RPC caller guards are layers, not duplicate policies", () => {
  // Classing them 'legacy' would invite somebody to remove a floor in the name of tidiness.
  for (const key of ["rls-policy", "rpc-caller-guard"]) {
    assert.equal(mechanism(key)?.klass, "canonical", `${key} is not classed as an enforcement layer`);
  }
});
