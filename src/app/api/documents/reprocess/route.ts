// src/app/api/documents/reprocess/route.ts
// [REPROCESS] "Book my already-stored files." Files uploaded BEFORE the turnover/ledger/daily-sales
// pipelines existed were filed as opaque documents and never booked. This scans the owner's stored
// documents and runs the SAME deterministic parsers + booking helpers the live upload path uses, so
// a month of kassa/grootboek/dagverkopen files the owner already uploaded lands in daily_turnover /
// ledger_daily WITHOUT re-uploading each one.
//
// Scope = the IDEMPOTENT financial files only:
//   - .xls/.xlsx/.csv  → kassa Z-report → daily_turnover, or PIN/kas grootboek → ledger_daily
//   - .pdf that is an "OMZET VAN …" daily-sales report → daily_turnover (one day)
// Both write via upserts keyed on (user, day[, kind]), so running this repeatedly CORRECTS, never
// doubles. Bank files (.940/MT940/CAMT) are deliberately EXCLUDED: importing transactions is NOT
// idempotent (a re-import would double the bank lines), so those stay on the normal upload path
// which has its own statement-level dedup. Invoice/receipt images/PDFs are left untouched (re-running
// the paid AI read is a separate, cost-bearing action — the owner re-uploads those).
//
// service_role is NOT used for the money writes: the session client (RLS) does the daily_turnover /
// ledger_daily upserts, pinned to the authenticated user — same as /api/intake. Fully audited.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter";
import { planSpreadsheetIngest, ledgerKindLabel } from "@/lib/spreadsheet-ingest";
import { looksLikeDailySalesReport, parseDailySalesReport } from "@/lib/daily-sales-report";
import { bookTurnoverRows, bookLedgerRows } from "@/lib/turnover-book";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { getOriginal } from "@/lib/document-storage";

export const dynamic = "force-dynamic";

// Bound the work so one call can't run unbounded (unpdf text-extraction is local but not free).
const MAX_DOCS = 600;
const MAX_PDF_EXTRACTS = 250;

type FileResult = {
  file: string;
  status: "booked" | "review" | "skip" | "error";
  type?: "turnover" | "ledger";
  message: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [REPROCESS] Het plafond dat deze route als enige zware handeling niet had. Zie de toelichting bij
  // RATE_LIMITS.DOCUMENTS_REPROCESS: één klik haalt tot 600 bestanden uit Storage en leest 250 PDF's.
  // Er komt geen Claude aan te pas, dus geen van de AI-hekken raakte hem ooit.
  const rl = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/documents/reprocess",
    ...RATE_LIMITS.DOCUMENTS_REPROCESS,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  // The owner's stored documents, oldest first (so a partial cap keeps the earliest history).
  //
  // [REPROCESS-ORDER] "Oudste eerst" stond hier al als bedoeling, maar de sortering was
  // `order("id")` — en documents.id is een uuid (gen_random_uuid()). Dat is geen tijdlijn maar een
  // willekeurige volgorde die alleen stabiel is. Dat is hier niet cosmetisch: bookTurnoverRows doet
  // een upsert op (user_id, turnover_date), dus voor een dag die in twee bestanden voorkomt WINT HET
  // BESTAND DAT ALS LAATSTE LANGSKOMT. Met een uuid-volgorde was dat willekeurig: uploadde de eigenaar
  // een gecorrigeerd kassabestand ná het originele, dan kon het ORIGINEEL alsnog als laatste
  // langskomen en zijn correctie overschrijven — stil, want de knop meldt gewoon "geboekt".
  //
  // Op created_at is de belofte onder de knop ("corrigeert, telt nooit dubbel") pas waar: het
  // laatst geüploade bestand is ook het laatst verwerkte. id blijft erbij als tiebreaker, zodat de
  // volgorde totaal is en fetchAllRows veilig kan pagineren (twee rijen kunnen dezelfde created_at
  // hebben; dan zou een pagina een rij kunnen overslaan of dubbel teruggeven).
  //
  // Wat hiermee NIET is opgelost: een dag die de eigenaar met de hand corrigeerde in Dagomzet wordt
  // nog steeds overschreven door het bestand. Dat is een ontwerpvraag (wint het papier of de mens?),
  // geen sorteerfout, en staat los van deze regel.
  //
  // [NO-RESURRECT] Exclude trashed documents — a kassa/grootboek file the owner moved to the
  // prullenbak must NOT be re-booked into daily_turnover/ledger_daily, which would silently
  // resurrect a turnover day the owner deliberately deleted.
  const docs = (await fetchAllRows((from, to) =>
    supabase
      .from("documents")
      .select("id, file_name, file_url")
      .eq("user_id", user.id)
      .eq("trashed", false)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  )) as Array<{ id: string; file_name: string | null; file_url: string }>;

  const results: FileResult[] = [];
  let booked = 0, turnoverDays = 0, ledgerDays = 0, skipped = 0, failed = 0, review = 0;
  let considered = 0, pdfExtracts = 0, capped = false;

  for (const doc of docs) {
    const name = (doc.file_name || "").toLowerCase();
    const isSheet = /\.(xls|xlsx|csv)$/.test(name);
    const isPdf = name.endsWith(".pdf");
    if (!isSheet && !isPdf) continue; // images / bank files / other → not this route's job

    if (considered >= MAX_DOCS) { capped = true; break; }
    considered++;

    // Download the stored bytes (RLS: the query above already pinned to this user's docs).
    let buffer: Buffer;
    try {
      const { data: blob, error } = await getOriginal(supabase, doc.file_url);
      if (error || !blob) { results.push({ file: doc.file_name || doc.file_url, status: "error", message: "kon het bestand niet ophalen" }); failed++; continue; }
      buffer = Buffer.from(await blob.arrayBuffer());
    } catch {
      results.push({ file: doc.file_name || doc.file_url, status: "error", message: "kon het bestand niet ophalen" }); failed++; continue;
    }
    const label = doc.file_name || doc.file_url;

    // Isolate each file: a parse/book failure on ONE document skips that file and continues the
    // batch — never 500s the whole run (which would leave the rest unprocessed with no results).
    try {
    // ── Spreadsheet → turnover / ledger ──────────────────────────────────────────────────
    if (isSheet) {
      let matrix;
      try { matrix = sheetBytesToMatrix(new Uint8Array(buffer)); }
      catch { results.push({ file: label, status: "skip", message: "geen leesbare spreadsheet" }); skipped++; continue; }
      const plan = planSpreadsheetIngest(matrix);

      if (plan.kind === "turnover" && plan.turnover) {
        if (!plan.turnover.commitSafe) {
          results.push({ file: label, status: "review", message: `kassa herkend, maar ${plan.turnover.warnings.length} controle nodig — controleer in Dagomzet` });
          review++; continue;
        }
        const b = await bookTurnoverRows(supabase, user.id, plan.turnover.rows, "z_report");
        // [TURNOVER-ARITHMETIC] Refused figures are not a failed save — say which it was.
        if (!b.ok) { results.push({ file: label, status: "error", message: b.rejected.length ? `bedragen kloppen niet (${b.rejected[0]}) — niets geboekt` : "opslaan van kassa-omzet mislukt" }); failed++; continue; }
        turnoverDays += b.days; booked++;
        results.push({ file: label, status: "booked", type: "turnover", message: `${b.days} dagen kassa-omzet (${b.span})` });
        await logAuditAction({ userId: user.id, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: doc.id,
          newValue: { days: b.days, span: b.span, total_incl: b.total_incl, file_name: doc.file_name, path: "reprocess" }, ipAddress: getClientIP(req) }).catch(() => {});
      } else if (plan.kind === "ledger" && plan.ledger) {
        const b = await bookLedgerRows(supabase, user.id, plan.ledger.kind, plan.ledger.accountNr, plan.ledger.rows);
        if (!b.ok) { results.push({ file: label, status: "error", message: "opslaan van grootboek mislukt" }); failed++; continue; }
        ledgerDays += b.days; booked++;
        results.push({ file: label, status: "booked", type: "ledger", message: `${b.days} dagen ${ledgerKindLabel(plan.ledger.kind)} (controle-check)` });
        await logAuditAction({ userId: user.id, action: "ledger.auto_imported", entityType: "ledger_daily", entityId: doc.id,
          newValue: { kind: plan.ledger.kind, account_nr: plan.ledger.accountNr, days: b.days, span: b.span, file_name: doc.file_name, path: "reprocess" }, ipAddress: getClientIP(req) }).catch(() => {});
      } else {
        results.push({ file: label, status: "skip", message: "geen kassa- of grootboek-indeling herkend" }); skipped++;
      }
      continue;
    }

    // ── PDF → daily-sales report? (an invoice PDF is left for the normal flow) ────────────
    if (isPdf) {
      if (pdfExtracts >= MAX_PDF_EXTRACTS) { results.push({ file: label, status: "skip", message: "overgeslagen (te veel PDF's in één keer) — probeer opnieuw" }); skipped++; continue; }
      pdfExtracts++;
      let text: string;
      try {
        const unpdf = await import("unpdf");
        const d = await unpdf.getDocumentProxy(new Uint8Array(buffer));
        text = ((await unpdf.extractText(d, { mergePages: true })).text ?? "").trim();
      } catch { results.push({ file: label, status: "skip", message: "kon PDF-tekst niet lezen" }); skipped++; continue; }

      if (!looksLikeDailySalesReport(text)) { skipped++; continue; } // a normal invoice/receipt PDF → not ours
      const { row, warnings } = parseDailySalesReport(text);
      if (!row || warnings.length > 0) {
        results.push({ file: label, status: "review", message: `dagomzet herkend maar niet zeker — controleer in Dagomzet` }); review++; continue;
      }
      // source 'z_report' (an allowed daily_turnover.source; 'z_report_pdf' violates the DB CHECK).
      const b = await bookTurnoverRows(supabase, user.id, [row], "z_report", { preserveSplit: true });
      // [TURNOVER-ARITHMETIC] Same distinction as the multi-day path above.
      if (!b.ok) { results.push({ file: label, status: "error", message: b.rejected.length ? `bedragen kloppen niet (${b.rejected[0]}) — niets geboekt` : "opslaan van dagomzet mislukt" }); failed++; continue; }
      turnoverDays += b.days; booked++;
      results.push({ file: label, status: "booked", type: "turnover", message: `dagomzet ${row.turnover_date} (€${b.total_incl.toFixed(2)})` });
      await logAuditAction({ userId: user.id, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: doc.id,
        newValue: { days: 1, span: row.turnover_date, total_incl: b.total_incl, file_name: doc.file_name, path: "reprocess_pdf" }, ipAddress: getClientIP(req) }).catch(() => {});
    }
    } catch {
      results.push({ file: label, status: "error", message: "onverwachte fout bij verwerken — overgeslagen" }); failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    summary: { scanned: docs.length, considered, booked, turnoverDays, ledgerDays, review, skipped, failed, capped },
    results,
  });
}
