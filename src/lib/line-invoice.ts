// src/lib/line-invoice.ts
// [REGEL-FACTUUR] An invoice from a bank line, with no file. Pure, no I/O.
// Run: npx tsx --test src/lib/line-invoice.test.ts
//
// Every door that adds an invoice from /bank read a FILE. The owner who knows exactly what a
// payment was — the supplier who never sends a bill, the receipt that went through the wash, the
// cash sale a customer paid by transfer — had two options: upload something they do not have, or
// ignore the line and lose it from every figure. This is the third: say what it was, and the line
// books as that.
//
// The one rule that makes this honest is the btw rule, and it differs by direction:
//   · money OUT (a purchase): without an invoice there is NO voorbelasting — art. 15 Wet OB needs
//     an invoice that meets art. 35a; a bank line does not. The cost still deducts for the income
//     tax (a bank line with the supplier's name is enough evidence there). So a purchase booked
//     without a document carries btw 0, whatever rate the supplier uses, and the row says why.
//     Only when the owner declares the document exists elsewhere (paper, a mailbox) may a rate be
//     applied — and then the row is flagged so the document can still be attached later.
//   · money IN (a sale): btw is OWED on revenue whether or not an invoice was issued. A sale booked
//     from a bank line carries the rate the owner names, default 21.

import { proposeSplit, LEGAL_NL_RATES } from "./vendor-vat-rate";
import { round2 } from "./invoice-totals";

export type LineRate = 0 | 9 | 21;

export interface LineInvoiceInput {
  /** Signed line amount: negative = money out. */
  amount: number;
  /** ISO date of the line. */
  date: string;
  counterpartName: string | null;
  /** The rate the owner chose. Ignored (forced to 0) on a purchase without a document. */
  rate: LineRate;
  /** "Ik heb de factuur of bon ergens anders." Only meaningful on a purchase. */
  hasDocumentElsewhere: boolean;
  description?: string | null;
}

export interface LineInvoiceDraft {
  direction: "incoming" | "outgoing";
  clientName: string;
  invoiceDate: string;
  totalIncBtw: number;
  totalExBtw: number;
  btwAmount: number;
  /** The rate actually applied (0 when withheld). */
  rateApplied: LineRate;
  /** True when the owner asked for a rate on a purchase and got 0 because there is no document. */
  btwWithheldNoDocument: boolean;
  /** True when the document is declared to exist but is not attached yet. */
  documentMissing: boolean;
  description: string | null;
}

export type LineInvoiceVerdict =
  | { ok: true; draft: LineInvoiceDraft }
  | { ok: false; code: "zero_amount" | "bad_date" | "bad_rate" | "no_name"; reason: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isLineRate(v: unknown): v is LineRate {
  return typeof v === "number" && (LEGAL_NL_RATES as readonly number[]).includes(v);
}

export function buildLineInvoice(input: LineInvoiceInput): LineInvoiceVerdict {
  const amount = Number(input.amount);
  // [HANDGESCHREVEN-BOEKING] One cent, not half a cent. The payment door this route now books
  // through (confirm_bank_payment) refuses a line whose remaining value is <= EUR 0.01: its v_eps
  // is a ROUNDING tolerance — "covered within a cent counts as paid" — and the same constant
  // decides whether a line still has anything worth giving. Measured in production: the only line
  // at or under a cent is a EUR 0.01 Mollie account-verification deposit, no invoice anywhere is
  // that small, and no allocation has ever been written from such a line.
  //
  // The floor is repeated HERE rather than left to the door for one reason: for a line that was
  // never worth a cent the door's wording is "payment fully applied", and nothing was applied.
  // The owner must read a sentence that is true.
  if (!Number.isFinite(amount) || Math.abs(amount) <= 0.01) {
    return { ok: false, code: "zero_amount", reason: "Deze regel heeft geen bedrag." };
  }
  if (!ISO.test(input.date)) return { ok: false, code: "bad_date", reason: "Deze regel heeft geen bruikbare datum." };
  if (!isLineRate(input.rate)) return { ok: false, code: "bad_rate", reason: "Kies 21%, 9% of 0%." };
  const clientName = (input.counterpartName ?? "").trim();
  if (!clientName) return { ok: false, code: "no_name", reason: "Vul in van wie of aan wie deze betaling was." };

  const direction = amount < 0 ? "incoming" : "outgoing";
  const totalIncBtw = round2(Math.abs(amount));
  const withheld = direction === "incoming" && !input.hasDocumentElsewhere && input.rate !== 0;
  const rateApplied: LineRate = direction === "incoming" && !input.hasDocumentElsewhere ? 0 : input.rate;
  const split = proposeSplit(totalIncBtw, rateApplied) ?? { totalExBtw: totalIncBtw, btwAmount: 0 };
  return {
    ok: true,
    draft: {
      direction,
      clientName: clientName.slice(0, 200),
      invoiceDate: input.date,
      totalIncBtw,
      totalExBtw: split.totalExBtw,
      btwAmount: split.btwAmount,
      rateApplied,
      btwWithheldNoDocument: withheld,
      documentMissing: direction === "incoming" && input.hasDocumentElsewhere,
      description: (input.description ?? "").trim().slice(0, 300) || null,
    },
  };
}
