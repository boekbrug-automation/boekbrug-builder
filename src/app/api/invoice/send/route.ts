// src/app/api/invoice/send/route.ts
// [BOEK-031] Invoice send — May 2026
// [FACTUUR-A] Legal delivery rebuild — June 2026
// =====================================================
// Flow: draft → sent
// - Generates invoice_number if missing (drafts)
// - Updates DB status + number (this is the legal trigger per Wet OB 1968)
// - [FACTUUR-A] Renders the invoice PDF server-side and ATTACHES it to the
//   delivery e-mail — the recipient now receives the actual legal invoice,
//   not a bare notification (critical defect #1).
// - [FACTUUR-A] Stores pdf_url (raw storage path, signed on read) best-effort.
// - [FACTUUR-A] resend=true mode: re-deliver PDF + e-mail for an already-sent
//   invoice WITHOUT touching number/status (recovery path for pdf_failed /
//   email_failed warnings).
// - Audit log via service_role
// - Notifies accountant (best-effort, via service_role)
// - Rate limit: 100 sends/hour per user (via RATE_LIMITS.INVOICE_SEND)
//
// Per Dutch Belastingdienst (Article 35 — Wet OB 1968):
// Once number is generated and committed to DB, the invoice is legally sent.
// E-mail is the delivery mechanism, not the legal trigger.
//
// [FACTUUR-A] Failure ordering (decided with M, June 2026):
//   number commit (point of no return) → PDF render → e-mail with attachment.
//   * PDF render fails AFTER number commit → invoice stays 'sent' (number is
//     consumed, Art. 35 — no rollback), NO e-mail goes out (a notification
//     without the invoice is exactly the defect we are killing), response
//     carries warning:'pdf_failed' → user re-delivers via resend.
//   * E-mail fails → warning:'email_failed' → same resend recovery.
//   Nothing incomplete ever reaches the recipient.
//
// TODO: Add DB trigger for AUTO-UPDATE updated_at, then remove manual setting
// TODO(BRIDGE-C): swap generateInvoiceNumber internals to a PostgreSQL
//   sequence — closes the SELECT-then-compute race. Call site stays as-is.
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { sendInvoiceToClient } from '@/lib/email'
// [FACTUUR-BIJLAGE] Of het eigen bestand mee mag, en wat de ondernemer leest als het niet kan.
import { attachmentRefusal, attachmentRefusalText, safeAttachmentName } from '@/lib/invoice-attachment'
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from '@/lib/storage-path'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { ublAttachmentForInvoice } from '@/lib/ubl-for-email'
// [KOR-FACTUUR] Geen btw onder de KOR — gecontroleerd vlak vóór het nummer wordt uitgegeven.
import { checkKorInvoice } from '@/lib/kor-invoice'
import { checkReverseChargeInvoice } from '@/lib/reverse-charge-invoice'
import { checkEuZeroRatedInvoice } from '@/lib/client-country'
// [CREDITNOTA-EXTERN] A standalone creditnota names the invoice it corrects, or does not go out.
import { checkStandaloneCreditnota, creditReferenceOf } from '@/lib/creditnota'
// [FACTUUR-DATUMS] Een vervaldatum vóór de factuurdatum — laatste kans vóór het nummer.
import { checkInvoiceDates } from '@/lib/invoice-dates'
import { generateInvoiceNumber, type InvoiceNumberType } from '@/lib/invoice-numbering'
// [BTW-ROUND] Per-tarief afronding — nu uit de gedeelde module, zodat het opslaan van een concept
// (/api/invoice/[id] PUT) en het uitgeven hier per definitie hetzelfde bedrag opleveren.
import { computeInvoiceTotals } from '@/lib/invoice-totals'
import { applyDiscount, parseDiscount } from '@/lib/invoice-discount'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { gateFairUse, type FairUseGate } from '@/lib/fair-use-gate'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, isActingForOther, canSendInvoice } from '@/lib/acting-for'
import { runBankAutoConfirm } from '@/lib/bank-auto-confirm'
// [BETAALBLOK] De betaalgegevens die in de mail horen — zie stap 13c en src/lib/pay-block.ts.
import { payBlockForInvoice } from '@/lib/pay-link'
import * as Sentry from '@sentry/nextjs'

// [FACTUUR-A] Storage bucket for generated invoice PDFs.
// TODO(M): verify this bucket name in Supabase Storage before deploy —
// upload is best-effort and never blocks legal delivery, but pdf_url
// storage only works once the name is right.
const PDF_BUCKET = 'documents'

// [SEND-DURATION] This route had no ceiling, and it is the heaviest — and legally the most
// consequential — request in the app: mint the number, commit it, render the PDF (with a retry),
// upload it, send the e-mail, then run a user-wide bank auto-confirm pass.
//
// Past the "POINT OF NO RETURN" below the number is consumed and cannot be given back (Art. 35 —
// no gaps). A function killed after that commit leaves the invoice legally issued while the
// customer received nothing AND no notification is written — the pdf_failed branch that writes
// one never runs. Meanwhile the client's catch rolls the row back to 'draft', so the screen says
// concept about an invoice that legally exists. The ceiling has to be far enough out that the
// window between the commit and the delivery never closes on a timeout.
export const maxDuration = 120

// [FACTUUR-A] Statuses from which an already-issued invoice may be re-delivered
const RESENDABLE_STATUSES = ['sent', 'paid', 'overdue'] as const

export async function POST(request: NextRequest) {
  // [FAIR-USE] Buiten de try, zodat de catch onderaan de reservering kan teruggeven. Blijft
  // null wanneer het misging vóór het hek — dan valt er ook niets terug te geven.
  let gate: FairUseGate | null = null
  try {
    // ── 1. Auth ────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // [ACTING-FOR] Wie zit hier, en namens wie? Voor een eigenaar is ownerId gelijk aan user.id en
    // verandert er hieronder letterlijk niets. Voor een verkoopmedewerker is ownerId de BAAS —
    // en dat is de enige manier waarop er één nummerreeks per bedrijf blijft bestaan
    // (Art. 35 Wet OB: doorlopend, zonder gaten, en een uitgegeven nummer komt niet terug).
    //
    // [MANDAAT] En sinds het boekhoudersmandaat is er een derde geval. De body wordt daarom HIER
    // gelezen in plaats van bij stap 3: wie de eigenaar is hangt af van `namens_klant_id`, en dat
    // moet vaststaan vóór de eerste query. Zonder dat veld gebeurt letterlijk hetzelfde als
    // vroeger — de eigenaar en de verkoopmedewerker raken geen regel van deze uitbreiding.
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }
    const namensKlantId =
      typeof body.namens_klant_id === 'string' && body.namens_klant_id ? body.namens_klant_id : null

    const acting = namensKlantId ? await getActingForClient(namensKlantId) : await getActingFor()
    if (!acting) {
      return namensKlantId
        ? NextResponse.json(
            { error: 'Je hebt geen toestemming om namens deze klant te factureren' },
            { status: 403 },
          )
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const ownerId = invoiceOwnerId(acting)
    // Waar de MENS die op de knop drukte naartoe moet als er iets misgaat. Voor een medewerker is
    // dat zijn eigen lijst, voor een boekhouder het dossier van deze klant — '/dashboard/verkoop'
    // is voor hem een scherm dat hij niet eens mag openen.
    const actorLink = acting.role === 'boekhouder' ? `/dashboard/clients/${ownerId}` : '/dashboard/verkoop'

    // ── 2. Rate limit — 100 sends/hour per user ────────────────
    // Op de MENS, niet op het bedrijf: dit hek gaat over snelheid, en twee mensen die allebei
    // netjes werken horen elkaar niet te blokkeren.
    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/send',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    // [FAIR-USE] Het tweede hek (de gepubliceerde maandgrens op verstuurde facturen) stond
    // hiér, meteen na het snelheidshek — en dat was te vroeg. gateFairUse VERBRUIKT direct, en
    // daarna volgen zestien uitgangen die niets versturen: een ontbrekend klantadres, een
    // ontbrekend BTW-nummer van de ondernemer zelf, een verlopen concept, het verloren
    // race-409. Alleen de catch gaf terug, dus elk van die weigeringen kostte de gebruiker een
    // factuur van zijn maandtegoed voor een factuur die nooit de deur uit ging. Wie zijn
    // KvK-nummer nog niet had ingevuld en vijf keer op Versturen drukte, was vijf facturen
    // kwijt aan nul verzendingen — terwijl /eerlijk-gebruik §3 het omgekeerde belooft.
    //
    // Het hek staat nu waar het over gaat: vlak vóór het uitgeven van het nummer (stap 8), na
    // alle validatie. Daarmee telt precies één ding mee — een factuur die echt wordt uitgegeven.
    // Een HERVERZENDING passeert het niet eens: die geeft geen nummer uit en levert alleen de
    // al-getelde factuur opnieuw af, dus het herstelpad na onze eigen pdf_failed/email_failed
    // ("verstuur opnieuw") kost de gebruiker niets meer.

    // ── 3. Parse body ──────────────────────────────────────────
    // (Gelezen bij stap 1 — zie [MANDAAT] daar: de eigenaar hangt ervan af.)
    // [HERSTEL] corrected=true is the FALLBACK signal from the edit route for a database where
    // invoice_corrected_at.sql is still open. Where the column exists, the row itself says
    // whether this delivery is a corrected one — see the derivation under the status check.
    const { invoiceId, resend = false, corrected = false } = body
    // resend=true: [FACTUUR-A] re-deliver PDF+e-mail for an already-sent
    //   invoice — number/status untouched
    // [OFFERTE-GEEN-OMZETTING] convertOnly is gone. It turned a SENT quote into a numbered factuur
    // in place — the same row, without the deposit settlement, the discount as lines and the
    // archived quote of the new-invoice path. A quote is mailed as a quote
    // (/api/invoice/[id]/send-offerte) and invoiced through /dashboard/invoice/new?from_offerte=…
    // Refused, not ignored: a caller that asked for a conversion and got a plain send would mint
    // a number by surprise.
    if ((body as { convertOnly?: unknown }).convertOnly === true) {
      return NextResponse.json(
        { error: 'Een offerte wordt niet meer omgezet: verstuur hem als offerte en maak de factuur via "Maak factuur aan".', code: 'conversion_retired' },
        { status: 410 },
      )
    }
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId verplicht' }, { status: 400 })
    }

    // ── 4. Fetch invoice (ownership via RLS + sender_id) ───────
    // [MANDAAT-RLS] Voor een boekhouder werkt dit ALLEEN met de policies uit
    // accountant_invoice_mandate.sql (invoices_mandate_draft_read / _issue en
    // invoice_lines_mandate_read). Zonder die drie geeft deze lees-query nul rijen — een concept is
    // niet `shared`, en `shared` is de kolom waar alle bestaande boekhouderspolicies aan hangen —
    // en antwoordt de route 404 op een factuur die hij zojuist zelf heeft laten aanmaken.
    //
    // De sessie-client blijft hier bewust staan, ook al zou service_role het probleem 'oplossen':
    // service_role zet auth.uid() op NULL, en dan slaat prevent_accountant_amount_changes() over.
    // Juist bij het uitgeven van een factuur onder andermans BTW-nummer wil je die trigger erbij.
    // [FACTUUR-A] select('*') — the PDF needs every field (address block,
    // delivery_date, type). delivery_date lands after the FACTUUR-A migration;
    // select('*') keeps this resilient either way.
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('sender_id', ownerId)
      .single()

    if (invoiceError || !invoiceData) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = invoiceData as any

    // [ACTING-FOR] Twee sloten op dezelfde deur, met opzet.
    // Het eerste is RLS: de policy invoices_member_read laat een medewerker alleen rijen zien
    // met created_by = auth.uid(), dus de query hierboven geeft hem de factuur van zijn baas
    // niet eens terug. Het tweede is deze regel, die hetzelfde nog eens in de code toetst.
    // Dubbel? Ja. Maar dit is het moment waarop een geraden invoiceId binnenkomt, en de
    // gevolgen van hier doorlopen zijn onomkeerbaar: een nummer uitgeven, een PDF versturen
    // naar de klant van iemand anders. Voor die prijs is één extra if goedkoop.
    if (!canSendInvoice(acting, invoice)) {
      return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    }

    // ── 5. Status check ────────────────────────────────────────
    // normal send:  only drafts, and never a quote ([OFFERTE-GEEN-OMZETTING] below)
    // resend:       already-issued invoices with a number — re-delivery only
    if (resend) {
      if (!RESENDABLE_STATUSES.includes(invoice.status) || !invoice.invoice_number) {
        return NextResponse.json(
          { error: 'Alleen verzonden facturen kunnen opnieuw worden verstuurd' },
          { status: 400 }
        )
      }
    } else if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: 'Factuur kan niet meer worden verzonden — al verzonden' },
        { status: 400 }
      )
    }
    // [OFFERTE-GEEN-OMZETTING] A quote never passes this door. Every path through here used to
    // CONVERT it: a draft pro_forma came out as a numbered factuur, mailed, in one tap, so the
    // quote and the invoice were one row and the new-invoice path — the deposit settlement, the
    // discount as lines, the archived quote — never ran. Refused before anything is minted. The
    // resend branch above cannot reach a quote either: a quote never carries a number.
    if (!resend && (invoice.invoice_type === 'pro_forma' || invoice.invoice_type === 'offerte')) {
      return NextResponse.json(
        { error: 'Een offerte verstuur je als offerte; de factuur maak je via "Maak factuur aan".', code: 'quote_not_sendable_here' },
        { status: 409 },
      )
    }

    // [HERSTEL] Is this delivery a CORRECTED one — wording "vervangt de eerdere versie" and a
    // versioned PDF beside the original? Derived from the ROW where possible: once an invoice
    // has been corrected (corrected_at set by the edit route), EVERY later delivery is a
    // corrected delivery, because the customer may hold the old version forever. That includes
    // the recovery path — a plain "verstuur opnieuw" after a failed correction mail — which the
    // double-check caught delivering the corrected content under an uncorrected cover letter.
    //
    // The request flag remains ONLY as the fallback for a database where the migration is still
    // open, and is then held to the same rules the edit route enforces: owner only (a member
    // must not be able to mail "de eerdere versie is vervallen" about the owner's document),
    // resend only, factuur only, and never on a paid invoice.
    const correctedDelivery =
      Boolean(resend) &&
      invoice.invoice_type === 'factuur' &&
      (invoice.corrected_at != null ||
        (corrected === true && !isActingForOther(acting) && ['sent', 'overdue'].includes(invoice.status)))
    // ── 6. Required fields validation ──────────────────────────
    if (!invoice.client_email) {
      return NextResponse.json({ error: 'Klant e-mail ontbreekt' }, { status: 400 })
    }
    if (!invoice.client_name) {
      return NextResponse.json({ error: 'Klant naam ontbreekt' }, { status: 400 })
    }
    if (invoice.total_inc_btw === null || invoice.total_inc_btw === undefined) {
      return NextResponse.json({ error: 'Factuurbedrag ontbreekt' }, { status: 400 })
    }

    // ── 6b. [TRUST-TOTALS] Recompute the legal totals SERVER-SIDE from the lines ─
    // The browser-supplied totals are never trusted on the record that gets a legal
    // number and is e-mailed. The create path stored raw floats; only the edit PUT
    // rounded — so the stored total depended on whether the draft was touched. We
    // recompute here for issuance and conversion, through the SAME shared module the edit
    // route uses (lib/invoice-totals). A resend delivers the already-issued PDF, untouched.
    //
    // [LINES-READ-HONEST] The error is read, and a failed read REFUSES. supabase-js does not
    // throw — it answers a failed read with { data: null, error } — so `const { data: lines }`
    // turned a database problem into "this invoice has no lines", and both consumers below take
    // that silently:
    //   · computedTotals stays null, so finalTotalInc falls back to invoice.total_inc_btw — the
    //     browser-supplied figure this very block exists to stop trusting on the record that gets
    //     a legal number;
    //   · renderInvoicePdf receives `lines ?? []` and renders an invoice with an EMPTY item table.
    // It is then e-mailed to the customer, and it carries a consumed art. 35 number that cannot be
    // rolled back. An invoice without its goods or services does not meet art. 35 lid 1 sub e-g,
    // and no later correction can un-send it.
    //
    // Refusing here costs nothing: this runs BEFORE the number is committed (step 11), so nothing
    // has been written and the owner simply presses send again. An EMPTY list is not an error —
    // an older or imported invoice can legitimately carry only a header, which is why the guard
    // below still tests length rather than presence.
    const { data: lines, error: linesError } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
    if (linesError) {
      console.error('[LINES-READ-HONEST] invoice_lines read failed — refusing to issue', {
        invoiceId, error: linesError.message,
      })
      return NextResponse.json(
        {
          error: 'We konden de factuurregels nu niet ophalen. Er is niets verstuurd en er is geen ' +
            'factuurnummer gebruikt — probeer het zo meteen opnieuw.',
          code: 'lines_unavailable',
        },
        { status: 503 },
      )
    }

    // [HERSTEL] A resend renders the PDF from the lines as they stand RIGHT NOW — and the edit
    // route swaps lines with a non-transactional delete-then-insert. In that window an issued,
    // outgoing factuur with a real total briefly has ZERO lines, and [LINES-READ-HONEST] above
    // deliberately lets an empty list through (an imported incoming invoice can legitimately be
    // header-only). An OWN outgoing factuur that carries money cannot: it was created from
    // lines. Refuse the delivery instead of mailing a numbered PDF with an empty item table.
    if (
      resend &&
      invoice.direction !== 'incoming' &&
      invoice.invoice_type === 'factuur' &&
      Math.abs(Number(invoice.total_inc_btw ?? 0)) > 0.005 &&
      (lines ?? []).length === 0
    ) {
      return NextResponse.json(
        { error: 'De factuurregels zijn tijdelijk niet leesbaar — probeer het zo meteen opnieuw.' },
        { status: 409 }
      )
    }
    let computedTotals: { total_ex_btw: number; btw_amount: number; total_inc_btw: number } | null = null
    if (!resend && Array.isArray(lines) && lines.length > 0) {
      // [BTW-ROUND] Round BTW PER TARIEF, then sum — the Belastingdienst/Peppol method the legal
      // PDF (btwBreakdown → round2 per rate) AND the UBL export use. The logic now lives in
      // lib/invoice-totals.ts, shared with the edit route, so the concept the owner saved and the
      // invoice we issue can never differ by the cent they used to differ by.
      // [KORTING] Met de korting van de factuurrij erbij. Zonder dit rekent de uitgifte de
      // totalen opnieuw uit de REGELS en schrijft ze over de verlaagde bedragen heen: de
      // ondernemer geeft 10% korting, het concept toont het verlaagde bedrag, en de factuur die
      // zijn klant krijgt draagt de volle prijs met een genummerd, onherroepelijk document
      // eromheen. De kolommen bestaan pas na invoice_discount.sql; parseDiscount geeft dan null en
      // dit is letterlijk de oude regel.
      const kortingHier = parseDiscount(invoice.discount_type, invoice.discount_value)
      if (kortingHier) {
        const d = applyDiscount(lines as { line_total?: number | null; btw_rate?: number | null }[], kortingHier)
        computedTotals = { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw }
      } else {
        computedTotals = computeInvoiceTotals(lines)
      }
    }
    // The authoritative total for the e-mail + accountant notification below.
    const finalTotalInc = computedTotals?.total_inc_btw ?? invoice.total_inc_btw

    // ── 7. The document's type. A quote was refused in step 5, so this is a factuur or a creditnota ─
    const finalType: string = invoice.invoice_type ?? 'factuur'

    // [LEVERDATUM] Resolved ONCE, here, because two things downstream need the same answer: the
    // UPDATE that commits the number, and the PDF that is rendered from the PRE-update row. Fixing
    // only the database would have left the document that actually reaches the customer without
    // the leverdatum — the row would be right and the invoice still wrong. Null when there is
    // nothing to do, which is every ordinary send. See the UPDATE below for the full argument.
    const leverdatumBijVerzending: string | null =
      !resend &&
      'delivery_date' in invoice &&
      !invoice.delivery_date &&
      (finalType === 'factuur' || finalType === 'creditnota') &&
      typeof invoice.invoice_date === 'string'
        ? invoice.invoice_date
        : null

    // [FACTUUR-A] Art. 35a sub c — customer ADDRESS is a mandatory invoice
    // element. Enforced server-side (defense in depth; the UI enforces it
    // too). Applies on first issuance of a factuur/creditnota — resend of an
    // already-issued invoice is delivery only, not issuance.
    if (!resend && (finalType === 'factuur' || finalType === 'creditnota')) {
      if (!invoice.client_address || !String(invoice.client_address).trim()) {
        return NextResponse.json(
          { error: 'Klantadres ontbreekt — verplicht op een factuur (Art. 35a Wet OB 1968)' },
          { status: 400 }
        )
      }

      // [FACTUUR-A] Art. 35a sub e — the DATE OF ISSUE is a mandatory invoice element. Without this
      // an undated factuur could be issued (number minted + e-mailed), which is legally invalid AND
      // date-driven downstream (a dateless invoice is dropped from the quarter's date-range → invisible
      // in /result and /aangifte). Enforce a real ISO date BEFORE minting the number so the check never
      // burns a sequence number. (The UI already requires it; this is the server backstop.)
      if (!invoice.invoice_date || !/^\d{4}-\d{2}-\d{2}/.test(String(invoice.invoice_date))) {
        return NextResponse.json(
          { error: 'Factuurdatum ontbreekt — verplicht op een factuur (Art. 35a Wet OB 1968)' },
          { status: 400 }
        )
      }

      // [SEC-SELLER] Art. 35a sub a/b — the SELLER's own name/address, BTW-id and
      // KvK are mandatory on a legal invoice. They were never enforced, so an
      // invoice could be issued (number consumed, e-mailed) with these printed as
      // "—" on the PDF. Enforce BEFORE minting the number so a failed check never
      // burns a sequence number. IBAN stays optional (payment info, not a validity
      // requirement). Reviewed values live on the seller's profile.
      // [ACTING-FOR] Het profiel van de VERKOPER — dat is de eigenaar, ook als een medewerker op de
      // knop drukt: zijn naam, adres, BTW-id en KvK staan op de factuur. Voor een medewerker is
      // die profielrij via RLS onleesbaar, dus dan langs service_role. Zou dat niet gebeuren,
      // dan kwam deze controle terug met "geen profiel" en zou de factuur worden geweigerd met
      // een melding over ontbrekende bedrijfsgegevens die wél gewoon ingevuld zijn.
      const { data: sellerProfile } = await (isActingForOther(acting) ? createPipelineClient() : supabase)
        .from('profiles')
        // [KOR-FACTUUR] `kor_active` erbij: zonder die kolom kan deze route niet zien dat de
        // eigenaar geen btw mag rekenen, en dat is precies de controle hieronder.
        .select('btw_number, kvk_number, address, company_name, full_name, kor_active')
        .eq('id', ownerId)
        .single()
      const missingSeller: string[] = []
      if (!sellerProfile?.btw_number || !String(sellerProfile.btw_number).trim()) missingSeller.push('BTW-nummer')
      if (!sellerProfile?.kvk_number || !String(sellerProfile.kvk_number).trim()) missingSeller.push('KvK-nummer')
      if (!sellerProfile?.address || !String(sellerProfile.address).trim()) missingSeller.push('adres')
      if (!sellerProfile?.company_name?.trim() && !sellerProfile?.full_name?.trim()) missingSeller.push('bedrijfsnaam')
      if (missingSeller.length > 0) {
        return NextResponse.json(
          {
            error: `Vul eerst je ${missingSeller.join(', ')} in bij Instellingen — wettelijk verplicht op een factuur (Art. 35a Wet OB 1968).`,
            missing_seller_fields: missingSeller,
          },
          { status: 400 }
        )
      }

      // [KOR-FACTUUR] Geen btw onder de kleineondernemersregeling — en dit is het laatste moment
      // waarop dat nog gratis te herstellen is.
      //
      // Hierna wordt een nummer uitgegeven en gaat het document de deur uit. Staat er dan btw op,
      // dan is die verschuldigd op grond van art. 37 Wet OB (wie btw op een factuur vermeldt, is
      // hem verschuldigd), terwijl de KOR juist elk recht op aftrek wegneemt — dus er staat niets
      // tegenover. Terugdraaien kan alleen nog met een creditnota naar een klant die niets fout
      // deed.
      //
      // Het aanmaakscherm biedt onder de KOR alleen 0% aan, dus normaal komt hier nooit iets langs.
      // Deze controle vangt wat het scherm niet kan: een concept dat is opgesteld VÓÓRDAT de KOR
      // werd aangezet, en elk verzoek dat niet uit dat scherm komt.
      //
      // Weigeren, niet stilzwijgend corrigeren: de bedragen aanpassen van een document dat de
      // ondernemer net heeft nagekeken, op de enige onomkeerbare knop in de app, is geen oplossing.
      // [FACTUUR-DATUMS] Ook hier, en vóór het nummer: een concept kan zijn gemaakt toen deze
      // controle er nog niet was, en niet elk verzoek komt van het scherm.
      const datums = checkInvoiceDates({ invoiceDate: invoice.invoice_date, dueDate: invoice.due_date })
      if (!datums.ok) {
        return NextResponse.json({ error: datums.error, code: datums.code }, { status: 400 })
      }

      const korCheck = checkKorInvoice({
        korActive: (sellerProfile as { kor_active?: boolean | null } | null)?.kor_active,
        lines: (lines ?? []) as { btw_rate?: number | null }[],
      })
      if (!korCheck.ok) {
        return NextResponse.json({ error: korCheck.error, code: korCheck.code, lines: korCheck.lines }, { status: 400 })
      }

      // [VERLEGD-VERKOOP] A verlegd line needs the customer's btw-id on the document (art. 35a lid 1
      // sub d), cannot carry btw, and does not exist under the KOR. Before the number, like the KOR
      // check: a refused draft is harmless, a numbered deficient invoice can only be credited.
      const verlegdCheck = checkReverseChargeInvoice({
        korActive: (sellerProfile as { kor_active?: boolean | null } | null)?.kor_active,
        clientBtwNumber: (invoice as { client_btw_number?: string | null }).client_btw_number,
        lines: (lines ?? []) as { btw_rate?: number | null; vat_treatment?: string | null }[],
      })
      if (!verlegdCheck.ok) {
        return NextResponse.json({ error: verlegdCheck.error, code: verlegdCheck.code, lines: verlegdCheck.lines }, { status: 400 })
      }

      // [KLANT-LAND] A 0% factuur to a business in another member state without the customer's
      // btw-id is not zero-rated at all (art. 138 BTW-richtlijn): the seller owes the 21%. Refused
      // before the number, beside the KOR and verlegd checks. An unknown country reads as the
      // Netherlands, so nothing changes for an owner who never recorded one.
      const euCheck = checkEuZeroRatedInvoice({
        clientCountry: (invoice as { client_country?: string | null }).client_country,
        clientBtwNumber: (invoice as { client_btw_number?: string | null }).client_btw_number,
        invoiceType: finalType,
        korActive: (sellerProfile as { kor_active?: boolean | null } | null)?.kor_active,
        lines: (lines ?? []) as { btw_rate?: number | null; vat_treatment?: string | null }[],
      })
      if (!euCheck.ok) {
        return NextResponse.json({ error: euCheck.error, code: euCheck.code }, { status: 400 })
      }

      // [CREDITNOTA-EXTERN] Art. 219 Richtlijn 2006/112/EG — a creditnota that names no invoice is
      // not one. The linked flow carries original_invoice_id; a standalone creditnota must carry
      // the number the owner typed. Before the number, like every check here. Skipped on an
      // installation whose row does not know the column yet: nothing could have been typed there.
      if ('credited_invoice_number' in invoice) {
        const verwijzing = checkStandaloneCreditnota({
          invoiceType: finalType,
          originalInvoiceId: (invoice as { original_invoice_id?: string | null }).original_invoice_id,
          creditedNumber: (invoice as { credited_invoice_number?: string | null }).credited_invoice_number,
        })
        if (!verwijzing.ok) {
          return NextResponse.json({ error: verwijzing.error, code: verwijzing.code }, { status: 400 })
        }
      }
    }

    // ── 7b. [FACTUUR-BIJLAGE] De eigen bijlage, VOOR het nummer ──────────────
    //
    // Hier en niet verderop, en dat is de hele reden dat dit blok bestaat. Een paar regels lager
    // wordt een nummer gemunt uit de doorlopende reeks (Art. 35 — onomkeerbaar, geen gaten).
    // Blijkt de bijlage pas daarna onleesbaar, dan zijn er twee slechte uitkomsten en geen goede:
    // versturen zonder het bestand dat de ondernemer er bewust bij zette (de klant krijgt een
    // onvolledig pakket en kan de factuur niet verwerken), of afbreken met een nummer dat al weg
    // is. Dus: eerst ophalen, dan pas nummeren.
    //
    // De kolom bestaat pas na invoice_bijlage.sql. Op een database waar die migratie nog open
    // staat is `attachment_document_id` simpelweg undefined en slaat dit blok zichzelf over —
    // exact de route van hiervoor.
    let bijlage: { filename: string; content: Buffer } | null = null
    // Uit het VERZOEK als het scherm er iets over zegt, anders wat er op de factuur staat. Het
    // scherm kiest de bijlage vlak voor het versturen, dus die keuze moet hier binnen kunnen komen
    // zonder eerst een aparte opslagronde — en hij wordt hieronder op de factuur vastgelegd, zodat
    // opnieuw versturen dezelfde bijlage meeneemt.
    //
    // DRIE standen, niet twee. Het verschil tussen "ik zeg er niets over" en "geen bijlage" is de
    // hele mogelijkheid om een bijlage weer WEG te halen:
    //
    //   · sleutel afwezig  → neem wat er op de factuur staat (de cron, het bewerkscherm, elke
    //                        aanroeper die van bijlagen niets weet — die mogen er niets aan
    //                        veranderen alleen omdat ze zwijgen);
    //   · sleutel met id   → dit bestand, en leg het vast op de factuur;
    //   · sleutel met null → GEEN bijlage, en haal hem ook van de factuur af.
    //
    // Zonder die derde stand was een eenmaal vastgelegde bijlage er niet meer af te krijgen: de
    // route viel altijd terug op de kolom, dus belandde het bestand in de prullenbak, dan weigerde
    // elke verzending met "kies een ander bestand" en was er geen manier om dat te doen.
    const bijlageMeegestuurd = !!body && typeof body === 'object' && 'attachment_document_id' in body
    const gevraagdeBijlage = typeof body?.attachment_document_id === 'string' && body.attachment_document_id
      ? body.attachment_document_id
      : null
    const bijlageId = bijlageMeegestuurd
      ? gevraagdeBijlage
      : ((invoice as { attachment_document_id?: string | null }).attachment_document_id ?? null)
    if (bijlageId) {
      // Namens een medewerker is de documentrij van de eigenaar via RLS onleesbaar; dan langs
      // service_role, precies zoals de rest van deze route dat doet.
      const bijlageClient = isActingForOther(acting) ? createPipelineClient() : supabase
      const { data: bijlageDoc, error: bijlageErr } = await bijlageClient
        .from('documents')
        .select('id, user_id, file_name, file_url, file_size, file_type, trashed')
        .eq('id', bijlageId)
        // [RLS-UIT] Op de EIGENAAR, in de query zelf. Het id komt uit het verzoek en is dus
        // attacker-supplied; attachmentRefusal weigert andermans bestand hieronder ook, maar een
        // filter in code is de tweede verdedigingslinie en niet de eerste. Namens een medewerker
        // loopt dit langs service_role, en dan is deze regel het enige wat er tussen zit.
        .eq('user_id', ownerId)
        .maybeSingle()

      if (bijlageErr) {
        // [LOCK-READ-HONEST] Niet kunnen kijken is niet hetzelfde als "er is niets". Weigeren, en
        // zeggen dat het tijdelijk is — er is nog niets verbruikt.
        return NextResponse.json(
          { error: 'We konden de bijlage nu niet ophalen. Er is nog niets verstuurd — probeer het zo meteen opnieuw.' },
          { status: 503 },
        )
      }

      const weigering = attachmentRefusal(bijlageDoc as Parameters<typeof attachmentRefusal>[0], ownerId)
      if (weigering) {
        return NextResponse.json({ error: attachmentRefusalText(weigering), code: `attachment_${weigering}` }, { status: 400 })
      }

      // [SEC-STORAGE-PATH] attachmentRefusal above proved the ROW is this owner's. It says nothing
      // about where the row POINTS: file_url is ordinary text, and the pipeline client bypasses the
      // bucket policy that would otherwise catch a key from another tenant's folder. Two different
      // claims — see the header of storage-path.ts, which was written for exactly this shape and is
      // already applied at four other doors.
      const pad = toStoragePath((bijlageDoc as { file_url: string }).file_url)
      if (!pathBelongsToOwner(pad, ownerId)) {
        // Deliberately the same sentence as a missing attachment: the owner has one attachment and
        // it cannot be sent, and a message that distinguishes "not yours" from "not found" would
        // tell someone probing which keys exist.
        return NextResponse.json(
          { error: attachmentRefusalText('not_found'), code: 'attachment_not_found' },
          { status: 400 },
        )
      }
      const { data: blob, error: dlErr } = await createPipelineClient().storage.from('documents').download(pad)
      if (dlErr || !blob) {
        return NextResponse.json(
          { error: 'De bijlage kon niet worden gelezen. Er is nog niets verstuurd — probeer het zo meteen opnieuw of kies een ander bestand.' },
          { status: 503 },
        )
      }
      bijlage = {
        filename: safeAttachmentName((bijlageDoc as { file_name: string | null }).file_name),
        content: Buffer.from(await blob.arrayBuffer()),
      }
    }

    // ── 8. Generate number — skipped entirely for resend ───────
    // [FAIR-USE] Het maandhek, hier: alles is gevalideerd, en de eerstvolgende stap geeft een
    // nummer uit dat niet meer teruggegeven kan worden. Faalt open. Een weigering pauzeert
    // ALLEEN het versturen — opstellen, opslaan en als PDF downloaden blijven werken, precies
    // zoals de onExceed-zin in fair-use.ts zegt.
    //
    // [ACTING-FOR] Op het BEDRIJF, niet op de mens: anders zou elke extra verkoopmedewerker een
    // tweede gratis maandtegoed zijn. De planlezing gaat dan langs service_role — het profiel
    // van de eigenaar is voor de sessie van een medewerker onleesbaar, en een mislukte
    // plandetectie zou het bedrijf stilzwijgend op het gratis plan zetten.
    if (!resend) {
      gate = await gateFairUse({
        client: isActingForOther(acting) ? createPipelineClient() : supabase,
        userId: ownerId,
        metric: "invoicesSent",
      })
      if (!gate.allowed) return gate.response!
    }

    // Always for conversion, only if missing for regular drafts
    let finalNumber: string = invoice.invoice_number ?? ''
    if (!resend && !finalNumber) {
      const numberType: InvoiceNumberType =
        finalType === 'creditnota' ? 'creditnota' : 'factuur'

      // [ACTING-FOR] ownerId, en met de SESSIE-client — allebei noodzakelijk.
      // ownerId: één doorlopende reeks per bedrijf (Art. 35). Sessie-client: next_invoice_seq()
      // weigert onvoorwaardelijk zodra auth.uid() NULL is, dus service_role kan hier niet in de
      // plaats treden. De wacht in die functie is verbreed met precies één uitzondering — een
      // actieve verkoopkoppeling — en verder niets. Zie company_members_sales_role.sql.
      // [NUMBER-READ-VISIBLE] Het TEMPLATE-lezen krijgt wél de acting-aware client: de sessie van
      // een medewerker ziet de profiles-rij van de eigenaar niet, en het stille antwoord daarop was
      // het VERKEERDE nummerschema uit de VERKEERDE teller — zie invoice-numbering.ts.
      const generated = await generateInvoiceNumber(
        supabase, ownerId, numberType,
        isActingForOther(acting) ? createPipelineClient() : supabase,
      )
      if (!generated) {
        // No number, so nothing was issued — give the month's credit back.
        await gate?.release()
        return NextResponse.json(
          { error: 'Kon factuurnummer niet genereren' },
          { status: 500 }
        )
      }
      finalNumber = generated
    }

    // ── 9. UPDATE DB — commit number + type (legal trigger) ───
    // Per Belastingdienst: once number is committed, invoice is legally issued.
    // POINT OF NO RETURN — no rollback past this line (Art. 35, no gaps).
    // resend: nothing to commit — delivery only
    if (!resend) {
      // [TRUST-NUMBER] COMPARE-AND-SWAP. The status check in step 5 read a fetched
      // row; two concurrent sends (or a double-click that races the first commit)
      // both passed it and both minted a number under an id-only UPDATE, so one
      // number was orphaned as a permanent gap AND the invoice was e-mailed twice.
      // We now guard the UPDATE on the ORIGINAL state (draft) and require exactly one
      // affected row. The loser of the race writes nothing and does NOT deliver — it
      // gets a clean 409.
      let updateQ = supabase
        .from('invoices')

        .update({
          status: 'sent' as const,
          invoice_number: finalNumber,
          invoice_type: finalType as 'factuur' | 'creditnota' | 'pro_forma' | 'offerte',
          // [LEVERDATUM] Art. 35a lid 1 sub f — the date of supply, on the ONE line where a
          // document that had none becomes a document that needs one.
          //
          // An offerte is stored with delivery_date NULL, and rightly so: an offer delivers
          // nothing. A factuur drafted without one used to go out, numbered, without a leverdatum, and
          // the PDF simply omitted the row, because showLeverdatum needs a value to print. A
          // mandatory element missing from a legal invoice, invisibly — and past this line the
          // number is committed, so it can never be edited, only credited (Art. 35).
          //
          // FILLED, not refused. The invoice date is what /api/invoice/draft already uses when the
          // owner names no separate leverdatum, so this is the same default applied one step later,
          // not a new claim about when the work was done. Refusing here would strand every draft
          // made before the draft door filled it, and the check would have to sit before the number
          // is minted.
          //
          // The key only travels when the column is really there. This UPDATE is the point of no
          // return; on a deployment where the FACTUUR-A migration is still open, an unknown column
          // fails the WHOLE statement — the invoice would be numbered nowhere and sent nowhere.
          // `select('*')` above returns the key iff the column exists, so the row itself answers.
          ...(leverdatumBijVerzending ? { delivery_date: leverdatumBijVerzending } : {}),
          ...(computedTotals ?? {}),
          // [FACTUUR-BIJLAGE] Vastleggen WAT er meeging, en alleen als het scherm zich erover
          // uitsprak. Zonder dit zou opnieuw versturen de bijlage vergeten die de klant de eerste
          // keer wél kreeg — twee mails over dezelfde factuur met een verschillende inhoud.
          //
          // `gevraagdeBijlage` mag hier null zijn, en dat is geen slordigheid maar de bedoeling:
          // het scherm dat "Weghalen" meestuurt WIST de kolom, zodat de volgende verzending de
          // bijlage ook echt niet meer meeneemt. Alleen wie zwijgt verandert niets.
          //
          // Dezelfde voorwaarde als de regel hierboven: de sleutel reist alleen mee als de kolom er
          // is. Deze UPDATE is het punt van geen terugkeer.
          ...(bijlageMeegestuurd && 'attachment_document_id' in invoice
            ? { attachment_document_id: gevraagdeBijlage }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        // [ACTING-FOR] De eigenaar, niet de mens die op de knop drukte.
        .eq('sender_id', ownerId)
      // [TRUST-NUMBER] The status is re-asserted here because the check in step 5 read a
      // fetched row; a row that left 'draft' between the read and this write takes no number.
      updateQ = updateQ.eq('status', 'draft')
      const { data: updatedRows, error: updateError } = await updateQ.select('id')

      if (updateError) {
        // The commit failed, so no number was consumed and nothing was issued.
        await gate?.release()
        console.error('[FACTUUR-A] Invoice update failed', { invoiceId, updateError })
        Sentry.captureException(updateError, {
          tags: { feature: 'invoice-send', severity: 'high' },
          extra: { invoiceId, finalNumber, userId: user.id },
        })
        return NextResponse.json({ error: 'Server fout' }, { status: 500 })
      }
      if (!updatedRows || updatedRows.length === 0) {
        // Lost the compare-and-swap: already sent/converted by a concurrent request.
        // The number we minted is now unused — log it so the rare gap is VISIBLE,
        // never silent — and refuse to double-deliver.
        // We lost the race and delivered nothing; the winner counted its own send.
        await gate?.release()
        console.warn('[TRUST-NUMBER] Send race lost — minted number unused (gap)', { invoiceId, finalNumber })
        Sentry.captureMessage('invoice-send race: minted number unused (sequence gap)', {
          level: 'warning',
          tags: { feature: 'invoice-send' },
          extra: { invoiceId, finalNumber, userId: user.id },
        })
        return NextResponse.json({ error: 'Deze factuur is al verzonden.' }, { status: 409 })
      }

      // ── 10. Audit log — via service_role (BOEK-SECURITY-2) ───
      // status_changed is generic — works for all status transitions
      await logAuditAction({
        userId: user.id,
        action: 'invoice.status_changed',
        entityType: 'invoice',
        entityId: invoiceId,
        oldValue: {
          status: invoice.status,                  // 'draft'
          invoice_number: invoice.invoice_number,  // null or preview
        },
        newValue: {
          status: 'sent',
          invoice_number: finalNumber,
        },
        ipAddress: getClientIP(request),
      })
    }
    // [FACTUUR-A] resend path: no audit log. A resend touches no legal record
    // (no number, status, or amount change) — it is pure re-delivery, so there
    // is nothing auditable. (Avoids inventing a new AuditAction value.)

    // [FACTUUR-BIJLAGE] …met één uitzondering, en die is opzettelijk klein.
    //
    // De vastlegging hierboven zit binnen `if (!resend)`, want daar hoort ze: dat is het blok dat
    // een nummer en een status vastzet. Maar juist bij OPNIEUW versturen wisselt of vervalt een
    // bijlage — het bestand belandde in de prullenbak, of het was het verkeerde. Bleef de kolom
    // dan staan, dan koos de ondernemer "Weghalen", zag de mail vertrekken, en kreeg bij de
    // volgende poging exact dezelfde weigering terug: de keuze gold voor die ene mail en nergens
    // anders.
    //
    // Alleen deze kolom, alleen als het scherm zich erover uitsprak, en op een factuur die haar
    // nummer en status al heeft. Geen juridisch veld, dus ook hier geen auditregel.
    if (resend && bijlageMeegestuurd && 'attachment_document_id' in invoice) {
      const { error: bijlageBewaarErr } = await supabase
        .from('invoices')
        .update({ attachment_document_id: gevraagdeBijlage } as never)
        .eq('id', invoiceId)
        // [ACTING-FOR] De eigenaar, niet de mens die op de knop drukte.
        .eq('sender_id', ownerId)
      if (bijlageBewaarErr) {
        // De mail gaat hierna gewoon weg met de bijlage die de ondernemer koos — die is hierboven
        // al opgehaald. Alleen het ONTHOUDEN mislukte, en daar mag een verzending niet op stuklopen.
        console.error('[FACTUUR-BIJLAGE] bijlagekeuze niet vastgelegd bij opnieuw versturen', {
          invoiceId, error: bijlageBewaarErr.message,
        })
      }
    }

    // ── 11. Fetch sender profile — full row, the PDF needs it all ─
    // [ACTING-FOR] Het profiel van de VERKOPER staat op de PDF — dat is de eigenaar. Voor een
    // medewerker is die rij via RLS onleesbaar, dus dan langs service_role; anders zou de
    // factuur uitgaan met 'Onbekend' als bedrijfsnaam.
    const { data: profile } = await (isActingForOther(acting) ? createPipelineClient() : supabase)
      .from('profiles')
      .select('*')
      .eq('id', ownerId)
      .single()

    const zzperName = profile?.company_name || profile?.full_name || 'Onbekend'

    // ── 12. [FACTUUR-A] Render the legal PDF — AFTER number commit ─
    // The PDF must carry the final number + the server-recomputed totals (lines
    // were fetched in step 6b). It can only be rendered now.
    // [SEND-PDF-RETRY] Render is the delivery gate. A transient font/asset hiccup used to leave the
    // invoice 'sent' (verstuurd) with NO PDF, NO email, NO signal — the customer got nothing and the
    // owner had no idea. Retry once (catches the common transient), and on persistent failure make
    // the failure LOUD (an owner notification) instead of a silent false 'verstuurd'.
    // [CREDITNOTA-EXTERN] The reference a creditnota prints (art. 219): the linked original's
    // number and date, or the external ones the owner typed for a standalone creditnota. Resolved
    // here because the mailed PDF is rendered from the row as read, and the row holds an id, not
    // a number.
    let creditRef: { originalNumber: string | null; originalDate: string | null } = { originalNumber: null, originalDate: null }
    if (finalType === 'creditnota') {
      const rij = invoice as { original_invoice_id?: string | null; credited_invoice_number?: string | null; credited_invoice_date?: string | null }
      let linked: { invoice_number: string | null; invoice_date: string | null } | null = null
      if (rij.original_invoice_id) {
        const { data: origineel } = await supabase
          .from('invoices')
          .select('invoice_number, invoice_date')
          .eq('id', rij.original_invoice_id)
          .eq('sender_id', ownerId)
          .maybeSingle()
        linked = origineel ?? null
      }
      creditRef = creditReferenceOf({
        linkedNumber: linked?.invoice_number,
        linkedDate: linked?.invoice_date,
        creditedNumber: rij.credited_invoice_number,
        creditedDate: rij.credited_invoice_date,
      })
    }
    let pdfBuffer: Buffer | null = null
    for (let attempt = 0; attempt < 2 && !pdfBuffer; attempt++) {
      try {
        pdfBuffer = await renderInvoicePdf(
          {
            ...invoice,
            ...(computedTotals ?? {}),
            invoice_number: finalNumber,
            invoice_type: finalType,
            // [LEVERDATUM] The same value the UPDATE just committed. `invoice` is the row as it
            // was read, so without this line the stored invoice would carry a leverdatum and the
            // PDF in the customer's mailbox would not.
            ...(leverdatumBijVerzending ? { delivery_date: leverdatumBijVerzending } : {}),
            status: resend ? invoice.status : 'sent',
            // [CREDITNOTA-EXTERN] undefined on a factuur — the PDF prints the line only for a creditnota.
            original_invoice_number: creditRef.originalNumber ?? undefined,
            original_invoice_date: creditRef.originalDate ?? undefined,
          },
          lines ?? [],
          profile ?? {}
        )
      } catch (pdfErr) {
        console.error('[FACTUUR-A] PDF render failed', { invoiceId, finalNumber, attempt, error: pdfErr })
        if (attempt === 1) {
          Sentry.captureException(pdfErr, {
            tags: { feature: 'invoice-send', severity: 'high' },
            extra: { invoiceId, finalNumber, userId: user.id },
          })
        }
      }
    }

    if (!pdfBuffer) {
      if (resend) {
        // Pure delivery attempt — nothing was committed, a clean error is honest
        return NextResponse.json({ error: 'PDF genereren mislukt — probeer opnieuw' }, { status: 500 })
      }
      // Number is consumed (Art. 35 — no rollback). The invoice IS legally issued, but it was NOT
      // delivered. Do NOT let the owner believe it went out: write an owner notification so the
      // "verstuurd" state is corrected by an explicit "opnieuw versturen" prompt (recoverable via
      // resend once the cause is fixed). Service-role insert (notifications has no authed INSERT).
      try {
        // [ACTING-FOR] Naar de eigenaar ÉN naar wie hem verstuurde, als dat twee mensen zijn.
        //
        // Alleen de eigenaar waarschuwen is hier niet goed genoeg: het nummer is verbruikt, de
        // klant heeft niets, en de enige die dat weet is degene die net op 'versturen' drukte —
        // die anders zijn scherm sluit in de overtuiging dat het gelukt is. En alleen de
        // medewerker waarschuwen evenmin: het is de factuur van de eigenaar, met zijn nummer.
        const ontvangers = Array.from(new Set([ownerId, acting.actorId]))
        for (const uid of ontvangers) {
          await createNotification({
            userId: uid,
            title: 'Factuur niet verzonden',
            body: `Factuur ${finalNumber} kreeg een nummer maar de PDF kon niet worden gemaakt — de klant heeft niets ontvangen. Verstuur ${finalNumber} opnieuw.`,
            type: 'invoice',
            link: uid === ownerId ? '/dashboard/facturen' : actorLink,
          })
        }
      } catch { /* non-blocking — the warning field below is the primary signal */ }
      return NextResponse.json({
        success: true,
        invoice_number: finalNumber,
        invoice_type: finalType,
        delivered: false,
        warning: 'pdf_failed',
      })
    }

    // ── 13. [FACTUUR-A] Store PDF in Storage — best-effort ─────
    // pdf_url stores the RAW path (house rule: signed on read).
    // Never blocks delivery; failure → Sentry breadcrumb only.
    try {
      // [ACTING-FOR] Onder de map van de EIGENAAR — daar staan al zijn facturen, en de
      // storage-policies zijn per gebruikersmap geschreven.
      //
      // [HERSTEL] Een herstelde factuur krijgt een NIEUW object naast het origineel — nooit
      // eroverheen. `{nummer}.pdf` blijft voor altijd de eerst uitgegeven versie (er is bewust
      // geen UPDATE-policy op storage, zie [PDF-IMMUTABLE] hieronder); de gecorrigeerde versie
      // komt er gedateerd naast en pdf_url gaat mee, zodat de PDF-knop toont wat de klant nu
      // heeft en de kluis bewaart wat hij eerst had.
      const pdfPath = correctedDelivery
        ? `${ownerId}/facturen/${finalNumber}.herstel-${Date.now()}.pdf`
        : `${ownerId}/facturen/${finalNumber}.pdf`
      // [PDF-IMMUTABLE] upsert:false, and that is not a downgrade — it is what this write can
      // actually do, and what it should do.
      //
      // RLS staat aan op storage.objects (gemeten) en er zijn precies drie policies:
      // documents_upload (INSERT), documents_read (SELECT), documents_delete (DELETE). Er is GEEN
      // UPDATE-policy. Een upsert op een pad dat al bestaat is een UPDATE, dus die kon nooit
      // slagen — bij elke HERVERZENDING van dezelfde factuur liep deze regel tegen een weigering
      // aan, die de best-effort-catch eromheen stil opat.
      //
      // Het herstel is niet een vierde policy maar de erkenning dat overschrijven hier verkeerd
      // zou zijn: een verstuurde factuur ligt vast ([ISSUED-STAYS]), dus de PDF die onder dit
      // nummer staat hoort nooit te veranderen. Bestaat het object al, dan is dat de JUISTE
      // eindtoestand en niet een mislukking — pdf_url wijst er al naar sinds de eerste verzending.
      const { error: uploadError } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: false })

      if (!uploadError) {
        await supabase
          .from('invoices')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ pdf_url: pdfPath, updated_at: new Date().toISOString() } as any)
          .eq('id', invoiceId)
      } else {
        console.error('[FACTUUR-A] PDF storage upload failed', { invoiceId, uploadError })
      }
    } catch (storageErr) {
      console.error('[FACTUUR-A] PDF storage block error', { invoiceId, storageErr })
      // Best-effort — delivery continues regardless
    }

    // ── 13b. [E-FACTUUR-MEE] De e-factuur (UBL) als tweede bijlage, best-effort ──
    // Het nummer is al vastgelegd, dus de herlezing hieronder ziet de definitieve factuur — en
    // buildInvoiceUbl is dezelfde generator als /api/export/ubl en het kwartaalpakket, dus de
    // klant leest exact het bestand in dat de boekhouder later ook ziet. Kan hij niet gebouwd
    // worden (profiel zonder KVK, open migratie), dan gaat de mail zonder XML — de PDF is het
    // wettelijke stuk en wacht op niets.
    // [ACTING-FOR] Met de acting-aware client: de sessie van een medewerker of gemachtigde
    // accountant ziet de factuurregels en het profiel van de EIGENAAR niet, en elk van die
    // leesbeurten antwoordt dan null — de mail vertrok stil zonder XML, precies op de facturen
    // die een kantoor verstuurt. De route heeft de bevoegdheid al bewezen vóór dit punt.
    const ublBijlage = await ublAttachmentForInvoice(
      isActingForOther(acting) ? createPipelineClient() : supabase,
      invoiceId,
    )

    // ── 13c. [BETAALBLOK] Hoe de klant kan betalen ─────────────
    // Deze mail vroeg om geld en gaf geen enkele manier om het over te maken: het IBAN, het
    // kenmerk en de scan-QR stonden uitsluitend IN de PDF-bijlage — en een QR-code in een bijlage
    // kan niet gescand worden door de telefoon die hem toont. Ondertussen bestond /pay/[token] al:
    // een afgemaakte publieke pagina met bedrag, kenmerk, QR en (bij gekoppelde Mollie) iDEAL,
    // bereikbaar voor niemand tenzij de ondernemer zélf op "Betaalverzoek" drukte en de link
    // doorstuurde. Hier worden die twee eindelijk verbonden.
    //
    // Best-effort en nooit blokkerend: null (geen IBAN, een creditnota, al betaald) levert exact
    // de mail op die deze klant altijd al kreeg. De acting-aware client, om dezelfde reden als bij
    // de UBL hierboven: een medewerker leest de profielrij van de eigenaar niet, en zonder dat
    // profiel is er geen IBAN en dus geen blok.
    const payBlok = await payBlockForInvoice(
      isActingForOther(acting) ? createPipelineClient() : supabase,
      {
        invoice: {
          id: invoiceId,
          direction: 'outgoing',
          invoice_type: finalType,
          // De status IS op dit punt al 'sent' in de database; de lokale `invoice` is de rij van
          // vóór het commit. De letterlijke waarde is wat buildBetaalverzoek moet zien.
          status: 'sent',
          invoice_number: finalNumber,
          payment_reference: invoice.payment_reference ?? null,
          total_inc_btw: finalTotalInc,
          amount_paid: invoice.amount_paid ?? 0,
          client_name: invoice.client_name,
          pay_token: (invoice as { pay_token?: string | null }).pay_token ?? null,
          due_date: invoice.due_date ?? null,
        },
        owner: {
          iban: profile?.iban ?? null,
          company_name: profile?.company_name ?? null,
          full_name: profile?.full_name ?? null,
        },
        ownerId,
      },
    )

    // ── 14. Send e-mail WITH the PDF attached ──────────────────
    // [FACTUUR-A] Art. 35a requires the numbered document to reach the recipient.
    let emailFailed = false
    try {
      await sendInvoiceToClient({
        toEmail: invoice.client_email,
        clientName: invoice.client_name,
        zzperName,
        // [FACTUUR-BIJLAGE] Al opgehaald en gekeurd voordat er een nummer bestond.
        extraAttachment: bijlage,
        invoiceNumber: finalNumber,
        totalInc: finalTotalInc,
        dueDate: invoice.due_date ?? '',
        invoiceDate: invoice.invoice_date ?? undefined,
        pdfBuffer,
        // [E-FACTUUR-MEE] Naast de PDF, als hij gebouwd kon worden.
        ublAttachment: ublBijlage,
        isCreditnota: finalType === 'creditnota',
        // [HERSTEL] The mail says this is the corrected version replacing the earlier one.
        isCorrected: correctedDelivery,
        // [ANTWOORD-ADRES] Het adres waarmee de ondernemer zich heeft aangemeld (profiles.email
        // wordt bij registratie uit auth.users gevuld). Zonder dit komt een antwoord van de klant
        // bij noreply@ terecht.
        senderEmail: profile?.email ?? null,
        // [BETAALBLOK] Zie stap 13c. Null → de mail zoals hij altijd was.
        payBlock: payBlok,
      })
    } catch (emailErr) {
      emailFailed = true
      console.error('[FACTUUR-A] Email send failed', {
        invoiceId,
        finalNumber,
        error: emailErr,
      })
      Sentry.captureException(emailErr, {
        tags: { feature: 'invoice-send', severity: 'medium' },
        extra: { invoiceId, finalNumber, userId: user.id },
      })
      // [SEND-EMAIL-DURABLE] A notification, not only the `warning` in the response below.
      //
      // The screens DO handle warning==='email_failed' (facturen, invoice/new, the recovery
      // banner on the detail page), so an owner who is looking at their screen is told. But that
      // signal lives exactly as long as the response does. Close the tab, lose signal on a phone
      // after the server already committed, walk away while it sends — and it is gone, with
      // nothing left behind.
      //
      // And this state is worse than the PDF failure right above, which DOES leave a
      // notification: there the PDF is missing, so the closing package eventually reports it.
      // Here everything looks perfect. The number is consumed, the status says 'sent', the PDF
      // is stored, the BTW is declared on it — and the customer received nothing. The owner will
      // not chase a payment for an invoice their own screen calls sent.
      //
      // Same recipients and the same reasoning as the PDF path: the owner owns the invoice, and
      // whoever pressed send is the only one who knows it happened at all.
      try {
        const mailOntvangers = Array.from(new Set([ownerId, acting.actorId]))
        for (const uid of mailOntvangers) {
          await createNotification({
            userId: uid,
            title: 'Factuur niet aangekomen',
            body: `Factuur ${finalNumber} is genummerd en opgeslagen, maar de e-mail naar de klant is niet verstuurd — de klant heeft niets ontvangen. Verstuur ${finalNumber} opnieuw.`,
            type: 'invoice',
            link: uid === ownerId ? '/dashboard/facturen' : actorLink,
          })
        }
      } catch { /* non-blocking — the warning in the response stays the primary signal */ }
    }

    // ── 15. Notify accountant — best-effort, via service_role ─
    // notifications.INSERT requires service_role per RLS Phase 2
    // [FACTUUR-A] first issuance only — a resend is not a new invoice
    if (!resend) {
      try {
        const pipelineClient = createPipelineClient()

        // [MANDAAT] De andere kant op: stuurde de BOEKHOUDER deze factuur namens de klant, dan
        // moet de KLANT het weten. Dit is geen nette extra — het is de helft die van art. 35a een
        // waarheid maakt in plaats van een zin in de voorwaarden. De ondernemer blijft zelf
        // aansprakelijk voor elke factuur die onder zijn naam en BTW-nummer uitgaat, en dat kan
        // hij alleen zijn als hij weet dat hij bestaat. Zonder dit bericht kan er maanden onder
        // zijn nummer worden gefactureerd zonder dat hij ooit iets ziet.
        //
        // Best-effort, net als het bericht hieronder: de factuur is al uitgegeven en gaat niet
        // terug omdat een melding niet lukt. Wat wél gebeurt is dat het in de log staat.
        if (acting.role === 'boekhouder') {
          const klantMelding = await createNotification({
            userId: ownerId,
            title: 'Je boekhouder heeft een factuur verstuurd',
            body: `Factuur ${finalNumber} is namens jou verstuurd naar ${invoice.client_name || 'je klant'} — € ${Number(finalTotalInc).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. De factuur staat op jouw naam en in jouw nummerreeks.`,
            type: 'invoice',
            link: '/dashboard/facturen',
          })
          if (!klantMelding.ok) {
            console.error('[MANDAAT] melding aan de klant mislukt', { invoiceId, error: klantMelding.error })
          }
        }

        const { data: accountantLink } = await pipelineClient
          .from('accountant_clients')
          .select('accountant_id')
          .eq('zzper_id', ownerId)
          .maybeSingle()

        // Niet aan zichzelf melden dat hij zojuist zelf op de knop drukte.
        if (accountantLink?.accountant_id && accountantLink.accountant_id !== acting.actorId) {
          const accountantMelding = await createNotification({
            userId: accountantLink.accountant_id,
            title: 'Nieuwe factuur verzonden',
            // [FACTUUR-A] Dutch comma in the notification too — one rule everywhere
            body: `${zzperName} heeft factuur ${finalNumber} verzonden — € ${Number(finalTotalInc).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            type: 'invoice',
            link: `/dashboard/clients/${ownerId}`,
          })

          if (!accountantMelding.ok) {
            console.error('[FACTUUR-A] Notification insert failed', { invoiceId, error: accountantMelding.error })
            // Low severity — don't bother Sentry
          }
        }
      } catch (notifErr) {
        console.error('[FACTUUR-A] Notification block error', { invoiceId, notifErr })
        // Low severity — don't bother Sentry
      }
    }

    // ── 15b. Close the circle from the SEND side ──────────────
    // [BANK-CIRCLE-SEND] A sales invoice that just became 'sent' may match a payment ALREADY sitting
    // in the bank — the statement was imported before this invoice existed, so it lingered as an
    // "ontvangen betaling zonder factuur" that only the incoming-bank flow (not invoice creation) ever
    // re-checked. Re-run the SAME safe auto-confirm now so the payment gets linked at issuance time.
    // Books only isSafeAutoConfirm matches, idempotent, one-tap reversible. Best-effort — a failure
    // here must never break a legally-sent invoice, and the cron/import paths remain the backstop.
    // First issuance only: a resend re-delivers an already-'sent' invoice (this pass already ran on
    // its original send, and a later-arriving payment is caught by the incoming-bank flow + cron), so
    // skip the full user-wide scan on the latency-sensitive resend path.
    if (!resend) {
      try {
        // [ACTING-FOR] Op het bedrijf. Handelt er een medewerker, dan is de sessie-client
        // waardeloos voor de bankregels van de eigenaar (RLS) — dan gaat de betaalschrijving
        // langs service_role, precies zoals de cron en de import dat doen. bank-auto-confirm
        // beschrijft die modus zelf: dan is de isEligible-controle de gezaghebbende wacht.
        const pipelineForConfirm = createPipelineClient()
        await runBankAutoConfirm({
          payClient: isActingForOther(acting) ? pipelineForConfirm : supabase,
          pipeline: pipelineForConfirm,
          userId: ownerId,
        })
      } catch (autoErr) {
        console.error('[BANK-CIRCLE-SEND] post-send auto-confirm failed (non-fatal)', { invoiceId, autoErr })
      }
    }

    // ── 16. Response ──────────────────────────────────────────
    if (emailFailed) {
      return NextResponse.json({
        success: true,
        invoice_number: finalNumber,
        invoice_type: finalType,
        warning: 'email_failed',
      })
    }

    return NextResponse.json({
      success: true,
      invoice_number: finalNumber,
      invoice_type: finalType,
      // [VERSTUURD] The address a reply lands on, so the confirmation can NAME it instead of
      // promising it. It is profiles.email (filled from auth.users at registration) and it is
      // passed to sendInvoiceToClient as senderEmail — the same value, read once. Null when the
      // profile has none, and then the screen says nothing about replies rather than something
      // that is not true: without it Resend falls back to the noreply sender.
      reply_to: profile?.email ?? null,
    })

  } catch (err) {
    // [FAIR-USE] Klapte het versturen alsnog, dan is er niets verstuurd en telt het niet.
    // `gate` kan hier nog ongedefinieerd zijn als het misging vóór het hek; vandaar de
    // voorzichtige aanroep.
    try { await gate?.release() } catch { /* teruggeven mag nooit de foutafhandeling breken */ }

    // Catch-all: any uncaught exception → Sentry + 500 (no crash)
    console.error('[FACTUUR-A] /api/invoice/send fatal error', err)
    Sentry.captureException(err, {
      tags: { feature: 'invoice-send', severity: 'critical' },
    })
    return NextResponse.json(
      { error: 'Server fout — probeer opnieuw' },
      { status: 500 }
    )
  }
}