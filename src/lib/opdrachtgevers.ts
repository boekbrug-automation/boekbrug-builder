// src/lib/opdrachtgevers.ts
// [OPDRACHTGEVER] Who this year's money came from, per opdrachtgever.
//
// ── WHY THIS EXISTS ──
//
// Since 1 January 2025 the Belastingdienst enforces the Wet DBA again. The enforcement is aimed at
// the OPDRACHTGEVER, which is why clients drop zzp'ers; what the zzp'er risks themselves is the
// zelfstandigenaftrek and the mkb-winstvrijstelling, retroactively. In that assessment the Hoge
// Raad counts extern ondernemerschap — how many clients, whose rate, whose acquisition, whose
// investments — as a full factor.
//
// Every figure that answers "how many clients, and how big is the biggest" is already in this
// app's own invoices, and no bookkeeping package shows it. So this module adds them up. That is
// all it does.
//
// ── WHAT IT REFUSES TO DO ──
//
// It does not judge. There is no threshold in this file, no colour, no verdict, because there is
// no rule to check against: "70% from one client" and "you need three clients" are VAR-era
// folklore, not law, and printing either as a limit would be a confident wrong answer about
// somebody's largest deduction. The screen states the facts and says, once, that the assessment
// weighs more than these numbers.
//
// Pure. Run: npx tsx --test src/lib/opdrachtgevers.test.ts

import { round2 } from "./invoice-totals";
import { foldText } from "./search";

export interface OpdrachtgeverInvoice {
  client_id: string | null;
  client_name: string | null;
  /** Ex btw, signed: a creditnota is stored negative and nets against the client's revenue. */
  total_ex_btw: number | null;
  invoice_date: string | null;
}

export interface OpdrachtgeverHours {
  client_id: string | null;
  hours: number | null;
}

export interface OpdrachtgeverRow {
  /** client_id when the invoice carries one, else the folded name — the app's usual pairing. */
  key: string;
  name: string;
  /** Ex btw, credit notes netted. */
  revenue: number;
  /** Percentage of the year's revenue, one decimal. Null when the year's revenue is zero. */
  share: number | null;
  /** Hours written on this client this year — every hour, billable or not. */
  hours: number;
  invoices: number;
  firstInvoice: string | null;
  lastInvoice: string | null;
}

export interface OpdrachtgeverYear {
  year: number;
  /** The year's revenue ex btw over all opdrachtgevers. */
  revenue: number;
  /** How many opdrachtgevers this year's revenue came from. */
  clients: number;
  /** Newest first by revenue. */
  rows: OpdrachtgeverRow[];
  /** The share of the largest one, or null when there is no revenue to divide. */
  largestShare: number | null;
}

/** An invoice's key: its client link, else its name folded — the same pairing the customer card uses. */
function keyOf(iv: OpdrachtgeverInvoice): string | null {
  if (iv.client_id) return iv.client_id;
  const name = (iv.client_name ?? "").trim();
  return name ? `name:${foldText(name)}` : null;
}

export function opdrachtgeverYear(args: {
  year: number;
  invoices: readonly OpdrachtgeverInvoice[];
  hours: readonly OpdrachtgeverHours[];
}): OpdrachtgeverYear {
  const hoursByClient = new Map<string, number>();
  for (const h of args.hours) {
    if (!h.client_id) continue;
    hoursByClient.set(h.client_id, (hoursByClient.get(h.client_id) ?? 0) + (Number(h.hours) || 0));
  }

  const byKey = new Map<string, OpdrachtgeverRow>();
  for (const iv of args.invoices) {
    const key = keyOf(iv);
    if (!key) continue;
    // An amount that is not there is not zero: Number(null) is 0 and would count a real invoice
    // as a client with no revenue, which is the one direction this screen may not be wrong in.
    if (iv.total_ex_btw === null || iv.total_ex_btw === undefined) continue;
    const amount = Number(iv.total_ex_btw);
    if (!Number.isFinite(amount)) continue;
    const row = byKey.get(key) ?? {
      key, name: (iv.client_name ?? "").trim() || "—",
      revenue: 0, share: null, hours: hoursByClient.get(key) ?? 0, invoices: 0,
      firstInvoice: null, lastInvoice: null,
    };
    row.revenue += amount;
    row.invoices += 1;
    const day = iv.invoice_date ?? null;
    if (day) {
      if (!row.firstInvoice || day < row.firstInvoice) row.firstInvoice = day;
      if (!row.lastInvoice || day > row.lastInvoice) row.lastInvoice = day;
    }
    byKey.set(key, row);
  }

  const rows = [...byKey.values()].map((r) => ({ ...r, revenue: round2(r.revenue), hours: round2(r.hours) }));
  const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
  // The share is of the POSITIVE total: a year whose revenue nets to zero or below has no
  // percentages to state, and a share against a negative divisor would print a minus that means
  // nothing. Null there, never a number the owner cannot read.
  for (const r of rows) r.share = revenue > 0 ? Math.round((r.revenue / revenue) * 1000) / 10 : null;
  rows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "nl"));
  return {
    year: args.year,
    revenue,
    clients: rows.length,
    rows,
    largestShare: rows.length > 0 ? rows[0].share : null,
  };
}

// ── [DBA-DOSSIER] The three things a year's totals cannot say ───────────────────────────────────
//
// opdrachtgeverYear answers "how many, and how big is the biggest" — inside ONE year. The
// assessment does not stop at the year boundary, and the three questions it does ask next are all
// answerable from invoices this app already holds:
//
//   · SINCE WHEN. One opdrachtgever running unbroken for four years and one that ran for six weeks
//     are the same row in a yearly total. They are not the same fact about a working relationship.
//   · WON THIS YEAR. Acquisition is the part of extern ondernemerschap that a revenue column
//     cannot show at all: an owner who added two opdrachtgevers this year is doing something a
//     stable list never demonstrates.
//   · THE RATE. Setting your own price, and a different one per opdrachtgever, is the owner's own
//     commercial decision. It is READ, never derived: the rate agreed with a klant is recorded on
//     that klant, and revenue ÷ hours would answer a different question (it folds in every
//     product line and every unbilled hour) while looking like the same one.
//
// Same refusal as the rest of this file: no threshold, no colour, no verdict. Four years with one
// opdrachtgever is not a violation of anything, and printing it as one would be a confident wrong
// answer about somebody's largest deduction. The dossier states facts; the owner and their
// adviser weigh them.

export interface OpdrachtgeverAgreedRate {
  /** The klant row this rate belongs to. Matched against the invoice's client_id only. */
  client_id: string;
  /** Euro per hour as the owner agreed it. Null / absent means no rate was recorded — never zero. */
  default_hourly_rate: number | null;
}

export interface OpdrachtgeverDossierRow extends OpdrachtgeverRow {
  /** The FIRST invoice to this opdrachtgever in any year. Null when no invoice of theirs is dated. */
  since: string | null;
  /** Distinct calendar months carrying revenue from them, across every year. */
  monthsActive: number;
  /** Their first invoice ever falls inside the year shown: this opdrachtgever was won this year. */
  wonThisYear: boolean;
  /** The rate the owner agreed with them, as recorded. Never computed from revenue and hours. */
  agreedRate: number | null;
}

export interface OpdrachtgeverDossier extends OpdrachtgeverYear {
  rows: OpdrachtgeverDossierRow[];
  /** How many of this year's opdrachtgevers were won this year. */
  wonThisYear: number;
  /**
   * The agreed rates actually in play this year, lowest and highest. Null when fewer than two of
   * this year's opdrachtgevers have one recorded — a spread over a single figure says nothing, and
   * a range printed from one number reads as a range that was measured.
   */
  rateSpread: { low: number; high: number } | null;
}

/** The YYYY-MM of an ISO day, or null when there is no readable day. */
function monthOf(day: string | null | undefined): string | null {
  const d = (day ?? "").trim();
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null;
}

/**
 * The year's opdrachtgevers, each carrying what the whole history says about them.
 *
 * `invoices` spans EVERY year — that is the point of this function, and the year shown is cut out
 * of it here rather than in the query. `hours` and `rates` describe the year shown.
 */
export function opdrachtgeverDossier(args: {
  year: number;
  /** Every revenue document, all years. */
  invoices: readonly OpdrachtgeverInvoice[];
  hours: readonly OpdrachtgeverHours[];
  rates: readonly OpdrachtgeverAgreedRate[];
}): OpdrachtgeverDossier {
  const prefix = `${args.year}-`;
  // Exactly the cut the query used to make: a document with no readable date belongs to no year.
  const ofYear = args.invoices.filter((iv) => (iv.invoice_date ?? "").startsWith(prefix));
  const base = opdrachtgeverYear({ year: args.year, invoices: ofYear, hours: args.hours });

  // History over every year, keyed the same way the year is.
  const firstEver = new Map<string, string>();
  const monthsByKey = new Map<string, Set<string>>();
  for (const iv of args.invoices) {
    const key = keyOf(iv);
    if (!key) continue;
    const month = monthOf(iv.invoice_date);
    if (!month) continue;
    const day = (iv.invoice_date as string).slice(0, 10);
    const seen = firstEver.get(key);
    if (!seen || day < seen) firstEver.set(key, day);
    const set = monthsByKey.get(key) ?? new Set<string>();
    set.add(month);
    monthsByKey.set(key, set);
  }

  // A rate that is not recorded is not a rate of zero — the trap this file already avoids for
  // revenue, and the same one costs more here: € 0 per uur is a claim about the owner's pricing.
  const rateByClient = new Map<string, number>();
  for (const r of args.rates) {
    const id = (r.client_id ?? "").trim();
    if (!id) continue;
    if (r.default_hourly_rate === null || r.default_hourly_rate === undefined) continue;
    const value = Number(r.default_hourly_rate);
    if (!Number.isFinite(value) || value <= 0) continue;
    rateByClient.set(id, round2(value));
  }

  const rows: OpdrachtgeverDossierRow[] = base.rows.map((r) => {
    const since = firstEver.get(r.key) ?? null;
    return {
      ...r,
      since,
      monthsActive: monthsByKey.get(r.key)?.size ?? 0,
      // Only a date can answer this. An opdrachtgever whose invoices carry no date is not "new";
      // we simply do not know, and false is the answer that claims the least.
      wonThisYear: since !== null && since.startsWith(prefix),
      // The key is a client_id only when the invoice carried one; a name-keyed row has no klant
      // record to have agreed a rate with.
      agreedRate: rateByClient.get(r.key) ?? null,
    };
  });

  const recorded = rows.map((r) => r.agreedRate).filter((v): v is number => v !== null);
  return {
    ...base,
    rows,
    wonThisYear: rows.filter((r) => r.wonThisYear).length,
    rateSpread:
      recorded.length >= 2
        ? { low: Math.min(...recorded), high: Math.max(...recorded) }
        : null,
  };
}
