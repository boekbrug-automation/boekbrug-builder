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
  FAIR_USE_NO_CEILING,
  NEAR_LIMIT_RATIO,
  PLUS_ANNUAL_PRICE_EUR,
  PLUS_PRICE_EUR,
} from "./fair-use";

test("[PROEF-WERKPLEK] een echte onderneming past NIET in het gratis plan, en dat is het ontwerp", () => {
  // DEZE TEST STOND OMGEKEERD, EN DAT WAS HET OUDE PRODUCT.
  //
  // Hij heette "een normale kleine ondernemer blijft ruim binnen het gratis plan" en bewees dat
  // een winkel met 40 bonnen en 12 facturen per maand gratis kon blijven draaien. Dat was waar
  // bij 50 / 100 / 2 GB, en het is precies wat gratis NIET meer is: de proefwerkplek waarin je
  // BoekBrug leert kennen, niet een goedkope versie waarop je een onderneming draait.
  //
  // Gemeten op de enige echte administratie die er is: 116 gelezen documenten en 282 MB in één
  // maand. Werkelijk zakelijk gebruik gaat er met gemak overheen — dat is wat het upgrade-moment
  // maakt, en een gratis plan dat daar niet overheen gaat heeft er geen.
  const echteWinkel = {
    aiDocuments: 40,
    invoicesSent: 12,
    storageMb: 300,
    mailboxes: 1,
    administrations: 1,
  };
  const gratis = evaluateFairUse(echteWinkel, "free");
  assert.equal(gratis.withinLimits, false, "gratis is de proef, niet de winkel");
  assert.deepEqual(gratis.exceeded.sort(), ["aiDocuments", "invoicesSent", "storageMb"]);

  // …en op Plus draait diezelfde winkel zonder plafond. Eén set getallen, twee antwoorden: dat is
  // het hele model in één assertie.
  assert.equal(evaluateFairUse(echteWinkel, "plus").withinLimits, true);

  // Wat WEL in de proefwerkplek past: een paar facturen en een handvol bonnen — genoeg om te zien
  // hoe het werkt. Zonder deze helft zou een grens van nul ook slagen.
  const proberen = { aiDocuments: 6, invoicesSent: 3, storageMb: 20, mailboxes: 1 };
  assert.equal(evaluateFairUse(proberen, "free").withinLimits, true);
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

test("[PROEF-WERKPLEK] Plus is nooit krapper dan gratis — een groter getal of helemaal geen", () => {
  for (const limit of FAIR_USE_LIMITS) {
    // 0 = geen plafond. Een naïeve `plus > free` zou daar precies andersom over oordelen en de
    // ruimste afspraak die wij kennen als de krapste lezen.
    const ruimer = limit.plus <= 0 || limit.plus > limit.free;
    assert.ok(ruimer, `${limit.key}: Plus moet ruimer zijn dan gratis, of zonder plafond`);
  }
  const zwaar = { aiDocuments: 300, invoicesSent: 400, storageMb: 5000 };
  assert.equal(evaluateFairUse(zwaar, "free").withinLimits, false);
  assert.equal(evaluateFairUse(zwaar, "plus").withinLimits, true);

  // DE VALSTRIK DIE DEZE REGEL DICHTZET. Met plus: 0 zou `used > ceiling` élke Plus-gebruiker met
  // één gelezen document als overschreden aanmerken — het scherm zou rood staan voor precies de
  // klanten die betalen. Eén document is de scherpste vorm daarvan.
  assert.equal(evaluateFairUse({ aiDocuments: 1 }, "plus").withinLimits, true);
  assert.deepEqual(evaluateFairUse({ aiDocuments: 1 }, "plus").exceeded, []);
  assert.deepEqual(evaluateFairUse({ aiDocuments: 1 }, "plus").nearLimit, [],
    "zonder plafond bestaat er ook geen 'bijna vol'");
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

test("[PROEF-WERKPLEK] de gepubliceerde grenzen zijn het contract, en de prijs staat vast", () => {
  // HET GRATIS CONTRACT, voluit. Deze vier getallen staan in de Algemene Voorwaarden, op
  // /prijzen en op /eerlijk-gebruik, en ze komen alle drie uit deze tabel. Ze hier vastpinnen is
  // wat voorkomt dat er één verandert en de andere twee blijven staan.
  assert.equal(fairUseLimit("invoicesSent").free, 5);
  assert.equal(fairUseLimit("aiDocuments").free, 10);
  assert.equal(fairUseLimit("storageMb").free, 50);
  assert.equal(fairUseLimit("mailboxes").free, 1);
  assert.equal(formatLimit(fairUseLimit("storageMb"), "free"), "50 MB");

  // EN PLUS PUBLICEERT GEEN GETAL. Opslag is een systeemmiddel, geen product waarvan wij
  // gigabytes verkopen — dus niet 20 GB, niet 25 GB, niet 2 GB, maar de afspraak zelf. Een tabel
  // die hier "0 MB" zou drukken publiceert het strengste denkbare getal op de ruimste plek.
  assert.equal(formatLimit(fairUseLimit("storageMb"), "plus"), FAIR_USE_NO_CEILING);
  assert.equal(formatLimit(fairUseLimit("aiDocuments"), "plus"), FAIR_USE_NO_CEILING);
  assert.equal(formatLimit(fairUseLimit("invoicesSent"), "plus"), FAIR_USE_NO_CEILING);
  assert.doesNotMatch(fairUseTableMarkdown(), /\| ?0 /, "nergens een kale nul als grens");
  // Mailboxen HEBBEN een getal, want daar is een echte technische bovengrens: één Gmail en één
  // Outlook. Zie [MAILBOX-WAAR].
  assert.equal(formatLimit(fairUseLimit("mailboxes"), "plus"), "2 actief");

  // [PLUS-PRIJS] Twaalf maanden voor de prijs van negen: 9 × 19,99 = 179,91, exact en narekenbaar
  // in plaats van afgerond naar een marketingprijs.
  assert.equal(PLUS_ANNUAL_PRICE_EUR, 179.91);
  assert.equal(Math.round(PLUS_PRICE_EUR * 9 * 100) / 100, PLUS_ANNUAL_PRICE_EUR);
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

  // [MAILBOX-WAAR] Bij Plus is de grens 2, niet 3: email_connections is UNIQUE(user_id,
  // provider) met alleen gmail en outlook, dus twee is wat de tabel kan houden. Op 2 van 2
  // doet de waarschuwing wél zijn werk — dat is geen permanente toestand zoals 1 van 1, maar
  // de bovenkant die je bereikt door een tweede mailbox te koppelen.
  assert.ok(evaluateFairUse({ mailboxes: 2 }, "plus").nearLimit.includes("mailboxes"));
  assert.deepEqual(evaluateFairUse({ mailboxes: 2 }, "plus").exceeded, []);
  assert.deepEqual(evaluateFairUse({ mailboxes: 3 }, "plus").exceeded, ["mailboxes"]);
});
