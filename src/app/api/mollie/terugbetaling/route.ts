// src/app/api/mollie/terugbetaling/route.ts
// [TERUGBETALING] GET — wat er nog aan terugbetalingen op een antwoord wacht.
// POST { refundId, action } — het antwoord van de eigenaar op één ervan.
//
// De synchronisatie legt het FEIT vast (mollie_refunds); deze route legt het ANTWOORD vast, en
// voert alleen bij 'reverse' ook echt iets uit. Drie antwoorden, en de app kiest er geen van:
//
//   reverse  — de betaling gaat van de factuur af. Eén rij uit bank_tx_invoices, via
//              reverse_invoice_payment, die amount_paid en de status opnieuw AFLEIDT.
//   credit   — de ondernemer maakt er een creditnota voor. De factuur blijft betaald staan; dat
//              is in de Nederlandse boekhouding het normale antwoord op een terugbetaling.
//   not-ours — de betaling hoorde niet bij een BoekBrug-factuur. Niets te boeken.
//
// [SERVER-ZIN] Deze route geeft CODES terug, nooit zinnen: het scherm schrijft het Nederlands, in
// de taal van de gebruiker. Zie de WEIGERING-kaart in TerugbetalingLijst.tsx.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { requireOwner } from '@/lib/owner-only'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { isRefundAnswer, mayReverse, type RefundKind } from '@/lib/mollie-refund'
import { fetchAllRowsForIds } from '@/lib/supabase-paginate'

export const dynamic = 'force-dynamic'

/** mollie_refunds is met de hand toegepast en staat niet in de gegenereerde typen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any

type RefundRow = {
  id: string
  refund_id: string
  kind: RefundKind
  amount: number | string | null
  created_on: string | null
  link_id: string | null
  invoice_id: string | null
  resolution: string
}

const SELECT = 'id, refund_id, kind, amount, created_on, link_id, invoice_id, resolution'

function refuse(code: string, status: number) {
  return NextResponse.json({ error: code, code }, { status })
}

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const pipeline = createPipelineClient() as Pipeline
  const { data, error } = await pipeline
    .from('mollie_refunds')
    .select(SELECT)
    .eq('user_id', user.id)
    .eq('resolution', 'open')
    .order('noted_at', { ascending: false })
    .limit(50)
  // De tabel kan op een omgeving nog niet bestaan (mollie_refunds.sql wordt met de hand
  // toegepast). Dat is "er zijn er geen", en niet iets waar de instellingenpagina op mag stuk
  // lopen — elke andere fout is wél een weigering, want dan bestaan ze mogelijk wel.
  if (error) {
    if (/does not exist|schema cache/i.test(error.message ?? '')) return NextResponse.json({ refunds: [] })
    return refuse('list_failed', 500)
  }

  const rows = (data ?? []) as RefundRow[]
  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))] as string[]
  const invoices = new Map<string, { number: string | null; client: string | null }>()
  if (invoiceIds.length > 0) {
    // [IN-CHUNK] Chunked, though this list is capped at 50 above: the rule is about the shape, not
    // about today's ceiling — an unchunked .in() dies with a 414 that supabase-js reports as an
    // ordinary error, and the caller then reads a failed call as "no invoices".
    // The helper THROWS on the first error, so a partial read can never pass as complete — and a
    // list without invoice numbers is a panel that asks about money without saying which sale.
    try {
      const invs = await fetchAllRowsForIds<{ id: string; invoice_number: string | null; client_name: string | null }, string>(
        invoiceIds,
        (chunk, from, to) => pipeline
          .from('invoices')
          .select('id, invoice_number, client_name')
          .in('id', chunk)
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order('id')
          .range(from, to),
      )
      for (const i of invs) invoices.set(i.id, { number: i.invoice_number, client: i.client_name })
    } catch {
      return refuse('list_failed', 500)
    }
  }

  return NextResponse.json({
    refunds: rows.map((r) => ({
      refundId: r.refund_id,
      kind: r.kind,
      amount: Number(r.amount),
      createdOn: r.created_on,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_id ? invoices.get(r.invoice_id)?.number ?? null : null,
      clientName: r.invoice_id ? invoices.get(r.invoice_id)?.client ?? null : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  { const w = await requireOwner('Een terugbetaling beantwoorden'); if (w.response) return w.response }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const refundId = typeof body?.refundId === 'string' ? body.refundId.trim() : ''
  const action = body?.action
  if (!refundId || !isRefundAnswer(action)) return refuse('invalid_body', 400)

  const pipeline = createPipelineClient() as Pipeline
  const { data: row, error: rowErr } = await pipeline
    .from('mollie_refunds')
    .select(SELECT)
    .eq('user_id', user.id)
    .eq('refund_id', refundId)
    .maybeSingle()
  if (rowErr) return refuse('lookup_failed', 500)
  if (!row) return refuse('not_found', 404)
  const refund = row as RefundRow
  // Twee mensen die dezelfde vraag beantwoorden is een gewone dinsdag; twee ANTWOORDEN op één
  // feit is dat niet. Wie als tweede klikt krijgt te horen dat het al beantwoord is, en er wordt
  // niets overschreven — het eerste antwoord is het antwoord.
  if (refund.resolution !== 'open') return refuse('already_answered', 409)

  const amount = Number(refund.amount)
  const now = new Date().toISOString()

  if (action === 'reversed') {
    // De geboekte betaling is de bank_tx_invoices-rij die de webhook schreef met het id van de
    // betaallinkrij als client_key — zie mollie/webhook/route.ts. Zonder link_id is er geen
    // betaling om aan te wijzen.
    if (!refund.link_id || !refund.invoice_id) return refuse('no_invoice', 409)
    const { data: links, error: linkErr } = await pipeline
      .from('bank_tx_invoices')
      .select('id, amount_applied, transaction_id')
      .eq('user_id', user.id)
      .eq('client_key', refund.link_id)
    if (linkErr) return refuse('payment_lookup_failed', 500)
    const payment = ((links ?? []) as { id: string; amount_applied: number | string | null; transaction_id: string | null }[])[0] ?? null

    const verdict = mayReverse({
      invoiceId: refund.invoice_id,
      appliedAmount: payment ? Number(payment.amount_applied) : null,
      refundAmount: amount,
    })
    if (!verdict.ok) return refuse(verdict.refusal.replace(/-/g, '_'), 409)

    const { error: rpcErr } = await pipeline.rpc('reverse_invoice_payment', {
      p_user_id: user.id,
      p_link_id: payment!.id,
    })
    if (rpcErr) {
      const msg = String(rpcErr.message ?? '')
      // De weigeringen van de functie zelf, elk met hun eigen code zodat het scherm kan zeggen
      // WAT er in de weg staat in plaats van dat er iets misging.
      if (/verwerkt/i.test(msg)) return refuse('accountant_lock', 409)
      if (/bank line/i.test(msg)) return refuse('has_bank_line', 409)
      if (/not found/i.test(msg)) return refuse('payment_gone', 409)
      return refuse('reverse_failed', 500)
    }
  }

  const resolution = action === 'reversed' ? 'reversed' : action === 'credited' ? 'credited' : 'not_ours'
  const { data: updated, error: updErr } = await pipeline
    .from('mollie_refunds')
    .update({ resolution, resolved_at: now, updated_at: now })
    .eq('user_id', user.id)
    .eq('refund_id', refundId)
    .eq('resolution', 'open')
    .select('id')
  if (updErr) return refuse('save_failed', 500)
  // De betaling is er wél af en het antwoord niet vastgelegd: dat is de enige half-af toestand
  // hier, en hij mag niet stil blijven. De volgende synchronisatie repareert hem zelf — de
  // factuur staat lager dan de momentopname, dus de rij sluit als 'reversed'.
  if ((updated ?? []).length === 0 && action === 'reversed') {
    console.error('[TERUGBETALING] betaling teruggedraaid maar het antwoord niet vastgelegd', { userId: user.id, refundId })
  }

  await logAuditAction({
    userId: user.id,
    action: action === 'reversed' ? 'mollie.refund_reversed' : 'mollie.refund_answered',
    entityType: 'invoice',
    entityId: refund.invoice_id ?? refundId,
    newValue: { refund_id: refundId, kind: refund.kind, amount, resolution },
    ipAddress: getClientIP(req),
  })

  return NextResponse.json({ ok: true, resolution })
}
