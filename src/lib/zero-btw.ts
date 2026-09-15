// src/lib/zero-btw.ts
// [NUL-BTW-STIL] One question, asked in one place: is a ZERO btw on this document explained by
// the document, or is it a hole we read as a number?
//
// The two answers cost different money and look identical in the row. `btw_amount = 0` on a
// vrijgestelde or verlegde factuur is the truth. `btw_amount = 0` because the split was never
// read — the [SILENT-LOSS] gross-as-net fallback, which every ingestion door falls back to —
// is voorbelasting the owner is entitled to and will never see again: the identity holds
// (ex + 0 = incl), so the arithmetic gate is silent, import health reads clean, and nothing on
// any screen ever mentions it.
//
// The rule already existed, inline, in auto-advance.ts's [BTW-GATE] — which is why the verify
// queue never auto-books such a row. It lives here so the doors that DON'T pass through that
// queue can ask the same question instead of each inventing an answer.

/** What a caller knows about one document's BTW. Every field optional: absent is not zero. */
export interface ZeroBtwInput {
  /** The gross the row will carry. A zero BTW is only interesting on a materially-priced document. */
  totalIncBtw?: number | null;
  /** The BTW that will be BOOKED — after any fallback the caller applied, not the raw read. */
  btwAmount?: number | null;
  /** The rate the reader EXPLICITLY read (0 | 9 | 21). Absent means no rate was read, not 0 %. */
  btwRate?: number | null;
  /** [VERLEGD-NAAR-MIJ] The supplier shifted the BTW to this owner: no BTW and no rate is correct. */
  shifted?: boolean;
}

/**
 * True when the document carries no BTW and gives no reason for it — the case where a zero is a
 * missing reading rather than a fact. Conservative by construction: any explanation at all
 * (an explicit 0 % rate, a reverse charge, an immaterial total, a BTW that is actually non-zero)
 * answers false. Pure.
 */
export function zeroBtwUnexplained(input: ZeroBtwInput): boolean {
  const gross = input.totalIncBtw;
  // No material money at stake: nothing to lose, nothing to say.
  if (typeof gross !== "number" || !Number.isFinite(gross) || Math.abs(gross) < 0.005) return false;

  const btw = input.btwAmount;
  // A BTW that could not be read at all is a hole too, and answers here for the same reason a
  // read zero does: whatever the row ends up booking, it books no voorbelasting.
  if (typeof btw === "number" && Math.abs(btw) >= 0.005) return false;

  // The document says 0 % — a genuine vrijgestelde or 0-tarief factuur. Nothing was lost.
  if (input.btwRate === 0) return false;

  // The document says the BTW went to the owner instead. Also correct as it stands; rubriek 2a
  // picks it up one layer on. Without this, every verlegde factuur is held for a reason that
  // does not apply to it.
  if (input.shifted === true) return false;

  return true;
}
