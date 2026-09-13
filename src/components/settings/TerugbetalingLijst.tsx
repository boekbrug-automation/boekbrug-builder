'use client'

// src/components/settings/TerugbetalingLijst.tsx
// [TERUGBETALING] Geld dat via Mollie terugging, met de drie antwoorden ernaast.
//
// Staat onder de Mollie-kaart omdat dat de plek is waar de koppeling over zichzelf praat — daar
// verschijnt ook de reden waarom een afrekening wordt vastgehouden, en dit is die reden.
//
// [RUSTIG] Niets in rust: is er niets te beslissen, dan rendert dit component NIETS. Geen kopje,
// geen "geen terugbetalingen", geen lege kaart. De vraag is er of hij is er niet.
// [TAAL] Alle tekst via messages.ts — een component houdt geen taal van zichzelf.
// [SERVER-ZIN] De route geeft codes; de kaart hieronder schrijft de zin.

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL, formatDateNL } from '@/lib/format-nl'
import type { MessageKey } from '@/lib/i18n/messages'

interface OpenRefund {
  refundId: string
  kind: 'refund' | 'chargeback'
  amount: number
  createdOn: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  clientName: string | null
}

/** Elke code die de route kan teruggeven, met de zin erbij. Onbekend valt terug op de algemene. */
const WEIGERING: Readonly<Record<string, MessageKey>> = {
  partial_refund: 'terugbetaling.fout.partial_refund',
  no_invoice: 'terugbetaling.fout.no_invoice',
  payment_gone: 'terugbetaling.fout.payment_gone',
  accountant_lock: 'terugbetaling.fout.accountant_lock',
  has_bank_line: 'terugbetaling.fout.has_bank_line',
  already_answered: 'terugbetaling.fout.already_answered',
}

export function TerugbetalingLijst() {
  const t = translator(useLocale())
  const [refunds, setRefunds] = useState<OpenRefund[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mollie/terugbetaling')
      const json = await res.json().catch(() => ({}))
      setRefunds(res.ok && Array.isArray(json.refunds) ? (json.refunds as OpenRefund[]) : [])
    } catch {
      setRefunds([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function answer(refundId: string, action: 'reversed' | 'credited' | 'not_ours') {
    if (busy) return
    setBusy(refundId)
    setError('')
    try {
      const res = await fetch('/api/mollie/terugbetaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refundId, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = typeof json?.code === 'string' ? json.code : ''
        setError(t(WEIGERING[code] ?? 'terugbetaling.fout.algemeen'))
        // Een 409 betekent dat de wereld anders is dan dit scherm dacht — opnieuw lezen, zodat de
        // volgende klik niet op dezelfde verouderde rij gaat.
        if (res.status === 409) await load()
        return
      }
      await load()
    } catch {
      setError(t('terugbetaling.fout.algemeen'))
    } finally {
      setBusy('')
    }
  }

  if (!refunds || refunds.length === 0) return null

  return (
    <div style={{ background: '#fff', border: '1px solid #F9AB00', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('terugbetaling.titel')}</h2>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 13, color: '#5F6368', margin: 0, lineHeight: 1.6 }}>{t('terugbetaling.uitleg')}</p>

        {refunds.map((r) => (
          <div key={r.refundId} style={{ borderTop: '1px solid #E0E0E0', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>
              {t(r.kind === 'chargeback' ? 'terugbetaling.soort.chargeback' : 'terugbetaling.soort.refund')}
              {' · '}{formatEuroNL(r.amount)}
              {r.createdOn ? ` · ${formatDateNL(r.createdOn)}` : ''}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
              {r.invoiceNumber
                ? `${t('terugbetaling.opFactuur', { number: r.invoiceNumber })}${r.clientName ? ` — ${r.clientName}` : ''}`
                : t('terugbetaling.geenFactuur')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {r.invoiceId && (
                <button
                  onClick={() => void answer(r.refundId, 'reversed')}
                  disabled={busy !== ''}
                  style={knop('#B3261E')}
                >
                  {busy === r.refundId ? t('terugbetaling.bezig') : t('terugbetaling.knop.terugdraaien')}
                </button>
              )}
              {r.invoiceId && (
                <button onClick={() => void answer(r.refundId, 'credited')} disabled={busy !== ''} style={knop('#202124')}>
                  {t('terugbetaling.knop.creditnota')}
                </button>
              )}
              <button onClick={() => void answer(r.refundId, 'not_ours')} disabled={busy !== ''} style={knop('#5F6368')}>
                {t('terugbetaling.knop.nietVanMij')}
              </button>
            </div>
          </div>
        ))}

        {error && <p style={{ fontSize: 13, color: '#B3261E', margin: 0, lineHeight: 1.5 }}>{error}</p>}
      </div>
    </div>
  )
}

function knop(color: string): React.CSSProperties {
  return {
    background: 'none', border: '1px solid #DADCE0', borderRadius: 8, padding: '7px 14px',
    fontSize: 13, fontWeight: 600, color, cursor: 'pointer', fontFamily: 'inherit',
  }
}
