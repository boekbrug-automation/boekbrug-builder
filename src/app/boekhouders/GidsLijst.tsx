'use client'

// src/app/boekhouders/GidsLijst.tsx
// [KANTOORGIDS-TAAL] "Vind een boekhouder die bij jou past" — de lijst met de filters erboven.
//
// ── WAAROM DIT EEN FILTER IS EN GEEN VOORSELECTIE ───────────────────────────────────────────
// De pagina opent op ALLES. Geen taal gekozen, geen plaats ingevuld, elk kantoor zichtbaar — de
// ondernemer versmalt zelf, of niet.
//
// Wat hier met opzet NIET gebeurt: de taal van zijn eigen account als filter invullen. Dat lijkt
// behulpzaam en is het tegendeel. Iemand die Arabisch leest wil misschien juist een Nederlandse
// boekhouder om de hoek, of de goedkoopste, of degene die zijn branche kent — en een lijst die
// stilletjes op zijn accounttaal was voorgefilterd zou de meeste kantoren verbergen ZONDER dat hij
// ziet waarom. Een keuze die hij niet heeft gemaakt mag niets voor hem wegnemen.
//
// ── DE VOLGORDE BLIJFT VAN sortForOwner ─────────────────────────────────────────────────────
// Filteren verwijdert regels; het verplaatst er nooit een. De lijst die binnenkomt is al gesorteerd
// op ruimte-dan-naam, en .filter() laat die volgorde intact. Zou een filter ook kunnen rangschikken,
// dan was er een hendel — en een lijst met een hendel is een advertentie.

import { useMemo, useState } from 'react'

import {
  DIRECTORY_LANGUAGES,
  LANGUAGE_LABEL,
  emptyAfterFilter,
  matchesFilter,
  type DirectoryEntry,
  type DirectoryFilter,
} from '@/lib/accountant-directory'
import type { Locale } from '@/lib/i18n/locale'

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e8eaed', borderRadius: 12, padding: 24,
}
const body: React.CSSProperties = { fontSize: 15, lineHeight: 1.7, color: '#5f6368', marginTop: 12 }
const chip = (aan: boolean): React.CSSProperties => ({
  fontSize: 14, fontWeight: 600, borderRadius: 999, padding: '6px 14px', cursor: 'pointer',
  border: `1px solid ${aan ? '#1a73e8' : '#dadce0'}`,
  background: aan ? '#e8f0fe' : '#fff',
  color: aan ? '#1a56c4' : '#3c4043',
})
const veldLabel: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#3c4043', marginBottom: 6,
}

export default function GidsLijst({ entries }: { entries: DirectoryEntry[] }) {
  // Alles uit: de hele lijst. Zie de kop van dit bestand.
  const [taal, setTaal] = useState<Locale | null>(null)
  const [plaats, setPlaats] = useState('')
  const [alleenRuimte, setAlleenRuimte] = useState(false)

  const filter: DirectoryFilter = { language: taal, city: plaats, onlyAccepting: alleenRuimte }
  const zichtbaar = useMemo(
    () => entries.filter((e) => matchesFilter(e, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, taal, plaats, alleenRuimte],
  )
  const gefilterd = taal !== null || plaats.trim().length > 0 || alleenRuimte

  return (
    <>
      <section style={{ ...card, marginTop: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: '0 0 16px' }}>
          Vind een boekhouder die bij jou past
        </h2>

        <div>
          <span style={veldLabel}>Taal</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {/* Staat vooraan en is de beginstand: niets gekozen betekent elk kantoor. */}
            <button type="button" style={chip(taal === null)} onClick={() => setTaal(null)}>
              Alle talen
            </button>
            {DIRECTORY_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                dir="auto"
                style={chip(taal === code)}
                onClick={() => setTaal(taal === code ? null : code)}
              >
                {LANGUAGE_LABEL[code]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={veldLabel} htmlFor="gids-plaats">Plaats</label>
          <input
            id="gids-plaats"
            value={plaats}
            onChange={(e) => setPlaats(e.target.value)}
            placeholder="Bijvoorbeeld Tilburg"
            style={{
              width: '100%', maxWidth: 320, padding: '10px 12px', fontSize: 15,
              border: '1px solid #dadce0', borderRadius: 8, background: '#fff', color: '#202124',
            }}
          />
        </div>

        {/* Hier komt Specialisatie zodra de specialisaties een gesloten lijst zijn — vrije tekst
            filteren zou "horeca", "Horeca" en "horecazaken" tot drie antwoorden maken. */}

        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input
            id="gids-ruimte" type="checkbox" checked={alleenRuimte}
            onChange={(e) => setAlleenRuimte(e.target.checked)}
            style={{ marginTop: 3, width: 18, height: 18 }}
          />
          <label htmlFor="gids-ruimte" style={{ fontSize: 15, color: '#3c4043', lineHeight: 1.6 }}>
            Alleen kantoren die nieuwe klanten aannemen
          </label>
        </div>

        {gefilterd && (
          // Een getal is beter dan een zin: hij ziet meteen hoeveel hij zelf heeft weggefilterd.
          <p style={{ ...body, marginTop: 16 }}>
            {zichtbaar.length} van de {entries.length} kantoren
          </p>
        )}
      </section>

      {zichtbaar.length === 0 ? (
        <section style={{ ...card, marginTop: 12 }}>
          <p style={{ ...body, marginTop: 0 }}>{emptyAfterFilter(filter)}</p>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {zichtbaar.map((entry) => (
            <section key={entry.accountantId} style={card}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
                  {entry.officeName}
                </h2>
                <span style={{ fontSize: 14, color: '#5f6368' }}>{entry.city}</span>
                {entry.acceptingClients ? (
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#137333', background: '#e6f4ea',
                    borderRadius: 999, padding: '2px 10px',
                  }}>
                    Neemt nieuwe klanten aan
                  </span>
                ) : (
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#5f6368', background: '#f1f3f4',
                    borderRadius: 999, padding: '2px 10px',
                  }}>
                    Nu geen ruimte
                  </span>
                )}
              </div>

              {entry.languages.length > 0 && (
                // "zegt" staat er met opzet: wij controleren dit niet, en een chip die klinkt als
                // een keurmerk zou dat wél beweren.
                <p style={{ ...body, marginTop: 8 }}>
                  Dit kantoor zegt je te kunnen helpen in:{' '}
                  {entry.languages.map((code, i) => (
                    <span key={code}>
                      {i > 0 ? ' · ' : ''}
                      <span dir="auto" style={{ color: '#3c4043', fontWeight: 600 }}>{LANGUAGE_LABEL[code]}</span>
                    </span>
                  ))}
                </p>
              )}

              {entry.specialisms.length > 0 && (
                <p style={{ ...body, marginTop: 8 }}>{entry.specialisms.join(' · ')}</p>
              )}

              <p style={{ ...body, marginTop: 8 }}>
                <a href={`mailto:${entry.contactEmail}`} style={{ color: '#1a73e8' }}>
                  {entry.contactEmail}
                </a>
                {entry.website !== null && (
                  <>
                    {' · '}
                    <a href={entry.website} rel="nofollow noopener noreferrer" target="_blank" style={{ color: '#1a73e8' }}>
                      Website
                    </a>
                  </>
                )}
              </p>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
