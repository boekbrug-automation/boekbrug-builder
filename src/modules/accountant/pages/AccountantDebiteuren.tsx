'use client'

// src/modules/accountant/pages/AccountantDebiteuren.tsx
// [DEBITEUREN] Waar staat het geld van mijn klanten — het scherm.
//
// WAT DIT SCHERM PROBEERT TE ZIJN
// De ochtendlijst van een boekhouder. Niet "hier zijn acht administraties", maar "hier staat geld
// stil, bij wie, en hoe lang al". Vandaar de volgorde: oudste schuld bovenaan, niet het grootste
// bedrag. Een factuur van €120 uit januari is een slechter teken dan één van €4.000 van vorige
// week, en dit scherm bestaat om het eerste soort te vinden voordat het oninbaar wordt.
//
// WAAROM ONBRUIKBARE RIJEN BLIJVEN STAAN
// Een rij die vandaag niet gemaild kan worden verdwijnt niet. "Er staan drie facturen open bij
// deze klant en geen ervan kan vandaag herinnerd worden" is iets anders dan "er staat niets open",
// en een bord dat alleen knoppen toont vertelt het eerste als het tweede. De reden staat er dus
// bij, in een zin — nooit een grijze knop zonder uitleg.
//
// EN DE ZIN DIE HIER NIET WEG MAG
// Aan de andere kant van elke knop zit een klant van de ONDERNEMER, geen gebruiker van ons. De
// boekhouder mailt in diens naam en de relatie die eronder lijdt is diens relatie. Daarom staat er
// boven de lijst dat de ondernemer bericht krijgt van elke herinnering die hier uitgaat.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { boardTotals, type DebtorGroup, type DebtorRow } from '@/lib/accountant-debtors'
import VraagMachtiging, { type KoppelKlant } from './VraagMachtiging'
import { failureText } from '@/lib/server-message'
// [TAAL] This screen holds no language of its own: every sentence comes from messages.ts.
import { translator, type Translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'

/** Eén rij, met het extra veld dat de pagina meegeeft om de grijze knop te kunnen uitleggen. */
export interface SchermRij extends DebtorRow {
  paused: boolean
}

export interface SchermGroep extends Omit<DebtorGroup, 'rows'> {
  rows: SchermRij[]
}

interface Props {
  groepen: SchermGroep[]
  /** Geen enkele klant heeft deze boekhouder gemachtigd — een ander verhaal dan "niets openstaand". */
  geenMandaat?: boolean
  /** [VRAAG-MACHTIGING] De GEKOPPELDE klanten — om te kunnen vragen wat er nog niet is. */
  gekoppeld?: KoppelKlant[]
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// [TAAL] The wording is a key per branch, so the translator is handed in — a module-level helper
// cannot call a hook, and the decision itself is about the number, not about the language.
function dagenZin(d: number, t: Translator): string {
  if (d <= 0) return t('bh.deb.dagen.vandaag')
  if (d === 1) return t('bh.deb.dagen.een')
  if (d < 60) return t('bh.deb.dagen.dagen', { dagen: d })
  const maanden = Math.floor(d / 30)
  return t('bh.deb.dagen.maanden', { maanden })
}

/** Hoe erger, hoe roder. Alleen als signaal — het getal ernaast is de waarheid. */
function kleurVoor(dagen: number): string {
  if (dagen >= 60) return M3.error
  if (dagen >= 30) return M3.warning
  return M3.onSurfaceVariant
}

export default function AccountantDebiteuren({ groepen, geenMandaat = false, gekoppeld = [] }: Props) {
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<Record<string, string>>({})
  const [fout, setFout] = useState<Record<string, string>>({})

  const totalen = boardTotals(groepen)

  async function herinner(rij: SchermRij, klantId: string) {
    const id = rij.invoice.id
    setBezig(id)
    setFout((f) => ({ ...f, [id]: '' }))
    try {
      const res = await fetch(`/api/invoice/${id}/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namens_klant_id: klantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(failureText(res.status, data, t('bh.deb.fout.herinneringMislukt')))
      setKlaar((k) => ({ ...k, [id]: t('bh.deb.status.verstuurd') }))
      // Ververs de server-data: het spoor is veranderd, dus de volgende beurt van deze rij ook.
      router.refresh()
    } catch (e) {
      setFout((f) => ({ ...f, [id]: e instanceof Error ? e.message : t('bh.deb.fout.algemeen') }))
    } finally {
      setBezig(null)
    }
  }

  const kaart: React.CSSProperties = {
    background: M3.surface,
    border: `1px solid ${M3.outlineVariant}`,
    borderRadius: R.lg,
    boxShadow: EL1,
  }

  // ── Nog niemand heeft je gemachtigd ────────────────────────────────────────
  if (geenMandaat) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          {t('bh.deb.titel')}
        </h1>
        <div style={{ ...kaart, padding: 20 }}>
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            {t('bh.deb.geenMandaat.kop')}
          </p>
          <p style={{ margin: 0, color: M3.onSurfaceVariant, lineHeight: 1.6, fontSize: 14.5 }}>
            {/* [KANTOOR-RUST] One sentence: where the client switches it on. */}
            {t('bh.deb.geenMandaat.uitleg1')}{' '}
            {/* Het pad staat er zoals het op het scherm van de KLANT staat. Dat is een bewuste
                uitzondering op "een zin noemt de knop zoals hij geschreven staat": die knop staat
                hier op het scherm van een ANDER, van wie wij de taal niet weten. Nederlands is dan
                het enige antwoord dat niemand naar een woord stuurt dat nergens staat. */}
            <strong>{'Instellingen → Jouw boekhouder'}</strong>{/* [TAAL-DB] */}
            {t('bh.deb.geenMandaat.uitleg2')}
          </p>
          <VraagMachtiging klanten={gekoppeld} kind="facturen" />
        </div>
      </main>
    )
  }

  // ── Alles betaald ──────────────────────────────────────────────────────────
  if (groepen.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          {t('bh.deb.titel')}
        </h1>
        <div style={{ ...kaart, padding: 20 }}>
          <p style={{ margin: 0, color: M3.onSurface, lineHeight: 1.6 }}>
            {t('bh.deb.leeg.allesBetaald')}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        {t('bh.deb.titel')}
      </h1>
      <p style={{ margin: '0 0 16px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        {t('bh.deb.ondertitel')}
      </p>

      {/* ── De ene regel bovenaan ────────────────────────────────────────── */}
      <section style={{ ...kaart, padding: 18, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 26, fontWeight: 500, color: M3.onSurface }}>
          {euro(totalen.outstanding)}
        </p>
        {/* [TAAL] One key per count combination: a noun that has to agree with a number is not a
            parameter — Arabic and Turkish inflect around it. */}
        <p style={{ margin: '4px 0 0', fontSize: 14, color: M3.onSurfaceVariant }}>
          {totalen.invoices === 1
            ? totalen.clients === 1
              ? t('bh.deb.totaal.enkelEnkel', { facturen: totalen.invoices, klanten: totalen.clients })
              : t('bh.deb.totaal.enkelMeer', { facturen: totalen.invoices, klanten: totalen.clients })
            : totalen.clients === 1
              ? t('bh.deb.totaal.meerEnkel', { facturen: totalen.invoices, klanten: totalen.clients })
              : t('bh.deb.totaal.meerMeer', { facturen: totalen.invoices, klanten: totalen.clients })}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, color: M3.mutedText, lineHeight: 1.6 }}>
          {totalen.remindable === 0
            ? t('bh.deb.totaal.geenHerinnerbaar')
            : totalen.remindable === 1
              ? t('bh.deb.totaal.herinnerbaarEen', { aantal: totalen.remindable })
              : t('bh.deb.totaal.herinnerbaarMeer', { aantal: totalen.remindable })}{' '}
          {t('bh.deb.totaal.namensKlant')}
        </p>
      </section>

      {/* ── Per klant ────────────────────────────────────────────────────── */}
      {groepen.map((groep) => (
        <section key={groep.clientId} style={{ ...kaart, padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: M3.onSurface, margin: 0 }}>
              {groep.clientName}
            </h2>
            <span style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface }}>
              {euro(groep.totalOutstanding)}
            </span>
          </div>
          <p style={{ margin: '2px 0 14px', fontSize: 12.5, color: kleurVoor(groep.worstDaysLate) }}>
            {t('bh.deb.groep.oudste')} {dagenZin(groep.worstDaysLate, t)}
          </p>

          {groep.rows.map((rij) => {
            const id = rij.invoice.id
            const isKlaar = Boolean(klaar[id])
            const magNu = rij.verdict.allowed && !isKlaar
            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: `1px solid ${M3.outlineVariant}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, color: M3.onSurface }}>
                    {rij.invoice.client_name || t('bh.deb.rij.onbekendeAfnemer')}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: kleurVoor(rij.daysLate) }}>
                    {rij.invoice.invoice_number || '—'} · {dagenZin(rij.daysLate, t)}
                    {(rij.invoice.reminder_count ?? 0) > 0 &&
                      ` · ${
                        rij.invoice.reminder_count === 1
                          ? t('bh.deb.rij.herinneringEen', { aantal: 1 })
                          : t('bh.deb.rij.herinneringMeer', { aantal: rij.invoice.reminder_count ?? 0 })
                      }`}
                  </p>
                  {/* De reden waarom er geen knop staat. Nooit een grijze knop zonder zin. */}
                  {!rij.verdict.allowed && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.mutedText, lineHeight: 1.5 }}>
                      {rij.verdict.reason}
                    </p>
                  )}
                  {fout[id] && (
                    <p role="alert" style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.error, lineHeight: 1.5 }}>
                      {fout[id]}
                    </p>
                  )}
                  {isKlaar && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: M3.success }}>{klaar[id]}</p>
                  )}
                </div>

                <div style={{ textAlign: 'end', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: M3.onSurface }}>
                    {euro(rij.outstanding)}
                  </p>
                  {magNu && (
                    <button
                      type="button"
                      onClick={() => herinner(rij, groep.clientId)}
                      disabled={bezig === id}
                      style={{
                        marginTop: 6,
                        padding: '6px 12px',
                        background: 'none',
                        border: `1px solid ${M3.primary}`,
                        borderRadius: R.full,
                        color: M3.primary,
                        fontSize: 12.5,
                        cursor: bezig === id ? 'default' : 'pointer',
                        opacity: bezig === id ? 0.5 : 1,
                      }}
                    >
                      {bezig === id ? t('bh.deb.knop.bezig') : t('bh.deb.knop.herinner')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}
      {/* [KANTOOR-RUST] No footer explaining an absent button: the row whose cap is reached says
          why in its own verdict.reason (sales-overview.ts), and nowhere else. */}
    </main>
  )
}
