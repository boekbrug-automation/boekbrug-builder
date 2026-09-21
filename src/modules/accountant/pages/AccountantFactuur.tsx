'use client'

// src/modules/accountant/pages/AccountantFactuur.tsx
// [MANDAAT] Factureren namens een klant — het scherm.
//
// WAT DIT SCHERM IS, EN VOORAL WAT HET NIET IS
// Het is niet /dashboard/invoice/new voor iemand anders. Dat scherm is van de ondernemer: het kent
// zijn artikelen, zijn sjablonen, zijn laatste klanten. Dit scherm doet één ding — een factuur op
// naam van een klant de deur uit — en toont bij elke stap van WIE die factuur is. Dat is geen
// versobering maar het hele punt: de boekhouder moet nooit even vergeten in wiens boeken hij zit.
//
// DE DRIE ZINNEN DIE HIER NIET WEG MOGEN
// Art. 35 lid 1 Wet OB staat toe dat een derde de factuur uitreikt "in zijn naam en voor zijn
// rekening". Art. 35a verplaatst de verantwoordelijkheid daarbij NIET: de ondernemer blijft
// aansprakelijk. Daarom staat op dit scherm altijd, in gewoon Nederlands:
//   1. deze factuur komt op naam van <klant>, in zijn nummerreeks;
//   2. hij krijgt er bericht van zodra hij verstuurd is;
//   3. hij kan de machtiging op elk moment zelf intrekken.
// Een knop die dit weglaat verkoopt de boekhouder een bevoegdheid die hij niet heeft.

import { useMemo, useState } from 'react'
// [TZ] One clock for every door — see the note at amsterdamToday().
import { deliveryFailure } from '@/lib/invoice-delivery'
import { lineNetEx } from '@/lib/invoice-discount'
import { amsterdamToday } from '@/lib/format-nl'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { UNITS, DEFAULT_UNIT_CODE, unitLabel } from '@/lib/units'
// [BTW-ROUND] Eén sommatie voor de drie wettelijke bedragen — dezelfde die de server gebruikt.
import { computeInvoiceTotals } from '@/lib/invoice-totals'
// [DATE-NL] dd-mm-jjjj, ongeacht de browsertaal.
import DateFieldNL from '@/components/ui/DateFieldNL'
import VraagMachtiging, { type KoppelKlant } from './VraagMachtiging'
import { failureText } from '@/lib/server-message'

/** Eén klant die deze boekhouder gemachtigd heeft. */
export interface GemachtigdeKlant {
  id: string
  naam: string
  btwNummer: string | null
}

interface Regel {
  description: string
  quantity: string
  unit_price: string
  btw_rate: number
  unit: string
}

interface Props {
  klanten: GemachtigdeKlant[]
  /** [VRAAG-MACHTIGING] De GEKOPPELDE klanten — om te kunnen vragen wat er nog niet is. */
  gekoppeld?: KoppelKlant[]
  /**
   * [KLANT-VOORAF] De klant die de boekhouder al aanwees op de klantpagina. De server heeft hem
   * al getoetst aan de machtigingenlijst; hier is het alleen nog de beginwaarde van de keuze,
   * die hij gewoon kan wijzigen.
   */
  vooraf?: string | null
}

const BTW_TARIEVEN = [21, 9, 0] as const

const legeRegel = (): Regel => ({
  description: '',
  quantity: '1',
  unit_price: '',
  btw_rate: 21,
  unit: DEFAULT_UNIT_CODE,
})

/** Een bedrag zoals een Nederlander het intikt: komma of punt, allebei goed. */
function naarGetal(v: string): number {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AccountantFactuur({ klanten, gekoppeld = [], vooraf = null }: Props) {
  const locale = useLocale()
  const t = translator(locale)
  const router = useRouter()
  // [KLANT-VOORAF] Wie er is aangewezen wint van "de enige die er is" — beide zijn een beginwaarde,
  // en de aanwijzing is de meest recente handeling van de boekhouder.
  const [klantId, setKlantId] = useState<string>(vooraf ?? (klanten.length === 1 ? klanten[0].id : ''))
  const [naam, setNaam] = useState('')
  const [email, setEmail] = useState('')
  const [adres, setAdres] = useState('')
  const [postcode, setPostcode] = useState('')
  const [plaats, setPlaats] = useState('')
  const [btwNummer, setBtwNummer] = useState('')
  // [TZ] Amsterdam, not UTC — and this is the exact failure format-nl.ts names first: "an invoice
  // created just after midnight on 1 January gets dated 31 December — the previous FISCAL YEAR and
  // the previous BTW-quarter, on a document that already carries a number from the doorlopende
  // reeks." The owner's own invoice screen has always used amsterdamToday(); this door, the one
  // where a BOOKKEEPER invoices on a client's behalf, was still on the browser's UTC date. Same
  // feature, two doors, two clocks.
  const [factuurdatum, setFactuurdatum] = useState(() => amsterdamToday())
  const [regels, setRegels] = useState<Regel[]>([legeRegel()])
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const klant = useMemo(() => klanten.find((k) => k.id === klantId) ?? null, [klanten, klantId])

  // [BTW-ROUND] Via computeInvoiceTotals, niet via een eigen lus. "Alleen om te TONEN" was het
  // argument voor de kopie die hier stond, en precies dat argument is waarom het misgaat: de
  // server rekent hem opnieuw met de gedeelde functie, en die twee lopen op een factuur met
  // gemengde tarieven een cent uiteen (gemeten: 23,88 tegen 23,89). Het bedrag dat de boekhouder
  // op zijn scherm ziet is dan niet het bedrag op de factuur die de klant krijgt — en dat is de
  // enige plek waar een cent verschil een vraag oplevert die niemand kan beantwoorden.
  //
  // Dezelfde reden waarom de twee eigenaars-editors deze kopie al kwijt zijn. Dit scherm stond
  // buiten de poort die dat bewaakt: die liep langs drie met de hand getypte bestanden.
  // [REGEL-AFRONDING] And with each line ROUNDED first, the way the server stores it. Without
  // line_total, computeInvoiceTotals falls back to quantity × unit_price unrounded — its own doc
  // comment names this caller shape as the hazard — and the screen drifts a cent from the
  // document again, by another road: 2 × (1,5 uur @ 33,33) showed 120,99 here against the 121,00
  // /api/invoice/draft stores and the customer receives. lineNetEx is what the owner's two editors
  // hand it, so all three screens and the server round the same line the same way.
  const totalen = useMemo(() => {
    const t = computeInvoiceTotals(
      regels.map((r) => {
        const quantity = naarGetal(r.quantity)
        const unit_price = naarGetal(r.unit_price)
        return { quantity, unit_price, btw_rate: r.btw_rate, line_total: lineNetEx({ quantity, unit_price }) }
      }),
    )
    return { ex: t.total_ex_btw, btw: t.btw_amount, inc: t.total_inc_btw }
  }, [regels])

  function pasRegelAan(i: number, veld: keyof Regel, waarde: string | number) {
    setRegels((oud) => oud.map((r, j) => (i === j ? { ...r, [veld]: waarde } : r)))
  }

  async function verstuur() {
    setFout(null)
    if (!klant) return setFout(t('bh.fact.foutKiesKlant'))
    if (!naam.trim()) return setFout(t('bh.fact.foutOntvanger'))
    // [REGEL-ZONDER-OMSCHRIJVING] Weigeren, niet stil weglaten.
    //
    // `totalen` hierboven rekent over ALLE regels; deze filter stuurde alleen de regels mét
    // omschrijving door. Een regel van € 400 waarvan de omschrijving vergeten is, stond dus wel in
    // het totaal op het scherm en niet op de factuur: het scherm zei "Totaal € 968,00" en er ging
    // een factuur van € 484,00 de deur uit, uit de DOORLOPENDE reeks van de klant. De klant
    // ontvangt en betaalt het lagere bedrag, het nummer is vergeven, en herstellen kost een
    // creditnota plus een nieuwe factuur.
    //
    // De editor van de ondernemer zelf doet dit al goed: die stuurt alle regels mee en valideert de
    // omschrijving per regel. Dit scherm was de uitzondering.
    //
    // Een lege regel onderaan (geen bedrag, geen tekst) blijft onschuldig en wordt gewoon
    // weggelaten — alleen een regel MET bedrag en ZONDER omschrijving houdt de verzending tegen.
    const zonderOmschrijving = regels.findIndex((r) => !r.description.trim() && naarGetal(r.unit_price) !== 0)
    if (zonderOmschrijving >= 0) {
      return setFout(t('bh.fact.foutOmschrijving', { nummer: zonderOmschrijving + 1 }))
    }
    const bruikbaar = regels.filter((r) => r.description.trim() && naarGetal(r.unit_price) !== 0)
    if (bruikbaar.length === 0) return setFout(t('bh.fact.foutRegel'))

    setBezig(true)
    try {
      // Stap 1 — het concept. De server bepaalt de eigenaar; wij sturen alleen namens WIE.
      const concept = await fetch('/api/invoice/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namens_klant_id: klant.id,
          invoiceType: 'factuur',
          client_name: naam.trim(),
          client_email: email.trim() || null,
          client_address: adres.trim() || null,
          client_postal_code: postcode.trim() || null,
          client_city: plaats.trim() || null,
          client_btw_number: btwNummer.trim() || null,
          invoice_date: factuurdatum || null,
          lines: bruikbaar.map((r) => ({
            description: r.description.trim(),
            quantity: naarGetal(r.quantity),
            unit_price: naarGetal(r.unit_price),
            btw_rate: r.btw_rate,
            unit: r.unit,
          })),
        }),
      })
      const conceptData = await concept.json().catch(() => ({}))
      if (!concept.ok || !conceptData?.invoiceId) {
        throw new Error(failureText(concept.status, conceptData, t('bh.fact.foutConcept')))
      }

      // Stap 2 — uitgeven. Hier valt het nummer uit de reeks van de KLANT (art. 35), krijgt hij
      // zijn melding, en gaat de mail naar de ontvanger.
      const verzonden = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: conceptData.invoiceId, namens_klant_id: klant.id }),
      })
      const verzondenData = await verzonden.json().catch(() => ({}))
      if (!verzonden.ok) {
        throw new Error(failureText(verzonden.status, verzondenData, t('bh.fact.foutVersturen')))
      }

      // [VERSTUURD-EERLIJK] The number came out of the CLIENT's legal sequence and cannot be given
      // back, so a failed delivery still answers 200. This page read the body and never looked at
      // `warning`: the accountant was redirected to the invoice as though it had been sent, while
      // their client's customer had received nothing. The detail page reads ?delivery= and shows
      // the recovery banner with the resend button.
      const bezorgFout = deliveryFailure(verzondenData)
      router.push(`/dashboard/invoice/${conceptData.invoiceId}${bezorgFout ? `?delivery=${bezorgFout}` : ''}`)
    } catch (e) {
      setFout(e instanceof Error ? e.message : t('bh.fact.foutOnbekend'))
      setBezig(false)
    }
  }

  // ── Nog niemand heeft je gemachtigd ────────────────────────────────────────
  if (klanten.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          {t('bh.fact.titel')}
        </h1>
        <div
          style={{
            background: M3.surface,
            border: `1px solid ${M3.outlineVariant}`,
            borderRadius: R.lg,
            padding: 20,
            boxShadow: EL1,
          }}
        >
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            {t('bh.fact.geenMachtiging')}
          </p>
          {/* The nav path stays as the client's screen writes it — a translated path points at a
              word that is nowhere in that interface. Hence one whole sentence, no <strong> split:
              a sentence cut around markup does not survive another word order. */}
          <p style={{ margin: '0 0 12px', color: M3.onSurfaceVariant, lineHeight: 1.6, fontSize: 14.5 }}>
            {t('bh.fact.geenMachtigingUitleg')}
          </p>
          {/* [KANTOOR-RUST] Whose name, whose series, whose responsibility (art. 35a Wet OB): true,
              on the screen, and behind one word rather than in the way of the ask below. */}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13.5, color: M3.primary }}>{t('bh.waarom')}</summary>
            <p style={{ margin: '6px 0 0', color: M3.mutedText, lineHeight: 1.6, fontSize: 13.5 }}>
              {t('bh.fact.geenMachtigingWet')}
            </p>
          </details>
          <VraagMachtiging klanten={gekoppeld} kind="facturen" />
        </div>
      </main>
    )
  }

  const veld: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${M3.outline}`,
    borderRadius: R.sm,
    fontSize: 15,
    color: M3.onSurface,
    background: M3.surface,
    boxSizing: 'border-box',
  }
  const label: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    color: M3.onSurfaceVariant,
    marginBottom: 6,
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        {t('bh.fact.titel')}
      </h1>
      <p style={{ margin: '0 0 20px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        {t('bh.fact.ondertitel')}
      </p>

      {/* ── Namens wie ─────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <label style={label} htmlFor="namens">{t('bh.fact.namensLabel')}</label>
        <select
          id="namens"
          value={klantId}
          onChange={(e) => setKlantId(e.target.value)}
          style={veld}
        >
          <option value="">{t('bh.fact.kiesKlantOptie')}</option>
          {klanten.map((k) => (
            <option key={k.id} value={k.id}>{k.naam}</option>
          ))}
        </select>

        {klant && (
          // De drie zinnen uit de kop van dit bestand. Ze staan hier ONDER de keuze, zodat ze
          // veranderen zodra de naam verandert — een waarschuwing die altijd hetzelfde zegt, leest
          // niemand meer na de tweede keer.
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: M3.primaryContainer,
              borderRadius: R.sm,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: M3.onPrimaryContainer,
            }}
          >
            {/* The three sentences stay whole, one key each. Cutting them around the <strong> that
                used to hold the name would leave a fragment that no other word order can carry —
                and these are the sentences that may never come apart. */}
            {klant.btwNummer
              ? t('bh.fact.mandaatBtw', { naam: klant.naam, btw: klant.btwNummer })
              : t('bh.fact.mandaat', { naam: klant.naam })}
          </div>
        )}
      </section>

      {/* ── Aan wie ────────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: '0 0 14px' }}>
          {t('bh.fact.aanWie', { naam: klant ? klant.naam : t('bh.fact.jeKlant') })}
        </h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={label} htmlFor="ontvanger">{t('bh.fact.labelNaam')}</label>
            <input id="ontvanger" style={veld} value={naam} onChange={(e) => setNaam(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="ontvanger-mail">{t('bh.fact.labelEmail')}</label>
            <input id="ontvanger-mail" type="email" style={veld} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="ontvanger-adres">{t('bh.fact.labelAdres')}</label>
            <input id="ontvanger-adres" style={veld} value={adres} onChange={(e) => setAdres(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={label} htmlFor="ontvanger-pc">{t('bh.fact.labelPostcode')}</label>
              <input id="ontvanger-pc" style={veld} value={postcode} onChange={(e) => setPostcode(e.target.value)} />
            </div>
            <div>
              <label style={label} htmlFor="ontvanger-plaats">{t('bh.fact.labelPlaats')}</label>
              <input id="ontvanger-plaats" style={veld} value={plaats} onChange={(e) => setPlaats(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label} htmlFor="ontvanger-btw">{t('bh.fact.labelBtw')}</label>
              <input id="ontvanger-btw" style={veld} value={btwNummer} onChange={(e) => setBtwNummer(e.target.value)} />
            </div>
            <div>
              <label style={label} htmlFor="factuurdatum">{t('bh.fact.labelDatum')}</label>
              {/* [DATE-NL] Geen native date-input: die zet zijn segmenten in de volgorde van de
                  BROWSER-locale, dus een boekhouder met een Engelse browser typt 03-08 waar hij
                  3 augustus bedoelt en er staat 8 maart op de factuur. Dit scherm stond buiten de
                  poort die dat afvangt — die keek alleen in src/app. */}
              <DateFieldNL id="factuurdatum" style={veld} value={factuurdatum} onChange={setFactuurdatum} aria-label={t('bh.fact.labelDatum')} />
            </div>
          </div>
        </div>
      </section>

      {/* ── De regels ──────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: '0 0 14px' }}>
          {t('bh.fact.watGeleverd')}
        </h2>
        {regels.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gap: 10,
              paddingBottom: 14,
              marginBottom: 14,
              borderBottom: i === regels.length - 1 ? 'none' : `1px solid ${M3.outlineVariant}`,
            }}
          >
            <input
              style={veld}
              placeholder={t('bh.fact.phOmschrijving')}
              aria-label={t('bh.fact.ariaOmschrijving', { n: i + 1 })}
              value={r.description}
              onChange={(e) => pasRegelAan(i, 'description', e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              <input
                style={veld}
                inputMode="decimal"
                placeholder={t('bh.fact.phAantal')}
                aria-label={t('bh.fact.ariaAantal', { n: i + 1 })}
                value={r.quantity}
                onChange={(e) => pasRegelAan(i, 'quantity', e.target.value)}
              />
              <select
                style={veld}
                aria-label={t('bh.fact.ariaEenheid', { n: i + 1 })}
                value={r.unit}
                onChange={(e) => pasRegelAan(i, 'unit', e.target.value)}
              >
                {UNITS.map((u) => (
                  <option key={u.code} value={u.name}>{unitLabel(u.name)}</option>
                ))}
              </select>
              <input
                style={veld}
                inputMode="decimal"
                placeholder={t('bh.fact.phPrijs')}
                aria-label={t('bh.fact.ariaPrijs', { n: i + 1 })}
                value={r.unit_price}
                onChange={(e) => pasRegelAan(i, 'unit_price', e.target.value)}
              />
              <select
                style={veld}
                aria-label={t('bh.fact.ariaBtw', { n: i + 1 })}
                value={r.btw_rate}
                onChange={(e) => pasRegelAan(i, 'btw_rate', Number(e.target.value))}
              >
                {/* Renamed from `t` — the translator owns that name in this component now. */}
                {BTW_TARIEVEN.map((tarief) => (
                  <option key={tarief} value={tarief}>{t('bh.fact.btwTarief', { tarief })}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRegels((oud) => [...oud, legeRegel()])}
          style={{
            background: 'none',
            border: 'none',
            color: M3.primary,
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {t('bh.fact.regelErbij')}
        </button>
      </section>

      {/* ── Totaal en versturen ────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: M3.onSurfaceVariant }}>
          <span>{t('bh.fact.subtotaal')}</span><span>{euro(totalen.ex)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: M3.onSurfaceVariant, marginTop: 6 }}>
          <span>{t('bh.fact.btw')}</span><span>{euro(totalen.btw)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 17,
            fontWeight: 500,
            color: M3.onSurface,
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${M3.outlineVariant}`,
          }}
        >
          <span>{t('bh.fact.totaal')}</span><span>{euro(totalen.inc)}</span>
        </div>

        {fout && (
          <p
            role="alert"
            style={{
              marginTop: 16,
              padding: '10px 12px',
              background: M3.errorContainer,
              color: M3.error,
              borderRadius: R.sm,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {fout}
          </p>
        )}

        <button
          type="button"
          onClick={verstuur}
          disabled={bezig || !klant}
          style={{
            marginTop: 16,
            width: '100%',
            padding: '12px 16px',
            background: bezig || !klant ? M3.surfaceVariant : M3.primary,
            color: bezig || !klant ? M3.mutedText : M3.onPrimary,
            border: 'none',
            borderRadius: R.md,
            fontSize: 15,
            fontWeight: 500,
            cursor: bezig || !klant ? 'default' : 'pointer',
          }}
        >
          {bezig
            ? t('bh.fact.bezig')
            : klant
              ? t('bh.fact.verstuurNamens', { naam: klant.naam })
              : t('bh.fact.kiesEerst')}
        </button>
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: M3.mutedText, lineHeight: 1.5 }}>
          {t('bh.fact.nummerWaarschuwing')}
        </p>
      </section>
    </main>
  )
}
