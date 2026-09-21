// src/lib/accountant-deep-links.test.ts
// Run: npx tsx --test src/lib/accountant-deep-links.test.ts
//
// [KANTOOR-LINKS] Every deep link an accountant signal writes, asserted as a STRING — because the
// failure this batch fixes was never a crash. A missing `year` does not throw; it lands the
// boekhouder in the wrong quarter with a list that looks complete.

import test from "node:test";
import assert from "node:assert/strict";

import {
  clientQuarterHref,
  opvragenHref,
  brugDocumentsHref,
  periodOfInvoiceDate,
  invoiceNoticeHref,
} from "./accountant-deep-links";

const CLIENT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const INVOICE = "73b7bba0-a1c9-4d3f-a838-ee5527687473";

test("[KANTOOR-LINKS] the quarter workspace is named with the parameters it reads", () => {
  const href = clientQuarterHref({ clientId: CLIENT, year: 2026, quarter: 3 });
  assert.equal(href, `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026`);

  // The page reads `q`, `year` and `focus` — kwartaal/page.tsx:165-200. Spelled any other way the
  // screen silently falls back to q=1 and the current year, which is the bug this replaces.
  const url = new URL(href, "https://x.invalid");
  assert.equal(url.searchParams.get("q"), "3");
  assert.equal(url.searchParams.get("year"), "2026");
  assert.equal(url.searchParams.get("quarter"), null, "the quarter screen does not read `quarter`");
});

test("[KANTOOR-LINKS] focus is written only when one invoice is named", () => {
  assert.equal(
    clientQuarterHref({ clientId: CLIENT, year: 2026, quarter: 3 }, INVOICE),
    `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026&focus=${INVOICE}`,
  );
  // An aggregate ("3 open vragen") knows a client and a period and NOT which invoice. Every
  // falsy shape must leave the list surface alone rather than pick a row.
  for (const nothing of [undefined, null, "", "   ", "undefined", "null"]) {
    const href = clientQuarterHref({ clientId: CLIENT, year: 2026, quarter: 3 }, nothing);
    assert.ok(!href.includes("focus"), `focus written for ${JSON.stringify(nothing)}`);
  }
});

test("[KANTOOR-LINKS] a period that cannot be trusted is left out, never guessed", () => {
  const base = `/dashboard/clients/${CLIENT}/kwartaal`;
  for (const bad of [
    { year: NaN, quarter: NaN },
    { year: 2026, quarter: 0 },
    { year: 2026, quarter: 5 },
    { year: 1999, quarter: 1 },
    { year: 2101, quarter: 1 },
    { year: 2026.5, quarter: 2 },
  ]) {
    assert.equal(clientQuarterHref({ clientId: CLIENT, ...bad }), base, JSON.stringify(bad));
  }
  // …and a missing client is not a link into someone's administration.
  assert.equal(clientQuarterHref({ clientId: "", year: 2026, quarter: 3 }), "/dashboard/clients/beheer");
});

test("[KANTOOR-LINKS] Opvragen and the Brug are named with the parameters THEY read", () => {
  assert.equal(
    opvragenHref({ clientId: CLIENT, year: 2026, quarter: 2 }),
    `/dashboard/accountant/opvragen?clientId=${CLIENT}&q=2&year=2026`,
  );
  assert.equal(
    brugDocumentsHref({ clientId: CLIENT, year: 2026, quarter: 4 }),
    `/dashboard/brug?clientId=${CLIENT}&tab=documenten&q=4&year=2026`,
  );
  // The Brug is still a legitimate destination without a period: the client is the bigger half.
  assert.equal(
    brugDocumentsHref({ clientId: CLIENT, year: NaN, quarter: NaN }),
    `/dashboard/brug?clientId=${CLIENT}&tab=documenten`,
  );
  // Opvragen without a usable client or period is the plain screen, never a half-filled one:
  // that screen MAILS an entrepreneur, and a wrong preselection there is a wrong request sent.
  assert.equal(opvragenHref({ clientId: CLIENT, year: 2026, quarter: 9 }), "/dashboard/accountant/opvragen");
  assert.equal(opvragenHref({ clientId: "", year: 2026, quarter: 1 }), "/dashboard/accountant/opvragen");
});

test("[KANTOOR-LINKS] no accountant link points at an owner-only route", () => {
  // The readiness item's own `fix` hrefs are owner routes (readiness-board.ts:26-32) and the
  // boekhouder's screens must never send them there — they would arrive on their own empty page.
  const OWNER_ONLY = [
    "/dashboard/incoming",
    "/dashboard/facturen",
    "/dashboard/bank",
    "/dashboard/kas",
    "/dashboard/klaar",
    "/dashboard/aangifte",
    "/dashboard/verkoop",
    "/dashboard/vragen",
    "/dashboard/waarheid",
  ];
  const built = [
    clientQuarterHref({ clientId: CLIENT, year: 2026, quarter: 1 }, INVOICE),
    opvragenHref({ clientId: CLIENT, year: 2026, quarter: 1 }),
    brugDocumentsHref({ clientId: CLIENT, year: 2026, quarter: 1 }),
    invoiceNoticeHref(CLIENT, INVOICE, "2026-01-01") ?? "",
  ];
  for (const href of built) {
    for (const owner of OWNER_ONLY) {
      assert.ok(!href.startsWith(owner), `${href} starts on the owner route ${owner}`);
    }
  }
});

test("[KANTOOR-LINKS] routing carries no locale — the same href in every language", () => {
  // The dashboard has ONE route tree; only the words change with `preferred_language`. A link that
  // grew an `/ar` or `/en` segment would 404 for the accountants who read those languages.
  const built = [
    clientQuarterHref({ clientId: CLIENT, year: 2026, quarter: 3 }, INVOICE),
    opvragenHref({ clientId: CLIENT, year: 2026, quarter: 3 }),
    brugDocumentsHref({ clientId: CLIENT, year: 2026, quarter: 3 }),
  ];
  for (const href of built) {
    assert.match(href, /^\/dashboard\//, href);
    assert.doesNotMatch(href, /^\/(nl|en|ar|tr)\//, href);
    assert.ok(!href.includes("locale") && !href.includes("lang"), href);
  }
});

// ── The period an invoice belongs to ─────────────────────────────────────────
//
// The boundaries are the whole point: these are the dates where "close enough" puts an accountant
// in the wrong tax period, and one of them puts them in the wrong YEAR.

test("[KANTOOR-LINKS] Q1 / Q4 / the year transition, to the day", () => {
  const cases: Array<[string, number, number]> = [
    ["2026-01-01", 2026, 1], // first day of Q1 — the one that drifts to Q4 of last year in a zone west of UTC
    ["2026-03-31", 2026, 1],
    ["2026-04-01", 2026, 2],
    ["2026-06-30", 2026, 2],
    ["2026-07-01", 2026, 3],
    ["2026-09-30", 2026, 3],
    ["2026-10-01", 2026, 4], // first day of Q4
    ["2026-12-31", 2026, 4], // last day of the year — must NOT become Q1 of the next
    ["2025-12-31", 2025, 4],
    ["2027-01-01", 2027, 1],
  ];
  for (const [iso, year, quarter] of cases) {
    assert.deepEqual(periodOfInvoiceDate(iso), { year, quarter }, iso);
    // A full timestamp is the same day: invoices carry date-only, but a caller may hand a stamp.
    assert.deepEqual(periodOfInvoiceDate(`${iso}T23:30:00+02:00`), { year, quarter }, iso);
  }
});

test("[KANTOOR-LINKS] an unreadable date yields NO period rather than today's", () => {
  for (const bad of [null, undefined, "", "   ", "onbekend", "31-12-2026", "2026-13-01", "2026-00-09"]) {
    assert.equal(periodOfInvoiceDate(bad), null, JSON.stringify(bad));
    assert.equal(invoiceNoticeHref(CLIENT, INVOICE, bad), null, JSON.stringify(bad));
  }
});

test("[KANTOOR-LINKS] a notification about one invoice opens that invoice in its own quarter", () => {
  assert.equal(
    invoiceNoticeHref(CLIENT, INVOICE, "2026-08-28"),
    `/dashboard/clients/${CLIENT}/kwartaal?q=3&year=2026&focus=${INVOICE}`,
  );
  // A notice that cannot name both halves is not a deep link at all.
  assert.equal(invoiceNoticeHref("", INVOICE, "2026-08-28"), null);
  assert.equal(invoiceNoticeHref(CLIENT, "", "2026-08-28"), null);
});

test("[KANTOOR-LINKS] identifiers survive the query string unchanged", () => {
  // Round-tripping matters more than it looks: `focus` is compared to a row id by === on the
  // other side, so an id that came back re-encoded would silently highlight nothing.
  const href = invoiceNoticeHref(CLIENT, INVOICE, "2026-02-14")!;
  const url = new URL(href, "https://x.invalid");
  assert.equal(url.pathname, `/dashboard/clients/${CLIENT}/kwartaal`);
  assert.equal(url.searchParams.get("focus"), INVOICE);
  assert.equal(url.searchParams.get("q"), "1");
  assert.equal(url.searchParams.get("year"), "2026");
});
