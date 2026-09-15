// src/lib/bank-auto-confirm.ts
// [BANK-AUTO-CONFIRM-CORE] The server-side safe-set pass, extracted so the circle closes from
// ANY entry point — the /bank page, an invoice verify, a bank IMPORT, and a background cron —
// not only when a browser happens to sit on /dashboard/bank. It books the two auto tiers:
// 'certain' (invoice number printed in the statement OR supplier IBAN, + amount to the cent —
// booked silently) and 'amount_only' (exact amount + an identity that is not the document's own:
// a strong counterpart name with date proximity, the account the supplier is known to bill from,
// or the owner's own pay-sheet declaration — single clear winner, booked but flagged "controleer";
// under kasstelsel only into a quarter whose aangifte has NOT been filed, see kas-auto-book.ts),
// plus the provably-exact multi-invoice batch ties. Fully reversible (owner can unlink) and audited.
//
// payClient vs pipeline: the invoice→'paid' write goes through `payClient`. A ROUTE passes its
// SESSION client, so the DB 'verwerkt' guard trigger fires with a real auth.uid(); a CRON or a
// server IMPORT (no session) passes the service-role `pipeline`, where the app-level isEligible
// check below is the authoritative guard (it already rejects a 'verwerkt' invoice). The bank
// line link + all reads always use the service-role `pipeline` (user-pinned by user_id).

import type { SupabaseClient } from "@supabase/supabase-js";
import { columnExists } from "@/lib/column-probe";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import {
  matchTransactions,
  autoConfirmTier,
  isEligible,
  ibanMatches,
  type AutoConfirmTier,
  type InvoiceForMatching,
  type TransactionMatch,
} from "./bank-matching";
// [MATCH-CONFIDENCE] The Business Central-shaped second opinion. One-directional: it may
// refuse an automatic booking, never authorise one — see bank-match-confidence.ts.
import { applyConfidenceVeto } from "./bank-match-confidence";
import { rowToTransaction, type BankTransactionDbRow } from "./bank-import";
import { planBatchAutoConfirm, type BatchCandidateInvoice } from "./bank-batch-reconcile";
// [EEN-GELDMUTATIE] recordPaymentLinks is gone from this file on purpose. It UPSERTS the link row
// (replacing amount_applied); confirm_bank_payment writes the same row inside the transaction with
// ON CONFLICT … DO UPDATE SET amount_applied = existing + applied, which ACCUMULATES. Keeping both
// would mean two writers of one row with two different arithmetics, one of them outside the
// transaction that owns it. The door writes the evidence; nobody writes it twice.
import { logAuditAction } from "./audit";
import { createNotification } from "./notifications";
import { getVatScheme } from "./vat-scheme";
// [KAS-AUTO-BOOK] When a kasstelsel owner's amount-only match may book itself — see kas-auto-book.ts.
import { decideKasAutoBook, filingStateOf, filingKey } from "./kas-auto-book";
import { quarterKeyOf } from "./quarter";
// [SUPPLIER-IBAN] The account a supplier is known to bill from — see supplier-known-iban.ts.
import { fetchSupplierIbans, withSupplierIbans } from "./supplier-known-iban";
import { isMissingRelation } from "./pg-missing";
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled"

// [SUPPLIER-IBAN] One invoice row as this module handles it: what the matcher needs, plus the two
// fields only this file reads (the instalment balance and the registry link). Named because it is
// now referenced in three places, and three inline intersections drift.
type MatchableInvoice = InvoiceForMatching & {
  amount_paid?: number | null;
  supplier_id?: string | null;
  supplier_known_iban: string | null;
};

export interface AutoConfirmed {
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number;
  // [JET-GAP0] How sure the booking was: 'certain' (printed reference / IBAN + amount to the cent,
  // or an exact multi-invoice batch tie) vs 'amount_only' (amount + counterpart name, single clear
  // winner — booked but flagged "controleer"). Drives the honesty of the notification body.
  tier: AutoConfirmTier;
  // [MATCH-BUTTON] The settlement date written on the invoice — the BANK LINE's date, not "today".
  // Returned so an on-demand caller can patch its list with the real payment date instead of
  // showing a freshly-paid invoice with an empty date until the next server render.
  paymentDate: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayClient = SupabaseClient<any>;

/**
 * Book every near-certain (transaction, invoice) match for one user. Idempotent + safe to call
 * repeatedly: it only ever touches `pending` transactions and non-`paid` invoices, re-checks the
 * confirm-route invariants per match, and rolls the invoice back on a link race so it never
 * leaves a paid invoice with no bank line. Returns the bookings made (empty if none).
 */
/**
 * [KAS-ACHTER-BANK] How many bookings this run declined for a kasstelsel reason, per reason.
 *
 * An out-parameter rather than a wider return type, and that is a deliberate trade: eleven call
 * sites depend on the array that comes back, and widening it to carry a number that exactly one
 * screen reads would touch all eleven for the benefit of one. Callers that do not pass an object
 * behave exactly as they did.
 */
export interface KasRefusalTally {
  filed_quarter?: number;
  unknown_filing?: number;
  no_payment_date?: number;
}

export async function runBankAutoConfirm(args: {
  payClient: PayClient;
  pipeline: PipelineClient;
  userId: string;
  /**
   * Filled with this run's kasstelsel refusals when supplied. The owner-facing counterpart of the
   * log line at the bottom of this function: "the app deliberately did not book these" is a thing
   * the person waiting for it is entitled to know, and until now only the server log was told.
   */
  refusalsOut?: KasRefusalTally;
}): Promise<AutoConfirmed[]> {
  const { payClient, pipeline, userId } = args;

  // [JET-GAP2] Is the owner on kasstelsel? Under kas the payment DATE an auto-booking writes is
  // VAT-timing truth (it decides the BTW quarter), so an 'amount_only' match — amount + name but NO
  // printed reference — is decided by [KAS-AUTO-BOOK] below rather than booked outright. 'certain'
  // (printed reference / IBAN to the cent) still auto-books under either scheme. Own deploy-safe
  // query; defaults factuur if the vat_scheme migration lags (then amount_only books as before,
  // which is safe under accrual where the pay date is not VAT-timing).
  // `vat_scheme_since` comes along because the election does not reach back: an owner who chose kas
  // in July is on factuurstelsel for Q1 and Q2, and those quarters were never the concern.
  const { data: schemeProf } = await pipeline
    .from("profiles").select("vat_scheme, vat_scheme_since").eq("id", userId).maybeSingle();
  const schemeRow = schemeProf as { vat_scheme?: string | null; vat_scheme_since?: string | null } | null;
  const ownerScheme = getVatScheme(schemeRow?.vat_scheme);
  const ownerSchemeSince = schemeRow?.vat_scheme_since ?? null;

  // [KAS-AUTO-BOOK] Which quarters have already been declared. Only consulted for an amount-only
  // match under kas, so the read is skipped entirely for a factuur owner — no cost where there is
  // no question.
  //
  // The `readOk` flag is the point of the shape. `const { data }` alone turns an outage into an
  // empty set, and an empty set reads as "nothing has been filed" — which is the single answer that
  // authorises booking into a declared quarter. The three states are kept apart all the way to
  // decideKasAutoBook, where "unknown" refuses. A MISSING TABLE is different and is a real answer:
  // btw_filings arrives by hand-applied migration, and where it has not landed nothing can have
  // been filed through it.
  const filedQuarters = new Set<string>();
  let filingsReadOk = true;
  if (ownerScheme === "kas") {
    try {
      const rows = await fetchAllRows<{ year: number; quarter: number }>((from, to) =>
        (pipeline as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (c: string, v: string) => {
                order: (c: string, o: { ascending: boolean }) => {
                  range: (f: number, t: number) => PromiseLike<{ data: { year: number; quarter: number }[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        })
          .from("btw_filings").select("year, quarter").eq("user_id", userId)
          .order("year", { ascending: true }).range(from, to),
      );
      for (const r of rows) filedQuarters.add(filingKey(Number(r.year), Number(r.quarter)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isMissingRelation(message)) {
        // The migration has not landed on this deployment. Nothing was ever filed through a table
        // that is not there — a complete answer, not a blind spot.
        filingsReadOk = true;
      } else {
        filingsReadOk = false;
        console.error("[KAS-AUTO-BOOK] btw_filings unreadable — amount-only bookings stay manual", { userId, message });
      }
    }
  }
  // Why every refusal is counted: the failure mode of this gate is that it stops booking ENTIRELY
  // and the run still returns a clean empty list, which reads identically to a quiet day. Counting
  // them means an outage is visible in the log instead of being indistinguishable from silence.
  const kasRefusals: Partial<Record<"filed_quarter" | "unknown_filing" | "no_payment_date", number>> = {};

  // [AUTO-BOEK-ONGEDAAN] Een regel waarvan de eigenaar een AUTOMATISCHE koppeling heeft
  // teruggedraaid, boeken we niet opnieuw.
  //
  // Ontkoppelen zet de regel terug op 'pending' en de factuur op 'received'/'sent' — precies de
  // toestand waaruit deze functie boekt. Het bewijs is niet veranderd, dus zonder dit filter neemt
  // de eerstvolgende ronde dezelfde beslissing en staat de koppeling er binnen het uur weer. De
  // kop van dit bestand belooft "fully reversible (owner can unlink)"; dit is wat die belofte waar
  // maakt. De regel gaat daarna naar de matcher, waar een mens hem koppelt — wat de bedoeling is
  // van iemand die zojuist heeft gezegd dat de machine het mis had.
  //
  // [DEPLOY-SAFE] De kolom komt uit een met de hand toegepaste migratie. Zonder de kolom zou het
  // filter de HELE lezing laten falen — en dat is geen degradatie maar een auto-confirm die voor
  // iedereen stilvalt — dus hij wordt alleen toegevoegd wanneer de kolom er is. Zolang dat niet
  // zo is gedraagt deze functie zich exact als vandaag.
  const blockedColumn = await columnExists(
    pipeline, "bank_transactions", "auto_book_blocked_at",
    "a booking the owner undid would be made again within the hour",
  );
  const txRows = await fetchAllRows((from, to) => {
    const q = pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status")
      .eq("user_id", userId)
      .eq("status", "pending");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (blockedColumn ? (q as any).is("auto_book_blocked_at", null) : q)
      .order("id", { ascending: true })
      .range(from, to);
  });
  const invRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, amount_paid, payment_prepared_at, supplier_id")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .neq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (txRows.length === 0 || invRows.length === 0) return [];

  const transactions = (txRows as BankTransactionDbRow[]).map((r) => rowToTransaction(r));
  // [SUPPLIER-IBAN] Attach the account each supplier is KNOWN to bill from before any scoring runs.
  // Applied to allInvoices rather than to the filtered pools, so every downstream pass — the 1:1
  // matcher, the batch reconciler, the hidden-competitor scan — sees the same rows. A signal that
  // reaches one pass and not another is a guard that does not exist.
  const rawInvoices = invRows as (InvoiceForMatching & { amount_paid?: number | null; supplier_id?: string | null })[];
  // [BLIND-LEVERANCIER] The lookup now says whether it answered. Nothing here changes on a
  // failure and nothing needs to: this pass only ever BOOKS on a score, a missing signal can only
  // lower one, so a lost read makes it confirm LESS — never wrongly. The two owner-facing entry
  // points render the loss; an automatic pass has no screen to render it on.
  const allInvoices: MatchableInvoice[] = withSupplierIbans(
    rawInvoices,
    (await fetchSupplierIbans(pipeline, userId, rawInvoices)).ibans,
  );
  // [PARTIAL-PAY] Auto-confirm books full-amount matches by writing status='paid' directly (not
  // via apply_bank_payment), so it must NEVER touch an invoice that is mid-instalment (amount_paid
  // > 0): a full-amount payment landing on a partially-settled invoice would over-pay it. Those are
  // left for the human to complete through the partial-aware confirm route (which caps at the
  // remaining balance). A fully-unpaid invoice (amount_paid 0) is unaffected — the common case.
  const invoices = allInvoices.filter((i) => Math.max(0, Number(i.amount_paid ?? 0)) === 0);
  if (invoices.length === 0) return [];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  // [PARTIAL-PAY] The BATCH pass may legitimately settle a partly-paid invoice (see its comment),
  // so it needs an index over every candidate, not just the fully-open 1:1 pool.
  const allById = new Map(allInvoices.map((i) => [i.id, i]));

  // [BANK-PARTLY-CONSUMED] A PENDING bank line that already carries an invoice_id has already
  // paid something: the multi-invoice confirm flow keeps a batch visible for its remaining
  // numbers, and apply_bank_payment leaves a payment pending while money of it is unspent. The
  // 1:1 pass books the FULL amount of such a line against another invoice with no awareness of
  // what it already settled — the same euros counted twice. The batch pass has always skipped
  // these lines (row.invoice_id below); the 1:1 pass must too.
  const partlyConsumedTxIds = new Set(
    (txRows as BankTransactionDbRow[]).filter((r) => r.invoice_id).map((r) => r.id).filter(Boolean),
  );

  // [BANK-PARTLY-CONSUMED] Exclude the partly-consumed lines from the MATCHER's input, not only
  // from the booking loop below. matchTransactions holds a one-to-one guard: the strongest match
  // CLAIMS its invoice and removes it from every other transaction's candidates. Feeding it a
  // line that we are about to skip anyway meant such a line could claim an invoice and then be
  // dropped — so the clean payment that could safely have been booked against that invoice lost
  // it, fell back to 'choice'/'none', and stayed there. Nothing changes between runs, so that was
  // a permanent block, not a transient one. Skipping them here costs nothing: the batch pass
  // reads txRows directly and skips these lines by the same rule.
  // ── [BANK-BATCH-FIRST] The BATCH pass runs BEFORE the 1:1 pass. A printed-number batch tie
  // (every referenced number resolves, one supplier, open amounts sum to the debit TO THE CENT)
  // is the strongest evidence the engine ever has — yet it ran LAST, so a same-supplier
  // same-amount 1:1 line could claim (and amount_only-book) an invoice that provably belonged
  // to a bundle: the bundle then never tied ('incomplete' forever) and its invoice sat linked
  // to the wrong bank line. Strong evidence books first; the 1:1 pass works the leftovers.
  const confirmed: AutoConfirmed[] = [];
  const bookedInvoiceIds = new Set<string>();
  const bookedTxIds = new Set<string>();
  for (const row of txRows as BankTransactionDbRow[]) {
    const txId = row.id;
    if (!txId || row.status !== "pending" || row.invoice_id || bookedTxIds.has(txId)) continue;

    // Candidates exclude anything already booked this run, so two batches can't claim one invoice.
    // [PARTIAL-PAY] The batch pass draws from allInvoices, NOT the 1:1 pool: that pool drops every
    // invoice with amount_paid > 0 because a lone payment against a half-paid invoice is genuinely
    // ambiguous (the restant? a coincidental same-amount line?). A batch carries far stronger
    // evidence — ≥2 referenced numbers, each resolving to exactly one invoice, one supplier, and
    // the sum of the OPEN amounts equal to the cent — so that ambiguity does not exist here.
    const candidates = allInvoices.filter((i) => !bookedInvoiceIds.has(i.id)) as BatchCandidateInvoice[];
    // [BUNDEL-REF-RECOVER] The description travels with the reference: the extractor mutilates any
    // invoice number that carries a prefix or a separator ("2026-045" → "045"), and the raw
    // statement line is where the real number still is.
    const plan = planBatchAutoConfirm({
      reference: row.reference ?? null,
      description: row.description ?? null,
      bankAmount: row.amount ?? null,
      invoices: candidates,
    });
    if (!plan) continue;

    // Resolve against ALL invoices — invById only indexes the fully-open 1:1 pool, so a batch
    // containing a partly-paid invoice would otherwise lose it here and be skipped silently.
    const planInvs = plan.invoiceIds.map((id) => allById.get(id)).filter((x): x is MatchableInvoice => !!x);
    if (planInvs.length !== plan.invoiceIds.length) continue;
    const tx = rowToTransaction(row);
    if (!planInvs.every((inv) => isEligible(tx, inv))) continue; // accountant-'verwerkt' + invariants

    // [BANK-BATCH-ATOMIC] Book the whole tie in ONE database transaction via book_bank_batch —
    // see the RPC's header for the lock/re-verify/all-or-nothing contract. Outcomes: rows ⇒
    // booked · empty ⇒ tx claimed concurrently ⇒ skip · error ⇒ not payable / migration not
    // applied ⇒ the batch stays for the human.
    const { data: bookedRows, error: batchErr } = await payClient.rpc("book_bank_batch", {
      p_user_id: userId,
      p_tx_id: txId,
      p_invoice_ids: plan.invoiceIds,
      p_pay_date: tx.date || null,
    });
    if (batchErr) {
      // [BATCH-STIL] This `continue` used to be the whole handler, and it is the reason a real
      // defect lived here unseen: book_bank_batch raised on EVERY call — a plpgsql "column
      // reference invoice_id is ambiguous" — so multi-invoice auto-confirmation had never booked
      // anything, for anyone. Nothing logged it, nothing counted it, and the comment above says
      // "the batch stays for the human", which is precisely what a working skip looks like. The
      // one place in this file that could hide a bug was the one place that reported nothing,
      // while the pay-rollback forty lines down already knew to wake someone.
      //
      // The outcomes are NOT alike, so they are no longer treated alike:
      //
      //   55000  the RPC's own refusal — an invoice stopped being payable, or the tie stopped
      //          being exact, between the plan and the lock. A race with a human, expected on a
      //          busy account, and genuinely nothing to report. Still silent.
      //   42883 / PGRST202  the function is not there. The migration was never applied and this
      //          entire tier books nothing — invisible from the outside, because "no batches were
      //          booked" reads exactly like "there were no batches".
      //   anything else  the database refused something the plan said was safe. Money did not
      //          move where the app had decided it should, which is not a skip.
      const code = String((batchErr as { code?: string }).code ?? "");
      if (code !== "55000") {
        reportHandledFailure({
          tag: "BANK-BATCH-ATOMIC",
          message:
            code === "42883" || code === "PGRST202"
              ? "book_bank_batch is missing — every multi-invoice batch is silently skipped"
              : "book_bank_batch refused a planned batch for an unexpected reason",
          severity: code === "42883" || code === "PGRST202" ? "feature-off" : "data-integrity",
          // Ids and codes only. Never the amounts — see report-handled.ts.
          context: { userId, txId, invoiceCount: plan.invoiceIds.length, code, error: batchErr.message },
        });
      }
      continue;
    }
    if (!bookedRows || (bookedRows as unknown[]).length === 0) continue;

    for (const inv of planInvs) {
      // A batch tie is 'certain' by construction (every number resolves + the sum equals the debit).
      confirmed.push({ transactionId: txId, invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: inv.total_inc_btw ?? 0, tier: "certain", paymentDate: tx.date || null });
      bookedInvoiceIds.add(inv.id);
    }
    bookedTxIds.add(txId);
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed_batch",
      entityType: "bank_transaction",
      entityId: txId,
      newValue: { invoice_ids: plan.invoiceIds, invoice_count: plan.invoiceIds.length, amount: row.amount ?? 0, reason: "exact_multi_invoice_batch_tie" },
    });
  }

  // ── The 1:1 pass, over what the batch pass left ──────────────────────────────────────────
  const bookable = transactions.filter(
    (t) => !t.transactionId || (!partlyConsumedTxIds.has(t.transactionId) && !bookedTxIds.has(t.transactionId)),
  );
  const soloInvoices = invoices.filter((i) => !bookedInvoiceIds.has(i.id));
  const result = matchTransactions(bookable, soloInvoices);
  // [BANK-AMOUNT-ONLY] Book BOTH auto tiers. 'certain' (printed number / IBAN + amount) is booked
  // silently; 'amount_only' (exact amount + matching counterpart name, single clear winner) is
  // booked too but tagged auto_match_reason='amount_only' so the Gekoppeld tab flags it
  // "controleer". Both use the identical money discipline below and both are one-tap reversible.
  // [MATCH-CONFIDENCE] A second, independent opinion on every pairing the tiers would book, in the
  // shape Business Central publishes it: related party × document number × how many open invoices
  // fall within the amount tolerance → High / Medium / Low. It is wired here rather than inside
  // autoConfirmTier because the amount column needs the whole candidate pool, which lives at this
  // level — and because keeping it out of bank-matching avoids an import cycle.
  //
  // The contract is ONE-DIRECTIONAL: it may turn an automatic booking into a human one, never the
  // reverse. bank-matching's guards (a contradicting printed number, phantomSecond, the identity
  // caps) were each earned from a real wrong booking, and a table imported from another product
  // does not get to overrule them. So this filter can only ever remove.
  //
  // Today it removes nothing — verified by probing the ambiguous cases, and pinned by
  // bank-match-confidence.test.ts. That is the point: the agreement is now asserted rather than
  // believed, so a future change that makes a Low pairing bookable stops here instead of in
  // someone's quarter.
  const autoMatches = applyConfidenceVeto({
    matches: result.matches.map((m) => ({ m, tier: autoConfirmTier(m) })),
    invoiceById: invById,
    // The same eligibility the matcher used, so the amount count cannot disagree with the
    // candidate list it is judging.
    eligibleFor: (tx) => soloInvoices.filter((i) => isEligible(tx, i)),
    onVeto: ({ match, tier, classification }) => {
      console.warn("[MATCH-CONFIDENCE] refused an automatic booking the tiers allowed", {
        userId,
        transactionId: match.transaction.transactionId,
        invoiceId: match.best?.invoiceId,
        tier,
        classification: classification.reason,
      });
    },
  }).filter((x): x is { m: TransactionMatch; tier: AutoConfirmTier } => x.tier !== null);

  for (const { m, tier } of autoMatches) {
    const txId = m.transaction.transactionId;
    const invoiceId = m.best?.invoiceId;
    if (!txId || !invoiceId) continue;
    if (partlyConsumedTxIds.has(txId) || bookedTxIds.has(txId) || bookedInvoiceIds.has(invoiceId)) continue;
    const inv = invById.get(invoiceId);
    if (!inv) continue;

    // [JET-GAP2 + KAS-AUTO-BOOK] Under kasstelsel the pay date an amount-only match writes decides
    // the BTW quarter, so a wrong same-amount pick moves a declared figure. That premise is intact;
    // what changed is where it stops applying. A quarter that has NOT been declared corrects with
    // one tap and never leaves the app — refusing there bought no safety and cost a kasstelsel owner
    // every amount-only booking, forever. A quarter that HAS been declared corrects with a suppletie
    // to the Belastingdienst, and a quarter we could not READ is not "not declared". See
    // kas-auto-book.ts for the full argument; the three refusals are counted below so a silent
    // full-stop (a btw_filings outage) cannot pass as "nothing matched today".
    if (tier === "amount_only") {
      const verdict = decideKasAutoBook({
        tier,
        profileScheme: ownerScheme,
        schemeSince: ownerSchemeSince,
        // The BANK LINE's date — the same value written to payment_date below, never "today".
        paymentDate: m.transaction.date ?? null,
        filingState: filingStateOf(quarterKeyOf(m.transaction.date ?? null), filedQuarters, filingsReadOk),
      });
      if (!verdict.book) {
        kasRefusals[verdict.refusal] = (kasRefusals[verdict.refusal] ?? 0) + 1;
        continue;
      }
    }

    // [BANK-HIDDEN-COMPETITOR] The matcher's "single clear winner" is judged against the VISIBLE
    // candidate pool — but a same-amount invoice sitting in the verify queue ('processing', not yet
    // human-verified) or mid-instalment (amount_paid > 0) is excluded from that pool, so its absence
    // MANUFACTURES false uniqueness. Concrete: a monthly €89 incasso arrives while this month's
    // invoice is still unverified → last month's open invoice is the "only" candidate and books,
    // while the money paid THIS month's bill. When such a hidden same-amount competitor exists, an
    // 'amount_only' match is not genuinely unambiguous — leave it a human one-tap. 'certain'
    // (printed number / IBAN) is supplier-doc identity and stays immune to this.
    // [BANK-IBAN-COMPETITOR] The guard also covers a 'certain' that rests on IBAN alone. An
    // IBAN identifies the SUPPLIER's account, not the document — for a recurring same-amount
    // incasso (huur, lease) every month's invoice shares the vendor_iban AND the amount, so a
    // hidden competitor (this month's bill still in the verify queue) makes an iban-certain
    // exactly as ambiguous as an amount_only. Only a PRINTED NUMBER is document identity and
    // stays immune. Scoped to competitors on the SAME account so an unrelated same-amount
    // invoice never vetoes a genuine iban match.
    const bestSig = m.best?.signals ?? [];
    const ibanCertain = tier === "certain" && bestSig.includes("iban") && !bestSig.includes("reference");
    if (tier === "amount_only" || ibanCertain) {
      const txAmt = m.transaction.amount ?? 0;
      const hiddenCompetitor = allInvoices.some((i) => {
        if (i.id === invoiceId) return false;
        if (!(i.status === "processing" || Math.max(0, Number(i.amount_paid ?? 0)) > 0)) return false;
        if (typeof i.total_inc_btw !== "number") return false;
        // [BANK-OPEN-COMPETITOR] Compare against the OPEN balance as well as the gross total: a
        // mid-instalment invoice whose RESTANT equals this payment is precisely the competitor a
        // restant-sized transfer is likeliest to be paying — matching only the full total let it
        // hide. (paymentExceedsOpenBalance semantics, inlined for the magnitude compare.)
        const total = Math.abs(i.total_inc_btw);
        const open = Math.max(0, total - Math.max(0, Number(i.amount_paid ?? 0)));
        // [BANK-CENTS-EXACT] Integer cents, same rule as amountMatches — a raw float compare
        // made the one-cent tolerance a lottery per euro-pair.
        const near = (v: number) => Math.abs(Math.round(Math.abs(txAmt) * 100) - Math.round(v * 100)) <= 1;
        if (!near(total) && !near(open)) return false;
        // An iban-certain is only contested by an invoice on the SAME supplier account.
        if (ibanCertain) return ibanMatches(m.transaction.counterpartIban, i.vendor_iban);
        return true;
      });
      if (hiddenCompetitor) continue;
    }

    // Defense-in-depth: the same invariants the confirm route enforces (incl. accountant
    // 'verwerkt' exclusion) — authoritative when payClient is service_role (no DB trigger).
    if (!isEligible(m.transaction, inv)) continue;

    // [EEN-GELDMUTATIE] One financial mutation, one transaction. This pass used to write the three
    // halves of a booking itself — invoice → 'paid', bank line → 'matched', and the allocation row
    // — as three separate statements with a hand-written compensating update if the second failed.
    // Its four siblings never did: apply_bank_payment, confirm_bank_payment, allocate_bank_payment
    // and book_bank_batch each take a row lock on the line AND on the invoice, decide, write all
    // three, and commit or roll back as one. This was the only writer outside that contract, and
    // measured in production it is the LARGEST one: 160 of the bookings in the audit trail.
    //
    // What that cost, precisely, and why a compensator is not a transaction:
    //   · the allocation row — the evidence the other two rest on — was written LAST and had no
    //     compensation at all. A failure there left an invoice paid and a line matched with nothing
    //     recording what settled what, which is exactly the state recompute_invoice_amount_paid
    //     reads as "Σ amount_applied = 0" and undoes on the next unlink.
    //   · the rollback could itself fail ([ROLLBACK-LOUD] said so), and a failed compensator is a
    //     broken invariant with a log line, not a rolled-back transaction.
    //   · nothing re-read the LINE's remaining budget, so the one invariant with live violations in
    //     production — Σ amount_applied ≤ |line| — was enforced nowhere on this path.
    //
    // So this books through confirm_bank_payment, the door /api/bank/confirm already uses for a
    // single invoice. Nothing about WHICH invoice is booked changes: the matcher, the tier, the
    // confidence veto, the kas gate, the hidden-competitor scan and the isEligible re-check above
    // are untouched. Only the mutation moves.
    //
    // payClient, not pipeline: this is the actor's money write, so the accountant-'verwerkt'
    // trigger fires with a real auth.uid() wherever a session exists — the same reason the batch
    // pass above calls book_bank_batch on payClient.
    const { data: bookedRows, error: bookErr } = await payClient.rpc("confirm_bank_payment", {
      p_user_id: userId,
      p_tx_id: txId,
      p_invoice_id: invoiceId,
      p_pay_date: m.transaction.date || null,
    });

    if (bookErr) {
      // [VERWERKT-WOORDENLIJST] The refusals this door raises are ORDINARY outcomes for an
      // unattended pass, not faults: between reading the candidates and booking them, a human or
      // another pass may have paid the invoice, the accountant may have locked it, the line may
      // have been spent elsewhere, or the invoice may have left a payable state. Each of those is
      // "skip this one", exactly as the old 0-rows-from-.select() was — and the old code could not
      // tell them apart from a real failure, because it never saw them as errors at all.
      //
      // Matched on the wording the RPCs are contractually held to (the six substrings fourteen
      // callers triage on, plus this repo's own [NOOIT-BETAALBAAR] marker). Anything else IS a
      // fault and is reported, because a database refusing a money write must never be silent.
      const msg = String((bookErr as { message?: string }).message ?? bookErr);
      const expected =
        msg.includes("already fully paid") || msg.includes("already covered") ||
        msg.includes("fully applied") || msg.includes("verwerkt") ||
        msg.includes("no longer payable") || msg.includes("[NOOIT-BETAALBAAR]");
      if (!expected) {
        reportHandledFailure({
          tag: "BANK-AUTO-CONFIRM",
          message: "the payment door refused an auto-confirm — the invoice stays open and the line unmatched",
          severity: "data-integrity",
          context: { userId, invoiceId, txId, code: (bookErr as { code?: string }).code ?? null, error: msg },
        });
      }
      continue;
    }

    // An empty result is the door's own answer to "this line is no longer pending" — someone else
    // claimed it between the read and the write. It is the same skip the old .eq("status","pending")
    // compare-and-set produced, now decided under the line's row lock instead of racing for it.
    if (!Array.isArray(bookedRows) || bookedRows.length === 0) continue;

    // [AUTO-MATCH-REDEN] A UI hint, not money: 'amount_only' means matched on amount + name with no
    // printed reference, and the bank screen flags those "controleer". Deliberately a separate write
    // AFTER the transaction has committed — the booking above is correct whether or not this badge
    // lands, and undoing a correct payment because a label failed is the compensating-rollback
    // thinking this whole change removes. Logged, never rolled back.
    if (tier === "amount_only") {
      const { error: reasonErr } = await pipeline
        .from("bank_transactions")
        // auto_match_reason is added by bank_auto_match_reason.sql and not yet in the generated types.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ auto_match_reason: "amount_only" } as any)
        .eq("id", txId)
        .eq("user_id", userId);
      if (reasonErr) {
        // [ALARM] Not a log line. The money is committed and correct; what failed is the flag that
        // tells the owner this one was matched on amount and name ALONE, with no printed reference.
        // Unflagged, the weakest auto-booking this pass makes is indistinguishable on screen from
        // the strongest — a safeguard the app always offers, silently not offered this once. That
        // is the definition of gate-unavailable, and it is the failure mode this change introduced
        // by moving the badge out of the money transaction, so it is wired to the channel here.
        reportHandledFailure({
          tag: "AUTO-MATCH-REDEN",
          message: "booking is committed, the 'controleer' flag is not — an amount-only match is on screen unflagged",
          severity: "gate-unavailable",
          context: { userId, txId, invoiceId, error: reasonErr.message },
        });
      }
    }


    confirmed.push({ transactionId: txId, invoiceId, invoiceNumber: inv.invoice_number, amount: m.transaction.amount ?? 0, tier, paymentDate: m.transaction.date || null });
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: { transaction_id: txId, invoice_number: inv.invoice_number, amount: m.transaction.amount ?? 0, tier, reason: tier === "amount_only" ? "amount_counterpart_single" : "near_certain_reference_amount" },
    });
  }

  // [JET-GAP1 — DELIBERATELY NOT DONE] Auto-booking a partial-payment instalment was proposed, but
  // the matching engine already makes a considered, documented decision the other way: completing an
  // already-partly-paid invoice is a HUMAN decision, never a silent auto-book (bank-matching.ts caps
  // a partial candidate at 0.6 so it surfaces as a one-tap "restant" suggestion, not an 'auto'). That
  // honours "human intervention at maximum ambiguity" — a partial is genuinely more ambiguous (which
  // instalment? the restant, or a coincidental same-amount line?). So partials stay a human confirm
  // on /bank, by design; the auto path books only fully-open invoices + exact multi-invoice batches.

  // ── [JET-GAP0] The bell lives HERE, inside the core, so it is IMPOSSIBLE to book an invoice
  // paid from ANY of the six entry points (import, verify, cron, /bank page, email) without the
  // owner being told. Before, only two callers notified — the other four moved money silently.
  // The body is honest about tier: an 'amount_only' booking (matched on amount + name, not a
  // printed reference) is flagged "controleer". Best-effort but LOGGED on failure — a swallowed
  // insert must never regress to silent money. (Money is not moved here; a paid invoice is a fact
  // recorded, one-tap reversible under "Bevestigd".)
  if (confirmed.length > 0) {
    const n = confirmed.length;
    const amountOnly = confirmed.filter((c) => c.tier === "amount_only").length;
    const body =
      `${n === 1 ? "1 factuur is" : `${n} facturen zijn`} automatisch herkend in je bankafschrift en op ` +
      `betaald gezet. Bekijk ze onder "Bevestigd" — elke koppeling draai je met één tik terug.` +
      (amountOnly > 0
        ? ` Let op: ${amountOnly === 1 ? "1 koppeling is" : `${amountOnly} koppelingen zijn`} alleen op bedrag ` +
          "herkend (geen factuurnummer in de omschrijving) — controleer die even."
        : "");
    const melding = await createNotification({
      userId,
      title: n === 1 ? "1 factuur automatisch gekoppeld" : `${n} facturen automatisch gekoppeld`,
      body,
      type: "payment",
      // [NOTIF-DEADEND] The body says "bekijk ze onder Bevestigd" — so the bell must
      // actually go there. It carried no link at all, which made the one notification
      // about money the app moved by itself the one you could not open. ?tab=done
      // opens the Bevestigd tab directly (BankClient reads it), where every automatic
      // link is listed and reversible with one tap.
      link: "/dashboard/bank?tab=done",
    });
    // createNotification never throws — it reports. The catch that stood here could not fire.
    if (!melding.ok) {
      console.error("[JET-GAP0] auto-confirm notification insert failed", { userId, error: melding.error });
    }
  }

  // [KAS-AUTO-BOOK] A gate that stops booking entirely returns the same empty list a quiet day
  // returns, so the two must be told apart somewhere. 'unknown_filing' is the one that matters: it
  // means btw_filings could not be read, and every kasstelsel owner's amount-only matches are
  // silently piling up as manual work until someone notices. It is reported as a handled failure
  // rather than logged, because "the automation quietly stopped" is precisely the class of thing
  // nobody notices from a log line.
  if ((kasRefusals.unknown_filing ?? 0) > 0) {
    reportHandledFailure({
      tag: "KAS-AUTO-BOOK",
      message: "btw_filings unreadable — every amount-only booking refused for a kasstelsel owner",
      severity: "gate-unavailable",
      context: { userId, refused: kasRefusals.unknown_filing },
    });
  }
  if (kasRefusals.filed_quarter || kasRefusals.no_payment_date) {
    console.info("[KAS-AUTO-BOOK] refusals this run", { userId, ...kasRefusals });
  }
  // [KAS-ACHTER-BANK] …and out to the caller, so a screen can say it instead of a log file. The
  // owner is looking at exactly these lines wondering why the app left them; "your quarter is
  // already filed, so this one is yours to decide" is the answer, and it was being thrown away.
  if (args.refusalsOut) Object.assign(args.refusalsOut, kasRefusals);

  return confirmed;
}
