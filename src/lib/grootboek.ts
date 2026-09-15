// src/lib/grootboek.ts
// [GROOTBOEK] Which cost account a purchase invoice belongs on. Pure, no I/O.
// Run: npx tsx --test src/lib/grootboek.test.ts
//
// ── WHY ──
//
// The auditfile this app already writes carries ONE cost account: 4000 "Kosten", mapped to the
// GROUP code WBed. xaf-export.ts says why in its own words — "the group-level WOmz / WBed where
// the leaf depends on facts the app does not hold". Those facts are exactly what this module
// starts holding: every purchase invoice, whatever it was for, currently lands on the same line.
//
// That is the first thing an accountant notices, and it is the difference between an export they
// can import and one they have to re-code by hand. It is also the piece that makes automatic
// booking mean anything: "we read the invoice" is not bookkeeping; "we read the invoice and it
// belongs on Huisvestingskosten, because that is where you put this landlord's last four" is.
//
// ── RELATION TO bank-categories.ts ──
//
// A different axis, deliberately. That vocabulary answers "is this money a cost, revenue, privé
// or a transfer" for a BANK LINE, and feeds the P&L role. This one answers "WHICH cost" for a
// DOCUMENT. Neither replaces the other and neither may be derived from the other.
//
// ── THE RGS RULE, INHERITED VERBATIM ──
//
// xaf-export.ts: "a missing code is a lookup, a wrong code is a misfiled administration". So an
// account carries an RGS reference only when the code was verified against the public registry;
// every other account carries null and is still a perfectly good account with a Dutch name and a
// number. Verified for this table: WKprInh (inkoopwaarde handelsgoederen), WBedHui
// (huisvestingskosten), WBedVkk (verkoop gerelateerde kosten) with leaf WBedVkkRep
// (representatiekosten), WBedKan (kantoorkosten) with leaf WBedKanOka (overige kantoorkosten).
// Vervoerskosten, verzekeringen and algemene kosten could not be verified and stay null.
//
// ── AND IT NEVER BOOKS ──
//
// suggestLedgerAccount returns a suggestion with a confidence and the BASIS it rests on. It is
// read by a screen that asks, never by a writer that decides — [ZELF-EERST]. The default answer
// is the account the app already uses, at confidence 0, which is this module saying "I did not
// decide" rather than quietly picking.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the account names are Dutch
// because a Dutch entrepreneur and their boekhouder read them, and because they are the names the
// auditfile itself carries.

/** One line of the rekeningschema, on the cost side. */
export interface LedgerAccount {
  /** The account number, as it appears in the auditfile. */
  id: string;
  /** Dutch, and the same string the export writes. */
  name: string;
  /** Verified RGS referentiecode, or null when the leaf could not be verified. */
  rgs: string | null;
}

/**
 * The cost accounts an invoice may be booked to.
 *
 * 4000 is first and unchanged: it is what every purchase invoice uses today, and it stays the
 * answer whenever nothing better is known. Adding accounts beside it can only make an export more
 * precise; renaming or renumbering it would silently move history.
 */
export const LEDGER_ACCOUNTS: readonly LedgerAccount[] = [
  { id: "4000", name: "Kosten", rgs: "WBed" },
  { id: "4100", name: "Huisvestingskosten", rgs: "WBedHui" },
  { id: "4200", name: "Verkoopkosten", rgs: "WBedVkk" },
  { id: "4210", name: "Representatiekosten", rgs: "WBedVkkRep" },
  { id: "4300", name: "Kantoorkosten", rgs: "WBedKan" },
  { id: "4310", name: "Overige kantoorkosten", rgs: "WBedKanOka" },
  { id: "4400", name: "Vervoerskosten", rgs: null },
  { id: "4500", name: "Verzekeringen", rgs: null },
  { id: "4600", name: "Algemene kosten", rgs: null },
  { id: "7000", name: "Inkoopwaarde handelsgoederen", rgs: "WKprInh" },
] as const;

/** The account every purchase invoice uses today, and the answer when nothing better is known. */
export const DEFAULT_LEDGER_ACCOUNT = "4000";

const BY_ID = new Map(LEDGER_ACCOUNTS.map((a) => [a.id, a]));

/** The account, or undefined for a number this app does not know. Never throws. */
export function ledgerAccount(id: string | null | undefined): LedgerAccount | undefined {
  return BY_ID.get((id ?? "").trim());
}

/** True when this is an account an invoice may actually be stored against. */
export function isLedgerAccount(id: string | null | undefined): boolean {
  return BY_ID.has((id ?? "").trim());
}

/** What a suggestion rests on. The screen turns this into one Dutch sentence. */
export type LedgerBasis =
  /** Every earlier invoice from this supplier went to the same account. */
  | "supplier_history"
  /** The document's own words named it. */
  | "keywords"
  /** Nothing named it — this is the app declining to decide, not deciding on 4000. */
  | "default";

export interface LedgerSuggestion {
  accountId: string;
  /** 0..1. `default` is always 0: an unmade decision has no confidence to report. */
  confidence: number;
  basis: LedgerBasis;
  /** The words that decided it, when words did. Shown so the owner can disagree with a reason. */
  matched?: string;
}

/**
 * The words that name a cost account on a Dutch invoice.
 *
 * Deliberately small and boring. Every entry is a word that means one thing on a supplier
 * invoice — "huur" is rent, "verzekering" is insurance — and anything that could mean two things
 * is left out, because a wrong account is worse than no account: it looks decided.
 *
 * Longest first, so "wegenbelasting" is never matched as "belasting" would be.
 */
const KEYWORDS: readonly { word: string; account: string }[] = [
  { word: "representatie", account: "4210" },
  { word: "huisvesting", account: "4100" },
  { word: "verzekering", account: "4500" },
  { word: "advertentie", account: "4200" },
  { word: "brandstof", account: "4400" },
  { word: "kantoorartikel", account: "4300" },
  { word: "drukwerk", account: "4200" },
  { word: "reclame", account: "4200" },
  { word: "leaseauto", account: "4400" },
  { word: "servicekosten", account: "4100" },
  { word: "energie", account: "4100" },
  { word: "gas en licht", account: "4100" },
  { word: "huurtermijn", account: "4100" },
  { word: "bedrijfspand", account: "4100" },
  { word: "tankstation", account: "4400" },
  { word: "parkeer", account: "4400" },
  { word: "porto", account: "4300" },
  { word: "toner", account: "4300" },
  { word: "papier", account: "4300" },
  { word: "huur", account: "4100" },
];

/** Lowercased, punctuation flattened, so "Huur-termijn" and "huur termijn" read the same. */
function foldForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface LedgerSignals {
  /** The supplier's name as printed. */
  vendor?: string | null;
  /** The document's description / line text, if any. */
  description?: string | null;
  /**
   * The accounts this owner booked EARLIER invoices from this same supplier to. Empty when the
   * supplier is new, which is a fact about the history and not about the invoice.
   */
  supplierHistory?: readonly string[];
}

/**
 * Suggest where this purchase invoice belongs. Pure; suggests, never books.
 *
 * The supplier's own history outranks the document's words, and it is required to be UNANIMOUS.
 * A supplier the owner has split across two accounts is a supplier whose invoices differ — a
 * landlord who also bills for cleaning — and guessing the majority there would be wrong exactly
 * on the invoices that are worth getting right. So it falls through to the words instead.
 */
export function suggestLedgerAccount(signals: LedgerSignals): LedgerSuggestion {
  const history = (signals.supplierHistory ?? [])
    .map((a) => (a ?? "").trim())
    .filter((a) => isLedgerAccount(a));
  if (history.length > 0) {
    const distinct = new Set(history);
    if (distinct.size === 1) {
      const only = [...distinct][0];
      // One earlier invoice is a habit forming; several are a habit. Never certainty: the owner
      // has always been able to move it, and this is the number that decides whether we ask.
      return { accountId: only, confidence: history.length >= 3 ? 0.95 : 0.8, basis: "supplier_history" };
    }
  }

  const haystack = foldForMatch(`${signals.vendor ?? ""} ${signals.description ?? ""}`);
  if (haystack) {
    for (const { word, account } of KEYWORDS) {
      if (haystack.includes(foldForMatch(word))) {
        return { accountId: account, confidence: 0.6, basis: "keywords", matched: word };
      }
    }
  }

  // Not "4000 with low confidence" — 4000 is where it goes today and where it stays until
  // somebody knows better. Confidence 0 is this module saying it did not decide.
  return { accountId: DEFAULT_LEDGER_ACCOUNT, confidence: 0, basis: "default" };
}
