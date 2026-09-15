// [DUBBEL-GEDEKT] Pure node test — run: npx tsx --test src/lib/bank-double-booking.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  paidInvoiceExplainsLine,
  paidInvoiceForLine,
  buildDoubleBookingGuard,
  isMollieCredit,
  type PaidExplainerRow,
  type GuardLine,
} from "./bank-double-booking";

const paid = (over: Partial<PaidExplainerRow> = {}): PaidExplainerRow => ({
  direction: "incoming", total_inc_btw: 250, amount_paid: 250,
  payment_date: "2026-07-10", marked_paid_at: null, invoice_date: "2026-07-01",
  ...over,
});

test("[DUBBEL-GEDEKT] a hand-paid bill explains its own bank debit", () => {
  // The Sligro case from the audit: invoice marked paid by hand (or incasso-settled with no bank
  // line), the debit arrives days later, the matcher excludes paid invoices, and a confident
  // memory hit used to code it 'kosten' — the same cost twice. The guard sees it.
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-12"), true);
  // Direction is load-bearing: a CREDIT of the same magnitude is different money.
  assert.equal(paidInvoiceExplainsLine([paid()], 250, "2026-07-12"), false);
  // An outgoing sale explains a credit, not a debit.
  assert.equal(paidInvoiceExplainsLine([paid({ direction: "outgoing" })], 250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] the two-week window bounds the claim", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-24"), true, "day 14 still inside");
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-08-20"), false, "six weeks later is a different €250");
  // Settled date falls back through marked_paid_at → invoice_date.
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: "2026-07-10" })], -250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] a cent of difference is a different amount", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250.01, "2026-07-12"), true, "one cent inside tolerance");
  assert.equal(paidInvoiceExplainsLine([paid()], -250.5, "2026-07-12"), false);
});

test("[DUBBEL-GEDEKT] undatable errs toward holding the line, never toward double-booking", () => {
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: null, invoice_date: null })], -250, "2026-07-12"), true);
  assert.equal(paidInvoiceExplainsLine([paid()], -250, null), true);
  assert.equal(paidInvoiceExplainsLine([], -250, "2026-07-12"), false, "no paid invoices, nothing to explain");
});

// ── The composed guard: what the three writers actually call ────────────────────────────────────

const line = (over: Partial<GuardLine> = {}): GuardLine => ({
  amount: -250, counterpart_name: "SLIGRO", description: "factuur", date: "2026-07-12", ...over,
});

test("[DUBBEL-GEDEKT] the guard withholds only the categories that carry money", () => {
  const g = buildDoubleBookingGuard({ paidRows: [paid()], hasRecentMolliePayout: false });
  assert.equal(g.hold("kosten", line()), "paid-invoice");
  assert.equal(g.hold("omzet", line({ amount: 250, date: "2026-07-12" })), null,
    "a credit is not explained by an incoming invoice — direction still decides");
  // transfer/prive/tax carry no P&L amount, so they cannot double-book one. Withholding them
  // would leave a private withdrawal uncoded for no gain.
  assert.equal(g.hold("transfer", line()), null);
  assert.equal(g.hold("prive", line()), null);
  assert.equal(g.hold("tax", line()), null);
});

test("[DUBBEL-GEDEKT] with nothing paid, nothing is withheld", () => {
  const g = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  assert.equal(g.hold("kosten", line()), null, "the guard must not become a brake on ordinary coding");
});

test("[MOLLIE-UITBETALING] a payout credit is held whatever category was suggested", () => {
  const mollie = line({ amount: 412.55, counterpart_name: "Mollie B.V.", description: "payout" });
  const on = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: true });
  const off = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  // The fee shifts every amount, so the cent-exact rule above can never catch this one.
  assert.equal(on.hold("omzet", mollie), "mollie-payout");
  assert.equal(on.hold("transfer", mollie), "mollie-payout", "not limited to P&L: the owner names this money");
  assert.equal(off.hold("omzet", mollie), null, "an owner without recent Mollie links keeps today's behaviour");
  // A DEBIT to Mollie (the fee invoice) is an ordinary cost, not a payout.
  assert.equal(on.hold("kosten", line({ amount: -12.10, counterpart_name: "Mollie B.V." })), null);
});

test("[MOLLIE-UITBETALING] the name test is Mollie-specific, not every PSP", () => {
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: "MOLLIE B.V.", description: "" }), true);
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: "CCV Group", description: "afrekening" }), false,
    "a retail owner's daily terminal settlement must not be frozen forever by one iDEAL payment");
  assert.equal(isMollieCredit({ amount: 100, counterpart_name: null, description: "mollie payout" }), true);
});

test("[DUBBEL-GEDEKT] a guard that could not look does not claim to know", () => {
  // molliePayoutKnown separates "this owner has no Mollie" from "the probe never ran". The
  // difference decides whether a future reader may treat the absence of a hold as an answer.
  const known = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false });
  const blind = buildDoubleBookingGuard({ paidRows: [], hasRecentMolliePayout: false, molliePayoutKnown: false });
  assert.equal(known.molliePayoutKnown, true);
  assert.equal(blind.molliePayoutKnown, false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [AL-BETAALD-NUMMER] The handle the guard was missing: the number printed on the bank line.
//
// Measured on the production database before this was written: 53 unlinked outgoing payments
// print the number of exactly one purchase invoice, 49 of those invoices were already settled,
// and together they carry € 34.858,79 — every one of them invisible to an amount-keyed rule the
// moment a bank charge or a rounding shifts a cent.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const numbered = (over: Partial<PaidExplainerRow> = {}): PaidExplainerRow =>
  paid({ invoice_number: "2670428", ...over });

const debit = (over: Partial<GuardLine> & { reference?: string | null } = {}): GuardLine & { reference?: string | null } => ({
  amount: -250, date: "2026-07-12", description: null, counterpart_name: null, ...over,
});

test("[AL-BETAALD-NUMMER] the printed number explains the line, whatever the amount says", () => {
  // The amount is nowhere near the invoice: a bank charge, a partial, a rounding. Identity wins.
  const hit = paidInvoiceForLine([numbered()], debit({ amount: -237.5, description: "Factuur 2670428" }));
  assert.equal(hit?.invoice_number, "2670428");
});

test("[AL-BETAALD-NUMMER] the printed number explains it outside the settlement window too", () => {
  // Six weeks later the amount rule gives up — and it should, since a second € 250 is a real
  // possibility. A payment that NAMES the invoice is not a coincidence.
  assert.equal(paidInvoiceForLine([numbered()], debit({ date: "2026-08-25" })) === null, true, "no number in the text");
  const named = paidInvoiceForLine([numbered()], debit({ date: "2026-08-25", description: "betaling 2670428" }));
  assert.equal(named?.invoice_number, "2670428");
});

test("[AL-BETAALD-NUMMER] direction still decides, however the number reads", () => {
  // A SALES invoice cannot explain money leaving the account, even when the line quotes it.
  const sale = numbered({ direction: "outgoing" });
  assert.equal(paidInvoiceForLine([sale], debit({ description: "2670428" })), null);
  assert.equal(paidInvoiceForLine([sale], debit({ amount: 250, description: "2670428" }))?.invoice_number, "2670428");
});

test("[AL-BETAALD-NUMMER] the number rules referenceMatches already paid for still hold", () => {
  // A digit-flanked fragment is a DIFFERENT invoice — the lesson that cost a wrong one-tap payment.
  assert.equal(paidInvoiceForLine([numbered({ invoice_number: "2050" })],
    debit({ amount: -9, description: "ref 26302050" })), null, "2050 inside 26302050 is not identity");
  // A bare calendar year is not identity either.
  assert.equal(paidInvoiceForLine([numbered({ invoice_number: "2026" })],
    debit({ amount: -9, description: "Huur juli 2026" })), null);
  // …and a needle under four characters is never safe.
  assert.equal(paidInvoiceForLine([numbered({ invoice_number: "12" })],
    debit({ amount: -9, description: "nota 12" })), null);
});

test("[AL-BETAALD-NUMMER] a row with no number falls back to the amount rule, unchanged", () => {
  assert.equal(paidInvoiceForLine([paid()], debit())?.total_inc_btw, 250);
  assert.equal(paidInvoiceForLine([paid()], debit({ amount: -250.5 })), null);
});

test("[AL-BETAALD-NUMMER] the old signature still answers exactly as it did", () => {
  // Every existing caller passes three arguments and must keep the amount-and-date behaviour.
  assert.equal(paidInvoiceExplainsLine([numbered()], -250, "2026-07-12"), true);
  assert.equal(paidInvoiceExplainsLine([numbered()], -250, "2026-08-25"), false);
  // …and a caller that DOES hand over the words gets the number handle.
  assert.equal(paidInvoiceExplainsLine([numbered()], -237.5, "2026-08-25", { description: "Factuur 2670428" }), true);
});

test("[AL-BETAALD-NUMMER] the guard holds a category on the number alone", () => {
  const g = buildDoubleBookingGuard({ paidRows: [numbered()], hasRecentMolliePayout: false });
  // Amount far off, date far off — only the printed number ties them, and that is enough to
  // refuse writing 'kosten' a second time over money a paid invoice already carries.
  assert.equal(g.hold("kosten", debit({ amount: -237.5, date: "2026-08-25", description: "Factuur 2670428" })), "paid-invoice");
  // A line naming nothing, far from the amount, is still a free line.
  assert.equal(g.hold("kosten", debit({ amount: -237.5, date: "2026-08-25" })), null);
});
