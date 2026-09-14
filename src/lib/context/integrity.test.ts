// [SAMENHANG] Pure node test — run: npx tsx --test src/lib/context/integrity.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { INTEGRITY_CHECKS, V1_FAMILIES, checksFor } from "./integrity";

test("[SAMENHANG] every V1 relationship has both a population count and a cross-tenant check", () => {
  // The two together are the unit. A cross-tenant check with nothing to check answers zero and
  // means nothing; a population count with no violation check beside it measures the wrong thing.
  for (const family of V1_FAMILIES) {
    const own = checksFor(family);
    assert.ok(own.some((c) => c.expect === "population"),
      `${family} has no population count — its zero results would be unreadable`);
    assert.ok(own.some((c) => c.expect === "zero" && c.id.startsWith("tenant.")),
      `${family} has no cross-tenant check. Acceptance criterion 7 says no relationship may cross ` +
        "a tenant boundary, and a criterion nobody measures is a wish.");
  }
});

test("[SAMENHANG] a zero-result check names the population that makes its zero believable", () => {
  const byId = new Map(INTEGRITY_CHECKS.map((c) => [c.id, c]));
  for (const c of INTEGRITY_CHECKS) {
    if (c.expect !== "zero") continue;
    assert.ok(c.believableBecause,
      `${c.id} reports a violation count with no population beside it — "0 rows leaked" is also ` +
        "what a broken probe returns");
    const pop = byId.get(c.believableBecause);
    assert.ok(pop, `${c.id} points at ${c.believableBecause}, which does not exist`);
    assert.equal(pop!.expect, "population", `${c.id} is believed because of another violation count`);
    assert.equal(pop!.family, c.family,
      `${c.id} is believed by a population from a different relationship`);
  }
});

test("[SAMENHANG] a population floor is a measured number, and a violation check has none", () => {
  for (const c of INTEGRITY_CHECKS) {
    if (c.expect === "population") {
      assert.ok(c.floor > 0,
        `${c.id} has no floor — then a run against an empty database would report a clean pass`);
    } else {
      assert.equal(c.floor, 0, `${c.id} is a violation count and carries a population floor`);
    }
  }
});

test("[SAMENHANG] every check is read-only, single-valued, and says why it can go wrong", () => {
  for (const c of INTEGRITY_CHECKS) {
    // One row, one integer column named n — the runner reads it without knowing the check.
    assert.match(c.sql, /^SELECT count\(\*\)::bigint AS n\b/,
      `${c.id} does not return exactly one count named n`);
    // Nothing that writes, and nothing that could write on a database this is pointed at.
    assert.doesNotMatch(c.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i,
      `${c.id} is not read-only. An integrity checker that can change the thing it measures is the ` +
        "one tool that must never be able to.");
    assert.ok(c.why.length >= 40,
      `${c.id} reports a number with no explanation — a finding nobody can act on is an alarm`);
    assert.ok(c.title.length >= 15, `${c.id} has no readable title`);
  }
  assert.equal(new Set(INTEGRITY_CHECKS.map((c) => c.id)).size, INTEGRITY_CHECKS.length,
    "two checks share an id");
});

test("[SAMENHANG] the money invariant is asked as a relationship question, not restated", () => {
  // The allocation rows ARE the Invoice<->Payment relationship. If the cache and the edges
  // disagree, every context answer built on those edges tells a different story from the screen —
  // which is why this check lives here and not only inside the money functions.
  const inv = INTEGRITY_CHECKS.find((c) => c.id === "shape.amount-paid-disagrees-with-allocations");
  assert.ok(inv, "the amount_paid = SUM(amount_applied) check is gone");
  assert.match(inv!.sql, /sum\(l\.amount_applied\)/, "it no longer sums the allocation rows");
  assert.match(inv!.sql, /i\.amount_paid/, "it no longer compares against the cache");
  // And the two carriers of Payment<->Bank must both be checked against each other, in the
  // direction that matters: the shortcut column may not claim what the ledger does not.
  assert.ok(INTEGRITY_CHECKS.some((c) => c.id === "agree.banktx-invoice-id-has-no-allocation"));
  assert.ok(INTEGRITY_CHECKS.some((c) => c.id === "agree.banktx-invoice-id-contradicts-allocation"));
});

test("[SAMENHANG] both directions of Invoice<->Document are checked, because both are written", () => {
  const ids = INTEGRITY_CHECKS.map((c) => c.id);
  assert.ok(ids.includes("tenant.invoice-vs-document"), "the forward direction lost its tenant check");
  assert.ok(ids.includes("tenant.document-vs-invoice"), "the reverse direction lost its tenant check");
  assert.ok(ids.includes("agree.invoice-document-one-way"),
    "nothing checks that the pair stays in step — and nothing in the database enforces it");
});
