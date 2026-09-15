// src/lib/reconcile-sequence.test.ts
// [RECONCILE-VOLGORDE] The sequence's own semantics: membership, order, authority, and the filter
// both orchestrators read it through.
//
// What is deliberately NOT here: calling a pass. Every `run` reaches a real helper that reaches a
// real database, and this file runs under `tsx --test` with no module mocks. The half that CAN be
// proved without a database — that a pass writes with the client its declared authority allows,
// and that neither orchestrator calls a helper behind the sequence's back — is proved by the
// [RECONCILE-VOLGORDE] gates in lifecycle-gates.test.ts, which read the source.
//
// Run: npx tsx --test src/lib/reconcile-sequence.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { RECONCILE_PASSES, passesFor, type ReconcilePassId, type ReconcileCaller } from "./reconcile-sequence";

// The contract, spelled out once here so a change to the sequence has to be a change to a test
// somebody reads. Order is part of it — see each pass's `why`.
const EXPECTED: readonly { id: ReconcilePassId; authority: string; runsIn: readonly ReconcileCaller[] }[] = [
  { id: "bank-auto-confirm", authority: "actor-pay", runsIn: ["cron", "manual"] },
  { id: "cash-settle", authority: "actor-pay", runsIn: ["cron", "manual"] },
  { id: "auto-categorize", authority: "service-role", runsIn: ["cron", "manual"] },
  { id: "incasso-settle", authority: "actor-pay", runsIn: ["cron"] },
  { id: "incasso-propose", authority: "service-role", runsIn: ["cron"] },
];

test("[RECONCILE-VOLGORDE] the reconcile circle is exactly these passes, in this order", () => {
  assert.deepEqual(
    RECONCILE_PASSES.map((p) => p.id),
    EXPECTED.map((e) => e.id),
    "the pass list or its order changed. Order is contract, not style: the bank pass books on real " +
      "evidence and every pass after it makes a weaker claim about the same invoices, so the evidence " +
      "must arrive first. Change this only with the `why` on the pass changed too");
});

test("[RECONCILE-VOLGORDE] every pass declares an authority, and it is one of the two", () => {
  for (const p of RECONCILE_PASSES) {
    assert.ok(p.authority === "actor-pay" || p.authority === "service-role",
      `${p.id} declares authority '${p.authority}', which is neither of the two roles a client can play`);
    const expected = EXPECTED.find((e) => e.id === p.id);
    assert.ok(expected, `${p.id} is not in this test's expected contract`);
    assert.equal(p.authority, expected.authority,
      `${p.id} changed authority. That decides whether it books as the ACTING OWNER or as service-role, ` +
        `which is the difference between the accountant-'verwerkt' trigger firing with a real auth.uid() and not`);
  }
});

test("[RECONCILE-VOLGORDE] every pass says which orchestrators run it, and none runs nowhere", () => {
  for (const p of RECONCILE_PASSES) {
    assert.ok(p.runsIn.length > 0, `${p.id} runs in no orchestrator at all — then it is not a pass, it is dead code`);
    const expected = EXPECTED.find((e) => e.id === p.id)!;
    assert.deepEqual([...p.runsIn], [...expected.runsIn],
      `${p.id} changed which orchestrators run it. A pass moving between the cron and the button is a ` +
        `change of WHO books and under what authority, never a tidy-up`);
  }
});

test("[RECONCILE-VOLGORDE] every pass writes down WHY, because the next reader's instinct is to unify", () => {
  for (const p of RECONCILE_PASSES) {
    assert.ok(p.why.length > 80,
      `${p.id} has no real reason written on it. The two cron-only passes exist BECAUSE moving them ` +
        `would change authorization semantics; a list without that reason is the drift again, one level up`);
  }
});

test("[RECONCILE-VOLGORDE] pass ids are unique", () => {
  const ids = RECONCILE_PASSES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "two passes share an id — a caller's switch would then answer for both");
});

test("[RECONCILE-VOLGORDE] passesFor hands each orchestrator its own passes, in the declared order", () => {
  const cron = passesFor("cron").map((p) => p.id);
  const manual = passesFor("manual").map((p) => p.id);

  assert.deepEqual(cron, ["bank-auto-confirm", "cash-settle", "auto-categorize", "incasso-settle", "incasso-propose"],
    "the hourly cron's passes changed");
  assert.deepEqual(manual, ["bank-auto-confirm", "cash-settle", "auto-categorize"],
    "the button's passes changed. It runs three of the five, and the two it does not run say why on themselves");

  // The drift this whole file exists to end, stated as the thing that must stay TRUE: the button's
  // passes are the cron's passes, in the cron's order, with nothing of its own and nothing reordered.
  // Being behind is allowed — being behind INVISIBLY is not, which is why each absence is declared.
  assert.deepEqual(manual, cron.filter((id) => manual.includes(id)),
    "the button runs a pass the cron does not, or runs the shared passes in a different order");
  for (const id of manual) {
    assert.ok(cron.includes(id), `the button runs '${id}' and the hourly cron does not — a tap would then do work the schedule never repeats`);
  }
});

test("[RECONCILE-VOLGORDE] a pass every orchestrator skips cannot hide in the list", () => {
  // Reading it the other way: every declared pass is claimed by at least one of the two callers
  // that exist. A third caller name would fail here rather than quietly running nothing.
  const callers: ReconcileCaller[] = ["cron", "manual"];
  for (const p of RECONCILE_PASSES) {
    assert.ok(p.runsIn.every((c) => callers.includes(c)),
      `${p.id} names an orchestrator that does not exist — passesFor() would never return it`);
    assert.ok(p.runsIn.some((c) => passesFor(c).some((q) => q.id === p.id)),
      `${p.id} is declared but passesFor() returns it to nobody`);
  }
});
