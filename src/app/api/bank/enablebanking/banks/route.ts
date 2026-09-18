// src/app/api/bank/enablebanking/banks/route.ts
// [ENABLEBANKING] The bank picker: which banks can this owner connect?
//
// GET /api/bank/enablebanking/banks?country=NL
//   → { configured, country, banks: [{ name, country, logo }] }
//
// `configured: false` is a first-class answer, not an error: a server without Enable Banking
// credentials should make the card hide itself, not offer a button that can only fail.
//
// Note there is no institution ID in this API. A bank is identified by the {name, country} PAIR,
// which is what /auth takes — so both halves travel together everywhere, and a picker that
// remembered only the name would be unable to reconnect a bank that trades in two countries.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  createEnableBankingClient,
  dutchEnableBankingError,
  EnableBankingError,
  isEnableBankingConfigured,
  canUseEnableBanking,
} from "@/lib/enablebanking-client";

export const dynamic = "force-dynamic";

/** Two letters only. The value goes into the query string of an upstream call, so it is validated
 *  rather than escaped-and-hoped. */
function readCountry(raw: string | null): string {
  const c = (raw ?? "NL").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "NL";
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [EB-TESTER] Two questions, asked in order: are the credentials there, and may THIS account
  // reach a bank with them. A refusal answers exactly like an unconfigured install — same shape,
  // same words — so an account outside the list learns nothing about a programme it is not in,
  // and BankConnectPanel hides itself for the same reason it always did.
  if (!isEnableBankingConfigured() || !canUseEnableBanking(user.id)) {
    return NextResponse.json({ configured: false, banks: [] });
  }

  const country = readCountry(req.nextUrl.searchParams.get("country"));

  try {
    const client = createEnableBankingClient();
    const aspsps = await client.listAspsps(country);
    const banks = aspsps
      .map((a) => ({ name: a.name, country: a.country, logo: a.logo ?? null }))
      // Alphabetical: the owner is looking for HIS bank by name, and the API's own order is not
      // meaningful to him.
      .sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return NextResponse.json({ configured: true, country, banks });
  } catch (err) {
    if (err instanceof EnableBankingError) {
      console.warn("[ENABLEBANKING] listing banks failed", { code: err.code });
      return NextResponse.json(
        { configured: true, error: dutchEnableBankingError(err.code), code: err.code, banks: [] },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    console.error("[ENABLEBANKING] unexpected error listing banks", err);
    return NextResponse.json({ error: "Banklijst ophalen mislukt" }, { status: 500 });
  }
}
