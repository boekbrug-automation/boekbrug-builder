// src/app/api/bank/delete-line/route.ts
// [REGEL-WEG] Delete ONE bank line. The owner's control over a line the app cannot explain: a
// bank's own correction line, a test payment, a line from an account that is not the business's,
// a duplicate an import produced twice.
//
// Refused when money sits on it: a matched line, a line with an invoice_id, a line with link rows.
// Those are reversed with Ontkoppelen first — deleting them would leave an invoice paid by a bank
// line that no longer exists, the exact half-state every reversal path here is built to prevent.
//
// The line's identity goes into the audit trail before the row is gone, so a deleted line is still
// reconstructable a year later. Attachments follow the line (FK cascade); their stored files are
// removed here because the cascade cannot reach the bucket.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";
import { fetchAllRowsForIds, chunkIds } from "@/lib/supabase-paginate";
import { removeOriginals } from "@/lib/document-storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  { const w = await requireOwner("Een bankregel verwijderen"); if (w.response) return w.response; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId : "";
  if (!UUID.test(transactionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  // bank_tx_attachments is not in the generated types (hand-applied migration) → relaxed client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any;
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, invoice_id, date, amount, counterpart_name, counterpart_iban, description, reference, category, category_confirmed, source, external_id, statement_document_id")
    .eq("id", transactionId).eq("user_id", user.id).maybeSingle();
  if (txErr) return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });

  // Money on it → not deletable, reversible first.
  const { data: links, error: linkErr } = await pipeline
    .from("bank_tx_invoices").select("id").eq("transaction_id", transactionId).eq("user_id", user.id).limit(1);
  if (linkErr) return NextResponse.json({ error: "links_lookup_failed", detail: linkErr.message }, { status: 500 });
  if (tx.status === "matched" || tx.invoice_id || (links ?? []).length > 0) {
    return NextResponse.json({ error: "transaction_linked", code: "transaction_linked" }, { status: 409 });
  }

  // The attachments' files, before the cascade takes their rows.
  const { data: att } = await pipeline
    .from("bank_tx_attachments").select("document_id").eq("transaction_id", transactionId).eq("user_id", user.id);
  const docIds = ((att ?? []) as { document_id: string }[]).map((a) => a.document_id);
  let paths: string[] = [];
  if (docIds.length > 0) {
    const docs = await fetchAllRowsForIds<{ id: string; file_url: string }, string>(docIds, (chunk, from, to) =>
      pipeline.from("documents").select("id, file_url").eq("user_id", user.id).in("id", chunk).order("id", { ascending: true }).range(from, to),
    ).catch(() => [] as { id: string; file_url: string }[]);
    paths = docs.map((d) => d.file_url);
  }

  const { data: gone, error: delErr } = await pipeline
    .from("bank_transactions").delete().eq("id", transactionId).eq("user_id", user.id)
    .is("invoice_id", null).neq("status", "matched").select("id");
  if (delErr) return NextResponse.json({ error: "delete_failed", detail: delErr.message }, { status: 500 });
  if (!gone || gone.length === 0) return NextResponse.json({ error: "transaction_linked", code: "transaction_linked" }, { status: 409 });

  if (docIds.length > 0) {
    for (const chunk of chunkIds(docIds)) await pipeline.from("documents").delete().eq("user_id", user.id).in("id", chunk);
    if (paths.length > 0) await removeOriginals(supabase, paths).catch(() => undefined);
  }
  await logAuditAction({
    userId: user.id, action: "bank.line_deleted", entityType: "bank_transaction", entityId: transactionId,
    oldValue: {
      date: tx.date, amount: tx.amount, counterpart_name: tx.counterpart_name, counterpart_iban: tx.counterpart_iban,
      description: tx.description, reference: tx.reference, category: tx.category, category_confirmed: tx.category_confirmed,
      status: tx.status, source: tx.source, external_id: tx.external_id, statement_document_id: tx.statement_document_id,
      attachments: docIds.length,
    },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
