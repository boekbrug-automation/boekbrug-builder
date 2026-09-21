// src/lib/period-workspace.ts
// [KANTOOR-PERIODE] What the accountant already knows about a client-period, arranged to be worked.
// Pure: no I/O, no React, no i18n. Run: npx tsx --test src/lib/period-workspace.test.ts
//
// WHAT THIS IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
//
// The quarter screen used to open on controls, then two warning panels, then figures, then several
// hundred invoice rows, and the boekhouder read the whole administration to discover the job. This
// module turns what the app ALREADY KNOWS into a short list that can be worked, and then the
// figures, and then the invoices as evidence.
//
// It is NOT a second exception engine. Every sentence it carries was written by the source that
// found the problem — readiness' own `title`, the money rule's own `accountantMessage` through
// findingText(), the numbering panel's own line. This module decides ORDER, SCOPE and OVERFLOW.
// It never decides truth. Nothing here compares amounts, infers a period, ranks severity, or
// remembers that anybody looked.
//
// ── SCOPE IS PART OF THE TRUTH, AND THERE ARE FOUR OF THEM ──
//
// The four sources do not measure the same span, and pretending they do is the one lie this screen
// could tell that an accountant would act on:
//
//   · KWARTAAL      /api/readiness?year&quarter — genuinely the selected period.
//   · ADMINISTRATIE /api/money-audit `violations` — invoices against their payments across the
//                   WHOLE administration. The payload carries no date at all, so the period of a
//                   finding is not merely unknown here, it is unknowable without changing a money
//                   route. It is therefore never placed under the selected quarter.
//   · NUMMERING     /api/invoice/continuity — per (year, series). A gap in 2025 is still a gap
//                   while the accountant looks at Q3 2026, and filtering it away would hide a
//                   problem because of where the reader happens to be standing.
//   · KAS           /api/money-audit `drawer` — computed from the CURRENT Amsterdam quarter
//                   (money-audit/route.ts: `amsterdamYear()`), never from the selected one. So it
//                   keeps a scope of its own even when the two happen to coincide: a drawer
//                   finding placed under "Q1 2026" would be a claim about a quarter nobody checked.
//
// ── AND WHY THERE IS NO NUMBER AT THE TOP ──
//
// Four sources, four ways to fail independently. A heading that says "3 aandachtspunten" over a
// list assembled from a source that did not answer is a correct count of an incomplete set — the
// same defect the readiness score had, and the same correction applies: state facts, never
// completeness. The caps below produce LOCAL counts ("+12 meer") and that is different in kind:
// those count a list that was read successfully, in full, and then folded for the eye.

import { findingText } from "./money-invariants";
import { numberingLines, numberingLineText, numberingUnreadableText } from "./numbering-lines";
import { clientQuarterHref, opvragenHref } from "./accountant-deep-links";
import { workKey } from "@/modules/accountant/work-grouping";
import type { SeriesReport } from "./invoice-continuity";
import type { Translator } from "./i18n/t";

/** Which span a finding is true of. Rendered in this order, always. */
export type WorkScope = "kwartaal" | "administratie" | "nummering" | "kas";

export const WORK_SCOPES: readonly WorkScope[] = ["kwartaal", "administratie", "nummering", "kas"];

/** Which family found it — for grouping, ordering and tests; never for severity. */
export type WorkSource =
  | "readiness-missing"
  | "readiness-risk"
  | "vraag"
  | "geld"
  | "nummering"
  | "kas";

/**
 * One thing the accountant may want to look at.
 *
 * The field list is deliberately short and deliberately dumb. There is no `severity`, no `euros`,
 * no `quarter`, no `resolved`: every one of those would be this module inventing a fact, and the
 * screen would then be asserting something no source ever said.
 */
export interface WorkItem {
  source: WorkSource;
  scope: WorkScope;
  /**
   * Which items fold together when the list is long. Presentation only — never identity.
   *
   * Namespaced by SOURCE FAMILY, always. Without the prefix a readiness title whose workKey
   * happened to be "vraag" would fold into the open-question group, and a fold is a claim that
   * the things inside it are the same kind of thing.
   */
  groupKey: string;
  /** The sentence the SOURCE wrote. Never composed, shortened or rephrased here. */
  text: string;
  /** Only a destination Batch 2 already proved. Absent is normal and means "no exact target". */
  href?: string;
  /** Stable enough to key a list and to say which row this came from. Never used as equality. */
  sourceIdentity: string;
}

/** A fold: the items shown at rest, and the ones behind the disclosure. Nothing is dropped. */
export interface WorkGroupView {
  key: string;
  shown: WorkItem[];
  hidden: WorkItem[];
}

/** One scope's share of the screen. */
export interface ScopeView {
  scope: WorkScope;
  groups: WorkGroupView[];
  /** Whole groups beyond the ceiling — folded, never discarded. */
  hiddenGroups: WorkGroupView[];
  /**
   * What a source said when it could NOT answer, in the source's own words.
   *
   * [NO-SILENT-EMPTY] Kept beside the findings and never instead of them: a Geld read that failed
   * does not make a numbering gap less true, and an empty list under a failed read is the screen
   * asserting "nothing here" about something it did not look at.
   */
  notices: string[];
}

/** How many findings hide behind a fold — a count of a list that WAS read, never of the unknown. */
export function hiddenCount(group: WorkGroupView): number {
  return group.hidden.length;
}

/** How many findings hide behind a whole scope's fold. */
export function hiddenGroupItemCount(view: ScopeView): number {
  return view.hiddenGroups.reduce((n, g) => n + g.shown.length + g.hidden.length, 0);
}

/** Does this scope have anything at all to put on the screen? */
export function scopeHasContent(view: ScopeView): boolean {
  return view.groups.length > 0 || view.hiddenGroups.length > 0 || view.notices.length > 0;
}

/**
 * At-rest ceilings.
 *
 * A retail client with a bad month can produce dozens of findings, and "exceptions first" would
 * then be a wall — the crowded dashboard this batch exists to avoid. So the screen shows a
 * workable amount and folds the rest. Both numbers are small on purpose: the point of the list is
 * that it can be read standing up.
 */
export const MAX_GROUPS_PER_SCOPE = 8;
export const MAX_ITEMS_PER_GROUP = 3;

/**
 * Items → one scope's view.
 *
 * Order is INSERTION order throughout: the order the caller collected the sources in, and within a
 * group the order the source returned. Nothing is sorted by size or by amount, because "biggest
 * first" is a severity judgement and this module does not make those. A stable order also means
 * the screen does not reshuffle itself between two reads that found the same work.
 */
export function buildScopeView(
  scope: WorkScope,
  items: readonly WorkItem[],
  notices: readonly string[] = [],
): ScopeView {
  const byKey = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (item.scope !== scope) continue; // a caller mistake must not move a finding between spans
    const list = byKey.get(item.groupKey);
    if (list) list.push(item);
    else byKey.set(item.groupKey, [item]);
  }

  const all: WorkGroupView[] = [...byKey.entries()].map(([key, list]) => ({
    key,
    shown: list.slice(0, MAX_ITEMS_PER_GROUP),
    hidden: list.slice(MAX_ITEMS_PER_GROUP),
  }));

  return {
    scope,
    groups: all.slice(0, MAX_GROUPS_PER_SCOPE),
    hiddenGroups: all.slice(MAX_GROUPS_PER_SCOPE),
    notices: [...notices],
  };
}

/**
 * Every item this view will put on the screen, folded or not.
 *
 * Exists so a test can prove the obvious thing that is easy to break: a `.slice()` added for
 * layout must never be the reason a finding stops existing.
 */
export function allItemsOf(view: ScopeView): WorkItem[] {
  const out: WorkItem[] = [];
  for (const g of [...view.groups, ...view.hiddenGroups]) out.push(...g.shown, ...g.hidden);
  return out;
}

/** Is there anything at all to show, across every scope? Used to decide whether the block exists. */
export function workspaceHasContent(views: readonly ScopeView[]): boolean {
  return views.some(scopeHasContent);
}

// ─── Sources → items ──────────────────────────────────────────────────────────
//
// One place where every source family is mapped, so the scope of a finding, the sentence it
// carries and the destination it may have are decided ONCE and can be read in one screenful. A
// second mapping somewhere else is how the four spans above would quietly merge again.

/** A finding as the money route hands it over — both sentences, written at the rule. */
export interface MoneyFinding {
  kind: string;
  entityId: string;
  message: string;
  accountantMessage: string;
}

/** A read that answered, or one that did not. Never collapsed into an empty list. */
export type SourceRead<T> = { ok: true; value: T } | { ok: false };

export interface WorkspaceSources {
  clientId: string;
  year: number;
  quarter: number;
  /** /api/readiness?clientId&year&quarter — the only genuinely period-scoped source. */
  readiness: SourceRead<{ missing: { title: string }[]; risks: { title: string }[] }>;
  /** /api/money-audit — `violations` administration-wide, `drawer` on the CURRENT quarter. */
  geld: SourceRead<{ violations: MoneyFinding[]; drawer: MoneyFinding[]; drawerChecked: boolean }>;
  /** /api/invoice/continuity — per (year, series). */
  nummering: SourceRead<{ series: SeriesReport[]; unreadable: string[]; countersRead: boolean }>;
  /** The invoice rows this page already loaded; no second query exists for this. */
  vragen: SourceRead<{ id: string; invoice_number: string | null; client_name: string | null }[]>;
}

/**
 * The four scopes, filled.
 *
 * Every `text` below comes out of a source. The only strings this function composes are the
 * IDENTITY of an invoice that carries an open question — its existing status label and its own
 * number and counterparty, joined by a separator. That is a name, not a diagnosis.
 */
export function buildWorkspace(sources: WorkspaceSources, t: Translator): ScopeView[] {
  const { clientId, year, quarter } = sources;
  const period = { clientId, year, quarter };

  // ── A · the selected quarter ────────────────────────────────────────────────
  const kwartaalItems: WorkItem[] = [];
  const kwartaalNotices: string[] = [];
  if (sources.readiness.ok) {
    for (const m of sources.readiness.value.missing) {
      kwartaalItems.push({
        source: "readiness-missing",
        scope: "kwartaal",
        // `missing[]` carries a title and nothing stable, so the grouping key is derived from the
        // words — presentation only. It never decides that two findings ARE the same fact.
        groupKey: `readiness-missing:${workKey(m.title) || m.title.toLowerCase()}`,
        text: m.title,
        // The gap the client can close: the screen that asks them for it, already on this period.
        // Deliberately not readiness' own `fix` href — those are OWNER routes.
        href: opvragenHref(period),
        sourceIdentity: `readiness-missing:${m.title}`,
      });
    }
    for (const r of sources.readiness.value.risks) {
      kwartaalItems.push({
        source: "readiness-risk",
        scope: "kwartaal",
        groupKey: `readiness-risk:${workKey(r.title) || r.title.toLowerCase()}`,
        text: r.title,
        // A reconciliation difference is the accountant's own check, not something to ask a client
        // for; Opvragen excludes risks on purpose, so this one carries no destination.
        sourceIdentity: `readiness-risk:${r.title}`,
      });
    }
  } else {
    kwartaalNotices.push(t("bh.opvr.fout.lezen"));
  }

  if (sources.vragen.ok) {
    for (const inv of sources.vragen.value) {
      kwartaalItems.push({
        source: "vraag",
        scope: "kwartaal",
        groupKey: "vraag:open",
        // Identity, not a sentence: the status word this screen already puts on the row, then the
        // invoice's own number and counterparty.
        text: [t("bh.kwt.actie.vraag"), inv.invoice_number, inv.client_name].filter(Boolean).join(" · "),
        // The row is on THIS page; ?focus= opens and highlights it.
        href: clientQuarterHref(period, inv.id),
        sourceIdentity: `vraag:${inv.id}`,
      });
    }
  } else {
    // [NO-SILENT-EMPTY] An invoice read that failed is not "no open questions".
    kwartaalNotices.push(t("bh.kwt.leesfout"));
  }

  // ── B · the whole administration ────────────────────────────────────────────
  const geldItems: WorkItem[] = [];
  const geldNotices: string[] = [];
  const kasItems: WorkItem[] = [];
  const kasNotices: string[] = [];
  if (sources.geld.ok) {
    for (const f of sources.geld.value.violations) {
      geldItems.push({
        source: "geld",
        scope: "administratie",
        groupKey: `geld:${f.kind}`,
        text: findingText(f, "accountant"),
        // No destination: `entityId` is a bank transaction for the allocation kinds, one arbitrary
        // half of a pair for a duplicate, and the payload carries no date — so there is no quarter
        // to open and nothing exact to focus. Batch 3 does not reopen that.
        sourceIdentity: `${f.kind}:${f.entityId}`,
      });
    }
    // ── D · the cash drawer, on the CURRENT quarter ───────────────────────────
    for (const f of sources.geld.value.drawer) {
      kasItems.push({
        source: "kas",
        scope: "kas",
        groupKey: `kas:${f.kind}`,
        text: findingText(f, "accountant"),
        sourceIdentity: `${f.kind}:${f.entityId}`,
      });
    }
    // Half a check is named, always — a silence here would read as "checked, and fine".
    if (!sources.geld.value.drawerChecked) kasNotices.push(t("geld.ladeNietGecontroleerd"));
  } else {
    geldNotices.push(t("geld.nietGelezenAcc"));
    // The drawer travels in the same answer, so an unread money audit leaves BOTH spans unknown.
    kasNotices.push(t("geld.nietGelezenAcc"));
  }

  // ── C · the numbering, per series and year ──────────────────────────────────
  const nummeringItems: WorkItem[] = [];
  const nummeringNotices: string[] = [];
  if (sources.nummering.ok) {
    const { series, unreadable, countersRead } = sources.nummering.value;
    for (const line of numberingLines(series, t, "accountant")) {
      nummeringItems.push({
        source: "nummering",
        scope: "nummering",
        groupKey: `nummering:${line.key}`, // the series IS the group: type + year
        text: numberingLineText(line),
        sourceIdentity: `nummering:${line.key}`,
      });
    }
    const onleesbaar = numberingUnreadableText(unreadable, t, "accountant");
    if (onleesbaar) {
      nummeringItems.push({
        source: "nummering",
        scope: "nummering",
        groupKey: "nummering:onleesbaar",
        text: onleesbaar,
        sourceIdentity: "nummering:onleesbaar",
      });
    }
    if (!countersRead) nummeringNotices.push(t("doorlopend.halfGecontroleerd"));
  } else {
    nummeringNotices.push(t("doorlopend.nietGelezenAcc"));
  }

  return [
    buildScopeView("kwartaal", kwartaalItems, kwartaalNotices),
    buildScopeView("administratie", geldItems, geldNotices),
    buildScopeView("nummering", nummeringItems, nummeringNotices),
    buildScopeView("kas", kasItems, kasNotices),
  ];
}
