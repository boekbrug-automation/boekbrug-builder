// src/app/api/accountant/invoice-status/route.ts
// [BOEKHOUDER-DEUR] The HTTP face of the one write path for invoices.accountant_status.
//
// The accountant's quarter screen used to write this column with a direct browser UPDATE — no
// route, no permission check, no audit row, and nothing anywhere deciding who may do it. This is
// the route that write now goes through; the decision itself lives in accountant-status-door.ts,
// so /api/accountant/invoice-question can use the same door for its own 'vraag' write without two
// copies of the four checks.
//
// This route holds only what is HTTP: reading a body, refusing a malformed one, the rate limit, and
// turning the door's answer into a status code. It decides nothing about the invoice.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction } from '@/lib/audit'
import { setAccountantStatus, isAccountantStatus, type DoorRefusal } from '@/lib/accountant-status-door'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Which refusals are the caller's fault, which are ours. A 503 invites a retry; a 403 does not. */
const STATUS_OF: Record<DoorRefusal, number> = {
  not_authenticated: 401,
  unknown_status: 400,
  link_read_failed: 503,
  not_linked: 403,
  invoice_read_failed: 503,
  invoice_not_visible: 404,
  invoice_not_this_client: 403,
  write_failed: 500,
  nothing_written: 409,
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
  // null is a real value here and the whole point of the undo — so it is accepted explicitly, and
  // anything that is neither null nor a known word is refused rather than coerced.
  const raw = body?.status
  if (!UUID.test(clientId) || !UUID.test(invoiceId)) {
    return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  }
  if (raw !== null && !isAccountantStatus(raw)) {
    return NextResponse.json({ error: 'Onbekende status' }, { status: 400 })
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: '/api/accountant/invoice-status',
    ...RATE_LIMITS.INVOICE_SEND,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  const result = await setAccountantStatus({
    session: supabase,
    pipeline: createPipelineClient(),
    invoiceId,
    clientId,
    status: raw,
  })

  if (!result.ok) {
    if (STATUS_OF[result.reason] >= 500) {
      console.error('[BOEKHOUDER-DEUR] status zetten mislukt', {
        accountantId: user.id, invoiceId, reason: result.reason, detail: result.detail,
      })
    }
    return NextResponse.json({ error: result.reason }, { status: STATUS_OF[result.reason] })
  }

  // The act is recorded where every other accountant action on an invoice is recorded. Best-effort,
  // and deliberately after the write: a failed audit may never undo a status the accountant set.
  await logAuditAction({
    userId: user.id,
    action: 'accountant.invoice_status_set',
    entityType: 'invoice',
    entityId: invoiceId,
    newValue: { accountant_status: result.status, accountant_id: result.accountantId },
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: result.status, accountantId: result.accountantId })
}
