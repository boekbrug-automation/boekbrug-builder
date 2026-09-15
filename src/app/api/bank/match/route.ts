// src/app/api/bank/match/route.ts
// [BOEK-016] Run the matching engine over the user's pending transactions (phase 3).
//
// This endpoint ONLY computes suggestions. It is idempotent and writes NOTHING:
//   - bank_transactions stays 'pending'
//   - no invoice_id is set, no invoice status changes
// The UI holds the suggestion; the human confirms in phase 4, and only then does the
// existing payment path execute (invoice → 'paid' + bank_transactions → 'matched').
//
// There is no column to persist a suggestion (decision #4: no migration), so suggestions
// are computed on demand and returned to the client.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  matchTransactions,
  isFullyCovered,
  bankLineFullyApplied,
  coveredNumbersRecovered,
  parseReferenceNumbers,
  normalizeRef,
  type InvoiceForMatching,
} from "@/lib/bank-matching";
// [NIET-DEZE-FACTUUR] What the owner has already told us is wrong. A refusal removes a suggestion
// and never promotes one — see the module.
import { applyRejections, rejectionsByTransaction } from "@/lib/bank-rejections";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";
// [WAAROM-WACHT-BANK] Waarom deze regel zichzelf niet koppelde — dezelfde pool als de matcher.
import { judgeBankWait } from "@/lib/bank-waiting-reason";
import { settledOnly, quotedSettledInvoice, quotedInvoiceSet, type QuotedInvoiceRow } from "@/lib/bank-quoted-invoice";
import { findSupplierSumMatch, type SupplierSumCandidate } from "@/lib/bank-batch-reconcile";
// [GEHEUGEN] The owner's own confirmations, read back — see match-memory.ts for what it means.
import { loadMatchMemory } from "@/lib/match-memory-server";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { counterpartHistory, type HistoryLine } from "@/lib/counterpart-history";
import { allocatedByTransaction } from "@/lib/bank-line-budget";
// [SUPPLIER-IBAN] The account a supplier is known to bill from — see supplier-known-iban.ts.
import { fetchSupplierIbans, withSupplierIbans } from "@/lib/supplier-known-iban";
import { attachmentsByTransaction } from "@/lib/bank-attachments";
import { findStornoOrigin, isStornoLine, STORNO_WINDOW_DAYS } from "@/lib/bank-storno";

export async function GET() {
  // 1. Auth — only ever read the authenticated user's own rows.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // service_role is safe here: every query below is pinned to this user's own data.
  const pipeline = createPipelineClient();

  // 2. Pending transactions for this user.
  //    [BANK-MULTI-LINK-PERSIST] Also select invoice_id so we can detect a
  //    partially-linked multi-invoice tx (status still 'pending', but already
  //    carries the last invoice paid against it). Without this the UI loses the
  //    "partially done" state on reload and the tx wrongly falls into "Geen factuur".
  //    [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap. A plain .select() dropped
  //    pending rows 1001+ — they vanished from BOTH the match engine AND the in-page zoekbalk (which
  //    filters this loaded set), so a real unmatched line could be unfindable. Stable id order; the
  //    matcher is order-independent and the UI re-sorts for display.
  let txRows: BankTransactionDbRow[];
  try {
    txRows = await fetchAllRows<BankTransactionDbRow>((from, to) =>
      pipeline
        .from("bank_transactions")
        // [BANK-COUNTERPART-HISTORY] `category` rides along so the card can say what the owner did
        // with this counterpart before. No extra query: these rows are already read in full.
        // [STORNO] type_code / mandate_id / creditor_id: the bank's own direct-debit markers.
        .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status, category, type_code, mandate_id, creditor_id")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "transactions_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const transactions = (txRows ?? []).map((r) =>
    rowToTransaction(r as BankTransactionDbRow)
  );

  if (transactions.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { pending: 0, auto: 0, choice: 0, none: 0 },
      suggestions: [],
    });
  }

  // 3. Candidate invoices: this user's own (sent or received), not already paid.
  //    isEligible() in the matcher still enforces direction/sign, draft/archived,
  //    and the B.4 'verwerkt' guard — this query is just a fast-path payload reducer.
  // [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap — the five other reads in
  // this file already do. A truncated CANDIDATE set is the worst kind of truncation: the correct
  // invoice is simply absent from the matcher's input, so a real payment renders as
  // "Geen factuur" with no error anywhere. An owner past 1000 open invoices would see matching
  // quietly stop working for their oldest ones.
  let invRows: unknown[] = [];
  let invErr: { message: string } | null = null;
  try {
    invRows = await fetchAllRows((from, to) =>
      pipeline
        .from("invoices")
        .select(
          // [PARTIAL-PAY] amount_paid lets the matcher target the REMAINING balance so the next
          // instalment matches on amount.
          // [CREDIT-TEKEN] invoice_type: this list feeds the quote pool below, and an OPEN creditnota
          // arrived there without its kind. A € 136,00 credit then counted as +136 in a payment's
          // total instead of −136 — a € 272,00 error on a € 170,27 debit, on screen, in production.
          "id, invoice_number, total_inc_btw, amount_paid, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id, invoice_type"
        )
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .neq("status", "paid")
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    invErr = { message: e instanceof Error ? e.message : String(e) };
  }
  if (invErr) {
    return NextResponse.json(
      { error: "invoices_lookup_failed", detail: invErr.message },
      { status: 500 }
    );
  }

  // [NIET-DEZE-FACTUUR] The pairs this owner has refused. One read, grouped per transaction — a
  // refusal is about a PAIR, and flattening it to a set of invoice ids would hide that invoice on
  // every other line as well.
  //
  // [DEPLOY-SAFE] bank_match_rejections.sql is applied by hand; until it is, this read fails and an
  // empty map means "nothing refused", which is exactly today's behaviour. Logged, not raised: the
  // page is worth showing either way.
  let rejectedByTx = new Map<string, Set<string>>();
  // [BLIND-GEMATCHT] Two signals this page can lose without any visible sign: the memory of
  // what the owner already confirmed, and the list of suggestions they refused. Losing either
  // makes the matcher answer worse than it did yesterday, for a reason nobody can see. So the
  // loss travels with the answer.
  let refusalsUnavailable = false;
  let memoryUnavailable = false;
  try {
    const rejectRows = await fetchAllRows<{ transaction_id: string | null; invoice_id: string | null }>(
      (from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pipeline as any)
          .from("bank_match_rejections")
          .select("transaction_id, invoice_id")
          .eq("user_id", user.id)
          .order("id", { ascending: true })
          .range(from, to),
    );
    rejectedByTx = rejectionsByTransaction(rejectRows);
  } catch (e) {
    // [BLIND-GEMATCHT] Recorded, not only logged. A refused suggestion coming back is the app
    // asking a question the owner already answered — and if nobody says why, the owner's
    // conclusion is that their ✗ does not stick.
    refusalsUnavailable = true;
    console.warn("[NIET-DEZE-FACTUUR] refusals could not be read — a refused suggestion may come back", {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    });
  }

  // [SUPPLIER-IBAN] The account each supplier is known to bill from, for the invoices whose own
  // document never named one. Best-effort: an empty map leaves the matcher exactly as it was.
  // [BLIND-LEVERANCIER] …and when that map is empty because the READ failed, it joins the two
  // losses already carried below: same channel, same rule — only when there is something to admit.
  const rawInvoices = (invRows ?? []) as (InvoiceForMatching & { supplier_id?: string | null })[];
  const supplierIbans = await fetchSupplierIbans(pipeline, user.id, rawInvoices);
  const supplierIbansUnavailable = supplierIbans.unavailable;
  const invoices: InvoiceForMatching[] = withSupplierIbans(rawInvoices, supplierIbans.ibans);

  // [GEHEUGEN] What the owner has already confirmed, read back. Derived from the link rows a
  // confirmation writes anyway — there is no memory table, so there is nothing to migrate and
  // nothing that can drift from what actually happened. See match-memory.ts.
  //
  // Best-effort in the strongest sense: a failed read leaves `null`, and the matcher then reasons
  // purely from the payment exactly as it did before. A memory that could not be loaded is not a
  // reason to show the owner a worse answer than yesterday's, and this GET renders the whole bank
  // page.
  const memory = await loadMatchMemory(pipeline, user.id).catch((e) => {
    memoryUnavailable = true;
    console.error("[GEHEUGEN] confirmed-match memory read failed — matching without it", e);
    return null;
  });

  // 4. Run the pure matcher.
  // [BANK-BIG-BUNDLE] maxCandidates raised from the default 5: a wholesaler bundle routinely
  // lists 6-10 invoice numbers in one debit, and the UI resolves its slots FROM this candidate
  // list — a truncated list rendered existing invoices as "missing" slots with an upload
  // control, inviting a duplicate import of a bill that was already there. Fifteen covers any
  // realistic bundle; the choice-list UI still shows only the top few.
  // The matcher runs BELOW, once the applied amounts are known — see [REST-MATCHT].

  // [BANK-MULTI-LINK-PERSIST] Partial-link coverage. A multi-invoice tx that has
  // already had ONE invoice paid against it keeps status='pending' + an invoice_id.
  // Its remaining candidates may now be zero (the only matching invoice is paid and
  // excluded above) → the matcher would label it 'none' and the UI would bury it in
  // "Geen factuur". To keep it in "Te bevestigen" until every reference number is
  // paid, we compute allCovered here (server-side, so it survives a reload) and tell
  // the UI which transactions are partially linked. Same shared rule as confirm.
  //
  // We only need paid invoice numbers when at least one pending tx is already linked.
  const linkedTxRows = (txRows ?? []).filter(
    (r) => (r as BankTransactionDbRow).invoice_id != null
  );
  const partialLink = new Map<string, boolean>(); // txId → allCovered
  // [BANK-SLOT-PERSIST] Per-tx list of reference numbers already paid — so the UI marks
  // those slots "Betaald" on reload instead of showing an already-paid invoice as open.
  const coveredByTx = new Map<string, string[]>();
  // [BANK-ONE-PAYMENT-MANY-INVOICES] How much of each still-pending bank line is already
  // booked on invoices. A line stays pending precisely because money of it is unassigned, and
  // the owner cannot act on "still here" without knowing how much is left. Read from the join
  // table's amount_applied — the same figure every booking path now writes.
  const appliedByTx = new Map<string, number>();
  // [BANK-COVERAGE-BY-MONEY] Can this line's applied total be MEASURED? Only when it has join
  // rows and every one of them carries an amount. A single amount-less (pre-[PARTIAL-PAY]) link
  // makes the sum a lower bound, not the truth — then we must not answer "covered" from it.
  const hasLinkRow = new Set<string>();
  const amountUnknown = new Set<string>();

  if (linkedTxRows.length > 0) {
    // [IN-CHUNK] Chunked + paged. A plain `.in()` over every partially-linked line hits both
    // silent ceilings: the ~1000-row response cap and the URL length of the id list. A truncated
    // read UNDERSTATES amount_applied, so bankLineFullyApplied answers "not covered" for a line
    // whose every euro is booked and it never leaves "Te bevestigen".
    // Wrapped, because fetchAllRowsForIds THROWS where the old `data`-only destructuring
    // swallowed — and this GET renders the whole bank page. A failed measurement is not a reason
    // to show the owner nothing: it has a documented fallback (measuredAllCovered returns null →
    // isFullyCovered's token rule), which is conservative and keeps every line visible. Leaving
    // hasLinkRow empty is exactly that fallback, so the page degrades instead of dying.
    let appliedRows: { transaction_id: string | null; invoice_id: string; amount_applied: number | null }[] = [];
    try {
      appliedRows = await fetchAllRowsForIds<{ transaction_id: string | null; invoice_id: string; amount_applied: number | null }, string>(
        linkedTxRows.map((r) => (r as BankTransactionDbRow).id),
        (chunk, from, to) =>
          pipeline
            .from("bank_tx_invoices")
            .select("transaction_id, invoice_id, amount_applied")
            .eq("user_id", user.id)
            .in("transaction_id", chunk)
            .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
            .range(from, to),
      );
    } catch (e) {
      console.error("[BANK-COVERAGE-BY-MONEY] applied-amount read failed — falling back to the reference-token rule", e);
    }
    for (const r of appliedRows) {
      const txId = r.transaction_id;
      if (!txId) continue;
      hasLinkRow.add(txId);
      if (r.amount_applied == null) amountUnknown.add(txId); // pre-[PARTIAL-PAY] link: amount unknown, don't guess
    }

    // [CREDITNOTA] The sum is SIGNED, and on this screen the magnitude version does not merely
    // report a wrong number — it makes money disappear from the owner's to-do list.
    //
    // An €850 debit made of a €150 supplier credit and a €700 invoice still has €300 to assign.
    // Counted as magnitudes that is 150 + 700 = 850, bankLineFullyApplied answers "every euro is
    // booked", and the line leaves "te bevestigen" with €300 nobody will look at again. Signed it
    // is 700 − 150 = 550 against 850, and the line stays where the owner can see it.
    //
    // The extra read is the invoice TYPES of the links we just found — one chunked query on a
    // screen that already runs several, and the alternative is a screen that hides money.
    const priced = appliedRows.filter((r) => r.transaction_id && r.amount_applied != null);
    if (priced.length > 0) {
      try {
        const linkedInvoices = await fetchAllRowsForIds<{ id: string; direction: string | null; invoice_type: string | null; total_inc_btw: number | null }, string>(
          [...new Set(priced.map((r) => r.invoice_id))],
          (chunk, from, to) =>
            pipeline
              .from("invoices")
              .select("id, direction, invoice_type, total_inc_btw")
              .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to),
        );
        // Each line's own signed amount. Which way a link counts depends on the DIRECTION of the
        // line it sits on — the same creditnota gives money back to a debit and spends a credit —
        // so a screen measuring many lines at once has to say which is which. These rows are
        // already in hand (txRows), so this costs nothing.
        const txAmountById = new Map(
          (txRows ?? []).map((r) => [(r as BankTransactionDbRow).id, Number((r as BankTransactionDbRow).amount) || 0]),
        );
        const { byTransaction, unknownByTransaction } = allocatedByTransaction(priced, linkedInvoices, txAmountById);
        for (const [txId, total] of byTransaction) appliedByTx.set(txId, total);
        // A link to an invoice we could not read makes the total a guess, exactly like a missing
        // amount does — same set, same conservative outcome.
        for (const txId of unknownByTransaction.keys()) amountUnknown.add(txId);
      } catch (e) {
        // Same degradation as the read above: unmeasured, never mis-measured. Marking every line
        // unknown sends measuredAllCovered to null and the reference-token rule takes over, which
        // keeps lines VISIBLE — the safe direction for a screen whose job is to show what is left.
        console.error("[BANK-COVERAGE-BY-MONEY] invoice-type read failed — falling back to the reference-token rule", e);
        for (const r of priced) if (r.transaction_id) amountUnknown.add(r.transaction_id);
      }
    }
  }
  /** Is every euro of this bank line sitting on an invoice? Measured, not guessed —
   *  null when the line has no measurable applied total (caller falls back). */
  const measuredAllCovered = (row: BankTransactionDbRow): boolean | null =>
    !hasLinkRow.has(row.id) || amountUnknown.has(row.id)
      ? null
      : bankLineFullyApplied(row.amount, appliedByTx.get(row.id) ?? 0);

  // [REST-MATCHT] A line partly booked on an invoice offers its REMAINDER to the matcher, not its
  // full amount. A € 1.000 line with € 600 on invoice A never suggested the € 400 invoice B: the
  // matcher compared B against € 1.000, the card said "€ 400 nog toe te wijzen" and offered
  // nothing, and the owner had to find Verdelen by hand. Only where the applied total is
  // MEASURED (every link priced); an unmeasured line keeps its full amount, as before.
  const matcherInput = transactions.map((t, i) => {
    const row = (txRows ?? [])[i] as BankTransactionDbRow | undefined;
    if (!row || !hasLinkRow.has(row.id) || amountUnknown.has(row.id)) return t;
    const applied = appliedByTx.get(row.id) ?? 0;
    if (applied <= 0) return t;
    const magnitude = Math.abs(Number(row.amount) || 0);
    const rest = Math.max(0, magnitude - applied);
    if (rest <= 0.01) return t;
    return { ...t, amount: (Number(row.amount) || 0) < 0 ? -rest : rest };
  });
  const result = matchTransactions(matcherInput, invoices, { maxCandidates: 15, memory });

  if (linkedTxRows.length > 0) {
    // Paid invoice numbers for this user, both directions (cheap, single read).
    // isFullyCovered does equality on normalized numbers; direction already fixed
    // the candidate set when each link was confirmed, so a plain paid-number set is
    // sufficient here for the presence check.
    // [SEARCH-FULL-COVERAGE] Paged: a truncated paid-set makes isFullyCovered answer "no" for a
    // transaction whose invoices are all settled, so it never leaves "Te bevestigen".
    const paidRows = await fetchAllRows<{ invoice_number: string | null }>((from, to) =>
      pipeline
        .from("invoices")
        .select("invoice_number")
        .eq("status", "paid")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("id", { ascending: true })
        .range(from, to)
    );

    const paidSet = new Set(
      (paidRows ?? [])
        .map((r) => normalizeRef(r.invoice_number ?? ""))
        .filter((n) => n.length > 0)
    );

    for (const r of linkedTxRows) {
      const row = r as BankTransactionDbRow;
      // [BANK-COVERAGE-BY-MONEY] Is this bank line finished? Answer it with the SAME arithmetic
      // /api/bank/confirm uses to decide it (`payAmount − Σ amount_applied ≤ 0.01`), because the
      // two must never disagree — and they did. confirm was moved to money by
      // [BANK-ONE-PAYMENT-MANY-INVOICES]; this route was left counting number-shaped tokens in the
      // reference, so a line whose every euro was booked still reported allCovered=false whenever a
      // reference token was not a paid invoice number (a customer/order number, a POS batch counter,
      // or free text the extractor fell back to). The UI keeps such a line in "Te bevestigen"
      // forever; confirming it again only earns a 409 (`payment_fully_applied` /
      // `invoice_already_paid`), which the client treats as done and then re-fetches — so the card
      // reappears on every single confirm, with no action able to clear it. The reference cannot
      // answer "is the money spent?"; only the money can. The token rule survives ONLY as the
      // fallback for links written before amount_applied existed, where nothing is measurable —
      // there it stays conservative (an unresolved number keeps the line visible, never hides on
      // doubt), exactly as confirm's own fallback does.
      partialLink.set(row.id, measuredAllCovered(row) ?? isFullyCovered(row.reference, paidSet));
      // [BANK-SLOT-RECOVERED] Answer in the PAID invoices' own full numbers, not in reference
      // tokens. For a recovered bundle the two vocabularies never met: the extractor stores
      // "2026-045" as the token "045", the slot key is the invoice's real number, and the paid
      // set holds "2026045" — token-equality matched nothing, so after a reload a genuinely
      // PAID slot reverted to an open "Koppelen" that invited booking the same bill twice.
      coveredByTx.set(row.id, coveredNumbersRecovered(row.reference, paidSet));
    }
  }

  // [BANK-PAID-EXPLAINED] A purchase debit that settles an invoice already marked paid by hand in
  // Crediteuren must NOT be flagged as a "missende inkoopfactuur — voorbelasting niet geclaimd": the
  // invoice exists, is paid, and its BTW is already in the aangifte (accrual). The matcher above
  // excludes paid invoices (.neq status paid), so such a debit falls to outcome 'none' and the UI
  // raises a FALSE missing-invoice alarm the owner can never clear. Re-run the scorer against PAID
  // invoices (as explain-only candidates: status forced 'received' so isEligible admits them, and
  // amount_paid zeroed so the remaining-aware amount targets the full total). A strong hit
  // (reference/iban + amount) means the debit is explained. Display-only — nothing is re-paid.
  // [CIRKEL-PERF] Both explain passes exist for ONE consumer: the 'Geen factuur' card and its
  // missing-invoice banner, which only ever read explainedByPaid/Queued on outcome 'none' debits
  // (BankClient noMatch filter + the none-card). Scoring every explain candidate against ALL
  // transactions ran the O(n·m) matcher over thousands of already-matched lines for nothing —
  // measured ~9s alone on 3000 tx × 1500 paid invoices, on a route the tab-return refresh now
  // calls repeatedly. The unexplained set is a handful of lines on a healthy account.
  const unexplained = result.matches
    .filter((m) => m.outcome === "none" && (m.transaction.amount ?? 0) < 0 && m.transaction.transactionId)
    .map((m) => m.transaction);

  // [AL-GEBOEKT] …and one more set of lines needs those same paid rows: the ones that DID get a
  // candidate list. Both explain passes are gated on `outcome === "none"` because of a single
  // assumption written into this route — *bij een kandidatenlijst is die lijst het antwoord*. That
  // is true until the list is wrong, which is exactly what a screenshot from /bank showed: a
  // € 797,86 payment quoting `USTD//2919045/` offered three invoices of € 2.449, € 2.822 and
  // € 3.008, because invoice 2919045 (€ 797,86, same supplier) was already paid and therefore
  // ineligible. Confirming one of those books this payment against a different, genuinely open
  // bill. So a pending debit that quotes anything at all gets the paid rows too — the check itself
  // is a string test over the SETTLED slice, not another O(n·m) scoring pass ([CIRKEL-PERF]).
  const quotedCheckNeeded = result.matches.some(
    (m) =>
      (m.transaction.amount ?? 0) < 0 &&
      m.transaction.transactionId &&
      (m.transaction.reference || m.transaction.description),
  );
  const paidInvRows = unexplained.length === 0 && !quotedCheckNeeded ? [] : await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      // [BON-AUTO] field_confidence carries _intake_kind — the one thing that tells a KASSABON from
      // an invoice here, and it decides which evidence is enough below.
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id, field_confidence, invoice_type")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );
  // [BON-AUTO] Which of those paid invoices are kassabonnen. A bon has no invoice number and no
  // vendor IBAN — a till does not print either — so the rule below can never be satisfied for one,
  // and every pin-paid bon turned its own bank debit into a "missende inkoopfactuur" the owner
  // could not clear. The receipt IS the missing document; it is sitting right there, paid.
  const receiptIds = new Set(
    (paidInvRows ?? [])
      .filter((r) => {
        const fc = (r as { field_confidence?: unknown }).field_confidence;
        return !!fc && typeof fc === "object" && (fc as { _intake_kind?: unknown })._intake_kind === "receipt";
      })
      .map((r) => (r as { id: string }).id),
  );
  // The ONE evidence bar for "this debit is explained by that invoice", shared by the paid pass
  // and the [CIRKEL] queued pass so the two can never drift: a quoted reference or the vendor's
  // IBAN plus the amount — or, for a kassabon (which has neither), the shop name, the exact
  // amount and the day agreeing. [BON-AUTO]: three independent axes are the only evidence this
  // document class can produce; that is identification, not a weaker guess.
  const strongExplain = (sig: string[], isReceipt: boolean): boolean =>
    ((sig.includes("reference") || sig.includes("iban")) && sig.includes("amount")) ||
    (isReceipt && sig.includes("counterpart") && sig.includes("amount") && sig.includes("date"));

  // [CIRKEL-BEST-TIE] An explain pass scans CANDIDATES, not only m.best: the greedy 1:1 pass
  // nulls `best` on a near-tie (two same-amount invoices from one supplier — the duplicate-rent
  // shape), and the explain question is display-only, so a strong tie explains just as well.
  const explainHit = (
    m: { best: { signals: string[]; invoiceId: string } | null; candidates: Array<{ signals: string[]; invoiceId: string }> },
    isReceipt: (id: string) => boolean,
  ): { invoiceId: string } | null => {
    if (m.best && strongExplain(m.best.signals, isReceipt(m.best.invoiceId))) return { invoiceId: m.best.invoiceId };
    const c = (m.candidates ?? []).find((cand) => strongExplain(cand.signals, isReceipt(cand.invoiceId)));
    return c ? { invoiceId: c.invoiceId } : null;
  };

  // [AL-GEBOEKT] The settled slice, built once for every line rather than per line.
  const settledForQuote = settledOnly((paidInvRows ?? []) as QuotedInvoiceRow[]);
  // [SOM-KLOPT] The pool quotedInvoiceSet looks a named number up in: the settled slice PLUS the
  // open invoices the matcher itself was given. Same list the chooser is drawn from, deliberately —
  // an explanation built on a different set explains a decision that was never taken.
  const quotePool: QuotedInvoiceRow[] = [
    ...settledForQuote,
    // [CREDIT-TEKEN] No cast. This was `as unknown as QuotedInvoiceRow[]`, and an unchecked cast is
    // exactly how invoice_type went missing here without one compiler warning: the shape is the
    // thing being asserted, so asserting it by hand defeats the only check there was.
    ...invoices,
  ];

  const paidExplained = new Set<string>();
  if ((paidInvRows ?? []).length > 0 && unexplained.length > 0) {
    // [CIRKEL-VERWERKT] accountant_status must be CLEARED on the explain-only candidates:
    // isEligible refuses 'verwerkt' rows first, so an accountant locking a quarter's paid
    // invoices re-opened every one of their debits as a false "missende inkoopfactuur" — the
    // exact alarm this pass exists to kill.
    const paidAsCandidates = (paidInvRows as InvoiceForMatching[]).map((r) => ({ ...r, status: "received", amount_paid: 0, accountant_status: null }));
    const explainResult = matchTransactions([...unexplained], paidAsCandidates);
    for (const m of explainResult.matches) {
      const id = m.transaction.transactionId;
      if (!id) continue;
      if (explainHit(m as never, (invId) => receiptIds.has(invId))) paidExplained.add(id);
    }
  }

  // [CIRKEL] The SAME rescue for invoices still sitting in the verify queue ('processing'). The
  // matcher rightly excludes them from bookable candidates (an unverified amount must not book),
  // so their debit fell to outcome 'none' and the missing-invoice banner then told the owner to
  // "toevoegen of ophalen" — to upload a document the app is ALREADY HOLDING one tap away from
  // verified. That is the circle breaking loudest: the bank page sending the owner to re-create
  // what the incoming page has. Explain-only, exactly like the paid pass: a strong hit names the
  // queued invoice so the UI can link STRAIGHT to its verify step; nothing books, nothing pays.
  const queuedExplained = new Map<string, { invoiceId: string; invoiceNumber: string | null }>();
  if (unexplained.length > 0) {
    const queuedRows = await fetchAllRows((from, to) =>
      pipeline
        .from("invoices")
        // [CREDIT-TEKEN] invoice_type for the same reason as the two reads above: whichever of these
        // lists a document arrives on, its kind must arrive with it.
        .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id, field_confidence, invoice_type")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .eq("status", "processing")
        .order("id", { ascending: true })
        .range(from, to),
    );
    if ((queuedRows ?? []).length > 0) {
      const queuedReceiptIds = new Set(
        (queuedRows ?? [])
          .filter((r) => {
            const fc = (r as { field_confidence?: unknown }).field_confidence;
            return !!fc && typeof fc === "object" && (fc as { _intake_kind?: unknown })._intake_kind === "receipt";
          })
          .map((r) => (r as { id: string }).id),
      );
      const queuedAsCandidates = (queuedRows as InvoiceForMatching[]).map((r) => ({ ...r, status: "received", amount_paid: 0, accountant_status: null }));
      const queuedResult = matchTransactions([...unexplained], queuedAsCandidates);
      const byId = new Map((queuedRows ?? []).map((r) => [(r as { id: string }).id, r as { id: string; invoice_number: string | null }]));
      for (const m of queuedResult.matches) {
        const id = m.transaction.transactionId;
        if (!id) continue;
        const hit = explainHit(m as never, (invId) => queuedReceiptIds.has(invId));
        if (hit) {
          const inv = byId.get(hit.invoiceId);
          if (inv) queuedExplained.set(id, { invoiceId: inv.id, invoiceNumber: inv.invoice_number });
        }
      }
    }
  }

  // [BANK-COUNTERPART-HISTORY] What the owner already decided about each counterpart. Computed
  // from the rows we ALREADY hold — no extra round trip — and only over lines that carry a
  // category, so it reports answers rather than a pile of other open questions.
  const historyPool: HistoryLine[] = (txRows as unknown as HistoryLine[]).map((r) => ({
    counterpart_name: r.counterpart_name ?? null,
    counterpart_iban: r.counterpart_iban ?? null,
    category: r.category ?? null,
  }));

  // 5. Shape a lean DTO for the UI. transactionId === bank_transactions.id.
  const suggestions = result.matches.map((raw) => {
    const txId = raw.transaction.transactionId;
    // [NIET-DEZE-FACTUUR] Applied FIRST, so everything below — the outcome, the reference verdict,
    // the sum suggestion, what the screen pre-selects — is computed on what is actually still on
    // offer. Applying it later would leave a refused invoice deciding the shape of the card it is
    // no longer in.
    const pruned = txId != null ? applyRejections(raw, rejectedByTx.get(txId)) : null;
    const m = pruned
      ? { ...raw, outcome: pruned.outcome as typeof raw.outcome, best: pruned.best, candidates: pruned.candidates }
      : raw;
    const isLinked = txId != null && partialLink.has(txId);
    // [BANK-SUM-SUGGEST] A payment that is EXACTLY the sum of 2..4 open invoices from EXACTLY
    // this counterparty, with nothing quoted, used to render as "Geen factuur" — the one case
    // where the owner had to reconstruct the arithmetic by hand. Computed only for lines the
    // matcher found NOTHING for (a candidate list is a better answer), and it is a SUGGESTION:
    // the UI offers it, every booking still goes through the guarded per-invoice confirm.
    const sumMatch =
      m.outcome === "none" && !isLinked
        ? findSupplierSumMatch({
            amount: m.transaction.amount,
            counterpartName: m.transaction.counterpartName,
            counterpartIban: m.transaction.counterpartIban,
            invoices: invoices as SupplierSumCandidate[],
          })
        : null;
    // [SOM-KLOPT] One lookup, read by three consumers below (the card, the waitReason, and the
    // decision to hide the chooser). Computing it three times would not merely cost work — it is
    // how the banner and the card managed to say opposite things about the same payment.
    const quotedSet =
      (m.transaction.amount ?? 0) < 0 && !isLinked
        ? quotedInvoiceSet(
            {
              amount: m.transaction.amount,
              reference: m.transaction.reference,
              description: m.transaction.description,
            },
            // [SOM-KLOPT] Settled AND open. Handed only the settled ones, this reports a named
            // invoice that is merely still open as "not in your administration" — the same false
            // accusation this task exists to remove, one bucket over.
            quotePool,
          )
        : null;
    return {
      transactionId: txId,
      date: m.transaction.date,
      amount: m.transaction.amount,
      description: m.transaction.description,
      counterpart: m.transaction.counterpartName,
      // [SEARCH] The tegenrekening IBAN — carried so the in-page zoekbalk can find a line by IBAN.
      iban: m.transaction.counterpartIban ?? null,
      // [BANK-COUNTERPART-HISTORY] "Wat deed ik hier de vorige keer mee?" — null when there is
      // nothing honest to say. Reported, never applied: counterpart_memory drives the actual
      // suggestion, and a second hint that could contradict it would be worse than none.
      history: counterpartHistory(
        { counterpart_name: m.transaction.counterpartName, counterpart_iban: m.transaction.counterpartIban ?? null },
        historyPool,
      ),
      // [BANK-REF-DISPLAY] The cleaned invoice number(s) the parser extracted from
      // REMI/Ustrd (e.g. "26702781, 26703066"). The UI shows this instead of the
      // raw description so the owner sees the real reference, not "USTD//...".
      reference: m.transaction.reference,
      outcome: m.outcome,
      best: m.best,
      candidates: m.candidates,
      // [BANK-MULTI-LINK-PERSIST] Persisted (reload-safe) link state. partiallyLinked
      // = this pending tx already has an invoice paid against it; allCovered = every
      // reference number is now paid. The UI keeps a partiallyLinked && !allCovered tx
      // in "Te bevestigen" regardless of `outcome` (it may have no candidates left).
      partiallyLinked: isLinked,
      allCovered: isLinked ? partialLink.get(txId!) === true : false,
      // [BANK-SLOT-PERSIST] Normalized reference numbers already paid against this tx, so
      // the multi-invoice UI marks those slots "Betaald" after a reload (session state gone).
      coveredNumbers: isLinked ? (coveredByTx.get(txId!) ?? []) : [],
      // [BANK-ONE-PAYMENT-MANY-INVOICES] Euros of this bank line already booked on invoices
      // (null when nothing is linked or the links predate amount_applied — then the UI says
      // nothing rather than something wrong).
      appliedAmount: isLinked ? (appliedByTx.get(txId!) ?? null) : null,
      // [BANK-PAID-EXPLAINED] This debit matches an already-PAID invoice → not a missing inkoopfactuur.
      explainedByPaid: txId != null && paidExplained.has(txId),
      // [CIRKEL] This debit matches an invoice still in the verify queue → not missing either; the
      // UI links straight to its verify step instead of asking the owner to upload it again.
      explainedByQueued: txId != null ? queuedExplained.get(txId) ?? null : null,
      // [WAAROM-WACHT-BANK] Waarom deze regel niet zichzelf koppelde, als machinecode — het scherm
      // maakt er een zin van via why-waiting.ts. Alleen voor regels die NIETS vonden: bij een
      // kandidatenlijst is die lijst het antwoord. Dezelfde `invoices` als de matcher kreeg, want
      // een uitleg die op een andere verzameling rekent legt een besluit uit dat nooit genomen is.
      // [SOM-KLOPT] Computed BEFORE waitReason and handed to it, because the two used to be able to
      // contradict each other on one card: the banner said the quoted number was not in the
      // administration while the card below it named that very invoice, paid, to the cent. One
      // fact, read once, used by both.
      quotedSet,
      waitReason:
        m.outcome === "none" && !isLinked
          ? judgeBankWait(
              {
                amount: m.transaction.amount,
                counterpartName: m.transaction.counterpartName,
                counterpartIban: m.transaction.counterpartIban ?? null,
                reference: m.transaction.reference,
                description: m.transaction.description,
              },
              invoices,
              // [SOM-KLOPT] The same lookup the card below uses. Without it rule 1 in judgeBankWait
              // accuses the owner of not having entered an invoice that is sitting in their own
              // administration, settled — the sentence the screenshot caught.
              // Only when EVERYTHING named is booked. With one of them still open there IS
              // something to choose, and "already settled, nothing to choose here" would be the
              // half of the truth that asks for nothing.
              quotedSet?.fullySettled ? quotedSet.settled : null,
            )
          : null,
      // [AL-GEBOEKT] The invoice this payment NAMES, when that invoice exists and is already
      // settled. Not a candidate and never confirmable: it is the answer to "why is nothing here
      // right", and the screen shows it INSTEAD of the chooser. Computed for every pending debit,
      // including the ones that have candidates — those are the dangerous ones.
      quotedSettled:
        (m.transaction.amount ?? 0) < 0 && !isLinked
          ? quotedSettledInvoice(
              {
                amount: m.transaction.amount,
                reference: m.transaction.reference,
                description: m.transaction.description,
              },
              settledForQuote,
            )
          : null,
      // [BANK-SUM-SUGGEST] Unique same-supplier sum tie (or null). Suggestion only — see above.
      sumMatch,
    };
  });

  // [BANK-R1] Already-MATCHED transactions (incl. the app's own auto-bookings). This route used to
  // return pending txs only, so an auto-confirmed payment simply vanished from the UI on reload —
  // the owner saw "4 facturen automatisch" once and then nothing, with no way to see WHICH invoices
  // were booked or to undo one. We now return the matched lines too, shaped as "done" suggestions
  // (allCovered = true), so they populate the "Gekoppeld" tab with a working one-tap Ontkoppelen.
  // Paginated + newest-first: an account can hold >1000 matched lines over several quarters, and
  // the ~1000-row PostgREST cap would otherwise silently drop some — so a booked payment could
  // vanish from "Gekoppeld" and become unreachable to undo. fetchAllRows pages past the cap; the
  // date order means any residual cap drops OLDEST rows, never the current quarter's.
  const matchedRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status")
      .eq("user_id", user.id)
      .eq("status", "matched")
      .order("date", { ascending: false })
      // [PAGE-KEY] date is NIET uniek — een rekening heeft er tientallen op één dag. Een
      // .range()-grens is alleen stabiel over een TOTALE ordening; onder gelijke datums geeft
      // Postgres geen gedefinieerde volgorde, dus een rij kan twee keer langskomen of overgeslagen
      // worden. De toelichting hierboven redeneert over het ~1000-plafond ("de oudste vallen af")
      // en dekt daarmee de andere grens niet: hier verdwijnt een rij niet aan het EIND maar op een
      // paginagrens. En dat is exact wat deze paginering moest voorkomen — de tekst zegt het zelf:
      // "een geboekte betaling kon uit Gekoppeld verdwijnen en onbereikbaar worden om terug te
      // draaien". Een dubbel getoonde regel is de andere kant: dezelfde betaling twee keer.
      .order("id", { ascending: true })
      .range(from, to),
  );
  const matchedTx = (matchedRows ?? []) as BankTransactionDbRow[];

  // Which invoice(s) each matched line paid — the AUTHORITATIVE id-based set (join table), so a
  // batch shows every invoice it settled, not just the representative. One grouped read of the
  // join table + a fallback to the single invoice_id (covers pre-migration lines with no join
  // rows). Best-effort, display only — wrapped so a missing table degrades to the invoice_id path.
  const idsByTx = new Map<string, Set<string>>();
  const linkedNumberById = new Map<string, string | null>();
  for (const r of matchedTx) idsByTx.set(r.id, new Set(r.invoice_id ? [r.invoice_id as string] : []));
  if (matchedTx.length > 0) {
    // [IN-CHUNK] matchedTx is fully paged above, so on a real account it holds thousands of ids —
    // and a plain `.in()` over them fails twice over: the response caps at ~1000 join rows, and
    // the id list itself outgrows the request URL long before that. Both come back as an ordinary
    // error (supabase-js does not throw), which this `data`-only destructuring reads as "no
    // links" — so the Gekoppeld tab quietly lost the invoice numbers of every batch. Chunked +
    // paged; the try/catch still covers a genuinely missing pre-migration table.
    try {
      const linkRows = await fetchAllRowsForIds<{ transaction_id: string | null; invoice_id: string }, string>(
        matchedTx.map((r) => r.id),
        (chunk, from, to) =>
          pipeline
            .from("bank_tx_invoices")
            .select("transaction_id, invoice_id")
            .eq("user_id", user.id)
            .in("transaction_id", chunk)
            .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
            .range(from, to),
      );
      for (const lr of linkRows) {
        const txId = lr.transaction_id;
        if (!txId) continue;
        (idsByTx.get(txId) ?? idsByTx.set(txId, new Set()).get(txId)!).add(lr.invoice_id);
      }
    } catch {
      /* pre-migration: keep the invoice_id fallback already seeded above */
    }
  }
  const allWantIds = new Set<string>();
  for (const s of idsByTx.values()) for (const id of s) allWantIds.add(id);
  const numById = new Map<string, string>();
  if (allWantIds.size > 0) {
    // [IN-CHUNK] Same two ceilings, same silence — a truncated read here left `numById` empty for
    // the dropped ids, so those cards fell back to the raw reference tokens instead of the
    // invoice numbers the payment actually settled.
    try {
      const linkedInvs = await fetchAllRowsForIds<{ id: string; invoice_number: string | null }, string>(
        [...allWantIds],
        (chunk, from, to) =>
          pipeline
            .from("invoices")
            .select("id, invoice_number")
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
      );
      for (const i of linkedInvs) { numById.set(i.id, normalizeRef(i.invoice_number ?? "")); linkedNumberById.set(i.id, i.invoice_number); }
    } catch {
      /* display only — the card falls back to the parsed reference numbers */
    }
  }
  const linkedNumbersByTx = new Map<string, string[]>();
  for (const [txId, ids] of idsByTx) {
    linkedNumbersByTx.set(txId, [...ids].map((id) => numById.get(id) ?? "").filter((n) => n.length > 0));
  }

  // [BANK-AMOUNT-ONLY] Which matched lines were auto-booked on amount+counterpart only (no printed
  // number / IBAN) — those the owner asked to see flagged "controleer". Best-effort + wrapped: a
  // not-yet-applied migration (no auto_match_reason column) just yields no flags, never an error.
  const reasonByTx = new Map<string, string>();
  if (matchedTx.length > 0) {
    // [IN-CHUNK] This one is not cosmetic: the flag it carries is the "controleer" warning on a
    // line the app booked on amount + supplier NAME alone, which [BANK-AMOUNT-ONLY] added
    // precisely because such a match can be the right supplier's WRONG month. Truncating this
    // read removed the warning while leaving the booking — the one combination that must never
    // happen. Chunked + paged; the catch still covers the not-yet-applied migration.
    try {
      const reasonRows = await fetchAllRowsForIds<{ id: string; auto_match_reason: string | null }, string>(
        matchedTx.map((r) => r.id),
        (chunk, from, to) =>
          pipeline
            .from("bank_transactions")
            // auto_match_reason is added by bank_auto_match_reason.sql — not in the generated types.
            .select("id, auto_match_reason")
            .eq("user_id", user.id)
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: { id: string; auto_match_reason: string | null }[] | null; error: { message: string } | null }>,
      );
      for (const rr of reasonRows) {
        if (rr.auto_match_reason) reasonByTx.set(rr.id, rr.auto_match_reason);
      }
    } catch {
      /* pre-migration: no column → no flags (correct — nothing was booked under this tier yet) */
    }
  }

  const linkedSuggestions = matchedTx.map((row) => {
    const t = rowToTransaction(row);
    // The AUTHORITATIVE paid numbers are the actually-linked invoices (join table / invoice_id).
    // Prefer them alone — a bank reference can contain unrelated numeric tokens (order/customer
    // numbers) that parseReferenceNumbers would otherwise show as false "Betaald" slots. Only when
    // NO invoice number is known (a legacy line with no link) do we fall back to the parsed
    // reference so the card still shows something.
    const linkedNums = linkedNumbersByTx.get(row.id) ?? [];
    const covered = linkedNums.length > 0 ? [...new Set(linkedNums)] : parseReferenceNumbers(row.reference);
    return {
      transactionId: row.id,
      date: t.date,
      amount: t.amount,
      description: t.description,
      counterpart: t.counterpartName,
      // [SEARCH] IBAN of the tegenrekening — so a matched line is findable by IBAN too.
      iban: t.counterpartIban ?? null,
      reference: t.reference,
      outcome: "auto" as const, // nominal — it is already done (allCovered), never shown as pending
      best: null,
      candidates: [],
      partiallyLinked: false,
      allCovered: true,
      coveredNumbers: covered,
      // [BANK-AMOUNT-ONLY] 'amount_only' → the Gekoppeld card shows a "controleer" flag.
      matchReason: reasonByTx.get(row.id) ?? null,
      // [OPEN-FACTUUR] The invoices this line paid, by id, so the card can open the document the
      // owner is checking against — the Gekoppeld card showed numbers and no way to the file.
      linkedInvoices: [...(idsByTx.get(row.id) ?? [])].map((id) => ({ invoiceId: id, invoiceNumber: linkedNumberById.get(id) ?? null })),
    };
  });

  // [STORNO] A pending CREDIT the bank marks as a direct-debit event is the reversal of a
  // collection. Find the one matched debit it undoes — same cents, same party, at most 45 days
  // earlier — and put it on the card, so the owner can reopen the invoice with one tap instead of
  // reading "Geen factuur" over a payment that was taken back.
  {
    type StornoRow = BankTransactionDbRow & { type_code?: string | null; mandate_id?: string | null; creditor_id?: string | null };
    const stornos = ((txRows ?? []) as StornoRow[]).filter((r) => isStornoLine({
      id: r.id, amount: r.amount, date: r.date, counterpartIban: r.counterpart_iban, counterpartName: r.counterpart_name,
      description: r.description, reference: r.reference, typeCode: r.type_code, mandateId: r.mandate_id, creditorId: r.creditor_id,
    }));
    if (stornos.length > 0) {
      const amounts = [...new Set(stornos.map((r) => -Math.abs(Number(r.amount) || 0)))];
      const oldest = stornos.reduce<string>((m, r) => (r.date && r.date < m ? r.date : m), stornos[0].date ?? "9999-12-31");
      const since = new Date(Date.parse(`${oldest}T00:00:00Z`) - STORNO_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      // [IN-CHUNK] Chunked + paged like every id-keyed read here; the amounts list is the key.
      const origins = await fetchAllRowsForIds<{ id: string; date: string | null; amount: number | null; counterpart_name: string | null; counterpart_iban: string | null; status: string | null; invoice_id: string | null }, number>(
        amounts,
        (chunk, from, to) =>
          pipeline
            .from("bank_transactions")
            .select("id, date, amount, counterpart_name, counterpart_iban, status, invoice_id")
            .eq("user_id", user.id).eq("status", "matched").in("amount", chunk).gte("date", since)
            .order("id", { ascending: true }).range(from, to),
      ).catch(() => []);
      const pool = origins.map((o) => ({ id: o.id, amount: o.amount, date: o.date, counterpartIban: o.counterpart_iban, counterpartName: o.counterpart_name, status: o.status, invoiceId: o.invoice_id }));
      const pairs = new Map<string, { originTxId: string; originDate: string | null; invoiceId: string }>();
      for (const r of stornos) {
        const hit = findStornoOrigin({
          id: r.id, amount: r.amount, date: r.date, counterpartIban: r.counterpart_iban, counterpartName: r.counterpart_name,
          description: r.description, reference: r.reference, typeCode: r.type_code, mandateId: r.mandate_id, creditorId: r.creditor_id,
        }, pool);
        if (hit && hit.invoiceId) pairs.set(r.id, { originTxId: hit.id, originDate: hit.date, invoiceId: hit.invoiceId });
      }
      if (pairs.size > 0) {
        const invs = await fetchAllRowsForIds<{ id: string; invoice_number: string | null }, string>(
          [...new Set([...pairs.values()].map((p) => p.invoiceId))],
          (chunk, from, to) => pipeline.from("invoices").select("id, invoice_number").in("id", chunk).order("id", { ascending: true }).range(from, to),
        ).catch(() => []);
        const numberOf = new Map(invs.map((i) => [i.id, i.invoice_number]));
        for (const s of suggestions) {
          const p = (s as { transactionId: string | null }).transactionId ? pairs.get((s as { transactionId: string }).transactionId) : undefined;
          if (p) (s as { storno?: unknown }).storno = { ...p, invoiceNumber: numberOf.get(p.invoiceId) ?? null };
        }
      }
    }
  }

  // [BIJLAGE-BIJ-REGEL] The files kept with each line, on every card the screen shows.
  const allSuggestions = [...suggestions, ...linkedSuggestions];
  const attachments = await attachmentsByTransaction(
    pipeline, user.id, allSuggestions.map((s) => (s as { transactionId: string | null }).transactionId).filter((x): x is string => !!x),
  );
  for (const s of allSuggestions) {
    const id = (s as { transactionId: string | null }).transactionId;
    (s as { attachments?: unknown }).attachments = id ? (attachments.get(id) ?? []) : [];
  }
  return NextResponse.json({
    ok: true,
    summary: {
      pending: transactions.length,
      auto: result.autoCount,
      choice: result.choiceCount,
      none: result.noneCount,
    },
    suggestions: allSuggestions,
    // [BLIND-GEMATCHT] What this answer could NOT use. Absent when everything was read, so the
    // screen says nothing on the ordinary day; present is an admission the owner can act on.
    ...(memoryUnavailable || refusalsUnavailable || supplierIbansUnavailable
      ? { degraded: { memory: memoryUnavailable, refusals: refusalsUnavailable, supplierIbans: supplierIbansUnavailable } }
      : {}),
  });
}