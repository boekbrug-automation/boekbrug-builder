'use client'

// src/components/AdresZoeker.tsx
// [ADRES-ECHT] Postcode + huisnummer → straat en plaats, van het Kadaster. Eén component, overal.
//
// ── WAAROM ÉÉN COMPONENT EN NIET DRIE KEER DEZELFDE useEffect ──
// Omdat een adres op vijf schermen wordt ingevuld (nieuwe factuur, klant, klantdetail, gratis
// factuur, instellingen) en het gedrag op alle vijf hetzelfde HOORT te zijn. Drie kopieën worden
// drie verschillende afrondingen van dezelfde regel, en de vierde vergeet de belangrijkste.
//
// ── DE REGEL DIE DIT AFDWINGT ──
// Het register VULT NIETS ZELF IN. Het stelt voor, en de eigenaar tikt "Overnemen".
//
// Dat is geen beleefdheid: het adres staat op de factuur, en een factuur zonder het juiste adres
// van beide partijen is er wettelijk geen. Als wij een straat overschrijven en die blijkt de
// verkeerde, dan is dat ONZE fout op ZIJN document. Bovendien kent het BAG "Gebouw C" en
// "t.a.v. de heer De Vries" niet, en dat is precies wat een pakket op de goede plek krijgt.
//
// Een MISLUKTE lezing vult dus ook niets in en zegt gewoon dat er niet gekeken kon worden — nooit
// "dit adres bestaat niet", want dat is een ander bericht met een andere volgende stap.

import { useCallback, useEffect, useRef, useState } from 'react'

import { normalisePostcode, splitHouseNumber, type DutchAddress } from '@/lib/dutch-address'
import type { Verification } from '@/lib/verification'

export interface AdresZoekerProps {
  postcode: string
  huisnummer: string
  /** Wat de eigenaar nu in het straatveld heeft staan — om te kunnen zeggen of het afwijkt. */
  straat: string
  plaats: string
  /** Alleen aangeroepen als de eigenaar op Overnemen tikt. Nooit vanzelf. */
  onOvernemen: (adres: DutchAddress) => void
}

type Stand =
  | { soort: 'stil' }
  | { soort: 'bezig' }
  | { soort: 'gevonden'; adres: DutchAddress }
  | { soort: 'niets'; zin: string }

export default function AdresZoeker({ postcode, huisnummer, straat, plaats, onOvernemen }: AdresZoekerProps) {
  const [stand, setStand] = useState<Stand>({ soort: 'stil' })
  // Elke lezing krijgt een nummer; alleen het antwoord op de LAATSTE mag het scherm halen. Zonder
  // dit overschrijft een traag antwoord op "42" het snelle antwoord op "44" — en dan staat er een
  // adres dat bij geen enkele invoer hoort.
  const beurt = useRef(0)

  const zoek = useCallback(async (pc: string, nr: number) => {
    const mijn = ++beurt.current
    setStand({ soort: 'bezig' })
    try {
      const res = await fetch(`/api/adres?postcode=${encodeURIComponent(pc)}&huisnummer=${nr}`)
      const json = (await res.json()) as Verification<DutchAddress> | { error?: string }
      if (mijn !== beurt.current) return
      if (!('outcome' in json)) { setStand({ soort: 'niets', zin: 'Niet gecontroleerd' }); return }
      if (json.outcome === 'confirmed' && json.data) { setStand({ soort: 'gevonden', adres: json.data }); return }
      setStand({ soort: 'niets', zin: json.reason ?? 'Niet gecontroleerd' })
    } catch {
      if (mijn === beurt.current) setStand({ soort: 'niets', zin: 'Het adressenregister was niet bereikbaar' })
    }
  }, [])

  // Afgeleid tijdens het renderen, niet opgeslagen. Dat is geen stijl: een setState in de BODY
  // van een effect laat React opnieuw renderen voordat het scherm er stond, en de linter weigert
  // het terecht. Wat "nog niet genoeg ingevuld" is, is een functie van de props — dus lees het.
  const pc = normalisePostcode(postcode)
  const { number: nr } = splitHouseNumber(huisnummer)
  const klaar = pc !== '' && nr > 0

  useEffect(() => {
    // Niet genoeg om te vragen: de lopende beurt ongeldig maken en verder niets doen. Geen
    // setState hier — het scherm leest `klaar` zelf.
    if (!klaar) { beurt.current++; return }
    // Wachten tot het typen ophoudt: anders staat er een lezing per toetsaanslag op een gratis
    // publieke dienst waar we niets voor betalen.
    const t = setTimeout(() => { void zoek(pc, nr) }, 500)
    return () => clearTimeout(t)
  }, [pc, nr, klaar, zoek])

  if (!klaar || stand.soort === 'stil') return null

  // Een antwoord dat bij een VORIGE invoer hoort, hoort niet op het scherm. Zonder deze regel
  // staat er een halve seconde lang het adres van huisnummer 42 boven een veld waar 44 staat —
  // en dat is precies het moment waarop iemand op Overnemen tikt.
  if (stand.soort === 'gevonden' && (stand.adres.postcode !== pc || stand.adres.houseNumber !== nr)) {
    return <p style={{ fontSize: 13, color: '#5F6368', margin: '6px 0 0' }}>Adres opzoeken…</p>
  }

  if (stand.soort === 'bezig') {
    return <p style={{ fontSize: 13, color: '#5F6368', margin: '6px 0 0' }}>Adres opzoeken…</p>
  }

  if (stand.soort === 'niets') {
    return <p style={{ fontSize: 13, color: '#5F6368', margin: '6px 0 0' }}>{stand.zin}</p>
  }

  const gelijk = (a: string, b: string) =>
    a.trim().toLocaleLowerCase('nl').replace(/\s+/g, '') === b.trim().toLocaleLowerCase('nl').replace(/\s+/g, '')
  const alGelijk = gelijk(straat, stand.adres.street) && gelijk(plaats, stand.adres.city)

  // Staat het er al goed, dan is een knop ruis: het scherm bevestigt en houdt verder zijn mond.
  if (alGelijk) {
    return (
      <p style={{ fontSize: 13, color: '#137333', margin: '6px 0 0' }}>
        Gecontroleerd bij het BAG-register
      </p>
    )
  }

  return (
    <div style={{
      margin: '6px 0 0', padding: '10px 12px', background: '#E8F0FE',
      border: '1px solid #1A73E8', borderRadius: 8, fontSize: 13.5, lineHeight: 1.6,
    }}>
      <span style={{ color: '#174EA6' }}>
        Het register kent dit als <strong>{stand.adres.street} {stand.adres.houseNumber}</strong>
        {stand.adres.addition !== '' ? `-${stand.adres.addition}` : ''} in <strong>{stand.adres.city}</strong>.
      </span>
      <button
        type="button"
        onClick={() => onOvernemen(stand.adres)}
        style={{
          marginInlineStart: 10, padding: '4px 12px', fontSize: 13, fontWeight: 600,
          border: '1px solid #1A73E8', borderRadius: 980, background: '#fff',
          color: '#1A73E8', cursor: 'pointer',
        }}
      >
        Overnemen
      </button>
    </div>
  )
}
