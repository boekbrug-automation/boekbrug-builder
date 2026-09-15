// src/app/api/adres/route.ts
// [ADRES-ECHT] GET /api/adres?postcode=5038ED&huisnummer=42 → what the BAG holds, or why not.
//
// Free, no key, straight from the Kadaster via PDOK Locatieserver. There is no account to set up
// and no bill to watch, which is why this can be on for every user from the first day instead of
// waiting for a contract — see the KvK note at the bottom for the one that cannot.
//
// ── IT RUNS SERVER-SIDE FOR TWO REASONS ──
//   · the browser would send the owner's customers' addresses to a third party from HIS machine,
//     which is a processing step we would have to name in the privacy statement;
//   · one place to bound the timeout, and one place that can never throw at a screen.
//
// ── THE ANSWER IS A Verification, NOT AN ADDRESS ──
// Three outcomes, never two ([DERDE-BRON]): confirmed with the address, refused when the register
// does not know it, unknown when we could not ask or did not understand the answer. The screen
// fills nothing in on the last one — a wrong street on an invoice is a document a customer's
// accountant can refuse, and it would be OUR wrong street.
//
// ── WHY THIS IS SAFE EVEN THOUGH THE SHAPE COULD NOT BE VERIFIED HERE ──
// api.pdok.nl is blocked from the environment this was written in, so the live shape was never
// seen. parsePdokAnswer is paranoid by construction: every field checked, null the moment
// anything is unexpected. If the real answer looks different, this route returns "niet
// gecontroleerd" — never a made-up street.

import { NextRequest, NextResponse } from "next/server";

import { normalisePostcode, splitHouseNumber, type DutchAddress } from "@/lib/dutch-address";
import { countAddresses, parsePdokAnswer, pdokQuery } from "@/lib/pdok-parse";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { confirmed, refused, unknown, type Verification } from "@/lib/verification";

export const dynamic = "force-dynamic";

const PDOK_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
/** Short on purpose: this runs while someone is typing. A slow answer is no answer. */
const TIMEOUT_MS = 4_000;

function json(v: Verification<DutchAddress>, status = 200) {
  return NextResponse.json(v, { status });
}

export async function GET(request: NextRequest) {
  // Signed in only. Not because the data is secret — the BAG is public — but because an open
  // proxy in front of a free public service is how someone else's traffic becomes our rate limit.
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/adres",
    ...RATE_LIMITS.ADDRESS_LOOKUP,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const sp = request.nextUrl.searchParams;
  const postcode = normalisePostcode(sp.get("postcode"));
  const { number } = splitHouseNumber(sp.get("huisnummer"));

  // Not an error and not a refusal: the owner has simply not typed enough yet. The screen calls
  // this on every keystroke, and "postcode 50 does not exist" would be wrong AND rude.
  if (postcode === "" || number === 0) {
    return json(unknown<DutchAddress>("PDOK", "Vul een postcode en huisnummer in"));
  }

  let body: unknown;
  try {
    const res = await fetch(`${PDOK_URL}?${new URLSearchParams({ q: pdokQuery(postcode, number), rows: "5", fl: "*" })}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return json(unknown<DutchAddress>("PDOK", "Het adressenregister antwoordde niet"));
    }
    body = await res.json();
  } catch {
    // Timeout, DNS, TLS, malformed JSON — all the same to the owner: we could not ask.
    return json(unknown<DutchAddress>("PDOK", "Het adressenregister was niet bereikbaar"));
  }

  const address = parsePdokAnswer(body);
  if (address !== null) {
    return json(confirmed<DutchAddress>("PDOK", address, new Date().toISOString()));
  }

  // Nothing there, several front doors, or a shape we do not recognise — three different
  // sentences, because the owner's next move differs in each.
  const count = countAddresses(body);
  if (count === 0) {
    return json(refused<DutchAddress>("PDOK", "Dit adres staat niet in het BAG-register", new Date().toISOString()));
  }
  if (count > 1) {
    return json(unknown<DutchAddress>("PDOK", `Er zijn ${count} adressen op dit nummer — vul de toevoeging zelf in`));
  }
  return json(unknown<DutchAddress>("PDOK", "Het antwoord van het register was niet leesbaar"));
}

// ── The one that is NOT here, and why ────────────────────────────────────────────────────────
//
// KvK. The Zoeken API is free, but the Basisprofiel that actually returns a company's name and
// address costs a subscription plus a fee per request. That is a fine price for what it does, and
// exactly the wrong thing to make a signup depend on: an owner whose onboarding stalls because an
// API key was never installed is an owner who leaves, and he never learns why.
//
// So KvK arrives the same way this did — its own route, the same Verification answer, the same
// paranoid parser — and it is allowed to be absent. Missing key → unknown("KvK", "…"), the field
// stays typeable, and nothing on any screen depends on it having answered.
