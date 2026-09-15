'use client'

// src/app/dashboard/grootboek/GrootboekJaarClient.tsx
// [GROOTBOEK-KAART] Which year, and then the ledger for it.
//
// The year lives here rather than in the panel because the panel is what the render test drives,
// and a component that picks its own year is one the test cannot pin.

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import GrootboekKaart from '@/components/grootboek/GrootboekKaart'

function GrootboekJaar() {
  // [BOEKHOUDER-DOET] Dezelfde dubbelpad-route als JaarClient: een gemachtigde boekhouder opent
  // het grootboek van een KLANT met ?clientId=…, en zonder die parameter is het het eigen
  // grootboek van de ondernemer. De autorisatie zit in de route (resolveQuarterOwner); dit scherm
  // geeft de parameter alleen door en beslist niets.
  const clientId = useSearchParams().get('clientId')

  // The current year from the BROWSER's clock: the administration belongs to the owner's calendar,
  // not to the server's timezone ([EEN-KLOK]).
  const [year, setYear] = useState<number>(() => new Date().getFullYear())

  return (
    <main style={{ padding: 16, display: 'grid', gap: 16 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Boekjaar
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((back) => {
            const y = new Date().getFullYear() - back
            return <option key={y} value={y}>{y}</option>
          })}
        </select>
      </label>
      <GrootboekKaart year={year} clientId={clientId} />
    </main>
  )
}

/**
 * useSearchParams needs a Suspense boundary in the app router; without one the whole route opts
 * out of static rendering with a build-time warning and the screen renders empty on first paint.
 */
export default function GrootboekJaarClient() {
  return (
    <Suspense fallback={null}>
      <GrootboekJaar />
    </Suspense>
  )
}
