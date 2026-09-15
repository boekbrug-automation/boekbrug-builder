// src/lib/betaling-zonder-stuk.test.ts — run: npx tsx --test src/lib/betaling-zonder-stuk.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentsWithoutDocument, betalingZonderStukZin, type BankLine } from "./betaling-zonder-stuk";

const keyOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const KNOWN = new Map([["adobe", "Adobe"], ["kpn", "KPN"]]);

const line = (over: Partial<BankLine> = {}): BankLine => ({
  id: "tx-1", date: "2026-09-04", amount: -89, counterpartName: "Adobe",
  description: "ADOBE SYSTEMS", invoiceId: null, status: "pending", ...over,
});

const run = (lines: BankLine[]) => paymentsWithoutDocument({ lines, knownSuppliers: KNOWN, keyOf });

test("a payment to a known supplier with nothing linked is reported, in positive euros", () => {
  const out = run([line()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].supplier, "Adobe");
  assert.equal(out[0].amount, 89, "a screen must never have to flip a sign");
});

test("money coming in is not a missing purchase invoice", () => {
  assert.deepEqual(run([line({ amount: 89 }), line({ amount: 0 })]), []);
});

test("a line that already carries its invoice is silent", () => {
  assert.deepEqual(run([line({ invoiceId: "inv-1" })]), []);
});

test("a decision the owner already made is not re-asked", () => {
  for (const status of ["ignored", "excluded", "matched", "confirmed"]) {
    assert.deepEqual(run([line({ status })]), [], `status ${status} must stay answered`);
  }
});

test("a shop we have never had an invoice from stays out of this list", () => {
  // That is the ordinary "this one needs a receipt" case, and needsDocument() already answers it on
  // the bank screen. Repeating it here would bury the signal under one already handled elsewhere.
  assert.deepEqual(run([line({ counterpartName: "Albert Heijn 1234" })]), []);
});

test("a line with no counterparty cannot name a supplier, so it says nothing", () => {
  assert.deepEqual(run([line({ counterpartName: null }), line({ counterpartName: "   " })]), []);
});

test("the same company written differently is still that company", () => {
  const out = run([line({ counterpartName: "ADOBE  " }), line({ id: "tx-2", counterpartName: "K.P.N.", amount: -121 })]);
  assert.deepEqual(out.map((o) => o.supplier), ["KPN", "Adobe"]);
});

test("the largest unbooked cost comes first", () => {
  const out = run([
    line({ id: "a", amount: -89 }),
    line({ id: "b", amount: -1210, counterpartName: "KPN" }),
    line({ id: "c", amount: -450 }),
  ]);
  assert.deepEqual(out.map((o) => o.transactionId), ["b", "c", "a"],
    "the biggest hole moves the result and the aangifte most");
});

test("the sentence states the fact and does not claim the invoice does not exist", () => {
  const zin = betalingZonderStukZin(run([line()])[0], (n) => `€ ${n.toFixed(2)}`);
  assert.match(zin, /Adobe/);
  assert.match(zin, /geen factuur aan gekoppeld/);
  // It may well be sitting unread in the mailbox. What we know is that nothing is linked to it.
  assert.doesNotMatch(zin, /ontbreekt|bestaat niet|kwijt/,
    "we know nothing is linked — not that no invoice exists");
});

test("an empty statement is an empty answer, not a crash", () => {
  assert.deepEqual(run([]), []);
});
