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

import {
  DIRECTORY_LANGUAGES, LANGUAGE_LABEL, LIMITS, entryProblems, normaliseEntry,
  type DirectoryProblem,
} from '@/lib/accountant-directory'
import type { Locale } from '@/lib/i18n/locale'
// [SERVER-ZIN] Een code is geen zin: wat de route stuurt gaat hier langs failureText, dat een
// Nederlandse zin doorlaat en een machinewoord vervangt door wat dit scherm zelf zegt.
import { failureText, serverSentence } from '@/lib/server-message'
// [TAAL] Een component houdt geen eigen taal. De boekhouder is een ingelogde gebruiker met een
// eigen taalinstelling — de eerste kantoren op dit product lezen Arabisch — en dit is precies het
// scherm waarop een Nederlandse foutmelding het verschil is tussen een formulier dat hij afmaakt
// en een dat hij laat staan.
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import { useLocale } from '@/lib/i18n/use-locale'

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

// [TAAL] Een MELDING is een sleutel, geen zin — behalve wanneer de server er zelf een stuurde, en
// dan IS die zin het antwoord.
//
// Waarom niet gewoon t() aanroepen op het moment van zetten: dan staat de zin er in de taal van
// tóén. Zet de boekhouder daarna zijn taal om en er staat nog steeds de oude, want het laad-effect
// draait niet opnieuw — dat hoort maar één keer te draaien. De sleutel bewaren en pas bij het
// renderen vertalen lost allebei op, en het is dezelfde vorm die `problemen` al heeft.
//
// Buiten de component, omdat het niets van de component nodig heeft: binnenin is het elke render
// een nieuwe functie, en dan wil de dependency-regel hem in het laad-effect hebben — dat effect
// zou dan bij iedere render opnieuw gaan ophalen.
type Melding = { soort: 'sleutel'; sleutel: MessageKey } | { soort: 'server'; tekst: string }
const sleutel = (k: MessageKey): Melding => ({ soort: 'sleutel', sleutel: k })

export default function KantoorgidsPaneel() {
  const locale = useLocale()
  const t = translator(locale)
  const [officeName, setOfficeName] = useState('')
  const [city, setCity] = useState('')
  const [specialisms, setSpecialisms] = useState('')
  const [languages, setLanguages] = useState<Locale[]>([])
  const [acceptingClients, setAcceptingClients] = useState(false)
  const [contactEmail, setContactEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [published, setPublished] = useState(false)

  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  // [TAAL] Sleutels, geen zinnen: entryProblems geeft message-keys terug en dit scherm rendert ze.
  // Als string[] zou een willekeurige string hier langs de vertaler glippen en als sleutel op het
  // scherm belanden — 'gids.eis.naam' onder een veld is erger dan Nederlands onder een veld.
  const [problemen, setProblemen] = useState<DirectoryProblem[]>([])
  const zegMaar = (m: Melding): string => (m.soort === 'sleutel' ? t(m.sleutel) : m.tekst)
  const [fout, setFout] = useState<Melding | null>(null)
  const [gelukt, setGelukt] = useState<Melding | null>(null)

  useEffect(() => {
    let levend = true
    ;(async () => {
      try {
        const res = await fetch('/api/kantoorgids')
        const json = await res.json().catch(() => null)
        if (!levend) return
        if (!res.ok) {
          // Een zin van de server is al een zin en gaat er zo in; is er geen, dan onthouden we
          // onze eigen sleutel en vertaalt het scherm hem straks in de taal van dat moment.
          const zin = serverSentence(res.status, json)
          setFout(zin === null ? sleutel('gids.fout.lezen') : { soort: 'server', tekst: zin })
          return
        }
        if (json?.entry) {
          setOfficeName(json.entry.officeName ?? '')
          setCity(json.entry.city ?? '')
          setSpecialisms((json.entry.specialisms ?? []).join(', '))
          setLanguages(Array.isArray(json.entry.languages) ? json.entry.languages : [])
          setAcceptingClients(json.entry.acceptingClients === true)
          setContactEmail(json.entry.contactEmail ?? '')
          setWebsite(json.entry.website ?? '')
        }
        setPublished(json?.published === true)
      } catch {
        if (levend) setFout(sleutel('gids.fout.lezen'))
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
        languages,
        acceptingClients,
        contactEmail,
        website,
      }),
    [officeName, city, specialisms, languages, acceptingClients, contactEmail, website],
  )

  const bewaar = async (wilPubliceren: boolean) => {
    setBezig(true); setFout(null); setGelukt(null); setProblemen([])

    // Dezelfde controle als de route, vóór het versturen — zodat het kantoor de zin bij het veld
    // ziet in plaats van na een rondje langs de server.
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
          languages,
          acceptingClients, contactEmail, website,
          published: wilPubliceren,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        if (Array.isArray(json?.problems) && json.problems.length > 0) setProblemen(json.problems)
        else setFout({ soort: 'server', tekst: failureText(res.status, json, t('gids.fout.opslaan')) })
        return
      }
      setPublished(json?.published === true)
      setGelukt(sleutel(json?.published === true ? 'gids.opgeslagen.in' : 'gids.opgeslagen.uit'))
    } catch {
      setFout(sleutel('gids.fout.opslaan'))
    } finally {
      setBezig(false)
    }
  }

  const haalWeg = async () => {
    setBezig(true); setFout(null); setGelukt(null); setProblemen([])
    try {
      const res = await fetch('/api/kantoorgids', { method: 'DELETE' })
      if (!res.ok) { setFout(sleutel('gids.fout.verwijderen')); return }
      setPublished(false)
      setGelukt(sleutel('gids.weg'))
    } catch {
      setFout(sleutel('gids.fout.verwijderen'))
    } finally {
      setBezig(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>
        {t('gids.titel')}
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, color: '#5f6368', maxWidth: 720, margin: '0 0 20px' }}>
        {t('gids.uitleg')} {t('gids.uitleg.volgorde')}
      </p>

      <div style={card}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: published ? '#137333' : '#5f6368',
          background: published ? '#e6f4ea' : '#f1f3f4',
          display: 'inline-block', borderRadius: 999, padding: '4px 12px',
        }}>
          {laden ? t('gids.staat.laden') : published ? t('gids.staat.in') : t('gids.staat.uit')}
        </div>

        <div style={veld}>
          <label style={label} htmlFor="kantoornaam">{t('gids.veld.naam')}</label>
          <input id="kantoornaam" style={input} value={officeName} maxLength={LIMITS.officeName}
                 onChange={(e) => setOfficeName(e.target.value)} disabled={laden} />
        </div>

        <div style={veld}>
          <label style={label} htmlFor="plaats">{t('gids.veld.plaats')}</label>
          <input id="plaats" style={input} value={city} maxLength={LIMITS.city}
                 onChange={(e) => setCity(e.target.value)} disabled={laden} />
        </div>

        <div style={veld}>
          <label style={label} htmlFor="specialisaties">{t('gids.veld.specialisaties')}</label>
          <input id="specialisaties" style={input} value={specialisms}
                 onChange={(e) => setSpecialisms(e.target.value)} disabled={laden}
                 placeholder={t('gids.veld.specialisaties.voorbeeld')} />
          <p style={hint}>{t('gids.veld.specialisaties.hint')}</p>
        </div>

        <div style={veld}>
          {/* [KANTOORGIDS-TAAL] Vakjes en geen tekstveld, en dat is geen smaakkwestie: op vrije
              tekst kan niet gefilterd worden — "Arabisch", "arabic" en "العربية" zouden drie talen
              zijn. De lijst is precies wat BoekBrug zelf spreekt, dus we bieden nooit een taal aan
              waarin het product een klant niet kan bedienen. */}
          <span style={label}>{t('gids.veld.talen')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 2 }}>
            {DIRECTORY_LANGUAGES.map((cd) => (
              <label key={cd} htmlFor={`taal-${cd}`}
                     style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 15, color: '#3c4043' }}>
                <input
                  id={`taal-${cd}`} type="checkbox" disabled={laden}
                  checked={languages.includes(cd)}
                  onChange={(e) => setLanguages(
                    e.target.checked ? [...languages, cd] : languages.filter((x) => x !== cd),
                  )}
                  style={{ width: 18, height: 18 }}
                />
                <span dir="auto">{LANGUAGE_LABEL[cd]}</span>
              </label>
            ))}
          </div>
          <p style={hint}>{t('gids.veld.talen.hint')}</p>
        </div>

        <div style={veld}>
          <label style={label} htmlFor="mail">{t('gids.veld.mail')}</label>
          <input id="mail" style={input} type="email" value={contactEmail} maxLength={LIMITS.contactEmail}
                 onChange={(e) => setContactEmail(e.target.value)} disabled={laden} />
          <p style={hint}>{t('gids.veld.mail.hint')}</p>
        </div>

        <div style={veld}>
          <label style={label} htmlFor="site">{t('gids.veld.site')}</label>
          <input id="site" style={input} value={website} maxLength={LIMITS.website}
                 onChange={(e) => setWebsite(e.target.value)} disabled={laden}
                 placeholder="https://" />
        </div>

        <div style={{ ...veld, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input id="ruimte" type="checkbox" checked={acceptingClients} disabled={laden}
                 onChange={(e) => setAcceptingClients(e.target.checked)}
                 style={{ marginTop: 3, width: 18, height: 18 }} />
          <label htmlFor="ruimte" style={{ fontSize: 15, color: '#3c4043', lineHeight: 1.6 }}>
            {t('gids.veld.ruimte')}
          </label>
        </div>

        {problemen.length > 0 && (
          <ul style={{
            margin: '18px 0 0', paddingInlineStart: 20, fontSize: 14, lineHeight: 1.8, color: '#c5221f',
          }}>
            {problemen.map((p) => <li key={p}>{t(p)}</li>)}
          </ul>
        )}
        {fout !== null && (
          <p style={{ marginTop: 18, fontSize: 14, color: '#c5221f' }}>{zegMaar(fout)}</p>
        )}
        {gelukt !== null && (
          <p style={{ marginTop: 18, fontSize: 14, color: '#137333' }}>{zegMaar(gelukt)}</p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
          <button type="button" style={knop} disabled={laden || bezig} onClick={() => bewaar(true)}>
            {published ? t('gids.knop.bijwerken') : t('gids.knop.aanzetten')}
          </button>
          {published && (
            <button type="button" style={knopUit} disabled={laden || bezig} onClick={() => bewaar(false)}>
              {t('gids.knop.uitzetten')}
            </button>
          )}
          {!published && (
            <button type="button" style={knopUit} disabled={laden || bezig} onClick={() => bewaar(false)}>
              {t('gids.knop.opslaan')}
            </button>
          )}
          <button type="button" style={{ ...knopUit, borderColor: '#dadce0', color: '#5f6368' }}
                  disabled={laden || bezig} onClick={haalWeg}>
            {t('gids.knop.verwijderen')}
          </button>
        </div>
      </div>
    </div>
  )
}
