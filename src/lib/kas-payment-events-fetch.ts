// src/lib/kas-payment-events-fetch.ts
// [KASSTELSEL] The I/O that gathers an owner's invoice SETTLEMENTS (which day money moved, and how
// much) and hands them to the pure buildQuarterSettlements. Kept out of kas-payment-events.ts so
// that module stays a pure, exhaustively-tested arithmetic core.
//
// Date resolution per invoice, most-authoritative first (verified by the design's payment-date map):
//   1. bank_tx_invoices.amount_applied ⨝ bank_transactions.date  — real settlement date, PER
//      installment (collision-free; a batch payment dates each linked invoice by its own tx).
//   2. invoices.payment_date            — a cash/manual pay the owner recorded (exact date).
//   3. invoices.marked_paid_at          — the human-confirm moment (an ESTIMATE of the pay date).
//   4. none                             — paid but undated → surfaced (undatedPaidCount), never dropped.
//
// The engine never trusts a stored sign: the grouper signs each magnitude from the invoice header,
// so a creditnota (negative header) nets correctly.

import type { PipelineClient } from "./supabase-pipeline";
import { columnIsAbsent } from "@/lib/column-probe";
import { fetchAllRows, fetchAllRowsForIds } from "./supabase-paginate";
import {
  buildQuarterSettlements,
  type HeaderWithPaid,
  type RawSettlement,
  type QuarterSettlements,
  type InvoiceDirection,
} from "./kas-payment-events";
import { getVatScheme, resolveSchemeForQuarter, type VatScheme } from "./vat-scheme";
// [DEPLOY-SAFE] "migration not applied yet" vs "the read failed" — see pg-missing.ts
import { isMissingColumn } from "./pg-missing";
import type { ComputeOpts } from "./financial-result";
// [RUBRIEK-SPLIT] Same helper the accrual surfaces use — one definition of an invoice rate mix.
import { fetchRateShares } from "./btw-rate-split-fetch";
import { exemptShareOf } from "./vat-exemption";
// [VRIJGESTELD · KASSTELSEL] The purchase-side attributions for the invoices the SETTLEMENTS
// point at — a different set from the ones the window DATES. See the call site.
import { fetchVatDeductions } from "./vat-exemption-collect";
import { round2 } from "./invoice-totals";
import { effectiveTaxKind, type TaxKind } from "./tax-letter";

// [KASSTELSEL] Under cash basis an invoice counts ONLY when money moved: amount_paid > 0 (any
// partial) OR status 'paid' (fully settled). NOT a bare 'sent'/'overdue' (unpaid sale) or
// 'received' (unpaid purchase) — those carry no settlement yet. A status 'paid' row whose
// amount_paid was never populated (legacy, pre-partial-payments) still counts its FULL total,
// so a real paid invoice is never silently under-declared.
function isSettled(i: { amount_paid: number | null; status: string | null }): boolean {
  return (Number(i.amount_paid) || 0) > 0 || i.status === "paid";
}
/** The magnitude of money settled: amount_paid when present, else the full header for a legacy
 *  'paid' invoice (never 0 for a genuinely paid invoice). */
function paidMagnitude(i: { amount_paid: number | null; status: string | null }, headerInc: number): number {
  const ap = Math.abs(Number(i.amount_paid) || 0);
  if (ap > 0) return ap;
  return i.status === "paid" ? Math.abs(headerInc) : 0;
}

/**
 * Fetch the quarter's settlement events for one owner. Returns everything buildQuarterSettlements
 * produced (in-window events, priorByInvoice, undatedPaidCount, estimatedCount). Throws on a query
 * error (the caller surfaces it) rather than silently returning zero figures — under kasstelsel a
 * swallowed error would under-declare BTW. `start`/`end` are ISO 'YYYY-MM-DD'.
 */
export async function fetchSettlementEvents(
  pipeline: PipelineClient,
  ownerId: string,
  start: string,
  end: string,
): Promise<QuarterSettlements> {
  // 1) The owner's invoices that carry any settlement (amount_paid > 0, or a paid/received status).
  //    NO invoice_date filter — a prior-year invoice paid this quarter must be reachable.
  const invRows = await fetchAllRows<{
    id: string; direction: string | null; sender_id: string | null; receiver_id: string | null;
    total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
    amount_paid: number | null; payment_date: string | null; marked_paid_at: string | null; status: string | null;
    tax_kind?: string | null; client_name?: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("id, direction, sender_id, receiver_id, total_ex_btw, btw_amount, total_inc_btw, amount_paid, payment_date, marked_paid_at, status, tax_kind, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .order("id", { ascending: true }).range(from, to),
  ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] invoice fetch failed: ${e instanceof Error ? e.message : String(e)}`); });

  // 2) ALL of the owner's bank↔invoice links (by user_id, unfiltered). A payment reconciled via a
  //    bank link IS settled money — even if amount_paid/status weren't synced on the invoice row —
  //    so a linked invoice joins the settled set below (never a silent under-declaration).
  // [MANUAL-PARTIAL-PAY] A manual instalment is a link with NO transaction (transaction_id
  // NULL) that carries its own date in paid_on. DEPLOY-SAFE: if that migration has not been
  // applied yet, the richer select errors — fall back to the legacy projection so the
  // kasstelsel aangifte keeps working (there simply are no manual rows to date yet).
  type SettleLink = {
    invoice_id: string; transaction_id: string | null;
    amount_applied: number | null; paid_on?: string | null;
  };
  const fetchLinks = (columns: string) => fetchAllRows<SettleLink>(
    (from, to) => pipeline
      .from("bank_tx_invoices")
      .select(columns)
      .eq("user_id", ownerId)
      .order("id", { ascending: true }).range(from, to) as never,
  );
  // [KAS-PROBE] The fallback fires ONLY on a genuinely absent column. It used to fire on any
  // rejection, and the two are nothing alike: a statement timeout, a 5xx on page two or a pooler
  // refusal would silently re-read WITHOUT paid_on, and paid_on is the date a manual instalment is
  // dated by. Losing it does not lose a field — under the kasstelsel it takes every cash and manual
  // instalment out of the quarter it belongs to, so the BTW owed on it is under-declared (or the
  // voorbelasting on the purchase side is lost), and undatedPaidCount then blocks the filing over
  // rows that were perfectly datable a second earlier.
  //
  // The window the fallback was written for is closed: bank_tx_invoices.paid_on exists in
  // production. Same rule and same helper as the five capability probes — see column-probe.ts.
  const links = await fetchLinks("invoice_id, transaction_id, amount_applied, paid_on")
    .catch((e: unknown) => {
      if (!columnIsAbsent(e as { code?: string; message?: string }, "paid_on")) throw e;
      return fetchLinks("invoice_id, transaction_id, amount_applied");
    })
    .catch((e: unknown) => { throw new Error(`[KASSTELSEL] bank_tx_invoices fetch failed: ${e instanceof Error ? e.message : String(e)}`); });
  const linkedIds = new Set(links.map((l) => l.invoice_id).filter(Boolean));

  // [STATUS-GUARD] The same exclusion the accrual engine applies (financial-result.ts
  // INCOMING_OK and its outgoing mirror): a 'draft' is not a document, a 'processing' row is an
  // unverified read, and an 'archived' row is an invoice /supersede took out of the books.
  // Without this line the two VAT schemes disagreed about the same row — an archived duplicate
  // with a leftover amount_paid or a stray bank link was excluded from every accrual total and
  // still counted here, reaching the concept-aangifte, readiness and the closing package. A
  // settlement is only money the moment the document behind it is real and current.
  const EXCLUDED = new Set(["draft", "processing", "archived"]);
  const settled = invRows.filter((i) => !EXCLUDED.has(i.status ?? "") && (isSettled(i) || linkedIds.has(i.id)));
  if (settled.length === 0) return { events: [], priorByInvoice: new Map(), undatedPaidCount: 0, estimatedCount: 0 };

  const headers = new Map<string, HeaderWithPaid>();
  // [AANSLAG] See QuarterSettlements.taxKindByInvoice.
  const taxKindByInvoice = new Map<string, TaxKind>();
  for (const i of settled) {
    if (i.receiver_id === ownerId) { const k = effectiveTaxKind(i); if (k) taxKindByInvoice.set(i.id, k); }
    const direction: InvoiceDirection =
      i.direction === "incoming" || i.direction === "outgoing"
        ? i.direction
        : i.receiver_id === ownerId ? "incoming" : "outgoing";
    const ex = Number(i.total_ex_btw) || 0;
    const btw = Number(i.btw_amount) || 0;
    const inc = i.total_inc_btw != null ? Number(i.total_inc_btw) : ex + btw;
    headers.set(i.id, {
      invoiceId: i.id, direction, totalEx: ex, totalBtw: btw, totalInc: inc,
      amountPaidMagnitude: paidMagnitude(i, inc),
    });
  }

  // Manual instalments carry no transaction — they are dated by paid_on, not looked up here.
  const txIds = [...new Set(links.map((l) => l.transaction_id).filter((id): id is string => !!id))];
  const txDate = new Map<string, string>();
  if (txIds.length > 0) {
    // [ID-CHUNK] fetchAllRowsForIds, not fetchAllRows with a bare `.in()`. The two solve different
    // ceilings and only one of them was closed here: fetchAllRows re-issues `.range()` for the
    // ~1000-row RESPONSE cap, but it rebuilds the same full id list in the URL on every page, so
    // the REQUEST-line ceiling is untouched.
    //
    // And this id list is the worst case in the app. `links` above is read by user_id with no date
    // filter — its own comment says "ALL of the owner's bank↔invoice links" — so txIds is every
    // bank transaction that ever settled one of this owner's invoices, all-time. At ~37 URL bytes
    // per uuid a few hundred settled invoices already outgrow the request line, and the 414 is not
    // a degraded read: it throws, and the concept BTW-aangifte, the resultaat screen, readiness and
    // the closing package all lose their settlement dating at once, permanently, for the owners
    // with the longest history.
    //
    // payment-evidence-collect.ts:62 does this identical three-step read the right way already.
    const txRows = await fetchAllRowsForIds<{ id: string; date: string | null }, string>(
      txIds,
      (chunk, from, to) => pipeline
        .from("bank_transactions").select("id, date").in("id", chunk)
        .order("id", { ascending: true }).range(from, to),
    ).catch((e: unknown) => { throw new Error(`[KASSTELSEL] bank_transactions fetch failed: ${e instanceof Error ? e.message : String(e)}`); });
    for (const t of txRows) if (t.date) txDate.set(t.id, t.date.slice(0, 10));
  }

  const linksByInvoice = new Map<string, SettleLink[]>();
  for (const l of links) {
    if (!linksByInvoice.has(l.invoice_id)) linksByInvoice.set(l.invoice_id, []);
    linksByInvoice.get(l.invoice_id)!.push(l);
  }

  // 3) Build the raw settlement records per invoice, using the resolution order.
  const raw: RawSettlement[] = [];
  for (const i of settled) {
    const bankLinks = linksByInvoice.get(i.id) ?? [];
    // [MANUAL-PARTIAL-PAY] A bank-linked row is dated by its transaction; a MANUAL row
    // (transaction_id NULL) by its own paid_on. Without this branch txDate.get(null) yields
    // undefined and a perfectly dated cash instalment would be treated as undated — pushing
    // real settled money into the "onbekende datum" bucket and out of its quarter.
    const dated = bankLinks
      .map((l) => ({
        date: l.transaction_id ? (txDate.get(l.transaction_id) ?? null) : (l.paid_on ?? null),
        mag: Math.abs(Number(l.amount_applied) || 0),
      }))
      .filter((l) => l.mag > 0);
    const paidMag = headers.get(i.id)!.amountPaidMagnitude; // amount_paid, or full total for a legacy 'paid'
    for (const d of dated) raw.push({ invoiceId: i.id, payDate: d.date, magnitude: d.mag, estimated: false });

    // [PARTIAL-PAY] The links do NOT always account for everything that was settled. A batch
    // booking historically left amount_paid untouched, and a cash/manual instalment has no bank
    // link at all — so an invoice can be settled for more than its links describe. The old code
    // `continue`d as soon as ONE dated link existed, and that difference silently vanished from
    // the kasstelsel BTW-aangifte: an under-declaration with no warning, because the undated
    // check nets to zero when a dated link is present. Book the REMAINDER through the same
    // exact → estimate → undated ladder, so money can never be settled yet uncounted.
    // Structurally the remainder is 0 once every path maintains amount_paid; this is the net.
    const datedMag = dated.reduce((s, d) => s + d.mag, 0);
    const remainderMag = round2(paidMag - datedMag);
    if (remainderMag <= 0.005) continue;
    if (i.payment_date) raw.push({ invoiceId: i.id, payDate: i.payment_date.slice(0, 10), magnitude: remainderMag, estimated: false });
    else if (i.marked_paid_at) raw.push({ invoiceId: i.id, payDate: i.marked_paid_at.slice(0, 10), magnitude: remainderMag, estimated: true });
    else raw.push({ invoiceId: i.id, payDate: null, magnitude: remainderMag, estimated: true });
  }

  return { ...buildQuarterSettlements(headers, raw, start, end), taxKindByInvoice };
}

/**
 * [SCHEME-READ-HONEST] The owner's stored election, read ONCE and read HONESTLY.
 *
 * All three resolvers below used to run `const { data: prof } = await …` and drop the error. The
 * comment that justified it — "deploy-safe: if the vat_scheme migration lags, the select degrades
 * to factuur, never a wrong number" — is true of exactly one failure and was applied to all of
 * them. A missing COLUMN really does mean "this owner has made no election yet", and factuur is
 * then the right answer. A read that FAILED means we do not know the election, and answering
 * factuur for a kasstelsel owner is not a smaller answer, it is a different declaration:
 *
 *   · BTW is computed on the invoice date instead of the payment date, so unpaid sales are
 *     declared too early and older invoices paid this quarter drop out entirely;
 *   · the note that says "Kasstelsel actief — de BTW is berekend op de BETAALdatum" disappears
 *     with it, so the concept looks like an ordinary accrual one;
 *   · undatedPaidCount becomes 0, taking the "dit concept is mogelijk te laag" warning with it.
 *
 * Nothing on any screen contradicts it. So: degrade on a missing column, throw on anything else.
 * Every caller (aangifte, readiness, closing package, the truth lens) already lets a failed read
 * throw — their invoice and bank reads go through fetchAllRows, which does exactly this — so the
 * request fails with a message instead of quietly declaring on the wrong basis.
 */
async function readSchemeElection(
  pipeline: PipelineClient,
  ownerId: string,
): Promise<{ scheme: VatScheme; since: string | null }> {
  const { data: prof, error } = await pipeline
    .from("profiles").select("vat_scheme, vat_scheme_since").eq("id", ownerId).maybeSingle();
  if (error) {
    if (!isMissingColumn(error.message, (error as { code?: string | null }).code)) {
      throw new Error(`[KASSTELSEL] vat_scheme read failed: ${error.message}`);
    }
    // The migration has not landed here yet: nobody can have elected kas, so factuur is complete.
    return { scheme: "factuur", since: null };
  }
  const p = prof as { vat_scheme?: string | null; vat_scheme_since?: string | null } | null;
  return { scheme: getVatScheme(p?.vat_scheme), since: p?.vat_scheme_since ?? null };
}

/** The VAT basis in force for a quarter, read from the owner's profile (own query → deploy-safe:
 *  if the vat_scheme migration lags, it degrades to factuur). Used where only the scheme is needed
 *  (the settlements are fetched separately, e.g. inside computeResultForRange). */
export async function resolveOwnerScheme(
  pipeline: PipelineClient,
  ownerId: string,
  quarterStart: string,
): Promise<VatScheme> {
  const { scheme, since } = await readSchemeElection(pipeline, ownerId);
  return resolveSchemeForQuarter(scheme, since, quarterStart);
}

/** The VAT basis across a whole [start, end] window, plus whether the window straddles the switch. */
export interface SchemeSpan {
  /** The basis the window is COMPUTED under — resolved at `start`, per the per-quarter rule. */
  scheme: VatScheme;
  /** The basis in force on the last day of the window. */
  schemeAtEnd: VatScheme;
  /** TRUE when the two differ: no single basis is correct for this window. */
  spansSchemeChange: boolean;
  /** The owner's effective date for kasstelsel (ISO day), when they have one. */
  schemeSince: string | null;
}

/**
 * [SCHEME-SPAN] Resolve the VAT basis for a window that may be LONGER than one quarter.
 *
 * The per-quarter rule (vat-scheme.ts) exists so that switching to kasstelsel never retroactively
 * rewrites an already-filed quarter — it resolves the basis from the period's START. That is exactly
 * right for a quarter, and quietly wrong for the multi-quarter windows the truth lens introduced: a
 * "Dit jaar" window starts on 1 January and an "Alles" window starts in 2015, so an owner who moved
 * to kas in, say, Q2 gets those lenses computed entirely on FACTUUR — while the very same screen
 * computes "Dit kwartaal" on KAS. The year then does not equal the sum of its quarters, on a surface
 * whose whole premise is that there is one truth.
 *
 * There is no single basis that is correct for such a window, so this does not invent one: it keeps
 * the start-resolved basis (unchanged, safe, never rewrites a filed period) and reports the straddle
 * so the caller can SAY so instead of presenting a blended number as fact. One profile read.
 */
export async function resolveOwnerSchemeSpan(
  pipeline: PipelineClient,
  ownerId: string,
  start: string,
  end: string,
): Promise<SchemeSpan> {
  // [SCHEME-READ-HONEST] One reader for all three resolvers — see readSchemeElection.
  const { scheme: profileScheme, since } = await readSchemeElection(pipeline, ownerId);
  const scheme = resolveSchemeForQuarter(profileScheme, since, start);
  const schemeAtEnd = resolveSchemeForQuarter(profileScheme, since, end);
  return {
    scheme,
    schemeAtEnd,
    spansSchemeChange: scheme !== schemeAtEnd,
    schemeSince: since ? since.slice(0, 10) : null,
  };
}

/**
 * [SCHEME-MERGE] Fold a caller's own per-invoice maps into the scheme opts, merging both.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A SPREAD AT EACH CALL SITE ──
 * The three money-read routes each build their own maps from a DATE-RANGE query over the invoices
 * dated in the quarter. Under kas the settlements point somewhere else: at invoices from earlier
 * quarters that were PAID in this one, which is the normal case — payment lags the invoice date
 * and regularly crosses a quarter boundary. So the two sets barely overlap, and neither is a
 * superset of the other.
 *
 * Writing `{ ...sr.opts, exemptShareByInvoice: myOwnMap }` therefore does not "override a
 * default", it DELETES the half that covers the invoices this quarter actually settles. It reads
 * completely ordinary, and what it costs is specific: a sale invoiced in Q1, paid in Q2, under a
 * vrijgestelde-omzet regime has no exempt share left in the Q2 figures, so its exempt portion
 * counts as 0 and the whole settlement is declared as TAXED turnover. The owner pays BTW on
 * exempt omzet, on the aangifte, and nothing anywhere disagrees with itself.
 *
 * /api/aangifte did exactly that on exemptShareByInvoice while merging rateSharesByInvoice one
 * line above with a comment explaining why merging was necessary; /api/readiness did it on both.
 * compute-result-range had it right. Three copies, two of them wrong — so it becomes one function
 * that cannot be half-applied.
 */
export function mergeSchemeOpts(
  opts: ComputeOpts,
  local: {
    rateSharesByInvoice?: ComputeOpts["rateSharesByInvoice"]
    exemptShareByInvoice?: ComputeOpts["exemptShareByInvoice"]
    // [VRIJGESTELD · KASSTELSEL] The purchase-side attributions. Same window problem as the two
    // above, and it must be MERGED for the same reason — a settled cost whose attribution lives
    // only in the caller's date-range map, or only in the scheme's settled map, keeps it either
    // way. Set it after this call and the other half is gone.
    deductionByInvoice?: ComputeOpts["deductionByInvoice"]
    // [AANSLAG] Same window problem, same merge: the caller knows the letters DATED in the window,
    // the scheme knows the letters SETTLED in it.
    taxKindByInvoice?: ComputeOpts["taxKindByInvoice"]
  },
): ComputeOpts {
  // [MERGE-SCHEME] Precedence, stated to match what the code DOES.
  //
  // A Map built from two spreads keeps the LAST value for a repeated key, and `local` is spread
  // last — so where both maps know an invoice, the LOCAL one wins. That is the scheme-resolved
  // read: the map gathered for the invoices actually SETTLED in this quarter, which is the more
  // specific fact about them than whatever the caller happened to read for its own date window.
  //
  // This note used to say the opposite ("the caller's own map goes LAST"), while `opts` is spread
  // first. On the one function that exists so this cannot be got wrong, a comment describing the
  // reverse of the behaviour is the next version of the bug: a reader who trusts it and "restores"
  // the order flips the precedence on exempt shares, silently, on a filed quarter.
  const merge = <V>(a?: ReadonlyMap<string, V>, b?: ReadonlyMap<string, V>): Map<string, V> | undefined =>
    a || b ? new Map([...(a ?? new Map<string, V>()), ...(b ?? new Map<string, V>())]) : undefined
  const rateSharesByInvoice = merge(opts.rateSharesByInvoice, local.rateSharesByInvoice)
  const exemptShareByInvoice = merge(opts.exemptShareByInvoice, local.exemptShareByInvoice)
  const deductionByInvoice = merge(opts.deductionByInvoice, local.deductionByInvoice)
  const taxKindByInvoice = merge(opts.taxKindByInvoice, local.taxKindByInvoice)
  return {
    ...opts,
    ...(rateSharesByInvoice ? { rateSharesByInvoice } : {}),
    ...(exemptShareByInvoice ? { exemptShareByInvoice } : {}),
    ...(deductionByInvoice ? { deductionByInvoice } : {}),
    ...(taxKindByInvoice ? { taxKindByInvoice } : {}),
  }
}

/**
 * [SCHEME-DEGRADED] An input of the SETTLED invoices that could not be read, so the figures built
 * on it stand on a fallback:
 *   · "rate_split"    — a settled sale's rate mix (fetchRateShares): its omzet stays on the rate
 *                        derived from the invoice header, so a mixed 21%/9% invoice lands in one
 *                        rubriek;
 *   · "vat_deduction" — a settled purchase's cost attribution under the exempt regime
 *                        (fetchVatDeductions): pro-rata instead of what the owner attributed.
 */
export type SchemeDegradation = "rate_split" | "vat_deduction";

/** What a money-read route needs to become scheme-aware in one call. */
export interface SchemeResolution {
  scheme: VatScheme;
  opts: ComputeOpts;              // {} under factuur (computeResult runs accrual); kas inputs under kas
  undatedPaidCount: number;      // paid money that couldn't be dated → block klaar/aangifte, suppress figures
  estimatedPortionCount: number; // paid-date is an estimate (marked_paid_at) → block klaar
  /**
   * [SCHEME-DEGRADED] Which settled-invoice inputs fell back (see SchemeDegradation). Empty when
   * everything was read, and always under factuur. The two helpers behind it degrade instead of
   * throwing, and this function used to drop their flag — so every consumer priced the settled
   * invoices on a fallback without knowing it. Nothing is computed differently because of this
   * field; it only says what the resolution stands on, and each consumer decides. The closing
   * package refuses to build (closing-package.ts); /api/aangifte and /api/readiness do not read it.
   */
  degraded: SchemeDegradation[];
}

/**
 * Resolve the VAT basis for one quarter and, under kas, gather its settlement inputs — the single
 * entry point the money-read routes (/api/result, /api/aangifte, /api/readiness) use so they can
 * never disagree on the scheme. `quarterStart` gates the per-quarter effective date; [start,end] is
 * the window whose settlements to fetch. The profile is read in its OWN query (deploy-safe: if the
 * vat_scheme migration lags, the select degrades to factuur, never a wrong number). Under factuur
 * it returns empty opts so computeResult runs the accrual path byte-identical.
 */
export async function resolveSchemeSettlements(
  pipeline: PipelineClient,
  ownerId: string,
  quarterStart: string,
  start: string,
  end: string,
  // [VRIJGESTELD] Whether the exempt regime applies to this quarter, already resolved by the
  // caller's shared collector. Under kas the settled invoices are a DIFFERENT set from the
  // invoices dated in the window (payment lags the invoice), so their exempt parts have to be
  // read here too — the caller's own map covers only the dated ones. Absent → the untouched path.
  exemptRegime = false,
): Promise<SchemeResolution> {
  // [SCHEME-READ-HONEST] One reader for all three resolvers — see readSchemeElection. This is the
  // call site where a swallowed error did the most damage: it decides the BASIS of the concept
  // BTW-aangifte, of the readiness verdict and of the closing package.
  const { scheme: profileScheme, since } = await readSchemeElection(pipeline, ownerId);
  const scheme = resolveSchemeForQuarter(profileScheme, since, quarterStart);
  if (scheme !== "kas") return { scheme: "factuur", opts: {}, undatedPaidCount: 0, estimatedPortionCount: 0, degraded: [] };
  const qs = await fetchSettlementEvents(pipeline, ownerId, start, end);
  // [RUBRIEK-SPLIT] The rate mix belongs to the invoices the SETTLEMENTS point at, not to the
  // invoices DATED in this window — and under kas those are different sets on purpose: the
  // settlement fetch deliberately applies no invoice_date filter, "a prior-year invoice paid this
  // quarter must be reachable". Callers that built their own map from a date-range query
  // therefore had nothing for exactly the normal case — payment lags the invoice date and often
  // crosses a quarter — so a mixed-rate invoice (21% materials + 9% labour) paid one quarter
  // later blended back to a single derived rate and landed wholly in one rubriek, which is the
  // very thing the split exists to prevent. Built HERE so every consumer of this one entry point
  // gets it and none of them can disagree.
  const settledSales = [
    ...new Map(
      qs.events
        .filter((e) => e.direction === "outgoing")
        .map((e) => [e.invoiceId, { id: e.invoiceId, total_ex_btw: e.headerEx, btw_amount: e.headerBtw }]),
    ).values(),
  ];
  const { rateShares: rateSharesByInvoice, exemptExByInvoice, degraded: rateSplitDegraded } = await fetchRateShares(
    pipeline, settledSales, { exemptRegime },
  );

  // [VRIJGESTELD · KASSTELSEL] The PURCHASE side of the same argument, and it was missing.
  //
  // Every caller builds deductionByInvoice from collectVatExemption over the invoices DATED in the
  // window. Under cash basis the costs that count are the ones SETTLED in it, and those routinely
  // belong to invoices dated in an earlier quarter. A settled cost with no attribution falls to
  // 'mixed' in the engine (financial-result's bookVoorbelasting default) — the pro-rata share —
  // and that is wrong in BOTH directions: a cost the owner marked 'direct_taxed' loses part of a
  // deduction it was fully entitled to, and one marked 'direct_exempt' gains a share of one it was
  // entitled to none of. The owner attributed their costs and the figure came out as if they had
  // not. Read here, beside the rate mix, for the same reason: one entry point, no caller able to
  // disagree. Only under the regime — off it, bookVoorbelasting ignores the map entirely.
  const settledPurchaseIds = exemptRegime
    ? [...new Set(qs.events.filter((e) => e.direction === "incoming").map((e) => e.invoiceId))]
    : [];
  const { deductionByInvoice, degraded: deductionsDegraded } = await fetchVatDeductions(pipeline, ownerId, settledPurchaseIds);

  // [SCHEME-DEGRADED] Carried, not acted on: see SchemeResolution.degraded.
  const degraded: SchemeDegradation[] = [];
  if (rateSplitDegraded) degraded.push("rate_split");
  if (deductionsDegraded) degraded.push("vat_deduction");

  return {
    scheme: "kas",
    opts: {
      scheme: "kas",
      settlements: qs.events,
      priorByInvoice: qs.priorByInvoice,
      rateSharesByInvoice,
      // Fractions, because a settlement settles a PART of its invoice — see exemptShareOf.
      exemptShareByInvoice: exemptShareOf(settledSales, exemptExByInvoice),
      ...(deductionByInvoice.size > 0 ? { deductionByInvoice } : {}),
      // [AANSLAG] The settled letters' kinds — merged with the caller's own by mergeSchemeOpts.
      ...(qs.taxKindByInvoice && qs.taxKindByInvoice.size > 0 ? { taxKindByInvoice: qs.taxKindByInvoice } : {}),
    },
    undatedPaidCount: qs.undatedPaidCount,
    estimatedPortionCount: qs.estimatedCount,
    degraded,
  };
}
