// [LEVERANCIER-SAMENVOEGEN] Pure node test — run: npx tsx --test src/lib/supplier-merge.test.ts
//
// The pair that decided this module's shape is real and is in this repo already: an invoice from
// BALKIP B.V. — own letterhead, own KVK, own IBAN, sent from info@balkip.nl — was imported as
// "GROOTHANDEL M.H. BAL V.O.F." (see vendor-grounding.ts). Two names that read like one family,
// two companies. Every refusal below exists so that pair can never be offered.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planSupplierMerge, planOwnerMerge, findMergeCandidates, type MergeSupplier } from './supplier-merge'

const KVK_BAL = '17123456'
const KVK_BALKIP = '34129873'
const IBAN_BAL = 'NL20ABNA0458266515'
const IBAN_KETELS = 'NL89RABO0131703501'
const IBAN_OTHER = 'NL73INGB0107197480'

const supplier = (over: Partial<MergeSupplier> & { id: string }): MergeSupplier => ({
  name: 'Leverancier', invoiceCount: 0, ...over,
})

test('[LEVERANCIER-SAMENVOEGEN] two Chamber-of-Commerce numbers are two companies, whatever else agrees', () => {
  // The real pair. Even sharing an account would not make them one: a company IS its registration.
  const bal = supplier({ id: 'bal', name: 'GROOTHANDEL M.H. BAL V.O.F.', kvk: KVK_BAL, invoiceCount: 72 })
  const balkip = supplier({ id: 'balkip', name: 'BALKIP B.V.', kvk: KVK_BALKIP, invoiceCount: 7 })
  assert.deepEqual(planSupplierMerge(bal, balkip), { ok: false, reason: 'different-kvk' })

  // …and the veto outranks a shared account, which is the whole point of asking it first.
  const balShared = { ...bal, invoiceIbans: [IBAN_BAL] }
  const balkipShared = { ...balkip, invoiceIbans: [IBAN_BAL] }
  assert.deepEqual(planSupplierMerge(balShared, balkipShared), { ok: false, reason: 'different-kvk' })
  assert.deepEqual(findMergeCandidates([balShared, balkipShared]), [], 'and it is never even offered')
})

test('[LEVERANCIER-SAMENVOEGEN] a shared KVK is one company, and the bigger name survives', () => {
  const many = supplier({ id: 'a', name: 'W.KETELS & ZN EIERHANDEL', kvk: KVK_BAL, invoiceCount: 25 })
  const few = supplier({ id: 'b', name: 'W. Ketels en Zoon Eierhandel', kvk: `  ${KVK_BAL}  `, invoiceCount: 3 })
  const plan = planSupplierMerge(many, few)
  assert.ok(plan.ok, JSON.stringify(plan))
  if (!plan.ok) return
  assert.equal(plan.survivorId, 'a', 'the row the owner has seen 25 times keeps its name')
  assert.equal(plan.mergedAwayId, 'b')
  assert.equal(plan.survivorName, 'W.KETELS & ZN EIERHANDEL')
  assert.equal(plan.evidence, 'kvk')
  assert.equal(plan.sharedValue, KVK_BAL, 'the proof is shown, not just claimed')
  assert.equal(plan.movesInvoices, 3)

  // The order the two arrive in must not change the answer: the owner is shown this name before
  // confirming and must not be shown another one after.
  const mirrored = planSupplierMerge(few, many)
  assert.deepEqual(mirrored, plan)
})

test('[LEVERANCIER-SAMENVOEGEN] a shared account is one company too, and the invoices carry it', () => {
  // suppliers has a UNIQUE (user_id, iban), so two rows can never both hold the same account.
  // What proves it is the paper: both rows' invoices were billed from the same IBAN.
  const a = supplier({ id: 'a', name: 'Sligro Food Group', invoiceCount: 9, invoiceIbans: [IBAN_KETELS, IBAN_OTHER] })
  const b = supplier({ id: 'b', name: 'SLIGRO FOODGROUP NEDERLAND', invoiceCount: 2, invoiceIbans: [IBAN_KETELS] })
  const plan = planSupplierMerge(a, b)
  assert.ok(plan.ok, JSON.stringify(plan))
  if (!plan.ok) return
  assert.equal(plan.evidence, 'iban')
  assert.equal(plan.sharedValue, IBAN_KETELS)
  assert.equal(plan.survivorId, 'a')

  // One row's own account against the other's invoices is the same proof.
  const own = supplier({ id: 'c', name: 'Sligro', iban: IBAN_KETELS, invoiceCount: 1 })
  const viaPaper = supplier({ id: 'd', name: 'Sligro B.V.', invoiceCount: 4, invoiceIbans: [IBAN_KETELS] })
  const second = planSupplierMerge(own, viaPaper)
  assert.ok(second.ok && second.evidence === 'iban', JSON.stringify(second))
})

test('[LEVERANCIER-SAMENVOEGEN] each row naming its own account is a refusal, not a coin toss', () => {
  // Merging would keep one account and drop the other — and suppliers.iban is what the
  // IBAN-change check compares next month's invoice against. Every genuine invoice on the dropped
  // account would then read as a redirected payment.
  const a = supplier({ id: 'a', name: 'Groothandel', kvk: KVK_BAL, iban: IBAN_BAL, invoiceCount: 5 })
  const b = supplier({ id: 'b', name: 'Groothandel VOF', kvk: KVK_BAL, iban: IBAN_OTHER, invoiceCount: 2 })
  assert.deepEqual(planSupplierMerge(a, b), { ok: false, reason: 'two-accounts' })

  // The same two accounts appearing in the INVOICE history is not a refusal: one company may be
  // paid on two accounts over the years, and history is not a claim about today.
  const c = supplier({ id: 'c', name: 'Groothandel', kvk: KVK_BAL, invoiceCount: 5, invoiceIbans: [IBAN_BAL] })
  const d = supplier({ id: 'd', name: 'Groothandel VOF', kvk: KVK_BAL, invoiceCount: 2, invoiceIbans: [IBAN_OTHER] })
  const plan = planSupplierMerge(c, d)
  assert.ok(plan.ok && plan.evidence === 'kvk', JSON.stringify(plan))
})

test('[LEVERANCIER-SAMENVOEGEN] a name is never evidence', () => {
  // Two spellings of what is obviously one company, with nothing to prove it. The module has no
  // opinion — which is the whole reason it is allowed to exist.
  const a = supplier({ id: 'a', name: 'CAN Vleesgroothandel B.V.', invoiceCount: 23 })
  const b = supplier({ id: 'b', name: 'CAN Vleesgroothandel', invoiceCount: 4 })
  assert.deepEqual(planSupplierMerge(a, b), { ok: false, reason: 'no-evidence' })
  assert.deepEqual(findMergeCandidates([a, b]), [])
})

test('[LEVERANCIER-SAMENVOEGEN] junk identifiers key nothing', () => {
  // A KVK is eight digits; an IBAN has a checksum. Half a number is not a smaller proof, it is
  // no proof — and a merge is the worst place in the app to accept a misread.
  const a = supplier({ id: 'a', name: 'A', kvk: '1234', invoiceCount: 3 })
  const b = supplier({ id: 'b', name: 'B', kvk: '1234', invoiceCount: 1 })
  assert.deepEqual(planSupplierMerge(a, b), { ok: false, reason: 'no-evidence' })

  const c = supplier({ id: 'c', name: 'C', invoiceCount: 3, invoiceIbans: ['NL00BANK0000000000'] })
  const d = supplier({ id: 'd', name: 'D', invoiceCount: 1, invoiceIbans: ['NL00BANK0000000000'] })
  assert.deepEqual(planSupplierMerge(c, d), { ok: false, reason: 'no-evidence' }, 'a failing checksum is not an account')

  // An empty string on both sides is not agreement either.
  const e = supplier({ id: 'e', name: 'E', kvk: '', iban: '', invoiceCount: 1 })
  const f = supplier({ id: 'f', name: 'F', kvk: null, iban: null, invoiceCount: 1 })
  assert.deepEqual(planSupplierMerge(e, f), { ok: false, reason: 'no-evidence' })
})

test('[LEVERANCIER-SAMENVOEGEN] a row cannot be merged with itself', () => {
  const a = supplier({ id: 'a', name: 'A', kvk: KVK_BAL })
  assert.deepEqual(planSupplierMerge(a, a), { ok: false, reason: 'same-supplier' })
  assert.deepEqual(planSupplierMerge(a, { ...a, name: 'Ander' }), { ok: false, reason: 'same-supplier' })
})

test('[LEVERANCIER-SAMENVOEGEN] the offer list never spends one row twice', () => {
  // Three rows of one company is two merges, and the second must be planned on what the first
  // left behind. Offering a—b and a—c at once would have the owner confirm two writes against a
  // state only one of them was planned against.
  const a = supplier({ id: 'a', name: 'A', kvk: KVK_BAL, invoiceCount: 10 })
  const b = supplier({ id: 'b', name: 'B', kvk: KVK_BAL, invoiceCount: 5 })
  const c = supplier({ id: 'c', name: 'C', kvk: KVK_BAL, invoiceCount: 1 })
  const offers = findMergeCandidates([a, b, c])
  assert.equal(offers.length, 1)
  assert.deepEqual([offers[0].survivorId, offers[0].mergedAwayId], ['a', 'b'])

  // Two unrelated pairs are both offered — the cap is per row, not per list.
  const x = supplier({ id: 'x', name: 'X', invoiceCount: 4, invoiceIbans: [IBAN_OTHER] })
  const y = supplier({ id: 'y', name: 'Y', invoiceCount: 2, invoiceIbans: [IBAN_OTHER] })
  const two = findMergeCandidates([a, b, x, y])
  assert.equal(two.length, 2)
  assert.deepEqual(two.map((p) => p.evidence), ['kvk', 'iban'])
})

test('[LEVERANCIER-SAMENVOEGEN] an empty island is still worth merging', () => {
  // A row with no invoices left (one earlier correction moved them) still catches next month's
  // import on its name key. Merging it stores the alias that stops that.
  const a = supplier({ id: 'a', name: 'A', kvk: KVK_BAL, invoiceCount: 6 })
  const empty = supplier({ id: 'b', name: 'B', kvk: KVK_BAL, invoiceCount: 0 })
  const plan = planSupplierMerge(a, empty)
  assert.ok(plan.ok, JSON.stringify(plan))
  if (!plan.ok) return
  assert.equal(plan.mergedAwayId, 'b')
  assert.equal(plan.movesInvoices, 0)
})

test('[LEVERANCIER-SAMENVOEGEN] equal invoice counts fall back to identity, then age, then id', () => {
  const older = supplier({ id: 'z', name: 'Older', kvk: KVK_BAL, invoiceCount: 3, createdAt: '2026-01-01T00:00:00Z' })
  const newer = supplier({ id: 'a', name: 'Newer', kvk: KVK_BAL, invoiceCount: 3, createdAt: '2026-06-01T00:00:00Z' })
  const byAge = planSupplierMerge(newer, older)
  assert.ok(byAge.ok && byAge.survivorId === 'z', 'the older row keeps the name')

  const rich = supplier({ id: 'r', name: 'Rich', kvk: KVK_BAL, btw: 'NL852244872B01', invoiceCount: 3, createdAt: '2026-06-01T00:00:00Z' })
  const bare = supplier({ id: 'b', name: 'Bare', kvk: KVK_BAL, invoiceCount: 3, createdAt: '2026-01-01T00:00:00Z' })
  const byIdentity = planSupplierMerge(bare, rich)
  assert.ok(byIdentity.ok && byIdentity.survivorId === 'r', 'more identity outranks being older')
})

// ── [SAMENVOEGEN-EIGENAAR] The pair the owner names themselves ────────────────────────────────
//
// The reader founds two rows for one company without leaving a shared number behind: a misread
// name on one paper and nothing else. There is then no proof to find, only an owner who knows.
// What their door gives up is the demand for evidence. What it may never give up is a VETO.

test('[SAMENVOEGEN-EIGENAAR] the owner may overrule missing evidence — that is the whole door', () => {
  const a = supplier({ id: 'a', name: 'Trimex International', invoiceCount: 29 })
  const b = supplier({ id: 'b', name: 'TRIMEX INTL B.V.', invoiceCount: 2 })
  // The app itself refuses: nothing here proves one party.
  assert.deepEqual(planSupplierMerge(a, b), { ok: false, reason: 'no-evidence' })
  // The owner names the pair, and the direction is theirs — not re-picked by invoice count.
  const plan = planOwnerMerge(b, a)
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal(plan.survivorId, 'b', 'the row the owner pointed at is the one that stays')
  assert.equal(plan.mergedAwayId, 'a')
  assert.equal(plan.evidence, 'owner', 'recorded as a decision, never dressed up as a fact')
  assert.equal(plan.sharedValue, '')
  assert.equal(plan.movesInvoices, 29, 'and it says how many invoices move before anything does')
})

test('[SAMENVOEGEN-EIGENAAR] a veto is a fact and holds whoever asks', () => {
  // The BALKIP pair, named by the owner this time. Still two companies.
  const bal = supplier({ id: 'bal', name: 'GROOTHANDEL M.H. BAL V.O.F.', kvk: KVK_BAL, invoiceCount: 72 })
  const balkip = supplier({ id: 'balkip', name: 'BALKIP B.V.', kvk: KVK_BALKIP, invoiceCount: 7 })
  assert.deepEqual(planOwnerMerge(bal, balkip), { ok: false, reason: 'different-kvk' })
  assert.deepEqual(planOwnerMerge(balkip, bal), { ok: false, reason: 'different-kvk' }, 'in either direction')

  // Two rows that each name their own account: merging drops the number the IBAN-change check reads.
  const one = supplier({ id: 'one', name: 'Sumer Food', iban: IBAN_BAL })
  const two = supplier({ id: 'two', name: 'Sumer Food B.V.', iban: IBAN_KETELS })
  assert.deepEqual(planOwnerMerge(one, two), { ok: false, reason: 'two-accounts' })

  // A row with itself is nothing to merge.
  assert.deepEqual(planOwnerMerge(one, one), { ok: false, reason: 'same-supplier' })
})

test('[SAMENVOEGEN-EIGENAAR] where a shared number DOES exist it is cited, not hidden behind the owner', () => {
  const a = supplier({ id: 'a', name: 'W.KETELS & ZN', kvk: KVK_BAL, invoiceCount: 25 })
  const b = supplier({ id: 'b', name: 'W. Ketels en Zoon', kvk: KVK_BAL, invoiceCount: 3 })
  const plan = planOwnerMerge(b, a)
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal(plan.evidence, 'kvk', 'the proof the app can see is still the proof it records')
  assert.equal(plan.sharedValue, KVK_BAL)
  assert.equal(plan.survivorId, 'b', '…and the owner still chooses which name stays')
})
