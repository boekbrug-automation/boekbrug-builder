// src/lib/vakwoorden.test.ts — run: npx tsx --test src/lib/vakwoorden.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { VAKWOORDEN, NOT_A_DOOR, vakwoordNaar } from "./vakwoorden";

test("a profession word opens the screen that answers it", () => {
  assert.equal(vakwoordNaar("crediteuren"), "/dashboard/incoming");
  assert.equal(vakwoordNaar("debiteuren"), "/dashboard/facturen");
  assert.equal(vakwoordNaar("saldibalans"), "/dashboard/grootboek");
});

test("a word this app cannot answer gets no door at all", () => {
  // The 404 is TRUE. A redirect would claim "you asked for a memoriaalboeking, here it is" and
  // send the accountant hunting on a page that has none — they would conclude the screen is
  // broken rather than the feature absent, which is the more expensive wrong conclusion.
  for (const { woord } of NOT_A_DOOR) {
    assert.equal(vakwoordNaar(woord), null, `${woord} must not be given a door`);
  }
  assert.equal(vakwoordNaar("iets wat niet bestaat"), null);
});

test("the two lists never overlap", () => {
  const doors = new Set(VAKWOORDEN.map((v) => v.woord));
  for (const { woord } of NOT_A_DOOR) {
    assert.ok(!doors.has(woord), `${woord} is both a door and declared absent`);
  }
});

test("case and stray spaces are how people actually type", () => {
  assert.equal(vakwoordNaar("Crediteuren"), "/dashboard/incoming");
  assert.equal(vakwoordNaar("  SALDIBALANS  "), "/dashboard/grootboek");
});

test("every word is a distinct URL segment", () => {
  const woorden = VAKWOORDEN.map((v) => v.woord);
  assert.equal(new Set(woorden).size, woorden.length, "two doors on one segment is one dead route");
  for (const w of woorden) {
    assert.match(w, /^[a-z]+$/, `${w} must be a clean lowercase segment`);
  }
});

test("every door points into the dashboard, never off it", () => {
  for (const v of VAKWOORDEN) {
    assert.match(v.naar, /^\/dashboard\//, `${v.woord} leaves the app`);
  }
});

test("every row says WHY that screen is the answer", () => {
  // The reason is what makes a row checkable by a human. A door with no stated reason is a guess
  // that reads exactly like a decision.
  for (const v of VAKWOORDEN) {
    assert.ok(v.omdat.length > 20, `${v.woord} has no real reason: "${v.omdat}"`);
  }
  for (const n of NOT_A_DOOR) {
    assert.ok(n.waarom.length > 20, `${n.woord} is absent without a stated reason`);
  }
});

test("no door points at another door", () => {
  // A redirect chain would work and would still be wrong: the map would no longer say where a word
  // actually lands, and the next person to move a screen would break two hops instead of one.
  const doors = new Set(VAKWOORDEN.map((v) => `/dashboard/${v.woord}`));
  for (const v of VAKWOORDEN) {
    assert.ok(!doors.has(v.naar), `${v.woord} redirects to another redirect (${v.naar})`);
  }
});
