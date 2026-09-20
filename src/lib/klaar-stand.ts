// src/lib/klaar-stand.ts
// [KLAAR-STAND] The answer on the door, instead of the question.
//
// /dashboard/klaar has answered "ben ik klaar voor de boekhouder?" since it was built, out of
// /api/readiness — a verdict over everything imported, with the few points that still need
// attention. The dashboard carried a prominent button to it, and that button asked the QUESTION:
// "Ben ik klaar?". So the owner had to open a screen to learn something the app already knew, and
// the state that matters most in this product was the one state never shown at rest.
//
// This module turns the verdict into what the button says. It is pure and holds no language of
// its own ([TAAL]): it returns a key and its parameters, and the component renders them. Text
// direction and translation therefore travel with the owner's own setting, not with this file.
//
// ── WHY "UNKNOWN" IS A STATE AND NOT A DEFAULT ──
// [NO-SILENT-EMPTY] A read that has not answered, or that failed, must NOT look like a verdict.
// "Nothing is waiting" and "we could not look" are opposite answers and the first is the
// dangerous one — an owner who reads green on a quarter nobody measured hands over an incomplete
// administratie. So an absent report keeps the original question, which is honest: we do not know
// yet, open it and find out.

import type { YearQuarter } from "./quarter";

/**
 * [KLAAR-KWARTAAL] The door's destination: the SAME period the verdict on it was measured for.
 *
 * The home asked /api/readiness for the CURRENT quarter and opened /dashboard/klaar bare, which
 * initialises on lastCompletedQuarter() — so the line on the button and the page it opened spoke
 * about two different quarters, precisely the drift quarter.ts exists to prevent. The period now
 * travels in the URL and the page reads it back through quarterFromParams(): one source
 * (lastCompletedQuarter) and one carrier (this path), so the two cannot come apart again.
 */
export function klaarPath(period: YearQuarter): string {
  return `/dashboard/klaar?year=${period.year}&quarter=${period.quarter}`;
}

/**
 * The three verdicts readiness produces, plus two honest ones: we have not measured yet (unknown),
 * and we measured but could not read everything (incomplete — [READINESS-DEGRADE]).
 */
export type KlaarStand = "ready" | "almost" | "attention" | "unknown" | "incomplete";

/**
 * The four keys this module may name. A union, not `string`: the renderer's `t()` is typed on the
 * message catalogue, so a key that does not exist is a compile error here rather than a literal
 * `start.klaar.ready` on a button ([TAAL]).
 */
export type KlaarKey =
  | "start.waarheid.sub"
  | "start.klaar.ready"
  | "start.klaar.almost"
  | "start.klaar.attention"
  | "start.klaar.onvolledig";

/** What the button shows: a dot, a message key, and the count that key needs. */
export interface KlaarRegel {
  stand: KlaarStand;
  /** Message key for the line under the button's title. */
  key: KlaarKey;
  /** Parameters for that key. Empty for the states that count nothing. */
  params: Record<string, string | number>;
  /** The status colour, as the accountant board already uses it — green, amber, red. */
  kleur: string;
}

/** Just enough of ReadinessReport to decide the line — so a render test needs no server. */
export interface KlaarBron {
  status?: unknown;
  missing?: unknown;
  risks?: unknown;
  /** [READINESS-DEGRADE] false when a read the verdict needed did not happen. */
  verified?: unknown;
}

const KLEUR: Record<KlaarStand, string> = {
  ready: "#137333",
  almost: "#7C5800",
  attention: "#B3261E",
  // The question is not a warning: an unmeasured quarter is rendered in the button's own colour.
  unknown: "#5F6368",
  // Measured, but not everything could be read: amber, never green — see readiness.ts.
  incomplete: "#7C5800",
};

const isStand = (v: unknown): v is Exclude<KlaarStand, "unknown"> =>
  v === "ready" || v === "almost" || v === "attention";

/**
 * The line under "Ben ik klaar?", from the readiness report.
 *
 * `null` (not loaded, or the read failed) and an unrecognised status both give "unknown" — a
 * status this app does not know is not a verdict it may render as one.
 */
export function klaarRegel(report: KlaarBron | null | undefined): KlaarRegel {
  const status = report?.status;
  if (!isStand(status)) {
    return { stand: "unknown", key: "start.waarheid.sub", params: {}, kleur: KLEUR.unknown };
  }
  // [READINESS-DEGRADE] Checked BEFORE "ready": a report that says ready and unverified at once
  // cannot come out of buildReadiness, but a stale cache or a hand-made object could, and unknown
  // may never become green here either.
  if (report?.verified === false) {
    return { stand: "incomplete", key: "start.klaar.onvolledig", params: {}, kleur: KLEUR.incomplete };
  }
  if (status === "ready") {
    return { stand: "ready", key: "start.klaar.ready", params: {}, kleur: KLEUR.ready };
  }
  // Both remaining states count the same thing: the points the owner still has to look at.
  // missing and risks are separate lists on the report because they are acted on differently,
  // but on a button they are one number — "nog te doen" is not two questions to the owner.
  const aantal =
    (Array.isArray(report?.missing) ? report.missing.length : 0) +
    (Array.isArray(report?.risks) ? report.risks.length : 0);
  return {
    stand: status,
    key: status === "almost" ? "start.klaar.almost" : "start.klaar.attention",
    params: { count: aantal },
    kleur: KLEUR[status],
  };
}
