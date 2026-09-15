// src/lib/invoice-pdf.tsx
// [FACTUUR-LAYOUT] Reference-matched layout — July 2026
// =====================================================
// Layout now mirrors the Belastingdienst "12 factuureisen" reference invoice
// (InformerOnline standard) exactly:
//   * Klant top-LEFT, afzender top-RIGHT with an auto-generated logo monogram
//     above it (initials derived from the company name — no upload).
//   * "Factuur" heading + Factuurnummer / Factuurdatum / Vervaldatum
//     (+ Leverdatum — eis #6, printed whenever a delivery date is present).
//   * Table columns: Aantal · Omschrijving · Prijs · Totaal (no separate BTW
//     column — the rate is stated in the totals, as on the reference).
//   * Totals read "21,00% BTW over € 100,00 → € 21,00" per rate.
//   * Full payment sentence instead of a boxed note.
//
// LEGAL LOGIC PRESERVED verbatim from the previous (Art. 35a Wet OB 1968)
// build: per-rate BTW breakdown from the lines, single-rate fallback for
// legacy invoices, creditnota title + sign + no-payment text, all amounts via
// formatEuroNL (Dutch comma) and all dates via formatDateNL (DD-MM-YYYY).
//
// Consumed by BOTH (signature unchanged — no call-site edits):
//   * client: dashboard/invoice/[id] + factuur-maken via <PDFDownloadLink>
//   * server: lib/invoice-pdf-server.tsx → renderToBuffer (e-mail attachment)
// Keep this module free of server-only imports.
// =====================================================

import { Document, Page, Text, View, StyleSheet, Image, Link } from '@react-pdf/renderer'
import { formatDateNL, formatEuroNL, deriveBtwRate } from './format-nl'
// [ICP] Art. 226 punt 11a: when the customer owes the BTW, the invoice must SAY so. Same rule
// the ICP-opgaaf runs on, so the document and the aangifte can never disagree about this sale.
import { reverseChargeNotice } from './icp'
import { domesticReverseChargeNotice } from './reverse-charge-invoice'
import { storedVatTreatment, type StoredVatTreatment } from './line-vat-treatment'
import { countryNameNl, normalizeCountry } from './client-country'
// [CREDITNOTA-REF] Art. 219: a corrective document must name the invoice it corrects.
import { creditnotaReferenceLine } from './creditnota'
// [UNIT] Nette schrijfwijze van de eenheid; laat onbekende tekst ongemoeid.
import { unitLabel } from './units'
import { applyDiscount, parseDiscount, discountLabel } from './invoice-discount'
import { round2 } from './invoice-totals'
// [LOGO-INITIALEN] Het monogram woont in een eigen bestand, samen met de avatar in de
// dashboardkop — die twee gaven een ander antwoord over hetzelfde bedrijf.
import { deriveInitials } from './logo-initials'
// [OFFERTE-IS-GEEN-PROFORMA] Eén definitie van "dit is een offerte", gedeeld met het
// bewerkscherm en de verstuurroute. Dit bestand had zijn eigen, en die kende 'pro_forma' niet.
import { isQuote } from './invoice-editable'
// [PRIJS-KOLOM] De prijskolom moet vermenigvuldigd het regeltotaal opleveren.
import { formatUnitPriceNL } from './unit-price-display'
// [BTW-VERKLARING] Waarom er geen btw op deze factuur staat — KOR, vrijstelling of de eigen zin
// van de ondernemer. Spreekt nooit over de verleggingsregel heen; zie de kop van vat-statement.ts.
import { vatStatement } from './vat-statement'
// [KLANT-EXTRA] De twee vrije regels onder de klantnaam ("t.a.v. …", een afdeling of een
// inkoopordernummer). Lege regels vallen weg, zodat een factuur zonder deze velden precies het
// blok houdt dat hij altijd al had.
import { clientExtraLines } from './client-extra-lines'

// ─── Styles ──────────────────────────────────────────────────────────────────
const NAVY = '#1a73e8'
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 44,
    color: '#202124',
    backgroundColor: '#ffffff',
    lineHeight: 1.4,
  },

  // Logo sits in its own top-right row, so the two party blocks below it start
  // on the SAME line (klant and afzender aligned, like the reference).
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  // Top: klant (left) · afzender (right) — aligned, below the logo row.
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 36,
  },
  klantBlock: { width: '48%' },
  // Afzender sits in the right half of the page, but its text reads
  // LEFT-aligned like the reference.
  afzenderBlock: { width: '48%' },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  partyName: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  partyText: { fontSize: 10, color: '#3c4043', marginBottom: 1 },
  // [EIGEN-MARKER] The role label above each party block. Small and grey on purpose: it is not
  // content, it is a caption saying which of the two names is the customer and which the sender.
  partyLabel: { fontSize: 8, color: '#5f6368', letterSpacing: 0.5, marginBottom: 2 },

  // Heading + meta
  heading: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: 96, fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#202124' },
  metaValue: { fontSize: 10, color: '#3c4043' },

  // Table
  table: { marginTop: 26 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  // [UNIT] 44pt was genoeg voor alleen een getal. Er staat nu "2 uur" / "14 m²" in, dus iets
  // ruimer — anders breekt de eenheid naar de volgende regel en leest de kolom als twee waarden.
  // De omschrijving is `flex: 1` en geeft die punten vanzelf terug.
  colAantal: { width: 62, fontSize: 10 },
  colOmschrijving: { flex: 1, fontSize: 10, paddingRight: 8 },
  // [REGEL-KORTING] Kleiner en grijzer dan de omschrijving: het is een toelichting op de regel,
  // geen tweede regel. Een klant die de kolom natelt moet hem vinden, niet erover struikelen.
  regelKorting: { fontSize: 8.5, color: '#5f6368', marginTop: 1 },
  colPrijs: { width: 78, fontSize: 10, textAlign: 'right' },
  colTotaal: { width: 84, fontSize: 10, textAlign: 'right' },
  headerText: { fontFamily: 'Helvetica-Bold', color: '#202124' },

  // Totals
  totalsWrap: { alignItems: 'flex-end', marginTop: 14 },
  totalsBlock: { width: 300 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalLabel: { fontSize: 10, color: '#3c4043', flexShrink: 1, paddingRight: 12 },
  totalValue: { fontSize: 10, color: '#202124' },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#dadce0',
  },
  totalFinalLabel: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  totalFinalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },

  // Payment
  payment: { marginTop: 34, fontSize: 10, color: '#3c4043', lineHeight: 1.5 },

  // [PDF-BETAAL-QR] The scan-to-pay block under the payment sentence.
  qrBlock: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  qrImage: { width: 84, height: 84 },
  qrTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#3c4043', marginBottom: 3 },
  qrCaption: { fontSize: 9, color: '#5f6368', lineHeight: 1.5, maxWidth: 300 },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    textAlign: 'center',
    // [VOETTEKST-LEESBAAR] Stond op 8pt in #dadce0 — dezelfde lichtgrijze tint als de scheidslijnen
    // in deze stylesheet. Op wit is dat ongeveer 1,3:1 contrast: op papier vrijwel onzichtbaar, en
    // een regel die niemand kan lezen kan net zo goed weg zijn. #5f6368 haalt ruim 7:1.
    fontSize: 8.5,
    color: '#5f6368',
    lineHeight: 1.5,
  },

  // [VOETTEKST-MERK] The product's name, at the weight a name needs to be recognised.
  //
  // This document is the one thing this app makes that leaves the owner's own circle: it is read by
  // their customer, by that customer's bookkeeper, and it is kept for seven years. The line at the
  // bottom was the only place the product was named, and it was set in the same muted grey and the
  // same size as the sentence beside it — legible, and nothing anyone would remember. A name that
  // is meant to be recognised is set like a name.
  //
  // It stays a CREDIT LINE and never becomes a letterhead: 12pt is the size of "Totaal" and no
  // more, it sits at the foot of the page below everything the customer needs, and the sender's own
  // company keeps the top of the document at 22pt. An invoice that shouts someone else's brand
  // reads as if that someone sent it — which would cost the owner more than the mention is worth.
  footerBrand: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: NAVY, textDecoration: 'none' },

  // [VOETTEKST-LINK] The address as a real link, and therefore absolute.
  //
  // It was printed as the bare text `boekbrug.nl`. A PDF reader that turns URL-looking text into a
  // link has no scheme to work with there, so it resolves the string against the FOLDER the file
  // is sitting in: the owner opened their invoice from the desktop and the line pointed at
  // …/OneDrive/Desktop/boekbrug.nl. On a document that goes to a customer and is kept seven years,
  // a link into a stranger's own file system is worse than no link at all.
  //
  // So the annotation is written by us, with the scheme, instead of being guessed by the reader.
  // The visible text stays the short form — nobody needs to read "https://" off an invoice.
  footerLink: { color: NAVY, textDecoration: 'none' },
})

// ─── Document title per invoice_type (title-case, matches the reference) ─────
// [OFFERTE-IS-GEEN-PROFORMA] `pro_forma` is what an offerte is STORED as — the create route maps
// offerte → pro_forma and nothing else in the product ever writes that value. So the word the
// customer reads is Offerte. The database value stays as it is; renaming it is a migration, and
// what a customer reads is not a database value (AGENTS.md).
//
// Until now this map printed "Pro forma" on it, and a pro-formafactuur is a DIFFERENT document: a
// preliminary invoice, used for a prepayment or for customs, that says "this is what you will be
// billed". An offerte asks a question and waits for a yes. The customer received a mail titled
// "Offerte" asking them to agree, opened the attachment, and read a heading that reads as a
// request for money — with an IBAN in the corner. A purchasing department pays that.
const DOC_TITLES: Record<string, string> = {
  factuur: 'Factuur',
  creditnota: 'Creditnota',
  pro_forma: 'Offerte',
  offerte: 'Offerte',
}

// [CENT] round2 lives in invoice-totals. This file held a byte-identical copy — which is the way
// the divergence starts: the day one of the two is improved, the PDF and the ledger disagree and
// nothing says so. See the header of invoice-totals.round2.

// Quantity for display: Dutch decimal comma, integers stay bare (2 → "2").
function formatQtyNL(q: number | null | undefined): string {
  const v = Number(q)
  if (!isFinite(v)) return String(q ?? '')
  return (Number.isInteger(v) ? String(v) : String(v)).replace('.', ',')
}

// ─── BTW breakdown per rate, derived from lines ──────────────────────────────
// Lines are the source of truth for the per-rate split (btw_rate exists on
// invoice_lines — NOT on invoices). For legacy invoices without lines we fall
// back to the derived single rate from the stored totals.
type LineLike = {
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  btw_rate?: number | null
  line_total?: number | null
  /**
   * [VERLEGD-VERKOOP] 'exempt' | 'reverse_charge' | null — the legal category beside the rate. It
   * decides which summary row the line lands in, and whether the statutory sentence prints.
   */
  vat_treatment?: string | null
  /**
   * [UNIT] De eenheid van deze regel ("uur", "m²"). Optioneel: leeg of afwezig levert precies
   * de oude weergave op — alleen het aantal, zoals het altijd was.
   */
  unit?: string | null
  /**
   * [REGEL-KORTING] De korting op deze regel. `line_total` is er al mee verlaagd, dus geen enkel
   * bedrag hieronder verandert erdoor — wat ze toevoegen is de REGEL die het verschil uitlegt.
   * Zonder die regel leest de klant een prijs maal een aantal die niet uitkomt op het totaal
   * ernaast, en dat is precies het soort factuur waar een telefoontje op volgt.
   */
  discount_type?: string | null
  discount_value?: number | null
}

type BtwRow = { rate: number; treatment: StoredVatTreatment | null; ex: number; btw: number }

// [VERLEGD-VERKOOP] One row per LEGAL CATEGORY, keyed on (rate, treatment) like the UBL's
// TaxSubtotal — not per rate. An exempt supply (art. 11), a verlegde supply (art. 12 lid 5) and a
// real 0% supply are three different statements; one "0,00% BTW" row over their sum told a
// bookkeeper nothing about any of them, while the e-invoice of the same sale separated them. Art.
// 35a lid 1 sub g asks for the consideration per rate OR per exemption.
function btwBreakdown(lines: LineLike[]): BtwRow[] {
  const groups = new Map<string, BtwRow>()
  for (const l of lines) {
    const rate = Number(l.btw_rate ?? 0)
    const treatment = storedVatTreatment(l.vat_treatment)
    // line_total is stored ex BTW and already carries the creditnota sign
    const ex =
      l.line_total !== null && l.line_total !== undefined
        ? Number(l.line_total)
        : Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)
    const key = `${rate}|${treatment ?? ''}`
    const cur = groups.get(key)
    if (cur) cur.ex += ex
    else groups.set(key, { rate, treatment, ex, btw: 0 })
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, btw: (g.ex * g.rate) / 100 }))
    .filter((g) => g.ex !== 0)
    .sort((a, b) => a.rate - b.rate || (a.treatment ?? '').localeCompare(b.treatment ?? ''))
}

// "21,00% BTW over € 100,00" — rate with two decimals and a Dutch comma.
function rateLabel(rate: number, ex: number): string {
  const r = rate.toFixed(2).replace('.', ',')
  return `${r}% BTW over ${formatEuroNL(ex)}`
}

// The summary row's label: the category's own words where the rate says nothing.
function rowLabel(g: { rate: number; treatment: StoredVatTreatment | null; ex: number }): string {
  if (g.treatment === 'exempt') return `Vrijgesteld van btw over ${formatEuroNL(g.ex)}`
  if (g.treatment === 'reverse_charge') return `Btw verlegd over ${formatEuroNL(g.ex)}`
  return rateLabel(g.rate, g.ex)
}

// ─── Component ────────────────────────────────────────────────────────────────
export function InvoicePDF({
  invoice,
  lines,
  profile,
  betaalQr,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
  /**
   * [PDF-BETAAL-QR] Scan-to-pay QR, pre-rendered to a data URI by the caller (QR generation is
   * async, this component is not). `amount` is what the EPC payload asks for — the block below
   * renders ONLY when it equals the printed total, so the paper can never carry a QR that asks a
   * different figure than its own payment sentence. Optional: no QR is yesterday's paper.
   */
  betaalQr?: { dataUrl: string; amount: number } | null
}) {
  const type = (invoice.invoice_type as string) || 'factuur'
  const docTitle = DOC_TITLES[type] ?? 'Factuur'
  const isCreditnota = type === 'creditnota'
  // [OFFERTE-IS-GEEN-PROFORMA] Both spellings, via the helper the rest of the app already uses.
  //
  // This was `type === 'offerte'`, and EVERY quote this product creates is stored as 'pro_forma'
  // (draft route, DB_TYPE). So not one of the offerte branches below has ever run on a real
  // document: no "Geldig tot" row, no "vrijblijvend" sentence, and the number line called itself
  // "Factuurnummer:" above an empty value. The quote's due_date was in the row the whole time —
  // the screen showed it — and the PDF simply had no branch that printed it.
  const isOfferte = isQuote(type)
  // Only a factuur (or a creditnota, which reverses one) is a legal payment
  // document. Offerte/pro forma must NOT demand payment or call their number a
  // "factuurnummer".
  const isLegalInvoice = type === 'factuur' || isCreditnota

  // Per-type meta labels.
  const numberLabel = isOfferte ? 'Offertenummer:' : isCreditnota ? 'Creditnotanummer:' : 'Factuurnummer:'
  const dateLabel = isOfferte ? 'Offertedatum:' : 'Factuurdatum:'
  // Leverdatum only makes sense for something actually delivered (factuur /
  // creditnota); a quote delivers nothing.
  const showLeverdatum = isLegalInvoice && !!invoice.delivery_date

  const afzenderName = profile.company_name || profile.full_name || ''
  const initials = deriveInitials(profile.company_name || profile.full_name)

  // [FACTUUR-A] Normalize BTW-id casing on a legal document.
  const senderBtw = profile.btw_number ? String(profile.btw_number).toUpperCase() : '—'
  const clientBtw = invoice.client_btw_number ? String(invoice.client_btw_number).toUpperCase() : ''
  // [KLANT-LAND] Art. 35a lid 1 sub c: the customer's address — for a foreign customer that includes
  // the country, printed as its Dutch name under the city. A Dutch or unrecorded country prints
  // nothing, which is exactly the block every invoice rendered before the column existed.
  const clientCountryCode = normalizeCountry(invoice.client_country)
  const clientCountry = clientCountryCode && clientCountryCode !== 'NL' ? countryNameNl(clientCountryCode) : ''

  const groups = btwBreakdown(lines ?? [])
  // Fallback for legacy invoices without lines: one derived rate from totals.
  const rateLines =
    groups.length > 0
      ? groups
      : [
          {
            rate: deriveBtwRate(invoice.btw_amount, invoice.total_ex_btw),
            treatment: null,
            ex: Number(invoice.total_ex_btw ?? 0),
            btw: Number(invoice.btw_amount ?? 0),
          },
        ]

  // Reconcile the totals FROM the rate rows so the printed document always adds
  // up: Subtotaal + Σ(per-rate BTW) === Totaal, to the cent, for single- and
  // mixed-rate alike. (Previously Subtotaal/Totaal came from stored fields while
  // the BTW rows were re-derived, which could disagree by a cent.)
  // [KORTING] Een korting op de hele factuur staat op de FACTUURRIJ, en dit document rekent zijn
  // totalen uit de REGELS. Zonder deze stap drukt de PDF het onverlaagde bedrag terwijl de
  // opgeslagen totalen (en de aangifte, en de betaallink) het verlaagde bedrag dragen — een
  // document dat niet klopt met zichzelf, wat de regels hierboven juist bestaan om te voorkomen.
  //
  // De verdeling over de tarieven komt uit dezelfde module als het scherm en de UBL-export, want
  // die drie moeten per definitie hetzelfde antwoord geven.
  // [KORTING-EENMAAL] Only over REAL lines. The fallback row above IS the stored header total, and
  // that total is already net of the discount — applying it again printed a EUR 1.089 invoice
  // (900 ex, 10% korting) as EUR 980,10, with no warning and a payment QR that quietly vanished
  // because its amount no longer matched the page. The UBL export makes the same choice.
  const korting = groups.length > 0
    ? parseDiscount(
        (invoice as { discount_type?: unknown }).discount_type,
        (invoice as { discount_value?: unknown }).discount_value,
      )
    : null
  const kortingUitkomst = applyDiscount(
    rateLines.map((g) => ({ line_total: g.ex, btw_rate: g.rate })),
    korting,
  )
  // [KORTING-PER-GROEP] applyDiscount allocates per RATE, and since the rows are one per legal
  // category two rows can share rate 0 (vrijgesteld beside verlegd). Handing both the whole
  // rate-0 allowance subtracted it twice — the defect the UBL export fixed with offByGroup, now
  // with the same rule: the rate's allowance over that rate's rows pro rata, remainder on the
  // last, so the parts sum to the allowance to the cent. Keyed on the ROW, not the rate.
  const afgetrokken = new Map<number, number>()
  for (const a of kortingUitkomst.allowances) {
    const idx = rateLines
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.rate === a.rate && Math.sign(g.ex) === Math.sign(a.amount) && g.ex !== 0)
      .sort((x, y) => Math.abs(y.g.ex) - Math.abs(x.g.ex))
    const base = idx.reduce((sum, { g }) => sum + Math.abs(g.ex), 0)
    let assigned = 0
    idx.forEach(({ g, i }, k) => {
      const part = k === idx.length - 1 ? round2(a.amount - assigned) : round2((a.amount * Math.abs(g.ex)) / base)
      assigned = round2(assigned + part)
      if (part !== 0) afgetrokken.set(i, part)
    })
  }
  const netRateLines = rateLines.map((g, i) => {
    const off = afgetrokken.get(i) ?? 0
    const ex = round2(g.ex - off)
    // [KORTING] `off !== 0`, niet `off > 0`. Op een CREDITNOTA is alles negatief — applyDiscount
    // spiegelt de korting mee (`applied = sign * appliedMagnitude`), dus de aftrek per tarief is
    // daar een negatief bedrag. Met `> 0` werd `ex` dan wél bijgesteld en de BTW niet, en dan
    // drukt dit document een verlaagd subtotaal naast een onverlaagde BTW — een factuur die niet
    // met zichzelf klopt, precies wat de regels hierboven zeggen te voorkomen. Het staat ook los
    // van de opgeslagen totalen, die via applyDiscount wél de gespiegelde korting dragen, dus de
    // PDF zou afwijken van de aangifte en van de betaallink.
    //
    // De herberekening werkt in beide richtingen: (−900 × 21) / 100 = −189, wat een creditnota
    // hoort te zijn. Nul blijft nul — zonder korting op dit tarief is er niets bij te stellen.
    //
    // Vandaag draagt geen enkele factuur in de database een korting, dus dit is nog nooit
    // afgedrukt. Het is de deur die openstaat, niet een document dat de deur uit is.
    return { ...g, ex, btw: off !== 0 ? round2((ex * g.rate) / 100) : g.btw }
  })

  const displaySubtotal = round2(rateLines.reduce((a, g) => a + g.ex, 0))
  const displayDiscount = kortingUitkomst.discount_ex_btw
  const displayNetSubtotal = round2(netRateLines.reduce((a, g) => a + g.ex, 0))
  const displayBtwTotal = round2(netRateLines.reduce((a, g) => a + round2(g.btw), 0))
  const displayTotal = round2(displayNetSubtotal + displayBtwTotal)

  const paymentText = `Wij verzoeken u vriendelijk het bovenstaande bedrag van ${formatEuroNL(
    displayTotal
  )} voor ${formatDateNL(invoice.due_date)} ${
    profile.iban ? `op onze bankrekening ${profile.iban} ` : ''
  }te voldoen, onder vermelding van het factuurnummer ${invoice.invoice_number}.`

  // [ICP] The mandatory reverse-charge line. Without it an intra-EU invoice is formally
  // deficient — that is the ground on which the 0% gets challenged and the customer's own
  // deduction gets refused. It is derived, never typed: the customer's EU BTW-number plus a
  // zero BTW amount IS the condition. Suppressed when the owner already wrote it in a line.
  // [VERLEGD-VERKOOP] The EU sentence first, then the domestic one — a buyer in another member
  // state is verlegd on a different legal ground, and ONE sentence is printed, never two.
  const reverseCharge = reverseChargeNotice({
    clientVatNumber: invoice.client_btw_number,
    btwAmount: invoice.btw_amount,
    invoiceType: type,
    korActive: !!profile.kor_active,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineTexts: (lines ?? []).map((l: any) => l?.description as string | null),
  }) ?? domesticReverseChargeNotice({
    lines: (lines ?? []) as LineLike[],
    clientBtwNumber: invoice.client_btw_number,
    invoiceType: type,
    korActive: !!profile.kor_active,
  })

  // [BTW-VERKLARING] Drie verschillende redenen voor EUR 0,00 btw drukten hetzelfde af: niets.
  // Gemeten op vier facturen — KOR, vrijgestelde prestatie en kaal 0% waren letterlijk niet van
  // elkaar te onderscheiden, en alleen de verlegde EU-factuur zei iets. Een klant las een bedrag
  // zonder btw en niets dat het uitlegde; zijn boekhouder kan dat niet plaatsen en gokt dan.
  //
  // `reverseChargeStated` is de belangrijkste parameter: staat die zin er al, dan zwijgt deze.
  // Twee zinnen die een andere reden geven voor één nul is erger dan allebei geen.
  const btwUitleg = vatStatement({
    invoiceType: type,
    btwAmount: displayBtwTotal,
    korActive: !!profile.kor_active,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (lines ?? []) as any[],
    note: profile.vat_statement_note,
    reverseChargeStated: !!reverseCharge,
  })

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Auto logo — its own top-right row, so klant and afzender below it
            start on the same line (aligned, like the reference). */}
        <View style={styles.logoRow}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>{initials}</Text>
          </View>
        </View>

        {/* Parties — klant (left) · afzender (right), aligned */}
        <View style={styles.topRow}>
          {/* Klant — Art. 35a sub c: name AND address of the customer */}
          <View style={styles.klantBlock}>
            {/* [EIGEN-MARKER] The paper names its own roles. Two name blocks side by side read
                fine to a human, but the measured incident (Kiwi, €394,99) shows what a MACHINE
                does with them: the owner's own invoice came back through the mail sync and the
                reader named the CUSTOMER as the supplier, so the own-document guard matched
                nothing. One word above each block ends the ambiguity for every reader of this
                document — the customer's software, an accountant's OCR, and our own intake when
                the invoice is re-imported. Dutch, like everything on this paper (AGENTS.md). */}
            <Text style={styles.partyLabel}>KLANT</Text>
            <Text style={styles.partyName}>{invoice.client_name || '—'}</Text>
            {/* [KLANT-EXTRA] The owner's own lines, directly under the name and above the street:
                "t.a.v. mevrouw Jansen", a department, a purchase-order reference the customer's
                system needs to match the invoice. Empty ones are dropped by clientExtraLines, so
                an invoice with neither filled — which is every invoice created before this field —
                renders exactly the block it rendered before, with no gap where a line would be. */}
            {clientExtraLines(invoice).map((line, i) => (
              <Text key={i} style={styles.partyText}>{line}</Text>
            ))}
            <Text style={styles.partyText}>{invoice.client_address || ''}</Text>
            <Text style={styles.partyText}>
              {invoice.client_postal_code || ''} {invoice.client_city || ''}
            </Text>
            {clientCountry !== '' && <Text style={styles.partyText}>{clientCountry}</Text>}
            {clientBtw !== '' && <Text style={styles.partyText}>BTW nr.: {clientBtw}</Text>}
            {invoice.client_email ? (
              <Text style={styles.partyText}>{invoice.client_email}</Text>
            ) : null}
          </View>

          {/* Afzender — Art. 35a sub a/b: name+address, BTW-id, KVK */}
          <View style={styles.afzenderBlock}>
            {/* [EIGEN-MARKER] See the klant block — the other half of the same sentence. */}
            <Text style={styles.partyLabel}>AFZENDER</Text>
            <Text style={styles.partyName}>{afzenderName || '—'}</Text>
            <Text style={styles.partyText}>{profile.address || '—'}</Text>
            <Text style={styles.partyText}>
              {(profile.postal_code || profile.city) ? `${profile.postal_code || ''} ${profile.city || ''}`.trim() : '—'}
            </Text>
            <Text style={styles.partyText}>BTW nr.: {senderBtw}</Text>
            <Text style={styles.partyText}>KvK nr.: {profile.kvk_number || '—'}</Text>
            <Text style={styles.partyText}>IBAN: {profile.iban || '—'}</Text>
            {/* [OFFERTE-ANTWOORD] Een offerte is een document dat om een antwoord vraagt, en op
                papier stond nergens waar dat antwoord heen moest: adres, KvK, BTW en IBAN, geen
                mail en geen telefoon. De mail heeft sinds kort een reply-to, maar de PDF wordt
                afgedrukt, doorgestuurd en los bewaard. Alleen tonen wat is ingevuld — een lege
                regel "E-mail: —" helpt niemand. */}
            {profile.email ? <Text style={styles.partyText}>E-mail: {profile.email}</Text> : null}
            {profile.phone ? <Text style={styles.partyText}>Tel.: {profile.phone}</Text> : null}
          </View>
        </View>

        {/* Heading + meta */}
        <Text style={styles.heading}>{docTitle}</Text>
        {/* [OFFERTE-IS-GEEN-PROFORMA] Alleen als er een nummer IS. Een offerte krijgt er met opzet
            geen (Art. 35 kent één doorlopende reeks, en die is voor facturen), dus dit drukte een
            label af met niets erachter — op precies het document dat geen nummer hoort te hebben. */}
        {invoice.invoice_number ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{numberLabel}</Text>
            <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{dateLabel}</Text>
          <Text style={styles.metaValue}>{formatDateNL(invoice.invoice_date)}</Text>
        </View>
        {showLeverdatum && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Leverdatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.delivery_date)}</Text>
          </View>
        )}
        {/* Vervaldatum only on a real factuur; an offerte shows "Geldig tot". */}
        {type === 'factuur' && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vervaldatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.due_date)}</Text>
          </View>
        )}
        {isOfferte && invoice.due_date && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Geldig tot:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.due_date)}</Text>
          </View>
        )}

        {/* Line table — Aantal · Omschrijving · Prijs · Totaal */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colAantal, styles.headerText]}>Aantal</Text>
            <Text style={[styles.colOmschrijving, styles.headerText]}>Omschrijving</Text>
            <Text style={[styles.colPrijs, styles.headerText]}>Prijs</Text>
            <Text style={[styles.colTotaal, styles.headerText]}>Totaal</Text>
          </View>
          {(lines ?? []).map((line, index) => {
            const lineTotal =
              line.line_total ?? Number(line.quantity ?? 0) * Number(line.unit_price ?? 0)
            // [REGEL-KORTING] Bruto = aantal × prijs, netto = wat er in de kolom staat.
            const brutoRegel = round2(Number(line.quantity ?? 0) * Number(line.unit_price ?? 0))
            const regelKorting = parseDiscount(line.discount_type, line.discount_value)
            const regelKortingBedrag = regelKorting ? round2(brutoRegel - lineTotal) : 0
            // De prijskolom moet uitkomen op het bedrag waar hij bij hoort: bij een gekorte regel
            // is dat het BRUTO bedrag, want de korting staat er als eigen regel onder. Zou hier
            // het netto bedrag staan, dan gaat unitPriceDecimals op zoek naar een precisie waarop
            // aantal × prijs = het VERLAAGDE totaal — en drukt een stuksprijs af met zes cijfers
            // achter de komma die niemand ooit heeft afgesproken.
            const prijsBasis = regelKortingBedrag !== 0 ? brutoRegel : lineTotal
            return (
              <View key={index} style={styles.tableRow}>
                {/* [UNIT] "2 uur" leest als een levering; "2" leest als niets. De eenheid
                    stond wél in de e-factuur en niet op het papier dat de klant leest — en de
                    PDF is het document dat hij bewaart. Onbekende eenheid blijft staan zoals de
                    ondernemer hem schreef; geen eenheid geeft exact de oude weergave. */}
                <Text style={styles.colAantal}>
                  {formatQtyNL(line.quantity)}
                  {line.unit ? ` ${unitLabel(line.unit, Number(line.quantity ?? 1))}` : ''}
                </Text>
                <View style={styles.colOmschrijving}>
                  <Text>{line.description}</Text>
                  {/* [REGEL-KORTING] Onder de omschrijving, want daar hoort hij: hij gaat over
                      DEZE levering. Met het percentage erbij als dat is afgesproken, en met het
                      bedrag, zodat de klant de regel kan natellen: prijs × aantal, min dit. */}
                  {regelKortingBedrag !== 0 && (
                    <Text style={styles.regelKorting}>
                      {`${discountLabel(regelKorting)}: - ${formatEuroNL(Math.abs(regelKortingBedrag))}`}
                    </Text>
                  )}
                </View>
                {/* [PRIJS-KOLOM] Met zoveel decimalen als de regel nodig heeft. Op twee stond hier
                    "150 x EUR 0,83" naast een regeltotaal van EUR 123,85 — 65 cent verschil, op het
                    papier dat de klant bewaart en zelf natelt. Zie unit-price-display.ts. */}
                <Text style={styles.colPrijs}>{formatUnitPriceNL(line.unit_price, line.quantity, prijsBasis)}</Text>
                <Text style={styles.colTotaal}>{formatEuroNL(lineTotal)}</Text>
              </View>
            )
          })}
        </View>

        {/* Totals — Subtotaal / per-rate BTW / Totaal */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotaal</Text>
              <Text style={styles.totalValue}>{formatEuroNL(displaySubtotal)}</Text>
            </View>
            {/* [KORTING] Genoemd, met het percentage erbij als dat is afgesproken. Een verlaagd
                totaal zonder regel die het uitlegt, is een factuur die de klant niet kan narekenen. */}
            {displayDiscount > 0 && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{discountLabel(korting)}</Text>
                  <Text style={styles.totalValue}>{`- ${formatEuroNL(displayDiscount)}`}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Subtotaal na korting</Text>
                  <Text style={styles.totalValue}>{formatEuroNL(displayNetSubtotal)}</Text>
                </View>
              </>
            )}
            {netRateLines.map((g, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={styles.totalLabel}>{rowLabel(g)}</Text>
                <Text style={styles.totalValue}>{formatEuroNL(round2(g.btw))}</Text>
              </View>
            ))}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalLabel}>Totaal</Text>
              <Text style={styles.totalFinalValue}>{formatEuroNL(displayTotal)}</Text>
            </View>
          </View>
        </View>

        {/* [ICP] Above the closing note, because it is part of the INVOICE, not a courtesy:
            art. 226 punt 11a requires the words "Btw verlegd" on a document whose BTW was
            shifted to the customer. */}
        {reverseCharge && <Text style={styles.payment}>{reverseCharge}</Text>}
        {btwUitleg && <Text style={styles.payment}>{btwUitleg}</Text>}

        {/* Closing note — depends on the document type. A quote / pro forma
            must NOT demand payment or reference a "factuurnummer". */}
        {type === 'factuur' && <Text style={styles.payment}>{paymentText}</Text>}
        {/* [PDF-BETAAL-QR] Scan-to-pay, on the paper itself. Only on a factuur (an offerte must
            not demand payment, a creditnota is money WE owe), and only when the QR asks EXACTLY
            the printed total — the payment sentence above names displayTotal, and a document must
            never disagree with itself. A QR whose amount drifted from the printed figure silently
            does not render: no QR is yesterday's paper, a wrong QR is a wrong payment. */}
        {type === 'factuur' && betaalQr && Math.abs(betaalQr.amount - displayTotal) <= 0.005 && (
          <View style={styles.qrBlock} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt prop */}
            <Image src={betaalQr.dataUrl} style={styles.qrImage} />
            <View style={{ flexDirection: 'column' }}>
              <Text style={styles.qrTitle}>Scan om te betalen</Text>
              <Text style={styles.qrCaption}>
                Scan deze QR-code met de app van je bank — het bedrag, ons rekeningnummer en het
                betalingskenmerk staan er al in.
              </Text>
            </View>
          </View>
        )}
        {isCreditnota && (
          <Text style={styles.payment}>
            {/* [CREDITNOTA-REF] The reference comes FIRST: art. 219 Richtlijn 2006/112/EG only
                equates a corrective document with an invoice when it refers specifically and
                unambiguously to the initial one. Without it this page named only itself. The
                caller resolves the original (the link lives in invoices.original_invoice_id);
                when it cannot, nothing vague is printed in its place. */}
            {creditnotaReferenceLine({
              originalNumber: invoice.original_invoice_number,
              originalDate: invoice.original_invoice_date,
            })}{invoice.original_invoice_number ? ' ' : ''}
            Deze creditnota crediteert het bovenstaande bedrag. Er is geen betaling vereist.
          </Text>
        )}
        {/* [OFFERTE-IS-GEEN-PROFORMA] Eén afsluiting voor allebei de spellingen. De pro-forma-tekst
            die hier stond ("geen geldige btw-factuur, er kunnen geen rechten aan worden ontleend")
            hoort bij een vooruitfactuur, niet bij een aanbod — en stond dus op elke offerte.

            De geldigheid wordt ALTIJD genoemd. Stond er geen datum, dan verdween de zin stilzwijgend
            en ging er een aanbod de deur uit dat nooit verloopt: de klant kan er een jaar later mee
            terugkomen en de ondernemer staat tussen weigeren en werken voor een oude prijs. */}
        {isOfferte && (
          <Text style={styles.payment}>
            {invoice.due_date
              ? `Deze offerte is vrijblijvend en geldig tot ${formatDateNL(invoice.due_date)}.`
              : 'Deze offerte is vrijblijvend. Er is geen einddatum afgesproken — vraag ons gerust of dit aanbod nog geldt.'}
            {'\n'}
            {/* Wat de klant moet DOEN. "Vrijblijvend" zegt wat niet hoeft; hier staat wat wel kan. */}
            {profile.email
              ? `Ga je akkoord? Laat het weten via ${profile.email}${profile.phone ? ` of ${profile.phone}` : ''} — daarna maken wij er een factuur van.`
              : 'Ga je akkoord? Laat het ons weten — daarna maken wij er een factuur van.'}
          </Text>
        )}

        {/* [VOETTEKST-MERK] The name on its own line, the promise and the address under it. */}
        <Text style={styles.footer} fixed>
          {/* [VOETTEKST-LINK] The name itself opens the site — it is the biggest thing down here
              and the first thing a reader reaches for. Absolute, so no reader can resolve it
              against its own folder. */}
          <Link src="https://boekbrug.nl" style={styles.footerBrand}>BoekBrug</Link>
          {'\n'}
          De brug tussen jou en je boekhouder ·{' '}
          <Link src="https://boekbrug.nl" style={styles.footerLink}>boekbrug.nl</Link>
        </Text>
      </Page>
    </Document>
  )
}
