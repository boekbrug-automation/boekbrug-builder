// src/app/api/messages/route.ts
// BOEK-007: GET + POST

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { createNotification } from '@/lib/notifications'
import { sendMessageNotification } from '@/lib/email'
import { appUrl } from "@/lib/app-origin"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { answerNoticeLink } from '@/lib/answer-notice'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── GET: fetch one conversation ───────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const otherId = searchParams.get('with')
    if (!otherId) return NextResponse.json({ error: 'Gesprekspartner ontbreekt' }, { status: 400 })

    // [SEC-MESSAGE] otherId is interpolated into the PostgREST .or() filter below. Constrain it to a
    // UUID so a crafted value can't inject extra filter syntax and widen the match beyond this pair.
    if (!UUID.test(otherId)) {
      return NextResponse.json({ error: 'Ongeldige gesprekspartner' }, { status: 400 })
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content, read, created_at')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: 'Ophalen mislukt' }, { status: 500 })

    // Mark the received messages as read
    const unreadIds = messages
      ?.filter(m => m.receiver_id === user.id && !m.read)
      .map(m => m.id) || []

    if (unreadIds.length > 0) {
      const { error: readErr } = await supabase.from('messages').update({ read: true }).in('id', unreadIds)
      // [NO-SILENT-EMPTY] Not fatal — the conversation is on screen either way — but a failure here
      // means the badge on the home keeps counting messages the owner has visibly read, and nothing
      // would ever say why.
      if (readErr) console.error('[BERICHTEN] als gelezen markeren mislukt', { userId: user.id, error: readErr.message })
    }

    // [GESPREK-GRENS] Whether the two are linked right now, read as a fact of its own: the thread
    // screen used to render any id as an empty conversation with a live composer — a page that
    // looked like a chat with a stranger (audit TH-01). null = the read failed; not "no".
    const linked = await pairIsLinked(supabase, user.id, otherId)
    const partnerName = await resolvePartnerName(supabase, user.id, otherId, (messages ?? []).length > 0, linked)

    return NextResponse.json({
      messages: messages || [],
      // [NAAM-TEGENPARTIJ] Resolved server-side on purpose — see resolvePartnerName.
      partner: { id: otherId, name: partnerName },
      linked,
    })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

/**
 * [GESPREK-GRENS] Is this pair linked (accountant ↔ client, either way round), as far as the
 * caller's own link rows say? The caller's OWN rows only (bounded, no interpolation of otherId);
 * null when the read failed — a failed read is not "not linked", which reads as a revoked mandate.
 */
async function pairIsLinked(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  otherId: string,
): Promise<boolean | null> {
  const { data: myLinks, error } = await supabase
    .from('accountant_clients')
    .select('accountant_id, zzper_id')
    .or(`accountant_id.eq.${userId},zzper_id.eq.${userId}`)
  if (error) {
    console.error('[BERICHTEN] koppelingslezing mislukt', { userId, error: error.message })
    return null
  }
  return (myLinks ?? []).some(
    (l) =>
      (l.accountant_id === userId && l.zzper_id === otherId) ||
      (l.zzper_id === userId && l.accountant_id === otherId),
  )
}

/**
 * [NAAM-TEGENPARTIJ] Who the owner is talking to, by name.
 *
 * The screens used to read this straight from `profiles` in the browser, and for a zzp'er that
 * returns NOTHING: RLS on profiles is `id = auth.uid()` plus one policy that lets an ACCOUNTANT
 * read a linked client — there is no policy the other way round. So the accountant saw his client's
 * name and the client saw "Onbekend", on the one screen whose entire purpose is that these two
 * people talk to each other. The rest of the app already knew this (see the header of
 * /api/settings/accountant, "bypasses RLS on profiles"); the message screens were the exception.
 *
 * Reading a name for an arbitrary id would be a leak, so it is gated on a relationship the CALLER
 * can already prove: an accountant↔client link, or an existing message between the two (which RLS
 * itself just returned to them).
 */
async function resolvePartnerName(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  otherId: string,
  hasConversation: boolean,
  linked: boolean | null,
): Promise<string | null> {
  try {
    // A name for an arbitrary id would be a leak: only a proven link, or a conversation RLS itself
    // just returned, earns one. (The link read happened once, in pairIsLinked.)
    if (!hasConversation && linked !== true) return null

    const pipeline = createPipelineClient()
    const { data: profile } = await pipeline
      .from('profiles')
      .select('full_name, company_name')
      .eq('id', otherId)
      .maybeSingle()
    return profile?.company_name || profile?.full_name || null
  } catch (err) {
    // A missing name is a cosmetic loss; it may never cost the owner the conversation itself.
    console.error('[BERICHTEN] naam van gesprekspartner ophalen mislukt', { otherId, error: String(err) })
    return null
  }
}

// ── [KANTOOR-LINKS] Where an ANSWER lands ────────────────────────────────────
//
// Every message notification said "Nieuw bericht" and pointed at the conversation. For a message
// that is a plain message that is exactly right. For the ANSWER to a question an accountant asked
// about one invoice it is a dead end: they get the answer far from the document they asked about,
// and go looking for it.
//
// So the answering screen may name the invoice its answer is about — a TYPED id, never the text.
// The sentence itself is deliberately not read: `bouwAntwoordBericht` writes a Dutch line with
// the file name in it, and a link built by parsing that would break on the first rename, the
// first quote, the first translation.
//
// FOUR things gate it, and all four must hold:
//   · the sender OWNS the invoice (checked under their own session — RLS, plus an explicit
//     ownership filter, so a stray id cannot point the link at somebody else's administration);
//   · the receiver is the sender's ACCOUNTANT, not the other way round — `/dashboard/clients/...`
//     is an accountant surface, and an owner sent there would land on a page that is not theirs;
//   · THIS accountant has an OPEN question about THIS invoice. Ownership alone proves the client
//     may name the invoice, not that the message answers anything: a client could attach any
//     invoice of their own and aim an accountant's notification at an unrelated row. And with two
//     offices on one administration, the office that receives the answer is not necessarily the
//     one that asked — so the row is matched on accountant_id too, never on "an" open question;
//   · the invoice has a readable date, because the target needs the period and a guessed quarter
//     is a wrong answer rather than a smaller one.
//
// Anything missing — no row, the wrong accountant, a question already cleared, or a read that
// FAILED — and the notification carries the conversation link this route always wrote. The
// message itself is never affected by any of it: it is sent either way. A deep link is a
// convenience; the answer reaching the accountant is the product.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function askedAbout(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const about = (body as { about?: unknown }).about
  if (!about || typeof about !== 'object') return null
  const { type, id } = about as { type?: unknown; id?: unknown }
  if (type !== 'invoice' || typeof id !== 'string' || !UUID_RE.test(id)) return null
  return id
}

// ── POST: send a message ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()

    // [DIEP-3] Bounded like its siblings — the day-end audit found this one uncapped.
    const limited = await checkRateLimit({ userId: user.id, endpoint: 'messages-send', ...RATE_LIMITS.MESSAGE_SEND });
    if (!limited.allowed) return rateLimitResponse(limited);
    const { receiver_id, content } = body
    // [KANTOOR-LINKS] Optional, typed, and validated below against ownership and direction.
    const aboutInvoiceId = askedAbout(body)

    if (!receiver_id || !content?.trim()) {
      return NextResponse.json({ error: 'Ongeldig bericht' }, { status: 400 })
    }

    // [SEC-MESSAGE] You may only message someone you are LINKED to (accountant ↔ client).
    // Without this, any authenticated user could POST an arbitrary receiver_id and push an
    // in-app notification + e-mail (via service_role) to ANY user — a spam/abuse vector.
    // Fetch this user's own links (bounded) and check the pair IN CODE (receiver_id is never
    // interpolated into a SQL filter → no PostgREST filter injection).
    const { data: myLinks, error: linkErr } = await supabase
      .from('accountant_clients')
      .select('accountant_id, zzper_id')
      .or(`accountant_id.eq.${user.id},zzper_id.eq.${user.id}`)
    if (linkErr) {
      // [NO-SILENT-EMPTY] A failed read is not "not linked". Answering 403 here tells the owner
      // their accountant is gone, which is a different — and false — piece of news.
      console.error('[BERICHTEN] koppelingslezing mislukt', { userId: user.id, error: linkErr.message })
      return NextResponse.json(
        { error: 'De koppeling kon niet worden gecontroleerd — probeer het zo opnieuw.' },
        { status: 503 },
      )
    }
    const linked = (myLinks ?? []).some(
      (l) =>
        (l.accountant_id === user.id && l.zzper_id === receiver_id) ||
        (l.zzper_id === user.id && l.accountant_id === receiver_id),
    )
    // [KANTOOR-LINKS] Which way this message travels. Only owner → accountant may carry an
    // accountant deep link; the same pair read the other way round must not.
    const naarBoekhouder = (myLinks ?? []).some(
      (l) => l.zzper_id === user.id && l.accountant_id === receiver_id,
    )
    if (!linked) {
      return NextResponse.json(
        { error: 'Je kunt alleen berichten sturen naar een gekoppelde klant of boekhouder' },
        { status: 403 },
      )
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        receiver_id,
        content: content.trim(),
        read: false
      })
      .select()
      .single()

    if (error || !message) {
      return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 500 })
    }

    // In-app notification + push, through the one writer.
    // [CONTROL] notifications has NO authenticated INSERT policy (verified via
    // live pg_policies) → an anon insert 42501s silently and the recipient never
    // gets the in-app notification. createNotification writes it via service_role —
    // and, since it is the writer that also fans out to the recipient's devices,
    // this is what finally makes a new message ring a phone. The direct insert that
    // stood here wrote the row and stopped there: push was built, documented and
    // wired to exactly the events a message is not.
    // [KANTOOR-LINKS] The invoice the answer is about, when the answering screen named one — and
    // only when an exact open question of THIS accountant proves the message answers it. The whole
    // decision, with its two reads and its five reasons to return null, lives in answer-notice.ts.
    //
    // Note where this sits: AFTER the message row is written. The message is the product; the deep
    // link is a convenience on the notification, and no failure of it may cost the send. The
    // question also stays open — the client answering is not the client resolving, and nothing
    // here writes to accountant_subject_status.
    const deepLink = aboutInvoiceId && naarBoekhouder
      ? await answerNoticeLink(supabase, { senderId: user.id, receiverId: receiver_id, invoiceId: aboutInvoiceId })
      : null
    const melding = await createNotification({
      userId: receiver_id,
      title: 'Nieuw bericht',
      body: content.trim().slice(0, 80),
      type: 'message',
      link: deepLink ?? `/dashboard/messages/${user.id}`,
    })
    if (!melding.ok) {
      console.error('[BERICHTEN] melding aan de ontvanger mislukt', { receiver_id, error: melding.error })
    }

    // E-mail notification — never blocks the send.
    //
    // [NAAM-TEGENPARTIJ] Both profiles come from the PIPELINE client. The receiver used to be read
    // with the session client, and RLS on profiles only lets an accountant read his client — never
    // the reverse. So `receiverProfile` was null for every message a client sent to his accountant,
    // the `if` below fell through, and the mail was silently not sent. One direction of the bridge
    // mailed and the other did not; nothing on either screen said so. The sibling route
    // /api/accountant/vraag-stukken already read both sides through the pipeline.
    const pipeline = createPipelineClient()
    const [{ data: senderProfile }, { data: receiverProfile }] = await Promise.all([
      pipeline.from('profiles').select('full_name, company_name, email').eq('id', user.id).maybeSingle(),
      pipeline.from('profiles').select('email, full_name').eq('id', receiver_id).maybeSingle()
    ])

// [BOEK-FOUNDATION-TYPES] Only send notification if recipient has email
    if (senderProfile && receiverProfile?.email) {
      const senderName = senderProfile.company_name || senderProfile.full_name || 'BoekBrug gebruiker'
      // Awaited: this route runs in a serverless function that may be frozen the moment it
      // responds, so a floating promise is a mail that leaves only if the platform feels like it.
      // The failure path stays best-effort — the message itself is already stored.
      try {
        await sendMessageNotification({
          toEmail: receiverProfile.email,
          receiverName: receiverProfile.full_name || 'Gebruiker',
          senderName,
          messagePreview: content.trim().slice(0, 120),
          // [ORIGIN] Was `${process.env.NEXT_PUBLIC_APP_URL}/...` zonder vangnet: ontbrak de
          // variabele, dan vertrok deze mail met de link "undefined/dashboard/messages/...".
          // appUrl geeft null als er geen origin is; de mail gaat dan zonder link i.p.v. met een
          // kapotte — sendMessageNotification valt terug op de tekst zelf.
          conversationUrl:
            appUrl(process.env, `/dashboard/messages/${user.id}`, new URL(request.url).origin) ?? ''
        })
      } catch (e) {
        console.error('[BERICHTEN] e-mail aan de ontvanger mislukt', { receiver_id, error: String(e) })
      }
    }
    return NextResponse.json({ success: true, message })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}
