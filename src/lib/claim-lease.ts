// src/lib/claim-lease.ts
// [CLAIM-LEASE] One worker at a time, for anything that can be named by a key.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────────────────────
//
// The mutual-exclusion primitive that [EB-RACE] proved, lifted out of Enable Banking so a second
// caller can use it without re-deriving it. It is one UNIQUE constraint on intake_claims
// (user_id, claim_key), an explicit created_at that doubles as an ownership token, and a
// compare-and-set takeover for the claim of a worker that died.
//
// Nothing about it is generic in the loose sense: every rule below is a decision about money that
// was made once, argued in src/lib/enablebanking-claim.ts, and must not be re-made per caller.
//
// ── THE FAILURE DIRECTION: CLOSED ────────────────────────────────────────────────────────────
//
// If we cannot ESTABLISH that we are alone, we do not say we are. Missing table, insert error,
// unreadable holder, unparseable stamp, failed takeover, throw — all of them refuse, loudly.
//
// The reasoning is the [EB-RACE] one and it transfers intact: a delayed run is recoverable, a
// doubled financial effect is not. A caller that would rather proceed than wait must NOT use this
// module — it must decide that in its own file, in the open, with its own reason written down.
//
// ── THE ONE SHARED CONDITION: THE SWEEP ──────────────────────────────────────────────────────
//
// /api/intake sweeps its own owner's claims older than an hour as hygiene, and that sweep does not
// read the key (src/lib/intake-processor.ts, the delete on user_id + created_at). So every TTL
// handed to this function must sit well inside that hour, or one owner photographing a receipt can
// delete another of that owner's live claims. That is not left to each caller to remember:
// ttlMs is checked here, and a TTL that reaches the sweep refuses rather than races.
//
// ── WHY enablebanking-claim.ts STILL HAS ITS OWN COPY ────────────────────────────────────────
//
// It should call this. It does not yet, deliberately: Enable Banking is frozen at the owner's
// instruction while a production credential is settled, and rewriting the inside of the module
// that guards its financial sync is not a change to make during a freeze. The duplication is
// therefore named rather than hidden, and [CLAIM-LEASE] in lifecycle-gates.test.ts asserts the two
// copies still refuse on the same six conditions — so a rule improved here cannot silently stop
// being true there. Retrofit is a slice of its own, after the freeze lifts.

import { createPipelineClient } from "@/lib/supabase-pipeline";

/**
 * How old a claim may get before /api/intake's key-blind hygiene sweep deletes it.
 *
 * Read off the sweep, not guessed: intake-processor.ts deletes this owner's claims older than
 * 3_600_000 ms. A TTL at or above it would let that sweep remove a LIVE claim, which hands one
 * lock to two holders — the failure this whole file exists to prevent. claim-lease.test.ts reads
 * the number out of the processor rather than trusting this sentence.
 */
export const CLAIM_SWEEP_MS = 3_600_000;

/**
 * Why this worker may or may not run, as a value rather than a boolean.
 *
 *   · held        — we hold the claim and are the only worker on this key. (The owner's word for
 *                   this outcome is "acquired"; one vocabulary is kept across both callers of the
 *                   table, and this is the one already in production.)
 *   · busy        — somebody else holds it, and is alive. Nothing is wrong; come back later.
 *   · unavailable — we could not establish the guarantee AT ALL. Something is wrong with our own
 *                   infrastructure, and the protected work must not happen.
 *
 * Two refusals, kept apart on purpose: "another worker has it" is the mechanism WORKING, and "the
 * mechanism is broken" is not. Collapsing them into one boolean is how a broken claim table would
 * look, in every log, exactly like a healthy busy key.
 */
export type ClaimOutcome = "held" | "busy" | "unavailable";

export interface ClaimLease {
  /** May this worker run the protected section? True only for outcome "held". */
  claimed: boolean;
  outcome: ClaimOutcome;
  /** Give the claim back. Safe to call twice; never throws; only ever deletes OUR version. */
  release: () => Promise<void>;
}

export interface ClaimLeaseRequest {
  userId: string;
  /** Namespaced, always. intake_claims holds the intake door's keys and every other caller's. */
  claimKey: string;
  /** Longer than the longest run the protected section can have, and well under CLAIM_SWEEP_MS. */
  ttlMs: number;
  /** The marker a reader greps for when a refusal shows up in the logs, e.g. "[ONTVANGEN-CLAIM]". */
  tag: string;
  /** What to name in a refusal log. Ids only — never a file name, never anything an owner typed. */
  subject: Record<string, string>;
  now?: Date;
  // A seam, exactly like EnableBankingClientOptions.fetchImpl: mutual exclusion is the one thing
  // here that cannot be read off the source, so the test drives a store that enforces the same
  // UNIQUE (user_id, claim_key) the table does. Production never passes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimStore?: { from: (table: string) => any };
}

/** A refusal carries nothing to release — calling it must never touch another worker's row. */
function refused(outcome: "busy" | "unavailable"): ClaimLease {
  return { claimed: false, outcome, release: async () => {} };
}

/**
 * Take the claim for one key, or refuse.
 *
 * On success the lease carries a release that proves ownership: a delete on (user_id, claim_key)
 * alone identifies the LOCK, not this worker's hold on it. If our claim went stale and a successor
 * took it over by refreshing created_at, a late release would then delete the SUCCESSOR's live
 * claim and let a third worker in beside it. The stamp we wrote is the version token, and exactly
 * one row can carry it.
 *
 * This is why the stamp is written EXPLICITLY at insert rather than left to the column default: a
 * default-stamped row would have to be read back before we knew our own token, and a failed
 * read-back would leave a claim we could not release.
 */
export async function acquireClaimLease(req: ClaimLeaseRequest): Promise<ClaimLease> {
  const { userId, claimKey, ttlMs, tag, subject } = req;
  const now = req.now ?? new Date();

  if (!(ttlMs > 0) || ttlMs >= CLAIM_SWEEP_MS) {
    // A programming error, and the only safe reading of it is that the guarantee is not
    // established: a TTL the sweep can reach makes "held" a claim somebody else may delete.
    console.error(`${tag} claim TTL is outside the safe window — refusing`, {
      ...subject,
      ttlMs,
      sweepMs: CLAIM_SWEEP_MS,
    });
    return refused("unavailable");
  }

  // intake_claims is not in the generated types (applied by hand) — same relaxed client as the
  // intake route uses on the same table, for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claims = req.claimStore ?? (createPipelineClient() as any);

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
          .eq("claim_key", claimKey)
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
      .insert({ user_id: userId, claim_key: claimKey, created_at: stamp });
    if (!error) return { claimed: true, outcome: "held", release: releaseFor(stamp) };

    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      console.error(`${tag} intake_claims is absent — refusing, because without it a second worker cannot be kept out`, subject);
      return refused("unavailable");
    }
    if (code !== "23505") {
      console.error(`${tag} claim insert failed — refusing`, {
        ...subject,
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
      .eq("claim_key", claimKey)
      .maybeSingle();

    if (holderError) {
      console.error(`${tag} could not read the holding claim — refusing`, {
        ...subject,
        message: (holderError as { message?: string }).message,
      });
      return refused("unavailable");
    }
    // 23505 with no visible holder: it was released between our insert and our read. Nothing is
    // broken and nothing is owed — the next attempt takes it.
    if (!holder) return refused("busy");

    const ageMs = holder.created_at ? now.getTime() - Date.parse(holder.created_at) : NaN;
    if (!Number.isFinite(ageMs)) {
      // An unparseable stamp cannot be judged stale or fresh, and guessing either way is a
      // decision about money made on a corrupt value.
      console.error(`${tag} the holding claim carries an unreadable created_at — refusing`, subject);
      return refused("unavailable");
    }
    if (ageMs < ttlMs) return refused("busy");

    // Stale: the worker that made it is long dead. Take it over by refreshing the stamp, so a
    // crash can never wedge one key permanently.
    //
    // As a compare-and-set on the stamp we just read, never a blind update. Two workers arriving at
    // the same dead claim would BOTH see "stale" and both take over — one lock handed to two
    // holders is not a lock. Only one UPDATE can match a given created_at, so the loser stays out.
    const { data: taken, error: takeoverError } = await claims
      .from("intake_claims")
      .update({ created_at: stamp })
      .eq("id", holder.id)
      .eq("created_at", holder.created_at)
      .select("id");

    if (takeoverError) {
      console.error(`${tag} stale-claim takeover failed — refusing`, {
        ...subject,
        message: (takeoverError as { message?: string }).message,
      });
      return refused("unavailable");
    }
    // No rows matched: another worker took the same dead claim a moment earlier. It is alive now.
    if (!Array.isArray(taken) || taken.length === 0) return refused("busy");

    return { claimed: true, outcome: "held", release: releaseFor(stamp) };
  } catch (err) {
    console.error(`${tag} claim path threw — refusing`, {
      ...subject,
      message: err instanceof Error ? err.message : String(err),
    });
    return refused("unavailable");
  }
}
