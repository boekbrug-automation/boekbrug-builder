// [SUPPLIER-IBAN] Pure node test — run: npx tsx --test src/lib/supplier-iban.test.ts
//
// The matcher's IBAN tier reads the account printed on THAT invoice. That field is null far more
// often than the supplier is unknown — a footer the extractor never reached, an invoice that
// arrived before the supplier existed in the registry — and in every one of those cases the app has
// known the account all along and no matcher asked.
//
// The shape this unlocks is the one that was unbookable by construction: an MT940 line with a
// counterpart IBAN, no invoice number, and no counterparty name. 'certain' had nothing to match;
// 'amount_only' had no name to require.
//
// What is held here is that the new evidence is weighed HONESTLY: below the document's own IBAN,
// booked flagged and never silent, ignored where the document already answered, and refused when
// the one weakness it has — a supplier resolved by a colliding name key — is showing.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scorePair,
  autoConfirmTier,
  matchTransactions,
  DEFAULT_OPTIONS,
  type InvoiceForMatching,
  type MatchOptions,
} from "./bank-matching";
import type { BankTransaction } from "./bank-parser";
import { withSupplierIbans, fetchSupplierIbans } from "./supplier-known-iban";

const OPTS: MatchOptions = { ...DEFAULT_OPTIONS, amountEpsilon: 0.02 };
const IBAN = "NL91ABNA0417164300";
const OTHER_IBAN = "NL02RABO0123456789";

const inv = (o: Partial<InvoiceForMatching> = {}): InvoiceForMatching => ({
  id: "i1",
  invoice_number: "26302050",
  total_inc_btw: 500,
  amount_paid: 0,
  invoice_date: "2026-06-01",
  due_date: "2026-06-30",
  client_name: "ATAPACK Cash & Carry B.V.",
  direction: "incoming",
  status: "received",
  accountant_status: null,
  vendor_iban: null,
  payment_prepared_at: null,
  supplier_known_iban: null,
  ...o,
});

const tx = (o: Partial<BankTransaction> = {}): BankTransaction => ({
  date: "2026-06-20",
  amount: -500,
  currency: "EUR",
  description: "SEPA overboeking",
  counterpartName: null,
  counterpartIban: IBAN,
  reference: null,
  transactionId: null,
  rawLine: "",
  ...o,
});

test("[SUPPLIER-IBAN] the line that was unbookable by construction now books — flagged", () => {
  // No invoice number, no counterparty name, just an account and an amount. Before this, no tier
  // could touch it: 'certain' needs the document to name the bill or the account, 'amount_only'
  // needs the name.
  const m = matchTransactions([tx()], [inv({ supplier_known_iban: IBAN })], OPTS).matches[0];
  assert.ok(m.best?.signals.includes("supplier_iban"), "the registry answered what the document could not");
  assert.equal(autoConfirmTier(m), "amount_only", "booked, and marked 'controleer'");
  assert.notEqual(autoConfirmTier(m), "certain", "one more link in the chain than the document's own IBAN");
});

test("[SUPPLIER-IBAN] it ranks below the document's own IBAN, and above a coincidence", () => {
  // The hierarchy this matcher already documents, with the new signal placed inside it rather than
  // beside it: printed number 0.97 > document IBAN 0.96 > registry IBAN 0.955 > coincidence 0.95.
  const printed = scorePair(tx({ reference: "26302050" }), inv(), OPTS);
  const documentIban = scorePair(tx(), inv({ vendor_iban: IBAN }), OPTS);
  const registryIban = scorePair(tx(), inv({ supplier_known_iban: IBAN }), OPTS);
  const coincidence = scorePair(
    tx({ counterpartIban: null, counterpartName: "ATAPACK Cash & Carry B.V." }), inv(), OPTS,
  );

  assert.ok(printed.confidence > documentIban.confidence, "a printed number still names the BILL");
  assert.ok(documentIban.confidence > registryIban.confidence, "the document's own account outranks the registry's");
  assert.ok(registryIban.confidence > coincidence.confidence, "and the registry outranks a bare amount+name");
});

test("[SUPPLIER-IBAN] when the document names the account, the registry adds nothing", () => {
  // Double-counting would push a plain document-IBAN match up the ranking for no new evidence — the
  // same account, asserted twice.
  const both = scorePair(tx(), inv({ vendor_iban: IBAN, supplier_known_iban: IBAN }), OPTS);
  const documentOnly = scorePair(tx(), inv({ vendor_iban: IBAN }), OPTS);
  assert.equal(both.confidence, documentOnly.confidence, "no bonus on top of the stronger claim");
  assert.ok(!both.signals.includes("supplier_iban"), "and it does not even raise the weaker signal");
  assert.ok(both.signals.includes("iban"));
});

test("[SUPPLIER-IBAN] a name on the line that points somewhere else blocks the booking", () => {
  // The one weakness this tier has: the registry attaches an account to a supplier, and supplier
  // resolution can fall back to a normalised NAME key — two real companies can collide on one. Then
  // an invoice inherits another company's account. The bank line's name is what shows it.
  const m = matchTransactions(
    [tx({ counterpartName: "Volledig Andere Leverancier B.V." })],
    [inv({ supplier_known_iban: IBAN })],
    OPTS,
  ).matches[0];
  assert.equal(autoConfirmTier(m), null, "a name that does not even reach the listing bar refuses");

  // Absent is fine — that absence is the entire reason this tier exists.
  const anonymous = matchTransactions([tx()], [inv({ supplier_known_iban: IBAN })], OPTS).matches[0];
  assert.equal(autoConfirmTier(anonymous), "amount_only");

  // And a name that DOES match books, as it would have anyway.
  const named = matchTransactions(
    [tx({ counterpartName: "ATAPACK Cash & Carry B.V." })],
    [inv({ supplier_known_iban: IBAN })],
    OPTS,
  ).matches[0];
  assert.equal(autoConfirmTier(named), "amount_only");
});

test("[SUPPLIER-IBAN] the bank naming another bill still outranks it", () => {
  // Same rule every other tier applies: the statement printing a document number we do not hold is
  // evidence about a different invoice, whatever account the money went to.
  const m = matchTransactions(
    [tx({ reference: "99999999" })], [inv({ supplier_known_iban: IBAN })], OPTS,
  ).matches[0];
  assert.equal(autoConfirmTier(m), null);
});

test("[SUPPLIER-IBAN] a different account is not a signal at all", () => {
  const s = scorePair(tx({ counterpartIban: OTHER_IBAN }), inv({ supplier_known_iban: IBAN }), OPTS);
  assert.ok(!s.signals.includes("supplier_iban"));
  // And no account on the line either.
  assert.ok(!scorePair(tx({ counterpartIban: null }), inv({ supplier_known_iban: IBAN }), OPTS)
    .signals.includes("supplier_iban"));
  // An invoice with no known supplier account is untouched by all of this.
  assert.ok(!scorePair(tx(), inv({ supplier_known_iban: null }), OPTS).signals.includes("supplier_iban"));
});

test("[SUPPLIER-IBAN] two same-amount siblings still tie — this identifies the SUPPLIER, not the bill", () => {
  // Exactly the [BANK-IBAN-COMPETITOR] doctrine, which this signal inherits rather than escapes: an
  // account says which company was paid. For a recurring same-amount supplier every open invoice
  // shares it, so it cannot pick between them and must not pretend to.
  const m = matchTransactions(
    [tx()],
    [inv({ supplier_known_iban: IBAN }), inv({ id: "i2", invoice_number: "26302362", supplier_known_iban: IBAN })],
    OPTS,
  ).matches[0];
  assert.equal(m.outcome, "choice", "ambiguity stops at the human");
  assert.equal(autoConfirmTier(m), null);
});

test("[SUPPLIER-IBAN] withSupplierIbans attaches only where the document was silent", () => {
  const map = new Map([["s1", IBAN]]);
  const rows = withSupplierIbans(
    [
      { supplier_id: "s1", vendor_iban: null },        // silent document → attach
      { supplier_id: "s1", vendor_iban: OTHER_IBAN },  // document answered → leave alone
      { supplier_id: "s2", vendor_iban: null },        // supplier has no known account
      { supplier_id: null, vendor_iban: null },        // no supplier at all
    ],
    map,
  );
  assert.deepEqual(rows.map((r) => r.supplier_known_iban), [IBAN, null, null, null]);
  // The stronger claim is never overwritten — that would LOSE evidence, not add it.
  assert.equal(rows[1].vendor_iban, OTHER_IBAN);
});

// ── [BLIND-LEVERANCIER] The read says whether it answered ──────────────────────────────────────
//
// An empty map has two causes that look identical from outside: no supplier in this batch has a
// known account, or the read fell over. Under the second one a payment carrying only an IBAN goes
// back to the manual pile, and "Probeer alles opnieuw" reports that it examined everything and
// found nothing new — which the owner reads as a fact about their administratie rather than about
// a database that was unreachable for a minute.

/** A chainable Supabase-shaped stub whose terminal `.range()` answers with `answer()`. */
function stubClient(answer: () => Promise<{ data: unknown; error: unknown }>) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "order"]) chain[m] = () => chain;
  chain.range = () => answer();
  return chain;
}

test("[BLIND-LEVERANCIER] a good read answers unavailable: false, even when it finds nothing", async () => {
  const client = stubClient(async () => ({ data: [], error: null }));
  const got = await fetchSupplierIbans(client, "u1", [{ supplier_id: "s1", vendor_iban: null }]);
  assert.equal(got.unavailable, false, "an empty administratie is not a failure");
  assert.equal(got.ibans.size, 0);
});

test("[BLIND-LEVERANCIER] a good read still returns the map it found", async () => {
  const client = stubClient(async () => ({ data: [{ id: "s1", iban: "NL91 ABNA 0417 1643 00" }], error: null }));
  const got = await fetchSupplierIbans(client, "u1", [{ supplier_id: "s1", vendor_iban: null }]);
  assert.equal(got.unavailable, false);
  assert.equal(got.ibans.get("s1"), "NL91ABNA0417164300");
});

test("[BLIND-LEVERANCIER] a failed read is admitted, and still degrades to an empty map", async () => {
  const client = stubClient(async () => { throw new Error("connection reset"); });
  const got = await fetchSupplierIbans(client, "u1", [{ supplier_id: "s1", vendor_iban: null }]);
  assert.equal(got.unavailable, true, "the loss must travel — a silent empty map is the whole bug");
  assert.equal(got.ibans.size, 0, "…and it still never invents evidence");
});

test("[BLIND-LEVERANCIER] nothing to ask about is not a failure", async () => {
  // Every invoice already names its own account, so no query runs at all. Claiming a loss here
  // would put a warning on the screen on a day when nothing whatsoever went wrong.
  const client = stubClient(async () => { throw new Error("must not be called"); });
  const got = await fetchSupplierIbans(client, "u1", [{ supplier_id: "s1", vendor_iban: "NL91ABNA0417164300" }]);
  assert.equal(got.unavailable, false);
  assert.equal(got.ibans.size, 0);
});
