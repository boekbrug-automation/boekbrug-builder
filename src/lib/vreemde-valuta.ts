// src/lib/vreemde-valuta.ts
// [VREEMDE-VALUTA] A document priced in another currency must not be booked as euros.
//
// Every amount in this administration is a euro amount. Nothing anywhere states that — it is
// simply true of every invoice a Dutch zzp'er has ever handed this app, and so the whole pipeline
// treats "1.234,56" as €1.234,56 without ever asking. That assumption is correct until the day a
// supplier bills in dollars, and on that day it is not a rounding error: the base, the btw, the
// deduction and the aangifte are all wrong by the exchange rate, and every gate downstream passes,
// because the arithmetic on the document is perfectly consistent — in dollars.
//
// Two rules, and the second is the one that matters:
//
//   1. We act only on a POSITIVE reading. A document that never printed a currency code is not a
//      foreign one; it is a document that said nothing, which is the overwhelmingly normal case
//      and must keep behaving exactly as it does today. Absent is not "USD" and it is not "EUR" —
//      it is not a reason to do anything.
//
//   2. We NEVER convert. A conversion needs the rate on the invoice date, which this app does not
//      have and must not invent; and a converted number, once stored, is indistinguishable from a
//      read one. So a foreign invoice is HELD for the owner with the currency named. A held
//      invoice is a question. A converted invoice is a wrong administration that looks right.
//
// ── THE OTHER EURO RULE, AND WHY IT IS NOT THIS ONE ──
//
// e-invoice.ts already carries [EURO-ALLEEN] (isEuroDocument): a structured e-factuur stating a
// non-euro DocumentCurrencyCode is REFUSED — its figures are dropped as a witness. That rule is
// not duplicated here and must not be replaced by this one, because the evidence is different in
// exactly one way that matters:
//
//   · There, the currency is a MACHINE-READABLE field in a validated XML document. Whatever
//     stands in it is a currency code by construction, so anything that is not "EUR" is refused —
//     including a string nobody recognises. Trusting the field is correct.
//   · Here, the currency was READ off a picture of a piece of paper. "kr" is three currencies and
//     "$" is five; a symbol we cannot resolve is not evidence, and holding an invoice on it would
//     be an OCR artefact stopping the owner's work.
//
// The consequences differ for the same reason: [EURO-ALLEEN] discards a witness (nothing is lost —
// the document is still read normally), while this one HOLDS the whole document, which is only
// safe because it fires on a currency we could actually name.
//
// Pure — no I/O, no database. Run: npx tsx --test src/lib/vreemde-valuta.test.ts

/** The currency this administration is kept in. Everything else is foreign. */
export const HOME_CURRENCY = "EUR";

// Symbols that identify exactly ONE currency. A symbol shared by several — "kr" is Swedish,
// Norwegian AND Danish; "$" alone is already a stretch — is NOT a reading, and anything not on
// this list stays null rather than becoming a guess.
const UNAMBIGUOUS_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₺": "TRY",
  "₽": "RUB",
  "₹": "INR",
  "₪": "ILS",
  "﷼": "SAR",
  "د.إ": "AED",
};

/**
 * The currency code a document printed, or null when it printed nothing readable.
 *
 * Accepts an ISO 4217 code as printed ("EUR", "usd") and the handful of symbols that mean one
 * currency and no other. Everything else — "kr", "$", a price, a stray word — is null, because a
 * currency we half-recognise is worse than one we never read: it would hold a euro invoice, or
 * name the wrong money on a screen the owner is meant to trust.
 */
export function readCurrencyCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  const symbol = UNAMBIGUOUS_SYMBOLS[trimmed];
  if (symbol) return symbol;
  const upper = trimmed.toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/** True only for a currency we actually READ and that is not the home one. */
export function isForeignCurrency(raw: string | null | undefined): boolean {
  const code = readCurrencyCode(raw);
  return code != null && code !== HOME_CURRENCY;
}

export interface ForeignCurrencyHold {
  /** Whether this document must wait for a human instead of booking itself as euros. */
  hold: boolean;
  /** The code as we read it — null when nothing was read, so the caller never invents one. */
  code: string | null;
}

/**
 * The whole decision, in one place, so every door asks the same question.
 *
 * Note what is NOT here: no rate, no conversion, no "approximately". The answer is a hold and a
 * name, and the owner supplies the euro amount their bank actually took — which is the only
 * figure the Belastingdienst is interested in anyway.
 */
export function foreignCurrencyHold(currency: string | null | undefined): ForeignCurrencyHold {
  const code = readCurrencyCode(currency);
  if (code == null || code === HOME_CURRENCY) return { hold: false, code };
  return { hold: true, code };
}
