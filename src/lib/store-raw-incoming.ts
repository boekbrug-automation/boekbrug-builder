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
//
// ── [ONTVANGEN] THAT SENTENCE IS NO LONGER TRUE FOR EVERY CALLER ─────────────────────────────
//
// "Storage is the convenience, the booking is the money-truth" was right while the booking
// happened in the same request: if the file was lost but the invoice was booked, the owner still
// had their money-truth and merely lost a copy.
//
// [ONTVANGEN] #129 inverts that for the human upload door. There the durable handoff IS the
// promise — we tell the owner "Ontvangen, je kunt verder" and they close the tab. From that
// moment the stored bytes and the documents row are the ONLY record that their invoice exists.
// Best-effort is not a contract you can make that promise on.
//
// So the same implementation now answers in two shapes, and there is still exactly one of it:
//
//   · storeRawIncoming()    — the historical signature, `string | null`. Unchanged for the
//                             reader-outage callers, whose meaning really is "keep it if you can".
//   · receiveRawIncoming()  — the same work, answering WHAT HAPPENED: created, existing, or
//                             failed. A caller that must decide whether to say "Ontvangen" needs
//                             that distinction, and `string | null` cannot carry it.
//
// The third value is the one that matters most. A returned id can mean "your file is now stored"
// or "we already had these exact bytes", and those are different facts: the first is new work to
// process, the second must NOT start a second processor run or reset an already-processed
// document back to waiting. One type that collapses them is how the same invoice gets booked
// twice.

import type { createServerSupabaseClient } from "@/lib/supabase-server"
import { createPipelineClient } from "@/lib/supabase-pipeline"
import { ensureImportedFolder } from "@/lib/bestanden"
import { computeContentHash } from "@/lib/content-hash"
import { releaseTrashedHash } from "@/lib/trashed-dedup"

/**
 * [ONTVANGEN] What the durable handoff actually did.
 *
 * `created`  — these bytes are new here. There is work to do, and this is the only outcome that
 *              may start one.
 * `existing` — we already hold this exact content for this owner. The owner may say "Ontvangen"
 *              just as truthfully, but nothing new must be processed: the earlier document is
 *              already read, waiting, or booked, and touching it would either duplicate a
 *              financial effect or push a finished document back into a queue.
 * `failed`   — the bytes and the row are NOT both durable. Whatever else happens, the owner must
 *              not be told we have their file.
 */
export type ReceiveOutcome =
  | { kind: "created"; documentId: string; contentHash: string }
  | { kind: "existing"; documentId: string; contentHash: string }
  | { kind: "failed"; reason: "storage" | "row" | "unexpected" }

export interface ReceiveOpts {
  /** [BEWAAR-EERST] false only where a reader genuinely did not run. */
  aiProcessed?: boolean
  /** [ONTVANGEN] Owner intent, already normalised to the canonical bank|kas. */
  intakePaidMethod?: "bank" | "kas" | null
  /** [ONTVANGEN] Owner intent, ISO yyyy-mm-dd. */
  intakePaidDate?: string | null
  /**
   * A seam, exactly like EnableBankingClientOptions.fetchImpl and the EB claim's claimStore: the
   * receive CONTRACT — bytes and row both durable, or no Ontvangen — is behaviour that cannot be
   * read off the source, and it is the promise the whole of #129 rests on. Production never
   * passes these.
   */
  deps?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipeline?: any
    ensureFolder?: (userId: string) => Promise<string | null>
  }
}

/** The historical shape. Identical work; `null` for anything that is not a usable document. */
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
  opts: ReceiveOpts = {},
): Promise<string | null> {
  const r = await receiveRawIncoming(buffer, file, userId, supabase, aiDocType, source, opts)
  return r.kind === "failed" ? null : r.documentId
}

/**
 * [ONTVANGEN] The same work, answering what happened rather than only where it landed.
 *
 * The owner's intent travels with it: paid_method and paid_date are chosen in the upload UI and
 * cannot be reconstructed from the file, so they are written on the row in the same insert that
 * makes the handoff durable. Persisting them afterwards would leave a window in which we have
 * said "Ontvangen" and the intent is still only in a browser that may already be closed.
 */
export async function receiveRawIncoming(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  aiDocType: string,
  source: string,
  opts: {
    aiProcessed?: boolean
    /** [ONTVANGEN] Owner intent, already normalised to the canonical bank|kas. */
    intakePaidMethod?: "bank" | "kas" | null
    /** [ONTVANGEN] Owner intent, ISO yyyy-mm-dd. */
    intakePaidDate?: string | null
    /**
     * A seam, exactly like EnableBankingClientOptions.fetchImpl and the EB claim's claimStore:
     * the receive CONTRACT — bytes and row both durable, or no Ontvangen — is behaviour that
     * cannot be read off the source, and it is the promise the whole of #129 rests on. Production
     * never passes these.
     */
    deps?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipeline?: any
      ensureFolder?: (userId: string) => Promise<string | null>
    }
  } = {},
): Promise<ReceiveOutcome> {
  const hash = computeContentHash(buffer)
  try {
    const { data: existing } = await supabase
      .from("documents").select("id, trashed").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
    // [DUP-TRASHED] Een weggegooide rij teruggeven zou de boeking koppelen aan bewijs dat de eigenaar
    // niet meer ziet staan. Sleutel vrijgeven en vers opslaan; lukt dat niet, dan loopt de insert
    // hieronder op de UNIQUE index stuk en valt dit terug op "geen document" — dit is en blijft
    // best-effort opslag, de boeking zelf is de money-truth.
    if (existing?.id && existing.trashed !== true) return { kind: "existing", documentId: existing.id, contentHash: hash }
    if (existing?.id) await releaseTrashedHash(supabase, userId, existing.id)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false })
    if (upErr) {
      console.error("[STORE-RAW] storage upload failed — the file is NOT kept", { userId, file: file.name, error: upErr.message })
      return { kind: "failed", reason: "storage" }
    }
    const folderId = opts.deps?.ensureFolder
      ? await opts.deps.ensureFolder(userId)
      : await ensureImportedFolder(userId, "pipeline")
    const pipelineDoc = opts.deps?.pipeline ?? createPipelineClient()
    const baseRow = {
      user_id: userId, file_name: file.name, file_url: storagePath,
      file_size: buffer.length, file_type: file.type || "application/octet-stream",
      doc_type: "overig", folder_id: folderId, source,
      ai_processed: opts.aiProcessed ?? true, ai_doc_type: aiDocType, content_hash: hash,
    }
    // [ONTVANGEN] In the SAME insert that makes the handoff durable — see the doc comment above.
    const intent = {
      ...(opts.intakePaidMethod ? { intake_paid_method: opts.intakePaidMethod } : {}),
      ...(opts.intakePaidDate ? { intake_paid_date: opts.intakePaidDate } : {}),
    }
    const wantsIntent = Object.keys(intent).length > 0
    // ontvangen_intake_intent.sql is applied BY HAND, and code ships before it runs. The columns
    // are therefore not in the generated types, and for one deploy they are not in the database
    // either — same relaxed client and same [DEPLOY-SAFE] shape the intake claim uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = pipelineDoc.from("documents") as any
    let { data: doc, error: docErr } = await docs.insert({ ...baseRow, ...intent }).select("id").single()
    if (docErr && (docErr as { code?: string }).code === "42703" && wantsIntent) {
      // The columns are not there yet. The FILE can still be kept — losing the bytes over a
      // missing column would be the worse failure by far — but the owner's own choice of how they
      // paid is then not stored anywhere, and that is not a thing to notice later from a figure.
      console.error(
        "[ONTVANGEN] intake intent columns are absent — the file is kept, the owner's paid_method/paid_date are NOT. Apply ontvangen_intake_intent.sql.",
        { userId, file: file.name },
      );
      ({ data: doc, error: docErr } = await docs.insert(baseRow).select("id").single())
    }
    if (docErr || !doc) {
      console.error("[STORE-RAW] documents insert failed — the file is NOT kept", { userId, file: file.name, error: docErr?.message })
      // [ONTVANGEN] The bytes go back out. Storage without a row is a file nobody can find and
      // an allowance nobody gets back — and it must never be mistaken for a successful handoff.
      await supabase.storage.from("documents").remove([storagePath]).catch(() => {})
      return { kind: "failed", reason: "row" }
    }
    return { kind: "created", documentId: doc.id, contentHash: hash }
  } catch (e) {
    console.error("[STORE-RAW] unexpected failure — the file is NOT kept", { userId, file: file.name, error: e instanceof Error ? e.message : String(e) })
    return { kind: "failed", reason: "unexpected" }
  }
}
