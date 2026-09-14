// [REGEL-DEUR] Pure node test for bank-auto-announce.ts — run: npx tsx bank-auto-announce.test.ts
//
// Half of this file is the module's own contract. The other half is the RE-MEASUREMENT the owner
// asked for: the screen used to answer "will the server book this?" with a copy of the tier tree,
// and the copy did not know two of the tiers. That is not a style complaint — the same predicate
// gates whether the auto-confirm pass is fired at all on page open, so a statement whose only
// bookable payments were those tiers was never offered to the pass and waited for the daily cron.
//
// So the tiers are built here through the REAL matcher, not hand-written: matchTransactions must
// produce the signals, autoConfirmTier must return the tier, and the announcement must then name
// the row. A hand-built candidate would prove the module and nothing about the defect.
import type { BankTransaction } from "./bank-parser";
import { matchTransactions, autoConfirmTier, type InvoiceForMatching } from "./bank-matching";
import { announcesAutoBooking } from "./bank-auto-announce";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

function tx(p: Partial<BankTransaction>): BankTransaction {
  return {
    date: "2026-02-10",
    amount: -1210,
    currency: "EUR",
    description: "",
    counterpartName: null,
    counterpartIban: null,
    reference: null,
    transactionId: "tx-1",
    rawLine: "",
    ...p,
  };
}
function inv(p: Partial<InvoiceForMatching>): InvoiceForMatching {
  return {
    id: "inv-1",
    invoice_number: "2026-014",
    total_inc_btw: 1210,
    invoice_date: "2026-02-01",
    due_date: "2026-02-15",
    client_name: "Jansen BV",
    direction: "incoming",
    status: "received",
    accountant_status: null,
    ...p,
  };
}

console.log("[REGEL-DEUR] the announcement asks, it does not decide");

// ── The module's own contract ───────────────────────────────────────────────────────────────
check("a 'certain' tier is announced", announcesAutoBooking({ tier: "certain" }));
check("an 'amount_only' tier is announced", announcesAutoBooking({ tier: "amount_only" }));
check("a null tier is not announced", !announcesAutoBooking({ tier: null }));

// The trap this module exists to close. `tier !== null` is the obvious test and it is true for
// undefined, so a response from before the field shipped would announce every line on the page,
// including the ones with no candidate at all, and fire the pass on every load.
check("a MISSING tier is not announced", !announcesAutoBooking({}));
check("an undefined tier is not announced", !announcesAutoBooking({ tier: undefined }));
// And a value that is neither tier — a future tier name the screen has not been taught, or a
// mangled response — is refused rather than assumed bookable.
check(
  "an unknown tier value is not announced",
  !announcesAutoBooking({ tier: "probably" as unknown as "certain" }),
);

// [AL-GEBOEKT] / [SOM-KLOPT] Screen policy, kept deliberately: the payment names an invoice that
// is already settled, so the card shows that instead of a chooser and must not be pre-announced.
check("a quoted settled invoice is not announced", !announcesAutoBooking({ tier: "certain", quotedSettled: { invoiceNumber: "2026-014" } }));
check("a fully settled quoted SET is not announced", !announcesAutoBooking({ tier: "certain", quotedSet: { fullySettled: true } }));
check("a partly open quoted set is still announced", announcesAutoBooking({ tier: "certain", quotedSet: { fullySettled: false } }));

// ── The re-measurement: the two tiers the screen's copy never knew ──────────────────────────

// [BANK-BATCH-ONLOAD] An MT940 line that carries the supplier's account and nothing else: no
// printed invoice number, no counterparty name. This is the exact case the supplier_iban tier was
// built for, and it is the case the screen's copy scored at zero — `certain` needed a reference or
// iban signal, `amountOnly` needed a counterpart signal, and this line has neither.
{
  const t = tx({ counterpartIban: "NL91ABNA0417164300", counterpartName: null, reference: null });
  const i = inv({ supplier_known_iban: "NL91ABNA0417164300", client_name: "Jansen BV" });
  const m = matchTransactions([t], [i]).matches[0];
  const tier = autoConfirmTier(m);
  const sig = m.best?.signals ?? [];
  check("supplier_iban: the matcher raises the signal", sig.includes("supplier_iban"));
  check("supplier_iban: the rule books it flagged", tier === "amount_only");
  // The proof that the old copy said no: it required one of these three, and none fired.
  check(
    "supplier_iban: the OLD copy's three signals are all absent",
    !sig.includes("reference") && !sig.includes("iban") && !sig.includes("counterpart"),
  );
  check("supplier_iban: the announcement now names it", announcesAutoBooking({ tier }));
}

// [BANK-BATCH-ONLOAD] The same for the prepared tier: the owner opened the pay sheet on this
// invoice, then exactly that amount left the account. No name on the line, no printed number.
{
  const t = tx({ date: "2026-02-12", counterpartName: null, counterpartIban: null, reference: null });
  const i = inv({ payment_prepared_at: "2026-02-11T09:00:00Z", client_name: "Jansen BV" });
  const m = matchTransactions([t], [i]).matches[0];
  const tier = autoConfirmTier(m);
  const sig = m.best?.signals ?? [];
  check("prepared: the matcher raises the signal", sig.includes("prepared"));
  check("prepared: the rule books it flagged", tier === "amount_only");
  check(
    "prepared: the OLD copy's three signals are all absent",
    !sig.includes("reference") && !sig.includes("iban") && !sig.includes("counterpart"),
  );
  check("prepared: the announcement now names it", announcesAutoBooking({ tier }));
}

// The other direction the copy was wrong in: it announced rows the rule refuses. A payment whose
// text names a DIFFERENT invoice than the winner is vetoed by [BANK-REF-CONTRADICTS] — the copy
// saw a 'counterpart' signal and said yes.
{
  const t = tx({ counterpartName: "Jansen BV", reference: "factuur 20260812" });
  const i = inv({ invoice_number: "2026-014", client_name: "Jansen BV" });
  const m = matchTransactions([t], [i]).matches[0];
  const tier = autoConfirmTier(m);
  const sig = m.best?.signals ?? [];
  check("contradiction: the copy's 'counterpart' signal IS present", sig.includes("counterpart"));
  check("contradiction: the rule refuses", tier === null);
  check("contradiction: the announcement refuses too", !announcesAutoBooking({ tier }));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
