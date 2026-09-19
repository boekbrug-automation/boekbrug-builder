// src/lib/intake-intent.test.ts
// [ONTVANGEN] The owner's payment choice must mean the same thing whether it is read off the live
// form or out of the row that survived the handoff.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  readIntentFromForm,
  intentFromStoredDocument,
  intentColumns,
  NO_INTENT,
  type IntakeIntent,
} from "./intake-intent"

/** A stand-in for FormData: the reader takes the narrow `get` shape on purpose. */
function form(fields: Record<string, string>) {
  return { get: (name: string): unknown => (name in fields ? fields[name] : null) }
}

/**
 * The round trip receive-first actually performs: the browser's answer is written to the document
 * row, the request ends, and the processor reads it back much later.
 */
function throughStorage(intent: IntakeIntent): IntakeIntent {
  const columns = intentColumns(intent)
  return intentFromStoredDocument({
    intake_paid_method: columns.intake_paid_method ?? null,
    intake_paid_date: columns.intake_paid_date ?? null,
  })
}

/** Every wording the Kas screen and the receipt flow can send, plus the ones they cannot. */
const UI_METHODS = ["bank", "pin", "pinpas", "bankpas", "creditcard", "kas", "contant", "kontant", "cash"]

test("[ONTVANGEN] the UI's word is normalised on the way in, not on the way out", () => {
  // "pin" must never reach a column, because cash-settle looks literally for 'kas' and bank/confirm
  // writes 'bank'. A third value falls between the two and books nowhere.
  assert.equal(readIntentFromForm(form({ paid_method: "pin" })).paidMethod, "bank")
  assert.equal(readIntentFromForm(form({ paid_method: "contant" })).paidMethod, "kas")
  for (const word of UI_METHODS) {
    const got = readIntentFromForm(form({ paid_method: word })).paidMethod
    assert.ok(got === "bank" || got === "kas", `${word} normalised to ${got}`)
  }
})

test("[ONTVANGEN] every choice the UI can send survives the handoff unchanged", () => {
  // The proof the owner asked for: paid_method / paid_date are LOADED FROM DURABLE INTENT, and
  // what comes back is what was chosen — not a weaker version of it.
  for (const word of UI_METHODS) {
    const live = readIntentFromForm(form({ paid_method: word, paid_date: "2026-09-18" }))
    assert.deepEqual(
      throughStorage(live),
      live,
      `"${word}" means something different after the tab closes`,
    )
  }
})

test("[ONTVANGEN] a choice the owner did not make stays unmade, on both sides", () => {
  assert.deepEqual(readIntentFromForm(form({})), NO_INTENT)
  assert.deepEqual(intentFromStoredDocument({}), NO_INTENT)
  assert.deepEqual(intentFromStoredDocument({ intake_paid_method: null, intake_paid_date: null }), NO_INTENT)
  // And nothing is written for it — an untouched row keeps its nulls rather than gaining "".
  assert.deepEqual(intentColumns(NO_INTENT), {})
})

test("[ONTVANGEN] an unreadable word is no choice at all — it is never guessed at", () => {
  // The dangerous alternative is a default. "ideal" is a real payment word and not one of the two
  // canonical values; picking either for it would settle a receipt through a ledger the owner
  // never named.
  assert.equal(readIntentFromForm(form({ paid_method: "ideal" })).paidMethod, null)
  assert.equal(readIntentFromForm(form({ paid_method: "" })).paidMethod, null)
  assert.equal(intentFromStoredDocument({ intake_paid_method: "ideal" }).paidMethod, null)
  assert.equal(intentFromStoredDocument({ intake_paid_method: "KAS" }).paidMethod, null)
})

test("[ONTVANGEN] a date is intent only when it is a date", () => {
  assert.equal(readIntentFromForm(form({ paid_method: "kas", paid_date: "2026-09-18" })).paidDate, "2026-09-18")
  assert.equal(readIntentFromForm(form({ paid_method: "kas", paid_date: "18-09-2026" })).paidDate, null)
  assert.equal(readIntentFromForm(form({ paid_method: "kas", paid_date: "vandaag" })).paidDate, null)
  // The durable side is checked too, although the column is a postgres `date`. The check costs a
  // regex; trusting that nobody widens the column costs a booking in the wrong period.
  assert.equal(intentFromStoredDocument({ intake_paid_date: "18-09-2026" }).paidDate, null)
})

test("[ONTVANGEN] a method with no date is still a method", () => {
  // The Kas button may send only paid_method. The verify queue then lets the human pick the date,
  // which is exactly what the synchronous path did before receive-first.
  const live = readIntentFromForm(form({ paid_method: "contant" }))
  assert.deepEqual(live, { paidMethod: "kas", paidDate: null })
  assert.deepEqual(throughStorage(live), live)
  assert.deepEqual(intentColumns(live), { intake_paid_method: "kas" })
})

test("[ONTVANGEN] the two readers cannot drift apart, because both answer the same shape", () => {
  // A structural guard rather than a value one: whatever either side learns to accept later, an
  // intent is these two fields and nothing else. A reader that starts returning a third field
  // would be returning something the processor does not read.
  assert.deepEqual(Object.keys(readIntentFromForm(form({ paid_method: "pin" }))).sort(), ["paidDate", "paidMethod"])
  assert.deepEqual(Object.keys(intentFromStoredDocument({ intake_paid_method: "bank" })).sort(), ["paidDate", "paidMethod"])
})
