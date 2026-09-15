// src/lib/grootboekkaart.ts
// [GROOTBOEK-KAART] The ledger card and the trial balance — the two pages an accountant opens first.
//
// Built entirely from `buildJournalEntries` (xaf-export.ts), which is the ONE journal this
// administration has. Nothing here computes an amount from an invoice, a bank row or a cash entry:
// if a figure is not in the journal, it does not appear on the card either. That is the whole
// point of the module — a grootboek that derived its own numbers would be a second set of books,
// and the accountant would end up reconciling BoekBrug against BoekBrug.
//
// ── WHAT A DUTCH ACCOUNTANT EXPECTS TO SEE, AND WHAT THAT MEANS HERE ──
//
//   · proef- en saldibalans — per account: total debit, total credit, and the balance;
//   · grootboekkaart — per account: every mutation in date order with a running balance;
//   · the balance check — debit equals credit, over the whole set. It is stated, not assumed.
//
// ── SIGNS, ONCE, SO NOBODY HAS TO GUESS ──
//
// A journal line carries `debitC`: signed cents, positive on the debit side, negative on the
// credit side (xaf-export.ts). This module keeps that convention end to end. `balanceC` is
// therefore debit-positive: a bank account with money in it is POSITIVE, and turnover — a credit
// balance — is NEGATIVE. That is correct double-entry and it is the opposite of what a screen
// usually wants to show a business owner, so the RENDERING flips the P-accounts, never this file.
//
// Cents throughout. Euros appear only where a human reads them.
// Pure. Run: npx tsx --test src/lib/grootboekkaart.test.ts

import { XAF_ACCOUNTS, type Entry, type Line } from "./xaf-export";

/** One mutation on a ledger card: a single journal line, with the entry it came from. */
export interface CardMutation {
  entryNr: number;
  date: string;
  journal: Entry["journal"];
  description: string;
  docRef: string;
  /** Signed cents, debit-positive — the convention of the journal itself. */
  debitC: number;
  /** The balance AFTER this mutation, debit-positive. */
  runningC: number;
}

export interface LedgerCard {
  accID: string;
  accDesc: string;
  /** "B" balance sheet, "P" profit and loss. */
  accTp: "B" | "P";
  rgs: string | null;
  totalDebitC: number;
  totalCreditC: number;
  /** Debit-positive closing balance: totalDebit − totalCredit. */
  balanceC: number;
  mutations: CardMutation[];
}

export interface TrialBalance {
  cards: LedgerCard[];
  totalDebitC: number;
  totalCreditC: number;
  /** True when the whole set balances. Stated rather than assumed — see the note below. */
  balanced: boolean;
  /** Accounts that carry a booking but are not in the chart. Empty is the only healthy answer. */
  unknownAccounts: string[];
}

const CHART = new Map(XAF_ACCOUNTS.map((a) => [a.accID, a]));

/**
 * Sort key for the card list: by account number, which is how every Dutch chart is read
 * (0xxx activa, 1xxx vlottend, 4xxx kosten, 8xxx omzet). String compare on a fixed-width numeric
 * code is the same order and needs no parsing.
 */
function byAccount(a: LedgerCard, b: LedgerCard): number {
  return a.accID < b.accID ? -1 : a.accID > b.accID ? 1 : 0;
}

/**
 * Chronological within an account, and STABLE on a tie.
 *
 * Two entries can share a date — a bank day with four lines, an invoice and its payment booked the
 * same afternoon — and then the entry number decides. Without that second key the running balance
 * on a card would reorder between two renders of identical data, and a running balance that moves
 * on its own is the fastest way to lose an accountant's trust in every other number on the page.
 */
function chronological(a: { date: string; entryNr: number }, b: { date: string; entryNr: number }): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.entryNr - b.entryNr;
}

/**
 * Every ledger card for these entries, plus the trial balance over them.
 *
 * Accounts with no movement are omitted — an empty card is noise on a screen (the auditfile lists
 * them, and should: a chart is part of what it declares). An account that IS booked but is not in
 * the chart is reported in `unknownAccounts` rather than silently given a blank name: that can
 * only happen if a builder started using an account nobody declared, and a ledger that quietly
 * absorbs an unknown account is one that cannot be reconciled to the auditfile it came from.
 */
export function buildLedgerCards(entries: readonly Entry[]): TrialBalance {
  const cards = new Map<string, LedgerCard>();
  const unknown = new Set<string>();

  const flat: { line: Line; entry: Entry }[] = [];
  for (const entry of entries) for (const line of entry.lines) flat.push({ line, entry });
  flat.sort((x, y) =>
    chronological({ date: x.entry.date, entryNr: x.entry.nr }, { date: y.entry.date, entryNr: y.entry.nr }));

  for (const { line, entry } of flat) {
    const known = CHART.get(line.accID);
    if (!known) unknown.add(line.accID);
    let card = cards.get(line.accID);
    if (!card) {
      card = {
        accID: line.accID,
        accDesc: known?.accDesc ?? line.accID,
        accTp: known?.accTp ?? "B",
        rgs: known?.rgs ?? null,
        totalDebitC: 0, totalCreditC: 0, balanceC: 0, mutations: [],
      };
      cards.set(line.accID, card);
    }
    if (line.debitC >= 0) card.totalDebitC += line.debitC; else card.totalCreditC += -line.debitC;
    card.balanceC += line.debitC;
    card.mutations.push({
      entryNr: entry.nr,
      date: entry.date,
      journal: entry.journal,
      description: line.desc,
      docRef: line.docRef,
      debitC: line.debitC,
      runningC: card.balanceC,
    });
  }

  const list = [...cards.values()].sort(byAccount);
  let totalDebitC = 0, totalCreditC = 0;
  for (const c of list) { totalDebitC += c.totalDebitC; totalCreditC += c.totalCreditC; }

  return {
    cards: list,
    totalDebitC,
    totalCreditC,
    // Stated, never assumed. buildJournalEntries refuses an unbalanced entry, so this should always
    // be true — and that is exactly why it is worth reporting rather than trusting: the day it is
    // false, an accountant must be able to SEE that it is false, on the page, instead of finding
    // out from a rejected import three weeks later.
    balanced: totalDebitC === totalCreditC,
    unknownAccounts: [...unknown].sort(),
  };
}

/** One card, or null when that account has no movement in this set. */
export function ledgerCardFor(balance: TrialBalance, accID: string): LedgerCard | null {
  return balance.cards.find((c) => c.accID === accID) ?? null;
}

/**
 * The result of the year, from the P accounts only — turnover minus costs.
 *
 * Debit-positive means costs are positive and turnover is negative, so the result is the NEGATIVE
 * of their sum. Returned debit-positive as well (a profit is a credit balance, hence negative),
 * and the rendering decides how to say that to a human.
 */
export function resultFromCards(balance: TrialBalance): number {
  return balance.cards.filter((c) => c.accTp === "P").reduce((s, c) => s + c.balanceC, 0);
}
