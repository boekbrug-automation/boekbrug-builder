// src/lib/grootboek-lines.ts
// [GROOTBOEK] WHICH words the ledger screen says about a suggestion, apart from the screen.
// Pure, no I/O. Run: npx tsx --test src/lib/grootboek-lines.test.ts
//
// [TAAL] A component holds no language of its own. And the reason a suggestion gives is the whole
// point of suggesting rather than booking: "Huisvestingskosten" on its own is an instruction, and
// "Huisvestingskosten, because you put this supplier there before" is something the owner can
// disagree with. Deciding here rather than in JSX is also what makes the empty case testable —
// the one where the app knows nothing and has to say so.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the KEYS resolve to Dutch.

import type { MessageKey } from "./i18n/messages";
import type { LedgerSuggestion } from "./grootboek";

export interface SuggestionPhrase {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * Why this account is being suggested — never a machine tag, and never silence.
 *
 * `default` is a sentence too, and that is deliberate: an empty reason under a pre-filled account
 * reads as confidence nobody has. The app saying "we do not know, pick one" is the honest version
 * of the same screen.
 */
export function suggestionReason(suggestion: LedgerSuggestion): SuggestionPhrase {
  if (suggestion.basis === "supplier_history") return { key: "gb.waaromVaker" };
  if (suggestion.basis === "keywords" && suggestion.matched) {
    return { key: "gb.waaromWoord", params: { woord: suggestion.matched } };
  }
  // A keyword basis with no word recorded cannot name one; it falls back rather than inventing.
  return { key: "gb.waaromNiets" };
}

/**
 * The count line above the list. Absent when there is nothing left to answer.
 *
 * It names the invoices AND the suppliers, because those are two different sizes and the second
 * one is the actual amount of work: 550 invoices across 101 suppliers is 101 decisions, and an
 * owner told only the first number reads a backlog they will never start.
 */
export function openCountPhrase(openInvoices: number, suppliers: number): SuggestionPhrase {
  if (openInvoices <= 0) return { key: "gb.klaar" };
  if (openInvoices === 1) return { key: "gb.openEen" };
  return { key: "gb.open", params: { n: openInvoices, lev: suppliers } };
}

/** What one supplier's group is worth, so the size of the decision is never hidden. */
export function groupSizePhrase(count: number, money: string): SuggestionPhrase {
  return count === 1
    ? { key: "gb.groepEen", params: { bedrag: money } }
    : { key: "gb.groep", params: { n: count, bedrag: money } };
}
