// src/lib/grootboek-kaart-lines.test.ts — run: npx tsx --test src/lib/grootboek-kaart-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { debetCredit, saldoZin, resultaatZin, volledigheidZin, mutatieTelling, journaalNaam } from "./grootboek-kaart-lines";

test("the column is the sign — a ledger never prints a minus", () => {
  const d = debetCredit(12100);
  assert.equal(d.credit, "");
  assert.ok(!d.debet.includes("-") && !d.debet.includes("−"), `debit column printed a minus: ${d.debet}`);
  const c = debetCredit(-12100);
  assert.equal(c.debet, "");
  assert.ok(!c.credit.includes("-") && !c.credit.includes("−"), `credit column printed a minus: ${c.credit}`);
  // Both columns carry the SAME magnitude — only the side differs.
  assert.equal(d.debet, c.credit);
});

test("zero stands in the debit column, not in neither", () => {
  const z = debetCredit(0);
  assert.equal(z.credit, "");
  assert.ok(z.debet.length > 0);
});

test("a balance names its side and is never negative", () => {
  assert.match(saldoZin(50000), /debet$/);
  assert.match(saldoZin(-50000), /credit$/);
  for (const v of [50000, -50000]) {
    assert.ok(!saldoZin(v).includes("-"), `saldo printed a minus: ${saldoZin(v)}`);
  }
  assert.equal(saldoZin(0), "€ 0,00", "a nil balance has no side");
});

test("a profit is not shown to the owner as a negative number", () => {
  // resultC is debit-positive, so a profit arrives NEGATIVE. Printing "−12.500" to the one person
  // it is addressed to would be exactly wrong.
  const winst = resultaatZin(-1250000);
  assert.match(winst, /^Winst /);
  assert.ok(!winst.includes("-"), winst);
  assert.match(resultaatZin(1250000), /^Verlies /);
  assert.equal(resultaatZin(0), "Resultaat € 0,00");
});

test("a complete, balanced ledger says nothing at all", () => {
  assert.equal(volledigheidZin({ balanced: true, skippedCount: 0, unknownAccounts: [] }), null,
    "[RUSTIG] nothing to report is nothing on the screen");
});

test("what is missing is stated, because a short ledger looks exactly like a complete one", () => {
  const een = volledigheidZin({ balanced: true, skippedCount: 1, unknownAccounts: [] });
  assert.match(String(een), /1 stuk staat niet/);
  const meer = volledigheidZin({ balanced: true, skippedCount: 4, unknownAccounts: [] });
  assert.match(String(meer), /4 stukken staan niet/);
  const scheef = volledigheidZin({ balanced: false, skippedCount: 0, unknownAccounts: [] });
  assert.match(String(scheef), /sluit niet/);
  const onbekend = volledigheidZin({ balanced: true, skippedCount: 0, unknownAccounts: ["9999"] });
  assert.match(String(onbekend), /9999/);
  // All three at once still reads as one sentence, not three stacked warnings.
  const alles = String(volledigheidZin({ balanced: false, skippedCount: 2, unknownAccounts: ["9999"] }));
  assert.ok(alles.includes("sluit niet") && alles.includes("2 stukken") && alles.includes("9999"));
});

test("counts read as Dutch", () => {
  assert.equal(mutatieTelling(1), "1 mutatie");
  assert.equal(mutatieTelling(3), "3 mutaties");
});

test("journal codes get their Dutch name, and an unknown code stays itself", () => {
  assert.equal(journaalNaam("INK"), "Inkoop");
  assert.equal(journaalNaam("MEM"), "Memoriaal");
  assert.equal(journaalNaam("XYZ"), "XYZ", "inventing a name for a code we do not know is worse than showing it");
});
