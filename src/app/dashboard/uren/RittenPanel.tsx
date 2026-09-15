'use client'

// src/app/dashboard/uren/RittenPanel.tsx
// [RITTEN] The kilometre log, beside the hours — because it is written in the same moment.
//
// It lives on /dashboard/uren rather than behind a door of its own: driving to a customer and
// working there are one afternoon, and a second place to go would be a second thing to remember.
// [KORTE-WEG] — fewer doors, not more screens.
//
// What it shows at the top is the year, in two numbers the owner does not otherwise have: the
// business kilometres, and what they are worth as a deduction at the statutory rate for that year.
// Underneath, what a customer still owes for travel that reached no invoice.
//
// [TAAL] No sentence lives in this file; every word comes from the catalogue.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { localeDir } from '@/lib/i18n/locale'
import { dateShort } from '@/lib/i18n/format-date'
import { amsterdamToday, formatEuroNL } from '@/lib/format-nl'
import { failureText } from '@/lib/server-message'
import { useToast } from '@/components/ui/Toast'
import { useDialog } from '@/components/ui/Dialog'
import DateFieldNL from '@/components/ui/DateFieldNL'
import {
  mileageYear, tripValue, isBusiness, isUninvoiced, groupBillableTrips, SUGGESTED_KM_RATE,
  type MileageEntry,
} from '@/lib/ritten'

const M3 = { primary: '#1A73E8', neutral: '#5F6368', outline: '#DADCE0', surfaceVariant: '#F1F3F4', warning: '#B26A00' }
const R = { sm: 8, md: 14 }
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

export interface RitClientCard { id: string; name: string }

type Form = {
  id: string | null
  client_id: string
  driven_on: string
  from_place: string
  to_place: string
  purpose: string
  kilometers: string
  rate_per_km: string
  business: boolean
}

// [TZ] amsterdamToday, never toISOString(): a trip written at 00:30 belongs to today in the
// owner's calendar, and the date is what places it in a book year.
const emptyForm = (): Form => ({
  id: null, client_id: '', driven_on: amsterdamToday(),
  from_place: '', to_place: '', purpose: '', kilometers: '',
  // The statutory rate is the one number nobody remembers, so it is offered — and it is only an
  // offer: what the customer pays is an agreement, and the field stays editable.
  rate_per_km: String(SUGGESTED_KM_RATE).replace('.', ','),
  business: true,
})

export default function RittenPanel({
  clients, initialEntries, initialFailed = false,
}: {
  clients: RitClientCard[]
  /** Rows to render without fetching. The render gate hands these in; the screen fetches. */
  initialEntries?: MileageEntry[]
  initialFailed?: boolean
}) {
  const locale = useLocale()
  const t = translator(locale)
  const dir = localeDir(locale)
  const router = useRouter()
  const toast = useToast()
  const dialog = useDialog()

  const [entries, setEntries] = useState<MileageEntry[]>(initialEntries ?? [])
  const [loaded, setLoaded] = useState(initialEntries !== undefined)
  const [failed, setFailed] = useState(initialFailed)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const year = Number(amsterdamToday().slice(0, 4))

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ritten?year=${year}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) { setFailed(true); return }
      setEntries((json.entries ?? []) as MileageEntry[]); setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [year])

  useEffect(() => {
    if (initialEntries !== undefined) return
    let cancelled = false
    void (async () => { if (!cancelled) await load() })()
    return () => { cancelled = true }
  }, [load, initialEntries])

  const stand = useMemo(() => mileageYear({ entries, year }), [entries, year])
  const klaar = useMemo(() => groupBillableTrips(entries), [entries])
  const nameOf = useCallback(
    (id: string | null | undefined) => clients.find((c) => c.id === id)?.name ?? t('ritten.veld.geenKlant'),
    [clients, t],
  )

  async function save() {
    if (!form) return
    setBusy(true)
    try {
      const payload = {
        id: form.id ?? undefined,
        client_id: form.client_id || null,
        driven_on: form.driven_on,
        from_place: form.from_place,
        to_place: form.to_place,
        purpose: form.purpose,
        kilometers: form.kilometers.replace(',', '.'),
        rate_per_km: form.rate_per_km.trim() === '' ? null : form.rate_per_km.replace(',', '.'),
        business: form.business,
      }
      const res = await fetch('/api/ritten', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast(failureText(res.status, json, t('ritten.fout.opslaan')), { tone: 'error' }); return }
      setForm(null)
      await load()
    } catch {
      toast(t('ritten.fout.opslaan'), { tone: 'error' })
    } finally { setBusy(false) }
  }

  async function remove(entry: MileageEntry) {
    const sure = await dialog.confirm({
      title: t('ritten.verwijderen.vraag'),
      message: t('ritten.verwijderen.uitleg'),
      confirmLabel: t('ritten.verwijderen'),
      cancelLabel: t('ritten.annuleren'),
      danger: true,
    })
    if (!sure) return
    setBusy(true)
    try {
      const res = await fetch(`/api/ritten?id=${encodeURIComponent(entry.id ?? '')}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast(failureText(res.status, json, t('ritten.fout.verwijderenMislukt')), { tone: 'error' }); return }
      await load()
    } catch {
      toast(t('ritten.fout.verwijderenMislukt'), { tone: 'error' })
    } finally { setBusy(false) }
  }

  /**
   * One customer's unbilled travel into a concept invoice.
   *
   * Only the ids travel. The SERVER builds the lines from the stored trips and stamps them in the
   * same request, so the invoice and "these kilometres are billed" are one outcome instead of two
   * — see the [RITTEN-EENMALIG] block in /api/invoice/draft.
   */
  async function invoice(clientId: string, ids: string[]) {
    setBusy(true)
    try {
      const res = await fetch('/api/invoice/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mileage_entry_ids: ids,
          client_id: clientId,
          client_name: nameOf(clientId),
          invoice_date: amsterdamToday(),
          lines: [],
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.invoiceId) {
        toast(failureText(res.status, json, t('ritten.fout.factuur')), { tone: 'error' })
        await load()
        return
      }
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      toast(t('ritten.fout.factuur'), { tone: 'error' })
    } finally { setBusy(false) }
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: M3.neutral, marginBottom: 4, textAlign: 'start' }
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
    fontFamily: FONT, fontSize: 14, boxSizing: 'border-box', textAlign: 'start',
  }

  return (
    <div dir={dir} data-testid="ritten">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setForm(emptyForm())} disabled={busy} style={{
          padding: '10px 16px', borderRadius: R.sm, border: 'none', background: M3.primary,
          color: '#fff', fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>{t('ritten.nieuw')}</button>
      </div>

      {/* [NO-SILENT-EMPTY] A failed read is said out loud: an empty log and a broken database are
          opposite answers, and the deduction hangs on this number. */}
      {failed && (
        <div style={{
          background: '#FFF8E1', borderInlineStart: `3px solid ${M3.warning}`, borderRadius: R.sm,
          padding: '10px 14px', marginBottom: 12, fontSize: 13, textAlign: 'start',
        }}>{t('ritten.fout.laden')}</div>
      )}

      {form && (
        <div style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div>
              <label style={label} htmlFor="rit-datum">{t('ritten.veld.datum')}</label>
              <DateFieldNL id="rit-datum" value={form.driven_on} style={input}
                onChange={(v) => setForm({ ...form, driven_on: v })} />
            </div>
            <div>
              <label style={label} htmlFor="rit-van">{t('ritten.veld.vertrek')}</label>
              <input id="rit-van" value={form.from_place} style={input}
                onChange={(e) => setForm({ ...form, from_place: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="rit-naar">{t('ritten.veld.bestemming')}</label>
              <input id="rit-naar" value={form.to_place} style={input}
                onChange={(e) => setForm({ ...form, to_place: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="rit-km">{t('ritten.veld.kilometers')}</label>
              <input id="rit-km" inputMode="decimal" value={form.kilometers} style={input}
                onChange={(e) => setForm({ ...form, kilometers: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="rit-klant">{t('ritten.veld.klant')}</label>
              <select id="rit-klant" value={form.client_id} style={input}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">{t('ritten.veld.geenKlant')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {/* A rate belongs to a trip that is charged on. On a private trip the field is not
                emptied — the owner may flip the tick back — it simply stops asking. */}
            {form.business && (
              <div>
                <label style={label} htmlFor="rit-tarief">{t('ritten.veld.tarief')}</label>
                <input id="rit-tarief" inputMode="decimal" value={form.rate_per_km} style={input}
                  onChange={(e) => setForm({ ...form, rate_per_km: e.target.value })} />
                <span style={{ fontSize: 11, color: M3.neutral, display: 'block', marginTop: 4, textAlign: 'start' }}>
                  {t('ritten.veld.tariefHint')}
                </span>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label} htmlFor="rit-doel">{t('ritten.veld.doel')}</label>
            <input id="rit-doel" value={form.purpose} style={input}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, textAlign: 'start' }}>
            <input type="checkbox" checked={form.business} disabled={busy}
              onChange={(e) => setForm({ ...form, business: e.target.checked })} />
            <span>{t('ritten.zakelijk')}
              <span style={{ display: 'block', fontSize: 11, color: M3.neutral }}>{t('ritten.zakelijkHint')}</span>
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={save} disabled={busy} style={{
              padding: '10px 16px', borderRadius: R.sm, border: 'none', background: M3.primary,
              color: '#fff', fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>{busy ? t('ritten.bezig') : t('ritten.opslaan')}</button>
            <button type="button" onClick={() => setForm(null)} disabled={busy} style={{
              padding: '10px 16px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
              background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 14, cursor: 'pointer',
            }}>{t('ritten.annuleren')}</button>
          </div>
        </div>
      )}

      {/* The year. Only once there are trips: two zeroes at rest say nothing. */}
      {stand.trips > 0 && (
        <section style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16, marginBottom: 12, textAlign: 'start' }}>
          <div style={{ fontFamily: FONT_NUM, fontSize: 20, fontWeight: 600 }}>
            {t('ritten.jaar.km', { km: stand.businessKm.toLocaleString('nl-NL'), jaar: year })}
          </div>
          <div style={{ fontSize: 13, color: M3.neutral, marginTop: 2 }}>
            {t('ritten.jaar.aftrek', {
              bedrag: formatEuroNL(stand.deduction),
              tarief: formatEuroNL(stand.rate),
            })}
          </div>
          <div style={{ fontSize: 12, color: M3.neutral, marginTop: 6 }}>{t('ritten.jaar.zelfBoeken')}</div>
          {stand.unbilledValue > 0 && (
            <div style={{ fontSize: 13, marginTop: 8 }}>
              {t('ritten.jaar.teFactureren', { bedrag: formatEuroNL(stand.unbilledValue) })}
            </div>
          )}
          {stand.unbilledWithoutRate > 0 && (
            <div style={{ fontSize: 12, color: M3.warning, marginTop: 4 }}>
              {stand.unbilledWithoutRate === 1
                ? t('ritten.zonderTarief.een')
                : t('ritten.zonderTarief.meer', { n: stand.unbilledWithoutRate })}
            </div>
          )}
        </section>
      )}

      {/* Ready to invoice. Only what a customer can actually be billed for: not yet invoiced,
          business, priced, and belonging to a customer. */}
      {klaar.map((g) => (
        <section key={g.clientId ?? 'geen'} style={{
          background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16, marginBottom: 12, textAlign: 'start',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{nameOf(g.clientId)}</div>
            <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 600, textAlign: 'end' }}>
              {formatEuroNL(g.value)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: M3.neutral, marginTop: 2 }}>
            {t('ritten.klaar')} · {g.kilometers.toLocaleString('nl-NL')} {t('ritten.kmKort')}
          </div>
          <button type="button" disabled={busy}
            onClick={() => invoice(g.clientId as string, g.trips.map((r) => r.id ?? '').filter(Boolean))}
            style={{
              marginTop: 12, padding: '10px 16px', borderRadius: R.sm, border: 'none', background: M3.primary,
              color: '#fff', fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>{t('ritten.maakFactuur')}</button>
        </section>
      ))}

      {loaded && !failed && entries.length === 0 && (
        <div style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 24, textAlign: 'start' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{t('ritten.leeg.titel')}</div>
          <div style={{ fontSize: 14, color: M3.neutral }}>{t('ritten.leeg.uitleg')}</div>
        </div>
      )}

      {entries.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, background: '#fff', borderRadius: R.md, boxShadow: EL1 }}>
          {entries.map((e) => {
            const value = tripValue(e)
            return (
              <li key={e.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline',
                padding: '12px 16px', borderTop: `1px solid ${M3.surfaceVariant}`, flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 220px', textAlign: 'start' }}>
                  <div style={{ fontSize: 14 }}>{e.from_place} → {e.to_place}</div>
                  <div style={{ fontSize: 12, color: M3.neutral, marginTop: 2 }}>
                    {dateShort(e.driven_on ?? '', locale)} · {e.kilometers} {t('ritten.kmKort')} · {nameOf(e.client_id)}
                  </div>
                  <div style={{ fontSize: 12, color: M3.neutral }}>{e.purpose}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 14, fontWeight: 600 }}>
                    {value === null ? '—' : formatEuroNL(value)}
                  </div>
                  {!isBusiness(e) && <div style={{ fontSize: 11, color: M3.neutral }}>{t('ritten.prive')}</div>}
                  {!isUninvoiced(e) && <div style={{ fontSize: 11, color: M3.neutral }}>{t('ritten.opFactuur')}</div>}
                </div>
                {isUninvoiced(e) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" disabled={busy} onClick={() => setForm({
                      id: e.id ?? null, client_id: e.client_id ?? '', driven_on: e.driven_on ?? amsterdamToday(),
                      from_place: e.from_place ?? '', to_place: e.to_place ?? '', purpose: e.purpose ?? '',
                      kilometers: String(e.kilometers ?? ''),
                      rate_per_km: e.rate_per_km === null || e.rate_per_km === undefined ? '' : String(e.rate_per_km).replace('.', ','),
                      business: isBusiness(e),
                    })} style={{
                      padding: '6px 10px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
                      background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
                    }}>{t('ritten.bewerken')}</button>
                    <button type="button" disabled={busy} onClick={() => remove(e)} style={{
                      padding: '6px 10px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
                      background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
                    }}>{t('ritten.verwijderen')}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
