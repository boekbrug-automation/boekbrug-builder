// src/lib/enablebanking-claim.ts
// [EB-RACE] One worker at a time per linked Enable Banking account.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────────────────────
//
// For ONE linked account, the sequence
//
//     read existing rows → dedup in application memory → insert
//
// must be executed by at most one worker at a time. Two workers that both read "not present" both
// insert, and the owner's month is counted twice.
//
// ── WHY THIS IS NEW ──────────────────────────────────────────────────────────────────────────
//
// It was not new; it was hidden. Until [EB-IDENTITEIT] the Enable Banking rows carried
// external_id = entry_reference, so UNIQUE (user_id, source, external_id) caught a racing second
// insert at the database. That backstop was removed on purpose — the same id was deleting real
// second transactions, which is the worse failure — and PostgreSQL does not constrain NULLs, so
// the feed's rows are now unconstrained by that index.
//
// Fixing silent loss must not create silent multiplication. Hence this file.
//
// ── WHY NOT THE OBVIOUS PLACES ───────────────────────────────────────────────────────────────
//
// · bank_connection_accounts.last_synced_at. It already exists and the sync already writes it, so
//   a compare-and-set on it looks free. It is not: that column answers "when did a sync last
//   SUCCEED" and drives the 20-hour bank-budget guard (SYNC_MIN_INTERVAL_HOURS). Claiming by
//   setting it at the START makes a crashed sync indistinguishable from a successful one and
//   blocks the owner's own "Ververs" for twenty hours after OUR failure. One column cannot hold
//   two facts without one of them lying.
//
// · A Postgres advisory lock. The critical section contains an HTTP round trip to the bank, so a
//   transaction-scoped lock cannot span it, and a session-scoped one needs a pinned connection
//   that PostgREST does not give.
//
// · An in-memory mutex. Vercel runs concurrent instances; a lock inside one of them protects
//   nothing.
//
// · A new table or column. Would work, and would be a second staleness rule to keep correct.
//
// ── WHAT THIS USES INSTEAD ───────────────────────────────────────────────────────────────────
//
// intake_claims, which already exists in production: (user_id, claim_key) UNIQUE, a created_at,
// a documented takeover for a claim whose maker died, and a DEPLOY-SAFE degrade when the table is
// absent. Its own header calls it "a tiny claims table ... short-lived working state, not
// bookkeeping" — which is exactly what this is. The key namespaces it: "ebsync:<account row id>".
//
// The claim is ephemeral by construction: no state is written on the account row, so nothing can
// strand an account in a "busy" that outlives the worker that set it.
//
// Sharing that table has one condition, and it is measured rather than assumed: /api/intake sweeps
// ITS OWN owner's claims older than an hour as hygiene, and that sweep does not read the key. So
// any TTL here must stay well under that hour, or an owner's photographed receipt could delete a
// running sync's claim. Seven minutes is, and enablebanking-claim.test.ts reads the sweep out of
// the intake route rather than trusting this sentence. The intake door's own two-minute staleness
// rule is its key's, not this one's — the keys are namespaced and the TTLs are not shared.

// ── WHAT THIS DOES NOT COVER ─────────────────────────────────────────────────────────────────
//
// One door against itself. NOT an MT940/CAMT upload running at the same moment as a feed sync:
// the upload takes no claim, the key is one Enable Banking account, and the two doors write
// different `source` values so the unique index cannot collide across them either. Recorded for
// [FINANCIAL-TRUTH-AUDIT] in docs/BANK_LINK.md, with why a per-owner claim and a fingerprint
// constraint are both the wrong answer. Do not read this file as if it closed that.

import { createPipelineClient } from "@/lib/supabase-pipeline";

/**
 * The longest a single sync invocation can live.
 *
 * /api/bank/enablebanking/sync sets maxDuration 120; /api/cron/bank-sync sets 300. The claim must
 * outlive the LONGER of them, or a slow-but-alive cron gets its account taken over by the next
 * caller and the two run together — the very thing this file prevents. Derived, never typed
 * twice: enablebanking-claim.test.ts fails if the TTL stops exceeding this.
 */
export const EB_SYNC_MAX_SECONDS = 300;

/** The claim's life. The margin is for a worker killed AT its ceiling: its claim must still be
 *  standing when it dies, so nobody joins it in its last second. */
export const EB_SYNC_CLAIM_TTL_MS = (EB_SYNC_MAX_SECONDS + 120) * 1000;

/** The one key shape. A namespace, because intake_claims also holds the intake door's own keys. */
export function ebSyncClaimKey(accountRowId: string): string {
  return `ebsync:${accountRowId}`;
}

export interface SyncClaim {
  /** May this worker run the critical section? */
  claimed: boolean;
  /** Give the claim back. Safe to call twice; never throws. */
  release: () => Promise<void>;
}

/** A claim nobody has to release — the shape returned when we are not holding anything. */
const NOT_HELD: SyncClaim = { claimed: false, release: async () => {} };

/**
 * Take the account's sync claim, or report that someone else holds it.
 *
 * Failure direction, deliberately: anything we cannot understand (a missing table, an unreadable
 * error) returns claimed:true. A backstop that refuses to sync when IT is broken would stop the
 * bank feed of every owner over its own hiccup, and a silent stop is the failure this whole
 * subsystem is built to avoid. The window it leaves open is the one that existed before this file.
 */
export async function claimAccountSync(
  userId: string,
  accountRowId: string,
  now: Date = new Date(),
  // A seam, exactly like EnableBankingClientOptions.fetchImpl: mutual exclusion is the one thing
  // here that cannot be read off the source, so the test drives a store that enforces the same
  // UNIQUE (user_id, claim_key) the table does. Production never passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimStore?: { from: (table: string) => any },
): Promise<SyncClaim> {
  const key = ebSyncClaimKey(accountRowId);
  // intake_claims is not in the generated types (applied by hand) — same relaxed client as the
  // intake route uses on the same table, for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claims = claimStore ?? (createPipelineClient() as any);

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await claims.from("intake_claims").delete().eq("user_id", userId).eq("claim_key", key);
    } catch {
      // The claim expires on its own; a failed release costs one stale window, never correctness.
    }
  };

  try {
    const { error } = await claims.from("intake_claims").insert({ user_id: userId, claim_key: key });
    if (!error) return { claimed: true, release };

    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      // [DEPLOY-SAFE] intake_claims.sql not applied here. Proceed exactly as before this guard
      // existed rather than stopping the feed over a missing backstop.
      console.error("[EB-RACE] intake_claims is absent — syncing without the concurrency backstop");
      return { claimed: true, release: async () => {} };
    }
    if (code !== "23505") {
      console.error("[EB-RACE] claim insert failed — proceeding without the backstop", {
        accountRowId,
        message: (error as { message?: string }).message,
      });
      return { claimed: true, release: async () => {} };
    }

    // Someone holds it. Honour that only while the claim is ALIVE.
    const { data: holder } = await claims
      .from("intake_claims")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("claim_key", key)
      .maybeSingle();

    const ageMs = holder?.created_at ? now.getTime() - Date.parse(holder.created_at) : Infinity;
    if (holder && Number.isFinite(ageMs) && ageMs < EB_SYNC_CLAIM_TTL_MS) {
      return NOT_HELD;
    }
    if (holder) {
      // Stale: the worker that made it is long dead. Take it over by refreshing the stamp, so a
      // crash can never wedge one account's feed permanently.
      //
      // As a compare-and-set on the stamp we just read, never a blind update. Two workers arriving
      // at the same dead claim would BOTH see "stale" and both take over — one lock handed to two
      // holders is not a lock, and it fails in exactly the shape this file exists to prevent. Only
      // one UPDATE can match a given created_at, so the loser is told to stay out.
      const { data: taken, error: takeoverError } = await claims
        .from("intake_claims")
        .update({ created_at: now.toISOString() })
        .eq("id", holder.id)
        .eq("created_at", holder.created_at)
        .select("id");
      if (takeoverError) {
        // Not a lost race — the takeover itself is broken. Refusing here would leave this account
        // permanently unsynced behind a claim nobody can clear, which is the silent stop; fail in
        // the same direction as every other unexplained error in this file.
        console.error("[EB-RACE] stale-claim takeover failed — proceeding without the backstop", {
          accountRowId,
          message: (takeoverError as { message?: string }).message,
        });
        return { claimed: true, release: async () => {} };
      }
      if (!Array.isArray(taken) || taken.length === 0) return NOT_HELD;
      return { claimed: true, release };
    }
    // 23505 with no visible holder: it was released between our insert and our read. Next run.
    return NOT_HELD;
  } catch (err) {
    console.error("[EB-RACE] claim path threw — proceeding without the backstop", {
      accountRowId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { claimed: true, release: async () => {} };
  }
}
