// src/lib/vreemde-valuta.test.ts — run: npx tsx --test src/lib/vreemde-valuta.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readCurrencyCode, isForeignCurrency, foreignCurrencyHold, HOME_CURRENCY } from "./vreemde-valuta";

test("an absent currency is not foreign — it is not a reason to do anything", () => {
  for (const raw of [null, undefined, "", "   "]) {
    assert.equal(readCurrencyCode(raw), null);
    assert.equal(isForeignCurrency(raw), false, `${JSON.stringify(raw)} must not hold anything`);
    assert.deepEqual(foreignCurrencyHold(raw), { hold: false, code: null });
  }
});

test("the home currency reads back as itself and holds nothing", () => {
  assert.equal(readCurrencyCode("EUR"), HOME_CURRENCY);
  assert.equal(readCurrencyCode("eur"), HOME_CURRENCY);
  assert.equal(readCurrencyCode(" € "), HOME_CURRENCY);
  assert.equal(isForeignCurrency("EUR"), false);
  assert.deepEqual(foreignCurrencyHold("€"), { hold: false, code: "EUR" });
});

test("a real foreign code holds, and the hold carries the name", () => {
  assert.deepEqual(foreignCurrencyHold("USD"), { hold: true, code: "USD" });
  assert.deepEqual(foreignCurrencyHold("gbp"), { hold: true, code: "GBP" });
  assert.deepEqual(foreignCurrencyHold("£"), { hold: true, code: "GBP" });
  assert.deepEqual(foreignCurrencyHold("CHF"), { hold: true, code: "CHF" });
});

test("a symbol that means more than one currency is not a reading", () => {
  // "kr" is Swedish, Norwegian and Danish. Naming one of the three on the owner's screen would be
  // a guess wearing the clothes of a fact.
  assert.equal(readCurrencyCode("kr"), null);
  assert.equal(readCurrencyCode("$"), null, "a bare dollar sign is USD, CAD, AUD, NZD, SGD…");
  assert.equal(isForeignCurrency("kr"), false, "a hold we cannot name is a hold nobody can resolve");
});

test("noise never becomes a currency", () => {
  for (const raw of ["1.234,56", "Totaal", "€ 1.234,56", "EURO", "US Dollar", "12", "E U R"]) {
    assert.equal(readCurrencyCode(raw), null, `${raw} must not read as a code`);
  }
});

test("three letters that are not a currency still hold — and that is deliberate", () => {
  // We cannot carry the ISO 4217 list and we must not pretend to. A three-letter code printed
  // where a currency belongs is treated as one: the cost of holding a euro invoice that printed
  // "NVT" is a question to a human; the cost of booking a dollar invoice as euros is a wrong
  // administration. The asymmetry decides it.
  assert.deepEqual(foreignCurrencyHold("XYZ"), { hold: true, code: "XYZ" });
});

test("the unambiguous symbols each map to exactly one code", () => {
  assert.equal(readCurrencyCode("¥"), "JPY");
  assert.equal(readCurrencyCode("₺"), "TRY");
  assert.equal(readCurrencyCode("₹"), "INR");
});

test("nothing here converts", () => {
  // The module's contract in one assertion: the answer to a foreign invoice is a name and a wait,
  // never a number. If a rate or an amount ever appears in this result, the guard has become the
  // very thing it exists to prevent.
  const result: Record<string, unknown> = { ...foreignCurrencyHold("USD") };
  assert.deepEqual(Object.keys(result).sort(), ["code", "hold"]);
});
