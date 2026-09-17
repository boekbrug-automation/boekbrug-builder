// src/lib/plus-interval.ts
// [JAARPRIJS] Which Plus is being bought — per month or per year — and whether the Stripe price
// object behind that choice is allowed to charge for it.
//
// ── WHY THIS IS A PURE MODULE AND NOT THREE LINES IN billing.ts ──
// Everything here is a decision about MONEY that can be made without a network call, and money
// decisions that can be tested are money decisions that get tested. billing.ts owns the Stripe
// client and cannot be unit-tested without one; this file owns the rule and needs nothing. So
// billing.ts fetches the price object and hands it here, and every way the comparison can be
// wrong is pinned in plus-interval.test.ts against numbers rather than mocks.
//
// ── THE RULE, IN ONE SENTENCE ──
// A checkout may open only when the Stripe price it will charge is a RECURRING price, in EUR,
// whose interval is exactly the one the customer chose, whose interval_count is 1, and whose
// unit_amount is the amount BoekBrug publishes for that interval.
//
// Every clause is there because dropping it produces a real, specific wrong charge. The two
// environment variables are two opaque strings that look alike in a dashboard, and nothing but
// this comparison connects either of them to a number on a page:
//
//   · the MONTHLY price id in the annual slot — someone picks "per jaar" and is billed €19,99
//     ONCE A YEAR. Nobody complains, so it runs until the books are read;
//   · the ANNUAL price id in the monthly slot — someone picks "per maand" and €179,91 leaves
//     their account EVERY MONTH. That is not a bug you hear about in a support mail; it is one
//     the customer reports to their bank;
//   · interval_count 3 on a monthly price — billed quarterly at the monthly amount;
//   · a one-off (non-recurring) price — checkout succeeds, no subscription is ever created, and
//     the webhook never marks the account as paying, so someone pays and gets nothing;
//   · USD — 19,99 dollars is not 19,99 euro.
//
// ── THE REFUSAL TEXT IS DUTCH, INSIDE AN ENGLISH FILE ──
// Deliberate, per AGENTS.md: it is not a developer message. It is thrown, logged and read by the
// owner when a checkout will not open, next to the existing [PRIJS-KLOPT] sentence in billing.ts
// which is Dutch for the same reason. A customer never sees it — the route answers with its own
// sentence — so what matters is that the person who has to FIX it can read it.

import { PLUS_ANNUAL_PRICE_EUR, PLUS_PRICE_EUR } from "./fair-use";

/** The two ways to buy Plus. There is no third, and an unknown value is never one of these. */
export type PlusInterval = "month" | "year";

export const PLUS_INTERVALS: readonly PlusInterval[] = ["month", "year"];

/**
 * Read an interval off the wire.
 *
 * Returns null for anything that is not exactly one of the two. The caller must REFUSE on null
 * rather than fall back: a silent default is how "per jaar" becomes a monthly charge, or worse.
 * An absent value is a different case and the caller decides that one — the existing button
 * posts no body at all and means "month".
 */
export function parsePlusInterval(raw: unknown): PlusInterval | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  return cleaned === "month" || cleaned === "year" ? cleaned : null;
}

/** What BoekBrug publishes for that interval, in cents — the number the card must be debited. */
export function publishedCentsFor(interval: PlusInterval): number {
  const euro = interval === "year" ? PLUS_ANNUAL_PRICE_EUR : PLUS_PRICE_EUR;
  return Math.round(euro * 100);
}

/**
 * The shape of a Stripe Price, flattened — so this module never imports the Stripe SDK and a test
 * never has to build one. billing.ts does the flattening at the one place it holds the object.
 */
export interface StripePriceShape {
  unitAmount: number | null | undefined;
  currency: string | null | undefined;
  /** Stripe's price.type: "recurring" or "one_time". */
  type: string | null | undefined;
  /** price.recurring?.interval — "month", "year", "week", "day", or absent on a one-off. */
  recurringInterval: string | null | undefined;
  /** price.recurring?.interval_count — how many of those per billing period. */
  recurringIntervalCount: number | null | undefined;
}

export type PlusPriceVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May this price object charge for this interval?
 *
 * Fails CLOSED, unlike most gates in this app, and that is the right direction here: refusing a
 * checkout costs one sale and is visible within minutes; opening one on a price we could not
 * verify debits a real card for an amount nobody published.
 */
export function checkPlusPrice(interval: PlusInterval, price: StripePriceShape): PlusPriceVerdict {
  if (price.type !== "recurring") {
    return {
      ok: false,
      reason:
        `deze prijs is geen abonnement (type "${price.type ?? "onbekend"}"). Een eenmalige prijs ` +
        `rekent wél af maar maakt geen abonnement aan: er komt dan nooit een webhook die het ` +
        `account op betaald zet, dus iemand betaalt en krijgt niets.`,
    };
  }

  if (price.recurringInterval !== interval) {
    return {
      ok: false,
      reason:
        `deze prijs loopt per ${price.recurringInterval ?? "onbekend"}, maar er is gekozen voor ` +
        `per ${interval}. Controleer of STRIPE_PRICE_ID_PLUS en STRIPE_PRICE_ID_PLUS_YEAR niet ` +
        `zijn verwisseld.`,
    };
  }

  // Stripe's own default is 1 and the field is required on a recurring price, but "every 3
  // months at the monthly amount" is a valid Stripe price and an invalid BoekBrug one.
  if (price.recurringIntervalCount !== 1) {
    return {
      ok: false,
      reason:
        `deze prijs loopt per ${price.recurringIntervalCount ?? "onbekend"} ${interval}, en ` +
        `BoekBrug publiceert één bedrag per ${interval}.`,
    };
  }

  if (price.currency !== "eur") {
    return {
      ok: false,
      reason: `deze prijs staat in ${price.currency ?? "onbekend"} en BoekBrug publiceert euro.`,
    };
  }

  const published = publishedCentsFor(interval);
  if (price.unitAmount !== published) {
    return {
      ok: false,
      reason:
        `Stripe zou ${price.unitAmount ?? "onbekend"} cent incasseren en BoekBrug publiceert ` +
        `${published} cent per ${interval}.`,
    };
  }

  return { ok: true };
}
