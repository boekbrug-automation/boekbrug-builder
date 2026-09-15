'use client'

// src/app/dashboard/dagomzet/DagomzetImportClient.tsx
// [TURNOVER-IMPORT] The minimal review-and-confirm screen for a till Z-report. Goal is
// TRUST, not decoration: upload → see exactly what was read (days, turnover, BTW split,
// payment split) + every warning → approve or reject. Nothing is stored until the owner
// approves. Parse/normalize live server-side (/api/turnover/import); this only shows the
// preview it returns and posts the confirmed rows back.

import { useState, type ChangeEvent, type CSSProperties } from 'react'
import TurnoverInsights from './TurnoverInsights'
// [KASSA] The other way into this table. The upload reads a kassa-rapport; an owner without a kassa
// has no such file, and daily_turnover.source has allowed 'manual' since the table was created with
// nothing ever writing it. See the header of HandmatigeDag.tsx for what that cost him.
import HandmatigeDag from './HandmatigeDag'
import AfrekeningImport from './AfrekeningImport'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import type { CardPayoutLine } from '@/lib/day-card-takings'
import { failureText } from '@/lib/server-message'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface TurnoverRow {
  turnover_date: string
  base_0: number; base_9: number; base_21: number
  btw_9: number; btw_21: number
  total_incl: number | null
  pin_amount: number | null; cash_amount: number | null; other_amount: number | null
}
interface Warning { row: number; code: string; message: string }
interface Preview { rows: TurnoverRow[]; warnings: Warning[]; count: number }

// [LEDGER] A bookkeeper grootboek export (Kiwi OVERZICHT/KASBOEK) — a CROSS-CHECK witness,
// never money. Uploaded here too so the owner can just "throw" the file; it's routed to
// /api/ledger/import when the Z-report parser recognises it as a ledger.
interface LedgerRow { ledger_date: string; received: number; spent: number }
interface LedgerPreview { kind: string; accountNr: string | null; title: string | null; rows: LedgerRow[]; warnings: { code: string; message: string }[]; count: number }
// Labels are message keys, rendered through t() — the module holds no language of its own.
const LEDGER_KIND_KEY: Record<string, MessageKey> = { pin: 'dzi.ledger.pin', cash: 'dzi.ledger.cash', bank: 'dzi.ledger.bank', other: 'dzi.ledger.other' }
// One full sentence per ledger kind (singular/plural), because a noun inside a sentence is
// not a parameter — see AGENTS.md [TAAL].
const LEDGER_DONE_ONE: Record<string, MessageKey> = { pin: 'dzi.klaarPinEen', cash: 'dzi.klaarKasEen', bank: 'dzi.klaarBankEen', other: 'dzi.klaarGrootboekEen' }
const LEDGER_DONE_MANY: Record<string, MessageKey> = { pin: 'dzi.klaarPin', cash: 'dzi.klaarKas', bank: 'dzi.klaarBank', other: 'dzi.klaarGrootboek' }

const sum = (rows: TurnoverRow[], pick: (r: TurnoverRow) => number | null) =>
  rows.reduce((s, r) => s + (pick(r) ?? 0), 0)

export default function DagomzetImportClient(
  { korActive = false, cardPayouts = [] }: { korActive?: boolean; cardPayouts?: CardPayoutLine[] } = {},
) {
  const t = translator(useLocale())
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ committed: number; ledger?: string } | null>(null)
  const [refreshTick, setRefreshTick] = useState(0) // remounts the insights panel after a commit
  const [ledgerPreview, setLedgerPreview] = useState<LedgerPreview | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setError(''); setDone(null); setPreview(null); setLedgerPreview(null); setFileName(file.name); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/turnover/import', { method: 'POST', body: fd })
      const json = await res.json()
      // [LEDGER] The Z-report parser recognised a bookkeeper grootboek export → route the SAME
      // file to the ledger import (a PIN/kas cross-check), not a dead-end error.
      if (json?.wrongKind === 'ledger') { await previewLedger(file); return }
      // Clear the remembered name on a failed read: the upload label reads
      // "Ander bestand kiezen (x.xls)" off it, which claimed a file was loaded when none was.
      if (!res.ok) { setFileName(null); setError(failureText(res.status, json, t('dzi.konNietLezen'))); return }
      setPreview({ rows: json.rows ?? [], warnings: json.warnings ?? [], count: json.count ?? 0 })
    } catch {
      setError(t('dzi.fout.bestand'))
    } finally { setBusy(false) }
  }

  async function previewLedger(file: File) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ledger/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.ok) { setError(failureText(res.status, json, t('dzi.konGrootboekNietLezen'))); return }
      setLedgerPreview({ kind: json.kind, accountNr: json.accountNr ?? null, title: json.title ?? null, rows: json.rows ?? [], warnings: json.warnings ?? [], count: json.count ?? 0 })
    } catch {
      setError(t('dzi.fout.grootboek'))
    }
  }

  async function approveLedger() {
    if (!ledgerPreview || ledgerPreview.rows.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/ledger/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: ledgerPreview.kind, accountNr: ledgerPreview.accountNr, rows: ledgerPreview.rows }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('dzi.fout.opslaan'))); return }
      setDone({ committed: json.committed ?? ledgerPreview.rows.length, ledger: ledgerPreview.kind })
      setLedgerPreview(null); setFileName(null)
    } catch {
      setError(t('dzi.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function approve() {
    if (!preview || preview.rows.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/turnover/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: preview.rows }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('dzi.fout.opslaan'))); return }
      setDone({ committed: json.committed ?? preview.rows.length })
      setPreview(null); setFileName(null); setRefreshTick((t) => t + 1)
    } catch {
      setError(t('dzi.fout.opslaan'))
    } finally { setBusy(false) }
  }

  function reject() { setPreview(null); setLedgerPreview(null); setFileName(null); setError('') }

  const rows = preview?.rows ?? []
  const totalTurnover = sum(rows, (r) => r.total_incl)
  const netOmzet = sum(rows, (r) => r.base_0 + r.base_9 + r.base_21)
  const btw9 = sum(rows, (r) => r.btw_9)
  const btw21 = sum(rows, (r) => r.btw_21)
  const pin = sum(rows, (r) => r.pin_amount)
  const cash = sum(rows, (r) => r.cash_amount)
  const dateFrom = rows.length ? rows.map((r) => r.turnover_date).sort()[0] : null
  const dateTo = rows.length ? rows.map((r) => r.turnover_date).sort().slice(-1)[0] : null

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 64px' }}>
        {/* [HEADER-SYSTEM] Title "Dagomzet" + back live in the shared sub-page bar;
            the in-body h1 was removed. The descriptive intro stays. */}
        <p style={{ fontSize: 14, color: M3.neutral, margin: '16px 0 20px', lineHeight: 1.5 }}>
          {t('dzi.intro1')} <b>{t('dzi.goedkeuren')}</b>{t('dzi.intro2')} <b>{t('dzi.controle')}</b>{' '}
          {t('dzi.intro3')}
        </p>

        {/* [COHERENCE-DAGOMZET] Booked-omzet insights first (KPI's, trend, BTW/betaalwijzen),
            so a returning owner sees their kassa-omzet before the import panel. Single
            instance (the page no longer renders its own); remounts after a commit via
            refreshTick. Renders nothing when there is no booked data yet. */}
        <TurnoverInsights key={refreshTick} />

        {/* Upload */}
        <label style={{
          display: 'block', border: `2px dashed ${M3.outlineVariant}`, borderRadius: 14, padding: '22px 16px',
          textAlign: 'center', cursor: busy ? 'default' : 'pointer', background: M3.surface, marginBottom: 16,
        }}>
          <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => void handleFile(e)} disabled={busy} style={{ display: 'none' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: M3.primary }}>
            {busy && !preview ? t('dzi.bezigLezen') : fileName ? t('dzi.anderBestand', { name: fileName }) : t('dzi.kiesZ')}
          </div>
          <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 4 }}>xls · xlsx · csv</div>
        </label>

        {error && (
          <div style={{ background: '#FCE8E6', color: M3.error, borderRadius: 10, padding: '12px 14px', fontSize: 14, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {done && (
          <div style={{ background: '#E6F4EA', color: M3.success, borderRadius: 10, padding: '14px 16px', fontSize: 14.5, fontWeight: 600 }}>
            {done.ledger
              ? t(
                  (done.committed === 1 ? LEDGER_DONE_ONE[done.ledger] : LEDGER_DONE_MANY[done.ledger])
                    ?? (done.committed === 1 ? 'dzi.klaarGrootboekEen' : 'dzi.klaarGrootboek'),
                  { n: done.committed },
                )
              : t(done.committed === 1 ? 'dzi.klaarOmzetEen' : 'dzi.klaarOmzet', { n: done.committed })}
          </div>
        )}

        {/* [LEDGER] Grootboek cross-check preview — the file was recognised as a bookkeeper
            OVERZICHT/KASBOEK. It is a control witness, not omzet: stored to cross-check the till. */}
        {ledgerPreview && (
          <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
              <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                {t('dzi.grootboekUit', { name: fileName ?? '' })}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface }}>
                {t(LEDGER_KIND_KEY[ledgerPreview.kind] ?? 'dzi.ledger.other')}{ledgerPreview.accountNr ? ` · ${t('dzi.rekening', { nr: ledgerPreview.accountNr })}` : ''}
              </div>
              <div style={{ fontSize: 13, color: M3.neutral, marginTop: 6, lineHeight: 1.5 }}>
                {t(ledgerPreview.count === 1 ? 'dzi.dagTotaal' : 'dzi.dagenTotaal', { n: ledgerPreview.count })}{' '}
                <b style={{ fontFamily: FONT_NUM, color: M3.onSurface }}>{eur.format(ledgerPreview.rows.reduce((s, r) => s + (r.received || 0), 0))}</b>.
                {' '}{t('dzi.ditIsEen')} <b>{t('dzi.controle')}</b> {t('dzi.tegenKassa')} <b>{t('dzi.nietWoord')}</b> {t('dzi.alsOmzetGeteld')}
              </div>
            </div>

            {ledgerPreview.warnings.length > 0 && (
              <div style={{ padding: '14px 18px', background: M3.warningContainer, borderBottom: `1px solid ${M3.outlineVariant}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M3.warning, marginBottom: 6 }}>
                  ⚠ {t(ledgerPreview.warnings.length === 1 ? 'dzi.aandachtspuntEen' : 'dzi.aandachtspunten', { n: ledgerPreview.warnings.length })}
                </div>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {ledgerPreview.warnings.map((w, i) => (
                    <li key={i} style={{ fontSize: 13, color: M3.onSurface, lineHeight: 1.5 }}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {ledgerPreview.count > 0 && (
              <div style={{ overflowX: 'auto', maxHeight: 260 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: FONT_NUM }}>
                  <thead>
                    <tr style={{ color: M3.neutral, textAlign: 'end' }}>
                      <th style={thL}>{t('kas.datum')}</th><th style={thR}>{t('kas.ontvangen')}</th><th style={thR}>{t('dzi.uitgaven')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerPreview.rows.map((r) => (
                      <tr key={r.ledger_date} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={{ ...tdL, fontFamily: FONT }}>{r.ledger_date}</td>
                        <td style={tdR}>{eur.format(r.received)}</td>
                        <td style={tdR}>{eur.format(r.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, padding: '16px 18px' }}>
              <button onClick={() => void approveLedger()} disabled={busy || ledgerPreview.count === 0}
                style={{ flex: 1, background: ledgerPreview.count === 0 ? M3.outlineVariant : M3.primary, color: M3.onPrimary,
                  border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 15, fontWeight: 600,
                  cursor: busy || ledgerPreview.count === 0 ? 'default' : 'pointer', fontFamily: FONT }}>
                {busy ? t('act.bezig') : t('dzi.opslaanControle')}
              </button>
              <button onClick={reject} disabled={busy}
                style={{ background: 'transparent', color: M3.neutral, border: `1px solid ${M3.outlineVariant}`,
                  borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                {t('dzi.afwijzen')}
              </button>
            </div>
          </div>
        )}

        {/* Review */}
        {preview && (
          <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
              <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
                {t('dzi.gelezenUit', { name: fileName ?? '' })}
              </div>
              {preview.count === 0 ? (
                <div style={{ fontSize: 14, color: M3.warning }}>{t('dzi.geenDagen')}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Stat label={t('dzi.dagen')} value={String(preview.count)} sub={dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : undefined} />
                  <Stat label={t('dzi.totaleOmzet')} value={eur.format(totalTurnover)} sub={t('dzi.netto', { amount: eur.format(netOmzet) })} />
                  <Stat label={t('dzi.btwGedetecteerd')} value={eur.format(btw9 + btw21)} sub={`9%: ${eur.format(btw9)} · 21%: ${eur.format(btw21)}`} />
                  <Stat label={t('dz.betaalwijzen')} value={`PIN ${eur.format(pin)}`} sub={t('dzi.contant', { amount: eur.format(cash) })} />
                </div>
              )}
            </div>

            {/* Warnings — the trust signal */}
            {preview.warnings.length > 0 && (
              <div style={{ padding: '14px 18px', background: M3.warningContainer, borderBottom: `1px solid ${M3.outlineVariant}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M3.warning, marginBottom: 6 }}>
                  ⚠ {t(preview.warnings.length === 1 ? 'dzi.aandachtspuntEen' : 'dzi.aandachtspunten', { n: preview.warnings.length })}
                </div>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {preview.warnings.map((w, i) => (
                    <li key={i} style={{ fontSize: 13, color: M3.onSurface, lineHeight: 1.5 }}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Per-day table (scrollable) */}
            {preview.count > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: FONT_NUM }}>
                  <thead>
                    <tr style={{ color: M3.neutral, textAlign: 'end' }}>
                      <th style={thL}>{t('kas.datum')}</th><th style={thR}>{t('dzi.omzetIncl')}</th>
                      <th style={thR}>BTW 9%</th><th style={thR}>BTW 21%</th>
                      <th style={thR}>PIN</th><th style={thR}>{t('lijst.contant')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.turnover_date} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={{ ...tdL, fontFamily: FONT }}>{r.turnover_date}</td>
                        <td style={tdR}>{eur.format(r.total_incl ?? 0)}</td>
                        <td style={tdR}>{eur.format(r.btw_9)}</td>
                        <td style={tdR}>{eur.format(r.btw_21)}</td>
                        <td style={tdR}>{r.pin_amount == null ? '—' : eur.format(r.pin_amount)}</td>
                        <td style={tdR}>{r.cash_amount == null ? '—' : eur.format(r.cash_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, padding: '16px 18px' }}>
              <button onClick={() => void approve()} disabled={busy || preview.count === 0}
                style={{ flex: 1, background: preview.count === 0 ? M3.outlineVariant : M3.primary, color: M3.onPrimary,
                  border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 15, fontWeight: 600,
                  cursor: busy || preview.count === 0 ? 'default' : 'pointer', fontFamily: FONT }}>
                {busy ? t('act.bezig') : t('dzi.goedkeurenOpslaan')}
              </button>
              <button onClick={reject} disabled={busy}
                style={{ background: 'transparent', color: M3.neutral, border: `1px solid ${M3.outlineVariant}`,
                  borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                {t('dzi.afwijzen')}
              </button>
            </div>
          </div>
        )}

        {/* [KASSA] Under the upload, not instead of it: a shop with a kassa uploads its Z-report and
            never looks at this, and a shop without one had no door at all. Saving remounts the
            insights panel above through the same refreshTick the import commit uses, so the day
            appears in the figures immediately rather than after a reload. */}
        <HandmatigeDag korActive={korActive} cardPayouts={cardPayouts} onSaved={() => setRefreshTick((n) => n + 1)} />
        {/* [AFREKENING-DEUR] Hoek 2 van de driehoek, die geen deur had. De Z-bon hierboven is de
            kassa, dit is de pinautomaat zelf, en de bank is de derde. /api/eft/import bestond
            sinds juli en geen scherm kon hem bereiken — een driehoek met een onbereikbare hoek
            sluit niet. Zelfde ritme als de import erboven: lezen, laten zien, pas dan bewaren. */}
        <AfrekeningImport onCommitted={() => setRefreshTick((n) => n + 1)} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#5F6368', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#202124', fontFamily: "'Roboto Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#5F6368', marginTop: 2, fontFamily: "'Roboto Mono',monospace" }}>{sub}</div>}
    </div>
  )
}

const thL: CSSProperties = { textAlign: 'start', padding: '10px 14px', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }
const thR: CSSProperties = { textAlign: 'end', padding: '10px 14px', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }
const tdL: CSSProperties = { textAlign: 'start', padding: '9px 14px', color: '#202124' }
const tdR: CSSProperties = { textAlign: 'end', padding: '9px 14px', color: '#202124' }
