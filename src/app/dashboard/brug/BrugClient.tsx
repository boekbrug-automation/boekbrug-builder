'use client'

// src/app/dashboard/brug/BrugClient.tsx
// [BOEK-002] Bridge view — drill-down navigation (mobile-first).
// Receives the pre-built TreeNode[] from the server and renders it as a
// breadcrumb + folder/file list. No fetching, no rendering logic here —
// that all lives server-side in bridge-tree.ts.

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import type { TreeNode, NodeBadge } from '@/lib/bridge-tree'
import { lastCompletedQuarter } from '@/lib/quarter'
import { rowMatchesQuery } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import { failureText } from '@/lib/server-message'

// [BRIDGE-HUB] Per-client readiness summary (Layer 1). Mirrors the server type
// in page.tsx — kept inline to avoid a cross-file import of a server module.
interface ClientSummary {
  id: string
  label: string
  verified: number
  pending: number
  status: 'ready' | 'review' | 'empty'
}

// [READINESS-P3] Accountant-asserted per-document status, keyed by document id.
// Empty map / missing key = no status claim (honest default — never invented).
type DocStatusMap = Record<string, { status: string; vraag_text: string | null }>

// Document status → badge label + tone. 'te_verwerken' is the neutral default;
// the three action buttons drive verwerkt / in_behandeling / vraag.
// [TAAL] The map keys ARE the API status values and stay Dutch; only the label is a catalogue
// key, translated at render time (a module-level const cannot know the viewer's locale).
const DOC_STATUS_META: Record<string, { key: MessageKey; tone: NodeBadge['tone'] }> = {
  verwerkt:       { key: 'brug.status.verwerkt',      tone: 'success' },
  in_behandeling: { key: 'brug.status.inBehandeling', tone: 'warning' },
  vraag:          { key: 'brug.status.vraag',         tone: 'error' },
  te_verwerken:   { key: 'brug.status.teVerwerken',   tone: 'neutral' },
}

// ─── Design tokens — Material You (BoekBrug Design System v1.0) ───────────────
const FONT = "'Roboto', -apple-system, sans-serif"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const NL_EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED. fmtDate below feeds this a DATE-ONLY string, and `new Date('2026-01-01')`
// is midnight UTC — formatted in the viewer's zone, every invoice date west of UTC renders a day
// early, and with the year shown that is the wrong TAX YEAR on the accountant's own bridge.
// format-nl.ts:17-23 forbids exactly this.
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' })
const fmtEur = (n: number | null) => (n == null ? '' : NL_EUR.format(n))
const fmtDate = (s: string | null) => (s ? NL_DATE.format(new Date(s)) : '')

// Badge tone → colors
const TONE: Record<NodeBadge['tone'], { bg: string; color: string }> = {
  success: { bg: '#CEEAD6', color: '#137333' },
  warning: { bg: '#FEE8C4', color: '#7C5800' },
  error:   { bg: '#F9DEDC', color: '#B3261E' },
  info:    { bg: '#D3E3FD', color: '#1967D2' },
  neutral: { bg: '#f1f3f4', color: '#5f6368' },
}

// [BRIDGE-POLISH 3a-1] Direction marker — reuses existing TONE swatches so no
// new palette is introduced. Uitg. (outgoing) = success green; Ink. (incoming)
// = error red — matching the colour language used elsewhere in the bridge.
const DIRECTION_MARK: Record<'outgoing' | 'incoming', { key: MessageKey; tone: NodeBadge['tone'] }> = {
  outgoing: { key: 'brug.uitgaand', tone: 'success' },
  incoming: { key: 'brug.inkomend', tone: 'error' },
}

// ─── Level view: from flat nodes + current path → subfolders + files here ─────
interface LevelView {
  folders: { name: string; count: number }[]
  files: TreeNode[]
}

function computeLevel(nodes: TreeNode[], cwd: string[], showHidden: boolean): LevelView {
  const folderCounts = new Map<string, number>()
  const files: TreeNode[] = []

  for (const n of nodes) {
    if (n.hidden && !showHidden) continue
    if (n.path.length < cwd.length) continue
    let underCwd = true
    for (let i = 0; i < cwd.length; i++) {
      if (n.path[i] !== cwd[i]) { underCwd = false; break }
    }
    if (!underCwd) continue

    const rest = n.path.slice(cwd.length)
    if (rest.length === 0) {
      files.push(n)
    } else {
      const sub = rest[0]
      folderCounts.set(sub, (folderCounts.get(sub) ?? 0) + 1)
    }
  }

  const folders = [...folderCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))

  files.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return { folders, files }
}

// Whether any hidden (e.g. archived) node exists at all → show the toggle.
function hasHidden(nodes: TreeNode[]): boolean {
  return nodes.some(n => n.hidden)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BrugClient({ nodes, role, clientSummaries, docStatus, readFailed }: { nodes: TreeNode[]; role: string | null; clientSummaries?: ClientSummary[]; docStatus: DocStatusMap; readFailed?: string[] }) {
  const t = translator(useLocale())
  const [cwd, setCwd] = useState<string[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const router = useRouter()

  // [READINESS-P3] The accountant's own just-clicked statuses, held HERE and not inside each
  // row. FileRow seeded them from the prop with useState, whose initialiser runs only on mount —
  // and rows unmount the moment the accountant opens another folder. So marking a document
  // 'Verwerkt', stepping into a folder and stepping back showed the OLD badge again: the click
  // looked lost, and the natural response is to click it a second time. Lifting the override to
  // the component that survives navigation fixes that.
  //
  // It is CLEARED whenever a fresh docStatus arrives from the server (router.refresh, which
  // [BRIDGE-REFRESH] fires on every tab focus): the server is authoritative, and a stale
  // override would then hide a status set on another device — the very case that refresh exists
  // for. Render-phase derivation, the same pattern prevClientRoot below already uses.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})
  const [seenDocStatus, setSeenDocStatus] = useState(docStatus)
  if (seenDocStatus !== docStatus) {
    setSeenDocStatus(docStatus)
    setStatusOverrides({})
  }

  // [BRIDGE-HUB] Layer 2 — accountant control center: pick a client (dropdown),
  // then switch tabs (Kwartaal / Documenten). The classic folder tree is reused
  // for the Documenten tab, scoped to the selected client.
  const isAccountant = role === 'accountant'
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [hubTab, setHubTab] = useState<'overzicht' | 'kwartaal' | 'documenten'>('overzicht')
  const selectedClient = useMemo(
    () => clientSummaries?.find(c => c.id === selectedClientId) ?? null,
    [clientSummaries, selectedClientId]
  )
  const curYear = new Date().getFullYear()

  // [BRIDGE-QUARTER-PICKER] The accountant works per quarter/year and can switch both
  // (Q1–Q4 buttons + year arrows). The default lands on the LAST COMPLETED quarter — the
  // one whose BTW is due — via the SHARED quarter.ts helper (UTC), so the accountant hub
  // opens on the SAME quarter the owner's klaar/resultaat/aangifte default to (previously
  // this was a duplicated local-time computation that could drift a day at a boundary).
  // [PAKKET-STAY] Fetch the ZIP instead of navigating to it, so a refusal is a message here
  // rather than a page of JSON with the hub's whole selection gone.
  const [pkgBusy, setPkgBusy] = useState(false)
  const [pkgError, setPkgError] = useState<string | null>(null)

  // [PAKKET-VERS] Per klant: wanneer dit kwartaalpakket voor het laatst is opgehaald, en of de
  // administratie sindsdien veranderde. De zin komt als DATA van de server (net als pkgError
  // hierboven) — dit scherm verzint er geen taal bij. Eén vraag dekt alle klanten tegelijk.
  const [versMap, setVersMap] = useState<Record<string, { downloadedAt: string; total: number; sentence: string; unknown?: boolean }>>({})
  const loadVers = useCallback(async (year: number, quarter: number) => {
    try {
      const res = await fetch(`/api/closing-package/vers?year=${year}&quarter=${quarter}`)
      if (!res.ok) return
      const json = await res.json()
      if (json?.perClient) setVersMap(json.perClient)
    } catch { /* geen regel is eerlijker dan een verzonnen regel */ }
  }, [])

  async function downloadPackage(clientId: string, year: number, quarter: number) {
    setPkgBusy(true); setPkgError(null)
    try {
      const res = await fetch(`/api/closing-package?clientId=${encodeURIComponent(clientId)}&year=${year}&quarter=${quarter}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }))
        setPkgError(failureText(res.status, j, t('brug.fout.pakket')))
        return
      }
      const blob = await res.blob()
      // Prefer the filename the server chose; fall back to the same shape it uses.
      const cd = res.headers.get('content-disposition') ?? ''
      const named = /filename="?([^";]+)"?/i.exec(cd)?.[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named || `BoekBrug-Q${quarter}-${year}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // De kopie op de schijf is nu de administratie: de versheidsregel hoort dat direct te
      // zeggen, anders blijft een amberkleurige waarschuwing staan over een download van net.
      void loadVers(year, quarter)
    } catch {
      setPkgError(t('brug.fout.pakketOffline'))
    } finally {
      setPkgBusy(false)
    }
  }

  const lastCompleted = lastCompletedQuarter()
  const [selectedYear, setSelectedYear] = useState<number>(lastCompleted.year)
  const [selectedQuarter, setSelectedQuarter] = useState<number>(lastCompleted.quarter)

  // [PAKKET-VERS] De vraag hoort bij het gekozen kwartaal, niet bij de gekozen klant: het
  // antwoord dekt alle klanten, dus wisselen van klant kost geen extra rondje.
  useEffect(() => {
    if (!isAccountant) return
    // Zelfde idioom als de andere effecten hier: de setState gebeurt in de callback van een
    // async functie, nooit in de effect-body zelf.
    void (async () => { await loadVers(selectedYear, selectedQuarter) })()
  }, [isAccountant, selectedYear, selectedQuarter, loadVers])

  // [BRIDGE-REFRESH] Re-fetch when the tab regains focus. The page is
  // force-dynamic server-side, but tab/folder navigation here is client-side
  // state (cwd) — it never re-runs the server fetch. So when the accountant
  // processed an invoice / the client marked one paid in ANOTHER tab and comes
  // back, router.refresh() re-runs the server component and the fresh nodes
  // flow in as a prop. No manual reload needed. (Layer 1 — full Realtime for
  // the bridge comes later with the interactive hub.)
  //
  // Debounced, and deliberately: both `visibilitychange` and `focus` fire on a single return to
  // the tab, so this ran the whole server pass twice — three full table page-walks, the tree
  // build and every signed URL, for one glance at the screen. One refresh per return is the
  // intent; two was an accident of listening to two events for the same thing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; router.refresh() }, 150)
    }
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [router])

  const level = useMemo(() => computeLevel(nodes, cwd, showHidden), [nodes, cwd, showHidden])
  const showToggle = useMemo(() => hasHidden(nodes), [nodes])

  // [SMART-FILTER] Zoeken in de brug — de accountant zoekt een factuur/leverancier/
  // bedrag zonder door mappen te klikken. Terwijl er getypt wordt, plat de boom af:
  // ALLE bestanden onder het huidige pad (elke submap) die matchen, i.p.v. alleen
  // het huidige niveau. Elke TreeNode is een bestand; mappen zijn virtueel (paden).
  const [search, setSearch] = useState('')
  const treeSearch = useMemo(() => {
    const q = search.trim()
    if (!q) return null
    const out: TreeNode[] = []
    for (const n of nodes) {
      if (n.hidden && !showHidden) continue
      if (n.path.length < cwd.length) continue
      let under = true
      for (let i = 0; i < cwd.length; i++) if (n.path[i] !== cwd[i]) { under = false; break }
      if (!under) continue
      if (rowMatchesQuery(q, [n.displayName, n.partyName], [n.amount])) out.push(n)
    }
    out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return out
  }, [nodes, cwd, showHidden, search])

  const isEmpty = level.folders.length === 0 && level.files.length === 0

  // [HEADER-SYSTEM] Title "Brug" + back live in the shared sub-page bar
  // (DashboardChrome/STATIC_TITLES). The old in-body header duplicated the title
  // and offered a "Home" link instead of back; it is removed and only the explicit
  // refresh action is pushed into the shared bar's actions slot.
  useSubPageHeader(
    {
      actions: (
        <button
          onClick={() => router.refresh()}
          title={t('lijst.vernieuwen')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>refresh</span>
          {t('lijst.vernieuwen')}
        </button>
      ),
    },
    [],
  )

  // [BRIDGE-HUB] When the accountant picks a client and opens the Documenten
  // tab, scope the tree to that client by seeding cwd to ['Klanten', label].
  // Selecting a different client resets the dive.
  // [REACT] State bijstellen tijdens de render in plaats van via een effect: dit is afgeleide
  // state (welke klantmap hoort bij de huidige keuze), geen synchronisatie met de buitenwereld.
  // Het effect deed een tweede renderronde en liet de gebruiker één frame de oude map zien.
  const clientRoot =
    isAccountant && selectedClient && hubTab === 'documenten' ? selectedClient.label : null
  const [prevClientRoot, setPrevClientRoot] = useState<string | null>(clientRoot)
  if (prevClientRoot !== clientRoot) {
    setPrevClientRoot(clientRoot)
    if (clientRoot) {
      // Zit de gebruiker al ín deze klant, dan blijft de diepere positie staan.
      setCwd(prev =>
        prev[0] === 'Klanten' && prev[1] === clientRoot ? prev : ['Klanten', clientRoot],
      )
    }
  }

  return (
    <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px 16px 80px', fontFamily: FONT }}>

      {/* [NO-SILENT-EMPTY] A source of the bridge could not be read. Without this the page just
          looks empty — and an empty bridge is the app asserting that the client has nothing,
          which a professional then acts on. Say which part is missing and offer the retry. */}
      {readFailed && readFailed.length > 0 && (
        <div role="alert" style={{ marginBottom: 16, background: '#F9DEDC', border: `1px solid ${M3.error}`, borderRadius: R.lg, padding: '14px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#B3261E' }}>
            {/* [TAAL] The part names come from the server as printed; only the conjunction and
                the sentence around them are translated. */}
            {t('brug.fout.nietLaden', { parts: readFailed.join(` ${t('brug.en')} `) })}
          </div>
          <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 4, lineHeight: 1.5 }}>
            {t('brug.fout.nietCompleet')}
          </div>
          <button
            onClick={() => router.refresh()}
            style={{ marginTop: 10, padding: '8px 16px', borderRadius: R.md, border: 'none', background: M3.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
          >
            {t('inkoop.opnieuwProberen')}
          </button>
        </div>
      )}

      {/* [BRIDGE-HUB] Layer 2 — accountant control center: client dropdown +
          persistent Pakket action + tabs. ZZP keeps the classic tree below. */}
      {isAccountant && clientSummaries && clientSummaries.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {/* Client picker + Pakket */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setHubTab('overzicht') }}
                style={{ width: '100%', appearance: 'none', padding: '12px 40px 12px 14px', borderRadius: R.md, border: `1px solid ${M3.outline}`, background: '#fff', fontSize: 15, fontWeight: 600, color: M3.onSurface, fontFamily: FONT, cursor: 'pointer' }}
              >
                <option value="">{t('brug.kiesKlantOptie')}</option>
                {clientSummaries.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <span className="material-symbols-outlined" style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: M3.outline, fontSize: 22 }} aria-hidden>expand_more</span>
            </div>
            {/* [PAKKET-STAY] Fetched, not navigated to. This was a plain <a href>, and the route
                answers every refusal with JSON — so a 403/500 replaced the hub with a page of raw
                braces AND threw away the client, quarter and tab the accountant had selected (all
                client state). Now a failure is a sentence beside the button and nothing is lost. */}
            {selectedClient && (
              <button
                onClick={() => downloadPackage(selectedClient.id, selectedYear, selectedQuarter)}
                disabled={pkgBusy}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px', borderRadius: R.md, border: 'none', background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, cursor: pkgBusy ? 'default' : 'pointer', fontFamily: FONT, flexShrink: 0, opacity: pkgBusy ? 0.6 : 1 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>inventory_2</span>
                {pkgBusy ? t('brug.bezig') : t('brug.downloadKwartaal')}
              </button>
            )}
          </div>
          {pkgError && (
            <div role="alert" style={{ marginTop: -6, marginBottom: 12, fontSize: 13, color: M3.error, lineHeight: 1.45 }}>
              {pkgError}
            </div>
          )}

          {/* [PAKKET-VERS] De kopie op de eigen schijf veroudert vanaf het moment van downloaden.
              Amber zodra er sindsdien iets in het kwartaal bijkwam (of we het niet konden
              nakijken), grijs zolang de kopie nog de administratie is. Alleen aanwezig als deze
              boekhouder dit kwartaal al eens ophaalde — anders is er geen kopie die oud kan zijn. */}
          {selectedClient && versMap[selectedClient.id] && (
            <p style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5, lineHeight: 1.5, color: (versMap[selectedClient.id].total > 0 || versMap[selectedClient.id].unknown) ? '#7C5800' : M3.onSurfaceVariant }}>
              {versMap[selectedClient.id].sentence}
            </p>
          )}

          {selectedClient ? (
            <>
              {/* [BRIDGE-QUARTER-PICKER] Quarter selector (Q1–Q4) + year arrows.
                  Shows all four quarters so an empty current quarter never hides
                  a full earlier one. Defaults to the last completed quarter. */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {[1, 2, 3, 4].map(q => {
                  const active = selectedQuarter === q
                  return (
                    <button
                      key={q}
                      onClick={() => setSelectedQuarter(q)}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: R.md, cursor: 'pointer',
                        fontFamily: FONT, fontSize: 14, fontWeight: 600,
                        border: `1px solid ${active ? M3.primary : M3.outline}`,
                        background: active ? M3.primary : '#fff',
                        color: active ? M3.onPrimary : M3.onSurface,
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      Q{q}
                    </button>
                  )
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInlineStart: 8 }}>
                  <button
                    onClick={() => setSelectedYear(y => Math.max(2000, y - 1))}
                    title={t('wh.vorigJaar')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: R.sm, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary }}
                  >
                    <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_left</span>
                  </button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, minWidth: 40, textAlign: 'center' }}>
                    {selectedYear}
                  </span>
                  <button
                    onClick={() => setSelectedYear(y => Math.min(y + 1, curYear))}
                    disabled={selectedYear >= curYear}
                    title={t('wh.volgendJaar')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: R.sm, border: 'none', background: 'none', cursor: selectedYear >= curYear ? 'default' : 'pointer', color: selectedYear >= curYear ? M3.outline : M3.primary, opacity: selectedYear >= curYear ? 0.4 : 1 }}
                  >
                    <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_right</span>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${M3.surfaceVariant}` }}>
                {([['overzicht', 'brug.tab.overzicht', 'fact_check'], ['kwartaal', 'brug.tab.kwartaal', 'bar_chart'], ['documenten', 'brug.tab.documenten', 'folder']] as const).map(([key, labelKey, icon]) => (
                  <button
                    key={key}
                    onClick={() => setHubTab(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 600, color: hubTab === key ? M3.primary : M3.outline, borderBottom: `2px solid ${hubTab === key ? M3.primary : 'transparent'}`, marginBottom: -1 }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>{icon}</span>
                    {t(labelKey)}
                  </button>
                ))}
              </div>

              {/* Overzicht tab — readiness status + honest missing list */}
              {hubTab === 'overzicht' && (
                <OverzichtPanel clientId={selectedClient.id} year={selectedYear} quarter={selectedQuarter} />
              )}

              {/* Kwartaal tab — lazy-loaded quarter numbers */}
              {hubTab === 'kwartaal' && (
                <KwartaalPanel clientId={selectedClient.id} year={selectedYear} quarter={selectedQuarter} />
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#C4C7C5', display: 'block', marginBottom: 8 }} aria-hidden>groups</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, margin: 0 }}>{t('brug.kiesKlant')}</p>
              <p style={{ fontSize: 12.5, color: M3.outline, margin: '4px 0 0' }}>{t('brug.klantenGekoppeld', { count: clientSummaries.length })}</p>
            </div>
          )}
        </div>
      )}

      {/* Document tree — for ZZP always; for accountant only inside Documenten tab */}
      {(!isAccountant || (selectedClient && hubTab === 'documenten')) && (
      <>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 12, fontSize: 14 }}>
        <button
          onClick={() => setCwd([])}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: cwd.length === 0 ? M3.onSurface : M3.primary, fontWeight: cwd.length === 0 ? 700 : 600, fontFamily: FONT, padding: '4px 6px', borderRadius: R.sm }}
        >
          {t('brug.alles')}
        </button>
        {cwd.map((seg, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-outlined icon-dir" style={{ fontSize: 16, color: M3.outline }} aria-hidden>chevron_right</span>
            <button
              onClick={() => setCwd(cwd.slice(0, i + 1))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === cwd.length - 1 ? M3.onSurface : M3.primary, fontWeight: i === cwd.length - 1 ? 700 : 600, fontFamily: FONT, padding: '4px 6px', borderRadius: R.sm }}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Archief toggle (only if hidden nodes exist) */}
      {showToggle && (
        <button
          onClick={() => setShowHidden(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '6px 12px', borderRadius: R.full, border: `1px solid ${M3.outline}`, background: showHidden ? M3.primaryContainer : 'transparent', color: showHidden ? '#041E49' : M3.outline, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
            {showHidden ? 'visibility' : 'visibility_off'}
          </span>
          {t('brug.archief')}
        </button>
      )}

      {/* [SMART-FILTER] Zoek binnen deze klant/map — plat over alle submappen. */}
      {nodes.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: M3.outline }} aria-hidden>search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('brug.zoek')}
            aria-label={t('brug.zoek.aria')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 38px', borderRadius: R.lg, border: `1px solid ${M3.outline}`, fontSize: 14.5, outline: 'none', background: '#fff', color: M3.onSurface, fontFamily: FONT }}
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label={t('inkoop.wissen')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: R.full, border: 'none', background: '#e5e5ea', color: '#3a3a3c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
          )}
        </div>
      )}

      {treeSearch !== null ? (
        treeSearch.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
            <p style={{ fontSize: 14, color: M3.outline, margin: 0 }}>{t('brug.zoek.geen', { query: search.trim() })}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 12.5, color: M3.outline, margin: '0 0 4px' }}>
              {treeSearch.length === 1
                ? t('brug.zoek.resultaat', { count: 1 })
                : t('brug.zoek.resultaten', { count: treeSearch.length })}
            </p>
            {treeSearch.map(file => (
              <FileRow key={`${file.source}-${file.id}`} node={file} isClient={!isAccountant} docStatus={docStatus} override={statusOverrides[file.id]} onStatusSet={(s) => setStatusOverrides(prev => ({ ...prev, [file.id]: s }))} />
            ))}
          </div>
        )
      ) : (
        <>
          {/* Empty state */}
          {isEmpty && (
            <div style={{ textAlign: 'center', padding: '56px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 44, color: '#C4C7C5', display: 'block', marginBottom: 10 }} aria-hidden>folder_open</span>
              <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: 0 }}>{t('brug.leeg')}</p>
            </div>
          )}

          {/* Folders */}
          {level.folders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: level.files.length > 0 ? 16 : 0 }}>
              {level.folders.map(f => (
                <button
                  key={f.name}
                  onClick={() => setCwd([...cwd, f.name])}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: R.lg, border: 'none', background: '#fff', boxShadow: EL1, cursor: 'pointer', fontFamily: FONT, textAlign: 'start', width: '100%' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 24, color: M3.primary }} aria-hidden>folder</span>
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: M3.onSurface }}>{f.name}</span>
                  <span style={{ fontSize: 12, color: M3.outline, fontWeight: 600 }}>{f.count}</span>
                  <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: M3.outline }} aria-hidden>chevron_right</span>
                </button>
              ))}
            </div>
          )}

          {/* Files at this level */}
          {level.files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {level.files.map(file => (
                <FileRow key={`${file.source}-${file.id}`} node={file} isClient={!isAccountant} docStatus={docStatus} override={statusOverrides[file.id]} onStatusSet={(s) => setStatusOverrides(prev => ({ ...prev, [file.id]: s }))} />
              ))}
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  )
}

// ─── File / invoice row ────────────────────────────────────────────────────────
function FileRow({ node, isClient, docStatus, override, onStatusSet }: { node: TreeNode; isClient: boolean; docStatus: DocStatusMap; override?: string; onStatusSet: (status: string) => void }) {
  const t = translator(useLocale())
  const dialog = useDialog()
  const icon = node.source === 'invoice' ? 'receipt_long' : 'description'

  // [READINESS-P3] Document processing status (accountant assertion). Only meaningful for
  // document nodes; invoices carry their own badges from bridge-tree. DERIVED, never frozen:
  // the server value plus the accountant's own just-clicked override, which lives in the parent
  // so it survives this row unmounting when they open another folder. Honest default: a
  // document with no row and no click is `null` → no status badge is ever shown.
  const isDoc = node.source === 'document'
  const status = isDoc ? (override ?? docStatus[node.id]?.status ?? null) : null
  const [busy, setBusy] = useState(false)
  // [BRUG-STATUS-HONEST] A refused or failed write used to change nothing at all — no message,
  // no retry, the button just stopped being busy. The accountant walks away believing the
  // document is marked. Worse on 'vraag': they type up to 500 characters for their client, the
  // POST fails, and the text is gone with nothing said — which is precisely the "typing into
  // the void" the dialog above was written to end.
  const [saveError, setSaveError] = useState<string | null>(null)

  async function applyStatus(next: 'verwerkt' | 'in_behandeling' | 'vraag') {
    let vraagText: string | undefined
    if (next === 'vraag') {
      // [BRUG-RETOUR] De klant ziet deze tekst nu écht — op /dashboard/vragen, met het
      // document erbij en een antwoordveld. Zeg dat erbij: een boekhouder die denkt dat
      // hij in het niets typt, schrijft "?" en pakt daarna de telefoon.
      // The browser's prompt gave one unstyled line for a message another
      // person reads on their own screen: no room, no wrapping, no sense of how
      // much you had written. A textarea in the app's own dialog says, by its
      // shape, that this is something to write rather than something to fill in.
      const answer = await dialog.prompt({
        title: t('brug.vraag.titel'),
        message: t('brug.vraag.uitleg'),
        placeholder: t('brug.vraag.placeholder'),
        multiline: true,
        maxLength: 500,
        confirmLabel: t('brug.vraag.versturen'),
        // Optional by design: sending the status with no text still tells the
        // client there is a question, which is what the old prompt allowed by
        // accepting an empty string.
        required: false,
      })
      if (answer === null) return // cancelled — assert nothing
      vraagText = answer.trim() || undefined
    }
    setBusy(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/accountant/subject-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId: node.id, status: next, vraagText }),
      })
      if (res.ok) {
        onStatusSet(next)
      } else {
        // The previous (truthful) status stays; the route's own sentence explains why.
        const j = await res.json().catch(() => ({} as { error?: string }))
        setSaveError(
          failureText(res.status, j, t('brug.fout.opslaan')) +
          (next === 'vraag' && vraagText ? ` ${t('brug.fout.vraagOpnieuw')}` : ''),
        )
      }
    } catch {
      setSaveError(
        next === 'vraag' && vraagText
          ? t('brug.fout.vraagOffline')
          : t('brug.fout.statusOffline'),
      )
    } finally {
      setBusy(false)
    }
  }

  const statusMeta = isDoc && status ? DOC_STATUS_META[status] : undefined

  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: R.lg, background: '#fff', boxShadow: EL1, width: '100%' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 22, color: node.source === 'invoice' ? M3.success : M3.outline }} aria-hidden>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* [BRIDGE-POLISH 3a-1] direction marker (invoices only) */}
          {node.direction && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: R.full, background: TONE[DIRECTION_MARK[node.direction].tone].bg, color: TONE[DIRECTION_MARK[node.direction].tone].color }}>
              {t(DIRECTION_MARK[node.direction].key)}
            </span>
          )}
          <span style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.displayName}
          </span>
          {node.badges.map((b, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.full, background: TONE[b.tone].bg, color: TONE[b.tone].color }}>
              {b.label}
            </span>
          ))}
          {/* [READINESS-P3] Document status badge — read-only claim, shown to both
              accountant and client. Only rendered when a status row exists. */}
          {statusMeta && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.full, background: TONE[statusMeta.tone].bg, color: TONE[statusMeta.tone].color }}>
              {t(statusMeta.key)}
            </span>
          )}
        </div>
        {/* [BRIDGE-POLISH 3a-1] counterparty name (invoices only) */}
        {node.partyName && (
          <div style={{ fontSize: 12.5, color: M3.onSurface, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.partyName}
          </div>
        )}
        {(node.date || node.amount != null) && (
          <div style={{ fontSize: 12, color: M3.outline, marginTop: 2, display: 'flex', gap: 10 }}>
            {node.date && <span>{fmtDate(node.date)}</span>}
            {node.amount != null && <span style={{ fontWeight: 600 }}>{fmtEur(node.amount)}</span>}
          </div>
        )}
      </div>
      {node.pdfUrl && (
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.primary }} aria-hidden>open_in_new</span>
      )}
    </div>
  )

  // [BRIDGE-OPEN-LOCATION] For the owner (not the accountant), when this node has a
  // real file in "Mijn bestanden", offer a button that opens that file's folder and
  // highlights it. Uses the existing ?folder= & ?focus= handling in BestandenPage.
  const locationBtn =
    isClient && node.hasLocation && node.docId ? (
      <a
        href={
          node.folderId
            ? `/dashboard/bestanden?folder=${node.folderId}&focus=${node.docId}`
            : `/dashboard/bestanden?focus=${node.docId}`
        }
        title={t('brug.openBestanden')}
        aria-label={t('brug.openBestanden')}
        onClick={e => e.stopPropagation()}
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: R.full,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: M3.surfaceVariant ?? '#E7E8EC', textDecoration: 'none',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.primary }} aria-hidden>
          folder_open
        </span>
      </a>
    ) : null

  const openable =
    node.pdfUrl ? (
      <a href={node.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
        {inner}
      </a>
    ) : (
      <div style={{ flex: 1, minWidth: 0 }}>{inner}</div>
    )

  // Both actions have their own hit area; the location button never triggers the PDF.
  const row = locationBtn ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      {openable}
      {locationBtn}
    </div>
  ) : (
    openable
  )

  // [READINESS-P3] Accountant-only document actions. The buttons live OUTSIDE the
  // openable anchor so clicking one never opens the PDF. Clients (isClient) get the
  // read-only badge above but no buttons — they cannot assert a status.
  if (!isClient && isDoc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {row}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingInlineStart: 4 }}>
          {/* [TAAL] The array values are the API action words and stay Dutch; the label the
              accountant reads comes from the catalogue via DOC_STATUS_META. */}
          {(['verwerkt', 'in_behandeling', 'vraag'] as const).map((key) => {
            const active = status === key
            const meta = DOC_STATUS_META[key]
            return (
              <button
                key={key}
                onClick={() => applyStatus(key)}
                disabled={busy}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: R.full,
                  border: `1px solid ${active ? TONE[meta.tone].color : M3.outline}`,
                  background: active ? TONE[meta.tone].bg : '#fff',
                  color: active ? TONE[meta.tone].color : M3.outline,
                  cursor: busy ? 'default' : 'pointer', fontFamily: FONT, opacity: busy ? 0.6 : 1,
                }}
              >
                {t(meta.key)}
              </button>
            )
          })}
        </div>
        {saveError && (
          <div role="alert" style={{ fontSize: 12, color: M3.error, paddingInlineStart: 4, lineHeight: 1.45 }}>
            {saveError}
          </div>
        )}
      </div>
    )
  }

  return row
}
// ─── [BRIDGE-HUB] Layer 2 — Overzicht panel (the per-client readiness verdict) ────
// [ACCOUNTANT-TRUTH] Uses the SAME strict readiness engine the owner sees
// (/api/readiness?clientId): a weighted score, what's still missing, and the
// reconciliation differences to eyeball — not the old binary warnings view. The
// accountant now opens on the exact verdict the store owner reads.
type ReadinessStatus = 'ready' | 'almost' | 'attention'
interface ReadinessReport {
  quarterLabel: string
  score: number
  status: ReadinessStatus
  missing: { title: string; detail?: string }[]
  risks: { title: string; detail?: string }[]
}
interface ReadinessResponse {
  report: ReadinessReport
  concept: { verschuldigd: number; voorbelasting: number; saldo: number }
}
const READINESS_STATUS: Record<ReadinessStatus, { emoji: string; titleKey: MessageKey; bg: string; fg: string }> = {
  ready:     { emoji: '🟢', titleKey: 'brug.klaar.voorVerwerking', bg: '#CEEAD6', fg: '#137333' },
  almost:    { emoji: '🟡', titleKey: 'brug.klaar.bijna',          bg: '#FEE8C4', fg: '#7C5800' },
  attention: { emoji: '🔴', titleKey: 'brug.klaar.nogNiet',        bg: '#F9DEDC', fg: '#B3261E' },
}

function OverzichtPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const t = translator(useLocale())
  const [data, setData] = useState<ReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // maar zonder synchrone setState in de effect-body (cascaderende renders).
      setLoading(true); setError(false); setData(null)
      const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
      try {
        const r = await fetch(`/api/readiness?${params}`)
        if (!r.ok) throw new Error('readiness')
        const j = await r.json()
        if (!cancelled) { if (j?.report) setData(j); else setError(true) }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId, year, quarter])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px 20px', color: M3.outline, fontFamily: FONT, fontSize: 14 }}>{t('brug.overzichtLaden')}</div>
  }
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, fontFamily: FONT }}>
        <p style={{ fontSize: 14, color: M3.error, margin: 0 }}>{t('brug.fout.overzicht')}</p>
      </div>
    )
  }

  const rep = data.report
  const meta = READINESS_STATUS[rep.status]
  const teBetalen = data.concept.saldo >= 0

  // [KANTOOR-RUST] Titles only. The `detail` of a readiness item is written to the OWNER ("voeg
  // het origineel toe", "bespreek met je boekhouder") and this panel is read by the boekhouder;
  // readiness-board.ts strips it for the werkboard for the same reason. The title names the gap.
  const itemList = (title: string, color: string, items: { title: string; detail?: string }[]) => (
    <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0, marginTop: 1 }} aria-hidden>error_outline</span>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface }}>{it.title}</div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Verdict — the strict, turnover-aware readiness (same as the owner sees) */}
      <div style={{ background: meta.bg, borderRadius: R.lg, padding: '16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{meta.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: meta.fg }}>{t(meta.titleKey)}</div>
          <div style={{ fontSize: 12.5, color: meta.fg, opacity: 0.85 }}>{rep.quarterLabel}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: meta.fg }}>{rep.score}%</div>
      </div>

      {rep.missing.length > 0 && itemList(t('brug.moetGebeuren'), '#7C5800', rep.missing)}
      {rep.risks.length > 0 && itemList(t('brug.evenControleren'), M3.error, rep.risks)}
      {/* [KANTOOR-RUST] Nothing missing and nothing to check says nothing here: the verdict card
          above already carries the state, and a green box the size of a warning is what teaches
          a reader to skim the spot a real one will appear in. */}

      {/* Concept BTW saldo — the number to file */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface }}>
          {teBetalen ? t('brug.conceptBtwBetalen') : t('brug.conceptBtwTerug')}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: teBetalen ? M3.onSurface : '#137333' }}>{fmtEur(Math.abs(data.concept.saldo))}</span>
      </div>
    </div>
  )
}

// ─── [BRIDGE-HUB] Layer 2 — Kwartaal panel: the TURNOVER-AWARE result ──────────
// [ACCOUNTANT-TRUTH] Was invoice-only (/api/quarterly) — for a retail client that
// OMITTED almost all revenue (till turnover isn't an invoice), so the accountant saw a
// near-zero income while the ZIP beside it held the correct figure. Now it uses the same
// cross-channel engine the owner sees (/api/result?clientId): omzet/kosten/resultaat +
// concept BTW (5a/5b/5g) from invoices + bank + kas + dagomzet, de-duplicated. The number
// the accountant reads now matches the ZIP and the owner's readiness screen.
interface QuarterResult { omzet: number; kosten: number; resultaat: number; cashOmzetZonderBtw: number }
interface ConceptBtw { verschuldigd: number; voorbelasting: number; saldo: number }

function KwartaalPanel({ clientId, year, quarter }: { clientId: string; year: number; quarter: number }) {
  const t = translator(useLocale())
  const [pnl, setPnl] = useState<QuarterResult | null>(null)
  const [concept, setConcept] = useState<ConceptBtw | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // maar zonder synchrone setState in de effect-body (cascaderende renders).
      setLoading(true); setError(false); setPnl(null); setConcept(null)
      const params = new URLSearchParams({ year: String(year), quarter: String(quarter), clientId })
      // P&L (omzet/kosten/resultaat, cents-accurate) from /api/result; the concept BTW
      // (5a/5b/5g, WHOLE-EURO per the Belastingdienst form) from /api/aangifte — so the
      // Kwartaal tab's "5g" equals the Overzicht verdict, the owner's screens and the ZIP,
      // instead of the raw cents scalar it used to (wrongly) label "5a/5b/5g".
      try {
        const [rRes, aRes] = await Promise.all([
          fetch(`/api/result?${params}`),
          fetch(`/api/aangifte?${params}`),
        ])
        if (!rRes.ok || !aRes.ok) throw new Error('kwartaal')
        const [rj, aj] = await Promise.all([rRes.json(), aRes.json()])
        if (cancelled) return
        if (rj?.result && aj?.aangifte) { setPnl(rj.result); setConcept(aj.aangifte) }
        else setError(true)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId, year, quarter])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: M3.outline, fontFamily: FONT, fontSize: 14 }}>
        {t('brug.cijfersLaden')}
      </div>
    )
  }
  if (error || !pnl || !concept) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, fontFamily: FONT }}>
        <p style={{ fontSize: 14, color: M3.error, margin: 0 }}>{t('brug.fout.cijfers')}</p>
      </div>
    )
  }

  const teBetalen = concept.saldo >= 0
  const line = (label: string, value: string, opts: { color?: string; strong?: boolean; top?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: opts.top ? '1px solid #f1f3f4' : 'none', marginTop: opts.top ? 4 : 0 }}>
      <span style={{ fontSize: opts.strong ? 14.5 : 13.5, fontWeight: opts.strong ? 700 : 500, color: opts.color ?? M3.onSurface }}>{label}</span>
      <span style={{ fontSize: opts.strong ? 18 : 15, fontWeight: opts.strong ? 700 : 600, color: opts.color ?? M3.onSurface }}>{value}</span>
    </div>
  )

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: M3.outline, marginBottom: 10 }}>
        {t('brug.alleKanalen', { quarter, year })}
      </div>

      {/* Resultaat — cross-channel P&L (cents-accurate) */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '10px 16px', marginBottom: 10 }}>
        {line(t('brug.omzetExcl'), fmtEur(pnl.omzet), { color: '#137333' })}
        {line(t('brug.kostenExcl'), fmtEur(pnl.kosten), { color: '#B3261E' })}
        {line(t('brug.resultaat'), fmtEur(pnl.resultaat), { strong: true, top: true })}
      </div>

      {/* Concept BTW — whole-euro, matches het formulier, de ZIP en het Overzicht */}
      <div style={{ background: '#fff', borderRadius: R.lg, boxShadow: EL1, padding: '10px 16px' }}>
        {line(t('brug.btw5a'), fmtEur(concept.verschuldigd))}
        {line(t('brug.btw5b'), `− ${fmtEur(concept.voorbelasting)}`)}
        {line(
          teBetalen ? t('brug.btw5gBetalen') : t('brug.btw5gTerug'),
          fmtEur(Math.abs(concept.saldo)),
          { strong: true, top: true, color: teBetalen ? M3.onSurface : '#137333' },
        )}
      </div>

      {pnl.cashOmzetZonderBtw > 0 && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: R.md, background: '#FEE8C4', color: '#7C5800', fontSize: 12.5, lineHeight: 1.5 }}>
          {t('brug.omzetZonderTarief', { amount: fmtEur(pnl.cashOmzetZonderBtw) })}
        </div>
      )}
    </div>
  )
}