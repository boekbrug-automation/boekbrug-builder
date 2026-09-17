// ─────────────────────────────────────────────────────────
// src/lib/billing.ts
// [BILLING] — Stripe boundary. Import from here only.
// Do not construct a Stripe client anywhere else in the app.
//
// Same discipline as src/lib/ai.ts is to Claude: one module owns the vendor,
// one place to change a key, a price or an API version.
//
// Usage:
//   /api/billing/checkout  → getStripe, resolveCustomerId, createCheckoutSession
//   /api/billing/portal    → getStripe, createPortalSession
//   /api/billing/webhook   → getStripe, constructWebhookEvent
//
// The DECISION about who may use the app is NOT here — that is the pure,
// vendor-free src/lib/subscription.ts. This file only talks to Stripe.
// ─────────────────────────────────────────────────────────
//
// Rule: Stripe is the source of truth for money. Our database is a cache of
// what Stripe told us, written by the webhook and by nothing else.
// ─────────────────────────────────────────────────────────

import Stripe from "stripe";

import { PLUS_TRIAL_DAYS } from "@/lib/plan";
import { checkPlusPrice, type PlusInterval } from "@/lib/plus-interval";

// ── Configuration ────────────────────────────────────────────────────
//
// [MODEL-CONFIG lesson, applied to billing] ai.ts records what a hard-coded
// vendor identifier once cost this app: an unverified model id shipped, every
// invoice classification 404'd, and only a redeploy could undo it. The same
// trap exists here — a price id is per-account and differs between test and
// live mode — so the price is ENV-CONFIGURED with no code-level fallback. Swap
// test↔live, or correct a wrong price, by changing an environment variable.

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
// Twee prijzen, want wij verkopen twee dingen:
//   • Plus — het maandabonnement voor wie structureel boven het eerlijk gebruik uitkomt;
//   • Bewaarkluis — het archief dat DOORLOOPT nadat iemand is gestopt (de fiscale
//     bewaarplicht van 7 jaar overleeft de klantrelatie; zie src/lib/bewaarkluis.ts).
// Beide zijn per Stripe-account én per modus verschillend, dus beide staan in de omgeving
// zonder fallback in code.
const STRIPE_PRICE_ID_PLUS = (process.env.STRIPE_PRICE_ID_PLUS || "").trim();
// [JAARPRIJS] Hetzelfde plan, per jaar vooruit. ÉÉN doorlopende Stripe-prijs van €179,91 — geen
// subscription schedule, geen fase van nul euro, geen drie gratis maanden plus negen betaalde.
// Zo'n constructie verandert halverwege van vorm, pakt per fase anders uit bij opzeggen en moet
// per periode fiscaal worden uitgelegd; dat hoort een boekhoudpakket niet aan zijn eigen
// facturen te hebben.
//
// Los van de maandprijs geconfigureerd, en met opzet NIET in isBillingConfigured(): staat hij er
// niet, dan is er één knop minder en werkt de maandprijs gewoon door. De faalrichting is dus
// "één optie minder", nooit "de verkeerde prijs".
const STRIPE_PRICE_ID_PLUS_YEAR = (process.env.STRIPE_PRICE_ID_PLUS_YEAR || "").trim();
/** Prijs van ÉÉN bewaarjaar. Het aantal jaren gaat als `quantity` mee. */
const STRIPE_PRICE_ID_KLUIS_YEAR = (process.env.STRIPE_PRICE_ID_KLUIS_YEAR || "").trim();

// Er is hier bewust GEEN "dark switch" (BILLING_ENFORCED). Op de billing-tak schakelde die
// een betaalmuur aan of uit; wij hebben geen betaalmuur, dus er is niets om donker te
// verschepen. Ontbreken de Stripe-sleutels, dan is de uitkomst simpelweg dat de knop
// "Plus nemen" een nette 503 geeft en de rest van de app volledig blijft werken — wat zij
// sowieso doet, want gratis is hier het volwaardige plan.

/**
 * Is Stripe usable at all? Routes call this FIRST and answer with a clean 503
 * rather than throwing, so a missing key is a disabled checkout button — never
 * a 500 in the user's face.
 */
export function isBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID_PLUS !== "";
}

/**
 * [JAARPRIJS] Mag de jaarknop worden getoond? Alleen als er een jaarprijs is ingesteld.
 *
 * Een aparte vraag van isBillingConfigured(), zodat een ontbrekende jaarprijs de maandflow niet
 * meeneemt. Of die prijs ook het JUISTE bedrag int, weet alleen Stripe — dat wordt per checkout
 * gecontroleerd, niet hier: een id dat bestaat is geen id dat klopt.
 */
export function isAnnualBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID_PLUS_YEAR !== "";
}

/** Kan de Bewaarkluis worden afgerekend? Los van Plus: de een kan leven zonder de ander. */
export function isKluisBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID_KLUIS_YEAR !== "";
}

/** Is the webhook usable? Without the signing secret we must reject events. */
export function isWebhookConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_WEBHOOK_SECRET !== "";
}

// ── Plan display constants ───────────────────────────────────────────
// Live in the PURE src/lib/plan.ts (no Stripe import) because client components
// and the public homepage need them. Re-exported here so server-side callers can
// still get everything billing-related from one import.
export { PLUS, KLUIS, OFFER_NL, OFFER_SHORT_NL } from "@/lib/plan";

// ── Client ───────────────────────────────────────────────────────────

let cached: Stripe | null = null;

/**
 * The one Stripe client. Lazy so that merely importing this module never
 * throws — a route can check isBillingConfigured() and bail politely.
 *
 * The API version is pinned to whatever the installed SDK was built against
 * (apiVersion omitted). Pinning a literal here would silently diverge from the
 * SDK's types on the next upgrade, which is the billing equivalent of the
 * hard-coded-model bug this file's header warns about.
 */
export function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("[BILLING] Missing STRIPE_SECRET_KEY");
  }
  if (!cached) {
    cached = new Stripe(STRIPE_SECRET_KEY, {
      // Identifies BoekBrug in Stripe's logs — makes support tickets tractable.
      appInfo: { name: "BoekBrug", url: "https://boekbrug.nl" },
      // The app runs on Vercel's Node runtime; retry a failed network call once
      // so a blip does not surface as a broken checkout button.
      maxNetworkRetries: 1,
    });
  }
  return cached;
}

// ── Customers ────────────────────────────────────────────────────────

/**
 * Return the Stripe customer id for this profile, creating the customer on
 * first use.
 *
 * `existingId` is what our database already knows. When it is present we trust
 * it and do NOT call Stripe — the webhook keeps it accurate, and a lookup per
 * checkout is latency we do not need.
 *
 * The profile id is written into customer metadata so that a webhook holding
 * only a Stripe object can always find its way back to a BoekBrug user, even
 * if the stripe_customer_id column were somehow lost.
 */
export async function resolveCustomerId(params: {
  existingId: string | null;
  profileId: string;
  email: string | null;
  name: string | null;
}): Promise<string> {
  if (params.existingId) return params.existingId;

  const customer = await getStripe().customers.create({
    email: params.email ?? undefined,
    name: params.name ?? undefined,
    metadata: { profile_id: params.profileId },
  });
  return customer.id;
}

// ── Checkout ─────────────────────────────────────────────────────────

/**
 * A hosted Checkout session for BoekBrug Plus.
 *
 * Hosted (not embedded Elements) on purpose: Stripe then owns the card form,
 * SCA/3-D Secure, iDEAL's bank redirect and PCI scope. For a first paying
 * customer that is the whole point — no card data ever touches BoekBrug.
 */
export async function createCheckoutSession(params: {
  customerId: string;
  profileId: string;
  successUrl: string;
  cancelUrl: string;
  /** [JAARPRIJS] Per maand of per jaar. De route leest dit van de wire en weigert al wat geen
   *  van beide is — parsePlusInterval valt nooit stil terug op een van de twee. */
  interval: PlusInterval;
  /** [PROEFMAAND] Eerste maand gratis — alleen voor wie nog nooit een abonnement had.
   *  De BESLISSING valt in trialEligible (subscription.ts, puur en getest); dit bestand
   *  vertaalt haar alleen naar Stripe, zoals het hele bestand alleen Stripe spreekt. */
  withTrial: boolean;
}): Promise<Stripe.Checkout.Session> {
  const priceId = params.interval === "year" ? STRIPE_PRICE_ID_PLUS_YEAR : STRIPE_PRICE_ID_PLUS;
  if (!priceId) {
    throw new Error(
      params.interval === "year"
        ? "[BILLING] Missing STRIPE_PRICE_ID_PLUS_YEAR"
        : "[BILLING] Missing STRIPE_PRICE_ID_PLUS",
    );
  }

  // ── [PRIJS-KLOPT] Never open a checkout that charges an amount we did not publish ──────────
  //
  // The published price lives in fair-use.ts and reaches the pricing page, the Terms and the
  // billing screen from there. What Stripe actually charges lives in a price OBJECT behind an
  // environment variable, and the two have no connection whatsoever — nothing in this repo can
  // notice that they drifted. The day the constant is raised and the env var still points at the
  // old price, every page says one number and the card is debited another. That is not a bug to
  // find in a support e-mail; it is the kind a customer reports to their bank.
  //
  // So the amount is READ from Stripe and compared, at the last possible moment, per session.
  // One extra API call per checkout — a checkout already takes several — and it turns a silent
  // mismatch into a refusal that names both numbers.
  //
  // [JAARPRIJS] Since there are TWO price ids the comparison got a second half, and the second
  // half is the one a single amount check cannot see: which interval this price actually bills
  // on. Two opaque strings that look alike in a dashboard, swapped, produce €19,99 a YEAR or
  // €179,91 a MONTH — and both of those pass an amount-only test against the wrong constant.
  // The whole rule lives in plus-interval.ts because it is pure and therefore properly testable;
  // this file only fetches the object and obeys the verdict.
  const priceObject = await getStripe().prices.retrieve(priceId);
  const verdict = checkPlusPrice(params.interval, {
    unitAmount: priceObject.unit_amount,
    currency: priceObject.currency,
    type: priceObject.type,
    recurringInterval: priceObject.recurring?.interval ?? null,
    recurringIntervalCount: priceObject.recurring?.interval_count ?? null,
  });
  if (!verdict.ok) {
    throw new Error(
      `[PRIJS-KLOPT] Er wordt niets afgerekend: ${verdict.reason} Pas de prijs in Stripe aan of ` +
        `zet de gepubliceerde prijs terug — ze moeten gelijk zijn voordat er een kaart wordt belast.`,
    );
  }

  return getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // NL market: iDEAL is how the Dutch actually pay. Offering card only would
    // lose real customers at the last click. SEPA direct debit follows later —
    // it needs a mandate flow we deliberately keep out of v1.
    payment_method_types: ["ideal", "card"],
    // Legally required in NL: the customer must be able to reach the terms
    // before paying, and we must be able to prove they accepted them.
    consent_collection: { terms_of_service: "required" },
    // A subscription is a distance contract — collect a billing address so the
    // BTW invoice Stripe issues is a valid one.
    billing_address_collection: "required",
    // Business customers can put their BTW number on the invoice.
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    // The webhook reads this to find the profile without trusting any URL.
    // [PROEFMAAND] trial_period_days: Stripe int niets tot de proefmaand om is; de mandaat
    // (iDEAL→SEPA of kaart) wordt wél meteen vastgelegd, dus na de maand loopt de incasso
    // vanzelf en wie binnen de maand opzegt betaalt niets. 'trialing' komt bij de webhook
    // binnen en wordt door normalizeStripeStatus al als lopend abonnement gelezen.
    //
    // [JAARPRIJS] ALLEEN op de maandprijs. De jaarprijs start betaald, en dat is geen zuinigheid
    // maar het vermijden van een zin die niemand kan uitleggen: de proefmaand staat op /prijzen
    // beschreven als "de eerste maand gratis, daarna €19,99 per maand". Diezelfde 30 dagen op een
    // jaarabonnement betekent iets anders (dertig dagen, dán €179,91 ineens) en zou die zin voor
    // de helft van de kopers onwaar maken. De korting ÍS het jaaraanbod: twaalf maanden voor de
    // prijs van negen. Twee aanbiedingen op één knop stapelen is hoe een prijs onuitlegbaar wordt.
    subscription_data: {
      metadata: { profile_id: params.profileId },
      ...(params.withTrial && params.interval === "month"
        ? { trial_period_days: PLUS_TRIAL_DAYS }
        : {}),
    },
    metadata: { profile_id: params.profileId },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    locale: "nl",
  });
}

// ── Billing portal ───────────────────────────────────────────────────

/**
 * Stripe's hosted portal: update the card, download BTW invoices, cancel.
 *
 * Cancelling must be exactly this easy. A self-serve cancel costs one customer;
 * a cancel-by-emailing-support costs the trust of everyone who hears about it —
 * and under EU consumer law it is not optional anyway.
 */
export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
    locale: "nl",
  });
}

// ── Webhook ──────────────────────────────────────────────────────────

/**
 * Verify a webhook's signature and return the typed event.
 *
 * MUST be handed the RAW request body. Any parse-then-re-stringify in between
 * changes bytes (key order, whitespace, unicode escapes) and the signature will
 * not verify — the classic Stripe integration bug.
 *
 * Throws when the signature is absent, malformed, or outside the tolerance
 * window. Callers answer 400 and MUST NOT act on an unverified payload: this
 * endpoint is public, so without this check anyone on the internet could POST
 * "subscription.active" and help themselves to a free plan.
 */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("[BILLING] Missing STRIPE_WEBHOOK_SECRET");
  }
  if (!signature) {
    throw new Error("[BILLING] Missing stripe-signature header");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

/** Epoch seconds (Stripe's unit) → ISO string for Postgres, null-safe. */
export function epochToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Minimal structural shape of a subscription's period data. Declared instead of
 * requiring a full Stripe.Subscription so this stays unit-testable with a plain
 * object literal — Stripe.Subscription satisfies it structurally.
 */
type PeriodBearingSubscription = {
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
};

/**
 * End of the currently-paid period, as ISO — the value `current_period_end` on
 * profiles caches.
 *
 * ⚠️ READ THIS BEFORE "SIMPLIFYING" IT TO `sub.current_period_end`.
 * Every Stripe tutorial written before 2026 reads that field off the
 * subscription. On the API version this SDK ships with (2026-06-24.dahlia) it
 * DOES NOT EXIST there any more — it lives on each subscription ITEM. Reading
 * the old path yields `undefined`, which would silently store NULL, which the
 * access decision reads as "no paid period", which would cut off paying
 * customers the moment their subscription is cancelled-but-still-running. The
 * failure is invisible until it hits a real customer, so it is pinned here with
 * this comment and a test.
 *
 * Takes the LATEST end across items: a multi-item subscription is paid for
 * until its last item's period closes, and access must not end before that.
 */
export function subscriptionPeriodEnd(sub: PeriodBearingSubscription): string | null {
  const ends = (sub.items?.data ?? [])
    .map((item) => item?.current_period_end)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  if (ends.length === 0) return null;
  return epochToIso(Math.max(...ends));
}

// ── Bewaarkluis ──────────────────────────────────────────────────────

/**
 * Een eenmalige betaling voor de resterende bewaarjaren van één archief.
 *
 * `mode: "payment"` en niet `"subscription"`, en dat is de kern van het product en niet een
 * implementatiedetail. Wie stopt met zijn zaak gaat geen nieuwe doorlopende incasso
 * aanmaken voor een bedrijf dat hij net verlaat; hij wil het één keer regelen en er vanaf
 * zijn. Belangrijker nog: vooruit betalen is de enige constructie waarin wij nooit opslag
 * beloven die niet betaald is — en dus de enige waarin een belofte van zeven jaar
 * geloofwaardig is uit de mond van een bedrijf dat zelf nog geen zeven jaar bestaat.
 *
 * `years` komt uit kluisQuote() in src/lib/bewaarkluis.ts en is nooit groter dan de
 * bewaarplicht zelf. Nul jaren betekent: de bewaarplicht is voorbij, er valt niets te
 * verkopen — dat weigeren wij hier hard, zodat er nooit geld wordt gevraagd voor lucht.
 */
export async function createKluisCheckoutSession(params: {
  customerId: string;
  profileId: string;
  years: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  if (!STRIPE_PRICE_ID_KLUIS_YEAR) {
    throw new Error("[BILLING] Missing STRIPE_PRICE_ID_KLUIS_YEAR");
  }
  if (!Number.isInteger(params.years) || params.years < 1) {
    throw new Error("[BILLING] kluis checkout needs at least one bewaarjaar");
  }

  return getStripe().checkout.sessions.create({
    mode: "payment",
    customer: params.customerId,
    line_items: [{ price: STRIPE_PRICE_ID_KLUIS_YEAR, quantity: params.years }],
    payment_method_types: ["ideal", "card"],
    consent_collection: { terms_of_service: "required" },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    // Stripe stuurt bij een eenmalige betaling geen factuur tenzij je erom vraagt. Voor een
    // zakelijke klant die btw terugvraagt is die factuur het halve product.
    invoice_creation: { enabled: true },
    metadata: { profile_id: params.profileId, product: "bewaarkluis", years: String(params.years) },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    locale: "nl",
  });
}
