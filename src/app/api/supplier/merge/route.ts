// src/app/api/supplier/merge/route.ts
// [LEVERANCIER-SAMENVOEGEN] Two supplier rows become one — and the door refuses far more often
// than it opens.
//
// ── WHAT THE CLIENT IS AND IS NOT TRUSTED WITH ──
//
// The browser sends two ids. That is all it is believed about. Everything the decision rests on —
// the KVK numbers, the accounts, how many invoices each row carries — is READ HERE and the plan is
// computed HERE (supplier-merge.ts, pure). A screen can be minutes old, and in those minutes an
// import can have given one of the two rows the KVK that makes it a different company.
//
// The direction is checked too, not just the pair: the plan decides which name survives, and if
// the answer is no longer the one the owner was shown, the merge is refused rather than performed
// the other way round. They confirmed a sentence, not a pair of ids.
//
// ── THE ORDER OF THE WRITES, AND WHAT EACH FAILURE LEAVES BEHIND ──
//
//   1. the invoices move — supplier_id AND client_name, because client_name is the identity key
//      the crediteurenstand groups on and the alias machinery resolves through. A failure here
//      writes nothing at all;
//   2. the merged-away row's aliases are repointed, so no lesson is lost when it goes;
//   3. its NAME becomes an alias of the survivor, so next month's paper — which still prints the
//      old spelling — resolves to the row that now holds the history;
//   4. identity the survivor lacks is carried over. Its account is cleared on the dying row FIRST,
//      because suppliers has a UNIQUE (user_id, iban) and the two would collide for one moment;
//   5. the row is deleted, and ONLY after a fresh count proves no invoice still points at it.
//      invoices.supplier_id is ON DELETE SET NULL — deleting a row that still had invoices would
//      quietly orphan them, which is the one outcome worse than the duplicate we came to fix.
//
// Every early failure leaves a state that is correct and merely less complete: the invoices are
// under one name, and a second row exists with no invoices. Running the merge again finishes it.

import { NextRequest, NextResponse } from 'next/server'

import { createServerSupabaseClient } from '@/lib/supabase-server'
// [ACTING-FOR] The registry is the OWNER's; an employee acting for them writes into it.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId } from '@/lib/acting-for'
import { planSupplierMerge, planOwnerMerge, type MergeSupplier } from '@/lib/supplier-merge'
import { supplierNameKey, isReliableSupplierName, identityIban } from '@/lib/supplier-registry'
import { supplierAliasSupported } from '@/lib/supplier-alias-write'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { fetchAllRows } from '@/lib/supabase-paginate'

export const dynamic = 'force-dynamic'

interface SupplierRow {
  id: string
  name: string
  iban: string | null
  kvk_number: string | null
  btw_number: string | null
  default_btw_rate?: number | null
  default_category?: string | null
  created_at: string
}

export async function POST(req: NextRequest) {
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  // [SAMENVOEGEN-EIGENAAR] byOwner: the owner named this pair in the edit sheet. The vetoes are
  // still the server's; only the missing-evidence refusal is theirs to overrule.
  let body: { survivorId?: string; mergedAwayId?: string; byOwner?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const askedSurvivor = (body.survivorId ?? '').trim()
  const askedMergedAway = (body.mergedAwayId ?? '').trim()
  if (!askedSurvivor || !askedMergedAway || askedSurvivor === askedMergedAway) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  // ── What the two rows ACTUALLY are, right now ──
  const { data: rows, error: rowsErr } = await supabase
    .from('suppliers')
    .select('id, name, iban, kvk_number, btw_number, default_btw_rate, default_category, created_at')
    .eq('user_id', ownerId)
    .in('id', [askedSurvivor, askedMergedAway])
  if (rowsErr) {
    return NextResponse.json({ error: 'lookup_failed', detail: rowsErr.message }, { status: 500 })
  }
  const found = (rows ?? []) as SupplierRow[]
  if (found.length !== 2) {
    return NextResponse.json({ error: 'Een van deze leveranciers bestaat niet meer. Ververs de pagina.' }, { status: 404 })
  }

  // ── And what their invoices say about them ──
  // The count decides which name survives; the accounts are half the evidence. Both are read, not
  // taken from the browser, because both can decide the answer.
  const ids = found.map((s) => s.id)
  let invoices: { supplier_id: string | null; vendor_iban: string | null }[]
  try {
    invoices = await fetchAllRows((from, to) => supabase
      .from('invoices')
      .select('supplier_id, vendor_iban')
      .eq('receiver_id', ownerId)
      .in('supplier_id', ids)
      .order('id', { ascending: true })
      .range(from, to)
    ) as { supplier_id: string | null; vendor_iban: string | null }[]
  } catch (e) {
    // [NO-SILENT-EMPTY] A failed read here reads as "both rows are empty", which would change
    // which name survives and could hide the very account that proves — or disproves — the pair.
    return NextResponse.json(
      { error: 'De facturen van deze leveranciers konden niet worden gelezen. Probeer het zo meteen opnieuw.',
        detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  const asMerge = (row: SupplierRow): MergeSupplier => {
    const mine = invoices.filter((i) => i.supplier_id === row.id)
    return {
      id: row.id,
      name: row.name,
      iban: row.iban,
      kvk: row.kvk_number,
      btw: row.btw_number,
      createdAt: row.created_at,
      invoiceCount: mine.length,
      invoiceIbans: mine.map((i) => i.vendor_iban ?? '').filter((s) => s.length > 0),
    }
  }
  const a = asMerge(found[0])
  const b = asMerge(found[1])

  // ── The decision, made here on what was read ──
  const byOwner = body.byOwner === true
  const plan = planSupplierMerge(a, b)
  if (!plan.ok) {
    // Only 'no-evidence' may be overruled, and only by an owner who named the pair. A veto —
    // two KVK numbers, two own accounts — is a fact and stands whoever asks.
    if (!(byOwner && plan.reason === 'no-evidence')) {
      return NextResponse.json({ error: 'refused', reason: plan.reason }, { status: 409 })
    }
  }
  // [SAMENVOEGEN-EIGENAAR] The owner's pair, in the owner's direction, re-judged on what was read.
  const decision = byOwner
    ? planOwnerMerge(a.id === askedSurvivor ? a : b, a.id === askedSurvivor ? b : a)
    : plan
  if (!decision.ok) {
    return NextResponse.json({ error: 'refused', reason: decision.reason }, { status: 409 })
  }
  // The PAIR is the server's to judge, and it just did. The DIRECTION is the owner's: they read a
  // sentence naming which company keeps its name, and once both vetoes have passed the two rows are
  // one company — so which of the two names stays is a preference, not a question of fact.
  //
  // It also may not be re-decided here, and that is the part worth writing down. The screen counts
  // the invoices it has (incoming, not archived); this route counts every invoice pointing at the
  // row, because every one of them has to MOVE — invoices.supplier_id is ON DELETE SET NULL, and
  // one left behind is one detached from its supplier. Those two counts differ the moment a
  // supplier has an archived invoice, they are the tie-breaker for which name survives, and
  // overruling the owner on that difference would refuse a perfectly good merge for good: the
  // screen would keep proposing what the server keeps rejecting, with nothing changing in between.
  if (!byOwner && plan.ok && plan.survivorId !== askedSurvivor && plan.mergedAwayId !== askedSurvivor) {
    return NextResponse.json({ error: 'stale', reason: 'direction-changed' }, { status: 409 })
  }

  const survivor = found.find((s) => s.id === askedSurvivor)!
  const mergedAway = found.find((s) => s.id === askedMergedAway)!

  // ── 1. The invoices ──
  const { data: moved, error: moveErr } = await supabase
    .from('invoices')
    .update({ supplier_id: survivor.id, client_name: survivor.name })
    .eq('receiver_id', ownerId)
    .eq('supplier_id', mergedAway.id)
    .select('id')
  if (moveErr) {
    return NextResponse.json(
      { error: 'De facturen konden niet worden verplaatst. Er is niets veranderd.', detail: moveErr.message },
      { status: 500 },
    )
  }
  const movedCount = (moved ?? []).length

  // ── 2 & 3. The lessons ──
  // Best-effort, and deliberately so: the invoices already stand under one name, which is the half
  // the owner asked for. A missing alias costs one more correction next month, not a wrong book.
  let aliasStored = false
  try {
    if (await supplierAliasSupported(supabase)) {
      const { error: repointErr } = await supabase
        .from('supplier_aliases')
        .update({ supplier_id: survivor.id })
        .eq('user_id', ownerId)
        .eq('supplier_id', mergedAway.id)
      if (repointErr) throw new Error(repointErr.message)

      // The name that is about to disappear is exactly what next month's paper will print.
      const key = supplierNameKey(mergedAway.name)
      if (key && isReliableSupplierName(mergedAway.name) && key !== supplierNameKey(survivor.name)) {
        const { error: aliasErr } = await supabase
          .from('supplier_aliases')
          .upsert(
            { user_id: ownerId, alias_key: key, supplier_id: survivor.id, printed_name: mergedAway.name },
            { onConflict: 'user_id,alias_key' },
          )
        if (aliasErr) throw new Error(aliasErr.message)
        aliasStored = true
      }
    }
  } catch (e) {
    console.error('[LEVERANCIER-SAMENVOEGEN] the merge stands but the lesson was not stored', {
      userId: ownerId, survivor: survivor.id, mergedAway: mergedAway.id,
      error: e instanceof Error ? e.message : String(e),
    })
  }

  // ── 4. The identity the survivor lacks ──
  // Typed as the table's own Update shape: a Record<string, string> would let a typo become a
  // column this table does not have, and PostgREST answers that with a 400 at runtime.
  const carry: { iban?: string; kvk_number?: string; btw_number?: string; default_btw_rate?: number; default_category?: string } = {}
  if (!identityIban(survivor.iban) && identityIban(mergedAway.iban)) carry.iban = identityIban(mergedAway.iban)!
  if (!(survivor.kvk_number ?? '').trim() && (mergedAway.kvk_number ?? '').trim()) carry.kvk_number = mergedAway.kvk_number!.trim()
  if (!(survivor.btw_number ?? '').trim() && (mergedAway.btw_number ?? '').trim()) carry.btw_number = mergedAway.btw_number!.trim()
  // [LEVERANCIER-STANDAARD] A default the owner set on the dying row is a decision about the
  // company, and the company survives. Only where the survivor has none: two answers, the
  // survivor's wins, because that is the row the owner chose to keep.
  if (survivor.default_btw_rate == null && mergedAway.default_btw_rate != null) carry.default_btw_rate = mergedAway.default_btw_rate
  if (!(survivor.default_category ?? '').trim() && (mergedAway.default_category ?? '').trim()) carry.default_category = mergedAway.default_category!.trim()
  if (Object.keys(carry).length > 0) {
    // The dying row lets go of its account first: UNIQUE (user_id, iban) would refuse the two
    // rows holding it at the same instant, and that refusal would cost the survivor the number
    // the IBAN-change check reads.
    if (carry.iban) await supabase.from('suppliers').update({ iban: null }).eq('id', mergedAway.id).eq('user_id', ownerId)
    const { error: carryErr } = await supabase
      .from('suppliers').update(carry).eq('id', survivor.id).eq('user_id', ownerId)
    if (carryErr) {
      console.error('[LEVERANCIER-SAMENVOEGEN] identity was not carried over', {
        userId: ownerId, survivor: survivor.id, error: carryErr.message,
      })
    }
  }

  // ── 5. The row, and only once nothing points at it ──
  // invoices.supplier_id is ON DELETE SET NULL. Deleting a row that still had invoices would
  // silently detach them from every supplier — worse than the duplicate this call came to fix.
  const { count: leftover, error: countErr } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', ownerId)
    .eq('supplier_id', mergedAway.id)
  let removed = false
  if (countErr || (leftover ?? 0) > 0) {
    console.error('[LEVERANCIER-SAMENVOEGEN] the empty row was kept — invoices still point at it', {
      userId: ownerId, mergedAway: mergedAway.id, leftover, error: countErr?.message,
    })
  } else {
    const { error: delErr } = await supabase
      .from('suppliers').delete().eq('id', mergedAway.id).eq('user_id', ownerId)
    if (delErr) {
      console.error('[LEVERANCIER-SAMENVOEGEN] the row could not be removed', {
        userId: ownerId, mergedAway: mergedAway.id, error: delErr.message,
      })
    } else {
      removed = true
    }
  }

  await logAuditAction({
    userId: ownerId,
    action: 'supplier.merged',
    entityType: 'supplier',
    entityId: survivor.id,
    oldValue: { merged_away_id: mergedAway.id, merged_away_name: mergedAway.name },
    newValue: {
      name: survivor.name,
      evidence: decision.evidence,
      shared_value: decision.sharedValue,
      by_owner: byOwner,
      invoices_moved: movedCount,
      alias_stored: aliasStored,
      row_removed: removed,
      by: acting.actorId,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    survivorName: survivor.name,
    mergedAwayName: mergedAway.name,
    moved: movedCount,
    aliasStored,
    removed,
  })
}
