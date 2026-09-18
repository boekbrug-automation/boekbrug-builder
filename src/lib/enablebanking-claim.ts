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
// ── THE FAILURE DIRECTION: CLOSED, NOT OPEN ──────────────────────────────────────────────────
//
// An earlier version of this file failed OPEN: a missing table, an unreadable error or a throw
// returned "you may run", on the argument that a broken backstop must not stop every owner's bank
// feed. That argument is wrong HERE, and the reason is worth keeping written down, because it is
// the tempting one.
//
// Failing open means the one mechanism introduced to prevent silent financial multiplication can
// vanish while the financial write proceeds anyway — exactly when we have the least information
// about what else is wrong. The two outcomes are not comparable:
//
//   · fail closed → this account is not read this run. The next run reads it, the 7-day
//     SYNC_OVERLAP_DAYS window means nothing is lost, and the owner sees a calm line saying we
//     will try again. A delay.
//   · fail open   → the same money may be imported twice, into omzet, kosten, the btw-aangifte
//     and the quarter package an accountant signs. Silent, and expensive to find afterwards.
//
// A delayed bank sync is recoverable. A doubled quarter is a wrong tax return.
//
// So: if we cannot ESTABLISH the serialization guarantee, we do not perform the financial sync.
// Missing table, insert error, unreadable holder, failed takeover, throw — all of them refuse.
// Every one of them is logged loudly, because a refusal nobody can see is its own silent stop.
//
// That makes the deployment rule explicit rather than implied: intake_claims and its UNIQUE index
// must be proven live BEFORE Enable Banking credentials are enabled. There is no "deploy-safe
// financial degradation" to arrange — we control that order, and docs/BANK_LINK.md states it as a
// precondition of turning the door on.
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
// and a documented takeover for a claim whose maker died. Its own header calls it "a tiny claims
// table ... short-lived working state, not bookkeeping" — which is exactly what this is. The key
// namespaces it: "ebsync:<account row id>".
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
//
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

/**
 * Why this worker may or may not run, as a value rather than a boolean.
 *
 *   · held        — we hold the claim and are the only worker on this account.
 *   · busy        — somebody else holds it, and is alive. Nothing is wrong; come back next run.
 *   · unavailable — we could not establish the guarantee AT ALL. Something is wrong with our own
 *                   infrastructure, and the financial read must not happen.
 *
 * Two refusals, kept apart on purpose: "another worker has it" is the mechanism WORKING, and
 * "the mechanism is broken" is not. Collapsing them into one boolean is how a broken claim table
 * would look, on every screen and in every log, exactly like a healthy busy account.
 */
export type ClaimOutcome = "held" | "busy" | "unavailable";

export interface SyncClaim {
  /** May this worker run the critical section? True only for outcome "held". */
  claimed: boolean;
  outcome: ClaimOutcome;
  /** Give the claim back. Safe to call twice; never throws; only ever deletes OUR version. */
  release: () => Promise<void>;
}

/** A refusal carries nothing to release — calling it must never touch another worker's row. */
function refused(outcome: "busy" | "unavailable"): SyncClaim {
  return { claimed: false, outcome, release: async () => {} };
}

/**
 * Take the account's sync claim, or refuse.
 *
 * On success the claim carries a release that proves ownership: see releaseFor() below for why a
 * delete on (user_id, claim_key) alone is not safe.
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

  /**
   * Release OUR version of the claim, never whatever is standing there now.
   *
   * The stamp is the version token. A delete on (user_id, claim_key) alone identifies the ACCOUNT
   * LOCK, not this worker's hold on it: if our claim went stale and a successor took it over by
   * refreshing created_at, our late release would then delete the SUCCESSOR's live claim and let
   * a third worker in beside it. The TTL makes that unlikely today, but a timing assumption is
   * not a correctness boundary when the failure is double-booked money — so ownership is proved,
   * not assumed. Exactly one row can carry the stamp we wrote.
   *
   * This is why the stamp is written EXPLICITLY at insert rather than left to the column default:
   * a default-stamped row would have to be read back before we knew our own token, and a failed
   * read-back would leave a claim we could not release.
   */
  const releaseFor = (stamp: string) => {
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await claims
          .from("intake_claims")
          .delete()
          .eq("user_id", userId)
          .eq("claim_key", key)
          .eq("created_at", stamp);
      } catch {
        // The claim expires on its own; a failed release costs one stale window, never correctness.
      }
    };
  };

  const stamp = now.toISOString();

  try {
    const { error } = await claims
      .from("intake_claims")
      .insert({ user_id: userId, claim_key: key, created_at: stamp });
    if (!error) return { claimed: true, outcome: "held", release: releaseFor(stamp) };

    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      // The table is not there. Refuse: the guarantee cannot be established, so the financial
      // read does not happen. The deployment rule above exists so this is never a surprise.
      console.error(
        "[EB-RACE] intake_claims is absent — refusing to sync, because without it a second worker cannot be kept out",
        { accountRowId },
      );
      return refused("unavailable");
    }
    if (code !== "23505") {
      console.error("[EB-RACE] claim insert failed — refusing to sync", {
        accountRowId,
        code: code ?? "UNKNOWN",
        message: (error as { message?: string }).message,
      });
      return refused("unavailable");
    }

    // Somebody holds it. Honour that only while the claim is ALIVE.
    const { data: holder, error: holderError } = await claims
      .from("intake_claims")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("claim_key", key)
      .maybeSingle();

    if (holderError) {
      console.error("[EB-RACE] could not read the holding claim — refusing to sync", {
        accountRowId,
        message: (holderError as { message?: string }).message,
      });
      return refused("unavailable");
    }
    // 23505 with no visible holder: it was released between our insert and our read. Nothing is
    // broken and nothing is owed — the next run takes it.
    if (!holder) return refused("busy");

    const ageMs = holder.created_at ? now.getTime() - Date.parse(holder.created_at) : NaN;
    if (!Number.isFinite(ageMs)) {
      // An unparseable stamp cannot be judged stale or fresh, and guessing either way is a
      // decision about money made on a corrupt value.
      console.error("[EB-RACE] the holding claim carries an unreadable created_at — refusing to sync", {
        accountRowId,
      });
      return refused("unavailable");
    }
    if (ageMs < EB_SYNC_CLAIM_TTL_MS) return refused("busy");

    // Stale: the worker that made it is long dead. Take it over by refreshing the stamp, so a
    // crash can never wedge one account's feed permanently.
    //
    // As a compare-and-set on the stamp we just read, never a blind update. Two workers arriving
    // at the same dead claim would BOTH see "stale" and both take over — one lock handed to two
    // holders is not a lock, and it fails in exactly the shape this file exists to prevent. Only
    // one UPDATE can match a given created_at, so the loser is told to stay out.
    const { data: taken, error: takeoverError } = await claims
      .from("intake_claims")
      .update({ created_at: stamp })
      .eq("id", holder.id)
      .eq("created_at", holder.created_at)
      .select("id");

    if (takeoverError) {
      console.error("[EB-RACE] stale-claim takeover failed — refusing to sync", {
        accountRowId,
        message: (takeoverError as { message?: string }).message,
      });
      return refused("unavailable");
    }
    // No rows matched: another worker took the same dead claim a moment earlier. It is alive now.
    if (!Array.isArray(taken) || taken.length === 0) return refused("busy");

    return { claimed: true, outcome: "held", release: releaseFor(stamp) };
  } catch (err) {
    console.error("[EB-RACE] claim path threw — refusing to sync", {
      accountRowId,
      message: err instanceof Error ? err.message : String(err),
    });
    return refused("unavailable");
  }
}
