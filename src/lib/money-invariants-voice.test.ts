// src/lib/money-invariants-voice.test.ts
// [KANTOOR-RUST] One finding, two readers.
//
// money-invariants.ts writes each finding twice: `message` for the owner about their own books,
// and `accountantMessage` for the boekhouder about a client's. This file is the proof that the
// second never drifts from the first on a FACT, and never speaks to the owner:
//
//   1. the owner's sentences are byte-for-byte what they were before the accountant's existed
//      (pinned below, captured from the module before the field was added);
//   2. every euro amount, every invoice number, date and description in the owner's sentence is in
//      the accountant's too — the two disagreeing values are never summarised away;
//   3. no "je/jouw/jij" — the accountant is not the owner;
//   4. no owner-only route or action — Genegeerd, "Ontkoppelen", the Bank-pagina, "meld … als
//      betaald", "draai … terug" are the owner's screens and the owner's acts;
//   5. findingText() is the only switch between the two.
//
// Detection is not under test here: kinds, entityIds, euros and thresholds are pinned by
// money-invariants.test.ts, and this file asserts they are unchanged by comparing the kinds each
// fixture produces against the same capture.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMoneyViolations,
  findDrawerViolations,
  findingText,
  type InvoiceRow,
  type LinkRow,
} from "./money-invariants";
// One fixture per finding kind (and per sentence branch inside a kind), shared by the proof that
// the owner's sentences did not change and that the accountant's carry the same facts.


const inv = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "i1", invoiceNumber: "2026-0042", direction: "incoming", status: "received", invoiceType: "factuur",
  totalExBtw: 100, btwAmount: 21, totalIncBtw: 121, amountPaid: 0, ...over,
});
const link = (over: Partial<LinkRow> = {}): LinkRow => ({ transactionId: "t1", invoiceId: "i1", amountApplied: 121, ...over });

export const MONEY_CASES: Array<{ name: string; input: Parameters<typeof findMoneyViolations>[0] }> = [
  { name: "negative_paid", input: { invoices: [inv({ status: "paid", amountPaid: -50 })], links: [] } },
  { name: "overpaid", input: { invoices: [inv({ status: "paid", amountPaid: 200 })], links: [] } },
  { name: "paid_amount_never_written", input: { invoices: [inv({ status: "paid", amountPaid: 0 })], links: [link()] } },
  { name: "paid_without_payments", input: { invoices: [inv({ status: "paid", amountPaid: 121 })], links: [link({ amountApplied: 50 })] } },
  { name: "payments_without_paid", input: { invoices: [inv({ status: "received", amountPaid: 20 })], links: [link({ amountApplied: 121 })] } },
  { name: "status_paid_but_open", input: { invoices: [inv({ status: "paid", amountPaid: 100 })], links: [] } },
  { name: "status_open_but_covered/incoming", input: { invoices: [inv({ status: "received", amountPaid: 121 })], links: [] } },
  { name: "status_open_but_covered/outgoing", input: { invoices: [inv({ direction: "outgoing", status: "sent", amountPaid: 121 })], links: [] } },
  { name: "btw_arithmetic", input: { invoices: [inv({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 125 })], links: [] } },
  { name: "creditnota_sign", input: { invoices: [inv({ invoiceType: "creditnota", totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 })], links: [] } },
  { name: "duplicate_live_pair/agree", input: { invoices: [
      inv({ id: "a", clientName: "FAMZFOOD BV", invoiceNumber: "26/3958", status: "paid", amountPaid: 121 }),
      inv({ id: "b", clientName: "FAMZFOOD B.V.", invoiceNumber: "26 / 3958", status: "received" }),
    ], links: [] } },
  { name: "duplicate_live_pair/disagree", input: { invoices: [
      inv({ id: "a", clientName: "ATAPACK", invoiceNumber: "26302362", status: "paid", amountPaid: 579.63, totalExBtw: 479.03, btwAmount: 100.6, totalIncBtw: 579.63 }),
      inv({ id: "b", clientName: "ATAPACK", invoiceNumber: "26302362", status: "received", totalExBtw: 4064.38, btwAmount: 853.52, totalIncBtw: 4917.9 }),
    ], links: [] } },
  { name: "transaction_overallocated", input: { invoices: [inv({ id: "i1", status: "paid", amountPaid: 121 }), inv({ id: "i2", invoiceNumber: "2026-0043", status: "paid", amountPaid: 121 })],
      links: [link({ invoiceId: "i1", amountApplied: 121 }), link({ invoiceId: "i2", amountApplied: 121 })],
      transactions: [{ id: "t1", amount: -200 }] } },
  { name: "matched_tx_unpaid_invoice", input: { invoices: [inv({ status: "received", amountPaid: 0 })], links: [],
      transactions: [{ id: "t1", amount: -121, invoiceId: "i1", status: "matched" }] } },
];

export const DRAWER_CASES: Array<{ name: string; input: Parameters<typeof findDrawerViolations>[0] }> = [
  { name: "drawer_settlement_missing", input: { settlementEntries: [], sync: { toCreate: [{ invoice_id: "inv-1", amount: 250, description: "Betaling factuur 2026-014 — Bakker" }], toUpdate: [], toDeleteIds: [] } } },
  { name: "drawer_settlement_orphan", input: { settlementEntries: [{ id: "e1", invoice_id: "inv-9", amount: 80, entry_date: "2026-05-03" }], sync: { toCreate: [], toUpdate: [], toDeleteIds: ["e1"] } } },
  { name: "drawer_settlement_stale/amount", input: { settlementEntries: [{ id: "e1", invoice_id: "inv-2", amount: 100, entry_date: "2026-05-01" }], sync: { toCreate: [], toDeleteIds: [], toUpdate: [{ id: "e1", row: { invoice_id: "inv-2", amount: 121, entry_date: "2026-05-01", description: "Betaling factuur 7" } }] } } },
  { name: "drawer_settlement_stale/date", input: { settlementEntries: [{ id: "e1", invoice_id: "inv-3", amount: 60, entry_date: "2026-04-30" }], sync: { toCreate: [], toDeleteIds: [], toUpdate: [{ id: "e1", row: { invoice_id: "inv-3", amount: 60, entry_date: "2026-05-02", description: "Betaling factuur 8" } }] } } },
  { name: "drawer_settlement_stale/direction", input: { settlementEntries: [{ id: "e1", invoice_id: "inv-4", amount: 60, entry_date: "2026-05-02" }], sync: { toCreate: [], toDeleteIds: [], toUpdate: [{ id: "e1", row: { invoice_id: "inv-4", amount: 60, entry_date: "2026-05-02", description: "Betaling factuur 9" } }] } } },
  { name: "drawer_negative", input: { settlementEntries: [], sync: { toCreate: [], toUpdate: [], toDeleteIds: [] }, lowestPoint: { date: "2026-02-11", balance: -40 } } },
];


/** [fixture name, kind, owner message] — captured before accountantMessage existed. */
const PINNED_OWNER: Array<[string, string, string]> = [
  ["negative_paid", "status_paid_but_open", "2026-0042 staat op betaald, maar er is € 171,00 van open."],
  ["negative_paid", "negative_paid", "Op 2026-0042 staat een NEGATIEF betaald bedrag (€ 50,00). Dat kan niet."],
  ["overpaid", "overpaid", "Op 2026-0042 van € 121,00 staat € 200,00 als betaald — € 79,00 te veel. Meestal hoort dat geld bij een andere factuur."],
  ["paid_amount_never_written", "paid_amount_never_written", "2026-0042 van € 121,00 is volledig betaald en de bankregels dekken hem precies — alleen het veld \"betaald bedrag\" is nooit weggeschreven. Er ontbreekt geen geld."],
  ["paid_without_payments", "paid_without_payments", "2026-0042: er staat € 121,00 als betaald, maar de gekoppelde bankregels dekken maar € 50,00. Verschil € 71,00."],
  ["payments_without_paid", "payments_without_paid", "2026-0042: er is € 121,00 aan bankregels gekoppeld, maar er staat maar € 20,00 als betaald. Verschil € 101,00."],
  ["status_paid_but_open", "status_paid_but_open", "2026-0042 staat op betaald, maar er is € 21,00 van open."],
  ["status_open_but_covered/incoming", "status_open_but_covered", "2026-0042 van € 121,00 is helemaal betaald, maar staat nog open. Zo lijkt het alsof je dit nog moet betalen — het risico is dat je het twee keer doet."],
  ["status_open_but_covered/outgoing", "status_open_but_covered", "2026-0042 van € 121,00 is helemaal betaald, maar staat nog open. Zo blijft er een herinnering gaan naar iemand die al betaald heeft."],
  ["btw_arithmetic", "btw_arithmetic", "2026-0042: € 100,00 + € 21,00 btw is niet € 125,00 — € 4,00 verschil. Dit getal staat in je aangifte."],
  ["creditnota_sign", "creditnota_sign", "2026-0042 staat als creditnota geboekt met een POSITIEF bedrag (€ 121,00). Die telt nu op waar hij eraf hoort — een verschil van € 242,00."],
  ["duplicate_live_pair/agree", "duplicate_live_pair", "26/3958 van FAMZFOOD BV staat 2 keer in de administratie (betaald en openstaand). Dezelfde kost telt zo dubbel mee in je kosten en je voorbelasting. Bewaar het origineel en zet de kopie bij Genegeerd; is de kopie al als betaald gemeld, draai die betaling daar eerst terug."],
  ["duplicate_live_pair/disagree", "duplicate_live_pair", "26302362 van ATAPACK staat 2 keer in de administratie (betaald en openstaand), en de versies zijn het ONEENS over het bedrag: € 579,63 tegenover € 4.917,90. Dat is geen dubbele boeking alleen — één van beide is verkeerd gelezen. Leg ze naast de papieren factuur voordat je er een weggooit: welke van de twee blijft staan bepaalt hier ook welk bedrag in je kosten en je voorbelasting terechtkomt."],
  ["transaction_overallocated", "transaction_overallocated", "Een bankregel van € 200,00 is over facturen verdeeld voor € 242,00 — € 42,00 meer dan er is overgemaakt."],
  ["matched_tx_unpaid_invoice", "matched_tx_unpaid_invoice", "De Bank-pagina zegt: een regel van € 121,00 is afgehandeld en betaalde 2026-0042. De facturenlijst zegt: die factuur staat nog € 121,00 open. Eén van de twee is onwaar — is de betaling echt, meld de factuur dan alsnog als betaald; zo niet, kies \"Ontkoppelen\" bij die bankregel en koppel opnieuw."],
  ["drawer_settlement_missing", "drawer_settlement_missing", "Betaling factuur 2026-014 — Bakker — deze contante betaling van € 250,00 staat niet in je kasboek. Je kassaldo staat daardoor € 250,00 HOGER dan het geld dat er ligt."],
  ["drawer_settlement_orphan", "drawer_settlement_orphan", "Een kasregel van € 80,00 op 2026-05-03 hoort bij geen enkele contante betaling (meer). Je kassaldo staat daardoor € 80,00 LAGER dan het geld dat er ligt."],
  ["drawer_settlement_stale/amount", "drawer_settlement_stale", "Betaling factuur 7 — je kasboek houdt € 100,00 aan, de factuur zegt € 121,00. Verschil € 21,00."],
  ["drawer_settlement_stale/date", "drawer_settlement_stale", "Betaling factuur 8 — het bedrag klopt, maar de datum in je kasboek (2026-04-30) is niet de betaaldatum van de factuur (2026-05-02). Het saldo per dag klopt daardoor niet."],
  ["drawer_settlement_stale/direction", "drawer_settlement_stale", "Betaling factuur 9 — het bedrag klopt, maar de richting van de kasregel volgt de factuur niet. Het saldo per dag klopt daardoor niet."],
  ["drawer_negative", "drawer_negative", "Het kassaldo stond op 2026-02-11 € 40,00 ONDER nul. Dat kan fysiek niet, en het blokkeert de BTW-aangifte van dat kwartaal."],
];

const allFindings = () => [
  ...MONEY_CASES.flatMap((c) => findMoneyViolations(c.input).map((v) => ({ name: c.name, ...v }))),
  ...DRAWER_CASES.flatMap((c) => findDrawerViolations(c.input).map((v) => ({ name: c.name, ...v }))),
];

test("[KANTOOR-RUST] the owner's sentences, kinds and order are exactly what they were", () => {
  const now = allFindings().map((f) => [f.name, f.kind, f.message]);
  assert.deepEqual(now, PINNED_OWNER, "an owner message, a kind, or the order of findings changed");
});

test("[KANTOOR-RUST] every fixture kind is covered — money and drawer, every sentence branch", () => {
  const kinds = new Set<string>(allFindings().map((f) => f.kind));
  for (const k of [
    "negative_paid", "overpaid", "paid_amount_never_written", "paid_without_payments", "payments_without_paid",
    "status_paid_but_open", "status_open_but_covered", "btw_arithmetic", "creditnota_sign", "duplicate_live_pair",
    "transaction_overallocated", "matched_tx_unpaid_invoice",
    "drawer_settlement_missing", "drawer_settlement_orphan", "drawer_settlement_stale", "drawer_negative",
  ]) assert.ok(kinds.has(k), `no fixture produces ${k} — a sentence branch has no proof`);
  // The branches inside one kind: covered (in/out), duplicate (agree/disagree), stale (amount/date/direction).
  const names = allFindings().map((f) => f.name);
  for (const n of ["status_open_but_covered/incoming", "status_open_but_covered/outgoing", "duplicate_live_pair/agree",
    "duplicate_live_pair/disagree", "drawer_settlement_stale/amount", "drawer_settlement_stale/date", "drawer_settlement_stale/direction"]) {
    assert.ok(names.includes(n), `${n} produced nothing`);
  }
});

test("[KANTOOR-RUST] the accountant's sentence carries every figure of the owner's", () => {
  for (const f of allFindings()) {
    assert.ok(f.accountantMessage.length > 0, `${f.kind}: no accountant sentence`);
    // Every euro amount, in the owner's own formatting.
    for (const amount of f.message.match(/€ [\d.]+,\d{2}/g) ?? []) {
      assert.ok(f.accountantMessage.includes(amount), `${f.name}: ${amount} is missing from "${f.accountantMessage}"`);
    }
    // Every identifier: invoice numbers, ISO dates, the drawer row's description, the supplier.
    for (const token of f.message.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{4}-\d{4}\b|\b\d{8}\b|26\/3958|FAMZFOOD BV|ATAPACK|Betaling factuur [^—]+/g) ?? []) {
      assert.ok(f.accountantMessage.includes(token.trim()), `${f.name}: "${token.trim()}" is missing from "${f.accountantMessage}"`);
    }
    // The direction words that decide what to do — never dropped.
    for (const word of ["HOGER", "LAGER", "ONDER nul", "NEGATIEF", "POSITIEF", "te veel", "nog open", "geen geld"]) {
      if (f.message.includes(word)) assert.ok(f.accountantMessage.includes(word), `${f.name}: "${word}" is missing`);
    }
    // Both disagreeing amounts of a contradicting duplicate, and the count of copies.
    if (f.name === "duplicate_live_pair/disagree") {
      assert.match(f.accountantMessage, /€ 579,63/); assert.match(f.accountantMessage, /€ 4\.917,90/); assert.match(f.accountantMessage, /2 keer/);
    }
  }
});

test("[KANTOOR-RUST] the accountant's sentence addresses nobody and names no owner-only door", () => {
  for (const f of allFindings()) {
    assert.doesNotMatch(f.accountantMessage, /\b(je|jij|jou|jouw|jullie)\b/i, `${f.name}: owner pronoun in "${f.accountantMessage}"`);
    assert.doesNotMatch(
      f.accountantMessage,
      /Genegeerd|Ontkoppelen|Bank-pagina|facturenlijst|meld\b|draai\b|koppel opnieuw|Bewaar het origineel|Leg ze naast|weggooit|herinnering/i,
      `${f.name}: an owner-only route or act in "${f.accountantMessage}"`,
    );
    // Brief: the accountant reads the fact, not the argument. No sentence longer than the owner's.
    assert.ok(f.accountantMessage.length <= f.message.length + 20, `${f.name}: the accountant's sentence is longer than the owner's`);
  }
});

test("[KANTOOR-RUST] findingText is the one switch, and it does not edit either sentence", () => {
  const f = { message: "eigenaar: € 1,00", accountantMessage: "boekhouder: € 1,00" };
  assert.equal(findingText(f, "owner"), f.message);
  assert.equal(findingText(f, "accountant"), f.accountantMessage);
});
