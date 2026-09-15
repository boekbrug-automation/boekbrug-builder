// src/lib/financial-result.ts
// [RESULT] Phase 3 — the true quarterly result across ALL channels: sales invoices,
// purchase invoices/receipts, owner-categorized bank lines, and the cash book. Pure,
// fully testable (run: npx tsx src/lib/financial-result.test.ts).
//
// The whole point is HONESTY, so double-counting is the enemy. The de-dup rules:
//   - A bank line with invoice_id set is the PAYMENT of an invoice already counted →
//     excluded. (Reconciliation, not a second cost/revenue.)
//   - A bank line with no confirmed category is NOT guessed into a money total.
//   - Transfers / prive / tax / fee never touch revenue or cost.
//
// BTW stays documented: verschuldigde BTW from sales invoices + cash sales where the
// owner set a rate; voorbelasting ONLY from purchase invoices/receipts (a bare bank or
// cash line has no valid BTW document, so none is claimed). Cash sales recorded without
// a rate are surfaced separately (cashOmzetZonderBtw) rather than silently guessed.

import { pnlRole } from "./bank-categories";
import { taxLetterBooking, effectiveTaxKind, type TaxKind } from "./tax-letter";
// [OFFERTE-GEEN-OMZET] One answer to "is this a quote", shared with the follow-up engine.
import { isQuote } from "./offerte-followup";
import { turnoverNetOmzet, turnoverBtw, parsePosSettlement, SETTLE_LAG_DAYS, type DailyTurnover } from "./turnover";
import { nearestLegalRate } from "./btw-rate";
import { isPosPayoutDescription } from "./bank-identity";
import { computeSettlementSlices, type SettlementEvent, type PriorSettled } from "./kas-payment-events";
import type { VatScheme } from "./vat-scheme";
// [RUBRIEK-SPLIT] Omzet per BTW rate from the invoice's own lines — see btw-rate-split.ts.
import { splitSliceByShares, type RateShare } from "./btw-rate-split";
// [VRIJGESTELD] Exempt turnover carries no BTW and no right to deduct — see vat-exemption.ts.
import {
  computeProRata,
  deductibleVoorbelasting,
  getVatDeduction,
  clampExemptPortion,
  type ProRata,
} from "./vat-exemption";
import { round2 } from "./invoice-totals";
// [TEGENTEKEN] The one sign question the credit checks do not ask: base against BTW, inside one
// document. See that function for why it reports rather than repairs.
import { btwSignOpposesBase } from "./creditnota-signal";

// [KASSTELSEL] Optional cash-basis inputs. When scheme==='kas', the invoice leg books the
// quarter's SETTLEMENT slices (BTW on the paid date) instead of the full invoice on its
// invoice-date; the caller supplies the quarter's events + the unrounded prior-quarter
// cumulative. Absent/factuur → the accrual path runs byte-identical (default).
export interface ComputeOpts {
  scheme?: VatScheme;
  settlements?: SettlementEvent[];
  priorByInvoice?: Map<string, PriorSettled>;
  // [RUBRIEK-SPLIT] Per invoice: its omzet per BTW rate, for the mixed-rate sales invoices whose
  // header cannot express it. Under kasstelsel each payment then books a proportional share of
  // every rate instead of one blended one. Absent → the header-derived rate, as before.
  rateSharesByInvoice?: Map<string, RateShare[]>;
  // [VRIJGESTELD] Does the exempt regime apply to THIS quarter? The caller resolves it with
  // resolveExemptionForQuarter(profile.vat_exempt_activity, profile.vat_exempt_since, quarterStart)
  // so a declaration made today never rewrites a quarter that was filed under the old regime.
  //
  // Absent/false — the default for every owner — is the untouched path: no turnover is withheld
  // from the rubrieken, every cost's input BTW lands in one bucket and is deducted in full, and
  // this whole feature costs exactly one boolean check.
  exemptRegime?: boolean;
  // [VRIJGESTELD · KASSTELSEL] Per invoice: the FRACTION (0–1) of its ex-BTW total that is
  // exempt. Only the cash-basis branch needs it, because there an invoice is booked through its
  // payments and never as a whole — each settlement slice carries the same proportion of exempt
  // turnover as the invoice it settles. The accrual branch reads ResultInvoice.exempt_ex instead
  // (an absolute amount), exactly as rate_lines / rateSharesByInvoice already split per rate.
  exemptShareByInvoice?: Map<string, number>;
  // [VRIJGESTELD · KASSTELSEL] Per PURCHASE invoice: its vat_deduction. Same reason as above —
  // a settlement slice knows its invoice id but carries none of the invoice's own columns, so
  // without this map every cash-basis cost would fall back to 'mixed' and an owner who
  // carefully attributed their costs would see the ratio applied to all of them anyway.
  deductionByInvoice?: Map<string, string | null>;
  // [BEDRIJFSMIDDEL] Purchase invoices the owner registered as a bedrijfsmiddel. Their ex-btw
  // amount is NOT a cost of the period it is dated in: it is an investment, reported apart, and
  // reaches the result only as depreciation. Their btw is deducted exactly as before — the
  // register changes the income-tax picture, never the btw-aangifte. Keyed by invoice id because
  // under kasstelsel the cost leg sees settlement slices, which carry only the id (see
  // deductionByInvoice above for the same argument).
  assetInvoiceIds?: ReadonlySet<string>;
  // [BEDRIJFSMIDDEL] Σ depreciation of every registered asset that falls in the window, euros,
  // computed by the caller with depreciation.ts. Added to kosten as its own named line.
  afschrijvingen?: number;
  // [BEDRIJFSMIDDEL] TRUE when the register could not be read. The figures then fall back to the
  // pre-register treatment (every purchase a cost, no depreciation) — which is the honest
  // fallback and also the one that must be SAID, so the year screen can say it.
  assetsUnreadable?: boolean;
  // [AANSLAG] Per PURCHASE invoice: the tax kind of a Belastingdienst letter (tax-letter.ts). Under
  // kasstelsel the cost leg sees settlement slices, which carry only the id — same argument as
  // deductionByInvoice. Only rows that ARE a tax letter need an entry.
  taxKindByInvoice?: ReadonlyMap<string, TaxKind>;
}

export interface ResultInvoice {
  // [AANSLAG] A Belastingdienst letter is never a cost (tax-letter.ts). Both optional: a caller
  // that omits them books the row as before, and the name alone already withholds the row.
  tax_kind?: string | null;
  client_name?: string | null;
  // [BEDRIJFSMIDDEL] The row's id, so the engine can tell an asset purchase from a cost. OPTIONAL
  // for the same reason invoice_type is: a caller that omits it books the row as a cost, exactly
  // as before the register existed. compute-result-range passes it; the year screen depends on it.
  id?: string | null;
  direction: "outgoing" | "incoming" | null;
  status: string | null;
  // [OFFERTE-GEEN-OMZET] 'factuur' | 'creditnota' | 'pro_forma' | 'offerte'.
  //
  // This field did not exist here, and its absence was the defect: a quote e-mailed to a customer
  // is stored as invoice_type 'pro_forma' with direction 'outgoing', status 'sent' and its real
  // totals, so it satisfied the direction+status test below and was booked as omzet with
  // verschuldigde BTW. The engine could not even see the type to refuse it.
  //
  // OPTIONAL, and that is a deliberate risk: a caller whose SELECT omits the column passes
  // `undefined`, which is not a quote, and the row books as before. The four callers all pass it
  // and a gate holds them there — but the honest reading is that the column has to be SELECTED,
  // and forgetting it fails open. See isQuote in offerte-followup.ts.
  invoice_type?: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  // [RUBRIEK-SPLIT] The invoice's omzet per BTW rate, when its lines say more than its header
  // can. Only for SALES: the aangifte splits omzet across rubriek 1a/1b/1c, and a header-derived
  // blend puts a mixed-rate invoice (21% materials + 9% labour) entirely in one of them. The
  // buckets are validated against the header before they get here (rateSharesFromLines), so
  // using them can only move omzet BETWEEN rubrieken, never change a total. Absent → the
  // header derivation below, unchanged, which is exact for a single-rate invoice.
  rate_lines?: RateShare[] | null;
  // [VRIJGESTELD] SALES: how much of total_ex_btw is exempt turnover (art. 11), summed from the
  // invoice's lines that carry vat_treatment='exempt'. It still counts as omzet — profit is
  // profit — but it belongs in NO aangifte rubriek, so it is withheld from the rate buckets
  // rather than landing in 1e as if it were a genuine 0%-sale. Absent/0 → nothing changes.
  exempt_ex?: number | null;
  // [VRIJGESTELD] PURCHASES: what this cost serves — 'direct_taxed' (deduct in full),
  // 'direct_exempt' (deduct nothing) or 'mixed'/absent (the pro-rata share). Read ONLY when
  // opts.exemptRegime is on; for everyone else every cost stays in the full-deduction bucket.
  vat_deduction?: string | null;
}
export interface ResultBankTx {
  amount: number | null;       // signed: + credit, − debit
  category: string | null;      // null = uncategorized (not counted)
  invoice_id: string | null;    // set = payment of an already-counted invoice
  // [TURNOVER] For a card/PSP settlement line: the takings day it settled (parsed DAT date,
  // or the booking date as a fallback). Used to exclude it on days the till already counted.
  settleDate?: string | null;
  // TRUE when this revenue credit is a card-acquirer / PSP SETTLEMENT — either an explicit
  // pos_income category, or a credit whose text matches a known acquirer even though the
  // owner (mis)categorised it as plain 'omzet'. Such a line's takings were already booked
  // once by the till on the settled day, so on a covered day it is a witness, never a second
  // helping of revenue. Set by toResultBankTx so all four surfaces de-dup identically.
  posSettlement?: boolean;
  // TRUE when settleDate is the REAL takings date parsed from the statement (DAT.),
  // FALSE/absent when it is only the booking date used as a fallback. When it is a
  // fallback, the true takings day is a day or two EARLIER (settlement lags takings),
  // so the covered-day check widens to a short backward window — never forward, so it
  // can never suppress (hide) revenue on a day that carries its own exact takings date.
  settleExact?: boolean;
  // [GENEGEERD-TELT] TRUE wanneer de eigenaar deze regel opzij zette met een reden die zegt dat het
  // geld niet in zijn boeken hoort (privé, dubbel, niet van mij). De engine slaat zo'n regel over:
  // hij is geen kost, geen omzet en geen voorbelasting. Gezet door toResultBankTx, zodat alle zes
  // de geldschermen dezelfde regel gebruiken en niet uit elkaar kunnen lopen — precies zoals de
  // pos-settlement-beslissing hierboven.
  excludedByOwner?: boolean;
}
export interface ResultCashEntry {
  direction: "in" | "out";
  amount: number | null;        // always positive
  category: string | null;
  btw_rate: number | null;      // a cash SALE the owner rated, OR a documented cash COST's rate
  date?: string | null;         // [TURNOVER] entry_date — for the covered-day check
  // [CASH-COST-VAT] The linked bon/receipt for a cash COST. Voorbelasting on a cash cost is
  // claimed ONLY when this is set AND a rate is present — the universal "no voorbelasting without
  // a document" rule. Absent → the cost books at full gross with €0 voorbelasting (never a
  // fabricated deduction). null/undefined for a sale (a rated sale needs no purchase document).
  document_id?: string | null;
}

/** The raw bank_transactions columns the result engine needs. */
export interface RawBankRow {
  amount: number | null;
  category: string | null;
  invoice_id: string | null;
  date: string | null;
  description: string | null;
  counterpart_name?: string | null; // banks often put the acquirer/PSP name here, not in description
  // [GENEGEERD-TELT] Het id, zodat een regel herkend kan worden in de verzameling die
  // readExcludedBankIds teruggeeft. OPTIONEEL, en de afwezigheid betekent "gewoon meetellen" —
  // niet "uitsluiten". Een select die dit vergeet houdt daarmee het gedrag van vóór deze regel,
  // wat een bekende fout is; de andere kant op zou hij stilzwijgend echte kosten uit de boeken
  // laten verdwijnen, en dat is een fout die niemand ooit terugvindt.
  id?: string | null;
}

/**
 * Map one raw bank_transactions row to a ResultBankTx, deciding whether it is a card/PSP
 * SETTLEMENT and, if so, the takings day it settled. THE single place that decision is made,
 * so all four money surfaces (result / aangifte / readiness / closing-package) de-dup card
 * takings identically and cannot drift.
 *
 * A line is a settlement when it is explicitly categorised pos_income, OR it is a CREDIT
 * whose text matches a known acquirer/PSP (isPosPayoutDescription) even though the owner
 * (mis)categorised it as plain 'omzet' — either way its takings were already booked once by
 * the till on the settled day. settleDate is the printed DAT. takings date when present, else
 * the booking date (settleExact=false → computeResult widens a short backward window only).
 */
export function toResultBankTx(b: RawBankRow, excludedIds?: ReadonlySet<string>): ResultBankTx {
  const amt = b.amount ?? 0;
  const posSettlement = b.category === "pos_income" || (amt >= 0 && isPosPayoutDescription(b.description, b.counterpart_name ?? null));
  const parsedTakings = posSettlement ? parsePosSettlement(b.description).date : null;
  // [GENEGEERD-TELT] De verzameling komt uit readExcludedBankIds, die de REDEN leest — alleen een
  // reden die over de AARD van het bedrag gaat sluit uit. Zie ignoredLineCountsInBooks voor waarom
  // 'geen_factuur' (huur, lease, abonnement) juist blijft tellen. Geen verzameling meegegeven, of
  // een rij zonder id: meetellen, precies zoals hiervoor.
  return {
    amount: b.amount,
    category: b.category,
    invoice_id: b.invoice_id,
    posSettlement,
    settleDate: posSettlement ? (parsedTakings ?? b.date) : null,
    settleExact: posSettlement ? parsedTakings != null : false,
    excludedByOwner: b.id != null && excludedIds != null && excludedIds.has(b.id),
  };
}

export interface FinancialResult {
  omzet: number;              // revenue, ex-BTW (net)
  kosten: number;             // costs, ex-BTW (net)
  resultaat: number;          // omzet − kosten
  btwVerschuldigd: number;    // BTW you owe (sales)
  btwVoorbelasting: number;   // BTW you reclaim (documented purchases)
  btwSaldo: number;           // verschuldigd − voorbelasting (what you pay/receive)
  cashOmzetZonderBtw: number; // cash sales recorded without a BTW rate — a nudge, not counted in BTW
  // Of cashOmzetZonderBtw, the portion from BANK revenue or an un-split till day (not plain
  // cash). > 0 → the rate split needs the Z-report → readiness points the fix at Dagomzet.
  omzetZonderBtwNonCash: number;
  // [TURNOVER] BTW verschuldigd from the till Z-report, split per rate for aangifte
  // rubriek 1a (21%) / 1b (9%). Turnover-only: invoice/cash BTW is NOT yet rate-split
  // here, so these do NOT sum to btwVerschuldigd — that scalar stays the authoritative
  // grand total across all sources.
  turnoverBtw9: number;
  turnoverBtw21: number;
  // [AANGIFTE] Verschuldigde BTW + omzet split per rate across ALL sales sources
  // (turnover + outgoing invoices + rated cash). Its BTW sums EXACTLY to btwVerschuldigd
  // (unrounded), so it is the single source for aangifte rubriek 1a (21%) / 1b (9%) /
  // 1e (0%) / 1c (other). Unrated cash sales are NOT bucketed here — see
  // cashOmzetZonderBtw — because we never guess a rate.
  salesByRate: SalesRateBucket[];
  // [VRIJGESTELD] Turnover classified as exempt (art. 11 Wet OB). Counted in `omzet` and in the
  // result, deliberately absent from salesByRate and therefore from every aangifte rubriek —
  // the same treatment cashOmzetZonderBtw gets: named, never silently bucketed. 0 for every
  // owner who has not declared exempt activity.
  vrijgesteldeOmzet: number;
  // The pro-rata deduction percentage applied to costs serving both activities, or null when
  // the regime is off (nothing to apportion) OR the ratio was undecidable. Those two nulls are
  // told apart by voorbelastingUnresolved: > 0 means undecidable and 5b is understated.
  proRataPercent: number | null;
  // Input BTW on mixed costs that was NOT deducted because the ratio could not be determined.
  // > 0 ⇒ btwVoorbelasting is deliberately too LOW and the notes must say so.
  voorbelastingUnresolved: number;
  // [TEGENTEKEN] Input BTW left out of 5b because the document contradicts itself: its base and
  // its BTW carry OPPOSITE signs, which no rate can produce. Reported as a MAGNITUDE — the one
  // thing about such a row that is not in doubt — because whether it belongs in 5b as a plus or a
  // minus is precisely what the row does not say. > 0 ⇒ 5b is deliberately too low.
  voorbelastingTegenteken: number;
  // Input BTW on costs attributed wholly to exempt activity — never deductible. Carried for
  // transparency only: an owner who sees €0 where they expected a refund deserves the figure
  // that explains it.
  voorbelastingGeblokkeerd: number;
  // [VRIJGESTELD] Turnover this feature CANNOT classify: the till Z-report (daily_turnover) and
  // rated cash sales carry no vat_treatment in this round. For an exempt owner it is therefore
  // counted as TAXED, which may be wrong — so it is measured rather than assumed away, and the
  // aangifte names the amount. 0 off-regime, and 0 for the invoice-only owner this feature is
  // really aimed at.
  onclassificeerbareOmzet: number;
  // Whether the exempt regime applied to this computation at all. Distinct from
  // proRataPercent !== null, which is also null when the regime IS on but the ratio was
  // undecidable — the two must not be conflated by a caller deciding what to tell the owner.
  exemptRegime: boolean;
  // [VRAAGPOST] Bank movement this result deliberately does NOT count: lines the owner has not
  // coded and that pay no invoice. Excluding them is right — a guessed category is a wrong number
  // — but excluding them SILENTLY leaves the owner reading a result that omits his money without
  // saying so. These two are that omission, named. Both are magnitudes, split in/out rather than
  // netted: €10.000 each way nets to zero and would read as "nothing missing".
  //
  // The professional shape of this is a vraagpost/tussenrekening, and its rule travels with it:
  // a balance here is a to-do, never a resting place. 0 for an owner who has coded everything.
  ongecategoriseerdBankIn: number;
  ongecategoriseerdBankUit: number;
  // [BEDRIJFSMIDDEL] Purchases in this window that are registered assets — kept OUT of kosten.
  // Named so the year screen can show the investment beside the depreciation that replaced it.
  investeringen: number;
  // [AANSLAG] Money on Belastingdienst letters that was kept OUT of kosten (income tax, Zvw, a btw
  // settlement, or a letter of unknown kind), euros incl. whatever the read put on it. Named so
  // the year screen can say where it went. Motorrijtuigenbelasting is a cost and is not in here.
  aanslagen: number;
  // [BEDRIJFSMIDDEL] The depreciation of the window, which IS in kosten (its own line on the year
  // screen). 0 for every owner without a register.
  afschrijvingen: number;
  // [BEDRIJFSMIDDEL] The register could not be read; investeringen and afschrijvingen are 0 and
  // every purchase counted as a cost. Never quiet — see ComputeOpts.assetsUnreadable.
  assetsUnreadable: boolean;
}

export interface SalesRateBucket { rate: number; omzet: number; btw: number }

// The maximum settlement lag (days) we look BACKWARD when a settlement line's takings date wasn't
// printed and we only have the booking date. Card settlements post the same day or a few days after
// the sale — never before — so looking back (never forward) reconciles a T+1..T+5 payout to its
// Z-report day without ever hiding revenue on a day that carries its own exact takings date. This is
// now the SHARED SETTLE_LAG_DAYS (turnover.ts): triangle's commission re-attribution uses the SAME
// window, so a payout's omzet (suppressed here) and its fee (booked there) always land on one day.

// Excess below this many euro is a per-line rounding artifact, not real off-till revenue —
// treated as a witness so a €0.01 gap can't fabricate a phantom omzet-zonder-tarief nudge.
const EXCESS_EPS = 0.02;

// [WEEKBATCH] How far back a settlement may DRAW DOWN till takings, as opposed to how far back it
// may be RECOGNISED as a settlement (SETTLE_LAG_DAYS, unchanged). Nine days covers the ordinary
// weekly batch: a scheme that pays out on Monday is settling the Monday-to-Sunday before it, so the
// oldest day it accounts for is eight days behind the payout. See suppressAgainstCoveredDays for
// why widening this one is bounded and cannot hide revenue.
const BATCH_DRAWDOWN_DAYS = 9;

// WHICH covered takings day does this settlement line reconcile to (or null)? Exact takings
// date (settleExact) → exact covered match. Fallback booking date (no printed DAT.) → accept a
// covered day up to SETTLE_LAG_DAYS earlier (the sale happened before the payout posted). In
// that fuzzy window we PREFER the nearest covered day that still has card-takings budget left,
// so two DAT-less payouts on consecutive trading days don't both collapse onto ONE day's budget
// (which would strand the other day's budget and leak the second payout as fake "excess" omzet —
// a systematic double-count). When every in-window covered day is exhausted we return the
// nearest, so the genuinely-excess amount correctly counts.
function matchedCoveredDay(t: ResultBankTx, covered: Set<string>, remaining: Map<string, number>): string | null {
  if (!t.settleDate) return null;
  if (covered.has(t.settleDate)) return t.settleDate; // exact/known takings date — consume its own day
  if (t.settleExact) return null; // exact date not covered → real revenue, never widen (never hide)
  let firstCovered: string | null = null;
  for (let back = 1; back <= SETTLE_LAG_DAYS; back++) {
    const d = isoMinusDays(t.settleDate, back);
    if (!covered.has(d)) continue;
    if (firstCovered === null) firstCovered = d;
    const rem = remaining.get(d);
    if (rem === undefined || rem > 0.005) return d; // still has budget (undefined = prior-quarter day)
  }
  return firstCovered;
}

/**
 * [COM-DUBBEL] Does this card payout reconcile to a day the till already counted?
 *
 * The same recognition question matchedCoveredDay answers, exported as a yes/no so the commission
 * decision in result-range-assemble.ts asks it in exactly the same words as the omzet-suppression
 * leg. Passing an empty budget map is deliberate: budget decides WHICH covered day a payout draws
 * from, and this asks only WHETHER it reconciles to one at all.
 */
export function reconcilesToCoveredDay(t: ResultBankTx, covered: Set<string>): boolean {
  return matchedCoveredDay(t, covered, new Map()) !== null;
}

/**
 * [WEEKBATCH] How much of this settlement was already counted by the till — across EVERY covered
 * day it can reach, not just one.
 *
 * matchedCoveredDay answers "WHICH day", and the caller drew down that ONE day's card budget. That
 * is right for a payout that settles a single trading day, and wrong for the one shape that is
 * completely ordinary: a credit-card scheme pays a WEEK in one batch. Its DAT. is a week number, so
 * parsePosSettlement correctly refuses to read it as a date, settleDate falls back to the booking
 * date, and the line is DAT-less by construction — exactly the case this window exists for.
 *
 * Measured on five trading days of EUR 400 card takings each, paid out as one EUR 2.000 batch:
 *
 *     till omzet for the week    1.652,90
 *     omzet computed             3.252,90
 *     booked as off-till revenue 1.600,00
 *
 * One day's EUR 400 was recognised as already counted and the other four days' takings were booked
 * a SECOND time — as omzet with no BTW rate, which also raises the omzet-zonder-tarief nudge and
 * blocks readiness over money that was never earned twice. Nearly double the week's turnover.
 *
 * So the payout draws down every covered day in its window, nearest first, until it is used up.
 * Nearest first because settlement lags takings: the closest covered day is the likeliest source,
 * and consuming it first leaves the older days for the older payouts. What is left after every
 * reachable day is exhausted is genuine off-till revenue and still counts, exactly as before.
 *
 * An EXACT takings date still consumes only its own day — that is not a guess and must not widen.
 */
function suppressAgainstCoveredDays(
  t: ResultBankTx,
  raw: number,
  covered: Set<string>,
  remaining: Map<string, number>,
): { matched: boolean; suppressed: number } {
  const first = matchedCoveredDay(t, covered, remaining);
  if (!first) return { matched: false, suppressed: 0 };
  // A prior-quarter buffer day carries no budget entry: the payout belongs to that quarter, whole.
  if (!remaining.has(first)) return { matched: true, suppressed: raw };

  const days: string[] = [];
  if (t.settleDate && covered.has(t.settleDate)) {
    days.push(t.settleDate); // exact/known takings date — its own day only
  } else {
    // TWO WINDOWS, TWO QUESTIONS, and the difference is the whole safety argument.
    //
    // matchedCoveredDay above answers the CONSERVATIVE one — "is this line a settlement of till
    // takings at all?" — and keeps the shared SETTLE_LAG_DAYS, so nothing about which lines
    // reconcile has changed. This loop answers the second question, "which of the till's card
    // takings does it account for?", and reaches further back because a weekly batch pays out days
    // that are eight or nine days behind the payout.
    //
    // Widening only THIS one cannot hide revenue: every euro suppressed here comes out of
    // cardRemaining, which is built solely from covered days' own card takings (cardBudgetBound).
    // Total suppression across all payouts can therefore never exceed what the till itself recorded
    // as card revenue. An uncovered day contributes no budget, so genuine off-till takings have
    // nothing to be absorbed by — which is the property the header of this section calls "never
    // hide". What the wider window changes is only WHICH covered day a settlement draws from.
    for (let back = 1; back <= BATCH_DRAWDOWN_DAYS; back++) {
      const d = isoMinusDays(t.settleDate ?? "", back);
      if (covered.has(d) && remaining.has(d)) days.push(d);
    }
  }

  let left = raw;
  let suppressed = 0;
  for (const d of days) {
    if (left <= 0.005) break;
    const rem = Math.max(0, remaining.get(d) ?? 0);
    if (rem <= 0.005) continue;
    const take = Math.min(left, rem);
    remaining.set(d, round2(rem - take));
    suppressed = round2(suppressed + take);
    left = round2(left - take);
  }
  return { matched: true, suppressed };
}

// Subtract whole days from a 'YYYY-MM-DD' string via UTC (no local-TZ drift). Returns
// '' for a malformed input so it simply won't match any covered date.
function isoMinusDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Verified statuses that count (mirrors buildZzpSummary 'all' mode): outgoing that
// has left the door, incoming the owner has confirmed. Unverified ('processing',
// 'draft') never counts.
const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
const INCOMING_OK = new Set(["paid", "received"]);

/**
 * The card-takings budget for one covered day: the MOST bank revenue that day may suppress as
 * "already counted by the till". Best is pin_amount (the Z-report's CARD total). When it is
 * missing we use the NON-CASH takings (total_incl − cash − other) — never plain gross, because
 * gross includes the cash portion and a card/PSP settlement can never be the cash takings, so
 * bounding by gross would wrongly absorb a same-day webshop payout up to the cash amount. Only
 * when the cash split is also unknown do we fall back to gross (documented residual). Exported so
 * the route can build a buffer-inclusive budget map identical to this rule.
 */
export function cardBudgetBound(t: DailyTurnover): number {
  const r2 = round2;
  if (t.pin_amount != null && t.pin_amount > 0) return r2(t.pin_amount);
  const gross = t.total_incl ?? 0;
  if (gross > 0) {
    if (t.cash_amount != null) {
      const nonCash = gross - t.cash_amount - (t.other_amount ?? 0);
      return r2(Math.max(0, nonCash));
    }
    return r2(gross); // cash split unknown → gross bound (best available)
  }
  return r2(turnoverNetOmzet(t) + turnoverBtw(t).total);
}

export function computeResult(
  invoices: ResultInvoice[],
  bankTx: ResultBankTx[],
  cashEntries: ResultCashEntry[],
  turnover: DailyTurnover[] = [],
  coveredDates?: Set<string>,
  // [TRIANGLE] Acquirer commission booked as a cost. The till counts card takings GROSS
  // (in `turnover`) while the bank pays out NET, so the acquirer's fee is otherwise never
  // a cost and profit is overstated. reconcileTriangle derives this from EFT gross − bank
  // net. IMPORTANT: pass it NET of any acquirer fee INVOICE already in `invoices` — else
  // the same fee is counted twice. The caller (route) owns that de-dup; here it is a plain
  // cost with no BTW (the reclaimable BTW comes from the acquirer's invoice, not invented).
  acquirerCommission = 0,
  // [CARD-BUDGET] Per covered day, the MAX bank revenue that day may suppress as "already
  // counted by the till" = its card takings (see cardBudgetBound). The caller SHOULD build this
  // from the SAME buffer-inclusive turnover as coveredDates, so a prior-quarter (buffer) covered
  // day also gets a budget: its terminal settlement (≤ pin) is suppressed as prior-quarter money
  // while a same-day webshop payout's EXCESS is still counted in THIS quarter — never hidden in
  // both. When omitted, the budget is derived from the in-quarter `turnover` only (buffer days
  // then suppress in full — correct when there is no off-till excess, e.g. in unit tests).
  coveredBudget?: Map<string, number>,
  // [KASSTELSEL] Cash-basis inputs; omit (or scheme 'factuur') for the accrual default.
  opts: ComputeOpts = {},
): FinancialResult {
  let omzet = 0;
  let kosten = 0;
  // [BEDRIJFSMIDDEL] Investments withheld from kosten; see ComputeOpts.assetInvoiceIds.
  let investeringen = 0;
  let aanslagen = 0;
  const taxKindOf = opts.taxKindByInvoice ?? new Map<string, TaxKind>();
  const assetIds: ReadonlySet<string> = opts.assetInvoiceIds ?? new Set<string>();
  let btwVerschuldigd = 0;
  let btwVoorbelasting = 0;
  let cashOmzetZonderBtw = 0;
  // [ZONDER-TARIEF-SOURCE] Of the omzet-zonder-tarief total, how much comes from BANK
  // revenue or an un-split till day (vs. plain cash). Bank/till revenue needs the Z-report
  // rate split to know 9%/21% — so the fix guidance points to Dagomzet, not Kas. Pure cash
  // omzet's rate is assigned at Kas. Lets readiness route the "fix" link to the right screen.
  let omzetZonderBtwNonCash = 0;
  // [VRAAGPOST] What this computation refuses to guess at, measured instead of dropped.
  let ongecategoriseerdBankIn = 0;
  let ongecategoriseerdBankUit = 0;
  let turnoverBtw9 = 0;
  let turnoverBtw21 = 0;

  // [VRIJGESTELD] Turnover that carries no BTW and no deduction right. Accumulated alongside
  // `omzet` (it IS revenue) but never handed to addSale, so it cannot reach a rubriek.
  let vrijgesteldeOmzet = 0;
  // [VRIJGESTELD] Turnover from sources this round cannot classify — see the field's note.
  let onclassificeerbareOmzet = 0;
  // Input BTW split by what the cost serves. On the DEFAULT path (exemptRegime off) every cent
  // goes to `direct` and comes back untouched at the bottom — that identity is what makes this
  // feature invisible to the owners who don't need it.
  const voorbelasting = { direct: 0, mixed: 0, blocked: 0 };
  // [TEGENTEKEN] What was refused, and why 5b is lower than the paper suggests.
  let voorbelastingTegenteken = 0;
  const exemptOn = opts.exemptRegime === true;
  /** Which bucket a purchase's input BTW belongs in. Off-regime: always the full-deduction one. */
  const bookVoorbelasting = (btw: number, deduction?: string | null): void => {
    if (!exemptOn) { voorbelasting.direct += btw; return; }
    switch (getVatDeduction(deduction)) {
      case "direct_taxed": voorbelasting.direct += btw; break;
      case "direct_exempt": voorbelasting.blocked += btw; break;
      default: voorbelasting.mixed += btw; break;
    }
  };

  // [AANSLAG] The tax-letter kind of a row, from WHICHEVER handle the caller supplied: the columns
  // on the row itself, or the id-keyed map the kasstelsel fetch builds. Both legs ask this one
  // question now, because both need the same answer and the callers do not all carry both handles
  // — three of the four map neither column, so a Belastingdienst letter reached the accrual leg
  // looking like an ordinary purchase while the cash leg (which reads the map) withheld it.
  const taxKindOfRow = (inv: ResultInvoice): TaxKind | null =>
    effectiveTaxKind(inv) ?? (inv.id ? taxKindOf.get(inv.id) ?? null : null);

  // [KAS-VOORBELASTING] The BTW on ONE purchase invoice, deducted on that invoice's own date.
  //
  // One booking site for both schemes, because both deduct on the same date — see the block at the
  // kas branch. A tax letter never gets here (no letter of the Belastingdienst carries btw).
  //
  // [TEGENTEKEN] A base and a BTW pointing in opposite directions is not a document that can
  // exist — a rate is never negative — so this is the one place that must NOT quietly add it up.
  // Found in a live administration: a creditnota stored at base −123,00 with btw +13,42, which
  // every credit check passed (the type says creditnota, the total is negative, and the three
  // numbers add up) while contributing +13,42 to the tax reclaimed instead of −13,42. Booking it
  // as −|btw| would be the other guess, and creditnota-signal.ts already ruled against per-field
  // sign repair in writing. So it is left out and NAMED: 5b too low by an amount the note states,
  // which errs toward claiming less rather than more.
  const bookPurchaseVat = (inv: ResultInvoice): void => {
    const btw = inv.btw_amount ?? 0;
    if (taxKindOfRow(inv)) return;
    if (btwSignOpposesBase({ totalExBtw: inv.total_ex_btw ?? 0, btwAmount: btw })) {
      voorbelastingTegenteken += Math.abs(btw);
      return;
    }
    bookVoorbelasting(btw, inv.vat_deduction);
  };

  // [AANGIFTE] Sales BTW per rate, accumulated across every sales source. Kept unrounded
  // so the per-rate BTW sums back to btwVerschuldigd with no drift.
  const salesRate = new Map<number, { omzet: number; btw: number }>();
  const addSale = (rate: number, omzetEx: number, btw: number) => {
    const cur = salesRate.get(rate) ?? { omzet: 0, btw: 0 };
    cur.omzet += omzetEx;
    cur.btw += btw;
    salesRate.set(rate, cur);
  };

  // [TURNOVER] Days for which the till Z-report IS the authoritative revenue. On such a
  // day the bank's pos_income settlement and the cash-book omzet are the SAME money,
  // already counted once via turnover — so they become reconciliation witnesses, not
  // extra revenue (mirrors the invoice_id → payment rule). Only days with real revenue
  // suppress: a zero/empty turnover row must never hide a real settlement. The caller MAY
  // pass a WIDER covered set than `turnover` (dates from the prior quarter whose card
  // takings settle into this one) so cross-quarter settlements are not double-counted.
  const covered =
    coveredDates ??
    new Set(
      turnover
        .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
        .map((t) => t.turnover_date),
    );

  // [CARD-BUDGET] How much bank revenue a covered day may SUPPRESS as "already counted by the
  // till". The physical till's CARD takings for the day = pin_amount (from the Z-report); a
  // card/PSP settlement reconciles the till only UP TO that amount. Anything beyond it is money
  // the till never saw — a same-day webshop payout via the same PSP, or a terminal paying out
  // more than the till rang — and MUST count as revenue (flagged omzet-zonder-tarief), never be
  // hidden. So suppression is BUDGET-BOUNDED, not all-or-nothing: for each covered day we
  // suppress settlement credits only until pin_amount is exhausted, then count the rest.
  //
  // Prefer the caller's buffer-inclusive budget (so prior-quarter days are bounded too, not
  // suppressed in full — see coveredBudget). Otherwise derive from the in-quarter turnover.
  const cardRemaining = coveredBudget
    ? new Map(coveredBudget)
    : (() => {
        const m = new Map<string, number>();
        for (const t of turnover) {
          const net = turnoverNetOmzet(t);
          if (!(net > 0 || (t.total_incl ?? 0) > 0)) continue; // not a revenue (covered) day
          m.set(t.turnover_date, cardBudgetBound(t));
        }
        return m;
      })();

  // 1) Invoices — the BTW-exact core.
  if (opts.scheme === "kas") {
    // [KASSTELSEL] Cash basis: BTW lands in the quarter the invoice is PAID. Book each
    // settlement's omzet/BTW slice (proportional share, exact remainder on the closing
    // payment) instead of the full invoice on its invoice-date. `invoices` is intentionally
    // NOT read here — the settlement events ARE the verified, period-correct source. The
    // turnover/cash/bank legs below stay identical (till revenue is sold=paid), so mixed
    // reality is safe by construction. Rate is header-derived so a creditnota's negative
    // slice nets the same rubriek instead of over-declaring.
    const slices = computeSettlementSlices(opts.settlements ?? [], opts.priorByInvoice ?? new Map());
    for (const s of slices) {
      if (s.direction === "outgoing") {
        omzet += s.ex;
        btwVerschuldigd += s.btw;
        // [VRIJGESTELD] A settlement carries the same proportion of exempt turnover as the
        // invoice it settles — the same proportional logic the rate split below uses. Withheld
        // from the rate buckets so it reaches no rubriek; `taxedEx` is the exact complement, so
        // the two halves re-sum to this slice with no drift.
        const exemptEx = exemptOn
          ? clampExemptPortion(s.ex * (opts.exemptShareByInvoice?.get(s.invoiceId) ?? 0), s.ex)
          : 0;
        vrijgesteldeOmzet += exemptEx;
        const taxedEx = s.ex - exemptEx;
        // [RUBRIEK-SPLIT] A payment settles a FRACTION of the invoice, and that fraction carries
        // a proportional share of every rate on it — a €500 instalment on a mixed 21%/9% invoice
        // is not 21% money. Split it the same way the accrual branch does, so both schemes put
        // the omzet in the same rubriek. The pieces re-sum to this slice exactly.
        const mix = splitSliceByShares(opts.rateSharesByInvoice?.get(s.invoiceId), taxedEx, s.btw);
        if (mix) for (const part of mix) addSale(part.rate, part.ex, part.btw);
        // [VRIJGESTELD] s.rate is derived from the FULL header (kas-payment-events.ts:252), which
        // is right for an ordinary invoice and wrong the moment part of it is exempt: all of the
        // BTW belongs to the taxed half, so btw ÷ header-ex divides real BTW by turnover it was
        // never charged on. €100 exempt care + €100 whitening @21% reads 21/200 = 10,5%, snaps to
        // 9%, and books a 21% supply in rubriek 1b — the accrual branch below fixed exactly this
        // and the cash branch was left on the header. Re-derive from the taxed remainder so both
        // schemes name the same rubriek; with nothing exempt taxedEx IS s.ex and this returns
        // s.rate unchanged.
        else if (taxedEx !== 0 || s.btw !== 0) {
          const rate = exemptEx !== 0
            ? (taxedEx !== 0 ? nearestLegalRate(Math.round((s.btw / taxedEx) * 100)) : 0)
            : s.rate;
          addSale(rate, taxedEx, s.btw);
        }
      } else {
        // [BEDRIJFSMIDDEL] A registered asset is an investment, not a cost — under kasstelsel too:
        // the kas regime is a btw rule, and depreciation is an income-tax rule that does not
        // follow the payment date. The btw on it is deducted exactly as for any purchase.
        // [AANSLAG] A tax letter settles like any payable, but its money is not a cost and its
        // "btw" (a misread, on a letter that carries none) is not voorbelasting.
        const taxKind = taxKindOf.get(s.invoiceId);
        if (taxKind && taxLetterBooking(taxKind) !== "kosten") { aanslagen += s.ex + s.btw; continue; }
        // Motorrijtuigenbelasting IS a cost — the whole letter, gross. A "btw" the reader split off
        // a tax letter is a misread (no letter of the Belastingdienst carries btw) and must never
        // reach 5b as voorbelasting.
        if (taxKind) { kosten += s.ex + s.btw; continue; }
        if (assetIds.has(s.invoiceId)) investeringen += s.ex; else kosten += s.ex;
        // [KAS-VOORBELASTING] The btw on this purchase is deliberately NOT booked here. It is
        // deducted on the invoice's own date, in the pass directly below.
      }
    }
    // ── [KAS-VOORBELASTING] Under the kasstelsel the DEDUCTION is not on the payment date ───────
    //
    // The kasstelsel moves the btw you OWE to the day your customer pays you (art. 26 Wet OB). It
    // does not move the btw you RECLAIM: voorbelasting is deducted in the period of the purchase
    // invoice, on both schemes. The Belastingdienst says it in one sentence — "De factuurdatum
    // bepaalt in welk tijdvak u de btw aftrekt" — and does not qualify it by regime; you do not
    // have to wait until you have paid your supplier.
    //
    // This branch booked the deduction off the SETTLEMENT, so a kas owner's 5b was the btw on the
    // bills they happened to pay that quarter. Two ways that costs money, both silent:
    //   · a bill received in March and paid in April was deducted a quarter late, so one aangifte
    //     was too high and the next too low — with belastingrente on the first;
    //   · at a switch of scheme the same bill was deducted TWICE: once on its invoice date in the
    //     last factuur quarter, once again on its payment date in the first kas quarter.
    // The cost leg above keeps the payment date: which quarter a cost belongs to is an income-tax
    // question (goed koopmansgebruik), and the kasstelsel is a btw regime. Only the btw moves.
    for (const inv of invoices) {
      // [OFFERTE-GEEN-OMZET] A supplier's quote is not a purchase invoice — same refusal as below.
      if (isQuote(inv.invoice_type)) continue;
      if (inv.direction !== "incoming" || !INCOMING_OK.has(inv.status ?? "")) continue;
      bookPurchaseVat(inv);
    }
  } else {
    for (const inv of invoices) {
      // [OFFERTE-GEEN-OMZET] A quote is not turnover, however far out the door it went.
      //
      // It carries no invoice number — it is not in the doorlopende reeks at all (Art. 35 Wet OB)
      // — nothing was delivered, and the customer may never accept it. But it is stored with
      // direction 'outgoing', status 'sent' and real totals, so the direction+status test on the
      // very next line booked it as omzet with BTW over it. Measured on one EUR 10.000 quote
      // beside one EUR 1.000 paid invoice: rubriek 1a read 11.000 / 2.310 where the truth is
      // 1.000 / 210, and 5g told the owner to pay EUR 2.100 of BTW on a quote nobody accepted.
      //
      // Guarded here, in the engine, rather than in each of the four callers' queries: a filter
      // that has to be repeated four times is a filter that is one refactor from being three.
      if (isQuote(inv.invoice_type)) continue;
      const ex = inv.total_ex_btw ?? 0;
      const btw = inv.btw_amount ?? 0;
      const st = inv.status ?? "";
      if (inv.direction === "outgoing" && OUTGOING_OK.has(st)) {
        omzet += ex;
        btwVerschuldigd += btw;
        // [VRIJGESTELD] Withhold the exempt part from the rubriek split. It stays in `omzet`
        // above (it is turnover, and the result must show it), but an art. 11 exemption is not
        // a rate — putting it in 1e would declare it as a 0%-taxed supply. `taxedEx` is the
        // exact complement of the clamped exempt part, so the two always re-sum to the header.
        const exemptEx = exemptOn ? clampExemptPortion(inv.exempt_ex ?? 0, ex) : 0;
        vrijgesteldeOmzet += exemptEx;
        const taxedEx = ex - exemptEx;
        // [RUBRIEK-SPLIT] When the invoice's own lines carry more than one rate, book each rate
        // where it belongs. The buckets were checked against this header before they arrived, so
        // the omzet and BTW added above are untouched — only their rubriek changes. Without this
        // a €1.000 @ 21% + €1.000 @ 9% invoice blends to 15%, snaps to 21%, and declares the
        // whole €2.000 in rubriek 1a.
        if (inv.rate_lines && inv.rate_lines.length > 1) {
          // [VRIJGESTELD] The per-rate buckets were built from the SAME lines that carry the
          // exempt flag, so an exempt line is already absent from them — subtracting again here
          // would remove it twice. When nothing is exempt this is the untouched original path.
          for (const share of inv.rate_lines) addSale(share.rate, share.ex, share.btw);
        } else if (taxedEx === 0 && exemptEx !== 0 && btw === 0) {
          // Wholly exempt, single-rate invoice: there is nothing left to declare. Skipping
          // addSale entirely keeps a €0/0% bucket out of salesByRate, which is what stops an
          // empty "1e" row from appearing on the concept of a fully exempt practice.
        } else {
          // Rate derived exactly like calcBtwRate (export.ts) — the header stores no rate.
          // Guard is `ex !== 0` (not `> 0`): a creditnota has NEGATIVE ex+btw, and
          // round(-249/-1185*100)=21 buckets it to the same rate so it NETS the rubriek
          // instead of falling to rate-0 and over-declaring BTW.
          // [HUNT-A] Snap the blend to a legal NL rate so a 9%+0%-statiegeld sale lands in
          // rubriek 1b, not 1c (a raw 8% blend would fall through to the 1c catch-all).
          // [VRIJGESTELD] Derived from the TAXED remainder, not the header. All of the BTW on a
          // part-exempt invoice belongs to its taxed half — the exempt half carries none by
          // definition — so btw ÷ ex would divide the real BTW by a base that includes turnover
          // it was never charged on. On €100 exempt care + €100 whitening @21% that reads
          // 21/200 = 10,5%, snaps to 9%, and declares a 21% sale in rubriek 1b. Dividing by the
          // taxed half restores the rate that was actually charged; with nothing exempt,
          // taxedEx IS ex and this is the original derivation, unchanged.
          addSale(taxedEx !== 0 ? nearestLegalRate(Math.round((btw / taxedEx) * 100)) : 0, taxedEx, btw);
        }
      } else if (inv.direction === "incoming" && INCOMING_OK.has(st)) {
        // [AANSLAG] A Belastingdienst letter is never a cost: income tax and Zvw are private, a
        // btw-naheffing is a settlement, an unknown letter is withheld and named. Only
        // motorrijtuigenbelasting falls through to kosten. Nothing of it is voorbelasting.
        const taxKind = taxKindOfRow(inv);
        if (taxKind && taxLetterBooking(taxKind) !== "kosten") { aanslagen += ex + btw; continue; }
        // Motorrijtuigenbelasting: a cost, gross, and never voorbelasting — see the kas branch.
        if (taxKind) { kosten += ex + btw; continue; }
        // [BEDRIJFSMIDDEL] See the kas branch: an asset purchase is reported apart, not as a cost.
        if (inv.id && assetIds.has(inv.id)) investeringen += ex; else kosten += ex;
        // [KAS-VOORBELASTING · TEGENTEKEN] One booking site for both schemes — the deduction is
        // dated by the invoice on either one, so the refusals belong in one place too.
        bookPurchaseVat(inv);
      }
    }
  }

  // 2) Owner-categorized bank lines that are NOT invoice payments. A bare bank line
  //    carries no valid BTW document, so it moves net revenue/cost only — no BTW.
  //    The category → P&L role comes from the single source of truth (bank-categories),
  //    so pos_income (card-terminal / PSP takings) lands on revenue like omzet.
  for (const t of bankTx) {
    // [GENEGEERD-TELT] De eigenaar heeft van deze regel gezegd dat het geld niet in zijn boeken
    // hoort — privé, dubbel, of niet van hem. Vóór dit stond zo'n regel gewoon in de kosten en zijn
    // BTW in de voorbelasting: een aftrek waarvan de eigenaar zelf had gemeld dat er geen recht op
    // bestond, of een tweede helping van een kost die hij al had gemeld als dubbel. Vóór de
    // categorie-tak, want een genegeerde regel hoort ook niet als vraagpost geteld te worden: hij
    // is niet onverklaard, hij is verklaard en hij hoort er niet.
    if (t.excludedByOwner) continue;
    if (t.invoice_id) continue;   // payment of an already-counted invoice
    if (!t.category) {
      // [VRAAGPOST] Not guessed into a total — and no longer dropped in silence either.
      //
      // Refusing to guess is only HALF of an honest figure. An owner with €12.000 of uncoded bank
      // debits reads a resultaat that is not wrong and is not his result either, with nothing on
      // the answer saying so. Professional practice books exactly this money to a vraagpost /
      // tussenrekening: a named balance, visible, and one that must never stand at a period end.
      // This file already measures five other kinds of money it cannot classify —
      // cashOmzetZonderBtw, omzetZonderBtwNonCash, voorbelastingUnresolved,
      // voorbelastingGeblokkeerd, onclassificeerbareOmzet — and this was the sixth, unnamed.
      //
      // Kept as two figures rather than a net balance on purpose: €10.000 in and €10.000 out net
      // to zero and would read as "nothing missing" while being two unexplained facts.
      const raw = t.amount ?? 0;
      if (raw > 0) ongecategoriseerdBankIn += raw;
      else ongecategoriseerdBankUit += -raw;
      continue;
    }
    // [SIGN] Keep the SIGN of the bank amount — do NOT Math.abs it. A card refund/chargeback
    // settles as a NEGATIVE pos_income and a supplier refund as a POSITIVE kosten credit;
    // abs would book money leaving the business as money arriving (and vice-versa). The stored
    // convention is credit(+)/debit(−), so a normal cost (debit, negative) becomes a positive
    // kosten via -raw, while a refund correctly reduces it. (sumPosSettlements keeps the sign
    // for the same reason.)
    const raw = t.amount ?? 0;
    const role = pnlRole(t.category);

    // [TURNOVER · CARD-BUDGET] A card/PSP settlement that reconciles a day the till already
    // counted is that day's takings, not new revenue. But it is a witness only UP TO the day's
    // physical card takings (pin_amount) — see cardRemaining. A settlement keyed on an explicit
    // pos_income category OR an acquirer-named credit the owner mis-tapped as 'omzet' is checked
    // against that budget: the part within budget is suppressed (already counted by the till),
    // any EXCESS is off-till revenue (e.g. a same-day webshop payout via the same PSP) and is
    // COUNTED + flagged, never hidden. A NON-acquirer 'omzet' line (a webshop transfer with no
    // acquirer name) is not a settlement → it always counts.
    const isSettlement = role === "omzet" && (t.posSettlement || t.category === "pos_income");
    if (isSettlement) {
      if (raw <= 0) {
        // A refund/chargeback is a witness of the till's ALREADY-NET figure ONLY when it exactly
        // matches the takings day (the reversal was rung at the till that day). A later,
        // bank-initiated reversal only WINDOW-matched to a nearby covered day is NOT in that
        // Z-report net → it must reduce omzet, not silently vanish (which would overstate omzet).
        if (t.settleExact && t.settleDate && covered.has(t.settleDate)) continue;
        // else fall through → the negative reduces omzet below.
      } else {
        // [WEEKBATCH] Across every covered day this payout can reach, not just the nearest one.
        const { matched, suppressed } = suppressAgainstCoveredDays(t, raw, covered, cardRemaining);
        if (matched) {
          const excess = round2(raw - suppressed);
          if (excess <= EXCESS_EPS) continue; // within the till's card takings (+rounding) → witness
          // The part beyond the till's card takings is real off-till revenue with no BTW rate.
          omzet += excess;
          cashOmzetZonderBtw += excess;
          omzetZonderBtwNonCash += excess;
          continue;
        }
      }
    }

    if (role === "omzet") {
      omzet += raw;
      // A bank revenue line (pos_income takings on an un-covered day, or a manual 'omzet'
      // chip) carries NO BTW rate — it must NOT silently declare €0 BTW in 5a. Surface it
      // exactly like unrated cash: counted in omzet, flagged as omzet-zonder-tarief, which
      // blocks readiness and appears in the aangifte note so a rate is assigned before
      // filing. Only a POSITIVE unrated line adds to the nudge — a refund reduces omzet but
      // must not inflate the zonder-tarief warning or block readiness.
      if (raw > 0) {
        cashOmzetZonderBtw += raw;
        omzetZonderBtwNonCash += raw; // bank-sourced → the rate split comes from the Z-report
      }
    }
    else if (role === "kosten") kosten += -raw; // debit(−) → positive cost; refund(+) reduces it
    // 'fee' (bankkosten) now maps to 'kosten' via PNL_ROLE — a deductible VAT-exempt cost; only
    // transfer / prive / tax remain 'excluded'.
  }

  // 3) Cash book.
  //
  // [CASH-DIRECTION] cash_entries.amount is ALWAYS POSITIVE — the sign lives in `direction`
  // ('in' = money into the drawer, 'out' = money out of it). This loop used to read the magnitude
  // and ignore the direction entirely, so a cash movement was booked with the sign of its
  // category rather than its own:
  //   · a REFUND paid to a customer from the till (omzet / out) ADDED omzet and BTW owed — the
  //     owner declares and pays VAT on money he handed back;
  //   · a refund RECEIVED from a supplier (kosten / in) ADDED cost, and with a bon and a rate it
  //     also added voorbelasting — a deduction on money that came back, which is the direction
  //     that ends in a naheffing.
  // Refunds are the normal way a till goes the other way, so this is not an exotic case. The
  // signed amount below flows through the same arithmetic; net, BTW and the per-rate bucket all
  // carry the sign, exactly as a creditnota does on the invoice side.
  for (const c of cashEntries) {
    const magnitude = c.amount ?? 0;
    if (c.category === "omzet") {
      // [TURNOVER] cash omzet on a covered day is part of the till turnover already
      // counted — exclude it from omzet, BTW, AND the no-rate nudge (all three).
      // Fail-SAFE on a missing date: a store that USES turnover (covered non-empty) has
      // its cash sales inside the Z-report, so a dateless cash omzet is treated as covered
      // rather than double-counted; a ZZP (no turnover → covered empty) still counts it.
      // [KAS-TERUGGAAF] Alleen geld dat BINNENKOMT kan de dubbeltelling zijn waar deze regel over
      // gaat. De redenering erboven is: de eigenaar heeft de dagopbrengst die de Z-bon al telde
      // nóg een keer als kasregel genoteerd. Een TERUGGAAF is dat niet — daar is geen tweede
      // notering van dezelfde ontvangst, en daily_turnover.cash_amount is een positief
      // ontvangstenbedrag dat een uitbetaling helemaal niet kan voorstellen.
      //
      // Hem toch overslaan haalt dus een echte beweging weg: de omzet blijft staan op het bedrag
      // vóór de teruggaaf. En de opmerking twee regels hierboven zegt zelf dat teruggaven "the
      // normal way a till goes the other way" zijn — precies het geval dat hier wegviel.
      //
      // De kosten-tak hiernaast doet dit al goed (een kas-UITGAVE op een kassadag telt gewoon);
      // dit trekt 'omzet' met diezelfde lijn recht.
      if (c.direction !== "out" && (c.date ? covered.has(c.date) : covered.size > 0)) continue;
      // Money IN is the sale; money OUT under 'omzet' is a refund OF a sale.
      const amt = c.direction === "out" ? -magnitude : magnitude;
      // [KAS-NULTARIEF] 0% is een ANTWOORD, geen ontbrekend antwoord.
      //
      // De voorwaarde was `c.btw_rate && c.btw_rate > 0`, dus een bewust op 0% geboekte
      // contante verkoop viel in de tak eronder — die hem optelt bij `cashOmzetZonderBtw`, de
      // teller die "omzet zonder tarief" heet. Twee dingen tegelijk fout:
      //
      //   · de omzet bereikt GEEN rubriek. Een 0-emmer met €0 btw gaat in aangifte.ts recht naar
      //     rubriek 1e ("Leveringen/diensten belast met 0% of niet bij u belast"), precies waar
      //     zo'n verkoop hoort — maar hij kwam nooit in een emmer terecht;
      //   · en `cashOmzetZonderBtw` BLOKKEERT de gereedheid (readiness/route.ts). De eigenaar
      //     die het juiste heeft ingevuld kon zijn kwartaal dus niet afronden, en de enige
      //     uitweg was het tarief veranderen in iets wat niet waar is.
      //
      // /api/cash accepteert 0 uitdrukkelijk als geldige keuze ([0, 9, 21]), en de database
      // bewaart 0 en NULL apart. Alleen NULL betekent "niet ingevuld".
      if (c.btw_rate != null) {
        const net = c.btw_rate > 0 ? amt / (1 + c.btw_rate / 100) : amt;
        omzet += net;
        btwVerschuldigd += amt - net;
        addSale(c.btw_rate, net, amt - net);
        // [VRIJGESTELD] A cash sale carries a rate but no exempt flag in this round, so for a
        // declared exempt owner this is turnover we booked as taxed WITHOUT being able to ask.
        // Counted, so the concept names it. (An UNRATED cash sale is already surfaced by
        // cashOmzetZonderBtw and reaches no rubriek, so it needs no second warning.)
        // Alleen bij een tarief BOVEN nul: de zin hierboven gaat over omzet die we als BELAST
        // hebben geboekt zonder het te kunnen vragen. Bij 0% is er niets belast, dus daar valt
        // ook niets onclassificeerbaars over te melden.
        if (exemptOn && c.btw_rate > 0) onclassificeerbareOmzet += net;
      } else {
        omzet += amt;
        cashOmzetZonderBtw += amt; // no rate → counted as revenue, flagged for BTW
      }
    } else if (c.category === "kosten") {
      // [CASH-COST-VAT] A cash expense with a LINKED BON and a rate → split gross into net cost +
      // voorbelasting (the reclaimable BTW), exactly like a purchase invoice. WITHOUT both a
      // document AND a rate it books at FULL GROSS with €0 voorbelasting — we never invent a
      // deduction from an undocumented cash line (the "no voorbelasting without a document" rule).
      // Money OUT is the cost; money IN under 'kosten' is a refund OF a cost — and it takes its
      // share of voorbelasting back with it.
      const amt = c.direction === "in" ? -magnitude : magnitude;
      if (c.document_id && c.btw_rate && c.btw_rate > 0) {
        const net = amt / (1 + c.btw_rate / 100);
        kosten += net;
        // [VRIJGESTELD] A cash cost carries no attribution of its own — the Kas screen has no
        // such field in this round — so for an exempt owner it lands in the 'mixed' bucket and
        // takes the pro-rata share. That is the legal default for a general cost, and the note
        // in aangifte.ts names cash costs explicitly so the owner knows which ones to check.
        bookVoorbelasting(amt - net, null);
      } else {
        kosten += amt; // no bon or no rate → full gross, no voorbelasting
      }
    } else if (c.category === "salaris") {
      // [CASH-COST-VAT] Wages paid in cash: a real business cost, but NEVER any BTW/voorbelasting
      // (wages carry no VAT). Rate-free by construction — a stray rate/document is ignored.
      // Repaid wages (money back into the till) reduce the cost, same rule as above.
      kosten += c.direction === "in" ? -magnitude : magnitude;
    }
    // transfer / prive → excluded
  }

  // 4) Till Z-report — the retail store's authoritative revenue, per BTW rate. Its
  //    matching bank pos_income + cash omzet were already excluded above (covered days).
  for (const t of turnover) {
    const net = turnoverNetOmzet(t);
    const b = turnoverBtw(t);
    omzet += net;
    btwVerschuldigd += b.total;
    turnoverBtw9 += b.r9;
    turnoverBtw21 += b.r21;
    addSale(21, t.base_21 ?? 0, b.r21);
    addSale(9, t.base_9 ?? 0, b.r9);
    addSale(0, t.base_0 ?? 0, 0);
    // [VRIJGESTELD] A Z-report has no exempt column, so a till day is booked as taxed in full.
    // Measured here so the concept can say the amount out loud instead of the owner discovering
    // it. Only for a declared exempt owner — for everyone else it is simply true that it is taxed.
    if (exemptOn) onclassificeerbareOmzet += net;

    // [FIN-5] A day whose printed gross (total_incl) exceeds its rated net+BTW is turnover
    // whose BTW rate did NOT import (e.g. a Z-report the normalizer couldn't split per
    // tarief). Left as-is it would vanish: the day counts as "covered" (total_incl>0) so
    // the bank/cash witnesses are suppressed, yet it adds 0 to 5a — silently understating
    // the aangifte to zero and slipping past the readiness gate. Instead, recover the
    // unaccounted gross as revenue AND flag it as omzet-zonder-tarief (exactly like unrated
    // cash: counted in omzet, surfaced in cashOmzetZonderBtw, which BLOCKS readiness) so a
    // rate must be assigned before this can be filed. Tolerant of per-day rounding.
    if (t.total_incl != null) {
      const unrated = t.total_incl - (net + b.total);
      // A correctly-imported day reconciles net+BTW to the CENT (both come from the same
      // Z-report), so a tight tolerance (10c + 0.1%) catches even a small un-imported bucket
      // on a large day without false-triggering on legitimate per-line rounding — the
      // owner's "no silent loss" rule over the looser 0.5% payment-reconciliation floor.
      if (unrated > Math.max(0.10, 0.001 * Math.abs(t.total_incl))) {
        omzet += unrated;
        cashOmzetZonderBtw += unrated;
        omzetZonderBtwNonCash += unrated; // till day with an un-imported rate → fix at Dagomzet
      }
    }
  }

  // 5) [TRIANGLE] Acquirer commission — a real cost that closes the gross-till vs net-bank
  //    gap. No BTW is claimed here (see the parameter note); a negative value is ignored.
  if (acquirerCommission > 0) kosten += acquirerCommission;

  // 6) [VRIJGESTELD] Resolve the deduction LAST, because the ratio is made of the turnover the
  //    loops above just finished counting. Every sales source has been seen, so `omzet` is the
  //    full denominator and `vrijgesteldeOmzet` the exempt part of it; the taxed side is the
  //    exact complement rather than a second sum, so the two can never disagree.
  //
  //    Off-regime this is arithmetic with a known answer: everything is in `direct`, the ratio
  //    is ignored, and btwVoorbelasting comes out equal to the running total the old code kept.
  // [BEDRIJFSMIDDEL] The depreciation of the window is a cost of the window. It is the ONLY way a
  // registered asset reaches the result, and it lands here — after every leg — so the pro-rata
  // btw computation below never sees it (depreciation carries no btw).
  const afschrijvingen = round2(Math.max(0, opts.afschrijvingen ?? 0));
  kosten += afschrijvingen;

  const proRata: ProRata = computeProRata({
    taxedOmzet: omzet - vrijgesteldeOmzet,
    exemptOmzet: vrijgesteldeOmzet,
  });
  const deduction = deductibleVoorbelasting(voorbelasting, proRata);
  btwVoorbelasting = deduction.amount;

  return {
    omzet,
    kosten,
    resultaat: omzet - kosten,
    btwVerschuldigd,
    btwVoorbelasting,
    btwSaldo: btwVerschuldigd - btwVoorbelasting,
    cashOmzetZonderBtw,
    omzetZonderBtwNonCash,
    turnoverBtw9,
    turnoverBtw21,
    salesByRate: [...salesRate.entries()]
      .map(([rate, v]) => ({ rate, omzet: v.omzet, btw: v.btw }))
      .sort((a, b) => b.rate - a.rate),
    vrijgesteldeOmzet,
    onclassificeerbareOmzet,
    // [VRAAGPOST] The money this result deliberately does not count, named.
    ongecategoriseerdBankIn,
    ongecategoriseerdBankUit,
    exemptRegime: exemptOn,
    // Null off-regime (there is nothing to apportion) and null when the ratio was undecidable.
    // voorbelastingUnresolved tells those two apart — see the field's own note.
    proRataPercent: exemptOn ? deduction.percent : null,
    voorbelastingUnresolved: deduction.unresolved,
    voorbelastingTegenteken: round2(voorbelastingTegenteken),
    voorbelastingGeblokkeerd: voorbelasting.blocked,
    investeringen: round2(investeringen),
    aanslagen: round2(aanslagen),
    afschrijvingen,
    assetsUnreadable: opts.assetsUnreadable === true,
  };
}
