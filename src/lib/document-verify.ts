// src/lib/document-verify.ts
// [DOCCHECK] The full independent verification of a read, against the document's own text. Pure.
//
// ── WHERE THIS PICKS UP ──
// [GEGROND] answers "is this number printed on the paper?" — mechanically, with no model. That
// closed the worst hole: a figure the reader INVENTED or COMPUTED, internally consistent, which
// every other gate waved through (the € 0,46 error).
//
// It does not close the next one, and measurement says so plainly. On a real layout:
//
//     read 2.265,41 (the total)        → found      — correct
//     read 1.872,24 (the SUBTOTAL)     → found      — wrong, and waved through
//     read   573,24 (a LINE ITEM)      → found      — wrong, and waved through
//     read   393,17 (the BTW)          → found      — wrong, and waved through
//
// All three wrong reads are printed on the paper, so "is it printed?" cannot tell them apart. The
// question has to become sharper: is it printed IN THE PLACE A TOTAL IS PRINTED?
//
// ── WHAT MAKES THAT ANSWERABLE WITHOUT A MODEL ──
// An invoice says where its total is, in words. "Totaal", "Te betalen", "Totaalbedrag", "Eindtotaal"
// — and the amount that follows one of those is the total, by the document's own labelling. A
// subtotal sits behind "Subtotaal" or "Totaal excl. btw", which are DIFFERENT words, and a line item
// sits behind no word at all.
//
// Two independent tests, and either one is enough:
//   · ANCHORED — the amount follows a total-word that is not an excl-word. The document said so.
//   · LARGEST  — it is the largest amount on the page. A subtotal is smaller than its total by the
//                BTW, a line item is smaller again, and the BTW is smaller than both.
//
// Both are mechanical, and the wrong picks above fail both. That is the whole idea.
//
// ── AND THE FIELDS THAT HAD NO WITNESS AT ALL ──
// The date decides which quarter the BTW lands in, and nothing has ever checked it against the
// document. Same for the invoice number, which is what makes a duplicate detectable. Both are
// verifiable the same way: does the stored value occur in the text, in any form the paper might
// print it?
//
// ── THE HONESTY RULE, EVERYWHERE ──
// Three states, never two. A check that could not RUN (no text layer) is its own answer and may
// never read as passed OR as failed. That rule is why this is worth trusting at all.

import { groundAmount, verdictBlocksAutoBooking, type GroundingVerdict } from './amount-grounding'
import { round2 } from './invoice-totals'

/**
 * How well the read total is supported by the document.
 *
 * Ordered strongest first, and the order is the point: 'present' is the verdict that did not exist
 * before, and it is exactly the subtotal-picked-as-total case.
 */
export type TotalVerdict =
  | 'anchored'    // follows a total-word the document itself printed
  | 'largest'     // the biggest amount on the page — a subtotal never is
  | 'present'     // printed somewhere, but neither of those. THIS is the wrong-number shape.
  | 'absent'      // not printed at all — invented or computed
  | 'unreadable'  // no text to search

/** Whether a non-money field was found in the document. */
export type FieldVerdict = 'found' | 'absent' | 'unreadable'

export interface DocumentCheck {
  total: TotalVerdict
  /** The invoice date, checked against every way a Dutch document might print it. */
  date: FieldVerdict
  /** The invoice number — what makes a duplicate detectable. */
  invoiceNumber: FieldVerdict
  /** The BTW amount, by the same grounding rule as before. */
  btw: GroundingVerdict
  /**
   * The split the DOCUMENT prints, when it prints one that the read contradicts. Null when the paper
   * asserts no split, or when the read matches the one it does. This is the € 0,46 shape.
   */
  btwContradiction: PrintedSplit | null
}

// ── Anchors ───────────────────────────────────────────────────────────────────

/**
 * Words a document uses to label its final amount. Dutch first, then the languages a Dutch
 * administration actually receives invoices in.
 *
 * `totaal` is in here even though `subtotaal` contains it — the boundary check below is what tells
 * them apart, and dropping `totaal` to avoid the collision would lose the single most common label
 * on a Dutch invoice.
 */
const TOTAL_WORDS = [
  'totaal te betalen', 'te betalen', 'totaalbedrag', 'eindtotaal', 'totaal incl', 'totaal',
  'factuurbedrag', 'openstaand bedrag',
  'total amount', 'amount due', 'grand total', 'total',
  'gesamtbetrag', 'gesamtsumme', 'zu zahlen',
]

/**
 * Words that make a nearby total-word mean something else.
 *
 * "Totaal excl. btw" is not the total, and neither is "Subtotaal". Getting this list wrong in the
 * permissive direction is the failure that matters: it would anchor a SUBTOTAL and bless exactly the
 * read this module exists to catch.
 */
const NOT_TOTAL = ['sub', 'excl', 'exclusief', 'ex.', 'netto', 'zonder btw', 'before tax', 'net ']

/** Every amount-shaped token in the text, as numbers. */
export function amountsIn(text: string): number[] {
  const out: number[] = []
  // A money token: digits, optional grouping, and a 2-digit decimal part. Requiring the decimals is
  // what keeps order numbers, postcodes and article codes out of the comparison.
  const re = /\d{1,3}(?:[.,    ]\d{3})*[.,]\d{2}(?![\d])|\d+[.,]\d{2}(?![\d])/g
  for (const m of text.match(re) ?? []) {
    const t = m.trim()
    // Decide which separator is the decimal one: it is the LAST of the two, always.
    const lastComma = t.lastIndexOf(',')
    const lastDot = t.lastIndexOf('.')
    const decAt = Math.max(lastComma, lastDot)
    if (decAt < 0) continue
    const whole = t.slice(0, decAt).replace(/[^0-9]/g, '')
    const frac = t.slice(decAt + 1).replace(/[^0-9]/g, '')
    const n = Number(`${whole || '0'}.${frac.padEnd(2, '0').slice(0, 2)}`)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * The amounts that follow a total-word, as numbers.
 *
 * "Follows" means within a short window after the word — a label and its amount sit on one line, and
 * a wide window would reach the next row and anchor whatever happens to be there.
 */
export function anchoredAmounts(text: string): number[] {
  const lower = text.toLowerCase()
  const out: number[] = []
  for (const word of TOTAL_WORDS) {
    let from = 0
    for (;;) {
      const i = lower.indexOf(word, from)
      if (i === -1) break
      from = i + 1
      // The 12 characters before decide whether this occurrence means the total at all: "subtotaal"
      // and "totaal excl." both contain a total-word and neither IS one.
      const before = lower.slice(Math.max(0, i - 12), i)
      const after = lower.slice(i + word.length, i + word.length + 14)
      if (NOT_TOTAL.some((n) => before.includes(n) || after.includes(n))) continue
      // 60 characters: enough for "Totaal te betalen .......... € 2.265,41", short enough that the
      // next line's amount is out of reach.
      out.push(...amountsIn(text.slice(i + word.length, i + word.length + 60)))
    }
  }
  return out
}

const CENT = 0.005

/** Is `a` the same amount as `b`, to the cent? */
function same(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < CENT
}

/**
 * How well the document supports this total.
 *
 * The ORDER of the tests is the design. Anchored is the document's own statement and outranks
 * everything; largest is a structural fact about invoices; and only when both fail does 'present'
 * become the answer — which is not "fine", it is "printed, but not where a total is printed".
 */
export function verifyTotal(amount: number | null | undefined, text: string | null | undefined): TotalVerdict {
  const ground = groundAmount(amount, text)
  if (ground !== 'found') return ground === 'absent' ? 'absent' : 'unreadable'
  const n = amount as number
  const t = text as string

  if (anchoredAmounts(t).some((a) => same(a, n))) return 'anchored'

  const all = amountsIn(t)
  if (all.length === 0) return 'present'
  const max = Math.max(...all.map((a) => Math.abs(a)))
  if (same(max, n)) return 'largest'

  return 'present'
}

// ── Date ──────────────────────────────────────────────────────────────────────

// [DOCCHECK-TAAL] The month, in the languages a Dutch administration actually receives invoices in.
//
// TOTAL_WORDS above already says exactly that about the total-label — Dutch first, then English and
// German — and the date reader was written Dutch-only. Measurement caught it: EVERY 'absent' date
// verdict in production (7 of 86 checked invoices, four different suppliers) was an English-language
// SaaS invoice whose date was perfectly correct. Their fingerprint is identical and unmistakable —
// total 'anchored', invoice number 'found', date 'absent' — so the text layer was read fine and only
// the date FORM was unmatched. Seven owners were told to check a date that was right.
//
// Short forms are listed rather than sliced to three letters. Slicing worked for nine months by
// coincidence ('aug' is both Dutch and English) and silently failed on the three where the languages
// differ: maart/March, mei/May, oktober/October.
const MONTHS: ReadonlyArray<readonly string[]> = [
  ['januari', 'january', 'januar', 'jan'],
  ['februari', 'february', 'februar', 'feb', 'febr'],
  ['maart', 'march', 'märz', 'maa', 'mar', 'mrt', 'mrz'],
  ['april', 'apr'],
  ['mei', 'may', 'mai'],
  ['juni', 'june', 'jun'],
  ['juli', 'july', 'jul'],
  ['augustus', 'august', 'aug'],
  ['september', 'sep', 'sept'],
  ['oktober', 'october', 'okt', 'oct'],
  ['november', 'nov'],
  ['december', 'dezember', 'dec', 'dez'],
]

/**
 * Does the stored invoice date occur in the document?
 *
 * The date is the field with the most consequence and the least scrutiny: under the kasstelsel it is
 * the payment date that picks the quarter, but the INVOICE date picks it under factuurstelsel, and
 * a date read a month wrong moves BTW between two filings. Nothing has ever checked it against the
 * paper.
 *
 * Every form the document might print it in — see MONTHS above for why "Dutch document" was the
 * wrong frame — because a missed format is a false alarm on a correct invoice, and those are what
 * teach people to ignore warnings.
 */
export function verifyDate(iso: string | null | undefined, text: string | null | undefined): FieldVerdict {
  const t = (text ?? '').trim()
  if (t.length === 0) return 'unreadable'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return 'unreadable'

  const [, y, mo, d] = m
  const yy = y.slice(2)
  const dNum = String(Number(d))
  const moNum = String(Number(mo))
  const monthNames = MONTHS[Number(mo) - 1] ?? []

  const forms = new Set<string>()
  for (const sep of ['-', '/', '.', ' ']) {
    forms.add(`${d}${sep}${mo}${sep}${y}`)   // 01-06-2026
    forms.add(`${dNum}${sep}${moNum}${sep}${y}`)
    forms.add(`${d}${sep}${mo}${sep}${yy}`)  // 01-06-26
    forms.add(`${dNum}${sep}${moNum}${sep}${yy}`)
    forms.add(`${y}${sep}${mo}${sep}${d}`)   // ISO and its punctuated cousins
    // [DOCCHECK-VOLGORDE] Month first, and ONLY when the day cannot be read as a month.
    //
    // "8/13/2026" has exactly one reading, because there is no thirteenth month — so matching it is
    // free. "01-02-2026" has two, and accepting the American one would destroy the single most
    // valuable thing this witness does: it is the only check in the app that can catch a day/month
    // swap, which is the classic silent date error (1 February read as 2 January — a valid date, a
    // confident reader, a different BTW quarter). Above 12 the swap is impossible; at or below it,
    // refusing to match is what keeps the swap visible.
    if (Number(d) > 12) {
      forms.add(`${mo}${sep}${d}${sep}${y}`)
      forms.add(`${moNum}${sep}${dNum}${sep}${y}`)
      forms.add(`${mo}${sep}${d}${sep}${yy}`)
      forms.add(`${moNum}${sep}${dNum}${sep}${yy}`)
    }
  }
  for (const mn of monthNames) {
    // "1 juni 2026" / "01 June 2026" / "1 jun. 2026"
    forms.add(`${dNum} ${mn} ${y}`)
    forms.add(`${d} ${mn} ${y}`)
    forms.add(`${dNum} ${mn}. ${y}`)
    forms.add(`${d} ${mn}. ${y}`)
    // "2. März 2026" — in German the dot sits after the DAY, as an ordinal marker, and Dutch formal
    // writing does the same. A dot on the other side of the month is a different string entirely.
    forms.add(`${dNum}. ${mn} ${y}`)
    forms.add(`${d}. ${mn} ${y}`)
    // "August 13, 2026" — the order every American invoice prints, and the one no form above
    // produced. A month NAME is unambiguous whichever side of the day it stands on, so unlike the
    // numeric order there is nothing to disambiguate here.
    forms.add(`${mn} ${dNum}, ${y}`)
    forms.add(`${mn} ${d}, ${y}`)
    forms.add(`${mn} ${dNum} ${y}`)
    forms.add(`${mn} ${d} ${y}`)
    forms.add(`${mn}. ${dNum}, ${y}`)
    forms.add(`${mn}. ${d}, ${y}`)
  }

  const lower = t.toLowerCase()
  for (const f of forms) {
    if (lower.includes(f.toLowerCase())) return 'found'
  }
  return 'absent'
}

// ── Invoice number ────────────────────────────────────────────────────────────

/**
 * Does the stored invoice number occur in the document?
 *
 * It is what makes a duplicate detectable and what a payment quotes, so a number that is not on the
 * paper is a number nothing else can ever reconcile against.
 *
 * Compared on alphanumerics only: a document printing "26302050" and a stored "2630-2050" are the
 * same number wearing different punctuation, and flagging that pair would be a false alarm.
 */
export function verifyInvoiceNumber(num: string | null | undefined, text: string | null | undefined): FieldVerdict {
  const t = (text ?? '').trim()
  if (t.length === 0) return 'unreadable'
  const n = (num ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  // Too short to mean anything: a two-character "number" occurs everywhere and confirming it would
  // be noise dressed as evidence. Placeholder numbers the app generates are excluded the same way.
  if (n.length < 3) return 'unreadable'
  if (/^(upload|email|intake)/.test(n)) return 'unreadable'
  return t.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(n) ? 'found' : 'absent'
}

// ── The printed split ─────────────────────────────────────────────────────────

/** The Dutch rates. A split that does not land on one of these is not a BTW split. */
const RATES = [21, 9, 0]

/** A split the DOCUMENT prints: an ex-BTW amount and a BTW amount that add up to the total. */
export interface PrintedSplit {
  excl: number
  btw: number
  rate: number
}

/**
 * Does the document print a valid BTW split for this total, and is it the one that was read?
 *
 * ── WHY THIS HAD TO BE BUILT ──
 * Measured after everything above was in place: the original € 0,46 error still booked. The total
 * was right and anchored, the arithmetic was consistent (21,91 + 4,04 = 25,95), and only the SPLIT
 * was invented — and the split blocks nothing, because the total is the only field that holds an
 * invoice. So the first error this whole line of work started from was still getting through.
 *
 * The naive fix — "hold whenever the BTW is not printed" — would fire on every receipt that prints
 * a rate and a total and leaves the split to be computed, which is a large and legitimate class.
 * That is a false alarm on correct documents, and those are what get a safety feature switched off.
 *
 * So the question is narrower and it is answerable: does the paper print a DIFFERENT valid split?
 * Two printed amounts that add to the total at a legal rate are a split the document is asserting.
 * If one exists and the read does not match it, the read contradicts the paper — and that is the
 * € 0,46 shape exactly. If the paper prints no split at all, nothing is claimed and nothing is held.
 */
export function findPrintedSplit(
  total: number | null | undefined,
  text: string | null | undefined,
): PrintedSplit | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || Math.abs(total) < CENT) return null
  const t = (text ?? '').trim()
  if (t.length === 0) return null

  const amounts = amountsIn(t).map((a) => Math.abs(a))
  const goal = Math.abs(total)
  for (const excl of amounts) {
    if (excl >= goal) continue
    const btw = round2(goal - excl)
    // The complement must ALSO be printed. One printed number plus arithmetic is not the document
    // asserting a split; it is us inventing one, which is the very thing being guarded against.
    if (!amounts.some((a) => Math.abs(a - btw) < CENT)) continue
    const rate = excl > 0 ? (btw / excl) * 100 : 0
    const hit = RATES.find((r) => Math.abs(rate - r) < 0.6)
    if (hit === undefined || hit === 0) continue
    return { excl, btw, rate: hit }
  }
  return null
}

/**
 * Does the read's BTW contradict a split the document prints?
 *
 * Only ever true when BOTH are known: a printed split exists AND the read has a BTW that differs
 * from it. Absence of a printed split is not evidence, and neither is a missing read.
 */
export function btwContradictsDocument(
  read: { totalIncBtw?: number | null; btwAmount?: number | null },
  text: string | null | undefined,
): PrintedSplit | null {
  const printed = findPrintedSplit(read.totalIncBtw, text)
  if (!printed) return null
  const b = read.btwAmount
  if (typeof b !== 'number' || !Number.isFinite(b)) return null
  return Math.abs(Math.abs(b) - printed.btw) < CENT ? null : printed
}

// ── The whole check ───────────────────────────────────────────────────────────

export function verifyDocument(
  read: {
    totalIncBtw?: number | null
    btwAmount?: number | null
    invoiceDate?: string | null
    invoiceNumber?: string | null
  },
  text: string | null | undefined,
): DocumentCheck {
  return {
    total: verifyTotal(read.totalIncBtw, text),
    date: verifyDate(read.invoiceDate, text),
    invoiceNumber: verifyInvoiceNumber(read.invoiceNumber, text),
    btw: groundAmount(read.btwAmount, text),
    btwContradiction: btwContradictsDocument(read, text),
  }
}

/**
 * May this read be booked with no human?
 *
 * Only the TOTAL decides, and only its two worst verdicts. That restraint is deliberate:
 *
 *   · 'absent'  — the figure is not on the paper. Invented or computed. Always holds.
 *   · 'present' — printed, but neither labelled as the total nor the largest amount. This is the
 *                 subtotal-read-as-total shape, and it is the whole reason this module exists.
 *
 * Everything else is REPORTED and blocks nothing. A date or an invoice number that could not be
 * found is worth telling the owner about, but holding an invoice for it would fire on the many
 * documents that print a date in a format nobody predicted — and a queue full of correct invoices is
 * how a safety feature gets switched off.
 */
// Zelfde afspraak als groundingBlocksAutoBooking: geen aanroeper, want de deuren houden losse
// verdicts. Dit is de complete uitspraak — grounding, plaatsing en de gedrukte btw-splitsing samen —
// en elke helft delegeert, zodat hij niet kan afwijken van wat er werkelijk wordt gevraagd.
export function documentCheckBlocks(c: DocumentCheck): boolean {
  // [DOCCHECK-SPLIT] And a BTW that contradicts a split the paper prints. Measured: without this,
  // the original € 0,46 error still booked — right total, consistent arithmetic, invented split.
  // Narrow on purpose: it fires only when the document ASSERTS a different split, never merely
  // because the BTW was not printed (which every receipt-with-a-rate would trip).
  //
  // Each half delegates rather than restating its literal: auto-advance.ts asks the same three
  // questions of stored verdicts, and three rules written twice is three chances for the copy
  // nobody calls to drift away from the one that decides.
  return (
    verdictBlocksAutoBooking(c.total as GroundingVerdict) ||
    placementBlocksAutoBooking(c.total) ||
    c.btwContradiction !== null
  )
}

/**
 * The placement half, asked of a bare verdict — the shape both auto-booking doors actually hold.
 *
 * 'present' only. Not 'absent', which the grounding rule already holds one step earlier, and not
 * 'unreadable', which means there was no text to search: a photographed receipt is the ordinary
 * case this app is built for, and refusing to automate it would take the product away in the name
 * of protecting it.
 *
 * Null and undefined do not block, for the same reason as in verdictBlocksAutoBooking: absent from
 * the blob means the check never ran on this document.
 */
export function placementBlocksAutoBooking(p: TotalVerdict | null | undefined): boolean {
  return p === 'present'
}

/**
 * Read the stored placement verdict for the TOTAL out of a field_confidence blob.
 *
 * One reader for both auto-booking doors, for the same reason groundingOf has one: each door
 * reaching into the jsonb its own way is how the intake and e-mail paths came to disagree about the
 * duplicate marker, and that disagreement was invisible until it double-booked an invoice.
 *
 * Anything unrecognisable returns null, which the gate treats as "the check did not run" — a
 * malformed blob may not invent a refusal any more than it may invent an approval.
 */
export function placementOf(fieldConfidence: unknown): TotalVerdict | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const c = (fieldConfidence as Record<string, unknown>)._doccheck
  if (!c || typeof c !== 'object') return null
  const v = (c as Record<string, unknown>).total
  return v === 'anchored' || v === 'largest' || v === 'present' || v === 'absent' || v === 'unreadable'
    ? v
    : null
}

/**
 * Read the stored split-contradiction out of a field_confidence blob.
 *
 * Same one-reader rule as placementOf and groundingOf: each door reaching into the jsonb its own way
 * is how two import paths came to disagree about a marker, invisibly, until it double-booked.
 */
export function btwContradictionOf(fieldConfidence: unknown): boolean {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return false
  const c = (fieldConfidence as Record<string, unknown>)._doccheck
  if (!c || typeof c !== 'object') return false
  const v = (c as Record<string, unknown>).btwContradiction
  return !!v && typeof v === 'object'
}
