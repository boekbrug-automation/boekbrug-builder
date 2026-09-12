'use client'

// src/app/dashboard/control/ControlScherm.tsx
// [CONTROL] Leest alleen. Elk getal hier is geteld, geen enkel getal is geschat.

import type { ControlOverview } from '@/lib/control-overview'

const kaart: React.CSSProperties = {
  background: '#fff', border: '1px solid #e8eaed', borderRadius: 12, padding: 18,
}
const cel: React.CSSProperties = { padding: '10px 12px', fontSize: 13.5, borderTop: '1px solid #f1f3f4' }

function Getal({ label, waarde }: { label: string; waarde: number }) {
  return (
    <div style={kaart}>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#202124', lineHeight: 1.1 }}>{waarde}</div>
      <div style={{ fontSize: 12.5, color: '#5f6368', marginTop: 4 }}>{label}</div>
    </div>
  )
}

export default function ControlScherm({
  overzicht, grantsLeesbaar,
}: { overzicht: ControlOverview; grantsLeesbaar: boolean }) {
  const { rows, counts } = overzicht

  const datum = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  const waarom: Record<string, string> = {
    active: 'betaalt',
    grace_period: 'betaalde periode loopt nog',
    toekenning: 'toekenning',
    boekhouder: 'portaal',
    free: 'gratis',
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px 64px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 4px' }}>Control Center</h1>
      <p style={{ fontSize: 14, color: '#5f6368', margin: '0 0 20px', lineHeight: 1.6 }}>
        Wie er is en wat ze hebben. Dit scherm leest alleen — het verandert niets, en het raakt
        geen boekhouding aan.
      </p>

      {/* [NO-SILENT-EMPTY] Een mislukte lezing is geen nul. */}
      {!grantsLeesbaar && (
        <div style={{
          ...kaart, borderColor: '#F9AB00', background: '#FEF7E0', marginBottom: 16, fontSize: 13.5,
        }}>
          De toekenningen konden niet gelezen worden. Iedereen staat hier daarom op het plan dat
          uit zijn abonnement volgt — dat is niet noodzakelijk wat hij vandaag ziet.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Getal label="Accounts" waarde={counts.total} />
        <Getal label="Gratis" waarde={counts.free} />
        <Getal label="Op een toekenning" waarde={counts.granted} />
        <Getal label="Betalend" waarde={counts.paying} />
        <Getal label="Boekhouders" waarde={counts.accountants} />
      </div>

      <div style={{ ...kaart, marginTop: 20, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'start' }}>
              {['Account', 'Rol', 'Plan', 'Waarom', 'Toekenning tot', 'Sinds'].map((k) => (
                <th key={k} style={{ ...cel, borderTop: 'none', fontSize: 12, color: '#5f6368', fontWeight: 600, textAlign: 'start' }}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...cel, fontWeight: 600, color: '#202124' }}>{r.name}</td>
                <td style={{ ...cel, color: '#5f6368' }}>{r.role}</td>
                <td style={cel}>{r.plan}</td>
                <td style={{ ...cel, color: '#5f6368' }}>{waarom[r.reason] ?? r.reason}</td>
                <td style={{ ...cel, color: '#5f6368' }}>
                  {r.grantOpenEnded ? 'open' : datum(r.grantUntil)}
                </td>
                <td style={{ ...cel, color: '#5f6368' }}>{datum(r.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td style={{ ...cel, color: '#5f6368' }} colSpan={6}>Nog geen accounts.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12.5, color: '#5f6368', marginTop: 14, lineHeight: 1.6 }}>
        Omzet staat hier bewust niet. Betalende accounts × prijs is op de dag dat het geprint
        wordt in twee richtingen onjuist, en het echte getal staat bij Stripe.
      </p>
    </main>
  )
}
