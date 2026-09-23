// src/lib/mime-attachments.ts
// [DOORGESTUURD] Read the attachments out of a raw RFC-822 message. Pure, no I/O, no AI.
// Run: npx tsx --test src/lib/mime-attachments.test.ts
//
// ── WHY THIS EXISTS ──
// A supplier bill very often arrives as a FORWARDED e-mail: the bookkeeper's mail carries the
// original message, and the invoice PDF is inside that. Gmail hands us such a message already
// unpacked — its payload nests the forwarded message's own parts, and the fetcher's walk descends
// into them — so that door has always worked.
//
// Outlook does not. Microsoft Graph returns a forwarded message as an `itemAttachment`, which
// carries no `contentBytes` at all, and the fetcher's very first line dropped it:
//
//     if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue
//
// No row, no file, no notification, no skip registry entry. For an Outlook user the entire
// forwarding habit — the most ordinary way an invoice reaches a bookkeeper — was a hole with
// nothing at the bottom of it.
//
// Graph will hand over the raw MIME of an embedded item ($value), so what is missing is the
// ability to read it. That is what this file is.
//
// ── WHY A PARSER AND NOT A LIBRARY ──
// The job is narrow: find the parts that are PDFs or images, take their base64, and hand them to
// the same gate every other attachment goes through. That does not need a full MIME implementation
// and it must not depend on one — this runs inside the sync loop, on untrusted mail, and every
// dependency there is a new way for the whole import to fail.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──
// It does not decode message bodies, does not follow references, does not care about text, HTML,
// calendars or signatures. It refuses anything that is not base64: a binary PDF inside MIME is
// base64 by construction, so a part encoded any other way is not the thing we are looking for.
// Everything is bounded — depth, part count, total size — because this input arrives from outside.

/** One attachment found inside a message, in the shape the fetchers already pass around. */
export interface EmbeddedAttachment {
  filename: string
  /** Normalised by the caller's own MIME rule — never the raw header. */
  mimeType: string
  /** Standard base64, whitespace stripped. */
  base64: string
  /** Decoded byte length, so the size gate measures the file and not its encoding. */
  size: number
}

export interface MimeExtractOptions {
  /**
   * How the caller decides whether a part is worth keeping. Injected rather than imported so this
   * file has no dependency on the e-mail module, and so BOTH sides always apply the SAME rule —
   * a second copy of "is this a readable type" is a second answer.
   * Returns the normalised media type, or null to drop the part.
   */
  normalizeMime: (contentType: string, filename: string) => string | null
  /** An e-mail inside an e-mail inside an e-mail. Bounded — the input is untrusted. */
  maxDepth?: number
  /** Refuse to walk a pathological part tree. */
  maxParts?: number
}

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_PARTS = 200

/**
 * Every PDF/image attachment in a raw RFC-822 message, including the ones nested inside forwarded
 * copies of it.
 *
 * `raw` is the message as bytes. Decoded as latin1 on purpose: MIME headers and base64 payloads are
 * ASCII, and latin1 is the one encoding that maps every byte to exactly one character, so nothing
 * shifts underneath the offsets. UTF-8 would mangle a header with an accented filename into
 * replacement characters and change the string's length while doing it.
 */
export function extractMimeAttachments(
  raw: Buffer | string,
  opts: MimeExtractOptions,
): EmbeddedAttachment[] {
  const text = typeof raw === 'string' ? raw : raw.toString('latin1')
  const out: EmbeddedAttachment[] = []
  const budget = { parts: opts.maxParts ?? DEFAULT_MAX_PARTS }
  walkEntity(text, opts, 0, budget, out)
  return out
}

interface Budget { parts: number }

function walkEntity(
  entity: string,
  opts: MimeExtractOptions,
  depth: number,
  budget: Budget,
  out: EmbeddedAttachment[],
): void {
  if (depth > (opts.maxDepth ?? DEFAULT_MAX_DEPTH)) return
  if (budget.parts <= 0) return
  budget.parts--

  const { headers, body } = splitHeaders(entity)
  const contentType = headerValue(headers, 'content-type') ?? ''
  const baseType = contentType.split(';')[0].trim().toLowerCase()

  // A container. Split on its own boundary and recurse — this is also how a forwarded message's
  // attachments are reached, since message/rfc822 wraps a whole entity of its own.
  if (baseType.startsWith('multipart/')) {
    const boundary = headerParam(contentType, 'boundary')
    if (!boundary) return
    for (const part of splitOnBoundary(body, boundary)) {
      walkEntity(part, opts, depth + 1, budget, out)
    }
    return
  }

  // An embedded message: its body IS another entity, headers and all.
  if (baseType === 'message/rfc822' || baseType === 'message/global') {
    walkEntity(body, opts, depth + 1, budget, out)
    return
  }

  // A leaf. Only base64 can carry a PDF or an image; anything else is text, and a part we cannot
  // decode is not one we can hand to a reader.
  const encoding = (headerValue(headers, 'content-transfer-encoding') ?? '').trim().toLowerCase()
  if (encoding !== 'base64') return

  const disposition = headerValue(headers, 'content-disposition') ?? ''
  const filename =
    headerParam(disposition, 'filename') ??
    headerParam(contentType, 'name') ??
    ''
  if (!filename) return

  const mimeType = opts.normalizeMime(baseType, filename)
  if (!mimeType) return

  const base64 = body.replace(/[^A-Za-z0-9+/=]/g, '')
  if (base64.length === 0) return

  out.push({ filename, mimeType, base64, size: base64ByteLength(base64) })
}

/** Headers end at the first empty line. Both line endings occur in the wild, often in one message. */
function splitHeaders(entity: string): { headers: string; body: string } {
  const s = entity.replace(/^\r?\n/, '')
  const idx = findHeaderEnd(s)
  if (idx < 0) return { headers: s, body: '' }
  return { headers: s.slice(0, idx), body: s.slice(skipBlankLine(s, idx)) }
}

/**
 * One top-level header of a raw message, decoded.
 *
 * Used for the FROM of a forwarded message. The outer mail was sent by whoever forwarded it — often
 * the owner themselves — and attributing the supplier's invoice to that address puts the wrong
 * e-mail on the crediteur and lets a sender rule for the real supplier miss it entirely.
 */
export function mimeHeader(raw: Buffer | string, name: string): string | null {
  const text = typeof raw === 'string' ? raw : raw.toString('latin1')
  const { headers } = splitHeaders(text)
  const value = headerValue(headers, name)
  return value ? decodeEncodedWords(value) : null
}

function findHeaderEnd(s: string): number {
  const crlf = s.indexOf('\r\n\r\n')
  const lf = s.indexOf('\n\n')
  if (crlf < 0) return lf
  if (lf < 0) return crlf
  return Math.min(crlf, lf)
}

function skipBlankLine(s: string, idx: number): number {
  return s.startsWith('\r\n\r\n', idx) ? idx + 4 : idx + 2
}

/**
 * One header's value, unfolded.
 *
 * RFC 5322 lets a long header run over several lines, each continuation starting with whitespace.
 * A filename split across two lines is completely ordinary, and reading only the first line of it
 * yields a truncated name — which then fails the extension test and silently drops a real invoice.
 */
function headerValue(headers: string, name: string): string | null {
  const lines = headers.split(/\r?\n/)
  const want = name.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const colon = lines[i].indexOf(':')
    if (colon < 0) continue
    if (lines[i].slice(0, colon).trim().toLowerCase() !== want) continue
    let value = lines[i].slice(colon + 1)
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
      value += ' ' + lines[++i].trim()
    }
    return value.trim()
  }
  return null
}

/**
 * A parameter out of a header value: `filename="factuur juli.pdf"`, `name=factuur.pdf`, or the
 * RFC 2231 extended form `filename*=UTF-8''factuur%20juli.pdf` that mail clients use as soon as a
 * name carries a space or an accent.
 */
function headerParam(headerLine: string, param: string): string | null {
  const p = param.toLowerCase()

  // RFC 2231 extended form first — when both are present it is the accurate one.
  const ext = new RegExp(`(?:^|;)\\s*${p}\\*\\s*=\\s*([^;]+)`, 'i').exec(headerLine)
  if (ext) {
    const raw = ext[1].trim()
    // charset'language'percent-encoded-value
    const parts = raw.split("'")
    const encoded = parts.length >= 3 ? parts.slice(2).join("'") : raw
    return decodeRfc2231(encoded)
  }

  const quoted = new RegExp(`(?:^|;)\\s*${p}\\s*=\\s*"([^"]*)"`, 'i').exec(headerLine)
  if (quoted) return decodeEncodedWords(quoted[1].trim()) || null

  const bare = new RegExp(`(?:^|;)\\s*${p}\\s*=\\s*([^;\\s]+)`, 'i').exec(headerLine)
  if (bare) return decodeEncodedWords(bare[1].trim()) || null

  return null
}

function decodeRfc2231(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded) || null
  } catch {
    // A malformed percent escape is not a reason to lose the attachment — keep the raw name.
    return encoded || null
  }
}

/**
 * RFC 2047 encoded words: `=?UTF-8?B?ZmFjdHV1ci5wZGY=?=` / `=?UTF-8?Q?factuur=2Epdf?=`.
 *
 * Worth handling for one reason only: the extension. A name left encoded ends in `?=`, so every
 * type test downstream reads it as an unknown format and the invoice is dropped for the way its
 * filename was written.
 */
function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, kind: string, payload: string) => {
      try {
        const enc = charset.toLowerCase() === 'utf-8' ? 'utf8' : 'latin1'
        if (kind.toLowerCase() === 'b') {
          return Buffer.from(payload, 'base64').toString(enc)
        }
        const bytes = payload
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        return Buffer.from(bytes, 'latin1').toString(enc)
      } catch {
        return whole
      }
    },
  )
}

/**
 * The parts between `--boundary` lines.
 *
 * Anchored to the start of a line, which is what keeps a boundary-looking run of characters inside
 * a base64 payload from cutting a part in half. The closing `--boundary--` ends the list; anything
 * after it is the epilogue and belongs to nobody.
 */
function splitOnBoundary(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  const parts: string[] = []
  const lines = body.split(/\r?\n/)
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (current) parts.push(current.join('\n'))
      // `--boundary--` closes the multipart; nothing after it is a part.
      if (line.slice(marker.length).trimEnd() === '--') return parts
      current = []
      continue
    }
    if (current) current.push(line)
  }
  if (current) parts.push(current.join('\n'))
  return parts
}

/** How many bytes this base64 decodes to — the number the size gate must measure. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

/**
 * Make a filename unique WITHIN one message.
 *
 * The import keys every attachment as `${messageId}:${filename}`, and one forwarded mail can carry
 * two originals that both call their invoice "factuur.pdf". Identical keys read as a duplicate, so
 * the second bill would be dropped as already-seen — the exact silent loss this whole file is here
 * to end, arriving from the other side. The byte-hash gate still catches a genuine duplicate; this
 * only stops two DIFFERENT invoices from sharing one identity.
 */
export function uniqueAttachmentName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) { taken.add(name); return name }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!taken.has(candidate)) { taken.add(candidate); return candidate }
  }
  return name
}

/**
 * [ARCHIEF-WAAR] Give every attachment of one message a name of its own, in the order given.
 *
 * Two attachments of one message can carry the same name — a sender that exports "bundle.zip"
 * twice — and every key the mail sync keeps is built from that name: the loose key and each
 * archive member's key. A shared name is a shared outcome: a member that failed counts as known
 * through its namesake, and the watermark moves past it.
 *
 * A key registered before this existed must stay valid, so nothing already distinct changes:
 * the first occurrence of every name keeps it (a name that occurs once is never touched, even one
 * that looks like "factuur (2).pdf"), and only the repeats are renamed. The order has to be stable
 * for the message; that is the caller's to guarantee.
 */
export function distinctAttachmentNames(names: readonly string[], taken: Set<string>): string[] {
  const kept = names.map((name) => {
    if (taken.has(name)) return null
    taken.add(name)
    return name
  })
  return kept.map((name, i) => name ?? uniqueAttachmentName(names[i], taken))
}
