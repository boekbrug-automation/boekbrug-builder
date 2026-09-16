// src/app/api/email/reimport/[id]/route.ts
// [REIMPORT] Re-read a stored incoming-invoice PDF with the CURRENT extractor and refresh the
// SAME invoice row. This is the owner's self-heal for a mis-read invoice (wrong amount, a
// statement booked as an invoice, a creditnota blanked to €0) after the extractor improves.
//
// THREE SAFETY GUARDS (money-truth):
//   1. [REREAD-CONFIRMED] Never overwrite work that is no longer ours to overwrite — no money
//      booked, not processed by the accountant, not archived. The rule is reimportDecision() in
//      @/lib/reimport-eligibility, shared with both screens so a button never opens on a refusal.
//      It deliberately covers 'received' as well as 'processing': a CONFIRMED, UNPAID invoice on
//      the pay list is exactly where a misread amount is about to cost money, and refusing there
//      left "type the numbers yourself" as the only way out on paper the app is holding.
//   2. Same row, never a duplicate — UPDATE by id (+ receiver_id + status guard), never INSERT.
//   3. Never auto-verify — a re-read never confirms anything. A queued invoice stays queued; a
//      CONFIRMED one goes BACK to the queue, so the fresh numbers land in front of a human before
//      anyone pays them. Same rule the old guard was protecting, applied instead of refused.
// The re-read result never leaves the owner's account and never marks anything paid/shared.

import { NextRequest, NextResponse } from "next/server";
// [DEUR-VANGNET] Eén vangnet voor elke deur waar een document binnenkomt.
import { withCrashNet } from "@/lib/route-crash-net";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { classifyAttachment } from "@/lib/email-integration";
import { evaluateArithmetic, deriveDueDate } from "@/lib/safecore";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
// [READING-MEMORY] Feed the reader what the owner keeps correcting at this supplier.
import { readingPromptHint } from "@/lib/reading-memory";
import { makeOwnInvoiceLookup } from "@/lib/own-invoice-lookup";
import { loadReadingMemory } from "@/lib/reading-memory-source";
// [SEC-STORAGE-PATH] Normalise a stored value AND decide whose bytes it names — one tested place.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path";
import { gateFairUseForRead } from "@/lib/fair-use-gate";
import { isEInvoiceXmlMime } from "@/lib/e-invoice";
// [REIMPORT-CARRY] De regel over wat een herlezing bewaart en wat zij opnieuw bepaalt.
import { buildReimportFieldConfidence } from "@/lib/reimport-carry";
// [REREAD-CONFIRMED] Who may be read again, and what happens to the one that is — one rule.
import { reimportDecision, btwRowsReadDecision } from "@/lib/reimport-eligibility";
// [HERLEES-ARCHIVEER] Blijkt het geen factuur, dan archiveren we hem zelf — maar nooit als er geld
// op staat. Dezelfde predicaat als de negeer-route, zodat de twee niet uit elkaar kunnen lopen.
import { hasSettledMoney } from "@/lib/invoice-removal";
// [MODEL-CONFIG] Eén plek die weet welk model deze app leest en wat "dit model bestaat hier niet"
// betekent. CLAUDE_MODEL is het bewezen basismodel van de sync; dit is de terugval van as 2.
import { CLAUDE_MODEL } from "@/lib/ai";
import { resolveModel, isModelUnavailableError, isAiConfigError, MODEL_UNAVAILABLE_MESSAGE } from "@/lib/ai-model";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];

// [REREAD-STRONG] De handmatige "Opnieuw inlezen" houdt langs TWEE assen een voorsprong op de
// automatische lezing van een vastgelopen factuur:
//
//   1. preferRawPdf — lees de ECHTE paginaopmaak in plaats van platgeslagen tekst. Dit is de as die
//      complexe facturen redt (statiegeld/retour, netto-negatieve creditnota, volgepropte
//      meerkolomstabellen), en zij hangt NIET aan het model.
//   2. Eventueel een sterker model dan waar de sync op draait.
//
// [MODEL-CONFIG] As 2 stond hier als een MET DE HAND INGETYPT id ("claude-sonnet-5"), met een
// comment erboven dat de sync "al op Sonnet 4.5" las. Dat comment was onjuist — ai.ts draait op de
// Haiku-standaard zolang CLAUDE_MODEL leeg is (en die staat leeg in .env.example) — en het id was
// niet vrijgegeven op dit account. Elke tik op de knop werd dus een HTTP 404, en de eigenaar kreeg
// "probeer het later opnieuw" te zien bij een fout waar later nooit ging komen.
//
// Precies deze fout stond al beschreven in ai.ts, mét de reparatie ernaast: instelbaar met een
// bewezen standaard eronder. Die reparatie wordt nu ook hier gebruikt. Standaard leest de
// herlezing dus met HETZELFDE model als de sync — as 1 blijft volledig overeind, en dat is de as
// die het werk doet. Wil je een sterker model proberen: zet REREAD_MODEL in de omgeving. Blijkt dat
// id niet beschikbaar, dan valt deze route zelf terug op het basismodel (zie readWithFallback) —
// de knop blijft dus werken, ook bij een verkeerd ingestelde variabele.
const REREAD_MODEL = resolveModel(process.env.REREAD_MODEL, CLAUDE_MODEL);

// [REREAD-STRONG] A raw-PDF (visual-layout) read is slower than the flattened-text path — give the
// route headroom so a heavy invoice doesn't get killed mid-read. Cap still depends on the plan.
export const maxDuration = 120;

// [HUNT-Q4] Identify a file by its magic bytes — authoritative over a filename/extension
// guess. Returns null when the header isn't one the classifier can read (leave the guess).
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf"; // %PDF
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif"; // GIF8
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * [MODEL-CONFIG] De lezing is niet gelukt — zeg WAAROM, en zeg vooral niet het verkeerde.
 *
 * Hier zat de tweede helft van de storing. Elke mislukking, ook een 404 op een niet-vrijgegeven
 * model, kwam eruit als "probeer het later opnieuw". Dat is dezelfde oneerlijkheid die deze app
 * overal bestrijdt: een BLIJVENDE fout vermomd als een tijdelijke. De eigenaar drukt dan tien keer
 * op een knop die per definitie nooit gaat werken, en niemand komt erachter dat er een instelling
 * fout staat.
 *
 * Twee uitkomsten, twee zinnen:
 *   · een configuratiefout (model niet vrijgegeven, sleutel/rechten) → 503, en de melding zegt
 *     ronduit dat opnieuw proberen niet helpt;
 *   · al het andere (druk, netwerk, tijdslimiet) → 502 en de oude, hier juiste zin.
 *
 * De factuur blijft in beide gevallen ongewijzigd in de controlewachtrij staan.
 */
function refuseRead(
  error: unknown,
  invoiceId: string,
  gate: { release: () => Promise<unknown> },
): Promise<NextResponse> | NextResponse {
  const configError = isAiConfigError(error);
  console.error("[REIMPORT] classify failed", { invoiceId, configError, error });
  // [FAIR-USE] Niet gelezen, dus niet geteld.
  return gate.release().then(() =>
    configError
      ? NextResponse.json({ error: MODEL_UNAVAILABLE_MESSAGE, code: "model_unavailable" }, { status: 503 })
      : NextResponse.json({ error: "Kon de factuur nu niet opnieuw lezen — probeer het later opnieuw." }, { status: 502 }),
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withCrashNet(
    "REIMPORT",
    "Er ging iets mis bij het opnieuw inlezen. De factuur staat er nog precies zoals hij stond — " +
      "er is niets aan gewijzigd. Probeer het zo meteen opnieuw.",
    () => runReimport(req, ctx),
  )
}

async function runReimport(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // [SPLIT-ALSNOG] Two acts share this route because they share every safety step before the read:
  // ownership of the row, ownership of the storage PATH, the mime sniff, the rate limit and the
  // fair-use gate. Copying that sequence into a second route would copy the security work, and the
  // copy that drifts is always the one nobody is looking at.
  //
  //   default          — the full re-read: fresh amounts, fresh dates, back to the queue.
  //   onlyBtwRows      — read the document again and take ONLY the per-rate btw block. No amount,
  //                      no total, no status, no direction. One key: field_confidence._btw_rows.
  //
  // The second one exists because 29 invoices in the live administration carry a blended btw rate
  // with no such block — € 2.758,01 of voorbelasting on which the only check that can catch a
  // mis-read never ran — and all of them predate the reader that can read one. The full re-read
  // cannot fix them: it replaces amounts that are, on those invoices, exactly what the paper says.
  let onlyBtwRows = false;
  try {
    const body = await req.json().catch(() => null);
    onlyBtwRows = !!(body && typeof body === "object" && (body as { onlyBtwRows?: unknown }).onlyBtwRows === true);
  } catch { /* no body is the ordinary full re-read */ }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [SECURITY] Rate-limit the manual re-read: every call runs an expensive Sonnet vision read on the
  // raw PDF, so an unbounded endpoint lets one session burn AI budget. Uses the AI_OCR limits config
  // (240/hr); the counter is keyed by (user, endpoint), so it's this endpoint's own bucket — a
  // separate 240/hr allowance from the upload path, both bounding per-user AI spend.
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/email/reimport", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

  // [FAIR-USE-TE-VROEG] Het maandhek stond hiér, en dat was te vroeg. gateFairUse VERBRUIKT
  // meteen (fair-use-gate.ts → consumeFairUse); teruggeven kan alleen via gate.release(), en dat
  // gebeurde uitsluitend als de AI-call zelf stukliep. Tussen deze plek en die call liggen ZES
  // weigeringen — factuur niet gevonden, verkeerde richting, al geverifieerd, geen bestand
  // gekoppeld, een pad buiten de eigenaar, en een mislukte download — die de eigenaar elk een
  // document van zijn maandtegoed kostten zonder dat er ooit iets gelezen werd. De vaakste is
  // "al geverifieerd": precies wat je krijgt als je opnieuw-inlezen tikt op een factuur die
  // intussen is goedgekeurd, dus de knop rekende af voor werk dat hij weigerde te doen.
  //
  // /eerlijk-gebruik §3 belooft letterlijk "mislukte pogingen komen nooit op jouw rekening". Het
  // hek staat nu vlak vóór de AI-call, zoals /api/intake en /api/eft/import het al doen.

  // Load + prove ownership. Keep the current values so a poorer re-read can't wipe metadata.
  const { data: invoice } = await supabase
    .from("invoices")
    // [HERLEES-ARCHIVEER] amount_paid meegenomen: het auto-archiveren hieronder mag nooit een
    // factuur wegzetten waarop al (deels) betaald is.
    // [REREAD-CONFIRMED] accountant_status rides along because reimportDecision reads it. Left out
    // of the projection it is simply undefined, and the accountant lock it feeds could never fire —
    // a guard gathered and then never given its input is the defect this file keeps closing.
    .select("id, receiver_id, direction, status, accountant_status, pdf_url, document_id, client_name, invoice_number, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid, field_confidence")
    .eq("id", id)
    .single();

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }
  // GUARD 1 — [REREAD-CONFIRMED] one shared predicate, re-checked here on the server. The screens
  // use the same function to decide whether to offer the button at all, so an owner never taps
  // something that then refuses them.
  // [SPLIT-ALSNOG] A different act asks a different question. Every refusal in reimportDecision
  // exists because a re-read changes what the owner pays or what the accountant has processed; the
  // narrow read changes neither, and a paid invoice is exactly where an unverifiable deduction is
  // worth the most to check. Both predicates live in one module so a screen and this route can
  // never disagree about what is on offer.
  if (onlyBtwRows) {
    const mag = btwRowsReadDecision(invoice);
    if (!mag.allowed) {
      return NextResponse.json(
        { error: mag.message, code: mag.reason },
        { status: mag.reason === "not_incoming" ? 400 : 409 },
      );
    }
  }
  const eligibility = onlyBtwRows ? { allowed: true as const, returnsToQueue: false } : reimportDecision(invoice);
  // Narrowed here rather than at the write: reimportDecision only allows 'processing' or
  // 'received', so this is the value the TOCTOU guard below must re-assert.
  const statusAtRead = (invoice.status ?? "") as string;
  if (!eligibility.allowed) {
    return NextResponse.json(
      { error: eligibility.message, code: eligibility.reason },
      { status: eligibility.reason === "not_incoming" ? 400 : 409 },
    );
  }
  if (!invoice.pdf_url) {
    return NextResponse.json({ error: "Geen bestand gekoppeld aan deze factuur" }, { status: 404 });
  }

  // Media type + filename from the linked document; fall back to the stored path's extension
  // (older rows may have no document_id) so an image invoice isn't misread as a PDF.
  let mimeType = "";
  let filename = "factuur.pdf";
  if (invoice.document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("file_type, file_name")
      .eq("id", invoice.document_id)
      .maybeSingle();
    if (doc?.file_type) mimeType = doc.file_type;
    if (doc?.file_name) filename = doc.file_name;
  }
  if (!mimeType) {
    const ext = invoice.pdf_url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1] ?? "";
    mimeType =
      ext === "png" ? "image/png"
      : (ext === "jpg" || ext === "jpeg") ? "image/jpeg"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : "application/pdf";
  }

  // Receiver identity — so the extractor never returns US as the vendor.
  let receiverName: string | null = null;
  let receiverKvk: string | null = null;
  let receiverBtw: string | null = null;
  let receiverIban: string | null = null;
  {
    const { data: me } = await supabase
      .from("profiles")
      .select("company_name, full_name, kvk_number, btw_number, iban")
      .eq("id", user.id)
      .maybeSingle();
    receiverName = me?.company_name?.trim() || me?.full_name?.trim() || null;
    // [RECEIVER-IDENTITY] our own legal numbers → backstop drops any vendor field equal to ours.
    receiverKvk = me?.kvk_number?.trim() || null;
    receiverBtw = me?.btw_number?.trim() || null;
    receiverIban = me?.iban?.trim() || null;
  }

  // Download the stored bytes. Storage bucket RLS is separate from table RLS; ownership is
  // already proven above, so the pipeline client is used only to read this one proven file.
  const storagePath = toStoragePath(invoice.pdf_url);
  // [SEC-STORAGE-PATH] "Ownership is already proven above" was proven of the ROW, not of the path
  // it points at — and pdf_url is writable by the very caller whose row this is. The pipeline
  // client bypasses the bucket policy, so without this the caller could name another tenant's key
  // and have its bytes read (and, worse, re-imported onto their own invoice). See storage-path.ts.
  if (!pathBelongsToOwner(storagePath, invoice.receiver_id)) {
    console.error("[SEC-STORAGE-PATH] refused to read a path outside the authorized owner", {
      invoiceId: id, receiverId: invoice.receiver_id, storagePath, callerId: user.id,
    });
    return NextResponse.json({ error: "Kon het bestand niet lezen" }, { status: 403 });
  }
  const pipeline = createPipelineClient();
  const { data: blob, error: dlErr } = await pipeline.storage.from("documents").download(storagePath);
  if (dlErr || !blob) {
    console.error("[REIMPORT] download failed", { invoiceId: id, storagePath, dlErr });
    return NextResponse.json({ error: "Kon het bestand niet lezen" }, { status: 500 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  // [HUNT-Q4] The magic bytes are authoritative over the filename/extension guess above —
  // a legacy image invoice on an extension-less path would otherwise be read as a PDF and
  // fail the classifier's PDF-magic check. Override the mime when the bytes are unambiguous.
  const sniffed = sniffMime(buf);
  if (sniffed) mimeType = sniffed;
  const base64 = buf.toString("base64");

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek bovenaan (checkRateLimit)
  // gaat over snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een
  // weigering pauzeert alleen dit ene opnieuw-inlezen — de factuur blijft gewoon in de
  // controlewachtrij staan met wat er al van bekend is.
  //
  // Het staat hier en niet bovenaan: dit is de laatste regel vóór de enige handeling die ons per
  // stuk geld kost. Zie [FAIR-USE-TE-VROEG] boven.
  // [E-FACTUUR-GRATIS] Re-reading an e-invoice costs no AI call — verifyInvoiceFromPdf answers it
  // from the XML. It must not spend a document from the month's allowance either.
  const gate = await gateFairUseForRead({
    client: supabase, userId: user.id, metric: "aiDocuments",
    costsAiCall: !isEInvoiceXmlMime(mimeType),
  });
  if (!gate.allowed) return gate.response!;

  // [READING-MEMORY] The manual re-read is exactly the moment this matters most: the owner asked
  // for another try because the first one was wrong, and the memory knows which field that tends to
  // be at this supplier. Loaded once — `read` may be called twice on a model fallback.
  const readingHint = readingPromptHint(await loadReadingMemory(supabase, user.id));

  // Re-read with the CURRENT extractor (same path the import uses → identical behaviour).
  const read = (model: string) =>
    classifyAttachment(user.id, base64, mimeType, filename, receiverName, {
      model,
      // [REREAD-STRONG] As 1 — nooit weglaten, ook niet in de terugval. Dit is wat de handmatige
      // herlezing onderscheidt van de automatische, en het hangt niet aan het model.
      preferRawPdf: true,
      receiverKvk,
      receiverBtw,
      receiverIban,
      readingHint,
      // [EIGEN-NUMMER] Recognise the owner's own outgoing invoice by its number, even when the
      // reader mis-assigned the parties (the case the identity fields above cannot catch).
      lookupOwnInvoice: makeOwnInvoiceLookup(supabase, user.id),
    });

  let c: Awaited<ReturnType<typeof classifyAttachment>>;
  try {
    c = await read(REREAD_MODEL);
  } catch (e) {
    // [MODEL-CONFIG] Is het INGESTELDE model er niet, dan is dat een instelling die fout staat —
    // geen reden om de eigenaar met lege handen weg te sturen. As 1 (de opmaaklezing) werkt op elk
    // model, dus lezen we die ene keer over met het bewezen basismodel en de knop doet gewoon zijn
    // werk. Twee voorwaarden, allebei nodig:
    //   · alleen bij een MODELfout — bij een sleutel-/rechtenfout gaat dezelfde sleutel het tweede
    //     keer net zo hard stukgaan, en dan is de herkansing een gegarandeerd verspilde betaalde
    //     call (isAiCredentialError zit daarom bewust NIET in deze voorwaarde);
    //   · alleen als er iets anders te proberen valt — staat REREAD_MODEL niet ingesteld, dan is
    //     het al het basismodel en zou dit dezelfde call nog eens doen.
    const canFallBack = REREAD_MODEL !== CLAUDE_MODEL && isModelUnavailableError(e);
    if (canFallBack) {
      // Luid, en op ERROR-niveau: dit is een verkeerd ingestelde REREAD_MODEL en dat hoort de
      // beheerder te zien. De eigenaar merkt er niets van — voor hem is de factuur gewoon gelezen.
      console.error("[MODEL-CONFIG] REREAD_MODEL is niet beschikbaar op dit account — teruggevallen op het basismodel", {
        rereadModel: REREAD_MODEL, baseModel: CLAUDE_MODEL, invoiceId: id,
        message: e instanceof Error ? e.message : String(e),
      });
      try {
        c = await read(CLAUDE_MODEL);
      } catch (e2) {
        return refuseRead(e2, id, gate);
      }
    } else {
      return refuseRead(e, id, gate);
    }
  }

  // [HERLEES-ARCHIVEER] De verse lezing zegt: dit is geen boekbaar stuk — een rekeningoverzicht,
  // een herinnering, een reclamemail. Voorheen bleef de rij dan staan en vertelde een melding de
  // eigenaar dat hij hem zelf maar moest negeren. Dat is werk verschuiven, niet werk wegnemen: hij
  // heeft net op "opnieuw inlezen" gedrukt precies om dit te laten uitzoeken.
  //
  // Dus archiveren we hem nu zelf, met reden 'geen_factuur' erbij, zodat het Genegeerd-tabblad
  // meteen uitlegt waarom hij daar staat. Dat mag, want archiveren in deze app is omkeerbaar: de
  // rij, het bestand en het nummer blijven zeven jaar staan en één tik zet hem terug. Als de verse
  // lezing het mis had, kost dat de eigenaar één tik — geen document.
  //
  // Twee hekken blijven: GUARD 1 hierboven heeft al vastgesteld dat de factuur nog in de
  // controlewachtrij staat ('processing'), en hasSettledMoney weigert alles waarop al geld is
  // afgeboekt. Geen van beide zou hier mogen voorkomen, maar geld verdwijnt niet op een aanname.
  // [HERLEZING-STIL] "Het is geen factuur" en "ik heb hem niet gelezen" zijn niet hetzelfde, en
  // alleen het eerste rechtvaardigt archiveren.
  //
  // classifyAttachment geeft bij een opgevangen storing — een gesprongen AI-budgetzekering, een
  // model dat niets teruggaf — een TERUGVALANTWOORD terug: isInvoice false met confidence 0. Dat
  // is geen oordeel over het document maar de afwezigheid van een oordeel, en het kwam hier binnen
  // als "geen factuur". Eén gesprongen zekering plus de knop "herlees alles" archiveert dan de hele
  // controlewachtrij — echte facturen, met echte bedragen, om een lezing die nooit gebeurd is.
  //
  // De e-mailkant maakt dit onderscheid al (email-integration.ts: `!isInvoice && !(confidence > 0)`
  // bewaart het bestand als 'could_not_read' in plaats van het weg te zetten). Deze route, die
  // bestaat om een MISLEZING te herstellen, maakte hem niet.
  if (!c.isInvoice && !((c.confidence ?? 0) > 0)) {
    return NextResponse.json({
      ok: false,
      notInvoice: false,
      archived: false,
      reason: c.reason ?? null,
      detail: "We konden dit document nu niet lezen. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
    }, { status: 503 });
  }

  // ── [SPLIT-ALSNOG] The narrow act ends HERE, and that placement is the safety property ────────
  //
  // Everything below this point writes: amounts, dates, status, the archive branch. This mode
  // returns before any of it, so there is exactly one write in this branch and it is one key.
  // Reviewers: the [SPLIT-ALSNOG] gate in lifecycle-gates asserts this return sits above every
  // .update() in this file, because a fall-through here would silently replace the amounts of a
  // PAID invoice — the one thing reimportDecision refuses and this mode deliberately walks past.
  if (onlyBtwRows) {
    // A document the reader no longer recognises as an invoice cannot lend us its btw block. Say so
    // and change nothing — this act never archives, never reclassifies, never touches a figure.
    if (!c.isInvoice) {
      return NextResponse.json({
        ok: false, mode: "btwRows", written: false,
        detail: "We konden op dit document geen btw-specificatie vinden. Er is niets gewijzigd.",
      });
    }

    // The block as the extractor returned it, cleaned exactly the way the import path cleans it.
    // NEVER derived from the stored amounts: two equations reproduce this block to within a dozen
    // cents (a supplier who rounds per line drifts from base x rate), and a derived block agrees
    // with our own figures BY CONSTRUCTION. That is a green tick this app would have awarded itself
    // on the very invoice btw-split.ts was written for. It comes off the paper or it does not come.
    // Straight from the reader, via the same key the import path stores — ai.ts has already
    // validated and cent-rounded these rows ([BTW-SPLIT]), so re-deriving them here would be a
    // second cleaner drifting from the first. Re-checked for shape only: this value crosses a
    // network boundary and a malformed row must never reach the checklist as evidence.
    const gelezen = c.fieldConfidence?._btw_rows;
    const rows = (Array.isArray(gelezen) ? gelezen : []).filter(
      (r): r is { rate: number; base: number; btw: number } =>
        !!r && typeof r === "object" &&
        Number.isFinite(r.rate) && Number.isFinite(r.base) && Number.isFinite(r.btw),
    );

    // An EMPTY array is stored on purpose. "We looked and this invoice prints no per-rate block" is
    // an answer, and storing it stops the owner paying for the same question twice. [NO-SILENT-EMPTY]
    // applies to the screen, not to the record: the sentence below says which of the two happened.
    const basis = (invoice.field_confidence && typeof invoice.field_confidence === "object")
      ? { ...(invoice.field_confidence as Record<string, unknown>) }
      : {};
    basis._btw_rows = rows;

    const { error: schrijfFout } = await supabase
      .from("invoices")
      .update({ field_confidence: basis as InvoiceUpdate["field_confidence"] })
      .eq("id", id)
      .eq("receiver_id", user.id);
    if (schrijfFout) {
      console.error("[SPLIT-ALSNOG] kon de btw-specificatie niet opslaan", { invoiceId: id, error: schrijfFout.message });
      return NextResponse.json(
        { error: "We konden de btw-specificatie niet opslaan. Er is niets gewijzigd." },
        { status: 500 },
      );
    }

    await logAuditAction({
      userId: user.id, action: "invoice.btw_rows_read", entityType: "invoice", entityId: id,
      // No oldValue: nothing was replaced. The trail records that we LOOKED and what we found —
      // which is exactly the claim a later reader of this row needs to be able to check.
      newValue: { _btw_rows: rows }, ipAddress: getClientIP(req),
    });

    return NextResponse.json({ ok: true, mode: "btwRows", written: true, rows });
  }

  if (!c.isInvoice) {
    if (hasSettledMoney({ status: invoice.status, amount_paid: invoice.amount_paid })) {
      return NextResponse.json({
        ok: false,
        notInvoice: true,
        archived: false,
        reason: c.reason ?? null,
        detail: "Er is al betaald op deze factuur, dus hij is niet automatisch verwijderd — draai eerst de betaling terug.",
      });
    }

    const archiveNow = new Date().toISOString();
    const archivePatch: InvoiceUpdate = {
      status: "archived",
      archive_reason: "geen_factuur",
      archived_at: archiveNow,
      updated_at: archiveNow,
    };
    const archive = (patch: InvoiceUpdate) =>
      supabase
        .from("invoices")
        .update(patch)
        .eq("id", id)
        .eq("receiver_id", user.id)
        .eq("status", "processing")
        .select("id");

    // Zelfde terugval als de negeer-route: bestaan archive_reason/archived_at nog niet op deze
    // database, dan archiveren we zonder notitie in plaats van de hele actie te laten mislukken.
    let { data: archived, error: archErr } = await archive(archivePatch);
    if (archErr && (archErr.code === "PGRST204" || archErr.code === "42703")) {
      ({ data: archived, error: archErr } = await archive({ status: "archived", updated_at: archiveNow }));
    }

    if (archErr || !archived || archived.length === 0) {
      // Niet gelukt → eerlijk zeggen dat er niets is veranderd, zoals voorheen.
      return NextResponse.json({
        ok: false,
        notInvoice: true,
        archived: false,
        reason: c.reason ?? null,
      });
    }

    await logAuditAction({
      userId: user.id,
      action: "invoice.status_changed",
      entityType: "invoice",
      entityId: id,
      oldValue: { status: invoice.status },
      newValue: {
        status: "archived",
        archive_reason: "geen_factuur",
        via: "reimport_not_invoice",
        detail: c.reason ?? null,
      },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({
      ok: false,
      notInvoice: true,
      archived: true,
      reason: c.reason ?? null,
    });
  }

  // Build the refresh patch — the extraction-derived fields only. Identity/links (receiver,
  // pdf_url, document_id, source_message_id) are never touched. Metadata (vendor/number/date)
  // keeps the stored value when the fresh read is empty, so a re-read can only improve it.
  // [DOUBLE-CHECK #1] Amounts are IMPROVE-OR-KEEP, never blindly fresh. If the fresh read
  // recognised an invoice but could NOT read a usable total (freshHasTotal false), keep the
  // stored amounts — otherwise a poorer re-read would wipe correct €121/€21/€100 to €0/€0/€0.
  const freshTotal = c.totalIncBtw ?? c.amount;
  const freshHasTotal = typeof freshTotal === "number" && isFinite(freshTotal);

  const verdict = freshHasTotal
    ? evaluateArithmetic(c, { isCreditNote: c.isCreditNote === true })
    : null;
  // [REIMPORT-CARRY] Wat blijft er staan, en wat wordt opnieuw bepaald? Die regel woont in
  // src/lib/reimport-carry.ts, puur en getest — want hier ging het mis: `_safecore` werd in zijn
  // geheel vervangen door het verse rekenoordeel, terwijl er DRIE soorten waarheid in dat ene
  // object wonen. De dubbel-signalen (possible_duplicate*, dedup) gaan over de relatie met een
  // ándere factuur, en deze route draait geen enkele dedup-query — die konden dus niet opnieuw
  // worden afgeleid en verdwenen gewoon. Een factuur met "mogelijk dubbel met X" werd door één
  // druk op deze knop schoon, mocht weer auto-boeken, en dezelfde kostenpost kon een tweede keer
  // de administratie in. De knop die het vertrouwen moest herstellen, wiste juist de waarschuwing.
  const priorFc = (invoice.field_confidence ?? null) as Record<string, unknown> | null;
  const aiConfidence = (c.fieldConfidence ?? null) as Record<string, unknown> | null;
  const fieldConfidenceValue = buildReimportFieldConfidence({
    priorFc,
    aiConfidence,
    freshHasTotal,
    verdict,
    heldAt: new Date().toISOString(),
    // De herinneringsvlag komt WÉL van de verse lezing: een ten onrechte gezette vlag moet te
    // wissen zijn door precies dit middel, anders is hij onherstelbaar.
    freshIsReminder: c.isReminder === true,
    freshReminderOf: c.reminderOfInvoiceNumber ?? null,
  });

  // The effective invoice date the patch writes (fresh-or-keep) — also drives due_date.
  const freshDate = (typeof c.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.invoiceDate))
    ? c.invoiceDate : invoice.invoice_date;

  const patch: InvoiceUpdate = {
    updated_at: new Date().toISOString(),
    total_ex_btw: freshHasTotal ? (c.totalExBtw ?? 0) : invoice.total_ex_btw,
    btw_amount: freshHasTotal ? (c.btwAmount ?? 0) : invoice.btw_amount,
    total_inc_btw: freshHasTotal ? (c.totalIncBtw ?? c.amount ?? 0) : invoice.total_inc_btw,
    invoice_type: c.isCreditNote === true ? "creditnota" : "factuur",
    tax_kind: c.taxKind ?? null, // [AANSLAG]
    vendor_iban: c.vendorIban ?? null,
    payment_reference: c.paymentReference ?? null,
    field_confidence: fieldConfidenceValue as InvoiceUpdate["field_confidence"],
    // Metadata: improve-or-keep (never wipe a good stored value with an empty re-read).
    client_name: (c.vendor && c.vendor.trim()) ? c.vendor.trim() : invoice.client_name,
    invoice_number: (c.invoiceNumber && c.invoiceNumber.trim()) ? c.invoiceNumber.trim() : invoice.invoice_number,
    invoice_date: freshDate,
    // [DOUBLE-CHECK #2] Recompute due_date from the effective date + fresh term, so a
    // corrected invoice date doesn't leave a stale due date driving reminders/overdue.
    due_date: deriveDueDate(freshDate, c.dueDate ?? null, c.paymentTermDays ?? null) ?? invoice.due_date,
    // [REREAD-CONFIRMED] Never auto-verify. A queued invoice keeps its status; a CONFIRMED one is
    // sent BACK to the queue, because its amounts have just been re-read and the owner is about to
    // pay them. Writing fresh machine-read numbers straight onto a payable row would be exactly
    // the silent overwrite the original guard existed to prevent.
    ...(eligibility.returnsToQueue ? { status: "processing" } : {}),
  };

  // GUARD 2 + 3 — update the SAME row, and the status guard makes it a no-op if the invoice
  // was verified/archived between the load and now (TOCTOU-safe: never revives a confirmed row).
  const { data: updated, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    // TOCTOU: re-assert the status we decided on, so a row that was paid or archived between the
    // load and now loses the race instead of being revived.
    .eq("status", statusAtRead)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    // The status guard matched no row — the invoice moved on between the read and the write.
    return NextResponse.json(
      { error: "Deze factuur is intussen gewijzigd — vernieuw de pagina en probeer het opnieuw." },
      { status: 409 }
    );
  }

  // Legal trail: who re-read what, and the resulting amounts.
  await logAuditAction({
    userId: user.id,
    action: "invoice.reimported",
    entityType: "invoice",
    entityId: id,
    oldValue: {
      client_name: invoice.client_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
    },
    newValue: {
      total_ex_btw: patch.total_ex_btw,
      btw_amount: patch.btw_amount,
      total_inc_btw: patch.total_inc_btw,
      invoice_type: patch.invoice_type,
      client_name: patch.client_name,
      invoice_number: patch.invoice_number,
      invoice_date: patch.invoice_date,
      arithmetic_ok: verdict ? verdict.ok : null,
    },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    ok: true,
    // [REREAD-CONFIRMED] Reported, so the screen can say where the invoice went. A row that
    // disappears off the pay list with a bare "gelukt" reads like a lost bill.
    returnedToQueue: eligibility.returnsToQueue,
    invoice: {
      total_ex_btw: patch.total_ex_btw,
      btw_amount: patch.btw_amount,
      total_inc_btw: patch.total_inc_btw,
      invoice_type: patch.invoice_type,
      client_name: patch.client_name,
      invoice_number: patch.invoice_number,
      invoice_date: patch.invoice_date,
      arithmetic_ok: verdict ? verdict.ok : null,
    },
  });
}
