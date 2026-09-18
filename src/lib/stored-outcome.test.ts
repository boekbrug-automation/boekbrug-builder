// src/lib/stored-outcome.test.ts
// [ONTVANGEN] What the door answered, read as durable state.
//
// The expensive one is the semantic duplicate. It is the only answer here that arrives AFTER the
// model has already been paid for, and reading it as "try again later" would buy the same answer
// to the same question on every drain pass — silently, forever, at our cost.

import { test } from "node:test"
import assert from "node:assert/strict"

import { readStoredOutcome } from "./stored-outcome"
import { PAUSE_REASON_FAIR_USE } from "./fair-use-pause"
import type { IntakeOutcome } from "./intake-processor"

const json = (status: number, body: unknown): IntakeOutcome => ({ kind: "json", status, body })

test("[ONTVANGEN] a finished run needs nothing written — the door already did it", () => {
  assert.deepEqual(readStoredOutcome(json(200, { ok: true })), { kind: "done" })
})

test("[ONTVANGEN] the quota refusal is a DOMAIN fact, not a status code", () => {
  const paused = readStoredOutcome({
    kind: "paused", reason: PAUSE_REASON_FAIR_USE, metric: "aiDocuments",
    response: new Response(null, { status: 402 }),
  })
  assert.deepEqual(paused, { kind: "pause_fair_use", reason: PAUSE_REASON_FAIR_USE, metric: "aiDocuments" })
})

test("[ONTVANGEN] a semantic duplicate waits on the OWNER, never on another read", () => {
  // The reader has already run and already been charged. The question — is this the same bill? —
  // is one a human answers; asking the model again buys the same answer at the same price.
  const v = readStoredOutcome(json(409, {
    error: "Deze factuur bestaat al — F-2026-14 van Jansen is al toegevoegd.",
    duplicate: true, canForce: true, original_id: "inv-14",
  }))
  assert.deepEqual(v, { kind: "owner_decision", candidateInvoiceId: "inv-14" })
})

test("[ONTVANGEN] …and it is still an owner decision when no candidate can be named", () => {
  const v = readStoredOutcome(json(409, { duplicate: true, canForce: true }))
  assert.deepEqual(v, { kind: "owner_decision", candidateInvoiceId: null })
})

test("[ONTVANGEN] another WORKER is not another invoice", () => {
  // [INTAKE-CLAIM] The in-flight 409 is the claim doing its job. Turning that into a question for
  // the owner would ask them about a document that is being processed at that very moment.
  assert.deepEqual(
    readStoredOutcome(json(409, { duplicate: true, inFlight: true })),
    { kind: "retry_later", why: "in_flight" },
  )
})

test("[ONTVANGEN] a duplicate shape nobody recognises is retried, never acted on", () => {
  const v = readStoredOutcome(json(409, { duplicate: true }))
  assert.equal(v.kind, "retry_later")
})

test("[ONTVANGEN] a library-built Response carries no domain fact, so it waits", () => {
  const v = readStoredOutcome({ kind: "response", response: new Response(null, { status: 429 }) })
  assert.deepEqual(v, { kind: "retry_later", why: "response:429" })
})

test("[ONTVANGEN] every other failure leaves the document exactly as it is", () => {
  for (const status of [500, 502, 503, 422, 400]) {
    const v = readStoredOutcome(json(status, { error: "iets" }))
    assert.equal(v.kind, "retry_later", `status ${status}`)
  }
})
