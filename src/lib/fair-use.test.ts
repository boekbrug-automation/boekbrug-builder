// [FAIR-USE] Pure node test — run: npx tsx --test src/lib/fair-use.test.ts
//
// Legt de beloftes vast die we publiek doen. Elke test hieronder komt overeen met een zin
// op /eerlijk-gebruik; gaat er één stuk, dan klopt onze gepubliceerde tekst niet meer.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALWAYS_FREE,
  evaluateFairUse,
  FAIR_USE_LIMITS,
  fairUseLimit,
  fairUseTableMarkdown,
  formatLimit,
  NEAR_LIMIT_RATIO,
  PLUS_PRICE_EUR,
} from "./fair-use";

test("een normale kleine ondernemer blijft ruim binnen het gratis plan", () => {
  // Een winkel met ~40 inkoopbonnen en 12 verkoopfacturen per maand.
  const status = evaluateFairUse({
    aiDocuments: 40,
    invoicesSent: 12,
    storageMb: 300,
    mailboxes: 1,
    administrations: 1,
  });
  assert.equal(status.withinLimits, true);
  assert.deepEqual(status.exceeded, []);
});

test("bij 80% van een grens waarschuwen we, maar blokkeren we niet", () => {
  const limit = fairUseLimit("aiDocuments");
  const status = evaluateFairUse({ aiDocuments: Math.ceil(limit.free * NEAR_LIMIT_RATIO) });
  assert.equal(status.withinLimits, true, "waarschuwen is geen blokkeren");
  assert.ok(status.nearLimit.includes("aiDocuments"));
});

test("precies op de grens is nog binnen de grens", () => {
  const limit = fairUseLimit("invoicesSent");
  const status = evaluateFairUse({ invoicesSent: limit.free });
  assert.equal(status.withinLimits, true);
  assert.equal(status.exceeded.includes("invoicesSent"), false);
});

test("één document boven de grens is een overschrijding, en alleen die ene grens", () => {
  const limit = fairUseLimit("aiDocuments");
  const status = evaluateFairUse({ aiDocuments: limit.free + 1, invoicesSent: 3 });
  assert.equal(status.withinLimits, false);
  assert.deepEqual(status.exceeded, ["aiDocuments"]);
});

test("Plus verruimt elke grens en is nooit krapper dan gratis", () => {
  for (const limit of FAIR_USE_LIMITS) {
    assert.ok(limit.plus > limit.free, `${limit.key}: Plus moet ruimer zijn dan gratis`);
  }
  const zwaar = { aiDocuments: 300, invoicesSent: 400, storageMb: 5000 };
  assert.equal(evaluateFairUse(zwaar, "free").withinLimits, false);
  assert.equal(evaluateFairUse(zwaar, "plus").withinLimits, true);
});

test("een kapotte of ontbrekende teller blokkeert niemand", () => {
  // Bij twijfel valt de gebruiker binnen de grens: een maand te veel weggeven is minder erg
  // dan iemand onterecht op slot zetten.
  assert.equal(evaluateFairUse({}).withinLimits, true);
  assert.equal(evaluateFairUse({ aiDocuments: NaN }).withinLimits, true);
  assert.equal(evaluateFairUse({ aiDocuments: -5 }).withinLimits, true);
  assert.equal(evaluateFairUse({ aiDocuments: Infinity }).withinLimits, true);
});

test("elke grens vertelt zelf wat er bij overschrijding gebeurt", () => {
  for (const limit of FAIR_USE_LIMITS) {
    assert.ok(limit.onExceed.length > 20, `${limit.key} mist een uitleg`);
    assert.ok(limit.label.length > 5, `${limit.key} mist een leesbaar label`);
  }
});

test("geen enkele overschrijding raakt het inzien of exporteren van eigen data", () => {
  const belofte = ALWAYS_FREE.join(" ").toLowerCase();
  assert.ok(belofte.includes("exporteren"));
  assert.ok(belofte.includes("boekhouder"));
  assert.ok(belofte.includes("inzien"));
  // Het boekhoudersportaal is gratis — er bestaat geen grens die eraan hangt.
  assert.equal(
    FAIR_USE_LIMITS.some((l) => /boekhouder|accountant|portaal/i.test(l.label)),
    false,
    "er mag nooit een grens op het boekhoudersportaal komen",
  );
});

test("opslag wordt in GB getoond zodra het er zijn, en de prijs staat vast", () => {
  assert.equal(formatLimit(fairUseLimit("storageMb"), "free"), "2 GB");
  assert.equal(formatLimit(fairUseLimit("storageMb"), "plus"), "20 GB");
  // [PLUS-PRIJS] Raised from 12,99 on 12 September 2026, before the first paying customer that
  // was not the owner's own shop — which is why nobody had to be told and nothing was
  // grandfathered. The number is pinned here on purpose: it is published in the Terms, on
  // /prijzen and on the billing screen, and a change that reaches only some of those is the
  // defect this line exists to catch.
  assert.equal(PLUS_PRICE_EUR, 19.99);
});

test("de gepubliceerde tabel komt uit dezelfde bron als de controle", () => {
  const md = fairUseTableMarkdown();
  assert.ok(md.includes("€ 19,99/maand"));
  for (const limit of FAIR_USE_LIMITS) {
    assert.ok(md.includes(limit.label), `${limit.key} ontbreekt in de tabel`);
  }
  // Zo veel rijen als grenzen, plus kop- en scheidingsregel.
  assert.equal(md.split("\n").length, FAIR_USE_LIMITS.length + 2);
});

test("een grens van 1 kent geen 'bijna vol'", () => {
  // Elke gratis gebruiker koppelt één mailbox en zit daarmee permanent op 1 van 1. Zou dat
  // als "bijna vol" gelden, dan staat er vanaf dag één een waarschuwing die nooit meer
  // weggaat — en een waarschuwing die altijd aan staat leest niemand nog. Bij een grens van
  // 1 is er geen tussentoestand: je zit op 0, of je zit erop, en erop zitten is normaal.
  const status = evaluateFairUse({ mailboxes: 1, administrations: 1 });
  assert.equal(status.withinLimits, true);
  assert.deepEqual(status.nearLimit, []);
  assert.deepEqual(status.exceeded, []);

  // Erboven is nog steeds een overschrijding — de uitzondering geldt alleen voor de
  // waarschuwing, niet voor de grens zelf.
  assert.deepEqual(evaluateFairUse({ mailboxes: 2 }).exceeded, ["mailboxes"]);
  // En bij Plus (grens 3) doet de waarschuwing gewoon weer zijn werk.
  assert.ok(evaluateFairUse({ mailboxes: 3 }, "plus").nearLimit.includes("mailboxes"));
});
