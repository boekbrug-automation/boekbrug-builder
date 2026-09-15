// src/lib/bad-debt-collect.ts
// [BAD-DEBT] I/O collector shared by /api/aangifte, /api/readiness and the closing package, so all
// three flag the same reclaimable bad-debt BTW. Kept out of bad-debt.ts (pure). Under kasstelsel it
// short-circuits to nothing (no BTW was declared on an unpaid invoice). Best-effort: a query error
// degrades to "none" rather than blocking a money read — but it SAYS so (readFailed), because on
// the clawback side "none" is what a quarter gets filed on. See [ART29-UNKNOWN] below.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import {
  detectBadDebt, detectVatClawback,
  type BadDebtInput, type BadDebtResult, type VatClawbackResult,
} from "./bad-debt";
import type { VatScheme } from "./vat-scheme";

const EMPTY: BadDebtResult = { eligible: [], totalReclaimableBtw: 0, usedInvoiceDateFallback: false };
const EMPTY_CLAWBACK: VatClawbackResult = { eligible: [], totalRepayableBtw: 0, usedInvoiceDateFallback: false };

/**
 * [ART29-UNKNOWN] "We looked and found nothing" and "we could not look" are different answers, and
 * on the art. 29 side they are not even close in consequence.
 *
 * Both collectors degrade to an empty result on a query error, which keeps a money read alive —
 * that part is right and stays. What was missing is that the caller could not TELL, so a failed
 * read rendered as a clean bill of health:
 *
 *   · the reclaim side (lid 1, sales) is money to GET. Losing it costs the owner a refund they
 *     could have asked for — bad, but nothing is filed wrong;
 *   · the clawback side (lid 7, purchases) is money to GIVE BACK. Its own callers say so in as
 *     many words ("the only art. 29 side that turns into a naheffing when it is ignored"), and
 *     the red banner on the concept aangifte is usually the first and only place the owner ever
 *     hears about it. Silently dropping that one lets a quarter be filed too low, with
 *     belastingrente running on the difference.
 *
 * So the result carries the fact. Callers that only need the figures ignore it; the surfaces that
 * make a claim about art. 29 say "we could not check this" instead of showing nothing.
 */
export type CollectedBadDebt = BadDebtResult & { readFailed: boolean };
export type CollectedVatClawback = VatClawbackResult & { readFailed: boolean };

/**
 * Find the owner's sales invoices whose BTW is reclaimable as a bad debt as of `asOf` (a period end
 * or today). Fetches the owner's OUTGOING invoices still in a declared-but-unpaid state (sent /
 * overdue) across all time — bad debt is about OLD receivables, so there is no date-range filter —
 * and hands them to the pure detector. Only under factuurstelsel.
 */
export async function collectBadDebt(
  pipeline: PipelineClient,
  ownerId: string,
  scheme: VatScheme,
  asOf: string,
): Promise<CollectedBadDebt> {
  if (scheme !== "factuur") return { ...EMPTY, readFailed: false };
  // NOTE: creditnotas are fetched too (they also sit in status 'sent') — the pure detector needs
  // them to know how much of each original was reversed. [DEEL-CREDIT] It subtracts that amount
  // from the unpaid portion rather than dropping the invoice: a credit for one disputed line
  // leaves the rest a bad debt like any other. So the query must NOT filter invoice_type out.
  const rows = await fetchAllRows<{
    id: string | null; invoice_number: string | null; client_name: string | null; direction: string | null;
    status: string | null; invoice_type: string | null; original_invoice_id: string | null;
    invoice_date: string | null; due_date: string | null;
    total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
    amount_paid: number | null; receiver_id: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("id, invoice_number, client_name, direction, status, invoice_type, original_invoice_id, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid, receiver_id")
    .eq("sender_id", ownerId)
    .in("status", ["sent", "overdue"])
    .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => {
    console.error("[ART29-UNKNOWN] bad-debt read failed — reporting it as unknown, not as none", { ownerId, error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (rows === null) return { ...EMPTY, readFailed: true };

  const invoices: BadDebtInput[] = rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    clientName: r.client_name,
    direction: r.direction === "incoming" || r.direction === "outgoing"
      ? r.direction
      : r.receiver_id === ownerId ? "incoming" : "outgoing",
    status: r.status,
    invoiceType: r.invoice_type,
    originalInvoiceId: r.original_invoice_id,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    totalExBtw: r.total_ex_btw,
    btwAmount: r.btw_amount,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }));
  return { ...detectBadDebt({ scheme, asOf, invoices }), readFailed: false };
}

/**
 * [BAD-DEBT] Art. 29 lid 7 — the purchase side. Find the owner's PURCHASE invoices that are still
 * unpaid a year after their due date, so the voorbelasting deducted on them has become repayable
 * as of `asOf`. Same shape and same best-effort contract as collectBadDebt: only under
 * factuurstelsel, no date-range filter (this is about OLD payables), a query error degrades to
 * "none" rather than blocking a money read — and reports readFailed, which on THIS side is the
 * difference between "je hoeft niets terug te betalen" and a naheffing nobody warned about.
 *
 * `korActive` short-circuits: a KOR entrepreneur deducts no voorbelasting, so there is nothing to
 * give back — without it the app would invoice them for BTW they never claimed.
 */
export async function collectVatClawback(
  pipeline: PipelineClient,
  ownerId: string,
  scheme: VatScheme,
  asOf: string,
  korActive = false,
): Promise<CollectedVatClawback> {
  // [KAS-VOORBELASTING] Both schemes reach the detector now: a kas owner deducts voorbelasting on
  // the invoice date, so an old unpaid purchase carries the same art. 29 lid 7 liability. The KOR
  // short-circuit stays — there is no deduction to give back.
  if (korActive) return { ...EMPTY_CLAWBACK, readFailed: false };
  // 'received' is the only purchase status whose BTW the ledger actually put in 5b while the
  // invoice is still open. A supplier creditnota sits in the same status, and the pure detector
  // needs it to measure how much of the original it reverses — [DEEL-CREDIT] a PART of it leaves
  // the rest repayable, and this is the side that costs money. So this query must not filter
  // invoice_type out.
  const rows = await fetchAllRows<{
    id: string | null; invoice_number: string | null; client_name: string | null; direction: string | null;
    status: string | null; invoice_type: string | null; original_invoice_id: string | null;
    invoice_date: string | null; due_date: string | null;
    total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
    amount_paid: number | null; sender_id: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("id, invoice_number, client_name, direction, status, invoice_type, original_invoice_id, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid, sender_id")
    .eq("receiver_id", ownerId)
    .eq("status", "received")
    .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => {
    console.error("[ART29-UNKNOWN] vat-clawback read failed — reporting it as unknown, not as none", { ownerId, error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (rows === null) return { ...EMPTY_CLAWBACK, readFailed: true };

  const invoices: BadDebtInput[] = rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    clientName: r.client_name,
    // A row fetched by receiver_id IS a purchase for this owner; direction is only trusted when
    // it says so itself, so a mislabelled row can never be read as a sale here.
    direction: r.direction === "outgoing" && r.sender_id === ownerId ? "outgoing" : "incoming",
    status: r.status,
    invoiceType: r.invoice_type,
    originalInvoiceId: r.original_invoice_id,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    totalExBtw: r.total_ex_btw,
    btwAmount: r.btw_amount,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }));
  return { ...detectVatClawback({ scheme, asOf, korActive, invoices }), readFailed: false };
}
