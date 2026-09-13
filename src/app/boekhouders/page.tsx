// src/app/boekhouders/page.tsx
// [KANTOORGIDS] Kantoren die met BoekBrug werken — de andere richting van [GEEN-PROVISIE].
//
// BoekBrug betaalt geen kantoor voor het aanbrengen van een klant. Dit is waarom dat geen kale
// "nee" is: een ondernemer die zich aanmeldt zonder boekhouder is een lead waar een kantoor
// anders voor betaalt, en die hebben we elke week. Verwijzing die twee kanten op loopt is voor
// een kantoor meer waard dan een deel van een abonnement, en ze kost niets van wat de klant
// betaalt.
//
// DE VOLGORDE IS NIET TE KOOP. sortForOwner() sorteert op precies twee dingen — ruimte voor
// nieuwe klanten, dan naam — en deze pagina leest geen betaalstatus, want de rij heeft er geen.
// Een gids waarvan de bovenste drie regels te koop zijn is een advertentie, en iedereen ziet het
// verschil; op de dag dat dit er een wordt, is de weigering om voor aanbevelingen te betalen een
// formaliteit geworden.
//
// De lijst komt rechtstreeks uit de tabel onder het published-only beleid. Geen route ertussen:
// dat is één plek minder die per ongeluk een niet-gepubliceerde rij kan teruggeven.

import type { Metadata } from 'next'

import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { EMPTY_LIST, normaliseEntry, sortForOwner, type DirectoryEntry } from '@/lib/accountant-directory'
import GidsLijst from './GidsLijst'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Boekhouders die met BoekBrug werken',
  description:
    'Administratiekantoren en boekhouders die BoekBrug gebruiken voor de administratie van hun klanten. ' +
    'Zoek je een boekhouder? Hier staan de kantoren die met ons werken.',
  alternates: { canonical: '/boekhouders' },
  openGraph: { title: 'Boekhouders die met BoekBrug werken', type: 'website' },
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 20px' }
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e8eaed', borderRadius: 12, padding: 24,
}
const body: React.CSSProperties = { fontSize: 15, lineHeight: 1.7, color: '#5f6368', marginTop: 12 }

/** Read the published rows. A failure is stated, never rendered as "er zijn geen kantoren". */
async function loadEntries(): Promise<{ entries: DirectoryEntry[]; unreadable: boolean }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('accountant_directory')
    .select('accountant_id, office_name, city, specialisms, languages, accepting_clients, contact_email, website')
    .eq('published', true)
    .limit(500)

  if (error) return { entries: [], unreadable: true }

  const entries = (data ?? []).map((row) =>
    normaliseEntry({
      accountantId: row.accountant_id,
      officeName: row.office_name,
      city: row.city,
      specialisms: row.specialisms ?? [],
      languages: row.languages ?? [],
      acceptingClients: row.accepting_clients,
      contactEmail: row.contact_email,
      website: row.website,
    }),
  )
  return { entries: sortForOwner(entries), unreadable: false }
}

export default async function BoekhoudersPage() {
  const { entries, unreadable } = await loadEntries()

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa' }}>
      <PublicHeader />
      <main style={{ ...wrap, paddingBlock: 40 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>
          Boekhouders die met BoekBrug werken
        </h1>
        <p style={{ ...body, marginTop: 0 }}>
          Zoek je een boekhouder? Filter op taal en plaats. Kantoren staan hier omdat ze het zelf
          hebben aangezet, en de volgorde is: kantoren met ruimte eerst, daarna op naam. Er is geen
          betaalde plek in deze lijst — die kun je bij ons niet kopen.
        </p>

        {unreadable ? (
          <section style={{ ...card, marginTop: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
              De gids is nu niet te lezen
            </h2>
            <p style={{ ...body }}>
              Er ging iets mis bij het ophalen van de lijst. Dat betekent niet dat er geen kantoren
              zijn — probeer het zo nog eens.
            </p>
          </section>
        ) : entries.length === 0 ? (
          <section style={{ ...card, marginTop: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
              {EMPTY_LIST.heading}
            </h2>
            <p style={{ ...body }}>{EMPTY_LIST.body}</p>
          </section>
        ) : (
          // De filters en de regels staan in een client-component: de lijst is al opgehaald en
          // gesorteerd, dus versmallen hoort geen serverronde te kosten.
          <GidsLijst entries={entries} />
        )}

        <section style={{ ...card, marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
            Werk je op een kantoor?
          </h2>
          <p style={{ ...body }}>
            Het boekhoudersportaal en deze vermelding kosten je niets. Wat BoekBrug voor een kantoor
            doet — en wat het uitdrukkelijk níét doet — staat op{' '}
            <a href="/voor-boekhouders" style={{ color: '#1a73e8' }}>voor boekhouders</a>.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
