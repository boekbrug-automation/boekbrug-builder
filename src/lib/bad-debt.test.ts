// [BAD-DEBT] Pure node test — run: npx tsx src/lib/bad-debt.test.ts
import {
  detectBadDebt, badDebtNote, oneYearLater, detectVatClawback, vatClawbackNote, type BadDebtInput,
} from "./bad-debt";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const inv = (over: Partial<BadDebtInput> = {}): BadDebtInput => ({
  id: "inv-1", invoiceNumber: "2025-001", clientName: "Klant BV", direction: "outgoing", status: "overdue",
  invoiceType: "factuur", originalInvoiceId: null,
  invoiceDate: "2025-01-01", dueDate: "2025-01-31", totalExBtw: 1000, btwAmount: 210, totalIncBtw: 1210, amountPaid: 0, ...over,
});
const run = (invoices: BadDebtInput[], asOf = "2026-07-19", scheme: "factuur" | "kas" = "factuur") =>
  detectBadDebt({ scheme, asOf, invoices });

console.log("\n— oneYearLater —");
{
  check("2025-01-31 → 2026-01-31", oneYearLater("2025-01-31") === "2026-01-31");
  check("bad input → ''", oneYearLater("nonsense") === "");
}

console.log("\n— kasstelsel: nothing to reclaim —");
{
  const r = run([inv()], "2026-07-19", "kas");
  check("kas → empty", r.eligible.length === 0 && r.totalReclaimableBtw === 0);
}

console.log("\n— eligible: >1yr past due, unpaid, declared —");
{
  const r = run([inv({ dueDate: "2025-01-31" })]); // 1yr = 2026-01-31 ≤ asOf 2026-07-19
  check("1 eligible", r.eligible.length === 1);
  check("reclaimable BTW = 210", near(r.totalReclaimableBtw, 210));
  check("unpaidEx = 1000", near(r.eligible[0].unpaidEx, 1000));
}

console.log("\n— NOT yet a year past due —");
{
  const r = run([inv({ dueDate: "2026-03-01" })]); // 1yr = 2027-03-01 > asOf
  check("not eligible before the 1-year mark", r.eligible.length === 0);
}

console.log("\n— fully paid / partially paid —");
{
  check("fully paid → nothing", run([inv({ amountPaid: 1210 })]).eligible.length === 0);
  const partial = run([inv({ amountPaid: 605 })]); // half paid → half the BTW reclaimable
  check("partial: reclaim only the unpaid half (105)", near(partial.totalReclaimableBtw, 105));
  check("partial: unpaidEx = 500", near(partial.eligible[0].unpaidEx, 500));
}

console.log("\n— excluded rows —");
{
  check("incoming ignored", run([inv({ direction: "incoming" })]).eligible.length === 0);
  check("draft ignored (BTW never declared)", run([inv({ status: "draft" })]).eligible.length === 0);
  check("processing ignored", run([inv({ status: "processing" })]).eligible.length === 0);
  check("paid status ignored (collected)", run([inv({ status: "paid" })]).eligible.length === 0);
  check("0%-sale: no BTW to reclaim", run([inv({ btwAmount: 0, totalIncBtw: 1000 })]).eligible.length === 0);
}

console.log("\n— no due_date → invoice-date fallback, flagged —");
{
  const r = run([inv({ dueDate: null, invoiceDate: "2025-01-01" })]); // 1yr from invoice = 2026-01-01 ≤ asOf
  check("eligible via invoice-date clock", r.eligible.length === 1);
  check("fallback flag set", r.usedInvoiceDateFallback === true);
  const withDue = run([inv({ dueDate: "2025-01-31" })]);
  check("fallback flag NOT set when due_date present", withDue.usedInvoiceDateFallback === false);
}

console.log("\n— asOf gate is inclusive of the exact anniversary —");
{
  const r = run([inv({ dueDate: "2025-07-19" })], "2026-07-19"); // exactly 1 year
  check("exactly 1 year → eligible", r.eligible.length === 1);
}

console.log("\n— creditnota: original already reversed is NOT a bad debt —");
{
  // The owner credited INV-100 (still 'sent', unpaid) with CR-1 six weeks ago. INV-100 has aged
  // past a year, but its BTW was already put back by the creditnota — reclaiming it = a refund
  // not owed. The credited original AND the creditnota row must both drop out.
  const original = inv({ id: "inv-100", invoiceNumber: "INV-100", dueDate: "2025-01-31", amountPaid: 0 });
  const creditnota = inv({
    id: "cr-1", invoiceNumber: "CR-1", invoiceType: "creditnota", originalInvoiceId: "inv-100",
    status: "sent", invoiceDate: "2026-06-01", dueDate: "2026-06-01",
    totalExBtw: -1000, btwAmount: -210, totalIncBtw: -1210, amountPaid: 0,
  });
  const r = run([original, creditnota]);
  check("credited original + creditnota → nothing reclaimable", r.eligible.length === 0 && r.totalReclaimableBtw === 0);
}

console.log("\n— creditnota row never nets against a genuine bad debt —");
{
  // A genuine >1yr bad debt (INV-A, +210) alongside an OLD open creditnota (CR-9, btw -210) for a
  // DIFFERENT original. The creditnota must not enter the pool and cancel the real reclaim to €0.
  const genuine = inv({ id: "inv-A", invoiceNumber: "INV-A", dueDate: "2025-01-01", amountPaid: 0 });
  const oldCredit = inv({
    id: "cr-9", invoiceNumber: "CR-9", invoiceType: "creditnota", originalInvoiceId: "inv-999",
    status: "sent", invoiceDate: "2025-01-01", dueDate: "2025-01-01",
    totalExBtw: -1000, btwAmount: -210, totalIncBtw: -1210, amountPaid: 0,
  });
  const r = run([genuine, oldCredit]);
  check("genuine reclaim survives (count 1, €210)", r.eligible.length === 1 && near(r.totalReclaimableBtw, 210));
  check("no negative total, no phantom count", r.totalReclaimableBtw > 0);
}

console.log("\n— sub-euro reclaim is not surfaced as a bad debt (rounds to €0) —");
{
  // A large sale 99% paid, €0.30 of BTW left unpaid >1yr. It rounds to €0 on every surface, so the
  // note must stay null rather than say "€0 terugvraagbaar".
  const r = run([inv({ totalExBtw: 1000, btwAmount: 210, totalIncBtw: 1210, amountPaid: 1210 - 0.3 / 0.21 - 0.3 })]);
  // Simpler explicit case: reclaimable exactly 0.30 via a tiny 30-cent unpaid remainder on BTW.
  const tiny = detectBadDebt({ scheme: "factuur", asOf: "2026-07-19", invoices: [
    inv({ totalExBtw: 1.43, btwAmount: 0.30, totalIncBtw: 1.73, amountPaid: 0, dueDate: "2025-01-01" }),
  ] });
  check("tiny reclaim is eligible internally", tiny.eligible.length === 1 && near(tiny.totalReclaimableBtw, 0.30));
  check("but badDebtNote stays null (< €0.50)", badDebtNote(tiny) === null);
  void r;
}

console.log("\n— badDebtNote —");
{
  const note = badDebtNote(run([inv(), inv({ invoiceNumber: "2025-002" })]))!;
  check("note names the count + reclaimable euros", /2 verkoopfacturen/.test(note) && /€420/.test(note));
  check("note says NOT auto-verrekend", /NIET automatisch/.test(note));
  check("empty result → null note", badDebtNote(run([inv({ amountPaid: 1210 })])) === null);
}

// ── Art. 29 lid 7 — the purchase side: voorbelasting you must repay ──────────────────────────
const pur = (over: Partial<BadDebtInput> = {}): BadDebtInput => ({
  id: "pur-1", invoiceNumber: "LEV-77", clientName: "Leverancier BV", direction: "incoming", status: "received",
  invoiceType: "factuur", originalInvoiceId: null,
  invoiceDate: "2025-01-01", dueDate: "2025-01-31", totalExBtw: 1000, btwAmount: 210, totalIncBtw: 1210, amountPaid: 0, ...over,
});
const claw = (invoices: BadDebtInput[], asOf = "2026-07-19", extra: { scheme?: "factuur" | "kas"; korActive?: boolean } = {}) =>
  detectVatClawback({ scheme: extra.scheme ?? "factuur", asOf, korActive: extra.korActive, invoices });

console.log("\n— art. 29 lid 7: the clock —");
{
  check("a supplier invoice a year past due is repayable", claw([pur()]).eligible.length === 1);
  check("…and it is the full deducted BTW", near(claw([pur()]).totalRepayableBtw, 210));
  check("one day BEFORE the year is up: nothing yet", claw([pur()], "2026-01-30").eligible.length === 0);
  check("exactly one year: it is due", claw([pur()], "2026-01-31").eligible.length === 1);
  const noDue = claw([pur({ dueDate: null })]);
  check("no due date → the clock runs from the invoice date", noDue.eligible.length === 1 && noDue.eligible[0].dueDate === "2025-01-01");
  check("…and that fallback is reported, never silent", noDue.usedInvoiceDateFallback === true);
  check("no date at all → cannot be aged, so it is not claimed", claw([pur({ dueDate: null, invoiceDate: null })]).eligible.length === 0);
}

console.log("\n— art. 29 lid 7: only what was actually deducted —");
{
  // [KAS-VOORBELASTING] The kasstelsel moves the BTW you OWE, never the deduction: a kas owner
  // deducts on the invoice date like anyone else, so an old unpaid purchase is repayable like
  // anyone else's. This test asserted the opposite while the engine deducted on payment.
  const kas = claw([pur()], "2026-07-19", { scheme: "kas" });
  check("kasstelsel deducts on the invoice date, so art. 29 lid 7 falls due there too",
    kas.eligible.length === 1 && near(kas.totalRepayableBtw, 210));
  check("…and it says exactly what the factuurstelsel says about the same invoice",
    kas.totalRepayableBtw === claw([pur()]).totalRepayableBtw);
  check("KOR deducts no voorbelasting at all → nothing to repay",
    claw([pur()], "2026-07-19", { korActive: true }).eligible.length === 0);
  check("a paid purchase keeps its deduction", claw([pur({ status: "paid", amountPaid: 1210 })]).eligible.length === 0);
  check("a row still in the processing queue was never deducted", claw([pur({ status: "processing" })]).eligible.length === 0);
  check("an archived row was never deducted either", claw([pur({ status: "archived" })]).eligible.length === 0);
  check("a SALES invoice is not a purchase debt", claw([pur({ direction: "outgoing" })]).eligible.length === 0);
  check("0%-inkoop / verlegde BTW carries no deduction to give back",
    claw([pur({ btwAmount: 0, totalIncBtw: 1000 })]).eligible.length === 0);
}

console.log("\n— art. 29 lid 7: partly paid pays back only the unpaid share —");
{
  const half = claw([pur({ amountPaid: 605 })]);
  check("half paid → half the BTW goes back", half.eligible.length === 1 && near(half.totalRepayableBtw, 105));
  check("…and the unpaid ex-BTW is reported with it", near(half.eligible[0].unpaidEx, 500));
  check("overpaid (amount_paid > total) is never a negative debt", claw([pur({ amountPaid: 2000 })]).eligible.length === 0);
  const nearlyPaid = claw([pur({ amountPaid: 1209.99 })]);
  check("a cent short is below materiality, so it is not raised", vatClawbackNote(nearlyPaid) === null);
}

console.log("\n— art. 29 lid 7: a supplier creditnota already put the deduction back —");
{
  const credited = claw([
    pur({ id: "pur-1" }),
    pur({ id: "cn-1", invoiceNumber: "LEV-77-C", invoiceType: "creditnota", originalInvoiceId: "pur-1" }),
  ]);
  check("the credited original is dropped", credited.eligible.length === 0);
  check("…and the creditnota itself is never a debt of its own", credited.totalRepayableBtw === 0);
}

console.log("\n— vatClawbackNote —");
{
  const note = vatClawbackNote(claw([pur(), pur({ id: "pur-2", invoiceNumber: "LEV-78" })]))!;
  check("it opens with LET OP — this one costs money", /^LET OP/.test(note));
  check("it names the count and the euros", /2 inkoopfacturen/.test(note) && /€420/.test(note));
  check("it cites the article that makes it payable", /art\. 29 lid 7/.test(note));
  check("it offers the other resolution: you did pay, so record it", /koppel de betaling|op betaald/i.test(note));
  check("it never claims the app booked it", /NIET automatisch/.test(note));
  check("nothing eligible → no note", vatClawbackNote(claw([pur({ amountPaid: 1210 })])) === null);
}

console.log("\n— [DEEL-CREDIT] a PART of an invoice credited, on both sides —");
{
  // creditnota_partial.sql made a credit for one disputed LINE possible. Both detectors read
  // "is there a creditnota?" as a yes/no and dropped the whole invoice on a yes — a rule that was
  // exactly right while a credit could only ever be the whole thing.
  const credit = (over: Partial<BadDebtInput> = {}): BadDebtInput => inv({
    id: "cn-1", invoiceNumber: "C-1", invoiceType: "creditnota", originalInvoiceId: "inv-1",
    status: "sent", totalExBtw: -100, btwAmount: -21, totalIncBtw: -121, ...over,
  });

  // € 1.210 sold, € 121 credited, the remaining € 1.089 never paid, more than a year past due.
  const r = run([inv(), credit()]);
  check("a partly credited sale is still a bad debt", r.eligible.length === 1);
  check("…and reclaims the BTW on the UNPAID € 1.089, not on the whole invoice",
    near(r.totalReclaimableBtw, 210 * (1089 / 1210)));
  check("…which is € 189, not € 210 and not € 0", near(r.totalReclaimableBtw, 189));
  // Indexed defensively: a negative control that empties this list must SHOW its failures, not
  // crash the run on eligible[0] and hide every assertion after it.
  check("the unpaid ex-BTW follows the same share", near(r.eligible[0]?.unpaidEx ?? 0, 1000 * (1089 / 1210)));

  // The mirror, and the half that COSTS money: this is the naheffing warning, and one partial
  // supplier credit used to switch it off completely.
  const asPurchase = (rows: BadDebtInput[]) => rows.map((x) => ({ ...x, direction: "incoming" as const, status: "received" }));
  const c = detectVatClawback({ scheme: "factuur", asOf: "2026-07-19", invoices: asPurchase([inv(), credit()]) });
  check("a partly credited PURCHASE still owes its voorbelasting back", c.eligible.length === 1);
  check("…on the unpaid part only", near(c.totalRepayableBtw, 189));

  // A FULL credit must keep behaving exactly as it did — that is every creditnota ever made here.
  const full = run([inv(), credit({ totalExBtw: -1000, btwAmount: -210, totalIncBtw: -1210 })]);
  check("a FULLY credited sale is not a bad debt", full.eligible.length === 0 && full.totalReclaimableBtw === 0);
  const fullPurchase = detectVatClawback({ scheme: "factuur", asOf: "2026-07-19",
    invoices: asPurchase([inv(), credit({ totalExBtw: -1000, btwAmount: -210, totalIncBtw: -1210 })]) });
  check("…and nothing is clawed back on one either", fullPurchase.eligible.length === 0);

  // Several credits add up, and so do a credit and a payment. Neither may leave a sliver behind
  // that a floating-point subtraction invented.
  check("two credits together covering the invoice leave nothing",
    run([inv(), credit({ id: "c1", totalIncBtw: -610, totalExBtw: -504.13, btwAmount: -105.87 }),
              credit({ id: "c2", totalIncBtw: -600, totalExBtw: -495.87, btwAmount: -104.13 })]).eligible.length === 0);
  check("a credit plus a part payment covering the rest leaves nothing",
    run([inv({ amountPaid: 1089 }), credit()]).eligible.length === 0);
  check("over-crediting never turns into a negative reclaim",
    run([inv(), credit({ totalIncBtw: -2000, totalExBtw: -1652.89, btwAmount: -347.11 })]).eligible.length === 0);

  // An UNLINKED supplier creditnota reduces nothing — the app cannot tell what it belongs to, and
  // vatClawbackNote tells the owner to check rather than presenting a figure to copy.
  check("a creditnota with no original_invoice_id reduces nothing",
    near(run([inv(), credit({ originalInvoiceId: null })]).totalReclaimableBtw, 210));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
