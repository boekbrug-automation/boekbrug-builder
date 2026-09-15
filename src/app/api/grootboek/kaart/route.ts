// src/app/api/grootboek/kaart/route.ts
// [GROOTBOEK-KAART] GET ?year=2026[&clientId=…] — the grootboek and the journaal, as the accountant
// reads them.
//
// Authorize-fetch-refuse only, like /api/xaf, and deliberately built from the SAME two functions
// that file uses: buildXafInputForOwner for the reads, buildJournalEntries for the bookings. The
// screen and the auditfile are two renderings of one journal — if they could ever disagree, the
// accountant would be reconciling BoekBrug against BoekBrug. See [JOURNAAL-BRON].
//
// [NO-SILENT-EMPTY] A failed read refuses with 503. A ledger missing a table's rows is not a
// smaller administration; it is a wrong one, and it looks exactly like a right one.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { buildJournalEntries } from "@/lib/xaf-export";
import { buildXafInputForOwner } from "@/lib/xaf-fetch";
import { buildLedgerCards, resultFromCards } from "@/lib/grootboekkaart";
import { reportHandledFailure } from "@/lib/report-handled";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }

  const limited = await checkRateLimit({ userId: user.id, endpoint: "grootboek-kaart", ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

  const owner = await resolveQuarterOwner(supabase, user.id, req.nextUrl.searchParams.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();

  try {
    const input = await buildXafInputForOwner({ pipeline, ownerId: owner.ownerId, year });
    const journal = buildJournalEntries(input);
    const balance = buildLedgerCards(journal.entries);

    return NextResponse.json({
      year,
      cards: balance.cards,
      totalDebitC: balance.totalDebitC,
      totalCreditC: balance.totalCreditC,
      balanced: balance.balanced,
      unknownAccounts: balance.unknownAccounts,
      resultC: resultFromCards(balance),
      // The journaal itself, newest first — the accountant's other page.
      entries: journal.entries,
      // [XAF-NIET-STIL] The same honesty the auditfile carries in its own header comment: a
      // document the journal REFUSED is missing from this ledger too, and a shorter ledger looks
      // exactly like a complete one. The screen names them.
      skipped: journal.skipped,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "onbekende fout";
    await reportHandledFailure({
      tag: "GROOTBOEK-KAART", severity: "data-integrity",
      message: `grootboekkaart mislukt: ${message}`, context: { ownerId: owner.ownerId, year },
    });
    return NextResponse.json(
      { error: "De boekhouding kon niet worden opgebouwd. Probeer het later opnieuw." },
      { status: 503 },
    );
  }
}
