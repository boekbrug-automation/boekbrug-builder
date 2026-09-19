// src/lib/intake-derived.test.ts
// [ONTVANGEN] The same bytes describe the same file, whether a browser handed them over or
// storage did.

import { test } from "node:test"
import assert from "node:assert/strict"
import { describeBytes, readPdfLayer, deriveFileFacts } from "./intake-derived"
import { computeContentHash } from "./content-hash"

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const UBL = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">` +
  `<cbc:ID>2026-1</cbc:ID></Invoice>`,
)
const RUBBISH = Buffer.from("dit is gewoon tekst, geen factuur")

test("[ONTVANGEN] the bytes decide the type, not the browser's claim about them", () => {
  // [MIME-HONEST] An Android share sheet hands over a readable JPEG with an empty or generic
  // type. Trusting the claim is how a file ends up stored as octet-stream and downloads instead
  // of opening — and the sniff is the same sniff on both doors.
  assert.equal(describeBytes(JPEG, "bon.jpg", "").effectiveType, "image/jpeg")
  assert.equal(describeBytes(JPEG, "bon.jpg", "application/octet-stream").effectiveType, "image/jpeg")
  assert.equal(describeBytes(PNG, "bon.png", "").effectiveType, "image/png")
})

test("[ONTVANGEN] the declared type is a fallback, never a preference", () => {
  // Unsniffable bytes fall back to what the caller was told — File.type live, documents.file_type
  // from storage. Same role on both sides, which is what lets one function serve both.
  assert.equal(describeBytes(RUBBISH, "iets.bin", "text/plain").effectiveType, "text/plain")
  assert.equal(describeBytes(RUBBISH, "iets.bin", "").effectiveType, "")
})

test("[ONTVANGEN] an e-invoice is recognised from its bytes and costs no allowance", () => {
  const d = describeBytes(UBL, "factuur.xml", "text/xml")
  assert.equal(d.isEInvoice, true)
  assert.equal(d.okForAi, true, "it reaches the reader…")
  assert.notEqual(d.effectiveType, "text/xml", "…as an e-invoice, which is read mechanically")
})

test("[ONTVANGEN] a file named .pdf reaches the reader even when its bytes could not be sniffed", () => {
  // The backstop that was in the route: okForAi lets a .pdf through on the name alone, because
  // refusing a plausible invoice is worse than paying for one read that finds nothing.
  assert.equal(describeBytes(RUBBISH, "factuur.pdf", "").okForAi, true)
  assert.equal(describeBytes(RUBBISH, "aantekeningen.txt", "text/plain").okForAi, false)
})

test("[ONTVANGEN] 'is a PDF' and 'gave us text' are two questions", async () => {
  // A scanned PDF has no text layer and answers null. The daily-sales check still has to see it,
  // so a caller branching on pdfText would silently skip exactly the documents a shop photographs.
  const notPdf = await readPdfLayer(JPEG, "bon.jpg", "image/jpeg")
  assert.deepEqual(notPdf, { pdfText: null, pdfPages: 0, isPdf: false })

  // Bytes that claim .pdf by name but cannot be parsed: still treated as a PDF, still no text.
  const unreadable = await readPdfLayer(RUBBISH, "factuur.pdf", "")
  assert.equal(unreadable.isPdf, true, "it was treated as a PDF…")
  assert.equal(unreadable.pdfText, null, "…and gave nothing back, which is not the same thing")
})

test("[ONTVANGEN] a non-PDF is never parsed as one", async () => {
  // Cheapness is part of the contract: every image upload would otherwise pay for a PDF parse.
  for (const [bytes, name, type] of [[JPEG, "bon.jpg", "image/jpeg"], [UBL, "f.xml", "text/xml"]] as const) {
    const r = await readPdfLayer(bytes, name, describeBytes(bytes, name, type).effectiveType)
    assert.equal(r.isPdf, false, `${name} was parsed as a PDF`)
  }
})

test("[ONTVANGEN] the whole description is reproducible from bytes and a name alone", async () => {
  // The point of the module: no request, no File, no FormData. Whatever storage hands back, the
  // background pass describes it exactly as the live door described it.
  const live = await deriveFileFacts(JPEG, "bon.jpg", "image/jpeg")
  const fromStorage = await deriveFileFacts(Buffer.from(JPEG), "bon.jpg", "image/jpeg")
  assert.deepEqual(fromStorage, live)
  assert.equal(live.contentHash, computeContentHash(JPEG))
})

test("[ONTVANGEN] the composed answer is the two halves, with nothing invented in between", async () => {
  // Guards the split itself: the door calls the halves in its own order, the background pass calls
  // the whole. If they could disagree, the sharing would be decoration.
  const described = describeBytes(UBL, "factuur.xml", "text/xml")
  const layer = await readPdfLayer(UBL, "factuur.xml", described.effectiveType)
  const whole = await deriveFileFacts(UBL, "factuur.xml", "text/xml")
  assert.deepEqual(whole, { ...described, ...layer, contentHash: computeContentHash(UBL) })
})
