'use client'

// src/app/dashboard/invoice/[id]/edit/page.tsx
// BOEK-001: Invoice Edit
// نفس شكل ومنطق new/page.tsx — لكن يحمّل البيانات الموجودة ويرسل PUT

import { useState, useEffect } from 'react'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { deliveryFailure } from '@/lib/invoice-delivery'
import { failureText } from '@/lib/server-message'
import { isInvoiceEditable, isQuote } from '@/lib/invoice-editable'
import { paymentTermText, parsePaymentTerm, dueDateFromTerm, termFromDates, COMMON_PAYMENT_TERMS, MAX_PAYMENT_TERM_DAYS, longPaymentTermNotice } from '@/lib/payment-term'
import { applyDiscount, parseDiscount, discountLabel, lineNetEx, lineGrossEx } from '@/lib/invoice-discount'
import { round2 } from '@/lib/invoice-totals'
// [MIN-REGEL] When a set of lines stops describing a factuur — the same module the builder and the
// PUT route ask, so this screen cannot form its own opinion. See negative-line.ts.
import { staysAFactuur } from '@/lib/negative-line'
// [KOMMA-INVOER] The one comma-safe money field, shared with the builder and the credit screen.
import DecimalInput from '@/components/ui/DecimalInput'
import AdresZoeker from '@/components/AdresZoeker'
import BtwControle from '@/components/BtwControle'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath } from '@/lib/navigation-hooks'
import type { Role } from '@/lib/navigation'
import type { ProfileRow } from '@/types/rows'
import { COLUMN } from '@/lib/design/tokens';
import { formatDateNL, formatEuroNL } from '@/lib/format-nl'
// [PRIJS-MODUS] Dezelfde omrekening als het aanmaakscherm — één definitie, twee schermen.
import { priceFieldValue, priceFieldToStored, repriceForRateChange, type PriceMode } from '@/lib/price-mode'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
// [KLANT-EXTRA] Zelfde bovengrens als het document en de schrijfroute — zie de kop daarvan.
import { MAX_EXTRA_LINE_LENGTH } from '@/lib/client-extra-lines'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [CREDITNOTA-EXTERN] The door's own rule for a standalone creditnota, asked here first.
import { checkStandaloneCreditnota } from '@/lib/creditnota'

// [VERLEGD-VERKOOP] The rate menu's sentinel for 'btw verlegd': not a rate, so a value no rate can
// collide with, translated back into (0%, vat_treatment='reverse_charge') the moment it is chosen.
const REVERSE_CHARGE_OPTION = -2

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  // [VRIJGESTELD-ROUNDTRIP] Niet bewerkbaar op dit scherm, wél meegedragen. De PUT vervangt alle
  // regels door wat hier wordt teruggestuurd, dus een veld dat deze twee regels niet noemt bestaat
  // na het opslaan niet meer. vat_treatment is de vlag waaraan de aangifte vrijgestelde omzet
  // herkent; een vervaldatum wijzigen mag geen omzet naar een andere rubriek verhuizen.
  unit?: string | null
  vat_treatment?: string | null
  // [REGEL-KORTING] Wél bewerkbaar hier — een korting op een regel is bij uitstek iets wat je
  // aanpast nadat je hem hebt gegeven. `discount_value` is de ruwe invoer, net als bij de
  // documentkorting; parseDiscount beslist of het een korting is.
  discount_type?: 'percent' | 'amount' | null
  discount_value?: number | string | null
}

export default function InvoiceEditPage() {
  const router = useRouter()
  const t = translator(useLocale())
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [BOEK-031] Send flow state — May 2026
  const [invoiceStatus, setInvoiceStatus] = useState<string>('draft')
  // [HERSTEL] A sent invoice, fully editable while nothing is attached to it.
  const [canCorrectSent, setCanCorrectSent] = useState(false)
  // [OFFERTE-BEWERKBAAR] Dit scherm wist niet WAT het bewerkte. Het heette "Factuur bewerken" boven
  // een offerte, en zijn bevestiging beloofde "de factuur" te versturen.
  // [OFFERTE-GEEN-OMZETTING] Versturen van een offerte ZETTE hem om in een genummerde factuur
  // (send-route). Dat pad is weg: een offerte gaat hier als offerte de deur uit (send-offerte, de
  // deur die geen nummer kán slaan) en de factuur komt later via "Maak factuur aan" op de lijst.
  const [invoiceType, setInvoiceType] = useState<string>('factuur')
  const quote = isQuote(invoiceType)
  // [KORTING] Ook hier te wijzigen, niet alleen bij het aanmaken. Een korting die je alleen kunt
  // instellen door de factuur opnieuw te maken, is een korting die je bij de eerste onderhandeling
  // met de klant kwijt bent.
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [showSendModal, setShowSendModal] = useState(false)
  useCloseOnBack(!!showSendModal, () => setShowSendModal(false))
  const [sending, setSending] = useState(false)

  // [BOEK-031] Navigation Strategy — parent + home via helper — May 2026
  const role: Role = (profile?.role === 'accountant' ? 'accountant' : 'zzper')
  const parentHref = useParentPath(role)

  // بيانات العميل
  const [clientName, setClientName] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientPostal, setClientPostal] = useState('')
  const [clientCity, setClientCity] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientBtw, setClientBtw] = useState('')
  // [CREDITNOTA-EXTERN] A standalone creditnota names the invoice it corrects (art. 219) — the
  // number and date the owner typed for an invoice issued outside BoekBrug. A linked creditnota
  // carries original_invoice_id instead and never shows these two.
  const [creditedNumber, setCreditedNumber] = useState('')
  const [creditedDate, setCreditedDate] = useState('')
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | null>(null)
  // [KLANT-EXTRA] Twee vrije regels direct onder de klantnaam op het document — "t.a.v. …", een
  // afdeling of het inkoopordernummer dat de klant op de factuur wil zien. Leeg is de normale
  // toestand en levert precies het documentblok op dat er altijd al stond.
  const [clientExtra1, setClientExtra1] = useState('')
  const [clientExtra2, setClientExtra2] = useState('')
  const [clientExtra3, setClientExtra3] = useState('')
  const [clientExtra4, setClientExtra4] = useState('')

  // التواريخ
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  // [LEVERDATUM] Art. 35a lid 1 sub f Wet OB — de datum waarop de prestatie is verricht, en een
  // ander gegeven dan de factuurdatum. Het aanmaakscherm vroeg hem al; dit scherm niet, dus een
  // verkeerd ingevulde leverdatum was onherstelbaar behalve door het concept weg te gooien.
  const [deliveryDate, setDeliveryDate] = useState('')

  // البنود
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }
  ])
  // [REGELS-GELEZEN] Of de regels van deze factuur ECHT zijn gelezen. Zie de toelichting bij de
  // lezing zelf: zolang dit false is, mag dit scherm geen bewerkscherm zijn.
  const [regelsGelezen, setRegelsGelezen] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // جلب الفاتورة مع التحقق من الملكية في نفس الـ query
      const { data: invoice } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .eq('sender_id', user.id)
        .single()

      if (!invoice) { router.push('/dashboard'); return }

      // جلب profile المستخدم الحالي (للـ header)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileData) setProfile(profileData)

      // جلب الـ lines
      const { data: linesData, error: linesFout } = await supabase
        .from('invoice_lines')
        // [VRIJGESTELD-ROUNDTRIP] Dit scherm PUT terug wat het LEEST, en de PUT vervangt alle
        // regels. Wat hier niet wordt gelezen bestaat na het opslaan niet meer — vat_treatment is
        // de vlag waaraan de aangifte vrijgestelde omzet herkent, en [REGEL-KORTING] zou de
        // volgende kolom zijn geweest die van het lijstje viel.
        //
        // Vandaar '*' en geen opsomming: een naam in dat lijstje die de database niet kent laat
        // deze query falen. "Een kolomlijst die fout kan zijn, staat één tikfout van het leegmaken
        // van een factuur af" — dat stond hier, en het klopte.
        //
        // [REGELS-GELEZEN] Maar '*' haalt één OORZAAK weg, niet het GEVOLG. Elke andere mislukking
        // — een time-out, een korte storing, een policy die net verandert — geeft exact dezelfde
        // uitkomst: linesData null, het scherm houdt zijn ene lege beginregel, en het ziet er in
        // niets anders uit dan een gewoon bewerkscherm. Eén tik op Opslaan stuurt die ene lege
        // regel naar de PUT, die begint met `delete().eq('invoice_id', id)` — en de echte regels
        // bestaan niet meer. Bij een VERZONDEN factuur gaat de gecorrigeerde versie daarna
        // automatisch naar de klant.
        //
        // Dus wordt de fout nu wél gelezen, en een scherm dat zijn eigen regels niet kon lezen is
        // geen bewerkscherm. Het toont wat er mis is en biedt niets aan om op te slaan.
        .select('*')
        .eq('invoice_id', invoiceId)
      if (linesFout) {
        console.error('[REGELS-GELEZEN] factuurregels lezen mislukt — bewerken geweigerd', { invoiceId, linesFout })
        setLoading(false)
        return
      }
      setRegelsGelezen(true)

      // تعبئة الـ state بالبيانات الموجودة
      setInvoiceNumber(invoice.invoice_number)
      // [BOEK-031] Track current status for button visibility — May 2026
      setInvoiceStatus(invoice.status || 'draft')
      // [HERSTEL] May this SENT invoice be edited here? The screen decides from what it can
      // see; the PUT route checks everything (bank, kas, creditnota, verwerkt, filed quarter)
      // and refuses with the reason. Saving automatically delivers the corrected version to the
      // customer — the banner above the buttons says so before the tap.
      setCanCorrectSent(
        (invoice.status === 'sent' || invoice.status === 'overdue') &&
        (invoice.invoice_type || 'factuur') === 'factuur' &&
        !!invoice.invoice_number &&
        invoice.direction !== 'incoming' &&
        !(((invoice as { amount_paid?: number | null }).amount_paid ?? 0) > 0)
      )
      setInvoiceType(invoice.invoice_type || 'factuur')
      // [KORTING] Wat er staat, zoals het is opgeslagen. Zonder deze twee regels opende het scherm
      // met een leeg kortingsveld boven een verlaagd totaal, en de eerste "Wijzigingen opslaan"
      // haalde de korting er stilletjes af.
      const dt = (invoice as { discount_type?: string | null }).discount_type
      const dv = (invoice as { discount_value?: number | null }).discount_value
      if (dt === 'percent' || dt === 'amount') setDiscountType(dt)
      setDiscountValue(dv == null ? '' : String(dv))
      setClientName(invoice.client_name || '')
      setClientEmail(invoice.client_email || '')
      setClientAddress(invoice.client_address || '')
      setClientPostal(invoice.client_postal_code || '')
      setClientCity(invoice.client_city || '')
      setClientBtw(invoice.client_btw_number || '')
      // [CREDITNOTA-EXTERN] select('*') carries the two columns wherever the migration has run.
      setOriginalInvoiceId(invoice.original_invoice_id ?? null)
      setCreditedNumber((invoice as { credited_invoice_number?: string | null }).credited_invoice_number || '')
      setCreditedDate((invoice as { credited_invoice_date?: string | null }).credited_invoice_date || '')
      setClientExtra1(invoice.client_extra_line1 || '')
      setClientExtra2(invoice.client_extra_line2 || '')
      setClientExtra3(invoice.client_extra_line3 || '')
      setClientExtra4((invoice as { client_extra_line4?: string | null }).client_extra_line4 || '')
      setInvoiceDate(invoice.invoice_date || '')
      setDueDate(invoice.due_date || '')
      // [LEVERDATUM] Terugvallen op de factuurdatum, precies zoals /api/invoice/draft hem zet.
      // Een oude factuur zonder leverdatum opent dan met een ingevuld veld in plaats van een leeg
      // veld dat bij het opslaan een verplicht gegeven zou wissen.
      setDeliveryDate(
        (invoice as { delivery_date?: string | null }).delivery_date || invoice.invoice_date || ''
      )

      if (linesData && linesData.length > 0) setLines(linesData)

      setLoading(false)
    }
    load()
  }, [invoiceId])

  // ── [PRIJS-MODUS] Met of zonder btw typen ──────────────────────────────────
  // Dezelfde stand als op het aanmaakscherm, uit dezelfde localStorage-sleutel: wie zijn factuur
  // all-in heeft opgesteld, opent hem hier ook all-in. Zonder dit zou hij bij het bewerken ineens
  // ex-btw prijzen zien en die "corrigeren" naar zijn all-in bedrag — en dan klopt de factuur niet
  // meer met wat hij zijn klant beloofde. Wat er wordt opgeslagen blijft ex-btw.
  const [priceMode, setPriceMode] = useState<PriceMode>('excl')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('boekbrug.priceMode')
      // Externe opslag één keer inlezen bij het monteren — zie dezelfde uitzondering op het
      // aanmaakscherm; dit veroorzaakt geen cascade, het gebeurt eenmalig.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'incl' || saved === 'excl') setPriceMode(saved)
    } catch { /* geblokkeerde opslag: dan gewoon de standaard */ }
  }, [])
  function choosePriceMode(mode: PriceMode) {
    setPriceMode(mode)
    try { localStorage.setItem('boekbrug.priceMode', mode) } catch { /* niet erg */ }
  }
  /** Het prijsveld schrijft de prijs EX-btw weg, ook als er een incl-bedrag in staat. */
  function updateLinePrice(index: number, typed: number) {
    setLines(lines.map((l, i) => i === index
      ? { ...l, unit_price: priceFieldToStored(typed, l.btw_rate, priceMode) } : l))
  }
  /** [TARIEF] In incl-modus blijft de prijs voor de klant staan; in excl-modus de ingetypte prijs. */
  function updateLineRate(index: number, newRate: number) {
    // [VERLEGD-VERKOOP] A rate that charges btw cannot stay exempt or verlegd. A re-chosen 0% keeps
    // an exemption (this screen has no option to set one, so it must not lose one either) and drops
    // a verlegging, which has its own option below.
    setLines(lines.map((l, i) => i === index
      ? {
          ...l,
          btw_rate: newRate,
          unit_price: repriceForRateChange(l.unit_price, l.btw_rate, newRate, priceMode),
          vat_treatment: newRate > 0 || l.vat_treatment === 'reverse_charge' ? null : l.vat_treatment,
        }
      : l))
  }
  function markLineReverseCharged(index: number) {
    setLines(lines.map((l, i) => i === index
      ? { ...l, btw_rate: 0, vat_treatment: 'reverse_charge', unit_price: repriceForRateChange(l.unit_price, l.btw_rate, 0, priceMode) }
      : l))
  }

  // ── Line helpers ──────────────────────────────────────────────────────────
  function addLine() {
    setLines([...lines, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(index: number) {
    if (lines.length === 1) return
    setLines(lines.filter((_, i) => i !== index))
  }

  // [REGEL-KORTING] Aan- en uitzetten. Uitzetten wist allebei de velden: een waarde zonder soort
  // is geen korting, maar hij zou wel meereizen en op de server als half ingevuld worden geweigerd.
  function setLineDiscount(index: number, patch: Partial<Pick<InvoiceLine, 'discount_type' | 'discount_value'>>) {
    setLines(lines.map((l, i) => i === index ? { ...l, ...patch } : l))
  }

  function updateLine(index: number, field: keyof InvoiceLine, value: string | number) {
    const updated = [...lines]
    updated[index] = { ...updated[index], [field]: value }
    setLines(updated)
  }

  // ── Totalen — realtime ────────────────────────────────────────────────────
  // [KORTING] Dezelfde module als de server, de PDF en de UBL-export. Zonder korting geeft
  // applyDiscount exact dezelfde drie getallen als de handmatige sommen die hier stonden.
  // [BETAALTERMIJN-LANG] Uit de twee datums, want op dit scherm is de vervaldatum het veld dat
  // wordt getypt en de termijn de afgeleide.
  const langeTermijn = longPaymentTermNotice(invoiceDate ? termFromDates(invoiceDate, dueDate) : null)
  const korting = parseDiscount(discountType, discountValue)
  // [REGEL-AFRONDING] Afgerond per regel — dezelfde waarde die de PUT-route opslaat (line_total:
  // round2(quantity * unit_price)). Zonder dit toont dit scherm een ander totaal dan het bedrag
  // dat je met Opslaan wegschrijft.
  // [REGEL-KORTING] Netto per regel — dezelfde functie die de PUT-route in line_total zet.
  const regelNetto = (l: InvoiceLine) => lineNetEx({
    quantity: l.quantity, unit_price: l.unit_price,
    discount_type: l.discount_type, discount_value: l.discount_value,
  })
  const kortingTotalen = applyDiscount(
    lines.map(l => ({ line_total: regelNetto(l), btw_rate: l.btw_rate })),
    korting,
  )
  const subtotalEx = kortingTotalen.subtotal_ex_btw
  const totalEx = kortingTotalen.total_ex_btw
  const btwAmount = kortingTotalen.btw_amount
  const totalInc = kortingTotalen.total_inc_btw

  /**
   * [MIN-REGEL] What is wrong with these lines, in the owner's language — null when nothing is.
   *
   * Two buttons save this screen (opslaan and versturen) and each asked the same question in its
   * own copy of the code. A third question added to one of them only is how the two drift apart,
   * and the one that drifts is always the one nobody clicked while testing.
   */
  function lineProblem(): string | null {
    if (lines.some(l => !l.description || l.unit_price <= 0)) return t('bewerk.vulRegels')
    // A creditnota is negative by design ([CREDIT-SIGN]). A FACTUUR whose credits outweigh its
    // deliveries is a creditnota that was not made as one: the number comes out of the doorlopende
    // reeks for a document that gives money back, and the btw lands on the wrong side of the
    // aangifte. Same rule and same module as the door — see negative-line.ts.
    if (invoiceType !== 'creditnota' && !staysAFactuur(lines)) return t('nieuw.fout.creditnota')
    return null
  }

  // ── Opslaan — PUT ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError(t('bewerk.vulVerplicht'))
      return
    }
    const lineFault = lineProblem()
    if (lineFault) {
      setError(lineFault)
      return
    }

    setSaving(true)
    setError('')

    const res = await fetch(`/api/invoice/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        client_extra_line1: clientExtra1,
        client_extra_line2: clientExtra2,
        client_extra_line3: clientExtra3,
        client_extra_line4: clientExtra4,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [LEVERDATUM] Alleen op een factuur. Een offerte levert niets en een creditnota erft de
        // leverdatum van de factuur die zij corrigeert — die sleutel weglaten laat de opgeslagen
        // waarde staan, want de route patcht alleen wat het scherm meestuurt.
        ...(invoiceType === 'factuur' ? { delivery_date: deliveryDate || invoiceDate } : {}),
        // [KORTING] Altijd meesturen, ook leeg: dat is hoe de route "korting eraf halen"
        // onderscheidt van "een oudere pagina die het veld niet kent".
        discount_type: invoiceType === 'creditnota' ? null : discountType,
        discount_value: invoiceType === 'creditnota' ? null : discountValue,
        // [CREDITNOTA-EXTERN] Only a standalone creditnota carries these; the route writes them apart.
        ...(invoiceType === 'creditnota' && !originalInvoiceId
          ? { credited_invoice_number: creditedNumber, credited_invoice_date: creditedDate || null }
          : {}),
        lines
      })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(failureText(res.status, data, t('dzi.fout.opslaan')))
      setSaving(false)
      return
    }

    // [HERSTEL] The change stands, but the corrected version did not reach the customer — that
    // may not pass silently, since the customer still holds the old version. The route says
    // what to do next.
    if (data.warning === 'corrected_delivery_failed') {
      // The route answers 200 with a warning here, so there is no failing status to read —
      // failureText is given 200, which is exactly right: a <500 body may speak for itself.
      setError(failureText(200, data, t('bewerk.herstel.nietBezorgd')))
      setSaving(false)
      return
    }

    // [BOEK-031] replace ipv push — voorkomt back loop naar edit pagina — May 2026
    router.replace(`/dashboard/invoice/${invoiceId}`)
  }

  // [BOEK-031] Send invoice — saves first, then triggers /api/invoice/send — May 2026
  async function handleSendInvoice() {
    if (!clientName || !clientEmail || !invoiceDate || !dueDate) {
      setError(t('bewerk.vulVerplicht'))
      return
    }
    const lineFault = lineProblem()
    if (lineFault) {
      setError(lineFault)
      return
    }
    // [CREDITNOTA-EXTERN] The send door refuses a standalone creditnota that names no invoice
    // (art. 219); asked here first, where the field is on the screen.
    if (!checkStandaloneCreditnota({ invoiceType, originalInvoiceId, creditedNumber }).ok) {
      setError(t('nieuw.fout.creditVerwijzing'))
      return
    }

    setSending(true)
    setError('')

    // 1. Save changes first (PUT)
    const saveRes = await fetch(`/api/invoice/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        client_extra_line1: clientExtra1,
        client_extra_line2: clientExtra2,
        client_extra_line3: clientExtra3,
        client_extra_line4: clientExtra4,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [LEVERDATUM] Alleen op een factuur. Een offerte levert niets en een creditnota erft de
        // leverdatum van de factuur die zij corrigeert — die sleutel weglaten laat de opgeslagen
        // waarde staan, want de route patcht alleen wat het scherm meestuurt.
        ...(invoiceType === 'factuur' ? { delivery_date: deliveryDate || invoiceDate } : {}),
        // [KORTING] Ook op de opslaan-en-versturen weg. Dit is de gevaarlijkste van de twee: hier
        // wordt het document een genummerde factuur, en een korting die op dit pad wegvalt gaat
        // onherroepelijk mee de deur uit tegen de volle prijs.
        discount_type: invoiceType === 'creditnota' ? null : discountType,
        discount_value: invoiceType === 'creditnota' ? null : discountValue,
        // [CREDITNOTA-EXTERN] Only a standalone creditnota carries these; the route writes them apart.
        ...(invoiceType === 'creditnota' && !originalInvoiceId
          ? { credited_invoice_number: creditedNumber, credited_invoice_date: creditedDate || null }
          : {}),
        lines,
      }),
    })

    if (!saveRes.ok) {
      const data = await saveRes.json().catch(() => ({}))
      setError(failureText(saveRes.status, data, t('dzi.fout.opslaan')))
      setSending(false)
      return
    }

    // 2. Deliver. [OFFERTE-GEEN-OMZETTING] A quote goes out AS a quote, through the door that
    // cannot mint a number; the factuur comes later, from the sales list, through the new-invoice
    // path. Everything else goes to the send route, which mints the number, sets the status and mails.
    const sendRes = quote
      ? await fetch(`/api/invoice/${invoiceId}/send-offerte`, { method: 'POST' })
      : await fetch('/api/invoice/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId }),
        })

    if (!sendRes.ok) {
      const data = await sendRes.json().catch(() => ({}))
      setError(failureText(sendRes.status, data, t('bewerk.fout.verzenden')))
      setSending(false)
      return
    }

    // [VERSTUURD-EERLIJK] A 200 with a warning is a legally issued invoice the customer never
    // received. This path navigated to the detail page WITHOUT ?delivery=, so not even the
    // recovery banner appeared — the owner saw their new invoice number and nothing else.
    // Carrying the warning in the URL is what the detail page already knows how to read.
    const bezorgFout = deliveryFailure(await sendRes.json().catch(() => ({})))

    // 3. Success — refresh server data + navigate to detail
    router.refresh()
    router.replace(`/dashboard/invoice/${invoiceId}${bezorgFout ? `?delivery=${bezorgFout}` : ''}`)
  }

  // [SUBNAV] Title (+ invoice number) in the shared header; called before the
  // loading return so hook order stays stable.
  useSubPageHeader(
    { title: quote ? t('bewerk.titel.offerte') : invoiceNumber ? t('bewerk.titel.factuurMetNummer', { number: invoiceNumber }) : t('bewerk.titel.factuur') },
    [invoiceNumber, quote]
  )

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
      <p className="text-gray-400 text-sm">{t('nieuw.actie.laden')}</p>
    </div>
  )

  // [REGELS-GELEZEN] Geladen, maar zonder regels die we hebben kunnen lezen. Dit scherm bewerkt
  // door VERVANGING, dus het enige veilige aanbod is geen aanbod: geen formulier, geen Opslaan.
  if (!regelsGelezen) return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center px-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ maxWidth: 460 }}>
        <p className="text-gray-900 text-sm font-medium mb-2">{t('bewerk.regelsFout.kop')}</p>
        <p className="text-gray-500 text-sm leading-relaxed mb-4">{t('bewerk.regelsFout.uitleg')}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm font-medium text-gray-900 underline underline-offset-4"
        >
          {t('bewerk.regelsFout.opnieuw')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="mx-auto px-6 py-6 space-y-4" style={{ maxWidth: COLUMN.work }}>

        {/* Jouw gegevens — alleen-lezen */}
        {profile && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              {t('bewerk.jouwGegevens')}
            </p>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <p className="font-medium text-gray-900 col-span-2">{profile.company_name || profile.full_name}</p>
              <p className="text-gray-500">{profile.address}</p>
              <p className="text-gray-500">{profile.postal_code} {profile.city}</p>
              <p className="text-gray-500">KVK: {profile.kvk_number || '—'}</p>
              <p className="text-gray-500">BTW: {profile.btw_number || '—'}</p>
            </div>
            {(!profile.kvk_number || !profile.btw_number || !profile.iban) && (
              <p className="text-xs text-amber-500 mt-3">
                ⚠️ {t('bewerk.profielOnvolledig')}
              </p>
            )}
          </div>
        )}

        {/* Klantgegevens */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('bewerk.klantgegevens')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('nieuw.klant.bedrijf')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text" value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Klant BV"
              />
            </div>
            {/* [KLANT-EXTRA] Direct onder de naam, want dat is ook waar ze op het document staan.
                col-span-2 zodat een regel als "t.a.v. mevrouw Jansen · afdeling Inkoop" leesbaar
                blijft in een raster dat verder uit halve kolommen bestaat. */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra1')}</label>
                <input
                  type="text" value={clientExtra1} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra1(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="t.a.v. mevrouw Jansen"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra2')}</label>
                <input
                  type="text" value={clientExtra2} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra2(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('nieuw.klant.extraHint')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra3')}</label>
                <input
                  type="text" value={clientExtra3} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra3(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('nieuw.betaalkenmerk.hint')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.extra4')}</label>
                <input
                  type="text" value={clientExtra4} maxLength={MAX_EXTRA_LINE_LENGTH}
                  onChange={e => setClientExtra4(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('nieuw.klant.extraHint')}
                />
              </div>
              <p className="col-span-2 text-xs text-gray-500 -mt-1">
                {t('nieuw.klant.extraUitleg')}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('nieuw.klant.email')} <span className="text-red-400">*</span>
              </label>
              <input
                type="email" value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="klant@bedrijf.nl"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.adres')}</label>
              <input
                type="text" value={clientAddress}
                onChange={e => setClientAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Straat 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.postcode')}</label>
                <input
                  type="text" value={clientPostal}
                  onChange={e => setClientPostal(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="1234 AB"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.stad')}</label>
                <input
                  type="text" value={clientCity}
                  onChange={e => setClientCity(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="Amsterdam"
                />
              </div>
            </div>
            {/* [ADRES-ECHT] Ook op het bewerkscherm. Het stelt alleen voor — de vastgelegde
                momentopname van deze factuur verandert pas als de eigenaar Overnemen tikt, en
                dat is precies de handeling die hij op dit scherm sowieso komt doen. */}
            <AdresZoeker
              postcode={clientPostal}
              huisnummer={clientAddress.replace(/^\D+/, '')}
              straat={clientAddress.replace(/\s*\d.*$/, '')}
              plaats={clientCity}
              onOvernemen={(adres) => {
                setClientAddress(`${adres.street} ${adres.houseNumber}${adres.addition ? `-${adres.addition}` : ''}`)
                setClientPostal(`${adres.postcode.slice(0, 4)} ${adres.postcode.slice(4)}`)
                setClientCity(adres.city)
              }}
            />
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.klant.btw')}</label>
              <input
                type="text" value={clientBtw}
                onChange={e => setClientBtw(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="NL123456789B01"
              />
            </div>
            {/* [EU-BTW] Ook hier: een verlegde levering met een ongeldig nummer laat
                de btw bij de ondernemer liggen, en dit scherm is waar hij hem nog repareert. */}
            <BtwControle nummer={clientBtw} />
          </div>
          {/* [CREDITNOTA-EXTERN] The invoice this standalone creditnota corrects — named, or the
              document is not a creditnota at all (art. 219). Printed on the PDF, carried in the e-factuur. */}
          {invoiceType === 'creditnota' && !originalInvoiceId && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.credit.verwijzingNummer')}</label>
                <input
                  type="text" value={creditedNumber}
                  onChange={e => setCreditedNumber(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="2026-0123"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.credit.verwijzingDatum')}</label>
                {/* [DATE-NL] Typed in dd-mm-jjjj, like every other date on this screen. */}
                <DateFieldNL value={creditedDate} onChange={setCreditedDate} aria-label={t('nieuw.credit.verwijzingDatum')} />
              </div>
              <p className="col-span-2 text-xs text-gray-500">{t('nieuw.credit.verwijzingHint')}</p>
            </div>
          )}
        </div>

        {/* Datums */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('nieuw.datums')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('nieuw.datum.factuur')} <span className="text-red-400">*</span>
              </label>
              {/* [DATE-NL] The browser's locale decides a native date input's segment order, and
                  this date picks the quarter this sale is declared in. */}
              <DateFieldNL value={invoiceDate} onChange={setInvoiceDate} aria-label={t('nieuw.datum.factuur')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {quote ? t('nieuw.datum.geldig') : t('nieuw.datum.verval')} <span className="text-red-400">*</span>
              </label>
              <DateFieldNL value={dueDate} onChange={setDueDate} aria-label={quote ? t('nieuw.datum.geldig') : t('nieuw.datum.verval')} />
            </div>
          </div>

          {/* [LEVERDATUM] Art. 35a lid 1 sub f Wet OB. Alleen op een factuur: een offerte levert
              niets, en een creditnota houdt de leverdatum van de factuur die zij corrigeert.
              Het aanmaakscherm vroeg hem al en de PDF drukt hem af — dit veld ontbrak, dus was
              een verkeerde leverdatum alleen te herstellen door het concept weg te gooien. */}
          {invoiceType === 'factuur' && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('nieuw.datum.lever')}</label>
              <DateFieldNL value={deliveryDate} onChange={setDeliveryDate} aria-label={t('nieuw.datum.lever')} />
              <p className="text-[11px] text-gray-500 mt-1">
                {t('bewerk.datum.leverUitleg')}
              </p>
            </div>
          )}

          {/* [BETAALTERMIJN] De termijn zelf, vrij in te vullen.
              Op het nieuwe-factuurscherm stonden drie chips: 14, 30 en 60. Een termijn is iets wat
              je per klant afspreekt ("jij krijgt 45 dagen"), dus elk heel getal mag — de grens in
              payment-term.ts is een tikfoutgrens, geen beleid.
              Dit blok bestaat niet op een offerte: haar datum betekent "Geldig tot", niet een
              betaaltermijn, en één veld twee dingen laten betekenen is hoe een document iets anders
              gaat zeggen dan het scherm. */}
          {!quote && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <span className="text-xs text-gray-500">{t('nieuw.termijn.kort')}</span>
              {COMMON_PAYMENT_TERMS.map(days => {
                const active = invoiceDate !== '' && termFromDates(invoiceDate, dueDate) === days
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => { if (invoiceDate) setDueDate(dueDateFromTerm(invoiceDate, days)) }}
                    className={`text-sm px-3.5 py-1.5 rounded-full border ${active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    {t('nieuw.termijn.aantalDagen', { days })}
                  </button>
                )
              })}
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <span className="text-xs text-gray-500">{t('nieuw.termijn.of')}</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_PAYMENT_TERM_DAYS}
                  inputMode="numeric"
                  placeholder={t('nieuw.termijn.dagen')}
                  value={invoiceDate ? (termFromDates(invoiceDate, dueDate) ?? '') : ''}
                  onChange={e => {
                    const days = parsePaymentTerm(e.target.value)
                    if (days != null && invoiceDate) setDueDate(dueDateFromTerm(invoiceDate, days))
                  }}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  aria-label={t('nieuw.termijn')}
                />
              </label>
              {/* [BETAALTERMIJN-LANG] Zelfde woord als op het aanmaakscherm, en op dit scherm des
                  te nodiger: hier wordt de vervaldatum met de hand getypt, dus hier ontstaat een
                  termijn van een half jaar zonder dat iemand een knop met "180 dagen" aanklikte. */}
              {langeTermijn && (
                <p className="w-full text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">
                  {langeTermijn}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Factuurregels */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('nieuw.regels.factuur')}</p>

          {/* [PRIJS-MODUS] Dezelfde keuze als op het aanmaakscherm, boven de kolomkoppen — want hij
              bepaalt wat de kolom "Prijs" betekent. De koppen hieronder zeggen het daarna zelf, zodat
              niemand een all-in bedrag voor een ex-btw prijs aanziet (of andersom). */}
          <div className="flex items-center gap-3 flex-wrap bg-gray-50 rounded-xl px-3 py-2">
            <span className="text-xs font-medium text-gray-500">{t('nieuw.prijsmodus')}</span>
            <div role="group" aria-label={t('nieuw.prijsmodus.aria')} className="flex gap-1 bg-gray-200 rounded-full p-0.5">
              {(['excl', 'incl'] as PriceMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={priceMode === m}
                  onClick={() => choosePriceMode(m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${priceMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  {m === 'incl' ? t('nieuw.prijsmodus.inclKnop') : t('nieuw.prijsmodus.exclKnop')}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              {priceMode === 'incl' ? t('bewerk.prijsmodus.incl') : t('bewerk.prijsmodus.excl')}
            </span>
          </div>

          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 px-1">
            <div className="col-span-5">{t('nieuw.regel.omschrijving')}</div>
            <div className="col-span-2">{t('nieuw.regel.aantal')}</div>
            <div className="col-span-2">{priceMode === 'incl' ? t('nieuw.regel.prijsIncl') : t('nieuw.regel.prijsExcl')}</div>
            <div className="col-span-2">BTW</div>
            <div className="col-span-1"></div>
          </div>

          {lines.map((line, index) => (
            <div key={index}>
            <div className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5">
                <input
                  type="text" value={line.description}
                  onChange={e => updateLine(index, 'description', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder={t('bewerk.omschrijvingDienst')}
                />
              </div>
              <div className="col-span-2">
                <DecimalInput
                  /* [MIN-REGEL] No min. A credit line for a return is a NEGATIVE aantal — a
                     wholesaler settles it on the next invoice (ATAPACK 26304787: −3 x EUR 23,95) —
                     and this field refused it while the builder next door allowed it, so an
                     invoice could be made there and not edited here. What may be typed is decided
                     in negative-line.ts, not by the widget.
                     [KOMMA-INVOER] And the widget itself was <input type="number">, which in
                     Chromium DROPS the comma rather than refusing it: 0,5 arrived as 5. Half an
                     hour of work was billed as five. */
                  value={line.quantity}
                  onChange={v => updateLine(index, 'quantity', v)}
                  allowNegative
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                {/* [PRIJS-MODUS] Toont en accepteert de prijs in de gekozen stand; de regel
                    bewaart altijd ex-btw. */}
                <DecimalInput
                  /* [KOMMA-INVOER] Was <input type="number">, which in Chromium reads a typed
                     23,95 as "2395" — the unit price on an invoice that goes to a customer, a
                     hundred times too high, with nothing on screen to show it. DecimalInput is a
                     text field with a raw draft; see its header for the measurements.
                     [PRIJSVELD-CENT] Aantal en regeltotaal mee, zodat het veld net zoveel
                     decimalen toont als de regel nodig heeft. Op centen afgerond toonde het een
                     prijs die niet met zijn eigen regeltotaal vermenigvuldigt — en verving die
                     afgeronde prijs de opgeslagen breuk zodra er iets in het veld terechtkwam.
                     step="any": met step="0.01" weigert de browser zelf al een derde decimaal. */
                  /* [REGEL-KORTING] Bij een korting is het opgeslagen regeltotaal het NETTO
                     bedrag, en dat is niet waar deze prijs bij hoort: het veld zou dan naar een
                     precisie zoeken waarop aantal × prijs op het verlaagde bedrag uitkomt en een
                     prijs tonen die nooit is afgesproken. Dus het brutobedrag, of — zonder
                     korting — precies het regeltotaal dat hier altijd al werd meegegeven. */
                  value={priceFieldValue(line.unit_price, line.btw_rate, priceMode, line.quantity, line.discount_type ? lineGrossEx(line) : (line as { line_total?: number | null }).line_total)}
                  onChange={v => updateLinePrice(index, v)}
                  min={0}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  placeholder="0,00"
                />
              </div>
              <div className="col-span-2">
                <select
                  value={line.vat_treatment === 'reverse_charge' ? REVERSE_CHARGE_OPTION : line.btw_rate}
                  onChange={e => { const v = parseFloat(e.target.value); if (v === REVERSE_CHARGE_OPTION) markLineReverseCharged(index); else updateLineRate(index, v) }}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                >
                  <option value={21}>21%</option>
                  <option value={9}>9%</option>
                  <option value={0}>0%</option>
                  {/* [VERLEGD-VERKOOP] Not under the KOR: nothing to shift there, and the send door refuses it. */}
                  {!(profile as { kor_active?: boolean | null } | null)?.kor_active && (
                    <option value={REVERSE_CHARGE_OPTION}>{t('nieuw.regel.verlegd')}</option>
                  )}
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                {lines.length > 1 && (
                  <button
                    onClick={() => removeLine(index)}
                    className="text-gray-300 hover:text-red-400 text-xl leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* [REGEL-KORTING] Onder de regel waar hij bij hoort. Niet op een creditnota: dat
                document is zelf al een correctie — dezelfde regel als bij de documentkorting. */}
            {invoiceType !== 'creditnota' && (
              line.discount_type ? (
                <div className="flex items-center gap-2 flex-wrap mt-2 mb-1 ps-1">
                  <span className="text-xs text-gray-500">{t('nieuw.regelKorting')}</span>
                  <div className="inline-flex rounded-full border border-gray-200 overflow-hidden">
                    {(['percent', 'amount'] as const).map(soort => (
                      <button
                        key={soort}
                        type="button"
                        onClick={() => setLineDiscount(index, { discount_type: soort })}
                        className={`text-xs font-medium px-3 py-1 ${line.discount_type === soort ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}
                      >
                        {soort === 'percent' ? '%' : '€'}
                      </button>
                    ))}
                  </div>
                  <input
                    /* [KOMMA-INVOER] Not type="number": Chromium DROPS the comma, so a 12,5%
                       discount arrived as "125" (over MAX_PERCENT, hence no discount at all) and a
                       EUR 2,50 one as 250, capped at the whole invoice. No draft needed — the value
                       here IS the raw string, and parseDiscount already reads a comma. */
                    type="text" inputMode="decimal"
                    value={line.discount_value ?? ''}
                    onChange={e => setLineDiscount(index, { discount_value: e.target.value })}
                    aria-label={line.discount_type === 'percent' ? t('nieuw.korting.percentage') : t('nieuw.korting.bedrag')}
                    placeholder={line.discount_type === 'percent' ? t('nieuw.korting.hintPercentage') : t('nieuw.korting.hintBedrag')}
                    className="w-24 border border-gray-300 rounded-xl px-2 py-1 text-sm"
                  />
                  {/* Het bedrag dat er echt af gaat — een percentage zegt niets tot je het ziet. */}
                  {parseDiscount(line.discount_type, line.discount_value) && (
                    <span className="text-xs text-green-700 font-mono">
                      −{formatEuroNL(lineGrossEx(line) - regelNetto(line))}
                    </span>
                  )}
                  {String(line.discount_value ?? '').trim() !== '' && !parseDiscount(line.discount_type, line.discount_value) && (
                    <span className="text-xs text-red-600">
                      {line.discount_type === 'percent' ? t('nieuw.korting.foutPercentage') : t('nieuw.korting.foutBedrag')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLineDiscount(index, { discount_type: null, discount_value: '' })}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    {t('nieuw.regelKorting.weg')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setLineDiscount(index, { discount_type: 'percent', discount_value: '' })}
                  className="text-xs text-blue-600 font-medium mt-1 mb-1 ps-1"
                >
                  + {t('nieuw.regelKorting')}
                </button>
              )
            )}
            </div>
          ))}

          <button
            onClick={addLine}
            className="text-blue-600 text-sm font-medium hover:text-blue-700"
          >
            + {t('nieuw.regel.toevoegen')}
          </button>
        </div>

        {/* [KORTING] Op de factuur én de offerte, niet op een creditnota — dat document is al een
            correctie. Zelfde regels als het aanmaakscherm; de server valideert opnieuw. */}
        {invoiceType !== 'creditnota' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{t('nieuw.korting')}</span>
            <div className="inline-flex rounded-full border border-gray-200 overflow-hidden">
              {(['percent', 'amount'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDiscountType(t)}
                  className={`text-sm px-3.5 py-1.5 ${discountType === t ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'}`}
                >
                  {t === 'percent' ? '%' : '€'}
                </button>
              ))}
            </div>
            <input
              /* [KOMMA-INVOER] See the per-line discount above. */
              type="text"
              inputMode="decimal"
              placeholder={discountType === 'percent' ? t('nieuw.korting.hintPercentage') : t('nieuw.korting.hintBedrag')}
              value={discountValue}
              onChange={e => setDiscountValue(e.target.value)}
              aria-label={discountType === 'percent' ? t('nieuw.korting.percentage') : t('nieuw.korting.bedrag')}
              className="w-28 border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
            />
            {discountValue.trim() !== '' && !korting && (
              <span className="text-xs text-red-600">
                {discountType === 'percent' ? t('nieuw.korting.foutPercentage') : t('nieuw.korting.foutBedrag')}
              </span>
            )}
          </div>
        )}

        {/* Totalen */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="space-y-2 text-sm max-w-xs ms-auto">
            <div className="flex justify-between text-gray-500">
              <span>{t('nieuw.totaal.subtotaal')}</span>
              <span>€{subtotalEx.toFixed(2)}</span>
            </div>
            {kortingTotalen.discount_ex_btw > 0 && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>{discountLabel(korting)}</span>
                  <span>−€{kortingTotalen.discount_ex_btw.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>{t('nieuw.totaal.naKorting')}</span>
                  <span>€{totalEx.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-500">
              <span>BTW</span>
              <span>€{btwAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
              <span>{t('nieuw.totaal.incl')}</span>
              <span>€{totalInc.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Betalingsinformatie */}
        {profile?.iban && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('nieuw.betaalinfo')}
            </p>
            {/* [BETAALTERMIJN] De zin komt uit de DATA, niet uit een literal. Hier stond
                "binnen 30 dagen" als vaste tekst: wie een vervaldatum van veertien dagen had
                ingevuld, kreeg op het scherm waar hij zijn factuur nakijkt de belofte van dertig
                te zien. Het getal sloeg nergens op — en het stond op een document over geld.

                Is er niets eerlijks te zeggen (geen vervaldatum, of een datum vóór de
                factuurdatum), dan staat er niets. Zwijgen is beter dan een getal verzinnen. */}
            {quote ? (
              // Een offerte KENT geen betaaltermijn: haar due_date is "Geldig tot" — dat is wat de
              // PDF ervan drukt. Hier een betaalzin tonen zou het document tegenspreken.
              <p className="text-sm text-gray-600">
                {dueDate ? <>{t('bewerk.geldigTot')} <span className="font-medium text-gray-900">{formatDateNL(dueDate)}</span>. </> : null}
                {t('bewerk.akkoordBetaalOp')}{' '}
                <span className="font-medium text-gray-900">{profile.iban}</span>
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                {paymentTermText({ invoiceDateIso: invoiceDate, dueDateIso: dueDate, iban: profile.iban })
                  ?? t('bewerk.betalenOp')}{' '}
                <span className="font-medium text-gray-900">{profile.iban}</span>{' '}
                o.v.v.{' '}
                <span className="font-medium text-gray-900">{invoiceNumber}</span>
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500 px-1">{error}</p>
        )}

        {/* Acties */}
        <div className="flex gap-3 pb-8 flex-wrap">
          {isInvoiceEditable({ status: invoiceStatus, invoiceType, invoiceNumber }) ? (
            <>
              {/* [BOEK-031] Draft: 2 buttons — Save (keeps draft) + Send (triggers full flow) — May 2026 */}
              <button
                onClick={handleSave}
                disabled={saving || sending}
                className="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                {saving ? t('bewerk.opslaanBezig') : t('bewerk.opslaan')}
              </button>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={saving || sending}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? t('bewerk.verzendenBezig') : quote ? `✉ ${t('bewerk.offerteVersturen')}` : `✉ ${t('bewerk.verstuurFactuur')}`}
              </button>
            </>
          ) : canCorrectSent ? (
            // [HERSTEL] A sent invoice, fully editable — the market rule, with the locks in
            // the PUT route. One button, and the banner says beforehand what saving does: the
            // customer automatically receives the corrected version, the number never changes.
            <div className="w-full space-y-3">
              <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 leading-relaxed">
                {t('bewerk.herstel.uitleg', { number: invoiceNumber ?? '' })}
              </p>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-amber-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {saving ? t('bewerk.herstel.bezig') : `✉ ${t('bewerk.herstel.knop')}`}
              </button>
            </div>
          ) : (
            // [ART-35] Betaald, gecrediteerd of ingediend: dan is het document van meer partijen
            // dan de ondernemer alleen, en loopt een correctie via een creditnota — de PUT-route
            // weigert met de precieze reden.
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              {t('bewerk.vastgelegd')}
            </p>
          )}
          {/* [BOEK-031] Annuleren — Link to parent — Navigation Strategy — May 2026 */}
          <Link
            href={parentHref}
            className="border border-gray-200 text-gray-600 px-6 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 no-underline inline-block"
          >
            {t('nieuw.actie.annuleren')}
          </Link>
        </div>

      </div>

      {/* [BOEK-031] Send confirmation modal — TODO: extract to shared CenteredModal component — May 2026 */}
      {showSendModal && (
        <div onClick={() => setShowSendModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="sheet-scroll" onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.16)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#202124' }}>
              {t('bewerk.versturenNaar', { name: clientName })}
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 16, lineHeight: 1.5 }}>
              {quote
                ? t('bewerk.offerteBevestig')
                : t('detail.bevestig')}
            </p>
            <dl style={{ fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px' }}>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.nummer')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>
                {quote ? '—' : (invoiceNumber || t('bewerk.modal.nummerBijVerzending'))}
              </dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.email')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>{clientEmail}</dd>
              <dt style={{ color: '#5F6368', margin: 0 }}>{t('bewerk.modal.bedrag')}</dt>
              <dd style={{ color: '#202124', fontWeight: 500, margin: 0 }}>€{totalInc.toFixed(2)}</dd>
            </dl>
            {/* [OFFERTE-GEEN-OMZETTING] A quote gets no number, so the number warning is not its. */}
            {!quote && (
              <p style={{ fontSize: 12, color: '#B3261E', backgroundColor: '#FCE8E6', padding: 10, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
                ⚠ {t('bewerk.modal.waarschuwing')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSendModal(false)}
                style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
              <button onClick={() => { setShowSendModal(false); handleSendInvoice() }}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1A73E8', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {t('lijst.versturen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}