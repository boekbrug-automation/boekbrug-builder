// src/app/dashboard/brug/page.tsx
// [BOEK-002] Bridge view — server wrapper.
// Fetches invoices + documents + folders (RLS-filtered), builds the bridge tree
// server-side (rendering logic stays on the server), passes nodes to the client.
//
// Mirrors the project pattern: createServerSupabaseClient, profile fetch,
// redirect guards, force-dynamic. Does NOT touch bestanden.ts (BOEK-033).

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [SEC-STORAGE-PATH] A row you may read is not a path you may sign — see storage-path.ts.
import { pathBelongsToOwner } from '@/lib/storage-path'
import { fetchAllRows, fetchAllRowsForIds, chunkIds } from '@/lib/supabase-paginate'
import { lastCompletedQuarter, quarterKeyOf } from '@/lib/quarter'
import {
  buildBridgeTree,
  type BridgeInvoice,
  type BridgeDocument,
  type BridgeFolder,
} from '@/lib/bridge-tree'
import BrugClient from './BrugClient'
import { signedUrls } from '@/lib/document-storage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Brug — BoekBrug' }

// Exact columns the renderer needs (match BridgeInvoice / BridgeDocument).
// Exact columns the renderer needs (match BridgeInvoice / BridgeDocument).
// [BRIDGE-A] + due_date (computed 'Verlopen' badge), accountant_status ('Verwerkt'/'Vraag' badges)
const INVOICE_COLS =
  'id, invoice_number, invoice_type, status, direction, invoice_date, due_date, payment_method, accountant_status, total_inc_btw, document_id, pdf_url, sender_id, receiver_id, client_name'
const DOCUMENT_COLS =
  'id, file_name, file_url, folder_id, doc_type, year, period, invoice_id, user_id, created_at'
const FOLDER_COLS = 'id, name, parent_id, folder_type, user_id'

export default async function BrugServerPage() {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')


  // RLS does the filtering:
  //  - ZZP'er: owner_all / zzp_select → own invoices; documents_owner_all → own docs.
  //  - Accountant: invoices_accountant_read (shared=true, linked clients);
  //                documents_accountant_read (shared docs of linked clients).
  // So we simply select; the policies scope the rows correctly per role.
  //
  // [PAGINATION] fetchAllRows pages past PostgREST's silent ~1000-row cap. The
  // tree's own contract is "a row must never vanish" (unknown statuses route to
  // Overig), yet an unbounded unordered select dropped ARBITRARY rows for any
  // archive beyond 1000 invoices/documents — and the per-client summaries
  // computed from these arrays silently undercounted. Fail-soft: a failed
  // page-walk yields [] exactly like the old `data ?? []`.
  // [NO-SILENT-EMPTY] …but "fail-soft" may not mean "fail SILENT". These three reads ARE the
  // bridge, and on this screen an empty result is not a smaller answer, it is a different one:
  // the accountant sees their client's bridge with no invoices and no documents, and the
  // per-client summaries below — computed from this same array — report every client as 'Leeg'.
  // A transient read error therefore tells a professional, in the app's own confident voice,
  // that none of their clients has anything this quarter. The page still renders (a broken
  // bridge is worse than a stale one), but it now SAYS so, the way the Kas page refuses to show
  // a reassuring €0,00 in place of a failed load.
  const readFailed: string[] = []
  const readOrFlag = async <T,>(label: string, run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run()
    } catch (e) {
      console.error('[NO-SILENT-EMPTY] bridge source read failed', { userId: user.id, source: label, error: e instanceof Error ? e.message : String(e) })
      readFailed.push(label)
      return []
    }
  }
  // [WATERVAL] Het profiel hoort in deze golf en niet ervoor. Het stond erboven met een eigen
  // `await`, dus de drie zware lezingen begonnen pas nadat de rol binnen was — terwijl ze er niets
  // van willen weten: RLS doet hier de afbakening, niet het profiel. Wat er WEL van afhangt is de
  // klantnamenlijst verderop, en die blijft dan ook staan waar hij staat.
  const [invoicesRaw, documentsRaw, foldersRaw, { data: profile }] = await Promise.all([
    readOrFlag('facturen', () => fetchAllRows((from, to) => supabase
      .from('invoices').select(INVOICE_COLS)
      .order('id', { ascending: true }).range(from, to)
    )),
    readOrFlag('documenten', () => fetchAllRows((from, to) => supabase
      .from('documents').select(DOCUMENT_COLS).eq('trashed', false)
      .order('id', { ascending: true }).range(from, to)
    )),
    readOrFlag('mappen', () => fetchAllRows((from, to) => supabase
      .from('folders').select(FOLDER_COLS)
      .order('id', { ascending: true }).range(from, to)
    )),
    supabase.from('profiles').select('onboarding_done, role').eq('id', user.id).single(),
  ])

  if (!profile?.onboarding_done) redirect('/onboarding')

  const isAccountant = profile.role === 'accountant'

  // NOTE: cast via `unknown` because database.types.ts may predate the B.1
  // migration (payment_method / shared). The columns DO exist in the DB;
  // BridgeInvoice/BridgeDocument are the source of truth for shape here.
  // Best fix: regenerate types →
  //   npx supabase gen types typescript --project-id <ref> > src/types/database.types.ts
  const invoices = (invoicesRaw as unknown) as BridgeInvoice[]
  const documents = (documentsRaw as unknown) as BridgeDocument[]
  const folders = (foldersRaw as unknown) as BridgeFolder[]

  // [BOEK-005] Accountant view: resolve client UUIDs → display labels
  // ("Naam — Bedrijf") so the Klanten folders show names, not raw ids.
  let clientNames: Map<string, string> | undefined
  if (isAccountant) {
    const { data: links } = await supabase
      .from('accountant_clients')
      .select('zzper_id, profiles:zzper_id (id, full_name, company_name)')
      .eq('accountant_id', user.id)

    clientNames = new Map<string, string>()
    for (const link of links ?? []) {
      const p = (link as unknown as {
        profiles?: { id?: string; full_name?: string | null; company_name?: string | null } | null
      }).profiles
      if (!p?.id) continue
      const name = (p.full_name ?? '').trim()
      const company = (p.company_name ?? '').trim()
      const label =
        name && company ? `${name} — ${company}` : (company || name || p.id)
      clientNames.set(p.id, label)
    }
  }

  // Build the tree server-side. Rendering logic never reaches the client.
  const nodes = buildBridgeTree({
    invoices,
    documents,
    folders,
    accountantView: isAccountant,
    clientNames,
  })

  // [BOEK-002] Resolve playable URLs server-side.
  // documents store a raw storage path in file_url → needs a signed URL.
  // invoices may carry a full http(s) url already → leave as-is.
  //
  // ⚠️ Why service_role here (despite the pipeline-client warning):
  // Storage bucket policies are SEPARATE from table RLS. Table RLS let the
  // accountant READ the row metadata, but the storage bucket only lets a user
  // sign their OWN files — so the accountant can't sign a linked client's file
  // via the user session (returns null → no link, the bug we saw).
  // We sign with service_role, but ONLY for nodes that already passed table RLS
  // (the rows were fetched under the user session + the clientNames filter), so
  // no unauthorized path is ever signed. service_role is used here strictly to
  // bypass STORAGE rls, not to widen which rows are visible.
  const pipeline = createPipelineClient()

  // [SEC-STORAGE-PATH] "The rows already passed table RLS, so no unauthorized path is ever
  // signed" — the first half is true and the second does not follow from it. pdf_url/file_url
  // are plain text the ROW'S OWN OWNER may write, so an authorized row can still name another
  // tenant's storage key, and service_role signs whatever it is handed. Each node carries the
  // owner its bytes must belong to; a path outside that folder is dropped, not signed.
  //
  // [SIGN-BATCH] Signed in BATCHES, not one HTTP round-trip per node. This was
  // `Promise.all(nodes.map(… createSignedUrl …))`, i.e. one storage call per file — and for an
  // accountant that is every document of every linked client, fired concurrently, on a
  // force-dynamic page that BrugClient re-runs on every tab focus. createSignedUrls takes the
  // whole list at once; chunked so one request never carries an unbounded path array.
  const toSign: string[] = []
  for (const n of nodes) {
    if (!n.pdfUrl || /^https?:\/\//i.test(n.pdfUrl)) continue
    if (!pathBelongsToOwner(n.pdfUrl, n.ownerId)) continue
    toSign.push(n.pdfUrl)
  }
  const signedByPath = new Map<string, string>()
  for (const chunk of chunkIds(toSign, 100)) {
    const { data } = await signedUrls(pipeline, chunk, 3600)
    for (const s of data ?? []) {
      if (s.path && s.signedUrl && !s.error) signedByPath.set(s.path, s.signedUrl)
    }
  }
  const signedNodes = nodes.map((n) => {
    if (!n.pdfUrl) return n
    // Already a full URL → keep (not ours to sign).
    if (/^https?:\/\//i.test(n.pdfUrl)) return n
    if (!pathBelongsToOwner(n.pdfUrl, n.ownerId)) {
      console.error('[SEC-STORAGE-PATH] refused to sign a node path outside its owner', {
        nodeId: n.id, source: n.source, ownerId: n.ownerId, path: n.pdfUrl,
      })
      return { ...n, pdfUrl: null }
    }
    return { ...n, pdfUrl: signedByPath.get(n.pdfUrl) ?? null }
  })

  // [BRIDGE-HUB] Layer 1 — per-client summaries for the accountant's overview.
  // Computed from the invoices already fetched (no extra query). For each linked
  // client: how many verified invoices this quarter, and whether anything is
  // still pending (status 'processing') — which sets the readiness status.
  //   Klaar          → has verified invoices, nothing pending
  //   Te controleren → has pending (processing) invoices to confirm
  //   Leeg           → no invoices this quarter
  let clientSummaries: ClientSummary[] | undefined
  if (isAccountant && clientNames) {
    // [BRIDGE-QUARTER-PICKER] The SAME quarter the hub opens on. This computed the CURRENT
    // calendar quarter in server-local time, while BrugClient's picker defaults to the last
    // completed one via the shared helper — the exact drift its own comment says was already
    // fixed there and left here. The consequence was not subtle: in July the dropdown described
    // Q3 (one month old, mostly empty) while Overzicht, Kwartaal and "Download kwartaal" behind
    // it all opened Q2, so a client who had finished Q2 perfectly was labelled 'Leeg'.
    //
    // Membership is decided on the ISO date STRING via quarterKeyOf, not by building Date
    // objects: invoice_date is date-only, `new Date('2026-01-01')` is midnight UTC, and it was
    // being compared against a LOCAL-midnight quarter boundary — a mismatch that silently drops
    // the first day(s) of a quarter on any server not running in UTC. Strings have no timezone.
    const { year: sumYear, quarter: sumQuarter } = lastCompletedQuarter()
    const summaryQuarterKey = `${sumYear}-Q${sumQuarter}`
    const VERIFIED = new Set(['sent', 'paid', 'overdue', 'received'])

    const acc = new Map<string, { verified: number; pending: number; total: number }>()
    for (const id of clientNames.keys()) acc.set(id, { verified: 0, pending: 0, total: 0 })

    for (const inv of invoices) {
      if (quarterKeyOf(inv.invoice_date) !== summaryQuarterKey) continue
      // The invoice belongs to whichever linked client is sender or receiver.
      const owner = (inv.sender_id && acc.has(inv.sender_id)) ? inv.sender_id
                  : (inv.receiver_id && acc.has(inv.receiver_id)) ? inv.receiver_id
                  : null
      if (!owner) continue
      const bucket = acc.get(owner)!
      bucket.total++
      const s = inv.status ?? ''
      if (VERIFIED.has(s)) bucket.verified++
      else if (s === 'processing') bucket.pending++
    }

    clientSummaries = [...clientNames.entries()].map(([id, label]) => {
      const b = acc.get(id) ?? { verified: 0, pending: 0, total: 0 }
      const status: ClientSummary['status'] =
        b.pending > 0 ? 'review' : b.verified > 0 ? 'ready' : 'empty'
      return { id, label, verified: b.verified, pending: b.pending, status }
    }).sort((a, b) => a.label.localeCompare(b.label, 'nl'))
  }

  // [READINESS-P3] Accountant-asserted per-document status (subject_type='document').
  // Only the accountant needs it here — RLS acc_status_owner_all scopes the rows to
  // THIS accountant, so we simply query and map subject_id → {status, vraag_text}.
  // A ZZP owner gets an empty map (no status claims surface on their own tree here).
  const docStatus: Record<string, { status: string; vraag_text: string | null }> = {}
  if (isAccountant) {
    const docIds = signedNodes.filter(n => n.source === 'document').map(n => n.id)
    if (docIds.length > 0) {
      // [IN-CHUNK] Chunked + paged. This is one `.in()` over EVERY document of EVERY linked
      // client, and a plain one hits both silent ceilings — the ~1000-row response cap and the
      // length of the id list in the URL. Either way the map comes back short, and a document
      // whose status simply fell off the end renders with no badge at all: indistinguishable
      // from one the accountant has never touched.
      try {
        const statusRows = await fetchAllRowsForIds<{ subject_id: string; status: string; vraag_text: string | null }, string>(
          docIds,
          (chunk, from, to) => supabase
            .from('accountant_subject_status')
            .select('subject_id, status, vraag_text')
            .eq('subject_type', 'document')
            .in('subject_id', chunk)
            .order('subject_id', { ascending: true })
            .range(from, to),
        )
        for (const r of statusRows) {
          docStatus[r.subject_id] = { status: r.status, vraag_text: r.vraag_text ?? null }
        }
      } catch (e) {
        // Display-only: no badge is the honest default (bridge-tree never invents a status).
        console.error('[READINESS-P3] document status read failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  return (
    <BrugClient
      nodes={signedNodes}
      role={profile.role}
      clientSummaries={clientSummaries}
      docStatus={docStatus}
      // [NO-SILENT-EMPTY] Which sources could not be read, so the screen can say that an empty
      // bridge is an unanswered question rather than an answer.
      readFailed={readFailed}
    />
  )
}

// [BRIDGE-HUB] Per-client readiness summary for the accountant overview (Layer 1).
export interface ClientSummary {
  id: string
  label: string
  verified: number
  pending: number
  status: 'ready' | 'review' | 'empty'
}