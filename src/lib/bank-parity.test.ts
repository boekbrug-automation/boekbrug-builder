// [BANK-REF-ONE-SOURCE] Three doors, one statement — run: npx tsx --test src/lib/bank-parity.test.ts
//
// A transaction can reach BoekBrug three ways: an uploaded MT940, an uploaded CAMT.053, or the
// PSD2 feed. Cross-upload dedup (bank-import.ts) keys on
//
//     contentKey = date | amount | dedupName(counterpartName) | norm(reference)
//
// so the three doors must derive the SAME name and the SAME reference from the same payment. When
// they do not, the owner imports it twice and every figure built on it doubles — omzet, kosten,
// the btw-aangifte, the kwartaalpakket his accountant signs.
//
// This was not hypothetical. A real ING business quarter downloaded twice, once as CAMT and once
// as MT940 — two buttons on the same ING page — imported its 576 transactions with 28 different
// fingerprints. Nothing in the suite caught it, because every fixture until now was written by the
// same hand that wrote the parser, so both sides agreed on the same misreading.
//
// Each case below is one shape from that quarter, anonymised. The real files are not in the repo:
// they are somebody's salaries, suppliers and account numbers, and a regression test is not worth
// publishing those.
//
// What was replaced: counterparty names, every IBAN (the substitutes are mod-97 valid, so the same
// validation branches run), mandate/incassant ids, terminal ids and the one street address.
// What was NOT: the amounts, the dates, and the exact byte layout of the :61:/:86: and <Ntry>
// blocks — those are the structure that broke, and rounding them off would retire the test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMT940, parseCAMT053 } from "./bank-parser";
import { mapEnableBankingTransaction } from "./enablebanking-map";
import type { EnableBankingRawTransaction } from "./enablebanking-map";
import { contentKey } from "./bank-import";
import type { BankTransaction } from "./bank-parser";

const key = (t: Pick<BankTransaction, "date" | "amount" | "counterpartName" | "reference">) =>
  contentKey(t.date, t.amount, t.counterpartName, t.reference);

/** Wrap :61:/:86: pairs in the minimum envelope parseMT940 needs. */
function mt940(...pairs: string[]): string {
  return [
    "{1:F01INGBNL2ABXXX0000000000}",
    "{2:I940INGBNL2AXXXN}",
    "{4:",
    ":20:P260802000000001",
    ":25:NL02ABNA0123456789EUR",
    ":28C:00000",
    ":60F:C260401EUR1000,00",
    ...pairs,
    ":62F:C260630EUR1000,00",
    "-}",
  ].join("\n");
}

/** Wrap one <Ntry> in the minimum envelope parseCAMT053 needs. */
function camt(entry: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NL02ABNA0123456789</IBAN></Id></Acct>
  ${entry}
</Stmt></BkToCstmrStmt></Document>`;
}

interface Case {
  what: string;
  why: string;
  mt940: string;
  camt: string;
  feed: EnableBankingRawTransaction;
  /** Set false for the one shape whose feed twin cannot agree yet, and say why. The behaviour
   *  itself is pinned by its own test at the bottom of this file, so it cannot drift unnoticed. */
  feedAgrees?: false;
}

const CASES: Case[] = [
  {
    what: "a direct debit whose only reference is the mandate's end-to-end id",
    why:
      "MT940 carries it as /EREF/ in :86:, CAMT as <EndToEndId>. MT940 never read it and installed " +
      "the remittance sentence instead, so ten rent collections fingerprinted two ways.",
    mt940:
      ":61:2604010401D81,51NDDTEREF//26152220696910\n" +
      "/TRCD/01018/\n" +
      ":86:/EREF/TK10000001//MARF/100001//CSID/NL01ZZZ000000010000//CNTP\n" +
      "/NL11BNGH0002220001/BNGHNL2G/Woningstichting Zuid///REMI/USTD//Incasso  H\n" +
      "uur Periode: 01-04-2026 tot 01-05-2026/",
    camt: `<Ntry>
      <Amt Ccy="EUR">81.51</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <ValDt><Dt>2026-04-01</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>TK10000001</EndToEndId></Refs>
        <RltdPties><Cdtr><Nm>Woningstichting Zuid</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>NL11BNGH0002220001</IBAN></Id></CdtrAcct></RltdPties>
        <RmtInf><Ustrd>Incasso Huur Periode: 01-04-2026 tot 01-05-2026</Ustrd></RmtInf>
      </TxDtls></NtryDtls></Ntry>`,
    feed: {
      value_date: "2026-04-01",
      transaction_amount: { amount: "81.51", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Woningstichting Zuid" },
      creditor_account: { iban: "NL11BNGH0002220001" },
      remittance_information: ["Incasso Huur Periode: 01-04-2026 tot 01-05-2026"],
    },
    // The feed model has no end-to-end field; see the last test in this file.
    feedAgrees: false,
  },
  {
    what: "a payment whose betalingskenmerk sits in the :61: owner-reference field",
    why:
      "ING puts it after the four-character type code, 'NTRF1583366271601210//…'. The old pattern " +
      "read the type code as N.{0,4}, ate 'NTRF1', and the rest then failed the '//' that follows.",
    mt940:
      ":61:2604250425D1013,00NTRF1583366271601210//26115435747552\n" +
      "/TRCD/00112/\n" +
      ":86:/CNTP/NL86INGB0002445588/INGBNL2A/Belastingdienst//",
    camt: `<Ntry>
      <Amt Ccy="EUR">1013.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <ValDt><Dt>2026-04-25</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>1583366271601210</EndToEndId></Refs>
        <RltdPties><Cdtr><Nm>Belastingdienst</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>NL86INGB0002445588</IBAN></Id></CdtrAcct></RltdPties>
      </TxDtls></NtryDtls></Ntry>`,
    feed: {
      value_date: "2026-04-25",
      transaction_amount: { amount: "1013.00", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Belastingdienst" },
      creditor_account: { iban: "NL86INGB0002445588" },
      reference_number: "1583366271601210",
    },
  },
  {
    what: "a transfer whose description is a sentence, not an invoice number",
    why:
      "'deel salaris april 2026' is a description. MT940 installed it as the payment reference on " +
      "thirteen rows where CAMT correctly produced none, which also fed parseReferenceNumbers a " +
      "sentence and blocked the line from ever auto-booking.",
    mt940:
      ":61:2604020402D1000,00NTRFNONREF//26092353023650\n" +
      "/TRCD/00112/\n" +
      ":86:/CNTP/NL52INGB0600000053/INGBNL2A/M. Bakker///REMI/UST\n" +
      "D//deel salaris april 2026/",
    camt: `<Ntry>
      <Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <ValDt><Dt>2026-04-02</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
        <RltdPties><Cdtr><Nm>M. Bakker</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>NL52INGB0600000053</IBAN></Id></CdtrAcct></RltdPties>
        <RmtInf><Ustrd>deel salaris april 2026</Ustrd></RmtInf>
      </TxDtls></NtryDtls></Ntry>`,
    feed: {
      value_date: "2026-04-02",
      transaction_amount: { amount: "1000.00", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "M. Bakker" },
      creditor_account: { iban: "NL52INGB0600000053" },
      remittance_information: ["deel salaris april 2026"],
    },
  },
  {
    what: "a counterparty whose name is longer than MT940 carries",
    why:
      "ING writes the name whole in CAMT and cuts it in the MT940 /CNTP/ field. Comparing them " +
      "whole made five pension-fund lines fingerprint as ten — and it does that for every long " +
      "name, which is exactly what foundations and bedrijfstak schemes have.",
    mt940:
      ":61:2604010401D246,96NTRFNONREF//26092353023651\n" +
      "/TRCD/00112/\n" +
      ":86:/CNTP/NL19INGB0600000065/INGBNL2A/Stichting Bedrijfstakpensioenfonds voor het Bakkers///REMI/UST\n" +
      "D//E100732098 / MN000009418/",
    camt: `<Ntry>
      <Amt Ccy="EUR">246.96</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <ValDt><Dt>2026-04-01</Dt></ValDt>
      <NtryDtls><TxDtls>
        <RltdPties><Cdtr><Nm>Stichting Bedrijfstakpensioenfonds voor het Bakkersbedrijf</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>NL19INGB0600000065</IBAN></Id></CdtrAcct></RltdPties>
        <RmtInf><Ustrd>E100732098 / MN000009418</Ustrd></RmtInf>
      </TxDtls></NtryDtls></Ntry>`,
    feed: {
      value_date: "2026-04-01",
      transaction_amount: { amount: "246.96", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Stichting Bedrijfstakpensioenfonds voor het Bakkersbedrijf" },
      creditor_account: { iban: "NL19INGB0600000065" },
      remittance_information: ["E100732098 / MN000009418"],
    },
  },
  {
    what: "an ordinary supplier payment carrying its invoice number",
    why: "The case that always worked, kept so a fix for the others cannot quietly break it.",
    mt940:
      ":61:2605250525D224,85NTRFNONREF//26134000001000\n" +
      "/TRCD/00112/\n" +
      ":86:/CNTP/NL79RABO0300000039/RABONL2U/Jansen Bouw B.V.///REMI/UST\n" +
      "D//26002148/",
    camt: `<Ntry>
      <Amt Ccy="EUR">224.85</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <ValDt><Dt>2026-05-25</Dt></ValDt>
      <NtryDtls><TxDtls>
        <RltdPties><Cdtr><Nm>Jansen Bouw B.V.</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>NL79RABO0300000039</IBAN></Id></CdtrAcct></RltdPties>
        <RmtInf><Ustrd>26002148</Ustrd></RmtInf>
      </TxDtls></NtryDtls></Ntry>`,
    feed: {
      value_date: "2026-05-25",
      transaction_amount: { amount: "224.85", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Jansen Bouw B.V." },
      creditor_account: { iban: "NL79RABO0300000039" },
      reference_number: "26002148",
      remittance_information: ["26002148"],
    },
  },
];

for (const c of CASES) {
  test(`three doors, one fingerprint: ${c.what}`, () => {
    const fromMt = parseMT940(mt940(c.mt940));
    const fromCamt = parseCAMT053(camt(c.camt));
    const fromFeed = mapEnableBankingTransaction(c.feed);

    assert.deepEqual(fromMt.parseErrors, [], `MT940 fixture must parse cleanly — ${c.why}`);
    assert.equal(fromMt.transactions.length, 1);
    assert.equal(fromCamt.transactions.length, 1);
    assert.ok(fromFeed, "the feed twin must map");

    const m = fromMt.transactions[0];
    const x = fromCamt.transactions[0];

    assert.equal(m.amount, x.amount, "MT940 and CAMT must agree on the amount");
    assert.equal(m.date, x.date, "MT940 and CAMT must agree on the date");
    assert.equal(key(m), key(x), `MT940 vs CAMT — ${c.why}`);
    if (c.feedAgrees === false) {
      assert.notEqual(key(fromFeed), key(x), "the feed twin is expected to differ here — if it now agrees, delete feedAgrees and this branch");
    } else {
      assert.equal(key(fromFeed), key(x), `feed vs CAMT — ${c.why}`);
    }
  });
}

// ─── the two shapes that still differ, pinned so nobody thinks they are settled ────────────────

test("a terminal line never yields an invoice reference, whichever door it comes through", () => {
  // A Geldmaat cash deposit. The bank NAMES a party here, so the card branch's "no party" trigger
  // never fires and the terminal numbers survived as the reference of the largest single amount in
  // a real quarter — on both file doors. The name still differs between doors (the file says
  // "Gemeenschap Geldmaat", the feed says "STORTING ING"): those are two different fields and no
  // rule reconciles them without a live API response to check. The reference is what matters here,
  // because that is what gets matched against an invoice.
  const fromCamt = parseCAMT053(camt(`<Ntry>
    <Amt Ccy="EUR">10150.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <ValDt><Dt>2026-06-16</Dt></ValDt>
    <NtryDtls><TxDtls>
      <RltdPties><Dbtr><Nm>Gemeenschap Geldmaat</Nm></Dbtr></RltdPties>
      <RmtInf><Ustrd>Geldmaat Dorpsstraat 12 16-06-2026 16:08 TERMINALID: 800001 PASVOLGNR: 001 TRANSACTIENR: 600000000001</Ustrd></RmtInf>
    </TxDtls></NtryDtls></Ntry>`)).transactions[0];

  const fromMt = parseMT940(mt940(
    ":61:2606160616C10150,00NMSCNONREF//26000000000010\n" +
    "/TRCD/00164/\n" +
    ":86:/CNTP///Gemeenschap Geldmaat///REMI/USTD//Geldmaat Dorpsstraat 12 16-06-2026 16:08 TERMINALID: 800001 PASVOLGNR: 001 TRANSACTIENR: 600000000001/",
  )).transactions[0];

  const fromFeed = mapEnableBankingTransaction({
    value_date: "2026-06-16",
    transaction_amount: { amount: "10150.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "STORTING ING" },
    remittance_information: [
      "Geldmaat Dorpsstraat 12 800001 PASVOLGNR 001 16-06-2026 16:08 RRN: 600000000001",
    ],
  })!;

  assert.equal(fromCamt.reference, null, "CAMT must not book a terminal id as an invoice reference");
  assert.equal(fromMt.reference, null, "MT940 must not either");
  assert.equal(fromFeed.reference, null, "and neither must the feed");
  assert.equal(fromCamt.amount, 10150);
  assert.equal(fromMt.amount, 10150);
  assert.equal(fromFeed.amount, 10150);
});

test("the feed has no end-to-end id, and guessing one from entry_reference is not safe", () => {
  // The one shape where the doors genuinely cannot agree yet. A direct debit's mandate reference
  // reaches CAMT as <EndToEndId> and MT940 as /EREF/, and the Enable Banking model has no field
  // for it — in the ING data it happens to sit in entry_reference, but the vendor's own sample
  // proves entry_reference is the bank's ENTRY id there: 611 transactions under 481 values, one of
  // them covering 44 unrelated lines. Installing that as a payment reference would invent
  // references by the hundred. So the feed yields null and the two doors differ on six rows of a
  // real quarter, deliberately, until a live /accounts/{id}/transactions response says where a
  // Dutch bank actually puts it.
  const feed = mapEnableBankingTransaction({
    entry_reference: "TK10000001",
    value_date: "2026-04-01",
    transaction_amount: { amount: "81.51", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    creditor: { name: "Woningstichting Zuid" },
    remittance_information: ["Incasso Huur Periode: 01-04-2026 tot 01-05-2026"],
  })!;

  assert.equal(feed.reference, null, "entry_reference must not become a payment reference");
  // [EB-IDENTITEIT] This line used to read `assert.equal(feed.transactionId, "TK10000001")` —
  // "but it is still kept for debugging". The paragraph above had the argument exactly right and
  // then handed the value to the one field that is not a debugging field: bank-import.ts copies
  // transactionId into external_id, which is half of UNIQUE (user_id, source, external_id), which
  // the sync upserts with ignoreDuplicates. So the id this very test calls unreliable had the
  // power to delete the second of two real transactions, silently and permanently.
  //
  // Nothing about parity changes: `reference` was null before and is null now, and the six rows
  // where the doors deliberately differ still differ for the reason written above. What is gone
  // is the identity, and src/lib/enablebanking-identity.test.ts fails if it comes back.
  assert.equal(feed.transactionId, null, "the feed handed out a source identity it cannot stand behind");
});
