// src/app/api/control/toekenning/route.ts
// [TOEKENNING-DEUR] The one door that writes plan_grants. Two verbs: grant, and withdraw.
//
// POST /api/control/toekenning
//   { action: 'grant',  userId, plan, reason, expiresAt | null, openEnded }
//   { action: 'revoke', grantId, reason }
//
// ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────────────────────
// plan_grants has been read on every request and on three screens since the day it was written,
// and nothing in the app could write one. Every pilot and every extension was therefore a
// hand-typed INSERT against production — no validation, no audit row, no second reading of the
// date, typed by whoever was on the phone with the customer at that moment.
//
// ── WHY 404 AND NOT 403 ─────────────────────────────────────────────────────────────────────
// Same answer as the console it belongs to: an endpoint that refuses with 403 has confirmed it
// exists. CONTROL_USER_IDS lives outside the database (control-access.ts) — nothing in the app can
// grant it and no migration can widen it — and an unset variable means NOBODY, so on an
// unconfigured deployment this route does not exist at all.
//
// ── WHAT IT MAY NOT TOUCH ───────────────────────────────────────────────────────────────────
// The books. [GEEN-ACHTERDEUR] fails the build if anything under src/app/api/control writes to
// invoices, booking lines, btw, bank or cash. An administrator may change what an account MAY DO;
// he may never change what it DID. This route writes exactly one table.
//
// ── WHY THERE IS NO 'extend' ────────────────────────────────────────────────────────────────
// Extending is granting again. plan_grants holds one row per REASON and grantStanding() already
// takes the LAST end date among the active rows, so a second grant extends by construction — and
// both halves of the story survive. An UPDATE on expires_at would overwrite the only evidence of
// what was originally promised.

import { NextRequest, NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { mayOpenControl } from '@/lib/control-access'
import { planGrantVerdict, isRevokable } from '@/lib/plan-grant-actions'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * A refusal is a CODE. The console owns the words (WEIGERING in ToekenningPaneel.tsx).
 *
 * [SERVER-ZIN]: a screen that renders a route's own string is how an internal message reaches a
 * person's display, and how the same refusal ends up phrased two ways in two places. So this route
 * says WHAT was refused and never HOW to say it.
 */
const refuse = (code: string, status = 400) =>
  NextResponse.json({ code }, { status })

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!mayOpenControl(user?.id, process.env.CONTROL_USER_IDS)) {
    // Not 403. See the header.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const actor = user!.id

  const body = await req.json().catch(() => ({}))
  const action = typeof body?.action === 'string' ? body.action : ''
  const pipeline = createPipelineClient()
  const ip = getClientIP(req)

  // ── Withdraw ──────────────────────────────────────────────────────────────────────────────
  if (action === 'revoke') {
    const grantId = typeof body?.grantId === 'string' ? body.grantId.trim() : ''
    if (!grantId) return refuse('grant-missing')
    const why = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (why.length < 3) return refuse('reason-missing')

    const { data: row, error: readErr } = await pipeline
      .from('plan_grants')
      .select('id, user_id, plan, expires_at, revoked_at, reason')
      .eq('id', grantId)
      .maybeSingle()
    // [NO-SILENT-EMPTY] A failed read must not read as "this grant does not exist" — that answer
    // sends the operator off to create a second one beside a grant that is still running.
    if (readErr) return refuse('read-failed', 500)
    if (!row) return refuse('grant-unknown', 404)
    if (!isRevokable(row)) {
      // Two people closing the same pilot is an ordinary Tuesday, not an error — but it is not a
      // write either: re-stamping would replace who stopped it and when.
      return NextResponse.json({ ok: true, alreadyRevoked: true })
    }

    const { error: updErr } = await pipeline
      .from('plan_grants')
      .update({ revoked_at: new Date().toISOString(), revoked_by: actor })
      // Re-assert it is still open, so two simultaneous clicks cannot overwrite each other.
      .eq('id', grantId)
      .is('revoked_at', null)
    if (updErr) return refuse('write-failed', 500)

    await logAuditAction({
      userId: actor,
      action: 'control.grant_revoked',
      entityType: 'plan_grant',
      entityId: grantId,
      oldValue: { user_id: row.user_id, plan: row.plan, expires_at: row.expires_at, reason: row.reason },
      newValue: { revoked_by: actor, reason: why },
      ipAddress: ip,
    })
    return NextResponse.json({ ok: true })
  }

  // ── Hand out ──────────────────────────────────────────────────────────────────────────────
  if (action !== 'grant') return refuse('action-unknown')

  const targetId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!targetId) return refuse('account-missing')

  const verdict = planGrantVerdict(
    {
      plan: typeof body?.plan === 'string' ? body.plan : '',
      reason: typeof body?.reason === 'string' ? body.reason : '',
      expiresAt: typeof body?.expiresAt === 'string' ? body.expiresAt : null,
      openEnded: body?.openEnded === true,
    },
    Date.now(),
  )
  if (!verdict.ok) return refuse(verdict.refusal)

  // The account must exist and must be one a grant means something for. An accountant already has
  // the portal free without limits (decidePlan step 1 returns before it ever reads a grant), so a
  // row there is a promise that changes nothing — and the operator would have no way to find that
  // out except by asking the customer why nothing happened.
  const { data: target, error: targetErr } = await pipeline
    .from('profiles')
    .select('id, role')
    .eq('id', targetId)
    .maybeSingle()
  if (targetErr) return refuse('read-failed', 500)
  if (!target) return refuse('account-unknown', 404)
  if (target.role === 'accountant') {
    return refuse('account-is-accountant')
  }

  const { data: created, error: insErr } = await pipeline
    .from('plan_grants')
    .insert({
      user_id: targetId,
      plan: verdict.plan,
      starts_at: new Date().toISOString(),
      expires_at: verdict.expiresAt,
      reason: verdict.reason,
      created_by: actor,
    })
    .select('id')
    .maybeSingle()
  if (insErr) return refuse('write-failed', 500)

  await logAuditAction({
    userId: actor,
    action: 'control.grant_created',
    entityType: 'plan_grant',
    entityId: created?.id ?? targetId,
    newValue: {
      user_id: targetId,
      plan: verdict.plan,
      expires_at: verdict.expiresAt,
      open_ended: verdict.expiresAt === null,
      reason: verdict.reason,
    },
    ipAddress: ip,
  })
  return NextResponse.json({ ok: true, id: created?.id ?? null })
}
