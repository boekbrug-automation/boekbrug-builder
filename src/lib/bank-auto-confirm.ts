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
// [STORNO-GEEN-BETALING] The bank's own word for "this money came back" — see direct-debit.ts.
import { readDirectDebit, isBankStatedReversal } from "./direct-debit";
import { recordPaymentLinks } from "./bank-tx-links";
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
      // [DD-NAAR-MATCHER] type_code / mandate_id / creditor_id ride along, and on THIS pass they
      // matter most: it is the one that books without anyone watching. Without them scorePair
      // cannot see that a credit is a returned collection, and the measured case — a bounced
      // incasso booking an open sales invoice to the same company as PAID — happens here.
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status, type_code, mandate_id, creditor_id")
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

    // [STORNO-GEEN-BETALING] The BATCH pass never asks scorePair, so the cap that holds a returned
    // collection back on the 1:1 path does not exist here — this loop goes straight from "the
    // printed numbers sum to the amount" to book_bank_batch, all-or-nothing and silent.
    //
    // Refused rather than lowered, and that is the opposite choice from the 1:1 path on purpose:
    // there a cap leaves the pair LISTED for the owner, which is the whole value. Here there is no
    // dial and no listing — there is a silent multi-invoice booking or nothing — so the only
    // honest lowering is to leave it for the human. /bank still shows the line, its numbers and
    // its storno card.
    if (isBankStatedReversal(readDirectDebit({
      typeCode: row.type_code, mandateId: row.mandate_id, creditorId: row.creditor_id,
      text: `${row.description ?? ""} ${row.reference ?? ""}`, amount: row.amount,
    }))) continue;

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

    // (a) invoice → paid. .select() detects a concurrent pay (0 rows) → skip, never re-own.
    //     [BANK-PAYDATE] the real settlement date is the bank line's date (cross-quarter safe).
    //     [B4-WRITE-GUARD] Re-assert the accountant 'verwerkt' exclusion IN the WHERE clause, not
    //     only in the (possibly minutes-stale) isEligible read above. From cron/import/intake the
    //     payClient is service-role — no DB trigger with auth.uid() — so without this, an invoice
    //     the accountant locked in the read-to-write window was still flipped to 'paid'. The .or
    //     keeps NULL accountant_status matchable (NEQ alone would exclude NULL rows in SQL).
    const { data: payData, error: payErr } = await payClient
      .from("invoices")
      // [PARTIAL-PAY] amount_paid gaat MEE. Deze update zette wel de status op 'paid' en liet de
      // kolom op 0 staan, terwijl de koppeling hieronder het volle bedrag als amount_applied
      // vastlegt. De schermen liegen daar niet van — openAmount leest de status eerst — maar de
      // geldinvariant `amount_paid = Σ amount_applied` is dan geschonden, en money-invariants
      // meldt dat als `payments_without_paid` op /dashboard/klaar: het scherm waar de eigenaar
      // beslist zijn kwartaal weg te geven. Gemeten in de productiedatabase: veertien facturen,
      // samen € 5.321,68, allemaal keurig betaald en allemaal daar als verschil gemeld.
      //
      // Een vals alarm op precies het paneel dat vertrouwen moet kopen is duurder dan geen paneel.
      // Deze pas boekt alleen volledig openstaande facturen op hun hele totaal (zie de filter op
      // amount_paid === 0 hierboven), dus dat totaal is exact wat er is voldaan — hetzelfde
      // bedrag dat de koppeling krijgt, uit dezelfde uitdrukking.
      .update({ status: "paid", amount_paid: Math.abs(Number(inv.total_inc_btw ?? 0)), payment_method: "bank", marked_paid_at: new Date().toISOString(), payment_date: m.transaction.date || null })
      .eq("id", invoiceId)
      .neq("status", "paid")
      .or("accountant_status.is.null,accountant_status.neq.verwerkt")
      .select("id");
    if (payErr) {
      // [BATCH-STIL] Same shape as the batch swallow above, same reasoning. The two EXPECTED
      // outcomes of this write do not arrive as an error at all: an invoice the accountant locked,
      // or one someone else just paid, comes back as zero rows on the next line. So `payErr` is
      // never the ordinary case — it is the database refusing the write, and the invoice stays
      // open while the bank line stays unmatched with nobody told which one.
      reportHandledFailure({
        tag: "BANK-AUTO-CONFIRM",
        message: "marking an invoice paid failed — the bank line stays unmatched",
        severity: "data-integrity",
        context: { userId, invoiceId, txId, code: (payErr as { code?: string }).code ?? null, error: payErr.message },
      });
      continue;
    }
    if (!payData || payData.length === 0) continue; // concurrently paid — not ours to link

    // (b) link the bank line → matched (single invoice ⇒ fully covered). 0 rows ⇒ roll back.
    //     'amount_only' also stamps auto_match_reason so the UI can flag it "controleer". The
    //     column is set ONLY for that tier, so a not-yet-applied migration leaves the 'certain'
    //     path untouched (it never writes the column) — those keep booking; an 'amount_only' write
    //     would just error → roll back → that one line stays a one-tap manual confirm (safe).
    const linkPayload: Record<string, unknown> = { status: "matched", invoice_id: invoiceId };
    if (tier === "amount_only") linkPayload.auto_match_reason = "amount_only";
    const { data: linkData, error: linkErr } = await pipeline
      .from("bank_transactions")
      // auto_match_reason is added by bank_auto_match_reason.sql and not yet in the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(linkPayload as any)
      .eq("id", txId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id");

    if (linkErr || !linkData || linkData.length === 0) {
      // [ROLLBACK-LOUD] The rollback itself can fail (transient DB error) — that leaves an invoice
      // 'paid' with NO linked bank line, the exact state this design promises never exists. It
      // cannot be silent: log it with ids so it is findable and fixable (the owner can also undo
      // via pay-toggle). A double fault is rare; an invisible double fault is a lost truth.
      const { error: rbErr } = await payClient
        .from("invoices")
        // amount_paid gaat mee terug, anders laat een geslaagde terugdraai een factuur achter die
        // niet meer betaald is en toch een bedrag draagt — de spiegelfout van de regel hierboven.
        .update({ status: inv.status, amount_paid: inv.amount_paid ?? 0, payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      if (rbErr) {
        // [ALARM] The code above calls this "the exact state this design promises never exists".
        // A promise nobody is told has been broken is not a promise — this one wakes someone.
        reportHandledFailure({
          tag: "BANK-AUTO-CONFIRM",
          message: "pay rollback FAILED — invoice may be paid with no bank link",
          severity: "data-integrity",
          context: { userId, invoiceId, txId, error: rbErr.message },
        });
      }
      continue;
    }

    // [BANK-TX-INVOICES] Record the exact invoice this payment paid so a later reversal
    // (unlink / delete-statement) reverses by id, never by number. Best-effort — the money-truth
    // is the tx.invoice_id + invoice.status above; this row is only the collision-free undo index.
    // [PARTIAL-PAY] The amount MUST travel with the link: recompute_invoice_amount_paid re-derives
    // invoices.amount_paid as SUM(amount_applied) on every later unlink/undo, so a NULL here would
    // silently zero a genuinely settled invoice. This pass only ever books fully-open invoices
    // (amount_paid === 0, line 97) at their full total, so the applied amount is that total.
    // [LINKS-WRITE-HONEST] De boolean wordt gelezen. Hij bestaat om gelezen te worden, en dit was
    // de vierde plek die hem liet vallen. Zonder koppelrij herleidt recompute_invoice_amount_paid
    // amount_paid bij de volgende ontkoppeling of terugdraai als Σ amount_applied, vindt niets, en
    // zet deze zojuist betaalde factuur terug op haar volle bedrag: geld dat binnen is, als schuld.
    const linksRecorded = await recordPaymentLinks(pipeline, userId, txId, [invoiceId], {
      [invoiceId]: Math.abs(Number(inv.total_inc_btw ?? 0)),
    });
    if (!linksRecorded) {
      // [KOPPELRIJ-OF-NIETS] The paragraph above states the consequence exactly — «geld dat binnen
      // is, als schuld» — and this branch used to REPORT it and then fall through to the success
      // push below. So the one outcome that paragraph calls unacceptable was counted as a
      // successful booking, told to the owner as one, and written to the logbook as one.
      //
      // (The name of that push is deliberately NOT written here. A check that reads this file raw
      // rather than through code() would cut its window on this comment and measure the wrong
      // thing — which is exactly what happened to the first re-measurement of this very fix.)
      //
      // Step (b) already rolls back when ITS write fails. This is the same fault one step later,
      // and it gets the same answer: undo both writes and leave the line for a human. Two writes
      // to undo now, not one, because the tx link DID land.
      //
      // Rolling back is the safe direction for an additional reason: this pass only books
      // fully-open invoices, so nothing is lost by refusing — the line comes back next run, or the
      // owner confirms it with one tap. Booking with no reversal index is what cannot be undone.
      const rollbackTx: Record<string, unknown> = { status: "pending", invoice_id: null };
      if (tier === "amount_only") rollbackTx.auto_match_reason = null;
      const { error: txRbErr } = await pipeline
        .from("bank_transactions")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(rollbackTx as any)
        .eq("id", txId)
        .eq("user_id", userId)
        .eq("status", "matched");
      const { error: invRbErr } = await payClient
        .from("invoices")
        .update({ status: inv.status, amount_paid: inv.amount_paid ?? 0, payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      reportHandledFailure({
        tag: "BANK-TX-INVOICES",
        message: txRbErr || invRbErr
          ? "payment link not recorded AND the rollback failed — invoice may be paid with no reversal index"
          : "payment link not recorded for an auto-confirmed invoice — booking rolled back, the line stays for a human",
        severity: "data-integrity",
        context: {
          userId, invoiceId, txId,
          txRollback: txRbErr ? txRbErr.message : "ok",
          invoiceRollback: invRbErr ? invRbErr.message : "ok",
        },
      });
      continue;
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
