'use client'

// src/app/dashboard/vragen/VragenClient.tsx
// [BRUG-RETOUR] De vragenlijst van de ondernemer.
//
// Eén kaart per openstaande vraag: waar hij over gaat, wat er gevraagd is, en één veld om
// te antwoorden. Het antwoord gaat via /api/messages — hetzelfde kanaal met koppelingscheck,
// in-app notificatie en e-mail dat het berichtenscherm gebruikt.
//
// WAT DIT SCHERM BEWUST NIET DOET
// Het vinkt niets af. De klant kan de status van zijn boekhouder niet schrijven (RLS staat
// het niet toe, en het hoort ook niet: een status is diens bewering). Daarom staat er na
// het versturen géén "afgehandeld", maar precies wat er is gebeurd: je antwoord is verstuurd,
// en de vraag blijft staan tot je boekhouder hem zelf afvinkt.
//
// [VRAAG-EIGENAAR] Every card answers ITS asker. An owner may have two offices linked, and each
// question carries the accountant who asked it; the answer is posted to that id, never to "the"
// accountant. A question whose asker is no longer linked stays visible and says so — with no
// composer that would pretend the relationship exists (the server refuses that send anyway). A
// link read that failed says that too, rather than guessing either way.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FONT, M3, R, COLUMN } from '@/lib/design/tokens'
import { bouwAntwoordBericht, type OpenVraag } from '@/lib/vragen'
import { answerTargetFor, type AccountantLinks } from '@/lib/accountant-links'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { formatDateNL, formatEuroNL } from '@/lib/format-nl'
import type { ProposedChange, ProposableField } from '@/lib/correction-proposal'
import type { VraagInvoiceRow } from '@/lib/vragen'

const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

export interface VraagView extends OpenVraag {
  /** Ondertekende URL naar het bestand, of null als er niets te openen valt. */
  fileUrl: string | null
  /**
   * [VRAAG-DEUR] The screen that shows this invoice — Inkomend for a purchase invoice, the invoice
   * page for a sales invoice — decided on the server from the invoice's own direction and
   * ownership (invoiceQuestionHref). Null for a document question, for an invoice we could not
   * read, and for one whose direction the records do not settle: no door to a guess.
   */
  invoiceHref?: string | null
}

/** [VOORSTEL] One open correction proposal from the accountant, as the card shows it. */
export interface VoorstelView {
  id: string
  invoice: VraagInvoiceRow | null
  changes: ProposedChange[]
  reason: string | null
  askedAt: string | null
}

// Datum uit een ISO-string zonder tijdzonegedoe en zonder klok in de render
// (react-hooks/purity: new Date() tijdens renderen is een fout, en hier ook niet nodig).
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
function datumNL(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}`
}

export default function VragenClient({
  vragen,
  voorstellen = [],
  links,
  accountantNames = {},
  accountantNaam,
  loadFailed,
}: {
  vragen: VraagView[]
  voorstellen?: VoorstelView[]
  /** [VRAAG-EIGENAAR] The owner's current links, as a collection: failed / zero / one / many. */
  links: AccountantLinks
  /** Names for the accountant ids the server could prove — display only. */
  accountantNames?: Record<string, string>
  /** The one linked accountant's name, only when exactly one is linked; otherwise null. */
  accountantNaam: string | null
  loadFailed: boolean
}) {
  const t = translator(useLocale())
  const router = useRouter()
  const nietsOpen = vragen.length === 0 && voorstellen.length === 0
  const linksKnown = links.state === 'known'
  const heeftBoekhouder = linksKnown && links.ids.length > 0

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* [HEADER-SYSTEM] De titel woont in de gedeelde sub-paginabalk; hier alleen de uitleg. */}
        <header style={{ margin: '16px 0 18px' }}>
          {/* [TAAL] Two full sentences instead of a swapped-in noun: with a name the sentence
              reads differently than without one, and only the NAME itself is data. */}
          <p style={{ fontSize: 14.5, color: M3.neutral, margin: 0, lineHeight: 1.55 }}>
            {accountantNaam
              ? t('vr.uitleg.metNaam', { naam: accountantNaam })
              : t('vr.uitleg.zonderNaam')}
          </p>
        </header>

        {/* [NO-FALSE-CLEAR] Een mislukte lezing mag nooit als "geen vragen" lezen. */}
        {loadFailed ? (
          <div style={{ background: M3.warningContainer, borderRadius: R.lg, padding: '16px', boxShadow: EL1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: '#7a4f00' }}>{t('vr.fout.ophalen')}</div>
            {/* [TAAL] The mid-sentence <strong> was dropped: emphasis cannot travel through a
                sentence whose word order changes per language. */}
            <div style={{ fontSize: 13.5, color: '#7a4f00', margin: '4px 0 12px', lineHeight: 1.5 }}>
              {t('vr.fout.betekentNiet')}
            </div>
            <button
              onClick={() => router.refresh()}
              style={{ background: '#7a4f00', color: '#fff', border: 'none', borderRadius: 980, padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              {t('inkoop.opnieuwProberen')}
            </button>
          </div>
        ) : nietsOpen ? (
          <div style={{ background: M3.successContainer, borderRadius: R.lg, padding: '20px 18px', boxShadow: EL1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: '#0B5345' }}>{t('vr.geen')}</div>
            <div style={{ fontSize: 13.5, color: '#0B5345', marginTop: 4, lineHeight: 1.55 }}>
              {/* [NO-SILENT-EMPTY] A link read that failed is not "no accountant linked". */}
              {!linksKnown
                ? t('vr.geen.koppelingOnbekend')
                : heeftBoekhouder
                  ? t('vr.geen.metBoekhouder')
                  : t('vr.geen.zonderBoekhouder')}
            </div>
            {/* [KANTOORGIDS] Alleen zonder boekhouder: wie er al een heeft, hoeft geen lijst. */}
            {linksKnown && !heeftBoekhouder && (
              <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>
                <a href="/boekhouders" style={{ color: '#0B5345', fontWeight: 600 }}>
                  {t('vr.geen.zoekBoekhouder')}
                </a>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* [VOORSTEL] A proposal is a question with the answer typed in — it goes first. */}
            {voorstellen.map((v) => (
              <VoorstelKaart key={v.id} voorstel={v} />
            ))}
            {/* [VRAAG-EIGENAAR] Keyed on asker AND subject: two offices may ask about one invoice. */}
            {vragen.map((v) => (
              <VraagKaart key={`${v.accountantId ?? 'niemand'}:${v.documentId}`} vraag={v} links={links} askerName={v.accountantId ? accountantNames[v.accountantId] ?? null : null} />
            ))}
          </div>
        )}

        {/* Wat een vraag meestal is: een ontbrekend bestand. Eén tik naar de plek die dat oplost. */}
        {!loadFailed && vragen.length > 0 && (
          <button
            onClick={() => router.push('/dashboard/upload')}
            style={{
              marginTop: 20, width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: FONT,
              background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: R.lg,
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: EL1,
            }}
          >
            <span className="material-symbols-outlined" style={{ color: M3.primary, fontSize: 22 }} aria-hidden>upload_file</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: M3.onSurface }}>{t('vr.misBon')}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>{t('vr.voegToe')}</span>
            </span>
            <span className="material-symbols-outlined icon-dir" style={{ color: '#9aa0a6', fontSize: 20 }} aria-hidden>chevron_right</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function VraagKaart({ vraag, links, askerName }: { vraag: VraagView; links: AccountantLinks; askerName: string | null }) {
  const t = translator(useLocale())
  const router = useRouter()
  const [antwoord, setAntwoord] = useState('')
  const [bezig, setBezig] = useState(false)
  const [verstuurd, setVerstuurd] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const datum = datumNL(vraag.askedAt)
  // [FACTUURVRAAG] Een vraag gaat over een BESTAND of over een FACTUUR, en de terugvalzin moet dat
  // zeggen: "naamloos bestand" boven een vraag over een inkoopfactuur van € 2.265 is precies de
  // verwarring die dit scherm komt opheffen.
  const isFactuur = vraag.subjectType === 'invoice'
  const naam = vraag.documentName ?? (
    isFactuur
      ? (vraag.documentMissing ? t('vr.naam.factuurWeg') : t('nieuw.type.factuur'))
      : (vraag.documentMissing ? t('vr.naam.bestandWeg') : t('vr.naam.naamloos'))
  )
  // [VRAAG-DEUR] The invoice itself, on the screen that shows it — decided on the server from the
  // invoice's direction (see invoiceQuestionHref). Only when we could read the invoice; a link to a
  // row that is not there is worse than no link.
  const factuurHref = vraag.invoiceHref ?? null
  // [VRAAG-EIGENAAR] Who the answer goes to: the asker, if they are still linked.
  const target = answerTargetFor(vraag.accountantId, links)
  const antwoordId = `antwoord-${vraag.accountantId ?? 'niemand'}-${vraag.documentId}`

  async function verstuur() {
    const bericht = bouwAntwoordBericht(vraag.documentName, antwoord)
    if (!bericht || !target.ok) return
    setBezig(true); setFout(null)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // [KANTOOR-LINKS] Which invoice this answer is about, as a TYPED id — so the
        // accountant's notification opens that invoice in its own quarter instead of a chat
        // window. Only for an invoice question; a document question names no period, and the
        // route ignores anything it cannot verify the sender owns.
        body: JSON.stringify({
          receiver_id: target.accountantId,
          content: bericht,
          ...(isFactuur && vraag.invoice?.id ? { about: { type: 'invoice', id: vraag.invoice.id } } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFout(failureText(res.status, json, t('vr.fout.versturen')))
      } else {
        setVerstuurd(true)
        setAntwoord('')
      }
    } catch {
      setFout(t('vr.fout.versturen'))
    } finally {
      setBezig(false)
    }
  }

  return (
    <article style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
      {/* Waar de vraag over gaat */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span className="material-symbols-outlined" style={{ color: M3.warn, fontSize: 22, marginTop: 1 }} aria-hidden>help</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word' }}>{naam}</div>
            <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>
              {datum ? t('vr.gevraagdOp', { datum }) : t('vr.datumOnbekend')}
              {vraag.documentTrashed && ` · ${t('vr.inPrullenbak')}`}
              {/* [VRAAG-EIGENAAR] With two offices the owner has to know WHO is asking. Only a
                  name the server could prove; never a placeholder that reads like one. */}
              {askerName && ` · ${t('vr.gevraagdDoor', { naam: askerName })}`}
            </div>
          </div>
          {vraag.fileUrl && (
            <a
              href={vraag.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: M3.primary, textDecoration: 'none', padding: '4px 2px' }}
            >
              {t('kl.bekijk')}
            </a>
          )}
          {/* [FACTUURVRAAG] Dezelfde plek, dezelfde belofte: de vraag brengt je bij het ding waar
              hij over gaat. Zonder dit moet de klant zelf gaan zoeken welke van zijn vierhonderd
              facturen bedoeld wordt — en dan verhuist het gesprek alsnog naar WhatsApp. */}
          {factuurHref && (
            <a
              href={factuurHref}
              style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: M3.primary, textDecoration: 'none', padding: '4px 2px' }}
            >
              {t('kl.bekijk')}
            </a>
          )}
        </div>
      </div>

      {/* De vraag zelf — of de eerlijke vaststelling dat er geen tekst bij zat */}
      <div style={{ margin: '0 16px 14px', padding: '12px 14px', background: M3.warnContainer, borderRadius: R.md }}>
        {vraag.question ? (
          <p style={{ margin: 0, fontSize: 14.5, color: '#5a3e00', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {vraag.question}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: '#5a3e00', lineHeight: 1.55 }}>
            {t('vr.geenToelichting')}
          </p>
        )}
      </div>

      {/* Antwoorden */}
      <div style={{ padding: '0 16px 16px' }}>
        {!target.ok ? (
          // [VRAAG-EIGENAAR] No composer that pretends: the asker is no longer linked (their
          // question stays, the answer can no longer go to them here), or we could not check.
          <div>
            <p style={{ margin: 0, fontSize: 13, color: M3.neutral, lineHeight: 1.5 }}>
              {target.reason === 'unknown' ? t('vr.koppelingOnbekend') : t('vr.nietMeerGekoppeld')}
            </p>
            {target.reason === 'unknown' && (
              <button
                onClick={() => router.refresh()}
                style={{ marginTop: 8, background: 'none', border: `1px solid ${M3.outlineVariant}`, borderRadius: 980, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: M3.primary, cursor: 'pointer', fontFamily: FONT }}
              >
                {t('inkoop.opnieuwProberen')}
              </button>
            )}
          </div>
        ) : verstuurd ? (
          <div style={{ background: M3.successContainer, borderRadius: R.md, padding: '12px 14px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0B5345' }}>{t('vr.verstuurd')}</div>
            <div style={{ fontSize: 12.5, color: '#0B5345', marginTop: 3, lineHeight: 1.5 }}>
              {t('vr.blijftStaan')}
            </div>
          </div>
        ) : (
          <>
            <label htmlFor={antwoordId} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: M3.neutral, marginBottom: 6 }}>
              {t('vr.jouwAntwoord')}
            </label>
            <textarea
              id={antwoordId}
              value={antwoord}
              onChange={(e) => setAntwoord(e.target.value)}
              rows={3}
              placeholder={t('vr.voorbeeld')}
              style={{
                width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 14.5,
                color: M3.onSurface, padding: '10px 12px', lineHeight: 1.5,
                border: `1px solid ${M3.outlineVariant}`, borderRadius: R.md, resize: 'vertical',
                background: '#fff',
              }}
            />
            {fout && (
              <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: M3.error }}>{fout}</p>
            )}
            <button
              onClick={verstuur}
              disabled={bezig || antwoord.trim().length === 0}
              style={{
                marginTop: 10, border: 'none', borderRadius: 980, padding: '9px 20px',
                fontSize: 14, fontWeight: 600, fontFamily: FONT,
                cursor: bezig || antwoord.trim().length === 0 ? 'default' : 'pointer',
                background: antwoord.trim().length === 0 ? M3.surfaceVariant : M3.primary,
                color: antwoord.trim().length === 0 ? M3.neutral : '#fff',
              }}
            >
              {bezig ? t('fb.versturenBezig') : t('vr.antwoordVersturen')}
            </button>
          </>
        )}
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// [VOORSTEL] The accountant's correction proposal: old → new per field, a reason, two buttons.
// Akkoord goes through the client's OWN correction door on the server; this card only asks.
// Exported so the render gate can hand it a proposal and see the branches paint.

const VELD_KEY: Record<ProposableField, 'vr.voorstel.veld.exBtw' | 'vr.voorstel.veld.btw' | 'vr.voorstel.veld.inc' | 'vr.voorstel.veld.datum' | 'vr.voorstel.veld.vervalt'> = {
  total_ex_btw: 'vr.voorstel.veld.exBtw',
  btw_amount: 'vr.voorstel.veld.btw',
  total_inc_btw: 'vr.voorstel.veld.inc',
  invoice_date: 'vr.voorstel.veld.datum',
  due_date: 'vr.voorstel.veld.vervalt',
}

function waarde(field: ProposableField, v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'invoice_date' || field === 'due_date') return formatDateNL(String(v))
  return formatEuroNL(Number(v))
}

export function VoorstelKaart({ voorstel, onDecided }: { voorstel: VoorstelView; onDecided?: (status: 'accepted' | 'declined' | 'stale') => void }) {
  const t = translator(useLocale())
  const router = useRouter()
  const [bezig, setBezig] = useState<'accept' | 'decline' | null>(null)
  const [klaar, setKlaar] = useState<'accepted' | 'declined' | 'stale' | null>(null)
  const [fout, setFout] = useState<string | null>(null)

  const inv = voorstel.invoice
  const naam = inv
    ? `${inv.invoice_number ? `${t('nieuw.type.factuur')} ${inv.invoice_number}` : t('nieuw.type.factuur')}${inv.client_name ? ` · ${inv.client_name}` : ''}`
    : t('vr.naam.factuurWeg')
  const datum = datumNL(voorstel.askedAt)
  // A proposal is only ever about a PURCHASE invoice (/api/accountant/invoice-correction refuses any
  // other), so Inkomend is its screen; the marker sends "Terug" back here ([VRAAG-DEUR]).
  const factuurHref = inv ? `/dashboard/incoming/manage?focus=${encodeURIComponent(inv.id)}&from=vragen` : null

  async function beslis(action: 'accept' | 'decline') {
    setBezig(action); setFout(null)
    try {
      const res = await fetch(`/api/invoice-corrections/${encodeURIComponent(voorstel.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json?.code === 'stale') { setKlaar('stale'); onDecided?.('stale') }
        else setFout(failureText(res.status, json, t('vr.voorstel.fout')))
      } else {
        const status = action === 'accept' ? 'accepted' : 'declined'
        setKlaar(status); onDecided?.(status)
        router.refresh()
      }
    } catch {
      setFout(t('vr.voorstel.fout'))
    } finally {
      setBezig(null)
    }
  }

  return (
    <article style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span className="material-symbols-outlined" style={{ color: M3.primary, fontSize: 22, marginTop: 1 }} aria-hidden>edit_note</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: M3.primary, letterSpacing: 0.2 }}>{t('vr.voorstel.titel')}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word', marginTop: 2 }}>{naam}</div>
            <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>
              {datum ? t('vr.gevraagdOp', { datum }) : t('vr.datumOnbekend')}
            </div>
          </div>
          {factuurHref && (
            <a href={factuurHref} style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: M3.primary, textDecoration: 'none', padding: '4px 2px' }}>
              {t('kl.bekijk')}
            </a>
          )}
        </div>
      </div>

      {/* Old → new, one line per field. The amounts the client must compare are never shortened. */}
      <dl style={{ margin: '0 16px 12px', padding: '12px 14px', background: M3.surfaceVariant, borderRadius: R.md, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 6, columnGap: 14, fontSize: 14 }}>
        {voorstel.changes.map((c) => (
          <div key={c.field} style={{ display: 'contents' }}>
            <dt style={{ color: M3.neutral }}>{t(VELD_KEY[c.field])}</dt>
            <dd style={{ margin: 0, color: M3.onSurface, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ textDecoration: 'line-through', color: M3.neutral }}>{waarde(c.field, c.from)}</span>
              <span className="icon-dir" aria-hidden> → </span>
              <strong>{waarde(c.field, c.to)}</strong>
            </dd>
          </div>
        ))}
      </dl>

      {voorstel.reason && (
        <p style={{ margin: '0 16px 12px', fontSize: 14, color: M3.onSurface, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {voorstel.reason}
        </p>
      )}

      <div style={{ padding: '0 16px 16px' }}>
        {klaar === 'accepted' ? (
          <div style={{ background: M3.successContainer, borderRadius: R.md, padding: '12px 14px', fontSize: 14, fontWeight: 600, color: '#0B5345' }}>{t('vr.voorstel.klaar')}</div>
        ) : klaar === 'declined' ? (
          <div style={{ background: M3.surfaceVariant, borderRadius: R.md, padding: '12px 14px', fontSize: 14, fontWeight: 600, color: M3.onSurface }}>{t('vr.voorstel.afgewezen')}</div>
        ) : klaar === 'stale' ? (
          <div style={{ background: M3.warnContainer, borderRadius: R.md, padding: '12px 14px', fontSize: 14, color: '#5a3e00' }}>{t('vr.voorstel.verouderd')}</div>
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: M3.neutral }}>{t('vr.voorstel.uitleg')}</p>
            {fout && <p role="alert" style={{ margin: '0 0 10px', fontSize: 13, color: M3.error }}>{fout}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => beslis('accept')}
                disabled={bezig !== null}
                style={{ border: 'none', borderRadius: 980, padding: '9px 20px', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: bezig ? 'default' : 'pointer', background: M3.primary, color: '#fff' }}
              >
                {bezig === 'accept' ? t('fb.versturenBezig') : t('vr.voorstel.akkoord')}
              </button>
              <button
                onClick={() => beslis('decline')}
                disabled={bezig !== null}
                style={{ border: `1px solid ${M3.outlineVariant}`, borderRadius: 980, padding: '9px 20px', fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: bezig ? 'default' : 'pointer', background: M3.surface, color: M3.onSurface }}
              >
                {bezig === 'decline' ? t('fb.versturenBezig') : t('vr.voorstel.nietAkkoord')}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  )
}
