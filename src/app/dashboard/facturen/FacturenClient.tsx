'use client'

// src/app/dashboard/facturen/FacturenClient.tsx
// [BOEK-029] Client component — profile always passed from server wrapper
// Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter, useSearchParams } from 'next/navigation'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { deliveryFailure } from '@/lib/invoice-delivery'
import { failureText } from '@/lib/server-message'
import { M3, R, STICKY_BELOW_HEADER, PAGE_HEADER_HEIGHT, columnInner, COLUMN } from '@/lib/design/tokens'
// [FOCUS-KOP] Where a deep-linked row must come to rest — see the header of that file.
import { landRowUnderChrome } from '@/lib/focus-scroll'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
// [DEEL-CREDIT] One definition of how much has been credited, and of when that is the whole thing.
import { creditedTotalsFrom, creditDetailsFrom, fullyCreditedIdsFrom, moneyDirection, type CreditDetail } from '@/lib/credited-invoices'
// [PAGINATION] PostgREST's silent ~1000-row cap — see the credit read below.
import { fetchAllRows } from '@/lib/supabase-paginate'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter, InvoiceRow } from '@/hooks/useInfiniteInvoices'

// [BOEK-029] Archived rows carry only the columns their end-of-list card renders.
type ArchivedRow = {
  id: string
  invoice_number: string | null
  total_inc_btw: number | null
  replaced_by_number: string | null
  invoice_date: string | null
  invoice_type: string | null
}
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import { ReconBadge, getDisplayStatus } from '@/components/invoice/InvoiceRow'
import { InvoiceTypeBadge } from '@/components/invoice/InvoiceTypeBadge'
import { crossQuarterPayment } from '@/lib/quarter'
// [TZ] 'Today' must be the owner's Amsterdam day, never the UTC one — see format-nl.ts.
import { amsterdamToday } from '@/lib/format-nl'
// [PAY-DATE-SANE] the floor the betaaldatum picker offers — see payment-date.ts
import { PAYMENT_DATE_FLOOR } from '@/lib/payment-date'
import { amountOrConditions } from '@/lib/search'
// [PARTIAL-PAY] one definition of openstaand, shared with the incoming side and the API
import { openAmount, isPartiallyPaid, interpretAmountEntry } from "@/lib/partial-payment"
// [INVOICE-REMOVE] One rule decides what "Verwijderen" does to THIS invoice — the same rule the
// API route re-checks before it writes. The dialog below is that decision, rendered.
import { decideRemoval, type RemovalDecision, type RemovalInvoice } from "@/lib/invoice-removal"
import { useToast } from "@/components/ui/Toast"
// [HAND-DUBBEL] De app-brede bevestigingsdialoog (DialogProvider staat in de root layout).
import { useDialog } from "@/components/ui/Dialog"
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] A date the owner types, in the order they read it — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
import { statusChip, isInvoiceStatus } from '@/lib/invoice-status'
// [AANBETALING] The percentage the owner types, judged once.
import { parseDepositPercent } from '@/lib/aanbetaling'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [PAY-REDEN] One rule for what a refused pay-toggle says, shared with /vandaag and /manage.
import { payToggleAnswer, isVerwerktConflict, isDuplicatePaidConflict } from '@/lib/pay-toggle-reason'
import type { MessageKey } from '@/lib/i18n/messages'
// [OPENSTAAND-BEWIJS] The panel is built in the pure module and painted by the same component the
// pay screen uses. Never open-invoice-proof.ts itself — that reaches the whole matching engine.
// [BEWIJS-BEANTWOORDEN] De vraag die de ondernemer al beantwoord heeft, wordt niet nog eens
// gesteld — en dat er iets is weggelegd, staat er. Zie open-invoice-proof-ack.ts.
// [BETAALBEWIJS] Under every "Betaald", the bank line that says so — the same pure rule and the
// same component the pay screen uses, reading the owner's OWN rows through RLS (see below).
import { collectPaymentEvidence } from '@/lib/payment-evidence-collect'
import { buildPaymentEvidenceLine, settledInvoiceIds, type PaymentEvidence } from '@/lib/payment-evidence'
import PaymentEvidenceLine from '@/components/invoice/PaymentEvidenceLine'
// [CREDIT-BEWIJS] Which credit notes are behind the "gecrediteerd" chip — see the row below.
import { buildCreditEvidenceLine } from '@/lib/credit-evidence'
import CreditEvidenceLine from '@/components/invoice/CreditEvidenceLine'
// [TEKST-SELECTIE] Een sleep die tekst selecteert is geen tik op de rij: de kaart klapte
// open en dicht terwijl de eigenaar een factuurnummer probeerde te kopiëren.
import { onRowTap } from '@/lib/row-tap'
// [NUMMER-KOPIEREN] Eén tik kopieert het factuurnummer — de waarde die een eigenaar het vaakst
// overneemt en het minst uit het hoofd kent. Zie CopyButton.tsx.
import { CopyButton } from '@/components/ui/CopyButton'
import { copyToClipboard } from '@/lib/clipboard'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const FONT     = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

// Status chip colors — Material You
// [PAY-IDEMPOTENT] A fresh key per dialog OPENING — this is the whole point of the key, and it
// was not happening. The key used to be minted inside the confirm handler as
// `payCtx.clientKey ?? crypto.randomUUID()`, but nothing ever set payCtx.clientKey, so every tap
// produced a new UUID and apply_manual_payment could never recognise a repeat. For a FULL
// settlement the invoice's own 'paid' status still blocks a second write; for a DEELBETALING
// there is no such guard, so a double tap recorded the instalment twice. Minting it here, where
// the dialog is opened, gives one key per attempt.
//
// It does not cover a retry after an unknown outcome (a reopened dialog is a new attempt and gets
// a new key) — that is deliberate: reusing the key there would silently swallow a genuine second
// instalment of the same amount, which is worse. The network-error toast says "controleer of de
// betaling is opgeslagen" for exactly that reason.
function newPayKey(): string | undefined {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined
}

// [STATUS] De negende kopie van de statuskleuren stond hier, met er twintig regels verderop een
// losse ternary voor het WOORD — twee halve waarheden over hetzelfde chipje. Allebei komen ze nu
// uit src/lib/invoice-status.ts.

// ─── Formatters ───────────────────────────────────────────────────────────────
const NL_EUR  = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED. Without it `new Date('2026-07-31')` (UTC midnight) is formatted in the
// BROWSER's zone, so west of UTC every invoice date rendered one day early — "30 jul" for an
// invoice dated the 31st. format-nl.ts opens with exactly this warning ("We never let that happen
// on a legal document"); this list was the one place still doing it. Amsterdam is the owner's day.
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [BOEK-029] btw_rate does not exist in DB — always computed from the two stored amounts.
// [BTW-NO-GUESS] Returns null when there is no grondslag to compute from. It used to fall back
// to 21, printing "BTW (21%)" for an invoice whose total_ex_btw was 0, null or negative (a
// creditnota, or an OCR read that found no net amount) — a tax rate nobody read, shown as fact.
// A 9%-invoice missing its grondslag was labelled 21%. The caller drops the percentage from the
// label rather than inventing one; the AMOUNT beside it is stored and stays exact either way.
const calcBtw = (btw: number | null, ex: number | null): number | null =>
  ex && ex > 0 ? Math.round(((btw ?? 0) / ex) * 100) : null

// ─── Types ────────────────────────────────────────────────────────────────────
type SortOrder = 'desc' | 'asc'
type FilterTab = 'all' | 'sent' | 'paid' | 'draft' | 'overdue' | 'offerte' | 'credit'
// [HERHAAL] One recurring schedule, as /api/invoice/schedules returns it — including the invoice
// it repeats, because an owner recognises a schedule by its customer, never by a uuid.
interface ScheduleRow {
  id: string
  source_invoice_id: string
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  next_run_date: string
  ends_on: string | null
  active: boolean
  source: { invoice_number: string | null; client_name: string | null; total_inc_btw: number | null } | null
}
// [TAAL] One key per cadence per sentence — the cadence word is never a parameter, because
// agreement/suffixes differ per language (see the noun rule in messages.ts).
const CADENCE_ACTIVE_KEY: Record<ScheduleRow['cadence'], MessageKey> = {
  weekly: 'lijst.schema.week', monthly: 'lijst.schema.maand', quarterly: 'lijst.schema.kwartaal', yearly: 'lijst.schema.jaar',
}
const CADENCE_PAUSED_KEY: Record<ScheduleRow['cadence'], MessageKey> = {
  weekly: 'lijst.schema.weekPauze', monthly: 'lijst.schema.maandPauze', quarterly: 'lijst.schema.kwartaalPauze', yearly: 'lijst.schema.jaarPauze',
}
// [INVOICE-REMOVE] What the confirm dialog is about: the invoice, and the decision made for it.
interface RemoveCtx { id: string; decision: RemovalDecision }
// [BOEK-029] Fix 1+3: invoiceType distinguishes factuur vs creditnota dialogs
interface ConfirmPayCtx {
  id: string
  number: string
  newStatus: 'paid' | 'sent'
  invoiceType: 'factuur' | 'creditnota' | 'pro_forma'
  // [BOEK-003] payment method — required by DB constraint invoices_paid_requires_method
  // UI shows "Bank" / "Contant"; DB stores 'bank' / 'kas'
  paymentMethod?: 'bank' | 'kas'
  // [MANUAL-PARTIAL-PAY] The amount actually paid. null/absent = the whole open balance
  // (the empty field), a number = a deelbetaling. clientKey makes the POST idempotent.
  amount?: number | null
  clientKey?: string
  // What was still open when the dialog opened — drives the field's hint and its cap.
  openAmount?: number
  // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD) — Axis 2 / cash
  paymentDate?: string
}
// [BOEK-029] Send confirmation for draft → sent
interface SendCtx {
  id: string
  number: string
  clientName: string
  clientEmail: string
  totalIncBtw: number
  invoiceType: string
  // [BOEK-RESEND] the status to restore on failure (draft for first send,
  // sent/overdue for a resend) — so a failed resend doesn't wrongly become draft.
  prevStatus: string
  isResend?: boolean
}

// [STATUS] Vier van deze zeven zijn statussen en halen hun woord uit invoice-status.ts; 'all',
// 'offerte' en 'credit' zijn filters over iets anders en houden hun eigen sleutel.
const FILTERS: { id: FilterTab; key: MessageKey }[] = [
  { id: 'all',     key: 'filter.all'      },
  { id: 'sent',    key: 'status.sent'     },
  { id: 'paid',    key: 'status.paid'     },
  { id: 'draft',   key: 'status.draft'    },
  { id: 'overdue', key: 'status.overdue'  },
  { id: 'offerte', key: 'filter.offerte'  },
  { id: 'credit',  key: 'status.credit'   },
]

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FacturenClient({
  profile,
  // [ACTING-FOR] factuur-id → naam van de MEDEWERKER die hem maakte. Alleen gevuld voor facturen die
  // iemand anders dan de eigenaar aanmaakte, en alleen met namen van (oud-)teamleden — zie de
  // serverwrapper. Leeg bij geen team of een niet-toegepaste migratie: dan is er niets te tonen.
  makers = {},
  // [BESTE] What is still to come in, counted by the server over EVERY sales invoice — this list is
  // paged, so a sum over its rows would be the sum of the first page. Null when the read failed.
  totals = null,
}: {
  profile: { id: string }
  makers?: Record<string, string>
  totals?: { open: number; outstanding: number; overdue: number; overdueAmount: number } | null
}) {
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const showToast = useToast()
  // [HAND-DUBBEL] Voor de ene vraag die dit scherm moet stellen voordat het geld boekt.
  const dialog = useDialog()
  const taal = useLocale()
  const t = translator(taal)
  const router   = useRouter()
  const supabase = createClient()
  // [BANK-RECON-BADGE] Per-invoice reconciliation vs the bank statement (fail-soft).
  const { byInvoice: recon, confirmMatch } = useInvoiceReconciliation()

  const [filter, setFilter]             = useState<FilterTab>('all')
  const [sort, setSort]                 = useState<SortOrder>('desc')
  const [showFilterMenu, setShowFilterMenu] = useState(false)  // [BOEK-029] dropdown
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [removeCtx, setRemoveCtx]       = useState<RemoveCtx | null>(null)
  // [HERHAAL] The invoice the owner is about to start (or stop) repeating.
  const [repeatCtx, setRepeatCtx]       = useState<{ id: string; number: string; client: string; scheduleId?: string; cadence?: string; nextRun?: string; active?: boolean } | null>(null)
  useCloseOnBack(!!repeatCtx, () => setRepeatCtx(null))
  // [HERHAAL] Every schedule this owner has, in full — not just a lookup keyed by invoice.
  //
  // The per-row badge needs the map; the PANEL needs the list, and the panel is the part that
  // makes the promise true. A schedule can only be reached from the invoice it repeats, and that
  // invoice ages: after a year of monthly concepts the source sits hundreds of rows down, or
  // behind a different filter tab. A feature that creates invoices by itself may never be harder
  // to switch off than it was to switch on.
  const [scheduleList, setScheduleList] = useState<ScheduleRow[]>([])

  // [RUST] Staat het herhaalpaneel open? Standaard niet — zie de regel-sleutels in messages.ts.
  // Niet onthouden tussen bezoeken: de stand hoort bij deze blik op de lijst, niet bij de
  // gebruiker, en een voorkeur die blijft plakken verbergt de volgende serie die erbij komt.
  const [showHerhaal, setShowHerhaal] = useState(false)
  const schedules = useMemo(() => {
    // PAUSED schedules belong in here too. Leaving them out made the row offer "Herhalen"
    // again, which the server refuses (one schedule per invoice) — a dead end on a button the
    // owner had every reason to press. The row now says what is actually true, and the dialog
    // offers the way back.
    const map: Record<string, { id: string; cadence: string; next_run_date: string; active: boolean }> = {}
    for (const sc of scheduleList) {
      map[sc.source_invoice_id] = { id: sc.id, cadence: sc.cadence, next_run_date: sc.next_run_date, active: sc.active }
    }
    return map
  }, [scheduleList])

  async function loadSchedules() {
    try {
      const res = await fetch('/api/invoice/schedules')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.schedules) return
      setScheduleList(json.schedules as ScheduleRow[])
    } catch { /* silent — the feature is simply not shown */ }
  }
  const [payCtx, setPayCtx]             = useState<ConfirmPayCtx | null>(null)
  const [sendCtx, setSendCtx]           = useState<SendCtx | null>(null)  // [BOEK-029] Versturen confirm
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BOEK-004] dialog shown when client tries to unpay an accountant-verwerkt invoice
  const [verwerktCtx, setVerwerktCtx] = useState<{ id: string; number: string } | null>(null)
  useCloseOnBack(!!verwerktCtx, () => setVerwerktCtx(null))
  const [requestSent, setRequestSent] = useState(false)

  // ── [BUNDEL-BETAALVERZOEK] Multi-select → one payment link for several open
  // facturen of the same klant. Selected rows are kept as OBJECTS (not just ids)
  // so the selection survives filter/search changes that drop rows from view.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Record<string, { id: string; number: string; client: string; amount: number; bundelbaar: boolean }>>({})
  const [bundle, setBundle] = useState<{ url: string; amount: number; reference: string; count: number; iban: string } | null>(null)
  useCloseOnBack(!!bundle, () => setBundle(null))
  const [bundleLoading, setBundleLoading] = useState(false)
  const [bundleQr, setBundleQr] = useState('')
  // [KOPIE-EERLIJK] null = not tapped, true = on the clipboard, false = the write was refused and
  // the clipboard still holds whatever it held. This is a payment link to a customer.
  const [bundleCopied, setBundleCopied] = useState<boolean | null>(null)

  const selectedList = Object.values(selected)
  const selectedSum = selectedList.reduce((s, r) => s + r.amount, 0)
  // ONE customer pays the bundle — the button explains itself when clients mix.
  const sameClient = new Set(selectedList.map(r => r.client.trim().toLowerCase())).size <= 1
  // [BULK-PDF] What the betaalverzoek can handle, now stated as its own condition. Until here this
  // rule hung on the SELECTION itself (a non-bundelbaar row simply could not be ticked); now that
  // downloading is allowed for anything, the button has to state it.
  const allBundelbaar = selectedList.length > 0 && selectedList.every(r => r.bundelbaar)

  // The row fields the bundle selection reads — a subset of both the infinite
  // list's InvoiceRow and the server-search rows.
  type BundelRow = {
    id: string
    invoice_number?: string | null
    client_name?: string | null
    status: string
    invoice_type?: string | null
    total_inc_btw?: number | null
    // [PARTIAL-PAY] already settled by earlier instalments
    amount_paid?: number | null
  }

  // [DEEL-CREDIT] …and HOW MUCH, not merely whether. This read used to fetch original_invoice_id
  // alone, which is a yes/no — and a yes/no became the wrong question the day a creditnota could
  // cover one disputed line instead of the whole invoice. Three things followed from it on this
  // screen, and all three said "withdrawn" about an invoice that still owes money:
  //
  //   · isBundelbaar refused it a place in a gebundeld betaalverzoek. The API stopped refusing
  //     those (betaalverzoek-bundel: "A PARTLY credited invoice may join — it still owes the
  //     rest"), so the screen was greying out something the server would have accepted, and the
  //     comment there still explained the block by that server refusal.
  //   · the 'Gecrediteerd' chip claimed the invoice is no longer chased or counted, on an invoice
  //     that IS both.
  //   · and the 'Deelbetaling' chip was suppressed beside it — so a partly paid AND partly
  //     credited invoice lost the one line saying what is still owed, and with it the tap target
  //     for recording the next instalment.
  const [creditedAmounts, setCreditedAmounts] = useState<Map<string, number>>(new Map())
  /**
   * [NO-SILENT-EMPTY] The credit read did not answer, and every amount below may be too high.
   *
   * `const { data }` without `error` — supabase-js does not throw, it returns { data: null, error }
   * — so a failed read arrived here as an EMPTY credit map. Every credited invoice then showed its
   * full total as outstanding, the "Gecrediteerd" chip disappeared, and an invoice the owner had
   * formally withdrawn looked completely chaseable. On money that was given back in writing, that
   * is the worst direction for this screen to fail in.
   */
  const [creditsReadFailed, setCreditsReadFailed] = useState(false)
  /** Per invoice id, the credits themselves — number and date, so the chip can show its working. */
  const [creditRows, setCreditRows] = useState<Map<string, CreditDetail[]>>(new Map())

  useEffect(() => {
    if (!profile?.id) return
    let live = true
    // [PAGINATION] Paged, not a bare select. PostgREST caps a response at ~1000 rows and says
    // nothing about it, so an owner past that many creditnotas silently lost the rest — and losing
    // a credit means an invoice reappears as fully owed.
    fetchAllRows<{ original_invoice_id: string | null; total_inc_btw: number | null; invoice_number: string | null; invoice_date: string | null }>(
      (from, to) => supabase
        .from('invoices')
        .select('original_invoice_id, total_inc_btw, invoice_number, invoice_date')
        .eq('sender_id', profile.id)
        .eq('invoice_type', 'creditnota')
        .not('original_invoice_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
      .then((rows) => {
        if (!live) return
        setCreditedAmounts(creditedTotalsFrom(rows))
        setCreditRows(creditDetailsFrom(rows))
        setCreditsReadFailed(false)
      })
      .catch((e) => {
        console.error('[DEEL-CREDIT] credit read failed — amounts on this list may be too high', e)
        if (!live) return
        // Deliberately NOT cleared: a stale map beats an empty one, because empty means "nothing
        // was credited" — a claim this screen has no basis for making. The banner says so.
        setCreditsReadFailed(true)
      })
    return () => { live = false }
  }, [profile?.id, supabase])

  /** [DEEL-CREDIT] What has been credited against this invoice, incl. btw, as a positive amount. */
  const gecrediteerdOp = useCallback(
    (id: string) => creditedAmounts.get(id) ?? 0,
    [creditedAmounts],
  )

  /**
   * [DEEL-CREDIT] Withdrawn — the credits together cover the WHOLE invoice. Only this is what the
   * 'Gecrediteerd' chip has ever meant: not chased, not counted, nothing left. A partial credit is
   * a different state and gets a different chip, because an owner who reads "Gecrediteerd" on an
   * invoice they are still owed € 450 for will stop expecting the money.
   */
  const isVolledigGecrediteerd = useCallback(
    (inv: { id: string; total_inc_btw?: number | null }) =>
      fullyCreditedIdsFrom(
        [{ original_invoice_id: inv.id, total_inc_btw: -gecrediteerdOp(inv.id) }],
        [{ id: inv.id, total_inc_btw: inv.total_inc_btw ?? null }],
      ).has(inv.id),
    [gecrediteerdOp],
  )

  // Only an issued, unpaid verkoopfactuur can join a bundle (same rule as the lib).
  // [CREDITNOTA-NO-CHASE] …and never one that was WITHDRAWN with a creditnota. The API refuses
  // those (betaalverzoek-bundel checks it server-side, because the pay page drops them from the
  // payable set), so selecting one led to a dead "Betaalverzoek maken mislukt" for something this
  // screen already knew: the credits are loaded right here. Grey it out instead of failing later.
  //
  // [DEEL-CREDIT] Withdrawn means FULLY credited, and the distinction is the whole point: the API
  // now says in as many words that "a PARTLY credited invoice may join — it still owes the rest",
  // so the yes/no test greyed out a row the server was waiting to accept. The block outlived the
  // refusal it was mirroring.
  const isBundelbaar = (inv: BundelRow) =>
    (inv.invoice_type == null || inv.invoice_type === 'factuur') &&
    ['sent', 'overdue', 'processing'].includes(inv.status) &&
    !isVolledigGecrediteerd(inv)

  // [BULK-PDF] Take the selected invoices away as pdf. One invoice comes back as the pdf itself,
  // more as a zip — nobody should unpack an archive for a single file.
  //
  // What could NOT be included is reported by name, never counted: "3 of the 8 are missing" is a
  // number nobody can act on, and a short archive looks complete when you open it.
  const [downloading, setDownloading] = useState(false)
  async function downloadSelectedPdf() {
    if (downloading || selectedList.length === 0) return
    setDownloading(true)
    try {
      const res = await fetch('/api/invoice/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedList.map(r => r.id), direction: 'outgoing' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        showToast(failureText(res.status, json, t('lijst.download.mislukt')))
        return
      }
      const blob = await res.blob()
      const naam = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? 'facturen.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = naam
      a.click()
      URL.revokeObjectURL(url)
      const ontbreekt = Number(res.headers.get('X-Bulk-Missing') ?? '0')
      if (ontbreekt > 0) {
        const namen = decodeURIComponent(res.headers.get('X-Bulk-Missing-Names') ?? '')
        showToast(t('lijst.download.deels', { namen }))
      }
    } catch {
      showToast(t('lijst.download.mislukt'))
    } finally {
      setDownloading(false)
    }
  }

  function toggleSelect(inv: BundelRow) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[inv.id]) delete next[inv.id]
      else next[inv.id] = {
        id: inv.id,
        number: inv.invoice_number ?? '',
        client: inv.client_name ?? '',
        // [BULK-PDF] Whether this row may join a bundled betaalverzoek, recorded at the moment it
        // is ticked. Same reason as everything else on this object: the selection has to survive a
        // filter change, and by then the row itself is no longer there to ask again.
        bundelbaar: isBundelbaar(inv),
        // [PARTIAL-PAY] The OPEN amount, not the full total — this is what the bundle's
        // QR asks the customer (buildBundelBetaalverzoek sums the open amounts). Showing
        // the full total here made the owner read one number and the customer pay another.
        //
        // [DEEL-CREDIT] …and the credit comes off here for exactly that reason, one level down.
        // The SERVER already subtracts it (betaalverzoek.ts openAmount, fed credited_inc_btw by
        // the bundle route), so without this line the same sentence came true again: the owner
        // selected three invoices and read a total that was higher than the amount the QR would
        // ask for, by whatever had been credited back.
        amount: openAmount(inv, gecrediteerdOp(inv.id)),
      }
      return next
    })
  }

  function exitSelectMode() { setSelectMode(false); setSelected({}) }

  async function createBundle() {
    if (selectedList.length < 2 || !sameClient || bundleLoading) return
    setBundleLoading(true); setBundleQr(''); setBundleCopied(false)
    try {
      const res = await fetch('/api/invoice/betaalverzoek-bundel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: selectedList.map(r => r.id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(failureText(res.status, data, t('lijst.fout.betaalverzoek'))); return }
      setBundle({ url: data.url, amount: data.amount, reference: data.reference, count: data.count, iban: data.iban })
      exitSelectMode()
      try {
        // A QR of the pay LINK — scan to OPEN the payment page (handy at a counter).
        const QR = await import('qrcode')
        setBundleQr(await QR.toDataURL(data.url, { margin: 1, width: 220 }))
      } catch { /* the link below always works without the QR */ }
    } catch {
      showToast(t('lijst.fout.betaalverzoek'))
    } finally {
      setBundleLoading(false)
    }
  }

  async function bundleCopy(value: string) {
    setBundleCopied(await copyToClipboard(value))
    setTimeout(() => setBundleCopied(null), 1500)
  }

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // Reached when the accountant marks an OUTGOING invoice 'verwerkt'. Lands on
  // the row: auto-expand, scroll, brief highlight. Best-effort — if the row
  // isn't in the currently loaded page (infinite list), the page still opens.
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // [SEARCH] Quick text-filter over the loaded invoices. Starts empty; the global
  // search bar now opens the dedicated results page (/dashboard/zoeken), so nothing
  // deep-links a query into this page anymore — the old ?search= seeding was removed.
  const [search, setSearch] = useState('')

  // [SEARCH] In-page live filter, SERVER-backed: finds ALL matching invoices (every
  // status, not only the loaded/paginated rows), in place — no navigation, no reload.
  // Active from 2 chars; falls back to the normal infinite list when empty.
  const [searchResults, setSearchResults] = useState<InvoiceRow[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // [FOCUS-KOP] The sticky controls bar, measured live: a deep-linked row has to come to
  // rest under it, and its height is not a constant — it wraps on a narrow screen.
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  // [BOEK-029] Archived — separate fetch, shown at end of "Alle" only
  const [archivedInvoices, setArchivedInvoices] = useState<ArchivedRow[]>([])
  // [INVOICE-REMOVE] …and re-fetched after every removal/restore. This list IS the undo, so it
  // has to be current the moment an invoice lands in it — otherwise the owner removes something
  // and the "terug te zetten onderaan de lijst" the toast just promised isn't there yet.
  const [archivedTick, setArchivedTick] = useState(0)

  // [HERHAAL] Silent on failure and on a not-yet-migrated database: an absent feature shows
  // nothing, it never breaks the list. Inline async IIFE, matching the other loaders here, so no
  // setState runs synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/invoice/schedules')
        const json = await res.json().catch(() => ({}))
        if (cancelled || !res.ok || !json?.schedules) return
        setScheduleList(json.schedules as ScheduleRow[])
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('invoices')
      .select('id, invoice_number, total_inc_btw, replaced_by_number, invoice_date, invoice_type')
      .eq('sender_id', profile.id)
      .eq('status', 'archived')
      .order('created_at', { ascending: false })
      .then(({ data }) => setArchivedInvoices((data ?? []) as unknown as ArchivedRow[]))
  }, [profile?.id, archivedTick])

  // [CREDITNOTA-NO-CHASE] Which invoices did the owner WITHDRAW with a creditnota? Such an
  // invoice deliberately keeps its 'sent' status and its positive total (the +omzet must stay
  // to be netted by the creditnota's −omzet), so the row is indistinguishable from an ordinary
  // open one — while the reminder cron and "Te ontvangen" now correctly ignore it. Without
  // this the two screens disagree: the tile stops counting the money and the list keeps
  // showing it as owed, with no explanation for why nothing is being chased. Keyed on the
  // owner (a creditnota per owner is rare), so it costs one small read and no pagination.

  // [SEARCH] Debounced server query over ALL the user's invoices (any status), so a
  // match that hasn't been scrolled into the infinite list is still found instantly.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      const t0 = setTimeout(() => { setSearchResults(null); setSearchLoading(false) }, 0)
      return () => clearTimeout(t0)
    }
    const esc = q.replace(/[,()%_*\\":]/g, ' ').trim()
    // [SMART-FILTER] amount-aware server search: when the query is money-shaped,
    // also match total_inc_btw (decimaal- én duizendtal-bewust). So "670,09" /
    // "670.0" now find the invoice, not just its number/name. (src/lib/search.ts)
    const amountOr = amountOrConditions('total_inc_btw', q)
    // Only add the text ILIKE parts when esc has real content — an empty esc would
    // build `ilike.%%` (match-all). If there is nothing to match on, bail before the DB.
    const textOr = esc.length >= 1 ? [`invoice_number.ilike.%${esc}%`, `client_name.ilike.%${esc}%`] : []
    const orParts = [...textOr, ...amountOr]
    if (orParts.length === 0) {
      const t0 = setTimeout(() => { setSearchResults([]); setSearchLoading(false) }, 0)
      return () => clearTimeout(t0)
    }
    let active = true
    // [PERF] One AbortController per run: a superseded query (the next keystroke) is now
    // really CANCELLED instead of merely ignored — it stops occupying a connection and
    // stops the server finishing work nobody reads. `active` stays as the second guard.
    const controller = new AbortController()
    const tLoad = setTimeout(() => setSearchLoading(true), 0)
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('invoices')
          // [PARTIAL-PAY] amount_paid too — a searched row must show the same "Deels betaald"
          // chip (and feed the same bundle open-amount) as a row from the infinite list.
          .select('id, invoice_number, client_name, status, accountant_status, direction, total_inc_btw, amount_paid, total_ex_btw, btw_amount, invoice_date, due_date, created_at, replaced_by_number, invoice_type')
          .eq('sender_id', profile.id)
          .neq('status', 'archived')
          .or(orParts.join(','))
          .order('created_at', { ascending: false })
          .limit(50)
          .abortSignal(controller.signal)
        if (!active) return
        setSearchResults((data ?? []) as unknown as InvoiceRow[])
        setSearchLoading(false)
      } catch (e) {
        // [PERF] An abort is the NORMAL outcome of typing on — swallow it silently so it
        // can never surface as an unhandled rejection. Anything else keeps behaving as before.
        if (controller.signal.aborted || (e as Error)?.name === 'AbortError') return
        throw e
      }
    }, 250)
    return () => { active = false; controller.abort(); clearTimeout(tLoad); clearTimeout(t) }
  }, [search, profile.id])

  const statusMap: Record<FilterTab, InvoiceStatusFilter> = {
    all: 'all', sent: 'sent', paid: 'paid', draft: 'draft',
    overdue: 'overdue', offerte: 'all', credit: 'all',
  }

  const {
    invoices, loading, hasMore, refreshing,
    loadMore, refresh, updateOptimistic, removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id, status: statusMap[filter] })

  // ── [BETAALBEWIJS] How do we know this one is paid? ────────────────────────────────────────
  //
  // "Betaald" on this list is read off amount_paid, and nothing here had ever looked at
  // bank_tx_invoices. So the word carried no evidence: to check it the owner opened their bank in
  // another tab and searched — the exact work this product exists to remove, handed back at the
  // moment trust is being asked for.
  //
  // On the SALES side the stakes point the other way from the pay screen. A purchase invoice
  // wrongly marked paid is a bill that may still be owed and will be chased by the supplier. A
  // sales invoice wrongly marked paid is money the owner believes came in and never asks for
  // again — nobody chases it, so nothing ever surfaces it. That is the state this line names.
  //
  // Read from the BROWSER, with the owner's own session. bank_tx_invoices and bank_transactions
  // both carry `user_id = auth.uid()` select policies, so RLS scopes this exactly and no route
  // needs to widen anything. The list is paged, so this follows the loaded ids rather than
  // fetching per row.
  const [paymentEvidence, setPaymentEvidence] = useState<Record<string, PaymentEvidence>>({})
  // Only settled rows are asked about, and the key is a stable string so a re-render with the same
  // ids does not re-read. Sorted because the loader's order is not guaranteed between pages.
  // The ids AND the totals in one memo. They were separate, with the effect reading `invoices`
  // from its closure while depending only on the id string — so an invoice whose total was
  // corrected kept the OLD total in the map, and a legacy link would be valued at a figure the
  // invoice no longer carries. eslint pointed at exactly that.
  const settled = useMemo(() => {
    const ids = settledInvoiceIds(invoices)
    const totals: Record<string, number | null> = {}
    for (const inv of invoices) if (inv.id) totals[inv.id] = inv.total_inc_btw ?? null
    return { ids, totals, key: ids.map((id) => `${id}:${totals[id] ?? ''}`).join(',') }
  }, [invoices])
  const settledKey = settled.key
  useEffect(() => {
    if (!profile?.id) return
    let live = true
    // Always through the collector, including the empty case — it answers {} for an empty list
    // without a round trip. Clearing the map synchronously here instead would be a setState in the
    // effect BODY, which cascades a render on every page the list loads.
    // The totals come along so a link from before amount_applied existed can be valued — it settled
    // its invoice in full, and reading its NULL as 0 is what made this line cry wolf.
    const { ids, totals } = settled
    collectPaymentEvidence({ pipeline: supabase, ownerId: profile.id, invoiceIds: ids, totals })
      .then((map) => { if (live) setPaymentEvidence(map) })
      .catch((e) => {
        // [NO-SILENT-EMPTY] The collector already answers 'unknown' per invoice on a failed read;
        // reaching HERE means it threw outright. Every row asked about then says "we could not
        // look" rather than silently losing its line, because a missing line reads as "nothing to
        // say" and this feature exists to stop exactly that.
        console.error('[BETAALBEWIJS] payment evidence unreadable', e)
        if (!live) return
        const all: Record<string, PaymentEvidence> = {}
        for (const id of ids) all[id] = { kind: 'unknown' }
        setPaymentEvidence(all)
      })
    return () => { live = false }
  }, [profile?.id, settledKey, settled, supabase])

  // [BRIDGE-NOTIF] Reveal a ?focus= row once it's present in the loaded list.
  //
  // [FOCUS-KOP] The landing is the same one the inkoopfacturen screen had wrong, in the same
  // words: this effect EXPANDS the row and then centres it, and a card taller than the viewport
  // cannot be centred without putting its top off the top of the screen. Measured on the
  // inkoop side at 390x844 the expanded card is 705px against 586px of usable height, and the
  // invoice name came to rest at y=70 — behind 258px of stacked sticky chrome. Nothing about
  // that arithmetic is specific to inkoop, so this screen lands on its row's header too.
  useEffect(() => {
    if (!focusId || loading) return
    if (!invoices.some(i => i.id === focusId)) return
    const applyTimer = setTimeout(() => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    }, 0)
    const scrollTimer = setTimeout(() => {
      landRowUnderChrome(rowRefs.current[focusId], toolbarRef.current, PAGE_HEADER_HEIGHT)
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(applyTimer); clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, invoices.length])

  // When searching (>=2 chars) the SERVER result set is authoritative — it already
  // covers every status and all matches, so no client-side/tab filtering is applied
  // (the user is looking for a specific invoice, wherever it is).
  const searching = search.trim().length >= 2
  const displayed = searching
    ? (searchResults ?? [])
    : invoices.filter(inv => {
        if (inv.status === 'archived') return false
        if (filter === 'offerte') return inv.invoice_type === 'pro_forma'
        if (filter === 'credit')  return inv.invoice_type === 'creditnota'
        return true
      })
  const sorted = sort === 'desc' ? displayed : [...displayed].reverse()

  // [TAB-DRAIN] Offerte/Credit are CLIENT-side filters over server pages of
  // 'all'. When the loaded pages contain zero (or few) pro_forma/creditnota
  // rows, the list used to render "Geen facturen" with the scroll sentinel
  // unmounted — loadMore could never fire and every older offerte/creditnota
  // was unreachable (a dead end). While such a tab shows fewer than a handful
  // of rows and older pages exist, keep pulling pages until matches appear or
  // the pages run out.
  const typeFiltered = filter === 'offerte' || filter === 'credit'
  useEffect(() => {
    if (!typeFiltered || searching) return
    if (loading || !hasMore) return
    if (displayed.length >= 5) return
    loadMore()
  }, [typeFiltered, searching, loading, hasMore, displayed.length, loadMore])


  // [HAND-DUBBEL] `force` is de tweede ronde: de server heeft geweigerd omdat dit factuurnummer al
  // ergens anders betaald staat, de ondernemer heeft die zin gelezen en zegt toch afboeken.
  async function executePay(ctx: ConfirmPayCtx, force = false) {
    setPayCtx(null); setProcessingId(ctx.id)
    // [MANUAL-PARTIAL-PAY] A DEELBETALING leaves the invoice open — so do NOT optimistically
    // flip it to 'paid'; only a full settlement changes the status. The amount lands after
    // the server confirms how much was actually applied.
    const isPartialIntent = ctx.newStatus === 'paid' && ctx.amount != null
    if (!isPartialIntent) updateOptimistic(ctx.id, { status: ctx.newStatus })
    // [PAY-TOGGLE] Route through the audited server endpoint (same as Crediteuren). On UNDO it also
    // detaches any bank transaction matched to this invoice — the old direct client write undid the
    // invoice side only, stranding the tx as 'matched' (payable a second time) and left no audit row.
    //
    // [PAY-NETWORK-SAFE] fetch REJECTS on a dropped connection — the normal case for a shop owner
    // on a phone, not an exotic one. Unguarded, that rejection left this function before the
    // optimistic flip was rolled back and before processingId was cleared: the row kept claiming
    // "Betaald" while nothing was written, and every later tap died on the
    // `processingId === inv.id` guard, so the button stayed a spinner until a reload. Every
    // sibling action here (executeSend, executeRemoval, createBundle) already guarded this.
    let res: Response
    try {
      res = await fetch('/api/invoice/pay-toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: ctx.id,
          action: ctx.newStatus === 'paid' ? 'pay' : 'undo',
          paymentMethod: ctx.paymentMethod ?? 'bank',
          paymentDate: ctx.paymentDate ?? amsterdamToday(),
          // null / absent = settle the whole open balance (unchanged behaviour).
          ...(ctx.amount != null ? { amount: ctx.amount } : {}),
          // Idempotency: a double tap or a retried POST must not book twice.
          ...(ctx.clientKey ? { clientKey: ctx.clientKey } : {}),
          // [HAND-DUBBEL] Alleen na een uitdrukkelijk ja — zie de tak bij de weigering hieronder.
          ...(force ? { force: true } : {}),
        }),
      })
    } catch {
      // The request never completed. It may or may not have reached the server, and we cannot
      // know which — so say exactly that instead of guessing, and put the row back as it was.
      if (!isPartialIntent) updateOptimistic(ctx.id, { status: ctx.newStatus === 'paid' ? 'sent' : 'paid' })
      showToast(t('lijst.fout.betalingOffline'))
      setProcessingId(null)
      return
    }
    const json = await res.json().catch(() => ({} as { error?: string }))
    // [DEPLOY-SAFE] Prefer the server's own sentence when it has one (e.g. a partial cash
    // payment refused because the kasboek cannot date it per instalment yet) — the bare
    // error CODE would reach the owner as gibberish.
    //
    // [PAY-REDEN] …which is what `detail || json.error` did for every refusal that carries no
    // detail: "invoice_already_paid", "not_payable", "unauthorized" went straight to the toast.
    // The rule is shared now (pay-toggle-reason.ts), so this screen, /vandaag and /manage answer
    // the same refusal with the same words, and the half that is not the server's sentence comes
    // from the catalogue in the owner's language.
    if (!res.ok) {
      const answer = payToggleAnswer(res.status, json)
      const message = answer.kind === 'server' ? answer.text : t(answer.key)
      const prev = ctx.newStatus === 'paid' ? 'sent' : 'paid'
      if (!isPartialIntent) updateOptimistic(ctx.id, { status: prev })
      // [BOEK-004] verwerkt conflict (trigger) → show actionable dialog; else toast.
      //
      // [PAY-REDEN] Decided from the CODE, not by searching the displayed message for the word
      // "verwerkt". That search was two bugs waiting: the dialog stops opening the moment the
      // message is translated — no Arabic sentence contains a Dutch word — and it opens wrongly
      // for any other refusal whose sentence happens to mention the boekhouder.
      if (isVerwerktConflict(json)) {
        setRequestSent(false)
        setVerwerktCtx({ id: ctx.id, number: ctx.number })
      } else if (isDuplicatePaidConflict(json)) {
        // [HAND-DUBBEL] Geen storing en geen verbod: dit factuurnummer staat al ergens anders
        // betaald. Twee van de drie dubbele boekingen in de live administratie zijn zo ontstaan —
        // de ondernemer tikte "betaald" op een tweede lezing van een document dat de bank al had
        // afgeschreven. De server ziet dat nu; dit scherm moet het vrágen.
        //
        // Vragen en niet weigeren, want welke van twee lezingen de echte factuur is, is een vraag
        // over papier — en op het Enka-paar was de kopie die ons goed leek juist de verkeerde. De
        // optimistische status is hierboven al teruggezet; een tweede ronde zet hem opnieuw.
        setProcessingId(null)
        const toch = await dialog.confirm({
          title: t('ink.dubbelBetaald.kop'),
          message,
          confirmLabel: t('ink.dubbelBetaald.tochBoeken'),
        })
        if (toch) return executePay(ctx, true)
        return
      } else {
        showToast(message)
      }
    } else if (ctx.newStatus === 'paid') {
      // [MANUAL-PARTIAL-PAY] The SERVER decides whether this settled the invoice — the typed
      // amount may have completed it (last instalment) even though the owner typed a number.
      const partial = (json as { partial?: boolean }).partial === true
      const amountPaidNow = (json as { amountPaid?: number }).amountPaid
      const remaining = (json as { remaining?: number }).remaining ?? 0
      if (partial) {
        updateOptimistic(ctx.id, { amount_paid: amountPaidNow ?? null })
        showToast(t('lijst.deelGenoteerd', { applied: fmtEur((json as { applied?: number }).applied ?? 0), remaining: fmtEur(remaining) }))
      } else if (ctx.invoiceType === 'creditnota') {
        updateOptimistic(ctx.id, { status: 'paid' })
        showToast(t('lijst.creditnotaVoldaan', { number: ctx.number }))
      } else {
        updateOptimistic(ctx.id, { status: 'paid' })
        // Notification insert needs service role (RLS blocks client insert) → API route
        try {
          await fetch('/api/notifications/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Factuur betaald', // [TAAL-DB] stored notification content — Dutch by design
              body: `Factuur ${ctx.number} is gemarkeerd als betaald.`, // [TAAL-DB] stored notification content — Dutch by design
              type: 'payment',
              // [BRIDGE-NOTIF] dead-click fix: open the invoices list.
              // [MELDING-TIK] En nu de factuur zelf. De lijst was al beter dan niets — dat was de
              // hele dead-click fix — maar ctx.id staat hier, dus de melding kan de eigenaar op de
              // factuur zetten waar hij over gaat in plaats van op een scherm waarop hij hem
              // vervolgens zoekt tussen alle andere.
              link: `/dashboard/invoice/${ctx.id}`,
            }),
          })
        } catch { /* non-blocking — payment already succeeded */ }
        showToast(t('lijst.factuurBetaald', { number: ctx.number }))
      }
    } else {
      // [PARTIAL-PAY] An undo also clears every recorded instalment server-side
      // (pay-toggle → recompute_invoice_amount_paid). Without mirroring that here, a
      // previously part-paid invoice came back as 'sent' while the row still held the old
      // amount_paid: openAmount() then reported a smaller balance than is really open, the
      // row read "Deels betaald · € X open" for a payment that no longer exists, and the pay
      // dialog capped the owner at that invented remainder.
      updateOptimistic(ctx.id, { amount_paid: 0 })
    }
    setProcessingId(null)
  }

  // [BOEK-004] Ask the linked accountant to undo "verwerkt" so payment can change.
  async function requestUnverwerkt() {
    if (!verwerktCtx || !profile?.id) return
    // find the linked accountant for this client
    const { data: link } = await supabase
      .from('accountant_clients')
      .select('accountant_id')
      .eq('zzper_id', profile.id)
      .limit(1)
      .maybeSingle()

    if (!link?.accountant_id) {
      showToast(t('lijst.boekhouder.geen'))
      setVerwerktCtx(null)
      return
    }

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiver_id: link.accountant_id,
        content: `Verzoek: maak de verwerking van factuur ${verwerktCtx.number} ongedaan, zodat ik de betaalstatus kan aanpassen.`, // [TAAL-DB] message to the boekhouder — Dutch by design
      }),
    })

    if (res.ok) {
      setRequestSent(true)
    } else {
      showToast(t('lijst.fout.versturen'))
    }
  }

  // ── [HERHAAL] Repeat this invoice every week / month / quarter / year ──────────────────────
  // The invoice they already sent IS the definition of what is billed, so starting a repeat is
  // one tap on a row that already exists — no template to fill in, no second copy of the client
  // and the lines to keep in sync. Each occurrence arrives as a CONCEPT; sending stays the
  // owner's act, because that is where the invoice number is minted and where a document goes to
  // a third party for real.
  async function startRepeat(cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly') {
    if (!repeatCtx) return
    const ctx = repeatCtx
    setRepeatCtx(null)
    setProcessingId(ctx.id)
    try {
      const res = await fetch('/api/invoice/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: ctx.id, cadence }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        // [TAAL] One key per cadence — the cadence word is not a parameter.
        const key: MessageKey = cadence === 'weekly' ? 'lijst.gestart.week' : cadence === 'monthly' ? 'lijst.gestart.maand'
          : cadence === 'quarterly' ? 'lijst.gestart.kwartaal' : 'lijst.gestart.jaar'
        showToast(t(key, { date: fmtDate(json?.schedule?.next_run_date ?? null) }))
        await loadSchedules()
      } else {
        showToast(failureText(res.status, json, t('lijst.fout.herhalen')))
      }
    } catch {
      showToast(t('lijst.fout.herhalen'))
    } finally {
      setProcessingId(null)
    }
  }

  async function stopRepeat(scheduleId: string) {
    setRepeatCtx(null)
    try {
      const res = await fetch(`/api/invoice/schedules?id=${encodeURIComponent(scheduleId)}`, { method: 'DELETE' })
      if (res.ok) {
        showToast(t('lijst.herhalen.gestopt'))
        await loadSchedules()
      } else {
        const j = await res.json().catch(() => ({}))
        showToast(failureText(res.status, j, t('lijst.fout.stoppen')))
      }
    } catch { showToast(t('lijst.fout.stoppen')) }
  }

  // [HERHAAL] Pause is the button an owner actually reaches for. A customer goes quiet for a
  // month, a project is on hold — stopping means losing the schedule and rebuilding it later
  // from an invoice that has meanwhile scrolled away. Pausing keeps it, and the cron simply
  // produces nothing while it is off.
  async function toggleRepeat(scheduleId: string, active: boolean) {
    try {
      const res = await fetch('/api/invoice/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId, active }),
      })
      if (res.ok) {
        showToast(active ? t('lijst.herhalen.hervat') : t('lijst.herhalen.gepauzeerd'))
        await loadSchedules()
      } else {
        const j = await res.json().catch(() => ({}))
        showToast(failureText(res.status, j, active ? t('lijst.fout.hervatten') : t('lijst.fout.pauzeren')))
      }
    } catch { showToast(active ? t('lijst.fout.hervatten') : t('lijst.fout.pauzeren')) }
  }

  // ── [INVOICE-REMOVE] "Verwijderen" — one button, four honest outcomes ──────────────────────
  // The owner taps once; decideRemoval says what that means for THIS invoice, the dialog shows
  // it in full, and only then does anything happen. Nothing here decides policy — that lives in
  // invoice-removal.ts and is re-checked by the server, which never trusts this decision.
  // [BESTE] "Nog een keer": the duplicate door already existed (BOEK-003) and nothing called it.
  // A new concept with this customer and these lines, opened for editing — the number falls at
  // sending, through the owner's own series, so nothing is issued here.
  async function handleDuplicate(id: string) {
    try {
      const res = await fetch(`/api/invoice/${id}/duplicate`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.invoiceId) { showToast(failureText(res.status, json, t('lijst.kopieMaken.mislukt'))); return }
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      showToast(t('lijst.kopieMaken.mislukt'))
    }
  }

  function handleRemoveRequest(inv: RemovalInvoice & { id: string }) {
    setRemoveCtx({ id: inv.id, decision: decideRemoval(inv) })
  }

  async function executeRemoval(ctx: RemoveCtx) {
    const { id, decision } = ctx
    setRemoveCtx(null)

    // A dead end (paid, verwerkt): the dialog has already explained it. The confirm button is
    // just "Sluiten" — except for a paid sale, where the way forward IS the creditnota.
    if (!decision.allowed) {
      // [COHERENCE-CREDITNOTA] Open the real creditnota dialog on the invoice detail — it copies
      // the lines and keeps original_invoice_id, unlike a blank new-invoice form.
      if (decision.mode === 'creditnota') router.push(`/dashboard/invoice/${id}?action=credit`)
      return
    }

    if (decision.mode === 'delete') {
      // A concept was never a bookkeeping record — really gone, lines and all.
      //
      // [DELETE-CHECKED] Via the audited route, and the answer is READ. The old code deleted
      // invoice_lines and then invoices straight from the browser, checked neither result, and
      // toasted 'Verwijderd' unconditionally. That is only harmless while the two RLS policies
      // agree — and they do not: invoice_lines_delete_own has no status test, invoices_zzp_delete
      // permits status='draft' only. Anything else lost its LINES and kept its row, while the
      // screen said it was gone. The route refuses non-drafts with 409 and a sentence, so a
      // mismatch now surfaces instead of destroying data quietly.
      setProcessingId(id)
      try {
        const res = await fetch(`/api/invoice/${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          showToast(failureText(res.status, json, t('lijst.fout.verwijderenVervers')))
          await refresh()
          return
        }
        removeOptimistic(id)
        showToast(t('lijst.verwijderd'))
      } catch {
        showToast(t('lijst.fout.verwijderenOffline'))
      } finally {
        setProcessingId(null)
      }
      return
    }

    setProcessingId(id)
    try {
      const res = await fetch(`/api/invoice/${id}/archive`, {
        method: decision.mode === 'restore' ? 'PATCH' : 'POST',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server checked the same rules against fresher data and said no. Show ITS reason.
        showToast(failureText(res.status, json, t('lijst.fout.verwijderenVervers')))
        await refresh()
        return
      }
      setArchivedTick(t => t + 1) // the archief list is the undo — keep it current
      if (decision.mode === 'restore') {
        showToast(t('lijst.teruggezet'))
      } else {
        removeOptimistic(id)
        // Consequences the row could not show: a filed BTW quarter that now differs, a bundled
        // payment link that stopped working. Said out loud, once, instead of discovered later.
        const notices: string[] = Array.isArray(json?.notices) ? json.notices : []
        showToast(notices.length > 0 ? notices[0] : t('lijst.verwijderdTerug'))
      }
      await refresh()
    } catch {
      showToast(t('lijst.fout.verwijderen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BOEK-029] Versturen flow — open modal with client details
  // [BOEK-RESEND] isResend=true when re-sending an already-sent invoice.
  // [OFFERTE-VERSTUREN] De offerte ALS offerte naar de klant. Een eigen route die geen nummer kan
  // slaan — zie de kop van /api/invoice/[id]/send-offerte. Geen bevestigingsdialoog: er valt niets
  // onomkeerbaars te bevestigen. Dat is precies het verschil met de knop ernaast.
  async function handleSendOfferte(invoiceId: string) {
    if (processingId) return
    setProcessingId(invoiceId)
    try {
      const res = await fetch(`/api/invoice/${invoiceId}/send-offerte`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        showToast(typeof json?.message === 'string' ? json.message : t('lijst.offerteVerstuurd'))
        await refresh()
      } else {
        // De route weigert met een eigen zin per reden (geen e-mailadres, geen regels, al omgezet).
        // Die tonen, niet vervangen door "mislukt": vier redenen vragen vier verschillende dingen
        // van de ondernemer.
        showToast(failureText(res.status, json, t('lijst.fout.offerteVersturen')))
      }
    } catch {
      showToast(t('lijst.fout.versturenStraks'))
    } finally {
      setProcessingId(null)
    }
  }

  async function handleSendRequest(invoiceId: string, isResend = false) {
    // Fetch full data to verify required fields before showing modal
    const { data: inv } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_type, client_name, client_email, total_inc_btw, status')
      .eq('id', invoiceId)
      .single()

    if (!inv) { showToast(t('lijst.fout.nietGevonden')); return }
    if (!inv.client_email) { showToast(t('lijst.fout.klantEmail')); return }
    if (!inv.client_name)  { showToast(t('lijst.fout.klantNaam')); return }
    // [BOEK-029 v2] invoice_number check REMOVED — generated by /api/invoice/send
    // Drafts may have null invoice_number until sent. — May 2026

    // [OFFERTE-GEEN-OMZETTING] A quote no longer reaches this modal: the list offers it no send
    // button, and the send route refuses it before minting anything.
    setSendCtx({
      id: inv.id,
      number: inv.invoice_number ?? '',
      clientName: inv.client_name,
      clientEmail: inv.client_email,
      totalIncBtw: inv.total_inc_btw ?? 0,
      invoiceType: inv.invoice_type ?? 'factuur',
      prevStatus: inv.status ?? 'draft',
      isResend,
    })
  }

  // [BOEK-029] Versturen execute — call /api/invoice/send
  async function executeSend(ctx: SendCtx) {
    setSendCtx(null); setProcessingId(ctx.id)
    // Optimistic — flip status immediately (a resend stays/returns to 'sent')
    updateOptimistic(ctx.id, { status: 'sent' })
    try {
      const res = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // [BOEK-RESEND-FIX] forward the resend flag — without it the route treats
        // an already-sent invoice as a first send and 400s ("al verzonden").
        body: JSON.stringify({ invoiceId: ctx.id, resend: ctx.isResend }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t('lijst.fout.verzenden') }))
        // [BOEK-RESEND] rollback to the ORIGINAL status (draft for a first send,
        // sent/overdue for a resend) — never wrongly downgrade a sent invoice.
        updateOptimistic(ctx.id, { status: ctx.prevStatus })
        showToast(failureText(res.status, err, t('lijst.fout.verzenden')))
      } else {
        // [BOEK-031 FIX] Get generated invoice_number + invoice_type from API response
        // Pro forma → factuur conversion: both number and type change
        const result = await res.json().catch(() => ({}))
        updateOptimistic(ctx.id, {
          ...(result.invoice_number ? { invoice_number: result.invoice_number } : {}),
          ...(result.invoice_type   ? { invoice_type: result.invoice_type }     : {}),
        })
        const displayNumber = result.invoice_number || ctx.number
        // [SEND-PDF-HONEST] A pdf_failed response means the number was issued but the PDF/email did
        // NOT go out — never toast "verzonden ✓". Tell the owner to resend so the state is honest.
        //
        // [SEND-EMAIL-HONEST] email_failed is the SAME class of half-success and was falling
        // through to the "verzonden ✓" branch: the route issues the legal number, builds the PDF,
        // and only then fails to hand it to the mail provider — it carries no `delivered: false`,
        // so the old test missed it. The owner was told a legally-numbered invoice had reached
        // their customer when nothing left the building. /dashboard/invoice/new already handled
        // both warnings together; this page did not.
        // [VERSTUURD-EERLIJK] The three spellings above — two warning names and the older
        // `delivered === false` — were this screen's own copy of the rule, and the comment above
        // records what that cost: the same defect had to be found here after it was fixed on
        // /dashboard/invoice/new. One module answers now, and the message is all this screen picks.
        const bezorgFout = deliveryFailure(result)
        if (bezorgFout) {
          showToast(
            bezorgFout === 'email_failed'
              ? (displayNumber
                  ? t('lijst.emailNietVerstuurd', { number: displayNumber })
                  : t('lijst.emailNietVerstuurdZonder'))
              : displayNumber
                ? t('lijst.pdfNietGemaakt', { number: displayNumber })
                : t('lijst.pdfNietGemaaktZonder')
          )
        } else {
          showToast(
            ctx.isResend
              ? (displayNumber ? t('lijst.opnieuwVerzonden', { number: displayNumber }) : t('lijst.opnieuwVerzondenZonder'))
              : (displayNumber ? t('lijst.verzonden', { number: displayNumber }) : t('lijst.verzondenZonder'))
          )
        }
      }
    } catch {
      // [BOEK-RESEND] rollback to original status on network failure too
      updateOptimistic(ctx.id, { status: ctx.prevStatus })
      showToast(t('lijst.fout.verbinding'))
    } finally {
      setProcessingId(null)
    }
  }

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current; if (!el) return
    // [SEARCH] Don't paginate the infinite list while a server search is active.
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && hasMore && !loading && !searching) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, searching, loadMore])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Filters toolbar ── [SUBNAV] back + "Mijn facturen" title now come from
          the shared sub-page header (see DashboardChrome); this block keeps the
          page's own controls (sort/refresh/search/filter) and sticks directly
          BELOW the shared bar via top: calc(56px + safe-area). */}
      <div ref={toolbarRef} style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px', position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 40,
      }}>
        {/* [BAR-ALIGN] The bar's SHELL still spans the viewport — the blur and the
            hairline under it should. Its contents must not: unconstrained, the
            search field and the filter dropdown grew to the full width of the
            screen (~1870px on a desktop) above a 680px list, and the sort/refresh
            buttons parked themselves against the right edge, hundreds of pixels
            from the rows they act on. Nothing in the toolbar lined up with
            anything in the list. This column matches <main> below exactly, and the
            selection bar at the bottom of the file was already doing it. */}
        <div style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto' }}>
          {/* [BALK-EEN-REGEL] Filter, search and the three buttons on ONE line. They stood
              stacked — buttons, then a full-width search, then a full-width filter — three
              rows of chrome above a list that is the point of the screen. The owner asked for
              one line. Source order is filter, search, buttons, so in a right-to-left screen
              the buttons pack to the left and the filter sits at the right, which is where
              each already was. Floors and wrap: on a narrow phone the search takes its own
              line instead of all three shrinking to nothing. The filter menu is anchored to
              its own third, which is wide enough for every label it holds. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* [BOEK-029] Filter dropdown — works on all screen sizes */}
          <div style={{ position: 'relative', flex: '1 1 150px', minWidth: 0 }}>
            <button
              onClick={() => setShowFilterMenu(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 14px',
                background: M3.primaryContainer, borderRadius: R.md,
                border: 'none', cursor: 'pointer', fontFamily: FONT,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: M3.onPrimaryContainer }}>
                {t(FILTERS.find(f => f.id === filter)?.key ?? 'filter.all')}
              </span>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.onPrimaryContainer }} aria-hidden>
                {showFilterMenu ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {showFilterMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                background: '#fff', borderRadius: R.md, marginTop: 4,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                overflow: 'hidden',
              }}>
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setFilter(f.id); setShowFilterMenu(false) }}
                    style={{
                      display: 'block', width: '100%', padding: '12px 16px',
                      textAlign: 'start', border: 'none', cursor: 'pointer',
                      fontFamily: FONT, fontSize: 14,
                      fontWeight: filter === f.id ? 600 : 400,
                      background: filter === f.id ? M3.primaryContainer : '#fff',
                      color: filter === f.id ? M3.onPrimaryContainer : M3.onSurface,
                      borderBottom: '0.5px solid #F1F3F4',
                    }}
                  >
                    {t(f.key)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* [SEARCH] Quick text-filter (invoice number / client name)
              [SMART-FILTER] …and the amount: the server query below also matches
              total_inc_btw, so the placeholder names "bedrag" too. */}
          <div style={{ position: 'relative', flex: '2 1 220px', minWidth: 0 }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#5F6368' }} aria-hidden>search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('lijst.zoek')}
              aria-label={t('lijst.zoek.aria')}
              style={{ width: '100%', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: '10px 40px 10px 40px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label={t('lijst.zoek.wissen')}
                style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 22, height: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f6368' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>close</span>
              </button>
            )}
          </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {/* [BUNDEL-BETAALVERZOEK] Toggle multi-select — pick several open
                  facturen of één klant and mint one payment link for the sum. */}
              <button onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                style={{ background: selectMode ? M3.primaryContainer : M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: selectMode ? M3.onPrimaryContainer : '#5f6368', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>checklist</span>
                {selectMode ? t('lijst.klaar') : t('lijst.selecteer')}
              </button>
              {/* Sort */}
              <button onClick={() => setSort(s => s === 'desc' ? 'asc' : 'desc')}
                style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#5f6368', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>{sort === 'desc' ? 'arrow_downward' : 'arrow_upward'}</span>
                {sort === 'desc' ? t('lijst.nieuwste') : t('lijst.oudste')}
              </button>
              {/* Refresh */}
              <button onClick={refresh} aria-label={t('lijst.vernieuwen')} style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5f6368' }} aria-hidden>{refreshing ? 'hourglass_empty' : 'refresh'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Invoice list ── */}
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '12px 16px 100px' }}>
        {/* [GEEN-BEWIJSPANEEL] The open-invoice proof panel stood here — how many sales invoices
            were held against how many bank lines, and the incoming payments that matched no
            invoice. The owner asked for it to go from this screen. It still stands on the pay
            screen for the purchase side; the sales-side sentence it carried (payments in the
            bank that belong to no invoice) is now said nowhere, which is a known gap and the
            Bank page is where it belongs if it comes back. */}

        {/* [BESTE] The two numbers every package puts above its sales list: what is still to come
            in, and how much of it is late. Tapping the late one opens that filter. Hidden when
            nothing is open — a row of zeros is noise — and when the server could not count. */}
        {totals && totals.open + totals.overdue > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, background: M3.surface, borderRadius: R.md, border: `1px solid ${M3.outlineVariant}`, padding: '10px 14px' }}>
              <div style={{ fontSize: 11.5, color: M3.neutral }}>{t('lijst.kop.openstaand')} · {totals.open + totals.overdue === 1 ? t('lijst.kop.een') : t('lijst.kop.aantal', { n: totals.open + totals.overdue })}</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 17, fontWeight: 700, color: M3.onSurface }}>{fmtEur(totals.outstanding)}</div>
            </div>
            {totals.overdue > 0 && (
              <button onClick={() => setFilter('overdue')} style={{ flex: 1, textAlign: 'start', cursor: 'pointer', fontFamily: FONT, background: M3.errorContainer, borderRadius: R.md, border: 'none', padding: '10px 14px' }}>
                <div style={{ fontSize: 11.5, color: '#8C1D18' }}>{t('lijst.kop.teLaat')} · {totals.overdue === 1 ? t('lijst.kop.een') : t('lijst.kop.aantal', { n: totals.overdue })}</div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 17, fontWeight: 700, color: M3.error }}>{fmtEur(totals.overdueAmount)}</div>
              </button>
            )}
          </div>
        )}

        {/* [NO-SILENT-EMPTY] The credit read did not answer, and this list cannot say what it
            normally says. Every amount below may be too high and the withdrawn-invoice chips are
            missing — so an invoice the owner formally credited looks completely chaseable, which
            is the one direction this screen may not fail in quietly. The list still renders
            (a stale list beats a blank one); it just stops claiming to be right about credits. */}
        {creditsReadFailed && (
          <div role="status" style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
            padding: '11px 13px', borderRadius: R.md, fontFamily: FONT,
            border: '1px solid #F5C6C0', background: '#FCE8E6',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.error, flexShrink: 0, marginTop: 1 }} aria-hidden>error</span>
            <p style={{ fontSize: 12.5, color: '#8C1D18', margin: 0, lineHeight: 1.5 }}>
              {t('credit.leesFout')}
            </p>
          </div>
        )}

        {/* [HERHAAL] Everything that repeats, in one place at the top.
            The per-row button can only be found by finding the invoice, and the invoice that
            started a monthly series is a year older every twelve concepts. This panel is the
            answer to "wat staat er eigenlijk aan?" and to "hoe zet ik het uit?", and it is
            deliberately ABOVE the list: something the app does on its own belongs in sight.
            Hidden entirely when nothing repeats, and while searching (the results are the
            answer to a different question). */}
        {/* ── [RUST] Eén regel boven het paneel ───────────────────────────────────────────
            Het paneel hieronder is ongewijzigd; het staat alleen niet meer standaard open. Wat
            uit zichzelf facturen maakt hoort in zicht te blijven, dus de telling staat in de regel
            en de knoppen om te pauzeren of te stoppen zijn één tik weg — niet twee, en niet
            achter een filtertab. */}
        {!searching && scheduleList.length > 0 && (() => {
          const actief = scheduleList.filter(sc => sc.active).length
          const regel = actief > 0
            ? (actief === 1 ? t('lijst.herhaal.loopt') : t('lijst.herhaal.lopen', { n: actief }))
            : (scheduleList.length === 1
                ? t('lijst.herhaal.stilEen')
                : t('lijst.herhaal.stil', { n: scheduleList.length }))
          return (
            <button
              onClick={() => setShowHerhaal(v => !v)}
              aria-expanded={showHerhaal}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', marginBottom: showHerhaal ? 8 : 14, padding: '9px 14px', borderRadius: R.md, border: '1px solid #E8EAED', background: '#fff', color: '#5F6368', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 500, textAlign: 'start' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: actief > 0 ? '#137333' : '#80868B', flexShrink: 0 }} aria-hidden>autorenew</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{regel}</span>
              </span>
              <span
                className="material-symbols-outlined"
                aria-label={showHerhaal ? t('lijst.herhaal.verberg') : t('lijst.herhaal.toon')}
                style={{ fontSize: 18, flexShrink: 0 }}
                aria-hidden>
                {showHerhaal ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )
        })()}
        {!searching && showHerhaal && scheduleList.length > 0 && (
          <div style={{ background: '#fff', borderRadius: R.md, border: '1px solid #E8EAED', padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#137333' }} aria-hidden>autorenew</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, fontFamily: FONT }}>
                {t('lijst.herhalen')}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#5F6368', lineHeight: 1.5, marginBottom: 10, fontFamily: FONT }}>
              {t('lijst.herhalen.uitleg')}
            </div>
            {scheduleList.map(sc => (
              <div key={sc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid #F1F3F4' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: sc.active ? M3.onSurface : '#5F6368', fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sc.source?.client_name ?? t('lijst.onbekendeKlant')}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#5F6368', fontFamily: FONT }}>
                    {sc.active
                      ? t(CADENCE_ACTIVE_KEY[sc.cadence], { date: fmtDate(sc.next_run_date) })
                      : t(CADENCE_PAUSED_KEY[sc.cadence])}
                    {sc.source?.invoice_number ? ` · ${sc.source.invoice_number}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => toggleRepeat(sc.id, !sc.active)}
                    style={{ fontSize: 12.5, color: M3.onPrimaryContainer, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT }}>
                    {sc.active ? t('lijst.pauzeer') : t('lijst.hervat')}
                  </button>
                  <button
                    onClick={() => stopRepeat(sc.id)}
                    style={{ fontSize: 12.5, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT }}>
                    {t('lijst.herhalen.stopKort')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {(searching ? searchLoading : loading) && sorted.length === 0 ? (
          <SkeletonList />
        ) : sorted.length === 0 ? (
          searching ? (
            <p style={{ textAlign: 'center', color: '#5F6368', fontSize: 14, padding: '48px 16px', fontFamily: FONT }}>
              {t('lijst.zoek.geen', { query: search.trim() })}
            </p>
          ) : typeFiltered && (hasMore || loading) ? (
            // [TAB-DRAIN] Older pages are still being pulled in — an honest
            // "searching" state, never a false "Geen facturen" while matches
            // may exist further back.
            <p style={{ textAlign: 'center', color: '#5F6368', fontSize: 14, padding: '48px 16px', fontFamily: FONT }}>
              {t('lijst.zoek.ouder')}
            </p>
          ) : <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(inv => {
              const isCredit  = inv.invoice_type === 'creditnota'
              const isOfferte = inv.invoice_type === 'pro_forma'
              const isPaid    = inv.status === 'paid'
              const expanded  = expandedId === inv.id
              const totalExBtw = inv.total_ex_btw ?? null
              const btwAmount = inv.btw_amount ?? (typeof inv.total_inc_btw === 'number' && typeof totalExBtw === 'number'
                ? inv.total_inc_btw - totalExBtw
                : null)
              const invoiceType = inv.invoice_type === 'creditnota' ? 'creditnota'
                : inv.invoice_type === 'pro_forma' ? 'pro_forma'
                : 'factuur'

              // [CROSS-QUARTER] Only a paid invoice whose money actually moved in a different
              // quarter than its invoice date gets the marker — accrual is unchanged, this is
              // purely "when was it settled". null (no marker) for everything else.
              const xq = isPaid ? crossQuarterPayment(inv.invoice_date, inv.payment_date) : null

              // Row tint
              const rowBg = isCredit ? '#FFF8F0' : isOfferte ? '#F8F9FA' : '#fff'

              // [OVERDUE-DERIVED] What the row should SAY it is — 'overdue' exists only as a
              // derivation, never as a stored status.
              const displayStatus = getDisplayStatus(inv)

              return (
                <div
                  key={inv.id}
                  // [LIST-PAINT] Off-screen rows may skip style/layout/paint — see globals.css.
                  // This list is the longest one in the app: the read caps at 2000 invoices, and
                  // a sole trader who invoices weekly reaches four figures in a few years. The row
                  // stays in the DOM either way; only the painting is skipped.
                  className="inv-card"
                  ref={el => { rowRefs.current[inv.id] = el }}
                  style={{
                    borderRadius: R.lg,
                    overflow: 'hidden',
                    boxShadow: highlightId === inv.id ? `0 0 0 2px ${M3.primary}, ${EL1}` : EL1,
                    transition: 'box-shadow 0.4s ease',
                  }}
                >
                  {/* Main row — in select mode a tap toggles the bundle selection
                      (only for open verkoopfacturen); otherwise it expands. */}
                  <div
                    className="inv-row"
                    onClick={onRowTap(() => selectMode
                      ? toggleSelect(inv)
                      : setExpandedId(expanded ? null : inv.id))}
                    // [ROW-LAYOUT] display/align/gap live in the .inv-row class (globals.css) so
                    // the stack-on-mobile media query can override them; only dynamic styles here.
                    style={{ background: selected[inv.id] ? M3.primaryContainer : highlightId === inv.id ? M3.primaryContainer : rowBg, padding: '14px 16px', cursor: 'pointer', transition: 'background 0.4s ease' }}
                  >
                    {/* [BUNDEL-BETAALVERZOEK] selection indicator */}
                    {/* [BULK-PDF] Every row is selectable now. Downloading must work for anything —
                        a paid invoice, a creditnota — so the betaalverzoek refuses on the BUTTON
                        what it used to refuse through the selection. Same rule, said out loud: a
                        guard that exists only because a row cannot be ticked is exactly the kind
                        that disappears later without anyone noticing. */}
                    {selectMode && (
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: selected[inv.id] ? M3.primary : '#9AA0A6', flexShrink: 0 }} aria-hidden>
                        {selected[inv.id] ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                    )}
                    <div className="inv-row-main">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM }}>{inv.invoice_number ?? '—'}</p>
                        <CopyButton value={inv.invoice_number} what={t('kopieer.wat.factuurnummer')} />
                        <InvoiceTypeBadge type={invoiceType} />
                        {/* Status chip — [OVERDUE-DERIVED] 'overdue' is never STORED (see the
                            note in api/bank/unlink): it is derived from sent + due_date in the
                            past, exactly as the Verlopen tab's own query derives it. Reading
                            inv.status raw therefore labelled every row in that tab a blue
                            "Verzonden" — the list said overdue, each row denied it. getDisplayStatus
                            is the shared derivation the row component already exports. */}
                        {isInvoiceStatus(displayStatus) && (() => {
                          const chip = statusChip(displayStatus, taal)
                          return (
                            <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: chip.bg, color: chip.color }}>
                              {chip.label}
                            </span>
                          )
                        })()}
                        {/* [ACTING-FOR] Wie maakte deze factuur? Alleen zichtbaar als dat NIET de
                            eigenaar zelf was — anders staat er op elke rij een naam die niets
                            toevoegt. Dit is de leesbare kant van created_by; zonder deze chip
                            werd het spoor wel geschreven en nooit gelezen. */}
                        {makers[inv.id] && (
                          <span
                            title={t('lijst.aangemaaktDoor', { name: makers[inv.id] })}
                            style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: '#F3E5F5', color: '#6A1B9A', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>person</span>
                            {makers[inv.id]}
                          </span>
                        )}
                        {recon[inv.id] && (
                          <ReconBadge recon={recon[inv.id]} mode="zzp" invoiceId={inv.id} onReconConfirm={async (id) => {
                            // [BANK-RECON-CONFIRM] Book a safe (reference-backed) match in one tap;
                            // an amount-only match ('navigate') opens the bank page to review.
                            const r = await confirmMatch(id)
                            if (r === 'ok') { showToast(t('lijst.betalingBevestigd')); refresh() }
                            else if (typeof r === 'object' && r.navigate) router.push(r.txId ? `/dashboard/bank/verdelen/${r.txId}` : '/dashboard/bank')
                            else showToast(t('lijst.fout.bevestigen'))
                          }} />
                        )}
                        {xq && (
                          <span
                            title={t('lijst.kwartaal.uitleg', { booked: xq.bookedQuarterLabel, paid: xq.paidQuarterLabel })}
                            style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: '#FFF3E0', color: '#B26A00', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>event_available</span>
                            {t('lijst.betaaldIn', { quarter: xq.paidQuarterLabel })}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.client_name ?? '—'} · {fmtDate(inv.invoice_date)}
                      </p>

                      {/* [BETAALBEWIJS] Under the claim, how we know it.
                          The direction comes from moneyDirection(), not from the list this row is
                          on. Every row here is an OUTGOING document, but a creditnota moves money
                          the other way: the owner refunds the customer. Hard-coded 'outgoing', a
                          refund of € 500 rendered as "bijgeschreven … van Kiwi Food Market" beside
                          a bank line of −500 — money leaving, described as money arriving, on the
                          one line that exists to be believed. */}
                      <PaymentEvidenceLine line={buildPaymentEvidenceLine(paymentEvidence[inv.id], moneyDirection(inv), taal, inv)} />

                      {/* [CREDIT-BEWIJS] …and which credit notes reduced it. The chip beside the
                          amount states "Deels gecrediteerd · € 250"; this states the documents
                          that produced it, by number and date. They are papers the OWNER sent, and
                          an accountant asks about them by number — so the app was already holding
                          this and simply never showed it. It sits here rather than beside the chip
                          because the chip column is one nowrap line wide. */}
                      <CreditEvidenceLine line={buildCreditEvidenceLine(creditRows.get(inv.id), taal)} />
                    </div>

                    {/* [ROW-LAYOUT] flex column/align/gap/shrink live in .inv-row-side (globals.css)
                        so the media query can flip it to a full-width strip on a phone. */}
                    <div className="inv-row-side">
                      {/* [BOEK-029] Amount: always total_inc_btw — never total_ex_btw */}
                      <p style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>

                      {/* [CREDITNOTA-NO-CHASE] Withdrawn with a creditnota. The invoice keeps
                          its 'Verzonden' chip on purpose (the +omzet stays, netted by the
                          creditnota), so without this the owner sees an invoice that is never
                          chased and never counted in Te ontvangen, with nothing explaining why.
                          [DEEL-CREDIT] Only when the credits cover the WHOLE invoice: this chip's
                          own tooltip promises it is no longer chased and no longer counts as
                          outstanding, and on a partly credited invoice both halves are false. */}
                      {isVolledigGecrediteerd(inv) && (
                        <span
                          title={t('lijst.gecrediteerd.uitleg')}
                          style={{
                            fontSize: 11, fontWeight: 600, color: '#5F6368', background: M3.surfaceVariant,
                            border: '1px solid #DADCE0', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap',
                          }}
                        >
                          {t('lijst.gecrediteerd')}
                        </span>
                      )}

                      {/* [DEEL-CREDIT] Partly credited — a state of its own, and it needs its own
                          words. Silence would leave the owner with an invoice whose amount no
                          longer matches what anyone owes, and the withdrawn chip would tell them
                          to stop expecting money they are still owed. So it names the amount that
                          came back, and the headline total above it stays what was invoiced. */}
                      {!isVolledigGecrediteerd(inv) && gecrediteerdOp(inv.id) > 0 && (
                        <span
                          title={t('lijst.deelsGecrediteerd.uitleg', { bedrag: fmtEur(gecrediteerdOp(inv.id)) })}
                          style={{
                            fontSize: 11, fontWeight: 600, color: '#5F6368', background: M3.surfaceVariant,
                            border: '1px solid #DADCE0', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap',
                          }}
                        >
                          {t('lijst.deelsGecrediteerd', { bedrag: fmtEur(gecrediteerdOp(inv.id)) })}
                        </span>
                      )}

                      {/* [PARTIAL-PAY] Deelbetaling — part settled, rest still openstaand. The
                          headline amount stays the invoice total (same as the incoming side);
                          this chip carries what is actually still owed. Only for the genuine
                          in-between state — a fully open or completed invoice has clearer UI.
                          [DEEL-CREDIT] Suppressed only for a WITHDRAWN invoice. A partly credited
                          one is exactly where this line is needed most, and it was the one place
                          it was hidden — together with the tap target that records the next
                          instalment. */}
                      {isPartiallyPaid(inv, gecrediteerdOp(inv.id)) && !isVolledigGecrediteerd(inv) && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            // The chip IS the way back in: tapping it reopens the same dialog,
                            // now offering the REMAINING balance. Recording the next instalment
                            // (or finishing the invoice) is one tap from where the owner reads it.
                            // [DEEL-CREDIT] Net of the credit — the chip printed two lines above
                            // this one names that exact amount, and these two may not disagree.
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid', invoiceType: 'factuur', openAmount: openAmount(inv, gecrediteerdOp(inv.id)), clientKey: newPayKey() })
                          }}
                          title={t('lijst.deelbetaling.uitleg', { paid: fmtEur(inv.amount_paid ?? 0), total: fmtEur(Math.abs(inv.total_inc_btw ?? 0)) })}
                          style={{
                            fontSize: 11, fontWeight: 600, color: '#b06000', background: '#fef7e0',
                            border: '1px solid #fde293', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap',
                            cursor: 'pointer', fontFamily: FONT,
                          }}
                        >
                          {t('lijst.deelsBetaald', { open: fmtEur(openAmount(inv, gecrediteerdOp(inv.id))) })}
                        </button>
                      )}

                      {/* [BOEK-029] Fix 1: correct button per type+status */}

                      {/* factuur + draft → Versturen (opens send modal) */}
                      {!isCredit && !isOfferte && inv.status === 'draft' && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendRequest(inv.id)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>send</span> {t('lijst.versturen')}</>}
                        </button>
                      )}

                      {/* [OFFERTE-VERSTUREN] pro_forma → de offerte NAAR DE KLANT sturen, als
                          offerte. Dit is wat "Versturen" leek te doen en niet deed. Staat vóór de
                          omzetknop omdat dit de gewone volgorde is: eerst aanbieden, dan pas — als
                          de klant ja zegt — een factuur maken. Ook op een al verstuurde offerte,
                          want opnieuw sturen na een aanpassing is de normale onderhandeling. */}
                      {isOfferte && !inv.invoice_number && (inv.status === 'draft' || inv.status === 'sent') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendOfferte(inv.id)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>send</span> {inv.status === 'sent' ? t('lijst.offerte.opnieuw') : t('lijst.offerte.versturen')}</>}
                        </button>
                      )}

                      {/* [OFFERTE-GEEN-OMZETTING] The "Omzetten naar factuur" button that stood here
                          converted a DRAFT quote in place: the same row became a numbered factuur
                          and was mailed, in one tap, without the deposit settlement, the discount as
                          lines and the archived quote of the new-invoice path. Gone. A quote is
                          mailed as a quote (the button above) and invoiced through "Maak factuur aan"
                          below — the one path, for a draft quote as much as for a sent one. */}

                      {/* [BOEK-RESEND] factuur + sent/overdue → Opnieuw versturen */}
                      {!isCredit && !isOfferte && (inv.status === 'sent' || inv.status === 'overdue') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendRequest(inv.id, true)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>hourglass_empty</span>
                            : <><span className="material-symbols-outlined icon-dir" style={{ fontSize: 14 }} aria-hidden>forward_to_inbox</span> {t('lijst.opnieuwVersturen')}</>}
                        </button>
                      )}

                      {/* factuur + sent/overdue → Betaald? */}
                      {!isCredit && !isOfferte && (inv.status === 'sent' || inv.status === 'overdue') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            // [MANUAL-PARTIAL-PAY] openAmount = what is still owed (the total on a
                            // fully open invoice, the remainder on a partly paid one) — the field's
                            // hint and its cap.
                            // [DEEL-CREDIT] Minus what was credited, and here that is not only a
                            // display: this figure is the CAP on the amount field. Left gross, the
                            // owner could record a € 500 payment on an invoice they had already put
                            // in writing was only € 450 — on the screen where they do it by hand.
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid', invoiceType: 'factuur', openAmount: openAmount(inv, gecrediteerdOp(inv.id)), clientKey: newPayKey() })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.surfaceVariant, color: '#5f6368', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>hourglass_empty</span>
                            : t('lijst.betaaldVraag')}
                        </button>
                      )}

                      {/* factuur + paid → ✓ Betaald (toggle back) */}
                      {!isCredit && !isOfferte && isPaid && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'sent', invoiceType: 'factuur' })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.successContainer, color: '#137333', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>check_circle</span> {t('lijst.betaald')}</>}
                        </button>
                      )}

                      {/* creditnota → Voldaan! / ✓ Voldaan toggle — Fix 3 */}
                      {isCredit && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            // 'voldaan' is UI-only, never a DB status — a paid
                            // creditnota IS the "voldaan" state (status 'paid').
                            setPayCtx({
                              id: inv.id,
                              number: inv.invoice_number ?? '',
                              newStatus: isPaid ? 'sent' : 'paid',
                              invoiceType: 'creditnota',
                              // Only a settlement writes money; an undo needs no idempotency key.
                              ...(isPaid ? {} : { clientKey: newPayKey() }),
                            })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: isPaid ? M3.successContainer : '#FEF7E0', color: isPaid ? '#137333' : '#EA8600' }}>
                          {processingId === inv.id ? '...'
                            : isPaid ? `✓ ${t('lijst.voldaan')}`
                            : t('lijst.voldaanActie')}
                        </button>
                      )}

                      {/* [OFFERTE-GEEN-OMZETTING] The one way from a quote to an invoice: the new-invoice
                          path (from_offerte), which carries the lines, the discount and the deposits and
                          archives the quote. On a draft quote too — the customer said yes on the phone. */}
                      {isOfferte && (inv.status === 'draft' || inv.status === 'sent') && (
                        <button
                          onClick={async e => {
                            e.stopPropagation()
                            // [BOEK-029] Fetch complete invoice data — hook SELECT may be incomplete
                            const { data: full } = await supabase
                              .from('invoices')
                              .select('id, client_name, client_email, client_address, client_postal_code, client_city, client_btw_number, total_inc_btw, total_ex_btw, btw_amount')
                              .eq('id', inv.id)
                              .single()

                            const src = (full ?? inv) as {
                              client_name?: string | null; client_email?: string | null
                              client_address?: string | null; client_postal_code?: string | null
                              client_city?: string | null; client_btw_number?: string | null
                              total_inc_btw?: number | null; total_ex_btw?: number | null
                              btw_amount?: number | null
                            }
                            router.push(
                              `/dashboard/invoice/new?from_offerte=${inv.id}` +
                              `&client_name=${encodeURIComponent(src.client_name ?? '')}` +
                              `&client_email=${encodeURIComponent(src.client_email ?? '')}` +
                              `&client_address=${encodeURIComponent(src.client_address ?? '')}` +
                              `&client_postal_code=${encodeURIComponent(src.client_postal_code ?? '')}` +
                              `&client_city=${encodeURIComponent(src.client_city ?? '')}` +
                              `&client_btw_number=${encodeURIComponent(src.client_btw_number ?? '')}` +
                              `&total_inc_btw=${src.total_inc_btw ?? 0}` +
                              `&total_ex_btw=${src.total_ex_btw ?? 0}` +
                              `&btw_amount=${src.btw_amount ?? 0}`
                            )
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer }}>
                          {t('lijst.maak')}
                        </button>
                      )}
                      {/* [AANBETALING] Part of the offerte now, the rest on the final invoice. The
                          editor builds the deposit lines per btw rate; the offerte stays open. */}
                      {isOfferte && inv.status === 'sent' && (
                        <button
                          onClick={async e => {
                            e.stopPropagation()
                            const raw = await dialog.prompt({ message: t('lijst.aanbetaling.vraag'), defaultValue: '30', placeholder: '30' })
                            if (raw === null) return
                            const pct = parseDepositPercent(raw)
                            if (!pct) { showToast(t('lijst.aanbetaling.ongeldig')); return }
                            const { data: full } = await supabase
                              .from('invoices')
                              .select('client_name, client_email, client_address, client_postal_code, client_city, client_btw_number')
                              .eq('id', inv.id)
                              .single()
                            const src = (full ?? inv) as { client_name?: string | null; client_email?: string | null; client_address?: string | null; client_postal_code?: string | null; client_city?: string | null; client_btw_number?: string | null }
                            router.push(
                              `/dashboard/invoice/new?from_offerte=${inv.id}&aanbetaling=${pct}` +
                              `&client_name=${encodeURIComponent(src.client_name ?? '')}` +
                              `&client_email=${encodeURIComponent(src.client_email ?? '')}` +
                              `&client_address=${encodeURIComponent(src.client_address ?? '')}` +
                              `&client_postal_code=${encodeURIComponent(src.client_postal_code ?? '')}` +
                              `&client_city=${encodeURIComponent(src.client_city ?? '')}` +
                              `&client_btw_number=${encodeURIComponent(src.client_btw_number ?? '')}`
                            )
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: `1px solid ${M3.outline}`, cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: '#fff', color: M3.onSurface }}>
                          {t('lijst.aanbetaling')}
                        </button>
                      )}
                    </div>

                    {/* [INVOICE-REMOVE] Verwijderen — on the rows where it is a real option: a
                        concept or an offerte (never issued, so really deletable). It never acts
                        on the tap; the dialog says first exactly what will happen.
                        [ISSUED-STAYS] A verstuurde verkoopfactuur shows NO button at all. Its
                        number comes from our own doorlopende reeks and it is corrected with a
                        creditnota, not removed — so a delete affordance there would only promise
                        something the app must refuse. Hidden while selecting for a bundle too,
                        where every tap belongs to the selection. */}
                    {!selectMode && decideRemoval(inv as RemovalInvoice).allowed && (
                      <button
                        onClick={e => { e.stopPropagation(); handleRemoveRequest(inv as RemovalInvoice & { id: string }) }}
                        disabled={processingId === inv.id}
                        aria-label={t('lijst.verwijderen.aria', { number: inv.invoice_number ?? '' })}
                        title={t('lijst.verwijderen')}
                        style={{
                          flexShrink: 0, marginInlineStart: 2, width: 34, height: 34, borderRadius: R.full,
                          border: 'none', background: 'transparent', color: '#9AA0A6',
                          cursor: processingId === inv.id ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = M3.errorContainer; e.currentTarget.style.color = M3.error }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9AA0A6' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 19 }} aria-hidden>delete</span>
                      </button>
                    )}
                  </div>

                  {/* Inline expand — Material You surface variant */}
                  {expanded && (
                    <div style={{ background: '#F8F9FA', borderTop: `1px solid ${M3.surfaceVariant}`, padding: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 16 }}>
                        <InfoLine label={t('lijst.aan')} value={inv.client_name} />
                        {(inv as InvoiceRow & { client_btw_number?: string | null }).client_btw_number && <InfoLine label={t('lijst.btwNummer')} value={(inv as InvoiceRow & { client_btw_number?: string | null }).client_btw_number ?? null} />}
                        <InfoLine label={t('lijst.exclBtw')} value={fmtEur(totalExBtw)} mono />
                        <InfoLine label={((r) => r == null ? t('lijst.btw') : t('lijst.btwPct', { pct: r }))(calcBtw(btwAmount, totalExBtw))} value={fmtEur(btwAmount)} mono />
                        <InfoLine label={t('lijst.inclBtw')} value={fmtEur(inv.total_inc_btw)} mono />
                        {inv.due_date && <InfoLine label={t('lijst.vervaldatum')} value={fmtDate(inv.due_date)} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* [INVOICE-REMOVE] The same action as the row's trash icon, spelled out
                            for whoever opened the panel — and shown under the same rule, so the
                            two can never disagree about what this invoice allows. */}
                        {decideRemoval(inv as RemovalInvoice).allowed && (
                          <button
                            onClick={e => { e.stopPropagation(); handleRemoveRequest(inv as RemovalInvoice & { id: string }) }}
                            style={{ fontSize: 13, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>delete</span>
                            {t('lijst.verwijderen')}
                          </button>
                        )}
                        {/* [HERHAAL] Only on a real, already-sent verkoopfactuur: a concept has
                            nothing to repeat yet, and an offerte or creditnota is not something
                            you bill again every month. */}
                        {!isCredit && !isOfferte && inv.status !== 'draft' && (() => {
                          const sc = schedules[inv.id]
                          const label = !sc
                            ? t('lijst.herhalen.knop')
                            : !sc.active
                              ? t('lijst.herhalen.pauzeLabel')
                              : sc.cadence === 'weekly' ? t('lijst.herhaalt.week')
                                : sc.cadence === 'monthly' ? t('lijst.herhaalt.maand')
                                  : sc.cadence === 'quarterly' ? t('lijst.herhaalt.kwartaal')
                                    : t('lijst.herhaalt.jaar')
                          return (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setRepeatCtx({
                                  id: inv.id, number: inv.invoice_number ?? '', client: inv.client_name ?? t('lijst.dezeKlant'),
                                  ...(sc ? { scheduleId: sc.id, cadence: sc.cadence, nextRun: sc.next_run_date, active: sc.active } : {}),
                                })
                              }}
                              style={{ fontSize: 13, color: sc && sc.active ? '#137333' : M3.onPrimaryContainer, background: sc && sc.active ? M3.successContainer : M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>autorenew</span>
                              {label}
                            </button>
                          )
                        })()}
                        {!isCredit && !isOfferte && inv.status !== 'draft' && (
                          <button
                            onClick={e => { e.stopPropagation(); void handleDuplicate(inv.id) }}
                            style={{ fontSize: 13, color: M3.onPrimaryContainer, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>content_copy</span>
                            {t('lijst.kopieMaken')}
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/${inv.id}`) }}
                          style={{ fontSize: 13, color: M3.onPrimary, background: M3.primary, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t('lijst.openen')}
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>open_in_new</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && sorted.length > 0 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#5F6368', padding: '16px 0' }}>{t('lijst.laden')}</p>
            )}

            {/* [BOEK-029] Archived — end of Alle only, no buttons (hidden while searching) */}
            {filter === 'all' && !searching && archivedInvoices.length > 0 && (
              <>
                <div style={{ padding: '8px 4px 2px' }}>
                  <p style={{ fontSize: 11, color: '#70757a', fontWeight: 500, letterSpacing: 0.4 }}>{t('lijst.gearchiveerd')}</p>
                </div>
                {archivedInvoices.map(inv => (
                  <div key={inv.id} style={{ borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1, opacity: inv.replaced_by_number ? 0.4 : 0.6 }}>
                    <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'default' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM }}>{inv.invoice_number ?? '—'}</p>
                        <CopyButton value={inv.invoice_number} what={t('kopieer.wat.factuurnummer')} />
                        {inv.replaced_by_number && (
                          <p style={{ fontSize: 12, color: '#5F6368' }}>{t('lijst.vervangenDoor', { number: inv.replaced_by_number })}</p>
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#5F6368', fontFamily: FONT_NUM }}>{fmtEur(inv.total_inc_btw)}</p>
                      {/* [ISSUED-STAYS] Read-only, deliberately. These rows are sales invoices a
                          creditnota replaced (or ones archived before this rule existed), and a
                          sales invoice does not leave or re-enter the doorlopende nummering on a
                          tap — putting one back would re-add omzet the creditnota already netted.
                          Bringing one back is a per-case decision, not a button. */}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── [BUNDEL-BETAALVERZOEK] Selection action bar — replaces the FAB while
          selecting. Enabled at ≥2 facturen of the same klant. ── */}
      {selectMode && (
        <div style={{
          position: 'fixed', insetInlineStart: 'calc(16px + var(--rail-w))', insetInlineEnd: 16, bottom: `calc(20px + var(--bottom-nav-h) + env(safe-area-inset-bottom))`,
          // [BAR-ALIGN] Same 648 as before, now derived from the column instead of
          // spelled out — this bar was the one that already lined up with the list.
          maxWidth: columnInner(COLUMN.work), margin: '0 auto', zIndex: 60,
          background: '#fff', borderRadius: R.lg, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: '12px 16px', fontFamily: FONT,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
                {t('lijst.geselecteerd', { count: selectedList.length, amount: fmtEur(selectedSum) })}
              </p>
              <p style={{ fontSize: 11.5, color: !sameClient ? M3.error : '#5F6368', margin: '2px 0 0' }}>
                {!sameClient
                  ? t('lijst.zelfdeKlant')
                  : selectedList.length < 2
                    ? t('lijst.minimaalTwee')
                    : t('lijst.eenBetaallink', { client: selectedList[0]?.client || t('lijst.dezeKlant') })}
              </p>
            </div>
            <button
              onClick={createBundle}
              disabled={selectedList.length < 2 || !sameClient || !allBundelbaar || bundleLoading}
              style={{
                flexShrink: 0, border: 'none', borderRadius: R.full, padding: '10px 18px',
                fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                background: (selectedList.length >= 2 && sameClient && !bundleLoading) ? M3.primary : M3.surfaceVariant,
                color: (selectedList.length >= 2 && sameClient && !bundleLoading) ? '#fff' : '#9AA0A6',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>qr_code_2</span>
              {bundleLoading ? t('lijst.bezig') : t('lijst.betaalverzoek')}
            </button>
            {/* [BULK-PDF] Beside the betaalverzoek, with a looser condition: downloading works for
                ANY selection — a single invoice, a paid one, a creditnota. The betaalverzoek states
                its own demands (two or more, one customer, bundelbaar) and those now sit on the
                button above instead of inside the selection. */}
            <button
              onClick={downloadSelectedPdf}
              disabled={selectedList.length === 0 || downloading}
              style={{
                flexShrink: 0, borderRadius: R.full, padding: '10px 18px',
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                cursor: selectedList.length === 0 || downloading ? 'default' : 'pointer',
                border: `1px solid ${selectedList.length > 0 && !downloading ? M3.primary : M3.surfaceVariant}`,
                background: '#fff',
                color: selectedList.length > 0 && !downloading ? M3.primary : '#9AA0A6',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>download</span>
              {downloading ? t('lijst.bezig') : t('lijst.downloadPdf')}
            </button>
          </div>
        </div>
      )}

      {/* ── [BOEK-029] FAB — fixed bottom-right — Material You ── */}
      {!selectMode && <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: `calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))`,
          right: 20,
          background: M3.primaryContainer,
          color: M3.onPrimaryContainer,
          borderRadius: R.lg,
          padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>add</span>
        {t('lijst.nieuw')}
      </button>}

      {/* ── [BUNDEL-BETAALVERZOEK] Share modal — one link + QR for the whole set ── */}
      {bundle && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setBundle(null)}
        >
          <div className="sheet-scroll"
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)', fontFamily: FONT }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
              {t('lijst.bundel.titel', { count: bundle.count })}
            </h3>
            {/* [TAAL] Split around the styled reference — no styled span inside one key. */}
            <p style={{ fontSize: 13.5, color: '#5F6368', lineHeight: 1.5, margin: '0 0 16px' }}>
              {t('lijst.bundel.deel', { amount: fmtEur(bundle.amount) })}{' '}
              <span style={{ fontWeight: 600, color: '#3C4043' }}>{bundle.reference || '—'}</span>.{' '}
              {t('lijst.bundel.herkent')}
            </p>

            {bundleQr && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bundleQr} alt={t('lijst.bundel.qrAlt')} width={180} height={180} style={{ borderRadius: 12 }} />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 12, padding: 8, marginBottom: 12 }}>
              <input readOnly value={bundle.url} onFocus={e => e.currentTarget.select()}
                style={{ flex: 1, background: 'transparent', fontSize: 13, color: '#3C4043', border: 'none', outline: 'none', padding: '0 6px', minWidth: 0 }} />
              <button onClick={() => bundleCopy(bundle.url)}
                style={{ flexShrink: 0, background: M3.primary, color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: FONT }}>
                {bundleCopied === null ? t('lijst.kopieerLink')
                  : bundleCopied ? t('lijst.gekopieerd') : t('kopieer.nietGelukt')}
              </button>
            </div>

            <p style={{ fontSize: 11.5, color: '#70757a', lineHeight: 1.5, margin: '0 0 16px' }}>
              {t('act.bv.disclaimer', { iban: bundle.iban.replace(/(.{4})/g, '$1 ').trim() })}
            </p>

            <button onClick={() => setBundle(null)}
              style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, border: `1px solid ${M3.surfaceVariant}`, cursor: 'pointer', fontFamily: FONT }}>
              {t('lijst.sluiten')}
            </button>
          </div>
        </div>
      )}

      {/* ── [BOEK-029] Fix 3: Smart pay dialog — factuur vs creditnota ── */}
      {payCtx && (
        <BottomSheet
          title={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid' ? t('lijst.pay.creditTitel') : t('lijst.pay.creditOngedaanTitel'))
              : (payCtx.newStatus === 'paid' ? t('lijst.pay.titel')       : t('lijst.pay.ongedaanTitel'))
          }
          body={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid'
                  ? t('lijst.pay.creditBody', { number: payCtx.number })
                  : t('lijst.pay.creditOngedaanBody', { number: payCtx.number }))
              : (payCtx.newStatus === 'paid'
                  ? t('lijst.pay.body', { number: payCtx.number })
                  : t('lijst.pay.ongedaanBody', { number: payCtx.number }))
          }
          confirmLabel={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid' ? t('lijst.pay.jaVoldaan') : t('lijst.pay.jaOngedaan'))
              : (payCtx.newStatus === 'paid' ? t('lijst.pay.jaBetaald') : t('lijst.pay.ongedaan'))
          }
          confirmBg={
            payCtx.newStatus === 'paid' ? M3.success : M3.warning
          }
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
          /* [BOEK-003] factuur + marking as paid → ask Bank/Contant.
             creditnota and undo (newStatus='sent') keep single confirm button. */
          paymentChoice={
            payCtx.invoiceType === 'factuur' && payCtx.newStatus === 'paid'
              ? (method, paymentDate, amount) => executePay({
                  // [PAY-IDEMPOTENT] The key rides along from payCtx, minted when this dialog was
                  // opened (see newPayKey). It is deliberately NOT generated here: doing so gave
                  // every tap its own key, which is the one thing an idempotency key must not do.
                  ...payCtx, paymentMethod: method, paymentDate, amount,
                })
              : undefined
          }
          /* [MANUAL-PARTIAL-PAY] Offer the amount field only where a partial payment is
             meaningful: a real factuur being marked paid. A creditnota (a refund the owner
             owes) and an undo stay all-or-nothing. */
          openAmount={
            payCtx.invoiceType === 'factuur' && payCtx.newStatus === 'paid' ? payCtx.openAmount : undefined
          }
        />
      )}

      {/* [BOEK-029] ── Send confirmation modal ── */}
      {sendCtx && (
        <BottomSheet
          title={t('lijst.send.titel', { name: sendCtx.clientName })}
          body={t('lijst.send.bevestig')}
          details={[
            { label: t('lijst.send.nummer'), value: sendCtx.number || t('lijst.send.nummerVolgt') },
            { label: t('lijst.send.email'),  value: sendCtx.clientEmail },
            { label: t('lijst.send.bedrag'), value: fmtEur(sendCtx.totalIncBtw) },
          ]}
          warning={t('bewerk.modal.waarschuwing')}
          confirmLabel={t('lijst.versturen')}
          confirmBg={M3.primary}
          onConfirm={() => executeSend(sendCtx)}
          onCancel={() => setSendCtx(null)}
        />
      )}

      {/* ── [HERHAAL] Kies hoe vaak ── One question, four answers. The dialog says what will
           happen in full: a CONCEPT arrives each period and the owner sends it — the app never
           sends an invoice by itself, because that is the act that mints a number and reaches a
           customer. */}
      {repeatCtx && (
        <div
          onClick={() => setRepeatCtx(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="sheet-scroll"
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 28, padding: '28px 24px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 48px rgba(0,0,0,0.24)', fontFamily: FONT }}
          >
            <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>
              {!repeatCtx.scheduleId ? t('lijst.repeat.titel') : repeatCtx.active === false ? t('lijst.repeat.pauzeTitel') : t('lijst.repeat.actiefTitel')}
            </p>
            {/* [TAAL] Plain text — no <strong> mid-sentence, its position differs per language. */}
            <p style={{ fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
              {repeatCtx.scheduleId ? (
                repeatCtx.active === false
                  ? t('lijst.repeat.pauzeBody', { client: repeatCtx.client })
                  : t('lijst.repeat.actiefBody', { client: repeatCtx.client, date: fmtDate(repeatCtx.nextRun ?? null) })
              ) : (
                t('lijst.repeat.uitleg', { client: repeatCtx.client })
              )}
            </p>
            {/* [HERHAAL] Stopping is the promise the dialog makes when it starts, so it lives in
                the same place. It removes only the schedule: every concept it already produced is
                an ordinary invoice and stays exactly where it is. */}
            {repeatCtx.scheduleId ? (
              <>
                {/* Pause first: it is the reversible one, and the one most owners actually want. */}
                <button
                  onClick={() => { const id = repeatCtx.scheduleId as string; const next = repeatCtx.active === false; setRepeatCtx(null); void toggleRepeat(id, next) }}
                  style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.primaryContainer, color: M3.onPrimaryContainer, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}
                >
                  {repeatCtx.active === false ? t('lijst.hervatten') : t('lijst.pauzeren')}
                </button>
                <button
                  onClick={() => stopRepeat(repeatCtx.scheduleId as string)}
                  style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.errorContainer, color: M3.error, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}
                >
                  {t('lijst.herhalen.stop')}
                </button>
              </>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {/* [TAAL] The first value is the API cadence and stays English/constant; the label
                  comes from the catalogue. */}
              {([
                ['weekly', 'lijst.elke.week'],
                ['monthly', 'lijst.elke.maand'],
                ['quarterly', 'lijst.elke.kwartaal'],
                ['yearly', 'lijst.elke.jaar'],
              ] as const).map(([value, labelKey]) => (
                <button
                  key={value}
                  onClick={() => startRepeat(value)}
                  style={{ padding: '14px', borderRadius: R.full, background: M3.primaryContainer, color: M3.onPrimaryContainer, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
            )}
            <p style={{ fontSize: 12, color: '#70757a', textAlign: 'center', margin: '4px 0 14px', lineHeight: 1.5 }}>
              {repeatCtx.scheduleId
                ? t('lijst.repeat.blijftStaan')
                : t('lijst.repeat.stoppenKan')}
            </p>
            <button
              onClick={() => setRepeatCtx(null)}
              style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              {t('lijst.annuleren')}
            </button>
          </div>
        </div>
      )}

      {/* ── [INVOICE-REMOVE] Remove dialog — the decision, rendered ──
          One component for all four answers. The confirm button is green-lit only when the
          decision allows it; for a paid sale it becomes "Creditnota maken" (the real way
          forward) and for a locked one simply "Sluiten". */}
      {removeCtx && (
        <BottomSheet
          title={removeCtx.decision.title}
          body={removeCtx.decision.body}
          warning={removeCtx.decision.warning}
          confirmLabel={removeCtx.decision.confirmLabel}
          confirmBg={removeCtx.decision.allowed
            ? (removeCtx.decision.mode === 'restore' ? M3.primary : M3.error)
            : (removeCtx.decision.mode === 'creditnota' ? M3.primary : '#5F6368')}
          onConfirm={() => executeRemoval(removeCtx)}
          onCancel={() => setRemoveCtx(null)}
          /* [REMOVAL-ALTERNATIVE] decideRemoval names the way forward for every dead end it
             produces, and this call site discarded all three. The 'creditnota' kind was already
             reachable because executeRemoval routes a blocked creditnota decision on confirm —
             but 'ask-accountant' had NO path at all: the sheet offered "Sluiten" and nothing
             else, so an invoice the accountant had locked was a wall with a door drawn on it.
             The machinery to open it (requestUnverwerkt → a message to the linked accountant)
             has existed all along, one state away. */
          alternative={(() => {
            const alt = removeCtx.decision.alternative
            if (!alt) return undefined
            if (alt.kind === 'ask-accountant') {
              return {
                label: alt.label,
                onClick: () => {
                  const id = removeCtx.id
                  const number = invoices.find(i => i.id === id)?.invoice_number ?? ''
                  setRemoveCtx(null)
                  setRequestSent(false)
                  setVerwerktCtx({ id, number })
                },
              }
            }
            if (alt.kind === 'creditnota') {
              return { label: alt.label, onClick: () => { const id = removeCtx.id; setRemoveCtx(null); router.push(`/dashboard/invoice/${id}?action=credit`) } }
            }
            // 'undo-payment' — the money has to come off the invoice first. Sending the owner to
            // the Bank page assumed there is a bank line to unlink there, and for a MANUAL
            // deelbetaling there is none: it lives in bank_tx_invoices with transaction_id NULL,
            // so that page shows nothing and the advice dead-ends on an empty screen. The undo
            // belongs on the invoice this dialog is already about, so it opens the pay sheet's
            // existing "Betaling ongedaan maken?" confirmation — the same one a fully paid invoice
            // already goes through, rather than a second, quieter route to the same write.
            return {
              label: alt.label,
              onClick: () => {
                const id = removeCtx.id
                const row = invoices.find(i => i.id === id)
                setRemoveCtx(null)
                setPayCtx({
                  id,
                  number: row?.invoice_number ?? '',
                  newStatus: 'sent',
                  invoiceType: (row?.invoice_type === 'creditnota' ? 'creditnota' : 'factuur'),
                })
              },
            }
          })()}
        />
      )}

      {/* [BOEK-004] Verwerkt conflict dialog */}
      {verwerktCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setVerwerktCtx(null)}
        >
          <div className="sheet-scroll"
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)', fontFamily: FONT }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
              {t('lijst.verwerkt')}
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {requestSent
                ? t('lijst.verzoekGestuurd', { number: verwerktCtx.number })
                : t('lijst.verwerktUitleg', { number: verwerktCtx.number })}
            </p>
            <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
              {!requestSent && (
                <button
                  onClick={requestUnverwerkt}
                  style={{ width: '100%', padding: '12px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
                >
                  {t('lijst.boekhouder.stuur')}
                </button>
              )}
              <button
                onClick={() => setVerwerktCtx(null)}
                style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
              >
                {t('lijst.sluiten')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes shimmer  { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoLine({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2, fontWeight: 500 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmBg, onConfirm, onCancel, details, warning, paymentChoice, openAmount: openBalance, alternative }: {
  title: string
  body: string
  confirmLabel: string
  confirmBg: string
  onConfirm: () => void
  onCancel: () => void
  details?: { label: string; value: string }[]
  warning?: string
  // [BOEK-003] when set, replaces single confirm button with Bank / Contant choice
  // [BRIDGE-QUARTER] now also receives the real payment date (YYYY-MM-DD)
  // [MANUAL-PARTIAL-PAY] …and the amount, when the owner typed one (null = pay it all)
  paymentChoice?: (method: 'bank' | 'kas', paymentDate: string, amount: number | null) => void
  // [MANUAL-PARTIAL-PAY] What is still open on this invoice. Present → the "Betaald bedrag"
  // field is offered. Absent → no field at all (a bundle stays all-or-nothing).
  openAmount?: number
  // [REMOVAL-ALTERNATIVE] The way FORWARD when the answer is no. decideRemoval has always
  // computed this ("Creditnota maken", "Betaling terugdraaien", "Vraag je boekhouder") and this
  // sheet never accepted it, so every one of them was thrown away at the call site — the dialog
  // said what the owner could not do and stayed silent about what they could. On a blocked
  // decision both buttons then just closed the sheet, which is a dead end with two exits.
  alternative?: { label: string; onClick: () => void }
}) {
  // [BRIDGE-QUARTER] real payment date — only relevant when paymentChoice is set
  // (marking as paid). Defaults to today; user corrects if they paid earlier.
  // [TZ] Amsterdam, not UTC: just after midnight the UTC day is still yesterday, and under
  // kasstelsel a betaaldatum one day early can land in a quarter that is already filed.
  const [paymentDate, setPaymentDate] = useState(amsterdamToday())
  // [MANUAL-PARTIAL-PAY] The optional amount. EMPTY MEANS EVERYTHING — the common case costs
  // zero keystrokes and nobody has to know the word "deelbetaling". Deliberately a placeholder
  // and not a pre-filled value: pre-filling would force a phone user to wipe "€ 1.000,00"
  // before typing, and a formatted string is exactly what a naive parser chokes on.
  const [amountText, setAmountText] = useState('')
  const taal = useLocale()
  const t = translator(taal)
  const entry = openBalance != null ? interpretAmountEntry(amountText, openBalance) : null
  // [CASH-INSTALMENT] Cash may now settle PART of an invoice too. It could not before: the
  // kasboek held one settlement entry per invoice, so two cash handovers collapsed into one
  // entry dated to the last — the drawer wrong in between, and money able to jump a filed
  // quarter. Each cash payment is now its own dated drawer movement, so the only rule left is
  // the ordinary one: the amount has to be valid.
  const canPayCash = !entry || entry.valid
  // [BOEK-029] CenteredModal — replaces bottom sheet for all dialogs
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="sheet-scroll"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 28,
          padding: '28px 24px 24px',
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 24px 48px rgba(0,0,0,0.24)',
          fontFamily: FONT,
        }}
      >
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>
        <p style={{ fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: details && details.length > 0 ? 20 : 24, lineHeight: 1.5 }}>{body}</p>

        {/* [BOEK-029] Optional details list */}
        {details && details.length > 0 && (
          <div style={{ background: '#F1F3F4', borderRadius: 12, padding: '14px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {details.map(d => (
              <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#5F6368', flexShrink: 0 }}>{d.label}</span>
                <span style={{ fontSize: 13, color: '#202124', fontWeight: 600, textAlign: 'end', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* [BOEK-029] Optional warning box */}
        {warning && (
          <div style={{ background: '#FEF7E0', borderRadius: 12, padding: '12px 14px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#EA8600', flexShrink: 0, marginTop: 1 }} aria-hidden>warning</span>
            <p style={{ fontSize: 12.5, color: '#7C5800', lineHeight: 1.5, margin: 0 }}>{warning}</p>
          </div>
        )}

        {/* [BOEK-003] payment method choice (Bank / Contant) or standard confirm */}
        {paymentChoice ? (
          <>
            {/* [BRIDGE-QUARTER] Real payment date — the day money actually moved */}
            {/* [PAY-DATE-SANE] A floor beside the ceiling, on the same date field the purchase
                side has. Both only bound the picker — /api/invoice/pay-toggle is what refuses an
                impossible day, for every caller. */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{t('lijst.betaaldatum')}</label>
            {/* [DATE-NL] See the sibling dialog on /dashboard/incoming/manage — same field, same
                reason: the browser's locale decides a native date input's segment order, and this
                one picks the BTW quarter. */}
            <div style={{ marginBottom: 16 }}>
              <DateFieldNL
                value={paymentDate}
                min={PAYMENT_DATE_FLOOR}
                max={amsterdamToday()}
                onChange={setPaymentDate}
                aria-label={t('lijst.betaaldatum')}
              />
            </div>

            {/* [MANUAL-PARTIAL-PAY] Betaald bedrag — optional. Empty settles the whole open
                balance, which is what this dialog always did, so the ordinary case is unchanged
                and costs nothing. A typed amount records a deelbetaling: the invoice stays open
                for the rest, and the reminder + pay-QR ask only that rest from then on. */}
            {entry && openBalance != null && (
              <>
                <label htmlFor="betaald-bedrag" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>
                  {t('lijst.betaaldBedrag')}
                </label>
                <input
                  id="betaald-bedrag"
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  placeholder={openBalance.toFixed(2).replace('.', ',')}
                  onChange={e => setAmountText(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: `1px solid ${entry.error ? M3.error : '#DADCE0'}`,
                    fontSize: 15, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 12, color: entry.error ? M3.error : '#5F6368', margin: '6px 2px 16px', lineHeight: 1.45 }}>
                  {entry.error
                    ? entry.error
                    : amountText.trim() === ''
                      ? t('lijst.pay.leegAlles', { amount: fmtEur(openBalance) })
                      : entry.settlesFully
                        ? t('lijst.pay.volledig')
                        : t('lijst.pay.nogOpen', { amount: fmtEur(entry.remainingAfter) })}
                </p>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <button
                onClick={() => { if (!entry || entry.valid) paymentChoice('bank', paymentDate, entry?.amount ?? null) }}
                disabled={!!entry && !entry.valid}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: (!entry || entry.valid) ? confirmBg : M3.surfaceVariant, color: (!entry || entry.valid) ? '#fff' : '#70757a', fontSize: 15, fontWeight: 600, border: 'none', cursor: (!entry || entry.valid) ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>account_balance</span>
                {t('lijst.bank')}
              </button>
              {/* [CASH-INSTALMENT] Contant accepts a PARTIAL amount now. It used to be refused
                  because the kasboek held one settlement entry per invoice, so two cash handovers
                  collapsed into a single entry re-dated to the last — the daily drawer balance
                  wrong in between, and money able to move out of an already filed quarter. Each
                  cash payment is now its own dated movement in the kasboek, so paying a supplier
                  in two handovers from the till is simply recorded as what it was. */}
              <button
                onClick={() => { if (canPayCash) paymentChoice('kas', paymentDate, entry?.amount ?? null) }}
                disabled={!canPayCash}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: canPayCash ? confirmBg : M3.surfaceVariant, color: canPayCash ? '#fff' : '#70757a', fontSize: 15, fontWeight: 600, border: 'none', cursor: canPayCash ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>payments</span>
                {t('lijst.contant')}
              </button>
            </div>
            <button onClick={onCancel} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>{t('lijst.annuleren')}</button>
          </>
        ) : (
          <>
            <button onClick={onConfirm} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>{confirmLabel}</button>
            {/* [REMOVAL-ALTERNATIVE] The route forward, when there is one. Outlined, not filled:
                it is an offer, never the recommended tap. */}
            {alternative && (
              <button onClick={alternative.onClick} style={{ width: '100%', padding: '13px', borderRadius: R.full, background: '#fff', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: '1px solid #DADCE0', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>{alternative.label}</button>
            )}
            <button onClick={onCancel}  style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>{t('lijst.annuleren')}</button>
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  const t = translator(useLocale())
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, marginTop: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#C4C7C5', display: 'block', marginBottom: 12 }} aria-hidden>receipt_long</span>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 4, fontFamily: FONT }}>{t('lijst.leeg')}</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>{t('lijst.leeg.eerste')}</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: 72, borderRadius: R.lg, background: 'linear-gradient(90deg,#F8F9FA 25%,#e0e0e0 50%,#F8F9FA 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      ))}
    </div>
  )
}