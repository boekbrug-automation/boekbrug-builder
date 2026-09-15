// [RESULT] Pure node test — run: npx tsx src/lib/financial-result.test.ts
import {
  computeResult,
  toResultBankTx,
  cardBudgetBound,
  type ResultInvoice, type ResultBankTx, type ResultCashEntry,
} from "./financial-result";
import type { DailyTurnover } from "./turnover";
import { buildSettlementEvents } from "./kas-payment-events";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

console.log("\n— invoices core —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 }, // sale 21%
    { direction: "outgoing", status: "processing", total_ex_btw: 500, btw_amount: 105 }, // unverified → ignored
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 }, // cost 21%
    { direction: "incoming", status: "draft", total_ex_btw: 999, btw_amount: 209 }, // unverified → ignored
  ];
  const r = computeResult(inv, [], []);
  check("omzet = verified outgoing ex-btw", r.omzet === 1000);
  check("kosten = verified incoming ex-btw", r.kosten === 400);
  check("btw verschuldigd from sales", r.btwVerschuldigd === 210);
  check("btw voorbelasting from purchases", r.btwVoorbelasting === 84);
  check("btw saldo = 210 − 84", r.btwSaldo === 126);
  check("resultaat = 1000 − 400", r.resultaat === 600);
}

console.log("\n— bank de-dup (the critical one) —");
{
  const inv: ResultInvoice[] = [
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 },
  ];
  const bank: ResultBankTx[] = [
    { amount: -484, category: "kosten", invoice_id: "inv-1" }, // PAYMENT of that invoice → must NOT double count
    { amount: -100, category: "kosten", invoice_id: null },     // a cost with no invoice → counts
    { amount: 250, category: "omzet", invoice_id: null },       // non-invoice income → counts
    { amount: -60, category: "transfer", invoice_id: null },    // transfer → excluded
    { amount: -40, category: null, invoice_id: null },          // uncategorized → not guessed
  ];
  const r = computeResult(inv, bank, []);
  check("invoice payment (invoice_id set) is NOT double counted", r.kosten === 400 + 100);
  check("non-invoice bank income counts as omzet", r.omzet === 250);
  check("transfer + uncategorized excluded", r.kosten === 500 && r.omzet === 250);
  check("bare bank lines add no BTW", r.btwVerschuldigd === 0 && r.btwVoorbelasting === 84);
}

console.log("\n— [SIGN] a refund keeps its sign (not abs'd into fabricated revenue/cost) —");
{
  const bank: ResultBankTx[] = [
    { amount: 1000, category: "omzet", invoice_id: null },   // card takings → +1000 omzet
    { amount: -150, category: "omzet", invoice_id: null },   // card REFUND → must REDUCE omzet by 150
    { amount: -200, category: "kosten", invoice_id: null },  // normal expense → +200 kosten
    { amount: 50, category: "kosten", invoice_id: null },    // supplier REFUND (credit) → REDUCES kosten by 50
  ];
  const r = computeResult([], bank, []);
  check("refund reduces omzet (1000 − 150 = 850), not 1150", r.omzet === 850);
  check("supplier refund reduces kosten (200 − 50 = 150), not 250", r.kosten === 150);
  check("negative omzet does not inflate the zonder-tarief nudge", r.cashOmzetZonderBtw === 1000);
}

console.log("\n— [BANKKOSTEN-DEDUCTIBLE] bank 'fee' is a deductible VAT-exempt cost, never double-counted —");
{
  // A plain bank charge → deductible cost, €0 voorbelasting (vrijstelling betalingsverkeer).
  const r1 = computeResult([], [{ amount: -12.10, category: "fee", invoice_id: null }], []);
  check("fee debit → deductible kosten (12.10)", near(r1.kosten, 12.10));
  check("fee → no voorbelasting (VAT-exempt)", r1.btwVoorbelasting === 0);
  check("fee → no omzet", r1.omzet === 0);

  // A reversed/refunded bank charge (credit) reduces cost, keeping its sign.
  const r2 = computeResult([], [{ amount: 5, category: "fee", invoice_id: null }], []);
  check("fee credit (reversal) reduces kosten by 5", r2.kosten === -5);

  // THE NO-DOUBLE-COUNT PROOF: a 'fee' bank line (10) AND the card-triangle acquirer commission
  // (passed as the 6th arg = 10) must each count ONCE → kosten 20, never 10 or 30. The triangle
  // commission derives only from pos_income lines, disjoint from 'fee', so no euro is booked twice.
  const r3 = computeResult([], [{ amount: -10, category: "fee", invoice_id: null }], [], [], undefined, 10);
  check("bankkosten (10) + acquirer commission (10) each count once → 20", near(r3.kosten, 20));
  check("neither the fee nor the commission invents voorbelasting", r3.btwVoorbelasting === 0);

  // A fee line that is actually an invoice payment (invoice_id set) is still excluded (paid via its invoice).
  const r4 = computeResult([], [{ amount: -9, category: "fee", invoice_id: "inv-x" }], []);
  check("fee line with invoice_id is NOT double-counted", r4.kosten === 0);
}

console.log("\n— cash —");
{
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 121, category: "omzet", btw_rate: 21 },   // cash sale incl 21% → net 100, btw 21
    { direction: "in", amount: 50, category: "omzet", btw_rate: null },   // cash sale, no rate → nudge
    { direction: "out", amount: 30, category: "kosten", btw_rate: null }, // cash expense
    { direction: "out", amount: 200, category: "transfer", btw_rate: null }, // storting → excluded
    { direction: "out", amount: 80, category: "prive", btw_rate: null },  // prive → excluded
  ];
  const r = computeResult([], [], cash);
  check("rated cash sale nets ex-btw (121 → 100)", near(r.omzet, 100 + 50));
  check("rated cash sale adds btw (21)", near(r.btwVerschuldigd, 21));
  check("unrated cash sale flagged", r.cashOmzetZonderBtw === 50);
  check("cash expense counts as kosten", r.kosten === 30);
  check("transfer + prive excluded from cash", near(r.omzet, 150) && r.kosten === 30);
}

console.log("\n— [CASH-COST-VAT] a cash cost reclaims voorbelasting ONLY with a linked bon —");
{
  // Documented cash cost @21% → net 100 cost + 21 voorbelasting (like a purchase invoice).
  const documented = computeResult([], [], [
    { direction: "out", amount: 121, category: "kosten", btw_rate: 21, document_id: "doc-1" },
  ]);
  check("documented cash cost nets ex-btw (121 → 100)", near(documented.kosten, 100));
  check("documented cash cost claims voorbelasting (21)", near(documented.btwVoorbelasting, 21));

  // Undocumented cash cost (no bon, no rate) → FULL gross, zero voorbelasting.
  const undocumented = computeResult([], [], [
    { direction: "out", amount: 121, category: "kosten", btw_rate: null, document_id: null },
  ]);
  check("undocumented cash cost books full gross (121)", near(undocumented.kosten, 121));
  check("undocumented cash cost claims NO voorbelasting", undocumented.btwVoorbelasting === 0);

  // Defense-in-depth: a rate BUT no document → still full gross, no deduction (guard needs BOTH).
  const rateNoDoc = computeResult([], [], [
    { direction: "out", amount: 109, category: "kosten", btw_rate: 9, document_id: null },
  ]);
  check("rate without a bon → full gross, no voorbelasting (guard needs BOTH)", near(rateNoDoc.kosten, 109) && rateNoDoc.btwVoorbelasting === 0);

  // Salaris (cash wages) → a cost, never any BTW, even with a stray rate/doc.
  const salaris = computeResult([], [], [
    { direction: "out", amount: 500, category: "salaris", btw_rate: 21, document_id: "doc-x" },
  ]);
  check("cash salaris is a cost (500), never voorbelasting", near(salaris.kosten, 500) && salaris.btwVoorbelasting === 0);
}

console.log("\n— combined, no double count —");
{
  const inv: ResultInvoice[] = [{ direction: "outgoing", status: "paid", total_ex_btw: 2000, btw_amount: 420 }];
  const bank: ResultBankTx[] = [
    { amount: 2420, category: "omzet", invoice_id: "inv-1" }, // customer paying the invoice → excluded
    { amount: -150, category: "kosten", invoice_id: null },
  ];
  const cash: ResultCashEntry[] = [{ direction: "in", amount: 242, category: "omzet", btw_rate: 21 }];
  const r = computeResult(inv, bank, cash);
  check("omzet = invoice 2000 + cash net 200 (bank payment excluded)", near(r.omzet, 2200));
  check("kosten = 150 bank-only cost", r.kosten === 150);
  check("btw = invoice 420 + cash 42", near(r.btwVerschuldigd, 462));
  check("resultaat = 2200 − 150", near(r.resultaat, 2050));
}

console.log("\n— turnover (retail Z-report) de-dup vs pos_income + cash —");
{
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-04",
    base_0: 20, base_9: 1000, base_21: 500, btw_9: 90, btw_21: 105,
    total_incl: 1715, pin_amount: 1200, cash_amount: 415, other_amount: 100,
  }];
  const bank: ResultBankTx[] = [
    { amount: 1200, category: "pos_income", invoice_id: null, settleDate: "2026-04-04" }, // covered → witness, excluded
    { amount: 800, category: "pos_income", invoice_id: null, settleDate: "2026-05-01" },  // NOT covered → counts
  ];
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 415, category: "omzet", btw_rate: 21, date: "2026-04-04" },  // covered → excluded (omzet+btw+nudge)
    { direction: "in", amount: 50, category: "omzet", btw_rate: null, date: "2026-05-02" }, // not covered → counts + nudge
    { direction: "out", amount: 30, category: "kosten", btw_rate: null, date: "2026-04-04" }, // covered day but KOSTEN → still counts
  ];
  const r = computeResult([], bank, cash, turnover);
  check("turnover net counted; covered pos_income + cash excluded; uncovered counted",
    near(r.omzet, 1520 + 800 + 50));
  check("kosten on a covered day still counts", r.kosten === 30);
  check("btwVerschuldigd = turnover 195 only (covered cash BTW excluded)", near(r.btwVerschuldigd, 195));
  check("per-rate turnover BTW split (rubriek 1a/1b)", near(r.turnoverBtw9, 90) && near(r.turnoverBtw21, 105));
  // The uncovered €800 pos_income is real revenue with NO BTW rate → it must be flagged
  // (blocks readiness), exactly like the €50 unrated cash. Silently zero-rating it was the
  // HIGH money-truth bug. Total no-rate omzet = 800 (bank) + 50 (cash) = 850.
  check("bank omzet without rate is flagged too (not just cash)", r.cashOmzetZonderBtw === 850);
}

// ─── [KAS-TERUGGAAF] Een teruggaaf op een kassadag is geen dubbeltelling ──────
//
// De dubbeltelling waar de covered-regel over gaat is: de eigenaar noteert de dagopbrengst die de
// Z-bon al telde nóg een keer als kasregel. Een TERUGGAAF is dat niet — er is geen tweede notering
// van dezelfde ontvangst, en daily_turnover.cash_amount is een positief ontvangstenbedrag dat een
// uitbetaling niet kan voorstellen. Hem overslaan laat de omzet staan op het bedrag vóór de
// teruggaaf. De opmerking in de engine zegt zelf dat teruggaven "the normal way a till goes the
// other way" zijn; precies dat geval viel weg.
console.log("\n— [KAS-NULTARIEF] 0% is een antwoord, geen ontbrekend antwoord —");
{
  // /api/cash accepteert 0 uitdrukkelijk als geldig tarief, en de database bewaart 0 en NULL
  // apart. Toch viel 0% in de tak voor "geen tarief opgegeven": de omzet bereikte geen enkele
  // rubriek, en cashOmzetZonderBtw — die de gereedheid BLOKKEERT — telde hem mee. De eigenaar die
  // het juiste invulde kon zijn kwartaal niet afronden, en de enige uitweg was liegen over het
  // tarief.
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 300, category: "omzet", btw_rate: 0, date: "2026-05-02" },
    { direction: "in", amount: 121, category: "omzet", btw_rate: 21, date: "2026-05-02" },
    { direction: "in", amount: 80, category: "omzet", btw_rate: null, date: "2026-05-02" },
  ];
  const r = computeResult([], [], cash, []);
  check("de 0%-verkoop telt als omzet", near(r.omzet, 300 + 100 + 80));
  check("…en draagt geen btw", near(r.btwVerschuldigd, 21));
  // De emmer is wat hem in aangifte.ts naar rubriek 1e brengt.
  const nul = r.salesByRate.find((x) => x.rate === 0);
  check("de 0%-omzet krijgt een eigen tariefemmer (die 1e voedt)", !!nul && near(nul.omzet, 300));
  check("…met nul btw erin", !!nul && near(nul.btw, 0));
  // En alleen de ECHT ongetarifeerde regel blokkeert nog.
  check("alleen de regel zonder tarief blokkeert de gereedheid", near(r.cashOmzetZonderBtw, 80));
}

console.log("\n— [KAS-TERUGGAAF] een kasteruggaaf op een gedekte dag telt wél mee —");
{
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-04",
    base_0: 0, base_9: 0, base_21: 1000, btw_9: 0, btw_21: 210,
    total_incl: 1210, pin_amount: 0, cash_amount: 1210, other_amount: 0,
  }];
  const cash: ResultCashEntry[] = [
    // Dezelfde dag, en de eigenaar betaalt € 121 contant terug aan een klant.
    { direction: "out", amount: 121, category: "omzet", btw_rate: 21, date: "2026-04-04" },
    // En de her-notering van de dagopbrengst zelf: DIE is de dubbeltelling en blijft eruit.
    { direction: "in", amount: 1210, category: "omzet", btw_rate: 21, date: "2026-04-04" },
  ];
  const r = computeResult([], [], cash, turnover);
  // Z-bon: 1000 netto. Teruggaaf: −121 incl. = −100 netto. De her-notering telt niet mee.
  check("de teruggaaf verlaagt de omzet (1000 − 100)", near(r.omzet, 900));
  check("…en de her-notering van dezelfde dag doet dat niet", !near(r.omzet, 900 - 1000));
  // De BTW gaat mee dezelfde kant op: 210 − 21.
  check("de af te dragen BTW daalt mee", near(r.btwVerschuldigd, 189));
}

console.log("\n— [KAS-TERUGGAAF] zonder kassadag verandert er niets —");
{
  // De regressiecontrole: op een dag die de Z-bon NIET dekt gedroeg een teruggaaf zich altijd al
  // goed, en die uitkomst mag deze reparatie niet verschuiven.
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 1210, category: "omzet", btw_rate: 21, date: "2026-05-02" },
    { direction: "out", amount: 121, category: "omzet", btw_rate: 21, date: "2026-05-02" },
  ];
  const r = computeResult([], [], cash, []);
  check("verkoop min teruggaaf, netto", near(r.omzet, 1000 - 100));
}

console.log("\n— [BTW-TRUTH] bank omzet without a rate must not silently declare €0 BTW —");
{
  // A plain 'omzet' bank credit and an uncovered pos_income line: both revenue, no rate.
  const bank: ResultBankTx[] = [
    { amount: 1210, category: "omzet", invoice_id: null },
    { amount: 605, category: "pos_income", invoice_id: null, settleDate: "2026-06-30", settleExact: true },
  ];
  const r = computeResult([], bank, []);
  check("counted in omzet", near(r.omzet, 1815));
  check("no invented BTW (btwVerschuldigd 0, salesByRate empty)",
    r.btwVerschuldigd === 0 && r.salesByRate.length === 0);
  check("BUT surfaced as omzet-zonder-tarief (blocks readiness)", near(r.cashOmzetZonderBtw, 1815));
}

console.log("\n— [SETTLE-LAG] fallback booking date reconciles to Z-report via backward window —");
{
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-06", // Monday: the takings day
    base_0: 0, base_9: 0, base_21: 1000, btw_9: 0, btw_21: 210,
    total_incl: 1210, pin_amount: 1210, cash_amount: 0, other_amount: 0,
  }];
  // Bank omitted DAT. → settleDate is the booking date (Apr 8, T+2), settleExact false.
  const bankFallback: ResultBankTx[] = [
    { amount: 1210, category: "pos_income", invoice_id: null, settleDate: "2026-04-08", settleExact: false },
  ];
  const rf = computeResult([], bankFallback, [], turnover);
  check("fallback booking date (T+2) is reconciled to the Z-report day → not double-counted",
    near(rf.omzet, 1000) && rf.cashOmzetZonderBtw === 0);

  // An EXACT takings date that ISN'T covered must still count (never hidden by the window).
  const bankExactUncovered: ResultBankTx[] = [
    { amount: 300, category: "pos_income", invoice_id: null, settleDate: "2026-04-07", settleExact: true },
  ];
  const re = computeResult([], bankExactUncovered, [], turnover);
  check("exact takings date not in covered → counts (window never hides exact-dated revenue)",
    near(re.omzet, 1000 + 300) && near(re.cashOmzetZonderBtw, 300));

  // A fallback booking date with NO covered day within the lag window → still real revenue.
  const bankFarFallback: ResultBankTx[] = [
    { amount: 400, category: "pos_income", invoice_id: null, settleDate: "2026-04-20", settleExact: false },
  ];
  const rff = computeResult([], bankFarFallback, [], turnover);
  check("fallback booking date beyond the lag window → counts (not silently suppressed)",
    near(rff.omzet, 1000 + 400) && near(rff.cashOmzetZonderBtw, 400));
}

console.log("\n— [FINDING-1] an acquirer payout MIS-TAPPED as 'omzet' on a covered day must NOT double-count —");
{
  // The R&D audit's HIGH bug: a Rabo OmniKassa / Worldline / Nets payout the auto-classifier
  // missed → sign-fallback 'omzet' → the owner confirms 'omzet'. On a covered till day the
  // till already counted those takings once; the old de-dup (keyed on the literal category
  // "pos_income") let this 'omzet' line add a SECOND helping. Now toResultBankTx recognises the
  // acquirer NAME and flags it as a settlement, so computeResult treats it as a covered witness.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-03",
    base_0: 0, base_9: 0, base_21: 2113, btw_9: 0, btw_21: 190,
    total_incl: 2303.10, pin_amount: 2086.65, cash_amount: 216.45, other_amount: 0,
  }];
  // Owner (mis)categorised the OmniKassa payout as plain 'omzet'. Booked next day (T+1).
  const rawMisTap = { amount: 2080, category: "omzet", invoice_id: null, date: "2026-07-04", description: "Rabo OmniKassa afrekening periode" };
  const mapped = toResultBankTx(rawMisTap);
  check("toResultBankTx flags an acquirer-named CREDIT as a settlement even when category='omzet'", mapped.posSettlement === true);
  check("… and derives a settleDate (booking-date fallback) for the covered-day check", mapped.settleDate === "2026-07-04");
  const rMis = computeResult([], [mapped], [], turnover);
  check("covered-day OmniKassa 'omzet' payout is a witness → omzet = till net only (2113, NOT ~4193)", near(rMis.omzet, 2113));

  // A genuine NON-acquirer bank 'omzet' on a covered day (e.g. a webshop transfer that never
  // went through the till) has NO acquirer name → NOT a settlement → it must still COUNT, so
  // real off-till revenue is never hidden.
  const rawWebshop = { amount: 500, category: "omzet", invoice_id: null, date: "2026-07-03", description: "overboeking webshop bestelling 8842" };
  const mappedWebshop = toResultBankTx(rawWebshop);
  check("a non-acquirer 'omzet' credit is NOT flagged as a settlement", mappedWebshop.posSettlement === false);
  const rShop = computeResult([], [mappedWebshop], [], turnover);
  check("… so genuine off-till revenue on a covered day still counts (2113 + 500)", near(rShop.omzet, 2113 + 500));

  // An acquirer-named DEBIT (a purchase AT a terminal) is not income → never a settlement.
  const mappedDebit = toResultBankTx({ amount: -12.5, category: "kosten", invoice_id: null, date: "2026-07-03", description: "betaalautomaat CCV bloemen" });
  check("an acquirer-named DEBIT is not a settlement (it's a purchase)", mappedDebit.posSettlement === false);

  // The acquirer name often lives in counterpart_name, not description — the mapper must see it,
  // else a mis-tapped 'omzet' payout would still double-count (adversarial review LOW #7/#8).
  const cpOnly = toResultBankTx({ amount: 900, category: "omzet", invoice_id: null, date: "2026-07-03", description: "afrekening", counterpart_name: "Worldline" });
  check("acquirer name in counterpart_name (not description) still flags a settlement", cpOnly.posSettlement === true);
}

console.log("\n— [CARD-BUDGET] suppression is bounded by pin_amount, so off-till (webshop) revenue is never hidden —");
{
  // The adversarial review's HIGH: an omnichannel store (physical till + webshop via the same
  // PSP). Covered day pin €545; a Buckaroo payout of €800 arrives, tapped 'omzet'. Suppressing
  // the WHOLE €800 would hide €255 of real off-till revenue. The budget suppresses only up to
  // pin_amount; the €255 excess counts and is flagged.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-06",
    base_0: 0, base_9: 0, base_21: 500, btw_9: 0, btw_21: 105,
    total_incl: 605, pin_amount: 545, cash_amount: 60, other_amount: 0,
  }];
  const buckaroo = toResultBankTx({ amount: 800, category: "omzet", invoice_id: null, date: "2026-07-06", description: "Buckaroo uitbetaling webshop" });
  const r = computeResult([], [buckaroo], [], turnover);
  check("only pin_amount (545) is suppressed; the €255 excess counts (till net 500 + 255)", near(r.omzet, 500 + 255));
  check("the excess is flagged as omzet-zonder-tarief (blocks readiness, no false 'klaar')", near(r.cashOmzetZonderBtw, 255));

  // When the till's OWN card settlement also appears, it consumes the budget and the full
  // webshop payout counts — the reconciliation self-corrects and the total is order-independent.
  const terminal = toResultBankTx({ amount: 545, category: "pos_income", invoice_id: null, date: "2026-07-06", description: "CCV afrek. transacties DAT. 20260706" });
  const rBoth = computeResult([], [terminal, buckaroo], [], turnover);
  const rBothRev = computeResult([], [buckaroo, terminal], [], turnover);
  check("terminal (545) + webshop (800): budget consumed by the terminal → full webshop counts (500 + 800)", near(rBoth.omzet, 500 + 800));
  check("… and the result is independent of statement order", near(rBoth.omzet, rBothRev.omzet));

  // A pos_income line that itself exceeds the day's pin (terminal paid out more than the till
  // rang, or a webshop settling via the terminal PSP) → the excess is not hidden.
  const bigPos: ResultBankTx[] = [{ amount: 700, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: true }];
  const rBig = computeResult([], bigPos, [], turnover);
  check("pos_income above pin (700 vs 545) → €155 excess counts, not hidden", near(rBig.omzet, 500 + 155));
}

console.log("\n— [RE-REVIEW] DAT-less / cross-quarter / null-pin / refund edges (2nd adversarial pass) —");
{
  // HIGH-1: two DAT-less payouts on CONSECUTIVE covered days must not collapse onto one day's
  // budget (which leaked the 2nd as fake 'excess' → systematic double-count). The budget-aware
  // backward match spreads them across both days' budgets.
  const turnover: DailyTurnover[] = [
    { turnover_date: "2026-07-06", base_0: 0, base_9: 0, base_21: 826.45, btw_9: 0, btw_21: 173.55, total_incl: 1000, pin_amount: 1000, cash_amount: 0, other_amount: 0 },
    { turnover_date: "2026-07-07", base_0: 0, base_9: 0, base_21: 826.45, btw_9: 0, btw_21: 173.55, total_incl: 1000, pin_amount: 1000, cash_amount: 0, other_amount: 0 },
  ];
  const twoPayouts: ResultBankTx[] = [
    { amount: 1000, category: "pos_income", invoice_id: null, settleDate: "2026-07-08", settleExact: false }, // for 07-06 (T+2)
    { amount: 1000, category: "pos_income", invoice_id: null, settleDate: "2026-07-09", settleExact: false }, // for 07-07 (T+2)
  ];
  const h1 = computeResult([], twoPayouts, [], turnover);
  check("HIGH-1: consecutive DAT-less payouts don't double-count (omzet = 2× till net, not +1000)", near(h1.omzet, 826.45 * 2) && h1.cashOmzetZonderBtw === 0);

  // HIGH-2: a prior-quarter (buffer) covered day must still get a budget, so a same-day WEBSHOP
  // payout settling THIS quarter is counted here, not hidden in both quarters. (Terminal ≤ pin
  // is suppressed as prior-quarter money.)
  const jun30: DailyTurnover = { turnover_date: "2026-06-30", base_0: 0, base_9: 0, base_21: 826.45, btw_9: 0, btw_21: 173.55, total_incl: 1000, pin_amount: 1000, cash_amount: 0, other_amount: 0 };
  const coveredQ3 = new Set(["2026-06-30"]);
  const budgetQ3 = new Map([["2026-06-30", cardBudgetBound(jun30)]]);
  const terminal = toResultBankTx({ amount: 1000, category: "pos_income", invoice_id: null, date: "2026-07-02", description: "CCV afrek. DAT. 20260630" });
  const webshop = toResultBankTx({ amount: 400, category: "omzet", invoice_id: null, date: "2026-07-02", description: "Mollie uitbetaling webshop" });
  const h2 = computeResult([], [terminal, webshop], [], [], coveredQ3, 0, budgetQ3);
  check("HIGH-2: cross-quarter webshop payout counts THIS quarter (400), terminal suppressed", near(h2.omzet, 400) && near(h2.cashOmzetZonderBtw, 400));

  // MED-3: pin_amount null → the budget is the NON-CASH takings (gross − cash), so a same-day
  // webshop payout is not absorbed up to the cash amount.
  const nullPin: DailyTurnover[] = [{ turnover_date: "2026-07-06", base_0: 0, base_9: 0, base_21: 826.45, btw_9: 0, btw_21: 173.55, total_incl: 1000, pin_amount: null, cash_amount: 400, other_amount: 0 }];
  check("MED-3: null pin → bound = gross − cash (600), not gross (1000)", near(cardBudgetBound(nullPin[0]), 600));
  const term600: ResultBankTx = { amount: 600, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: true };
  const shop400 = toResultBankTx({ amount: 400, category: "omzet", invoice_id: null, date: "2026-07-06", description: "Mollie webshop" });
  const m3 = computeResult([], [term600, shop400], [], nullPin);
  check("MED-3: the €400 webshop is not hidden by the cash portion (omzet = 826.45 + 400)", near(m3.omzet, 826.45 + 400) && near(m3.cashOmzetZonderBtw, 400));

  // MED-4: a WINDOW-matched (DAT-less) negative reversal is NOT in the Z-report net → it must
  // reduce omzet, not vanish (vanishing overstates omzet). An EXACT-dated same-day refund stays a witness.
  const oneDay: DailyTurnover[] = [{ turnover_date: "2026-07-06", base_0: 0, base_9: 0, base_21: 826.45, btw_9: 0, btw_21: 173.55, total_incl: 1000, pin_amount: 1000, cash_amount: 0, other_amount: 0 }];
  const laterReversal: ResultBankTx[] = [{ amount: -200, category: "pos_income", invoice_id: null, settleDate: "2026-07-07", settleExact: false }];
  const m4 = computeResult([], laterReversal, [], oneDay);
  check("MED-4: a window-matched later chargeback reduces omzet (826.45 − 200), not hidden", near(m4.omzet, 826.45 - 200));
  const sameDayRefund: ResultBankTx[] = [{ amount: -200, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: true }];
  const m4b = computeResult([], sameDayRefund, [], oneDay);
  check("MED-4: an exact same-day refund is still a witness of the till's net (omzet = 826.45)", near(m4b.omzet, 826.45));

  // LOW: a 1-cent excess (pin 544.99 vs payout 545.00) is a rounding artifact → witness, no phantom flag.
  const roundy: DailyTurnover[] = [{ turnover_date: "2026-07-06", base_0: 0, base_9: 0, base_21: 500, btw_9: 0, btw_21: 105, total_incl: 605, pin_amount: 544.99, cash_amount: 60, other_amount: 0 }];
  const cent: ResultBankTx[] = [{ amount: 545.00, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: true }];
  const low = computeResult([], cent, [], roundy);
  check("LOW: a €0.01 rounding excess is a witness, not a phantom zonder-tarief nudge", near(low.omzet, 500) && low.cashOmzetZonderBtw === 0);
}

console.log("\n— [FINDING-2] SETTLE_LAG widened to 5 days: a DAT-less T+5 payout still reconciles —");
{
  // A Jun 30 (Q2) sale whose DAT-less payout posts Jul 5 (T+5, over a long weekend + holiday),
  // booked into Q3. Q3's revenue array has no Jun 30 row, but the caller's −5-day covered
  // buffer includes it. With the OLD lag=3 the backward window reached only Jul 2 → the payout
  // was NOT matched → the till's already-counted €900 was booked a SECOND time in Q3. lag=5
  // reaches Jun 30 and suppresses it.
  const bankT5: ResultBankTx[] = [
    { amount: 1089, category: "pos_income", invoice_id: null, settleDate: "2026-07-05", settleExact: false },
  ];
  const covered = new Set(["2026-06-30"]);
  const r = computeResult([], bankT5, [], [], covered);
  check("T+5 DAT-less payout reconciles to the covered Z-report day → not re-counted in the new quarter",
    r.omzet === 0 && r.cashOmzetZonderBtw === 0);

  // A T+6 payout is beyond the 5-day window (and the 5-day buffer) → it is NOT suppressed and
  // counts as real revenue rather than being silently hidden.
  const bankT6: ResultBankTx[] = [
    { amount: 500, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: false },
  ];
  const r6 = computeResult([], bankT6, [], [], covered);
  check("T+6 (beyond the window) counts as revenue → never silently hidden", near(r6.omzet, 500));
}

console.log("\n— turnover cross-quarter settlement lag (R1) —");
{
  // A Mar 31 (Q1) sale settles on the bank Apr 1 (Q2). Q2 has no turnover row for Mar 31,
  // but the caller passes a widened covered set including it → must NOT re-count.
  const bank: ResultBankTx[] = [
    { amount: 500, category: "pos_income", invoice_id: null, settleDate: "2026-03-31" },
  ];
  const covered = new Set(["2026-03-31"]);
  const r = computeResult([], bank, [], [], covered);
  check("pos_income settling in Q2 for a Q1 turnover day is NOT re-counted", r.omzet === 0);
}

console.log("\n— no turnover → byte-identical to before (non-breaking) —");
{
  const bank: ResultBankTx[] = [{ amount: 250, category: "pos_income", invoice_id: null }];
  const r = computeResult([], bank, []);
  check("pos_income still counts as omzet when no turnover exists", r.omzet === 250);
  check("new per-rate fields default to 0", r.turnoverBtw9 === 0 && r.turnoverBtw21 === 0);
}

console.log("\n— salesByRate: per-rate split across all sources, sums to btwVerschuldigd —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 }, // 21%
    { direction: "outgoing", status: "sent", total_ex_btw: 500, btw_amount: 45 },   // 9%
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 }, // purchase, not a sale
  ];
  const cash: ResultCashEntry[] = [{ direction: "in", amount: 218, category: "omzet", btw_rate: 9, date: "2026-05-01" }]; // net 200, btw 18; a real (dated) NON-covered day
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-01", base_0: 10, base_9: 1000, base_21: 100, btw_9: 90, btw_21: 21,
    total_incl: 1221, pin_amount: null, cash_amount: null, other_amount: null,
  }];
  const r = computeResult(inv, [], cash, turnover);
  const byRate = (rate: number) => r.salesByRate.find((s) => s.rate === rate);
  check("21% bucket = invoice 210 + turnover 21", near(byRate(21)!.btw, 231));
  check("9% bucket = invoice 45 + cash 18 + turnover 90", near(byRate(9)!.btw, 153));
  check("0% bucket present (turnover base_0), no btw", near(byRate(0)!.omzet, 10) && byRate(0)!.btw === 0);
  const rateSum = r.salesByRate.reduce((s, x) => s + x.btw, 0);
  check("Σ salesByRate.btw === btwVerschuldigd (no drift)", near(rateSum, r.btwVerschuldigd));
  check("incoming invoice never appears as a sale", byRate(21)!.omzet === 1000 + 100); // not 1400
}

console.log("\n— AUDIT FIXES: creditnota nets, null-date cash excluded —");
{
  // #1 an outgoing creditnota (negative both) must NET its rubriek, not over-declare.
  const r1 = computeResult([
    { direction: "outgoing", status: "paid", total_ex_btw: 1185, btw_amount: 249 },
    { direction: "outgoing", status: "paid", total_ex_btw: -1185, btw_amount: -249 },
  ], [], []);
  check("creditnota nets the 21% bucket back to 0", near(r1.salesByRate.find((s) => s.rate === 21)?.btw ?? -1, 0));
  check("creditnota: btwVerschuldigd = 0 (not over-declared)", near(r1.btwVerschuldigd, 0));

  // #3 a null-date cash omzet on a store that uses turnover must NOT double-count.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-04", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: null, cash_amount: null, other_amount: null,
  }];
  const r3 = computeResult([], [], [{ direction: "in", amount: 109, category: "omzet", btw_rate: 9, date: null }], turnover);
  check("null-date cash on a turnover store is excluded (omzet stays 1000)", near(r3.omzet, 1000));
  check("null-date cash does not inflate the 9% bucket", near(r3.salesByRate.find((s) => s.rate === 9)?.btw ?? 0, 90));
}

console.log("\n— [FIN-5] a turnover day whose rate columns didn't import is not lost —");
{
  // A broken Z-report import: gross printed (total_incl 2000) but the per-rate bases are 0
  // (the normalizer couldn't split it). Old behavior: omzet += 0, 5a += 0 → revenue vanishes
  // and the day slips past the readiness gate. New: the unaccounted gross is recovered as
  // revenue AND flagged as omzet-zonder-tarief so a rate must be assigned before filing.
  const broken: DailyTurnover[] = [{
    turnover_date: "2026-07-05", base_0: 0, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0,
    total_incl: 2000, pin_amount: 1500, cash_amount: 500, other_amount: 0,
  }];
  const r = computeResult([], [], [], broken);
  check("the €2000 gross is NOT lost (counted in omzet)", near(r.omzet, 2000));
  check("it is flagged as omzet-zonder-tarief (blocks readiness)", near(r.cashOmzetZonderBtw, 2000));
  check("5a stays honest — no invented BTW on the unrated day", near(r.btwVerschuldigd, 0));

  // A well-formed day still reconciles exactly — no false 'unrated' trigger from rounding.
  const clean: DailyTurnover[] = [{
    turnover_date: "2026-07-06", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: 1090, cash_amount: 0, other_amount: 0,
  }];
  const rc = computeResult([], [], [], clean);
  check("a reconciling day adds nothing to the no-rate flag", near(rc.cashOmzetZonderBtw, 0));
  check("a reconciling day's omzet is exactly its net (1000)", near(rc.omzet, 1000));
}

console.log("\n— [TRIANGLE] acquirer commission is booked as a cost, no BTW —");
{
  // Till counts card takings GROSS (1090 incl / 1000 net + 90 BTW). Without commission,
  // profit = 1000. Feeding a €15 acquirer commission drops the result to 985 and adds
  // NOTHING to voorbelasting (its BTW belongs to the acquirer invoice, not invented here).
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-03", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: 1090, cash_amount: 0, other_amount: 0,
  }];
  const base = computeResult([], [], [], turnover);
  check("without commission, resultaat = 1000 (overstated)", near(base.resultaat, 1000));
  const withComm = computeResult([], [], [], turnover, undefined, 15);
  check("commission booked → kosten = 15", near(withComm.kosten, 15));
  check("commission booked → resultaat = 985 (honest)", near(withComm.resultaat, 985));
  check("commission adds NO voorbelasting", near(withComm.btwVoorbelasting, 0));
  check("a negative/zero commission is ignored", near(computeResult([], [], [], turnover, undefined, -5).kosten, 0));
}

console.log("\n— [KASSTELSEL] cash-basis invoice leg (scheme 'kas') —");
{
  const hdr = { invoiceId: "inv1", direction: "outgoing" as const, totalEx: 1000, totalBtw: 210, totalInc: 1210 };
  // A fully-paid outgoing invoice, settled this quarter → same figures as factuur.
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-02-10", amountApplied: 1210, estimated: false }]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("kas: full payment → omzet 1000", near(r.omzet, 1000));
  check("kas: btwVerschuldigd 210", near(r.btwVerschuldigd, 210));
  check("kas: booked at 21% in salesByRate", !!r.salesByRate.find((x) => x.rate === 21 && near(x.btw, 210)));
}
{
  // Under kas the `invoices` array is IGNORED — only settlement events count. A huge unpaid
  // invoice passed in `invoices` must contribute NOTHING when there are no settlements.
  const bigInvoice: ResultInvoice[] = [{ direction: "outgoing", status: "paid", total_ex_btw: 99999, btw_amount: 20999 }];
  const r = computeResult(bigInvoice, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [] });
  check("kas: unpaid invoice (no settlement) contributes 0 omzet", near(r.omzet, 0) && near(r.btwVerschuldigd, 0));
}
{
  // Incoming purchase paid this quarter → kosten from the settlement, never a sale row. The BTW is
  // NOT taken from the settlement: it belongs to the quarter of the INVOICE (see below).
  const hdr = { invoiceId: "pur1", direction: "incoming" as const, totalEx: 500, totalBtw: 105, totalInc: 605 };
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-03-01", amountApplied: 605, estimated: false }]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("kas: incoming → kosten 500", near(r.kosten, 500));
  check("kas: incoming does NOT create a sales row", r.salesByRate.length === 0);
  check("kas: a payment on a purchase from ANOTHER quarter deducts nothing here",
    near(r.btwVoorbelasting, 0));
}

// ── [KAS-VOORBELASTING] The deduction is dated by the purchase invoice, on both schemes ─────────
//
// The kasstelsel moves the BTW you OWE to the day your customer pays. It does not move the BTW you
// RECLAIM: "De factuurdatum bepaalt in welk tijdvak u de btw aftrekt" (Belastingdienst), whichever
// scheme you are on. Booking it off the settlement deducted a March bill paid in April a quarter
// late — and deducted it TWICE across a switch of scheme.
{
  const purchase: ResultInvoice[] = [{ direction: "incoming", status: "received", total_ex_btw: 500, btw_amount: 105 }];
  const r = computeResult(purchase, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [] });
  check("kas: an UNPAID purchase invoice of this quarter is deducted in it", near(r.btwVoorbelasting, 105));
  check("kas: …and its cost is not booked before it is paid", near(r.kosten, 0));

  // Both legs together: the cost on the payment date, the deduction on the invoice date, each once.
  const hdr = { invoiceId: "pur2", direction: "incoming" as const, totalEx: 500, totalBtw: 105, totalInc: 605 };
  const ev = buildSettlementEvents(hdr, 0, [{ payDate: "2026-03-01", amountApplied: 605, estimated: false }]);
  const both = computeResult(purchase, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: ev });
  check("kas: paid AND dated in the same quarter → one cost, one deduction",
    near(both.kosten, 500) && near(both.btwVoorbelasting, 105));

  // The same row on the accrual path answers identically — one rule, two schemes.
  const accrual = computeResult(purchase, [], [], [], undefined, 0, undefined, {});
  check("kas and factuur deduct the same purchase invoice alike", near(accrual.btwVoorbelasting, 105));

  // A sales invoice never reaches the deduction, and a supplier's quote is not a purchase.
  const notPurchases: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 900, btw_amount: 189 },
    { direction: "incoming", status: "received", invoice_type: "offerte", total_ex_btw: 900, btw_amount: 189 },
    { direction: "incoming", status: "processing", total_ex_btw: 900, btw_amount: 189 },
  ];
  check("kas: only a verified PURCHASE invoice is deducted",
    near(computeResult(notPurchases, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [] }).btwVoorbelasting, 0));
}
{
  // [AANSLAG] A letter from the Belastingdienst carries no BTW, so a "btw" read off one is a
  // misread and may never reach 5b — through EITHER handle, on EITHER scheme.
  const letter: ResultInvoice[] = [{ id: "a1", direction: "incoming", status: "received", total_ex_btw: 1000, btw_amount: 210 }];
  const viaColumn: ResultInvoice[] = [{ ...letter[0], tax_kind: "inkomstenbelasting" }];
  const viaMap = new Map([["a1", "inkomstenbelasting" as const]]);
  check("kas: a tax letter's misread btw is not voorbelasting (column handle)",
    near(computeResult(viaColumn, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [] }).btwVoorbelasting, 0));
  check("kas: …nor through the id map the kas fetch builds",
    near(computeResult(letter, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [], taxKindByInvoice: viaMap }).btwVoorbelasting, 0));
  check("factuur: the map handle works there too — three callers map no column at all",
    near(computeResult(letter, [], [], [], undefined, 0, undefined, { taxKindByInvoice: viaMap }).btwVoorbelasting, 0));
  check("…and a purchase with no tax kind still deducts",
    near(computeResult(letter, [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: [] }).btwVoorbelasting, 210));
}
{
  // A creditnota refunded this quarter nets omzet + BTW down (negative slice at the real rate).
  const cn = { invoiceId: "cn1", direction: "outgoing" as const, totalEx: -100, totalBtw: -21, totalInc: -121 };
  const events = buildSettlementEvents(cn, 0, [{ payDate: "2026-04-15", amountApplied: -121, estimated: false }]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("kas: creditnota nets omzet to −100", near(r.omzet, -100));
  check("kas: creditnota nets btwVerschuldigd to −21", near(r.btwVerschuldigd, -21));
  check("kas: creditnota nets the 21% rubriek (not a new 0% row)", !!r.salesByRate.find((x) => x.rate === 21 && near(x.btw, -21)));
}
{
  // [MIXED] kas invoice settlement + a till day: both count once, no double (legs are orthogonal).
  const hdr = { invoiceId: "inv2", direction: "outgoing" as const, totalEx: 200, totalBtw: 42, totalInc: 242 };
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-02-02", amountApplied: 242, estimated: false }]);
  const turnover: DailyTurnover[] = [{ turnover_date: "2026-02-02", base_9: 100, btw_9: 9, total_incl: 109, pin_amount: 0, cash_amount: 109 } as DailyTurnover];
  const r = computeResult([], [], [], turnover, undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("kas mixed: omzet = invoice 200 + till 100", near(r.omzet, 300));
  check("kas mixed: btwVerschuldigd = 42 + 9", near(r.btwVerschuldigd, 51));
}
{
  // Sum invariant holds under kas: Σ salesByRate.btw === btwVerschuldigd (unrounded slices).
  const h1 = { invoiceId: "a", direction: "outgoing" as const, totalEx: 1000, totalBtw: 90, totalInc: 1090 };  // 9%
  const h2 = { invoiceId: "b", direction: "outgoing" as const, totalEx: 800, totalBtw: 168, totalInc: 968 };   // 21%
  const ev = [
    ...buildSettlementEvents(h1, 0, [{ payDate: "2026-01-10", amountApplied: 545, estimated: false }]), // half
    ...buildSettlementEvents(h2, 0, [{ payDate: "2026-01-20", amountApplied: 968, estimated: false }]), // full
  ];
  const r = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: ev });
  const sumRate = r.salesByRate.reduce((s, x) => s + x.btw, 0);
  check("kas: Σ salesByRate.btw === btwVerschuldigd", near(sumRate, r.btwVerschuldigd));
}

console.log("\n— [RUBRIEK-SPLIT] a mixed-rate sales invoice lands in the RIGHT rubrieken —");
{
  // €1.000 @ 21% + €1.000 @ 9%. The header can only say 2.000/300 → 15% → snapped to 21%, so the
  // whole €2.000 used to be declared in rubriek 1a while half of it belongs in 1b.
  const mixed = [{ direction: "outgoing" as const, status: "sent", total_ex_btw: 2000, btw_amount: 300 }];
  const blended = computeResult(mixed, [], [], []);
  check("without lines the blend still snaps to one rate (unchanged behaviour)",
    blended.salesByRate.length === 1 && blended.salesByRate[0].rate === 21);

  const split = computeResult(
    [{ ...mixed[0], rate_lines: [{ rate: 21, ex: 1000, btw: 210 }, { rate: 9, ex: 1000, btw: 90 }] }],
    [], [], [],
  );
  check("with lines it declares two rubrieken", split.salesByRate.length === 2);
  check("1a gets its own thousand", split.salesByRate.find((r) => r.rate === 21)?.omzet === 1000);
  check("1b gets its own thousand", split.salesByRate.find((r) => r.rate === 9)?.omzet === 1000);
  check("the omzet total is identical either way", near(split.omzet, blended.omzet) && near(split.omzet, 2000));
  check("the BTW total is identical either way", near(split.btwVerschuldigd, blended.btwVerschuldigd) && near(split.btwVerschuldigd, 300));
  check("Σ salesByRate.btw still equals btwVerschuldigd",
    near(split.salesByRate.reduce((s, x) => s + x.btw, 0), split.btwVerschuldigd));
}
{
  // A creditnota on a mixed invoice NETS each rubriek instead of over-declaring one.
  const r = computeResult(
    [
      { direction: "outgoing", status: "sent", total_ex_btw: 2000, btw_amount: 300,
        rate_lines: [{ rate: 21, ex: 1000, btw: 210 }, { rate: 9, ex: 1000, btw: 90 }] },
      { direction: "outgoing", status: "paid", total_ex_btw: -1000, btw_amount: -210,
        rate_lines: [{ rate: 21, ex: -1000, btw: -210 }] },
    ], [], [], [],
  );
  check("the creditnota nets the 21% rubriek to zero", near(r.salesByRate.find((x) => x.rate === 21)?.omzet ?? -1, 0));
  check("…and leaves the 9% rubriek untouched", near(r.salesByRate.find((x) => x.rate === 9)?.omzet ?? -1, 1000));
}

console.log("\n— [RUBRIEK-SPLIT][KASSTELSEL] a payment carries a share of EVERY rate —");
{
  // A €2.300 mixed invoice (1.000@21 + 1.000@9), half paid this quarter. Cash basis books half
  // the omzet — and that half is not "21% money", it is half of each rate.
  const header = { invoiceId: "m1", direction: "outgoing" as const, totalEx: 2000, totalBtw: 300, totalInc: 2300 };
  const events = buildSettlementEvents(header, 0, [{ payDate: "2026-02-10", amountApplied: 1150, estimated: false }]);
  const shares = new Map([["m1", [{ rate: 21, ex: 1000, btw: 210 }, { rate: 9, ex: 1000, btw: 90 }]]]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events, rateSharesByInvoice: shares });
  check("half the invoice is declared", near(r.omzet, 1000) && near(r.btwVerschuldigd, 150));
  check("split across both rubrieken", r.salesByRate.length === 2);
  check("each rubriek gets half of its own rate", near(r.salesByRate.find((x) => x.rate === 21)?.omzet ?? 0, 500) && near(r.salesByRate.find((x) => x.rate === 9)?.omzet ?? 0, 500));
  check("Σ salesByRate.btw === btwVerschuldigd (no cent created or lost)",
    near(r.salesByRate.reduce((s, x) => s + x.btw, 0), r.btwVerschuldigd));

  // Without the mix the old header-derived rate applies — same totals, one rubriek.
  const plain = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("no mix supplied → unchanged single-rubriek behaviour", plain.salesByRate.length === 1);
  check("…with the same totals", near(plain.omzet, r.omzet) && near(plain.btwVerschuldigd, r.btwVerschuldigd));
}

console.log("\n— [VRIJGESTELD][KASSTELSEL] a part-exempt settlement keeps the rate it was CHARGED —");
{
  // A dentist invoices €100 exempt care (art. 11) next to €100 whitening at 21% (BTW €21), and the
  // patient pays it in full. The settlement's rate comes off the FULL header — 21 ÷ 200 = 10,5% —
  // which snaps to 9% and books a 21% supply into rubriek 1b. All of that BTW belongs to the taxed
  // half, so it has to be divided by the taxed half. The accrual branch already did this; the cash
  // branch was still on the header.
  const hdr = { invoiceId: "tand1", direction: "outgoing" as const, totalEx: 200, totalBtw: 21, totalInc: 221 };
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-05-04", amountApplied: 221, estimated: false }]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, {
    scheme: "kas", settlements: events, exemptRegime: true,
    exemptShareByInvoice: new Map([["tand1", 0.5]]),
  });
  check("the exempt half reaches no rubriek at all", near(r.vrijgesteldeOmzet, 100));
  check("the taxed half is declared at 21%, not 9%", !!r.salesByRate.find((x) => x.rate === 21 && near(x.omzet, 100)));
  check("nothing lands in 1b", !r.salesByRate.find((x) => x.rate === 9));
  check("and the BTW is untouched — only its rubriek moved", near(r.btwVerschuldigd, 21));
  check("Σ salesByRate.btw === btwVerschuldigd", near(r.salesByRate.reduce((s, x) => s + x.btw, 0), r.btwVerschuldigd));

  // With nothing exempt the header derivation is still exactly what it was.
  const plain = computeResult([], [], [], [], undefined, 0, undefined, { scheme: "kas", settlements: events });
  check("no exempt part → the header-derived rate is unchanged", plain.salesByRate.length === 1 && plain.salesByRate[0].rate === 9);
}
{
  // A WHOLLY exempt settlement: nothing to derive a rate from, and nothing to declare. It must not
  // fall through to a €0 0%-bucket — an empty "1e" row on a fully exempt practice's concept.
  const hdr = { invoiceId: "fysio1", direction: "outgoing" as const, totalEx: 900, totalBtw: 0, totalInc: 900 };
  const events = buildSettlementEvents(hdr, 0, [{ payDate: "2026-05-06", amountApplied: 900, estimated: false }]);
  const r = computeResult([], [], [], [], undefined, 0, undefined, {
    scheme: "kas", settlements: events, exemptRegime: true,
    exemptShareByInvoice: new Map([["fysio1", 1]]),
  });
  check("wholly exempt → all 900 in vrijgesteldeOmzet", near(r.vrijgesteldeOmzet, 900));
  check("wholly exempt → no rubriek row at all", r.salesByRate.length === 0);
  check("wholly exempt → the omzet is still in the result", near(r.omzet, 900));
}

console.log("\n— [CASH-DIRECTION] a refund goes the other way, in every figure —");
{
  const cash = (over: Partial<ResultCashEntry>): ResultCashEntry => ({
    direction: "in", amount: 121, category: "omzet", btw_rate: 21, ...over,
  });

  // A cash sale of €121 incl. 21%, and a €121 refund of it from the same till. They must cancel:
  // the owner sold nothing and owes no BTW. Before the fix the refund was added, so this quarter
  // declared €200 omzet and €42 BTW on money that was handed back.
  const sale = computeResult([], [], [cash({})]);
  check("a cash sale books net omzet", near(sale.omzet, 100) && near(sale.btwVerschuldigd, 21));
  const refunded = computeResult([], [], [cash({}), cash({ direction: "out" })]);
  check("THE FIX: a refund cancels the sale", near(refunded.omzet, 0));
  check("…and the BTW owed on it goes with it", near(refunded.btwVerschuldigd, 0));
  check("…including in the per-rate bucket the aangifte reads",
    refunded.salesByRate.every((b) => near(b.omzet, 0) && near(b.btw, 0)));
  const refundOnly = computeResult([], [], [cash({ direction: "out" })]);
  check("a standalone refund is NEGATIVE omzet, never positive", refundOnly.omzet < 0);

  // Unrated cash omzet: the refund must also come off the "no rate yet" nudge, or the owner is
  // asked to rate money that is no longer revenue.
  const unrated = computeResult([], [], [
    cash({ btw_rate: null, amount: 100 }),
    cash({ btw_rate: null, amount: 100, direction: "out" }),
  ]);
  check("an unrated cash refund also reduces the no-rate figure", near(unrated.cashOmzetZonderBtw, 0));

  // Costs mirror it, and this is the direction that ends in a naheffing: a supplier refund used
  // to ADD cost and, with a bon and a rate, ADD voorbelasting — a deduction on money that came back.
  const cost = computeResult([], [], [
    cash({ category: "kosten", direction: "out", amount: 121, document_id: "bon-1" }),
  ]);
  check("a cash cost books net kosten + voorbelasting",
    near(cost.kosten, 100) && near(cost.btwVoorbelasting, 21));
  const costRefunded = computeResult([], [], [
    cash({ category: "kosten", direction: "out", amount: 121, document_id: "bon-1" }),
    cash({ category: "kosten", direction: "in", amount: 121, document_id: "bon-1" }),
  ]);
  check("THE FIX: a supplier refund cancels the cost", near(costRefunded.kosten, 0));
  check("…and takes its voorbelasting back with it", near(costRefunded.btwVoorbelasting, 0));

  // Undocumented cash cost: full gross, no deduction — the refund follows the same rule.
  const noBon = computeResult([], [], [
    cash({ category: "kosten", direction: "out", amount: 50, btw_rate: null }),
    cash({ category: "kosten", direction: "in", amount: 50, btw_rate: null }),
  ]);
  check("an undocumented cash cost and its refund cancel too", near(noBon.kosten, 0));

  const wages = computeResult([], [], [
    cash({ category: "salaris", direction: "out", amount: 800, btw_rate: null }),
    cash({ category: "salaris", direction: "in", amount: 300, btw_rate: null }),
  ]);
  check("repaid wages reduce the wage cost", near(wages.kosten, 500));
  check("…and never touch BTW", near(wages.btwVoorbelasting, 0) && near(wages.btwVerschuldigd, 0));

  // The amount column stays a magnitude — nothing here may depend on a negative being stored.
  check("the fix reads `direction`, never a negative amount",
    near(computeResult([], [], [cash({ direction: "out", amount: 121 })]).omzet, -100));
}


console.log("\n— [VRIJGESTELD] exempt turnover reaches no rubriek, and costs are apportioned —");
{
  // The dental shape: exempt care turnover beside a small taxable service.
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 132_000, btw_amount: 0, exempt_ex: 132_000 },
    { direction: "outgoing", status: "paid", total_ex_btw: 12_396.69, btw_amount: 2_603.31 },
    { direction: "incoming", status: "received", total_ex_btw: 20_000, btw_amount: 4_200, vat_deduction: "direct_exempt" },
    { direction: "incoming", status: "received", total_ex_btw: 900, btw_amount: 189, vat_deduction: "direct_taxed" },
    { direction: "incoming", status: "received", total_ex_btw: 8_000, btw_amount: 1_680, vat_deduction: "mixed" },
  ];

  // OFF-REGIME (every owner today): nothing is withheld and everything is deducted — the exact
  // arithmetic this engine has always done. This is the regression guard for the other 99%.
  const off = computeResult(inv, [], []);
  check("off-regime: voorbelasting is the full 6.069", near(off.btwVoorbelasting, 6_069));
  check("off-regime: no exempt turnover is recognised", off.vrijgesteldeOmzet === 0);
  check("off-regime: proRataPercent is null", off.proRataPercent === null);
  check("off-regime: the exempt sale still lands in a rate bucket",
    off.salesByRate.some((b) => near(b.omzet, 132_000)));

  // ON-REGIME: the same rows, declared.
  const on = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("omzet still counts the exempt turnover in full", near(on.omzet, 144_396.69));
  check("vrijgesteldeOmzet is named", near(on.vrijgesteldeOmzet, 132_000));
  check("resultaat is unchanged by the regime", near(on.resultaat, off.resultaat));
  check("BTW verschuldigd is untouched — an exemption is not a discount on what was charged",
    near(on.btwVerschuldigd, 2_603.31));
  // The whole point: €132.000 must not appear as 0%-taxed turnover in any bucket.
  check("no rate bucket carries the exempt turnover",
    !on.salesByRate.some((b) => Math.abs(b.omzet - 132_000) < 1));
  check("the taxed sale is still bucketed at 21%",
    on.salesByRate.some((b) => b.rate === 21 && near(b.omzet, 12_396.69)));
  check("pro rata rounds 8,58% up to 9%", on.proRataPercent === 9);
  check("voorbelasting = 189 direct + 9% of 1.680", near(on.btwVoorbelasting, 340.20));
  check("the blocked BTW is reported, not hidden", near(on.voorbelastingGeblokkeerd, 4_200));
  check("nothing was left unresolved", on.voorbelastingUnresolved === 0);
  check("the correction against today's behaviour is thousands",
    off.btwVoorbelasting - on.btwVoorbelasting > 5_000);
}

console.log("\n— [VRIJGESTELD] an unattributed cost gets the ratio, never the full deduction —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1_000, btw_amount: 0, exempt_ex: 1_000 },
    { direction: "outgoing", status: "paid", total_ex_btw: 1_000, btw_amount: 210 },
    // No vat_deduction at all — the ordinary case before anyone classifies anything.
    { direction: "incoming", status: "received", total_ex_btw: 1_000, btw_amount: 210 },
  ];
  const r = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("half exempt ⇒ 50%", r.proRataPercent === 50);
  check("an unclassified cost is apportioned, not fully deducted", near(r.btwVoorbelasting, 105));
}

console.log("\n— [VRIJGESTELD] a part-exempt invoice keeps the rate of its taxed half —");
{
  // €100 exempt care + €100 whitening @21%. Deriving the rate from the FULL header would give
  // 21/200 = 10,5% → a rate that was never charged.
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 200, btw_amount: 21, exempt_ex: 100 },
  ];
  const r = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("the taxed half is declared at 21%", r.salesByRate.some((b) => b.rate === 21 && near(b.omzet, 100)));
  check("and carries all of the BTW", near(r.btwVerschuldigd, 21));
  check("the exempt half is out of the buckets", !r.salesByRate.some((b) => near(b.omzet, 200)));
}

console.log("\n— [VRIJGESTELD] an undecidable ratio understates 5b VISIBLY, never silently —");
{
  // Costs but no turnover at all — a quiet quarter in an exempt practice.
  const inv: ResultInvoice[] = [
    { direction: "incoming", status: "received", total_ex_btw: 1_000, btw_amount: 210, vat_deduction: "mixed" },
    { direction: "incoming", status: "received", total_ex_btw: 500, btw_amount: 105, vat_deduction: "direct_taxed" },
  ];
  const r = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("only the directly attributable BTW is claimed", near(r.btwVoorbelasting, 105));
  check("the rest is reported as unresolved", near(r.voorbelastingUnresolved, 210));
  check("and the percentage is null, not zero", r.proRataPercent === null);
}

console.log("\n— [VRIJGESTELD] the exempt part can never exceed the invoice it sits on —");
{
  // Lines disagreeing with the header (edited after the fact) must not withhold more than exists,
  // which would pull a rubriek negative.
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 100, btw_amount: 0, exempt_ex: 999 },
  ];
  const r = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("the exempt part is clamped to the header", near(r.vrijgesteldeOmzet, 100));
  check("no negative omzet is invented", !r.salesByRate.some((b) => b.omzet < 0));
}

console.log("\n— [VRIJGESTELD] a creditnota on exempt turnover nets, never inflates —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1_000, btw_amount: 0, exempt_ex: 1_000 },
    { direction: "outgoing", status: "paid", total_ex_btw: -400, btw_amount: 0, exempt_ex: -400 },
  ];
  const r = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("the credit reduces the exempt turnover", near(r.vrijgesteldeOmzet, 600));
  check("and reduces omzet with it", near(r.omzet, 600));
}


console.log("\n— [VRIJGESTELD] turnover the feature cannot classify is MEASURED, not assumed away —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 40_000, btw_amount: 0, exempt_ex: 40_000 },
  ];
  const till: DailyTurnover[] = [{
    turnover_date: "2026-08-01", base_0: 0, base_9: 0, base_21: 5_000, btw_9: 0, btw_21: 1_050,
    total_incl: 6_050, pin_amount: null, cash_amount: null, other_amount: null,
  }];
  const cashSale: ResultCashEntry[] = [
    { direction: "in", amount: 1_210, category: "omzet", btw_rate: 21, date: "2026-08-02" },
  ];

  const on = computeResult(inv, [], cashSale, till, undefined, 0, undefined, { exemptRegime: true });
  check("the till day is counted as unclassifiable", on.onclassificeerbareOmzet >= 5_000);
  check("and so is the rated cash sale", near(on.onclassificeerbareOmzet, 6_000));
  check("exemptRegime is reported, distinct from the ratio being null", on.exemptRegime === true);
  // It is still DECLARED — the limit is about the label, never about hiding money from 5a.
  check("the till BTW still reaches verschuldigd", on.btwVerschuldigd > 1_000);

  // Off-regime the figure is 0: for an owner with no exempt turnover it is simply true that this
  // is taxed, and a warning about it would be noise.
  const off = computeResult(inv, [], cashSale, till);
  check("off-regime: nothing is called unclassifiable", off.onclassificeerbareOmzet === 0);
  check("off-regime: exemptRegime is false", off.exemptRegime === false);

  // An invoice-only exempt owner — the case this feature is actually aimed at — has none of it.
  const invoiceOnly = computeResult(inv, [], [], [], undefined, 0, undefined, { exemptRegime: true });
  check("invoice-only exempt owner has nothing unclassifiable", invoiceOnly.onclassificeerbareOmzet === 0);
}

console.log("\n— [VRAAGPOST] the money the result refuses to guess at is NAMED, not dropped —");
{
  // Refusing to guess is only half of an honest figure. An owner with uncoded bank debits reads a
  // resultaat that is not wrong and is not his result either — unless the answer says so.
  const bank: ResultBankTx[] = [
    { amount: -1000, category: "kosten", invoice_id: null },   // coded → counted
    { amount: -3000, category: null, invoice_id: null },        // uncoded debit → named, not counted
    { amount: 2500, category: null, invoice_id: null },         // uncoded credit → named, not counted
    { amount: -800, category: null, invoice_id: "inv-1" },      // pays a counted invoice → explained
  ];
  const r = computeResult([], bank, []);
  check("the coded line is the only one in the result", r.kosten === 1000);
  check("uncoded money OUT is reported", near(r.ongecategoriseerdBankUit, 3000));
  check("uncoded money IN is reported", near(r.ongecategoriseerdBankIn, 2500));
  check("an invoice payment is explained, never a vraagpost", near(r.ongecategoriseerdBankUit, 3000));

  // Split, not netted. €2.500 in and €2.500 out is not "nothing missing" — it is two facts.
  const symmetric = computeResult([], [
    { amount: 2500, category: null, invoice_id: null },
    { amount: -2500, category: null, invoice_id: null },
  ], []);
  check("equal-and-opposite unexplained money does not cancel to silence",
    near(symmetric.ongecategoriseerdBankIn, 2500) && near(symmetric.ongecategoriseerdBankUit, 2500));

  // The completeness property: every bank line is either counted, an invoice payment, or named
  // here. Nothing may fall between the three — that gap is precisely money that vanishes.
  const mixed: ResultBankTx[] = [
    { amount: -100, category: "kosten", invoice_id: null },
    { amount: 250, category: "omzet", invoice_id: null },
    { amount: -75, category: null, invoice_id: null },
    { amount: 400, category: null, invoice_id: null },
    { amount: -900, category: null, invoice_id: "inv-9" },
    { amount: -50, category: "prive", invoice_id: null },   // counted as neither omzet nor kosten
  ];
  const m = computeResult([], mixed, []);
  const explained = mixed.filter((t) => t.invoice_id).reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  const coded = mixed.filter((t) => !t.invoice_id && t.category).reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  const named = m.ongecategoriseerdBankIn + m.ongecategoriseerdBankUit;
  const everything = mixed.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  check("every bank line is counted, explained, or named — none falls between",
    near(explained + coded + named, everything));

  // And an owner who has coded everything sees zeroes, so the figure is a to-do and not decoration.
  const tidy = computeResult([], [{ amount: -100, category: "kosten", invoice_id: null }], []);
  check("a fully coded administration reports no vraagpost",
    tidy.ongecategoriseerdBankIn === 0 && tidy.ongecategoriseerdBankUit === 0);
}

console.log("\n— [OFFERTE-GEEN-OMZET] a quote is not turnover —");
{
  // A quote e-mailed to a customer is stored as invoice_type 'pro_forma', direction 'outgoing',
  // status 'sent', with its real totals on it — and this engine filtered on direction and status
  // alone, so it was declared as taxed omzet. Measured before the guard existed, on exactly the
  // rows below: omzet 11000 / btw 2310 where the truth is 1000 / 210. The owner was told to pay
  // EUR 2.100 of BTW on a quote nobody had accepted, for a document with no invoice number.
  const paid: ResultInvoice = { direction: "outgoing", status: "paid", invoice_type: "factuur", total_ex_btw: 1000, btw_amount: 210 };
  const quote: ResultInvoice = { direction: "outgoing", status: "sent", invoice_type: "pro_forma", total_ex_btw: 10000, btw_amount: 2100 };
  // BOTH spellings are load-bearing: the product writes 'pro_forma', while 'offerte' lives in
  // older rows and in every invoice_type union in the codebase.
  const legacy: ResultInvoice = { ...quote, invoice_type: "offerte" };

  const r = computeResult([paid, quote, legacy], [], [], []);
  check("a sent quote adds no omzet", near(r.omzet, 1000));
  check("…and no verschuldigde BTW", near(r.btwVerschuldigd, 210));
  check("…in either spelling", r.salesByRate.every((s) => near(s.omzet, 1000)));

  // The control, stated as an assertion: without the type the very same rows DO book. This is
  // what every caller that forgets to SELECT invoice_type still gets, and why a gate holds them.
  const blind = computeResult(
    [paid, quote, legacy].map((i) => ({ ...i, invoice_type: undefined })), [], [], [],
  );
  check("a row whose type was not selected still books — the guard fails OPEN",
    near(blind.omzet, 21000) && near(blind.btwVerschuldigd, 4410));

  // The guard may not swallow anything else. A creditnota is negative BY DESIGN and must net.
  const credit: ResultInvoice = { direction: "outgoing", status: "paid", invoice_type: "creditnota", total_ex_btw: -500, btw_amount: -105 };
  const r2 = computeResult([paid, credit], [], [], []);
  check("a creditnota still nets off the omzet", near(r2.omzet, 500) && near(r2.btwVerschuldigd, 105));
  // An invoice with no type at all (an older row) is not a quote and must keep counting.
  const untyped: ResultInvoice = { direction: "outgoing", status: "paid", invoice_type: null, total_ex_btw: 300, btw_amount: 63 };
  check("an untyped row is not treated as a quote", near(computeResult([untyped], [], [], []).omzet, 300));
  // A quote that never left the desk was already excluded by status; it must stay excluded.
  const draftQuote: ResultInvoice = { direction: "outgoing", status: "draft", invoice_type: "pro_forma", total_ex_btw: 999, btw_amount: 209 };
  check("a draft quote is still nothing", near(computeResult([draftQuote], [], [], []).omzet, 0));
}

console.log("\n— [WEEKBATCH] a card batch settles more than one day —");
{
  // A credit-card scheme pays a WEEK in one batch. Its DAT. is a week number, so
  // parsePosSettlement correctly refuses to read it as a date and settleDate falls back to the
  // booking date — the line is DAT-less by construction, which is the case the covered-day window
  // exists for. But the payout could only ever draw down ONE day's card budget, so everything
  // beyond that one day was booked a SECOND time as off-till revenue with no BTW rate.
  //
  // Measured before the fix, on five trading days of EUR 400 card takings paid out as one
  // EUR 2.000 batch: omzet 3.252,90 against a till total of 1.652,90 — EUR 1.600 counted twice,
  // and an omzet-zonder-tarief nudge raised over money nobody earned twice.
  const week = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
  const turnover: DailyTurnover[] = week.map((d) => ({
    turnover_date: d, base_0: 0, base_9: 0, base_21: 330.58, btw_9: 0, btw_21: 69.42,
    total_incl: 400, pin_amount: 400, cash_amount: 0, other_amount: 0,
  }) as DailyTurnover);
  const tillOmzet = 5 * 330.58;
  const batch: ResultBankTx = {
    amount: 2000, category: "pos_income", invoice_id: null,
    settleDate: "2026-03-09", settleExact: false, posSettlement: true,
  };

  const r = computeResult([], [batch], [], turnover);
  check("a weekly batch adds no second helping of revenue", near(r.omzet, tillOmzet));
  check("…and raises no omzet-zonder-tarief over it", near(r.cashOmzetZonderBtw, 0));

  // The excess BEYOND the week's card takings is real off-till revenue and must still count —
  // the fix may not become a way to hide money the till never saw.
  const bigger = computeResult([], [{ ...batch, amount: 2300 }], [], turnover);
  check("a batch larger than the week's takings still books the excess",
    near(bigger.omzet, tillOmzet + 300) && near(bigger.cashOmzetZonderBtw, 300));

  // An EXACT takings date is a claim about ONE day and must NOT widen — the rest is genuinely
  // unexplained and has to count.
  const exact = computeResult([], [{ ...batch, settleDate: "2026-03-06", settleExact: true }], [], turnover);
  check("an exact DAT still consumes only its own day",
    near(exact.cashOmzetZonderBtw, 1600));

  // Day-by-day payouts must keep working — and they leaked one day's takings before this too.
  const perDay: ResultBankTx[] = ["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09"]
    .map((d) => ({ amount: 400, category: "pos_income", invoice_id: null, settleDate: d, settleExact: false, posSettlement: true }));
  check("the same week paid day by day is also exact",
    near(computeResult([], perDay, [], turnover).omzet, tillOmzet));

  // And the till on its own is untouched by any of this.
  check("no bank line at all leaves the till's own omzet alone",
    near(computeResult([], [], [], turnover).omzet, tillOmzet));
}


console.log("\n— [TEGENTEKEN] a document whose base and BTW point opposite ways —");
{
  // Aardappelgroothandel Altena 26700951, as it really stands: base −123,00, btw +13,42.
  // Every credit check passes it (see creditnota-signal.test.ts) and it used to contribute
  // +13,42 to the tax reclaimed instead of −13,42 — € 26,84 wrong on one document.
  const inv: ResultInvoice[] = [
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 },
    { direction: "incoming", status: "received", total_ex_btw: -123, btw_amount: 13.42 },
  ];
  const r = computeResult(inv, [], []);
  check("the impossible BTW is left OUT of 5b", near(r.btwVoorbelasting, 84));
  check("…and reported as a magnitude, so the aangifte can say why", near(r.voorbelastingTegenteken, 13.42));
  // The COST side is untouched: the base is what it is, and this rule is about the tax only.
  check("kosten still counts the credited base", near(r.kosten, 400 - 123));

  // [NEGATIEVE CONTROLE] All three also pass if the rule simply dropped every creditnota, or
  // every purchase. These pin that a correctly-signed credit still NETS the deduction.
  const goed = computeResult([
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 },
    { direction: "incoming", status: "received", total_ex_btw: -123, btw_amount: -13.42 },
  ], [], []);
  check("a correctly signed creditnota is still SUBTRACTED, not refused", near(goed.btwVoorbelasting, 84 - 13.42));
  check("…and reports nothing", goed.voorbelastingTegenteken === 0);

  // And an ordinary quarter reports nothing at all — the field must be quiet on 499 of 500 rows.
  const gewoon = computeResult([{ direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 }], [], []);
  check("an ordinary purchase reports no sign conflict", gewoon.voorbelastingTegenteken === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
