// src/lib/creditnota.ts
// [CREDITNOTA-REF] The sentence a credit note is legally required to carry. Pure; no I/O.
// Run: npx tsx src/lib/creditnota.test.ts
//
// Art. 219 Richtlijn 2006/112/EG (art. 35 Wet OB): a document that amends an earlier invoice is
// only EQUATED WITH an invoice when it "refers specifically and unambiguously to the initial
// invoice". A credit note that names only itself is not such a document.
//
// The generated PDF used to say exactly one thing: "Deze creditnota crediteert het bovenstaande
// bedrag. Er is geen betaling vereist." — its own number, its own date, negative amounts, and no
// word about WHICH invoice it corrects. Every credit note the app produced was therefore formally
// deficient: the customer's own correction can be challenged, and the owner's BTW correction is
// left without its documentary basis.
//
// The link was always there (invoices.original_invoice_id, written and FK-guarded by the
// creditnota route) — it simply never reached the page.
//
// [CREDITNOTA-EXTERN] A STANDALONE creditnota — for an invoice issued outside BoekBrug — has no
// row to link. Its reference is what the owner typed: credited_invoice_number and
// credited_invoice_date (creditnota_external_reference.sql). creditReferenceOf() merges the two
// sources, the linked one first; checkStandaloneCreditnota() is the send door's refusal for a
// standalone creditnota that names nothing, because art. 219 leaves no third option.

/** ISO 'YYYY-MM-DD' → 'DD-MM-YYYY'. Pure string surgery, so no timezone can shift the day. */
function dayNL(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * The reference line for a credit note, or null when there is nothing to point at.
 *
 * Returns null rather than a vague sentence when the original's number is unknown: an
 * unidentifiable reference is not a reference, and printing "corrigeert een eerdere factuur"
 * would look like compliance without being it. A legacy credit note whose link was never stored
 * cannot be repaired at render time — that is a data gap, not something to paper over.
 *
 * The DATE is included when known. It is not required by itself, but it is what makes the
 * reference unambiguous when a number was ever reused across years.
 */
export function creditnotaReferenceLine(args: {
  originalNumber: string | null | undefined;
  originalDate?: string | null;
}): string | null {
  const number = String(args.originalNumber ?? "").trim();
  if (!number) return null;
  const day = dayNL(args.originalDate);
  return day
    ? `Deze creditnota corrigeert factuur ${number} van ${day}.`
    : `Deze creditnota corrigeert factuur ${number}.`;
}

/**
 * [CREDITNOTA-EXTERN] The reference a creditnota prints: the linked original when there is one,
 * the external number and date the owner typed when there is not. Whitespace is not a number.
 */
export function creditReferenceOf(args: {
  linkedNumber?: string | null;
  linkedDate?: string | null;
  creditedNumber?: string | null;
  creditedDate?: string | null;
}): { originalNumber: string | null; originalDate: string | null } {
  const linked = String(args.linkedNumber ?? "").trim();
  if (linked) return { originalNumber: linked, originalDate: args.linkedDate ?? null };
  const typed = String(args.creditedNumber ?? "").trim();
  if (typed) return { originalNumber: typed, originalDate: args.creditedDate ?? null };
  return { originalNumber: null, originalDate: null };
}

export type StandaloneCreditnotaCheck =
  | { ok: true }
  | { ok: false; code: "creditnota_zonder_verwijzing"; error: string };

/**
 * [CREDITNOTA-EXTERN] May this creditnota be issued? A linked one always may (the link IS the
 * reference); a standalone one only with the number of the invoice it corrects. Anything that is
 * not a creditnota passes untouched. Dutch on purpose: this is the sentence the send door answers
 * with, like kor-invoice.ts — the owner is refused in the language of the document.
 */
export function checkStandaloneCreditnota(args: {
  invoiceType: string | null | undefined;
  originalInvoiceId: string | null | undefined;
  creditedNumber: string | null | undefined;
}): StandaloneCreditnotaCheck {
  if (args.invoiceType !== "creditnota") return { ok: true };
  if (args.originalInvoiceId) return { ok: true };
  if (String(args.creditedNumber ?? "").trim()) return { ok: true };
  return {
    ok: false,
    code: "creditnota_zonder_verwijzing",
    error:
      "Een losse creditnota moet de factuur noemen die ze corrigeert: vul het factuurnummer in " +
      "(art. 219 btw-richtlijn).",
  };
}
