// [BOEK-016] Pure node test for bank-matching.ts — run: npx tsx bank-matching.test.ts
import type { BankTransaction } from "./bank-parser";
import { buildMatchMemory } from "./match-memory";
import {
  matchTransactions,
  nameSimilarity,
  referenceMatches,
  amountMatches,
  dateProximityScore,
  isEligible,
  isNettedCreditNote,
  isFullyCovered,
  bankLineFullyApplied,
  isStrongNameIdentity,
  coveredNumbersRecovered,
  coveredReferenceNumbers,
  dedupeCandidates,
  isPartialPaymentHint,
  isSafeAutoConfirm,
  autoConfirmTier,
  scorePair,
  normalizeIban,
  ibanMatches,
  DEFAULT_OPTIONS,
  type InvoiceForMatching,
  type MatchCandidate,
  type TransactionMatch,
} from "./bank-matching";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

function tx(p: Partial<BankTransaction>): BankTransaction {
  return {
    date: "2026-02-10",
    amount: 1210,
    currency: "EUR",
    description: "",
    counterpartName: null,
    counterpartIban: null,
    reference: null,
    transactionId: null,
    rawLine: "",
    ...p,
  };
}
function inv(p: Partial<InvoiceForMatching>): InvoiceForMatching {
  return {
    id: "inv-x",
    invoice_number: "001-2026",
    total_inc_btw: 1210,
    invoice_date: "2026-02-01",
    due_date: "2026-02-15",
    client_name: "Jansen BV",
    direction: "outgoing",
    status: "sent",
    accountant_status: null,
    ...p,
  };
}

console.log("\n— unit helpers —");
check("normalizeRef finds invoice nr in noisy desc",
  referenceMatches({ reference: null, description: "Betaling factuur 001-2026 bedankt" }, "001-2026"));
check("referenceMatches rejects short number '12'",
  !referenceMatches({ reference: "12", description: "" }, "12"));
check("amountMatches exact within epsilon",
  amountMatches(-1210.0, 1210.005, 0.01));
check("amountMatches rejects different amount",
  !amountMatches(1210, 1300, 0.01));
check("dateProximity highest when same day",
  dateProximityScore("2026-02-01", "2026-02-01", null, 45) > 0.24);
check("dateProximity zero beyond window",
  dateProximityScore("2026-06-01", "2026-02-01", null, 45) === 0);
check("nameSimilarity strips legal suffix (Jansen BV ~ JANSEN)",
  nameSimilarity("JANSEN BV", "Jansen") >= 0.9);
check("nameSimilarity containment (extra words still match)",
  nameSimilarity("JANSEN BV INZAKE FACTUUR", "Jansen BV") >= 0.85);
check("nameSimilarity unrelated names ~ low",
  nameSimilarity("De Vries Bouw", "Pietersen Transport") < 0.2);
// [BANK-MATCH-PSP] processor prefixes are stripped so the merchant still matches
check("nameSimilarity strips SumUp prefix (SUMUP *JANSEN ~ Jansen BV)",
  nameSimilarity("SUMUP *JANSEN", "Jansen BV") >= 0.85);
check("nameSimilarity strips CCV prefix (CCV*De Vries ~ De Vries)",
  nameSimilarity("CCV*De Vries", "De Vries") >= 0.85);
check("nameSimilarity strips iDEAL prefix (iDEAL Bol.com ~ Bol.com)",
  nameSimilarity("iDEAL Bol.com", "Bol.com") >= 0.85);
check("nameSimilarity PSP noise doesn't fabricate a match",
  nameSimilarity("SUMUP *JANSEN", "Pietersen Transport") < 0.2);

console.log("\n— eligibility (direction / status / B.4) —");
check("credit (+) excludes incoming invoice",
  !isEligible(tx({ amount: 500 }), inv({ direction: "incoming" })));
check("debit (-) excludes outgoing invoice",
  !isEligible(tx({ amount: -500 }), inv({ direction: "outgoing" })));
check("verwerkt invoice excluded (B.4)",
  !isEligible(tx({}), inv({ accountant_status: "verwerkt" })));
check("paid invoice excluded",
  !isEligible(tx({}), inv({ status: "paid" })));
check("draft invoice excluded",
  !isEligible(tx({}), inv({ status: "draft" })));
check("processing (verify queue) invoice excluded — never auto-paid before it's verified",
  !isEligible(tx({}), inv({ status: "processing" })));
check("archived invoice excluded",
  !isEligible(tx({}), inv({ status: "archived" })));
check("zero-amount transaction excluded",
  !isEligible(tx({ amount: 0 }), inv({})));
check("valid outgoing+credit is eligible",
  isEligible(tx({ amount: 1210 }), inv({})));
// [BANK-MATCH-ARREARS] Grace widened 3 → 10 days so a bill-in-arrears / SEPA incasso
// (charged on the 1st, invoice dated a few days later) still surfaces as a candidate.
check("incasso 4 days before the invoice date is STILL eligible (arrears grace)",
  isEligible(tx({ amount: -323.68, date: "2026-06-01" }),
             inv({ direction: "incoming", total_inc_btw: 323.68, invoice_date: "2026-06-05" })));
check("payment 8 days before the invoice date is eligible (within 10-day grace)",
  isEligible(tx({ amount: -100, date: "2026-06-02" }),
             inv({ direction: "incoming", total_inc_btw: 100, invoice_date: "2026-06-10" })));
check("payment 16 days before the invoice date is NOT eligible (previous month's bill)",
  !isEligible(tx({ amount: -100, date: "2026-05-30" }),
              inv({ direction: "incoming", total_inc_btw: 100, invoice_date: "2026-06-15" })));

// [M7-CREDITNOTA] A creditnota (negative total) reverses the money direction of its settlement.
console.log("\n— creditnota refunds (M7) —");
check("supplier creditnota (incoming, −total) refunded as money IN (credit) IS eligible",
  isEligible(tx({ amount: 100, date: "2026-06-10" }),
             inv({ direction: "incoming", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("our creditnota (outgoing, −total) refunded as money OUT (debit) IS eligible",
  isEligible(tx({ amount: -100, date: "2026-06-10" }),
             inv({ direction: "outgoing", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("creditnota still guarded: incoming creditnota with a DEBIT is NOT eligible",
  !isEligible(tx({ amount: -100, date: "2026-06-10" }),
              inv({ direction: "incoming", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("creditnota still guarded: outgoing creditnota with a CREDIT is NOT eligible",
  !isEligible(tx({ amount: 100, date: "2026-06-10" }),
              inv({ direction: "outgoing", total_inc_btw: -100, invoice_date: "2026-06-05" })));
check("a normal invoice is unchanged by the creditnota rule (credit → outgoing)",
  isEligible(tx({ amount: 100 }), inv({ direction: "outgoing", total_inc_btw: 100 })));
check("amountMatches: a +50 refund matches a −50 creditnota (magnitude)",
  amountMatches(50, -50, 0.02));
check("amountMatches: a −50 refund matches a −50 creditnota (magnitude)",
  amountMatches(-50, -50, 0.02));

// [BANK-IBAN] The counterpart's bank account is a strong, supplier-specific identity:
// a bare amount can collide across suppliers, a full IBAN cannot. With an EXACT amount it
// reaches auto-confirm; alone (wrong amount) it stays a weak, human-reviewed candidate.
console.log("\n— IBAN matching (BANK-IBAN) —");
check("normalizeIban strips spaces/dots + upper-cases",
  normalizeIban("nl91 abna 0417.1643 00") === "NL91ABNA0417164300");
check("normalizeIban rejects junk too short to be an IBAN (< 15)",
  normalizeIban("NL91") === "");
check("normalizeIban rejects an 8-char BIC (not a real IBAN)",
  normalizeIban("INGBNL2A") === "");
check("normalizeIban keeps a real 18-char NL IBAN",
  normalizeIban("NL91ABNA0417164300").length === 18);
check("normalizeIban of null/empty → ''",
  normalizeIban(null) === "" && normalizeIban(undefined) === "" && normalizeIban("") === "");
check("ibanMatches: same account, different formatting → true",
  ibanMatches("NL91 ABNA 0417 1643 00", "nl91abna0417164300"));
check("ibanMatches: different accounts → false",
  !ibanMatches("NL91ABNA0417164300", "NL02RABO0123456789"));
check("ibanMatches: a missing side never matches (no match on absence)",
  !ibanMatches(null, "NL91ABNA0417164300") && !ibanMatches("NL91ABNA0417164300", null));

// scorePair: incoming (purchase) invoice, no reference in the statement, but the debit
// carries the supplier's IBAN AND the exact amount → high confidence, 'iban'+'amount' signals.
{
  const t = tx({ amount: -723.19, date: "2026-06-10", reference: null, counterpartName: "Trimex International",
                 counterpartIban: "NL91 ABNA 0417 1643 00" });
  const i = inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
                  vendor_iban: "nl91abna0417164300", client_name: "Trimex" });
  const s = scorePair(t, i, DEFAULT_OPTIONS);
  check("scorePair IBAN + exact amount → confidence ≥ auto (0.7)", s.confidence >= 0.7);
  check("scorePair IBAN + amount → signals include 'iban' and 'amount'",
    s.signals.includes("iban") && s.signals.includes("amount"));
}
// scorePair: same supplier IBAN but the WRONG amount (a different invoice of theirs) →
// capped weak (≤ 0.35). A same-supplier invoice of another amount must never auto-pay.
{
  const t = tx({ amount: -999.00, date: "2026-06-10", reference: null,
                 counterpartIban: "NL91ABNA0417164300" });
  const i = inv({ id: "T2", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
                  vendor_iban: "NL91ABNA0417164300" });
  const s = scorePair(t, i, DEFAULT_OPTIONS);
  check("scorePair IBAN alone (wrong amount) → capped weak (≤ 0.35)", s.confidence <= 0.35);
}

// matchTransactions integration: a supplier debit with the invoice's IBAN + exact amount and
// no reference → 'auto' AND isSafeAutoConfirm true (the app books it without a human tap).
{
  const r = matchTransactions(
    [tx({ amount: -723.19, date: "2026-06-10", reference: null, counterpartName: "Trimex International",
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
           vendor_iban: "NL91ABNA0417164300", client_name: "Trimex" }),
     inv({ id: "OTHER", direction: "incoming", total_inc_btw: 55.00, invoice_date: "2026-06-08",
           vendor_iban: "NL02RABO0123456789", client_name: "Andere" })]
  );
  const m = r.matches[0];
  check("IBAN + amount, no reference → auto on the right invoice",
    m.outcome === "auto" && m.best?.invoiceId === "T");
  check("IBAN + amount → isSafeAutoConfirm true (books without a tap)", isSafeAutoConfirm(m));
}
// Safety: two same-supplier, same-amount unpaid invoices (same IBAN) → a genuine tie →
// 'choice', never a wrong auto-pay. IBAN can't disambiguate identical bills; the human picks.
{
  const r = matchTransactions(
    [tx({ amount: -100.00, date: "2026-06-10", reference: null,
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "P1", invoice_number: "A-100", direction: "incoming", total_inc_btw: 100.00, invoice_date: "2026-06-05",
           vendor_iban: "NL91ABNA0417164300" }),
     inv({ id: "P2", invoice_number: "A-101", direction: "incoming", total_inc_btw: 100.00, invoice_date: "2026-06-06",
           vendor_iban: "NL91ABNA0417164300" })]
  );
  const m = r.matches[0];
  check("two identical same-IBAN invoices → choice (a tie is never auto-paid)",
    m.outcome === "choice" && !isSafeAutoConfirm(m));
}
// Safety: IBAN + amount but the payment reference explicitly says 'deelbetaling' (instalment) →
// never a one-tap auto (the amount is only part of the bill).
{
  const r = matchTransactions(
    [tx({ amount: -723.19, date: "2026-06-10", reference: null, description: "1e termijn deelbetaling",
          counterpartIban: "NL91ABNA0417164300" })],
    [inv({ id: "T", direction: "incoming", total_inc_btw: 723.19, invoice_date: "2026-06-08",
           vendor_iban: "NL91ABNA0417164300" })]
  );
  check("IBAN + amount but flagged deelbetaling → not a safe auto-confirm",
    !isSafeAutoConfirm(r.matches[0]));
}

console.log("\n— outcomes —");

// 1. Reference match → auto
{
  const r = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026", counterpartName: "ONBEKEND" })],
    [inv({ id: "A" }), inv({ id: "B", invoice_number: "002-2026", total_inc_btw: 999 })]
  );
  const m = r.matches[0];
  check("reference match → auto", m.outcome === "auto" && m.best?.invoiceId === "A");
  check("reference match signals include 'reference'", !!m.best?.signals.includes("reference"));
}

// 1b. [QF3] Reference match with the WRONG amount must NOT auto-mark the invoice paid.
{
  const r = matchTransactions(
    // €50 payment quoting invoice 001-2026 (€1210) — a partial/mis-referenced payment.
    [tx({ amount: 50, reference: "001-2026", counterpartName: "ONBEKEND" })],
    [inv({ id: "A", total_inc_btw: 1210 })]
  );
  const m = r.matches[0];
  check("wrong-amount reference → NOT auto (human choice)", m.outcome !== "auto");
  check("wrong-amount reference → still listed as a candidate", (m.candidates?.length ?? 0) > 0);
}

// 2. Amount + date + counterpart → auto
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "JANSEN BV" })],
    [inv({ id: "A", client_name: "Jansen BV" })]
  );
  check("amount+date+counterpart → auto", r.matches[0].outcome === "auto");
}

// 3. Two same-amount invoices, unknown counterpart → choice (ambiguity)
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: null })],
    [
      inv({ id: "A", client_name: "Jansen BV" }),
      inv({ id: "B", client_name: "De Vries", invoice_number: "002-2026" }),
    ]
  );
  const m = r.matches[0];
  check("two same-amount, no counterpart → choice", m.outcome === "choice");
  check("choice lists both candidates", m.candidates.length === 2);
}

// 4. Two same-amount invoices, counterpart distinguishes → auto for the right one
{
  const r = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "De Vries" })],
    [
      inv({ id: "A", client_name: "Jansen BV" }),
      inv({ id: "B", client_name: "De Vries", invoice_number: "002-2026" }),
    ]
  );
  const m = r.matches[0];
  check("counterpart breaks the tie → auto on B", m.outcome === "auto" && m.best?.invoiceId === "B");
}

// 5. No match (amount off, no reference) → none
{
  const r = matchTransactions(
    [tx({ amount: 77.5, date: "2026-02-12", counterpartName: "Random" })],
    [inv({ id: "A" })]
  );
  check("unrelated transaction → none", r.matches[0].outcome === "none");
}

// 6. Incoming invoice matched by a debit (negative) → auto
{
  const r = matchTransactions(
    [tx({ amount: -450, date: "2026-03-02", reference: "INK-2026-44" })],
    [inv({ id: "V", direction: "incoming", status: "received", invoice_number: "INK-2026-44", total_inc_btw: 450 })]
  );
  const m = r.matches[0];
  check("incoming debit → auto match", m.outcome === "auto" && m.best?.invoiceId === "V");
}

// 7. Aggregate counts
{
  const r = matchTransactions(
    [
      tx({ amount: 1210, reference: "001-2026" }),   // auto
      tx({ amount: 77.5, counterpartName: "X" }),     // none
    ],
    [inv({ id: "A" })]
  );
  check("aggregate counts correct", r.autoCount === 1 && r.noneCount === 1 && r.choiceCount === 0);
}

console.log("\n— [TRUST-MATCH] a short numeric invoice number must not match inside a longer number —");
{
  const t = (r: string) => ({ reference: r, description: "" });
  check("'2050' does NOT match inside '26302050' (no wrong auto-pick)", referenceMatches(t("26302050"), "2050") === false);
  check("exact '26302050' still matches", referenceMatches(t("26302050"), "26302050") === true);
  check("'2050' matches as a clean whole token", referenceMatches(t("factuur 2050 voldaan"), "2050") === true);
  check("real invoice number in description matches", referenceMatches(t("betaling 2026014"), "2026-014") === true);
  check("alphanumeric needle keeps substring match", referenceMatches(t("ref inv2050 x"), "INV2050") === true);
  check("too-short (<4) still rejected", referenceMatches(t("999"), "999") === false);
  // Regression: two space-separated numbers must NOT fuse and hide a real match.
  check("'1001' matches in '12345 1001' (numbers not fused)", referenceMatches(t("12345 1001"), "1001") === true);
  check("year-based '2026-014' matches next to another number", referenceMatches(t("ordernr 99 2026-014"), "2026-014") === true);
  check("hyphenated number matches its printed form", referenceMatches(t("betaling 2026-014 voldaan"), "2026-014") === true);
  check("still rejects a fragment inside a longer fused number", referenceMatches(t("betaling 992026014"), "2026014") === false);
  // [TRUST-MATCH-ALNUM] alphanumeric invoice numbers get the same digit-boundary guard.
  check("'MF26' does NOT match 'MF260' (next sequence number)", referenceMatches(t("betaling MF260"), "MF26") === false);
  check("'MF26' matches exact 'MF26'", referenceMatches(t("betaling MF26 voldaan"), "MF26") === true);
  check("'F2026-01' does NOT match 'F2026-011'", referenceMatches(t("ref F2026011"), "F2026-01") === false);
  check("'F2026-01' matches its printed form", referenceMatches(t("betaling F2026-01"), "F2026-01") === true);
  // A printed letter PREFIX on a numeric invoice number still matches (INV2050 ⊃ 2050).
  check("numeric '2050' still matches inside 'INV2050' (letter prefix ok)", referenceMatches(t("ref INV2050"), "2050") === true);
  check("'INV2050' does NOT match 'INV20500'", referenceMatches(t("ref INV20500"), "INV2050") === false);
}

// [BANK-PSP-MATCH] The HorecaRama case: a PSP (Mollie) debit whose remittance carries a
// transaction hash + order number — NOT the invoice number — must still find the real
// invoice by amount + counterpart. The engine already does; the bug was in the UI (a
// >1 reference-fragment count forced the multi-invoice slot view, which hid this
// amount-matched candidate). This locks the engine behaviour the UI fix relies on.
console.log("\n— [BANK-PSP-MATCH] a PSP payment with a junk reference still matches the real invoice by amount —");
{
  const r = matchTransactions(
    [tx({
      amount: -914.76, // incoming supplier invoice → money out (debit)
      date: "2026-05-27",
      reference: "8152314131466030 72802",
      description: "a54208441c0a8afc8fb6e9eec515c17 8152314131466030 Order ORD 72802 horecarama.nl HorecaRama",
      counterpartName: "HorecaRama via Stichting Mollie Payments",
    })],
    [inv({
      id: "hr-82910",
      invoice_number: "82910",
      total_inc_btw: 914.76,
      invoice_date: "2026-05-27",
      due_date: "2026-06-10",
      client_name: "HorecaRama BV",
      direction: "incoming",
      status: "received",
    })],
  );
  const m = r.matches[0];
  check("the real invoice IS a candidate (not 'none')", m.outcome !== "none" && m.candidates.length >= 1);
  check("candidate is invoice 82910", m.candidates.some((c) => c.invoiceNumber === "82910"));
  check("it matched on amount (not reference)", m.candidates[0]?.signals.includes("amount") === true && !m.candidates[0]?.signals.includes("reference"));
}

console.log("\n— [BANK-SLOT-PERSIST] coveredReferenceNumbers reports the paid subset —");
{
  const paid = new Set(["26302050"]); // only the first invoice of the batch is paid
  const covered = coveredReferenceNumbers("26302050, 26302362", paid);
  check("returns the paid reference number", covered.length === 1 && covered[0] === "26302050");
  check("does not report the still-open number", !covered.includes("26302362"));
  check("both paid → both covered", coveredReferenceNumbers("26302050, 26302362", new Set(["26302050", "26302362"])).length === 2);
  check("none paid → empty", coveredReferenceNumbers("26302050, 26302362", new Set<string>()).length === 0);
  // Consistency with isFullyCovered: covered==refNumbers ⇔ fully covered.
  check("covered-all agrees with isFullyCovered", isFullyCovered("26302050, 26302362", new Set(["26302050", "26302362"])) === true);
}

console.log("\n— [BANK-DEDUP-CANDIDATES] a duplicate invoice is collapsed, a collision is not —");
{
  const cand = (invoiceId: string, invoiceNumber: string | null, amount: number | null, confidence: number): MatchCandidate =>
    ({ invoiceId, invoiceNumber, amount, invoiceDate: "2026-05-06", confidence, signals: ["amount"], reason: "" });
  // famzfood: same number (different whitespace) + same amount → one candidate kept (highest conf).
  const deduped = dedupeCandidates([
    cand("a", "26 / 3958", 630.15, 0.9),
    cand("b", "26/3958", 630.15, 0.7),
  ]);
  check("same number+amount collapses to ONE", deduped.length === 1);
  check("keeps the higher-confidence one", deduped[0].invoiceId === "a");
  // Same number but DIFFERENT amount (a mere collision) → both kept, nothing hidden.
  check("same number, different amount → both kept",
    dedupeCandidates([cand("a", "INV1", 100, 0.9), cand("b", "INV1", 200, 0.8)]).length === 2);
  // No usable number → never collapsed.
  check("null-number candidates are never collapsed",
    dedupeCandidates([cand("a", null, 100, 0.9), cand("b", null, 100, 0.8)]).length === 2);
}

console.log("\n— [BANK-DEDUP-CANDIDATES] matchTransactions shows a duplicate invoice once —");
{
  const r = matchTransactions(
    [tx({ amount: -630.15, date: "2026-05-06", counterpartName: "famzfood", reference: "26 3958" })],
    [
      inv({ id: "d1", invoice_number: "26 / 3958", total_inc_btw: 630.15, direction: "incoming", client_name: "famzfood", invoice_date: "2026-05-06" }),
      inv({ id: "d2", invoice_number: "26/3958", total_inc_btw: 630.15, direction: "incoming", client_name: "famzfood", invoice_date: "2026-05-06" }),
    ],
  );
  check("only one candidate is offered (not the duplicate twice)", r.matches[0].candidates.length === 1);
}

console.log("\n— [BANK-PARTIAL] instalment references are detected and kept out of auto —");
{
  check("'Tweede deel factuur 26302050' → partial", isPartialPaymentHint("Tweede deel factuur 26302050") === true);
  check("'2e termijn' → partial", isPartialPaymentHint("betaling 2e termijn") === true);
  check("'deelbetaling' → partial", isPartialPaymentHint("deelbetaling order 99") === true);
  check("'aanbetaling' → partial", isPartialPaymentHint("aanbetaling project") === true);
  check("a normal payment is NOT partial", isPartialPaymentHint("betaling factuur 2026-014 voldaan") === false);
  check("'termijnen' inside a word does not falsely fire", isPartialPaymentHint("kortermijnlening") === false);

  // scorePair: a reference + exact amount would be 0.97 auto, but an instalment marker
  // caps it to a human choice (<= 0.6), so it never one-taps the invoice fully paid.
  const partial = scorePair(
    tx({ amount: -500, reference: "26302050", description: "Tweede deel factuur 26302050" }),
    inv({ invoice_number: "26302050", total_inc_btw: 500, direction: "incoming", status: "received" }),
    DEFAULT_OPTIONS,
  );
  check("instalment ref caps confidence below auto (0.7)", partial.confidence <= 0.6);
  check("a clean full payment still reaches auto", scorePair(
    tx({ amount: -500, reference: "26302050", description: "betaling 26302050" }),
    inv({ invoice_number: "26302050", total_inc_btw: 500, direction: "incoming", status: "received" }),
    DEFAULT_OPTIONS,
  ).confidence >= DEFAULT_OPTIONS.autoConfidence);
}

console.log("\n— [PARTIAL-PAY] the matcher targets the REMAINING balance of a part-paid invoice —");
{
  // €1000 invoice, €400 already settled (amount_paid=400) → €600 remaining. A €600 payment must
  // score an exact 'amount' hit against the REMAINING, not miss against the €1000 total.
  const second = scorePair(
    tx({ amount: -600, reference: null, description: "betaling", counterpartIban: "NL11BANK0123456789" }),
    inv({ total_inc_btw: 1000, amount_paid: 400, direction: "incoming", status: "received", vendor_iban: "NL11BANK0123456789" }),
    DEFAULT_OPTIONS,
  );
  check("second instalment (€600) matches the €600 remaining → 'amount' signal", second.signals.includes("amount"));
  check("a part-paid completion is a human choice, never silent auto (≤ 0.6)", second.confidence <= 0.6);

  // The FULL amount must NOT match a part-paid invoice's remaining (a duplicate full payment is not
  // the €600 that's left) — so it can't be mistaken for the outstanding balance.
  const fullOnPartial = scorePair(
    tx({ amount: -1000, reference: null, description: "betaling", counterpartIban: "NL11BANK0123456789" }),
    inv({ total_inc_btw: 1000, amount_paid: 400, direction: "incoming", status: "received", vendor_iban: "NL11BANK0123456789" }),
    DEFAULT_OPTIONS,
  );
  check("full €1000 does NOT match the €600 remaining ('amount' absent)", !fullOnPartial.signals.includes("amount"));

  // A fully-open invoice (amount_paid absent/0) is unchanged: the full amount still matches the total.
  const fresh = scorePair(
    tx({ amount: -1000, reference: null, description: "betaling", counterpartIban: "NL11BANK0123456789" }),
    inv({ total_inc_btw: 1000, direction: "incoming", status: "received", vendor_iban: "NL11BANK0123456789" }),
    DEFAULT_OPTIONS,
  );
  check("fully-open invoice unchanged: full amount matches the total", fresh.signals.includes("amount"));
}

console.log("\n— [BANK-CHOICE-NOCLAIM] an ambiguous choice does not steal a candidate from another tx —");
{
  // Two €500 "Jansen" credits, two €500 "Jansen" invoices → each tx matches both by
  // amount+counterpart (a genuine ambiguous choice). Neither may claim, so BOTH keep both
  // options for the owner to resolve — no false "geen factuur", no forced auto.
  const r = matchTransactions(
    [
      tx({ amount: 500, date: "2026-02-12", counterpartName: "Jansen BV" }),
      tx({ amount: 500, date: "2026-02-13", counterpartName: "Jansen BV" }),
    ],
    [
      inv({ id: "x", invoice_number: "JAN-1", total_inc_btw: 500, direction: "outgoing", client_name: "Jansen BV", invoice_date: "2026-02-01" }),
      inv({ id: "y", invoice_number: "JAN-2", total_inc_btw: 500, direction: "outgoing", client_name: "Jansen BV", invoice_date: "2026-02-02" }),
    ],
  );
  check("first tx is a choice (not forced auto)", r.matches[0].outcome === "choice");
  check("second tx is NOT 'none' (candidate wasn't stolen)", r.matches[1].outcome !== "none");
  check("both txns keep both candidates", r.matches[0].candidates.length === 2 && r.matches[1].candidates.length === 2);
}

console.log("\n— [BANK-AUTO-CONFIRM] the tier's own clauses, asked DIRECTLY —");
{
  // ── WHY THESE ARE BUILT BY HAND INSTEAD OF THROUGH matchTransactions() ──
  //
  // Every clause below is a SECOND guard on a fact the scorer already weighs, and the scorer wins
  // first. A "2e termijn" caps confidence at 0.6 in scorePair, so the pair leaves matchTransactions
  // as 'choice' and autoConfirmTier returns null on its very first line — before the clause under
  // test is ever reached. A case routed through the matcher therefore passes whether the clause
  // exists or not.
  //
  // That is not a hypothesis. Deleting the instalment veto from autoConfirmTier left this entire
  // suite green, including the case named "instalment reference → NOT safe" a few blocks below:
  // it asserts the right thing and proves the wrong guard. The same held for the name threshold
  // and for the date requirement — three clauses that decide whether money is booked with NO
  // human, none of them pinned.
  //
  // Keeping the second guard is right: autoConfirmTier is exported, and bank-rematch and
  // bank-auto-confirm reach it with matches they assembled themselves. It just has to be asked on
  // its own terms, which is what this block does.
  const cand = (p: Partial<MatchCandidate> = {}): MatchCandidate => ({
    invoiceId: "inv-1",
    invoiceNumber: "001-2026",
    amount: 1210,
    invoiceDate: "2026-02-01",
    confidence: 0.92,
    // No 'reference' and no 'iban': that is what makes this the amount_only tier rather than
    // 'certain', which is the tier whose clauses are under test here.
    signals: ["amount", "counterpart", "date"],
    reason: "",
    nameSim: 1,
    nameIdentity: true,
    ...p,
  });
  const asAuto = (t: BankTransaction, c: MatchCandidate): TransactionMatch => ({
    transaction: t, outcome: "auto", best: c, candidates: [c],
  });

  // The control. Without it every assertion below could pass because the pair is unbookable for
  // some reason that has nothing to do with the clause being tested.
  check("[BANK-AUTO-CONFIRM] the baseline pair DOES book at the flagged tier",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV" }), cand())) === "amount_only");

  // [BANK-PARTIAL] An instalment must never mark the whole invoice paid unattended. The word is in
  // the description only — the reference stays a clean single number, so the multi-invoice clause
  // above it cannot be what refuses this.
  check("[BANK-PARTIAL] 'deelbetaling' in the text refuses the tier outright",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV", description: "deelbetaling" }), cand())) === null);
  check("[BANK-PARTIAL] …and so does '2e termijn'",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV", description: "2e termijn" }), cand())) === null);
  check("[BANK-PARTIAL] …and 'aanbetaling'",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV", description: "aanbetaling project" }), cand())) === null);

  // [BANK-AMOUNT-ONLY] Booking on a NAME demands a strong one. 0.6 is the shared-token collision
  // the constant's own comment names — "De Vries Bouw" against "De Vries Transport" — and a
  // same-amount coincidence from such a look-alike must not mark an invoice paid with no human.
  check("[BANK-AMOUNT-ONLY] a merely-similar name (0.6) does not book",
    autoConfirmTier(asAuto(tx({ counterpartName: "De Vries Transport" }), cand({ nameSim: 0.6 }))) === null);
  check("[BANK-AMOUNT-ONLY] exactly at the 0.8 bar it does",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV" }), cand({ nameSim: 0.8 }))) === "amount_only");
  check("[BANK-AMOUNT-ONLY] a hair below the bar it does not",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV" }), cand({ nameSim: 0.79 }))) === null);

  // [BANK-AMOUNT-ONLY-DATE] The reported case, in one line: a €150 credit from an unrelated
  // "J. Jansen" arriving MONTHS after an open €150 invoice to "Jansen Consultancy" auto-marked it
  // paid, and the real debtor was never chased again. Name and amount alone booked unbounded into
  // the future; the date signal is the bound.
  check("[BANK-AMOUNT-ONLY-DATE] no date proximity → no unattended booking",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen BV" }), cand({ signals: ["amount", "counterpart"] }))) === null);

  // And the clause that is already pinned elsewhere, kept here so the four read as one rule.
  check("[BANK-AMOUNT-ONLY-TOKENS] a name that is not an identity does not book",
    autoConfirmTier(asAuto(tx({ counterpartName: "Jansen Holding" }), cand({ nameIdentity: false }))) === null);
}

console.log("\n— [BANK-AUTO-CONFIRM] only a near-certain single match is safe to auto-book —");
{
  const safe = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 1210 })],
  );
  check("reference + exact amount, single invoice → safe", isSafeAutoConfirm(safe.matches[0]) === true);

  // Amount + counterpart only (no invoice number in the statement) → NOT safe to auto-book.
  const amountOnly = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-12", counterpartName: "Jansen BV" })],
    [inv({ invoice_number: "X-9", total_inc_btw: 1210, client_name: "Jansen BV", invoice_date: "2026-02-01" })],
  );
  check("amount+counterpart only → NOT safe (no reference)", isSafeAutoConfirm(amountOnly.matches[0]) === false);

  // A multi-invoice batch (two reference numbers) → NOT safe (needs allocation).
  const multi = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026, 002-2026" })],
    [
      inv({ id: "a", invoice_number: "001-2026", total_inc_btw: 700 }),
      inv({ id: "b", invoice_number: "002-2026", total_inc_btw: 510 }),
    ],
  );
  check("multi-invoice batch → NOT safe", isSafeAutoConfirm(multi.matches[0]) === false);

  // Reference + amount BUT flagged an instalment → NOT safe (stays human).
  const instalment = matchTransactions(
    [tx({ amount: 1210, reference: "001-2026", description: "2e termijn factuur 001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 1210 })],
  );
  check("instalment reference → NOT safe", isSafeAutoConfirm(instalment.matches[0]) === false);

  // Reference without a matching amount (a €50 quote of a €500 invoice) → choice → NOT safe.
  const wrongAmount = matchTransactions(
    [tx({ amount: 50, reference: "001-2026" })],
    [inv({ invoice_number: "001-2026", total_inc_btw: 500 })],
  );
  check("reference but wrong amount → NOT safe", isSafeAutoConfirm(wrongAmount.matches[0]) === false);
}

console.log("\n— [BANK-REF-DECISIVE] a UNIQUE printed invoice number wins 'auto' amid same-amount siblings —");
{
  // The ONS IT case: a €32,67 monthly subscription debit whose statement prints
  // "Incasso fact. 1260405". Five monthly invoices all €32,67 from the same supplier are
  // in the system; four have no number printed (amount+counterpart+date only). Before the
  // fix these four scored close enough to pull the reference match's margin below autoMargin
  // → a 5-way 'choice'. Now the one with its number printed wins decisively.
  const onsIt = matchTransactions(
    [tx({ amount: -32.67, date: "2026-06-03", counterpartName: "ONS IT", description: "Incassobatch 409 Incasso fact. 1260405" })],
    [
      inv({ id: "a", invoice_number: "1260405", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-06-01" }),
      inv({ id: "b", invoice_number: "1260341", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-05-04" }),
      inv({ id: "c", invoice_number: "1260089", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-02-02" }),
      inv({ id: "d", invoice_number: "1260274", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-04-02" }),
      inv({ id: "e", invoice_number: "1260009", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-01-05" }),
    ],
  );
  check("printed-number invoice becomes 'auto' (not a 5-way choice)", onsIt.matches[0].outcome === "auto");
  check("the auto pick is the printed number 1260405", onsIt.matches[0].best?.invoiceId === "a");
  check("and it is SAFE to auto-book (reference + amount, single)", isSafeAutoConfirm(onsIt.matches[0]) === true);

  // Guard: if TWO candidates both have their number printed (an ambiguous/mis-parsed case),
  // neither is decisive → it must stay a human 'choice', never a wrong auto-book.
  const twoPrinted = matchTransactions(
    [tx({ amount: -32.67, counterpartName: "ONS IT", description: "fact 1260405 1260341" })],
    [
      inv({ id: "a", invoice_number: "1260405", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-06-01" }),
      inv({ id: "b", invoice_number: "1260341", total_inc_btw: 32.67, direction: "incoming", client_name: "ONS IT", invoice_date: "2026-05-04" }),
    ],
  );
  check("two printed numbers → stays a human choice (not auto)", twoPrinted.matches[0].outcome !== "auto");
}

console.log("\n— [BANK-AMOUNT-ONLY] autoConfirmTier: certain vs amount_only vs human —");
{
  // reference + amount → 'certain'
  const ref = matchTransactions([tx({ amount: 1210, reference: "001-2026" })], [inv({ invoice_number: "001-2026", total_inc_btw: 1210 })]);
  check("reference + amount → 'certain'", autoConfirmTier(ref.matches[0]) === "certain");

  // iban + amount → 'certain'
  const iban = matchTransactions(
    [tx({ amount: 1210, counterpartIban: "NL91ABNA0417164300" })],
    [inv({ invoice_number: "X-1", total_inc_btw: 1210, vendor_iban: "NL91ABNA0417164300", client_name: "Zzz Unrelated" })],
  );
  check("iban + amount → 'certain'", autoConfirmTier(iban.matches[0]) === "certain");

  // amount + counterpart NAME, no reference/iban → 'amount_only' (the KPN/Metro case)
  const amtName = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-10", counterpartName: "Jansen BV" })],
    [inv({ invoice_number: "X-9", total_inc_btw: 1210, client_name: "Jansen BV", invoice_date: "2026-02-01" })],
  );
  check("amount + counterpart (no number/iban) → 'amount_only'", autoConfirmTier(amtName.matches[0]) === "amount_only");
  check("...and isSafeAutoConfirm stays FALSE for amount_only (certain-only)", isSafeAutoConfirm(amtName.matches[0]) === false);

  // amount + date only, NO counterpart name → too weak → null (stays human)
  const amtDate = matchTransactions(
    [tx({ amount: 1210, date: "2026-02-05", counterpartName: null })],
    [inv({ invoice_number: "X-7", total_inc_btw: 1210, client_name: "Totally Different Co", invoice_date: "2026-02-01" })],
  );
  check("amount + date only (no name/number/iban) → null (human)", autoConfirmTier(amtDate.matches[0]) === null);

  // an ambiguous same-amount/same-supplier pair is a 'choice', never a tier
  const tie = matchTransactions(
    [tx({ amount: 500, date: "2026-02-12", counterpartName: "Jansen BV" })],
    [
      inv({ id: "x", invoice_number: "JAN-1", total_inc_btw: 500, client_name: "Jansen BV", invoice_date: "2026-02-01" }),
      inv({ id: "y", invoice_number: "JAN-2", total_inc_btw: 500, client_name: "Jansen BV", invoice_date: "2026-02-02" }),
    ],
  );
  check("same-amount same-supplier tie → 'choice' → no tier", autoConfirmTier(tie.matches[0]) === null);
}

console.log("\n— [BANK-AMOUNT-ONLY] a WEAK (look-alike) name must NOT auto-book on amount alone —");
{
  // A shared-token collision: "De Vries Bouw" pays €640, but the only same-amount open invoice is
  // from "De Vries Transport" (a DIFFERENT supplier). nameSimilarity ~0.6 (shared "de vries") clears
  // the 0.5 LIST bar and, with a close date, the pair reaches outcome 'auto' with a single winner —
  // yet marking THIS invoice paid would be a wrong-invoice link. It must stay a human one-tap.
  const weak = matchTransactions(
    [tx({ amount: 640, date: "2026-03-10", counterpartName: "De Vries Bouw", reference: null })],
    [inv({ invoice_number: "DV-9", total_inc_btw: 640, client_name: "De Vries Transport", invoice_date: "2026-03-06" })],
  );
  const sim = nameSimilarity("De Vries Bouw", "De Vries Transport");
  check("look-alike name sim is in the weak band [0.5, 0.8)", sim >= 0.5 && sim < 0.8);
  check("the pair still reaches outcome 'auto' (single winner)", weak.matches[0].outcome === "auto");
  check("but a WEAK name is NOT auto-booked (stays human) → tier null", autoConfirmTier(weak.matches[0]) === null);

  // A STRONG name (same supplier, sim ≥ 0.8) still auto-books 'amount_only' — no false block.
  const strong = matchTransactions(
    [tx({ amount: 640, date: "2026-03-10", counterpartName: "De Vries Bouw", reference: null })],
    [inv({ invoice_number: "DV-1", total_inc_btw: 640, client_name: "De Vries Bouw", invoice_date: "2026-03-06" })],
  );
  check("strong name (same supplier) still auto-books amount_only", autoConfirmTier(strong.matches[0]) === "amount_only");

  // [BANK-AMOUNT-ONLY-DATE] name+amount WITHOUT date proximity must NOT auto-book: an unrelated
  // same-surname credit arriving MONTHS after the invoice was the wrong-paid trap. Outside the
  // 45-day window → tier null (stays a human one-tap).
  const farDate = matchTransactions(
    [tx({ amount: 150, date: "2026-08-20", counterpartName: "J. Jansen", reference: null })],
    [inv({ invoice_number: "JC-7", total_inc_btw: 150, client_name: "Jansen Consultancy", invoice_date: "2026-02-01", due_date: "2026-02-15" })],
  );
  check("amount+name but months-late (no date proximity) → tier null (human)",
    autoConfirmTier(farDate.matches[0]) === null);
  // 'certain' (printed reference) is document identity — date distance never blocks it.
  const farRef = matchTransactions(
    [tx({ amount: 150, date: "2026-08-20", reference: "JC-1007" })],
    [inv({ invoice_number: "JC-1007", total_inc_btw: 150, client_name: "Jansen Consultancy", invoice_date: "2026-02-01" })],
  );
  check("printed reference months later still 'certain' (late payments are real)",
    autoConfirmTier(farRef.matches[0]) === "certain");
}

console.log("\n— [TRUST-MATCH-YEAR] a bare-year invoice number never reference-matches —");
{
  // Sequential numbering can reach literally "2026"; the year in ANY description ("Huur juli
  // 2026") is a whole-token hit → with a coincidental cent-exact amount that booked SILENTLY as
  // 'certain'. A bare year is not identity → no reference match (amount/name/date still list it).
  const year = matchTransactions(
    [tx({ amount: 850, date: "2026-07-01", description: "Huur juli 2026", counterpartName: "Vastgoed X" })],
    [inv({ invoice_number: "2026", total_inc_btw: 850, client_name: "Andere Leverancier", invoice_date: "2026-06-25" })],
  );
  check("needle '2026' in 'Huur juli 2026' → NOT a reference match (no silent certain)",
    autoConfirmTier(year.matches[0]) !== "certain");
  // A real number that merely CONTAINS a year ("2026014") still matches its printed form.
  const containsYear = matchTransactions(
    [tx({ amount: 850, reference: "factuur 2026014" })],
    [inv({ invoice_number: "2026-014", total_inc_btw: 850 })],
  );
  check("a number containing a year ('2026-014') still reference-matches", autoConfirmTier(containsYear.matches[0]) === "certain");
}

console.log("\n— [BANK-COVERAGE-BY-MONEY] a fully-applied line is finished, whatever the reference says —");
{
  // The reported loop: a bank line whose every euro is booked, but whose reference carries a
  // token that is not a paid invoice number (a customer number, a POS batch counter, or the free
  // text the extractor falls back to). The token rule can never call it covered, so the line
  // stayed in "Te bevestigen" and every confirm attempt returned 409 → the client refreshed →
  // the card came straight back. Only the money can answer "is this payment spent?".
  const noise = "884512, 1123";                       // two number-shaped tokens, neither an invoice
  const paidNumbers = new Set(["cm500212813"]);       // the invoice this line actually paid
  check("the token rule alone can NEVER call it covered (the bug)",
    isFullyCovered(noise, paidNumbers) === false);
  check("the money rule sees a fully-applied line as finished",
    bankLineFullyApplied(1123.14, 1123.14) === true);
  check("a credit (positive) and a debit (negative) of the same size answer alike",
    bankLineFullyApplied(-1123.14, 1123.14) === bankLineFullyApplied(1123.14, 1123.14));

  // Money genuinely left over must STILL keep the line open — the fix must not hide unassigned money.
  check("money left unassigned → not covered", bankLineFullyApplied(1000, 600) === false);
  check("a cent of float dust still counts as covered", bankLineFullyApplied(1000, 999.995) === true);
  check("one euro short is NOT covered", bankLineFullyApplied(1000, 999) === false);
  check("over-applied (clamped elsewhere) reads as covered", bankLineFullyApplied(1000, 1000.5) === true);

  // Not measurable → null, so the caller falls back to the conservative token rule rather than
  // guessing "covered" from a sum that is only a lower bound.
  check("no measurable applied total → null (caller falls back)", bankLineFullyApplied(1000, null) === null);
  check("an undefined applied total → null", bankLineFullyApplied(1000, undefined) === null);
  check("a non-finite applied total → null", bankLineFullyApplied(1000, Number.NaN) === null);
  check("a non-finite line amount → null", bankLineFullyApplied(Number.POSITIVE_INFINITY, 10) === null);

  // The two routes must now give the SAME answer for the same line — that identity IS the fix.
  const line = { amount: -2265.41, applied: 2265.41, reference: "26302050, klantnr 884512" };
  const matchRouteSays = bankLineFullyApplied(line.amount, line.applied);
  const confirmRouteSays = bankLineFullyApplied(Math.abs(line.amount), line.applied);
  check("match and confirm now agree on a fully-applied line",
    matchRouteSays === true && confirmRouteSays === true);
  check("…where the old reference rule would have disagreed",
    isFullyCovered(line.reference, new Set(["26302050"])) === false);
}

console.log("\n— [BANK-IDENTITY-OUTRANKS] a printed invoice number beats a same-amount coincidence —");
{
  const supplier = "ATAPACK Cash & Carry B.V.";
  const invoice = inv({
    id: "the-invoice", invoice_number: "26302050", total_inc_btw: 242,
    invoice_date: "2026-06-18", due_date: "2026-07-18",
    client_name: supplier, direction: "incoming",
  });
  const quotes = tx({ amount: -242, date: "2026-06-20", reference: "factuur 26302050", counterpartName: supplier });
  const coincidence = tx({ amount: -242, date: "2026-06-20", reference: null, counterpartName: supplier });

  // The raw scores: identity must now OUTRANK the identity-less pair.
  const sQuotes = scorePair(quotes, invoice, DEFAULT_OPTIONS);
  const sCoin = scorePair(coincidence, invoice, DEFAULT_OPTIONS);
  check("reference+amount still scores 0.97", Math.abs(sQuotes.confidence - 0.97) < 1e-9);
  check("amount+name+date is capped strictly below it", sCoin.confidence < sQuotes.confidence);

  // The reproduced end-to-end bug: two payments, one invoice. Before the cap, the coincidence
  // claimed the invoice (1.0 > 0.97) and auto-booked it via amount_only, while the payment that
  // QUOTED the number fell to "Geen factuur".
  const r = matchTransactions([quotes, coincidence], [invoice]);
  const mQuotes = r.matches.find((m) => m.transaction === quotes)!;
  const mCoin = r.matches.find((m) => m.transaction === coincidence)!;
  check("the payment quoting the number claims the invoice", mQuotes.outcome === "auto" && mQuotes.best?.invoiceId === "the-invoice");
  check("…and books as 'certain'", autoConfirmTier(mQuotes) === "certain");
  check("the coincidence does NOT claim it", mCoin.best?.invoiceId !== "the-invoice" || mCoin.outcome !== "auto");
  check("…and is never auto-booked against it", autoConfirmTier(mCoin) === null);

  // Candidate ORDER inside one transaction: the reference-matched invoice must sort first.
  const refInv = inv({ id: "ref-inv", invoice_number: "26302050", total_inc_btw: 242, invoice_date: "2026-05-01", due_date: "2026-06-01", client_name: "Iemand Anders", direction: "incoming", status: "received" });
  const coinInv = inv({ id: "coin-inv", invoice_number: "99999999", total_inc_btw: 242, invoice_date: "2026-06-18", due_date: "2026-07-18", client_name: supplier, direction: "incoming", status: "received" });
  const one = matchTransactions([quotes], [refInv, coinInv]).matches[0];
  check("within one tx, the reference match is the top candidate", one.candidates[0]?.invoiceId === "ref-inv");

  // IBAN is identity, same tier as a printed number — deliberately NOT capped.
  const ibanInv = inv({ id: "iban-inv", invoice_number: "77777777", total_inc_btw: 242, invoice_date: "2026-06-18", due_date: "2026-07-18", client_name: supplier, vendor_iban: "NL91ABNA0417164300", direction: "incoming", status: "received" });
  const ibanTx = tx({ amount: -242, date: "2026-06-20", reference: null, counterpartName: supplier, counterpartIban: "NL91ABNA0417164300" });
  const sIban = scorePair(ibanTx, ibanInv, DEFAULT_OPTIONS);
  check("iban+amount is exempt from the cap (it IS identity)", sIban.confidence > 0.95);
  check("…and still books as 'certain'", autoConfirmTier(matchTransactions([ibanTx], [ibanInv]).matches[0]) === "certain");

  // CONTROL: with no identity competitor, the capped coincidence still reaches 'auto' — the cap
  // changes who WINS, never whether a lone strong match is bookable.
  const alone = matchTransactions([coincidence], [invoice]).matches[0];
  check("CONTROL: a lone amount+name+date match still reaches 'auto'", alone.outcome === "auto");
  check("CONTROL: …and still books via amount_only", autoConfirmTier(alone) === "amount_only");
}

console.log("\n— [BANK-NAME-PARTICLES] a tussenvoegsel is not identity —");
{
  check("'J. de Vries' is NOT the same party as 'De Vries Transport'",
    !isStrongNameIdentity("J. de Vries", "De Vries Transport"));
  check("'van Dijk' alone is NOT 'Van Dijk Bouw B.V.'",
    !isStrongNameIdentity("van Dijk", "Van Dijk Bouw B.V."));
  check("the honest multi-word supplier still passes ('Van den Berg Installaties')",
    isStrongNameIdentity("Van den Berg Installaties", "van den Berg Installaties B.V."));
  check("the single-word supplier still passes (KPN)", isStrongNameIdentity("KPN", "KPN B.V."));
  check("two same-surname sole traders still pass ('De Vries Bouw' = 'de Vries Bouw')",
    isStrongNameIdentity("De Vries Bouw", "de Vries Bouw"));
  check("names that are ONLY particles identify nothing", !isStrongNameIdentity("van de", "van de"));
  // The reproduced money shape: unrelated private person, exact amount, near date → must stay human.
  const marktplaats = matchTransactions(
    [tx({ amount: 150, date: "2026-07-06", counterpartName: "J. de Vries" })],
    [inv({ id: "tv", total_inc_btw: 150, invoice_date: "2026-07-01", due_date: "2026-07-15", client_name: "De Vries Transport", direction: "outgoing", status: "sent" })],
  ).matches[0];
  check("…so a Marktplaats coincidence never auto-books a transport invoice",
    autoConfirmTier(marktplaats) === null);
}

console.log("\n— [BANK-IDENTITY-OUTRANKS] the three-rank hierarchy: number > IBAN > coincidence —");
{
  const supplier = "ATAPACK Cash & Carry B.V.";
  const target = inv({ id: "the-bill", invoice_number: "26302050", total_inc_btw: 242, invoice_date: "2026-06-18", due_date: "2026-07-18", client_name: supplier, vendor_iban: "NL91ABNA0417164300", direction: "incoming", status: "received" });
  const quotesNumber = tx({ transactionId: "t-num", amount: -242, date: "2026-06-20", reference: "factuur 26302050" });
  const sameIban = tx({ transactionId: "t-iban", amount: -242, date: "2026-06-20", counterpartIban: "NL91ABNA0417164300", counterpartName: supplier });
  const r = matchTransactions([sameIban, quotesNumber], [target]);
  const mNum = r.matches.find((m) => m.transaction.transactionId === "t-num")!;
  const mIban = r.matches.find((m) => m.transaction.transactionId === "t-iban")!;
  check("the payment printing the NUMBER wins the invoice from the IBAN twin",
    mNum.outcome === "auto" && mNum.best?.invoiceId === "the-bill");
  check("…and the IBAN twin does not book it", autoConfirmTier(mIban) === null);
  check("alone, the IBAN payment still books 'certain' (supplier identity intact)",
    autoConfirmTier(matchTransactions([sameIban], [target]).matches[0]) === "certain");
}

console.log("\n— [BANK-PARTIAL-WORDS] voorschot + gedeeltelijke are instalment markers —");
{
  check("'gedeeltelijke betaling' is detected", isPartialPaymentHint("Gedeeltelijke betaling factuur 123"));
  check("'voorschot' is detected", isPartialPaymentHint("Voorschot project keuken"));
  check("an ordinary description still is not", !isPartialPaymentHint("Betaling factuur 26302050 met dank"));
}

console.log("\n— [BANK-DEDUP-SUPPLIER] same number+amount from DIFFERENT suppliers is not a duplicate —");
{
  const cand = (invoiceId: string, clientName: string): MatchCandidate =>
    ({ invoiceId, invoiceNumber: "2026-07", amount: 121, invoiceDate: "2026-07-01", confidence: 0.8, signals: ["amount"], reason: "", clientName });
  const twoSuppliers = dedupeCandidates([cand("a", "KPN B.V."), cand("b", "Ziggo B.V.")]);
  check("cross-supplier collision keeps BOTH invoices", twoSuppliers.length === 2);
  const reimport = dedupeCandidates([cand("a", "KPN B.V."), cand("a2", "KPN B.V.")]);
  check("a genuine re-import (same supplier) still collapses", reimport.length === 1);
}

console.log("\n— [BANK-REF-CONTRADICTS] the statement names a document — no auto against it —");
{
  // A reference-matched (but partial-capped) invoice in the list blocks a coincidence top.
  const partial = inv({ id: "partial", invoice_number: "26302050", total_inc_btw: 1000, amount_paid: 400, invoice_date: "2026-06-01", due_date: "2026-07-01", client_name: "Groothandel X", direction: "incoming", status: "received" });
  const other = inv({ id: "other", invoice_number: "88880000", total_inc_btw: 600, invoice_date: "2026-06-18", due_date: "2026-07-18", client_name: "Andere Leverancier", direction: "incoming", status: "received" });
  const pay = tx({ amount: -600, date: "2026-06-20", reference: "factuur 26302050", counterpartName: "Andere Leverancier" });
  const m = matchTransactions([pay], [partial, other]).matches[0];
  check("a coincidence top cannot go 'auto' past a reference-matched candidate", m.outcome === "choice");
  // amount_only refuses a contradicting printed number outright.
  const notImported = tx({ amount: -242, date: "2026-06-20", reference: "factuur 20260812", counterpartName: "ATAPACK Cash & Carry B.V." });
  const older = inv({ id: "older", invoice_number: "26302050", total_inc_btw: 242, invoice_date: "2026-06-18", due_date: "2026-07-18", client_name: "ATAPACK Cash & Carry B.V.", direction: "incoming", status: "received" });
  const m2 = matchTransactions([notImported], [older]).matches[0];
  check("a payment quoting a NOT-imported number never books a different bill",
    autoConfirmTier(m2) === null);
}

console.log("\n— [BANK-ELIMINATION-NO-PROMOTE] a manufactured single winner stays human —");
{
  const landlord = "Vastgoed Beheer B.V.";
  const june = inv({ id: "june", invoice_number: "H-2026-06", total_inc_btw: 800, invoice_date: "2026-06-01", due_date: "2026-06-15", client_name: landlord, direction: "incoming", status: "received" });
  const july = inv({ id: "july", invoice_number: "H-2026-07", total_inc_btw: 800, invoice_date: "2026-07-01", due_date: "2026-07-15", client_name: landlord, direction: "incoming", status: "received" });
  const standing = tx({ transactionId: "t-standing", amount: -800, date: "2026-07-02", reference: "H-2026-07" });
  const duplicate = tx({ transactionId: "t-dup", amount: -800, date: "2026-07-03", counterpartName: landlord });
  const r = matchTransactions([standing, duplicate], [june, july]);
  const mDup = r.matches.find((m) => m.transaction.transactionId === "t-dup")!;
  check("the quoting payment claims July",
    r.matches.find((m) => m.transaction.transactionId === "t-standing")?.best?.invoiceId === "july");
  check("the duplicate does NOT silently become 'auto' on leftover June",
    !(mDup.outcome === "auto" && autoConfirmTier(mDup) !== null));
  check("…June stays reachable as a human choice", mDup.candidates.some((c) => c.invoiceId === "june"));
}

console.log("\n— [BANK-SLOT-RECOVERED] covered numbers answered in the PAID invoices' own numbers —");
{
  // Recovered bundle: extractor stored "045, 046"; the paid invoice is "2026-045" → "2026045".
  const covered = coveredNumbersRecovered("2026-045, 2026-046", new Set(["2026045"]));
  check("a paid recovered-bundle member is reported by its REAL number",
    covered.length === 1 && covered[0] === "2026045");
  check("exact tokens still work unchanged",
    coveredNumbersRecovered("26302050, 26302362", new Set(["26302050"]))[0] === "26302050");
  check("nothing paid → nothing covered", coveredNumbersRecovered("2026-045", new Set()).length === 0);
}

console.log("\n— [BANK-CENTS-EXACT] the one-cent tolerance is deterministic, not a float lottery —");
{
  // These two pairs are the SAME one-cent difference; raw float subtraction lands one a hair
  // above 0.01 and the other a hair below. Both must match now.
  check("242.00 vs 241.99 matches (used to lose the float lottery)", amountMatches(-242, 241.99, 0.01));
  check("100.00 vs 99.99 matches (always did)", amountMatches(-100, 99.99, 0.01));
  check("two cents off is still NOT a match", !amountMatches(-242, 241.98, 0.01));
  check("exact stays exact", amountMatches(-242, 242, 0.01));
  check("a wider epsilon still means what it says (0.02 → 2 cents)", amountMatches(-242, 241.98, 0.02));
}

console.log("\n— [CREDIT-NETTING] a creditnota deducted from a payment run, not refunded —");
{
  // The real line. Dutch Sweets billed RE0801378 at € 871,40, issued three credit notes, and one
  // debit of € 819,95 left the account with all four numbers in its omschrijving:
  //   871,40 − 24,25 − 20,39 − 6,81 = 819,95, to the cent.
  // Before this rule the direction guard rejected every credit note against a debit, so ONE slot
  // was built, reconcileBatch had nothing to net, and the card offered a deelbetaling of € 819,95
  // with "€ 51,45 blijft open" — € 51,45 being exactly the three credit notes it had refused.
  const desc = "RE0801378 , CR0300510 , CR0300781 , CR0300797";
  const tx: BankTransaction = {
    date: "2026-06-17", amount: -819.95, currency: "EUR", description: desc,
    counterpartName: "Dutch Sweets Company B.V.", counterpartIban: "NL65RABO0171136276",
    reference: null, transactionId: "t-sweets", rawLine: "",
  };
  const doc = (n: string, total: number, d: string): InvoiceForMatching => ({
    id: n, invoice_number: n, total_inc_btw: total, amount_paid: 0, invoice_date: d, due_date: d,
    client_name: "Dutch Sweets Company B.V.", direction: "incoming", status: "received",
    accountant_status: null, vendor_iban: "NL65RABO0171136276",
  });
  const boeken = [
    doc("RE0801378", 871.4, "2026-03-12"), doc("CR0300510", -24.25, "2026-03-12"),
    doc("CR0300781", -20.39, "2026-04-23"), doc("CR0300797", -6.81, "2026-04-24"),
  ];
  const got = matchTransactions([tx], boeken).matches[0];
  const numbers = got.candidates.map((c) => c.invoiceNumber).sort();
  check("all four documents are candidates for the one debit",
    numbers.join(",") === "CR0300510,CR0300781,CR0300797,RE0801378");
  // The whole point: their SIGNED sum is the payment. If a future change silently drops one, this
  // is the assertion that notices — a count alone would not.
  const som = got.candidates.reduce((t, c) => t + (c.amount ?? 0), 0);
  check("and their signed sum is the bank amount to the cent", Math.abs(som - 819.95) < 0.005);

  // The bank must have VOUCHED for it. An identical credit note the payment does not name stays
  // out — otherwise a credit note would drift onto any debit from that supplier.
  const ongenoemd = matchTransactions(
    [{ ...tx, description: "RE0801378", transactionId: "t-quiet" }],
    boeken,
  ).matches[0];
  check("a creditnota the payment does not name is NOT a candidate",
    ongenoemd.candidates.every((c) => (c.amount ?? 0) > 0));

  // A netted creditnota is one PART of a settlement, so it must never be booked unattended —
  // however well it scores. Its own amount quoted and matched exactly is the strongest case there
  // is, and it still has to stay a human choice.
  const alleen = matchTransactions(
    [{ ...tx, amount: -24.25, description: "CR0300510", transactionId: "t-solo" }],
    [boeken[1]],
  ).matches[0];
  check("a netted creditnota never reaches 'auto' on its own",
    alleen.outcome !== "auto" && alleen.candidates.length === 1);

  // And the REFUND path is untouched: money actually coming back for a credit note still matches,
  // and still auto-books. That is the case the original guard was written for.
  const terugbetaling = matchTransactions(
    [{ ...tx, amount: 24.25, description: "Creditnota CR0300510", transactionId: "t-refund" }],
    [boeken[1]],
  ).matches[0];
  check("a genuine refund of a creditnota still matches", terugbetaling.candidates.length === 1);
  check("and is still allowed to auto-book", terugbetaling.outcome === "auto");
}

console.log("\n— [CREDIT-NETTING] the predicate names the shape, nothing more —");
{
  const debet = { amount: -100 };
  const credit = { amount: 100 };
  const inkoopCredit = { total_inc_btw: -25, direction: "incoming" as const };
  const inkoopFactuur = { total_inc_btw: 250, direction: "incoming" as const };
  const verkoopCredit = { total_inc_btw: -25, direction: "outgoing" as const };

  check("purchase creditnota on a debit → netted", isNettedCreditNote(debet, inkoopCredit));
  check("purchase creditnota on a credit → a refund, not netted", !isNettedCreditNote(credit, inkoopCredit));
  check("sales creditnota on a credit → netted", isNettedCreditNote(credit, verkoopCredit));
  check("sales creditnota on a debit → a refund, not netted", !isNettedCreditNote(debet, verkoopCredit));
  // An ordinary invoice is never "netted" whichever way the money went — the rule must not become
  // a second, looser direction guard for normal bills.
  check("an ordinary invoice is never netted, on a debit", !isNettedCreditNote(debet, inkoopFactuur));
  check("an ordinary invoice is never netted, on a credit", !isNettedCreditNote(credit, inkoopFactuur));
  check("a zero total is not a creditnota", !isNettedCreditNote(debet, { total_inc_btw: 0, direction: "incoming" }));
  check("a null total is not a creditnota", !isNettedCreditNote(debet, { total_inc_btw: null, direction: "incoming" }));
}

console.log("\n— [PAY-REFERENCE] the betalingskenmerk the invoice asked for is an identity too —");
{
  // Coroama Stefan Daniel, FAC/2026/00296, € 40,00. The paper says "Communication de paiement:
  // +++000/0000/60321+++" — a Belgian gestructureerde mededeling — so the bank line carries that,
  // never the invoice number. The matcher only ever tried the number, so the reference signal could
  // not fire on this invoice in principle, and it sat under an amber "Mogelijke betaling" while
  // being one of the most identifiable payments in the book.
  const inv: InvoiceForMatching = {
    id: "be-1", invoice_number: "FAC/2026/00296", payment_reference: "+++000/0000/60321+++",
    total_inc_btw: 40, amount_paid: 0, invoice_date: "2026-07-30", due_date: "2026-08-01",
    client_name: "Coroama Stefan Daniel", direction: "incoming", status: "received",
    accountant_status: null, vendor_iban: "BE57 3631 5240 5935",
  };
  const tx: BankTransaction = {
    date: "2026-08-01", amount: -40, currency: "EUR",
    description: "Overschrijving", counterpartName: "Coroama Stefan Daniel",
    counterpartIban: null, reference: "000/0000/60321", transactionId: "be-tx", rawLine: "",
  };
  const m = matchTransactions([tx], [inv]).matches[0];
  check("the structured communication is recognised as a reference",
    m.candidates[0]?.signals.includes("reference") === true);
  check("and the printed form (+++…+++) matches the bank's plain form",
    referenceMatches({ reference: "000/0000/60321", description: "" }, "+++000/0000/60321+++"));

  // The other direction must be untouched: an invoice with no separate kenmerk still matches on its
  // number, and an unrelated reference still does not match at all.
  const gewoon: InvoiceForMatching = { ...inv, invoice_number: "2033161", payment_reference: null };
  const gewoonTx: BankTransaction = { ...tx, reference: "2033161" };
  check("an invoice without a kenmerk still matches on its number",
    matchTransactions([gewoonTx], [gewoon]).matches[0].candidates[0]?.signals.includes("reference") === true);

  const vreemd = matchTransactions([{ ...tx, reference: "999/9999/99999" }], [inv]).matches[0];
  check("an unrelated reference is still no reference match",
    (vreemd.candidates[0]?.signals ?? []).includes("reference") === false);

  // And every guard referenceMatches carries still applies to the new needle — a bare year must
  // never become an identity just because it arrived through payment_reference.
  check("a bare year in the kenmerk is refused, exactly as in the number",
    !referenceMatches({ reference: "Huur juli 2026", description: "" }, "2026"));
  check("a too-short kenmerk is refused", !referenceMatches({ reference: "12 ", description: "" }, "12"));
}

// ─── [BIJNA-BEDRAG] A payment that is close, on a counterparty we can identify ──────────────────
//
// Measured before this existed: a €100 invoice from a strongly identified counterparty, paid
// €99,50 because the bank took its costs off, produced `outcome: none, candidates: 0`. The owner
// saw "Geen factuur" over a line whose invoice was sitting right there. Same for a 2%
// betalingskorting and for a customer who rounded up. 0.35 is below the 0.5 listing floor, so an
// identified pair without an exact amount was not weak — it was invisible.

{
  const nearInv = {
    id: "n1", invoice_number: "2026-0044", total_inc_btw: 100, amount_paid: 0,
    client_name: "Jansen Bouw B.V.", direction: "outgoing" as const, status: "sent",
    invoice_date: "2026-07-01", due_date: "2026-07-31", accountant_status: null,
  };
  const nearTx = (over: Record<string, unknown> = {}) => ({
    date: "2026-07-20", amount: 100, description: "SEPA Overboeking Jansen Bouw B.V.",
    reference: null, counterpartName: "Jansen Bouw B.V.", counterpartIban: "NL91ABNA0417164300",
    transactionId: "t1", ...over,
  });
  const outcomeOf = (amount: number, inv = nearInv) =>
    matchTransactions([nearTx({ amount })] as never, [inv] as never).matches[0];

  check("[BIJNA-BEDRAG] 50 cents of bank costs is listed, not hidden", (() => {
    const m = outcomeOf(99.5);
    return m.outcome === "choice" && m.candidates.length === 1
      && (m.candidates[0].signals ?? []).includes("near_amount");
  })());
  check("[BIJNA-BEDRAG] …and the reason names the difference in euros", (() => {
    const m = outcomeOf(99.5);
    return /€0\.50 minder/.test(m.candidates[0].reason ?? "");
  })());
  check("[BIJNA-BEDRAG] a 2% betalingskorting is listed", outcomeOf(98).outcome === "choice");
  check("[BIJNA-BEDRAG] and a customer who rounded UP", (() => {
    const m = outcomeOf(100.05);
    return m.outcome === "choice" && /€0\.05 meer/.test(m.candidates[0].reason ?? "");
  })());

  // The bar that makes it safe: close is never certain. A difference is what a human must look at,
  // and confirming one books a deelbetaling with the remainder stated (/api/bank/confirm).
  check("[BIJNA-BEDRAG] a near amount is NEVER auto-booked", (() => {
    for (const amt of [99.5, 98, 100.05]) {
      if (matchTransactions([nearTx({ amount: amt })] as never, [nearInv] as never).matches[0].outcome === "auto") return false;
    }
    return matchTransactions([nearTx({ amount: 100 })] as never, [nearInv] as never).matches[0].outcome === "auto";
  })());
  check("[BIJNA-BEDRAG] one cent is still an EXACT match, by policy and not by accident", (() => {
    // amountEpsilon is 0.01 — [BANK-CENTS-EXACT] says why: an OCR'd or xlsx-imported total is
    // legitimately a rounding tick off. So €99,99 books as before; this feature begins where that
    // tolerance ends, and the two must not be confused for one another.
    const m = matchTransactions([nearTx({ amount: 99.99 })] as never, [nearInv] as never).matches[0];
    return m.outcome === "auto" && (m.best?.signals ?? []).includes("amount")
      && !(m.best?.signals ?? []).includes("near_amount");
  })());

  // Bounded on both sides: 2% of the balance, never more than €25, never less than 5 cents.
  check("[BIJNA-BEDRAG] a 20% difference is another invoice, not this one", outcomeOf(80).outcome === "none");
  check("[BIJNA-BEDRAG] the absolute cap holds on a big invoice", (() => {
    const big = { ...nearInv, total_inc_btw: 10000 }; // 2% would be €200; the cap is €25
    return matchTransactions([nearTx({ amount: 9950 })] as never, [big] as never).matches[0].outcome === "none";
  })());

  // Identity is required, and a resemblance is not identity. This is the coincidence the whole
  // file guards against: a nearby amount plus a name that looks a bit like another one.
  check("[BIJNA-BEDRAG] a mere name resemblance does not open the door", (() => {
    const other = { ...nearInv, client_name: "Jansen Holding" }; // shares one meaningful token
    return matchTransactions([nearTx({ amount: 99.5 })] as never, [other] as never).matches[0].outcome === "none";
  })());
  check("[BIJNA-BEDRAG] …while the invoice's own IBAN is", (() => {
    const viaIban = { ...nearInv, client_name: "ONLEESBAAR", vendor_iban: "NL91ABNA0417164300" };
    const m = matchTransactions([nearTx({ amount: 99.5, counterpartName: "ONBEKEND" })] as never, [viaIban] as never).matches[0];
    return m.outcome === "choice" && (m.candidates[0].signals ?? []).includes("near_amount");
  })());
}

// ─── [GESTRUCTUREERD] The reference a bank routes on ───────────────────────────────────────────

{
  const rfInv = {
    id: "r1", invoice_number: "2026-0044", payment_reference: "RF18539007547034",
    total_inc_btw: 77, amount_paid: 0, client_name: "Groothandel", direction: "outgoing" as const,
    status: "sent", invoice_date: "2026-07-01", due_date: "2026-07-31", accountant_status: null,
  };
  const rfTx = (description: string) => ({
    date: "2026-07-20", amount: 77, description, reference: null,
    counterpartName: "Groothandel", counterpartIban: null, transactionId: "t9",
  });

  check("[GESTRUCTUREERD] an RF reference printed in groups is recognised", (() => {
    // The way every bank prints it — and the way the space-preserving scan could not see it.
    const m = matchTransactions([rfTx("Betaling RF18 5390 0754 7034")] as never, [rfInv] as never).matches[0];
    return m.outcome === "auto" && (m.best?.signals ?? []).includes("reference");
  })());
  check("[GESTRUCTUREERD] a different valid RF reference does not match", (() => {
    const m = matchTransactions([rfTx("Betaling RF71 2348 231")] as never, [rfInv] as never).matches[0];
    return !(m.best?.signals ?? []).includes("reference");
  })());
  check("[GESTRUCTUREERD] one wrong character and it is not this invoice", (() => {
    const m = matchTransactions([rfTx("Betaling RF18 5390 0754 7035")] as never, [rfInv] as never).matches[0];
    return !(m.best?.signals ?? []).includes("reference");
  })());
}

// ─── [GEHEUGEN] The owner's own confirmations, read back ───────────────────────────────────────
//
// Every other signal is inference about a line the app is seeing for the first time. This one is
// the owner's answer, given by confirming — written to bank_tx_invoices and, until now, never read
// again. The supplier below is the case it exists for: the bank writes "SUMUP *JANSEN" and the
// invoice says "Jansen Bouw B.V.", which isStrongNameIdentity rejects on purpose (one shared token
// is the asymmetric surname shape). So the same payment was identified by hand every month.

{
  const memInv = {
    id: "m1", invoice_number: "2026-0044", total_inc_btw: 100, amount_paid: 0,
    client_name: "Jansen Bouw B.V.", direction: "outgoing" as const, status: "sent",
    invoice_date: "2026-07-01", due_date: "2026-07-31", accountant_status: null,
  };
  const memTx = (amount: number) => ({
    date: "2026-07-20", amount, description: "SEPA", reference: null,
    counterpartName: "SUMUP *JANSEN", counterpartIban: null, transactionId: "t1",
  });
  const remembered = buildMatchMemory([
    { counterpartName: "SUMUP *JANSEN", counterpartIban: null, partyName: "Jansen Bouw B.V." },
  ]);
  const run = (amount: number, memory: ReturnType<typeof buildMatchMemory> | null) =>
    matchTransactions([memTx(amount)] as never, [memInv] as never, { memory }).matches[0];

  check("[GEHEUGEN] a remembered counterpart identifies the party", (() => {
    const m = run(100, remembered);
    return (m.best?.signals ?? []).includes("memory");
  })());
  check("[GEHEUGEN] …and says so, naming who", (() => {
    const m = run(100, remembered);
    return /eerder een betaling van deze tegenpartij aan Jansen Bouw B\.V\. gekoppeld/.test(m.best?.reason ?? "");
  })());

  // What it is FOR: a near amount needs identity, and this counterparty had none the token rules
  // would accept. Without memory the line is not merely weak — it is absent.
  check("[GEHEUGEN] it turns an invisible near-amount line into an offer", (() => {
    const without = run(99.5, null);
    const withMem = run(99.5, remembered);
    return without.outcome === "none" && without.candidates.length === 0
      && withMem.outcome === "choice" && (withMem.candidates[0].signals ?? []).includes("near_amount");
  })());

  // What it is NOT for: it must not book anything that did not book before. Memory identifies the
  // PARTY, never the bill, and it lands under the same coincidence ceiling as amount+name+date.
  check("[GEHEUGEN] it opens no new door to an unattended booking", (() => {
    const exact = run(100, remembered);
    const exactWithout = run(100, null);
    return exact.outcome === exactWithout.outcome
      && (exact.best?.confidence ?? 0) === (exactWithout.best?.confidence ?? 0);
  })());
  check("[GEHEUGEN] a near amount stays a choice, remembered or not", run(99.5, remembered).outcome === "choice");

  // The rule that makes one mistaken confirmation self-limiting.
  check("[GEHEUGEN] a counterpart that settled two parties stops speaking", (() => {
    const channel = buildMatchMemory([
      { counterpartName: "SUMUP *JANSEN", counterpartIban: null, partyName: "Jansen Bouw B.V." },
      { counterpartName: "SUMUP *JANSEN", counterpartIban: null, partyName: "Iemand Anders" },
    ]);
    return !(run(100, channel).best?.signals ?? []).includes("memory")
      && run(99.5, channel).outcome === "none";
  })());

  // A printed invoice number is still the strongest thing on the page. Memory ranks; it never
  // outranks the document naming the bill.
  check("[GEHEUGEN] a printed number still outranks a remembered counterparty", (() => {
    const other = { ...memInv, id: "m2", invoice_number: "2026-0099", client_name: "Iemand Anders" };
    const tx = { ...memTx(100), description: "Factuur 2026-0099" };
    const m = matchTransactions([tx] as never, [memInv, other] as never, { memory: remembered }).matches[0];
    return m.best?.invoiceNumber === "2026-0099";
  })());
}



// ── [DEELBETALING] an instalment from an identified account is offered, never booked ──────────
{
  const inv = {
    id: "p1", invoice_number: "26-3958", total_inc_btw: 500, amount_paid: 0,
    client_name: "Hano Import B.V.", direction: "incoming" as const, status: "received",
    invoice_date: "2026-07-01", due_date: "2026-07-31", accountant_status: null,
    vendor_iban: "NL91ABNA0417164300",
  };
  const tx = (over: Record<string, unknown> = {}) => ({
    date: "2026-07-20", amount: -300, description: "SEPA Overboeking",
    reference: null, counterpartName: "Hano Import B.V.", counterpartIban: "NL91ABNA0417164300",
    transactionId: "p-t1", ...over,
  });
  const m = matchTransactions([tx()] as never, [inv] as never).matches[0];
  check("[DEELBETALING] €300 van €500 open, van de eigen IBAN van de leverancier → aangeboden als keuze",
    m.outcome === "choice" && (m.candidates[0]?.signals ?? []).includes("partial_amount"));
  check("[DEELBETALING] …en de reden noemt beide bedragen",
    /€300\.00 van €500\.00/.test(m.candidates[0]?.reason ?? ""));
  check("[DEELBETALING] nooit automatisch geboekt", m.outcome !== "auto");

  // Zonder rekening-identiteit is een kleiner bedrag GEEN kandidaat: met een bedrag dat nergens
  // op past is de naam precies het toeval waar dit bestand zijn hele lengte tegen waakt.
  const naamAlleen = matchTransactions(
    [tx({ counterpartIban: "NL20INGB0001234567" })] as never,
    [{ ...inv, vendor_iban: null }] as never,
  ).matches[0];
  check("[DEELBETALING] naam-alleen + kleiner bedrag blijft onzichtbaar", naamAlleen.outcome === "none");

  // Een bedrag GROTER dan het openstaande is geen deelbetaling — dat is de overbetaling/batch-kant.
  const groter = matchTransactions([tx({ amount: -700 })] as never, [inv] as never).matches[0];
  check("[DEELBETALING] een groter bedrag valt niet onder deze tier",
    !(groter.candidates?.[0]?.signals ?? []).includes("partial_amount"));
}


// ── [CIRKEL-EXPLAIN] The two shapes the match route's explain passes stand on ────────────────────
// The route re-scores 'none' debits against paid/queued invoices to say "this bill exists, stop
// asking for an upload". Two ways that silently broke: (1) isEligible refuses 'verwerkt' FIRST,
// so an accountant locking a quarter re-opened every explained debit — the pass must clear
// accountant_status on its candidates; (2) the greedy 1:1 pass nulls `best` on a near-tie (two
// same-amount invoices, one supplier — duplicate rent), so an explain that only reads `best`
// fails on exactly the shape that motivated it. Candidates must carry the evidence instead.
{
  const debit = tx({ transactionId: "t-verw", amount: -500, date: "2026-05-02", reference: "factuur 26100077" });
  const locked = inv({ id: "i-verw", invoice_number: "26100077", total_inc_btw: 500, direction: "incoming", status: "received", accountant_status: "verwerkt" });
  const asLocked = matchTransactions([debit] as never, [locked] as never).matches[0];
  check("[CIRKEL-EXPLAIN] a 'verwerkt' candidate is invisible to the matcher (the trap)",
    asLocked.outcome === "none" && !asLocked.best);
  const cleared = matchTransactions([debit] as never, [{ ...locked, accountant_status: null }] as never).matches[0];
  const clearedSig = cleared.best?.signals ?? cleared.candidates?.[0]?.signals ?? [];
  check("[CIRKEL-EXPLAIN] clearing accountant_status restores the reference+amount evidence",
    clearedSig.includes("reference") && clearedSig.includes("amount"));

  const twin = tx({ transactionId: "t-twin", amount: -800, date: "2026-05-03", reference: "huur mei" });
  const a = inv({ id: "i-a", invoice_number: "H-100", total_inc_btw: 800, direction: "incoming", status: "received", client_name: "Verhuurder BV" });
  const b = inv({ id: "i-b", invoice_number: "H-101", total_inc_btw: 800, direction: "incoming", status: "received", client_name: "Verhuurder BV" });
  const tie = matchTransactions([twin] as never, [a, b] as never).matches[0];
  check("[CIRKEL-EXPLAIN] a same-amount near-tie yields no best…", !tie.best);
  check("[CIRKEL-EXPLAIN] …but its candidates still carry the amount evidence the explain pass scans",
    (tie.candidates ?? []).some((c) => (c.signals ?? []).includes("amount")));
}

// ── [NUMMER-BOTST] a printed number is not an identity across suppliers ──────────────────────
{
  const cand = (p: Partial<MatchCandidate> = {}): MatchCandidate => ({
    invoiceId: "inv-a", invoiceNumber: "2026-014", amount: -121, invoiceDate: "2026-02-01",
    confidence: 0.97, signals: ["reference", "amount"], reason: "", nameSim: 0, nameIdentity: false, ...p,
  });
  const asAuto = (t: BankTransaction, c: MatchCandidate): TransactionMatch => ({ transaction: t, outcome: "auto", best: c, candidates: [c] });
  // Supplier A's invoice 2026-014, € 121; the owner pays supplier B € 121 quoting B's own 2026-014.
  const payB = tx({ amount: -121, counterpartName: "Supplier B", counterpartIban: "NL91ABNA0417164300", reference: "2026-014" });
  check("[NUMMER-BOTST] the bank names an account the document contradicts → no tier",
    autoConfirmTier(asAuto(payB, cand({ vendorIban: "NL02RABO0123456789" }))) === null);
  check("[NUMMER-BOTST] no account to confirm, a counterparty that does not match, money OUT → flagged, never silent",
    autoConfirmTier(asAuto(payB, cand({ vendorIban: null }))) === "amount_only");
  check("[NUMMER-BOTST] the same account on both sides → certain, as before",
    autoConfirmTier(asAuto(payB, cand({ vendorIban: "NL91ABNA0417164300" }))) === "certain");
  check("[NUMMER-BOTST] a counterparty that DOES match → certain, as before",
    autoConfirmTier(asAuto(payB, cand({ vendorIban: null, nameSim: 0.9 }))) === "certain");
  check("[NUMMER-BOTST] a line without a counterparty name at all → certain (nothing contradicts)",
    autoConfirmTier(asAuto(tx({ amount: -121, counterpartName: null, reference: "2026-014" }), cand({ vendorIban: null }))) === "certain");
  check("[NUMMER-BOTST] money IN quoting OUR number stays certain — our numbers are unique here",
    autoConfirmTier(asAuto(tx({ amount: 121, counterpartName: "Stichting Derdengelden", reference: "2026-014" }), cand({ amount: 121, vendorIban: null }))) === "certain");
}

// ── [TWEELING] same party, same amount, only a date apart → a human choice ─────────────────
{
  const late = tx({ transactionId: "t-late", amount: -89, date: "2026-02-20", counterpartName: "KPN B.V.", counterpartIban: "NL91ABNA0417164300", reference: "abonnement" });
  const jan = inv({ id: "i-jan", invoice_number: "K-001", total_inc_btw: 89, invoice_date: "2026-01-01", due_date: "2026-01-14", direction: "incoming", status: "received", client_name: "KPN B.V.", vendor_iban: "NL91ABNA0417164300" } as never);
  const feb = inv({ id: "i-feb", invoice_number: "K-002", total_inc_btw: 89, invoice_date: "2026-02-20", due_date: "2026-03-06", direction: "incoming", status: "received", client_name: "KPN B.V.", vendor_iban: "NL91ABNA0417164300" } as never);
  const m = matchTransactions([late] as never, [jan, feb] as never).matches[0];
  check("[TWEELING] January paid late on February's date: not an 'auto' — the date bonus is not an identity", m.outcome !== "auto");
  check("[TWEELING] …both stay listed for the owner", (m.candidates ?? []).length === 2);
  // Negative control: name the document and it IS decisive.
  const named = tx({ ...late, reference: "K-001" });
  const n = matchTransactions([named] as never, [jan, feb] as never).matches[0];
  check("[TWEELING] negative control — a printed number picks January, auto", n.outcome === "auto" && n.best?.invoiceId === "i-jan");
}

// ── [STORNO-GEEN-BETALING] a returned collection is never a pre-selected payment ─────────────
{
  // The measured case. ATAPACK collects € 242,00 by incasso; the collection bounces and the bank
  // credits it back on 10 March with NDDT + a machtigingskenmerk. The owner also SELLS to ATAPACK
  // and has an open € 242,00 sales invoice of 3 March. Before this cap the pair scored 0.950,
  // reached 'auto' and autoConfirmTier booked it 'amount_only' — a customer marked paid, with
  // nobody watching, off money a supplier had just taken back.
  const storno = tx({
    transactionId: "t-storno", amount: 242, date: "2026-03-10",
    description: "STORNO SEPA INCASSO ALGEMEEN DOORLOPEND",
    counterpartName: "ATAPACK B.V.", counterpartIban: "NL91ABNA0417164300",
    typeCode: "NDDT", mandateId: "M-2024-0091", creditorId: "NL32ZZZ411951220000",
  });
  const sale = inv({ id: "i-sale", invoice_number: "20260041", total_inc_btw: 242, invoice_date: "2026-03-03", due_date: "2026-04-02", direction: "outgoing", status: "sent", client_name: "ATAPACK B.V." } as never);
  const m = matchTransactions([storno] as never, [sale] as never).matches[0];
  check("[STORNO-GEEN-BETALING] a returned collection never reaches 'auto'", m.outcome !== "auto");
  check("[STORNO-GEEN-BETALING] …and no tier can book it unattended", autoConfirmTier(m) === null);
  // Capped, NOT removed: on a business account the same shape is the owner collecting from their
  // own customers, where the line genuinely IS the payment. That owner taps once; they do not lose
  // the candidate. "Weak" and "invisible" are not the same outcome.
  check("[STORNO-GEEN-BETALING] …but it stays listed, with its reason", (m.candidates ?? []).length === 1);
  check("[STORNO-GEEN-BETALING] the card says why", (m.candidates?.[0]?.reason ?? "").includes("storno"));
  // The /bank card explains a candidate from its SIGNALS, not from this sentence — WHY_KEY maps the
  // MatchSignal type to a translated line, and [WAAROM-DEZE] holds the two lists against each
  // other. Without the signal the owner sees a candidate the app quietly refuses to pre-select and
  // no word about why, which reads as a broken screen rather than a careful one.
  check("[STORNO-GEEN-BETALING] …in a signal the screen can translate",
    (m.candidates?.[0]?.signals ?? []).includes("reversal"));
  check("[STORNO-GEEN-BETALING] capped to a human choice, above the listing floor",
    (m.candidates?.[0]?.confidence ?? 0) === 0.6);

  // Negative control 1: the SAME line without the bank's markers books exactly as it did before.
  const plain = tx({ ...storno, transactionId: "t-plain", description: "Betaling factuur", typeCode: null, mandateId: null, creditorId: null });
  const p = matchTransactions([plain] as never, [sale] as never).matches[0];
  check("[STORNO-GEEN-BETALING] negative control — no markers, unchanged 'auto'", p.outcome === "auto");
  check("[STORNO-GEEN-BETALING] negative control — and still bookable", autoConfirmTier(p) === "amount_only");
  check("[STORNO-GEEN-BETALING] negative control — no reversal signal on an ordinary payment",
    !(p.candidates?.[0]?.signals ?? []).includes("reversal"));

  // Negative control 2: only a PAYER's wording. A customer who types "terugbetaling incasso" in a
  // payment note must not hold back their own payment — the fields, not the free text, decide.
  const typed = tx({ ...plain, transactionId: "t-typed", description: "terugbetaling incasso" });
  const w = matchTransactions([typed] as never, [sale] as never).matches[0];
  check("[STORNO-GEEN-BETALING] negative control — a payer's own words change nothing", w.outcome === "auto");

  // Negative control 3: the ordinary direction. A collection GOING OUT under the same markers is a
  // payment, and this cap must never touch it.
  const collect = tx({ transactionId: "t-collect", amount: -242, date: "2026-03-10", description: "SEPA INCASSO ALGEMEEN DOORLOPEND", counterpartName: "ATAPACK B.V.", counterpartIban: "NL91ABNA0417164300", typeCode: "NDDT", mandateId: "M-2024-0091" });
  const bill = inv({ id: "i-bill", invoice_number: "A-77", total_inc_btw: 242, invoice_date: "2026-03-03", due_date: "2026-04-02", direction: "incoming", status: "received", client_name: "ATAPACK B.V.", vendor_iban: "NL91ABNA0417164300" } as never);
  const c = matchTransactions([collect] as never, [bill] as never).matches[0];
  check("[STORNO-GEEN-BETALING] negative control — a collection going out is a payment, untouched", c.outcome === "auto");
  check("[STORNO-GEEN-BETALING] …and books on the account it names", autoConfirmTier(c) === "certain");
}

// ── [INCASSO-IDENTITEIT] the machtigingskenmerk as the handle the memory was missing ─────────
{
  // What an ING statement gives for a monthly incasso: the SCHEME as the counterpart name, and the
  // collector's clearing account as the IBAN. Neither handle the memory had can identify Vitens,
  // month after month — while the mandate reference on the line is the same string every time.
  const line = {
    counterpartName: "SEPA INCASSO ALGEMEEN DOORLOPEND",
    counterpartIban: "NL08INGB0000000555",
    typeCode: "NDDT", mandateId: "VIT-2019-88213", creditorId: "NL32ZZZ411951220000",
  };
  const memory = buildMatchMemory([{ counterpartName: line.counterpartName, counterpartIban: line.counterpartIban, mandateId: line.mandateId, creditorId: line.creditorId, partyName: "Vitens N.V." }]);
  // The bank took its € 0,50 off, so the amount is NEAR and not exact. [BIJNA-BEDRAG] needs the
  // counterparty to be IDENTIFIED before it will offer such a pair at all — and on this line
  // nothing could identify it. Without the mandate the owner sees "Geen factuur" over an invoice
  // sitting right there; the only tool left is to search by hand.
  const near = tx({ ...line, transactionId: "t-near", amount: -60.9, date: "2026-04-02", description: "SEPA INCASSO ALGEMEEN DOORLOPEND INCASSANT: NL32ZZZ411951220000" });
  const water = inv({ id: "i-water", invoice_number: "9911", total_inc_btw: 61.4, invoice_date: "2026-03-28", due_date: "2026-04-11", direction: "incoming", status: "received", client_name: "Vitens N.V." } as never);
  const blind = matchTransactions([near] as never, [water] as never).matches[0];
  check("[INCASSO-IDENTITEIT] without the mandate the near-amount pair is invisible", (blind.candidates ?? []).length === 0);
  const seen = matchTransactions([near] as never, [water] as never, { memory }).matches[0];
  check("[INCASSO-IDENTITEIT] the mandate identifies the collector, so the pair is offered", (seen.candidates ?? []).length === 1);
  check("[INCASSO-IDENTITEIT] …and the difference is named", (seen.candidates?.[0]?.reason ?? "").includes("0.50"));
  check("[INCASSO-IDENTITEIT] …with the incasso as the stated evidence", (seen.candidates?.[0]?.reason ?? "").includes("dezelfde incasso"));
  check("[INCASSO-IDENTITEIT] a near amount is never bookable, however identified", seen.outcome !== "auto");

  // It identifies the PARTY, not the bill: an exact amount lands on the same 0.95 coincidence
  // ceiling that amount + name + date already reached. No new booking door.
  const exact = tx({ ...near, transactionId: "t-exact", amount: -61.4 });
  const e = matchTransactions([exact] as never, [water] as never, { memory }).matches[0];
  check("[INCASSO-IDENTITEIT] an exact amount stays on the coincidence ceiling", (e.candidates?.[0]?.confidence ?? 0) === 0.95);
  check("[INCASSO-IDENTITEIT] …and books no tier the memory did not already reach", autoConfirmTier(e) === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
