// src/lib/settlement-key.test.ts
// [ONTVANGEN] One document, one automatic settlement, one key — forever.

import { test } from "node:test"
import assert from "node:assert/strict"
import { autoSettlementKey, SETTLEMENT_NAMESPACES } from "./settlement-key"

const DOC = "0cbc765a-7244-4722-bbce-dc8e7ecfaeb3"
const OTHER = "8af90841-e5ba-4acd-815a-cd21d01c2175"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test("[ONTVANGEN] the same document always produces the same key", () => {
  // The whole point. apply_manual_payment replays on (client_key, user_id, invoice_id): hand it a
  // key it has seen and it returns the original booking without moving money. randomUUID() makes
  // every retry a booking it has never seen, which is a second payment for one bon.
  const first = autoSettlementKey(DOC)
  for (let i = 0; i < 5; i++) assert.equal(autoSettlementKey(DOC), first)
  // Whitespace is not a different document.
  assert.equal(autoSettlementKey(` ${DOC} `), first)
})

test("[ONTVANGEN] the key is a v5 uuid, because the column is a uuid", () => {
  assert.match(autoSettlementKey(DOC), UUID)
  assert.match(SETTLEMENT_NAMESPACES.intakeAutoSettle, UUID)
})

test("[ONTVANGEN] different documents never share a key", () => {
  assert.notEqual(autoSettlementKey(DOC), autoSettlementKey(OTHER))
})

test("[ONTVANGEN] the namespace keeps automatic settlement apart from anything else", () => {
  // A collision between the owner's own "Markeer als betaald" and an automatic settlement of the
  // same bon would make one a silent replay of the other — worse than a duplicate, because the
  // money simply never moves and the invoice says it did.
  const bareV5OfTheDocument = autoSettlementKey(DOC)
  assert.notEqual(bareV5OfTheDocument, DOC, "the key is not the document id wearing a hat")
  assert.notEqual(bareV5OfTheDocument, SETTLEMENT_NAMESPACES.intakeAutoSettle)
})

test("[ONTVANGEN] a key without a document is refused, never invented", () => {
  // Returning some fallback uuid here would give two different documents one key on the day a
  // caller passes an empty id — and that is the collision above, arriving by accident.
  for (const bad of ["", "   ", null, undefined]) {
    assert.throws(() => autoSettlementKey(bad as unknown as string), /needs the document/)
  }
})

test("[ONTVANGEN] the key is stable across processes, not just within one", () => {
  // Pinned literals. If the derivation ever changes, every retry in flight becomes a NEW booking
  // to the RPC — so this must fail loudly rather than drift quietly.
  assert.equal(SETTLEMENT_NAMESPACES.intakeAutoSettle, "e3900e75-d3ff-5d0b-aebf-23a8d309a3f3")
  assert.equal(autoSettlementKey(DOC), "a8240445-54c8-5bd8-9f30-d747ca8c71cc")
})
