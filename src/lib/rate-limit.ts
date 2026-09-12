// src/lib/rate-limit.ts
// [BOEK-SECURITY-2] Rate limiting helper — May 2026
// =====================================================
// يستخدم atomic DB function (check_rate_limit) — لا race conditions
// كل calls تمر عبر service_role (Pipeline client)
// =====================================================

import { createPipelineClient } from '@/lib/supabase-pipeline'
// [ALARM] Een beveiliging die niet draait moet iemand bereiken — zie report-handled.ts.
import { reportHandledFailure } from '@/lib/report-handled'

// ── Types ─────────────────────────────────────────────

export interface RateLimitCheck {
  /** Profile ID المستخدم */
  userId: string
  /** اسم الـ endpoint (للتمييز بين الحدود) — مثل '/api/email/sync' */
  endpoint: string
  /** الحد الأقصى للطلبات في الـ window */
  maxRequests: number
  /** طول الـ window بالدقائق */
  windowMinutes: number
}

export interface RateLimitResult {
  /** هل الطلب مسموح؟ */
  allowed: boolean
  /** الطلبات المتبقّية في الـ window الحالي */
  remaining: number
  /** متى يُعاد تعيين الـ window */
  resetAt: Date
}

// ── الحدود المعيارية (Configurable per-endpoint) ──────

export const RATE_LIMITS = {
  EMAIL_SYNC:          { maxRequests: 10, windowMinutes: 5 },     // 10 / 5min
  DOCUMENT_CLASSIFY:   { maxRequests: 50, windowMinutes: 60 },    // 50 / hour
  // [BULK-UITNODIGEN] Was 20/day — sized for one-at-a-time invites. An administratiekantoor
  // moving its bestand over invites 50-200 clients in ONE sitting (the bulk paste on
  // KlantenBeheer loops this same route), and 20 stopped that office a tenth of the way in.
  // 200 still bounds the spam surface: only a verified accountant account reaches the route,
  // every address is one they typed, and the duplicate-invite check swallows repeats.
  ACCOUNTANT_INVITE:   { maxRequests: 200, windowMinutes: 1440 }, // 200 / day
  INVOICE_SEND:        { maxRequests: 100, windowMinutes: 60 },   // 100 / hour
  // [UREN] Uren opschrijven is TYPEN, geen versturen. De ondernemer die een kwartaal bijwerkt
  // tikt er in één zitting zo honderdvijftig in, en INVOICE_SEND (100/uur) zou hem halverwege
  // stilzetten — precies de gebruiker die zijn uren nu eindelijk bijhoudt in plaats van in een
  // schrift. 300 is ruim boven wat iemand met de hand haalt en houdt de bovengrens gewoon bestaan.
  UREN_WRITE:          { maxRequests: 300, windowMinutes: 60 },   // 300 / hour
  // [ADRES-ECHT] Postcode lookups against PDOK. Generous because a person typing an address
  // triggers one per completed field and may correct it twice — but bounded, because an open
  // proxy in front of a FREE public register is how someone else's traffic becomes our ban.
  ADDRESS_LOOKUP:      { maxRequests: 400, windowMinutes: 60 },   // 400 / hour
  // [COST] AI/OCR calls to Claude — a per-user ceiling so one account can't drive
  // unbounded ANTHROPIC spend on the main intake/onboarding/email pipelines.
  AI_OCR:              { maxRequests: 240, windowMinutes: 60 },   // 240 AI reads / hour — a shop's month of receipts in one sitting (non-AI files no longer count)
  AI_TRANSLATE:        { maxRequests: 120, windowMinutes: 60 },   // 120 short text calls / hour
  // [BETAALVERZOEK] Public /pay/[token] read — anonymous surface. Bucketed per
  // TOKEN (a uuid), so a single leaked/shared link can't be hammered, while a real
  // customer refreshing the page a few times is never blocked.
  PUBLIC_PAY:          { maxRequests: 120, windowMinutes: 60 },   // 120 reads / hour per link
  // [SEC-COST] Public, login-free invoice scanner → paid Claude call. Durable per-IP ceiling so a
  // rotating-instance attacker can't drive unbounded ANTHROPIC spend (the in-route in-memory gate
  // is per-instance only). Sits just above the honest client's 3/day.
  PUBLIC_SCAN:         { maxRequests: 10, windowMinutes: 1440 },  // 10 scans / day per IP
  // [SNELSTART] Koppelen roept de SnelStart token-endpoint aan met een sleutel die de
  // gebruiker intikt. Een lage limiet houdt zowel typefouten als het uitproberen van
  // sleutels binnen de perken (SnelStart telt die pogingen aan hun kant ook mee).
  SNELSTART_CONNECT:   { maxRequests: 10, windowMinutes: 60 },    // 10 koppelpogingen / uur
  // Doorsturen is één HTTP-ronde per factuur. 20 batches/uur is ruim voor een kwartaal
  // in delen en ver onder de rate limits van de B2B-API.
  SNELSTART_PUSH:      { maxRequests: 20, windowMinutes: 60 },    // 20 push-batches / uur
  // [MATCH-BUTTON] De handmatige matchronde (/api/reconcile/run) leest het hele bankafschrift ×
  // alle open facturen — de zwaarste leespas van de app, nu met een knop erop. Idempotent, dus
  // vaker tikken verandert niets; de limiet houdt alleen het herhaald hameren van die leespas
  // binnen de perken. 20/uur is ruim: één ronde is genoeg, en de cron draait toch elk uur.
  RECONCILE_RUN:       { maxRequests: 20, windowMinutes: 60 },    // 20 matchrondes / uur
  // [DIEP-2] The year-scale read paths: XAF, IB-jaaroverzicht, UBL-export en het kwartaalpakket
  // lezen elk een heel jaar of kwartaal administratie in één GET, zonder AI en zonder plafond.
  // [DIEP-3] 150, niet 60: een kantoor met zeventig klanten dat aan het kwartaaleinde ALLE
  // pakketten in één zitting trekt is de bedoelde gebruiker, geen misbruiker — en de teller is
  // per BOEKHOUDER, niet per klant. 150 draagt dat kantoor ruim en stopt nog steeds elk script
  // dat de zwaarste leespas laat ronddraaien.
  HEAVY_EXPORT:        { maxRequests: 150, windowMinutes: 60 },   // 150 exports / hour
  // [DIEP-3] /api/ib-jaar is GEEN download maar de databron van het jaarscherm — elke mount,
  // elke jaarwissel, elke taalwissel is een fetch, en alles telt op de teller van de KIJKER
  // (een boekhouder die 70 klantjaren doorloopt: één emmer). Een schermlezing hoort niet onder
  // een exportplafond; dit is ruim genoeg voor élk kijkgedrag en stopt alleen een script.
  YEAR_SCREEN:         { maxRequests: 600, windowMinutes: 60 },   // 600 screen reads / hour
  // [DIEP-3] /api/export/ubl is één factuur per klik ("single-invoice export", zegt zijn eigen
  // kop) — een kwartaal factuur-voor-factuur overzetten is de bedoelde handeling en haalt
  // honderden klikken. Per handeling begrensd, zoals UREN_WRITE, niet als jaarexport.
  UBL_SINGLE:          { maxRequests: 300, windowMinutes: 60 },   // 300 single exports / hour
  // [DIEP-3] Elk bericht is óók een e-mail en een push naar de gekoppelde partij. De koppeling
  // begrenst WIE je kunt bereiken; dit begrenst HOE VAAK — ruim boven een echt gesprek, ver
  // onder een scriptje dat andermans inbox voltrekt.
  MESSAGE_SEND:        { maxRequests: 60, windowMinutes: 60 },    // 60 berichten / uur
  // [REPROCESS] "Boek mijn opgeslagen bestanden" downloadt in één klik tot 600 opgeslagen bestanden
  // uit Storage en haalt de tekst uit maximaal 250 PDF's. Qua bandbreedte en rekentijd de zwaarste
  // knop van de app — en hij had als enige zware route helemaal geen plafond. Er zit geen AI achter,
  // dus de AI-hekken raken hem niet; hij hoefde er alleen zelf nog een.
  // Ruim gekozen omdat de handeling idempotent is (upserts per dag): vaker klikken kán niets
  // toevoegen, dus 6 per uur remt alleen het herhaald hameren, nooit een eerlijke poging.
  DOCUMENTS_REPROCESS: { maxRequests: 6, windowMinutes: 60 },     // 6 boekrondes / uur
  // [ENABLEBANKING] Een bank koppelen start een autorisatie bij Enable Banking. Elke
  // poging laat daar een object achter, dus dit hek beschermt hun kant net zo goed als de onze.
  // 10 per uur is ruim voor iemand die twee rekeningen koppelt en één keer misklikt.
  BANK_CONNECT:        { maxRequests: 10, windowMinutes: 60 },    // 10 koppelpogingen / uur
  // De "ververs"-knop. De echte begrenzing zit bij de bank zelf (een handvol opvragingen per dag
  // per rekening, zie SYNC_MIN_INTERVAL_HOURS); dit hek voorkomt alleen dat iemand die limiet er
  // in één minuut doorheen jaagt en zijn eigen feed voor de rest van de dag stilzet.
  BANK_SYNC:           { maxRequests: 12, windowMinutes: 60 },    // 12 verversingen / uur
  // [FEEDBACK] De "er ging iets mis"-knop. Ruim, en met opzet: dit is het enige kanaal waarlangs
  // een ondernemer een probleem kwijt kan, en iemand die vastloopt schrijft soms drie keer achter
  // elkaar omdat hij eerst iets vergeten is. Een hek dat dán dichtklapt, maakt van een klacht over
  // de app een tweede klacht over de app. 20 per uur remt alleen een script.
  FEEDBACK_SEND:       { maxRequests: 20, windowMinutes: 60 },    // 20 meldingen / uur
} as const

// ── Main function ─────────────────────────────────────

/**
 * Checks and increments rate limit atomically via DB function.
 * NO race conditions — single SQL statement using INSERT ON CONFLICT.
 *
 * Usage:
 *   const limit = await checkRateLimit({
 *     userId,
 *     endpoint: '/api/email/sync',
 *     ...RATE_LIMITS.EMAIL_SYNC,
 *   })
 *   if (!limit.allowed) return rateLimitResponse(limit)
 */
export async function checkRateLimit({
  userId,
  endpoint,
  maxRequests,
  windowMinutes,
}: RateLimitCheck): Promise<RateLimitResult> {
  const supabase = createPipelineClient()

  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_user_id:        userId,
    p_endpoint:       endpoint,
    p_max_requests:   maxRequests,
    p_window_minutes: windowMinutes,
  })

  // لو فشل الـ RPC → نسمح (fail-open للوظيفة، fail-closed للأمان: قرار)
  // قرار: fail-open هنا — لو DB قاع، لا نوقف الـ users
  // الـ error يُسجَّل في logs للمراجعة
  if (error || !data || data.length === 0) {
    console.warn('[BOEK-SECURITY-2] Rate limit check failed — allowing request', {
      userId,
      endpoint,
      error: error?.message,
    })
    return {
      allowed:   true,
      remaining: maxRequests,
      resetAt:   new Date(Date.now() + windowMinutes * 60 * 1000),
    }
  }

  const row = data[0]
  return {
    allowed:   row.allowed,
    remaining: row.remaining,
    resetAt:   new Date(row.reset_at),
  }
}

// ── Helper: Next.js response للـ 429 ──────────────────

/**
 * Builds a 429 Too Many Requests response in Dutch.
 * Includes Retry-After header per HTTP spec.
 */
export function rateLimitResponse(limit: RateLimitResult): Response {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
  )

  return new Response(
    JSON.stringify({
      error: `Te veel verzoeken. Probeer over ${retryAfterSec} seconden opnieuw.`,
      retryAfter: limit.resetAt.toISOString(),
    }),
    {
      status: 429,
      headers: {
        'Content-Type':           'application/json',
        'Retry-After':            String(retryAfterSec),
        'X-RateLimit-Remaining':  String(limit.remaining),
        'X-RateLimit-Reset':      limit.resetAt.toISOString(),
      },
    }
  )
}
// ── [COST-GUARD] Anonymous, text-keyed rate limiting ──────────────────
//
// WHY A SECOND FUNCTION. `rate_limits.user_id` is `uuid NOT NULL` with a FOREIGN
// KEY to `profiles(id)`, and `check_rate_limit()` takes `p_user_id uuid`. Two
// callers were passing something that is neither:
//
//   · /api/tools/scan-invoice → 'scan-ip:1.2.3.4'  — not a uuid → cast error
//   · /api/pay/[token]        → invoices.pay_token — a uuid, but no such profile
//
// and checkRateLimit() above FAILS OPEN on any error. So both anonymous
// surfaces — including the login-free scanner that calls the PAID Claude API —
// had no durable ceiling at all, on every single request, permanently. The
// comment claiming a DB-backed limiter "holds the ceiling ACROSS instances" was
// describing something that never once executed.
//
// Fixed with a parallel text-keyed bucket (ai_spend_guard.sql) rather than by
// altering the uuid column, so no working authenticated path is touched.

/**
 * Rate-limit an ANONYMOUS caller by an arbitrary string key (an IP, a payment
 * token). Same atomic counter, different identity column.
 *
 * ⚠️ FAILS CLOSED. If the store errors, this REFUSES.
 *
 * That is the opposite of checkRateLimit() above, on purpose. Its fail-open is a
 * defensible availability choice for a logged-in user doing their bookkeeping —
 * we would rather serve them than protect a quota. But on an unauthenticated
 * path that spends money on every request, "allow when unsure" is not a
 * trade-off, it is the absence of a limit: exactly the bug this replaces. A
 * public visitor briefly seeing "try again later" costs nothing; an unbounded
 * Anthropic bill on a marketing page is unrecoverable.
 */
export async function checkRateLimitByKey({
  bucketKey,
  endpoint,
  maxRequests,
  windowMinutes,
  failOpen = false,
}: {
  bucketKey: string
  endpoint: string
  maxRequests: number
  windowMinutes: number
  /**
   * What to do when the STORE itself is unavailable (not when the caller is over
   * the limit — that always refuses).
   *
   * Default false = refuse, which is the only safe answer on a path that spends
   * money per request. Pass true for a read-only public path where turning a
   * real visitor away is the worse outcome — /api/pay/[token] is a customer
   * trying to pay an invoice, and it costs us nothing to serve.
   */
  failOpen?: boolean
}): Promise<RateLimitResult> {
  const onStoreFailure: RateLimitResult = failOpen
    ? { allowed: true, remaining: maxRequests, resetAt: new Date(Date.now() + windowMinutes * 60 * 1000) }
    : { allowed: false, remaining: 0, resetAt: new Date(Date.now() + windowMinutes * 60 * 1000) }

  const denied: RateLimitResult = {
    allowed: false,
    remaining: 0,
    resetAt: new Date(Date.now() + windowMinutes * 60 * 1000),
  }

  if (!bucketKey || !bucketKey.trim()) {
    // No identity means no ceiling is possible. Refuse.
    console.warn('[COST-GUARD] rate limit called with an empty bucket key — refusing', { endpoint })
    return denied
  }

  try {
    const supabase = createPipelineClient()
    // check_rate_limit_key is added by ai_spend_guard.sql and is not in the
    // generated types → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('check_rate_limit_key', {
      p_bucket_key:     bucketKey,
      p_endpoint:       endpoint,
      p_max_requests:   maxRequests,
      p_window_minutes: windowMinutes,
    })

    if (error || !data || data.length === 0) {
      // [ALARM] When the store is down and failOpen is set, the ceiling is simply GONE — every
      // public request is served. That is the right trade-off on a payment page (turning a real
      // customer away is worse), but it is a protection that has stopped running, and a protection
      // nobody knows is off is indistinguishable from one that was never there.
      reportHandledFailure({
        tag: 'COST-GUARD',
        message: `anonymous rate limit unavailable — ${failOpen ? 'allowing (ceiling is off)' : 'refusing'}`,
        severity: 'gate-unavailable',
        context: { endpoint, failOpen, error: error?.message ?? 'no rows' },
      })
      return onStoreFailure
    }

    const row = data[0]
    return {
      allowed:   Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      resetAt:   new Date(row.reset_at ?? Date.now() + windowMinutes * 60 * 1000),
    }
  } catch (err) {
    reportHandledFailure({
      tag: 'COST-GUARD',
      message: `anonymous rate limit threw — ${failOpen ? 'allowing (ceiling is off)' : 'refusing'}`,
      severity: 'gate-unavailable',
      context: { endpoint, failOpen, error: err instanceof Error ? err.message : String(err) },
    })
    return onStoreFailure
  }
}
