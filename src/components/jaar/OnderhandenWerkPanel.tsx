'use client'

// src/components/jaar/OnderhandenWerkPanel.tsx
// [ONDERHANDEN-WERK] What the owner was still carrying on the last day of the book year: work
// done, not yet invoiced. The accountant asks for this figure every year; it belongs on the
// balance sheet, and the profit is wrong without it.
//
// It states the amount, the hours behind it, and per customer where it sits. It does not book
// anything and it does not advise — the owner and their accountant decide what happens with it.
//
// [NO-SILENT-EMPTY] Two things are said out loud rather than folded into the amount: hours with no
// rate (real work, no defensible value) and hours whose invoice could not be dated. Both make the
// figure an understatement, and an understated asset is an overstated tax bill.
//
// [TAAL] The component holds no language of its own — every word comes from the catalogue.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL } from '@/lib/format-nl'
import { dateShort } from '@/lib/i18n/format-date'
import type { WorkInProgress } from '@/lib/onderhanden-werk'

type Answer = WorkInProgress & { year: number; names: Record<string, string> }

export default function OnderhandenWerkPanel({ year }: { year: number }) {
  const locale = useLocale()
  const t = translator(locale)
  const [data, setData] = useState<Answer | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/onderhanden-werk?year=${year}`)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok) { setFailed(true); setData(null); return }
        setData(json as Answer); setFailed(false)
      } catch {
        if (!cancelled) { setFailed(true); setData(null) }
      }
    })()
    return () => { cancelled = true }
  }, [year])

  // Nothing is claimed before there is an answer — not a zero, not a spinner.
  if (!failed && !data) return null

  return (
    <section data-testid="onderhanden-werk" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E0E0E0', padding: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: '#202124' }}>
        {t('ohw.kop', { datum: dateShort(`${year}-12-31`, locale) })}
      </h2>
      {failed || !data ? (
        <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('ohw.leesfout')}</p>
      ) : data.clients.length === 0 ? (
        <p style={{ fontSize: 13.5, color: '#5F6368', margin: 0 }}>{t('ohw.geen')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '2px 0 10px' }}>
            <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 22, fontWeight: 600, color: '#202124' }}>
              {formatEuroNL(data.value)}
            </span>
            <span style={{ fontSize: 12.5, color: '#5F6368' }}>
              {t('ohw.uren', { uren: data.hours.toLocaleString('nl-NL') })}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.clients.map((c) => (
              <div key={c.clientId ?? 'geen'} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderTop: '1px solid #F1F3F4' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(c.clientId && data.names[c.clientId]) || t('ohw.geenKlant')}
                </span>
                <span style={{ fontSize: 12.5, color: '#5F6368', whiteSpace: 'nowrap' }}>
                  {t('ohw.uren', { uren: c.hours.toLocaleString('nl-NL') })}
                </span>
                <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 600, color: '#202124', minWidth: 92, textAlign: 'end' }}>
                  {formatEuroNL(c.value)}
                </span>
              </div>
            ))}
          </div>
          {/* The W&V above is invoices; this is not in it. Saying so beside the amount is the
              difference between a second figure and a contradiction. */}
          <p style={{ fontSize: 12, color: '#5F6368', margin: '10px 0 0' }}>{t('ohw.nietInSaldo')}</p>
          {data.oldest !== null && (
            <p style={{ fontSize: 12, color: '#5F6368', margin: '4px 0 0' }}>
              {t('ohw.oudste', { datum: dateShort(data.oldest, locale) })}
            </p>
          )}
          {data.withoutRate > 0 && (
            <p style={{ fontSize: 12, color: '#B26A00', margin: '6px 0 0' }}>
              {data.withoutRate === 1 ? t('ohw.zonderTarief.een') : t('ohw.zonderTarief.meer', { n: data.withoutRate })}
            </p>
          )}
          {data.unknownInvoices > 0 && (
            <p style={{ fontSize: 12, color: '#B26A00', margin: '6px 0 0' }}>{t('ohw.onbekendeFactuur')}</p>
          )}
        </>
      )}
    </section>
  )
}
