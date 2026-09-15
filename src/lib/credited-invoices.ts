// src/lib/credited-invoices.ts
// [CREDITNOTA-NO-CHASE] One rule for "is this outgoing invoice still money owed TO me?", because
// getting it wrong has now been possible on four separate surfaces (the reminder cron, the daily
// truth tile, the Vandaag to-do list, the public pay page) and each of them re-derived it.
//
// A creditnota withdraws an invoice, but NOTHING in the invoice row says so. The original keeps
// its 'sent'/'overdue' status, its positive total and its due date — deliberately, because that
// +omzet must stay to be netted by the creditnota's −omzet. Meanwhile the creditnota itself is
// ALSO an outgoing row with status 'sent' and a NEGATIVE total, so the naive query
// (sender_id + direction 'outgoing' + status sent/overdue) returns BOTH.
//
// That pairing is why a receivable list must exclude BOTH sides together or neither:
//   · both in   → the euro total nets out by accident, but the COUNT and the overdue count are
//                 inflated by two, and the owner is told to chase an invoice they withdrew;
//   · only the original removed → the −X creditnota is left alone in the list and the receivable
//                 total goes NEGATIVE (worse than where we started);
//   · both out   → count, overdue and total are all correct. This is the rule below.
//
// NO I/O. The caller supplies the set of invoice ids that have a creditnota against them.

// [CENT] The app's one rounding. Writing `Math.round(x * 100) / 100` here instead was caught by
// the gate on the first run, and rightly: this file now produces an AMOUNT — what is still owed
// after a partial credit — and that amount is printed in a reminder to a customer. Two roundings
// disagree on exactly the half cents that end up in a demand for payment.
import { round2 } from "./invoice-totals";
// The direction of the MONEY, which is not always the direction of the document — see below.
import type { ProofDirection } from "./open-invoice-proof-types";

/** The fields the receivable rule reads. A subset of the invoices row. */
export interface CreditableInvoiceRow {
  id: string;
  invoice_type?: string | null;
  status?: string | null;
  total_inc_btw?: number | null;
}

/** Is this row a creditnota (a credit the owner OWES, never a receivable)? */
export function isCreditnota(row: CreditableInvoiceRow): boolean {
  return (row.invoice_type ?? "") === "creditnota";
}

/**
 * Is this outgoing invoice still money owed TO the owner?
 *
 * False for a creditnota (it is the opposite of a receivable) and false for an invoice that has
 * been withdrawn by one. Everything else is unchanged — this never looks at amounts or dates, so
 * it cannot alter a normal invoice's treatment.
 *
 * [DEEL-CREDIT] The set now means FULLY credited, and the distinction is the whole point of
 * partial credits. An invoice of € 500 with a € 50 creditnota against it has NOT been withdrawn:
 * € 450 is still owed, still due, and still has to be chased. Treating any credit as a withdrawal
 * would have meant that the moment an owner credited a single disputed line, the app stopped
 * asking for the rest — quietly, on an invoice that stays 'sent' with its full total. The owner
 * would simply never be paid, and nothing on any screen would say why.
 *
 * @param fullyCreditedIds ids of invoices whose creditnotas together cover the WHOLE invoice.
 *                         Build it with fullyCreditedIdsFrom, never from the credit rows alone —
 *                         a credit row does not know how big the invoice it credits is.
 */
export function isOpenReceivable(
  row: CreditableInvoiceRow,
  fullyCreditedIds: ReadonlySet<string>
): boolean {
  if (isCreditnota(row)) return false;
  return !fullyCreditedIds.has(row.id);
}

/** Keep only the rows that are genuinely still owed. Order preserved. */
export function filterOpenReceivables<T extends CreditableInvoiceRow>(
  rows: readonly T[],
  creditedIds: ReadonlySet<string>
): T[] {
  return rows.filter((r) => isOpenReceivable(r, creditedIds));
}

/** A creditnota row, as the coverage rule reads it. */
export interface CreditnotaRow {
  original_invoice_id?: string | null;
  total_inc_btw?: number | null;
}

/**
 * [DEEL-CREDIT] How much has been credited against each invoice, incl. btw, as a POSITIVE amount.
 *
 * Magnitudes, because a creditnota is stored negative ([CREDIT-SIGN]) and the question here is
 * "how much came back", not "in which direction". Several credits against one invoice add up —
 * that is the case this map exists for.
 */
export function creditedTotalsFrom(
  creditnotaRows: readonly CreditnotaRow[] | null | undefined
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of creditnotaRows ?? []) {
    const id = r?.original_invoice_id;
    if (!id) continue;
    const amount = Math.abs(Number(r?.total_inc_btw) || 0);
    out.set(id, (out.get(id) ?? 0) + amount);
  }
  return out;
}

/**
 * [CREDIT-BEWIJS] One credit, as the owner would recognise it: its number, its date, its amount.
 *
 * creditedTotalsFrom answers "how much came back" and nothing else, which is all the arithmetic
 * needs and less than the screen needs. "Deels gecrediteerd · € 250" is a conclusion the owner can
 * only check by finding the credit notes themselves — and a credit note is a document they SENT,
 * with a number on it. Naming them costs one more column in a query that was already running.
 */
export interface CreditDetail {
  /** The creditnota's own number. Null only for a draft that never got one (Art. 35). */
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** What this credit gave back, as a positive amount. */
  amount: number;
}

/** The credits per invoice, newest first — the same rows creditedTotalsFrom adds up. */
export function creditDetailsFrom(
  creditnotaRows: readonly (CreditnotaRow & { invoice_number?: string | null; invoice_date?: string | null })[] | null | undefined
): Map<string, CreditDetail[]> {
  const out = new Map<string, CreditDetail[]>();
  for (const r of creditnotaRows ?? []) {
    const id = r?.original_invoice_id;
    if (!id) continue;
    const amount = magnitude(r?.total_inc_btw);
    if (amount <= EPSILON) continue;
    const list = out.get(id) ?? [];
    list.push({
      invoiceNumber: r.invoice_number ?? null,
      invoiceDate: r.invoice_date ?? null,
      amount: round2(amount),
    });
    out.set(id, list);
  }
  // Newest first: the credit the owner is most likely to be looking for is the last one they sent.
  // A row without a date sorts last rather than jumping the queue on an empty string.
  for (const list of out.values()) {
    list.sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));
  }
  return out;
}

/** Half a cent — the same margin the rest of the app uses for "this amount is settled". */
const EPSILON = 0.005;

/**
 * [DEEL-CREDIT] The ids of invoices that have been credited IN FULL.
 *
 * Needs both sides, and that is not an inconvenience but the fact itself: a credit row carries
 * what it gives back, and only the invoice knows how much there was to give. The old version took
 * the credit rows alone and called any of them a withdrawal — correct while a credit could only
 * ever be the whole invoice, and wrong the moment it could be a part.
 *
 * An invoice with no total (never seen in practice, but a null column is always possible) counts
 * as fully credited once anything at all is credited against it: with nothing to compare to, the
 * safe answer is to stop chasing rather than to keep demanding money on an unknown balance.
 */
export function fullyCreditedIdsFrom(
  creditnotaRows: readonly CreditnotaRow[] | null | undefined,
  originals: readonly CreditableInvoiceRow[] | null | undefined
): Set<string> {
  const credited = creditedTotalsFrom(creditnotaRows);
  const out = new Set<string>();
  for (const row of originals ?? []) {
    const gecrediteerd = credited.get(row.id);
    if (!gecrediteerd) continue;
    const totaal = Math.abs(Number(row.total_inc_btw) || 0);
    if (totaal === 0 || gecrediteerd + EPSILON >= totaal) out.add(row.id);
  }
  return out;
}

/**
 * A money column as a usable magnitude. A non-finite value is worth nothing, never Infinity.
 *
 * The guard earns its place on the CREDITED side, not on the total: `round2` already answers 0 for
 * a non-finite result, so an unusable total lands on 0 either way. A corrupt credit does not —
 * Postgres `numeric` accepts 'Infinity', so one bad creditnota row reaches this function through
 * creditedTotalsFrom, and `500 − 0 − Infinity` is negative, which this file reads as "settled".
 * A € 500 invoice would stop being claimed, stop being dunned and stop being counted, on the
 * strength of a single corrupt column. Ignoring the unusable credit keeps the claim alive, which
 * is the fail-closed direction for money that is owed.
 */
function magnitude(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/**
 * What is still owed on one invoice: the total, minus what was paid, minus what was credited.
 *
 * This is the amount a reminder must name. Naming the full total on a partly credited invoice
 * asks the customer for money that was given back in writing — the fastest way to lose the trust
 * the reminder needs to work at all.
 *
 * [DEEL-CREDIT] It is now also the amount every SCREEN names: `outstandingAmount` in
 * sales-overview.ts delegates here rather than keeping a second spelling of the same arithmetic,
 * because the two spellings had already drifted — the e-mail asked for € 450 while the owner's own
 * "openstaand" and the accountant's debiteurenlijst both still said € 500.
 */
export function openAfterCredit(
  totalIncBtw: number | null | undefined,
  amountPaid: number | null | undefined,
  creditedAmount: number
): number {
  const totaal = magnitude(totalIncBtw);
  const betaaldRaw = Number(amountPaid);
  const betaald = Number.isFinite(betaaldRaw) && betaaldRaw > 0 ? betaaldRaw : 0;
  const gecrediteerd = magnitude(creditedAmount);
  const rest = totaal - betaald - gecrediteerd;
  if (rest <= 0) return 0;
  return round2(rest);
}

/**
 * [CREDIT-SIGN] Which way the MONEY moves for this document — not which way the document points.
 *
 * The invoices table has one `direction` column and it describes the DOCUMENT: who issued it. For
 * an ordinary invoice that is also the direction of the money, so the two were treated as the same
 * thing everywhere. On a creditnota they are opposites:
 *
 *     outgoing factuur     the owner issued it   → money comes IN
 *     outgoing creditnota  the owner issued it   → money goes OUT   (a refund to the customer)
 *     incoming factuur     a supplier issued it  → money goes OUT
 *     incoming creditnota  a supplier issued it  → money comes IN
 *
 * The evidence line under "Betaald" got this wrong for exactly the two credit cases: a refund the
 * owner paid out rendered as "€ 500,00 bijgeschreven … van Kiwi Food Market" while the bank line
 * beside it read −500. Money leaving, described as money arriving, on the one line on that screen
 * that exists to be believed.
 *
 * A creditnota is recognised by its type OR by a negative total — the same pair the screens use,
 * because a row can carry the sign before anyone has set the type (an AI read, an import).
 */
export function moneyDirection(row: {
  direction?: string | null;
  invoice_type?: string | null;
  total_inc_btw?: number | null;
}): ProofDirection {
  const documentIsOutgoing = (row.direction ?? "outgoing") !== "incoming";
  const credit = isCreditnota(row as CreditableInvoiceRow) || (Number(row.total_inc_btw) || 0) < 0;
  // XOR: a creditnota reverses the flow its document direction implies.
  return documentIsOutgoing === credit ? "incoming" : "outgoing";
}

/**
 * [CREDITNOTA-NO-CHASE]/[DEEL-CREDIT] How much has been credited back on ONE invoice — the
 * shared read behind every public payment surface. Fail CLOSED: a lookup that errors returns
 * null and the caller must hide/refuse, because the failure mode on the other side is a real
 * customer transferring money that is no longer owed. Answers an AMOUNT, not yes/no: a partial
 * credit leaves a remainder that is genuinely still owed.
 *
 * Lives here (not in a route file) so /api/pay/[token] and the iDEAL flow can never drift
 * apart about what "credited" means for the same invoice.
 */
export async function creditedOnInvoice(
  pipeline: {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  },
  invoiceId: string,
): Promise<number | null> {
  const { data, error } = await pipeline
    .from("invoices")
    .select("total_inc_btw")
    .eq("original_invoice_id", invoiceId)
    .eq("invoice_type", "creditnota");
  if (error) return null;
  return (
    creditedTotalsFrom(
      ((data ?? []) as { total_inc_btw: number | null }[]).map((r) => ({
        original_invoice_id: invoiceId,
        total_inc_btw: r.total_inc_btw,
      })),
    ).get(invoiceId) ?? 0
  );
}

// ── [CREDIT-TERUG] The creditnota the owner still has to REFUND ─────────────────────────────
//
// A creditnota is money the owner OWES ([CREDIT-SIGN]), and no screen said so: Vandaag listed
// what to pay and what to chase, and a credit note sat in neither. Whether money has to go back
// depends on the invoice it corrects: a credit against an UNPAID invoice cancels the claim and
// nothing moves; a credit against a PAID invoice is money to send back; a credit against a partly
// paid invoice first uses up what was still open, and only the rest goes back. Several credits
// against one invoice use that open remainder in order, oldest first. A standalone creditnota (an
// invoice issued outside BoekBrug, [CREDITNOTA-EXTERN]) has no invoice to look at here, so its
// whole amount is listed and flagged for the owner to judge. Recording the refund is marking the
// creditnota 'paid' on the sales list ("Voldaan!"), which takes it off this list.

/** A creditnota row, as the refund rule reads it. */
export interface RefundCreditnotaRow {
  id: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  client_name?: string | null;
  status?: string | null;
  total_inc_btw?: number | null;
  original_invoice_id?: string | null;
}

/** The corrected invoice, as much of it as the rule needs. */
export interface RefundOriginalRow {
  total_inc_btw?: number | null;
  amount_paid?: number | null;
}

export interface RefundableCredit {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  clientName: string | null;
  /** What still has to go back to the customer, as a positive amount. */
  amount: number;
  /** No invoice to compare with (outside BoekBrug, or not readable): the whole credit is listed. */
  standalone: boolean;
}

/** A creditnota that has not been settled: 'paid' on a creditnota is the refund, recorded. */
const OPEN_CREDIT_STATUSES: ReadonlySet<string> = new Set(["sent", "overdue"]);

/**
 * The creditnotas that still owe the customer money, oldest first, with the amount each one owes.
 *
 * @param creditnotas the owner's outgoing creditnotas (any status; settled ones are skipped here)
 * @param originals   the corrected invoices by id — total and what the customer had paid
 */
export function refundableCreditnotas(
  creditnotas: readonly RefundCreditnotaRow[] | null | undefined,
  originals: ReadonlyMap<string, RefundOriginalRow>
): RefundableCredit[] {
  const open = (creditnotas ?? [])
    .filter((c) => OPEN_CREDIT_STATUSES.has(c.status ?? "") && magnitude(c.total_inc_btw) > EPSILON)
    .slice()
    .sort((a, b) => (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "") || a.id.localeCompare(b.id));

  // What was still open on each corrected invoice BEFORE its credits: total minus paid. Every
  // credit against that invoice draws on this first; what a credit cannot draw goes back.
  const remainingOpen = new Map<string, number>();
  const out: RefundableCredit[] = [];
  for (const c of open) {
    const amount = magnitude(c.total_inc_btw);
    const originalId = c.original_invoice_id ?? null;
    const original = originalId ? originals.get(originalId) : undefined;
    if (!originalId || !original) {
      out.push({
        id: c.id, invoiceNumber: c.invoice_number ?? null, invoiceDate: c.invoice_date ?? null,
        clientName: c.client_name ?? null, amount: round2(amount), standalone: true,
      });
      continue;
    }
    const rest = remainingOpen.get(originalId) ?? openAfterCredit(original.total_inc_btw, original.amount_paid, 0);
    const refund = amount - rest;
    remainingOpen.set(originalId, Math.max(0, rest - amount));
    if (refund <= EPSILON) continue;
    out.push({
      id: c.id, invoiceNumber: c.invoice_number ?? null, invoiceDate: c.invoice_date ?? null,
      clientName: c.client_name ?? null, amount: round2(refund), standalone: false,
    });
  }
  return out;
}
