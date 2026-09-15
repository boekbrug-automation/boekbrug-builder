// src/lib/geleerd-sindsdien.ts
// [GELEERD-SINDSDIEN] Which ignored invoices were read by a reader that has since learned better.
// Pure, no I/O. Run: npx tsx --test src/lib/geleerd-sindsdien.test.ts
//
// ── WHY ──
//
// Measured on the live administration: 58 incoming invoices sit at Genegeerd, and 45 of them were
// held on the same arithmetic flag — sum_mismatch, excl + BTW ≠ the total. Eleven suppliers, all
// wholesale and horeca, i.e. mixed-rate 9 %/21 % invoices with a statiegeld line.
//
// The dates are the whole story. Those holds are stamped 8–24 July 2026. The reader learned to
// read a mixed-rate BTW summary block on 18 August, and to find a dropped statiegeld line on
// 26 August. So every one of them was read by an engine that did not yet know the two things
// those invoices needed. The owner threw away € 44.749,74 of purchase invoices, correctly, on the
// evidence they had — and nobody ever told them the evidence changed.
//
// The app improving in silence is the same failure as the app failing in silence. This module is
// the sentence that closes it.
//
// ── WHAT IT REFUSES TO CLAIM ──
//
// Only an invoice held BEFORE the capability landed. Five of those 45 were held after, which means
// the reader already knew and still could not do it — offering those a second read would promise
// something this app has no reason to believe. A hold with no date answers the same way: we do not
// know when it was read, so we do not claim it changed.
//
// And it decides nothing. It marks an invoice as worth OFFERING back; putting it back is the
// owner's tap, through the restore door that already exists. They archived it on purpose.

/** Something the reader gained on a known day, and the holds it plausibly explains. */
export interface ReaderCapability {
  /** Stable id, used by the screen to name what was learned. */
  key: "btw_split" | "statiegeld";
  /** The day it landed on main. A hold stamped before this was made without it. */
  since: string;
  /** The stored _safecore flags whose holds this capability can plausibly answer. */
  explains: readonly string[];
}

/**
 * What the reader has learned, with the day it learned it.
 *
 * These are dates in this repository's own history, not guesses: the mixed-rate BTW summary block,
 * btw-split.ts and the supplier rate memory landed together on 18 August 2026; statiegeld.ts on
 * 26 August. Adding a capability here is how a future improvement reaches the invoices it would
 * have saved.
 */
export const READER_CAPABILITIES: readonly ReaderCapability[] = [
  { key: "btw_split", since: "2026-08-18", explains: ["sum_mismatch"] },
  { key: "statiegeld", since: "2026-08-26", explains: ["sum_mismatch"] },
] as const;

export interface IgnoredInvoice {
  status?: string | null;
  direction?: string | null;
  /** A re-read needs the paper. No file, nothing to read again. */
  hasFile?: boolean;
  /** The stored _safecore flags, as written when the invoice was held. */
  flags?: readonly string[] | null;
  /** The stored _safecore.held_at timestamp. Absent means we do not know when it was read. */
  heldAt?: string | null;
}

export interface LearnedVerdict {
  /** Worth offering the owner a second look. Never an instruction, never automatic. */
  worthOffering: boolean;
  /** What the reader gained after this invoice was read — empty when nothing did. */
  gained: ReaderCapability["key"][];
}

const NOTHING: LearnedVerdict = { worthOffering: false, gained: [] };

/**
 * Was this ignored invoice read before the reader learned what it needed?
 *
 * Conservative on every axis: a wrong yes here sends the owner back to an invoice that will fail
 * exactly as it did, which is a worse experience than never being asked.
 */
export function learnedSince(invoice: IgnoredInvoice): LearnedVerdict {
  // Only an invoice the owner actually set aside, and only a purchase — this is about what the
  // reader could not read off a supplier's document.
  if ((invoice.status ?? "") !== "archived") return NOTHING;
  if ((invoice.direction ?? "") !== "incoming") return NOTHING;
  if (invoice.hasFile !== true) return NOTHING;

  const flags = (invoice.flags ?? []).map((f) => (f ?? "").trim()).filter(Boolean);
  if (flags.length === 0) return NOTHING;

  // A hold with no date cannot be placed on either side of a capability. We do not know, so we do
  // not claim — the same rule the rest of this app keeps about checks that could not run.
  const held = (invoice.heldAt ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(held)) return NOTHING;
  const heldDay = held.slice(0, 10);

  const gained = READER_CAPABILITIES
    .filter((c) => c.explains.some((f) => flags.includes(f)) && heldDay < c.since)
    .map((c) => c.key);

  return gained.length > 0 ? { worthOffering: true, gained } : NOTHING;
}
