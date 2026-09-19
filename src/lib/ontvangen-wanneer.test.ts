// src/lib/ontvangen-wanneer.test.ts
// [ONTVANGEN-WANNEER] No financial effect may depend on WHEN we get round to the work.
//
// This is the invariant that makes receive-first safe at all. Until #129, reading and booking
// happened inside the owner's upload request — seconds after they tapped. Afterwards it happens
// whenever the queue reaches it: a minute later, or the next morning, or on the 1st of next month
// if the allowance paused it.
//
// If any decision on that path read the clock, the SAME bon would book differently depending on
// how busy we were. A receipt uploaded at 23:58 and processed at 00:03 would land in another day,
// another quarter at a quarter boundary, another year on 31 December. Nothing would fail; the
// aangifte would just be wrong, and nobody would know which pass did it.
//
// So the rule is: the paper and the owner decide the dates. Our clock decides nothing.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { planReceiptSettlement } from "./receipt-auto-settle"
import { paymentDateOutOfWindow } from "./payment-date"

/** Comment-free source, so a sentence about time is never mistaken for a read of it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** Every way a module could ask what time it is. */
const CLOCK = /\bnew Date\(\s*\)|Date\.now\(\)|amsterdamToday\(\)|currentPeriod\(\s*\)/

test("[ONTVANGEN-WANNEER] the modules that decide whether to book read no clock", () => {
  // These decide auto-advance eligibility and the owner's grip on the autopilot. A clock read
  // inside either would make the verdict depend on the queue's depth.
  for (const path of ["src/lib/auto-advance.ts", "src/lib/auto-boeken.ts", "src/lib/intake-router.ts"]) {
    assert.doesNotMatch(code(path), CLOCK, `${path} asks what time it is; then the same document books differently depending on when we reach it`)
  }
})

test("[ONTVANGEN-WANNEER] the settlement decides the date from the paper, never from now", () => {
  const settle = code("src/lib/receipt-auto-settle.ts")
  assert.doesNotMatch(settle, CLOCK, "receipt-auto-settle must be handed the day, never take it")
  // It IS handed one — as a ceiling, by its caller — and that parameter is the only time in it.
  assert.match(settle, /today: string/, "…and the day it is handed is an explicit parameter")
  // The date that reaches the kasboek comes from the tender line or the invoice, in that order.
  assert.match(settle, /const payDate = pickPayDate\(input\.suggestion\.paidDate, input\.invoiceDate\)/)
})

test("[ONTVANGEN-WANNEER] the same bon books the same way whenever we process it", () => {
  // The behavioural half of the gate above. A bon paid in cash on 18 September, planned as if we
  // processed it that evening and as if we processed it eleven days later.
  const bon = {
    documentKind: "receipt" as const,
    suggestion: { suggestPaid: true, paidMethod: "kas" as const, paidMethodZeker: true, paidDate: "2026-09-18" },
    invoiceDate: "2026-09-18",
    totalIncBtw: 24.2,
  }
  const sameEvening = planReceiptSettlement({ ...bon, today: "2026-09-18" })
  const elevenDaysLater = planReceiptSettlement({ ...bon, today: "2026-09-29" })
  const nextMonth = planReceiptSettlement({ ...bon, today: "2026-10-01" })

  assert.equal(sameEvening.settle, true, "precondition: this bon settles at all")
  assert.deepEqual(elevenDaysLater, sameEvening, "a delayed pass must book the same amount on the same day")
  assert.deepEqual(nextMonth, sameEvening, "…even across a month boundary, where the aangifte changes")
})

test("[ONTVANGEN-WANNEER] the one clock read is a ceiling, and a ceiling only ever rises", () => {
  // paymentDateOutOfWindow is where amsterdamToday() lands. Delay moves the ceiling FORWARD, so a
  // date that was acceptable stays acceptable — the refusal can never appear because we were slow.
  const payDate = "2026-09-18"
  assert.equal(paymentDateOutOfWindow(payDate, "2026-09-18"), false)
  for (const later of ["2026-09-19", "2026-09-30", "2026-10-01", "2027-01-01"]) {
    assert.equal(
      paymentDateOutOfWindow(payDate, later), false,
      `a pay date accepted on the day was refused when processed on ${later}`,
    )
  }
  // And the ceiling still does its job: a date beyond tomorrow is refused whenever it is asked.
  assert.equal(paymentDateOutOfWindow("2026-09-30", "2026-09-18"), true)
})

test("[ONTVANGEN-WANNEER] a receipt at a year boundary keeps its own year", () => {
  // The sharpest version: uploaded on new year's eve, processed in January. The bon belongs to the
  // old year's books, and it must not follow the pass that happened to pick it up.
  const oudejaarsavond = {
    documentKind: "receipt" as const,
    suggestion: { suggestPaid: true, paidMethod: "kas" as const, paidMethodZeker: true, paidDate: "2026-12-31" },
    invoiceDate: "2026-12-31",
    totalIncBtw: 12.1,
  }
  const before = planReceiptSettlement({ ...oudejaarsavond, today: "2026-12-31" })
  const after = planReceiptSettlement({ ...oudejaarsavond, today: "2027-01-02" })
  assert.equal(before.settle, true)
  assert.equal(after.payDate, "2026-12-31", "the kasboek line stays in the year the money moved")
  assert.deepEqual(after, before)
})

test("[ONTVANGEN-WANNEER] a bon with no usable date HOLDS — it is never dated with today", () => {
  // The hole the tests above left open, found by mutating `pickPayDate(...) ?? input.today` in and
  // watching nothing go red: every other case here supplies a date, so a fallback to the clock
  // would never have fired. That fallback is the whole failure mode this file exists for — it
  // would put a cash line in the kasboek on the day OUR QUEUE reached the bon, and the later we
  // were, the further the money moved from when it actually moved.
  const undatable = {
    documentKind: "receipt" as const,
    suggestion: { suggestPaid: true, paidMethod: "kas" as const, paidMethodZeker: true, paidDate: null },
    invoiceDate: null,
    totalIncBtw: 9.5,
  }
  const plan = planReceiptSettlement({ ...undatable, today: "2026-09-18" })
  assert.equal(plan.settle, false, "an undatable bon must wait for a human, not borrow today")
  assert.equal(plan.payDate, null)
  assert.equal(plan.reason, "no_usable_date", "…and say which of the holds this is")

  // And it holds identically whenever it is processed: the refusal is not a race either.
  for (const day of ["2026-09-19", "2026-10-01", "2027-01-02"]) {
    assert.deepEqual(planReceiptSettlement({ ...undatable, today: day }), plan)
  }
})
