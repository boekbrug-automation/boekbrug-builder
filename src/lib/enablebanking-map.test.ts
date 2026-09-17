// [ENABLEBANKING] Pure node test — run: npx tsx --test src/lib/enablebanking-map.test.ts
//
// Two properties carry this file.
//
// The FIRST is the sign. Enable Banking sends an unsigned magnitude plus credit_debit_indicator,
// where GoCardless sends an already-signed amount. Get it backwards and every expense imports as
// income — kosten become omzet and the btw-aangifte inverts, on every line, silently. The rows
// below marked "vendor sample" are copied verbatim from Enable Banking's own sample export, so
// this is pinned against their data and not against our reading of it.
//
// The SECOND is the cross-door property: the same transaction, delivered
// once as a CAMT.053 file the owner uploaded and once over the bank feed, must produce the SAME
// contentKey. If it does not, it is stored twice and every figure built on it doubles.
//
// The Dutch rows come from a real ING quarter and are anonymised the same way bank-parity.test.ts
// is: names, IBANs (mod-97 valid substitutes), mandate and incassant ids, terminal ids and the one
// street address are replaced; amounts, dates and the exact string layout are not, because those
// are what the branches below actually read. A few counterparty names — the supplier, the water
// company, the card acceptor — are the fixture identities this repo already uses elsewhere, so
// they are kept rather than forked into a second set of fake names.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectRemittance,
  counterpartIbanOf,
  isBooked,
  mapEnableBankingTransaction,
  mapEnableBankingTransactions,
  parseSignedAmount,
  pickTransactionDate,
  readSignedAmount,
  statementRemittance,
} from "./enablebanking-map";
import type { EnableBankingRawTransaction } from "./enablebanking-map";
import { contentKey } from "./bank-import";
import { parseCAMT053 } from "./bank-parser";
import type { BankTransaction } from "./bank-parser";

const keyOf = (t: Pick<BankTransaction, "date" | "amount" | "counterpartName" | "reference">) =>
  contentKey(t.date, t.amount, t.counterpartName, t.reference);

// ─── the sign ─────────────────────────────────────────────────────────────────────────────────

test("DBIT is money out and CRDT is money in — the amount itself carries no sign", () => {
  // Vendor sample, verbatim: a card payment of 88,00 DKK. The amount string is "88.0"; only
  // credit_debit_indicator says it left the account. Reading it as GoCardless does (+88) would
  // file this expense as revenue.
  const spent = mapEnableBankingTransaction({
    entry_reference: "2581644165",
    merchant_category_code: "5131",
    transaction_amount: { currency: "DKK", amount: "88.0" },
    creditor: { name: "Krestoffer )))) 59476" },
    debtor_account: { iban: null, other: { identification: "2345533245", scheme_name: "CPAN" } },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2020-09-14",
    value_date: "2020-09-14",
    remittance_information: ["Krestoffer )))) 59476"],
  });
  assert.equal(spent?.amount, -88);

  // Vendor sample, verbatim: salary in.
  const received = mapEnableBankingTransaction({
    entry_reference: "D126890141",
    transaction_amount: { currency: "DKK", amount: "18350.0" },
    debtor: { name: "AXB LTD A/S" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    booking_date: "2020-09-28",
    value_date: "2020-09-28",
    remittance_information: ["Løn September\nWe have received the following payment from:\nAXB LTD A/S"],
  });
  assert.equal(received?.amount, 18350);
});

test("an indicator beats a sign the bank also sent — the two can never disagree", () => {
  // If a bank ever signs its amounts AND sets the indicator, the indicator wins, so -15 + DBIT
  // stays -15 rather than becoming +15 by double negation.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "-15.00" }, credit_debit_indicator: "DBIT" }), -15);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "15.00" }, credit_debit_indicator: "DBIT" }), -15);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "15.00" }, credit_debit_indicator: "crdt" }), 15);
});

test("an unsigned amount with no direction is refused, not guessed as income", () => {
  // The CAMT parser may default a missing <CdtDbtInd> to CRDT because the schema makes the element
  // mandatory. Here there is no such guarantee, and guessing "credit" turns expenses into revenue.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "88.0" } }), null);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "88.0" }, credit_debit_indicator: "XXXX" }), null);
  // A value that carries its own minus sign is still unambiguous — do not throw money away.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "-88.0" } }), -88);
});

test("the direction that sets the sign is the one that picks the counterpart", () => {
  const out = readSignedAmount({ transaction_amount: { amount: "88.0" }, credit_debit_indicator: "DBIT" });
  assert.deepEqual(out, { amount: -88, isCredit: false });
  const zero = readSignedAmount({ transaction_amount: { amount: "0" }, credit_debit_indicator: "DBIT" });
  // -0 would round-trip through JSON as "-0"; zero has no direction in the books.
  assert.equal(Object.is(zero?.amount, 0), true);
  assert.equal(zero?.isCredit, false);
});

test("an unreadable amount is null, never NaN and never a fabricated zero", () => {
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "abc" }, credit_debit_indicator: "DBIT" }), null);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "1e999" }, credit_debit_indicator: "DBIT" }), null);
  // Number("") is 0 — a blank amount must warn, not book 0,00.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "   " }, credit_debit_indicator: "DBIT" }), null);
  assert.equal(parseSignedAmount({ transaction_amount: {} }), null);
  assert.equal(parseSignedAmount({}), null);
});

test("a dropped line says WHICH of the two things was missing", () => {
  const { transactions, warnings } = mapEnableBankingTransactions([
    {
      booking_date: "2026-03-02",
      transaction_amount: { amount: "88.00" },
      remittance_information: ["Factuur 12345"],
    },
  ]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-03-02/);
  assert.match(warnings[0], /Factuur 12345/);
  // The amount was perfectly readable — saying "bedrag ongeldig" would send the owner looking in
  // the wrong place, and hide that it is his bank that is sending an incomplete record.
  assert.match(warnings[0], /bij- of afschrijving/);
});

// ─── booked only ──────────────────────────────────────────────────────────────────────────────

test("pending entries are passed over and counted, not imported and not warned about", () => {
  // A pending line may still change amount or vanish, and its booked twin days later would dedup
  // against nothing — so importing it means the owner ends up with both.
  const { transactions, warnings, skipped } = mapEnableBankingTransactions([
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00" }, credit_debit_indicator: "CRDT", status: "BOOK" },
    { value_date: "2026-03-02", transaction_amount: { amount: "20.00" }, credit_debit_indicator: "CRDT", status: "PDNG" },
  ]);
  assert.deepEqual(transactions.map((t) => t.amount), [10]);
  assert.equal(skipped, 1);
  assert.equal(warnings.length, 0, "a pending line is not lost money");
  // An absent status is the kind we asked the API for.
  assert.equal(isBooked({}), true);
  assert.equal(isBooked({ status: "book" }), true);
});

// ─── date ─────────────────────────────────────────────────────────────────────────────────────

test("value_date wins over booking_date — the same order MT940/CAMT use", () => {
  // Choosing booking_date here would shift weekend bookings by a day or two against the same
  // transaction in an uploaded file, and the dedup fingerprint would miss.
  assert.equal(pickTransactionDate({ booking_date: "2026-03-02", value_date: "2026-02-28" }), "2026-02-28");
  assert.equal(pickTransactionDate({ transaction_date: "2026-02-28T14:03:11Z" }), "2026-02-28");
  // A malformed date reaching a Postgres `date` column fails the whole batch INSERT.
  assert.equal(pickTransactionDate({ value_date: "9999-99-99", booking_date: "2026-13-40" }), null);
  assert.equal(pickTransactionDate({}), null);
});

// ─── remittance ───────────────────────────────────────────────────────────────────────────────

test("a multi-line remittance reads exactly like the file door's joined <Ustrd> elements", () => {
  // Vendor sample, verbatim: what a CAMT file splits across elements arrives here as one string
  // with newlines. 80 of its 611 lines look like this.
  assert.equal(
    collectRemittance({
      remittance_information: ["Til Mad\nWe have transferred the amount to:\n4092 3342223455"],
    }),
    "Til Mad We have transferred the amount to: 4092 3342223455",
  );
});

test("runs of spaces survive — the fee label and the store name are cut on them", () => {
  // Banks pad statement text into columns. Collapsing those runs would make this door read a
  // different counterpart name from the uploaded file, which is a different fingerprint.
  assert.equal(
    collectRemittance({ remittance_information: ["otay-shop.dk       15423"] }),
    "otay-shop.dk       15423",
  );
});

test("the structured reference is read too, and repeated text does not double", () => {
  assert.equal(
    collectRemittance({
      remittance_information: ["Betaling factuur", "26302050", "Betaling factuur"],
      reference_number: "KENMERK-9",
    }),
    "Betaling factuur 26302050 KENMERK-9",
  );
});

test("a betaalverzoek that carries its kenmerk ONLY as reference_number still gets a reference", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "121.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Jansen Bouw B.V." },
    reference_number: "26302050",
  });
  assert.equal(tx?.reference, "26302050");
});

// ─── counterpart ──────────────────────────────────────────────────────────────────────────────

test("money in names the debtor, money out names the creditor", () => {
  const incoming = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "45.00" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Mon Mothma" },
    debtor_account: { iban: "NL02ABNA0123456789" },
    creditor: { name: "Wij Zelf" },
    remittance_information: ["Factuur 26302050"],
  });
  assert.equal(incoming?.counterpartName, "Mon Mothma");
  assert.equal(incoming?.counterpartIban, "NL02ABNA0123456789");

  const outgoing = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "45.00" },
    credit_debit_indicator: "DBIT",
    debtor: { name: "Wij Zelf" },
    creditor: { name: "Alderaan Coffee" },
    creditor_account: { iban: "NL79RABO0300000039" },
    remittance_information: ["Factuur 26302050"],
  });
  assert.equal(outgoing?.counterpartName, "Alderaan Coffee");
  assert.equal(outgoing?.counterpartIban, "NL79RABO0300000039");
});

test("a card refund keeps the CAMT rule even though the bank fills the other party", () => {
  // Vendor sample, verbatim: 13 of its rows are refunds — CRDT, yet still naming the shop as
  // `creditor`. Reading that field would give a name the uploaded file cannot give (the CAMT
  // parser looks at <Dbtr> here too), and a name that differs by door is a double import.
  const refund = mapEnableBankingTransaction({
    entry_reference: "0000005026",
    merchant_category_code: "4899",
    transaction_amount: { currency: "DKK", amount: "78.0" },
    creditor: { name: "Disney Plus" },
    debtor_account: { iban: null, other: { identification: "233111XXXXXX4455", scheme_name: "CPAN" } },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    value_date: "2021-07-14",
    booking_date: "2021-07-14",
    remittance_information: ["Disney Plus"],
  });
  assert.equal(refund?.amount, 78);
  // Both doors fall through to the description and agree on it.
  assert.equal(refund?.counterpartName, "Disney Plus");
});

test("a card number is never stored as an IBAN", () => {
  // Vendor sample: every transaction-level account id is a card PAN or a domestic number — 364 of
  // them, zero IBANs. Writing one into counterpart_iban puts a PAN where nobody expects one and
  // would match against the owner's own accounts as if it were one.
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "233111XXXXXX4455", scheme_name: "CPAN" } }), null);
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "12517826136334", scheme_name: "BBAN" } }), null);
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "3342223455", scheme_name: "OTHI" } }), null);
  // Unless the scheme itself says it is one.
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "NL79RABO0300000039", scheme_name: "IBAN" } }), "NL79RABO0300000039");
  assert.equal(counterpartIbanOf({ iban: "NL79RABO0300000039" }), "NL79RABO0300000039");
  assert.equal(counterpartIbanOf(null), null);
});

test("a card payment with no party at all still gets a readable store name and no fake reference", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "24.31" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003"],
  });
  assert.equal(tx?.counterpartName, "ASM Supermarkt");
  // A terminal sequence number is not an invoice number and must never become one.
  assert.equal(tx?.reference, null);
});

test("a bank charge with no party is labelled from its own description", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-31",
    transaction_amount: { amount: "11.45" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Kosten Zakelijk Betalingsverkeer  Factuurnr. 9912"],
  });
  assert.equal(tx?.counterpartName, "Kosten Zakelijk Betalingsverkeer");
});

// ─── reference ────────────────────────────────────────────────────────────────────────────────

test("a SEPA incasso yields only the invoice number, not the batch and order ids", () => {
  // The ONS IT Incasso case from [BANK-REF-ONE-SOURCE]: three numbers instead of one both breaks
  // the dedup key and silently stops the line from auto-booking.
  const tx = mapEnableBankingTransaction({
    value_date: "2026-06-02",
    transaction_amount: { amount: "302.50" },
    credit_debit_indicator: "DBIT",
    creditor: { name: "ONS IT" },
    remittance_information: ["/IncassobatchId/26-06-0001/OpdrachtId/994872215/Betaling fact. 1260405"],
  });
  assert.equal(tx?.reference, "1260405");
});

test("[EB-IDENTITEIT] entry_reference never becomes a source identity", () => {
  // Vendor sample: 611 transactions under 481 distinct entry_reference values. "3845245274" alone
  // covers 44 unrelated MobilePay lines — keying on it would collapse real transactions together.
  //
  // This test used to be called "stored for debugging but is not an identity", and it asserted the
  // two values were EQUAL to demonstrate the collision. That was true and harmless right up until
  // you followed the field: transactionId is copied into external_id, which is half of
  // UNIQUE (user_id, source, external_id), which the sync upserts with ignoreDuplicates — so the
  // "debugging" value silently deleted the second of two real transactions. The field is null now,
  // and the assertion below is what keeps it that way.
  const a = mapEnableBankingTransaction({
    entry_reference: "3845245274",
    value_date: "2020-09-24",
    transaction_amount: { amount: "200.0", currency: "DKK" },
    credit_debit_indicator: "CRDT",
    remittance_information: ["MobilePay: Emma Nielsen"],
  });
  const b = mapEnableBankingTransaction({
    entry_reference: "3845245274",
    value_date: "2020-09-25",
    transaction_amount: { amount: "24.0", currency: "DKK" },
    credit_debit_indicator: "CRDT",
    remittance_information: ["MobilePay: Christina Nielsen"],
  });
  assert.equal(a?.transactionId, null, "the Enable Banking door handed out a source identity again");
  assert.equal(b?.transactionId, null);
  assert.notEqual(keyOf(a!), keyOf(b!), "two different transactions must keep two fingerprints");
});

// ─── the property this file exists for ────────────────────────────────────────────────────────

test("the SAME transaction from an uploaded CAMT file and from the bank feed dedups", () => {
  const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NL02ABNA0123456789</IBAN></Id></Acct>
  <Ntry>
    <Amt Ccy="EUR">1210.00</Amt>
    <CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-03-03</Dt></BookgDt>
    <ValDt><Dt>2026-03-02</Dt></ValDt>
    <NtryRef>2026030200123</NtryRef>
    <NtryDtls><TxDtls>
      <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
      <RltdPties>
        <Dbtr><Nm>Jansen Bouw B.V.</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>NL79RABO0300000039</IBAN></Id></DbtrAcct>
      </RltdPties>
      <RmtInf><Ustrd>Betaling factuur 26302050</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1, "the CAMT fixture must parse to exactly one transaction");

  const fromApi = mapEnableBankingTransaction({
    entry_reference: "2026030200123",
    booking_date: "2026-03-03",
    value_date: "2026-03-02",
    transaction_amount: { amount: "1210.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    debtor: { name: "Jansen Bouw B.V." },
    debtor_account: { iban: "NL79RABO0300000039" },
    remittance_information: ["Betaling factuur 26302050"],
  });
  assert.ok(fromApi, "the API twin must map");

  assert.equal(
    keyOf(fromApi),
    keyOf(fromFile[0]),
    "same transaction, two doors, one fingerprint — otherwise it imports twice",
  );

  // And the fields the owner reads must agree too, not just the hash.
  assert.equal(fromApi.date, fromFile[0].date);
  assert.equal(fromApi.amount, fromFile[0].amount);
  assert.equal(fromApi.counterpartName, fromFile[0].counterpartName);
  assert.equal(fromApi.reference, fromFile[0].reference);
  assert.equal(fromApi.counterpartIban, fromFile[0].counterpartIban);
});

test("a card line from both doors dedups too — the branch with no party at all", () => {
  const camt = `<Document><Ntry>
    <Amt Ccy="EUR">24.31</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <ValDt><Dt>2026-03-02</Dt></ValDt>
    <NtryDtls><TxDtls><RmtInf>
      <Ustrd>CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003</Ustrd>
    </RmtInf></TxDtls></NtryDtls>
  </Ntry></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1);
  assert.equal(fromFile[0].amount, -24.31, "the file door signs this with <CdtDbtInd>");

  const fromApi = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "24.31", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003"],
  });
  assert.ok(fromApi);

  assert.equal(keyOf(fromApi), keyOf(fromFile[0]));
});

test("a fee line split only by column padding dedups too", () => {
  // The [BANK-PARSE-FEE] label is cut on a run of spaces. If this door collapsed that run, the
  // counterpart would be the whole sentence here and the fingerprint would not match the file.
  const camt = `<Document><Ntry>
    <Amt Ccy="EUR">11.45</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <ValDt><Dt>2026-03-31</Dt></ValDt>
    <NtryDtls><TxDtls><RmtInf>
      <Ustrd>Kosten Zakelijk Betalingsverkeer   01-03-2026 / 31-03-2026</Ustrd>
    </RmtInf></TxDtls></NtryDtls>
  </Ntry></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1);
  assert.equal(fromFile[0].counterpartName, "Kosten Zakelijk Betalingsverkeer");

  const fromApi = mapEnableBankingTransaction({
    value_date: "2026-03-31",
    transaction_amount: { amount: "11.45", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Kosten Zakelijk Betalingsverkeer   01-03-2026 / 31-03-2026"],
  });
  assert.ok(fromApi);
  assert.equal(keyOf(fromApi), keyOf(fromFile[0]));
});

// ─── ING: a bank that sends its statement line instead of the remittance ──────────────────────
//
// Every row below is copied verbatim from a real ING business quarter (576 transactions,
// April–June 2026). ING does not send <Ustrd> over PSD2; it sends the line it prints on a
// statement, with the party, the account, the mandate and the value date folded in as labelled
// segments. Reading that line as if it were remittance text broke references on 27 of those rows.

test("the statement line is un-composed back to the remittance alone", () => {
  assert.equal(
    statementRemittance(
      "Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501 " +
        "Kenmerk: 260514RABONL2U080320000100001 Valutadatum: 25-05-2026",
    ),
    "26002148",
  );
  // A transfer the payer left blank: the file door has an empty <Ustrd> there, so handing the
  // metadata downstream as if it were his text would invent a description he never wrote.
  assert.equal(
    statementRemittance("Naam: Basil Ibrahim IBAN: NL74INGB0600000045 Datum/Tijd: 02-06-2026 15:07:59 Valutadatum: 02-06-2026"),
    "",
  );
  // Not a composition — left completely alone. Destroying a payer's own text would take his
  // invoice number with it, which is the worst thing this function could do.
  assert.equal(statementRemittance("Betaling factuur 26302050"), "Betaling factuur 26302050");
  assert.equal(
    statementRemittance("Pasvolgnr: 001 04-04-2026 13:54 Transactie: W00082 Term: CT600001 Valutadatum: 05-04-2026"),
    "Pasvolgnr: 001 04-04-2026 13:54 Transactie: W00082 Term: CT600001 Valutadatum: 05-04-2026",
  );
});

test("the mandate id and the bank's own kenmerk never become an invoice number", () => {
  // Read whole, this line yielded "TK10000001, 100001" — the Kenmerk and the Machtiging ID. Two
  // numbers where the file door finds none: a different contentKey, and parseReferenceNumbers
  // counting two invoices so autoConfirmTier stops booking the rent automatically.
  const huur = mapEnableBankingTransaction({
    entry_reference: "TK10000001",
    transaction_amount: { currency: "EUR", amount: "81.51" },
    creditor: { name: "Woningstichting Zuid" },
    creditor_account: { iban: "NL11BNGH0002220001" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-04-01",
    value_date: "2026-04-01",
    reference_number: "Incasso Huur Periode: 01-04-2026 tot 01-05-2026",
    remittance_information: [
      "Naam: Woningstichting Zuid Omschrijving: Incasso Huur Periode: 01-04-2026 tot 01-05-2026 " +
        "IBAN: NL11BNGH0002220001 Kenmerk: TK10000001 Machtiging ID: 100001 " +
        "Incassant ID: NL01ZZZ000000010000 Doorlopende incasso Valutadatum: 01-04-2026",
    ],
  });
  assert.equal(huur?.reference, null);
  assert.equal(huur?.description, "Incasso Huur Periode: 01-04-2026 tot 01-05-2026");
  assert.equal(huur?.counterpartName, "Woningstichting Zuid");

  // And where the payer's own text does hold identifiers, those survive — only the bank's
  // plumbing is stripped. Read whole this was "600000001, 5049NM, INC000000001, 5000000001,
  // MID100000001".
  const water = mapEnableBankingTransaction({
    entry_reference: "INC000000001-5000000001",
    transaction_amount: { currency: "EUR", amount: "20.00" },
    creditor: { name: "Brabant Water N.V." },
    creditor_account: { iban: "NL32RABO0300000012" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    value_date: "2026-04-01",
    reference_number: "Klant:600000001 VOORSCHOT apr  BTW 1 65 5049NM 13",
    remittance_information: [
      "Naam: Brabant Water N.V. Omschrijving: Klant:600000001 VOORSCHOT apr  BTW 1 65 5049NM 13 " +
        "IBAN: NL32RABO0300000012 Kenmerk: INC000000001-5000000001 Machtiging ID: MID100000001 " +
        "Incassant ID: NL01ZZZ000000020000 Doorlopende incasso Valutadatum: 01-04-2026",
    ],
  });
  assert.equal(water?.reference, "600000001, 5049NM");
});

test("the structured reference does not survive as a second copy of the text", () => {
  // ING repeats reference_number inside its own composed line. Appended to the composed form it is
  // a copy nothing removes, and extractInvoiceReference then reads the same number twice.
  assert.equal(
    collectRemittance({
      reference_number: "26002148",
      remittance_information: [
        "Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501 " +
          "Kenmerk: 260514RABONL2U080320000100001 Valutadatum: 25-05-2026",
      ],
    }),
    "26002148",
  );

  // …and it is not always repeated verbatim. Two exports of the SAME rent payment give the whole
  // Omschrijving in one and a shortened "Incasso Huur" in the other, so the check is containment,
  // not equality — an equality check leaves "…tot 01-05-2026 Incasso Huur" behind.
  assert.equal(
    collectRemittance({
      reference_number: "Incasso Huur",
      remittance_information: [
        "Naam: Woningstichting Zuid Omschrijving: Incasso Huur Periode: 01-04-2026 tot 01-05-2026 " +
          "IBAN: NL11BNGH0002220001 Kenmerk: TK10000001 Valutadatum: 01-04-2026",
      ],
    }),
    "Incasso Huur Periode: 01-04-2026 tot 01-05-2026",
  );

  // The bank-charge line is not a composition at all, and its reference sits in the free text.
  assert.equal(
    collectRemittance({
      reference_number: "10001461242",
      remittance_information: [
        "Factuurnr. 10001461242 Betreft IBAN: NL36INGB0007654321 Periode: 01-03-2026 / 31-03-2026 Valutadatum: 26-04-2026",
      ],
    }),
    "Factuurnr. 10001461242 Betreft IBAN: NL36INGB0007654321 Periode: 01-03-2026 / 31-03-2026 Valutadatum: 26-04-2026",
  );

  // A betaalverzoek whose kenmerk exists ONLY in the structured field still gets it — the case
  // [CAMT-STRD-REF] exists for. Containment must not swallow that.
  assert.equal(
    collectRemittance({ reference_number: "26302050", remittance_information: ["Betaling factuur"] }),
    "Betaling factuur 26302050",
  );
});

test("a card acceptor is named the way the file door names it, not the way ING sends it", () => {
  // ING puts the acceptor string in creditor.name; the CAMT file has no <Cdtr> at all and the same
  // string sits in the remittance. Stored as sent it is "BCK*OMUR MARKT AMERSFOORT NLD" against
  // the file door's "OMUR MARKT" — a different dedupName(), so the card line imports twice.
  const pin = mapEnableBankingTransaction({
    transaction_amount: { currency: "EUR", amount: "220.37" },
    creditor: { name: "BCK*OMUR MARKT AMERSFOORT NLD" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-04-05",
    value_date: "2026-04-05",
    remittance_information: ["Pasvolgnr: 001 04-04-2026 13:54 Transactie: W00082 Term: CT600001 Valutadatum: 05-04-2026"],
  });
  assert.equal(pin?.counterpartName, "OMUR MARKT");
  assert.equal(pin?.reference, null);

  // An ordinary supplier is never shortened by that rescue.
  const supplier = mapEnableBankingTransaction({
    transaction_amount: { currency: "EUR", amount: "224.85" },
    creditor: { name: "W. Ketels en Zoon Eierhandel" },
    credit_debit_indicator: "DBIT",
    value_date: "2026-05-25",
    remittance_information: ["Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501 Valutadatum: 25-05-2026"],
  });
  assert.equal(supplier?.counterpartName, "W. Ketels en Zoon Eierhandel");
  assert.equal(supplier?.reference, "26002148");
});

test("a terminal line keeps its party but still loses the terminal's numbers", () => {
  // A €10.150 cash deposit. ING names the party, so the card branch's usual "no party" trigger
  // never fires — and the extractor offered the Geldmaat code, the pasvolgnr and the RRN as the
  // invoice number. Booking one of those against a real invoice is exactly what this prevents.
  const storting = mapEnableBankingTransaction({
    transaction_amount: { currency: "EUR", amount: "10150.00" },
    debtor: { name: "STORTING ING" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    value_date: "2026-06-16",
    remittance_information: ["Geldmaat Dorpsstraat 12 800001 PASVOLGNR 001 16-06-2026 16:08 RRN: 600000000001 Valutadatum: 16-06-2026"],
  });
  assert.equal(storting?.amount, 10150);
  assert.equal(storting?.reference, null);
});

test("a billing period stapled to an IBAN is not an IBAN", () => {
  // The three bank-charge lines of that quarter carry the owner's OWN account with a period
  // appended, in the field [BANK-IBAN] matches suppliers on.
  const kosten = mapEnableBankingTransaction({
    transaction_amount: { currency: "EUR", amount: "327.86" },
    creditor: { name: "Kosten Zakelijk Betalingsverkeer" },
    creditor_account: { iban: "NL36INGB0007654321 Periode: 01-03-2026 / 31-03-2026" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    value_date: "2026-04-26",
    remittance_information: ["Factuurnr. 10001461242 Betreft IBAN: NL36INGB0007654321 Periode: 01-03-2026 / 31-03-2026 Valutadatum: 26-04-2026"],
  });
  assert.equal(kosten?.counterpartIban, null);
  assert.equal(kosten?.counterpartName, "Kosten Zakelijk Betalingsverkeer");
  assert.equal(kosten?.reference, "10001461242");
});

test("an ING transfer from both doors dedups", () => {
  // The feed row is verbatim; the CAMT side is that same payment as ING lays it out in a file —
  // the party, the account and the end-to-end id in their own elements, <Ustrd> holding only what
  // the composed line labels "Omschrijving".
  const camt = `<Document><Ntry>
    <Amt Ccy="EUR">224.85</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <ValDt><Dt>2026-05-25</Dt></ValDt>
    <NtryDtls><TxDtls>
      <Refs><EndToEndId>260514RABONL2U080320000100001</EndToEndId></Refs>
      <RltdPties>
        <Cdtr><Nm>W. Ketels en Zoon Eierhandel</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>NL89RABO0131703501</IBAN></Id></CdtrAcct>
      </RltdPties>
      <RmtInf><Ustrd>26002148</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1);

  const fromApi = mapEnableBankingTransaction({
    entry_reference: "260514RABONL2U080320000100001",
    transaction_amount: { currency: "EUR", amount: "224.85" },
    creditor: { name: "W. Ketels en Zoon Eierhandel" },
    creditor_account: { iban: "NL89RABO0131703501" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-05-25",
    value_date: "2026-05-25",
    reference_number: "26002148",
    remittance_information: [
      "Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501 " +
        "Kenmerk: 260514RABONL2U080320000100001 Valutadatum: 25-05-2026",
    ],
  });
  assert.ok(fromApi);

  assert.equal(keyOf(fromApi), keyOf(fromFile[0]));
  assert.equal(fromApi.counterpartIban, fromFile[0].counterpartIban);
});

// ─── list mapping ─────────────────────────────────────────────────────────────────────────────

test("mapping a list keeps order and reports every line it could not read", () => {
  const raw: EnableBankingRawTransaction[] = [
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00" }, credit_debit_indicator: "CRDT", debtor: { name: "A" } },
    { value_date: "not-a-date", transaction_amount: { amount: "20.00" }, credit_debit_indicator: "CRDT", debtor: { name: "B" } },
    { value_date: "2026-03-03", transaction_amount: { amount: "30.00" }, credit_debit_indicator: "DBIT", creditor: { name: "C" } },
  ];
  const { transactions, warnings, skipped } = mapEnableBankingTransactions(raw);
  assert.deepEqual(transactions.map((t) => t.amount), [10, -30]);
  assert.equal(warnings.length, 1);
  assert.equal(skipped, 0);
});

// ─── [CSV-MUNT] currency ──────────────────────────────────────────────────────────────────────
//
// bank_transactions has no currency column. Everything downstream — kosten, omzet, de matching,
// de afletterset, het banksaldo — reads `amount` as euros. So a line the bank hands over in
// another currency has exactly two possible fates: booked as euros (wrong money, invisible after
// the fact) or not booked and SAID. The upload door has refused non-euro statements from the
// start; this door, which runs on a cron with nobody watching, did not.

test("[CSV-MUNT] a non-euro line is not imported, and is named", () => {
  // The vendor's own Danish sample, next to a euro line. 88 DKK is roughly € 12 — booking it as
  // € 88,00 is not a rounding difference, it is a different amount of money.
  const raw: EnableBankingRawTransaction[] = [
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00", currency: "EUR" }, credit_debit_indicator: "CRDT", status: "BOOK", debtor: { name: "Klant BV" } },
    { value_date: "2026-03-02", transaction_amount: { amount: "88.0", currency: "DKK" }, credit_debit_indicator: "DBIT", status: "BOOK", creditor: { name: "Krestoffer" } },
  ];
  const { transactions, warnings, skipped } = mapEnableBankingTransactions(raw);

  assert.deepEqual(transactions.map((t) => t.amount), [10], "only the euro line is stored");
  assert.equal(skipped, 0, "a foreign line is not a pending line — it was booked at the bank");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DKK/, "the warning names the currency");
  assert.match(warnings[0], /88\.00/, "…and the amount, so the owner can find the line");
  assert.match(warnings[0], /Krestoffer/, "…and who it was");
  assert.doesNotMatch(warnings[0], /kon niet gelezen worden/,
    "it was read perfectly; saying otherwise sends the owner to the wrong place");
});

test("[CSV-MUNT] a missing currency is a euro line, not a refused one", () => {
  // Most of this feed's rows carry no currency at all. Treating that as 'not EUR' would refuse a
  // whole administratie's bank feed — the guard must only bite on a currency the bank NAMED.
  const raw: EnableBankingRawTransaction[] = [
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00" }, credit_debit_indicator: "CRDT", status: "BOOK", debtor: { name: "A" } },
  ];
  const { transactions, warnings } = mapEnableBankingTransactions(raw);
  assert.equal(transactions.length, 1);
  assert.equal(warnings.length, 0);
});

test("[CSV-MUNT] the single mapper still reads a foreign line faithfully", () => {
  // The split matters: mapEnableBankingTransaction says WHAT the bank sent (that is what the
  // cross-door contentKey test above compares), and the list function decides what may be stored.
  // Filtering inside the mapper would make a foreign line unreadable rather than unbookable.
  const one = mapEnableBankingTransaction({
    value_date: "2026-03-02", transaction_amount: { amount: "88.0", currency: "DKK" },
    credit_debit_indicator: "DBIT", status: "BOOK", creditor: { name: "Krestoffer" },
  });
  assert.ok(one);
  assert.equal(one.currency, "DKK");
  assert.equal(one.amount, -88);
});
