// src/app/api/intake/route.ts
// [SMART-INTAKE] Unified intake point. One upload (camera/file) → classify →
// route to the right destination. Reuses existing building blocks; does NOT
// replace /api/email/upload or /api/bank/upload (kept for back-compat).
//
// Flow:
//   1. auth + read file (image / pdf / bank text/xml)
//   2. byte-hash dedup (same file already imported → 409, cross-path)
//   3. pre-AI: is it a bank statement (by shape)? → bank pipeline, done.
//   4. AI verify+classify (image/pdf): invoice / receipt / other + is_paid
//   5. route:
//        - 'document' (other / not invoice) → store in bestanden only
//        - 'invoice'  → invoices, status 'processing' → verify queue
//        - 'receipt'  → invoices, status 'processing', suggest 'paid' in the
//                       verify queue (human confirms — Pillar ⑤)
//
// Money-truth guardrails: a receipt is NEVER auto-marked paid; it is SUGGESTED.
// A bank statement is never run through the invoice extractor. SAFECORE Rule 1
// (arithmetic) still applies on the invoice/receipt write path.

import { round2 } from "@/lib/invoice-totals"
import { effectiveTaxKind } from "@/lib/tax-letter"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
// [DEUR-VANGNET] Eén vangnet voor elke deur waar een document binnenkomt.
import { withCrashNet } from "@/lib/route-crash-net"
import { createServerSupabaseClient } from "@/lib/supabase-server"
import { createPipelineClient } from "@/lib/supabase-pipeline"
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { createNotification } from "@/lib/notifications"
import {
  verifyInvoiceFromPdf,
  // [STATEMENT-RECONCILE] herkenning + lezer van een leveranciersoverzicht
  isStatementFilename,
  looksLikeStatementReason,
  readSupplierStatement,
} from "@/lib/ai"
// [STATEMENT-RECONCILE] pure vergelijking: overzichtsregels × onze eigen facturen.
import {
  reconcileStatement,
  reconcileNote,
  summarizeReconcile,
  type StatementLine,
  type BookedInvoice,
} from "@/lib/statement-reconcile"
import { supplierNameKey } from "@/lib/supplier-registry"
import { resolveImportTarget, ensureImportedFolder } from "@/lib/bestanden"
import { computeContentHash } from "@/lib/content-hash"
// [BEWAAR-EERST] Shared with /api/bank/attach-invoice — one keep-the-file path, not two.
import { storeRawIncoming } from "@/lib/store-raw-incoming"
// [BEWAAR-EERST] The label the skipped panel counts, so a file we could not read yet gets its
// "Lees opnieuw" button — see skipped-import.ts and [TWEEDE-KANS].
import { DOC_TYPE_COULD_NOT_READ } from "@/lib/skipped-import"
import { buildFolderBreadcrumb } from "@/lib/documents"
import { importBankStatement } from "@/lib/bank-ingest"
import { logAuditAction, getClientIP } from "@/lib/audit"
import { decidePreAi, decideFromAi } from "@/lib/intake-router"
// [BON-BETAALWIJZE] Eén normalisator voor elke weg waarlangs een betaalwijze binnenkomt.
import { normaliseerBetaalwijze } from "@/lib/bon-betaalwijze"
// [OBSERVABILITY] Eén bron voor "dit bestand is bewaard maar niet gelezen" — gedeeld met het
// overgeslagen-paneel, dat vroeger op een andere waarde las dan hier werd geschreven.
import { docTypeForStoredFile, DOC_TYPE_UNSUPPORTED, DOC_TYPE_REMINDER } from "@/lib/skipped-import"
// [HERINNERING-NOOIT] A reminder is filed and linked to its invoice, never booked.
import { fileReminder } from "@/lib/reminder-file"
// [SHEET-INTAKE] Route an uploaded kassa Z-report / grootboek export into the EXISTING
// turnover + ledger pipelines instead of filing it as an opaque document.
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter"
import { looksLikeSpreadsheetBinary, sniffReadableMime } from "@/lib/detect-file"
// [E-FACTUUR-XML] Een Peppol-factuur die met de hand wordt geüpload — zelfde lezer als de mail.
import { looksLikeInvoiceXmlBytes, E_INVOICE_XML_MIME } from "@/lib/e-invoice"
import { planSpreadsheetIngest, ledgerKindLabel } from "@/lib/spreadsheet-ingest"
import { looksLikeDailySalesReport, parseDailySalesReport } from "@/lib/daily-sales-report"
import { bookTurnoverRows, bookLedgerRows } from "@/lib/turnover-book"
import { escapeLikeValue } from "@/lib/sanitize"
import { shouldAutoAdvanceInvoice } from "@/lib/auto-advance"
// [BON-AUTO] Mag een kassabon zichzelf afboeken? Alleen als het PAPIER de tenderregel afdrukt.
import { planReceiptSettlement, settleNoticeText } from "@/lib/receipt-auto-settle"
// [MULTI-INVOICE] "Eén PDF = één factuur" stond onder elke uploadknop en werd nergens
// gecontroleerd. Een gescande stapel levert één factuur op; de rest verdwijnt spoorloos.
import { detectMultipleInvoices, cannotVerifySingleInvoice, mergeMultipleInvoices, mergeUnverifiedSingle } from "@/lib/multi-invoice-pdf"
// [PDF-TEXT] Shared with the e-mail door, so both run the same text-layer checks.
import { readPdfTextLayer } from "@/lib/pdf-text"
// [GEGROND] The stored verdict on whether the total is printed on the document.
import { groundingOf, moneyGroundedInText } from '@/lib/amount-grounding'
import { placementOf, btwContradictionOf } from '@/lib/document-verify'
import { eInvoiceContradictsRead } from '@/lib/e-invoice'
import { reconcileCashWithRetry } from "@/lib/cash-settle"
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm"
// [INTAKE-IMG-PDF] Convert an uploaded image (jpg/png) to a one-page PDF at
// ingest, so every invoice lives as a PDF from day one (opens uniformly, can be
// stamped by the closing package with no download-time conversion).
import { maybeImageToPdf } from "@/lib/image-to-pdf"
// [SAFECORE Rule 2] semantic duplicate detection — same graded logic as the
// email path, so the camera/file path also blocks "same invoice, different file".
import { findSemanticDuplicate, pickDedupMatch, normalizeToIso, type PossibleDuplicate, normalizeInvoiceNumber, vendorCoreKey } from "@/lib/safecore"
// [DUP-TRASHED] De uitzondering op de byte-hash-poort voor een bestand dat de eigenaar zelf heeft
// weggegooid. Gedeeld met /api/email/upload, /api/bank/attach-invoice en de mailsync — vier kopieën
// van deze redenering zouden drie kansen zijn dat er één uit de pas gaat lopen.
import { trashedDuplicateCleared } from "@/lib/trashed-dedup"
import { collectPossibleDuplicate, mergePossibleDuplicate, markDuplicateCheckUnavailable } from "@/lib/possible-duplicate-collect"
// [READING-MEMORY] Feed the reader what the owner keeps correcting at each supplier.
import { readingPromptHint } from "@/lib/reading-memory"
import { makeOwnInvoiceLookup } from "@/lib/own-invoice-lookup"
// [ZELF-EERST] The owner's grip on the autopilot — see the helper for the fail matrix.
import { autoBoekenAllowed } from "@/lib/auto-boeken"
import { loadReadingMemory } from "@/lib/reading-memory-source"
// [DUP-ARCHIVED] Botst de upload op een factuur die de eigenaar zelf genegeerd heeft? Dan is
// "die staat er al" waar, maar nutteloos — hij staat in Genegeerd. Zeg dat, en noem terugzetten.
import { archivedDuplicateMessage, archivedInvoiceById, archivedInvoiceForDocument } from "@/lib/archived-duplicate"
// [IBAN-WISSEL] Bekende leverancier, ander rekeningnummer → needs-review (en dus nooit auto-boeken).
import { mergeSafecore, resolveSupplierAtIntake } from "@/lib/intake-supplier"
import { creditWordInHeader } from "@/lib/creditnota-signal"
// [EXTRACT-DUE-DATE] shared due-date derivation (explicit → invoice_date+term →
// null). Same single source of truth as the email path; never duplicated.
import { deriveDueDate } from "@/lib/safecore"
// [SMART-INTAKE] jsonb column type for invoices.field_confidence — same pattern
// as email-integration.ts / audit.ts: derive the Json type, cast at write.
import type { Database } from "@/types/database.types"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { gateFairUse, gateFairUseForRead } from "@/lib/fair-use-gate";
// [TZ] The owner's day, not the server's — see amsterdamToday().
import { amsterdamToday } from "@/lib/format-nl";
import { supplierBtwForInvoice } from "@/lib/vendor-identity"
import { telWoord, vervoeg } from "@/lib/nl-plural";
// [NUL-GRONDSLAG] What may be stored when the split was not read — see read-amounts.ts.
import { amountsToStore, markUnexplainedZeroBtw } from "@/lib/read-amounts";
type InvoiceFieldConfidence =
  Database["public"]["Tables"]["invoices"]["Insert"]["field_confidence"]

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

// [INTAKE-DURATION] This route had NO maxDuration while every other heavy route in the app sets
// one (tools/scan-invoice 30, email/reimport 120, reconcile/run 120, closing-package 300) — and
// this is the heaviest of them all: a raw-PDF Claude read, plus a SECOND Claude call for a
// supplier statement, plus reconcileCashSettlements + runBankAutoConfirm after an auto-advance.
//
// The damage of running out was not "slow", it was a TRAP. The document row is written before
// the invoice row; a kill in between leaves an orphan documents row carrying the content_hash,
// and the byte-hash gate then refuses the re-upload forever ("Dit bestand staat al in je
// bestanden") while no invoice was ever created. The rollback further down covers a DB error —
// it cannot run when the function is killed. So the ceiling has to be high enough that the
// window never opens.
//
// [INTAKE-TIMEOUT] Nog een gevolg dat hierbij hoort: een gedode functie antwoordt geen JSON, dus de
// uploadpagina hield een leeg object over en meldde "Lezen mislukt — probeer dit bestand opnieuw"
// bij een bestand waar niets mis mee was. Zie describeUploadFailure: die vertaalt een 504 nu naar
// wat er werkelijk gebeurde, in plaats van het bestand de schuld te geven.
export const maxDuration = 120

/** documents.source / invoices.source CHECK values this route may write. */
const INTAKE_SOURCES = ["camera", "upload"] as const
type IntakeSource = (typeof INTAKE_SOURCES)[number]

/**
 * [BOUWSEL-GEEN-BELOFTE] The one door, with a net under it.
 *
 * Everything below runs unguarded: 1350 lines, five destinations, a dozen tables and an AI call,
 * and not one try/catch around the whole. A throw anywhere in there did not become an answer — it
 * escaped to the platform, which replies with an HTML error page. The owner's screen then read
 * "de server gaf een onverwacht antwoord (HTTP 500) — probeer het opnieuw", because the client
 * could not even parse a reason out of it (describeUploadFailure's last resort, upload-failure.ts).
 *
 * That is how a one-word mistake in an opportunistic cleanup line took down photographing an
 * invoice altogether, and told nobody what happened: no JSON, no sentence, nothing in our logs
 * that pointed at the line. This wrapper does not make a crash harmless — nothing was written, and
 * the owner still has to take the photo again — but it makes it VISIBLE: named in the server log
 * with its stack, and answered in the owner's language instead of by the platform.
 *
 * Deliberately a wrapper and not a try/catch around the body: re-indenting the whole function
 * would collide with every other session working in this file, for zero behaviour.
 */
export async function POST(req: NextRequest) {
  return withCrashNet(
    "INTAKE",
    "Er ging iets mis bij het verwerken van dit bestand. Het is NIET opgeslagen — maak de foto " +
      "opnieuw of probeer het zo meteen. Blijft dit gebeuren, laat het ons weten: wij zien de fout aan onze kant.",
    () => runIntake(req),
  )
}

async function runIntake(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 })
  }

  // [COST] The per-user AI/OCR ceiling is enforced LATER — right before the Claude call — NOT here.
  // A bank statement, a kassa/grootboek spreadsheet, and a daily-sales PDF are all parsed LOCALLY
  // (no Claude call, no spend), so they must never consume the AI budget: counting them here made a
  // shop uploading a month of till/bank files burn its whole allowance and then hit "te veel
  // verzoeken" on the real receipts. The gate now sits at the single verifyInvoiceFromPdf call.

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 })
  }
  // [NUL-BYTES] Een leeg bestand heeft niets om te lezen én één gedeelde hash (SHA-256 van de
  // lege string) — het eerste lege bestand claimt die hash en elk volgend leeg bestand, hoe het
  // ook heet, wordt dan geweigerd als "staat al in je bestanden". Weigeren vóór alles, met een
  // zin die zegt wat er aan de hand is. De twee sheet-routes doen dit al.
  if (file.size === 0) {
    return NextResponse.json({ error: "Dit bestand is leeg (0 bytes) — er valt niets te lezen. Controleer het bestand en probeer opnieuw." }, { status: 422 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 })
  }

  // [INTAKE-FORCE] The owner can override a SEMANTIC duplicate block ("toch toevoegen")
  // when the match is a false positive — e.g. two genuinely distinct same-day receipts
  // from one vendor for the same amount, neither carrying an invoice number. This NEVER
  // overrides the byte-hash gate below: the exact same file still can't be added twice.
  const force = formData.get("force") === "true"

  // [INTAKE-SOURCE] Every row this route wrote claimed source 'camera', including a PDF picked
  // from Files and a whole batch dropped on /dashboard/upload. The client now says which it was;
  // anything unrecognised (or absent, i.e. an older client) falls back to today's 'camera', so
  // the CHECK constraint on documents.source/invoices.source can never be violated from here.
  const sourceRaw = formData.get("source")
  const source: IntakeSource =
    typeof sourceRaw === "string" && (INTAKE_SOURCES as readonly string[]).includes(sourceRaw)
      ? (sourceRaw as IntakeSource)
      : "camera"

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ── Stage 1: bank statement by file shape (pre-AI) ──────────────────────────
  // Read a small text head only when the file could be text/xml (cheap).
  const couldBeText =
    file.type === "" ||
    file.type === "text/plain" ||
    file.type === "text/xml" ||
    file.type === "application/xml" ||
    file.type === "text/csv" ||
    // [BANK-CSV] Read a text head for .csv too, so decidePreAi's bank-CSV sniff can run — a
    // Rabo/ING/bunq CSV export is a bank statement, not a spreadsheet to file away.
    /\.(xml|mt940|940|sta|camt|053|txt|csv)$/i.test(file.name)
  const textHead = couldBeText ? buffer.slice(0, 4096).toString("utf8") : undefined

  const preAi = decidePreAi(file.name, file.type, textHead)
  if (preAi?.destination === "bank") {
    return handleBankStatement(buffer, file.name, user.id, file.type || "text/plain")
  }

  // ── Stage 1b: a spreadsheet the shop exports monthly — a kassa Z-report (→ dagomzet) or a
  //    PIN/kas grootboek export (→ ledger witness). These are the backbone of a shop's numbers,
  //    and were silently dead-ending as opaque "documents" because the extractor only reads
  //    pdf/image. Detect by magic bytes (.xls/.xlsx) or extension (.csv, already NOT a bank CSV
  //    since decidePreAi ran first), parse ONCE, and hand off to the real pipelines. A file that
  //    is neither turnover nor ledger returns null → falls through to the safe document store. ──
  if (looksLikeSpreadsheetBinary(buffer) || /\.(xls|xlsx|csv)$/i.test(file.name)) {
    const sheetResp = await handleSpreadsheet(buffer, file, user.id, supabase, req, source)
    if (sheetResp) return sheetResp
    // null → not a recognised turnover/ledger sheet; continue to the document path below.
  }

  // ── [UBL-INTAKE] XML e-invoice (UBL / Peppol) → the invoice pipeline, not the opaque document
  //    bin. A B2B/overheid supplier's factuur.xml was being filed as 'unsupported_type' with NO
  //    invoice row, so its voorbelasting silently never reached the aangifte (a missing invoice).
  //    We parse the standard UBL leaf elements and create a verify-queue invoice (status
  //    'processing') so the human confirms it into Crediteuren exactly like a PDF invoice. A CAMT
  //    bank statement is excluded (looksLikeUblInvoice returns false) and still falls to the bank
  //    handler / document store below. ──
  if (/\.xml$/i.test(file.name) || file.type === "text/xml" || file.type === "application/xml") {
    const xmlText = buffer.toString("utf8")
    const { looksLikeUblInvoice } = await import("@/lib/ubl-invoice")
    if (looksLikeUblInvoice(xmlText)) {
      const ublResp = await handleUblInvoice(xmlText, buffer, file, user.id, supabase, force, req)
      if (ublResp) return ublResp
      // null → couldn't extract anything usable; fall through to the safe document store.
    }
  }

  // [MIME-SNIFF] A phone/webview upload can arrive with an EMPTY or generic MIME (file.type === ""
  // or "application/octet-stream") even for a perfectly readable JPEG/PNG/PDF — Android share-sheets
  // and some mobile WebViews do this. The extractor picks its branch by MIME, so without this an
  // IMG_1234.jpg with no type dead-ends in the opaque document bin and its voorbelasting is never
  // read (and the owner is told, dishonestly, that we "couldn't read this file type"). Sniff the
  // leading magic bytes and use that as the effective type for BOTH the okForAi guard and the reader.
  // [E-FACTUUR-XML] A Peppol / NLCIUS invoice, asked of the CONTENT and never of the media type
  // the client supplied — a .xml uploaded from a phone arrives as "text/xml", "application/xml",
  // "application/octet-stream" or nothing at all, depending on nothing in particular.
  //
  // The comment below used to name "an XML/UBL e-invoice" first among the things the extractor
  // cannot read, and filing it in bestanden was the right answer for as long as that was true. It
  // no longer is: verifyInvoiceFromPdf reads one exactly, with no model and no API call. Leaving
  // this door alone would have meant the e-mail sync could book a Peppol invoice and the upload
  // button — the one an owner reaches for when a supplier portal hands them the file — could not.
  const isEInvoice = looksLikeInvoiceXmlBytes(buffer)
  const effectiveType = isEInvoice ? E_INVOICE_XML_MIME : (sniffReadableMime(buffer) ?? file.type)

  // ── Type guard for the AI path: pdf/image go to the extractor, and so does an e-invoice ──────
  const okForAi =
    effectiveType === "application/pdf" ||
    effectiveType.startsWith("image/") ||
    isEInvoice ||
    file.name.toLowerCase().endsWith(".pdf")

  // [INTAKE-KEEP-ALL] Never hard-reject a plausible document. A file the extractor can't read —
  // a Word/Excel document, a .csv that isn't a bank export — must NOT be lost: store it in
  // bestanden so the accountant still receives it and the owner can act on it. Only the automatic
  // EXTRACTION is skipped; the file itself is kept and visible. This upholds "no missing invoice"
  // for every format.
  if (!okForAi) {
    const hash = computeContentHash(buffer)
    const { data: dupDoc } = await supabase
      .from("documents").select("id, folder_id, trashed")
      .eq("user_id", user.id).eq("content_hash", hash).limit(1).maybeSingle()
    // The byte-hash gate is NEVER forceable (route contract): identical bytes are
    // the same file, and an unreadable file carries no invoice to "add again", so
    // `force` has nothing to override here. Short-circuiting regardless of force
    // returns the honest duplicate message instead of letting the re-insert trip
    // the (user_id, content_hash) unique index and surface a generic 500.
    // [DUP-TRASHED] …tenzij het duplicaat in de prullenbak ligt: dan is dit geen duplicaat maar een
    // doodlopende weg (zie trashedDuplicateCleared). Sleutel vrij → doorlopen als vers bestand.
    if (dupDoc && !(await trashedDuplicateCleared(supabase, user.id, dupDoc))) {
      const bc = await buildFolderBreadcrumb(supabase, user.id, dupDoc.folder_id)
      return NextResponse.json({
        duplicate: true, destination: "document",
        error: "Dit bestand staat al in je bestanden.",
        // [DUP-SHAPE] folder_name belongs INSIDE `existing`. Both upload surfaces read
        // data.existing.folder_name (never a top-level copy), so the name sat in the response
        // and no client could reach it — the modal fell back to the bare message and never told
        // the owner WHERE the file already is. One shape for all three duplicate 409s.
        existing: {
          id: dupDoc.id,
          folder_id: dupDoc.folder_id ?? null,
          folder_name: bc.length ? bc[bc.length - 1] : null,
          // [MELDING-WEG] [TAAL] The whole breadcrumb, so the screen can say WHERE in the owner's
          // language instead of printing the Dutch `error` above. Same field the e-mail route sends.
          folder_path: bc,
        },
      }, { status: 409 })
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`
    const contentType = file.type || "application/octet-stream"
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, buffer, { contentType, upsert: false })
    if (upErr) {
      return NextResponse.json({ error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." }, { status: 502 })
    }
    const folderId = await ensureImportedFolder(user.id, "pipeline")
    const pipelineDoc = createPipelineClient()
    const { data: doc, error: docErr } = await pipelineDoc
      .from("documents").insert({
        user_id: user.id, file_name: file.name, file_url: storagePath,
        file_size: buffer.length, file_type: contentType,
        doc_type: "overig", folder_id: folderId, source,
        ai_processed: false, ai_doc_type: DOC_TYPE_UNSUPPORTED, content_hash: hash,
      })
      .select("id").single()
    if (docErr || !doc) {
      await supabase.storage.from("documents").remove([storagePath])
      // [DEDUP-ATOMIC] Same race the invoice and UBL inserts already handle: a concurrent
      // double-submit slips past the SELECT above and trips the (user_id, content_hash) UNIQUE
      // index (23505). This path alone still turned that into a generic 500. It is the same
      // duplicate the SELECT would have caught a millisecond earlier — answer it the same way.
      if (docErr && (docErr as { code?: string }).code === "23505") {
        const { data: raced } = await supabase
          .from("documents").select("id, folder_id").eq("user_id", user.id).eq("content_hash", hash).limit(1).maybeSingle()
        const racedPath = raced ? await buildFolderBreadcrumb(supabase, user.id, raced.folder_id ?? null) : []
        return NextResponse.json({
          duplicate: true, destination: "document",
          error: "Dit bestand staat al in je bestanden.",
          existing: raced
            ? { id: raced.id, folder_id: raced.folder_id ?? null, folder_name: racedPath.length ? racedPath[racedPath.length - 1] : null, folder_path: racedPath }
            : undefined,
        }, { status: 409 })
      }
      return NextResponse.json({ error: "Opslaan in je bestanden is mislukt — probeer het opnieuw." }, { status: 500 })
    }
    const bc = await buildFolderBreadcrumb(supabase, user.id, folderId)
    return NextResponse.json({
      ok: true, destination: "document", document_id: doc.id, folder_id: folderId,
      folder_name: bc.length ? bc[bc.length - 1] : null,
      // [NAAM-BIJ-BINNENKOMST] Unchanged on this path — nothing is converted here — but reported
      // for the same reason: the sheet names what is in Bestanden, never what the browser sent.
      file_name: file.name,
      message: "We konden dit bestandstype niet automatisch uitlezen, maar het staat veilig in je bestanden — je accountant krijgt het en je kunt het zelf controleren.",
    })
  }

  // ── Byte-hash dedup (cross-path: same hash as email / upload / bestanden) ───
  const contentHash = computeContentHash(buffer)
  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id, invoice_id, trashed")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle()

  // [DUP-TRASHED] Een botsing met een WEGGEGOOID bestand is geen duplicaat maar een doodlopende weg
  // — de eigenaar gooide het zelf weg en kan het zonder dit nooit meer toevoegen. Sleutel vrijgeven
  // en doorlopen; hoort er nog een levende factuur bij, dan vangt de semantische poort dat verderop
  // af (mét canForce). Zie trashedDuplicateCleared voor het waarom van de UPDATE.
  if (existingDoc && !(await trashedDuplicateCleared(supabase, user.id, existingDoc))) {
    const folderPath = await buildFolderBreadcrumb(supabase, user.id, existingDoc.folder_id ?? null)
    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "intake" },
      ipAddress: getClientIP(req),
    })
    // [DUP-ARCHIVED] Hoort er een GENEGEERDE factuur bij dit bestand? Dan is "staat al in map X"
    // niet het antwoord op de vraag die de eigenaar heeft. De blokkade blijft (identieke bytes,
    // en deze poort is met opzet niet te forceren) — maar nu mét de handeling die wél werkt.
    const archived = await archivedInvoiceForDocument(supabase, user.id, existingDoc)
    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd"
    return NextResponse.json({
      error: archived ? archivedDuplicateMessage(archived) : where,
      duplicate: true,
      // [INTAKE-FEEDBACK] structured target so the client can deep-link + focus
      existing: {
        id: existingDoc.id,
        folder_id: existingDoc.folder_id ?? null,
        folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null,
      },
      // [DUP-ARCHIVED] aanwezig ⇒ de client biedt "Terugzetten" aan (PATCH /api/email/confirm/[id]).
      ...(archived ? { archived } : {}),
    }, { status: 409 })
  }

  // ── Stage 1c: a daily-sales report PDF ("OMZET VAN DD/MM/YYYY") is one day of turnover, not an
  //    invoice. Detect it by its text layer BEFORE the invoice extractor and book it into
  //    daily_turnover (idempotent with the monthly Excel path). A PDF that is NOT this report
  //    returns null and continues to the normal AI extractor below. ──
  // [MULTI-INVOICE] The text layer is pulled ONCE here and reused: the daily-sales check needs
  // it, and so does the "is this really one invoice?" check further down. Extracting it twice
  // would parse every uploaded PDF twice for no gain.
  // [ONE-INVOICE-UNVERIFIED] Het paginacijfer komt uit diezelfde ene keer openen mee.
  let pdfText: string | null = null
  let pdfPages = 0
  if (effectiveType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const read = await readPdfTextLayer(buffer)
    pdfText = read.text
    pdfPages = read.pages
    const dailyResp = await handleDailySalesPdf(pdfText, buffer, file, user.id, supabase, req, source)
    if (dailyResp) return dailyResp
  }

  // ── Stage 2: AI verify + classify ───────────────────────────────────────────
  // [COST] The AI/OCR ceiling applies ONLY here — the single Claude call. Bank/spreadsheet/daily-PDF
  // files returned above without ever reaching this point, so they never counted against the budget.
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/intake", ...RATE_LIMITS.AI_OCR })
  if (!rl.allowed) return rateLimitResponse(rl)

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek hierboven gaat over
  // snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een weigering
  // pauzeert alleen dit ene automatische uitlezen — het bestand zelf wordt gewoon bewaard.
  // [E-FACTUUR-GRATIS] An e-invoice is read mechanically — no model, no cost — so it may not spend
  // a document from the month's allowance. Charging for it would make the owner pay for something
  // free AND push a real invoice, one that does need reading, out of the month.
  const gate = await gateFairUseForRead({
    client: supabase, userId: user.id, metric: "aiDocuments", costsAiCall: !isEInvoice,
  });
  if (!gate.allowed) return gate.response!;

  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name, kvk_number, btw_number, iban")
    .eq("id", user.id)
    .maybeSingle()
  const receiverName = me?.company_name || me?.full_name || null

  const base64 = buffer.toString("base64")
  // [AI-CONFIG-SAFE] Opt into throwOnTransient so a CONFIG/AUTH/transient reader failure (missing or
  // rotated ANTHROPIC_API_KEY, 401/403/5xx, network) is NOT swallowed into the confidence-0 FALLBACK.
  // Without this, such a failure returns is_invoice:false and a REAL invoice the owner just uploaded
  // gets filed as a plain 'document' — its cost + voorbelasting silently lost. A genuine "not an
  // invoice" is still a normal parsed return (never an exception), so only true infra failures throw.
  // Nothing is stored for the image/PDF path until AFTER this call, so returning here files nothing.
  let v: Awaited<ReturnType<typeof verifyInvoiceFromPdf>>
  try {
    // [RECEIVER-IDENTITY] Pass our own KVK/BTW/IBAN (as email-sync/upload/reimport do) so the
    // extractor drops any vendor_kvk/btw/iban equal to the owner's own — otherwise a camera/file
    // upload could store the OWNER'S OWN IBAN as vendor_iban on a self-referencing document, which
    // later feeds the IBAN+amount bank auto-match tier.
    v = await verifyInvoiceFromPdf(base64, effectiveType, file.name, receiverName, {
      throwOnTransient: true,
      // [READING-MEMORY] Which suppliers this owner keeps having to correct, and in which field.
      // Fields only, never amounts. Null when the memory is empty or could not be loaded — the
      // reader then behaves exactly as it did before this existed.
      readingHint: readingPromptHint(await loadReadingMemory(supabase, user.id)),
      receiverKvk: me?.kvk_number || null,
      receiverBtw: me?.btw_number || null,
      receiverIban: me?.iban || null,
      // [EIGEN-NUMMER] Recognise the owner's own outgoing invoice by its number, even when the
      // reader mis-assigned the parties (the case the identity fields above cannot catch).
      lookupOwnInvoice: makeOwnInvoiceLookup(supabase, user.id),
    })
  } catch (aiErr) {
    // ── [BEWAAR-EERST] The file is kept BEFORE anything else is decided about it ──────────────
    //
    // This branch used to store nothing and answer 503 "probeer het zo meteen opnieuw", and the
    // comment four lines up said so out loud: "Nothing is stored for the image/PDF path until
    // AFTER this call, so returning here files nothing." That is a reader outage discarding a
    // document the owner had already handed us. During an outage of hours it discards it again on
    // every retry, and the only copy left is the one on their phone.
    //
    // The two doors into this app disagreed about that, and the weaker one was the one a HUMAN
    // stands at: the e-mail sync keeps every attachment it cannot read (saveKeptAttachment) and
    // holds the watermark so it is read again by itself. Upload threw it away.
    //
    // So the bytes are stored first, labelled could_not_read — which is exactly what the skipped
    // panel counts, so the file arrives there WITH the "Lees opnieuw" button [TWEEDE-KANS] already
    // on it. No new screen, no new state: the machinery for the second attempt was already built,
    // it was simply never handed anything from this door.
    console.error("[BEWAAR-EERST] intake AI read failed — keeping the file, asking nobody to upload it again", aiErr)
    // ai_processed:false, because it was not. A row that claims a read that never happened is the
    // kind of small lie the reader-quality panel then reports as a successful read.
    const keptId = await storeRawIncoming(buffer, file, user.id, supabase, DOC_TYPE_COULD_NOT_READ, source, { aiProcessed: false })
    // [FAIR-USE] Mislukt = niet gelezen = niet geteld. /eerlijk-gebruik §3 belooft dat
    // letterlijk, en het is ook gewoon eerlijk: een storing van ons mag de gebruiker geen
    // document van zijn maandtegoed kosten.
    await gate.release()
    // [NO-SILENT-EMPTY] And if the STORE failed too, then we really are empty-handed, and the
    // owner must be told to keep the file — the one answer where "upload it again" is the truth.
    if (!keptId) {
      return NextResponse.json(
        { error: "We konden dit bestand nu niet lezen én niet bewaren. Bewaar het zelf even en probeer het zo meteen opnieuw." },
        { status: 503 },
      )
    }
    return NextResponse.json({
      ok: true,
      destination: "document",
      documentId: keptId,
      // Not an error, because nothing went wrong for the owner: the file is in, and the app owes
      // them the read. It says the one thing that saves them work — do not upload this again.
      message: "Automatisch inlezen lukt op dit moment niet. Je bestand is bewaard — je hoeft het niet opnieuw te uploaden. Je vindt het bij Inkomend onder \u201eOvergeslagen bij import\u201d, met een knop om het opnieuw te laten lezen.",
    })
  }

  // [FAIR-USE §3] Een oordeel dat vóór enige model-aanroep viel (ongeldige PDF) heeft geen
  // lezing verbruikt — geef het gereserveerde tegoed terug. De crash-kant deed dit al.
  if (v.no_ai_call === true) {
    await gate.release()
  }

  const decision = decideFromAi({
    is_invoice: v.is_invoice,
    document_kind: v.document_kind,
    is_paid: v.is_paid,
    // [PEN-MARK] carry the handwritten/stamped payment hints into the routing decision.
    paid_method: v.paid_method ?? null,
    paid_date: v.paid_date ?? null,
    // [BON-BETAALWIJZE] The tender line the till printed, VERBATIM, and the card digits beside it.
    // These two were extracted (ai.ts asks for them by name), typed on IntakeClassification, parsed
    // by gokBetaalwijze and covered by its own tests — and then not passed here, at the only call
    // site there is. So gokBetaalwijze read `undefined` on every upload this app has handled: the
    // paper could never win over the model because the paper never arrived, paidMethodZeker was
    // structurally false, and _intake_paid_evidence / _intake_paid_card4 were written on no row at
    // all. A feature can be built, tested and shipped and still be switched off by two absent lines.
    paid_evidence: v.paid_evidence ?? null,
    paid_card_last4: v.paid_card_last4 ?? null,
    confidence: v.confidence,
    // [HERINNERING-NOOIT] The router sends a reminder to bestanden before the invoice question.
    is_reminder: v.is_reminder ?? null,
  })

  // [KAS-UPLOAD] The Kas screen can upload a receipt the owner ALREADY paid in cash. The button
  // passes paid_method=kas (optionally paid_date) so — when the file is recognised as an invoice
  // or receipt — it lands in the verify queue PRE-MARKED "contant betaald", reusing the exact
  // pen-mark paid flow. Still only a SUGGESTION: the human confirms, and that confirm books the
  // invoice→kasboek cash settlement — NOT a separate cash 'kosten' entry (which would drop the
  // voorbelasting and double-count). A file the AI does not recognise as an invoice is untouched
  // (stays in documents) — we never force-mark an unrecognised file as paid.
  // [BON-BETAALWIJZE] Genormaliseerd naar bank|kas: de UI mag "pin" sturen, maar wat de
  // beslissing in gaat is wat de rest van de app kan lezen — cash-settle zoekt letterlijk op
  // payment_method = 'kas', bank/confirm schrijft 'bank'. Een derde waarde valt tussen wal en schip.
  const forcedMethodRaw = formData.get("paid_method");
  const forcedMethod =
    typeof forcedMethodRaw === "string" ? normaliseerBetaalwijze(forcedMethodRaw) : null;
  if (forcedMethod && (decision.destination === "invoice" || decision.destination === "receipt")) {
    decision.suggestPaid = true;
    decision.paidMethod = forcedMethod;
    // De ondernemer koos dit zelf in de UI — dat is het stevigste bewijs dat er is.
    decision.paidMethodZeker = true;
    const forcedDateRaw = formData.get("paid_date");
    if (typeof forcedDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(forcedDateRaw)) {
      decision.paidDate = forcedDateRaw;
    }
    // else: keep any AI-read date (or null) — the verify modal lets the human pick before confirming.
  }

  // ── [SAFECORE Rule 2] Semantic duplicate gate (invoice/receipt only) ────────
  // Byte-hash (above) only catches the SAME file. This catches the SAME INVOICE
  // arriving as a DIFFERENT file (re-photographed, regenerated PDF, re-upload) —
  // the real double-pay risk. Same graded key as the email path: real number →
  // number+total(+date); placeholder number + reliable vendor → vendor+total+date;
  // otherwise un-dedupable (allowed for human review, never silently blocked).
  // Runs BEFORE storage/insert so a duplicate costs nothing.
  // [DEDUP-SOFT] Carries a POSSIBLE (not confident) duplicate across to the insert, where it is
  // merged into field_confidence so the verify queue shows "mogelijk dubbel met X" and the invoice
  // is held out of auto-confirm. Never blocks — assigned only when NOT a hard duplicate.
  // [DEDUP-READ-HONEST] Did any duplicate probe fail to RUN? supabase-js answers a failed read with
  // { data: null, error }, so `data ?? []` used to turn "we could not look" into "there is no
  // duplicate" — the one answer that lets a second copy of a bill into the books, with its cost and
  // its voorbelasting counted twice. Unlike the bank-attach path (which books straight to 'paid' and
  // therefore refuses outright), these land in the verify queue, so the invoice is flagged instead:
  // needs-review, held out of "Selecteer klaar", with the reason on the card.
  let dedupCheckFailed = false
  let possibleDup: PossibleDuplicate | null = null
  if (decision.destination === "invoice" || decision.destination === "receipt") {
    const dup = await findSemanticDuplicate(
      {
        invoiceNumber: v.invoice_number,
        vendor: v.vendor,
        totalIncBtw: v.total_inc_btw ?? v.amount,
        invoiceDate: v.invoice_date,
      },
      async (q) => {
        let query = supabase
          .from("invoices")
          .select("id, invoice_number, client_name")
          .eq("receiver_id", user.id)
          .eq("direction", "incoming")
          .eq("total_inc_btw", q.total)
        if (q.dateIso) query = query.eq("invoice_date", q.dateIso)
        // [DEDUP-NUMBER-NORM] The candidate set is already pinned by total (+date); for the
        // number tier compare the number WHITESPACE-NORMALIZED in JS, so "26 / 3958" is
        // caught as a duplicate of "26/3958" (an exact .eq missed it → double booking).
        // [DEDUP-WINDOW] Deterministic order + a wide cap so the number match never falls
        // outside the window (dropping the .eq removed the natural bound); 200 far exceeds
        // any realistic count of same-total invoices sharing one date.
        //
        // [DEDUP-RECENCY] Op created_at, niet meer op id. `order("id")` was stabiel maar
        // betekenisloos: invoices.id is een uuid (gen_random_uuid()), dus "aflopend op id" is een
        // willekeurige volgorde die niets met tijd te maken heeft. Twee gevolgen, en het tweede weegt
        // zwaarder dan het eerste:
        //   · pickDedupMatch pakt de EERSTE rij die matcht. Dat is de factuur die de eigenaar in zijn
        //     409 te zien krijgt ("factuur X van Y is al toegevoegd") en waar original_id naar wijst.
        //     Een willekeurige uit meerdere gelijkwaardige kandidaten stuurt hem naar ander papier
        //     dan hij in handen heeft.
        //   · zijn er méér kandidaten dan het venster, dan bepaalt deze volgorde WELKE 200 we
        //     ophalen. Bij uuid-volgorde kan de factuur van vorige week buiten het venster vallen
        //     terwijl er een van drie jaar terug in zit — en dan blokkeert de poort niet.
        //
        // nullsFirst: false is hier geen franje. invoices.created_at is NULLABLE (anders dan
        // documents.created_at, dat NOT NULL is) en Postgres zet NULL bij DESC standaard VOORAAN.
        // Zonder die vlag zouden juist de rijen zonder created_at het venster aanvoeren.
        const { data, error: dedupErr } = await query
          .order("created_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(200)
        // [DEDUP-VENDOR-NORM] Nummer én leverancier worden in code vergeleken, niet in SQL — de
        // leverancier stond hier als `.ilike(client_name, …)` en dat blokkeerde ten onrechte op elke
        // naam met een `*` erin ("SUMUP *CAFE"). Het waarom staat volledig bij pickDedupMatch.
        if (dedupErr) dedupCheckFailed = true
        return pickDedupMatch(data ?? [], q)
      }
    )

    if (dup.duplicate && dup.match && force) {
      // [INTAKE-FORCE] The owner already saw "bestaat al" and chose to add anyway. Record
      // the override so a deliberate double-add is fully traceable, then fall through to
      // storage/insert like a normal invoice.
      await logAuditAction({
        userId: user.id,
        action: "invoice.dedup_override",
        entityType: "invoice",
        entityId: dup.match.id,
        newValue: {
          reason: "user_forced_add",
          matched_on: dup.tier,
          invoice_number: v.invoice_number ?? null,
          total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
          vendor: v.vendor ?? null,
          path: "intake",
        },
        ipAddress: getClientIP(req),
      })
    } else if (dup.duplicate && dup.match) {
      // Block the duplicate before any storage/insert. Truth in the audit log,
      // a clear message to the owner. The original is untouched.
      await logAuditAction({
        userId: user.id,
        action: "invoice.duplicated",
        entityType: "invoice",
        entityId: dup.match.id,
        newValue: {
          reason: "semantic_duplicate_blocked",
          matched_on: dup.tier,
          invoice_number: v.invoice_number ?? null,
          total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
          rejected_vendor: v.vendor ?? null,
          path: "intake",
        },
        ipAddress: getClientIP(req),
      })
      const nr = dup.match.invoice_number ? `factuur ${dup.match.invoice_number}` : "deze factuur"

      // [INTAKE-FOCUS] Resolve the ORIGINAL invoice's file so the client can
      // deep-link + highlight it in Mijn bestanden — the owner's natural
      // question on "bestaat al" is "waar dan?". Same `existing` shape as the
      // byte-hash duplicate above, so BOTH upload surfaces (results modal and
      // IntakeButton) render their "Bekijk in bestanden →" link with zero
      // client changes. Two-step lookup covers both linkage directions
      // (documents.invoice_id → fallback invoices.document_id). Best-effort:
      // a lookup hiccup must never turn a clean 409 into a 500 — on any
      // failure we simply omit `existing` (today's behaviour, no link).
      let existing:
        | { id: string; folder_id: string | null; folder_name: string | null }
        | undefined
      try {
        let doc: { id: string; folder_id: string | null } | null = null
        const { data: byInvoice } = await supabase
          .from("documents")
          .select("id, folder_id")
          .eq("user_id", user.id)
          .eq("invoice_id", dup.match.id)
          // [HERINNERING-NOOIT] A filed reminder also points at this invoice; the link must open
          // the invoice's own file, not the supplier's letter about it.
          .or(`ai_doc_type.is.null,ai_doc_type.neq.${DOC_TYPE_REMINDER}`)
          .limit(1)
          .maybeSingle()
        doc = byInvoice ?? null
        if (!doc) {
          const { data: inv } = await supabase
            .from("invoices")
            .select("document_id")
            .eq("id", dup.match.id)
            .eq("receiver_id", user.id)
            .maybeSingle()
          if (inv?.document_id) {
            const { data: byId } = await supabase
              .from("documents")
              .select("id, folder_id")
              .eq("user_id", user.id)
              .eq("id", inv.document_id)
              .maybeSingle()
            doc = byId ?? null
          }
        }
        if (doc) {
          const path = await buildFolderBreadcrumb(supabase, user.id, doc.folder_id ?? null)
          existing = {
            id: doc.id,
            folder_id: doc.folder_id ?? null,
            folder_name: path.length ? path[path.length - 1] : null,
          }
        }
      } catch {
        // omit `existing` — the link simply doesn't render
      }

      // [DUP-ARCHIVED] Is de gevonden origineel een factuur die de eigenaar zelf genegeerd heeft?
      // Dan wijst "bestaat al" naar een lijst waar hij niet in kijkt. canForce blijft staan — een
      // semantische match kán een andere factuur zijn — maar terugzetten is nu de eerste keuze.
      const archived = await archivedInvoiceById(supabase, user.id, dup.match.id)

      return NextResponse.json(
        {
          error: archived
            ? archivedDuplicateMessage(archived)
            : `Deze factuur bestaat al — ${nr}${dup.match.client_name ? ` van ${dup.match.client_name}` : ""} is al toegevoegd.`,
          duplicate: true,
          original_id: dup.match.id,
          // [INTAKE-FORCE] This is a SEMANTIC match (same invoice, different file) — it can
          // be a false positive, so the client may offer "toch toevoegen" (re-POST force=true).
          // The byte-hash 409 above (exact same file) deliberately omits this flag.
          canForce: true,
          ...(existing ? { existing } : {}),
          ...(archived ? { archived } : {}),
        },
        { status: 409 }
      )
    }

    // ── [INTAKE-CLAIM] The database backstop for the WINDOW the gate above cannot see ─────────
    //
    // findSemanticDuplicate is read-then-insert, and the camera surface uploads three files in
    // parallel: the same paper photographed twice (different bytes, so the byte-hash index is
    // blind) can pass the SELECT in both requests before either has inserted — both land, both
    // can auto-advance, cost and voorbelasting booked twice. The claim closes that window with a
    // UNIQUE (user_id, claim_key) index; the KEY is computed here, by the same one authority
    // (normalizeInvoiceNumber / vendorCoreKey) the gate itself uses — SQL never recomputes it.
    //
    //   · force=true skips the claim: the owner explicitly said "add anyway", and a claim from
    //     the row he is duplicating on purpose would refuse exactly what he just confirmed;
    //   · no usable key (no number, no reliable vendor+total) → no claim. Unidentifiable twice-
    //     uploaded junk is the review queue's problem, not worth refusing real documents over;
    //   · a claim older than two minutes is STALE (its request is long dead) — taken over, not
    //     honoured, so a crash between claim and insert never wedges a supplier's invoices;
    //   · [DEPLOY-SAFE] a missing table (intake_claims.sql not applied yet) degrades to today's
    //     behaviour: no backstop, never a blocked upload.
    if (!force) {
      const claimTotal = v.total_inc_btw ?? v.amount ?? null
      const nrKey = normalizeInvoiceNumber(v.invoice_number ?? "")
      const vdKey = vendorCoreKey(v.vendor ?? "")
      const claimKey =
        nrKey && claimTotal != null
          ? `nr:${nrKey}|${round2(claimTotal)}`
          : vdKey && claimTotal != null
            ? `vd:${vdKey}|${round2(claimTotal)}|${v.invoice_date ?? ""}`
            : null
      if (claimKey) {
        // intake_claims komt uit intake_claims.sql (met de hand toegepast) en staat niet in de
        // gegenereerde typen — zelfde ontspannen client als planForUser, om dezelfde reden.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const claimPipe = createPipelineClient() as any
        const { error: claimErr } = await claimPipe
          .from("intake_claims")
          .insert({ user_id: user.id, claim_key: claimKey })
        if (claimErr && (claimErr as { code?: string }).code === "23505") {
          // Someone holds this claim. Honour it only while it is FRESH.
          const { data: holder } = await claimPipe
            .from("intake_claims")
            .select("id, created_at")
            .eq("user_id", user.id)
            .eq("claim_key", claimKey)
            .maybeSingle()
          const ageMs = holder?.created_at ? Date.now() - Date.parse(holder.created_at) : Infinity
          if (holder && ageMs < 120_000) {
            return NextResponse.json(
              {
                error:
                  "Ditzelfde document wordt op dit moment al verwerkt (een dubbele upload of dubbelklik). Wacht een paar seconden en kijk in je overzicht — staat het er dan niet, probeer het opnieuw.",
                duplicate: true,
                inFlight: true,
              },
              { status: 409 },
            )
          }
          if (holder) {
            // Stale — take it over so a crashed request never wedges this supplier's invoices.
            // [BOUWSEL-GEEN-BELOFTE] try/catch, not `.catch()` — see the sweep below for why the
            // difference is not cosmetic.
            try {
              await claimPipe.from("intake_claims").update({ created_at: new Date().toISOString() }).eq("id", holder.id)
            } catch { /* hygiene: never let taking over a dead claim refuse a real upload */ }
          }
        } else if (claimErr && (claimErr as { code?: string }).code !== "42P01") {
          // Any other failure: log, proceed. The backstop must never refuse real uploads over
          // its own hiccup — the semantic gate above already ran.
          console.error("[INTAKE-CLAIM] claim insert failed (proceeding without backstop)", { error: claimErr.message })
        }
        // Opportunistic hygiene: sweep this user's stale claims so the table stays tiny.
        //
        // [BOUWSEL-GEEN-BELOFTE] This line said `.catch(() => {})` and that was not a safety net —
        // it was the crash. A Supabase query builder is a THENABLE, not a Promise: it implements
        // `then` and nothing else, so `.catch` is `undefined` and calling it throws a TypeError
        // before the query is ever sent. `as any` on claimPipe (needed because intake_claims is
        // not in the generated types) is what let it past the compiler.
        //
        // It sits on the main road: every photographed invoice or receipt that is not a hard
        // duplicate and yields a claim key passes here, BEFORE the document and the invoice are
        // written. So the owner photographed a real invoice, waited through the AI read, and got
        // "de server gaf een onverwacht antwoord (HTTP 500)" with nothing stored — the throw
        // escaped to the platform, which answers HTML, so even the reason was lost on the way out.
        try {
          await claimPipe
            .from("intake_claims")
            .delete()
            .eq("user_id", user.id)
            .lt("created_at", new Date(Date.now() - 3_600_000).toISOString())
        } catch { /* hygiene only — a full table is untidy, a refused invoice is damage */ }
      }
    }
    // tier 'none' (un-dedupable) → allow through; the human reviews in the queue.

    // [DEDUP-SOFT] Not a CONFIDENT duplicate (or none) — is it a POSSIBLE one? (same amount +
    // date, or same amount + vendor a few days apart). Never blocks; it imports flagged for a
    // human glance and held out of auto-confirm. Skipped when a hard duplicate was found/forced.
    if (!(dup.duplicate && dup.match)) {
      possibleDup = await collectPossibleDuplicate(
        {
          invoiceNumber: v.invoice_number,
          vendor: v.vendor,
          totalIncBtw: v.total_inc_btw ?? v.amount,
          invoiceDate: v.invoice_date,
        },
        async (total) => {
          const { data, error: dedupErr } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", user.id)
            .eq("direction", "incoming")
            // A full-cent band (±0.01), not exact float equality: two totals that ROUND to the same
            // cent can differ by just under 0.01 (e.g. incoming 43.004 vs a legacy 42.997 — both
            // "43,00"). A ±0.005 band could drop such a cent-equal row before the cent-precise
            // in-code compare (assessPossibleDuplicate) ever sees it. ±0.01 guarantees it is fetched.
            .gte("total_inc_btw", total - 0.01)
            .lte("total_inc_btw", total + 0.01)
            // [DEDUP-RECENCY] Hier telt de volgorde nóg zwaarder dan bij de harde poort: een bedrag
            // als € 10,00 kan bij een winkel honderden keren voorkomen, dus dit venster loopt echt
            // vol. Op uuid-volgorde haalden we dan 200 willekeurige facturen op en kon de aankomst
            // van vorige week — precies de mogelijke dubbele — er structureel buiten vallen.
            .order("created_at", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .limit(200)
          if (dedupErr) dedupCheckFailed = true
          return data ?? []
        },
        // [DEDUP-CORRECTED] Invoices already held under THIS number, at ANY amount — the
        // corrected re-issue the amount-anchored query above can never return.
        //
        // Deze regel zei "ilike without wildcards is an exact, case-insensitive match". Dat klopt
        // niet: PostgREST vertaalt `*` naar `%` in like/ilike, en escapeLikeValue kan daar niets
        // tegen doen (zie [DEDUP-VENDOR-NORM] hierboven). Anders dan bij de leverancier BLOKKEERT
        // deze query niets — hij levert alleen kandidaten, en assessPossibleDuplicate hernormaliseert
        // voor het iets vlagt. Een `*` maakt de zoekopdracht dus niet fout, maar wél ruimer, en dat
        // is hier het echte risico: de ruis vult het venster en duwt de correctie die we zoeken
        // erbuiten — dan blijft de zachte "mogelijk dubbel"-vlag uit en kan de factuur alsnog
        // automatisch als tweede kostenpost boeken.
        //
        // Daarom blijft de ilike staan (hij levert altijd een SUPERset, hij mist nooit) en gaat het
        // venster van 50 naar 200 — gelijk aan de bedrag-query hierboven, zodat verbreding geen
        // gemiste vlag kan worden.
        async (invoiceNumber) => {
          const { data, error: dedupErr } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", user.id)
            .eq("direction", "incoming")
            .ilike("invoice_number", escapeLikeValue(invoiceNumber))
            // [DEDUP-RECENCY] Zie de bedrag-query hierboven; en juist hier verbreedt een `*` in het
            // nummer de ilike, dus is "de nieuwste eerst" wat voorkomt dat de gezochte correctie
            // door de ruis uit het venster wordt geduwd.
            .order("created_at", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .limit(200)
          if (dedupErr) dedupCheckFailed = true
          return data ?? []
        },
        // [DEDUP-SOFT] Best-effort BY NAME. This invoice lands in the verify queue, and the
        // callbacks above already record a failed read in dedupCheckFailed →
        // markDuplicateCheckUnavailable, so the human still sees "we konden de dubbelcheck niet
        // uitvoeren". Leaving this off would fail the whole import over one soft probe.
        { bestEffort: true },
      )
    }
  }

  // ── [INTAKE-IMG-PDF] Convert image → PDF BEFORE storage ─────────────────────
  // Runs AFTER the AI (the extractor reads the raw photo above) and AFTER dedup
  // (so a duplicate costs no conversion). Wrapping only — full image fidelity,
  // no re-compression. One file per request → peak memory is a single image.
  // Best-effort: a failed conversion returns the original bytes unchanged.
  // [MIME-HONEST] `effectiveType`, niet `file.type`. Een Android-deelmenu of mobiele WebView levert
  // een prima leesbare PDF/JPEG aan met een LEEG of generiek MIME-type; sniffReadableMime heeft dat
  // hierboven al uit de magic bytes afgeleid, en okForAi liet het bestand op grond daarvan door.
  // Daarna viel de route terug op file.type — een waarde waarvan ze zojuist had vastgesteld dat hij
  // niet klopt. maybeImageToPdf sniffed zelf, dus de CONVERSIE ging goed; maar bij passthrough (een
  // PDF, die niets te converteren heeft) gaf hij dat lege type gewoon terug, en dat belandde in
  // storage als contentType en in documents.file_type. Gevolg: een PDF die bij het openen niet als
  // PDF wordt herkend en in plaats van te tonen wordt gedownload. Het onleesbare-pad hierboven deed
  // het al goed (`file.type || "application/octet-stream"`); dit pad liep achter.
  const upload = await maybeImageToPdf(buffer, effectiveType, file.name)
  // Laatste vangnet: okForAi laat ook een bestand door dat alleen op `.pdf` eindigt zonder dat de
  // bytes te sniffen waren. Dan is effectiveType nog steeds "" en is een leeg type nooit beter dan
  // octet-stream — dezelfde keuze als het onleesbare-pad maakt.
  const uploadType = upload.fileType || "application/octet-stream"

  // ── Store the file in Storage (shared by all destinations) ──────────────────
  const safeName = upload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, upload.buffer, { contentType: uploadType, upsert: false })
  // [R1] A swallowed storage failure was the silent-loss bug: the flow continued and
  // wrote a documents/invoice row whose file_url points at a file that was NEVER stored,
  // while telling the owner "opgeslagen" / "factuur herkend". The evidence is then gone
  // but looks present, and the closing package can never find it. Fail loudly instead —
  // the owner retries; a cheap AI re-run beats a phantom document that breaks the aangifte.
  if (uploadError) {
    return NextResponse.json(
      { error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." },
      { status: 502 }
    )
  }
  const pdfUrl = storagePath

  const pipeline = createPipelineClient()

  // ── Destination: document (not an invoice/receipt) → bestanden only ─────────
  if (decision.destination === "document") {
    // [TRUST-INTAKE] Distinguish "confidently NOT a financial doc" from "we couldn't
    // READ it" (an AI outage / unreadable scan returns confidence 0 from the fallback).
    // The old code told the owner "geen factuur of bon herkend" for BOTH — so a real
    // receipt photographed during an outage was silently filed as "overig" and booked
    // nothing behind a confident dismissal. When we couldn't actually read it, we store
    // the file (never lose it) but say so honestly and tell the owner to check/retry —
    // we never assert it isn't an invoice when we simply didn't manage to read it.
    const couldNotRead = !(v.confidence > 0)
    const folderId = await ensureImportedFolder(user.id, "pipeline")
    const { data: doc, error: docErr } = await pipeline
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: upload.fileName,
        file_url: storagePath,
        file_size: upload.buffer.length,
        file_type: uploadType, // [MIME-HONEST] hetzelfde type als waarmee het in storage staat
        doc_type: "overig",
        folder_id: folderId,
        source,
        // Only claim we processed it when we actually read it.
        ai_processed: !couldNotRead,
        // [OBSERVABILITY] En schrijf de REDEN weg, niet de gok. Hier stond
        // `v.document_kind ?? "other"`, óók wanneer couldNotRead waar was — precies de vlag
        // ernaast. Een gefotografeerde bon die niet te lezen was, kwam dus als "other" in
        // bestanden, en /api/email/skipped telt op 'could_not_read'. Het bestand was daarmee
        // nergens geteld en het overgeslagen-paneel meldde "Niets overgeslagen — alles wat
        // binnenkwam is verwerkt". Dat is de zin die een ondernemer laat ophouden met zoeken
        // naar de bon die zijn boekhouder mist.
        ai_doc_type: docTypeForStoredFile(couldNotRead, v.document_kind),
        content_hash: contentHash,
      })
      .select("id")
      .single()
    // [R1] Don't report success on a failed write. Roll back the stored file so it isn't
    // orphaned in Storage (a leaked object with no row), and tell the owner to retry.
    if (docErr || !doc) {
      await supabase.storage.from("documents").remove([storagePath])
      // [23505] De drie zuster-inserts vertalen een verloren race al naar een nette 409 — dit was
      // de enige zonder. Een dubbelklik op uploaden kreeg hier een 500 "probeer opnieuw" over een
      // bestand dat er net wél in kwam, vermomd als opslagfout.
      if ((docErr as { code?: string } | null)?.code === "23505") {
        return NextResponse.json(
          { error: "Dit bestand staat al in je bestanden.", duplicate: true },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: "Opslaan in je bestanden is mislukt — probeer het opnieuw." },
        { status: 500 }
      )
    }
    // [INTAKE-FEEDBACK] resolve the folder name so the client can show "where"
    // and deep-link to it (same breadcrumb helper as the duplicate path).
    const docFolderPath = await buildFolderBreadcrumb(supabase, user.id, folderId)
    const folderName = docFolderPath.length ? docFolderPath[docFolderPath.length - 1] : null

    // ── [STATEMENT-RECONCILE] Een rekeningoverzicht is geen factuur — maar wél het enige
    // stuk dat van BUITEN vertelt wat je zou moeten hebben. Tot nu toe herkenden we het
    // (hierboven: is_statement / de filename- en tekst-guards), zetten het terecht NIET in
    // de boeken, en deden er daarna niets mee. Nu lezen we de regels en vergelijken ze met
    // wat we van deze leverancier hebben, zodat de ene ontbrekende inkoopfactuur — de
    // voorbelasting die de eigenaar anders niet terugvraagt — een naam en een nummer krijgt.
    // Er wordt niets geboekt: de uitkomst is een aanwijzing; de eigenaar haalt de factuur op.
    // Faalt zacht in elke stap: het bestand staat dan gewoon in bestanden, zoals altijd.
    if (doc?.id && isSupplierStatement(v, file.name)) {
      const reconcile = await reconcileSupplierStatement({
        supabase,
        pipeline,
        userId: user.id,
        documentId: doc.id,
        base64,
        mimeType: effectiveType,
        filename: file.name,
        receiverName,
      })
      if (reconcile) {
        return NextResponse.json({
          ok: true,
          destination: "statement",
          document_id: doc.id,
          folder_id: folderId,
          folder_name: folderName,
          ...reconcile,
        })
      }
    }

    // ── [HERINNERING-NOOIT] A payment reminder is never an invoice ───────────────────────────
    // The reader marked it (or the filename did); the router sent it here instead of the queue.
    // The file is kept, the invoice it is about is looked up, and the owner hears the one thing
    // worth hearing — see reminder-original.ts for the rule and the measurement behind it.
    if (doc?.id && v.is_reminder === true) {
      let message = "Dit is een betalingsherinnering, geen factuur. Hij staat in je bestanden en is niet als kost geboekt."
      let originalInvoiceId: string | null = null
      try {
        const filed = await fileReminder({
          pipeline, userId: user.id, documentId: doc.id, path: "intake", ipAddress: getClientIP(req),
          facts: {
            isReminder: true,
            reminderOfInvoiceNumber: v.reminder_of_invoice_number ?? null,
            invoiceNumber: v.invoice_number ?? null,
            vendor: v.vendor ?? null,
            totalIncBtw: v.total_inc_btw ?? v.amount ?? null,
            invoiceDate: normalizeToIso(v.invoice_date ?? null),
          },
        })
        message = filed.message
        originalInvoiceId = filed.placement.original?.id ?? null
      } catch (e) {
        // The file is in bestanden either way; only the link and the notice are missing, and the
        // sentence above says exactly that much and no more.
        console.error("[HERINNERING-NOOIT] filing failed after the document was stored", { documentId: doc.id, error: e instanceof Error ? e.message : String(e) })
      }
      return NextResponse.json({
        ok: true,
        destination: "reminder",
        document_id: doc.id,
        folder_id: folderId,
        folder_name: folderName,
        file_name: upload.fileName,
        original_invoice_id: originalInvoiceId,
        message,
      })
    }

    return NextResponse.json({
      ok: true,
      destination: "document",
      could_not_read: couldNotRead,
      document_id: doc?.id ?? null,
      folder_id: folderId,
      folder_name: folderName,
      // [NAAM-BIJ-BINNENKOMST] The name as STORED, which is not always the name that was uploaded:
      // maybeImageToPdf wraps a photo into a PDF, so `foto.jpg` is filed as `foto.pdf`. The sheet
      // used to print the browser's own File.name, so it named a file that is not the one in
      // Bestanden — an owner going to look for it would search for the wrong thing.
      file_name: upload.fileName,
      message: couldNotRead
        ? "We konden dit document niet lezen. Het staat veilig in je bestanden — controleer het, of upload een duidelijkere foto als het een factuur of bon is."
        : "Opgeslagen in je bestanden (geen factuur of bon herkend).",
    })
  }

  // ── Destination: invoice or receipt → documents + invoices (verify queue) ───
  // [DATE-GATE] Honest date: null when the AI could not read one. Never
  // substitute today — a fabricated date would look confident and land the
  // expense in the wrong quarter. The verify queue forces the human to enter it
  // before confirming (the confirm route blocks a null date).
  // [DATE-ISO-SAFE / I6] Tolerant + never-throw (a DD-MM-YYYY used to 500 intake).
  const invoiceDate = normalizeToIso(v.invoice_date)

  // [DATE-ONE-SOURCE] Resolve the folder from the SAME normalized date the row stores. This read
  // the RAW AI string, and resolveImportTarget does `new Date(...)`: a Dutch "15-03-2026" — which
  // normalizeToIso accepts and turns into 2026-03-15 — is an Invalid Date there, so the file was
  // filed under "Geïmporteerde bestanden" while its invoice sat correctly in maart 2026. The
  // document and the invoice disagreed about the period of the same bill.
  const folderId = await resolveImportTarget(user.id, invoiceDate, "facturen", "pipeline")

  const { data: doc, error: docErr } = await pipeline
    .from("documents")
    .insert({
      user_id: user.id,
      file_name: upload.fileName,
      file_url: storagePath,
      file_size: upload.buffer.length,
      file_type: uploadType, // [MIME-HONEST] hetzelfde type als waarmee het in storage staat
      doc_type: "factuur",
      folder_id: folderId,
      year: invoiceDate ? new Date(invoiceDate).getFullYear() : null,
      source,
      ai_processed: true,
      ai_doc_type: decision.destination === "receipt" ? "receipt" : "invoice",
      content_hash: contentHash,
    })
    .select("id")
    .single()
  // [R1] The document row IS the evidence link for an incoming invoice (the closing
  // package resolves the PDF via invoices.document_id → documents.file_url). If it fails
  // to write, an invoice with document_id=null has unreachable evidence. Stop and roll
  // back the stored file rather than create a half-linked, evidence-less invoice.
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath])
    // [DEDUP-ATOMIC] A concurrent double-submit that raced past the byte-hash SELECT above trips the
    // (user_id, content_hash) UNIQUE index here (23505). Treat it like the SELECT-found duplicate —
    // the other request already stored the document + created its invoice, so returning a duplicate
    // (not a 500) stops a second invoice from being created and double-counting the cost.
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, folder_id").eq("user_id", user.id).eq("content_hash", contentHash).limit(1).maybeSingle()
      const folderPath = dup ? await buildFolderBreadcrumb(supabase, user.id, dup.folder_id ?? null) : []
      const where = folderPath.length ? `Dit bestand staat al in: ${folderPath.join(" / ")}` : "Dit bestand is al toegevoegd"
      return NextResponse.json({
        error: where, duplicate: true,
        existing: dup ? { id: dup.id, folder_id: dup.folder_id ?? null, folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null } : undefined,
      }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Opslaan van de factuur is mislukt — probeer het opnieuw." },
      { status: 500 }
    )
  }
  const documentId = doc.id

  // [SMART-INTAKE] Merge an intake suggestion into field_confidence (same jsonb
  // pattern as _safecore). _intake_suggest='paid' tells the verify queue to
  // surface "Markeer als betaald" prominently. It is a SUGGESTION — the human
  // still confirms. We never write status='paid' here.
  const fieldConfidence: Record<string, unknown> = { ...(v.field_confidence ?? {}) }
  if (decision.destination === "receipt") {
    fieldConfidence._intake_kind = "receipt"
    if (decision.suggestPaid) fieldConfidence._intake_suggest = "paid"
  }
  // [PEN-MARK] A paid suggestion — from a receipt OR an invoice the owner marked paid by
  // hand/stamp — carries HOW and WHEN so the verify queue can pre-fill method + date. Still a
  // SUGGESTION: the human confirms, we never write status='paid' here.
  if (decision.suggestPaid) {
    fieldConfidence._intake_suggest = "paid"
    if (decision.paidMethod) fieldConfidence._intake_paid_method = decision.paidMethod
    if (decision.paidDate) fieldConfidence._intake_paid_date = decision.paidDate
    // [BON-BETAALWIJZE] Het bewijs waarop de gok rust, en de pascijfers. Bewaard zodat een
    // geschil naleesbaar is ("waarom staat hier kas?") en zodat de latere bankmatch de vier
    // cijfers kan gebruiken die ook op het rekeningafschrift staan.
    if (decision.paidEvidence) fieldConfidence._intake_paid_evidence = decision.paidEvidence
    if (decision.paidCardLast4) fieldConfidence._intake_paid_card4 = decision.paidCardLast4
    // Alleen als het PAPIER het zei mag het zonder vraag worden weggeschreven (zie hieronder).
    if (decision.paidMethodZeker) fieldConfidence._intake_paid_method_zeker = true
  }
  // [DEDUP-SOFT] Merge the possible-duplicate signal into _safecore BEFORE the auto-advance check
  // below, so classifyImportHealth reads it → needs-review → the invoice can NEVER auto-book as a
  // second cost. The verify queue then shows "mogelijk dubbel met X".
  // [DEDUP-READ-HONEST] Outside the `if (possibleDup)` guard, and that placement IS the fix.
  //
  // markDuplicateCheckUnavailable exists for exactly one case: the invoices probe FAILED, so no
  // candidate was found. Nesting it inside "a candidate was found" made it provably unwritable —
  // and its own first line returns unchanged when possible_duplicate is already true, so even on
  // the branch it could reach it was a no-op. dedupCheckFailed was computed in three places and
  // then discarded.
  //
  // What that cost: supabase-js does not throw, so a timed-out probe gives `data: null` → `?? []`
  // → no candidate → possibleDup null → no flag → classifyImportHealth says 'clean' →
  // shouldAutoAdvanceInvoice books the invoice as 'received' with no human in the loop. A paper
  // invoice photographed after the same one arrived by e-mail (different bytes, so the hash gate
  // correctly misses) is then a second cost in the books and a second voorbelasting claim, with
  // nothing on any card saying the duplicate check never ran.
  //
  // /api/email/upload:465 has always applied it unconditionally. This is that shape.
  {
    const merged = (dedupCheckFailed
      ? markDuplicateCheckUnavailable(mergePossibleDuplicate(fieldConfidence, possibleDup))
      : mergePossibleDuplicate(fieldConfidence, possibleDup)) as Record<string, unknown> | null
    if (merged?._safecore) fieldConfidence._safecore = merged._safecore
  }
  // [MULTI-INVOICE] Draagt dit ENE bestand meerdere verschillende facturen? Dan is er precies
  // één ingelezen en bestaan de andere nergens — geen rij, geen bestand, geen melding. Ook dit
  // VÓÓR de auto-advance check: de ingelezen factuur kan volmaakt in orde zijn, dus geen enkele
  // andere poort houdt hem tegen, en juist dan zou "automatisch geboekt" de eigenaar wegsturen
  // van het bestand waar zijn andere facturen nog in zitten. Nooit blokkeren — een verzamel-
  // factuur is legitiem — maar wel altijd een mens laten kijken.
  const multiInvoice = decision.destination === "invoice" || decision.destination === "receipt"
    ? detectMultipleInvoices(pdfText)
    : null
  if (multiInvoice) {
    // Via de merger in multi-invoice-pdf.ts, niet met een spread hier: die module bezit de sleutels
    // waaruit dit signaal bestaat, én zij haalt ze weer weg als de eigenaar "nee, dit is één
    // factuur" antwoordt. Twee lijsten die uit elkaar lopen is precies wat dat bestand wil
    // voorkomen — dezelfde afspraak als possible-duplicate-collect.ts.
    fieldConfidence._safecore = (mergeMultipleInvoices(fieldConfidence, multiInvoice) as Record<string, unknown>)._safecore
  }

  // [ONE-INVOICE-UNVERIFIED] …en de keerzijde: KON die controle hierboven wel draaien?
  //
  // detectMultipleInvoices leest de tekstlaag. Een gescande stapel heeft er geen, dus bij precies
  // het geval waarvoor die controle is geschreven — de kop van multi-invoice-pdf.ts noemt de
  // scanner met zoveel woorden — kijkt hij nergens naar en geeft hij null terug. Dat null is tot nu
  // toe gelezen als "alles in orde", en daarmee stond de weg naar automatisch boeken open.
  //
  // Een ontbrekende controle is geen geslaagde controle. Alleen een meerpagina-PDF zonder tekstlaag
  // wacht op een mens; één pagina of een leesbare tekstlaag verandert er niets aan.
  const oneInvoiceUnverified =
    !multiInvoice && (decision.destination === "invoice" || decision.destination === "receipt")
      ? cannotVerifySingleInvoice({ pages: pdfPages, hasTextLayer: !!pdfText })
      : null
  if (oneInvoiceUnverified) {
    // Zelfde reden als hierboven: de sleutels horen bij de module die ze ook weer wist.
    fieldConfidence._safecore = (mergeUnverifiedSingle(fieldConfidence, oneInvoiceUnverified, pdfPages) as Record<string, unknown>)._safecore
  }

  // [IBAN-WISSEL] Kennen we deze leverancier al onder een ander rekeningnummer? Ook hier VÓÓR de
  // auto-advance check: een gewisseld IBAN maakt de health needs-review, en daarmee kan deze
  // factuur nooit automatisch als kosten geboekt worden — precies wat je bij fraude wilt. Een
  // doorgestuurde vervalste factuur komt net zo goed via dit pad binnen als via de mailsync.
  //
  // [CREDIT-WOORD] Staat het woord in de KOP van het papier? Dit is de enige creditcontrole die
  // noch het model noch het nummer nodig heeft, en precies de twee die faalden op CR0301267: het
  // model gaf is_credit_note=false, en een leverancier die zijn creditnota's in de gewone reeks
  // nummert laat ook de prefixpoort niets zien. De kop stond er wél op.
  //
  // Alleen vlaggen, nooit een bedrag omdraaien — classifyImportHealth maakt er needs-review van en
  // de eigenaar beslist. En alleen als de lezing er géén creditnota van maakte: anders zou het
  // document een vraag stellen die het zelf al heeft beantwoord.
  if (v.is_credit_note !== true && creditWordInHeader(pdfText)) {
    fieldConfidence._safecore = mergeSafecore(fieldConfidence, { credit_word_in_header: true })
  }

  // [LEVERANCIER-INTAKE] Eén stap voor allebei: de IBAN-controle EN de leverancier, in die
  // volgorde. Gemeten in productie: dit pad schreef wel vendor_iban op de factuur maar liet
  // supplier_id leeg, terwijl de e-mailwegen dat wel invulden — de leverancier van een factuur
  // hing dus af van de deur waardoor hij binnenkwam. De volgorde staat in intake-supplier.ts en
  // mag niet om: het oplossen kan een rij aanmaken op precies het nummer dat we hier verdacht
  // vinden, en dan beantwoordt de controle zichzelf.
  const leverancier = await resolveSupplierAtIntake(pipeline, user.id, {
    name: v.vendor,
    kvk: v.vendor_kvk ?? null,
    iban: v.vendor_iban ?? null,
    btw: v.vendor_btw ?? null,
  })
  // Alleen schrijven als er iets te melden is: een leeg _safecore zetten waar er geen stond, maakt
  // van "niets aan de hand" een waarheidswaarde die elders truthy is.
  if (Object.keys(leverancier.safecore).length > 0) {
    fieldConfidence._safecore = mergeSafecore(fieldConfidence, leverancier.safecore)
  }

  // [BON-AUTO] Mag deze bon zichzelf afboeken? Een kassabon bestáát omdat er aan de kassa is
  // betaald — dat is wat hem een bon maakt en geen factuur. De vraag die de soort NIET beantwoordt
  // is HOE, en dat verschil is niet cosmetisch: 'kas' zet een gedateerde regel in het kasboek en
  // beweegt de lade, 'bank' niet. Dus alleen wanneer het PAPIER de tenderregel afdrukt. Zie
  // receipt-auto-settle.ts; hier wordt niets geboekt, alleen besloten.
  const settlePlan = planReceiptSettlement({
    documentKind: v.document_kind ?? null,
    suggestion: {
      suggestPaid: decision.suggestPaid,
      paidMethod: decision.paidMethod ?? null,
      paidMethodZeker: decision.paidMethodZeker === true,
      paidDate: decision.paidDate ?? null,
    },
    invoiceDate,
    totalIncBtw: v.total_inc_btw ?? null,
    // [TZ] paymentDateOutOfWindow's parameter is named `todayAmsterdam`, and it was handed a UTC
    // date. Today the day of slack it allows (it accepts up to today+1) absorbs the difference, so
    // nothing misbehaves — this is a broken contract rather than a live defect, and it is fixed
    // because the slack is what is hiding it, not a reason it is safe.
    today: amsterdamToday(),
  });

  // [AUTO-ADVANCE] A confident, clean, ORDINARY invoice may skip the manual verify tap and land
  // directly as 'received' (booked, UNPAID, reversible). Never for a pen-mark paid suggestion,
  // never for a statement/reminder/creditnota/low-confidence read. The decision reads the REAL AI
  // number (v.invoice_number) — not the CAMERA- fallback — so a numberless invoice stays in the
  // queue.
  //
  // [BON-AUTO] The paid-suggestion block stays, with one hole in it: a bon that will be SETTLED in
  // the same request. The block exists because auto-advance lands an invoice as 'received' —
  // booked and UNPAID — which is the one status a settled bon must never get. When the payment is
  // booked one breath later that objection is gone, and without the hole every receipt fell to a
  // manual tap: the document class that needs the least judgement got the most of it.
  //
  // The safety bar itself is UNCHANGED. A bon still has to clear grounding, placement, the printed
  // BTW split, the arithmetic, the dedup and the health classifier exactly like any other invoice —
  // settling only decides the STATUS it lands in, never whether the read may be trusted.
  // [ZELF-EERST] Asked FIRST, because it is not a quality signal but a permission: the owner who
  // says "show me everything" gets everything, including the reads that would have cleared every
  // bar. One flag covers both landings — the invoice that would book as 'received' and the bon
  // that would settle as paid — since both are the app acting without a tap.
  const magAutoBoeken = await autoBoekenAllowed(supabase, user.id)
  // [NUL-GRONDSLAG] What may be STORED, decided once. `?? 0` here made an amount that was never
  // read indistinguishable from a real zero, and a zero base on a purchase invoice is a claim that
  // the bill cost nothing — the engine reads kosten off that field. One rule, one place, so the
  // health verdict below and the row itself can never disagree about the same invoice.
  const storedAmounts = amountsToStore({
    totalExBtw: v.total_ex_btw, btwAmount: v.btw_amount, totalIncBtw: v.total_inc_btw, amount: v.amount,
  });
  // [NUL-GRONDSLAG] …and the fallback's zero BTW says so. Mutated on the object the insert below
  // already carries, so there is one field_confidence for this row and not two.
  Object.assign(fieldConfidence, markUnexplainedZeroBtw({}, storedAmounts, {
    btwRate: v.btw_rate, shifted: (v.field_confidence as { _btw_verlegd?: unknown } | null)?._btw_verlegd != null,
  }));
  const autoAdv = !magAutoBoeken
    ? // Its own reason string, ahead of every quality check: "waiting because you asked to see
      // everything" must never read as "the read was weak" — the audit row and the queue both
      // show this reason, and an owner testing the app deserves to see their own switch working.
      { advance: false as const, reason: "owner_reviews_everything" }
    : (decision.destination === "invoice" || (decision.destination === "receipt" && settlePlan.settle)) &&
    (!decision.suggestPaid || settlePlan.settle) && !multiInvoice && !oneInvoiceUnverified
      ? shouldAutoAdvanceInvoice({
          is_invoice: v.is_invoice,
          is_statement: v.is_statement,
          is_reminder: v.is_reminder,
          is_credit_note: v.is_credit_note,
          document_kind: v.document_kind ?? null,
          invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
          // [AANSLAG] The stored kind or the sender's name — either holds the row for the owner.
          tax_kind: effectiveTaxKind({ tax_kind: v.tax_kind, client_name: leverancier.supplierName || v.vendor }),
          confidence: v.confidence,
          // Raw gross only (no amount-fallback), and never auto-book a forced-through duplicate.
          totalIncBtw: v.total_inc_btw ?? null,
          forcedDuplicate: force === true,
          // [BTW-GATE] a zero btw_amount only auto-books when the read is explicitly a 0% invoice.
          btwRate: v.btw_rate ?? null,
          // [GEGROND] What the document's own text says about the total the reader reported. The
          // only signal here that does not come from the reader — see amount-grounding.ts.
          totalGrounding: groundingOf(v.field_confidence),
          // [GEGROND-STAAT-IN] En of het document zijn eigen drie bedragen letterlijk draagt. Dit
          // vervangt één ontbrekend signaal — de zelfscore van het model op het bedrag — en niets
          // anders; zie moneyGroundedInText() in amount-grounding.ts.
          moneyGroundedInText: moneyGroundedInText(v.field_confidence),
// [DOCCHECK] And WHERE that total sits — the check that tells a real total from a subtotal.
totalPlacement: placementOf(v.field_confidence),
// [DOCCHECK-SPLIT] And whether the paper prints a DIFFERENT btw split than the one read.
btwContradictsDocument: btwContradictionOf(v.field_confidence),
// [E-FACTUUR] And whether the supplier's OWN structured figures disagree with the read. Both
// auto-booking doors must ask it: a gate on one door is not a gate.
eInvoiceContradicts: eInvoiceContradictsRead(v.field_confidence),
          health: {
            // [NUL-GRONDSLAG] The health verdict must be about the figures that will be STORED,
            // or the queue judges one row and the books carry another.
            total_ex_btw: storedAmounts.total_ex_btw,
            btw_amount: storedAmounts.btw_amount,
            total_inc_btw: storedAmounts.total_inc_btw,
            invoice_date: invoiceDate,
            invoice_number: v.invoice_number ?? null,
            invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
            field_confidence: fieldConfidence,
          },
        })
      : { advance: false, reason: multiInvoice ? "multiple_invoices_in_file" : "not_eligible" };
  // [OVERALL-BEWAARD] De overall zekerheid van de lezer, op de rij — bij ELKE inkomende factuur,
  // niet alleen bij een weigering. Hij bestond tot nu toe alleen in het geheugen tijdens de import:
  // gate-yield.ts zegt in zijn slotalinea letterlijk dat twee poorten daardoor niet te beoordelen
  // zijn, en precies die twee zijn de overgebleven verdachten bij een factuur die verder alles goed
  // heeft — 0,95 tot 1,00 op elk veld, sluitende optelling, geen enkele vlag, en tóch vastgehouden.
  // Eén getal opslaan maakt de duurste onbeantwoordbare vraag in dit product beantwoordbaar.
  fieldConfidence._auto_confidence = typeof v.confidence === "number" ? v.confidence : null;
  if (autoAdv.advance) {
    fieldConfidence._auto_verified = { at: new Date().toISOString(), reason: autoAdv.reason };
  } else {
    // [WAAROM-VASTGEHOUDEN] En de andere tak, die er niet was.
    //
    // Gemeten op één echte administratie over een jaar: van de 590 inkomende documenten hadden er
    // 350 een mensenhand nodig, en 296 daarvan droegen GEEN enkele vlag die verklaarde waarom. Niet
    // omdat de app het niet wist — beslisAutoAdvance rekent voor élke weigering een precieze reden
    // uit, zeventien stuks, en het type noemt dat veld zelf "machine tag for audit/telemetry".
    //
    // Alleen werd hij uitsluitend op de GESLAAGDE tak opgeschreven. Bij een weigering werd hij
    // berekend en weggegooid — precies op het moment dat de app besluit de eigenaar een minuut te
    // kosten. De duurste vraag in dit product ("waarom kost dit mij tijd?") was daarmee wél
    // beantwoordbaar door de code en niet beantwoordbaar uit de data.
    //
    // Dit verandert niets aan wat er gebeurt. Het schrijft alleen op wat er gebeurde, zodat de
    // volgende verbetering op een meting rust in plaats van op een vermoeden.
    fieldConfidence._auto_hold = { at: new Date().toISOString(), reason: autoAdv.reason };
  }
  // [BON-AUTO] Both halves must hold: the READ is trustworthy (autoAdv) and the PAYMENT is proven
  // by the paper (settlePlan). Either one alone books something nobody checked.
  const willSettle = autoAdv.advance && settlePlan.settle;
  if (willSettle) {
    // The basis, on the row, in the paper's own words — so "waarom staat deze bon op betaald?" is
    // answerable a year later without re-reading the document.
    fieldConfidence._auto_paid = {
      at: new Date().toISOString(),
      method: settlePlan.method,
      date: settlePlan.payDate,
      reason: settlePlan.reason,
      evidence: decision.paidEvidence ?? null,
    };
  }

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      // [AUTO-ADVANCE] clean+confident → 'received' (booked, unpaid, reversible); else the queue.
      status: autoAdv.advance ? "received" : "processing",
      source,
      // [LEVERANCIER-INTAKE] De leverancier zoals de registratie hem kent, met de gelezen naam als
      // terugval — dezelfde regel als op de e-mailwegen, zodat één bedrijf één rij blijft.
      supplier_id: leverancier.supplierId,
      client_name: leverancier.supplierName || v.vendor || "Onbekende afzender",
      // [BTW-NUMMER-BEWAARD] Op een inkoopfactuur is client_btw_number het nummer van de
      // LEVERANCIER — dezelfde rij draagt zijn naam in client_name. Het werd gelezen en nergens
      // opgeslagen, waardoor de EU-inkopenlijst (icp.ts, rubriek 4b) voor iedereen leeg bleef.
      // Alleen een geldige VORM landt hier; een misvormd nummer blijft staan in
      // _vendor_btw_printed, waar de controlelijst de ondernemer erover vertelt.
      client_btw_number: supplierBtwForInvoice(fieldConfidence._vendor_btw_printed as string | undefined, v.vendor_btw ?? null),
      invoice_date: invoiceDate,
      // [EXTRACT-DUE-DATE] explicit due date → invoice_date + term → null. The
      // backbone of the "Vandaag" screen; null is honest when nothing is stated.
      due_date: deriveDueDate(invoiceDate, v.due_date ?? null, v.payment_term_days ?? null),
      // [BON-NUMMER] Leeg blijft leeg. Vroeger stond hier `|| \`CAMERA-${Date.now()}\`` — een
      // VERZONNEN documentkenmerk, en dat is erger dan een leeg veld: snelstart-mapping weigert
      // een LEEG nummer aan de grens (MISSING_NUMBER), maar "CAMERA-1784373782895" glipt erdoor
      // en landt als factuurnummer op een inkoopboeking in het wettelijke inkoopboek van de
      // boekhouder — een kenmerk dat op geen enkel papier terug te vinden is. De audit-regels
      // van deze zelfde upload noteerden intussen invoice_number: null, dus het spoor en het
      // record spraken elkaar tegen over de identiteit van hetzelfde document.
      invoice_number: v.invoice_number?.trim() || null,
      // [BRIDGE-CREDITNOTA-SIGN] mark the type; amounts stay NEGATIVE as
      // extracted for a creditnota (one sign convention with [BOEK-031]).
      // The read-time health classifier (import-health) applies the
      // sign-inverted gate for this row via invoice_type.
      invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
      // [AANSLAG] Which tax a Belastingdienst letter concerns; null on an ordinary invoice.
      tax_kind: v.tax_kind ?? null,
      // [NUL-GRONDSLAG] The base was `?? 0`, which stored an amount that was NOT READ as a real
      // zero — and a zero base on a purchase invoice is a claim that the bill cost nothing. The
      // engine books kosten from this field. amountsToStore keeps a read split exactly as read and,
      // when there was none, falls back to the gross as net with no BTW claimed — the same
      // conservative rule the bank-attach door already used, so the cost is counted rather than
      // dropped and nothing is deducted off a document we could not read.
      total_ex_btw: storedAmounts.total_ex_btw,
      btw_amount: storedAmounts.btw_amount,
      total_inc_btw: storedAmounts.total_inc_btw,
      pdf_url: pdfUrl,
      document_id: documentId,
      vendor_iban: v.vendor_iban ?? null,
      payment_reference: v.payment_reference ?? null,
      // [BON-BETAALWIJZE] HOE er is betaald — de eerste vraag van de boekhouder over een bon, en
      // de enige die hij niet zelf kan afleiden: een contante aankoop laat geen bankregel na.
      // Het antwoord staat op het papier ("Bankpas", "Kontant", "Wisselgeld") en werd tot nu toe
      // gelezen, in field_confidence gezet — een jsonb die geen enkele voorwaarde in de app leest
      // — en vervolgens vergeten, terwijl deze kolom leeg bleef.
      //
      // Alleen wegschrijven als het PAPIER het zei (paidMethodZeker). Zei het niets, dan blijft
      // dit null en vraagt het scherm het: gok slim, vraag alleen als we het niet weten.
      //
      // Dit beweert GEEN betaling — status blijft 'processing'. Elke lezer van deze kolom
      // (cash-settle, bank/unlink, bank/delete-statement, cron/reconcile) filtert óók op
      // status='paid', dus deze rij is voor allemaal onzichtbaar tot de mens bevestigt.
      payment_method: decision.paidMethodZeker ? (decision.paidMethod ?? null) : null,
      // Cast to the jsonb column type (Json | null) — sanitized, JSON-compatible
      // content. Same pattern as email-integration.ts / audit.ts.
      field_confidence: fieldConfidence as InvoiceFieldConfidence,
    })
    .select("id")
    .single()

  if (dbError) {
    // [R1] Roll back the document row + stored file we just created. Otherwise a
    // documents row with no invoice is orphaned — and worse, its content_hash would
    // make the byte-hash dedup BLOCK a re-upload (409), trapping the owner with a file
    // they can neither re-add nor see as an invoice. Best-effort; then surface the error.
    await pipeline.from("documents").delete().eq("id", documentId)
    await supabase.storage.from("documents").remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  if (invoice?.id) {
    await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId)
  }

  // [AUTO-ADVANCE] Side-effects of a clean auto-verify — mirror the confirm route, best-effort:
  // audit the automatic booking (legal trail), settle any cash link + book a bank line that
  // already paid it, and tell the owner what the app did (so the double-check stays available).
  if (autoAdv.advance && invoice?.id) {
    await logAuditAction({
      userId: user.id,
      action: "invoice.auto_verified",
      entityType: "invoice",
      entityId: invoice.id,
      oldValue: { status: "processing" },
      newValue: { status: "received", reason: autoAdv.reason, source: "intake_auto_advance" },
      ipAddress: getClientIP(req),
    }).catch(() => {})

    // [BON-AUTO] The bon pays itself off. Through apply_manual_payment — the SAME audited, atomic,
    // row-locking call the manual "Markeer als betaald" button makes — and not by writing
    // status='paid' onto the insert above. That shortcut looks equivalent and is not: the RPC also
    // writes the bank_tx_invoices instalment row that keeps amount_paid = SUM(amount_applied)
    // true, and without it recompute_invoice_amount_paid would reset amount_paid to zero on an
    // invoice that says it is paid. Reusing the ordinary booking also means the ordinary UNDO
    // button reverses it, with no second code path to keep in step.
    //
    // Deliberately AFTER the insert rather than part of it: if this call fails the bon stands as
    // 'received' — booked, unpaid, one tap from correct — which is exactly where it stood before
    // this feature existed. The failure direction is the old behaviour, never a half-booking.
    let settled = false;
    if (willSettle && settlePlan.method && settlePlan.payDate) {
      const { error: settleErr } = await pipeline.rpc("apply_manual_payment", {
        p_user_id: user.id,
        p_invoice_id: invoice.id,
        p_amount: null,                     // null = the whole remaining balance
        p_pay_date: settlePlan.payDate,
        p_method: settlePlan.method,
        p_payable_statuses: ["received"],   // it was just inserted as 'received'
        p_client_key: randomUUID(),
      });
      if (settleErr) {
        // [NO-SILENT-EMPTY] Never swallowed. The invoice is correct either way, but an owner who
        // was told "automatisch afgehandeld" and finds it in "nog te betalen" needs the trail to
        // say which half ran.
        console.error("[BON-AUTO] receipt settlement failed — left as received (unpaid)", {
          invoiceId: invoice.id, error: settleErr.message,
        });
      } else {
        settled = true;
        await logAuditAction({
          userId: user.id,
          action: "invoice.auto_paid",
          entityType: "invoice",
          entityId: invoice.id,
          oldValue: { status: "received" },
          newValue: {
            status: "paid", method: settlePlan.method, payment_date: settlePlan.payDate,
            reason: settlePlan.reason, evidence: decision.paidEvidence ?? null,
            source: "intake_receipt_auto_settle",
          },
          ipAddress: getClientIP(req),
        }).catch(() => {});
      }
    }
    // Runs AFTER the settlement above on purpose: a 'kas' booking becomes a dated kasboek entry,
    // and reconciling before it exists would leave the drawer a pass behind.
    // [CASH-RETRY] Through the shared retry: this is the door the Kas screen's own upload uses
    // (paid_method=kas), so a bailed pass means the owner photographed a paid bon and the drawer
    // never moved. reconcileCashWithRetry never throws, so the try//catch around it is gone with it.
    await reconcileCashWithRetry(pipeline, user.id)
    try { await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: user.id }) } catch { /* non-fatal */ }
    await createNotification({
      userId: user.id,
      // [BON-AUTO] A settled bon may NOT borrow the invoice sentence. "(nog niet betaald)" on a
      // receipt the app has just marked paid is the app contradicting itself in the one message
      // the owner actually reads, and it would send them looking for a payment to make.
      title: settled ? "Bon automatisch verwerkt en afgeboekt" : "Factuur automatisch verwerkt",
      // .replace with a STRING replaces the first match only; a missing number left a second
      // double space untouched. A regex with /g collapses every run of spaces.
      // [BON-BETAALWIJZE] De zin komt uit receipt-auto-settle.ts, naast de regel die besloot dat
      // deze bon al was afgerekend. Hij stond hier ook uitgeschreven, en zwakker: hij noemde onze
      // CONCLUSIE ("contant geboekt") en niet het WOORD OP HET PAPIER. "Wij dachten dat het contant
      // was" is een mening die de eigenaar niet kan nakijken; `op de bon staat "Wisselgeld"` is een
      // bewering die hij met één blik op de bon afdoet — en dat is het verschil tussen een melding
      // en een geruststelling. Het bewijs lag hier al klaar (decision.paidEvidence, twee regels
      // verderop gebruikt) en reisde alleen nooit mee naar de tekst.
      body: (settled
        ? `${v.vendor || "Een leverancier"} — ${settleNoticeText(settlePlan, decision.paidEvidence ?? null) ?? ""}`
        : `${v.vendor || "Een leverancier"} — factuur ${v.invoice_number ?? ""} is automatisch geverifieerd en geboekt als inkoopfactuur (nog niet betaald). Controleer indien nodig.`
      ).replace(/ {2,}/g, " "),
      type: "invoice",
      // [AUTO-ADVANCE-HONESTY] Deep-link like every other notification
      // ([BRIDGE-NOTIF]). Without it this was the one bell in the app you could
      // tap for nothing: it announces a booking and then leaves the owner to find
      // the invoice by hand — on a surface the notification never names.
      link: `/dashboard/incoming/manage?focus=${invoice.id}`,
    })
  }

  // [INTAKE-AUTO-FEEDBACK] Where the FILE itself was filed. The document path already
  // echoed folder_id/folder_name so the upload modal could say "opgeslagen in …"; the
  // invoice path never did, so an invoice — the one thing the owner most wants to be
  // able to find back — landed without a location. Same breadcrumb helper, best-effort:
  // a failure here must never affect the (already committed) invoice.
  const invoiceFolderPath = await buildFolderBreadcrumb(supabase, user.id, folderId).catch(() => [])

  return NextResponse.json({
    ok: true,
    destination: decision.destination, // 'invoice' | 'receipt'
    invoice_id: invoice?.id,
    suggest_paid: decision.suggestPaid,
    auto_verified: autoAdv.advance,
    folder_id: folderId,
    folder_name: invoiceFolderPath.length ? invoiceFolderPath[invoiceFolderPath.length - 1] : null,
    // [UPLOAD-HUB] Echo the key extracted fields so the upload page can show WHAT each file is
    // (leverancier · bedrag · nummer) at a glance — the owner verifies without opening every file.
    vendor: v.vendor ?? null,
    invoice_number: v.invoice_number ?? null,
    total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
    // [DEDUP-SOFT] A soft, non-blocking heads-up so the intake UI can flag "mogelijk dubbel".
    ...(possibleDup
      ? { possibleDuplicate: { invoice_number: possibleDup.match.invoice_number, client_name: possibleDup.match.client_name, reason: possibleDup.reason } }
      : {}),
    // [MULTI-INVOICE] The numbers we saw but did NOT book, so the owner knows exactly what is
    // still missing instead of only that "something" is.
    ...(multiInvoice ? { multipleInvoices: { numbers: multiInvoice.numbers } } : {}),
    message:
      // The most consequential thing we can say about this upload comes first: an invoice that
      // landed is recoverable, invoices that never landed are not.
      multiInvoice
        ? `Let op — ${multiInvoice.numbers.length} facturen in één bestand. We hebben er ÉÉN ingelezen; voeg de andere los toe (${multiInvoice.numbers.slice(0, 3).join(", ")}${multiInvoice.numbers.length > 3 ? ", …" : ""}).`
        : decision.destination === "receipt"
        ? "Bon herkend — controleer en bevestig (waarschijnlijk al betaald)."
        : possibleDup
          ? `Factuur herkend — let op: mogelijk dubbel${possibleDup.match.invoice_number ? ` met ${possibleDup.match.invoice_number}` : ""} (${possibleDup.reason}). Controleer voor je bevestigt.`
          : autoAdv.advance
            // [INTAKE-AUTO-FEEDBACK] Name the DESTINATION, not just the fact. "Automatisch
            // verwerkt" alone left the owner looking for the invoice in the verify queue,
            // where an auto-advanced invoice never appears — it is booked (unpaid) on
            // Inkoopfacturen. Saying so, plus "nog niet betaald", is what makes the
            // automatic step checkable instead of merely fast.
            ? "Herkend, gecontroleerd en geboekt als inkoopfactuur — klaar voor de boekhouder (nog niet betaald)."
            : "Factuur herkend — controleer en bevestig.",
  })
}

// ── Shared helpers for the sheet/daily-report booking paths ──────────────────────────────────
// Pull a PDF's text layer. Fail-safe by design: ANY trouble returns null, and every caller
// treats null as "no signal" — a text-extraction problem must never block or alter an import.
// [ONE-INVOICE-UNVERIFIED] Geeft nu ook het AANTAL PAGINA'S terug, uit dezelfde geopende PDF. Dat
// getal is het verschil tussen "één beeld, dus één factuur" en "een stapel die we niet konden
// lezen" — zie cannotVerifySingleInvoice. `pages: 0` bij een onleesbaar of niet-PDF bestand, wat
// daar als "geen meerpagina-bestand" telt.
// Dedup + store the raw incoming file in bestanden (best-effort); returns the documentId, or null
// if it is a fresh file whose store failed. Skips storage when this exact file (byte-hash) already
// exists, so a corrected re-upload never piles up document rows. Rolls back the storage blob if the
// documents row fails, so a failed store never leaks an orphan.
// ── [UBL-INTAKE] UBL / Peppol XML e-invoice handler ─────────────────────────────────────────
// Parses the standard UBL leaf elements and creates a verify-queue invoice (status 'processing')
// so an e-invoice's BTW/voorbelasting flows into Crediteuren + the aangifte like a PDF invoice,
// instead of being filed as an opaque 'unsupported_type' document. Returns a NextResponse on
// success, or null when nothing usable could be extracted (caller then falls to the document store).
async function handleUblInvoice(
  xmlText: string,
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  force: boolean,
  req: NextRequest,
): Promise<NextResponse | null> {
  const { parseUblInvoice } = await import("@/lib/ubl-invoice")
  const v = parseUblInvoice(xmlText)
  // Need at least a number OR a gross total to be worth booking as an invoice; else it's not a
  // recognisable e-invoice → let the safe document store keep it.
  if (!v.invoiceNumber && v.totalIncBtw == null) return null

  // [EURO-ALLEEN] The same refusal the OTHER door onto these bytes already made.
  //
  // A Peppol invoice attached to a PDF goes through parseEInvoice, whose complete() has refused a
  // stated non-euro currency for as long as it has existed — "silently treating 1 200 SEK as
  // EUR 1 200 is the kind of error that survives every other check in the building". The identical
  // invoice uploaded as a standalone .xml comes here instead, and this reader extracted
  // DocumentCurrencyCode into v.currency and then never looked at it. Measured on one file through
  // both doors: USD 10.000 refused there, booked as EUR 10.000 here — with its voorbelasting
  // claimed in rubriek 5b at a euro amount nobody ever paid.
  //
  // Returning null is not discarding it: the caller falls through to the document store, so the
  // file is kept, findable and safe — it is simply not booked as an invoice whose amounts this app
  // cannot honour. That is exactly what the other door does with the same bytes.
  const { isEuroDocument } = await import("@/lib/e-invoice")
  if (!isEuroDocument(v.currency)) return null

  const hash = computeContentHash(buffer)
  // Byte-hash dedup (same file re-uploaded) — surface the existing one instead of a second row.
  // [FORCE-INVARIANT] NEVER forceable: the exact same bytes can't be added twice, matching the
  // camera path's byte-hash gate (route contract lines 92-96). "toch toevoegen" only overrides the
  // SEMANTIC gate below — the old `&& !force` here let a re-upload of the identical XML double-book.
  const { data: dupDoc } = await supabase
    .from("documents").select("id, folder_id, invoice_id, trashed")
    .eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
  // [DUP-TRASHED] Zelfde uitzondering als de camera-route: een weggegooide e-factuur mag de sleutel
  // niet levenslang bezet houden, anders kan de eigenaar zijn eigen XML nooit opnieuw importeren.
  if (dupDoc && !(await trashedDuplicateCleared(supabase, userId, dupDoc))) {
    // [DUP-SHAPE] Carry folder_name like the other duplicate 409s, so the client can say WHERE
    // the e-invoice already is instead of only that it exists.
    const dupPath = await buildFolderBreadcrumb(supabase, userId, dupDoc.folder_id ?? null)
    return NextResponse.json({
      duplicate: true, destination: dupDoc.invoice_id ? "invoice" : "document",
      error: "Deze e-factuur is al geïmporteerd.",
      existing: {
        id: dupDoc.id,
        folder_id: dupDoc.folder_id ?? null,
        folder_name: dupPath.length ? dupPath[dupPath.length - 1] : null,
      },
    }, { status: 409 })
  }

  // For a creditnota the extracted totals are positive in UBL; store them NEGATIVE to match the
  // app's one-sign convention ([BOEK-031] / camera path). Compute the SIGNED gross first so the
  // dedup gate below matches against the same signed value the invoices table stores.
  const sign = v.isCreditNote ? -1 : 1
  const totalExBtw = v.totalExBtw != null ? sign * Math.abs(v.totalExBtw) : 0
  const btwAmount = v.btwAmount != null ? sign * Math.abs(v.btwAmount) : 0
  const totalIncBtw = v.totalIncBtw != null ? sign * Math.abs(v.totalIncBtw) : null

  // ── [SAFECORE Rule 2] Semantic duplicate gate — the SAME graded logic the camera/PDF path uses,
  //    which the UBL path was missing entirely. Without it, a supplier's PDF + their Peppol XML for
  //    ONE bill (different bytes, so byte-hash misses) both booked → voorbelasting counted twice,
  //    unflagged. Runs BEFORE any storage/insert so a duplicate costs nothing. ──
  // [DEDUP-READ-HONEST] Did any duplicate probe fail to RUN? supabase-js answers a failed read with
  // { data: null, error }, so `data ?? []` used to turn "we could not look" into "there is no
  // duplicate" — the one answer that lets a second copy of a bill into the books, with its cost and
  // its voorbelasting counted twice. Unlike the bank-attach path (which books straight to 'paid' and
  // therefore refuses outright), these land in the verify queue, so the invoice is flagged instead:
  // needs-review, held out of "Selecteer klaar", with the reason on the card.
  let dedupCheckFailed = false
  let possibleDup: PossibleDuplicate | null = null
  if (totalIncBtw != null) {
    const dup = await findSemanticDuplicate(
      { invoiceNumber: v.invoiceNumber, vendor: v.supplierName, totalIncBtw, invoiceDate: v.invoiceDate },
      async (q) => {
        let query = supabase
          .from("invoices")
          .select("id, invoice_number, client_name")
          .eq("receiver_id", userId)
          .eq("direction", "incoming")
          .eq("total_inc_btw", q.total)
        if (q.dateIso) query = query.eq("invoice_date", q.dateIso)
        // [DEDUP-RECENCY] Nieuwste eerst, met NULL achteraan — zie de camera-route voor het waarom.
        const { data, error: dedupErr } = await query
          .order("created_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(200)
        // [DEDUP-VENDOR-NORM] Dezelfde gedeelde vergelijking als de camera-route; zie pickDedupMatch.
        if (dedupErr) dedupCheckFailed = true
        return pickDedupMatch(data ?? [], q)
      },
    )

    if (dup.duplicate && dup.match && force) {
      // Owner already saw "bestaat al" and chose to add anyway — record the deliberate override.
      await logAuditAction({
        userId, action: "invoice.dedup_override", entityType: "invoice", entityId: dup.match.id,
        newValue: { reason: "user_forced_add", matched_on: dup.tier, invoice_number: v.invoiceNumber ?? null, total_inc_btw: totalIncBtw, vendor: v.supplierName ?? null, path: "intake_ubl" },
        ipAddress: getClientIP(req),
      }).catch(() => {})
    } else if (dup.duplicate && dup.match) {
      await logAuditAction({
        userId, action: "invoice.duplicated", entityType: "invoice", entityId: dup.match.id,
        newValue: { reason: "semantic_duplicate_blocked", matched_on: dup.tier, invoice_number: v.invoiceNumber ?? null, total_inc_btw: totalIncBtw, rejected_vendor: v.supplierName ?? null, path: "intake_ubl" },
        ipAddress: getClientIP(req),
      }).catch(() => {})
      const nr = dup.match.invoice_number ? `factuur ${dup.match.invoice_number}` : "deze factuur"
      // [DUP-ARCHIVED] Zelfde eerlijkheid als de PDF-route: een genegeerde factuur staat in
      // Genegeerd, niet "gewoon in je lijst" — noem terugzetten als de weg vooruit.
      const archivedUbl = await archivedInvoiceById(supabase, userId, dup.match.id)
      return NextResponse.json({
        error: archivedUbl
          ? archivedDuplicateMessage(archivedUbl)
          : `Deze factuur bestaat al — ${nr}${dup.match.client_name ? ` van ${dup.match.client_name}` : ""} is al toegevoegd.`,
        duplicate: true, original_id: dup.match.id, canForce: true,
        ...(archivedUbl ? { archived: archivedUbl } : {}),
      }, { status: 409 })
    } else {
      // Not a confident duplicate — is it a POSSIBLE one? (soft flag, never blocks; held from auto-confirm)
      possibleDup = await collectPossibleDuplicate(
        { invoiceNumber: v.invoiceNumber, vendor: v.supplierName, totalIncBtw, invoiceDate: v.invoiceDate },
        async (total) => {
          const { data, error: dedupErr } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", userId).eq("direction", "incoming")
            .gte("total_inc_btw", total - 0.01).lte("total_inc_btw", total + 0.01)
            // [DEDUP-RECENCY] Nieuwste eerst, NULL achteraan — zie de camera-route.
            .order("created_at", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false }).limit(200)
          if (dedupErr) dedupCheckFailed = true
          return data ?? []
        },
        // [DEDUP-CORRECTED] Same number, ANY amount — the corrected re-issue the query above misses.
        // Venster van 50 naar 200, om dezelfde reden als op de camera-route: een `*` in het nummer
        // verbreedt de ilike (PostgREST leest hem als `%`) en mag de gezochte correctie niet uit het
        // venster duwen. Blokkeren doet deze query niet; hij levert kandidaten voor de assessor.
        async (invoiceNumber) => {
          const { data, error: dedupErr } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", userId).eq("direction", "incoming")
            .ilike("invoice_number", escapeLikeValue(invoiceNumber))
            // [DEDUP-RECENCY] Nieuwste eerst, NULL achteraan — zie de camera-route.
            .order("created_at", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false }).limit(200)
          if (dedupErr) dedupCheckFailed = true
          return data ?? []
        },
        // [DEDUP-SOFT] Best-effort BY NAME. This invoice lands in the verify queue, and the
        // callbacks above already record a failed read in dedupCheckFailed →
        // markDuplicateCheckUnavailable, so the human still sees "we konden de dubbelcheck niet
        // uitvoeren". Leaving this off would fail the whole import over one soft probe.
        { bestEffort: true },
      )
    }
  }

  // ── Store the XML — FATAL if it fails. The document row IS the evidence link for an e-invoice
  //    (invoices.document_id → documents.file_url, the 7-year bewaarplicht source). The old path
  //    used best-effort storeRawIncoming and booked the invoice even when the store returned null →
  //    an invoice whose voorbelasting reached the aangifte while its XML was silently lost. We now
  //    mirror the camera path: a failed store/row is fatal (roll back, surface an error), never a
  //    phantom-evidence success. Because the byte-hash gate above already 409'd an existing file,
  //    this is guaranteed a FRESH file — so we create our OWN row and only ever roll back that one
  //    (the old code could destructively delete a pre-existing row on a forced re-upload). ──
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
  const contentType = file.type || "application/xml"
  const { error: upErr } = await supabase.storage
    .from("documents").upload(storagePath, buffer, { contentType, upsert: false })
  if (upErr) {
    return NextResponse.json({ error: "E-factuur kon niet worden opgeslagen — probeer het opnieuw." }, { status: 502 })
  }

  const folderId = await resolveImportTarget(userId, v.invoiceDate ?? null, "facturen", "pipeline")
  const pipeline = createPipelineClient()
  const { data: doc, error: docErr } = await pipeline
    .from("documents")
    .insert({
      user_id: userId, file_name: file.name, file_url: storagePath,
      file_size: buffer.length, file_type: contentType,
      doc_type: "factuur", folder_id: folderId,
      year: v.invoiceDate ? new Date(v.invoiceDate).getFullYear() : null,
      source: "upload", ai_processed: true, ai_doc_type: "ubl_invoice", content_hash: hash,
    })
    .select("id").single()
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath])
    // [DEDUP-ATOMIC] A concurrent double-submit racing past the byte-hash SELECT trips the
    // (user_id, content_hash) UNIQUE index (23505) — treat it as the duplicate it is, not a 500,
    // so a second invoice is never created for the same file (the race the old path allowed).
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, folder_id").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
      return NextResponse.json({
        duplicate: true, error: "Deze e-factuur is al geïmporteerd.",
        existing: dup ? { id: dup.id, folder_id: dup.folder_id ?? null } : undefined,
      }, { status: 409 })
    }
    return NextResponse.json({ error: "Opslaan van de e-factuur is mislukt — probeer het opnieuw." }, { status: 500 })
  }
  const documentId = doc.id

  // ── [XML-PDF] The printable invoice inside the e-factuur ──────────────────────────────────
  //
  // Reported with a screenshot: pressing "Bekijk factuur" on an e-factuur opened a wall of raw XML.
  // Nothing was broken — the stored file IS the UBL, because the supplier sent a UBL — but Peppol
  // carries the human-readable PDF inside the XML, and the app was showing the envelope while
  // holding the letter. An entrepreneur checking an amount, or an accountant checking the app,
  // sees namespaces and a base64 blob running off the screen.
  //
  // The XML stays exactly where it is. It is the machine evidence: the signed original, the thing
  // the Belastingdienst is entitled to, and the only artefact that proves what the supplier sent.
  // Only `pdf_url` — the document the OWNER opens — points at the PDF instead. Same division this
  // codebase draws everywhere: the client may correct any field the machine read, the machine's
  // evidence is immutable.
  //
  // Best-effort ON PURPOSE, and this is the one judgement worth writing down. Failing the whole
  // import because a bonus attachment could not be stored would refuse an invoice whose amounts,
  // BTW and supplier were all read perfectly — over the cosmetics of which file opens. So a
  // failure here leaves openUrl null and the owner keeps exactly what they have today: the XML.
  let openUrl: string | null = null
  try {
    const { extractEmbeddedPdf } = await import("@/lib/ubl-embedded-pdf")
    const ingesloten = extractEmbeddedPdf(xmlText)
    if (ingesloten) {
      const pdfNaam = ingesloten.filename ?? `${(v.invoiceNumber || "e-factuur").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`
      const pdfPath = `${userId}/incoming/${Date.now()}-${pdfNaam.replace(/\.pdf$/i, "")}.pdf`
      const { error: pdfErr } = await supabase.storage
        .from("documents").upload(pdfPath, ingesloten.bytes, { contentType: "application/pdf", upsert: false })
      if (!pdfErr) openUrl = pdfPath
    }
  } catch {
    // Deliberately silent: see above. There is nothing for the owner to do about it, and the
    // invoice itself is unaffected — this is the one place in this route where that is true.
  }

  const fieldConfidence: Record<string, unknown> = {
    // A structured e-invoice is high-confidence per field where present; flag any missing field so
    // the verify queue's health badge asks the human to complete it (never a silent wrong number).
    vendor: v.supplierName ? 0.95 : 0.2,
    invoice_number: v.invoiceNumber ? 0.98 : 0.2,
    invoice_date: v.invoiceDate ? 0.98 : 0.2,
    _source: "ubl_xml",
  }
  // [BTW-SPLIT] The per-rate breakdown straight out of the XML, signed the same way as the totals
  // just above. On a mixed-rate invoice this is the difference between a checklist that can say
  // "nagerekend" and one that has to admit it compared the btw with nothing — and on this path the
  // numbers are typed elements, so there is nothing to have misread.
  //
  // Stored whether or not it agrees with our two figures, exactly as on the reader path. Whether a
  // disagreement means "hold this invoice" is classifyImportHealth's judgement to make, in one
  // place; filtering here would quietly delete the evidence it needs to make it.
  if (v.btwRows.length > 0) {
    fieldConfidence._btw_rows = v.btwRows.map((r) => ({
      rate: r.rate,
      base: sign * r.base,
      btw: sign * r.btw,
    }))
  }
  // [DEDUP-SOFT] Merge a possible-duplicate signal into _safecore so classifyImportHealth reads it →
  // needs-review → the e-invoice is held out of auto-confirm and the queue shows "mogelijk dubbel".
  // [DEDUP-READ-HONEST] Outside the `if (possibleDup)` guard, and that placement IS the fix.
  //
  // markDuplicateCheckUnavailable exists for exactly one case: the invoices probe FAILED, so no
  // candidate was found. Nesting it inside "a candidate was found" made it provably unwritable —
  // and its own first line returns unchanged when possible_duplicate is already true, so even on
  // the branch it could reach it was a no-op. dedupCheckFailed was computed in three places and
  // then discarded.
  //
  // What that cost: supabase-js does not throw, so a timed-out probe gives `data: null` → `?? []`
  // → no candidate → possibleDup null → no flag → classifyImportHealth says 'clean' →
  // shouldAutoAdvanceInvoice books the invoice as 'received' with no human in the loop. A paper
  // invoice photographed after the same one arrived by e-mail (different bytes, so the hash gate
  // correctly misses) is then a second cost in the books and a second voorbelasting claim, with
  // nothing on any card saying the duplicate check never ran.
  //
  // /api/email/upload:465 has always applied it unconditionally. This is that shape.
  {
    const merged = (dedupCheckFailed
      ? markDuplicateCheckUnavailable(mergePossibleDuplicate(fieldConfidence, possibleDup))
      : mergePossibleDuplicate(fieldConfidence, possibleDup)) as Record<string, unknown> | null
    if (merged?._safecore) fieldConfidence._safecore = merged._safecore
  }

  // [LEVERANCIER-INTAKE] Ook een e-factuur heeft een leverancier. Dit pad schreef vendor_iban wel
  // en supplier_id niet, en een Peppol-XML is net zo goed door te sturen als een PDF — dus loopt
  // hij langs dezelfde twee stappen in dezelfde volgorde: eerst de IBAN-controle, dan de
  // registratie. De XML draagt geen KVK, dus die gaat als null mee.
  //
  // [BTW-NUMMER-BEWAARD] Het btw-nummer gaat wél mee. Deze regel stond hier op null omdat de
  // parser het nummer niet las, niet omdat de XML het niet draagt — PartyTaxScheme/CompanyID
  // staat op vrijwel elke e-factuur. Het is geen SLEUTEL in de registratie (dat zijn IBAN en KVK),
  // dus dit kan een leverancier niet verkeerd samenvoegen; het vult alleen een leeg veld.
  const leverancier = await resolveSupplierAtIntake(pipeline, userId, {
    name: v.supplierName,
    iban: v.vendorIban ?? null,
    kvk: null,
    btw: v.supplierVatNumber ?? null,
  })
  if (Object.keys(leverancier.safecore).length > 0) {
    fieldConfidence._safecore = mergeSafecore(fieldConfidence, leverancier.safecore)
  }

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: userId,
      direction: "incoming",
      status: "processing", // always human-verified — a machine-read path stays gated (no auto-advance)
      source: "upload",
      supplier_id: leverancier.supplierId,
      client_name: leverancier.supplierName || v.supplierName || "Onbekende afzender",
      // [BTW-NUMMER-BEWAARD] Een e-factuur STAAT het btw-nummer van de leverancier, in een eigen
      // element — geen OCR, geen gok. Juist dit pad draagt de buitenlandse leveranciers waarvan de
      // verlegde BTW in rubriek 4b hoort; zonder deze regel bleef die lijst leeg.
      client_btw_number: supplierBtwForInvoice(v.supplierVatNumber),
      invoice_date: v.invoiceDate,
      due_date: v.dueDate,
      // [BON-NUMMER] Leeg blijft leeg — dezelfde regel als het camerapad hierboven, dat zijn
      // `CAMERA-${Date.now()}` om precies deze reden kwijtraakte: snelstart-mapping weigert een
      // LEEG nummer aan de grens (MISSING_NUMBER), maar "UBL-1784373782895" glipt erdoor en landt
      // als factuurnummer op een inkoopboeking in het wettelijke inkoopboek van de boekhouder —
      // een kenmerk dat op geen enkel papier terug te vinden is. De fix was op één tak toegepast.
      invoice_number: v.invoiceNumber?.trim() || null,
      invoice_type: v.isCreditNote ? "creditnota" : "factuur",
      total_ex_btw: totalExBtw,
      btw_amount: btwAmount,
      total_inc_btw: totalIncBtw ?? 0,
      // [XML-PDF] What the owner opens: the PDF from inside the e-factuur when it carried one, and
      // otherwise the XML exactly as before. Never null — a row with no file at all is worse than
      // a row that opens as XML.
      pdf_url: openUrl ?? storagePath,
      // …and document_id keeps pointing at the XML, which is the evidence.
      document_id: documentId,
      vendor_iban: v.vendorIban ?? null,
      field_confidence: fieldConfidence as InvoiceFieldConfidence,
    })
    .select("id")
    .single()

  if (dbError) {
    // Roll back OUR document row + stored blob (never a pre-existing row — this file was fresh).
    await pipeline.from("documents").delete().eq("id", documentId)
    await supabase.storage.from("documents").remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }
  if (invoice?.id) {
    await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId)
  }

  return NextResponse.json({
    ok: true,
    destination: "invoice",
    invoice_id: invoice?.id ?? null,
    document_id: documentId,
    ...(possibleDup
      ? { possibleDuplicate: { invoice_number: possibleDup.match.invoice_number, client_name: possibleDup.match.client_name, reason: possibleDup.reason } }
      : {}),
    message: possibleDup
      ? `E-factuur (UBL) ingelezen — let op: mogelijk dubbel${possibleDup.match.invoice_number ? ` met ${possibleDup.match.invoice_number}` : ""} (${possibleDup.reason}). Controleer voor je bevestigt.`
      : "E-factuur (UBL) ingelezen — controleer de gegevens in de verificatierij.",
  })
}

// ── Daily-sales report handler — a "OMZET VAN DD/MM/YYYY" PDF is one day of turnover ─────────
// Returns a NextResponse when the PDF IS a daily-sales report (booked or stored-for-review), or
// null when it isn't (the caller then runs the normal invoice extractor). The per-day report is the
// sibling of the monthly kassa Excel; it lands in the SAME daily_turnover table via bookTurnoverRows,
// so uploading the month's Excel later simply upserts the same days (idempotent — never doubles).
async function handleDailySalesPdf(
  text: string | null,
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  req: NextRequest,
  source: IntakeSource,
): Promise<NextResponse | null> {
  // The text layer is extracted by the caller (once, shared with the multi-invoice check).
  // No text (a scan, or an unreadable PDF) → not this report; the invoice extractor still runs.
  if (!text || !looksLikeDailySalesReport(text)) return null

  const { row, warnings } = parseDailySalesReport(text)
  if (!row) return null // looked like a report but unreadable → let the AI path try instead

  const documentId = await storeRawIncoming(buffer, file, userId, supabase, "dagverkopen_pdf", source)

  if (warnings.length > 0) {
    // A per-rate/TOTAAL mismatch → do NOT auto-book omzet into the VAT picture; store + send to review.
    return NextResponse.json({
      ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
      message: `Dagomzet herkend (${row.turnover_date}) — maar de bedragen kloppen niet helemaal (${warnings.length} controle). Controleer en boek in Dagomzet.`,
    })
  }

  // source MUST be an allowed daily_turnover.source value ('z_report' | 'manual') — the DB CHECK
  // rejects anything else, which would silently fail the whole booking. Provenance (PDF vs Excel)
  // lives in the audit log below (path: intake_pdf), not in this constrained column.
  const booked = await bookTurnoverRows(supabase, userId, [row], "z_report", { preserveSplit: true })
  if (!booked.ok) {
  // [STORE-RAW-EERLIJK] Op deze tak wordt NIETS geboekt — het opgeslagen bestand is de hele
  // uitkomst. Is dat opslaan mislukt (documentId null), dan is er letterlijk niets gebeurd,
  // terwijl de oude melding de eigenaar naar een scherm stuurde waar het bestand niet staat.
  // Weigeren is eerlijk, en veilig om te herhalen: de mislukte opslag heeft de content-hash
  // niet geclaimd, dus een nieuwe poging kan wél slagen.
  if (documentId === null) {
      return NextResponse.json({ error: "We konden dit bestand nu niet opslaan. Er is niets geboekt en niets bewaard — probeer het zo opnieuw." }, { status: 503 })
    }
    return NextResponse.json({
      ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
      // [TURNOVER-ARITHMETIC] Two different failures, two different sentences. "Opslaan is mislukt"
      // sends the owner to retry an import that will fail again in exactly the same way.
      message: booked.rejected.length
        ? `De bedragen van deze dag kunnen niet kloppen (${booked.rejected[0]}). Er is niets geboekt — deze bedragen gaan naar je btw-aangifte, dus controleer het Z-rapport en voer de dag zelf in.`
        : booked.duplicateDay
          ? `Dit blad noemt ${booked.duplicateDay} twee keer. Er is niets geboekt — voeg de rijen van die dag samen in het bestand en importeer opnieuw.`
          : "Dagomzet gelezen, maar opslaan is mislukt — probeer het in Dagomzet opnieuw.",
    })
  }
  await logAuditAction({
    userId, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: documentId ?? userId,
    newValue: { days: 1, span: row.turnover_date, total_incl: booked.total_incl, file_name: file.name, path: "intake_pdf" },
    ipAddress: getClientIP(req),
  }).catch(() => {})
  return NextResponse.json({
    ok: true, destination: "turnover", document_id: documentId,
    days: 1, span: row.turnover_date, total_incl: booked.total_incl,
    message: `Dagomzet geboekt ✓ — ${row.turnover_date} (€${booked.total_incl.toFixed(2)}). Controleer in Dagomzet.`,
  })
}

// ── Spreadsheet handler — kassa Z-report → daily_turnover, grootboek → ledger_daily ─────────
// Returns a NextResponse when the file IS a recognised turnover/ledger sheet (booked), or null
// when it is neither (the caller then stores it in bestanden like any other document). Reuses the
// SAME pure normalizers and the SAME tables as the manual /api/turnover/import + /api/ledger/import
// paths — this only changes WHERE the parse is triggered, never the numbers it produces.
//
// Money-truth: turnover feeds the VAT return, so it is auto-booked ONLY when the normalizer's own
// per-row cross-checks pass with zero warnings (commitSafe); a flagged sheet is stored and the owner
// is sent to Dagomzet to review. Ledger is a reconciliation witness (never the P&L), so it is always
// safe to store. Both upserts are keyed on (user, day[, kind]) → re-uploading a month corrects it,
// never doubles it. Everything is audited and reversible (re-import a corrected file, or clear the day).
async function handleSpreadsheet(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  req: NextRequest,
  source: IntakeSource,
): Promise<NextResponse | null> {
  let matrix
  try {
    matrix = sheetBytesToMatrix(new Uint8Array(buffer))
  } catch {
    return null // not readable as a spreadsheet → let the caller store the raw file
  }
  const plan = planSpreadsheetIngest(matrix)
  if (plan.kind === "unknown") return null

  // Store the raw file (best-effort) so the accountant has the source and the owner can open it.
  const documentId = await storeRawIncoming(
    buffer, file, userId, supabase,
    plan.kind === "turnover" ? "kassa_zrapport" : plan.kind === "kasboek" ? "kasboek" : "grootboek_export",
    source,
  )

  // ── TURNOVER: authoritative omzet + BTW → daily_turnover ──────────────────────────────────
  if (plan.kind === "turnover" && plan.turnover) {
    const { rows, warnings, commitSafe } = plan.turnover
    const dates = rows.map((r) => r.turnover_date).sort()
    const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : ""

    if (!commitSafe) {
      // Flagged (arithmetic/payment mismatch) OR nothing parsed → do NOT auto-book omzet into the
      // VAT picture. The file is stored; the owner reviews + books in Dagomzet.
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId,
        sheet_kind: "turnover_review",
        message: rows.length === 0
          ? "Dit lijkt een kassa-bestand, maar er zijn geen dag-omzetregels gelezen — controleer het in Dagomzet."
          : `Kassa-omzet herkend (${telWoord(rows.length, "dag", "dagen")}, ${span}) — maar ${telWoord(warnings.length, "regel", "regels")} ${vervoeg(warnings.length, "heeft", "hebben")} aandacht nodig. Controleer en boek in Dagomzet.`,
      })
    }

    const booked = await bookTurnoverRows(supabase, userId, rows, "z_report")
    if (!booked.ok) {
      // [STORE-RAW-EERLIJK] Zie de eerste tak: niets geboekt + niets bewaard = niets gebeurd,
      // en de melding mag de eigenaar niet naar een scherm sturen waar het bestand niet staat.
      if (documentId === null) {
        return NextResponse.json({ error: "We konden dit bestand nu niet opslaan. Er is niets geboekt en niets bewaard — probeer het zo opnieuw." }, { status: 503 })
      }
      // Never claim a booking that didn't happen. Store stays; tell the owner to retry via Dagomzet.
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
        // [TURNOVER-ARITHMETIC] As above: refused figures are not a failed save, and telling the
        // owner to retry would send them into the same refusal.
        message: booked.rejected.length
          ? `De bedragen van ${booked.rejected.length === 1 ? "één dag" : `${booked.rejected.length} dagen`} kunnen niet kloppen (${booked.rejected[0]}). Er is niets geboekt — deze bedragen gaan naar je btw-aangifte, dus controleer het Z-rapport en importeer opnieuw.`
          : booked.duplicateDay
            ? `Dit blad noemt ${booked.duplicateDay} twee keer. Er is niets geboekt — voeg de rijen van die dag samen in het bestand en importeer opnieuw.`
            : "Kassa-omzet gelezen, maar opslaan is mislukt — probeer het in Dagomzet opnieuw.",
      })
    }
    await logAuditAction({
      userId, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: documentId ?? userId,
      newValue: { days: booked.days, span: booked.span, total_incl: booked.total_incl, file_name: file.name, path: "intake_xlsx" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    return NextResponse.json({
      ok: true, destination: "turnover", document_id: documentId,
      days: booked.days, span: booked.span, total_incl: booked.total_incl,
      message: `Kassa-omzet geboekt ✓ — ${booked.days} dagen (${booked.span}). Controleer in Dagomzet.`,
    })
  }

  // ── KASBOEK: gelezen en geteld, NOOIT geboekt ────────────────────────────────────────────
  //
  // Een echte klant leverde zijn kwartaalkasboek aan en de app bewaarde het als een dichtgeplakt
  // bestand. Gemeten op datzelfde kwartaal: de ontvangsten klopten tot op de cent met wat de app
  // had, en van de € 22.377,02 aan contante UITGAVEN kende de app er € 1.402,87 — de lade stond
  // ruim € 19.000 te hoog.
  //
  // En toch boekt dit niets, om precies één reden: die € 1.402,87 zit er al in, geboekt via de
  // facturen die ermee betaald zijn, en de boekhouder schrijft "hano 006220 en 006305 : 1.591,83
  // ,,  famzfood : 162,52" op één regel van € 1.754,35. Automatisch overnemen boekt dubbel in de
  // kas — waar een dubbele uitgave het saldo VERLAAGT en niemand het merkt tot de lade niet meer
  // klopt. Welke regel welke bestaande boeking is, kan alleen de eigenaar zeggen.
  //
  // Dus: het bestand wordt bewaard, gelezen, en de uitkomst gaat terug naar het scherm. Beslissen
  // is mensenwerk, in Kas.
  if (plan.kind === "kasboek" && plan.kasboek) {
    const k = plan.kasboek
    const span = k.rows.length ? `${k.rows[0].date} t/m ${k.rows[k.rows.length - 1].date}` : ""
    const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    await logAuditAction({
      userId, action: "kasboek.imported_read_only", entityType: "document", entityId: documentId ?? userId,
      newValue: {
        days: k.rows.length, span, opening: k.openingBalance, closing: k.closingBalance,
        received: k.totalReceived, spent: k.totalSpent, warnings: k.warnings.length, file_name: file.name,
      },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    // [STORE-RAW-EERLIJK] Zie de eerste tak: niets geboekt + niets bewaard = niets gebeurd,
    // en de melding mag de eigenaar niet naar een scherm sturen waar het bestand niet staat.
    if (documentId === null) {
      return NextResponse.json({ error: "We konden dit bestand nu niet opslaan. Er is niets geboekt en niets bewaard — probeer het zo opnieuw." }, { status: 503 })
    }
    return NextResponse.json({
      ok: true, destination: "document", document_id: documentId, sheet_kind: "kasboek_review",
      days: k.rows.length, span,
      opening: k.openingBalance, closing: k.closingBalance,
      received: k.totalReceived, spent: k.totalSpent,
      warnings: k.warnings.map((w) => w.message),
      message:
        `Kasboek gelezen ✓ — ${k.rows.length} dagen (${span}). Begint op ${eur(k.openingBalance ?? 0)}, ` +
        `eindigt op ${eur(k.closingBalance ?? 0)}; ${eur(k.totalReceived)} ontvangen, ${eur(k.totalSpent)} uitgegeven.` +
        (k.warnings.length
          ? ` Let op: ${telWoord(k.warnings.length, "regel", "regels")} ${vervoeg(k.warnings.length, "sluit", "sluiten")} niet aan — ${k.warnings[0].message}`
          : " Het blad sluit op zichzelf aan.") +
        " Er is niets geboekt: een deel van deze uitgaven staat mogelijk al in je kas via de factuur" +
        " waarmee je ze betaalde. Vergelijk het in Kas.",
    })
  }

  // ── LEDGER: reconciliation witness (never money) → ledger_daily ───────────────────────────
  if (plan.kind === "ledger" && plan.ledger) {
    const { kind, accountNr, rows } = plan.ledger
    const booked = await bookLedgerRows(supabase, userId, kind, accountNr, rows)
    if (!booked.ok) {
      // [STORE-RAW-EERLIJK] Zie de eerste tak: niets geboekt + niets bewaard = niets gebeurd,
      // en de melding mag de eigenaar niet naar een scherm sturen waar het bestand niet staat.
      if (documentId === null) {
        return NextResponse.json({ error: "We konden dit bestand nu niet opslaan. Er is niets geboekt en niets bewaard — probeer het zo opnieuw." }, { status: 503 })
      }
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId, sheet_kind: "ledger_review",
        // [DUP-DAY / GEEN-STILLE-KAP] Een fout die bij elke poging identiek terugkomt mag niet
        // "probeer opnieuw" heten — noem wat er aan de hand is, dan kan de eigenaar het bestand
        // repareren in plaats van dezelfde muur te herhalen.
        message: booked.duplicateDay
          ? `Dit overzicht noemt ${booked.duplicateDay} twee keer. Er is niets opgeslagen — voeg de rijen van die dag samen en importeer opnieuw.`
          : booked.tooMany
            ? `Dit overzicht heeft ${booked.tooMany} dagregels — meer dan de 1000 die we in één keer verwerken. Splits het bestand (bijvoorbeeld per jaar) en importeer de delen apart.`
            : "Grootboek-overzicht gelezen, maar opslaan is mislukt — probeer het opnieuw.",
      })
    }
    await logAuditAction({
      userId, action: "ledger.auto_imported", entityType: "ledger_daily", entityId: documentId ?? userId,
      newValue: { kind, account_nr: accountNr, days: booked.days, span: booked.span, file_name: file.name, path: "intake" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    return NextResponse.json({
      ok: true, destination: "ledger", document_id: documentId, ledger_kind: kind,
      days: booked.days, span: booked.span,
      message: `${ledgerKindLabel(kind)} ingelezen ✓ — ${booked.days} dagen (${booked.span}) als controle-check. Verschijnt in de reconciliatie, niet dubbel in je omzet.`,
    })
  }

  return null
}

// ── Bank statement handler — mirrors /api/bank/upload (text/xml only) ─────────
async function handleBankStatement(buffer: Buffer, filename: string, userId: string, fileType: string) {
  const pipeline = createPipelineClient()
  const result = await importBankStatement({ buffer, filename, fileType, userId, pipeline })

  // A bank-shaped file the parser couldn't read yields 0 transactions — but the raw file
  // is still stored for the accountant (importBankStatement), so this is NOT an error:
  // report it honestly rather than 422-ing (which would trap the file behind byte-hash
  // dedup on retry). Aligns the intake path with /api/bank/upload's lenient behavior.
  // [VREEMD-BESTAND] Een geweigerd bestand (niet-EUR, meerdere rekeningen) is een fout met een
  // reden, geen verwerking. Er is niets geboekt en geen dekking geclaimd.
  if (result.refused) {
    return NextResponse.json({ error: result.refused }, { status: 422 })
  }
  const unreadable = result.parseWarnings.length
  // [BANK-INSERT-LUID] Een mislukte transactie-insert mag nooit als "verwerkt" op het scherm
  // komen: er is dan een hele maand aan regels NIET geland terwijl het ruwe bestand wél is
  // opgeslagen (en de content-hash claimt). De waarschuwing uit bank-ingest draagt de uitleg.
  let msg =
    result.insertFailed
      ? `Bankafschrift gelezen (${result.parsed} transacties), maar het opslaan is MISLUKT — er is niets geboekt. ${result.parseWarnings[0] ?? ""}`
      : result.parsed === 0
        ? `${result.statementStored ? "Bankafschrift opgeslagen, maar er" : "Er"} zijn geen transacties gelezen — controleer het bestand.${unreadable > 0 ? ` (${result.parseWarnings[0]})` : ""}`
        : unreadable > 0
          ? `Bankafschrift verwerkt — ${telWoord(result.inserted, "transactie", "transacties")} toegevoegd. Let op: ${telWoord(unreadable, "regel", "regels")} ${vervoeg(unreadable, "kon", "konden")} niet gelezen worden en ${vervoeg(unreadable, "staat", "staan")} niet in je overzicht — controleer het originele bestand.`
          : `Bankafschrift verwerkt — ${telWoord(result.inserted, "transactie", "transacties")} toegevoegd.`
  // [BANK-BALANCE §2.6] A statement whose begin/eindsaldo doesn't tie out to its own transactions
  // is INCOMPLETE — surface it prominently (this is exactly the "missing bank line" the owner can't
  // otherwise see), appended to the honest message and returned structured for the caller.
  if (result.balanceWarning) msg += ` ${result.balanceWarning}`
  // [CSV-EERLIJK] Een CSV draagt geen begin/eindsaldo, dus de volledigheidscontrole KAN niet
  // draaien — en "geen waarschuwing" leest dan als "gecontroleerd". Zeg het verschil.
  if (result.format === "CSV" && !result.balanceWarning && result.inserted > 0) {
    msg += " Let op: een CSV bevat geen saldocontrole — wij kunnen niet nagaan of dit overzicht compleet is. MT940 of CAMT.053 van je bank kan dat wel."
  }
  // [STATEMENT-CONTINUITY] …en of er een heel AFSCHRIFT tussen zit dat we nog niet hebben. Twee
  // verschillende gaten: balanceWarning kijkt binnen dit bestand, dit tussen de bestanden.
  if (result.continuityWarning) msg += ` ${result.continuityWarning}`
  return NextResponse.json({
    // Niet ok wanneer het opslaan zelf faalde: de client toont dan een fout, geen groene rij.
    ok: !result.insertFailed,
    destination: "bank",
    format: result.format,
    parsed: result.parsed,
    inserted: result.inserted,
    skipped: result.skipped,
    statementStored: result.statementStored,
    parseWarnings: result.parseWarnings,
    balanceWarning: result.balanceWarning,
    continuityWarning: result.continuityWarning,
    message: msg,
  })
}
// ── [STATEMENT-RECONCILE] Het leveranciersoverzicht als volledigheidscontrole ────────────────

/**
 * Is dit document een REKENINGOVERZICHT van een leverancier (en dus geen boekbare factuur)?
 * Drie onafhankelijke signalen, precies de drie die de extractor zelf al gebruikt om zo'n
 * document te WEIGEREN — we hangen er alleen een tweede leven aan. Eén ervan volstaat:
 *   · het model zette is_statement (de tekst-guard forceert dat ook),
 *   · het model schreef zijn eigen reden ("rekeningoverzicht — …"),
 *   · de bestandsnaam laat geen twijfel.
 */
function isSupplierStatement(
  v: { is_statement?: boolean | null; reason?: string | null },
  filename: string,
): boolean {
  return v.is_statement === true || looksLikeStatementReason(v.reason) || isStatementFilename(filename)
}

/** Wat de client krijgt: één eerlijke zin + de nummers die de eigenaar moet gaan zoeken. */
interface StatementReconcilePayload {
  message: string
  vendor: string | null
  period: { from: string; to: string } | null
  compared: number
  missing: Array<{ invoice_number: string | null; date: string | null; amount: number | null }>
  missing_amount: number
  archived: Array<{ invoice_number: string | null; invoice_id: string }>
  not_on_statement: Array<{ invoice_number: string | null; invoice_id: string }>
  unreadable: number
}

/**
 * Lees het overzicht, haal onze eigen facturen van die leverancier erbij en vergelijk.
 *
 * Discipline (hetzelfde als overal in deze pipeline): niets boeken, niets aanpassen aan
 * bestaande facturen, en liever geen uitspraak dan een gokkende. Faalt zacht — elke `null`
 * hier laat de gewone "opgeslagen in je bestanden"-afhandeling staan, precies zoals vóór
 * deze functie bestond.
 */
async function reconcileSupplierStatement(args: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  pipeline: ReturnType<typeof createPipelineClient>
  userId: string
  documentId: string
  base64: string
  mimeType: string
  filename: string
  receiverName: string | null
}): Promise<StatementReconcilePayload | null> {
  const { supabase, pipeline, userId, documentId, base64, mimeType, filename, receiverName } = args

  const read = await readSupplierStatement(base64, mimeType, filename, receiverName)
  // Geen leesbare regels → geen controle. Nooit "alles compleet" claimen op een leeg resultaat.
  if (!read.ok || read.lines.length === 0) return null

  const lines: StatementLine[] = read.lines.map((l) => ({
    invoice_number: l.invoice_number,
    date: l.date,
    amount: l.amount,
    kind: l.kind,
    description: l.description,
  }))

  // Het venster waarin we onze eigen facturen zoeken: de periode van het overzicht, ruim
  // genomen (een factuur van eind vorige maand staat op het overzicht van deze). Zonder
  // periode: de laatste achttien maanden — verder terug zegt een overzicht niets meer.
  const lineDates = lines.map((l) => l.date).filter((d): d is string => !!d).sort()
  const anchor = read.period_from ?? lineDates[0] ?? null
  const from = anchor
    ? new Date(new Date(`${anchor}T00:00:00Z`).getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
    : new Date(Date.now() - 550 * 86_400_000).toISOString().slice(0, 10)

  // [NO-SILENT-EMPTY] Dit is de lijst met wat wij WEL hebben. Een mislukte lezing werd hier een
  // lege lijst, en dan meldt reconcileStatement élke regel op het leveranciersoverzicht als een
  // factuur die wij missen — met een totaalbedrag eronder. De ondernemer gaat die bonnen dan
  // opvragen en opnieuw inboeken bij een leverancier die ze allang gestuurd heeft: dubbele
  // inkoopfacturen, dubbele voorbelasting.
  //
  // Er is geen halve waarheid mogelijk. Terug is `null`, en dat is een stand die deze route al
  // kent: het bestand wordt gewoon opgeslagen zonder vergelijkingsvenster. Niets beweren is hier
  // het juiste antwoord — het overzicht blijft in Mijn bestanden staan en kan opnieuw.
  //
  // [VOL-GELEZEN] En gepagineerd: `.limit(2000)` werd stil ~1000 bij PostgREST, dus een
  // administratie met meer inkoopfacturen in het venster kreeg juist de OUDSTE eruit gefilterd —
  // en precies die worden dan als "ontbreekt" gemeld.
  let rows: Array<{
    id: string; invoice_number: string | null; invoice_date: string | null
    total_inc_btw: number | null; status: string | null; client_name: string | null
  }>
  try {
    rows = await fetchAllRows<{
      id: string; invoice_number: string | null; invoice_date: string | null
      total_inc_btw: number | null; status: string | null; client_name: string | null
    }>((lo, hi) => supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total_inc_btw, status, client_name")
      .eq("receiver_id", userId)
      .eq("direction", "incoming")
      .gte("invoice_date", from)
      .order("id", { ascending: true })
      .range(lo, hi) as unknown as PromiseLike<{ data: Array<{
        id: string; invoice_number: string | null; invoice_date: string | null
        total_inc_btw: number | null; status: string | null; client_name: string | null
      }> | null; error: { message: string } | null }>)
  } catch (e) {
    console.error("[STATEMENT-RECONCILE] eigen facturen niet te lezen — geen vergelijking gemeld", {
      userId, documentId, error: e instanceof Error ? e.message : String(e),
    })
    return null
  }

  // Alleen de facturen van DEZE leverancier vergelijken. Zonder bruikbare leveranciersnaam
  // vergelijken we tegen alles: een regel die we dan nergens terugvinden ontbreekt echt, en
  // dat is de enige claim die we in dat geval doen (zie hieronder — geen `notOnStatement`).
  const vendorKey = supplierNameKey(read.vendor)
  const scoped = vendorKey ? rows.filter((r) => supplierNameKey(r.client_name) === vendorKey) : rows

  // [TWEE-BOEKEN] Welke van die betalingen een BANKREGEL onder zich heeft.
  //
  // Het verschil beslist welke zin de eigenaar leest. Staat een factuur nog open op het overzicht
  // van de leverancier terwijl de bank de betaling laat zien, dan is het geld aantoonbaar
  // vertrokken en loopt de leverancier achter — vervelend, niet duur. Is het een handmatige
  // afvinking, dan heeft alléén de leverancier bewijs, en dan is dit het geval waarin er een
  // tweede keer betaald wordt of een aanmaning binnenkomt voor iets dat in de app groen staat.
  //
  // Best-effort: mislukt deze lezing, dan is er geen bewijs bekend en valt alles terug op de
  // voorzichtige zin. Dat is de goede kant om op te falen — hij vraagt om een controle die de
  // eigenaar hoe dan ook zelf kan doen.
  const bankProof = new Set<string>()
  if (scoped.length > 0) {
    try {
      const links = await fetchAllRowsForIds<{ invoice_id: string | null; transaction_id: string | null }, string>(
        scoped.map((r) => r.id),
        (chunk, lo, hi) => supabase
          .from("bank_tx_invoices")
          .select("invoice_id, transaction_id")
          .in("invoice_id", chunk)
          .order("id", { ascending: true })
          .range(lo, hi),
      )
      for (const l of links) if (l.invoice_id && l.transaction_id) bankProof.add(l.invoice_id)
    } catch (e) {
      console.error("[TWEE-BOEKEN] betaalbewijs niet te lezen — de voorzichtige zin blijft staan", {
        userId, documentId, error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const booked: BookedInvoice[] = scoped.map((r) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    total_inc_btw: r.total_inc_btw,
    status: r.status ?? "processing",
    paymentHasBankProof: bankProof.has(r.id),
  }))

  const result = reconcileStatement({
    lines,
    booked,
    period: read.period_from && read.period_to ? { from: read.period_from, to: read.period_to } : null,
  })

  const message = summarizeReconcile(result, read.vendor)

  // [STATEMENT-RECONCILE] De uitkomst hoort bij het BESTAND, niet bij dit ene venster: wie het
  // scherm wegklikt moet hem in Mijn bestanden nog kunnen teruglezen. `notes` is een bestaande
  // vrije tekstkolom — geen migratie nodig — en `ai_doc_type` maakt het overzicht later
  // vindbaar als wat het is. Best-effort: mislukt dit, dan blijft alleen het venster over.
  try {
    await pipeline
      .from("documents")
      .update({ notes: reconcileNote(result, read.vendor).slice(0, 1000), ai_doc_type: "statement" })
      .eq("id", documentId)
      .eq("user_id", userId)
  } catch {
    /* niet fataal */
  }

  return {
    message,
    vendor: read.vendor,
    period: result.period,
    compared: result.matched.length + result.archived.length + result.missing.length,
    missing: result.missing.map((l) => ({
      invoice_number: l.invoice_number,
      date: l.date,
      amount: l.amount,
    })),
    missing_amount: result.missingAmount,
    archived: result.archived.map((m) => ({
      invoice_number: m.invoice.invoice_number,
      invoice_id: m.invoice.id,
    })),
    // Zonder leveranciersnaam kunnen we niet zeggen dat wij iets EXTRA hebben — dan vergelijken
    // we immers tegen alle leveranciers tegelijk. Dan liever zwijgen dan onzin melden.
    not_on_statement: vendorKey
      ? result.notOnStatement.map((i) => ({ invoice_number: i.invoice_number, invoice_id: i.id }))
      : [],
    unreadable: result.unreadable.length,
  }
}
