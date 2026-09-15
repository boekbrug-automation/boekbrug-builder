// src/app/api/tools/scan-invoice/route.ts
// [SCAN-TOOL] Public AI invoice scanner (lead-gen, login-free).
//
// A visitor uploads a PDF or photo of an invoice; we extract the key fields
// with Claude Haiku 4.5 and return them as structured JSON so they can be
// dropped straight into /factuur-maken.
//
// This endpoint calls the PAID Claude API on PUBLIC, unauthenticated traffic,
// so it is deliberately defensive:
//   · strict file-type allow-list (PDF / JPEG / PNG / WebP only)
//   · hard file-size cap (MAX_BYTES) — rejected before any Claude call
//   · per-IP server-side rate limit (in-memory sliding window) as an abuse
//     backstop on top of the client's 3-scans/day localStorage cap
//   · bounded max_tokens so a hostile file can't run up the output bill
//   · Haiku 4.5 (cheapest capable model) — ~$0.005 per scan
//
// The client cap is UX; this server cap is the real cost guard. In-memory
// state is per serverless instance (not shared/global), which is fine for a
// backstop — it caps sustained abuse from a single IP hitting a warm instance,
// while the small output-token ceiling caps the worst case per request.

import { NextRequest, NextResponse } from 'next/server'
// [DEUR-VANGNET] Eén vangnet voor elke deur waar een document binnenkomt.
import { withCrashNet } from '@/lib/route-crash-net'
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { reserveAiBudget, settleAiBudget, TOKEN_ESTIMATE, BUDGET_EXHAUSTED_MESSAGE } from '@/lib/ai-budget'
import { DEFAULT_CLAUDE_MODEL, resolveModel } from '@/lib/ai-model'

export const runtime = 'nodejs'
export const maxDuration = 30

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
// [MODEL-CONFIG] Zelfde bron als de rest van de app, en om dezelfde reden: een met de hand
// ingetypt model-id is hier twee keer een storing geworden (zie de kop van ai-model.ts). Deze
// route leest bewust alleen uit die kleine, pure module en niet uit ai.ts — dit is het enige
// login-vrije eindpunt, en het hoort licht te blijven.
const CLAUDE_MODEL = resolveModel(process.env.CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL)
const MAX_TOKENS = 1500

// Reject anything larger than this before touching Claude. Real invoices —
// even high-res phone photos — sit comfortably under 8 MB.
const MAX_BYTES = 8 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

// ── Per-IP rate limit (in-memory sliding window) ───────────────────────────
// Backstop against a single IP hammering the paid API. Window + limit chosen
// to sit just above the client's 3/day cap so honest users never hit it.
const RATE_LIMIT = 8 // requests
const RATE_WINDOW_MS = 60 * 60 * 1000 // per hour
const hits = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function rateLimited(ip: string, now: number): boolean {
  const cutoff = now - RATE_WINDOW_MS
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff)
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent)
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  // Opportunistic cleanup so the map can't grow unbounded on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      const live = v.filter((t) => t > cutoff)
      if (live.length === 0) hits.delete(k)
      else hits.set(k, live)
    }
  }
  return false
}

// ── Extraction contract ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an invoice-extraction engine for BoekBrug, a Dutch bookkeeping platform.
You receive one document (an invoice, receipt, or quote — possibly a photo or scan).
Extract the fields and return ONLY a single JSON object, no markdown, no prose.

Rules:
- Output valid JSON only. No code fences, no explanation.
- Money values: plain numbers with a dot decimal (1234.56), never thousands separators, never a currency symbol.
- Dates: ISO format YYYY-MM-DD. If a date is ambiguous, prefer the Dutch reading (day-month-year).
- If a field is absent, use null (for strings/numbers) or [] (for arrays). Never invent data.
- "is_invoice" is false for adverts, letters, or anything that is not a bill/receipt/quote.
- BTW = Dutch VAT. Group VAT by rate (21, 9, 0). "base" is the amount excl. BTW at that rate.

JSON shape:
{
  "is_invoice": boolean,
  "confidence": number,            // 0..1, your confidence this is a real invoice/receipt
  "document_type": "factuur" | "bon" | "offerte" | "onbekend",
  "vendor_name": string | null,
  "vendor_vat": string | null,     // BTW-nummer
  "vendor_kvk": string | null,
  "invoice_number": string | null,
  "invoice_date": string | null,   // YYYY-MM-DD
  "due_date": string | null,       // YYYY-MM-DD
  "currency": string | null,       // e.g. "EUR"
  "iban": string | null,
  "line_items": [
    { "description": string, "quantity": number | null, "unit_price": number | null, "amount": number | null }
  ],
  "subtotal_excl_btw": number | null,
  "btw_lines": [ { "rate": number, "base": number | null, "amount": number | null } ],
  "btw_total": number | null,
  "total_incl_btw": number | null
}`

const USER_PROMPT =
  'Extract the invoice fields from this document and return the JSON object exactly as specified. Return JSON only.'

interface ClaudeContentBlock {
  type: 'text' | 'document' | 'image'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

function buildContent(mime: string, base64: string): ClaudeContentBlock[] {
  const doc: ClaudeContentBlock =
    mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
  return [doc, { type: 'text', text: USER_PROMPT }]
}

// Strip an accidental ```json fence and pull the first {...} block, then parse.
function safeParseJSON(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  return withCrashNet(
    "SCAN-TOOL",
    "Er ging iets mis bij het lezen van dit bestand. Er is niets van jou bewaard — probeer het zo " +
      "meteen opnieuw.",
    () => runScan(req),
  )
}

async function runScan(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fail loudly-but-safely: never leak the config detail to the client.
    console.error('[SCAN-TOOL] ANTHROPIC_API_KEY is not set')
    return NextResponse.json(
      { error: 'De scanner is tijdelijk niet beschikbaar. Probeer het later opnieuw.' },
      { status: 503 }
    )
  }

  const now = Date.now()
  const ip = clientIp(req)
  if (rateLimited(ip, now)) {
    return NextResponse.json(
      { error: 'Je hebt het maximum aantal scans voor nu bereikt. Probeer het later opnieuw.' },
      { status: 429 }
    )
  }

  // Accept multipart/form-data with a single "file" field.
  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'Ongeldige upload.' }, { status: 400 })
  }

  if (!file) {
    return NextResponse.json({ error: 'Geen bestand ontvangen.' }, { status: 400 })
  }

  const mime = file.type
  if (!ALLOWED_TYPES.has(mime)) {
    return NextResponse.json(
      { error: 'Alleen PDF, JPG, PNG of WebP wordt ondersteund.' },
      { status: 415 }
    )
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Het bestand is te groot (max 8 MB) of leeg.' },
      { status: 413 }
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())
  // Double-check the decoded size (Content-Length can lie).
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Het bestand is te groot (max 8 MB).' }, { status: 413 })
  }
  const base64 = buf.toString('base64')

  // [SEC-COST] Durable cost gate — placed right before the PAID Claude call, after the cheap
  // validation above, so only requests that would actually spend money consume a scan slot.
  // The in-memory limiter is per serverless INSTANCE; this DB-backed, atomic limiter holds the
  // ceiling ACROSS instances (an attacker hitting cold/rotating instances can't bypass it).
  // Caveat: it is keyed on the client IP (clientIp reads x-forwarded-for), which a determined
  // attacker can rotate — so this bounds naive/single-source abuse, not a spoofing botnet; the
  // bounded max_tokens + Haiku model cap the worst case per surviving call. Fail-open only if the
  // limiter STORE itself errors (availability over a hard block).
  //
  // [COST-GUARD] This block used to be a no-op. It called checkRateLimit() with
  // `scan-ip:<ip>`, but that helper's RPC takes `p_user_id uuid` and writes into
  // a uuid column with a FOREIGN KEY to profiles — so the cast failed on EVERY
  // request, checkRateLimit failed open, and the "durable ceiling across
  // instances" described above never executed once. The only real guard was the
  // per-instance in-memory window, which this file already admits is bypassable.
  // Now keyed by text and FAIL-CLOSED: on an unauthenticated path that spends
  // money per request, "allow when unsure" is the absence of a limit.
  const durable = await checkRateLimitByKey({
    bucketKey: `scan-ip:${ip}`,
    endpoint: '/api/tools/scan-invoice',
    ...RATE_LIMITS.PUBLIC_SCAN,
  })
  if (!durable.allowed) return rateLimitResponse(durable)

  // [COST-GUARD] Second, independent ceiling: the GLOBAL daily euro budget. The
  // per-IP limit above bounds one visitor; this bounds the whole endpoint, which
  // is what a front-page moment or a rotating-proxy attacker actually needs.
  const budget = await reserveAiBudget({
    inputTokens: mime === 'application/pdf' ? TOKEN_ESTIMATE.rawPdfDocument : TOKEN_ESTIMATE.imageDocument,
    maxOutputTokens: MAX_TOKENS,
    label: 'public-scan',
  })
  if (!budget.allowed) {
    return NextResponse.json({ error: BUDGET_EXHAUSTED_MESSAGE }, { status: 503 })
  }

  let text: string
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Required for the PDF document block; harmless for image requests.
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildContent(mime, base64) }],
      }),
      // [LEZER-KLOK] This route's own ceiling is 30 s, and a stalled connection would spend all
      // of it and then be killed — so the visitor gets a platform error page instead of the
      // sentence below. Abort first, with room left to answer.
      signal: AbortSignal.timeout(22_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`[SCAN-TOOL] Claude API ${res.status}: ${detail.slice(0, 500)}`)
      return NextResponse.json(
        { error: 'Het scannen is mislukt. Probeer een duidelijkere foto of een PDF.' },
        { status: 502 }
      )
    }

    const data = await res.json()
    // [COST-GUARD] Settle before the shape check: an answer we cannot parse was
    // still paid for, and on THIS endpoint the reservation is the whole defence
    // — over-charging it by 3× shrinks the public scanner's daily capacity to a
    // third for no reason.
    await settleAiBudget({ reserved: budget, usage: data?.usage, label: 'public-scan' })
    const block = data.content?.[0]
    if (!block || block.type !== 'text' || typeof block.text !== 'string') {
      throw new Error('Unexpected Claude response shape')
    }
    text = block.text
  } catch (err) {
    console.error('[SCAN-TOOL] extraction error', err)
    return NextResponse.json(
      { error: 'Het scannen is mislukt. Probeer het later opnieuw.' },
      { status: 502 }
    )
  }

  const parsed = safeParseJSON(text)
  if (!parsed) {
    return NextResponse.json(
      { error: 'De factuur kon niet worden gelezen. Probeer een duidelijkere scan.' },
      { status: 422 }
    )
  }

  return NextResponse.json({ data: parsed })
}
