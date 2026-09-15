// src/lib/bad-debt.ts
// [BAD-DEBT] Artikel 29 Wet OB, both directions. Pure detectors; no I/O.
// Run: npx tsx src/lib/bad-debt.test.ts
//
//   lid 1 (detectBadDebt)     — a SALES invoice your customer never paid: the BTW you declared on
//                               it comes BACK to you. Money to get.
//   lid 7 (detectVatClawback) — a PURCHASE invoice you never paid: the voorbelasting you deducted
//                               goes BACK to the Belastingdienst. Money to give.
//
// They are the same rule read from two sides, so they live in one module and share the clock, the
// creditnota reversal logic and the kasstelsel guard. Only the second one is a liability, and that
// is the one an entrepreneur never hears about until the naheffing arrives.
//
// Dutch rule (Art. 29 Wet OB, sinds 2017): a receivable is presumed uncollectible ONE YEAR after
// its payment due date if still unpaid. The BTW you earlier declared + paid on that invoice may
// then be reclaimed (a reduction of de verschuldigde BTW). This module DETECTS eligible invoices
// and totals the reclaimable BTW — it never books it: whether a debt is truly uncollectible, and
// in which period to reclaim, is the owner's/accountant's call (and if the customer later pays,
// the BTW must be re-declared). So this is an honest FLAG, never an automatic figure.
//
// Applies ONLY to factuurstelsel: under kasstelsel BTW is due on payment, so an unpaid invoice
// never had its BTW declared — there is nothing to reclaim.

import type { VatScheme } from "./vat-scheme";
// [DEEL-CREDIT] "How much has been credited against this invoice" has one definition — see below
// for why this module could no longer answer it with a yes or a no.
import { creditedTotalsFrom } from "./credited-invoices";

export interface BadDebtInput {
  id: string | null;            // row id — to spot an original that has since been credited
  invoiceNumber: string | null;
  clientName: string | null;
  direction: "incoming" | "outgoing" | null;
  status: string | null;
  invoiceType: string | null;   // 'creditnota' rows are reversals, never a receivable
  originalInvoiceId: string | null; // on a creditnota: the invoice it reverses
  invoiceDate: string | null;   // ISO
  dueDate: string | null;       // ISO
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
  amountPaid: number | null;    // magnitude already settled
}

export interface BadDebtInvoice {
  invoiceNumber: string | null;
  clientName: string | null;
  dueDate: string;              // the (effective) due date that started the 1-year clock
  unpaidEx: number;             // ex-BTW of the still-unpaid portion
  reclaimableBtw: number;       // BTW on the unpaid portion — the amount you can reclaim
}

export interface BadDebtResult {
  eligible: BadDebtInvoice[];
  totalReclaimableBtw: number;  // Σ reclaimableBtw (unrounded)
  usedInvoiceDateFallback: boolean; // true if any invoice had no due_date (clock ran from invoice date)
}

// A verified outgoing sale whose BTW WAS declared (not a draft/processing/paid row).
const DECLARED_OUTGOING = new Set(["sent", "overdue"]);

/** The gross of one row, incl. btw, from whichever columns it carries. */
function grossOf(i: BadDebtInput): number {
  return i.totalIncBtw != null
    ? Number(i.totalIncBtw)
    : (Number(i.totalExBtw) || 0) + (Number(i.btwAmount) || 0);
}

/**
 * [DEEL-CREDIT] How much has been credited against each original, incl. btw, as a positive amount.
 *
 * ── WHY THIS REPLACED A Set<string> ──
 *
 * Both detectors below used to build `creditedOriginalIds` and skip any invoice that appeared in
 * it, on the reasoning — written into the comment there — that "a creditnota FULLY reverses its
 * original". That was true of every creditnota this app could make, right up until
 * creditnota_partial.sql made a credit for one disputed LINE possible. After that, one € 121
 * credit on a € 1.210 invoice switched the whole rule off, and it did so on both sides:
 *
 *   lid 1, the money to GET: the customer never paid the remaining € 1.089, a year passed, and the
 *     owner may reclaim the BTW on it. Measured: € 189 reclaimable, € 0 reported. Silently — a
 *     reclaim that is never offered is never missed.
 *
 *   lid 7, the money to GIVE: the same shape on a purchase invoice removed the warning entirely.
 *     That is the worse half, and this module's own header says why: it is "the only art. 29 side
 *     that costs money", the one "an entrepreneur never hears about until the naheffing arrives".
 *     A single partial supplier credit turned the alarm off.
 *
 * The credited portion needs no reclaim and no repayment of its own: the creditnota carries
 * NEGATIVE btw and was declared in its own period, so that BTW is already back where it belongs.
 * What is left is exactly the unpaid remainder, which is what the fraction below now measures.
 */
function creditedByOriginal(invoices: readonly BadDebtInput[]): Map<string, number> {
  return creditedTotalsFrom(
    invoices
      .filter((i) => i.invoiceType === "creditnota")
      .map((i) => ({ original_invoice_id: i.originalInvoiceId, total_inc_btw: grossOf(i) })),
  );
}

/**
 * The share of an invoice that is still unpaid AND still owed — after instalments and after
 * credits. 0 when nothing is left, which is how a fully credited invoice keeps dropping out of
 * both detectors exactly as it did before partial credits existed.
 */
function openFraction(i: BadDebtInput, gross: number, credited: ReadonlyMap<string, number>): number {
  const paid = Math.max(0, Number(i.amountPaid) || 0);
  const gecrediteerd = i.id != null ? (credited.get(String(i.id)) ?? 0) : 0;
  return Math.max(0, Math.min(1, (gross - paid - gecrediteerd) / gross));
}

/** ISO 'YYYY-MM-DD' + 1 calendar year (Feb 29 → Mar 1, acceptable). Returns "" on bad input. */
export function oneYearLater(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

/**
 * Detect sales invoices whose BTW is reclaimable as a bad debt as of `asOf` (ISO date — a period
 * end or today). Pure. Under kasstelsel returns nothing. An invoice qualifies when it is an
 * outgoing sale that was declared (status sent/overdue), is not fully paid, and its due date (or,
 * if absent, its invoice date) is more than one year before `asOf`. The reclaimable amount is the
 * BTW on the UNPAID portion only (a partly-paid invoice reclaims only the remainder's BTW).
 */
export function detectBadDebt(args: {
  scheme: VatScheme;
  asOf: string;
  invoices: BadDebtInput[];
}): BadDebtResult {
  if (args.scheme === "kas") {
    return { eligible: [], totalReclaimableBtw: 0, usedInvoiceDateFallback: false };
  }
  const asOf = args.asOf.slice(0, 10);
  const eligible: BadDebtInvoice[] = [];
  let usedInvoiceDateFallback = false;

  // [DEEL-CREDIT] A creditnota reduces what is still owed, and since partial credits exist it may
  // reduce it by a PART. What it takes away needs no reclaim (its own negative BTW already put
  // that back); what is left over is a bad debt like any other. See creditedByOriginal.
  const credited = creditedByOriginal(args.invoices);

  for (const i of args.invoices) {
    if (i.direction !== "outgoing") continue;
    if (i.invoiceType === "creditnota") continue;      // a creditnota is a reversal, not a receivable
    if (!DECLARED_OUTGOING.has(i.status ?? "")) continue; // draft/processing = not declared; paid = collected

    const inc = grossOf(i);
    if (!(inc > 0)) continue;                          // a €0 / negative (credit) line is not a bad debt
    // Fully paid, fully credited, or the two together → nothing to reclaim.
    const unpaidFraction = openFraction(i, inc, credited);
    if (unpaidFraction <= 0) continue;

    const clockStart = i.dueDate ?? i.invoiceDate;     // rule runs from the due date; fall back to invoice date
    if (!clockStart) continue;                          // no date at all → can't age it
    if (!i.dueDate) usedInvoiceDateFallback = true;
    const oneYear = oneYearLater(clockStart);
    if (!oneYear || oneYear > asOf) continue;           // not yet 1 year past due → not eligible

    const reclaimableBtw = (Number(i.btwAmount) || 0) * unpaidFraction;
    if (reclaimableBtw < 0.005) continue;               // no positive BTW to reclaim (0%-sale / sign glitch)
    eligible.push({
      invoiceNumber: i.invoiceNumber,
      clientName: i.clientName,
      dueDate: clockStart.slice(0, 10),
      unpaidEx: (Number(i.totalExBtw) || 0) * unpaidFraction,
      reclaimableBtw,
    });
  }

  const totalReclaimableBtw = eligible.reduce((s, e) => s + e.reclaimableBtw, 0);
  return { eligible, totalReclaimableBtw, usedInvoiceDateFallback };
}

// Below this the reclaimable BTW rounds to €0 on every surface — flagging "1 factuur, €0 terugvraagbaar"
// reads as noise/contradiction, so we don't surface an immaterial sub-euro reclaim as a bad debt.
export const BAD_DEBT_MIN_EUR = 0.5;

/** An honest Dutch note for the concept aangifte / accountant, or null when nothing (material) is eligible. */
export function badDebtNote(r: BadDebtResult): string | null {
  if (r.eligible.length === 0 || r.totalReclaimableBtw < BAD_DEBT_MIN_EUR) return null;
  const n = r.eligible.length;
  const eur = `€${Math.round(r.totalReclaimableBtw).toLocaleString("nl-NL")}`;
  const labels = r.eligible.slice(0, 5).map((e) => e.invoiceNumber ?? "?").filter(Boolean).join(", ");
  const more = n > 5 ? ` (+${n - 5} meer)` : "";
  return (
    `Oninbare vordering: ${n === 1 ? "1 verkoopfactuur is" : `${n} verkoopfacturen zijn`} meer dan een jaar ` +
    `na de vervaldatum nog onbetaald. Je hebt hierover ${eur} BTW afgedragen die je kunt terugvragen ` +
    `(art. 29 Wet OB)${labels ? ` — bijv. ${labels}${more}` : ""}. Dit wordt NIET automatisch verrekend; ` +
    "bespreek met je boekhouder in welk tijdvak je het terugvraagt (en dien te corrigeren als de klant alsnog betaalt)."
  );
}

// ── Art. 29 lid 7 — de andere kant: voorbelasting die je moet TERUGBETALEN ────────────────────
//
// Mirror of the rule above. If YOU have not paid a supplier within one year of the due date, the
// BTW you deducted on that invoice becomes payable again (art. 29 lid 7 Wet OB) — it is corrected
// in the aangifte of the period in which that year elapses. Miss it and it does not stay missed:
// it surfaces as a naheffing with belastingrente, years later, on an invoice nobody remembers.
//
// This is the only art. 29 side that costs money, so it is also the only one the app must raise
// on its own. It still never books anything: the app knows the invoice is unpaid IN ITS OWN
// RECORDS, which is not the same as unpaid in the world (a bank account that was never linked,
// cash over the counter, a payment arrangement). So it reports, names the invoices, and says what
// resolves it either way — pay/record it, or put the BTW back.

/** A purchase invoice whose deducted voorbelasting has become repayable. */
export interface VatClawbackInvoice {
  invoiceNumber: string | null;
  supplierName: string | null;
  dueDate: string;              // the (effective) due date that started the 1-year clock
  unpaidEx: number;             // ex-BTW of the still-unpaid portion
  repayableBtw: number;         // voorbelasting on the unpaid portion — what goes back
}

export interface VatClawbackResult {
  eligible: VatClawbackInvoice[];
  totalRepayableBtw: number;        // Σ repayableBtw (unrounded)
  usedInvoiceDateFallback: boolean; // true if any invoice had no due_date (clock ran from invoice date)
}

// The purchase statuses whose voorbelasting the app ACTUALLY put in 5b. Deliberately identical to
// financial-result's INCOMING_OK minus 'paid': you can only claw back what was deducted, and a
// paid invoice has nothing to claw back. A row the ledger never counted (processing, unclear,
// archived) is not clawed back either — the app must not demand money back on a deduction it
// never took.
const DEDUCTED_INCOMING = new Set(["received"]);

const EMPTY_CLAWBACK: VatClawbackResult = { eligible: [], totalRepayableBtw: 0, usedInvoiceDateFallback: false };

/**
 * Detect purchase invoices whose deducted voorbelasting has become repayable as of `asOf`.
 * Pure. Returns nothing under KOR (no voorbelasting is deducted at all — without this guard a
 * KOR shop would be told to repay BTW it never claimed).
 *
 * [KAS-VOORBELASTING] It no longer returns nothing under the kasstelsel. The old premise — "you
 * deduct on payment, so an unpaid purchase never got a deduction" — was the same misreading the
 * engine carried: the kasstelsel moves the btw you OWE to the payment date and leaves the
 * DEDUCTION on the invoice date. A kas owner therefore deducts on an unpaid purchase like anyone
 * else, and art. 29 lid 7 falls due on it like anyone else's. `scheme` stays in the arguments
 * because the sales side (detectBadDebt) still turns on it, and because a caller that resolves it
 * for one side of art. 29 and not the other is exactly the asymmetry this file exists to prevent.
 */
export function detectVatClawback(args: {
  scheme: VatScheme;
  asOf: string;
  korActive?: boolean;
  invoices: BadDebtInput[];
}): VatClawbackResult {
  if (args.korActive === true) return EMPTY_CLAWBACK;
  const asOf = args.asOf.slice(0, 10);
  const eligible: VatClawbackInvoice[] = [];
  let usedInvoiceDateFallback = false;

  // [DEEL-CREDIT] A supplier creditnota reverses the deduction on the part it covers, so demanding
  // THAT back would be a correction the owner does not owe. It says nothing about the rest, and
  // the rest is where the liability lives: a partial credit used to silence this warning entirely.
  // This only fires where the link exists — an unlinked supplier creditnota cannot be matched,
  // which is why the note tells the owner to check rather than presenting a figure to copy.
  const credited = creditedByOriginal(args.invoices);

  for (const i of args.invoices) {
    if (i.direction !== "incoming") continue;
    if (i.invoiceType === "creditnota") continue;      // a creditnota is a reversal, not a debt
    if (!DEDUCTED_INCOMING.has(i.status ?? "")) continue;

    const inc = grossOf(i);
    if (!(inc > 0)) continue;
    // Fully paid or fully credited → the deduction stands and nothing goes back.
    const unpaidFraction = openFraction(i, inc, credited);
    if (unpaidFraction <= 0) continue;

    const clockStart = i.dueDate ?? i.invoiceDate;
    if (!clockStart) continue;
    if (!i.dueDate) usedInvoiceDateFallback = true;
    const oneYear = oneYearLater(clockStart);
    if (!oneYear || oneYear > asOf) continue;          // not yet a year overdue

    // A 0%-purchase or a verlegde-BTW line carries no deducted BTW of its own, so it drops out
    // here without a special case — there is nothing to give back.
    const repayableBtw = (Number(i.btwAmount) || 0) * unpaidFraction;
    if (repayableBtw < 0.005) continue;
    eligible.push({
      invoiceNumber: i.invoiceNumber,
      supplierName: i.clientName,
      dueDate: clockStart.slice(0, 10),
      unpaidEx: (Number(i.totalExBtw) || 0) * unpaidFraction,
      repayableBtw,
    });
  }

  const totalRepayableBtw = eligible.reduce((s, e) => s + e.repayableBtw, 0);
  return { eligible, totalRepayableBtw, usedInvoiceDateFallback };
}

/**
 * An honest Dutch note for the concept aangifte / the accountant, or null when nothing (material)
 * is repayable. Shares the materiality floor with the sales side: below it the figure rounds to
 * €0 on every surface, and "1 factuur, €0 terug te betalen" is noise.
 */
export function vatClawbackNote(r: VatClawbackResult): string | null {
  if (r.eligible.length === 0 || r.totalRepayableBtw < BAD_DEBT_MIN_EUR) return null;
  const n = r.eligible.length;
  const eur = `€${Math.round(r.totalRepayableBtw).toLocaleString("nl-NL")}`;
  const labels = r.eligible.slice(0, 5).map((e) => e.invoiceNumber ?? "?").filter(Boolean).join(", ");
  const more = n > 5 ? ` (+${n - 5} meer)` : "";
  return (
    `LET OP — terug te betalen voorbelasting: ${n === 1 ? "1 inkoopfactuur staat" : `${n} inkoopfacturen staan`} ` +
    `meer dan een jaar na de vervaldatum open in je administratie. De BTW die je hierover in aftrek bracht ` +
    `(${eur}) wordt dan weer verschuldigd (art. 29 lid 7 Wet OB)${labels ? ` — bijv. ${labels}${more}` : ""}. ` +
    "Heb je ze wél betaald, koppel dan de betaling of zet ze op betaald; is dat niet zo, dan hoort dit bedrag " +
    "terug in je aangifte. Dit wordt NIET automatisch verrekend — bespreek het tijdvak met je boekhouder."
  );
}
