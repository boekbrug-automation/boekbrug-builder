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

import { NextRequest, NextResponse } from "next/server"
// [DEUR-VANGNET] Eén vangnet voor elke deur waar een document binnenkomt.
import { withCrashNet } from "@/lib/route-crash-net"
import { createServerSupabaseClient } from "@/lib/supabase-server"
import { createPipelineClient } from "@/lib/supabase-pipeline"
import {
  // [STATEMENT-RECONCILE] herkenning + lezer van een leveranciersoverzicht
  } from "@/lib/ai"
// [STATEMENT-RECONCILE] pure vergelijking: overzichtsregels × onze eigen facturen.
import { resolveImportTarget, ensureImportedFolder } from "@/lib/bestanden"
import { computeContentHash } from "@/lib/content-hash"
// [BEWAAR-EERST] Shared with /api/bank/attach-invoice — one keep-the-file path, not two.
import { storeRawIncoming } from "@/lib/store-raw-incoming"
// [ONTVANGEN] The processing half — see that file's header for why it is its own module.
import { readIntentFromForm } from "@/lib/intake-intent"
import { processIntakeDocument, INTAKE_SOURCES, type IntakeSource } from "@/lib/intake-processor"
// [BEWAAR-EERST] The label the skipped panel counts, so a file we could not read yet gets its
// "Lees opnieuw" button — see skipped-import.ts and [TWEEDE-KANS].
import { buildFolderBreadcrumb } from "@/lib/documents"
import { importBankStatement } from "@/lib/bank-ingest"
import { logAuditAction, getClientIP } from "@/lib/audit"
import { decidePreAi } from "@/lib/intake-router"
// [BON-BETAALWIJZE] Eén normalisator voor elke weg waarlangs een betaalwijze binnenkomt.
// [OBSERVABILITY] Eén bron voor "dit bestand is bewaard maar niet gelezen" — gedeeld met het
// overgeslagen-paneel, dat vroeger op een andere waarde las dan hier werd geschreven.
import { DOC_TYPE_UNSUPPORTED } from "@/lib/skipped-import"
// [HERINNERING-NOOIT] A reminder is filed and linked to its invoice, never booked.
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
// [BON-AUTO] Mag een kassabon zichzelf afboeken? Alleen als het PAPIER de tenderregel afdrukt.
// [MULTI-INVOICE] "Eén PDF = één factuur" stond onder elke uploadknop en werd nergens
// gecontroleerd. Een gescande stapel levert één factuur op; de rest verdwijnt spoorloos.
// [PDF-TEXT] Shared with the e-mail door, so both run the same text-layer checks.
import { readPdfTextLayer } from "@/lib/pdf-text"
// [GEGROND] The stored verdict on whether the total is printed on the document.
// [INTAKE-IMG-PDF] Convert an uploaded image (jpg/png) to a one-page PDF at
// ingest, so every invoice lives as a PDF from day one (opens uniformly, can be
// stamped by the closing package with no download-time conversion).
// [SAFECORE Rule 2] semantic duplicate detection — same graded logic as the
// email path, so the camera/file path also blocks "same invoice, different file".
import { findSemanticDuplicate, pickDedupMatch, type PossibleDuplicate } from "@/lib/safecore"
// [DUP-TRASHED] De uitzondering op de byte-hash-poort voor een bestand dat de eigenaar zelf heeft
// weggegooid. Gedeeld met /api/email/upload, /api/bank/attach-invoice en de mailsync — vier kopieën
// van deze redenering zouden drie kansen zijn dat er één uit de pas gaat lopen.
import { trashedDuplicateCleared } from "@/lib/trashed-dedup"
import { collectPossibleDuplicate, mergePossibleDuplicate, markDuplicateCheckUnavailable } from "@/lib/possible-duplicate-collect"
// [READING-MEMORY] Feed the reader what the owner keeps correcting at each supplier.
// [ZELF-EERST] The owner's grip on the autopilot — see the helper for the fail matrix.
// [DUP-ARCHIVED] Botst de upload op een factuur die de eigenaar zelf genegeerd heeft? Dan is
// "die staat er al" waar, maar nutteloos — hij staat in Genegeerd. Zeg dat, en noem terugzetten.
import { archivedDuplicateMessage, archivedInvoiceById, archivedInvoiceForDocument } from "@/lib/archived-duplicate"
// [IBAN-WISSEL] Bekende leverancier, ander rekeningnummer → needs-review (en dus nooit auto-boeken).
import { mergeSafecore, resolveSupplierAtIntake } from "@/lib/intake-supplier"
// [EXTRACT-DUE-DATE] shared due-date derivation (explicit → invoice_date+term →
// null). Same single source of truth as the email path; never duplicated.
// [SMART-INTAKE] jsonb column type for invoices.field_confidence — same pattern
// as email-integration.ts / audit.ts: derive the Json type, cast at write.
import type { Database } from "@/types/database.types"
import { gateStorage } from "@/lib/fair-use-gate";
// [TZ] The owner's day, not the server's — see amsterdamToday().
import { supplierBtwForInvoice } from "@/lib/vendor-identity"
import { telWoord, vervoeg } from "@/lib/nl-plural";
// [NUL-GRONDSLAG] What may be stored when the split was not read — see read-amounts.ts.
import { } from "@/lib/read-amounts";
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
// [INTAKE-SOURCE] The vocabulary moved to intake-processor.ts, which names it in the
// context it takes; this door validates against the same list. See the note there.

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
    // [OPSLAG-DEUR] The unreadable-file branch stores just as many bytes as the readable one, and
    // writes a documents row for them. A gate on the main path only would have left the cheapest
    // way to fill an account wide open: upload things the reader cannot read.
    const space = await gateStorage({ client: supabase, userId: user.id, bytes: buffer.length })
    if (!space.allowed) return space.response!

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

  // ── [ONTVANGEN] Everything that needs the reader lives in intake-processor.ts ──────────────
  //
  // The block that used to continue here — Fair Use, the Claude call, the semantic duplicate
  // gate, the intake claim, storage, supplier resolution, the invoice insert, auto-advance, the
  // receipt settlement, cash reconcile, bank auto-confirm, the notification and the audit rows —
  // was MOVED, not changed. It still runs here, synchronously, in the same order, before this
  // request answers. Step 2 of [ONTVANGEN] is what moves it in TIME; this step only gave it an
  // edge, so that move can be made without also rewriting the block behind it.
  const outcome = await processIntakeDocument({
    // [ONTVANGEN] This door still runs inside the owner's own request, so the address is real.
    run: { kind: "request", ip: getClientIP(req) },
    // [ONTVANGEN] The same reader the durable path uses — one meaning for "paid_method", whether
    // it arrives on a live form or comes back out of the documents row.
    intent: readIntentFromForm(formData),
    supabase, user, file, buffer, source, force,
    effectiveType, isEInvoice, pdfText, pdfPages, contentHash,
  })
  // A library-built Response (rate limit, Fair Use, storage) carries headers a client reads, so
  // it is handed back whole rather than rebuilt from a body and a status.
  return outcome.kind === "response"
    ? outcome.response
    : NextResponse.json(outcome.body, { status: outcome.status })
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
