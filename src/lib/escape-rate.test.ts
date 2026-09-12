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

// ── THE COVERAGE MAP, and it is not all green ───────────────────────────────────────────────────
//
// The money field has THREE witnesses from outside the reader: is the number in the document's
// text (totalGrounding), is it where a total is printed (totalPlacement), and does the supplier's
// own structured data agree (eInvoiceContradicts). The date and the supplier have NONE. They are
// checked only against the reader's own confidence in itself — and a reader that misreads
// 01-02-2026 as 02-01-2026 is not unsure, it is confident and wrong.
//
// A wrong date does not change any amount, so nothing downstream contradicts it: it moves the cost
// and its voorbelasting into the wrong quarter, which surfaces as a correction to an aangifte that
// was already filed. This test PINS that gap rather than asserting it away, so it shows up in the
// coverage map instead of being discovered by an accountant.
test("[ESCAPE-RATE] a confidently-wrong date has no outside witness — documented gap", () => {
  const confidentlyWrongDate = clean({
    // Everything the gate can see says "excellent read". Only the date is wrong, and the reader
    // does not know it: day and month swapped, still a valid date, high self-confidence.
    health: h({ invoice_date: "2026-10-05" }),   // the document says 05-10; this books October
  });
  const d = shouldAutoAdvanceInvoice(confidentlyWrongDate);
  assert.equal(d.advance, true,
    "if this now HOLDS, an outside witness for the date was added — update docs/ESCAPE_RATE.md and delete this pin");
  assert.equal(d.reason, "clean_high_confidence");
});

test("[ESCAPE-RATE] and so does a confidently-wrong supplier — documented gap", () => {
  // Same shape: the vendor string is wrong but the reader is sure. Nothing outside it disagrees,
  // because no amount changes. Lands the cost on the wrong crediteur.
  const d = shouldAutoAdvanceInvoice(clean());
  assert.equal(d.advance, true,
    "if this now HOLDS, a vendor witness was added — update docs/ESCAPE_RATE.md and delete this pin");
});
