// src/lib/contracts/reason-codes.ts
// [WERKSTROOM-REDEN] One vocabulary for the refusals this app produces. Pure, no I/O.
// Run: npx tsx --test src/lib/contracts/reason-codes.test.ts
//
// ── WHAT A REASON CODE IS, AND WHAT IT IS NOT ───────────────────────────────────────────────
//
// A REASON CODE is a refusal the APP produced: a door said no, and this is which no. It travels
// on the wire, the screen turns it into a sentence ([SERVER-ZIN]), and the same code can be read
// by a workflow guard, an exception list, Today, or a report — which is the whole point of it
// being shared.
//
// AN OWNER'S DISPOSITION NOTE IS NOT ONE. archive-reason.ts and bank-ignore-reason.ts both say so
// in their own headers, in Dutch: the reason is a NOTE, not a decision — it changes nothing about
// what happens to the invoice and counts nowhere in the figures. Folding `dubbel` and
// `niet_van_mij` into this vocabulary would look tidy and would be a category error, and the two
// modules do not even agree on what `niet_van_mij` means (the mailbox: "real, but not this
// company's"; the bank: "a reversal, a mistake, money that went away again"). They stay where
// they are, and this file says why so nobody unifies them next quarter.
//
// ── THE SHAPE: <domain>.<what> ──────────────────────────────────────────────────────────────
//
// Namespaced, because two domains will want `not_found` and they are not the same refusal. The
// namespace is the OWNER of the rule that refused, which is also what makes a code answerable:
// "who decided this" has one answer.
//
// ── WHY THIS IS NOT A REWRITE OF THE FIVE *-reason.ts MODULES ───────────────────────────────
//
// Measured before this file existed: five modules, three different kinds of thing.
//   · archive-reason / bank-ignore-reason  — the OWNER's disposition note. Not this. Stays.
//   · bank-waiting-reason / hold-reasons   — a verdict the app DERIVED about a document or a bank
//     line. That is a reason code in everything but its typing, and it can move here when a
//     second reader needs it. It has none today, so moving it now would be motion, not progress.
//   · pay-toggle-reason                    — a server refusal mapped to a message key. That IS
//     this shape, and it predates the vocabulary. It joins when its route is next opened.
// New refusals start here. Old ones migrate when they are touched — the same rule AGENTS.md sets
// for the English rename, and for the same reason.

/** The refusals of the Mollie refund door. Owner: the refund/payment side. */
export type RefundReasonCode =
  | "refund.not_found"          // no such refund for this owner
  | "refund.already_answered"   // somebody answered it first; the first answer stands
  | "refund.invalid_answer"     // not one of the three answers
  | "refund.no_invoice"         // nothing to reverse: the refund names no BoekBrug invoice
  | "refund.payment_gone"       // the booked payment is not on the invoice any more
  | "refund.partial_refund"     // less came back than went on — reversal would remove too much
  | "refund.payment_changed"    // the payment moved between what the owner was shown and the lock
  | "refund.accountant_lock"    // the accountant has processed the invoice
  | "refund.has_bank_line"      // the payment has a bank line; that reversal is /api/bank/unlink's
  | "refund.reverse_failed";    // the money function refused for a reason we did not map

export const REFUND_REASON_CODES: readonly RefundReasonCode[] = [
  "refund.not_found", "refund.already_answered", "refund.invalid_answer", "refund.no_invoice",
  "refund.payment_gone", "refund.partial_refund", "refund.payment_changed",
  "refund.accountant_lock", "refund.has_bank_line", "refund.reverse_failed",
];

/** Every code the app knows. One union today; it grows one domain at a time, never in bulk. */
export type ReasonCode = RefundReasonCode;

export const REASON_CODES: readonly ReasonCode[] = REFUND_REASON_CODES;

export function isReasonCode(v: unknown): v is ReasonCode {
  return typeof v === "string" && (REASON_CODES as readonly string[]).includes(v);
}

/** The owner of the rule that refused — the half before the dot. */
export function reasonDomain(code: ReasonCode): string {
  return code.slice(0, code.indexOf("."));
}
