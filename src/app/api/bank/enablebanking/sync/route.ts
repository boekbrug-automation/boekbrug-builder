// src/app/api/bank/enablebanking/sync/route.ts
// [ENABLEBANKING] The owner's "ververs" button, and the first pull after connecting.
//
// POST /api/bank/enablebanking/sync  { connectionId? }
//   → { inserted, autoBooked, connections: [...], warnings: [...] }
//
// Without a connectionId every live connection of this owner is synced — which is what the
// /dashboard/bank page calls right after a successful callback.
//
// `force` is deliberately NOT a parameter the client can set. The 20-hour guard exists because
// the bank allows only a handful of reads per day per account; letting the browser opt out of it
// would put the owner one impatient double-click away from a feed that is silent until tomorrow.
// The button is enabled only when the guard says an account is due (see the status route), so an
// honest press always does real work.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  isEnableBankingConfigured,
  canUseEnableBanking,
  dutchEnableBankingError,
} from "@/lib/enablebanking-client";
import { getBankConnection, listBankConnections } from "@/lib/enablebanking-connection";
import { syncBankConnection } from "@/lib/enablebanking-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [EB-TESTER] No bank traffic on behalf of an account outside the list.
  if (!isEnableBankingConfigured() || !canUseEnableBanking(user.id)) {
    return NextResponse.json({ error: dutchEnableBankingError("NOT_CONFIGURED") }, { status: 503 });
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/bank/enablebanking/sync",
    ...RATE_LIMITS.BANK_SYNC,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let connectionId: string | null = null;
  try {
    const body = (await req.json()) as { connectionId?: unknown };
    if (typeof body.connectionId === "string" && UUID.test(body.connectionId)) {
      connectionId = body.connectionId;
    }
  } catch {
    // No body is fine: sync everything this owner has.
  }

  // Both reads are scoped to the session user, so a connectionId belonging to someone else
  // simply resolves to nothing.
  const connections = connectionId
    ? [await getBankConnection(user.id, connectionId)].filter((c) => c !== null)
    : (await listBankConnections(user.id)).filter((c) => c.status === "linked" || c.status === "error");

  if (connections.length === 0) {
    return NextResponse.json({ error: "Geen actieve bankkoppeling gevonden." }, { status: 404 });
  }

  const pipeline = createPipelineClient();
  const results = [];
  let inserted = 0;
  let autoBooked = 0;
  const warnings: string[] = [];

  for (const connection of connections) {
    const result = await syncBankConnection({ connection, pipeline });
    inserted += result.inserted;
    autoBooked += result.autoBooked;
    for (const account of result.accounts) warnings.push(...account.warnings);
    results.push({
      connectionId: result.connectionId,
      institutionName: result.institutionName,
      inserted: result.inserted,
      error: result.error,
      // Distinguishes "nothing new at your bank" from "we were not allowed to look yet" — two
      // very different things to read under a button you just pressed.
      skippedTooSoon: result.accounts.length > 0 && result.accounts.every((a) => a.skippedTooSoon),
    });
  }

  return NextResponse.json({
    ok: true,
    inserted,
    autoBooked,
    connections: results,
    // Every line the bank sent that we could not read. Surfaced exactly like an upload's
    // parseWarnings: a dropped transaction is money missing from the owner's books.
    warnings,
  });
}
