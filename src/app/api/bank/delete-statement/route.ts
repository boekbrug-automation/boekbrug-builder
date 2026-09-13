// src/app/api/bank/delete-statement/route.ts
// [BANK-STATEMENT-DELETE] Delete ONE uploaded bank statement file. The owner
// uploaded a wrong/overlapping statement and wants to replace it with the right
// version — a correction of entry, not a loss of evidence.
//
// POST { documentId }  → { ok: true } | { error }
//
// What it deletes (in a SAFE order):
//   1. the documents row  (doc_type='bankafschrift', owned by this user)
//   2. the Storage file    (bucket 'documents', path = file_url)
//
// Order rationale (see ticket "kritische punten" #2): we remove the documents row
// FIRST so the statement disappears from the closing-package ZIP immediately
// (the package is built fresh each time from a documents query — no cache). The
// Storage delete is best-effort AFTER: an orphan file in Storage is far less
// harmful than a documents row pointing at a missing file (a broken link the
// accountant would see in the package). A failed Storage delete → warning, not
// a hard error; the row is already gone, which is what matters for the package.
//
// Deleting a statement is a TRUE UNDO of that import: before removing the file it reverses the
// statement's own bookings — restores every invoice it paid to unpaid, then deletes exactly this
// statement's transactions (via the statement_document_id link), including the pos_income lines
// whose card-commission is a live read. This closes the old wrong-number gap (a re-import used to
// ADD corrected lines on top of the stranded originals → doubled omzet + commission) and the
// reversibility gap (a deleted statement's payments were unreachable to undo). Bewaarplicht rests
// on the INVOICES, which remain; the statement file was a convenience copy. A 'verwerkt' invoice
// blocks the reversal (ask the accountant to undo processing first).
//
// Auth: SESSION client (RLS). The owner deletes their OWN statement only; we
// additionally verify ownership and doc_type explicitly before any delete.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [PAYDATE-REDERIVE] After a reversal the invoice's payment date must describe the money that is
// still on it. The database does this too now; this stands beside it — see the module for why.
import { rederivePaymentDate } from "@/lib/payment-date-rederive";
import { invoiceIdsForTransactions, invoicesClaimedByOtherTx } from "@/lib/bank-tx-links";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { parseReferenceNumbers, normalizeRef } from "@/lib/bank-matching";
import { planStatementReversal } from "@/lib/statement-reversal";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled"
import { removeOriginals } from "@/lib/document-storage";

export async function POST(req: NextRequest) {
  // 1. Auth — the owner acting on their own data.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // 2. Body
  let documentId: string | undefined;
  try {
    const body = await req.json();
    documentId = body?.documentId;
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
  if (!documentId) {
    return NextResponse.json({ error: "Geen document opgegeven" }, { status: 400 });
  }

  // 3. The document must exist, belong to the user, and be a bank statement.
  //    This is the guard that prevents this route from deleting any other
  //    document type (an invoice PDF, a receipt) — only 'bankafschrift'.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, user_id, doc_type, file_url, file_name")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (docErr) {
    return NextResponse.json({ error: "lookup_failed", detail: docErr.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Bankafschrift niet gevonden" }, { status: 404 });
  }
  if (doc.doc_type !== "bankafschrift") {
    // Defense: never let this endpoint delete a non-statement document.
    return NextResponse.json({ error: "Dit is geen bankafschrift" }, { status: 422 });
  }

  // 3b. [BANK-STATEMENT-DELETE-CASCADE] Reverse this statement's own bookings BEFORE removing it.
  //     Deleting the file used to strand its derived state: paid invoices, matched links, and
  //     pos_income card-commission lived on, pointing at a gone file — and a re-import then ADDED
  //     the corrected lines on top (dedup only skips identical rows) → doubled omzet + commission.
  //     Now a delete is a true "undo this import": restore every invoice this statement paid, then
  //     remove this statement's transactions (incl. pos_income, whose triangle effect is a live
  //     read). The invoices themselves remain — Bewaarplicht is on the invoices, the file was a
  //     convenience copy. Requires the statement_document_id link (bank_tx_statement_link.sql).
  //
  //     [BANK-TX-INVOICES] Which invoices did this statement pay? The AUTHORITATIVE, collision-free
  //     answer is the join table — the exact invoice ids recorded at booking time, reversed by id,
  //     never by invoice NUMBER (numbers are not unique across suppliers/directions, so a
  //     number-based reversal could un-pay an unrelated invoice — a wrong-number event). We also
  //     union the direct tx.invoice_id (a legacy single link the backfill covers) so nothing this
  //     statement paid is missed.
  const pipeline = createPipelineClient();
  // [PAGINATE] Paged past the silent ~1000-row cap, and the error is no longer swallowed.
  //
  // This read decides WHICH bookings get reversed, but the DELETE further down filters on
  // statement_document_id and therefore removes EVERY transaction of this statement — read or
  // not. A statement with more than ~1000 lines (bank-ingest.ts:121-126 documents that a busy
  // shop reaches that within one statement's date range) therefore lost the invoices of rows
  // 1001+ from the reversal set while their bank lines were deleted underneath them: left
  // 'paid' by a payment that no longer exists, with no bank line and no join row to undo it
  // from, and — per the [PARTIAL-PAY] note further down — reading €0 openstaand, so out of the
  // debtor list, the aging, art. 29 and dunning all at once. Silent, and unreachable.
  //
  // The old call also ignored its error entirely (`const { data: stmtTx }`), so a failed read
  // became "this statement has no transactions" and the file was deleted with nothing reversed.
  let txs: { id: string; invoice_id: string | null; reference: string | null; amount: number | null; category: string | null }[];
  try {
    txs = await fetchAllRows((from, to) =>
      pipeline
        .from("bank_transactions")
        .select("id, invoice_id, reference, amount, category")
        .eq("user_id", user.id)
        .eq("statement_document_id", documentId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    // Same rule as the invoice read below: never delete a statement while we cannot see what
    // it paid. Nothing has been touched, so the owner can simply try again.
    return NextResponse.json(
      { error: "reversal_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  if (txs.length > 0) {
    const txIds = txs.map((t) => t.id as string);
    // [LINKS-READ-HONEST] Throws now instead of answering "no links" — an empty answer here
    // would collapse the reversal set to the direct tx.invoice_id values and strand every
    // batch sibling. Abort before anything is written.
    let linkIds: string[];
    try {
      linkIds = await invoiceIdsForTransactions(pipeline, user.id, txIds);
    } catch (e) {
      return NextResponse.json(
        { error: "reversal_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    const idSet = new Set<string>(linkIds);
    for (const t of txs) if (t.invoice_id) idSet.add(t.invoice_id as string);

    // Fetch the user's paid-by-bank invoices once; resolve the reversal set from these in code so we
    // can combine the exact id-links with the direction-guarded number gap-fill (below).
    // [PAGINATE] Paged past the ~1000-row cap, stable order. The reversal set is resolved by
    // FILTERING this list in JS (both below), so a truncated page silently drops invoices from
    // the reversal while their transactions are deleted anyway — the same unreachable half-state
    // the tx read above describes. Account-wide and all-time, so a few busy years reach the cap.
    //
    // [REVERSAL-SET] `.eq("payment_method","bank")` used to sit on this query, and it silently
    // dropped invoices this statement provably paid. apply_manual_payment writes the method of the
    // LAST payment, so an invoice settled in two instalments — a bank payment from this statement,
    // then a cash payment that closed it — ends up reading 'kas'. Deleting the statement cascaded
    // its link away and recompute_invoice_amount_paid lowered amount_paid to the cash part (money
    // correct), while `status` stayed 'paid'. Nothing re-derives status, so the invoice sat marked
    // fully settled with half of it still owed: out of the debtor list, out of dunning.
    //
    // The filter is gone from the READ, not replaced by nothing: it moved into the gap-fill tier
    // inside planStatementReversal, which is the only tier where it was ever doing work. See that
    // module — widening the number-matched tier the same way would un-pay a cash-settled invoice
    // whose number merely appears in a deleted statement, which is the worse failure of the two.
    let paid: {
      id: string; invoice_number: string | null; direction: string | null; status: string | null;
      payment_method: string | null;
      accountant_status: string | null; marked_paid_at: string | null; payment_date: string | null;
      amount_paid: number | null;
    }[];
    try {
      paid = await fetchAllRows((from, to) =>
        pipeline
          .from("invoices")
          // [PARTIAL-PAY] amount_paid moet mee: de rollback hieronder zet hem terug zoals hij was.
          // [REVERSAL-SET] payment_method moet mee: de gap-fill leest hem, en de rollback zet hem
          // terug zoals hij was in plaats van 'bank' te verzinnen.
          .select("id, invoice_number, direction, status, payment_method, accountant_status, marked_paid_at, payment_date, amount_paid")
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .eq("status", "paid")
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (e) {
      // Never delete a statement while we cannot read what it paid — that would strand paid
      // invoices with no bank line. Abort cleanly; nothing was touched.
      return NextResponse.json(
        { error: "reversal_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }

    // [REVERSAL-SET] The two tiers, decided in one tested place. They are NOT the same kind of
    // evidence and the module's header is where that is argued:
    //   (1) id-linked — a link row says this statement's transaction paid this invoice. Proof, and
    //       it now holds whatever payment_method the invoice ended up carrying.
    //   (2) [GAP-FILL] number-matched — a PRE-migration batch only backfilled its representative id
    //       (the migration cannot reconstruct the older siblings), so an uncovered reference number
    //       falls back to a DIRECTION-GUARDED, BANK-ONLY match. A freshly-booked batch is fully
    //       id-covered, so this adds nothing for it; it only recovers historical siblings.
    const plan = planStatementReversal(paid, idSet, txs, parseReferenceNumbers, normalizeRef);
    const toRestoreMap = new Map<string, (typeof paid)[number]>();
    for (const inv of plan.idLinked) toRestoreMap.set(inv.id, inv);
    if (plan.gapCandidates.length > 0) {
      // Exclude any candidate that is id-linked to a transaction OUTSIDE this statement — it
      // belongs to a different payment (a same-number stray).
      // [LINKS-READ-HONEST] The stray-exclusion guard throws now rather than failing open (an
      // empty answer would WIDEN the reversal and un-pay another payment's invoice). Nothing is
      // written yet at this point, so refusing costs the owner only a retry.
      let claimed: Set<string>;
      try {
        claimed = await invoicesClaimedByOtherTx(pipeline, user.id, plan.gapCandidates.map((i) => i.id), txIds);
      } catch (e) {
        return NextResponse.json(
          { error: "reversal_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
      for (const inv of plan.gapCandidates) if (!claimed.has(inv.id)) toRestoreMap.set(inv.id, inv);
    }
    const toRestore = [...toRestoreMap.values()];

    // A 'verwerkt' (accountant-locked) invoice blocks the whole reversal — nothing is touched.
    //
    // [VERWERKT-SCOPE] Over every invoice this delete will TOUCH, not only the ones it un-pays.
    // The check read `toRestore`, which comes from a query filtered on status='paid' — so a
    // PARTIALLY paid invoice was invisible to it while being modified all the same: its links
    // cascade away with the transactions and recompute_invoice_amount_paid lowers its amount_paid
    // straight afterwards. An accountant-locked invoice was therefore silently changed by exactly
    // the operation this block exists to refuse, and the owner saw no 409 at all.
    //
    // A second read, because the amounts read above cannot answer it: those rows are the paid ones
    // by construction. Nothing has been written yet, so refusing here still touches nothing.
    const willTouch = [...new Set([...idSet, ...toRestore.map((i) => i.id)])];
    let lockedRows: { id: string; accountant_status: string | null }[];
    try {
      lockedRows = await fetchAllRowsForIds<{ id: string; accountant_status: string | null }, string>(
        willTouch,
        (chunk, from, to) => pipeline
          .from("invoices")
          .select("id, accountant_status")
          .in("id", chunk)
          .eq("accountant_status", "verwerkt")
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (e) {
      // Same rule as every other read on this route: never delete a statement while we cannot see
      // what it would touch. An unreadable lock check is not an absent lock.
      return NextResponse.json(
        { error: "reversal_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    if (lockedRows.length > 0) {
      return NextResponse.json({ error: "verwerkt", detail: "Een factuur van dit afschrift is al verwerkt door de boekhouder. Vraag eerst om ontwerken." }, { status: 409 });
    }

    // Restore each invoice to unpaid — SESSION client so the B.4 verwerkt trigger has auth context.
    // [HIGH-2] Every write is checked. On the FIRST failure we re-pay what we already restored and
    // abort WITHOUT deleting any transaction, so a failed reversal can never land in the half-state
    // this cascade exists to prevent (a restored invoice beside a still-'matched' bank line, or a
    // paid invoice with its bank line deleted). All-or-nothing, mirroring unlink's discipline.
    // [MED-2] Re-pay restores the ORIGINAL marked_paid_at + payment_date so a rollback never loses
    // the settlement date (which attributes the payment to the correct quarter).
    // [REVERSAL-SET] …and the original payment_method with them. It used to write 'bank' flat,
    // which was true of every invoice the old filter let through and is no longer: an invoice
    // settled in two instalments carries the method of the LAST one. A rollback that rewrites 'kas'
    // to 'bank' would leave the row claiming a settlement it never had, on a path whose entire
    // promise is that nothing was touched.
    const restored: { id: string; marked_paid_at: string | null; payment_date: string | null; amount_paid: number | null; payment_method: string | null }[] = [];
    const repay = async () => {
      for (const r of restored) {
        await supabase
          .from("invoices")
          // [PARTIAL-PAY] amount_paid hoort bij de betaling die we terugdraaien, dus hij gaat mee
          // terug. Zonder dit zou een mislukte reversal de factuur betaald terugzetten met een
          // amount_paid van 0 — betaald én volledig openstaand tegelijk.
          .update({ status: "paid", payment_method: r.payment_method, amount_paid: r.amount_paid ?? undefined, marked_paid_at: r.marked_paid_at, payment_date: r.payment_date })
          .eq("id", r.id)
          .neq("status", "paid");
      }
    };
    for (const inv of toRestore) {
      const { error: restoreErr } = await supabase
        .from("invoices")
        // [PARTIAL-PAY] amount_paid MOET hier mee naar 0 — de zusterroute bank/unlink doet dat al
        // (unlink/route.ts:308) en deze deed het niet, terwijl beide dezelfde omkering uitvoeren.
        //
        // Wat er zonder deze regel gebeurde, en waarom niemand het zag: de factuur ging netjes
        // terug naar 'received'/'sent', maar hield amount_paid = het volle bedrag. Daarna
        //   · openstaandOf() rekent total - paid = 0, dus het scherm toont EUR 0 openstaand
        //     terwijl de factuur onbetaald is;
        //   · invoice-reminders.ts (paid >= total - PAID_EPS -> null) stuurt nooit meer een
        //     herinnering voor deze factuur — permanent, en zonder melding;
        //   · de betaal-RPC ziet remaining = 0 en weigert de factuur opnieuw te boeken.
        // Een ondernemer die een verkeerd afschrift verwijdert, verliest zo stil het innen van
        // die factuur. Geen foutmelding, geen logregel, geen zichtbaar verschil.
        .update({ status: inv.direction === "incoming" ? "received" : "sent", amount_paid: 0, payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", inv.id)
        .eq("status", "paid");
      if (restoreErr) {
        await repay();
        if (restoreErr.message?.toLowerCase().includes("verwerkt")) {
          return NextResponse.json({ error: "verwerkt", detail: "Een factuur van dit afschrift is al verwerkt door de boekhouder. Vraag eerst om ontwerken." }, { status: 409 });
        }
        return NextResponse.json({ error: "reversal_failed", detail: restoreErr.message }, { status: 500 });
      }
      restored.push({ id: inv.id, marked_paid_at: inv.marked_paid_at, payment_date: inv.payment_date, amount_paid: inv.amount_paid ?? null, payment_method: inv.payment_method });
    }

    // [MED-3] Audit snapshot BEFORE the destructive delete — record exactly which transactions
    // (incl. the pos_income lines whose card-commission is a live read) and which invoices this
    // reversal touched, so the deletion is reconstructable from the trail, not just observed.
    try {
      await logAuditAction({
        userId: user.id,
        action: "bank.unlinked",
        entityType: "document",
        entityId: documentId,
        newValue: {
          reversed_invoice_ids: restored.map((r) => r.id),
          removed_transaction_ids: txIds,
          removed_transactions: txs.length,
          pos_income_lines: txs.filter((t) => t.category === "pos_income").length,
          reason: "statement_deleted_cascade",
        },
        ipAddress: getClientIP(req),
      });
    } catch { /* non-blocking */ }

    // Remove this statement's transactions — clears the linked lines AND the pos_income lines that
    // feed the card triangle (their join rows cascade via the FK), so the deleted statement
    // contributes nothing to the result anymore. If the delete fails after we've un-paid the
    // invoices, re-pay them so we never leave unpaid invoices beside still-'matched' bank lines.
    const { error: delTxErr } = await pipeline
      .from("bank_transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("statement_document_id", documentId);
    if (delTxErr) {
      await repay();
      return NextResponse.json({ error: "transaction_delete_failed", detail: delTxErr.message }, { status: 500 });
    }

    // [PARTIAL-PAY] Re-derive amount_paid now that this statement's link rows are gone.
    //
    // Deleting the transactions cascades bank_tx_invoices away (FK ON DELETE CASCADE), but
    // amount_paid lives on the invoice and does NOT follow. Without this it keeps the figure the
    // deleted payment put there, while no link supports it any more — and amount_paid is what
    // "openstaand" is computed from. A €1.210 invoice restored to 'sent' with amount_paid still
    // 1210 reports €0 open: it drops out of the debtor list, out of the aging, out of the art. 29
    // bad-debt reclaim, and out of dunning entirely (reminderTierDue bails when paid >= total).
    // Re-importing the corrected statement cannot heal it either — apply_bank_payment sees
    // remaining = 0 and raises "already covered", and auto-confirm only books rows at
    // amount_paid = 0. Every other reversal path already does this; this one did not.
    //
    // Over idSet, not over `restored`: an invoice that was only PARTLY paid by this statement is
    // never in the restore set (that query filters status='paid'), yet its links cascade away just
    // the same — so it is precisely the row that would be left claiming money nobody paid.
    // Invoices paid across two statements converge on the surviving links' true sum, because the
    // RPC re-derives from the join table rather than subtracting.
    const affected = new Set<string>(idSet);
    for (const r of restored) affected.add(r.id);
    let driftUnhealed = 0;
    for (const invoiceId of affected) {
      const { error: recErr } = await pipeline.rpc("recompute_invoice_amount_paid", {
        p_user_id: user.id,
        p_invoice_id: invoiceId,
      });
      if (recErr) {
        driftUnhealed += 1;
        console.error("[PARTIAL-PAY] recompute after statement delete failed", { invoiceId, error: recErr.message });
      }
      // [PAYDATE-REDERIVE] Deleting a statement takes its bank lines with it; the date on every
      // invoice they settled must now describe the payments that survived, not the ones that went.
      await rederivePaymentDate(pipeline, user.id, invoiceId);
    }
    if (driftUnhealed > 0) {
      // The statement is gone and cannot come back, so this is not a rollback situation — but the
      // owner must not be told everything is in order while an invoice still claims paid money.
      // [ALARM] amount_paid = Σ amount_applied is the invariant the whole instalment system rests
      // on, and it is now broken on rows nobody can name from the screen. The statement is gone and
      // cannot come back, so this cannot be rolled back either — it can only be told.
      reportHandledFailure({
        tag: "PARTIAL-PAY",
        message: "statement deleted with unhealed amount_paid drift",
        severity: "data-integrity",
        context: { documentId, unhealed: driftUnhealed, affected: affected.size },
      });
    }
  }

  // 3b. [DEKKING-EERLIJK] De periode-rij van dit afschrift is een dekkingsclaim over weken die
  //     zonet hun transacties verloren. Blijft zij staan, dan meldt coverageOfPeriod de maand
  //     gedekt terwijl er nul regels liggen — precies de stilte waarvoor de continuïteitscheck
  //     is gebouwd. Best-effort (de tabel kan in een oudere uitrol ontbreken), maar wel gelezen:
  //     een fout wordt gelogd, nooit verzwegen als succes.
  {
    const { error: perErr } = await pipeline
      .from("bank_statement_periods")
      .delete()
      .eq("user_id", user.id)
      .eq("document_id", documentId);
    if (perErr) {
      console.error("[DEKKING-EERLIJK] period-row delete failed — coverage may overclaim until re-import", {
        documentId, error: perErr.message,
      });
    }
  }

  // 4. Delete the documents row FIRST (removes it from the closing package at once).
  //    RLS already scopes to the user; the explicit user_id eq is belt-and-braces.
  const { error: delRowErr } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", user.id);
  if (delRowErr) {
    return NextResponse.json(
      { error: "Verwijderen mislukt", detail: delRowErr.message },
      { status: 500 }
    );
  }

  // 5. Delete the Storage file (best-effort). The row is already gone, so a
  //    failure here leaves an orphan file (harmless) — log it, don't fail the
  //    request. Never leave a row pointing at a deleted file (avoided by order).
  let storageWarning = false;
  if (doc.file_url) {
    const { error: storageErr } = await removeOriginals(supabase, [doc.file_url]);
    if (storageErr) {
      console.error("[BANK-STATEMENT-DELETE] storage delete failed (orphan file):", storageErr.message);
      storageWarning = true;
    }
  }

  // 6. Audit trail — a deletion of a financial-adjacent file is worth recording.
  try {
    await logAuditAction({
      userId: user.id,
      action: "document.deleted",
      entityType: "document",
      entityId: documentId,
      oldValue: { file_name: doc.file_name, doc_type: doc.doc_type, path: "bank_statement_delete" },
      ipAddress: getClientIP(req),
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({ ok: true, ...(storageWarning ? { warning: "storage_orphan" } : {}) });
}