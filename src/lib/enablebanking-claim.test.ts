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

  async maybeSingle(): Promise<{ data: ClaimRow | null; error: null }> {
    const { data } = await this.run();
    return { data: data[0] ?? null, error: null };
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

    if (this.store.tableMissing) {
      return { data: [], error: { code: "42P01", message: 'relation "intake_claims" does not exist' } };
    }

    const matches = () =>
      this.store.rows.filter((row) =>
        this.filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value),
      );

    switch (this.op) {
      case "insert": {
        const row = this.payload as unknown as Pick<ClaimRow, "user_id" | "claim_key">;
        const clash = this.store.rows.some(
          (r) => r.user_id === row.user_id && r.claim_key === row.claim_key,
        );
        // The whole point: a second insert of the same (user_id, claim_key) is refused by the
        // database, not by anything this code remembers.
        if (clash) return { data: [], error: { code: "23505", message: "duplicate key value" } };
        const created: ClaimRow = {
          id: `claim-${this.store.rows.length + 1}`,
          user_id: row.user_id,
          claim_key: row.claim_key,
          created_at: this.store.insertStamp,
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
  /** What an inserted row's created_at becomes — "the clock the database stamps with". */
  insertStamp = new Date("2026-09-17T10:00:00Z").toISOString();

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

test("[EB-RACE] a missing intake_claims table does not stop the bank feed", async () => {
  const store = new FakeClaims();
  store.tableMissing = true;

  const result = await claimAccountSync(USER, ACCOUNT, NOW, store);
  assert.equal(
    result.claimed,
    true,
    "a backstop that refuses to sync when IT is broken is a silent stop for every owner",
  );
  await result.release(); // must not throw
});

test("[EB-RACE] a claim store that throws does not stop the bank feed either", async () => {
  const exploding = {
    from() {
      throw new Error("connection reset");
    },
  };
  const result = await claimAccountSync(USER, ACCOUNT, NOW, exploding);
  assert.equal(result.claimed, true);
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
