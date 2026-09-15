// src/lib/dba-lines.ts
// [DBA-DOSSIER] WHICH words the opdrachtgever panel says, apart from the panel that says them.
// Pure, no I/O. Run: npx tsx --test src/lib/dba-lines.test.ts
//
// It lives here for two reasons, and both are rules this repo already keeps.
//
// [TAAL] A component holds no language of its own. The panel renders what it is handed; the
// choices — is this opdrachtgever new or old, is there a rate to name, is there anything to say
// about acquisition at all — are made here, against keys.
//
// And a screen that decides inside JSX cannot be tested. The panel fetches on mount and renders
// NOTHING until the answer arrives, by design ([NO-SILENT-EMPTY]) — so a server render can never
// reach the branches below, whatever rows it is handed. Deciding here means the branches are
// ordinary functions with ordinary tests, which is the only way the empty cases get checked: an
// opdrachtgever with no dated invoice, a klant with no rate, a year that won nobody.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the KEYS resolve to Dutch,
// which is what the entrepreneur reads.

import type { MessageKey } from "./i18n/messages";
import type { OpdrachtgeverDossier, OpdrachtgeverDossierRow } from "./opdrachtgevers";

/** One phrase: the key to render and what to fill in. Params are already formatted for reading. */
export interface DossierPhrase {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Formats an amount the way the owner reads it. Injected so this module stays pure. */
export type MoneyFormat = (amount: number) => string;

/**
 * The muted line under an opdrachtgever's name: how long, how often, at what price.
 *
 * Every part is omitted when it is not KNOWN, never filled with a stand-in. "sinds —" invites the
 * reader to believe a date was looked up and found empty, and "€ 0 per uur" is a claim about the
 * owner's own pricing. An empty array is the honest answer for a row that has none of the three.
 */
export function dossierRowPhrases(row: OpdrachtgeverDossierRow, money: MoneyFormat): DossierPhrase[] {
  const out: DossierPhrase[] = [];

  // Won this year and "since 2019" answer the same question, so only one of them is said. The
  // first is the more specific fact, and it is the one the year is about.
  if (row.wonThisYear) out.push({ key: "dba.nieuw" });
  else if (row.since) out.push({ key: "dba.sinds", params: { jaar: row.since.slice(0, 4) } });

  // A start year alone cannot tell an opdrachtgever running unbroken since 2023 from one that
  // billed twice and stopped. The month count is the half of "how long" that says which.
  if (row.monthsActive === 1) out.push({ key: "dba.maandEen" });
  else if (row.monthsActive > 1) out.push({ key: "dba.maanden", params: { n: row.monthsActive } });

  if (row.agreedRate !== null) out.push({ key: "dba.tarief", params: { bedrag: money(row.agreedRate) } });

  return out;
}

/**
 * The sentence about the owner's own conduct: who they won this year, and what they charge.
 *
 * Silent when there is nothing to state — nobody new, and fewer than two recorded rates — because
 * a line that always appears stops being read. Never a verdict: a range is a measurement.
 */
export function dossierSummaryPhrases(dossier: OpdrachtgeverDossier, money: MoneyFormat): DossierPhrase[] {
  const out: DossierPhrase[] = [];

  if (dossier.wonThisYear === 1) out.push({ key: "dba.gewonnenEen" });
  else if (dossier.wonThisYear > 1) out.push({ key: "dba.gewonnen", params: { n: dossier.wonThisYear } });

  const spread = dossier.rateSpread;
  if (spread) {
    out.push(
      spread.low === spread.high
        ? { key: "dba.tariefGelijk", params: { bedrag: money(spread.low) } }
        : { key: "dba.tariefBereik", params: { laag: money(spread.low), hoog: money(spread.high) } },
    );
  }

  return out;
}
