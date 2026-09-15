// src/lib/factuurketen.test.ts — run: npx tsx --test src/lib/factuurketen.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { factuurketen, isGecorrigeerd, ketenZin, origineelVan, type KetenDocument } from "./factuurketen";

const inv: KetenDocument = {
  id: "a", invoice_number: "INV-100", invoice_type: "factuur",
  invoice_date: "2026-09-01", total_inc_btw: 1210,
};
const credit: KetenDocument = {
  id: "b", invoice_number: "CR-101", invoice_type: "creditnota",
  invoice_date: "2026-09-05", total_inc_btw: -121, original_invoice_id: "a",
};
const vervanger: KetenDocument = {
  id: "c", invoice_number: "INV-102", invoice_type: "factuur",
  invoice_date: "2026-09-06", total_inc_btw: 1089,
};

test("an untouched invoice is a chain of one, and says nothing", () => {
  const k = factuurketen(inv, [inv]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel"]);
  assert.equal(isGecorrigeerd(k), false);
  assert.equal(ketenZin(k), null);
});

test("the creditnota that names this invoice joins the chain", () => {
  const k = factuurketen(inv, [inv, credit]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel", "creditnota"]);
  assert.equal(k[1].nummer, "CR-101");
  assert.equal(k[1].bedrag, -121, "the creditnota keeps its own sign");
  assert.match(String(ketenZin(k)), /gecrediteerd met CR-101/);
});

test("the replacement is found by the NUMBER the original carries", () => {
  const met = { ...inv, superseded_by_number: "INV-102" };
  const k = factuurketen(met, [met, credit, vervanger]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel", "creditnota", "vervanger"]);
  assert.match(String(ketenZin(k)), /gecrediteerd met CR-101 en vervangen door INV-102/);
});

test("a link we cannot SEE is never claimed", () => {
  // "no replacement" and "the replacement was not loaded" must not render identically. The caller
  // says which it had; this function only reports what is in front of it.
  const met = { ...inv, superseded_by_number: "INV-102" };
  const k = factuurketen(met, [met]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel"]);
  assert.equal(ketenZin(k), null);
});

test("a creditnota belonging to another invoice does not join", () => {
  const ander = { ...credit, original_invoice_id: "zzz" };
  assert.deepEqual(factuurketen(inv, [inv, ander]).map((s) => s.soort), ["origineel"]);
});

test("a non-creditnota pointing at this invoice is not a credit", () => {
  const nep = { ...credit, invoice_type: "factuur" };
  assert.deepEqual(factuurketen(inv, [inv, nep]).map((s) => s.soort), ["origineel"]);
});

test("an invoice never replaces itself", () => {
  const zelf = { ...inv, superseded_by_number: "INV-100" };
  assert.deepEqual(factuurketen(zelf, [zelf]).map((s) => s.soort), ["origineel"]);
});

test("an unreadable total travels as null, never as zero", () => {
  const geen = { ...inv, total_inc_btw: null };
  assert.equal(factuurketen(geen, [geen])[0].bedrag, null, "a zero here would be an invented amount");
});

test("the chain says what the documents ARE, never what the money means", () => {
  // Whether the customer still owes anything is factuurstaat's question, from the amounts.
  // Answering it twice in two places is how two screens come to disagree.
  const met = { ...inv, superseded_by_number: "INV-102" };
  const zin = String(ketenZin(factuurketen(met, [met, credit, vervanger])));
  assert.doesNotMatch(zin, /betaald|openstaand|verschuldigd|te laat/);
});

// ── The chain read from the CREDITNOTA's end ────────────────────────────────────────────────

test("handed the creditnota, the chain still starts at the invoice it corrects", () => {
  // It used to call the creditnota the 'origineel' of a one-link chain — the one thing a
  // creditnota certainly is not.
  const k = factuurketen(credit, [inv, credit]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel", "creditnota"]);
  assert.equal(origineelVan(k)?.nummer, "INV-100");
});

test("a creditnota whose original is not loaded claims no original", () => {
  const k = factuurketen(credit, [credit]);
  assert.deepEqual(k.map((s) => s.soort), ["creditnota"]);
  assert.equal(origineelVan(k), null, "an original we cannot see is never invented");
});

test("a creditnota against an invoice issued elsewhere has no row to point at", () => {
  const los = { ...credit, original_invoice_id: null };
  const k = factuurketen(los, [los]);
  assert.deepEqual(k.map((s) => s.soort), ["creditnota"]);
  assert.equal(origineelVan(k), null);
});

test("from the creditnota's end the replacement of the ORIGINAL is still seen", () => {
  const met = { ...inv, superseded_by_number: "INV-102" };
  const k = factuurketen(credit, [met, credit, vervanger]);
  assert.deepEqual(k.map((s) => s.soort), ["origineel", "creditnota", "vervanger"]);
});
