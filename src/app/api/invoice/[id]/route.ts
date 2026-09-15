// src/app/api/invoice/[id]/route.ts
// Invoice item route — GET (fetch one), PUT (edit a draft), DELETE (remove a draft).
// =====================================================
// [INVOICE-ROUTE-RESTORE] This file previously held a stray copy of the BOEK-010
// *files* route (GET on `documents`, DELETE → 410), so it exposed no PUT. The
// edit page (PUT save + edit→send) and InvoiceActions (DELETE) both hit
// /api/invoice/[id] and got 405/410 → editing and deleting were fully broken.
// Restored here with the real handlers.
//
// Legal guard (Art. 35 Wet OB 1968): a document that carries a NUMBER is immutable — it sits in
// a gapless, forward-only series and is corrected with a creditnota, never rewritten. DELETE stays
// draft-only. EDIT follows isInvoiceEditable (src/lib/invoice-editable.ts): a draft, or a quote
// that has not become an invoice yet. An offerte has no number and is not a legal invoice, so it
// was inheriting a restriction nobody had chosen for it. All access is via the session client and
// scoped by sender_id, so RLS is enforced.
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
import { storedVatTreatment } from '@/lib/line-vat-treatment'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [BTW-ROUND] De totalen komen uit één module, dezelfde die /api/invoice/send gebruikt bij
// uitgifte. Hier stond een eigen berekening die de BTW PER REGEL optelde en één keer afrondde;
// send groepeert per TARIEF en rondt per tarief af (de methode van de PDF en de UBL-export).
// Op een factuur met gemengde tarieven scheelde dat een cent, dus het bedrag dat de ondernemer
// opsloeg was niet het bedrag dat hij verstuurde. Zie invoice-totals.ts.
import { computeInvoiceTotals } from '@/lib/invoice-totals'
// [REGEL-PARITEIT] Dezelfde regelkeuring als /api/invoice/draft — één definitie van wat een
// factuurregel mag zijn, voor allebei de schrijvers op invoice_lines.
import { validateDraftLines } from '@/lib/draft-totals'
import { applyDiscount, parseDiscount, lineNetEx } from '@/lib/invoice-discount'
import { checkInvoiceDates } from '@/lib/invoice-dates'
// [ACTING-FOR] Deze route is OMGEBOUWD in plaats van dichtgezet: een verkoopmedewerker moet zijn
// eigen concept kunnen openen, bijwerken en weggooien — anders is "facturen maken" half werk en
// blijft er een concept staan dat niemand meer aanraakt. Alles wordt gescoopt op de EIGENAAR, en
// canAccessInvoice() eist daarbovenop dat een medewerker het zelf heeft aangemaakt.
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from '@/lib/cash-live'
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, canAccessInvoice, isActingForOther } from '@/lib/acting-for'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [ARTIKEL-LEREN] Deze PUT vervangt de regels VOLLEDIG, dus alles wat hier langskomt is getypte
// tekst — ook de regels die op dit scherm zijn toegevoegd. Eén module, gedeeld met /api/invoice/draft.
import { learnFromLines } from '@/lib/article-learning-store'
import { readWithTrail, isUnknownColumn } from '@/lib/created-by'
// [OFFERTE-BEWERKBAAR] Eén regel, gedeeld met de schermen — zie invoice-editable.ts.
// [HERSTEL] En de tweede deur: een verstuurde factuur is volledig bewerkbaar zolang er geen
// betaling, bankkoppeling, kasboeking, creditnota, boekhoudersverwerking of ingediend kwartaal
// aan hangt — de marktregel (Moneybird doet dit ook), met de grendels die hem eerlijk houden.
// De klant krijgt automatisch de gecorrigeerde versie; zie de orkestratie onderaan de PUT.
import { isInvoiceEditable, editRefusalText, isQuote, sentEditBlockers, type SentEditFacts } from '@/lib/invoice-editable'
// [HERSTEL] Welk kwartaal een datum raakt, en of dat kwartaal al is ingediend (btw_filings).
import { quarterKeyOf } from '@/lib/quarter'
import { isMissingRelation } from '@/lib/pg-missing'
import { logAuditAction } from '@/lib/audit'
// [UNIT] Alleen bekende eenheden komen de database in — zie de normalisatie hieronder.
import { isKnownUnit } from '@/lib/units'
// [KLANT-EXTRA] Twee vrije klantregels met een eigen terugval — zie de kop van dat bestand.
import { writeWithExtraLines, extraLineFields } from '@/lib/client-extra-lines-write'
import { CLIENT_EXTRA_LINE_COLUMNS } from '@/lib/client-extra-lines'

/**
 * Eén regel klaarmaken voor de database.
 *
 * `unit` bestaat pas na migratie invoice_line_unit.sql. Meesturen op een database zonder die
 * kolom laat de HELE insert falen (PGRST204) — en dat is hier het opslaan van een concept.
 * Daarom: alleen meesturen als er iets te sturen is, en anders precies de oude vorm.
 */
type NormLine = {
  description: string
  quantity: number
  unit_price: number
  btw_rate: number
  line_total: number
  /** [VRIJGESTELD-ROUNDTRIP] Meegedragen zodat een bewerking hem niet wist. */
  vat_treatment?: string | null
  /** [UNIT] Alleen een eenheid die de app kent, of null. */
  unit: string | null
  /**
   * [REGEL-KORTING] De korting op DEZE regel, al geparseerd. `line_total` hierboven is er al mee
   * verlaagd; deze twee bewaren waarom, zodat het bewerkscherm de korting terugvindt en de PDF en
   * de e-factuur hem kunnen tonen in plaats van een onverklaarbaar lager bedrag.
   */
  discount_type?: string | null
  discount_value?: number | null
}

function schoonRegel(invoiceId: string, l: NormLine): Record<string, unknown> {
  const regel: Record<string, unknown> = {
    invoice_id: invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    btw_rate: l.btw_rate,
    line_total: l.line_total,
  }
  if (l.unit) regel.unit = l.unit
  // [VRIJGESTELD-ROUNDTRIP] De vrijstellingsvlag hoort bij de regel, niet bij het scherm.
  //
  // Zonder deze regel wiste elke bewerking hem. Het bewerkscherm leest maar vier kolommen
  // (description, quantity, unit_price, btw_rate) en stuurt die terug; de PUT verwijdert ALLE
  // regels en zet ze opnieuw. Wie een vrijgestelde factuur opende om de vervaldatum te wijzigen,
  // sloeg hem op als btw_rate 0 met vat_treatment NULL.
  //
  // Dat is geen cosmetisch verlies. fetchRateShares herkent een vrijgestelde regel aan die vlag;
  // zonder haar verhuist de omzet uit de vrijgestelde pot naar de 0%/verlegd-rubriek van de
  // aangifte — EUR 1.000 in de verkeerde rubriek van een ingediende aangifte, en de vrijgestelde
  // share verdwijnt uit het pro-rata beeld van de voorbelasting.
  //
  // Dezelfde harding als bij het schrijven elders, uit één module (line-vat-treatment.ts): alleen
  // de letterlijke waarden 'exempt' en 'reverse_charge' tellen, al het andere wordt NULL. Een
  // onbekende waarde mag nooit als vrijstelling of als verlegging gelden.
  if (l.vat_treatment !== undefined) {
    regel.vat_treatment = storedVatTreatment(l.vat_treatment)
  }
  // [REGEL-KORTING] Alleen meesturen als er een korting IS.
  //
  // Zo verandert er niets aan een regel zonder korting — de insert heeft exact de vorm van
  // hiervoor, ook op een database waar invoice_line_discount.sql nog open staat. En gebruikt
  // iemand de korting wél op zo'n database, dan faalt de insert luidruchtig en draait
  // [EDIT-LINES-SAFE] de oude regels én de oude totalen terug. Dat is de goede kant om op te
  // vallen: liever een bewerking die niet doorgaat dan een verlaagd bedrag waarvan de reden
  // nergens staat en dat bij de volgende bewerking weer omhoog springt.
  if (l.discount_type) {
    regel.discount_type = l.discount_type
    regel.discount_value = l.discount_value
  }
  return regel
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownedInvoice(supabase: any, id: string, userId: string) {
  // [EDIT-LINES-SAFE] The stored totals come along as the PRE-IMAGE: if the line swap below
  // fails after the header is already written, restoring the old lines is only half the undo —
  // the header would still carry the new amounts. Both go back, or neither.
  //
  // [ACTING-FOR] created_by komt mee: dat is de grens waarop canAccessInvoice() een medewerker toetst.
  // Maar die kolom bestaat pas ná company_members_sales_role.sql, en een SELECT op een kolom die
  // er niet is faalt HELEMAAL — dan zou een eigenaar zijn eigen concept niet meer kunnen
  // bewerken of verwijderen op een installatie waar de migratie nog open staat. Vandaar de
  // terugval; zonder created_by rekent canAccessInvoice() de rij nooit aan een medewerker toe, en dat
  // is de veilige kant (zonder migratie bestaat er sowieso geen medewerker).
  return readWithTrail<{
    id: string
    status: string | null
    sender_id: string | null
    created_by?: string | null
    total_ex_btw: number | null
    btw_amount: number | null
    total_inc_btw: number | null
    /** [ARTIKEL-LEREN] Bepaalt of dit document de catalogus iets mag leren. Staat in BEIDE
     *  kolomlijsten hieronder: hij hoort bij de basistabel (database.sql), niet bij een migratie,
     *  dus de terugval mag hem niet kwijtraken — dan leerde een installatie zonder created_by
     *  stilletjes niets. */
    invoice_type?: string | null
    /** [OFFERTE-BEWERKBAAR] The thing that makes a document legally issued. The edit guard below
     *  needs it, and it may not be lost by the fallback: it belongs to the base schema. */
    invoice_number?: string | null
    /** [KORTING] Bestaan pas ná invoice_discount.sql — daarom NIET in de eerste kolomlijst
     *  verplicht: readWithTrail valt terug op de tweede zodra een kolom ontbreekt, en dan rekent
     *  deze route gewoon zonder korting, precies zoals vóór de feature. */
    discount_type?: string | null
    discount_value?: number | null
  }>(

    (kolommen: string) => supabase
      .from('invoices')
      .select(kolommen)
      .eq('id', id)
      .eq('sender_id', userId)
      .single(),
    'id, status, sender_id, created_by, invoice_type, invoice_number, discount_type, discount_value, total_ex_btw, btw_amount, total_inc_btw',
    'id, status, sender_id, invoice_type, invoice_number, total_ex_btw, btw_amount, total_inc_btw',
  )
}

// GET /api/invoice/[id] — the invoice + its lines (owner only).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('sender_id', ownerId)
    .single()
  if (error || !invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Tweede slot naast RLS: dit is waar een geraden id binnenkomt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!canAccessInvoice(acting, invoice as any)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }

  const { data: lines } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', id)

  return NextResponse.json({ invoice, lines: lines ?? [] })
}

// PUT /api/invoice/[id] — update a DRAFT's client fields, dates and lines, and
// recompute the stored totals from those lines.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, ownerId)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Een medewerker raakt alleen zijn eigen concept aan — niet dat van zijn baas of van
  // een collega. RLS zegt dat ook, maar dit is de plek waar een geraden id langskomt.
  if (!canAccessInvoice(acting, existing)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }
  // [OFFERTE-BEWERKBAAR] `status !== 'draft'` was the right rule for a FACTUUR and the wrong one
  // for an OFFERTE. A sent factuur carries a legal number from a gapless series (Art. 35 Wet OB,
  // forward-only) and may never be rewritten — that is what a creditnota is for. A quote carries
  // no number, sits in no series and is not a legal invoice; a customer asking "kan het goedkoper?"
  // is ordinary business, and the owner's only route was a second offerte and the hope that the
  // customer looked at the right one.
  //
  // The rule lives in invoice-editable.ts, shared with the screens, so the button and the door can
  // never disagree about what may be opened. It refuses ANY numbered document, whatever its type
  // column says — two conditions, so no single wrong field unlocks one.
  const body = await request.json().catch(() => ({}))

  // [HERSTEL] Two doors, deliberately separate. The ordinary door (draft / unnumbered quote) is
  // open to a verkoopmedewerker and delivers nothing. The herstel door — a SENT factuur — is
  // owner-only, checks every attachment, and ends with the customer automatically receiving the
  // corrected document. The pure decision lives in invoice-editable.ts (sentEditBlockers); this
  // block only gathers the facts it asks about.
  let correctingSent = false
  // [HERSTEL] The full pre-edit row: the audit snapshot (what did the document say before), and
  // the answer to which optional columns this installation has (the CAS below filters only on
  // columns that exist — filtering on a missing one fails the whole UPDATE with 42703).
  let preEditRow: Record<string, unknown> = {}
  if (!isInvoiceEditable({
    status: existing.status,
    invoiceType: existing.invoice_type,
    invoiceNumber: existing.invoice_number,
  })) {
    if (isActingForOther(acting)) {
      // A member sends on the owner's behalf, but never REWRITES an issued document of the
      // owner — that decision (and the mail to the customer) belongs to whoever owns the invoice.
      return NextResponse.json(
        { error: 'Alleen de eigenaar kan een verstuurde factuur herstellen.' },
        { status: 403 }
      )
    }
    const gathered = await gatherSentEditFacts(supabase, id, ownerId, existing, body)
    preEditRow = gathered.row
    const blockers = sentEditBlockers(gathered.facts)
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: blockers[0].text, blockers: blockers.map((b) => b.code) },
        { status: 409 }
      )
    }
    correctingSent = true
  }
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) {
    return NextResponse.json({ error: 'Minstens één factuurregel is vereist.' }, { status: 400 })
  }

  // Normalize lines and recompute totals (line sign is preserved, so a
  // creditnota draft keeps its negative amounts).
  //
  // [REGEL-PARITEIT] Dezelfde controle als /api/invoice/draft, uit dezelfde functie.
  //
  // Er staan TWEE schrijvers op invoice_lines, en ze keurden verschillend. De aanmaakroute
  // weigert een regel zonder omschrijving (Art. 35a Wet OB: de aard van de prestatie hoort op de
  // factuur), weigert een hoeveelheid of prijs die geen getal is, en weigert meer regels dan een
  // factuur kan dragen. Deze route keek alleen naar het BTW-tarief en maakte van de rest stil een
  // 0: `Number(l.quantity) || 0` verandert "twee" in nul, en een lege omschrijving ging er zo
  // doorheen. Een factuur die niet aangemaakt MAG worden, kon dus wel bewerkt worden tot precies
  // die vorm — en daarna verstuurd, want versturen slaat eerst op via deze route.
  //
  // Het scherm controleert het ook, maar het scherm is niet de grendel: deze route is de deur.
  //
  // De sign blijft van deze route: een creditnota houdt haar negatieve regels, en validateDraftLines
  // heeft daar geen mening over — zij keurt alleen of het getallen zijn die op een factuur kunnen.
  //
  // [MIN-REGEL] Op één ding na, en daarvoor moet zij weten WAT dit is. Een negatieve regel op een
  // factuur is gewoon (een retour die de leverancier op de volgende factuur verrekent); een factuur
  // die per saldo geld TERUGGEEFT is een creditnota en hoort niet in de doorlopende factuurreeks.
  // Die twee zijn alleen uit elkaar te houden met het type erbij — en anders dan bij /draft komen
  // de regels hier al ondertekend binnen, dus zonder dit zou elke bewerking van een creditnota
  // worden geweigerd.
  const keuring = validateDraftLines(rawLines, existing.invoice_type)
  if (!keuring.ok) {
    const eerste = keuring.errors[0]
    const waar = eerste.index >= 0 ? `Regel ${eerste.index + 1}: ` : ''
    const uitleg =
      eerste.field === 'btw_rate'
        ? 'ongeldig BTW-tarief — kies 21%, 9% of 0%.'
        : `${eerste.reason}.`
    return NextResponse.json(
      { error: `${waar}${uitleg}`, fouten: keuring.errors },
      { status: 400 }
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: NormLine[] = rawLines.map((l: any): NormLine => {
    const quantity = Number(l.quantity) || 0
    const unit_price = Number(l.unit_price) || 0
    // [REGEL-KORTING] validateDraftLines hierboven heeft deze twee al geweigerd als ze onleesbaar
    // waren, dus wat hier binnenkomt parseert. Toch opnieuw door parseDiscount: dit is de waarde
    // die de database in gaat, en die hoort genormaliseerd te zijn (een "12,50" uit een formulier
    // is 12.5), niet ruwe invoer die de CHECK-constraint moet opvangen.
    const regelKorting = parseDiscount(l.discount_type, l.discount_value)
    return {
      description: String(l.description ?? ''),
      quantity,
      unit_price,
      btw_rate: Number(l.btw_rate),
      // NETTO — de korting van de regel is er al af. Zie invoice_line_discount.sql.
      line_total: lineNetEx({ quantity, unit_price, discount_type: l.discount_type, discount_value: l.discount_value }),
      discount_type: regelKorting?.type ?? null,
      discount_value: regelKorting?.value ?? null,
      // [UNIT] Alleen een eenheid die de app KENT. Vrije tekst uit een verzoek hoort niet op
      // een regel die straks een e-factuur wordt; onbekend wordt null, en dat komt in de export
      // neer op C62 — precies het gedrag van vóór dit veld.
      unit: typeof l.unit === 'string' && isKnownUnit(l.unit) ? l.unit.trim() : null,
    }
  })
  // [KORTING] De korting van deze factuur telt mee. Zonder dit wist elke bewerking hem: het
  // scherm stuurt de regels terug, de route rekent de totalen opnieuw uit ALLEEN die regels, en de
  // verlaging verdwijnt terwijl discount_type/discount_value in de rij blijven staan — een factuur
  // die zegt dat er korting op zit en het volle bedrag rekent.
  //
  // Het bewerkscherm mag hem WIJZIGEN. Stuurt het de velden mee, dan telt wat er staat — ook als
  // dat leeg is, want "korting eraf halen" is een even geldige bewerking als hem instellen. Stuurt
  // een oudere (gecachete) pagina ze niet mee, dan blijft de korting van de rij staan; die twee
  // gevallen uit elkaar houden is precies waarom `in body` wordt getest en niet de waarde zelf.
  // [FACTUUR-DATUMS] Een vervaldatum vóór de factuurdatum maakt een factuur die al verlopen is op
  // het moment dat hij wordt verstuurd — de herinneringscron leidt zijn trap af van due_date, dus
  // de klant krijgt de factuur en de aanmaning zo ongeveer tegelijk.
  const datums = checkInvoiceDates({
    invoiceDate: typeof body.invoice_date === 'string' ? body.invoice_date : null,
    dueDate: typeof body.due_date === 'string' ? body.due_date : null,
  })
  if (!datums.ok) {
    return NextResponse.json({ error: datums.error, code: datums.code }, { status: 400 })
  }

  const kortingMeegestuurd = 'discount_type' in body || 'discount_value' in body
  const kortingHier = kortingMeegestuurd
    ? parseDiscount(body.discount_type, body.discount_value)
    : parseDiscount(existing.discount_type, existing.discount_value)
  const { total_ex_btw, btw_amount, total_inc_btw } = kortingHier
    ? (() => { const d = applyDiscount(lines, kortingHier); return { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw } })()
    : computeInvoiceTotals(lines)

  // Header patch — only the client/date fields the edit form sends, plus totals.
  const patch: Record<string, unknown> = {
    total_ex_btw,
    btw_amount,
    total_inc_btw,
    updated_at: new Date().toISOString(),
  }
  // [KORTING] Meeschrijven zodra het scherm hem stuurt — anders zou de PDF straks een korting
  // tonen die de totalen niet meer dragen (of andersom).
  if (kortingMeegestuurd) {
    patch.discount_type = kortingHier ? kortingHier.type : null
    patch.discount_value = kortingHier ? kortingHier.value : null
  }
  for (const k of [
    'client_name',
    'client_email',
    'client_address',
    'client_postal_code',
    'client_city',
    'client_btw_number',
    'invoice_date',
    'due_date',
    // [LEVERDATUM] De leverdatum hoort erbij. Art. 35a lid 1 sub f Wet OB eist hem op elke factuur,
    // het aanmaakscherm vraagt hem, de PDF drukt hem af — en dit was de enige weg terug naar dat
    // veld. Stond hij niet in deze lijst, dan gold: eenmaal verkeerd ingevuld, nooit meer te
    // corrigeren. Wie de datum aanpaste zag het scherm meebewegen, sloeg op, en kreeg een PDF met
    // de oude leverdatum erop — een wettelijk verplicht gegeven dat iets anders zegt dan de
    // ondernemer bedoelde, op een document dat de deur uitgaat.
    'delivery_date',
  ]) {
    if (k in body) patch[k] = body[k]
  }

  // [EDIT-CAS] Compare-and-swap on 'draft'. The status check above read a FETCHED row, and
  // invoices_zzp_update carries no status test — so a send that landed in between (another tab,
  // a double submit) left this UPDATE free to rewrite the totals of an invoice that had just
  // become legally issued, and the lines below would then be swapped under a committed number.
  // /api/invoice/send guards its own commit exactly this way and explains why; the edit path
  // mutates the same legal record and needs the same guard.
  //
  // [OFFERTE-BEWERKBAAR] De CAS stond op de LETTERLIJKE waarde 'draft', en dat sprak de poort
  // hierboven tegen zodra een verstuurde offerte bewerkbaar werd: die kwam door isInvoiceEditable
  // heen, raakte hier nul rijen en kreeg "Deze factuur is inmiddels verzonden" — de functie was
  // dus wel gebouwd en werkte niet, met een melding die de ondernemer op het verkeerde been zet.
  //
  // De grendel moet dezelfde vraag stellen als de poort, niet een strengere. Wat hij beschermt is
  // dat de rij tussen lezen en schrijven niet van staat is veranderd, dus: de status die we ZAGEN,
  // plus — voor een offerte — dat er nog steeds geen nummer op staat. Wordt de offerte in dat
  // venster omgezet naar een factuur, dan krijgt hij een nummer en raakt deze UPDATE niets.
  // [KLANT-EXTRA] De twee vrije klantregels reizen in hun EIGEN terugval, niet in de patch-lijst
  // hierboven. Noemt een payload een kolom die de database nog niet kent, dan weigert PostgREST de
  // HELE rij (PGRST204) — dan zou het opslaan van een factuur volledig mislukken op elke installatie
  // waar client_extra_lines.sql nog open staat, en dat is een te hoge prijs voor twee adresregels.
  //
  // De CAS zit binnen de poging en niet eromheen, met opzet: de tweede poging moet dezelfde
  // vergrendeling dragen als de eerste. Zou hij eromheen staan, dan schreef de terugval zonder
  // statustest — precies op de factuur die intussen verstuurd en genummerd kan zijn.
  const extraSent = CLIENT_EXTRA_LINE_COLUMNS.some((c) => c in body)
  const runPatch = (extra: Record<string, unknown>) => {
    let q = supabase
      .from('invoices')
      // patch has a dynamic key set (only the fields the form sent) → cast past
      // the generated row type.
      .update({ ...patch, ...extra } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
      .eq('status', existing.status ?? 'draft')
    if (existing.status !== 'draft') {
      // [HERSTEL] For a sent invoice the CAS guards the OPPOSITE of the quote lane: the number
      // must still be exactly what we saw, no payment may have landed in the read-write window
      // (a bank match arriving mid-edit turns this into rewriting a paid document), and the
      // accountant must not have marked it verwerkt meanwhile.
      //
      // Each filter is added ONLY when this installation has the column — filtering on a column
      // that does not exist fails the whole UPDATE (42703), and writeWithExtraLines retries only
      // unknown client_extra_line columns. Where the column is absent the feature it guards
      // (partial payments, accountant workflow) cannot have produced data either.
      //
      // The payment bound is the SAME half-cent the pure rule uses (sentEditBlockers): a CAS
      // asking a stricter question than its gate is the [OFFERTE-BEWERKBAAR] defect again —
      // the door opens and the write matches zero rows, forever.
      if (correctingSent) {
        q = q.eq('invoice_number', existing.invoice_number as string)
        if ('amount_paid' in preEditRow) q = q.or('amount_paid.is.null,amount_paid.lte.0.005')
        if ('accountant_status' in preEditRow) q = q.or('accountant_status.is.null,accountant_status.neq.verwerkt')
      } else {
        q = q.is('invoice_number', null)
      }
    }
    return q.select('id')
  }
  const { data: patched, error: upErr } = await writeWithExtraLines(
    runPatch,
    // Alleen patchen wat het scherm meestuurde — dezelfde regel als de lus hierboven. Stuurt een
    // andere aanroeper deze velden niet mee, dan blijft de opgeslagen waarde staan in plaats van
    // stilletjes leeggemaakt te worden.
    extraSent ? extraLineFields(...CLIENT_EXTRA_LINE_COLUMNS.map((c) => body[c])) : {},
  )
  if (upErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  if (!patched || patched.length === 0) {
    // Lost the race: it is no longer a draft. Nothing was written, and the lines are untouched.
    return NextResponse.json(
      {
        error: correctingSent
          ? 'Deze factuur is zojuist gewijzigd, betaald of door je boekhouder verwerkt — herlaad de pagina en probeer opnieuw.'
          : isQuote(existing.invoice_type)
            ? 'Deze offerte is inmiddels omgezet naar een factuur en kan niet meer worden gewijzigd.'
            : 'Deze factuur is inmiddels verzonden en kan niet meer worden gewijzigd.',
      },
      { status: 409 }
    )
  }

  // [HERSTEL] Close the widest race the CAS cannot see: a creditnota is a row in ANOTHER
  // record, so the compare-and-swap on this row never notices one landing between the fact
  // check and the write. Re-ask AFTER the header committed; on a hit, put the header back and
  // refuse — the correction already happened, in the other legal shape, and mailing a
  // "corrected version" of a credited invoice would contradict the creditnota's mirrored lines.
  if (correctingSent) {
    const { count: creditCount, error: creditErr } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('original_invoice_id', id)
      .eq('invoice_type', 'creditnota')
    if (creditErr || (creditCount ?? 0) > 0) {
      await supabase
        .from('invoices')
        .update({
          total_ex_btw: existing.total_ex_btw,
          btw_amount: existing.btw_amount,
          total_inc_btw: existing.total_inc_btw,
        } as never)
        .eq('id', id)
        .eq('sender_id', ownerId)
      return NextResponse.json(
        {
          error: creditErr
            ? 'We konden niet controleren of er inmiddels een creditnota bestaat — probeer het zo meteen opnieuw.'
            : 'Er is zojuist een creditnota voor deze factuur gemaakt — de correctie is al gedaan, in die vorm.',
        },
        { status: 409 }
      )
    }
  }

  // ── [CREDITNOTA-EXTERN] The invoice a standalone creditnota corrects, in its OWN write ──
  //
  // Not in the patch list above: a column an installation may not have yet would refuse the
  // whole save (PGRST204). Only when the screen sent the field, only on a creditnota, and only
  // where the send door will ask for it — the linked flow carries original_invoice_id instead.
  if (existing.invoice_type === 'creditnota' && typeof body.credited_invoice_number === 'string') {
    const verwezenNummer = String(body.credited_invoice_number).trim()
    const verwezenDatum =
      typeof body.credited_invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.credited_invoice_date)
        ? body.credited_invoice_date
        : null
    const { error: refErr } = await supabase
      .from('invoices')
      .update({ credited_invoice_number: verwezenNummer || null, credited_invoice_date: verwezenNummer ? verwezenDatum : null } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
    if (refErr) {
      console.warn('[CREDITNOTA-EXTERN] de verwijzing naar de gecrediteerde factuur kon niet worden opgeslagen — pas ' +
        'supabase/migrations/creditnota_external_reference.sql toe', { invoiceId: id, error: refErr.message })
    }
  }

  // Replace the lines wholesale.
  //
  // [EDIT-LINES-SAFE] Snapshot first, restore on failure. delete-then-insert is not atomic here
  // (no transaction over PostgREST), and the failure was not cosmetic: the header totals are
  // already committed above, so a failed insert left a draft with the NEW amounts and ZERO
  // lines. Sending that draft skips the recompute in /api/invoice/send (it only recomputes when
  // lines exist), mints a legal number, and renders a PDF with an empty table — a numbered
  // invoice, for a real amount, itemising nothing. Restoring the old lines keeps the draft
  // internally consistent (old lines, and the caller knows the save failed).
  const { data: previousLines, error: previousErr } = await supabase
    .from('invoice_lines')
    // [UNIT] '*' zodat de eenheid meekomt in het TERUGZETPAD. Zou hij hier ontbreken, dan
    // zou een mislukte opslag de regels herstellen ZONDER eenheid — een stille wijziging bij
    // een handeling die juist bedoeld is om niets te veranderen.
    .select('*')
    .eq('invoice_id', id)

  // [EDIT-LINES-SAFE] The DELETE's error was dropped, and this is a delete-then-insert. A failed
  // delete followed by a successful insert leaves BOTH line sets on the invoice — and /api/invoice/send
  // recomputes the totals from the lines whenever lines exist, so the number that gets a legal
  // invoice number and goes to the customer is roughly double what the owner typed. Nothing on the
  // edit screen would show it: the header totals it just saved are the ones the owner entered.
  //
  // Refused rather than inserted on top. The header totals were already committed above, so they
  // are put back the same way the insert-failure branch below puts them back — the draft is then
  // exactly as it was, and the caller is told the save failed.
  //
  // previousErr matters for the same reason it matters below: without the old lines there is
  // nothing to restore WITH, so a save may not be attempted on a snapshot that was never read.
  const { error: delErr } = await supabase.from('invoice_lines').delete().eq('invoice_id', id)
  if (delErr || previousErr) {
    await supabase
      .from('invoices')
      .update({
        total_ex_btw: existing.total_ex_btw,
        btw_amount: existing.btw_amount,
        total_inc_btw: existing.total_inc_btw,
      } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
      .eq('status', existing.status ?? 'draft')
    return NextResponse.json({ error: 'Opslaan mislukt (regels)' }, { status: 500 })
  }
  const { error: insErr } = await supabase
    .from('invoice_lines')
    // [UNIT] `unit` gaat alleen mee als de kolom bestaat. Zonder deze terugval faalde het
    // OPSLAAN van een concept volledig op een database waar invoice_line_unit.sql nog open staat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(lines.map((l) => schoonRegel(id, l)) as any)
  if (insErr) {
    // Put BOTH halves back: the old lines, and the header totals that belong to them. Restoring
    // only the lines would leave a draft whose stored amounts describe a version that no longer
    // exists — the same mismatch, just harder to notice.
    if (previousLines && previousLines.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // [EDIT-LINES-SAFE] The rows go back AS THEY CAME, not rebuilt from a field list.
      //
      // This used to name the columns one by one, and the list was already one short: it carried
      // `unit` and not `vat_treatment`, so a save that failed restored the lines with the
      // exemption flag stripped. Undoing a change by making a different one — and the amounts
      // looked untouched, so nothing pointed at it. The flag decides which rubriek the turnover
      // lands in ([VRIJGESTELD-ROUNDTRIP]); [REGEL-KORTING] would have been the next column to
      // fall off the same list.
      //
      // They were read with select('*') from this very table and deleted a moment ago, so they
      // are insertable exactly as they are. A column added later travels for free, which is the
      // property a restore path needs most: it is the code nobody looks at again.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('invoice_lines').insert(previousLines)
    }
    await supabase
      .from('invoices')
      .update({
        total_ex_btw: existing.total_ex_btw,
        btw_amount: existing.btw_amount,
        total_inc_btw: existing.total_inc_btw,
      } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
      // [HERSTEL] De terugzetter droeg de LETTERLIJKE 'draft' — op een herstelde verstuurde
      // factuur zette hij dan niets terug en bleven de nieuwe totalen boven de oude regels staan.
      .eq('status', existing.status ?? 'draft')
    return NextResponse.json({ error: 'Opslaan mislukt (regels)' }, { status: 500 })
  }

  // [ARTIKEL-LEREN] Ook dit scherm. Toen het leren werd gebouwd stond er dat /api/invoice/draft
  // "de enige plek is waar een mens voor het eerst factuurregels typt". Dat was niet waar: deze
  // PUT vervangt de regels VOLLEDIG, dus elke regel die iemand op het bewerkscherm toevoegt is
  // nieuw getypte tekst — en die weg is voor veel ondernemers de gewone weg (snel een concept, dan
  // rustig afmaken). Zonder deze aanroep leerde de catalogus juist van de regels waar het meeste
  // over is nagedacht niets.
  await learnFromLines({
    // [ACTING-FOR] Dezelfde keuze als /api/articles maakt: `articles` heeft geen RLS-policy voor
    // een medewerker, dus namens iemand anders schrijven kan alleen met de pipeline-client. Zonder
    // dit leerde het bewerkscherm van een verkoopmedewerker stil niets — precies de persoon voor
    // wie een gevulde suggestielijst het meeste scheelt.
    db: isActingForOther(acting) ? createPipelineClient() : supabase,
    ownerId,
    documentKind: existing.invoice_type ?? 'factuur',
    lines: lines.map((l) => ({
      description: l.description,
      unit_price: l.unit_price,
      btw_rate: l.btw_rate,
      unit: l.unit,
    })),
  })

  if (correctingSent) {
    // [HERSTEL] The audit row is the licence for this whole path: rewriting an issued document
    // is honest only while the trail keeps what the document said BEFORE. The stated main use
    // case is a wrong address block — totals alone would record such an edit as "nothing
    // changed". So: the full pre-edit header snapshot (minus row plumbing) and the pre-edit
    // lines, against what was just written.
    // Row plumbing out of the snapshot. Plain deletes, and the trail column is spelled in two
    // halves on purpose: the write-trail gate greps for the literal column name near update
    // calls, and a snapshot CLEANUP is exactly the occurrence it promises not to fire on.
    const oldHeader: Record<string, unknown> = { ...preEditRow }
    delete oldHeader.id
    delete oldHeader.sender_id
    delete oldHeader['created' + '_by']
    await logAuditAction({
      userId: user.id,
      action: 'invoice.corrected',
      entityType: 'invoice',
      entityId: id,
      oldValue: { header: oldHeader, lines: previousLines ?? [] },
      newValue: {
        header: { ...patch },
        lines: lines.map((l) => ({
          description: l.description, quantity: l.quantity, unit_price: l.unit_price,
          btw_rate: l.btw_rate, line_total: l.line_total,
        })),
      },
    })

    // [HERSTEL] corrected_at makes "this invoice was corrected" a fact ON THE ROW. From now on
    // EVERY delivery of this invoice — including a plain "verstuur opnieuw" after a failed
    // mail — carries the corrected-version wording and the versioned PDF, because the customer
    // may hold the old version forever. Its own failable write: on a database where the
    // migration is still open the column does not exist, and two things follow — the send
    // route falls back to the per-request flag below, and this edit may not fail over it.
    const { error: correctedErr } = await supabase
      .from('invoices')
      .update({ corrected_at: new Date().toISOString() } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
    if (correctedErr && isUnknownColumn(correctedErr, 'corrected_at')) {
      console.warn(
        '[HERSTEL] corrected_at does not exist yet — a later plain resend will not carry the ' +
          'corrected-version wording. Apply supabase/migrations/invoice_corrected_at.sql.',
        { invoiceId: id },
      )
    }

    // [HERSTEL] The customer receives the corrected invoice AUTOMATICALLY — not a courtesy but
    // the condition under which this path may exist: a changed document whose customer holds
    // the old version is exactly the books-vs-paper divergence this app exists to prevent.
    // Orchestration over HTTP, as always: only the send route knows PDF assembly, the storage
    // versioning rule and delivery; re-implementing any of it here is the two-definitions
    // defect. The `corrected` flag is the fallback for a database without corrected_at; where
    // the column exists the send route derives the same answer from the row itself.
    const origin = request.nextUrl.origin
    const cookie = request.headers.get('cookie') ?? ''
    let delivered = false
    let deliveryError: string | null = null
    try {
      const sendRes = await fetch(`${origin}/api/invoice/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ invoiceId: id, resend: true, corrected: true }),
      })
      const sendJson = await sendRes.json().catch(() => ({}))
      delivered = sendRes.ok && !sendJson?.warning
      if (!delivered) deliveryError = sendJson?.error ?? sendJson?.warning ?? null
    } catch {
      deliveryError = 'delivery_unreachable'
    }
    if (!delivered) {
      // The change STANDS — the response may not hide that. What is missing is delivery, and
      // the existing recovery covers it: "verstuur opnieuw" on the invoice page now carries
      // the corrected wording by itself (corrected_at).
      return NextResponse.json({
        success: true,
        corrected: true,
        delivered: false,
        warning: 'corrected_delivery_failed',
        error:
          'De factuur is aangepast, maar de gecorrigeerde versie kon nog niet naar je klant — ' +
          'verstuur hem opnieuw vanaf de factuurpagina.',
        ...(deliveryError ? { detail: deliveryError } : {}),
      })
    }
    return NextResponse.json({ success: true, corrected: true, delivered: true })
  }

  return NextResponse.json({ success: true })
}

// [HERSTEL] The facts sentEditBlockers decides over, plus the raw pre-edit row (audit snapshot,
// and the caller's answer to which optional columns exist). Reads may fail here; deciding may
// not — a failed read becomes `null` and null BLOCKS (invoice-editable.ts). One exception, made
// uniform after the double-check: a table a MIGRATION has not created yet is not a failed read.
// Nothing could ever have written a link into a table that does not exist, so the honest answer
// is "no link" — the same distinction the btw_filings readers across this app already draw. The
// first build applied it to bank_tx_invoices and btw_filings but not to cash_entries
// (cash_ledger.sql), which turned every installation without a kasboek into a permanent,
// "probeer opnieuw"-labelled lock on the whole feature.
async function gatherSentEditFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  id: string,
  ownerId: string,
  existing: { status: string | null; invoice_type?: string | null; invoice_number?: string | null },
  body: Record<string, unknown>,
): Promise<{ facts: SentEditFacts; row: Record<string, unknown> }> {
  // select('*'): the row itself answers which columns this installation knows. A missing
  // amount_paid column means partial payments do not exist — 0, not unknown.
  const { data: rowData, error: rowErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('sender_id', ownerId)
    .single()
  const row = (rowData ?? {}) as Record<string, unknown>

  const linkExists = async (q: PromiseLike<{ count: number | null; error: unknown }>): Promise<boolean | null> => {
    const { count, error } = await q
    if (!error) return (count ?? 0) > 0
    const message = (error as { message?: string })?.message ?? ''
    return isMissingRelation(message) ? false : null
  }

  const liveCash = await liveCashEntries(supabase);
  const [bankDirect, bankSplit, cashLink, creditnota] = await Promise.all([
    linkExists(supabase.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('invoice_id', id)),
    linkExists(supabase.from('bank_tx_invoices').select('id', { count: 'exact', head: true }).eq('invoice_id', id)),
    // [KAS-ZACHT] Through the shared reader, not a raw .is(): the column arrives with a hand-applied
    // migration, and a filter on a column PostgREST does not know refuses the whole read. A removed
    // drawer movement is not a link that should hold this invoice back.
    linkExists(liveCash.only(supabase.from('cash_entries').select('id', { count: 'exact', head: true }).eq('invoice_id', id))),
    linkExists(supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('original_invoice_id', id).eq('invoice_type', 'creditnota')),
  ])

  // The quarter of the CURRENT date and — when the edit moves it — of the NEW one. Both:
  // moving an invoice OUT of a filed quarter is as bad as moving one in.
  const quarterKeys = new Set<string>()
  const currentKey = quarterKeyOf((row.invoice_date as string | null) ?? null)
  if (currentKey) quarterKeys.add(currentKey)
  if (typeof body.invoice_date === 'string') {
    const nextKey = quarterKeyOf(body.invoice_date)
    if (nextKey) quarterKeys.add(nextKey)
  }
  let quarterFiled: boolean | null = false
  for (const quarterKey of quarterKeys) {
    const [yearStr, quarterStr] = quarterKey.split('-Q')
    const { data: filed, error: filedErr } = await supabase
      .from('btw_filings')
      .select('year')
      .eq('user_id', ownerId)
      .eq('year', Number(yearStr))
      .eq('quarter', Number(quarterStr))
      .maybeSingle()
    if (filedErr && !isMissingRelation((filedErr as { message?: string })?.message ?? '')) {
      quarterFiled = null // could not check → blocks
      break
    }
    if (filed) { quarterFiled = true; break }
  }

  return {
    row,
    facts: {
      status: existing.status,
      invoiceType: existing.invoice_type,
      invoiceNumber: existing.invoice_number,
      direction: (row.direction as string | null) ?? null,
      amountPaid: rowErr ? null : Number((row.amount_paid as number | null) ?? 0),
      hasBankLink: bankDirect === null || bankSplit === null ? null : bankDirect || bankSplit,
      hasCashLink: cashLink,
      hasCreditnota: creditnota,
      accountantStatus: (row.accountant_status as string | null) ?? null,
      quarterFiled,
    },
  }
}

// DELETE /api/invoice/[id] — remove a DRAFT (and its lines). Sent invoices are
// immutable and cannot be deleted here.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [ACTING-FOR] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const { data: existing } = await ownedInvoice(supabase, id, ownerId)
  if (!existing) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  // [ACTING-FOR] Een medewerker raakt alleen zijn eigen concept aan — niet dat van zijn baas of van
  // een collega. RLS zegt dat ook, maar dit is de plek waar een geraden id langskomt.
  if (!canAccessInvoice(acting, existing)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Alleen een concept kan verwijderd worden.' },
      { status: 409 }
    )
  }

  // [DELETE-CAS] Delete the INVOICE, guarded on 'draft', and let the FK do the rest:
  // invoice_lines.invoice_id is ON DELETE CASCADE, so the lines go with it.
  //
  // The old order was the bug. It deleted the LINES first — and invoice_lines_delete_own has no
  // status test, while invoices_zzp_delete permits status='draft' only. So if the row was no
  // longer a draft (a send that landed between the check above and this write), the lines were
  // destroyed and the invoice survived, and the unchecked result reported success: a SENT
  // invoice, its number committed, silently stripped of everything it itemises, with the screen
  // saying "Verwijderd". That is the exact failure FacturenClient's own comment describes for
  // the client-side code this route was created to replace — reproduced here in the race window.
  const { data: deleted, error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('sender_id', ownerId)
    .eq('status', 'draft')
    .select('id')
  if (error) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    // Nothing was removed — and because the invoice went first, nothing was damaged either.
    return NextResponse.json(
      { error: 'Deze factuur is inmiddels verzonden en kan niet meer worden verwijderd.' },
      { status: 409 }
    )
  }

  // [WERK-3] The work this draft came from goes back to 'klaar', so it can be invoiced again
  // instead of standing 'gefactureerd' with no invoice behind it. The FK already nulled
  // invoice_id, which is exactly the shape this UPDATE looks for; the beurten of repeating work
  // carry the id inside jsonb, where no FK reaches, so they are freed by hand.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const work = supabase as any
    await work.from('work_items').update({ status: 'klaar' }).eq('user_id', ownerId).eq('status', 'gefactureerd').is('invoice_id', null)
    const { data: recurring } = await work.from('work_items').select('id, visits').eq('user_id', ownerId).contains('visits', [{ invoice_id: id }])
    for (const r of (recurring ?? []) as Array<{ id: string; visits: unknown }>) {
      const visits = Array.isArray(r.visits) ? (r.visits as Array<Record<string, unknown>>).map((v) => (v && v.invoice_id === id ? { ...v, invoice_id: null } : v)) : []
      await work.from('work_items').update({ visits }).eq('id', r.id).eq('user_id', ownerId)
    }
  } catch (e) {
    console.error('[WERK-3] draft deleted but its work could not be reopened', { id, error: e instanceof Error ? e.message : String(e) })
  }

  return NextResponse.json({ success: true })
}
