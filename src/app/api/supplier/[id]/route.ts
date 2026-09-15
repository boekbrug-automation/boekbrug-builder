// src/app/api/supplier/[id]/route.ts
// [LEVERANCIER-BEWERKEN] The owner edits a supplier's master record, for the future.
//
// ── WHAT THIS DOOR IS FOR ──
//
// /dashboard/leveranciers showed what the owner owes per supplier and offered nothing to correct
// who those suppliers ARE. The one editor the app had hung off an incoming invoice (the pin modal),
// which is right when a paper was misread and wrong for the ordinary case: "my wholesaler moved
// to a new bank" or "their KVK number is missing" has no invoice to start from. This route edits
// the row itself — the record the registry resolves next month's invoice on.
//
// ── THE RULES IT ENFORCES, AND WHERE THEY COME FROM ──
//
//   · The same validation as the pin route (supplier-pin.ts): a value that would poison a gate
//     is refused with the field named, and nothing is written.
//   · Forward only. Invoices already in the books keep their own printed IBAN and btw number
//     (art. 52 AWR keeps the document as it was). Only the display name follows the rename, on
//     the invoices LINKED to this supplier by id — the pin route's rule, for the same reason.
//   · A replaced IBAN is kept (supplier_iban_history), so a later invoice printing the old
//     number still resolves to this supplier and the IBAN-change gate can warn on it instead of
//     the registry founding a second row in silence.
//   · Every change lands in the audit trail as supplier.updated with old beside new.
//   · A number another supplier already carries is answered as "merge them", with that
//     supplier's name, rather than as a bare unique-violation.
//
// [TAAL] Every sentence comes from the catalogue in the language of whoever is typing.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [ACTING-FOR] The registry is keyed on the OWNER; an employee acting for them edits the owner's.
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId } from '@/lib/acting-for'
import { planSupplierEdit, duplicateField, supplierEditTrail } from '@/lib/supplier-edit'
import { SUPPLIER_PIN_REFUSAL_KEY } from '@/lib/supplier-pin'
import { serverTranslator } from '@/lib/i18n/server'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * [LEVERANCIER-VERWIJDEREN] The owner removes a supplier row: a company that no longer exists,
 * or a second row the reader founded for one it already had.
 *
 * What goes and what stays: the ROW goes, with its aliases and its IBAN history (both cascade).
 * The invoices stay exactly as they are — art. 52 AWR keeps them — and only lose the link
 * (invoices.supplier_id is ON DELETE SET NULL); they keep the printed name, so the creditors
 * screen still lists the company and offers to add it again. The count of what is detached is
 * read BEFORE the delete and returned, because that number is what the owner confirmed against.
 *
 * A duplicate that shares a KVK or an IBAN with its twin is better merged (the merge door keeps
 * the invoices linked); the sheet says so before this is pressed.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await serverTranslator()
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: t('lev.fout.nietIngelogd'), code: 'unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: current, error: readErr } = await supabase
    .from('suppliers')
    .select('id, name, iban, kvk_number, btw_number, auto_incasso')
    .eq('id', id)
    .eq('user_id', ownerId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: t('lev.fout.opzoeken'), code: 'lookup_failed', detail: readErr.message }, { status: 503 })
  if (!current) return NextResponse.json({ error: t('lev.fout.nietGevonden'), code: 'not_found' }, { status: 404 })

  // [NO-SILENT-EMPTY] A count that failed is not zero: the owner is told how many invoices come
  // loose, and a number we could not read must not read as "none".
  const { count: linked, error: countErr } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', ownerId)
    .eq('supplier_id', current.id)
  if (countErr) return NextResponse.json({ error: t('lev.fout.verwijderen'), code: 'count_failed', detail: countErr.message }, { status: 503 })

  const { error: delErr } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', current.id)
    .eq('user_id', ownerId)
  if (delErr) return NextResponse.json({ error: t('lev.fout.verwijderen'), code: 'delete_failed', detail: delErr.message }, { status: 500 })

  await logAuditAction({
    userId: ownerId,
    action: 'supplier.deleted',
    entityType: 'supplier',
    entityId: current.id,
    oldValue: { name: current.name, iban: current.iban, kvk_number: current.kvk_number, btw_number: current.btw_number, auto_incasso: current.auto_incasso },
    newValue: { invoices_detached: linked ?? 0, via: 'leveranciers', by: acting.actorId },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({ ok: true, name: current.name, invoicesDetached: linked ?? 0 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await serverTranslator()
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: t('lev.fout.nietIngelogd'), code: 'unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()

  let body: {
    name?: string | null; iban?: string | null; kvk?: string | null; btw?: string | null
    defaultBtwRate?: string | number | null; defaultCategory?: string | null
    // [LEVERANCIER-LAND] ISO code; absent = not on the form, '' = cleared.
    country?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // The row as it stands. Owner-scoped: the id in the URL is only a claim.
  const { data: current, error: readErr } = await supabase
    .from('suppliers')
    .select('id, name, iban, kvk_number, btw_number, default_btw_rate, default_category')
    .eq('id', id)
    .eq('user_id', ownerId)
    .maybeSingle()
  // [NO-SILENT-EMPTY] A failed read is not "this supplier does not exist".
  if (readErr) return NextResponse.json({ error: t('lev.fout.opzoeken'), code: 'lookup_failed', detail: readErr.message }, { status: 503 })
  if (!current) return NextResponse.json({ error: t('lev.fout.nietGevonden'), code: 'not_found' }, { status: 404 })

  // [LEVERANCIER-LAND] The country in its OWN read: supplier_country.sql is newer than the generated
  // types and than some installations, and a column the typed select above does not know would
  // have failed the whole read. Unreadable = not recorded, which is the Netherlands — and a form
  // that carries a country then writes it below, best effort, with the migration named in the log.
  let currentCountry: string | null = null
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: landRow } = await (supabase as any)
      .from('suppliers')
      .select('country')
      .eq('id', current.id)
      .eq('user_id', ownerId)
      .maybeSingle()
    currentCountry = (landRow as { country?: string | null } | null)?.country ?? null
  }

  const plan = planSupplierEdit({ ...current, country: currentCountry }, body)
  if (!plan.ok) {
    return NextResponse.json(
      { error: t(SUPPLIER_PIN_REFUSAL_KEY[plan.code]), field: plan.field, code: plan.code },
      { status: 400 },
    )
  }

  // Nothing moved → nothing written, nothing logged. The trail never records a change that was not one.
  if (Object.keys(plan.changes).length === 0) {
    return NextResponse.json({ ok: true, changed: false, name: current.name, ibanReplaced: false, invoicesRenamed: 0 })
  }

  // ── 1. Keep the old account number BEFORE it is overwritten ──
  //
  // Order matters: a history row without the update is a harmless extra line; an update without
  // the history row is exactly the silent overwrite this exists to prevent. So the history goes
  // first, and a failure there stops the edit.
  if (plan.iban?.from) {
    const { error: histErr } = await supabase.from('supplier_iban_history').insert({
      user_id: ownerId,
      supplier_id: current.id,
      iban: plan.iban.from,
      replaced_by: plan.iban.to,
      actor_id: acting.actorId,
    })
    if (histErr) {
      return NextResponse.json({ error: t('lev.fout.bijwerken'), code: 'history_failed', detail: histErr.message }, { status: 500 })
    }
  }

  // ── 2. The row itself, only what moved ──
  //
  // [LEVERANCIER-LAND] The country is written in its own step (2b): one unknown column in this
  // update would refuse the whole edit on an installation behind on supplier_country.sql.
  const { country: nieuwLand, ...typedChanges } = plan.changes
  const { error: upErr } = Object.keys(typedChanges).length > 0
    ? await supabase
        .from('suppliers')
        .update(typedChanges)
        .eq('id', current.id)
        .eq('user_id', ownerId)
    : { error: null }
  if (upErr) {
    // A number another supplier of this owner already carries: say WHO, and point at the merge.
    const dup = duplicateField(upErr)
    if (dup) {
      const column = dup === 'iban' ? 'iban' : 'kvk_number'
      const value = dup === 'iban' ? plan.values.iban : plan.values.kvk
      const { data: other } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('user_id', ownerId)
        .eq(column, value ?? '')
        .neq('id', current.id)
        .limit(1)
        .maybeSingle()
      const ander = (other as { id: string; name: string } | null)?.name ?? '?'
      return NextResponse.json(
        {
          error: t(dup === 'iban' ? 'lev.fout.dubbelIban' : 'lev.fout.dubbelKvk', { ander }),
          field: dup,
          code: 'duplicate',
          otherSupplierId: (other as { id: string } | null)?.id ?? null,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: t('lev.fout.bijwerken'), code: 'update_failed', detail: upErr.message }, { status: 500 })
  }

  // ── 2b. The country, best effort on purpose ──
  //
  // An installation behind on the migration keeps the rest of the edit and loses the country; the
  // log names the file to apply, and the answer says the country was not stored.
  let countryStored = true
  if ('country' in plan.changes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: landErr } = await (supabase as any)
      .from('suppliers')
      .update({ country: nieuwLand ?? null })
      .eq('id', current.id)
      .eq('user_id', ownerId)
    if (landErr) {
      countryStored = false
      console.warn('[LEVERANCIER-LAND] country not stored — pas supabase/migrations/supplier_country.sql toe', {
        supplierId: current.id, error: (landErr as { message?: string }).message,
      })
    }
  }

  // ── 3. The display name on the invoices linked to this supplier ──
  //
  // By supplier_id only, never by name-matching. client_name is the key half the screens group on;
  // leaving the old spelling on the rows while the registry carries the new one splits a company's
  // history in two. The printed IBAN and btw number on those invoices are NOT touched: the document
  // stays what it was.
  let invoicesRenamed = 0
  if (plan.changes.name) {
    const { data: touched } = await supabase
      .from('invoices')
      .update({ client_name: plan.changes.name })
      .eq('receiver_id', ownerId)
      .eq('direction', 'incoming')
      .eq('supplier_id', current.id)
      .neq('client_name', plan.changes.name)
      .select('id')
    invoicesRenamed = (touched ?? []).length
  }

  const trail = supplierEditTrail({ ...current, country: currentCountry }, plan.changes)
  await logAuditAction({
    userId: ownerId,
    action: 'supplier.updated',
    entityType: 'supplier',
    entityId: current.id,
    oldValue: trail.old,
    newValue: { ...trail.new, invoices_renamed: invoicesRenamed, via: 'leveranciers', by: acting.actorId },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    changed: true,
    name: plan.changes.name ?? current.name,
    ibanReplaced: Boolean(plan.iban?.from),
    invoicesRenamed,
    countryStored,
  })
}
