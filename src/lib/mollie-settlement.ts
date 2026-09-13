// src/lib/mollie-settlement.ts
// [MOLLIE-AFREKENING] What a Mollie settlement IS in this administration. Pure, no I/O.
// Run: npx tsx --test src/lib/mollie-settlement.test.ts
//
// A Mollie payout is a NETTED settlement: the sum of the payments Mollie collected for the owner,
// minus Mollie's own fees (21% btw), transferred in one bank credit. Every part of it was already
// half in the books:
//
//   · the PAYMENTS — an iDEAL payment on a BoekBrug payment link marks its invoice paid the
//     moment Mollie rings ([MOLLIE] webhook), so the revenue and its btw are booked;
//   · the FEES were nowhere: Mollie sends a monthly invoice for them, and no path in the app
//     read it — so a cost with deductible btw stayed out of the result;
//   · the PAYOUT bank line was held from every category ([MOLLIE-UITBETALING] in
//     bank-double-booking.ts) because the app could not say what it was: the fee shifts every
//     amount, so no invoice matches it, and booking it as omzet would count the payments twice.
//
// The Settlements API answers all three at once, per settlement, to the cent. This module turns
// one settlement into: the fee invoice (a cost, paid by deduction on the settlement date), the
// payout expectation (the bank line this settlement IS), and the split of the collected payments
// into "ours" (a BoekBrug invoice, already booked) and "not ours" (a payment from elsewhere —
// the owner's webshop — whose revenue is booked nowhere and is NAMED, never guessed at).
//
// ── THE ONE RULE ──
// Nothing is written unless the settlement reconciles: Σ revenue gross − Σ cost gross must equal
// the paid-out amount in cents. A settlement that does not add up is refused with a reason, and
// the refusal is stored — a Mollie response the app did not understand must never become a cost.

import { round2 } from "./invoice-totals";
import { deriveKey } from "./contracts/idempotency";
import { telWoord } from "./nl-plural";

/** One line of a settlement period: a revenue or a cost, as Mollie reports it. */
export interface MollieSettlementLine {
  description?: string | null;
  method?: string | null;
  count?: number | null;
  amountNet?: { currency?: string; value?: string } | null;
  amountVat?: { currency?: string; value?: string } | null;
  amountGross?: { currency?: string; value?: string } | null;
}

export interface MollieSettlementPeriod {
  revenue?: MollieSettlementLine[] | null;
  costs?: MollieSettlementLine[] | null;
  /** Mollie's own invoice for this period's costs — the document behind the fee. */
  invoiceId?: string | null;
}

/** The settlement resource (GET /v2/settlements/{id}), the fields this module reads. */
export interface MollieSettlement {
  id: string;
  /** The bank reference Mollie prints on the transfer, e.g. "1234567.2404.03". */
  reference?: string | null;
  status?: string | null;
  amount?: { currency?: string; value?: string } | null;
  settledAt?: string | null;
  createdAt?: string | null;
  /** periods[year][month] */
  periods?: Record<string, Record<string, MollieSettlementPeriod>> | null;
}

/** A payment inside a settlement (GET /v2/settlements/{id}/payments), the fields read. */
export interface MollieSettlementPayment {
  id: string;
  amount?: { currency?: string; value?: string } | null;
  status?: string | null;
  /** Mollie's own field on payments created from a payment link, when present. */
  paymentLinkId?: string | null;
}

/**
 * A refund or chargeback inside a settlement.
 *
 * [TERUGBETALING] This used to say "only its existence matters here", and that was true while the
 * sync did nothing with one but hold the settlement. It now records the event and names the
 * invoice it un-pays, and `paymentId` is what makes that possible: it is the payment the money
 * went back on, and mollie_payment_links.payment_id maps that to one of our invoices. Reading it
 * is free — Mollie has always sent it — while not reading it left the owner with a held settlement
 * and no way to find out which sale it was about.
 */
export interface MollieSettlementAdjustment {
  id: string;
  amount?: { currency?: string; value?: string } | null;
  /** The payment (tr_…) this refund or chargeback went back on. */
  paymentId?: string | null;
  createdAt?: string | null;
}

export interface SettlementSummary {
  settlementId: string;
  reference: string | null;
  /** ISO date (Amsterdam-agnostic: Mollie's settledAt date part) the money left Mollie. */
  settledOn: string | null;
  /** Euros, cents-exact. */
  revenueGross: number;
  costsNet: number;
  costsVat: number;
  costsGross: number;
  payout: number;
  /** Mollie's own invoice ids for the costs, deduplicated. */
  invoiceIds: string[];
  /** Cost lines that carried a btw other than 21% or 0% — named, because they are unexpected. */
  oddVatLines: number;
}

export type SettlementVerdict =
  | { ok: true; summary: SettlementSummary }
  | { ok: false; reason: string };

function cents(v: { value?: string } | null | undefined): number | null {
  const raw = v?.value;
  if (typeof raw !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(raw.trim())) return null;
  return Math.round(Number(raw) * 100);
}

function isEur(v: { currency?: string } | null | undefined): boolean {
  return (v?.currency ?? "EUR") === "EUR";
}

/**
 * Read one settlement into cents-exact totals, or refuse.
 *
 * Refuses on: a non-EUR amount, an unparsable amount, a status that is not paid out, and — the
 * one that matters — revenue minus costs not equal to the payout. Mollie reports all three, so
 * a mismatch means the app misread the response, and a misread must not book.
 */
export function summarizeSettlement(s: MollieSettlement): SettlementVerdict {
  if (!s.id) return { ok: false, reason: "settlement zonder id" };
  if (s.status && s.status !== "paidout") return { ok: false, reason: `status ${s.status} — nog niet uitbetaald` };
  if (!isEur(s.amount)) return { ok: false, reason: `valuta ${s.amount?.currency} — alleen EUR wordt geboekt` };
  const payoutC = cents(s.amount);
  if (payoutC === null) return { ok: false, reason: "uitbetaald bedrag onleesbaar" };

  let revenueC = 0, costNetC = 0, costVatC = 0, costGrossC = 0, oddVat = 0;
  const invoiceIds = new Set<string>();
  for (const year of Object.values(s.periods ?? {})) {
    for (const period of Object.values(year ?? {})) {
      if (period?.invoiceId) invoiceIds.add(period.invoiceId);
      for (const r of period?.revenue ?? []) {
        if (!isEur(r.amountGross)) return { ok: false, reason: "omzetregel in een andere valuta dan EUR" };
        const g = cents(r.amountGross);
        if (g === null) return { ok: false, reason: `omzetregel zonder leesbaar brutobedrag (${r.description ?? "?"})` };
        revenueC += g;
      }
      for (const c of period?.costs ?? []) {
        if (!isEur(c.amountGross)) return { ok: false, reason: "kostenregel in een andere valuta dan EUR" };
        const n = cents(c.amountNet), v = cents(c.amountVat), g = cents(c.amountGross);
        if (n === null || v === null || g === null) return { ok: false, reason: `kostenregel zonder leesbare bedragen (${c.description ?? "?"})` };
        if (n + v !== g) return { ok: false, reason: `kostenregel telt niet op: ${n} + ${v} ≠ ${g} (${c.description ?? "?"})` };
        // 21% within a cent of rounding, or 0% — anything else is not the Mollie we know.
        if (v !== 0 && Math.abs(v - Math.round(n * 0.21)) > 1) oddVat++;
        costNetC += n; costVatC += v; costGrossC += g;
      }
    }
  }
  if (revenueC - costGrossC !== payoutC) {
    return { ok: false, reason: `omzet ${revenueC} − kosten ${costGrossC} ≠ uitbetaald ${payoutC} (centen)` };
  }
  return {
    ok: true,
    summary: {
      settlementId: s.id,
      reference: s.reference ?? null,
      settledOn: s.settledAt ? s.settledAt.slice(0, 10) : null,
      revenueGross: revenueC / 100,
      costsNet: costNetC / 100,
      costsVat: costVatC / 100,
      costsGross: costGrossC / 100,
      payout: payoutC / 100,
      invoiceIds: [...invoiceIds].sort(),
      oddVatLines: oddVat,
    },
  };
}

/** The fee invoice this settlement is: a purchase from Mollie, paid by deduction. */
export interface FeeInvoiceDraft {
  clientName: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalExBtw: number;
  btwAmount: number;
  totalIncBtw: number;
  /** Mollie's own invoice ids, for the trail. */
  mollieInvoiceIds: string[];
}

export const MOLLIE_SUPPLIER_NAME = "Mollie B.V.";

/**
 * Null when there is nothing to book: a settlement with no costs (Mollie waives fees on some
 * plans and on refunds) has no fee invoice, and a fee invoice of 0.00 is a document that says
 * Mollie worked for free.
 */
export function feeInvoiceFrom(summary: SettlementSummary): FeeInvoiceDraft | null {
  if (summary.costsGross <= 0 || !summary.settledOn) return null;
  return {
    clientName: MOLLIE_SUPPLIER_NAME,
    // Keyed on the settlement, not Mollie's monthly invoice: one invoice covers several
    // settlements, and two rows with the same number would be read as a duplicate.
    invoiceNumber: `MOLLIE-${summary.reference ?? summary.settlementId}`,
    invoiceDate: summary.settledOn,
    totalExBtw: round2(summary.costsNet),
    btwAmount: round2(summary.costsVat),
    totalIncBtw: round2(summary.costsGross),
    mollieInvoiceIds: summary.invoiceIds,
  };
}

/** The split of a settlement's payments into ours and not ours. */
export interface PaymentSplit {
  /** Payments whose id maps to a BoekBrug payment link — revenue already booked. */
  linkedGross: number;
  linkedCount: number;
  /** Payments from elsewhere — revenue booked nowhere in the app. */
  unlinkedGross: number;
  unlinkedCount: number;
  /** Payment ids that could not be read (no EUR amount). Named, never dropped. */
  unreadable: string[];
}

export function splitPayments(
  payments: readonly MollieSettlementPayment[],
  ourPaymentIds: ReadonlySet<string>,
): PaymentSplit {
  let linkedC = 0, linkedCount = 0, unlinkedC = 0, unlinkedCount = 0;
  const unreadable: string[] = [];
  for (const p of payments) {
    const c = isEur(p.amount) ? cents(p.amount) : null;
    if (c === null) { unreadable.push(p.id); continue; }
    if (ourPaymentIds.has(p.id)) { linkedC += c; linkedCount++; } else { unlinkedC += c; unlinkedCount++; }
  }
  return { linkedGross: linkedC / 100, linkedCount, unlinkedGross: unlinkedC / 100, unlinkedCount, unreadable };
}

/** How many days apart two ISO dates are (absolute), or null when either is unusable. */
function daysApart(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a.slice(0, 10)), tb = Date.parse(b.slice(0, 10));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

/** How far the bank may book the transfer from Mollie's settledAt. Weekends and holidays. */
export const PAYOUT_DATE_WINDOW_DAYS = 5;

/**
 * Is this bank line the payout of this settlement? Cent-exact amount, the word Mollie (or the
 * bank reference) in the text, and a date within the window. All three — a Mollie credit of the
 * same amount a month later is a different settlement.
 */
export function isPayoutOf(
  line: { amount: number | null; date: string | null; description: string | null; counterpart_name: string | null },
  summary: SettlementSummary,
): boolean {
  if (Math.round((line.amount ?? 0) * 100) !== Math.round(summary.payout * 100)) return false;
  const text = `${line.counterpart_name ?? ""} ${line.description ?? ""}`;
  const named = /\bmollie\b/i.test(text) || (!!summary.reference && text.includes(summary.reference));
  if (!named) return false;
  const d = daysApart(line.date, summary.settledOn);
  return d !== null && d <= PAYOUT_DATE_WINDOW_DAYS;
}

/**
 * Do the payments explain the whole revenue? When they do not, the settlement carries lines that
 * are not payments — a refund, a chargeback, a correction — and "every payment is ours" no longer
 * means "every euro in this line is booked". Cents, like everything else here; an unreadable
 * payment makes the answer no.
 */
export function paymentsCoverRevenue(split: PaymentSplit, summary: Pick<SettlementSummary, "revenueGross">): boolean {
  if (split.unreadable.length > 0) return false;
  return Math.round((split.linkedGross + split.unlinkedGross) * 100) === Math.round(summary.revenueGross * 100);
}

/**
 * What the payout bank line is, given the split.
 *
 *   'transfer'  every payment in it settled a BoekBrug invoice, the payments add up to the
 *               revenue, and nothing was refunded or charged back: the revenue is booked, the
 *               fee is booked, the line is money moving from Mollie's balance to the bank —
 *               a transfer, which touches neither revenue nor cost.
 *   'hold'      at least one payment is not ours, or the settlement carries money that is not a
 *               payment (a refund of one of OUR invoices leaves that invoice standing as paid
 *               while the money went back), or the payments do not explain the revenue. The
 *               owner books what the app cannot; the app names it and books nothing.
 */
export function payoutLineVerdict(
  split: PaymentSplit,
  context?: { summary?: Pick<SettlementSummary, "revenueGross">; adjustments?: number },
): "transfer" | "hold" {
  if (split.unlinkedCount > 0 || split.unreadable.length > 0) return "hold";
  if ((context?.adjustments ?? 0) > 0) return "hold";
  if (context?.summary && !paymentsCoverRevenue(split, context.summary)) return "hold";
  return "transfer";
}

/**
 * The reason a settlement is held, in the owner's words — one sentence that says what the bank
 * line IS (one netted amount) and what to do, so nobody codes the whole line as omzet and books
 * the linked part twice.
 */
export function holdReason(split: PaymentSplit, summary: Pick<SettlementSummary, "payout" | "revenueGross">, adjustments: number): string {
  const parts: string[] = [];
  if (adjustments > 0) parts.push(`${telWoord(adjustments, "terugbetaling of chargeback", "terugbetalingen of chargebacks")} in deze afrekening — controleer welke factuur is terugbetaald`);
  if (split.unlinkedCount > 0) parts.push(`€ ${split.unlinkedGross.toFixed(2)} van de betalingen hoort niet bij een BoekBrug-factuur (${split.unlinkedCount} betalingen${split.unreadable.length ? `, ${split.unreadable.length} onleesbaar` : ""})`);
  else if (split.unreadable.length > 0) parts.push(`${split.unreadable.length} betalingen onleesbaar`);
  else if (!paymentsCoverRevenue(split, summary)) parts.push(`de betalingen (€ ${(split.linkedGross + split.unlinkedGross).toFixed(2)}) verklaren de omzet (€ ${summary.revenueGross.toFixed(2)}) niet`);
  return `${parts.join("; ")}. De bankregel van € ${summary.payout.toFixed(2)} is één netto bedrag (omzet min Mollie-kosten): splits hem, of boek de omzet apart en zet de regel op overboeking — niet de hele regel als omzet.`;
}

/**
 * The idempotency key of the fee payment: one per (settlement row, invoice). Keyed on the row
 * alone, a fee invoice the owner deleted could never be paid again — the recreated invoice met
 * a key "spent" on the old one. Deterministic, so a retry after a failed RPC replays the same
 * booking. A uuid shape because that is what apply_manual_payment takes.
 */
export function feeClientKey(settlementRowId: string, invoiceId: string): string {
  // [CONTRACT] Delegates now. The derivation used to live here, and it was one of four unrelated
  // schemes feeding the same uuid column — see contracts/idempotency.ts for why that is a double
  // booking waiting for a Tuesday. The answer is BYTE-IDENTICAL to what this function returned
  // before; a test pins two of its historical outputs as literals.
  return deriveKey("mollie-fee", settlementRowId, invoiceId);
}
