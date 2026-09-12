'use client'

// src/app/dashboard/klanten/KlantenClient.tsx
// [BOEK-029] Client component — profile always passed from server wrapper
// Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter, useSearchParams } from 'next/navigation'
import { countryNameNl } from '@/lib/client-country'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
import { M3, R, STICKY_BELOW_HEADER, PAGE_HEADER_HEIGHT, columnInner, COLUMN } from '@/lib/design/tokens'
// [FOCUS-KOP] Where a deep-linked row must come to rest — see the header of that file.
import { landRowUnderChrome } from '@/lib/focus-scroll'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { ProfileRow } from '@/types/rows'
// [SMART-FILTER] Accent-insensitieve fold ("Café" ↔ "cafe") — één gedeelde,
// null-veilige bron voor alle pagina's (src/lib/search.ts).
import { foldText } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
import AdresZoeker from '@/components/AdresZoeker'
import BtwControle from '@/components/BtwControle'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [TEKST-SELECTIE] Een sleep die tekst selecteert is geen tik op de rij: de kaart klapte
// open en dicht terwijl de eigenaar een factuurnummer probeerde te kopiëren.
import { onRowTap } from '@/lib/row-tap'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const FONT = "'Roboto', -apple-system, sans-serif"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

interface Client {
  id: string; name: string; email: string | null
  kvk_number: string | null; btw_number: string | null; iban: string | null
  address: string | null; postal_code: string | null; city: string | null
  created_at: string
  // [BESTE] Optional: absent on an installation behind on clients_term_phone.sql.
  phone?: string | null
  payment_term_days?: number | null
  // [KLANT-LAND] ISO code (client_country.sql); absent on an installation behind on it.
  country?: string | null
  /** [TARIEF-KLANT] The rate agreed with this customer, ex btw. */
  default_hourly_rate?: number | null
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const EMPTY = { name: '', email: '', kvk_number: '', btw_number: '', iban: '', address: '', postal_code: '', city: '', country: '', phone: '', payment_term_days: '', default_hourly_rate: '' }

/** The form as it starts for an existing customer: every null shown as an empty field. */
function formFor(client: Client): typeof EMPTY {
  return {
    name:        client.name,
    email:       client.email       ?? '',
    kvk_number:  client.kvk_number  ?? '',
    btw_number:  client.btw_number  ?? '',
    iban:        client.iban        ?? '',
    address:     client.address     ?? '',
    postal_code: client.postal_code ?? '',
    city:        client.city        ?? '',
    country:     client.country     ?? '',
    phone:       client.phone       ?? '',
    payment_term_days: client.payment_term_days == null ? '' : String(client.payment_term_days),
    default_hourly_rate: client.default_hourly_rate == null ? '' : String(client.default_hourly_rate),
  }
}

// Avatar color from name
function avatarColor(name: string) {
  const colors = ['#1A73E8','#00897B','#7B1FA2','#E37400','#E53935','#039BE5']
  return colors[name.charCodeAt(0) % colors.length]
}

export default function KlantenClient({ profile, openByClient = null }: {
  profile: ProfileRow
  // [BESTE] What each customer still owes, keyed by client id — counted by the server through
  // summarise(), the app's one definition of openstaand. Null when that read failed: then no
  // customer wears an amount, rather than every customer wearing a zero.
  openByClient?: Record<string, number> | null
}) {
  const t = translator(useLocale())
  const router   = useRouter()
  const supabase = createClient()

  // [SEARCH] Deep-link focus from the global search (?focus={clientId}) — scroll,
  // expand and briefly highlight the matching client card.
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  // [BESTE] The customer card's own "Gegevens bewerken" lands here with ?bewerk={clientId}: the form
  // opens pre-filled once the list is loaded, the same form the pencil on the row opens.
  const bewerkId = searchParams.get('bewerk')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // [FOCUS-KOP] The sticky controls bar, measured live rather than assumed.
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  const dialog = useDialog()
  // [MOTION] The app-wide snackbar. Bound to the name the call sites already
  // used, so the seven showToast(...) calls below are unchanged.
  const showToast = useToast()
  const [clients, setClients]       = useState<Client[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)  // [BOEK-029] edit mode
  const [form, setForm]             = useState(EMPTY)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // [TAAL] The effect moved BELOW the declaration it calls. It sat above it for months without
  // complaint — a function declaration hoists, so it worked — but the React compiler refuses the
  // order now that this component compiles (adding the translator binding un-bailed it), and the
  // compiler is right: an effect reading a binding declared later cannot be updated correctly if
  // that binding ever becomes reactive.
  // `loading` begint als true, dus de mount hoeft hem niet nogmaals te zetten — en de compiler
  // weigert een synchrone setState in een effect terecht. De ene her-lader (na opslaan, r. 150)
  // zet de spinner zelf, vóór de aanroep.
  async function loadClients() {
    const { data } = await supabase.from('clients').select('*').eq('user_id', profile.id).order('name')
    setClients(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    // Zelfde vorm als settings/page.tsx: de async functie IN het effect, met elke setState pas
    // ná een await. De compiler keurt een aanroep van een buiten het effect gedeclareerde functie
    // conservatief af (hij kan er niet in kijken); deze vorm bewijst wat hij wil weten.
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('clients').select('*').eq('user_id', profile.id).order('name')
      if (!alive) return
      setClients(data ?? [])
      setLoading(false)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [SEARCH] Accent-insensitive filter across the full customer record — not just
  // name/email (KVK, BTW, IBAN, city, address are all findable now).
  // [PERF] Gememoïseerd: zonder useMemo werden tot 7 velden per klant bij ELKE
  // render opnieuw gefold (ook bij het openklappen van een kaart of een toast).
  const filtered = useMemo(() => {
    const q = foldText(search.trim())
    if (!q) return clients
    return clients.filter(c =>
      foldText(c.name).includes(q) ||
      foldText(c.email).includes(q) ||
      foldText(c.kvk_number).includes(q) ||
      foldText(c.btw_number).includes(q) ||
      foldText(c.iban).includes(q) ||
      foldText(c.city).includes(q) ||
      foldText(c.address).includes(q)
    )
  }, [clients, search])

  // [SEARCH] Reveal the ?focus= client once the list has loaded.
  useEffect(() => {
    if (!focusId || loading) return
    if (!clients.some(c => c.id === focusId)) return
    // De onthulling hoort bij dezelfde beweging als het scrollen: binnen de wikkel draait
    // ze in dezelfde tick, maar telt ze niet als synchrone setState in de effect-body.
    void (async () => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    })()
    // [FOCUS-KOP] Op de kop van de rij, niet op het midden ervan. Zie lib/focus-scroll.ts:
    // een uitgeklapte kaart centreren zet zijn bovenkant boven de rand van het scherm.
    const scrollTimer = setTimeout(() => {
      landRowUnderChrome(rowRefs.current[focusId], toolbarRef.current, PAGE_HEADER_HEIGHT)
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
  }, [focusId, loading, clients])

  async function handleSave() {
    if (!form.name.trim()) { setError(t('kl.naamVerplicht')); return }
    setSaving(true); setError(null)

    // [ACTING-FOR] Beide schrijfacties lopen nu via de server.
    //
    // De insert zette `user_id: profile.id` — de INGELOGDE mens. Dat klopt zolang dat de
    // eigenaar is, en is fout zodra een verkoopmedewerker dit scherm gebruikt: zijn klant zou
    // onder zijn eigen (lege) administratie belanden. De server bepaalt nu onder wie de klant
    // valt en noteert in created_by wie hem invoerde; voor een eigenaar is dat dezelfde rij als
    // voorheen. De update kreeg dezelfde behandeling — die had alleen .eq('id'), zonder enige
    // controle op wiens klant het was; RLS ving dat af, maar nu staat het er ook met zoveel woorden.
    const payload = {
      name: form.name.trim(),
      email: form.email || null, kvk_number: form.kvk_number || null,
      btw_number: form.btw_number || null, iban: form.iban || null,
      address: form.address || null, postal_code: form.postal_code || null, city: form.city || null,
      country: form.country || null,
      phone: form.phone || null, payment_term_days: form.payment_term_days || null,
      default_hourly_rate: form.default_hourly_rate || null,
    }
    const res = await fetch('/api/clients', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(failureText(res.status, json, t('ss.opslaanMislukt'))); setSaving(false); return
    }
    showToast(editingId ? t('kl.bijgewerkt') : t('kl.toegevoegd'))

    setForm(EMPTY); setShowForm(false); setEditingId(null)
    setLoading(true)
    await loadClients()
    setSaving(false)
  }

  // [BOEK-029] Open form pre-filled with client data
  function handleEdit(client: Client) {
    setForm(formFor(client))
    setEditingId(client.id)
    setShowForm(true)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // [BESTE] The deep link from the customer card. Same body as handleEdit, written out because a
  // function declared in the component is not a stable effect dependency.
  useEffect(() => {
    if (!bewerkId || loading) return
    const client = clients.find(c => c.id === bewerkId)
    if (!client) return
    // Same wrapper as the ?focus= effect above: one tick, not a synchronous setState in the body.
    void (async () => {
      setForm(formFor(client))
      setEditingId(client.id)
      setShowForm(true)
      setError(null)
    })()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [bewerkId, loading, clients])

  async function handleDelete(id: string) {
    // [MOTION] Was window.confirm('Klant verwijderen?') — a browser box that
    // named neither the client nor the consequence.
    const client = clients.find(c => c.id === id)
    const ok = await dialog.confirm({
      title: t('kl.verwijderVraag'),
      message: t('kl.verwijderUitleg', { name: client?.name ?? t('kl.dezeKlant') }),
      confirmLabel: t('lijst.verwijderen'),
      danger: true,
    })
    if (!ok) return
    // [NO-SILENT-EMPTY] Het resultaat werd weggegooid: een geweigerde of offline delete kreeg
    // tóch "Klant verwijderd" en de rij kwam bij het volgende bezoek onverklaard terug.
    // [BESTE] Through the server door, which refuses when invoices stand on this customer — the
    // browser delete used to leave those invoices pointing at a row that no longer existed.
    try {
      const res = await fetch(`/api/clients?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        showToast(failureText(res.status, json, t('kl.verwijderenMislukt')))
        return
      }
    } catch {
      showToast(t('kl.verwijderenMislukt'))
      return
    }
    setClients(prev => prev.filter(c => c.id !== id))
    showToast(t('kl.verwijderd'))
  }


  // `as const` op de sleutels: daardoor weet TypeScript dat f.key een veld van het
  // formulier is, in plaats van een willekeurige string die een cast nodig heeft.
  // [TAAL] The placeholders stay Dutch on purpose: they are FORMAT examples (a Dutch postcode,
  // KVK number, IBAN, street), not words — see the header of the 'nieuw' block in messages.ts.
  const FIELDS = [
    { key: 'name',        label: t('kl.veld.naam'),  placeholder: t('kl.veld.naamHint'), required: true },
    { key: 'email',       label: t('nieuw.bevestig.email'), placeholder: 'info@bedrijf.nl' },
    { key: 'kvk_number',  label: t('kl.veld.kvk'),   placeholder: '12345678' },
    { key: 'btw_number',  label: t('kl.veld.btw'),   placeholder: 'NL123456789B01' },
    { key: 'iban',        label: 'IBAN',             placeholder: 'NL91ABNA0417164300' },
    { key: 'address',     label: t('nieuw.klant.adres'),    placeholder: 'Straatnaam 1' },
    { key: 'postal_code', label: t('nieuw.klant.postcode'), placeholder: '1234 AB' },
    { key: 'city',        label: t('nieuw.klant.stad'),     placeholder: 'Amsterdam' },
    // [KLANT-LAND] The ISO code, two letters. It decides the 0%-guard at the send door and the
    // country line on a foreign customer's invoice; empty reads as the Netherlands.
    { key: 'country',     label: t('kl.veld.land'),         placeholder: 'NL' },
    // [BESTE] Phone and the agreed payment term. The term pre-fills the due date on a new invoice
    // for this customer; empty means the app default.
    { key: 'phone',       label: t('kl.veld.telefoon'),     placeholder: '06 12345678' },
    { key: 'payment_term_days', label: t('kl.veld.termijn'), placeholder: '30' },
    // [TARIEF-KLANT] Het tarief van deze klant. Vult straks het lege tariefveld bij zijn uren.
    { key: 'default_hourly_rate', label: t('kl.veld.uurtarief'), placeholder: '95' },
  ] as const

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Controls toolbar ── [SUBNAV] back + "Mijn klanten" title come from the
          shared sub-page header; this block keeps the "Nieuw" + search controls,
          sticking directly below the shared bar. */}
      <div ref={toolbarRef} style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px 10px', position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 40,
      }}>
        {/* [BAR-ALIGN] The shell spans the viewport (blur + hairline), the
            CONTENT does not: without this column the search field ran the full
            width of the screen and "Nieuw" sat against the far right edge, both
            of them hundreds of pixels away from the klantenlijst they belong to.
            Same width as <main> below. */}
        <div style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => { setShowForm(p => !p); setError(null) }}
              style={{ background: M3.primaryContainer, color: M3.onPrimaryContainer, border: 'none', borderRadius: R.full, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>person_add</span>
              {t('best.nieuw')}
            </button>
          </div>

          {/* Material You search bar */}
          <div style={{ position: 'relative' }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#5F6368' }} aria-hidden>search</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              aria-label={t('kl.zoek.aria')}
              placeholder={t('kl.zoek')}
              style={{ width: '100%', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: search ? '10px 40px 10px 40px' : '10px 16px 10px 40px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface }}
            />
            {/* [SMART-FILTER] Wissen-knop — alleen zichtbaar zodra er iets getypt is. */}
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label={t('lijst.zoek.wissen')}
                style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', borderRadius: R.full, padding: 4, cursor: 'pointer', color: '#5F6368', display: 'flex', alignItems: 'center', fontFamily: FONT }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>close</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '12px 16px 80px' }}>

        {/* Add form — Material You card */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: R.lg, padding: '20px 16px', boxShadow: EL1, marginBottom: 14, border: `1px solid ${M3.primaryContainer}` }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 16, fontFamily: FONT }}>
              {editingId ? t('kl.bewerken') : t('kl.nieuweKlant')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FIELDS.map(f => (
                <div key={f.key}>
                  <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 4, fontWeight: 500 }}>{f.label}</p>
                  <input
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{ width: '100%', borderRadius: R.md, border: `2px solid ${form[f.key] ? M3.primary : M3.outline}`, padding: '12px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface, transition: 'border-color 0.15s' }}
                  />
                  {/* [ADRES-ECHT] Onder het plaatsveld, want dan staan alle drie de velden er al.
                      Het register stelt voor; de eigenaar tikt Overnemen. */}
                  {f.key === 'btw_number' && <BtwControle nummer={form.btw_number} />}
                  {f.key === 'city' && (
                    <AdresZoeker
                      postcode={form.postal_code}
                      huisnummer={form.address.replace(/^\D+/, '')}
                      straat={form.address.replace(/\s*\d.*$/, '')}
                      plaats={form.city}
                      onOvernemen={(adres) => setForm(p => ({
                        ...p,
                        address: `${adres.street} ${adres.houseNumber}${adres.addition ? `-${adres.addition}` : ''}`,
                        postal_code: `${adres.postcode.slice(0, 4)} ${adres.postcode.slice(4)}`,
                        city: adres.city,
                      }))}
                    />
                  )}
                </div>
              ))}
            </div>
            {error && <p style={{ fontSize: 12, color: M3.error, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setShowForm(false); setForm(EMPTY); setEditingId(null) }}
                style={{ flex: 1, padding: '12px', borderRadius: R.full, border: 'none', background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                {t('lijst.annuleren')}
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '12px', borderRadius: R.full, border: 'none', background: saving ? M3.surfaceVariant : M3.primary, color: saving ? '#80868b' : '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                {saving ? t('kl.opslaanBezig') : editingId ? t('kl.bijwerken') : t('kl.opslaan')}
              </button>
            </div>
          </div>
        )}

        {/* Client list */}
        {loading ? <SkeletonList /> : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#C4C7C5', display: 'block', marginBottom: 12 }} aria-hidden>people</span>
            <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 4, fontFamily: FONT }}>
              {search ? t('kl.geenResultaten') : t('kl.leeg')}
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>
              {search ? t('kl.geenGevonden', { query: search }) : t('kl.voegEersteToe')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(client => {
              const expanded = expandedId === client.id
              const bg = avatarColor(client.name)
              return (
                <div
                  key={client.id}
                  ref={el => { rowRefs.current[client.id] = el }}
                  style={{
                    borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1,
                    outline: highlightId === client.id ? `2px solid ${M3.primary}` : '2px solid transparent',
                    outlineOffset: 2, transition: 'outline-color 0.3s',
                  }}
                >
                  {/* Main row */}
                  <div onClick={onRowTap(() => setExpandedId(expanded ? null : client.id))}
                    style={{ background: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                    {/* Avatar */}
                    <div style={{ width: 42, height: 42, borderRadius: R.full, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>{client.name}</p>
                      <p style={{ fontSize: 13, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.email ?? t('kld.geenEmail')}</p>
                    </div>
                    {/* [BESTE] What this customer still owes — only when there is something. */}
                    {openByClient && (openByClient[client.id] ?? 0) > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#7C5800', background: '#FEF7E0', borderRadius: R.full, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {t('kl.open', { amount: eur.format(openByClient[client.id]) })}
                      </span>
                    )}
                    <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: '#80868b', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} aria-hidden>chevron_right</span>
                  </div>

                  {/* Inline expand */}
                  {expanded && (
                    <div style={{ background: '#F8F9FA', borderTop: `1px solid ${M3.surfaceVariant}`, padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 14 }}>
                        {client.kvk_number  && <InfoLine label="KVK"  value={client.kvk_number} />}
                        {client.btw_number  && <InfoLine label="BTW"  value={client.btw_number} />}
                        {client.iban        && <InfoLine label="IBAN" value={client.iban} />}
                        {client.phone       && <InfoLine label={t('kl.veld.telefoon')} value={client.phone} />}
                        {client.payment_term_days != null && <InfoLine label={t('kld.termijn')} value={t('kl.termijnDagen', { days: client.payment_term_days })} />}
                        {client.default_hourly_rate != null && <InfoLine label={t('kl.veld.uurtarief')} value={eur.format(client.default_hourly_rate)} />}
                        {client.address     && <InfoLine label={t('inst.adres')} value={[client.address, client.postal_code, client.city, client.country && client.country !== 'NL' ? countryNameNl(client.country) : null].filter(Boolean).join(', ')} />}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* [KLANTEN] Open the mini-CRM detail: history, notes, totals. */}
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/klanten/${client.id}`) }}
                          style={{ fontSize: 13, color: M3.onSurface, background: M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>person</span>
                          {t('kl.bekijk')}
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(client.id) }}
                          style={{ fontSize: 13, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>delete</span>
                          {t('lijst.verwijderen')}
                        </button>
                        {/* [BOEK-029] Edit button */}
                        <button onClick={e => { e.stopPropagation(); handleEdit(client) }}
                          style={{ fontSize: 13, color: M3.primary, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 14px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>edit</span>
                          {t('ink.bewerken')}
                        </button>
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/new?client_id=${client.id}&client_name=${encodeURIComponent(client.name)}`) }}
                          style={{ fontSize: 13, color: M3.onPrimary, background: M3.primary, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>add</span>
                          {t('kl.factuur')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: `calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))`,
          right: 20,
          background: '#D3E3FD',
          color: '#041E49',
          borderRadius: R.lg,
          padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>add</span>
        {t('lijst.nieuw')}
      </button>
      <style>{`
        @keyframes shimmer  { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2, fontWeight: 500 }}>{label}</p>
      {/* [ROW-LAYOUT] overflowWrap so an unbroken IBAN / BTW-nummer wraps inside its
          grid cell instead of overflowing and being clipped by the card. */}
      <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: FONT, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: R.lg, background: 'linear-gradient(90deg,#F8F9FA 25%,#e0e0e0 50%,#F8F9FA 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />)}
    </div>
  )
}