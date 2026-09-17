// src/lib/plan.test.ts
// [BILLING] The strings a buyer reads at the moment they are asked to commit.
//
// WHY THIS FILE EXISTS
// plan.ts is pure, 85 lines, and was the only pure money-facing module in src/lib with no test of
// its own. That matters more than its size: these strings are not decoration, they are the offer.
// OFFER_NL is pasted wherever someone is asked to bind themselves, and the checkout makes the
// customer accept the Algemene Voorwaarden in the same flow.
//
// The defect this guards against already happened. On the billing branch plan.ts carried its own
// `priceLabel: "€ 12,00"` while the binding terms on this branch published € 12,99. Two amounts in
// one purchase, and the file's own header records why that is not a cosmetic problem: ambiguity in
// your own general terms is construed against you. So the assertions below are not "does it
// format" — they are "does the number a buyer sees still equal the number we are bound to".

import test from "node:test";
import assert from "node:assert/strict";

import { eur, KLUIS_PREPAY_YEAR_PRICE_EUR, KLUIS_YEAR_PRICE_EUR } from "./bewaarkluis";
import { PLUS_ANNUAL_PRICE_EUR, PLUS_PRICE_EUR } from "./fair-use";
import { KLUIS, OFFER_NL, OFFER_SHORT_NL, PLUS } from "./plan";

/** The one Dutch notation this product publishes: "€ 19,99". */
const nl = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

test("the Plus prices are derived from fair-use, never typed here", () => {
  // If someone re-types a literal into plan.ts, this is the line that fails — which is the whole
  // point, because nothing else would. A wrong label renders perfectly.
  assert.equal(PLUS.priceLabel, nl(PLUS_PRICE_EUR));

  // [JAARPRIJS] And the annual one, which is now published in the same three places as the
  // monthly one (pricing page, /eerlijk-gebruik, Terms §5.1) and can therefore drift in the
  // same three ways.
  assert.equal(PLUS.annualPriceLabel, nl(PLUS_ANNUAL_PRICE_EUR));
  assert.equal(
    Math.round(PLUS_PRICE_EUR * 9 * 100) / 100,
    PLUS_ANNUAL_PRICE_EUR,
    "twelve months for the price of nine — if the monthly price moves, an annual price that " +
      "quietly stopped being that promise is caught here",
  );
});

test("the Bewaarkluis labels are derived from bewaarkluis.ts, both of them", () => {
  // Two amounts that differ by design (prepaid is cheaper). Swapping them is invisible on screen
  // and overcharges anyone who paid up front — the customer least likely to be refunded quietly.
  //
  // Compared through bewaarkluis's own `eur`, not the `nl` helper above: that formatter drops the
  // decimals on a whole amount ("€ 24", not "€ 24,00"), and asserting the other notation would be
  // this test inventing a rule the product does not follow.
  assert.equal(KLUIS.perYearLabel, eur(KLUIS_YEAR_PRICE_EUR));
  assert.equal(KLUIS.perYearPrepaidLabel, eur(KLUIS_PREPAY_YEAR_PRICE_EUR));
  assert.ok(
    KLUIS_PREPAY_YEAR_PRICE_EUR < KLUIS_YEAR_PRICE_EUR,
    "paying up front must stay cheaper than paying per year, or §5.7.4 is selling the wrong one",
  );
});

test("both offer sentences quote the same Plus amount as the plan itself", () => {
  // The short form goes on buttons and subtitles, the long form next to the commit action. They are
  // built separately, so they can drift separately.
  assert.ok(OFFER_NL.includes(PLUS.priceLabel), "the full offer must quote the derived price");
  assert.ok(OFFER_SHORT_NL.includes(PLUS.priceLabel), "the short offer must quote the same one");
  assert.ok(OFFER_NL.includes(PLUS.annualPriceLabel), "and the annual price, derived the same way");
  assert.ok(OFFER_SHORT_NL.includes(PLUS.annualPriceLabel), "in both forms");
});

test("no euro amount appears in the offer that is not one of the published prices", () => {
  // The broad net. Any € figure in buyer-facing copy must be traceable to a constant — a second
  // amount slipped into a sentence is exactly the € 12,00 / € 12,99 defect in its next disguise.
  const published = new Set([
    nl(PLUS_PRICE_EUR),
    nl(PLUS_ANNUAL_PRICE_EUR),
    eur(KLUIS_YEAR_PRICE_EUR),
    eur(KLUIS_PREPAY_YEAR_PRICE_EUR),
  ]);
  for (const sentence of [OFFER_NL, OFFER_SHORT_NL]) {
    for (const found of sentence.match(/€\s?\d+[.,]\d{2}/g) ?? []) {
      assert.ok(
        published.has(found.replace(/€\s?/, "€ ")),
        `${found} appears in buyer-facing copy but is not a published price`,
      );
    }
  }
});

test("the offer still promises the three things that make the free tier trustworthy", () => {
  // These are commitments, not marketing: §5.2 and §5.6 bind us to all three. A rewrite that drops
  // one leaves the Terms promising something the purchase screen no longer says.
  assert.match(OFFER_NL, /Geen proefperiode/);
  assert.match(OFFER_NL, /geen automatische afschrijving/);
  assert.match(OFFER_NL, /geen betaalmuur voor je eigen gegevens/);
});

test("[EERLIJK-WOORD] the offer leads with trying it free, and does not call free the product", () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE PRODUCT, and the comment said so out loud: "if a future
  // edit opens with the price, the sentence describes a paid product with a free trial — which is
  // precisely what this one is not." As of 17 September 2026 that IS what this one is. Free became
  // the trial workspace and Plus became the thing you run a business on, so a sentence opening
  // with "Gratis voor de ondernemer" now promises something the app stopped doing.
  //
  // What survives is the reason the old assertion existed: the first clause is what a reader
  // keeps, so it must still be the free door and not the price. "Gratis uitproberen" is both —
  // it leads with free AND says what free is for.
  assert.match(OFFER_NL, /^Gratis uitproberen/);
  assert.match(OFFER_SHORT_NL, /^Gratis uitproberen/);

  // And the old framing must not come back by habit: "gratis voor de ondernemer" was the exact
  // wording that made free sound permanent.
  assert.doesNotMatch(OFFER_NL, /Gratis voor de ondernemer/i);
});

test("the accountant band is not re-typed into the buyer-facing copy", () => {
  // accountant-pricing.ts is prepared and NOT active. An amount from it appearing in an offer
  // sentence would advertise a price nobody has been given 30 days' notice of (§5.8.1).
  for (const amount of ["49", "89", "149"]) {
    assert.ok(
      !OFFER_NL.includes(`€ ${amount},00`) && !OFFER_SHORT_NL.includes(`€ ${amount},00`),
      `the inactive accountant band (€ ${amount}) must not be advertised as a live price`,
    );
  }
});
