// src/lib/mollie-refund.ts
// [TERUGBETALING] Money that went BACK through Mollie: reading the fact, and deciding nothing.
// Pure, no I/O. Run: npx tsx --test src/lib/mollie-refund.test.ts
//
// ── WHAT THIS CLOSES ────────────────────────────────────────────────────────────────────────
//
// mollie-settlement-sync.ts has read a settlement's refunds and chargebacks for a while, and used
// them for exactly one thing: counting them, so a settlement carrying any could be HELD instead of
// booked. Nothing was recorded. Not the amount, not the date, not which invoice.
//
// And the invoice that payment settled stays 'paid'. The money is gone and the books do not know —
// the only place in the payment surface where real money can leave silently. mollie_refunds.sql is
// the record; this module is the reading of it.
//
// ── THE APP DOES NOT ANSWER THIS ONE ────────────────────────────────────────────────────────
//
// A chargeback and a refund are not the same event, and they lead to two different bookings:
//
//   · a CHARGEBACK is the customer taking the money back. The invoice was never paid; the payment
//     belongs off the invoice.
//   · a REFUND is the owner giving money back. In Dutch bookkeeping that is normally a CREDITNOTA
//     and the original invoice stays paid — the sale happened, and then it was corrected.
//
// Only the owner knows which, and the exception runs both ways: a refund of a double payment IS a
// reversal, and a chargeback the owner disputes and wins is neither.
//
// A chargeback is factually unambiguous enough that "quiet by default" would allow booking it. It
// is still not booked here, and the reason is the direction of the consequence: un-paying an
// invoice pushes it back into the reminder flow, which MAILS the customer. Everything the app
// books on its own is additive and one tap to undo; a reversal that dunned a customer who really
// did pay cannot be undone by a tap, because the mail has left.
//
// So: record the fact, name the invoice, ask. That is [ZELF-EERST] applied to somebody else's
// clock instead of the owner's.

import { round2 } from "./invoice-totals";
import { amsterdamToday } from "./format-nl";

/** Which of the two events Mollie reported. They are never merged — see the header. */
export type RefundKind = "refund" | "chargeback";

/** The owner's answer, or the absence of one. Mirrors the CHECK in mollie_refunds.sql. */
export type RefundResolution = "open" | "reversed" | "credited" | "not_ours";

export const REFUND_RESOLUTIONS: readonly RefundResolution[] = [
  "open", "reversed", "credited", "not_ours",
];

/** The three answers a person may give. 'open' is a state, never a choice. */
export const REFUND_ANSWERS: readonly Exclude<RefundResolution, "open">[] = [
  "reversed", "credited", "not_ours",
];

export function isRefundAnswer(v: unknown): v is Exclude<RefundResolution, "open"> {
  return typeof v === "string" && (REFUND_ANSWERS as readonly string[]).includes(v);
}

/**
 * One refund or chargeback as the Settlements API hands it over.
 *
 * `paymentId` is the whole reason this is resolvable at all: it names the payment the money went
 * back on, and mollie_payment_links.payment_id maps that to one of our invoices.
 */
export interface RefundAdjustment {
  id: string;
  amount?: { currency?: string; value?: string } | null;
  paymentId?: string | null;
  createdAt?: string | null;
}

/** The fact, cleaned. Amount POSITIVE: it is what came back, not a signed movement. */
export interface RefundFact {
  refundId: string;
  kind: RefundKind;
  paymentId: string | null;
  amount: number;
  /** ISO date in the OWNER's day, or null. See the [TZ] note in refundFactFrom. */
  createdOn: string | null;
}

/**
 * Read one adjustment, or null when it cannot be read as money.
 *
 * Null is returned for a missing id, an unparsable or non-positive amount, and a currency other
 * than EUR. It is never a silent drop: the caller counts what it could not read and holds the
 * settlement on it — the same rule summarizeSettlement already applies one level up, where a
 * non-EUR settlement is refused outright rather than converted by us.
 */
export function refundFactFrom(adj: RefundAdjustment | null | undefined, kind: RefundKind): RefundFact | null {
  const refundId = typeof adj?.id === "string" ? adj.id.trim() : "";
  if (!refundId) return null;

  const currency = adj?.amount?.currency ?? "EUR";
  if (currency !== "EUR") return null;

  const raw = Number(adj?.amount?.value);
  if (!Number.isFinite(raw)) return null;
  // Mollie reports a refund's own amount positive; a settlement-scoped figure may arrive negative
  // because it is netted against the payout. Either way what came BACK is the magnitude.
  const amount = round2(Math.abs(raw));
  if (!(amount > 0)) return null;

  const paymentId = typeof adj?.paymentId === "string" && adj.paymentId.trim() ? adj.paymentId.trim() : null;

  return { refundId, kind, paymentId, amount, createdOn: refundDay(adj?.createdAt) };
}

/**
 * [TZ] The day, in the owner's clock, that Mollie's timestamp falls on.
 *
 * Mollie serialises with an offset (in practice +00:00). A bare slice(0,10) dates a refund made at
 * 00:30 Amsterdam on the day before — and this date is what the screen shows the owner next to an
 * invoice, so a day that is off by one is a day they cannot reconcile with their own memory. The
 * webhook route settled this same question the same way.
 */
function refundDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) return null;
  return amsterdamToday(new Date(ms));
}

/** One of our payment links, as the resolver needs it. */
export interface KnownPaymentLink {
  /** mollie_payment_links.id — also the client_key of the bank_tx_invoices row it booked. */
  id: string;
  paymentId: string | null;
  invoiceId: string | null;
}

/** A fact plus what we could tie it to. Unresolved is a valid, recorded outcome. */
export interface ResolvedRefund {
  fact: RefundFact;
  linkId: string | null;
  invoiceId: string | null;
}

/**
 * Tie each fact to one of our invoices, through the payment id.
 *
 * A fact with no paymentId, or one naming a payment we never made, resolves to nulls and is still
 * returned. Mollie settles more than BoekBrug links for an owner who also sells through a webshop;
 * a refund on one of those is real money and a real event, it simply has no invoice of ours under
 * it. Dropping it would leave the settlement held forever with nothing to point at.
 */
export function resolveRefunds(
  facts: readonly RefundFact[],
  links: readonly KnownPaymentLink[],
): ResolvedRefund[] {
  const byPayment = new Map<string, KnownPaymentLink>();
  for (const l of links) {
    if (l.paymentId) byPayment.set(l.paymentId, l);
  }
  return facts.map((fact) => {
    const link = fact.paymentId ? byPayment.get(fact.paymentId) ?? null : null;
    return { fact, linkId: link?.id ?? null, invoiceId: link?.invoiceId ?? null };
  });
}

/** One cent of slack, the same epsilon every money comparison in this repo uses. */
const EPS = 0.01;

/**
 * Has the world already shown this reversal?
 *
 * The owner may undo the payment through the ordinary "Betaald" toggle without ever touching the
 * refund panel, and a question that stays open after it has been answered elsewhere is a question
 * that trains people to ignore the panel. So the sync re-reads the invoice and closes what is
 * already done.
 *
 * PROVABLE, not guessed: amount_paid must have dropped by at least the refunded amount since the
 * snapshot taken when the fact was first seen. Without a snapshot the answer is false — "I cannot
 * tell" and "it happened" are not the same statement, and only one of them may close a question
 * about money.
 */
export function refundAlreadyReversed(row: {
  paidSnapshot: number | null | undefined;
  paidNow: number | null | undefined;
  amount: number;
}): boolean {
  const snapshot = euros(row.paidSnapshot);
  const now = euros(row.paidNow);
  if (snapshot === null || now === null) return false;
  if (!(row.amount > 0)) return false;
  return now <= snapshot - row.amount + EPS;
}

/**
 * A figure, or null when there is none. NOT Number(): `Number(null)` is 0, and a null
 * invoices.amount_paid read as zero says "everything came off this invoice" — which would close
 * every open refund question on every invoice that has never been paid at all. The one place a
 * silent coercion turns "I do not know" into "it is done", so it is spelled out.
 */
function euros(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The sentence that holds a settlement, for mollie_settlements.last_error.
 *
 * DUTCH IN AN ENGLISH FILE, deliberately, for the reason owner-only.ts states: this string is
 * shown to the owner as-is on their Mollie card, so it is content and not code. It sits here
 * rather than in the sync because it is a rule about counting, and holdReason() in
 * mollie-settlement.ts — its sibling sentence — is a pure function for the same reason.
 */
export function refundHoldSentence(open: readonly RefundFact[]): string | null {
  if (open.length === 0) return null;
  const chargebacks = open.filter((f) => f.kind === "chargeback").length;
  const refunds = open.length - chargebacks;
  const parts: string[] = [];
  if (refunds > 0) parts.push(refunds === 1 ? "1 terugbetaling" : `${refunds} terugbetalingen`);
  if (chargebacks > 0) parts.push(chargebacks === 1 ? "1 chargeback" : `${chargebacks} chargebacks`);
  return `${parts.join(" en ")} wacht${open.length === 1 ? "" : "en"} op je antwoord — het geld ging terug`;
}

/** Why a refund cannot be answered with "take the payment off the invoice". */
export type ReverseRefusal =
  | "no-invoice"       // the refund names no BoekBrug invoice
  | "payment-gone"     // the booked payment is not there any more
  | "partial-refund";  // less came back than went on — a reversal would remove too much

/**
 * May this refund be answered by reversing the booked payment?
 *
 * THE PARTIAL CASE IS THE ONE THIS EXISTS FOR. Mollie allows refunding part of a payment: €100
 * back on a €300 iDEAL payment is ordinary. The booked payment is one bank_tx_invoices row of
 * €300, and reversing it would take all three hundred off an invoice the customer paid two thirds
 * of. Nothing downstream would notice — amount_paid is re-derived, the status follows, the figures
 * stay internally consistent — and the invoice would simply be €200 more open than it is.
 *
 * So a partial refund is refused HERE, before any door, and the owner is pointed at the creditnota
 * that a partial refund is in Dutch bookkeeping anyway. Reversal answers "this payment did not
 * happen"; a partial refund is not that statement.
 */
export function mayReverse(input: {
  invoiceId: string | null | undefined;
  appliedAmount: number | null | undefined;
  refundAmount: number;
}): { ok: true } | { ok: false; refusal: ReverseRefusal } {
  if (!input.invoiceId) return { ok: false, refusal: "no-invoice" };
  const applied = Number(input.appliedAmount);
  if (!Number.isFinite(applied) || applied <= 0) return { ok: false, refusal: "payment-gone" };
  if (Math.abs(applied - input.refundAmount) > EPS) return { ok: false, refusal: "partial-refund" };
  return { ok: true };
}
