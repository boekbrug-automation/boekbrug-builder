// src/app/api/invoice/[id]/send-offerte/route.ts
// [OFFERTE-VERSTUREN] Mail a QUOTE to the customer, as a quote.
//
// ═══ WHY THIS IS ITS OWN ROUTE ═══
//
// The app could not send a quote at all. Every path through /api/invoice/send either CONVERTS it
// into an official factuur (isConversion → a number from the gapless series), converts it without
// sending, or re-delivers an invoice that already has a number. So the only way to put a quote in
// front of a customer was to turn it into an invoice first — which is the opposite of what a quote
// is for, and irreversible under Art. 35: a factuur is corrected with a creditnota, never withdrawn.
//
// A `sendAsQuote` flag on that route would have put "never mint a number" one wrong branch away
// from "mint one", on the single action in this app that cannot be undone. This file holds no
// allocator, imports none, and writes neither invoice_number nor invoice_type. A door that CANNOT
// mint is a stronger guarantee than a door that decides not to — and it is checkable, which is
// what the gate checks.
//
// ═══ WHAT IT DOES WRITE ═══
//
//   · status → 'sent'      the quote is out. It stays a pro_forma with no number, so it stays
//                          EDITABLE (isInvoiceEditable) — a customer asking "kan het goedkoper?"
//                          is the normal next step, and re-sending after an edit is allowed.
//   · pdf_url              best-effort, same house rule as the send route: raw path, signed on read.
//
// Nothing else. No number, no type change, no totals.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [OFFERTE-AKKOORD] De basis van de publieke akkoordlink.
import { SITE_URL } from '@/lib/site'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getActingFor } from '@/lib/acting-for-server'
import { invoiceOwnerId, canAccessInvoice } from '@/lib/acting-for'
import { checkOfferteSendable, offerteFileName } from '@/lib/offerte-send'
import { renderInvoicePdf } from '@/lib/invoice-pdf-server'
import { sendOfferteToClient } from '@/lib/email'
import { logAuditAction, getClientIP } from '@/lib/audit'
import { storeOriginal } from '@/lib/document-storage'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = invoiceOwnerId(acting)

  const { id } = await ctx.params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const limited = await checkRateLimit({
    userId: acting.actorId, endpoint: 'invoice-send-offerte', ...RATE_LIMITS.INVOICE_SEND,
  })
  if (!limited.allowed) return rateLimitResponse(limited)

  // [NO-SILENT-EMPTY] The error is read. supabase-js does not throw, so an unchecked read would
  // answer "deze offerte bestaat niet" to a database hiccup — about a document the owner is
  // looking straight at.
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('sender_id', ownerId)
    .maybeSingle()
  if (invErr) {
    console.error('[OFFERTE-VERSTUREN] lookup failed', { id, error: invErr.message })
    return NextResponse.json({ error: 'We konden deze offerte nu niet opzoeken. Probeer het zo meteen opnieuw.' }, { status: 503 })
  }
  if (!invoice) return NextResponse.json({ error: 'Offerte niet gevonden' }, { status: 404 })
  // [ACTING-FOR] A verkoopmedewerker only touches what they made themselves. RLS says so too; this
  // is the place a guessed id arrives.
  if (!canAccessInvoice(acting, invoice)) {
    return NextResponse.json({ error: 'Offerte niet gevonden' }, { status: 404 })
  }

  const { data: lines, error: lineErr } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', id)
    .order('id', { ascending: true })
  if (lineErr) {
    console.error('[OFFERTE-VERSTUREN] line read failed', { id, error: lineErr.message })
    return NextResponse.json({ error: 'We konden de regels nu niet lezen. Probeer het zo meteen opnieuw.' }, { status: 503 })
  }

  // The four refusals, each with its own sentence — see offerte-send.ts.
  const check = checkOfferteSendable({
    invoiceType: invoice.invoice_type,
    invoiceNumber: invoice.invoice_number,
    clientEmail: invoice.client_email,
    lineCount: (lines ?? []).length,
  })
  if (!check.ok) {
    return NextResponse.json({ error: check.error, code: check.code }, { status: 409 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    
    // [OFFERTE-ANTWOORD] `email` erbij: dat is het adres waar het akkoord naartoe moet. Zonder
    // deze kolom gaat de mail uit vanaf noreply@ met een reply-to die nergens heen wijst.
    // [OFFERTE-ANTWOORD] `phone` erbij: de PDF drukt hem in het afzenderblok af, naast het
    // mailadres. Deze route is de enige die zijn kolommen opsomt — de andere PDF-routes lezen
    // select('*') — dus een veld dat hier ontbreekt, bestaat voor de offerte-PDF niet, ook als het
    // profiel het gewoon heeft.
    .select('company_name, full_name, email, phone, address, postal_code, city, kvk_number, btw_number, iban, kor_active, vat_exempt_activity, vat_statement_note')
    .eq('id', ownerId)
    .maybeSingle()
  const senderName = profile?.company_name?.trim() || profile?.full_name?.trim() || 'BoekBrug'

  // The PDF already knows what an offerte is: it prints "Geldig tot" instead of "Vervaldatum" and
  // the line "Deze offerte is vrijblijvend". Nothing to special-case here.
  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await renderInvoicePdf(invoice, lines ?? [], profile ?? {})
  } catch (e) {
    console.error('[OFFERTE-VERSTUREN] pdf render failed', { id, error: e instanceof Error ? e.message : String(e) })
    // Refuse. A quote is a DOCUMENT — an e-mail naming an amount with nothing attached is not the
    // thing the owner asked to send, and a customer cannot agree to a number in a sentence.
    return NextResponse.json({
      error: 'We konden de offerte-PDF niet maken. Probeer het zo meteen opnieuw.',
    }, { status: 502 })
  }

  // ── [OFFERTE-AKKOORD] Het token, VOOR de mail ──
  //
  // De link moet in de mail, dus hij moet bestaan voordat de mail weggaat — en hij moet zijn
  // OPGESLAGEN, want een link met een token dat nooit in de database kwam is een dode knop bij de
  // klant. Lukt het schrijven niet, dan gaat de mail uit ZONDER knop: dat is de mail zoals hij
  // altijd was ("antwoord op deze mail"), en die werkt.
  //
  // Hergebruikt wat er al staat, zodat opnieuw versturen dezelfde link oplevert — de klant kan de
  // eerste mail nog hebben.
  const bestaandToken = (invoice as { offerte_token?: string | null }).offerte_token ?? null
  let akkoordToken: string | null = bestaandToken
  if (!akkoordToken) {
    const nieuw = crypto.randomUUID()
    const { error: tokenErr } = await createPipelineClient()
      .from('invoices')
      .update({ offerte_token: nieuw } as never)
      .eq('id', id)
      .eq('sender_id', ownerId)
    if (tokenErr) {
      // Luid, want dit is te repareren: meestal betekent het dat offerte_akkoord.sql nog open
      // staat. De offerte gaat gewoon de deur uit, alleen zonder knop.
      console.warn('[OFFERTE-AKKOORD] akkoordlink kon niet worden vastgelegd — de offerte gaat ' +
        'zonder knop de deur uit. Pas supabase/migrations/offerte_akkoord.sql toe.',
        { id, error: tokenErr.message })
    } else {
      akkoordToken = nieuw
    }
  }

  const delivered = await sendOfferteToClient({
    akkoordUrl: akkoordToken ? `${SITE_URL}/offerte/${akkoordToken}` : null,
    toEmail: String(invoice.client_email),
    clientName: invoice.client_name?.trim() || 'klant',
    senderName,
    // Het antwoordadres van de ONDERNEMER — profiles.email, dat bij registratie uit auth.users
    // wordt gevuld.
    //
    // [ACTING-FOR] De terugval op het ingelogde account geldt alleen als de ingelogde persoon de
    // eigenaar zelf IS. Stuurt een verkoopmedewerker de offerte, dan is `user.email` zíjn adres en
    // niet dat van zijn werkgever: het akkoord van de klant zou dan bij een medewerker landen in
    // plaats van bij het bedrijf, op een document dat de werkgever bindt. Liever geen reply-to dan
    // de verkeerde — de mail zegt dan "laat het ons weten" en de PDF draagt de bedrijfsgegevens.
    senderEmail: profile?.email?.trim() || (acting.actorId === ownerId ? user.email : null) || null,
    totalInc: Number(invoice.total_inc_btw ?? 0),
    validUntil: invoice.due_date,
    offerteDate: invoice.invoice_date,
    pdfBuffer,
    fileName: offerteFileName(invoice.client_name, invoice.invoice_date),
  })
  if (!delivered) {
    // Nothing is marked sent. An owner who believes the quote is with the customer, and waits, is
    // worse off than one who knows it did not go — this is a proposal with a deadline on it.
    console.error('[OFFERTE-VERSTUREN] not delivered', { id })
    return NextResponse.json({
      error: 'De offerte is NIET verstuurd — de mail kwam niet weg. Controleer het e-mailadres en probeer het opnieuw.',
    }, { status: 502 })
  }

  // Only now. `status` and `pdf_url` — never a number, never a type.
  const pipeline = createPipelineClient()
  const pdfPath = `${ownerId}/offertes/${id}.pdf`
  const { error: upErr } = await storeOriginal(pipeline, pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) console.error('[OFFERTE-VERSTUREN] pdf upload failed (mail already sent)', upErr.message)

  const { error: statusErr } = await pipeline
    .from('invoices')
    .update({
      status: 'sent',
      ...(upErr ? {} : { pdf_url: pdfPath }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('sender_id', ownerId)
  if (statusErr) {
    // The customer HAS the quote. Saying "versturen mislukt" now would be a lie in the other
    // direction, and would invite a second send of the same document.
    console.error('[OFFERTE-VERSTUREN] status not updated after a delivered mail', { id, error: statusErr.message })
  }

  await logAuditAction({
    userId: ownerId,
    action: 'offerte.sent',
    entityType: 'invoice',
    entityId: id,
    newValue: { to: invoice.client_email, total_inc_btw: invoice.total_inc_btw, by: acting.actorId },
    ipAddress: getClientIP(req),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    message: statusErr
      ? 'De offerte is verstuurd. Het bijwerken van de status lukte niet — ververs de pagina.'
      : 'De offerte is verstuurd. Er is nog geen factuur: die maak je pas als de klant akkoord is.',
  })
}
