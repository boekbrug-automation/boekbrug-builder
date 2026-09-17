// src/app/api/billing/checkout/route.ts
// [BILLING] Start a Stripe Checkout session for the Pro plan.
//
// Returns { url } for the browser to redirect to. Card data never touches
// BoekBrug — Stripe's hosted page owns the form, SCA/3-D Secure and the iDEAL
// bank redirect, so our PCI scope stays at zero.
//
// The subscription itself is NOT recorded here. The customer is only marked as
// paying when Stripe says so, via /api/billing/webhook. A success redirect is a
// browser navigation and a browser navigation can be forged; the webhook is
// signed. Never grant a plan on the strength of a return URL.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  isBillingConfigured,
  resolveCustomerId,
  createCheckoutSession,
} from "@/lib/billing";
import { parsePlusInterval, type PlusInterval } from "@/lib/plus-interval";
import { appOrigin } from "@/lib/app-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [JAARPRIJS] Per maand of per jaar, van de wire.
  //
  // Drie gevallen en drie verschillende antwoorden, want twee ervan samennemen is precies de
  // fout die geld kost:
  //   · geen body / geen veld → "month". De bestaande knoppen posten niets en betekenen maand;
  //     dat mag niet veranderen omdat hier een veld bij komt.
  //   · "month" of "year"     → dat.
  //   · iets anders           → 400, GEEN terugval. Een onbekende waarde stil als maand lezen
  //     schrijft iemand die "per jaar" koos maandelijks af, en andersom gaat er €179,91 per
  //     maand af. Beide zijn een afschrijving die niemand heeft gekozen, en een weigering hier
  //     kost hooguit een klik.
  let interval: PlusInterval = "month";
  try {
    const body: unknown = await req.json();
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>).interval : undefined;
    if (raw !== undefined && raw !== null) {
      const parsed = parsePlusInterval(raw);
      if (!parsed) {
        return NextResponse.json({ error: "Onbekende betaalperiode." }, { status: 400 });
      }
      interval = parsed;
    }
  } catch {
    // Geen body of geen geldige JSON: dat is de bestaande knop, en die betekent maand.
  }

  // No Stripe keys yet → a clean, honest 503 the UI can show as a disabled
  // button, rather than a 500 stack trace in a paying customer's face.
  if (!isBillingConfigured()) {
    return NextResponse.json(
      { error: "Betalingen zijn nog niet geconfigureerd." },
      { status: 503 }
    );
  }

  // stripe_customer_id is added by billing_subscription.sql and is not in the
  // generated types → relaxed client. Wrapped because the column does not
  // exist until the migration is applied: a missing column must degrade to
  // "no customer yet", never to a 500.
  let existingCustomerId: string | null = null;
  let email: string | null = user.email ?? null;
  let name: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("profiles")
      .select("email, full_name, company_name, stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (data) {
      existingCustomerId = data.stripe_customer_id ?? null;
      email = data.email ?? email;
      name = data.company_name || data.full_name || null;
    }
  } catch (err) {
    console.error("[BILLING] profile read failed (continuing without it):", err);
  }

  try {
    const customerId = await resolveCustomerId({
      existingId: existingCustomerId,
      profileId: user.id,
      email,
      name,
    });

    // Persist the link BEFORE sending the user to Stripe. If they pay and the
    // webhook arrives while metadata is somehow missing, the customer→profile
    // lookup still resolves. Written with the service-role client because the
    // billing guard trigger forbids the user's own session from touching this
    // column. Best-effort: a failure here must not block a paying customer,
    // since the webhook can still attribute via metadata.
    if (customerId !== existingCustomerId) {
      const pipeline = createPipelineClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (pipeline as any)
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (error) {
        console.error("[BILLING] could not store stripe_customer_id:", error.message);
      }
    }

    // [ORIGIN] Eén keten (APP_URL → SITE_URL → VERCEL_URL → dit verzoek), zodat een lege of
    // kapotte waarde doorvalt in plaats van als origin door te gaan.
    const origin = appOrigin(process.env, req.nextUrl.origin) ?? req.nextUrl.origin;

    const session = await createCheckoutSession({
      customerId,
      profileId: user.id,
      // The success page waits for the webhook rather than trusting the URL.
      successUrl: `${origin}/dashboard/settings/facturering?betaald=1`,
      cancelUrl: `${origin}/prijzen?geannuleerd=1`,
      interval,
    });

    if (!session.url) {
      throw new Error("Stripe returned a session without a url");
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[BILLING] checkout session failed:", err);
    return NextResponse.json(
      { error: "Kon de betaalpagina niet openen. Probeer het opnieuw." },
      { status: 500 }
    );
  }
}
