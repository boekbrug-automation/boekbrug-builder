// src/lib/e-invoice.ts
// [E-FACTUUR] The supplier's own figures, in machine form. No AI, no OCR, no reading of a picture.
// Run: npx tsx --test src/lib/e-invoice.test.ts
//
// ── WHY THIS IS THE MOST IMPORTANT WITNESS IN THE APP ──
// Everything else this import does to be sure of a number is a way of checking a READING:
//
//   · the arithmetic gate compares three figures one read produced;
//   · field_confidence is the model's opinion of its own answer;
//   · [GEGROND] asks whether the figure occurs in the document's own characters;
//   · [DOCCHECK] asks whether it sits where a total is printed;
//   · the OCR pass is a second reading, with different failure modes.
//
// An e-invoice is not a reading at all. Factur-X and ZUGFeRD are ordinary-looking PDFs that carry
// the invoice a second time as XML attached inside the file; a Peppol/UBL invoice is that XML on
// its own. Either way the supplier states the totals in a structured form THEY produced. There is
// nothing to interpret, and no picture in between.
//
// The app could not see any of it. A Factur-X PDF was photographed by the model like any other
// page while the exact figures sat unread inside the same bytes.
//
// ── AND IT MATTERS MORE EVERY YEAR — BUT NOT ON THE DATE THIS COMMENT USED TO CLAIM ──
//
// What stood here was: "The Netherlands makes Peppol e-invoicing mandatory for businesses over
// €800k turnover from 1 January 2027, and for everyone — zzp included — from 1 January 2028."
//
// That is not true, and the way it became "true" is worth writing down, because it will happen
// again. One session wrote it from an unnamed source; a later session read it in this file and
// cited it back as a fact about the world, and a strategy was proposed on top of it. A claim does
// not become verified by being committed. Checked against the actual record (August 2026):
//
//   · B2G — real and long-standing. Suppliers to the Dutch national government have invoiced
//     electronically over Peppol since 2017. That is the only Dutch e-invoicing OBLIGATION today.
//   · Domestic B2B — NOT law, and not yet even a bill. ViDA lets a member state mandate it; the
//     Netherlands is consulting. Cabinet clarity on scope was due summer 2026, a draft bill goes
//     to consultation in Q4 2026, and the legislation is to be ADOPTED by mid-2028 — which is
//     almost certainly where the "2028" in the deleted sentence came from. Adoption is not entry
//     into force.
//   · Cross-border B2B — 1 July 2030 under ViDA. That is the first hard EU date.
//
// So the honest version: the direction is certain, the deadline is roughly four years further out
// than this file claimed, and NOTHING here should be justified by urgency.
//
// It does not need to be. The reason this code pays for itself TODAY has nothing to do with Dutch
// law: German suppliers send ZUGFeRD now, French ones Factur-X, Belgian ones Peppol UBL since
// January 2026 — and a Dutch buyer receives all three already. Every one of those arrives as a
// number nobody has to read off a picture. That is the whole argument, and it holds whatever the
// Belastingdienst decides in 2028.
//
// Sources: Kamerbrief "Kabinetsreactie op het rapport ViDA e-facturatie en digitale rapportage"
// (tweedekamer.nl, 2026Z04773); EY advisory report on the Dutch implementation; peppol.nl on
// country-specific obligations. Re-check before quoting: this is a moving file.
//
// ── WHAT THIS FILE DOES AND DOES NOT DO ──
// It finds the XML and reads the money out of it. It does not validate against EN 16931, does not
// check Schematron, does not care about line items, and it refuses anything it cannot read
// completely and consistently — a half-parsed e-invoice is worth less than no e-invoice, because
// it would be trusted.
//
// Both syntaxes are supported because both occur: CII (Factur-X / ZUGFeRD / XRechnung) and UBL
// (Peppol / NLCIUS). They are two spellings of the same European semantic model, and an importer
// that knows only one fails SILENTLY on the other — the totals simply are not where it looked.

import zlib from 'node:zlib'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFHexString, PDFString } from 'pdf-lib'
import { round2 } from './invoice-totals'

/** What an e-invoice states about the money. Every field required — see completeness below. */
export interface EInvoiceFigures {
  totalIncBtw: number
  totalExBtw: number
  btwAmount: number
  /** 'cii' (Factur-X / ZUGFeRD / XRechnung) or 'ubl' (Peppol / NLCIUS). For the audit trail. */
  syntax: 'cii' | 'ubl'
  /** The document's own number, when it states one. Never invented. */
  invoiceNumber: string | null
  /**
   * [E-FACTUUR-XML] The rest of what an import needs, so a Peppol invoice arriving on its own can
   * be booked WITHOUT a model reading anything. Every one of these is null when the document does
   * not state it — null is a fact here, and a guess would undo the whole point of this file.
   */
  vendorName: string | null
  /** ISO yyyy-mm-dd. */
  invoiceDate: string | null
  dueDate: string | null
  vendorIban: string | null
  paymentReference: string | null
  /** A credit note states itself as one in its root element; the amounts are then money coming back. */
  isCreditNote: boolean
}

/**
 * The attachment names the standards use. ZUGFeRD 1.0 called it something else than 2.x, and an
 * extractor that knows only the current name fails silently on the older one — the file is there,
 * nothing looks for it, and the PDF is treated as an ordinary picture.
 */
const EMBEDDED_XML_NAMES = [
  'factur-x.xml',        // Factur-X, ZUGFeRD 2.1+
  'zugferd-invoice.xml', // ZUGFeRD 1.0 and 2.0
  'xrechnung.xml',       // XRechnung as a PDF attachment
  'cii.xml',
  'ubl-invoice.xml',
]

/**
 * [LEES] The detailed answer: the XML, and whether a KNOWN e-invoice attachment existed that we
 * could not decompress. That second fact used to vanish — "no XML" and "an e-invoice is present
 * but unreadable" looked identical, and the second one is a claim about the document the review
 * screen should get to see.
 */
export interface EmbeddedXmlResult {
  xml: string | null
  /** A filespec under a STANDARD e-invoice name existed but its stream would not inflate. */
  unreadablePresent: boolean
}

export function extractEmbeddedInvoiceXmlDetailed(pdfBytes: Buffer): Promise<EmbeddedXmlResult> {
  return extractEmbedded(pdfBytes).catch(() => ({ xml: null, unreadablePresent: false }))
}

/**
 * The invoice XML carried inside a PDF, or null when there is none.
 *
 * Never throws: this runs on untrusted mail inside the sync loop, and a malformed PDF must leave
 * the import exactly as it was rather than take the batch down.
 */
export function extractEmbeddedInvoiceXml(pdfBytes: Buffer): Promise<string | null> {
  return extractEmbeddedInvoiceXmlDetailed(pdfBytes).then((r) => r.xml)
}

async function extractEmbedded(pdfBytes: Buffer): Promise<EmbeddedXmlResult> {
  // updateMetadata:false — we only read. throwOnInvalidObject stays off so a slightly broken but
  // readable PDF still gives up its attachment.
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const geen: EmbeddedXmlResult = { xml: null, unreadablePresent: false }
  const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict)
  if (!names) return geen
  const embedded = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict)
  if (!embedded) return geen
  const list = embedded.lookup(PDFName.of('Names'), PDFArray)
  if (!list) return geen

  // The array alternates name, filespec, name, filespec…
  let fallback: string | null = null
  let unreadablePresent = false
  for (let i = 0; i + 1 < list.size(); i += 2) {
    const rawName = list.lookup(i)
    const name =
      rawName instanceof PDFHexString || rawName instanceof PDFString
        ? rawName.decodeText()
        : String(rawName ?? '')
    const spec = list.lookup(i + 1, PDFDict)
    if (!spec) continue
    const gelezen = readFileSpec(spec)
    const isKnownName = EMBEDDED_XML_NAMES.includes(name.toLowerCase().trim())
    if (!gelezen.content) {
      // [LEES] A factur-x.xml that will not inflate is not "no XML" — it is an e-invoice we
      // could not read, and the review screen should get to say so. Only STANDARD names count:
      // a random broken attachment makes no claim about the invoice.
      if (isKnownName && gelezen.unreadable) unreadablePresent = true
      continue
    }
    if (isKnownName) return { xml: gelezen.content, unreadablePresent }
    // A .xml attachment under a name nobody standardised is still worth a look — but only after
    // every known name has been ruled out, so a real factur-x.xml always wins.
    if (fallback === null && /\.xml$/i.test(name) && looksLikeInvoiceXml(gelezen.content)) fallback = gelezen.content
  }
  return { xml: fallback, unreadablePresent }
}

function readFileSpec(spec: PDFDict): { content: string | null; unreadable: boolean } {
  const ef = spec.lookup(PDFName.of('EF'), PDFDict)
  if (!ef) return { content: null, unreadable: false }
  const stream = ef.lookup(PDFName.of('F')) ?? ef.lookup(PDFName.of('UF'))
  if (!(stream instanceof PDFRawStream)) return { content: null, unreadable: false }
  const raw = Buffer.from(stream.getContents())
  const filter = String(stream.dict.get(PDFName.of('Filter')) ?? '')
  try {
    // FlateDecode is what every producer uses; an uncompressed attachment is legal too.
    const bytes = filter.includes('FlateDecode') ? zlib.inflateSync(raw) : raw
    return { content: stripBom(bytes.toString('utf8')), unreadable: false }
  } catch {
    // A stream we cannot inflate is not evidence about the invoice — but its PRESENCE is a fact
    // the caller may report ([LEES]); the reading path itself stays exactly as it was.
    return { content: null, unreadable: true }
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * [E-FACTUUR-XML] The media type an e-invoice XML travels under, and the test for it.
 *
 * The REAL one, not an invented marker: this value is written to Storage as the object's
 * content-type and to documents.file_type, where a made-up media type would follow the file
 * around for seven years and confuse every viewer that opens it.
 *
 * It lives HERE rather than beside one door, because both doors need it. That is not tidiness —
 * the e-mail sync could read a Peppol invoice and the camera/upload door could not, so the same
 * file was an exact booking through one door and "a format we cannot read" through the other.
 */
export const E_INVOICE_XML_MIME = 'application/xml'

export function isEInvoiceXmlMime(mimeType: string): boolean {
  return (mimeType || '').split(';')[0].trim().toLowerCase() === E_INVOICE_XML_MIME
}

/**
 * Do these bytes look like an invoice XML?
 *
 * Asked of the CONTENT, never of the media type a browser or a mail server supplied. A .xml
 * uploaded from a phone arrives with an empty type, "text/xml", "application/xml" or
 * "application/octet-stream" depending on nothing in particular, and a document this exact must
 * not be lost to whichever string the client happened to send.
 */
export function looksLikeInvoiceXmlBytes(bytes: Buffer): boolean {
  if (bytes.length < 32 || bytes.length > 8 * 1024 * 1024) return false
  // Only the head: enough to see the root element, cheap on a large file.
  return looksLikeInvoiceXml(bytes.subarray(0, 8192).toString('utf8'))
}

/** Cheap shape test, so an unrelated .xml attachment is not parsed as an invoice. */
export function looksLikeInvoiceXml(xml: string): boolean {
  const head = xml.slice(0, 4000)
  return /<(?:\w+:)?(?:CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(head)
}

/**
 * The money an e-invoice states, or null when it does not state it completely.
 *
 * NULL IS THE IMPORTANT RETURN. A partially-read e-invoice is worse than none, because whatever it
 * produced would be trusted above the model — so anything short of three self-consistent figures
 * in euro is refused, and the ordinary reading path carries on untouched.
 */
export function parseEInvoice(xml: string): EInvoiceFigures | null {
  if (!xml || !looksLikeInvoiceXml(xml)) return null
  const isCii = /<(?:\w+:)?CrossIndustryInvoice[\s>]/.test(xml.slice(0, 4000))
  return isCii ? parseCii(xml) : parseUbl(xml)
}

/**
 * Factur-X / ZUGFeRD / XRechnung. The totals live together in one summation block, and they are
 * read from INSIDE it on purpose: the same element names occur again per line and per tax rate, so
 * a document-wide search for GrandTotalAmount can pick up a line's figure on some layouts.
 */
function parseCii(xml: string): EInvoiceFigures | null {
  const block = firstBlock(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  if (!block) return null
  const inc = firstAmount(block, 'GrandTotalAmount')
  const ex = firstAmount(block, 'TaxBasisTotalAmount')
  const btw = firstAmount(block, 'TaxTotalAmount')
  const currency = firstCurrency(block, 'GrandTotalAmount') ?? firstCurrency(block, 'TaxTotalAmount')
  const header = firstBlock(xml, 'ExchangedDocument')
  // The seller's own block — scoped, because the buyer's block carries the very same element names
  // and putting the BUYER on the invoice as the supplier is a mistake nothing downstream can catch.
  const seller = firstBlock(xml, 'SellerTradeParty')
  const payee = firstBlock(xml, 'SpecifiedTradeSettlementPaymentMeans')
  const terms = firstBlock(xml, 'SpecifiedTradePaymentTerms')
  return complete({
    inc, ex, btw, currency, syntax: 'cii',
    invoiceNumber: header ? firstText(header, 'ID') : null,
    vendorName: seller ? firstText(seller, 'Name') : null,
    invoiceDate: header ? ciiDate(header) : null,
    dueDate: terms ? ciiDate(terms) : null,
    vendorIban: payee ? firstText(payee, 'IBANID') : null,
    paymentReference: firstText(xml, 'PaymentReference'),
    isCreditNote: false,
  })
}

/** CII writes dates as <udt:DateTimeString format="102">20260312</udt:DateTimeString>. */
function ciiDate(block: string): string | null {
  const raw = firstText(block, 'DateTimeString')
  if (!raw) return null
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (ISO_DAY.test(raw.trim()) ? raw.trim() : null)
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Peppol / NLCIUS. LegalMonetaryTotal is the header block; the per-rate figures sit in TaxSubtotal
 * with the SAME element names, which is exactly the trap the block-scoped read avoids.
 *
 * BTW is taken from LegalMonetaryTotal's own two figures rather than from TaxTotal/TaxAmount,
 * because TaxAmount appears once per rate as well and the first occurrence is not always the total.
 * The subtraction cannot pick the wrong element; a mis-picked TaxAmount can.
 *
 * ── [VOORUITBETALING] WHICH GROSS THE SUBTRACTION USES ─────────────────────────────────────────
 *
 * TaxInclusiveAmount (BT-112), never PayableAmount (BT-115). This read used to prefer the payable,
 * and the comment beside it conceded the whole problem — "TaxInclusiveAmount equals it except when
 * a prepayment or a rounding line is present" — and then derived the tax from the one figure that
 * differs in exactly that case. EN 16931 defines them apart:
 *
 *     BR-CO-15   TaxInclusiveAmount = TaxExclusiveAmount + TaxAmount
 *     BR-CO-16   PayableAmount      = TaxInclusiveAmount - PrepaidAmount + PayableRoundingAmount
 *
 * So on a conformant invoice with a EUR 200 deposit already paid (ex 1000, btw 210, incl 1210,
 * prepaid 200, payable 1010) the subtraction returned btw 10, and the invoice booked with EUR 10
 * of voorbelasting instead of 210 — EUR 200 of deductible BTW gone from rubriek 5b. With a EUR 500
 * deposit it returned btw -290 on an ordinary purchase invoice. Measured, both of them.
 *
 * Nothing downstream could catch it. complete()'s ex + btw == inc test is VACUOUS here, because
 * btw is defined as inc - ex; the file validates against Peppol; and an e-factuur stands the money
 * gates down and auto-books, so no human ever saw the figure. The CII path next door reads all
 * three amounts independently and was never wrong — the two syntaxes in this one file disagreed
 * about which figure is the invoice total.
 *
 * The prepayment is not lost by ignoring it: it is a PAYMENT against this invoice, and payments
 * are matched from the bank. The invoice's own gross is what the books and the aangifte need.
 */
function parseUbl(xml: string): EInvoiceFigures | null {
  const block = firstBlock(xml, 'LegalMonetaryTotal')
  if (!block) return null
  const ex = firstAmount(block, 'TaxExclusiveAmount')
  const taxInclusive = firstAmount(block, 'TaxInclusiveAmount')
  const payable = firstAmount(block, 'PayableAmount')
  // A producer that omits BT-112 is not conformant, but the invoice is still readable: BR-CO-16
  // run backwards recovers the gross exactly. Absent prepayment and rounding are 0 by definition,
  // so on the ordinary invoice this reduces to the payable, which is what it always was.
  const prepaid = firstAmount(block, 'PrepaidAmount') ?? 0
  const rounding = firstAmount(block, 'PayableRoundingAmount') ?? 0
  const inc = taxInclusive ?? (payable !== null ? round2(payable + prepaid - rounding) : null)
  const currency = firstCurrency(block, 'TaxInclusiveAmount') ?? firstCurrency(block, 'PayableAmount')
  const btw = inc !== null && ex !== null ? round2(inc - ex) : null
  const head = xml.slice(0, indexOfFirstCac(xml))
  // Scoped to the SUPPLIER's block: AccountingCustomerParty holds the same element names, and the
  // buyer booked as the supplier is a mistake nothing downstream can catch.
  const supplier = firstBlock(xml, 'AccountingSupplierParty')
  const payment = firstBlock(xml, 'PayeeFinancialAccount')
  return complete({
    inc, ex, btw, currency, syntax: 'ubl',
    // The document-level ID is the first cbc:ID before any cac: block starts.
    invoiceNumber: firstText(head, 'ID'),
    // RegistrationName is the legal name (BT-27); Name is the trading name. Prefer the legal one,
    // fall back to the other — a supplier that states only one must still be recognisable.
    vendorName: supplier
      ? (firstText(supplier, 'RegistrationName') ?? firstText(supplier, 'Name'))
      : null,
    invoiceDate: isoDay(firstText(head, 'IssueDate')),
    dueDate: isoDay(firstText(head, 'DueDate')),
    vendorIban: payment ? firstText(payment, 'ID') : null,
    paymentReference: firstText(xml, 'PaymentID'),
    isCreditNote: /<(?:\w+:)?CreditNote[\s>]/.test(xml.slice(0, 4000)),
  })
}

function isoDay(v: string | null): string | null {
  return v && ISO_DAY.test(v.trim()) ? v.trim() : null
}

/**
 * The single gate every parse passes through.
 *
 * Three figures, in euro, that agree with each other to the cent. An e-invoice whose own numbers do
 * not add up is not a better witness than the model — it is a broken document, and treating it as
 * authoritative would be the worst possible outcome of this whole feature.
 */
/**
 * [EURO-ALLEEN] May this document's amounts be booked as euros?
 *
 * Absent is accepted — some producers omit the attribute, and a Dutch supplier billing a Dutch
 * customer in euros is what the omission almost always means. A STATED non-euro currency is not:
 * this app books euro, and silently treating 1 200 SEK as EUR 1 200 is the kind of error that
 * survives every other check in the building. The amounts are internally consistent, the file
 * validates against Peppol, and nothing downstream has a currency to compare against.
 *
 * Not the same rule as [VREEMDE-VALUTA] (vreemde-valuta.ts), which asks the same question about a
 * currency the MODEL read off a PDF. There an unrecognisable symbol ("kr", a bare "$") must not
 * count, because it is an OCR guess; here the value came from a validated XML field that is a
 * currency code by construction, so anything that is not EUR is refused — and refusing is cheap:
 * only this witness is dropped, the document is still read.
 *
 * EXPORTED because there are TWO doors onto the same bytes and only one of them asked. A Peppol
 * invoice arriving as a PDF attachment goes through parseEInvoice/complete() and was refused; the
 * same invoice uploaded as a standalone .xml goes through parseUblInvoice in /api/intake, which
 * extracts DocumentCurrencyCode and handed it to a caller that never looked. Measured on one file,
 * both doors: USD 10.000 refused here, booked as EUR 10.000 there — including its voorbelasting,
 * claimed at a euro amount nobody ever paid.
 */
export function isEuroDocument(currency: string | null | undefined): boolean {
  if (currency == null || String(currency).trim() === "") return true;
  return String(currency).trim().toUpperCase() === "EUR";
}

function complete(v: {
  inc: number | null; ex: number | null; btw: number | null
  currency: string | null; syntax: 'cii' | 'ubl'; invoiceNumber: string | null
  vendorName: string | null; invoiceDate: string | null; dueDate: string | null
  vendorIban: string | null; paymentReference: string | null; isCreditNote: boolean
}): EInvoiceFigures | null {
  const { inc, ex, btw } = v
  if (inc === null || ex === null || btw === null) return null
  if (![inc, ex, btw].every((n) => Number.isFinite(n))) return null
  // Currency: absent is accepted (some producers omit the attribute), a NON-euro one is not — this
  // app books euro, and silently treating 1 200 SEK as € 1 200 is the kind of error that survives
  // every other check in the building.
  if (!isEuroDocument(v.currency)) return null
  if (Math.abs(inc) < 0.005) return null
  // [VOORUITBETALING] This line is REAL for CII and VACUOUS for UBL, and the difference is worth
  // knowing before anyone leans on it. parseCii reads GrandTotalAmount, TaxBasisTotalAmount and
  // TaxTotalAmount as three independent figures, so this genuinely cross-checks them. parseUbl
  // DEFINES btw as inc - ex, so ex + btw == inc always holds there — it can never fail, whatever
  // the two amounts were read from. That is why reading the wrong gross went unnoticed: the check
  // that looks like it would catch it cannot.
  if (Math.abs(round2(ex + btw) - round2(inc)) > 0.01) return null
  return {
    totalIncBtw: round2(inc),
    totalExBtw: round2(ex),
    btwAmount: round2(btw),
    syntax: v.syntax,
    invoiceNumber: v.invoiceNumber?.trim() || null,
    vendorName: v.vendorName?.trim() || null,
    invoiceDate: v.invoiceDate,
    dueDate: v.dueDate,
    // [PAY-SAFE] An IBAN is only carried when it IS one. A malformed value here would reach the
    // bank matcher and the payment sheet, where a wrong account number is the costliest field
    // on the whole invoice.
    vendorIban: normalizedIban(v.vendorIban),
    paymentReference: v.paymentReference?.trim() || null,
    isCreditNote: v.isCreditNote,
  }
}

/** Upper-cased, spaces removed, and only when it has the shape of a real IBAN. */
function normalizedIban(raw: string | null): string | null {
  const s = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) ? s : null
}

// ─── Tag scanning ─────────────────────────────────────────────────────────────
//
// Namespace PREFIXES are chosen by whoever wrote the document — rsm/ram/cbc/cac are conventions,
// not rules, and a producer may bind the same namespace to any prefix it likes. So every match here
// is on the LOCAL name with an optional prefix, never on the prefix itself. A parser that keys on
// "ram:" reads a correct invoice as an empty one.

function localTag(name: string): string {
  return `(?:[A-Za-z0-9_.-]+:)?${name}`
}

/** The inside of the first <name>…</name>, so sibling blocks cannot leak into a header read. */
function firstBlock(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${localTag(name)}>`, 'i')
  return re.exec(xml)?.[1] ?? null
}

function firstText(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}(?:\\s[^>]*)?>([^<]*)</${localTag(name)}>`, 'i')
  const raw = re.exec(xml)?.[1]
  return raw === undefined ? null : decodeXmlEntities(raw).trim()
}

function firstAmount(xml: string, name: string): number | null {
  const raw = firstText(xml, name)
  if (raw === null || raw.trim() === '') return null
  // XML amounts are always '.' decimal with no grouping (EN 16931), so no locale guessing here —
  // guessing is what produces a factor-of-1000 error, and this is the one place we need not.
  const n = Number(raw.trim())
  return Number.isFinite(n) ? n : null
}

function firstCurrency(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}\\s[^>]*currencyID\\s*=\\s*"([^"]*)"`, 'i')
  return re.exec(xml)?.[1]?.trim() || null
}

/** Where the first cac: (aggregate) element begins — everything before it is document-level. */
function indexOfFirstCac(xml: string): number {
  const m = /<(?:[A-Za-z0-9_.-]+:)?(?:AccountingSupplierParty|AccountingCustomerParty|InvoiceLine|LegalMonetaryTotal|TaxTotal)[\s>]/i.exec(xml)
  return m ? m.index : xml.length
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.

/**
 * Does the supplier's own statement contradict what was read off the page?
 *
 * A cent of tolerance, because the two come from different places and either may be rounded for
 * display. Anything larger is not a rounding difference: it is the document and the reading
 * disagreeing about how much money this is.
 */
export function eInvoiceContradicts(
  figures: EInvoiceFigures,
  readTotalIncBtw: number | null | undefined,
): boolean {
  if (typeof readTotalIncBtw !== 'number' || !Number.isFinite(readTotalIncBtw)) return false
  return Math.abs(Math.abs(readTotalIncBtw) - Math.abs(figures.totalIncBtw)) > 0.01
}

/**
 * The e-invoice verdict stored on the row by the reader, for the gates that must act on it.
 *
 * Mirrors groundingOf/placementOf: field_confidence is jsonb, so every reader validates rather than
 * trusts. `null` means the question could not be asked — never that it was answered "fine".
 */
export function eInvoiceOf(fieldConfidence: unknown): (EInvoiceFigures & { contradicts: boolean }) | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const e = (fieldConfidence as Record<string, unknown>)._einvoice
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>
  const nums = ['totalIncBtw', 'totalExBtw', 'btwAmount'] as const
  if (!nums.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number))) return null
  if (o.syntax !== 'cii' && o.syntax !== 'ubl') return null
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  return {
    totalIncBtw: o.totalIncBtw as number,
    totalExBtw: o.totalExBtw as number,
    btwAmount: o.btwAmount as number,
    syntax: o.syntax,
    invoiceNumber: str('invoiceNumber'),
    vendorName: str('vendorName'),
    invoiceDate: str('invoiceDate'),
    dueDate: str('dueDate'),
    vendorIban: str('vendorIban'),
    paymentReference: str('paymentReference'),
    isCreditNote: o.isCreditNote === true,
    contradicts: o.contradicts === true,
  }
}

/** Does the supplier's own file disagree with what was read? Only `true` blocks; unknown never does. */
export function eInvoiceContradictsRead(fieldConfidence: unknown): boolean {
  return eInvoiceOf(fieldConfidence)?.contradicts === true
}

/**
 * Is the money on this row SETTLED by the supplier's own file, rather than read off a page?
 *
 * ── WHY THIS PREDICATE HAD TO EXIST ──
 * Everything this app does to be sure of an amount guards ONE risk: the reading might be wrong.
 * The arithmetic gate compares three figures one read produced. field_confidence is the model's
 * opinion of its own answer. [GEGROND] asks whether the figure occurs in the document's own
 * characters. [DOCCHECK] asks whether it sits where a total is printed. The OCR pass is a second
 * reading. Five ways of asking "did we read this right?".
 *
 * When a complete, self-consistent e-invoice is present and AGREES with the read, that risk is
 * gone. Not reduced — gone. The supplier stated the number in a form with nothing to interpret,
 * and the read matches it to the cent. Continuing to hold such an invoice out of the queue because
 * the MODEL was only 0.72 sure of a number the SUPPLIER already stated is guarding a doubt that no
 * longer exists.
 *
 * That was the shape of the mistake: the strongest witness in the building was wired in as a sixth
 * check on the reading instead of as a replacement for it. This turns it into the answer.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SETTLE ──
 * Only the money. parseEInvoice reads totals, not what KIND of document this is. A statement, a
 * reminder and a creditnota can all carry perfectly valid XML, and each of those still needs a
 * human — so every gate about the document's kind, about duplicates, and about the vendor, number
 * and date stays exactly where it was. This narrows one axis; it does not open a door.
 *
 * ── AND IT FAILS CLOSED, LIKE EVERYTHING AROUND IT ──
 * No e-invoice → false. Unreadable or incomplete XML → parseEInvoice already refused it, so the
 * row carries nothing and this is false. Contradiction → false, and the contradiction keeps its
 * own, stronger refusal elsewhere. There is no input to this function that turns absence of
 * evidence into evidence.
 */
export function eInvoiceSettlesAmounts(fieldConfidence: unknown): boolean {
  const e = eInvoiceOf(fieldConfidence)
  if (e === null) return false

  // ── A CREDIT NOTE SETTLES NOTHING, EVEN WHEN ITS XML IS PERFECT ──
  // This case did not exist when this function was written; it appeared when [E-FACTUUR-XML]
  // taught the parser to read `isCreditNote` off the root element, and it is exactly the kind of
  // gap that opens between two changes that are each correct on their own.
  //
  // Auto-advance already refuses a credit note — but on the READER's verdict (is_credit_note,
  // invoice_type). When the model missed it and only the XML knows, relaxing the money gates on
  // the strength of that same XML would be using the supplier's file to wave through the one
  // document whose SIGN it just told us is inverted. Magnitude is not the question on a credit
  // note; direction is, and this function has no opinion about direction.
  if (e.isCreditNote) return false

  // ── AND WHY THIS DOES NOT SIMPLY READ e.contradicts ──
  // eInvoiceOf normalises with `=== true`, which is right for a gate that only acts on `true`: a
  // missing or malformed value must not BLOCK anything. Here the direction is reversed — this
  // function GRANTS — and the same normalisation would turn `contradicts: "nee"`, or any other
  // corrupted value, into a clean bill of health. A test written for the opposite reason found it.
  //
  // So the raw value is read again, and only two shapes settle anything:
  //   absent  — an older row, read before the comparison was stored. The reader has written this
  //             field on every extraction since; absent means the question predates the field, not
  //             that it was dodged.
  //   false   — the comparison ran and the figures agreed.
  // Anything else is a value we do not understand, and a value we do not understand is a doubt.
  const raw = ((fieldConfidence as Record<string, unknown>)._einvoice as Record<string, unknown>)
    .contradicts
  return raw === undefined || raw === false
}
