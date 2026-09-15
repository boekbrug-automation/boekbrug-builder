// src/app/api/supplier/route.ts
// [LEVERANCIER-NIEUW] The owner adds a supplier by hand, or adopts one the balance already shows.
//
// ── WHY A ROW CAN BE MISSING ──
//
// The registry only ever got a row when an import matched an invoice on a strong key. Invoices
// that arrived before the registry existed, or without an IBAN or KVK the reader could trust,
// sit in the books with a client_name and no supplier_id — so the creditors screen lists the
// company (it groups on the printed name) while nothing about it can be edited. Trimex with 29
// invoices had no row at all. This door makes one, and hangs those invoices under it.
//
// ── WHAT IT DOES AND DOES NOT TOUCH ──
//
//   · The same validation as every other supplier form (supplier-pin.ts).
//   · A name that already resolves to a supplier of this owner is answered as "edit that one",
//     with its name — a second row for the same company is the split this whole registry exists
//     to prevent. A number another supplier carries is answered as "merge them".
//   · Adoption links by supplier_id only. The printed client_name on those invoices stays what
//     it was: nobody said the paper was wrong, only that it has no row yet.
//   · The country goes in its own best-effort write, like the edit route: an installation behind
//     on supplier_country.sql keeps the supplier and loses the country, and says so.
//
// [TAAL] Every sentence comes from the catalogue in the language of whoever is typing.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId } from '@/lib/acting-for'
import { planSupplierPin, SUPPLIER_PIN_REFUSAL_KEY } from '@/lib/supplier-pin'
import { duplicateField } from '@/lib/supplier-edit'
import { counterpartKey } from '@/lib/bank-identity'
import { fetchAllRows } from '@/lib/supabase-paginate'
import { serverTranslator } from '@/lib/i18n/server'
import { logAuditAction, getClientIP } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const ADOPT_CHUNK = 200

export async function POST(req: NextRequest) {
  const t = await serverTranslator()
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: t('lev.fout.nietIngelogd'), code: 'unauthorized' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)
  const supabase = await createServerSupabaseClient()

  let body: {
    name?: string | null; iban?: string | null; kvk?: string | null; btw?: string | null
    country?: string | null; defaultBtwRate?: string | number | null; defaultCategory?: string | null
    adoptInvoices?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const plan = planSupplierPin(body)
  if (!plan.ok) {
    return NextResponse.json(
      { error: t(SUPPLIER_PIN_REFUSAL_KEY[plan.code]), field: plan.field, code: plan.code },
      { status: 400 },
    )
  }
  const v = plan.values

  // ── 1. The same company under another spelling? Then it is an edit, not a second row ──
  const { data: same, error: sameErr } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('user_id', ownerId)
    .eq('name_key', v.nameKey)
    .limit(1)
    .maybeSingle()
  if (sameErr) return NextResponse.json({ error: t('lev.fout.opzoeken'), code: 'lookup_failed', detail: sameErr.message }, { status: 503 })
  if (same) {
    return NextResponse.json(
      { error: t('lev.fout.bestaatAl', { ander: same.name }), field: 'name', code: 'exists', otherSupplierId: same.id },
      { status: 409 },
    )
  }

  // ── 2. The row ──
  const { data: made, error: insErr } = await supabase
    .from('suppliers')
    .insert({
      user_id: ownerId,
      name: v.name,
      name_key: v.nameKey,
      iban: v.iban,
      kvk_number: v.kvk,
      btw_number: v.btw,
      ...(v.defaultBtwRate !== undefined ? { default_btw_rate: v.defaultBtwRate } : {}),
      ...(v.defaultCategory !== undefined ? { default_category: v.defaultCategory } : {}),
    })
    .select('id, name')
    .maybeSingle()
  if (insErr || !made) {
    const dup = duplicateField(insErr)
    if (dup) {
      const column = dup === 'iban' ? 'iban' : 'kvk_number'
      const value = dup === 'iban' ? v.iban : v.kvk
      const { data: other } = await supabase
        .from('suppliers').select('id, name').eq('user_id', ownerId).eq(column, value ?? '').limit(1).maybeSingle()
      const ander = (other as { name: string } | null)?.name ?? '?'
      return NextResponse.json(
        {
          error: t(dup === 'iban' ? 'lev.fout.dubbelIban' : 'lev.fout.dubbelKvk', { ander }),
          field: dup, code: 'duplicate', otherSupplierId: (other as { id: string } | null)?.id ?? null,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: t('lev.fout.aanmaken'), code: 'insert_failed', detail: insErr?.message ?? null }, { status: 500 })
  }

  // ── 2b. The country, best effort on purpose (see the edit route) ──
  let countryStored = true
  if (v.country !== undefined && v.country !== null) {
    // supplier_country.sql is newer than the generated types; the cast is the tolerance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: landErr } = await (supabase as any)
      .from('suppliers')
      .update({ country: v.country })
      .eq('id', made.id)
      .eq('user_id', ownerId)
    if (landErr) {
      countryStored = false
      console.warn('[LEVERANCIER-LAND] country not stored — pas supabase/migrations/supplier_country.sql toe', {
        userId: ownerId, supplier: made.id, error: landErr.message,
      })
    }
  }

  // ── 3. The invoices already in the books under this name, by supplier_id only ──
  //
  // Only rows with NO supplier yet: an invoice that is linked belongs to whoever it is linked
  // to, and taking it would be the merge door's job with the merge door's evidence. The match
  // is the same key the creditors screen groups on, so what the owner saw as one line is what
  // lands under the new row. client_name is not touched.
  let invoicesAdopted = 0
  if (body.adoptInvoices === true) {
    const wanted = counterpartKey(v.name)
    if (wanted) {
      try {
        const loose = await fetchAllRows<{ id: string; client_name: string | null }>((from, to) =>
          supabase
            .from('invoices')
            .select('id, client_name')
            .eq('receiver_id', ownerId)
            .eq('direction', 'incoming')
            .is('supplier_id', null)
            .order('id', { ascending: true })
            .range(from, to),
        )
        const ids = loose.filter((r) => counterpartKey(r.client_name) === wanted).map((r) => r.id)
        for (let i = 0; i < ids.length; i += ADOPT_CHUNK) {
          const chunk = ids.slice(i, i + ADOPT_CHUNK)
          const { data: touched, error: adoptErr } = await supabase
            .from('invoices')
            .update({ supplier_id: made.id })
            .eq('receiver_id', ownerId)
            .is('supplier_id', null)
            .in('id', chunk)
            .select('id')
          if (adoptErr) {
            console.error('[LEVERANCIER-NIEUW] adoption stopped halfway — the rest stays unlinked', {
              userId: ownerId, supplier: made.id, error: adoptErr.message,
            })
            break
          }
          invoicesAdopted += (touched ?? []).length
        }
      } catch (e) {
        console.error('[LEVERANCIER-NIEUW] the unlinked invoices could not be read — nothing adopted', {
          userId: ownerId, supplier: made.id, error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  await logAuditAction({
    userId: ownerId,
    action: 'supplier.created',
    entityType: 'supplier',
    entityId: made.id,
    newValue: {
      name: v.name, iban: v.iban, kvk: v.kvk, btw: v.btw,
      default_btw_rate: v.defaultBtwRate ?? null, default_category: v.defaultCategory ?? null,
      invoices_adopted: invoicesAdopted, via: 'leveranciers', by: acting.actorId,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({ ok: true, id: made.id, name: made.name, invoicesAdopted, countryStored })
}
