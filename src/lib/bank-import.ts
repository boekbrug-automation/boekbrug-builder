// lib/bank-import.ts
// [BOEK-016] Pure import helpers: content fingerprint + cross-upload dedup + DB-row mapping.
// No I/O — testable with `npx tsx`. The route (api/bank/upload) is a thin shell over these.
//
// Dedup design — THREE layers, cheapest and most certain first. Each exists because the one
// below it cannot answer the question the one above it answers.
//
//   1. The FILE (bank-ingest.ts). Identical bytes = a statement already imported. Checked before
//      parsing, so a re-upload of the same file does no work and takes no risk.
//   2. The SOURCE'S OWN ID (sourceKey / dedupTransactions layer 1). A bank names every
//      transaction it exports and the name is unique within that export — measured on one real
//      ING quarter: 576 transactions, 576 distinct MT940 `:61:` refs, 576 distinct CAMT
//      <NtryRef>. Backed by a UNIQUE index (bank_tx_source_identity.sql), so it holds even when
//      two writers race — an upload during the daily cron sync — which no application-level
//      read-then-write can promise.
//   3. The CONTENT FINGERPRINT (contentKey). The ONLY layer that recognises the same payment
//      arriving through a DIFFERENT door, because the doors share no ids at all: between that
//      quarter's MT940 and CAMT ids the overlap is ZERO. Necessarily a judgement call, which is
//      why it is last and why bank-parity.test.ts pins it.
//
// Constant across all three: we must NOT collapse legitimate identical transactions inside a
// single statement (two €4 coffees, same day, same description = two real transactions). Hence a
// multiset diff, and hence an existing row may be consumed only ONCE, by whichever layer claims
// it. Under-counting the owner's money is worse than the visible double it would prevent.
//       first upload          → existing 0, file 2 coffees → insert 2
//       re-upload same file    → existing 2, file 2 coffees → insert 0
//       new period (new date)  → different key             → insert as new

import type { BankTransaction } from "./bank-parser";
import { classifyBankTransaction } from "./bank-identity";

/** Row shape inserted into bank_transactions. status starts 'pending' (human confirms later). */
export interface BankTransactionRow {
  user_id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  // [BANK-IBAN] The counterpart's IBAN parsed from the statement — kept so the matcher can pair a
  // payment to the invoice bearing the SAME supplier account (a strong, collision-free signal).
  counterpart_iban: string | null;
  reference: string | null;
  status: "pending";
  // [BANK-AUTOCAT] Structural identity assigned at import (pos_income / fee / tax /
  // transfer / prive). Only the UNAMBIGUOUS, structurally-detectable ones are set; a
  // genuine business line the classifier can't explain stays null for the owner to code
  // as kosten/omzet. Without this every line imported as null, so a retail store's card
  // settlements (AFREK. BETAALAUTOMAAT) never reached the result until manually tagged.
  category: string | null;
  // [DD-SIGNAL] What the statement said the instrument WAS — the bank's own type code, the
  // machtigingskenmerk and the incassant-ID. Raw, never a verdict: readDirectDebit() owns the rule,
  // because the same three markers appear on a STORNO, where the money came back and the invoice
  // is not paid. Null for a format that carries none, which is an honest "this line does not show
  // it" and never "this was not a direct debit".
  type_code: string | null;
  mandate_id: string | null;
  creditor_id: string | null;
  // [BANK-TX-SOURCE-ID] Which door+account delivered this row, and the id that door gave it.
  // Both null when the caller names no source or the source named no id — the unique index
  // treats NULLs as distinct, so those rows stay unconstrained and lean on the fingerprint.
  source: string | null;
  external_id: string | null;
}

/** Subset of an existing DB row needed for dedup (from a scoped SELECT).
 *  [BANK-DEDUP-DOUBLE] `description` is no longer part of the fingerprint (see
 *  contentKey) but is kept here so the upload route's existing SELECT shape stays
 *  unchanged; it is simply ignored by keyOfRow. */
export interface ExistingTxKey {
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
  // [BANK-TX-SOURCE-ID] The identity the source gave this row, when it gave one. Optional so a
  // caller whose SELECT predates the migration still type-checks and simply gets the old
  // content-only behaviour.
  source?: string | null;
  external_id?: string | null;
}

/**
 * [BANK-TX-SOURCE-ID] The exact key, above the fingerprint.
 *
 * A bank names every transaction it exports, and the name is unique within that export: one real
 * ING quarter of 576 transactions carries 576 distinct MT940 `:61:` bank references and 576
 * distinct CAMT `<NtryRef>` values. The parser has always read it (BankTransaction.transactionId);
 * until now nothing stored it.
 *
 * That settles ONE question with certainty — "has this source already delivered this line?" — and
 * it is the question content-matching answers worst, because the fingerprint moves whenever the
 * parser improves. Re-uploading a statement imported before yesterday's MT940 reference fix would
 * insert every line again; keyed on the bank's own id it cannot.
 *
 * It settles NOTHING about the cross-door case. The same 576 transactions have ZERO ids in common
 * between the two formats — ING does not name a payment the same way twice — so `source` is part
 * of the key and the fingerprint below remains the only thing that can bridge doors.
 *
 * Returns null when either half is missing, which is not an error: 147 of that quarter's 576 feed
 * rows carry no `entry_reference` at all. Those simply fall through to the fingerprint.
 */
export function sourceKey(
  source: string | null | undefined,
  externalId: string | null | undefined,
): string | null {
  const s = source?.trim();
  const e = externalId?.trim();
  return s && e ? `${s}|${e}` : null;
}

function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * [BANK-DEDUP-NAME] Format-stable normalization of a counterpart NAME for the
 * dedup fingerprint only (never for storage/display). Lowercases, strips
 * diacritics, and removes every non-alphanumeric character — so punctuation,
 * spacing and legal-form differences that vary between export formats collapse:
 *   MT940-derived "Jansen Bouw B.V."  ==  CSV-column "Jansen Bouw BV"  → "jansenbouwbv"
 *
 * Crucially it KEEPS digits. That is deliberate and load-bearing: two genuinely
 * different same-day, same-amount, reference-less transactions — e.g. two fuel
 * stops "Shell 123" and "Shell 456" — must stay DISTINCT ("shell123" ≠ "shell456"),
 * otherwise the dedup would silently DROP a real transaction and under-state the
 * owner's money. Under-counting is worse than the rare, visible cross-format
 * double-count, so we never strip the distinguishing digits.
 */
function dedupName(s: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, DEDUP_NAME_LENGTH);
}

/**
 * [BANK-DEDUP-TRUNCATED-NAME] How much of a counterpart name the fingerprint looks at.
 *
 * A bank does not send the same name to every door. ING writes
 * "Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf" in CAMT and cuts it to
 * "Stichting Bedrijfstakpensioenfonds voor het Levens" in the MT940 :86: /CNTP/ field \u2014 the same
 * payment, the same download page, two names. Comparing them whole made five lines of one real
 * quarter fingerprint as ten, and it does so for every long name: pension funds, foundations,
 * bedrijfstak schemes \u2014 exactly the counterparties whose names run long.
 *
 * 40 characters AFTER normalization, which is comfortably inside ING's cut (46 normalized) and
 * still 40 distinguishing characters. It cannot silently merge two suppliers: contentKey also
 * carries the date, the amount to the cent and the reference, so a collision needs two
 * counterparties sharing 40 alphanumerics who were paid the identical amount on the identical day
 * under the identical reference.
 *
 * This is safe to change without a migration, unlike the stored columns: both sides of the
 * comparison are hashed at compare time, incoming and stored alike. A bank found truncating
 * SHORTER than this would need the number lowered, and the parity test would be what tells us.
 */
const DEDUP_NAME_LENGTH = 40;

/**
 * Stable content fingerprint for cross-upload dedup.
 *
 * [BANK-DEDUP-DOUBLE] The fingerprint deliberately EXCLUDES `description`. Proven
 * by testing the SAME statement exported as both MT940 and CAMT for one period:
 * the stored description (the raw REMI) differs between the two formats for every
 * transaction — MT940 keeps ING's "USTD//29528/" wrapper, CAMT gives a clean
 * "29528" — so a description-based key never matched across formats and every
 * transaction was re-inserted on the second upload (an exact ×2 doubling of
 * in/uit). date + amount + reference are IDENTICAL across formats; the counterpart
 * NAME is the one field whose representation can differ per format (MT940/CAMT
 * DERIVE it from the REMI, a CSV reads it from a dedicated column), so it is
 * normalized via dedupName — collapsing "B.V." vs "BV" while keeping the digits
 * that distinguish separate transactions. Verified 30/30 match on MT940↔CAMT with
 * zero collisions (incl. 20 reference-less POS settlements distinguished by amount).
 *
 * [BANK-DEDUP-CSV] CSV↔MT940/CAMT re-upload of the SAME period: invoice transfers
 * (a real counterparty name) now dedup across formats thanks to dedupName. Card/POS
 * lines whose CSV column name carries a terminal/store number the derived MT940 name
 * lacks (e.g. "Albert Heijn 1234" vs "Albert Heijn") can still both import — the
 * accepted residual edge, chosen over merging distinct transactions. Same-FORMAT
 * re-upload (the common case) always dedups exactly. Two genuinely identical
 * transactions in one statement would still collapse — the documented, accepted edge.
 */
export function contentKey(
  date: string | null,
  amount: number | null,
  counterpart: string | null,
  reference: string | null
): string {
  return [
    date ?? "",
    (amount ?? 0).toFixed(2),
    dedupName(counterpart),
    norm(reference),
  ].join("|");
}

function keyOfTx(t: BankTransaction): string {
  return contentKey(t.date, t.amount, t.counterpartName, t.reference);
}

function keyOfRow(r: ExistingTxKey): string {
  return contentKey(r.date, r.amount, r.counterpart_name, r.reference);
}

/** Min/max ISO date in a transaction list — used to scope the existing-rows query. */
export function dateRange(transactions: BankTransaction[]): {
  min: string | null;
  max: string | null;
} {
  const dates = transactions.map((t) => t.date).filter(Boolean).sort();
  return { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null };
}

/**
 * Multiset diff: return the transactions to insert (those not already covered by an existing
 * row) plus how many were skipped as duplicates.
 *
 * Two layers, tried in this order, and the order is the whole point:
 *
 *   1. [BANK-TX-SOURCE-ID] the source's own id, when both sides carry one. Exact, and immune to
 *      the parser changing its mind about a name or a reference between two uploads.
 *   2. [BANK-DEDUP-DOUBLE] the content fingerprint. The only layer that can recognise the same
 *      payment arriving through a DIFFERENT door, because the doors share no ids.
 *
 * An existing row explains at most ONE incoming transaction, whichever layer claimed it. Without
 * that bookkeeping a statement holding two genuinely identical lines (two €4 coffees, same day,
 * no reference) could see both matched against the single stored row, and one real transaction
 * would be dropped — under-counting the owner's money, which is worse than the double it prevents.
 *
 * `source` names the door and account the incoming batch came from; pass null when the caller has
 * none and layer 1 simply does not run.
 */
export function dedupTransactions(
  incoming: BankTransaction[],
  existing: ExistingTxKey[],
  source?: string | null,
): { toInsert: BankTransaction[]; skipped: number } {
  // A row may be consumed once. Indexes below hold positions into `existing`, not rows.
  const consumed = new Array<boolean>(existing.length).fill(false);
  const bySource = new Map<string, number[]>();
  const byContent = new Map<string, number[]>();

  const index = (map: Map<string, number[]>, k: string, i: number) => {
    const list = map.get(k);
    if (list) list.push(i);
    else map.set(k, [i]);
  };

  existing.forEach((r, i) => {
    const sk = sourceKey(r.source, r.external_id);
    if (sk) index(bySource, sk, i);
    index(byContent, keyOfRow(r), i);
  });

  /** Consume the first not-yet-consumed row under `k`, or report that there is none. */
  const claim = (map: Map<string, number[]>, k: string | null): boolean => {
    if (!k) return false;
    const list = map.get(k);
    if (!list) return false;
    while (list.length > 0) {
      const i = list.shift() as number;
      if (!consumed[i]) {
        consumed[i] = true;
        return true;
      }
    }
    return false;
  };

  // [REKENING-IN-SLEUTEL] The account half of a stored `source` ("MT940:NL91…" → "NL91…").
  // Layer 1 is already account-scoped; layer 2 was not, and the content fingerprint carries no
  // account — so the SAME package fee, same day, same amount, no reference, debited from TWO
  // business accounts had its second line counted as a duplicate of the first and silently
  // dropped: money under-stated, and the owner told "1 dubbel overgeslagen" about a real
  // transaction. A row from a provably DIFFERENT account may not explain an incoming line.
  // Either side without an account (legacy rows, a CSV that names none) stays compatible — the
  // pre-existing dedup behaviour, because "unknown" must never read as "different".
  // …and "provably different" is a claim only a STABLE identity can make. The file formats put
  // an IBAN after the colon; Enable Banking puts a SESSION handle there, which legitimately moves
  // at every reconnect — the moved-scope recovery below layer 1 depends on layer 2 still matching
  // then, so a moved handle must read as "unknown", never as "different". Hence: the account
  // check only fires when BOTH suffixes are real IBANs.
  const accountOf = (src: string | null | undefined): string => {
    const at = (src ?? "").indexOf(":");
    const suffix = at >= 0 ? (src ?? "").slice(at + 1).trim().toUpperCase() : "";
    return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(suffix) ? suffix : "";
  };
  const incomingAccount = accountOf(source);
  /** Like claim(), but a row only qualifies when its account is COMPATIBLE with the batch's.
   *  Non-destructive scan: an incompatible row stays available for its own account's upload. */
  const claimContent = (k: string): boolean => {
    const list = byContent.get(k);
    if (!list) return false;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      if (consumed[i]) continue;
      const rowAccount = accountOf(existing[i].source);
      if (incomingAccount && rowAccount && rowAccount !== incomingAccount) continue;
      consumed[i] = true;
      list.splice(n, 1);
      return true;
    }
    return false;
  };

  const toInsert: BankTransaction[] = [];
  let skipped = 0;

  for (const t of incoming) {
    if (claim(bySource, sourceKey(source, t.transactionId))) {
      skipped++;
      continue;
    }
    if (claimContent(keyOfTx(t))) {
      skipped++;
      continue;
    }
    toInsert.push(t);
  }

  return { toInsert, skipped };
}

/** Map parsed transactions → insertable rows (status 'pending', user_id pinned by caller).
 *  [BANK-TX-SOURCE-ID] `source` names the door+account; it is stored alongside the id the source
 *  gave each transaction so the next import can recognise these rows exactly. */
export function mapToRows(
  transactions: BankTransaction[],
  userId: string,
  source?: string | null,
): BankTransactionRow[] {
  return transactions.map((t) => {
    // Auto-classify the structural identities (card takings, fees, tax, transfers, privé).
    // 'unknown' → null so the genuine business lines still go through human coding.
    const id = classifyBankTransaction(t.counterpartName, t.description, t.amount);
    return {
      user_id: userId,
      date: t.date || null,
      amount: t.amount,
      description: t.description || null,
      counterpart_name: t.counterpartName,
      counterpart_iban: t.counterpartIban ?? null, // [BANK-IBAN] store for supplier-account matching
      reference: t.reference,
      status: "pending" as const,
      category: id === "unknown" ? null : id,
      // Only ever both-or-neither: a source without an id constrains nothing, and an id without
      // its source would claim uniqueness across doors that provably disagree.
      source: sourceKey(source, t.transactionId) ? (source as string) : null,
      external_id: sourceKey(source, t.transactionId) ? (t.transactionId as string) : null,
      // [DD-SIGNAL] What the statement said about the instrument, kept raw — the verdict is
      // derived by readDirectDebit(), never stored, so a row cannot drift from the rule. Rides the
      // same 42703 strip as counterpart_iban/source/external_id: before bank_tx_direct_debit.sql
      // is applied these three simply do not travel, and the import behaves exactly as it did.
      type_code: t.typeCode ?? null,
      mandate_id: t.mandateId ?? null,
      creditor_id: t.creditorId ?? null,
    };
  });
}

/** A stored bank_transactions row, as selected for the matching run (phase 3). */
export interface BankTransactionDbRow {
  id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  counterpart_iban?: string | null; // [BANK-IBAN] supplier account, for IBAN matching (optional)
  reference: string | null;
  // [BANK-MULTI-LINK-PERSIST] A partially-linked multi-invoice tx keeps
  // status='pending' but already carries an invoice_id (the last invoice paid
  // against it). The match route needs both to tell the UI "this one is partially
  // done — keep it in Te bevestigen until allCovered", surviving a page reload.
  invoice_id?: string | null;
  status?: string | null;
  // [DD-NAAR-MATCHER] The bank's own direct-debit markers, as bank_tx_direct_debit.sql stores them.
  // They were written on import and read by /bank's storno card, but never by the MATCHER — this
  // function is where the pipe was cut. See rowToTransaction below.
  type_code?: string | null;
  mandate_id?: string | null;
  creditor_id?: string | null;
}

/**
 * Map a stored row back into the canonical BankTransaction shape the matcher consumes.
 * The DB row id is carried in `transactionId` so suggestions tie back to the exact row.
 */
export function rowToTransaction(r: BankTransactionDbRow): BankTransaction {
  return {
    date: r.date ?? "",
    amount: r.amount ?? 0,
    currency: "EUR",
    description: r.description ?? "",
    counterpartName: r.counterpart_name,
    counterpartIban: r.counterpart_iban ?? null, // [BANK-IBAN] now stored → used by the matcher
    reference: r.reference,
    transactionId: r.id, // carry DB id → ties a suggestion to its transaction
    rawLine: "",
    // [DD-NAAR-MATCHER] The three markers bank_tx_direct_debit.sql added, carried through.
    //
    // They were being dropped HERE, one line short of the matcher, and the loss was invisible from
    // both ends. The /bank route selects all three by name and pairs stornos with them; the parsers
    // fill them from four different formats; BankTransaction has declared them since [DD-SIGNAL].
    // Only this mapper — the single door every STORED row walks through on its way to scoring —
    // left them behind, so `tx.mandateId` was `undefined` in every scorePair call the app has ever
    // made, on the screen and in the unattended hourly pass alike.
    //
    // What that cost, measured: a supplier's failed collection (money the bank RETURNED, positive
    // amount, NDDT + a machtigingskenmerk) scored 0.950 against an open SALES invoice of the same
    // amount to the same company, reached 'auto', and the amount_only tier BOOKED it — a customer
    // marked paid off money that came back from a supplier, with nobody watching. See the cap in
    // bank-matching.ts, which can only fire once these arrive.
    typeCode: r.type_code ?? null,
    mandateId: r.mandate_id ?? null,
    creditorId: r.creditor_id ?? null,
  };
}