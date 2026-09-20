// src/app/api/accountant/subject-status/route.ts
// [READINESS-P3] Accountant sets the processing status of a CLIENT DOCUMENT.
//
// This closes the gap that invoices already have (invoices.accountant_status):
// physical documents had NO status column. Statuses live in
// accountant_subject_status (subject_type='document' here — invoices are NOT
// touched by this route).
//
// Honesty model: a status is an ACCOUNTANT ASSERTION about a specific document.
// We never write one without proving (a) the caller can even see the document
// under RLS and (b) the accountant↔client link exists.
//
// Security:
//   1. Caller must be authenticated.
//   2. Document must be readable by the caller (documents_accountant_read only
//      returns shared docs of linked clients) → null = 403.
//   3. Accountant↔client link (accountant_clients) must exist → else 403.
//   4. UPSERT via the ACCOUNTANT SESSION (RLS acc_status_owner_all: accountant_id
//      = auth.uid()) — no service_role needed for the status write itself.
//   5. status==='vraag' → notify the client (service_role, notifications has no
//      authenticated INSERT policy). Best-effort: never fails the status write.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createNotification } from '@/lib/notifications'

const VALID_STATUS = ['te_verwerken', 'in_behandeling', 'verwerkt', 'vraag'] as const
type Status = (typeof VALID_STATUS)[number]

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { subjectId?: string; status?: string; vraagText?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  const { subjectId, vraagText } = body
  const status = body.status as Status | undefined

  if (!subjectId || !status || !VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: 'Ongeldige gegevens' }, { status: 400 })
  }

  // ── (2) Document must be visible to the caller under RLS ──
  // documents_accountant_read only returns it if the doc is shared AND the
  // caller is a linked accountant → a null row means "not allowed" → 403.
  // [#4] Exclude trashed documents — an accountant should not set a status / fire a
  // "vraag" on a file the owner has moved to the trash (matches /brug's trashed=false).
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('user_id, file_name')
    .eq('id', subjectId)
    .eq('trashed', false)
    .single()

  if (docErr || !doc) {
    return NextResponse.json({ error: 'Geen toegang tot dit document' }, { status: 403 })
  }

  // ── (3) Accountant↔client link must exist ──
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('id')
    .eq('accountant_id', user.id)
    .eq('zzper_id', doc.user_id)
    .maybeSingle()

  if (!link) {
    return NextResponse.json({ error: 'Geen toegang tot deze klant' }, { status: 403 })
  }

  // ── (4) Write the status row (accountant session, RLS owner_all) ──
  // Read-then-write (NOT upsert-onConflict): the prod table has no unique index on
  // (accountant_id, subject_type, subject_id) yet — the migration adds it, but
  // until it's applied an onConflict would 42P10. This works regardless; one
  // accountant + one document is a single row in practice.
  const now = new Date().toISOString()
  const row = {
    status,
    verwerkt_at: status === 'verwerkt' ? now : null,
    vraag_text: status === 'vraag' ? (vraagText || null) : null,
    updated_at: now,
  }

  // [VRAAG-SYNC] `status` is read along with the id: whether THIS accountant's question on the
  // document was open decides, below, whether the owner is told it is handled.
  const { data: existing } = await supabase
    .from('accountant_subject_status')
    .select('id, status')
    .eq('accountant_id', user.id)
    .eq('subject_type', 'document')
    .eq('subject_id', subjectId)
    .maybeSingle()

  const { error: writeErr } = existing
    ? await supabase.from('accountant_subject_status').update(row).eq('id', existing.id)
    : await supabase.from('accountant_subject_status').insert({
        accountant_id: user.id,
        subject_type: 'document',
        subject_id: subjectId,
        ...row,
      })

  if (writeErr) {
    console.error('[subject-status] write failed:', writeErr)
    return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  }

  // ── (5) [READINESS-P3 vraag loop] Notify the client on a question ──
  // Best-effort — a notification failure must not undo the saved status.
  if (status === 'vraag') {
    const melding = await createNotification({
      userId: doc.user_id,
      title: 'Vraag van je boekhouder',
      body: vraagText
        ? vraagText.slice(0, 120)
        : 'Je boekhouder heeft een vraag over een document.',
      type: 'status',
      // [BRUG-RETOUR] Wees naar de vraag, niet naar de map. /dashboard/bestanden toonde
      // een bestandenlijst zonder vraag, zonder tekst en zonder antwoordknop — waarna het
      // gesprek naar WhatsApp verhuisde. /dashboard/vragen toont de vraag zelf, het
      // document erbij en één veld om te antwoorden.
      link: '/dashboard/vragen',
    })
    if (!melding.ok) {
      console.error('[subject-status] vraag notification failed:', melding.error)
    }
  }

  // ── (6) [VRAAG-SYNC] …and on a question that just closed ──
  // The invoice side gets this from the database function (invoice-status route); a document
  // question has no counter on the invoice and is closed right here, by this same UPDATE. The
  // owner's "Vraag van je boekhouder" notification would otherwise be the last word about a
  // question that has just left /dashboard/vragen. Best-effort, after the write, like (5).
  if (existing?.status === 'vraag' && status !== 'vraag') {
    const naam = (doc.file_name ?? '').trim()
    const melding = await createNotification({
      userId: doc.user_id,
      title: 'Vraag afgehandeld',
      body: naam
        ? `Je boekhouder heeft de vraag over ${naam.length > 80 ? `${naam.slice(0, 77)}…` : naam} afgehandeld.`
        : 'Je boekhouder heeft de vraag over een document afgehandeld.',
      type: 'status',
      link: '/dashboard/vragen',
    })
    if (!melding.ok) {
      console.error('[subject-status] "vraag afgehandeld" notification failed:', melding.error)
    }
  }

  return NextResponse.json({ ok: true, status })
}
