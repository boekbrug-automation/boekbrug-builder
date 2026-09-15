// src/app/api/email/upload/route.ts
// [BOEK-011] Manual upload for paper/WhatsApp invoices
// POST multipart/form-data with 'file' field
// Claude verifies → if real invoice → stored in Storage + documents + invoices

import { NextRequest, NextResponse } from "next/server";
// [DEUR-VANGNET] Eén vangnet voor elke deur waar een document binnenkomt.
import { withCrashNet } from "@/lib/route-crash-net";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [BOEK-011 + BOEK-SECURITY] invoice insert needs service_role to bypass
// invoices_zzp_insert RLS — that policy expects sender_id = auth.uid(),
// but incoming invoices have sender_id = null.
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { verifyInvoiceFromPdf } from "@/lib/ai";
// [BEWAAR-EERST] The one keep-the-file path, shared with /api/intake and the bank door.
import { storeRawIncoming } from "@/lib/store-raw-incoming";
import { DOC_TYPE_COULD_NOT_READ } from "@/lib/skipped-import";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { resolveImportTarget } from "@/lib/bestanden";
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHash } from "@/lib/content-hash";
import { deriveDueDate, findSemanticDuplicate, normalizeInvoiceNumber, normalizeToIso, normalizeVendor } from "@/lib/safecore";
import { collectPossibleDuplicate, mergePossibleDuplicate, markDuplicateCheckUnavailable } from "@/lib/possible-duplicate-collect";
// [READING-MEMORY] Feed the reader what the owner keeps correcting at each supplier.
import { readingPromptHint } from "@/lib/reading-memory";
import { makeOwnInvoiceLookup } from "@/lib/own-invoice-lookup";
import { loadReadingMemory } from "@/lib/reading-memory-source";
// [DUP-ARCHIVED] Dezelfde eerlijke melding als /api/intake — deze route blijft bereikbaar
// (back-compat), dus hij mag niet iets anders beweren over dezelfde situatie.
import { archivedDuplicateMessage, archivedInvoiceById, archivedInvoiceForDocument } from "@/lib/archived-duplicate";
import { buildFolderBreadcrumb } from "@/lib/documents";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { gateFairUse } from "@/lib/fair-use-gate";
import { escapeLikeValue } from "@/lib/sanitize";
// [DUP-TRASHED] Gedeelde uitzondering op de byte-hash-poort: een weggegooid bestand mag de
// dedup-sleutel niet levenslang bezet houden. Zelfde module als /api/intake gebruikt.
import { trashedDuplicateCleared } from "@/lib/trashed-dedup";
import { supplierBtwForInvoice } from "@/lib/vendor-identity"
// [NUL-GRONDSLAG] What may be stored when the split was not read — see read-amounts.ts.
import { amountsToStore, markUnexplainedZeroBtw } from "@/lib/read-amounts";

export async function POST(req: NextRequest) {
  return withCrashNet(
    "UPLOAD",
    "Er ging iets mis bij het verwerken van dit bestand. Het is NIET opgeslagen — probeer het zo " +
      "meteen opnieuw. Blijft dit gebeuren, laat het ons weten: wij zien de fout aan onze kant.",
    () => runUpload(req),
  )
}

async function runUpload(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [COST] Per-user ceiling on the AI/OCR upload pipeline (Claude calls).
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/email/upload", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

  // [FAIR-USE-TE-VROEG] Het maandhek stond hiér, en dat was te vroeg. gateFairUse VERBRUIKT
  // meteen (fair-use-gate.ts → consumeFairUse); teruggeven kan alleen via gate.release(), en dat
  // gebeurde uitsluitend als de AI-call zelf stukliep. Tussen deze plek en die call liggen VIJF
  // weigeringen — leeg formulier, geen bestand, verkeerd bestandstype, groter dan 10MB, en het
  // byte-hash duplicaat — die de eigenaar elk een document van zijn maandtegoed kostten voor een
  // handeling die ons niets kostte. Bij het duplicaat is dat extra scheef: de opmerking daar
  // zegt zelf "Also saves an AI call on duplicates", dus dat er niets werd uitgelezen was al
  // bekend; alleen de rekening ging toch door.
  //
  // /eerlijk-gebruik §3 belooft letterlijk "mislukte pogingen komen nooit op jouw rekening". Het
  // hek staat nu vlak vóór de AI-call, zoals /api/intake en /api/eft/import het al doen. Alles
  // wat NA die call misgaat telt wél — die leesbeurt is echt gemaakt.

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }

  // [SECURITY] Reject SVG up front (defense-in-depth): an SVG is XML that can carry <script>, so it
  // must never be stored as a viewable "image invoice". The AI media-type allowlist already refuses
  // it downstream, but this closes the gate before any storage write. Match the base type so a
  // parameterized `image/svg+xml; charset=utf-8` and a `.svg` name are both caught.
  const baseType = (file.type || "").toLowerCase().split(";")[0].trim();
  const isSvg = baseType.startsWith("image/svg") || file.name.toLowerCase().endsWith(".svg");
  const okType =
    !isSvg &&
    (baseType === "application/pdf" ||
      baseType.startsWith("image/") ||
      file.name.toLowerCase().endsWith(".pdf"));
  if (!okType) {
    return NextResponse.json(
      { error: "Alleen PDF of afbeelding toegestaan" },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Dit bestand is leeg (0 bytes) — er valt niets te lezen." }, { status: 422 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 });
  }

  // Read file bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");

  // [BRIDGE-EXTRACT] Byte-hash dedup gate — BEFORE AI verify, Storage, and BOTH
  // inserts (documents + invoices). Hash the raw bytes (deterministic). A rejected
  // duplicate must never reach the invoice insert, or we'd block the document but
  // still create an orphan invoice. Cross-path: same hash as email / Mijn bestanden.
  // Reject (Layer 1) — references are Layer 2. Also saves an AI call on duplicates.
  const contentHash = computeContentHash(buffer);

  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id, invoice_id, trashed")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  // [DUP-TRASHED] Botst dit op een bestand dat de eigenaar zelf heeft weggegooid, dan is dit geen
  // duplicaat maar een doodlopende weg: de melding wijst naar een map waar het bestand niet meer te
  // zien is, en deze poort is met opzet niet te forceren. Sleutel vrijgeven en doorlopen als vers
  // bestand; zie trashedDuplicateCleared voor waarom dat een UPDATE is en geen SELECT-filter.
  if (existingDoc && !(await trashedDuplicateCleared(supabase, user.id, existingDoc))) {
    // [BRIDGE-EXTRACT] Full folder path (root→leaf) — folders nest, leaf name
    // alone is ambiguous. Walk parent_id up the chain.
    const folderPath = await buildFolderBreadcrumb(
      supabase,
      user.id,
      existingDoc.folder_id ?? null
    );
    const folderName = folderPath.length ? folderPath[folderPath.length - 1] : null;

    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "manual_upload" },
      ipAddress: getClientIP(req),
    });

    // [DUP-ARCHIVED] Botst dit bestand op een factuur die de eigenaar zelf genegeerd heeft?
    // De blokkade blijft (identieke bytes, niet te forceren) — de melding wijst nu naar Genegeerd.
    const archived = await archivedInvoiceForDocument(supabase, user.id, existingDoc);
    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd";

    return NextResponse.json(
      {
        error: archived ? archivedDuplicateMessage(archived) : where,
        duplicate: true,
        existing: {
          id: existingDoc.id,
          file_name: existingDoc.file_name,
          folder_name: folderName,
          folder_path: folderPath,
        },
        ...(archived ? { archived } : {}),
      },
      { status: 409 }
    );
  }

  // [BRIDGE-EXTRACT] Tell the AI who WE are (the receiver) so it never returns
  // our own company as the vendor. Falls back to full_name, then null.
  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name, kvk_number, btw_number, iban")
    .eq("id", user.id)
    .maybeSingle();
  const receiverName = me?.company_name || me?.full_name || null;

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek bovenaan (checkRateLimit)
  // gaat over snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een
  // weigering pauzeert alleen dit ene automatische uitlezen.
  //
  // Het staat hier en niet bovenaan: dit is de laatste regel vóór de enige handeling die ons per
  // stuk geld kost. Alles wat de route eerder kan weigeren is dan al geweigerd zonder iemands
  // maandtegoed aan te raken. Zie [FAIR-USE-TE-VROEG] boven.
  const gate = await gateFairUse({ client: supabase, userId: user.id, metric: "aiDocuments" });
  if (!gate.allowed) return gate.response!;

  // [BOEK-011] Claude verifies the actual file
  // [RECEIVER-IDENTITY] pass our own KVK/BTW/IBAN so the extractor never returns us as the vendor.
  // [AI-CONFIG-SAFE] throwOnTransient: a config/auth/5xx/network failure must NOT be
  // swallowed into the confidence-0 fallback (is_invoice:false) — that answered a
  // confident "Dit lijkt geen factuur te zijn" during an AI outage. A true infra
  // failure now returns an honest 503 retry message; nothing has been stored yet.
  // (Same fix /api/intake already carries.)
  let verification: Awaited<ReturnType<typeof verifyInvoiceFromPdf>>;
  try {
    verification = await verifyInvoiceFromPdf(base64, file.type, file.name, receiverName, {
      // [READING-MEMORY] See the intake route — fields only, never amounts.
      readingHint: readingPromptHint(await loadReadingMemory(supabase, user.id)),
      receiverKvk: me?.kvk_number || null,
      receiverBtw: me?.btw_number || null,
      receiverIban: me?.iban || null,
      // [EIGEN-NUMMER] Recognise the owner's own outgoing invoice by its number, even when the
      // reader mis-assigned the parties (the case the identity fields above cannot catch).
      lookupOwnInvoice: makeOwnInvoiceLookup(supabase, user.id),
      throwOnTransient: true,
    });
  } catch (aiErr) {
    // [BEWAAR-EERST] The third door, closed with the same helper as the other two.
    //
    // This branch was already config-SAFE — the read throws instead of returning a verdict nobody
    // produced — but it still filed nothing, and its own log line said so: "filing nothing, asking
    // for retry". A reader outage of hours therefore discarded the same document on every attempt.
    // Safe and lossy are different properties, and this route had only the first.
    console.error("[BEWAAR-EERST] upload AI read failed — keeping the file, asking nobody to upload it again", aiErr);
    const keptId = await storeRawIncoming(
      buffer, file, user.id, supabase, DOC_TYPE_COULD_NOT_READ, "upload", { aiProcessed: false },
    );
    // [FAIR-USE] Niet gelezen, dus niet geteld — anders kost een storing van ons de
    // gebruiker een document van zijn maandtegoed.
    await gate.release();
    // A failure status, like the bank door and unlike /api/intake: this route's contract is "add
    // this INVOICE", and no invoice was added. No screen in this repo calls it today, so there is
    // no client whose success handling could be checked — which is itself the reason to answer
    // with the one status no caller can read as a completed booking.
    return NextResponse.json(
      {
        error: keptId
          ? "Automatisch inlezen lukt op dit moment niet. Je bestand is bewaard — je hoeft het niet opnieuw te uploaden. Je vindt het bij Inkomend onder \u201eOvergeslagen bij import\u201d, met een knop om het opnieuw te laten lezen."
          : "We konden dit bestand nu niet lezen én niet bewaren. Bewaar het zelf even en probeer het zo meteen opnieuw.",
        code: "reader_unavailable",
        ...(keptId ? { documentId: keptId, kept: true } : {}),
      },
      { status: 503 }
    );
  }

  // [FAIR-USE §3] Een oordeel dat vóór enige model-aanroep viel (ongeldige PDF) heeft geen
  // lezing verbruikt.
  if (verification.no_ai_call === true) {
    await gate.release();
  }

  if (!verification.is_invoice) {
    // [FAIR-USE §3] "mislukte pogingen komen nooit op jouw rekening" — een afgewezen bestand is
    // geen verbruikte lezing. De 503 hierboven gaf de gate al terug; deze 422 hield hem in.
    if (verification.no_ai_call !== true) await gate.release();
    return NextResponse.json(
      {
        error:
          verification.reason ||
          "Dit lijkt geen factuur te zijn. Alleen facturen kunnen worden toegevoegd.",
        rejected: true,
      },
      { status: 422 }
    );
  }

  // [DEDUP-SEMANTIC / I2] The byte-hash gate above only blocks an IDENTICAL file. A
  // re-photographed paper invoice or a re-generated PDF (different bytes, same bill)
  // slipped past and DOUBLE-BOOKED the cost — intake and email-sync run a graded semantic
  // dedup, but manual upload did not. Run the same check here, with a "toch toevoegen"
  // (force) escape so a genuine second document is never permanently blocked.
  const force = formData.get("force") === "true";
    // [DEDUP-READ-HONEST] Did any duplicate probe fail to RUN? `data ?? []` used to turn "we could not
  // look" into "there is no duplicate" — the one answer that lets a second copy of a bill into the
  // books, cost and voorbelasting counted twice. This path lands in the verify queue, so the invoice
  // is flagged rather than refused: needs-review, held out of "Selecteer klaar", reason on the card.
  let dedupCheckFailed = false;

const dup = await findSemanticDuplicate(
    {
      invoiceNumber: verification.invoice_number,
      vendor: verification.vendor,
      totalIncBtw: verification.total_inc_btw ?? verification.amount,
      invoiceDate: verification.invoice_date,
    },
    async (q) => {
      let query = supabase
        .from("invoices")
        .select("id, invoice_number, client_name")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .eq("total_inc_btw", q.total);
      // [DEDUP-VENDOR-NORM] Geen .ilike op de naam: PostgREST vertaalt een * in de waarde naar %
      // vóór de escape (safecore.ts documenteert de meting), en deze tier blokkeert — dus een
      // acquirer-naam ("SUMUP *CAFE") hield echte bonnen buiten de boeken. Naam hieronder in
      // code, als letterlijke genormaliseerde gelijkheid.
      if (q.dateIso) query = query.eq("invoice_date", q.dateIso);
      // [DEDUP-NUMBER-NORM] Compare the number whitespace-normalized in code (an exact .eq
      // missed "26 / 3958" vs "26/3958"); the candidate set is already pinned by total(+date).
      // [DEDUP-WINDOW] Deterministic order + a wide cap so the number match never falls
      // outside the window (dropping the .eq removed the natural bound).
      const { data, error: dedupErr } = await query.order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }).limit(200);
      if (dedupErr) dedupCheckFailed = true;
      const rows = data ?? [];
      const hit =
        q.tier === "number" && q.invoiceNumber
          ? rows.find((r) => normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber))
          : q.tier === "vendor" && q.vendor
            ? rows.find((r) => normalizeVendor(r.client_name ?? "") === normalizeVendor(q.vendor ?? "") && normalizeVendor(q.vendor ?? "") !== "")
            : rows[0];
      return hit ? { id: hit.id, invoice_number: hit.invoice_number, client_name: hit.client_name } : null;
    }
  );
  if (dup.duplicate && dup.match && !force) {
    // [DUP-ARCHIVED] Wijst de match naar een genegeerde factuur? Zeg dat — anders zoekt de
    // eigenaar zich suf in een lijst waar hij per definitie niet in staat.
    const archived = await archivedInvoiceById(supabase, user.id, dup.match.id);
    return NextResponse.json(
      {
        error: archived
          ? archivedDuplicateMessage(archived)
          : `Deze factuur (${verification.invoice_number ?? "onbekend nummer"}) lijkt al toegevoegd.`,
        duplicate: true,
        semantic: true,
        matchedOn: dup.tier,
        existing: { id: dup.match.id, invoice_number: dup.match.invoice_number },
        ...(archived ? { archived } : {}),
      },
      { status: 409 }
    );
  }
  // [DEDUP-SOFT] Not a CONFIDENT duplicate — but is it a POSSIBLE one? (same amount + date, or
  // same amount + vendor a few days apart, that the hard number/vendor key can't prove). Never
  // blocks: the invoice imports, flagged "mogelijk dubbel met X" for a human glance (and held out
  // of auto-confirm — a possible dup can never be silently booked as a second cost).
  const possibleDup =
    !(dup.duplicate && dup.match)
      ? await collectPossibleDuplicate(
          {
            invoiceNumber: verification.invoice_number,
            vendor: verification.vendor,
            totalIncBtw: verification.total_inc_btw ?? verification.amount,
            invoiceDate: verification.invoice_date,
          },
          async (total) => {
            const { data, error: dedupErr } = await supabase
              .from("invoices")
              .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
              .eq("receiver_id", user.id)
              .eq("direction", "incoming")
              // A cent-wide band, not exact float equality: a legacy row stored as 42.9999… must
              // still be fetched for the cent-precise in-code compare (assessPossibleDuplicate).
              .gte("total_inc_btw", total - 0.005)
              .lte("total_inc_btw", total + 0.005)
              .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
              .limit(200);
            if (dedupErr) dedupCheckFailed = true;
            return data ?? [];
          },
          // [DEDUP-CORRECTED] Invoices already held under THIS number, at ANY amount — the
          // corrected re-issue the amount-anchored query above can never return. ilike without
          // wildcards is an exact, case-insensitive match; a spacing variant is not fetched (the
          // same limit the hard gate's .eq has), and the pure assessor re-checks with full
          // normalization before it flags anything.
          async (invoiceNumber) => {
            const { data, error: dedupErr } = await supabase
              .from("invoices")
              .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
              .eq("receiver_id", user.id)
              .eq("direction", "incoming")
              .ilike("invoice_number", escapeLikeValue(invoiceNumber))
              .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
              .limit(200);
            if (dedupErr) dedupCheckFailed = true;
            return data ?? [];
          },
          // [DEDUP-SOFT] Best-effort BY NAME. This invoice lands in the verify queue, and the
          // callbacks above already record a failed read in dedupCheckFailed →
          // markDuplicateCheckUnavailable, so the human still sees "we konden de dubbelcheck niet
          // uitvoeren". Leaving this off would fail the whole upload over one soft probe.
          { bestEffort: true },
        )
      : null;

  if (dup.duplicate && dup.match && force) {
    // The owner already saw "bestaat al" and chose to add anyway — record the override.
    await logAuditAction({
      userId: user.id,
      action: "invoice.dedup_override",
      entityType: "invoice",
      entityId: dup.match.id,
      newValue: { reason: "user_forced_add", matched_on: dup.tier, invoice_number: verification.invoice_number ?? null, path: "manual_upload" },
      ipAddress: getClientIP(req),
    });
  }

  // Store the file in Supabase Storage
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  // [R7] A swallowed upload error used to let the flow insert an invoice with
  // pdf_url/document_id = null — a counted invoice whose evidence is UNRETRIEVABLE (the
  // closing package resolves an incoming invoice's PDF via document_id). Fail loudly so
  // the owner retries, instead of reporting "ok" over lost evidence. (Mirrors intake R1.)
  if (uploadError) {
    return NextResponse.json(
      { error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." },
      { status: 502 }
    );
  }
  const pdfUrl = storagePath;

  // [DATE-GATE] Honest date: null when none was extracted — no today fallback.
  // The confirm route blocks a null date until the reviewer enters it.
  // [DATE-ISO-SAFE / I6] Tolerant + never-throw (a DD-MM-YYYY used to 500 the upload).
  const invoiceDate = normalizeToIso(verification.invoice_date);

  // [BOEK-011] Resolve correct folder via BOEK-033's function
  // ctx='user' — manual upload, user is logged in (RLS session active)
  // [DATE-ONE-SOURCE] Dezelfde genormaliseerde datum als de rij zelf. De RUWE AI-string ("15-03-2026")
  // is voor resolveImportTarget een Invalid Date, waarna het bestand onder "Geïmporteerde bestanden"
  // belandt terwijl de factuur in maart staat — intake had deze fix al.
  const folderId = await resolveImportTarget(
    user.id,
    invoiceDate,
    "facturen",
    "user"
  );

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      file_name: file.name,
      file_url: storagePath,
      file_size: file.size,
      file_type: file.type,
      doc_type: "factuur",
      folder_id: folderId,
      year: invoiceDate ? new Date(invoiceDate).getFullYear() : null,
      source: "upload",
      ai_processed: true,
      ai_doc_type: "invoice",
      content_hash: contentHash,               // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
    })
    .select("id")
    .single();
  // [R7] The document row IS the evidence link. If it fails to write, roll back the
  // stored file and stop — never create an evidence-less invoice.
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath]);
    // [DEDUP-ATOMIC] A concurrent double-submit that raced past the byte-hash SELECT above trips the
    // (user_id, content_hash) UNIQUE index here (23505). Treat it like the SELECT-found duplicate so
    // no second invoice is created — return a duplicate, not a 500 that invites a retry.
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, file_name, folder_id").eq("user_id", user.id).eq("content_hash", contentHash).limit(1).maybeSingle();
      const folderPath = dup ? await buildFolderBreadcrumb(supabase, user.id, dup.folder_id ?? null) : [];
      const where = folderPath.length ? `Dit bestand staat al in: ${folderPath.join(" / ")}` : "Dit bestand is al toegevoegd";
      return NextResponse.json({
        error: where, duplicate: true,
        existing: dup ? { id: dup.id, file_name: dup.file_name, folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null, folder_path: folderPath } : undefined,
      }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Opslaan van de factuur is mislukt — probeer het opnieuw." },
      { status: 500 }
    );
  }
  const documentId = doc.id;

  // Save the invoice — status 'processing' (the verify queue), awaiting confirmation.
  // (The comment used to say 'received', which is the CONFIRMED state; the insert below
  // has always written 'processing'. Fixed so nobody "corrects" the code to match it.)
  // [BOEK-011 + BOEK-SECURITY] Incoming invoice: receiver_id = user, sender_id = null.
  // Must use service_role: invoices_zzp_insert RLS requires sender_id = auth.uid(),
  // which fails for incoming (sender_id is null — vendor isn't a BoekBrug user).
  const pipeline = createPipelineClient();

  // [SUPPLIER-REGISTRY] Same canonical-supplier resolution as the email-sync path, so a manually
  // uploaded invoice unifies under the same supplier (and adopts its canonical name) instead of
  // creating yet another name variant. Best-effort: null → raw name + null supplier_id.
  const uploadedSupplier = await resolveSupplierForImport(pipeline, user.id, {
    name: verification.vendor,
    iban: verification.vendor_iban ?? null,
    kvk: verification.vendor_kvk ?? null,
    btw: verification.vendor_btw ?? null,
  });

  // [NUL-GRONDSLAG] What may be STORED, decided once. `?? 0` here made an amount that was never
  // read indistinguishable from a real zero, and a zero base on a purchase invoice is a claim that
  // the bill cost nothing — the engine reads kosten off that field.
  const storedAmounts = amountsToStore({
    totalExBtw: verification.total_ex_btw, btwAmount: verification.btw_amount,
    totalIncBtw: verification.total_inc_btw, amount: verification.amount,
  });

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      // [BRIDGE-B] Hold state — not shared with the accountant until the client
      // verifies. 'processing' is excluded from the `shared` GENERATED expression.
      status: "processing",
      source: "upload",
      supplier_id: uploadedSupplier?.id ?? null,
      client_name: uploadedSupplier?.name || verification.vendor || "Onbekende afzender",
      // [BTW-NUMMER-BEWAARD] Op een inkoopfactuur is client_btw_number het nummer van de
      // LEVERANCIER — dezelfde rij draagt zijn naam in client_name. Het werd gelezen en nergens
      // opgeslagen, waardoor de EU-inkopenlijst (icp.ts, rubriek 4b) voor iedereen leeg bleef.
      // Alleen een geldige VORM landt hier; een misvormd nummer blijft staan in
      // _vendor_btw_printed, waar de controlelijst de ondernemer erover vertelt.
      client_btw_number: supplierBtwForInvoice((verification.field_confidence as { _vendor_btw_printed?: string } | null)?._vendor_btw_printed, verification.vendor_btw ?? null),
      invoice_date: invoiceDate,
      // [EXTRACT-DUE-DATE] explicit due date → invoice_date + term → null (honest).
      // This endpoint never set due_date at all, so invoices ingested here had no
      // payment term even when printed on the invoice — absent from Vandaag's
      // date-sorted "Te betalen" list. Same derivation as intake + email-sync.
      due_date: deriveDueDate(invoiceDate, verification.due_date ?? null, verification.payment_term_days ?? null),
      // [BON-NUMMER] Leeg blijft leeg — een verzonnen documentkenmerk landt als factuurnummer in
      // het wettelijke inkoopboek terwijl het audit-spoor null zegt. Intake verwijderde dit al.
      invoice_number: verification.invoice_number || null,
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
      // [PAY-SAFE-EXTRACT] vendor payment details — null when absent. Prepares
      // a future payment (EPC QR / pre-filled); BoekBrug never processes money.
      vendor_iban: verification.vendor_iban ?? null,
      payment_reference: verification.payment_reference ?? null,
      // [BRIDGE-EXTRACT] per-field AI confidence → the modal flags weak fields.
      // [DEDUP-SOFT] Merge the possible-duplicate signal so the verify queue shows "mogelijk
      // dubbel met X" and the invoice is held out of auto-confirm.
      // [NUL-GRONDSLAG] …and the fallback's zero BTW says so, wrapped around whatever the dedup
      // markers left, so no existing note is dropped to make room for it.
      field_confidence: markUnexplainedZeroBtw(
        (dedupCheckFailed
          ? markDuplicateCheckUnavailable(mergePossibleDuplicate(verification.field_confidence ?? null, possibleDup))
          : mergePossibleDuplicate(verification.field_confidence ?? null, possibleDup)) as typeof verification.field_confidence,
        storedAmounts,
        {
          btwRate: verification.btw_rate,
          shifted: (verification.field_confidence as { _btw_verlegd?: unknown } | null)?._btw_verlegd != null,
        },
      ),
      // [DEDUP-CREDITNOTA / I3] A creditnota keeps NEGATIVE amounts (numSigned) and must be
      // TYPED as one, exactly like the email-sync and intake paths — otherwise the read-time
      // health classifier picks the positive-expecting arithmetic gate and a legitimately
      // negative credit reads as an error / aggregates with the wrong sign.
      invoice_type: verification.is_credit_note === true ? "creditnota" : "factuur",
      tax_kind: verification.tax_kind ?? null, // [AANSLAG]
    })
    .select("id")
    .single();

  if (dbError) {
    // [R7/M4] Roll back the document row + stored file so the evidence isn't orphaned —
    // its content_hash would otherwise make the byte-hash dedup BLOCK a re-upload (409),
    // trapping the owner with a file they can neither re-add nor see as an invoice.
    await pipeline.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // [BOEK-011] Link document back to invoice (bidirectional) — same pipeline
  if (invoice?.id) {
    await pipeline
      .from("documents")
      .update({ invoice_id: invoice.id })
      .eq("id", documentId);
  }

  return NextResponse.json({
    ok: true,
    invoice_id: invoice?.id,
    // [DEDUP-SOFT] A soft, non-blocking heads-up so the UI can show "mogelijk dubbel" right away.
    ...(possibleDup
      ? { possibleDuplicate: { invoice_number: possibleDup.match.invoice_number, client_name: possibleDup.match.client_name, reason: possibleDup.reason } }
      : {}),
  });
}