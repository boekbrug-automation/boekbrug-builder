// src/lib/period-invoice-tabs.test.ts
// Run: npx tsx --test src/lib/period-invoice-tabs.test.ts
//
// [KWT-TABS] The rules that decide which of the accountant's three invoice views is on screen.
// Every one of them is a rule that fails silently: a tab that classifies a row differently from
// the list it renders puts a receivable under Crediteuren; a count taken from a failed read says
// the client booked nothing; a deep link that loses to a stale ?tab= opens on the wrong list and
// looks like the notification was simply wrong.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INVOICE_TAB,
  INVOICE_SECTIONS,
  INVOICE_TAB_KEYS,
  countInvoiceTabs,
  focusInvoiceTab,
  invoiceSection,
  invoiceTabHref,
  invoiceTabId,
  invoiceTabKeyAction,
  invoiceTabOf,
  invoiceTabPanelId,
  invoiceTabRows,
  isInvoiceTabKey,
  neighbourInvoiceTab,
  readInvoiceTab,
  type InvoiceTabKey,
} from "./period-invoice-tabs";

const PAD = "/dashboard/clients/ac22189e-7052-4c48-b4ec-90947cf92ecc/kwartaal";

/** A row, in the two fields the split actually reads. */
const rij = (id: string, direction: string | null, status: string | null) => ({ id, direction, status });

const VERKOOP_OPEN = rij("v1", "outgoing", "sent");
const INKOOP_OPEN = rij("i1", "incoming", "received");
const BETAALD_UIT = rij("b1", "outgoing", "paid");
const BETAALD_IN = rij("b2", "incoming", "paid");

// ─── The split itself ─────────────────────────────────────────────────────────────────────────

test("[KWT-TABS] the three views are the three the screen has always rendered", () => {
  // The predicates MOVED here from the page; they were not rewritten. If this list ever grows a
  // fourth entry or loses one, the tab strip and the accounting split have parted company.
  assert.deepEqual([...INVOICE_TAB_KEYS], ["debiteuren", "crediteuren", "voldaan"]);
  assert.equal(DEFAULT_INVOICE_TAB, "debiteuren");
  // [TAAL] The keys are identifiers and URL values. Dutch on the screen comes from the catalogue.
  for (const s of INVOICE_SECTIONS) {
    assert.match(s.titleKey, /^bh\.kwt\.sectie\./, `${s.key} names no catalogue heading`);
    assert.match(s.subKey, /^bh\.kwt\.sectie\./, `${s.key} names no catalogue explanation`);
  }
});

test("[KWT-TABS] a row belongs to the view it has always been rendered in", () => {
  // Verbatim [BRIDGE-A]: outgoing+sent is a receivable, incoming+received is a payable, and paid
  // is settled whichever way it points.
  assert.equal(invoiceTabOf(VERKOOP_OPEN), "debiteuren");
  assert.equal(invoiceTabOf(INKOOP_OPEN), "crediteuren");
  assert.equal(invoiceTabOf(BETAALD_UIT), "voldaan");
  assert.equal(invoiceTabOf(BETAALD_IN), "voldaan");

  // A sent PURCHASE invoice is not a receivable. The direction is half the rule, and a tab strip
  // that dropped it would file the client's own bills under money owed TO them.
  assert.equal(invoiceTabOf(rij("x", "incoming", "sent")), null);
  assert.equal(invoiceTabOf(rij("x", "outgoing", "received")), null);
});

test("[KWT-TABS] a row in no view is not quietly filed under the first one", () => {
  // The page's queries can only produce rows the three sections cover, so this is about the row
  // that slips through anyway — a NULL direction the inference missed, a status added later.
  // Defaulting it to Debiteuren would show it to the accountant as an outstanding receivable.
  assert.equal(invoiceTabOf(rij("x", null, null)), null);
  assert.equal(invoiceTabOf(rij("x", "outgoing", "draft")), null);
  assert.equal(invoiceTabOf(null), null);
  assert.equal(invoiceTabOf(undefined), null);

  const rows = [VERKOOP_OPEN, rij("x", "outgoing", "draft"), INKOOP_OPEN];
  const verdeeld = INVOICE_TAB_KEYS.flatMap((k) => invoiceTabRows(rows, k));
  assert.equal(verdeeld.length, 2, "a row outside the split was rendered in some tab anyway");
});

test("[KWT-TABS] the views do not overlap — one row is rendered once", () => {
  const rows = [VERKOOP_OPEN, INKOOP_OPEN, BETAALD_UIT, BETAALD_IN];
  const gezien = new Map<string, InvoiceTabKey[]>();
  for (const key of INVOICE_TAB_KEYS)
    for (const r of invoiceTabRows(rows, key)) gezien.set(r.id, [...(gezien.get(r.id) ?? []), key]);
  for (const [id, keys] of gezien)
    assert.equal(keys.length, 1, `${id} appears in ${keys.join(" and ")} — it would be counted twice`);
  assert.equal(gezien.size, rows.length, "a row fell out of the split entirely");
});

test("[KWT-TABS] the panel holds one view's rows, never the other two", () => {
  const rows = [VERKOOP_OPEN, INKOOP_OPEN, BETAALD_UIT, BETAALD_IN];
  assert.deepEqual(invoiceTabRows(rows, "debiteuren").map((r) => r.id), ["v1"]);
  assert.deepEqual(invoiceTabRows(rows, "crediteuren").map((r) => r.id), ["i1"]);
  assert.deepEqual(invoiceTabRows(rows, "voldaan").map((r) => r.id), ["b1", "b2"]);
  // The order the caller handed over is the order back — sorting stays the screen's decision.
  assert.deepEqual(invoiceTabRows([BETAALD_IN, BETAALD_UIT], "voldaan").map((r) => r.id), ["b2", "b1"]);
});

// ─── Counts: a number is a claim ──────────────────────────────────────────────────────────────

test("[KWT-TABS] the counts are the rows that were read", () => {
  assert.deepEqual(countInvoiceTabs([VERKOOP_OPEN, INKOOP_OPEN, BETAALD_UIT, BETAALD_IN]), {
    debiteuren: 1,
    crediteuren: 1,
    voldaan: 2,
  });
  // A quarter that really is empty says so with zeroes — that IS the truth, and the tab strip may
  // print it. The line below is the whole difference from the next test.
  assert.deepEqual(countInvoiceTabs([]), { debiteuren: 0, crediteuren: 0, voldaan: 0 });
});

test("[KWT-TABS] a read that did not answer produces no count at all", () => {
  // [NO-SILENT-EMPTY] Unknown is not zero. «Crediteuren 0» over a failed read tells the accountant
  // this client booked no purchase invoices this quarter — a statement about someone else's
  // administration that a dead socket is in no position to make. Null means "draw no number".
  assert.equal(countInvoiceTabs(null), null, "a failed read became three zeroes");
  assert.equal(countInvoiceTabs(undefined), null, "a read that has not answered became three zeroes");
});

test("[KWT-TABS] a count never counts a row that no view renders", () => {
  const counts = countInvoiceTabs([VERKOOP_OPEN, rij("x", "outgoing", "draft")]);
  assert.deepEqual(counts, { debiteuren: 1, crediteuren: 0, voldaan: 0 });
  const totaal = Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  assert.equal(totaal, 1, "the strip promises a row that opening the tab does not produce");
});

// ─── Reading the URL ──────────────────────────────────────────────────────────────────────────

test("[KWT-TABS] an unreadable tab parameter falls to Debiteuren, never to an empty screen", () => {
  assert.equal(readInvoiceTab("crediteuren"), "crediteuren");
  assert.equal(readInvoiceTab("voldaan"), "voldaan");
  for (const raw of [null, undefined, "", "Crediteuren", "debiteur", "openstaand", "../voldaan", "4"])
    assert.equal(readInvoiceTab(raw), "debiteuren", `«${String(raw)}» did not fall back`);
  assert.equal(isInvoiceTabKey("voldaan"), true);
  assert.equal(isInvoiceTabKey("voldaa"), false);
  assert.equal(isInvoiceTabKey(3), false);
});

test("[KWT-TABS] choosing a view changes the tab and nothing else", () => {
  // `q` and `year` are the period this screen IS; `focus` is a deep link the accountant may still
  // want to follow back. A query string that quietly drops half of itself turns a view change into
  // a navigation to another quarter.
  const href = invoiceTabHref(PAD, "q=3&year=2026&focus=inv-9", "crediteuren");
  const na = new URLSearchParams(href.split("?")[1]);
  assert.equal(href.split("?")[0], PAD, "the route changed");
  assert.equal(na.get("q"), "3");
  assert.equal(na.get("year"), "2026");
  assert.equal(na.get("focus"), "inv-9");
  assert.equal(na.get("tab"), "crediteuren");

  // An existing tab is replaced, not appended — two `tab` values and the reader picks the first.
  const weer = new URLSearchParams(invoiceTabHref(PAD, "q=3&tab=voldaan", "debiteuren").split("?")[1]);
  assert.deepEqual(weer.getAll("tab"), ["debiteuren"]);
  assert.equal(weer.get("q"), "3");

  // A leading '?' and an empty search are both ordinary inputs.
  assert.match(invoiceTabHref(PAD, "?q=4", "voldaan"), /[?&]q=4/);
  assert.equal(invoiceTabHref(PAD, "", "voldaan"), `${PAD}?tab=voldaan`);
  assert.equal(invoiceTabHref(PAD, null, "voldaan"), `${PAD}?tab=voldaan`);
  assert.equal(
    invoiceTabHref(PAD, new URLSearchParams({ year: "2026" }), "voldaan"),
    `${PAD}?year=2026&tab=voldaan`,
  );
});

// ─── The deep link outranks the tab ───────────────────────────────────────────────────────────

test("[KWT-TABS] a focused purchase invoice beats tab=debiteuren", () => {
  // [BRIDGE-NOTIF] The promise Batch 2 made is that a notification lands on its invoice. A link
  // carrying `focus=<a purchase invoice>&tab=debiteuren` — a stale bookmark, a link built before
  // the invoice was paid — must not honour the tab and hide the row the link exists for.
  const rows = [VERKOOP_OPEN, INKOOP_OPEN, BETAALD_UIT];
  assert.equal(focusInvoiceTab("i1", rows), "crediteuren");
  assert.equal(focusInvoiceTab("b1", rows), "voldaan", "a link to a settled invoice opens Voldaan");
  assert.equal(focusInvoiceTab("v1", rows), "debiteuren");
});

test("[KWT-TABS] nothing to resolve means the URL keeps its say", () => {
  const rows = [VERKOOP_OPEN, INKOOP_OPEN];
  assert.equal(focusInvoiceTab(null, rows), null, "no focus forced a view anyway");
  assert.equal(focusInvoiceTab("", rows), null);
  // Not in this quarter: keep the existing best-effort behaviour, and invent no second fetch.
  assert.equal(focusInvoiceTab("elders", rows), null);
  // Rows not read yet — guessing here would fight the URL for the first paint.
  assert.equal(focusInvoiceTab("i1", null), null);
  assert.equal(focusInvoiceTab("i1", undefined), null);
  // A focused row that no view renders forces nothing rather than forcing Debiteuren.
  assert.equal(focusInvoiceTab("x", [rij("x", "outgoing", "draft")]), null);
});

// ─── Keyboard and the ids that tie a tab to its panel ─────────────────────────────────────────

test("[KWT-TABS] the arrow keys wrap, so no key is ever dead", () => {
  assert.equal(neighbourInvoiceTab("debiteuren", 1), "crediteuren");
  assert.equal(neighbourInvoiceTab("crediteuren", 1), "voldaan");
  assert.equal(neighbourInvoiceTab("voldaan", 1), "debiteuren");
  assert.equal(neighbourInvoiceTab("debiteuren", -1), "voldaan");
  assert.equal(neighbourInvoiceTab("voldaan", -1), "crediteuren");
  // Three steps in either direction is where you started — the property, not three more examples.
  for (const start of INVOICE_TAB_KEYS)
    for (const step of [1, -1] as const) {
      let at = start;
      for (let i = 0; i < INVOICE_TAB_KEYS.length; i++) at = neighbourInvoiceTab(at, step);
      assert.equal(at, start, `${start} does not come back round going ${step}`);
    }
});

test("[KWT-TABS] the arrow keys mean what the screen shows, in both directions", () => {
  // Left to right: Right is forward, Left is back.
  assert.equal(invoiceTabKeyAction("ArrowRight", "debiteuren", "ltr"), "crediteuren");
  assert.equal(invoiceTabKeyAction("ArrowLeft", "debiteuren", "ltr"), "voldaan");
  assert.equal(invoiceTabKeyAction("ArrowRight", "voldaan", "ltr"), "debiteuren");

  // Arabic: the strip lays out right to left, so the tab to the RIGHT of this one is the tab
  // BEFORE it. Without this the selection walks backwards from every arrow key, for the one
  // audience nobody tests in — and it looks like a broken keyboard, not a mirrored layout.
  assert.equal(invoiceTabKeyAction("ArrowRight", "debiteuren", "rtl"), "voldaan");
  assert.equal(invoiceTabKeyAction("ArrowLeft", "debiteuren", "rtl"), "crediteuren");
  assert.equal(invoiceTabKeyAction("ArrowRight", "crediteuren", "rtl"), "debiteuren");

  // Home and End are the ends of the LIST, not of the screen, so they do not mirror.
  for (const dir of ["ltr", "rtl"] as const) {
    assert.equal(invoiceTabKeyAction("Home", "voldaan", dir), "debiteuren");
    assert.equal(invoiceTabKeyAction("End", "debiteuren", dir), "voldaan");
  }

  // Everything else belongs to the browser. Enter and Space especially: these are <button>s, so
  // handling them here would fire the selection twice.
  for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "PageDown", "a", "Escape"])
    assert.equal(invoiceTabKeyAction(key, "debiteuren", "ltr"), null, `«${key}» was taken`);
});

test("[KWT-TABS] a tab and its panel spell the same id", () => {
  // aria-controls is written by the strip and aria-labelledby by the screen, in two files. One
  // function per side is what keeps them in step — a link a screen reader needs and no sighted
  // reviewer ever sees.
  for (const key of INVOICE_TAB_KEYS) {
    assert.match(invoiceTabId(key), /^kwt-tab-/);
    assert.match(invoiceTabPanelId(key), /^kwt-tabpaneel-/);
    assert.notEqual(invoiceTabId(key), invoiceTabPanelId(key));
  }
  const alle = INVOICE_TAB_KEYS.flatMap((k) => [invoiceTabId(k), invoiceTabPanelId(k)]);
  assert.equal(new Set(alle).size, alle.length, "two tabs or panels share a DOM id");
});

test("[KWT-TABS] every view can be looked up, and an impossible one does not throw", () => {
  for (const key of INVOICE_TAB_KEYS) assert.equal(invoiceSection(key).key, key);
  // Reachable only through a cast — a money screen returns the default rather than crashing.
  assert.equal(invoiceSection("verzonnen" as InvoiceTabKey).key, DEFAULT_INVOICE_TAB);
});
