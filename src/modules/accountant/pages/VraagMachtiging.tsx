'use client'

// src/modules/accountant/pages/VraagMachtiging.tsx
// [VRAAG-MACHTIGING] De knop die er niet was.
//
// Vier schermen wachtten op een machtiging en geen ervan kon er een vragen. Hun lege staten
// zeiden "je klant zet het zelf aan bij Instellingen" — instructies voor een telefoongesprek. Een
// functie die pas begint na een telefoontje, begint niet.
//
// Dit blokje staat daarom IN die lege staten, direct onder de uitleg: je leest waarom je hier
// niets kunt, en de volgende regel is de manier om dat op te lossen.
//
// WAT HET NADRUKKELIJK NIET IS
// Geen machtiging. De boekhouder vraagt; de klant beslist, op zijn eigen scherm. Een boekhouder
// die zichzelf machtigt is precies het gat dat accountant_clients_insert_consent.sql dichtmaakte,
// en dat gaat hier niet alsnog open via een vriendelijke knop.

import { useState } from 'react'
import { M3, R } from '@/lib/design/tokens'
import { failureText } from '@/lib/server-message'
// [TAAL] This widget holds no language of its own: every sentence comes from messages.ts. What the
// CLIENT then receives is written by the route, not here — that message is not interface.
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'

export interface KoppelKlant {
  id: string
  naam: string
}

interface Props {
  /** De GEKOPPELDE klanten — niet de gemachtigde. Dit blokje bestaat juist voor wie nog niet mag. */
  klanten: KoppelKlant[]
  kind: 'facturen' | 'bevestigen'
}

export default function VraagMachtiging({ klanten, kind }: Props) {
  // Before the early return below: the hook count may not depend on how many clients there are.
  const locale = useLocale()
  const t = translator(locale)
  const [klantId, setKlantId] = useState(klanten.length === 1 ? klanten[0].id : '')
  const [bezig, setBezig] = useState(false)
  const [gedaan, setGedaan] = useState<string[]>([])
  const [fout, setFout] = useState<string | null>(null)

  if (klanten.length === 0) return null

  const klant = klanten.find((k) => k.id === klantId) ?? null
  const alGevraagd = klantId ? gedaan.includes(klantId) : false

  async function vraag() {
    if (!klant) return
    setBezig(true)
    setFout(null)
    try {
      const res = await fetch('/api/accountant/vraag-machtiging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: klant.id, kind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(failureText(res.status, data, t('bh.macht.fout.mislukt')))
      setGedaan((g) => [...g, klant.id])
    } catch (e) {
      setFout(e instanceof Error ? e.message : t('bh.macht.fout.algemeen'))
    } finally {
      setBezig(false)
    }
  }

  const veld: React.CSSProperties = {
    flex: 1,
    minWidth: 180,
    padding: '9px 12px',
    border: `1px solid ${M3.outline}`,
    borderRadius: R.sm,
    fontSize: 14.5,
    color: M3.onSurface,
    background: M3.surface,
    boxSizing: 'border-box',
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${M3.outlineVariant}` }}>
      <p style={{ margin: '0 0 10px', fontSize: 14, color: M3.onSurface, fontWeight: 500 }}>
        {t('bh.macht.kop')}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: M3.mutedText, lineHeight: 1.6 }}>
        {t('bh.macht.uitleg')}
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={klantId}
          onChange={(e) => setKlantId(e.target.value)}
          aria-label={t('bh.macht.kiesLabel')}
          style={veld}
        >
          <option value="">{t('bh.macht.kiesPlaceholder')}</option>
          {klanten.map((k) => (
            <option key={k.id} value={k.id}>{k.naam}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={vraag}
          disabled={bezig || !klant || alGevraagd}
          style={{
            padding: '9px 16px',
            background: !klant || alGevraagd ? M3.surfaceVariant : M3.primary,
            color: !klant || alGevraagd ? M3.mutedText : M3.onPrimary,
            border: 'none',
            borderRadius: R.full,
            fontSize: 14,
            fontWeight: 500,
            cursor: bezig || !klant || alGevraagd ? 'default' : 'pointer',
          }}
        >
          {alGevraagd ? t('bh.macht.knop.gevraagd') : bezig ? t('bh.macht.knop.bezig') : t('bh.macht.knop.vraag')}
        </button>
      </div>

      {alGevraagd && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: M3.success }}>
          {t('bh.macht.gevraagdMelding')}
        </p>
      )}
      {fout && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: M3.error, lineHeight: 1.5 }}>
          {fout}
        </p>
      )}
    </div>
  )
}
