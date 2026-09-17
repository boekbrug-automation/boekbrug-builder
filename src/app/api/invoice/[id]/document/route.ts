// src/app/api/invoice/[id]/document/route.ts
// [ORIGINEEL] Give an invoice that has no original document one.
//
// ── THE LOOP THAT WAS BROKEN AT THE CLIENT'S END ──
// The readiness board counts verified invoices with no stored PDF and says so: "3 facturen missen
// het originele document — de boekhouder kan deze niet controleren". The accountant's "opvragen"
// flow turns that same item into a specific request, by invoice number, sent to the client.
//
// And then the client could do nothing. document_id is written at CREATION — by intake, by the
// e-mail door, by the bank attach — and by NOTHING afterwards. There was no route, no button, no
// path of any kind that could attach a file to an invoice that already existed. The one readiness
// item in the whole report that carried no fix link was this one, and the missing link was not an
// oversight in the report: there was nowhere for it to point.
//
// So an invoice typed in by hand, or one whose upload failed halfway, was permanently unprovable.
// The accountant asks every quarter, the client cannot answer, and neither of them can tell that
// the app is the reason.
//
// ── EVIDENCE ONLY. NEVER A FIGURE. ──
// This is the entire safety contract, and it is what separates this from every other upload door.
// The other doors READ the file with the AI extractor and create an invoice from what they find.
// This one does not read it at all. The invoice already exists; its amounts, its date, its BTW
// were verified by the owner (or by the accountant, who may already have processed it). Re-reading
// the document here would let a misread quietly overwrite a confirmed figure — the most expensive
// possible way to fix a missing attachment.
//
// It writes exactly two things: a documents row, and invoices.document_id/pdf_url. Nothing else on
// the invoice is touched. That is also why the accountant's 'verwerkt' lock does NOT block it: the
// lock exists to protect the figures they booked, and this changes none of them. Refusing here
// would refuse precisely the invoice the accountant asked about — the whole point of the feature.
//
// Replacing an existing document was refused here because it discards evidence. [BETER-EXEMPLAAR]
// now allows it as an explicit, separate act that discards NOTHING: the previous documents row
// stays exactly where it is, and only the pointer moves. See document-replace.ts for the rule,
// including why the accountant's lock blocks a swap while it never blocked filling an empty slot.

import { NextRequest, NextResponse } from "next/server";
// [BETER-EXEMPLAAR] Fill an empty slot, or deliberately swap in a better copy of the same paper.
import { planDocumentSlot } from "@/lib/document-replace";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveImportTarget } from "@/lib/bestanden";
import { computeContentHash } from "@/lib/content-hash";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { sniffReadableMime } from "@/lib/detect-file";
// [ACTING-FOR] A sales member does not do the bookkeeping on a booked purchase invoice — the same
// boundary /api/invoice/[id]/amounts draws for correcting one. See owner-only.ts.
import { requireOwner } from "@/lib/owner-only";
import { gateStorage } from "@/lib/fair-use-gate";

export const dynamic = "force-dynamic";

/** Same ceiling the other upload doors use — a phone photo of a bon is well under it. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  { const w = await requireOwner('Het originele document van een geboekte inkoopfactuur toevoegen'); if (w.response) return w.response }

  // DOCUMENTS_REPROCESS' ceiling would be wrong in both directions here (this costs no AI call,
  // but it does write storage). DOCUMENT_CLASSIFY is the right shape: a file-handling action an
  // owner might legitimately repeat many times in one sitting while clearing a quarter's gaps.
  const limited = await checkRateLimit({
    userId: user.id,
    endpoint: "invoice-document",
    ...RATE_LIMITS.DOCUMENT_CLASSIFY,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "geen_bestand" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bestand_te_groot" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Sniff the BYTES, not the name: a browser reports whatever the OS guessed, and the closing
  // package later resolves this file by extension. A .pdf that is really a HEIC reaches the
  // accountant as something their reader refuses to open — evidence present and unreadable, which
  // for a package handed to someone else is the same as missing.
  const mime = sniffReadableMime(buffer);
  if (!mime) {
    return NextResponse.json({ error: "bestandstype_niet_ondersteund" }, { status: 415 });
  }

  const pipeline = createPipelineClient();

  // [NO-SILENT-EMPTY] Read the error. A failed read that degrades to "no such invoice" would tell
  // the owner their invoice does not exist, on the one screen that just told them it does.
  const { data: invRow, error: invErr } = await pipeline
    .from("invoices")
    .select("id, sender_id, receiver_id, invoice_number, invoice_date, document_id, pdf_url, direction, accountant_status")
    .eq("id", id)
    .maybeSingle();
  if (invErr) {
    console.error("[ORIGINEEL] invoice lookup failed", { userId: user.id, id, error: invErr.message });
    return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
  }
  if (!invRow) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const inv = invRow as {
    id: string; sender_id: string | null; receiver_id: string | null;
    invoice_number: string | null; invoice_date: string | null;
    document_id: string | null; pdf_url: string | null; direction: string | null;
    accountant_status?: string | null;
  };
  if (inv.sender_id !== user.id && inv.receiver_id !== user.id) {
    // Same answer as a missing row: whether someone else's invoice exists is not ours to disclose.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // ── [ORIGINEEL-INKOOP] Only a PURCHASE invoice has an original to attach ──
  //
  // `direction` was selected and never asked. This route's one write puts the uploaded file's key
  // into invoices.pdf_url — and on an OUTGOING invoice that column is not an empty slot waiting for
  // evidence, it is the legal PDF this app rendered and mailed to the customer (art. 35). Attaching
  // here overwrote it with a photo, and the accountant's closing package then ships that photo to
  // them as <invoice_number>.pdf: the document of record replaced by whatever was uploaded, with
  // the invoice's own figures still beside it.
  //
  // The feature this route exists for cannot want that. It answers a readiness item about invoices
  // whose ORIGINAL is missing — a supplier's document the owner typed in by hand, or an upload that
  // failed halfway. An outgoing invoice whose PDF upload failed has its own recovery path and
  // always did: resend, which renders the real thing again.
  if ((inv.direction ?? "incoming") !== "incoming") {
    return NextResponse.json(
      {
        error: "geen_inkoopfactuur",
        message:
          "Dit is een factuur die jij hebt verstuurd. Het originele document daarvan maakt de app zelf — " +
          "je kunt er geen ander bestand voor in de plaats zetten. Ontbreekt de PDF? Verstuur de factuur opnieuw.",
      },
      { status: 400 },
    );
  }
  // [BETER-EXEMPLAAR] Fill, or swap — and swapping only when the owner explicitly said so. The
  // rule and its reasoning live in document-replace.ts, where a test can reach them.
  const slot = planDocumentSlot({
    currentDocumentId: inv.document_id,
    replaceRequested: form.get("replace") === "true",
    accountantStatus: inv.accountant_status ?? null,
  });
  if (!slot.ok) {
    return NextResponse.json({ error: slot.code, detail: slot.error }, { status: 409 });
  }

  const contentHash = computeContentHash(buffer);
  // The same bytes may already be stored — the owner uploaded the bon to their files months ago and
  // is now attaching it to the invoice. Reuse that row rather than storing a second copy: it keeps
  // the (user_id, content_hash) unique index intact, and a second copy of one bon is a second thing
  // to keep for seven years.
  const { data: existingDoc, error: dupErr } = await pipeline
    .from("documents")
    .select("id, file_url")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();
  if (dupErr) {
    console.error("[ORIGINEEL] content-hash lookup failed", { userId: user.id, id, error: dupErr.message });
    return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
  }

  let documentId: string;
  let storagePath: string;

  if (existingDoc) {
    documentId = (existingDoc as { id: string }).id;
    storagePath = (existingDoc as { file_url: string }).file_url;
  } else {
    // [OPSLAG-DEUR] Only in the branch that actually stores something: re-attaching a file the
    // account already holds adds no bytes, and refusing it would be charging for storage twice.
    const space = await gateStorage({ client: supabase, userId: user.id, bytes: buffer.length });
    if (!space.allowed) return space.response!;

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, buffer, { contentType: mime, upsert: false });
    // [R7] A swallowed upload error would leave the invoice pointing at a path holding nothing —
    // evidence that reads as present and cannot be retrieved, which is worse than the gap we came
    // here to close. Fail loudly so the owner retries.
    if (uploadError) {
      console.error("[ORIGINEEL] storage upload failed", { userId: user.id, id, error: uploadError.message });
      return NextResponse.json({ error: "opslaan_mislukt" }, { status: 502 });
    }

    const folderId = await resolveImportTarget(user.id, inv.invoice_date ?? null, "facturen", "user");
    const { data: doc, error: docErr } = await pipeline
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: file.name,
        file_url: storagePath,
        file_size: file.size,
        file_type: mime,
        doc_type: "factuur",
        folder_id: folderId,
        year: inv.invoice_date ? new Date(inv.invoice_date).getUTCFullYear() : null,
        source: "upload",
        // Deliberately NOT ai_processed: nothing read this file. Claiming otherwise would put a
        // document in the books carrying an extraction that never happened.
        ai_processed: false,
        content_hash: contentHash,
      })
      .select("id")
      .single();
    if (docErr || !doc) {
      // Roll the file back — an orphaned object in storage is retention we owe on evidence that
      // belongs to nothing.
      await supabase.storage.from("documents").remove([storagePath]);
      console.error("[ORIGINEEL] documents insert failed", { userId: user.id, id, error: docErr?.message });
      return NextResponse.json({ error: "opslaan_mislukt" }, { status: 500 });
    }
    documentId = (doc as { id: string }).id;
  }

  // The only write on the invoice, and it is deliberately narrow: the two evidence pointers and
  // nothing else. `.is("document_id", null)` makes it a compare-and-set, so two tabs attaching at
  // once cannot leave the second file linked to nothing.
  // [BETER-EXEMPLAAR] The compare-and-set targets what we DECIDED on: null for an empty slot, the
  // exact previous id for a swap. Either way a concurrent change loses honestly instead of
  // overwriting a pointer that moved while this upload was in flight.
  const write = pipeline
    .from("invoices")
    .update({ document_id: documentId, pdf_url: storagePath })
    .eq("id", id);
  const { data: linked, error: linkErr } = await (slot.mode === "replace"
    ? write.eq("document_id", slot.previousDocumentId)
    : write.is("document_id", null)
  ).select("id");
  if (linkErr || !linked || linked.length === 0) {
    console.error("[ORIGINEEL] linking the document to the invoice failed", {
      userId: user.id, id, documentId, error: linkErr?.message ?? "no rows (a concurrent attach won)",
    });
    // The document row stays: it is a real file the owner uploaded and it belongs in their files
    // either way. What failed is the link, and saying so is the honest answer.
    return NextResponse.json({ error: "koppelen_mislukt" }, { status: 409 });
  }

  await logAuditAction({
    userId: user.id,
    // [BETER-EXEMPLAAR] A swap is its own act in the trail. The previous id rides along in
    // newValue below, so a year later it is clear WHICH document the accountant's check referred
    // to — and that it is still there.
    action: slot.mode === "replace" ? "invoice.document_replaced" : "invoice.document_attached",
    entityType: "invoice",
    entityId: id,
    newValue: {
      document_id: documentId,
      ...(slot.mode === "replace" ? { previous_document_id: slot.previousDocumentId, kept: true } : {}),
      invoice_number: inv.invoice_number,
      file_name: file.name,
      reused_existing_file: !!existingDoc,
    },
    ipAddress: getClientIP(req),
  }).catch((e) => {
    console.error("[ORIGINEEL] audit write failed after attaching", {
      userId: user.id, id, error: e instanceof Error ? e.message : String(e),
    });
  });

  return NextResponse.json({ ok: true, documentId });
}
