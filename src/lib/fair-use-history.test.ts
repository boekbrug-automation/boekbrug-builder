// [GRENS-BLIJFT] Pure node test — run: npx tsx --test src/lib/fair-use-history.test.ts
//
// The list this rule reads is EMPTY today, so every test that matters has to supply its own
// history. The rule is tested, not the current contents of LIMIT_CHANGES — a test that only
// exercised the empty list would pass forever and prove nothing about the day it is used.

import test from "node:test";
import assert from "node:assert/strict";

import { LIMIT_CHANGES, type LimitChange } from "./fair-use-history";
import { entitledLimit, keptLimits, fairUseLimit } from "./fair-use";

const FREE_AI = fairUseLimit("aiDocuments").free;

/** The rule, with an injected history — see the header for why. */
function entitledWith(
  changes: LimitChange[],
  key: Parameters<typeof entitledLimit>[0],
  plan: Parameters<typeof entitledLimit>[1],
  startedAt: string | null,
): number {
  const original = [...LIMIT_CHANGES];
  try {
    (LIMIT_CHANGES as LimitChange[]).push(...changes);
    return entitledLimit(key, plan, startedAt);
  } finally {
    (LIMIT_CHANGES as LimitChange[]).length = 0;
    (LIMIT_CHANGES as LimitChange[]).push(...original);
  }
}

const lowering = (announcedOn: string, was: number): LimitChange => ({
  key: "aiDocuments", plan: "free", announcedOn, was, note: "test",
});

test("[GRENS-BLIJFT] with no history at all, everyone gets what we publish today", () => {
  assert.equal(entitledLimit("aiDocuments", "free", "2020-01-01"), FREE_AI);
  assert.equal(entitledLimit("aiDocuments", "free", null), FREE_AI);
  // The shipped list is empty, and that is the record — see the module header.
  assert.equal(LIMIT_CHANGES.length, 0);
});

test("[GRENS-BLIJFT] an account that lived through the announcement keeps its old limit", () => {
  // The clause in one case: the limit was 200, we announce a drop, an older account keeps 200.
  const changes = [lowering("2027-01-01", 200)];
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2026-06-01"), 200);
  // Someone who arrived AFTER the announcement gets what is published now.
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2027-06-01"), FREE_AI);
  // On the day itself the account "bestond al" — the clause says so in as many words.
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2027-01-01"), 200);
});

test("[GRENS-BLIJFT] two lowerings compose: you keep the one you actually had", () => {
  // 200 → announced 2027 → 100 → announced 2028 → today's value. Both historical values sit ABOVE what is
  // published now, or the last step would not be a lowering at all and the case would not exist.
  const changes = [lowering("2027-01-01", 200), lowering("2028-01-01", 100)];
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2026-01-01"), 200, "the oldest keeps 200");
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2027-06-01"), 100, "joined between: keeps 100");
  assert.equal(entitledWith(changes, "aiDocuments", "free", "2029-01-01"), FREE_AI, "joined after: today's");
});

test("[GRENS-BLIJFT] a RAISE reaches everybody — the clause forbids taking away, not giving", () => {
  // An account frozen out of an improvement would honour the letter and break the point.
  const raise: LimitChange = { key: "aiDocuments", plan: "free", announcedOn: "2027-01-01", was: 5, note: "test" };
  assert.equal(entitledWith([raise], "aiDocuments", "free", "2020-01-01"), FREE_AI);
});

test("[GRENS-BLIJFT] a change to one key or one plan never leaks into another", () => {
  const changes: LimitChange[] = [
    { key: "aiDocuments", plan: "free", announcedOn: "2027-01-01", was: 9999, note: "test" },
  ];
  assert.equal(entitledWith(changes, "invoicesSent", "free", "2020-01-01"), fairUseLimit("invoicesSent").free);
  assert.equal(entitledWith(changes, "aiDocuments", "plus", "2020-01-01"), fairUseLimit("aiDocuments").plus);
});

test("[GRENS-BLIJFT] an undatable account gets the MOST generous answer, never the newest", () => {
  // The two ways to be wrong are not equal. Reading an unknown date as "new" quietly withholds a
  // limit the Terms promise, and nobody would ever see it happen.
  const changes = [lowering("2027-01-01", 200)];
  for (const bad of [null, undefined, "", "  ", "ooit", "not-a-date"]) {
    assert.equal(entitledWith(changes, "aiDocuments", "free", bad as string | null), 200, `${bad} was read as new`);
  }
  // Same for a broken row in our OWN list: it may not cost somebody their ceiling.
  const brokenRow = [{ key: "aiDocuments" as const, plan: "free" as const, announcedOn: "juni", was: 200, note: "t" }];
  assert.equal(entitledWith(brokenRow, "aiDocuments", "free", "2029-01-01"), 200);
});

test("[GRENS-BLIJFT] keptLimits names only what actually differs", () => {
  // An ordinary account: nothing to explain, so no screen has to decide whether to say "same".
  assert.deepEqual(keptLimits("free", "2020-01-01"), []);
});
