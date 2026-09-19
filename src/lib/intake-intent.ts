// src/lib/intake-intent.ts
// [ONTVANGEN] What the owner said at the moment they handed the file over.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────
//
// The Kas screen can upload a receipt the owner ALREADY paid in cash. Its button sends
// paid_method (and sometimes paid_date), and that choice decides whether the receipt settles
// through the kas or the bank — cash-settle looks literally for payment_method = 'kas'. It is
// financial behaviour, not a preference.
//
// Until #129 the processor read those two straight off the FormData, because it ran inside the
// same request the browser made. Receive-first ends that: by the time the reading happens the
// browser is gone and the answer has to come from the documents row instead.
//
// Two sources, therefore — and exactly one MEANING. That is what this module is for. If the form
// reader and the durable reader were written separately, they would drift: one would accept "pin"
// and the other would not, or one would treat an empty string as a choice. The owner would then
// get a different booking depending on whether their tab stayed open, which is the one difference
// receive-first must never introduce.
//
// ── WHAT IS NORMALISED, AND WHERE ────────────────────────────────────────────────────────────
//
// The UI may say "pin", "contant" or "creditcard"; normaliseerBetaalwijze turns those into the
// canonical bank|kas that the rest of the app reads. That happens HERE, on the way in, so the
// value that reaches storage is already the one a booking can act on — and the CHECK constraint
// on documents.intake_paid_method can be the narrow one it is.

import { normaliseerBetaalwijze } from "@/lib/bon-betaalwijze"

/** The canonical pair. Both fields are optional intent: null means "the owner said nothing". */
export interface IntakeIntent {
  /** Already normalised to bank|kas. Never "pin", never "", never a third value. */
  paidMethod: "bank" | "kas" | null
  /** ISO yyyy-mm-dd, or null. */
  paidDate: string | null
}

/** Nothing was said. A named value, so the three places that mean it cannot each invent their own. */
export const NO_INTENT: IntakeIntent = { paidMethod: null, paidDate: null }

/**
 * A date is only intent when it is a date.
 *
 * The form field is free text from a browser, so it is checked here; the durable column is a
 * postgres `date` and cannot hold anything else, but it is checked on that path too — the cost is
 * one regex and the alternative is trusting that nobody ever widens the column.
 */
function isoDateOrNull(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

/**
 * The browser's answer, from the upload form.
 *
 * Takes the narrow shape rather than FormData itself so it can be called with anything that
 * answers `get` — which is what the durable side of the test does to prove the two agree.
 */
export function readIntentFromForm(form: { get(name: string): unknown }): IntakeIntent {
  const rawMethod = form.get("paid_method")
  return {
    paidMethod: typeof rawMethod === "string" ? normaliseerBetaalwijze(rawMethod) : null,
    paidDate: isoDateOrNull(form.get("paid_date")),
  }
}

/**
 * The same answer, read back from the document row that survived the handoff.
 *
 * A method that is not one of the two canonical values is treated as no choice at all rather than
 * passed on. Guessing what a stray value meant is how a receipt settles through the wrong ledger.
 */
export function intentFromStoredDocument(row: {
  intake_paid_method?: string | null
  intake_paid_date?: string | null
}): IntakeIntent {
  const stored = row.intake_paid_method
  return {
    paidMethod: stored === "bank" || stored === "kas" ? stored : null,
    paidDate: isoDateOrNull(row.intake_paid_date),
  }
}

/** The columns to write, in the shape the documents insert takes. Omits what was never chosen. */
export function intentColumns(intent: IntakeIntent): {
  intake_paid_method?: "bank" | "kas"
  intake_paid_date?: string
} {
  return {
    ...(intent.paidMethod ? { intake_paid_method: intent.paidMethod } : {}),
    ...(intent.paidDate ? { intake_paid_date: intent.paidDate } : {}),
  }
}
