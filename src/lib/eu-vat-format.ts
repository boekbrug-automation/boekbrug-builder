// src/lib/eu-vat-format.ts
// [EU-BTW] Is this shaped like a VAT number of that country — before anyone asks Europe.
// Pure: no I/O, no clock. Run: npx tsx --test src/lib/eu-vat-format.test.ts
//
// ── WHY A FORMAT CHECK WHEN VIES EXISTS ─────────────────────────────────────────────────────
//
// Because most wrong numbers are typos, and a typo does not need a round trip to Brussels to be
// caught. Checking the shape first means the common mistake is named instantly and offline, and
// VIES is only asked about numbers that could plausibly be real — which also keeps us far below
// any rate limit of a free public service we do not pay for.
//
// It is also the half that keeps working when VIES does not. The European service has scheduled
// downtime per member state, and an app whose only answer is "we could not check" on those days
// is an app that stops helping exactly when someone is doing their quarter.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────
//
// It does not decide that a number is VALID. Shape is not existence: NL999999999B99 is perfectly
// shaped and belongs to nobody. Only VIES can say a number is real, and only for that moment.
// So the answer here is "could be" or "cannot be", never "is" — see EuVatShape.
//
// It also does not run the checksums some countries publish. The Dutch case is the reason and it
// is worth writing down: the old btw-nummer was derived from the RSIN and satisfied an 11-proof,
// and since 2020 the btw-identificatienummer of an eenmanszaak is RANDOM and does not. Applying
// the old proof today rejects real, current numbers of exactly the smallest businesses this
// product is for. A check that refuses a correct number is worse than no check: the owner cannot
// argue with it and has nowhere to go.

/** What a shape check can honestly conclude. */
export type EuVatShape =
  /** Shaped like a VAT number of this country. Says nothing about whether it exists. */
  | { shape: "possible"; country: string; normalised: string }
  /** Cannot be one: wrong length, wrong characters, or a country prefix that is not EU. */
  | { shape: "impossible"; country: string | null; normalised: string; reason: string };

/**
 * The 27 member states, by the pattern their VAT number follows after the country prefix.
 *
 * Source shapes only — no checksums, see the header. Northern Ireland (XI) is included because it
 * still issues EU-VAT-registered numbers for goods under the Protocol, and a Dutch supplier
 * invoicing one has a genuine intra-EU transaction to declare.
 */
const PATTERNS: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W]|\d[A-Z+*]\d{5}[A-W]|\d{7}[A-W][AH])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|(GD|HA)\d{3})$/,
};

/** Every country this module knows, for a picker or a gate. Sorted, so the list is stable. */
export const EU_VAT_COUNTRIES: readonly string[] = Object.keys(PATTERNS).sort();

/**
 * Strip everything a human adds and put it in one casing.
 *
 * Spaces, dots and hyphens go: they are how the number is PRINTED on a letterhead, not how it is
 * registered, and refusing "NL 8220.81297 B01" because of them teaches an owner to distrust the
 * field rather than to fix the number.
 */
export function normaliseEuVat(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\s.\-/]/g, "").toUpperCase();
}

/** The two-letter prefix, or null when the value does not start with one. */
export function vatCountry(raw: string | null | undefined): string | null {
  const value = normaliseEuVat(raw);
  const prefix = value.slice(0, 2);
  return /^[A-Z]{2}$/.test(prefix) ? prefix : null;
}

/**
 * Could this be a VAT number of the country it names?
 *
 * The empty string is impossible rather than possible: an empty field is handled by the caller
 * that knows whether the field is required, and returning "possible" for nothing at all is how a
 * blank ends up beside a green tick.
 */
export function euVatShape(raw: string | null | undefined): EuVatShape {
  const normalised = normaliseEuVat(raw);
  if (normalised === "") {
    return { shape: "impossible", country: null, normalised, reason: "Vul een btw-nummer in" };
  }

  const country = vatCountry(normalised);
  if (country === null) {
    return {
      shape: "impossible",
      country: null,
      normalised,
      reason: "Een btw-nummer begint met een landcode, bijvoorbeeld NL of BE",
    };
  }

  const pattern = PATTERNS[country];
  if (!pattern) {
    return {
      shape: "impossible",
      country,
      normalised,
      reason: `${country} is geen EU-land dat wij kennen — controleer de landcode`,
    };
  }

  if (!pattern.test(normalised.slice(2))) {
    return {
      shape: "impossible",
      country,
      normalised,
      reason: `Dit past niet op de vorm van een ${country}-btw-nummer`,
    };
  }

  return { shape: "possible", country, normalised };
}

/**
 * Is this a VAT number of another EU country than the Netherlands?
 *
 * The question behind the question: an intra-EU supply to a business with a valid foreign VAT
 * number is btw verlegd, and that changes the invoice. So this is not cosmetics — it decides a
 * rubriek. It answers false for anything not shaped like a VAT number at all, because "unknown
 * shape" must never be read as "foreign".
 */
export function isOtherEuCountry(raw: string | null | undefined): boolean {
  const shape = euVatShape(raw);
  return shape.shape === "possible" && shape.country !== "NL";
}
