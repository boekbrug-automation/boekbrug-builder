// src/lib/factuurregels.ts
// [REGELS] The invoice's own lines, and the constraint they give back.
// Pure, no I/O. Run: npx tsx --test src/lib/factuurregels.test.ts
//
// ── WHY THIS EXISTS, IN btw-split.ts's OWN WORDS ──
//
// "On a SINGLE-rate invoice there are two independent constraints: the sum identity, and the fact
// that btw/excl must be exactly 9% or exactly 21%. […] On a MIXED-rate invoice the second
// constraint evaporates. […] One constraint, three unknowns. The check does not fail — it stops
// existing, without saying so."
//
// That module's answer was the per-rate SUMMARY BLOCK, when the supplier prints one. Measured on
// the live administration, 28 booked purchase invoices have no block at all, and € 2.635,83 of
// voorbelasting rests on them with nothing whatsoever able to check it ([BTW-ONGECONTROLEERD]).
//
// But a document without a summary block still prints its LINES, and every line states its own
// rate. Grouping them per rate and multiplying gives a BTW that has to reproduce the printed
// total — and that is the second constraint, restored. Not from a block the supplier chose to
// print, but from the goods themselves.
//
// It is also the only way to read a receipt: an Albert Heijn bon with 9 % groceries and 21 %
// office supplies has no summary block and never will.
//
// ── WHAT IT REFUSES ──
//
// It DERIVES and then VERIFIES, and it overwrites nothing. A split that does not reproduce what
// the document printed is not a correction — it is evidence that something was misread, and this
// module hands back that refusal rather than a repaired number. Same rule the whole file tree
// keeps: never move one figure so the other two add up.
//
// And it is all-or-nothing per document. One line without a rate makes the whole grouping a guess
// about where that money belongs, and a guess in the voorbelasting column is the one this app may
// not make.

import { round2 } from "./invoice-totals";

/** One line as printed. Every field optional: a reader that could not see one may not invent it. */
export interface InvoiceLine {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  /** The rate stated ON THAT LINE. 0, 9 or 21 — nothing else is a Dutch rate. */
  btwRate?: number | null;
  /** The line total EXCLUDING btw, as printed. */
  amount?: number | null;
}

export interface LineSplitRow {
  rate: number;
  base: number;
  btw: number;
}

export type LineSplitRefusal =
  /** No lines to work from. */
  | "no_lines"
  /** A line carries no rate, or one that is not 0/9/21. Where its money belongs is then a guess. */
  | "rate_missing"
  /** A line carries no readable amount. */
  | "amount_missing"
  /** The lines do not add up to the base the document states. They are not a split OF it. */
  | "base_mismatch"
  /** The rates applied to the lines do not reproduce the printed BTW. Something was misread. */
  | "btw_mismatch";

export type LineSplitResult =
  | { ok: true; rows: LineSplitRow[]; btw: number }
  | { ok: false; reason: LineSplitRefusal };

/** The only rates that exist here. A line at 6 % is a misread, not a rate. */
const LEGAL_RATES = new Set([0, 9, 21]);
/** Per-line rounding drifts; a cent or two over a whole document is the paper, not an error. */
const TOLERANCE = 0.02;

/**
 * Group the lines per rate and check the result against what the document itself printed.
 *
 * Both anchors are required and both are checked: the base, so we know the lines describe this
 * document and not part of it; and the BTW, which is the constraint a mixed-rate invoice otherwise
 * loses. Passing both is real corroboration — misread one line and one of them breaks.
 */
export function splitFromLines(args: {
  lines: readonly InvoiceLine[] | null | undefined;
  /** The document's own excl total. */
  totalExBtw?: number | null;
  /** The document's own printed BTW. */
  btwAmount?: number | null;
}): LineSplitResult {
  const lines = args.lines ?? [];
  if (lines.length === 0) return { ok: false, reason: "no_lines" };

  const byRate = new Map<number, number>();
  for (const line of lines) {
    const rate = line.btwRate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || !LEGAL_RATES.has(rate)) {
      return { ok: false, reason: "rate_missing" };
    }
    const amount = line.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return { ok: false, reason: "amount_missing" };
    }
    byRate.set(rate, (byRate.get(rate) ?? 0) + amount);
  }

  const rows: LineSplitRow[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, base]) => ({ rate, base: round2(base), btw: round2((base * rate) / 100) }));

  // ── Anchor 1: the lines must add up to the base the document states.
  const base = args.totalExBtw;
  if (typeof base !== "number" || !Number.isFinite(base)) return { ok: false, reason: "base_mismatch" };
  const summedBase = rows.reduce((s, r) => s + r.base, 0);
  if (Math.abs(summedBase - base) > TOLERANCE) return { ok: false, reason: "base_mismatch" };

  // ── Anchor 2: the rates applied to those lines must reproduce the printed BTW. THIS is the
  //    constraint a mixed-rate invoice loses, and the whole reason this module exists.
  const summedBtw = round2(rows.reduce((s, r) => s + r.btw, 0));
  const printed = args.btwAmount;
  if (typeof printed !== "number" || !Number.isFinite(printed)) return { ok: false, reason: "btw_mismatch" };
  // Cent-drift scales with the number of rate groups, never with the number of lines: the rounding
  // happens once per group.
  if (Math.abs(summedBtw - printed) > TOLERANCE * Math.max(1, rows.length)) {
    return { ok: false, reason: "btw_mismatch" };
  }

  return { ok: true, rows, btw: summedBtw };
}
