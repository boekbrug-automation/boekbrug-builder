// npx tsx --test src/lib/grootboek.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_ACCOUNTS, DEFAULT_LEDGER_ACCOUNT, ledgerAccount, isLedgerAccount, suggestLedgerAccount,
} from "./grootboek";
import { XAF_ACCOUNTS } from "./xaf-export";

test("[GROOTBOEK] 4000 is unchanged — renumbering it would move history", () => {
  const existing = XAF_ACCOUNTS.find((a) => a.accID === "4000");
  const ours = ledgerAccount("4000");
  assert.ok(existing && ours);
  assert.equal(ours.name, existing.accDesc, "the export and the chart must name it the same");
  assert.equal(ours.rgs, existing.rgs);
  assert.equal(DEFAULT_LEDGER_ACCOUNT, "4000");
});

test("[GROOTBOEK] every account has a number and a Dutch name, and the numbers are unique", () => {
  const ids = LEDGER_ACCOUNTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "two accounts sharing a number is a misfiled export");
  for (const a of LEDGER_ACCOUNTS) {
    assert.match(a.id, /^\d{4}$/, `${a.id} is not an account number`);
    assert.ok(a.name.trim().length > 0, `${a.id} has no name`);
  }
});

test("[GROOTBOEK] an RGS code is a verified one or it is null — never a guess", () => {
  // The rule is inherited verbatim from xaf-export.ts: a missing code is a lookup, a wrong code
  // is a misfiled administration. These six were verified against the public registry.
  const verified = new Map([
    ["4000", "WBed"], ["4100", "WBedHui"], ["4200", "WBedVkk"], ["4210", "WBedVkkRep"],
    ["4300", "WBedKan"], ["4310", "WBedKanOka"], ["7000", "WKprInh"],
  ]);
  for (const a of LEDGER_ACCOUNTS) {
    if (verified.has(a.id)) assert.equal(a.rgs, verified.get(a.id), `${a.id} carries the wrong code`);
    else assert.equal(a.rgs, null, `${a.id} carries an unverified RGS code`);
  }
});

test("[GROOTBOEK] an unknown account number is not an account", () => {
  assert.equal(ledgerAccount("9999"), undefined);
  assert.equal(isLedgerAccount("9999"), false);
  assert.equal(isLedgerAccount(null), false);
  assert.equal(isLedgerAccount(undefined), false);
  assert.equal(isLedgerAccount(""), false);
  assert.equal(isLedgerAccount(" 4100 "), true, "a stored value may carry whitespace");
});

test("[GROOTBOEK] nothing known means the app says so — not 4000 with an opinion", () => {
  const s = suggestLedgerAccount({});
  assert.deepEqual([s.accountId, s.confidence, s.basis], ["4000", 0, "default"]);
});

test("[GROOTBOEK] a unanimous supplier history decides, and grows more certain with repetition", () => {
  const once = suggestLedgerAccount({ vendor: "Van Dijk Vastgoed", supplierHistory: ["4100"] });
  assert.deepEqual([once.accountId, once.basis], ["4100", "supplier_history"]);
  assert.equal(once.confidence, 0.8);

  const often = suggestLedgerAccount({ supplierHistory: ["4100", "4100", "4100", "4100"] });
  assert.equal(often.confidence, 0.95, "a habit, not a coincidence");
  assert.ok(often.confidence < 1, "never certainty — the owner has always been able to move it");
});

test("[GROOTBOEK] a supplier split across accounts is not guessed at by majority", () => {
  // A landlord who also bills for cleaning. Guessing the majority would be wrong precisely on the
  // invoices worth getting right.
  const s = suggestLedgerAccount({
    vendor: "Van Dijk", description: "Schoonmaak januari",
    supplierHistory: ["4100", "4100", "4100", "4600"],
  });
  assert.notEqual(s.basis, "supplier_history", "a split history decides nothing");
  assert.equal(s.basis, "default", "…and falls through to the words, which name nothing here");
});

test("[GROOTBOEK] history that is not an account of ours is ignored, not trusted", () => {
  const s = suggestLedgerAccount({ supplierHistory: ["9999", "", "  "] });
  assert.equal(s.basis, "default");
  // …and a real one beside the junk still counts.
  assert.equal(suggestLedgerAccount({ supplierHistory: ["9999", "4300"] }).accountId, "4300");
});

test("[GROOTBOEK] the document's own words name the account, and say which word did", () => {
  const huur = suggestLedgerAccount({ description: "Huurtermijn bedrijfspand februari" });
  assert.equal(huur.accountId, "4100");
  assert.equal(huur.basis, "keywords");
  assert.equal(huur.matched, "huurtermijn", "the word that decided is named, so the owner can disagree with a reason");
  assert.equal(huur.confidence, 0.6, "words are weaker than the owner's own history");

  assert.equal(suggestLedgerAccount({ description: "Autoverzekering 2026" }).accountId, "4500");
  assert.equal(suggestLedgerAccount({ vendor: "Shell Tankstation Breda" }).accountId, "4400");
  assert.equal(suggestLedgerAccount({ description: "Drukwerk visitekaartjes" }).accountId, "4200");
});

test("[GROOTBOEK] the owner's history outranks the words", () => {
  const s = suggestLedgerAccount({
    description: "Huurtermijn bedrijfspand",
    supplierHistory: ["4600", "4600"],
  });
  assert.equal(s.accountId, "4600", "what this owner actually does beats what the word suggests");
  assert.equal(s.basis, "supplier_history");
});

test("[GROOTBOEK] matching survives punctuation and case", () => {
  for (const text of ["HUUR-TERMIJN", "Huur termijn", "huur/termijn", "  Huur  "]) {
    assert.equal(suggestLedgerAccount({ description: text }).accountId, "4100", text);
  }
});

test("[GROOTBOEK] a longer word wins over a shorter one it contains", () => {
  // 'representatie' must not be read as anything else, and 'kantoorartikelen' not as 'artikel'.
  assert.equal(suggestLedgerAccount({ description: "Representatiekosten diner" }).accountId, "4210");
  assert.equal(suggestLedgerAccount({ description: "Kantoorartikelen bestelling" }).accountId, "4300");
});

test("[GROOTBOEK] a suggestion is never a booking", () => {
  // Nothing in this module writes, and the default carries no confidence to act on.
  const s = suggestLedgerAccount({ vendor: "Onbekend B.V." });
  assert.equal(s.confidence, 0);
});
