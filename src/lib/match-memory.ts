// src/lib/match-memory.ts
// [GEHEUGEN] What the owner has already told us, by confirming. Pure.
// Run: npx tsx --test src/lib/match-memory.test.ts
//
// Every signal the matcher weighs is read off the payment itself: the number printed on it, the
// account it went to, the name the bank wrote, how close the date is. All of it is inference about
// a line the app is seeing for the first time.
//
// It is not the first time. The owner has confirmed this counterparty before — that is what a
// bank_tx_invoices row IS — and the app knew and never asked. A supplier whose statement line the
// bank mangles ("SUMUP *JANSEN" against an invoice from "Jansen Bouw B.V.") fails
// isStrongNameIdentity every month, on purpose: one shared token is the asymmetric surname case
// that rule exists to reject. So every month the same payment is identified by hand, and every
// month the confirmation that would have settled it is thrown away.
//
// ── DERIVED, NOT STORED ──
//
// There is no memory table and no write path. A confirmation already writes a link row, so the
// memory IS the links: transaction → invoice, joined to the counterpart the bank named and the
// party the invoice bills. Three consequences, all of them the reason it is built this way:
//
//   · nothing to migrate, and nothing for an owner to apply before it works;
//   · it cannot drift from reality — unlink a wrong match and the memory it created is gone with
//     it, because it was never anything else;
//   · it is per-owner by construction (the link rows are), so one administration's habits can
//     never leak into another's.
//
// ── ONE COUNTERPART, ONE PARTY ──
//
// A memory only counts as IDENTITY when the counterpart has been confirmed against exactly one
// party. A counterpart that has settled invoices of two different parties is not identity but a
// shared channel — a payment processor, a group account, a bank's own description — and treating
// it as identity would hand this month's payment to whichever of them scored best.
//
// That rule also makes a single mistaken confirmation self-limiting: it can only ever speak about
// the counterpart it was made on, and the moment a second party appears under that counterpart the
// memory stops speaking at all.

import { counterpartKey } from "./bank-identity";
import { normalizeIban } from "./epc-qr";

/** One confirmed settlement, flattened: who the bank named, and who the invoice bills. */
export interface ConfirmedLink {
  counterpartName: string | null;
  counterpartIban: string | null;
  // [INCASSO-IDENTITEIT] The two handles a direct debit carries, from bank_tx_direct_debit.sql.
  // They are remembered on exactly the same terms as the name and the account above — see the
  // block over `byMandate` for why they are worth remembering separately at all.
  mandateId?: string | null;
  creditorId?: string | null;
  /** The invoice's client_name — the supplier on a purchase, the customer on a sale. */
  partyName: string | null;
}

export interface MatchMemory {
  /** counterpart key → the party keys it has settled. More than one ⇒ not identity. */
  byName: Map<string, Set<string>>;
  /** counterpart IBAN → the same. */
  byIban: Map<string, Set<string>>;
  /**
   * [INCASSO-IDENTITEIT] machtigingskenmerk → the same. The mandate is the one handle on a
   * collection that neither of the two above can replace: the bank writes the SCHEME into the
   * counterpart name ("SEPA INCASSO ALGEMEEN DOORLOPEND", "INCASSANT: …") and the collector's
   * clearing account into the IBAN, so a supplier billing monthly by incasso failed both handles
   * every month while the mandate reference on the line stayed byte-identical.
   */
  byMandate: Map<string, Set<string>>;
  /** [INCASSO-IDENTITEIT] incassant-ID → the same. One step weaker than the mandate and kept
   *  separate for it: a mandate is one contract between two parties, while a collector may use one
   *  incassant-ID across several trade names. The one-party rule below is what makes that safe —
   *  an ID that has settled two parties simply stops speaking. */
  byCreditor: Map<string, Set<string>>;
}

export const EMPTY_MATCH_MEMORY: MatchMemory = {
  byName: new Map(), byIban: new Map(), byMandate: new Map(), byCreditor: new Map(),
};

/** The key a party name is remembered under — the same one the bank screens use for counterparts,
 *  so "Enka Horeca B.V." and "ENKA HORECA BV" are one party and not two memories. */
export function partyKey(name: string | null | undefined): string | null {
  return counterpartKey(name ?? null);
}

/** Fold confirmed links into the index the matcher asks. Order does not matter; duplicates are free. */
export function buildMatchMemory(links: readonly ConfirmedLink[]): MatchMemory {
  const byName = new Map<string, Set<string>>();
  const byIban = new Map<string, Set<string>>();
  const byMandate = new Map<string, Set<string>>();
  const byCreditor = new Map<string, Set<string>>();
  const remember = (index: Map<string, Set<string>>, key: string, party: string) => {
    const set = index.get(key) ?? new Set<string>();
    set.add(party);
    index.set(key, set);
  };
  for (const link of links) {
    const party = partyKey(link.partyName);
    if (!party) continue; // an invoice with no party name teaches nothing
    const name = counterpartKey(link.counterpartName);
    if (name) remember(byName, name, party);
    const iban = link.counterpartIban ? normalizeIban(link.counterpartIban) : "";
    if (iban) remember(byIban, iban, party);
    // [INCASSO-IDENTITEIT] Folded on the same terms and with the same key discipline: trimmed and
    // upper-cased, because a bank pads its own columns and a mandate that differs only in case is
    // the same mandate. Empty stays empty — an absent marker teaches nothing, exactly as an absent
    // name does.
    const mandate = mandateKey(link.mandateId);
    if (mandate) remember(byMandate, mandate, party);
    const creditor = mandateKey(link.creditorId);
    if (creditor) remember(byCreditor, creditor, party);
  }
  return { byName, byIban, byMandate, byCreditor };
}

/** The key a machtigingskenmerk or an incassant-ID is remembered under. */
export function mandateKey(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toUpperCase();
  return s.length > 0 ? s : null;
}

/** Does this index remember `key` as belonging to exactly `party`, and to nothing else? */
function remembersOnly(index: Map<string, Set<string>>, key: string | null, party: string): boolean {
  if (!key) return false;
  const parties = index.get(key);
  return parties != null && parties.size === 1 && parties.has(party);
}

/**
 * Has the owner confirmed a payment from this counterpart against this party before?
 *
 * The IBAN is asked first because an account is the counterpart's own; the name is what the bank
 * chose to write and can be anything. Either alone is enough — a supplier who pays from a second
 * account keeps their name, and one whose name the bank rewrites keeps their account.
 */
export function remembersParty(
  memory: MatchMemory | null | undefined,
  tx: MemoryHandles,
  partyName: string | null | undefined,
): boolean {
  return remembersPartyBy(memory, tx, partyName) !== null;
}

/** The handles a bank line offers the memory. Every one of them is written by the BANK. */
export interface MemoryHandles {
  counterpartName?: string | null;
  counterpartIban?: string | null;
  mandateId?: string | null;
  creditorId?: string | null;
}

/** Which handle the memory recognised, or null. Named so the matcher can say WHY on the card. */
export type MemoryHandle = "mandate" | "creditor-id" | "iban" | "name";

/**
 * [INCASSO-IDENTITEIT] The same question as remembersParty, answered with the handle that carried
 * it — strongest first, and the order is the argument:
 *
 *   mandate      one contract between exactly two parties. A collection cannot exist without it,
 *                and it is the same string every month while everything else on the line moves.
 *   creditor-id  issued to one legal entity, but reusable across its trade names.
 *   iban         the counterpart's own account — unless the counterpart is a collector, whose
 *                clearing account is shared by everyone it collects for.
 *   name         whatever the bank chose to write.
 *
 * Each is asked under the one-party rule, so a handle that has settled two parties is a shared
 * channel and stops speaking — which is exactly what keeps a collector's clearing IBAN and a
 * re-used incassant-ID from handing this month's payment to the wrong supplier.
 */
export function remembersPartyBy(
  memory: MatchMemory | null | undefined,
  tx: MemoryHandles,
  partyName: string | null | undefined,
): MemoryHandle | null {
  if (!memory) return null;
  const party = partyKey(partyName);
  if (!party) return null;
  if (remembersOnly(memory.byMandate, mandateKey(tx.mandateId), party)) return "mandate";
  if (remembersOnly(memory.byCreditor, mandateKey(tx.creditorId), party)) return "creditor-id";
  const iban = tx.counterpartIban ? normalizeIban(tx.counterpartIban) : "";
  if (remembersOnly(memory.byIban, iban || null, party)) return "iban";
  if (remembersOnly(memory.byName, counterpartKey(tx.counterpartName ?? null), party)) return "name";
  return null;
}

/**
 * How many confirmed links to read back. Enough to cover a year of an active administration, small
 * enough that the query stays a footnote on a screen that already runs several.
 *
 * A cap is not a limitation here but part of the design: a memory that reaches back further than
 * the owner does is a memory of a supplier relationship that may have ended.
 */
export const MATCH_MEMORY_LIMIT = 400;
