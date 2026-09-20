// src/app/dashboard/vragen/page.tsx
// [BRUG-RETOUR] "Je boekhouder heeft een vraag" — de terugweg van de brug.
//
// De brug liep één kant op. De boekhouder kon een document op status 'vraag' zetten
// (/api/accountant/subject-status), de klant kreeg één notificatie naar /dashboard/bestanden
// — een map met bestanden zonder vraag, zonder tekst, zonder antwoordknop — en het gesprek
// verhuisde naar WhatsApp. Dit scherm is de ontbrekende helft: de vraag, het document waar
// hij over gaat, en één veld om te antwoorden.
//
// GRENZEN DIE HIER GELDEN
//  · De statusrijen komen binnen via RLS-policy acc_status_client_read_document: alleen
//    subject_type='document' en alleen documenten van auth.uid(). Wij filteren dus niet op
//    eigenaarschap — de policy doet dat, en dat is de enige echte grens.
//  · Die policy is SELECT-only. De klant kan een vraag niet afvinken; dat blijft een
//    bewering van de boekhouder. Antwoorden loopt via /api/messages.
//  · De naam van de boekhouder is voor de klant NIET leesbaar (profiles heeft alleen
//    profiles_select_accountant_clients, één richting). Wij lezen die daarom met
//    service_role, en uitsluitend nádat accountant_clients de koppeling heeft bewezen —
//    net als de ondertekende bestands-URL's hieronder.
//
// [VRAAG-EIGENAAR] An owner may have more than one accountant, and every question knows who asked
// it. This page used to read "the" accountant with .maybeSingle(): with two offices linked that
// read fails (PGRST116), the failure was thrown away, and the owner saw "no accountant linked"
// under questions from both offices, with nowhere to answer them (audit VR-02). The links are now
// read as the collection they are (accountant-links.ts: failed / zero / one / many, never
// collapsed), each question carries its own accountant_id, and the answer goes to THAT accountant.
// Names are read with service_role for exactly the ids the owner's own rows and links prove.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [IN-CHUNK] Gechunkt en gepagineerd — zie supabase-paginate.ts.
import { fetchAllRowsForIds } from '@/lib/supabase-paginate'
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from '@/lib/storage-path'
import {
  buildOpenVragen, buildOpenInvoiceVragen, invoiceQuestionHref, VRAAG_STATUS,
  type VraagStatusRow, type VraagInvoiceRow,
} from '@/lib/vragen'
import { classifyAccountantLinks, provenAccountantIds } from '@/lib/accountant-links'
import VragenClient, { type VraagView, type VoorstelView } from './VragenClient'
import type { ProposedChange } from '@/lib/correction-proposal'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vragen van je boekhouder — BoekBrug' }

export default async function VragenPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] Vier lezingen die alleen user.id kennen ───────────────────────
  //
  // Ze stonden op een rij met een `await` ervoor, dus dit scherm ging vier keer heen en weer
  // voordat het iets kon tonen — terwijl geen van de vier op een ander wachtte. De lezingen die
  // wél ergens op wachten staan in de tweede golf hieronder, en dat is niet cosmetisch: die
  // vragen naar de id's die hier uit komen.
  //
  // De twee vraag-lezingen blijven APART, met opzet — zie de toelichting bij de factuurvragen:
  // ze komen langs verschillende RLS-policies binnen en één gecombineerde query zou allebei de
  // helften laten vallen zodra de tweede policy nog niet is uitgerold. Tegelijk uitvoeren
  // verandert daar niets aan; het is dezelfde twee query's, alleen niet meer na elkaar.
  const [
    { data: profile },
    { data: statusData, error: statusErr },
    { data: invStatusData, error: invStatusErr },
    linkRead,
  ] = await Promise.all([
    supabase.from('profiles').select('role, onboarding_done').eq('id', user.id).single(),

    // ── De openstaande vragen ──────────────────────────────────────────────────
    // Geen .eq('user_id', …) — die kolom bestaat hier niet; de policy koppelt de rij aan
    // het document en het document aan de eigenaar. Faalt de lezing, dan tonen wij géén
    // lege lijst maar een eerlijke foutmelding (zie loadFailed): "geen vragen" is een
    // bewering, en die mag nooit uit een mislukte query komen.
    // [VRAAG-EIGENAAR] accountant_id travels with every row: the answer goes to the asker.
    supabase
      .from('accountant_subject_status')
      .select('accountant_id, subject_id, status, vraag_text, updated_at')
      .eq('subject_type', 'document')
      .eq('status', VRAAG_STATUS),

    // [FACTUURVRAAG] De vragen over FACTUREN — zie de toelichting verderop, bij het blok dat ze
    // samenvoegt. Aparte lezing, geen OR op subject_type, en dat blijft zo.
    supabase
      .from('accountant_subject_status')
      .select('accountant_id, subject_id, status, vraag_text, updated_at')
      .eq('subject_type', 'invoice')
      .eq('status', VRAAG_STATUS),

    // ── De boekhouders ─────────────────────────────────────────────────────────
    // [VRAAG-EIGENAAR] The collection, never .maybeSingle() and never .limit(1): two linked
    // offices are two rows by design, and a read that failed is kept apart from zero rows.
    supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', user.id),
  ])

  if (!profile?.onboarding_done) redirect('/onboarding')
  // Dit is het scherm van de ondernemer. De boekhouder stelt zijn vragen op /dashboard/brug.
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  let loadFailed = Boolean(statusErr)
  const statusRows = (statusData ?? []) as VraagStatusRow[]

  // ── De documenten erbij ──────────────────────────────────────────────────────
  // Zonder trashed-filter: een vraag over een weggegooid bestand blijft een openstaande
  // vraag, en het scherm zegt dat het in de prullenbak ligt.
  const docIds = statusRows.map((r) => r.subject_id)

  const invStatusRows = (invStatusData ?? []) as VraagStatusRow[]
  const invIds = invStatusRows.map((r) => r.subject_id)

  // ── [WATERVAL] Tweede golf: de drie lezingen die de id's van hierboven nodig hadden ──
  //
  // Ze hangen elk van iets uit de eerste golf af — de documenten van de documentvragen, de
  // facturen van de factuurvragen, de naam van de boekhouder van de koppeling — maar NIET van
  // elkaar. Dus opnieuw: één rit voor alle drie in plaats van drie ritten.
  //
  // [VRAAG-EIGENAAR] Which accountants are linked right now — failed / zero / one / many.
  const links = classifyAccountantLinks({ data: linkRead.data, error: linkRead.error })
  if (linkRead.error) {
    console.error('[VRAGEN] koppelingslezing mislukt', { userId: user.id, error: linkRead.error.message })
  }
  const pipeline = createPipelineClient()

  // [NO-SILENT-EMPTY] Deze twee lezingen pakten alleen `data` uit, en het gevolg stond niet in de
  // lijst maar IN elke regel ervan: buildOpenVragen zet `documentMissing: true` zodra een id niet
  // in de lezing zit. Mislukte de lezing, dan kreeg de ondernemer dus zijn vragen te zien met bij
  // stuk voor stuk "dit bestand is er niet" — over bestanden die er gewoon zijn. Hij gaat ze dan
  // opnieuw uploaden, en de boekhouder krijgt alles dubbel.
  //
  // [IN-CHUNK] En gechunkt: docIds/invIds groeien met het aantal openstaande vragen, en een kale
  // `.in()` is voorbij een paar honderd id's precies de manier waarop deze lezing mislukt.
  // [VRAAG-EIGENAAR] The names, for exactly the ids the owner's OWN rows and links prove: the
  // askers of the questions the owner can see (those rows came through the owner's RLS) and the
  // owner's current links. service_role reads the name; it never decides who may be named.
  const provenIds = provenAccountantIds(
    [...statusRows, ...invStatusRows].map((r) => ({ accountantId: r.accountant_id ?? null })),
    links,
  )
  const [docs, invRows, accProfiles] = await Promise.all([
    fetchAllRowsForIds<{ id: string; file_name: string | null; file_url: string | null; trashed: boolean | null }, string>(
      docIds,
      (chunk, from, to) =>
        supabase.from('documents').select('id, file_name, file_url, trashed')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
    ).catch((e: unknown) => {
      console.error('[VRAGEN] documenten bij de vragen lezen mislukt', { userId: user.id, e })
      return null
    }),
    // [VRAAG-DEUR] direction, sender and receiver travel along: they decide which screen "Bekijk"
    // opens (a purchase invoice lives on Inkomend, a sales invoice on its own page).
    fetchAllRowsForIds<VraagInvoiceRow, string>(
      invIds,
      (chunk, from, to) =>
        supabase.from('invoices').select('id, invoice_number, client_name, total_inc_btw, invoice_date, direction, sender_id, receiver_id')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
    ).catch((e: unknown) => {
      console.error('[VRAGEN] facturen bij de vragen lezen mislukt', { userId: user.id, e })
      return null
    }),
    fetchAllRowsForIds<{ id: string; full_name: string | null; company_name: string | null }, string>(
      provenIds,
      (chunk, from, to) =>
        pipeline.from('profiles').select('id, full_name, company_name')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
    ).catch((e: unknown) => {
      // A name is display only; without it the card still says everything it knows.
      console.error('[VRAGEN] namen van boekhouders lezen mislukt', { userId: user.id, e })
      return [] as { id: string; full_name: string | null; company_name: string | null }[]
    }),
  ])

  // null = de lezing mislukte. Dat telt mee in loadFailed, want een scherm dat elk bestand als
  // verdwenen aanwijst is erger dan een scherm dat zegt dat het even niet kon lezen.
  if (docs === null || invRows === null) loadFailed = true
  const docRows = docs ?? []

  const documentVragen = buildOpenVragen(statusRows, docRows)

  // ── [FACTUURVRAAG] En de vragen over FACTUREN ────────────────────────────────
  // De boekhouder kon een factuur al op 'vraag' zetten in de zin dat drie van zijn schermen die
  // status TELDEN — hij had alleen geen route om hem te schrijven, en dit scherm filterde op
  // subject_type='document', dus zo'n vraag kon hier nooit verschijnen.
  //
  // Aparte lezing, geen OR op subject_type: de twee rijen komen langs verschillende RLS-policies
  // binnen (acc_status_client_read_document en acc_status_client_read_invoice), en één query die
  // beide moet halen faalt geheel zodra de tweede policy nog niet is uitgerold. Zo blijven de
  // documentvragen staan en komen de factuurvragen erbij zodra de migratie draait.
  //
  // [NO-SILENT-EMPTY] invoiceLoadFailed telt apart mee in loadFailed: "geen vragen" mag nooit uit
  // een mislukte lezing komen, en dat geldt voor deze helft net zo goed als voor de andere.
  // Een mislukte lezing van deze helft is óók een reden om niet 'geen vragen' te zeggen.
  if (invStatusErr) loadFailed = true

  const invoiceVragen = buildOpenInvoiceVragen(invStatusRows, invRows ?? [])

  // Samengevoegd en opnieuw op ouderdom gesorteerd: voor de klant is dit één lijst "wat wil mijn
  // boekhouder van mij", niet twee lijstjes per tabel waar de vraag toevallig in staat.
  const vragen = [...documentVragen, ...invoiceVragen].sort((a, b) => {
    if (a.askedAt && b.askedAt) return a.askedAt.localeCompare(b.askedAt)
    if (a.askedAt) return -1
    if (b.askedAt) return 1
    return 0
  })

  // ── De namen van de boekhouders ──────────────────────────────────────────────
  // Per id, so a card can say who asked. The sentence at the top names an accountant only when
  // there is exactly ONE linked — with two offices, "your accountant" is the honest word.
  const accountantNames: Record<string, string> = {}
  for (const row of accProfiles) {
    const naam = (row.full_name ?? '').trim()
    const bedrijf = (row.company_name ?? '').trim()
    const name = naam || bedrijf
    if (name) accountantNames[row.id] = name
  }
  const accountantNaam: string | null =
    links.state === 'known' && links.ids.length === 1 ? (accountantNames[links.ids[0]] ?? null) : null

  // ── Ondertekende bestands-URL's ──────────────────────────────────────────────
  // Zelfde reden als op /dashboard/brug: de bucket-policy staat los van de tabel-RLS.
  // De rijen zijn hierboven via de gebruikerssessie gelezen, dus er wordt nooit een pad
  // ondertekend dat deze gebruiker niet mocht zien.
  const urlByDoc = new Map<string, string>()
  await Promise.all(
    docRows.map(async (d) => {
      if (!d.file_url) return
      if (/^https?:\/\//i.test(d.file_url)) { urlByDoc.set(d.id, d.file_url); return }
      // [SEC-STORAGE-PATH] The document rows are this owner's; that says nothing about where their
      // file_url POINTS. `pipeline` is service_role and bypasses the bucket policy, so an
      // unattributable key would be signed into a working one-hour URL. A path we cannot prove
      // belongs to this owner simply gets no link — the question still renders without one.
      const pad = toStoragePath(d.file_url)
      if (!pathBelongsToOwner(pad, user.id)) return
      const { data } = await pipeline.storage.from('documents').createSignedUrl(pad, 3600)
      if (data?.signedUrl) urlByDoc.set(d.id, data.signedUrl)
    }),
  )

  const views: VraagView[] = vragen.map((v) => ({
    ...v,
    fileUrl: urlByDoc.get(v.documentId) ?? null,
    // [VRAAG-DEUR] Decided here, where the owner's id is known: which screen shows this invoice.
    invoiceHref: v.subjectType === 'invoice' && !v.documentMissing ? invoiceQuestionHref(v.invoice, user.id) : null,
  }))

  // ── [VOORSTEL] The accountant's correction proposals, open, with their invoice ───────────
  // Read through the client's own RLS (invoice_corrections_client_read). A failed read counts
  // as loadFailed for the same reason the questions do: "geen vragen" may never come from a read
  // that did not happen.
  let voorstellen: VoorstelView[] = []
  {
    // invoice_corrections is not in the generated types (hand-applied migration).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: propRows, error: propErr } = await (supabase as any)
      .from('invoice_corrections')
      .select('id, invoice_id, changes, reason, created_at')
      .eq('client_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
    if (propErr) {
      // A database where the migration is not applied yet has no proposals — not a failure.
      if (!/42P01|relation .* does not exist/i.test(propErr.message ?? '')) loadFailed = true
    } else {
      const rows = (propRows ?? []) as { id: string; invoice_id: string; changes: ProposedChange[]; reason: string | null; created_at: string | null }[]
      const propInvIds = rows.map((r) => r.invoice_id)
      const propInvoices = propInvIds.length
        ? await fetchAllRowsForIds<VraagInvoiceRow, string>(
            propInvIds,
            (chunk, from, to) =>
              supabase.from('invoices').select('id, invoice_number, client_name, total_inc_btw, invoice_date')
                .in('id', chunk).order('id', { ascending: true }).range(from, to),
          ).catch(() => null)
        : []
      if (propInvoices === null) loadFailed = true
      const byId = new Map((propInvoices ?? []).map((i) => [i.id, i]))
      voorstellen = rows.map((r) => ({
        id: r.id,
        invoice: byId.get(r.invoice_id) ?? null,
        changes: Array.isArray(r.changes) ? r.changes : [],
        reason: r.reason,
        askedAt: r.created_at,
      }))
    }
  }

  return (
    <VragenClient
      vragen={views}
      voorstellen={voorstellen}
      links={links}
      accountantNames={accountantNames}
      accountantNaam={accountantNaam}
      loadFailed={loadFailed}
    />
  )
}
