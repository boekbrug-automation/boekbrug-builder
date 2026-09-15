'use client'

// src/components/supplier/SupplierEditSheet.tsx
// [LEVERANCIER-BEWERKEN] The supplier's master record, edited from /dashboard/leveranciers.
//
// ── WHAT THIS SHEET IS ──
//
// The pin modal on an invoice answers "who sent THIS paper?". This sheet answers "what is true of
// this supplier from now on?" — the wholesaler moved to a new bank, the KVK was never filled in,
// the name is spelled the way the owner says it. Every field is pre-filled from the ROW, not from
// an invoice, so what the owner sees is what the app currently believes.
//
// ── WHAT IT DECIDES: NOTHING ──
//
// The server judges the same form again (supplier-edit.ts, shared), keeps the old IBAN, writes the
// trail and renames the linked invoices. This sheet only shows, and warns: a replaced account
// number is the signature of invoice fraud, so the moment the IBAN differs from the one on file
// the sentence appears that names the old number and says to call the supplier on a number the
// owner looks up themselves. That sentence is on the screen BEFORE the save, because after it the
// money is already on its way.
//
// [TAAL] The words come from the catalogue; this component holds no language of its own.

import { useState } from 'react'
import { M3, R } from '@/lib/design/tokens'
// [BACK-CLOSES] The system back button closes whatever is open.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] A sheet that takes over the back button freezes the page behind it.
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { localeDir } from '@/lib/i18n/locale'
import { failureText } from '@/lib/server-message'
// [SAMENVOEGEN-EIGENAAR] The server's refusal, in the owner's language, by the reason it names.
import { mergeRefusalText } from '@/lib/supplier-merge-copy'
// [LEVERANCIER-STANDAARD] The two defaults: the rate the app proposes on this supplier's invoices,
// and the category a bank line to them is proposed under. Vocabulary from the bank's own list.
import { SELECTABLE_CATEGORIES } from '@/lib/bank-categories'
import { BANK_CATEGORY_KEY } from '@/lib/bank-category-text'
import { LEGAL_DEFAULT_RATES } from '@/lib/supplier-pin'

const FONT = "'Roboto', -apple-system, sans-serif"

/** A supplier row, in the shape the sheet edits. */
export interface SupplierEditCard {
  id: string
  name: string
  iban: string | null
  kvk: string | null
  btw: string | null
  autoIncasso: boolean
  /** [LEVERANCIER-STANDAARD] null = no fixed choice. */
  defaultBtwRate: number | null
  defaultCategory: string | null
  /** [LEVERANCIER-LAND] ISO code; null = not recorded, read as the Netherlands. */
  country: string | null
  /** [LEVERANCIER-VERWIJDEREN] How many invoices point at this row — named before a delete. */
  invoiceCount?: number
}

export interface SupplierEditResult {
  name: string
  ibanReplaced: boolean
  invoicesRenamed: number
  /** [LEVERANCIER-NIEUW] Set when the sheet CREATED the row; how many loose invoices it adopted. */
  created?: boolean
  invoicesAdopted?: number
  /** [LEVERANCIER-VERWIJDEREN] Set when the sheet DELETED the row; how many invoices came loose. */
  deleted?: boolean
  invoicesDetached?: number
  /** [SAMENVOEGEN-EIGENAAR] Set when this row was merged INTO another; `name` is then the survivor's. */
  merged?: boolean
  mergedAwayName?: string
}

/** Another supplier of the same owner, as a merge target. */
export interface SupplierChoiceCard { id: string; name: string }

/** [LEVERANCIER-NIEUW] Open the sheet to make a row rather than edit one. */
export interface SupplierCreateIntent {
  /** Pre-filled name — the balance line's printed name, or '' for a blank form. */
  name: string
  /** Hang the invoices already in the books under this name onto the new row. */
  adoptInvoices: boolean
}

const BLANK: SupplierEditCard = {
  id: '', name: '', iban: null, kvk: null, btw: null, autoIncasso: false,
  defaultBtwRate: null, defaultCategory: null, country: null,
}

/** The normalised form of an account number, for "did it change?" — the server normalises the same way. */
const flat = (v: string) => v.replace(/\s+/g, '').toUpperCase()

export default function SupplierEditSheet({
  supplier: existing,
  create,
  others = [],
  onClose,
  onSaved,
}: {
  /** The row to edit, or null when `create` says what to make. */
  supplier: SupplierEditCard | null
  create?: SupplierCreateIntent
  /** [SAMENVOEGEN-EIGENAAR] The owner's other suppliers, offered as the row that stays. */
  others?: SupplierChoiceCard[]
  onClose: () => void
  onSaved: (result: SupplierEditResult) => void
}) {
  const creating = existing === null
  const supplier: SupplierEditCard = existing ?? { ...BLANK, name: create?.name ?? '' }
  const locale = useLocale()
  const t = translator(locale)
  const dir = localeDir(locale)
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)

  const [name, setName] = useState(supplier.name)
  const [iban, setIban] = useState(supplier.iban ?? '')
  const [kvk, setKvk] = useState(supplier.kvk ?? '')
  const [btw, setBtw] = useState(supplier.btw ?? '')
  const [country, setCountry] = useState(supplier.country ?? '')
  const [incasso, setIncasso] = useState(supplier.autoIncasso)
  // Held as strings: '' is "no fixed choice", which the server reads as clear.
  const [rate, setRate] = useState(supplier.defaultBtwRate === null ? '' : String(supplier.defaultBtwRate))
  const [category, setCategory] = useState(supplier.defaultCategory ?? '')
  const [saving, setSaving] = useState(false)
  // [LEVERANCIER-VERWIJDEREN] Two taps, never one: the first shows what comes loose, the second
  // does it. The count is on the screen before the button that acts on it.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // [SAMENVOEGEN-EIGENAAR] The row the owner picked to keep; '' = none picked, nothing offered yet.
  const [mergeInto, setMergeInto] = useState('')
  // [NO-SILENT-EMPTY] The server says WHICH field was wrong; that field is coloured and the
  // sentence sits under the form. "Ongeldig" alone leaves the owner hunting.
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null)

  // The fraud sentence, live: shown as soon as the typed number differs from a number on file.
  const storedIban = (supplier.iban ?? '').trim()
  const ibanReplacing = storedIban !== '' && flat(iban) !== flat(storedIban)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      // [LEVERANCIER-NIEUW] One form, two doors: POST makes the row, PATCH changes one.
      const res = await fetch(creating ? '/api/supplier' : `/api/supplier/${encodeURIComponent(supplier.id)}`, {
        method: creating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, iban, kvk, btw, country, defaultBtwRate: rate, defaultCategory: category,
          ...(creating ? { adoptInvoices: create?.adoptInvoices === true } : {}),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        field?: unknown; name?: unknown; id?: unknown; ibanReplaced?: unknown; invoicesRenamed?: unknown; invoicesAdopted?: unknown
      }
      if (!res.ok) {
        setError({
          field: typeof json.field === 'string' ? json.field : null,
          text: failureText(res.status, json as Parameters<typeof failureText>[1], t(creating ? 'lev.fout.aanmaken' : 'lev.fout.bijwerken')),
        })
        setSaving(false)
        return
      }
      const supplierId = creating && typeof json.id === 'string' ? json.id : supplier.id
      // The mandate is a separate decision with its own door and its own audit line. Only when it
      // was actually flipped: an unchanged switch is not re-confirmed.
      if (incasso !== supplier.autoIncasso) {
        const inc = await fetch('/api/supplier/incasso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplierId, on: incasso }),
        })
        if (!inc.ok) {
          const incJson = await inc.json().catch(() => ({}))
          setError({ field: 'incasso', text: failureText(inc.status, incJson, t('lev.fout.bijwerken')) })
          setSaving(false)
          return
        }
      }
      onSaved({
        name: typeof json.name === 'string' ? json.name : name,
        ibanReplaced: json.ibanReplaced === true,
        invoicesRenamed: typeof json.invoicesRenamed === 'number' ? json.invoicesRenamed : 0,
        created: creating,
        invoicesAdopted: typeof json.invoicesAdopted === 'number' ? json.invoicesAdopted : 0,
      })
    } catch {
      setError({ field: null, text: t('lev.fout.bijwerken') })
      setSaving(false)
    }
  }

  const remove = async () => {
    if (saving || creating) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/supplier/${encodeURIComponent(supplier.id)}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { name?: unknown; invoicesDetached?: unknown }
      if (!res.ok) {
        setError({ field: null, text: failureText(res.status, json as Parameters<typeof failureText>[1], t('lev.fout.verwijderen')) })
        setSaving(false)
        return
      }
      onSaved({
        name: typeof json.name === 'string' ? json.name : supplier.name,
        ibanReplaced: false, invoicesRenamed: 0,
        deleted: true,
        invoicesDetached: typeof json.invoicesDetached === 'number' ? json.invoicesDetached : 0,
      })
    } catch {
      setError({ field: null, text: t('lev.fout.verwijderen') })
      setSaving(false)
    }
  }

  const merge = async () => {
    const target = others.find((o) => o.id === mergeInto)
    if (saving || creating || !target) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/supplier/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId: target.id, mergedAwayId: supplier.id, byOwner: true }),
      })
      const json = (await res.json().catch(() => ({}))) as { reason?: unknown; error?: unknown }
      if (!res.ok) {
        // The server names the FACT that refused (two KVK numbers, two own accounts), never "kon niet".
        setError({
          field: 'merge',
          text: typeof json.reason === 'string'
            ? mergeRefusalText(json.reason as Parameters<typeof mergeRefusalText>[0], locale)
            : failureText(res.status, json as Parameters<typeof failureText>[1], mergeRefusalText(null, locale)),
        })
        setSaving(false)
        return
      }
      onSaved({ name: target.name, ibanReplaced: false, invoicesRenamed: 0, merged: true, mergedAwayName: supplier.name })
    } catch {
      setError({ field: 'merge', text: mergeRefusalText(null, locale) })
      setSaving(false)
    }
  }

  const field = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint: string,
    placeholder?: string,
  ) => (
    <label style={{ display: 'block', marginBottom: 12, textAlign: 'start' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        // An IBAN, a KVK and a btw number are Latin strings whatever the interface language.
        dir={key === 'name' ? undefined : 'ltr'}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
          borderRadius: 10, border: `1px solid ${error?.field === key ? M3.error : '#d1d1d6'}`,
          outline: 'none', color: '#202124', fontFamily: FONT, textAlign: 'start',
        }}
      />
      <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 4, lineHeight: 1.45 }}>{hint}</span>
    </label>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(creating ? 'lev.nieuw.titel' : 'lev.bewerk.titel')}
      dir={dir}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0, textAlign: 'start' }}>{t(creating ? 'lev.nieuw.titel' : 'lev.bewerk.titel')}</p>
        <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45, textAlign: 'start' }}>
          {creating
            ? (create?.adoptInvoices ? t('lev.nieuw.uitlegRegel') : t('lev.nieuw.uitleg'))
            : t('lev.bewerk.uitleg')}
        </p>

        {field('name', t('lev.naam'), name, setName, t('lev.naam.hint'))}
        {field('iban', t('lev.iban'), iban, setIban, t('lev.iban.hint'), 'NL00BANK0000000000')}
        {/* [IBAN-WISSEL] Before the save, in the owner's language, naming the number that stood. */}
        {ibanReplacing && (
          <p role="alert" style={{
            background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md, padding: 12,
            fontSize: 13, color: '#7C5800', lineHeight: 1.55, margin: '0 0 12px', textAlign: 'start',
          }}>
            {t('lev.bewerk.ibanGewijzigd', { oud: storedIban })}
          </p>
        )}
        {field('kvk', t('lev.kvk'), kvk, setKvk, t('lev.kvk.hint'), '12345678')}
        {field('btw', t('lev.btw'), btw, setBtw, t('lev.btw.hint'), 'NL000000000B00')}
        {/* [LEVERANCIER-LAND] Two letters. Outside NL the btw on this supplier's invoices is shifted
            to the owner: rubriek 4b (EU) or 4a (outside the EU), with the deductible part in 5b. */}
        {field('country', t('lev.land'), country, (v) => setCountry(v.toUpperCase()), t('lev.land.hint'), 'NL')}

        {/* [LEVERANCIER-STANDAARD] Decided once, proposed every time — never booked by itself. */}
        <label style={{ display: 'block', marginBottom: 12, textAlign: 'start' }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{t('lev.bewerk.tarief')}</span>
          <select
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, borderRadius: 10,
              border: `1px solid ${error?.field === 'rate' ? M3.error : '#d1d1d6'}`, background: '#fff',
              color: '#202124', fontFamily: FONT,
            }}
          >
            <option value="">{t('lev.bewerk.tarief.geen')}</option>
            {LEGAL_DEFAULT_RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
          </select>
          <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 4, lineHeight: 1.45 }}>{t('lev.bewerk.tarief.hint')}</span>
        </label>
        <label style={{ display: 'block', marginBottom: 12, textAlign: 'start' }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{t('lev.bewerk.categorie')}</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, borderRadius: 10,
              border: `1px solid ${error?.field === 'category' ? M3.error : '#d1d1d6'}`, background: '#fff',
              color: '#202124', fontFamily: FONT,
            }}
          >
            <option value="">{t('lev.bewerk.categorie.geen')}</option>
            {SELECTABLE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{t(BANK_CATEGORY_KEY[c.key])}</option>)}
          </select>
          <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 4, lineHeight: 1.45 }}>{t('lev.bewerk.categorie.hint')}</span>
        </label>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, textAlign: 'start', cursor: 'pointer' }}>
          <input type="checkbox" checked={incasso} onChange={(e) => setIncasso(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#3c4043' }}>{t('lev.bewerk.incasso')}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: '#5F6368', marginTop: 2, lineHeight: 1.45 }}>{t('lev.bewerk.incasso.hint')}</span>
          </span>
        </label>

        {error && (
          <p style={{ fontSize: 13, color: M3.error, lineHeight: 1.5, margin: '4px 0 12px', textAlign: 'start' }}>{error.text}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{ width: '100%', padding: 15, borderRadius: 14, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: saving ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT }}
        >
          {saving ? t('lev.bezig') : t(creating ? 'lev.nieuw.opslaan' : 'lev.bewerk.opslaan')}
        </button>
        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ width: '100%', padding: 13, borderRadius: 12, background: '#f1f3f4', color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
        >
          {t('lev.annuleren')}
        </button>

        {/* [SAMENVOEGEN-EIGENAAR] The owner names the pair. The two vetoes still hold on the
            server; what this gives up is the demand for a shared number, because the reader
            founds two rows for one company without leaving one behind. */}
        {!creating && others.length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #E0E0E0', textAlign: 'start' }}>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: '#3c4043', margin: '0 0 4px' }}>{t('lev.samenvoeg.kop')}</p>
            <p style={{ fontSize: 12.5, color: '#5F6368', lineHeight: 1.5, margin: '0 0 8px' }}>{t('lev.samenvoeg.uitleg')}</p>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 5 }}>{t('lev.samenvoeg.kies')}</span>
              <select
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                disabled={saving}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, borderRadius: 10,
                  border: `1px solid ${error?.field === 'merge' ? M3.error : '#d1d1d6'}`, background: '#fff',
                  color: '#202124', fontFamily: FONT,
                }}
              >
                <option value="">{t('lev.samenvoeg.geen')}</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            {mergeInto !== '' && (
              <div role="alert">
                <p style={{ fontSize: 13, color: '#202124', lineHeight: 1.55, margin: '0 0 10px' }}>
                  {t('lev.samenvoeg.vraag', { dit: supplier.name, ander: others.find((o) => o.id === mergeInto)?.name ?? '' })}
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={merge}
                  style={{ padding: '10px 16px', borderRadius: 12, background: saving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}
                >
                  {saving ? t('lev.bezig') : t('lev.samenvoeg.bevestig')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* [LEVERANCIER-VERWIJDEREN] Under the form, apart from it, and never on a row being made. */}
        {!creating && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #E0E0E0', textAlign: 'start' }}>
            {!confirmingDelete ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmingDelete(true)}
                style={{ background: 'none', border: 'none', color: M3.error, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, padding: 0 }}
              >
                {t('lev.verwijder.knop')}
              </button>
            ) : (
              <div role="alert">
                <p style={{ fontSize: 13, color: '#202124', lineHeight: 1.55, margin: '0 0 6px' }}>
                  {[t('lev.verwijder.vraag'), typeof supplier.invoiceCount === 'number' ? t('lev.verwijder.aantal', { n: supplier.invoiceCount }) : null]
                    .filter(Boolean).join(' ')}
                </p>
                <p style={{ fontSize: 12.5, color: '#5F6368', lineHeight: 1.5, margin: '0 0 10px' }}>{t('lev.verwijder.dubbel')}</p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={remove}
                  style={{ padding: '10px 16px', borderRadius: 12, background: saving ? '#9AA0A6' : M3.error, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}
                >
                  {saving ? t('lev.bezig') : t('lev.verwijder.bevestig')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
