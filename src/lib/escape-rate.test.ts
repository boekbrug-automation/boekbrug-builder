// src/lib/escape-rate.test.ts — run: npx tsx --test src/lib/escape-rate.test.ts
//
// [ESCAPE-RATE] Can a WRONG read book itself?
//
// This is not a test of the reader. It is a test of the guard between the reader and the ledger,
// and it needs no corpus: shouldAutoAdvanceInvoice is pure, so a known-wrong extraction can be
// handed to it directly and the answer read off.
//
// The distinction the whole gate rests on:
//   · a wrong value that is HELD costs the owner a tap        → automation cost
//   · a wrong value that AUTO-BOOKS costs a corrected aangifte → accounting error
// They are not two sizes of the same failure and must never be averaged into one "accuracy".
//
// Each case below is a way an invoice reader is wrong in the field, phrased as the signals the
// pipeline would actually carry. `hold: true` means the gate must refuse. See docs/ESCAPE_RATE.md.
import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoAdvanceInvoice, type AutoAdvanceSignals } from "./auto-advance";
import { verifyDate } from "./document-verify";

const clean = (over: Partial<AutoAdvanceSignals> = {}): AutoAdvanceSignals => ({
  is_invoice: true, is_statement: false, is_reminder: false, is_credit_note: false,
  document_kind: "invoice", invoice_type: "factuur", confidence: 0.95,
  totalIncBtw: 121, forcedDuplicate: false,
  health: {
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: "2026-05-10", invoice_number: "2026-0042", invoice_type: "factuur",
    field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
  },
  ...over,
});
const h = (over: Record<string, unknown>) => ({ ...clean().health, ...over });

type Case = { veld: string; naam: string; signals: AutoAdvanceSignals };

/** Wrong reads the gate MUST hold. An advance here is a silent accounting error. */
const MOETEN_WACHTEN: Case[] = [
  // ── amount ───────────────────────────────────────────────────────────────────────────────────
  { veld: "amount", naam: "subtotal read as the total — the number is printed, but not as a total",
    signals: clean({ totalPlacement: "present", totalGrounding: "found" }) },
  { veld: "amount", naam: "a total the document does not contain at all",
    signals: clean({ totalGrounding: "absent" }) },
  { veld: "amount", naam: "ex+btw do not add up to inc",
    signals: clean({ health: h({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 200 }) }) },
  { veld: "amount", naam: "no total at all",
    signals: clean({ totalIncBtw: null, health: h({ total_inc_btw: null }) }) },
  { veld: "amount", naam: "the supplier's own e-invoice disagrees with the page",
    signals: clean({ eInvoiceContradicts: true }) },
  // ── btw ──────────────────────────────────────────────────────────────────────────────────────
  { veld: "btw", naam: "21% invoice read as ex==incl, btw silently zeroed",
    signals: clean({ btwRate: null, health: h({ total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121 }) }) },
  { veld: "btw", naam: "the document prints a different split from the one read",
    signals: clean({ btwContradictsDocument: true }) },
  // ── document type — a credit note booked as a cost inverts the sign of the deduction ─────────
  { veld: "type", naam: "credit note read as an invoice", signals: clean({ is_credit_note: true }) },
  { veld: "type", naam: "statement read as an invoice", signals: clean({ is_statement: true }) },
  { veld: "type", naam: "payment reminder read as a second invoice", signals: clean({ is_reminder: true }) },
  { veld: "type", naam: "Belastingdienst letter read as a supplier invoice",
    signals: clean({ tax_kind: "omzetbelasting" }) },
  // ── date & number: caught only through the reader's own confidence ───────────────────────────
  { veld: "date", naam: "no date read at all", signals: clean({ health: h({ invoice_date: null }) }) },
  { veld: "date", naam: "the reader itself is unsure of the date",
    signals: clean({ health: h({ field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.42, amount: 0.96 } }) }) },
  { veld: "number", naam: "fabricated placeholder number",
    signals: clean({ health: h({ invoice_number: "EMAIL-1717000000000" }) }) },
  { veld: "supplier", naam: "the reader itself is unsure of the vendor",
    signals: clean({ health: h({ field_confidence: { vendor: 0.30, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 } }) }) },
  // The vendor's OUTSIDE witness, and the reason this row exists: the reader is fully confident and
  // the document's own text does not contain the name it returned. That is the BALKIP case —
  // an invoice from one company booked under another, every amount read correctly — and
  // vendor-grounding.ts is what sees it.
  { veld: "supplier", naam: "a confident vendor name that is nowhere in the document's text",
    signals: clean({ health: h({ field_confidence: {
      vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96,
      _vendorGrounding: { verdict: "absent", name: "GROOTHANDEL M.H. BAL V.O.F." },
    } }) }) },
  // ── consent ──────────────────────────────────────────────────────────────────────────────────
  { veld: "duplicate", naam: "a duplicate the owner forced past the warning",
    signals: clean({ forcedDuplicate: true }) },
];

test("[ESCAPE-RATE] no known-wrong read books itself", () => {
  const ontsnapt = MOETEN_WACHTEN
    .map((c) => ({ c, d: shouldAutoAdvanceInvoice(c.signals) }))
    .filter((x) => x.d.advance)
    .map((x) => `${x.c.veld}: ${x.c.naam}`);
  assert.deepEqual(ontsnapt, [],
    "these wrong reads reach the ledger with no human in the loop:\n  " + ontsnapt.join("\n  "));
});

test("[ESCAPE-RATE] the gate still lets a clean invoice through — a hold-everything gate is not a gate", () => {
  // The other half of the measurement. A guard that refuses everything has an escape rate of zero
  // and is worthless; the hold rate is what keeps this honest.
  const d = shouldAutoAdvanceInvoice(clean());
  assert.equal(d.advance, true, "a clean, grounded, arithmetic-consistent invoice must auto-book");
});

// ── THE COVERAGE MAP, and the one square that is genuinely empty ────────────────────────────────
//
// An earlier version of this file said the date and the supplier had NO witness outside the reader.
// Both halves were wrong, and re-checking them is what produced the finding below.
//
//   · THE SUPPLIER HAS ONE, AND IT HOLDS.  vendor-grounding.ts asks whether the name the reader
//     returned is printed in the document's own text; import-health.ts turns an 'absent' verdict
//     into flags.vendor, and the invoice waits. That case is asserted in MOETEN_WACHTEN above,
//     where it belongs — not pinned here as a gap.
//
//   · THE DATE HAS ONE TOO, AND NOTHING LISTENS.  document-verify.ts::verifyDate compares the
//     stored date with every form the paper might print it in, and it CATCHES the day/month swap —
//     the test below proves that against the real function. ai.ts stores the verdict as
//     _doccheck.date. Then it stops: _doccheck.total has placementOf() and the auto-booking doors
//     ask it, _doccheck.btwContradiction has btwContradictionOf() and they ask that too, and
//     _doccheck.date has no reader at all. import-health.ts pushes a sentence for the owner and
//     sets no flag, so shouldAutoAdvanceInvoice never sees it.
//
// So the gap is not a missing witness. It is a witness whose testimony reaches the screen and not
// the gate — which is a different and much cheaper thing to fix, and it is pinned as such.
//
// Why it has not simply been wired up: measured on 12 September 2026, all seven 'absent' date
// verdicts in production were FALSE — English-language invoices whose date was correct (see
// [DOCCHECK-TAAL] in document-verify.test.ts). Wiring the veto that day would have held seven
// correct invoices and caught nothing. The language gap is now closed; the veto waits on a
// re-measurement, and docs/ESCAPE_RATE.md carries the query and the condition.

test("[ESCAPE-RATE] the date witness DOES see a confidently-wrong date", () => {
  // Not a mock. The real verifyDate, against a document that prints the Dutch date the reader
  // swapped: the paper says 1 February 2026, the reader returned 2 January 2026 — a valid date, a
  // confident read, and no amount changes, so nothing else in the app can contradict it.
  const paper = "FACTUUR\nGroothandel De Vries B.V.\nFactuurdatum: 01-02-2026\n" +
    "Factuurnummer: 2026-0042\nTotaal incl. btw  EUR 121,00\n";
  assert.equal(verifyDate("2026-01-02", paper), "absent", "the swap is visible to the witness");
  assert.equal(verifyDate("2026-02-01", paper), "found", "and the correct read is not flagged");
});

test("[ESCAPE-RATE] ...and the auto-booking gate never asks it — the one real gap", () => {
  // Same invoice, phrased as the signals the pipeline carries: the verdict IS stored, and the
  // decision is identical to one where the check never ran.
  const stored = clean({
    health: h({
      invoice_date: "2026-01-02",
      field_confidence: {
        vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96,
        _doccheck: { total: "anchored", date: "absent", invoiceNumber: "found", btwContradiction: null },
      },
    }),
  });
  const d = shouldAutoAdvanceInvoice(stored);
  assert.equal(d.advance, true,
    "if this now HOLDS, _doccheck.date was wired into the auto-booking door — " +
    "update docs/ESCAPE_RATE.md, move this case into MOETEN_WACHTEN and delete this pin");
  assert.equal(d.reason, "clean_high_confidence");
  // And the proof that it is the DATE being ignored rather than the whole blob: the same blob with
  // a bad TOTAL verdict does hold, through placementOf().
  const badTotal = clean({ totalPlacement: "present" });
  assert.equal(shouldAutoAdvanceInvoice(badTotal).advance, false,
    "_doccheck.total has a reader and a veto; _doccheck.date has neither");
});
