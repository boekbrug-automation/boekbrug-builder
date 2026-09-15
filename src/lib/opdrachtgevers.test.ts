// npx tsx --test src/lib/opdrachtgevers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { opdrachtgeverYear, opdrachtgeverDossier } from "./opdrachtgevers";

const iv = (over: Partial<Parameters<typeof opdrachtgeverYear>[0]["invoices"][number]> = {}) => ({
  client_id: "k1", client_name: "Bakker BV", total_ex_btw: 1000, invoice_date: "2026-03-01", ...over,
});

test("revenue, share and the count come from the invoices themselves", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv(), iv({ total_ex_btw: 3000, invoice_date: "2026-06-01" }), iv({ client_id: "k2", client_name: "Gemeente", total_ex_btw: 1000 })],
    hours: [{ client_id: "k1", hours: 40 }, { client_id: "k1", hours: 2.5 }, { client_id: "k2", hours: 8 }],
  });
  assert.equal(y.revenue, 5000);
  assert.equal(y.clients, 2);
  assert.deepEqual(y.rows.map((r) => [r.name, r.revenue, r.share, r.hours, r.invoices]), [
    ["Bakker BV", 4000, 80, 42.5, 2],
    ["Gemeente", 1000, 20, 8, 1],
  ]);
  assert.equal(y.largestShare, 80);
  assert.equal(y.rows[0].firstInvoice, "2026-03-01");
  assert.equal(y.rows[0].lastInvoice, "2026-06-01");
});

test("a creditnota nets against the client it credits, never as a client of its own", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv({ total_ex_btw: 1000 }), iv({ total_ex_btw: -250 })],
    hours: [],
  });
  assert.equal(y.clients, 1);
  assert.equal(y.rows[0].revenue, 750);
});

test("an invoice without a client link is paired on its name, folded like everywhere else", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv({ client_id: null, client_name: "Café D'Oude Sluis" }), iv({ client_id: null, client_name: "café d'oude sluis" })],
    hours: [],
  });
  assert.equal(y.clients, 1, "one opdrachtgever, written twice");
  assert.equal(y.rows[0].revenue, 2000);
});

test("no revenue means no percentages — never a share of zero or of a negative year", () => {
  const empty = opdrachtgeverYear({ year: 2026, invoices: [], hours: [] });
  assert.deepEqual([empty.revenue, empty.clients, empty.largestShare], [0, 0, null]);
  const negative = opdrachtgeverYear({ year: 2026, invoices: [iv({ total_ex_btw: -100 })], hours: [] });
  assert.equal(negative.largestShare, null, "a share against a negative total means nothing");
});

test("an invoice with an unreadable amount is skipped, not counted as zero", () => {
  const y = opdrachtgeverYear({ year: 2026, invoices: [iv(), iv({ total_ex_btw: null })], hours: [] });
  assert.equal(y.rows[0].invoices, 1, "only the invoice we could read");
});

// ── [DBA-DOSSIER] since when, won this year, and the owner's own rate ──────────────────────────

const dossier = (over: Partial<Parameters<typeof opdrachtgeverDossier>[0]> = {}) =>
  opdrachtgeverDossier({ year: 2026, invoices: [], hours: [], rates: [], ...over });

test("[DBA-DOSSIER] the year is cut out of the whole history, and the year's own totals are unchanged", () => {
  const all = [
    iv({ invoice_date: "2023-04-11" }),
    iv({ invoice_date: "2026-03-01" }),
    iv({ client_id: "k2", client_name: "Gemeente", invoice_date: "2026-06-01" }),
  ];
  const d = dossier({ invoices: all });
  const y = opdrachtgeverYear({ year: 2026, invoices: all.filter((i) => i.invoice_date!.startsWith("2026-")), hours: [] });
  assert.equal(d.revenue, y.revenue, "an earlier year may not be added to this year's revenue");
  assert.equal(d.clients, 2);
  assert.deepEqual(d.rows.map((r) => r.share), y.rows.map((r) => r.share));
});

test("[DBA-DOSSIER] 'since' reaches back past the year shown", () => {
  const d = dossier({ invoices: [iv({ invoice_date: "2026-03-01" }), iv({ invoice_date: "2023-04-11" })] });
  assert.equal(d.rows[0].since, "2023-04-11");
  assert.equal(d.rows[0].wonThisYear, false, "a client of three years was not won this year");
});

test("[DBA-DOSSIER] an opdrachtgever whose first invoice ever falls in the year was won this year", () => {
  const d = dossier({ invoices: [iv({ invoice_date: "2026-03-01" }), iv({ invoice_date: "2026-09-02" })] });
  assert.equal(d.rows[0].wonThisYear, true);
  assert.equal(d.wonThisYear, 1);
  assert.equal(d.rows[0].monthsActive, 2, "two distinct calendar months carried revenue");
});

test("[DBA-DOSSIER] months are counted distinctly, across years", () => {
  const d = dossier({
    invoices: [
      iv({ invoice_date: "2025-11-01" }), iv({ invoice_date: "2025-11-20" }),
      iv({ invoice_date: "2026-01-05" }), iv({ invoice_date: "2026-02-05" }),
    ],
  });
  assert.equal(d.rows[0].monthsActive, 3, "November twice is one month");
});

test("[DBA-DOSSIER] an undated invoice makes nobody new — it answers nothing", () => {
  const d = dossier({ invoices: [iv({ invoice_date: "2026-03-01" }), iv({ invoice_date: null })] });
  assert.equal(d.rows[0].since, "2026-03-01", "the undated one cannot be the first");
  const only = dossier({ invoices: [iv({ invoice_date: null })] });
  assert.equal(only.rows.length, 0, "an undated document belongs to no year — same cut as the query");
});

test("[DBA-DOSSIER] the rate is READ from the klant, never derived from revenue and hours", () => {
  const d = dossier({
    invoices: [iv({ invoice_date: "2026-03-01", total_ex_btw: 9999 })],
    hours: [{ client_id: "k1", hours: 10 }],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }],
  });
  assert.equal(d.rows[0].agreedRate, 65, "999.9 per hour is what a derivation would have said");
});

test("[DBA-DOSSIER] no recorded rate is null, never zero", () => {
  for (const rate of [null, undefined, 0, Number.NaN] as (number | null | undefined)[]) {
    const d = dossier({
      invoices: [iv({ invoice_date: "2026-03-01" })],
      rates: [{ client_id: "k1", default_hourly_rate: rate as number | null }],
    });
    assert.equal(d.rows[0].agreedRate, null, `${String(rate)} is not a price the owner agreed`);
  }
  assert.equal(dossier({ invoices: [iv({ invoice_date: "2026-03-01" })] }).rows[0].agreedRate, null);
});

test("[DBA-DOSSIER] a name-keyed opdrachtgever has no klant record, so no rate", () => {
  const d = dossier({
    invoices: [iv({ client_id: null, client_name: "Bakker BV", invoice_date: "2026-03-01" })],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }],
  });
  assert.equal(d.rows[0].agreedRate, null, "a rate must never travel to a row by resemblance");
});

test("[DBA-DOSSIER] a spread needs two recorded rates — one figure is not a range", () => {
  const one = dossier({
    invoices: [iv({ invoice_date: "2026-03-01" })],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }],
  });
  assert.equal(one.rateSpread, null);

  const two = dossier({
    invoices: [iv({ invoice_date: "2026-03-01" }), iv({ client_id: "k2", client_name: "Gemeente", invoice_date: "2026-04-01" })],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }, { client_id: "k2", default_hourly_rate: 82.5 }],
  });
  assert.deepEqual(two.rateSpread, { low: 65, high: 82.5 });
});

test("[DBA-DOSSIER] the same rate everywhere is a fact, and it is stated as one", () => {
  const d = dossier({
    invoices: [iv({ invoice_date: "2026-03-01" }), iv({ client_id: "k2", client_name: "Gemeente", invoice_date: "2026-04-01" })],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }, { client_id: "k2", default_hourly_rate: 65 }],
  });
  assert.deepEqual(d.rateSpread, { low: 65, high: 65 });
});

test("[DBA-DOSSIER] a rate recorded for a klant with no revenue this year is not in the spread", () => {
  const d = dossier({
    invoices: [iv({ invoice_date: "2026-03-01" })],
    rates: [{ client_id: "k1", default_hourly_rate: 65 }, { client_id: "k9", default_hourly_rate: 200 }],
  });
  assert.equal(d.rateSpread, null, "the spread is over the opdrachtgevers this year actually had");
});
