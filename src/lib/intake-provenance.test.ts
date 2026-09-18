// src/lib/intake-provenance.test.ts
// [ONTVANGEN] The audit trail may not learn a client address that never existed.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  auditIpOf,
  runOriginOf,
  isBackgroundRun,
  type IntakeRun,
  type BackgroundTrigger,
} from "./intake-provenance"

/**
 * Every background trigger there is. Listing them here rather than inside one test is what makes
 * the rule below cover a trigger someone adds later: a new member of the union that is not in
 * this array fails to type-check the moment it exists.
 */
const ALL_TRIGGERS: readonly BackgroundTrigger[] = ["after_receive", "drain"]
const ALL_BACKGROUND_RUNS: readonly IntakeRun[] = ALL_TRIGGERS.map(
  (trigger) => ({ kind: "background", trigger }) as const,
)

test("[ONTVANGEN] no background run carries a client address — for any trigger", () => {
  for (const run of ALL_BACKGROUND_RUNS) {
    assert.equal(
      auditIpOf(run),
      undefined,
      `${runOriginOf(run)} produced an address; a run with no client has no address to report`,
    )
  }
})

test("[ONTVANGEN] a real request keeps its real address, unchanged", () => {
  assert.equal(auditIpOf({ kind: "request", ip: "203.0.113.7" }), "203.0.113.7")
})

test("[ONTVANGEN] a request whose header was stripped reports nothing, and does not pretend", () => {
  // getClientIP() returns undefined when x-forwarded-for and x-real-ip are both absent. That is a
  // request we genuinely cannot place — not a background run, and not an invented address either.
  assert.equal(auditIpOf({ kind: "request", ip: undefined }), undefined)
})

test("[ONTVANGEN] the two address-less cases are still told apart in the row", () => {
  // This is the whole reason runOriginOf exists. Both rows below have ip_address = null; without
  // the marker, an automatic booking nobody watched would read exactly like an owner behind a
  // proxy that dropped the header.
  const strippedRequest: IntakeRun = { kind: "request", ip: undefined }
  const automatic: IntakeRun = { kind: "background", trigger: "after_receive" }

  assert.equal(auditIpOf(strippedRequest), auditIpOf(automatic), "precondition: both have no address")
  assert.notEqual(
    runOriginOf(strippedRequest),
    runOriginOf(automatic),
    "two different facts must not produce one audit row",
  )
})

test("[ONTVANGEN] the marker names WHICH background pass did it", () => {
  // "It booked itself" is half an answer. A drain picking up a document hours later and the pass
  // that ran straight after the handoff are different stories when something has gone wrong.
  assert.equal(runOriginOf({ kind: "background", trigger: "after_receive" }), "background:after_receive")
  assert.equal(runOriginOf({ kind: "background", trigger: "drain" }), "background:drain")
  assert.notEqual(
    runOriginOf({ kind: "background", trigger: "after_receive" }),
    runOriginOf({ kind: "background", trigger: "drain" }),
  )
})

test("[ONTVANGEN] a background origin can never be mistaken for a request", () => {
  // A test that reads the value rather than the shape: whatever wording a later trigger brings,
  // it must not be the word the request case uses.
  const requestOrigin = runOriginOf({ kind: "request", ip: "203.0.113.7" })
  for (const run of ALL_BACKGROUND_RUNS) {
    assert.notEqual(runOriginOf(run), requestOrigin)
    assert.ok(
      runOriginOf(run).startsWith("background:"),
      `${runOriginOf(run)} does not announce itself as background`,
    )
    assert.ok(isBackgroundRun(run))
  }
  assert.equal(isBackgroundRun({ kind: "request", ip: undefined }), false)
})

test("[ONTVANGEN] there is nowhere to smuggle an upload-time address into a background run", () => {
  // The shortcut this module exists to refuse: capture the IP when the browser hands the file
  // over, then stamp it on the booking that happens minutes later. It cannot be expressed — the
  // background variant carries no ip field at all, so this object is not an IntakeRun.
  const smuggled = { kind: "background", trigger: "drain", ip: "203.0.113.7" }
  // @ts-expect-error a background run has no ip field, and adding one is a type error, not a habit
  const run: IntakeRun = smuggled
  // Even forced through, the answer is still nothing — the type is the first guard, not the only one.
  assert.equal(auditIpOf(run), undefined)
})
