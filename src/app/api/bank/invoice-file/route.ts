// src/app/api/bank/invoice-file/route.ts
// [BANK-INVOICE-FILE] Return a short-lived signed URL for a matched invoice's
// PDF, so the owner can OPEN and check the actual invoice before confirming the
// payment on the bank screen. Read-only, ownership-checked.
//
// GET /api/bank/invoice-file?invoiceId=<uuid>
//   → { ok: true, url: "<signed url>" }  (1-hour expiry)
//
// Security: the invoice must belong to the authenticated user (as sender OR
// receiver). We sign with the SESSION client (RLS), so a user can only ever
// reach their own file; no service_role needed for a plain read of own data.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { signedUrl } from "@/lib/document-storage";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const invoiceId = req.nextUrl.searchParams.get("invoiceId")?.trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "missing_invoice_id" }, { status: 400 });
  }

  // 1. Fetch the invoice, scoped to this user, and grab its stored file path.
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, pdf_url, sender_id, receiver_id")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "lookup_failed", detail: error.message }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!invoice.pdf_url) {
    return NextResponse.json({ error: "no_file", detail: "Deze factuur heeft geen bestand." }, { status: 404 });
  }

  // 2. Sign the storage path (1 hour). pdf_url is the raw path, signed on read.
  const { data: signed, error: signErr } = await signedUrl(supabase, invoice.pdf_url, 3600);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "sign_failed", detail: signErr?.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl });
}