// src/lib/plus-price.ts
// [PLUS-PRIJS] The monthly amount, written in exactly one place, rendered everywhere else.
//
// It lives in its own file rather than in fair-use.ts because the Terms import it, and
// fair-use.ts imports plan limits that legal text has no business pulling in. Small file, one
// job, no cycle.
//
// ── WHY A TOKEN IN THE TERMS ──
// §5 used to type "€12,99" while fair-use.ts held 12.99 as a number — the same defect §5.8 was
// already fixed for with [TARIEF-STAFFEL], and in July 2026 that one had the published document
// quoting € 25 and € 45 while the database knew a different model. Two copies of one price
// disagree eventually; the copy a user can enforce is the published one. So the document carries
// a token and the number arrives from the constant at build time.

import { PLUS_PRICE_EUR } from "./fair-use";

/** Dutch notation, always two decimals: "€ 19,99". */
export function plusPriceLabel(): string {
  return `€${PLUS_PRICE_EUR.toFixed(2).replace(".", ",")}`;
}

/** Fill the [PLUS-PRIJS] placeholder in a legal markdown document. */
export function fillPlusPrice(md: string): string {
  return md.replaceAll("[PLUS-PRIJS]", plusPriceLabel());
}
