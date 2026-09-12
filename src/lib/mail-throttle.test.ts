// src/lib/mail-throttle.test.ts — run: npx tsx --test src/lib/mail-throttle.test.ts
//
// [THROTTLE] The retry DECISION, tested as a pure function rather than by mocking global fetch —
// the same shape as email-bounce.ts's classifyEmailEvent, and for the same reason: the part worth
// asserting is which statuses count as weather and how long we agree to wait, not that `fetch` was
// called twice.
import test from "node:test";
import assert from "node:assert/strict";
import {
  throttleWait, throttledFetch, beginThrottleBudget, throttleBudgetLeft,
  THROTTLE_MAX_WAIT_MS, THROTTLE_DEFAULT_WAIT_MS, THROTTLE_RUN_BUDGET_MS,
} from "./mail-throttle";

test("[THROTTLE] 429 and 5xx are weather; everything else is an answer", () => {
  // Retried. 429 is what both providers send when they throttle a mailbox.
  assert.equal(throttleWait(429, null), THROTTLE_DEFAULT_WAIT_MS);
  assert.equal(throttleWait(500, null), THROTTLE_DEFAULT_WAIT_MS);
  assert.equal(throttleWait(503, null), THROTTLE_DEFAULT_WAIT_MS, "Graph's other throttle code");
  assert.equal(throttleWait(504, null), THROTTLE_DEFAULT_WAIT_MS);

  // NOT retried, and each for its own reason.
  assert.equal(throttleWait(200, null), null, "a success is not a retry");
  assert.equal(throttleWait(401, null), null, "the token is the problem; waiting does not mint one");
  assert.equal(throttleWait(403, null), null,
    "Gmail's 403 is usually insufficient permission — it fails identically forever");
  assert.equal(throttleWait(404, null), null, "the message is gone; it will stay gone");
  assert.equal(throttleWait(400, null), null);

  // The pair matches what the attachment-bytes path already calls transient. If these two ever
  // disagree, one door treats a status as weather while the other calls it permanent.
  for (const status of [429, 500, 502, 503]) {
    const transientThere = status === 429 || status >= 500;
    assert.equal(throttleWait(status, null) !== null, transientThere, `status ${status}`);
  }
});

test("[THROTTLE] Retry-After is honoured, in both forms the RFC allows", () => {
  // Delta-seconds — what Microsoft Graph sends.
  assert.equal(throttleWait(429, "3"), 3000);
  assert.equal(throttleWait(429, " 7 "), 7000, "surrounding space is not a parse failure");

  // An HTTP-date is equally legal. Parsing it wrong means waiting the default when the server told
  // us exactly when to come back.
  const inFive = new Date(Date.now() + 5000).toUTCString();
  const waited = throttleWait(429, inFive);
  assert.ok(waited !== null && waited > 3000 && waited <= 6000, `date form gave ${waited}`);
});

test("[THROTTLE] a wait is bounded at both ends — never NaN, never a minute", () => {
  // Capped. A provider asking for ten minutes gets a next run instead of a held connection: the
  // route's ceiling is 300s and the watermark already makes "come back later" correct.
  assert.equal(throttleWait(429, "600"), THROTTLE_MAX_WAIT_MS);
  assert.equal(throttleWait(429, String(Number.MAX_SAFE_INTEGER)), THROTTLE_MAX_WAIT_MS);

  // Floored. "0" or a date in the past is the provider saying "now", and re-sending instantly goes
  // into the same closed window.
  assert.equal(throttleWait(429, "0"), THROTTLE_DEFAULT_WAIT_MS);
  assert.equal(throttleWait(429, new Date(Date.now() - 60_000).toUTCString()), THROTTLE_DEFAULT_WAIT_MS);

  // Unparseable is not NaN. Math.min(NaN, cap) is NaN, and setTimeout(NaN) fires immediately —
  // which would turn the polite retry into an instant second request at exactly the wrong moment.
  for (const junk of ["", "   ", "soon", "3 seconds", "-", null, undefined]) {
    const w = throttleWait(429, junk);
    assert.equal(w, THROTTLE_DEFAULT_WAIT_MS, `junk header ${JSON.stringify(junk)}`);
    assert.ok(Number.isFinite(w as number), "a wait must never be NaN");
  }
});

test("[THROTTLE] a header on a status we do not retry changes nothing", () => {
  // Retry-After is legal on a 503 and also on a 3xx. The status decides; the header only times it.
  assert.equal(throttleWait(301, "5"), null);
  assert.equal(throttleWait(403, "5"), null, "a rate-limit-looking header does not make 403 weather");
});

// ── The run budget ──────────────────────────────────────────────────────────────────────────────
//
// Without it the retry would be a REGRESSION in the very case it exists for. The Gmail path lists
// up to 4000 messages and fetches them ten at a time — ~400 sequential chunks, plus up to 40
// sequential list pages. At fifteen seconds each, sustained throttling would spend hours asleep
// inside a route that is killed at 300 seconds, having done less work than the no-retry version,
// which at least failed fast.

/** A Response-shaped stub. Only `status` and the one header are read. */
const reply = (status: number, retryAfter?: string) => ({
  status,
  headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
} as unknown as Response);

test("[THROTTLE-BUDGET] a fresh run grants waits; an exhausted one hands the response back", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; return reply(429, "0"); }) as typeof fetch;

    // A budget of exactly one default wait: the first throttle is retried, the second is not.
    beginThrottleBudget(THROTTLE_DEFAULT_WAIT_MS);
    await throttledFetch("https://example.test/a", "tok", "Gmail");
    assert.equal(calls, 2, "the first throttle inside budget must be retried once");
    assert.equal(throttleBudgetLeft(), 0, "and the wait must be charged against the budget");

    calls = 0;
    const res = await throttledFetch("https://example.test/b", "tok", "Gmail");
    assert.equal(calls, 1, "out of budget: no retry");
    assert.equal(res.status, 429,
      "and the throttled response is handed back, so the caller marks the fetch incomplete and " +
      "the watermark holds — which is exactly the behaviour that existed before this file");
  } finally {
    globalThis.fetch = real;
  }
});

test("[THROTTLE-BUDGET] a module that was never told a run began grants nothing", async () => {
  // The reason module-level state is safe here: the counter can only GRANT A WAIT OR NOT, and it
  // starts at zero. Forgetting the reset degrades to the pre-existing behaviour; it can never
  // produce a wrong value, only a missing retry.
  const real = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; return reply(503); }) as typeof fetch;
    beginThrottleBudget(0);
    await throttledFetch("https://example.test/c", "tok", "Graph");
    assert.equal(calls, 1, "no budget, no retry — fail-safe, not fail-open");
  } finally {
    globalThis.fetch = real;
  }
});

test("[THROTTLE-BUDGET] the ceiling is a fraction of the route's own 300s budget", () => {
  // If these ever cross, a fully-throttled run sleeps past its own deadline and is killed having
  // done less than the version with no retry at all.
  assert.ok(THROTTLE_RUN_BUDGET_MS <= 90_000, "the run budget must stay well inside maxDuration = 300");
  assert.ok(THROTTLE_MAX_WAIT_MS < THROTTLE_RUN_BUDGET_MS, "one call may never consume the whole run");
  beginThrottleBudget();
  assert.equal(throttleBudgetLeft(), THROTTLE_RUN_BUDGET_MS);
});

test("[THROTTLE-BUDGET] a success costs nothing", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (async () => reply(200)) as typeof fetch;
    beginThrottleBudget();
    await throttledFetch("https://example.test/d", "tok", "Gmail");
    assert.equal(throttleBudgetLeft(), THROTTLE_RUN_BUDGET_MS,
      "only an actual wait may be charged — otherwise a long clean run runs itself out of budget");
  } finally {
    globalThis.fetch = real;
  }
});
