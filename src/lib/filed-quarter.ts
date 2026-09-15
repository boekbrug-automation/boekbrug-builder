// src/lib/filed-quarter.ts
// [SUPPLETIE] The one door to the question "did this change touch a quarter that has already been
// filed, and by how much did it move?"
//
// ── WHY THIS EXISTS ──
//
// A BTW-aangifte that has been sent to the Belastingdienst is a statement made on a date. The books
// keep moving after it — a late supplier invoice, a misread total corrected — and when they move,
// the owner acquires an OBLIGATION they did not have a moment earlier: art. 10a AWR jo. art. 15
// Uitvoeringsbesluit OB 1968 requires them to report the difference. Over €1.000 that is a formal
// suppletie; €1.000 or less may be carried into the next regular aangifte.
//
// The app already froze the snapshot (btw_filings) and already computed the divergence
// (btw-filing.ts), and both are correct. What was missing is that nothing ASKED at the moment the
// books moved. The divergence was visible on two screens to an owner who happened to open them,
// which for a time-bound legal obligation is the same as not knowing.
//
// ── WHY THE CORRECTION IS NOT BLOCKED ──
//
// The sales side refuses an edit once the quarter is filed, and for an invoice the owner ISSUED
// that is right: the document went to a customer, and the way back is a creditnota. A PURCHASE
// invoice is the opposite case. The owner cannot issue a credit note against their own supplier,
// and the number in the books is not their statement but a reading of someone else's paper. When
// that reading was wrong, correcting it is not tampering with a filed quarter — it is the very
// thing that produces the suppletie. Refusing it would leave the books permanently wrong AND leave
// the Belastingdienst uninformed, which is worse in both directions at once.
//
// So: allow, compute, and say the number.

import { computeResultForRange } from "./compute-result-range";
import {
  computeFilingDivergence,
  correctionRoute,
  outstandingCorrection,
  SUPPLETIE_THRESHOLD,
  type CorrectionRoute,
  type FilingDivergence,
} from "./btw-filing";
import { isMissingColumn, isMissingRelation } from "./pg-missing";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** First and last day of a quarter, inclusive, as 'YYYY-MM-DD'. */
export function quarterBounds(year: number, quarter: number): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  return { start, end: `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}` };
}

/**
 * Which quarter an ISO date falls in. Null for anything that is not a real date.
 *
 * Parsed from the STRING, never through `new Date(iso)`: that is midnight UTC, and formatting or
 * reading it back in a zone west of UTC lands on the previous day — which on 1 January or 1 April
 * is a different quarter, and therefore a different aangifte.
 */
export function quarterOf(iso: string | null | undefined): { year: number; quarter: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, quarter: Math.ceil(month / 3) };
}

/** 'YYYY-Qn' — the key the screens and bulk-undo-pay already speak. */
export function quarterLabel(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

/** The five figures btw_filings freezes, plus when it was frozen. */
export interface FilingRow {
  filed_at: string;
  omzet: number | null;
  kosten: number | null;
  btw_verschuldigd: number | null;
  btw_voorbelasting: number | null;
  btw_saldo: number | null;
}

export const FILING_COLS = "filed_at, omzet, kosten, btw_verschuldigd, btw_voorbelasting, btw_saldo";

export function figuresOf(row: FilingRow) {
  return {
    omzet: Number(row.omzet) || 0,
    kosten: Number(row.kosten) || 0,
    btwVerschuldigd: Number(row.btw_verschuldigd) || 0,
    btwVoorbelasting: Number(row.btw_voorbelasting) || 0,
    btwSaldo: Number(row.btw_saldo) || 0,
  };
}

/**
 * [FILING-NO-OVERWRITE] Read the existing filing for one quarter — ONE place, because the answer
 * has three states, not two:
 *
 *   { row }            — there is a filing
 *   { row: null }      — there is none (or btw_filings has not been migrated here yet)
 *   { failed: true }   — we could not tell
 *
 * The third one is the whole point. Every caller of this table used to drop the read error, and
 * "we could not tell" then rendered as "not filed" — which is the answer that OFFERS to file, and
 * filing overwrote the snapshot. A read failure must never be able to start that.
 */
export async function readFiling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  year: number,
  quarter: number,
): Promise<{ row: FilingRow | null; failed: boolean }> {
  const { data, error } = await db
    .from("btw_filings")
    .select(FILING_COLS)
    .eq("user_id", userId)
    .eq("year", year)
    .eq("quarter", quarter)
    .maybeSingle();
  if (error) {
    // A table that has not been created yet genuinely holds no filings — deploy-safe, not unknown.
    if (isMissingRelation(error.message)) return { row: null, failed: false };
    console.error("[FILING-NO-OVERWRITE] btw_filings read failed", { userId, year, quarter, error: error.message });
    return { row: null, failed: true };
  }
  return { row: (data as FilingRow | null) ?? null, failed: false };
}

/** What a change did to one already-filed quarter. */
/**
 * [JAARSTAND] Which quarters of ONE year are filed — the whole year in a single read.
 *
 * readFiling answers for one quarter and its caller (GET /api/btw/file) recomputes the live
 * figures to report divergence. Asking that four times to render a year strip would run the
 * reconcile engine four times over for an answer that is one SELECT: a year has at most four
 * filings and this needs nothing but their quarter numbers.
 *
 * `failed` is separate from an empty set, and the caller must keep it separate: a year whose
 * filings could not be read is not a year with no filings ([NO-SILENT-EMPTY]). A missing table
 * genuinely holds none — same deploy-safe rule as readFiling above.
 */
export interface FiledQuarterOfYear {
  quarter: number;
  /** 'YYYY-MM-DD', or null when the row predates the column or never carried one. */
  filedAt: string | null;
}

/**
 * The filed quarters of one year WITH the day each was filed.
 *
 * [CORRECTIE-TIJDVAK] The day matters at exactly one place: the notice shown before a correction
 * lands in a quarter that has already gone to the Belastingdienst. "Q3 2026, ingediend op
 * 2026-10-14" is a fact the owner can go and check; "Q3 2026, ingediend" is a claim they have to
 * take on trust. It is optional on purpose — a missing filed_at weakens the sentence, it never
 * silences it.
 *
 * [NO-SILENT-EMPTY] `failed` is the whole point of the shape. An empty list means "you have filed
 * nothing this year", which is the ordinary state of a young administration and must never be what
 * a failed read looks like.
 */
export async function readFiledQuartersDetailOfYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  year: number,
): Promise<{ rows: FiledQuarterOfYear[]; failed: boolean }> {
  const { data, error } = await db
    .from("btw_filings")
    .select("quarter, filed_at")
    .eq("user_id", userId)
    .eq("year", year);
  if (error) {
    if (isMissingRelation(error.message)) return { rows: [], failed: false };
    console.error("[JAARSTAND] btw_filings jaarlezing mislukt", { userId, year, error: error.message });
    return { rows: [], failed: true };
  }
  const seen = new Map<number, FiledQuarterOfYear>();
  for (const r of (data ?? []) as { quarter: number; filed_at?: string | null }[]) {
    const q = Number(r.quarter);
    if (!Number.isInteger(q) || q < 1 || q > 4) continue;
    const filedAt = typeof r.filed_at === "string" && r.filed_at !== "" ? r.filed_at.slice(0, 10) : null;
    const had = seen.get(q);
    // Two rows for one quarter should not exist, but if they do the one that carries a date wins:
    // a row without one tells the owner strictly less.
    if (!had || (had.filedAt === null && filedAt !== null)) seen.set(q, { quarter: q, filedAt });
  }
  return { rows: [...seen.values()].sort((a, b) => a.quarter - b.quarter), failed: false };
}

export async function readFiledQuartersOfYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  year: number,
): Promise<{ quarters: number[]; failed: boolean }> {
  const { rows, failed } = await readFiledQuartersDetailOfYear(db, userId, year);
  return { quarters: rows.map((r) => r.quarter), failed };
}

export interface FiledQuarterImpact {
  year: number;
  quarter: number;
  /** 'YYYY-Qn' */
  label: string;
  filedAt: string;
  divergence: FilingDivergence;
}

export interface FiledQuarterImpactResult {
  /** Filed quarters whose figures have moved since. Empty when nothing filed was touched. */
  impacts: FiledQuarterImpact[];
  /**
   * A filing read or a figure computation did not answer. NEVER report "no impact" on the strength
   * of a failed read: the whole purpose here is to raise an obligation the owner does not yet know
   * about, and silence is indistinguishable from "nothing happened".
   */
  unknown: boolean;
}

/**
 * For every quarter the given dates fall in: is it filed, and have its figures moved since?
 *
 * Takes DATES rather than one quarter because a correction can change `invoice_date`, which moves
 * an invoice out of one quarter and into another. Both are affected — the first loses the amount,
 * the second gains it — and telling the owner about only one of them describes half a correction.
 * Pass the old date and the new one; duplicates collapse.
 *
 * Runs the same computeResultForRange the aangifte, /api/result and the filing snapshot run, so the
 * delta reported here is the delta those surfaces will show. A second computation would be a second
 * definition, and the two would drift on the first change to either.
 */
export async function filedQuarterImpacts(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any;
  ownerId: string;
  dates: readonly (string | null | undefined)[];
}): Promise<FiledQuarterImpactResult> {
  const wanted = new Map<string, { year: number; quarter: number }>();
  for (const d of args.dates) {
    const q = quarterOf(d);
    if (q) wanted.set(quarterLabel(q.year, q.quarter), q);
  }
  if (wanted.size === 0) return { impacts: [], unknown: false };

  const impacts: FiledQuarterImpact[] = [];
  let unknown = false;

  for (const { year, quarter } of wanted.values()) {
    // [SUPPLETIE-EEN-ANTWOORD] Mét het al doorgeschoven bedrag: de zin hieronder noemt anders het
    // BRUTO verschil en de route die daarbij hoort, terwijl de knop die de eigenaar daarna indrukt
    // over het RESTANT beslist. Twee antwoorden op één vraag, op het scherm dat over een ingediende
    // aangifte gaat.
    const { row, failed } = await readFilingWithCarry(args.pipeline, args.ownerId, year, quarter);
    if (failed) { unknown = true; continue; }
    if (!row) continue; // not filed — the books may move freely, which is the ordinary case

    const { start, end } = quarterBounds(year, quarter);
    let current;
    try {
      const { result } = await computeResultForRange({ pipeline: args.pipeline, ownerId: args.ownerId, start, end });
      current = result;
    } catch (e) {
      // Same rule as a failed filing read: unknown, never "nothing moved".
      console.error("[SUPPLETIE] could not recompute a filed quarter — reporting unknown", {
        ownerId: args.ownerId, year, quarter, error: e instanceof Error ? e.message : String(e),
      });
      unknown = true;
      continue;
    }

    const divergence = computeFilingDivergence(figuresOf(row), {
      omzet: current.omzet,
      kosten: current.kosten,
      btwVerschuldigd: current.btwVerschuldigd,
      btwVoorbelasting: current.btwVoorbelasting,
      btwSaldo: current.btwSaldo,
    }, Number(row.carried_saldo) || 0);
    // Only a quarter that actually MOVED is an impact. A correction that leaves the totals where
    // they were (a supplier name, a typo in an invoice number) raises no obligation, and announcing
    // one would teach the owner to click this warning away.
    if (divergence.changed) {
      impacts.push({ year, quarter, label: quarterLabel(year, quarter), filedAt: row.filed_at, divergence });
    }
  }

  return { impacts, unknown };
}

/**
 * The sentence the owner reads at the moment of the change — Dutch, because it is on their screen.
 *
 * Names the quarter, the amount, and which of the two correction paths applies. The threshold
 * sentence is deliberately concrete about what happens next rather than about the law: "dien een
 * suppletie in" is an instruction, "art. 10a AWR" is a citation, and an owner acting on a screen
 * needs the first.
 *
 * [TAAL] The amounts are formatted here rather than in the component, so the sentence and its
 * number can never disagree about rounding.
 */
const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function describeFiledQuarterImpact(impact: FiledQuarterImpact): string {
  const d = impact.divergence;
  // [SUPPLETIE-EEN-ANTWOORD] Het RESTANT, niet het bruto verschil. Een kwartaal dat € 1.400 bewoog
  // en waarvan € 900 al is doorgeschoven, gaat over € 500 — en dat is ook het bedrag waarop de
  // route hierboven is bepaald. De zin noemde het bruto bedrag naast een route die over het
  // restant ging, dus de ondernemer las een instructie bij een getal dat er niet bij hoorde.
  const saldo = Math.abs(d.outstanding);
  const richting = d.outstanding > 0 ? "meer" : "minder";

  if (!d.btwChanged) {
    // [DIVERGENCE-SPLIT] Real and easy to hit: a 0%-BTW cost, or a correction where verschuldigd
    // and voorbelasting move together. Saying "de btw verandert met € 0,00" here is nonsense on the
    // one screen that has to be trusted, so this case gets its own sentence.
    return (
      `Kwartaal ${impact.label} is al ingediend. Je btw over dat kwartaal verandert hierdoor niet, ` +
      `maar je resultaat wel — dat telt mee voor de inkomstenbelasting, niet voor de btw-aangifte.`
    );
  }
  if (d.needsSuppletie) {
    return (
      `Kwartaal ${impact.label} is al ingediend. Je btw over dat kwartaal wordt hierdoor ` +
      `${EUR.format(saldo)} ${richting}. Dat is meer dan ${EUR.format(SUPPLETIE_THRESHOLD)} — ` +
      `dien hiervoor een suppletie in bij de Belastingdienst.`
    );
  }
  return (
    `Kwartaal ${impact.label} is al ingediend. Je btw over dat kwartaal wordt hierdoor ` +
    `${EUR.format(saldo)} ${richting}. Dat is minder dan ${EUR.format(SUPPLETIE_THRESHOLD)} — ` +
    `je mag dit verwerken in je volgende aangifte.`
  );
}

/**
 * [SUPPLETIE] Record WHEN the books first moved away from a filed quarter.
 *
 * art. 10a AWR runs its clock from the moment the entrepreneur becomes aware that a return was
 * wrong, and this is that moment — the app is the only place that holds it, and it cannot be
 * reconstructed afterwards. Recorded from today even though no screen shows a deadline yet: the
 * eight-week rule is recent enough to be worth confirming with the owner's own accountant before a
 * countdown appears on a financial screen, and a fact not captured now is a fact lost.
 *
 * `first_divergence_at` is written ONCE and never moved while it stands, because the clock runs
 * from the first knowledge rather than the latest edit. `last_divergence_at` follows every change.
 *
 * [DEPLOY-SAFE] The columns arrive by a hand-applied migration (btw_filings_divergence.sql), so a
 * missing column is a normal state of this codebase, not a failure. Never blocking either way: the
 * correction the caller just made is done and correct, and losing a timestamp may not undo it or
 * hold up the answer. Both outcomes are logged, because a stamp that silently never lands is a
 * clock nobody notices has stopped.
 */
export async function stampDivergence(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  ownerId: string;
  year: number;
  quarter: number;
  nowIso: string;
}): Promise<{ stamped: boolean; reason?: "missing_column" | "write_failed" }> {
  try {
    const { error } = await args.db
      .from("btw_filings")
      .update({ first_divergence_at: args.nowIso, last_divergence_at: args.nowIso })
      .eq("user_id", args.ownerId)
      .eq("year", args.year)
      .eq("quarter", args.quarter)
      // Written once: the row is only touched while first_divergence_at is still empty, so the
      // clock cannot be reset by a second correction. The follow-up below moves last_ on its own.
      .is("first_divergence_at", null);
    if (error) {
      if (isMissingColumn(error.message, (error as { code?: string }).code) || isMissingRelation(error.message)) {
        return { stamped: false, reason: "missing_column" };
      }
      console.error("[SUPPLETIE] could not record the moment a filed quarter moved", {
        ownerId: args.ownerId, year: args.year, quarter: args.quarter, error: error.message,
      });
      return { stamped: false, reason: "write_failed" };
    }
    // The second write always runs: on the FIRST divergence it is a no-op repeat of what the update
    // above just set, and on every later one it is the only thing that moves. Splitting them is what
    // lets the first stamp be permanent without a read-then-write race between two tabs.
    const { error: lastErr } = await args.db
      .from("btw_filings")
      .update({ last_divergence_at: args.nowIso })
      .eq("user_id", args.ownerId)
      .eq("year", args.year)
      .eq("quarter", args.quarter);
    if (lastErr && !isMissingColumn(lastErr.message, (lastErr as { code?: string }).code)) {
      console.error("[SUPPLETIE] could not update the last-moved stamp", {
        ownerId: args.ownerId, year: args.year, quarter: args.quarter, error: lastErr.message,
      });
    }
    return { stamped: true };
  } catch (e) {
    console.error("[SUPPLETIE] stamping threw — the correction itself stands", {
      ownerId: args.ownerId, error: e instanceof Error ? e.message : String(e),
    });
    return { stamped: false, reason: "write_failed" };
  }
}

/** The quarter that comes before this one. */
export function previousQuarter(year: number, quarter: number): { year: number; quarter: number } {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/**
 * [SUPPLETIE-VERREKEND] How far back the aangifte looks for a correction to carry.
 *
 * Four quarters. Not the five-year naheffingstermijn, and the difference is the point: a correction
 * from three years ago is not a carry-forward conversation, it is a suppletie conversation, and it
 * belongs on the Waarheid page where every filed quarter is compared. What this window is for is
 * the realistic case — a late invoice or a corrected reading landing in a quarter the owner filed
 * recently — and four keeps the recomputation bounded to something a page load can afford.
 */
export const CARRY_LOOKBACK_QUARTERS = 4;

/** A correction from an earlier filed quarter that has not been declared anywhere yet. */
export interface OutstandingCorrection {
  year: number;
  quarter: number;
  label: string;
  filedAt: string;
  /** The full movement since filing. */
  btwSaldoDelta: number;
  /** What of it has already been declared in a later aangifte. */
  carriedSaldo: number;
  /** What is still owed — delta minus carried. Positive = more BTW to pay than was filed. */
  outstanding: number;
  route: CorrectionRoute;
}

/**
 * The corrections from earlier quarters that are still owed, for the aangifte being prepared.
 *
 * BESIDE the figures, never inside them — the same rule the ICP-opgaaf follows in /api/aangifte. A
 * correction from a previous quarter is not a rubriek, and folding it into one would put a number
 * on the screen the owner cannot reconcile with any invoice of this quarter. It is named, dated to
 * its source quarter, and left for the owner or the accountant to place on the form.
 *
 * Every earlier quarter in the window is recomputed rather than read from a cached delta, because a
 * stale delta is the one thing worse than no delta here: the owner would carry a figure that is no
 * longer true. Bounded to CARRY_LOOKBACK_QUARTERS, and unfiled quarters cost nothing (one small
 * read each, no recomputation).
 *
 * `unknown` on any failed read or failed recomputation — never an empty list, for the same reason
 * as everywhere else in this file: the caller must be able to say "we could not look".
 */
export async function outstandingCorrections(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any;
  ownerId: string;
  /** The quarter the owner is preparing. Only quarters BEFORE this one are considered. */
  year: number;
  quarter: number;
}): Promise<{ corrections: OutstandingCorrection[]; unknown: boolean }> {
  const corrections: OutstandingCorrection[] = [];
  let unknown = false;
  let cursor = { year: args.year, quarter: args.quarter };

  for (let i = 0; i < CARRY_LOOKBACK_QUARTERS; i++) {
    cursor = previousQuarter(cursor.year, cursor.quarter);
    const { row, failed } = await readFilingWithCarry(args.pipeline, args.ownerId, cursor.year, cursor.quarter);
    if (failed) { unknown = true; continue; }
    if (!row) continue;

    const { start, end } = quarterBounds(cursor.year, cursor.quarter);
    let current;
    try {
      const { result } = await computeResultForRange({ pipeline: args.pipeline, ownerId: args.ownerId, start, end });
      current = result;
    } catch (e) {
      console.error("[SUPPLETIE-VERREKEND] could not recompute an earlier quarter", {
        ownerId: args.ownerId, year: cursor.year, quarter: cursor.quarter,
        error: e instanceof Error ? e.message : String(e),
      });
      unknown = true;
      continue;
    }

    const divergence = computeFilingDivergence(figuresOf(row), {
      omzet: current.omzet, kosten: current.kosten,
      btwVerschuldigd: current.btwVerschuldigd, btwVoorbelasting: current.btwVoorbelasting,
      btwSaldo: current.btwSaldo,
    });
    const carriedSaldo = Number(row.carried_saldo) || 0;
    const outstanding = outstandingCorrection(divergence.btwSaldoDelta, carriedSaldo);
    const route = correctionRoute(outstanding);
    // "none" is the ordinary answer: the quarter never moved, or every cent has been declared.
    // A suppletie is NOT offered here — it needs its own form, and presenting it as a line to carry
    // is how a €4.000 correction gets processed as if it were a €40 one.
    if (route === "carry") {
      corrections.push({
        year: cursor.year, quarter: cursor.quarter, label: quarterLabel(cursor.year, cursor.quarter),
        filedAt: row.filed_at, btwSaldoDelta: divergence.btwSaldoDelta, carriedSaldo, outstanding, route,
      });
    }
  }

  return { corrections, unknown };
}

/** A filing row plus what has already been carried out of it. */
interface FilingRowWithCarry extends FilingRow {
  carried_saldo: number | null;
}

/**
 * readFiling, plus the carried amount.
 *
 * [DEPLOY-SAFE] btw_filings_carried.sql is applied by hand, so `carried_saldo` may not exist yet.
 * A missing COLUMN falls back to the bare read — the correction is then offered as if nothing had
 * been carried, which in an environment where nothing CAN have been carried is exactly right.
 */
export async function readFilingWithCarry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  year: number,
  quarter: number,
): Promise<{ row: FilingRowWithCarry | null; failed: boolean }> {
  const { data, error } = await db
    .from("btw_filings")
    .select(`${FILING_COLS}, carried_saldo`)
    .eq("user_id", userId).eq("year", year).eq("quarter", quarter)
    .maybeSingle();
  if (!error) return { row: (data as FilingRowWithCarry | null) ?? null, failed: false };
  if (isMissingRelation(error.message)) return { row: null, failed: false };
  if (isMissingColumn(error.message, (error as { code?: string }).code)) {
    const bare = await readFiling(db, userId, year, quarter);
    return { row: bare.row ? { ...bare.row, carried_saldo: null } : null, failed: bare.failed };
  }
  console.error("[SUPPLETIE-VERREKEND] btw_filings read failed", { userId, year, quarter, error: error.message });
  return { row: null, failed: true };
}
