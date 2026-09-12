// src/lib/control-overview.ts
// [CONTROL] The commercial state of the whole product, reduced to what a person can read.
// Pure: no I/O, no clock beyond the one it is handed. Run: npx tsx --test src/lib/control-overview.test.ts
//
// ── WHAT THIS COUNTS, AND WHAT IT REFUSES TO ────────────────────────────────────────────────
//
// Accounts by the plan they are actually on, offices and their client counts, and the grants that
// are running. That is commercial state, and it is the console's whole subject.
//
// It does NOT compute revenue. The obvious next line is `payingAccounts × PLUS_PRICE_EUR = MRR`,
// and that number would be wrong in both directions on the day it is printed: a subscription in
// its grace period is not revenue, one cancelled yesterday still counts here, and Stripe's own
// figure includes tax handling and failed collections this code knows nothing about. It is the
// same rule work-done.ts follows about minutes — an invented figure is one an accountant
// disproves in an afternoon, and this one would be disprovable by a bank statement. When MRR is
// wanted it comes from Stripe, which is where the money actually is.

import { decidePlan, type Plan } from "./subscription";
import { grantStanding, type PlanGrantRow } from "./plan-grants";

export interface ControlAccount {
  id: string;
  name: string;
  role: string | null;
  createdAt: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  grants: readonly PlanGrantRow[];
}

export interface ControlRow {
  id: string;
  name: string;
  role: string;
  plan: Plan;
  /** Why they are on that plan — the word decidePlan produced. */
  reason: string;
  /** When the running grant ends, ISO, or null (none, or open-ended). */
  grantUntil: string | null;
  grantOpenEnded: boolean;
  createdAt: string | null;
}

export interface ControlOverview {
  rows: ControlRow[];
  counts: {
    total: number;
    free: number;
    /** On Plus because a grant is running — the welcome period, a pilot, an extension. */
    granted: number;
    /** On Plus because they pay, or are in a paid grace period. */
    paying: number;
    accountants: number;
  };
}

/**
 * One pass over the accounts, in the order a person wants them: newest first, because the only
 * question anyone opens this screen with is "who arrived, and what do they have".
 */
export function buildControlOverview(accounts: readonly ControlAccount[], nowMs: number): ControlOverview {
  const rows: ControlRow[] = accounts.map((a) => {
    const standing = grantStanding(a.grants, nowMs);
    const decision = decidePlan({
      role: a.role,
      subscriptionStatus: a.subscriptionStatus,
      currentPeriodEnd: a.currentPeriodEnd,
      grantedPlusUntil: standing.grantedPlusUntil,
      grantOpenEnded: standing.grantOpenEnded,
      nowMs,
    });
    return {
      id: a.id,
      name: a.name.trim() !== "" ? a.name.trim() : "(zonder naam)",
      role: a.role === "accountant" ? "boekhouder" : (a.role ?? "zzp"),
      plan: decision.plan,
      reason: decision.reason,
      grantUntil: standing.grantedPlusUntil,
      grantOpenEnded: standing.grantOpenEnded,
      createdAt: a.createdAt,
    };
  });

  rows.sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? "") || x.id.localeCompare(y.id));

  const counts = {
    total: rows.length,
    free: rows.filter((r) => r.plan === "free").length,
    granted: rows.filter((r) => r.reason === "toekenning").length,
    paying: rows.filter((r) => r.reason === "active" || r.reason === "grace_period").length,
    accountants: rows.filter((r) => r.plan === "boekhouder").length,
  };

  return { rows, counts };
}
