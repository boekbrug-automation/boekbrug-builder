'use client'

// src/app/dashboard/control/ToekenningPaneel.tsx
// [TOEKENNING-DEUR] De enige knoppen op deze console. Toekennen, en intrekken.
//
// ── WAAROM ÉÉN PANEEL EN GEEN KNOPPEN IN DE RIJ ──
// Een tabel met per rij een datumveld en een reden is een tabel waarin je per ongeluk de verkeerde
// regel invult. Het paneel noemt het account waar het over gaat in zijn kop, en het staat er alleen
// als iemand een account koos — [RUSTIG]: in rust toont dit scherm wat het is en verder niets.
//
// ── WAT DIT SCHERM NIET BESLIST ──
// Niets. Elke regel over wat mag — welk plan, hoe lang, hoe lang een reden moet zijn, of een leeg
// datumveld "voor altijd" betekent — staat in plan-grant-actions.ts en wordt door de route
// afgedwongen. Dit paneel spiegelt die regels alleen zodat de gebruiker ze vóór het versturen
// leest, en het vertaalt de CODE die de route terugstuurt naar een zin. Een scherm dat zelf
// valideert is een tweede waarheid over hetzelfde; een scherm dat de tekst van de server toont is
// hoe een interne string op iemands beeld belandt ([SERVER-ZIN]).

import { useState } from 'react'

import DateFieldNL from '@/components/ui/DateFieldNL'
import { useDialog } from '@/components/ui/Dialog'
import type { ControlRow } from '@/lib/control-overview'

/**
 * De weigering van de route, in woorden. De route stuurt een CODE en dit scherm kiest de zin —
 * [SERVER-ZIN]: een serverbericht rechtstreeks tonen is hoe een interne foutstring op iemands
 * scherm belandt, en hoe de woorden op twee plekken uit elkaar gaan lopen. De regels zelf staan in
 * plan-grant-actions.ts; dit is alleen de vertaling.
 */
const WEIGERING: Record<string, string> = {
  'unknown-plan': 'Dit plan kan niet worden toegekend.',
  'reason-missing': 'Zeg waarom — in een jaar leest iemand dit terug.',
  'reason-too-long': 'De reden is te lang (maximaal 200 tekens).',
  'end-not-readable': 'Die einddatum is niet te lezen.',
  'end-not-declared': 'Kies een einddatum, of vink aan dat deze toekenning geen einde heeft.',
  'end-in-past': 'Die einddatum ligt al achter ons.',
  'end-too-far': 'Die einddatum ligt meer dan vijf jaar vooruit — klopt het jaartal?',
  'end-with-open-ended': 'Kies één van beide: een einddatum, of geen einde.',
  'account-missing': 'Geen account opgegeven.',
  'account-unknown': 'Dit account bestaat niet.',
  'account-is-accountant': 'Het boekhoudersportaal is al gratis zonder grenzen — een toekenning verandert daar niets.',
  'grant-missing': 'Geen toekenning opgegeven.',
  'grant-unknown': 'Deze toekenning bestaat niet.',
  'read-failed': 'Het kon niet gelezen worden.',
  'write-failed': 'Opslaan mislukt.',
  'action-unknown': 'Onbekende handeling.',
}

const knop: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: '1px solid #dadce0', background: '#fff',
  fontSize: 13, cursor: 'pointer', color: '#202124',
}
const veld: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid #dadce0', fontSize: 13.5, width: '100%',
}

export default function ToekenningPaneel({ rij, onKlaar }: { rij: ControlRow; onKlaar: () => void }) {
  const dialog = useDialog()
  const [reden, setReden] = useState('')
  const [tot, setTot] = useState('')
  const [zonderEinde, setZonderEinde] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  async function stuur(body: Record<string, unknown>) {
    setBezig(true)
    setFout(null)
    try {
      const res = await fetch('/api/control/toekenning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // [NO-SILENT-EMPTY] Een mislukking die niets zegt leest als een knop die het niet doet.
        // [SERVER-ZIN] De CODE bepaalt de zin, nooit de tekst uit het antwoord zelf.
        const code = typeof json?.code === 'string' ? json.code : ''
        setFout(WEIGERING[code] ?? 'Het is niet gelukt.')
        return
      }
      onKlaar()
    } catch {
      setFout('Geen verbinding — probeer het opnieuw.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8eaed', borderRadius: 12, padding: 18, marginTop: 16,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#202124' }}>{rij.name}</div>
      <div style={{ fontSize: 12.5, color: '#5f6368', marginTop: 2, marginBottom: 14 }}>
        {rij.plan} · {rij.role}
      </div>

      {/* ── Wat er nu loopt, en de enige manier om het te stoppen ── */}
      {rij.openGrants.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#5f6368', fontWeight: 600, marginBottom: 6 }}>
            Loopt nu
          </div>
          {rij.openGrants.map((g) => (
            <div key={g.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 0', borderTop: '1px solid #f1f3f4', fontSize: 13.5,
            }}>
              <span style={{ color: '#202124' }}>
                {g.reason}
                <span style={{ color: '#5f6368' }}>
                  {' — '}{g.expiresAt ? `tot ${g.expiresAt.slice(0, 10)}` : 'geen einddatum'}
                </span>
              </span>
              <button
                type="button"
                style={{ ...knop, borderColor: '#f3c2c2', color: '#B3261E' }}
                disabled={bezig}
                onClick={() => {
                  // De reden van het INTREKKEN, niet die van de toekenning: over een jaar is
                  // "waarom is dit gestopt" de vraag, en het antwoord staat nergens anders.
                  // [KASSA-DIALOOG] De eigen dialoog, geen window.prompt: een OS-balk toont in een
                  // standalone PWA de herkomst-URL en geeft geen plek aan wat er precies stopt.
                  void (async () => {
                    const why = await dialog.prompt({
                      title: 'Toekenning intrekken',
                      message: `${g.reason} — waarom stopt deze?`,
                      placeholder: 'Pilot afgelopen, klant gaat over naar Plus',
                      confirmLabel: 'Intrekken',
                      maxLength: 200,
                    })
                    if (why === null) return
                    await stuur({ action: 'revoke', grantId: g.id, reason: why })
                  })()
                }}
              >
                Intrekken
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Een nieuwe toekenning. Verlengen is opnieuw toekennen: zie de route. ── */}
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontSize: 12.5, color: '#5f6368' }}>
          Waarom
          <input
            style={{ ...veld, marginTop: 4 }}
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="Pilot kantoor Van Dijk, 20 klanten"
            maxLength={200}
          />
        </label>

        {/* [DATE-NL] Geen native <input type="date">: die zet zijn volgorde naar de locale van de
            BROWSER, dus onder en-US is het eerste vakje de maand en leest 02/01/2026 als twee
            verschillende datums. Deze datum bepaalt tot wanneer iemand ruimere grenzen heeft. */}
        <label style={{ fontSize: 12.5, color: '#5f6368' }}>
          Tot en met
          <DateFieldNL
            value={tot}
            onChange={setTot}
            disabled={zonderEinde}
            style={{ ...veld, marginTop: 4 }}
            aria-label="Einddatum van de toekenning"
          />
        </label>

        {/* Een leeg datumveld mag nooit "voor altijd" betekenen — daarom is dit een vinkje en
            geen lege invoer. De route weigert een lege datum zonder dit vinkje. */}
        <label style={{ fontSize: 13, color: '#202124', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={zonderEinde}
            onChange={(e) => { setZonderEinde(e.target.checked); if (e.target.checked) setTot('') }}
          />
          Deze toekenning heeft geen einddatum
        </label>

        {fout && (
          <div style={{
            fontSize: 13, color: '#B3261E', background: '#FCE8E6', border: '1px solid #f3c2c2',
            borderRadius: 8, padding: '8px 10px',
          }}>
            {fout}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            type="button"
            style={{ ...knop, background: '#202124', color: '#fff', borderColor: '#202124' }}
            disabled={bezig}
            onClick={() => void stuur({
              action: 'grant',
              userId: rij.id,
              plan: 'plus',
              reason: reden,
              // Een datumveld geeft "2027-03-01"; de dag zelf hoort er nog bij te horen.
              expiresAt: zonderEinde || tot === '' ? null : `${tot}T23:59:59Z`,
              openEnded: zonderEinde,
            })}
          >
            {bezig ? 'Bezig…' : 'Plus toekennen'}
          </button>
          <button type="button" style={knop} disabled={bezig} onClick={onKlaar}>Sluiten</button>
        </div>
      </div>
    </div>
  )
}
