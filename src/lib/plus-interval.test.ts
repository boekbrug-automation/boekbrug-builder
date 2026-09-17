// src/lib/plus-interval.test.ts
// [JAARPRIJS] The money comparison that stands between two opaque environment variables and a
// real card. Every branch, and for each one the charge it prevents.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PLUS_ANNUAL_PRICE_EUR, PLUS_PRICE_EUR } from "./fair-use";
import {
  checkPlusPrice,
  parsePlusInterval,
  publishedCentsFor,
  PLUS_INTERVALS,
  type StripePriceShape,
} from "./plus-interval";

/** A price object that is correct for the given interval — every test spoils exactly one field. */
function goodPrice(interval: "month" | "year"): StripePriceShape {
  return {
    unitAmount: publishedCentsFor(interval),
    currency: "eur",
    type: "recurring",
    recurringInterval: interval,
    recurringIntervalCount: 1,
  };
}

test("[JAARPRIJS] er zijn precies twee manieren om Plus te kopen, en alles daarbuiten is een weigering", () => {
  assert.deepEqual([...PLUS_INTERVALS], ["month", "year"]);
  assert.equal(parsePlusInterval("month"), "month");
  assert.equal(parsePlusInterval("year"), "year");
  assert.equal(parsePlusInterval(" YEAR "), "year", "spatie en hoofdletters zijn geen ander plan");

  // Alles wat geen van beide is, is null — NOOIT een stille terugval. Een terugval op "month"
  // rekent iemand die "per jaar" koos maandelijks af; een terugval op "year" schrijft €179,91
  // af bij iemand die om een maand vroeg. De caller moet weigeren.
  for (const raar of ["maand", "jaar", "monthly", "yearly", "", " ", "week", "day", "MONTHS"]) {
    assert.equal(parsePlusInterval(raar), null, `"${raar}" mag geen interval opleveren`);
  }
  for (const raar of [null, undefined, 1, 12, {}, [], true, { interval: "year" }]) {
    assert.equal(parsePlusInterval(raar), null, `${JSON.stringify(raar)} mag geen interval opleveren`);
  }
});

test("[JAARPRIJS] het gepubliceerde bedrag per interval is het bedrag uit de tabel, in centen", () => {
  assert.equal(publishedCentsFor("month"), 1999);
  assert.equal(publishedCentsFor("year"), 17991);

  // Afgeleid, niet overgeschreven: verandert de gepubliceerde prijs, dan verandert dit mee. Twee
  // kopieën van één prijs gaan uiteindelijk uit elkaar lopen, en de kopie die een klant kan
  // afdwingen is de gepubliceerde.
  assert.equal(publishedCentsFor("month"), Math.round(PLUS_PRICE_EUR * 100));
  assert.equal(publishedCentsFor("year"), Math.round(PLUS_ANNUAL_PRICE_EUR * 100));

  // 179,91 = 9 × 19,99 — twaalf maanden voor de prijs van negen, narekenbaar in centen zodat
  // drijvende komma er niet tussen kan komen.
  assert.equal(publishedCentsFor("year"), publishedCentsFor("month") * 9);
});

test("[JAARPRIJS] een kloppende prijs mag afrekenen, per maand en per jaar", () => {
  assert.deepEqual(checkPlusPrice("month", goodPrice("month")), { ok: true });
  assert.deepEqual(checkPlusPrice("year", goodPrice("year")), { ok: true });
});

test("[JAARPRIJS] verwisselde prijs-id's zijn de twee fouten die geld kosten, en allebei worden ze geweigerd", () => {
  // DE MAANDPRIJS IN HET JAARVAKJE. De klant kiest "per jaar" en wordt €19,99 PER JAAR belast.
  // Niemand klaagt over te weinig betalen, dus dit loopt door tot iemand de boeken leest.
  const maandInJaar = checkPlusPrice("year", goodPrice("month"));
  assert.equal(maandInJaar.ok, false);
  assert.match(maandInJaar.ok === false ? maandInJaar.reason : "", /per month/);

  // DE JAARPRIJS IN HET MAANDVAKJE. De klant kiest "per maand" en er gaat €179,91 ELKE MAAND af.
  // Dit is de fout die bij de bank wordt gemeld, niet bij de helpdesk.
  const jaarInMaand = checkPlusPrice("month", goodPrice("year"));
  assert.equal(jaarInMaand.ok, false);
  assert.match(jaarInMaand.ok === false ? jaarInMaand.reason : "", /per year/);
});

test("[JAARPRIJS] een eenmalige prijs is geen abonnement, ook al rekent hij prima af", () => {
  // Checkout slaagt, de kaart wordt belast, en er ontstaat geen subscription — dus geen webhook,
  // dus het account gaat nooit op betaald. Iemand betaalt en krijgt niets. Dat moet vóór de
  // betaling stuklopen, niet erna.
  const verdict = checkPlusPrice("month", {
    ...goodPrice("month"),
    type: "one_time",
    recurringInterval: null,
    recurringIntervalCount: null,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : "", /geen abonnement/);
});

test("[JAARPRIJS] 'elke drie maanden' is een geldige Stripe-prijs en een ongeldige BoekBrug-prijs", () => {
  const verdict = checkPlusPrice("month", { ...goodPrice("month"), recurringIntervalCount: 3 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : "", /3 month/);

  // En een ontbrekende telling telt niet als 1: onbekend is onbekend.
  assert.equal(checkPlusPrice("month", { ...goodPrice("month"), recurringIntervalCount: null }).ok, false);
});

test("[JAARPRIJS] 19,99 dollar is niet 19,99 euro", () => {
  const verdict = checkPlusPrice("month", { ...goodPrice("month"), currency: "usd" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : "", /usd/);
  assert.equal(checkPlusPrice("month", { ...goodPrice("month"), currency: "EUR" }).ok, false,
    "Stripe schrijft de valuta kleingeschreven; iets anders is niet het veld dat wij denken te lezen");
});

test("[JAARPRIJS] een bedrag dat niet is gepubliceerd rekent niet af — in geen van beide richtingen", () => {
  for (const cents of [1299, 1998, 2000, 2499, 0, 17990, 17992, 19999]) {
    const verdict = checkPlusPrice("month", { ...goodPrice("month"), unitAmount: cents });
    if (cents === 1999) continue;
    assert.equal(verdict.ok, false, `${cents} cent mag niet als maandprijs door`);
  }
  // Ook één cent te weinig is een weigering. Dit is geen afrondingscontrole maar een gelijkheid:
  // "bijna het gepubliceerde bedrag" bestaat niet bij geld.
  assert.equal(checkPlusPrice("year", { ...goodPrice("year"), unitAmount: 17990 }).ok, false);
  assert.equal(checkPlusPrice("year", { ...goodPrice("year"), unitAmount: null }).ok, false);
  assert.equal(checkPlusPrice("year", { ...goodPrice("year"), unitAmount: undefined }).ok, false);
});

test("[JAARPRIJS] een leeg prijsobject komt er niet doorheen — de controle faalt DICHT", () => {
  // Anders dan bijna elke poort in deze app faalt deze niet open. Een weigering kost één verkoop
  // en is binnen een minuut zichtbaar; doorlaten op een prijs die wij niet konden lezen belast
  // een echte kaart met een bedrag dat nergens staat.
  const leeg: StripePriceShape = {
    unitAmount: null, currency: null, type: null,
    recurringInterval: null, recurringIntervalCount: null,
  };
  assert.equal(checkPlusPrice("month", leeg).ok, false);
  assert.equal(checkPlusPrice("year", leeg).ok, false);
});
