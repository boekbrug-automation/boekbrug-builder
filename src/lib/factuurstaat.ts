// src/lib/factuurstaat.ts
// [FACTUURSTAAT] What is true about an invoice — as several answers, because it is several facts.
//
// ── THE MEASUREMENT THAT CAUSED THIS FILE ──
//
// 69 places in this app decide "is this invoice paid?" for themselves, and 12 different sets of
// status strings are in use to do it. Two of those sets are the SAME set written in a different
// order — ["received","paid"] and ["paid","received"] — so twenty places that agree perfectly
// cannot be found by one search.
//
// The problem is not that the sets differ. They SHOULD differ: "which invoices does the aangifte
// count" and "which invoices may still be paid" are different questions with different answers.
// The problem is that none of those answers has a NAME. A reader looking at `["processing",
// "received"]` in one file and `["processing","received","paid"]` in another cannot tell whether
// the difference is a considered decision or a mistake somebody made once — and neither can a
// test. That is the whole cost, and it is paid every time anyone touches this app.
//
// ── WHY THIS IS DERIVED AND NOT FIVE NEW COLUMNS ──
//
// The obvious fix is to split `status` into payment_status, delivery_state, collection_state and
// so on. That is the right long-term shape and it is NOT what this file does, because `status`
// is load-bearing in ways a rewrite would quietly break: a generated `shared` column reads it, the
// verwerkt trigger fires on it, RLS policies test it, and the auditfile selects on it. Changing
// all of that at once, in an app holding real money, to fix a readability problem, is a trade
// nobody should take.
//
// So the dimensions are DERIVED from facts that already exist and are already true — the same
// argument the grootboek makes about the journal. Nothing is migrated, nothing can break, and the
// vocabulary exists from today. If the columns are ever added, this file becomes the place that
// reads them, and every caller stays as it is.
//
// ── THE ONE RULE THAT IS NOT COSMETIC ──
//
// `status` IS NOT THE PAYMENT TRUTH. What was actually paid lives in `amount_paid` and in the
// allocations on bank_tx_invoices. A row can say 'paid' while carrying a part payment, and a row
// can say 'received' while the money has fully arrived and the status has not caught up. Every
// predicate here that concerns money reads the AMOUNTS, and only the amounts.
//
// Pure. Run: npx tsx --test src/lib/factuurstaat.test.ts

import { round2 } from "./invoice-totals";

/** The facts this module needs. Every one already exists on the invoices row. */
export interface FactuurFeiten {
  status: string | null;
  direction: string | null;
  invoice_type: string | null;
  total_inc_btw: number | null;
  amount_paid?: number | null;
  due_date?: string | null;
  sent_at?: string | null;
  superseded_by?: string | null;
}

/** Where the document is in its own life. */
export type Levensfase = "concept" | "verstuurd" | "geboekt" | "gearchiveerd" | "onbekend";

/**
 * What the money did. `onbekend` is a real answer and not a failure: an invoice with no readable
 * total cannot be called paid OR unpaid, and saying either would be inventing a fact.
 */
export type Betaalstand = "onbetaald" | "deels_betaald" | "betaald" | "teveel_betaald" | "onbekend";

/** Whether it is late. Null when the question does not apply (nothing owed, or no due date). */
export type Inningstand = "loopt" | "te_laat" | null;

/** Whether a later document replaced or credited this one. */
export type Correctiestand = "geen" | "vervangen";

export interface Factuurstaat {
  fase: Levensfase;
  betaling: Betaalstand;
  inning: Inningstand;
  correctie: Correctiestand;
  /** What is still owed, in euros. Null when the total could not be read. */
  openstaand: number | null;
}

/** A creditnota carries a negative total; comparisons are on magnitude ([CREDIT-TEKEN]). */
function bedrag(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.abs(round2(n)) : null;
}

/**
 * What the money did — from the AMOUNTS, never from `status`.
 *
 * A cent of tolerance, the same one the rest of the app calls equal: a payment that lands one cent
 * short of an invoice is settled everywhere else in this app and must be settled here too.
 */
export function betaalstandVan(f: FactuurFeiten): { stand: Betaalstand; openstaand: number | null } {
  const totaal = bedrag(f.total_inc_btw);
  if (totaal == null) return { stand: "onbekend", openstaand: null };
  const betaald = bedrag(f.amount_paid) ?? 0;
  const rest = round2(totaal - betaald);
  if (rest <= -0.01) return { stand: "teveel_betaald", openstaand: 0 };
  if (Math.abs(rest) < 0.01) return { stand: "betaald", openstaand: 0 };
  if (betaald >= 0.01) return { stand: "deels_betaald", openstaand: rest };
  return { stand: "onbetaald", openstaand: rest };
}

/** Every dimension at once. */
export function factuurstaat(f: FactuurFeiten, vandaag: string): Factuurstaat {
  const s = String(f.status ?? "");
  const fase: Levensfase =
    s === "draft" || s === "concept" ? "concept"
    : s === "archived" ? "gearchiveerd"
    : s === "sent" || s === "overdue" ? "verstuurd"
    : s === "received" || s === "paid" || s === "processing" ? "geboekt"
    : "onbekend";

  const { stand, openstaand } = betaalstandVan(f);

  // Late only when something is actually owed AND a due date has passed. A paid invoice is never
  // late, whatever `status` says — which is exactly the disagreement this module exists to end.
  const inning: Inningstand =
    openstaand != null && openstaand >= 0.01 && f.due_date
      ? (String(f.due_date).slice(0, 10) < vandaag.slice(0, 10) ? "te_laat" : "loopt")
      : null;

  return {
    fase,
    betaling: stand,
    inning,
    correctie: f.superseded_by ? "vervangen" : "geen",
    openstaand,
  };
}

// ── The named questions, replacing anonymous status arrays ────────────────────────────────────
//
// Each one carries the set it stands for, so a reader can see at a glance that this is the same
// decision the old array made — and a future change is made once, here, with a reason beside it.

/** Outgoing invoices that are out in the world and may still be paid. Was ["sent","overdue"]. */
export const UITSTAAND_STATUS: readonly string[] = ["sent", "overdue"];
export function isUitstaand(f: FactuurFeiten): boolean {
  return f.direction === "outgoing" && UITSTAAND_STATUS.includes(String(f.status ?? ""));
}

/** Purchase invoices that are IN the books — what the aangifte and the ledger count.
 *  Was ["received","paid"], and also ["paid","received"] in six other places. */
export const GEBOEKTE_INKOOP_STATUS: readonly string[] = ["received", "paid"];
export function isGeboekteInkoop(f: FactuurFeiten): boolean {
  return f.direction === "incoming" && GEBOEKTE_INKOOP_STATUS.includes(String(f.status ?? ""));
}

/** Purchase invoices the owner has not finished with — the verify queue plus the booked ones.
 *  Was ["processing","received"] in five places and ["processing","received","paid"] in four.
 *  Those two are DIFFERENT questions and now say so: this one includes a paid invoice, because a
 *  paid invoice is still part of the administration; the queue-only question is isTeBeoordelen. */
export function isInAdministratie(f: FactuurFeiten): boolean {
  return f.direction === "incoming" && ["processing", "received", "paid"].includes(String(f.status ?? ""));
}

/** Purchase invoices still waiting for the owner's eyes. Was ["processing"]. */
export function isTeBeoordelen(f: FactuurFeiten): boolean {
  return f.direction === "incoming" && String(f.status ?? "") === "processing";
}

/** Settled — from the money, not from the word. */
export function isBetaald(f: FactuurFeiten): boolean {
  const { stand } = betaalstandVan(f);
  return stand === "betaald" || stand === "teveel_betaald";
}
