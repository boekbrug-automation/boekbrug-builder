// src/lib/stored-document-claim.test.ts
// [ONTVANGEN-CLAIM] Proof that one stored document is processed by one worker at a time.
//
// What this file can and cannot prove, said plainly:
//
//   · It CAN prove mutual exclusion, because the whole mechanism is one UNIQUE constraint and a
//     staleness rule. The fake below enforces UNIQUE (user_id, claim_key) exactly as the table
//     does, and every operation yields to the event loop, so two "workers" really do interleave
//     step by step — insert, insert, read, read, take over, take over. That is the race.
//   · It can NOT prove that PostgREST behaves like the fake, and it does not pretend the claim is
//     an at-most-once guarantee. A worker that DIES mid-write releases nothing; that half is the
//     partial UNIQUE index, the payment replay key, the Fair Use mark and the notification key,
//     and it is proved in ontvangen-crash.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { acquireClaimLease, CLAIM_SWEEP_MS } from "./claim-lease";
import {
  claimStoredDocument,
  storedDocumentClaimKey,
  STORED_DOCUMENT_CLAIM_TTL_MS,
  STORED_DOCUMENT_MAX_SECONDS,
} from "./stored-document-claim";

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

  // The columns asked for do not change what the fake returns; the shape is what matters.
  select(): this {
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
    this.store.calls.push({ op: this.op, filters: this.filters.map(([c, v]) => [c, v] as [string, unknown]) });

    if (this.store.throwOn === this.op) throw new Error("connection reset");
    if (this.store.tableMissing) {
      return { data: [], error: { code: "42P01", message: 'relation "intake_claims" does not exist' } };
    }
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
        const clash = this.store.rows.some((r) => r.user_id === row.user_id && r.claim_key === row.claim_key);
        // The whole point: a second insert of the same (user_id, claim_key) is refused by the
        // database, not by anything this code remembers.
        if (clash) return { data: [], error: { code: "23505", message: "duplicate key value" } };
        // created_at is written by the caller, not defaulted — that stamp is its ownership token.
        assert.ok(
          typeof row.created_at === "string" && row.created_at.length > 0,
          "the claim must write its own stamp, or it cannot prove ownership when releasing",
        );
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
  calls: Array<{ op: Op; filters: Array<[string, unknown]> }> = [];
  nextId = 1;
  insertError: { code?: string; message?: string } | null = null;
  selectError: { code?: string; message?: string } | null = null;
  updateError: { code?: string; message?: string } | null = null;
  throwOn: Op | null = null;

  filtersFor(op: Op): Array<Array<[string, unknown]>> {
    return this.calls.filter((c) => c.op === op).map((c) => c.filters);
  }

  from(table: string) {
    assert.equal(table, "intake_claims", "the claim must not reach any other table");
    return {
      insert: (payload: Record<string, unknown>) => new Query(this, "insert", payload),
      select: () => new Query(this, "select"),
      update: (payload: Record<string, unknown>) => new Query(this, "update", payload),
      delete: () => new Query(this, "delete"),
    };
  }
}

const OWNER = "11111111-1111-1111-1111-111111111111";
const DOCUMENT = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-09-18T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** Silence the deliberate refusal logs; a red test should read as a failed assertion, not a wall. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ── The four races the owner named ────────────────────────────────────────────────────────────

test("[ONTVANGEN-CLAIM] two workers reaching the same document: one acquired, one busy", async () => {
  const store = new FakeClaims();

  const [a, b] = await Promise.all([
    claimStoredDocument(OWNER, DOCUMENT, NOW, store),
    claimStoredDocument(OWNER, DOCUMENT, NOW, store),
  ]);

  const winners = [a, b].filter((c) => c.claimed);
  assert.equal(winners.length, 1, "two workers on one document is the same expense booked twice");
  assert.equal(store.rows.length, 1, "one document, one claim row");

  const loser = [a, b].find((c) => !c.claimed)!;
  assert.equal(loser.outcome, "busy", "a healthy collision is 'busy' — never 'unavailable'");
});

test("[ONTVANGEN-CLAIM] a stale claim is taken over by exactly one worker", async () => {
  const store = new FakeClaims();
  const dead = await claimStoredDocument(OWNER, DOCUMENT, NOW, store);
  assert.equal(dead.claimed, true);

  // Past the TTL: the worker that made it is gone, and the document must not stay wedged.
  const afterTtl = later(STORED_DOCUMENT_CLAIM_TTL_MS + 1000);
  const [a, b] = await Promise.all([
    claimStoredDocument(OWNER, DOCUMENT, afterTtl, store),
    claimStoredDocument(OWNER, DOCUMENT, afterTtl, store),
  ]);

  const winners = [a, b].filter((c) => c.claimed);
  assert.equal(winners.length, 1, "both workers seeing the same dead claim may not both take it over");
  assert.equal(store.rows.length, 1, "a takeover refreshes the claim, it does not add a second");
  assert.equal(
    store.rows[0].created_at,
    afterTtl.toISOString(),
    "the successor's stamp is what stands, or its own release cannot prove ownership",
  );
});

test("[ONTVANGEN-CLAIM] the old worker's late release does not free the successor's claim", async () => {
  const store = new FakeClaims();
  const old = await claimStoredDocument(OWNER, DOCUMENT, NOW, store);

  const afterTtl = later(STORED_DOCUMENT_CLAIM_TTL_MS + 1000);
  const successor = await claimStoredDocument(OWNER, DOCUMENT, afterTtl, store);
  assert.equal(successor.claimed, true, "a crashed worker may not wedge the document forever");

  // The zombie wakes up and tidies after itself. It must tidy up ITS version, which is gone.
  await old.release();
  assert.equal(store.rows.length, 1, "the successor is still running — its claim must survive");
  assert.equal(store.rows[0].created_at, afterTtl.toISOString(), "and it must be the successor's row");

  // And the proof that this is by construction, not by luck: the release filtered on the stamp.
  const releaseFilters = store.filtersFor("delete").at(-1)!;
  assert.ok(
    releaseFilters.some(([column, value]) => column === "created_at" && value === NOW.toISOString()),
    "release must identify OUR version of the claim, not whatever holds the key now",
  );

  // A third worker still may not join the successor.
  const third = await claimStoredDocument(OWNER, DOCUMENT, afterTtl, store);
  assert.equal(third.claimed, false, "releasing a dead claim may not let a second live worker in");
  assert.equal(third.outcome, "busy");
});

test("[ONTVANGEN-CLAIM] broken claim infrastructure starts no processing", async () => {
  // Every way the guarantee can fail to be established. Not one of them may answer "held": the
  // durable guards are a backstop against a crash, not a licence to run two workers on purpose.
  const cases: Array<[string, (s: FakeClaims) => void]> = [
    ["the table is absent", (s) => { s.tableMissing = true; }],
    ["the insert fails for an unknown reason", (s) => { s.insertError = { code: "08006", message: "connection failure" }; }],
    ["the holding claim cannot be read", (s) => { s.selectError = { message: "statement timeout" }; }],
    ["the takeover update fails", (s) => { s.updateError = { message: "deadlock detected" }; }],
    ["the claim path throws", (s) => { s.throwOn = "insert"; }],
  ];

  for (const [what, breakIt] of cases) {
    const store = new FakeClaims();
    // A standing (stale) claim, so the read/takeover arms are reachable too.
    await claimStoredDocument(OWNER, DOCUMENT, NOW, store);
    breakIt(store);

    const claim = await quietly(() =>
      claimStoredDocument(OWNER, DOCUMENT, later(STORED_DOCUMENT_CLAIM_TTL_MS + 1000), store),
    );
    assert.equal(claim.claimed, false, `${what}: processing must not start`);
    assert.equal(claim.outcome, "unavailable", `${what}: a broken mechanism is not a busy document`);

    // A refusal owns nothing, so releasing it may not touch the row that is standing there.
    await claim.release();
    assert.equal(store.rows.length, 1, `${what}: standing down may not clear another worker's claim`);
  }
});

test("[ONTVANGEN-CLAIM] a claim carrying an unreadable stamp is refused, not guessed", async () => {
  const store = new FakeClaims();
  await claimStoredDocument(OWNER, DOCUMENT, NOW, store);
  store.rows[0].created_at = "niet-een-datum";

  const claim = await quietly(() => claimStoredDocument(OWNER, DOCUMENT, later(60_000), store));
  assert.equal(claim.claimed, false, "stale-or-fresh may not be decided on a corrupt value");
  assert.equal(claim.outcome, "unavailable");
});

// ── The rules the wrapper must keep ───────────────────────────────────────────────────────────

test("[ONTVANGEN-CLAIM] the document is free again the moment its worker releases", async () => {
  const store = new FakeClaims();
  const first = await claimStoredDocument(OWNER, DOCUMENT, NOW, store);
  await first.release();
  assert.equal(store.rows.length, 0, "release removes the claim");
  await first.release(); // twice is harmless
  assert.equal(store.rows.length, 0);

  const next = await claimStoredDocument(OWNER, DOCUMENT, later(1000), store);
  assert.equal(next.claimed, true, "a retry must not wait out the TTL of a finished run");
});

test("[ONTVANGEN-CLAIM] two different documents of one owner do not block each other", async () => {
  const store = new FakeClaims();
  const other = "44444444-4444-4444-4444-444444444444";
  const a = await claimStoredDocument(OWNER, DOCUMENT, NOW, store);
  const b = await claimStoredDocument(OWNER, other, NOW, store);
  assert.equal(a.claimed, true);
  assert.equal(b.claimed, true, "the claim is per document, not per owner");
});

test("[ONTVANGEN-CLAIM] the key is namespaced, so it cannot collide with the other users of the table", () => {
  const key = storedDocumentClaimKey(DOCUMENT);
  assert.equal(key, `doc:${DOCUMENT}`);
  assert.ok(!key.startsWith("ebsync:"), "Enable Banking's namespace");
  assert.ok(!key.startsWith("nr:"), "the intake door's own namespace");
});

test("[ONTVANGEN-CLAIM] the claim outlives the longest run, and dies well inside the intake sweep", () => {
  // The upper bound, read out of the code that enforces it rather than repeated here: /api/intake
  // sweeps this owner's claims older than an hour WITHOUT reading the key, so a claim that lives
  // that long can be deleted by the owner photographing a receipt — handing one lock to two.
  const processor = readFileSync(new URL("./intake-processor.ts", import.meta.url), "utf8");
  const sweep = processor.match(/Date\.now\(\) - (\d[\d_]*)\)\.toISOString\(\)/);
  assert.ok(sweep, "the intake sweep no longer looks the way this gate reads it — re-derive it");
  const sweepMs = Number(sweep![1].replace(/_/g, ""));
  assert.equal(sweepMs, CLAIM_SWEEP_MS, "claim-lease.ts must carry the sweep window the processor uses");

  assert.ok(
    STORED_DOCUMENT_CLAIM_TTL_MS > STORED_DOCUMENT_MAX_SECONDS * 1000,
    "a worker killed at its ceiling must still be holding its claim when it dies",
  );
  assert.ok(
    STORED_DOCUMENT_CLAIM_TTL_MS < sweepMs / 2,
    "the TTL must sit well inside the key-blind hourly sweep, not merely under it",
  );
});

test("[CLAIM-LEASE] a TTL the sweep could reach refuses rather than races", async () => {
  const store = new FakeClaims();
  const lease = await quietly(() =>
    acquireClaimLease({
      userId: OWNER,
      claimKey: "doc:whatever",
      ttlMs: CLAIM_SWEEP_MS,
      tag: "[TEST]",
      subject: {},
      now: NOW,
      claimStore: store,
    }),
  );
  assert.equal(lease.claimed, false, "a claim the hygiene sweep can delete is not a claim");
  assert.equal(lease.outcome, "unavailable");
  assert.equal(store.rows.length, 0, "and nothing is written, so nothing is left behind");
});
