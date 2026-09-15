// src/lib/supplier-merge.ts
// [LEVERANCIER-SAMENVOEGEN] When are two supplier rows one company — and when are they two?
//
// ── WHY THIS DOOR HAD TO BE GUARDED BEFORE IT WAS BUILT ──
//
// The registry, the aliases and the name picker all fix the FUTURE: the next invoice from a
// company the owner has already corrected resolves to the right row. None of them touches the
// PAST. Two rows that already exist for one company stay two, /dashboard/leveranciers draws two
// lines, and the outstanding balance is split between the halves.
//
// So a merge door is a real gap. It is also the most dangerous door in this module, because the
// mistake it can make is not "untidy" — it is a crediteurenstand for a legal entity that does not
// exist, and a BTW return built on it.
//
// The case that decided the guard is in this repo already. From vendor-grounding.ts: an invoice
// from BALKIP B.V. — its own letterhead, its own KVK, its own IBAN, sent from info@balkip.nl —
// was imported as "GROOTHANDEL M.H. BAL V.O.F.". Two names that look like one family and are two
// companies. A merge offered on NAME SIMILARITY would have offered exactly that pair, and it is
// the one pair that must never be offered.
//
// Hence: this module never looks at names. A merge is proposed only on an identifier that IS the
// company — the KVK number, or the bank account its invoices are billed from.
//
// ── THE FOUR ANSWERS ──
//
//   different-kvk   two Chamber-of-Commerce numbers are two legal entities. An absolute veto: it
//                   outranks every other kind of evidence, because nothing can make two registry
//                   numbers one company.
//   two-accounts    each row names its OWN bank account. Merging would keep one and drop the
//                   other, and suppliers.iban is what the IBAN-change check compares next month's
//                   invoice against — so the dropped account would make every genuine invoice on
//                   it look like a redirected payment. The owner can clear one and come back.
//   no-evidence     nothing here PROVES one party. Two rows that merely read alike are the
//                   BALKIP case, and this module has no opinion about them.
//   ok              a shared KVK, or a shared account. Both are the company itself.
//
// Pure — no I/O. The server does the reads and re-runs this on what it read, never on what a
// browser claimed. Run: npx tsx --test src/lib/supplier-merge.test.ts

// [ÉÉN-LEVERANCIERSSLEUTEL] The registry's own normalizers, not second copies of them. identityIban
// is identity and not merely shape: a misread account number keys nothing, and keying a MERGE on a
// misread would be the worst place in the app to accept one.
import { identityIban, normalizeKvk } from '@/lib/supplier-registry'

/** One supplier row, plus what its invoices say about who it is. */
export interface MergeSupplier {
  id: string
  name: string
  iban?: string | null
  kvk?: string | null
  btw?: string | null
  /** ISO timestamp. Only a tie-breaker — never evidence. */
  createdAt?: string | null
  /** How many invoices point at this row. Decides which NAME the owner keeps. */
  invoiceCount?: number
  /**
   * Every account this row's invoices were billed FROM (invoices.vendor_iban).
   *
   * Needed because suppliers has a unique index on (user_id, iban): two rows can never carry the
   * same account, so suppliers.iban alone can prove a shared account only when one side is empty.
   * The invoices remember what the paper printed, and that is the same field the import resolves
   * identity on in the first place.
   */
  invoiceIbans?: readonly string[]
}

export type MergeRefusal = 'same-supplier' | 'different-kvk' | 'two-accounts' | 'no-evidence'

/**
 * What made this pair one company. Never a name.
 *
 * 'owner': the owner named the pair themselves (planOwnerMerge). Not a fact the app found — a
 * decision the app was told, and the trail records it as that.
 */
export type MergeEvidence = 'kvk' | 'iban' | 'owner'

export type MergePlan =
  | {
      ok: true
      survivorId: string
      mergedAwayId: string
      /** The name every moved invoice will carry afterwards. Shown before anything is written. */
      survivorName: string
      /** The name that disappears — kept as an alias, so next month's paper still resolves. */
      mergedAwayName: string
      evidence: MergeEvidence
      /** The KVK or the IBAN itself, so the owner checks the proof instead of trusting the app. */
      sharedValue: string
      /** How many invoices move. Zero is legitimate: an empty island is still an island. */
      movesInvoices: number
    }
  | { ok: false; reason: MergeRefusal }

/** Every account this row can be shown to bill from: its own, plus its invoices'. Validated. */
function accountsOf(s: MergeSupplier): Set<string> {
  const out = new Set<string>()
  const own = identityIban(s.iban)
  if (own) out.add(own)
  for (const raw of s.invoiceIbans ?? []) {
    const one = identityIban(raw)
    if (one) out.add(one)
  }
  return out
}

/** How much identity a row carries. Only a tie-breaker for which name survives. */
function identityWeight(s: MergeSupplier): number {
  return (identityIban(s.iban) ? 1 : 0) + (normalizeKvk(s.kvk) ? 1 : 0) + ((s.btw ?? '').trim() ? 1 : 0)
}

/**
 * Which row keeps its name, and which becomes an alias of it.
 *
 * The one carrying MORE invoices wins: it is the name the owner has seen most, and it is the
 * choice that rewrites the fewest rows. Then more identity, then the older row, then the id — so
 * the answer is the same every time it is asked, which matters because the owner is shown this
 * name before they confirm and must not be shown a different one after.
 */
function pickSurvivor(a: MergeSupplier, b: MergeSupplier): [MergeSupplier, MergeSupplier] {
  const ac = a.invoiceCount ?? 0
  const bc = b.invoiceCount ?? 0
  if (ac !== bc) return ac > bc ? [a, b] : [b, a]
  const aw = identityWeight(a)
  const bw = identityWeight(b)
  if (aw !== bw) return aw > bw ? [a, b] : [b, a]
  const at = a.createdAt ?? ''
  const bt = b.createdAt ?? ''
  if (at !== bt) return at < bt ? [a, b] : [b, a]
  return a.id <= b.id ? [a, b] : [b, a]
}

/**
 * May these two rows become one, and if so which way round?
 *
 * The order of the checks is the whole safety argument: the vetoes are asked BEFORE the evidence,
 * so no amount of agreement elsewhere can talk the answer past a fact that settles it.
 */
export function planSupplierMerge(a: MergeSupplier, b: MergeSupplier): MergePlan {
  if (!a?.id || !b?.id || a.id === b.id) return { ok: false, reason: 'same-supplier' }

  // ── Veto 1: two Chamber-of-Commerce numbers are two legal entities ──
  // Absolute, and first. This is the BALKIP B.V. / GROOTHANDEL M.H. BAL V.O.F. answer: whatever
  // else the two rows have in common, a company is its registration, and there are two of them.
  const kvkA = normalizeKvk(a.kvk)
  const kvkB = normalizeKvk(b.kvk)
  if (kvkA && kvkB && kvkA !== kvkB) return { ok: false, reason: 'different-kvk' }

  // ── Veto 2: each row names its own account ──
  // suppliers.iban is what the IBAN-change check reads. Merging would keep one and silently drop
  // the other, and every genuine invoice on the dropped account would then read as a redirected
  // payment — which is how an owner learns to click that warning away. Only the rows' OWN accounts
  // veto; the invoices' accounts are history, and one company may well be paid on two over time.
  const ibanA = identityIban(a.iban)
  const ibanB = identityIban(b.iban)
  if (ibanA && ibanB && ibanA !== ibanB) return { ok: false, reason: 'two-accounts' }

  // ── Evidence, strongest first ──
  const [survivor, mergedAway] = pickSurvivor(a, b)
  const base = {
    ok: true as const,
    survivorId: survivor.id,
    mergedAwayId: mergedAway.id,
    survivorName: survivor.name,
    mergedAwayName: mergedAway.name,
    movesInvoices: mergedAway.invoiceCount ?? 0,
  }
  if (kvkA && kvkB && kvkA === kvkB) return { ...base, evidence: 'kvk', sharedValue: kvkA }

  const shared = [...accountsOf(a)].filter((one) => accountsOf(b).has(one)).sort()
  if (shared.length > 0) return { ...base, evidence: 'iban', sharedValue: shared[0] }

  // Nothing proves one party. Two rows that merely read alike are exactly the pair this module
  // exists to refuse.
  return { ok: false, reason: 'no-evidence' }
}

/**
 * [SAMENVOEGEN-EIGENAAR] A pair the OWNER named, in the direction they chose.
 *
 * The app offers only pairs it can prove (findMergeCandidates). But the reader does found two rows
 * for one company without leaving a shared number behind — a misread name on one paper, nothing
 * else — and then there is no proof to find, only an owner who knows. This is their door.
 *
 * What it keeps of the guard is the part that is FACT, not evidence: the two vetoes. Two KVK
 * numbers are two legal entities whoever says otherwise; two own accounts would drop the number the
 * IBAN-change check reads. Both are asked first, exactly as in planSupplierMerge, and neither can be
 * talked past. What it gives up is the demand for proof: where a shared number exists it is cited,
 * and where none does the evidence is the owner's word, recorded as such.
 *
 * The direction is not re-picked: the survivor is the row the owner pointed at.
 */
export function planOwnerMerge(survivor: MergeSupplier, mergedAway: MergeSupplier): MergePlan {
  if (!survivor?.id || !mergedAway?.id || survivor.id === mergedAway.id) return { ok: false, reason: 'same-supplier' }
  const proven = planSupplierMerge(survivor, mergedAway)
  // A veto is a veto. Only the missing-evidence answer is the owner's to overrule.
  if (!proven.ok && proven.reason !== 'no-evidence') return proven
  const base = {
    ok: true as const,
    survivorId: survivor.id,
    mergedAwayId: mergedAway.id,
    survivorName: survivor.name,
    mergedAwayName: mergedAway.name,
    movesInvoices: mergedAway.invoiceCount ?? 0,
  }
  if (proven.ok) return { ...base, evidence: proven.evidence, sharedValue: proven.sharedValue }
  return { ...base, evidence: 'owner', sharedValue: '' }
}

/**
 * Every pair the app may OFFER, out of one owner's suppliers.
 *
 * The owner never names a pair themselves — the app proposes only pairs that already share a KVK
 * or an account, and the owner confirms one. That is the second half of the guard: with no way to
 * construct a pair by hand, there is no way to construct a wrong merge.
 *
 * A row already spoken for is left out of any further pair. Merging three rows is two merges, and
 * the second must be planned on the state the first left behind, not on the state before it.
 */
export function findMergeCandidates(suppliers: readonly MergeSupplier[]): Extract<MergePlan, { ok: true }>[] {
  const out: Extract<MergePlan, { ok: true }>[] = []
  const spoken = new Set<string>()
  for (let i = 0; i < suppliers.length; i++) {
    if (spoken.has(suppliers[i].id)) continue
    for (let j = i + 1; j < suppliers.length; j++) {
      if (spoken.has(suppliers[j].id)) continue
      const plan = planSupplierMerge(suppliers[i], suppliers[j])
      if (!plan.ok) continue
      out.push(plan)
      spoken.add(plan.survivorId)
      spoken.add(plan.mergedAwayId)
      break
    }
  }
  return out
}
