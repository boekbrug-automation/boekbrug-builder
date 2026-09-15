// src/lib/zelffacturering.test.ts — run: npx tsx --test src/lib/zelffacturering.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { selfBilledWordInDocument } from "./zelffacturering";

test("the Dutch term of art, in its usual spellings", () => {
  for (const t of ["Zelffacturering", "zelf-facturering", "zelffactuur", "Zelffacturatie"]) {
    assert.equal(selfBilledWordInDocument(`Factuur 2026-0044\n${t} conform afspraak.`), true, t);
  }
});

test("the legal formula, wherever on the page it stands", () => {
  // The point of scanning past the header: this line is printed at the BOTTOM, next to the article
  // reference, on every Dutch self-billed invoice the term appears on.
  const doc = "FACTUUR\nNr 88123\nDatum 12-08-2026\n" + "x".repeat(1500) +
    "\nDeze factuur is uitgereikt door de afnemer conform artikel 35 Wet OB.";
  assert.equal(selfBilledWordInDocument(doc), true);
  assert.equal(selfBilledWordInDocument("Opgemaakt door de opdrachtgever."), true);
  assert.equal(selfBilledWordInDocument("opgesteld door koper"), true);
});

test("the English term, which Dutch suppliers print too", () => {
  for (const t of ["Self-billing invoice", "self billed invoice", "SELFBILLING"]) {
    assert.equal(selfBilledWordInDocument(t), true, t);
  }
});

test("a denial is not an announcement", () => {
  assert.equal(selfBilledWordInDocument("Geen zelffacturering van toepassing."), false);
  assert.equal(selfBilledWordInDocument("No self-billing agreement is in place."), false);
  assert.equal(selfBilledWordInDocument("Er is geen sprake van zelffacturering."), false);
});

test("an ordinary invoice is untouched", () => {
  const gewoon = [
    "Factuur 2026-0031\nLeverdatum 3 juli\nSubtotaal 100,00\nBtw 21% 21,00\nTotaal 121,00",
    "Bij retour ontvangt u een creditnota.",
    "Betaling binnen 30 dagen na factuurdatum.",
    "Zelf ophalen kan ook, na afspraak.",
  ];
  for (const t of gewoon) assert.equal(selfBilledWordInDocument(t), false, t);
});

test("no text layer is not evidence of the opposite", () => {
  for (const t of [null, undefined, ""]) assert.equal(selfBilledWordInDocument(t), false);
});
