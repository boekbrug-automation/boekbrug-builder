// [DD-SIGNAL] Pure node test — run: npx tsx --test src/lib/direct-debit.test.ts
//
// The fixtures are the shapes the four Dutch export formats actually produce. Two things are being
// held: that a real incasso is recognised from each of them, and — the half that costs money — that
// a STORNO is never read as a collection. A bounced direct debit carries every marker a successful
// one does; the only difference is which way the money went.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readDirectDebit,
  isCertainDirectDebit,
  isBankStatedReversal,
} from './direct-debit'

// ─── The four doors ───────────────────────────────────────────────────────────

test('[DD-SIGNAL] MT940: the :61: type code the parser was already capturing', () => {
  // NDDT is the SWIFT transaction type identification code for Direct Debit. It sits in group 6 of
  // parseMT940Transaction's regex, and the destructuring line skipped it with a bare comma.
  const dd = readDirectDebit({ typeCode: 'NDDT', amount: -83.70, text: 'HUUR AUGUSTUS' })
  assert.equal(dd.isDirectDebit, true)
  assert.equal(dd.signal, 'type-code')
  assert.equal(isCertainDirectDebit(dd), true, "the bank's own classification may be acted on")

  // The control: the same line as an ordinary transfer must stay one.
  const transfer = readDirectDebit({ typeCode: 'NTRF', amount: -83.70, text: 'HUUR AUGUSTUS' })
  assert.equal(transfer.isDirectDebit, false, 'NTRF is a credit transfer — the owner paid it themselves')
  assert.equal(transfer.signal, null)
})

test('[DD-SIGNAL] CAMT.053: the mandate reference is proof on its own', () => {
  // <Refs><MndtId> — a SEPA direct debit cannot exist without a mandate, and a credit transfer
  // never carries one. That makes this the strongest signal there is, stronger than the family code.
  const dd = readDirectDebit({ mandateId: 'M-2019-004417', typeCode: 'RDDT', amount: -74.96 })
  assert.equal(dd.signal, 'mandate', 'the mandate outranks the family code')
  assert.equal(dd.mandateId, 'M-2019-004417', 'and it is kept, not just counted')
  assert.equal(isCertainDirectDebit(dd), true)
})

test('[DD-SIGNAL] ING CSV: the Code column says IC', () => {
  const dd = readDirectDebit({ typeCode: 'IC', amount: -49.95, text: 'ONS IT B.V.' })
  assert.equal(dd.isDirectDebit, true)
  assert.equal(dd.signal, 'type-code')
  // And its neighbours in the same column must NOT be read as incasso.
  for (const code of ['GT', 'BA', 'OV', 'ID', 'GA', 'ST']) {
    assert.equal(
      readDirectDebit({ typeCode: code, amount: -49.95 }).isDirectDebit, false,
      `ING code ${code} is not an incasso`,
    )
  }
})

test('[DD-SIGNAL] ABN AMRO free text: the incassant-ID has a shape nothing else has', () => {
  // No column to ask, so the description is all there is. NL + 2 check digits + ZZZ + 12 — no IBAN,
  // invoice number or payment reference looks like that, which is what makes searching for it safe.
  const line = 'SEPA Incasso algemeen doorlopend Incassant: NL32ZZZ411951220000 Naam: WonenBreburg Machtiging: 100084417 Omschrijving: Huur augustus'
  const dd = readDirectDebit({ text: line, amount: -83.70 })
  assert.equal(dd.isDirectDebit, true)
  assert.equal(dd.signal, 'mandate', 'a labelled machtiging is the strongest thing in that line')
  assert.equal(dd.mandateId, '100084417')
  assert.equal(dd.creditorId, 'NL32ZZZ411951220000', 'both are kept — either identifies the collector')
})

test('[DD-SIGNAL] a creditor-ID with no mandate label still identifies the instrument', () => {
  const dd = readDirectDebit({ text: 'Incasso NL32ZZZ411951220000 periode 08-2026', amount: -83.70 })
  assert.equal(dd.signal, 'creditor-id')
  assert.equal(dd.creditorId, 'NL32ZZZ411951220000')
  assert.equal(isCertainDirectDebit(dd), true)
})

test('[DD-SIGNAL] the PSD2 statement line the mapper already stops at', () => {
  // enablebanking-map.ts names "Machtiging ID" and "Incassant ID" as segment labels it must stop
  // at — it knew them well enough to cut the remittance there, and then dropped them.
  const line = 'Naam: WonenBreburg Omschrijving: Huur augustus IBAN: NL65RABO0171136276 Machtiging ID: 100084417 Incassant ID: NL32ZZZ411951220000 Valutadatum: 01-08-2026'
  const dd = readDirectDebit({ text: line, amount: -83.70 })
  assert.equal(dd.isDirectDebit, true)
  assert.equal(dd.mandateId, '100084417')
  assert.equal(dd.creditorId, 'NL32ZZZ411951220000')
})

// ─── The half that costs money ────────────────────────────────────────────────

test('[DD-SIGNAL] a storno is never a collection', () => {
  // A bounced direct debit carries every marker a successful one does. The difference is the
  // direction: the money comes BACK. Reading it as a collection would mark an invoice paid at the
  // exact moment the bank un-paid it — and then the supplier's reminder is the first anyone hears.
  const back = readDirectDebit({ mandateId: 'M-2019-004417', amount: +83.70, text: 'Storno incasso' })
  assert.equal(back.isDirectDebit, false, 'money coming in is not a collection')
  assert.equal(back.reversal, true, 'and it must be recognisable AS a reversal, not merely ignored')
  assert.equal(isCertainDirectDebit(back), false, 'nothing may be acted on from a storno')

  // The wording alone is enough, even when the sign is missing (a CSV whose amount failed to parse).
  const worded = readDirectDebit({ typeCode: 'NDDT', text: 'STORNO SEPA INCASSO', amount: null })
  assert.equal(worded.reversal, true)
  assert.equal(worded.isDirectDebit, false)
})

test('[DD-SIGNAL] the bare word "incasso" in a description decides nothing', () => {
  // A description is written by whoever sent the money. "terugbetaling incasso" is somebody
  // repaying a collection by hand — a normal transfer that happens to contain the word.
  const loose = readDirectDebit({ text: 'Terugbetaling incasso mei', amount: -20 })
  assert.equal(loose.signal, null, 'one word is not a statement about the instrument')

  // A recognised PHRASE is an indication — enough to ask about, never enough to decide.
  const phrase = readDirectDebit({ text: 'SEPA Incasso periode 08-2026', amount: -83.70 })
  assert.equal(phrase.signal, 'wording')
  assert.equal(phrase.isDirectDebit, true)
  assert.equal(
    isCertainDirectDebit(phrase), false,
    'wording may prompt a question; it may never settle an invoice on its own',
  )
})

test('[DD-SIGNAL] nothing to go on is answered as nothing to go on', () => {
  // The honest empty answer. A bank whose CSV has no such column and a description that says
  // nothing must produce "this line does not show it", never "this was not a direct debit".
  const blank = readDirectDebit({ amount: -83.70, text: 'Huur augustus' })
  assert.equal(blank.isDirectDebit, false)
  assert.equal(blank.signal, null)
  assert.equal(blank.reversal, false)
  assert.equal(blank.mandateId, null)
  assert.equal(blank.creditorId, null)

  // Junk in must not throw or invent.
  assert.equal(readDirectDebit({}).signal, null)
  assert.equal(readDirectDebit({ typeCode: '', mandateId: '  ', creditorId: null, text: '' }).signal, null)
})

test('[DD-SIGNAL] a mandate id is stored, not a novel', () => {
  // Whatever the field holds goes into a column. A 400-character description that happened to
  // match must not become the "mandate reference" — that is how a free-text blob ends up keyed on.
  const long = 'Machtiging: ' + 'X'.repeat(200)
  assert.equal(readDirectDebit({ text: long, amount: -1 }).mandateId, null, 'an implausible length is refused')
  assert.equal(readDirectDebit({ mandateId: 'Y'.repeat(200), amount: -1 }).mandateId, null)
  assert.equal(readDirectDebit({ mandateId: 'M-1', typeCode: 'NDDT', amount: -1 }).mandateId, 'M-1', 'a real one is kept')
})

// [DD-SIGNAL] Hier stond een test die eiste dat ELK signaal een eigen zin had en dat er geen
// bankcode in die zin lekte. Die zin is er niet meer — directDebitEvidenceText is verwijderd omdat
// geen scherm hem toonde — en een test over een verdwenen zin is geen bewijs meer, alleen ruis.
// De REGEL eronder (welk signaal telt als zeker) staat hierboven wél gepind.

// ─── End to end: does the signal survive the parsers? ─────────────────────────
//
// The detector above can be perfect while the file door drops the field on the way — which is
// exactly the state this repo was in, in all three formats at once. These run real statement text
// through the real parsers and ask the real question.

import { parseMT940, parseCAMT053 } from './bank-parser'
import { parseBankCsv } from './bank-csv'

/** The verdict for one parsed line, from everything the parser kept. */
function verdict(tx: { typeCode?: string | null; mandateId?: string | null; creditorId?: string | null; description: string; rawLine: string; amount: number }) {
  return readDirectDebit({
    typeCode: tx.typeCode, mandateId: tx.mandateId, creditorId: tx.creditorId,
    text: `${tx.description} ${tx.rawLine}`, amount: tx.amount,
  })
}

test('[DD-SIGNAL] MT940 end to end: NDDT reaches the verdict', () => {
  const file = [
    ':20:STARTUMS',
    ':25:NL65RABO0171136276',
    ':28C:00001',
    ':60F:C260801EUR1000,00',
    ':61:2608010801D83,70NDDT100084417//BANKREF1',
    ':86:/EREF/100084417/NAME/WonenBreburg/REMI/Huur augustus',
    ':61:2608020802D50,00NTRF123//BANKREF2',
    ':86:/NAME/Groothandel/REMI/Factuur 263548',
    ':62F:C260802EUR866,30',
  ].join('\n')

  const parsed = parseMT940(file)
  assert.equal(parsed.transactions.length, 2, 'both lines parsed')

  const rent = verdict(parsed.transactions[0])
  assert.equal(rent.isDirectDebit, true, 'the NDDT line survived the parser as a direct debit')
  assert.equal(isCertainDirectDebit(rent), true)

  const transfer = verdict(parsed.transactions[1])
  assert.equal(transfer.isDirectDebit, false, 'and the NTRF line beside it did not become one')
})

test('[DD-SIGNAL] CAMT.053 end to end: the mandate and the incassant-ID reach the verdict', () => {
  const file = `<?xml version="1.0"?>
<Document><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NL65RABO0171136276</IBAN></Id></Acct>
  <Ntry>
    <Amt Ccy="EUR">83.70</Amt><CdtDbtInd>DBIT</CdtDbtInd>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RDDT</Cd><SubFmlyCd>ESDD</SubFmlyCd></Fmly></Domn></BkTxCd>
    <ValDt><Dt>2026-08-01</Dt></ValDt>
    <NtryDtls><TxDtls>
      <Refs><MndtId>100084417</MndtId></Refs>
      <RltdPties><Cdtr><Nm>WonenBreburg</Nm></Cdtr>
        <CdtrSchmeId><Id>NL32ZZZ411951220000</Id></CdtrSchmeId></RltdPties>
      <RmtInf><Ustrd>Huur augustus</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`

  const parsed = parseCAMT053(file)
  assert.equal(parsed.transactions.length, 1)
  const tx = parsed.transactions[0]
  assert.equal(tx.mandateId, '100084417', 'the machtigingskenmerk survived <Refs>')
  assert.equal(tx.creditorId, 'NL32ZZZ411951220000', 'and the incassant-ID survived <CdtrSchmeId>')
  assert.equal(tx.typeCode, 'ESDD', 'the sub-family is more specific than the family, so it wins')

  const dd = verdict(tx)
  assert.equal(dd.isDirectDebit, true)
  assert.equal(dd.signal, 'mandate')
  assert.equal(isCertainDirectDebit(dd), true)
})

test('[DD-SIGNAL] CSV end to end: ING says IC, Rabobank gives it two columns', () => {
  const ing = [
    'Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen',
    '20260801;WonenBreburg;NL65RABO0171136276;NL32INGB0000000001;IC;Af;83,70;Incasso;Huur augustus',
    '20260802;Groothandel;NL65RABO0171136276;NL11ABNA0000000002;GT;Af;50,00;Overschrijving;Factuur 263548',
  ].join('\n')
  const parsedIng = parseBankCsv(ing)
  assert.equal(parsedIng.transactions.length, 2, `ING rows parsed: ${parsedIng.parseErrors.join(' | ')}`)
  assert.equal(verdict(parsedIng.transactions[0]).isDirectDebit, true, 'code IC reached the verdict')
  assert.equal(verdict(parsedIng.transactions[1]).isDirectDebit, false, 'code GT beside it did not')

  const rabo = [
    'IBAN/BBAN,Munt,BIC,Volgnr,Datum,Rentedatum,Bedrag,Saldo na trn,Tegenrekening IBAN/BBAN,Naam tegenpartij,Omschrijving-1,Machtigingskenmerk,Incassant ID',
    'NL65RABO0171136276,EUR,RABONL2U,1,2026-08-01,2026-08-01,"-83,70","916,30",NL32INGB0000000001,WonenBreburg,Huur augustus,100084417,NL32ZZZ411951220000',
  ].join('\n')
  const parsedRabo = parseBankCsv(rabo)
  assert.equal(parsedRabo.transactions.length, 1, `Rabo row parsed: ${parsedRabo.parseErrors.join(' | ')}`)
  const dd = verdict(parsedRabo.transactions[0])
  assert.equal(dd.mandateId, '100084417', "Rabobank's own column reached the verdict")
  assert.equal(dd.creditorId, 'NL32ZZZ411951220000')
  assert.equal(isCertainDirectDebit(dd), true)
})

// ─── The proposal ─────────────────────────────────────────────────────────────

import { summariseMandates, type MandateLine } from './direct-debit'

const ddLine = (over: Partial<MandateLine> = {}): MandateLine => ({
  counterpartName: 'WonenBreburg', typeCode: 'NDDT', amount: -83.70, date: '2026-08-01', ...over,
})

test('[DD-SIGNAL] two collections make a mandate; one makes a fact', () => {
  // One direct debit is a fact about one payment. A standing mandate is what the switch is about,
  // and it is also the shape a mis-read cannot fake twice.
  assert.deepEqual(summariseMandates([ddLine()]), [], 'a single collection proposes nothing')

  const two = summariseMandates([ddLine({ date: '2026-07-01' }), ddLine({ date: '2026-08-01' })])
  assert.equal(two.length, 1)
  assert.equal(two[0].name, 'WonenBreburg')
  assert.equal(two[0].collections, 2)
  assert.equal(two[0].lastDate, '2026-08-01', 'the most recent one, so the question can name it')
})

test('[DD-SIGNAL] a storno never counts toward a mandate', () => {
  // Two collections and a bounce is a supplier that collects. Two BOUNCES is not — and proposing a
  // mandate off them would take the pay button away from invoices that are genuinely still open.
  const bounced = summariseMandates([
    ddLine({ amount: +83.70, description: 'Storno incasso' }),
    ddLine({ amount: +83.70, description: 'Storno incasso' }),
  ])
  assert.deepEqual(bounced, [], 'reversals are not collections')

  const mixed = summariseMandates([
    ddLine({ date: '2026-06-01' }), ddLine({ date: '2026-07-01' }),
    ddLine({ date: '2026-08-01', amount: +83.70, description: 'Storno incasso' }),
  ])
  assert.equal(mixed[0].collections, 2, 'the two real ones still count')
  assert.equal(mixed[0].hadReversal, true, 'and the bounce is recorded, because an invoice may be open')
})

test('[DD-SIGNAL] wording alone never proposes a mandate', () => {
  // A description is written by whoever sent the money. Proposing a mandate off it would put a
  // decision that changes how invoices are booked in the hands of a payment note.
  const worded = summariseMandates([
    ddLine({ typeCode: null, description: 'SEPA Incasso periode 07' }),
    ddLine({ typeCode: null, description: 'SEPA Incasso periode 08' }),
  ])
  assert.deepEqual(worded, [], 'only a mandate id, an incassant-ID or the bank’s own code may propose')
})

test('[DD-SIGNAL] ordinary transfers propose nothing, and the incassant-ID rides along', () => {
  const mixed = summariseMandates([
    ddLine({ counterpartName: 'Groothandel', typeCode: 'NTRF', date: '2026-07-01' }),
    ddLine({ counterpartName: 'Groothandel', typeCode: 'NTRF', date: '2026-08-01' }),
    ddLine({ date: '2026-07-01', creditorId: 'NL32ZZZ411951220000' }),
    ddLine({ date: '2026-08-01' }),
  ])
  assert.equal(mixed.length, 1, 'the supplier paid by hand is not proposed')
  assert.equal(mixed[0].name, 'WonenBreburg')
  assert.equal(mixed[0].creditorId, 'NL32ZZZ411951220000', 'the collector id corroborates the name')
})

// ─── [STORNO-GEEN-BETALING] What the bank's own fields say came back ─────────────────────────────

test("[STORNO-GEEN-BETALING] only the bank's own fields may hold back a payment", () => {
  // The bank returning a failed collection: money IN, and the markers are its own.
  const byMandate = readDirectDebit({
    typeCode: 'NDDT', mandateId: 'M-2024-0091', text: 'STORNO SEPA INCASSO', amount: 242.0,
  })
  assert.equal(byMandate.reversal, true)
  assert.equal(isBankStatedReversal(byMandate), true)

  // A type code alone is still the bank speaking.
  assert.equal(isBankStatedReversal(readDirectDebit({ typeCode: 'RDDT', amount: 61.4 })), true)

  // …but a PAYER's own words are not, and this is the whole reason the function exists separately
  // from `reversal`: a customer who writes "terugbetaling sepa incasso" in a payment note would
  // otherwise have their own transfer held back on the strength of their own typing.
  const byWording = readDirectDebit({ text: 'terugbetaling sepa incasso', amount: 242.0 })
  assert.equal(byWording.signal, 'wording')
  assert.equal(byWording.reversal, true)
  assert.equal(isBankStatedReversal(byWording), false)

  // A collection going the ordinary way is not a reversal at all.
  assert.equal(isBankStatedReversal(readDirectDebit({
    typeCode: 'NDDT', mandateId: 'M-2024-0091', amount: -61.4,
  })), false)
  // And a line with nothing on it says nothing.
  assert.equal(isBankStatedReversal(readDirectDebit({ text: 'Huur maart', amount: 900 })), false)
})
