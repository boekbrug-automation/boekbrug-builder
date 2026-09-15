'use client'

// src/app/dashboard/zzp/ZzpDashboard.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026
//
// ─────────────────────────────────────────────────────────────────────────────
// [DASH-SIMPLIFY] ZZP home information architecture (redesign, presentation-only)
// ─────────────────────────────────────────────────────────────────────────────
// WHY: the home used to be a flat list of 12 equal-weight ActionCards — a "wall of
// doors" the shop owner had to read top to bottom. Nothing was wrong functionally;
// it was just undifferentiated. This redesign REGROUPS the exact same destinations
// into four scannable sections and shrinks the six "record" screens into one compact
// grid. It is a pure presentation change:
//   · No route changed, no page removed, no data/fetch touched.
//   · Every destination that was reachable before is still reachable.
//   · The greeting, DailyTruth snapshot ("Waar je staat" + "Aandacht nodig"),
//     the "Ben ik klaar?" hero and the +Nieuwe factuur FAB are UNCHANGED.
//
// The four groups (see the render for the mapping):
//   1. Toevoegen         — the daily input actions (add bon/factuur, bulk upload)
//   2. Mijn administratie — the record screens as a 3-col tile grid
//                           (Facturen · Inkomend · Inkoopfacturen · Bank · Kas ·
//                            Dagomzet · Artikelen)
//   3. Cijfers & aangifte — "Je waarheid" (primary) + one compact MiniCard
//   4. Meer              — Mijn werkplek
//
// DECISION RESOLVED (July 2026) — this note used to say that "Financieel overzicht"
// (/dashboard/resultaat) was kept as a de-emphasised MiniCard because it overlapped
// "Je waarheid" but was reachable ONLY from here, so dropping the link would ORPHAN
// the page; and that truly merging the two was a separate product+page decision to
// be done at the page level (redirect resultaat → waarheid), never by orphaning.
// That decision has now been taken, in exactly that order: the page redirects, so
// nothing is orphaned and old bookmarks keep working. The two screens rendered the
// same six numbers from the same engine — the duplication was not a second view, it
// was a second place to forget a completeness warning, which is precisely what had
// happened. Its two unique capabilities moved to waarheid first (the Q1–Q4 + year
// picker, and the card-control block); only then was this link removed.
//
// EXTENDING: add a record screen → add one <AdminTile> to the administratie grid.
// Its glyph and colour go in DOOR_LOOK (src/lib/nav-destinations.ts) and are spread in
// with doorLook(): the rail draws the same door from the same entry ([ZIJBALK-DEUR]),
// so a colour typed here by hand is the two drifting apart. Add a number screen → a
// MiniCard under "Je waarheid". Keep new top-level doors out of the flat list; put
// them in the group they belong to.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
// [KLAAR-STAND] The component holds no language of its own: this returns a key and a colour.
import { klaarRegel, type KlaarBron } from '@/lib/klaar-stand'
import { createClient } from '@/lib/supabase'
import { DashboardHeader, type HeaderProfile } from '../_shared'
import IntakeButton from '@/components/intake/IntakeButton'
// [HONEST-HOME] Re-enabled: the snapshot now shows only certain facts (exact stored
// invoice totals + a task count), each linking to the action that resolves it. The
// old version was disabled for showing inferred bank-derived numbers that were wrong.
import DailyTruth from './DailyTruth'
// [BRUG-RETOUR] De terugweg van de brug: een vraag van de boekhouder hoort op de home,
// niet alleen in een notificatie die je één keer ziet.
import { VRAAG_STATUS, vragenBannerTekst } from '@/lib/vragen'
import type { NotificationRow } from '@/types/rows'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN } from '@/lib/design/tokens'
import DashboardTools from '@/components/tools/DashboardTools'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
// [ZIJBALK-DEUR] One glyph and one colour per door, shared with the rail.
import { doorLook } from '@/lib/nav-destinations'
// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const FONT = "'Roboto', -apple-system, sans-serif"
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'

// ─── Main ─────────────────────────────────────────────────────────────────────
export function ZzpDashboard(
  { profile, vehicleTrade = false, workPluralKey = null }: { profile: HeaderProfile; vehicleTrade?: boolean; workPluralKey?: string | null },
) {
  const router   = useRouter()
  const t        = translator(useLocale())
  const supabase = createClient()

  const [notifications, setNotifications]         = useState<NotificationRow[]>([])
  const [notifError, setNotifError]               = useState<string | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages]       = useState(0)
  const [accountantId, setAccountantId]           = useState<string | null>(null)
  // [BOEK-029] BOEK-011 integration — pending incoming invoices count
  const [pendingCount, setPendingCount]           = useState<number>(0)
  // [BRUG-RETOUR] Openstaande vragen van de boekhouder over eigen documenten.
  const [vragenCount, setVragenCount]             = useState<number>(0)
  // [KLAAR-STAND] The readiness verdict, or null while unknown — see klaar-stand.ts.
  const [klaarRapport, setKlaarRapport]           = useState<KlaarBron | null>(null)

  async function loadGlobal() {
    const [{ data: link }, { data: notifData, error: notifErr }, { count, error: berichtenErr }, { count: vragen, error: vragenErr }] = await Promise.all([
      supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', profile.id).maybeSingle(),
      supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', profile.id).eq('read', false),
      // [BRUG-RETOUR] RLS (acc_status_client_read_document) beperkt dit al tot documenten
      // van deze gebruiker; er is hier geen eigenaarskolom om op te filteren.
      supabase.from('accountant_subject_status').select('subject_id', { count: 'exact', head: true })
        .eq('subject_type', 'document').eq('status', VRAAG_STATUS),
    ])
    if (link?.accountant_id) setAccountantId(link.accountant_id)
    // [NO-SILENT-EMPTY] `if (notifData)` alleen liet een mislukte lezing als "Geen meldingen" op
    // het scherm komen: supabase-js gooit niet, dus een RLS-weigering of een haperende verbinding
    // kwam hier binnen als data === null. De bel is de plek waar een vraag van de boekhouder
    // aankomt; "er is niets" is daar de duurste zin die hij kan tonen als hij het niet weet.
    if (notifErr) {
      console.error('[HOME] meldingen ophalen mislukt:', notifErr.message)
      setNotifError(t('start.meldingenFout'))
    } else {
      setNotifError(null)
      setNotifications(notifData ?? [])
    }
    // [NO-SILENT-EMPTY] Dezelfde redenering als bij de meldingen hierboven, voor de twee tellers
    // eronder: nul betekent op dit scherm "er ligt niets voor je", en een mislukte telling weet dat
    // niet. Een badge die wegblijft is stil; een badge die 0 zegt is een bewering — en de tweede
    // teller gaat over een openstaande VRAAG van de boekhouder, waar niet op reageren geld kost.
    setUnreadMessages(berichtenErr ? 0 : count || 0)
    setVragenCount(vragenErr ? 0 : vragen || 0)
    if (berichtenErr || vragenErr) {
      console.error('[NO-SILENT-EMPTY] tellers op het startscherm niet te lezen', {
        berichten: berichtenErr?.message, vragen: vragenErr?.message,
      })
    }

    // [KLAAR-STAND] The verdict for the CURRENT quarter, so the button below can answer instead of
    // ask. Same endpoint /dashboard/klaar opens with; a failure leaves the report null, and
    // klaarRegel then keeps the question — never a green on a quarter nobody measured.
    try {
      const nu = new Date()
      const kwartaal = Math.floor(nu.getMonth() / 3) + 1
      const res = await fetch(`/api/readiness?year=${nu.getFullYear()}&quarter=${kwartaal}`)
      if (res.ok) {
        const json = await res.json()
        setKlaarRapport(json?.report ?? null)
      }
    } catch {
      // silent — the button keeps asking the question, which is the honest answer here
    }

    // [BOEK-029] BOEK-011: fetch pending incoming invoices count
    try {
      const res = await fetch('/api/email/sync')
      if (res.ok) {
        const json = await res.json()
        // null = niet geteld (de route zegt dat nu expliciet); dan blijft de badge weg in plaats
        // van "0 wacht op verificatie" te beweren.
        setPendingCount(typeof json.pending_count === 'number' ? json.pending_count : 0)
      }
    } catch {
      // silent — badge blijft 0
    }
  }

  // Eén ophaalronde bij het openen. Staat bewust ná loadGlobal: een effect dat een functie
  // aanroept die pas verderop gedeclareerd wordt, werkt door hoisting wel maar is voor de
  // React-compiler niet te volgen (en breekt zodra iemand er een closure-waarde in gebruikt).
  useEffect(() => { void (async () => { await loadGlobal() })() }, [])

  async function markAllRead() {
    // Het scherm mag pas "gelezen" tonen als het ook echt is opgeslagen. De uitkomst werd hier
    // genegeerd: de bel ging op nul, en bij de volgende keer openen stonden dezelfde meldingen
    // er weer ongelezen bij — zonder dat iets uitlegde waarom. Bij een bel die zegt dat je
    // boekhouder iets van je wil, is dat het verkeerde soort ruis om te negeren.
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    if (error) {
      console.error('[HOME] meldingen als gelezen markeren mislukt:', error.message)
      return
    }
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const firstName = profile.full_name?.split(' ')[0] ?? 'daar'

  // [KLAAR-STAND] Derived in render, never stored: one source of truth for the line.
  const klaarStand = klaarRegel(klaarRapport)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>
      <DashboardHeader
        profile={profile} notifications={notifications}
        showNotifications={showNotifications}
        notificationsError={notifError}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => { setShowNotifications(p => !p) }}
        onMarkAllRead={markAllRead}
        onMessagesClick={() => accountantId ? router.push(`/dashboard/messages/${accountantId}`) : router.push('/dashboard/messages')}
        onLogout={async () => { await supabase.auth.signOut(); router.push('/login') }}
      />

      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '32px 16px 100px' }}>

        {/* Greeting */}
        <p style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, fontWeight: 500, letterSpacing: 0.2 }}>GOEDENDAG</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: M3.onSurface, marginBottom: 28, letterSpacing: -0.5 }}>
          {firstName} 👋
        </h1>
        {/* [BRUG-RETOUR] Een mens wacht op je. Dit staat bewust bóven de cijfers: een vraag
            van je boekhouder is het enige op deze pagina waar iemand anders op zit te
            wachten. Verschijnt alleen als er echt iets openstaat — nooit als lege balk. */}
        {vragenCount > 0 && (
          <button
            onClick={() => router.push('/dashboard/vragen')}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start',
              padding: '15px 16px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid #F0C36D', background: M3.warningContainer,
              boxShadow: EL1, marginBottom: 18,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#7a4f00' }} aria-hidden>help</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: '#5a3e00' }}>
                {vragenBannerTekst(vragenCount)}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: '#7a4f00', marginTop: 2 }}>
                {t('start.vraag')}
              </span>
            </span>
            <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: '#7a4f00' }} aria-hidden>chevron_right</span>
          </button>
        )}

        {/* [HONEST-HOME] Snapshot: "waar sta ik?" answered with certain facts only,
            each a button to the action that resolves it. */}
        <DailyTruth />

        {/* [READINESS] The connective layer — one tap to "ben ik klaar voor de
            boekhouder?": a single verdict over everything imported (facturen, bank,
            dagomzet, BTW) with the few things that still need attention and one-click
            handover. Deliberately prominent (not a menu row) — it's the answer the
            store owner actually comes for. */}
        <button
          onClick={() => router.push('/dashboard/klaar')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'start',
            padding: '18px 18px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
            border: 'none', background: 'linear-gradient(135deg, #1A73E8, #1557B0)',
            boxShadow: EL1, margin: '20px 0 8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#fff' }} aria-hidden>fact_check</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: -0.2 }}>{t('start.klaar')}</span>
            {/* [KLAAR-STAND] The ANSWER, where the owner already is. The title stays the door's own
                name ([KNOP-IN-ZIN]: sentences elsewhere point at "Ben ik klaar?"), and the verdict
                goes here — with a dot, because a state is read before a sentence is. */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
              {klaarStand.stand !== 'unknown' && (
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: klaarStand.kleur, flexShrink: 0, boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }} />
              )}
              <span>{t(klaarStand.key, klaarStand.params)}</span>
            </span>
          </span>
          <span className="material-symbols-outlined icon-dir" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }} aria-hidden>chevron_right</span>
        </button>

        {/* [DASH-SIMPLIFY] Grouped home — same destinations as before, now in four
            labelled sections instead of one flat list of 12 equal cards. See the
            file-header note for the full rationale and the group→route mapping.
            Order: what you DO (Toevoegen) → what you MANAGE (administratie) →
            what you GET (cijfers) → the rest (werkplek). Bigger gap BETWEEN groups
            (22) than WITHIN a group (12) so the sections read as distinct blocks. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* ── 1. TOEVOEGEN — the daily input actions ─────────────────────────── */}
          <section>
            <SectionLabel>{t('start.toevoegen')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Bon/factuur toevoegen — foto of bestand → AI sorteert. Own modal
                  (camera/upload); kept full-width as the primary daily action. */}
              <IntakeButton variant="card" />
              {/* [UPLOAD-HUB] Alles uploaden — many files at once; the app sorts them. */}
              <ActionCard
                icon={doorLook('/dashboard/upload').icon} iconBg={doorLook('/dashboard/upload').tint} iconColor="#fff"
                label={t('start.allesUploaden')} sub={t('start.allesUploaden.sub')}
                onClick={() => router.push('/dashboard/upload')}
              />
              {/* [KASSA] In Toevoegen and not in the administratie grid below, per this file's own
                  extension rule: that grid holds the screens you go and READ, and a counter is
                  something you DO — a barber taps it thirty times a day and never opens anything
                  else. It is also the only door for an owner with no kassa-rapport: his PIN revenue
                  otherwise reaches the books with no btw rate at all, which blocks his aangifte. */}
              <ActionCard
                icon={doorLook('/dashboard/kassa').icon} iconBg={doorLook('/dashboard/kassa').tint} iconColor="#fff"
                label={t('start.kassa')} sub={t('start.kassa.sub')}
                onClick={() => router.push('/dashboard/kassa')}
              />
            </div>
          </section>

          {/* ── 2. MIJN ADMINISTRATIE — the record screens as a compact grid ────── */}
          {/* Each tile reuses its screen's original icon + colour so nothing feels
              relocated, only regrouped. The two purchase surfaces sit adjacent:
              "Inkomend" is the verify QUEUE (/incoming, carries the pending-verify
              badge); "Inkoopfacturen" is the CONFIRMED crediteuren-management
              (/incoming/manage — mark paid, betaalstatus), which titles itself
              "Inkoopfacturen" and was previously only reachable from inside the
              queue. Surfaced here so the owner reaches their te-betalen bills
              straight from home. */}
          <section>
            <SectionLabel>{t('start.administratie')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <AdminTile {...doorLook('/dashboard/facturen')} label={t('start.tegel.facturen')}
                onClick={() => router.push('/dashboard/facturen')} />
              <AdminTile {...doorLook('/dashboard/incoming')} label={t('start.tegel.inkomend')} badge={pendingCount}
                onClick={() => router.push('/dashboard/incoming')} />
              {/* [NAV-FROM] ?from=home so Terug on Inkoopfacturen returns HERE. Without it the
                  canonical parent is /dashboard/incoming — a verification list this visitor never
                  passed through, since this tile jumps straight to the manage surface. */}
              <AdminTile {...doorLook('/dashboard/incoming/manage')} label={t('start.tegel.inkoop')}
                onClick={() => router.push('/dashboard/incoming/manage?from=home')} />
              {/* [LEVERANCIER-DEUR] Precies de fout die [UREN-DEUR] hieronder beschrijft, opnieuw
                  gemaakt en meteen hersteld: /dashboard/leveranciers werd gebouwd, vertaald,
                  getest en door de render-gate gehaald, en had NUL inkomende links. Alleen de
                  titelbalk kende het pad — en die geeft een scherm een kop zodra je er BENT, niet
                  een weg ernaartoe.
                  Naast Inkoopfacturen, want dit is de optelsom van precies die stapel: wat er per
                  leverancier nog openstaat, en wat daarvan vervallen is. */}
              <AdminTile {...doorLook('/dashboard/leveranciers')} label={t('start.tegel.leveranciers')}
                onClick={() => router.push('/dashboard/leveranciers')} />
              <AdminTile {...doorLook('/dashboard/bank')} label={t('start.tegel.bank')}
                onClick={() => router.push('/dashboard/bank')} />
              <AdminTile {...doorLook('/dashboard/kas')} label={t('start.tegel.kas')}
                onClick={() => router.push('/dashboard/kas')} />
              <AdminTile {...doorLook('/dashboard/dagomzet')} label={t('start.tegel.dagomzet')}
                onClick={() => router.push('/dashboard/dagomzet')} />
              <AdminTile {...doorLook('/dashboard/artikelen')} label={t('start.tegel.artikelen')}
                onClick={() => router.push('/dashboard/artikelen')} />
              {/* [UREN-DEUR] Het urenscherm had NUL inkomende links — niet hier, niet op de
                  werkplek, niet in de onderbalk. Het was gebouwd, vertaald, getest en door de
                  render-gate gehaald, en alleen bereikbaar door het pad zelf in te tikken. Voor een
                  zzp'er die per uur factureert is dat het archetypische scherm, en het stond achter
                  een deur die niemand had opgehangen.

                  Hier, in het administratieraster, want dat is wat het is: een registratiescherm,
                  precies zoals Kas en Dagomzet. De uitbreidingsregel in de kop van dit bestand zegt
                  hetzelfde ("add a record screen → add one <AdminTile> to the administratie grid"). */}
              <AdminTile {...doorLook('/dashboard/uren')} label={t('start.tegel.uren')}
                onClick={() => router.push('/dashboard/uren')} />
              {/* [VOERTUIG] Only for a trade that works on cars. A barber shown a vehicle register
                  learns that this app guesses about him; a monteur without one has nowhere to put
                  the only thing he actually thinks in. Unknown trade → absent, exactly as before. */}
              {vehicleTrade && (
                <AdminTile {...doorLook('/dashboard/voertuigen')} label={t('vtg.titel')}
                  onClick={() => router.push('/dashboard/voertuigen')} />
              )}
              {/* [WERK] The trade's own work, in its own plural: Werkorders, Ritten, Klussen,
                  Opdrachten. Absent for a trade without a work layer, exactly as before. */}
              {workPluralKey && (
                <AdminTile {...doorLook('/dashboard/werk')} label={t(workPluralKey as MessageKey)}
                  onClick={() => router.push('/dashboard/werk')} />
              )}
            </div>
          </section>

          {/* ── 3. CIJFERS & AANGIFTE — the numbers the owner comes for ─────────── */}
          {/* "Je waarheid" is the primary live view (full card). "Financieel
              overzicht" and "Concept BTW-aangifte" are compact MiniCards beneath it —
              kept reachable (never orphaned) but de-emphasised because they overlap
              the live view. See the file-header decision note before touching this. */}
          <section>
            <SectionLabel>{t('start.cijfers')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* [TRUTH-LENS] Je financiële waarheid — één live beeld (omzet, kosten,
                  winst, BTW) met tijd-lens. Zelfde reconcile-pijplijn als de aangifte. */}
              <ActionCard
                icon={doorLook('/dashboard/waarheid').icon} iconBg={doorLook('/dashboard/waarheid').tint} iconColor="#fff"
                label={t('start.waarheid')} sub={t('start.waarheid.kaartSub')}
                onClick={() => router.push('/dashboard/waarheid')}
              />
              {/* [RESULT→WAARHEID] "Financieel overzicht" (/dashboard/resultaat) is gone as a
                  destination — it rendered the same six numbers as "Je waarheid" from the same
                  engine, and its two unique capabilities (the quarter picker, the card-control
                  block) now live on waarheid. The page is a redirect, not an orphan, so old
                  bookmarks still land somewhere correct. That leaves ONE concept card here, so the
                  two-column grid is gone with it — a 1fr 1fr grid holding a single child left a
                  dead half-row. */}
              {/* [AANGIFTE] Concept rubrieken (1a/1b/5a/5b) — a draft, never a filing. */}
              <MiniCard {...doorLook('/dashboard/aangifte')}
                label={t('start.conceptBtw')} sub="1a/1b/5a/5b"
                onClick={() => router.push('/dashboard/aangifte')} />
              {/* [IB-JAAR-DEUR] Het jaaroverzicht is expliciet tweezijdig gebouwd — een boekhouder
                  opent het jaar van een klant via ?clientId, en zónder die parameter is het het
                  EIGEN jaar van de ondernemer (zie JaarClient). Alleen: de enige link in de hele
                  app stond op het werkbord van de boekhouder. De cijfers voor je eigen IB-aangifte
                  en je auditfile waren daarmee bereikbaar voor iedereen behalve degene van wie ze
                  zijn. Hier, naast de concept-BTW, want dat is dezelfde vraag over een andere
                  periode. */}
              <MiniCard {...doorLook('/dashboard/jaar')}
                label={t('start.jaar')} sub={t('start.jaar.sub')}
                onClick={() => router.push('/dashboard/jaar')} />
              {/* [GROOTBOEK-KAART] Het grootboek bestond al — als journaalposten in het auditfile,
                  gebouwd door dezelfde functie die dit scherm nu leest. Wat ontbrak was de deur.
                  Hij staat hier omdat een boekhouder die op het woord zoekt en niets vindt, niet
                  concludeert dat de deur ontbreekt maar dat het grootboek ontbreekt. */}
              <MiniCard {...doorLook('/dashboard/grootboek')}
                label={t('start.grootboek')} sub={t('start.grootboek.sub')}
                onClick={() => router.push('/dashboard/grootboek')} />
            </div>
          </section>

          {/* ── 4. MEER — secondary workspace ──────────────────────────────────── */}
          <section>
            <SectionLabel>{t('start.meer')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ActionCard
                icon={doorLook('/dashboard/werkplek').icon} iconBg={doorLook('/dashboard/werkplek').tint} iconColor="#fff"
                label={t('start.tegel.werkplek')} sub={t('start.werkplek.sub')}
                onClick={() => router.push('/dashboard/werkplek')}
              />
              {/* [ACTING-FOR] Team — wie mag er onder JOUW BTW-nummer factureren.
                  Stond alleen in Instellingen, en dat is te ver weg voor de zwaarste bevoegdheid
                  die een eigenaar kan weggeven: een medewerker geeft facturen uit die bij een
                  controle niet van die van de eigenaar zijn te onderscheiden. Wat je uitdeelt en
                  intrekt hoort zichtbaar te zijn vanaf het startscherm, niet twee schermen diep.

                  Hier en niet bij "Mijn administratie": die tegels gaan over PAPIER dat binnenkomt.
                  Dit gaat over MENSEN, en het is een instelling die je een paar keer per jaar
                  aanraakt — de plek van "Mijn werkplek", niet van "Bank".

                  `person_add` zit al in de icon_names-subset van layout.tsx; een naam die daar
                  niet in staat rendert als rauwe ligatuurtekst (zie material-icons.test.ts). */}
              <ActionCard
                icon={doorLook('/dashboard/settings/team').icon} iconBg={doorLook('/dashboard/settings/team').tint} iconColor="#fff"
                label={t('start.tegel.team')} sub={t('start.team.sub')}
                onClick={() => router.push('/dashboard/settings/team')}
              />
            </div>
          </section>

          {/* [DASHBOARD-TOOLS] Het laatste blok, en met opzet het laatste: dit is
              gereedschap dat je pakt wanneer je het nodig hebt, geen werk dat op
              je ligt te wachten. Links, geen componenten — zie de notitie boven
              in DashboardTools. */}
          <DashboardTools audience="owner" />

        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — the single primary create action.
          (The second, Intake FAB was removed — "Bon toevoegen" is the first card.) */}
      <Fab onClick={() => router.push('/dashboard/invoice/new')} />
    </div>
  )
}

// ─── Design system constants ──────────────────────────────────────────────────

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionCard({ icon, iconBg, iconColor, label, sub, onClick, active, activeColor, activeBg }: {
  icon: string; iconBg: string; iconColor: string
  label: string; sub: string; onClick: () => void
  active?: boolean; activeColor?: string; activeBg?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: active && activeBg ? activeBg : '#fff',
        borderRadius: R.lg, padding: '18px 16px',
        border: active && activeColor ? `2px solid ${activeColor}` : '2px solid transparent',
        boxShadow: EL1, cursor: 'pointer', textAlign: 'start', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: R.md,
        background: iconBg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: 24 }} aria-hidden>{icon}</span>
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 13, color: '#5F6368' }}>{sub}</p>
      </div>
      <span className="material-symbols-outlined icon-dir" style={{ color: '#80868b', fontSize: 20 }} aria-hidden>chevron_right</span>
    </button>
  )
}

// [BOEK-029] StatCard removed — replaced by Financieel overzicht ActionCard
// [DASH-SIMPLIFY] ActionCardBadge removed — the only user (Inkomende facturen) is
// now an <AdminTile> in the administratie grid, which carries the badge itself.

// [DASH-SIMPLIFY] SectionLabel — the small uppercase header that turns the flat
// menu into scannable groups. Purely a grouping affordance; carries no state.
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

// [DASH-SIMPLIFY] AdminTile — compact 3-per-row tile for the "Mijn administratie"
// record screens. Same icon-tile visual language as ActionCard, but centered and
// label-only so six sources read as ONE group instead of six full-width cards.
// `tint` is the screen's own accent colour (reused for continuity); `badge` is an
// optional count (used by Inkomend for the pending-verify queue).
function AdminTile({ icon, tint, label, badge, onClick }: {
  icon: string; tint: string; label: string; badge?: number; onClick: () => void
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
        position: 'relative', width: 46, height: 46, borderRadius: R.md,
        background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 24 }} aria-hidden>{icon}</span>
        {badge != null && badge > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, background: '#B3261E', color: '#fff',
            borderRadius: 9999, minWidth: 18, height: 18, fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            border: '2px solid #fff', fontFamily: FONT,
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#202124', textAlign: 'center' }}>{label}</span>
    </button>
  )
}

// [DASH-SIMPLIFY] MiniCard — compact 2-per-row card for the secondary number
// screens (Financieel overzicht, Concept BTW-aangifte) that sit under the primary
// "Je waarheid". Left-aligned icon + label + short sub; no chevron (kept light).
function MiniCard({ icon, tint, label, sub, onClick }: {
  icon: string; tint: string; label: string; sub: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        background: '#fff', borderRadius: R.lg, padding: '13px 12px',
        border: 'none', boxShadow: EL1, cursor: 'pointer', textAlign: 'start', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: R.sm, background: tint,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 20 }} aria-hidden>{icon}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0, lineHeight: 1.2 }}>{label}</p>
        <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{sub}</p>
      </div>
    </button>
  )
}

// [BOEK-029] Shared FAB — + Nieuwe factuur — all ZZP pages
function Fab({ onClick }: { onClick: () => void }) {
  const t = translator(useLocale())
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
        insetInlineEnd: 20,
        background: '#D3E3FD',
        color: '#041E49',
        borderRadius: 16,
        padding: '16px 20px',
        fontSize: 15, fontWeight: 600,
        border: 'none', cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: "'Roboto', sans-serif",
        zIndex: 50,
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>add</span>
      {t('start.nieuweFactuur')}
    </button>
  )
}