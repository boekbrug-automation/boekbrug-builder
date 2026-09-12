// [DOCCHECK] Pure node test — run: npx tsx --test src/lib/document-verify.test.ts
//
// [GEGROND] proved a figure is PRINTED. Measurement then showed what that still lets through: on a
// real layout, reading the SUBTOTAL, a LINE ITEM or the BTW as the total all came back 'found',
// because all three are printed. Only an invented number was caught.
//
// So the question had to get sharper — is it printed WHERE A TOTAL IS PRINTED? — and this file
// holds both halves of that: the wrong picks are caught, and the correct ones are not flagged.
//
// The second half is the one that decides whether this ships. A false alarm on a correct invoice is
// what makes a safety feature get switched off, and then the real warning is gone too.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  verifyTotal, verifyDate, verifyInvoiceNumber, verifyDocument, documentCheckBlocks,
  amountsIn, anchoredAmounts, findPrintedSplit,
} from './document-verify'

const clean = { date: 'found' as const, invoiceNumber: 'found' as const, btw: 'found' as const, btwContradiction: null }
const blocks = (total: ReturnType<typeof verifyTotal>) => documentCheckBlocks({ total, ...clean })

// The layout every earlier example came from.
const FACTUUR = `
ATAPACK Cash & Carry B.V.   factuur 26302050    01-06-2026
2 x Doos A          149,00        298,00
1 x Doos B          573,24        573,24
Subtotaal                        1.872,24
BTW 21%                            393,17
Totaal te betalen              € 2.265,41
`

test('[DOCCHECK] the four reads [GEGROND] could not tell apart', () => {
  // All four are printed on the paper, so "is it printed?" answers 'found' to every one of them.
  // This is the measurement that produced this module.
  assert.equal(verifyTotal(2265.41, FACTUUR), 'anchored', 'the real total is labelled as the total')
  assert.equal(verifyTotal(1872.24, FACTUUR), 'present', 'the subtotal is printed — and is not the total')
  assert.equal(verifyTotal(573.24, FACTUUR), 'present', 'a line item likewise')
  assert.equal(verifyTotal(393.17, FACTUUR), 'present', 'and the BTW')
  assert.equal(verifyTotal(2266.0, FACTUUR), 'absent', 'an invented figure is not printed at all')

  assert.equal(blocks('anchored'), false)
  for (const v of ['present', 'absent'] as const) {
    assert.equal(blocks(v), true, `${v} must hold the invoice for a human`)
  }
})

test('[DOCCHECK] a correct invoice is never flagged — fourteen real layouts', () => {
  // The half that decides whether this ships. One false alarm on a correct invoice teaches an owner
  // to ignore the warning, and then the true one is gone with it.
  const CORRECT: Array<[string, number, string]> = [
    ['classic Totaal te betalen', 2265.41, 'Subtotaal 1.872,24\nBTW 21% 393,17\nTotaal te betalen € 2.265,41'],
    ['bare Totaal',               121.0,   'Bedrag 100,00\nBTW 21,00\nTotaal 121,00'],
    ['Totaalbedrag',              89.95,   'Artikel 74,34\nBTW 15,61\nTotaalbedrag 89,95'],
    ['Te betalen only',           45.5,    'Levering 37,60\nBTW 7,90\nTe betalen 45,50'],
    ['English total',             500.0,   'Subtotal 413,22\nVAT 86,78\nTotal 500,00'],
    ['German Gesamtbetrag',       238.0,   'Netto 200,00\nMwSt 38,00\nGesamtbetrag 238,00'],
    ['no label at all',           310.0,   'Regel A 100,00\nRegel B 156,20\nBTW 53,80\n310,00'],
    ['Totaal incl. btw',          1000.0,  'Totaal excl. btw 826,45\nBTW 173,55\nTotaal incl. btw 1.000,00'],
    ['dotted leader',             2265.41, 'Totaal te betalen .............. 2.265,41'],
    ['amount before its label',   75.0,    'BTW 13,02\n75,00 Totaal'],
    ['multi-rate invoice',        1210.0,  'Regel 9% 500,00\nRegel 21% 500,00\nBTW 9% 45,00\nBTW 21% 105,00\nSubtotaal 1.000,00\nTotaal 1.210,00'],
    ['creditnota (negative)',     -6.81,   'Creditnota CR0300343\nBTW 1,18\nTotaal te betalen 6,81'],
    ['Eindtotaal',                42.35,   'Post 1 35,00\nBTW 7,35\nEindtotaal 42,35'],
    ['Factuurbedrag',             274.86,  'Levering 227,16\nBTW 47,70\nFactuurbedrag 274,86'],
  ]
  const flagged = CORRECT.filter(([, amt, text]) => blocks(verifyTotal(amt, text))).map(([n]) => n)
  assert.deepEqual(flagged, [], 'these CORRECT invoices were held for a human')
})

test('[DOCCHECK] "totaal excl. btw" must never anchor the incl total', () => {
  // The permissive failure that matters most: if an excl-label anchored, the module would bless the
  // exact read it exists to catch, and do it with more confidence than before.
  const t = 'Totaal excl. btw 826,45\nBTW 173,55\nTotaal incl. btw 1.000,00'
  assert.equal(verifyTotal(826.45, t), 'present', 'the excl figure is not the total')
  assert.equal(verifyTotal(1000.0, t), 'anchored')
  // Same for "Subtotaal", which contains "totaal".
  assert.equal(verifyTotal(1872.24, 'Subtotaal 1.872,24\nTotaal 2.265,41'), 'present')
  assert.ok(!anchoredAmounts('Subtotaal 1.872,24').includes(1872.24))
  assert.ok(!anchoredAmounts('Totaal exclusief btw 826,45').includes(826.45))
})

test('[DOCCHECK] a photo blocks nothing — the check simply did not run', () => {
  assert.equal(verifyTotal(2265.41, null), 'unreadable')
  assert.equal(blocks('unreadable'), false, 'a photographed receipt is the ordinary case, not a defect')
})

test('[DOCCHECK] the date finally has a witness', () => {
  // Under factuurstelsel the invoice date picks the BTW quarter, and nothing had ever compared it
  // with the document. A date read one month wrong moves BTW between two filings.
  for (const printed of [
    'Factuurdatum 01-06-2026', 'Datum: 1-6-2026', 'Datum 01/06/2026', 'Datum 01.06.2026',
    '2026-06-01', '1 juni 2026', '01 juni 2026', '1 jun 2026',
  ]) {
    assert.equal(verifyDate('2026-06-01', printed), 'found', `not found in: ${printed}`)
  }
  assert.equal(verifyDate('2026-07-01', 'Factuurdatum 01-06-2026'), 'absent', 'a month wrong is absent')
  assert.equal(verifyDate('2026-06-01', null), 'unreadable')
  assert.equal(verifyDate(null, 'Datum 01-06-2026'), 'unreadable')
})

test('[DOCCHECK-TAAL] and it reads the date on an English invoice, which is where it was failing', () => {
  // Not hypothetical, and not an edge case. Of the 86 incoming invoices carrying a stored _doccheck
  // on 12 September 2026, seven said the date was 'absent' — and all seven were English-language
  // SaaS invoices (Anthropic, Vercel, Eleven Labs, Supabase) whose date was perfectly correct.
  // Their stored fingerprint is identical in every case:  total 'anchored', invoiceNumber 'found',
  // date 'absent'.  The text layer was read fine; only the date FORM was unmatched, because the
  // month table held Dutch alone while TOTAL_WORDS had carried English and German all along.
  //
  // So the verdict that is supposed to be the date's one witness was, in production, wrong every
  // single time it spoke — seven owners told to check a date that was right. That is how a warning
  // stops being read, and this file argues exactly that about three other checks.
  const bill = (printed: string) =>
    `INVOICE\nAnthropic, PBC\nDate of issue ${printed}\nInvoice number SSY2ZA5L-0007\nAmount due  20.00\n`
  for (const printed of [
    'August 13, 2026', 'Aug 13, 2026', 'Aug. 13, 2026', '13 August 2026', '13 Aug 2026',
    'August 13 2026', '2026/08/13',
  ]) {
    assert.equal(verifyDate('2026-08-13', bill(printed)), 'found', `not found in: ${printed}`)
  }
  // The three months where slicing the Dutch name to three letters does NOT give the English one.
  // These are the ones a `monthName.slice(0, 3)` shortcut silently missed while looking correct.
  assert.equal(verifyDate('2026-03-02', bill('2 Mar 2026')), 'found', 'maart/March')
  assert.equal(verifyDate('2026-05-02', bill('2 May 2026')), 'found', 'mei/May')
  assert.equal(verifyDate('2026-10-02', bill('2 Oct 2026')), 'found', 'oktober/October')
  // German, for the same reason TOTAL_WORDS lists 'Gesamtbetrag'.
  assert.equal(verifyDate('2026-03-02', bill('2. März 2026')), 'found')
  assert.equal(verifyDate('2026-12-02', bill('2. Dezember 2026')), 'found')
})

test('[DOCCHECK-VOLGORDE] month-first NUMERIC only when the day cannot be a month', () => {
  // This is the one place where being more permissive would cost the check its entire value.
  //
  // The day/month swap is the classic silent date error — 1 February read as 2 January is a valid
  // date, the reader is confident, no amount changes, and nothing else in the app can see it. This
  // witness can, and only because it refuses to read an ambiguous string both ways.
  const paper = (d: string) => `FACTUUR\nFactuurdatum: ${d}\nTotaal 121,00\n`

  // Above 12 there is only one possible reading, so matching the American order is free.
  assert.equal(verifyDate('2026-08-13', paper('08-13-2026')), 'found', 'no thirteenth month exists')
  assert.equal(verifyDate('2026-08-13', paper('8/13/2026')), 'found')
  assert.equal(verifyDate('2026-08-13', paper('13-08-2026')), 'found', 'and the Dutch order of it')

  // At or below 12 both readings exist, and the swapped one must NOT be accepted.
  assert.equal(verifyDate('2026-01-02', paper('01-02-2026')), 'absent',
    'the paper says 1 February; accepting the American reading would bless 2 January')
  assert.equal(verifyDate('2026-02-01', paper('01-02-2026')), 'found', 'the correct reading of it')
  assert.equal(verifyDate('2026-11-12', paper('11-12-2026')), 'absent', 'both ≤ 12, swapped')
  assert.equal(verifyDate('2026-12-11', paper('11-12-2026')), 'found', 'both ≤ 12, read right')
  assert.equal(verifyDate('2026-05-10', paper('05-10-2026')), 'absent')
  assert.equal(verifyDate('2026-10-05', paper('05-10-2026')), 'found')
})

test('[DOCCHECK] the invoice number too, and punctuation does not divide it', () => {
  // The number is what makes a duplicate detectable and what a payment quotes. A stored number that
  // is not on the paper is one nothing else can ever reconcile against.
  assert.equal(verifyInvoiceNumber('26302050', FACTUUR), 'found')
  assert.equal(verifyInvoiceNumber('2630-2050', FACTUUR), 'found', 'same number, different punctuation')
  assert.equal(verifyInvoiceNumber('99999999', FACTUUR), 'absent')
  // The app's own placeholders are not claims about the document.
  assert.equal(verifyInvoiceNumber('UPLOAD-1234567', FACTUUR), 'unreadable')
  assert.equal(verifyInvoiceNumber('EMAIL-999', FACTUUR), 'unreadable')
  // Too short to mean anything: confirming it would be noise dressed as evidence.
  assert.equal(verifyInvoiceNumber('7', FACTUUR), 'unreadable')
})

test('[DOCCHECK] the total and a contradicted split hold — the rest is reported', () => {
  // A date or a number that could not be found is worth SAYING. Holding an invoice for it would
  // fire on every document printing a date in a format nobody predicted, and a queue full of
  // correct invoices is how a safety feature gets switched off.
  //
  // A BTW that is merely NOT PRINTED is in that same category and holds nothing — every receipt
  // that prints a rate and a total leaves the split to be computed. What holds is a BTW that
  // contradicts a split the paper actually asserts; see [DOCCHECK-SPLIT].
  const noSplit = { btwContradiction: null }
  assert.equal(documentCheckBlocks({ total: 'anchored', date: 'absent', invoiceNumber: 'absent', btw: 'absent', ...noSplit }), false)
  assert.equal(documentCheckBlocks({ total: 'largest', date: 'absent', invoiceNumber: 'absent', btw: 'absent', ...noSplit }), false)
  assert.equal(documentCheckBlocks({ total: 'present', ...clean }), true)
  assert.equal(
    documentCheckBlocks({ total: 'anchored', date: 'found', invoiceNumber: 'found', btw: 'absent', btwContradiction: { excl: 21.45, btw: 4.5, rate: 21 } }),
    true,
    'a split the document contradicts holds the invoice, whatever the total says',
  )
})

test('[DOCCHECK] amountsIn reads money and ignores everything else', () => {
  // Requiring a 2-digit decimal part is what keeps order numbers, postcodes and article codes out
  // of the largest-amount comparison — one stray 99999 there would make every real total 'present'.
  const t = 'Order 20260601 postcode 1234 AB art. 88123 bedrag 1.234,56 en 78,90'
  assert.deepEqual(amountsIn(t).sort((a, b) => a - b), [78.9, 1234.56])
  // Both separator conventions, decided by whichever comes LAST.
  assert.deepEqual(amountsIn('2.265,41'), [2265.41])
  assert.deepEqual(amountsIn('2,265.41'), [2265.41])
})

test('[DOCCHECK] the whole check composes without inventing anything', () => {
  const c = verifyDocument(
    { totalIncBtw: 2265.41, btwAmount: 393.17, invoiceDate: '2026-06-01', invoiceNumber: '26302050' },
    FACTUUR,
  )
  assert.deepEqual(c, { total: 'anchored', date: 'found', invoiceNumber: 'found', btw: 'found', btwContradiction: null })

  // No text: every field says the check did not run. Not one of them says 'absent'.
  const blind = verifyDocument(
    { totalIncBtw: 2265.41, btwAmount: 393.17, invoiceDate: '2026-06-01', invoiceNumber: '26302050' },
    null,
  )
  assert.deepEqual(blind, { total: 'unreadable', date: 'unreadable', invoiceNumber: 'unreadable', btw: 'unreadable', btwContradiction: null })
  assert.equal(documentCheckBlocks(blind), false)
})

test('[DOCCHECK-SPLIT] the original € 0,46 error, which everything above still let through', () => {
  // Measured with the total-placement check already in place: it STILL booked. The total was right
  // and anchored, the arithmetic was consistent (21,91 + 4,04 = 25,95), and only the split was
  // invented — and the split held nothing, because the total was the only field that could hold an
  // invoice. The first error this whole line of work started from was still getting through.
  const paper = 'Subtotaal 21,45\nBTW 21% 4,50\nTotaal te betalen 25,95'

  const wrong = verifyDocument({ totalIncBtw: 25.95, btwAmount: 4.04 }, paper)
  assert.equal(wrong.total, 'anchored', 'the total was read correctly — nothing above this fires')
  assert.ok(Math.abs(21.91 + 4.04 - 25.95) <= 0.02, 'and the arithmetic gate passes too')
  assert.deepEqual(wrong.btwContradiction, { excl: 21.45, btw: 4.5, rate: 21 }, 'the paper says otherwise')
  assert.equal(documentCheckBlocks(wrong), true, 'and it is finally held')

  const right = verifyDocument({ totalIncBtw: 25.95, btwAmount: 4.5 }, paper)
  assert.equal(right.btwContradiction, null)
  assert.equal(documentCheckBlocks(right), false)
})

test('[DOCCHECK-SPLIT] "hold whenever the BTW is not printed" would have been the wrong fix', () => {
  // That naive rule fires on every receipt printing a rate and a total and leaving the split to be
  // computed — a large, legitimate class. A false alarm on correct documents is what gets a safety
  // feature switched off, so the question is narrower: does the paper print a DIFFERENT split?
  const CORRECT: Array<[string, { totalIncBtw: number; btwAmount: number | null }, string]> = [
    ['receipt: rate only, split computed', { totalIncBtw: 121, btwAmount: 21 }, 'Bon\nTotaal 121,00\n21% btw inbegrepen'],
    ['split printed, read matches',        { totalIncBtw: 25.95, btwAmount: 4.5 }, 'Subtotaal 21,45\nBTW 21% 4,50\nTotaal 25,95'],
    ['9% invoice',                         { totalIncBtw: 109, btwAmount: 9 }, 'Subtotaal 100,00\nBTW 9% 9,00\nTotaal 109,00'],
    ['0% / vrijgesteld',                   { totalIncBtw: 100, btwAmount: 0 }, 'Bedrag 100,00\nBTW 0% 0,00\nTotaal 100,00'],
    ['multi-rate, two splits printed',     { totalIncBtw: 1210, btwAmount: 150 }, 'Regel 9% 500,00\nRegel 21% 500,00\nBTW 9% 45,00\nBTW 21% 105,00\nSubtotaal 1.000,00\nTotaal 1.210,00'],
    ['a photo — no text at all',           { totalIncBtw: 25.95, btwAmount: 4.04 }, ''],
    ['no BTW read at all',                 { totalIncBtw: 25.95, btwAmount: null }, 'Subtotaal 21,45\nBTW 21% 4,50\nTotaal 25,95'],
  ]
  const flagged = CORRECT.filter(([, r, t]) => documentCheckBlocks(verifyDocument(r, t))).map(([n]) => n)
  assert.deepEqual(flagged, [], 'these correct reads were held for a human')
})

test('[DOCCHECK-SPLIT] a printed split needs BOTH numbers on the paper', () => {
  // One printed number plus arithmetic is not the document asserting anything — it is us inventing a
  // split and then holding an invoice against our own invention.
  assert.equal(findPrintedSplit(121, 'Totaal 121,00'), null, 'nothing else printed → no assertion')
  assert.equal(findPrintedSplit(121, 'Subtotaal 100,00\nTotaal 121,00'), null, 'the BTW is not printed')
  assert.deepEqual(findPrintedSplit(121, 'Subtotaal 100,00\nBTW 21,00\nTotaal 121,00'), { excl: 100, btw: 21, rate: 21 })
  // And the pair must land on a real Dutch rate — two amounts that merely add up are not a split.
  assert.equal(findPrintedSplit(121, 'Regel A 60,00\nRegel B 61,00\nTotaal 121,00'), null)
})
