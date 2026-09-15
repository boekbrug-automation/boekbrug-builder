// [AANSLAG] Run: npx tsx --test src/lib/financial-result-aanslag.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeResult, type ResultInvoice } from "./financial-result";
import { buildSettlementEvents } from "./kas-payment-events";

const inv = (over: Partial<ResultInvoice>): ResultInvoice => ({
  id: "x", direction: "incoming", status: "received", invoice_type: "factuur",
  total_ex_btw: 100, btw_amount: 21, ...over,
});

test("[AANSLAG] income tax, Zvw, btw and an unnamed tax-office letter are withheld from kosten; MRB is a cost", () => {
  const r = computeResult([
    inv({ id: "ib", client_name: "Belastingdienst", tax_kind: "inkomstenbelasting", total_ex_btw: 1200, btw_amount: 0 }),
    inv({ id: "zvw", client_name: "Belastingdienst", tax_kind: "zorgverzekeringswet", total_ex_btw: 300, btw_amount: 0 }),
    inv({ id: "ob", client_name: "Belastingdienst", tax_kind: "omzetbelasting", total_ex_btw: 500, btw_amount: 0 }),
    inv({ id: "naam", client_name: "BELASTINGDIENST/CENTRALE ADMINISTRATIE", tax_kind: null, total_ex_btw: 80, btw_amount: 0 }),
    inv({ id: "mrb", client_name: "Belastingdienst", tax_kind: "motorrijtuigenbelasting", total_ex_btw: 140, btw_amount: 0 }),
    inv({ id: "meat", client_name: "HVO Meat", total_ex_btw: 2500, btw_amount: 225 }),
  ], [], [], [], undefined, 0);
  assert.equal(r.kosten, 2640, "meat 2500 + MRB 140, nothing else");
  assert.equal(r.aanslagen, 2080, "1200 + 300 + 500 + 80 named apart");
  assert.equal(r.btwVoorbelasting, 225, "only the meat's btw is voorbelasting");
});

test("[AANSLAG] a misread btw on a tax letter never becomes voorbelasting", () => {
  const r = computeResult([
    inv({ id: "ib", client_name: "Belastingdienst", tax_kind: "inkomstenbelasting", total_ex_btw: 1000, btw_amount: 210 }),
  ], [], [], [], undefined, 0);
  assert.equal(r.kosten, 0);
  assert.equal(r.btwVoorbelasting, 0);
  assert.equal(r.aanslagen, 1210, "the whole gross is named, so nothing goes missing");
});

test("[AANSLAG] negative control — an ordinary supplier that mentions tax is still a cost", () => {
  const r = computeResult([
    inv({ id: "adv", client_name: "Belastingadviseur Jansen", total_ex_btw: 400, btw_amount: 84 }),
  ], [], [], [], undefined, 0);
  assert.equal(r.kosten, 400);
  assert.equal(r.aanslagen, 0);
  assert.equal(r.btwVoorbelasting, 84);
});

test("[AANSLAG] under kasstelsel the settlement slice is withheld by the id map", () => {
  const ib = buildSettlementEvents({ invoiceId: "ib", direction: "incoming", totalEx: 1200, totalBtw: 0, totalInc: 1200 }, 0, [{ payDate: "2026-05-10", amountApplied: 1200, estimated: false }]);
  const meat = buildSettlementEvents({ invoiceId: "meat", direction: "incoming", totalEx: 2500, totalBtw: 225, totalInc: 2725 }, 0, [{ payDate: "2026-05-11", amountApplied: 2725, estimated: false }]);
  const events = [...ib, ...meat];
  const plain = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  assert.equal(plain.kosten, 3700, "without the map the letter is a cost — the old defect, under kas");
  // [KAS-VOORBELASTING] The COST leg is the settlement; the DEDUCTION is dated by the invoice, so
  // the rows go in too — and the letter's own (misread) btw must stay out of 5b through both
  // handles: the id map the cash leg uses, and the columns the invoice-dated pass reads.
  const rows = [
    inv({ id: "ib", client_name: "Belastingdienst", tax_kind: "inkomstenbelasting", total_ex_btw: 1200, btw_amount: 210 }),
    inv({ id: "meat", client_name: "Slagerij", total_ex_btw: 2500, btw_amount: 225 }),
  ];
  const r = computeResult(rows, [], [], [], undefined, 0, undefined, {
    scheme: "kas", settlements: events,
    taxKindByInvoice: new Map([["ib", "inkomstenbelasting" as const]]),
  });
  assert.equal(r.kosten, 2500);
  assert.equal(r.aanslagen, 1200);
  assert.equal(r.btwVoorbelasting, 225, "the purchase is deducted, the letter's misread btw is not");
});

test("[AANSLAG] motorrijtuigenbelasting is a cost for its whole gross, and a misread btw on it is never voorbelasting", () => {
  const r = computeResult([
    inv({ id: "mrb", client_name: "Belastingdienst", tax_kind: "motorrijtuigenbelasting", total_ex_btw: 165.29, btw_amount: 34.71 }),
  ], [], [], [], undefined, 0);
  assert.equal(r.kosten, 200, "the letter says € 200 and € 200 is the cost");
  assert.equal(r.btwVoorbelasting, 0, "no letter of the Belastingdienst carries btw");
  assert.equal(r.aanslagen, 0);
  // Same under kasstelsel, by the id map.
  const mrb = buildSettlementEvents({ invoiceId: "mrb", direction: "incoming", totalEx: 165.29, totalBtw: 34.71, totalInc: 200 }, 0, [{ payDate: "2026-05-10", amountApplied: 200, estimated: false }]);
  const k = computeResult([], [], [], [], undefined, 0, undefined, {
    scheme: "kas", settlements: mrb, taxKindByInvoice: new Map([["mrb", "motorrijtuigenbelasting" as const]]),
  });
  assert.equal(k.kosten, 200);
  assert.equal(k.btwVoorbelasting, 0);
});

test("[AANSLAG] under kasstelsel the map reaches a letter dated in an EARLIER window — the settlement fetch builds it", () => {
  // The range assembler used to build the map from the invoices dated in the window only; a
  // voorlopige aanslag dated 20 March and paid 5 April reached Q2 as a cost. The map now comes
  // from the settlement fetch (every settled purchase, no date filter) and is merged in.
  const code = (p: string) => readFileSync(p, "utf8");
  const fetchSrc = code("src/lib/kas-payment-events-fetch.ts");
  assert.match(fetchSrc, /marked_paid_at, status, tax_kind, client_name"\)/, "the settlement fetch reads the kind and the name");
  assert.match(fetchSrc, /if \(i\.receiver_id === ownerId\) \{ const k = effectiveTaxKind\(i\); if \(k\) taxKindByInvoice\.set\(i\.id, k\); \}/);
  assert.match(fetchSrc, /return \{ \.\.\.buildQuarterSettlements\(headers, raw, start, end\), taxKindByInvoice \};/);
  assert.match(fetchSrc, /const taxKindByInvoice = merge\(opts\.taxKindByInvoice, local\.taxKindByInvoice\)/, "mergeSchemeOpts merges it like the other three maps");
  assert.match(code("src/lib/result-range-assemble.ts"), /\.\.\.\(kas\.taxKindByInvoice \?\? new Map<string, TaxKind>\(\)\),/, "the range assembler merges the settled kinds under kas");
});
