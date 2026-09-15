// src/lib/onderhanden-werk.ts
// [ONDERHANDEN-WERK] What the year's work is worth on the day the books close.
//
// ── WHY THIS EXISTS ──
//
// A dienstverlener works in December and invoices in January. Those hours are earned in the old
// year and paid in the new one, and the balance sheet has a name for them: onderhanden werk. They
// belong to the year they were worked, as an asset, at the price they will be billed at.
//
// Leave them out and the year's result is too low, the aftrek is computed over the wrong profit,
// and the difference lands in a year the owner has already filed. Every accountant asks for this
// figure at the year close; no zzp package computes it, because none of them holds the hours and
// the invoices in the same place. This app does.
//
// ── WHAT "AS OF A DATE" MEANS, EXACTLY ──
//
// An hour is onderhanden werk on 31 December when it was worked on or before that day and was NOT
// yet invoiced on that day. "Not yet invoiced" is a question about the INVOICE's date, not about
// whether an invoice exists today: December hours billed on 12 January are onderhanden werk on 31
// December, and they are the whole reason the figure exists. So the caller hands over the invoice
// dates it knows, and an invoice dated after the cutoff still counts as work in progress.
//
// ── WHAT IT REFUSES TO DO ──
//
// It never prices an hour that has no rate. An hour without a rate has no defensible value — the
// owner has not decided what it is worth — so it is COUNTED and NAMED (`withoutRate`) instead of
// being valued at zero or at some average. A balance-sheet figure the owner cannot reconcile
// against the list behind it is worse than no figure.
//
// It never guesses at an invoice it could not read. An hour whose invoice date is unknown is left
// out of the value and reported in `unknownInvoices`, so the screen can say the figure may be
// understated rather than quietly understating it.
//
// Pure. Run: npx tsx --test src/lib/onderhanden-werk.test.ts

import { round2 } from "./invoice-totals";
// The SAME arithmetic as the invoice line the hour will end up on. Onderhanden werk that does not
// equal the invoice that settles it is two answers to one question, and the difference surfaces a
// year later as a correction nobody can trace.
import { entryValue, isDeclarable, type TimeEntry } from "./uren";

/** One hour, in the shape this module needs it. */
export type WipEntry = Pick<TimeEntry, "client_id" | "hours" | "hourly_rate" | "invoice_id"> & {
  worked_on: string | null;
  billable?: boolean | null;
};

export interface WipClient {
  clientId: string | null;
  hours: number;
  /** Ex btw, at the rate on the hours. Only hours that HAVE a rate are in here. */
  value: number;
  /** Hours on this client with no rate — real work, no defensible value yet. */
  withoutRate: number;
}

export interface WorkInProgress {
  /** The day the books close, as handed in. */
  until: string;
  /** Ex btw, over every client. */
  value: number;
  /** Hours behind that value — priced hours only. */
  hours: number;
  /** Hours that are onderhanden werk but carry no rate. Named, never valued. */
  withoutRate: number;
  /** Hours left out because their invoice could not be dated. Zero is the normal case. */
  unknownInvoices: number;
  /** Per client, largest value first. A client with nothing but unpriced hours is still in here. */
  clients: WipClient[];
  /** The oldest working day still in the figure — how long the owner has been carrying it. */
  oldest: string | null;
}

/**
 * Was this hour still waiting for an invoice on `until`?
 *
 * Three answers, and only the middle one needs the map:
 *   · no invoice at all            → yes, it is work in progress
 *   · an invoice dated after until → yes: on that day it had not been billed
 *   · an invoice dated on/before   → no
 */
function stillOpenOn(
  entry: WipEntry,
  until: string,
  invoiceDateById: Readonly<Record<string, string | null>>,
): { open: boolean; unknown: boolean } {
  if (!entry.invoice_id) return { open: true, unknown: false };
  const date = invoiceDateById[entry.invoice_id];
  if (date === null || date === undefined || date === "") return { open: false, unknown: true };
  return { open: date > until, unknown: false };
}

export function workInProgress(input: {
  entries: readonly WipEntry[];
  /** ISO date, inclusive. The last day of the book year, normally. */
  until: string;
  /** invoice id → invoice_date, for every invoice the entries point at that the caller could read. */
  invoiceDateById?: Readonly<Record<string, string | null>>;
}): WorkInProgress {
  const { entries, until } = input;
  const invoiceDateById = input.invoiceDateById ?? {};

  const perClient = new Map<string, WipClient>();
  let hours = 0;
  let withoutRate = 0;
  let unknownInvoices = 0;
  let oldest: string | null = null;
  // [CENT] Summed as cents and rounded ONCE at the end. Each hour is already rounded to a cent by
  // entryValue — the same rounding as its invoice line — and adding rounded amounts is exact.
  let value = 0;

  for (const entry of entries) {
    const workedOn = typeof entry.worked_on === "string" ? entry.worked_on : "";
    // Worked after the cutoff: next year's work, whatever its invoice says.
    if (!workedOn || workedOn > until) continue;
    // [DECLARABEL] Own time is not onderhanden werk. Nobody is ever going to pay for it, so it is
    // not an asset — putting it on the balance sheet would invent income out of administration.
    if (!isDeclarable(entry as TimeEntry)) continue;

    const state = stillOpenOn(entry, until, invoiceDateById);
    if (state.unknown) { unknownInvoices += 1; continue; }
    if (!state.open) continue;

    const key = entry.client_id ?? "";
    const row = perClient.get(key) ?? { clientId: entry.client_id ?? null, hours: 0, value: 0, withoutRate: 0 };

    const amount = entryValue(entry);
    const workedHours = Number(entry.hours);
    if (amount === null) {
      // No rate, or no usable number of hours. Either way it is not priced work.
      row.withoutRate += 1;
      withoutRate += 1;
    } else {
      row.value = round2(row.value + amount);
      value += amount;
      if (Number.isFinite(workedHours)) {
        row.hours = round2(row.hours + workedHours);
        hours = round2(hours + workedHours);
      }
    }

    perClient.set(key, row);
    if (oldest === null || workedOn < oldest) oldest = workedOn;
  }

  const clients = [...perClient.values()].sort((a, b) => b.value - a.value || b.withoutRate - a.withoutRate);

  return { until, value: round2(value), hours: round2(hours), withoutRate, unknownInvoices, clients, oldest };
}

/** 31 December of the book year, the day this figure is normally asked for. */
export function endOfYear(year: number): string {
  return `${year}-12-31`;
}
