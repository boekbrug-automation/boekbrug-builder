'use client'

// src/components/grootboek/GeleerdPanel.tsx
// [GELEERD-SINDSDIEN] The ignored purchase invoices that were read before the reader learned what
// they needed — with what it learned, and one tap to put one back.
//
// The owner archived these deliberately, so a bare list with a button would be an accusation. What
// makes it an offer is naming what CHANGED: not "we improved", which is unverifiable, but "we now
// read the per-rate BTW breakdown" — a claim the owner can check, because the invoice is still
// there and can be read again.
//
// Putting one back only restores it to the verification queue. The re-read is the next tap, where
// "Opnieuw inlezen" already lives; this panel does not run an AI read behind the owner's back.
//
// [NO-SILENT-EMPTY] Nothing renders until the read answers. An empty list is a claim — "there is
// nothing to look at again" — and a query that fell over may not make it.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL } from '@/lib/format-nl'
import { learnedPhrases, summaryPhrase } from '@/lib/geleerd-lines'
import type { ReaderCapability } from '@/lib/geleerd-sindsdien'

interface Item {
  id: string
  invoiceNumber: string | null
  invoiceDate: string | null
  vendor: string | null
  totalIncBtw: number | null
  gained: ReaderCapability['key'][]
}

/**
 * The offered invoices, as a pure function of what was read.
 *
 * Exported and separated from the fetching for the reason AGENTS.md gives: the wrapper renders
 * NOTHING until its read answers, so a server render of the wrapper never reaches a row — and a
 * row is where the whole class of render bug lives. `[].map(cb)` never calls cb.
 */
export function GeleerdList({ items, busy, onPutBack }: {
  items: Item[]
  busy: string | null
  onPutBack: (id: string) => void
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((inv) => (
        <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderTop: '1px solid #FFE0A3' }}>
          <span style={{ flex: '1 1 150px', minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inv.vendor || '—'}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: '#80868B', marginTop: 1 }}>
              {[inv.invoiceDate, inv.invoiceNumber].filter(Boolean).join(' · ')}
              {inv.gained.length > 0 && ' — '}
              {learnedPhrases(inv.gained).map((p) => t(p.key, p.params)).join(', ')}
            </span>
          </span>
          {inv.totalIncBtw !== null && (
            <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 13.5, color: '#202124', minWidth: 88, textAlign: 'end' }}>
              {formatEuroNL(inv.totalIncBtw)}
            </span>
          )}
          <button
            type="button"
            disabled={busy === inv.id}
            onClick={() => onPutBack(inv.id)}
            style={{ background: '#fff', border: '1px solid #DADCE0', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, color: '#1A73E8', cursor: busy === inv.id ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy === inv.id ? 0.6 : 1 }}
          >
            {t('gl.terug')}
          </button>
        </div>
      ))}
    </div>
  )
}

export default function GeleerdPanel({ onRestored }: { onRestored?: () => void }) {
  const t = translator(useLocale())
  const [items, setItems] = useState<Item[] | null>(null)
  const [gross, setGross] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/geleerd')
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok) { setFailed(true); setItems(null); return }
        setItems(Array.isArray(json.items) ? json.items : [])
        setGross(typeof json.gross === 'number' ? json.gross : 0)
        setFailed(false)
      } catch {
        if (!cancelled) { setFailed(true); setItems(null) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const putBack = async (id: string) => {
    setBusy(id); setError(false)
    try {
      // The restore door that already exists — archived → processing. Nothing here invents a
      // second way to un-archive an invoice.
      const res = await fetch(`/api/email/confirm/${id}`, { method: 'PATCH' })
      if (!res.ok) { setError(true); return }
      setItems((list) => (list ? list.filter((i) => i.id !== id) : list))
      setDone(true)
      onRestored?.()
    } catch { setError(true) } finally { setBusy(null) }
  }

  // Nothing to offer is not worth a heading: the owner's ignored list is not a place to be nagged.
  if (!failed && (!items || items.length === 0)) return null

  const summary = summaryPhrase(items?.length ?? 0, formatEuroNL(gross))

  return (
    <section data-testid="geleerd" style={{ background: '#FFF8E1', borderRadius: 14, border: '1px solid #FFE0A3', padding: 16, marginBottom: 14 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: '#202124' }}>{t('gl.kop')}</h2>
      {failed || !items ? (
        <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('gl.leesfout')}</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 2px' }}>{t('gl.uitleg')}</p>
          <p style={{ fontSize: 13.5, color: '#202124', fontWeight: 600, margin: '0 0 10px' }}>
            {t(summary.key, summary.params)}
          </p>
          <GeleerdList items={items} busy={busy} onPutBack={(id) => void putBack(id)} />
          {/* Where it went, said once — a row that vanishes with no destination reads as deleted. */}
          {done && <p style={{ fontSize: 12.5, color: '#5F6368', margin: '10px 0 0' }}>{t('gl.daarna')}</p>}
          {error && <p style={{ fontSize: 13, color: '#B3261E', margin: '10px 0 0' }}>{t('gl.terugFout')}</p>}
        </>
      )}
    </section>
  )
}
