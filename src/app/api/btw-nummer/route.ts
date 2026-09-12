// src/app/api/btw-nummer/route.ts
// [EU-BTW] GET /api/btw-nummer?nummer=BE0123456749 → does VIES know it, right now.
//
// Free, no key: the European Commission runs it. Same shape as /api/adres and for the same
// reasons — server-side, bounded, and a Verification with three outcomes rather than a boolean.
//
// ── WHY THE MOMENT IS PART OF THE ANSWER ──
// An intra-EU supply to a business with a VALID foreign btw-nummer is verlegd: 0% on the invoice
// and the customer declares the tax. If the number was not valid, the supply was never zero-rated
// and the Dutch supplier owes the btw himself — on an invoice he already sent without it. So
// "valid on 12 September" is the defensible record and "valid" is not, which is why checkedAt is
// filled and why a refusal carries a date too.
//
// ── THE SHAPE CHECK RUNS FIRST, OFFLINE ──
// Most wrong numbers are typos. euVatShape catches those without leaving the building, which
// keeps us far below the rate limit of a service we do not pay for, and keeps the app useful on
// the days a member state's system is down — VIES fans out to 27 national registers and any one
// of them can be unavailable, which the service documents as normal.

import { NextRequest, NextResponse } from "next/server";

import { euVatShape } from "@/lib/eu-vat-format";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { confirmed, refused, unknown, type Verification } from "@/lib/verification";
import { parseViesAnswer, type ViesCompany } from "@/lib/vies-parse";

export const dynamic = "force-dynamic";

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
/** Longer than the address lookup: VIES asks a national register and those are not fast. */
const TIMEOUT_MS = 8_000;

function json(v: Verification<ViesCompany>) {
  return NextResponse.json(v);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/btw-nummer",
    ...RATE_LIMITS.ADDRESS_LOOKUP,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const raw = request.nextUrl.searchParams.get("nummer");
  const shape = euVatShape(raw);

  // A typo is answered here, instantly, without troubling Brussels. It is a REFUSAL rather than
  // an unknown: we did establish something — this cannot be a btw-nummer of that country.
  if (shape.shape === "impossible") {
    return json(refused<ViesCompany>("VIES", shape.reason, new Date().toISOString()));
  }

  // A Dutch number is not checked at VIES: VIES answers about intra-EU registration, and for a
  // Dutch customer of a Dutch supplier the question does not arise. Saying "niet gecontroleerd"
  // here would put a warning under every ordinary domestic invoice.
  if (shape.country === "NL") {
    return json(unknown<ViesCompany>("VIES", "VIES controleert alleen buitenlandse EU-nummers"));
  }

  const country = shape.country;
  const number = shape.normalised.slice(2);

  let body: unknown;
  try {
    const res = await fetch(`${VIES_URL}/${encodeURIComponent(country)}/vat/${encodeURIComponent(number)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return json(unknown<ViesCompany>("VIES", "VIES kon het nummer nu niet controleren"));
    }
    body = await res.json();
  } catch {
    return json(unknown<ViesCompany>("VIES", "VIES was niet bereikbaar"));
  }

  const reading = parseViesAnswer(body, shape.normalised);
  const now = new Date().toISOString();

  if (reading.reading === "valid") return json(confirmed<ViesCompany>("VIES", reading.company, now));
  if (reading.reading === "invalid") {
    return json(refused<ViesCompany>("VIES", "VIES kent dit btw-nummer niet als geldig", now));
  }
  return json(unknown<ViesCompany>("VIES", reading.why));
}
