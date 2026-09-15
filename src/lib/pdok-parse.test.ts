// src/lib/pdok-parse.test.ts
// [ADRES-ECHT] Run: npx tsx --test src/lib/pdok-parse.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { countAddresses, parseAddressDoc, parsePdokAnswer, pdokQuery } from "./pdok-parse";

/** One PDOK "adres" document, with the fields this app reads. */
const doc = (over: Record<string, unknown> = {}) => ({
  type: "adres",
  straatnaam: "Tilburgseweg",
  huisnummer: 42,
  postcode: "5038ED",
  woonplaatsnaam: "Tilburg",
  weergavenaam: "Tilburgseweg 42, 5038ED Tilburg",
  ...over,
});
const answer = (docs: unknown[]) => ({ response: { numFound: docs.length, docs } });

test("[ADRES-ECHT] a normal address document reads", () => {
  assert.deepStrictEqual(parseAddressDoc(doc()), {
    postcode: "5038ED", houseNumber: 42, addition: "", street: "Tilburgseweg", city: "Tilburg",
  });
});

test("[ADRES-ECHT] the addition is two BAG fields, and either may be absent", () => {
  // "42", "42A", "42-2" and "42A-2" are four different front doors.
  assert.strictEqual(parseAddressDoc(doc({ huisletter: "A" }))?.addition, "A");
  assert.strictEqual(parseAddressDoc(doc({ huisnummertoevoeging: "2" }))?.addition, "2");
  assert.strictEqual(parseAddressDoc(doc({ huisletter: "A", huisnummertoevoeging: "2" }))?.addition, "A-2");
  assert.strictEqual(parseAddressDoc(doc())?.addition, "");
});

test("[ADRES-ECHT] only a house-level hit counts", () => {
  // A postcode search also returns the street and the town. "Tilburg exists" is not an answer to
  // "does number 42 exist".
  for (const type of ["woonplaats", "weg", "postcode", "gemeente", "", undefined]) {
    assert.strictEqual(parseAddressDoc(doc({ type })), null, `type ${String(type)} was accepted`);
  }
});

test("[ADRES-ECHT] half an answer is no answer", () => {
  // Any missing field means it cannot be printed on an invoice, and half an answer is the kind
  // that gets accepted without being read.
  for (const missing of ["straatnaam", "woonplaatsnaam", "postcode", "huisnummer"]) {
    assert.strictEqual(parseAddressDoc(doc({ [missing]: "" })), null, `${missing} empty was accepted`);
    assert.strictEqual(parseAddressDoc(doc({ [missing]: undefined })), null, `${missing} absent was accepted`);
  }
  assert.strictEqual(parseAddressDoc(doc({ postcode: "50388ED" })), null, "a malformed postcode was accepted");
  assert.strictEqual(parseAddressDoc(doc({ huisnummer: 0 })), null);
  assert.strictEqual(parseAddressDoc(doc({ huisnummer: "42A" })), null, "an addition in the number field passed");
});

test("[ADRES-ECHT] a house number arrives as a number or a numeric string, never as anything else", () => {
  assert.strictEqual(parseAddressDoc(doc({ huisnummer: "42" }))?.houseNumber, 42);
  assert.strictEqual(parseAddressDoc(doc({ huisnummer: 42.9 }))?.houseNumber, 42);
  for (const bad of [null, true, {}, [], "-3", "0"]) {
    assert.strictEqual(parseAddressDoc(doc({ huisnummer: bad })), null, `${JSON.stringify(bad)} was accepted`);
  }
});

test("[ADRES-ECHT] garbage in is null out, never a crash", () => {
  for (const rommel of [null, undefined, 42, "adres", [], {}, { response: null }, { response: {} },
                        { response: { docs: "x" } }, { response: { docs: [null, 3, "x"] } }]) {
    assert.strictEqual(parsePdokAnswer(rommel), null, JSON.stringify(rommel));
    assert.strictEqual(countAddresses(rommel), 0, JSON.stringify(rommel));
  }
});

test("[ADRES-ECHT] exactly one hit is an answer; several is not", () => {
  assert.deepStrictEqual(parsePdokAnswer(answer([doc()]))?.street, "Tilburgseweg");
  assert.strictEqual(parsePdokAnswer(answer([])), null);

  // A building with two front doors: picking the first would put a neighbour's addition on an
  // invoice. The count still says two, so the route can say WHY it did not fill anything in.
  const twee = answer([doc({ huisletter: "A" }), doc({ huisletter: "B" })]);
  assert.strictEqual(parsePdokAnswer(twee), null, "one of two front doors was chosen for the owner");
  assert.strictEqual(countAddresses(twee), 2);

  // Noise beside one real hit does not make it ambiguous: the street and town rows are dropped
  // before counting.
  const eenPlusRuis = answer([doc({ type: "woonplaats" }), doc(), doc({ type: "weg" })]);
  assert.strictEqual(parsePdokAnswer(eenPlusRuis)?.houseNumber, 42);
  assert.strictEqual(countAddresses(eenPlusRuis), 1);
});

test("[ADRES-ECHT] the query is built here, so a number cannot be smuggled into the postcode", () => {
  assert.strictEqual(pdokQuery("5038 ed", 42), "5038ED 42");
  assert.strictEqual(pdokQuery("5038ED", 42.7), "5038ED 42");
  // An unusable postcode drops out rather than being sent as typed.
  assert.strictEqual(pdokQuery("onzin", 42), "42");
});
