// src/app/api/invoice/bulk-pdf/route.ts
// [BULK-PDF] Take several invoices away at once, as pdf.
//
// ── WHAT WAS MISSING ──
//
// Reported plainly: "I want to download invoices as pdf, but I have to open each one, open the pdf
// and press save — far too many steps." Both lists already let the owner select several rows; what
// they could not do afterwards is take them.
//
// ── THE ONE RULE THAT DECIDES EVERYTHING HERE ──
//
// A SENT invoice already has a pdf, and that stored file is the document the customer received. It
// is the evidence. Re-drawing it from the lines would produce a document that merely LOOKS like
// the one that was sent — a logo since changed, an address since corrected, a template since
// improved — and hand it over as if it were the original. So the stored file wins whenever there
// is one, and rendering is only ever the fallback for an invoice that never had one (a draft, or
// one created before the pdf was stored).
//
// That is also why nothing here writes: a download may not repair, backfill or normalise anything.
// It answers with what exists.
//
// ── PURCHASE INVOICES TOO ──
//
// direction 'incoming' works the same way and is even simpler: the supplier's own document is the
// only truth there, so a missing one is reported rather than invented. We never draw a supplier's
// invoice ourselves — that would be manufacturing someone else's paperwork.

import { NextRequest, NextResponse } from "next/server";
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import JSZip from "jszip";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [ACTING-FOR] An employee downloading for the owner reads the owner's invoices, exactly as their
// screens show the owner's invoices.
import { getActingFor } from "@/lib/acting-for-server";
import { invoiceOwnerId } from "@/lib/acting-for";
import { isUnknownColumn } from "@/lib/created-by";
import { planBulkPdf, bulkZipName, BULK_PDF_MAX } from "@/lib/invoice-bulk-pdf";
import { renderInvoicePdf } from "@/lib/invoice-pdf-server";
// [CREDITNOTA-EXTERN] The linked original first, the typed external reference second.
import { creditReferenceOf } from "@/lib/creditnota";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = invoiceOwnerId(acting);
  const supabase = await createServerSupabaseClient();

  let body: { ids?: unknown; direction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  const direction = body.direction === "incoming" ? "incoming" : "outgoing";

  // The cap is checked on what was ASKED for, before a single row is read: an owner who selected
  // three hundred rows should hear so immediately, not after the database has fetched them.
  if (ids.length === 0) {
    return NextResponse.json({ error: "Selecteer eerst de facturen die je wilt downloaden." }, { status: 400 });
  }
  if (ids.length > BULK_PDF_MAX) {
    return NextResponse.json(
      { error: `Je kunt er ${BULK_PDF_MAX} tegelijk downloaden. Selecteer er minder en herhaal het daarna voor de rest.` },
      { status: 400 },
    );
  }

  // Ownership is a WHERE, never a filter applied afterwards: the ids come from a client.
  const ownerColumn = direction === "incoming" ? "receiver_id" : "sender_id";
  // [IN-CHUNK] Gechunkt. De 503 hieronder was er al en is precies goed — maar bij een selectie van
  // een paar honderd facturen wás de kale `.in()` de reden dat hij afging, en dat is juist de
  // download waarvoor de eigenaar de knop indrukt.
  // [BULK-PDF-VOLLEDIG] Every column renderInvoicePdf reads, not the five the file naming needs.
  // See the select below for what the short list cost.
  let rows: Array<{
    id: string; invoice_number: string | null; client_name: string | null;
    pdf_url: string | null; direction: string | null; invoice_type: string | null;
    invoice_date: string | null; due_date: string | null; delivery_date: string | null;
    client_address: string | null; client_postal_code: string | null; client_city: string | null;
    client_email: string | null; client_btw_number: string | null;
    total_ex_btw: number | null; btw_amount: number | null;
    original_invoice_id: string | null;
    // [KLANT-LAND] Absent on an installation behind on client_country.sql — see the second read.
    client_country?: string | null;
    // [CREDITNOTA-EXTERN] The invoice a standalone creditnota corrects — absent behind
    // creditnota_external_reference.sql, same second read.
    credited_invoice_number?: string | null;
    credited_invoice_date?: string | null;
  }> | null = null;
  let error: { message: string } | null = null;
  try {
    rows = await fetchAllRowsForIds(ids, (chunk, from, to) =>
      // [KLANT-LAND] client_country is newer than the generated types — the same cast every new
      // column gets, on the READ only; the row type above says what comes back.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("invoices")
        // [BULK-PDF-VOLLEDIG] These five were everything the ZIP's file NAMES need — and the
        // same row is handed to renderInvoicePdf when there is no stored pdf, which reads fifteen.
        // The ten that were missing are not decoration:
        //
        //   · invoice_type — `(invoice.invoice_type as string) || 'factuur'` in invoice-pdf.tsx,
        //     so a CREDITNOTA was re-drawn as a "Factuur" with an amount owed. Measured: the
        //     bytes came out the same length as a factuur (3283) and 96 longer than the
        //     creditnota it actually is (3187);
        //   · client_address / postal_code / city / btw_number and invoice_date — art. 35a Wet OB
        //     requires the customer's name and address, the date and the BTW on an invoice. A
        //     document without them is not one;
        //   · original_invoice_id — the creditnota's reference to the invoice it corrects, which
        //     it must carry and which an accountant matches the pair on. It is an ID, not the
        //     number the PDF prints, so it is resolved below;
        //   · total_ex_btw / btw_amount — the header figures the totals block prints.
        //   · client_country — [KLANT-LAND] the country line under a foreign customer's city
        //     (art. 35a lid 1 sub c). Newer than some installations, so a read that fails on
        //     exactly this column is repeated below without it: a missing migration costs the
        //     country line in the archive, never the archive.
        .select("id, invoice_number, client_name, pdf_url, direction, invoice_type, invoice_date, due_date, delivery_date, client_address, client_postal_code, client_city, client_email, client_btw_number, total_ex_btw, btw_amount, original_invoice_id, client_country, credited_invoice_number, credited_invoice_date")
        .in("id", chunk)
        .eq(ownerColumn, ownerId)
        .eq("direction", direction)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    // [CREDITNOTA-EXTERN] The same second read covers the two reference columns: one migration
    // behind on any of the three costs that column in the archive, never the archive.
    if (isUnknownColumn(e, "client_country") || isUnknownColumn(e, "credited_invoice_number") || isUnknownColumn(e, "credited_invoice_date")) {
      try {
        rows = await fetchAllRowsForIds(ids, (chunk, from, to) =>
          supabase
            .from("invoices")
            .select("id, invoice_number, client_name, pdf_url, direction, invoice_type, invoice_date, due_date, delivery_date, client_address, client_postal_code, client_city, client_email, client_btw_number, total_ex_btw, btw_amount, original_invoice_id")
            .in("id", chunk)
            .eq(ownerColumn, ownerId)
            .eq("direction", direction)
            .order("id", { ascending: true })
            .range(from, to),
        );
      } catch (e2) {
        error = { message: e2 instanceof Error ? e2.message : "read failed" };
      }
    } else {
      error = { message: e instanceof Error ? e.message : "read failed" };
    }
  }
  if (error) {
    // [NO-SILENT-EMPTY] A failed read is not "none of these exist". Handing back an empty archive
    // over a hiccup would tell the owner their invoices have no documents.
    return NextResponse.json(
      { error: "We konden deze facturen nu niet ophalen — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  const invoices = rows ?? [];
  if (invoices.length === 0) {
    return NextResponse.json({ error: "Deze facturen zijn niet gevonden." }, { status: 404 });
  }

  // [BULK-PDF-VOLLEDIG] A creditnota states WHICH invoice it corrects — the PDF prints the number
  // and the date, and an accountant matches the pair on them. The row carries only the id, so the
  // originals are resolved in one read and attached before anything is drawn. Ownership is a WHERE
  // here too: these ids come from rows the caller already owns, but the lookup must not become a
  // way to read someone else's invoice number.
  const originalIds = [...new Set(invoices.map((i) => i.original_invoice_id).filter((v): v is string => !!v))];
  const originals = new Map<string, { invoice_number: string | null; invoice_date: string | null }>();
  if (originalIds.length > 0) {
    // [IN-CHUNK] Chunked, like the read above it and for the same reason: a bare .in() past a few
    // hundred ids dies with a 414 that supabase-js reports as an ordinary error, so the caller
    // reads a failed call as "no rows". On this read that would mean every creditnota in a large
    // download quietly losing its reference — which is exactly the failure the enrichment exists
    // to prevent. The repo's own gate caught this line.
    try {
      const originalRows = await fetchAllRowsForIds(originalIds, (chunk, from, to) =>
        supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date")
          .in("id", chunk)
          .eq(ownerColumn, ownerId)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const r of originalRows) originals.set(r.id, r);
    } catch {
      // Best-effort by design, and the ONLY read in this route that is: a creditnota whose
      // original cannot be resolved still prints as a creditnota with its own number and totals.
      // Failing the whole download over the reference would withhold documents the owner is
      // entitled to — and unlike the profile and the lines, this one cannot make a document look
      // like something it is not.
    }
  }
  const enriched = invoices.map((i) => {
    const origin = i.original_invoice_id ? originals.get(i.original_invoice_id) : undefined;
    // [CREDITNOTA-EXTERN] A standalone creditnota carries its reference itself, as typed.
    const ref = creditReferenceOf({
      linkedNumber: origin?.invoice_number,
      linkedDate: origin?.invoice_date,
      creditedNumber: i.credited_invoice_number,
      creditedDate: i.credited_invoice_date,
    });
    return {
      ...i,
      original_invoice_number: ref.originalNumber,
      original_invoice_date: ref.originalDate,
    };
  });

  const plan = planBulkPdf(invoices);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  // The sender's own details, once — every rendered invoice carries the same ones.
  // [NO-SILENT-EMPTY] The outcome is READ. This was `const { data: profile }` with the error
  // dropped, and `profile ?? {}` below — so a failed read drew every invoice in the ZIP without a
  // company name, KVK number, BTW number or IBAN, and reported the archive as complete. Those are
  // the sender's legally required details (art. 35a Wet OB); a document without them is not an
  // invoice, and it is the copy the owner keeps for seven years.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("company_name, full_name, email, phone, address, postal_code, city, kvk_number, btw_number, iban, kor_active, vat_exempt_activity, vat_statement_note")
    .eq("id", ownerId)
    .maybeSingle();
  if (profileError || !profile) {
    return NextResponse.json(
      { error: "We konden je bedrijfsgegevens niet ophalen, dus de facturen zouden zonder je naam en KVK-nummer worden getekend. Probeer het zo opnieuw." },
      { status: 503 },
    );
  }

  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  /** Named, never counted: "3 of the 8 could not be included" is a number nobody can act on. */
  const missing: string[] = [];

  for (const inv of enriched) {
    const name = plan.names.get(inv.id)!;
    const stored = String(inv.pdf_url ?? "").trim();

    // 1. The stored file — the document that was actually sent, and therefore the evidence.
    if (stored) {
      const { data: blob } = await supabase.storage.from("documents").download(stored);
      if (blob) {
        files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        continue;
      }
    }

    // 2. A purchase invoice has no second source. Drawing one ourselves would be manufacturing the
    // supplier's paperwork, so it is reported by name instead.
    if (direction === "incoming") {
      missing.push(inv.invoice_number || name);
      continue;
    }

    // 3. Our own invoice with no stored pdf — a draft, or one from before pdfs were kept. Drawn
    // from its own lines, which is exactly what the screen would have shown.
    try {
      // [NO-SILENT-EMPTY] Likewise. `lines ?? []` on a failed read drew an invoice with no lines
      // and EUR 0,00 totals, pushed it into the ZIP, and counted it as one of the files that
      // succeeded — an empty document is indistinguishable from a real one to whoever opens the
      // archive a year later. A read that failed is a MISSING invoice, and missing[] names it.
      const { data: lines, error: linesError } = await supabase
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", inv.id)
        .order("id", { ascending: true });
      if (linesError) throw new Error(`invoice_lines: ${linesError.message}`);
      const bytes = await renderInvoicePdf(inv, lines ?? [], profile);
      files.push({ name, bytes: new Uint8Array(bytes) });
    } catch (e) {
      console.error("[BULK-PDF] rendering one invoice failed", {
        userId: ownerId, invoiceId: inv.id, error: e instanceof Error ? e.message : String(e),
      });
      missing.push(inv.invoice_number || name);
    }
  }

  // Nothing at all: say so, and say which. An empty archive is the worst possible answer — it
  // downloads, it opens, and it is empty.
  if (files.length === 0) {
    return NextResponse.json(
      {
        error:
          "Van deze facturen konden we geen enkel document ophalen. " +
          (missing.length ? `Het gaat om: ${missing.join(", ")}.` : ""),
      },
      { status: 404 },
    );
  }

  // One file → the pdf itself. Nobody should unpack an archive for a single invoice.
  if (files.length === 1 && missing.length === 0) {
    return new NextResponse(new Uint8Array(files[0].bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${files[0].name}"`,
        // [BULK-PDF] What could not be included travels in a header, because the body is the file
        // itself. The screen reads it and says so; without it a short archive looks complete.
        "X-Bulk-Missing": "0",
      },
    });
  }

  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bulkZipName()}"`,
      "X-Bulk-Missing": String(missing.length),
      // Names, not just a count — encoded because a header may not carry arbitrary bytes.
      "X-Bulk-Missing-Names": encodeURIComponent(missing.join(", ")),
    },
  });
}
