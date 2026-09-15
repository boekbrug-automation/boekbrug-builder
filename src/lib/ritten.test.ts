// [RITTEN] Pure node test — run: npx tsx --test src/lib/ritten.test.ts
//
// The kilometre log feeds a deduction on somebody's tax return and a customer's invoice. The
// tests are about the three ways it can lie: the wrong statutory rate, a private trip counted as
// business, and a trip valued at zero because nothing was agreed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kmDeductionRate,
  isBusiness,
  isUninvoiced,
  tripValue,
  mileageYear,
  normalizeMileageInput,
  MAX_KM_PER_TRIP,
  MAX_TRIPS_PER_INVOICE,
  groupBillableTrips,
  linesFromTrips,
  parseMileageIds,
  type MileageEntry,
} from "./ritten";

const trip = (over: Partial<MileageEntry> = {}): MileageEntry => ({
  client_id: "c1", driven_on: "2026-03-04", from_place: "kantoor", to_place: "Zwolle",
  purpose: "Adviesgesprek", kilometers: 40, rate_per_km: null, business: true, invoice_id: null,
  ...over,
});

// ── The rate is a law, looked up by year ──────────────────────────────────────────────────────

test("[RITTEN] the statutory rate follows the year, not the row", () => {
  assert.equal(kmDeductionRate(2026), 0.23);
  assert.equal(kmDeductionRate(2024), 0.23);
  assert.equal(kmDeductionRate(2023), 0.21);
  assert.equal(kmDeductionRate(2022), 0.19);
});

test("[RITTEN] a year we have not been told about keeps the newest rate, never zero", () => {
  assert.equal(kmDeductionRate(2030), 0.23, "a zero here would silently erase a deduction");
});

// ── What a trip is worth to the customer ──────────────────────────────────────────────────────

test("[RITTEN] no agreed rate is not a value of zero", () => {
  assert.equal(tripValue(trip()), null, "a drive to the wholesaler owes nobody anything");
  assert.equal(tripValue(trip({ rate_per_km: 0 })), 0, "travel offered free is a decision, and it shows");
  assert.equal(tripValue(trip({ rate_per_km: 0.23 })), 9.2);
});

test("[RITTEN] the cents are the invoice's cents", () => {
  // 37,5 × 0,235 = 8,8125 → 8,81, rounded once, where the invoice line rounds it.
  assert.equal(tripValue(trip({ kilometers: 37.5, rate_per_km: 0.235 })), 8.81);
});

test("[RITTEN] a trip with no distance has no value", () => {
  assert.equal(tripValue(trip({ kilometers: null, rate_per_km: 0.23 })), null);
  assert.equal(tripValue(trip({ kilometers: 0, rate_per_km: 0.23 })), null);
});

// ── The year ──────────────────────────────────────────────────────────────────────────────────

test("[RITTEN] the year adds the business kilometres and prices them at the year's rate", () => {
  const year = mileageYear({ entries: [trip(), trip({ kilometers: 60 })], year: 2026 });
  assert.equal(year.businessKm, 100);
  assert.equal(year.rate, 0.23);
  assert.equal(year.deduction, 23);
  assert.equal(year.trips, 2);
});

test("[RITTEN] a private trip is neither a deduction nor a debt", () => {
  const year = mileageYear({ entries: [trip({ business: false, rate_per_km: 0.23 })], year: 2026 });
  assert.equal(year.businessKm, 0);
  assert.equal(year.deduction, 0);
  assert.equal(year.unbilledValue, 0);
  assert.equal(year.trips, 0);
});

test("[RITTEN] a row from before the column reads as business", () => {
  const year = mileageYear({ entries: [trip({ business: undefined })], year: 2026 });
  assert.equal(year.businessKm, 40);
});

test("[RITTEN] trips outside the year do not count", () => {
  const year = mileageYear({
    entries: [trip({ driven_on: "2025-12-31" }), trip({ driven_on: "2027-01-01" }), trip()],
    year: 2026,
  });
  assert.equal(year.businessKm, 40);
});

test("[RITTEN] what a customer still owes is separate from the deduction", () => {
  const year = mileageYear({
    entries: [
      trip({ rate_per_km: 0.23 }),                       // 40 km, unbilled, € 9,20
      trip({ rate_per_km: 0.23, invoice_id: "inv-1" }),  // already on an invoice
      trip(),                                            // no rate at all
    ],
    year: 2026,
  });
  assert.equal(year.businessKm, 120, "every business kilometre counts for the deduction");
  assert.equal(year.unbilledValue, 9.2, "only what is unbilled AND priced is still owed");
  assert.equal(year.unbilledWithoutRate, 1);
});

test("[RITTEN] an older year is priced at ITS rate, not this one", () => {
  const year = mileageYear({ entries: [trip({ driven_on: "2023-06-01", kilometers: 100 })], year: 2023 });
  assert.equal(year.rate, 0.21);
  assert.equal(year.deduction, 21);
});

test("[RITTEN] an empty log is a zero, not a crash", () => {
  const year = mileageYear({ entries: [], year: 2026 });
  assert.equal(year.businessKm, 0);
  assert.equal(year.deduction, 0);
  assert.equal(year.trips, 0);
});

// ── What may be written down ──────────────────────────────────────────────────────────────────

test("[RITTEN] a complete trip is accepted, with a Dutch decimal comma", () => {
  const out = normalizeMileageInput({
    driven_on: "2026-03-04", from_place: " kantoor ", to_place: "Zwolle",
    purpose: "Adviesgesprek", kilometers: "37,5", rate_per_km: "0,23",
    client_id: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.entry.kilometers, 37.5);
  assert.equal(out.entry.rate_per_km, 0.23);
  assert.equal(out.entry.from_place, "kantoor");
  assert.equal(out.entry.business, true);
  assert.equal(out.entry.client_id, "11111111-2222-3333-4444-555555555555");
});

test("[RITTEN] every field the log needs is required, and says which one is missing", () => {
  const base = { driven_on: "2026-03-04", from_place: "a", to_place: "b", purpose: "c", kilometers: 10 };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...base, driven_on: "gisteren" }, "no_date"],
    [{ ...base, from_place: "  " }, "no_from"],
    [{ ...base, to_place: "" }, "no_to"],
    [{ ...base, purpose: "" }, "no_purpose"],
    [{ ...base, kilometers: 0 }, "no_kilometers"],
    [{ ...base, kilometers: "veel" }, "no_kilometers"],
    [{ ...base, kilometers: MAX_KM_PER_TRIP + 1 }, "too_far"],
    [{ ...base, rate_per_km: "twee euro" }, "bad_rate"],
    [{ ...base, rate_per_km: -1 }, "bad_rate"],
  ];
  for (const [body, code] of cases) {
    const out = normalizeMileageInput(body);
    assert.equal(out.ok, false, `${code} must be refused`);
    if (!out.ok) assert.equal(out.code, code);
  }
});

test("[RITTEN] an empty rate means not charged on, and is not a refusal", () => {
  const out = normalizeMileageInput({
    driven_on: "2026-03-04", from_place: "a", to_place: "b", purpose: "c", kilometers: 10, rate_per_km: "",
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.entry.rate_per_km, null);
});

test("[RITTEN] a client id that is not a uuid is dropped, never refused", () => {
  // The trip is still a trip; it just belongs to no customer.
  const out = normalizeMileageInput({
    driven_on: "2026-03-04", from_place: "a", to_place: "b", purpose: "c", kilometers: 10, client_id: "Bakkerij",
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.entry.client_id, null);
});

test("[RITTEN] the two column questions are answered by the columns", () => {
  assert.equal(isBusiness({ business: false }), false);
  assert.equal(isBusiness({ business: null }), true);
  assert.equal(isUninvoiced({ invoice_id: null }), true);
  assert.equal(isUninvoiced({ invoice_id: "inv-1" }), false);
});

// ── Onto an invoice, once ─────────────────────────────────────────────────────────────────────

test("[RITTEN] only trips that can be invoiced are offered, grouped per customer", () => {
  const groups = groupBillableTrips([
    trip({ id: "a", rate_per_km: 0.23 }),
    trip({ id: "b", rate_per_km: 0.23, kilometers: 10, driven_on: "2026-01-02" }),
    trip({ id: "c", rate_per_km: 0.23, client_id: "c2", kilometers: 100 }),
    trip({ id: "d", rate_per_km: 0.23, invoice_id: "inv-1" }),   // already billed
    trip({ id: "e", rate_per_km: null }),                        // no rate: nobody owes anything
    trip({ id: "f", rate_per_km: 0.23, business: false }),       // private
    trip({ id: "g", rate_per_km: 0.23, client_id: null }),       // no customer to bill
  ]);
  assert.deepEqual(groups.map((g) => g.clientId), ["c2", "c1"], "largest first");
  const own = groups.find((g) => g.clientId === "c1");
  assert.equal(own?.trips.length, 2);
  assert.equal(own?.kilometers, 50);
  assert.equal(own?.value, 11.5, "40 × 0,23 + 10 × 0,23");
  assert.equal(own?.trips[0].id, "b", "oldest first, the way a statement reads");
});

test("[RITTEN] the invoice lines are the trips, oldest first, in kilometres", () => {
  const built = linesFromTrips([
    trip({ id: "b", rate_per_km: 0.23, kilometers: 10, driven_on: "2026-01-02", purpose: "Intake" }),
    trip({ id: "a", rate_per_km: 0.23 }),
  ]);
  assert.deepEqual(built.billedIds, ["b", "a"]);
  assert.equal(built.lines[0].unit, "km", "so the e-factuur carries KMT and not 'piece'");
  assert.equal(built.lines[0].quantity, 10);
  assert.equal(built.lines[0].unit_price, 0.23);
  assert.equal(built.lines[0].btw_rate, 21);
  assert.match(built.lines[0].description, /02-01 · kantoor – Zwolle · Intake/);
});

test("[RITTEN] a btw rate that is not a rate falls back to 21, never to zero", () => {
  // Number(null) is 0, and 0% on an invoice reads as vrijgesteld — it takes real turnover out of
  // the aangifte. The same trap the hours had.
  for (const bad of [null, undefined, "", " ", [], false, 7]) {
    assert.equal(linesFromTrips([trip({ rate_per_km: 0.23 })], bad).lines[0].btw_rate, 21,
      `btw rate ${JSON.stringify(bad)} must not become 0%`);
  }
  assert.equal(linesFromTrips([trip({ rate_per_km: 0.23 })], 9).lines[0].btw_rate, 9, "a real rate is used");
});

test("[RITTEN] a billed or private trip never reaches a line, and is named", () => {
  const built = linesFromTrips([
    trip({ id: "billed", rate_per_km: 0.23, invoice_id: "inv-1" }),
    trip({ id: "prive", rate_per_km: 0.23, business: false }),
    trip({ id: "geenTarief", rate_per_km: null }),
  ]);
  assert.equal(built.lines.length, 0);
  assert.deepEqual(built.billedIds, []);
  assert.equal(built.skippedPrivate.length, 1);
  assert.equal(built.skippedWithoutRate.length, 1);
});

test("[RITTEN] the ids that may be asked for are uuids, deduplicated and bounded", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const ok = parseMileageIds([id, id.toUpperCase()]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.ids, [id], "the same trip twice is one trip");
  assert.deepEqual(parseMileageIds("x"), { ok: false, code: "not_a_list" });
  assert.deepEqual(parseMileageIds([]), { ok: false, code: "empty" });
  assert.deepEqual(parseMileageIds(["nope"]), { ok: false, code: "not_an_id" });
  // The ceiling counts DISTINCT trips: the same id repeated collapses to one, so a list that is
  // long only because it repeats itself is not refused.
  const many = Array.from({ length: MAX_TRIPS_PER_INVOICE + 1 }, (_, i) =>
    `11111111-2222-3333-4444-${String(i).padStart(12, "0")}`);
  assert.deepEqual(parseMileageIds(many), { ok: false, code: "too_many" });
  assert.equal(parseMileageIds(Array.from({ length: 300 }, () => id)).ok, true);
});
