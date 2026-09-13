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

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { buildLineInvoice, isLineRate } from "@/lib/line-invoice";
import { deriveVendorRate } from "@/lib/vendor-vat-rate";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { recordPaymentLinks } from "@/lib/bank-tx-links";
import { readDoubleBookingGuard } from "@/lib/bank-double-booking";
import { reportHandledFailure } from "@/lib/report-handled";

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
  const { data: inv, error: insErr } = await pipeline
    .from("invoices")
    .insert({
      sender_id: isIncoming ? null : user.id,
      receiver_id: isIncoming ? user.id : null,
      direction: d.direction,
      status: "paid",
      source: "created",
      invoice_type: "factuur",
      invoice_number: null,
      client_name: supplier?.name ?? d.clientName,
      supplier_id: supplier?.id ?? null,
      invoice_date: d.invoiceDate,
      due_date: d.invoiceDate,
      payment_date: d.invoiceDate,
      payment_method: "bank",
      marked_paid_at: new Date().toISOString(),
      amount_paid: d.totalIncBtw,
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

  // The line: this invoice, settled in full — exactly the end state confirm_bank_payment leaves.
  const { data: linked, error: linkErr } = await pipeline
    .from("bank_transactions")
    .update({ invoice_id: invoiceId, status: "matched" })
    .eq("id", transactionId).eq("user_id", user.id).eq("status", "pending").is("invoice_id", null)
    .select("id");
  if (linkErr || !linked || linked.length === 0) {
    await pipeline.from("invoices").delete().eq("id", invoiceId).eq(isIncoming ? "receiver_id" : "sender_id", user.id);
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }
  // [EEN-SCHRIJFPAD] The link write BLOCKS, and a failure rolls the whole thing back.
  //
  // This used to be best-effort with a log line, and that is how an invoice reaches the state
  // this app cannot describe: status 'paid' and amount_paid set, with no bank_tx_invoices row
  // under it. Measured in production before this change — 18 paid invoices with no allocation
  // row at all — so it is not a theoretical branch.
  //
  // Why it matters even though the invoice "looks right": amount_paid is a CACHE of
  // SUM(amount_applied), and every reversal path re-derives it from the surviving links. An
  // invoice with money and no link therefore drops to amount_paid 0 the moment anything else on
  // it is undone, and the kasstelsel return reads settlement from the LINK, not from the column —
  // so the payment is invisible to the figures the Belastingdienst sees.
  //
  // The rollback is the one this route already performs twenty lines up when the bank line turns
  // out to be claimed: the invoice is removed and the line is released. Nothing has been told to
  // the owner yet, so a retry is free and costs them one tap.
  const recorded = await recordPaymentLinks(pipeline, user.id, transactionId, [invoiceId], { [invoiceId]: d.totalIncBtw });
  if (!recorded) {
    reportHandledFailure({ tag: "REGEL-FACTUUR", severity: "data-integrity", message: "payment link not recorded for an invoice created from a bank line — rolled back", context: { userId: user.id, invoiceId, transactionId } });
    await pipeline
      .from("bank_transactions")
      .update({ invoice_id: null, status: "pending" })
      .eq("id", transactionId).eq("user_id", user.id).eq("invoice_id", invoiceId);
    await pipeline.from("invoices").delete().eq("id", invoiceId).eq(isIncoming ? "receiver_id" : "sender_id", user.id);
    return NextResponse.json({ error: "payment_link_failed", code: "payment_link_failed" }, { status: 500 });
  }
  await logAuditAction({
    userId: user.id, action: "invoice.created", entityType: "invoice", entityId: invoiceId,
    newValue: {
      via: "bank_line_no_document", transaction_id: transactionId, direction: d.direction,
      total_inc_btw: d.totalIncBtw, btw_amount: d.btwAmount, rate_applied: d.rateApplied,
      btw_withheld_no_document: d.btwWithheldNoDocument, document_missing: d.documentMissing,
    },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, invoiceId, btwWithheldNoDocument: d.btwWithheldNoDocument, documentMissing: d.documentMissing });
}
