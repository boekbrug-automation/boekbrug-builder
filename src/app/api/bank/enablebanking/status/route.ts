// src/app/api/bank/enablebanking/status/route.ts
// [ENABLEBANKING] What the bank card on /dashboard/bank reads.
//
// GET /api/bank/enablebanking/status
//   → { configured, connections: [{ …, daysUntilExpiry, canSyncNow }] }
//
// The two derived numbers are computed HERE rather than in the browser, so "your consent
// expires in 6 days" and "you can refresh again" mean the same thing on every screen and in
// every timezone — the server's clock is the one the sync itself runs on.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isEnableBankingConfigured, canUseEnableBanking } from "@/lib/enablebanking-client";
import { listBankConnections } from "@/lib/enablebanking-connection";
import { isAccountDue } from "@/lib/enablebanking-sync";

export const dynamic = "force-dynamic";

/**
 * Whole days from today until `moment`; null when there is none, negative when it has passed.
 *
 * Enable Banking hands back an absolute ISO timestamp (access.valid_until), not a day count, so
 * this accepts either that or a bare YYYY-MM-DD. Both are reduced to the DAY before subtracting:
 * comparing a timestamp against "now" would make a consent that dies at 09:00 read as "0 days"
 * from 09:01 the day before, and the owner would be warned a day late — the one day where the
 * warning still buys him something.
 */
export function daysUntil(moment: string | null, now = new Date()): number | null {
  if (!moment) return null;
  const parsed = Date.parse(moment.length <= 10 ? `${moment}T00:00:00Z` : moment);
  if (!Number.isFinite(parsed)) return null;
  const targetDay = Date.parse(`${new Date(parsed).toISOString().slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((targetDay - today) / 86_400_000);
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [EB-TESTER] The panel renders on this answer alone, so the gate belongs here too — otherwise
  // "Koppel je bank" appears for everyone and only fails one click later, on a screen the owner
  // did not ask to see.
  const configured = isEnableBankingConfigured() && canUseEnableBanking(user.id);
  if (!configured) {
    // An unconfigured server hides the card entirely rather than showing a dead button.
    return NextResponse.json({ configured: false, connections: [] });
  }

  const now = new Date();
  const connections = (await listBankConnections(user.id)).map((c) => ({
    id: c.id,
    institutionName: c.institutionName ?? c.aspspName,
    institutionBic: c.institutionBic,
    status: c.status,
    connectedAt: c.connectedAt,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError,
    accessValidUntil: c.accessValidUntil,
    daysUntilExpiry: daysUntil(c.accessValidUntil, now),
    // "Refresh" is only offered when at least one account is actually allowed to be read. The
    // bank's daily budget is small, and a button that spends it on a no-op is worse than a
    // button that is honestly disabled.
    canSyncNow: c.accounts.some((a) => isAccountDue(a.lastSyncedAt, now)),
    accounts: c.accounts.map((a) => ({
      id: a.id,
      iban: a.iban,
      ownerName: a.ownerName,
      currency: a.currency,
      status: a.status,
      lastSyncedAt: a.lastSyncedAt,
      lastSyncedThrough: a.lastSyncedThrough,
      lastError: a.lastError,
    })),
  }));

  return NextResponse.json({ configured: true, connections });
}
