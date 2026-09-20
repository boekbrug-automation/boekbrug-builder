// [READINESS] Pure node test — run: npx tsx src/lib/readiness.test.ts
// The score is a PROMISE to the owner and the boekhouder: every point is earned by a
// provable condition. These tests pin the strict rubric (30/30/20/20, n.v.t. excluded)
// so it can never drift into a cosmetic number.
import { buildReadiness, type ReadinessSignals } from "./readiness";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A fully-clean retail quarter (the "green" baseline).
const perfect = (over: Partial<ReadinessSignals> = {}): ReadinessSignals => ({
  quarterLabel: "Q1 2026",
  verifiedInvoiceCount: 40, invoicesWithEvidence: 40, missingEvidence: [],
  bankTxCount: 120, undocumentedCount: 0, unmatchedIncomeCount: 0,
  usesTurnover: true, turnoverDays: 90, reconExceptions: [],
  hasSales: true, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  ...over,
});

console.log("\n— a clean retail quarter is 100% and ready —");
{
  const r = buildReadiness(perfect());
  check("score = 100", r.score === 100);
  check("status ready", r.status === "ready" && r.ready === true);
  check("no missing, no risks", r.missing.length === 0 && r.risks.length === 0);
  check("all four dimensions applicable", r.dimensions.every((d) => d.applicable));
}

console.log("\n— [TRUST-READY] a received payment with no invoice blocks 'klaar' —");
{
  // Was the CRITICAL false-green: an unmatched incoming payment never lowered the
  // score, so the quarter read '100% klaar' while revenue had no invoice behind it.
  const r = buildReadiness(perfect({ unmatchedIncomeCount: 2 }));
  check("not ready when a payment has no invoice", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap (not a soft risk)", r.missing.some((m) => /zonder factuur/.test(m.title)));
  check("score dips below 100", r.score < 100);
  const clean = buildReadiness(perfect({ unmatchedIncomeCount: 0 }));
  check("zero unmatched income → still ready (no false alarm)", clean.status === "ready");
}

console.log("\n— [AUTO-EXCLUDE-REVIEW] auto-coded privé/overboeking/belasting lines surface for review —");
{
  // The money-hiding case: a line auto-coded (unconfirmed) as an EXCLUDED identity is dropped from
  // omzet/kosten/BTW. If it was MISlabelled, a real receipt/cost silently leaves the books. It must
  // surface — as a RISK (self-clearing on confirm), never a hard block (most are correct).
  const r = buildReadiness(perfect({ unreviewedExcludedCount: 4 }));
  check("surfaced as a RISK, not a blocking gap", r.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
  check("does NOT block 'klaar' (still ready — only a review nudge)", r.status === "ready" && r.ready === true);
  check("the risk deep-links to the EXCLUDED-only review list", r.risks.some((m) => m.fix?.href === "/dashboard/bank/categoriseren?view=review&only=excluded"));
  // With year/quarter present, the link is quarter-scoped AND excluded-only → opens EXACTLY the counted lines.
  const scoped = buildReadiness(perfect({ unreviewedExcludedCount: 2, year: 2026, quarter: 1 }));
  check("deep-link is quarter-scoped + excluded-only when year/quarter known", scoped.risks.some((m) => m.fix?.href === "/dashboard/bank/categoriseren?view=review&only=excluded&year=2026&quarter=1"));
  check("singular phrasing for a single line", buildReadiness(perfect({ unreviewedExcludedCount: 1 })).risks.some((m) => /^1 bankregel /.test(m.title)));
  const clean = buildReadiness(perfect({ unreviewedExcludedCount: 0 }));
  check("zero → no risk (no false alarm)", !clean.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
  const legacy = buildReadiness(perfect());
  check("undefined count → treated as 0 (older callers keep working)", !legacy.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
}

console.log("\n— [ORIGINEEL] the evidence gap now points somewhere the client can act —");
{
  // This was the only item in the whole report with no fix link, and the reason was not an
  // oversight in the report: there was nowhere for it to point. The accountant asks for the missing
  // original every quarter; the client had no route, no button, no way to supply it.
  const r = buildReadiness(perfect({ verifiedInvoiceCount: 10, invoicesWithEvidence: 7, missingEvidence: ["26302050", "26302362"] }));
  const item = r.missing.find((m) => /originele document/.test(m.title));
  check("still a blocking gap — evidence the accountant cannot read is evidence missing", !!item);
  check("and it now carries a way to act", !!item?.fix?.href);
  check("pointing at exactly the counted set", item?.fix?.href === "/dashboard/incoming/manage?filter=geen-document");
  check("the detail names the action, not just the problem", /origineel toe/.test(item?.detail ?? ""));
  check("and still names WHICH invoices", /26302050/.test(item?.detail ?? ""));
  const complete = buildReadiness(perfect({ verifiedInvoiceCount: 10, invoicesWithEvidence: 10 }));
  check("nothing missing → nothing said", !complete.missing.some((m) => /originele document/.test(m.title)));
}

console.log("\n— [KAS-AUTO-BOOK] bookings made on amount + name are offered before the aangifte —");
{
  // These book themselves unattended under the kasstelsel for exactly one reason: they stay
  // reversible until the quarter is declared. That reason only holds if the quarter-close actually
  // OFFERS them, so this is the mechanism behind the permission, not a decoration.
  const r = buildReadiness(perfect({ amountOnlyBookingCount: 3 }));
  check("surfaced as a RISK", r.risks.some((m) => /alleen op bedrag gekoppeld/.test(m.title)));
  check("never a block — most are right, and blocking every quarter makes the verdict useless", r.status === "ready" && r.ready === true);
  check("the detail names the deadline that makes it matter", r.risks.some((m) => /suppletie/.test(m.detail ?? "")));
  check("and points at the tab where the flag can be answered", r.risks.some((m) => m.fix?.href === "/dashboard/bank?tab=done"));
  check("singular phrasing for one", buildReadiness(perfect({ amountOnlyBookingCount: 1 })).risks.some((m) => /^1 factuur is alleen op bedrag/.test(m.title)));
  check("zero → silence (a nag with nothing behind it is worse than none)", !buildReadiness(perfect({ amountOnlyBookingCount: 0 })).risks.some((m) => /alleen op bedrag/.test(m.title)));
  check("undefined → treated as 0 (older callers unchanged)", !buildReadiness(perfect()).risks.some((m) => /alleen op bedrag/.test(m.title)));
}

console.log("\n— [PACKAGE-READINESS] invoices still in the verify queue block 'klaar' —");
{
  // A real bill dated in the quarter but not yet verified reaches the accountant nowhere —
  // it must block "klaar" until the owner confirms it (the "geen ontbrekende factuur" rule).
  const r = buildReadiness(perfect({ unverifiedInvoiceCount: 3 }));
  check("not ready while invoices sit in the verify queue", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming the verwerkingsrij", r.missing.some((m) => /verwerkingsrij/.test(m.title)));
  check("the gap deep-links to the invoices screen", r.missing.some((m) => m.fix?.href === "/dashboard/incoming"));
  const clean = buildReadiness(perfect({ unverifiedInvoiceCount: 0 }));
  check("zero unverified → still ready (no false alarm)", clean.status === "ready");
  const legacy = buildReadiness(perfect());
  check("undefined unverified count → treated as 0 (older callers keep working)", legacy.status === "ready");
}

console.log("\n— the weighted mean is exact (30/30/20/20) —");
{
  // invoices 20/40 = 0.5 → 15; bank 1 → 30; cash 1 → 20; vat 1 → 20; = 85/100.
  const r = buildReadiness(perfect({ verifiedInvoiceCount: 40, invoicesWithEvidence: 20, missingEvidence: ["2026-003", "2026-007"] }));
  check("score = 85 (invoices at half weight)", r.score === 85);
  check("a missing-evidence item is listed", r.missing.some((m) => /originele document/.test(m.title)));
  check("not ready (something is missing)", r.status !== "ready");
}

console.log("\n— n.v.t. dimensions are EXCLUDED from the denominator, never faked —");
{
  // A ZZP: invoices + bank only, no till, no cash-without-rate. cash is n.v.t.
  // applicableWeight = 30+30+20(vat) = 80; earned = 30+30+20 = 80 → 100.
  const zzp = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 10, invoicesWithEvidence: 10, missingEvidence: [],
    bankTxCount: 30, undocumentedCount: 0, unmatchedIncomeCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: true, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("cash dimension is n.v.t.", zzp.dimensions.find((d) => d.key === "cash")!.applicable === false);
  check("score = 100 with cash excluded (not dragged to 75)", zzp.score === 100);
  check("ready", zzp.status === "ready");
}

console.log("\n— missing bank data is a real gap (bank → 0) —");
{
  const r = buildReadiness(perfect({ bankTxCount: 0, undocumentedCount: 0 }));
  // invoices 30 + cash 20 + vat 20 = 70 earned; bank 30 applicable @0 → /100 = 70.
  check("score = 70 (bank weight fully lost)", r.score === 70);
  check("'Bankafschrift ontbreekt' is missing", r.missing.some((m) => /Bankafschrift ontbreekt/.test(m.title)));
  check("almost, not ready", r.status === "almost");
}

console.log("\n— [NO-CODEER] uncoded cost debits don't BLOCK, but a supplier payment without an invoice is a surfaced voorbelasting RISK —");
{
  // 120 tx, 12 supplier-like cost debits with no inkoopfactuur. We never hand-code a bare debit
  // (that yields no BTW and can double-count) → NOT a blocking 'missing' gap. But the missing
  // voorbelasting is real, so it's surfaced as a RISK (eyeball, not block): still 'ready', and the
  // honesty guard caps the score at 99 so a clean 100 never hides an unclaimed BTW-aftrek.
  const r = buildReadiness(perfect({ bankTxCount: 120, undocumentedCount: 12 }));
  check("not a false 100 while voorbelasting may be missing (capped to 99)", r.score === 99);
  check("no 'wacht nog op een bon' MISSING gap is listed", !r.missing.some((m) => /wachten nog op een bon/.test(m.title)));
  check("surfaced as a voorbelasting RISK", r.risks.some((m) => /leverancierbetaling/.test(m.title)));
  check("still ready — a risk doesn't block handover", r.status === "ready");
}

console.log("\n— unmatched INCOME still lowers the bank ratio (revenue truth survives) —");
{
  // 120 tx, 12 received payments with no invoice behind them → resolved 108/120 = 0.9 →
  // bank 27. 30+27+20+20 = 97. Money in with no invoice must never silently pass.
  const r = buildReadiness(perfect({ bankTxCount: 120, unmatchedIncomeCount: 12 }));
  check("score = 97 (bank at 0.9)", r.score === 97);
  check("a 'zonder factuur' income item is listed", r.missing.some((m) => /zonder factuur/.test(m.title)));
  check("not ready (unexplained income is a gap)", r.status !== "ready");
}

console.log("\n— reconciliation differences are RISKS (eyeball), not blocking gaps —");
{
  // The strategist's example: 3 July, cash register €340 higher than bank deposits.
  const r = buildReadiness(perfect({
    reconExceptions: [{ date: "2026-07-03", kind: "cash", note: "kas vs bank", diff: 340 }],
  }));
  check("a risk is listed with the date and amount", r.risks.some((x) => x.title.includes("2026-07-03") && x.title.includes("340")));
  check("the risk is NOT counted as missing", r.missing.length === 0);
  check("one off-day among 90 → score capped at 99 (never a false 100)", r.score === 99);
  check("still 'ready' — a documented risk doesn't block handover", r.status === "ready");
}

console.log("\n— unrated cash omzet is a BTW gap (missing) —");
{
  const r = buildReadiness(perfect({ cashOmzetZonderBtw: 250 }));
  check("vat dimension drops below 1", r.dimensions.find((d) => d.key === "vat")!.subscore < 1);
  check("'€250 omzet zonder BTW-tarief' listed", r.missing.some((m) => /250 omzet zonder BTW-tarief/.test(m.title)));
  check("not ready", r.status !== "ready");
}

console.log("\n— omzet-zonder-tarief fix routes by SOURCE, not just by till —");
{
  // Plain cash (no till, no bank-sourced omzet) → the owner sets the rate at Kas.
  const cash = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, cashOmzetZonderBtw: 250, omzetZonderBtwNonCash: 0 }));
  const cashItem = cash.missing.find((m) => /omzet zonder BTW-tarief/.test(m.title));
  check("plain cash omzet → fix points to Kas", cashItem?.fix?.href === "/dashboard/kas");

  // Bank-received omzet (money on the bank, rate lives in the Z-report) → Dagomzet,
  // even for a store with NO till rows yet. This was the live bug: €168k bank omzet
  // pointed to 'Naar Kas'.
  const bank = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, cashOmzetZonderBtw: 168159, omzetZonderBtwNonCash: 168159 }));
  const bankItem = bank.missing.find((m) => /omzet zonder BTW-tarief/.test(m.title));
  check("bank-sourced omzet → fix points to Dagomzet (not Kas)", bankItem?.fix?.href === "/dashboard/dagomzet");
  check("bank-sourced detail mentions the Z-rapport", /Z-rapport/.test(bankItem?.detail ?? ""));
}

console.log("\n— partial kassadag coverage is a BTW gap —");
{
  const r = buildReadiness(perfect({ turnoverDays: 80, quarterDays: 90 }));
  check("'80 van 90 kassadagen' listed", r.missing.some((m) => /80 van 90 kassadagen/.test(m.title)));
  check("cash dimension still scores the 80 imported days", r.dimensions.find((d) => d.key === "cash")!.subscore === 1);
}

console.log("\n— empty quarter: nothing to judge → 0, attention —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 0, undocumentedCount: 0, unmatchedIncomeCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("score 0", r.score === 0);
  check("attention", r.status === "attention");
  check("invoices + cash + vat n.v.t.; only bank applicable", r.dimensions.filter((d) => d.applicable).length === 1);
  check("a 'geen gegevens' note is present", r.notes.some((n) => /nog geen gegevens/.test(n)));
}

console.log("\n— a perfect score with a flagged risk never shows 100 —");
{
  const r = buildReadiness(perfect({ hasUndecidableRate: true }));
  check("undecidable rate is a risk", r.risks.some((x) => /rubriek 1c/.test(x.title)));
  // It both drops the vat check (2/3) AND flags a risk: vat 13.33 → 30+30+20+13.33 = 93.
  check("score reflects the failed vat check (93), never a false 100", r.score === 93 && r.score < 100);
}

console.log("\n— bank-only must NOT be a false 100% green (fix A) —");
{
  // Uploaded ONLY a fully-reconciled bank statement: no invoices, no turnover, no cash.
  // The whole sales side is absent — that's a GAP, not n.v.t. Never 'ready', never ~100%.
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 10, undocumentedCount: 0, unmatchedIncomeCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("NOT ready (revenue side is missing)", r.status !== "ready" && r.ready === false);
  check("'Nog geen omzet vastgelegd' is a missing gap", r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
  check("BTW dimension is a real gap (applicable, 0%), not n.v.t.", r.dimensions.find((d) => d.key === "vat")!.applicable === true && r.dimensions.find((d) => d.key === "vat")!.subscore === 0);
  check("score = 60 (bank 30 earned / (bank 30 + vat 20) applicable), never ~100", r.score === 60);
  check("status attention", r.status === "attention");
}

console.log("\n— a pure-purchase quarter (inkoop + bank, geen omzet) flags the missing revenue —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 5, invoicesWithEvidence: 5, missingEvidence: [],
    bankTxCount: 20, undocumentedCount: 0, unmatchedIncomeCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("'Nog geen omzet vastgelegd' flagged even with purchases present", r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
  check("not ready", r.status !== "ready");
  // invoices 30 + bank 30 earned; vat 20 applicable @0; cash n.v.t. → 60/80 = 75.
  check("score = 75 (revenue side counts against readiness)", r.score === 75);
}

console.log("\n— an EMPTY quarter still has BTW as n.v.t. (no activity → nothing to judge) —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 0, undocumentedCount: 0, unmatchedIncomeCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("no activity → BTW n.v.t. (not a spurious 'geen omzet' gap)", r.dimensions.find((d) => d.key === "vat")!.applicable === false);
  check("no spurious omzet-missing item on a truly empty quarter", !r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
}

console.log("\n— readiness never claims what it can't measure (honest note always present) —");
{
  const r = buildReadiness(perfect());
  check("states the score only measures what was imported", r.notes.some((n) => /alleen wat is geïmporteerd/.test(n)));
}

console.log("\n— [KAS-NEGATIEF] a negative cash drawer blocks 'klaar' —");
{
  const r = buildReadiness(perfect({ negativeCashDay: { date: "2026-02-15", balance: -120 } }));
  check("not ready when the drawer went negative", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming the date + amount", r.missing.some((m) => /Kassaldo negatief/.test(m.title) && /2026-02-15/.test(m.title) && /120/.test(m.title)));
  check("the gap deep-links to Kas", r.missing.some((m) => m.fix?.href === "/dashboard/kas"));

  // THE FALSE-GREEN TEST: a pure-cash business (no till dimension) must STILL be blocked.
  const cashOnly = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, negativeCashDay: { date: "2026-03-01", balance: -50 } }));
  check("cash-only business (till n.v.t.) is STILL blocked on a negative drawer", cashOnly.status !== "ready" && cashOnly.ready === false);

  // No false alarm: a non-negative / absent drawer stays ready.
  check("undefined negativeCashDay → still ready (older callers, no false alarm)", buildReadiness(perfect()).status === "ready");
  check("balance 0 → no gap (strict < 0)", buildReadiness(perfect({ negativeCashDay: { date: "2026-01-01", balance: 0 } })).status === "ready");
  check("positive balance passed in → no gap", buildReadiness(perfect({ negativeCashDay: { date: "2026-01-01", balance: 50 } })).status === "ready");
}

console.log("\n— [REGIME-FLAGS] special regimes are RISKS, never a block —");
{
  // A KOR-active shop did its part (imported everything); the regime is the accountant's to
  // apply. So it must surface as a risk and NOT lower the "klaar" verdict.
  const r = buildReadiness(perfect({
    regimeFlags: [{ code: "kor", title: "KOR is actief — bereken geen BTW", detail: "…" }],
  }));
  check("KOR flag surfaces as a risk", r.risks.some((x) => /KOR is actief/.test(x.title)));
  check("KOR flag is NOT a missing gap", !r.missing.some((x) => /KOR/.test(x.title)));
  check("still ready with only a regime risk (score capped at 99 by the honesty guard)",
    r.missing.length === 0 && r.status === "ready" && r.score === 99);
  const clean = buildReadiness(perfect());
  check("no regime flags → untouched (still 100)", clean.score === 100 && clean.risks.length === 0);
}
{
  // A phrase-gated flag carries its evidence into the risk detail.
  const r = buildReadiness(perfect({
    regimeFlags: [{ code: "reverse_charge_purchase", title: "Inkoop met BTW verlegd (rubriek 2a)", detail: "…", evidence: "INK-22" }],
  }));
  check("evidence invoice appears in the risk detail", r.risks.some((x) => /INK-22/.test(x.detail ?? "")));
}

console.log("\n— [KASSTELSEL] undated paid money blocks 'klaar' —");
{
  // Under cash basis, paid money we can't date can't be placed in a quarter → the BTW would be
  // silently too low. It must block "klaar" (a hard gap), and default (undefined) must not.
  const r = buildReadiness(perfect({ undatedPaidCount: 2 }));
  check("not ready when paid money is undated", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming betaaldatum", r.missing.some((m) => /zonder betaaldatum/.test(m.title)));
  check("gap links to the bank screen", r.missing.some((m) => m.fix?.href === "/dashboard/bank"));
  const clean = buildReadiness(perfect({ undatedPaidCount: 0 }));
  check("zero undated → still ready (factuur owners untouched: undefined→0)", clean.status === "ready");
}
{
  // An estimated pay-date is a risk to eyeball, never a hard block.
  const r = buildReadiness(perfect({ estimatedPaidCount: 3 }));
  check("estimated pay-date is a risk, not a block", r.missing.every((m) => !/schatting/.test(m.title)) && r.risks.some((x) => /schatting/.test(x.title)));
  check("still ready with only an estimated-date risk (score capped 99)", r.missing.length === 0 && r.status === "ready");
}
{
  // [BAD-DEBT] Reclaimable BTW on >1yr-unpaid sales is a RISK (money to get back), never a gap.
  const r = buildReadiness(perfect({ badDebt: { count: 2, reclaimableBtw: 420 } }));
  check("bad-debt surfaces as a risk", r.risks.some((x) => /terugvraagbaar/.test(x.title)));
  check("bad-debt names count + euros", r.risks.some((x) => /2 onbetaalde/.test(x.title) && /€420/.test(x.title)));
  check("bad-debt is NOT a missing gap", !r.missing.some((x) => /terugvraagbaar/.test(x.title)));
  check("bad-debt does not block ready", r.missing.length === 0 && r.status === "ready");
  const none = buildReadiness(perfect({ badDebt: { count: 0, reclaimableBtw: 0 } }));
  check("no eligible bad debt → no risk", !none.risks.some((x) => /terugvraagbaar/.test(x.title)));
}
{
  // [BAD-DEBT] Art. 29 lid 7 — voorbelasting to REPAY on >1yr-unpaid purchases. Money to give,
  // so it is worded as a liability — but still a risk: the app cannot prove the invoice went
  // unpaid in the world, and blocking a filing on that inference would trap the owner.
  const r = buildReadiness(perfect({ vatClawback: { count: 2, repayableBtw: 420 } }));
  check("clawback surfaces as a risk", r.risks.some((x) => /terugbetalen/.test(x.title)));
  check("clawback names count + euros", r.risks.some((x) => /2 onbetaalde inkoopfacturen/.test(x.title) && /€420/.test(x.title)));
  check("clawback is NOT a missing gap", !r.missing.some((x) => /terugbetalen/.test(x.title)));
  check("clawback does not block ready", r.missing.length === 0 && r.status === "ready");
  check("clawback points at the purchase page, not at Facturen",
    r.risks.some((x) => /terugbetalen/.test(x.title) && x.fix?.href === "/dashboard/incoming/manage"));
  check("clawback offers the other resolution (you did pay it)",
    r.risks.some((x) => /terugbetalen/.test(x.title) && /op betaald/.test(x.detail ?? "")));
  const none = buildReadiness(perfect({ vatClawback: { count: 0, repayableBtw: 0 } }));
  check("nothing eligible → no clawback risk", !none.risks.some((x) => /terugbetalen/.test(x.title)));
  const immaterial = buildReadiness(perfect({ vatClawback: { count: 1, repayableBtw: 0.2 } }));
  check("a sub-euro clawback is not raised (it rounds to €0)", !immaterial.risks.some((x) => /terugbetalen/.test(x.title)));
}
{
  // Both sides at once: they are separate lines, and the one that COSTS money comes first.
  const r = buildReadiness(perfect({
    badDebt: { count: 1, reclaimableBtw: 210 },
    vatClawback: { count: 1, repayableBtw: 105 },
  }));
  const iClaw = r.risks.findIndex((x) => /terugbetalen/.test(x.title));
  const iBad = r.risks.findIndex((x) => /terugvraagbaar/.test(x.title));
  check("both art. 29 sides are reported, never netted into one figure", iClaw >= 0 && iBad >= 0);
  check("the liability is listed before the reclaim", iClaw < iBad);
}
{
  // [ICP] An opgaaf that will be rejected counts as not filed — so it is raised. But charging
  // BTW to an EU customer is sometimes right, so it never blocks.
  const r = buildReadiness(perfect({ icpProblems: 2 }));
  check("an unfilable EU sale surfaces as a risk", r.risks.some((x) => /ICP-opgaaf/.test(x.title)));
  check("…counted, so the owner knows how many to look at", r.risks.some((x) => /^2 EU-verkopen/.test(x.title)));
  check("one problem reads in the singular", buildReadiness(perfect({ icpProblems: 1 })).risks.some((x) => /^1 EU-verkoop kan/.test(x.title)));
  check("it explains BOTH ways to resolve it", r.risks.some((x) => /VIES/.test(x.detail ?? "") && /verleg je de BTW/.test(x.detail ?? "")));
  check("it never blocks the quarter", r.missing.length === 0 && r.status === "ready");
  check("no EU problems → no risk", !buildReadiness(perfect({ icpProblems: 0 })).risks.some((x) => /ICP-opgaaf/.test(x.title)));
  check("a quarter with no EU sales at all is untouched", !buildReadiness(perfect()).risks.some((x) => /ICP-opgaaf/.test(x.title)));
}

{
  // [DATE-GAP] A verified invoice with no date is in NO quarter's figures, so it must block.
  const r = buildReadiness(perfect({ datelessVerifiedCount: 2 }));
  check("a dateless verified invoice is a blocking GAP, not a risk",
    r.missing.some((x) => /geen factuurdatum/.test(x.title)) && !r.risks.some((x) => /geen factuurdatum/.test(x.title)));
  check("…so the quarter cannot be 'klaar' while it is missing from the count", r.status !== "ready");
  check("it says the figures are too LOW, which is the actual harm",
    r.missing.some((x) => /te laag/.test(x.detail ?? "")));
  check("it names the one action that fixes it",
    r.missing.some((x) => /Vul de factuurdatum in/.test(x.detail ?? "")));
  check("one reads in the singular", buildReadiness(perfect({ datelessVerifiedCount: 1 })).missing.some((x) => /^1 factuur heeft geen factuurdatum$/.test(x.title)));
  check("none → nothing said", !buildReadiness(perfect({ datelessVerifiedCount: 0 })).missing.some((x) => /factuurdatum/.test(x.title)));
  check("absent → unchanged for older callers", !buildReadiness(perfect()).missing.some((x) => /factuurdatum/.test(x.title)));
}

console.log("\n— [DATE-GAP] een factuur zonder datum maakt 'stil 100% klaar' onmogelijk —");
{
  // Een geverifieerde factuur zonder invoice_date valt uit ELK bereikfilter (.gte/.lte laat
  // NULL stil vallen): geen kwartaalpakket, geen concept-aangifte, haar BTW telt nergens. Het
  // pakket waarschuwde er al over; dit scherm — dat het eindoordeel uitspreekt — wist er niets
  // van en kon dus 100% klaar melden terwijl er geld buiten beeld lag.
  const r = buildReadiness(perfect({ datelessInvoiceCount: 1 }));
  check("een dateloze factuur is een risico", r.risks.some((x) => /geen datum/i.test(x.title)));
  check("het risico legt uit wat er misgaat", r.risks.some((x) => /geen enkel kwartaal/i.test(x.detail ?? "")));
  check("de score kan geen 100 meer zijn", r.score < 100);

  // Maar het is bewust GEEN blokkade: de telling is all-time, dus een harde stop zou al
  // ingediende kwartalen voorgoed rood zetten — ook op het werkbord van de boekhouder.
  check("het blokkeert 'klaar' niet", !r.missing.some((x) => /geen datum/i.test(x.title)));

  // En zonder dateloze facturen verandert er niets aan het schone kwartaal.
  const schoon = buildReadiness(perfect({ datelessInvoiceCount: 0 }));
  check("nul dateloos → geen risico", !schoon.risks.some((x) => /geen datum/i.test(x.title)));
  check("nul dateloos → gewoon 100", schoon.score === 100);
}

console.log("\n— [READINESS-DEGRADE] a check that did not run is not a check that passed —");
{
  // The baseline is READY. One unread input must take that away, whatever the score says.
  const r = buildReadiness(perfect({ unverified: [{ key: "bank_continuity", label: "de aansluiting van je bankafschriften" }] }));
  check("not ready when a read did not happen", r.ready === false && r.status !== "ready");
  check("verified is false", r.verified === false);
  check("the unread input is listed by key", r.unverified.some((u) => u.key === "bank_continuity"));
  check("…and named as a GAP, first in the list", r.missing[0]?.title === "Niet alles kon worden gecontroleerd");
  check("…with the phrase the owner reads", /aansluiting van je bankafschriften/.test(r.missing[0]?.detail ?? ""));
  check("the score is never a perfect 100 beside it", r.score <= 99);
  check("the measured dimensions stay measured (all four still applicable)", r.dimensions.every((d) => d.applicable));
  check("a note says the verdict is incomplete", r.notes.some((n) => /onvolledig/.test(n)));
  const clean = buildReadiness(perfect({ unverified: [] }));
  check("an empty list changes nothing", clean.ready === true && clean.verified === true && clean.unverified.length === 0);
  const twice = buildReadiness(perfect({ unverified: [{ key: "x", label: "iets" }, { key: "x", label: "iets" }] }));
  check("the same key is named once", ((twice.missing[0]?.detail ?? "").match(/iets/g) ?? []).length === 1);
}

console.log("\n— [READINESS-DEGRADE] a failed evidence lookup accuses nobody, and keeps the verdict off green —");
{
  // 40 verified, 30 with evidence, 10 whose lookup FAILED: nobody is missing a document that we know of.
  const r = buildReadiness(perfect({ verifiedInvoiceCount: 40, invoicesWithEvidence: 30, evidenceUncheckedCount: 10 }));
  check("no 'missen het originele document' gap for invoices we could not look at",
    !r.missing.some((m) => /missen het originele document/.test(m.title)));
  check("the unchecked invoices are an unread input", r.unverified.some((u) => u.key === "evidence" && /10 inkoopfacturen/.test(u.label)));
  check("…so the verdict is not ready", r.ready === false && r.verified === false);
  check("the invoices dimension earns no point for them (30 of 40)", r.dimensions[0].subscore === 0.75);
  check("…and says so in its detail", /Van 10 kon de bijlage niet worden gecontroleerd/.test(r.dimensions[0].detail));
  // 40 verified, 30 with evidence, 4 unchecked → 6 are genuinely missing.
  const mixed = buildReadiness(perfect({ verifiedInvoiceCount: 40, invoicesWithEvidence: 30, evidenceUncheckedCount: 4, missingEvidence: ["a", "b", "c", "d", "e", "f"] }));
  check("only the invoices we DID read are accused", mixed.missing.some((m) => m.title === "6 facturen missen het originele document"));
  check("an unchecked count larger than the gap cannot go negative",
    buildReadiness(perfect({ verifiedInvoiceCount: 40, invoicesWithEvidence: 40, evidenceUncheckedCount: 99 })).unverified.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
