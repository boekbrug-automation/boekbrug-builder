// src/app/api/invoice/audit/route.ts
// [NAREKENEN] "Reken mijn boeken na" — re-check the amounts that are ALREADY booked against the
// documents they came from.
//
// ── THE GAP THIS CLOSES ──
// [GEGROND] gave every amount an independent witness: for a text PDF, either the number occurs in
// the document's own characters or it does not. But it runs at IMPORT, so it says nothing about the
// invoices that were already in the books — which is precisely the set an owner doubts. Being told
// "everything from today onwards is verified" does not answer "is what is in there now right?".
//
// ── IT WRITES EVIDENCE. IT NEVER WRITES A FIGURE. ──
// Not one amount, date, status or BTW field is touched, and that is not caution for its own sake.
// An audit that can also "fix" what it finds is an audit whose results cannot be checked; and on a
// booked invoice a silent correction moves a figure that may already sit in a filed aangifte. The
// owner is told what was found. What to do about it is theirs, through the correction paths that
// already exist (Bedragen corrigeren, Opnieuw inlezen).
//
// The only write is field_confidence._grounding — the verdict itself — so a second run does not
// have to redo the work, and so the verify screen can show the result on the row.
//
// ── FREE, AND HONEST ABOUT WHAT IT SKIPPED ──
// The mechanical witness needs characters, so this reads the stored PDF's text layer: no AI call, no
// cost, nothing to rate-limit but the storage reads. A photographed receipt has no text, and the OCR
// witness costs an API call per document — running that across a whole administration would be a
// bill nobody asked for. Those come back UNCHECKED and the report says so out loud, because
// "everything checks out" while silently skipping the photographs is a claim about documents nobody
// opened.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { ownedStoragePath } from "@/lib/storage-path";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { readPdfTextLayer } from "@/lib/pdf-text";
import { sniffReadableMime } from "@/lib/detect-file";
// [NAREKENEN-FOTO] The same blind transcription the import path uses — exported, never copied.
import { transcribeStoredDocumentAmounts } from "@/lib/ai";
// [EERLIJK-DEUR] The same monthly allowance every other AI read comes off — see the note at the
// transcription call for why this route needed it and why the gate sits inside the loop.
import { gateFairUse } from "@/lib/fair-use-gate";
import { groundMoneyFields } from "@/lib/amount-grounding";
// [E-FACTUUR-NAREKENEN] De leverancier stuurde zijn eigen cijfers mee — die zijn na te rekenen
// zonder iets te lezen. Zonder dit belandde juist die factuur in "konden wij niet controleren".
import { extractEmbeddedInvoiceXml, parseEInvoice, looksLikeInvoiceXmlBytes } from "@/lib/e-invoice";
import { summarizeAudit, type AuditedInvoice } from "@/lib/books-audit";
import { requireOwner } from "@/lib/owner-only";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many documents one run downloads. A whole quarter fits; a whole history is several runs. */
const MAX_PER_RUN = 300;

/** [NAREKENEN-FOTO] AI reads one run may spend. Each is a real cost; the owner is told the number. */
const MAX_PHOTOS_PER_RUN = 40;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  { const w = await requireOwner('De bedragen van geboekte inkoopfacturen narekenen'); if (w.response) return w.response }

  const limited = await checkRateLimit({
    userId: user.id,
    endpoint: "invoice-audit",
    ...RATE_LIMITS.DOCUMENTS_REPROCESS,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const body = await req.json().catch(() => ({}));
  const year = Number((body as { year?: unknown }).year);
  const scopedYear = Number.isInteger(year) && year > 2000 && year < 2100 ? year : null;
  // [NAREKENEN-FOTO] Opt-in, never a default. The text-layer half is free; this half is one AI read
  // per photograph, and a bill the owner did not ask for is not a feature. The screen asks first and
  // says how many, so the flag arriving here means a human saw the number and said yes.
  const includePhotos = (body as { includePhotos?: unknown }).includePhotos === true;

  const pipeline = createPipelineClient();

  // Confirmed purchase invoices only. A row still in the verify queue is about to be looked at by a
  // human anyway, and its grounding was already computed at import.
  let invoices: Array<{
    id: string; invoice_number: string | null; client_name: string | null;
    total_inc_btw: number | null; total_ex_btw: number | null; btw_amount: number | null;
    document_id: string | null; field_confidence: unknown;
  }>;
  try {
    invoices = await fetchAllRows((from, to) => {
      const q = pipeline.from("invoices")
        .select("id, invoice_number, client_name, total_inc_btw, total_ex_btw, btw_amount, document_id, field_confidence")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .in("status", ["received", "paid"]);
      const scoped = scopedYear
        ? q.gte("invoice_date", `${scopedYear}-01-01`).lte("invoice_date", `${scopedYear}-12-31`)
        : q;
      return scoped.order("id", { ascending: true }).range(from, to);
    });
  } catch (e) {
    // [NO-SILENT-EMPTY] A failed read must never come back as "nothing to check" — on a screen whose
    // entire purpose is to say whether the books are right, that reads as a clean bill of health.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[NAREKENEN] invoice lookup failed", { userId: user.id, error: message });
    return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
  }

  const withDoc = invoices.filter((i) => !!i.document_id).slice(0, MAX_PER_RUN);
  const truncated = invoices.filter((i) => !!i.document_id).length - withDoc.length;

  // Resolve the storage paths in one chunked read.
  const docPaths = new Map<string, string>();
  if (withDoc.length > 0) {
    try {
      const docs = await fetchAllRowsForIds<{ id: string; file_url: string | null }, string>(
        withDoc.map((i) => i.document_id as string),
        (chunk, from, to) =>
          pipeline.from("documents").select("id, file_url")
            .eq("user_id", user.id).in("id", chunk)
            .order("id", { ascending: true }).range(from, to),
      );
      // [SEC-STORAGE-PATH] The read above proves the RECORD is this user's; `file_url` is still
      // ordinary text on a row they may UPDATE, and the download below runs on the service-role
      // client, which bypasses the bucket policy. An unattributable key is dropped here, so the
      // invoice simply has no document to re-read — the same state as a row without one, which
      // this route already handles.
      for (const d of docs) {
        const pad = ownedStoragePath(d.file_url, user.id);
        if (pad) docPaths.set(d.id, pad);
      }
    } catch (e) {
      console.error("[NAREKENEN] document lookup failed", { userId: user.id, error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
    }
  }

  const audited: AuditedInvoice[] = [];
  // [NAREKENEN-FOTO] photosDone counts the AI reads SPENT (the ceiling), photosChecked counts the
  // ones that produced a verdict. They differ when a transcription comes back unusable, and the
  // report needs the second: telling an owner "40 photos checked" when 6 of them answered nothing
  // is the kind of number that makes the whole report worthless.
  let photosDone = 0;
  let photosChecked = 0;
  // [EERLIJK-DEUR] Stopped because the month's allowance ran out, not because of the cap above.
  // Reported separately: "we stopped at 40, ask again" and "your free reads are gone until the
  // 1st" are different sentences with different ways out, and one must never be shown for the
  // other.
  let photosOutOfAllowance = false;

  for (const inv of withDoc) {
    const path = inv.document_id ? docPaths.get(inv.document_id) : null;
    let text: string | null = null;
    // Kept from the SAME download the text layer was read from: fetching the file twice would double
    // the storage traffic and could see two different objects if one were replaced mid-run.
    let bytes: Buffer | null = null;
    let mime: string | null = null;
    if (path) {
      try {
        const { data } = await pipeline.storage.from("documents").download(path);
        if (data) {
          const buf = Buffer.from(await data.arrayBuffer());
          bytes = buf;
          mime = sniffReadableMime(buf);
          // Only a PDF has a text layer to read. An image returns null here, which is exactly the
          // 'unreadable' the report counts separately — never a failed check.
          text = (await readPdfTextLayer(buf)).text;
        }
      } catch {
        // A file that will not download is not evidence about the invoice. It falls through as
        // unreadable, which is the honest answer.
      }
    }

    const amounts = {
      totalIncBtw: inv.total_inc_btw, totalExBtw: inv.total_ex_btw, btwAmount: inv.btw_amount,
    };
    let grounding = groundMoneyFields(amounts, text, "text");

    // [E-FACTUUR-NAREKENEN] Ask the supplier's own file first, when the document is one.
    //
    // This was the report's blind spot, and it pointed at exactly the wrong document. A Peppol XML
    // has no PDF text layer, so readPdfTextLayer answered null and the invoice landed in
    // "we could not check this one" — the same bucket as a blurry photograph — for the ONE class
    // this app can verify exactly, mechanically, at no cost. The owner was told the app could not
    // look at the invoice it knows best.
    //
    // Direct comparison, not a search: the file STATES the total, so "does the stored figure equal
    // it to the cent" is the whole question. A disagreement here is the strongest finding this
    // report can produce — the supplier's own file contradicts what is in the books — and it was
    // invisible until now.
    if (bytes) {
      const xml = mime === null && looksLikeInvoiceXmlBytes(bytes)
        ? bytes.toString("utf8")
        : mime === "application/pdf"
          ? await extractEmbeddedInvoiceXml(bytes)
          : null;
      const figures = xml ? parseEInvoice(xml) : null;
      if (figures) {
        const agrees = (stored: number | null, stated: number) =>
          typeof stored === "number" && Number.isFinite(stored) &&
          Math.abs(Math.abs(stored) - Math.abs(stated)) <= 0.01;
        grounding = {
          totalIncBtw: agrees(inv.total_inc_btw, figures.totalIncBtw) ? "found" : "absent",
          totalExBtw: agrees(inv.total_ex_btw, figures.totalExBtw) ? "found" : "absent",
          btwAmount: agrees(inv.btw_amount, figures.btwAmount) ? "found" : "absent",
          source: "e-invoice",
        };
      }
    }

    // [NAREKENEN-FOTO] No text layer: the mechanical witness has nothing to read. With the owner's
    // consent we ask the blind transcription instead — the same call the import path makes, exported
    // rather than copied so the two can never drift into measuring different things.
    //
    // Capped hard, and the cap is reported. An owner who says yes to "40 foto's" must not discover
    // afterwards that it read four hundred. Every refusal below is silent about the invoice and
    // leaves it 'unreadable', which is the honest answer when the check did not run.
    if (
      includePhotos &&
      grounding.totalIncBtw === "unreadable" &&
      photosDone < MAX_PHOTOS_PER_RUN &&
      typeof inv.total_inc_btw === "number" && Number.isFinite(inv.total_inc_btw) &&
      bytes && mime
    ) {
      // [EERLIJK-DEUR] This is an AI READ of a stored document — the same call the import path
      // makes, on the same kind of file, at the same imageDocument cost. So it comes off the same
      // monthly allowance as every other read (intake, e-mail, bank). It did not, and that was
      // measured rather than assumed: this route imports from @/lib/ai and never reached the gate,
      // so a month's free reads could be spent here without the counter moving once.
      //
      // Inside the loop, not once per request: one call to this route transcribes up to
      // MAX_PHOTOS_PER_RUN documents. A single reservation at the top would charge one and read
      // forty — which is the bypass wearing a gate.
      //
      // A refusal STOPS the photographs and never fails the audit. The invoice stays 'unreadable',
      // which the note above already calls "the honest answer when the check did not run", and the
      // text half of the report is unaffected. Same shape as photosCapped, for the same reason.
      // NOT `continue`: the invoice still belongs in the report, as 'unreadable'. Skipping the
      // loop body would drop it from `audited` altogether, and an invoice missing from a report is
      // a worse answer than an invoice the report admits it could not check.
      const photoGate = await gateFairUse({ client: supabase, userId: user.id, metric: "aiDocuments" });
      if (!photoGate.allowed) {
        photosOutOfAllowance = true;
      } else {
        photosDone++;
        const transcribed = await transcribeStoredDocumentAmounts(bytes.toString("base64"), mime);
        // /eerlijk-gebruik §3: a failed attempt never lands on the owner's bill. An unusable
        // transcription is exactly that — nothing was learned, so nothing is charged.
        if (transcribed) grounding = groundMoneyFields(amounts, transcribed, "ocr");
        else await photoGate.release();
      }
    }
    if (grounding.source === "ocr") photosChecked++;

    audited.push({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      clientName: inv.client_name,
      totalIncBtw: inv.total_inc_btw,
      verdict: grounding.totalIncBtw,
      // Which witness spoke. The report may not present "the characters say so" and "the supplier's
      // own file says so" in one sentence — they are not the same claim.
      source: grounding.source,
    });

    // The ONLY write, and it is evidence: the verdict, merged into field_confidence beside whatever
    // is already there. Every money field, the date and the status are untouched — see the header.
    const merged = {
      ...(inv.field_confidence && typeof inv.field_confidence === "object" ? inv.field_confidence : {}),
      _grounding: grounding,
    };
    const { error: wErr } = await pipeline
      .from("invoices")
      // jsonb: the generated types model it as a recursive Json union, which a typed object does not
      // satisfy structurally. Cast at the boundary only — `merged` itself is built from real values.
      .update({ field_confidence: merged } as never)
      .eq("id", inv.id)
      .eq("receiver_id", user.id);
    if (wErr) {
      // Storing the verdict is a convenience, not the result. The owner still gets the answer in
      // this response, so a failed write is logged and never turns into a wrong report.
      console.warn("[NAREKENEN] could not store the verdict", { invoiceId: inv.id, error: wErr.message });
    }
  }

  const summary = summarizeAudit(audited);
  return NextResponse.json({
    ok: true,
    summary: {
      confirmed: summary.confirmed,
      confirmedByEInvoice: summary.confirmedByEInvoice,
      unchecked: summary.unchecked,
      examined: summary.examined,
      mismatched: summary.mismatched,
    },
    // Named rather than silently dropped: a cap the owner cannot see is a report that claims to
    // cover more than it did.
    truncated,
    // [NAREKENEN-FOTO] What the photo half actually did. Reported even when zero, so "we did not
    // look at your photographs" is a statement the owner reads rather than an absence they infer.
    photosChecked,
    photosCapped: includePhotos && photosDone >= MAX_PHOTOS_PER_RUN,
    // [EERLIJK-DEUR] Distinct from photosCapped: the month's free reads ran out. The way out is
    // the 1st of next month or Plus, not "run it again".
    photosOutOfAllowance,
    // Invoices with no stored document at all cannot be checked against anything, and that is a
    // different gap with its own fix ([ORIGINEEL] — "Origineel toevoegen").
    withoutDocument: invoices.length - (withDoc.length + truncated),
  });
}
