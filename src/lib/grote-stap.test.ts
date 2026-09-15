// src/lib/grote-stap.test.ts — run: npx tsx --test src/lib/grote-stap.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { beoordeelStap, groteStapZin, DREMPEL, BULK_DREMPEL } from "./grote-stap";

const euro = (n: number) => `€ ${n.toFixed(2)}`;

test("an ordinary step is ordinary — the check exists to be rare", () => {
  // [RUSTIG]/[RITME]: a confirmation on every action is clicked away on all of them, including
  // the one that mattered.
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: 121 }).groot, false);
  assert.equal(beoordeelStap({ soort: "terugbetaling", bedrag: 40 }).groot, false);
  assert.equal(groteStapZin({ soort: "creditnota", bedrag: 121 },
    beoordeelStap({ soort: "creditnota", bedrag: 121 }), euro), null);
});

test("each action has its own threshold, because each costs differently when wrong", () => {
  // Undoing an unlink is a click; an unnecessary refund is a bank transfer to ask back.
  assert.ok(DREMPEL.terugbetaling < DREMPEL.creditnota);
  assert.ok(DREMPEL.creditnota < DREMPEL.betaling_ontkoppelen);
  assert.equal(beoordeelStap({ soort: "terugbetaling", bedrag: 300 }).groot, true);
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: 300 }).groot, false,
    "the same euros are not the same risk on a different action");
});

test("the threshold is exclusive — exactly at it is still ordinary", () => {
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: DREMPEL.creditnota }).groot, false);
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: DREMPEL.creditnota + 0.01 }).groot, true);
});

test("sign never decides — the direction is in the action, not in a minus", () => {
  // [CREDIT-TEKEN] A creditnota carries a negative total; it is the same size either way.
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: -5000 }).groot, true);
});

test("a bulk step is judged on its COUNT, not its amount", () => {
  assert.equal(beoordeelStap({ soort: "bulk", aantal: BULK_DREMPEL }).groot, false);
  const veel = beoordeelStap({ soort: "bulk", aantal: 40 });
  assert.equal(veel.groot, true);
  assert.equal(veel.reden?.soort, "aantal");
  assert.match(String(groteStapZin({ soort: "bulk", aantal: 40 }, veel, euro)), /40 regels in één keer/);
});

test("a count crosses on any action, even a small amount", () => {
  const o = beoordeelStap({ soort: "creditnota", bedrag: 5, aantal: 30 });
  assert.equal(o.groot, true);
  assert.equal(o.reden?.soort, "aantal", "thirty rows at once is the risk, not the five euros");
});

test("an unreadable amount is NOT large — the one judgement call in the file", () => {
  // Treating unknown as large would put the extra beat on exactly the invoices the owner is
  // already asked most about, and the check would stop being rare.
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: null }).groot, false);
  assert.equal(beoordeelStap({ soort: "creditnota", bedrag: NaN }).groot, false);
  assert.equal(beoordeelStap({ soort: "creditnota" }).groot, false);
});

test("the sentence states the size and nothing else", () => {
  const stap = { soort: "terugbetaling" as const, bedrag: 1800 };
  const zin = String(groteStapZin(stap, beoordeelStap(stap), euro));
  assert.match(zin, /€ 1800\.00 terugbetalen/);
  // No warning words: the owner knows what they are doing; what they may have lost track of is
  // how much.
  assert.doesNotMatch(zin, /waarschuwing|let op|zeker weten|pas op/i);
});

test("it never blocks — it returns a sentence, not a refusal", () => {
  const o: Record<string, unknown> = { ...beoordeelStap({ soort: "afboeken", bedrag: 9000 }) };
  assert.deepEqual(Object.keys(o).sort(), ["groot", "reden"]);
});
