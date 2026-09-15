// [AUTO-ADVANCE] Pure node test — run: npx tsx src/lib/auto-advance.test.ts
// The bar for auto-booking without a human is HIGH. These tests pin exactly when an invoice may
// skip the verify tap — and, more importantly, every case where it must NOT.
import { shouldAutoAdvanceInvoice, type AutoAdvanceSignals } from "./auto-advance";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A perfectly-read, arithmetic-clean, high-confidence ordinary invoice.
const clean = (over: Partial<AutoAdvanceSignals> = {}): AutoAdvanceSignals => ({
  is_invoice: true,
  is_statement: false,
  is_reminder: false,
  is_credit_note: false,
  document_kind: "invoice",
  invoice_type: "factuur",
  confidence: 0.95,
  totalIncBtw: 121,
  forcedDuplicate: false,
  health: {
    total_ex_btw: 100,
    btw_amount: 21,
    total_inc_btw: 121,
    invoice_date: "2026-05-10",
    invoice_number: "2026-0042",
    invoice_type: "factuur",
    field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
  },
  ...over,
});

console.log("\n— a clean, confident, ordinary invoice ADVANCES —");
{
  const d = shouldAutoAdvanceInvoice(clean());
  check("advance = true", d.advance === true);
  check("reason names it clean", d.reason === "clean_high_confidence");
}

console.log("\n— never auto-book a statement / reminder / creditnota —");
{
  check("statement flag → blocked", shouldAutoAdvanceInvoice(clean({ is_statement: true })).advance === false);
  check("reminder flag → blocked", shouldAutoAdvanceInvoice(clean({ is_reminder: true })).advance === false);
  check("credit-note flag → blocked", shouldAutoAdvanceInvoice(clean({ is_credit_note: true })).advance === false);
  check("invoice_type creditnota → blocked", shouldAutoAdvanceInvoice(clean({ invoice_type: "creditnota", health: { ...clean().health, invoice_type: "creditnota" } })).advance === false);
  check("document_kind statement → blocked", shouldAutoAdvanceInvoice(clean({ document_kind: "statement" })).advance === false);
  // [AANSLAG] A tax letter decides where money books — the owner's call, never the app's.
  check("tax letter → blocked", shouldAutoAdvanceInvoice(clean({ tax_kind: "inkomstenbelasting" })).reason === "tax_letter");
  check("garbage tax_kind is not a tax letter", shouldAutoAdvanceInvoice(clean({ tax_kind: "nonsense" })).advance === true);
}

console.log("\n— never auto-book an ambiguous read (needs-review) —");
{
  check("missing total → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, total_inc_btw: null } })).advance === false);
  check("€0 total → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, total_inc_btw: 0 } })).advance === false);
  check("arithmetic mismatch (ex+btw≠inc) → blocked",
    shouldAutoAdvanceInvoice(clean({ health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 200, invoice_date: "2026-05-10", invoice_number: "X1", invoice_type: "factuur", field_confidence: null } })).advance === false);
  check("missing date → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, invoice_date: null } })).advance === false);
  check("missing/placeholder number → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, invoice_number: "EMAIL-1717000000000" } })).advance === false);
}

console.log("\n— [BTW-GATE] a zero BTW auto-books ONLY when the read is explicitly 0% —");
{
  // 21% invoice misread as ex==incl, btw 0: arithmetic passes (100+0=100... here 121+0), but the
  // voorbelasting is silently zeroed → must be held for a human, not auto-booked.
  const zeroBtw = { total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-0042", invoice_type: "factuur", field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 } };
  const missingRate = shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: null }));
  check("zero btw + no explicit rate → blocked", missingRate.advance === false && missingRate.reason === "zero_btw_not_explicit_zero_rate");
  check("zero btw + rate 21 (inconsistent) → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: 21 })).advance === false);
  // A genuine 0%/vrijgesteld invoice (explicit rate 0) still auto-advances.
  check("zero btw + explicit rate 0 → advances", shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: 0 })).advance === true);
  // A normal invoice with real btw is unaffected (regardless of the rate field).
  check("non-zero btw + null rate → advances (unaffected)", shouldAutoAdvanceInvoice(clean({ btwRate: null })).advance === true);
}

console.log("\n— confidence bar is HIGHER than the 0.7 review line —");
{
  // 0.75 would pass import-health's 0.7 'clean' but must NOT auto-book (below HIGH_CONF 0.8).
  const d = shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, field_confidence: { vendor: 0.75, invoice_number: 0.95, invoice_date: 0.95, amount: 0.95 } } }));
  check("a 0.75 field score → blocked (below the high bar)", d.advance === false && d.reason === "field_confidence_below_high_bar");
  check("low overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: 0.5 })).advance === false);
  check("is_invoice false → blocked", shouldAutoAdvanceInvoice(clean({ is_invoice: false })).advance === false);
}

console.log("\n— [FIX] fail-CLOSED on missing signals (the review found these holes) —");
{
  // A null overall confidence must NOT advance (was fail-open).
  check("null overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: null })).advance === false);
  check("undefined overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: undefined })).advance === false);
  // No real gross (only an 'amount' fallback would have priced it) → blocked.
  check("no reliable total_inc_btw → blocked", shouldAutoAdvanceInvoice(clean({ totalIncBtw: null })).advance === false);
  check("zero total_inc_btw → blocked", shouldAutoAdvanceInvoice(clean({ totalIncBtw: 0 })).advance === false);
  // A duplicate the owner forced past the warning must never auto-book.
  check("forced duplicate → blocked", shouldAutoAdvanceInvoice(clean({ forcedDuplicate: true })).advance === false);
}

console.log("\n— [FIX] missing amount confidence does NOT skip the money gate —");
{
  // No amount score present + only ordinary overall confidence → blocked (must be VERY high).
  const noAmt = { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99 };
  const d = shouldAutoAdvanceInvoice(clean({ confidence: 0.8, health: { ...clean().health, field_confidence: noAmt } }));
  check("no amount score + overall 0.8 → blocked", d.advance === false && d.reason === "no_amount_confidence_and_overall_not_very_high");
  // No amount score but VERY high overall (≥0.9) → allowed.
  const d2 = shouldAutoAdvanceInvoice(clean({ confidence: 0.95, health: { ...clean().health, field_confidence: noAmt } }));
  check("no amount score + overall 0.95 → advance", d2.advance === true);
  // An amount score BETWEEN the review line (0.7) and the HIGH bar (0.8) passes health but must
  // be blocked by the auto-book money gate.
  const d3 = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.75 } } }));
  check("amount score 0.75 → blocked by the high money gate", d3.advance === false && d3.reason === "amount_confidence_below_high_bar");
  // A clearly-low amount score (below 0.7) is caught earlier by health → needs_review (still blocked).
  const d4 = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.6 } } }));
  check("amount score 0.6 → blocked (by health needs_review)", d4.advance === false);
}

console.log("\n— [FIND-GAP] a HIGH amount score must not mask a LOW gross (total_inc_btw) score —");
{
  // The bug: `.find` took the FIRST present of [amount, total, total_inc_btw]. A high `amount` (0.96)
  // masked a below-HIGH `total_inc_btw` (0.75) — and total_inc_btw is the value that actually becomes
  // the booked gross. 0.75 sits in the [0.7 health line, 0.8 high bar) band: health passes it, so the
  // ONLY thing that can catch it is this money gate. Now the MINIMUM of present money scores must
  // clear the high bar (fail-closed), so the low gross score is no longer masked by the high amount.
  const masked = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, total_inc_btw: 0.75 } } }));
  check("high amount + below-HIGH total_inc_btw → blocked (min money score gate)", masked.advance === false && masked.reason === "amount_confidence_below_high_bar");
  // Same with a below-HIGH `total` behind a high `amount`.
  const maskedTotal = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.95, total: 0.75 } } }));
  check("high amount + below-HIGH total → blocked", maskedTotal.advance === false && maskedTotal.reason === "amount_confidence_below_high_bar");
  // All money scores high → still advances (no false block).
  const allHigh = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, total: 0.95, total_inc_btw: 0.92 } } }));
  check("all money scores high → advances", allHigh.advance === true);
}

console.log("\n— a clean invoice with NO per-field scores needs VERY-high overall (no free pass) —");
{
  const d = shouldAutoAdvanceInvoice(clean({ confidence: 0.95, health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-9", invoice_type: "factuur", field_confidence: null } }));
  check("no field_confidence + very-high overall + clean amounts → advance", d.advance === true);
  const d2 = shouldAutoAdvanceInvoice(clean({ confidence: 0.72, health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-9", invoice_type: "factuur", field_confidence: null } }));
  check("no field_confidence + only 0.72 overall → blocked", d2.advance === false);
}

console.log("\n— [DEDUP-SOFT] a POSSIBLE duplicate can NEVER auto-book (held for a human) —");
{
  // The cardinal guarantee: even a perfectly-read, high-confidence invoice must be BLOCKED from
  // auto-advancing once it carries the possible-duplicate flag — otherwise a silent second cost.
  // shouldAutoAdvanceInvoice gates on classifyImportHealth(level==='clean'); _safecore.possible_duplicate
  // makes it needs-review, so this holds for the intake + email-sync paths that drive auto-advance.
  const flagged = shouldAutoAdvanceInvoice(clean({
    health: {
      ...clean().health,
      field_confidence: {
        vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96,
        _safecore: { possible_duplicate: true, possible_duplicate_of: "F-2001", possible_duplicate_reason: "zelfde bedrag en datum" },
      },
    },
  }));
  check("possible-dup flag → NOT auto-booked", flagged.advance === false && flagged.reason === "needs_review");
  // And without the flag, the identical invoice DOES advance — proving the flag is what blocks it.
  const same = shouldAutoAdvanceInvoice(clean());
  check("same invoice without the flag → advances (flag is the cause)", same.advance === true);
}

console.log("\n— [CREDIT-PREFIX-GATE] a credit-numbered document never books itself —");
{
  // CREDITFACTUUR CR0301267, exactly as the reader delivered it: is_credit_note FALSE (the model
  // missed it), document_kind "invoice", a breakdown that reconciles to the cent (31,07 + 2,80 =
  // 33,87) and a confident read. Every gate above it says fine. Before this axis existed it
  // auto-booked as a € 33,87 debt — money the supplier owed the owner, entered as money owed to
  // the supplier, with its btw ADDED to the reclaim and no human ever asked.
  const cr = shouldAutoAdvanceInvoice(clean({
    totalIncBtw: 33.87,
    health: {
      total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
      invoice_date: "2026-07-02", invoice_number: "CR0301267", invoice_type: "factuur",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("CR0301267 → held for a human", cr.advance === false && cr.reason === "needs_review");

  // The same invoice under an ordinary number DOES advance — so the number is provably the cause,
  // and this test cannot pass on a gate that has simply stopped advancing anything.
  const re = shouldAutoAdvanceInvoice(clean({
    totalIncBtw: 33.87,
    health: {
      total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
      invoice_date: "2026-07-02", invoice_number: "RE0803119", invoice_type: "factuur",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("same amounts, ordinary number → advances (the prefix is the cause)", re.advance === true);

  // A credit note that is ALREADY booked right must not wear a permanent amber badge for being
  // correct. It is held by the is_credit_note / invoice_type rule above, not by this axis.
  const booked = shouldAutoAdvanceInvoice(clean({
    is_credit_note: true, invoice_type: "creditnota", totalIncBtw: -33.87,
    health: {
      total_ex_btw: -31.07, btw_amount: -2.8, total_inc_btw: -33.87,
      invoice_date: "2026-07-02", invoice_number: "CR0301267", invoice_type: "creditnota",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("an already-booked creditnota is held as 'creditnota', not as a defect", booked.reason === "creditnota");

  // The kassabon placeholder the camera path writes is held by the PLACEHOLDER rule that was
  // already there — not by this axis. Locked as "still held, for the older reason", because a new
  // gate that quietly takes credit for an existing one hides the day the older one breaks.
  // That "CAMERA" is not read as a credit prefix is asserted directly in creditnota-signal.test.ts.
  const bon = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, invoice_number: "CAMERA-1784373759249" },
  }));
  check("a CAMERA-… bon placeholder is still held (placeholder rule)", bon.advance === false && bon.reason === "needs_review");
}


// ─────────────────────────────────────────────────────────────────────────────
// [E-FACTUUR-BESLECHT] Wanneer de leverancier het bedrag zelf meestuurde
//
// Drie poorten in deze functie bewaken één ding: dat een BEDRAG van een pagina is GELEZEN en dat
// een lezing fout kan zijn — de tekstcontrole, de plaatsingscontrole, en de zekerheidsscore van de
// lezer over zijn eigen geld. Bij een volledige, consistente e-factuur die tot op de cent klopt met
// de lezing, is er geen pagina die verkeerd gelezen kan zijn. Dan bewaken die drie niets meer.
//
// Wat hieronder wordt vastgelegd is vooral wat NIET verandert. Een schrapping die één as sluit is
// goed; een schrapping die stilletjes een deur opent is de duurste fout die dit bestand kan maken.
// Elke test hier die met "nog steeds" begint is die deur, op slot.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n— [E-FACTUUR-BESLECHT] de leverancier stuurde zijn eigen cijfers mee —");
{
  const efact = (over: Record<string, unknown> = {}) => ({
    totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: "cii", contradicts: false, ...over,
  });

  // Een lezer die zijn eigen bedrag NIET vertrouwt (0.42), op een foto zonder tekstlaag, met een
  // totaal dat nergens te vinden is. Zonder e-factuur wacht deze terecht op een mens.
  const onzeker = {
    confidence: 0.95,
    totalGrounding: "absent" as const,
    health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.42 } },
  };

  const zonder = shouldAutoAdvanceInvoice(clean(onzeker));
  check("zonder e-factuur wacht een onzeker gelezen bedrag op een mens", zonder.advance === false);

  const met = shouldAutoAdvanceInvoice(clean({
    ...onzeker,
    health: { ...onzeker.health, field_confidence: { ...onzeker.health.field_confidence, _einvoice: efact() } },
  }));
  check("mét een kloppende e-factuur boekt dezelfde factuur zichzelf", met.advance === true);
  check("en wel als 'clean_high_confidence'", met.reason === "clean_high_confidence");

  // De plaatsingspoort — dezelfde redenering, andere as.
  const plaatsing = shouldAutoAdvanceInvoice(clean({
    totalPlacement: "present",
    health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact() } },
  }));
  check("een bedrag dat niet staat waar een totaal hoort, maar wél in de e-factuur staat, boekt", plaatsing.advance === true);

  // ── En nu de deuren die dicht MOETEN blijven ──────────────────────────────

  const tegenspraak = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact({ contradicts: true }) } },
    eInvoiceContradicts: true,
  }));
  check("een e-factuur die het gelezen bedrag TEGENSPREEKT blokkeert nog steeds", tegenspraak.advance === false);
  check("en zegt waarom", tegenspraak.reason === "e_invoice_contradicts_read");

  const aanmaning = shouldAutoAdvanceInvoice(clean({
    is_reminder: true,
    health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact() } },
  }));
  check("een aanmaning met geldige XML wacht nog steeds op een mens", aanmaning.advance === false && aanmaning.reason === "reminder");

  const credit = shouldAutoAdvanceInvoice(clean({
    invoice_type: "creditnota",
    health: { ...clean().health, invoice_type: "creditnota", field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact() } },
  }));
  check("een creditnota met geldige XML wacht nog steeds", credit.advance === false && credit.reason === "creditnota");

  const geforceerd = shouldAutoAdvanceInvoice(clean({
    forcedDuplicate: true,
    health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact() } },
  }));
  check("een doorgedrukte dubbele wacht nog steeds", geforceerd.advance === false && geforceerd.reason === "forced_duplicate");

  // De e-factuur zegt niets over de LEVERANCIER, het NUMMER of de DATUM — parseEInvoice
  // controleert die niet. Die assen blijven dus precies zo streng als ze waren.
  const onzekereLeverancier = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { vendor: 0.31, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact() } },
  }));
  check("een onzekere LEVERANCIER wacht nog steeds — XML vouwt daar niet voor in", onzekereLeverancier.advance === false);

  const nulBtw = shouldAutoAdvanceInvoice(clean({
    btwRate: null,
    health: { ...clean().health, btw_amount: 0, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, _einvoice: efact({ btwAmount: 0 }) } },
  }));
  check("nul btw zonder expliciet 0%-tarief wacht nog steeds", nulBtw.advance === false && nulBtw.reason === "zero_btw_not_explicit_zero_rate");

  // [NUL-BTW-STIL] Een VERLEGDE factuur draagt geen BTW en geen tarief omdat dat correct is; die
  // werd hier vastgehouden onder een leesfout die niet bestond. Rubriek 2a doet er een laag verder
  // wel iets mee — het document zelf is compleet.
  const verlegd = shouldAutoAdvanceInvoice(clean({
    btwRate: null,
    health: {
      ...clean().health,
      btw_amount: 0,
      field_confidence: {
        vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96,
        _einvoice: efact({ btwAmount: 0 }),
        _btw_verlegd: { grondslag: 100 },
      },
    },
  }));
  check("een verlegde factuur wordt niet vastgehouden op een nul-BTW", verlegd.reason !== "zero_btw_not_explicit_zero_rate");

  // Rommel in _einvoice is geen e-factuur. eInvoiceOf valideert; een half object leest als niets,
  // en "niets" mag nooit als "beslecht" gelden — anders is dit een poort die je kunt omzeilen door
  // onzin op te slaan.
  for (const rommel of [{}, { totalIncBtw: 121 }, { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: "xml" }, null, "ja"]) {
    const d = shouldAutoAdvanceInvoice(clean({
      ...onzeker,
      health: { ...onzeker.health, field_confidence: { ...onzeker.health.field_confidence, _einvoice: rommel } },
    }));
    check(`onleesbare _einvoice (${JSON.stringify(rommel)}) beslecht niets`, d.advance === false);
  }
}

console.log("\n— [ONGEGROND-AFGELEID] a gross the app derived never books unattended —");
{
  // The reader returned ex + btw and no total; the pipeline derived incl = ex + btw AFTER the
  // grounding gate ran, so the grounding verdict for the total is 'unreadable' (blocks nothing)
  // and the identity holds by construction (checks nothing). The gross that would book was never
  // compared against the paper.
  const derived = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { ...clean().health.field_confidence, _total_derived: "total" as const } },
  }));
  check("derived total → blocked", derived.advance === false);
  check("…with its own reason", derived.reason === "total_derived_never_grounded");
  // A derived EX is different: the total existed and WAS grounded; ex = incl − btw is arithmetic
  // over two grounded figures. This rule leaves it alone (other gates still apply).
  check("derived excl alone does not trip THIS rule",
    shouldAutoAdvanceInvoice(clean({
      health: { ...clean().health, field_confidence: { ...clean().health.field_confidence, _total_derived: "excl" as const } },
    })).reason !== "total_derived_never_grounded");
}

// [VREEMDE-VALUTA] Een factuur in een andere munt boekt nooit vanzelf, en een factuur die niets
// over een munt zei verandert niet van gedrag — dat laatste is 100 % van alles wat er nu ligt.
{
  const fc = () => ({ ...clean().health.field_confidence });
  const dollar = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { ...fc(), _valuta: { code: "USD" } } },
  }));
  check("een dollarfactuur wordt vastgehouden", dollar.advance === false && dollar.reason === "foreign_currency");

  const euro = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { ...fc(), _valuta: { code: "EUR" } } },
  }));
  check("een expliciete euro houdt niets tegen", euro.reason !== "foreign_currency");

  // De belangrijkste: geen munt gelezen is geen reden. Zou dit vastgehouden worden, dan stond de
  // hele verwerkingsstraat stil op documenten die nooit iets over een munt hebben gezegd.
  check("geen munt gelezen → geen vreemde-valutablokkade",
    shouldAutoAdvanceInvoice(clean()).reason !== "foreign_currency");
}

// [ZELFFACTUUR] Het woord op het papier houdt het document tegen; het beslist niets.
{
  const fc = () => ({ ...clean().health.field_confidence });
  const zelf = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, field_confidence: { ...fc(), _zelffactuur: true } },
  }));
  check("een zelffactuur boekt nooit vanzelf", zelf.advance === false && zelf.reason === "self_billed");
  check("zonder dat woord verandert er niets", shouldAutoAdvanceInvoice(clean()).reason !== "self_billed");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
