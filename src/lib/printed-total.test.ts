// [PRINTED-TOTAL] Pure node test — run: npx tsx --test src/lib/printed-total.test.ts
//
// ── WHY A TEST THAT READS SOURCE ──
// The defect this closes is not in a function. It is in an INSTRUCTION: the reader used to be told
// "never return a btw_amount that makes total_ex_btw + btw_amount differ from the printed Totaal te
// voldoen". Given a mixed-rate summary block it had mis-summed, the cheapest way to obey was to move
// the total — and the triplet it handed back was internally perfect and quietly wrong.
//
// Enka Horeca 26701681: excl 1.213,50 · btw 122,18 · totaal 1.335,68, against a paper that says
// 122,64 and 1.336,14. Every gate in the app passed it, correctly, because each of them tests the
// three numbers against each other and they had been made to agree.
//
// There is no unit to test that on. The prompt is a string, the evidence it asks for is optional by
// nature, and a well-meant edit ("tidy up the amount rules") can delete the whole mechanism without
// breaking a single existing assertion. So the mechanism is pinned where it lives: in the file.
//
// What is being held, in one line each:
//   · the reader is ASKED for the two independent witnesses (the printed total, the per-rate block);
//   · it is NOT told to balance the three amounts;
//   · what it returns is STORED rather than dropped on the floor;
//   · an amount WE computed is marked as ours;
//   · and the invoice that started this reads as "not fully checked" end to end.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { invoiceChecks, checksSummary } from './invoice-checks'
import { classifyImportHealth } from './import-health'

const ai = readFileSync('src/lib/ai.ts', 'utf8')

test('[PRINTED-TOTAL] the reader is asked for both independent witnesses', () => {
  // The response schema. Without these two keys the model has nowhere to put the evidence, and
  // everything downstream degrades to "the three numbers agree with each other" — which is what
  // was true of the invoice that started this.
  assert.match(ai, /"total_printed": number or null/, 'the printed final total must be a field of its own')
  assert.match(ai, /"btw_breakdown": \[\{ "rate"/, 'and the per-rate block must be requested')

  // The instruction that makes them worth having. The printed total is only evidence while it is
  // allowed to CONTRADICT the total we store; the moment the reader may reconcile them it becomes
  // a second copy of a number we already had.
  assert.match(ai, /IF THEY DISAGREE/, 'the disagreement case must be spelled out')
  assert.match(ai, /CHANGE NOTHING/, 'and it must say not to adjust anything')
})

test('[PRINTED-TOTAL] the reader is NOT told to make the three amounts agree', () => {
  // The exact sentence that produced the € 0,46. Kept as a literal so that re-introducing it —
  // which reads entirely reasonable in isolation — fails here instead of in the books.
  assert.doesNotMatch(
    ai, /Never return a btw_amount that\s+makes/,
    'this instruction makes a mis-summed BTW column silently rewrite the printed total',
  )
  assert.doesNotMatch(
    ai, /the identity always holds/,
    'excl + btw = totaal is a consequence of reading correctly, never a rule to enforce',
  )
})

test('[PRINTED-TOTAL] what the reader returns is actually stored', () => {
  // Asking for evidence and then dropping it is the failure mode this repo has paid for more than
  // once: a protection written, argued for, and cancelled by the line that never carried it on.
  assert.match(ai, /_btw_rows: clean/, 'the per-rate block must reach field_confidence')
  assert.match(ai, /_total_printed: printed/, 'and so must a printed total that disagrees')

  // Both reconcile branches — the one that computes the total and the one that computes the base.
  // Marking only one leaves half the invoices claiming a check that could not run.
  assert.match(ai, /markDerived\('total'\)/)
  assert.match(ai, /markDerived\('excl'\)/)

  // The one place the block is deliberately NOT stored. On a creditnota the sign of a printed
  // specification row is ambiguous (and a net-credit invoice legitimately mixes signs), so a
  // stored block would flag correctly-read credit notes — which already always need a human.
  assert.match(ai, /parsed\.is_credit_note === true \|\| !Array\.isArray\(parsed\.btw_breakdown\)/)
})

test('[PRINTED-TOTAL] every door that reads an invoice carries the evidence to the row', () => {
  // Five paths call the reader, and each of them writes its own invoice row. Evidence that is
  // produced and then not persisted is worse than evidence never gathered — the code reads as
  // though the check exists. The UBL door has no reader at all: it builds the same block from the
  // XML's typed elements, which is why it is on this list under a different phrase.
  const doors: Array<[string, string, string]> = [
// [ONTVANGEN] The intake DOOR is two files since #129: the route keeps the guards and the
// deterministic branches, intake-processor.ts holds everything that needs the reader. Reading
// both is reading the door — which is what this test was always asking about.
    ['src/lib/intake-processor.ts', '...(v.field_confidence ?? {})', 'the camera / file upload'],
    ['src/app/api/intake/route.ts', 'fieldConfidence._btw_rows = v.btwRows', 'the UBL e-invoice'],
    ['src/app/api/email/upload/route.ts', 'verification.field_confidence', 'the manual re-read'],
    ['src/app/api/bank/attach-invoice/route.ts', 'verification.field_confidence', 'attaching to a bank line'],
    ['src/lib/email-integration.ts', '...(aiConfidence ?? {})', 'the Gmail / Outlook sync'],
    ['src/lib/reimport-carry.ts', 'AMOUNT_EXPLAINING_KEYS', 'a re-import that read nothing'],
  ]
  for (const [file, phrase, what] of doors) {
    assert.ok(
      readFileSync(file, 'utf8').includes(phrase),
      `${what} (${file}) no longer carries the reader's field_confidence through — the per-rate ` +
        `block and the printed total are gathered and then dropped, and the checklist goes back ` +
        `to reporting a btw it never verified`,
    )
  }
})

test('[PRINTED-TOTAL] the Enka invoice reads as not-fully-checked, end to end', () => {
  // The stored row exactly as it sits in the database today: no per-rate block (it predates the
  // extraction change), amounts internally consistent, and wrong.
  const stored = {
    invoice_number: '26701681',
    invoice_date: '2026-01-30',
    invoice_type: 'factuur',
    total_ex_btw: 1213.5,
    btw_amount: 122.18,
    total_inc_btw: 1335.68,
    vendor_iban: 'NL65RABO0171136276',
    field_confidence: null,
  }

  // The queue is right to leave it alone — there is genuinely nothing here to flag. This assertion
  // exists so the next reader does not "fix" that: a warning on every mixed-rate invoice would be
  // noise, and the honest answer is a check that says it could not run, not an alarm.
  assert.equal(classifyImportHealth(stored).level, 'clean')

  // But the checklist may no longer claim it looked. That sentence is the one the owner acts on.
  const summary = checksSummary(invoiceChecks(stored))
  assert.doesNotMatch(summary, /Alle \d+ controles gedaan/)
  assert.match(summary, /konden we niet nagaan/)

  // And with the block the extraction now asks for, the same row is held AND explained.
  const withBlock = {
    ...stored,
    field_confidence: {
      _btw_rows: [
        { rate: 9, base: 1101.38, btw: 99.06 },
        { rate: 21, base: 112.12, btw: 23.58 },
      ],
    },
  }
  assert.equal(classifyImportHealth(withBlock).level, 'needs-review', 'never auto-booked')
  assert.equal(
    invoiceChecks(withBlock).find((c) => c.id === 'btw-split')?.outcome, 'flagged',
    'and the owner is told which figure the paper supports',
  )
})
