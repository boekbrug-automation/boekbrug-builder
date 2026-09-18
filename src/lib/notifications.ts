// src/lib/notifications.ts
// [CONTROL] Canonical notification writer. The `notifications` table has NO
// authenticated INSERT policy (verified via live pg_policies), so every write
// MUST go through service_role. This helper self-creates the pipeline client so a
// caller can no longer pass an anon client by mistake — the previous signature
// took a `supabase` param, which silently 42501'd when handed
// createServerSupabaseClient(). Server-only — never import in a client component.

import { createPipelineClient } from './supabase-pipeline'
import { sendPushToUser } from './push'
import { safeNotificationLink } from './notification-link'

/**
 * The five values the `type` CHECK constraint on public.notifications allows.
 * This is the ONE list. The routes that accept a type from the network validate
 * against it (see isNotificationType) — they used to keep their own literal copy,
 * which is how a sixth type gets accepted by a route and rejected by Postgres.
 */
export const NOTIFICATION_TYPES = ['invoice', 'payment', 'message', 'invite', 'status'] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** Narrow an untrusted value (request body) to a type the table will accept. */
export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value)
}

interface CreateNotifOptions {
  userId: string
  title: string
  body?: string | null
  type: NotificationType
  link?: string | null
  /**
   * [ONTVANGEN-MELDING] A durable name for the EVENT this notification reports, so a run that
   * crashes after telling the owner cannot tell them again on the retry.
   *
   * Everything else in a background pass can be made at-most-once by the database — the invoice by
   * a partial UNIQUE index, the payment by its replay key, the AI allowance by a per-document mark.
   * The bell could not: nothing about "an invoice was booked for document X" is unique in the
   * notifications table, so a crash between the notification and the end of the run produced a
   * second identical line the next time round. An owner who sees the same invoice announced twice
   * does not conclude "a worker restarted"; they go looking for the second invoice.
   *
   * Optional, and absent by default. The forty existing call sites report things that happen once
   * because a human pressed something, and they keep writing exactly the row they wrote before —
   * including on a database where the column does not exist yet.
   *
   * Shape: "<domain>:<event>:<id>", e.g. "intake:auto-finished:<documentId>".
   */
  eventKey?: string | null
}

/**
 * The outcome of one write. Callers that branch on failure (the cron rounds count
 * what they sent; the bridge routes log which side was not reached) get a value
 * instead of an exception — this function never throws, so a notification can
 * never take down the operation that triggered it.
 */
export interface NotificationResult {
  ok: boolean
  error: string | null
  /**
   * This exact event had already been reported, and nothing was written or pushed.
   *
   * `ok` is true, and that is not a softened failure: the owner HAS been told, which is the whole
   * purpose of the call. Only a caller that counts what it sent needs to tell the two apart.
   */
  duplicate?: boolean
}

/**
 * [ONTVANGEN-MELDING] What an insert error MEANS, as a value — the branch, away from the plumbing.
 *
 * Three of the four are indistinguishable at a glance, and getting them wrong costs different
 * things: a second push for an event already reported, a caller told "sent" when the guarantee it
 * asked for does not exist, or a real database failure read as success.
 */
export type NotificationInsertVerdict = 'written' | 'already_reported' | 'key_column_missing' | 'failed'

export function classifyNotificationInsert(
  error: { code?: string } | null | undefined,
  hasEventKey: boolean,
): NotificationInsertVerdict {
  if (!error) return 'written'
  // Both codes are only ever ABOUT the event key, so neither may be read as a verdict about a
  // notification that never carried one: an ordinary 23505 on some future constraint would
  // otherwise be reported to the caller as "already told them", with nothing written at all.
  if (!hasEventKey) return 'failed'
  if (error.code === '23505') return 'already_reported'
  if (error.code === '42703') return 'key_column_missing'
  return 'failed'
}

/** Write one notification for a user — always via service_role — and push it. */
export async function createNotification({
  userId,
  title,
  body,
  type,
  link,
  eventKey,
}: CreateNotifOptions): Promise<NotificationResult> {
  try {
    const pipeline = createPipelineClient()

    // [MELDING-TIK] The link is checked on the way IN, here, because this is the one door every
    // notification in the app goes through — all forty call sites, including the two routes that
    // read `link` out of a request body (POST /api/notifications/create and /notify-client). A
    // check placed in those two routes would be a list that the forty-first caller is not on.
    //
    // An unusable link is dropped, not fatal: the sentence is what the notification is FOR, and
    // refusing to tell an owner that his invoice was paid because someone handed the route a bad
    // path would be the wrong trade. It is logged rather than swallowed — a link that silently
    // becomes null is a tap that silently stops working.
    const veiligeLink = safeNotificationLink(link)
    if (link && !veiligeLink) {
      console.error('[NOTIFY] link geweigerd — melding wordt zonder link opgeslagen', {
        userId, type, link,
      })
    }
    // [NO-SILENT-EMPTY] The error was not read here at all. supabase-js does not
    // throw on a rejected write, so an RLS refusal, a CHECK violation on `type` or
    // a dead connection all left this function returning normally — and the caller,
    // which had just done the work the notification is about, went on believing the
    // owner had been told. Every insert in the app now runs through this one line,
    // so this was the single blind spot that covered all of them.
    // The column is only ever SENT when a caller asked for the guarantee. A notification without
    // an event key must write exactly the row it wrote before this existed — including on a
    // database where public.notifications.event_key has not been added yet.
    const key = typeof eventKey === 'string' && eventKey.trim() ? eventKey.trim() : null
    // ontvangen_melding_event_key.sql is applied BY HAND, and code ships before it runs. The column
    // is therefore not in the generated types — same relaxed handle, and for the same reason, as
    // the intake claim and the intake intent columns use on their tables.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = pipeline.from('notifications') as any
    const { error } = await rows.insert({
      user_id: userId,
      title,
      body: body ?? null,
      type,
      read: false,
      link: veiligeLink,
      ...(key ? { event_key: key } : {}),
    })

    const verdict = classifyNotificationInsert(error, key !== null)
    if (verdict === 'already_reported') {
      // The partial UNIQUE (user_id, event_key) refused it: this event was already reported. The
      // owner has the line and had the push; sending a second push now would be the duplicate the
      // key exists to prevent, arriving with no row of its own to point at.
      return { ok: true, error: null, duplicate: true }
    }
    if (verdict === 'key_column_missing') {
      // The column is not there. A caller that asked for the guarantee is told it could not be
      // given, rather than quietly getting a row that a retry will write again — the same
      // precondition rule store-raw-incoming.ts applies to the intent columns.
      console.error(
        '[ONTVANGEN-MELDING] notifications.event_key is absent — refusing this notification. Apply ontvangen_melding_event_key.sql before enabling the stored processor.',
        { userId, type },
      )
      return { ok: false, error: error?.message ?? 'event_key ontbreekt' }
    }
    if (error) {
      console.error('[NOTIFY] notification insert failed', {
        userId,
        type,
        error: error.message,
      })
      // [PUSH] Deliberately NO push on a failed write. The push is a pointer to the
      // row: it repeats the title and, on tap, opens `link`. Sending it anyway
      // produces a phone notification for a notification that does not exist — the
      // owner taps it, lands on the screen, finds nothing, and the bell that is
      // supposed to be the record is empty. A missed push is a silence; a push
      // without its row is a claim the app cannot back up.
      return { ok: false, error: error.message }
    }

    // [PUSH] Also deliver to the user's devices as a system notification. Strictly
    // best-effort: sendPushToUser never throws and no-ops when push is unconfigured
    // or the user has no subscribed device — the in-app row above is the source of
    // truth and must never be held hostage by a push delivery.
    await sendPushToUser(userId, { title, body, type, link: veiligeLink })
    return { ok: true, error: null }
  } catch (err) {
    // createPipelineClient() THROWS when the service-role env vars are missing, and
    // that throw used to land in the caller — in the middle of a route that had
    // already booked a payment or issued an invoice number. The notification is the
    // last step of every one of those; it reports, it does not decide.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[NOTIFY] notification write threw', { userId, type, error: message })
    return { ok: false, error: message }
  }
}
