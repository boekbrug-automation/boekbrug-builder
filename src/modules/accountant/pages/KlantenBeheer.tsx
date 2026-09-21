'use client'

// src/modules/accountant/pages/KlantenBeheer.tsx
// [BOEK-028] Klanten beheren — Google Workspace design — May 2026
//
// Receives clients as props (fetched server-side via repository).
// Writes (unlink / invite) go through API routes.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { rowMatchesQuery } from '@/lib/search'
import { clientQuarterHref } from '@/lib/accountant-deep-links'
import type { ClientSummary, ClientReadiness } from '../accountant.types'
import { EL1, M3, R, COLUMN } from '@/lib/design/tokens'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [SERVER-ZIN] Een machinecode is geen zin — de route spreekt soms code, soms Nederlands.
import { failureText } from '@/lib/server-message'
// [TAAL] This screen holds no language of its own: every sentence comes from the catalogue.
import { translator, type Translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'

// ─────────────────────────────────────────────────────────
// [READINESS] Honest, fact-only client summary. No "Klaar"/"ready" verdict — the
// system can't know a quarter is complete (a bon the client never uploaded is
// invisible), so we show what arrived + what the accountant has processed, and let
// the human conclude. The dot reflects the ACCOUNTANT's own worklist, not a claim
// about the client being "done".
// ─────────────────────────────────────────────────────────

function attentionColor(r: ClientReadiness): string {
  // [NO-SILENT-EMPTY] Onleesbaar is geen rust. Zonder deze regel viel een klant met een mislukte
  // telling door naar het grijze "niets in behandeling" — de kleur die zegt dat er niets te doen
  // is, over een klant waarvan we niets weten.
  if (r.readFailed) return '#B3261E'                            // unreadable — the numbers are floors
  if (r.openQuestions > 0) return '#EA4335'                     // an open question — act
  if (r.sharedInvoices > r.processedInvoices) return '#FBBC04'  // items still to process
  return '#DADCE0'                                              // nothing pending (neutral)
}

// [TAAL] The translator travels in — a module-level helper cannot call a hook, and a sentence
// built out here would be the one string on this screen that never gets translated.
function readinessLine(t: Translator, r: ClientReadiness): string {
  // [NO-SILENT-EMPTY] Vóór alle andere takken: "Geen facturen dit kwartaal" is een conclusie, en
  // een mislukte telling mag er nooit uitzien als een lege administratie.
  if (r.readFailed) return t('bh.klant.readiness.onleesbaar')
  if (r.sharedInvoices === 0) return t('bh.klant.readiness.none')
  return t('bh.klant.readiness.processed', {
    done: r.processedInvoices,
    total: r.sharedInvoices,
    bank: r.hasBankData ? '✓' : '—',
  })
}

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

/** [UITNODIGING] Eén verstuurde, nog openstaande kantoor-uitnodiging. */
export interface OpenInvite {
  id: string
  email: string
  sentAt: string | null
}

interface Props {
  initialClients: ClientSummary[]
  /** [UITNODIGING] De uitnodigingen die de deur uit zijn en waar nog niemand op reageerde. */
  openInvites?: OpenInvite[]
  /**
   * [BOEKHOUDER-LEEG] true = the list could not be READ. This screen manages the links themselves,
   * so "Nog geen klanten gekoppeld" is a statement about this accountant's mandates — and a failed
   * read knows nothing about those.
   */
  clientsUnreadable?: boolean
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function KlantenBeheer({ initialClients, clientsUnreadable, openInvites = [] }: Props) {
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()

  const [clients, setClients] = useState<ClientSummary[]>(initialClients)
  // [UITNODIGING] Lokale kopie zodat versturen en intrekken direct zichtbaar zijn.
  const [invites, setInvites] = useState<OpenInvite[]>(openInvites)
  const [cancelBusy, setCancelBusy] = useState<string | null>(null)
  // [SMART-FILTER] Roster search (bedrijfsnaam / naam / e-mail), memoized — unbounded list.
  const [search, setSearch] = useState('')
  const shownClients = useMemo(() => {
    const q = search.trim()
    return q ? clients.filter((c) => rowMatchesQuery(q, [c.company_name, c.full_name, c.email])) : clients
  }, [clients, search])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  // [BULK-UITNODIGEN] Een kantoor dat zijn bestand overzet nodigt tientallen klanten in één
  // zitting uit. De lijst loopt adres voor adres door DEZELFDE route als de losse knop —
  // rolcontrole, formaatcontrole, dubbele-uitnodiging-check en daglimiet gelden dus per adres,
  // en één weigering kost nooit de rest van de lijst.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ email: string; ok: boolean; message?: string }>>([])
  // [GEEN-STILLE-KAP] Hoeveel geplakte adressen BUITEN de 200 vielen — 0 betekent: niets gekapt.
  const [bulkOverflow, setBulkOverflow] = useState(0)

  // Confirm unlink dialog state
  const [unlinkTarget, setUnlinkTarget] = useState<ClientSummary | null>(null)
  useCloseOnBack(!!unlinkTarget, () => setUnlinkTarget(null))
  const [unlinkLoading, setUnlinkLoading] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  // ─── Invite ─────────────────────────────────────────────

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviteLoading(true)
    setInviteError(null)
    setInviteSuccess(false)

    try {
      // [CONTROL] Uses /api/invite/client: it stashes zzper_id=user.id (so the RLS
      // insert passes) AND sends the invite email. The sibling /api/accountant/invite
      // (kept + security-fixed on main: zzper_id=user.id + scoped invitations read)
      // creates an acceptable invite but sends NO email — so the emailing route is the
      // one wired to the button. (Two accountant→client invite routes now coexist;
      // consolidating them is a follow-up.)
      const res = await fetch('/api/invite/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEmail: email }),
      })
      const json = await res.json()
      if (!res.ok) {
        setInviteError(failureText(res.status, json, t('bh.klant.invite.failed')))
      } else {
        setInviteSuccess(true)
        setInviteEmail('')
        // [UITNODIGING] De verse uitnodiging meteen in het overzicht — geen herlaad nodig.
        if (json?.invitation?.id) {
          setInvites((prev) => [json.invitation as OpenInvite, ...prev.filter((i) => i.id !== json.invitation.id)])
        }
      }
    } catch {
      setInviteError(t('bh.klant.error.network'))
    } finally {
      setInviteLoading(false)
    }
  }

  // [UITNODIGING] Intrekken: de gemailde link is daarna echt dood (de acceptatie filtert op
  // 'pending'), en het adres is direct opnieuw uitnodigbaar — de reparatieweg voor een tikfout.
  async function handleCancelInvite(id: string) {
    setCancelBusy(id)
    try {
      const res = await fetch('/api/invite/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      // Ook een 409 ("staat niet meer open") betekent: weg uit deze lijst.
      if (res.ok || res.status === 409) setInvites((prev) => prev.filter((i) => i.id !== id))
    } catch {
      /* volgende poging of herlaad toont de waarheid */
    } finally {
      setCancelBusy(null)
    }
  }

  // [UITNODIGING] De klok één keer per mount, buiten de render om (readClock-vorm — zie
  // /dashboard/accountant): resterende dagen zijn geen live-aftelklok, en de compiler merkt
  // Date.now() in een render terecht als onzuiver aan.
  const [nu] = useState(() => new Date().getTime())

  /** Hoeveel dagen een uitnodiging nog geldig is (14 — zelfde grens als de acceptatieroute). */
  function dagenOver(sentAt: string | null): number {
    if (!sentAt) return 0
    const verstreken = (nu - new Date(sentAt).getTime()) / 86400000
    return Math.max(0, Math.ceil(14 - verstreken))
  }

  // ─── [BULK-UITNODIGEN] Meerdere klanten in één keer ────────────────────────
  async function handleBulkInvite() {
    // Scheidingstekens zoals mensen lijsten plakken: nieuwe regels, komma's, puntkomma's,
    // spaties uit een spreadsheetkolom. Dubbele adressen één keer.
    const alleAdressen = [...new Set(
      bulkText.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')),
    )]
    const parsed = alleAdressen.slice(0, 200)
    if (parsed.length === 0 || bulkBusy) return
    setBulkBusy(true)
    setBulkResults([])
    // [GEEN-STILLE-KAP] Wie 250 adressen plakt, moet HOREN dat er 200 gingen — anders concludeert
    // het kantoor dat iedereen is uitgenodigd, en de laatste 50 wachten voor altijd.
    setBulkOverflow(alleAdressen.length > 200 ? alleAdressen.length - 200 : 0)
    const results: Array<{ email: string; ok: boolean; message?: string }> = []
    for (const email of parsed) {
      try {
        const res = await fetch('/api/invite/client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientEmail: email }),
        })
        const json = await res.json().catch(() => ({}))
        results.push(res.ok
          ? { email, ok: true }
          : { email, ok: false, message: failureText(res.status, json, t('bh.klant.invite.failed')) })
      } catch {
        results.push({ email, ok: false, message: t('bh.klant.error.networkShort') })
      }
      // Tussenstand per adres — bij een lange lijst ziet het kantoor de voortgang lopen.
      setBulkResults([...results])
      // [BULK-TEMPO] Adem tussen twee adressen: elke uitnodiging is een Resend-mail, en een
      // strakke lus van 200 loopt tegen diens rate limit — dan faalt de STAART van de lijst,
      // precies het deel waarvan niemand het resultaat nog naleest.
      if (results.length < parsed.length) await new Promise((r) => setTimeout(r, 600))
    }
    setBulkBusy(false)
  }

  // ─── Unlink ─────────────────────────────────────────────

  async function handleUnlink() {
    if (!unlinkTarget) return
    setUnlinkLoading(true)
    setUnlinkError(null)

    try {
      const res = await fetch('/api/accountant/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: unlinkTarget.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setUnlinkError(failureText(res.status, json, t('bh.klant.unlink.failed')))
      } else {
        setClients(prev => prev.filter(c => c.id !== unlinkTarget.id))
        setUnlinkTarget(null)
      }
    } catch {
      setUnlinkError(t('bh.klant.error.network'))
    } finally {
      setUnlinkLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Invite block ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('bh.klant.invite.title')}</h2>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
              {t('bh.klant.invite.intro')}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(false) }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                placeholder="klant@bedrijf.nl"
                style={{
                  flex: 1,
                  fontSize: 14,
                  padding: '8px 12px',
                  border: `1px solid ${inviteError ? '#EA4335' : '#dadce0'}`,
                  borderRadius: 8,
                  backgroundColor: '#F8F9FA',
                  color: '#202124',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleInvite}
                disabled={inviteLoading || !inviteEmail.trim()}
                style={{
                  backgroundColor: '#1A73E8',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: (inviteLoading || !inviteEmail.trim()) ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                  minHeight: 36,
                }}
              >
                {inviteLoading ? t('bh.klant.invite.sending') : t('bh.klant.invite.send')}
              </button>
            </div>

            {inviteError && (
              <p style={{ fontSize: 13, color: M3.error, margin: 0 }}>{inviteError}</p>
            )}
            {inviteSuccess && (
              <p style={{ fontSize: 13, color: M3.success, margin: 0, fontWeight: 500 }}>
                {t('bh.klant.invite.sent')}
              </p>
            )}

            {/* ── [BULK-UITNODIGEN] ── */}
            <button
              onClick={() => setBulkOpen((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 500, color: '#1A73E8', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}
            >
              {bulkOpen ? '▾' : '▸'} {t('bh.klant.bulk.toggle')}
            </button>
            {bulkOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
                  {t('bh.klant.bulk.intro')}
                </p>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={5}
                  placeholder={'klant1@bedrijf.nl\nklant2@bedrijf.nl\nklant3@bedrijf.nl'}
                  style={{ fontSize: 13.5, padding: '8px 12px', border: '1px solid #dadce0', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div>
                  <button
                    onClick={handleBulkInvite}
                    disabled={bulkBusy || !bulkText.includes('@')}
                    style={{ backgroundColor: '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (bulkBusy || !bulkText.includes('@')) ? 0.5 : 1, minHeight: 36 }}
                  >
                    {bulkBusy
                      ? t('bh.klant.bulk.sending', { count: bulkResults.length })
                      : t('bh.klant.bulk.send')}
                  </button>
                </div>
                {/* [GEEN-STILLE-KAP] De adressen boven de 200 zijn NIET verstuurd, en dat moet er
                    staan — anders leest het kantoor "klaar" en wachten de laatste vijftig eeuwig. */}
                {bulkOverflow > 0 && (
                  <p style={{ fontSize: 12.5, color: '#7C5800', margin: 0 }}>
                    {t('bh.klant.bulk.overflow', { count: bulkOverflow })}
                  </p>
                )}
                {bulkResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>
                      {t('bh.klant.bulk.sentCount', { count: bulkResults.filter((r) => r.ok).length })}
                      {bulkResults.some((r) => !r.ok) ? ` · ${t('bh.klant.bulk.failedCount', { count: bulkResults.filter((r) => !r.ok).length })}` : ''}
                      {bulkBusy ? ` — ${t('bh.klant.bulk.busy')}` : ''}
                    </p>
                    {bulkResults.filter((r) => !r.ok).map((r) => (
                      <p key={r.email} style={{ fontSize: 12.5, color: M3.error, margin: 0 }}>
                        ✗ {r.email} — {r.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── [UITNODIGING] Verstuurd, wacht op reactie ──
            Tot nu toe was het enige spoor van een uitnodiging de fout bij opnieuw proberen.
            Een kantoor dat er veertig verstuurt, hoort te kunnen zien wat er uitstaat, sinds
            wanneer, en hoe lang de link nog leeft — en een tikfout hoort intrekbaar te zijn. */}
        {invites.length > 0 && (
          <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>
                {t('bh.klant.uitn.kop', { count: invites.length })}
              </h2>
            </div>
            <div>
              {invites.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #F1F3F4' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* [TAAL] dir="ltr": een e-mailadres blijft links-naar-rechts, ook in het Arabisch. */}
                    <p dir="ltr" style={{ fontSize: 13.5, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>{inv.email}</p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>
                      {t('bh.klant.uitn.verloopt', { dagen: dagenOver(inv.sentAt) })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCancelInvite(inv.id)}
                    disabled={cancelBusy === inv.id}
                    className="tap-44"
                    style={{ border: '1px solid #DADCE0', background: '#fff', color: '#5F6368', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', opacity: cancelBusy === inv.id ? 0.5 : 1, whiteSpace: 'nowrap' }}
                  >
                    {t('bh.klant.uitn.intrekken')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Client list ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('bh.klant.list.title')}</h2>
          </div>

          {clients.length > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #E0E0E0', position: 'relative' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', insetInlineStart: 27, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('bh.klant.search.placeholder')}
                aria-label={t('bh.klant.search.aria')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 13.5, outline: 'none', color: '#202124' }}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label={t('bh.klant.search.clear')} className="tap-44" style={{ position: 'absolute', insetInlineEnd: 23, top: '50%', transform: 'translateY(-50%)', width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
          )}

          {clientsUnreadable ? (
            /* [BOEKHOUDER-LEEG] "Nog geen klanten gekoppeld" is a claim about this accountant's
               mandates. A read that failed cannot make it, and on the screen where links are
               managed it would read as "your mandates are gone". */
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0, lineHeight: 1.55 }}>
              {t('bh.klant.unreadable.line1')}<br />
              {t('bh.klant.unreadable.line2')}
            </p>
          ) : clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              {t('bh.klant.list.empty')}
            </p>
          ) : shownClients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              {t('bh.klant.list.noMatch', { query: search.trim() })}
            </p>
          ) : (
            <div>
              {shownClients.map((client, idx) => (
                <div
                  key={client.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom: idx < shownClients.length - 1 ? '1px solid #F1F3F4' : 'none',
                    minHeight: 60,
                  }}
                >
                  {/* [READINESS] attention dot — the accountant's own worklist state */}
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: attentionColor(client.readiness),
                  }} />

                  {/* Name + email — clickable to client page */}
                  <button
                    onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                    style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', padding: 0 }}
                  >
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company_name ?? client.full_name ?? '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.email}
                    </p>
                  </button>

                  {/* [READINESS] honest facts, not a verdict.
                      [KANTOOR-LINKS] And they open the period they are ABOUT. Every number on this
                      line is counted over the aangifte quarter (accountant.repository.ts, via
                      getActiveAangifte) and `readiness` carries that year/quarter with it — while
                      the name beside it opened `/dashboard/clients/{id}`, whose quarter grid
                      defaults to the CALENDAR quarter. So the accountant read "3 vraag" about Q2
                      and landed on Q3. The name still opens the client; the STATE opens its own
                      period. */}
                  <button
                    onClick={() => router.push(clientQuarterHref({
                      clientId: client.id,
                      year: client.readiness.year,
                      quarter: client.readiness.quarter,
                    }))}
                    title={t('bh.klant.readiness.open', { kwartaal: `Q${client.readiness.quarter} ${client.readiness.year}` })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#5F6368', whiteSpace: 'nowrap' }}>
                      {readinessLine(t, client.readiness)}
                    </span>
                    {/* [NO-SILENT-EMPTY] Geen vragenbadge op een stand die niet gelezen kon
                        worden: het getal is dan een ondergrens, geen telling. */}
                    {!client.readiness.readFailed && client.readiness.openQuestions > 0 && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#FCE8E6', color: '#C5221F',
                      }}>
                        {t('bh.klant.openQuestions', { count: client.readiness.openQuestions })}
                      </span>
                    )}
                  </button>

                  {/* Unlink button */}
                  <button
                    onClick={() => { setUnlinkTarget(client); setUnlinkError(null) }}
                    style={{
                      background: 'none',
                      border: '1px solid #dadce0',
                      borderRadius: 8,
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: M3.error,
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FCE8E6')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {t('bh.klant.unlink.action')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* ── Confirm unlink dialog ── */}
      {unlinkTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !unlinkLoading && setUnlinkTarget(null)}
        >
          <div className="sheet-scroll"
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 12,
              padding: 24, maxWidth: 400, width: '100%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: '0 0 8px' }}>
              {t('bh.klant.unlink.title')}
            </h3>
            {/* [TAAL] One sentence, one key: the name is a parameter, but where it stands in the
                sentence is not — so the emphasis around it cannot travel with it. */}
            <p style={{ fontSize: 14, color: '#5F6368', margin: '0 0 20px', lineHeight: 1.5 }}>
              {t('bh.klant.unlink.confirm', { name: unlinkTarget.company_name ?? unlinkTarget.full_name ?? '' })}
            </p>

            {unlinkError && (
              <p style={{ fontSize: 13, color: M3.error, margin: '0 0 12px' }}>{unlinkError}</p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setUnlinkTarget(null)}
                disabled={unlinkLoading}
                style={{
                  background: '#FFFFFF', color: '#202124',
                  border: '1px solid #dadce0', borderRadius: 8,
                  padding: '8px 18px', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', minHeight: 36,
                }}
              >
                {t('bh.klant.cancel')}
              </button>
              <button
                onClick={handleUnlink}
                disabled={unlinkLoading}
                style={{
                  backgroundColor: '#EA4335', color: '#FFFFFF',
                  border: 'none', borderRadius: 8,
                  padding: '8px 18px', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', opacity: unlinkLoading ? 0.6 : 1, minHeight: 36,
                }}
              >
                {unlinkLoading ? t('bh.klant.unlink.busy') : t('bh.klant.unlink.action')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}