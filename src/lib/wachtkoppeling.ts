// src/lib/wachtkoppeling.ts
// [WACHTKOPPELING] "Ik heb dit betaald — de bank laat het over twee dagen zien."
//
// Every attach door in this app requires the thing to EXIST first: bank-attachment and
// bank-attach-invoice both take a transactionId, and bank_tx_attachments carries
// `REFERENCES public.bank_transactions(id)`. That foreign key is not a detail — it means the
// current schema CANNOT express a link to a payment that has not arrived yet.
//
// And that payment is the normal case, not an edge one. The owner pays a supplier on Friday and
// has the invoice in hand; the statement shows it on Tuesday. Today both roads leave a hole:
//
//   · wait — the invoice sits in the queue for no reason anyone can see;
//   · mark it paid by hand — and when the bank line finally lands, [AL-GEBOEKT] correctly reads
//     the invoice as already settled, so the line never links to anything. The reconciliation is
//     short by one payment and nothing anywhere says so.
//
// ── THE MIRROR OF [BETAALD-GEEN-STUK] ──
//
// That module asks: money left, where is the paperwork? This one asks the same question from the
// other end: the paperwork is here, where is the money? Same hole, opposite side.
//
// ── WHAT IS STORED IS AN INTENTION, NOT A BOOKING ──
//
// Nothing here books, pays, or settles. A waiting link records what the owner SAYS they paid —
// an amount, a day, a counterparty, and the invoices it covers. When a bank line that fits turns
// up, the app PROPOSES; the owner confirms. [ZELF-EERST] and [VOORSTEL] both say the owner
// decides, and a waiting link is a weaker witness than a read document, not a stronger one.
//
// ── AND IT EXPIRES ──
//
// [RITME] paid for this lesson already: a banner that never goes away stops being a signal and
// becomes furniture. A waiting link that never finds its payment is either a mistake or a payment
// that did not happen, and after its window it says so and stops asking.
//
// Pure — the matching reuses bank-matching.ts rather than inventing a second answer to "is this
// the same payment". Run: npx tsx --test src/lib/wachtkoppeling.test.ts

import { amountMatches, nameSimilarity, isStrongNameIdentity, normalizeIban } from "./bank-matching";
// [MEERVOUD] A plural placeholder is a mail-merge that failed, printed by an app asking an
// entrepreneur to trust it with his btw. The count is in scope, so the noun agrees with it.
import { telWoord } from "./nl-plural";

/** Money out (a supplier paid) or money in (a customer paid me). Dutch, because it is stored. */
export type WachtRichting = "uit" | "in";

export interface Wachtkoppeling {
  id: string;
  richting: WachtRichting;
  /** POSITIVE euros, whichever way the money went. The direction is `richting`, never a sign. */
  bedrag: number;
  /** The day the owner says the money moved (ISO). */
  betaaldOp: string;
  /** Who it went to or came from, as the owner typed it. May be absent. */
  tegenpartij: string | null;
  /** The invoices this payment settles — one, or several ([SOM-KLOPT] already knows that shape). */
  factuurIds: string[];
  /** Last day this link keeps asking (ISO). After that it is stale, never furniture. */
  verlooptOp: string;
}

/** A bank line, reduced to what deciding a match needs. */
export interface WachtTransactie {
  id: string;
  date: string;
  /** Signed: negative is money leaving the account. */
  amount: number;
  counterpartName: string | null;
  counterpartIban: string | null;
  /** Already linked to an invoice? Then it is not looking for one. */
  invoiceId: string | null;
}

/** How far the bank date may sit from the day the owner named. */
export const WACHT_WINDOW_DAYS = 10;
/** Cent tolerance, the same one the rest of the app calls equal. */
export const WACHT_EPSILON = 0.01;
/** A name has to look like the same company before the amount is allowed to decide. */
export const WACHT_NAME_FLOOR = 0.6;

export type WachtVerdict =
  | { fits: true; reasons: string[] }
  | { fits: false; reason: string };

function dayDiff(a: string, b: string): number {
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.abs(x - y) / 86_400_000;
}

/**
 * Does this arriving bank line fit what the owner said they paid?
 *
 * Deliberately strict, and stricter than ordinary invoice matching, for a reason that is easy to
 * get backwards: a waiting link is the owner's MEMORY, not a document. Ordinary matching weighs a
 * read invoice against a bank line and can afford to propose on a near miss, because both sides
 * are evidence. Here one side is a typed recollection. So all three have to agree — direction,
 * amount, and either the name or nothing at all — and anything short of that is refused with the
 * reason, never offered as a maybe.
 */
export function transactionFitsWacht(w: Wachtkoppeling, tx: WachtTransactie): WachtVerdict {
  if (tx.invoiceId != null) return { fits: false, reason: "regel_is_al_gekoppeld" };

  // Direction first: a receipt can never settle a payment, however well the amount agrees.
  const moneyOut = tx.amount < 0;
  if ((w.richting === "uit") !== moneyOut) return { fits: false, reason: "verkeerde_richting" };

  if (!amountMatches(tx.amount, w.bedrag, WACHT_EPSILON)) {
    return { fits: false, reason: "bedrag_wijkt_af" };
  }

  const dist = dayDiff(tx.date, w.betaaldOp);
  if (!(dist <= WACHT_WINDOW_DAYS)) return { fits: false, reason: "datum_te_ver" };

  const reasons = [`bedrag klopt (€ ${w.bedrag.toFixed(2)})`, `datum ligt ${telWoord(Math.round(dist), "dag", "dagen")} uit elkaar`];

  // The name is checked only when the owner gave one. An owner who typed no counterparty told us
  // nothing about it, and treating silence as a mismatch would refuse the very links they meant
  // to make.
  if (w.tegenpartij && tx.counterpartName) {
    const strong = isStrongNameIdentity(w.tegenpartij, tx.counterpartName);
    const sim = nameSimilarity(w.tegenpartij, tx.counterpartName);
    if (!strong && sim < WACHT_NAME_FLOOR) return { fits: false, reason: "andere_tegenpartij" };
    reasons.push(strong ? "zelfde tegenpartij" : "tegenpartij lijkt sterk op elkaar");
  }

  return { fits: true, reasons };
}

/**
 * The one waiting link this bank line belongs to — or none.
 *
 * A line that fits TWO waiting links is refused rather than assigned to the closest: two identical
 * payments to the same supplier in the same week are exactly the case where guessing produces a
 * wrong booking that reconciles perfectly, and the owner can settle it in one tap. Ambiguity is
 * reported, never resolved by tie-break.
 */
export function wachtVoorTransactie(
  wachtend: readonly Wachtkoppeling[],
  tx: WachtTransactie,
): { match: Wachtkoppeling; reasons: string[] } | { ambiguous: Wachtkoppeling[] } | null {
  const hits: { w: Wachtkoppeling; reasons: string[] }[] = [];
  for (const w of wachtend) {
    const v = transactionFitsWacht(w, tx);
    if (v.fits) hits.push({ w, reasons: v.reasons });
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) return { ambiguous: hits.map((h) => h.w) };
  return { match: hits[0].w, reasons: hits[0].reasons };
}

/** Has this link run out its window? Stale links stop asking; they do not disappear. */
export function isVerlopen(w: Wachtkoppeling, todayIso: string): boolean {
  const t = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${w.verlooptOp.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(e)) return false;
  return t > e;
}

/** The default window: long enough for any Dutch bank, short enough not to become furniture. */
export const WACHT_DEFAULT_DAYS = 21;

/** `betaaldOp` + the default window, as an ISO day. */
export function defaultVerlooptOp(betaaldOp: string): string {
  const t = Date.parse(`${betaaldOp.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return betaaldOp;
  return new Date(t + WACHT_DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** The owner-facing sentence for a waiting link that is still looking. */
export function wachtZin(w: Wachtkoppeling, euro: (n: number) => string): string {
  const wie = w.tegenpartij ? ` aan ${w.tegenpartij}` : "";
  return w.richting === "uit"
    ? `${euro(w.bedrag)} betaald${wie} — we wachten nog op de bankregel`
    : `${euro(w.bedrag)} ontvangen${w.tegenpartij ? ` van ${w.tegenpartij}` : ""} — we wachten nog op de bankregel`;
}

/** Exported so the route and the gate agree on what counts as unused. */
export { normalizeIban };
