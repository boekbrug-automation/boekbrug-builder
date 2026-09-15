// src/lib/grootboekkaart.test.ts — run: npx tsx --test src/lib/grootboekkaart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedgerCards, ledgerCardFor, resultFromCards } from "./grootboekkaart";
import type { Entry } from "./xaf-export";

/** A purchase invoice of 100 + 21 btw, as the journal builds it. */
const inkoop = (nr: number, date: string, desc = "Inkoopfactuur 1"): Entry => ({
  nr, date, journal: "INK", desc,
  lines: [
    { accID: "4000", debitC: 10000, desc, docRef: `INK-${nr}` },
    { accID: "1400", debitC: 2100, desc, docRef: `INK-${nr}` },
    { accID: "1600", debitC: -12100, desc, docRef: `INK-${nr}` },
  ],
});

const verkoop = (nr: number, date: string): Entry => ({
  nr, date, journal: "VRK", desc: "Verkoopfactuur 1",
  lines: [
    { accID: "1300", debitC: 24200, desc: "Verkoopfactuur 1", docRef: `VRK-${nr}` },
    { accID: "8000", debitC: -20000, desc: "Verkoopfactuur 1", docRef: `VRK-${nr}` },
    { accID: "1500", debitC: -4200, desc: "Verkoopfactuur 1", docRef: `VRK-${nr}` },
  ],
});

test("a card carries the mutations of its own account and nothing else", () => {
  const tb = buildLedgerCards([inkoop(1, "2026-03-04"), verkoop(2, "2026-03-05")]);
  const kosten = ledgerCardFor(tb, "4000");
  assert.ok(kosten);
  assert.equal(kosten.mutations.length, 1);
  assert.equal(kosten.totalDebitC, 10000);
  assert.equal(kosten.totalCreditC, 0);
  assert.equal(kosten.balanceC, 10000, "a cost is a debit balance");
  assert.equal(kosten.accDesc, "Kosten", "the name comes from the chart, not from the booking");
});

test("the whole set balances, and says so", () => {
  const tb = buildLedgerCards([inkoop(1, "2026-03-04"), verkoop(2, "2026-03-05")]);
  assert.equal(tb.totalDebitC, tb.totalCreditC);
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebitC, 10000 + 2100 + 24200);
});

test("an unbalanced set is REPORTED, not silently absorbed", () => {
  // buildJournalEntries refuses such an entry, so this cannot arrive from the real pipeline. It is
  // asserted anyway: the value of `balanced` is that it can be false on the page, in front of the
  // one person able to act on it.
  const scheef: Entry = {
    nr: 9, date: "2026-04-01", journal: "MEM", desc: "scheef",
    lines: [{ accID: "4000", debitC: 500, desc: "x", docRef: "M-9" }],
  };
  const tb = buildLedgerCards([scheef]);
  assert.equal(tb.balanced, false);
});

test("the running balance is chronological, and stable when two entries share a date", () => {
  // Same day, deliberately supplied out of entry order: the card must still read 1 then 2.
  const tb = buildLedgerCards([inkoop(2, "2026-03-04", "tweede"), inkoop(1, "2026-03-04", "eerste")]);
  const kosten = ledgerCardFor(tb, "4000");
  assert.ok(kosten);
  assert.deepEqual(kosten.mutations.map((m) => m.entryNr), [1, 2],
    "a running balance that reorders between renders destroys trust in every other figure");
  assert.deepEqual(kosten.mutations.map((m) => m.runningC), [10000, 20000]);
});

test("an account booked but not in the chart is named, never given a blank", () => {
  const vreemd: Entry = {
    nr: 1, date: "2026-05-01", journal: "MEM", desc: "onbekend",
    lines: [
      { accID: "9999", debitC: 100, desc: "x", docRef: "M-1" },
      { accID: "1100", debitC: -100, desc: "x", docRef: "M-1" },
    ],
  };
  const tb = buildLedgerCards([vreemd]);
  assert.deepEqual(tb.unknownAccounts, ["9999"]);
  assert.equal(ledgerCardFor(tb, "9999")?.accDesc, "9999", "the code stands in for a name it has not got");
});

test("accounts with no movement do not appear", () => {
  const tb = buildLedgerCards([inkoop(1, "2026-03-04")]);
  assert.equal(ledgerCardFor(tb, "1000"), null, "an empty kas card is noise on a screen");
  assert.deepEqual(tb.cards.map((c) => c.accID), ["1400", "1600", "4000"], "and the rest are in chart order");
});

test("the result is turnover minus costs, debit-positive", () => {
  const tb = buildLedgerCards([inkoop(1, "2026-03-04"), verkoop(2, "2026-03-05")]);
  // costs 100 debit, turnover 200 credit → result −100 debit-positive, i.e. 100 profit.
  assert.equal(resultFromCards(tb), 10000 - 20000);
});

test("no balance-sheet account leaks into the result", () => {
  const tb = buildLedgerCards([inkoop(1, "2026-03-04")]);
  // Only 4000 is a P account here; 1400 and 1600 must not be counted.
  assert.equal(resultFromCards(tb), 10000);
});

test("an empty administration is an empty, balanced set — not a crash", () => {
  const tb = buildLedgerCards([]);
  assert.deepEqual(tb.cards, []);
  assert.equal(tb.balanced, true);
  assert.equal(resultFromCards(tb), 0);
});
