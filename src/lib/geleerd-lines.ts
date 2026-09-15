// src/lib/geleerd-lines.ts
// [GELEERD-SINDSDIEN] WHICH words the second-look panel says, apart from the panel.
// Pure, no I/O. Run: npx tsx --test src/lib/geleerd-lines.test.ts
//
// [TAAL] A component holds no language of its own. And here the words carry the whole argument:
// the owner archived these invoices on purpose, so a list of them with a button is an accusation.
// Naming WHAT the reader has learned since is what turns it into an offer.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the KEYS resolve to Dutch.

import type { MessageKey } from "./i18n/messages";
import type { ReaderCapability } from "./geleerd-sindsdien";

export interface LearnedPhrase {
  key: MessageKey;
  params?: Record<string, string | number>;
}

const CAPABILITY_KEY: Record<ReaderCapability["key"], MessageKey> = {
  btw_split: "gl.leerBtw",
  statiegeld: "gl.leerStatiegeld",
};

/**
 * What the reader gained after this invoice was read, in the owner's words.
 *
 * One sentence per capability and never a summary of "improvements": a generic "we got better"
 * is exactly the claim an owner has no way to check, and this list exists because a check IS
 * possible — the invoice is still there and it can be read again.
 */
export function learnedPhrases(gained: readonly ReaderCapability["key"][]): LearnedPhrase[] {
  const seen = new Set<string>();
  const out: LearnedPhrase[] = [];
  for (const g of gained) {
    const key = CAPABILITY_KEY[g];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key });
  }
  return out;
}

/** The count and the money above the list. The amount is the reason anyone reads further. */
export function summaryPhrase(count: number, money: string): LearnedPhrase {
  return count === 1
    ? { key: "gl.samenEen", params: { bedrag: money } }
    : { key: "gl.samen", params: { n: count, bedrag: money } };
}
