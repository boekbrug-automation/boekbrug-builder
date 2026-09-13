// src/app/api/billing/webhook/route.ts
// [BILLING] Stripe webhook — the ONLY writer of subscription state.
//
// Money is decided by Stripe. This endpoint is how Stripe tells us, and our
// profiles row is a cache of what it said. No other code path in the app may
// write subscription_status / subscription_plan / stripe_customer_id /
// current_period_end — the prevent_billing_self_grant trigger enforces that at
// the database, and this route is the one caller allowed through it (it runs on
// the service-role client, where auth.uid() is NULL).
//
// SECURITY: this endpoint is PUBLIC — Stripe calls it with no session and no
// bearer token. Its only guard is the HMAC signature over the raw body. Without
// that check anyone on the internet could POST `subscription.active` and grant
// themselves a paid plan, so an unverified payload is rejected before a single
// field is read, and is never logged in full.
//
// RAW BODY: the signature covers the exact bytes Stripe sent. `req.text()` is
// used, never `req.json()` — parsing and re-serialising changes key order and
// whitespace and the signature stops verifying. This is the single most common
// way a Stripe integration breaks. The app's middleware runs on /api/* but only
// calls supabase.auth.getUser() (cookies only) and returns early, so it never
// touches this body.
//
// ORDERING: webhooks arrive out of order and are re-delivered on our 5xx. So
// every handler RE-READS the subscription from Stripe and writes that, rather
// than trusting the (possibly stale) object inside the event. A late-arriving
// old event therefore rewrites the same current truth instead of regressing it,
// which makes the endpoint naturally idempotent without an events table.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  constructWebhookEvent,
  isWebhookConfigured,
  subscriptionPeriodEnd,
} from "@/lib/billing";
import { normalizeStripeStatus } from "@/lib/subscription";
// [PRIJS-MOMENT] What is CHARGED, which is not the same number as what is published — see the
// header of subscription-price.ts for the day those two come apart.
import { priceFromSubscription } from "@/lib/subscription-price";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { amsterdamYear } from "@/lib/format-nl";
import { sendPaymentFailedEmail } from "@/lib/email";
import { BEWAARPLICHT_YEARS } from "@/lib/bewaarkluis";

// Stripe's signature verification needs Node crypto and the raw body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Not a state change — Stripe also sends subscription.updated for that. This
  // is purely the trigger for telling the customer their card failed, which is
  // the difference between a dead card and a cancellation.
  "invoice.payment_failed",
]);

export async function POST(req: NextRequest) {
  // Not configured (no keys yet) → tell Stripe we are not ready. 503 makes
  // Stripe retry later rather than marking the event permanently failed.
  if (!isWebhookConfigured()) {
    console.error("[BILLING] webhook hit but STRIPE_WEBHOOK_SECRET/SECRET_KEY missing");
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // Never log the body — an unverified payload is attacker-controlled.
    console.error(
      "[BILLING] webhook signature verification failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // 200 so Stripe stops retrying an event we deliberately ignore.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // 500 → Stripe retries with backoff. Better a retry than a customer who
    // paid and whose account never reflects it.
    console.error(`[BILLING] webhook handler failed (${event.type}):`, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();

  // ── A failed charge: notify, change nothing ────────────────────────
  // Handled first and returned early because it is NOT a state change.
  // Stripe moves the subscription to past_due itself and sends
  // customer.subscription.updated for that; here we only tell the human. Note
  // that past_due deliberately KEEPS access (see subscription.ts rule 4) — the
  // mail says so, because a customer locked out over an expired card cancels.
  if (event.type === "invoice.payment_failed") {
    await notifyPaymentFailed(stripe, event.data.object as Stripe.Invoice);
    return;
  }

  // ── [KLUIS] Een Bewaarkluis is een EENMALIGE betaling, geen abonnement ────
  //
  // Dit blok staat bewust vóór de subscription-resolutie hieronder, want die zoekt een
  // subscription id en die is er bij `mode: "payment"` niet. Zonder dit blok liep een
  // Bewaarkluis-betaling in de tak "carried no subscription id — ignored": geld aangenomen,
  // verplichting nergens vastgelegd. Erger dan het product niet hebben.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product === "bewaarkluis") {
      await recordBewaarkluis(session);
      return;
    }
  }

  // ── Resolve the subscription id this event is about ────────────────
  let subscriptionId: string | null = null;
  let sessionProfileId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    sessionProfileId = session.metadata?.profile_id ?? null;
  } else {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
  }

  if (!subscriptionId) {
    console.warn(`[BILLING] ${event.type} carried no subscription id — ignored`);
    return;
  }

  // ── Re-read current truth from Stripe (see ORDERING in the header) ──
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // ── Find the BoekBrug profile this belongs to ──────────────────────
  // Three independent routes to the same answer, cheapest first. Money events
  // must not be dropped because one link went missing.
  const profileId =
    sub.metadata?.profile_id ??
    sessionProfileId ??
    (await profileIdFromCustomer(stripe, customerId)) ??
    (await profileIdFromDatabase(customerId));

  if (!profileId) {
    // Loud: a real payment we cannot attribute needs a human, now.
    console.error(
      `[BILLING] UNATTRIBUTED subscription ${sub.id} (customer ${customerId}) — no profile_id found`
    );
    return;
  }

  const status = normalizeStripeStatus(sub.status);

  // Het planlabel volgt de status: alleen een lopend abonnement is 'plus'. Wie eruit valt
  // gaat terug naar 'free' — dat is bij ons geen verlies van toegang maar het terugvallen op
  // de gratis grenzen, precies zoals /eerlijk-gebruik het beschrijft.
  //
  // De waarde is 'plus', niet 'pro': subscription_plans_fair_use.sql beperkt deze kolom tot
  // free|plus|boekhouder. Een waarde daarbuiten laat Postgres de HELE rij weigeren, en dat
  // is precies het lek dat de splitsing hieronder afdekt.
  const plan = status === "active" || status === "past_due" || status === "paused" ? "plus" : "free";

  const pipeline = createPipelineClient();

  // ── TWO WRITES, NOT ONE. This split is load-bearing. ────────────────
  //
  // These used to be a single UPDATE, and that was a latent lockout of a PAYING
  // customer. subscription_plan is constrained by an inline CHECK
  // (free|plus|boekhouder). A plan value outside it makes Postgres
  // reject the WHOLE ROW — so subscription_status ('active') and
  // current_period_end never land either. The account stays 'trialing' with a
  // NULL period end, en het account leest als 'free' terwijl de kaart elke maand wordt belast.
  //
  // And it fails almost silently: the handler catches its own error and returns
  // a 500, Stripe retries the same deterministic failure for ~3 days and gives
  // up, there is no events table to replay from, and the only trace is a
  // console line. The discovery channel is a customer's email.
  //
  // So: ACCESS FIRST, unconditionally. Then the plan label, whose failure is
  // logged loudly and cannot take access down with it. Access is what the
  // customer paid for; the plan label is bookkeeping about that payment.

  // WRITE 1 — everything that decides access. Must never be blocked by a label.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: accessErr } = await (pipeline as any)
    .from("profiles")
    .update({
      subscription_status: status,
      subscription_stripe_id: sub.id,
      stripe_customer_id: customerId,
      current_period_end: subscriptionPeriodEnd(sub),
    })
    .eq("id", profileId);

  if (accessErr) {
    // Throw → 500 → Stripe retries. Swallowing this would leave a paying
    // customer looking unpaid with nothing to replay the event.
    throw new Error(`profiles access update failed for ${profileId}: ${accessErr.message}`);
  }

  // WRITE 2 — the plan label. Best-effort by design.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: planErr } = await (pipeline as any)
    .from("profiles")
    .update({ subscription_plan: plan })
    .eq("id", profileId);

  if (planErr) {
    // Loud, but NOT fatal: access is already correct above. A rejected label is
    // a bug for us to fix, never a reason to lock out a paying customer.
    console.error(
      `[BILLING] plan label '${plan}' rejected for profile ${profileId} ` +
        `(access was still granted): ${planErr.message}`
    );
  }

  // WRITE 3 — [PRIJS-MOMENT] what this subscription is actually charged.
  //
  // Best-effort by the same reasoning as the label, and for one extra reason: these columns are
  // added by a migration applied by hand, so on a deployment where it has not run yet the write
  // fails with "column does not exist". A record of the agreement is worth having; it is not
  // worth an access outage, and it is not worth Stripe retrying a deterministic failure for three
  // days over a number the customer can also read on their own invoice.
  //
  // Written only when Stripe named an amount. A null would replace what we knew yesterday with
  // nothing, and "Stripe answered oddly once" is not new information about the price.
  const priced = priceFromSubscription(sub);
  if (priced) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: priceErr } = await (pipeline as any)
      .from("profiles")
      .update({
        subscription_price_cents: priced.cents,
        subscription_price_currency: priced.currency,
        subscription_priced_at: new Date().toISOString(),
      })
      .eq("id", profileId);
    if (priceErr) {
      console.error(
        `[PRIJS-MOMENT] could not record ${priced.cents} ${priced.currency} for profile ` +
          `${profileId} (access and plan were still set): ${priceErr.message}`
      );
    }
  }

  console.log(`[BILLING] ${event.type} → profile ${profileId} is ${status}/${plan}`);
}

/**
 * Tell the customer their payment failed. Never throws: a mail problem must not
 * make the webhook 500, because Stripe would then retry the whole event and the
 * customer would get the same mail again — turning our outage into their spam.
 */
async function notifyPaymentFailed(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  try {
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
    if (!customerId) return;

    // Same two-way lookup as the state handler: a customer we cannot attribute
    // is a customer we cannot warn, and a silent failed payment becomes a
    // silent cancellation.
    const profileId =
      (await profileIdFromDatabase(customerId)) ??
      (await profileIdFromCustomer(stripe, customerId));

    if (!profileId) {
      console.warn(`[BILLING] payment_failed for unknown customer ${customerId} — no mail sent`);
      return;
    }

    const pipeline = createPipelineClient();
    const { data } = await pipeline
      .from("profiles")
      .select("email, full_name, company_name")
      .eq("id", profileId)
      .single();

    // Prefer the address Stripe billed, fall back to the account's own.
    const to = invoice.customer_email ?? data?.email ?? null;
    if (!to) return;

    await sendPaymentFailedEmail({
      toEmail: to,
      name: data?.company_name || data?.full_name || "ondernemer",
    });
    console.log(`[BILLING] payment-failed mail sent to profile ${profileId}`);
  } catch (err) {
    console.error("[BILLING] payment-failed notification failed:", err);
  }
}

/** Read profile_id off the Stripe customer's metadata (set at creation). */
async function profileIdFromCustomer(
  stripe: Stripe,
  customerId: string
): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return customer.metadata?.profile_id ?? null;
  } catch {
    return null;
  }
}

/** Last resort: find the profile we previously linked to this customer. */
async function profileIdFromDatabase(customerId: string): Promise<string | null> {
  try {
    const pipeline = createPipelineClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (pipeline as any)
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * [KLUIS] Leg een gekochte Bewaarkluis vast.
 *
 * Wat hier ook misgaat, één ding mag NOOIT: stil eindigen. De klant heeft betaald voor
 * zeven jaar bewaring; als wij dat niet kunnen opschrijven moet er iemand naar kijken. Elke
 * onmogelijkheid gooit daarom, wat een 500 oplevert, wat Stripe drie dagen lang laat
 * herproberen — en de retry is idempotent dankzij de unieke index op stripe_session_id.
 */
async function recordBewaarkluis(session: Stripe.Checkout.Session): Promise<void> {
  const profileId = session.metadata?.profile_id ?? null;
  const years = Number(session.metadata?.years ?? 0);

  if (!profileId) {
    // Luid: een echte betaling die wij niet aan een account kunnen koppelen.
    throw new Error(`[KLUIS] UNATTRIBUTED bewaarkluis payment ${session.id} — no profile_id`);
  }
  if (!Number.isInteger(years) || years < 1 || years > BEWAARPLICHT_YEARS + 1) {
    throw new Error(`[KLUIS] bewaarkluis ${session.id} has an implausible years value: ${String(session.metadata?.years)}`);
  }

  const pipeline = createPipelineClient();

  // Het jaar t/m wanneer wij bewaren, gerekend vanaf NU. Bewust niet uit de metadata: die
  // komt uit de browser-sessie van een half uur geleden, en dit getal is wat wij beloven.
  //
  // [NUMMER-JAAR] De sleutel is de klok van de EIGENAAR, niet die van de server. getUTCFullYear()
  // geeft in het eerste uur van 1 januari (Amsterdam is dan UTC+1) nog het OUDE jaar terug, en dit
  // getal is precies wat de zin hierboven belooft: het jaar t/m wanneer wij bewaren. Eén uur per
  // jaar zou een klant betalen voor N jaar en N-1 jaar krijgen — permanent vastgelegd in
  // kluis_subscriptions.keep_through_year, waar niemand er ooit meer naar kijkt.
  const keepThroughYear = amsterdamYear() + years - 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (pipeline as any).from("kluis_subscriptions").insert({
    user_id: profileId,
    keep_through_year: keepThroughYear,
    years_purchased: years,
    amount_cents: session.amount_total ?? 0,
    stripe_session_id: session.id,
  });

  if (error) {
    // 23505 = de unieke index op stripe_session_id. Dat is geen fout maar precies wat hij
    // moet doen: Stripe levert een event bij twijfel opnieuw af, en die herhaling hoort
    // niets te veranderen. Alles ánders gooit, zodat Stripe blijft proberen.
    if (error.code === "23505") {
      console.log(`[KLUIS] bewaarkluis ${session.id} was al vastgelegd — herhaling genegeerd`);
      return;
    }
    throw new Error(`[KLUIS] kon bewaarkluis ${session.id} niet vastleggen: ${error.message}`);
  }

  console.log(
    `[KLUIS] bewaarkluis vastgelegd voor ${profileId}: ${years} jaar, t/m ${keepThroughYear}`
  );
}
