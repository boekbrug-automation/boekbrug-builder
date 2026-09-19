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

/** A candidate row with the money columns defaulted, so a test states only what it is about. */
function candidate(over: Partial<CandidateRow> & { id: string }): CandidateRow {
  return {
    invoice_number: null, client_name: null, total_inc_btw: null, amount_paid: null,
    status: null, accountant_status: null, invoice_type: null, ...over,
  }
}

const FOUND: CandidateRow[] = [
  candidate({ id: A, invoice_number: "F-2026-14", client_name: "Jansen Groothandel" }),
  candidate({ id: B, invoice_number: "F-2026-15", client_name: "De Vries BV" }),
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
  // [ONTVANGEN-WAAR] The money facts travel with the candidate now. This fixture carries no
  // amounts, and the result says exactly that rather than guessing: `onbekend`, and nothing that
  // could be mistaken for "not paid".
  assert.deepEqual(questions[0].candidate, {
    invoiceId: A, invoiceNumber: "F-2026-14", vendor: "Jansen Groothandel",
    total: null, payment: "onbekend", outstanding: null,
    // A fixture with no status is a row whose home screen we cannot name — and `unknown` is what
    // suppresses the link, rather than sending the owner somewhere that may not hold it.
    where: "unknown", accountantProcessed: false,
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

// ── [ONTVANGEN-WAAR] The money facts beside the question ──────────────────────────────────────
//
// The question used to carry a number and a supplier. So the owner read the SAME question whether
// the invoice already in the books was €500 nobody had paid, €500 already settled, or €200 paid
// with €300 still open. One of those is a double payment waiting to happen, and none of them was
// distinguishable. These tests are about the facts; the sentences they turn into live in
// duplicate-question.test.ts.

import { candidateContextLines, questionCopy } from "./duplicate-question"
import { translator } from "./i18n/t"

const tnl = translator("nl")

/** Build the one question that a single candidate row produces. */
function questionFor(row: CandidateRow) {
  const rows: QuestionRow[] = [{ id: "doc-1", file_name: "factuur.pdf", duplicate_candidate_invoice_id: row.id }]
  const found = { byId: new Map([[row.id, row]]), unavailable: false }
  return buildQuestions(rows, found)[0]
}

test("[ONTVANGEN-WAAR] unpaid, partly paid and paid are three different answers", () => {
  const unpaid = questionFor(candidate({ id: A, total_inc_btw: 500, amount_paid: 0 }))
  assert.equal(unpaid.candidate?.payment, "onbetaald")
  assert.equal(unpaid.candidate?.outstanding, 500)
  assert.deepEqual(candidateContextLines(tnl, unpaid), ["€ 500,00", "Nog niet betaald · € 500,00 open"])

  const partly = questionFor(candidate({ id: A, total_inc_btw: 500, amount_paid: 200 }))
  assert.equal(partly.candidate?.payment, "deels_betaald")
  assert.equal(partly.candidate?.outstanding, 300)
  assert.deepEqual(candidateContextLines(tnl, partly), ["€ 500,00", "€ 200,00 betaald · € 300,00 open"])

  const paid = questionFor(candidate({ id: A, total_inc_btw: 500, amount_paid: 500 }))
  assert.equal(paid.candidate?.payment, "betaald")
  assert.equal(paid.candidate?.outstanding, 0)
  assert.deepEqual(candidateContextLines(tnl, paid), ["€ 500,00", "Betaald ✓"])
})

test("[ONTVANGEN-WAAR] payment comes from the AMOUNTS, never from the status word", () => {
  // factuurstaat.ts is the authority and says so in its own header: a row can read 'paid' while
  // carrying a part payment. Deciding this here from `status` would make it the seventieth place
  // in this app that answers "is it paid" for itself, and the first one to get it wrong on screen.
  const saysPaid = questionFor(candidate({ id: A, status: "paid", total_inc_btw: 500, amount_paid: 200 }))
  assert.equal(saysPaid.candidate?.payment, "deels_betaald",
    "the word 'paid' does not settle a bill; the money does")

  const saysReceived = questionFor(candidate({ id: A, status: "received", total_inc_btw: 500, amount_paid: 500 }))
  assert.equal(saysReceived.candidate?.payment, "betaald",
    "and money that arrived is money that arrived, whatever the status has caught up to")
})

test("[ONTVANGEN-WAAR] money we could not read invents NOTHING", () => {
  // The single most dangerous line this panel could print is "Nog niet betaald" over an invoice
  // whose total nobody could read: it looks exactly as confident as a fact, and acting on it means
  // paying a bill a second time.
  const unknown = questionFor(candidate({ id: A, total_inc_btw: null, amount_paid: null }))
  assert.equal(unknown.candidate?.payment, "onbekend")
  assert.equal(unknown.candidate?.total, null)
  assert.deepEqual(candidateContextLines(tnl, unknown), [],
    "no amount, no payment line, and no sentence about not knowing either — say less")

  // A total with no payment recorded is NOT unknown: nothing paid is a fact.
  const nothingPaid = questionFor(candidate({ id: A, total_inc_btw: 80, amount_paid: null }))
  assert.equal(nothingPaid.candidate?.payment, "onbetaald")
})

test("[ONTVANGEN-WAAR] the two places the owner cannot see are named", () => {
  // [DUP-ARCHIVED] "This invoice already exists" is useless when it exists somewhere invisible.
  const archived = questionFor(candidate({ id: A, status: "archived", total_inc_btw: 120, amount_paid: 0 }))
  assert.equal(archived.candidate?.where, "archived")
  assert.ok(candidateContextLines(tnl, archived).includes("Staat in Genegeerd"))

  const locked = questionFor(candidate({ id: A, accountant_status: "verwerkt", total_inc_btw: 120, amount_paid: 120 }))
  assert.equal(locked.candidate?.accountantProcessed, true)
  assert.deepEqual(candidateContextLines(tnl, locked),
    ["€ 120,00", "Betaald ✓", "Je boekhouder heeft deze factuur al verwerkt"])

  const ordinary = questionFor(candidate({ id: A, status: "received", total_inc_btw: 120, amount_paid: 0 }))
  assert.equal(ordinary.candidate?.where, "books")
  assert.equal(ordinary.candidate?.accountantProcessed, false)
})

test("[ONTVANGEN-WAAR] no machine word reaches the owner", () => {
  // Simpel van buiten. Every internal name for this machinery, checked against every line the
  // panel can produce — including the ones only a rare row reaches.
  const rows: CandidateRow[] = [
    candidate({ id: A, total_inc_btw: 500, amount_paid: 0 }),
    candidate({ id: A, total_inc_btw: 500, amount_paid: 200 }),
    candidate({ id: A, total_inc_btw: 500, amount_paid: 500 }),
    candidate({ id: A, total_inc_btw: 500, amount_paid: 900 }),
    candidate({ id: A, total_inc_btw: null, amount_paid: null }),
    candidate({ id: A, status: "archived", accountant_status: "verwerkt", total_inc_btw: 1, amount_paid: 0 }),
  ]
  const machine = [
    "wacht_op_besluit", "amount_paid", "accountant_status", "possible_duplicate_id",
    "total_inc_btw", "invoice_type", "add_anyway", "keep_existing", "onbetaald", "deels_betaald",
  ]
  for (const row of rows) {
    const q = questionFor(row)
    const shown = [...candidateContextLines(tnl, q), questionCopy(tnl, q).sentence,
                   questionCopy(tnl, q).addLabel, questionCopy(tnl, q).keepLabel].join(" | ")
    for (const word of machine) {
      assert.ok(!shown.includes(word), `the owner is reading our machinery: "${word}" in «${shown}»`)
    }
  }
})

test("[ONTVANGEN-WAAR] enrichment that fails costs the context, never the question", () => {
  // [VRAAG-BLIJFT], unchanged and re-proved with the money columns in place: the new read is more
  // to lose, so the rule that losing it is survivable matters more, not less.
  const rows: QuestionRow[] = [{ id: "doc-1", file_name: "factuur.pdf", duplicate_candidate_invoice_id: A }]
  const questions = buildQuestions(rows, { byId: new Map(), unavailable: true })
  assert.equal(questions.length, 1, "the question still reaches the owner")
  assert.equal(questions[0].candidate, null)
  assert.deepEqual(candidateContextLines(tnl, questions[0]), [], "and claims nothing about money")
  assert.equal(questionCopy(tnl, questions[0]).sentence, "Deze factuur lijkt al te bestaan.",
    "an unreadable candidate is never described as settled")
})

// ── [ONTVANGEN-WAAR] Payment is context. It is not evidence, and it is not a destination ───────

test("[ONTVANGEN-WAAR] a paid candidate does not make the duplicate MORE certain", () => {
  // This briefly said "Deze factuur staat al in BoekBrug" once the candidate was settled, and that
  // crossed a boundary. A paid candidate is a fact about the invoice ALREADY in the books; it is
  // not evidence that the document just uploaded is that same invoice. The semantic gate exists
  // because its match can be a false positive — which is exactly why it is forceable — so hardening
  // the sentence aimed our extra confidence at the owner's own correct answer.
  //
  // The exact-bytes gate is the certain one, and it never reaches this panel: it answers 409
  // synchronously, carries no canForce, and can never become wacht_op_besluit.
  const states: Array<[string, CandidateRow]> = [
    ["unpaid", candidate({ id: A, status: "received", total_inc_btw: 500, amount_paid: 0 })],
    ["partly", candidate({ id: A, status: "received", total_inc_btw: 500, amount_paid: 200 })],
    ["paid", candidate({ id: A, status: "paid", total_inc_btw: 500, amount_paid: 500 })],
    ["overpaid", candidate({ id: A, status: "paid", total_inc_btw: 500, amount_paid: 900 })],
    ["unknown money", candidate({ id: A, status: "received" })],
  ]
  const copies = states.map(([name, row]) => [name, questionCopy(tnl, questionFor(row))] as const)

  for (const [name, copy] of copies) {
    assert.equal(copy.sentence, "Deze factuur lijkt al te bestaan.",
      `${name}: the question must stay hedged — payment state is risk, never identity`)
    assert.equal(copy.keepLabel, "Bestaande houden", `${name}: same first decision`)
    assert.equal(copy.addLabel, "Dit is echt een andere factuur", `${name}: same second decision`)
  }
  // One sentence across the board, and no wording that upgrades a maybe into a statement.
  assert.equal(new Set(copies.map(([, c]) => c.sentence)).size, 1)
  for (const [name, copy] of copies) {
    for (const certain of ["staat al", "is al", "bestaat al"]) {
      assert.ok(!copy.sentence.includes(certain), `${name}: «${certain}» claims to know what we do not`)
    }
  }

  // Only the CONTEXT differs — which is where the settled warning belongs, as a fact.
  const lines = copies.map(([name, c]) => [name, c.contextLines.join(" · ")] as const)
  assert.equal(lines.find(([n]) => n === "unpaid")?.[1], "€ 500,00 · Nog niet betaald · € 500,00 open")
  assert.equal(lines.find(([n]) => n === "paid")?.[1], "€ 500,00 · Betaald ✓")
  assert.equal(lines.find(([n]) => n === "unknown money")?.[1], "")
})

test("[ONTVANGEN-WAAR] the candidate link goes where that invoice actually lives", () => {
  // The two screens hold disjoint sets, read off their own queries:
  //   /dashboard/incoming        → .eq("status","processing") and .eq("status","archived")
  //   /dashboard/incoming/manage → .in('status', ['received','paid'])
  // The hard semantic gate filters on no status, so all four are reachable — and the panel used to
  // send every one of them to manage. A question that had just said «Staat in Genegeerd» offered a
  // link to a list that cannot contain it.
  const href = (status: string | null) =>
    questionCopy(tnl, questionFor(candidate({ id: A, status }))).candidateLink?.href ?? null

  assert.equal(href("processing"), `/dashboard/incoming?focus=${A}`, "the verify queue holds it");
  assert.equal(href("archived"), `/dashboard/incoming?focus=${A}`,
    "…and so does Genegeerd, on the same screen — [ZOEK-LANDT] switches to that tab itself");
  assert.equal(href("received"), `/dashboard/incoming/manage?focus=${A}`, "booked and unpaid lives in manage");
  assert.equal(href("paid"), `/dashboard/incoming/manage?focus=${A}`, "and so does booked and settled");

  // Anything we have not been taught about gets NO link. A wrong destination is worse than none:
  // it looks like it worked, and the owner only finds out by not finding the invoice.
  for (const unknown of [null, "draft", "sent", "overdue", "rejected", ""]) {
    assert.equal(href(unknown), null, `status "${unknown}" must not invent a screen`)
  }

  // A question with no candidate at all offers nothing to click, as before.
  const rows: QuestionRow[] = [{ id: "doc-1", file_name: "f.pdf", duplicate_candidate_invoice_id: A }]
  const orphan = buildQuestions(rows, { byId: new Map(), unavailable: true })[0]
  assert.equal(questionCopy(tnl, orphan).candidateLink, null)

  // The archived case is the one that has to agree with itself: the line and the link, one fact.
  const arch = questionFor(candidate({ id: A, status: "archived", total_inc_btw: 10, amount_paid: 0 }))
  const copy = questionCopy(tnl, arch)
  assert.ok(copy.contextLines.includes("Staat in Genegeerd"))
  assert.match(copy.candidateLink?.href ?? "", /^\/dashboard\/incoming\?focus=/,
    "the screen named by the line must be the screen the link opens")
})
