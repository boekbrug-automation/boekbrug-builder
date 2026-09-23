// [DOORGESTUURD] Pure node test — run: npx tsx --test src/lib/mime-attachments.test.ts
//
// A supplier bill very often arrives FORWARDED: the mail carries the original message, and the
// invoice is inside that. Gmail hands us such a message already unpacked. Outlook returns it as an
// `itemAttachment` with no bytes at all, and the fetcher's first line dropped it — no row, no file,
// no notification, not even a skip-registry entry.
//
// The fixtures below are real message shapes, written out by hand rather than generated, because
// the failures this parser has to survive are all in the punctuation: folded headers, both line
// endings, encoded filenames, a boundary string sitting inside base64.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { extractMimeAttachments, base64ByteLength, uniqueAttachmentName, distinctAttachmentNames } from './mime-attachments'
import { normalizeAttachmentMime } from './email-integration'

const opts = { normalizeMime: normalizeAttachmentMime }

/** A tiny but real base64 payload — long enough that the size arithmetic is meaningful. */
const PDF_B64 = Buffer.from('%PDF-1.4\n'.repeat(40)).toString('base64')

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

test('[DOORGESTUURD] the invoice inside a forwarded message is found', () => {
  // The ordinary shape: someone forwards the supplier's mail, and the PDF is one level down inside
  // a message/rfc822 part. This is what an Outlook itemAttachment turns into once Graph hands over
  // its raw MIME.
  const raw = crlf(`From: bookkeeper@example.nl
Subject: FW: factuur maart
Content-Type: multipart/mixed; boundary="OUTER"

--OUTER
Content-Type: text/plain

Hoi, zie bijlage.
--OUTER
Content-Type: message/rfc822
Content-Disposition: attachment; filename="doorgestuurd.eml"

From: leverancier@example.com
Subject: Factuur 2026-0418
Content-Type: multipart/mixed; boundary="INNER"

--INNER
Content-Type: text/plain

Bijgaand onze factuur.
--INNER
Content-Type: application/pdf; name="factuur-2026-0418.pdf"
Content-Disposition: attachment; filename="factuur-2026-0418.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
--INNER--
--OUTER--
`)
  const found = extractMimeAttachments(raw, opts)
  assert.equal(found.length, 1, 'exactly the invoice, not the covering notes')
  assert.equal(found[0].filename, 'factuur-2026-0418.pdf')
  assert.equal(found[0].mimeType, 'application/pdf')
  assert.ok(found[0].size > 300, 'the size is the DECODED byte length, not the base64 length')
  assert.equal(Buffer.from(found[0].base64, 'base64').toString('latin1').slice(0, 5), '%PDF-')
})

test('[DOORGESTUURD] text, HTML and calendar parts are not invoices', () => {
  const raw = crlf(`Content-Type: multipart/alternative; boundary="B"

--B
Content-Type: text/plain

hallo
--B
Content-Type: text/html

<p>hallo</p>
--B
Content-Type: text/calendar; name="uitnodiging.ics"
Content-Transfer-Encoding: base64

${Buffer.from('BEGIN:VCALENDAR').toString('base64')}
--B--
`)
  assert.deepEqual(extractMimeAttachments(raw, opts), [])
})

test('[DOORGESTUURD] a folded filename header is read whole', () => {
  // RFC 5322 lets a long header run over several lines. Reading only the first one yields a
  // TRUNCATED name — which then fails the extension test, and a real invoice is dropped for the
  // way its filename happened to be wrapped.
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf
Content-Disposition: attachment;
\tfilename="factuur-van-de-groothandel-maart-2026.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`)
  const found = extractMimeAttachments(raw, opts)
  assert.equal(found.length, 1)
  assert.equal(found[0].filename, 'factuur-van-de-groothandel-maart-2026.pdf')
})

test('[DOORGESTUURD] an encoded filename keeps its extension', () => {
  // =?UTF-8?B?…?= is what every client emits the moment a name carries an accent or a space. Left
  // encoded the name ends in "?=", so every type test downstream reads it as an unknown format.
  const b64name = Buffer.from('factuur café.pdf', 'utf8').toString('base64')
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf
Content-Disposition: attachment; filename="=?UTF-8?B?${b64name}?="
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`)
  const found = extractMimeAttachments(raw, opts)
  assert.equal(found.length, 1)
  assert.equal(found[0].filename, 'factuur café.pdf')

  // …and the RFC 2231 form, which is the other half of the same problem.
  const raw2 = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf
Content-Disposition: attachment; filename*=UTF-8''factuur%20juli.pdf
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`)
  assert.equal(extractMimeAttachments(raw2, opts)[0].filename, 'factuur juli.pdf')
})

test('[DOORGESTUURD] a mislabelled MIME still gets in on its extension', () => {
  // The single most common real defect in supplier mail: a genuine factuur.pdf stamped
  // application/octet-stream by the sending server. normalizeAttachmentMime is the app's one rule
  // for that, and it is INJECTED here rather than reimplemented — two answers to "is this readable"
  // is how a file gets dropped by one door and accounted for by the other.
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/octet-stream; name="factuur.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`)
  const found = extractMimeAttachments(raw, opts)
  assert.equal(found.length, 1)
  assert.equal(found[0].mimeType, 'application/pdf')
})

test('[DOORGESTUURD] an SVG is refused here too, for the same reason as everywhere else', () => {
  // An SVG is XML that can carry <script>; storing one and later serving it inline is stored XSS.
  // The rule lives in normalizeAttachmentMime, and this asserts the parser does not route around it.
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: image/svg+xml; name="logo.svg"
Content-Transfer-Encoding: base64

${Buffer.from('<svg/>').toString('base64')}
--B--
`)
  assert.deepEqual(extractMimeAttachments(raw, opts), [])
})

test('[DOORGESTUURD] the boundary is only a boundary at the start of a line', () => {
  // A boundary marker is ordinary text, and it can legitimately occur inside a line — a header
  // quoting it, a covering note pasting the raw source. Matching it anywhere on the line splits
  // there, which cuts a part's HEADERS away from its payload: the half with the filename has no
  // base64 and the half with the base64 has no filename, so both are refused and the invoice
  // disappears without a word.
  //
  // The first version of this test put "notaboundaryB" in the payload, which does not contain the
  // marker at all — so it passed just as happily with the anchor removed. A fixture that cannot
  // fail is not a test.
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf; name="factuur.pdf"
Content-Description: zie --B hierboven
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`)
  const found = extractMimeAttachments(raw, opts)
  assert.equal(found.length, 1, 'the part survived the marker sitting inside one of its headers')
  assert.equal(found[0].filename, 'factuur.pdf')
  assert.equal(found[0].base64, PDF_B64.replace(/[^A-Za-z0-9+/=]/g, ''), 'and its payload is whole')
})

test('[DOORGESTUURD] bare-LF messages parse exactly like CRLF ones', () => {
  // Both endings occur in the wild, sometimes inside one message. A parser that only knows CRLF
  // finds no headers at all and returns nothing — which reads identically to "no attachments".
  const body = `Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf; name="factuur.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
--B--
`
  assert.equal(extractMimeAttachments(body, opts).length, 1, 'bare LF')
  assert.equal(extractMimeAttachments(crlf(body), opts).length, 1, 'CRLF')
})

test('[DOORGESTUURD] the walk is bounded — this input comes from outside', () => {
  // A mail can nest without limit, and this runs inside the sync loop on untrusted post. Depth and
  // part count are capped; the cap holds without throwing, because an exception here would take
  // down the import of every other message in the batch.
  let nested = crlf(`Content-Type: application/pdf; name="diep.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
`)
  for (let i = 0; i < 12; i++) {
    nested = crlf(`Content-Type: message/rfc822

`) + nested
  }
  const found = extractMimeAttachments(nested, { ...opts, maxDepth: 4 })
  assert.deepEqual(found, [], 'past the depth cap it stops, and stops quietly')

  // And the ordinary depth still works, so the cap is a ceiling and not a wall.
  const shallow = crlf(`Content-Type: message/rfc822

Content-Type: application/pdf; name="ok.pdf"
Content-Transfer-Encoding: base64

${PDF_B64}
`)
  assert.equal(extractMimeAttachments(shallow, opts).length, 1)
})

test('[DOORGESTUURD] only base64 counts — a part we cannot decode is not an attachment', () => {
  const raw = crlf(`Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: application/pdf; name="factuur.pdf"
Content-Transfer-Encoding: quoted-printable

=25PDF-1.4
--B--
`)
  assert.deepEqual(extractMimeAttachments(raw, opts), [])
})

test('[DOORGESTUURD] two forwarded bills with the same filename stay two bills', () => {
  // The import keys every attachment as `${messageId}:${filename}`. One forwarded mail carrying two
  // originals that both call their invoice "factuur.pdf" produces one key — and the second bill is
  // then dropped as already-seen. That is the same silent loss this file exists to end, arriving
  // from the other side.
  const taken = new Set<string>()
  assert.equal(uniqueAttachmentName('factuur.pdf', taken), 'factuur.pdf')
  assert.equal(uniqueAttachmentName('factuur.pdf', taken), 'factuur (2).pdf')
  assert.equal(uniqueAttachmentName('factuur.pdf', taken), 'factuur (3).pdf')
  // A different name is untouched, and an extensionless one still gets a distinct identity.
  assert.equal(uniqueAttachmentName('bon.jpg', taken), 'bon.jpg')
  assert.equal(uniqueAttachmentName('scan', taken), 'scan')
  assert.equal(uniqueAttachmentName('scan', taken), 'scan (2)')
})

test('[ARCHIEF-WAAR] repeated names become distinct; every first occurrence keeps its name', () => {
  // Two "bundle.zip" in one message: the second is renamed, the first keeps the name any key
  // registered before this was built from.
  assert.deepEqual(distinctAttachmentNames(['bundle.zip', 'bundle.zip'], new Set()), ['bundle.zip', 'bundle (2).zip'])
  // A name that occurs once is never touched — even when a repeat would have wanted it. The
  // repeat moves on to the next free number instead.
  assert.deepEqual(
    distinctAttachmentNames(['x.pdf', 'x.pdf', 'x (2).pdf'], new Set()),
    ['x.pdf', 'x (3).pdf', 'x (2).pdf'],
  )
  // Distinct names come through unchanged, and the set is left holding every name handed out.
  const taken = new Set<string>()
  assert.deepEqual(distinctAttachmentNames(['a.pdf', 'b.zip'], taken), ['a.pdf', 'b.zip'])
  assert.deepEqual([...taken].sort(), ['a.pdf', 'b.zip'])
})

test('[DOORGESTUURD] the size is the file, not its encoding', () => {
  // base64 is 4 characters per 3 bytes. Measuring the encoded length would put every attachment a
  // third over its real size — straight through the 10 MB ceiling, refusing files that fit.
  assert.equal(base64ByteLength(Buffer.from('a'.repeat(3000)).toString('base64')), 3000)
  assert.equal(base64ByteLength(Buffer.from('ab').toString('base64')), 2, 'padding is not payload')
  assert.equal(base64ByteLength(Buffer.from('a').toString('base64')), 1)
  assert.equal(base64ByteLength(''), 0)
})
