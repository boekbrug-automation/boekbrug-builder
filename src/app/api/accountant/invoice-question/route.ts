// src/app/api/accountant/invoice-question/route.ts
// [FACTUURVRAAG] De boekhouder stelt een vraag over ÉÉN factuur van zijn klant.
//
// ── WAT ER ONTBRAK, EN HOE ZICHTBAAR DAT WAS ──
// Dit is de meest gestelde vraag van een boekhouder over een administratie: "die ene regel, wat is
// dat?" — privé of zakelijk, welk project, waarom 21% en niet 9%. Ze had geen plek in de app.
//
// Ze was wel overal INGETEKEND. `invoices.accountant_status = 'vraag'` wordt op drie plekken
// GELEZEN: de KPI "Open vraag" op de boekhouderhome, de rode stip bij een klant in Klantenbeheer,
// en het ❓-punt op het werkboard. Geschreven werd hij door geen enkele route. De databasetrigger
// (accountant_write_guard_fix) staat een boekhouder uitdrukkelijk toe accountant_status en
// accountant_note te verzetten — de toestemming was verleend, het pad nooit gebouwd. En de chip
// "? Vraag" staat in InvoiceRow.tsx achter `isAccountantMode`, dat nergens waar is.
//
// Drie tellers die eeuwig nul aanwijzen, en een gesprek dat daarom via WhatsApp liep.
//
// ── WAAROM DIT GEEN MANDAAT VEREIST ──
// Dezelfde grens als /api/accountant/vraag-stukken: de koppeling, niet de machtiging. Een vraag
// stellen boekt niets, wijzigt geen bedrag en gaat niet uit onder het BTW-nummer van de klant. De
// boekhouder praat met zijn eigen klant. Bevestigen is iets anders en houdt daarom zijn mandaat.
//
// Wat er wél verandert is `accountant_status`, en dat is precies wat die kolom is: een BEWERING VAN
// DE BOEKHOUDER over een factuur. De klant kan hem lezen en beantwoorden; afvinken doet de
// boekhouder zelf. Daarom zet het antwoord van de klant de status níét terug — dat zou de bewering
// van de één in het vakje van de ander schrijven.
//
// ── [VRAAG-SYNC] ONE write, where there were two ──
// This route used to write the question TEXT itself (an upsert on accountant_subject_status through
// the session client) and then ask the door for the STATUS on the invoice. Two writes, and a failure
// between them was exactly the contradiction the Phase 2 audit measured (VR-01): a status without
// words, or words the accountant's own counters never saw — and, on the way back, an invoice set to
// 'verwerkt' while the client kept reading an open question about it, forever.
//
// Both facts now move in ONE database transaction behind the door (accountant_set_invoice_status):
// the words and the status are written together or not at all, and the same door closes the
// question when the accountant later resolves the invoice. This route holds only what is HTTP:
// reading a body, refusing a malformed one, the rate limit, the notification, and turning the
// door's answer into a status code.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createNotification } from '@/lib/notifications'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { logAuditAction } from '@/lib/audit'
import { VRAAG_STATUS, vraagTekst } from '@/lib/vragen'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { setAccountantStatus, DOOR_REFUSAL_HTTP_STATUS, type DoorRefusal } from '@/lib/accountant-status-door'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Genoeg voor een echte vraag, kort genoeg om een notificatie niet te laten ontsporen. */
const MAX_TEXT = 500

/**
 * What the accountant reads when the door refuses — one sentence per reason. The sentences are the
 * ones this route has always answered with; only the place they are chosen from has changed.
 * [NO-SILENT-EMPTY] A failed read of the link is never "not linked": that reads as a revoked
 * mandate, which is a very different message from "try again".
 */
const REFUSAL_TEXT: Record<DoorRefusal, string> = {
  not_authenticated: 'Niet ingelogd.',
  unknown_status: 'Onbekende status',
  question_required: 'Vraag is leeg',
  link_read_failed: 'De koppeling kon niet worden gecontroleerd — probeer het opnieuw.',
  not_linked: 'Je kunt alleen een vraag stellen bij een gekoppelde klant',
  invoice_read_failed: 'De factuur kon niet worden gelezen — probeer het opnieuw.',
  invoice_not_visible: 'Factuur niet gevonden',
  invoice_not_this_client: 'Deze factuur hoort niet bij deze klant',
  write_failed: 'De vraag kon niet worden opgeslagen — probeer het opnieuw.',
  nothing_written: 'De vraag kon niet worden opgeslagen — probeer het opnieuw.',
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
  if (!UUID.test(clientId) || !UUID.test(invoiceId)) {
    return NextResponse.json({ error: 'Ongeldig verzoek' }, { status: 400 })
  }
  // Een lege vraag is geen vraag. Weigeren is eerlijker dan een status zetten waar de klant niets
  // mee kan — dat is exact de toestand die deze route komt opheffen. The door refuses it a second
  // time, and the database a third: a status is never written without its words.
  const question = vraagTekst(typeof body?.question === 'string' ? body.question.slice(0, MAX_TEXT) : null)
  if (!question) return NextResponse.json({ error: REFUSAL_TEXT.question_required }, { status: 400 })

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: '/api/accountant/invoice-question',
    ...RATE_LIMITS.INVOICE_SEND,
  })
  if (!limit.allowed) return rateLimitResponse(limit)

  // [BOEKHOUDER-DEUR] The door decides everything about the invoice: who is asking (the session,
  // never a parameter), whether they are linked to this client (checked in code, never with
  // clientId inside a PostgREST filter), whether the invoice is visible to them under RLS and
  // belongs to this client — and then makes the ONE write, in which the status on the invoice and
  // this accountant's question row (the words) move together.
  const result = await setAccountantStatus({
    session: supabase,
    pipeline: createPipelineClient(),
    invoiceId,
    clientId,
    status: VRAAG_STATUS,
    question,
  })
  if (!result.ok) {
    const status = DOOR_REFUSAL_HTTP_STATUS[result.reason]
    if (status >= 500) {
      console.error('[FACTUURVRAAG] vraag opslaan mislukt', {
        accountantId: user.id, invoiceId, reason: result.reason, detail: result.detail,
      })
    }
    return NextResponse.json({ error: REFUSAL_TEXT[result.reason] }, { status })
  }

  // ── De klant weten ───────────────────────────────────────────────────────────
  // Best-effort: een mislukte melding mag een opgeslagen vraag nooit terugdraaien. De link wijst
  // naar /dashboard/vragen — het scherm met de vraag, de factuur erbij en één veld om te antwoorden
  // — en niet naar een lijst waar de klant zelf mag zoeken wat er bedoeld werd.
  const label = result.invoiceLabel
  const melding = await createNotification({
    userId: clientId,
    title: 'Vraag van je boekhouder',
    body: `${label ? `${label} — ` : ''}${question.slice(0, 120)}`,
    type: 'status',
    link: '/dashboard/vragen',
  })
  // [NOTIFY-EERLIJK] Dit stond in een try/catch. supabase-js gooit niet bij een geweigerde
  // schrijfactie, dus die catch is nooit één keer gevallen: de melding kon stilletjes mislukken en
  // de boekhouder kreeg "vraag verstuurd" te zien voor een vraag die zijn klant nooit zag.
  if (!melding.ok) {
    console.error('[FACTUURVRAAG] melding mislukt', { clientId, error: melding.error })
  }

  await logAuditAction({
    userId: user.id,
    action: 'accountant.invoice_question',
    entityType: 'invoice',
    entityId: invoiceId,
    newValue: { client_id: clientId, invoice_label: label, question_was_open: result.questionWasOpen },
  }).catch((e) => {
    console.error('[FACTUURVRAAG] audit mislukt', { error: e instanceof Error ? e.message : String(e) })
  })

  return NextResponse.json({ ok: true })
}
