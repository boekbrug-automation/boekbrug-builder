// src/lib/duplicate-recheck.test.ts
// [ONTVANGEN-WAAR] The window has to close. Every test here is one way it could fail to.
//
// A bounded re-check and a poller are the same code with one condition removed, and the condition
// is the whole difference between "we looked for your answer for a minute" and "this app talks to
// the server forever on a screen nobody is using". That is why the rule is a module.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  keepRechecking, nextRecheckDelayMs, RECHECK_DELAYS_MS, RECHECK_WINDOW_MS,
} from "./duplicate-recheck"

test("[ONTVANGEN-WAAR] an idle screen generates nothing", () => {
  // Nothing was handed over, so there is nothing to discover. This is the case on every screen in
  // the app except an upload screen mid-batch, and it must cost exactly zero requests.
  assert.equal(keepRechecking({ attempt: 0, awaited: [], answered: [] }), false)
  assert.equal(nextRecheckDelayMs({ attempt: 0, awaited: [], answered: [] }), null)
})

test("[ONTVANGEN-WAAR] a fresh handoff opens the window, and it runs down", () => {
  const awaited = ["doc-1"]
  // Attempt by attempt, with nothing ever found: exactly as many looks as there are delays.
  const delays: number[] = []
  for (let attempt = 0; ; attempt++) {
    const next = nextRecheckDelayMs({ attempt, awaited, answered: [] })
    if (next === null) break
    delays.push(next)
    assert.ok(attempt < 50, "the window did not close — this is a poller")
  }
  assert.deepEqual(delays, [...RECHECK_DELAYS_MS])
  assert.equal(keepRechecking({ attempt: RECHECK_DELAYS_MS.length, awaited, answered: [] }), false,
    "the ceiling is absolute, whatever else is true")
})

test("[ONTVANGEN-WAAR] the window closes EARLY when the question arrives", () => {
  const awaited = ["doc-1", "doc-2"]
  // One of the two answered: still looking, because the other one is what we are here for.
  assert.equal(keepRechecking({ attempt: 1, awaited, answered: ["doc-1"] }), true)
  // Both answered: there is nothing left to discover, and this is the common success path.
  assert.equal(keepRechecking({ attempt: 1, awaited, answered: ["doc-1", "doc-2"] }), false)
  assert.equal(nextRecheckDelayMs({ attempt: 1, awaited, answered: ["doc-1", "doc-2"] }), null)
  // Somebody else's open question does not close our window — it is not what we are waiting for.
  assert.equal(keepRechecking({ attempt: 1, awaited, answered: ["doc-9"] }), true)
})

test("[ONTVANGEN-WAAR] the delay and the guard can never disagree", () => {
  // Reading RECHECK_DELAYS_MS[attempt] directly is the off-by-one that buys one extra request
  // nobody asked for, so nextRecheckDelayMs goes through the guard. Proven, not assumed.
  for (let attempt = 0; attempt <= RECHECK_DELAYS_MS.length + 3; attempt++) {
    const state = { attempt, awaited: ["doc-1"], answered: [] }
    assert.equal(nextRecheckDelayMs(state) === null, !keepRechecking(state),
      `attempt ${attempt}: a delay is offered exactly when the guard allows one`)
  }
})

test("[ONTVANGEN-WAAR] the window is short, and it backs off", () => {
  // Bounded above: an owner who has walked away is not worth a request. The upper bound is the
  // promise "this is not job tracking", written as a number a future change has to argue with.
  assert.ok(RECHECK_WINDOW_MS <= 120_000, `the window grew to ${RECHECK_WINDOW_MS}ms — that is tracking, not discovery`)
  // Bounded below: the first look has to be soon enough that the panel feels like it noticed.
  assert.ok(RECHECK_DELAYS_MS[0] <= 5_000, "the first look is too late to feel like an answer")
  // And the gaps widen, so the tail costs little: the read this is waiting for took 29.6s in
  // production, and a flat interval fine for the first look is wasteful by the last.
  for (let i = 1; i < RECHECK_DELAYS_MS.length; i++) {
    assert.ok(RECHECK_DELAYS_MS[i] > RECHECK_DELAYS_MS[i - 1], "each wait is longer than the one before")
  }
  assert.ok(RECHECK_DELAYS_MS.length <= 6, "more attempts than this is a poller with extra steps")
})
