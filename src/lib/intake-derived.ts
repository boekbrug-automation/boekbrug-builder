// src/lib/intake-derived.ts
// [ONTVANGEN] What a file IS, derived from its bytes — the same answer live or from storage.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────
//
// /api/intake worked five facts out of the uploaded bytes before the reader ever ran: whether it
// is an e-invoice, what its media type really is, whether the AI path may have it at all, its
// content hash, and — for a PDF — its text layer and page count. The processor then acted on all
// five.
//
// After the cutover the processing happens when the browser is gone, so those five have to be
// worked out again from the object in storage. Written twice they would drift, and the drift
// would be invisible: both halves would keep answering, just not the same answer. A photo read
// live as an image and read later as something else does not fail — it books differently.
//
// So there is one derivation, and it takes only bytes and a name. No request, no File, no
// FormData. That is also what makes it testable: the same buffer must produce the same facts
// whichever door handed it over.
//
// ── ONE THING IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────
//
// It does not run the daily-sales branch that today sits inside the same `if` as the text-layer
// read. That branch ANSWERS the request — it returns a response and stops — so it belongs to the
// door, not to the description of a file. Moving it here would have a pure function decide the
// outcome of an upload.

import { computeContentHash } from "@/lib/content-hash"
import { sniffReadableMime } from "@/lib/detect-file"
import { looksLikeInvoiceXmlBytes, E_INVOICE_XML_MIME } from "@/lib/e-invoice"
import { readPdfTextLayer } from "@/lib/pdf-text"

export interface DerivedFileFacts {
  /** A Peppol/UBL invoice, read mechanically — no model, and so no allowance spent. */
  isEInvoice: boolean
  /**
   * The media type the BYTES say, not the one the browser claimed.
   *
   * [MIME-HONEST] An Android share sheet or a mobile WebView hands over a perfectly readable
   * PDF or JPEG with an empty or generic MIME type. Trusting that claim is how a PDF ends up
   * stored as octet-stream and downloads instead of opening.
   */
  effectiveType: string
  /** May the extractor have this at all? PDF, image, or an e-invoice. */
  okForAi: boolean
  /** The identity of these bytes — the cross-door duplicate key. */
  contentHash: string
  /**
   * The text layer, pulled ONCE. Null both for a file that is not a PDF AND for a PDF whose text
   * could not be extracted — which is why `isPdf` exists beside it.
   */
  pdfText: string | null
  pdfPages: number
  /**
   * Was this treated as a PDF at all?
   *
   * Not the same question as "did we get text out of it", and conflating them is a behaviour
   * change: a scanned PDF with no text layer reads as null, and the daily-sales check still has
   * to run on it. A caller branching on `pdfText !== null` would silently skip those.
   */
  isPdf: boolean
}

/** True when the name alone claims a PDF — the backstop for bytes that could not be sniffed. */
function namedPdf(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf")
}

/**
 * What kind of file is this? Cheap: sniffing and a name, no parsing.
 *
 * `declaredType` is the fallback when the bytes cannot be sniffed: the browser's `File.type` on
 * the live path, and `documents.file_type` on the stored one. Same role in both — a claim to fall
 * back on, never a claim to prefer.
 */
export function describeBytes(
  buffer: Buffer,
  fileName: string,
  declaredType: string,
): Pick<DerivedFileFacts, "isEInvoice" | "effectiveType" | "okForAi"> {
  const isEInvoice = looksLikeInvoiceXmlBytes(buffer)
  const effectiveType = isEInvoice ? E_INVOICE_XML_MIME : (sniffReadableMime(buffer) ?? declaredType)
  return {
    isEInvoice,
    effectiveType,
    okForAi:
      effectiveType === "application/pdf" ||
      effectiveType.startsWith("image/") ||
      isEInvoice ||
      namedPdf(fileName),
  }
}

/** The text layer and page count, pulled ONCE. See `isPdf` for why the answer is three fields. */
export async function readPdfLayer(
  buffer: Buffer,
  fileName: string,
  effectiveType: string,
): Promise<Pick<DerivedFileFacts, "pdfText" | "pdfPages" | "isPdf">> {
  if (effectiveType !== "application/pdf" && !namedPdf(fileName)) {
    return { pdfText: null, pdfPages: 0, isPdf: false }
  }
  const read = await readPdfTextLayer(buffer)
  return { pdfText: read.text, pdfPages: read.pages, isPdf: true }
}

/**
 * Everything at once — what a caller with no request needs before it can start.
 *
 * Split into the two halves above rather than only this, because the live door works them out at
 * two different MOMENTS with early returns in between: a bank export or a spreadsheet answers and
 * leaves long before any PDF would be parsed. Composing here keeps one implementation of each
 * rule while leaving the door's order, and its cost, exactly as they are.
 */
export async function deriveFileFacts(
  buffer: Buffer,
  fileName: string,
  declaredType: string,
): Promise<DerivedFileFacts> {
  const described = describeBytes(buffer, fileName, declaredType)
  const layer = await readPdfLayer(buffer, fileName, described.effectiveType)
  return { ...described, ...layer, contentHash: computeContentHash(buffer) }
}
