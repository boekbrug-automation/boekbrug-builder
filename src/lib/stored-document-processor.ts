// src/lib/stored-document-processor.ts
// [ONTVANGEN] The background pass over one already-received document.
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
//
// The owner has already been told "Ontvangen — je kunt verder". The tab may be closed. Everything
// that happens from here happens without them, and must still be right when the process it runs in
// dies halfway.
//
// ── THE ORDER, AND WHY IT IS THIS ORDER ──────────────────────────────────────────────────────
//
//     claim the document          keep two LIVE workers apart
//     load the durable row        the only inputs there are — no request, no File, no FormData
//     does an invoice exist?      ← the question that decides everything below it
//
//   invoice exists → resume:  no reader, no allowance, repair the breadcrumb, replay the tail
//   no invoice     → read:    facts → allowance → reader → duplicate gates → invoice → tail
//
// The existence check is FIRST because crash recovery after financial identity exists must not
// merely be safe; it must also not pay for a read we already know we do not need. The invoice is
// looked up by (document, owner) — never by `documents.invoice_id`, which production has already
// proved can be null beside a live invoice.
//
// ── WHAT MAKES IT SAFE, AND WHAT DOES NOT ────────────────────────────────────────────────────
//
// NOT the claim. A worker that dies mid-write releases nothing, and the claim it held simply
// expires. What survives a hard crash is the durable side of each step, and each has its own:
//
//     invoice            partial UNIQUE on invoices.document_id → 23505 → adopt, never mint
//     manual payment     apply_manual_payment replays on (client_key, user, invoice)
//     AI allowance       documents.intake_ai_counted_period, written in the counter's transaction
//     notification       partial UNIQUE (user_id, event_key)
//     final state        compare-and-set on the state this run loaded
//
// The final state is written LAST, so a crash anywhere leaves the document still WAITING and the
// next pass walks the same road, finding every completed step already done.

import { createPipelineClient } from "@/lib/supabase-pipeline"
import type { createServerSupabaseClient } from "@/lib/supabase-server"
import { claimStoredDocument } from "@/lib/stored-document-claim"
import {
  loadStoredDocument, autoFinishedEventKey,
  type ProcessMode, type StoredDocument,
} from "@/lib/stored-document"
import { findInvoiceForDocument, linkDocumentToInvoice, updateClassification } from "@/lib/document-placement"
import { autoSettlementKey } from "@/lib/settlement-key"
import { deriveFileFacts } from "@/lib/intake-derived"
import { planForUser } from "@/lib/fair-use-gate"
import { processIntakeDocument, type IntakeOutcome, type IntakeSource } from "@/lib/intake-processor"
import type { BackgroundTrigger } from "@/lib/intake-provenance"
import { createNotification } from "@/lib/notifications"
import { reconcileCashWithRetry } from "@/lib/cash-settle"
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm"

/**
 * What one background pass did. Every arm is a thing a drain has to be able to count, and none of
 * them is an exception: a pass that throws would take the whole drain down with it.
 */
export type StoredRunResult =
  /** The reader ran and the door answered. `outcome` is exactly what the interactive door returns. */
  | { kind: "processed"; outcome: IntakeOutcome }
  /** An invoice already existed. Nothing was read, nothing was charged, the tail was replayed. */
  | { kind: "resumed"; invoiceId: string }
  /** Another worker holds this document and is alive. Not an error. */
  | { kind: "busy" }
  /** We could not establish that we are alone, or could not read the row/bytes. Try later. */
  | { kind: "unavailable" }
  /** The row is not there, or is not this owner's. Never retry. */
  | { kind: "gone" }
  /** It is not waiting on us: already read, already booked, or waiting on the OWNER. */
  | { kind: "not_waiting"; state: string }
  /** Waiting on us, but not before this moment — the month's allowance. */
  | { kind: "paused"; until: string | null }
  /** The row says a file is stored and storage disagrees. Retrying cannot fix that. */
  | { kind: "bytes_missing"; storagePath: string }

/**
 * The seams a crash test needs, and nothing more.
 *
 * Production passes none of them. They exist because the three calls below reach outside this
 * module and build their own clients — so without a seam, a test of "does a retry ring a second
 * bell?" could not observe the bell at all. Same shape as LoadDeps in stored-document.ts.
 */
export interface StoredRunDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline?: any
  process?: typeof processIntakeDocument
  notify?: typeof createNotification
  reconcileCash?: typeof reconcileCashWithRetry
  bankConfirm?: typeof runBankAutoConfirm
  now?: Date
}

/**
 * Run (or resume) the processing of one stored document.
 *
 * `ownerId` is an argument rather than something this function discovers, and that is deliberate:
 * both the claim and the row read are owner-scoped, so the owner has to be known BEFORE either. The
 * two callers always know it — the request that received the file, and the drain that selected the
 * row by user_id — and a function that looked it up first would have to read a row it is not yet
 * allowed to claim.
 */
export async function processStoredDocument(args: {
  documentId: string
  ownerId: string
  mode: ProcessMode
  trigger: BackgroundTrigger
  source: IntakeSource
  deps?: StoredRunDeps
}): Promise<StoredRunResult> {
  const { documentId, ownerId, mode, trigger, source } = args
  const pipeline = args.deps?.pipeline ?? createPipelineClient()
  const now = args.deps?.now ?? new Date()

  // ── 1. One worker at a time ────────────────────────────────────────────────────────────────
  // The same service-role client the rest of this pass uses — intake_claims is one more table on
  // it, and a second client would be a second connection for no reason.
  const claim = await claimStoredDocument(ownerId, documentId, now, pipeline)
  if (!claim.claimed) return claim.outcome === "busy" ? { kind: "busy" } : { kind: "unavailable" }

  try {
    // ── 2. Everything this run knows, out of durable state ───────────────────────────────────
    const load = await loadStoredDocument(documentId, ownerId, mode, { pipeline }, now)
    switch (load.kind) {
      case "gone": return { kind: "gone" }
      case "not_waiting": return { kind: "not_waiting", state: load.state }
      case "paused": return { kind: "paused", until: load.until }
      case "bytes_missing": return { kind: "bytes_missing", storagePath: load.storagePath }
      case "unavailable": return { kind: "unavailable" }
    }
    const doc = load.doc

    // ── 3. Does this document already have an invoice? ───────────────────────────────────────
    const existing = await findInvoiceForDocument(documentId, ownerId, pipeline)
    if (existing.kind === "failed") {
      // We do not know whether financial identity exists. Reading now could mint a second invoice
      // the partial UNIQUE would then refuse anyway — and would charge the owner for the read.
      return { kind: "unavailable" }
    }
    if (existing.kind === "found") {
      await resumeStoredTail({ pipeline, ownerId, doc, invoiceId: existing.invoiceId, deps: args.deps })
      return { kind: "resumed", invoiceId: existing.invoiceId }
    }

    // ── 4. No invoice yet: the full road, through the one door there is ──────────────────────
    const facts = await deriveFileFacts(doc.buffer, doc.fileName, doc.fileType)
    const plan = await planForUser(pipeline, ownerId)
    const run = args.deps?.process ?? processIntakeDocument
    const outcome = await run({
      run: { kind: "background", trigger },
      // The background pass has no session, so the service-role client is the only one there is.
      // Measured rather than assumed: every read this door makes through it already carries its own
      // `user_id`/`receiver_id` filter in the statement, so no row set widens — which is the same
      // thing [RLS-UIT] says about the money line generally.
      supabase: pipeline as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
      user: { id: ownerId },
      file: new File([new Uint8Array(doc.buffer)], doc.fileName, { type: doc.fileType }),
      buffer: doc.buffer,
      source,
      // [INTAKE-FORCE] Never forced by a background pass. Forcing past a semantic duplicate is an
      // owner's decision about their own money, and nobody is here to make it.
      force: false,
      intent: doc.intent,
      effectiveType: facts.effectiveType,
      isEInvoice: facts.isEInvoice,
      pdfText: facts.pdfText,
      pdfPages: facts.pdfPages,
      contentHash: doc.contentHash ?? facts.contentHash,
      stored: {
        documentId,
        expectedAiDocType: doc.waitingState,
        storagePath: doc.storagePath,
        folderId: doc.folderId,
        plan,
      },
    })
    return { kind: "processed", outcome }
  } catch (e) {
    // A drain runs many documents. One that throws must cost that document a pass, never the run.
    console.error("[ONTVANGEN] the stored pass threw", {
      documentId, error: e instanceof Error ? e.message : String(e),
    })
    return { kind: "unavailable" }
  } finally {
    // Every exit releases OUR claim and only ours — see claim-lease.ts on why the stamp matters.
    await claim.release()
  }
}

/**
 * The tail, for a document whose invoice already exists.
 *
 * Every step is replay-safe by its own durable key, so this is a convergence pass rather than a
 * second booking: it finishes whatever the crashed run had not reached yet and changes nothing it
 * had. It reads what to do off the INVOICE rather than off a reader, because the reader is exactly
 * what we are not paying for again.
 */
async function resumeStoredTail(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any
  ownerId: string
  doc: StoredDocument
  invoiceId: string
  deps?: StoredRunDeps
}): Promise<void> {
  const { pipeline, ownerId, doc, invoiceId } = args
  const notify = args.deps?.notify ?? createNotification
  const reconcileCash = args.deps?.reconcileCash ?? reconcileCashWithRetry
  const bankConfirm = args.deps?.bankConfirm ?? runBankAutoConfirm

  // The breadcrumb, best-effort and never a reason to do anything financial. A refusal here means
  // the document is already the evidence of a DIFFERENT invoice, which is a thing to see, not to
  // repair by guessing.
  const linked = await linkDocumentToInvoice(doc.id, ownerId, invoiceId, pipeline)
  if (linked.kind === "refused" || linked.kind === "failed") {
    console.error("[ONTVANGEN] resume could not write the reverse link", {
      documentId: doc.id, invoiceId, outcome: linked.kind,
    })
  }

  const { data: inv, error } = await pipeline
    .from("invoices")
    .select("id, status, client_name, invoice_number, field_confidence")
    .eq("id", invoiceId)
    .eq("receiver_id", ownerId)
    .maybeSingle()
  if (error || !inv) {
    // findInvoiceForDocument just proved it exists, so this is infrastructure. Leave the document
    // waiting: the next pass resumes from the same place, and nothing here has moved money.
    console.error("[ONTVANGEN] resume could not re-read the invoice it just found", {
      documentId: doc.id, invoiceId, error: error?.message,
    })
    return
  }

  // [BON-AUTO] Whether this invoice was MEANT to settle itself is written on the invoice, by the
  // run that created it, in the same insert — so it survives that run's death. Replaying the call
  // is free: apply_manual_payment answers replayed=true on the same (client_key, user, invoice) and
  // moves no money. If the crash happened BEFORE the payment, this is the call that finishes it.
  const paid = (inv.field_confidence as { _auto_paid?: { method?: string; date?: string } } | null)?._auto_paid
  if (paid?.method && paid?.date) {
    const { error: settleErr } = await pipeline.rpc("apply_manual_payment", {
      p_user_id: ownerId,
      p_invoice_id: invoiceId,
      p_amount: null,
      p_pay_date: paid.date,
      p_method: paid.method,
      p_payable_statuses: ["received"],
      p_client_key: autoSettlementKey(doc.id),
    })
    if (settleErr) {
      console.error("[ONTVANGEN] resume could not replay the receipt settlement", {
        documentId: doc.id, invoiceId, error: settleErr.message,
      })
    }
    await reconcileCash(pipeline, ownerId)
    try { await bankConfirm({ payClient: pipeline, pipeline, userId: ownerId }) } catch { /* non-fatal */ }
  }

  // The bell. Its event key is what makes this safe to call on every resume: the run that already
  // rang it wrote the same key, so this one writes nothing and sends no second push.
  await notify({
    userId: ownerId,
    title: paid?.method ? "Bon automatisch verwerkt en afgeboekt" : "Factuur automatisch verwerkt",
    body: `${inv.client_name || "Een leverancier"} — ${inv.invoice_number ?? ""} is verwerkt.`.replace(/ {2,}/g, " "),
    type: "invoice",
    link: `/dashboard/incoming/manage?focus=${invoiceId}`,
    eventKey: autoFinishedEventKey(doc.id),
  })

  // And only now the final state, as a compare-and-set on the state this run loaded.
  const finished = await updateClassification(
    doc.id, ownerId, doc.waitingState,
    {
      doc_type: "factuur",
      folder_id: doc.folderId,
      ai_processed: true,
      // What it IS was decided by the run that booked the invoice. A resume does not re-decide it;
      // it reads it off the row that already carries the answer.
      ai_doc_type: (inv.field_confidence as { _intake_kind?: string } | null)?._intake_kind === "receipt"
        ? "receipt"
        : "invoice",
    },
    pipeline,
  )
  if (finished.kind === "failed") {
    console.error("[ONTVANGEN] resume finished but the final state did not write — it will be replayed", {
      documentId: doc.id, invoiceId,
    })
  }
}
