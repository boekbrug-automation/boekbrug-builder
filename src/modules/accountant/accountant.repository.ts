// src/modules/accountant/accountant.repository.ts
// [BOEK-028] Accountant Portal — repository layer — May 2026
//
// RULE: This is the ONLY file that calls supabase.from() for accountant data.
//       No page, component, or hook may bypass this file.
//
// Access control: every function verifies accountant ↔ client linkage
// via accountant_clients before returning any data.
//
// Visibility rule [BRIDGE-A]: accountant sees ONLY invoices where
//   shared = true  (GENERATED ALWAYS AS status IN ('sent','received','paid'))
//   Draft is the only non-shared active status. RLS enforces linkage +
//   shared=true at the DB level; the explicit .eq('shared', true) filters in
//   this file are defense-in-depth, not the security boundary.
//   [BOEK-FOUNDATION-TYPES] 'voldaan' removed — not in DB CHECK constraint

import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  // [KWARTAAL] getActiveAangifte, NIET getCurrentQuarter. Zie de toelichting bij de drie
  // aanroepen hieronder: dit oppervlak gaat over het kwartaal dat AANGEGEVEN moet worden,
  // niet over het kwartaal waar we vandaag in leven.
  getActiveAangifte,
  getQuarterRange,
} from './accountant.service'
import type {
  AccountantOverview,
  ClientDetail,
  ClientReadiness,
  ClientSummary,
  InvoiceRow,
  TodoItem,
} from './accountant.types'
import { shouldBlockReinvite } from '@/lib/invite-guard'
// [BANK-TELLING] Uitsluitend voor de bankTELLING in computeClientReadiness — zie daar waarom.
import { createPipelineClient } from '@/lib/supabase-pipeline'

// ─────────────────────────────────────────────────────────
// [READINESS] Honest per-client facts for a quarter.
// ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/**
 * Computes the honest ClientReadiness for one client + quarter. Every number is a
 * COUNT of real rows; nothing is a verdict. Counts BOTH invoice directions (the
 * accountant processes what the client sends AND receives), not paid-only. The
 * bank signal is `bank_transactions` dated in the quarter — the honest signal the
 * closing package already uses — NOT documents.doc_type (the old check used
 * 'bank', a value no write path ever stores, so it was always false).
 */
async function computeClientReadiness(
  supabase: Sb,
  clientId: string,
  year: number,
  quarter: number,
): Promise<ClientReadiness> {
  const { start, end } = getQuarterRange(year, quarter)
  // clientId is a verified-linkage UUID from our own DB — safe to embed in .or().
  const bothDirections = `sender_id.eq.${clientId},receiver_id.eq.${clientId}`
  // [BANK-TELLING] Zie de toelichting bij de query zelf: alleen de bankTELLING gaat hierlangs.
  const bankCounter = createPipelineClient()

  // [NO-SILENT-EMPTY] Every error bound, not one of them dropped. See ClientReadiness.readFailed
  // for what the silence produced on the board.
  const [
    { count: sharedInvoices, error: sharedErr },
    { count: processedInvoices, error: processedErr },
    { count: openQuestions, error: questionsErr },
    { count: bankCount, error: bankErr },
    { data: lastDoc, error: lastDocErr },
  ] = await Promise.all([
    supabase.from('invoices').select('id', { count: 'exact', head: true })
      .or(bothDirections).eq('shared', true)
      .gte('invoice_date', start).lte('invoice_date', end),
    supabase.from('invoices').select('id', { count: 'exact', head: true })
      .or(bothDirections).eq('shared', true).eq('accountant_status', 'verwerkt')
      .gte('invoice_date', start).lte('invoice_date', end),
    supabase.from('invoices').select('id', { count: 'exact', head: true })
      .or(bothDirections).eq('shared', true).eq('accountant_status', 'vraag')
      .gte('invoice_date', start).lte('invoice_date', end),
    // [BANK-TELLING] Deze ENE telling loopt via de pipeline-client (service_role), en dat is geen
    // gemak maar een noodzaak: bank_transactions heeft uitsluitend eigenaar-policies
    // (`user_id = auth.uid()`, database.sql:620-631). Onder de sessie van de boekhouder gaf deze
    // query dus ALTIJD nul — niet omdat er geen bankgegevens waren, maar omdat hij ze niet mag
    // zien. Gevolg: `hasBankData` was structureel false en élke klant op het werkbord droeg het
    // label "zonder bank", ook een klant die zijn afschriften keurig elk kwartaal aanlevert. Een
    // vaste onwaarheid op het commandocentrum van de boekhouder, zonder één signaal.
    //
    // Veilig omdat de koppeling al bewezen is voordat deze functie draait: aanroep 1 leest de
    // rijen uit accountant_clients voor deze boekhouder, aanroep 2 doet een expliciete
    // .eq('zzper_id', clientId) met `if (!link) return null`. En er komt niets méér mee dan een
    // GETAL — geen tegenrekening, geen omschrijving, geen bedrag.
    //
    // Alleen deze telling. De documents-query hieronder MOET op de sessie blijven: die leunt op
    // documents_accountant_read (shared = true AND trashed IS NOT TRUE), en met service_role zou
    // "laatste upload" ineens privé en weggegooide bestanden gaan melden — een privacylek in ruil
    // voor een bugfix.
    bankCounter.from('bank_transactions').select('id', { count: 'exact', head: true })
      .eq('user_id', clientId).gte('date', start).lte('date', end),
    supabase.from('documents').select('created_at')
      .eq('user_id', clientId).order('created_at', { ascending: false }).limit(1),
  ])

  let lastUploadDaysAgo: number | null = null
  if (lastDoc && lastDoc.length > 0) {
    const diffMs = Date.now() - new Date(lastDoc[0].created_at).getTime()
    lastUploadDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }

  const readFailed = !!(sharedErr || processedErr || questionsErr || bankErr || lastDocErr)
  if (readFailed) {
    console.error('[NO-SILENT-EMPTY] client readiness partly unreadable', {
      clientId,
      shared: sharedErr?.message, processed: processedErr?.message,
      questions: questionsErr?.message, bank: bankErr?.message, lastDoc: lastDocErr?.message,
    })
  }

  return {
    year,
    quarter,
    // The numbers stay, so nothing downstream has to handle undefined — but they are FLOORS when
    // readFailed is true, and the screen says so instead of printing them as facts.
    sharedInvoices: sharedInvoices ?? 0,
    processedInvoices: processedInvoices ?? 0,
    openQuestions: openQuestions ?? 0,
    // Not `(bankCount ?? 0) > 0` on a failed read: that spells "zonder bank", which is a claim.
    hasBankData: !bankErr && (bankCount ?? 0) > 0,
    lastUploadDaysAgo,
    readFailed,
  }
}

// ─────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────

/**
 * Returns all clients linked to this accountant, each with honest readiness facts.
 * Sorted "needs attention first": open questions, then unprocessed items.
 */
/**
 * [BOEKHOUDER-LEEG] An empty list, and whether it means anything.
 *
 * `clients: []` with `readFailed: true` is not "no clients" — it is "we could not read your
 * clients", and on this portal those two are not close. An owner who sees an empty screen knows
 * their own books and doubts the screen. An accountant does not: they see what we hand them and
 * form a professional judgement their client is paying for.
 *
 * Measured on the landing page: when this read failed the accountant was shown the FIRST-RUN
 * onboarding state — "Voeg je eerste klant toe · Nodig een klant uit of koppel een bestaande" — to
 * someone who may have forty. The app told a working practice it had no practice.
 *
 * The bell on that same page already got this right (`notifErr`, [NO-SILENT-EMPTY]); the client
 * list and the to-do feed were simply missed, and they are the two the whole portal rests on.
 */
export interface ClientListResult {
  clients: ClientSummary[]
  /** true = the read failed. The screen must say so instead of rendering an empty practice. */
  readFailed: boolean
}

export async function getAccountantClients(
  accountantId: string
): Promise<ClientListResult> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('accountant_clients')
    .select(`
      created_at,
      profiles!zzper_id (
        id,
        full_name,
        company_name,
        email
      )
    `)
    .eq('accountant_id', accountantId)

  if (error) {
    // [BOEKHOUDER-LEEG] Read, reported, and NOT collapsed into "no clients". The error was already
    // being captured here and then thrown away with the same `return []` a genuinely empty book
    // produces — which is worse than never reading it, because somebody looked and discarded it.
    console.error('[BOEKHOUDER-LEEG] client list unreadable', {
      accountantId, error: error.message,
    })
    return { clients: [], readFailed: true }
  }
  if (!data) return { clients: [], readFailed: true }

  // [KWARTAAL] Het AANGIFTE-kwartaal, niet het lopende.
  //
  // Hier stond getCurrentQuarter(): het kwartaal waar vandaag in valt. Op 26 juli is dat
  // Q3 — 26 dagen oud en per definitie zo goed als leeg — terwijl de deadline-hero op de
  // agenda correct aftelt naar de Q2-aangifte van 31 juli. De landingspagina van de
  // boekhouder beschreef dus een ander kwartaal dan zijn eigen deadline, in precies de
  // week dat het ertoe doet.
  //
  // getActiveAangifte() geeft het vorige (afgesloten) kwartaal plus zijn deadline, en is
  // wat de agenda al gebruikt. Eén kwartaal over het hele oppervlak.
  const { year, quarter } = getActiveAangifte()

  // The joined `profiles` relation post-dates the generated types → shape cast.
  type LinkedProfileRow = {
    created_at: string | null
    profiles: { id: string; full_name: string | null; company_name: string | null; email: string | null } | null
  }

  const summaries = await Promise.all(
    (data as unknown as LinkedProfileRow[]).map(async (row) => {
      const profile = row.profiles
      if (!profile) return null

      const readiness = await computeClientReadiness(supabase, profile.id, year, quarter)

      return {
        id: profile.id,
        full_name: profile.full_name,
        company_name: profile.company_name,
        email: profile.email,
        readiness,
        linked_at: row.created_at ?? "",
      } satisfies ClientSummary
    })
  )

  const valid = summaries.filter((s): s is ClientSummary => s !== null)

  // Sort "needs attention first": open questions, then most unprocessed items.
  // readFailed:false — this path only runs when the read succeeded; the failures returned above.
  return { readFailed: false, clients: valid.sort((a, b) => {
    const q = b.readiness.openQuestions - a.readiness.openQuestions
    if (q !== 0) return q
    const aOpen = a.readiness.sharedInvoices - a.readiness.processedInvoices
    const bOpen = b.readiness.sharedInvoices - b.readiness.processedInvoices
    return bOpen - aOpen
  }) }
}

// ─────────────────────────────────────────────────────────
// Linked client list (lightweight — id + name only)
// ─────────────────────────────────────────────────────────

/**
 * All clients linked to this accountant as {id, name} only — no per-client
 * readiness queries. Used by surfaces that fetch their own detail client-side
 * (e.g. the Klaar-overzicht, which pulls each client's rich readiness from
 * /api/readiness?clientId=…). Sorted alphabetically for a stable board.
 */
export async function getLinkedClientList(
  accountantId: string,
): Promise<{ clients: Array<{ id: string; name: string }>; readFailed: boolean }> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('accountant_clients')
    .select(`
      profiles!zzper_id (
        id,
        full_name,
        company_name
      )
    `)
    .eq('accountant_id', accountantId)

  // [BOEKHOUDER-LEEG] The argument for this is written out in full forty lines above, on
  // getLinkedClientsWithReadiness — and this function, in the same file, did the thing that note
  // exists to forbid: `const { data }` with no error binding, then `if (!data) return []`. Its one
  // caller is the Werkboard, which renders an empty list as "Nog geen klanten gekoppeld". So a
  // failed read told a working practice it had no practice, on the board they open to see which
  // client's aangifte is due.
  if (error) {
    console.error('[BOEKHOUDER-LEEG] linked client list unreadable', {
      accountantId, error: error.message,
    })
    return { clients: [], readFailed: true }
  }
  if (!data) return { clients: [], readFailed: true }

  type LinkedProfile = { id: string; full_name: string | null; company_name: string | null }
  const rows = data as unknown as Array<{ profiles: LinkedProfile | null }>

  return {
    readFailed: false,
    clients: rows
      .map(row => row.profiles)
      .filter((p): p is LinkedProfile => p !== null)
      .map(p => ({ id: p.id, name: p.company_name || p.full_name || 'Onbekend' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  }
}

// ─────────────────────────────────────────────────────────
// Client detail
// ─────────────────────────────────────────────────────────

/**
 * Returns full profile of a single client.
 * Returns null if the client is not linked to this accountant — never throws.
 */
export async function getClientDetail(
  accountantId: string,
  clientId: string
): Promise<ClientDetail | null> {
  const supabase = await createServerSupabaseClient()

  // Verify linkage first
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('created_at')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select(`
      id, full_name, company_name, email,
      kvk_number, btw_number, iban,
      address, postal_code, city
    `)
    .eq('id', clientId)
    .maybeSingle()

  if (!profile) return null

  // [KWARTAAL] Het aangifte-kwartaal — zie de toelichting bij de eerste aanroep hierboven.
  const { year, quarter } = getActiveAangifte()
  const readiness = await computeClientReadiness(supabase, clientId, year, quarter)

  return {
    id: profile.id,
    full_name: profile.full_name,
    company_name: profile.company_name,
    email: profile.email,
    kvk_number: profile.kvk_number,
    btw_number: profile.btw_number,
    iban: profile.iban,
    address: profile.address,
    postal_code: profile.postal_code,
    city: profile.city,
    readiness,
    linked_at: link.created_at ?? "",
  } satisfies ClientDetail
}

// ─────────────────────────────────────────────────────────
// Overview (honest headline counts)
// ─────────────────────────────────────────────────────────

/**
 * Honest headline counts for the accountant home. No "ready" verdict — just
 * provable facts across the linked clients.
 */
export async function getAccountantOverview(
  accountantId: string,
  // [FAN-OUT] De lijst mag worden meegegeven. De landingspagina haalde hem toch al op in
  // dezelfde Promise.all, en deze functie haalde hem daarna nóg een keer op — inclusief de
  // vijf queries per klant die eraan hangen. Bij 30 klanten: 300 queries in plaats van 150,
  // op het traagste scherm van de sessie.
  clients?: ClientSummary[]
): Promise<AccountantOverview> {
  // [BOEKHOUDER-LEEG] When this fetches its own list, a failed read yields an empty one and these
  // counts would read as a real "0 clients, 0 questions". The landing page always passes the list
  // it already has (see [FAN-OUT]), and it is the page that renders the failure — so the honest
  // thing here is to count what was actually read, and never to invent a zero of its own.
  const clientList = clients ?? (await getAccountantClients(accountantId)).clients

  return {
    total_clients: clientList.length,
    clients_with_open_questions: clientList.filter(c => c.readiness.openQuestions > 0).length,
    clients_missing_bank: clientList.filter(c => !c.readiness.hasBankData).length,
  }
}

// ─────────────────────────────────────────────────────────
// Todo feed
// ─────────────────────────────────────────────────────────

/**
 * Returns action items the accountant needs to handle today.
 * One TodoItem per client per issue type.
 * Sorted by urgency: client_question first, then invoices_to_process, then missing_file.
 */
/**
 * [BOEKHOUDER-LEEG] The to-do feed, and whether an empty one means anything.
 *
 * The worst of the three collapses, because of WHEN it is read. An accountant told "nothing to do"
 * in aangifte week closes the app, and the work does not get done — there is no second signal to
 * catch it, and the deadline is statutory. This read did not even capture its error: a bare
 * `const { data: links }` followed by `if (!links) return []`.
 */
export interface TodoFeedResult {
  todos: TodoItem[]
  /** true = the read failed. "Nothing to do" and "we could not look" are not the same answer. */
  readFailed: boolean
}

export async function getTodoFeed(accountantId: string): Promise<TodoFeedResult> {
  const supabase = await createServerSupabaseClient()

  // Get all linked clients (id + name only — lightweight)
  const { data: links, error: linksError } = await supabase
    .from('accountant_clients')
    .select(`
      profiles!zzper_id (
        id,
        full_name,
        company_name
      )
    `)
    .eq('accountant_id', accountantId)

  if (linksError || !links) {
    console.error('[BOEKHOUDER-LEEG] to-do feed unreadable', {
      accountantId, error: linksError?.message ?? 'no rows and no error',
    })
    return { todos: [], readFailed: true }
  }

  // [KWARTAAL] Het aangifte-kwartaal — zie de toelichting bij de eerste aanroep hierboven.
  const { year, quarter } = getActiveAangifte()
  const { start, end } = getQuarterRange(year, quarter)

  // [BRIDGE-A] intentionally paid-only until ج-1 — shared now includes sent/received
  const todos: TodoItem[] = []
  // [NO-SILENT-EMPTY] The three counts below were read as bare `{ count }`, and this function
  // returned readFailed:false regardless — so a partly unreadable feed reached the screen as a
  // COMPLETE one. Two different lies came out of that: a client's open question was omitted (the
  // banner above the list exists precisely because an accountant told "nothing to do" in aangifte
  // week closes the app, and the deadline is statutory), and — worse — the bank check pushes its
  // todo when the count is zero, so a FAILED read invented "geen bankgegevens dit kwartaal" about
  // a client who delivers every quarter. One flag, set by any of them, and the existing banner
  // says so ABOVE the list rather than instead of it.
  let telFout = false

  // The joined `profiles` relation post-dates the generated types → shape cast.
  type TodoLinkRow = {
    profiles: { id: string; full_name: string | null; company_name: string | null } | null
  }

  await Promise.all(
    (links as unknown as TodoLinkRow[]).map(async (row) => {
      const profile = row.profiles
      if (!profile) return

      const clientName: string = profile.company_name || profile.full_name || 'Onbekend'
      const clientId: string = profile.id
      // clientId is a verified-linkage UUID from our own DB — safe to embed.
      const bothDirections = `sender_id.eq.${clientId},receiver_id.eq.${clientId}`

      // 1. Invoices with 'vraag' status (client needs to answer) — this quarter,
      //    both directions (was sender-only + paid-only).
      const { count: vraagCount, error: vraagErr } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .or(bothDirections)
        .eq('shared', true)
        .eq('accountant_status', 'vraag')
        .gte('invoice_date', start)
        .lte('invoice_date', end)

      if ((vraagCount ?? 0) > 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'client_question',
          year, quarter,
          description: `${clientName} — vraag open`,
          count: vraagCount ?? 0,
        })
      }

      // 2. Shared invoices not yet 'verwerkt' (this quarter, both directions).
      // [NULL-SEMANTICS] NOT (col = 'verwerkt') is NULL — row EXCLUDED — for a
      // NULL accountant_status, and a freshly shared invoice is exactly that
      // (no DB default; only accountant actions ever set it). The old filter
      // therefore hid every untouched invoice from this todo count while the
      // readiness score counted them — adjacent surfaces disagreed. IS NULL
      // must be matched explicitly.
      const { count: unprocessedCount, error: unprocessedErr } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .or(bothDirections)
        .eq('shared', true)
        .or('accountant_status.is.null,accountant_status.neq.verwerkt')
        .gte('invoice_date', start)
        .lte('invoice_date', end)

      if ((unprocessedCount ?? 0) > 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'invoices_to_process',
          year, quarter,
          description: `${clientName} — ${unprocessedCount} factuur${(unprocessedCount ?? 0) > 1 ? 'en' : ''} te verwerken`,
          count: unprocessedCount ?? 0,
        })
      }

      // 3. No bank data for the quarter. [READINESS] honest signal = bank_transactions
      //    dated in the quarter (the old doc_type='bank' check was always true here:
      //    no write path stores 'bank' — statements are stored as 'bankafschrift').
      const { count: bankCount, error: bankErr } = await supabase
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', clientId)
        .gte('date', start)
        .lte('date', end)

      if (vraagErr || unprocessedErr || bankErr) {
        telFout = true
        console.error('[BOEKHOUDER-LEEG] todo counts partly unreadable', {
          clientId, vraag: vraagErr?.message, onverwerkt: unprocessedErr?.message, bank: bankErr?.message,
        })
      }

      // Alleen wanneer de telling ook echt gelukt is. Een mislukte lezing is geen nul, en dit is
      // de enige tak hier die een taak MAAKT uit een afwezigheid.
      if (!bankErr && (bankCount ?? 0) === 0) {
        todos.push({
          client_id: clientId,
          client_name: clientName,
          type: 'missing_file',
          year, quarter,
          description: `${clientName} — geen bankgegevens dit kwartaal`,
        })
      }
    })
  )

  // Sort: client_question → invoices_to_process → missing_file
  const URGENCY: Record<string, number> = {
    client_question: 0,
    invoices_to_process: 1,
    missing_file: 2,
  }
  return { readFailed: telFout, todos: todos.sort((a, b) => URGENCY[a.type] - URGENCY[b.type]) }
}

// ─────────────────────────────────────────────────────────
// Client invoices (accountant view)
// ─────────────────────────────────────────────────────────

/**
 * [BRIDGE-A] Returns ALL shared invoices (sent/received/paid) for a client in
 * a given quarter — no longer paid-only. This feeds the accountant's
 * accounting split (Debiteuren / Crediteuren / Voldaan / Overdue), computed
 * in the UI from direction + status + due_date:
 *   Debiteuren  = direction='outgoing' AND status='sent'
 *   Crediteuren = direction='incoming' AND status='received'
 *   Voldaan     = status='paid'
 *   Overdue     = status='sent' AND due_date < today  (computed, never stored)
 * Function name kept to avoid breaking existing imports (rename is a separate
 * cosmetic ticket).
 *
 * Verifies linkage before querying — returns [] if not linked.
 *
 * btw_rate is NOT selected (not in DB).
 * Compute in UI: Math.round((btw_amount / total_ex_btw) * 100)
 */
export async function getClientPaidInvoices(
  accountantId: string,
  clientId: string,
  year: number,
  quarter: number
): Promise<InvoiceRow[]> {
  const supabase = await createServerSupabaseClient()

  // Verify linkage
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return []

  const { start, end } = getQuarterRange(year, quarter)

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      client_name,
      status,
      direction,
      invoice_type,
      total_ex_btw,
      btw_amount,
      total_inc_btw,
      amount_paid,
      invoice_date,
      due_date,
      marked_paid_at,
      accountant_status,
      accountant_note,
      replaced_by_number
    `)
    // [BRIDGE-A] both directions: outgoing (client = sender) feeds
    // Debiteuren/Voldaan; incoming (client = receiver) feeds Crediteuren.
    // The old sender-only filter silently dropped every incoming invoice.
    // clientId is a verified-linkage UUID from our own DB — safe to embed.
    .or(`sender_id.eq.${clientId},receiver_id.eq.${clientId}`)
    .eq('shared', true)
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .order('invoice_date', { ascending: true })

  if (error || !data) return []

  return data as InvoiceRow[]
}

// ─────────────────────────────────────────────────────────
// Client management (write operations)
// ─────────────────────────────────────────────────────────

/**
 * Unlinks a client from this accountant.
 * Verifies ownership before deleting — returns error string if not allowed.
 * Note: data archival (BOEK-032) is deferred — only the link row is removed.
 */
export async function unlinkClient(
  accountantId: string,
  clientId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Verify this link belongs to this accountant
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  if (!link) return { error: 'Klant niet gevonden of geen toegang.' }

  const { error } = await supabase
    .from('accountant_clients')
    .delete()
    .eq('id', link.id)

  if (error) return { error: 'Verwijderen mislukt. Probeer het opnieuw.' }
  return {}
}

/**
 * Creates an invitation for a client email.
 * Uses the invitations table with invited_by = 'accountant'.
 * zzper_id is null because the client may not have an account yet.
 * The client's email is stored in accountant_email (field repurposed for this direction).
 * Full invite flow (email sending) is handled by BOEK-011/015 endpoints once live.
 */
export async function inviteClient(
  accountantId: string,
  clientEmail: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(clientEmail)) return { error: 'Ongeldig e-mailadres.' }

  // Check for duplicate pending invite from this accountant.
  //
  // [SEC-INVITE] `.maybeSingle()` op een query die legitiem méér dan één rij kan matchen
  // is een harde fout, geen null. Zolang de accept-status nooit werd weggeschreven kon er
  // per adres maar één rij bestaan en was dat onbereikbaar; nu die write is gerepareerd
  // wordt het de derde uitnodiging aan hetzelfde adres. Neem de NIEUWSTE rij.
  const { data: existing } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('accountant_email', clientEmail)
    .eq('invited_by', 'accountant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (shouldBlockReinvite(existing?.status ?? null)) {
    return { error: 'Er is al een uitnodiging verstuurd naar dit adres.' }
  }

  // [SEC-INVITE] zzper_id MUST be the inviting accountant's id: the invitations
  // INSERT policy is WITH CHECK (auth.uid() = zzper_id), and on accept the
  // accountant→client branch reads accountantId from zzper_id. A NULL here was
  // rejected by RLS (invite never saved) and would have broken accept.
  const { error } = await supabase
    .from('invitations')
    .insert({
      zzper_id: accountantId,
      accountant_email: clientEmail,
      invited_by: 'accountant',
      status: 'pending',
    })

  if (error) return { error: 'Uitnodiging versturen mislukt. Probeer het opnieuw.' }
  return {}
}