// src/lib/duplicate-questions-read.test.ts
// [VRAAG-BLIJFT] "Unknown" is not "none", and decoration is not the question.
//
// The failure this pins down was silent by construction. The candidate lookup throws on any error
// — deliberately, because a partial read must never pass as a complete one — and an uncaught throw
// inside the questions route became a 500. The panel read `!res.ok` and rendered nothing. An owner
// with an open question about their own money saw a screen that, by saying nothing, said there was
// nothing waiting for them.
//
// Every test below is one half of the same rule: the question always travels; the number and the
// supplier beside it may not.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  candidateIdsOf, lookUpCandidates, buildQuestions,
  type QuestionRow, type CandidateRow,
} from "./duplicate-questions-read"

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

const ROWS: QuestionRow[] = [
  { id: "doc-1", file_name: "bon-maart.pdf", duplicate_candidate_invoice_id: A },
  { id: "doc-2", file_name: "bon-april.pdf", duplicate_candidate_invoice_id: B },
  { id: "doc-3", file_name: null, duplicate_candidate_invoice_id: null },
]

const FOUND: CandidateRow[] = [
  { id: A, invoice_number: "F-2026-14", client_name: "Jansen Groothandel" },
  { id: B, invoice_number: "F-2026-15", client_name: "De Vries BV" },
]

test("[VRAAG-BLIJFT] the ids are the distinct ones, in the order they appear", () => {
  assert.deepEqual(candidateIdsOf(ROWS), [A, B])
  assert.deepEqual(
    candidateIdsOf([...ROWS, { id: "doc-4", file_name: "x.pdf", duplicate_candidate_invoice_id: A }]),
    [A, B],
    "one lookup per invoice, however many documents point at it",
  )
  assert.deepEqual(candidateIdsOf([]), [])
})

test("[VRAAG-BLIJFT] a lookup that throws costs the decoration and NOT the questions", async () => {
  const found = await lookUpCandidates(candidateIdsOf(ROWS), async () => {
    throw new Error("414 Request-URI Too Large")
  })
  assert.equal(found.unavailable, true, "and the screen is told, so it can say what is missing")

  const questions = buildQuestions(ROWS, found)
  assert.equal(questions.length, 3, "every open question still reaches the owner")
  assert.deepEqual(questions.map((q) => q.documentId), ["doc-1", "doc-2", "doc-3"])
  assert.deepEqual(questions.map((q) => q.candidate), [null, null, null])
})

test("[VRAAG-BLIJFT] the failure is named, because nothing on screen shows it", async () => {
  // A question whose candidate could not be read looks EXACTLY like one the reader never found a
  // candidate for. Without a log line, the only trace is a link that is not there.
  const seen: string[] = []
  await lookUpCandidates([A], async () => { throw new Error("statement timeout") }, (m) => seen.push(m))
  assert.deepEqual(seen, ["statement timeout"])
})

test("[VRAAG-BLIJFT] nothing to look up is not a failed lookup", async () => {
  let called = false
  const found = await lookUpCandidates([], async () => { called = true; return [] })
  assert.equal(called, false, "no ids, no query")
  assert.equal(found.unavailable, false, "…and no alarm about a lookup that never needed to happen")
})

test("[VRAAG-BLIJFT] an empty answer is not a failure either", async () => {
  // Every candidate belongs to somebody else, or has since been deleted. The read SUCCEEDED and
  // said so: the questions stand with no invoice beside them, and the screen says nothing extra.
  const found = await lookUpCandidates([A], async () => [])
  assert.equal(found.unavailable, false)
  assert.equal(buildQuestions(ROWS, found)[0].candidate, null)
})

test("[VRAAG-BLIJFT] a complete lookup prints the number and the supplier", async () => {
  const found = await lookUpCandidates(candidateIdsOf(ROWS), async (ids) => {
    assert.deepEqual(ids, [A, B])
    return FOUND
  })
  assert.equal(found.unavailable, false)

  const questions = buildQuestions(ROWS, found)
  assert.deepEqual(questions[0].candidate, {
    invoiceId: A, invoiceNumber: "F-2026-14", vendor: "Jansen Groothandel",
  })
  assert.equal(questions[0].fileName, "bon-maart.pdf")
  assert.equal(questions[2].fileName, "document", "a nameless file is still a question, with a name to show")
  assert.equal(questions[2].candidate, null)
})

test("[VRAAG-BLIJFT] a PARTIAL answer drops no question either", async () => {
  // One candidate readable, one not — the owner-scoped query simply did not return B. The question
  // about doc-2 is every bit as open as the one about doc-1.
  const found = await lookUpCandidates([A, B], async () => [FOUND[0]])
  const questions = buildQuestions(ROWS, found)
  assert.equal(questions.length, 3)
  assert.ok(questions[0].candidate, "the one we could read is enriched")
  assert.equal(questions[1].candidate, null, "and the one we could not still asks")
})
