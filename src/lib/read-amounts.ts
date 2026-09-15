// src/lib/read-amounts.ts
// [NUL-GRONDSLAG] What gets STORED when the reader could not read the split. Pure, no I/O.
// Run: npx tsx --test src/lib/read-amounts.test.ts
//
// Three ingestion doors wrote `verification.total_ex_btw ?? 0`. That is the Number(null) trap this
// repo warns about everywhere, at the one place it costs the most: an amount that was NOT READ is
// stored as a real zero, and a real zero on a purchase invoice is a CLAIM — this bill cost nothing.
//
// Measured on the live administration before this module existed: 46 incoming invoices carrying
// € 56.262,32 of gross stood with total_ex_btw = 0 and btw_amount = 0. Eleven suppliers, all
// wholesale and horeca — Enka Horeca, ATAPACK Cash & Carry, M.H. Bal Groothandel, Dutch Sweets,
// Sumer Food — i.e. exactly the mixed-rate 9 %/21 % invoices with a statiegeld line. Every one was
// held by the arithmetic gate (0 + 0 ≠ the gross, correctly), and the owner archived 45 of them.
//
// The engine reads cost from total_ex_btw (financial-result.ts), so had any of them been booked
// instead of archived, a € 4.917,90 bill would have entered the books as € 0 of kosten.
//
// The fallback is the one the bank-attach door already argued for and used ([SILENT-LOSS]): when
// no base was read, the GROSS becomes the net cost and the BTW is zero. The cost is then counted
// rather than silently dropped, and no voorbelasting is claimed on a document we could not read —
// the conservative direction on both axes. What it must never be is invisible: the zero BTW that
// comes out of it is exactly what zeroBtwUnexplained answers `true` to, so the row carries
// _btw_zero_unexplained and waits for a human like any other unexplained zero.
//
// It does NOT invent a split. Deriving 9 % or 21 % from a gross would put a number in the
// voorbelasting column that no document supports, which is the one direction that costs the owner
// their deduction if it is wrong.

// [NUL-BTW-STIL] The one question about a zero BTW, asked here too rather than restated.
import { zeroBtwUnexplained } from "./zero-btw";

/** The amounts as the reader returned them. Absent is absent; only a number is a number. */
export interface ReadAmounts {
  totalExBtw?: number | null;
  btwAmount?: number | null;
  totalIncBtw?: number | null;
  /** The reader's loose fallback figure, used only when no explicit gross was read. */
  amount?: number | null;
}

export interface StoredAmounts {
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  /**
   * The base is the GROSS because no base was read — a fact about our fallback, never about the
   * document. Callers use it to flag the row; nothing downstream may read it as "this invoice
   * carries no BTW".
   */
  baseFromGross: boolean;
}

/** A number we may store. NaN and Infinity are not amounts. */
function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn what was read into what may be stored, without ever storing an unread amount as zero.
 *
 * The gross is the invoice's own total, or the loose `amount` when no total was read. A base that
 * was read is kept exactly as read — this function repairs nothing and derives nothing; the
 * arithmetic gates elsewhere are what judge a split that does not add up.
 */
export function amountsToStore(read: ReadAmounts): StoredAmounts {
  const gross = num(read.totalIncBtw) ?? num(read.amount) ?? 0;
  const base = num(read.totalExBtw);

  if (base !== null) {
    // A base was read. Keep it, and keep the BTW beside it — an unread BTW stores as 0 because
    // that is what will be deducted, and zeroBtwUnexplained is what makes that visible.
    return { total_ex_btw: base, btw_amount: num(read.btwAmount) ?? 0, total_inc_btw: gross, baseFromGross: false };
  }

  // No base at all. The gross becomes the cost, and nothing is claimed back.
  return {
    total_ex_btw: gross,
    btw_amount: 0,
    total_inc_btw: gross,
    // No money, nothing lost: a gross of zero is not a fallback anybody needs to be told about.
    baseFromGross: Math.abs(gross) >= 0.005,
  };
}

/**
 * [NUL-GRONDSLAG] Mark a stored zero BTW that the document does not explain.
 *
 * The fallback above makes the arithmetic identity hold BY CONSTRUCTION (gross + 0 = gross), and
 * that is precisely the danger: before it, a base of 0 against a real gross failed the sum check
 * and the row was held with a reason. Trading a number that lies for one that is merely silent
 * would be no improvement at all. So the same register the bank-attach door uses carries it here —
 * import-health turns `_btw_zero_unexplained` into one Dutch sentence, and auto-advance refuses to
 * book it — and only when there is something to admit: a document that explains its zero (an
 * explicit 0 %-tarief, a verlegde factuur) leaves the row exactly as it was.
 *
 * `zeroBtwUnexplained` is the shared question; this only writes down its answer.
 */
export function markUnexplainedZeroBtw<T>(
  fieldConfidence: T,
  stored: StoredAmounts,
  read: { btwRate?: number | null; shifted?: boolean },
): T {
  if (!zeroBtwUnexplained({
    totalIncBtw: stored.total_inc_btw,
    btwAmount: stored.btw_amount,
    btwRate: read.btwRate,
    shifted: read.shifted === true,
  })) {
    return fieldConfidence;
  }
  const base = (fieldConfidence ?? {}) as Record<string, unknown>;
  return { ...base, _btw_zero_unexplained: true } as unknown as T;
}
