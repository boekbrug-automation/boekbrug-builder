// src/lib/numbering-lines.ts
// [KANTOOR-PERIODE] The numbering verdict, as SENTENCES — shared, so there is only ever one set.
// Pure: no React, no I/O. Run: npx tsx --test src/lib/numbering-lines.test.ts
//
// WHY THIS LEFT THE PANEL
//
// NummeringPaneel built its lines inline in JSX. The period workspace now shows the same findings,
// and the obvious shortcut — writing the same sentences again over there — is exactly how this app
// once ended up with THREE Dutch vocabularies for one readiness fact on three adjacent screens.
// So the composition moved here, both readers consume it, and a rewording happens once or not at
// all.
//
// The shape is deliberately not a finished string. The panel renders the series label bold and the
// parts after it, and flattening that here would have changed the owner's own screen — which this
// batch may not do. So the pieces come out separately: the panel assembles them exactly as it
// always did, and the workspace joins them into one line.

import type { SeriesReport } from "./invoice-continuity";
import type { Translator } from "./i18n/t";

/** Who is reading — the same two voices Batch 1 established. */
export type NumberingAudience = "owner" | "accountant";

/** One series with something to say, in pieces the caller assembles. */
export interface NumberingLine {
  /** Stable per series; the panel already keyed its rows this way. */
  key: string;
  /** "Facturen 2026" / "Creditnota's 2026" — the series names its own year, whatever is on screen. */
  label: string;
  missing: string | null;
  burned: string | null;
  duplicates: string | null;
}

/** The series names an owner recognises: the document type plus its year. */
export function seriesLabel(s: SeriesReport, t: Translator): string {
  const name = s.type === "creditnota" ? t("doorlopend.reeks.creditnota") : t("doorlopend.reeks.factuur");
  return s.year === null ? name : `${name} ${s.year}`;
}

/** The series that have something wrong with them — the panel's own filter, unchanged. */
export function numberingProblems(series: readonly SeriesReport[]): SeriesReport[] {
  return series.filter((s) => s.missing.length > 0 || s.duplicates.length > 0 || (s.burnedAtEnd ?? 0) > 0);
}

/**
 * One line per troubled series.
 *
 * [REEKS-ZONDER-FACTUUR] Two sentences for the burned half, because they are two different facts:
 * "at the end of the series" presupposes a series, while `issued === 0` means nothing was ever
 * written under that counter — a different message with a different answer to it.
 */
export function numberingLines(
  series: readonly SeriesReport[],
  t: Translator,
  audience: NumberingAudience,
): NumberingLine[] {
  const acc = audience === "accountant";
  return numberingProblems(series).map((s) => ({
    key: `${s.type}-${s.year ?? "x"}`,
    label: seriesLabel(s, t),
    missing: s.missing.length > 0 ? t("doorlopend.ontbreekt", { nummers: s.missing.join(", ") }) : null,
    burned:
      (s.burnedAtEnd ?? 0) > 0
        ? s.issued === 0
          ? t(acc ? "doorlopend.reeksLeegAcc" : "doorlopend.reeksLeeg", { aantal: s.burnedAtEnd as number })
          : t(acc ? "doorlopend.eindeReeksAcc" : "doorlopend.eindeReeks", { aantal: s.burnedAtEnd as number })
        : null,
    duplicates: s.duplicates.length > 0 ? t("doorlopend.dubbel", { nummers: s.duplicates.join(", ") }) : null,
  }));
}

/** The same line as one string, for a reader that has no room for a bold label. */
export function numberingLineText(line: NumberingLine): string {
  return [line.label, line.missing, line.burned, line.duplicates].filter(Boolean).join(" ");
}

/**
 * Numbers in a format we do not know — not a gap and not dropped.
 *
 * Capped at eight in the sentence, as the panel always did: naming them lets the reader recognise
 * imported history instead of wondering what we mean, and the whole list would be a wall.
 */
export function numberingUnreadableText(
  unreadable: readonly string[],
  t: Translator,
  audience: NumberingAudience,
): string | null {
  if (unreadable.length === 0) return null;
  return t(audience === "accountant" ? "doorlopend.onleesbaarAcc" : "doorlopend.onleesbaar", {
    nummers: unreadable.slice(0, 8).join(", "),
  });
}
