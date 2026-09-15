// src/lib/factuurstaat.test.ts — run: npx tsx --test src/lib/factuurstaat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  factuurstaat, betaalstandVan, isUitstaand, isGeboekteInkoop, isInAdministratie,
  isTeBeoordelen, isBetaald, type FactuurFeiten,
} from "./factuurstaat";

const f = (over: Partial<FactuurFeiten> = {}): FactuurFeiten => ({
  status: "sent", direction: "outgoing", invoice_type: "factuur",
  total_inc_btw: 1210, amount_paid: 0, due_date: "2026-09-30", ...over,
});

test("the payment answer comes from the AMOUNTS, never from the word", () => {
  // A row may say 'paid' while carrying a part payment — the status lags, the money does not.
  assert.equal(betaalstandVan(f({ status: "paid", amount_paid: 500 })).stand, "deels_betaald");
  // …and say 'received' while the money has fully arrived.
  assert.equal(betaalstandVan(f({ status: "received", amount_paid: 1210 })).stand, "betaald");
  assert.equal(isBetaald(f({ status: "sent", amount_paid: 1210 })), true);
  assert.equal(isBetaald(f({ status: "paid", amount_paid: 0 })), false,
    "the word 'paid' with no money behind it is not a settled invoice");
});

test("an unreadable total is UNKNOWN, never paid and never unpaid", () => {
  const { stand, openstaand } = betaalstandVan(f({ total_inc_btw: null }));
  assert.equal(stand, "onbekend");
  assert.equal(openstaand, null, "inventing an outstanding amount here would invent a debt");
  assert.equal(isBetaald(f({ total_inc_btw: null })), false);
});

test("one cent short is settled — the same tolerance as everywhere else", () => {
  assert.equal(betaalstandVan(f({ amount_paid: 1209.995 })).stand, "betaald");
  assert.equal(betaalstandVan(f({ amount_paid: 1209.5 })).stand, "deels_betaald");
});

test("more money than the invoice is overpaid, and owes nothing", () => {
  const { stand, openstaand } = betaalstandVan(f({ amount_paid: 1300 }));
  assert.equal(stand, "teveel_betaald");
  assert.equal(openstaand, 0, "an overpaid invoice must never report a negative debt");
});

test("a creditnota is judged on magnitude, not on its sign", () => {
  // [CREDIT-TEKEN] A creditnota carries a negative total; its refund is a real payment.
  assert.equal(betaalstandVan(f({ total_inc_btw: -121, amount_paid: -121 })).stand, "betaald");
  assert.equal(betaalstandVan(f({ total_inc_btw: -121, amount_paid: 0 })).stand, "onbetaald");
});

test("a paid invoice is never late, whatever the status says", () => {
  // This is the disagreement the module exists to end: 'overdue' is a word on a row, and the
  // money is a fact.
  const staat = factuurstaat(f({ status: "overdue", amount_paid: 1210, due_date: "2026-01-01" }), "2026-09-11");
  assert.equal(staat.inning, null);
  assert.equal(staat.betaling, "betaald");
});

test("late needs BOTH something owed and a date that has passed", () => {
  assert.equal(factuurstaat(f({ due_date: "2026-01-01" }), "2026-09-11").inning, "te_laat");
  assert.equal(factuurstaat(f({ due_date: "2026-12-01" }), "2026-09-11").inning, "loopt");
  assert.equal(factuurstaat(f({ due_date: null }), "2026-09-11").inning, null, "no due date, no question");
});

test("the dimensions are independent — that is the whole point", () => {
  const staat = factuurstaat(
    f({ status: "sent", amount_paid: 500, due_date: "2026-01-01", superseded_by: "inv-9" }),
    "2026-09-11",
  );
  assert.deepEqual(staat, {
    fase: "verstuurd",
    betaling: "deels_betaald",
    inning: "te_laat",
    correctie: "vervangen",
    openstaand: 710,
  });
});

test("the named questions stand for exactly the old arrays", () => {
  assert.equal(isUitstaand(f({ status: "sent" })), true);
  assert.equal(isUitstaand(f({ status: "overdue" })), true);
  assert.equal(isUitstaand(f({ status: "paid" })), false);
  assert.equal(isUitstaand(f({ status: "sent", direction: "incoming" })), false, "direction is part of the question");

  const inkoop = (s: string) => f({ status: s, direction: "incoming" });
  assert.equal(isGeboekteInkoop(inkoop("received")), true);
  assert.equal(isGeboekteInkoop(inkoop("paid")), true);
  assert.equal(isGeboekteInkoop(inkoop("processing")), false);
});

test("the two sets that used to disagree are now two named questions", () => {
  // ["processing","received"] in five files and ["processing","received","paid"] in four was
  // unreadable as either a decision or a slip. Both meanings now have a name and a reason.
  const paid = f({ status: "paid", direction: "incoming" });
  assert.equal(isInAdministratie(paid), true, "a paid purchase invoice is still in the administration");
  assert.equal(isTeBeoordelen(paid), false, "…but it is not waiting for anyone");
  assert.equal(isTeBeoordelen(f({ status: "processing", direction: "incoming" })), true);
});

test("an unknown status is UNKNOWN, not quietly filed under something", () => {
  assert.equal(factuurstaat(f({ status: "iets_nieuws" }), "2026-09-11").fase, "onbekend");
  assert.equal(isUitstaand(f({ status: "iets_nieuws" })), false);
});
