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
// The strict rule belongs to receiveRawIncoming() alone. The historical callers never supply
// intent — they are keeping a file after a reader outage — so their semantics are untouched by
// it: no intent, no intent columns, nothing to fail on.
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
 *
 * ── [UPLOAD-TRUTH-1] WHY BOTH LIVE OUTCOMES CARRY `folderId` ─────────────────────────────────
 *
 * The receive-first answer is the only thing the owner can follow after "Ontvangen": there is no
 * invoice yet, so the stored file IS the destination. /dashboard/bestanden finds a focused
 * document only inside the folder it is told to open — it filters by folder and returns silently
 * when the id is not in that list — and receive puts the file in "Geïmporteerde bestanden", never
 * in the root. So an answer carrying only the id produces a link to the ROOT, which lands on a
 * list the file is not in, and says nothing at all.
 *
 * This function is the one place that knows the folder. It resolved it two statements ago and
 * then dropped it on the floor. Returning it is the whole fix; every consumer already reads it.
 */
export type ReceiveOutcome =
  | { kind: "created"; documentId: string; contentHash: string; folderId: string | null }
  | { kind: "existing"; documentId: string; contentHash: string; folderId: string | null }
  | { kind: "failed"; reason: "storage" | "row" | "intent" | "unexpected" }

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
     * [ONTVANGEN] The bytes to KEEP, when they are not the bytes that arrived.
     *
     * A photographed receipt is wrapped into a PDF before it is stored, so that every invoice
     * lives as a PDF from day one. The wrap is lossless — the original JPEG is embedded, never
     * re-compressed — but it is NOT byte-stable: pdf-lib stamps CreationDate and ModificationDate,
     * so wrapping the same photo twice a second apart produces two different files.
     *
     * That measured fact is why this parameter exists instead of a caller simply handing the
     * converted buffer in as `buffer`. The content hash is the duplicate gate: it is what stops
     * the same bon, photographed twice or double-tapped through the upload button, becoming two
     * documents, two invoices, two costs and two voorbelasting claims. Hashing a wrapped copy
     * would make every photo's hash unique by construction and switch that gate off silently —
     * nothing would fail, nothing would log, and the books would simply start double-counting.
     *
     * So the hash is ALWAYS taken from the bytes as they arrived, and only the stored object is
     * the converted one. The e-mail door hashes its attachment as it arrived for the same reason,
     * which is what keeps a bon that came by mail and the same bon photographed recognisable as
     * one file.
     */
    storeInstead?: { buffer: Buffer; fileName: string; fileType: string }
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
  // The identity of what the owner handed over — never of what we chose to keep it in.
  const hash = computeContentHash(buffer)
  // What actually goes to storage and onto the row. Identical to the arriving bytes unless the
  // caller converted them first (see storeInstead).
  const kept = opts.storeInstead ?? { buffer, fileName: file.name, fileType: file.type }
  const keptType = kept.fileType || "application/octet-stream"
  try {
    // [UPLOAD-TRUTH-1] `folder_id` is read here for the same reason the created arm returns one:
    // the answer this produces is what the upload screen links to, and a link that names no
    // folder opens the root — where a received file never is.
    const { data: existing } = await supabase
      .from("documents").select("id, trashed, folder_id").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
    // [DUP-TRASHED] Een weggegooide rij teruggeven zou de boeking koppelen aan bewijs dat de eigenaar
    // niet meer ziet staan. Sleutel vrijgeven en vers opslaan; lukt dat niet, dan loopt de insert
    // hieronder op de UNIQUE index stuk en valt dit terug op "geen document" — dit is en blijft
    // best-effort opslag, de boeking zelf is de money-truth.
    if (existing?.id && existing.trashed !== true) {
      return { kind: "existing", documentId: existing.id, contentHash: hash, folderId: existing.folder_id ?? null }
    }
    if (existing?.id) await releaseTrashedHash(supabase, userId, existing.id)
    const safeName = kept.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, kept.buffer, { contentType: keptType, upsert: false })
    if (upErr) {
      console.error("[STORE-RAW] storage upload failed — the file is NOT kept", { userId, file: file.name, error: upErr.message })
      return { kind: "failed", reason: "storage" }
    }
    const folderId = opts.deps?.ensureFolder
      ? await opts.deps.ensureFolder(userId)
      : await ensureImportedFolder(userId, "pipeline")
    const pipelineDoc = opts.deps?.pipeline ?? createPipelineClient()
    const baseRow = {
      // [NAAM-BIJ-BINNENKOMST] The name, size and type as STORED — a photo filed as a PDF is
      // findable under the name it actually has in Bestanden, not the one the camera gave it.
      user_id: userId, file_name: kept.fileName, file_url: storagePath,
      file_size: kept.buffer.length, file_type: keptType,
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
    const { data: doc, error: docErr } = await docs.insert({ ...baseRow, ...intent }).select("id").single()
    if (docErr && (docErr as { code?: string }).code === "42703" && wantsIntent) {
      // ── [ONTVANGEN] The columns are not there, so this handoff FAILS. ──────────────────────
      //
      // The first draft retried without them: keep the file, drop the intent, answer "created".
      // That is the one degradation this contract cannot allow, and the reason is the promise
      // itself. "Ontvangen — je kunt verder" means we have everything the owner just handed over.
      // If they chose "betaald met pin op 18 september", that choice decides whether the bon
      // settles through the bank or the kas — it is financial behaviour, not a preference — and
      // after the tab closes it exists nowhere else.
      //
      // Remembering the bytes while forgetting the intent is the worst of the three outcomes: the
      // owner is told everything is safe, the document is processed later WITHOUT what they said
      // about it, and nothing anywhere reports a loss. A refusal costs one upload they can repeat;
      // a silent half-memory costs a booking nobody knows is wrong.
      //
      // So it is a precondition, not a degradation: ontvangen_intake_intent.sql must be proven
      // live BEFORE receive-first is enabled — the same rule [EB-RACE] follows for intake_claims.
      // We control that order, so there is no half-schema window to survive.
      console.error(
        "[ONTVANGEN] intake intent columns are absent — REFUSING the handoff and rolling the bytes back. Apply ontvangen_intake_intent.sql before enabling receive-first.",
        { userId, file: file.name },
      )
      await supabase.storage.from("documents").remove([storagePath]).catch(() => {})
      return { kind: "failed", reason: "intent" }
    }
    if (docErr || !doc) {
      console.error("[STORE-RAW] documents insert failed — the file is NOT kept", { userId, file: file.name, error: docErr?.message })
      // [ONTVANGEN] The bytes go back out. Storage without a row is a file nobody can find and
      // an allowance nobody gets back — and it must never be mistaken for a successful handoff.
      await supabase.storage.from("documents").remove([storagePath]).catch(() => {})
      return { kind: "failed", reason: "row" }
    }
    return { kind: "created", documentId: doc.id, contentHash: hash, folderId }
  } catch (e) {
    console.error("[STORE-RAW] unexpected failure — the file is NOT kept", { userId, file: file.name, error: e instanceof Error ? e.message : String(e) })
    return { kind: "failed", reason: "unexpected" }
  }
}
