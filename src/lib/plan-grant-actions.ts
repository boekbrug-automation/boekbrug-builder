// src/lib/plan-grant-actions.ts
// [TOEKENNING-DEUR] What may be handed out, and what may be withdrawn. Pure: no I/O, no clock.
// Run: npx tsx --test src/lib/plan-grant-actions.test.ts
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
//
// plan_grants has been the commercial override table since the day it was written: what, from
// when, until when, why, and by whom. It is read on every request (fair-use-gate.ts) and on three
// screens. Nothing in the application has ever been able to WRITE one.
//
// So every pilot, every extension and every partner arrangement has been a hand-typed INSERT
// against production. That is not a missing button. A hand-typed statement has no validation, no
// audit row, no second reading of the date, and it is written by somebody who is on the phone with
// the customer at the time. The two mistakes it invites are exactly the two this module refuses.
//
// ── THE TWO MISTAKES ────────────────────────────────────────────────────────────────────────
//
//   · AN EMPTY END DATE MEANS FOREVER. In SQL, `expires_at NULL` is a deliberate feature — a
//     founding-partner arrangement has no end, and plan_grants.sql says so. Through a FORM it is
//     something else entirely: a field somebody did not fill in. The same value cannot be both the
//     rarest deliberate choice and the commonest accident, so open-ended must be DECLARED, and a
//     blank date is refused rather than read as "forever".
//
//   · A YEAR IS ONE KEYSTROKE FROM A DECADE. "2035" for "2025" passes every CHECK on the table:
//     it is in the future and it is after the start. GRANT_MAX_YEARS is the sanity bound, and the
//     way to legitimately exceed it is the open-ended path, which someone has to tick on purpose.
//
// ── WHAT A GRANT STILL IS NOT ───────────────────────────────────────────────────────────────
//
// Ceilings, never money. plan_grants.sql says it and [GEEN-ACHTERDEUR] enforces it in the build:
// an administrator may change what an account MAY DO, never what it DID. Nothing here — and
// nothing on the route that calls it — may reach an invoice, a booking line or a btw figure.
//
// ── EXTENDING IS A NEW ROW ──────────────────────────────────────────────────────────────────
//
// There is no "extend" verb, and that is deliberate. The table holds one row per REASON, and
// grantStanding() already takes the LAST end date among the active ones. So extending is granting
// again, with its own reason and its own date, and the record keeps both halves of the story.
// An UPDATE on expires_at would overwrite the only evidence of what was originally promised.

/** The plans a grant may hand out. Mirrors the CHECK in plan_grants.sql. */
export const GRANTABLE_PLANS: readonly string[] = ["plus"];

/** Mirrors `CHECK (length(btrim(reason)) BETWEEN 3 AND 200)`, so the refusal is a sentence and
 *  not a Postgres error the operator has to interpret. */
export const GRANT_REASON_MIN = 3;
export const GRANT_REASON_MAX = 200;

/**
 * How far ahead a DATED grant may reach. Not a policy about how long an arrangement may last —
 * open-ended exists for that — but a guard against a mistyped year, which the table's own CHECK
 * cannot see: 2035 is as valid a future date as 2025.
 */
export const GRANT_MAX_YEARS = 5;

/** Why a request was refused. Codes, not sentences: the console renders the Dutch. */
export type GrantRefusal =
  | "unknown-plan"        // not in GRANTABLE_PLANS
  | "reason-missing"      // blank, or shorter than the table allows
  | "reason-too-long"     // longer than the table allows
  | "end-not-readable"    // a date string nothing can parse
  | "end-not-declared"    // no date AND open-ended not ticked — the blank-field trap
  | "end-in-past"         // already over before it began
  | "end-too-far"         // beyond GRANT_MAX_YEARS — probably a mistyped year
  | "end-with-open-ended"; // both a date and "no end" — the caller means two things at once

/** What the console asks for. Deliberately primitive: this is what a form produces. */
export interface GrantRequest {
  plan: string;
  reason: string;
  /** ISO date or timestamp, or null. Null alone is NOT open-ended — see `openEnded`. */
  expiresAt: string | null;
  /** Ticked on purpose: this grant has no end date. */
  openEnded: boolean;
}

export type GrantVerdict =
  | { ok: true; plan: string; reason: string; expiresAt: string | null }
  | { ok: false; refusal: GrantRefusal };

const MS_PER_YEAR = 365 * 86_400_000;

/**
 * May this grant be written, and with which values?
 *
 * Returns the CLEANED values on success — the trimmed reason and a normalised ISO expiry — so the
 * caller writes what was judged rather than what was posted. A route that validates one string and
 * inserts another is a route whose validation is decoration.
 *
 * `nowMs` is injected rather than read, for the same reason every pure module here does it: a rule
 * you can test at an exact instant is a rule that gets tested at its boundaries.
 */
export function planGrantVerdict(input: GrantRequest, nowMs: number): GrantVerdict {
  const plan = (input.plan ?? "").trim();
  if (!GRANTABLE_PLANS.includes(plan)) return { ok: false, refusal: "unknown-plan" };

  const reason = (input.reason ?? "").trim();
  if (reason.length < GRANT_REASON_MIN) return { ok: false, refusal: "reason-missing" };
  if (reason.length > GRANT_REASON_MAX) return { ok: false, refusal: "reason-too-long" };

  const raw = (input.expiresAt ?? "").trim();

  // Both at once is not a stricter request, it is an unclear one: the date says March and the tick
  // says never. Refused rather than resolved, because either resolution is somebody's assumption.
  if (input.openEnded === true && raw !== "") return { ok: false, refusal: "end-with-open-ended" };

  if (input.openEnded === true) {
    return { ok: true, plan, reason, expiresAt: null };
  }

  // The trap this module exists for: an empty field is not a decision.
  if (raw === "") return { ok: false, refusal: "end-not-declared" };

  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false, refusal: "end-not-readable" };
  if (ms <= nowMs) return { ok: false, refusal: "end-in-past" };
  if (ms > nowMs + GRANT_MAX_YEARS * MS_PER_YEAR) return { ok: false, refusal: "end-too-far" };

  return { ok: true, plan, reason, expiresAt: new Date(ms).toISOString() };
}

/**
 * Is this row still withdrawable?
 *
 * A grant that is already revoked is left exactly as it is. Not an error the operator has to read
 * — two people closing the same pilot is an ordinary Tuesday — but not a write either: re-stamping
 * revoked_at would replace who stopped it and when with whoever clicked last, and that is the one
 * fact a withdrawal exists to record.
 */
export function isRevokable(row: { revoked_at: string | null } | null | undefined): boolean {
  return !!row && !row.revoked_at;
}
