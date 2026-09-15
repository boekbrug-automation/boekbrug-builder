'use client'

// src/components/BtwControle.tsx
// [EU-BTW] Controleert een buitenlands EU-btw-nummer bij VIES, terwijl het nog te wijzigen is.
//
// ── WAAROM DIT NIET COSMETISCH IS ──
// Een levering aan een buitenlands bedrijf met een GELDIG btw-nummer is verlegd: 0% op de factuur
// en de klant geeft de btw aan. Klopt het nummer niet, dan was er nooit een 0%-levering en is de
// Nederlandse ondernemer de btw zelf verschuldigd — over een factuur die hij al verstuurd heeft.
// Vandaar dat dit naast het VELD staat en niet op een controlepagina: hier is het nog te repareren.
//
// ── DRIE ANTWOORDEN, NOOIT TWEE ──
// Geldig, niet geldig, en "we konden het niet vragen". VIES vraagt het na bij 27 nationale
// registers en elk daarvan kan plat liggen; dat als "ongeldig" tonen stuurt iemand achter een
// nummer aan dat gewoon klopt. Dit component vult ook niets in — het toont wat VIES zegt.

import { useEffect, useRef, useState } from 'react'

import { euVatShape } from '@/lib/eu-vat-format'
import type { Verification } from '@/lib/verification'
import type { ViesCompany } from '@/lib/vies-parse'

type Stand =
  | { soort: 'bezig' }
  | { soort: 'geldig'; naam: string }
  | { soort: 'ongeldig'; zin: string }
  | { soort: 'onbekend'; zin: string }

export default function BtwControle({ nummer }: { nummer: string }) {
  const [stand, setStand] = useState<Stand | null>(null)
  const beurt = useRef(0)

  // Alleen een BUITENLANDS EU-nummer heeft hier iets te zoeken: voor een Nederlandse klant van
  // een Nederlandse ondernemer speelt de vraag niet, en een waarschuwing onder elke gewone
  // binnenlandse factuur leert mensen waarschuwingen wegklikken.
  const vorm = euVatShape(nummer)
  const vraagbaar = vorm.shape === 'possible' && vorm.country !== 'NL'
  const genormaliseerd = vorm.shape === 'possible' ? vorm.normalised : ''

  useEffect(() => {
    if (!vraagbaar) { beurt.current++; return }
    const mijn = ++beurt.current
    const t = setTimeout(() => {
      void (async () => {
        setStand({ soort: 'bezig' })
        try {
          const res = await fetch(`/api/btw-nummer?nummer=${encodeURIComponent(genormaliseerd)}`)
          const json = (await res.json()) as Verification<ViesCompany> | { error?: string }
          if (mijn !== beurt.current) return
          if (!('outcome' in json)) { setStand({ soort: 'onbekend', zin: 'Niet gecontroleerd' }); return }
          if (json.outcome === 'confirmed') { setStand({ soort: 'geldig', naam: json.data?.name ?? '' }); return }
          if (json.outcome === 'refused') { setStand({ soort: 'ongeldig', zin: json.reason ?? 'VIES kent dit nummer niet' }); return }
          setStand({ soort: 'onbekend', zin: json.reason ?? 'Niet gecontroleerd' })
        } catch {
          if (mijn === beurt.current) setStand({ soort: 'onbekend', zin: 'VIES was niet bereikbaar' })
        }
      })()
    }, 600)
    return () => clearTimeout(t)
  }, [genormaliseerd, vraagbaar])

  if (!vraagbaar || stand === null) return null

  const kleur = stand.soort === 'geldig' ? '#137333' : stand.soort === 'ongeldig' ? '#C5221F' : '#5F6368'
  const tekst =
    stand.soort === 'bezig' ? 'Btw-nummer controleren bij VIES…'
      : stand.soort === 'geldig' ? (stand.naam !== '' ? `Geldig bij VIES — ${stand.naam}` : 'Geldig bij VIES')
        : stand.zin

  return <p style={{ fontSize: 11.5, color: kleur, margin: '4px 0 0', lineHeight: 1.5 }}>{tekst}</p>
}
