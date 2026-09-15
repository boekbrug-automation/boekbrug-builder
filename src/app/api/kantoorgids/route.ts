// src/app/api/kantoorgids/route.ts
// [KANTOORGIDS] The office's own listing: read it, write it, remove it.
//
// GET    → { entry, published } — the caller's OWN row, published or not, so the form can load a
//          draft it has not turned on yet. The PUBLIC list is not here: /boekhouders reads it
//          straight from the table under the published-only policy, which is one less place that
//          can accidentally return an unpublished row.
// PUT    → writes the caller's own row. { problems: [] } and nothing written when it does not pass.
// DELETE → removes it. Turning it off is not enough for an office that wants out.
//
// ── AUTHORIZATION ──
// Accountant role required on all three. The RLS policies already pin every statement to
// accountant_id = auth.uid(), so this route cannot write someone else's listing even if it tried;
// the role test is here so an owner who guesses the URL gets an answer about the door rather than
// an empty listing that looks like a bug.
//
// ── [DEPLOY-SAFE] ──
// This route ships before the migration is applied by hand. A missing table is 503 with a sentence
// that says what is missing, never an empty listing — an office that reads "je staat niet in de
// gids" when the table is not there concludes it was removed.

import { NextRequest, NextResponse } from 'next/server'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { entryProblems, normaliseEntry, type DirectoryEntry } from '@/lib/accountant-directory'

export const dynamic = 'force-dynamic'

/** Postgres says "relation does not exist" with 42P01; PostgREST reports it as PGRST205. */
function isMissingTable(code: string | undefined, message: string | undefined): boolean {
  if (code === '42P01' || code === 'PGRST205') return true
  return /relation .*accountant_directory.* does not exist|could not find the table/i.test(message ?? '')
}

const GEEN_TABEL = 'De kantoorgids staat nog niet klaar. Probeer het later opnieuw.'

type Row = {
  accountant_id: string
  office_name: string
  city: string
  specialisms: string[] | null
  accepting_clients: boolean
  contact_email: string
  website: string | null
  published: boolean
}

function toEntry(row: Row): DirectoryEntry {
  return normaliseEntry({
    accountantId: row.accountant_id,
    officeName: row.office_name,
    city: row.city,
    specialisms: row.specialisms ?? [],
    acceptingClients: row.accepting_clients,
    contactEmail: row.contact_email,
    website: row.website,
  })
}

/** Signed in, and an accountant. Returns the user id, or the response to send instead. */
async function requireAccountant(): Promise<
  { id: string; supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> } | NextResponse
> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'accountant') {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  }
  return { id: user.id, supabase }
}

export async function GET() {
  const auth = await requireAccountant()
  if (auth instanceof NextResponse) return auth

  const { data, error } = await auth.supabase
    .from('accountant_directory')
    .select('accountant_id, office_name, city, specialisms, accepting_clients, contact_email, website, published')
    .eq('accountant_id', auth.id)
    .maybeSingle()

  if (error) {
    if (isMissingTable((error as { code?: string }).code, error.message)) {
      return NextResponse.json({ error: GEEN_TABEL }, { status: 503 })
    }
    return NextResponse.json({ error: 'Je vermelding is niet te lezen.' }, { status: 503 })
  }

  // No row is not an error and not an empty page: it is an office that has not filled it in.
  if (!data) return NextResponse.json({ ok: true, entry: null, published: false })
  return NextResponse.json({ ok: true, entry: toEntry(data as Row), published: (data as Row).published })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAccountant()
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  }

  const wantsPublished = (body as { published?: unknown }).published === true
  const entry = normaliseEntry({
    accountantId: auth.id,
    officeName: (body as { officeName?: string }).officeName,
    city: (body as { city?: string }).city,
    specialisms: Array.isArray((body as { specialisms?: unknown }).specialisms)
      ? ((body as { specialisms: unknown[] }).specialisms.filter((s) => typeof s === 'string') as string[])
      : [],
    acceptingClients: (body as { acceptingClients?: unknown }).acceptingClients === true,
    contactEmail: (body as { contactEmail?: string }).contactEmail,
    website: (body as { website?: string }).website,
  })

  // A DRAFT may be as incomplete as it likes — that is what a draft is. Only publishing is gated,
  // and the same rule stands in the database, where a half listing cannot be published either.
  const problems = wantsPublished ? entryProblems(entry) : []
  if (problems.length > 0) {
    return NextResponse.json({ ok: false, problems }, { status: 400 })
  }

  const { error } = await auth.supabase.from('accountant_directory').upsert(
    {
      accountant_id: auth.id,
      office_name: entry.officeName,
      city: entry.city,
      specialisms: [...entry.specialisms],
      accepting_clients: entry.acceptingClients,
      contact_email: entry.contactEmail,
      website: entry.website,
      published: wantsPublished,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'accountant_id' },
  )

  if (error) {
    if (isMissingTable((error as { code?: string }).code, error.message)) {
      return NextResponse.json({ error: GEEN_TABEL }, { status: 503 })
    }
    console.error('[KANTOORGIDS] opslaan mislukt', { error: error.message })
    return NextResponse.json({ error: 'Opslaan is niet gelukt.' }, { status: 503 })
  }

  return NextResponse.json({ ok: true, entry, published: wantsPublished, problems: [] })
}

export async function DELETE() {
  const auth = await requireAccountant()
  if (auth instanceof NextResponse) return auth

  const { error } = await auth.supabase
    .from('accountant_directory')
    .delete()
    .eq('accountant_id', auth.id)

  if (error) {
    if (isMissingTable((error as { code?: string }).code, error.message)) {
      return NextResponse.json({ error: GEEN_TABEL }, { status: 503 })
    }
    return NextResponse.json({ error: 'Verwijderen is niet gelukt.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, entry: null, published: false })
}
