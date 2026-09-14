// src/app/api/invoice/creditnota/route.ts
// [BOEK-031] Creditnota aanmaken — May 2026
// [FACTUUR-A] Consistency rebuild — June 2026
// Regel: alleen voor verzonden facturen (sent / paid / overdue / received / processing / processed)
// Creditnota corrigeert — verwijderen mag nooit
// =====================================================
// [FACTUUR-A] Changes:
//   * Numbering unified on lib/invoice-numbering generateInvoiceNumber
//     (CR- prefix — same generator as the send route; the old
//     rpc('generate_invoice_number') + 'CN-' fallback produced a second,
//     conflicting numbering scheme).
//   * Fixed silently swallowed `source: 'created'` — a BRIDGE-A comment was
//     merged onto the same line and commented the field out.
//   * Real duplicate guard via original_invoice_id (the column + FK exist on
//     invoices) — the old check matched invoice_number = 'CN-…' which never
//     matches CR- format, i.e. dead code.
//   * delivery_date copied from the original (the creditnota corrects that
//     same supply — Art. 35a sub f).
//   * Creditnota is itself a legal invoice (Art. 35) → it is now DELIVERED:
//     PDF rendered + e-mailed, same pipeline as the send route. Best-effort:
//     a delivery failure never rolls back the creditnota (number consumed).
// =====================================================

import { NextRequest, NextResponse } from 'next/server'
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { fetchAllRowsForIds } from '@/lib/supabase-paginate'
import { amsterdamToday } from '@/lib/format-nl'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { runBankAutoConfirm } from '@/lib/bank-auto-confirm'
// [BOEK-031] BOEK-SECURITY-2 — audit logs via service_role helper — May 2026
import { logAuditAction, getClientIP } from '@/lib/audit'
// [FACTUUR-A] unified numbering + legal delivery — June 2026
import { generateInvoiceNumber } from '@/lib/invoice-numbering'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { ublAttachmentForInvoice } from '@/lib/ubl-for-email'
import { sendInvoiceToClient } from '@/lib/email'
import * as Sentry from '@sentry/nextjs'
// [ACTING-FOR] Omgebouwd in plaats van dichtgezet. Een verkoper die zich vergiste in een VERSTUURDE
// factuur heeft maar één wettelijke weg terug: een creditnota. Zonder deze route zou hij bij een
// typefout in een bedrag moeten wachten op zijn baas, terwijl de klant al een verkeerde factuur
// heeft. Het nummer komt uit de reeks van de EIGENAAR — dat is de hele reden dat dit zo loopt.
// [CREDIT-NAMENS] En dezelfde weg terug voor de BOEKHOUDER, met het mandaat als de sleutel. Zie
// de kop van deze route voor wat hij daarmee wel en niet mag.
import { getActingFor, getActingForClient } from '@/lib/acting-for-server'
// [CREDIT-NAMENS] De klant hoort het te weten van een correctie op zijn eigen naam.
import { createNotification } from '@/lib/notifications'
import { invoiceOwnerId, invoiceCreatedBy, isActingForOther } from '@/lib/acting-for'
import { contextFromActing } from '@/lib/access/context'
import { authorize } from '@/lib/access/decision'
// [ACTING-FOR] created_by bestaat pas ná de migratie — zonder terugval faalt de creditnota, en dat
// is de enige wettelijke weg terug bij een fout in een verstuurde factuur.
import { writeWithTrail } from '@/lib/created-by'
// [ALARM] Een poort die niet kon draaien moet iemand bereiken — zie report-handled.ts.
import { reportHandledFailure } from '@/lib/report-handled'
// [KLANT-EXTRA] De twee vrije klantregels reizen mee naar het nieuwe document — in een
// aparte, mislukbare schrijfbeurt. Zie de kop van dat bestand.
import { copyExtraLinesOnto } from '@/lib/client-extra-lines-write'
// [CREDIT-SIGN] The per-line mirror: which fields flip, which travel, which are hardened.
import { creditLinesFor } from '@/lib/creditnota-lines'
// [DEEL-CREDIT] Welke regels, hoeveel ervan, en het plafond dat nooit mag schuiven.
import {
  buildCreditSelection,
  creditNetFault,
  creditNetReason,
  checkCreditSelection,
  creditedQuantitiesByLine,
  creditableRemaining,
  fitsWithinOriginal,
  overCreditReason,
  type LineSelection,
} from '@/lib/partial-credit'
import { creditedTotalsFrom } from '@/lib/credited-invoices'
import { storeOriginal } from '@/lib/document-storage'

// ── [CREDIT-NAMENS] De boekhouder corrigeert wat hij zelf heeft uitgereikt ──────────────────────
//
// Een gemachtigde boekhouder kon een factuur MAKEN op naam van zijn klant en hem VERSTUREN, maar
// hem niet corrigeren: deze route kende alleen getActingFor(), dus namens_klant_id bestond hier
// niet en de enige wettelijke weg terug lag bij de klant. Voor een ondernemer die zijn facturatie
// volledig bij zijn boekhouder heeft liggen, betekende dat: de fout is van de boekhouder, de
// reparatie moet van de klant komen.
//
// WAT ER NIET IS VERBREED, EN DAT IS HET BELANGRIJKSTE
// canAccessInvoice() blijft precies wat het was. Een boekhouder crediteert alleen facturen die
// HIJ heeft uitgereikt (created_by), nooit die van de klant zelf — dezelfde regel die
// canSendInvoice() al uitschrijft, en om dezelfde reden: een mandaat is toestemming om facturen
// op iemands naam te SCHRIJVEN, geen toestemming om aan de zijne te komen. Het gat dat de
// eigenaar voelde zit volledig binnen die grens: de facturen die hij bedoelt zijn juist de
// facturen die zijn boekhouder heeft gemaakt.
//
// WAAROM ER GEEN MIGRATIE BIJ HOORT
// next_invoice_seq() liet een gemachtigde al nummers trekken van soort 'creditnota' — die functie
// is destijds algemeen geschreven, niet alleen voor facturen. De twee boekhouderstriggers op
// invoices staan op BEFORE UPDATE en raken een INSERT dus niet. En het plafond dat er wél toe
// doet, assert_credit_within_original(), kijkt niet naar auth.uid(): het vergrendelt het
// origineel en telt, ongeacht wie er schrijft. Deze route wint er dus geen enkele bevoegdheid bij
// in de database — ze gebruikt de bevoegdheid die de klant al had gegeven.
//
// [RLS-UIT] Leest en schrijft de boekhouder mee, dan kan dat niet via zijn sessie: RLS toont hem
// de regels van zijn klant niet (invoice_lines_select_accountant eist 'paid', en 'overdue' is niet
// eens gedeeld). Dus service_role, met de eigenaar in de QUERY — zie `db` hieronder.

// [CREDITNOTA-PDF] Same storage bucket the send route and the closing package
// use. A creditnota's PDF MUST be stored here and its path written to
// invoices.pdf_url, or the correction document is missing from the accountant's
// closing package (the package resolves an outgoing invoice's PDF via pdf_url).

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { original_invoice_id, reason } = body

    // [CREDIT-NAMENS] Namens wie? Precies zoals /api/invoice/draft en /send het vragen: staat er
    // een klant genoemd, dan is de machtiging de sleutel en wordt zij hier opnieuw getoetst —
    // rol, koppeling, soort en intrekking, alle vier, bij elke aanroep. Staat er niets, dan is dit
    // letterlijk het verzoek van hiervoor.
    const namensKlantId =
      typeof body?.namens_klant_id === 'string' && body.namens_klant_id ? body.namens_klant_id : null
    const acting = namensKlantId ? await getActingForClient(namensKlantId) : await getActingFor()
    if (!acting) {
      return namensKlantId
        ? NextResponse.json({ error: 'Je hebt geen toestemming om namens deze klant te crediteren' }, { status: 403 })
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const ownerId = invoiceOwnerId(acting)

    // [RLS-UIT] De lees- en schrijfclient. Voor de eigenaar en de verkoopmedewerker verandert er
    // niets: hun sessie ziet deze rijen. Voor de boekhouder ziet zij ze niet, dus daar gaat het
    // langs service_role — en dan staat de afscherming in de query, niet in het beleid. Elke
    // `db`-lezing hieronder draagt daarom de eigenaar bij zich, of staat als REVIEWED in de
    // [RLS-UIT]-poort met de reden erbij.
    const boekhouder = acting.role === 'boekhouder'
    const db = boekhouder ? createPipelineClient() : supabase
    // [DEEL-CREDIT] Optioneel, en dat is de hele migratiestrategie: laat een client hem weg, dan
    // is dit letterlijk het verzoek van hiervoor — de HELE factuur — en komt er tot op de cent
    // uit wat er altijd uitkwam.
    const selectie: LineSelection[] | null = Array.isArray(body?.lines)
      ? (body.lines as unknown[])
          .map((r) => {
            const row = (r ?? {}) as Record<string, unknown>
            return { id: String(row.id ?? ''), quantity: Number(row.quantity) }
          })
          .filter((r) => r.id !== '')
      : null

    if (!original_invoice_id) {
      return NextResponse.json(
        { error: 'original_invoice_id is verplicht' },
        { status: 400 }
      )
    }

    // [BOEK-031] Haal de originele factuur op — verificatie eigenaar
    // [FACTUUR-A] select('*') — delivery_date + full address block needed
    // [RLS-UIT] `sender_id` staat er nu ook bij. Met RLS uit zegt `.eq('id', …)` niets over van
    // WIE die rij is; canAccessInvoice() hieronder weigert een vreemde factuur nog steeds, maar de
    // afscherming hoort in de query te staan en niet alleen in de regel erna.
    const { data: originalData, error: fetchError } = await db
      .from('invoices')
      .select('*')
      .eq('id', original_invoice_id)
      .eq('sender_id', ownerId)
      .single()

    if (fetchError || !originalData) {
      return NextResponse.json({ error: 'Originele factuur niet gevonden' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = originalData as any

    // [BOEK-031] Alleen de eigenaar mag een creditnota aanmaken
    // [ACTING-FOR] ...of de medewerker die de oorspronkelijke factuur ZELF maakte. canAccessInvoice() dekt
    // beide gevallen in één regel: het bedrijf moet kloppen, en bij een medewerker ook created_by.
    // [EEN-POORT] Both cases, through the one catalogue: `invoice.credit` is scoped
    // `administration` for the owner and `own` for a medewerker AND for a mandated boekhouder —
    // a mandate is permission to write invoices in someone's name, never to credit the ones the
    // client wrote themselves. Same rule as canAccessInvoice(), asserted equal in
    // access/decision.test.ts, and now named.
    if (!authorize(contextFromActing(acting), 'invoice.credit', {
      ownerId: original.sender_id,
      createdBy: original.created_by,
    }).allowed) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    // [BOEK-031] Creditnota alleen mogelijk op verzonden facturen. Draft facturen verwijder je.
    // [LC2] This route only credits an invoice the owner SENT (outgoing — see the sender_id guard
    // above), and the creditnota counts as −omzet (status 'sent'). So the original MUST be a status
    // that actually counted as +omzet — outgoing = {sent, paid, overdue} in computeResult. Crediting
    // an outgoing invoice that never counted (a stray 'processing'/'received'/'processed') would
    // book phantom NEGATIVE omzet with nothing to offset it. Those statuses aren't reachable for a
    // normal outgoing invoice anyway, so restricting to the counting set is safe and closes the gap.
    const CREDITABLE_STATUSES: string[] = ['sent', 'paid', 'overdue']
    if (!original.status || !CREDITABLE_STATUSES.includes(original.status)) {
      return NextResponse.json(
        { error: 'Alleen een verzonden of betaalde factuur kan worden gecrediteerd. Een concept of nog niet-geboekte factuur verwijder of bewerk je gewoon.' },
        { status: 400 }
      )
    }

    // [COHERENCE-CREDITNOTA] Never credit a creditnota (a creditnota has status 'sent', so
    // it passes the status check above). Crediting a credit would mint a positive "credit
    // of a credit" that fabricates +omzet with nothing behind it. Only a real factuur is
    // creditable. Not reachable through the UI, but the route is the authority.
    if (original.invoice_type === 'creditnota') {
      return NextResponse.json(
        { error: 'Een creditnota kan niet zelf worden gecrediteerd.' },
        { status: 400 }
      )
    }

    // [FACTUUR-A] Duplicate guard — one creditnota per invoice, enforced via
    // original_invoice_id (column + FK exist on invoices). Replaces the dead
    // invoice_number='CN-…' check that could never match CR- numbering.
    // [NO-SILENT-EMPTY] The error was dropped, and null here means "no creditnota exists yet" — so
    // a failed read let a SECOND one be created for the same invoice. That is money out twice: the
    // customer's balance is credited again, two credit notes point at one invoice, and the
    // `credited` set that the public pay page and the reminder cron both derive from
    // original_invoice_id stops meaning one thing.
    //
    // It is also unrecoverable in the one way this codebase cares most about. Ten lines below, the
    // route mints a creditnota number — Art. 35, forward-only, "once committed, no rollback". A
    // duplicate created here does not just double the credit, it burns a number in the legal
    // sequence to do it. So the refusal has to come BEFORE the number, which is where it now is.
    const { data: existingCreditnotas, error: existingErr } = await db
      .from('invoices')
      .select('id, invoice_number, total_inc_btw')
      .eq('sender_id', ownerId)
      .eq('invoice_type', 'creditnota')
      .eq('original_invoice_id', original_invoice_id)

    if (existingErr) {
      reportHandledFailure({
        tag: 'CREDITNOTA-GUARD',
        message: 'existing-creditnota check failed — refusing to create',
        severity: 'gate-unavailable',
        context: { ownerId, originalInvoiceId: original_invoice_id, error: existingErr.message },
      })
      return NextResponse.json(
        { error: 'We konden niet nakijken wat er al van deze factuur is gecrediteerd. Er is niets aangemaakt — probeer het zo meteen opnieuw.' },
        { status: 503 },
      )
    }

    // ── [DEEL-CREDIT] De regels van het origineel, en wat er van gecrediteerd wordt ──
    //
    // Dit staat VÓÓR het nummer, en dat is dezelfde les als bij de oude dubbelcheck: een creditnota
    // die hier wordt geweigerd heeft nog geen nummer verbruikt. Art. 35 kent geen weg terug.
    const { data: originalLines, error: linesErr } = await db
      .from('invoice_lines')
      // [UNIT] '*' zodat elke kolom meekomt zonder tweede lijst; de INSERT typt hieronder over.
      .select('*')
      .eq('invoice_id', original_invoice_id)

    if (linesErr) {
      reportHandledFailure({
        tag: 'DEEL-CREDIT',
        message: 'invoice lines read failed — refusing to credit',
        severity: 'gate-unavailable',
        context: { ownerId, originalInvoiceId: original_invoice_id, error: linesErr.message },
      })
      return NextResponse.json(
        { error: 'We konden de regels van deze factuur niet lezen. Er is niets aangemaakt — probeer het zo meteen opnieuw.' },
        { status: 503 },
      )
    }

    const bronRegels = (originalLines ?? []) as Parameters<typeof buildCreditSelection>[0]['lines']

    // ── [DEEL-CREDIT-CUMULATIEF] Wat er van elke regel al is teruggenomen ──
    //
    // Zonder dit kijkt checkCreditSelection alleen naar het ORIGINEEL, en dan is elke tweede
    // creditnota van dezelfde regel afzonderlijk in orde terwijl de som er dwars doorheen loopt.
    // Het brutoplafond hieronder ving dat niet op: het telt de hele factuur en is blind voor het
    // tarief, dus bij gemengde tarieven paste een dubbele credit er gewoon in. Gemeten op
    // € 1.000 @ 21% + € 1.000 @ 9%: de 9%-regel twee keer crediteren is 2 x € 1.090 <= € 2.300 en
    // haalde beide controles — € 180 btw teruggevraagd waar er € 90 is afgedragen.
    //
    // Deze lezing gaat VÓÓR het nummer, net als de twee erboven: een weigering hier heeft nog geen
    // nummer verbruikt, en art. 35 kent geen weg terug.
    const eerdereIds = (existingCreditnotas ?? []).map((c) => (c as { id: string }).id)
    let alGecrediteerdPerRegel = new Map<string, number>()
    if (eerdereIds.length > 0) {
      // [IN-CHUNK] Gechunkt én gepagineerd. Twee plafonds golden hier tegelijk: de regels van
      // meerdere creditnota's lopen makkelijk over de duizend, en de id-lijst over de URL-lengte.
      // Beide zouden een TE LAAG "al gecrediteerd" opleveren — en dat is de kant waarop deze
      // controle nooit mag missen: te laag betekent dat er nóg een keer gecrediteerd mag worden.
      let eerdereRegels: Array<Record<string, unknown>> = []
      let eerdereErr: { message: string } | null = null
      try {
        eerdereRegels = await fetchAllRowsForIds<Record<string, unknown>, string>(
          eerdereIds,
          (chunk, from, to) =>
            db
              .from('invoice_lines')
              // '*' om dezelfde reden als hierboven: elke kolom mee, zonder een tweede lijst die kan gaan
              // afwijken van wat de spiegel schrijft.
              .select('*')
              .in('invoice_id', chunk)
              .order('id', { ascending: true })
              .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>,
        )
      } catch (e) {
        eerdereErr = { message: e instanceof Error ? e.message : 'earlier creditnota lines unreadable' }
      }
      if (eerdereErr) {
        // Fail closed. Dit is de enige lezing die weet hoeveel er al terug is, en zonder haar zou
        // de controle stilletjes terugvallen op "er is nog niets gecrediteerd" — precies de fout
        // die dit blok dichtzet, maar dan met een reden om hem niet te zien.
        reportHandledFailure({
          tag: 'DEEL-CREDIT-CUMULATIEF',
          message: 'earlier creditnota lines unreadable — refusing to credit',
          severity: 'gate-unavailable',
          context: { ownerId, originalInvoiceId: original_invoice_id, error: eerdereErr.message },
        })
        return NextResponse.json(
          { error: 'We konden niet nakijken wat er al per regel van deze factuur is gecrediteerd. Er is niets aangemaakt — probeer het zo meteen opnieuw.' },
          { status: 503 },
        )
      }
      alGecrediteerdPerRegel = creditedQuantitiesByLine(
        bronRegels,
        (eerdereRegels ?? []) as Parameters<typeof creditedQuantitiesByLine>[1],
      )
    }

    const selectieFout = checkCreditSelection(bronRegels, selectie, alGecrediteerdPerRegel)
    if (selectieFout) {
      const uitleg: Record<string, string> = {
        no_lines: 'Deze factuur heeft geen regels om te crediteren.',
        nothing_selected: 'Kies minstens één regel om te crediteren.',
        unknown_line: 'Een van de gekozen regels hoort niet bij deze factuur.',
        quantity_exceeds_line: 'Je kunt niet meer crediteren dan er op de factuur staat.',
        quantity_negative: 'Het aantal om te crediteren klopt niet.',
      }
      return NextResponse.json({ error: uitleg[selectieFout] ?? 'De selectie klopt niet.' }, { status: 400 })
    }

    const keuze = buildCreditSelection({
      lines: bronRegels,
      selection: selectie,
      discountType: original.discount_type,
      discountValue: original.discount_value,
    })

    // [CREDIT-IS-CREDIT] Geeft deze selectie per saldo wel iets terug?
    //
    // De kop hieronder spiegelt de selectie onvoorwaardelijk (`-keuze.totalIncBtw`). Bij een
    // factuur met een retourregel ([MIN-REGEL]) kan de selectie NEGATIEF uitkomen — je crediteert
    // dan een teruggave — en dan maakt die spiegeling een creditnota met een POSITIEF totaal: een
    // document dat geld vraagt. Alles wat er daarna mee rekent trekt een creditnota juist AF.
    const nettoFout = creditNetFault(keuze.totalIncBtw)
    if (nettoFout) {
      return NextResponse.json({ error: creditNetReason(nettoFout) }, { status: 400 })
    }

    // ── Het plafond ──
    //
    // Meer teruggeven dan er ooit in rekening is gebracht betekent btw terugvragen die nooit is
    // afgedragen, en een tegoed voor de klant dat nergens vandaan komt. De database bewaakt
    // dezelfde regel (creditnota_partial.sql, met een vergrendeling tegen gelijktijdigheid); dit
    // is de weigering die de ondernemer kan LEZEN, vóór er een nummer wordt verbruikt.
    const alGecrediteerd = creditedTotalsFrom(
      (existingCreditnotas ?? []).map((c) => ({
        original_invoice_id,
        total_inc_btw: (c as { total_inc_btw: number | null }).total_inc_btw,
      })),
    ).get(original_invoice_id) ?? 0

    if (!fitsWithinOriginal(original.total_inc_btw, alGecrediteerd, keuze.totalIncBtw)) {
      return NextResponse.json(
        { error: overCreditReason(creditableRemaining(original.total_inc_btw, alGecrediteerd)) },
        { status: 409 },
      )
    }

    // [FACTUUR-A] Genereer creditnota nummer — unified generator, CR- prefix.
    // Same Art. 35 rule applies: once committed, no rollback.
    // [ACTING-FOR] ownerId, met de SESSIE-client. Eén doorlopende reeks per bedrijf (Art. 35), en
    // next_invoice_seq() weigert onvoorwaardelijk als auth.uid() NULL is — service_role kan hier
    // dus niet in de plaats treden. Zie company_members_sales_role.sql.
    // [NUMBER-READ-VISIBLE] Het nummer wordt getrokken met de SESSIE-client — next_invoice_seq()
    // weigert onvoorwaardelijk als auth.uid() NULL is, dus service_role kan hier niet in de plaats
    // treden. Maar het SJABLOON staat op het profiel van de klant, en dat leest de sessie van een
    // boekhouder niet. Zonder de vierde parameter geeft resolveFormat() dan niets terug en weigert
    // generateInvoiceNumber() te nummeren ("never number from an unknown scheme") — de creditnota
    // zou voor een boekhouder dus niet fout genummerd worden, maar helemaal niet lukken. Zelfde
    // reparatie, zelfde reden als in de send-route.
    const creditnotaNumber = await generateInvoiceNumber(supabase, ownerId, 'creditnota', db)
    if (!creditnotaNumber) {
      return NextResponse.json({ error: 'Kon creditnotanummer niet genereren' }, { status: 500 })
    }

    const today = amsterdamToday()

    // [BOEK-031] Maak de creditnota aan
    // Bedragen zijn NEGATIEF — creditnota annuleert de originele factuur
    // [FACTUUR-A] original_invoice_id now stored properly (column exists);
    // source:'created' restored (was swallowed by an inline comment).
    const { data: creditnota, error: insertError } = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeWithTrail<any>(
      (spoor) => db
      .from('invoices')
      .insert({
        sender_id: ownerId,
        ...spoor,
        invoice_number: creditnotaNumber,
        invoice_date: today,
        due_date: today,
        status: 'sent',
        invoice_type: 'creditnota',
        direction: original.direction,
        // [BOEK-031] Negatieve bedragen — annulering
        // [DEEL-CREDIT] Uit de SELECTIE, niet uit het origineel. Bij een volledige creditnota is
        // dat tot op de cent hetzelfde bedrag (buildCreditSelection rekent met dezelfde functies
        // die de factuur zelf hebben opgeteld); bij een deelcreditnota is het het enige juiste,
        // en het kopiëren van het origineel zou het hele document een leugen maken.
        total_ex_btw: -keuze.totalExBtw,
        btw_amount: -keuze.btwAmount,
        total_inc_btw: -keuze.totalIncBtw,
        // [KORTING-KOPIE] De korting reist mee met de bedragen. Deze route kopieert de TOTALEN van
        // het origineel maar bouwt de REGELS opnieuw op — en zonder de korting spraken die twee
        // elkaar tegen: de kop droeg het verlaagde bedrag, de regels het volle. Elke afgeleide
        // (de PDF en de UBL-export rekenen uit de regels) drukte dan een ander bedrag dan er in de
        // boeken staat. Gemeten op een factuur van EUR 1.000 met 10%: EUR 121 verschil.
        // Op een creditnota spiegelt applyDiscount de korting mee (negatief document, negatieve
        // toeslag), dus de regels reproduceren de kop precies — regel voor regel te vergelijken
        // met de factuur die hij terugdraait, wat de vorm is die een boekhouder kan controleren.
        // [DEEL-CREDIT] En de korting zoals hij bij DEZE selectie hoort: een percentage reist
        // ongewijzigd mee, een vast bedrag is naar het gecrediteerde aandeel geschaald. Zonder die
        // schaling geeft een deelcreditnota met een vaste korting minder terug dan er voor die
        // regels is betaald — zie de kop van partial-credit.ts.
        discount_type: keuze.discount?.type ?? null,
        discount_value: keuze.discount?.value ?? null,
        // [BRIDGE-A] sent_to_accountant removed — sharing is GENERATED from status
        source: 'created',
        client_name: original.client_name,
        // Carry the robust invoice→klant link onto the creditnota too, so the
        // customer's history stays linked even if the name is later edited or
        // the client row is renamed. Falls back to null (name path) for legacy
        // originals that predate client_id.
        client_id: original.client_id ?? null,
        client_email: original.client_email,
        client_address: original.client_address,
        client_postal_code: original.client_postal_code,
        client_city: original.client_city,
        client_btw_number: original.client_btw_number,
        original_invoice_id,
        // [FACTUUR-A] Leverdatum of the corrected supply travels with the
        // creditnota (Art. 35a sub f). Falls back to the original invoice
        // date. NOTE: requires the FACTUUR-A delivery_date migration + type
        // regen (CMD) before deploy.
        delivery_date: original.delivery_date ?? original.invoice_date ?? null,
      })
      .select()
      .single(),
      { created_by: invoiceCreatedBy(acting) },
    )

    if (insertError || !creditnota) {
      // [IN1] / [DEEL-CREDIT] The database is the real guard against the SELECT-then-INSERT race
      // above. It used to be a unique index ("one creditnota per invoice", SQLSTATE 23505); it is
      // now a trigger that locks the original and refuses anything that would take the credits
      // past the invoice (creditnota_partial.sql, raised as check_violation / 23514). Both are
      // surfaced as the same clean 409 the pre-check returns, because both mean the same thing to
      // the owner: another credit got there first and this one no longer fits.
      const code = (insertError as { code?: string } | null)?.code
      const raceLost =
        code === '23505' ||
        code === '23514' ||
        (typeof insertError?.message === 'string' &&
          /duplicate key value|unique constraint|exceeds original invoice/i.test(insertError.message))
      if (raceLost) {
        // [TRUST-NUMBER] Het gemunte nummer is verbruikt en het document is er niet — een echt
        // gat in de doorlopende reeks (Art. 35). De send-route meldt precies dit al aan Sentry;
        // deze route deed het stil, en een gat waarvan niemand weet is een gat dat de
        // [DOORLOPEND]-controle later als raadsel aan de eigenaar voorlegt.
        console.warn('[TRUST-NUMBER] Creditnota race lost — minted number unused (gap)', { original_invoice_id })
        Sentry.captureMessage('creditnota race: minted number unused (sequence gap)', {
          level: 'warning',
          extra: { original_invoice_id },
        })
        return NextResponse.json(
          { error: 'Er is inmiddels een andere creditnota op deze factuur gemaakt — kijk even wat er nog openstaat en probeer het opnieuw.' },
          { status: 409 }
        )
      }
      console.error('[FACTUUR-A] Creditnota insert failed', { original_invoice_id, insertError })
      return NextResponse.json({ error: 'Creditnota aanmaken mislukt' }, { status: 500 })
    }

    // [KLANT-EXTRA] Dezelfde klantregels als op de factuur die deze creditnota corrigeert. Zonder
    // ze belandt de correctie op een ander bureau dan de factuur — bij precies de klant die de
    // factuur zonder die regels niet kon verwerken.
    await copyExtraLinesOnto(
      (fields) => db.from('invoices').update(fields as never).eq('id', creditnota.id),
      original,
      { original: original_invoice_id, creditnota: creditnota.id },
    )

    // [BOEK-031] Kopieer de gekozen regels negatief.
    // [DEEL-CREDIT] Uit `keuze`, niet uit een tweede lezing van de factuur: dat zijn de regels
    // waarmee het plafond hierboven is gecontroleerd én waarmee de totalen zijn uitgerekend. Ze
    // nog eens ophalen zou betekenen dat de bedragen op de kop uit de ene lezing komen en de
    // regels eronder uit de andere — en tussen die twee kan een bewerking hebben gezeten.
    if (keuze.lines.length > 0) {
      // [CREDIT-SIGN] The mirror lives in creditnota-lines.ts, with every rule it applies and the
      // reason for it: which fields flip (the quantity and the line total, never the price — that
      // is BR-27 and [MIN-REGEL]), which travel (the unit, so "-2 uur" does not become "-2 stuks",
      // and the exemption flag, whose absence puts the correction in a different rubriek than the
      // invoice it undoes), and which are hardened. It sat here as an object literal inside a
      // .map(), where none of it could be checked without a database.
      const { error: regelFout } = await db.from('invoice_lines').insert(
        creditLinesFor(keuze.lines, creditnota.id, reason) as never,
      )

      // [CREDIT-REGELS-OF-NIETS] Deze insert stond hier met een kale `await` en las zijn fout niet.
      //
      // Dat was tot vandaag bijna onschadelijk en is het nu niet meer:
      // creditnota_per_rate_ceiling.sql hangt assert_credit_within_rate_trg als BEFORE INSERT op
      // invoice_lines en RAISEt check_violation zodra een creditnota op één btw-tarief méér
      // terugneemt dan de oorspronkelijke factuur daarop draagt. De weigering slaagt, en de route
      // liep er straal langs:
      //
      //   · het nummer is al uit de doorlopende reeks gemunt;
      //   · renderInvoicePdf heeft een terugval voor facturen zonder regels (invoice-pdf.tsx:304)
      //     en tekent dan een KLOPPEND totaal boven een LEGE regeltabel;
      //   · de PDF wordt onvoorwaardelijk opgeslagen, dus hij belandt ook via invoices.pdf_url in
      //     het kwartaalpakket van de boekhouder;
      //   · en de mail gaat eruit.
      //
      // De klant houdt dan een correctiedocument in handen dat geen enkel goed of dienst noemt, en
      // zijn boekhouder kan het niet boeken. Een creditnota is geen concept: hij verlaat het pand.
      //
      // De regel staat al in dit huis, in invoice/draft/route.ts: "Een factuurkop zonder regels is
      // erger dan geen factuur: hij telt mee in overzichten en is leeg als je hem opent.
      // Terugdraaien, en eerlijk melden dat het niet lukte." Deze route was de uitzondering.
      if (regelFout) {
        await db.from('invoices').delete().eq('id', creditnota.id)

        // [TRUST-NUMBER] Zelfde boekhouding als de race hierboven: het gemunte nummer is verbruikt
        // en het document is er niet. Dat is een echt gat in de reeks (Art. 35), en een gat
        // waarvan niemand weet is het gat dat de [DOORLOPEND]-controle later als raadsel bij de
        // eigenaar neerlegt.
        const regelCode = (regelFout as { code?: string }).code
        const plafond =
          regelCode === '23514' ||
          /meer terug dan|check_violation|exceeds/i.test(regelFout.message ?? '')
        console.warn('[TRUST-NUMBER] Creditnota-regels geweigerd — rij teruggedraaid, nummer ongebruikt (gat)',
          { original_invoice_id, regelCode })
        Sentry.captureMessage('creditnota lines refused: row rolled back, minted number unused (sequence gap)', {
          level: 'warning',
          extra: { original_invoice_id, code: regelCode, message: regelFout.message },
        })
        return NextResponse.json(
          {
            error: plafond
              ? 'Deze creditnota neemt op één btw-tarief meer terug dan de oorspronkelijke factuur daarop draagt. Kijk na welke regels je hebt gekozen en probeer het opnieuw.'
              : 'De regels van de creditnota konden niet worden opgeslagen — er is niets verstuurd. Probeer het opnieuw.',
          },
          { status: plafond ? 409 : 500 },
        )
      }
    }

    // [BOEK-031] BOEK-SECURITY-2 — audit via helper, newValue is object — May 2026
    await logAuditAction({
      userId: user.id,
      action: 'creditnota.created',
      entityType: 'invoice',  // singular — matches historical 2 rows
      entityId: creditnota.id,
      newValue: {
        creditnota_number: creditnota.invoice_number,
        original_invoice_id,
        original_invoice_number: original.invoice_number,
        // [DEEL-CREDIT] Of dit de hele factuur was of een deel, en welk deel. Een deelcreditnota
        // is niet af te leiden uit het bedrag alleen — daarvoor moet je weten wat de factuur was
        // en wat er al eerder van is gecrediteerd. Dat hoort in het spoor te staan, niet in een
        // reconstructie achteraf.
        partial: !keuze.isFull,
        credited_inc_btw: keuze.totalIncBtw,
        already_credited_before: alGecrediteerd,
        credited_line_count: keuze.lines.length,
        // [CREDIT-NAMENS] Namens wie, en in welke rol. Zonder deze twee staat er in het spoor een
        // handeling van iemand die in de administratie waarin zij plaatsvond niet voorkomt.
        namens_klant_id: acting.ownerId,
        acting_role: acting.role,
      },
      ipAddress: getClientIP(request),
    })

    // ── [FACTUUR-A] Render + store the creditnota PDF, then deliver ──
    // A creditnota is a legal invoice (Art. 35). Render the PDF and store it
    // UNCONDITIONALLY — not only when the customer has an e-mail — so it reaches
    // the accountant's closing package via invoices.pdf_url. Previously the PDF
    // was rendered only inside the e-mail branch and never stored, so every
    // creditnota showed up in the package as "pdf_missing" (a correction with no
    // document). Storage + delivery are both best-effort; neither rolls back the
    // creditnota (number already consumed). [CREDITNOTA-PDF]
    let warning: string | undefined

    // [ACTING-FOR] Het profiel van de VERKOPER staat op de creditnota — dat is de eigenaar. Voor een
    // medewerker is die rij via RLS onleesbaar, dus dan langs service_role.
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', ownerId)
      .single()

    const { data: creditLines } = await db
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', creditnota.id)

    let pdfBuffer: Buffer | null = null
    try {
      // [CREDITNOTA-REF] The original's number and date travel INTO the render (not into the
      // row): art. 219 requires the document to name the invoice it corrects, and `original` is
      // already loaded above. Nothing is stored — the number of an issued invoice never changes,
      // so resolving it at render time is stable.
      pdfBuffer = await renderInvoicePdf(
        {
          ...creditnota,
          original_invoice_number: original.invoice_number,
          original_invoice_date: original.invoice_date,
        },
        creditLines ?? [],
        profile ?? {},
      )
    } catch (pdfErr) {
      console.error('[FACTUUR-A] Creditnota PDF render failed', {
        creditnota_id: creditnota.id,
        error: pdfErr,
      })
      Sentry.captureException(pdfErr, {
        tags: { feature: 'creditnota', severity: 'medium' },
        extra: { creditnota_id: creditnota.id, userId: user.id },
      })
    }

    // Store the PDF (raw path; signed on read) so it lands in the closing
    // package — mirrors the send route's storage step. Best-effort.
    if (pdfBuffer) {
      try {
        const pdfPath = `${ownerId}/facturen/${creditnotaNumber}.pdf`
        // [PDF-IMMUTABLE] Zie de toelichting in invoice/send: er is geen UPDATE-policy op
        // storage.objects, dus een overschrijving kan niet slagen. Hier is dat sowieso nooit aan
        // de orde — creditnotaNumber komt vers uit de reeks, dus het pad is per definitie nieuw —
        // maar `upsert: true` suggereerde een mogelijkheid die niet bestaat.
        const { error: uploadError } = await storeOriginal(boekhouder ? createPipelineClient() : supabase, pdfPath, pdfBuffer, { contentType: 'application/pdf' })
        if (!uploadError) {
          await db
            .from('invoices')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ pdf_url: pdfPath, updated_at: new Date().toISOString() } as any)
            .eq('id', creditnota.id)
        } else {
          console.error('[CREDITNOTA-PDF] storage upload failed', {
            creditnota_id: creditnota.id,
            uploadError,
          })
        }
      } catch (storageErr) {
        console.error('[CREDITNOTA-PDF] storage block error', {
          creditnota_id: creditnota.id,
          storageErr,
        })
      }
    }

    // Deliver by e-mail if the customer has one — reuse the same rendered PDF.
    if (original.client_email) {
      if (!pdfBuffer) {
        warning = 'delivery_failed'
      } else {
        try {
          await sendInvoiceToClient({
            toEmail: original.client_email,
            clientName: original.client_name ?? '',
            zzperName: profile?.company_name || profile?.full_name || 'Onbekend',
            // [ANTWOORD-ADRES] Een creditnota roept vaker een vraag op dan een factuur.
            senderEmail: profile?.email ?? null,
            // [FACTUUR-A] use the locally generated number (guaranteed non-null —
            // we returned 500 above if generation failed). creditnota.invoice_number
            // is typed string|null by the DB schema, which the e-mail signature rejects.
            invoiceNumber: creditnotaNumber,
            totalInc: creditnota.total_inc_btw ?? 0,
            dueDate: creditnota.due_date ?? '',
            invoiceDate: creditnota.invoice_date ?? undefined,
            pdfBuffer,
            // [E-FACTUUR-MEE] De creditnota als UBL 381 naast de PDF — zelfde generator als de
            // factuurmail, best-effort, nooit een blokkade voor de bezorging.
            // [ACTING-FOR] Acting-aware client: de sessie van een medewerker ziet de rijen van de
            // eigenaar niet, en de creditnota van een kantoor vertrok dan stil zonder XML.
            ublAttachment: await ublAttachmentForInvoice(db, creditnota.id),
            isCreditnota: true,
          })
        } catch (deliveryErr) {
          warning = 'delivery_failed'
          console.error('[FACTUUR-A] Creditnota delivery failed', {
            creditnota_id: creditnota.id,
            error: deliveryErr,
          })
          Sentry.captureException(deliveryErr, {
            tags: { feature: 'creditnota', severity: 'medium' },
            extra: { creditnota_id: creditnota.id, userId: user.id },
          })
        }
      }
    }

    // [BANK-CIRCLE-SEND] A creditnota is issued 'sent' and is immediately matchable to a refund line
    // that may already sit in the bank (the money moved before the credit document existed). Re-run
    // the same safe auto-confirm so that refund gets linked at issuance. Best-effort, idempotent,
    // one-tap reversible — never breaks the (already-committed) creditnota.
    try {
      // [ACTING-FOR] Op het bedrijf. Handelt er een medewerker, dan is de sessie-client waardeloos
      // voor de bankregels van de eigenaar (RLS) — dan langs service_role, de modus die
      // bank-auto-confirm zelf beschrijft voor cron en import.
      const pipelineForConfirm = createPipelineClient()
      await runBankAutoConfirm({
        payClient: isActingForOther(acting) ? pipelineForConfirm : supabase,
        pipeline: pipelineForConfirm,
        userId: ownerId,
      })
    } catch (autoErr) {
      console.error('[BANK-CIRCLE-SEND] post-creditnota auto-confirm failed (non-fatal)', { creditnota_id: creditnota.id, autoErr })
    }

    // ── [CREDIT-NAMENS] De klant hoort het te weten ──
    //
    // Het scherm waar de boekhouder factureert belooft het met zoveel woorden: de klant krijgt
    // bericht zodra er op zijn naam iets de deur uit gaat. Een creditnota is dat ook — sterker
    // nog, het is de enige van de twee die zijn omzet VERLAAGT en zijn btw terugvraagt. Stil
    // blijven zou betekenen dat de ondernemer zijn eigen kwartaal ziet veranderen zonder dat er
    // iemand iets heeft gezegd.
    //
    // Best-effort en met opzet ná de creditnota: het document bestaat, het nummer is verbruikt, en
    // een mislukte melding mag daar niets aan veranderen. Het spoor hierboven staat er sowieso.
    if (isActingForOther(acting)) {
      await createNotification({
        userId: ownerId,
        // [TAAL-DB] Staat op het scherm van de KLANT, in diens taal — niet in die van de boekhouder.
        title: 'Creditnota op jouw naam',
        body: `Je boekhouder heeft creditnota ${creditnotaNumber} gemaakt op factuur ${original.invoice_number ?? ''}.`.trim(),
        type: 'invoice',
        link: `/dashboard/invoice/${creditnota.id}`,
      })
    }

    return NextResponse.json({
      success: true,
      creditnota_id: creditnota.id,
      creditnota_number: creditnota.invoice_number,
      // [DEEL-CREDIT] Wat er is gecrediteerd en wat er van de factuur overblijft, zodat het scherm
      // het meteen kan tonen zonder de factuur opnieuw op te halen — en zodat een tweede
      // deelcreditnota begint met het juiste plafond in beeld.
      partial: !keuze.isFull,
      credited_inc_btw: keuze.totalIncBtw,
      remaining_creditable: creditableRemaining(original.total_inc_btw, alGecrediteerd + keuze.totalIncBtw),
      ...(warning ? { warning } : {}),
    })

  } catch (err) {
    console.error('[FACTUUR-A] /api/invoice/creditnota fatal error', err)
    Sentry.captureException(err, {
      tags: { feature: 'creditnota', severity: 'high' },
    })
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}