// [BELOFTE-EN] The English promise may never outrun the Dutch one.
// Run: npx tsx --test src/lib/belofte-en.test.ts
//
// belofte-en.ts is a TRANSLATION of belofte.ts, not a second opinion. Two files that must move
// together is the cheapest arrangement for two pages — but "must move together" is a rule, and
// an unenforced rule is a wish. These are the parts where drift would cost something real.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BELOFTE_STAPPEN, BELOFTE_GERUST, PROBLEEM_KOP, PROBLEEM_1, PROBLEEM_2 } from "./belofte";
import {
  PROMISE_STEPS,
  PROMISE_REASSURE,
  PROMISE_HEAD,
  PROMISE_HEAD_2,
  PROMISE_EXPLAIN,
  PROMISE_OTHER_LANGUAGES,
  PROBLEM_HEAD,
  PROBLEM_1,
  PROBLEM_2,
} from "./belofte-en";

test("the same number of steps — a step added in one language must land in both", () => {
  // The steps are "the only task you have left". Three in Dutch and two in English would mean
  // the English reader is told they have less to do than they actually have.
  assert.equal(PROMISE_STEPS.length, BELOFTE_STAPPEN.length);
});

test("the reassurance carries the same THREE contractual commitments", () => {
  // BELOFTE_GERUST is not a slogan, it is three commitments. It changed twice, and both moves are
  // worth reading before this test is "fixed" in either direction:
  //
  //   WAS  free · no trial that expires · never charged automatically
  //   THEN your first 90 days with everything on · free after that · never charged automatically
  //   NOW  try it free · no trial that expires · never charged automatically
  //
  // [WELKOM-90] gave every new account ninety days of the Plus ceilings, so "no trial that
  // expires" stopped being true and had to go. [LAUNCH-CONTRACT] welcome_grant_retired.sql then
  // removed that automatic grant again — the free plan IS the trial now — so the ninety days
  // became a promise the product no longer keeps, on the home page, the English page, the Arabic
  // page and the sales deck at once. This test PINNED the obsolete wording while it was wrong,
  // which is how a test stops protecting a contract and starts protecting a mistake.
  //
  // What is asserted here is therefore the CURRENT contract, in both languages: three parts, a
  // free start, no expiring trial, and no automatic charge. Nothing promises a period.
  assert.equal(BELOFTE_GERUST.split("·").length, 3, "the Dutch line still has three parts");
  assert.equal(PROMISE_REASSURE.split("·").length, 3, "so must the English");
  assert.match(PROMISE_REASSURE, /[Ff]ree/);
  assert.match(PROMISE_REASSURE, /automatically/);
  // The three commitments the Dutch makes, in the Dutch line itself — this file is where the two
  // languages are compared, and a Dutch line that quietly loses one of them must fail here too.
  assert.match(BELOFTE_GERUST, /[Gg]ratis/);
  assert.match(BELOFTE_GERUST, /geen proefperiode die afloopt/);
  assert.match(BELOFTE_GERUST, /nooit automatisch afgeschreven/);
  // And the words that must not come back. A trial is a thing that ends in a charge, and this
  // product has none; a period promised in one language and not the other is the drift this file
  // exists to catch.
  assert.doesNotMatch(PROMISE_REASSURE, /\btrial\b(?! that expires)/i,
    "the English calls something a trial that does not end in a charge");
  for (const [naam, zin] of [["Dutch", BELOFTE_GERUST], ["English", PROMISE_REASSURE]] as const) {
    assert.doesNotMatch(zin, /\b90\b|\bninety\b|\bnegentig\b/i,
      `the ${naam} reassurance promises a welcome period that new accounts no longer receive`);
  }
});

test("no promise of a feature the Dutch page does not make", () => {
  // The failure mode of a translated marketing page: it reads better, so it says more. These are
  // the words that would signal a claim the product does not back — "guarantee", a tax return we
  // do not file, an accountant we are not.
  const all = [PROMISE_HEAD, PROMISE_HEAD_2, PROMISE_EXPLAIN, PROMISE_REASSURE,
               ...PROMISE_STEPS.map((s) => `${s.head} ${s.text}`)].join(" ").toLowerCase();
  for (const forbidden of ["guarantee", "we file", "tax advice", "accountant for you", "automatically correct"]) {
    assert.ok(!all.includes(forbidden), `the English promises "${forbidden}", the Dutch does not`);
  }
});

test("readers of neither language are pointed at the browser, not at a half-made page", () => {
  // We do not publish machine-translated Arabic or Turkish and present it as ours. Saying "use
  // your browser" is honest: the reader knows whose translation they are reading.
  assert.match(PROMISE_OTHER_LANGUAGES, /browser/i);
});

test("[PROBLEEM] the problem block exists in BOTH languages", () => {
  // It first went onto the English page only, which broke the rule this file exists for: the
  // English may never say more than the Dutch. Both now come from a constant, and both pages
  // render it — so the next person cannot quietly add a section to one side.
  for (const [lang, head, p1, p2] of [
    ["nl", PROBLEEM_KOP, PROBLEEM_1, PROBLEEM_2],
    ["en", PROBLEM_HEAD, PROBLEM_1, PROBLEM_2],
  ] as const) {
    assert.ok(head.length > 3, `${lang}: no heading`);
    assert.ok(p1.length > 80, `${lang}: the problem is not described`);
    assert.ok(p2.length > 80, `${lang}: the answer to it is missing`);
  }
  // The two facts that make it the DUTCH problem and not a generic one: the quarterly return
  // and the seven-year retention. Drop either and it stops being about this reader.
  assert.match(PROBLEEM_1, /BTW-aangifte/);
  assert.match(PROBLEEM_1, /zeven jaar/);
  assert.match(PROBLEM_1, /BTW return/);
  assert.match(PROBLEM_1, /seven years/);
});
