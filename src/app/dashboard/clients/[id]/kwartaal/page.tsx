'use client'

// src/app/dashboard/clients/[id]/kwartaal/page.tsx
// [BOEK-028] Kwartaal page — per client, per quarter — May 2026
// Accessible via: /dashboard/clients/[id]/kwartaal?q=1&year=2026
// [BRIDGE-A] Shows ALL shared invoices (sent/received/paid) filtered by quarter
// Accounting split: Debiteuren / Crediteuren / Voldaan — Verlopen computed at display
// Inline expand on row click — no page navigation
// Action dropdown: Verwerkt / In behandeling / Vraag (Not Found removed)

import { useState, useEffect, useMemo, useRef } from 'react'
import Aandachtspunten from '@/components/kantoor/Aandachtspunten'
// [KWT-TABS] The invoice evidence is three sibling views of one dataset, not three stacked lists.
// The rules for choosing between them — including that a ?focus= deep link outranks ?tab= — live
// in the pure module; the strip that renders them holds no language of its own.
import FactuurTabs from '@/components/kantoor/FactuurTabs'
import {
  countInvoiceTabs, focusInvoiceTab, invoiceSection, invoiceTabHref, invoiceTabId,
  invoiceTabPanelId, invoiceTabRows, readInvoiceTab, type InvoiceTabKey,
} from '@/lib/period-invoice-tabs'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, usePathname, useSearchParams } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import { rowMatchesQuery } from '@/lib/search'
import type { InvoiceRow, ProfileRow } from '@/types/rows'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { EL1, M3, R, COLUMN, PAGE_HEADER_HEIGHT } from '@/lib/design/tokens'
// [FOCUS-KOP] Where a deep-linked row must come to rest — see the header of that file.
import { landRowUnderChrome } from '@/lib/focus-scroll'
import { brugDocumentsHref } from '@/lib/accountant-deep-links'
import { buildWorkspace, PENDING_READ, type MoneyFinding, type SourceRead } from '@/lib/period-workspace'
// [KANTOOR-PERIODE] Which client-period an answer is about — see the header of that file.
import { acceptStamped, periodIdentity, readFor, stampFor, type Stamped } from '@/lib/period-context'
import type { SeriesReport } from '@/lib/invoice-continuity'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
// [KWT-TABS] Direction travels with the words: in Arabic the tab strip lays out right to left and
// ArrowRight therefore means the PREVIOUS tab.
import { LOCALE_META } from '@/lib/i18n/locale'
import { isOverdue } from '@/components/invoice/InvoiceRow'
// [TEKST-SELECTIE] Een sleep die tekst selecteert is geen tik op de rij: de kaart klapte
// open en dicht terwijl de eigenaar een factuurnummer probeerde te kopiëren.
import { onRowTap } from '@/lib/row-tap'
import DateFieldNL from '@/components/ui/DateFieldNL'
import { VoorstelFormulier, type VoorstelStatus } from '../VoorstelFormulier'
import { askInvoiceQuestion, INVOICE_QUESTION_ROUTE } from '@/lib/accountant-invoice-question-flow'

// De kwartaalpagina leest alleen deze velden van een factuur. Ze expliciet noemen maakt
// zichtbaar waar de pagina van afhangt — en dat `total_inc_btw` en `btw_amount` in de
// database leeg mogen zijn, wat de rekenhulpen hieronder nu netjes afvangen.
/** [KANTOOR-PERIODE] The three payloads the attention block is built from, as read. */
interface WorkspaceBronnen {
  readiness: SourceRead<{ missing: { title: string }[]; risks: { title: string }[] }>
  geld: SourceRead<{ violations: MoneyFinding[]; drawer: MoneyFinding[]; drawerChecked: boolean }>
  nummering: SourceRead<{ series: SeriesReport[]; unreadable: string[]; countersRead: boolean }>
}

/** One array, so "no rows read yet" keeps a stable identity across renders. */
const GEEN_FACTUREN: KwartaalInvoice[] = []

type KwartaalInvoice = Pick<InvoiceRow,
  'id' | 'direction' | 'status' | 'due_date' | 'invoice_date' | 'invoice_number' |
  'invoice_type' | 'client_name' | 'total_ex_btw' | 'btw_amount' | 'total_inc_btw' |
  'marked_paid_at' | 'accountant_status' | 'accountant_note' | 'pdf_url' |
  'client_btw_number' | 'replaced_by_number'>

// ─────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] Not Found removed — 3 actions only
// [TAAL] `value` is the STORED accountant_status — never translated. Only the label is.
const ACCOUNTANT_ACTIONS = [
  { value: 'verwerkt',       labelKey: 'bh.kwt.actie.verwerkt',      bg: '#E6F4EA', color: '#137333', rowBg: '#F2FAF4' },
  { value: 'in_behandeling', labelKey: 'bh.kwt.actie.inBehandeling', bg: '#FEF7E0', color: '#EA8600', rowBg: '#FEFCF0' },
  { value: 'vraag',          labelKey: 'bh.kwt.actie.vraag',         bg: '#E8F0FE', color: '#1967D2', rowBg: '#F0F4FF' },
] as const

type ActionValue = 'verwerkt' | 'in_behandeling' | 'vraag'

// [VOORSTEL] One literal key per status, so the [TAAL] scanner sees every sentence rendered.
const VOORSTEL_STATUS_KEY = {
  open: 'bh.kwt.voorstel.status.open',
  accepted: 'bh.kwt.voorstel.status.accepted',
  declined: 'bh.kwt.voorstel.status.declined',
  stale: 'bh.kwt.voorstel.status.stale',
} as const

// Quarter date ranges
const QUARTER_RANGES: Record<number, { start: string; end: string; label: string }> = {
  1: { start: '-01-01', end: '-03-31', label: 'jan – mrt' },
  2: { start: '-04-01', end: '-06-30', label: 'apr – jun' },
  3: { start: '-07-01', end: '-09-30', label: 'jul – sep' },
  4: { start: '-10-01', end: '-12-31', label: 'okt – dec' },
}

// [KWT-TABS] The invoice heading names the tab strip below it (aria-labelledby), so a screen
// reader announces "Facturen, tab 2 of 3" rather than three unattached controls.
const FACTUREN_KOP_ID = 'kwt-facturen-kop'

// [BOEK-028] Fixed Dutch formatting — never changes
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED. fmt() is called with BOTH a date-only column (invoice_date — midnight
// UTC, so a day early west of UTC) and a real timestamp (marked_paid_at — the viewer's zone, so
// a payment booked at 23:30 Amsterdam reads as the day before). One pin answers both, and this is
// the accountant's quarter view: the day an invoice carries decides which quarter it is in.
const NL_DATE   = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam' })

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  try { return NL_DATE.format(new Date(d)) } catch { return d ?? '—' }
}

// [BOEK-028] Amount: outgoing = positive, incoming = negative
function getAmount(inv: KwartaalInvoice): number {
  const total = inv.total_inc_btw ?? 0
  return inv.direction === 'outgoing' ? total : -total
}

// btw_rate does not exist in DB — always calculate
function getBtwRate(inv: KwartaalInvoice): number {
  if (!inv.total_ex_btw || inv.total_ex_btw === 0) return 0
  return Math.round(((inv.btw_amount ?? 0) / inv.total_ex_btw) * 100)
}

// [BRIDGE-A][KWT-TABS] The accounting split MOVED to src/lib/period-invoice-tabs.ts, unchanged —
// the same three predicates, in the same order. It moved because the tab an invoice belongs to and
// the list it is rendered in have to be one answer: two copies of "outgoing and sent" would drift,
// and the drift would put a receivable under Crediteuren, where an accountant would book it wrong.
// It also made the rules testable without a browser, which is the half that was never checked.

// [OVER-DATUM] Verlopen wordt bij het tonen berekend, nooit opgeslagen — maar door de ENE bron.
//
// Hier stond een tweede antwoord, en het was hetzelfde verkeerde antwoord dat InvoiceRow al eens
// heeft weggehaald:
//
//     inv.status === 'sent' && new Date(inv.due_date) < new Date()
//
// Drie dingen mis, op het scherm waar een boekhouder een kwartaal beoordeelt:
//
//   1. Het vergelijkt een DAG met een MOMENT. `new Date('2026-07-31')` is middernacht UTC, dus
//      02:00 in Amsterdam: vanaf twee uur 's nachts OP de vervaldag stond er "Verlopen" bij een
//      factuur die de klant die hele dag nog op tijd kon betalen. Bovendien uit de klok van de
//      BROWSER, dus een boekhouder in een andere tijdzone kreeg een ander oordeel dan zijn klant.
//   2. `status === 'sent'` is uitsluitend de verkoopkant. Een INKOOPfactuur staat op 'received',
//      dus een rekening die de ondernemer zelf te laat betaalt kon hier nooit "Verlopen" heten —
//      op precies de pagina waar de crediteuren als eigen sectie staan.
//   3. Een OFFERTE met een verstreken "geldig tot"-datum viel er wél doorheen, want die staat ook
//      op 'sent'. Rood en dringend over een bedrag dat niemand verschuldigd is.
//
// isOverdue (lib/overdue.ts, via InvoiceRow) beantwoordt alle drie: Amsterdamse dagen, elke
// richting, en offertes uitgezonderd.
const isVerlopen = (inv: KwartaalInvoice): boolean =>
  isOverdue({ status: inv.status ?? '', due_date: inv.due_date, invoice_type: inv.invoice_type })

// ─────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────

function ActionBadge({ value }: { value: string | null }) {
  const t = translator(useLocale())
  const a = ACCOUNTANT_ACTIONS.find(x => x.value === value)
  if (!a) return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, backgroundColor: "#F1F3F4", color: "#5F6368" }}>—</span>
  )
  return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, fontWeight: 500, backgroundColor: a.bg, color: a.color }}>
      {t(a.labelKey)}
    </span>
  )
}

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export default function KwartaalPage() {
  const locale = useLocale()
  // [KANTOOR-PERIODE] Stable per locale: the workspace memo downstream depends on `t`, and a fresh
  // translator every render would rebuild it on every keystroke in the search box.
  const t = useMemo(() => translator(locale), [locale])
  const dialog = useDialog()
  const toast = useToast()
  const router       = useRouter()
  const params       = useParams()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // [BOEK-028] Next.js 15: params is a Promise — use useParams() which resolves it
  const clientId = params?.id as string
  const q        = Number(searchParams.get('q') ?? 1)
  const year     = Number(searchParams.get('year') ?? new Date().getFullYear())

  // [KANTOOR-PERIODE] The period NOW on the screen. Every asynchronous answer below is stamped
  // with the period it was asked about, and is consumed only when the two match — so a Q3 finding
  // can never appear for a moment underneath a Q2 heading, and a slow Q3 answer can never land on
  // top of a Q2 one. The ref carries the same value to the async continuations, which is what makes
  // the second half true without any assumption about which request finishes first.
  const huidig = periodIdentity({ clientId, year, quarter: q })
  const huidigRef = useRef(huidig)
  useEffect(() => { huidigRef.current = huidig }, [huidig])

  const range = QUARTER_RANGES[q] ?? QUARTER_RANGES[1]
  const dateStart = `${year}${range.start}`
  const dateEnd   = `${year}${range.end}`

  const [client, setClient] = useState<ProfileRow | null>(null)
  // [NO-SILENT-EMPTY] Een mislukte lezing mag nooit 'Geen facturen' worden — dat is een uitspraak
  // over andermans administratie die een leesfout niet mag doen.
  // [KANTOOR-PERIODE] …en een gelezen kwartaal mag nooit onder de kop van een ander kwartaal
  // blijven staan: de regels reizen samen met de periode waarvan ze het antwoord zijn.
  const [factuurLezing, setFactuurLezing] =
    useState<Stamped<{ rows: KwartaalInvoice[]; error: boolean }> | null>(null)
  // [VOORSTEL] The latest proposal per invoice (its status), and which row has the form open.
  const [voorstelStatus, setVoorstelStatus] = useState<Record<string, VoorstelStatus>>({})
  const [voorstelOpenVoor, setVoorstelOpenVoor] = useState<string | null>(null)
  // [TRUST-ACCOUNTANT] The quarter tiles must show the SAME reconciled, turnover-aware
  // figures as the owner's /klaar, the Brug hub and the ZIP — not an invoices-only
  // client-side sum (which, for a retail/cash client, is a fraction of the real omzet
  // and prints a "BTW totaal" that is a naive both-direction sum, equal to neither 5a
  // nor 5g). Sourced from /api/result (omzet/kosten) + /api/aangifte (5g saldo), the
  // exact endpoints the Brug KwartaalPanel already uses. One client, one truth.
  const [reconLezing, setReconLezing] =
    useState<Stamped<{ omzet: number; kosten: number; saldo: number }> | null>(null)

  // [KANTOOR-PERIODE] The known work, above the figures. Three reads, each allowed to fail ALONE:
  // a money audit that did not answer must not erase a numbering gap, and a readiness that did not
  // answer must not erase a money finding. Availability may degrade; financial truth may not.
  // Null until the reads settle, so the block does not flash an empty "nothing to do".
  const [bronLezing, setBronLezing] = useState<Stamped<WorkspaceBronnen> | null>(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  // [COHERENCE-CLOSING] Generate the closing package right where the accountant finishes
  // the quarter — no need to go back to /dashboard/quarterly and re-pick the same client.
  const [packaging, setPackaging] = useState(false)
  const [packageError, setPackageError] = useState<string | null>(null)

  // ── What this period has actually answered ─────────────────────────────────
  // Not "what is in state" — what is in state ABOUT THIS PERIOD. A null here is PENDING: still
  // being read. It is never rendered as a failed read and never as an empty result, because the
  // screen knows nothing about this period yet, and both of those would be claims.
  const lezing = readFor(factuurLezing, huidig)
  const invoices = lezing?.rows ?? GEEN_FACTUREN
  const loadError = lezing?.error ?? false
  const loading = lezing === null
  const recon = readFor(reconLezing, huidig)
  const bronnen = readFor(bronLezing, huidig)

  /**
   * An optimistic edit, applied to the rows of the period it was made in.
   *
   * Written as a functional update against the stamp: if the accountant has moved to another
   * quarter by the time this runs, the edit belongs to rows that are no longer on the screen and
   * must not be smeared over the rows that are.
   */
  const patchRij = (identiteit: string, invoiceId: string, patch: Partial<KwartaalInvoice>) =>
    setFactuurLezing((prev) =>
      prev && prev.identity === identiteit
        ? {
            ...prev,
            value: {
              ...prev.value,
              rows: prev.value.rows.map((i) => (i.id === invoiceId ? { ...i, ...patch } : i)),
            },
          }
        : prev,
    )

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // The accountant clicks an enriched notification and lands on the exact row:
  // auto-expand, scroll into view, brief highlight ring.
  const focusId = searchParams.get('focus')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // ── [KWT-TABS] Which of the three invoice views is on screen ───────────────
  //
  // The URL is the answer, so the view survives a refresh, travels in a shared link and comes back
  // under the browser's Back button. An unreadable `tab` is not an error worth a screen about:
  // readInvoiceTab falls to Debiteuren, which is a real answer.
  //
  // `focusTab` is the one thing allowed to outrank it, and only until the accountant says
  // otherwise. Batch 2 promises that a notification lands on its invoice; a link carrying
  // `focus=<a purchase invoice>&tab=debiteuren` — a stale bookmark, a link built before the
  // invoice was paid — would honour the tab and hide the row the link exists for. It is held in
  // state rather than written into the URL so the panel switches in the SAME render as the reveal:
  // landRowUnderChrome() measures a row, and a row in an unmounted panel has no box to measure.
  const urlTab = readInvoiceTab(searchParams.get('tab'))
  const [focusTab, setFocusTab] = useState<InvoiceTabKey | null>(null)
  const actieveTab: InvoiceTabKey = focusTab ?? urlTab

  /** Choosing a view. Only `tab` changes — `q`, `year` and `focus` are this screen's identity and
   *  its deep link, and a query string that quietly drops half of itself turns a view change into
   *  a navigation. Pushed, not replaced, so Back returns to the view the accountant came from; and
   *  `scroll: false` because the rows move, not the page. */
  const kiesTab = (key: InvoiceTabKey) => { void naarTab(key) }

  async function naarTab(key: InvoiceTabKey) {
    if (key === actieveTab) return
    // [KWT-TABS] The one thing a view change can destroy. VoorstelFormulier holds its own draft —
    // the amounts AND the reason the accountant has typed for the client to read — so unmounting
    // its row takes them with it. The form only opens on a booked, unpaid PURCHASE invoice, which
    // is only ever in Crediteuren, so leaving that view is the single move that loses it.
    //
    // Never in silence. On a screen whose job is asserting what has been checked, work that
    // disappears without a word is the defect; one question is not the friction it looks like.
    // Nothing is written here either way — this refuses a navigation, it does not undo anything.
    if (voorstelOpenVoor) {
      const weg = await dialog.confirm({
        title: t('bh.kwt.voorstel.wegVraag'),
        message: t('bh.kwt.voorstel.wegUitleg'),
        confirmLabel: t('bh.kwt.voorstel.wegKnop'),
        danger: true,
      })
      if (!weg) return
      setVoorstelOpenVoor(null)
    }
    // From here on the accountant's own choice wins: otherwise the focused invoice would drag the
    // panel back every time they looked at another view.
    setFocusTab(null)
    router.push(invoiceTabHref(pathname, searchParams.toString(), key), { scroll: false })
  }

  useEffect(() => {
    // [KANTOOR-PERIODE] The cancellation half of the contract. React runs this cleanup before the
    // next run of the effect, so an answer to the period we have just left finds `alive === false`
    // and writes nothing at all. The stamp then covers what cancellation alone cannot: a write that
    // is already in flight when the period changes is still refused, by identity, not by timing.
    let alive = true
    const ctx = { clientId, year, quarter: q }
    const schrijfFacturen = (rows: KwartaalInvoice[], error: boolean) => {
      if (!alive) return
      setFactuurLezing((prev) => acceptStamped(prev, stampFor(ctx, { rows, error }), huidigRef.current))
    }

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Client profile
      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()
      if (!alive) return
      if (clientData) setClient(clientData)

      // [BRIDGE-A] Two queries — outgoing + incoming — merged, then split by section.
      // [VOL-GELEZEN] Gepagineerd: een detailhandelskwartaal met >1000 facturen werd stil
      // afgekapt, en "Facturen (N)" beloofde volledigheid over een half beeld. Fouten GEBONDEN:
      // een RLS-weigering werd 'Geen facturen in Q{n}' — de verkeerdste conclusie die er is.
      const paged = async (build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
        const out: unknown[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await build(from, from + 999)
          if (error) throw new Error(error.message)
          out.push(...(data ?? []))
          if ((data ?? []).length < 1000) return out
        }
      }
      let outgoing: unknown[] = []
      let incoming: unknown[] = []
      try {
        // Outgoing: sent (Debiteuren) + paid (Voldaan). 'voldaan' removed — never a DB value.
        outgoing = await paged((from, to) => supabase
          .from('invoices')
          .select('*, invoice_lines(*), invoice_type, replaced_by_number')
          .eq('sender_id', clientId)
          .eq('direction', 'outgoing')
          .in('status', ['sent', 'paid'])
          .gte('invoice_date', dateStart)
          .lte('invoice_date', dateEnd)
          .order('id', { ascending: true })
          .range(from, to))

        // Incoming: received (Crediteuren) + paid (Voldaan).
        incoming = await paged((from, to) => supabase
          .from('invoices')
          .select('*, invoice_lines(*), invoice_type, replaced_by_number')
          .eq('receiver_id', clientId)
          .eq('direction', 'incoming')
          .in('status', ['received', 'paid'])
          .gte('invoice_date', dateStart)
          .lte('invoice_date', dateEnd)
          .order('id', { ascending: true })
          .range(from, to))
      } catch {
        schrijfFacturen([], true)
        return
      }

      // [FIN-4-ROWS] NULL-direction rows this client owns are counted by the
      // reconciled tiles (which infer direction from ownership) but were absent
      // from the two typed queries above, so "tile total ≠ sum of visible rows".
      // Fetch them by ownership, infer direction the same way, and keep only the
      // (direction, status) combos the sections show — so the list matches the tiles.
      // [VOORSTEL] The accountant's own proposals for this client, newest first; the first row per
      // invoice is its current state. Best-effort: a database without the migration has none.
      try {
        // invoice_corrections is not in the generated types (hand-applied migration).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: props } = await (supabase as any)
          .from('invoice_corrections')
          .select('invoice_id, status, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
        const latest: Record<string, VoorstelStatus> = {}
        for (const r of (props ?? []) as { invoice_id: string; status: VoorstelStatus }[]) {
          if (!(r.invoice_id in latest)) latest[r.invoice_id] = r.status
        }
        setVoorstelStatus(latest)
      } catch { /* no proposals to show — the form still works */ }

      const { data: nullDir, error: nullDirErr } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .or(`sender_id.eq.${clientId},receiver_id.eq.${clientId}`)
        .is('direction', null)
        .in('status', ['sent', 'received', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)
      if (nullDirErr) {
        schrijfFacturen([], true)
        return
      }

      const inferred = (nullDir ?? [])
        .map((inv) => {
          const dir = inv.receiver_id === clientId ? 'incoming'
            : inv.sender_id === clientId ? 'outgoing' : null
          return dir ? { ...inv, direction: dir } : null
        })
        .filter((inv): inv is NonNullable<typeof inv> => inv !== null)
        .filter((inv) =>
          inv.direction === 'outgoing'
            ? inv.status === 'sent' || inv.status === 'paid'
            : inv.status === 'received' || inv.status === 'paid'
        )

      const merged = [...(outgoing ?? []), ...(incoming ?? []), ...inferred]
      schrijfFacturen(merged, false)

      // [TRUST-ACCOUNTANT] Reconciled quarter figures — same source as the ZIP + owner.
      try {
        const params = new URLSearchParams({ year: String(year), quarter: String(q), clientId })
        const [rRes, aRes] = await Promise.all([
          fetch(`/api/result?${params}`),
          fetch(`/api/aangifte?${params}`),
        ])
        if (rRes.ok && aRes.ok) {
          const pnl = await rRes.json()
          const btw = await aRes.json()
          // [TRUST-ACCOUNTANT] Read the ACTUAL response shape: /api/result nests the P&L
          // under `result`, /api/aangifte nests the concept under `aangifte`. Reading
          // pnl.omzet / btw.saldo (the old bug) was always undefined → a confident €0,00
          // shown as reconciled truth for every client and quarter. Only set recon when all
          // three are real numbers; otherwise leave it null so the tiles keep the "…" dash
          // instead of inventing a zero.
          const omzet = Number(pnl?.result?.omzet)
          const kosten = Number(pnl?.result?.kosten)
          const saldo = Number(btw?.aangifte?.saldo)
          if (alive && [omzet, kosten, saldo].every(Number.isFinite)) {
            // Stamped like every other answer: an old quarter's reconciled omzet under a new
            // quarter's heading is the most convincing wrong number this screen could print.
            setReconLezing((prev) =>
              acceptStamped(prev, stampFor(ctx, { omzet, kosten, saldo }), huidigRef.current))
          }
        }
      } catch { /* leave recon null → tiles show a loading dash, never a wrong number */ }
    }
    load()
    return () => { alive = false }
  }, [clientId, q, year])

  // ── [KANTOOR-PERIODE] The three sources behind Aandachtspunten ──────────────
  //
  // One request each, all three started together, and every one of them allowed to come back
  // empty-handed on its own. `lees` never throws and never rejects, so a dead socket on the money
  // audit is a Geld that says "unknown" — not a page that loses its numbering findings with it.
  //
  // Not fetched per row, and not re-fetched when the locale changes: the SENTENCES come out of
  // these payloads through buildWorkspace() below, which is a memo over the same raw reads.
  useEffect(() => {
    let alive = true
    const ctx = { clientId, year, quarter: q }
    void (async () => {
      const lees = async <T,>(url: string, pick: (json: Record<string, unknown>) => T): Promise<SourceRead<T>> => {
        try {
          const res = await fetch(url)
          const json = await res.json().catch(() => null)
          if (!res.ok || !json?.ok) return { ok: false }
          return { ok: true, value: pick(json) }
        } catch {
          return { ok: false }
        }
      }
      const klant = encodeURIComponent(clientId)
      const settled = await Promise.allSettled([
        lees(`/api/readiness?clientId=${klant}&year=${year}&quarter=${q}`, (j) => {
          // Titles only. The score, the status, the owner-facing `detail` and the owner-route
          // `fix` href are deliberately never read here — see [KANTOOR-RUST] batch 1.
          const r = (j.report ?? {}) as { missing?: { title?: unknown }[]; risks?: { title?: unknown }[] }
          const titels = (list?: { title?: unknown }[]) =>
            (Array.isArray(list) ? list : [])
              .map((m) => (typeof m?.title === 'string' ? { title: m.title } : null))
              .filter((m): m is { title: string } => m !== null)
          return { missing: titels(r.missing), risks: titels(r.risks) }
        }),
        lees(`/api/money-audit?clientId=${klant}`, (j) => ({
          violations: Array.isArray(j.violations) ? (j.violations as MoneyFinding[]) : [],
          drawer: Array.isArray(j.drawer) ? (j.drawer as MoneyFinding[]) : [],
          // Careful direction: an answer that did not say the drawer ran did not run it.
          drawerChecked: j.drawerChecked === true,
        })),
        lees(`/api/invoice/continuity?clientId=${klant}`, (j) => ({
          series: Array.isArray(j.series) ? (j.series as SeriesReport[]) : [],
          unreadable: Array.isArray(j.unreadable) ? (j.unreadable as string[]) : [],
          countersRead: j.countersRead === true,
        })),
      ])
      if (!alive) return
      const uit = <T,>(r: PromiseSettledResult<SourceRead<T>>): SourceRead<T> =>
        r.status === 'fulfilled' ? r.value : { ok: false }
      const gelezen: WorkspaceBronnen = {
        readiness: uit(settled[0] as PromiseSettledResult<SourceRead<{ missing: { title: string }[]; risks: { title: string }[] }>>),
        geld: uit(settled[1] as PromiseSettledResult<SourceRead<{ violations: MoneyFinding[]; drawer: MoneyFinding[]; drawerChecked: boolean }>>),
        nummering: uit(settled[2] as PromiseSettledResult<SourceRead<{ series: SeriesReport[]; unreadable: string[]; countersRead: boolean }>>),
      }
      setBronLezing((prev) => acceptStamped(prev, stampFor(ctx, gelezen), huidigRef.current))
    })()
    return () => { alive = false }
  }, [clientId, q, year])

  // The four scopes, from the raw reads plus the invoice rows this page already holds. No fourth
  // request: the open questions are `accountant_status === 'vraag'` on rows that are right here.
  const werk = useMemo(() => {
    return buildWorkspace(
      {
        clientId,
        year,
        quarter: q,
        // [KANTOOR-PERIODE] A source that has not answered FOR THIS PERIOD is PENDING — silent.
        // Not the previous period's findings (they would be read as facts about this one), and not
        // a read-failure sentence either: nothing failed, the answer is simply not back yet.
        readiness: bronnen ? bronnen.readiness : PENDING_READ,
        geld: bronnen ? bronnen.geld : PENDING_READ,
        nummering: bronnen ? bronnen.nummering : PENDING_READ,
        // [NO-SILENT-EMPTY] A failed invoice read is not "no open questions"; it is unknown, and
        // buildWorkspace says so with the page's own read-failure sentence.
        vragen: lezing === null
          ? PENDING_READ
          : lezing.error
            ? { ok: false }
            : {
                ok: true,
                value: lezing.rows
                  .filter((inv) => inv.accountant_status === 'vraag')
                  .map((inv) => ({ id: inv.id, invoice_number: inv.invoice_number, client_name: inv.client_name })),
              },
      },
      t,
    )
  }, [bronnen, lezing, clientId, q, year, t])

  // [BRIDGE-NOTIF] When invoices are loaded and a ?focus= row exists, reveal it.
  useEffect(() => {
    if (loading) return
    // [KWT-TABS] Which view the deep link forces — read off the ROW, through the same predicates
    // the list renders, so the tab and the list cannot disagree about where an invoice lives.
    //
    // Null is set deliberately, not skipped. It is the answer when the link carries no focus, and
    // when the focused invoice is not in this quarter — and it is what clears the previous
    // period's answer when the accountant moves to another quarter, so a Q2 section can never pin
    // the panel in Q3. With focusTab null the URL's own tab governs again.
    const focusSectie = focusInvoiceTab(focusId, invoices)
    // De onthulling hoort bij dezelfde beweging als het scrollen: binnen de wikkel draait
    // ze in dezelfde tick, maar telt ze niet als synchrone setState in de effect-body.
    void (async () => { setFocusTab(focusSectie) })()
    if (!focusId) return
    if (!invoices.some(i => i.id === focusId)) return
    void (async () => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    })()
    // [FOCUS-KOP] Op de kop van de rij. Dit scherm heeft geen eigen balk, dus de gedeelde
    // subpagina-koptekst is de hele chrome — en die wordt gemeten, want in PWA-modus draagt hij
    // ook env(safe-area-inset-top), wat geen constante kan weten.
    const scrollTimer = setTimeout(() => {
      landRowUnderChrome(rowRefs.current[focusId], null, PAGE_HEADER_HEIGHT)
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, invoices.length])

  // [BOEK-028] Sort by marked_paid_at DESC default
  const sorted = [...invoices].sort((a, b) => {
    const da = new Date(a.marked_paid_at ?? a.invoice_date ?? 0).getTime()
    const db = new Date(b.marked_paid_at ?? b.invoice_date ?? 0).getTime()
    return sortAsc ? da - db : db - da
  })

  // [SMART-FILTER] In-page live filter over the quarter's invoices (factuurnummer /
  // klant / bedrag), via the shared decimal-aware matcher. Filters within the fixed
  // status sections below — no navigation.
  const rawKw = search.trim()
  const shown = rawKw
    ? sorted.filter((inv) => rowMatchesQuery(rawKw, [inv.invoice_number, inv.client_name], [getAmount(inv)]))
    : sorted

  // [KWT-TABS] What each tab will actually show — or NOTHING at all. countInvoiceTabs answers null
  // for a read that failed and for one that has not come back, and the strip then draws no number:
  // «Crediteuren 0» over a dead socket says this client booked no purchase invoices this quarter,
  // which is a claim about someone else's administration that a failed read may not make. Unknown
  // is not zero — the same rule the list itself obeys ([NO-SILENT-EMPTY]).
  //
  // Counted over `shown` rather than over the raw rows, so a search narrows the numbers together
  // with the lists. A tab that advertises eight invoices and then opens on none is the same lie in
  // miniature, and it is the one the accountant would hit every time they typed in the box.
  const tabTellingen = countInvoiceTabs(lezing && !lezing.error ? shown : null)

  /** The rows of the view on screen — the section's own predicate, applied once. */
  const zichtbareRijen = invoiceTabRows(shown, actieveTab)

  // [TRUST-ACCOUNTANT] The invoices-only client-side totals were removed — the quarter
  // tiles now use the reconciled /api/result + /api/aangifte figures (see `recon`), so
  // the accountant sees the SAME numbers as the owner and the ZIP.

  // [BOEK-028] accountant_status update
  // [BOEK-006] action can be null = "niet verwerkt" (neutral, accountant hasn't acted)
  // [VRAAG-EERST] 'vraag' is not a status this screen may set on its own. Since [VRAAG-SYNC] the
  // status and the question are one fact, written together by /api/accountant/invoice-question,
  // and a status without words is refused. So a question takes its own path (askQuestion below):
  // the dialog first, then one write — and it never reaches the status route.
  async function handleAction(invoiceId: string, action: ActionValue | null) {
    if (action === 'vraag') {
      await askQuestion(invoiceId)
      return
    }
    // The period this edit is being made in. Captured before the first await, so the answer lands
    // on the rows it was made on — or, if the accountant has moved on, on nothing.
    const identiteit = huidig
    setUpdatingId(invoiceId)

    // NOTE: 'voldaan' is a UI-only label, NOT a DB status (violates CHECK).
    // Creditnota stays 'paid' in DB; the UI shows "Voldaan" based on type+status.
    // (removed the previous update.status = 'voldaan' which caused a 23514 error)

    patchRij(identiteit, invoiceId, { accountant_status: action })
    // [BOEKHOUDER-DEUR] Through the server door, never straight at the table. This screen used to
    // write accountant_status with a browser UPDATE — and 'verwerkt' is the value that freezes an
    // invoice's paid state, so the app's hardest money refusal was set and cleared by a client with
    // no authorization check and no record of who did it. The door derives the accountant from the
    // session, checks the client linkage and the invoice, and writes both columns at once; the
    // database refuses this column from any session client, so there is no way round it.
    // [BOEK-006] null clears the status (neutral state) — the undo, and still a legal one.
    const res = await fetch('/api/accountant/invoice-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, invoiceId, status: action }),
    }).catch(() => null)
    const error = res && res.ok ? null : { message: res ? `door_${res.status}` : 'network' }
    if (error) {
      // revert optimistic on failure
      patchRij(identiteit, invoiceId, {
        accountant_status: invoices.find(x => x.id === invoiceId)?.accountant_status ?? null,
      })
      // [HONESTY] The revert used to happen in silence: the chip you had just
      // set slid back to its old value and nothing said why. On a screen whose
      // whole job is asserting what has been checked, a status that undoes
      // itself without a word is the one thing that must never happen.
      toast(t('bh.kwt.statusNietOpgeslagen'), { tone: 'error' })
    } else if (action === 'verwerkt') {
      // [READINESS-P3] Close the trust loop with the client. Only 'verwerkt' is announced from
      // here: a 'vraag' is announced by /api/accountant/invoice-question itself, in the same
      // request that writes it, so a second notification from this screen would tell the client
      // the same thing twice. Non-blocking; the status change already succeeded. clientId IS the
      // ZZP'er's profile id; the route verifies the accountant↔client link + writes via
      // service_role.
      const inv = invoices.find(x => x.id === invoiceId)
      // The notification below is written into the CLIENT's own app, in the client's language —
      // not the accountant's. It stays Dutch, like every other stored notification.
      const nrLabel = inv?.invoice_number ? `factuur ${inv.invoice_number}` : 'een factuur' // [TAAL-DB]
      const party = typeof inv?.client_name === 'string' && inv.client_name.trim()
        ? ` (${inv.client_name.trim()})`
        : ''
      // Direction-aware target: outgoing lives in /facturen, incoming in /incoming/manage.
      const target = inv?.direction === 'outgoing'
        ? `/dashboard/facturen?focus=${invoiceId}`
        : `/dashboard/incoming/manage?focus=${invoiceId}`
      const amount = typeof inv?.total_inc_btw === 'number' && inv.total_inc_btw > 0
        ? ` · ${new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(inv.total_inc_btw)}`
        : ''
      const title = 'Factuur verwerkt' // [TAAL-DB] stored notification — the client's screen, not this one
      const body = `Je boekhouder heeft ${nrLabel}${party}${amount} verwerkt.` // [TAAL-DB]
      try {
        await fetch('/api/notifications/notify-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, title, body, type: 'status', link: target }),
        })
      } catch { /* non-blocking — status already saved */ }
    }
    setUpdatingId(null)
  }

  // [VRAAG-EERST] The dialog first. Cancelling means nothing happened — no write, no chip, no
  // notification. Then exactly one POST to /api/accountant/invoice-question, which owns the atomic
  // write (the invoice status and this accountant's question row, in one transaction), the
  // client's notification and the audit row. The chip turns to 'vraag' only after the server has
  // accepted the question, so the accountant never sees a question state the database does not
  // have. The order and the single write are proven on the pure flow in
  // src/lib/accountant-invoice-question-flow.test.ts; the wiring here is pinned by [VRAAG-EERST]
  // in lifecycle-gates.
  async function askQuestion(invoiceId: string) {
    const identiteit = huidig
    const inv = invoices.find(x => x.id === invoiceId)
    const party = typeof inv?.client_name === 'string' && inv.client_name.trim()
      ? ` (${inv.client_name.trim()})`
      : ''
    const uitleg = inv?.invoice_number
      ? t('bh.kwt.vraag.uitleg', { nummer: inv.invoice_number, partij: party })
      : t('bh.kwt.vraag.uitlegZonderNummer', { partij: party })
    const outcome = await askInvoiceQuestion({
      clientId,
      invoiceId,
      prompt: () => dialog.prompt({
        title: t('bh.kwt.vraag.titel'),
        message: uitleg,
        placeholder: t('bh.kwt.vraag.placeholder'),
        multiline: true,
        maxLength: 200,
        confirmLabel: t('bh.kwt.vraag.versturen'),
        required: true,
      }),
      post: async (body) => {
        setUpdatingId(invoiceId)
        return fetch(INVOICE_QUESTION_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      },
    })
    if (outcome.kind === 'asked') {
      patchRij(identiteit, invoiceId, { accountant_status: 'vraag' })
    } else if (outcome.kind === 'failed') {
      toast(t('bh.bev.vraag.mislukt'), { tone: 'error' })
    }
    setUpdatingId(null)
  }

  // [SUBNAV] Quarter + client name as the shared header title, with the sort
  // toggle relocated to the bar's actions slot. Called unconditionally (before
  // the loading return) so hook order stays stable.
  useSubPageHeader(
    {
      title: client
        ? t('bh.kwt.kop.metKlant', { q, jaar: year, klant: client.company_name || client.full_name || '' })
        : t('bh.kwt.kop', { q, jaar: year }),
      actions: (
        <button
          onClick={() => setSortAsc(p => !p)}
          style={{ fontSize: 13, fontWeight: 500, color: '#1A73E8', backgroundColor: '#E8F0FE', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {sortAsc ? t('bh.kwt.sorteerOudste') : t('bh.kwt.sorteerNieuwste')}
        </button>
      ),
    },
    [q, year, client?.company_name, client?.full_name, sortAsc, locale]
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#F8F9FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 14, color: '#5F6368' }}>{t('bh.kwt.laden')}</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── [KANTOOR-PERIODE] Het bekende werk, bovenaan ──────────────────────
            De boekhouder opende dit scherm op knoppen, dan twee waarschuwingspanelen, dan cijfers,
            en las daarna een paar honderd factuurregels om het WERK te ontdekken. Wat de app al
            weet staat nu eerst; de cijfers eronder; de facturen als bewijs.

            Vier bereiken, want de bronnen meten niet hetzelfde: readiness is dit kwartaal, de
            geldaudit de hele administratie, de nummering per (jaar, reeks), en de kaslade het
            HUIDIGE kwartaal (money-audit/route.ts rekent met amsterdamYear()). Alles onder één
            kwartaalkop zetten zou de enige leugen zijn waar een boekhouder naar handelt.

            Geen totaalgetal, geen groen vakje als alles klopt, en niets dat wordt onthouden —
            zie de kop van Aandachtspunten.tsx. De oude NummeringPaneel/GeldPaneel staan hier niet
            meer: hun bevindingen zitten in dit blok, en twee mounts zouden dezelfde routes een
            tweede keer ophalen. Op de schermen van de EIGENAAR blijven ze onveranderd staan. */}
        <Aandachtspunten views={werk} t={t} kwartaalLabel={`Q${q} ${year}`} />

        {/* Quarter summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            // [TRUST-ACCOUNTANT] Reconciled, turnover-aware figures (same as the ZIP +
            // owner). While they load, show "…" rather than a wrong invoices-only sum.
            { label: t('bh.kwt.omzet'),  value: recon ? NL_NUMBER.format(recon.omzet) : '…',  color: M3.success },
            { label: t('bh.kwt.kosten'), value: recon ? NL_NUMBER.format(recon.kosten) : '…', color: M3.error },
            { label: t('bh.kwt.btwSaldo'), value: recon ? NL_NUMBER.format(recon.saldo) : '…', color: '#7b1fa2' },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 12, textAlign: 'center' }}>
              <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>


        {/* [BRIDGE-A][POLISH ب-2/ب-3] Dead buttons removed (PDF Bank/CAMT/KW — legacy
            pre-pivot idea, never wired). Documenten now opens the Brug — the hub.
            [KANTOOR-LINKS] …and opens it ON this client and this quarter. It used to push the bare
            route, so the accountant left a screen headed "Klant X · Q3 2026" and arrived somewhere
            that asked them for the client and the quarter again. All three were already in scope
            here; the only thing missing was writing them down. */}
        <button
          onClick={() => router.push(brugDocumentsHref({ clientId, year, quarter: q }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, cursor: 'pointer', transition: 'background 0.1s ease', width: '100%' }}
        >
          <span className="text-xl">📂</span>
          <span className="text-xs font-semibold" style={{ color: '#ff6b00', fontSize: 13 }}>{t('bh.kwt.documenten')}</span>
          <span className="icon-dir" style={{ color: '#1A73E8', fontWeight: 600 }}>→</span>
        </button>

        {/* [COHERENCE-CLOSING] Download the closing package HERE — the exact place the
            accountant finishes marking the quarter Verwerkt. It used to live only on
            /dashboard/quarterly and the Brug, forcing a client re-selection at the finish
            line. clientId/q/year are already in scope. Same ZIP endpoint as QuarterlyOverview. */}
        <button
          onClick={async () => {
            setPackaging(true); setPackageError(null)
            try {
              const qp = new URLSearchParams({ year: String(year), quarter: String(q), clientId })
              const res = await fetch(`/api/closing-package?${qp}`)
              if (!res.ok) { setPackageError(t('bh.kwt.pakketMislukt')); return }
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `kwartaalpakket-Q${q}-${year}.zip`
              a.click()
              URL.revokeObjectURL(url)
            } catch {
              setPackageError(t('bh.kwt.pakketMislukt'))
            } finally {
              setPackaging(false)
            }
          }}
          disabled={packaging}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', backgroundColor: packaging ? '#F1F3F4' : '#1A73E8', border: 'none', borderRadius: 8, cursor: packaging ? 'default' : 'pointer', transition: 'background 0.1s ease', width: '100%' }}
        >
          <span className="text-xl">📦</span>
          <span className="text-xs font-semibold" style={{ color: packaging ? '#5F6368' : '#FFFFFF', fontSize: 13 }}>
            {packaging ? t('bh.kwt.pakketBezig') : t('bh.kwt.pakketDownload')}
          </span>
        </button>
        {packageError && (
          <p style={{ fontSize: 12.5, color: '#B3261E', margin: '-8px 2px 0' }}>{packageError}</p>
        )}

        {/* [BOEK-028] Invoice table — outgoing + incoming merged */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 id={FACTUREN_KOP_ID} style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: 0 }}>
              {t('bh.kwt.facturen')}
              {/* [KWT-TABS] The total, and only when there was something to total. A failed read
                  left this heading saying "Facturen (0)" directly above the sentence explaining
                  that nothing could be read — the same unknown-as-zero the tab counts refuse. */}
              {!loadError && (
                <span style={{ fontSize: 14, fontWeight: 400, marginInlineStart: 6, color: '#5F6368' }}>
                  ({invoices.length})
                </span>
              )}
            </h2>
          </div>

          {sorted.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', position: 'relative' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 28, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('bh.kwt.zoekPlaceholder')}
                aria-label={t('bh.kwt.zoekAria')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 34px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 14, outline: 'none', color: '#202124', fontFamily: "'Roboto', sans-serif" }}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label={t('bh.kwt.wissen')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 24, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
          )}

          {loadError ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <p style={{ fontSize: 14, color: '#C5221F', margin: '0 0 12px' }}>
                {t('bh.kwt.leesfout')}
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #DADCE0', background: '#FFF', color: '#1A73E8', fontSize: 14, cursor: 'pointer' }}
              >
                {t('bh.kwt.opnieuw')}
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '48px 0' }}>
              {t('bh.kwt.geenFacturen', { q, jaar: year })}
            </p>
          ) : (
            <>
              {/* [KWT-TABS] The evidence, one view at a time. Debiteuren, Crediteuren and Voldaan
                  are the same quarter seen three ways — sibling views, not a sequence — and they
                  used to be rendered one under the other. For a retail quarter that is a wall
                  several screens long, and the accountant scrolled past two complete lists to
                  reach the one they opened the screen for.

                  Only the evidence is tabbed. Aandachtspunten, the three figures, the documents
                  and the quarter package all stay above this card, in the open, exactly where
                  Batch 3 put them: a tab is for arranging siblings, never for putting a finding
                  somewhere the accountant has to think to look. */}
              <FactuurTabs
                active={actieveTab}
                counts={tabTellingen}
                onSelect={kiesTab}
                t={t}
                dir={LOCALE_META[locale].dir}
                labelledBy={FACTUREN_KOP_ID}
              />
              <div
                role="tabpanel"
                id={invoiceTabPanelId(actieveTab)}
                aria-labelledby={invoiceTabId(actieveTab)}
                tabIndex={0}
              >
                {/* What this view means, in the section's own words — the same sentence that used
                    to sit beside its heading when the three lists were stacked. */}
                <p style={{ margin: 0, padding: '8px 16px', fontSize: 12, color: '#5F6368', backgroundColor: '#F8F9FA', borderBottom: '1px solid #E0E0E0' }}>
                  {t(invoiceSection(actieveTab).subKey)}
                </p>
                {zichtbareRijen.length === 0 ? (
                  <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '48px 0' }}>
                    {/* An empty view is not an empty quarter: the other two tabs may be full, and
                        "Geen facturen in Q3 2026" would be a claim about all three. */}
                    {rawKw ? t('bh.kwt.geenGevonden', { zoek: rawKw }) : t('bh.kwt.sectie.geen')}
                  </p>
                ) : (
                    zichtbareRijen.map(invoice => {
                const amount      = getAmount(invoice)
                const isExpanded  = expandedId === invoice.id
                const isUpdating  = updatingId === invoice.id
                const isOutgoing  = invoice.direction === 'outgoing'
                const rowBg       = ACCOUNTANT_ACTIONS.find(a => a.value === invoice.accountant_status)?.rowBg

                return (
                  <div key={invoice.id}
                    ref={el => { rowRefs.current[invoice.id] = el }}
                    style={{
                      backgroundColor: rowBg,
                      opacity: isUpdating ? 0.6 : 1,
                      boxShadow: highlightId === invoice.id ? '0 0 0 2px #1A73E8' : undefined,
                      transition: 'box-shadow 0.4s ease',
                    }}>

                    {/* Main row — click to expand inline */}
                    <div
                      className="px-4 py-3 cursor-pointer active:opacity-80 transition-opacity"
                      onClick={onRowTap(() => {
                        setExpandedId(isExpanded ? null : invoice.id)
                      })}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* [ROW-LAYOUT] minWidth:0 lets the invoice number actually ellipsize in
                                this flex row; without it a long number spills over the badges/amount. */}
                            <p style={{ minWidth: 0, fontSize: 14, fontWeight: 500, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {/* [QUARTER-VENDOR-NAME v2] invoice_number primary — matches bridge pattern */}
                              {invoice.invoice_number}
                            </p>
                            {/* direction badge */}
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={{
                                backgroundColor: isOutgoing ? '#E6F4EA' : '#FCE8E6',
                                color: isOutgoing ? '#137333' : '#C5221F',
                              }}>
                              {isOutgoing ? t('bh.kwt.uitgaand') : t('bh.kwt.inkomend')}
                            </span>
                            {/* [BRIDGE-A] Verlopen — computed, display-only */}
                            {isVerlopen(invoice) && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                                style={{ backgroundColor: '#F9DEDC', color: '#B3261E' }}>
                                {t('bh.kwt.verlopen')}
                              </span>
                            )}
                            {invoice.invoice_type === 'creditnota' && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#FCE8E6', color: '#C5221F', fontWeight: 500 }}>
                                {t('bh.kwt.creditnota')}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: '#5F6368', marginTop: 2 }}>
                            {/* [QUARTER-VENDOR-NAME v2] party name secondary — incoming=vendor, outgoing=client */}
                            {invoice.client_name && (
                              <span style={{ fontWeight: 500, color: '#202124' }}>{invoice.client_name} · </span>
                            )}
                            {fmt(invoice.invoice_date)}
                            {invoice.marked_paid_at && (
                              <span> · {t('bh.kwt.betaaldOp', { datum: fmt(invoice.marked_paid_at) })}</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p style={{ fontSize: 14, fontWeight: 600, color: amount >= 0 ? '#34A853' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                            {NL_NUMBER.format(amount)}
                          </p>
                        </div>
                      </div>

                      {/* [BOEK-006] status badge preview (when collapsed) */}
                      {!isExpanded && invoice.accountant_status && (
                        <div className="mt-1.5">
                          <ActionBadge value={invoice.accountant_status} />
                        </div>
                      )}
                    </div>

                    {/* [BOEK-028] Inline expand — no page navigation */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1" onClick={e => e.stopPropagation()}>
                        <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>

                          {/* [BOEK-006] Status actions — 3 states + neutral, one tap */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <span style={{ fontSize: 12, color: '#5F6368', fontWeight: 500 }}>{t('bh.kwt.statusLabel')}</span>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              {ACCOUNTANT_ACTIONS.map(a => {
                                const active = invoice.accountant_status === a.value
                                return (
                                  <button key={a.value}
                                    onClick={() => handleAction(invoice.id, active ? null : a.value)}
                                    style={{
                                      padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                      backgroundColor: active ? a.bg : '#FFFFFF',
                                      color: active ? a.color : '#5F6368',
                                      border: active ? `1px solid ${a.color}` : '1px solid #E0E0E0',
                                      cursor: 'pointer',
                                    }}>
                                    {t(a.labelKey)}
                                  </button>
                                )
                              })}
                              {/* neutral — accountant hasn't acted */}
                              <button
                                onClick={() => handleAction(invoice.id, null)}
                                style={{
                                  padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                  backgroundColor: !invoice.accountant_status ? '#f1f3f4' : '#FFFFFF',
                                  color: !invoice.accountant_status ? '#5f6368' : '#5F6368',
                                  border: !invoice.accountant_status ? '1px solid #5f6368' : '1px solid #E0E0E0',
                                  cursor: 'pointer',
                                }}>
                                {t('bh.kwt.nietVerwerkt')}
                              </button>
                            </div>
                          </div>

                          {/* Client info */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>{t('bh.kwt.aan')}</span>
                              <span style={{ fontWeight: 500, textAlign: 'end', color: '#202124' }}>
                                {invoice.client_name || '—'}
                              </span>
                            </div>
                            {invoice.client_btw_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>{t('bh.kwt.btwNummer')}</span>
                                <span className="font-medium" style={{ fontWeight: 500, color: '#202124' }}>
                                  {invoice.client_btw_number}
                                </span>
                              </div>
                            )}
                            {/* [BOEK-028] replaced_by_number — shown on creditnota — May 2026 */}
                            {invoice.invoice_type === 'creditnota' && invoice.replaced_by_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>{t('bh.kwt.vervangt')}</span>
                                <span className="font-medium" style={{ color: M3.error }}>
                                  {invoice.replaced_by_number}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Amounts — sign follows direction */}
                          {[
                            {
                              label: t('bh.kwt.exclBtw'),
                              value: isOutgoing ? (invoice.total_ex_btw ?? 0) : -(invoice.total_ex_btw ?? 0),
                            },
                            {
                              label: t('bh.kwt.btwTarief', { tarief: getBtwRate(invoice) }),
                              value: isOutgoing ? (invoice.btw_amount ?? 0) : -(invoice.btw_amount ?? 0),
                            },
                            {
                              label: t('bh.kwt.inclBtw'),
                              value: amount,
                            },
                          ].map(row => (
                            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>{row.label}</span>
                              <span className="font-semibold"
                                style={{ fontWeight: 500, color: (row.value ?? 0) >= 0 ? '#202124' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                                {NL_NUMBER.format(row.value ?? 0)}
                              </span>
                            </div>
                          ))}

                          {/* [VOORSTEL] A correction the client taps OK on. Only on a booked, unpaid
                              purchase invoice — the only state the client's own door opens on. */}
                          {!isOutgoing && invoice.status === 'received' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                              {voorstelStatus[invoice.id] && (
                                <span style={{ fontSize: 12, fontWeight: 600, color: voorstelStatus[invoice.id] === 'accepted' ? '#137333' : voorstelStatus[invoice.id] === 'open' ? '#1967D2' : '#5F6368' }}>
                                  {t(VOORSTEL_STATUS_KEY[voorstelStatus[invoice.id]])}
                                </span>
                              )}
                              {voorstelOpenVoor === invoice.id ? (
                                <VoorstelFormulier
                                  clientId={clientId}
                                  invoice={invoice}
                                  t={t}
                                  DateField={DateFieldNL}
                                  onClose={() => setVoorstelOpenVoor(null)}
                                  onSent={() => {
                                    setVoorstelStatus((s) => ({ ...s, [invoice.id]: 'open' }))
                                    setVoorstelOpenVoor(null)
                                    toast(t('bh.kwt.voorstel.verstuurd'))
                                  }}
                                  onError={(msg: string | null) => toast(msg || t('bh.kwt.voorstel.fout'), { tone: 'error' })}
                                />
                              ) : voorstelStatus[invoice.id] !== 'open' && (
                                <button
                                  onClick={() => setVoorstelOpenVoor(invoice.id)}
                                  style={{ width: '100%', padding: '8px 16px', borderRadius: 8, backgroundColor: '#FFFFFF', color: '#1A73E8', fontSize: 13, fontWeight: 500, border: '1px solid #1A73E8', cursor: 'pointer' }}>
                                  {t('bh.kwt.voorstel.knop')}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Openen button — only this navigates */}
                          <div className="pt-2">
                            <button
                              onClick={() => router.push(`/dashboard/invoice/${invoice.id}?from=client&clientId=${clientId}&q=${q}&year=${year}`)}
                              style={{ width: '100%', padding: '8px 16px', borderRadius: 8, backgroundColor: '#1A73E8', color: '#FFFFFF', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
                              {t('bh.kwt.openen')} →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )
                    })
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}