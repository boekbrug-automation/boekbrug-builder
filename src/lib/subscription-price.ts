// src/lib/subscription-price.ts
// [PRIJS-MOMENT] What THIS account is charged, as opposed to what we publish today.
// Pure, no I/O. Run: npx tsx --test src/lib/subscription-price.test.ts
//
// ── TWO NUMBERS THAT LOOK LIKE ONE ──────────────────────────────────────────────────────────
//
// PLUS_PRICE_EUR (fair-use.ts) is THE OFFER: what a new customer would pay if they subscribed
// now. It reaches the pricing page, the Terms, /eerlijk-gebruik and the billing screen.
//
// subscription_price_cents (profiles) is THE AGREEMENT: what Stripe actually debits this
// subscription, read from its own price object.
//
// Today they are the same number, and that is exactly why this file is easy to get wrong. They
// diverge the moment the published price changes: Stripe keeps charging an existing subscription
// against the price object it was created on, while every screen would go on rendering the new
// constant. The owner then reads one amount and sees another leave their account — and the app
// has no way to notice, because nothing in it ever recorded what was agreed.
//
// [PRIJS-KLOPT] in billing.ts guards the moment of BUYING (the checkout refuses to open if Stripe
// and the published price disagree). It cannot guard the years afterwards; only a record can.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────
//
// Not a price freeze. §5.5 of the Terms keeps the ordinary tariff arrangement: 30 days' notice by
// e-mail, free cancellation before the effective date. Only LIMITS are inalienable (§5.5.1, see
// fair-use-history.ts). A reader looking here for grandfathered pricing will not find it, because
// it was never promised.
//
// ── AND WHAT IT REFUSES TO GUESS ────────────────────────────────────────────────────────────
//
// A subscription whose price was never recorded returns null, and the screen then says where the
// amount can be found instead of naming one. Falling back to the published price would be the
// original defect with a helpful face on it: it would show the right number on every day except
// the days it matters, and nobody would ever see it be wrong.

/** The agreement, as it was last read from Stripe. */
export interface ChargedPrice {
  /** Minor units, exactly as Stripe reports unit_amount. */
  cents: number;
  /** Lower-case ISO currency, as Stripe reports it. */
  currency: string;
  /** When it was last read, ISO, or null when the row predates the column. */
  readAt: string | null;
}

/** A profiles row, as far as this module is concerned. Primitives, including null. */
export interface PricedProfile {
  subscription_price_cents?: number | string | null;
  subscription_price_currency?: string | null;
  subscription_priced_at?: string | null;
}

/**
 * What this account is charged, or null when we do not know.
 *
 * STRICT on purpose. Zero cents is not a price — it is a free row, a half-written record or a
 * column that was added and never filled — and a screen that reads it as "€ 0,00 per maand" tells
 * an owner they pay nothing while the direct debit runs. Same for a currency we do not recognise:
 * 19,99 dollars is not 19,99 euro, and rendering it with a € in front is worse than saying nothing.
 */
export function readChargedPrice(row: PricedProfile | null | undefined): ChargedPrice | null {
  if (!row) return null;
  const raw = row.subscription_price_cents;
  if (raw === null || raw === undefined) return null;
  const cents = Number(raw);
  if (!Number.isFinite(cents) || !Number.isInteger(cents) || cents <= 0) return null;

  const currency = (row.subscription_price_currency ?? "").trim().toLowerCase();
  if (currency !== "eur") return null;

  const readAt = typeof row.subscription_priced_at === "string" && row.subscription_priced_at.trim()
    ? row.subscription_priced_at
    : null;
  return { cents, currency, readAt };
}

/** The agreement in euros, for a screen that formats money. */
export function chargedEuros(price: ChargedPrice): number {
  return price.cents / 100;
}

/**
 * Does what this account pays differ from what we publish today?
 *
 * The one question a screen has to answer before it dares show the published number: while these
 * are equal, "Prijs: € 19,99" is true for everyone; the day they are not, it is true for nobody
 * who subscribed before the change.
 */
export function payingOldTariff(price: ChargedPrice | null, publishedEur: number): boolean {
  if (!price) return false;
  const published = Math.round(publishedEur * 100);
  if (!Number.isFinite(published)) return false;
  return price.cents !== published;
}

/**
 * The figures to record, read off a Stripe subscription's first item — or null.
 *
 * Takes the shape rather than the SDK type, like subscriptionPeriodEnd() beside it, so the rule
 * can be tested without a Stripe fixture. Null when the subscription carries no readable amount:
 * the webhook then leaves the columns alone rather than overwriting a real record with a blank,
 * because "Stripe answered oddly once" must not erase what we knew yesterday.
 */
export function priceFromSubscription(sub: {
  items?: { data?: Array<{ price?: { unit_amount?: number | null; currency?: string | null } | null } | null> } | null;
} | null | undefined): { cents: number; currency: string } | null {
  for (const item of sub?.items?.data ?? []) {
    const amount = item?.price?.unit_amount;
    const currency = item?.price?.currency;
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0 && typeof currency === "string" && currency) {
      return { cents: Math.round(amount), currency: currency.toLowerCase() };
    }
  }
  return null;
}
