// src/app/api/kvk/route.ts
// [KVK-OPTIONEEL] GET /api/kvk?nummer=12345678 → the Basisprofiel, when there is a key for it.
//
// The one paid register of the three. Zoeken is free; the Basisprofiel that returns a name and
// address costs a subscription plus a fee per request. So this route is built to be ABSENT
// without anyone noticing: no key means unknown("KvK", …), the field stays typeable, and nothing
// on any screen waits for it. The moment KVK_API_KEY exists it starts answering, and not one
// screen has to change.
//
// That is not a compromise, it is the point. An owner whose onboarding stalls because an API key
// was never installed is an owner who leaves, and he never learns why.

import { NextRequest, NextResponse } from "next/server";

import { isKvkShaped, normaliseKvkNumber, parseKvkProfile, type KvkCompany } from "@/lib/kvk-parse";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { confirmed, refused, unknown, type Verification } from "@/lib/verification";

export const dynamic = "force-dynamic";

const KVK_URL = "https://api.kvk.nl/api/v1/basisprofielen";
const TIMEOUT_MS = 6_000;

function json(v: Verification<KvkCompany>) {
  return NextResponse.json(v);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const nummer = normaliseKvkNumber(request.nextUrl.searchParams.get("nummer"));
  // Refused, not unknown: eight digits is decidable here and a paid request for something that
  // cannot be a kvk-nummer is money spent on a typo.
  if (!isKvkShaped(nummer)) {
    return json(refused<KvkCompany>("KvK", "Een kvk-nummer bestaat uit acht cijfers", new Date().toISOString()));
  }

  const key = (process.env.KVK_API_KEY ?? "").trim();
  if (key === "") {
    // The normal state today, and it must read as one. Not an error, not a defect — the register
    // is simply not connected, and the owner types the name himself as he always has.
    return json(unknown<KvkCompany>("KvK", "De KvK-koppeling staat niet aan"));
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/kvk",
    ...RATE_LIMITS.ADDRESS_LOOKUP,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: unknown;
  try {
    const res = await fetch(`${KVK_URL}/${encodeURIComponent(nummer)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { apikey: key, Accept: "application/json" },
    });
    // 404 is the register saying it does not know this number — a real answer, and the only
    // status that is. Everything else is our problem, not the owner's.
    if (res.status === 404) {
      return json(refused<KvkCompany>("KvK", "De KvK kent dit nummer niet", new Date().toISOString()));
    }
    if (!res.ok) return json(unknown<KvkCompany>("KvK", "De KvK kon het nummer nu niet opzoeken"));
    body = await res.json();
  } catch {
    return json(unknown<KvkCompany>("KvK", "De KvK was niet bereikbaar"));
  }

  const reading = parseKvkProfile(body, nummer);
  const now = new Date().toISOString();
  if (reading.reading === "found") return json(confirmed<KvkCompany>("KvK", reading.company, now));
  // No "unknown-number" branch: 404 above is how the register says it does not know a number.
  // A body we could not read is our problem and reads as one — see the note in kvk-parse.ts.
  return json(unknown<KvkCompany>("KvK", reading.why));
}
