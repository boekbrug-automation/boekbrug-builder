// [BILLING] Pure node test — run: npx tsx --test src/lib/subscription.test.ts
//
// Elke test hier legt een toezegging vast die in de Algemene Voorwaarden §5 of op
// /eerlijk-gebruik staat. De belangrijkste is de laatste groep: er bestaat in deze module
// GEEN functie die iemand de toegang kan ontzeggen, en dat hoort zo te blijven.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daysUntil,
  decidePlan,
  isKnownStatus,
  limitsPlanFor,
  normalizeStripeStatus,
  parseTimestamp,
  type PlanInput,
} from "./subscription";
import * as subscription from "./subscription";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const base: PlanInput = {
  role: "zzper",
  subscriptionStatus: null,
  currentPeriodEnd: null,
  nowMs: NOW,
};

test("de boekhouder valt altijd buiten elke grens, wat zijn status ook is", () => {
  for (const status of ["none", "canceled", "unpaid", "incomplete", null, "onzin"]) {
    const d = decidePlan({ ...base, role: "accountant", subscriptionStatus: status });
    assert.equal(d.plan, "boekhouder", `status ${status} mag het portaal niet raken`);
    assert.equal(d.reason, "boekhouder");
  }
});

test("een gewone ondernemer zonder abonnement zit op gratis — en dat is geen gebrek", () => {
  const d = decidePlan(base);
  assert.equal(d.plan, "free");
  assert.equal(d.reason, "free");
});

test("wie betaalt krijgt de ruimere grenzen", () => {
  assert.equal(decidePlan({ ...base, subscriptionStatus: "active" }).plan, "plus");
});

test("een haperende incasso zet niemand terug naar gratis", () => {
  // Een verlopen kaart is een herstelbaar probleem; het als opzegging behandelen maakt er
  // een echte opzegging van.
  for (const status of ["past_due", "paused"]) {
    const d = decidePlan({ ...base, subscriptionStatus: status });
    assert.equal(d.plan, "plus", `status ${status} moet Plus laten staan`);
    assert.equal(d.reason, "grace_period");
  }
});

test("na opzegging loopt Plus tot het einde van de betaalde periode", () => {
  const morgen = new Date(NOW + 86_400_000).toISOString();
  const gisteren = new Date(NOW - 86_400_000).toISOString();

  assert.equal(
    decidePlan({ ...base, subscriptionStatus: "canceled", currentPeriodEnd: morgen }).plan,
    "plus",
    "die dagen zijn betaald, dus die dagen krijgt hij",
  );
  assert.equal(
    decidePlan({ ...base, subscriptionStatus: "canceled", currentPeriodEnd: gisteren }).plan,
    "free",
  );
});

test("bij twijfel geldt gratis — en dat kost niemand toegang", () => {
  // De faalrichting is bewust 'free' en niet 'plus'. Dat is veilig omdat evaluateFairUse()
  // zelf al open faalt op een kapotte teller, én omdat 'free' niets afsluit: lezen, zoeken
  // en exporteren blijven altijd werken.
  assert.equal(decidePlan({ ...base, subscriptionStatus: null }).plan, "free");
  assert.equal(decidePlan({ ...base, subscriptionStatus: "iets_nieuws_van_stripe" }).plan, "free");
  assert.equal(decidePlan({ ...base, currentPeriodEnd: "geen-datum" }).plan, "free");
  assert.equal(decidePlan({ ...base, role: null }).plan, "free");
});

test("een onleesbare datum leest nooit als verlopen", () => {
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp(""), null);
  assert.equal(parseTimestamp("morgen"), null);
  assert.equal(parseTimestamp("2026-07-26T12:00:00.000Z"), NOW);
});

test("resterende dagen worden naar boven afgerond", () => {
  assert.equal(daysUntil(NOW + 6 * 3_600_000, NOW), 1, "zes uur is 'nog 1 dag', niet 'nog 0'");
  assert.equal(daysUntil(NOW - 1000, NOW), 0, "verstreken is 0, nooit negatief");
});

test("een onbekende Stripe-status kan hooguit gratis opleveren", () => {
  assert.equal(normalizeStripeStatus("actief_maar_anders"), "none");
  assert.equal(normalizeStripeStatus(null), "none");
  assert.equal(normalizeStripeStatus("incomplete_expired"), "canceled");
  assert.equal(normalizeStripeStatus("trialing"), "active");
  assert.equal(decidePlan({ ...base, subscriptionStatus: normalizeStripeStatus("wat?") }).plan, "free");
  assert.equal(isKnownStatus("active"), true);
  // [EERLIJK-WOORD] 'trialing' blijft herkend, ook nu WIJ er nooit meer om vragen.
  //
  // De proefmaand is weg uit de checkout (geen trial_period_days meer), maar Stripe mag die
  // status om eigen redenen sturen: een handmatige proef in het dashboard, een coupon, een
  // migratie. Zou normalizeStripeStatus hem niet meer kennen, dan valt hij door naar 'none' en
  // staat een BETALENDE klant op het gratis plan. Niet meer aanbieden is iets anders dan niet
  // meer herkennen, en alleen het eerste is hier gebeurd.
  //
  // Het blijft geen OPGESLAGEN toestand: hij wordt genormaliseerd naar 'active' en DAT wordt
  // bewaard — één toestandsruimte minder om fout te kunnen zijn.
  assert.equal(isKnownStatus("trialing"), false, "trialing wordt genormaliseerd, nooit opgeslagen");
});

test("de boekhouder wordt voor de grenzen als Plus behandeld, niet als gratis", () => {
  assert.equal(limitsPlanFor("boekhouder"), "plus");
  assert.equal(limitsPlanFor("plus"), "plus");
  assert.equal(limitsPlanFor("free"), "free");
});

test("er bestaat in deze module niets dat iemand kan buitensluiten", () => {
  // Dit is de belangrijkste test van het bestand. Op de billing-tak stonden hier
  // decideAccess(), trialBanner(), ARCHIVE_PATHS/isArchivePath() en isBillingEnforced():
  // samen een betaalmuur met een proefklok. Die horen niet bij het model dat wij publiek
  // hebben vastgelegd, en als ze terugkeren moet dat een BEWUSTE daad zijn die deze test
  // laat struikelen — niet iets dat er stilletjes bij komt bij een volgende samenvoeging.
  const verboden = [
    "decideAccess",
    "trialBanner",
    "isArchivePath",
    "ARCHIVE_PATHS",
    "isBillingEnforced",
    // [EERLIJK-WOORD] trialEligible hoort sinds 17 september 2026 in dezelfde lijst. Hij
    // beantwoordde één vraag — "heeft dit account al eens een abonnement gehad?" — om te
    // beslissen of de checkout 30 gratis dagen meegaf. Er valt niets meer te beslissen: gratis
    // IS de proef en wie afrekent betaalt vanaf dag één. Een functie die nog bestaat maar
    // niemand aanroept is de volgende die per ongeluk weer wordt aangeroepen, en een tweede
    // proef bovenop de gratis werkplek verbergt precies de proef die wij wél hebben.
    "trialEligible",
  ];
  for (const naam of verboden) {
    assert.equal(
      naam in subscription,
      false,
      `${naam} hoort hier niet: de app kent geen betaalmuur — verlopen betekent terugvallen naar gratis, nooit een slot`,
    );
  }
  // En geen enkele beslissing die deze module wél neemt mag een 'geweigerd' kennen.
  const alleUitkomsten = [
    decidePlan(base),
    decidePlan({ ...base, role: "accountant" }),
    decidePlan({ ...base, subscriptionStatus: "canceled" }),
  ];
  for (const d of alleUitkomsten) {
    assert.ok(["free", "plus", "boekhouder"].includes(d.plan));
  }
});

// ─── [TOEKENNING] A running grant gives Plus — but never louder than a paid subscription ───────
//
// The welcome period, an office pilot and a support extension all arrive here as the same two
// facts: an end date, or "open-ended". What matters is WHERE in decidePlan they are read.

const NU = Date.parse("2026-09-12T12:00:00Z");
const overDagen = (n: number) => new Date(NU + n * 86_400_000).toISOString();

test("[TOEKENNING] a running grant is Plus, and says why", () => {
  const decision = decidePlan({
    role: "zzper", subscriptionStatus: null, currentPeriodEnd: null,
    grantedPlusUntil: overDagen(45), nowMs: NU,
  });
  assert.equal(decision.plan, "plus");
  assert.equal(decision.reason, "toekenning");
});

test("[TOEKENNING] an open-ended grant needs no date", () => {
  const decision = decidePlan({
    role: "zzper", subscriptionStatus: null, currentPeriodEnd: null,
    grantedPlusUntil: null, grantOpenEnded: true, nowMs: NU,
  });
  assert.equal(decision.plan, "plus");
  assert.equal(decision.reason, "toekenning");
});

test("[TOEKENNING] a paying customer is 'active', never 'toekenning'", () => {
  // The ordering that matters on screen: this reason drives the label, and telling a subscriber
  // his period ends in 45 days is telling him his subscription ends.
  const decision = decidePlan({
    role: "zzper", subscriptionStatus: "active", currentPeriodEnd: overDagen(20),
    grantedPlusUntil: overDagen(45), nowMs: NU,
  });
  assert.equal(decision.reason, "active");

  // Same for the grace period: a failed card is not a welcome period.
  assert.equal(
    decidePlan({
      role: "zzper", subscriptionStatus: "past_due", currentPeriodEnd: null,
      grantedPlusUntil: overDagen(45), nowMs: NU,
    }).reason,
    "grace_period",
  );
});

test("[TOEKENNING] an expired, absent or unreadable grant is simply free", () => {
  for (const until of [overDagen(-1), null, undefined, "", "binnenkort"]) {
    const decision = decidePlan({
      role: "zzper", subscriptionStatus: null, currentPeriodEnd: null,
      grantedPlusUntil: until as string | null, nowMs: NU,
    });
    assert.equal(decision.plan, "free", `grant "${String(until)}" was read as Plus`);
    assert.equal(decision.reason, "free");
  }
});

test("[TOEKENNING] an accountant is still 'boekhouder', grant or no grant", () => {
  // The portal is free without limits; a welcome period there would be an expiry date that
  // frightens someone for no reason.
  assert.equal(
    decidePlan({
      role: "accountant", subscriptionStatus: null, currentPeriodEnd: null,
      grantedPlusUntil: overDagen(45), nowMs: NU,
    }).reason,
    "boekhouder",
  );
});
