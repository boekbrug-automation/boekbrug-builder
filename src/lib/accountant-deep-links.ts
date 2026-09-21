// src/lib/accountant-deep-links.ts
// [KANTOOR-LINKS] Where a signal on an accountant screen actually lands. Pure, no I/O, no React.
// Run: npx tsx --test src/lib/accountant-deep-links.test.ts
//
// WHY THESE HREFS LIVE IN ONE MODULE
//
// A signal that dumps the boekhouder on a generic page makes them search for what the app had
// already found. Every fix for that is the same two lines — read the identifiers the signal
// already carries, write them into the target's query string — and that is exactly the kind of
// code that drifts: `?q=` here, `?quarter=` there, a `year` forgotten on the fourth screen, and
// the accountant lands on Q1 of the current year for a finding about Q3. That happened: the
// correction-result notification pointed at `/dashboard/clients/{id}/kwartaal` with no period at
// all, and that screen defaults to `q=1` and today's year.
//
// So the URLs are built HERE, once, and asserted against the parameter names the destinations
// really read:
//
//   · /dashboard/clients/[id]/kwartaal      reads `q`, `year`, `focus`   (page.tsx:165-200)
//   · /dashboard/accountant/opvragen        reads `clientId`, `q`, `year` (added with this batch)
//   · /dashboard/brug                       reads `clientId`, `q`, `year`, `tab` (idem)
//
// WHAT THIS MODULE REFUSES TO DO
//
// It never invents a period and never invents a focus. `focus` is only ever written for a signal
// that names ONE invoice; a count ("3 open vragen") and a rule finding about a bank line or a
// duplicate PAIR get the list surface for their period and nothing more. Picking an arbitrary
// member of a set to satisfy a deep link is worse than not linking: it tells the accountant the
// app knows which one, and it does not.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the ROUTE SEGMENTS stay
// Dutch (`/dashboard/clients/.../kwartaal`, `/dashboard/accountant/opvragen`) because a user reads
// them — renaming one is a product decision, not a rename.

import { quarterKeyOf, type QuarterNo, type YearQuarter } from "./quarter";

/** A client and the period a signal is about. Both required — a period is never guessed here. */
export interface ClientPeriod {
  clientId: string;
  year: number;
  quarter: number;
}

/**
 * Is this a period we are willing to put in a URL?
 *
 * A NaN quarter reaches the target as `q=NaN`, which parses back to NaN, and the quarter screen
 * then computes an empty date range and reports "geen facturen in dit kwartaal" — a false answer
 * to a question nobody asked. Refusing here means the caller falls back to the plain route.
 */
function usablePeriod(p: { year: number; quarter: number }): boolean {
  return (
    Number.isInteger(p.year) && p.year >= 2000 && p.year <= 2100 &&
    Number.isInteger(p.quarter) && p.quarter >= 1 && p.quarter <= 4
  );
}

/** A client id we are willing to put in a URL: non-empty, and never a stray `undefined`. */
function usableId(id: string | null | undefined): id is string {
  const v = (id ?? "").trim();
  return v.length > 0 && v !== "undefined" && v !== "null";
}

/**
 * The client's file, with no period in it — the honest destination when we do not know one.
 *
 * `/dashboard/clients/[id]` shows the client and their four quarters; nothing on it claims a
 * period was chosen. That is exactly why it is the fallback below.
 */
export function clientOverviewHref(clientId: string | null | undefined): string {
  return usableId(clientId) ? `/dashboard/clients/${encodeURIComponent(clientId)}` : "/dashboard/clients/beheer";
}

/**
 * The client's quarter workspace — the Bron surface: this client's invoices for this period.
 *
 * `focusInvoiceId` opens and highlights one row through the contract that screen already has
 * ([BRIDGE-NOTIF], `?focus=`). Pass it ONLY when the signal names that one invoice. The screen
 * ignores a focus id that is not in the period's list, so a wrong one is silent — which is
 * precisely why it must not be written on a guess.
 *
 * NO PERIOD MEANS NO /kwartaal. The screen resolves a missing `q` and `year` to Q1 of the CURRENT
 * year (page.tsx:165-166) — it does not refuse, it invents. So a period-less `/kwartaal` link is
 * not a link with one fact missing, it is a link that asserts a quarter nobody computed, on the
 * screen where an accountant decides a quarter is complete. When the period is not usable this
 * returns the client's file instead, which claims nothing.
 */
export function clientQuarterHref(
  period: ClientPeriod,
  focusInvoiceId?: string | null,
): string {
  if (!usableId(period.clientId)) return "/dashboard/clients/beheer";
  if (!usablePeriod(period)) return clientOverviewHref(period.clientId);
  const qs = new URLSearchParams({ q: String(period.quarter), year: String(period.year) });
  if (usableId(focusInvoiceId)) qs.set("focus", focusInvoiceId);
  return `/dashboard/clients/${encodeURIComponent(period.clientId)}/kwartaal?${qs}`;
}

/**
 * "Stukken opvragen", already pointed at this client and this period.
 *
 * The canonical target for a MISSING PIECE: that screen fetches the same `/api/readiness`
 * `missing[]` the werkboard chip is a title of, so the accountant lands on the very list the chip
 * came from — with the request form under it. Deliberately not the readiness item's own `fix`
 * href: those are OWNER routes (readiness-board.ts:26-32) and would send the boekhouder to their
 * own empty pages.
 */
export function opvragenHref(period: ClientPeriod): string {
  const base = "/dashboard/accountant/opvragen";
  if (!usableId(period.clientId) || !usablePeriod(period)) return base;
  const qs = new URLSearchParams({
    clientId: period.clientId,
    q: String(period.quarter),
    year: String(period.year),
  });
  return `${base}?${qs}`;
}

/**
 * The Brug, opened on this client's Documenten for this period.
 *
 * `tab=documenten` because that is what the button on the quarter screen is called; without it the
 * hub opens on Overzicht and the accountant picks the tab, the client and the quarter again — the
 * three things they had just chosen on the screen they came from.
 */
export function brugDocumentsHref(period: ClientPeriod): string {
  const base = "/dashboard/brug";
  if (!usableId(period.clientId)) return base;
  const qs = new URLSearchParams({ clientId: period.clientId, tab: "documenten" });
  if (usablePeriod(period)) {
    qs.set("q", String(period.quarter));
    qs.set("year", String(period.year));
  }
  return `${base}?${qs}`;
}

/**
 * The period an invoice belongs to, from its own date.
 *
 * String-parsed through quarterKeyOf, never `new Date(...).getMonth()`: an ISO date-only string is
 * midnight UTC, and read in Europe/Amsterdam "2026-01-01" becomes 31 December — so a correction on
 * the first invoice of the year would notify the accountant about Q4 of the year before, in the
 * one week where that is also the quarter they are filing. Null for an unreadable or absent date,
 * and the caller then writes no period at all rather than today's.
 */
export function periodOfInvoiceDate(iso: string | null | undefined): YearQuarter | null {
  const key = quarterKeyOf(iso);
  if (!key) return null;
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) as QuarterNo };
}

/**
 * The link an accountant notification about ONE invoice should carry.
 *
 * Returns null when the invoice's date could not be read, and the caller then falls back to a
 * surface that names no period at all (clientOverviewHref). A period-less `/kwartaal` link is not
 * a smaller answer than this one, it is a WRONG one — the screen fills q and year in from the
 * clock — so "we could not read the date" must never be spelled as "Q1 of this year".
 */
export function invoiceNoticeHref(
  clientId: string,
  invoiceId: string,
  invoiceDate: string | null | undefined,
): string | null {
  if (!usableId(clientId) || !usableId(invoiceId)) return null;
  const period = periodOfInvoiceDate(invoiceDate);
  if (!period) return null;
  return clientQuarterHref({ clientId, year: period.year, quarter: period.quarter }, invoiceId);
}
