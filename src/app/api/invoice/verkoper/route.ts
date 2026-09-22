// src/app/api/invoice/verkoper/route.ts
// [VERKOPER-COMPLEET] The four seller facts an invoice cannot be issued without — asked for at the
// send button, not at the door.
//
// GET  → { status: 'compleet' } | { status: 'onvolledig', missing: [...] }
// POST → saves ONLY the fields that are genuinely missing, then answers the same shape.
//
// ── WHY THE SCREEN ASKS THE SERVER INSTEAD OF LOOKING ITSELF ─────────────────────────────────
//
// The invoice screen already has the profile in hand, so "just check it in the browser" is the
// obvious move. It is wrong for three separate reasons, and each one is a real case:
//
//   1. A SALES MEMBER is not the seller. Their session reads THEIR profile row, never their
//      employer's — that is the whole [ACTING-FOR] design. A browser-side check would show a
//      member a form asking for their employer's BTW-id, and saving it would write it onto the
//      member's own row. Here the request is refused outright (requireOwner) and the screen falls
//      back to the send door, which resolves the real owner via service_role.
//   2. A FAILED READ is not an empty profile. The browser's `.single()` answers null for both,
//      and that null is what would decide whether an owner is shown a setup form. Classified here
//      instead, once ([PROFILE-READ]).
//   3. TWO DEFINITIONS DRIFT. The send door refuses on its own rule; if this screen had a second
//      copy, the day they disagree is the day a first invoice cannot be sent and the screen cannot
//      say why. Both read seller-completeness.ts.
//
// ── AND IT IS NOT A SECOND AUTHORITY ─────────────────────────────────────────────────────────
//
// Nothing here lets an invoice out. /api/invoice/send performs exactly the same check again, on
// its own read, and refuses on its own. This route only decides what to ASK, and saves the answer
// through the profile persistence that already exists — no second store, no second validator.

import { NextRequest, NextResponse } from 'next/server'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { requireOwner } from '@/lib/owner-only'
import { classifyProfileRead } from '@/lib/profile-read'
import {
  missingSellerFields,
  SELLER_FIELD_ORDER,
  type SellerField,
  type SellerFacts,
} from '@/lib/seller-completeness'
import {
  validateBtw, validateKvk, normalizeBtw, normalizeKvk,
} from '@/lib/validation'

export const dynamic = 'force-dynamic'

/** The columns this decision reads. Nothing else on the profile is touched, read or written. */
const SELLER_COLUMNS = 'btw_number, kvk_number, address, company_name, full_name'

// [TAAL-SERVER] Dutch sentences inside an English file: these are read by the owner, not by a
// developer. They follow the same rule as every other route's error text.
const ONLEESBAAR =
  'We konden je bedrijfsgegevens nu niet lezen. Er is niets gewijzigd — probeer het zo meteen opnieuw.'
const OPSLAAN_MISLUKT =
  'Opslaan is niet gelukt. Je gegevens staan nog op het scherm — probeer het opnieuw.'

type SellerAnswer =
  | { ok: true; status: 'compleet' }
  | { ok: true; status: 'onvolledig'; missing: SellerField[] }

function answerFor(facts: SellerFacts | null): SellerAnswer {
  const missing = missingSellerFields(facts)
  return missing.length === 0 ? { ok: true, status: 'compleet' } : { ok: true, status: 'onvolledig', missing }
}

/**
 * Read the seller's own four facts, or the response to send instead.
 *
 * `missing` (the read succeeded and there is no profile row) answers with `null` facts, which
 * `missingSellerFields` correctly reports as all four missing — a brand-new account with no row
 * genuinely has nothing on file. `failed` never answers with facts at all.
 */
async function readSellerFacts(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<{ facts: SellerFacts | null; hasRow: boolean } | NextResponse> {
  const read = classifyProfileRead(
    await supabase.from('profiles').select(SELLER_COLUMNS).eq('id', userId).maybeSingle(),
  )
  if (read.kind === 'failed') {
    console.error('[VERKOPER-COMPLEET] profielleesfout — niets gevraagd, niets geschreven', {
      userId, code: read.code, message: read.message,
    })
    return NextResponse.json({ ok: false, error: ONLEESBAAR, code: 'profiel_onleesbaar' }, { status: 503 })
  }
  if (read.kind === 'missing') return { facts: null, hasRow: false }
  return { facts: read.row as SellerFacts, hasRow: true }
}

export async function GET() {
  // [ACTING-FOR] Owner only. A member is not refused a SEND — the send door resolves their
  // employer and checks that profile — they are refused this QUESTION, because the answer would
  // be about the wrong person's profile and the form would write to the wrong row.
  const w = await requireOwner('Je bedrijfsgegevens aanvullen')
  if (w.response) return w.response

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const read = await readSellerFacts(supabase, user.id)
  if (read instanceof NextResponse) return read

  return NextResponse.json(answerFor(read.facts))
}

/** One supplied field: trimmed, normalised the way the profile stores it, and validated. */
function cleanField(field: SellerField, raw: unknown): { value: string } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) return { error: 'Dit veld is verplicht om een factuur te mogen versturen.' }

  if (field === 'kvk_number') {
    const v = normalizeKvk(text)
    const r = validateKvk(v)
    return r.valid ? { value: v } : { error: r.error ?? 'Ongeldig KVK-nummer.' }
  }
  if (field === 'btw_number') {
    const v = normalizeBtw(text)
    const r = validateBtw(v)
    return r.valid ? { value: v } : { error: r.error ?? 'Ongeldig BTW-nummer.' }
  }
  // company_name and address are free text: present is the whole requirement, exactly as the send
  // door has always asked it.
  return { value: text }
}

export async function POST(request: NextRequest) {
  const w = await requireOwner('Je bedrijfsgegevens aanvullen')
  if (w.response) return w.response

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Ongeldig verzoek' }, { status: 400 })
  }

  // [PROFILE-READ] Re-read before writing, and refuse on a failed read WITHOUT writing. A save
  // built on "we could not see what is there" is how a saved BTW-id gets overwritten by whatever
  // the browser happened to be carrying.
  const read = await readSellerFacts(supabase, user.id)
  if (read instanceof NextResponse) return read

  const missing = missingSellerFields(read.facts)
  if (missing.length === 0) {
    // Nothing to do — the owner filled it in elsewhere while this screen was open. Not an error:
    // the send that follows is exactly what they wanted.
    return NextResponse.json({ ok: true, status: 'compleet' })
  }

  // ONLY the missing fields are writable. This is the precedence rule made structural rather than
  // trusted: a request naming `btw_number` for an owner who already has one cannot reach the
  // update at all, so no prefill — handoff or otherwise — can overwrite a saved value.
  // Typed to the four columns rather than Record<string, string>: the generated client refuses an
  // open index signature, and that refusal is worth keeping — it is what stops a stray key from
  // this body reaching an UPDATE on `profiles`.
  const patch: { btw_number?: string; kvk_number?: string; address?: string; company_name?: string } = {}
  const problems: Record<string, string> = {}
  for (const field of SELLER_FIELD_ORDER) {
    if (!missing.includes(field)) continue
    const cleaned = cleanField(field, (body as Record<string, unknown>)[field])
    if ('error' in cleaned) { problems[field] = cleaned.error; continue }
    patch[field] = cleaned.value
  }

  // All or nothing. A partial write would leave the owner on a form that has forgotten half of
  // what they typed, and the send would refuse anyway.
  if (Object.keys(problems).length > 0) {
    return NextResponse.json({ ok: false, problems, missing }, { status: 400 })
  }

  // [EEN-OPSLAG] The same persistence the settings screen uses: the owner's own row, under RLS
  // (profiles_update_own). No service_role, no second table, no upsert — a profile row that does
  // not exist is an account problem, and inventing one here would hide it.
  const { data: written, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id')

  if (error) {
    console.error('[VERKOPER-COMPLEET] opslaan mislukt', { userId: user.id, code: error.code, message: error.message })
    return NextResponse.json({ ok: false, error: OPSLAAN_MISLUKT, code: 'opslaan_mislukt' }, { status: 503 })
  }
  if (!written || written.length === 0) {
    // An UPDATE that matched nothing is not a success. Without this it returns cleanly, the screen
    // calls SEND, and the send door refuses with the very fields the owner just typed.
    console.error('[VERKOPER-COMPLEET] opslaan raakte geen rij', { userId: user.id, hadRow: read.hasRow })
    return NextResponse.json({ ok: false, error: OPSLAAN_MISLUKT, code: 'opslaan_mislukt' }, { status: 503 })
  }

  // Answer from what is now on file, read back through the same rule — never from what we sent.
  const after = await readSellerFacts(supabase, user.id)
  if (after instanceof NextResponse) return after
  // `saved` is what LANDED, normalised (a btw-id upper-cased, whitespace gone). The screen shows
  // the seller block back to the owner straight away, and it must show what is stored rather than
  // what was typed — otherwise the card reads "nl123456789b01" until the next page load, and the
  // owner has no way to tell which of the two the invoice will carry.
  return NextResponse.json({ ...answerFor(after.facts), saved: patch })
}
