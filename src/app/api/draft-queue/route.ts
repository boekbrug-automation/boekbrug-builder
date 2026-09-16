// src/app/api/draft-queue/route.ts
// [BOEK-030] Draft Queue — server-side CRUD + AI compose + Resend send — June 2026
//
// Owns (BOEK-030): this file + src/components/draft-queue/DraftQueue.tsx
//
// Data model (agreed with Tech Lead):
//   ONE row per (accountant_id, client_id). `items` = that client's DraftItem[] only.
//   Requires migration: UNIQUE (accountant_id, client_id)  → enables INSERT + catch 23505.
//
// RLS (verified): draft_queue policies are all `accountant_id = auth.uid()`
//   → session client only, set accountant_id = user.id on insert. No service_role.
//
// Linkage guard: every write/read for a client verifies accountant↔client via
//   accountant_clients (same pattern as accountant.repository.ts). Prevents queues
//   for unlinked profiles and re-derives the client email server-side (no spoofing).

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { composeDraftEmail } from '@/lib/ai'
import { sendDraftQueueEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────
// Shared type — single source of truth for DraftQueue.tsx
// ─────────────────────────────────────────────────────────

export type DraftItem = {
  id: string                      // server-generated uuid
  description: string             // the visible line
  source: 'manual' | 'not_found'  // how it entered the queue
  invoice_id?: string             // set when source = 'not_found' from an invoice
  amount?: number
  date?: string                   // ISO
  created_at: string              // ISO — server-generated
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function asItems(raw: unknown): DraftItem[] {
  if (Array.isArray(raw)) return raw as DraftItem[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as DraftItem[]) : []
    } catch {
      return []
    }
  }
  return []
}

interface LinkedClient {
  id: string
  full_name: string | null
  company_name: string | null
  email: string | null
}

/**
 * Verifies the accountant↔client link and returns the client profile.
 * Uses the session client + accountant_clients join (same as BOEK-028 repository),
 * so it both enforces linkage and yields the authoritative email server-side.
 */
async function resolveLinkedClient(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  accountantId: string,
  clientId: string
): Promise<LinkedClient | null> {
  const { data } = await supabase
    .from('accountant_clients')
    .select('profiles!zzper_id ( id, full_name, company_name, email )')
    .eq('accountant_id', accountantId)
    .eq('zzper_id', clientId)
    .maybeSingle()

  // Supabase types the joined relation loosely (and the client may be untyped) —
  // normalize to a single object via a cast that compiles in both cases.
  const rel = (data as unknown as { profiles?: LinkedClient | LinkedClient[] } | null)?.profiles
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

function clientLabel(c: LinkedClient): string {
  return c.company_name || c.full_name || 'Klant'
}

async function accountantLabel(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, company_name')
    .eq('id', userId)
    .single()
  return data?.company_name || data?.full_name || 'Uw boekhouder'
}

// ─────────────────────────────────────────────────────────
// GET — list all queues for this accountant
//   → { queues: { client_id: string; items: DraftItem[] }[] }
// ─────────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('draft_queue')
      .select('client_id, items, updated_at')
      .eq('accountant_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Ophalen mislukt' }, { status: 500 })

    const queues = (data ?? []).map(row => ({
      client_id: row.client_id as string,
      items: asItems(row.items),
    }))

    return NextResponse.json({ queues })
  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────
// POST — three actions:
//   default / { item } : add one item to a client's queue
//     body: { client_id, item: { description, source?, invoice_id?, amount?, date? } }
//     (This is the contract called by the "Not Found" trigger in B.016 / B.028.)
//   { action: 'compose' } : AI-compose the Dutch email (preview)
//     body: { client_id }  → { subject, body }
//   { action: 'send' }    : send the (reviewed) email via Resend, then auto-clear
//     body: { client_id, subject, body }  → { success, cleared }
// ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 })
    }

    const action: string = body.action ?? 'add'
    const clientId: string | undefined = body.client_id
    if (!clientId) {
      return NextResponse.json({ error: 'client_id ontbreekt' }, { status: 400 })
    }

    // Linkage guard (all actions operate on a linked client).
    const client = await resolveLinkedClient(supabase, user.id, clientId)
    if (!client) {
      return NextResponse.json({ error: 'Klant niet gekoppeld' }, { status: 403 })
    }

    // ── ADD ────────────────────────────────────────────────
    if (action === 'add') {
      const raw = body.item ?? {}
      const description = String(raw.description ?? '').trim()
      if (!description) {
        return NextResponse.json({ error: 'Beschrijving ontbreekt' }, { status: 400 })
      }

      const item: DraftItem = {
        id: crypto.randomUUID(),
        description,
        source: raw.source === 'not_found' ? 'not_found' : 'manual',
        ...(raw.invoice_id ? { invoice_id: String(raw.invoice_id) } : {}),
        ...(typeof raw.amount === 'number' ? { amount: raw.amount } : {}),
        ...(raw.date ? { date: String(raw.date) } : {}),
        created_at: new Date().toISOString(),
      }

      // INSERT new row; if it already exists (UNIQUE accountant_id+client_id) → append.
      const { error: insErr } = await supabase
        .from('draft_queue')
        .insert({ accountant_id: user.id, client_id: clientId, items: [item] })

      if (insErr) {
        if (insErr.code === '23505') {
          const { data: row } = await supabase
            .from('draft_queue')
            .select('id, items')
            .eq('accountant_id', user.id)
            .eq('client_id', clientId)
            .single()
          if (!row) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })

          const items = [...asItems(row.items), item]
          const { error: updErr } = await supabase
            .from('draft_queue')
            .update({ items, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          if (updErr) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })

          return NextResponse.json({ client_id: clientId, items })
        }
        return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
      }

      return NextResponse.json({ client_id: clientId, items: [item] })
    }

    // ── COMPOSE (AI, server-side — real Claude call, no client-side key) ──
    if (action === 'compose') {
      const { data: row } = await supabase
        .from('draft_queue')
        .select('items')
        .eq('accountant_id', user.id)
        .eq('client_id', clientId)
        .maybeSingle()

      const items = asItems(row?.items)
      if (items.length === 0) {
        return NextResponse.json({ error: 'Geen openstaande punten' }, { status: 400 })
      }

      // [COST] Per-user ceiling — this action runs an AI text call (composeDraftEmail).
      const rl = await checkRateLimit({ userId: user.id, endpoint: '/api/draft-queue', ...RATE_LIMITS.AI_TRANSLATE })
      if (!rl.allowed) return rateLimitResponse(rl)

      const accountantName = await accountantLabel(supabase, user.id)
      const result = await composeDraftEmail(
        user.id,
        accountantName,
        clientLabel(client),
        items.map(i => i.description)
      )
      return NextResponse.json(result) // { subject, body } — composeDraftEmail has its own fallback
    }

    // ── SEND (Resend) ───────────────────────────────────────
    if (action === 'send') {
      const subject = String(body.subject ?? '').trim()
      const emailBody = String(body.body ?? '').trim()
      if (!subject || !emailBody) {
        return NextResponse.json({ error: 'Onderwerp of inhoud ontbreekt' }, { status: 400 })
      }
      if (!client.email) {
        return NextResponse.json({ error: 'Klant heeft geen e-mailadres' }, { status: 400 })
      }

      const accountantName = await accountantLabel(supabase, user.id)
      try {
        await sendDraftQueueEmail({
          toEmail: client.email,
          clientName: clientLabel(client),
          accountantName,
          subject,
          body: emailBody,
        })
      } catch {
        return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 502 })
      }

      // Auto-clear AFTER a confirmed successful send (Tech Lead decision).
      // Best-effort cleanup: if the delete fails, the email still went out, so we
      // report cleared=false instead of claiming a wipe that didn't happen.
      const { error: delErr } = await supabase
        .from('draft_queue')
        .delete()
        .eq('accountant_id', user.id)
        .eq('client_id', clientId)

      return NextResponse.json({ success: true, cleared: !delErr })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────
// PATCH — replace the full items array for a client's queue
//   (used to remove a single item: client sends the new array)
//   body: { client_id, items: DraftItem[] }
// ─────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const clientId: string | undefined = body?.client_id
    if (!clientId || !Array.isArray(body?.items)) {
      return NextResponse.json({ error: 'Ongeldige aanvraag' }, { status: 400 })
    }

    const client = await resolveLinkedClient(supabase, user.id, clientId)
    if (!client) return NextResponse.json({ error: 'Klant niet gekoppeld' }, { status: 403 })

    const items = body.items as DraftItem[]

    // Upsert-by-hand: update if row exists, else insert (respects UNIQUE constraint).
    const { data: row } = await supabase
      .from('draft_queue')
      .select('id')
      .eq('accountant_id', user.id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (row) {
      const { error } = await supabase
        .from('draft_queue')
        .update({ items, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
    } else {
      const { error } = await supabase
        .from('draft_queue')
        .insert({ accountant_id: user.id, client_id: clientId, items })
      if (error && error.code !== '23505') {
        return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
      }
    }

    return NextResponse.json({ client_id: clientId, items })
  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────
// DELETE — clear (delete) a single client's queue  ("Annuleren")
//   ?client_id=...   → removes only that client's row (fixes the clear-all bug)
// ─────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) return NextResponse.json({ error: 'client_id ontbreekt' }, { status: 400 })

    const { error } = await supabase
      .from('draft_queue')
      .delete()
      .eq('accountant_id', user.id)
      .eq('client_id', clientId)

    if (error) return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}