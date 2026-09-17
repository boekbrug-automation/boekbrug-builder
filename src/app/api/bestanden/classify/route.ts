// src/app/api/bestanden/classify/route.ts
// [BOEK-033] AI Classification — classify uploaded document and suggest folder
// Uses classifyDocument from @/lib/ai + findFolderByPath from @/lib/bestanden

import { NextRequest, NextResponse } from "next/server";
// [TZ] The owner's calendar, not the server's — see format-nl.ts.
import { amsterdamYear, amsterdamMonth } from "@/lib/format-nl";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { classifyDocument } from "@/lib/ai";
import { findFolderByPath } from "@/lib/bestanden";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const NL_MONTHS: Record<number, string> = {
  1: "januari", 2: "februari", 3: "maart",
  4: "april",   5: "mei",      6: "juni",
  7: "juli",    8: "augustus", 9: "september",
  10: "oktober", 11: "november", 12: "december",
};

function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function buildPathLabel(year: number, quarter: number, month?: number, type?: string): string {
  const parts = [String(year), `Q${quarter}`];
  if (type === "bank") { parts.push("Bank"); return parts.join(" / "); }
  if (month) parts.push(NL_MONTHS[month]);
  if (type === "facturen") parts.push("Facturen");
  if (type === "kosten")   parts.push("Kosten");
  return parts.join(" / ");
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/bestanden/classify",
    ...RATE_LIMITS.DOCUMENT_CLASSIFY,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const body = await req.json() as { documentId: string; fileName: string };
  if (!body.documentId) return NextResponse.json({ error: "documentId vereist" }, { status: 400 });

  try {
    // Get the document's file_url to read content for AI
    const { data: doc } = await supabase
      .from("documents")
      .select("file_url, file_type, file_name")
      .eq("id", body.documentId)
      .eq("user_id", user.id)
      .single();

    if (!doc) return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });

    // Call AI classification.
    // [AI-ARGS] classifyDocument(fileContent, fileName): this route does not fetch
    // the file's text (it's a filename-based folder SUGGESTION only), so the filename
    // is the sole signal — pass it as fileName (was mistakenly `doc.file_type`, the
    // MIME type, which made the model classify off "application/pdf"). Content is the
    // filename too, since that's the only text we have here.
    const classification = await classifyDocument(
      user.id,
      doc.file_name,
      doc.file_name
    );

    // Map AI result to folder path
    // [TZ] The fallback is the OWNER's calendar, never the server's. A document with no readable
    // date is filed under today — and on a UTC server "today" is still yesterday between midnight
    // and 01:00/02:00 Amsterdam. On 1 January that costs a year and a quarter at once: the file
    // lands in the previous year's folder carrying the previous quarter's `period`, which is the
    // exact field the accountant's package reads to decide which quarter a document belongs to.
    const now = new Date();
    const year = classification.date
      ? new Date(classification.date).getUTCFullYear()
      : amsterdamYear(now);
    const month = classification.date
      ? new Date(classification.date).getUTCMonth() + 1
      : amsterdamMonth(now);
    const quarter = monthToQuarter(month);

    // [BOEK-033] Map AI result to folder type
    // 'bank' is not in classifyDocument union — detect via filename instead.
    // [I#4] Tightened: (a) match bank tokens on WORD boundaries so vendor names like
    // "Rabobank_factuur" / "ABN bankgarantie" don't get filed as statements, and
    // (b) never let a filename token override a confident invoice/receipt — a real
    // statement is classified 'unknown', so gating on that keeps detection working
    // while stopping false positives that would silently move a file into Bank.
    const lowerName = (doc.file_name ?? body.fileName ?? "").toLowerCase();
    const bankTokens = /(bankafschrift|bankstatement|camt|mt940|afschrift|\bbank\b|\bstatement\b)/;
    const isBankFile =
      bankTokens.test(lowerName) &&
      classification.type !== "invoice" &&
      classification.type !== "receipt";

    let folderType: "facturen" | "kosten" | "bank" | undefined;
    if (isBankFile)                              folderType = "bank";
    else if (classification.type === "invoice") folderType = "facturen";
    else if (classification.type === "receipt") folderType = "kosten";

    if (!folderType || classification.type === "unknown") {
      // Update document ai fields
      await supabase.from("documents")
        .update({ ai_processed: true, ai_doc_type: classification.type })
        .eq("id", body.documentId).eq("user_id", user.id);
      return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });
    }

    // Find folder id in DB
    const folderId = await findFolderByPath(user.id, {
      year,
      quarter,
      month: folderType !== "bank" ? month : undefined,
      type: folderType,
    });

    const folderPath = buildPathLabel(year, quarter, folderType !== "bank" ? month : undefined, folderType);

    // Update document ai fields
    await supabase.from("documents")
      .update({
        ai_processed: true,
        ai_doc_type: classification.type,
        ai_suggested_folder: folderId,
      })
      .eq("id", body.documentId).eq("user_id", user.id);

    return NextResponse.json({
      type: classification.type,
      folderId,
      folderPath,
    });
  } catch (err) {
    console.error("[BOEK-033] classify error:", err);
    // Return unknown on any error — never crash the upload flow
    return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });
  }
}