// scripts/gate-yield.ts
// [POORT-OPBRENGST] What does each gate actually catch?
// -----------------------------------------------------------------------------
// Run (env from .env.local):
//   npx tsx --env-file=.env.local scripts/gate-yield.ts
//   npx tsx --env-file=.env.local scripts/gate-yield.ts --days 365 --limit 5000
//
// Read-only. Writes nothing, changes nothing, sends nothing. Safe to run in
// production, and it is meant to be run there — that is where the answer lives.
//
// ── WHY THIS SCRIPT EXISTS ──
//
// Six things stand between a freshly-read purchase invoice and its own booking:
// the arithmetic, the model's confidence in itself, [GEGROND] (is the figure
// printed in the document's own characters), [DOCCHECK] (is it printed WHERE a
// total is printed), the printed BTW split, and the supplier's own e-invoice.
// Every one of them was added because a real invoice got through the ones before
// it. Every one of them also costs a human a look.
//
// Nobody in this project can currently answer: WHICH ONES STILL EARN THEIR KEEP?
// Two independent reviews of this codebase both put that question first and
// neither could answer it. That is the finding, not a step toward one — you
// cannot delete what you have not measured, and a gate nobody has measured is
// a gate nobody can defend.
//
// So this replays shouldAutoAdvanceInvoice over rows that already exist and
// reports, per gate, the number that matters:
//
//     HOW OFTEN WAS THIS GATE THE *ONLY* THING HOLDING THE INVOICE?
//
// Not how often it fired — that number flatters every gate, because gates
// overlap and a badly-read invoice trips four of them at once. The honest
// question is the marginal one: if this gate did not exist, how many invoices
// would have been booked without a human? A gate whose marginal yield is 0 over
// a year of real documents is not protecting anything. It is a tax on every
// import, paid in human attention, for a case that has not happened.
//
// ── AND WHAT IT DELIBERATELY DOES NOT DO ──
//
// It does not recommend deleting anything. A zero here is the START of that
// conversation, not the end of it: a gate can have zero yield because the risk
// is genuinely rare and catastrophic (the BTW-zero gate protects the
// voorbelasting, the one number this app exists to protect), or because the read
// is now good enough that it never triggers. Those two look identical in a
// count and could not be more different in consequence. The number tells you
// where to LOOK — exactly like reading-memory.ts does for the owner, and for the
// same reason.
// -----------------------------------------------------------------------------

import { createPipelineClient } from '@/lib/supabase-pipeline'
import { shouldAutoAdvanceInvoice, type AutoAdvanceSignals } from '@/lib/auto-advance'
import { placementOf, btwContradictionOf } from '@/lib/document-verify'
import { groundingOf } from '@/lib/amount-grounding'
import { eInvoiceContradictsRead, eInvoiceSettlesAmounts } from '@/lib/e-invoice'
import type { HealthInput } from '@/lib/import-health'

/** Every refusal shouldAutoAdvanceInvoice can return, with what it is really guarding. */
const GATES: Record<string, string> = {
  forced_duplicate: 'owner pushed past a duplicate warning',
  not_invoice: 'read as not an invoice',
  statement: 'a statement, not an invoice',
  reminder: 'a payment reminder',
  creditnota: 'a credit note',
  tax_letter: '[AANSLAG] a Belastingdienst letter — the owner decides where it books',
  kind_statement: 'document_kind = statement',
  kind_reminder: 'document_kind = reminder',
  kind_credit_note: 'document_kind = credit_note',
  kind_creditnota: 'document_kind = creditnota',
  no_reliable_total: 'no real gross — only the amount fallback',
  zero_btw_not_explicit_zero_rate: '[BTW-GATE] zero btw without an explicit 0% rate',
  foreign_currency: '[VREEMDE-VALUTA] the document is priced in another currency',
  self_billed: '[ZELFFACTUUR] the document says the customer drew it up',
  total_derived_never_grounded: '[ONGEGROND-AFGELEID] a derived gross the grounding gate never saw',
  total_not_in_document_text: '[GEGROND] the total is not printed in the document',
  total_not_where_a_total_is_printed: '[DOCCHECK] printed, but not where a total is',
  btw_contradicts_printed_split: '[DOCCHECK-SPLIT] the printed split differs from the read',
  e_invoice_contradicts_read: '[E-FACTUUR] the supplier says a different amount',
  overall_confidence_missing_or_low: 'overall confidence below 0.7',
  needs_review: 'import-health says needs-review',
  amount_confidence_below_high_bar: 'money confidence below 0.8',
  no_amount_confidence_and_overall_not_very_high: 'no money score and overall < 0.9',
  field_confidence_below_high_bar: 'vendor/number/date confidence below 0.8',
}

/**
 * Refusals that depend on the overall AI confidence, which is not persisted (see signalsOf).
 * They cannot be replayed and must never appear as a yield — a gate this script cannot see is
 * not a gate that did nothing.
 */
const UNMEASURABLE = new Set([
  'overall_confidence_missing_or_low',
  'no_amount_confidence_and_overall_not_very_high',
])

/** The row shape this needs. Anything absent reads as "the check did not run". */
interface Row {
  id: string
  status: string | null
  invoice_date: string | null
  invoice_number: string | null
  invoice_type: string | null
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
  field_confidence: unknown
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Rebuild the signals the reader passed at import time, from what was stored.
 *
 * The kind flags (is_statement / is_reminder / …) live inside field_confidence on some paths and
 * not others; anything we cannot recover is left undefined, which those gates treat as "did not
 * run" and never as "failed". So the replay UNDER-counts the kind gates rather than inventing
 * refusals for them — and it says so in the output, because a measurement that quietly guesses is
 * worse than no measurement.
 */
function signalsOf(row: Row): AutoAdvanceSignals {
  const fc = (row.field_confidence ?? null) as HealthInput['field_confidence']
  const raw = (row.field_confidence ?? {}) as Record<string, unknown>

  // ── [NIET-HERSPEELBAAR] The overall AI confidence is NOT stored anywhere ──
  //
  // The real caller passes `confidence: classification.confidence` straight from the classifier's
  // return value; it never reaches the database. There is no `confidence` column on invoices and
  // no such key inside field_confidence — only the PER-FIELD scores are persisted.
  //
  // The first version of this script read it from field_confidence anyway, got null on every row,
  // and shouldAutoAdvanceInvoice is fail-closed on a missing overall confidence. The result was a
  // report claiming 404 of 512 invoices (78.9%) were held by 'overall_confidence_missing_or_low'
  // and that NOTHING in the administration would ever auto-book. Both were artefacts of this file.
  //
  // A measurement that invents its own top finding is worse than no measurement. So the value is
  // pinned above every threshold here, which lets the gates that CAN be replayed — the ones built
  // on stored document evidence, which is what this script exists to weigh — be measured honestly.
  // The confidence gates are then reported separately as unmeasurable rather than as findings.
  return {
    invoice_type: row.invoice_type,
    confidence: 1,
    totalIncBtw: row.total_inc_btw,
    btwRate: typeof raw.btw_rate === 'number' ? raw.btw_rate : null,
    totalGrounding: groundingOf(fc) ?? null,
    totalPlacement: placementOf(fc) ?? null,
    btwContradictsDocument: btwContradictionOf(fc),
    eInvoiceContradicts: eInvoiceContradictsRead(fc),
    health: {
      total_ex_btw: row.total_ex_btw,
      btw_amount: row.btw_amount,
      total_inc_btw: row.total_inc_btw,
      invoice_date: row.invoice_date,
      invoice_number: row.invoice_number,
      invoice_type: row.invoice_type,
      field_confidence: fc,
    },
  }
}

async function main() {
  const days = arg('days', 365)
  const limit = arg('limit', 5000)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const pipeline = createPipelineClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (pipeline as any)
    .from('invoices')
    .select('id, status, invoice_date, invoice_number, invoice_type, total_ex_btw, btw_amount, total_inc_btw, field_confidence, created_at')
    .eq('direction', 'incoming')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[POORT-OPBRENGST] could not read invoices:', error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as Row[]
  if (rows.length === 0) {
    console.log(`\nNo incoming invoices in the last ${days} days. Nothing to measure — and that is\nan answer too: no gate can have earned anything yet.\n`)
    return
  }

  // firstRefusal — the gate that actually held this invoice. This is the marginal number.
  const firstRefusal = new Map<string, number>()
  // alsoWouldHave — gates that would have refused it too, had the first not. Overlap, not yield.
  const alsoWouldHave = new Map<string, number>()
  let advanced = 0
  let settledByEInvoice = 0

  for (const row of rows) {
    const s = signalsOf(row)
    const d = shouldAutoAdvanceInvoice(s)
    if (eInvoiceSettlesAmounts(row.field_confidence)) settledByEInvoice += 1

    if (d.advance) {
      advanced += 1
      continue
    }
    if (UNMEASURABLE.has(d.reason)) continue
    firstRefusal.set(d.reason, (firstRefusal.get(d.reason) ?? 0) + 1)

    // Which OTHER gates would have caught it. Re-run with this refusal's cause neutralised, as
    // far as a single field allows — enough to show overlap without pretending to be exact.
    const relaxed: AutoAdvanceSignals = { ...s }
    if (d.reason === 'total_not_in_document_text') relaxed.totalGrounding = 'unreadable'
    else if (d.reason === 'total_not_where_a_total_is_printed') relaxed.totalPlacement = 'unreadable'
    else if (d.reason === 'btw_contradicts_printed_split') relaxed.btwContradictsDocument = false
    else if (d.reason === 'e_invoice_contradicts_read') relaxed.eInvoiceContradicts = false
    else continue
    const second = shouldAutoAdvanceInvoice(relaxed)
    if (!second.advance) alsoWouldHave.set(second.reason, (alsoWouldHave.get(second.reason) ?? 0) + 1)
  }

  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`

  console.log(`\n══ [POORT-OPBRENGST] ${rows.length} incoming invoices, last ${days} days ══\n`)
  console.log(`  cleared every gate this can replay ${String(advanced).padStart(5)}  ${pct(advanced)}`)
  console.log(`  held by a replayable gate          ${String(rows.length - advanced).padStart(5)}  ${pct(rows.length - advanced)}`)
  console.log(`  carried a settling e-invoice       ${String(settledByEInvoice).padStart(5)}  ${pct(settledByEInvoice)}`)
  console.log(``)
  console.log(`  NOT "would auto-book": the overall AI confidence is not stored, so the confidence`)
  console.log(`  gates cannot be replayed and are pinned open here. This measures the gates built on`)
  console.log(`  stored document evidence — which is what the question was.`)

  console.log(`\n── The number that matters: how often was this gate the ONLY thing holding it ──\n`)
  const ranked = [...firstRefusal.entries()].sort((a, b) => b[1] - a[1])
  for (const [reason, n] of ranked) {
    console.log(`  ${String(n).padStart(5)}  ${pct(n).padStart(6)}  ${reason}`)
    console.log(`         ${GATES[reason] ?? '(unknown reason — a gate was added without updating this script)'}`)
  }

  const never = Object.keys(GATES).filter((g) => !firstRefusal.has(g) && !UNMEASURABLE.has(g))
  if (never.length > 0) {
    console.log(`\n── Never the only thing holding an invoice, in this window ──\n`)
    for (const g of never) console.log(`         ${g}\n           ${GATES[g]}`)
    console.log(`\n  Zero is where the conversation STARTS. A gate can be at zero because the risk`)
    console.log(`  is rare and catastrophic, or because it no longer does anything. Those look`)
    console.log(`  identical here and could not be more different in consequence.`)
  }

  if (alsoWouldHave.size > 0) {
    console.log(`\n── Overlap: what would have caught it anyway, had the first gate not ──\n`)
    for (const [reason, n] of [...alsoWouldHave.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}          ${reason}`)
    }
  }

  console.log(`\n── Cannot be measured from a stored row, and therefore not judged ──\n`)
  for (const g of UNMEASURABLE) console.log(`         ${g}\n           ${GATES[g]}`)
  console.log(`\n  The overall AI confidence lives only in memory at import time. Whether these gates`)
  console.log(`  earn their keep is a real question; this script is simply not the instrument that`)
  console.log(`  can answer it — but from 01-09-2026 another one is. [WAAROM-VASTGEHOUDEN] stores the`)
  console.log(`  REFUSAL ITSELF on the row (field_confidence._auto_hold.reason), so the two confidence`)
  console.log(`  gates are now countable from the moment they fire, without a replay and without the`)
  console.log(`  score. See the "Waarom kost dit handwerk" panel on /dashboard/beheer. Rows imported`)
  console.log(`  before that date carry no reason and are counted apart there, never guessed at.`)

  console.log(`\n  Caveat, stated rather than hidden: the document-KIND flags (statement / reminder /`)
  console.log(`  credit note) are not all recoverable from a stored row, so their gates are`)
  console.log(`  under-counted here. Every money gate — the ones this measurement is for — is`)
  console.log(`  replayed exactly as it ran.\n`)
}

main().catch((e) => {
  console.error('[POORT-OPBRENGST] failed:', e)
  process.exit(1)
})
