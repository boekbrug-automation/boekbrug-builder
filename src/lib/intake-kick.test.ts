// src/lib/intake-kick.test.ts
// [ONTVANGEN] The response does not wait, and "Ontvangen" does not depend on the kick.
//
// Both halves matter and they fail in opposite ways. A kick that is AWAITED puts the owner back in
// the queue they were just taken out of. A kick whose failure reaches the caller puts the promise
// back on a network connection that may already be gone — and the promise is already kept: the
// bytes, the row and the intent are durable before this is called at all.

import { test } from "node:test"
import assert from "node:assert/strict"

import { kickStoredDocument, type Scheduler } from "./intake-kick"

const DOCUMENT = "33333333-3333-3333-3333-333333333333"
const OWNER = "11111111-1111-1111-1111-111111111111"

/** Silence the deliberate refusal logs; a red test should read as an assertion, not a wall. */
async function quietly<T>(fn: () => T | Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

test("[ONTVANGEN] the caller is not made to wait for the work", async () => {
  // The exact shape the route relies on: kickStoredDocument RETURNS while the pass is still
  // running. A reader promise that never settles must not hold the response.
  let started = false
  let release: (() => void) | null = null
  const nooitKlaar = new Promise<void>((r) => { release = () => r() })

  const scheduled: Array<() => Promise<void>> = []
  const schedule: Scheduler = (task) => { scheduled.push(task) }

  kickStoredDocument({
    documentId: DOCUMENT, ownerId: OWNER,
    deps: {
      schedule,
      run: (async () => { started = true; await nooitKlaar; return { kind: "gone" as const } }),
    },
  })

  // The call has already returned. The task has been HANDED to the scheduler and not awaited.
  assert.equal(scheduled.length, 1, "the work must be handed to the platform, not run inline")
  assert.equal(started, false, "…and not started by the caller either")

  // The platform runs it later. It never finishes, and nothing here is waiting for it.
  const running = scheduled[0]()
  await Promise.resolve()
  assert.equal(started, true)
  release!()
  await running
})

test("[ONTVANGEN] a scheduler that refuses does not reach the owner", async () => {
  // after() outside a request scope, a platform without waitUntil, a cold start that lost it — all
  // of them leave the document in wacht_op_lezen, which is what the drain is for.
  await quietly(() => {
    kickStoredDocument({
      documentId: DOCUMENT, ownerId: OWNER,
      deps: {
        schedule: () => { throw new Error("no request scope") },
        run: async () => ({ kind: "gone" as const }),
      },
    })
  })
  // Reaching here IS the assertion: nothing was thrown at the caller.
  assert.ok(true)
})

test("[ONTVANGEN] a pass that throws inside the scheduler is caught there", async () => {
  // A throw inside after() is an unhandled rejection in a process nobody is watching.
  const scheduled: Array<() => Promise<void>> = []
  kickStoredDocument({
    documentId: DOCUMENT, ownerId: OWNER,
    deps: {
      schedule: (task) => { scheduled.push(task) },
      run: async () => { throw new Error("boom") },
    },
  })
  await quietly(() => scheduled[0]())
  assert.ok(true)
})

test("[ONTVANGEN] the kick asks for the run the route means", async () => {
  const seen: Array<Record<string, unknown>> = []
  const scheduled: Array<() => Promise<void>> = []
  kickStoredDocument({
    documentId: DOCUMENT, ownerId: OWNER,
    deps: {
      schedule: (task) => { scheduled.push(task) },
      run: (async (args: Record<string, unknown>) => { seen.push(args); return { kind: "gone" as const } }),
    },
  })
  await scheduled[0]()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].documentId, DOCUMENT)
  assert.equal(seen[0].ownerId, OWNER)
  assert.equal(seen[0].mode, "fresh_intake", "a fresh handoff is not a retry of a skipped document")
  assert.equal(seen[0].trigger, "after_receive", "…and the audit trail must say where it came from")
  // And no `source`: that is receive identity and comes off the row, never from the caller.
  assert.ok(!("source" in seen[0]), "source must not travel with the kick")
})
