// [OPSLAG-DEUR] The storage arithmetic, without a database.
//
// storageFits() is the one rule two very different callers share: an API route that owes the owner
// a 402, and a background sync that owes him a HOLD. The properties below are the ones where being
// wrong is silent — the owner is refused, or quietly overflows, and neither says why.
//
// Run: npx tsx --test src/lib/storage-room.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { storageFits, type StorageRoom } from "./fair-use-gate";

const MB = 1024 * 1024;
const free = (usedMb: number): StorageRoom => ({ measurable: true, usedMb, limitMb: 50, plan: "free" });

test("[OPSLAG-DEUR] a file that fits is admitted, one that does not is refused", () => {
  assert.equal(storageFits(free(10), 5 * MB), true);
  assert.equal(storageFits(free(48), 1 * MB), true, "49 of 50 still fits");
  assert.equal(storageFits(free(49), 2 * MB), false, "51 of 50 does not");
});

test("[OPSLAG-DEUR] the boundary is refused, not rounded through", () => {
  // Exactly on the line: 50 of 50 is admitted (nothing is over), 50 + a byte is not. A refusal must
  // never be a rounding away from the number the owner reads on his own meter.
  assert.equal(storageFits(free(50), 0), true, "already at the limit, adding nothing");
  assert.equal(storageFits(free(50), 1), false, "one byte over is over");
  assert.equal(storageFits(free(49), 1 * MB), true);
  assert.equal(storageFits(free(49), 1 * MB + 1), false, "a byte past a whole megabyte rounds UP");
});

test("[OPSLAG-DEUR] a run's files are rounded once, together", () => {
  // THE BUG THIS PINS. Rounding each file up on its own would charge every 10 kB receipt a full
  // megabyte: a hundred of them would report 100 MB against a 50 MB plan holding barely one.
  const hundredSmallFiles = 100 * 10 * 1024; // ~0.95 MB in total
  assert.equal(
    storageFits(free(1), 10 * 1024, hundredSmallFiles - 10 * 1024),
    true,
    "a hundred 10 kB receipts are one megabyte, not a hundred",
  );
  // …and the accumulation is still real: enough bytes DO fill it.
  assert.equal(storageFits(free(1), 10 * 1024, 49 * MB), false);
});

test("[OPSLAG-DEUR] what cannot be measured is never a violation", () => {
  // Fail open, like every other fair-use fence: a storage figure we could not read is not evidence
  // that somebody is over, and refusing on our own outage would stop an owner filing a bill he is
  // legally required to keep.
  const unmeasurable: StorageRoom = { measurable: false, usedMb: 0, limitMb: 0, plan: "free" };
  assert.equal(storageFits(unmeasurable, 10_000 * MB), true);
});

test("[OPSLAG-DEUR] a plan with no ceiling counts but never refuses", () => {
  // 0 means "no ceiling" for the same reason it does in fair_use_consume and in the AI share:
  // measure before you limit. This is what Plus has — commercial use under Fair Use, not a quota.
  const plus: StorageRoom = { measurable: true, usedMb: 900_000, limitMb: 0, plan: "plus" };
  assert.equal(storageFits(plus, 10_000 * MB), true);
});

test("[OPSLAG-DEUR] nonsense sizes cannot buy room", () => {
  // A negative byte count must not shrink the total — that would be a way to write past the limit.
  assert.equal(storageFits(free(50), -5 * MB), true, "negative reads as zero, and 50 of 50 fits");
  assert.equal(storageFits(free(49), 1 * MB, -100 * MB), true, "a negative history cannot free space");
  assert.equal(storageFits(free(49), 2 * MB, -100 * MB), false);
});
