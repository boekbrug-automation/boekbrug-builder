// src/lib/enablebanking-claim.test.ts
// [EB-RACE] Proof that one linked account is synced by one worker at a time.
//
// What this file can and cannot prove, said plainly:
//
//   · It CAN prove mutual exclusion, because the whole mechanism is one UNIQUE constraint and a
//     staleness rule. The fake below enforces UNIQUE (user_id, claim_key) exactly as the table
//     does, and every operation yields to the event loop, so two "workers" really do interleave
//     step by step — insert, insert, read, read, take over, take over. That is the race.
//   · It can NOT prove that PostgREST behaves like the fake. Nothing running without a database
//     can. What it proves is that GIVEN the constraint, this code hands the account to exactly
//     one caller — which is the half that can be got wrong in a rewrite.
//
// The other half of the argument lives elsewhere and is not repeated here: that the serialized
// second run inserts nothing is enablebanking-identity.test.ts ("the same transaction synced
// twice"), and that syncOneAccount actually takes and releases the claim is the [EB-RACE] gate in
// lifecycle-gates.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimAccountSync,
  ebSyncClaimKey,
  EB_SYNC_CLAIM_TTL_MS,
  EB_SYNC_MAX_SECONDS,
} from "./enablebanking-claim";

// ── A stand-in for intake_claims ───────────────────────────────────────────────────────────────

interface ClaimRow {
  id: string;
  user_id: string;
  claim_key: string;
  created_at: string;
}

type Op = "insert" | "select" | "update" | "delete";

class Query {
  private filters: Array<[string, unknown]> = [];

  constructor(
    private readonly store: FakeClaims,
    private readonly op: Op,
    private readonly payload?: Record<string, unknown>,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  select(_columns?: string): this {
    return this;
  }

  async maybeSingle(): Promise<{ data: ClaimRow | null; error: { message?: string } | null }> {
    const { data, error } = await this.run();
    return { data: data[0] ?? null, error };
  }

  // Thenable, so `await query` runs it — the shape supabase-js has.
  then<R1, R2>(
    onFulfilled?: (v: { data: ClaimRow[]; error: { code?: string; message?: string } | null }) => R1 | PromiseLike<R1>,
    onRejected?: (reason: unknown) => R2 | PromiseLike<R2>,
  ): Promise<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }

  private async run(): Promise<{ data: ClaimRow[]; error: { code?: string; message?: string } | null }> {
    // The yield that makes this a concurrency test rather than a sequence of function calls.
    await Promise.resolve();
    this.store.operations.push(this.op);
    this.store.calls.push({ op: this.op, filters: this.filters.map(([c, v]) => [c, v] as [string, unknown]) });

    if (this.store.tableMissing) {
      return { data: [], error: { code: "42P01", message: 'relation "intake_claims" does not exist' } };
    }
    // Injected infrastructure failures, one per operation — the cases where the guarantee cannot
    // be established and the financial read must therefore not happen.
    if (this.op === "insert" && this.store.insertError) return { data: [], error: this.store.insertError };
    if (this.op === "select" && this.store.selectError) return { data: [], error: this.store.selectError };
    if (this.op === "update" && this.store.updateError) return { data: [], error: this.store.updateError };

    const matches = () =>
      this.store.rows.filter((row) =>
        this.filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value),
      );

    switch (this.op) {
      case "insert": {
        const row = this.payload as unknown as Pick<ClaimRow, "user_id" | "claim_key" | "created_at">;
        const clash = this.store.rows.some(
          (r) => r.user_id === row.user_id && r.claim_key === row.claim_key,
        );
        // The whole point: a second insert of the same (user_id, claim_key) is refused by the
        // database, not by anything this code remembers.
        if (clash) return { data: [], error: { code: "23505", message: "duplicate key value" } };
        // created_at is written by the caller, not defaulted — that stamp is its ownership token.
        assert.ok(typeof row.created_at === "string" && row.created_at.length > 0,
          "the claim must write its own stamp, or it cannot prove ownership when releasing");
        const created: ClaimRow = {
          id: `claim-${this.store.nextId++}`,
          user_id: row.user_id,
          claim_key: row.claim_key,
          created_at: row.created_at,
        };
        this.store.rows.push(created);
        return { data: [created], error: null };
      }
      case "select":
        return { data: matches(), error: null };
      case "update": {
        const hit = matches();
        for (const row of hit) Object.assign(row, this.payload);
        return { data: hit, error: null };
      }
      case "delete": {
        const hit = matches();
        this.store.rows = this.store.rows.filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
    }
  }
}

class FakeClaims {
  rows: ClaimRow[] = [];
  tableMissing = false;
  operations: Op[] = [];
  calls: Array<{ op: Op; filters: Array<[string, unknown]> }> = [];
  nextId = 1;
  insertError: { code?: string; message?: string } | null = null;
  selectError: { code?: string; message?: string } | null = null;
  updateError: { code?: string; message?: string } | null = null;

  /** The eq() filters each call of this kind was issued with — how the release is inspected. */
  filtersFor(op: Op): Array<Array<[string, unknown]>> {
    return this.calls.filter((c) => c.op === op).map((c) => c.filters);
  }

  from(table: string) {
    assert.equal(table, "intake_claims", "the claim must not reach any other table");
    return {
      insert: (payload: Record<string, unknown>) => new Query(this, "insert", payload),
      select: (_columns?: string) => new Query(this, "select"),
      update: (payload: Record<string, unknown>) => new Query(this, "update", payload),
      delete: () => new Query(this, "delete"),
    };
  }
}

const USER = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-09-17T10:00:00Z");

// ── The race ──────────────────────────────────────────────────────────────────────────────────

test("[EB-RACE] two workers reaching the same account: exactly one may run", async () => {
  const store = new FakeClaims();

  const [a, b] = await Promise.all([
    claimAccountSync(USER, ACCOUNT, NOW, store),
    claimAccountSync(USER, ACCOUNT, NOW, store),
  ]);

  const winners = [a, b].filter((c) => c.claimed);
  assert.equal(
    winners.length,
    1,
    "two workers both allowed to read-dedup-insert is how one month gets counted twice",
  );
  assert.equal(store.rows.length, 1, "one account, one claim row");
});

test("[EB-RACE] the loser is told to stand down, not to fail", async () => {
  const store = new FakeClaims();
  const first = await claimAccountSync(USER, ACCOUNT, NOW, store);
  const second = await claimAccountSync(USER, ACCOUNT, NOW, store);

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  // Nothing to release: a caller that never held the claim must not be able to free the holder's.
  await second.release();
  assert.equal(store.rows.length, 1, "standing down may not clear the running worker's claim");
});

test("[EB-RACE] the account is free again the moment the holder releases", async () => {
  const store = new FakeClaims();
  const first = await claimAccountSync(USER, ACCOUNT, NOW, store);
  await first.release();
  assert.equal(store.rows.length, 0, "release removes the claim");

  const next = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(next.claimed, true, "the next sync must not wait out the TTL of a finished one");
});

test("[EB-RACE] releasing twice is harmless", async () => {
  const store = new FakeClaims();
  const held = await claimAccountSync(USER, ACCOUNT, NOW, store);
  await held.release();
  const other = await claimAccountSync(USER, ACCOUNT, NOW, store);
  await held.release(); // the finally of a worker that already released
  assert.equal(other.claimed, true);
  assert.equal(store.rows.length, 1, "a second release must not delete somebody else's claim");
});

test("[EB-RACE] a claim inside its TTL is honoured", async () => {
  const store = new FakeClaims();
  store.rows.push({
    id: "claim-existing",
    user_id: USER,
    claim_key: ebSyncClaimKey(ACCOUNT),
    created_at: new Date(NOW.getTime() - (EB_SYNC_CLAIM_TTL_MS - 1000)).toISOString(),
  });

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(result.claimed, false, "a worker that is still running must not be joined");
});

test("[EB-RACE] a claim past its TTL is taken over, so a crash cannot wedge an account", async () => {
  const store = new FakeClaims();
  const stale = new Date(NOW.getTime() - (EB_SYNC_CLAIM_TTL_MS + 60_000)).toISOString();
  store.rows.push({
    id: "claim-dead",
    user_id: USER,
    claim_key: ebSyncClaimKey(ACCOUNT),
    created_at: stale,
  });

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(result.claimed, true, "a dead worker's claim may not stop the feed forever");
  assert.equal(store.rows[0].created_at, NOW.toISOString(), "the takeover refreshes the stamp");
});

test("[EB-RACE] two workers finding the SAME dead claim: still only one takes it over", async () => {
  const store = new FakeClaims();
  store.rows.push({
    id: "claim-dead",
    user_id: USER,
    claim_key: ebSyncClaimKey(ACCOUNT),
    created_at: new Date(NOW.getTime() - (EB_SYNC_CLAIM_TTL_MS + 60_000)).toISOString(),
  });

  const [a, b] = await Promise.all([
    claimAccountSync(USER, ACCOUNT, NOW, store),
    claimAccountSync(USER, ACCOUNT, NOW, store),
  ]);

  assert.equal(
    [a, b].filter((c) => c.claimed).length,
    1,
    "both workers see the same stale row; a blind takeover would hand one lock to two holders",
  );
});

test("[EB-RACE] the claim is per account, never per owner", async () => {
  const store = new FakeClaims();
  const other = "33333333-3333-3333-3333-333333333333";

  const [a, b] = await Promise.all([
    claimAccountSync(USER, ACCOUNT, NOW, store),
    claimAccountSync(USER, other, NOW, store),
  ]);

  assert.equal(a.claimed, true);
  assert.equal(b.claimed, true, "one owner's two bank accounts must sync in the same run");
  assert.notEqual(ebSyncClaimKey(ACCOUNT), ebSyncClaimKey(other));
  assert.match(ebSyncClaimKey(ACCOUNT), /^ebsync:/, "namespaced — intake_claims holds other keys");
});

// ── Failure direction ─────────────────────────────────────────────────────────────────────────

test("[EB-RACE] a missing intake_claims table refuses the sync — it does not proceed unprotected", async () => {
  const store = new FakeClaims();
  store.tableMissing = true;

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(
    result.claimed,
    false,
    "without the table a second worker cannot be kept out, so the financial read must not happen",
  );
  assert.equal(result.outcome, "unavailable", "and it is our infrastructure, not a busy account");
  await result.release(); // must not throw, and must touch nothing
});

test("[EB-RACE] a claim store that throws refuses the sync too", async () => {
  const exploding = {
    from() {
      throw new Error("connection reset");
    },
  };
  const result = await claimAccountSync(USER, ACCOUNT, NOW, exploding);
  assert.equal(result.claimed, false, "an unexplained failure may not become permission to write money");
  assert.equal(result.outcome, "unavailable");
});

test("[EB-RACE] an unexpected insert error refuses the sync", async () => {
  const store = new FakeClaims();
  store.insertError = { code: "42501", message: "permission denied for table intake_claims" };

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(result.claimed, false);
  assert.equal(result.outcome, "unavailable");
});

test("[EB-RACE] a holder we cannot read refuses the sync", async () => {
  const store = new FakeClaims();
  await claimAccountSync(USER, ACCOUNT, NOW, store); // somebody holds it
  store.selectError = { message: "statement timeout" };

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(result.claimed, false);
  assert.equal(
    result.outcome,
    "unavailable",
    "not knowing whether the holder is alive is not the same as knowing it is",
  );
});

test("[EB-RACE] a failed stale takeover refuses the sync", async () => {
  const store = new FakeClaims();
  store.rows.push({
    id: "claim-dead",
    user_id: USER,
    claim_key: ebSyncClaimKey(ACCOUNT),
    created_at: new Date(NOW.getTime() - (EB_SYNC_CLAIM_TTL_MS + 60_000)).toISOString(),
  });
  store.updateError = { message: "deadlock detected" };

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(
    result.claimed,
    false,
    "a takeover we could not complete is not a takeover, whatever the row now says",
  );
  assert.equal(result.outcome, "unavailable");
});

test("[EB-RACE] an unreadable stamp on the holding claim refuses the sync", async () => {
  const store = new FakeClaims();
  store.rows.push({
    id: "claim-corrupt",
    user_id: USER,
    claim_key: ebSyncClaimKey(ACCOUNT),
    created_at: "not a timestamp",
  });

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(result.claimed, false, "stale-or-fresh may not be guessed from a corrupt value");
  assert.equal(result.outcome, "unavailable");
});

// ── Ownership: release may only ever delete OUR version ───────────────────────────────────────

test("[EB-RACE] a late release must not delete the successor's claim", async () => {
  // A owns version 1 → version 1 goes stale → B takes over and owns version 2 → A releases late.
  // A delete keyed on (user_id, claim_key) alone would remove B's LIVE claim here, and a third
  // worker would then walk straight in beside B. The stamp is the version, so A's delete matches
  // nothing.
  const store = new FakeClaims();

  const a = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(a.claimed, true);
  const versionOne = store.rows[0].created_at;

  const later = new Date(NOW.getTime() + EB_SYNC_CLAIM_TTL_MS + 60_000);
  const b = await claimAccountSync(USER, ACCOUNT, later, store);
  assert.equal(b.claimed, true, "a dead worker's claim must be takeable");
  const versionTwo = store.rows[0].created_at;
  assert.notEqual(versionTwo, versionOne, "the takeover must produce a new version");

  await a.release();

  assert.equal(store.rows.length, 1, "A released a version it no longer owned and took B's claim");
  assert.equal(store.rows[0].created_at, versionTwo, "B must still hold version 2");

  // And the rightful owner can still give it back.
  await b.release();
  assert.equal(store.rows.length, 0, "B's own release must work");
});

test("[EB-RACE] the release deletes on the stamp, not on the account alone", async () => {
  const store = new FakeClaims();
  const held = await claimAccountSync(USER, ACCOUNT, NOW, store);
  await held.release();
  const deletes = store.filtersFor("delete");
  assert.ok(deletes.length > 0, "release issued no delete at all");
  assert.ok(
    deletes[0].some(([column]) => column === "created_at"),
    "the delete does not name the version it acquired, so it can remove a successor's claim",
  );
});

// ── The number that must stay derived ─────────────────────────────────────────────────────────

test("[EB-RACE] the claim outlives the longest sync a route can run", async () => {
  assert.ok(
    EB_SYNC_CLAIM_TTL_MS > EB_SYNC_MAX_SECONDS * 1000,
    "a claim that expires before its worker does invites a second worker to join it mid-run",
  );

  // EB_SYNC_MAX_SECONDS claims to cover both doors. Read them rather than trust the comment: a
  // maxDuration raised on either route without this constant moving is exactly the change that
  // re-opens the window, and it would raise no other alarm.
  const { readFileSync } = await import("node:fs");
  const durations = [
    "src/app/api/bank/enablebanking/sync/route.ts",
    "src/app/api/cron/bank-sync/route.ts",
  ].map((path) => {
    const source = readFileSync(path, "utf8");
    const match = source.match(/export const maxDuration = (\d+)/);
    assert.ok(match, `${path} must declare a maxDuration the claim can be measured against`);
    return Number(match![1]);
  });

  assert.ok(
    EB_SYNC_MAX_SECONDS >= Math.max(...durations),
    `EB_SYNC_MAX_SECONDS (${EB_SYNC_MAX_SECONDS}) must cover the slowest sync door (${Math.max(...durations)})`,
  );
});

test("[EB-RACE] the claim expires long before the intake door sweeps the table it shares", async () => {
  // intake_claims is shared. /api/intake deletes that owner's claims past a horizon as hygiene and
  // does NOT look at the key, so an owner photographing a receipt would clear a running sync's
  // claim if this TTL ever grew past it. Read the horizon rather than repeat it.
  const { readFileSync } = await import("node:fs");
  const intake = readFileSync("src/app/api/intake/route.ts", "utf8");
  const sweep = intake.match(/Date\.now\(\) - ([\d_]+)\)\.toISOString\(\)/);
  assert.ok(sweep, "the intake claim sweep was rewritten — this relationship can no longer be read");
  const horizonMs = Number(sweep![1].replace(/_/g, ""));

  assert.ok(
    EB_SYNC_CLAIM_TTL_MS * 2 < horizonMs,
    `the sync claim (${EB_SYNC_CLAIM_TTL_MS}ms) must stay well inside the intake sweep (${horizonMs}ms)`,
  );
});
