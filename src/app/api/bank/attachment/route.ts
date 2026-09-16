// src/app/api/bank/attachment/route.ts
// [BIJLAGE-BIJ-REGEL] A file WITH a bank line, and nothing else changes.
//
//   GET    ?transactionId=…        → the line's attachments, each with a one-hour signed URL
//   POST   multipart { transactionId, file }  → stores the file, one documents row, one link row
//   DELETE { id }                  → removes the link, the documents row and the stored file
//
// Every path checks that the line is the caller's. The file goes to the same bucket every upload
// uses, under the owner's own prefix; the documents row is marked processed so no reader ever
// tries to turn a customer's remittance into an invoice. A booking is never touched here.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { attachmentsByTransaction, attachmentTypeAllowed, ATTACHMENT_MAX_BYTES } from "@/lib/bank-attachments";
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { gateStorage } from "@/lib/fair-use-gate";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownerAndLine(transactionId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, tx: null, supabase, pipeline: null as never };
  // bank_tx_attachments is not in the generated types (hand-applied migration) → relaxed client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any;
  const { data: tx, error } = await pipeline
    .from("bank_transactions").select("id, user_id, date, amount, counterpart_name, description")
    .eq("id", transactionId).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return { user, tx, supabase, pipeline };
}

export async function GET(req: NextRequest) {
  const transactionId = req.nextUrl.searchParams.get("transactionId")?.trim() ?? "";
  if (!UUID.test(transactionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  let ctx;
  try { ctx = await ownerAndLine(transactionId); } catch (e) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!ctx.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  const list = (await attachmentsByTransaction(ctx.pipeline, ctx.user.id, [transactionId])).get(transactionId) ?? [];
  const userId = ctx.user.id;
  const pipe = ctx.pipeline;
  const docs = await fetchAllRowsForIds<{ id: string; file_url: string }, string>(list.map((a) => a.documentId), (chunk, from, to) =>
    pipe.from("documents").select("id, file_url").eq("user_id", userId).in("id", chunk).order("id", { ascending: true }).range(from, to),
  ).catch(() => [] as { id: string; file_url: string }[]);
  const pathById = new Map(docs.map((d) => [d.id, d.file_url]));
  const withUrls = await Promise.all(list.map(async (a) => {
    const path = pathById.get(a.documentId);
    if (!path) return { ...a, url: null };
    // Signed with the SESSION client (RLS on storage): the owner can only ever reach their own file.
    const { data: signed } = await ctx.supabase.storage.from("documents").createSignedUrl(path, 3600);
    return { ...a, url: signed?.signedUrl ?? null };
  }));
  return NextResponse.json({ ok: true, attachments: withUrls });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const transactionId = String(form.get("transactionId") ?? "").trim();
  const file = form.get("file");
  if (!UUID.test(transactionId) || !(file instanceof File)) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  if (file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  if (!attachmentTypeAllowed(file.type, file.name)) return NextResponse.json({ error: "file_type" }, { status: 415 });

  let ctx;
  try { ctx = await ownerAndLine(transactionId); } catch (e) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!ctx.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  const { user, supabase, pipeline } = ctx;

  // [OPSLAG-DEUR] Before a byte is written. The allowance is MEASURED from the documents this
  // account still has, so the refusal and the meter on the owner's own screen quote the same
  // megabytes. Fails open — see gateStorage.
  const space = await gateStorage({ client: supabase, userId: user.id, bytes: file.size });
  if (!space.allowed) return space.response!;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "bijlage";
  const storagePath = `${user.id}/bank/${transactionId}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from("documents").upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) return NextResponse.json({ error: "upload_failed", detail: upErr.message }, { status: 500 });

  // The documents row: processed, typed 'overig', never an invoice candidate. The note names the
  // line, so the file explains itself in the documents list too.
  const { data: doc, error: docErr } = await pipeline
    .from("documents")
    .insert({
      user_id: user.id, file_name: file.name.slice(0, 200), file_url: storagePath, file_size: file.size,
      file_type: file.type || "application/octet-stream", doc_type: "overig", source: "upload",
      ai_processed: true, ai_doc_type: "bank_attachment",
      year: ctx.tx.date ? Number(String(ctx.tx.date).slice(0, 4)) || null : null,
      notes: `Bijlage bij bankregel ${ctx.tx.date ?? ""} ${ctx.tx.counterpart_name ?? ""}`.trim(), // [TAAL-DB]
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: "document_insert_failed", detail: docErr?.message }, { status: 500 });
  }
  const { data: link, error: linkErr } = await pipeline
    .from("bank_tx_attachments")
    .insert({ user_id: user.id, transaction_id: transactionId, document_id: (doc as { id: string }).id })
    .select("id")
    .single();
  if (linkErr || !link) {
    await pipeline.from("documents").delete().eq("id", (doc as { id: string }).id).eq("user_id", user.id);
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: "attach_failed", detail: linkErr?.message }, { status: 500 });
  }
  await logAuditAction({
    userId: user.id, action: "bank.attachment_added", entityType: "bank_transaction", entityId: transactionId,
    newValue: { document_id: (doc as { id: string }).id, file_name: file.name, size: file.size },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, attachment: { id: (link as { id: string }).id, documentId: (doc as { id: string }).id, fileName: file.name, fileType: file.type || null } });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any;
  const { data: row, error } = await pipeline
    .from("bank_tx_attachments").select("id, transaction_id, document_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "lookup_failed", detail: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: doc } = await pipeline.from("documents").select("id, file_url").eq("id", row.document_id).eq("user_id", user.id).maybeSingle();
  const { error: delErr } = await pipeline.from("bank_tx_attachments").delete().eq("id", id).eq("user_id", user.id);
  if (delErr) return NextResponse.json({ error: "delete_failed", detail: delErr.message }, { status: 500 });
  if (doc) {
    await pipeline.from("documents").delete().eq("id", doc.id).eq("user_id", user.id);
    await supabase.storage.from("documents").remove([doc.file_url]).catch(() => undefined);
  }
  await logAuditAction({
    userId: user.id, action: "bank.attachment_removed", entityType: "bank_transaction", entityId: row.transaction_id,
    oldValue: { document_id: row.document_id }, ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
