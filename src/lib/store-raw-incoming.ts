// src/lib/store-raw-incoming.ts
// [BEWAAR-EERST] One place that keeps the bytes when the reader could not read them.
//
// This lived inside /api/intake, which is why only ONE of the three human upload doors had it.
// That is the same shape as the bug it exists to fix: the e-mail sync kept every attachment it
// could not read while the upload door threw the file away, because each door carried its own
// idea of what to do when the reader was down. A capability that lives inside one route is a
// capability the next door does not have.
//
// It is deliberately best-effort and returns null rather than throwing: the booking is the
// money-truth and storage is the convenience. A caller that gets null is empty-handed and must
// say so — see [NO-SILENT-EMPTY] at each call site.

import type { createServerSupabaseClient } from "@/lib/supabase-server"
import { createPipelineClient } from "@/lib/supabase-pipeline"
import { ensureImportedFolder } from "@/lib/bestanden"
import { computeContentHash } from "@/lib/content-hash"
import { releaseTrashedHash } from "@/lib/trashed-dedup"

export async function storeRawIncoming(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  aiDocType: string,
  source: string,
  // [BEWAAR-EERST] Default true, which is what every existing caller means: those branches DID run
  // a reader. The outage branch passes false, because claiming a read that never happened would
  // make the reader-quality panel count a failure as a success.
  opts: { aiProcessed?: boolean } = {},
): Promise<string | null> {
  const hash = computeContentHash(buffer)
  try {
    const { data: existing } = await supabase
      .from("documents").select("id, trashed").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
    // [DUP-TRASHED] Een weggegooide rij teruggeven zou de boeking koppelen aan bewijs dat de eigenaar
    // niet meer ziet staan. Sleutel vrijgeven en vers opslaan; lukt dat niet, dan loopt de insert
    // hieronder op de UNIQUE index stuk en valt dit terug op "geen document" — dit is en blijft
    // best-effort opslag, de boeking zelf is de money-truth.
    if (existing?.id && existing.trashed !== true) return existing.id
    if (existing?.id) await releaseTrashedHash(supabase, userId, existing.id)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false })
    if (upErr) {
      console.error("[STORE-RAW] storage upload failed — the file is NOT kept", { userId, file: file.name, error: upErr.message })
      return null
    }
    const folderId = await ensureImportedFolder(userId, "pipeline")
    const pipelineDoc = createPipelineClient()
    const { data: doc, error: docErr } = await pipelineDoc.from("documents").insert({
      user_id: userId, file_name: file.name, file_url: storagePath,
      file_size: buffer.length, file_type: file.type || "application/octet-stream",
      doc_type: "overig", folder_id: folderId, source,
      ai_processed: opts.aiProcessed ?? true, ai_doc_type: aiDocType, content_hash: hash,
    }).select("id").single()
    if (docErr || !doc) {
      console.error("[STORE-RAW] documents insert failed — the file is NOT kept", { userId, file: file.name, error: docErr?.message })
      await supabase.storage.from("documents").remove([storagePath]).catch(() => {})
      return null
    }
    return doc.id
  } catch (e) {
    console.error("[STORE-RAW] unexpected failure — the file is NOT kept", { userId, file: file.name, error: e instanceof Error ? e.message : String(e) })
    return null // storage is a convenience; the booking is the money-truth
  }
}
