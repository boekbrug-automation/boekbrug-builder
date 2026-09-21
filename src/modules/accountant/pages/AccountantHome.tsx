'use client'

// src/modules/accountant/pages/AccountantHome.tsx
// [BOEK-028] Accountant Portal — Phase 2 — May 2026
//
// Replaces AccountantDashboard.tsx.
// All data arrives as props (fetched server-side via accountant.repository.ts).
// This component handles UI state only — no supabase.from() for read queries.
//
// Preserved from old dashboard:
//   - "Ga verder waar je gebleven bent" (localStorage)
//   - "Samen werken met AI" panel
//   - Draft Queue floating panel (writes to draft_queue table — client-side, intentional)
//   - DashboardHeader

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { copyToClipboard } from '@/lib/clipboard'
import { createClient } from '@/lib/supabase'
import { rowMatchesQuery } from '@/lib/search'
import { DashboardHeader } from '@/app/dashboard/_shared'
// [DRAFT-QUEUE-HIDDEN] Draft Queue is hidden from the UI for now (decision deferred).
// Component + /api/draft-queue + the draft_queue table are intentionally kept intact;
// only the render below is disabled. Re-enable by restoring the import and the
// <DraftQueue /> mount at the bottom of this file.
// import DraftQueue from '@/components/draft-queue/DraftQueue'
// [KANTOOR-RUST] Its catalogue copy (dq.*) was NOT removed: the component's fetch is the only
// "door" to /api/draft-queue that the [GEEN-DEUR] ratchet sees, so the copy leaves together with
// the route or not at all — an owner decision, not a cleanup.
import type { AccountantOverview, ClientSummary, TodoItem } from '../accountant.types'
import type { WorkQueues } from '../work-queues'
import type { NotificationRow } from '@/types/rows'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { EL1, M3, R, COLUMN } from '@/lib/design/tokens'
import DashboardTools from '@/components/tools/DashboardTools'
// [TAAL] This screen holds no language of its own: every sentence comes from messages.ts.
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import { useToast } from '@/components/ui/Toast'
import { failureText } from '@/lib/server-message'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] localStorage key — kept as-is (fragile by design, deferred to DB later)
const LAST_CLIENT_KEY = 'last_client_id'

// [READINESS-P4] The old klaar/bijna_klaar/wacht STATUS_COLOR/STATUS_LABEL maps
// were removed with the lie-capable computeClientStatus. TODO_ICON stays — the
// to-do feed is now rendered from honest getTodoFeed items.
const TODO_ICON: Record<string, string> = {
  invoices_to_process: '📄',
  missing_file:        '📁',
  client_question:     '❓',
}

// [ROLE-PARITY] Shape/elevation tokens mirrored from the ZZP home (ZzpDashboard)
// so the two role dashboards share one visual system.

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Props {
  profile: {
    id: string
    full_name: string | null
    company_name: string | null
    email: string | null
    role: string | null
  }
  overview: AccountantOverview
  /**
   * [BOEKHOUDER-LEEG] true = the client list could not be READ, which is not the same as having no
   * clients. Without this the screen showed the first-run onboarding state — "Voeg je eerste klant
   * toe" — to an accountant who may have forty, and told a working practice it had none.
   */
  clientsUnreadable?: boolean
  /** Same for the to-do feed: "nothing to do" and "we could not look" are different answers. */
  todosUnreadable?: boolean
  /**
   * [WERKVOORRAAD] De cijfers achter de vier werktegels. Optioneel omdat de home ouder is dan
   * deze regel en er ook zonder hoort te openen — een scherm dat crasht op een ontbrekend getal
   * is erger dan een scherm zonder dat getal.
   */
  workQueues?: WorkQueues
  clients: ClientSummary[]
  todos: TodoItem[]
  notifications: NotificationRow[]
  // [NO-SILENT-EMPTY] De serverpagina leest de meldingen; kon dat niet, dan zegt de bel dat in
  // plaats van "Geen meldingen".
  notificationsError?: string | null
  unreadMessages: number
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** [TAAL] The greeting is a KEY, not a sentence — the words come from messages.ts. */
type SalutationKey = 'bh.home.groet.ochtend' | 'bh.home.groet.middag' | 'bh.home.groet.avond'

/**
 * Hydration-safe greeting.
 * Time-based salutation differs between server (UTC) and client (local timezone),
 * which causes React error #418. Return null initially, compute after mount.
 */
function timeSalutation(): SalutationKey {
  const hour = new Date().getHours()
  if (hour < 12) return 'bh.home.groet.ochtend'
  if (hour < 18) return 'bh.home.groet.middag'
  return 'bh.home.groet.avond'
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function AccountantHome({ profile, overview, workQueues, clients, todos, clientsUnreadable, todosUnreadable, notifications: initialNotifs, notificationsError, unreadMessages: initialUnread }: Props) {
  // [READINESS-P4] overview + todos are now RENDERED (below) — they are backed by
  // honest facts: overview = provable counts (open questions / missing bank), todos
  // = concrete actionable items from getTodoFeed. No "ready" verdict is shown, so
  // the BRIDGE-NOTIF "placeholder counts are a lie" concern no longer applies.
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()
  const showToast = useToast()
  const supabase = createClient()

  // ── Notifications (client-side read for real-time badge) ──
  const [notifications, setNotifications] = useState(initialNotifs)
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages] = useState(initialUnread)

  // ── Time-based greeting (computed after mount to avoid hydration mismatch) ──
  const [salutation, setSalutation] = useState<SalutationKey | null>(null)

  // ── Last client shortcut (localStorage) ──
  const [lastClientId, setLastClientId] = useState<string | null>(null)
  const [lastClientName, setLastClientName] = useState<string | null>(null)

  // [SMART-FILTER] Client-roster search (bedrijfsnaam / naam / e-mail). Memoized —
  // the roster is unbounded (grows with the accountant's client count).
  const [clientSearch, setClientSearch] = useState('')
  const shownClients = useMemo(() => {
    const q = clientSearch.trim()
    return q ? clients.filter((c) => rowMatchesQuery(q, [c.company_name, c.full_name, c.email])) : clients
  }, [clients, clientSearch])

  // ── AI assistant panel ──
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ subject: string; body: string } | null>(null)
  // [KOPIE-EERLIJK] null = not tapped. This button used to be a floating promise —
  // `navigator.clipboard?.writeText(...)` with nothing awaited — so a refused write said nothing at
  // all and rejected into the void. The accountant tapped Kopiëren, pasted, and got whatever they
  // had copied before.
  const [aiCopied, setAiCopied] = useState<boolean | null>(null)

  // ── Init ──
  useEffect(() => {
    // Beide standen komen uit de browser (klok + localStorage) en bestaan op de server niet.
    // In één wikkel: zelfde tick, geen synchrone setState in de effect-body.
    void (async () => {
      // Time-based greeting — set after mount to keep server/client HTML identical
      setSalutation(timeSalutation())

      // Resolve last_client_id from localStorage
      const storedId = localStorage.getItem(LAST_CLIENT_KEY)
      if (storedId) {
        setLastClientId(storedId)
        const found = clients.find(c => c.id === storedId)
        if (found) setLastClientName(found.company_name || found.full_name)
        else localStorage.removeItem(LAST_CLIENT_KEY) // stale
      }
    })()
  }, [])

  // ─────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────

  function openClient(clientId: string) {
    localStorage.setItem(LAST_CLIENT_KEY, clientId)
    router.push(`/dashboard/clients/${clientId}`)
  }

  async function handleLogout() {
    // [UITLOGGEN] signOut() keeps the local session when the server refused, so navigating to
    // /login as if it worked only bounced the accountant straight back, with no word. Say it, and
    // stay signed in — which is the truth. Same rule as the owner's home bar and the rail.
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[BOEKHOUDER-HOME] uitloggen mislukt:', error.message)
      showToast(t('kop.uitloggenMislukt'), { tone: 'error' })
      return
    }
    router.push('/login')
  }

  async function markAllRead(): Promise<boolean> {
    // Het scherm mag pas "gelezen" tonen als het ook echt is opgeslagen. De uitkomst werd hier
    // genegeerd — precies de fout die de ZZP-home al had opgelost, en die op deze home was blijven
    // staan: de bel ging op nul, en bij de volgende keer openen stonden dezelfde meldingen er weer
    // ongelezen bij, zonder dat iets uitlegde waarom.
    // [MELDING-WAARHEID] The outcome is returned: the bell takes its local mark back on a false.
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    if (error) {
      console.error('[BOEKHOUDER-HOME] meldingen als gelezen markeren mislukt:', error.message)
      return false
    }
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    return true
  }

  // ─────────────────────────────────────────────────────────
  // AI assistant
  // ─────────────────────────────────────────────────────────

  async function handleAiPrompt() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiResult(null)
    try {
      // [AI-SERVERKANT] Via onze eigen route. Hier stond een RECHTSTREEKSE aanroep van
      // composeDraftEmail — een functie die intern fetch('https://api.anthropic.com') doet met
      // process.env.ANTHROPIC_API_KEY. In een browser bestaat die variabele niet (Next vervangt
      // alleen NEXT_PUBLIC_*), dus ging het verzoek de deur uit met een LEGE sleutel — en zelfs
      // met sleutel zou het stranden, want Anthropic staat geen browser-origin toe.
      //
      // Deze assistent kón dus nooit werken. De boekhouder typte zijn vraag, klikte, en las
      // "AI niet beschikbaar — Probeer het opnieuw." Dat advies was onjuist: opnieuw proberen
      // veranderde niets, want er was niets tijdelijks aan.
      const res = await fetch('/api/ai/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // Zeg wat er aan de hand is. 429 is het enige geval waarin wachten wél helpt.
        setAiResult({
          subject: res.status === 429 ? t('bh.home.ai.teVeel') : t('bh.home.ai.mislukt'),
          body: failureText(res.status, json, t('bh.home.ai.probeerStraks')),
        })
        return
      }
      setAiResult(json)
    } catch {
      setAiResult({ subject: t('bh.home.ai.geenVerbinding'), body: t('bh.home.ai.checkInternet') })
    } finally {
      setAiLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      {/* Header — unchanged */}
      <DashboardHeader
        profile={profile}
        notifications={notifications}
        showNotifications={showNotifications}
        notificationsError={notificationsError}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => {
          setShowNotifications(prev => !prev)
        }}
        onMarkAllRead={markAllRead}
        onMessagesClick={() => router.push('/dashboard/messages')}
        onLogout={handleLogout}
      />

      {/* [ROLE-PARITY] Same design system as the ZZP home (ZzpDashboard): a
          greeting, a snapshot, a gradient hero for the daily driver, and grouped
          sections — applied to the ACCOUNTANT's own content (portfolio of clients,
          cross-client to-dos, office tools). Not a literal clone: the two roles
          share the system, the content is tailored per role. See docs (multi-role
          portals lead with what matters to that role). */}
      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '32px 16px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Greeting (eyebrow + first name — same shape as the ZZP home) ── */}
        <div>
          <p style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, fontWeight: 500, letterSpacing: 0.2, textTransform: 'uppercase' }}>
            {t(salutation ?? 'bh.home.groet.hallo')}
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#202124', margin: 0, letterSpacing: -0.5 }}>
            {profile.full_name ? profile.full_name.split(' ')[0] : t('bh.home.groet.daar')} 👋
          </h1>
        </div>

        {/* ── Daily-driver hero — the accountant's "lead with what matters":
            the Aangifte & status board (deadline + client readiness + reminders).
            Same gradient hero treatment as the ZZP "Ben ik klaar?". ── */}
        <button
          onClick={() => router.push('/dashboard/accountant/agenda')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'start',
            padding: '18px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
            border: 'none', background: 'linear-gradient(135deg, #1A73E8, #1557B0)', boxShadow: EL1,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#fff' }} aria-hidden>checklist</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: -0.2 }}>{t('bh.home.aangifte.titel')}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{t('bh.home.aangifte.uitleg')}</span>
          </span>
          <span className="material-symbols-outlined icon-dir" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }} aria-hidden>chevron_right</span>
        </button>

        {/* ── [WERKVOORRAAD] Wat er op JOU ligt ──────────────────────────────
            Boven Overzicht, want dit is werk en dat is status. Vier schermen
            hingen hieronder als tegels zonder getal: je moest ze één voor één
            openen om te ontdekken dat er twaalf stukken een kwartaal
            tegenhielden. Werk dat je moet gaan zoeken, is werk dat blijft
            liggen — zie work-queues.ts.

            Elk blok is een KNOP naar het scherm dat het getal oplost, en een
            nul is hier nooit stilzwijgend: een nul omdat er niets is en een nul
            omdat niemand je gemachtigd heeft zijn twee heel verschillende
            dingen, en de regel eronder zegt welke van de twee het is. */}
        {/* [NO-SILENT-EMPTY] complete:false betekent "we WETEN het niet", niet "er is niets" —
            de sectie helemaal verbergen was precies het valse sein-veilig waar dat veld tegen
            bestaat. Dus: een eerlijke regel in plaats van stilte. */}
        {workQueues && !workQueues.complete && (
          <p style={{ fontSize: 12.5, color: '#B3261E', margin: '0 0 8px' }}>
            {t('bh.home.werkvoorraad.onvolledig')}
          </p>
        )}
        {workQueues && workQueues.complete && (workQueues.mandatedForInvoices > 0 || workQueues.mandatedForConfirm > 0) && (
          <div>
            <SectionLabel>{t('bh.home.werkvoorraad.kop')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                onClick={() => router.push('/dashboard/accountant/bevestigen')}
                style={{
                  backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '14px 12px',
                  border: 'none', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit', minHeight: 88,
                }}
              >
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: workQueues.toConfirm > 0 ? '#188038' : '#5F6368' }}>
                  {workQueues.toConfirm}
                </p>
                <p style={{ fontSize: 12.5, color: '#202124', margin: '2px 0 0', fontWeight: 500 }}>
                  {t('bh.home.bevestigen.label')}
                </p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0', lineHeight: 1.4 }}>
                  {workQueues.mandatedForConfirm === 0
                    ? t('bh.home.geenMachtiging')
                    : workQueues.toConfirm === 0
                      ? t('bh.home.bevestigen.niets')
                      : t('bh.home.bevestigen.blokkeert')}
                </p>
              </button>

              <button
                onClick={() => router.push('/dashboard/accountant/debiteuren')}
                style={{
                  backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '14px 12px',
                  border: 'none', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit', minHeight: 88,
                }}
              >
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: workQueues.overdueCount > 0 ? '#C5221F' : '#5F6368' }}>
                  {workQueues.overdueTotal > 0
                    ? `€ ${Math.round(workQueues.overdueTotal).toLocaleString('nl-NL')}`
                    : '0'}
                </p>
                <p style={{ fontSize: 12.5, color: '#202124', margin: '2px 0 0', fontWeight: 500 }}>
                  {t('bh.home.telaat.label')}
                </p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0', lineHeight: 1.4 }}>
                  {workQueues.mandatedForInvoices === 0
                    ? t('bh.home.geenMachtiging')
                    : workQueues.overdueCount === 0
                      ? t('bh.home.telaat.niets')
                      : t(workQueues.overdueCount === 1 ? 'bh.home.telaat.een' : 'bh.home.telaat.meer', {
                          aantal: workQueues.overdueCount,
                          dagen: workQueues.worstDaysLate,
                        })}
                </p>
              </button>
            </div>
          </div>
        )}

        {/* ── Overzicht — honest counts (the accountant's "where do I stand").
            Same 3-tile snapshot pattern as the ZZP home. ── */}
        {clients.length > 0 && (
          <div>
            <SectionLabel>{t('bh.home.overzicht.kop')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {([
                { n: overview.total_clients, labelKey: 'bh.home.overzicht.klanten', color: '#202124' },
                { n: overview.clients_with_open_questions, labelKey: 'bh.home.overzicht.openVraag', color: overview.clients_with_open_questions > 0 ? '#C5221F' : '#5F6368' },
                { n: overview.clients_missing_bank, labelKey: 'bh.home.overzicht.zonderBank', color: overview.clients_missing_bank > 0 ? '#EA8600' : '#5F6368' },
              ] as const).map(s => (
                <div key={s.labelKey} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '12px 8px', textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                  <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{t(s.labelKey)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [READINESS-P4] To-do — concrete actionable items (open questions,
            unprocessed invoices, missing bank data). Every item is a real gap the
            accountant can act on; clicking opens the client. */}
        {/* [BOEKHOUDER-LEEG] The to-do feed is the sharpest of the three, because of WHEN it is
            read. An accountant told "nothing to do" in aangifte week closes the app and the work
            does not get done — there is no second signal to catch it and the deadline is
            statutory. So an unreadable feed says so, above the list rather than instead of it. */}
        {todosUnreadable && (
          <div style={{
            margin: '0 0 12px', padding: '12px 14px', borderRadius: 12,
            background: '#FCE8E6', border: '1px solid #F5C6C2',
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: '0 0 2px' }}>
              {t('bh.home.todo.onleesbaar.titel')}
            </p>
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: 0, lineHeight: 1.5 }}>
              {t('bh.home.todo.onleesbaar.uitleg')}
            </p>
          </div>
        )}
        {todos.length > 0 && (
          <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('bh.home.todo.kop')}</h2>
            </div>
            {/* [TAAL] `todo`, niet `t`: de vertaler heet hier `t`. */}
            {todos.map((todo, idx) => (
              <button
                key={`${todo.client_id}-${todo.type}`}
                onClick={() => router.push(`/dashboard/clients/${todo.client_id}`)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', background: 'none', border: 'none',
                  borderBottom: idx < todos.length - 1 ? '1px solid #F1F3F4' : 'none',
                  cursor: 'pointer', textAlign: 'start', minHeight: 48,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{TODO_ICON[todo.type] ?? '•'}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#202124' }}>{todo.description}</span>
                <span className="icon-dir" style={{ color: '#1A73E8', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>→</span>
              </button>
            ))}
          </div>
        )}

        {/* ── 4. Mijn klanten ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('bh.home.klanten.kop')}</h2>
            <button
              onClick={() => router.push('/dashboard/clients/beheer')}
              style={{
                backgroundColor: '#1A73E8', color: '#FFFFFF',
                border: 'none', borderRadius: 8,
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {t('bh.home.klanten.nieuw')}
            </button>
          </div>

          {clients.length > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #E0E0E0', position: 'relative' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 27, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder={t('bh.home.klanten.zoekPlaceholder')}
                aria-label={t('bh.home.klanten.zoekLabel')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 13.5, outline: 'none', color: '#202124' }}
              />
              {clientSearch && (
                <button onClick={() => setClientSearch('')} aria-label={t('bh.home.klanten.wissen')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 23, top: '50%', transform: 'translateY(-50%)', width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
          )}

          {clientsUnreadable ? (
            /* [BOEKHOUDER-LEEG] The read failed, so this screen knows nothing about this
               accountant's practice — and the one thing it may not do is describe it. Below stands
               the FIRST-RUN state, "Voeg je eerste klant toe", which is the right thing to show
               somebody who has none and a false statement about somebody who has forty. An owner
               who sees an empty screen doubts the screen because they know their own books; an
               accountant does not, and forms a professional judgement on what we hand them.
               No action offered: there is nothing to fix here, and inviting a client would be a
               second wrong answer on top of the first. */
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ color: '#B3261E', fontSize: 24 }} aria-hidden>error_outline</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: '8px 0 4px' }}>
                {t('bh.home.klanten.onleesbaar.titel')}
              </p>
              <p style={{ fontSize: 12.5, color: '#5F6368', margin: 0, lineHeight: 1.5 }}>
                {t('bh.home.klanten.onleesbaar.uitleg')}
              </p>
            </div>
          ) : clients.length === 0 ? (
            /* [ONBOARDING] First-run empty state — a clear, tappable first action
               for a brand-new accountant instead of a dead line of text. */
            <div>
            <button
              onClick={() => router.push('/dashboard/clients/beheer')}
              style={{
                width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '32px 16px', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <span style={{
                width: 44, height: 44, borderRadius: '50%', backgroundColor: '#E8F0FE',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-outlined" style={{ color: '#1A73E8', fontSize: 24 }} aria-hidden>person_add</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#202124' }}>{t('bh.home.klanten.eerste.titel')}</span>
              <span style={{ fontSize: 12.5, color: '#5F6368' }}>{t('bh.home.klanten.eerste.uitleg')}</span>
            </button>
            {/* [PROEFDOSSIER] De bewijsplek vóór de eerste klant. Wie hier staat heeft nul klanten
                en dus nul reden om ons op ons woord te geloven — het voorbeelddossier laat ZIEN
                wat een klant straks aanlevert: het kwartaal, de statussen, en de vraag die een
                vraag bleef. Onder de uitnodigingsknop, want kijken gaat vóór uitnodigen. */}
            <button
              onClick={() => router.push('/dashboard/accountant/voorbeeld')}
              style={{ display: 'block', margin: '0 auto 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#1A73E8', padding: '4px 12px' }}
            >
              {t('bh.home.klanten.eerste.voorbeeld')}
            </button>
            </div>
          ) : shownClients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              {t('bh.home.klanten.geenResultaat', { zoekterm: clientSearch.trim() })}
            </p>
          ) : (
            <div>
              {shownClients.map((client, idx) => (
                <button
                  key={client.id}
                  onClick={() => openClient(client.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: idx < shownClients.length - 1 ? '1px solid #F1F3F4' : 'none',
                    cursor: 'pointer',
                    textAlign: 'start',
                    transition: 'background 0.1s',
                    minHeight: 56,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {/* [BRIDGE-NOTIF] Status dot + chip removed — same readiness
                      signal that has no honest backend yet. Name + email + arrow
                      stay. client.status field is untouched (returns with the
                      readiness backend). */}

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company_name ?? client.full_name ?? '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.email}
                    </p>
                  </div>

                  {/* Arrow */}
                  <span className="icon-dir" style={{ fontSize: 13, color: '#1A73E8', fontWeight: 600, flexShrink: 0 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Werkplek — office tools as a compact tile grid (same pattern as the
            ZZP home's "Mijn administratie"). Surfaces the tools directly instead of
            routing through a separate werkplek menu. ── */}
        <div>
          <SectionLabel>{t('bh.home.werkplek.kop')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <ToolTile icon="people" tint="#34A853" label={t('bh.home.tegel.beheren')} onClick={() => router.push('/dashboard/clients/beheer')} />
            <ToolTile icon="bar_chart" tint="#E37400" label={t('bh.home.tegel.kwartaal')} onClick={() => router.push('/dashboard/quarterly')} />
            <ToolTile icon="account_tree" tint="#1967D2" label={t('bh.home.tegel.brug')} onClick={() => router.push('/dashboard/brug')} />
            {/* [EIGEN-BOEKEN-LABEL] "Mijn", niet "Facturen". Deze tegel gaat naar /dashboard/facturen,
                en dat scherm leest `sender_id = user.id`: het zijn de facturen van het KANTOOR zelf.
                Tussen Beheren, Kwartaal en Brug — die alle drie over klanten gaan — en pal naast
                "Factureren", dat wél namens een klant gaat, las "Facturen" als "de facturen van
                mijn klanten". Eén woord verschil tussen twee administraties is precies het soort
                verwarring dat dit scherm zich niet kan veroorloven. */}
            <ToolTile icon="description" tint="#00897B" label={t('bh.home.tegel.mijnFacturen')} onClick={() => router.push('/dashboard/facturen')} />
            {/* [MANDAAT] Altijd zichtbaar, ook zonder machtiging: het scherm erachter legt dan uit
                dat de klant het zelf moet aanzetten. Een tegel die pas verschijnt als iemand hem
                al niet meer nodig heeft, vertelt niemand dat de functie bestaat. */}
            <ToolTile icon="edit_note" tint="#C5221F" label={t('bh.home.tegel.factureren')} onClick={() => router.push('/dashboard/accountant/factuur')} />
            {/* [DEBITEUREN] Waar staat het geld stil, over alle gemachtigde klanten heen. */}
            <ToolTile icon="schedule_send" tint="#E37400" label={t('bh.home.tegel.openstaand')} onClick={() => router.push('/dashboard/accountant/debiteuren')} />
            {/* [OPVRAGEN] De ontbrekende stukken opvragen — geen mandaat nodig, alleen een koppeling. */}
            <ToolTile icon="forward_to_inbox" tint="#1967D2" label={t('bh.home.tegel.opvragen')} onClick={() => router.push('/dashboard/accountant/opvragen')} />
            {/* [BEVESTIGEN] De stukken die het kwartaal van een klant tegenhouden. */}
            <ToolTile icon="fact_check" tint="#188038" label={t('bh.home.tegel.bevestigen')} onClick={() => router.push('/dashboard/accountant/bevestigen')} />
            {/* [KANTOORGIDS] Ondernemers zonder boekhouder krijgen de gids te zien; hier zet het
                kantoor zichzelf erin. Altijd zichtbaar, ook als er nog niets is ingevuld — een
                tegel die pas verschijnt als je hem al gebruikt, vertelt niemand dat hij bestaat. */}
            <ToolTile icon="storefront" tint="#0B8043" label={t('bh.home.tegel.gids')} onClick={() => router.push('/dashboard/accountant/gids')} />
            <ToolTile icon="folder_open" tint="#5F6368" label={t('bh.home.tegel.bestanden')} onClick={() => router.push('/dashboard/bestanden')} />
            <ToolTile icon="settings" tint="#7B1FA2" label={t('bh.home.tegel.instellingen')} onClick={() => router.push('/dashboard/settings')} />
          </div>
        </div>

        {/* ── Last client shortcut (preserved) ── */}
        {lastClientId && lastClientName && (
          <button
            onClick={() => openClient(lastClientId)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', cursor: 'pointer', textAlign: 'start',
              backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1,
              background: 'none',
            }}
          >
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#5F6368', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>
                {t('bh.home.verder.kop')}
              </p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{lastClientName}</p>
            </div>
            <span className="icon-dir" style={{ fontSize: 16, color: '#1A73E8' }}>→</span>
          </button>
        )}

        {/* ── AI assistant panel (preserved) ── */}
        <button
          onClick={() => { setShowAiPanel(p => !p); setAiResult(null); setAiPrompt('') }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', cursor: 'pointer', textAlign: 'start',
            backgroundColor: '#202124', color: '#FFFFFF', border: 'none', borderRadius: 8,
          }}
        >
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>
              {t('bh.home.ai.eyebrow')}
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t('bh.home.ai.titel')}</p>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{showAiPanel ? '▲' : '▼'}</span>
        </button>

        {showAiPanel && (
          <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>
              {t('bh.home.ai.uitleg')}
            </p>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={3}
              placeholder={t('bh.home.ai.placeholder')}
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #dadce0', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124', resize: 'none', boxSizing: 'border-box' }}
            />
            <button
              onClick={handleAiPrompt}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{ backgroundColor: '#202124', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (aiLoading || !aiPrompt.trim()) ? 0.4 : 1 }}
            >
              {aiLoading ? t('bh.home.ai.bezig') : t('bh.home.ai.genereer')}
            </button>
            {aiResult && (
              <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: 12, fontSize: 13, color: '#202124' }}>
                <p style={{ fontWeight: 600, margin: '0 0 8px' }}>{t('bh.home.ai.onderwerp', { onderwerp: aiResult.subject })}</p>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: '0 0 12px' }}>{aiResult.body}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={async () => {
                    setAiCopied(await copyToClipboard(aiResult.body))
                    setTimeout(() => setAiCopied(null), 1500)
                  }}
                    style={{ backgroundColor: aiCopied === false ? '#C5221F' : '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    {aiCopied === null ? t('bh.home.ai.kopieren')
                      : aiCopied ? t('kopieer.gelukt') : t('kopieer.nietGelukt')}
                  </button>
                  <button onClick={() => { setAiResult(null); setAiPrompt('') }}
                    style={{ backgroundColor: '#F8F9FA', color: '#202124', border: '1px solid #dadce0', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    {t('bh.home.ai.opnieuw')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* [DASHBOARD-TOOLS] Een boekhouder werkt de hele dag met andermans
            bestanden — samenvoegen, splitsen, een scheve scan rechtzetten. Dit
            staat onderaan omdat het gereedschap is, geen werkvoorraad. Links,
            geen componenten: zie de notitie boven in DashboardTools. */}
        <DashboardTools audience="accountant" />

      </main>

      {/* ── Draft Queue (extracted to /components/draft-queue) ── */}
      {/* [DRAFT-QUEUE-HIDDEN] Temporarily hidden from the UI — see import note above.
          Kept in the codebase (component + API + table) for a future decision.
          Restore this mount to bring it back:
          <DraftQueue clients={clients} /> */}

    </div>
  )
}

// ─────────────────────────────────────────────────────────
// [ROLE-PARITY] Shared home patterns, mirrored from the ZZP home so both role
// dashboards read as one product. SectionLabel = the uppercase group header;
// ToolTile = the compact 3-per-row tile used for the office-tools grid (the
// accountant equivalent of the ZZP "Mijn administratie" grid).
// ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
      color: '#8a929c', margin: '0 2px 10px',
    }}>
      {children}
    </p>
  )
}

function ToolTile({ icon, tint, label, onClick }: {
  icon: string; tint: string; label: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        background: '#fff', borderRadius: R.lg, padding: '14px 6px 12px',
        border: 'none', boxShadow: EL1, cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: R.md,
        background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 24 }} aria-hidden>{icon}</span>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#202124', textAlign: 'center' }}>{label}</span>
    </button>
  )
}