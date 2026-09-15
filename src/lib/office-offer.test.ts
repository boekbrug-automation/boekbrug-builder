// src/lib/office-offer.test.ts
// [GEEN-PROVISIE] Run: npx tsx --test src/lib/office-offer.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { OFFICE_GETS, OFFICE_NEVER_GETS, REJECTED_MODELS, unavailableBenefits } from "./office-offer";

test("[GEEN-PROVISIE] every benefit is one an office can check today", () => {
  assert.ok(OFFICE_GETS.length >= 3, "the offer thinned out to almost nothing");
  assert.deepStrictEqual(
    unavailableBenefits().map((b) => b.heading),
    [],
    "a benefit was added that the office cannot have yet — that is a roadmap, not an offer",
  );
});

test("[GEEN-PROVISIE] nothing in the offer is a share of the client's money", () => {
  // The words a percentage arrives under. They may appear in the refusal and in the reasons for
  // the closed shapes; they may not appear in the list of what an office GETS.
  const geld = /provisie|commissie|marge|percentage|vergoeding per klant|kickback/i;
  for (const benefit of OFFICE_GETS) {
    assert.doesNotMatch(`${benefit.heading} ${benefit.body}`, geld,
      `"${benefit.heading}" offers a cut of the subscription`);
  }
});

test("[GEEN-PROVISIE] the refusal says no, and says it about today", () => {
  assert.match(OFFICE_NEVER_GETS.body, /Nee/, "the refusal no longer refuses");
  assert.match(OFFICE_NEVER_GETS.body, /niet 'nog niet'/,
    "the refusal reads as a delay — which is an invitation to keep asking");
  // The reason handed to the office is the office's own, not ours. A refusal argued from our
  // margin invites the counter-offer; one argued from their client's trust does not.
  assert.match(OFFICE_NEVER_GETS.body, /aanbeveling/, "the refusal argues from our books instead of their advice");
});

test("[GEEN-PROVISIE] every closed shape carries the reason it was closed", () => {
  assert.ok(REJECTED_MODELS.length >= 3, "the closed shapes were quietly dropped");
  for (const rejected of REJECTED_MODELS) {
    assert.ok(rejected.reason.trim().length > 40,
      `"${rejected.model}" is refused without a reason a reader can argue with`);
    assert.notStrictEqual(rejected.model.trim(), "", "a nameless model was refused");
  }
  // The three shapes an office actually proposes, each answered by name. A list that skips one is
  // a list that will be tested with exactly that one.
  const alles = REJECTED_MODELS.map((r) => r.model).join(" ").toLowerCase();
  for (const vorm of ["provisie", "marge", "wederverkoop"]) {
    assert.ok(alles.includes(vorm), `the shape "${vorm}" is not answered anywhere`);
  }
});
