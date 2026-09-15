// src/lib/plan-grants.ts
// [TOEKENNING] Why an account has more than the free plan — reduced from rows to two facts.
// Pure: no I/O, no clock beyond the one it is handed. Run: npx tsx --test src/lib/plan-grants.test.ts
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────
//
// plan_grants holds one row per reason an account has Plus without paying: the 90-day welcome
// period every new account gets, an office piloting twenty clients for six months, a support
// extension. decidePlan() does not want rows; it wants "until when, and is one of them open-
// ended". This is the reduction, and it is separate from decidePlan for the reason every pure
// module in this project is separate — a rule you can test without a database is a rule that gets
// tested.
//
// ── THE THREE WAYS A GRANT IS NOT ACTIVE, AND WHY EACH IS CHECKED HERE ──────────────────────
//
//   · REVOKED — someone stopped it early. The row stays, because the reason it existed is part of
//     the record; revoked_at is what makes it stop counting.
//   · NOT STARTED — starts_at in the future. A grant that begins next month is a promise, not an
//     entitlement, and a reduction that ignored starts_at would hand it out today.
//   · EXPIRED — expires_at in the past.
//
// An unreadable date counts as NOT active, in every one of the three. That is the safe direction
// here and it is worth being explicit about why: the wrong answer costs somebody the free
// ceilings for a while, and the free plan takes nothing away — everything stays readable,
// searchable and exportable. The opposite failure would hand out Plus on a corrupt row forever.

/** One row of plan_grants, as the database spells it. */
export interface PlanGrantRow {
  plan: string | null;
  starts_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  reason?: string | null;
}

/** What decidePlan needs, and nothing else. */
export interface GrantStanding {
  /** The LAST end date among active grants, ISO, or null when none is active. */
  grantedPlusUntil: string | null;
  /** An active grant with no end date at all. */
  grantOpenEnded: boolean;
}

const NONE: GrantStanding = { grantedPlusUntil: null, grantOpenEnded: false };

/** ISO → epoch ms, or null for null, empty and nonsense. */
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Which of these rows count right now, reduced to the two facts decidePlan asks for.
 *
 * `nowMs` is injected rather than read, so this is deterministic — the same reason parseTimestamp
 * and daysUntil in subscription.ts take one.
 */
export function grantStanding(rows: readonly PlanGrantRow[] | null | undefined, nowMs: number): GrantStanding {
  if (!rows || rows.length === 0) return NONE;

  let latest: number | null = null;
  let openEnded = false;

  for (const row of rows) {
    // Only the tier this app knows. An unknown plan string is a row written by something newer
    // than this code, and guessing what it grants is how a future tier leaks into today's build.
    if (row.plan !== "plus") continue;
    if (row.revoked_at !== null && row.revoked_at !== undefined) continue;

    // A missing starts_at reads as "not started". The column is NOT NULL in the database, so this
    // is only reachable from a partial select — and a caller that forgot the column should not be
    // handed Plus for it.
    const start = ms(row.starts_at);
    if (start === null || start > nowMs) continue;

    if (row.expires_at === null || row.expires_at === undefined) {
      openEnded = true;
      continue;
    }
    const end = ms(row.expires_at);
    if (end === null || end <= nowMs) continue;
    if (latest === null || end > latest) latest = end;
  }

  return {
    grantedPlusUntil: latest === null ? null : new Date(latest).toISOString(),
    grantOpenEnded: openEnded,
  };
}

/**
 * Whole days left on the standing, for the screen that says so. null when nothing is running or
 * when it never ends — "nog 0 dagen" and "nog ∞ dagen" are both sentences a screen must not write.
 */
export function daysLeftOnGrant(standing: GrantStanding, nowMs: number): number | null {
  if (standing.grantOpenEnded) return null;
  const end = ms(standing.grantedPlusUntil);
  if (end === null || end <= nowMs) return null;
  return Math.max(1, Math.ceil((end - nowMs) / 86_400_000));
}
