// [MERGE-SCHEME] Pure node test — run: npx tsx --test src/lib/kas-payment-events-fetch.test.ts
//
// mergeSchemeOpts exists BECAUSE it was got wrong. Its own header records it: three call sites
// combined the caller's per-invoice maps with the ones the kasstelsel read for the settled
// quarter, and two of the three OVERWROTE instead of merging. compute-result-range had it right;
// /api/aangifte overwrote exemptShareByInvoice one line below a comment explaining why merging was
// necessary, and /api/readiness overwrote both.
//
// What that costs is not a rounding difference. An invoice whose exempt share lives only in the
// map that was thrown away counts as 0% exempt, so the whole settlement is declared as TAXED
// turnover: the owner pays BTW on exempt omzet, on a filed aangifte, and nothing anywhere
// contradicts itself.
//
// So the function became the one place that cannot be half-applied — and then had no test. This
// is that test. It is small on purpose: the value is not in covering many shapes, it is in pinning
// the two properties that were violated (nothing is dropped; the precedence is stated) and the one
// that keeps it deploy-safe (absent stays absent).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSchemeOpts, resolveSchemeSettlements } from './kas-payment-events-fetch'
import type { ComputeOpts } from './financial-result'
import { makeFakeDb, type Failure, type Row } from '../../tests/support/package-fake-db'
import { failRead } from '../../tests/support/package-sources'
import { OWNER, quarterTables, kasExemptQuarter } from '../../tests/support/package-quarter'

const opts = (o: Partial<ComputeOpts> = {}): ComputeOpts => o as ComputeOpts

test('[MERGE-SCHEME] the defect itself: an invoice known to only ONE side survives', () => {
  // The exact shape that produced a wrong aangifte. The caller read invoice A in its date range;
  // the kasstelsel read invoice B as settled in the quarter. Overwriting keeps one and files the
  // other as fully taxed.
  const merged = mergeSchemeOpts(
    opts({ exemptShareByInvoice: new Map([['A', 1]]) }),
    { exemptShareByInvoice: new Map([['B', 0.4]]) },
  )
  assert.equal(merged.exemptShareByInvoice!.get('A'), 1, 'the caller-side invoice may not be lost')
  assert.equal(merged.exemptShareByInvoice!.get('B'), 0.4, 'nor the settled-side one')
  assert.equal(merged.exemptShareByInvoice!.size, 2)
})

test('[MERGE-SCHEME] all THREE maps merge — the half-applied fix is the trap', () => {
  // /api/aangifte merged rateShares and overwrote exemptShare. Getting two of three right reads
  // as done and is wrong on the third, so each is asserted by name.
  const merged = mergeSchemeOpts(
    opts({
      rateSharesByInvoice: new Map([['A', [{ rate: 21, ex: 100, btw: 21 }]]]),
      exemptShareByInvoice: new Map([['A', 0]]),
      deductionByInvoice: new Map([['A', 'direct_taxed']]),
    }),
    {
      rateSharesByInvoice: new Map([['B', [{ rate: 9, ex: 100, btw: 9 }]]]),
      exemptShareByInvoice: new Map([['B', 1]]),
      deductionByInvoice: new Map([['B', 'direct_exempt']]),
    },
  )
  assert.equal(merged.rateSharesByInvoice!.size, 2)
  assert.equal(merged.exemptShareByInvoice!.size, 2)
  assert.equal(merged.deductionByInvoice!.size, 2)
  assert.equal(merged.deductionByInvoice!.get('B'), 'direct_exempt')
})

test('[MERGE-SCHEME] where both know an invoice, the SCHEME-RESOLVED value wins', () => {
  // Pinned because the source comment claimed the opposite. It said "the caller's own map goes
  // LAST", while `opts` is spread FIRST and a Map keeps the last value for a repeated key — so the
  // local, scheme-resolved map wins. That is the defensible order (it is the read for the invoices
  // actually SETTLED in this quarter, the more specific fact), and the comment now says so.
  //
  // On the one function that exists so this cannot be got wrong, a comment describing the reverse
  // of the behaviour is the next version of the bug: a reader who trusts it and "restores" the
  // order flips exempt shares on a filed quarter, silently.
  const merged = mergeSchemeOpts(
    opts({ exemptShareByInvoice: new Map([['A', 0.25]]) }),
    { exemptShareByInvoice: new Map([['A', 0.9]]) },
  )
  assert.equal(merged.exemptShareByInvoice!.get('A'), 0.9)
})

test('[MERGE-SCHEME] absent stays absent — a map that exists is a claim', () => {
  // Deploy-safety. An empty Map where the app expected undefined says "I read this and found
  // nothing", which is a different statement from "this could not be read". financial-result
  // treats a present map as authoritative.
  const bare = mergeSchemeOpts(opts(), {})
  assert.equal(bare.rateSharesByInvoice, undefined)
  assert.equal(bare.exemptShareByInvoice, undefined)
  assert.equal(bare.deductionByInvoice, undefined)

  // …and one side alone is enough to make it present.
  const one = mergeSchemeOpts(opts(), { exemptShareByInvoice: new Map([['A', 1]]) })
  assert.equal(one.exemptShareByInvoice!.size, 1)
  assert.equal(one.rateSharesByInvoice, undefined, 'the other two are still untouched')
})

test('[MERGE-SCHEME] the inputs are not mutated', () => {
  // The caller keeps using its own opts after this call. A merge that wrote into the argument
  // would leak the settled quarter's data into a later, unrelated computation.
  const callerMap = new Map([['A', 1]])
  const localMap = new Map([['B', 0.5]])
  mergeSchemeOpts(opts({ exemptShareByInvoice: callerMap }), { exemptShareByInvoice: localMap })
  assert.equal(callerMap.size, 1, 'the caller map must be untouched')
  assert.equal(localMap.size, 1, 'and so must the local one')
})

test('[MERGE-SCHEME] every other option travels through unchanged', () => {
  // It returns ComputeOpts, so anything it does not merge it must carry. Dropping a field here
  // would silently change what financial-result computes.
  const merged = mergeSchemeOpts(
    opts({ scheme: 'kas', korActive: true } as Partial<ComputeOpts>),
    { exemptShareByInvoice: new Map([['A', 1]]) },
  ) as ComputeOpts & { scheme?: string; korActive?: boolean }
  assert.equal(merged.scheme, 'kas')
  assert.equal(merged.korActive, true)
})

// ── [SCHEME-DEGRADED] What the resolver could not read for the invoices a quarter SETTLES ──────────
//
// Under the kasstelsel the quarter's BTW follows the money, so it includes invoices dated in an
// earlier quarter and paid in this one. Their rate mix (fetchRateShares) and, under the exempt
// regime, their cost attribution (fetchVatDeductions) are read HERE and nowhere else — and both
// helpers degrade instead of throwing: a failed read falls back to the header-derived rate and to
// pro-rata. The resolver used to drop that flag, so every consumer computed the settled figures on a
// fallback without knowing it. It now says so in `degraded`. It computes nothing differently.

async function resolveQ1(tables: Record<string, Row[]>, failures: Failure[], exemptRegime: boolean) {
  const db = makeFakeDb(tables, { failures })
  const e = console.error, w = console.warn
  console.error = () => {}; console.warn = () => {}
  try {
    return await resolveSchemeSettlements(db.client as never, OWNER, '2026-01-01', '2026-01-01', '2026-03-31', exemptRegime)
  } finally { console.error = e; console.warn = w }
}

test('[SCHEME-DEGRADED] a settled invoice whose rate mix or attribution was not read is named, not silently priced', async () => {
  const read = await resolveQ1(kasExemptQuarter(), [], true)
  assert.equal(read.scheme, 'kas')
  assert.deepEqual(read.degraded, [], 'everything read: nothing to report')

  const noRateMix = await resolveQ1(kasExemptQuarter(), [failRead('settled_rate_split')], true)
  assert.deepEqual(noRateMix.degraded, ['rate_split'])

  const noAttribution = await resolveQ1(kasExemptQuarter(), [failRead('settled_vat_deductions')], true)
  assert.deepEqual(noAttribution.degraded, ['vat_deduction'])

  const thrown = await resolveQ1(kasExemptQuarter(), [failRead('settled_rate_split', 'throw'), failRead('settled_vat_deductions', 'throw')], true)
  assert.deepEqual(thrown.degraded, ['rate_split', 'vat_deduction'])

  // The flag is a statement about the inputs; the settlements themselves are the same either way.
  assert.deepEqual(noRateMix.opts.settlements, read.opts.settlements)
  assert.deepEqual(noAttribution.opts.settlements, read.opts.settlements)
})

test('[SCHEME-DEGRADED] under factuur there is nothing settled to degrade', async () => {
  const factuur = await resolveQ1(quarterTables(), [failRead('settled_rate_split')], false)
  assert.equal(factuur.scheme, 'factuur')
  assert.deepEqual(factuur.degraded, [])
})
