'use client'

// src/app/dashboard/zzp/DailyTruth.tsx
// [HONEST-HOME] The owner's home snapshot — two layers of one question:
//   A. "Waar sta ik?"  — certain TOTALS (exact sums of STORED invoice totals + a
//      task count). Each is a button to the surface that manages it.
//   B. "Wat nu?"       — a PREVIEW of the items that need action now (overdue or due
//      ≤ 3 days), the same to-do the Vandaag page lists, with "Alle N bekijken →".
//
// It never shows a computed income/expense/net figure (the earlier version did, from
// the bank statement, and it was wrong for normal banking — which is why it was
// disabled). Numbers here are exact stored totals or plain counts. Freshness is shown
// honestly so we never imply real-time data.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { M3, FONT, FONT_NUM } from '@/lib/design/tokens'
// [DESIGN] Radius from the shared scale (src/lib/design/tokens.ts).
import { R } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [FROM-HOME] The resolve surface per row, with the way back written into the link.
import { attentionHref } from '@/lib/home-links'

const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface Bucket { count: number; total: number; overdue: number }
interface AttentionItem {
  id: string
  party: string | null
  invoiceNumber: string | null
  dueDate: string | null
  total: number
  direction: 'incoming' | 'outgoing'
}
interface TruthData {
  ok: boolean
  toPay: Bucket
  toReceive: Bucket
  // [BETALINGSVERSCHIL] Het deel van 'Te ontvangen' dat waarschijnlijk niet meer komt:
  // restjes van een paar euro die al een maand stilstaan (bankkosten, een afronding).
  // Optioneel getypt zodat een oudere API-respons dit scherm niet breekt.
  paymentDifferences?: { count: number; total: number; note: string | null }
  bank: {
    lastDate: string | null
    undocumented: number
    // [BANK-SALDO] Het slotsaldo van het laatst geuploade afschrift. Optioneel getypt zodat een
    // oudere API-respons dit scherm niet breekt — en `null` betekent ONBEKEND, nooit nul.
    balance?: number | null
    balanceAsOf?: string | null
    accounts?: number
    partial?: boolean
  }
  kas?: { used: boolean; balance: number }
  attention: AttentionItem[]
  attentionCount: number
}

// ── Date helpers (timezone-proof, mirrors VandaagClient) ──────────────────────
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return NaN
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / 86_400_000)
}
function todayDayNumber(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return dayNumberFromIso(parts)
}
function daysUntilDue(dueIso: string): number {
  return dayNumberFromIso(dueIso) - todayDayNumber()
}
// [TAAL] Takes the caller's translator; each count band has its own key (same keys as Vandaag).
function dueLabel(dueIso: string, t: ReturnType<typeof translator>): string {
  const d = daysUntilDue(dueIso)
  // [OWNER-DECISION] Every overdue invoice shows the real day count, red —
  // matches Vandaag (no calm 30+-day tier anywhere).
  if (d < 0) return Math.abs(d) === 1 ? t('vandaag.telaatEen') : t('vandaag.telaatMeer', { n: Math.abs(d) })
  if (d === 0) return t('vandaag.vervaltVandaag')
  if (d === 1) return t('vandaag.vervaltMorgen')
  return t('vandaag.vervaltOver', { n: d })
}
function dueAccent(dueIso: string): string {
  // Red for ANY overdue row, amber for soon-due — a 30+-days-late invoice must
  // never look CALMER than a 10-days-late one.
  return daysUntilDue(dueIso) < 0 ? M3.error : M3.warning
}
function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}

export default function DailyTruth() {
  const t = translator(useLocale())
  const router = useRouter()
  const [data, setData] = useState<TruthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // [BESTE] Free after the btw reserve, and the balance in thirty days — from the two engines
  // Vandaag already runs (btw-reservation, cashflow). Null = unknown, and then the line is absent;
  // never a zero standing in for "could not read".
  const [companions, setCompanions] = useState<{ free: number | null; short: boolean; in30: number | null } | null>(null)

  // All setState happens inside the async IIFE (never synchronously in the effect body), so a
  // retry re-runs by bumping reloadKey. The retry button itself flips loading back on.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/daily-truth')
        const json = await res.json()
        if (cancelled) return
        if (res.ok && json?.ok) { setData(json); setFailed(false) }
        else { setFailed(true); setData(null) }
        // After the truth, never before it: these two are companions, not the answer.
        const [reserve, cash] = await Promise.allSettled([
          fetch('/api/btw-reservation').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/cashflow').then((r) => (r.ok ? r.json() : null)),
        ])
        if (cancelled) return
        const rv = reserve.status === 'fulfilled' ? reserve.value : null
        const cf = cash.status === 'fulfilled' ? cash.value : null
        const h30 = Array.isArray(cf?.horizons) ? cf.horizons.find((h: { days: number }) => h.days === 30) : null
        setCompanions({
          free: typeof rv?.free === 'number' ? rv.free : null,
          short: rv?.state === 'short',
          in30: typeof h30?.end === 'number' ? h30.end : null,
        })
      } catch {
        if (!cancelled) { setFailed(true); setData(null) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  const retry = () => { setLoading(true); setFailed(false); setReloadKey((k) => k + 1) }

  if (loading) {
    return <div style={{ height: 148, borderRadius: R.lg, background: '#F5F5F7', marginBottom: 16 }} />
  }
  // [NO-FALSE-CLEAR] A failed load must NEVER render as "all clear" (or as nothing, which reads the
  // same on a summary screen). Show an honest, retryable error instead of silently hiding the panel.
  if (failed || !data?.ok) {
    return (
      <div style={{ marginBottom: 20, fontFamily: FONT, background: '#FFF4E5', borderRadius: R.lg, padding: '16px', boxShadow: EL1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#7a4f00' }}>{t('waarheid.laadfout')}</div>
        <div style={{ fontSize: 12.5, color: '#7a4f00', margin: '4px 0 10px' }}>{t('waarheid.geenAllesBij')}</div>
        <button onClick={retry} style={{ background: '#7a4f00', color: '#fff', border: 'none', borderRadius: 980, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('waarheid.opnieuw')}</button>
      </div>
    )
  }

  const { toPay, toReceive, bank, attention, attentionCount } = data
  const lastDate = formatDate(bank.lastDate)
  // [NO-CODEER] Uncoded bank debits are NOT tasks the owner owes — the per-line categorize flow was
  // deliberately removed, so a bank-only retail user permanently carries hundreds of un-invoiced
  // debits. So "Alles is bij" reflects only real open MONEY (nothing to pay, nothing to receive) and
  // must NOT be gated on those debits, or the box would never appear (perpetual false nag).
  // [ALLES-IS-BIJ TRUTH] The honesty bug was the SUBTITLE claiming "niets te documenteren" — a
  // per-line completeness the app deliberately doesn't track. That false claim is removed (the
  // subtitle is now money-only); the genuine missing-inkoopfactuur (voorbelasting) gap stays surfaced
  // where it is actually actionable — the bank screen's "Geen factuur" tab, not this summary box.
  const allClear = toPay.count === 0 && toReceive.count === 0

  // incoming → the manage surface (pay / mark paid); outgoing → the invoice detail.
  // [FROM-HOME] Marked as entered from the home, like the "Te betalen" card above: without the
  // marker, Terug on the manage screen landed on the verify queue, which this visitor never saw.
  const openItem = (it: AttentionItem) => router.push(attentionHref(it))

  return (
    <div style={{ marginBottom: 20, fontFamily: FONT }}>
      {/* ── Layer A: WAAR JE STAAT (certain totals) ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 10px' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>
          {t('waarheid.waarJeStaat')}
        </span>
        {lastDate && (
          <span style={{ fontSize: 11.5, color: '#70757a' }}>{t('waarheid.bankBijgewerkt', { datum: lastDate })}</span>
        )}
      </div>

      {allClear ? (
        <div style={{
          background: M3.successContainer, borderRadius: R.lg, padding: '18px 16px',
          boxShadow: EL1, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22 }}>✓</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0B5345' }}>{t('waarheid.allesBij')}</div>
            <div style={{ fontSize: 13, color: '#0B5345', marginTop: 2 }}>
              {t('waarheid.nietsOpen')}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10 }}>
            {/* [NAV-FROM] ?from=home — this card sits on the dashboard, so Terug must come back
                here and not to the verification list the owner skipped. */}
            {/* [TAAL] enkel/meer als eigen sleutels — `subject + 's'` schreef "3 factuurs" op
                het startscherm, fout in élke taal inclusief het Nederlands zelf. */}
            <MoneyCard label={t('waarheid.teBetalen')} bucket={toPay} emptyText={t('waarheid.nietsTeBetalen')}
              subjectEnkel={t('waarheid.inkoop.enkel')} subjectMeer={t('waarheid.inkoop.meer')}
              overDatum={(n) => t('waarheid.overDatum', { n })}
              onClick={() => router.push('/dashboard/incoming/manage?from=home')} />
            <MoneyCard label={t('waarheid.teOntvangen')} bucket={toReceive} emptyText={t('waarheid.nietsOpenKort')}
              subjectEnkel={t('waarheid.factuur.enkel')} subjectMeer={t('waarheid.factuur.meer')}
              overDatum={(n) => t('waarheid.overDatum', { n })}
              onClick={() => router.push('/dashboard/facturen')} />
          </div>
          {/* [BETALINGSVERSCHIL] Onder 'Te ontvangen', want dat is het getal dat het vertekent.
              Een klant maakt EUR 995 over op een factuur van EUR 1.000 omdat zijn bank er EUR 5
              afhaalt; die EUR 5 blijft staan en komt nooit. Zonder deze regel is 'Te ontvangen'
              te hoog met geld dat geen vordering is — fout in de enige richting die niemand
              controleert. Het meldt het en boekt niets af: afsluiten blijft de keuze van de
              eigenaar, want of een tekort bankkosten is of een betwiste korting weet de app niet. */}
          {data.paymentDifferences && data.paymentDifferences.count > 0 && data.paymentDifferences.note && (
            <button
              onClick={() => router.push('/dashboard/facturen')}
              style={{
                width: '100%', textAlign: 'start', marginTop: 10, padding: '12px 14px',
                borderRadius: 14, border: '1px solid #ffd9a8', background: '#fff8ef',
                color: '#7a4f00', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
              }}
            >
              {data.paymentDifferences.note}
            </button>
          )}
        </>
      )}

      {/* [NO-CODEER] The per-line bank-categorize entry was removed on purpose. For a
          retail administration costs come in on the INCOMING invoice (which carries the
          BTW to reclaim) and revenue from the Z-report/dagomzet — hand-coding a bare bank
          debit gives no voorbelasting and can double-count an invoice already booked, so
          the "give every transaction a category" flow was more busywork than truth. The
          page + API still exist (reachable by URL) if we ever re-enable it; the readiness
          screen still flags genuinely unexplained INCOME (money in with no invoice). */}

      {/* ── [BANK-SALDO] Wat er op de bank staat ─────────────────────────────
          Dit scherm heet "Waar je staat" en toonde wat je MOET betalen, wat je krijgt, en het geld
          in je kassa — en geen woord over de bank. Juist het getal waarmee je "kan ik dit betalen?"
          beantwoordt, ontbrak, terwijl het kleinere potje er direct onder stond. Twee van de drie
          potjes noemen leest als alle drie: EUR 58.000 schuld tegenover EUR 24.000 zichtbaar is een
          schrik die de bankstand in één oogopslag had kunnen wegnemen.

          Het getal stond al in de database. bank-ingest.ts leest bij elke upload het saldo dat het
          afschrift ZELF verklaart — het heeft dat nodig om te bewijzen dat het bestand compleet is
          — en bewaart het. Het werd gelezen, gecontroleerd, opgeslagen en aan niemand getoond.

          Boven Kas, want bij vrijwel iedereen is dit het grotere bedrag.

          En de datum staat ERIN, niet eronder: dit is het slotsaldo van het laatste afschrift dat
          jij hebt geüpload. Exact én oud tegelijk — allebei waar, en het tweede weglaten is hoe een
          exact getal een leugen wordt. Daarom nooit "saldo", altijd "saldo op 28 jul.". */}
      {typeof data.bank.balance === 'number' && (
        <button
          onClick={() => router.push('/dashboard/bank')}
          style={{
            width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
            marginTop: 10, borderRadius: R.lg, padding: '14px 16px',
            background: M3.surface, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>
              {(data.bank.accounts ?? 1) > 1 ? t('waarheid.bankMeerdere', { n: data.bank.accounts ?? 0 }) : t('waarheid.bank')}
            </div>
            <div style={{ fontSize: 11.5, color: '#70757a', marginTop: 2, lineHeight: 1.45 }}>
              {t('waarheid.saldoOp', { datum: formatDate(data.bank.balanceAsOf ?? null) ?? '' })}
              {/* Een deeltotaal dat als het geheel leest, is dezelfde fout als een nul — alleen
                  stiller: je leest minder geld dan je hebt en kunt niet zien waarom. */}
              {data.bank.partial && ` · ${t('waarheid.saldoDeels')}`}
            </div>
          </div>
          <span style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: data.bank.balance < 0 ? '#B3261E' : M3.onSurface, flexShrink: 0 }}>
            {eur.format(data.bank.balance)}
          </span>
        </button>
      )}

      {/* [BESTE] The two companions to the balance, only when the engines could answer. Taps
          through to Vandaag, where the reserve and the forecast stand in full. */}
      {typeof data.bank.balance === 'number' && companions && (companions.free !== null || companions.in30 !== null) && (
        <button
          onClick={() => router.push('/dashboard/vandaag?from=home')}
          style={{
            width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
            marginTop: 6, borderRadius: R.lg, padding: '10px 16px',
            background: M3.surface, border: `1px solid ${M3.outlineVariant}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          {companions.free !== null && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: '#70757a' }}>{t('waarheid.vrijNaBtw')}</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: companions.short ? '#B3261E' : M3.onSurface }}>{eur.format(companions.free)}</div>
            </div>
          )}
          {companions.in30 !== null && (
            <div style={{ minWidth: 0, textAlign: 'end' }}>
              <div style={{ fontSize: 11.5, color: '#70757a' }}>{t('waarheid.over30')}</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: companions.in30 < 0 ? '#B3261E' : M3.onSurface }}>{eur.format(companions.in30)}</div>
            </div>
          )}
        </button>
      )}

      {/* [CASH-LEDGER] Kas line — only when the owner actually uses cash. */}
      {data.kas?.used && (
        <button
          onClick={() => router.push('/dashboard/kas')}
          style={{
            width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
            marginTop: 10, borderRadius: R.lg, padding: '14px 16px',
            background: M3.surface, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>{t('waarheid.kas')}</div>
          <span style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: data.kas.balance < 0 ? '#B3261E' : M3.onSurface }}>
            {eur.format(data.kas.balance)}
          </span>
        </button>
      )}

      {/* ── Layer B: DIT HEEFT JE AANDACHT NODIG (item preview → Vandaag) ── */}
      {attention.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ margin: '0 2px 10px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>
              {t('waarheid.aandachtNodig')}
            </span>
          </div>

          <div style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
            {attention.map((it, i) => (
              <AttentionRow key={it.id} item={it} onClick={() => openItem(it)} divider={i > 0} />
            ))}

            {/* "Alle N bekijken →" — the full list lives on Vandaag. */}
            <button
              onClick={() => router.push('/dashboard/vandaag')}
              style={{
                width: '100%', textAlign: 'center', cursor: 'pointer', fontFamily: FONT,
                padding: '12px', border: 'none', borderTop: `1px solid ${M3.hairline}`,
                background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600,
              }}
            >
              {attentionCount > attention.length
                ? `${t('waarheid.alleBekijken', { n: attentionCount })} →`
                : `${t('waarheid.allesBekijken')} →`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// A single money fact: exact stored total + count, or a calm empty state.
function MoneyCard({ label, bucket, emptyText, subjectEnkel, subjectMeer, overDatum, onClick }: {
  label: string; bucket: Bucket; emptyText: string
  subjectEnkel: string; subjectMeer: string; overDatum: (n: number) => string; onClick: () => void
}) {
  const has = bucket.count > 0
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
        borderRadius: R.lg, padding: '14px 16px', minWidth: 0,
        background: has ? M3.primaryContainer : M3.surface,
        boxShadow: EL1,
        border: `1px solid ${has ? 'transparent' : M3.outlineVariant}`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: has ? M3.onPrimaryContainer : M3.neutral }}>
        {label}
      </div>
      {has ? (
        <>
          <div style={{ fontFamily: FONT_NUM, fontSize: 19, fontWeight: 700, color: M3.onPrimaryContainer, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {eur.format(bucket.total)}
          </div>
          <div style={{ fontSize: 11.5, color: '#3c4043', marginTop: 2 }}>
            {bucket.count} {bucket.count === 1 ? subjectEnkel : subjectMeer}
            {bucket.overdue > 0 ? ` · ${overDatum(bucket.overdue)}` : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: M3.neutral, marginTop: 6 }}>{emptyText}</div>
      )}
    </button>
  )
}

// A compact preview row for one item that needs action. One tap → its resolve surface.
// A negative incoming total is a creditnota (it REDUCES what you owe) — never "pay".
function AttentionRow({ item, onClick, divider }: {
  item: AttentionItem; onClick: () => void; divider: boolean
}) {
  const t = translator(useLocale())
  const isCredit = item.direction === 'incoming' && item.total < 0
  const accent = item.dueDate ? dueAccent(item.dueDate) : M3.neutral

  // [HONEST-HOME] Make money-out vs money-in unmistakable at a glance — the same
  // vocabulary as the totals above ("Te betalen" / "Te ontvangen"), so a daily user
  // never has to wonder "is this a bill I owe or an invoice owed to me?".
  const kind = isCredit ? t('waarheid.creditnota') : item.direction === 'incoming' ? t('waarheid.teBetalen') : t('waarheid.teOntvangen')
  const kindColor = item.direction === 'incoming' ? '#8A4B00' : M3.primary
  const dueText = !isCredit && item.dueDate ? dueLabel(item.dueDate, t) : ''

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
        border: 'none', background: 'transparent',
        borderTop: divider ? `1px solid ${M3.hairline}` : 'none',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.party?.trim() || t('vandaag.onbekendePartij')}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 2 }}>
          <span style={{ color: kindColor, fontWeight: 600 }}>{kind}</span>
          {dueText && <span style={{ color: accent, fontWeight: 500 }}> · {dueText}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'end', flexShrink: 0 }}>
        <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: isCredit ? M3.success : M3.onSurface, whiteSpace: 'nowrap' }}>
          {eur.format(item.total)}
        </div>
      </div>
      <span className="material-symbols-outlined icon-dir" style={{ color: '#9aa0a6', fontSize: 20, flexShrink: 0 }} aria-hidden>chevron_right</span>
    </button>
  )
}
