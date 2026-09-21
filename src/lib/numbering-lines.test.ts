// src/lib/numbering-lines.test.ts
// Run: npx tsx --test src/lib/numbering-lines.test.ts
//
// [KANTOOR-PERIODE] The numbering sentences now have two readers — the owner's panel and the
// accountant's period workspace. These pin the pieces so a rewording happens in one place, and so
// the two audiences keep the two different sentences Batch 1 decided on.

import test from "node:test";
import assert from "node:assert/strict";

import {
  numberingLines,
  numberingLineText,
  numberingProblems,
  numberingUnreadableText,
  seriesLabel,
} from "./numbering-lines";
import type { SeriesReport } from "./invoice-continuity";
import { translator } from "./i18n/t";

const t = translator("nl");

const series = (over: Partial<SeriesReport> = {}): SeriesReport => ({
  type: "factuur",
  year: 2026,
  first: 1,
  last: 3,
  issued: 3,
  missing: [],
  burnedAtEnd: 0,
  duplicates: [],
  ...over,
} as SeriesReport);

test("[KANTOOR-PERIODE] a healthy series produces no line at all", () => {
  assert.deepEqual(numberingProblems([series()]), []);
  assert.deepEqual(numberingLines([series()], t, "accountant"), []);
});

test("[KANTOOR-PERIODE] the series names its own year, whatever quarter is on screen", () => {
  assert.equal(seriesLabel(series({ year: 2025 }), t), "Facturen 2025");
  assert.equal(seriesLabel(series({ type: "creditnota", year: 2026 }), t), "Creditnota's 2026");
  // A series with no year in its numbers is named without one, never with today's.
  assert.equal(seriesLabel(series({ year: null }), t), "Facturen");
});

test("[KANTOOR-PERIODE] the three faults are three separate pieces", () => {
  const [line] = numberingLines(
    [series({ missing: [2], last: 4, duplicates: ["2026-0003"], burnedAtEnd: 1 })],
    t,
    "accountant",
  );
  assert.equal(line.label, "Facturen 2026");
  assert.ok(line.missing?.includes("2"), line.missing ?? "(geen)");
  assert.ok(line.burned, "the burned number said nothing");
  assert.ok(line.duplicates?.includes("2026-0003"), line.duplicates ?? "(geen)");
  // Joined for a reader with no room for a bold label — one space, nothing invented.
  assert.equal(numberingLineText(line), [line.label, line.missing, line.burned, line.duplicates].join(" "));
});

test("[KANTOOR-PERIODE] an empty series and a burned tail are two different sentences", () => {
  // [REEKS-ZONDER-FACTUUR] "at the end of the series" presupposes a series; issued === 0 means
  // nothing was ever written under that counter, and that has a different answer to it.
  const leeg = numberingLines([series({ type: "creditnota", issued: 0, first: null, last: null, burnedAtEnd: 1 })], t, "accountant")[0];
  const staart = numberingLines([series({ burnedAtEnd: 1 })], t, "accountant")[0];
  assert.ok(leeg.burned && staart.burned);
  assert.notEqual(leeg.burned, staart.burned, "the empty series borrowed the burned-tail sentence");
});

test("[KANTOOR-PERIODE] the owner and the accountant keep their own wording", () => {
  const input = [series({ type: "creditnota", issued: 0, first: null, last: null, burnedAtEnd: 1 })];
  const eigenaar = numberingLines(input, t, "owner")[0];
  const kantoor = numberingLines(input, t, "accountant")[0];
  assert.notEqual(eigenaar.burned, kantoor.burned, "both audiences got the same sentence again");
  // The owner's is the one that speaks to a person about their own books.
  assert.match(eigenaar.burned!, /\bje\b/);
  assert.doesNotMatch(kantoor.burned!, /\bje\b/);
});

test("[KANTOOR-PERIODE] unreadable numbers are named, and capped at eight", () => {
  assert.equal(numberingUnreadableText([], t, "accountant"), null);
  const twaalf = Array.from({ length: 12 }, (_, i) => `OUD-${i}`);
  const zin = numberingUnreadableText(twaalf, t, "accountant")!;
  assert.ok(zin.includes("OUD-7"), zin);
  assert.ok(!zin.includes("OUD-8"), "more than eight numbers were listed");
  // The two audiences differ here too.
  assert.notEqual(numberingUnreadableText(twaalf, t, "owner"), zin);
});
