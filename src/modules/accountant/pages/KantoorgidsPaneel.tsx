'use client'

// src/modules/accountant/pages/KantoorgidsPaneel.tsx
// [KANTOORGIDS] Het kantoor vult zelf in wat er in de gids staat, en zet het zelf aan.
//
// PUBLICEREN IS EEN HANDELING. Er staat niets in de gids omdat een kantoor zich heeft aangemeld:
// het typt wat het getoond wil hebben en zet het aan, en kan het weer uitzetten of weghalen. Naam,
// plaats en e-mailadres zijn van het kantoor, niet van ons — een boekhouder die een vermelding
// ontdekt die hij nooit heeft gemaakt, is een boekhouder die vertrekt.
//
// De regels staan in accountant-directory.ts en gelden hier, in de route en in de database. Dit
// scherm laat ze alleen zien: entryProblems() geeft de zinnen, en die staan bij het veld dat de
// boekhouder moet aanpassen — "er klopt iets niet" laat iemand zoeken, en wie op een formulier
// moet zoeken komt niet terug.

import { useCallback, useEffect, useState } from 'react'

import { DIRECTORY_LANGUAGES, LIMITS, entryProblems, normaliseEntry } from '@/lib/accountant-directory'
import { LOCALE_META } from '@/lib/i18n/locale'
// [SERVER-ZIN] Een code is geen zin: wat de route stuurt gaat hier langs failureText, dat een
// Nederlandse zin doorlaat en een machinewoord vervangt door wat dit scherm zelf zegt.
import { failureText } from '@/lib/server-message'

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e8eaed', borderRadius: 12, padding: 24, maxWidth: 720,
}
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#3c4043', marginBottom: 4,
}
const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #dadce0',
  borderRadius: 8, background: '#fff', color: '#202124',
}
const veld: React.CSSProperties = { marginTop: 16 }
const hint: React.CSSProperties = { fontSize: 13, color: '#5f6368', marginTop: 6, lineHeight: 1.6 }
const knop: React.CSSProperties = {
  padding: '10px 18px', fontSize: 15, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
  border: '1px solid #1a73e8', background: '#1a73e8', color: '#fff',
}
const knopUit: React.CSSProperties = { ...knop, background: '#fff', color: '#1a73e8' }

export default function KantoorgidsPaneel() {
  const [officeName, setOfficeName] = useState('')
  const [city, setCity] = useState('')
  const [specialisms, setSpecialisms] = useState('')
  const [acceptingClients, setAcceptingClients] = useState(false)
  const [contactEmail, setContactEmail] = useState('')
  const [website, setWebsite] = useState('')
  // [KANTOORGIDS-TAAL] Begint leeg, en blijft leeg tot het kantoor zelf aanvinkt. Geen enkele taal
  // staat voorgeselecteerd — ook Nederlands niet: "nog niet gezegd" en "zei Nederlands" zijn twee
  // verschillende antwoorden, en het tweede is niet aan ons om in te vullen.
  const [languages, setLanguages] = useState<string[]>([])
  const [published, setPublished] = useState(false)

  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [problemen, setProblemen] = useState<string[]>([])
  const [fout, setFout] = useState<string | null>(null)
  const [gelukt, setGelukt] = useState<string | null>(null)

  useEffect(() => {
    let levend = true
    ;(async () => {
      try {
        const res = await fetch('/api/kantoorgids')
        const json = await res.json().catch(() => null)
        if (!levend) return
        if (!res.ok) {
          setFout(failureText(res.status, json, 'Je vermelding is niet te lezen.'))
          return
        }
        if (json?.entry) {
          setOfficeName(json.entry.officeName ?? '')
          setCity(json.entry.city ?? '')
          setSpecialisms((json.entry.specialisms ?? []).join(', '))
          setAcceptingClients(json.entry.acceptingClients === true)
          setContactEmail(json.entry.contactEmail ?? '')
          setWebsite(json.entry.website ?? '')
          setLanguages(Array.isArray(json.entry.languages) ? json.entry.languages : [])
        }
        setPublished(json?.published === true)
      } catch {
        if (levend) setFout('Je vermelding is niet te lezen.')
      } finally {
        if (levend) setLaden(false)
      }
    })()
    return () => { levend = false }
  }, [])

  const huidig = useCallback(
    () =>
      normaliseEntry({
        accountantId: 'zelf',
        officeName,
        city,
        specialisms: specialisms.split(','),
        acceptingClients,
        contactEmail,
        website,
        languages,
      }),
    [officeName, city, specialisms, acceptingClients, contactEmail, website, languages],
  )

  const bewaar = async (wilPubliceren: boolean) => {
    setBezig(true); setFout(null); setGelukt(null); setProblemen([])

    // Dezelfde controle als de route, vóór het versturen — zodat het kantoor de zin bij het veld
    // ziet in plaats van na een rondje langs de server.
    //
    // Alleen bij publiceren: een concept mag zo onaf zijn als het wil. De taalcontrole die ÓÓK
    // voor een concept geldt (een onbekende code) staat in de route, want dit scherm kan er geen
    // maken — het biedt vier vinkjes en geen tekstveld.
    if (wilPubliceren) {
      const lokaal = entryProblems(huidig())
      if (lokaal.length > 0) { setProblemen(lokaal); setBezig(false); return }
    }

    try {
      const res = await fetch('/api/kantoorgids', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeName, city,
          specialisms: specialisms.split(','),
          acceptingClients, contactEmail, website,
          languages,
          published: wilPubliceren,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        if (Array.isArray(json?.problems) && json.problems.length > 0) setProblemen(json.problems)
        else setFout(failureText(res.status, json, 'Opslaan is niet gelukt.'))
        return
      }
      setPublished(json?.published === true)
      setGelukt(json?.published === true
        ? 'Je kantoor staat in de gids.'
        : 'Opgeslagen. Je staat niet in de gids.')
    } catch {
      setFout('Opslaan is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const haalWeg = async () => {
    setBezig(true); setFout(null); setGelukt(null); setProblemen([])
    try {
      const res = await fetch('/api/kantoorgids', { method: 'DELETE' })
      if (!res.ok) { setFout('Verwijderen is niet gelukt.'); return }
      setPublished(false)
      setGelukt('Je vermelding is weggehaald.')
    } catch {
      setFout('Verwijderen is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>
        Je kantoor in de gids
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, color: '#5f6368', maxWidth: 720, margin: '0 0 20px' }}>
        Ondernemers die zich bij BoekBrug aanmelden zonder boekhouder krijgen deze lijst te zien.
        Je staat er alleen in als je hem aanzet, en je kunt hem altijd weer uitzetten. Er is geen
        betaalde plek in de lijst: kantoren met ruimte staan bovenaan, daarna op naam.
      </p>

      <div style={card}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: published ? '#137333' : '#5f6368',
          background: published ? '#e6f4ea' : '#f1f3f4',
          display: 'inline-block', borderRadius: 999, padding: '4px 12px',
        }}>
          {laden ? 'Bezig met laden…' : published ? 'Je staat in de gids' : 'Je staat niet in de gids'}
        </div>

        <div style={veld}>
          <label style={label} htmlFor="kantoornaam">Naam van je kantoor</label>
          <input id="kantoornaam" style={input} value={officeName} maxLength={LIMITS.officeName}
                 onChange={(e) => setOfficeName(e.target.value)} disabled={laden} />
        </div>

        <div style={veld}>
          <label style={label} htmlFor="plaats">Plaats</label>
          <input id="plaats" style={input} value={city} maxLength={LIMITS.city}
                 onChange={(e) => setCity(e.target.value)} disabled={laden} />
        </div>

        <div style={veld}>
          <label style={label} htmlFor="specialisaties">Waar ben je aan gewend? (maximaal zes, komma ertussen)</label>
          <input id="specialisaties" style={input} value={specialisms}
                 onChange={(e) => setSpecialisms(e.target.value)} disabled={laden}
                 placeholder="zzp, transport, horeca" />
          <p style={hint}>Dit is geen keurmerk en wordt door ons niet gecontroleerd — het staat er zoals jij het typt.</p>
        </div>

        {/*
          [KANTOORGIDS-TAAL] Vinkjes en geen tekstveld, en dat is de hele reden dat dit werkt:
          "Arabisch", "arabic", "العربية" en "AR" zijn vier waarden voor één taal, en een
          ondernemer die zijn eigen taal zoekt zou te horen krijgen dat er geen kantoor is terwijl
          er drie zitten. Een gesloten lijst kan dat niet.
        */}
        <fieldset style={{ ...veld, border: 0, margin: 0, padding: 0 }}>
          <legend style={{ ...label, padding: 0 }}>In welke talen kun je ondernemers helpen?</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
            {DIRECTORY_LANGUAGES.map((taal) => (
              <label key={taal} htmlFor={`taal-${taal}`}
                     style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, color: '#3c4043' }}>
                <input id={`taal-${taal}`} type="checkbox" disabled={laden}
                       checked={languages.includes(taal)}
                       onChange={(e) => setLanguages((was) =>
                         e.target.checked
                           ? (was.includes(taal) ? was : [...was, taal])
                           : was.filter((t) => t !== taal))}
                       style={{ width: 18, height: 18 }} />
                {/* De taal in zijn eigen naam, net als in de taalkiezer — niet vertaald. */}
                <span>{LOCALE_META[taal].label}</span>
              </label>
            ))}
          </div>
          <p style={hint}>
            Nodig om in de gids te staan: kies er minstens één. Dit is wat jij zegt, wij
            controleren het niet.
          </p>
        </fieldset>

        <div style={veld}>
          <label style={label} htmlFor="mail">E-mailadres waarop ondernemers je mogen benaderen</label>
          <input id="mail" style={input} type="email" value={contactEmail} maxLength={LIMITS.contactEmail}
                 onChange={(e) => setContactEmail(e.target.value)} disabled={laden} />
          <p style={hint}>Dit adres staat openbaar op de gids. Gebruik je kantooradres, niet je inlogadres.</p>
        </div>

        <div style={veld}>
          <label style={label} htmlFor="site">Website (mag leeg)</label>
          <input id="site" style={input} value={website} maxLength={LIMITS.website}
                 onChange={(e) => setWebsite(e.target.value)} disabled={laden}
                 placeholder="https://" />
        </div>

        <div style={{ ...veld, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input id="ruimte" type="checkbox" checked={acceptingClients} disabled={laden}
                 onChange={(e) => setAcceptingClients(e.target.checked)}
                 style={{ marginTop: 3, width: 18, height: 18 }} />
          <label htmlFor="ruimte" style={{ fontSize: 15, color: '#3c4043', lineHeight: 1.6 }}>
            Ik neem nieuwe klanten aan. Kantoren die dit aanvinken staan bovenaan.
          </label>
        </div>

        {problemen.length > 0 && (
          <ul style={{
            margin: '18px 0 0', paddingInlineStart: 20, fontSize: 14, lineHeight: 1.8, color: '#c5221f',
          }}>
            {problemen.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {fout !== null && (
          <p style={{ marginTop: 18, fontSize: 14, color: '#c5221f' }}>{fout}</p>
        )}
        {gelukt !== null && (
          <p style={{ marginTop: 18, fontSize: 14, color: '#137333' }}>{gelukt}</p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
          <button type="button" style={knop} disabled={laden || bezig} onClick={() => bewaar(true)}>
            {published ? 'Bijwerken' : 'Zet mij in de gids'}
          </button>
          {published && (
            <button type="button" style={knopUit} disabled={laden || bezig} onClick={() => bewaar(false)}>
              Haal mij uit de gids
            </button>
          )}
          {!published && (
            <button type="button" style={knopUit} disabled={laden || bezig} onClick={() => bewaar(false)}>
              Alleen opslaan
            </button>
          )}
          <button type="button" style={{ ...knopUit, borderColor: '#dadce0', color: '#5f6368' }}
                  disabled={laden || bezig} onClick={haalWeg}>
            Alles verwijderen
          </button>
        </div>
      </div>
    </div>
  )
}
