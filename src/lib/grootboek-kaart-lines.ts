// src/lib/grootboek-kaart-lines.ts
// [GROOTBOEK-KAART] The sentences the grootboek screen shows. Pure, no React.
//
// The copy lives here for the reason at the top of invoice-sent-notice.ts: one hard-coded string
// left in a component is how a translation stays permanently half-finished — the screen still
// looks right in Dutch, so nothing points at the gap.
//
// Dutch is the source language. The words themselves are the accountant's own vocabulary and are
// NOT translated away: saldibalans, grootboekkaart, journaalpost, debet, credit are what the
// profession calls these things, in the same way btw and kvk are.
// Run: npx tsx --test src/lib/grootboek-kaart-lines.test.ts

import { formatEuroNL } from "./format-nl";

/** The journal codes, as every Dutch package abbreviates them. */
export const JOURNAAL_NAMEN: Readonly<Record<string, string>> = {
  VRK: "Verkoop",
  INK: "Inkoop",
  BNK: "Bank",
  KAS: "Kas",
  OMZ: "Dagomzet",
  MEM: "Memoriaal",
};

/** "Bank", or the raw code when it is one this screen has not been taught. */
export function journaalNaam(code: string): string {
  return JOURNAAL_NAMEN[code] ?? code;
}

/**
 * An amount in the debit or the credit column.
 *
 * A ledger prints an amount in ONE of two columns and leaves the other blank — it never prints a
 * minus sign. That is not decoration: the column IS the sign, and an accountant reading "−1.210,00"
 * in a debit column has to stop and work out which convention this particular screen chose.
 */
export function debetCredit(debitC: number): { debet: string; credit: string } {
  const euro = formatEuroNL(Math.abs(debitC) / 100);
  return debitC >= 0 ? { debet: euro, credit: "" } : { debet: "", credit: euro };
}

/**
 * The closing balance of one account, as a Dutch ledger states it: an amount and the side it
 * stands on. Never a negative number.
 */
export function saldoZin(balanceC: number): string {
  if (balanceC === 0) return "€ 0,00";
  const euro = formatEuroNL(Math.abs(balanceC) / 100);
  return `${euro} ${balanceC > 0 ? "debet" : "credit"}`;
}

/**
 * The result, said the way a business owner reads it rather than the way the ledger stores it.
 *
 * `resultC` is debit-positive, so a PROFIT arrives negative. Printing that as "−12.500" on the
 * owner's screen would be exactly wrong to the only person it is addressed to.
 */
export function resultaatZin(resultC: number): string {
  const euro = formatEuroNL(Math.abs(resultC) / 100);
  if (resultC === 0) return "Resultaat € 0,00";
  return resultC < 0 ? `Winst ${euro}` : `Verlies ${euro}`;
}

/**
 * What the page says about its own completeness.
 *
 * Two things can be wrong and neither is visible in the numbers: the set may not balance, and
 * documents the journal REFUSED are missing from it. A ledger that is short a booking looks
 * exactly like one that is complete — the same argument the auditfile makes in its own header.
 */
export function volledigheidZin(input: { balanced: boolean; skippedCount: number; unknownAccounts: readonly string[] }): string | null {
  const stukken: string[] = [];
  if (!input.balanced) {
    stukken.push("debet en credit zijn niet gelijk — deze boekhouding sluit niet");
  }
  if (input.skippedCount > 0) {
    stukken.push(
      input.skippedCount === 1
        ? "1 stuk staat niet in dit overzicht omdat het niet geboekt kon worden"
        : `${input.skippedCount} stukken staan niet in dit overzicht omdat ze niet geboekt konden worden`,
    );
  }
  if (input.unknownAccounts.length > 0) {
    stukken.push(`onbekende rekening: ${input.unknownAccounts.join(", ")}`);
  }
  return stukken.length === 0 ? null : stukken.join(" · ");
}

/** "3 mutaties" / "1 mutatie" — a count that reads as Dutch. */
export function mutatieTelling(n: number): string {
  return n === 1 ? "1 mutatie" : `${n} mutaties`;
}
