// src/lib/intake-drain-route.test.ts
// [NO-SILENT-EMPTY] Route-level test — run: npx tsx --test src/lib/intake-drain-route.test.ts
//
// What the drain's cron door REPORTS when it could not measure what it was supposed to measure.
//
// The rule the whole of F-08 turns on: "a failed attempt to read the backlog must never be
// reported as an empty, healthy backlog." That rule is only kept if it survives two more layers
// after selectDrainCandidates — runIntakeDrain, and this door. Both of them used to flatten it:
// the selector answered `[]`, the pass turned that into `picked: 0`, and this door wrote
// `ok: true` into the heartbeat. Three honest-looking numbers over a backlog nobody had read.
//
// [READINESS-DEGRADE] is the precedent for testing a route this way: the real handler, its
// outside reaches injected, and the assertions on what it DECIDES rather than on what it contains.
// A source gate can pin the shape of the `if`; only this can pin the answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { drainResponse, type DrainRouteDeps } from "../app/api/cron/intake-drain/route";
import type { DrainReport } from "./intake-drain";

const SECRET = "test-cron-secret";

/** Everything the heartbeat was told, so a test can assert on the ROW and not only on the body. */
interface Beat {
  ok: boolean;
  error?: string;
  result?: unknown;
}

function doorWith(report: DrainReport | (() => Promise<DrainReport>)): {
  deps: DrainRouteDeps;
  beats: Beat[];
  began: number;
} {
  const beats: Beat[] = [];
  const state = { began: 0 };
  const deps: DrainRouteDeps = {
    runDrain: typeof report === "function" ? report : (async () => report),
    begin: (async () => {
      state.began += 1;
      return "run-1";
    }) as unknown as DrainRouteDeps["begin"],
    finish: (async (_client: unknown, _id: unknown, beat: Beat) => {
      beats.push(beat);
    }) as unknown as DrainRouteDeps["finish"],
    client: () => ({}),
  };
  return { deps, beats, get began() { return state.began; } };
}

function request(auth: string | null = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest("https://boekbrug.nl/api/cron/intake-drain", {
    headers: auth === null ? {} : { authorization: auth },
  });
}

const scanned = (picked: number, outcomes: Record<string, number> = {}): DrainReport => ({
  reader: { kind: "scanned", picked, outcomes },
  notices: { kind: "scanned", picked: 0, outcomes: {} },
});

test.before(() => { process.env.CRON_SECRET = SECRET; });

// ── The door itself ───────────────────────────────────────────────────────────────────────────

test("[ONTVANGEN-DRAIN] an unauthorised knock writes no heartbeat at all", async () => {
  // Not a detail: a probe that marked the cron alive would make the health screen agree that the
  // recovery pass is running, on the strength of somebody knocking on the door.
  const { deps, beats, ...d } = doorWith(scanned(0));
  const res = await drainResponse(request("Bearer wrong"), deps);
  assert.equal(res.status, 401);
  assert.equal(beats.length, 0, "a refused caller must not be able to write a run row");
  assert.equal(d.began, 0);
});

test("[NO-SILENT-EMPTY] a clean pass reports ok, and says so in the heartbeat", async () => {
  const { deps, beats } = doorWith(scanned(3, { processed: 3 }));
  const res = await drainResponse(request(), deps);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reader.picked, 3);
  assert.deepEqual(beats, [{ ok: true, result: scanned(3, { processed: 3 }) }]);
});

test("[NO-SILENT-EMPTY] a measured zero is still a clean pass", async () => {
  // The other side of the rule, and the reason `unavailable` had to be its own arm rather than a
  // cautious default: a pass that looked and found nothing has EARNED ok:true and must keep it.
  const { deps, beats } = doorWith(scanned(0));
  const body = await (await drainResponse(request(), deps)).json();
  assert.equal(body.ok, true);
  assert.equal(body.reader.kind, "scanned");
  assert.equal(body.reader.picked, 0);
  assert.equal(beats[0].ok, true);
});

// ── The degraded rounds ───────────────────────────────────────────────────────────────────────

test("[NO-SILENT-EMPTY] a reader scan that failed is a FAILED run, never picked: 0 with ok: true", async () => {
  const { deps, beats } = doorWith({
    reader: { kind: "unavailable", error: "statement timeout" },
    notices: { kind: "scanned", picked: 0, outcomes: {} },
  });
  const res = await drainResponse(request(), deps);
  const body = await res.json();

  assert.equal(body.ok, false, "the one thing this whole batch exists to prevent");
  assert.equal(body.reader.kind, "unavailable");
  assert.ok(!("picked" in body.reader), "an unmeasured backlog may not carry a count of any kind");
  assert.equal(beats.length, 1);
  assert.equal(beats[0].ok, false, "the heartbeat is where a human finds out, so it must say failed");
  assert.match(String(beats[0].error), /reader unavailable: statement timeout/,
    "and it must name WHICH list was unreadable, and why");
});

test("[NO-SILENT-EMPTY] a notice scan that failed is a failed run, and is named apart", async () => {
  const { deps, beats } = doorWith({
    reader: { kind: "scanned", picked: 2, outcomes: { processed: 2 } },
    notices: { kind: "unavailable", error: "connection reset" },
  });
  const body = await (await drainResponse(request(), deps)).json();

  assert.equal(body.ok, false);
  assert.equal(body.reader.picked, 2, "the half that DID measure keeps its measurement");
  assert.equal(beats[0].ok, false);
  assert.match(String(beats[0].error), /notices unavailable: connection reset/);
  assert.doesNotMatch(String(beats[0].error), /reader unavailable/,
    "the reader pass succeeded; saying otherwise sends an operator after the wrong backlog");
});

test("[NO-SILENT-EMPTY] both halves unreadable names both, and neither hides the other", async () => {
  // They are two statements against the same table and they fail apart. A single flattened `ok`
  // would let a healthy notice pass vouch for a reader pass that measured nothing — which is how
  // an operator ends up looking at the wrong empty queue.
  const { deps, beats } = doorWith({
    reader: { kind: "unavailable", error: "reader down" },
    notices: { kind: "unavailable", error: "notices down" },
  });
  const body = await (await drainResponse(request(), deps)).json();
  assert.equal(body.ok, false);
  assert.match(String(beats[0].error), /reader unavailable: reader down/);
  assert.match(String(beats[0].error), /notices unavailable: notices down/);
});

test("[NO-SILENT-EMPTY] a pass that THREW is a failed run with a 500, not an empty success", async () => {
  // runIntakeDrain isolates each document, so reaching the catch means the pass itself could not
  // run. The documents are untouched and still waiting — which is recoverable, and must be VISIBLE.
  const { deps, beats } = doorWith(async () => { throw new Error("pipeline gone"); });
  const res = await drainResponse(request(), deps);
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.ok, false);
  assert.equal(beats[0].ok, false);
  assert.match(String(beats[0].error), /pipeline gone/);
});
