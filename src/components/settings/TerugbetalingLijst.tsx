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

import { useEffect, useState } from 'react'
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

/**
 * Elke code die de route kan teruggeven, met de zin erbij. Onbekend valt terug op de algemene.
 *
 * [WERKSTROOM-REDEN] De codes dragen hun domein voorop (`refund.`), want twee domeinen willen
 * ooit allebei `not_found` en dat is niet dezelfde weigering. De lijst staat in
 * src/lib/contracts/reason-codes.ts; hier staan de zinnen erbij.
 */
const WEIGERING: Readonly<Record<string, MessageKey>> = {
  'refund.not_found': 'terugbetaling.fout.not_found',
  'refund.invalid_answer': 'terugbetaling.fout.invalid_answer',
  'refund.partial_refund': 'terugbetaling.fout.partial_refund',
  'refund.no_invoice': 'terugbetaling.fout.no_invoice',
  'refund.payment_gone': 'terugbetaling.fout.payment_gone',
  'refund.payment_changed': 'terugbetaling.fout.payment_changed',
  'refund.accountant_lock': 'terugbetaling.fout.accountant_lock',
  'refund.has_bank_line': 'terugbetaling.fout.has_bank_line',
  'refund.already_answered': 'terugbetaling.fout.already_answered',
  // De geldfunctie weigerde om een reden die de deur niet kon benoemen. De algemene zin is hier
  // het eerlijke antwoord — maar hij staat EXPLICIET in de kaart, want een code die alleen via de
  // terugval een zin krijgt is een code waarvan niemand meer weet dat hij bestaat.
  'refund.reverse_failed': 'terugbetaling.fout.algemeen',
}

/**
 * The open questions, or an empty list.
 *
 * OUTSIDE the component on purpose. As a useCallback called from the effect, the React compiler
 * reads its setState as a synchronous effect-body write and refuses it — the same rule MollieCard
 * satisfies by keeping its fetch inline. Returning the rows instead of setting them keeps one
 * reader for both callers (first paint, and after an answer) without that shape.
 */
async function fetchOpenRefunds(): Promise<OpenRefund[]> {
  try {
    const res = await fetch('/api/mollie/terugbetaling')
    const json = await res.json().catch(() => ({}))
    return res.ok && Array.isArray(json.refunds) ? (json.refunds as OpenRefund[]) : []
  } catch {
    return []
  }
}

export function TerugbetalingLijst() {
  const t = translator(useLocale())
  const [refunds, setRefunds] = useState<OpenRefund[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rows = await fetchOpenRefunds()
      if (!cancelled) setRefunds(rows)
    })()
    return () => { cancelled = true }
  }, [])

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
        if (res.status === 409) setRefunds(await fetchOpenRefunds())
        return
      }
      setRefunds(await fetchOpenRefunds())
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
