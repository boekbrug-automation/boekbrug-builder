'use client'

// src/app/dashboard/leveranciers/LeveranciersClient.tsx
// [LEVERANCIER-SALDO] De crediteurenstand, zoals de groothandel op de foto hem laat zien —
// gegroepeerd per partij, met een subtotaal, een vervallen-deel en een peildatum erboven.
//
// [TAAL] Dit component houdt geen taal van zichzelf. Elke zin komt kant-en-klaar uit
// supplier-balance-copy.ts, inclusief de richting waarin hij gelezen wordt; hier staat alleen
// hoe het eruitziet. Eén hard-gecodeerde string hier is precies hoe een vertaling voorgoed half
// af blijft: het scherm ziet er in het Nederlands nog goed uit, dus niets wijst het gat aan.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// [DATE-NL] Geen <input type="date">: de segmentvolgorde daarvan volgt de browser-locale, niet de
// ondernemer. Op een scherm waar de datum bepaalt WELK bedrag er staat, is 08-09 of 09-08 het
// verschil tussen twee verschillende crediteurenstanden.
import DateFieldNL from '@/components/ui/DateFieldNL'

import { M3, R, FONT, FONT_NUM } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { CorroborationPanel, SupplierBalancePanel } from '@/lib/supplier-balance-copy'
// [LEVERANCIER-SAMENVOEGEN] De aangeboden samenvoegingen komen kant-en-klaar binnen: welke paren
// mogen (supplier-merge.ts) en welke zin daarbij hoort (supplier-merge-copy.ts) worden allebei
// buiten dit component beslist. Hier staat alleen hoe het eruitziet en wat de knop aanroept.
import type { MergePanel } from '@/lib/supplier-merge-copy'
import { mergeDoneText, mergeRefusalText } from '@/lib/supplier-merge-copy'
import { failureText } from '@/lib/server-message'
// [LEVERANCIER-BEWERKEN] The master record, editable. The sheet shows and warns; the server
// decides (supplier-edit.ts) and keeps the old account number.
import SupplierEditSheet, { type SupplierEditCard, type SupplierCreateIntent } from '@/components/supplier/SupplierEditSheet'
import { dateShort } from '@/lib/i18n/format-date'
import { BANK_CATEGORY_KEY } from '@/lib/bank-category-text'
// [LEVERANCIER-ZOEKEN] The SAME matcher the name picker uses (supplier-suggest.ts), so a company
// the owner can pick on an invoice is a company they can find here — one spelling rule, not two.
import { suggestSuppliers, SUPPLIER_BROWSE_LIMIT } from '@/lib/supplier-suggest'
import type { BankCategory } from '@/lib/bank-categories'

/** One supplier as the registry has it, plus what the screen needs to place and describe it. */
export interface SupplierListCard extends SupplierEditCard {
  invoiceCount: number
  /** counterpartKey(name) — how a balance line finds its editable row. */
  balanceKey: string
  /** ISO date of the last edit, or null for a row nobody ever changed. */
  updatedOn: string | null
}

export default function LeveranciersClient({
  balance,
  corroboration,
  merge = null,
  suppliers = null,
  lineSupplier = {},
  asOf,
  today,
}: {
  /** Null = de lezing is mislukt. Nooit een leeg paneel: zie de zin die dan verschijnt. */
  balance: SupplierBalancePanel | null
  corroboration: CorroborationPanel | null
  /**
   * [LEVERANCIER-SAMENVOEGEN] De paren die aantoonbaar één bedrijf zijn, of null.
   *
   * Null is de gewone toestand — én de toestand na een mislukte lezing, en dat is met opzet
   * dezelfde: een paneel dat er niet is stelt niets voor, terwijl een paneel op halve gegevens
   * een samenvoeging kan voorstellen waarvan het evidence juist in het ontbrekende deel stond.
   */
  merge?: MergePanel | null
  /**
   * [LEVERANCIER-BEWERKEN] The registry rows, or null when they could not be read. Null is said
   * out loud ("storing"), never drawn as an empty list.
   */
  suppliers?: SupplierListCard[] | null
  /**
   * [LEVERANCIER-NIEUW] Balance key → the supplier the invoices under it are LINKED to. The
   * printed name and the registry name can differ ("TRIMEX INTERNATIONAL B.V." on the paper, a
   * row founded as "Trimex"), so the link is asked first and the name key only as a fallback.
   */
  lineSupplier?: Record<string, string>
  asOf: string
  today: string
}) {
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()
  const [gekozen, setGekozen] = useState(asOf)
  // Which supplier is open in the edit sheet, and the sentence the last save left behind.
  const [editing, setEditing] = useState<SupplierListCard | null>(null)
  const [editAnswer, setEditAnswer] = useState<string | null>(null)
  const supplierByKey = new Map((suppliers ?? []).map((s) => [s.balanceKey, s]))
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id, s]))
  const cardForLine = (key: string): SupplierListCard | null => {
    const linked = lineSupplier?.[key]
    return (linked ? supplierById.get(linked) : undefined) ?? supplierByKey.get(key) ?? null
  }
  // [LEVERANCIER-NIEUW] What the sheet should MAKE, when it is not editing.
  const [creating, setCreating] = useState<SupplierCreateIntent | null>(null)
  // [LEVERANCIER-ZOEKEN] Filters the registry list only. The balance above it is a TOTAL and a
  // filtered total is a wrong number, so nothing up there moves.
  const [zoek, setZoek] = useState('')
  const gevonden = suggestSuppliers(zoek, suppliers ?? [], SUPPLIER_BROWSE_LIMIT).matches
  const zichtbaar = zoek.trim() === ''
    ? (suppliers ?? [])
    : gevonden.map((m) => (suppliers ?? []).find((s) => s.id === m.id)).filter((s): s is SupplierListCard => !!s)
  const addButton = (name: string, adoptInvoices: boolean, label: string) => (
    <button
      type="button"
      onClick={() => { setEditAnswer(null); setEditing(null); setCreating({ name, adoptInvoices }) }}
      style={{
        padding: '6px 12px', borderRadius: R.full, border: 'none',
        background: M3.primary, color: '#fff', fontSize: 12.5, fontWeight: 600,
        fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )

  const editButton = (card: SupplierListCard) => (
    <button
      type="button"
      onClick={() => { setEditAnswer(null); setEditing(card) }}
      style={{
        padding: '6px 12px', borderRadius: R.full, border: `1px solid ${M3.outline}`,
        background: '#fff', color: M3.primary, fontSize: 12.5, fontWeight: 600,
        fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {t('lev.bewerk.knop')}
    </button>
  )
  // Welke rij bezig is, en wat de server terugzei. Eén regel onder het paneel, want dat antwoord
  // gaat over wat er NU in de boeken staat — geen zin die weg mag glijden in een toast.
  const [busyWith, setBusyWith] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)

  const mergeSuppliers = async (
    survivorId: string, mergedAwayId: string, mergedAwayName: string, survivorName: string,
  ) => {
    if (busyWith) return
    setBusyWith(mergedAwayId)
    setAnswer(null)
    try {
      const res = await fetch('/api/supplier/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId, mergedAwayId }),
      })
      const json = (await res.json().catch(() => ({}))) as { reason?: string; error?: string }
      if (!res.ok) {
        // [SERVER-ZIN] De server beslist opnieuw op wat hij zelf leest, en zijn WEIGERING noemt de
        // reden. "Kon niet" over een samenvoeging nodigt uit tot een poging die nooit kan slagen.
        setAnswer(
          json.reason
            ? mergeRefusalText(json.reason as Parameters<typeof mergeRefusalText>[0], locale)
            : failureText(res.status, json, mergeRefusalText(null, locale)),
        )
        return
      }
      setAnswer(mergeDoneText(mergedAwayName, survivorName, locale))
      router.refresh()
    } catch {
      setAnswer(mergeRefusalText(null, locale))
    } finally {
      setBusyWith(null)
    }
  }

  if (!balance) {
    // [NO-SILENT-EMPTY] Een mislukte lezing is geen nul. "Er staat niets open" is hier het
    // gevaarlijkste zinnetje dat het scherm kan tonen, want daar handelt iemand naar.
    return (
      <main style={{ fontFamily: FONT, padding: 20, maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 10px' }}>
          {t('leveranciers.titel')}
        </h1>
        <div style={{
          background: '#FCE8E6', border: '1px solid #F5C6C2', borderRadius: R.lg,
          padding: 16, color: '#8C1D18', fontSize: 14.5, lineHeight: 1.6,
        }}>
          {t('leveranciers.nietGelezen')}
        </div>
      </main>
    )
  }

  return (
    <main dir={balance.dir} style={{ fontFamily: FONT, padding: 20, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 2px' }}>
        {balance.heading}
      </h1>
      <p style={{ fontSize: 13, color: M3.neutral, margin: '0 0 14px' }}>{balance.peildatum}</p>

      {/* De peildatum is een INVOERVELD, net als op het scherm van de groothandel: de stand op
          31 december is een ander getal dan de stand van nu, en alleen de eerste is te archiveren. */}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          router.push(gekozen ? `/dashboard/leveranciers?peildatum=${gekozen}` : '/dashboard/leveranciers')
        }}
      >
        <label htmlFor="peildatum" style={{ fontSize: 13.5, color: M3.neutral }}>
          {t('leveranciers.peildatumLabel')}
        </label>
        <DateFieldNL
          id="peildatum" value={gekozen} onChange={setGekozen} max={today}
          aria-label={t('leveranciers.peildatumLabel')}
          style={{ fontSize: 14 }}
        />
        <button type="submit" style={{
          padding: '8px 16px', borderRadius: R.full, background: M3.primary, color: '#fff',
          border: 'none', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
        }}>
          {t('leveranciers.toon')}
        </button>
      </form>

      {balance.basisWaarschuwing && (
        <p style={{
          background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md,
          padding: 12, fontSize: 13.5, color: '#7C5800', lineHeight: 1.55, margin: '0 0 16px',
        }}>
          {balance.basisWaarschuwing}
        </p>
      )}

      {/* Het totaal, groot. Dit is het getal waar aan de telefoon naar gevraagd wordt. */}
      <div style={{
        background: M3.surfaceVariant, borderRadius: R.lg, padding: 16, marginBottom: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
      }}>
        <span style={{ fontSize: 14.5, color: M3.neutral }}>{balance.totaalLabel}</span>
        <strong style={{ fontSize: 26, fontFamily: FONT_NUM, color: M3.onSurface }}>{balance.totaal}</strong>
      </div>

      {/* [LEVERANCIER-SAMENVOEGEN] Boven de lijst, want het gaat over WELKE regels die lijst heeft.
          De explanation staat er altijd bij: hij zegt hardop dat de app alleen paren voorstelt die een
          KVK-nummer of een rekeningnummer delen, en dat een naam die op elkaar lijkt geen evidence
          is. Dat is niet netjesheid — het is het verschil tussen een knop die de eigenaar mag
          vertrouwen en een knop die twee bedrijven tot één maakt. */}
      {merge && (
        <section dir={merge.dir} style={{
          background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.lg,
          padding: 16, marginBottom: 18,
        }}>
          <h2 style={{ fontSize: 15.5, fontWeight: 700, color: '#7C5800', margin: '0 0 4px' }}>
            {merge.heading}
          </h2>
          <p style={{ fontSize: 12.5, color: '#7C5800', lineHeight: 1.55, margin: '0 0 12px' }}>
            {merge.explanation}
          </p>
          {merge.offers.map((offer) => (
            <div key={offer.mergedAwayId} style={{
              background: '#fff', borderRadius: R.md, padding: 12, marginBottom: 8,
              display: 'flex', flexWrap: 'wrap', gap: 10,
              alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ flex: 1, minWidth: 200, textAlign: 'start' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
                  {offer.mergedAwayName}
                </p>
                <p style={{ fontSize: 12.5, color: M3.neutral, margin: '2px 0 0', lineHeight: 1.5 }}>
                  {offer.effect}
                </p>
                {/* Het evidence zelf, met het nummer erin. De eigenaar houdt het tegen de twee
                    facturen die voor hem liggen; hij hoeft de app niet te geloven. */}
                <p style={{ fontSize: 12, color: '#7C5800', margin: '4px 0 0', fontFamily: FONT_NUM }}>
                  {offer.evidence}
                </p>
              </div>
              <button
                type="button"
                disabled={busyWith !== null}
                onClick={() => mergeSuppliers(offer.survivorId, offer.mergedAwayId, offer.mergedAwayName, offer.survivorName)}
                style={{
                  padding: '9px 18px', borderRadius: R.full,
                  background: busyWith ? M3.neutral : M3.primary, color: '#fff', border: 'none',
                  fontSize: 13.5, fontWeight: 600, fontFamily: FONT,
                  cursor: busyWith ? 'default' : 'pointer', flexShrink: 0,
                }}
              >
                {busyWith === offer.mergedAwayId ? merge.busy : merge.action}
              </button>
            </div>
          ))}
          {answer && (
            <p style={{ fontSize: 13, color: '#7C5800', lineHeight: 1.55, margin: '8px 0 0' }}>
              {answer}
            </p>
          )}
        </section>
      )}

      {balance.leeg && (
        <p style={{ fontSize: 15, color: M3.neutral, lineHeight: 1.6 }}>{balance.leeg}</p>
      )}

      {balance.leveranciers.map((l) => (
        <div key={l.key} style={{
          borderTop: `1px solid ${M3.outlineVariant}`, padding: '13px 2px',
          display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline',
        }}>
          <div style={{ minWidth: 0 }}>
            {/* [BESTE] The name opens this supplier's invoices — the list used to end at the amount,
                and the owner went to Crediteuren to type the name into the search box. */}
            <Link href={`/dashboard/incoming/manage?zoek=${encodeURIComponent(l.name)}`} style={{ fontSize: 15.5, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word', textDecoration: 'none' }}>
              {l.name}
            </Link>
            <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2, lineHeight: 1.5 }}>
              {[l.aantal, l.vervallen, l.oudste].filter(Boolean).join(' · ')}
            </div>
            {l.onbevestigd && (
              <div style={{ fontSize: 12, color: '#7C5800', marginTop: 3, lineHeight: 1.5 }}>{l.onbevestigd}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexShrink: 0 }}>
            {(() => {
              const card = cardForLine(l.key)
              if (card) return editButton(card)
              // No row for a company the books already show. Only when the registry was READ:
              // against a failed read every line would look unregistered, and the button would
              // make a second row for each of them.
              return suppliers !== null ? addButton(l.name, true, t('lev.nieuw.vanRegel')) : null
            })()}
            <strong style={{ fontSize: 16, fontFamily: FONT_NUM, color: M3.onSurface, whiteSpace: 'nowrap' }}>
              {l.bedrag}
            </strong>
          </div>
        </div>
      ))}

      {balance.ouderdom.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '0 0 8px' }}>
            {balance.ouderdomKop}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {balance.ouderdom.map((b) => (
              <div key={b.label} style={{
                background: b.vervallen ? '#FCE8E6' : M3.surfaceVariant,
                borderRadius: R.md, padding: '9px 13px', minWidth: 108,
              }}>
                <div style={{ fontSize: 11.5, color: b.vervallen ? '#8C1D18' : M3.neutral }}>{b.label}</div>
                <div style={{ fontSize: 15, fontFamily: FONT_NUM, color: M3.onSurface, marginTop: 2 }}>
                  {b.bedrag}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(balance.onbevestigd || balance.zonderLeverancier) && (
        <section style={{ marginTop: 20, fontSize: 13, color: M3.neutral, lineHeight: 1.6 }}>
          {balance.onbevestigd && <p style={{ margin: '0 0 6px' }}>{balance.onbevestigd}</p>}
          {balance.zonderLeverancier && <p style={{ margin: 0 }}>{balance.zonderLeverancier}</p>}
        </section>
      )}

      {/* ── [LEVERANCIER-BEWERKEN] Het register zelf ─────────────────────────────────────────
          Onder de stand: eerst wat je moet betalen, dan wie die partijen zijn. Elke rij is de
          waarheid waarop de volgende factuur wordt herkend, en de knop ernaast is de enige plek
          waar de eigenaar die waarheid voor de TOEKOMST bijstelt. Wat er al in de boeken staat
          verandert hier niet. */}
      <section style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
            {t('leveranciers.lijst.kop')}
          </h2>
          {suppliers !== null && addButton('', false, t('lev.nieuw.knop'))}
        </div>
        <p style={{ fontSize: 12.5, color: M3.neutral, lineHeight: 1.55, margin: '0 0 10px' }}>
          {t('leveranciers.lijst.uitleg')}
        </p>
        {/* [LEVERANCIER-ZOEKEN] A filter over the list below it, and nothing else: the totals
            above are TOTALS, and a filtered total is a wrong number on a screen about money. */}
        {suppliers !== null && suppliers.length > 0 && (
          <>
            <input
              type="search"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              placeholder={t('leveranciers.zoek')}
              aria-label={t('leveranciers.zoek')}
              style={{
                width: '100%', padding: '10px 12px', marginBottom: 8, boxSizing: 'border-box',
                border: `1px solid ${M3.outline}`, borderRadius: R.sm, fontSize: 14.5,
                fontFamily: FONT, textAlign: 'start', background: '#fff', color: M3.onSurface,
              }}
            />
            {zoek.trim() !== '' && (
              <p style={{ fontSize: 12.5, color: M3.neutral, margin: '0 0 8px' }}>
                {zichtbaar.length === 0
                  ? t('leveranciers.zoek.niets', { term: zoek.trim() })
                  : t('leveranciers.zoek.aantal', { n: zichtbaar.length, totaal: suppliers.length })}
              </p>
            )}
          </>
        )}
        {editAnswer && (
          <p style={{
            background: '#E6F4EA', border: '1px solid #B7DFC9', borderRadius: R.md,
            padding: 12, fontSize: 13.5, color: '#0B8043', lineHeight: 1.6, margin: '0 0 10px',
          }}>
            {editAnswer}
          </p>
        )}
        {suppliers === null && (
          // [NO-SILENT-EMPTY] A failed read says so — it is not "you have no suppliers".
          <p role="alert" style={{
            background: '#FCE8E6', border: '1px solid #F5C6C2', borderRadius: R.md,
            padding: 12, fontSize: 13.5, color: '#8C1D18', lineHeight: 1.6, margin: 0,
          }}>
            {t('leveranciers.lijst.nietGelezen')}
          </p>
        )}
        {suppliers !== null && suppliers.length === 0 && (
          <p style={{ fontSize: 14, color: M3.neutral, lineHeight: 1.6, margin: 0 }}>{t('leveranciers.lijst.leeg')}</p>
        )}
        {zichtbaar.map((s) => (
          <div key={s.id} style={{
            borderTop: `1px solid ${M3.outlineVariant}`, padding: '11px 2px',
            display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start',
          }}>
            <div style={{ minWidth: 0, textAlign: 'start' }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word' }}>
                {s.name}
              </div>
              {/* Identifiers are Latin strings in every language, so the line keeps its own direction. */}
              <div dir="ltr" style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2, lineHeight: 1.5, fontFamily: FONT_NUM, textAlign: 'start' }}>
                {[s.iban ?? t('leveranciers.lijst.zonderIban'), s.kvk && `KVK ${s.kvk}`, s.btw, s.country && s.country !== 'NL' ? s.country : null].filter(Boolean).join(' · ')}
              </div>
              <div style={{ fontSize: 12, color: M3.neutral, marginTop: 2, lineHeight: 1.5 }}>
                {[
                  s.invoiceCount === 1 ? t('leveranciers.eenFactuur') : t('leveranciers.aantalFacturen', { aantal: s.invoiceCount }),
                  s.autoIncasso ? t('leveranciers.lijst.incasso') : null,
                  s.defaultBtwRate !== null ? t('leveranciers.lijst.tarief', { tarief: s.defaultBtwRate }) : null,
                  s.defaultCategory && s.defaultCategory in BANK_CATEGORY_KEY ? t(BANK_CATEGORY_KEY[s.defaultCategory as BankCategory]) : null,
                  s.updatedOn ? t('lev.bewerk.laatstGewijzigd', { datum: dateShort(s.updatedOn, locale) }) : null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            {editButton(s)}
          </div>
        ))}
      </section>

      {(editing || creating) && (
        <SupplierEditSheet
          supplier={editing}
          create={creating ?? undefined}
          others={(suppliers ?? []).filter((s) => s.id !== editing?.id).map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => { setEditing(null); setCreating(null) }}
          onSaved={(result) => {
            setEditing(null)
            setCreating(null)
            setEditAnswer(
              result.merged
                ? mergeDoneText(result.mergedAwayName ?? '', result.name, locale)
                : result.deleted
                ? t('lev.verwijder.klaar', { naam: result.name })
                : result.created
                ? [
                  t('lev.nieuw.toegevoegd', { naam: result.name }),
                  (result.invoicesAdopted ?? 0) > 0 ? t('lev.nieuw.gekoppeld', { n: result.invoicesAdopted ?? 0 }) : null,
                ].filter(Boolean).join(' ')
                : [t('lev.bewerk.opgeslagen', { naam: result.name }), result.ibanReplaced ? t('lev.bewerk.opgeslagenIban') : null]
                  .filter(Boolean).join(' '),
            )
            router.refresh()
          }}
        />
      )}

      {/* ── De controle ──────────────────────────────────────────────────────────────────────
          Onder de stand, niet erboven: eerst wat je moet betalen, dan wat we van je afvinkingen
          wel en niet konden nakijken. */}
      {corroboration && (
        <section dir={corroboration.dir} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '0 0 8px' }}>
            {corroboration.heading}
          </h2>
          {corroboration.klopt && (
            <p style={{
              background: '#E6F4EA', border: '1px solid #B7DFC9', borderRadius: R.md,
              padding: 12, fontSize: 13.5, color: '#0B8043', lineHeight: 1.6, margin: 0,
            }}>
              {corroboration.klopt}
            </p>
          )}
          {corroboration.regels.map((regel, i) => (
            <p key={i} style={{
              background: '#FEF7E0', border: '1px solid #FDE293', borderRadius: R.md,
              padding: 12, fontSize: 13.5, color: '#7C5800', lineHeight: 1.6, margin: '0 0 8px',
            }}>
              {regel}
            </p>
          ))}
          <p style={{ fontSize: 12.5, color: M3.neutral, marginTop: 6 }}>
            <Link href="/dashboard/bank" style={{ color: M3.primary }}>{t('leveranciers.naarBank')}</Link>
          </p>
        </section>
      )}
    </main>
  )
}
