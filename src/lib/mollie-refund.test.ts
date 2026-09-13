// [TERUGBETALING] Pure node test — run: npx tsx --test src/lib/mollie-refund.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  refundFactFrom, resolveRefunds, refundAlreadyReversed, refundHoldSentence,
  isRefundAnswer, REFUND_ANSWERS, mayReverse,
  type RefundAdjustment, type RefundFact,
} from "./mollie-refund";

const adj = (over: Partial<RefundAdjustment> = {}): RefundAdjustment => ({
  id: "re_abc123",
  amount: { currency: "EUR", value: "300.00" },
  paymentId: "tr_pay1",
  createdAt: "2026-09-03T10:15:00+00:00",
  ...over,
});

test("[TERUGBETALING] an ordinary refund reads as a positive amount on the owner's day", () => {
  const f = refundFactFrom(adj(), "refund");
  assert.ok(f);
  assert.equal(f.refundId, "re_abc123");
  assert.equal(f.kind, "refund");
  assert.equal(f.paymentId, "tr_pay1");
  assert.equal(f.amount, 300);
  assert.equal(f.createdOn, "2026-09-03");
});

test("[TERUGBETALING] a settlement-netted negative is still money that came BACK", () => {
  // Mollie reports a refund's own amount positive, but a settlement-scoped figure can arrive
  // negative because it is netted against the payout. The magnitude is what went back either way.
  assert.equal(refundFactFrom(adj({ amount: { currency: "EUR", value: "-300.00" } }), "refund")?.amount, 300);
});

test("[TERUGBETALING] what cannot be read as money is refused, never guessed at", () => {
  for (const bad of [
    adj({ id: "" }),
    adj({ id: "   " }),
    adj({ amount: { currency: "EUR", value: "" } }),
    adj({ amount: { currency: "EUR", value: "ongeveer 300" } }),
    adj({ amount: { currency: "EUR", value: "0.00" } }),
    adj({ amount: null }),
    adj({ amount: { currency: "USD", value: "300.00" } }),
  ]) {
    assert.equal(refundFactFrom(bad, "refund"), null, `${JSON.stringify(bad)} was read as money`);
  }
  assert.equal(refundFactFrom(null, "refund"), null);
  assert.equal(refundFactFrom(undefined, "chargeback"), null);
});

test("[TERUGBETALING] a missing currency is euros, like everywhere else in the Mollie reader", () => {
  // isEur() in mollie-settlement.ts defaults the same way; two readers that disagree about a
  // missing field would hold half the settlements for a reason nobody can find.
  assert.equal(refundFactFrom(adj({ amount: { value: "12.50" } }), "chargeback")?.amount, 12.5);
});

test("[TERUGBETALING] an unreadable or absent date leaves the day empty, never today", () => {
  assert.equal(refundFactFrom(adj({ createdAt: null }), "refund")?.createdOn, null);
  assert.equal(refundFactFrom(adj({ createdAt: "vorige week" }), "refund")?.createdOn, null);
  // [TZ] Just after midnight Amsterdam is still Amsterdam's day, not UTC's previous one.
  assert.equal(refundFactFrom(adj({ createdAt: "2026-09-03T22:30:00+00:00" }), "refund")?.createdOn, "2026-09-04");
});

test("[TERUGBETALING] the payment id ties the refund to our invoice", () => {
  const facts = [refundFactFrom(adj(), "refund")!];
  const resolved = resolveRefunds(facts, [
    { id: "link-1", paymentId: "tr_pay1", invoiceId: "inv-1" },
    { id: "link-2", paymentId: "tr_other", invoiceId: "inv-2" },
  ]);
  assert.equal(resolved[0].linkId, "link-1");
  assert.equal(resolved[0].invoiceId, "inv-1");
});

test("[TERUGBETALING] a refund we cannot place is still returned, never dropped", () => {
  // An owner who also sells through a webshop has Mollie payments that are not BoekBrug invoices.
  // Dropping those would hold the settlement forever with nothing to point at.
  const unknown = refundFactFrom(adj({ id: "re_x", paymentId: "tr_webshop" }), "refund")!;
  const noPayment = refundFactFrom(adj({ id: "re_y", paymentId: null }), "chargeback")!;
  const resolved = resolveRefunds([unknown, noPayment], [{ id: "link-1", paymentId: "tr_pay1", invoiceId: "inv-1" }]);
  assert.equal(resolved.length, 2);
  for (const r of resolved) {
    assert.equal(r.linkId, null);
    assert.equal(r.invoiceId, null);
  }
});

test("[TERUGBETALING] a link that never learned its payment id matches nothing", () => {
  const facts = [refundFactFrom(adj(), "refund")!];
  const resolved = resolveRefunds(facts, [{ id: "link-1", paymentId: null, invoiceId: "inv-1" }]);
  assert.equal(resolved[0].invoiceId, null, "a null payment id matched a null-ish lookup");
});

test("[TERUGBETALING] 'already reversed' is provable against the snapshot, or it is false", () => {
  // The whole payment came off.
  assert.equal(refundAlreadyReversed({ paidSnapshot: 300, paidNow: 0, amount: 300 }), true);
  // Exactly at the boundary, within the one-cent epsilon this repo uses everywhere.
  assert.equal(refundAlreadyReversed({ paidSnapshot: 300, paidNow: 300.01, amount: 300 }), false);
  assert.equal(refundAlreadyReversed({ paidSnapshot: 500, paidNow: 200, amount: 300 }), true);
  // Something came off, but not this refund.
  assert.equal(refundAlreadyReversed({ paidSnapshot: 500, paidNow: 450, amount: 300 }), false);
  // Nothing moved.
  assert.equal(refundAlreadyReversed({ paidSnapshot: 300, paidNow: 300, amount: 300 }), false);
  // More came off than the refund — a second instalment went too. Still reversed.
  assert.equal(refundAlreadyReversed({ paidSnapshot: 500, paidNow: 0, amount: 300 }), true);
});

test("[TERUGBETALING] without a snapshot the question stays open — 'unknown' is not 'done'", () => {
  for (const missing of [null, undefined, Number.NaN]) {
    assert.equal(
      refundAlreadyReversed({ paidSnapshot: missing as number | null, paidNow: 0, amount: 300 }),
      false,
      "a missing snapshot closed a money question",
    );
  }
  assert.equal(refundAlreadyReversed({ paidSnapshot: 300, paidNow: null, amount: 300 }), false);
  assert.equal(refundAlreadyReversed({ paidSnapshot: 300, paidNow: 0, amount: 0 }), false);
});

test("[TERUGBETALING] the hold sentence counts both kinds and stays a sentence", () => {
  const f = (kind: "refund" | "chargeback", id: string): RefundFact =>
    ({ refundId: id, kind, paymentId: null, amount: 1, createdOn: null });
  assert.equal(refundHoldSentence([]), null, "nothing open must not hold a settlement");
  assert.match(refundHoldSentence([f("refund", "a")])!, /^1 terugbetaling wacht op je antwoord/);
  assert.match(refundHoldSentence([f("chargeback", "a")])!, /^1 chargeback wacht op je antwoord/);
  assert.match(refundHoldSentence([f("refund", "a"), f("refund", "b")])!, /^2 terugbetalingen wachten/);
  const both = refundHoldSentence([f("refund", "a"), f("chargeback", "b"), f("chargeback", "c")])!;
  assert.match(both, /1 terugbetaling en 2 chargebacks wachten/);
});

test("[TERUGBETALING] only the three real answers are accepted; 'open' is a state", () => {
  for (const ok of REFUND_ANSWERS) assert.equal(isRefundAnswer(ok), true, `${ok} was refused`);
  for (const no of ["open", "", "REVERSED", "verwijder", null, undefined, 3]) {
    assert.equal(isRefundAnswer(no), false, `${String(no)} was accepted as an answer`);
  }
});

test("[TERUGBETALING] a PARTIAL refund may never reverse the whole payment", () => {
  // The case this guard exists for: €100 back on a €300 iDEAL payment. The booked payment is one
  // row of €300; reversing it takes all three hundred off an invoice the customer paid two thirds
  // of, and every downstream figure stays internally consistent while being wrong.
  const partial = mayReverse({ invoiceId: "inv-1", appliedAmount: 300, refundAmount: 100 });
  assert.equal(partial.ok, false);
  if (partial.ok) return;
  assert.equal(partial.refusal, "partial-refund");
  // More back than went on is just as impossible to express as a reversal.
  assert.equal(mayReverse({ invoiceId: "inv-1", appliedAmount: 100, refundAmount: 300 }).ok, false);
});

test("[TERUGBETALING] the full case passes, within the same one-cent epsilon", () => {
  assert.equal(mayReverse({ invoiceId: "inv-1", appliedAmount: 300, refundAmount: 300 }).ok, true);
  assert.equal(mayReverse({ invoiceId: "inv-1", appliedAmount: 300, refundAmount: 300.01 }).ok, true);
  assert.equal(mayReverse({ invoiceId: "inv-1", appliedAmount: 300, refundAmount: 300.02 }).ok, false);
});

test("[TERUGBETALING] nothing to reverse is said as such, not as a failure", () => {
  const none = mayReverse({ invoiceId: null, appliedAmount: 300, refundAmount: 300 });
  assert.equal(none.ok, false);
  if (none.ok) return;
  assert.equal(none.refusal, "no-invoice");
  for (const gone of [null, undefined, 0, -5, Number.NaN]) {
    const v = mayReverse({ invoiceId: "inv-1", appliedAmount: gone as number | null, refundAmount: 300 });
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.refusal, "payment-gone", `${String(gone)} was treated as a payment`);
  }
});
