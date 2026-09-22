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
import {
  PUBLISH_ELIGIBILITY,
  draftProblems,
  entryProblems,
  normaliseEntry,
  type DirectoryEntry,
} from '@/lib/accountant-directory'

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
  languages: string[] | null
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
    languages: row.languages ?? [],
  })
}

/** The one column list, so GET and the shape it promises can never drift apart. */
const COLUMNS =
  'accountant_id, office_name, city, specialisms, accepting_clients, contact_email, website, published, languages'

/**
 * [KANTOORGIDS-BEWIJS] May this office go into the gids at all?
 *
 * Three answers, never two. `accountant_directory_publish_requires_client_link` lets a listing
 * become public only while its owner holds a consented row in accountant_clients, and the DATABASE
 * is the authority on that — this read decides nothing. It exists so the office is told WHY in a
 * sentence, instead of receiving the 42501 that reaches the screen as "Opslaan is niet gelukt."
 *
 * 'unknown' is a state of its own and not a pessimistic 'none'. A failed read means we do not
 * know, and telling an office it has no clients because a query timed out sends it looking for a
 * link it already has. Same rule the public gids follows for its own failed read.
 *
 * The session client on purpose: accountant_clients_select admits exactly the rows that name the
 * caller, so this asks the question under the same RLS the write will face. A service-role read
 * here would answer a question the writer is not actually allowed to ask.
 */
async function publishEligibility(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  accountantId: string,
): Promise<'linked' | 'none' | 'unknown'> {
  const { data, error } = await supabase
    .from('accountant_clients')
    .select('accountant_id')
    .eq('accountant_id', accountantId)
    .limit(1)

  if (error) return 'unknown'
  return (data ?? []).length > 0 ? 'linked' : 'none'
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
    .select(COLUMNS)
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
    languages: Array.isArray((body as { languages?: unknown }).languages)
      ? ((body as { languages: unknown[] }).languages.filter((l) => typeof l === 'string') as string[])
      : [],
  })

  // A DRAFT may be as incomplete as it likes — that is what a draft is. Only publishing is gated,
  // and the same rule stands in the database, where a half listing cannot be published either.
  //
  // [KANTOORGIDS-TAAL] But "incomplete" is not "wrong", and the database draws that line in a
  // different place for languages: accountant_directory_languages_known is NOT conditional on
  // published, so an unknown code in a DRAFT is refused too — with a 23514 that arrives here as a
  // bare 503. draftProblems is the same refusal in a sentence the office can act on.
  const problems = wantsPublished ? entryProblems(entry) : draftProblems(entry)
  if (problems.length > 0) {
    return NextResponse.json({ ok: false, problems }, { status: 400 })
  }

  // [KANTOORGIDS-BEWIJS] Only when PUBLISHING, and only to get the sentence right. The database
  // decides; this asks the same question first so a refusal arrives as Dutch instead of as a
  // 42501 dressed up as "Opslaan is niet gelukt." A draft never reaches here — it is not going
  // public, so eligibility is not its business.
  //
  // 409 and not 5xx: nothing is broken. The request is well formed and the answer is "not yet",
  // which is a state the office can change. It travels in `problems` because that is the field
  // the panel already renders next to the form, where a fixable refusal belongs.
  if (wantsPublished) {
    const eligibility = await publishEligibility(auth.supabase, auth.id)
    if (eligibility === 'unknown') {
      return NextResponse.json({ error: PUBLISH_ELIGIBILITY.unknown }, { status: 503 })
    }
    if (eligibility === 'none') {
      return NextResponse.json(
        { ok: false, problems: [PUBLISH_ELIGIBILITY.needsClient] },
        { status: 409 },
      )
    }
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
      // [KANTOORGIDS-TAAL] Sent on EVERY write, including a draft. Leaving it out of the payload
      // was the whole defect: the column then took its '{}' default on insert and
      // accountant_directory_published_has_language refused every publish the product ever made.
      languages: [...entry.languages],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'accountant_id' },
  )

  if (error) {
    if (isMissingTable((error as { code?: string }).code, error.message)) {
      return NextResponse.json({ error: GEEN_TABEL }, { status: 503 })
    }
    // [KANTOORGIDS-BEWIJS] The race, answered in the same words as the preflight.
    //
    // The eligibility read above and this write are two statements, so the link can be deleted
    // between them — either party may unlink at any moment. When that happens the policy refuses
    // with 42501, and the DATABASE is right: publication must not survive the evidence
    // disappearing. That is the whole reason the preflight is advisory and this rule is not.
    //
    // What must not survive is the WORDING. Falling through to "Opslaan is niet gelukt." here
    // would reintroduce the unexplained refusal one code path over from where it was just fixed —
    // and it would be worse, because it appears only in the narrow window where the office also
    // just lost a client and has every reason to be confused already.
    if (wantsPublished && (error as { code?: string }).code === '42501') {
      return NextResponse.json(
        { ok: false, problems: [PUBLISH_ELIGIBILITY.needsClient] },
        { status: 409 },
      )
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
