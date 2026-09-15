// src/app/api/eft/import/route.ts
// [TRIANGLE] Two-step, human-in-the-loop import of a payment-terminal settlement receipt
// (Equens CTAP "TOTALEN RAPPORT") into eft_settlements — corner 2 of the reconciliation
// triangle. User-scoped (RLS server client).
//
//   1. PREVIEW — POST multipart/form-data `file` (a photo/pdf of the receipt) OR
//                POST application/json { text } (pasted/typed receipt text). The AI only
//                TRANSCRIBES an image to text; the PURE parser (eft-parser.ts) does the
//                structured extraction + reconciliation cross-checks. Returns the parsed
//                settlement + warnings. NOTHING is written; the owner reviews first.
//   2. COMMIT  — POST application/json { settlement } (the reviewed settlement). Upserts
//                into eft_settlements (one row per terminal-shift; a re-import updates).
//
// It never guesses: preview warnings (scheme totals not reconciling, etc.) are shown to the
// owner, and only the owner's confirmed settlement is stored.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseEftSettlement, type EftSettlement } from "@/lib/eft-parser";
import { transcribeEftReceipt } from "@/lib/ai";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { gateFairUse } from "@/lib/fair-use-gate";
import type { Json } from "@/types/database.types";

const MAX_BYTES = 10 * 1024 * 1024; // a receipt photo is small; generous.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: { text?: unknown; settlement?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }

    // ── 2) COMMIT — the owner-reviewed settlement ──
    if (body.settlement && typeof body.settlement === "object") {
      const s = body.settlement as Partial<EftSettlement>;
      if (typeof s.settlementDate !== "string" || !ISO_DATE.test(s.settlementDate)) {
        return NextResponse.json({ error: "ongeldige of ontbrekende datum (settlementDate) — kan de afrekening niet toewijzen aan een dag" }, { status: 400 });
      }
      if (typeof s.grossTotal !== "number" || !Number.isFinite(s.grossTotal)) {
        return NextResponse.json({ error: "ongeldig totaalbedrag op de afrekening" }, { status: 400 });
      }
      // The natural key is (terminal_id, period_nr, settlement_date). Both parts must be
      // present, otherwise the UNIQUE index (NULLS DISTINCT) would let a re-import INSERT a
      // duplicate settlement instead of updating — doubling that day's gross. Every real
      // terminal receipt prints TMS TERM-ID + PERIODE NR; if OCR missed them the owner fills
      // them in from the preview before committing.
      if (!s.terminalId || !String(s.terminalId).trim() || !s.periodNr || !String(s.periodNr).trim()) {
        return NextResponse.json({ error: "terminal-ID en periode-nummer zijn verplicht (vul ze aan vanaf de bon) — anders kan dezelfde afrekening dubbel worden opgeslagen" }, { status: 400 });
      }
      const record = {
        user_id: user.id,
        settlement_date: s.settlementDate,
        terminal_id: s.terminalId ?? null,
        period_nr: s.periodNr ?? null,
        shift_nr: s.shiftNr ?? null,
        period_start: s.periodStart ?? null,
        period_end: s.periodEnd ?? null,
        first_trx: s.firstTrx ?? null,
        last_trx: s.lastTrx ?? null,
        gross_total: s.grossTotal,
        tx_count: typeof s.txCount === "number" ? s.txCount : 0,
        by_scheme: (Array.isArray(s.byScheme) ? s.byScheme : []) as unknown as Json,
        source: "terminal_receipt",
      };
      const { error } = await supabase
        .from("eft_settlements")
        .upsert(record, { onConflict: "user_id,terminal_id,period_nr,settlement_date" });
      if (error) return NextResponse.json({ error: "kon de terminal-afrekening niet opslaan" }, { status: 500 });
      return NextResponse.json({ ok: true, committed: 1, settlementDate: record.settlement_date });
    }

    // ── 1a) PREVIEW from pasted/typed text ──
    if (typeof body.text === "string" && body.text.trim()) {
      const { settlement, warnings } = parseEftSettlement(body.text);
      return NextResponse.json({ ok: true, preview: true, settlement, warnings });
    }
    return NextResponse.json({ error: "geen tekst of afrekening ontvangen" }, { status: 400 });
  }

  // ── 1b) PREVIEW from an uploaded image/pdf — AI transcribes, pure parser structures ──
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "verwacht een bestand of tekst" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "geen bestand ontvangen" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bestand is leeg of te groot (max 10MB)" }, { status: 400 });
  }

  // [COST] Per-user ceiling — this branch runs an AI/OCR vision call (transcribeEftReceipt).
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/eft/import", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek hierboven gaat over
  // snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een weigering
  // pauzeert alleen dit ene automatische uitlezen.
  //
  // [BEWAAR-EERST] Dit is een PREVIEW-route: er wordt niets opgeslagen, ook niet bij succes —
  // de eigenaar leest de afrekening na en pas de COMMIT-stap hierboven schrijft. De vorige
  // versie van deze regel beloofde "het bestand zelf wordt gewoon bewaard", en dat was niet
  // waar. Er gaat niets verloren dat de app had: de bon staat nog op de telefoon, en er is een
  // weg zonder lezer — dezelfde route neemt overgetypte tekst aan (1a hierboven).
  const gate = await gateFairUse({ client: supabase, userId: user.id, metric: "aiDocuments" });
  if (!gate.allowed) return gate.response!;

  let text: string;
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    text = await transcribeEftReceipt(base64, file.type || "image/jpeg", file.name || "afrekening");
  } catch {
    // [FAIR-USE] Niet gelezen, dus niet geteld.
    await gate.release();
    // [LEZER-STIL] En de weg die WEL open is, staat in de zin. Deze route neemt de bon ook als
    // getypte tekst aan (1a), volledig zonder lezer — een storing van ons is hier dus geen
    // doodlopende weg, tenzij niemand het zegt.
    return NextResponse.json(
      { error: "Automatisch inlezen lukt op dit moment niet. Je kunt de totalen van de bon ook zelf overtypen — dan gaat het verder zonder inlezen." },
      { status: 502 },
    );
  }

  const { settlement, warnings } = parseEftSettlement(text);
  return NextResponse.json({ ok: true, preview: true, settlement, warnings, rawText: text });
}
