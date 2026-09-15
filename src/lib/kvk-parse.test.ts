// src/lib/kvk-parse.test.ts
// [KVK-OPTIONEEL] Run: npx tsx --test src/lib/kvk-parse.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { isKvkShaped, normaliseKvkNumber, parseKvkProfile } from "./kvk-parse";

const profiel = (over: Record<string, unknown> = {}) => ({
  kvkNummer: "12345678",
  statutaireNaam: "ABC Holding B.V.",
  handelsnaam: "ABC",
  adressen: [
    { type: "correspondentieadres", straatnaam: "Postbus", huisnummer: 1, plaats: "Tilburg" },
    { type: "bezoekadres", straatnaam: "Tilburgseweg", huisnummer: 42, plaats: "Tilburg" },
  ],
  ...over,
});

test("[KVK-OPTIONEEL] eight digits, and nothing else is worth a paid request", () => {
  assert.ok(isKvkShaped("12345678"));
  assert.ok(isKvkShaped("1234 5678"));
  for (const geen of ["1234567", "123456789", "1234567a", "", null, undefined]) {
    assert.ok(!isKvkShaped(geen as string), String(geen));
  }
  assert.strictEqual(normaliseKvkNumber(" 1234 5678 "), "12345678");
  assert.strictEqual(normaliseKvkNumber("abc"), "");
});

test("[KVK-OPTIONEEL] a profile reads, and the VISITING address is the one taken", () => {
  const r = parseKvkProfile(profiel(), "12345678");
  assert.strictEqual(r.reading, "found");
  if (r.reading !== "found") return;
  assert.strictEqual(r.company.name, "ABC Holding B.V.");
  assert.strictEqual(r.company.tradeName, "ABC");
  // Not "Postbus 1": an invoice that says Postbus where the law wants an address is a different
  // document, and the correspondence address is listed first on purpose in this fixture.
  assert.strictEqual(r.company.address, "Tilburgseweg 42");
  assert.strictEqual(r.company.city, "Tilburg");
});

test("[KVK-OPTIONEEL] a company without a visiting address still reads", () => {
  const r = parseKvkProfile(profiel({ adressen: [] }), "12345678");
  assert.strictEqual(r.reading, "found");
  if (r.reading !== "found") return;
  assert.strictEqual(r.company.address, "");
  assert.strictEqual(r.company.name, "ABC Holding B.V.");
});

test("[KVK-OPTIONEEL] an answer about another number is not an answer about this one", () => {
  const r = parseKvkProfile(profiel({ kvkNummer: "87654321" }), "12345678");
  assert.strictEqual(r.reading, "unusable");
  if (r.reading === "unusable") assert.match(r.why, /ander nummer/);
});

test("[KVK-OPTIONEEL] garbage is unusable, and a nameless profile is not a company", () => {
  // An empty array and a bare value are not profiles. The first version let those through as
  // "unknown-number", which the route turned into "de KvK kent dit nummer niet" — a verdict about
  // someone's company produced by not understanding the answer.
  for (const rommel of [null, 42, "profiel", [], [profiel()], {}, { kvkNummer: "" }]) {
    assert.strictEqual(parseKvkProfile(rommel, "12345678").reading, "unusable", JSON.stringify(rommel));
  }
  // A number where a string was expected is NOT garbage: an API that returns 12345678 rather than
  // "12345678" is being ordinary, and refusing it would be our bug shown as their answer.
  assert.strictEqual(parseKvkProfile(profiel({ kvkNummer: 12345678 }), "12345678").reading, "found");
  assert.strictEqual(
    parseKvkProfile(profiel({ statutaireNaam: "", naam: "", handelsnaam: "" }), "12345678").reading,
    "unusable",
  );

});
