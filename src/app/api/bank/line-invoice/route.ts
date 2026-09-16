// src/app/api/bank/line-invoice/route.ts
// [REGEL-FACTUUR] An invoice from a bank line, with no file.
//
//   GET  ?transactionId=…  → the prefill: party, amount, date, and the rate this supplier
//                            demonstrably uses (vendor-vat-rate.ts), when the app knows one.
//   POST { transactionId, rate, hasDocumentElsewhere, clientName?, description? }
//        → one invoice (source 'created', paid by this line) and the line matched to it.
//
// The money rule lives in line-invoice.ts and is applied there, not here: a purchase without a
// document carries no btw. This route adds the things only a database can answer — that the line
// is still free, that a paid invoice of this amount is not already sitting beside it (the same
// double-booking guard every machine writer asks), and the supplier's identity in the registry.
//
// [HANDGESCHREVEN-BOEKING] This route does NOT book the payment. It creates the invoice as an
// ORDINARY OPEN one and hands the money decision to confirm_bank_payment — the same door
// /api/bank/confirm and the auto-confirm pass already go through.
//
// What it used to do: write invoices.status='paid' with amount_paid, then UPDATE the bank line,
// then INSERT the allocation row — three statements, three transactions, no row lock between
// them, and a hand-written compensating DELETE for the middle one. The allocation write was the
// last and least protected: it was reported and SWALLOWED, so the ordinary outcome of a failure
// there was an invoice standing paid with no link to the money that paid it. Nothing measured the
// line's remaining budget at all, because this route only ever ran on a line it had read as free
// — unlocked, one statement earlier, which is exactly the window a concurrent confirm fits in.
//
// Now: one call, one transaction, one row lock. The door decides the amount under that lock and
// refuses rather than over-spending. There is no second payment-write path left here to
// compensate — the only rollback is the DELETE of the invoice this route just created, which is a
// document that never became a payment, not a payment being undone.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { buildLineInvoice, isLineRate } from "@/lib/line-invoice";
import { deriveVendorRate } from "@/lib/vendor-vat-rate";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { readDoubleBookingGuard } from "@/lib/bank-double-booking";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE = "id, status, invoice_id, amount, date, counterpart_name, counterpart_iban, description, reference";

type Line = { id: string; status: string | null; invoice_id: string | null; amount: number | null; date: string | null; counterpart_name: string | null; counterpart_iban: string | null; description: string | null; reference: string | null };

async function freeLine(pipeline: ReturnType<typeof createPipelineClient>, userId: string, transactionId: string) {
  const { data: tx, error } = await pipeline.from("bank_transactions").select(LINE).eq("id", transactionId).eq("user_id", userId).maybeSingle();
  if (error) return { error: NextResponse.json({ error: "tx_lookup_failed", detail: error.message }, { status: 500 }) };
  if (!tx) return { error: NextResponse.json({ error: "transaction_not_found" }, { status: 404 }) };
  const line = tx as Line;
  if (line.status !== "pending" || line.invoice_id) return { error: NextResponse.json({ error: "transaction_already_processed" }, { status: 409 }) };
  const { data: links, error: linkErr } = await pipeline.from("bank_tx_invoices").select("id").eq("transaction_id", transactionId).eq("user_id", userId).limit(1);
  if (linkErr) return { error: NextResponse.json({ error: "links_lookup_failed", detail: linkErr.message }, { status: 500 }) };
  if ((links ?? []).length > 0) return { error: NextResponse.json({ error: "transaction_partially_linked", code: "transaction_partially_linked" }, { status: 409 }) };
  return { line };
}

export async function GET(req: NextRequest) {
  const transactionId = req.nextUrl.searchParams.get("transactionId")?.trim() ?? "";
  if (!UUID.test(transactionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pipeline = createPipelineClient();
  const got = await freeLine(pipeline, user.id, transactionId);
  if ("error" in got) return got.error;
  const line = got.line;

  // [TARIEF-GEHEUGEN] The rate this supplier's own invoices show, when there are enough of them.
  let suggestedRate: number | null = null;
  let basedOn = 0;
  let rateSource: "history" | "supplier" | null = null;
  const name = (line.counterpart_name ?? "").trim();
  if (name && (line.amount ?? 0) < 0) {
    const supplier = await resolveSupplierForImport(pipeline, user.id, { name, iban: line.counterpart_iban }).catch(() => null);
    // [LEVERANCIER-STANDAARD] The rate the owner set on the supplier outranks the derived one.
    const fixed = supplier
      ? await pipeline.from("suppliers").select("default_btw_rate").eq("id", supplier.id).eq("user_id", user.id).maybeSingle()
          .then((r) => (r.data as { default_btw_rate: number | null } | null)?.default_btw_rate ?? null, () => null)
      : null;
    if (fixed !== null) {
      suggestedRate = fixed; basedOn = 0; rateSource = "supplier";
    } else if (supplier) {
      const { data: rows } = await pipeline
        .from("invoices").select("total_ex_btw, btw_amount, total_inc_btw")
        .eq("receiver_id", user.id).eq("direction", "incoming").eq("supplier_id", supplier.id)
        .in("status", ["received", "paid"]).order("invoice_date", { ascending: false }).limit(40);
      const derived = deriveVendorRate((rows ?? []).map((r) => ({ totalExBtw: r.total_ex_btw, btwAmount: r.btw_amount, totalIncBtw: r.total_inc_btw })));
      if (derived) { suggestedRate = derived.rate; basedOn = derived.basedOn; rateSource = "history"; }
    }
  }
  return NextResponse.json({
    ok: true,
    prefill: {
      transactionId: line.id,
      amount: line.amount ?? 0,
      date: line.date,
      counterpartName: name || null,
      description: [line.description, line.reference].filter(Boolean).join(" · ").slice(0, 300) || null,
      suggestedRate,
      basedOn,
      rateSource,
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  { const w = await requireOwner("Een factuur maken van een bankregel"); if (w.response) return w.response; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId : "";
  if (!UUID.test(transactionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  if (!isLineRate(body?.rate)) return NextResponse.json({ error: "bad_rate", code: "bad_rate" }, { status: 400 });

  const pipeline = createPipelineClient();
  const got = await freeLine(pipeline, user.id, transactionId);
  if ("error" in got) return got.error;
  const line = got.line;
  if (!line.date) return NextResponse.json({ error: "bad_date", code: "bad_date" }, { status: 400 });

  const verdict = buildLineInvoice({
    amount: Number(line.amount) || 0,
    date: line.date,
    counterpartName: typeof body?.clientName === "string" && body.clientName.trim() ? body.clientName : line.counterpart_name,
    rate: body.rate,
    hasDocumentElsewhere: body?.hasDocumentElsewhere === true,
    description: typeof body?.description === "string" ? body.description : null,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason, code: verdict.code }, { status: 400 });
  const d = verdict.draft;

  // [DUBBEL-GEDEKT] A paid invoice of exactly this amount near this date means this line may be
  // that invoice's own payment — creating a second invoice for it books the cost twice.
  const guard = await readDoubleBookingGuard({ invoiceClient: pipeline, molliePipeline: pipeline, userId: user.id, lines: [{ amount: line.amount }] });
  const hold = guard.hold(d.direction === "incoming" ? "kosten" : "omzet", { id: line.id, amount: line.amount, date: line.date, description: line.description, counterpart_name: line.counterpart_name } as never);
  if (hold === "paid-invoice") {
    return NextResponse.json({ error: "paid_invoice_nearby", code: "paid_invoice_nearby" }, { status: 409 });
  }

  const supplier = d.direction === "incoming"
    ? await resolveSupplierForImport(pipeline, user.id, { name: d.clientName, iban: line.counterpart_iban }).catch(() => null)
    : null;
  const isIncoming = d.direction === "incoming";
  // [HANDGESCHREVEN-BOEKING] Created OPEN, not paid. The payment is confirm_bank_payment's to
  // write, under the bank line's row lock, together with the allocation row — so 'paid',
  // amount_paid, payment_method, marked_paid_at and payment_date all appear in the same
  // transaction as the money they describe, or none of them do.
  const { data: inv, error: insErr } = await pipeline
    .from("invoices")
    .insert({
      sender_id: isIncoming ? null : user.id,
      receiver_id: isIncoming ? user.id : null,
      direction: d.direction,
      status: isIncoming ? "received" : "sent",
      source: "created",
      invoice_type: "factuur",
      invoice_number: null,
      client_name: supplier?.name ?? d.clientName,
      supplier_id: supplier?.id ?? null,
      invoice_date: d.invoiceDate,
      due_date: d.invoiceDate,
      total_ex_btw: d.totalExBtw,
      btw_amount: d.btwAmount,
      total_inc_btw: d.totalIncBtw,
      vendor_iban: isIncoming ? line.counterpart_iban : null,
      field_confidence: {
        amount: 1, vendor: 1, date: 1,
        _description: d.description ?? undefined,
        _source_note: "Aangemaakt vanaf een bankregel, zonder document.", // [TAAL-DB]
        _no_document: !d.documentMissing && isIncoming ? true : undefined,
        _document_missing: d.documentMissing ? true : undefined,
        _btw_withheld_no_document: d.btwWithheldNoDocument ? true : undefined,
        _bank_line: line.id,
      },
    })
    .select("id")
    .single();
  if (insErr || !inv) return NextResponse.json({ error: "invoice_insert_failed", detail: insErr?.message }, { status: 500 });
  const invoiceId = (inv as { id: string }).id;

  // [HANDGESCHREVEN-BOEKING] THE money mutation, and the only one. One call: the door locks the
  // line, re-reads what the line still has after its other allocations, refuses a line that is
  // not claimable, decides the amount, and writes the invoice, the allocation row and the line
  // status inside one transaction.
  //
  // The SESSION client, deliberately — the same authority /api/bank/confirm books with. The
  // function is SECURITY DEFINER and checks auth.uid() against p_user_id, and the owner's own
  // uid is what lets the accountant-'verwerkt' trigger fire on the invoices write.
  //
  // p_pay_date is the LINE's date, which is what this route has always written as payment_date.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bookedRows, error: bookErr } = await (supabase.rpc as any)("confirm_bank_payment", {
    p_user_id: user.id,
    p_tx_id: transactionId,
    p_invoice_id: invoiceId,
    p_pay_date: d.invoiceDate,
  }) as { data: unknown; error: { code?: string; message?: string } | null };

  // Nothing was booked ⇒ the invoice this route created a moment ago is a document describing a
  // payment that did not happen. Deleting it is not a compensating PAYMENT write — there is no
  // payment to compensate, which is the whole point of doing the money in one transaction.
  const undoInvoice = async () => {
    await pipeline.from("invoices").delete().eq("id", invoiceId).eq(isIncoming ? "receiver_id" : "sender_id", user.id);
  };

  if (bookErr) {
    const msg = (bookErr.message ?? "").toLowerCase();
    await undoInvoice();
    // The line was claimed, or names an invoice no allocation backs — both mean this line is not
    // this route's to turn into an invoice, which is the answer the screen already handles.
    if (msg.includes("no allocation backs")) {
      return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
    }
    if (msg.includes("fully applied")) {
      return NextResponse.json({ error: "payment_fully_applied", code: "payment_fully_applied" }, { status: 409 });
    }
    return NextResponse.json({ error: "payment_failed", detail: bookErr.message }, { status: 500 });
  }
  const booked = Array.isArray(bookedRows) ? (bookedRows[0] as { applied: number } | undefined) : undefined;
  if (!booked) {
    // Empty result ⇒ the line was claimed between freeLine's read and the lock. Nothing written.
    await undoInvoice();
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }
  await logAuditAction({
    userId: user.id, action: "invoice.created", entityType: "invoice", entityId: invoiceId,
    newValue: {
      via: "bank_line_no_document", transaction_id: transactionId, direction: d.direction,
      total_inc_btw: d.totalIncBtw, btw_amount: d.btwAmount, rate_applied: d.rateApplied,
      applied: booked.applied,
      btw_withheld_no_document: d.btwWithheldNoDocument, document_missing: d.documentMissing,
    },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, invoiceId, btwWithheldNoDocument: d.btwWithheldNoDocument, documentMissing: d.documentMissing });
}
