'use client'

// src/components/dba/OpdrachtgeversPanel.tsx
// [OPDRACHTGEVER] Who this year's money came from. Facts from the owner's own invoices: how many
// opdrachtgevers, what each one was worth, what share that is, how many hours went into it.
//
// It states no verdict, and that is the design. "70% from one client" and "you need three
// clients" are VAR-era folklore, not law; the Belastingdienst weighs the working relationship and
// the Hoge Raad counts extern ondernemerschap beside it. A colour or a threshold here would be a
// confident wrong answer about the owner's largest deduction. So: the numbers, and one sentence
// saying what they are not.
//
// [TAAL] The component holds no language of its own — every word comes from the catalogue.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL } from '@/lib/format-nl'
import type { OpdrachtgeverDossier } from '@/lib/opdrachtgevers'
// [TAAL] Which words, decided apart from the screen that shows them — and testable there.
import { dossierRowPhrases, dossierSummaryPhrases } from '@/lib/dba-lines'

export default function OpdrachtgeversPanel({ year }: { year: number }) {
  const t = translator(useLocale())
  const [data, setData] = useState<OpdrachtgeverDossier | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/opdrachtgevers?year=${year}`)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok) { setFailed(true); setData(null); return }
        setData(json as OpdrachtgeverDossier); setFailed(false)
      } catch {
        if (!cancelled) { setFailed(true); setData(null) }
      }
    })()
    return () => { cancelled = true }
  }, [year])

  if (!failed && !data) return null

  return (
    <section data-testid="opdrachtgevers" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E0E0E0', padding: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: '#202124' }}>{t('dba.kop', { jaar: year })}</h2>
      {/* [NO-SILENT-EMPTY] A read that failed says so; an empty year would read as "you had no clients". */}
      {failed || !data ? (
        <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('dba.leesfout')}</p>
      ) : data.rows.length === 0 ? (
        <p style={{ fontSize: 13.5, color: '#5F6368', margin: 0 }}>{t('dba.geen')}</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 10px' }}>
            {data.clients === 1 ? t('dba.samenvattingEen', { bedrag: formatEuroNL(data.revenue) })
              : t('dba.samenvatting', { n: data.clients, bedrag: formatEuroNL(data.revenue), grootste: String(data.largestShare ?? 0).replace('.', ',') })}
          </p>
          {/* [DBA-DOSSIER] Acquisition and pricing: the two facts about the owner's own conduct
              that the list of names does not carry. Each appears only when there is something to
              state — nobody won this year, or fewer than two rates recorded, and it stays silent.
              Still no verdict: a range is a measurement, not a grade. */}
          {dossierSummaryPhrases(data, formatEuroNL).length > 0 && (
            <p style={{ fontSize: 13, color: '#5F6368', margin: '0 0 10px' }}>
              {dossierSummaryPhrases(data, formatEuroNL).map((p) => t(p.key, p.params)).join(' ')}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.rows.map((r) => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderTop: '1px solid #F1F3F4' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  {/* [DBA-DOSSIER] How long, how often, and at what price — the three things a
                      revenue column cannot say. Every part appears only when it is known: an
                      opdrachtgever with no dated invoice gets no "since", and a klant with no rate
                      recorded gets no price rather than a zero. */}
                  <span style={{ display: 'block', fontSize: 12, color: '#80868B', marginTop: 1 }}>
                    {dossierRowPhrases(r, formatEuroNL).map((p) => t(p.key, p.params)).join(' · ')}
                  </span>
                </span>
                {r.hours > 0 && (
                  <span style={{ fontSize: 12.5, color: '#5F6368', whiteSpace: 'nowrap' }}>{t('dba.uren', { uren: r.hours.toLocaleString('nl-NL') })}</span>
                )}
                {r.share !== null && (
                  <span style={{ fontSize: 12.5, color: '#5F6368', minWidth: 44, textAlign: 'end' }}>{String(r.share).replace('.', ',')}%</span>
                )}
                <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 600, color: '#202124', minWidth: 92, textAlign: 'end' }}>{formatEuroNL(r.revenue)}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#5F6368', margin: '10px 0 0', lineHeight: 1.55 }}>{t('dba.geenOordeel')}</p>
        </>
      )}
    </section>
  )
}
