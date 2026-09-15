// src/lib/accountant-pricing.ts
// [KANTOOR-STAFFEL] The price of the boekhouder portal above the free boundary — one source for
// both the billing code and the published Terms.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// READ THIS FIRST: WHAT THIS FILE IS AND IS NOT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// It is NOT an activated price. `ACCOUNTANT_PRICING_ACTIVE` is false, and while it is false the
// portal is free above the boundary too, exactly as §5.8.1 of the Terms says. Nothing here bills
// anyone. It is a PREPARED price: written down, published in the Terms as prepared-not-active, so
// an office can read what is coming before it arrives instead of being surprised by it later.
//
// It exists because the alternative was worse. The Terms previously committed to a rate "per
// gekoppelde klant per maand" — a shape, promised in public, chosen before a single office had
// been spoken to. Removing a published commitment costs nothing today and is impossible after the
// first office signs, so it was removed while it was still free to remove.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHY THE TERMS RENDER FROM THIS FILE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Because they already drifted apart once. In July 2026 the published Terms quoted plans of € 25
// and € 45 while the database CHECK constraint knew a different four-tier model, and neither knew
// about the other; MARKTPOSITIE_2026.md recorded it as a stop point. Prose and constants that
// describe the same number in two places disagree eventually — not through carelessness, but
// because changing one of them is a complete-looking change.
//
// So `algemene-voorwaarden.ts` carries a `[TARIEF-STAFFEL]` token and `fillAccountantPricing()`
// replaces it with the table generated below. There is no second copy to forget. The guard is
// accountant-pricing.test.ts, which asserts the RENDERED document contains the numbers this file
// defines — so a change here that never reaches /voorwaarden fails the build.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// HOW THESE NUMBERS WERE CHOSEN — AND HOW MUCH TO TRUST THEM
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Honestly: not much, and the owner asked for them anyway, knowing that. There has been no
// conversation with an administratiekantoor. Stop points 2, 5 and 8 of MARKTPOSITIE_2026.md all
// remain open, and every one of them can move these numbers.
//
// What they ARE anchored on, with the reliability marks from that same study:
//
//   · Basecone (Wolters Kluwer)  ± € 7,50 per administratie   [unverified, partly 2017–2021]
//   · TriFact365                 € 2,50 → € 0,99 per administratie  [unverified]
//   · A2X / Link My Books        from ± $ 25–29 per channel per month  [verified, July 2026]
//   · The study's own target     "test € 150 per office per month"
//
// The bands below work out to € 1,96–€ 4,45 per linked client: above TriFact365's floor, well
// under Basecone, and the top band lands on the € 150 the study wanted tested. That is a
// defensible position between the two Dutch reference points, and it is still a guess about
// willingness to pay, not a measurement of it.
//
// WHY A BAND AND NOT A PER-CLIENT RATE. A per-client rate makes an office's bill grow in a
// straight line with its own growth, which turns every new client into a moment to reconsider the
// software. A band makes one client extra cost nothing until the office crosses into the next
// one. It is also the shape an office can predict a year ahead, which is what a fixed cost line
// has to be to stop being examined.
//
// WHY NOT ONE FLAT FEE PER OFFICE. Because an office with 11 clients and one with 60 are not the
// same customer, and a single fee either prices the small one out or leaves the large one paying
// less than it costs to serve.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// HOW TO CHANGE OR REVERT THIS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//   Change a price          edit `monthlyExclBtw` below. The Terms follow on the next build; there
//                           is nothing else to update. The test will tell you if a number failed
//                           to reach the rendered page.
//   Change the bands        edit ACCOUNTANT_BANDS. Keep it sorted and keep the last entry's
//                           `upTo: null` — that is the open-ended top band.
//   Postpone the whole      leave ACCOUNTANT_PRICING_ACTIVE false. That is the current state and
//   thing                   it is a complete, publishable state, not an unfinished one.
//   Undo it entirely        `git revert` the commit that introduced this file. It restores the
//                           previous §5.8 text verbatim, including the per-client wording.
//
// ACTIVATING is deliberately not just this flag: §5.8.1 and §5.5 promise 30 days' notice by
// e-mail, no retroactive billing, and no automatic collection without explicit confirmation.
// Flipping the flag without sending that notice breaks a published promise. The flag is the last
// step, not the first.

// [CENT] Cent rounding comes from invoice-totals.round2 and is never written again here. The
// lifecycle gate enforces that: two roundings that agree today diverge the first time one of them
// is "improved", and a price is exactly where that must not happen.
import { round2 } from "./invoice-totals";
import { PLUS_PRICE_EUR } from "./fair-use";

/** 21% — the Dutch standard rate. Portal access is a digital service; no exemption applies. */
const BTW_RATE = 0.21;

/**
 * The master switch. While this is false the boekhouder portal is free above the boundary too,
 * and the Terms say so in those words. See the activation note above before flipping it.
 */
export const ACCOUNTANT_PRICING_ACTIVE = false;

export interface AccountantBand {
  /** Highest client count still inside this band; null means "and everything above". */
  upTo: number | null;
  /** Euro per month per office, EXCLUDING btw. */
  monthlyExclBtw: number;
}

/**
 * The bands, by number of linked clients. The first band is the free boundary that already
 * existed (ACCOUNTANT_FREE_CLIENTS in fair-use.ts) and is repeated here so the table renders as
 * one continuous ladder — a table that starts at 11 reads as if something was left out.
 */
export const ACCOUNTANT_BANDS: readonly AccountantBand[] = [
  { upTo: 10, monthlyExclBtw: 0 },
  { upTo: 25, monthlyExclBtw: 49 },
  { upTo: 50, monthlyExclBtw: 89 },
  { upTo: null, monthlyExclBtw: 149 },
];

/**
 * Euro as the Netherlands writes it: "€ 49,00". Exported because /voor-boekhouders renders the
 * same ladder as the Terms do, and a second copy of this format is how "€ 49.00" reaches a page.
 */
export function euro(amount: number): string {
  return `€ ${amount.toFixed(2).replace(".", ",")}`;
}

/** The same amount with btw added, for the line that shows both. */
export function inclBtw(exclBtw: number): number {
  return round2(exclBtw * (1 + BTW_RATE));
}

/**
 * The band an office with this many linked clients falls in. Returns the free band for zero or
 * negative input rather than throwing: a count that low is a caller bug, and charging is the
 * wrong way to report one.
 */
export function bandFor(linkedClients: number): AccountantBand {
  for (const band of ACCOUNTANT_BANDS) {
    if (band.upTo === null || linkedClients <= band.upTo) return band;
  }
  // Unreachable while the last band is open-ended; kept so a mis-edit fails loudly here rather
  // than silently billing an office nothing.
  throw new Error("ACCOUNTANT_BANDS has no open-ended top band");
}

/**
 * What an office pays per month, in euro excluding btw. Zero while the pricing is not active —
 * this is the function billing code must call, so that the master switch cannot be bypassed by
 * reading the band table directly.
 */
export function monthlyChargeExclBtw(linkedClients: number): number {
  if (!ACCOUNTANT_PRICING_ACTIVE) return 0;
  return bandFor(linkedClients).monthlyExclBtw;
}

/** The same amount with btw removed — Plus is a consumer price, so it is quoted INCLUDING btw. */
export function exclBtw(inclBtwAmount: number): number {
  return round2(inclBtwAmount / (1 + BTW_RATE));
}

/**
 * The first band an office actually pays for. The honest place to compare anything against,
 * because the free band compares against nothing.
 */
export function firstPaidBand(): AccountantBand | null {
  return ACCOUNTANT_BANDS.find((b) => b.monthlyExclBtw > 0) ?? null;
}

/**
 * ─── [PROVISIE-REKENSOM] The commission we do not pay, priced ────────────────────────────────
 *
 * Every office asks whether it gets a cut for bringing its clients in, and "no" on its own reads
 * as "not yet". So the answer carries the arithmetic: what a commission COULD be worth, next to
 * what the office already does not pay for the portal.
 *
 * This is a CEILING, deliberately generous to the commission it argues against:
 *   · it assumes EVERY linked client pays Plus, while Plus is only charged above the fair-use
 *     boundary — most clients pay nothing, so the real figure is lower;
 *   · it takes the whole rate off our revenue before any cost, as if serving the client were free.
 *
 * `rate` is a HYPOTHESIS, not an offer, and nothing bills from this function — it exists to be
 * rendered beside bandFor().monthlyExclBtw on /voor-boekhouders. If the ceiling is the larger of
 * the two, the office is being asked to pay the portal price so that we can hand most of it back.
 */
export const REFERRAL_RATE_HYPOTHESIS = 0.2;

export function referralCeilingExclBtw(
  linkedClients: number,
  rate: number = REFERRAL_RATE_HYPOTHESIS,
): number {
  if (!Number.isFinite(linkedClients) || linkedClients <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return round2(Math.trunc(linkedClients) * exclBtw(PLUS_PRICE_EUR) * rate);
}

/** The band table as markdown, for the Terms. Both amounts, because the reader reclaims the btw. */
export function pricingTableMarkdown(): string {
  const rows = ACCOUNTANT_BANDS.map((band, i) => {
    const from = i === 0 ? 1 : (ACCOUNTANT_BANDS[i - 1]!.upTo ?? 0) + 1;
    const range =
      band.upTo === null ? `${from} of meer` : from === 1 ? `tot en met ${band.upTo}` : `${from} – ${band.upTo}`;
    const price =
      band.monthlyExclBtw === 0
        ? "**€ 0** — gratis"
        : `**${euro(band.monthlyExclBtw)}** per maand excl. btw (${euro(inclBtw(band.monthlyExclBtw))} incl.)`;
    return `| ${range} | ${price} |`;
  });
  return ["| Gekoppelde klanten | Per kantoor per maand |", "|---|---|", ...rows].join("\n");
}

/**
 * Fill the pricing placeholder in a legal markdown document. Same shape as fillCompanyIdentity in
 * content/legal/company.ts, and for the same reason: the document is one long string, and a token
 * swap is the only way to keep a generated table inside it without turning the whole document
 * into a template literal.
 */
export function fillAccountantPricing(md: string): string {
  return md.replaceAll("[TARIEF-STAFFEL]", pricingTableMarkdown());
}
