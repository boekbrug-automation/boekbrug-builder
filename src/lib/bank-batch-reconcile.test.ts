// [BANK-BATCH-RECONCILE] Pure node test — run: npx tsx src/lib/bank-batch-reconcile.test.ts
import { reconcileBatch, resolveBatchNumbers, resolveBatchNumbersDetailed, planBatchAutoConfirm, findSupplierSumMatch, declaredInvoiceNumbers, undeclaredMissingInvoices, type BatchSlotInput, type BatchCandidateInvoice } from "./bank-batch-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const slot = (refNum: string, amount: number | null, isConfirmed = false): BatchSlotInput =>
  ({ refNum, amount, isConfirmed });

console.log("\n— the real M.H. BAL case: 3 invoices sum to the debit —");
{
  // −€2.902,60 debit; three matched invoices that add up exactly.
  const r = reconcileBatch(
    [slot("262627", 900.00), slot("262744", 1002.60), slot("262762", 1000.00)],
    -2902.60,
  );
  check("status = ties", r.status === "ties");
  check("allMatched", r.allMatched === true);
  check("matchedCount = 3", r.matchedCount === 3);
  check("total = 2902.60", Math.abs(r.total - 2902.60) < 0.005);
  check("bankAmount is the magnitude of the debit", r.bankAmount === 2902.60);
  check("diff ≈ 0", Math.abs(r.diff) < 0.005);
}

console.log("\n— a batch that does NOT add up is a mismatch, never a false tie —");
{
  // Two invoices found, both matched, but they sum to 1900 ≠ 2902.60 debit.
  const r = reconcileBatch([slot("A", 900), slot("B", 1000)], -1900.01);
  check("status = mismatch (sum 1900 vs 1900.01)", r.status === "mismatch");
  check("allMatched true (both have amounts)", r.allMatched === true);
  check("diff is reported (−0.01)", Math.abs(r.diff - -0.01) < 0.005);
}

console.log("\n— a missing invoice ⇒ incomplete, sum is not asserted —");
{
  // Third number has no invoice in the system yet (amount null) → cannot claim a tie
  // even though the two known amounts happen to sit under the debit.
  const r = reconcileBatch(
    [slot("262627", 900), slot("262744", 1002.60), slot("262762", null)],
    -2902.60,
  );
  check("status = incomplete", r.status === "incomplete");
  check("allMatched = false", r.allMatched === false);
  check("matchedCount = 2 of 3", r.matchedCount === 2 && r.slotCount === 3);
}

console.log("\n— a lone matched slot equal to the debit still ties —");
{
  const r = reconcileBatch([slot("VHF1", 83.70)], -83.70);
  check("single slot, exact → ties", r.status === "ties");
  check("matchedCount = 1", r.matchedCount === 1);
}

console.log("\n— cent precision: float sums do not spuriously break a real tie —");
{
  // 0.10 + 0.20 + 0.30 in float ≠ 0.60 exactly; cent rounding must still tie.
  const r = reconcileBatch([slot("a", 0.10), slot("b", 0.20), slot("c", 0.30)], -0.60);
  check("float-safe cents tie", r.status === "ties");
}

console.log("\n— sign independence: a positive (credit) batch reconciles too —");
{
  const r = reconcileBatch([slot("x", 500), slot("y", 250)], 750);
  check("credit +750 ties against 500+250", r.status === "ties");
  check("bankAmount = 750", r.bankAmount === 750);
}

console.log("\n— [BATCH-SIGN] a creditnota slot REDUCES the batch total (net, not Σ|…|) —");
{
  // Invoice €300 + creditnota −€20 → the supplier debits the NET €280. The old Σ|amount| showed
  // "ties" against a −€320 debit (300+20) — a green light on a €40 over-charge.
  const net = reconcileBatch([slot("F-1001", 300), slot("CN-1", -20)], -280);
  check("net €280 against a −€280 debit → ties", net.status === "ties");
  const overcharge = reconcileBatch([slot("F-1001", 300), slot("CN-1", -20)], -320);
  check("the −€320 over-charge is a MISMATCH (was a false tie)", overcharge.status === "mismatch");
  check("diff reports the €40 gap", Math.abs(overcharge.diff - -40) < 0.005);
}

console.log("\n— a corrupt (non-finite) amount is treated as unmatched, not a tie —");
{
  const r = reconcileBatch([slot("a", 900), slot("b", Number.NaN)], -900);
  check("NaN slot ⇒ incomplete (never silently equal)", r.status === "incomplete");
  check("matchedCount counts only the finite one", r.matchedCount === 1);
}

console.log("\n— anyConfirmed reflects slot state —");
{
  const r = reconcileBatch([slot("a", 900, true), slot("b", 1000)], -1900);
  check("anyConfirmed = true when a slot is paid", r.anyConfirmed === true);
  check("still ties (900+1000=1900)", r.status === "ties");
}

console.log("\n— an empty slot list is incomplete, not a tie —");
{
  const r = reconcileBatch([], -100);
  check("no slots ⇒ incomplete", r.status === "incomplete");
  check("allMatched = false on empty", r.allMatched === false);
}

const n = (reference: string | null, known: string[], description = "") =>
  resolveBatchNumbers({ reference, description }, known).length;

console.log("\n— resolveBatchNumbers: genuine batch vs PSP junk vs coincidental full-amount —");
{

  // M.H. BAL: 3 reference numbers, all real invoices → a genuine batch (≥2).
  check("3 real invoice numbers → 3 resolved (genuine batch)",
    n("262627, 262744, 262762", ["262627", "262744", "262762"]) === 3);

  // HorecaRama: a Mollie hash + order number, ZERO are invoices → not a batch.
  check("PSP hash + order number → 0 resolved (fall back to single match)",
    n("8152314131466030, 72802", ["82910"]) === 0);

  // The adversarial-review case: a real batch 501+502, PLUS an unrelated invoice 480 that
  // happens to equal the full debit. The reference still resolves to the 2 real invoices —
  // 480 must NOT collapse the batch (it isn't in the reference).
  check("genuine batch keeps 2 resolved even with an unrelated full-amount candidate present",
    n("501, 502", ["501", "502", "480"]) === 2);

  // Whitespace/format independence (matches the matcher's normalizeRef).
  check("normalizes formatting: '26 / 3958' reference resolves to '26/3958' invoice",
    n("26 / 3958", ["26/3958"]) === 1);

  // A confirmed (already-paid) number still counts as resolved, so a partially-paid batch
  // stays a batch even after its paid invoices leave the live candidate set.
  check("confirmed numbers count as resolved (partial-pay batch stays a batch)",
    n("A100, A101", ["A100", "A101"]) === 2);

  // A doubled reference number is not two invoices.
  check("a doubled reference fragment counts once", n("A100, A100", ["A100"]) === 1);

  // Only one of two references is a real invoice → 1 (not a genuine batch on its own).
  check("one real + one junk → 1 resolved", n("A100, ORDER99", ["A100"]) === 1);

  check("empty reference → 0", n(null, ["A100"]) === 0);

  // [BUNDEL-REF-RECOVER] The reason this reads the description: the extractor cut the numbers.
  check("mutilated reference + intact description recovers the real numbers",
    n("045, 046", ["2026-045", "2026-046"], "SEPA Overboeking Betaling facturen 2026-045, 2026-046") === 2);
  check("a prefixed number ('F-1001' → '1001') is recovered too",
    n("1001, 1002", ["F-1001", "F-1002"], "Betaling F-1001, F-1002") === 2);
  check("the returned value is the INVOICE's number, not the fragment",
    resolveBatchNumbers({ reference: "045, 046", description: "facturen 2026-045, 2026-046" },
      ["2026-045", "2026-046"]).join("|") === "2026-045|2026-046");
  check("a number that is NOT in the payment text stays unresolved",
    n("045", ["2026-045", "2026-099"], "factuur 2026-045") === 1);
  // A short number is exact-equality-matchable against the reference the extractor wrote (the
  // manual slot UI has always shown these), but never through the free-text scan…
  check("a 3-digit number resolves by exact fragment equality", n("045, 046", ["045", "046"]) === 2);
  check("…but never from free text alone (below the identity floor)",
    n(null, ["045", "046"], "facturen 045 en 046") === 0);
  // …and the two routes are reported apart, because they are not equally strong evidence.
  check("an exact reference fragment reports via 'reference'",
    resolveBatchNumbersDetailed({ reference: "20260001", description: "" }, ["20260001"])[0]?.via === "reference");
  check("a number recovered from the statement line reports via 'text'",
    resolveBatchNumbersDetailed({ reference: "045", description: "factuur 2026-045" }, ["2026-045"])[0]?.via === "text");
}

console.log("\n— [BANK-BATCH-SHORT-NUMBER] a supplier's short numbers may batch — under every other guard —");
{
  const supplier = (id: string, num: string, amt: number, name = "Groothandel") =>
    ({ id, invoice_number: num, total_inc_btw: amt, client_name: name, direction: "incoming" as const, status: "received" });

  // The everyday case this used to refuse: a wholesaler numbering 045 / 046, one debit of €300.
  const ok = planBatchAutoConfirm({
    reference: "045, 046", bankAmount: -300,
    invoices: [supplier("s1", "045", 100), supplier("s2", "046", 200)],
  });
  check("a 3-digit batch from the REFERENCE is auto-bookable", ok !== null && ok.invoiceIds.length === 2);

  // …but only from the reference. The same numbers merely lying in the free text stay human.
  check("the same numbers found only in free text are NOT auto-booked",
    planBatchAutoConfirm({
      reference: null, description: "bestelling 045 en 046 geleverd", bankAmount: -300,
      invoices: [supplier("s1", "045", 100), supplier("s2", "046", 200)],
    }) === null);

  // Two characters is a coincidence waiting to happen, not an identity.
  check("a 2-character number is refused even from the reference",
    planBatchAutoConfirm({
      reference: "45, 46", bankAmount: -300,
      invoices: [supplier("s1", "45", 100), supplier("s2", "46", 200)],
    }) === null);

  // Every other guard still has to hold — the sum to the cent…
  check("a short batch that does not tie to the cent is refused",
    planBatchAutoConfirm({
      reference: "045, 046", bankAmount: -299.99,
      invoices: [supplier("s1", "045", 100), supplier("s2", "046", 200)],
    }) === null);
  // …one supplier…
  check("a short batch across two suppliers is refused",
    planBatchAutoConfirm({
      reference: "045, 046", bankAmount: -300,
      invoices: [supplier("s1", "045", 100), supplier("s2", "046", 200, "Andere BV")],
    }) === null);
  // …and no unresolved token in the reference.
  check("a short batch with an unresolved token is refused",
    planBatchAutoConfirm({
      reference: "045, 046, 884512", bankAmount: -300,
      invoices: [supplier("s1", "045", 100), supplier("s2", "046", 200)],
    }) === null);
  // …an ambiguous number still blocks it.
  check("two invoices sharing a short number block the batch",
    planBatchAutoConfirm({
      reference: "045, 046", bankAmount: -300,
      invoices: [supplier("s1", "045", 100), supplier("s1b", "045", 100), supplier("s2", "046", 200)],
    }) === null);
  check("a bare year is never an identity",
    n("", ["2026"], "Huur juli 2026") === 0);
  check("a fragment of a longer number does not resolve ('2050' ⊄ '26302050')",
    n("26302050", ["2050"], "factuur 26302050") === 0);
}

console.log("\n— [ROOT] planBatchAutoConfirm: auto-book ONLY a provably-unambiguous batch —");
{
  const inv = (id: string, num: string, amt: number, sup = "Oz + Er Food B.V."): BatchCandidateInvoice =>
    ({ id, invoice_number: num, total_inc_btw: amt, client_name: sup, direction: "incoming", status: "received" });

  // The real Oz + Er Food case: €793,47 debit, 3 invoices summing EXACTLY, all numbers in the ref.
  const invoices = [inv("i1", "26023790", 380.37), inv("i2", "26026707", 195.50), inv("i3", "26031023", 217.60)];
  const tie = planBatchAutoConfirm({ reference: "26023790, 26026707, 26031023", bankAmount: -793.47, invoices });
  check("exact-sum, all-present, one supplier → auto-book the 3", !!tie && tie.invoiceIds.sort().join(",") === "i1,i2,i3");

  // ATAPACK: sum €4.265,41 but only €2.265,41 debited (€2.000 short) → NOT auto (mismatch).
  const atapack = [inv("a1", "26302050", 3685.78, "ATAPACK"), inv("a2", "26302362", 579.63, "ATAPACK")];
  check("short-paid batch (€2.000 diff) is NOT auto-booked",
    planBatchAutoConfirm({ reference: "26302050, 26302362", bankAmount: -2265.41, invoices: atapack }) === null);

  // W ketels: one referenced invoice (26002972) not in the system → incomplete → NOT auto.
  const wketels = [inv("w1", "26002569", 338.82, "W ketels"), inv("w2", "26002857", 654.99, "W ketels"), inv("w3", "26002714", 211.50, "W ketels")];
  check("a not-yet-imported invoice in the batch blocks auto-book",
    planBatchAutoConfirm({ reference: "26002569, 26002857, 26002714, 26002972", bankAmount: -1458.27, invoices: wketels }) === null);

  // Ambiguity: a referenced number maps to TWO unpaid invoices → unsafe → null.
  const dup = [inv("d1", "500", 100), inv("d2", "500", 100), inv("d3", "600", 200)];
  check("an ambiguous number (two invoices) blocks the whole batch",
    planBatchAutoConfirm({ reference: "500, 600", bankAmount: -300, invoices: dup }) === null);

  // Cross-supplier coincidental tie → blocked.
  const cross = [inv("c1", "700", 150, "Alpha BV"), inv("c2", "800", 150, "Beta BV")];
  check("two different suppliers whose sum ties is NOT auto-booked",
    planBatchAutoConfirm({ reference: "700, 800", bankAmount: -300, invoices: cross }) === null);

  // Direction guard: a CREDIT (+) must pay OUTGOING invoices, not incoming.
  check("a credit does not auto-pay incoming purchase invoices",
    planBatchAutoConfirm({ reference: "26023790, 26026707", bankAmount: +575.87, invoices }) === null);

  // A single reference is not a batch → left to the 1:1 safe pass.
  check("a single-reference line is not a batch here",
    planBatchAutoConfirm({ reference: "26023790", bankAmount: -380.37, invoices }) === null);

  // An already-paid invoice is not a live candidate → its number no longer resolves → not auto.
  const paidOne = [inv("p1", "900", 100), { ...inv("p2", "901", 100), status: "paid" }];
  check("a paid invoice can't be re-booked in a batch",
    planBatchAutoConfirm({ reference: "900, 901", bankAmount: -200, invoices: paidOne }) === null);

  // [CREDIT-VERREKEN] A credit note may be part of an automatic batch — that is how this trade
  // settles a return, and reconcileBatch has netted the sign since [BATCH-SIGN]. The guard that
  // used to refuse it said "reconcileBatch sums by magnitude"; that stopped being true, and the
  // guard went on refusing the everyday case for a reason that no longer existed.
  const withCredit = [inv("cn1", "1001", 300), { ...inv("cn2", "CR55", -20) }];
  check("the NET debit (280) is auto-booked, both documents together", (() => {
    const plan = planBatchAutoConfirm({ reference: "1001, CR55", bankAmount: -280, invoices: withCredit });
    return plan?.invoiceIds.length === 2 && plan.invoiceIds.includes("cn1") && plan.invoiceIds.includes("cn2");
  })());
  // …and the magnitude tie it was protecting against is STILL refused: 300 + |−20| = 320 is not
  // what these two documents come to. That is the assertion that must never be lost.
  check("the magnitude tie at 320 is still refused",
    planBatchAutoConfirm({ reference: "1001, CR55", bankAmount: -320, invoices: withCredit }) === null);
  // A batch of nothing but credit notes is not a payment, whichever way the money went.
  const onlyCredits = [inv("o1", "CR01", -100), inv("o2", "CR02", -180)];
  check("credit notes alone are never a batch",
    planBatchAutoConfirm({ reference: "CR01, CR02", bankAmount: -280, invoices: onlyCredits }) === null);
  // Credits outweighing the invoices net to −180, which magnitude-ties a €180 debit. Refused: the
  // arithmetic says the money should have run the other way.
  const creditHeavy = [inv("h1", "2001", 100), inv("h2", "CR77", -280)];
  check("a net that runs the other way is refused, however neatly it ties",
    planBatchAutoConfirm({ reference: "2001, CR77", bankAmount: -180, invoices: creditHeavy }) === null);
}

console.log("\n— [BUNDEL] the app must recognise the payment IT generated —");
{
  // The gebundeld betaalverzoek asks the customer for the SUM OF THE OPEN AMOUNTS
  // (src/lib/betaalverzoek.ts buildBundelBetaalverzoek). Invoice A is EUR 1000 with EUR 400
  // already settled by an earlier instalment, invoice B is EUR 500 and fully open, so the QR
  // asks EUR 1100 and the customer transfers exactly that, quoting both numbers.
  // Summing the invoice TOTALS (1500) against that EUR 1100 credit calls the app's own,
  // perfectly correct payment a mismatch.
  const r = reconcileBatch([slot("2026001", 600.00), slot("2026002", 500.00)], 1100.00);
  check("bundle with a partly paid invoice ties on the OPEN amounts", r.status === "ties");

  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "2026-001", total_inc_btw: 1000, amount_paid: 400, client_name: "Klant BV", direction: "outgoing", status: "sent" },
    { id: "b", invoice_number: "2026-002", total_inc_btw: 500, amount_paid: 0, client_name: "Klant BV", direction: "outgoing", status: "sent" },
  ];
  const plan = planBatchAutoConfirm({ reference: "2026-001, 2026-002", bankAmount: 1100, invoices });
  check("auto-confirm books the bundle it generated", plan !== null && plan.invoiceIds.length === 2);

  // The old, total-based reading must NOT tie: EUR 1500 of totals never left the bank.
  const wrong = planBatchAutoConfirm({ reference: "2026-001, 2026-002", bankAmount: 1500, invoices });
  check("a payment equal to the TOTALS (not the open sum) is refused", wrong === null);
}
{
  // Fully-open invoices: open == total, so the classic wholesaler batch is untouched.
  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "F-1001", total_inc_btw: 300, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
    { id: "b", invoice_number: "F-1002", total_inc_btw: 200, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
  ];
  const plan = planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -500, invoices });
  check("all-open batch is unchanged", plan !== null && plan.invoiceIds.length === 2);
  check("missing amount_paid is treated as zero",
    planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -500, invoices: invoices.map(i => ({ ...i, amount_paid: null })) }) !== null);
}
{
  // An invoice whose balance is already covered contributes nothing and must not be
  // auto-booked as part of a batch — it would settle for EUR 0.
  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "F-1001", total_inc_btw: 300, amount_paid: 300, client_name: "Groothandel", direction: "incoming", status: "received" },
    { id: "b", invoice_number: "F-1002", total_inc_btw: 200, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
  ];
  check("a fully covered invoice blocks the automatic batch",
    planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -200, invoices }) === null);
}

console.log("\n— [BANK-SUM-SUGGEST] same-supplier sum without quoted numbers —");
{
  const sInv = (id: string, total: number, o: Partial<import("./bank-batch-reconcile").SupplierSumCandidate> = {}) => ({
    id, invoice_number: `F-${id}`, total_inc_btw: total, amount_paid: 0,
    client_name: "ATAPACK Cash & Carry B.V.", direction: "incoming" as const, status: "received", ...o,
  });

  // The core case: €1.100 debit = €500 + €600 open, same supplier, nothing quoted.
  const hit = findSupplierSumMatch({
    amount: -1100, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 600), sInv("c", 999)],
  });
  check("a unique 2-invoice sum tie is found", hit?.invoiceIds.length === 2);
  check("…naming the right invoices", !!hit && hit.invoiceIds.includes("a") && hit.invoiceIds.includes("b"));
  check("…with the exact total", hit?.total === 1100);

  // AMBIGUITY kills the suggestion: two different subsets tie the same payment.
  const ambiguous = findSupplierSumMatch({
    amount: -1100, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 600), sInv("c", 400), sInv("d", 700)],
  });
  check("two tying subsets → no suggestion (which would it be?)", ambiguous === null);

  // Cross-supplier members never enter the pool.
  const cross = findSupplierSumMatch({
    amount: -1100, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 600, { client_name: "Iemand Anders B.V." })],
  });
  check("a member from ANOTHER supplier breaks the tie → null", cross === null);

  // IBAN identity admits an invoice whose name is weak, when the account matches.
  const viaIban = findSupplierSumMatch({
    amount: -1100, counterpartName: "onleesbare naam",
    counterpartIban: "NL91ABNA0417164300",
    invoices: [
      sInv("a", 500, { vendor_iban: "NL91ABNA0417164300" }),
      sInv("b", 600, { vendor_iban: "NL91ABNA0417164300" }),
    ],
  });
  check("the invoices' own IBAN identifies the pool when the name cannot", viaIban?.invoiceIds.length === 2);

  // Partial-pay aware: it sums OPEN balances, not totals.
  const partial = findSupplierSumMatch({
    amount: -700, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500, { amount_paid: 400 }), sInv("b", 600)], // open: 100 + 600 = 700
  });
  check("open balances (not totals) make the tie", partial?.invoiceIds.length === 2 && partial.total === 700);

  // Guards: a creditnota in the pool, a single-invoice tie, direction, cents.
  // [CREDIT-VERREKEN] The netted payment — an invoice paid short by a credit the supplier sent.
  // Nothing is quoted in the reference, so this suggestion is the only thing standing between the
  // owner and "Geen factuur" over a line that reconciles exactly.
  check("a creditnota is netted INTO the sum", (() => {
    const hit = findSupplierSumMatch({
      amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
      invoices: [sInv("a", 300), sInv("cn", -20)],
    });
    return hit?.invoiceIds.length === 2 && hit.total === 280;
  })());
  check("…and the reported payment: 1.764,76 − 52,38 = 1.712,38", (() => {
    const hit = findSupplierSumMatch({
      amount: -1712.38, counterpartName: "Enka Horeca B.V.",
      invoices: [
        sInv("i", 1764.76, { client_name: "Enka Horeca B.V." }),
        sInv("c", -52.38, { client_name: "Enka Horeca B.V." }),
      ],
    });
    return hit?.invoiceIds.length === 2 && hit.total === 1712.38;
  })());
  check("credit notes alone are not a payment", findSupplierSumMatch({
    amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("x", -100), sInv("y", -180)],
  }) === null);
  check("a net that runs the other way is refused", findSupplierSumMatch({
    amount: -180, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 100), sInv("cn", -280)],
  }) === null);
  check("a SUPERSET that also ties is an ambiguity, not a bonus", (() => {
    // {300, −20} = 280, and so does {300, −20, 100, −100} — an invoice cancelled by its own
    // credit note, which is an ordinary pair to be holding. Both answers move the same money and
    // close DIFFERENT documents, so there is no honest way to pick one. The walk therefore keeps
    // looking after it finds a tie; returning early (the shape it had while every member was
    // positive, where a superset could only overshoot) would have hidden this one.
    return findSupplierSumMatch({
      amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
      invoices: [sInv("a", 300), sInv("cn", -20), sInv("b", 100), sInv("c", -100)],
    }) === null;
  })());
  check("a tie can never be negative, so no sign guard is needed after it", (() => {
    // Stated because the automatic batch path DOES need one: it compares magnitudes. Here the
    // target is |amount|, a positive number, so a set of credit notes cannot reach it at all.
    return findSupplierSumMatch({
      amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
      invoices: [sInv("x", -100), sInv("y", -180)],
    }) === null;
  })());
  check("an ambiguous netting stays silent — two sets, same total", (() => {
    // {a 300, cn −20} = 280 and {b 280} … the single-invoice case is not this feature's job, so
    // the second tie has to be another PAIR: {c 400, d −120} also nets 280.
    const two = findSupplierSumMatch({
      amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
      invoices: [sInv("a", 300), sInv("cn", -20), sInv("c", 400), sInv("d", -120)],
    });
    return two === null;
  })());
  check("the walk still finds a tie that overshoots on the way", (() => {
    // 600 − 20 − 300 = 280. The old positive-only pruning cut the branch the moment the running
    // sum passed the target, so a netted answer that goes high before coming back down was
    // invisible — a miss that looks exactly like "no match".
    const deep = findSupplierSumMatch({
      amount: -280, counterpartName: "ATAPACK Cash & Carry B.V.",
      invoices: [sInv("a", 600), sInv("cn", -20), sInv("b", -300)],
    });
    return deep?.invoiceIds.length === 3 && deep.total === 280;
  })());
  check("a single-invoice equality is NOT this feature's job", findSupplierSumMatch({
    amount: -500, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 601)],
  }) === null);
  check("the sign guard holds (credit vs purchase invoices)", findSupplierSumMatch({
    amount: 1100, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 600)],
  }) === null);
  check("a cent off is NOT a tie", findSupplierSumMatch({
    amount: -1100.01, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: [sInv("a", 500), sInv("b", 600)],
  }) === null);
  check("an oversized pool proves nothing → null", findSupplierSumMatch({
    amount: -1100, counterpartName: "ATAPACK Cash & Carry B.V.",
    invoices: Array.from({ length: 13 }, (_, i) => sInv(`x${i}`, 100 + i)),
  }) === null);
}


// ── [DECLARED-INVOICE] numbers the payment CALLS invoices ────────────────────────────────────
// The real ATAPACK payment: €2.265,41 whose description names TWO invoices while only one is in
// the books. resolveBatchNumbers cannot see the second (it matches against what we hold), so the
// slot view never appeared and the whole payment was offered as a deelbetaling on the first —
// leaving the second to arrive with its money already spent.
console.log("\n— a payment that names invoices we do not have —");
{
  const atapack = {
    reference: null,
    description: "Tweede deel factuur 26302050 , factuur 26302362",
  };
  const declared = declaredInvoiceNumbers(atapack);
  check("both numbers are read from the real description", declared.join(",") === "26302050,26302362");
  check("only the one we do not hold is reported missing",
    undeclaredMissingInvoices(atapack, ["26302050"]).join(",") === "26302362");
  check("holding both reports nothing missing",
    undeclaredMissingInvoices(atapack, ["26302050", "26302362"]).length === 0);

  // One keyword can introduce a LIST. Stopping at the first number would drop the rest — the same
  // class of silent miss this function exists to close.
  check("a plural list is read whole",
    declaredInvoiceNumbers({ reference: null, description: "betaling facturen 26302050, 26302362 en 26302999" }).length === 3);
  check("'en' joins a list too",
    declaredInvoiceNumbers({ reference: null, description: "factuur 12345 en 67890" }).join(",") === "12345,67890");

  // CONSERVATIVE. A false negative costs nothing; a false positive holds up a legitimate booking.
  check("a bare number is NOT claimed as an invoice",
    declaredInvoiceNumbers({ reference: null, description: "SEPA incasso 987654321 Brabant Water" }).length === 0);
  check("a customer number is not an invoice number",
    declaredInvoiceNumbers({ reference: null, description: "Klantnummer 4455667 termijn juli" }).length === 0);
  check("a PSP hash is not claimed", declaredInvoiceNumbers({ reference: null, description: "Mollie tr_8xKq2P order 1029" }).length === 0);
  check("nothing in, nothing out", declaredInvoiceNumbers({ reference: null, description: "" }).length === 0);

  // The 4-character floor referenceMatches already uses — shorter is not identity.
  check("a 3-digit number after the keyword is below the floor",
    declaredInvoiceNumbers({ reference: null, description: "factuur 123" }).length === 0);

  // Spelling variants a bank line really carries.
  check("factuurnr. is recognised", declaredInvoiceNumbers({ reference: null, description: "Factuurnr. 26302050" }).join(",") === "26302050");
  check("invoice (English) is recognised", declaredInvoiceNumbers({ reference: null, description: "payment invoice 26302050" }).join(",") === "26302050");
  check("a repeated number is one invoice",
    declaredInvoiceNumbers({ reference: null, description: "factuur 26302050 herhaling factuur 26302050" }).length === 1);

  // The reference field counts as payment text too.
  check("the reference field is scanned as well",
    declaredInvoiceNumbers({ reference: "factuur 26302050", description: "" }).join(",") === "26302050");

  // A fragment the extractor carved out of a number we DO hold must not read as missing —
  // same containment rule the slot view uses.
  check("a carved fragment of a held number is not 'missing'",
    undeclaredMissingInvoices({ reference: null, description: "factuur 2026045" }, ["2026-045"]).length === 0);
}

{
  console.log("\n— [BUNDEL-DREMPEL] the batch door refuses what the single door refuses —");

  // Two purchase invoices of one supplier, 400 + 600, against a 1000 debit. The tie is exact and
  // both numbers are printed on the statement line, so this is a bundle both passes would take. Then the same
  // pair with the second invoice in each never-payable state, one at a time.
  const inv = (id: string, number: string, total: number, status: string, accountantStatus: string | null = null): BatchCandidateInvoice => ({
    id, invoice_number: number, total_inc_btw: total, client_name: "Groothandel De Vries",
    direction: "incoming", status, accountant_status: accountantStatus,
  });
  const plan = (second: BatchCandidateInvoice) => planBatchAutoConfirm({
    reference: null, description: "Betaling facturen 2026-401 en 2026-402", bankAmount: -1000,
    invoices: [inv("a", "2026-401", 400, "received"), second],
  });

  check("a healthy pair still books unattended",
    plan(inv("b", "2026-402", 600, "received"))?.invoiceIds.length === 2);
  for (const status of ["draft", "archived", "processing", "paid"]) {
    check(`a '${status}' invoice can never be part of an auto-booked bundle`,
      plan(inv("b", "2026-402", 600, status)) === null);
  }
  check("an invoice the accountant marked verwerkt can never be part of one",
    plan(inv("b", "2026-402", 600, "received", "verwerkt")) === null);

  // The same rule on the SUM suggestion — the path the owner confirms by hand. Nothing is quoted
  // here: identity is the supplier name, and the arithmetic is the whole evidence.
  const sum = (second: BatchCandidateInvoice) => findSupplierSumMatch({
    amount: -1000, counterpartName: "Groothandel De Vries", counterpartIban: null,
    invoices: [inv("a", "2026-401", 400, "received"), second],
  });
  check("a healthy pair is still suggested as a sum", sum(inv("b", "2026-402", 600, "received"))?.invoiceIds.length === 2);
  for (const status of ["draft", "archived", "processing"]) {
    check(`a '${status}' invoice is never offered inside a sum suggestion`,
      sum(inv("b", "2026-402", 600, status)) === null);
  }
  check("a verwerkt invoice is never offered inside a sum suggestion",
    sum(inv("b", "2026-402", 600, "received", "verwerkt")) === null);

  // And the point of all of it, stated as the failure it prevents: a draft is not a bill yet.
  // Before this rule the pair above tied to the cent, rendered as a card, and booked € 600 of a
  // real payment against a document the customer had never been sent.
  check("the refusal is about payability, not about the arithmetic — the tie itself is still exact",
    (inv("a", "2026-401", 400, "received").total_inc_btw ?? 0) + (inv("b", "2026-402", 600, "draft").total_inc_btw ?? 0) === 1000);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

