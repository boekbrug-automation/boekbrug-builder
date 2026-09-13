// src/lib/email-body-invoice.ts
// [MAILTEKST] The invoice that never had an attachment. Pure, no I/O, no AI.
// Run: npx tsx --test src/lib/email-body-invoice.test.ts
//
// ── WHY THIS EXISTS ──
// Plenty of suppliers do not attach anything. A hosting bill, a phone subscription, a parking app,
// a small web service: the invoice IS the e-mail, laid out as an HTML table in the body. Both
// fetchers listed on "has an attachment", so those messages were never even seen — not skipped,
// not reported, not counted. The cost never entered the books and the voorbelasting was never
// claimed, every month, for as long as the subscription runs.
//
// ── WHY THIS IS THE MOST DANGEROUS THING TO GET WRONG ──
// Every other import path starts from a file somebody deliberately attached. This one starts from
// ORDINARY MAIL, where the overwhelming majority of what carries a euro amount is not an invoice:
// order confirmations, shipping notices, payment receipts from a card processor, price lists,
// newsletters, "your subscription renews next month". Booking any of those is a cost that never
// existed and a voorbelasting claim on it.
//
// So this file is a FILTER before it is a reader, and it is deliberately hard to pass. It is
// mechanical — no model, no cost — and it runs before anything is sent anywhere. What it lets
// through still goes to the verify queue and is never booked automatically; see the sync.
//
// ── AND THE TEXT HAS TO SURVIVE THE HTML ──
// The amounts in these mails are almost always in a table, and the naive `replace(/<[^>]+>/g, '')`
// welds the cells together: "Totaal€ 121,00" and, worse, "21%€ 21,00" — which reads as one number
// to every check downstream. Cells become spaces and rows become newlines here, because the
// grounding check, the placement check and the model all read what this produces.

/** What the pre-filter concluded, and why — the reason travels into the skip registry. */
export interface BodyInvoiceVerdict {
  /** Worth showing to the classifier. Never "this is an invoice". */
  candidate: boolean
  /** Short English tag for the audit trail. */
  reason: string
}

const NOT = (reason: string): BodyInvoiceVerdict => ({ candidate: false, reason })

/**
 * HTML → text a human (and the grounding check) can read.
 *
 * Block elements and table rows become newlines; table CELLS become a space, never nothing. That
 * last one is not cosmetic: "21%€ 21,00" glued together is a token no amount parser can read, and
 * "€ 121,00" welded to the word before it stops the grounding check finding the total that IS on
 * the page.
 */
export function htmlToReadableText(html: string): string {
  if (!html) return ''
  return (
    html
      // Script and style carry no invoice text and plenty of numbers.
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Line breaks, before the blanket rule below turns every remaining tag into a space.
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|h[1-6]|table|section|header|footer)>/gi, '\n')
      .replace(/<(?:p|div|tr|li|h[1-6]|table)\b[^>]*>/gi, '\n')
      // Everything else becomes a SPACE — and the space is the whole point, not tidiness. With ''
      // here, `<td>BTW 21%</td><td>€ 21,00</td>` collapses to "BTW 21%€ 21,00": one token no amount
      // parser can read, and "Totaal€ 121,00" that stops the grounding check finding a total which
      // IS on the page. A correct invoice would read as one whose total is not printed.
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
      .replace(/&euro;|&#8364;|&#x20ac;/gi, '€')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
      // Tidy: collapse runs of spaces, then runs of blank lines, but keep the line structure —
      // the placement check reads "is this amount on a line that follows a total word".
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Words that make a message an invoice rather than a message ABOUT money.
 * Dutch first, English beside it — a Dutch owner's suppliers write in both.
 */
const INVOICE_WORDS = [
  'factuur', 'factuurnummer', 'faktuur', 'nota', 'rekening',
  'invoice', 'invoice number', 'tax invoice', 'rechnung',
]

// [MAILTEKST-TELLING] An OPEN QUESTION about this list, deliberately left open.
//
// 'receipt' is not here, and it is not in BODY_SEARCH_WORDS in email-integration.ts either — so a
// body-only bill whose subject is "Your receipt from …" fails twice: it is never listed by the
// provider search, and it would be refused as `no_invoice_word` if it were. The word is in neither
// the include list nor the NOT_AN_INVOICE list; it is simply absent, while English ('invoice',
// 'tax invoice') and German ('rechnung') are deliberately present.
//
// That this owner receives such documents is not a guess — `Receipt-2848-5529-4965.pdf` and
// `Receipt-2043-7432.pdf` are in their bestanden. Both arrived as ATTACHMENTS, so the main path
// caught them and this pass was never needed. Whether any arrive as body-only text is exactly what
// nobody could know, because the refusal reason was discarded before anything could count it.
//
// So: not changed here, on purpose. This file's own header argues for strictness — "A missed body
// invoice costs the owner the same as today. A FALSE one becomes a cost that never existed and a
// voorbelasting claim on it" — and widening the vocabulary moves in the direction that header
// chose against. A 'receipt' is also not an invoice in this product's vocabulary: ar-decisions.ts
// keeps «bon» and «factuur» apart as a ruling, with its reason written down.
//
// The tally is what turns this from an argument into a measurement. When runs start reporting
// `no_invoice_word` on a mailbox that is receiving bills in message text, the question becomes
// which words — and that is a product decision the numbers should precede, not follow.

/**
 * A tax line. This is the single strongest signal that a document is an invoice and not a receipt
 * for someone else's money: an invoice states the BTW, because the recipient needs it to claim
 * the voorbelasting. A shipping notice never does.
 */
const TAX_WORDS = ['btw', 'b.t.w', 'vat', 'omzetbelasting', 'mwst', 'tax']

/**
 * Shapes that carry all the right words and are NOT a bill to the owner.
 *
 * This list is the whole reason the filter is trustworthy, and it is deliberately about the
 * MESSAGE'S PURPOSE rather than its vocabulary. Every one of these mentions an amount and most
 * mention BTW:
 *
 *   · a quotation is an offer, not a debt;
 *   · a reminder about an invoice the owner SENT is income, and booking it as a cost is the
 *     sign error that is hardest to find later;
 *   · a payment confirmation from a processor is money that already moved and will arrive on the
 *     bank statement, where it belongs;
 *   · a dunning notice for an invoice already booked would double the cost.
 */
const NOT_AN_INVOICE = [
  'offerte', 'prijsopgave', 'quotation', 'quote request', 'vrijblijvende',
  'orderbevestiging', 'order confirmation', 'bestelbevestiging', 'bevestiging van je bestelling',
  'verzendbevestiging', 'shipping confirmation', 'track & trace', 'je pakket',
  'betaalverzoek', 'payment request', 'betaling ontvangen', 'payment received',
  'nieuwsbrief', 'newsletter', 'uitschrijven', 'unsubscribe',
  'wachtwoord', 'password', 'verifieer je', 'verify your', 'inloggen',
  'aanmaning', 'herinnering', 'reminder',
  'proforma', 'pro forma',
]

/**
 * [AANGIFTE-GEEN-FACTUUR] A notice that a TAX RETURN was filed — never a bill to the owner.
 *
 * MEASURED on a real one: "Loonaangifte voor Kiwi Food Market is verzonden", € 952, with a
 * betalingskenmerk, an IBAN and a payment deadline. That one is refused already, on three of the
 * four conditions at once. Its SIBLING is not: the same accountant, the same template, quarterly
 * instead of monthly —
 *
 *     "Uw aangifte omzetbelasting … is verzonden naar de belastingdienst.
 *      Totaal generaal: € 1.234,56.  Maak dit bedrag over op onze bankrekening …"
 *
 * — passed all four and reached the classifier as a possible purchase invoice. Because:
 * "omzetbelasting" IS a tax word, "€ 1.234,56" IS an amount with cents, and INVOICE_WORDS matches
 * on SUBSTRING, so "rekening" inside "bankrekening" reads as the document naming itself a bill.
 * (TAX_WORDS is whole-word guarded; the invoice words are not, deliberately, so that
 * "factuurdatum" and "factuurbedrag" still count. That asymmetry is what let this through.)
 *
 * Booking it would be the worst false positive this filter can produce: the BTW return itself
 * entered as a deductible cost, with voorbelasting claimed on the very amount being remitted. The
 * bank side of this app already knows better — bank-identity.ts calls a Belastingdienst payment
 * 'tax', "a settlement, not a deductible cost".
 *
 * TWO signals are required, never one. An accountant's own invoice FOR filing the aangifte is a
 * real bill that must keep coming through, and it names the filing too ("verzorgen van uw aangifte
 * loonheffingen"). What it does not say is that the return has been SENT to the tax authority —
 * that sentence only appears on the notice.
 */
const FILING_WORDS = [
  'loonaangifte', 'aangifte loonheffing', 'aangifte omzetbelasting',
  'aangifte inkomstenbelasting', 'btw-aangifte', 'btw aangifte', 'suppletie',
]
const FILED_WITH_AUTHORITY = [
  'naar de belastingdienst', 'bij de belastingdienst', 'aan de belastingdienst',
  'naar de fiscus', 'is verzonden naar', 'is ingediend bij',
]

/**
 * A euro amount as it is actually written in these mails: € 1.234,56 / EUR 1234.56 / 1.234,56 EUR.
 * At least two decimals, because a bare "€ 5" in a newsletter is not an invoice total.
 */
const EURO_AMOUNT = /(?:€|EUR)\s*\d{1,3}(?:[.\s]\d{3})*,\d{2}|(?:€|EUR)\s*\d+\.\d{2}|\d{1,3}(?:[.\s]\d{3})*,\d{2}\s*(?:€|EUR)/i

/**
 * Is this message body worth showing to the classifier?
 *
 * FOUR conditions, all required. Each one on its own admits far too much:
 *
 *   1. it is not one of the shapes above that are never a bill;
 *   2. it names itself an invoice;
 *   3. it states a BTW/VAT line — what makes it a document the owner can deduct from;
 *   4. it carries a euro amount with cents.
 *
 * Deliberately strict, and the direction of that choice is deliberate too. A missed body invoice
 * costs the owner the same as today, which is what they already live with. A FALSE one becomes a
 * cost that never existed and a voorbelasting claim on it — and it arrives looking exactly like
 * every other row in the queue.
 */
export function bodyLooksLikeInvoice(text: string, subject: string): BodyInvoiceVerdict {
  const body = (text ?? '').toLowerCase()
  const subj = (subject ?? '').toLowerCase()
  if (body.trim().length < 40) return NOT('body_too_short')

  const hay = `${subj}\n${body}`

  const excluded = NOT_AN_INVOICE.find((w) => hay.includes(w))
  if (excluded) return NOT(`not_an_invoice:${excluded}`)

  // [AANGIFTE-GEEN-FACTUUR] Before anything else that could admit it: a filed tax return is not a
  // bill to the owner, and booking one claims voorbelasting on the remittance itself.
  const filing = FILING_WORDS.find((w) => hay.includes(w))
  if (filing && FILED_WITH_AUTHORITY.some((w) => hay.includes(w))) {
    return NOT(`tax_filing_notice:${filing}`)
  }

  if (!INVOICE_WORDS.some((w) => hay.includes(w))) return NOT('no_invoice_word')

  // Whole-word for the short ones: "vat" inside "private" and "btw" inside a URL are not tax lines.
  const hasTax = TAX_WORDS.some((w) =>
    new RegExp(`(^|[^a-z0-9])${w.replace(/\./g, '\\.')}([^a-z0-9]|$)`, 'i').test(hay))
  if (!hasTax) return NOT('no_tax_line')

  if (!EURO_AMOUNT.test(text ?? '')) return NOT('no_euro_amount')

  return { candidate: true, reason: 'body_invoice_candidate' }
}

/**
 * The filename this body gets once it is stored as evidence.
 *
 * It has to be recognisable in bestanden a year later and stable across syncs, because it is half
 * of the `${messageId}:${filename}` key that stops the same mail importing twice. Derived from the
 * subject, never from a clock.
 */
/**
 * [MAILTEKST-TELLING] Why a body scan found nothing, counted.
 *
 * bodyLooksLikeInvoice already names its refusal on every message — `no_invoice_word`,
 * `no_tax_line`, `no_euro_amount`, `not_an_invoice:offerte` — and until now every one of those was
 * computed and thrown away one line later, at `if (!verdict.candidate) return null`.
 *
 * That left the one question about this pass unanswerable. It is deliberately strict, and its own
 * header says so: "A missed body invoice costs the owner the same as today. A FALSE one becomes a
 * cost that never existed." Choosing that trade-off correctly needs to know which side it is
 * erring on — and a scan of sixty messages that admits none is indistinguishable, from outside,
 * from a mailbox that contained no body invoice at all.
 *
 * So this counts, and it decides nothing. A run whose tally is dominated by `no_tax_line` is a
 * filter working as designed on ordinary mail; one dominated by `no_invoice_word` while the owner
 * is receiving bills in their message text is a vocabulary that is too narrow — and that is a
 * question about which WORDS, which is a product decision the numbers should precede.
 */
export type BodyScanTally = Record<string, number>;

/** Count one refusal. Separate from the filter so the filter stays pure and free of bookkeeping. */
export function countRefusal(tally: BodyScanTally, reason: string): void {
  // The reason for a NOT_AN_INVOICE match carries the matched word (`not_an_invoice:offerte`), and
  // keeping it whole is the point: "eighteen refused" says nothing, "eighteen were order
  // confirmations" says the filter is doing exactly its job.
  tally[reason] = (tally[reason] ?? 0) + 1;
}

export function bodyDocumentName(subject: string | null | undefined): string {
  const clean = (subject ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${clean || 'factuur in e-mailtekst'}.pdf`
}
