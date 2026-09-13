// [BOEK-016] Pure node test for bank-import.ts — run: npx tsx bank-import.test.ts
import type { BankTransaction } from "./bank-parser";
import {
  contentKey,
  dedupTransactions,
  mapToRows,
  dateRange,
  rowToTransaction,
  type ExistingTxKey,
} from "./bank-import";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

function tx(p: Partial<BankTransaction>): BankTransaction {
  return {
    date: "2026-02-10", amount: 4.0, currency: "EUR", description: "Koffie",
    counterpartName: "Cafe X", counterpartIban: null, reference: null,
    transactionId: null, rawLine: "", ...p,
  };
}
function rowFromTx(t: BankTransaction): ExistingTxKey {
  return {
    date: t.date, amount: t.amount, description: t.description,
    counterpart_name: t.counterpartName, reference: t.reference,
  };
}

console.log("\n— contentKey (date, amount, counterpart, reference) —");
check("same content → same key (norm: trim/case/space)",
  contentKey("2026-02-10", 4, "Cafe X", "REF1") ===
  contentKey("2026-02-10", 4, "  cafe x ", "ref1"));
check("different amount → different key",
  contentKey("2026-02-10", 4, "Cafe X", null) !==
  contentKey("2026-02-10", 5, "Cafe X", null));
check("amount precision normalized (4 vs 4.00)",
  contentKey("2026-02-10", 4, "x", null) ===
  contentKey("2026-02-10", 4.0, "x", null));

console.log("\n— contentKey: format-stable counterpart (finding #1 fix) —");
// [BANK-DEDUP-CSV] The same real payment exported two ways: MT940 derives
// "Jansen Bouw B.V." from the REMI, the CSV reads "Jansen Bouw BV" from a column.
// Same date + amount + reference → must be ONE transaction, not two.
check("legal-form/punctuation variants share a key (B.V. == BV)",
  contentKey("2026-02-10", -1210, "Jansen Bouw B.V.", "29528") ===
  contentKey("2026-02-10", -1210, "Jansen Bouw BV", "29528"));
check("diacritics ignored (Café == Cafe)",
  contentKey("2026-02-10", 4, "Café Zürich", null) ===
  contentKey("2026-02-10", 4, "Cafe Zurich", null));
// SAFETY: digits are KEPT — two genuinely different same-day, same-amount,
// reference-less stores must stay DISTINCT so dedup never DROPS a real tx.
check("distinct numbered stores stay distinct (Shell 123 ≠ Shell 456)",
  contentKey("2026-02-10", -50, "Shell 123", null) !==
  contentKey("2026-02-10", -50, "Shell 456", null));

console.log("\n— dateRange —");
{
  const r = dateRange([tx({ date: "2026-02-10" }), tx({ date: "2026-01-05" }), tx({ date: "2026-03-01" })]);
  check("min/max correct", r.min === "2026-01-05" && r.max === "2026-03-01");
}

console.log("\n— dedup (multiset) —");
// 1. First upload — nothing existing → insert all (incl. legit in-file duplicates)
{
  const incoming = [tx({}), tx({}), tx({ description: "Huur", amount: -800, counterpartName: "Verhuur BV" })];
  const { toInsert, skipped } = dedupTransactions(incoming, []);
  check("first upload inserts all (2 coffees + rent)", toInsert.length === 3 && skipped === 0);
}
// 2. Re-upload identical file → insert 0
{
  const incoming = [tx({}), tx({})];
  const existing = incoming.map(rowFromTx);
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("re-upload identical → insert 0, skip 2", toInsert.length === 0 && skipped === 2);
}
// 3. In-file legit duplicates exceed existing → insert the surplus only
{
  const incoming = [tx({}), tx({}), tx({})]; // 3 identical coffees this file
  const existing = [rowFromTx(tx({}))];       // only 1 stored before
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("3 coffees vs 1 existing → insert 2, skip 1", toInsert.length === 2 && skipped === 1);
}
// 4. Overlapping upload — some new, some already stored
{
  const old = tx({ date: "2026-02-01", description: "Oud", amount: 100 });
  const fresh = tx({ date: "2026-02-15", description: "Nieuw", amount: 200 });
  const incoming = [old, fresh];
  const existing = [rowFromTx(old)];
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("overlap → insert only the new one", toInsert.length === 1 && toInsert[0].description === "Nieuw" && skipped === 1);
}

// 5. Cross-format re-upload: MT940 first, then the SAME period as CSV. The invoice
//    transfer must dedup; two distinct reference-less fuel stops must both survive.
{
  const mt940 = [
    tx({ date: "2026-02-10", amount: -1210, counterpartName: "Jansen Bouw B.V.", reference: "29528" }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const existing = mt940.map(rowFromTx);
  // CSV of the same period: same tx, column-sourced names (no dots / different noise).
  const csv = [
    tx({ date: "2026-02-10", amount: -1210, counterpartName: "Jansen Bouw BV", reference: "29528" }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const { toInsert, skipped } = dedupTransactions(csv, existing);
  check("cross-format re-upload dedups all 3 (no double-count of in/uit)", toInsert.length === 0 && skipped === 3);
}
// 6. Guard: the two distinct fuel stops are NOT collapsed on a first import.
{
  const incoming = [
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const { toInsert } = dedupTransactions(incoming, []);
  check("distinct numbered stores both import (no silent under-count)", toInsert.length === 2);
}

console.log("\n— mapToRows —");
{
  const rows = mapToRows([tx({ amount: -800, description: "Huur", counterpartName: "Verhuur BV", reference: "HUUR-02" })], "user-1");
  const r = rows[0];
  check("maps camel→snake + status pending + user pinned",
    r.user_id === "user-1" &&
    r.status === "pending" &&
    r.amount === -800 &&
    r.counterpart_name === "Verhuur BV" &&
    r.reference === "HUUR-02");
  check("empty strings → null", mapToRows([tx({ description: "" })], "u")[0].description === null);
}


console.log("\n— [BANK-TX-SOURCE-ID] the source's own id, above the fingerprint —");
// The layer exists for ONE case the fingerprint provably cannot cover: the same file imported
// again after the PARSER changed its mind. Measured reality behind it — one real ING quarter,
// 576 transactions, 576 distinct MT940 :61: refs and 576 distinct CAMT <NtryRef>, and ZERO ids
// in common between the two formats.
{
  const src = "MT940:NL02ABNA0123456789";
  // Stored yesterday, when the parser still installed the remittance sentence as the reference.
  const stored: ExistingTxKey = {
    date: "2026-04-01", amount: -81.51, description: "Incasso Huur",
    counterpart_name: "Woningstichting Zuid", reference: "Incasso Huur Periode: 01-04 tot 01-05",
    source: src, external_id: "26181327979582",
  };
  // The same line today: the MT940 reference fix means it now derives the mandate's EREF instead.
  const today = tx({
    date: "2026-04-01", amount: -81.51, description: "Incasso Huur",
    counterpartName: "Woningstichting Zuid", reference: "TK10000001",
    transactionId: "26181327979582",
  });
  check("fingerprints genuinely differ after the parser improved",
    contentKey(stored.date, stored.amount, stored.counterpart_name, stored.reference) !==
    contentKey(today.date, today.amount, today.counterpartName, today.reference));
  const withId = dedupTransactions([today], [stored], src);
  check("…yet the bank's own id still recognises it → insert 0",
    withId.toInsert.length === 0 && withId.skipped === 1);
  // Same inputs with no source named: this is what the old code did, and it doubles the rent.
  const withoutId = dedupTransactions([today], [stored]);
  check("without the id layer the SAME pair doubles — the bug this closes",
    withoutId.toInsert.length === 1);
}
// Cross-door: the ids disagree by design, so layer 1 must NOT fire and the fingerprint must catch it.
{
  const camtRow: ExistingTxKey = {
    date: "2026-05-25", amount: -224.85, description: "26002148",
    counterpart_name: "W. Ketels en Zoon Eierhandel", reference: "26002148",
    source: "CAMT053:NL02ABNA0123456789", external_id: "032026091490606085000000001",
  };
  const samePaymentFromMt940 = tx({
    date: "2026-05-25", amount: -224.85, description: "26002148",
    counterpartName: "W. Ketels en Zoon Eierhandel", reference: "26002148",
    transactionId: "26181327979582", // MT940 names it differently — zero overlap, as measured
  });
  const r = dedupTransactions([samePaymentFromMt940], [camtRow], "MT940:NL02ABNA0123456789");
  check("same payment, different door → ids don't match but the fingerprint does → insert 0",
    r.toInsert.length === 0 && r.skipped === 1);
}
// [EB-ACCOUNT-IDENTITY] The scope must be the account's STABLE identity, not its session handle.
// Enable Banking's AccountResource says uid is "valid only until the session … is in the
// AUTHORIZED status", while identification_hash exists for "matching accounts between multiple
// sessions". Scope the source on the uid and the whole layer quietly dies at every reconnect —
// which is the moment the re-sync deliberately re-reads history and needs it most.
//
// Be precise about the consequence: on its own, a moved scope is survivable, because layer 3 still
// recognises an UNCHANGED fingerprint. The damage needs both — a reconnect AND a fingerprint that
// has drifted since — and that pair is not exotic, it is the ordinary case: the consent expires
// every 180 days, and any parser improvement in between moves the fingerprint.
{
  const storedBeforeReconnect: ExistingTxKey = {
    date: "2026-04-01", amount: -81.51, description: "Incasso Huur",
    counterpart_name: "Woningstichting Zuid",
    reference: "Incasso Huur Periode: 01-04 tot 01-05",   // derived by the OLD parser
    source: "enablebanking:HASH-A", external_id: "ENTRY-1",
  };
  const sameLineToday = tx({
    date: "2026-04-01", amount: -81.51, description: "Incasso Huur",
    counterpartName: "Woningstichting Zuid",
    reference: "TK10000001",                               // derived by the parser we ship now
    transactionId: "ENTRY-1",
  });

  // An unchanged fingerprint survives a moved scope — layer 3 covers for layer 2.
  const unchanged = tx({
    date: "2026-04-01", amount: -81.51, description: "Incasso Huur",
    counterpartName: "Woningstichting Zuid",
    reference: "Incasso Huur Periode: 01-04 tot 01-05", transactionId: "ENTRY-1",
  });
  check("a moved scope alone is survivable — the fingerprint still matches",
    dedupTransactions([unchanged], [storedBeforeReconnect], "enablebanking:NEW-UID").skipped === 1);

  // Both at once is where the money doubles.
  const stable = dedupTransactions([sameLineToday], [storedBeforeReconnect], "enablebanking:HASH-A");
  check("stable scope + drifted fingerprint → the bank's own id still recognises it",
    stable.toInsert.length === 0 && stable.skipped === 1);
  const byUid = dedupTransactions([sameLineToday], [storedBeforeReconnect], "enablebanking:NEW-UID");
  check("uid scope + drifted fingerprint → NOTHING matches, and the rent imports twice",
    byUid.toInsert.length === 1);
}
// Two linked accounts. A bank only promises its id is unique WITHIN one account, so the scope
// must be part of the key — otherwise account B's transaction vanishes into account A's row.
{
  const onAccountA: ExistingTxKey = {
    date: "2026-04-01", amount: -50, description: "Abonnement",
    counterpart_name: "Leverancier", reference: "F-1",
    source: "enablebanking:acct-A", external_id: "SHARED-ID-1",
  };
  const onAccountB = tx({
    date: "2026-04-02", amount: -75, description: "Iets anders",
    counterpartName: "Andere partij", reference: "F-2", transactionId: "SHARED-ID-1",
  });
  const r = dedupTransactions([onAccountB], [onAccountA], "enablebanking:acct-B");
  check("same id on a DIFFERENT account is a different transaction → insert 1",
    r.toInsert.length === 1);
}
// A row explains at most one incoming line, whichever layer claimed it. Without that, the id
// layer and the fingerprint could both spend the same stored row and a real transaction is lost.
{
  const stored: ExistingTxKey = {
    date: "2026-02-10", amount: 4, description: "Koffie", counterpart_name: "Cafe X",
    reference: null, source: "MT940:NL1", external_id: "ID-1",
  };
  const byId = tx({ transactionId: "ID-1" });          // claims it via layer 1
  const byContent = tx({ transactionId: "ID-2" });     // identical content, different id
  const r = dedupTransactions([byId, byContent], [stored], "MT940:NL1");
  check("one stored row is consumed once → the second coffee still imports",
    r.toInsert.length === 1 && r.skipped === 1 && r.toInsert[0].transactionId === "ID-2");
}
// The degenerate halves. 147 of that quarter's 576 feed rows carry no entry_reference at all.
{
  const idless = tx({ transactionId: null });
  const r = dedupTransactions([idless], [rowFromTx(idless)], "enablebanking:acct-A");
  check("no id on either side → the fingerprint carries it alone",
    r.toInsert.length === 0 && r.skipped === 1);
  const preMigrationRow = rowFromTx(tx({})); // no source/external_id columns read
  const r2 = dedupTransactions([tx({ transactionId: "ID-9" })], [preMigrationRow], "MT940:NL1");
  check("rows stored before the migration still dedup by fingerprint",
    r2.toInsert.length === 0 && r2.skipped === 1);
}
// Storage is both-or-neither: an id without its scope would claim uniqueness across doors that
// provably disagree, and a scope without an id constrains nothing.
{
  const both = mapToRows([tx({ transactionId: "ID-1" })], "u", "MT940:NL1")[0];
  check("source + id → both stored", both.source === "MT940:NL1" && both.external_id === "ID-1");
  const noId = mapToRows([tx({ transactionId: null })], "u", "MT940:NL1")[0];
  check("source but no id → both null", noId.source === null && noId.external_id === null);
  const noSource = mapToRows([tx({ transactionId: "ID-1" })], "u")[0];
  check("id but no source → both null", noSource.source === null && noSource.external_id === null);
}

console.log("\n— rowToTransaction —");
{
  const t = rowToTransaction({ id: "tx-9", date: "2026-02-10", amount: -800, description: "Huur", counterpart_name: "Verhuur BV", reference: "HUUR-02" });
  check("DB id carried into transactionId", t.transactionId === "tx-9");
  check("snake→camel + EUR + signed amount", t.counterpartName === "Verhuur BV" && t.currency === "EUR" && t.amount === -800);
  check("null date → empty string (matcher-safe)", rowToTransaction({ id: "x", date: null, amount: 1, description: null, counterpart_name: null, reference: null }).date === "");
  // [DD-NAAR-MATCHER] The three direct-debit markers are stored, selected by name, and were then
  // dropped HERE — so scorePair saw `undefined` for every one of them, on every line, always.
  const dd = rowToTransaction({
    id: "tx-dd", date: "2026-03-10", amount: 242, description: "STORNO SEPA INCASSO",
    counterpart_name: "ATAPACK B.V.", reference: null,
    type_code: "NDDT", mandate_id: "M-2024-0091", creditor_id: "NL32ZZZ411951220000",
  });
  check("[DD-NAAR-MATCHER] the bank's own markers reach the matcher",
    dd.typeCode === "NDDT" && dd.mandateId === "M-2024-0091" && dd.creditorId === "NL32ZZZ411951220000");
  // A row from a database without bank_tx_direct_debit.sql applied says "unknown", never undefined:
  // the matcher's rule is a null-check, and an absent field must read the same as an absent marker.
  const bare = rowToTransaction({ id: "y", date: "2026-03-10", amount: 1, description: null, counterpart_name: null, reference: null });
  check("[DD-NAAR-MATCHER] a row without the columns yields null, not undefined",
    bare.typeCode === null && bare.mandateId === null && bare.creditorId === null);
}

// ── [REKENING-IN-SLEUTEL] a second account's identical line is real money, not a duplicate ────
{
  const feeRow: ExistingTxKey = {
    date: "2026-05-01", amount: -9.9, description: "Pakketkosten",
    counterpart_name: "Grote Bank NV", reference: null,
    source: "MT940:NL91ABNA0417164300", external_id: null,
  };
  const feeTx = tx({
    date: "2026-05-01", amount: -9.9, description: "Pakketkosten",
    counterpartName: "Grote Bank NV", reference: null, transactionId: null,
  });
  // Same fee, same day, DIFFERENT account: the second shop's line used to be dropped as a
  // duplicate ("1 dubbel overgeslagen" over real money). Both accounts are stable IBANs, so the
  // difference is provable — the line imports.
  const other = dedupTransactions([feeTx], [feeRow], "MT940:NL65RABO0171136276");
  check("[REKENING] zelfde regel op een ANDERE rekening importeert gewoon", other.toInsert.length === 1 && other.skipped === 0);
  // Same account: still the duplicate it always was.
  const same = dedupTransactions([feeTx], [feeRow], "MT940:NL91ABNA0417164300");
  check("[REKENING] zelfde regel op DEZELFDE rekening blijft een dubbel", same.skipped === 1);
  // A legacy row without an account (or a CSV that names none) stays compatible — unknown must
  // never read as different.
  const legacy = dedupTransactions([feeTx], [{ ...feeRow, source: null }], "MT940:NL65RABO0171136276");
  check("[REKENING] een rij zonder rekening blijft gewoon ontdubbelen", legacy.skipped === 1);
  // A session handle is not an identity — the enablebanking reconnect case keeps its recovery.
  const handle = dedupTransactions([feeTx], [{ ...feeRow, source: "enablebanking:HASH-A" }], "enablebanking:NEW-UID");
  check("[REKENING] een verplaatst sessiehandvat leest als onbekend, nooit als anders", handle.skipped === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);