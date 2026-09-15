// [ONDERHANDEN-WERK] Pure node test — run: npx tsx --test src/lib/onderhanden-werk.test.ts
//
// This figure goes on a balance sheet and into a profit the Belastingdienst reads, so the tests
// are about the two ways it can be wrong: counting work that was already billed, and missing
// December work that was billed in January.

import { test } from "node:test";
import assert from "node:assert/strict";

import { workInProgress, endOfYear, type WipEntry } from "./onderhanden-werk";

const hour = (over: Partial<WipEntry> = {}): WipEntry => ({
  client_id: "c1", worked_on: "2026-12-18", hours: 4, hourly_rate: 95,
  invoice_id: null, billable: true, ...over,
});

test("[ONDERHANDEN-WERK] uninvoiced hours worked before the cutoff are the figure", () => {
  const wip = workInProgress({ entries: [hour(), hour({ hours: 2 })], until: endOfYear(2026) });
  assert.equal(wip.value, 570, "4 × 95 + 2 × 95");
  assert.equal(wip.hours, 6);
  assert.equal(wip.clients.length, 1);
  assert.equal(wip.oldest, "2026-12-18");
});

test("[ONDERHANDEN-WERK] December work invoiced in January is work in progress on 31 December", () => {
  // The whole reason this module exists. Without the invoice date it would look settled.
  const wip = workInProgress({
    entries: [hour({ invoice_id: "inv-jan" })],
    until: endOfYear(2026),
    invoiceDateById: { "inv-jan": "2027-01-12" },
  });
  assert.equal(wip.value, 380, "on 31 December that invoice did not exist yet");
  assert.equal(wip.unknownInvoices, 0);
});

test("[ONDERHANDEN-WERK] work invoiced before the cutoff is not carried into the year", () => {
  const wip = workInProgress({
    entries: [hour({ invoice_id: "inv-dec" })],
    until: endOfYear(2026),
    invoiceDateById: { "inv-dec": "2026-12-20" },
  });
  assert.equal(wip.value, 0);
  assert.equal(wip.clients.length, 0);
});

test("[ONDERHANDEN-WERK] an invoice on the cutoff day itself counts as invoiced", () => {
  const wip = workInProgress({
    entries: [hour({ invoice_id: "inv-31" })],
    until: endOfYear(2026),
    invoiceDateById: { "inv-31": "2026-12-31" },
  });
  assert.equal(wip.value, 0, "billed on 31 December is billed in the old year");
});

test("[ONDERHANDEN-WERK] hours worked after the cutoff belong to the next year", () => {
  const wip = workInProgress({ entries: [hour({ worked_on: "2027-01-03" })], until: endOfYear(2026) });
  assert.equal(wip.value, 0);
  assert.equal(wip.oldest, null);
});

test("[ONDERHANDEN-WERK] an invoice that could not be dated is left out and said out loud", () => {
  const wip = workInProgress({
    entries: [hour({ invoice_id: "inv-unknown" }), hour()],
    until: endOfYear(2026),
    invoiceDateById: {},
  });
  assert.equal(wip.unknownInvoices, 1, "the screen must be able to say the figure may be understated");
  assert.equal(wip.value, 380, "only the hour we could judge is in the figure");
});

test("[ONDERHANDEN-WERK] an hour without a rate is counted and named, never valued", () => {
  const wip = workInProgress({
    entries: [hour({ hourly_rate: null }), hour()],
    until: endOfYear(2026),
  });
  assert.equal(wip.value, 380, "an unpriced hour must not be valued at zero, nor at an average");
  assert.equal(wip.withoutRate, 1);
  assert.equal(wip.hours, 4, "the hours behind the value are the priced ones");
});

test("[ONDERHANDEN-WERK] own time is not an asset", () => {
  // [DECLARABEL] Nobody will ever pay for administratie, so putting it on the balance sheet
  // would invent income out of an evening of paperwork.
  const wip = workInProgress({ entries: [hour({ billable: false })], until: endOfYear(2026) });
  assert.equal(wip.value, 0);
  assert.equal(wip.withoutRate, 0);
});

test("[ONDERHANDEN-WERK] an hour from before the billable column still counts", () => {
  // A row written before time_entries_declarabel.sql has no value in the column at all.
  const wip = workInProgress({ entries: [hour({ billable: undefined })], until: endOfYear(2026) });
  assert.equal(wip.value, 380);
});

test("[ONDERHANDEN-WERK] clients come out largest first, and one without a client is its own row", () => {
  const wip = workInProgress({
    entries: [
      hour({ client_id: "small", hours: 1 }),
      hour({ client_id: "big", hours: 10 }),
      hour({ client_id: null, hours: 2 }),
    ],
    until: endOfYear(2026),
  });
  assert.deepEqual(wip.clients.map((c) => c.clientId), ["big", null, "small"]);
  assert.equal(wip.value, 1235, "13 hours at 95");
});

test("[ONDERHANDEN-WERK] the cents are the invoice's cents", () => {
  // 1,5 × 33,33 = 49,995. Rounded per hour, the way the invoice line rounds it, twice over.
  const wip = workInProgress({
    entries: [hour({ hours: 1.5, hourly_rate: 33.33 }), hour({ hours: 1.5, hourly_rate: 33.33 })],
    until: endOfYear(2026),
  });
  assert.equal(wip.value, 100, "50,00 + 50,00 — never 99,99");
});

test("[ONDERHANDEN-WERK] a row without a working day is not carried", () => {
  const wip = workInProgress({ entries: [hour({ worked_on: null })], until: endOfYear(2026) });
  assert.equal(wip.value, 0, "an hour with no date cannot be placed in a book year");
});

test("[ONDERHANDEN-WERK] no hours at all is a zero, not a crash", () => {
  const wip = workInProgress({ entries: [], until: endOfYear(2026) });
  assert.equal(wip.value, 0);
  assert.deepEqual(wip.clients, []);
  assert.equal(wip.oldest, null);
});
