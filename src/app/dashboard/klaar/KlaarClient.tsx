'use client'

// src/app/dashboard/klaar/KlaarClient.tsx
// [READINESS] The owner's one screen that answers one question: "ben ik klaar voor de
// boekhouder?" — not a dashboard, not charts. A single verdict, the strict rubric behind
// it (so the score is never a black box), the few things to fix, the few things to eyeball,
// and one button to hand it all over. A pure projection of /api/readiness.

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { quarterFromParams, currentQuarter, isPeriodStarted, type QuarterNo as PeriodQuarter } from '@/lib/quarter'
// [KLAAR-URL] The period lives in the URL; the picker writes it there and reads it back.
import { klaarPath } from '@/lib/klaar-stand'
import { M3, FONT, FONT_NUM, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [DOORLOPEND] Zie de kop van dat bestand: één regel als het klopt, een kader als het niet klopt.
import { NummeringPaneel } from '@/components/beveiliging/NummeringPaneel'
import { GeldPaneel } from '@/components/beveiliging/GeldPaneel'
import { failureText } from '@/lib/server-message'
// [DEADLINE] De uiterste indieningsdatum en hoeveel dagen dat nog is — zelfde rekensom als de
// aangiftepagina en de herinneringscron.
import { deadlineNotice } from '@/lib/btw-deadline-notice'
import type { QuarterNo } from '@/lib/btw-reservation'
import { formatDateNL } from '@/lib/format-nl'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

type DimensionKey = 'invoices' | 'bank' | 'cash' | 'vat'
interface Dimension { key: DimensionKey; label: string; weight: number; applicable: boolean; subscore: number; detail: string }
interface Item { severity: 'missing' | 'risk'; title: string; detail?: string; fix?: { label: string; href: string } }
type Status = 'ready' | 'almost' | 'attention'
/** [PAKKET-AFDRUK] Eén ophaling van dit kwartaalpakket, met wat er sinds de vorige veranderde. */
interface Aflevering {
  id: string
  opgehaaldOp: string
  verkoopfacturen: number
  inkoopfacturen: number
  bestanden: number
  metBon: number
  veranderd: boolean
  /** 'figures_moved' | 'evidence_improved' | 'evidence_lost' — null bij de eerste ophaling. */
  soort: string | null
  vraagtActie: boolean
  uitleg: string | null
}
interface Report {
  quarterLabel: string
  score: number
  status: Status
  ready: boolean
  dimensions: Dimension[]
  missing: Item[]
  risks: Item[]
  notes: string[]
  /** [READINESS-DEGRADE] false when a read the verdict needed did not happen — then never green. */
  verified?: boolean
  unverified?: { key: string; label: string }[]
}
interface ApiResponse {
  ok: boolean
  year: number
  quarter: number
  report: Report
  concept: { verschuldigd: number; voorbelasting: number; saldo: number }
}

// [TAAL] The verdict titles live in the catalogue; this table keeps only the visuals plus the
// key each status renders through the component's translator.
const STATUS_META = {
  ready:     { emoji: '🟢', titleKey: 'klr.status.klaar',   bg: M3.successContainer, fg: M3.success, bar: M3.success },
  almost:    { emoji: '🟡', titleKey: 'klr.status.bijna',   bg: M3.warningContainer, fg: M3.warning, bar: '#E37400' },
  attention: { emoji: '🔴', titleKey: 'klr.status.nogNiet', bg: M3.errorContainer,   fg: M3.error,   bar: M3.error },
} as const satisfies Record<Status, { emoji: string; titleKey: string; bg: string; fg: string; bar: string }>

const DIM_ICON: Record<DimensionKey, string> = {
  invoices: 'receipt_long', bank: 'account_balance', cash: 'point_of_sale', vat: 'calculate',
}

export default function KlaarClient() {
  const t = translator(useLocale())
  const searchParams = useSearchParams()
  const router = useRouter()
  // [KLAAR-KWARTAAL] The period in the URL first — the home's door carries the quarter its verdict
  // was measured for (klaarPath) — and otherwise the app-wide default, from the same function the
  // home uses. Both surfaces therefore name ONE quarter, whichever way this screen was opened.
  //
  // [KLAAR-URL] And the URL is the ONLY place the period lives. It used to be copied into state
  // once and changed there, so the picker moved the screen while the address bar stayed on the
  // quarter the page was opened with: a refresh, a copied link, back/forward and a deep link all
  // named a different period than the one on the screen (audit KL-03). The picker now navigates —
  // klaarPath() writes the period, quarterFromParams() reads it back — and there is no second copy.
  const init = quarterFromParams((k) => searchParams.get(k))
  const year = init.year
  // Typed number (not the lib's 1|2|3|4) so the picker's comparisons and the deadline accept it.
  const quarter: number = init.quarter
  const gaNaar = (y: number, q: number) => router.push(klaarPath({ year: y, quarter: q as PeriodQuarter }), { scroll: false })
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // [TZ] Amsterdam, not the device's zone: around New Year those differ, and "which years may I
  // pick" would then be answered by whichever side of midnight the viewer happens to be on.
  const todayNl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  // [KLAAR-TOEKOMST] The same Amsterdam rule as the route and the home (quarter.ts): a period that
  // has not begun is not assessed, whether the picker or the address bar names it.
  const nu = currentQuarter()
  const curYear = nu.year
  const curQuarter: number = nu.quarter
  const begonnen = isPeriodStarted({ year, quarter: quarter as PeriodQuarter })
  // [DEADLINE] Op dezelfde Amsterdamse dag als de rest van dit scherm — todayNl is er al, en een
  // tweede bron voor "vandaag" is precies hoe twee regels op één scherm een andere dag tellen.
  const deadline = deadlineNotice(year, quarter as QuarterNo, todayNl)
  // [QUARTER] Refresh via a bump key so the manual "Vernieuwen" fetch runs through the
  // SAME cancellable effect — clicking refresh then quickly changing quarter can no longer
  // land stale-quarter data (the superseded request's cancelled flag is always set).
  const [reloadKey, setReloadKey] = useState(0)

  // [PAKKET-STAY] Fetch the ZIP rather than navigating to it — see the button below.
  const [pkgBusy, setPkgBusy] = useState(false)
  const [pkgError, setPkgError] = useState<string | null>(null)
  async function downloadPackage(y: number, q: number) {
    setPkgBusy(true); setPkgError(null)
    try {
      const res = await fetch(`/api/closing-package?year=${y}&quarter=${q}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }))
        setPkgError(failureText(res.status, j, t('klr.fout.pakket')))
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const named = /filename="?([^";]+)"?/i.exec(cd)?.[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named || `BoekBrug-Q${q}-${y}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setPkgError(t('klr.fout.pakketOffline'))
    } finally {
      setPkgBusy(false)
    }
  }

  // ── [PAKKET-LINK] Versturen naar een boekhouder ZONDER account ──
  //
  // De knop hierboven geeft de eigenaar een ZIP in handen; daarna moest hij zelf een mail openen
  // en hem eraan hangen. Dat is precies het handwerk dat dit product wegneemt, teruggegeven op de
  // laatste meter — en het raakt het meest voorkomende geval: een kantoor dat al jaren op Exact
  // draait en zich nooit ergens registreert. Deze knop levert de belofte zelf af.
  const [mailOpen, setMailOpen] = useState(false)
  const [mailAdres, setMailAdres] = useState('')
  const [mailNotitie, setMailNotitie] = useState('')
  const [mailBezig, setMailBezig] = useState(false)
  const [mailFout, setMailFout] = useState<string | null>(null)
  const [mailGelukt, setMailGelukt] = useState<string | null>(null)

  // [PAKKET-AFDRUK] Welke versies je boekhouder heeft opgehaald. package_deliveries legt elke
  // download vast; zonder dit blok bestond die select-policy voor een lezer die er niet was — de
  // eigenaar kreeg één melding op het moment zelf en kon daarna nergens meer zien wát hij toen had.
  //
  // [NO-SILENT-EMPTY] Drie standen, geen twee: nog niet gelezen (null), gelezen (een lijst, die
  // leeg mag zijn omdat "nooit opgehaald" een echt antwoord is), en niet te lezen (leesfout). Die
  // laatste als lege lijst tonen zou zeggen "je boekhouder heeft dit nooit opgehaald" — een
  // bewering, op precies het scherm waar de eigenaar controleert of de overdracht is aangekomen.
  // De uitkomst draagt de PERIODE waar hij bij hoort. Zo hoeft het effect niets synchroon te
  // resetten — dat veroorzaakt cascading renders — en toont het scherm nooit even de cijfers van
  // het vorige kwartaal onder de kop van het nieuwe.
  const [aflevering, setAflevering] = useState<
    { year: number; quarter: number; rijen: Aflevering[] | null } | null
  >(null)
  const geladen = aflevering && aflevering.year === year && aflevering.quarter === quarter
  const afleveringen = geladen ? aflevering.rijen : null
  const afleveringenFout = !!geladen && aflevering.rijen === null

  useEffect(() => {
    let afgebroken = false
    fetch(`/api/pakket/afleveringen?year=${year}&quarter=${quarter}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (afgebroken) return
        // rijen === null is de LEESFOUT; een lege array is het echte antwoord "nooit opgehaald".
        setAflevering({ year, quarter, rijen: res.ok ? ((json.afleveringen ?? []) as Aflevering[]) : null })
      })
      .catch(() => { if (!afgebroken) setAflevering({ year, quarter, rijen: null }) })
    return () => { afgebroken = true }
  }, [year, quarter, reloadKey])

  async function stuurNaarBoekhouder(y: number, q: number) {
    const adres = mailAdres.trim().toLowerCase()
    setMailBezig(true); setMailFout(null); setMailGelukt(null)
    try {
      const res = await fetch('/api/closing-package/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: y, quarter: q, email: adres, note: mailNotitie.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMailFout(failureText(res.status, json, t('klr.deel.fout')))
        return
      }
      setMailGelukt(adres)
      setMailAdres('')
      setMailNotitie('')
    } catch {
      setMailFout(t('klr.deel.offline'))
    } finally {
      setMailBezig(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // maar zonder synchrone setState in de effect-body (cascaderende renders).
      setLoading(true); setError(false); setData(null)
      // [KLAAR-TOEKOMST] Nothing to fetch about a period that has not begun; the screen says so.
      if (!begonnen) { setLoading(false); return }
      try {
        const r = await fetch(`/api/readiness?year=${year}&quarter=${quarter}`)
        if (!r.ok) throw new Error('readiness')
        const j = await r.json()
        if (!cancelled) setData(j)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [year, quarter, reloadKey, begonnen])

  const report = data?.report ?? null
  const meta = report ? STATUS_META[report.status] : STATUS_META.attention
  const teBetalen = data ? data.concept.saldo >= 0 : true

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={() => setReloadKey((k) => k + 1)} title={t('lijst.vernieuwen')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: M3.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>refresh</span>{t('lijst.vernieuwen')}
          </button>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, margin: '12px 0 14px' }}>{t('klr.titel')}</h1>

        {/* [DOORLOPEND] Loopt de nummering door? Boven de kwartaalkiezer, want dit is JAARBREED en
            geen kwartaalvraag — en het is precies de vraag die een boekhouder als eerste stelt.
            Zwijgt op één regel als het klopt: wie dit paneel nooit iets heeft zien zeggen, weet
            niet dat er iemand meekijkt, en een controle waarvan je niet weet dat hij bestaat levert
            geen enkel vertrouwen op. */}
        <div style={{ marginBottom: 16 }}>
          <NummeringPaneel />
        </div>

        {/* [GELD-INVARIANT] En de andere vraag die een boekhouder als eerste stelt: kloppen de
            boeken met zichzelf? Niet "was elke boeking goed toen ze gebeurde" — dat geloofde elke
            boeking van zichzelf — maar telt het resultaat nu nog op. Ook jaarbreed, ook stil op
            één regel als er niets te melden valt. */}
        <div style={{ marginBottom: 16 }}>
          <GeldPaneel />
        </div>

        {/* Quarter picker */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center' }}>
          {/* A quarter that has not started cannot be assessed. Without this the picker offered
              Q4 in January and answered with a confident 🔴 "Nog niet klaar · 0%" about a period
              that does not exist yet — an alarm the owner can do nothing about. The app already
              knows the rule: /api/btw/file refuses to file a quarter that has not ENDED
              ([FILING-WINDOW]); this is the same idea one step earlier. The CURRENT quarter stays
              selectable — checking your progress mid-quarter is the point of this screen. */}
          {[1, 2, 3, 4].map((q) => {
            const active = quarter === q
            const future = year > curYear || (year === curYear && q > curQuarter)
            return (
              <button key={q} onClick={() => !future && gaNaar(year, q)} disabled={future} title={future ? t('klr.kwartaalNietBegonnen') : undefined} style={{ flex: 1, padding: '9px 0', borderRadius: 10, cursor: future ? 'default' : 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 600, border: `1px solid ${active ? M3.primary : M3.outlineVariant}`, background: active ? M3.primary : M3.surface, color: active ? '#fff' : M3.onSurface, opacity: future ? 0.4 : 1 }}>Q{q}</button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInlineStart: 6 }}>
            <button onClick={() => gaNaar(Math.max(2000, year - 1), quarter)} title={t('wh.vorigJaar')} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_left</span>
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, minWidth: 40, textAlign: 'center' }}>{year}</span>
            {/* Stepping INTO the current year can strand the selection on a quarter that has not
                started (Q4 2025 → 2026 in January), so the quarter is clamped with the year. */}
            <button onClick={() => { const next = Math.min(year + 1, curYear); gaNaar(next, next === curYear && quarter > curQuarter ? curQuarter : quarter) }} disabled={year >= curYear} title={t('wh.volgendJaar')} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: year >= curYear ? 'default' : 'pointer', color: year >= curYear ? M3.outlineVariant : M3.primary, opacity: year >= curYear ? 0.5 : 1 }}>
              <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20 }} aria-hidden>chevron_right</span>
            </button>
          </div>
        </div>

        {loading && <div style={{ color: M3.neutral, fontSize: 14, padding: '32px 0', textAlign: 'center' }}>{t('ss.controleren')}</div>}
        {/* [KLAAR-TOEKOMST] A period that has not begun: a clear non-verdict, not a confident red. */}
        {!loading && !begonnen && (
          <div style={{ background: M3.surfaceVariant, borderRadius: 14, padding: '18px 20px', textAlign: 'center', margin: '12px 0' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.onSurface }}>{t('klr.kwartaalNietBegonnen')}</div>
            <div style={{ fontSize: 13, color: M3.neutral, marginTop: 4, lineHeight: 1.5 }}>{t('klr.periode.nietBegonnen')}</div>
          </div>
        )}
        {/* A bare sentence on the screen that decides whether the quarter may be handed over is a
            dead end — and the retry it needed was already sitting in setReloadKey, driving the
            "Vernieuwen" link above. Say what it does NOT mean, and offer the way out. */}
        {!loading && begonnen && (error || !report) && (
          <div style={{ background: M3.errorContainer, borderRadius: 14, padding: '18px 20px', textAlign: 'center', margin: '12px 0' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.error }}>{t('klr.fout.status')}</div>
            <div style={{ fontSize: 13, color: M3.onSurface, marginTop: 4, lineHeight: 1.5 }}>
              {t('klr.fout.zegtNiets')}
            </div>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ marginTop: 12, padding: '9px 18px', borderRadius: 10, border: 'none', background: M3.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              {t('inkoop.opnieuwProberen')}
            </button>
          </div>
        )}

        {report && (
          <>
            {/* [READINESS-DEGRADE] Above the verdict, when a read it needed did not happen: the
                measured dimensions stay measured below, but the conclusion is withheld — never
                green, never "klaar" — and the owner reads WHAT was not read, with the way to retry. */}
            {report.verified === false && (
              <div role="status" style={{ background: M3.warningContainer, borderRadius: 14, padding: '16px 18px', marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#7a4f00' }}>{t('klr.onvolledig.kop')}</div>
                <div style={{ fontSize: 13.5, color: '#7a4f00', marginTop: 4, lineHeight: 1.5 }}>{t('klr.onvolledig.uitleg')}</div>
                {(report.unverified ?? []).length > 0 && (
                  <div style={{ fontSize: 13, color: '#7a4f00', marginTop: 4, lineHeight: 1.5 }}>
                    {t('klr.onvolledig.nietGelezen', { onderdelen: (report.unverified ?? []).map((u) => u.label).join(', ') })}
                  </div>
                )}
                <button
                  onClick={() => setReloadKey((k) => k + 1)}
                  style={{ marginTop: 10, background: '#7a4f00', color: '#fff', border: 'none', borderRadius: 980, padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                >
                  {t('inkoop.opnieuwProberen')}
                </button>
              </div>
            )}
            {/* ── The verdict hero ── */}
            <div style={{ background: meta.bg, borderRadius: 18, padding: '22px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 30, lineHeight: 1 }}>{meta.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 19, fontWeight: 700, color: meta.fg }}>{t(meta.titleKey)}</div>
                  <div style={{ fontSize: 13, color: meta.fg, opacity: 0.85 }}>{report.quarterLabel}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: meta.fg, fontFamily: FONT_NUM, lineHeight: 1 }}>{report.score}%</div>
                  <div style={{ fontSize: 11, color: meta.fg, opacity: 0.8 }}>{t('klr.compleet')}</div>
                </div>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'rgba(0,0,0,0.08)', marginTop: 16, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${report.score}%`, background: meta.bar, borderRadius: 99, transition: 'width .4s' }} />
              </div>
            </div>

            {/* ── One-click handover ──
                [PAKKET-STAY] Fetched, not navigated to — the same fix the accountant's bridge
                already carries. The route answers every refusal with JSON, so an <a href> replaced
                this screen with a page of raw braces AND threw away the quarter and year the owner
                had selected (both client state). A failure now stays a sentence under the button. */}
            <button
              onClick={() => downloadPackage(year, quarter)}
              disabled={pkgBusy}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '15px 18px', borderRadius: 14, border: 'none', background: M3.primary, color: '#fff', fontSize: 15.5, fontWeight: 700, marginBottom: 8, cursor: pkgBusy ? 'default' : 'pointer', fontFamily: FONT, opacity: pkgBusy ? 0.6 : 1 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>inventory_2</span>
              {pkgBusy ? t('klr.pakketBezig') : t('klr.download')}
            </button>
            {pkgError && (
              <div role="alert" style={{ fontSize: 13, color: M3.error, textAlign: 'center', marginBottom: 8, lineHeight: 1.45 }}>
                {pkgError}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: M3.neutral, textAlign: 'center', marginBottom: 12, lineHeight: 1.5 }}>
              {t('klr.zipUitleg')}
            </div>

            {/* ── [PAKKET-LINK] …of laat ons hem versturen ── */}
            {!mailOpen ? (
              <button
                onClick={() => { setMailOpen(true); setMailGelukt(null) }}
                style={{ width: '100%', padding: '13px 18px', borderRadius: 14, border: `1.5px solid ${M3.primary}`, background: '#fff', color: M3.primary, fontSize: 14.5, fontWeight: 600, marginBottom: 22, cursor: 'pointer', fontFamily: FONT }}
              >
                {t('klr.deel.knop')}
              </button>
            ) : (
              <div style={{ border: '1px solid #E0E0E0', borderRadius: 14, padding: 16, marginBottom: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 13.5, color: M3.neutral, margin: 0, lineHeight: 1.55 }}>{t('klr.deel.uitleg')}</p>
                <input
                  type="email"
                  value={mailAdres}
                  onChange={(e) => { setMailAdres(e.target.value); setMailFout(null) }}
                  placeholder="boekhouder@kantoor.nl"
                  dir="ltr"
                  aria-label={t('klr.deel.adresLabel')}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #DADCE0', fontSize: 14.5, fontFamily: FONT, textAlign: 'start' }}
                />
                <textarea
                  value={mailNotitie}
                  onChange={(e) => setMailNotitie(e.target.value)}
                  rows={2}
                  placeholder={t('klr.deel.notitiePlaceholder')}
                  aria-label={t('klr.deel.notitieLabel')}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #DADCE0', fontSize: 14, fontFamily: FONT, resize: 'vertical' }}
                />
                <button
                  onClick={() => stuurNaarBoekhouder(year, quarter)}
                  disabled={mailBezig || !mailAdres.trim()}
                  style={{ padding: '12px 18px', borderRadius: 12, border: 'none', background: M3.primary, color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: (mailBezig || !mailAdres.trim()) ? 'default' : 'pointer', opacity: (mailBezig || !mailAdres.trim()) ? 0.55 : 1, fontFamily: FONT }}
                >
                  {mailBezig ? t('klr.deel.bezig') : t('klr.deel.versturen')}
                </button>
                {mailFout && (
                  <p role="alert" style={{ fontSize: 13, color: M3.error, margin: 0, lineHeight: 1.45 }}>{mailFout}</p>
                )}
                {mailGelukt && (
                  <p style={{ fontSize: 13, color: M3.success, margin: 0, lineHeight: 1.45, fontWeight: 600 }}>
                    {t('klr.deel.verstuurd', { email: mailGelukt })}
                  </p>
                )}
              </div>
            )}

            {/* ── [PAKKET-AFDRUK] Wat je boekhouder werkelijk heeft opgehaald ──
                De zip wordt bij elke download opnieuw gebouwd uit de huidige tabellen, dus dezelfde
                link kan in juni iets anders geven dan in april. Dit is waar dat zichtbaar wordt. */}
            {afleveringenFout && (
              <p role="alert" style={{ fontSize: 13, color: M3.error, margin: '12px 0 0', lineHeight: 1.5 }}>
                {t('klr.afl.fout')}
              </p>
            )}
            {!afleveringenFout && afleveringen !== null && afleveringen.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: M3.neutral, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 8px' }}>
                  {afleveringen.length === 1 ? t('klr.afl.kopEen') : t('klr.afl.kopMeer', { aantal: afleveringen.length })}
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {afleveringen.map((a) => (
                    <li key={a.id} style={{
                      borderInlineStart: `3px solid ${a.vraagtActie ? M3.error : a.veranderd ? M3.warning : M3.outlineVariant}`,
                      paddingInlineStart: 10,
                    }}>
                      <p style={{ fontSize: 13.5, color: M3.onSurface, margin: 0, fontWeight: 600 }}>
                        {new Date(a.opgehaaldOp).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        {t('klr.afl.inhoud', { verkoop: a.verkoopfacturen, inkoop: a.inkoopfacturen, bestanden: a.bestanden })}
                      </p>
                      {/* De uitleg komt van de server, waar de pure vergelijking woont — het scherm
                          bedenkt hier geen tweede formulering van hetzelfde verschil. */}
                      {a.uitleg && (
                        <p style={{ fontSize: 13, color: a.vraagtActie ? M3.error : M3.neutral, margin: '2px 0 0', lineHeight: 1.5 }}>
                          {a.uitleg}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── What still needs to happen (missing) ── */}
            {report.missing.length > 0 && (
              <Section title={t('klr.watNog')} tone="warning" icon="checklist">
                {report.missing.map((m, i) => <ItemRow key={i} item={m} tone="warning" />)}
              </Section>
            )}

            {/* ── Eyeball these (risks) ── */}
            {report.risks.length > 0 && (
              <Section title={t('klr.evenControleren')} tone="error" icon="visibility">
                {report.risks.map((r, i) => <ItemRow key={i} item={r} tone="error" />)}
              </Section>
            )}

            {report.missing.length === 0 && report.risks.length === 0 && (
              <div style={{ background: M3.successContainer, color: M3.success, borderRadius: 14, padding: '14px 16px', fontSize: 14, fontWeight: 600, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>task_alt</span>
                {t('brug.sluitAan')}
              </div>
            )}

            {/* ── The rubric behind the score (never a black box) ── */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '6px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', padding: '12px 0 6px', fontWeight: 600 }}>
                {t('klr.waarop')}
              </div>
              {/* [DISAMBIGUATE] Each row shows two figures — the colored number is how
                  COMPLETE that part is; the grey chip is how heavily it WEIGHS in the total.
                  Two bare percentages side by side read as competing scores, so name them. */}
              {/* [TAAL] The mid-sentence <b> tags had to go: a bold noun cannot travel through a
                  translated sentence whose word order changes (see messages.ts rule 1). Two plain
                  sentences, one key each. */}
              <div style={{ fontSize: 12, color: M3.neutral, lineHeight: 1.45, padding: '0 0 8px' }}>
                {t('klr.rubriek.kleur')} {t('klr.rubriek.grijs')}
              </div>
              {report.dimensions.map((d, i) => (
                <DimRow key={d.key} d={d} last={i === report.dimensions.length - 1} />
              ))}
            </div>

            {/* ── Concept BTW summary (the number they hand over) ── */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>
                  {teBetalen ? t('klr.btwTeBetalen') : t('klr.btwTerug')}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: teBetalen ? M3.onSurface : M3.success, fontFamily: FONT_NUM }}>
                  {eur.format(Math.abs(data!.concept.saldo))}
                </span>
              </div>
              <Link href={`/dashboard/aangifte?year=${year}&quarter=${quarter}`} style={{ fontSize: 12.5, color: M3.primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 6 }}>
                {t('klr.conceptAangifte')}
                <span className="material-symbols-outlined icon-dir" style={{ fontSize: 16 }} aria-hidden>chevron_right</span>
              </Link>
              {/* [DEADLINE] Wanneer dit ingediend moet zijn — op het scherm waar de eigenaar
                  besluit dat het kwartaal af is. Dat besluit werd tot nu toe genomen zonder dat
                  ergens stond hoeveel tijd er nog was: de enige plek in de app die de datum
                  noemde was een kaart op /dashboard/vandaag, een scherm dat op de telefoon geen
                  vaste ingang heeft. De rekensom komt uit btw-deadline-notice.ts, dezelfde die de
                  aangiftepagina en de herinneringscron gebruiken, zodat de drie nooit een andere
                  dag tellen. */}
              <div style={{
                fontSize: 12.5, marginTop: 6, lineHeight: 1.5,
                fontWeight: deadline.state === 'ruim' ? 400 : 700,
                color: deadline.state === 'voorbij' ? M3.error
                  : deadline.state === 'ruim' ? M3.neutral
                  : M3.warning,
              }}>
                {deadline.state === 'voorbij' ? t('aang.deadline.voorbij', { datum: formatDateNL(deadline.deadline) })
                  : deadline.state === 'vandaag' ? t('aang.deadline.vandaag')
                  : t('aang.deadline.nog', { datum: formatDateNL(deadline.deadline), dagen: deadline.days })}
              </div>
            </div>

            {/* ── Honest limits ── */}
            <div style={{ fontSize: 12, color: M3.neutral, lineHeight: 1.6 }}>
              {report.notes.map((n, i) => <div key={i} style={{ marginBottom: 4 }}>• {n}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, tone, icon, children }: { title: string; tone: 'warning' | 'error'; icon: string; children: ReactNode }) {
  const color = tone === 'warning' ? M3.warning : M3.error
  return (
    <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${tone === 'warning' ? M3.warningContainer : M3.errorContainer}`, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20, color }} aria-hidden>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.03em' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function ItemRow({ item, tone }: { item: Item; tone: 'warning' | 'error' }) {
  const color = tone === 'warning' ? M3.warning : M3.error
  // A gap that STATES a problem but offers no way to act is a dead-end. When the item
  // carries a fix destination, the whole row becomes a tap-through to exactly where the
  // owner resolves it — so "what's missing" and "where to fix it" are one action.
  const body = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0, marginTop: 1 }} aria-hidden>
        {tone === 'warning' ? 'radio_button_unchecked' : 'error_outline'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, lineHeight: 1.4 }}>{item.title}</div>
        {item.detail && <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2, lineHeight: 1.5 }}>{item.detail}</div>}
        {item.fix && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 6, fontSize: 12.5, fontWeight: 700, color: M3.primary }}>
            {item.fix.label}
            <span className="material-symbols-outlined icon-dir" style={{ fontSize: 16 }} aria-hidden>chevron_right</span>
          </span>
        )}
      </div>
    </div>
  )
  if (item.fix) {
    return (
      <Link href={item.fix.href} style={{ display: 'block', textDecoration: 'none', borderRadius: 12, padding: 6, margin: -6 }}>
        {body}
      </Link>
    )
  }
  return body
}

function DimRow({ d, last }: { d: Dimension; last: boolean }) {
  const t = translator(useLocale())
  const pct = d.applicable ? Math.round(d.subscore * 100) : null
  const barColor = pct == null ? M3.outlineVariant : pct >= 90 ? M3.success : pct >= 60 ? '#E37400' : M3.error
  return (
    <div style={{ padding: '11px 0', borderBottom: last ? 'none' : `1px solid #f1f3f4` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: M3.neutral }} aria-hidden>{DIM_ICON[d.key]}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: M3.onSurface }}>{d.label}</span>
        {/* Weight as a muted chip — reads as a label ("how much it counts"), not a score.
            Hidden when n.v.t.: a non-applicable part is EXCLUDED from the score, so it
            weighs nothing here — showing "weegt 20%" would contradict that. */}
        {pct != null && (
          <span style={{ fontSize: 10.5, color: M3.neutral, fontWeight: 600, background: '#f1f3f4', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
            {t('klr.weegt', { n: d.weight })}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_NUM, color: pct == null ? M3.neutral : barColor, minWidth: 44, textAlign: 'end' }}>
          {pct == null ? t('klr.nvt') : `${pct}%`}
        </span>
      </div>
      {/* Thin fill bar — makes the colored percentage read as a completeness level. */}
      {pct != null && (
        <div style={{ height: 4, borderRadius: 2, background: '#f1f3f4', marginTop: 8, marginInlineStart: 30, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
        </div>
      )}
      <div style={{ fontSize: 12, color: M3.neutral, marginTop: 6, marginInlineStart: 30, lineHeight: 1.45 }}>{d.detail}</div>
    </div>
  )
}
