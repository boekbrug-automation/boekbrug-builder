// src/lib/direct-debit.ts
// [DD-SIGNAL] Does the bank statement itself say this was an automatische incasso?
//
// It does. Every format carries it, and the app was reading straight past all of them:
//
//   · MT940 — the :61: line ends with a four-character transaction type code, and NDDT is
//     Direct Debit. parseMT940Transaction ALREADY captures it: `(N[A-Z0-9]{3})?` is group 6 of
//     its regex. The line that destructures the match skips group 6 with a bare comma.
//   · CAMT.053 — <BkTxCd> carries the ISO family (RDDT = a direct debit received against this
//     account), and <Refs> carries <MndtId>, the machtigingskenmerk. Neither is read.
//   · CSV — ING has a `Code` column whose value for an incasso is literally "IC", and a
//     `Mutatiesoort` column whose value is "Incasso". Rabobank gives it two dedicated columns:
//     `Machtigingskenmerk` and `Incassant ID`. mapColumns maps seven roles; none is any of these.
//   · Free text — ABN AMRO writes "SEPA Incasso algemeen doorlopend" with "Incassant:" and
//     "Machtiging:" in the description; the ING statement line the PSD2 mapper un-composes names
//     "Machtiging ID" and "Incassant ID" as segment labels — it knows them well enough to stop at
//     them, and then discards them.
//
// ── THE RULE, STRONGEST FIRST ──
// A mandate reference or a creditor identifier is PROOF. A SEPA direct debit cannot exist without
// a mandate — that is what the debtor signed — and an ordinary transfer never carries one. Those
// two are therefore treated as certain, and everything else as an indication.
//
// The incassant-ID has a fixed shape: NL + two check digits + ZZZ + twelve digits (KVK plus a
// branch counter), e.g. NL32ZZZ411951220000. Recognising it in free text is how the ABN and SNS
// exports are read, where there is no column to ask.
//
// ── DIRECTION IS PART OF THE ANSWER ──
// A direct-debit marker on a POSITIVE amount is not a collection, it is a storno — the collection
// bounced and the bank put the money back. Reading it as "this supplier collects automatically"
// would be exactly backwards: a storno means the invoice is NOT paid, and it is the one event that
// must never be evidence for a mandate. So the sign is read here rather than left to callers.
//
// Pure: no I/O, no clock. The parsers hand it what they read; it answers what that means.

/** How we know. Ordered by strength — the first two are proof, the last two are indications. */
export type DirectDebitSignal =
  | 'mandate'     // a machtigingskenmerk — a direct debit cannot exist without one
  | 'creditor-id' // an incassant-ID (NL..ZZZ..) — issued only to parties that collect
  | 'type-code'   // MT940 NDDT / CAMT RDDT / ING's "IC" — the bank's own classification
  | 'wording'     // "SEPA Incasso", "doorlopende machtiging" — the text, when there is no field

export interface DirectDebitRead {
  /** Money COLLECTED from this account by a mandate. False for a storno — see `reversal`. */
  isDirectDebit: boolean
  /** Why we say so. Null when nothing pointed at a direct debit. */
  signal: DirectDebitSignal | null
  /**
   * A direct-debit marker on money coming IN: the collection was reversed (storno) — or, on a
   * business account, the owner collecting from their own customers. Either way it is not a
   * supplier collecting from them, and it must never count as evidence of a mandate.
   */
  reversal: boolean
  /** The machtigingskenmerk, when the file gave one. */
  mandateId: string | null
  /** The incassant-ID of the party that collected, when the file gave one. */
  creditorId: string | null
}

const NOTHING: DirectDebitRead = {
  isDirectDebit: false, signal: null, reversal: false, mandateId: null, creditorId: null,
}

/**
 * The Dutch creditor identifier. NL + 2 check digits + ZZZ + 12 digits.
 *
 * The `ZZZ` is the business-area code and is what makes this safe to search for in free text: no
 * IBAN, invoice number or reference has that shape. Kept slightly general on the country prefix so
 * a German or Belgian collector (DE98ZZZ…, BE69ZZZ…) is recognised too — a Dutch entrepreneur pays
 * foreign suppliers, and the shape is defined the same way across SEPA.
 */
const CREDITOR_ID = /\b([A-Z]{2}\d{2}ZZZ[0-9A-Z]{3,28})\b/

/** "Incassant: NL32ZZZ411951220000", "Incassant ID: …", "Creditor id …" */
const CREDITOR_LABEL = /\b(?:incassant(?:\s*id)?|creditor\s*(?:id|identifier)|crediteur\s*id)\b\s*:?\s*([A-Z]{2}\d{2}ZZZ[0-9A-Z]{3,28})/i

/**
 * "Machtiging: 1234", "Machtiging ID: …", "Machtigingskenmerk …", "Kenmerk machtiging …"
 *
 * The trailing lookahead is what keeps a 200-character blob out of a column. Without it the
 * quantifier simply stops at its ceiling and hands over a truncated slice as if it were a
 * reference — and a mandate id is something later code compares suppliers on.
 */
const MANDATE_LABEL = /\b(?:machtiging(?:\s*(?:id|kenmerk))?|mandaat(?:\s*id)?|mandate\s*(?:id|ref\w*)?)\b\s*:?\s*([A-Za-z0-9][A-Za-z0-9._/+-]{2,34})(?![A-Za-z0-9._/+-])/i

/**
 * Bank type codes that mean "direct debit".
 *
 * MT940 :61: uses the SWIFT transaction type identification codes; NDDT is Direct Debit. ING's CSV
 * `Code` column uses its own two-letter set, where IC is incasso. CAMT's <BkTxCd> uses the ISO
 * 20022 family: RDDT is a direct debit RECEIVED against this account (money out) and IDDT one
 * ISSUED by it (money in) — the direction is then decided by the amount below, not by the letters.
 */
const DD_TYPE_CODES = new Set(['NDDT', 'IC', 'RDDT', 'IDDT', 'PMDD', 'ESDD', 'URDD', 'DDT'])

/**
 * Wording that names the instrument. Deliberately phrases, not the bare word "incasso": a payer
 * can write anything in a description ("terugbetaling incasso", "incasso geannuleerd"), and a
 * single word is not enough to state what an instrument was.
 *
 * The exception is a value that came out of a COLUMN whose job is to classify the transaction —
 * ING's Mutatiesoort is literally "Incasso" — and that arrives here as a type code, not as text.
 */
const DD_WORDING = /\b(?:sepa[\s-]*incasso|europese\s+incasso|doorlopende\s+(?:sepa\s+)?(?:incasso|machtiging)|eenmalige\s+(?:sepa\s+)?(?:incasso|machtiging)|incassobatch(?:id)?|direct\s*debit|domiciliëring)\b/i

/** A collection that came back. The invoice it was supposed to settle is NOT paid. */
const STORNO_WORDING = /\b(?:storno|stornering|terugboeking|geweigerde?\s+incasso|onbetaald\s+retour|reversal)\b/i

export interface DirectDebitInput {
  /** The bank's own classification: MT940 :61: type code, CAMT family/subfamily, a CSV Code cell. */
  typeCode?: string | null
  /** A machtigingskenmerk from a dedicated field (CAMT <MndtId>, Rabobank's own column). */
  mandateId?: string | null
  /** An incassant-ID from a dedicated field (CAMT <CdtrSchmeId>, Rabobank's own column). */
  creditorId?: string | null
  /** Everything textual the line carries — description, remittance, the raw line. */
  text?: string | null
  /** Signed euros: negative = money left this account. */
  amount?: number | null
}

/** Trim, upper-case and strip separators from a type code so "N D D T" and "ic" both land. */
function normalizeCode(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Trim to something storable; a bank field can arrive padded or empty. */
function clean(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s.length > 0 && s.length <= 64 ? s : null
}

/**
 * Read one bank line for the incasso question.
 *
 * Never throws and never guesses: with nothing to go on it says so (`signal: null`), which is the
 * honest answer for a bank whose export carries no such column and a description that says nothing.
 * A `false` here means "this line does not show it", never "this was not a direct debit".
 */
export function readDirectDebit(input: DirectDebitInput): DirectDebitRead {
  const text = (input.text ?? '').trim()

  // ── Proof, if the file gave any ──
  const mandateId =
    clean(input.mandateId) ??
    clean(MANDATE_LABEL.exec(text)?.[1] ?? null)
  const creditorId =
    clean(input.creditorId) ??
    clean(CREDITOR_LABEL.exec(text)?.[1] ?? null) ??
    clean(CREDITOR_ID.exec(text)?.[1] ?? null)

  // ── The bank's own classification ──
  const code = normalizeCode(input.typeCode)
  const byCode = code.length > 0 && DD_TYPE_CODES.has(code)

  // ── The words, when there is no field ──
  const byWording = DD_WORDING.test(text)

  const signal: DirectDebitSignal | null =
    mandateId ? 'mandate'
    : creditorId ? 'creditor-id'
    : byCode ? 'type-code'
    : byWording ? 'wording'
    : null

  if (!signal) return NOTHING

  // ── Which way did the money go? ──
  // A direct-debit marker on money coming IN is a storno (or the owner collecting from their own
  // customers). Both are the opposite of "a supplier collects from me", and treating either as a
  // collection would mark an invoice paid that the bank has just un-paid.
  const amount = typeof input.amount === 'number' && isFinite(input.amount) ? input.amount : null
  const reversal = (amount != null && amount > 0) || STORNO_WORDING.test(text)

  return { isDirectDebit: !reversal, signal, reversal, mandateId, creditorId }
}

/**
 * Is this signal strong enough to act on WITHOUT asking the owner?
 *
 * A mandate reference or an incassant-ID is a fact about the instrument; the bank's own type code
 * is the bank stating what it did. Wording is not, and that distinction is the whole reason this
 * function exists separately from readDirectDebit: a description is written by whoever sent the
 * money, so "SEPA Incasso" in free text is a good reason to ASK and never a reason to decide.
 */
export function isCertainDirectDebit(read: DirectDebitRead): boolean {
  if (!read.isDirectDebit) return false
  return read.signal === 'mandate' || read.signal === 'creditor-id' || read.signal === 'type-code'
}

/**
 * Did the BANK'S OWN FIELDS say this money came back?
 *
 * The mirror image of isCertainDirectDebit, and it exists for the same reason: a matcher may not
 * act on a description someone typed. `reversal` on its own is not enough to refuse a payment with,
 * because it also fires on the word "storno" appearing in free text — and a customer who types
 * "terugbetaling incasso" in a payment note would then have their own transfer held back.
 *
 * So this asks the narrower question: the marker came from a machtigingskenmerk, an incassant-ID or
 * the bank's own transaction code, AND the money went the wrong way for a collection. Every one of
 * those three is written by the bank, not by a payer.
 *
 * What it does NOT claim is which reversal it is. A credit under a direct-debit marker is either a
 * supplier's failed collection coming back, or — on a business account — the owner collecting from
 * their own customers. Both are true things this cannot tell apart, and the caller must not treat
 * this as "not a payment": bank-matching caps such a pair to a human choice rather than removing
 * it, precisely because the second case is a real payment.
 */
export function isBankStatedReversal(read: DirectDebitRead): boolean {
  return read.reversal && read.signal !== null && read.signal !== 'wording'
}

// [DD-SIGNAL] Er stond hier een directDebitEvidenceText(): de zin die de eigenaar zou vertellen
// WAAROM een afschrijving als incasso is gelezen ("je bank noemt hier een machtiging"), en bij een
// storno dat de factuur dus NIET betaald is. Geen enkel scherm toonde hem, en er is vandaag ook
// geen plek waar een bankregel zijn incasso-verdict laat zien — die maken is een functie, geen
// bedrading.
//
// Weg, en met opzet geen "voor later" laten staan: een zin die klaarligt en nergens verschijnt
// leest als afgeleverd. De REGEL blijft (readDirectDebit, isCertainDirectDebit) en wordt gebruikt
// voor het machtigingsbewijs hieronder. Komt het scherm er, dan komt de zin met dat scherm mee —
// dan is er tenminste iemand die hem leest.


// ─── From lines to a proposal ─────────────────────────────────────────────────
//
// The point of reading the signal is not to label a bank line. It is to answer the question the
// owner should never have had to answer themselves: WHICH of my suppliers collect automatically?
//
// Two collections, not one. A single direct debit is a fact about one payment; a supplier that has
// collected twice has a standing mandate, and that is what the switch is about. One is also the
// shape a mis-read produces, and the cost of being wrong here is a supplier whose invoices stop
// showing a pay button.

/** One bank line, as much of it as this question needs. */
export interface MandateLine {
  counterpartName: string | null
  typeCode?: string | null
  mandateId?: string | null
  creditorId?: string | null
  description?: string | null
  rawLine?: string | null
  amount: number | null
  date?: string | null
}

/** A supplier the statement shows collecting, and the evidence for it. */
export interface MandateEvidence {
  /** The counterpart name as the bank writes it — the display name for the question. */
  name: string
  /** How many separate collections were seen. */
  collections: number
  /** The most recent one, so the question can say "voor het laatst op …". */
  lastDate: string | null
  /** The incassant-ID, when any line carried one. Identifies the collector beyond its name. */
  creditorId: string | null
  /** True when at least one line was a storno — worth saying, because an invoice may still be open. */
  hadReversal: boolean
}

/**
 * Which suppliers does this statement show collecting by mandate?
 *
 * Only CERTAIN signals count (a mandate reference, an incassant-ID, or the bank's own type code).
 * Wording is excluded on purpose: proposing a mandate off a description someone typed would put
 * the decision in the hands of whoever wrote "SEPA Incasso" in a payment note.
 *
 * Keyed on the counterpart NAME rather than the incassant-ID, because the name is what the invoice
 * carries and the mandate is stored against the supplier. The incassant-ID rides along as
 * corroboration; it is not the key, since a collector may use one ID across several trade names.
 *
 * Pure, and deliberately not deduplicating by amount or date: two collections in one month from
 * one supplier are two collections. A supplier that bills monthly reaches the threshold in two
 * months, which is the right speed for a question that changes how their invoices are handled.
 */
export function summariseMandates(
  lines: MandateLine[],
  opts: { minCollections?: number } = {},
): MandateEvidence[] {
  const min = opts.minCollections ?? 2
  const byName = new Map<string, MandateEvidence>()

  for (const line of lines) {
    const name = (line.counterpartName ?? '').trim()
    if (!name) continue
    const read = readDirectDebit({
      typeCode: line.typeCode,
      mandateId: line.mandateId,
      creditorId: line.creditorId,
      text: `${line.description ?? ''} ${line.rawLine ?? ''}`.trim(),
      amount: line.amount,
    })
    if (!read.signal) continue

    const key = name.toLowerCase()
    const entry = byName.get(key) ?? { name, collections: 0, lastDate: null, creditorId: null, hadReversal: false }
    // A storno is recorded but never counted. It is the OPPOSITE of evidence that this supplier
    // successfully collects — and it means an invoice somewhere is still open.
    if (read.reversal) entry.hadReversal = true
    else if (isCertainDirectDebit(read)) {
      entry.collections += 1
      if (line.date && (!entry.lastDate || line.date > entry.lastDate)) entry.lastDate = line.date
    }
    if (!entry.creditorId && read.creditorId) entry.creditorId = read.creditorId
    byName.set(key, entry)
  }

  return [...byName.values()]
    .filter((e) => e.collections >= min)
    .sort((a, b) => b.collections - a.collections || a.name.localeCompare(b.name))
}
