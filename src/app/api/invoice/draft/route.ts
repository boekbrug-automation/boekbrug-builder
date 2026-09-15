// src/app/api/invoice/draft/route.ts
// [ACTING-FOR] De ENIGE plek waar een conceptfactuur ontstaat.
//
// WAAROM DEZE ROUTE BESTAAT
// Tot nu toe schreef de browser de factuur zelf: `supabase.from('invoices').insert({ sender_id:
// user.id, ... })`, met de totalen die de pagina had uitgerekend. Zolang er één mens per
// boekhouding was, kon je daarmee hooguit jezelf voorliegen.
//
// Met een verkoopmedewerker erbij klopt dat niet meer. Zijn `user.id` is NIET de eigenaar van de
// boekhouding, en zou hij onder zijn eigen id boeken dan liepen er twee nummerreeksen onder één
// BTW-nummer — Art. 35 Wet OB eist doorlopende nummering zonder gaten, en een uitgegeven nummer
// is niet terug te draaien. De server moet dus bepalen wie de eigenaar is, niet de pagina.
//
// WAT ER VOOR EEN EIGENAAR VERANDERT: NIETS.
// Voor iemand zonder koppeling is ownerId gelijk aan zijn eigen id, en de rekensom in
// draft-totals.ts is letterlijk dezelfde als die in de pagina stond — inclusief het niet
// afronden. Dezelfde rij, dezelfde centen.

import { NextRequest, NextResponse } from 'next/server'
import { storedVatTreatment } from '@/lib/line-vat-treatment'
import { normalizeCountry } from '@/lib/client-country'
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { chunkIds, fetchAllRowsForIds } from '@/lib/supabase-paginate'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
import { invoiceOwnerId, invoiceCreatedBy, isActingForOther } from '@/lib/acting-for'
import { computeDraftTotals, validateDraftLines } from '@/lib/draft-totals'
import { checkInvoiceDates } from '@/lib/invoice-dates'
// [AANBETALING] The offerte a deposit invoice is a deposit on — checked, then written apart.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import { parseDiscount, lineNetEx } from '@/lib/invoice-discount'
// [UNIT] Alleen eenheden die de app kent belanden in de database. Vrije tekst uit een
// gemanipuleerd verzoek hoort niet op een factuurregel die straks een e-factuur wordt.
import { isKnownUnit } from '@/lib/units'
// [ACTING-FOR] created_by bestaat pas ná company_members_sales_role.sql. Zonder deze terugval faalt
// de INSERT hieronder met PGRST204 op een installatie waar de migratie nog open staat — en dan
// kan er GEEN FACTUUR MEER WORDEN AANGEMAAKT. Zie de kop van created-by.ts.
import { writeWithTrail } from '@/lib/created-by'
// [ARTIKEL-LEREN] Eén module voor beide deuren (deze en het bewerkscherm) — twee kopieën van
// dezelfde regel lopen uit elkaar zonder dat er iets rood wordt.
import { learnFromLines } from '@/lib/article-learning-store'
// [KLANT-EXTRA] Twee vrije klantregels onder de klantnaam — zie de kop van dat bestand.
import { extraLineFields } from '@/lib/client-extra-lines-write'
import { CLIENT_EXTRA_LINE_COLUMNS } from '@/lib/client-extra-lines'
// [UREN-EENMALIG] Uren factureren. De regels komen uit deze module zodat het bedrag op de factuur
// en het uur eronder dezelfde som zijn — zie de kop van uren.ts.
import {
  linesFromEntries, parseTimeEntryIds, verifyStamped, type TimeEntry, type TimeEntryIdsRefusal,
} from '@/lib/uren'
// [RITTEN-EENMALIG] Travel onto the invoice, through the same door and with the same guarantee:
// the SERVER builds the lines from the log and stamps the trips in the same request.
import { linesFromTrips, parseMileageIds, type MileageEntry, type MileageIdsRefusal } from '@/lib/ritten'

export const dynamic = 'force-dynamic'

type Soort = 'factuur' | 'creditnota' | 'offerte'


/**
 * De eenheid van één regel, of null.
 *
 * Alleen wat de app KENT komt erdoor. Een onbekend woord wordt null in plaats van te worden
 * opgeslagen: het zou bij de UBL-export toch op C62 uitkomen, en dan staat er in de database een
 * eenheid die nergens iets doet — precies het soort veld waarvan later niemand meer weet of het
 * betekenis heeft.
 */
function schoonEenheid(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && isKnownUnit(s) ? s : null
}

/**
 * [UREN] Waarom een uur niet gefactureerd kon worden.
 *
 * NOTE ON LANGUAGE: Dutch in an English file, for the reason AGENTS.md gives — these sentences are
 * shown to the owner, and the rest of this route already answers in Dutch ('Een factuur zonder
 * klant kan niet'). One route answering in two languages would be worse than either.
 *
 * Elke reden noemt wat de ondernemer NU kan doen. "Er ging iets mis" laat iemand die net een uur
 * kwijt is met precies niets achter.
 */
const UREN_REFUSAL_NL: Record<TimeEntryIdsRefusal | 'none_billable' | 'no_rate', string> = {
  not_a_list: 'De uren konden niet worden gelezen. Ververs de pagina en probeer het opnieuw.',
  not_an_id: 'De uren konden niet worden gelezen. Ververs de pagina en probeer het opnieuw.',
  empty: 'Kies eerst welke uren op de factuur moeten.',
  too_many: 'Meer dan 200 uren op één factuur kan niet. Splits ze over twee facturen.',
  none_billable: 'Deze uren staan al op een factuur, of bestaan niet meer. Ververs de pagina.',
  no_rate: 'Bij deze uren staat nog geen uurtarief. Vul het tarief in, dan kunnen ze op de factuur.',
}

/**
 * [RITTEN] Waarom een rit niet gefactureerd kon worden.
 *
 * Dutch in an English file, for the reason the UREN block above gives: these sentences are shown
 * to the owner, and one route answering in two languages would be worse than either.
 */
const RITTEN_REFUSAL_NL: Record<MileageIdsRefusal | 'none_billable' | 'no_rate', string> = {
  not_a_list: 'De ritten konden niet worden gelezen. Ververs de pagina en probeer het opnieuw.',
  not_an_id: 'De ritten konden niet worden gelezen. Ververs de pagina en probeer het opnieuw.',
  empty: 'Kies eerst welke ritten op de factuur moeten.',
  too_many: 'Meer dan 200 ritten op één factuur kan niet. Splits ze over twee facturen.',
  none_billable: 'Deze ritten staan al op een factuur, of bestaan niet meer. Ververs de pagina.',
  no_rate: 'Bij deze ritten staat geen tarief per kilometer. Vul het in, dan kunnen ze op de factuur.',
}

const DB_TYPE: Record<Soort, string> = {
  factuur: 'factuur',
  creditnota: 'creditnota',
  // Een offerte is nog geen factuur: hij leeft als pro_forma tot hij wordt omgezet.
  offerte: 'pro_forma',
}

export async function POST(request: NextRequest) {
  try {
    // [MANDAAT] `namensKlantId` in de body is het ENIGE verschil met vroeger: staat hij er niet,
    // dan is dit letterlijk de oude route. Staat hij er wel, dan moet de beller een boekhouder zijn
    // met een levend mandaat van precies die klant — anders 403, nooit een terugval op "dan maar
    // voor jezelf". Zie accountant-mandate.ts.
    const voorbody = await request.json().catch(() => null)
    if (!voorbody || typeof voorbody !== 'object') {
      return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
    }
    const namensKlantId =
      typeof voorbody.namens_klant_id === 'string' && voorbody.namens_klant_id
        ? voorbody.namens_klant_id
        : null

    const acting = namensKlantId ? await getActingForClient(namensKlantId) : await getActingFor()
    if (!acting) {
      return namensKlantId
        ? NextResponse.json(
            { error: 'Je hebt geen toestemming om namens deze klant te factureren' },
            { status: 403 },
          )
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = await checkRateLimit({
      userId: acting.actorId,
      endpoint: '/api/invoice/draft',
      ...RATE_LIMITS.INVOICE_SEND,
    })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body = voorbody

    const soort: Soort =
      body.invoiceType === 'creditnota' ? 'creditnota' : body.invoiceType === 'offerte' ? 'offerte' : 'factuur'

    const ownerId = invoiceOwnerId(acting)
    const createdBy = invoiceCreatedBy(acting)

    // service_role: de browser mag sender_id en created_by niet kiezen. Dat is het hele punt van
    // deze route — RLS zou een INSERT met een zelfgekozen sender_id namelijk gewoon toestaan als
    // die gelijk is aan auth.uid(), en dat is precies de verkeerde eigenaar.
    //
    // [UREN] Deze drie stonden vroeger vlak vóór de INSERT. Ze zijn naar boven verplaatst omdat de
    // urenstap hieronder de eigenaar en de database al nodig heeft vóórdat de regels bestaan — hij
    // MAAKT ze immers. Er zit niets tussen dat ze beïnvloedt: alle drie hangen alleen van `acting`
    // af, dat hierboven al is vastgesteld.
    const pipeline = createPipelineClient()

    // ── [UREN-EENMALIG] Uren factureren: de regels komen van de UREN, niet van de browser ─────
    //
    // Staat `time_entry_ids` niet in het verzoek, dan gebeurt hier NIETS en is dit letterlijk de
    // route van vóór deze functie. Staat hij er wel, dan bouwt de SERVER de factuurregels uit de
    // opgeslagen uren.
    //
    // Waarom niet gewoon de regels van de browser overnemen: dan zou het bedrag op de factuur en
    // het uur waaraan het vastzit twee losse beweringen zijn, en alleen de eerste komt bij de
    // klant terecht. Nu is de factuur voor uren aantoonbaar DE uren.
    //
    // Alleen eigen, nog niet gefactureerde uren komen mee. `user_id = ownerId` staat er omdat dit
    // een service_role-client is: RLS kijkt hier niet mee, dus het eigenaarsfilter is deze regel
    // en niets anders ([RLS-UIT]).
    let urenIds: string[] = []
    if (body.time_entry_ids !== undefined && body.time_entry_ids !== null) {
      const gevraagd = parseTimeEntryIds(body.time_entry_ids)
      if (!gevraagd.ok) {
        return NextResponse.json({ error: UREN_REFUSAL_NL[gevraagd.code], code: gevraagd.code }, { status: 400 })
      }
      // [IN-CHUNK] Gechunkt. Een kwartaal aan uren op één factuur is geen randgeval maar de
      // gewone reden om deze knop te gebruiken, en voorbij een paar honderd id's liep de lijst de
      // URL over. De 503 hieronder ving dat al netjes op — dit haalt de aanleiding weg.
      // [DECLARABEL] `billable` is newer than the generated types — the same cast every new column
      // gets here, on the READ only.
      let uren: Array<{ id: string; client_id: string | null; worked_on: string | null; description: string | null; hours: number | null; hourly_rate: number | null; invoice_id: string | null; billable: boolean | null }> | null = null
      let urenErr: { message: string } | null = null
      try {
        uren = await fetchAllRowsForIds(gevraagd.ids, (chunk, from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (pipeline as any)
            .from('time_entries')
            // [DECLARABEL] billable travels: linesFromEntries reads it, and an absent column reads
            // as "may be invoiced" — the screen already filters, and this door must not depend on it.
            .select('id, client_id, worked_on, description, hours, hourly_rate, invoice_id, billable')
            .in('id', chunk)
            .eq('user_id', ownerId)
            .is('invoice_id', null)
            .order('id', { ascending: true })
            .range(from, to),
        )
      } catch (e) {
        urenErr = { message: e instanceof Error ? e.message : 'uren read failed' }
      }

      // [NO-SILENT-EMPTY] Zonder deze tak zou een onbereikbare database er hier uitzien als "geen
      // uren" — en dat wordt dan een factuur zonder regels, of erger: een lege lijst die stil
      // doorloopt. De reden dat de tak nodig is, is sinds het chunken hierboven veranderd en niet
      // verdwenen: fetchAllRowsForIds GOOIT waar supabase-js een `{ data: null, error }` teruggaf,
      // dus de fout komt nu uit de catch in plaats van uit de destructurering.
      if (urenErr) {
        console.error('[UREN] uren lezen mislukt — geen concept gemaakt', { urenErr })
        return NextResponse.json(
          { error: 'De uren konden niet worden gelezen. Probeer het opnieuw.' },
          { status: 503 },
        )
      }

      const gevonden = (uren ?? []) as TimeEntry[]
      if (gevonden.length === 0) {
        // Elk gevraagd uur is verdwenen, van iemand anders, of staat al op een factuur. Dat is geen
        // lege factuur waard, en het is precies het geval waarin stil doorgaan zou betekenen dat de
        // ondernemer denkt te hebben gefactureerd.
        return NextResponse.json({ error: UREN_REFUSAL_NL.none_billable, code: 'none_billable' }, { status: 409 })
      }

      // [TARIEF-STRIKT] The RAW value, not Number(...): Number(null) is 0, a legal rate, so a body
      // with uren_btw_rate: null used to bill the whole hours invoice at 0%. linesFromEntries
      // validates it and falls back to 21 for anything that is not a rate.
      const gebouwd = linesFromEntries(gevonden, body.uren_btw_rate)
      if (gebouwd.lines.length === 0) {
        return NextResponse.json({ error: UREN_REFUSAL_NL.no_rate, code: 'no_rate' }, { status: 409 })
      }
      // De regels van de browser worden VERVANGEN, niet aangevuld: wie uren factureert, factureert
      // de uren. Alles hieronder — validatie, totalen, korting, de INSERT — is daarna ongewijzigd.
      body.lines = gebouwd.lines
      urenIds = gebouwd.billedIds
    }

    // ── [RITTEN-EENMALIG] Reiskosten factureren: de regels komen uit de KILOMETERADMINISTRATIE ──
    //
    // Same shape as the hours above, and for the same reason: the amount on the invoice and the
    // trip it rests on must be one claim, not two. The lines are APPENDED — an owner billing a
    // month of work plus the travel to it sends both lists, and the travel belongs under the work.
    //
    // Only own, not-yet-invoiced trips come along. `user_id = ownerId` is the owner filter on a
    // service_role client, where RLS does not look ([RLS-UIT]).
    let ritIds: string[] = []
    if (body.mileage_entry_ids !== undefined && body.mileage_entry_ids !== null) {
      const gevraagd = parseMileageIds(body.mileage_entry_ids)
      if (!gevraagd.ok) {
        return NextResponse.json({ error: RITTEN_REFUSAL_NL[gevraagd.code], code: gevraagd.code }, { status: 400 })
      }
      let ritten: MileageEntry[] | null = null
      let ritErr: { message: string } | null = null
      try {
        ritten = await fetchAllRowsForIds(gevraagd.ids, (chunk, from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (pipeline as any)
            .from('mileage_entries')
            .select('id, client_id, driven_on, from_place, to_place, purpose, kilometers, rate_per_km, business, invoice_id')
            .in('id', chunk)
            .eq('user_id', ownerId)
            .is('invoice_id', null)
            .order('id', { ascending: true })
            .range(from, to),
        )
      } catch (e) {
        ritErr = { message: e instanceof Error ? e.message : 'ritten read failed' }
      }

      // [NO-SILENT-EMPTY] An unreachable database must not look like "no trips" — that would be an
      // invoice without the lines it was asked for, and the trips would stay billable.
      if (ritErr) {
        console.error('[RITTEN] ritten lezen mislukt — geen concept gemaakt', { ritErr })
        return NextResponse.json(
          { error: 'De ritten konden niet worden gelezen. Probeer het opnieuw.' },
          { status: 503 },
        )
      }

      const gevonden = (ritten ?? []) as MileageEntry[]
      if (gevonden.length === 0) {
        return NextResponse.json({ error: RITTEN_REFUSAL_NL.none_billable, code: 'none_billable' }, { status: 409 })
      }

      // [TARIEF-STRIKT] The RAW value: Number(null) is 0, a legal rate, and a body carrying
      // ritten_btw_rate: null would bill the whole travel invoice at 0%.
      const gebouwdeRitten = linesFromTrips(gevonden, body.ritten_btw_rate)
      if (gebouwdeRitten.lines.length === 0) {
        return NextResponse.json({ error: RITTEN_REFUSAL_NL.no_rate, code: 'no_rate' }, { status: 409 })
      }
      body.lines = [...(Array.isArray(body.lines) ? body.lines : []), ...gebouwdeRitten.lines]
      ritIds = gebouwdeRitten.billedIds
    }

    // ── De regels, gecontroleerd vóór ze de database raken ───────────────────
    // [MIN-REGEL] `soort` comes with them: a creditnota's lines are sent POSITIVE here and the sign
    // is applied below, so on this route the exemption changes nothing today — it is passed because
    // the rule is about which document this is, and a route that answers that question by accident
    // is one refactor away from answering it wrong.
    const gecontroleerd = validateDraftLines(body.lines, soort)
    if (!gecontroleerd.ok) {
      // The reason travelled in `fouten` and no screen reads that array, so every rejection here
      // said "De regels kloppen niet" and stopped — the owner was told the lines were wrong and
      // never which line, or why. Both facts are already in the error; this only says one out loud.
      const eerste = gecontroleerd.errors[0]
      const waar = eerste.index >= 0 ? `Regel ${eerste.index + 1}: ` : ''
      return NextResponse.json(
        { error: `${waar}${eerste.reason}.`, fouten: gecontroleerd.errors },
        { status: 400 }
      )
    }
    const sign = soort === 'creditnota' ? -1 : 1
    // [KORTING] De korting komt uit het verzoek en wordt hier GEVALIDEERD, niet vertrouwd. Een
    // browser die "150%" of een negatief bedrag stuurt, hoort geen factuur op te leveren waarvan
    // het totaal nergens op slaat — parseDiscount geeft dan null en de factuur is er gewoon zonder.
    const korting = parseDiscount(body.discount_type, body.discount_value)
    const totalen = computeDraftTotals(gecontroleerd.lines, sign, korting)

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

    const klantNaam = typeof body.client_name === 'string' ? body.client_name.trim() : ''
    if (!klantNaam) {
      return NextResponse.json({ error: 'Een factuur zonder klant kan niet' }, { status: 400 })
    }

    // ── [AANBETALING] A deposit names its offerte, and the offerte must be this owner's ──────
    // Only a factuur can be a deposit; the offerte must exist under this owner and BE an offerte.
    // A wrong id is refused, never silently dropped: a deposit that forgot its offerte would be
    // billed a second time on the final invoice.
    const depositRaw = body.deposit_on_offerte_id
    let depositOnOfferteId: string | null = null
    if (depositRaw != null && depositRaw !== '') {
      if (typeof depositRaw !== 'string' || !UUID_RE.test(depositRaw) || soort !== 'factuur') {
        return NextResponse.json({ error: 'Een aanbetaling hoort bij een offerte' }, { status: 400 })
      }
      const { data: offerte, error: offerteErr } = await pipeline
        .from('invoices')
        .select('id, invoice_type, sender_id')
        .eq('id', depositRaw)
        .eq('sender_id', ownerId)
        .in('invoice_type', ['pro_forma', 'offerte'])
        .maybeSingle()
      if (offerteErr) {
        return NextResponse.json({ error: 'De offerte kon niet worden gelezen. Probeer het opnieuw.' }, { status: 503 })
      }
      if (!offerte) return NextResponse.json({ error: 'Offerte niet gevonden' }, { status: 404 })
      depositOnOfferteId = offerte.id
    }


    // ── De klant ─────────────────────────────────────────────────────────────
    // Een klant die inline is ingetikt (geen keuze uit de lijst) wordt hier aangemaakt, onder de
    // eigenaar. created_by houdt bij wie hem invoerde — dat is de leesgrens van een medewerker.
    let clientId: string | null = typeof body.client_id === 'string' && body.client_id ? body.client_id : null
    if (clientId) {
      // Een meegestuurd id moet wél van dit bedrijf zijn. Zonder deze controle kon een geraden
      // uuid een factuur aan de klant van een ander koppelen.
      const { data: bestaand } = await pipeline
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('user_id', ownerId)
        .maybeSingle()
      if (!bestaand) clientId = null
    }
    if (!clientId) {
      const { data: nieuw } = await writeWithTrail<{ id: string }>(
        (spoor) => pipeline
          .from('clients')
          .insert({
            user_id: ownerId,
            name: klantNaam,
            email: body.client_email || null,
            address: body.client_address || null,
            postal_code: body.client_postal_code || null,
            city: body.client_city || null,
            btw_number: body.client_btw_number || null,
            ...spoor,
          })
          .select('id')
          .single(),
        { created_by: createdBy },
      )
      clientId = nieuw?.id ?? null
      // [KLANT-LAND] The country in its own best-effort step, for the same reason as the invoice's
      // client_country below: a column an installation may not have yet must not cost the customer.
      const nieuwLand = normalizeCountry(body.client_country)
      if (clientId && nieuwLand) {
        const { error: landErr } = await pipeline
          .from('clients')
          .update({ country: nieuwLand } as never)
          .eq('id', clientId)
          .eq('user_id', ownerId)
        if (landErr) {
          console.warn('[KLANT-LAND] het land van de nieuwe klant kon niet worden opgeslagen — pas ' +
            'supabase/migrations/client_country.sql toe', { clientId, error: landErr.message })
        }
      }
    }

    // ── De factuur ───────────────────────────────────────────────────────────
    // [KORTING] De kortingskolommen bestaan pas ná invoice_discount.sql. Meesturen op een database
    // zonder die kolommen laat de HELE insert falen (PGRST204) — en dat is het aanmaken van elke
    // factuur, voor iedereen, precies de ramp die created-by.ts in zijn kop beschrijft.
    //
    // Dus: mét korting proberen, en zonder als de kolommen er niet zijn. Maar dan MOETEN de totalen
    // mee terug. Een factuur met verlaagde bedragen en geen opgeslagen korting is een document dat
    // niet optelt tegen zijn eigen regels — erger dan geen korting. In de terugval staat de factuur
    // er dus voor de VOLLE prijs, en het antwoord zegt dat, zodat de ondernemer het weet in plaats
    // van het te ontdekken op de PDF die zijn klant al heeft.
    const zonderKorting = computeDraftTotals(gecontroleerd.lines, sign, null)
    const { data: factuur, error: insertErr, trailWritten } = await writeWithTrail<{ id: string }>(
      (spoor) => pipeline
      .from('invoices')
      .insert({
        sender_id: ownerId,
        // [FACTUUR-A] Altijd null bij het aanmaken — het nummer wordt op de send-route geslagen
        // (Art. 35). Een browser heeft nooit een factuurnummer mogen bedenken, en nu ook een
        // medewerker niet.
        invoice_number: null,
        invoice_date: body.invoice_date || null,
        due_date: body.due_date || null,
        delivery_date: soort === 'factuur' ? (body.delivery_date || body.invoice_date || null) : null,
        status: 'draft',
        invoice_type: DB_TYPE[soort],
        direction: 'outgoing',
        // [KORTING] De totalen en de korting reizen SAMEN. `spoor` is leeg zodra de terugval van
        // writeWithTrail heeft toegeslagen, en dan hoort ook de verlaging van tafel.
        ...(korting && Object.keys(spoor).length ? totalen : zonderKorting),
        source: 'created',
        // Wat de ondernemer AFSPRAK, niet wat het toevallig opleverde. "10%" en "€ 200" zijn op
        // deze factuur hetzelfde bedrag en op de volgende niet; alleen het bedrag bewaren maakt
        // het document onreproduceerbaar zodra er een regel bij komt.
        ...(korting && Object.keys(spoor).length
          ? { discount_type: korting.type, discount_value: korting.value }
          : {}),
        client_name: klantNaam,
        client_id: clientId,
        client_email: body.client_email || null,
        client_address: body.client_address || null,
        client_postal_code: body.client_postal_code || null,
        client_city: body.client_city || null,
        client_btw_number: body.client_btw_number || null,
        original_invoice_id: soort === 'creditnota' ? null : (body.replaces_id || null),
        ...spoor,
        // [KORTING] De rij-brede `as any` die hier stond is weg: invoice_discount.sql is gedraaid en
        // discount_type/discount_value staan in de types. Die cast dekte de HELE rij, niet alleen
        // de twee nieuwe kolommen — op een insert waar bedragen, eigenaar en factuursoort in staan.
        // Zolang een kolom nog niet bestond was dat de prijs; nu niet meer, dus hij gaat eraf.
        //
        // De terugval eromheen blijft wél staan: hij is gedeeld met created_by en beschermt elke
        // installatie waar een migratie nog open staat.
      })
      .select('id')
      .single(),
      // [KORTING] De kortingskolommen reizen mee in dezelfde terugval als created_by: mist één
      // van de drie, dan wordt de rij zonder alle drie geschreven. Grover dan nodig, en met opzet —
      // één terugval die je kunt navertellen is veiliger dan drie die elkaar kruisen. `trailWritten`
      // is precies het signaal: false betekent dat de tweede poging is gebruikt.
      { created_by: createdBy },
    )

    if (insertErr || !factuur) {
      console.error('[ACTING-FOR] concept aanmaken mislukt', { insertErr, ownerId, namens: isActingForOther(acting) })
      return NextResponse.json({ error: 'Aanmaken mislukt — probeer opnieuw' }, { status: 500 })
    }

    // ── [AANBETALING] The link to the offerte, in its own write ───────────────────────────
    // Apart from the insert for the same reason as the client lines below: the trail must not
    // fall with it. But unlike those lines this one may NOT fail quietly — a deposit without its
    // offerte is billed again on the final invoice — so a failed link removes the concept.
    if (depositOnOfferteId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkErr } = await (pipeline as any)
        .from('invoices')
        .update({ deposit_on_offerte_id: depositOnOfferteId })
        .eq('id', factuur.id)
        .eq('sender_id', ownerId)
      if (linkErr) {
        console.error('[AANBETALING] koppeling aan de offerte mislukt — concept verwijderd', { invoiceId: factuur.id, error: linkErr.message })
        await pipeline.from('invoices').delete().eq('id', factuur.id).eq('sender_id', ownerId)
        return NextResponse.json({ error: 'De aanbetaling kon niet aan de offerte worden gekoppeld — probeer opnieuw' }, { status: 500 })
      }
    }

    // ── [KLANT-EXTRA] De twee vrije klantregels, in een EIGEN schrijfbeurt ───
    //
    // Bewust NIET in de insert hierboven en ook niet in het spoor ernaast. Zou een onbekende kolom
    // die insert laten mislukken, dan valt writeWithTrail terug op een poging ZONDER spoor — en
    // dan verliest deze factuur ook created_by, de vastlegging van wie hem namens wie heeft
    // aangemaakt. Twee adresregels mogen dat spoor niet meenemen in hun val.
    //
    // Dus: de factuur staat er al, en dit is een aparte update die mag mislukken. Kost één extra
    // rondje, en alleen wanneer de ondernemer de velden ook echt heeft ingevuld.
    const extraLines = extraLineFields(...CLIENT_EXTRA_LINE_COLUMNS.map((c) => body[c]))
    if (CLIENT_EXTRA_LINE_COLUMNS.some((c) => extraLines[c])) {
      const { error: extraErr } = await pipeline
        .from('invoices')
        .update(extraLines as never)
        .eq('id', factuur.id)
        .eq('sender_id', ownerId)
      if (extraErr) {
        // Luid, want dit is tijdelijk: het betekent dat de migratie nog open staat. Het concept
        // zelf staat er, met alle bedragen — wat ontbreekt zijn de twee regels onder de klantnaam.
        console.warn('[KLANT-EXTRA] de twee klantregels konden niet worden opgeslagen — pas ' +
          'supabase/migrations/client_extra_lines.sql toe', { invoiceId: factuur.id, error: extraErr.message })
      }
    }

    // ── [KLANT-LAND] The customer's country on the document, in its OWN write ──
    //
    // The same shape as the two lines above and for the same reason: a column an installation may
    // not have yet must not take created_by down with it. The invoice stands; the country is a
    // separate update that may fail, loudly, naming the migration.
    const klantLand = normalizeCountry(body.client_country)
    if (klantLand) {
      const { error: landErr } = await pipeline
        .from('invoices')
        .update({ client_country: klantLand } as never)
        .eq('id', factuur.id)
        .eq('sender_id', ownerId)
      if (landErr) {
        console.warn('[KLANT-LAND] het land van de klant kon niet op de factuur worden opgeslagen — pas ' +
          'supabase/migrations/client_country.sql toe', { invoiceId: factuur.id, error: landErr.message })
      }
    }

    // ── [CREDITNOTA-EXTERN] The invoice a standalone creditnota corrects, in its OWN write ──
    //
    // Same shape as the country above, same reason: creditnota_external_reference.sql is newer
    // than some installations, and one unknown column in the INSERT would cost the creditnota.
    // The document stands; the reference is a separate update that may fail, loudly, naming the
    // migration — and the send door then refuses the standalone creditnota until it is there.
    if (soort === 'creditnota') {
      const verwezenNummer = typeof body.credited_invoice_number === 'string' ? body.credited_invoice_number.trim() : ''
      const verwezenDatum =
        typeof body.credited_invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.credited_invoice_date)
          ? body.credited_invoice_date
          : null
      if (verwezenNummer) {
        const { error: refErr } = await pipeline
          .from('invoices')
          .update({ credited_invoice_number: verwezenNummer, credited_invoice_date: verwezenDatum } as never)
          .eq('id', factuur.id)
          .eq('sender_id', ownerId)
        if (refErr) {
          console.warn('[CREDITNOTA-EXTERN] de verwijzing naar de gecrediteerde factuur kon niet worden opgeslagen — pas ' +
            'supabase/migrations/creditnota_external_reference.sql toe', { invoiceId: factuur.id, error: refErr.message })
        }
      }
    }

    // ── De regels ────────────────────────────────────────────────────────────
    const bron = body.lines as Array<Record<string, unknown>>
    // [UNIT] `unit` komt uit migratie invoice_line_unit.sql en gaat via dezelfde terugval
    // als created_by: bestaat de kolom nog niet, dan worden de regels ZONDER eenheid geschreven
    // in plaats van dat het aanmaken van de factuur helemaal faalt (PGRST204). Wat je dan mist is
    // de juiste eenheidscode in de e-factuur, niet de factuur zelf.
    const { error: lineErr, trailWritten: regelKolommenGeschreven } = await writeWithTrail(
      (spoor) => pipeline.from('invoice_lines').insert(
        gecontroleerd.lines.map((l, i) => ({
          invoice_id: factuur.id,
          description: String(bron[i]?.description ?? '').trim(),
          quantity: sign * l.quantity,
          unit_price: l.unit_price,
          btw_rate: l.btw_rate,
          // [REGEL-AFRONDING] Afgerond, net als de PUT-route en de gratis generator.
          //
          // Zonder dit staat 1,5 uur x EUR 33,33 als 49,995 in de kolom (invoice_lines.line_total
          // is numeric ZONDER schaal, dus het wordt letterlijk zo bewaard). De PDF drukt dan twee
          // regels van EUR 50,00 met een subtotaal van EUR 99,99: de klant telt 50 + 50 op en de
          // factuur zegt iets anders.
          //
          // In de UBL-export is het erger dan lelijk. Elke InvoiceLine krijgt round2(line_total) =
          // 50,00 terwijl LegalMonetaryTotal de som van de RUWE waarden afrondt tot 99,99. Peppol
          // BIS 3.0 regel BR-CO-10 eist dat die twee gelijk zijn, dus het e-factuurbestand wordt
          // bij het ontvangende access point geweigerd — de factuur komt niet aan.
          //
          // En het bedrag hing af van de route: dezelfde factuur via het bewerkscherm opgeslagen
          // kwam er wél op EUR 121,00 uit, omdat de PUT per regel afrondt. Twee wegen naar hetzelfde
          // document met twee verschillende totalen is precies wat een boekhouder niet kan uitleggen.
          // [REGEL-KORTING] NETTO — aantal × prijs min de korting die op deze regel zelf zit.
          // Dat is de afspraak van de kolom (invoice_line_discount.sql): elke lezer die van
          // regelkortingen nooit heeft gehoord telt line_total op en komt op het juiste bedrag
          // uit. Andersom zou elke vergeten lezer de klant te veel in rekening brengen.
          line_total: lineNetEx({
            quantity: sign * l.quantity,
            unit_price: l.unit_price,
            discount_type: l.discount_type,
            discount_value: l.discount_value,
          }),
          // De eenheid hoort bij de regel, dus per regel — niet één keer voor de hele factuur.
          ...(Object.keys(spoor).length
            ? {
                unit: schoonEenheid(bron[i]?.unit),
                // [VRIJGESTELD] Alleen de letterlijke waarden tellen ('exempt', 'reverse_charge');
                // al het andere is NULL = gewoon belast. Zo kan een oude of vreemde client deze
                // kolom niet gebruiken om omzet uit de aangifte te laten verdwijnen. Eén harding
                // voor elke schrijver: line-vat-treatment.ts.
                vat_treatment: storedVatTreatment(bron[i]?.vat_treatment),
                // [REGEL-KORTING] Het AFGESPROKEN getal, al gecontroleerd door validateDraftLines.
                // Het uitgerekende bedrag staat niet in een kolom — line_total is al netto.
                discount_type: l.discount_type ?? null,
                discount_value: l.discount_value ?? null,
              }
            : {}),
        })),
      ),
      // De sleutel is een vlag: is hij aanwezig, dan worden `unit`, `vat_treatment` en de twee
      // kortingskolommen per regel meegeschreven. Ze reizen samen omdat writeWithTrail één
      // terugval kent: mist één van die kolommen, dan worden de regels zonder allemaal
      // geschreven — een factuur zonder eenheid, nooit helemaal geen factuur.
      { unit: true },
    )

    // [REGEL-KORTING] Maar een KORTING mag niet op die manier verdwijnen.
    //
    // Bij de andere kolommen is de terugval goedaardig: je mist een eenheidscode, niet je geld.
    // Hier niet. line_total is al verlaagd, dus het bedrag klopt — maar het WAAROM is weg, en
    // zodra de ondernemer deze factuur opnieuw opent rekent het bewerkscherm aantal × prijs uit
    // en staat de volle prijs er weer. De korting verdampt bij de eerstvolgende bewerking, zonder
    // dat iemand iets ziet gebeuren.
    //
    // Dus: is er een korting gegeven en bestaan de kolommen niet, dan gaat het concept terug en
    // hoort de ondernemer waarom. Regels eerst — een factuur die weg is met haar regels er nog is
    // erger dan de fout zelf.
    if (!lineErr && !regelKolommenGeschreven && gecontroleerd.lines.some((l) => l.discount_type)) {
      await pipeline.from('invoice_lines').delete().eq('invoice_id', factuur.id)
      await pipeline.from('invoices').delete().eq('id', factuur.id)
      console.error('[REGEL-KORTING] regelkorting gevraagd maar de kolommen bestaan nog niet — ' +
        'pas supabase/migrations/invoice_line_discount.sql toe', { invoiceId: factuur.id })
      return NextResponse.json(
        { error: 'Korting per regel kan nog niet worden opgeslagen — de database mist een update. Haal de korting van de regels af, of neem contact op.' },
        { status: 503 },
      )
    }

    if (lineErr) {
      // Een factuurkop zonder regels is erger dan geen factuur: hij telt mee in overzichten en
      // is leeg als je hem opent. Terugdraaien, en eerlijk melden dat het niet lukte.
      await pipeline.from('invoices').delete().eq('id', factuur.id)
      console.error('[ACTING-FOR] regels wegschrijven mislukt — concept teruggedraaid', { lineErr })
      return NextResponse.json({ error: 'Aanmaken mislukt — probeer opnieuw' }, { status: 500 })
    }

    // ── [UREN-EENMALIG] De uren vastzetten op DEZE factuur ───────────────────────────────────
    //
    // Dit is het moment waarop "nog te factureren" ophoudt te gelden, en het moet samenvallen met
    // het bestaan van de factuur — anders is er een venster waarin de regels er staan en de uren
    // nog vrij zijn, en dan gaan ze een tweede keer mee.
    //
    // `.is('invoice_id', null)` staat er niet voor de netheid maar voor de RACE: twee tabbladen die
    // tegelijk dezelfde uren factureren komen hier allebei langs, en de tweede krijgt nul rijen
    // terug. Dat is de database die de vraag beantwoordt, niet wij die hopen.
    //
    // Komt er ook maar één uur niet terug, dan gaat de factuur weg. Een concept met regels waar
    // geen uren onder zitten is erger dan geen factuur: de uren blijven in de lijst staan en worden
    // straks nóg een keer gefactureerd, en de klant is degene die dat merkt.
    if (urenIds.length > 0) {
      // [IN-CHUNK] Per brok. Deze UPDATE is wat een uur AAN de factuur vastzet; sneuvelde ze in
      // haar geheel op een 414, dan bestond de factuur wel en waren de uren nog vrij — dus
      // factureerbaar voor een tweede keer. verifyStamped hieronder ving dat al op en draaide de
      // hele factuur terug, wat de juiste uitkomst is; chunken maakt dat de zeldzame uitkomst.
      const vastgezet: Array<{ id: string }> = []
      let urenLinkErr: { message: string } | null = null
      for (const chunk of chunkIds(urenIds)) {
        const { data: brok, error: brokErr } = await pipeline
          .from('time_entries')
          .update({ invoice_id: factuur.id, updated_at: new Date().toISOString() })
          .in('id', chunk)
          .eq('user_id', ownerId)
          .is('invoice_id', null)
          .select('id')
        if (brokErr) { urenLinkErr = brokErr; break }
        vastgezet.push(...((brok ?? []) as Array<{ id: string }>))
      }

      const uitkomst = urenLinkErr
        ? { ok: false as const, missing: urenIds }
        : verifyStamped(urenIds, vastgezet.map((r) => r.id))

      if (!uitkomst.ok) {
        // Eerst de uren die het WEL haalden weer losmaken, dan de regels, dan de factuur. In deze
        // volgorde, want een uur dat naar een verwijderde factuur wijst is precies het spook dat
        // de foreign key hoort te voorkomen — ON DELETE SET NULL vangt het op, maar erop leunen
        // terwijl we het zelf kunnen opruimen is een aanname te veel.
        // [RLS-UIT] Ook hier het eigenaarsfilter, al is `factuur.id` net onder ownerId aangemaakt.
        // Deze client is service_role, dus RLS kijkt niet mee; een filter dat 'in dit geval toch
        // wel goed gaat' is er een die bij de eerstvolgende verplaatsing van deze regel niet meer
        // goed gaat, en dan is het een andere administratie.
        await pipeline.from('time_entries').update({ invoice_id: null })
          .eq('invoice_id', factuur.id).eq('user_id', ownerId)
        await pipeline.from('invoice_lines').delete().eq('invoice_id', factuur.id)
        await pipeline.from('invoices').delete().eq('id', factuur.id)
        console.error('[UREN-EENMALIG] uren niet vastgezet — concept teruggedraaid', {
          invoiceId: factuur.id, gevraagd: urenIds.length, missing: uitkomst.missing.length, urenLinkErr,
        })
        return NextResponse.json(
          {
            error: 'De uren konden niet aan deze factuur worden gekoppeld, dus is de factuur niet aangemaakt. ' +
              'Ververs de pagina — waarschijnlijk staan ze inmiddels op een andere factuur.',
            code: 'uren_not_linked',
          },
          { status: 409 },
        )
      }
    }

    // [RITTEN-EENMALIG] Dezelfde vastzetstap voor de ritten, met dezelfde uitkomst als er ook maar
    // één niet terugkomt: de factuur gaat weg. Het opruimen maakt ÓÓK de uren weer los — die zijn
    // hierboven al aan deze factuur gehangen, en een uur dat naar een verwijderde factuur wijst is
    // precies het spook dat de foreign key hoort te voorkomen.
    if (ritIds.length > 0) {
      const vastgezetteRitten: Array<{ id: string }> = []
      let ritLinkErr: { message: string } | null = null
      for (const chunk of chunkIds(ritIds)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: brok, error: brokErr } = await (pipeline as any)
          .from('mileage_entries')
          .update({ invoice_id: factuur.id, updated_at: new Date().toISOString() })
          .in('id', chunk)
          .eq('user_id', ownerId)
          // De RACE, niet de netheid: twee tabbladen die dezelfde ritten factureren komen hier
          // allebei langs, en de tweede krijgt nul rijen terug.
          .is('invoice_id', null)
          .select('id')
        if (brokErr) { ritLinkErr = brokErr; break }
        vastgezetteRitten.push(...((brok ?? []) as Array<{ id: string }>))
      }

      const ritUitkomst = ritLinkErr
        ? { ok: false as const, missing: ritIds }
        : verifyStamped(ritIds, vastgezetteRitten.map((r) => r.id))

      if (!ritUitkomst.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (pipeline as any).from('mileage_entries').update({ invoice_id: null })
          .eq('invoice_id', factuur.id).eq('user_id', ownerId)
        await pipeline.from('time_entries').update({ invoice_id: null })
          .eq('invoice_id', factuur.id).eq('user_id', ownerId)
        await pipeline.from('invoice_lines').delete().eq('invoice_id', factuur.id)
        await pipeline.from('invoices').delete().eq('id', factuur.id)
        console.error('[RITTEN-EENMALIG] ritten niet vastgezet — concept teruggedraaid', {
          invoiceId: factuur.id, gevraagd: ritIds.length, missing: ritUitkomst.missing.length, ritLinkErr,
        })
        return NextResponse.json(
          {
            error: 'De ritten konden niet aan deze factuur worden gekoppeld, dus is de factuur niet aangemaakt. ' +
              'Ververs de pagina — waarschijnlijk staan ze inmiddels op een andere factuur.',
            code: 'ritten_not_linked',
          },
          { status: 409 },
        )
      }
    }

    // [ARTIKEL-LEREN] Wat de ondernemer hier typt, onthoudt de catalogus — vanaf de EERSTE factuur.
    // Tot nu toe vulde die catalogus zich alleen als je hem al kende: via /dashboard/artikelen, of
    // via het kleine "bewaar in catalogus"-knopje naast een regel. Wie dat niet wist, typte regel
    // twintig nog steeds met de hand en trof een lege suggestielijst aan.
    //
    // Nooit een reden om de factuur te laten mislukken: de factuur en haar regels staan hier al, en
    // de catalogus is een hulplijst ernaast. Vandaar de eigen try/catch en de log in plaats van een
    // foutmelding — er is op dit punt niets meer aan de factuur dat nog kan misgaan.
    await learnFromLines({
      db: pipeline, ownerId, documentKind: soort,
      lines: gecontroleerd.lines.map((l, i) => ({
        description: String(bron[i]?.description ?? '').trim(),
        unit_price: l.unit_price,
        btw_rate: l.btw_rate,
        unit: schoonEenheid(bron[i]?.unit),
      })),
    })

    return NextResponse.json({
      ok: true, invoiceId: factuur.id, clientId,
      // [KORTING] Gezegd, niet verzwegen. De factuur staat er dan voor de volle prijs.
      ...(korting && !trailWritten ? { warning: 'discount_not_stored' } : {}),
    })
  } catch (e) {
    console.error('[ACTING-FOR] /api/invoice/draft', e)
    return NextResponse.json({ error: 'Server fout' }, { status: 500 })
  }
}
