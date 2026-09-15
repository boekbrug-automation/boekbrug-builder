'use client'

// src/components/grootboek/GrootboekKaart.tsx
// [GROOTBOEK-KAART] The saldibalans, one grootboekkaart, and the journaal — the three pages an
// accountant opens first and the three this app has never had.
//
// The figures come from /api/grootboek/kaart, which builds them with buildJournalEntries — the
// SAME function the auditfile uses. Nothing on this screen is computed here; the component
// arranges, it does not decide. See [JOURNAAL-BRON] for why that is not negotiable.
//
// [NO-SILENT-EMPTY] Nothing renders until the read answers. "This administration has no bookings"
// and "we could not look" are opposite answers and the first one is the dangerous one.
//
// [TAAL] The component holds no language of its own: every sentence comes from
// grootboek-kaart-lines.ts.

import { useEffect, useState } from 'react'
import { formatEuroNL } from '@/lib/format-nl'
import {
  debetCredit, saldoZin, resultaatZin, volledigheidZin, mutatieTelling, journaalNaam,
} from '@/lib/grootboek-kaart-lines'
import type { LedgerCard } from '@/lib/grootboekkaart'
import type { Entry } from '@/lib/xaf-export'

export interface KaartPayload {
  year: number
  cards: LedgerCard[]
  totalDebitC: number
  totalCreditC: number
  balanced: boolean
  unknownAccounts: string[]
  resultC: number
  entries: Entry[]
  skipped: { source: string; id: string; reason: string }[]
}

type Tab = 'balans' | 'journaal'

/**
 * The populated screen, as a pure function of what was read.
 *
 * Exported apart from the fetching so `npm run test:render` can hand it rows that exercise the
 * branches — an empty ledger renders nothing interesting, and the bug this class of test exists to
 * catch (AGENTS.md) is invisible against an empty list.
 */
export function GrootboekKaartView({ data }: { data: KaartPayload }) {
  const [tab, setTab] = useState<Tab>('balans')
  const [open, setOpen] = useState<string | null>(null)

  const melding = volledigheidZin({
    balanced: data.balanced,
    skippedCount: data.skipped.length,
    unknownAccounts: data.unknownAccounts,
  })

  const openCard = open ? data.cards.find((c) => c.accID === open) ?? null : null

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Grootboek {data.year}</h2>
        <span style={{ opacity: 0.75 }}>{resultaatZin(data.resultC)}</span>
      </header>

      {melding ? (
        <p role="status" style={{ margin: 0, padding: '8px 12px', borderRadius: 8, background: '#FDF3E7' }}>
          {melding}
        </p>
      ) : null}

      <div role="tablist" style={{ display: 'flex', gap: 8 }}>
        <button role="tab" aria-selected={tab === 'balans'} onClick={() => setTab('balans')}>
          Saldibalans
        </button>
        <button role="tab" aria-selected={tab === 'journaal'} onClick={() => setTab('journaal')}>
          Journaal
        </button>
      </div>

      {tab === 'balans' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'start' }}>Rekening</th>
              <th style={{ textAlign: 'end' }}>Debet</th>
              <th style={{ textAlign: 'end' }}>Credit</th>
              <th style={{ textAlign: 'end' }}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.map((c) => (
              <tr key={c.accID}>
                <td>
                  <button onClick={() => setOpen(c.accID === open ? null : c.accID)}>
                    {c.accID} {c.accDesc}
                  </button>
                  <span style={{ opacity: 0.6, paddingInlineStart: 8 }}>{mutatieTelling(c.mutations.length)}</span>
                </td>
                <td style={{ textAlign: 'end' }}>{formatEuroNL(c.totalDebitC / 100)}</td>
                <td style={{ textAlign: 'end' }}>{formatEuroNL(c.totalCreditC / 100)}</td>
                <td style={{ textAlign: 'end' }}>{saldoZin(c.balanceC)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Totaal</td>
              <td style={{ textAlign: 'end' }}>{formatEuroNL(data.totalDebitC / 100)}</td>
              <td style={{ textAlign: 'end' }}>{formatEuroNL(data.totalCreditC / 100)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {data.entries.map((e) => (
            <li key={e.nr}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <strong>{journaalNaam(e.journal)}</strong>
                <span>{e.date}</span>
                <span style={{ opacity: 0.75 }}>{e.desc}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {e.lines.map((l, i) => {
                    const dc = debetCredit(l.debitC)
                    return (
                      <tr key={`${e.nr}-${i}`}>
                        <td>{l.accID}</td>
                        <td>{l.desc}</td>
                        <td style={{ textAlign: 'end' }}>{dc.debet}</td>
                        <td style={{ textAlign: 'end' }}>{dc.credit}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </li>
          ))}
        </ol>
      )}

      {openCard ? (
        <div>
          <h3 style={{ fontSize: 16 }}>{openCard.accID} {openCard.accDesc}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'start' }}>Datum</th>
                <th style={{ textAlign: 'start' }}>Omschrijving</th>
                <th style={{ textAlign: 'end' }}>Debet</th>
                <th style={{ textAlign: 'end' }}>Credit</th>
                <th style={{ textAlign: 'end' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {openCard.mutations.map((m, i) => {
                const dc = debetCredit(m.debitC)
                return (
                  <tr key={`${m.entryNr}-${i}`}>
                    <td>{m.date}</td>
                    <td>{journaalNaam(m.journal)} · {m.description}</td>
                    <td style={{ textAlign: 'end' }}>{dc.debet}</td>
                    <td style={{ textAlign: 'end' }}>{dc.credit}</td>
                    <td style={{ textAlign: 'end' }}>{saldoZin(m.runningC)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {data.skipped.length > 0 ? (
        <details>
          <summary>Niet geboekt ({data.skipped.length})</summary>
          <ul>
            {data.skipped.map((s) => (
              <li key={`${s.source}-${s.id}`}>{s.source}: {s.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/** The fetching wrapper. Renders nothing at all until the read has answered. */
export default function GrootboekKaart({ year, clientId }: { year: number; clientId?: string | null }) {
  const [data, setData] = useState<KaartPayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const qs = new URLSearchParams({ year: String(year) })
        if (clientId) qs.set('clientId', clientId)
        const res = await fetch(`/api/grootboek/kaart?${qs.toString()}`)
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as KaartPayload
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [year, clientId])

  if (failed) {
    return <p role="status">De boekhouding kon niet worden opgehaald. Probeer het later opnieuw.</p>
  }
  if (!data) return null
  return <GrootboekKaartView data={data} />
}
