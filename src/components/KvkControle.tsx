'use client'

// src/components/KvkControle.tsx
// [KVK-OPTIONEEL] Zoekt een kvk-nummer op bij de KvK — als die koppeling aanstaat.
//
// Vandaag staat hij dat niet: het Basisprofiel kost een abonnement plus een bedrag per opvraging,
// en er is nog geen sleutel. Dan toont dit component NIETS. Geen grijs vlak, geen "koppeling
// ontbreekt", geen uitroepteken — een ondernemer hoort niet te zien welke integraties wij nog
// niet hebben aangezet, en zeker niet op het scherm waar hij een klant invoert.
//
// De dag dat KVK_API_KEY bestaat, gaat dit vanzelf antwoorden en verandert er aan geen enkel
// scherm iets. Dat is de hele reden dat het er nu al staat.

import { useEffect, useRef, useState } from 'react'

import { isKvkShaped, normaliseKvkNumber, type KvkCompany } from '@/lib/kvk-parse'
import type { Verification } from '@/lib/verification'

type Stand =
  | { soort: 'bezig' }
  | { soort: 'gevonden'; naam: string; plaats: string }
  | { soort: 'onbekend'; zin: string }
  /** De koppeling staat uit — toon niets. */
  | { soort: 'stil' }

export default function KvkControle({ nummer }: { nummer: string }) {
  const [stand, setStand] = useState<Stand | null>(null)
  const beurt = useRef(0)

  const genormaliseerd = normaliseKvkNumber(nummer)
  const vraagbaar = isKvkShaped(nummer)

  useEffect(() => {
    if (!vraagbaar) { beurt.current++; return }
    const mijn = ++beurt.current
    const t = setTimeout(() => {
      void (async () => {
        setStand({ soort: 'bezig' })
        try {
          const res = await fetch(`/api/kvk?nummer=${encodeURIComponent(genormaliseerd)}`)
          const json = (await res.json()) as Verification<KvkCompany> | { error?: string }
          if (mijn !== beurt.current) return
          if (!('outcome' in json)) { setStand({ soort: 'stil' }); return }
          if (json.outcome === 'confirmed') {
            const c = json.data
            setStand({ soort: 'gevonden', naam: c?.tradeName || c?.name || '', plaats: c?.city ?? '' })
            return
          }
          // De koppeling staat uit: dat is geen mededeling voor de ondernemer.
          if (json.outcome === 'unknown' && /koppeling staat niet aan/i.test(json.reason ?? '')) {
            setStand({ soort: 'stil' }); return
          }
          setStand({ soort: 'onbekend', zin: json.reason ?? 'Niet gecontroleerd' })
        } catch {
          if (mijn === beurt.current) setStand({ soort: 'stil' })
        }
      })()
    }, 600)
    return () => clearTimeout(t)
  }, [genormaliseerd, vraagbaar])

  if (!vraagbaar || stand === null || stand.soort === 'stil') return null

  if (stand.soort === 'bezig') {
    return <p style={{ fontSize: 11.5, color: '#5F6368', margin: '4px 0 0' }}>Kvk-nummer opzoeken…</p>
  }
  if (stand.soort === 'gevonden') {
    const wat = [stand.naam, stand.plaats].filter((p) => p !== '').join(' · ')
    return <p style={{ fontSize: 11.5, color: '#137333', margin: '4px 0 0' }}>{wat !== '' ? `KvK: ${wat}` : 'Bekend bij de KvK'}</p>
  }
  return <p style={{ fontSize: 11.5, color: '#5F6368', margin: '4px 0 0' }}>{stand.zin}</p>
}
