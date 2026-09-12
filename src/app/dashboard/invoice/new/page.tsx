'use client'

// src/app/dashboard/invoice/new/page.tsx
// [BOEK-031] Complete rebuild — Factuur / Offerte / Credit — May 2026
// Mobile-first, iOS-style design
// Supports: autocomplete clients, AI translation, offerte→factuur conversion

import React, { useState, useEffect, useRef, Suspense } from 'react'
// [FUNNEL-OVERDRACHT] De factuur die op /factuur-maken is gemaakt vóór er een account was.
import {
  readHandoff, clearHandoff, hasInvoiceContent, isMeaningfulLine, describeHandoff,
  type FactuurHandoff,
} from '@/lib/factuur-handoff'
import { deliveryFailure } from '@/lib/invoice-delivery'
import { createClient } from '@/lib/supabase'
// [MIN-REGEL] Where the minus sign may live on a line, and when a document stops being a factuur
// — see negative-line.ts.
import { lineSignFault, staysAFactuur } from '@/lib/negative-line'
// [KOMMA-INVOER] One comma-safe money field for every screen that has one.
import DecimalInput from '@/components/ui/DecimalInput'
import AdresZoeker from '@/components/AdresZoeker'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
// [BOEK-031] Navigation Strategy — May 2026
import { useParentPath } from '@/lib/navigation-hooks'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import type { Role } from '@/lib/navigation'
// [FACTUUR-A] Single Dutch formatting source — June 2026
import { amsterdamToday, formatDateNL } from '@/lib/format-nl'
// [ICP] Same classifier the aangifte and the ICP-opgaaf use, so the invoice screen and the
// quarter can never disagree about which customer counts as intra-EU.
import { classifyVatNumber } from '@/lib/icp'
import { matchArticles, foldText, type Article } from '@/lib/articles'
import { COMMON_PAYMENT_TERMS, DEFAULT_PAYMENT_TERM, MAX_PAYMENT_TERM_DAYS, parsePaymentTerm, dueDateFromTerm, longPaymentTermNotice } from '@/lib/payment-term'
import { applyDiscount, parseDiscount, discountLabel, lineNetEx } from '@/lib/invoice-discount'
// [AANBETALING] A deposit on an offerte and its settlement on the final invoice — see aanbetaling.ts.
import { depositLines, settlementLines, parseDepositPercent, discountLines, type OfferteSource } from '@/lib/aanbetaling'
// [REGEL-AFRONDING] round2: de uitsplitsing hieronder rekent over dezelfde afgeronde
// regelbedragen als het totaal, en als invoice_lines.line_total.
import { round2 } from '@/lib/invoice-totals'
// [VERSTUURD] De bevestiging na verzenden. De knop deed het onomkeerbaarste wat deze app kan —
// een definitief factuurnummer, een PDF, een mail naar een klant — en het scherm verving zichzelf
// zwijgend door de detailpagina. Zie invoice-sent-notice.ts.
import InvoiceSentModal from '@/components/ui/InvoiceSentModal'
import { invoiceSentNotice, type InvoiceSentNotice } from '@/lib/invoice-sent-notice'
// [TAAL] De taal die de ondernemer heeft gekozen. Niets anders op dit scherm hangt eraan: de
// factuur, de PDF en de mail blijven Nederlands.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { statusLabel } from '@/lib/invoice-status'
import type { MessageKey } from '@/lib/i18n/messages'
import { KOR_RATE_HINT } from '@/lib/kor-invoice'
import { hasReverseChargeLine, storedVatTreatment } from '@/lib/line-vat-treatment'
import { checkEuZeroRatedInvoice, countryNameNl, normalizeCountry } from '@/lib/client-country'
// [CREDITNOTA-EXTERN] The door's own rule for a standalone creditnota, asked here first.
import { checkStandaloneCreditnota } from '@/lib/creditnota'
import { M3, columnInner, COLUMN, sheetPaddingBottom } from '@/lib/design/tokens'
// [PRIJS-MODUS] Typen met of zonder btw — één pure omrekening, gedeeld met het bewerkscherm.
// Wat er wordt OPGESLAGEN blijft ex-btw; dit is een invoerstand, geen opslagformaat.
import {
  priceFieldValue, priceFieldToStored, repriceForRateChange, toDisplayCents, type PriceMode,
} from '@/lib/price-mode'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
// [KLANT-EXTRA] Zelfde bovengrens als het document en de schrijfroute — zie de kop daarvan.
import { MAX_EXTRA_LINE_LENGTH } from '@/lib/client-extra-lines'
import { failureText } from '@/lib/server-message'

// [PDF-VOORBEELD][PDF-LAZY] Het voorbeeld is één lazy brok — de renderer (~1,4 MB) én het
// document zitten samen in PdfPreviewButton.tsx, en dit scherm haalt dat bestand pas op wanneer de
// ondernemer op "Bekijk als PDF" drukt. Zou InvoicePDF hier gewoon geïmporteerd worden, dan trok
// die ene import de hele renderer alsnog in de eerste download en stelde de dynamic() niets voor —
// precies de val die in de kop van PdfDownloadButton.tsx staat beschreven.
const PdfPreviewButton = dynamic(() => import('@/components/invoice/PdfPreviewButton'), {
  ssr: false,
  loading: () => null,
})


// ─── Fixed Dutch formatting — never changes ────────────────────────────────────
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// ─── [FACTUUR-A] Numbering moved server-side — June 2026 ─────────────────────
// The browser-side generateNumber() was removed: it did a SELECT-then-compute
// from the client (the same race the TODO in invoice-numbering.ts warns about)
// AND bypassed the atomic, legal numbering in /api/invoice/send. The page now
// ALWAYS saves a draft (no number) and lets the send route mint the number —
// single source of truth, no gaps (Art. 35 Wet OB 1968). BRIDGE-C later swaps
// the route's internals to a PostgreSQL sequence.

// ─── [FACTUUR-A] Client-side BTW-id format check — June 2026 ─────────────────
// Mirrors BOEK-019: NL + 9 digits + 'B' + 2 digits (e.g. NL123456789B01).
// Non-blocking on the customer field (foreign customers are valid), but we
// flag a malformed Dutch-looking number so it never silently lands on a
// legal invoice.
const NL_BTW_RE = /^NL\d{9}B\d{2}$/i
function looksLikeDutchBtw(v: string): boolean {
  return /^NL/i.test(v.replace(/\s/g, ''))
}
function isValidDutchBtw(v: string): boolean {
  return NL_BTW_RE.test(v.replace(/\s/g, ''))
}

// ─── Types ─────────────────────────────────────────────────────────────────────

// [BOEK-031] fix type — creditnota replaces credit — May 2026
type InvoiceType = 'factuur' | 'offerte' | 'creditnota'

type Profile = {
  id: string
  full_name: string
  company_name: string
  kvk_number: string
  btw_number: string
  iban: string
  address: string
  postal_code: string
  city: string
  email: string
  // [BOEK-031] role needed for navigation parent — May 2026
  role?: string | null
  // [VRIJGESTELD] The owner's own declaration (Instellingen). Optional, because the profile is
  // read with select('*') and this column does not exist until vat_exemption.sql is applied —
  // absent then, which correctly hides the "Vrijgesteld" option instead of breaking the form.
  vat_exempt_activity?: boolean | null
  // [KOR-FACTUUR] Zit deze ondernemer in de kleineondernemersregeling? Dan brengt hij GEEN btw in
  // rekening, en dit scherm was de enige plek in de app die dat niet wist. Optioneel om dezelfde
  // reden als hierboven: het profiel wordt met select('*') gelezen.
  kor_active?: boolean | null
}

type Client = {
  id: string
  name: string
  email: string
  address: string
  postal_code: string
  city: string
  btw_number: string
  kvk_number: string
  // [BESTE] The payment term agreed with this customer (clients_term_phone.sql); absent = default.
  payment_term_days?: number | null
  // [KLANT-LAND] ISO code (client_country.sql); absent = not recorded, read as the Netherlands.
  country?: string | null
}

// [VRIJGESTELD] Sentinel for the BTW-tarief dropdown. "Vrijgesteld" is not a rate, but a
// <select> can only carry one value per option — so a value that is not a legal NL rate stands
// in for it, and is translated back into (0%, vat_treatment='exempt') the moment it is chosen.
// Negative on purpose: no rate can ever collide with it.
const EXEMPT_OPTION = -1
// [VERLEGD-VERKOOP] Same trick for the verleggingsregeling: 0% plus the flag 'reverse_charge'.
const REVERSE_CHARGE_OPTION = -2

// [AANBETALING] Every ISSUED deposit on an offerte, as the credit lines that settle it on the
// final invoice, plus their numbers for the banner. A deposit still in concept is not money the
// customer paid, so it is not settled — and the offerte is archived on send, which is where a
// forgotten concept deposit stays visible: in the list, under its own name. A failed read throws
// into the caller's load, like every other read there.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function issuedDepositsOn(db: any, offerteId: string): Promise<{ lines: InvoiceLine[]; numbers: string[] }> {
  type DepositRow = { id: string; invoice_number: string | null; invoice_lines: { quantity: number | null; unit_price: number | null; line_total: number | null; btw_rate: number | null; vat_treatment: string | null }[] | null }
  const { data, error } = await db
    .from('invoices')
    .select('id, invoice_number, invoice_lines(quantity, unit_price, line_total, btw_rate, vat_treatment)')
    .eq('deposit_on_offerte_id', offerteId)
    .in('status', ['sent', 'paid', 'overdue', 'processing']) as { data: DepositRow[] | null; error: { message: string } | null }
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return {
    lines: settlementLines(rows.map(d => ({ invoiceNumber: d.invoice_number, lines: d.invoice_lines ?? [] }))).map(l => ({ ...l, unit: null })),
    numbers: rows.map(d => d.invoice_number ?? '').filter(Boolean),
  }
}

type InvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  // [VRIJGESTELD] 'exempt' = vrijgestelde prestatie (art. 11 Wet OB): geen BTW, en de omzet gaat
  // in GEEN aangifterubriek. Alleen te kiezen als de ondernemer dat in Instellingen heeft
  // verklaard; afwezig = gewoon belast, precies zoals elke regel van vóór dit veld.
  // [VERLEGD-VERKOOP] 'reverse_charge' = btw verlegd naar de klant (art. 12 lid 5 Wet OB): 0% op de
  // regel, de omzet in rubriek 1e, en het btw-nummer van de klant verplicht op de factuur.
  vat_treatment?: 'exempt' | 'reverse_charge' | null
  // [UNIT] De eenheid van deze regel ("uur", "m²", "stuk"). Komt mee uit de catalogus zodra
  // je een artikel kiest, en gaat door naar invoice_lines.unit → de UN/ECE-code in de e-factuur.
  // Leeg = geen eenheid, wat neerkomt op C62 (stuk) — precies het gedrag van vóór dit veld.
  unit?: string | null
  // [REGEL-KORTING] De korting op DEZE regel. `discount_value` is de RUWE invoer, net als bij de
  // documentkorting: het scherm bewaart wat er getypt staat en parseDiscount beslist of het een
  // korting is. Zo blijft "12," tijdens het typen gewoon een half getypt getal in plaats van een
  // veld dat onder je vingers naar nul springt.
  discount_type?: 'percent' | 'amount' | null
  discount_value?: string
  // [BOEK-031] AI translation support per line
  translating?: boolean
  rawInput?: string
}

// [AANBETALING-KORTING] The offerte's document discount as credit lines for the final invoice. Only
// read when a deposit is settled — a header discount over a subtotal that already holds the
// settlement discounts the deposit twice. Why and how: aanbetaling.ts.
function offerteDiscountLines(
  offLines: OfferteSource['lines'] | null,
  offHead: { discount_type?: unknown; discount_value?: unknown; invoice_number?: string | null } | null,
): InvoiceLine[] {
  return discountLines({
    lines: offLines ?? [],
    discount: parseDiscount(offHead?.discount_type, offHead?.discount_value),
    invoiceNumber: offHead?.invoice_number ?? null,
  }).map(l => ({ ...l, unit: null }))
}

// ─── Config ────────────────────────────────────────────────────────────────────

// [DS] Design System v1.0 — Type config with DS tokens
// [TAAL] `label` is een sleutel, geen woord — zie src/lib/i18n/messages.ts.
const TYPE_CONFIG: Record<InvoiceType, {
  label: MessageKey
  activeBg: string      // active chip background
  activeColor: string   // active chip text
  activeBorder: string  // active chip border
  primaryBtn: string    // primary button color
  focusColor: string    // input focus border color
}> = {
  factuur: {
    label: 'nieuw.type.factuur',
    activeBg: '#D3E3FD', activeColor: '#1967D2', activeBorder: '#1A73E8',
    primaryBtn: '#1A73E8', focusColor: '#1A73E8',
  },
  offerte: {
    label: 'nieuw.type.offerte',
    activeBg: '#FEF7E0', activeColor: '#EA8600', activeBorder: '#FBBC04',
    primaryBtn: '#FBBC04', focusColor: '#FBBC04',
  },
  creditnota: {
    label: 'nieuw.type.creditnota',
    activeBg: '#F9DEDC', activeColor: '#B3261E', activeBorder: '#EA4335',
    primaryBtn: '#EA4335', focusColor: '#EA4335',
  },
}

// ─── [DS] LineInput — number input for Factuurregels ─────────────────────────
// Fixes: no leading zero, comma/dot both work, step=1, Enter→next input
function LineInput({
  label, value, onChange, min = 0, allowNegative = false, focusColor, hasError = false,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  /** [MIN-REGEL] Only a quantity may go below zero. See DecimalInput and negative-line.ts. */
  allowNegative?: boolean
  focusColor: string
  hasError?: boolean
}) {
  // [KOMMA-INVOER] The typing behaviour — comma, raw draft, Enter, arrows — lives in DecimalInput
  // now, shared with the invoice editor and the credit screen. It used to be written out here, and
  // being written out HERE is why the editor next door kept an <input type="number"> that silently
  // read 23,95 as 2395. This wrapper is the label and the Material You look, nothing more.
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: hasError ? '#EA4335' : focused ? focusColor : '#5F6368' }}>{label}</label>
      <DecimalInput
        value={value}
        onChange={onChange}
        min={min}
        allowNegative={allowNegative}
        onFocusChange={setFocused}
        style={{
          width: '100%', minHeight: 44,
          border: `${hasError || focused ? '2px' : '1px'} solid ${hasError ? '#EA4335' : focused ? focusColor : '#E0E0E0'}`,
          borderRadius: 8, padding: '0 12px',
          fontSize: 16, color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white', outline: 'none',
          boxSizing: 'border-box', transition: 'border 0.1s ease',
          fontFamily: 'Roboto Mono, monospace',
        }}
      />
    </div>
  )
}

// ─── [DS] OutlinedInput — Material You Outlined Text Field ─────────────────────
// font-size: 16px mandatory to prevent iOS auto-zoom
// Enter key moves focus to next input
function OutlinedInput({
  value, onChange, onFocus, placeholder, label, type = 'text', required = false, focusColor, hasError = false,
  maxLength,
}: {
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFocus?: () => void
  placeholder?: string
  label: string
  type?: string
  required?: boolean
  focusColor: string
  hasError?: boolean
  /** [KLANT-EXTRA] Een harde bovengrens die de INVOERDER ziet. Pas afkappen bij het renderen zou
   *  betekenen dat een klant een half inkoopordernummer ontvangt zonder dat iemand het merkt. */
  maxLength?: number
}) {
  const [focused, setFocused] = useState(false)

  // [FACTUUR-A] On mobile, the fixed bottom action bar + the on-screen
  // keyboard can cover a focused field. Nudge it into the middle of the
  // visible area. Guarded so it only fires on small screens.
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(true)
    onFocus?.()
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      const el = e.currentTarget
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.closest('[data-form]') ?? document
      const focusable = Array.from(
        form.querySelectorAll<HTMLElement>('input, select, button, textarea')
      ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      const idx = focusable.indexOf(e.currentTarget)
      if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
    }
  }

  // [BOEK-031] border color priority: error > focused > default
  const borderColor = hasError ? '#EA4335' : focused ? focusColor : '#E0E0E0'
  const borderWidth = hasError || focused ? '2px' : '1px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: hasError ? '#EA4335' : focused ? focusColor : '#5F6368' }}>
        {label}{required && <span style={{ color: M3.error, marginInlineStart: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%',
          minHeight: 48,
          border: `${borderWidth} solid ${borderColor}`,
          borderRadius: 8,
          padding: '0 16px',
          fontSize: 16,
          color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border 0.1s ease',
          fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// ─── [FACTUUR-A · DATE-NL] DateField ─────────────────────────────────────────
// A native <input type="date"> renders its SEGMENTS in the browser's locale, so a US desktop puts
// the month first and a Dutch owner cannot type a two-digit day at all — "21" for the 21st becomes
// February and the caret jumps. Measured: `lang` on the input, on a wrapper, and on <html> (which
// this app sets to "nl") change nothing.
//
// An earlier attempt here forced DD-MM-YYYY by OVERLAYING the native control, which produced a
// doubled calendar icon and a worse tap experience, and was rightly reverted to a clean native
// field plus a Dutch caption. The caption made the value unambiguous once typed; it could not make
// the typing work.
//
// DateFieldNL is not that overlay. The typing surface IS a text input in Dutch order, and the
// native control is a 1px hidden element that exists only so the calendar button can call
// showPicker() — it renders no icon of its own, so there is nothing to double. The picker stays
// one tap away, which is what made the native field worth keeping on a phone.
// Value in/out stays ISO (yyyy-mm-dd).
function DateField({
  value, onChange, label, required = false, focusColor, hasError = false, min,
}: {
  value: string                 // ISO yyyy-mm-dd
  onChange: (iso: string) => void
  label: string
  required?: boolean
  focusColor: string
  hasError?: boolean
  min?: string                  // ISO lower bound (optional)
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 14, fontWeight: 500, color: hasError ? '#EA4335' : focusColor }}>
        {label}{required && <span style={{ color: M3.error, marginInlineStart: 2 }}>*</span>}
      </label>
      <DateFieldNL
        value={value}
        onChange={onChange}
        min={min}
        aria-label={label}
        style={{
          minHeight: 48,
          border: `${hasError ? '2px' : '1px'} solid ${hasError ? '#EA4335' : '#E0E0E0'}`,
          borderRadius: 8, padding: '0 16px',
          fontSize: 16, color: '#202124',
          backgroundColor: hasError ? '#FFF8F7' : 'white',
          outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// ─── [FACTUUR-A] Payment-term presets — June 2026 ────────────────────────────
// Quick chips that compute Vervaldatum = Factuurdatum + N days. Manual editing
// stays fully available via the DateField. 30 days is the Dutch default.
// [BETAALTERMIJN] De lijst en de standaard staan nu in payment-term.ts, samen met de rekenregels
// en de zin die het bewerkscherm eruit opbouwt. Twee schermen met elk hun eigen kopie van "wat is
// een termijn" is precies hoe die twee uit elkaar gaan lopen.
const BETALINGSTERMIJNEN = COMMON_PAYMENT_TERMS
const DEFAULT_TERMIJN = DEFAULT_PAYMENT_TERM
function addDaysISO(iso: string, days: number): string {
  // String-based to stay timezone-proof on date-only values.
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().split('T')[0]
}

// ─── Component ─────────────────────────────────────────────────────────────────

function NewInvoicePageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // Read query params at component level so useEffect doesn't depend on searchParams
  const typeParam           = searchParams.get('type') as InvoiceType | null
  const originalParam       = searchParams.get('original') ?? ''
  const offerteParam        = searchParams.get('from_offerte') ?? ''
  // [AANBETALING] ?aanbetaling=30 with from_offerte: a deposit of 30% on that offerte, not the whole.
  const aanbetalingParam    = searchParams.get('aanbetaling') ?? ''
  const replacesParam       = searchParams.get('replaces') ?? ''
  const replacesNumberParam = searchParams.get('replacesNumber') ?? ''
  // AI-generated params from ZzpDashboard
  const aiClientName    = searchParams.get('client_name') ?? ''
  const aiClientId      = searchParams.get('client_id') || null  // [KLANTEN] pre-link to a customer
  const aiClientEmail   = searchParams.get('client_email') ?? ''
  // [BOEK-029] offerte→factuur params — all client fields
  const aiClientAddress = searchParams.get('client_address') ?? ''
  const aiClientPostal  = searchParams.get('client_postal_code') ?? ''
  const aiClientCity    = searchParams.get('client_city') ?? ''
  const aiClientBtw     = searchParams.get('client_btw_number') ?? ''
  const aiClientCountry = searchParams.get('client_country') ?? ''
  const aiDescription   = searchParams.get('description') ?? ''
  const aiAmount        = parseFloat(searchParams.get('amount') ?? '0') || 0
  const aiBtwRate       = parseFloat(searchParams.get('btw_rate') ?? '21') || 21

  // ── Core state ──────────────────────────────────────────────────────────────
  const [profile, setProfile]         = useState<Profile | null>(null)
  // [NUMMER-VOORUITBLIK] Het nummer dat deze factuur straks krijgt, om te WETEN — niet om op te
  // rekenen. GET /api/invoice/numbering leest `last_seq` en telt er één bij op; het verbruikt
  // niets, want alleen next_invoice_seq() mag de teller ophogen en dat gebeurt pas bij verzending.
  //
  // null = niet (meer) bekend, en dan toont het scherm de regel gewoon niet. Dat is de eerlijke
  // lege stand: een medewerker krijgt hier een 403 (de route is eigenaar-only, zie owner-only.ts)
  // en zíjn factuur wordt genummerd uit de teller van de EIGENAAR — een getal uit zijn eigen lege
  // teller tonen zou een verkeerd nummer zijn, geen behulpzaam nummer.
  const [nextNumber, setNextNumber] = useState<string | null>(null)
  // [BOEK-031] Navigation Strategy — parent + home via helper — May 2026
  const role: Role = (profile?.role === 'accountant' ? 'accountant' : 'zzper')
  const parentHref = useParentPath(role)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [loading, setLoading]         = useState(false)
  // [BOEK-031] linesLoading — wait for DB lines before allowing submit — May 2026
  const [linesLoading, setLinesLoading] = useState(!!offerteParam)
  const [error, setError]             = useState('')
  // [BOEK-031] Field-level errors — shows red borders on specific fields — May 2026
  const [fieldErrors, setFieldErrors] = useState<{
    clientName?: boolean
    clientEmail?: boolean
    clientAddress?: boolean
    invoiceDate?: boolean
    dueDate?: boolean
    deliveryDate?: boolean
    lines?: { description?: boolean; unit_price?: boolean; quantity?: boolean }[]
  }>({})

  function clearFieldError(field: string) {
    setFieldErrors(prev => ({ ...prev, [field]: false }))
  }

  // [BOEK-031] Invoice type — from_offerte always forces factuur — May 2026
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    offerteParam
      ? 'factuur'  // coming from offerte → always factuur
      : typeParam && ['factuur', 'offerte', 'creditnota'].includes(typeParam)
        ? typeParam
        : 'factuur'
  )

  // ── Client autocomplete ──────────────────────────────────────────────────────
  const [clients, setClients]               = useState<Client[]>([])
  const [clientSearch, setClientSearch]     = useState(aiClientName)
  const [showDropdown, setShowDropdown]     = useState(false)
  // [WEIGERING] Het concept dat een GEWEIGERDE verzending achterliet.
  //
  // De route valideert vóór ze een nummer slaat, dus bij een weigering bestaat het concept al maar
  // is er niets wettelijks gebeurd. Tot nu toe navigeerde dit scherm daarna meteen weg — met
  // `setError()` op de regel ervóór, op een component die op de volgende regel verdwijnt. De zin
  // die precies vertelt wát er ontbreekt ("Vul eerst je BTW-nummer… — wettelijk verplicht") werd
  // dus geschreven en nooit gelezen. De ondernemer landde op een scherm dat hij niet kende, zonder
  // één woord, en moest daar opnieuw op Versturen drukken om te horen waarom.
  //
  // Nu blijft hij staan en leest hij het. Dit id onthoudt het achtergelaten concept, zodat een
  // tweede poging het eerst OPRUIMT in plaats van een tweede concept naast het eerste te zetten.
  const [afgekeurdConcept, setAfgekeurdConcept] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(aiClientId)
  const autocompleteRef                     = useRef<HTMLDivElement>(null)

  // ── Client fields ────────────────────────────────────────────────────────────
  const [clientName, setClientName]       = useState(aiClientName)
  const [clientEmail, setClientEmail]     = useState(aiClientEmail)
  // [BOEK-029] pre-fill from offerte params — May 2026
  const [clientAddress, setClientAddress] = useState(aiClientAddress)
  const [clientPostal, setClientPostal]   = useState(aiClientPostal)
  const [clientCity, setClientCity]       = useState(aiClientCity)
  const [clientBtw, setClientBtw]         = useState(aiClientBtw)
  // [KLANT-LAND] The customer's country code; empty reads as the Netherlands everywhere.
  const [clientCountry, setClientCountry] = useState(aiClientCountry)
  // [CREDITNOTA-EXTERN] A standalone creditnota names the invoice it corrects — one issued outside
  // BoekBrug, so there is no row to link: number and date are typed here, printed on the document
  // and carried in the e-factuur (art. 219 Richtlijn 2006/112/EG).
  const [creditedNumber, setCreditedNumber] = useState('')
  const [creditedDate, setCreditedDate]     = useState('')
  // [KLANT-EXTRA] Twee vrije regels direct onder de klantnaam op het document — "t.a.v. …", een
  // afdeling of het inkoopordernummer dat de klant op de factuur wil zien staan. Per document,
  // niet per klant: een inkoopordernummer verschilt per factuur.
  const [clientExtra1, setClientExtra1]   = useState('')
  const [clientExtra2, setClientExtra2]   = useState('')
  const [clientExtra3, setClientExtra3]   = useState('')
  const [clientExtra4, setClientExtra4]   = useState('')
  // [ICP] A customer number that names another EU member state but cannot have that length.
  // classifyVatNumber is deliberately conservative — it only says "suspect" when the length is
  // impossible for that country, so a valid number is never called wrong.
  const euVatSuspect = classifyVatNumber(clientBtw).kind === 'eu_suspect'
  // [ICP] A customer in another member state. Stated, never decided: whether THIS supply is an
  // intracommunautaire prestatie depends on what is being supplied and on the customer acting as
  // a business — a judgement the app must not make. What it can do is say it here, where the
  // rate is still being chosen, instead of leaving the owner to find out at the aangifte.
  const euVatCustomer = classifyVatNumber(clientBtw).kind === 'eu'

  // ── Dates ────────────────────────────────────────────────────────────────────
  // [TZ] The owner's Amsterdam day, not the UTC one. This value seeds BOTH the
  // factuurdatum and the leverdatum of a document that carries a number from the
  // doorlopende reeks — and toISOString() is still on yesterday until 01:00 (02:00
  // in summer). An invoice typed just after midnight on 1 January would be dated
  // into the previous fiscal year and the previous BTW-quarter.
  const today = amsterdamToday()
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate]         = useState('')
  // [FACTUUR-A] Leverdatum (Art. 35a sub f) — defaults to invoice date until
  // the user touches it. deliveryTouched tracks that so changing the
  // factuurdatum keeps the (still-untouched) leverdatum in sync.
  const [deliveryDate, setDeliveryDate]       = useState(today)
  const [deliveryTouched, setDeliveryTouched] = useState(false)
  // [FACTUUR-A] Selected payment term (days). Drives Vervaldatum from
  // Factuurdatum. null = manually edited (no chip highlighted).
  const [betalingstermijn, setBetalingstermijn] = useState<number | null>(DEFAULT_TERMIJN)

  // [FACTUUR-A] Send confirmation dialog — sending is irreversible (number
  // consumed + e-mail delivered). Centered modal, per house convention.
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  // [VERSTUURD] Gevuld zodra /api/invoice/send klaar is met een nummer. Zolang dit staat blijft
  // de pagina staan: elke uitgang van het paneel navigeert zelf, want de factuur bestaat al.
  const taal = useLocale()
  const t = translator(taal)
  const [sentNotice, setSentNotice] = useState<InvoiceSentNotice | null>(null)
  // [OFFERTE-VERSTUREN-NIEUW] De bevestiging nadat een offerte vanaf DIT scherm is gemaild. De
  // message komt van de route zelf ([SERVER-ZIN]-conventie: de server spreekt Nederlands tegen de
  // eigenaar) — die zin zegt ook dat er nog GEEN factuur bestaat, en dat mag hier niet verloren
  // gaan: het is precies het misverstand dat deze aparte deur bestaat om te voorkomen.
  const [offerteSent, setOfferteSent] = useState<{ id: string; message: string } | null>(null)
  const [sentInvoiceId, setSentInvoiceId] = useState<string | null>(null)
  useCloseOnBack(!!showSendConfirm, () => setShowSendConfirm(false))

  // ── Lines — pre-filled from replace flow, offerte, or AI generation ──────────
  // [BOEK-029] from offerte: use total_ex_btw as unit_price so BTW calculates correctly
  const aiTotalExBtw = parseFloat(searchParams.get('total_ex_btw') ?? '0') || 0
  const aiTotalIncBtw = parseFloat(searchParams.get('total_inc_btw') ?? '0') || 0
  const offerteUnitPrice = aiTotalExBtw > 0 ? aiTotalExBtw : aiTotalIncBtw || aiAmount

  const [lines, setLines] = useState<InvoiceLine[]>(
    replacesNumberParam
      ? [{ description: `Vervangt factuur ${replacesNumberParam}`, quantity: 1, unit_price: 0, btw_rate: 21 }] // [TAAL-DB] invoice line text — document content stays Dutch
      : offerteParam
        ? [{ description: aiDescription || '', quantity: 1, unit_price: offerteUnitPrice, btw_rate: aiBtwRate }]
        : [{ description: aiDescription, quantity: 1, unit_price: aiAmount, btw_rate: aiBtwRate }]
  )

  // [FUNNEL-OVERDRACHT] De factuur uit de gratis generator, als die er is. Alleen bij een
  // gewone nieuwe factuur: komt de gebruiker hier via een offerte, een vervanging of een scan,
  // dan is hij met iets anders bezig en zou dit aanbod alleen in de weg zitten.
  const [handoff, setHandoff] = useState<FactuurHandoff | null>(null)
  useEffect(() => {
    if (replacesNumberParam || offerteParam || aiClientName || aiDescription) return
    try {
      const h = readHandoff(localStorage)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (hasInvoiceContent(h)) setHandoff(h)
    } catch {
      /* geblokkeerde opslag — dan is er gewoon niets aan te bieden */
    }
  }, [replacesNumberParam, offerteParam, aiClientName, aiDescription])

  // [COHERENCE-CREDITNOTA] Credit-flow state removed — see the note further down, above the submit.
  // Creditnotas are created from the original invoice's detail dialog, not here.

  // ── Replace flow — read-only from URL, never mutated ─────────────────────────
  const replacesId     = replacesParam
  const replacesNumber = replacesNumberParam

  // offerte_id if we're converting an existing offerte — read-only from URL
  const offerteId = offerteParam
  // [AANBETALING] Null when this is not a deposit. Decides three things below: which lines are
  // loaded, whether the offerte is archived on send, and what the draft door is told.
  const depositPct = offerteParam ? parseDepositPercent(aanbetalingParam) : null
  // [AANBETALING] The numbers of the deposits the final invoice settles — for the banner only.
  const [settledDeposits, setSettledDeposits] = useState<string[]>([])
  // [AANBETALING-KORTING] The offerte's document discount travelled as credit lines (see the load).
  const [discountAsLines, setDiscountAsLines] = useState(false)

  // [SUBNAV] Dynamic title (factuur / offerte / creditnota) + the offerte
  // "Omzetten naar factuur" action, pushed into the shared sub-page header.
  // Called before the loading early-return so hook order stays stable.
  useSubPageHeader(
    {
      // [NUMMER-VOORUITBLIK] Het verwachte nummer in de KOP, vanaf binnenkomst — de kaart verderop
      // legt uit; de kop zorgt dat niemand hem hoeft te vinden. Zelfde eerlijkheid als de kaart:
      // "(verwacht)" hoort bij het getal, want het nummer valt pas definitief bij verzending.
      title:
        invoiceType === 'offerte' ? t('nieuw.titel.offerte') :
        invoiceType === 'creditnota' ? statusLabel('credit', taal) :
        nextNumber ? t('nieuw.titel.factuurMetNummer', { nummer: nextNumber }) : t('nieuw.titel.factuur'),
    },
    // nextNumber in de deps: de kop moet bijtrekken zodra de vooruitblik binnenkomt — anders
    // registreert hij één keer zonder nummer en blijft zo staan.
    // [OFFERTE-GEEN-OMZETTING] The "Omzetten →" action that stood in this header opened a dialog
    // that built a factuur from the screen's state — a second copy of the from_offerte submit,
    // with its own drift (#311 had to patch its discount apart). Gone: one path.
    [invoiceType, nextNumber]
  )

  // [KORTING] Percentage of bedrag, op de hele factuur — en op een offerte net zo goed: daar is
  // korting juist het gesprek. De verdeling over de btw-tarieven staat in invoice-discount.ts; hier
  // wordt alleen ingevuld en getoond.
  //
  // [OFFERTE-OMZETTEN-VOLLEDIG] Staat hier, BOVEN de load-effect die hem vult. Hij stond honderd
  // regels lager, en dan leest de effect-callback een const boven zijn eigen declaratie — precies
  // de vorm waarvan AGENTS.md een incident beschrijft: tsc modelleert niet WANNEER een closure
  // draait, dus dit type-checkte, bouwde en kwam alleen als eslint-fout boven water.
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent')
  const [discountValue, setDiscountValue] = useState('')

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Profile
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (p) setProfile(p)
      // Alleen voor een FACTUUR: een offerte krijgt geen nummer uit deze reeks, en een creditnota
      // trekt uit haar eigen teller. Een nummer tonen dat niet bij dit document hoort is erger dan
      // geen nummer tonen.
      if (invoiceType === 'factuur') {
        try {
          const nr = await fetch('/api/invoice/numbering')
          if (nr.ok) {
            const nj = await nr.json()
            if (typeof nj?.next === 'string' && nj.next) setNextNumber(nj.next)
          }
        } catch { /* een vooruitblik die niet laadt is geen fout op dit scherm */ }
      }

      // [FACTUUR-A] Default Vervaldatum = Factuurdatum + 30 (default term),
      // computed timezone-proof via addDaysISO.
      setDueDate(addDaysISO(today, DEFAULT_TERMIJN))

      // [FACTUUR-A] No browser-side number anymore — numbering is fully
      // server-side (atomic, legal). The UI shows "Concept" until the send
      // route mints the definitive number. Pro forma no longer shows a PF-
      // preview here; it is minted on conversion like everything else.
      setInvoiceNumber('') // empty = "Concept" in UI

      // Clients autocomplete
      const { data: cl } = await supabase
        .from('clients').select('*').eq('user_id', user.id).order('name')
      if (cl) setClients(cl)
      // [BESTE] Arrived from the customer card (?client_id=): that customer's agreed term applies
      // here too, not only when picked from the dropdown.
      // Written out rather than calling applyClientTerm: that function is declared below this
      // effect, and the compiler refuses an effect that reaches forward ([TAAL] note in KlantenClient).
      const preLinked = aiClientId && cl ? (cl as Client[]).find((c) => c.id === aiClientId) : null
      const preTerm = preLinked?.payment_term_days
      if (preTerm != null && invoiceType !== 'offerte') {
        setBetalingstermijn(preTerm)
        if (invoiceDate) setDueDate(dueDateFromTerm(invoiceDate, preTerm))
      }

      // [BOEK-029] from_offerte: load original invoice_lines for accurate amounts
      //
      // [OFFERTE-OMZETTEN-VOLLEDIG] Deze SELECT las VIER kolommen, en de regel draagt er zes. De
      // klant heeft de offerte geaccepteerd; wat hij daarna gefactureerd krijgt, hoort hetzelfde
      // document te zijn. Wat er stilletjes afviel:
      //
      //   · unit          — "2 uur" werd "2" (C62 = stuk) in de e-factuur. Precies de fout die de
      //                     [UNIT]-regels in pickArticle en in de catalogusknop al twee keer
      //                     hebben opgelost, hier voor de derde keer langs een andere weg.
      //   · vat_treatment — de vrijstellingsvlag. Zonder haar verhuist de omzet uit de vrijgestelde
      //                     pot naar de 0%/verlegd-rubriek van de aangifte (zie schoonRegel in
      //                     /api/invoice/[id]): een geaccepteerde vrijgestelde offerte werd een
      //                     factuur die in de verkeerde rubriek belandt.
      //   · de korting    — die staat op de KOP, niet op de regels, en werd dus helemaal niet
      //                     gelezen. De klant ging akkoord met EUR 900 en kreeg EUR 1.000
      //                     gefactureerd.
      if (offerteParam) {
        // [REGEL-KORTING mee] De REGELkorting reisde hier niet mee: de select miste
        // discount_type/discount_value en de map zette ze niet, dus een regel
        // "10 × 50,00, korting 10%" (akkoord: 450) werd gefactureerd als 500. Zelfde
        // verlies-klasse als de kopkorting eronder — de klant zei ja tegen het ene bedrag
        // en kreeg het andere, op een genummerd document.
        const { data: offLines } = await supabase
          .from('invoice_lines')
          .select('description, quantity, unit_price, btw_rate, unit, vat_treatment, discount_type, discount_value')
          .eq('invoice_id', offerteParam)
        // De korting van de offerte, van de KOP. Zonder deze read gaat precies het bedrag verloren
        // waarover de klant "ja" heeft gezegd.
        const { data: offHead } = await supabase
          .from('invoices')
          .select('discount_type, discount_value, invoice_number')
          .eq('id', offerteParam)
          .maybeSingle()
        let discountTravelledAsLines = false
        if (depositPct) {
          // [AANBETALING] Not the offerte's lines: a share of them, per btw rate, after the
          // offerte's own discounts. No document discount on the deposit — it is already inside
          // the share.
          setLines(depositLines({
            lines: offLines ?? [],
            discount: parseDiscount(offHead?.discount_type, offHead?.discount_value),
            invoiceNumber: offHead?.invoice_number ?? null,
          }, depositPct).map(l => ({ ...l, unit: null })))
        } else if (offLines && offLines.length > 0) {
          const fromOfferte = offLines.map((l): InvoiceLine => ({
            description: l.description ?? '',
            quantity:    l.quantity    ?? 1,
            unit_price:  l.unit_price  ?? 0,
            btw_rate:    l.btw_rate    ?? 21,
            unit:        l.unit ?? null,
            vat_treatment: storedVatTreatment(l.vat_treatment),
            discount_type: l.discount_type === 'percent' || l.discount_type === 'amount' ? l.discount_type : null,
            // Het regelmodel houdt de korting als RUWE invoerstring (zoals het invoerveld);
            // de databasekolom is numeriek — dus hier terug naar de invoervorm.
            discount_value: l.discount_value == null ? undefined : String(l.discount_value),
          }))
          // [AANBETALING] Every ISSUED deposit on this offerte comes off as a credit line per rate.
          const deposits = await issuedDepositsOn(supabase, offerteParam)
          setSettledDeposits(deposits.numbers)
          // [AANBETALING-KORTING] With a deposit to settle, the document discount comes along as
          // credit lines, not as the header discount — see offerteDiscountLines above.
          const korting = deposits.lines.length > 0 ? offerteDiscountLines(offLines, offHead) : []
          discountTravelledAsLines = korting.length > 0
          setDiscountAsLines(discountTravelledAsLines)
          setLines([...fromOfferte, ...korting, ...deposits.lines])
        }
        if (!depositPct && !discountTravelledAsLines && (offHead?.discount_type === 'percent' || offHead?.discount_type === 'amount')) {
          setDiscountType(offHead.discount_type)
          setDiscountValue(offHead.discount_value == null ? '' : String(offHead.discount_value))
        }
        // [BOEK-031] lines loaded from DB — allow submit — May 2026
        setLinesLoading(false)
      }
    }
    load()
  }, [router, supabase])

  // [COHERENCE-CREDITNOTA] Crediting a SPECIFIC in-app invoice must go through the linked flow
  // (/api/invoice/creditnota): it copies the original's lines negatively and stores
  // original_invoice_id, so the credit↔original link holds and no SECOND credit of that invoice is
  // possible. So when we arrive with ?original=X, hand off to that invoice's detail dialog.
  // A STANDALONE creditnota (no ?original — e.g. crediting an invoice issued OUTSIDE BoekBrug, or a
  // loose correction) legitimately has original_invoice_id=null and stays here on the form; the
  // banner below steers anyone whose original IS in BoekBrug to the linked flow.
  useEffect(() => {
    if (typeParam === 'creditnota' && originalParam) {
      router.replace(`/dashboard/invoice/${originalParam}?action=credit`)
    }
  }, [typeParam, originalParam, router])

  // Close autocomplete on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ─── Client autocomplete ───────────────────────────────────────────────────

  // [SEARCH] Accent-insensitive so "café"/"cafe" match; also searches KVK.
  const clientQ = foldText(clientSearch)
  const filteredClients = clients.filter(c =>
    foldText(c.name).includes(clientQ) ||
    foldText(c.email ?? '').includes(clientQ) ||
    foldText((c as { kvk_number?: string | null }).kvk_number ?? '').includes(clientQ)
  ).slice(0, 6)

  function selectClient(c: Client) {
    setSelectedClientId(c.id)
    setClientName(c.name)
    setClientEmail(c.email ?? '')
    setClientAddress(c.address ?? '')
    setClientPostal(c.postal_code ?? '')
    setClientCity(c.city ?? '')
    setClientBtw(c.btw_number ?? '')
    setClientCountry(c.country ?? '')
    setClientSearch(c.name)
    setShowDropdown(false)
    applyClientTerm(c)
  }

  // [BESTE] "Jij krijgt 45 dagen" is agreed per customer, and every package pre-fills the due
  // date from it the moment the customer is picked. Only on a factuur — an offerte has no
  // payment term — and only when the customer HAS one; otherwise the term already chosen stays.
  function applyClientTerm(c: Client) {
    const days = c.payment_term_days
    if (days == null || invoiceType === 'offerte') return
    setBetalingstermijn(days)
    if (invoiceDate) { setDueDate(dueDateFromTerm(invoiceDate, days)); clearFieldError('dueDate') }
  }

  // [ACTING-FOR] saveNewClient() stond hier. Hij schreef de inline ingetikte klant weg met
  // user_id = de INGELOGDE mens — wat klopt zolang dat de eigenaar is, en fout is zodra een
  // verkoopmedewerker het scherm gebruikt. /api/invoice/draft maakt de klant nu aan onder de
  // EIGENAAR, met created_by als spoor, en geeft het verse id terug (draftJson.clientId) —
  // dezelfde reden als toen: de state is binnen dezelfde handler-tick nog niet bijgewerkt.
  //
  // Bewust weggehaald in plaats van laten staan: een ongebruikte browserfunctie die facturen
  // en klanten kan wegschrijven is precies het soort code dat later per ongeluk terugkomt.

  // ─── Lines ─────────────────────────────────────────────────────────────────

  function addLine() {
    setLines(prev => [...prev, { description: '', quantity: 1, unit_price: 0, btw_rate: 21 }])
  }

  function removeLine(i: number) {
    if (lines.length === 1) return
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof InvoiceLine, value: string | number | boolean) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  // [REGEL-KORTING] Aan- en uitzetten, en de waarde bijhouden. Uitzetten wist ALLEBEI de velden:
  // een achtergebleven waarde zonder soort is geen korting, maar hij zou wel meereizen naar de
  // server en daar als "half ingevulde korting" moeten worden geweigerd.
  function setLineDiscount(i: number, patch: Partial<Pick<InvoiceLine, 'discount_type' | 'discount_value'>>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  // [PRIJS-MODUS] Het prijsveld schrijft niet rechtstreeks in de regel: in incl-modus is wat er
  // staat het bedrag VOOR DE KLANT, en wat we bewaren de prijs ex-btw.
  function updateLinePrice(i: number, typed: number) {
    setLines(prev => prev.map((l, idx) =>
      idx === i ? { ...l, unit_price: priceFieldToStored(typed, l.btw_rate, priceMode) } : l))
  }

  // [PRIJS-MODUS] Een ander btw-tarief betekent per modus iets anders, en het verkeerde antwoord is
  // stil: in incl-modus zou de klantprijs veranderen terwijl het veld hetzelfde getal blijft tonen.
  //   · excl — de ingetypte prijs blijft staan, het totaal beweegt (ongewijzigd gedrag);
  //   · incl — "€ 50 all-in" blijft € 50 all-in; de marge beweegt, niet de prijs.
  function updateLineRate(i: number, newRate: number) {
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, btw_rate: newRate, vat_treatment: null, unit_price: repriceForRateChange(l.unit_price, l.btw_rate, newRate, priceMode) }
      : l))
  }

  // [VRIJGESTELD] "Vrijgesteld" is geen tarief, dus het kan geen waarde in de tarief-select zijn:
  // het is 0% BTW PLUS een vlag. Aparte functie zodat de twee altijd samen worden gezet — een
  // regel met vat_treatment 'exempt' en een tarief van 21% is een tegenspraak, en die wordt
  // verderop in de keten (resolveSaleTreatment) hoe dan ook in het nadeel van het label beslecht.
  function markLineExempt(i: number) {
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, btw_rate: 0, vat_treatment: 'exempt', unit_price: repriceForRateChange(l.unit_price, l.btw_rate, 0, priceMode) }
      : l))
  }

  // [VERLEGD-VERKOOP] Verlegd is 0% PLUS the flag, set together for the same reason as exempt.
  function markLineReverseCharged(i: number) {
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, btw_rate: 0, vat_treatment: 'reverse_charge', unit_price: repriceForRateChange(l.unit_price, l.btw_rate, 0, priceMode) }
      : l))
  }

  // ── [PRIJS-MODUS] Typ ik mijn prijzen inclusief of exclusief btw? ──────────────────────────
  // Een deel van de klanten werkt all-in ("€ 50, klaar"). Die ondernemer moest tot nu toe eerst
  // zelf € 50 / 1,21 uitrekenen en dát in de regel typen — een deling op een rekenmachine bij
  // elke factuur, en elke afronding daarvan werd een cent verschil op wat zijn klant betaalt.
  //
  // De stand raakt ALLEEN de invoer. lines[].unit_price blijft de prijs ex-btw, want dat is wat
  // invoice_lines opslaat en wat alles daarna leest (de rubriekensplitsing van de aangifte, de
  // PDF, het sluitpakket, de export naar de boekhouder). Zie src/lib/price-mode.ts.
  //
  // Onthouden in localStorage: wie all-in werkt, werkt de VOLGENDE factuur ook all-in, en die
  // keuze elke keer opnieuw moeten maken is precies het soort wrijving dat dit zou moeten
  // wegnemen. Standaard 'excl', zodat het scherm zich voor iedereen gedraagt zoals het deed.
  const [priceMode, setPriceMode] = useState<PriceMode>('excl')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('boekbrug.priceMode')
      // Zelfde uitzondering als de handoff hierboven: localStorage is een extern systeem en dit is
      // precies waar een effect voor is — de opgeslagen keuze één keer binnenhalen. De regel die
      // hier klaagt (set-state-in-effect) beschermt tegen cascade-renders, en dat is dit niet: het
      // gebeurt één keer bij het monteren en verandert verder niets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'incl' || saved === 'excl') setPriceMode(saved)
    } catch { /* private mode / storage geblokkeerd: dan gewoon de standaard */ }
  }, [])
  function choosePriceMode(mode: PriceMode) {
    setPriceMode(mode)
    try { localStorage.setItem('boekbrug.priceMode', mode) } catch { /* niet erg */ }
  }

  // [ARTIKELEN] The line-item catalog (gateway #1) — pick a saved article to fill a line
  // by code or name, or save the current line back to the catalog. Fewer clicks per line.
  const [catalog, setCatalog] = useState<Article[]>([])
  const [pickerLine, setPickerLine] = useState<number | null>(null)
  const [savedToCatalog, setSavedToCatalog] = useState<number | null>(null)
  // [ARTIKEL-CODE] De code die je later intikt om deze regel terug te halen.
  //
  // De catalogus KENT codes: matchArticles zet een exacte code bovenaan ("22" → dat artikel), en
  // het omschrijvingsveld nodigt er zelfs toe uit ("Omschrijving of code (bijv. 22)"). Maar de
  // knop hieronder stuurde altijd `code: ''`. Je kon dus wel op code ZOEKEN en nooit een code
  // TOEKENNEN — behalve door naar /dashboard/artikelen te lopen en het artikel daar te openen.
  // Voor een ondernemer die "22" intikt en niets vindt, is de functie er simpelweg niet.
  const [codeForLine, setCodeForLine] = useState<number | null>(null)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeError, setCodeError] = useState('')
  useEffect(() => {
    fetch('/api/articles').then(r => r.ok ? r.json() : null).then(j => { if (j?.articles) setCatalog(j.articles) }).catch(() => {})
  }, [])
  function pickArticle(i: number, a: Article) {
    // [UNIT] De eenheid komt mee uit de catalogus. Zonder deze regel viel hij eraf op precies
    // het moment dat een artikel een factuurregel werd — en dan stond er in de e-factuur "2 stuks"
    // waar "2 uur" hoorde te staan.
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, description: a.description, unit_price: a.unit_price, btw_rate: a.btw_rate, unit: a.unit ?? null } : l))
    setPickerLine(null)
    // Bump usage so the picker learns the owner's most-used lines. Best-effort.
    fetch(`/api/articles/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bump: true }) }).catch(() => {})
  }
  async function saveLineToCatalog(i: number, line: InvoiceLine, code: string) {
    if (!line.description.trim()) return
    setCodeError('')
    try {
      const res = await fetch('/api/articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // [UNIT] De eenheid van de REGEL, niet leeg. Deze knop schreef altijd unit: '' — dus een
        // artikel dat je hier bewaarde kwam terug zonder eenheid, en pickArticle zette hem daarna
        // op null. "2 uur" werd bij de volgende factuur weer "2" (C62 = stuk) in de e-factuur:
        // precies de fout die de [UNIT]-regel in pickArticle hierboven al een keer heeft opgelost,
        // alleen langs de andere kant van dezelfde catalogus.
        body: JSON.stringify({ description: line.description, unit_price: line.unit_price, btw_rate: line.btw_rate, code, unit: line.unit ?? '' }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok) {
        if (j?.article) setCatalog(prev => [j.article, ...prev])
        setCodeForLine(null); setCodeDraft('')
        setSavedToCatalog(i); setTimeout(() => setSavedToCatalog(cur => cur === i ? null : cur), 2000)
      } else {
        // [ARTIKEL-CODE] UNIQUE(user_id, code): een code die al bij een ander artikel hoort wordt
        // geweigerd, en de route zegt WELKE. Dat stil laten verdwijnen zou betekenen dat de
        // ondernemer denkt dat "22" nu bij deze regel hoort terwijl het bij een andere staat —
        // en dan haalt hij later de verkeerde regel binnen.
        setCodeError(failureText(res.status, j, t('nieuw.fout.catalogus')))
      }
    } catch {
      setCodeError(t('nieuw.fout.catalogus'))
    }
  }

  // [BOEK-031] AI translation per line — via API route (client-safe) — May 2026
  async function translateLine(i: number) {
    const line = lines[i]
    if (!line.description.trim()) return
    updateLine(i, 'translating', true)
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: line.description, sourceLanguage: 'auto' }),
      })
      if (res.ok) {
        const result = await res.json()
        if (result.translation) updateLine(i, 'description', result.translation)
      }
      // safe fallback — if fails, keep original
    } catch {
      // keep original
    } finally {
      updateLine(i, 'translating', false)
    }
  }

  // ─── Totals ────────────────────────────────────────────────────────────────

  // [BOEK-031] Credit: user enters positive — system saves negative
  // [KOR-FACTUUR] Eén afgeleide waarde, zodat het tariefmenu en de uitleg niet uit elkaar kunnen
  // lopen. Ontbreekt de kolom (profiel gelezen met select('*') vóór de migratie), dan is dit false
  // en gedraagt het scherm zich precies zoals voorheen.
  const korActief = !!profile?.kor_active
  // [BETAALTERMIJN-LANG] Null bij elke gewone termijn, dus er verschijnt niets waar niets hoeft.
  const langeTermijn = longPaymentTermNotice(betalingstermijn)
  const sign      = invoiceType === 'creditnota' ? -1 : 1
  // [KORTING] Dezelfde module als de server, zodat het scherm en de factuur nooit een ander bedrag
  // laten zien. Zonder korting geeft applyDiscount exact dezelfde drie getallen als hiervoor.
  const korting = parseDiscount(discountType, discountValue)
  // [REGEL-KORTING] Wat één regel waard is, korting en al. Eén functie met de server (lineNetEx),
  // want een scherm dat zijn eigen versie van deze som maakt is precies hoe een concept en de
  // verstuurde factuur een cent uit elkaar gaan lopen — zie de kop van invoice-totals.ts.
  const regelNetto = (l: InvoiceLine) => lineNetEx({
    quantity: l.quantity, unit_price: l.unit_price,
    discount_type: l.discount_type, discount_value: l.discount_value,
  })
  // [REGEL-AFRONDING] Afgerond per regel, want dát is wat er in invoice_lines.line_total komt te
  // staan en wat de klant straks in de kolom optelt. Ongerond optellen liet dit scherm EUR 395,00
  // tonen terwijl er EUR 394,99 werd verstuurd — zie de kop van draft-totals.ts.
  const kortingTotalen = applyDiscount(
    // [REGEL-KORTING] Netto per regel — dezelfde functie die de server in line_total zet, dus het
    // bedrag op dit scherm is het bedrag dat straks wordt opgeslagen en verstuurd.
    lines.map(l => ({ line_total: regelNetto(l), btw_rate: l.btw_rate })),
    sign === 1 ? korting : null,
  )
  const subtotalEx = kortingTotalen.subtotal_ex_btw
  const totalEx   = kortingTotalen.total_ex_btw
  const btwAmount = kortingTotalen.btw_amount
  const totalInc  = kortingTotalen.total_inc_btw

  // [ACTING-FOR] computeTotals() stond hier en berekende de bedragen die met de INSERT meegingen.
  // Die som woont nu op de server, in src/lib/draft-totals.ts — die op zijn beurt computeInvoiceTotals
  // aanroept, precies zoals de twee regels hierboven. De reden voor de verhuizing is niet netheid:
  // zodra een tweede mens facturen mag maken onder hetzelfde BTW-nummer, hoort de server te bepalen
  // wat er in de boeken komt, niet de pagina. De getallen hierboven zijn alleen voor wat je op het
  // scherm ziet terwijl je typt — maar ze moeten wél dezelfde getallen zijn.

  // BTW-uitsplitsing per tarief — de regels die op het scherm onder het subtotaal staan.
  //
  // [BTW-ROUND] Per tarief afgerond, en NA aftrek van de korting die aan dat tarief is toegewezen.
  // Twee dingen gingen hier mis en het is dezelfde fout: deze regels moeten OPTELLEN tot het totaal
  // eronder. Ongerond per regel opgeteld toonde dit blokje "BTW 21% € 20,9979" boven een totaal van
  // € 120,99; en zonder de korting eraf toont het de btw over een bedrag dat de klant niet betaalt.
  // Twee getallen die elkaar tegenspreken op hetzelfde kaartje, over dezelfde factuur.
  //
  // applyDiscount deelt de korting al per tarief uit (allowances) — diezelfde verdeling gebruiken
  // betekent dat dit blokje en het totaal per definitie dezelfde som zijn.
  //
  // [REGEL-AFRONDING] En over de AFGERONDE regelbedragen, dezelfde die in invoice_lines.line_total
  // belanden — zie het blok bovenaan draft-totals.ts voor wat de ruwe producten opleverden.
  const btwByRate: Record<number, number> = {}
  {
    const exByRate: Record<number, number> = {}
    lines.forEach(l => {
      const rate = l.btw_rate
      exByRate[rate] = (exByRate[rate] ?? 0) + regelNetto(l)
    })
    const aftrekPerTarief: Record<number, number> = {}
    for (const a of kortingTotalen.allowances) {
      aftrekPerTarief[a.rate] = (aftrekPerTarief[a.rate] ?? 0) + a.amount
    }
    for (const [rate, ex] of Object.entries(exByRate)) {
      const r = Number(rate)
      btwByRate[r] = round2(((ex - (aftrekPerTarief[r] ?? 0)) * r) / 100)
    }
  }

  // [COHERENCE-CREDITNOTA] The standalone credit-submit flow that lived here was
  // removed: a creditnota is now created only from its original invoice via the detail
  // page's dialog → /api/invoice/creditnota (copies lines, keeps the link). The old
  // handleCredit + the sentInvoices picker + creditReason state were never wired to any
  // control on this page (dead code), and the ?type=creditnota redirect above now sends
  // the owner to the correct place, so the whole standalone path is retired.

  // ─── Main submit ───────────────────────────────────────────────────────────

  async function handleSubmit(mode: 'draft' | 'sent') {
    // [BOEK-031] wait for lines to load from DB before submitting — May 2026
    if (linesLoading) return
    // [BOEK-031] Validate all fields at once — show red borders — May 2026
    const errs: typeof fieldErrors = {}
    let hasAnyError = false

    if (!clientName) { errs.clientName = true; hasAnyError = true }
    if (!clientEmail) { errs.clientEmail = true; hasAnyError = true }
    if (!invoiceDate) { errs.invoiceDate = true; hasAnyError = true }
    if (!dueDate) { errs.dueDate = true; hasAnyError = true }

    // [FACTUUR-A] Art. 35a sub c — customer address is mandatory on a FACTUUR and a
    // CREDITNOTA (both are legal invoices; the send route rejects issuance without it),
    // not on an offerte/pro forma. Enforce it inline here so the owner sees a red field
    // up-front instead of a late 400 from /api/invoice/send.
    if ((invoiceType === 'factuur' || invoiceType === 'creditnota') && !clientAddress.trim()) {
      errs.clientAddress = true; hasAnyError = true
    }
    // [FACTUUR-A] Leverdatum required for factuur (Art. 35a sub f)
    if (invoiceType === 'factuur' && !deliveryDate) {
      errs.deliveryDate = true; hasAnyError = true
    }
    // [FACTUUR-A] Customer BTW-id: only block when it LOOKS Dutch but is
    // malformed. Empty or clearly-foreign numbers pass (valid cases).
    if (clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw)) {
      setError(t('nieuw.fout.btwKlant'))
      return
    }
    // [ICP] A number that names another EU member state but cannot have that length is caught
    // HERE, not three months later. This one invoice decides two things at once: whether the
    // BTW may be verlegd, and whether the customer can go on the ICP-opgaaf — and a rejected
    // opgaaf counts as never filed. Blocking here costs a retype; not blocking costs a quarter.
    if (euVatSuspect) {
      setError(t('nieuw.fout.euBtwLengte', { number: clientBtw.trim() }))
      return
    }
    // [VERLEGD-VERKOOP] A verlegd line without the customer's btw-id is refused at the send door
    // (art. 35a lid 1 sub d) — asked here first, where the field is one tap away.
    if (hasReverseChargeLine(lines) && !clientBtw.trim()) {
      setError(t('nieuw.fout.verlegdZonderBtw'))
      return
    }
    // [KLANT-LAND] A 0% factuur to a business in another member state needs the customer's btw-id
    // (art. 138 BTW-richtlijn) — the send door refuses it; asked here first, where the field is one
    // tap away. Both ways out are in the sentence: the number, or Dutch btw for a consumer.
    const euNul = checkEuZeroRatedInvoice({ clientCountry, clientBtwNumber: clientBtw, invoiceType, korActive: korActief, lines })
    if (!euNul.ok) {
      setError(t('nieuw.fout.euZonderBtw', { land: countryNameNl(euNul.country) }))
      return
    }
    // [CREDITNOTA-EXTERN] A creditnota is only an invoice-equivalent when it names the invoice it
    // corrects (art. 219). The send door refuses a standalone one without the number; asked here
    // first, where the field is one tap away — on a draft too, like the address above: a draft
    // saved without it is a draft refused later, at the one irreversible button.
    const verwijzing = checkStandaloneCreditnota({ invoiceType, originalInvoiceId: null, creditedNumber })
    if (!verwijzing.ok) {
      setError(t('nieuw.fout.creditVerwijzing'))
      return
    }

    // [MIN-REGEL] A negative aantal is a CREDIT line — a return settled on this invoice instead of
    // on a separate creditnota, exactly as a wholesaler writes it. Zero is still a mistake, and the
    // price may still not go below zero (Peppol BR-27). negative-line.ts owns both rules.
    const lineErrs = lines.map(l => ({
      description: !l.description.trim(),
      unit_price: l.unit_price <= 0,
      quantity: lineSignFault(l) === 'quantity_zero',
    }))
    const hasLineError = lineErrs.some(l => l.description || l.unit_price || l.quantity)
    if (hasLineError) hasAnyError = true

    // [MIN-REGEL] Credits inside an invoice are fine while it still asks for money. Once they
    // exceed the deliveries the document gives money back, and that is a creditnota: its own number
    // series (Art. 35 Wet OB) and the other side of the aangifte. Refused here, by name, because
    // nothing downstream would notice — the totals simply go negative and everything else agrees.
    if (!hasAnyError && !staysAFactuur(lines)) {
      setError(t('nieuw.fout.creditnota'))
      return
    }

    if (hasAnyError) {
      setFieldErrors({ ...errs, lines: lineErrs })
      setError(t('nieuw.fout.velden'))
      // Scroll to first error
      setTimeout(() => {
        const firstRed = document.querySelector('[data-form] input[style*="#EA4335"], [data-form] input[style*="FFF8F7"]') as HTMLElement
        firstRed?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
      return
    }

    setFieldErrors({})
    setError('')

    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // [ACTING-FOR] Eén serverroute schrijft nu de klant, de factuurkop én de regels.
    //
    // Wat hier stond was: saveNewClient() met user_id = user.id, daarna een INSERT met
    // sender_id = user.id en de totalen die deze pagina had uitgerekend. Drie browser-
    // schrijfacties waarin de PAGINA bepaalde wie de eigenaar is en wat de bedragen zijn.
    //
    // Dat kon zolang er één mens per boekhouding was. Met een verkoopmedewerker erbij is
    // `user.id` niet de eigenaar, en twee reeksen onder één BTW-nummer zijn bij een controle
    // gaten in de nummering (Art. 35 Wet OB, forward-only — niet terug te draaien). De server
    // lost de eigenaar op, zet created_by als spoor, en rekent zelf. De som is letterlijk
    // dezelfde als computeTotals() hierboven, inclusief het niet afronden: voor een eigenaar
    // verandert er geen cent en geen veld.
    //
    // [FACTUUR-A] Nog steeds altijd als DRAFT met invoice_number = null; de send-route slaat
    // het wettelijke nummer. De browser heeft er nooit een mogen bedenken.
    // [WEIGERING] Een vorige poging is geweigerd en liet een concept achter. Dat wordt hier
    // opgeruimd en NIET hergebruikt: het formulier kan intussen zijn aangepast — dat is meestal
    // juist de reden dat er opnieuw wordt gedrukt — en versturen wat de server nog van de vorige
    // ronde weet, is precies de fout die dit scherm elders zorgvuldig vermijdt. Best-effort: lukt
    // het opruimen niet, dan blijft er één concept staan dat de eigenaar zelf kan weggooien, en
    // dat is beter dan de verzending erop te laten stuklopen.
    if (afgekeurdConcept) {
      try {
        await fetch(`/api/invoice/${afgekeurdConcept}`, { method: 'DELETE' })
      } catch { /* het concept blijft staan; de verzending gaat door */ }
      setAfgekeurdConcept(null)
    }

    const draftRes = await fetch('/api/invoice/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceType,
        invoice_date: invoiceDate,
        due_date: dueDate,
        // [FACTUUR-A] Leverdatum — only meaningful for factuur; null otherwise.
        delivery_date: invoiceType === 'factuur' ? deliveryDate : null,
        // Leeg ⇒ de route maakt de inline ingetikte klant zelf aan, onder de eigenaar. Dat
        // vervangt saveNewClient(): die schreef de klant op naam van de ingelogde mens.
        client_id: selectedClientId,
        // [AANBETALING] Tells the draft door which offerte this is a deposit on; null otherwise.
        deposit_on_offerte_id: depositPct ? offerteId : null,
        client_name: clientName,
        client_email: clientEmail,
        client_address: clientAddress,
        client_postal_code: clientPostal,
        client_city: clientCity,
        client_btw_number: clientBtw,
        client_country: normalizeCountry(clientCountry),
        client_extra_line1: clientExtra1,
        client_extra_line2: clientExtra2,
        client_extra_line3: clientExtra3,
        client_extra_line4: clientExtra4,
        // [BOEK-031] creditnota is standalone — original_invoice_id = null always — May 2026
        replaces_id: invoiceType === 'creditnota' ? null : (replacesId || null),
        // [CREDITNOTA-EXTERN] The invoice this standalone creditnota corrects, as typed.
        credited_invoice_number: invoiceType === 'creditnota' ? (creditedNumber.trim() || null) : null,
        credited_invoice_date: invoiceType === 'creditnota' ? (creditedDate || null) : null,
        // [KORTING] Ruwe invoer; de server valideert opnieuw met dezelfde parseDiscount. Het scherm
        // is de kant die je niet in de hand hebt.
        discount_type: invoiceType === 'creditnota' ? null : discountType,
        discount_value: invoiceType === 'creditnota' ? null : discountValue,
        // Het teken (credit = negatief) zet de server, op één plek — zie draft-totals.ts.
        lines: lines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          unit: l.unit ?? null,
          vat_treatment: l.vat_treatment ?? null,
          // [REGEL-KORTING] Ruwe invoer; validateDraftLines op de server keurt hem opnieuw en
          // weigert wat niet kan. Een creditnota draagt er geen — zie het scherm hieronder.
          discount_type: l.discount_type ?? null,
          discount_value: l.discount_value ?? null,
        })),
      }),
    })
    const draftJson = await draftRes.json().catch(() => ({}))
    // [WAARSCHUWING-GEHOORD] Same stop as on the offerte path above, and for the same reason: the
    // send that follows mints the legal number, and a full-price invoice cannot be un-issued.
    if (draftRes.ok && draftJson?.warning === 'discount_not_stored') {
      setError(t('nieuw.fout.kortingNietOpgeslagen'))
      setLoading(false)
      return
    }
    if (!draftRes.ok || !draftJson?.invoiceId) {
      setError(failureText(draftRes.status, draftJson, t('nieuw.fout.aanmaken')))
      setLoading(false); return
    }
    const invoice = { id: draftJson.invoiceId as string }
    if (draftJson.clientId) setSelectedClientId(draftJson.clientId)

    // [BOEK-031] Replace flow — de LINK naar de oude factuur wordt hierboven vastgelegd
    // (original_invoice_id). Wat hier stond, is weg:
    //
    //   await supabase.from('invoices').update({ status: 'archived' }).eq('id', replacesId)
    //
    // [ISSUED-STAYS] Dat was een rauwe browser-schrijfactie die de hele serverautoriteit
    // oversloeg — geen refuseArchive, geen money_settled-controle, geen bank_tx_invoices-probe,
    // geen audit-regel. Ze kon dus een VERSTUURDE, genummerde verkoopfactuur archiveren, precies
    // wat de doorlopende nummering verbiedt: zo'n factuur wordt gecorrigeerd met een creditnota,
    // niet uit de reeks gehaald. Geen enkel scherm linkt naar ?replaces= — dit was alleen te
    // bereiken door de URL zelf te typen — dus er gaat geen werkende flow verloren.
    //
    // Wordt de vervang-flow ooit echt gebouwd, dan hoort hij door /api/invoice/[id]/archive te
    // lopen, waar die grendels wél staan.

    // [BOEK-031] from_offerte flow — archiveer de originele offerte — May 2026
    // Bewust WEL een directe schrijfactie: refuseArchive weigert per definitie alles wat niet
    // 'incoming' is (regel [ISSUED-STAYS]), dus ook een offerte, en die route zou deze werkende
    // flow dus breken. Een offerte draagt geen factuurnummer en geen geld — de twee dingen die
    // die grendel beschermt — dus hier valt niets te omzeilen.
    // [AANBETALING] Not for a deposit: the offerte stays open for the final invoice.
    if (offerteId && !depositPct) {
      await supabase.from('invoices')
        .update({ status: 'archived' })
        .eq('id', offerteId)
    }

    // [FACTUUR-A] Send via the route — the ONLY place that mints the number,
    // renders the PDF and delivers the e-mail with the attachment. Awaited
    // (not fire-and-forget) so we can surface pdf_failed / email_failed and
    // route the user to recovery. A draft save skips this entirely.
    //
    // [FACTUUR-A] OFFERTE NEVER goes through the send route. An offerte is a
    // price quote, not a legal invoice: it gets NO number and does NOT become
    // a factuur here. It is saved (as pro_forma), mailed as a quote below, and
    // invoiced later through "Maak factuur aan" on the sales list — the
    // from_offerte path ([OFFERTE-GEEN-OMZETTING]). Routing it through
    // /api/invoice/send would mint a factuur number (the bug that produced
    // 007-2026 from an offerte); that route now refuses a quote outright.
    if (mode === 'sent' && invoiceType !== 'offerte') {
      try {
        const res = await fetch('/api/invoice/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: invoice.id }),
        })
        const result = await res.json().catch(() => ({}))

        if (!res.ok) {
          // Number was NOT consumed (route validates before minting) — the draft is safe. Show the
          // error and let the user fix + retry, ON THIS SCREEN. De regel eronder deed precies het
          // omgekeerde: navigeren, waardoor deze melding nooit iemand bereikte. Zie
          // `afgekeurdConcept` bij de state.
          setError(failureText(res.status, result, t('nieuw.fout.versturen')))
          setAfgekeurdConcept(invoice.id)
          setLoading(false)
          return
        }

        // Soft warnings: invoice IS legally issued, delivery needs a retry.
        // [VERSTUURD-EERLIJK] Asked of the one module — see the sibling call above.
        const bezorgFout = deliveryFailure(result)
        if (bezorgFout) {
          router.replace(`/dashboard/invoice/${invoice.id}?delivery=${bezorgFout}`)
          return
        }

        // [VERSTUURD] Alles is gelukt: nummer geslagen, PDF gemaakt, mail geaccepteerd. Pas HIER
        // mag er "verstuurd" op het scherm staan — de twee returns hierboven vangen precies de
        // gevallen waarin dat niet waar zou zijn.
        //
        // De pagina navigeert nu NIET zelf weg. Dat deed ze wel, en dat was het probleem: de enige
        // aankondiging van een onomkeerbare handeling was een scherm dat vanzelf verdween.
        const notice = invoiceSentNotice({
          invoiceNumber: result.invoice_number,
          invoiceType: result.invoice_type,
          // [OFFERTE-GEEN-OMZETTING] The send route no longer converts anything.
          converted: false,
          clientName,
          clientEmail,
          totalInc,
          replyTo: result.reply_to,
        }, taal)
        if (notice) {
          setSentInvoiceId(invoice.id)
          setSentNotice(notice)
          setLoading(false)
          return
        }
        // Geen nummer in het antwoord — dan is er niets te bevestigen en gaat het scherm door naar
        // de factuur, zoals hiervoor. Liever geen melding dan een melding die iets beweert.
      } catch {
        // Network blip after a clean insert — the draft is intact.
        setError(t('nieuw.fout.versturen'))
        setLoading(false)
        router.replace(`/dashboard/invoice/${invoice.id}`)
        return
      }
    }

    // [OFFERTE-VERSTUREN-NIEUW] GEVRAAGD: de offerte ook vanaf het opstelscherm kunnen versturen,
    // niet alleen vanaf de lijst. Zelfde deur als daar — /api/invoice/[id]/send-offerte, die geen
    // nummer kán slaan (zie de kop van die route) — dus /api/invoice/send blijft hierboven voor
    // een offerte uitgesloten, en dat blijft de [OFFERTE-VERSTUREN]-gate bewaken. Geen
    // bevestigingsdialoog, dezelfde afweging als op de lijst: er wordt geen nummer verbruikt en
    // niets is onomkeerbaar aan een aanbod. Faalt het mailen, dan STAAT het concept al — de
    // navigatie naar de detailpagina is dan het herstel, precies zoals de factuurtak hierboven.
    if (mode === 'sent' && invoiceType === 'offerte') {
      try {
        const res = await fetch(`/api/invoice/${invoice.id}/send-offerte`, { method: 'POST' })
        const result = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(failureText(res.status, result, t('nieuw.fout.versturen')))
          setLoading(false)
          router.replace(`/dashboard/invoice/${invoice.id}`)
          return
        }
        setOfferteSent({
          id: invoice.id,
          message: typeof result?.message === 'string' ? result.message : '',
        })
        setLoading(false)
        return
      } catch {
        setError(t('nieuw.fout.versturen'))
        setLoading(false)
        router.replace(`/dashboard/invoice/${invoice.id}`)
        return
      }
    }

    // [BOEK-031] replace naar detail pagina — Navigation Strategy — May 2026
    router.replace(`/dashboard/invoice/${invoice.id}`)
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  const cfg = TYPE_CONFIG[invoiceType]

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', position: 'relative' }}>
      {/* [SUBNAV] Back + title (Nieuwe factuur/offerte/Creditnota) + the offerte
          "Omzetten naar factuur" action now come from the shared sub-page header
          (registered via useSubPageHeader above). */}

      <div data-form style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 'calc(160px + var(--bottom-nav-h) + env(safe-area-inset-bottom))' }}>

        {/* [FUNNEL-OVERDRACHT] De factuur die iemand op /factuur-maken maakte vóórdat hij een
            account had. Die pagina beloofde "bewaar je facturen" en leverde tot nu toe een leeg
            formulier op — alles opnieuw tikken, precies bij het besluit om te blijven.

            Dit is een VRAAG, geen automatische invulling. Het bedrijfsblok mag stil worden
            voorgevuld in de onboarding (eigen gegevens, herkenning), maar een compleet ingevulde
            factuur die vanzelf verschijnt is iets anders: dan weet je niet meer wat van jou is
            en wat het systeem verzon. Eén klik ervoor, één klik ertegen, en in beide gevallen is
            de overdracht daarna weg zodat hij nooit een tweede keer opduikt. */}
        {handoff && (
          <div style={{ backgroundColor: '#E6F4EA', border: '1px solid #137333', borderRadius: 16, padding: 16 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#137333', margin: '0 0 4px' }}>
              {t('nieuw.banner.gevonden')}
            </p>
            <p style={{ fontSize: 14, color: '#137333', margin: '0 0 12px', lineHeight: 1.5 }}>
              {describeHandoff(handoff)}. {t('nieuw.banner.overnemenVraag')}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const c = handoff.client
                  if (c.client_name.trim()) {
                    setClientName(c.client_name)
                    setClientSearch(c.client_name)
                    // Bewust GEEN selectedClientId: deze klant bestaat nog niet in het
                    // klantenbestand. De bestaande opslaglogica maakt hem aan; een verzonnen
                    // koppeling zou naar een record wijzen dat er niet is.
                    setSelectedClientId(null)
                  }
                  if (c.client_email.trim()) setClientEmail(c.client_email)
                  if (c.client_address.trim()) setClientAddress(c.client_address)
                  if (c.client_postal_code.trim()) setClientPostal(c.client_postal_code)
                  if (c.client_city.trim()) setClientCity(c.client_city)
                  if (c.client_btw_number.trim()) setClientBtw(c.client_btw_number)
                  const regels = handoff.lines.filter(isMeaningfulLine)
                  if (regels.length) {
                    setLines(regels.map((l) => ({
                      description: l.description,
                      quantity: l.quantity || 1,
                      unit_price: l.unit_price,
                      btw_rate: l.btw_rate,
                    })))
                  }
                  clearHandoff(localStorage)
                  setHandoff(null)
                }}
                style={{ padding: '10px 16px', borderRadius: 9999, border: 'none', backgroundColor: '#137333', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                {t('nieuw.banner.overnemen')}
              </button>
              <button
                onClick={() => { clearHandoff(localStorage); setHandoff(null) }}
                style={{ padding: '10px 16px', borderRadius: 9999, border: '1px solid #137333', backgroundColor: 'transparent', color: '#137333', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                {t('nieuw.banner.opnieuw')}
              </button>
            </div>
          </div>
        )}

        {/* [DS] Segmented Button — Material You, één geheel */}
        <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 12px' }}>{t('nieuw.type')}</p>
          <div style={{ display: 'flex', borderRadius: 9999, border: '1px solid #E0E0E0', overflow: 'hidden', backgroundColor: '#F1F3F4' }}>
            {/* [COHERENCE-CREDITNOTA] 'Credit' is selectable again as a STANDALONE creditnota
                (own CR- number, negative amounts, −omzet) — for crediting an invoice issued
                OUTSIDE BoekBrug or a loose correction. Crediting an in-app invoice still goes
                through that invoice's own linked flow (kept the link + blocks a double credit);
                the banner below steers the owner there when the original is in BoekBrug. */}
            {/* [TAAL] De parameter heette `t` en schaduwde daarmee de vertaler die nu in dit
                bestand staat. Binnen deze callback zou `t('...')` dan een InvoiceType aanroepen —
                tsc vangt dat, maar alleen als er toevallig een aanroep in staat. Hernoemd. */}
            {(Object.keys(TYPE_CONFIG) as InvoiceType[]).map((soort, idx, arr) => {
              const c = TYPE_CONFIG[soort]
              const active = invoiceType === soort
              return (
                <button key={soort} onClick={() => setInvoiceType(soort)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    border: 'none',
                    borderInlineStart: idx > 0 ? '1px solid #E0E0E0' : 'none',
                    backgroundColor: active ? c.activeBg : 'transparent',
                    color: active ? c.activeColor : '#5F6368',
                    fontWeight: active ? 600 : 400,
                    fontSize: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
                    // [DS] pill radius alleen op uiteinden
                    borderRadius: idx === 0 ? '9999px 0 0 9999px' : idx === arr.length - 1 ? '0 9999px 9999px 0' : 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {active && <span style={{ fontSize: 14 }}>✓</span>}
                  {t(c.label)}
                </button>
              )
            })}
          </div>
        </div>


        {/* [DS] Credit banner — border-left 4px style */}
        {invoiceType === 'creditnota' && (
          <div style={{ backgroundColor: '#F9DEDC', borderInlineStart: '4px solid #EA4335', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, color: '#B3261E', flexShrink: 0 }}>↩</span>
            <div style={{ margin: 0 }}>
              <p style={{ fontSize: 13, color: '#B3261E', margin: 0, lineHeight: 1.5 }}>
                <strong>{t('nieuw.type.creditnota')}</strong> — {t('nieuw.credit.uitleg')}
              </p>
              {/* [COHERENCE-CREDITNOTA] Steer an in-app credit to the linked flow so the
                  credit↔origineel koppeling behouden blijft en er geen tweede credit ontstaat. */}
              <p style={{ fontSize: 12, color: '#B3261E', margin: '6px 0 0', lineHeight: 1.5, opacity: 0.9 }}>
                {t('nieuw.credit.linkVoor')}{' '}
                <Link href="/dashboard/facturen" style={{ color: '#1967D2', textDecoration: 'underline', fontWeight: 600 }}>{t('nieuw.credit.linkTekst')}</Link>
                {' '}{t('nieuw.credit.linkNa')}
              </p>
              {/* [CREDITNOTA-EXTERN] The invoice this creditnota corrects — named, or the document
                  is not a creditnota at all (art. 219). Printed on the PDF, carried in the e-factuur. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <OutlinedInput value={creditedNumber} onChange={e => setCreditedNumber(e.target.value)} placeholder="2026-0123" label={t('nieuw.credit.verwijzingNummer')} focusColor={cfg.focusColor} required />
                <DateField value={creditedDate} label={t('nieuw.credit.verwijzingDatum')} focusColor={cfg.focusColor} onChange={iso => setCreditedDate(iso)} />
              </div>
              <p style={{ fontSize: 12, color: '#B3261E', margin: '6px 0 0', lineHeight: 1.5, opacity: 0.9 }}>{t('nieuw.credit.verwijzingHint')}</p>
            </div>
          </div>
        )}

        <>
            {replacesNumber && (
              <div style={{ backgroundColor: '#E8F0FE', borderInlineStart: '4px solid #1A73E8', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#1967D2', flexShrink: 0 }}>🔄</span>
                <p style={{ fontSize: 13, color: '#1967D2', margin: 0 }}>
                  <strong>{t('nieuw.banner.vervangend')}</strong> {t('nieuw.banner.vervangendUitleg', { number: replacesNumber })}
                </p>
              </div>
            )}

            {/* [BOEK-031] from_offerte banner — May 2026 */}
            {offerteId && !replacesNumber && (
              <div style={{ backgroundColor: '#E6F4EA', borderInlineStart: '4px solid #34A853', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#137333', flexShrink: 0 }}>📄</span>
                <p style={{ fontSize: 13, color: '#137333', margin: 0 }}>
                  {depositPct ? (
                    <><strong>{t('nieuw.banner.aanbetaling', { pct: depositPct })}</strong> — {t('nieuw.banner.aanbetalingUitleg')}</>
                  ) : (
                    <><strong>{t('nieuw.banner.vanOfferte')}</strong> — {t('nieuw.banner.vanOfferteUitleg')}
                    {settledDeposits.length > 0 && <> · {t('nieuw.banner.aanbetalingVerrekend', { numbers: settledDeposits.join(', ') })}</>}{discountAsLines && <> · {t('nieuw.banner.kortingAlsRegel')}</>}</>
                  )}
                </p>
              </div>
            )}

            {invoiceType === 'offerte' && (
              <div style={{ backgroundColor: '#FEF7E0', borderInlineStart: '4px solid #FBBC04', borderRadius: '0 12px 12px 0', padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#EA8600', flexShrink: 0 }}>📋</span>
                <p style={{ fontSize: 13, color: '#EA8600', margin: 0 }}>
                  <strong>{t('nieuw.type.offerte')}</strong> — {t('nieuw.banner.offerteUitleg')}
                </p>
              </div>
            )}

            {/* [DS] Van card */}
            {profile && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 8px' }}>{t('nieuw.klant.van')}</p>
                <div style={{ borderTop: '0.5px solid #E0E0E0', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{profile.company_name || profile.full_name}</p>
                  {profile.address && <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>{profile.address}</p>}
                  {(profile.postal_code || profile.city) && <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>{[profile.postal_code, profile.city].filter(Boolean).join(' ')}</p>}
                  <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
                    {profile.kvk_number && <p style={{ fontSize: 12, color: '#70757a', margin: 0 }}>KVK: {profile.kvk_number}</p>}
                    {profile.btw_number && <p style={{ fontSize: 12, color: '#70757a', margin: 0 }}>BTW: {profile.btw_number}</p>}
                  </div>
                  {/* [FACTUUR-A] Non-blocking legal-completeness warning on the
                      sender's own data — a malformed BTW-id or missing KVK
                      silently lands on every legal invoice otherwise. Links to
                      settings; never blocks the form. */}
                  {(invoiceType === 'factuur' || invoiceType === 'creditnota') && (() => {
                    const missing: string[] = []
                    if (!profile.address || !profile.kvk_number) missing.push(t('nieuw.gegevens.adresKvk'))
                    if (!profile.btw_number) missing.push(t('nieuw.gegevens.btwNummer'))
                    else if (looksLikeDutchBtw(profile.btw_number) && !isValidDutchBtw(profile.btw_number)) {
                      missing.push(t('nieuw.gegevens.btwGeldig'))
                    }
                    if (missing.length === 0) return null
                    return (
                      <div style={{ marginTop: 10, backgroundColor: '#FEF7E0', borderInlineStart: '3px solid #FBBC04', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
                        <p style={{ fontSize: 12, color: '#EA8600', margin: 0, lineHeight: 1.5 }}>
                          {t('nieuw.gegevens.missen', { list: missing.join(', ') })}{' '}
                          <Link href="/dashboard/settings" style={{ color: '#1967D2', textDecoration: 'underline' }}>{t('nieuw.catalogus.aanvullen')}</Link>
                        </p>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* [DS] Aan card */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{t('nieuw.klant.aan')}</p>
              <div ref={autocompleteRef} style={{ position: 'relative' }}>
                <OutlinedInput value={clientSearch} onChange={e => { setClientSearch(e.target.value); setClientName(e.target.value); setSelectedClientId(null); setShowDropdown(true); clearFieldError('clientName') }} onFocus={() => setShowDropdown(true)} placeholder={t('nieuw.klant.zoek')} focusColor={cfg.focusColor} label={t('nieuw.klant.bedrijf')} required hasError={!!fieldErrors.clientName} />
                {showDropdown && filteredClients.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, backgroundColor: 'white', border: '1px solid #E0E0E0', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20, overflow: 'hidden' }}>
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => selectClient(c)} style={{ width: '100%', textAlign: 'start', padding: '10px 16px', border: 'none', borderBottom: '1px solid #F1F3F4', backgroundColor: 'white', cursor: 'pointer', display: 'block' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}>
                        <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{c.name}</p>
                        {c.email && <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{c.email}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* [KLANT-EXTRA] Direct onder de naam, want dat is ook waar ze op het document
                  terechtkomen. Optioneel: leeg laten levert precies de factuur op die dit scherm
                  altijd al maakte. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <OutlinedInput value={clientExtra1} onChange={e => setClientExtra1(e.target.value)} placeholder="t.a.v. mevrouw Jansen" label={t('nieuw.klant.extra1')} focusColor={cfg.focusColor} maxLength={MAX_EXTRA_LINE_LENGTH} />
                <OutlinedInput value={clientExtra2} onChange={e => setClientExtra2(e.target.value)} placeholder={t('nieuw.klant.extraHint')} label={t('nieuw.klant.extra2')} focusColor={cfg.focusColor} maxLength={MAX_EXTRA_LINE_LENGTH} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <OutlinedInput value={clientExtra3} onChange={e => setClientExtra3(e.target.value)} placeholder={t('nieuw.betaalkenmerk.hint')} label={t('nieuw.klant.extra3')} focusColor={cfg.focusColor} maxLength={MAX_EXTRA_LINE_LENGTH} />
                <OutlinedInput value={clientExtra4} onChange={e => setClientExtra4(e.target.value)} placeholder={t('nieuw.klant.extraHint')} label={t('nieuw.klant.extra4')} focusColor={cfg.focusColor} maxLength={MAX_EXTRA_LINE_LENGTH} />
              </div>
              <p style={{ fontSize: 11, color: '#5F6368', margin: '-4px 0 0', lineHeight: 1.45 }}>
                {t('nieuw.klant.extraUitleg')}
              </p>
              <OutlinedInput value={clientEmail} onChange={e => { setClientEmail(e.target.value); clearFieldError('clientEmail') }} placeholder="klant@bedrijf.nl" label={t('nieuw.klant.email')} type="email" required focusColor={cfg.focusColor} hasError={!!fieldErrors.clientEmail} />
              <OutlinedInput value={clientAddress} onChange={e => { setClientAddress(e.target.value); clearFieldError('clientAddress') }} placeholder="Straatnaam 1" label={t('nieuw.klant.adres')} focusColor={cfg.focusColor} required={invoiceType === 'factuur' || invoiceType === 'creditnota'} hasError={!!fieldErrors.clientAddress} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <OutlinedInput value={clientPostal} onChange={e => setClientPostal(e.target.value)} placeholder="1234 AB" label={t('nieuw.klant.postcode')} focusColor={cfg.focusColor} />
                <OutlinedInput value={clientCity} onChange={e => setClientCity(e.target.value)} placeholder="Amsterdam" label={t('nieuw.klant.stad')} focusColor={cfg.focusColor} />
              </div>
              {/* [ADRES-ECHT] Het BAG kent het adres; de eigenaar beslist of hij het overneemt.
                  Het huisnummer komt uit het adresveld ("Tilburgseweg 42"), want dat is hoe dit
                  formulier het al vraagt — splitHouseNumber haalt er het nummer uit. */}
              <AdresZoeker
                postcode={clientPostal}
                huisnummer={clientAddress.replace(/^\D+/, '')}
                straat={clientAddress.replace(/\s*\d.*$/, '')}
                plaats={clientCity}
                onOvernemen={(adres) => {
                  setClientAddress(`${adres.street} ${adres.houseNumber}${adres.addition ? `-${adres.addition}` : ''}`)
                  setClientPostal(`${adres.postcode.slice(0, 4)} ${adres.postcode.slice(4)}`)
                  setClientCity(adres.city)
                  clearFieldError('clientAddress')
                }}
              />
              {/* [KLANT-LAND] Two letters; empty reads as the Netherlands. It decides the 0%-guard at the
                  send door and the country line under the city on a foreign customer's invoice. */}
              <div style={{ marginTop: 8, maxWidth: 200 }}>
                <OutlinedInput value={clientCountry} onChange={e => setClientCountry(e.target.value.toUpperCase())} placeholder="NL" label={t('nieuw.klant.land')} focusColor={cfg.focusColor} />
              </div>
              <div>
                <OutlinedInput value={clientBtw} onChange={e => setClientBtw(e.target.value)} placeholder="NL123456789B01" label={t('nieuw.klant.btw')} focusColor={cfg.focusColor} hasError={(!!clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw)) || euVatSuspect} />
                {clientBtw.trim() && looksLikeDutchBtw(clientBtw) && !isValidDutchBtw(clientBtw) && (
                  <p style={{ fontSize: 11, color: M3.error, margin: '4px 0 0' }}>{t('nieuw.klant.btwFormaat')}</p>
                )}
                {/* [ICP] Said while the number is still on screen and still fixable. */}
                {euVatSuspect && (
                  <p style={{ fontSize: 11, color: M3.error, margin: '4px 0 0' }}>
                    {t('nieuw.klant.euBtwLengte')}
                  </p>
                )}
                {euVatCustomer && (
                  <p style={{ fontSize: 11, color: '#5F6368', margin: '4px 0 0', lineHeight: 1.45 }}>
                    {t('nieuw.klant.euBtwInfo')}
                  </p>
                )}
              </div>
            </div>

            {/* [NUMMER-VOORUITBLIK] Welk nummer deze factuur straks krijgt, om te WETEN.
                Bewust een rustige regel en geen veld: het nummer is niet te kiezen — het komt bij
                verzending uit de doorlopende reeks (art. 35 Wet OB), atomair, zodat er geen gat in
                valt. De tweede zin zegt dat het een verwachting is, want verstuurt iemand anders
                er intussen één, dan is het een ander nummer. Een getal zonder die zin zou lezen
                als een toezegging. */}
            {invoiceType === 'factuur' && nextNumber && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'start' }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{t('nieuw.nummer.volgende')}</p>
                  <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{t('nieuw.nummer.verwacht')}</p>
                </div>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#202124', fontFamily: "'Roboto Mono', monospace", textAlign: 'end' }}>
                  {nextNumber}
                </span>
              </div>
            )}

            {/* [DS] Datums card */}
            {/* [FACTUUR-A] Clean native date fields + Dutch DD-MM-YYYY caption
                under each (DateField). Vervaldatum gets quick payment-term chips. */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{t('nieuw.datums')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <DateField
                  value={invoiceDate}
                  label={invoiceType === 'offerte' ? t('nieuw.datum.offerte') : t('nieuw.datum.factuur')}
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.invoiceDate}
                  onChange={iso => {
                    setInvoiceDate(iso)
                    clearFieldError('invoiceDate')
                    // [FACTUUR-A] If a payment term is active, recompute the
                    // Vervaldatum from the new factuurdatum.
                    if (betalingstermijn !== null && iso) {
                      setDueDate(addDaysISO(iso, betalingstermijn))
                      clearFieldError('dueDate')
                    }
                    // Keep an untouched leverdatum in sync.
                    if (!deliveryTouched) { setDeliveryDate(iso); clearFieldError('deliveryDate') }
                  }}
                />
                <DateField
                  value={dueDate}
                  label={invoiceType === 'offerte' ? t('nieuw.datum.geldig') : t('nieuw.datum.verval')}
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.dueDate}
                  min={invoiceDate || undefined}
                  onChange={iso => {
                    // Manual edit clears the active term chip.
                    setBetalingstermijn(null)
                    setDueDate(iso)
                    clearFieldError('dueDate')
                  }}
                />
              </div>

              {/* [FACTUUR-A] Payment-term chips — only for factuur/creditnota
                  (an offerte uses "Geldig tot", not a payment term). */}
              {invoiceType !== 'offerte' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#70757a' }}>{t('nieuw.termijn.kort')}</span>
                  {BETALINGSTERMIJNEN.map(days => {
                    const active = betalingstermijn === days
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => {
                          setBetalingstermijn(days)
                          if (invoiceDate) { setDueDate(addDaysISO(invoiceDate, days)); clearFieldError('dueDate') }
                        }}
                        style={{
                          fontSize: 13, fontWeight: 500,
                          padding: '6px 14px', borderRadius: 9999,
                          border: active ? `1px solid ${cfg.activeBorder}` : '1px solid #E0E0E0',
                          backgroundColor: active ? cfg.activeBg : 'white',
                          color: active ? cfg.activeColor : '#5F6368',
                          cursor: 'pointer', transition: 'all 0.1s ease',
                        }}
                      >
                        {t('nieuw.termijn.aantalDagen', { days })}
                      </button>
                    )
                  })}
                  {/* [BETAALTERMIJN] Elk heel getal, niet alleen 14/30/60. Een termijn spreek je
                      per klant af — "jij krijgt 45 dagen" — en drie vaste chips maakten dat
                      onmogelijk zonder de vervaldatum uit te rekenen en met de hand in te tikken.
                      De bovengrens in payment-term.ts is een tikfoutgrens (300 in plaats van 30 zet
                      de vervaldatum bijna een jaar vooruit en laat elke herinnering net zo lang
                      wachten), geen uitspraak over wat een ondernemer mag afspreken. */}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#70757a' }}>{t('nieuw.termijn.of')}</span>
                    <input
                      type="number"
                      min={0}
                      max={MAX_PAYMENT_TERM_DAYS}
                      inputMode="numeric"
                      placeholder={t('nieuw.termijn.dagen')}
                      value={betalingstermijn ?? ''}
                      onChange={e => {
                        const days = parsePaymentTerm(e.target.value)
                        if (days == null) { setBetalingstermijn(null); return }
                        setBetalingstermijn(days)
                        if (invoiceDate) { setDueDate(dueDateFromTerm(invoiceDate, days)); clearFieldError('dueDate') }
                      }}
                      style={{ width: 78, minHeight: 36, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 10px', fontSize: 14, outline: 'none' }}
                      aria-label={t('nieuw.termijn')}
                    />
                  </label>
                  {betalingstermijn === null && (
                    <span style={{ fontSize: 12, color: '#70757a', fontStyle: 'italic' }}>{t('nieuw.eenheid.aangepast')}</span>
                  )}
                </div>
              )}

              {/* [BETAALTERMIJN-LANG] Een woord, geen blokkade. Boven de 60 dagen houdt een
                  B2B-termijn alleen stand als hij uitdrukkelijk is afgesproken (art. 6:119a BW), en
                  tegenover een grote onderneming helemaal niet — maar welke situatie het is, hangt
                  af van het contract en van wie de klant is, en dat weet deze app geen van beide. */}
              {langeTermijn && (
                <p style={{
                  fontSize: 12, color: '#8a5a00', background: '#FFF8E1', border: '1px solid #FFE082',
                  borderRadius: 8, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.5,
                }}>
                  {langeTermijn}
                </p>
              )}

              {/* [FACTUUR-A] Leverdatum — Art. 35a sub f. Factuur only;
                  defaults to factuurdatum, editable. */}
              {invoiceType === 'factuur' && (
                <DateField
                  value={deliveryDate}
                  label={t('nieuw.datum.lever')}
                  required
                  focusColor={cfg.focusColor}
                  hasError={!!fieldErrors.deliveryDate}
                  onChange={iso => { setDeliveryTouched(true); setDeliveryDate(iso); clearFieldError('deliveryDate') }}
                />
              )}
              {invoiceType === 'factuur' && (
                <p style={{ fontSize: 11, color: '#70757a', margin: '-4px 0 0' }}>
                  {t('nieuw.datum.leverUitleg')}
                </p>
              )}
            </div>

            {/* [DS] Factuurregels card */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>{invoiceType === 'offerte' ? t('nieuw.regels.offerte') : t('nieuw.regels.factuur')}</p>
              <p style={{ fontSize: 12, color: '#70757a', margin: '-4px 0 0' }}>{t('nieuw.vertaal.uitleg')} <strong>{t('nieuw.vertaal')}</strong> {t('nieuw.vertaal.doel')}</p>

              {/* ── [PRIJS-MODUS] Typ je prijzen met of zonder btw? ────────────────────────────
                  Boven de regels, want het bepaalt wat elk prijsveld eronder BETEKENT. Wie all-in
                  werkt ("€ 50, klaar") hoefde tot nu toe eerst zelf € 50 / 1,21 uit te rekenen om
                  hier te kunnen typen. De keuze wordt onthouden voor de volgende factuur.
                  Wat er wordt opgeslagen verandert niet: de regel houdt de prijs ex-btw vast, en
                  dat is ook wat er op de factuur en in je aangifte komt te staan. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', backgroundColor: '#F8F9FA', borderRadius: 10, padding: '8px 10px' }}>
                <span style={{ fontSize: 12.5, color: '#5F6368', fontWeight: 500 }}>{t('nieuw.prijsmodus')}</span>
                <div role="group" aria-label={t('nieuw.prijsmodus.aria')} style={{ display: 'flex', gap: 4, backgroundColor: '#E8EAED', borderRadius: 9999, padding: 3 }}>
                  {([
                    { id: 'excl' as PriceMode, label: t('nieuw.prijsmodus.exclKnop') },
                    { id: 'incl' as PriceMode, label: t('nieuw.prijsmodus.inclKnop') },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={priceMode === opt.id}
                      onClick={() => choosePriceMode(opt.id)}
                      style={{
                        border: 'none', borderRadius: 9999, padding: '6px 14px', cursor: 'pointer',
                        fontSize: 12.5, fontWeight: 600,
                        backgroundColor: priceMode === opt.id ? 'white' : 'transparent',
                        color: priceMode === opt.id ? '#202124' : '#5F6368',
                        boxShadow: priceMode === opt.id ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: '#80868B', flex: 1, minWidth: 180 }}>
                  {priceMode === 'incl'
                    ? t('nieuw.prijsmodus.incl')
                    : t('nieuw.prijsmodus.excl')}
                </span>
              </div>

              {lines.map((line, i) => {
                const sug = pickerLine === i ? matchArticles(catalog, line.description) : []
                return (
                <div key={i} style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 24, height: 24, borderRadius: 9999, border: 'none', backgroundColor: 'transparent', color: '#70757a', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseEnter={e => (e.currentTarget.style.color = '#EA4335')} onMouseLeave={e => (e.currentTarget.style.color = '#70757a')}>×</button>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, position: 'relative' }} onFocusCapture={() => setPickerLine(i)} onBlur={() => setTimeout(() => setPickerLine(cur => (cur === i ? null : cur)), 150)}>
                      <OutlinedInput value={line.description} onChange={e => { updateLine(i, 'description', e.target.value); setPickerLine(i); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], description: false }; return { ...prev, lines: l } }) }} placeholder={t('nieuw.regel.codeHint')} label={t('nieuw.regel.omschrijving')} focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.description} />
                      {/* [ARTIKELEN] Catalog picker — fill the line from a saved article. */}
                      {sug.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', maxHeight: 220, overflowY: 'auto' }}>
                          {sug.map(a => (
                            <button key={a.id} type="button" onMouseDown={e => { e.preventDefault(); pickArticle(i, a) }} style={{ display: 'flex', width: '100%', boxSizing: 'border-box', alignItems: 'center', gap: 8, padding: '9px 12px', border: 'none', borderBottom: '1px solid #F1F3F4', background: 'transparent', cursor: 'pointer', textAlign: 'start' }}>
                              {a.code && <span style={{ fontFamily: 'Roboto Mono, monospace', fontSize: 12, fontWeight: 700, color: '#1A73E8', background: '#D3E3FD', borderRadius: 6, padding: '2px 6px' }}>{a.code}</span>}
                              <span style={{ flex: 1, fontSize: 13.5, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</span>
                              <span style={{ fontSize: 12.5, color: '#5F6368', fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>{NL_NUMBER.format(a.unit_price)} · {a.btw_rate}%</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => translateLine(i)} disabled={line.translating} style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, padding: '10px 12px', borderRadius: 9999, border: 'none', backgroundColor: line.translating ? '#F1F3F4' : cfg.activeBg, color: line.translating ? '#9AA0A6' : cfg.activeColor, cursor: line.translating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', marginBottom: 1 }}>
                      {line.translating ? '...' : t('nieuw.vertaal')}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {/* [BOEK-031] LineInput: no leading zero, comma=dot, step=1, Enter→next — May 2026 */}
                    <LineInput label={t('nieuw.regel.aantal')} value={line.quantity} min={0.01} allowNegative focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.quantity} onChange={v => { updateLine(i, 'quantity', v); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], quantity: false }; return { ...prev, lines: l } }) }} />
                    {/* [PRIJS-MODUS] Het veld toont — en accepteert — de prijs in de gekozen stand.
                        De regel bewaart altijd ex-btw; priceFieldValue/priceFieldToStored zijn de
                        enige twee plekken waar dat verschil bestaat. */}
                    <LineInput label={priceMode === 'incl' ? t('nieuw.regel.prijsIncl') : t('nieuw.regel.prijsExcl')} value={priceFieldValue(line.unit_price, line.btw_rate, priceMode, line.quantity)} min={0} focusColor={cfg.focusColor} hasError={!!fieldErrors.lines?.[i]?.unit_price} onChange={v => { updateLinePrice(i, v); setFieldErrors(prev => { const l = [...(prev.lines ?? [])]; if (l[i]) l[i] = { ...l[i], unit_price: false }; return { ...prev, lines: l } }) }} />
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#5F6368', display: 'block', marginBottom: 4 }}>BTW %</label>
                      <select value={line.vat_treatment === 'exempt' ? EXEMPT_OPTION : line.vat_treatment === 'reverse_charge' ? REVERSE_CHARGE_OPTION : line.btw_rate} onChange={e => { const v = parseFloat(e.target.value); if (v === EXEMPT_OPTION) markLineExempt(i); else if (v === REVERSE_CHARGE_OPTION) markLineReverseCharged(i); else updateLineRate(i, v) }} style={{ width: '100%', minHeight: 44, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 12px', fontSize: 16, backgroundColor: 'white', outline: 'none', boxSizing: 'border-box', appearance: 'none', cursor: 'pointer' }} onFocus={e => { e.currentTarget.style.borderColor = cfg.focusColor; e.currentTarget.style.borderWidth = '2px' }} onBlur={e => { e.currentTarget.style.borderColor = '#E0E0E0'; e.currentTarget.style.borderWidth = '1px' }}>
                        {/* [KOR-FACTUUR] Onder de KOR bestaan 21% en 9% niet als keuze. Weglaten is
                            hier beter dan achteraf afkeuren: een tarief dat je kunt kiezen en dat
                            daarna wordt geweigerd, is een val. Zie kor-invoice.ts voor wat het
                            kost als er tóch btw op komt (art. 37 Wet OB). */}
                        {!korActief && <option value={21}>21%</option>}
                        {!korActief && <option value={9}>9%</option>}
                        <option value={0}>0%</option>
                        {/* [VERLEGD-VERKOOP] Btw verlegd naar de klant (bouw, onderaanneming,
                            personeel, schoonmaak): 0% plus de vlag. Niet onder de KOR — daar is
                            de prestatie vrijgesteld en bestaat er niets te verleggen. */}
                        {!korActief && <option value={REVERSE_CHARGE_OPTION}>{t('nieuw.regel.verlegd')}</option>}
                        {/* [VRIJGESTELD] Alleen zichtbaar als de ondernemer vrijgestelde omzet
                            heeft verklaard (Instellingen). Voor iedereen anders is deze keuze
                            geen optie maar een valkuil: vrijgesteld ziet eruit als 0%, en een
                            gewone dienst die per ongeluk zo wordt geboekt verdwijnt uit de
                            aangifte én kost de aftrek op de bijbehorende kosten. */}
                        {profile?.vat_exempt_activity && <option value={EXEMPT_OPTION}>{t('nieuw.regel.vrijgesteld')}</option>}
                      </select>
                      {/* De reden staat ernaast, niet in een melding achteraf. Zonder deze zin is
                          een menu met één keuze gewoon een kapot menu. */}
                      {line.vat_treatment === 'reverse_charge' && (
                        <p style={{ fontSize: 11, color: '#5F6368', margin: '6px 0 0', lineHeight: 1.45 }}>
                          {t('nieuw.regel.verlegdHint')}
                        </p>
                      )}
                      {korActief && (
                        <p style={{ fontSize: 11, color: '#5F6368', margin: '6px 0 0', lineHeight: 1.45 }}>
                          {KOR_RATE_HINT}
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#70757a' }}>
                    {/* [ARTIKEL-CODE] Bewaren MET een code, zodat je deze regel later terughaalt
                        door "22" in het omschrijvingsveld te tikken. De code is optioneel: wie er
                        geen wil, laat het veld leeg en bewaart zoals voorheen. */}
                    {line.description.trim()
                      ? (codeForLine === i
                          ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <input
                                value={codeDraft}
                                onChange={e => { setCodeDraft(e.target.value.slice(0, 20)); setCodeError('') }}
                                placeholder={t('nieuw.regel.codeVoorbeeld')}
                                aria-label={t('nieuw.regel.artikelcode')}
                                autoFocus
                                style={{ width: 120, minHeight: 32, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 8px', fontSize: 13, outline: 'none' }}
                              />
                              <button type="button" onClick={() => void saveLineToCatalog(i, line, codeDraft)}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#1A73E8', fontWeight: 600 }}>
                                {t('nieuw.eenheid.bewaar')}
                              </button>
                              <button type="button" onClick={() => { setCodeForLine(null); setCodeDraft(''); setCodeError('') }}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: '#70757a' }}>
                                {t('nieuw.eenheid.annuleer')}
                              </button>
                              {codeError && <span style={{ fontSize: 11.5, color: '#B3261E' }}>{codeError}</span>}
                            </span>
                          )
                          : <button type="button" onClick={() => { setCodeForLine(i); setCodeDraft(''); setCodeError('') }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: savedToCatalog === i ? '#137333' : '#1A73E8', fontWeight: 500 }}>{savedToCatalog === i ? `✓ ${t('nieuw.catalogus.in')}` : `+ ${t('nieuw.catalogus.bewaar')}`}</button>)
                      : <span>{priceMode === 'incl' ? t('nieuw.regel.totaalIncl') : t('nieuw.regel.totaalExcl')}</span>}
                    {/* [PRIJS-MODUS] Het regeltotaal in dezelfde stand als het veld erboven: een rij
                        die "10,00" in het prijsveld toont en "8,26" als totaal bij aantal 1, leest
                        als een rekenfout. In incl-modus staat de ex-prijs er klein onder, want dát
                        is wat er straks op de factuur en in de aangifte komt te staan. */}
                    {/* [REGEL-KORTING] Het NETTO regeltotaal — met de korting van deze regel er al
                        af, want dat is het bedrag dat op de factuur komt en dat de klant optelt. */}
                    <span style={{ fontWeight: 600, color: '#202124', fontFamily: 'Roboto Mono, monospace' }}>
                      {NL_NUMBER.format(toDisplayCents(
                        priceMode === 'incl'
                          ? regelNetto(line) * (1 + line.btw_rate / 100)
                          : regelNetto(line),
                      ))}
                      {priceMode === 'incl' && (
                        <span style={{ fontWeight: 400, color: '#80868B', fontSize: 11.5, marginInlineStart: 6 }}>
                          {t('nieuw.regel.exclTussen', { amount: NL_NUMBER.format(toDisplayCents(regelNetto(line))) })}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* [REGEL-KORTING] De korting die bij DEZE regel hoort. Niet op een creditnota:
                      dat document is zelf al een correctie, en een korting op een terugbetaling is
                      rekenwerk dat niemand met het blote oog kan controleren — dezelfde regel als
                      bij de documentkorting hieronder. */}
                  {invoiceType !== ('creditnota' as InvoiceType) && (
                    line.discount_type
                      ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid #F1F3F4' }}>
                          <span style={{ fontSize: 13, color: '#5F6368' }}>{t('nieuw.regelKorting')}</span>
                          <div style={{ display: 'inline-flex', borderRadius: 9999, border: '1px solid #E0E0E0', overflow: 'hidden' }}>
                            {(['percent', 'amount'] as const).map(soort => (
                              <button
                                key={soort}
                                type="button"
                                onClick={() => setLineDiscount(i, { discount_type: soort })}
                                style={{
                                  fontSize: 12.5, fontWeight: 500, padding: '5px 11px', border: 'none', cursor: 'pointer',
                                  backgroundColor: line.discount_type === soort ? cfg.activeBg : 'white',
                                  color: line.discount_type === soort ? cfg.activeColor : '#5F6368',
                                }}
                              >
                                {soort === 'percent' ? '%' : '€'}
                              </button>
                            ))}
                          </div>
                          <input
                            /* [KOMMA-INVOER] Never type="number": Chromium DROPS the comma, so a
                               12,5% discount arrived as "125" — over MAX_PERCENT, hence no discount
                               at all — and a EUR 2,50 one arrived as 250 and was capped at the whole
                               invoice. parseDiscount already reads a comma; the widget never let one
                               through. No draft needed here: this field's value IS the raw string. */
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            placeholder={line.discount_type === 'percent' ? t('nieuw.korting.hintPercentage') : t('nieuw.korting.hintBedrag')}
                            value={line.discount_value ?? ''}
                            onChange={e => setLineDiscount(i, { discount_value: e.target.value })}
                            aria-label={line.discount_type === 'percent' ? t('nieuw.korting.percentage') : t('nieuw.korting.bedrag')}
                            style={{ width: 96, minHeight: 36, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 10px', fontSize: 14, outline: 'none' }}
                          />
                          {/* Het BEDRAG dat er echt af gaat — een percentage zegt niets tot je ziet
                              hoeveel het is, en bij een korting groter dan de regel is dat de regel zelf. */}
                          {parseDiscount(line.discount_type, line.discount_value) && (
                            <span style={{ fontSize: 13, color: '#137333', fontFamily: 'Roboto Mono, monospace' }}>
                              −{NL_NUMBER.format(toDisplayCents(round2(line.quantity * line.unit_price) - regelNetto(line)))}
                            </span>
                          )}
                          {(line.discount_value ?? '').trim() !== '' && !parseDiscount(line.discount_type, line.discount_value) && (
                            <span style={{ fontSize: 12, color: '#B3261E' }}>
                              {line.discount_type === 'percent' ? t('nieuw.korting.foutPercentage') : t('nieuw.korting.foutBedrag')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setLineDiscount(i, { discount_type: null, discount_value: '' })}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#70757a' }}
                          >
                            {t('nieuw.regelKorting.weg')}
                          </button>
                        </div>
                      )
                      : (
                        <button
                          type="button"
                          onClick={() => setLineDiscount(i, { discount_type: 'percent', discount_value: '' })}
                          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '8px 0 0', cursor: 'pointer', fontSize: 12.5, color: '#1A73E8', fontWeight: 500 }}
                        >
                          + {t('nieuw.regelKorting')}
                        </button>
                      )
                  )}
                </div>
              )})}

              <button onClick={addLine} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 500, color: '#1A73E8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                + {t('nieuw.regel.toevoegen')}
              </button>
            </div>

            {/* [KORTING] Op de factuur én op de offerte. Niet op een creditnota: dat document is
                al een correctie, en "korting op een terugbetaling" is arithmetiek die niemand met
                het blote oog kan controleren. */}
            {invoiceType !== ('creditnota' as InvoiceType) && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#202124' }}>{t('nieuw.korting')}</span>
                <div style={{ display: 'inline-flex', borderRadius: 9999, border: '1px solid #E0E0E0', overflow: 'hidden' }}>
                  {(['percent', 'amount'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDiscountType(t)}
                      style={{
                        fontSize: 13, fontWeight: 500, padding: '7px 14px', border: 'none', cursor: 'pointer',
                        backgroundColor: discountType === t ? cfg.activeBg : 'white',
                        color: discountType === t ? cfg.activeColor : '#5F6368',
                      }}
                    >
                      {t === 'percent' ? '%' : '€'}
                    </button>
                  ))}
                </div>
                <input
                  /* [KOMMA-INVOER] See the per-line discount above — the number widget ate the comma. */
                  type="text"
                  inputMode="decimal"
                  placeholder={discountType === 'percent' ? t('nieuw.korting.hintPercentage') : t('nieuw.korting.hintBedrag')}
                  value={discountValue}
                  onChange={e => setDiscountValue(e.target.value)}
                  aria-label={discountType === 'percent' ? t('nieuw.korting.percentage') : t('nieuw.korting.bedrag')}
                  style={{ width: 120, minHeight: 40, border: '1px solid #E0E0E0', borderRadius: 8, padding: '0 10px', fontSize: 15, outline: 'none' }}
                />
                {discountValue.trim() !== '' && !korting && (
                  <span style={{ fontSize: 12.5, color: '#B3261E' }}>
                    {discountType === 'percent' ? t('nieuw.korting.foutPercentage') : t('nieuw.korting.foutBedrag')}
                  </span>
                )}
              </div>
            )}

            {/* [DS] Totalen */}
            <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ maxWidth: 280, marginInlineStart: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                  <span>{t('nieuw.totaal.subtotaal')}</span>
                  <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * subtotalEx)}</span>
                </div>
                {/* [KORTING] Het BEDRAG dat er echt af gaat, niet het percentage dat is ingetikt.
                    Bij een korting groter dan de factuur is dat het factuurbedrag zelf — capped,
                    zodat een tikfout geen negatief totaal maakt. */}
                {kortingTotalen.discount_ex_btw > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#137333' }}>
                    <span>{discountLabel(korting)}</span>
                    <span style={{ fontFamily: 'Roboto Mono, monospace' }}>−{NL_NUMBER.format(kortingTotalen.discount_ex_btw)}</span>
                  </div>
                )}
                {kortingTotalen.discount_ex_btw > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                    <span>{t('nieuw.totaal.naKorting')}</span>
                    <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * totalEx)}</span>
                  </div>
                )}
                {Object.entries(btwByRate).filter(([, v]) => v > 0).map(([rate, val]) => (
                  <div key={rate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#5F6368' }}>
                    <span>BTW {rate}%</span>
                    <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * val)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: sign === -1 ? '#B3261E' : '#202124', paddingTop: 8, borderTop: '1px solid #F1F3F4' }}>
                  <span>{t('nieuw.totaal.incl')}</span>
                  <span style={{ fontFamily: 'Roboto Mono, monospace' }}>{NL_NUMBER.format(sign * totalInc)}</span>
                </div>
              </div>
            </div>

            {/* [DS] Betalingsinformatie */}
            {profile?.iban && invoiceType !== ('creditnota' as InvoiceType) && (
              <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 12px' }}>{t('nieuw.betaalinfo')}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {([[t('nieuw.betaal.opNaamVan'), profile.company_name || profile.full_name], ['IBAN', profile.iban], [t('nieuw.datum.verval'), new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam' }).format(new Date(dueDate || today))], ...(invoiceNumber ? [[t('nieuw.betaalkenmerk'), invoiceNumber]] : [])] as [string,string][]).map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.8 }}>{label}</span>
                      <span style={{ fontSize: label === 'IBAN' ? 13 : 14, fontWeight: 500, color: '#202124', fontFamily: label === 'IBAN' ? 'Roboto Mono, monospace' : 'inherit', maxWidth: '55%', textAlign: 'end' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ backgroundColor: '#F9DEDC', borderInlineStart: '4px solid #EA4335', borderRadius: '0 12px 12px 0', padding: '12px 16px' }}>
                <p style={{ fontSize: 14, color: '#B3261E', margin: 0 }}>{error}</p>
              </div>
            )}

            {/* [DS] Fixed bottom bar — safe area — full-width pill — 48px min */}
            <div style={{ position: 'fixed', bottom: 0, insetInlineStart: 'var(--rail-w)', insetInlineEnd: 0, backgroundColor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '12px 16px', paddingBottom: 'calc(12px + var(--bottom-nav-h) + env(safe-area-inset-bottom))', zIndex: 10 }}>
              {/* [BAR-ALIGN] The bar centred its content at the column's OUTER
                  width while the form spends 16px of that on its gutters, so the
                  send button sat one gutter wider than every field above it. */}
              <div style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => {
                  // [FACTUUR-A] Factuur send is irreversible (number consumed
                  // + e-mail with PDF delivered) → confirm first. Offerte and
                  // creditnota keep their existing direct flow.
                  if (invoiceType === 'factuur') {
                    setShowSendConfirm(true)
                  } else {
                    handleSubmit('sent')
                  }
                }} disabled={loading || linesLoading} style={{ width: '100%', minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: loading || linesLoading ? '#9AA0A6' : cfg.primaryBtn, color: 'white', fontSize: 16, fontWeight: 600, cursor: loading || linesLoading ? 'not-allowed' : 'pointer', transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                  {linesLoading ? t('nieuw.actie.laden') : loading ? t('nieuw.actie.bezig') : invoiceType === 'factuur' ? `✉ ${t('nieuw.actie.versturen')}` : invoiceType === 'offerte' ? `✉ ${t('nieuw.actie.offerteVersturen')}` /* via send-offerte — never /api/invoice/send, see handleSubmit */ : `↩ ${t('lijst.versturen')}`}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* [OFFERTE-EEN-KNOP] Deze knop was voor een offerte verdwenen omdat hij toen
                      letterlijk hetzelfde deed als de hoofdknop (beide sloegen alleen op). Sinds
                      [OFFERTE-VERSTUREN-NIEUW] is het verschil echt, voor alle drie de soorten:
                      de hoofdknop verstuurt (factuur via /api/invoice/send, offerte via
                      send-offerte), deze bewaart alleen. Voor de offerte houdt hij zijn oude
                      naam — "Offerte opslaan" is precies wat hij doet. */}
                  <button onClick={() => handleSubmit('draft')} disabled={loading} style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: cfg.activeBg, color: cfg.activeColor, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)' }}>
                    {invoiceType === 'offerte' ? `📋 ${t('nieuw.actie.offerteOpslaan')}` : t('nieuw.actie.concept')}
                  </button>
                  {/* [PDF-VOORBEELD] Het document zien vóór het onomkeerbaar is. Alleen wanneer er
                      iets te tonen is: zonder afzendergegevens of zonder regels zou het voorbeeld
                      een lege pagina zijn, en een knop die een leeg vel oplevert is erger dan geen
                      knop. Voor een offerte net zo goed — ook die gaat naar een klant. */}
                  {profile && lines.length > 0 && (
                    <PdfPreviewButton
                      invoice={{
                        // Er is nog geen nummer: dat wordt pas bij verzending toegekend, uit de
                        // doorlopende reeks (art. 35 Wet OB). Het voorbeeld zegt CONCEPT in plaats
                        // van een leeg vak, zodat niemand denkt dat de nummering stuk is.
                        invoice_number: t('nieuw.pdf.nogGeenNummer'),
                        invoice_type: invoiceType,
                        invoice_date: invoiceDate,
                        due_date: dueDate,
                        delivery_date: deliveryDate,
                        client_name: clientName,
                        client_email: clientEmail,
                        client_address: clientAddress,
                        client_postal_code: clientPostal,
                        client_city: clientCity,
                        client_btw_number: clientBtw,
                        client_country: normalizeCountry(clientCountry),
                        // [KLANT-EXTRA] De twee vrije klantregels horen er ook op. Zonder deze
                        // vier velden toont het voorbeeld een ander adresblok dan de factuur die
                        // straks verstuurd wordt — en een voorbeeld dat afwijkt van het document
                        // is erger dan geen voorbeeld.
                        client_extra_line1: clientExtra1,
                        client_extra_line2: clientExtra2,
                        client_extra_line3: clientExtra3,
                        client_extra_line4: clientExtra4,
                        // Dezelfde drie bedragen die de bevestiging toont en die de server straks
                        // opslaat — kortingTotalen, niet een tweede som hier.
                        total_ex_btw: totalEx,
                        btw_amount: btwAmount,
                        total_inc_btw: totalInc,
                      }}
                      lines={lines}
                      profile={profile}
                      label={t('nieuw.actie.pdfBekijken')}
                      busyLabel={t('nieuw.actie.pdfBezig')}
                      failedLabel={t('nieuw.actie.pdfMislukt')}
                      style={{
                        flex: 1, minHeight: 48, borderRadius: 9999, border: '1px solid #DADCE0',
                        backgroundColor: 'transparent', color: '#5F6368', fontSize: 14, fontWeight: 500,
                        cursor: 'pointer', textDecoration: 'none', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    />
                  )}
                  {/* [BOEK-031] Annuleren — Link to parent — Navigation Strategy — May 2026 */}
                  <Link href={parentHref}
                    style={{ minHeight: 48, padding: '0 20px', borderRadius: 9999, border: 'none', backgroundColor: 'transparent', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t('nieuw.actie.annuleren')}
                  </Link>
                </div>
              </div>
            </div>
          </>
      </div>

      {/* [VERSTUURD] Na afloop: wat er is gebeurd, wat vastligt, en hoe je het zelf nakijkt. */}
      {sentNotice && sentInvoiceId && (
        <InvoiceSentModal
          notice={sentNotice}
          onView={() => router.replace(`/dashboard/invoice/${sentInvoiceId}`)}
          // Een verse nieuwe factuur, niet dit formulier opnieuw: de regels, de klant en de
          // datums staan er nog, en die een tweede keer versturen is precies wat niet mag.
          onNew={() => { window.location.href = '/dashboard/invoice/new' }}
        />
      )}

      {/* [OFFERTE-VERSTUREN-NIEUW] Na afloop: de offerte is gemaild. De zin komt van de route en
          zegt óók dat er nog geen factuur bestaat — die maak je pas als de klant akkoord is. Een
          scherm dat vanzelf wegnavigeert zou die zin opeten ([VERSTUURD] leerde dat al). */}
      {offerteSent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="sheet-scroll" style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>📨 {t('nieuw.offerte.verstuurdTitel')}</h2>
            {offerteSent.message && (
              <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>{offerteSent.message}</p>
            )}
            <button
              onClick={() => router.replace(`/dashboard/invoice/${offerteSent.id}`)}
              style={{ width: '100%', minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#1A73E8', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              {t('nieuw.offerte.naarDetail')}
            </button>
          </div>
        </div>
      )}

      {/* [FACTUUR-A] Send confirmation — centered modal (house convention) */}
      {showSendConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="sheet-scroll" style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>{t('nieuw.bevestig.titel')}</h2>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: 0 }}>
              {t('nieuw.bevestig.uitleg')}
            </p>
            <div style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                // [NUMMER-VOORUITBLIK] Bekend? Dan het verwachte nummer. Niet bekend? Dan de zin
                // die er altijd al stond — nooit een leeg vak op de bevestiging van een
                // onomkeerbare handeling.
                [t('bewerk.modal.nummer'), nextNumber ?? t('bewerk.modal.nummerBijVerzending')],
                [t('nieuw.bevestig.aan'), clientName || '—'],
                [t('nieuw.bevestig.email'), clientEmail || '—'],
                [t('nieuw.bevestig.bedrag'), NL_NUMBER.format(totalInc)],
                [t('nieuw.datum.factuur'), formatDateNL(invoiceDate)],
                [t('nieuw.datum.verval'), formatDateNL(dueDate)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#5F6368' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', textAlign: 'end', maxWidth: '60%', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowSendConfirm(false); handleSubmit('sent') }} disabled={loading}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: loading ? '#70757a' : '#1A73E8', color: 'white', fontSize: 16, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? t('nieuw.actie.versturenBezig') : `✉ ${t('nieuw.bevestig.ja')}`}
              </button>
              <button onClick={() => setShowSendConfirm(false)} disabled={loading}
                style={{ flex: 1, minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#F1F3F4', color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {t('nieuw.actie.annuleren')}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoicePageContent />
    </Suspense>
  )
}