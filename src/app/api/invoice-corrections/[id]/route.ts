// src/app/api/invoice-corrections/[id]/route.ts
// [VOORSTEL] POST { action: "accept" | "decline" } — the client decides on a proposal.
//
// ── THE ONE DOOR ──
// Akkoord does not update the invoice here. It builds the exact request the client's own editor
// sends and calls the PATCH handler of /api/invoice/[id]/amounts — in THIS request, with THIS
// session — so every check that door makes (owner-only, status, settled money, arithmetic, the
// duplicate-number check, the filed-quarter impact, the audit row) runs unchanged. If that door
// refuses, the proposal stays open and the client sees the door's own sentence.
//
// A proposal is refused as STALE when the invoice no longer matches the snapshot on the fields it
// names: someone corrected it in between, and applying an old proposal on top of the newer truth
// is the one thing this feature must never do.
//
// ── ONE DECISION ──
// The row and the invoice must never contradict each other, and two requests must never both run
// the door. So an accept CLAIMS the row first (applying_since, compare-and-set on status = open
// and no live claim), then calls the door, then closes the row — and every write on the row checks
// that it actually moved a row. A decline is refused while a claim is live. A request that died
// between the door and the close leaves the invoice carrying the proposal; the next tap sees that
// (isAlreadyApplied) and closes the row as accepted instead of calling it stale.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { requireOwner } from '@/lib/owner-only'
import { createNotification } from '@/lib/notifications'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { isStale, isAlreadyApplied, isChangeList, proposalEndsOn, proposalPatchBody, CLAIM_LEASE_MS, type ProposableValues, type ProposedChange } from '@/lib/correction-proposal'
import { PATCH as correctInvoiceAmounts } from '@/app/api/invoice/[id]/amounts/route'
import { clientOverviewHref, invoiceNoticeHref } from '@/lib/accountant-deep-links'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ProposalRow = {
  id: string; accountant_id: string; client_id: string; invoice_id: string; status: string
  before: ProposableValues; proposed: ProposableValues; changes: ProposedChange[]; applying_since: string | null
}

const READ_FAILED = 'Het voorstel kon niet worden gelezen — probeer het opnieuw.'
const BUSY = 'Dit voorstel wordt op dit moment al verwerkt — ververs de pagina.'

/**
 * [KANTOOR-LINKS] Where the accountant lands when their client answers a correction proposal.
 *
 * Both notifications used to carry `/dashboard/clients/{id}/kwartaal` with no period and no row.
 * That screen reads `q` and `year` from the URL and defaults to `q=1` and the CURRENT year when
 * they are absent — so an answer about a Q3 invoice opened Q1, the invoice was not in the list,
 * and the accountant went looking for the thing the app had just told them about.
 *
 * The period comes from the invoice's OWN date (never today's quarter) and the row from the
 * `?focus=` contract that screen already has.
 *
 * And when the date cannot be read, the notification does NOT fall back to `/kwartaal` without a
 * period: that screen answers a missing `q`/`year` with Q1 of the current year, so the bare route
 * is not "the link minus one fact" — it is a link that puts the accountant in a quarter nobody
 * computed and shows them a list that looks complete. The client's own file says nothing about a
 * period, and that is the honest place to land.
 */
function correctionNoticeLink(clientId: string, invoiceId: string, invoiceDate: string | null): string {
  return invoiceNoticeHref(clientId, invoiceId, invoiceDate) ?? clientOverviewHref(clientId)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  const supabase = await createServerSupabaseClient()
  { const w = await requireOwner('Een correctievoorstel van je boekhouder beantwoorden'); if (w.response) return w.response }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const action = body?.action === 'accept' ? 'accept' : body?.action === 'decline' ? 'decline' : null
  if (!action) return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const { data: p, error: readErr } = await pipeline
    .from('invoice_corrections')
    .select('id, accountant_id, client_id, invoice_id, status, before, proposed, changes, applying_since')
    .eq('id', id)
    .eq('client_id', user.id)
    .maybeSingle()
  if (readErr) {
    console.error('[VOORSTEL] voorstel lezen mislukt', { userId: user.id, id, error: readErr.message })
    return NextResponse.json({ error: READ_FAILED }, { status: 503 })
  }
  const proposal = p as ProposalRow | null
  if (!proposal) return NextResponse.json({ error: 'Voorstel niet gevonden' }, { status: 404 })
  if (proposal.status !== 'open') return NextResponse.json({ error: 'Dit voorstel is al beantwoord.', code: 'decided' }, { status: 409 })
  if (!isChangeList(proposal.changes) || !proposal.before || !proposal.proposed) {
    console.error('[VOORSTEL] voorstelrij onleesbaar', { userId: user.id, id })
    return NextResponse.json({ error: READ_FAILED }, { status: 503 })
  }
  const now = Date.now()
  const claimLive = proposal.applying_since !== null && now - Date.parse(proposal.applying_since) < CLAIM_LEASE_MS
  const leaseEdge = new Date(now - CLAIM_LEASE_MS).toISOString()

  // Every write on the row is a compare-and-set that reports whether it moved the row: from open
  // and unclaimed (fromClaim = false), or from the claim this request holds (fromClaim = true).
  type RowStatus = 'accepted' | 'declined' | 'stale'
  const closeRow = async (status: RowStatus, fromClaim: boolean): Promise<'moved' | 'lost' | 'failed'> => {
    let q = pipeline.from('invoice_corrections')
      .update({ status, decided_at: new Date().toISOString(), applying_since: null })
      .eq('id', proposal.id).eq('status', 'open')
    // Without a claim the row must be unclaimed (or the claim dead); with one it must be ours.
    q = fromClaim ? q.not('applying_since', 'is', null) : q.or(`applying_since.is.null,applying_since.lt.${leaseEdge}`)
    const { data, error } = await q.select('id')
    if (error) {
      console.error('[VOORSTEL] voorstel sluiten mislukt', { userId: user.id, id, status, error: error.message })
      return 'failed'
    }
    return data && data.length > 0 ? 'moved' : 'lost'
  }

  if (action === 'decline') {
    if (claimLive) return NextResponse.json({ error: BUSY, code: 'busy' }, { status: 409 })
    const r = await closeRow('declined', false)
    if (r === 'failed') return NextResponse.json({ error: 'Het antwoord kon niet worden opgeslagen — probeer het opnieuw.' }, { status: 503 })
    if (r === 'lost') return NextResponse.json({ error: 'Dit voorstel is al beantwoord.', code: 'decided' }, { status: 409 })
    // [KANTOOR-LINKS] The invoice's own date, for the period the notification points at. Read
    // under the client's own session (RLS: they are the receiver), best-effort — a failed read
    // costs the period, never the notification.
    const { data: declined } = await supabase
      .from('invoices').select('invoice_date').eq('id', proposal.invoice_id).eq('receiver_id', user.id).maybeSingle()
    await createNotification({
      userId: proposal.accountant_id, type: 'status',
      title: 'Correctievoorstel afgewezen', // [TAAL-DB]
      body: 'Je klant ging niet akkoord met je correctievoorstel. De factuur is ongewijzigd.', // [TAAL-DB]
      link: correctionNoticeLink(proposal.client_id, proposal.invoice_id, declined?.invoice_date ?? null),
    })
    await logAuditAction({ userId: user.id, action: 'invoice.correction_declined', entityType: 'invoice', entityId: proposal.invoice_id, newValue: { proposal_id: proposal.id }, ipAddress: getClientIP(request) })
    return NextResponse.json({ ok: true, status: 'declined' })
  }

  // ── accept ──
  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date')
    .eq('id', proposal.invoice_id)
    .eq('receiver_id', user.id)
    .maybeSingle()
  if (invErr) return NextResponse.json({ error: 'De factuur kon niet worden gelezen — probeer het opnieuw.' }, { status: 503 })
  if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  const current: ProposableValues = {
    total_ex_btw: inv.total_ex_btw, btw_amount: inv.btw_amount, total_inc_btw: inv.total_inc_btw,
    invoice_date: inv.invoice_date, due_date: inv.due_date,
  }
  const stale = isStale(proposal.before, current, proposal.changes)
  // The invoice already carries the proposal: the door ran and the row was not closed. Close it
  // as what it is — accepted — and never as stale. Checked before the stale check on purpose: an
  // applied proposal is by definition "moved since the snapshot".
  const applied = isAlreadyApplied(proposal.proposed, current, proposal.changes)
  if (claimLive && !applied) return NextResponse.json({ error: BUSY, code: 'busy' }, { status: 409 })
  if (applied) {
    const r = await closeRow('accepted', false)
    if (r === 'failed') return NextResponse.json({ error: 'Het antwoord kon niet worden opgeslagen — probeer het opnieuw.' }, { status: 503 })
    if (r === 'lost') return NextResponse.json({ error: 'Dit voorstel is al beantwoord.', code: 'decided' }, { status: 409 })
    await logAuditAction({ userId: user.id, action: 'invoice.correction_accepted', entityType: 'invoice', entityId: proposal.invoice_id, newValue: { proposal_id: proposal.id, changes: proposal.changes, already_applied: true }, ipAddress: getClientIP(request) })
    return NextResponse.json({ ok: true, status: 'accepted' })
  }
  if (stale) {
    const r = await closeRow('stale', false)
    if (r === 'lost') return NextResponse.json({ error: 'Dit voorstel is al beantwoord.', code: 'decided' }, { status: 409 })
    return NextResponse.json({ error: 'De factuur is intussen veranderd; dit voorstel vervalt. Vraag je boekhouder om een nieuw voorstel.', code: 'stale' }, { status: 409 })
  }

  // CLAIM. Exactly one request gets past this line per open row per lease: the WHERE re-asserts
  // open + unclaimed (or a dead claim), and .select() says whether it was us.
  const { data: claimed, error: claimErr } = await pipeline.from('invoice_corrections')
    .update({ applying_since: new Date(now).toISOString() })
    .eq('id', proposal.id).eq('status', 'open')
    .or(`applying_since.is.null,applying_since.lt.${leaseEdge}`)
    .select('id')
  if (claimErr) {
    console.error('[VOORSTEL] claim mislukt', { userId: user.id, id, error: claimErr.message })
    return NextResponse.json({ error: 'De correctie kon nu niet worden toegepast — probeer het opnieuw.' }, { status: 503 })
  }
  if (!claimed || claimed.length === 0) return NextResponse.json({ error: BUSY, code: 'busy' }, { status: 409 })

  // The client's own door, in the client's own session. Nothing else writes the invoice.
  const patchBody = { ...proposalPatchBody(proposal.proposed, proposal.changes), proposal_id: proposal.id }
  const doorRequest = new NextRequest(new URL(`/api/invoice/${proposal.invoice_id}/amounts`, request.url), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
      'x-real-ip': request.headers.get('x-real-ip') ?? '',
    },
    body: JSON.stringify(patchBody),
  })
  const doorResponse = await correctInvoiceAmounts(doorRequest, { params: Promise.resolve({ id: proposal.invoice_id }) })
  if (!doorResponse.ok) {
    const doorJson = await doorResponse.json().catch(() => ({}))
    if (proposalEndsOn(doorJson.code)) {
      // Paid, money booked, or verwerkt: this proposal can never apply. Closed as vervallen, so the
      // accountant is not shown "wacht op de klant" for a decision nobody can take.
      await closeRow('stale', true)
      return NextResponse.json({ error: doorJson.error ?? 'De correctie kon niet worden toegepast.', code: 'stale' }, { status: 409 })
    }
    // Release the claim: the door's own sentence, the door's own status, the proposal stays open.
    const { error: relErr } = await pipeline.from('invoice_corrections')
      .update({ applying_since: null }).eq('id', proposal.id).eq('status', 'open')
    if (relErr) console.error('[VOORSTEL] claim vrijgeven mislukt', { userId: user.id, id, error: relErr.message })
    return NextResponse.json({ error: doorJson.error ?? 'De correctie kon niet worden toegepast.', code: doorJson.code ?? 'door_refused' }, { status: doorResponse.status })
  }

  // The invoice is written. Close the row from our claim; if that somehow fails, say so loudly —
  // the next tap heals it through isAlreadyApplied, and the trail below still records the fact.
  const closed = await closeRow('accepted', true)
  if (closed !== 'moved') console.error('[VOORSTEL] factuur aangepast maar voorstelrij niet gesloten', { userId: user.id, id, closed })
  const appliedInvoiceDate = proposal.changes.some((c) => c.field === 'invoice_date')
    ? proposal.proposed.invoice_date
    : inv.invoice_date
  await createNotification({
    userId: proposal.accountant_id, type: 'status',
    title: 'Correctievoorstel overgenomen', // [TAAL-DB]
    body: 'Je klant ging akkoord; de factuur is aangepast zoals je voorstelde.', // [TAAL-DB]
    // [KANTOOR-LINKS] The date the invoice carries NOW, which is the proposed one when this
    // proposal moved it — a correction may change invoice_date, and the row the accountant is
    // being sent to look at has already moved to that quarter. Using the pre-correction date
    // here would point at the quarter the invoice just left.
    link: correctionNoticeLink(proposal.client_id, proposal.invoice_id, appliedInvoiceDate),
  })
  await logAuditAction({ userId: user.id, action: 'invoice.correction_accepted', entityType: 'invoice', entityId: proposal.invoice_id, newValue: { proposal_id: proposal.id, changes: proposal.changes }, ipAddress: getClientIP(request) })
  return NextResponse.json({ ok: true, status: 'accepted' })
}
