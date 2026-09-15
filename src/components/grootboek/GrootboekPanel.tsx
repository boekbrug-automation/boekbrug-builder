'use client'

// src/components/grootboek/GrootboekPanel.tsx
// [GROOTBOEK] The purchase invoices that still need a cost account, each with a suggestion and the
// reason for it. One tap confirms; the dropdown overrules.
//
// It sits beside the auditfile link on the Jaar screen because that is what it is FOR: every
// invoice answered here is one line the boekhouder does not have to re-code by hand.
//
// [NO-SILENT-EMPTY] Nothing is rendered until the read answers. "Everything has an account" and
// "we could not look" are opposite answers, and the first is the dangerous one — it tells the
// owner their administratie is finished.
//
// [TAAL] The component holds no language of its own; suggestionReason decides which words.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL } from '@/lib/format-nl'
import { suggestionReason, openCountPhrase, groupSizePhrase } from '@/lib/grootboek-lines'
import type { LedgerAccount, LedgerSuggestion } from '@/lib/grootboek'

/** One supplier's open invoices: the unit the owner actually decides in. */
interface OpenGroup {
  key: string
  vendor: string | null
  ids: string[]
  count: number
  gross: number
  newest: string | null
  suggestion: LedgerSuggestion
}

interface Payload {
  ok: true
  accounts: LedgerAccount[]
  open: OpenGroup[]
  openInvoices: number
  decided: number
  total: number
}

// Answered a few at a time, on a phone, between other things. A hundred suppliers at once is a
// wall; a handful with the count above it is a task.
const PAGE = 8

/**
 * The populated panel, as a pure function of what was read.
 *
 * Exported and separated from the fetching for one reason: the wrapper renders NOTHING until its
 * read answers ([NO-SILENT-EMPTY]), so a server render of the wrapper can never reach the rows —
 * and rows are exactly where the class of bug this repo's render gate exists for lives. AGENTS.md:
 * hand it rows that exercise the branches, because `[].map(cb)` never calls cb.
 */
export function GrootboekList({ data, saving, onAssign }: {
  data: Payload
  saving: string | null
  onAssign: (group: OpenGroup, account: string) => void
}) {
  const t = translator(useLocale())
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {data.open.map((g) => {
        const why = suggestionReason(g.suggestion)
        const size = groupSizePhrase(g.count, formatEuroNL(g.gross))
        return (
          <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid #F1F3F4' }}>
            <span style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.vendor || '—'}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: '#80868B', marginTop: 1 }}>
                {t(size.key, size.params)} — {t(why.key, why.params)}
              </span>
            </span>
            {/* The suggestion is PRE-SELECTED, never pre-saved. Changing it here IS the answer, for
                every open invoice of this supplier at once; there is no separate confirm, because a
                two-tap answer on a hundred suppliers is a list nobody finishes. What it covers is
                on the line above it. */}
            <select
              aria-label={t('gb.kop')}
              defaultValue={g.suggestion.accountId}
              disabled={saving === g.key}
              onChange={(e) => onAssign(g, e.target.value)}
              style={{ fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid #DADCE0', background: '#fff', color: '#202124', maxWidth: 240 }}
            >
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.id} · {a.name}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

export default function GrootboekPanel() {
  const t = translator(useLocale())
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [shown, setShown] = useState(PAGE)

  // Same shape as the sibling panels: the fetch is started inside the effect and its answer is
  // dropped if the screen moved on, so a slow read can never write over a newer one.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/grootboek')
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok) { setFailed(true); setData(null); return }
        setData(json as Payload); setFailed(false)
      } catch {
        if (!cancelled) { setFailed(true); setData(null) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // One answer covers the supplier's whole open set. The count sits next to the name, so the size
  // of the decision is on screen before it is made.
  const assign = async (group: OpenGroup, account: string) => {
    setSaving(group.key); setSaveError(false)
    try {
      const res = await fetch('/api/grootboek', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: group.ids, account }),
      })
      if (!res.ok) { setSaveError(true); return }
      // Drop the answered group locally rather than re-reading the whole list: the owner is
      // working through it and a re-fetch would move the ground under the next tap.
      setData((d) => (d ? {
        ...d,
        open: d.open.filter((o) => o.key !== group.key),
        openInvoices: d.openInvoices - group.count,
        decided: d.decided + group.count,
      } : d))
    } catch { setSaveError(true) } finally { setSaving(null) }
  }

  if (!failed && !data) return null

  const count = openCountPhrase(data?.openInvoices ?? 0, data?.open.length ?? 0)

  return (
    <section data-testid="grootboek" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E0E0E0', padding: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: '#202124' }}>{t('gb.kop')}</h2>
      {failed || !data ? (
        <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('gb.leesfout')}</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 10px' }}>{t(count.key, count.params)}</p>
          {data.open.length > 0 && (
            <GrootboekList
              data={{ ...data, open: data.open.slice(0, shown) }}
              saving={saving}
              onAssign={(g, account) => void assign(g, account)}
            />
          )}
          {saveError && <p style={{ fontSize: 13, color: '#B3261E', margin: '10px 0 0' }}>{t('gb.opslaanFout')}</p>}
          {data.open.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: '#1A73E8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('gb.meer')}
            </button>
          )}
          <p style={{ fontSize: 12, color: '#5F6368', margin: '10px 0 0', lineHeight: 1.55 }}>{t('gb.uitleg')}</p>
        </>
      )}
    </section>
  )
}
