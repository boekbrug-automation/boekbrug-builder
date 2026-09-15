// src/lib/why-waiting.ts
// [WAAROM-WACHT] The sentence the OWNER reads when the app decided not to do something itself.
//
// ── WHY THIS EXISTS ──
//
// The promise this product makes is "do your job, we'll take care of everything else". Measured
// on one real administration over a year, 350 of 590 incoming documents still needed a hand — and
// the queue never said why any single one of them was there.
//
// The worst case is not the flagged row. A flagged row already carries an amber badge and a list
// of reasons; the owner knows what to look at. The worst case is the row that shows a green
// "klaar om te bevestigen" and STILL sits there waiting for a tap. Nothing on that card explains
// itself, so the owner re-reads a document that was read correctly, finds nothing wrong, taps
// confirm, and learns nothing. Do that three hundred times and the app has spent a working day of
// somebody's life without ever telling them what it wanted.
//
// Since [WAAROM-VASTGEHOUDEN] the refusal is stored on the row. This module turns it into one
// calm sentence, and the sentence is chosen to be ACTIONABLE: which field to look at, or which
// switch to flip.
//
// ── WHAT IT DELIBERATELY WILL NOT SAY ──
//
// A refusal it has no sentence for renders NOTHING, never the machine tag. On the operator panel
// an unknown tag is shown as itself, because there the raw word is information; here it is noise
// in front of someone who did not ask for a vocabulary lesson. A [WAAROM-WACHT] gate keeps every
// tag the app can produce supplied with a sentence, so "no sentence" never quietly hides a case
// that happens often.
//
// And it says nothing at all when another badge on the card already explains the wait. Two
// explanations of one delay is how a calm screen becomes a nagging one.
//
// ── NOT ONLY THE INVOICE QUEUE ──
//
// The same shape belongs everywhere the app decides FOR the owner and then waits: the bank match
// that was not confident enough, the cash line it would not book. Those decisions already compute
// their own reasons (see bank-match-confidence.ts). The vocabulary below is keyed on plain tags so
// they can join it without a second mechanism — one sentence per reason, in one place, for the
// whole app.
//
// Pure. The words come from the catalogue; this module decides WHICH words.

import { translator } from "./i18n/t";
import type { MessageKey } from "./i18n/messages";
import { localeDir, type Locale } from "./i18n/locale";

/**
 * The machine tags this module has an owner-sentence for, mapped to their message key.
 *
 * Keyed by the tag exactly as beslisAutoAdvance (and the two intake writers) produce it. Adding a
 * refusal without adding a line here is caught by the gate, not by an owner staring at a card that
 * says nothing.
 */
const SENTENCES: Readonly<Record<string, MessageKey>> = {
  // Not a reading problem at all — a setting the owner chose, and the only entry here whose answer
  // is a switch rather than a look at the document. It names the toggle as it is written on the
  // settings screen, so the owner is not sent hunting for a word that is nowhere in the interface.
  owner_reviews_everything: "wacht.eigenKeuze",

  // The money fields. These are the ones worth a look at the paper.
  no_reliable_total: "wacht.geenTotaal",
  total_derived_never_grounded: "wacht.totaalBerekend",
  total_not_in_document_text: "wacht.totaalNietInTekst",
  total_not_where_a_total_is_printed: "wacht.totaalVerkeerdePlek",
  btw_contradicts_printed_split: "wacht.btwAnders",
  zero_btw_not_explicit_zero_rate: "wacht.btwNul",
  foreign_currency: "wacht.vreemdeValuta",
  self_billed: "wacht.zelffactuur",
  e_invoice_contradicts_read: "wacht.eFactuurAnders",
  amount_confidence_below_high_bar: "wacht.bedragOnzeker",
  no_amount_confidence_and_overall_not_very_high: "wacht.bedragOnzeker",

  // The read as a whole.
  overall_confidence_missing_or_low: "wacht.lezingOnzeker",
  field_confidence_below_high_bar: "wacht.gegevensOnzeker",
  uncertain: "wacht.lezingOnzeker",
  needs_review: "wacht.aandacht",

  // What the document IS. These usually carry their own badge as well, and then nothing is shown —
  // but a card can lose its badge (an owner who already answered the credit-note question) and the
  // sentence is still true.
  not_invoice: "wacht.geenFactuur",
  statement: "wacht.overzicht",
  reminder: "wacht.herinnering",
  creditnota: "wacht.creditnota",
  tax_letter: "wacht.aanslag", // [AANSLAG]

  // How it arrived.
  paid_mark_not_settled: "wacht.betaalspoor",
  from_email_body: "wacht.uitMailtekst",
  multiple_invoices_in_file: "wacht.meerdereFacturen",
  forced_duplicate: "wacht.tochToegevoegd",

  // The honest catch-all: the app knows it did not qualify and cannot say more than that. Better
  // than silence — "this one was not eligible" at least tells the owner the app looked.
  not_eligible: "wacht.nietInAanmerking",

  // ── /bank ──────────────────────────────────────────────────────────────────────────────────
  //
  // Dezelfde vraag, één scherm verder, en de tags komen uit bank-waiting-reason.ts. Ze horen in
  // DEZE lijst en niet in een tweede: één zin per reden voor de hele app was het punt, en een
  // aparte woordenlijst per scherm is precies hoe de ene helft vertaald raakt en de andere niet.
  reference_not_in_administration: "wacht.bankNummerOnbekend",
  // [SOM-KLOPT] The opposite sentence, and it exists because the app printed the one above it over
  // an invoice that was sitting in the administration, paid, at the exact cent. "Go find the paper"
  // and "there is nothing to do here" are opposite afternoons; saying the first about the second is
  // an accusation about the owner's own bookkeeping.
  reference_already_settled: "wacht.bankNummerAlGeboekt",
  several_invoices_this_amount: "wacht.bankMeerdereZelfdeBedrag",
  counterparty_has_no_open_invoice_this_amount: "wacht.bankGeenBedrag",
  counterparty_unknown_here: "wacht.bankOnbekendePartij",
  nothing_open_at_all: "wacht.bankNietsOpen",

  // ── /bank/categoriseren ────────────────────────────────────────────────────────────────────
  //
  // Waarom de app deze regel niet zelf codeert. De eerste is de belangrijkste: het label boven de
  // regel zegt "onthouden" — óók wanneer het geheugen de andere kant op wijst.
  memory_contradicts_direction: "wacht.catGeheugenAndereKant",
  resembles_another_counterparty: "wacht.catLijktMaarNietDezelfde",
  counterparty_never_seen: "wacht.catNooitGezien",
};

export interface WaitingExplanation {
  /** The sentence, in the owner's language. */
  text: string;
  /**
   * Text direction, carried on the same object as the words so a component cannot render the two
   * out of step — the reason invoice-sent-notice.ts does the same.
   */
  dir: "ltr" | "rtl";
  /**
   * "setting" when the owner's own choice is holding this, "reading" when the document is. The
   * screen colours them differently: one is something to change, the other something to check.
   */
  kind: "setting" | "reading";
}

/** Read the stored refusal off a row's `field_confidence`. Null when none was recorded. */
export function waitingReasonOf(fieldConfidence: unknown): string | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object") return null;
  const hold = (fieldConfidence as Record<string, unknown>)._auto_hold;
  if (!hold || typeof hold !== "object") return null;
  const reason = (hold as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null;
}

/**
 * The one sentence, or null when there is nothing to say.
 *
 * Null on three counts, all deliberate:
 *   - no recorded reason (every row from before this measurement) — a guess would be worse;
 *   - a tag with no sentence — the machine word is not an explanation;
 *   - `alreadyExplained`, when a badge on the same card already answers the question.
 */
export function explainWaiting(
  reason: string | null,
  opts: { alreadyExplained?: boolean } = {},
  locale?: Locale | string | null,
): WaitingExplanation | null {
  if (opts.alreadyExplained) return null;
  if (!reason) return null;
  const key = SENTENCES[reason];
  if (!key) return null;
  const t = translator(locale);
  return {
    text: t(key),
    dir: localeDir(locale),
    kind: reason === "owner_reviews_everything" ? "setting" : "reading",
  };
}

/** The tags this module can speak for — read by the gate, so it cannot drift from the map. */
export function explainableReasons(): string[] {
  return Object.keys(SENTENCES);
}
