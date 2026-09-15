// src/lib/dutch-address.test.ts
// [ADRES-ECHT] Run: npx tsx --test src/lib/dutch-address.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  canBeLookedUp, compareToRegister, mergeAccepted, normaliseAddress, normalisePostcode,
  postcodeLine, splitHouseNumber, streetLine, type DutchAddress,
} from "./dutch-address";

const adres = (over: Partial<DutchAddress> = {}): DutchAddress => ({
  postcode: "5038ED", houseNumber: 42, addition: "", street: "Tilburgseweg", city: "Tilburg", ...over,
});

test("[ADRES-ECHT] a postcode is accepted the way the country writes it", () => {
  for (const geschreven of ["5038ED", "5038 ED", "5038 ed", " 5038ed "]) {
    assert.strictEqual(normalisePostcode(geschreven), "5038ED", geschreven);
  }
  for (const geen of ["5038", "ED5038", "50388ED", "", null, undefined]) {
    assert.strictEqual(normalisePostcode(geen as string), "", String(geen));
  }
});

test("[ADRES-ECHT] the house number and what follows it are two fields, because the register says so", () => {
  // A lookup with "42A" in the number field finds nothing at all.
  assert.deepStrictEqual(splitHouseNumber("42A"), { number: 42, addition: "A" });
  assert.deepStrictEqual(splitHouseNumber("42-A"), { number: 42, addition: "A" });
  assert.deepStrictEqual(splitHouseNumber("42 bis"), { number: 42, addition: "bis" });
  assert.deepStrictEqual(splitHouseNumber("042"), { number: 42, addition: "" });
  assert.deepStrictEqual(splitHouseNumber(42), { number: 42, addition: "" });
  for (const geen of ["", "A", "-", null, undefined, 0, -3]) {
    assert.deepStrictEqual(splitHouseNumber(geen as string), { number: 0, addition: "" }, String(geen));
  }
});

test("[ADRES-ECHT] an addition typed in its own field wins over one squeezed into the number", () => {
  const a = normaliseAddress({ postcode: "5038 ed", houseNumber: "42A", addition: "Gebouw C" });
  assert.strictEqual(a.houseNumber, 42);
  assert.strictEqual(a.addition, "Gebouw C", "the owner answered the question the form asked");
  const b = normaliseAddress({ postcode: "5038 ed", houseNumber: "42A" });
  assert.strictEqual(b.addition, "A");
});

test("[ADRES-ECHT] a lookup needs a postcode and a number, and nothing else identifies an address", () => {
  assert.ok(canBeLookedUp(adres()));
  assert.ok(!canBeLookedUp(adres({ postcode: "" })));
  assert.ok(!canBeLookedUp(adres({ houseNumber: 0 })));
  // A street and city are NOT enough: two towns have a Kerkstraat 1.
  assert.ok(!canBeLookedUp(adres({ postcode: "", houseNumber: 0 })));
});

test("[ADRES-ECHT] case and spacing are not a difference", () => {
  assert.deepStrictEqual(
    compareToRegister(adres({ street: "TILBURGSEWEG", city: "tilburg" }), adres()),
    [],
    "flagging casing trains people to click past the warnings that matter",
  );
});

test("[ADRES-ECHT] a real difference is reported per field, both sides shown", () => {
  const verschil = compareToRegister(adres({ street: "Tilburgseweg" }), adres({ street: "Tilburgse Weg 2" }));
  assert.strictEqual(verschil.length, 1);
  assert.deepStrictEqual(verschil[0], { field: "street", typed: "Tilburgseweg", register: "Tilburgse Weg 2" });
});

test("[ADRES-ECHT] a gap is not a contradiction, in either direction", () => {
  // The owner claimed nothing: the register is filling a gap.
  assert.deepStrictEqual(compareToRegister(adres({ street: "" }), adres()), []);
  // The register knows nothing: that is not the owner being wrong.
  assert.deepStrictEqual(compareToRegister(adres(), adres({ street: "" })), []);
});

test("[ADRES-ECHT] accepting keeps what the register cannot know", () => {
  const typed = adres({ street: "tilburgseweg", city: "tilburg", addition: "Gebouw C, t.a.v. De Vries" });
  const register = adres({ street: "Tilburgseweg", city: "Tilburg", addition: "" });
  const samen = mergeAccepted(typed, register);
  assert.strictEqual(samen.street, "Tilburgseweg", "the register is authoritative on the street");
  assert.strictEqual(samen.city, "Tilburg");
  assert.strictEqual(samen.addition, "Gebouw C, t.a.v. De Vries",
    "losing this delivers the invoice to the wrong desk");
});

test("[ADRES-ECHT] the two lines that go on the invoice", () => {
  assert.strictEqual(streetLine(adres()), "Tilburgseweg 42");
  assert.strictEqual(streetLine(adres({ addition: "A" })), "Tilburgseweg 42-A");
  assert.strictEqual(postcodeLine(adres()), "5038 ED Tilburg");
  // Nothing known is an empty line, never a stray dash or a lone space.
  assert.strictEqual(streetLine(adres({ street: "", houseNumber: 0, addition: "" })), "");
  assert.strictEqual(postcodeLine(adres({ postcode: "", city: "" })), "");
});
