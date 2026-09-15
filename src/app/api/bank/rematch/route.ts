// src/app/api/bank/rematch/route.ts
// [BANK-REMATCH] "Probeer alles opnieuw" — one deliberate pass over the lines the normal flow
// can no longer reach, plus a forced run of the booking pass.
//
// What the app already heals on its own, so this route does NOT need to:
//   a 'pending' line is re-scored against every open invoice on EVERY /bank load, and
//   runBankAutoConfirm books it the moment it turns certain. Nothing rots there.
//
// What it CANNOT heal, and this route exists for:
//   a line the owner set aside ("Genegeerd", status 'not_found') is invisible to
//   /api/bank/match, which reads status='pending' only. It is never looked at again, whatever
//   arrives later. And an owner ignores a payment precisely BECAUSE the invoice was missing —
//   the supplier hadn't sent it, the scan failed, the mail bounced. When the invoice finally
//   lands, every other line in the app finds it; that one cannot, because the reason it was
//   ignored is the reason it can no longer be seen.
//
// Discipline:
//   · Never mass-un-ignore. bank-rematch.planRematch restores a line ONLY when the matcher now
//     gives it a single clear winner AND no active line is working on that invoice. Everything
//     weaker is REPORTED and left alone — handing back the work the owner deliberately cleared
//     is how a button like this loses their trust for good.
//   · It writes exactly one thing: status 'not_found' → 'pending', guarded on the old value. No
//     invoice is touched here. The booking that follows goes through runBankAutoConfirm, i.e.
//     the same guarded, audited, reversible path every other entry point uses.
//   · Idempotent: run it twice and the second run restores nothing new.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { chunkIds, fetchAllRows } from "@/lib/supabase-paginate";
// [SUPPLIER-IBAN] The account a supplier is known to bill from — see supplier-known-iban.ts.
import { fetchSupplierIbans, withSupplierIbans } from "@/lib/supplier-known-iban";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";
import { planRematch } from "@/lib/bank-rematch";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
import { applyLearnedBankCategories } from "@/lib/bank-auto-categorize";
import { type InvoiceForMatching } from "@/lib/bank-matching";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

const TX_COLUMNS =
  "id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // A full re-scan of every transaction against every invoice is the most expensive read in this
  // folder, and the button invites repeat taps ("did it work?"). Same budget as the reconcile run.
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/bank/rematch", ...RATE_LIMITS.RECONCILE_RUN });
  if (!rl.allowed) return rateLimitResponse(rl);

  const pipeline = createPipelineClient();

  // ── Read the whole field: set-aside lines, live lines, open invoices ────────────────────────
  // [PAGINATE] All three page past PostgREST's silent ~1000-row cap. A truncated read here is the
  // worst kind: the line or the invoice is simply absent, so the pass reports "niets gevonden"
  // for a match that was there — the exact false all-clear this button exists to prevent.
  let ignoredRows: BankTransactionDbRow[];
  let pendingRows: BankTransactionDbRow[];
  let invRows: unknown[];
  try {
    ignoredRows = await fetchAllRows<BankTransactionDbRow>((from, to) =>
      pipeline.from("bank_transactions").select(TX_COLUMNS)
        .eq("user_id", user.id).eq("status", "not_found")
        .order("id", { ascending: true }).range(from, to),
    );
    pendingRows = await fetchAllRows<BankTransactionDbRow>((from, to) =>
      pipeline.from("bank_transactions").select(TX_COLUMNS)
        .eq("user_id", user.id).eq("status", "pending")
        .order("id", { ascending: true }).range(from, to),
    );
    invRows = await fetchAllRows((from, to) =>
      pipeline.from("invoices")
        .select("id, invoice_number, total_inc_btw, amount_paid, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .neq("status", "paid")
        .order("id", { ascending: true }).range(from, to),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "rematch_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // [SUPPLIER-IBAN] "Probeer alles opnieuw" must reason from the same evidence the other two entry
  // points have. A signal that reaches the matcher on /bank but not on the rematch sweep would make
  // the two disagree about the same line, which is worse than neither having it.
  const rawInvoices = invRows as (InvoiceForMatching & { supplier_id?: string | null })[];
  // [BLIND-LEVERANCIER] This sweep is the one that most needs to know. It answers "examined
  // everything, nothing new to link" — a sentence the owner reads as a fact about their
  // administratie. Said while a matching signal was missing, it is a fact about a database.
  const supplierIbans = await fetchSupplierIbans(pipeline, user.id, rawInvoices);
  const plan = planRematch({
    ignored: ignoredRows.map(rowToTransaction),
    pending: pendingRows.map(rowToTransaction),
    invoices: withSupplierIbans(rawInvoices, supplierIbans.ibans),
  });

  // ── Reactivate the provable ones ────────────────────────────────────────────────────────────
  // Guarded on status='not_found', so a line the owner restored by hand in another tab (or a
  // concurrent run of this same route) is never flipped twice. `restored` counts rows the
  // database actually changed, never what we intended to change.
  let restored = 0;
  const restoredIds: string[] = [];
  if (plan.restore.length > 0) {
    const ids = plan.restore.map((r) => r.transactionId);
    // [DEPLOY-SAFE] ignore_reason is cleared with the status — a line back in the active list must
    // not carry the explanation of a decision that no longer holds. If bank_ignore_reason.sql is
    // not applied yet the column does not exist and PostgREST refuses the whole update; the
    // reactivation itself must not fail over the note beside it, so retry without it. Mirrors the
    // same fallback in /api/bank/ignore.
    // [IN-CHUNK] Per brok. De id-lijst reist in de URL, dus voorbij een paar honderd sneuvelde
    // deze UPDATE in zijn geheel op een 414 — en dan werd er geen enkele regel heropend terwijl de
    // eigenaar er honderden had aangewezen. restoredIds telt nog steeds alleen wat de database
    // daadwerkelijk teruggaf, zodat het getal blijft zeggen wat er echt is veranderd.
    const applyUpdate = (withReason: boolean, chunk: string[]) =>
      pipeline
        .from("bank_transactions")
        .update((withReason ? { status: "pending", ignore_reason: null } : { status: "pending" }) as never)
        .eq("user_id", user.id)
        .eq("status", "not_found")
        .in("id", chunk)
        .select("id");

    for (const chunk of chunkIds(ids)) {
      let { data: updated, error: updErr } = await applyUpdate(true, chunk);
      if (updErr && /ignore_reason/i.test(updErr.message)) {
        ({ data: updated, error: updErr } = await applyUpdate(false, chunk));
      }
      if (updErr) {
        return NextResponse.json({ error: "restore_failed", detail: updErr.message }, { status: 500 });
      }
      restoredIds.push(...(updated ?? []).map((r) => r.id as string));
    }
    restored = restoredIds.length;
  }

  // ── Book what is now certain ────────────────────────────────────────────────────────────────
  // Always run, even when nothing was restored: the owner pressed a button that promises "try
  // again", and a pending line that turned certain since the last page load must be booked by it.
  // runBankAutoConfirm carries every guard (isEligible, the 'verwerkt' check in the WHERE clause,
  // the link-race rollback, the audit trail) and is safe to re-run — it only touches pending
  // transactions and non-paid invoices.
  let booked = 0;
  try {
    booked = (await runBankAutoConfirm({ payClient: supabase, pipeline, userId: user.id })).length;
  } catch (e) {
    console.error("[BANK-REMATCH] auto-confirm pass failed (non-fatal)", e);
  }
  let categorized = 0;
  try {
    categorized = (await applyLearnedBankCategories({ pipeline, userId: user.id })).length;
  } catch (e) {
    console.error("[BANK-REMATCH] auto-categorize pass failed (non-fatal)", e);
  }

  // One audit row for the pass, not one per line: this is a single deliberate action by the
  // owner, and the ids travel with it so a reactivation is traceable to the run that did it.
  if (restored > 0) {
    await logAuditAction({
      userId: user.id,
      action: "bank.rematch_restored",
      entityType: "bank_transaction",
      entityId: restoredIds[0],
      oldValue: { status: "not_found" },
      newValue: {
        status: "pending",
        restored_count: restored,
        transaction_ids: restoredIds,
        matched_invoices: plan.restore
          .filter((r) => restoredIds.includes(r.transactionId))
          .map((r) => ({ transaction_id: r.transactionId, invoice_number: r.invoiceNumber })),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    examined: ignoredRows.length + pendingRows.length,
    ignoredExamined: ignoredRows.length,
    restored,
    // Found something, deliberately not acted on — the owner can look in "Genegeerd".
    ambiguous: plan.ambiguous.length,
    unchanged: plan.unchanged,
    booked,
    categorized,
    // [BLIND-LEVERANCIER] Present only when a signal was actually lost, so the ordinary run says
    // nothing and the sweep's own report stays as short as it was.
    ...(supplierIbans.unavailable ? { supplierIbansUnavailable: true } : {}),
  });
}
