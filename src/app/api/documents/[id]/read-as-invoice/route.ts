// src/app/api/documents/[id]/read-as-invoice/route.ts
// [TWEEDE-KANS] Read a file we already have, again, with the reader we have now.
//
// ── THE DEAD END THIS OPENS ──
// A purchase invoice that could not be read — a model outage that outlasted the retry budget, a
// format there was no reader for, a photograph that came out badly — is kept. The file lands in
// bestanden, the skipped panel counts it, and the owner is told: "ze staan in je bestanden,
// controleer ze even."
//
// And then there was nothing to do there. Measured, before this route existed:
//
//   · the sync loads email_skipped_attachments into knownKeys and filters the attachment out of
//     EVERY future run, including a backfill — the give-up is permanent by design;
//   · /api/documents/reprocess covers spreadsheets and daily-sales reports only, never an invoice;
//   · every route that reads an invoice starts from an UPLOAD or from an existing INVOICE. None
//     took a stored document;
//   · and re-uploading the file is refused by the byte-hash gate, which is deliberately not
//     forceable — "an unreadable file carries no invoice to add again". That was true when it was
//     written. It is the sentence that traps the file.
//
// So the app was honest about the failure and offered no way out of it. The cost stayed unbooked
// and the voorbelasting unclaimed, with the evidence sitting in plain sight.
//
// ── WHY THE FILE, NOT THE MAILBOX ──
// The bytes are already ours. Nothing here touches e-mail, the watermark, or the skip registry's
// role as a de-duplicator: this is a document being read, which is the same thing the upload door
// does, minus the upload.
//
// ── AND IT IS FREE FOR THE ONE THAT MATTERS MOST ──
// A UBL/Peppol invoice filed as 'unsupported_type' before this app could read one is read here
// with no model and no cost — see gateFairUseForRead. Those are exact invoices, with real
// voorbelasting, sitting in bestanden today.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { gateFairUseForRead } from "@/lib/fair-use-gate";
import { verifyInvoiceFromPdf } from "@/lib/ai";
import { makeOwnInvoiceLookup } from "@/lib/own-invoice-lookup";
import { findInvoiceForDocument } from "@/lib/document-placement";
import { mergeSafecore, resolveSupplierAtIntake } from "@/lib/intake-supplier";
// [DEDUP-SOFT] "We konden de dubbelcheck niet uitvoeren" is een ander antwoord dan "hij staat
// er niet in" — zie possible-duplicate-collect.ts.
import { markDuplicateCheckUnavailable } from "@/lib/possible-duplicate-collect";
import { decideFromAi } from "@/lib/intake-router";
import { sniffReadableMime } from "@/lib/detect-file";
import { looksLikeInvoiceXmlBytes, E_INVOICE_XML_MIME } from "@/lib/e-invoice";
import { isSkippedDocType, DOC_TYPE_REMINDER } from "@/lib/skipped-import";
import { findSemanticDuplicate, pickDedupMatch, normalizeToIso, deriveDueDate } from "@/lib/safecore";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { pathBelongsToOwner, toStoragePath } from "@/lib/storage-path";
import type { Database } from "@/types/database.types";
import { supplierBtwForInvoice } from "@/lib/vendor-identity"

type InvoiceFieldConfidence = Database["public"]["Tables"]["invoices"]["Insert"]["field_confidence"];

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await checkRateLimit({
    userId: user.id, endpoint: "documents-read-as-invoice", ...RATE_LIMITS.DOCUMENTS_REPROCESS,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  // [NO-SILENT-EMPTY] The error is read. supabase-js does not throw, so `const { data }` on a
  // failed read gives null — and answering "dit bestand bestaat niet" to a database hiccup would
  // tell the owner their evidence is gone.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, file_url, file_name, file_type, ai_doc_type, invoice_id, trashed")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (docErr) {
    console.error("[TWEEDE-KANS] document lookup failed", { id, error: docErr.message });
    return NextResponse.json({ error: "We konden dit bestand nu niet opzoeken. Probeer het zo meteen opnieuw." }, { status: 503 });
  }
  if (!doc) return NextResponse.json({ error: "Dit bestand is niet gevonden." }, { status: 404 });

  // Only the files that were KEPT because they could not be read. A document the app filed as an
  // ordinary attachment, a bank statement or a photo of something else is not a failed invoice, and
  // reading it as one on request is how an owner books a cost that never existed.
  if (doc.invoice_id) {
    return NextResponse.json({ error: "Dit bestand hoort al bij een factuur." }, { status: 409 });
  }
  // [PRULLENBAK] The owner threw this away. Filtering it out of the panel is not enough — a panel
  // is a snapshot, and this route is reachable with an id from a tab that loaded before the file
  // went in the bin. Booking a cost (and claiming voorbelasting) from a document its owner deleted
  // is a decision the app may not make on its own, so the door refuses and says what to do.
  if (doc.trashed === true) {
    return NextResponse.json({
      error: "Dit bestand staat in je prullenbak. Zet het eerst terug als je het toch wilt laten lezen.",
    }, { status: 409 });
  }
  // [HERINNERING-NOOIT] A filed reminder with no invoice behind it is the one other file this
  // door opens for: the reminder repeats the whole invoice, the original is not in the books, and
  // this tap is the owner deciding — deliberately, once — to book the cost from it.
  const isReminderDoc = doc.ai_doc_type === DOC_TYPE_REMINDER;
  if (!isSkippedDocType(doc.ai_doc_type) && !isReminderDoc) {
    return NextResponse.json({
      error: "Dit bestand is geen mislukte factuurlezing — alleen bestanden die wij niet konden lezen, kunnen opnieuw gelezen worden.",
    }, { status: 409 });
  }
  if (!doc.file_url) {
    return NextResponse.json({ error: "Bij dit bestand is geen bestand opgeslagen." }, { status: 409 });
  }

  // [SEC-STORAGE-PATH] Ownership is proven of the ROW; file_url is a column, so the path it points
  // at is proven of nothing. The pipeline client bypasses the bucket policy.
  const storagePath = toStoragePath(doc.file_url);
  if (!pathBelongsToOwner(storagePath, user.id)) {
    console.error("[SEC-STORAGE-PATH] refused a path outside the authorized owner", { id, storagePath, callerId: user.id });
    return NextResponse.json({ error: "Kon het bestand niet lezen" }, { status: 403 });
  }
  const pipeline = createPipelineClient();
  const { data: blob, error: dlErr } = await pipeline.storage.from("documents").download(storagePath);
  if (dlErr || !blob) {
    console.error("[TWEEDE-KANS] download failed", { id, storagePath, dlErr });
    return NextResponse.json({ error: "Kon het bestand niet lezen." }, { status: 502 });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  // The type from the CONTENT, never from the stored string: a file that arrived with a wrong or
  // empty media type is exactly the kind that failed the first read.
  const isEInvoice = looksLikeInvoiceXmlBytes(buffer);
  const mimeType = isEInvoice
    ? E_INVOICE_XML_MIME
    : (sniffReadableMime(buffer) ?? doc.file_type ?? "application/octet-stream");

  // [E-FACTUUR-GRATIS] An e-invoice costs no model call, so it may not spend a document from the
  // month. This is the case that matters most here: every UBL invoice filed as 'unsupported_type'
  // before the app could read one is recoverable at no cost.
  const gate = await gateFairUseForRead({
    client: supabase, userId: user.id, metric: "aiDocuments", costsAiCall: !isEInvoice,
  });
  if (!gate.allowed) return gate.response!;

  const { data: me } = await supabase
    .from("profiles").select("company_name, full_name, kvk_number, btw_number, iban")
    .eq("id", user.id).maybeSingle();

  let v: Awaited<ReturnType<typeof verifyInvoiceFromPdf>>;
  try {
    v = await verifyInvoiceFromPdf(user.id, buffer.toString("base64"), mimeType, doc.file_name ?? "document", 
      me?.company_name?.trim() || me?.full_name?.trim() || null, {
        throwOnTransient: true,
        receiverKvk: me?.kvk_number?.trim() || null,
        receiverBtw: me?.btw_number?.trim() || null,
        receiverIban: me?.iban?.trim() || null,
        // [EIGEN-NUMMER] Recognise the owner's own outgoing invoice by its number, even when the
        // reader mis-assigned the parties (the case the identity fields above cannot catch).
        lookupOwnInvoice: makeOwnInvoiceLookup(supabase, user.id),
      });
  } catch (e) {
    // [FAIR-USE] A failure is not a reading. Give the document back before answering.
    await gate.release();
    console.error("[TWEEDE-KANS] read failed", { id, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "We konden dit bestand nu niet lezen. Probeer het zo meteen opnieuw." }, { status: 503 });
  }

  const decision = decideFromAi({
    is_invoice: v.is_invoice, document_kind: v.document_kind, is_paid: v.is_paid,
    paid_method: v.paid_method ?? null, paid_date: v.paid_date ?? null,
    paid_evidence: v.paid_evidence ?? null, paid_card_last4: v.paid_card_last4 ?? null,
    confidence: v.confidence,
    // [HERINNERING-NOOIT] On a filed reminder the owner's tap IS the decision to book it, so the
    // router's reminder exit is switched off here and nowhere else. The row stays flagged below.
    is_reminder: isReminderDoc ? false : (v.is_reminder ?? null),
  });
  if (decision.destination !== "invoice" && decision.destination !== "receipt") {
    // Still not an invoice. The reading HAPPENED and is charged — the same rule the re-read button
    // follows — and nothing about the document changes, so a second attempt after a better reader
    // arrives is still possible.
    return NextResponse.json({
      ok: true, booked: false,
      message: "Wij lezen hier nog steeds geen factuur in. Het bestand blijft gewoon in je bestanden staan.",
    });
  }

  const invoiceDate = normalizeToIso(v.invoice_date ?? null);
  // The same semantic gate the upload door applies: this file may have been booked another way in
  // the meantime — by hand, or from a second copy that arrived by post. Booking it again is a
  // double cost and a double voorbelasting claim.
  // [DEDUP-SOFT] Of de dubbelcheck ÜBERHAUPT heeft kunnen kijken. supabase-js gooit niet: een
  // mislukte probe geeft `data: null`, en `?? []` maakt daar "geen kandidaat" van — dus precies de
  // uitkomst "deze factuur staat er nog niet in", op de enige plek waar dat oordeel telt. De
  // toelichting drie regels hierboven noemt de kosten al bij naam ("a double cost and a double
  // voorbelasting claim"); zonder deze vlag kon dit pad die kosten stilzwijgend maken.
  //
  // /api/intake en /api/email/upload dragen deze vlag allebei al; dit was het derde pad naar
  // dezelfde tafel en het enige dat hem niet meenam.
  let dedupCheckFailed = false;
  const dup = await findSemanticDuplicate(
    {
      invoiceNumber: v.invoice_number, vendor: v.vendor,
      totalIncBtw: v.total_inc_btw ?? v.amount, invoiceDate: v.invoice_date,
    },
    async (q) => {
      let query = supabase
        .from("invoices").select("id, invoice_number, client_name")
        .eq("receiver_id", user.id).eq("direction", "incoming").eq("total_inc_btw", q.total);
      if (q.dateIso) query = query.eq("invoice_date", q.dateIso);
      const { data, error: dedupErr } = await query
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false }).limit(200);
      if (dedupErr) dedupCheckFailed = true;
      return pickDedupMatch(data ?? [], q);
    },
  );
  if (dup.duplicate && dup.match) {
    return NextResponse.json({
      ok: true, booked: false, duplicate: true,
      message: "Deze factuur staat al in je administratie — hij is dus niet nog een keer geboekt.",
    });
  }

  // Always the verify queue. This file failed a reading once already and the owner asked for a
  // second attempt; landing it straight in the books would be the app being surer than the history
  // of this particular document warrants.
  const fieldConfidence = (v.field_confidence ?? {}) as Record<string, unknown>;
  // [HERINNERING-NOOIT] Booked from a reminder on purpose — the card says so, and auto-advance
  // never touches it: this is the one invoice in the books whose only paper is a dunning letter.
  if (isReminderDoc || v.is_reminder === true) {
    fieldConfidence._safecore = mergeSafecore(fieldConfidence, {
      reminder: true, reminder_of: v.reminder_of_invoice_number ?? null, booked_from_reminder: true,
    });
  }
  fieldConfidence._tweede_kans = { at: new Date().toISOString(), was: doc.ai_doc_type };

  // [DEDUP-SOFT] Kon de dubbelcheck niet kijken, dan gaat dat mee de rij in. De factuur landt hoe
  // dan ook in de controlewachtrij, dus er kijkt een mens naar — maar zonder deze vlag ziet die
  // mens niets dat hem vertelt dat de check niet gedraaid heeft, en "hij stond er niet in" en "we
  // konden niet kijken" zien er op zijn kaart precies hetzelfde uit.
  if (dedupCheckFailed) {
    const gemarkeerd = markDuplicateCheckUnavailable(fieldConfidence) as Record<string, unknown> | null;
    if (gemarkeerd?._safecore) fieldConfidence._safecore = gemarkeerd._safecore;
  }

  // [LEVERANCIER-INTAKE] Een tweede lezing is een gewone binnenkomst: dezelfde twee stappen in
  // dezelfde volgorde als op de andere paden — eerst kijken of we deze leverancier al onder een
  // ánder rekeningnummer kennen, dan pas de registratie raadplegen. Zonder de eerste stap zou het
  // oplossen een rij aanmaken op precies het nummer waar de vraag over ging.
  //
  // Dit pad liet supplier_id leeg terwijl het vendor_iban wél opschreef, en het is juist de weg
  // die een overgeslagen bestand alsnog binnenhaalt — de factuur die het hardst een leverancier
  // nodig heeft, kreeg er als enige geen.
  const leverancier = await resolveSupplierAtIntake(pipeline, user.id, {
    name: v.vendor,
    iban: v.vendor_iban ?? null,
    kvk: v.vendor_kvk ?? null,
    btw: v.vendor_btw ?? null,
  });
  if (Object.keys(leverancier.safecore).length > 0) {
    fieldConfidence._safecore = mergeSafecore(fieldConfidence, leverancier.safecore);
  }

  const { data: invoice, error: insErr } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null, receiver_id: user.id, direction: "incoming", status: "processing",
      supplier_id: leverancier.supplierId,
      // [TWEEDE-KANS-BRON] "upload", not "reread". invoices.source is a CLOSED vocabulary
      // (created | email | upload | camera) and every other insert in the app writes one of those;
      // this route was the only place inventing a fifth value, so its INSERT was rejected and the
      // route answered 500 — on the only recovery path a skipped file has. The provenance is not
      // lost: the audit row two blocks down records action 'invoice.reread_from_document', which
      // says more precisely what happened than a source value ever did.
      source: "upload", client_name: leverancier.supplierName || v.vendor || "Onbekende afzender",
      // [BTW-NUMMER-BEWAARD] Zie de intake-route: op een inkoopfactuur is dit het nummer van de
      // leverancier, en zonder deze regel bleef de EU-inkopenlijst leeg.
      client_btw_number: supplierBtwForInvoice(fieldConfidence._vendor_btw_printed as string | undefined, v.vendor_btw ?? null),
      invoice_date: invoiceDate,
      due_date: deriveDueDate(invoiceDate, v.due_date ?? null, v.payment_term_days ?? null),
      invoice_number: v.invoice_number?.trim() || null,
      invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
      tax_kind: v.tax_kind ?? null, // [AANSLAG]
      total_ex_btw: v.total_ex_btw ?? 0, btw_amount: v.btw_amount ?? 0,
      total_inc_btw: v.total_inc_btw ?? v.amount ?? 0,
      pdf_url: doc.file_url, document_id: doc.id,
      vendor_iban: v.vendor_iban ?? null, payment_reference: v.payment_reference ?? null,
      field_confidence: fieldConfidence as InvoiceFieldConfidence,
    })
    .select("id").single();
  // [ONTVANGEN] A lost race is not a failure, and it is not a licence either.
  //
  // The guard at the top of this route reads doc.invoice_id and refuses when it is set. That read
  // and this insert are not one operation, so two taps can both pass it — and until
  // uq_invoices_document_id exists, the loser silently books a SECOND invoice for one document.
  // With the index the loser gets 23505 instead, and the right answer is to adopt the invoice the
  // winner made rather than to tell an owner their file failed.
  //
  // But ONLY when the document itself proves it. A 23505 can come from any uniqueness rule in this
  // table, and swallowing an unrelated one would report success for a booking that never happened.
  // So the conflict is resolved by looking for an invoice that names THIS document and belongs to
  // THIS owner; anything else falls through to the ordinary failure below.
  let booked: { id: string } | null = invoice
  if (insErr && (insErr as { code?: string }).code === "23505") {
    const existing = await findInvoiceForDocument(doc.id, user.id, pipeline)
    if (existing.kind === "found") {
      // The reading DID happen and did cost a model call, so the allowance is not given back.
      console.warn("[TWEEDE-KANS] a concurrent read won the race — adopting its invoice", { id, invoiceId: existing.invoiceId });
      booked = { id: existing.invoiceId }
    }
  }
  if (!booked) {
    // [FAIR-USE] Same rule as the read failure above, and it was missing here: a reading that
    // produced nothing storable is not a reading. Without this every failed attempt cost the owner
    // a document from their monthly allowance — and this branch failed on EVERY attempt.
    await gate.release();
    console.error("[TWEEDE-KANS] insert failed", { id, error: insErr?.message });
    return NextResponse.json({ error: "De factuur kon niet worden opgeslagen." }, { status: 500 });
  }

  // The document is no longer unread: link it and clear the marker, so it leaves the skipped panel
  // and stops being counted as something nobody looked at.
  await pipeline.from("documents")
    .update({ invoice_id: booked.id, ai_doc_type: v.document_kind ?? "invoice", ai_processed: true })
    .eq("id", doc.id).eq("user_id", user.id);

  await logAuditAction({
    userId: user.id, action: "invoice.reread_from_document",
    entityType: "invoice", entityId: booked.id,
    oldValue: { document_id: doc.id, ai_doc_type: doc.ai_doc_type },
    newValue: { status: "processing", source: "reread", free: isEInvoice },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true, booked: true, invoice_id: booked.id,
    message: "Gelukt — deze staat nu in je controlewachtrij.",
  });
}
