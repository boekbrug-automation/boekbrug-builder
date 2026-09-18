// src/app/api/bank/enablebanking/connect/route.ts
// [ENABLEBANKING] Start a bank link.
//
// POST /api/bank/enablebanking/connect  { bankName, bankCountry }
//   → { connectionId, link }   — the owner is sent to `link` to consent at his own bank.
//
// Two things happen, in this order, and the order matters:
//   1. our own row, carrying a fresh 256-bit nonce, BEFORE the owner leaves for his bank;
//   2. the authorisation URL from Enable Banking, carrying that same nonce as `state`.
//
// Step 1 must happen first. If we stored the row only on the way back, a consent that succeeded at
// the bank but whose callback never arrived (a closed tab, a phone that finished the flow) would
// leave the owner having authorised something we have no record of.
//
// This is simpler than the GoCardless flow it replaces, and safer for one specific reason: there
// is nothing to orphan. GoCardless minted a requisition BEFORE the redirect, so a failure to store
// our row left a live authorisation upstream that had to be withdrawn by hand. Enable Banking
// mints the session only when the returned code is exchanged, so a connect attempt that dies here
// leaves nothing behind at all.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { appOrigin } from "@/lib/app-origin";
import {
  createEnableBankingClient,
  DEFAULT_CONSENT_DAYS,
  dutchEnableBankingError,
  EnableBankingError,
  isEnableBankingConfigured,
  canUseEnableBanking,
} from "@/lib/enablebanking-client";
import { createBankConnection, newConnectionReference } from "@/lib/enablebanking-connection";

export const dynamic = "force-dynamic";

/** The bank name is echoed into an upstream request body, so it is bounded rather than trusted. */
function readBankName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length >= 2 && name.length <= 120 ? name : null;
}

function readCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [EB-TESTER] The door that starts a real consent. Same answer as an unconfigured install.
  if (!isEnableBankingConfigured() || !canUseEnableBanking(user.id)) {
    return NextResponse.json({ error: dutchEnableBankingError("NOT_CONFIGURED") }, { status: 503 });
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/bank/enablebanking/connect",
    ...RATE_LIMITS.BANK_CONNECT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: { bankName?: unknown; bankCountry?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }

  const bankName = readBankName(body.bankName);
  const bankCountry = readCountry(body.bankCountry) ?? "NL";
  if (!bankName) {
    return NextResponse.json({ error: "Kies eerst je bank." }, { status: 400 });
  }

  // The redirect target must be absolute, must match what the owner's browser can reach, AND must
  // be one of the redirect URLs registered with Enable Banking — an unregistered one is refused
  // upstream, which is the correct behaviour and the reason this is not configurable per request.
  const origin = appOrigin(process.env, req.nextUrl.origin);
  if (!origin) {
    console.error("[ENABLEBANKING] no app origin — cannot build the redirect URL");
    return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
  }
  const redirectUrl = `${origin}/api/bank/enablebanking/callback`;

  const reference = newConnectionReference();
  const validUntil = new Date(Date.now() + DEFAULT_CONSENT_DAYS * 24 * 60 * 60 * 1000);

  // Store BEFORE leaving. A row with no session yet is exactly what 'pending' means.
  const connection = await createBankConnection({
    userId: user.id,
    aspspName: bankName,
    aspspCountry: bankCountry,
    institutionName: bankName,
    institutionBic: null,
    reference,
    accessValidUntil: validUntil.toISOString(),
    maxHistoricalDays: null,
  });
  if (!connection) {
    return NextResponse.json({ error: "Koppeling opslaan mislukt" }, { status: 500 });
  }

  try {
    const client = createEnableBankingClient();
    const { url } = await client.startAuthorization({
      aspspName: bankName,
      aspspCountry: bankCountry,
      redirectUrl,
      state: reference,
      validUntil,
    });

    await logAuditAction({
      userId: user.id,
      action: "bank.connect_started",
      entityType: "bank_connection",
      entityId: connection.id,
      newValue: { bankName, bankCountry },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ connectionId: connection.id, link: url });
  } catch (err) {
    if (err instanceof EnableBankingError) {
      console.warn("[ENABLEBANKING] connect attempt refused", { userId: user.id, code: err.code });
      return NextResponse.json(
        { error: dutchEnableBankingError(err.code), code: err.code },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 400 },
      );
    }
    console.error("[ENABLEBANKING] unexpected error while connecting", err);
    return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
  }
}
