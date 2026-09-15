'use client'

// src/app/dashboard/jaar/JaarClient.tsx
// [IB-JAAR] The year, arranged the way the IB-aangifte asks for it — see ib-jaar.ts for what
// this deliberately does not compute. Screen chrome comes from the catalogue ([TAAL]); the
// administrative sentences (urencriterium, kanttekeningen, niet-bijgehouden) arrive as DATA
// from the server, in Dutch, like every administrative truth here.

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { IbJaarOverzicht } from '@/lib/ib-jaar'
import { failureText } from '@/lib/server-message'
import OpdrachtgeversPanel from '@/components/dba/OpdrachtgeversPanel'
import GrootboekPanel from '@/components/grootboek/GrootboekPanel'
import OnderhandenWerkPanel from '@/components/jaar/OnderhandenWerkPanel'

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #E0E0E0', borderRadius: 12, padding: '16px 20px' }
const eur = (n: number) => `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Pure presentational half — tests/render feeds it a finished overzicht. */
export function JaarOverzichtPaneel({ overzicht, t }: { overzicht: IbJaarOverzicht; t: (k: never) => string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tt = t as (k: any) => string
  const { wv, uren, nietBijgehouden, kanttekeningen, bedrijfsmiddelen } = overzicht
  // [BEDRIJFSMIDDEL] Kosten already contains the afschrijvingen; the line under it says how much
  // of it, so the owner can tie the figure to the register. The investment is shown apart: it is
  // the amount that is NOT in kosten this year, which is the whole point of the register.
  const rows: Array<[string, number, 'sub' | 'total' | null]> = [
    [tt('jaar.wv.opbrengsten'), wv.opbrengsten, null],
    [tt('jaar.wv.kosten'), wv.kosten, null],
    ...(wv.afschrijvingen > 0 ? [[tt('jaar.wv.afschrijvingen'), wv.afschrijvingen, 'sub'] as [string, number, 'sub']] : []),
    [tt('jaar.wv.saldo'), wv.saldo, 'total'],
  ]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px', color: '#202124' }}>{tt('jaar.wv.titel')}</h2>
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map(([label, val, kind], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: kind === 'total' ? 15 : kind === 'sub' ? 12.5 : 13.5, fontWeight: kind === 'total' ? 700 : 400, color: kind === 'sub' ? '#5F6368' : '#202124', borderTop: kind === 'total' ? '1px solid #E0E0E0' : 'none', paddingTop: kind === 'total' ? 8 : 0, paddingInlineStart: kind === 'sub' ? 14 : 0 }}>
              <span>{label}</span>
              <span>{eur(val)}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px', color: '#202124' }}>{tt('jaar.balans.titel')}</h2>
        {bedrijfsmiddelen.unreadable ? (
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6, color: '#B26A00' }}>{tt('jaar.balans.onleesbaar')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#202124' }}>
              <span>{tt('jaar.balans.investeringen')}</span><span>{eur(bedrijfsmiddelen.investeringen)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#202124' }}>
              <span>{tt('jaar.balans.boekwaarde')}</span><span>{eur(bedrijfsmiddelen.boekwaardeEinde ?? 0)}</span>
            </div>
            {/* [AANSLAG] Only when there were any — a zero line at rest says nothing. */}
            {(overzicht.aanslagen ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#202124' }}>
                <span>{tt('jaar.balans.aanslagen')}</span><span>{eur(overzicht.aanslagen ?? 0)}</span>
              </div>
            )}
            <p style={{ fontSize: 13, margin: '4px 0 0' }}>
              <a href="/dashboard/bedrijfsmiddelen" style={{ color: '#1A73E8', fontWeight: 600, textDecoration: 'none' }}>
                {bedrijfsmiddelen.aantal === 0 ? tt('jaar.balans.registerLeeg') : tt('jaar.balans.registerLink')}
              </a>
            </p>
          </div>
        )}
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px', color: '#202124' }}>{tt('jaar.uren.titel')}</h2>
        <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6, color: uren.met === true ? '#188038' : uren.met === false ? '#B26A00' : '#5F6368' }}>
          {uren.sentence}
        </p>
      </section>

      {kanttekeningen.length > 0 && (
        <section style={{ ...CARD, background: '#FFF8E1', borderColor: '#FFE082' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', color: '#8D6E00' }}>{tt('jaar.kanttekeningen.titel')}</h2>
          {kanttekeningen.map((k, i) => (
            <p key={i} style={{ fontSize: 13, margin: i ? '6px 0 0' : 0, lineHeight: 1.6, color: '#8D6E00' }}>{k}</p>
          ))}
        </section>
      )}

      <section style={CARD}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', color: '#202124' }}>{tt('jaar.mist.titel')}</h2>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 8px', lineHeight: 1.6 }}>{tt('jaar.mist.intro')}</p>
        <ul style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 4 }}>
          {nietBijgehouden.map((r, i) => (
            <li key={i} style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.6 }}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default function JaarClient() {
  const t = translator(useLocale())
  // [BRUG] Dezelfde dubbelpad-lezing als /api/truth: een gekoppelde boekhouder opent het jaar
  // van een klant met ?clientId=…; de route autoriseert (resolveQuarterOwner), dit scherm geeft
  // hem alleen door. Bewerken gebeurt hier nergens — dit is een projectie; wie iets wil
  // rechtzetten, zet de BRON recht en het jaar volgt.
  const clientId = useSearchParams().get('clientId')
  const now = new Date()
  // Default: the previous year until 1 April (when people file), the current year after.
  const [year, setYear] = useState(now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear())
  const [overzicht, setOverzicht] = useState<IbJaarOverzicht | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (y: number) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/ib-jaar?year=${y}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.overzicht) { setError(failureText(res.status, json, t('jaar.fout'))); setOverzicht(null); return }
      setOverzicht(json.overzicht)
    } catch {
      setError(t('jaar.fout')); setOverzicht(null)
    } finally {
      setBusy(false)
    }
  }, [t, clientId])

  useEffect(() => {
    let cancelled = false
    void (async () => { if (!cancelled) await load(year) })()
    return () => { cancelled = true }
  }, [year, load])

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 16, fontFamily: "'Roboto', -apple-system, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: 0 }}>{t('jaar.titel')}</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
            <button key={y} onClick={() => setYear(y)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #E0E0E0', background: y === year ? '#1A73E8' : '#fff', color: y === year ? '#fff' : '#202124', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {y}
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 13.5, color: '#5F6368', margin: 0, lineHeight: 1.6 }}>{t('jaar.intro')}</p>

      {busy && <p style={{ fontSize: 13.5, color: '#5F6368' }}>{t('jaar.laden')}</p>}
      {error && !busy && <p role="alert" style={{ fontSize: 13.5, color: '#C5221F' }}>{error}</p>}
      {overzicht && !busy && <JaarOverzichtPaneel overzicht={overzicht} t={t as never} />}
      {/* [OPDRACHTGEVER] Who this year's money came from. Only on the owner's own year: an
          accountant looking at a client's year gets the auditfile, not this. */}
      {!clientId && <OpdrachtgeversPanel year={year} />}
      {/* [GROOTBOEK] Directly above the auditfile links, because that is what it is for: every
          invoice answered here is one line the boekhouder does not re-code by hand. The owner's
          own administration only — an accountant looking at a client's year reaches the same
          decision through their own screens. */}
      {!clientId && <GrootboekPanel />}
      {/* [ONDERHANDEN-WERK] What was still uninvoiced on 31 December. It belongs to this year's
          result, so it stands beside the year — the same owner-only rule as above. */}
      {!clientId && <OnderhandenWerkPanel year={year} />}

      {overzicht && !busy && (
        <p style={{ fontSize: 13, margin: 0 }}>
          {/* [XAF] Het jaar als auditbestand — de boekhouder importeert dit in het eigen pakket. */}
          <a
            href={`/api/xaf?year=${year}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`}
            style={{ color: '#1A73E8', fontWeight: 600, textDecoration: 'none' }}
          >
            ⬇︎ {t('jaar.xaf.link')}
          </a>
          <br />
          {/* [XAF-4] The schema the Belastingdienst accepts from 1 January 2027. */}
          <a
            href={`/api/xaf?year=${year}&version=4.0${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`}
            style={{ color: '#1A73E8', fontWeight: 600, textDecoration: 'none' }}
          >
            ⬇︎ {t('jaar.xaf.link4')}
          </a>
        </p>
      )}
    </main>
  )
}
