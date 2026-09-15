'use client'

// src/app/dashboard/dagomzet/AfrekeningImport.tsx
// [AFREKENING-DEUR] Corner 2 of the reconciliation triangle, which had no door.
//
// The triangle compares three witnesses to the same card money: the till's Z-report (corner 1,
// the panel above this one), the payment terminal's own settlement receipt (corner 2), and what
// the bank actually paid out (corner 3). /api/eft/import has parsed corner 2 since July — route,
// AI transcription, pure parser and tests — and NO SCREEN EVER UPLOADED TO IT. A triangle with an
// unreachable corner cannot close, so the readiness verdict has been reconciling two witnesses
// and calling it three.
//
// It is deliberately the SAME rhythm as the Z-report panel beside it: read → show exactly what
// was read → the owner approves → only then is anything stored. Nothing here writes on its own.
//
// [LEZER-STIL] And the way through when the reader is down is a first-class path, not a fallback
// hidden in an error message: the same endpoint accepts the receipt as TYPED TEXT, with no reader
// involved at all. A terminal receipt is a dozen numbers; typing them is a minute's work and it
// never fails.

import { useState, type ChangeEvent, type CSSProperties } from 'react'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import DateFieldNL from '@/components/ui/DateFieldNL'
import { formatEuroNL } from '@/lib/format-nl'
import type { EftSettlement, EftWarning } from '@/lib/eft-parser'

interface Preview { settlement: EftSettlement; warnings: EftWarning[]; rawText?: string }

const card: CSSProperties = {
  background: '#fff', border: `1px solid ${M3.outline}`, borderRadius: 16,
  padding: '18px 18px', maxWidth: COLUMN.work, margin: '16px auto 0',
}
const label: CSSProperties = { fontSize: 12.5, color: M3.onSurfaceVariant, display: 'block', marginBottom: 4 }
const input: CSSProperties = { display: 'block', width: '100%', padding: 9, fontSize: 14, border: `1px solid ${M3.outline}`, borderRadius: 8, fontFamily: 'inherit' }

export default function AfrekeningImport({ onCommitted }: { onCommitted?: () => void }) {
  const t = translator(useLocale())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [typen, setTypen] = useState(false)
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<string | null>(null)

  // [NO-SILENT-EMPTY] Every path sets exactly one of preview / fout. A silent nothing would read
  // as "the receipt held no card sales", which is the one wrong answer here.
  const lees = async (body: FormData | string) => {
    setBezig(true); setFout(null); setKlaar(null)
    try {
      const res = await fetch('/api/eft/import', typeof body === 'string'
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }) }
        : { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFout(failureText(res.status, json, t('afr.fout.lezen'))); return }
      setPreview({ settlement: json.settlement, warnings: json.warnings ?? [] })
    } catch {
      setFout(t('afr.fout.lezen'))
    } finally { setBezig(false) }
  }

  const kies = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const form = new FormData()
    form.append('file', f)
    void lees(form)
  }

  // The settlement the owner reviewed — with the two fields the route refuses without, editable
  // here, because OCR misses them often enough that refusing at the door would be a dead end.
  const bewaar = async () => {
    if (!preview) return
    setBezig(true); setFout(null)
    try {
      const res = await fetch('/api/eft/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlement: preview.settlement }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFout(failureText(res.status, json, t('afr.fout.bewaren'))); return }
      setKlaar(t('afr.bewaard'))
      setPreview(null); setTekst(''); setTypen(false)
      onCommitted?.()
    } finally { setBezig(false) }
  }

  const s = preview?.settlement
  const zet = (veld: keyof EftSettlement, waarde: string) =>
    setPreview((p) => (p ? { ...p, settlement: { ...p.settlement, [veld]: waarde } } : p))

  return (
    <section style={card} aria-labelledby="afr-kop">
      <h2 id="afr-kop" style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: '0 0 4px' }}>
        {t('afr.titel')}
      </h2>
      <p style={{ fontSize: 13, color: M3.onSurfaceVariant, lineHeight: 1.6, margin: '0 0 12px' }}>
        {t('afr.uitleg')}
      </p>

      {!preview && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ ...input, width: 'auto', cursor: 'pointer', fontWeight: 600, color: M3.primary, padding: '9px 14px' }}>
              {t('afr.kiesBestand')}
              <input type="file" accept="image/*,application/pdf" onChange={kies} disabled={bezig} style={{ display: 'none' }} />
            </label>
            {/* [LEZER-STIL] Not a fallback in an error message — a way through that is always open. */}
            <button type="button" onClick={() => setTypen((v) => !v)} disabled={bezig}
              style={{ background: 'none', border: 'none', color: M3.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {t('afr.zelfTypen')}
            </button>
          </div>

          {typen && (
            <div style={{ marginTop: 12 }}>
              <label style={label} htmlFor="afr-tekst">{t('afr.tekstLabel')}</label>
              <textarea id="afr-tekst" value={tekst} onChange={(e) => setTekst(e.target.value)} rows={6}
                style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
              <button type="button" onClick={() => void lees(tekst)} disabled={bezig || !tekst.trim()}
                style={{ marginTop: 8, padding: '9px 16px', borderRadius: 8, border: 'none', background: M3.primary, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                {t('afr.lezen')}
              </button>
            </div>
          )}
        </>
      )}

      {bezig && <p role="status" style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: '10px 0 0' }}>{t('afr.bezig')}</p>}
      {fout && <p role="alert" style={{ fontSize: 13, color: M3.error, margin: '10px 0 0' }}>{fout}</p>}
      {klaar && <p role="status" style={{ fontSize: 13, color: '#137333', margin: '10px 0 0' }}>{klaar}</p>}

      {s && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${M3.outline}`, paddingTop: 14 }}>
          {/* The amount is the whole point of the receipt, so it is shown as a number and not
              inside a sentence — and it is shown BEFORE the owner is asked to approve anything. */}
          <div style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface }}>{formatEuroNL(s.grossTotal)}</div>
          <div style={{ fontSize: 12.5, color: M3.onSurfaceVariant, marginBottom: 12 }}>
            {t('afr.transacties', { count: s.txCount })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div>
              <label style={label} htmlFor="afr-datum">{t('afr.datum')}</label>
              {/* [DATE-NL] Never a native date input: its segment order follows the BROWSER's
                  locale, so an owner on an English phone types 03-09 and means 9 March while the
                  app reads 3 September. On a settlement that decides which day's card takings
                  these are, that is a whole day of turnover in the wrong place. */}
              <DateFieldNL id="afr-datum" value={s.settlementDate ?? ''} onChange={(iso) => zet('settlementDate', iso)} style={input} />
            </div>
            {/* [DUBBEL] Terminal + period are the natural key. Without them a re-import INSERTS a
                second settlement instead of updating one, doubling that day's card takings — so
                the route refuses without them and the owner fills them in from the paper. */}
            <div>
              <label style={label} htmlFor="afr-term">{t('afr.terminal')}</label>
              <input id="afr-term" value={s.terminalId ?? ''} onChange={(e) => zet('terminalId', e.target.value)} style={input} />
            </div>
            <div>
              <label style={label} htmlFor="afr-periode">{t('afr.periode')}</label>
              <input id="afr-periode" value={s.periodNr ?? ''} onChange={(e) => zet('periodNr', e.target.value)} style={input} />
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <ul style={{ margin: '12px 0 0', paddingInlineStart: 18, fontSize: 12.5, color: '#7C5800', lineHeight: 1.6 }}>
              {preview.warnings.map((w) => <li key={w.code}>{w.message}</li>)}
            </ul>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void bewaar()} disabled={bezig}
              style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: M3.primary, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              {t('afr.bewaren')}
            </button>
            <button type="button" onClick={() => { setPreview(null); setFout(null) }} disabled={bezig}
              style={{ padding: '10px 18px', borderRadius: 8, border: `1px solid ${M3.outline}`, background: '#fff', color: M3.onSurface, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
              {t('afr.annuleren')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
