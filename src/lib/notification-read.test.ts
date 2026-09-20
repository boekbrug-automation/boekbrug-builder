// [MELDING-WAARHEID] Pure node test — run: npx tsx --test src/lib/notification-read.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { markedRead, rolledBack, isUnread, unreadIds } from "./notification-read";

const rows = [
  { id: "n-1", read: false },
  { id: "n-2", read: false },
  { id: "n-3", read: true },
  { id: "n-4", read: null },
];

test("the badge counts the rows the store says are unread, and a row with no answer counts as unread", () => {
  assert.deepEqual(unreadIds(rows, {}), ["n-1", "n-2", "n-4"]);
});

test("a local mark clears the badge at once", () => {
  const after = markedRead({}, ["n-1", "n-2", "n-4"]);
  assert.deepEqual(unreadIds(rows, after), []);
  assert.equal(isUnread(rows[0], after), false);
});

test("[NO-SILENT-EMPTY] a rollback restores the row truth exactly — failed persistence never stays 'read'", () => {
  const ids = unreadIds(rows, {});
  const marked = markedRead({}, ids);
  const back = rolledBack(marked, ids);
  assert.deepEqual(back, {});
  assert.deepEqual(unreadIds(rows, back), unreadIds(rows, {}));
});

test("a rollback touches only the ids it is given — an earlier, stored mark survives", () => {
  const stored = markedRead({}, ["n-1"]); // the store accepted this one earlier
  const attempt = markedRead(stored, ["n-2", "n-4"]); // "Alles gelezen" on the rest
  const back = rolledBack(attempt, ["n-2", "n-4"]); // …which the store refused
  assert.deepEqual(back, { "n-1": true });
  assert.deepEqual(unreadIds(rows, back), ["n-2", "n-4"]);
});

test("marking or rolling back nothing returns the same object, so React sees no change", () => {
  const o = { "n-1": true };
  assert.equal(markedRead(o, []), o);
  assert.equal(rolledBack(o, []), o);
});
