// tests/render/grootboek-kaart.test.tsx
// [GROOTBOEK-KAART] Render the ledger with rows that exercise the branches.
//
// AGENTS.md: hand it rows that exercise the branches — the bug this class of test exists to catch
// is invisible against an empty list, because [].map(cb) never calls cb. So this set carries a
// debit account, a credit account, a running balance, a refused document and an unknown account:
// every path the screen has.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GrootboekKaartView, type KaartPayload } from "../../src/components/grootboek/GrootboekKaart";
import { buildLedgerCards, resultFromCards } from "../../src/lib/grootboekkaart";
import type { Entry } from "../../src/lib/xaf-export";

// Two real-shaped entries: a purchase (cost + voorbelasting against crediteuren) and a sale
// (debiteuren against turnover + btw owed). Between them every column on the screen is populated.
const ENTRIES: Entry[] = [
  {
    nr: 1, date: "2026-03-04", journal: "INK", desc: "Inkoopfactuur 2026-114",
    lines: [
      { accID: "4000", debitC: 10000, desc: "Inkoopfactuur 2026-114", docRef: "INK-1" },
      { accID: "1400", debitC: 2100, desc: "Inkoopfactuur 2026-114", docRef: "INK-1" },
      { accID: "1600", debitC: -12100, desc: "Inkoopfactuur 2026-114", docRef: "INK-1" },
    ],
  },
  {
    nr: 2, date: "2026-03-05", journal: "VRK", desc: "Verkoopfactuur 20260005",
    lines: [
      { accID: "1300", debitC: 24200, desc: "Verkoopfactuur 20260005", docRef: "VRK-2" },
      { accID: "8000", debitC: -20000, desc: "Verkoopfactuur 20260005", docRef: "VRK-2" },
      { accID: "1500", debitC: -4200, desc: "Verkoopfactuur 20260005", docRef: "VRK-2" },
    ],
  },
  {
    nr: 3, date: "2026-03-05", journal: "BNK", desc: "Bankmutatie",
    lines: [
      { accID: "1100", debitC: 24200, desc: "Ontvangst 20260005", docRef: "BNK-3" },
      { accID: "1300", debitC: -24200, desc: "Ontvangst 20260005", docRef: "BNK-3" },
    ],
  },
];

function payload(over: Partial<KaartPayload> = {}): KaartPayload {
  const tb = buildLedgerCards(ENTRIES);
  return {
    year: 2026,
    cards: tb.cards,
    totalDebitC: tb.totalDebitC,
    totalCreditC: tb.totalCreditC,
    balanced: tb.balanced,
    unknownAccounts: tb.unknownAccounts,
    resultC: resultFromCards(tb),
    entries: ENTRIES,
    skipped: [],
    ...over,
  };
}

test("[GROOTBOEK-KAART] the saldibalans renders with real accounts and totals", () => {
  const html = renderToStaticMarkup(<GrootboekKaartView data={payload()} />);
  assert.ok(html.length > 200, "the screen must not render empty");
  assert.match(html, /Grootboek 2026/);
  assert.match(html, /Saldibalans/);
  // Named accounts, not bare codes: the name comes from the chart.
  assert.match(html, /1300 Debiteuren/);
  assert.match(html, /4000 Kosten/);
  assert.match(html, /8000 Omzet 21%/);
});

test("[GROOTBOEK-KAART] a debit balance says debet and a credit balance says credit", () => {
  const html = renderToStaticMarkup(<GrootboekKaartView data={payload()} />);
  assert.match(html, /debet/, "a cost account must state its side");
  assert.match(html, /credit/, "turnover is a credit balance");
});

test("[GROOTBOEK-KAART] no amount on the ledger is printed with a minus sign", () => {
  const html = renderToStaticMarkup(<GrootboekKaartView data={payload()} />);
  // A ledger prints the amount in one of two columns; the column IS the sign. A minus in front of
  // a euro amount here means the column convention was bypassed somewhere.
  assert.doesNotMatch(html, /-\s?€|€\s?-|−\s?€/, "the column carries the sign, never a minus");
});

test("[GROOTBOEK-KAART] a profit reaches the owner as a profit", () => {
  const html = renderToStaticMarkup(<GrootboekKaartView data={payload()} />);
  // Costs 100, turnover 200 → a profit of 100, however the ledger stores its sign.
  assert.match(html, /Winst/);
});

test("[GROOTBOEK-KAART] a complete ledger says nothing about itself", () => {
  const html = renderToStaticMarkup(<GrootboekKaartView data={payload()} />);
  assert.doesNotMatch(html, /sluit niet|staat niet in dit overzicht|onbekende rekening/,
    "[RUSTIG] nothing to report is nothing on the screen");
});

test("[GROOTBOEK-KAART] a refused document and an unbalanced set are BOTH stated", () => {
  const html = renderToStaticMarkup(
    <GrootboekKaartView data={payload({
      balanced: false,
      unknownAccounts: ["9999"],
      skipped: [{ source: "inkoop", id: "abc", reason: "geen factuurdatum — niet in een periode te plaatsen" }],
    })} />,
  );
  assert.match(html, /sluit niet/, "an administration that does not balance must say so on the page");
  assert.match(html, /staat niet in dit overzicht/, "a short ledger looks exactly like a complete one");
  assert.match(html, /9999/);
  assert.match(html, /geen factuurdatum/, "and the reason travels, not just the count");
});

test("[GROOTBOEK-KAART] an empty administration renders without throwing", () => {
  const leeg = renderToStaticMarkup(
    <GrootboekKaartView data={{
      year: 2026, cards: [], totalDebitC: 0, totalCreditC: 0, balanced: true,
      unknownAccounts: [], resultC: 0, entries: [], skipped: [],
    }} />,
  );
  assert.match(leeg, /Grootboek 2026/);
});
