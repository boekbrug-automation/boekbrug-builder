// [PRIJS-MOMENT] Pure node test — run: npx tsx --test src/lib/subscription-price.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  readChargedPrice, chargedEuros, payingOldTariff, priceFromSubscription,
  type PricedProfile,
} from "./subscription-price";
import { PLUS_PRICE_EUR } from "./fair-use";

const row = (over: Partial<PricedProfile> = {}): PricedProfile => ({
  subscription_price_cents: 1999,
  subscription_price_currency: "eur",
  subscription_priced_at: "2026-09-13T10:00:00Z",
  ...over,
});

test("[PRIJS-MOMENT] a recorded price reads back exactly as it was recorded", () => {
  const p = readChargedPrice(row());
  assert.ok(p);
  assert.equal(p.cents, 1999);
  assert.equal(p.currency, "eur");
  assert.equal(chargedEuros(p), 19.99);
});

test("[PRIJS-MOMENT] no record is NULL, never today's published price", () => {
  // The whole point. A fallback to PLUS_PRICE_EUR would show the right number on every day
  // except the days it matters, and nobody would ever see it be wrong.
  for (const missing of [null, undefined, ""]) {
    assert.equal(readChargedPrice(row({ subscription_price_cents: missing as number | null })), null);
  }
  assert.equal(readChargedPrice(null), null);
  assert.equal(readChargedPrice(undefined), null);
  assert.equal(readChargedPrice({}), null);
});

test("[PRIJS-MOMENT] zero is not a price, and neither is a fraction of a cent", () => {
  // "€ 0,00 per maand" beside a running direct debit is the most confident possible lie.
  assert.equal(readChargedPrice(row({ subscription_price_cents: 0 })), null);
  assert.equal(readChargedPrice(row({ subscription_price_cents: -1999 })), null);
  assert.equal(readChargedPrice(row({ subscription_price_cents: 19.5 })), null);
  assert.equal(readChargedPrice(row({ subscription_price_cents: "onbekend" })), null);
});

test("[PRIJS-MOMENT] a currency we do not book is refused, not rendered with a euro sign", () => {
  // 19,99 dollars is not 19,99 euro, and the € would be ours, not Stripe's.
  for (const cur of ["usd", "USD", "", null, "gbp"]) {
    assert.equal(readChargedPrice(row({ subscription_price_currency: cur })), null, `${cur} passed`);
  }
  // Stripe lower-cases its currencies; so do we, so casing alone never refuses a real price.
  assert.ok(readChargedPrice(row({ subscription_price_currency: "EUR" })));
});

test("[PRIJS-MOMENT] today the agreement and the offer are the same number", () => {
  // A guard on the premise of the whole file: while these are equal, showing the published price
  // to a subscriber happens to be true. The test exists so the day that stops being so is loud.
  const p = readChargedPrice(row({ subscription_price_cents: Math.round(PLUS_PRICE_EUR * 100) }))!;
  assert.equal(payingOldTariff(p, PLUS_PRICE_EUR), false);
});

test("[PRIJS-MOMENT] a raised published price leaves an existing subscription on its own tariff", () => {
  const p = readChargedPrice(row({ subscription_price_cents: 1999 }))!;
  assert.equal(payingOldTariff(p, 24.99), true, "a raise did not register as a different tariff");
  assert.equal(payingOldTariff(p, 14.99), true, "a lowering did not register either");
  // Nothing recorded is not "the same" — it is nothing, and no screen may claim either way.
  assert.equal(payingOldTariff(null, 24.99), false);
});

test("[PRIJS-MOMENT] the amount is read off the subscription ITEM, like the period end beside it", () => {
  assert.deepEqual(
    priceFromSubscription({ items: { data: [{ price: { unit_amount: 1999, currency: "eur" } }] } }),
    { cents: 1999, currency: "eur" },
  );
  // Every tutorial written before 2026 reaches for sub.plan / sub.price. Those are not read here,
  // and a shape that only carries them yields nothing rather than a wrong number.
  assert.equal(priceFromSubscription({ items: { data: [] } }), null);
  assert.equal(priceFromSubscription({ items: null }), null);
  assert.equal(priceFromSubscription(null), null);
  assert.equal(priceFromSubscription({ items: { data: [{ price: null }] } }), null);
  assert.equal(priceFromSubscription({ items: { data: [{ price: { unit_amount: null, currency: "eur" } }] } }), null);
  assert.equal(priceFromSubscription({ items: { data: [{ price: { unit_amount: 1999, currency: null } }] } }), null);
});

test("[PRIJS-MOMENT] an unreadable item is skipped, not allowed to blank the record", () => {
  // The webhook writes nothing when this is null, so a single odd answer from Stripe must not be
  // able to erase what we knew yesterday — and a readable item behind an unreadable one counts.
  assert.deepEqual(
    priceFromSubscription({ items: { data: [null, { price: { unit_amount: 0, currency: "eur" } }, { price: { unit_amount: 2499, currency: "EUR" } }] } }),
    { cents: 2499, currency: "eur" },
  );
});
