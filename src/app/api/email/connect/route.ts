// src/app/api/email/connect/route.ts
// [BOEK-011] Initiate Gmail or Outlook OAuth flow
// GET /api/email/connect?provider=gmail|outlook

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildGmailOAuthUrl, buildOutlookOAuthUrl } from "@/lib/email-integration";
import { makeOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE } from "@/lib/oauth-state";
import { planForUser } from "@/lib/fair-use-gate";
import { fairUseLimit } from "@/lib/fair-use";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get("provider");

  if (provider !== "gmail" && provider !== "outlook") {
    return NextResponse.json(
      { error: "Provider moet gmail of outlook zijn" },
      { status: 400 }
    );
  }

  // [MAILBOX-WAAR] How many mailboxes this plan may hold — enforced HERE, at the only door that
  // can add one, and before the owner is sent to Google or Microsoft. Refusing after the OAuth
  // round trip would mean asking someone to grant access to their mail and then telling them no.
  //
  // RECONNECTING IS NEVER A NEW MAILBOX. A grant dies (needs_reauth) and the owner presses
  // "Verbind opnieuw"; that is the SAME provider, the same row, and it must work on every plan.
  // Counting it as an addition would lock a Free account out of the mailbox it already has the
  // moment its token expired — a limit that quietly takes away what it was meant to bound.
  //
  // Fails OPEN, like every other fair-use fence: if the count cannot be read, the connect goes
  // ahead. The database refuses a real overflow anyway — UNIQUE (user_id, provider) means there
  // is no third row to create.
  const { data: existing } = await supabase
    .from("email_connections")
    .select("provider")
    .eq("user_id", user.id);

  const connected = (existing ?? []).map((r) => (r as { provider: string }).provider);
  if (connected.length > 0 && !connected.includes(provider)) {
    const plan = await planForUser(supabase, user.id);
    const limit = plan === "free" ? fairUseLimit("mailboxes").free : fairUseLimit("mailboxes").plus;
    if (connected.length >= limit) {
      // 402, not 403: this is not "you may not", it is "this costs more than your plan" — the
      // same distinction gateFairUse draws, with the same published sentence and the same way out.
      return NextResponse.json(
        {
          error: fairUseLimit("mailboxes").onExceed,
          reason: "fair_use",
          metric: "mailboxes",
          used: connected.length,
          limit,
          plan,
          upgradeUrl: "/prijzen",
          beleidUrl: "/eerlijk-gebruik",
        },
        { status: 402 },
      );
    }
  }

  // [MH1] CSRF-safe state: a random nonce goes in the `state` param AND in an HttpOnly
  // cookie that also carries the initiating userId. The callback trusts the cookie's
  // userId only when its nonce matches the returned state — a forged state has no cookie.
  const { state, cookieValue } = makeOAuthState(user.id, provider);

  const redirectUrl =
    provider === "gmail"
      ? buildGmailOAuthUrl(state)
      : buildOutlookOAuthUrl(state);

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // survives the top-level redirect back from the provider
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return res;
}