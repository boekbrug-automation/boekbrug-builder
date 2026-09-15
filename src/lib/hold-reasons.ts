// src/lib/hold-reasons.ts
// [WAAROM-VASTGEHOUDEN] Which refusal costs the owner the most minutes — counted, named, ranked.
//
// ── WHY THIS EXISTS ──
//
// Measured on one real administration over a year: 350 of 590 incoming documents needed a human
// hand. That is the number this whole product is judged by, because the promise is "do your job,
// we'll take care of everything else" — and a queue of 350 is not taking care of anything.
//
// The obvious next question is WHICH 350. Not "how good is the reader" in the abstract: which
// single refusal, fixed once, hands back the most hours. beslisAutoAdvance already answers it —
// it computes a precise tag for every refusal, seventeen of them — but until this measurement was
// written the tag was stored only when the document PASSED. On a refusal it was computed and
// discarded, exactly at the moment the app decided to spend a minute of somebody's life.
//
// So this module folds those tags into a ranking. It is deliberately not a quality score: a
// refusal is the app being careful, and being careful is right. It is a WORK LIST, ordered by how
// much time each entry costs.
//
// ── WHAT IT MAY NOT DO ──
//
// A held document whose reason was never recorded — everything from before this measurement, and
// anything a future path forgets to tag — is counted apart and shown apart. Folding it into the
// ranking would quietly shrink every percentage and make the largest category invisible, which is
// the exact failure this file was written to end.
//
// Pure judgement below, the database read at the bottom, and no clock of its own.

import { fetchAllRows } from "@/lib/supabase-paginate";

/** One incoming document, as the panel needs it. */
export interface HeldDocument {
  id: string;
  supplierName: string | null;
  createdAtMs: number | null;
  /** True when `field_confidence._auto_verified` is present — the app booked this one itself. */
  autoAdvanced: boolean;
  /** The machine tag from `field_confidence._auto_hold.reason`, or null when none was recorded. */
  holdReason: string | null;
}

export interface HoldReason {
  /** The machine tag, exactly as beslisAutoAdvance produced it. */
  reason: string;
  /** A sentence the operator can act on; the raw tag when this module does not know it yet. */
  label: string;
  count: number;
  /** Share of ALL held documents, including the ones with no recorded reason. One decimal. */
  sharePct: number;
  /**
   * Suppliers this reason concentrates on, worst first, only those hit more than once. A refusal
   * spread over forty vendors is the reader's general limit; the same refusal on one vendor twenty
   * times is one template, and templates are what actually get fixed.
   */
  topSuppliers: { supplierName: string; count: number }[];
}

export interface HoldSummary {
  /** Incoming documents inside the window. */
  total: number;
  /** …of which the app booked itself, hands-off. */
  advanced: number;
  /** …of which a human had to touch. THE number: this is what the promise is measured against. */
  held: number;
  /** Held documents that carry a recorded reason. */
  recorded: number;
  /**
   * Held documents with NO recorded reason. Never merged into the ranking: before this
   * measurement shipped nothing was written down, so this bucket is large at first and shrinks by
   * itself. A rising one means a path stopped recording.
   */
  unrecorded: number;
  /** The ranking, biggest first. */
  reasons: HoldReason[];
}

const NAMELESS = "(zonder leverancier)";

/**
 * The machine tags, in the operator's language.
 *
 * Every tag beslisAutoAdvance can return must appear here — a [WAAROM-VASTGEHOUDEN] gate searches
 * that file and fails when a new refusal arrives without a sentence. The gate is a SCAN, not a
 * copy of this list: a hand-kept list checked against a hand-kept list agrees with itself forever.
 *
 * An unknown tag still renders (as itself); it is never dropped. A ranking that silently omits the
 * category it does not recognise is worse than one that shows an ugly word.
 *
 * Not a copy of GATES in scripts/gate-yield.ts, which names the same tags in English and answers a
 * different question — "which gate would still have caught this if the others were gone", by
 * REPLAYING the decision over old rows. That is the case for keeping a gate. This is the case for
 * spending the next week on one, in the language of the person who decides, on the page they open.
 */
export const HOLD_LABELS: Readonly<Record<string, string>> = {
  // Geen kwaliteitssignaal maar een KEUZE: de eigenaar zette "ik kijk zelf naar alles" aan. Staat
  // deze regel bovenaan, dan verandert geen enkele leesverbetering iets aan het handwerk — dan is
  // het de schakelaar. Dat verschil verzwijgen zou de hele lijst verkeerd laten lezen.
  owner_reviews_everything: "De eigenaar heeft \"ik kijk zelf naar alles\" aanstaan — dit is een keuze, geen leesprobleem",
  paid_mark_not_settled: "Het document draagt een betaalspoor dat in dezelfde stap niet is afgerekend",
  from_email_body: "Het document komt uit de tekst van een e-mail, niet uit een bijlage",
  uncertain: "De lezer was niet zeker genoeg over deze bijlage",
  forced_duplicate: "De eigenaar voegde een mogelijke dubbele factuur toch toe — dat blijft altijd handwerk",
  not_invoice: "Het document is volgens de lezer geen factuur",
  statement: "Het document is een rekeningoverzicht, geen factuur",
  reminder: "Het document is een herinnering van een factuur die er al hoort te zijn",
  creditnota: "Het document is een creditnota — die gaan nooit vanzelf door",
  // [AANSLAG] Ook een keuze, geen leesprobleem: waar het geld boekt (privé, afdracht, kost) is
  // aan de eigenaar. Een lezer die beter wordt, verandert hieraan niets.
  tax_letter: "Het document is een brief van de Belastingdienst — waar die boekt beslist de eigenaar",
  no_reliable_total: "Het totaalbedrag was niet betrouwbaar te lezen",
  zero_btw_not_explicit_zero_rate: "De btw stond op nul zonder dat er 0% op het document staat",
  foreign_currency: "Het document staat in een andere munt dan de euro — niets is omgerekend",
  self_billed: "Het document zegt dat de afnemer hem heeft opgemaakt — verkoop of inkoop beslist de eigenaar",
  total_derived_never_grounded: "Het totaal is afgeleid en stond nergens zo op het document",
  total_not_in_document_text: "Het gelezen totaal komt niet voor in de tekst van het document",
  total_not_where_a_total_is_printed: "Het gelezen bedrag staat niet op de plek waar een totaal hoort",
  btw_contradicts_printed_split: "De btw-verdeling spreekt de gedrukte verdeling tegen",
  e_invoice_contradicts_read: "De e-factuur van de leverancier zegt iets anders dan de lezer",
  overall_confidence_missing_or_low: "De lezer was over het geheel niet zeker genoeg",
  needs_review: "De gezondheidscontrole zette er een vlag op",
  amount_confidence_below_high_bar: "De zekerheid over het bedrag bleef onder de hoge drempel",
  no_amount_confidence_and_overall_not_very_high: "Geen zekerheid over het bedrag, en het geheel was niet zeer zeker",
  field_confidence_below_high_bar: "De zekerheid over een veld bleef onder de hoge drempel",
  multiple_invoices_in_file: "Er zaten meerdere facturen in één bestand",
  not_eligible: "De factuur kwam niet in aanmerking (verkeerde status of geen leesuitslag)",
};

/** The sentence for a tag; the tag itself when it is not known here. */
export function holdLabel(reason: string): string {
  return HOLD_LABELS[reason] ?? reason;
}

/**
 * Fold the documents into a ranked work list.
 *
 * `windowDays` scopes from `nowMs`. Documents with no timestamp fall outside — an undated row
 * cannot be attributed to a period, and guessing "recent" would inflate exactly the number this
 * panel exists to state honestly.
 */
export function judgeHoldReasons(
  docs: HeldDocument[],
  opts: { nowMs: number; windowDays: number; topSuppliersPerReason?: number },
): HoldSummary {
  const floor = opts.nowMs - opts.windowDays * 24 * 60 * 60 * 1000;
  const inWindow = docs.filter((d) => d.createdAtMs !== null && d.createdAtMs >= floor);

  const advanced = inWindow.filter((d) => d.autoAdvanced);
  const held = inWindow.filter((d) => !d.autoAdvanced);
  const recorded = held.filter((d) => (d.holdReason ?? "").trim() !== "");

  const perReason = new Map<string, { count: number; suppliers: Map<string, number> }>();
  for (const d of recorded) {
    const tag = (d.holdReason ?? "").trim();
    let bucket = perReason.get(tag);
    if (!bucket) {
      bucket = { count: 0, suppliers: new Map() };
      perReason.set(tag, bucket);
    }
    bucket.count += 1;
    const naam = (d.supplierName ?? "").trim() || NAMELESS;
    bucket.suppliers.set(naam, (bucket.suppliers.get(naam) ?? 0) + 1);
  }

  const limiet = opts.topSuppliersPerReason ?? 3;
  const reasons: HoldReason[] = [...perReason.entries()]
    .map(([reason, b]) => ({
      reason,
      label: holdLabel(reason),
      count: b.count,
      // The denominator is EVERY held document, not just the recorded ones: dividing by the
      // recorded subset would report 100% of the work explained while most of it is not.
      sharePct: held.length === 0 ? 0 : Math.round((1000 * b.count) / held.length) / 10,
      topSuppliers: [...b.suppliers.entries()]
        .filter(([, n]) => n > 1)
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, limiet)
        .map(([supplierName, count]) => ({ supplierName, count })),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    total: inWindow.length,
    advanced: advanced.length,
    held: held.length,
    recorded: recorded.length,
    unrecorded: held.length - recorded.length,
    reasons,
  };
}

/** The share of documents the app handled without a human, one decimal. Null when nothing came in. */
export function handsOffPct(s: HoldSummary): number | null {
  if (s.total === 0) return null;
  return Math.round((1000 * s.advanced) / s.total) / 10;
}

// ── De lezing ────────────────────────────────────────────────────────────────

/**
 * Read what the ranking needs, for EVERY account.
 *
 * Paginated: `.limit()` here would cut the tail of the queue, and the tail is where a systematic
 * refusal piles up. Faalt de lezing, dan komt er `null` uit en zegt het scherm dat het niet kon
 * kijken — "geen werk in de wachtrij" en "we konden het niet meten" mogen nooit hetzelfde zijn.
 */
export async function readHoldReasons(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  opts: { nowMs: number; windowDays: number; topSuppliersPerReason?: number },
): Promise<HoldSummary | null> {
  const sinds = new Date(opts.nowMs - opts.windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rijen = await fetchAllRows<{
      id: string; client_name: string | null; created_at: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      field_confidence: any;
    }>((lo, hi) =>
      pipeline
        .from("invoices")
        .select("id, client_name, created_at, field_confidence")
        .eq("direction", "incoming")
        .gte("created_at", sinds)
        .order("id", { ascending: true })
        .range(lo, hi),
    );

    return judgeHoldReasons(rijen.map((r) => readMarkers(r)), opts);
  } catch {
    return null;
  }
}

/** Pull the two markers out of one stored `field_confidence`. Exported so a test can hold it still. */
export function readMarkers(row: {
  id: string; client_name: string | null; created_at: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  field_confidence: any;
}): HeldDocument {
  const fc = row.field_confidence && typeof row.field_confidence === "object"
    ? (row.field_confidence as Record<string, unknown>)
    : null;
  const hold = fc && typeof fc._auto_hold === "object" && fc._auto_hold !== null
    ? (fc._auto_hold as Record<string, unknown>)
    : null;
  const reason = hold && typeof hold.reason === "string" ? hold.reason : null;
  return {
    id: row.id,
    supplierName: row.client_name,
    createdAtMs: row.created_at ? Date.parse(row.created_at) : null,
    autoAdvanced: !!(fc && fc._auto_verified),
    holdReason: reason,
  };
}
