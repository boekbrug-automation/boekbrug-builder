// src/lib/btw-ongecontroleerd.ts
// [BTW-ONGECONTROLEERD] Reclaimed BTW that nothing in this app has been able to check.
// Pure, no I/O. Run: npx tsx --test src/lib/btw-ongecontroleerd.test.ts
//
// ── THE ONE CASE NO OTHER GATE SEES ──
//
// Every arithmetic check this app owns rests on one of two constraints:
//   · the identity — excl + btw = incl, which safecore enforces everywhere; and
//   · the RATE — 0, 9 or 21, the only ones that exist in the Netherlands.
//
// A MIXED-RATE invoice satisfies the first by construction and escapes the second: with 9 % and
// 21 % lines on one document the blended rate can legally be anything between them, so "12,4 %"
// proves nothing. The only witness left is the per-rate specification block, and btw-split.ts is
// the only thing that can read it.
//
// Which means: a blended invoice WITHOUT that block carries voorbelasting that no check in this
// app has ever verified, and it looks perfectly clean on every screen. Measured on the live
// administration: 31 incoming invoices carry a blended rate, 28 of them hold no block, and
// together they claim € 2.635,83 back.
//
// ── WHY IT IS A READINESS ITEM AND NOT A NEW SCREEN ──
//
// [SPLIT-ALSNOG] already built the way back: a re-read that checks the split and overwrites
// nothing, reachable from the invoice's own document sheet. The capability is not missing. What is
// missing is that nothing tells the owner WHICH of 608 invoices needs it — and the place they
// already ask "is this quarter safe to file?" is readiness, beside [GEEN-BTW-SOORT], which is the
// same species of doubt: BTW being reclaimed that may not be reclaimable.
//
// ── WHAT IT DOES NOT SAY ──
//
// Not that the amount is wrong. A blended rate is NORMAL on a wholesale invoice and most of these
// are almost certainly right. It says only that nothing checked it — which is exactly the register
// [IBAN-CHECK-HONEST] and [EIGEN-CONTROLE-ONBEKEND] use, and never a verdict the paper contradicts.

/** The three amounts and the evidence, as stored on one booked purchase invoice. */
export interface BtwCheckInput {
  totalExBtw?: number | null;
  btwAmount?: number | null;
  /**
   * A per-rate witness exists for this invoice. Two things can be one:
   *   · _btw_rows — the specification the SUPPLIER printed; or
   *   · [REGELS] _btw_rows_uit_regels — a split built from the invoice's own LINES, which is only
   *     ever recorded when it reproduced both printed anchors (see factuurregels.ts).
   * Either is a real check. Neither is a claim that the amount is right; both are a claim that
   * something independent agreed with it.
   */
  hasRateBlock?: boolean;
  /** [VERLEGD-NAAR-MIJ] A reverse charge carries no BTW of its own and is not this case. */
  shifted?: boolean;
}

/** The legal Dutch rates. A blend BETWEEN them is what makes a document unverifiable. */
const LEGAL_RATES = [0, 9, 21] as const;
/** Rounding on a real invoice drifts a few cents; a rate within this of a legal one IS that rate. */
const RATE_TOLERANCE = 0.6;

/**
 * Does this invoice reclaim BTW at a rate no legal rate explains, with no block to prove it?
 *
 * Conservative on every axis, because a false yes sends the owner to check an invoice that is
 * fine — and a readiness list that cries wolf is a readiness list nobody reads.
 */
export function btwUncheckable(input: BtwCheckInput): boolean {
  const ex = input.totalExBtw;
  const btw = input.btwAmount;
  if (typeof ex !== "number" || !Number.isFinite(ex) || Math.abs(ex) < 0.005) return false;
  if (typeof btw !== "number" || !Number.isFinite(btw)) return false;
  // Nothing reclaimed, nothing to doubt. A zero BTW has its own question — see zero-btw.ts.
  if (Math.abs(btw) < 0.005) return false;
  // The document explains itself: the per-rate block IS the check, and it ran.
  if (input.hasRateBlock === true) return false;
  // A reverse charge is a different mechanism entirely.
  if (input.shifted === true) return false;

  const rate = Math.abs((btw / ex) * 100);
  // Above the highest legal rate is not "unverifiable", it is WRONG — and the arithmetic gates
  // already refuse it. This module speaks only about the gap between the legal rates.
  if (rate > 21 + RATE_TOLERANCE) return false;
  return !LEGAL_RATES.some((legal) => Math.abs(rate - legal) <= RATE_TOLERANCE);
}
