'use client'

// src/app/bankafschrift-naar-excel/BankConverter.tsx
// [BANK-CSV] The free "bankafschrift naar Excel" converter — the acquisition wedge.
// Everything runs IN THE BROWSER: the file is read, parsed (MT940 / CAMT.053 / CSV
// via the same parser the app uses) and re-written to a clean Excel/CSV locally.
// The statement never leaves the device — the strongest possible trust signal for
// a financial tool, and it is literally true (no upload, no API call). A soft CTA
// hands off to BoekBrug for owners who want to keep + reconcile the data; there is
// no lock and the download works without any of that.

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { parseBankFile, type ParseResult } from '@/lib/bank-parser'
import { toExportMatrix, toNormalizedCsv } from '@/lib/bank-csv'
// [SHEET-LAAT] SheetJS is NOT imported here. Measured in the built chunks and then in what the
// server actually hands out: 266 kB raw, 88 kB over the wire. On this page it is needed by exactly
// one thing — the .xlsx download button at the very end of the flow, beside a CSV button that needs
// none of it. A static import made every visitor to a PUBLIC page pay for a writer most of them
// never reach, on the page whose entire job is to convert a stranger in the first seconds. Same
// trap as PdfDownloadButton.tsx, different library, and its lesson is the one that counts: the
// deferral is worth nothing unless the IMPORT moves, so it lives inside the click handler below.
import { looksLikeSpreadsheetBinary } from '@/lib/detect-file'
// [AFSCHRIFT-SLUIT] Dezelfde controle die de app op elk geüpload afschrift draait.
import { reconcileStatementBalance } from '@/lib/bank-statement-balance'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateNL = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

interface Parsed {
  result: ParseResult
  fileName: string
  baseName: string
}

function download(bytes: Uint8Array | string, filename: string, mime: string) {
  // Cast: SheetJS returns a Uint8Array whose ArrayBufferLike doesn't line up with
  // the DOM's narrower BlobPart type under recent TS libs, though it is a valid
  // Blob part at runtime. A string body passes through unchanged.
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function BankConverter() {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setError('')
    setParsed(null)
    if (file.size > 8_000_000) { setError('Dit bestand is groter dan 8 MB. Bankafschriften zijn normaal veel kleiner — klopt het bestand?'); return }
    setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      if (looksLikeSpreadsheetBinary(buf)) {
        setError('Dit is al een Excel-bestand (.xls/.xlsx), geen bankafschrift. Download je afschrift bij je bank als CSV, MT940 of CAMT.053 en probeer dat.')
        setBusy(false)
        return
      }
      const text = new TextDecoder('utf-8').decode(buf)
      const result = parseBankFile(text, file.name)
      if (result.transactions.length === 0) {
        setError(
          result.parseErrors[0] ||
          'Geen transacties gevonden. Upload een bankafschrift als CSV, MT940 (.sta) of CAMT.053 (.xml) — dat kun je bij je bank downloaden.'
        )
        setBusy(false)
        return
      }
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'bankafschrift'
      setParsed({ result, fileName: file.name, baseName })
    } catch {
      setError('Kon dit bestand niet lezen. Probeer een CSV-, MT940- of CAMT.053-bestand van je bank.')
    }
    setBusy(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  // [SHEET-LAAT] The writer arrives when it is asked for. A failed load says so — a download button
  // that does nothing at all is the worst answer on a page built to earn trust.
  const [xlsxBezig, setXlsxBezig] = useState(false)
  const downloadXlsx = async () => {
    if (!parsed || xlsxBezig) return
    setXlsxBezig(true)
    try {
      const { matrixToXlsxBytes } = await import('@/lib/xlsx-adapter')
      const bytes = matrixToXlsxBytes(toExportMatrix(parsed.result))
      download(bytes, `${parsed.baseName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch {
      setError('De Excel-schrijver kon niet worden geladen. Download hem als CSV — dat bestand opent ook in Excel.')
    } finally {
      setXlsxBezig(false)
    }
  }
  const downloadCsv = () => {
    if (!parsed) return
    download(toNormalizedCsv(parsed.result), `${parsed.baseName}.csv`, 'text/csv;charset=utf-8')
  }
  const reset = () => { setParsed(null); setError(''); if (inputRef.current) inputRef.current.value = '' }

  const txs = parsed?.result.transactions ?? []
  const totalIn = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  // [AFSCHRIFT-SLUIT] Het sterkste dat over een afschrift te zeggen valt: beginsaldo + alle
  // mutaties = eindsaldo, tot op de cent. MT940 en CAMT.053 dragen die saldi zelf (:60F:/:62F:,
  // OPBD/CLBD); een CSV niet, en dan zegt dit blok eerlijk dat het niet te controleren was in
  // plaats van een gerustheid te verzinnen. Draait hier, in de browser, op het bestand van de
  // bezoeker — er is geen upload om het op te doen.
  const sb = parsed?.result.statementBalance ?? null
  const recon = sb ? reconcileStatementBalance(sb.opening, sb.closing, txs.map((t) => t.amount)) : null
  const dates = txs.map((t) => t.date).filter(Boolean).sort()

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px 64px', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden>🏦→📊</div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#202124', margin: '0 0 10px', letterSpacing: -0.5 }}>
          Bankafschrift naar Excel
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 auto', maxWidth: 560, lineHeight: 1.55 }}>
          Zet je bankafschrift (CSV, MT940 of CAMT.053) om naar een nette Excel. Werkt met ING,
          Rabobank, bunq en veel andere Nederlandse banken. Gratis, geen account.
        </p>
      </div>

      {!parsed && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            style={{
              border: `2px dashed ${dragOver ? '#1a73e8' : '#c9c9ce'}`,
              background: dragOver ? '#e8f0fe' : '#fff',
              borderRadius: 18, padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
              transition: 'all .15s', outline: 'none',
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }} aria-hidden>📎</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#202124', marginBottom: 6 }}>
              {busy ? 'Bezig met lezen…' : 'Sleep je afschrift hierheen of klik om te kiezen'}
            </div>
            <div style={{ fontSize: 14, color: '#5f6368' }}>CSV, MT940 (.sta) of CAMT.053 (.xml) — max 8 MB</div>
            <input
              ref={inputRef} type="file" accept=".csv,.txt,.sta,.mt940,.xml,.camt,.053,text/csv,text/plain,application/xml"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>

          {error && (
            <div style={{ marginTop: 16, background: '#fff4f4', border: '1px solid #ffd7d7', borderRadius: 12, padding: '14px 16px', color: '#b3261e', fontSize: 14.5, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#137333', fontSize: 13.5, fontWeight: 600 }}>
            <span aria-hidden>🔒</span>
            <span>Je bestand blijft op je apparaat. Het wordt in je eigen browser omgezet — er wordt niets geüpload.</span>
          </div>
        </>
      )}

      {parsed && (
        <div>
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: 22, boxShadow: '0 2px 14px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: '#5f6368' }}>{parsed.fileName} · {parsed.result.format}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#202124' }}>{txs.length} transacties gevonden</div>
                {dates.length > 0 && <div style={{ fontSize: 13.5, color: '#5f6368' }}>{dateNL(dates[0])} — {dateNL(dates[dates.length - 1])}</div>}
              </div>
              <button onClick={reset} style={{ background: '#f8f9fa', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, color: '#202124', cursor: 'pointer' }}>
                Ander bestand
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
              <Stat label="Bij (ontvangen)" value={eur.format(totalIn)} color="#137333" />
              <Stat label="Af (betaald)" value={eur.format(totalOut)} color="#b3261e" />
            </div>

            {/* [AFSCHRIFT-SLUIT] De controle die niemand anders op deze pagina doet: klopt dit
                afschrift met zichzelf? Een bezoeker kan het antwoord meteen naast zijn eigen
                bankapp leggen — het is zijn bestand, niet een demo. Slaagt hij, dan is dat de
                enige zin op deze pagina die iets bewijst; faalt hij, dan weet hij nu iets wat
                zijn boekhouding raakt en wat geen enkele converter hem zou hebben verteld. */}
            {recon?.checkable && (
              <div style={{
                marginBottom: 18, padding: '12px 14px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.55,
                background: recon.ok ? '#e6f4ea' : '#fce8e6',
                color: recon.ok ? '#137333' : '#b3261e',
                border: `1px solid ${recon.ok ? '#b7e1c1' : '#f5c6c2'}`,
              }}>
                {recon.ok ? (
                  <>
                    <strong>✓ Dit afschrift sluit aan, tot op de cent.</strong>{' '}
                    Beginsaldo {eur.format(recon.opening ?? 0)} plus deze {recon.txCount} mutaties komt precies
                    uit op eindsaldo {eur.format(recon.closing ?? 0)}. Er ontbreekt geen regel.
                  </>
                ) : (
                  <>
                    <strong>⚠ Dit afschrift sluit niet aan.</strong>{' '}
                    Beginsaldo {eur.format(recon.opening ?? 0)} plus deze {recon.txCount} mutaties komt uit
                    op {eur.format(recon.expectedClosing ?? 0)}, terwijl het afschrift {eur.format(recon.closing ?? 0)} als
                    eindsaldo noemt — een verschil van {eur.format(Math.abs(recon.gap))}. Waarschijnlijk is het
                    bestand niet compleet: download de hele periode opnieuw bij je bank.
                  </>
                )}
              </div>
            )}
            {parsed.result.statementBalance == null && (
              <div style={{ marginBottom: 18, padding: '12px 14px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.55, background: '#f8f9fa', color: '#5f6368', border: '1px solid #e8eaed' }}>
                Dit bestand draagt geen begin- en eindsaldo, dus of het compleet is valt er niet aan af te
                lezen. Een MT940- of CAMT.053-bestand van dezelfde periode wél — die controle doen we dan
                meteen voor je.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={downloadXlsx} disabled={xlsxBezig} style={{ background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 22px', fontSize: 15, fontWeight: 700, cursor: xlsxBezig ? 'default' : 'pointer', opacity: xlsxBezig ? 0.7 : 1 }}>
                {xlsxBezig ? 'Even geduld…' : '⬇︎ Download als Excel (.xlsx)'}
              </button>
              <button onClick={downloadCsv} style={{ background: '#fff', color: '#1a73e8', border: '1px solid #1a73e8', borderRadius: 10, padding: '13px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                ⬇︎ Download als CSV
              </button>
            </div>

            {parsed.result.parseErrors.length > 0 && (
              <div style={{ marginTop: 14, fontSize: 13, color: '#7c5800', background: '#fff8e6', border: '1px solid #ffe9a8', borderRadius: 10, padding: '10px 12px' }}>
                {parsed.result.parseErrors.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
          </div>

          {/* Preview — first 8 rows */}
          <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, color: '#5f6368', borderBottom: '1px solid #f8f9fa' }}>
              VOORBEELD (eerste {Math.min(8, txs.length)} van {txs.length})
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ color: '#5f6368', textAlign: 'start' }}>
                    <th style={{ padding: '8px 16px', fontWeight: 600 }}>Datum</th>
                    <th style={{ padding: '8px 16px', fontWeight: 600 }}>Tegenpartij</th>
                    <th style={{ padding: '8px 16px', fontWeight: 600, textAlign: 'end' }}>Bedrag</th>
                  </tr>
                </thead>
                <tbody>
                  {[...txs].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map((t, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f8f9fa' }}>
                      <td style={{ padding: '9px 16px', color: '#5f6368', whiteSpace: 'nowrap' }}>{dateNL(t.date)}</td>
                      <td style={{ padding: '9px 16px', color: '#202124' }}>{t.counterpartName || t.description || '—'}</td>
                      <td style={{ padding: '9px 16px', textAlign: 'end', fontWeight: 600, whiteSpace: 'nowrap', color: t.amount < 0 ? '#b3261e' : '#137333' }}>{eur.format(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Soft hand-off — no lock */}
          <section style={{ marginTop: 22, background: '#e8f0fe', border: '1px solid #d3e3fd', borderRadius: 16, padding: 22, textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#202124', marginBottom: 6 }}>Wil je dit niet elke maand opnieuw doen?</div>
            <div style={{ fontSize: 14.5, color: '#5f6368', marginBottom: 16, maxWidth: 520, margin: '0 auto 16px', lineHeight: 1.55 }}>
              In BoekBrug staan je afschriften, facturen en BTW bij elkaar. Je bank koppelen we automatisch aan je facturen — klaar voor je aangifte en je boekhouder.
            </div>
            <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 24px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
              Gratis account maken
            </Link>
          </section>
        </div>
      )}
    </main>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: '#f8f9fb', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 12.5, color: '#5f6368', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
