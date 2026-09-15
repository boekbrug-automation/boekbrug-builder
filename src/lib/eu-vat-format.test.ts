// src/lib/eu-vat-format.test.ts
// [EU-BTW] Run: npx tsx --test src/lib/eu-vat-format.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EU_VAT_COUNTRIES, euVatShape, isOtherEuCountry, normaliseEuVat, vatCountry } from "./eu-vat-format";

test("[EU-BTW] how a person writes it is not how it is registered", () => {
  assert.strictEqual(normaliseEuVat(" nl 8220.81297 b01 "), "NL822081297B01");
  assert.strictEqual(normaliseEuVat("BE-0123.456.749"), "BE0123456749");
  assert.strictEqual(normaliseEuVat(null), "");
  assert.strictEqual(normaliseEuVat(42 as unknown as string), "");
});

test("[EU-BTW] a real number of each of the big neighbours is possible", () => {
  for (const nummer of [
    "NL822081297B01",   // NL: 9 digits, B, 2
    "BE0123456749",     // BE: 10 digits starting 0
    "DE123456789",      // DE: 9 digits
    "FR40303265045",    // FR: 2 alphanumeric + 9
    "IT12345678901",    // IT: 11 digits
    "ES A12345674",     // ES: letter + 7 + check
    "PL1234567890",
    "SE123456789012",
  ]) {
    const shape = euVatShape(nummer);
    assert.strictEqual(shape.shape, "possible", `${nummer} was refused: ${JSON.stringify(shape)}`);
  }
});

test("[EU-BTW] the shapes that cannot be, each with a reason a person can act on", () => {
  // Narrowed rather than reached into: `reason` exists only on the impossible branch, and that is
  // the type doing its job — a caller cannot print an excuse next to a number that passed.
  const waarom = (raw: string): string => {
    const shape = euVatShape(raw);
    assert.strictEqual(shape.shape, "impossible", `${raw} was accepted`);
    return shape.shape === "impossible" ? shape.reason : "";
  };
  assert.match(waarom(""), /Vul een btw-nummer in/);
  assert.match(waarom("822081297B01"), /begint met een landcode/);
  assert.match(waarom("US123456789"), /geen EU-land/);
  assert.match(waarom("NL12345B01"), /vorm van een NL-btw-nummer/);
  // A Dutch number missing the B is the most common real typo, and it must not pass.
  assert.strictEqual(euVatShape("NL82208129701").shape, "impossible");
});

test("[EU-BTW] shape is not existence, and the module never claims otherwise", () => {
  // Perfectly shaped, belongs to nobody. Only VIES can tell the difference, and this module says
  // "possible" precisely so nothing downstream reads it as "valid".
  const shape = euVatShape("NL999999999B99");
  assert.strictEqual(shape.shape, "possible");
  assert.ok(!("valid" in shape), "the result grew a field that claims existence");
});

test("[EU-BTW] the Dutch 11-proof is deliberately NOT applied", () => {
  // Since 2020 the btw-identificatienummer of an eenmanszaak is random and does not satisfy the
  // old RSIN 11-proof. Applying it would refuse real, current numbers of exactly the smallest
  // businesses this product is for — and a check that refuses a correct number is worse than none.
  assert.strictEqual(euVatShape("NL123456789B01").shape, "possible");
});

test("[EU-BTW] a foreign number is recognised as foreign, and nonsense never is", () => {
  assert.ok(isOtherEuCountry("BE0123456749"));
  assert.ok(!isOtherEuCountry("NL822081297B01"), "a Dutch number is not intra-EU");
  // The dangerous direction: an unrecognisable value must never read as foreign, because that
  // decides btw verlegd and therefore who owes the tax.
  for (const rommel of ["", "onbekend", "US123456789", "NL123", null, undefined]) {
    assert.ok(!isOtherEuCountry(rommel), `"${String(rommel)}" was read as another EU country`);
  }
});

test("[EU-BTW] the country list covers the union, and XI is in it", () => {
  assert.ok(EU_VAT_COUNTRIES.length >= 27, `only ${EU_VAT_COUNTRIES.length} countries known`);
  for (const land of ["NL", "BE", "DE", "FR", "IT", "ES", "PL", "XI"]) {
    assert.ok(EU_VAT_COUNTRIES.includes(land), `${land} missing`);
  }
  assert.strictEqual(vatCountry("be0123456749"), "BE");
  assert.strictEqual(vatCountry("123456789"), null);
});
