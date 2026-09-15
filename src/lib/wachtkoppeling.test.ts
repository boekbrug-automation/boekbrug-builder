// src/lib/wachtkoppeling.test.ts — run: npx tsx --test src/lib/wachtkoppeling.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transactionFitsWacht, wachtVoorTransactie, isVerlopen, defaultVerlooptOp, wachtZin,
  WACHT_WINDOW_DAYS, type Wachtkoppeling, type WachtTransactie,
} from "./wachtkoppeling";

const wacht = (over: Partial<Wachtkoppeling> = {}): Wachtkoppeling => ({
  id: "w-1", richting: "uit", bedrag: 121, betaaldOp: "2026-09-04",
  tegenpartij: "KPN", factuurIds: ["inv-1"], verlooptOp: "2026-09-25", ...over,
});

const tx = (over: Partial<WachtTransactie> = {}): WachtTransactie => ({
  id: "tx-1", date: "2026-09-05", amount: -121,
  counterpartName: "KPN B.V.", counterpartIban: "NL91ABNA0417164300", invoiceId: null, ...over,
});

test("the payment the owner described is recognised when it lands", () => {
  const v = transactionFitsWacht(wacht(), tx());
  assert.equal(v.fits, true);
  if (v.fits) assert.ok(v.reasons.length >= 2, "a match must say why");
});

test("a receipt can never settle a payment, however well the amount agrees", () => {
  const v = transactionFitsWacht(wacht({ richting: "uit" }), tx({ amount: 121 }));
  assert.deepEqual(v, { fits: false, reason: "verkeerde_richting" });
  const w = transactionFitsWacht(wacht({ richting: "in" }), tx({ amount: -121 }));
  assert.deepEqual(w, { fits: false, reason: "verkeerde_richting" });
});

test("money coming in matches a waiting receipt", () => {
  assert.equal(transactionFitsWacht(wacht({ richting: "in" }), tx({ amount: 121 })).fits, true);
});

test("a line already carrying an invoice is not looking for one", () => {
  assert.deepEqual(transactionFitsWacht(wacht(), tx({ invoiceId: "inv-9" })),
    { fits: false, reason: "regel_is_al_gekoppeld" });
});

test("the amount must agree to the cent", () => {
  assert.deepEqual(transactionFitsWacht(wacht(), tx({ amount: -120.5 })),
    { fits: false, reason: "bedrag_wijkt_af" });
  // One cent is the tolerance the whole app calls equal, and it must behave the same here.
  assert.equal(transactionFitsWacht(wacht(), tx({ amount: -121.01 })).fits, true);
});

test("a date outside the window is refused, with the reason", () => {
  const ver = new Date(Date.parse("2026-09-04T00:00:00Z") + (WACHT_WINDOW_DAYS + 3) * 86400000)
    .toISOString().slice(0, 10);
  assert.deepEqual(transactionFitsWacht(wacht(), tx({ date: ver })),
    { fits: false, reason: "datum_te_ver" });
});

test("a different company is refused even when the amount is exact", () => {
  assert.deepEqual(transactionFitsWacht(wacht(), tx({ counterpartName: "Albert Heijn 1234" })),
    { fits: false, reason: "andere_tegenpartij" });
});

test("silence about the counterparty is not a mismatch", () => {
  // An owner who typed no counterparty told us nothing about it. Refusing on that would kill the
  // links they most meant to make — the ones they could not name precisely.
  assert.equal(transactionFitsWacht(wacht({ tegenpartij: null }), tx()).fits, true);
  assert.equal(transactionFitsWacht(wacht(), tx({ counterpartName: null })).fits, true);
});

test("two identical payments are AMBIGUOUS, never tie-broken", () => {
  // Two €121 payments to KPN in one week is exactly the case where guessing produces a wrong
  // booking that reconciles perfectly. The owner settles it in one tap; the app must not.
  const out = wachtVoorTransactie([wacht({ id: "a" }), wacht({ id: "b" })], tx());
  assert.ok(out && "ambiguous" in out, "a tie must be reported, not resolved");
  if (out && "ambiguous" in out) assert.equal(out.ambiguous.length, 2);
});

test("one fit is a match, none is null", () => {
  const one = wachtVoorTransactie([wacht(), wacht({ id: "z", bedrag: 999 })], tx());
  assert.ok(one && "match" in one);
  if (one && "match" in one) assert.equal(one.match.id, "w-1");
  assert.equal(wachtVoorTransactie([wacht({ bedrag: 999 })], tx()), null);
});

test("a link stops asking after its window — it never becomes furniture", () => {
  assert.equal(isVerlopen(wacht({ verlooptOp: "2026-09-25" }), "2026-09-20"), false);
  assert.equal(isVerlopen(wacht({ verlooptOp: "2026-09-25" }), "2026-09-25"), false, "the last day still counts");
  assert.equal(isVerlopen(wacht({ verlooptOp: "2026-09-25" }), "2026-09-26"), true);
});

test("an unreadable date expires nothing, rather than expiring everything", () => {
  assert.equal(isVerlopen(wacht({ verlooptOp: "onbekend" }), "2026-09-26"), false);
});

test("the default window is generous enough for any Dutch bank", () => {
  assert.equal(defaultVerlooptOp("2026-09-04"), "2026-09-25");
});

test("the sentence says what happened and what is still awaited", () => {
  const euro = (n: number) => `€ ${n.toFixed(2)}`;
  assert.match(wachtZin(wacht(), euro), /betaald aan KPN/);
  assert.match(wachtZin(wacht(), euro), /wachten nog op de bankregel/);
  assert.match(wachtZin(wacht({ richting: "in", tegenpartij: "Jansen" }), euro), /ontvangen van Jansen/);
  // No counterparty must not produce a dangling "aan ".
  assert.doesNotMatch(wachtZin(wacht({ tegenpartij: null }), euro), /aan\s+—/);
});
