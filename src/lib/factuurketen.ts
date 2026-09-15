// src/lib/factuurketen.ts
// [KETEN] The whole life of one invoice, read as a chain instead of as scattered columns.
//
// The links already exist and are already correct — this file adds no table and no column:
//
//   · original_invoice_id      a creditnota points at the invoice it corrects
//   · superseded_by_number     an invoice points at the one that replaced it
//   · credit_external_number   a loose creditnota naming an invoice outside BoekBrug
//
// What is missing is the READING. credited-invoices.ts answers "is this credited"; nothing
// answers "what happened to this invoice, in order". So an accountant opening INV-100 sees a row
// that is credited, and has to go and find CR-101 by hand — and then find out for themselves
// whether INV-102 exists and is its replacement. The relation is in the database and not on the
// page, which is the same shape of failure as the grootboek: the capability is there, the list
// is not.
//
// ── DERIVED, LIKE EVERYTHING ELSE ──
//
// The spec proposes an invoice_relations table with typed edges. That is the right model for a
// system whose relations are not otherwise recorded. Here they ARE recorded — on the documents
// themselves, with database constraints holding them (creditnota_one_per_original enforces the
// one-to-one). A second store of the same edges would need to be kept true against the first, and
// the day they disagreed nothing would say which was right.
//
// So the chain is computed from the documents. If a relations table is ever added, this file
// becomes the place that reads it.
//
// Pure. Run: npx tsx --test src/lib/factuurketen.test.ts

/** One document in the chain, reduced to what the relation needs. */
export interface KetenDocument {
  id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  invoice_date: string | null;
  total_inc_btw: number | null;
  /** Set on a creditnota: the invoice it corrects. */
  original_invoice_id?: string | null;
  /** Set on an invoice that was replaced: the number of its replacement. */
  superseded_by_number?: string | null;
}

export type Schakelsoort = "origineel" | "creditnota" | "vervanger";

export interface Schakel {
  soort: Schakelsoort;
  id: string;
  nummer: string | null;
  datum: string | null;
  bedrag: number | null;
}

/**
 * The chain for one invoice: itself, the creditnota that corrects it, and the invoice that
 * replaced it — in the order they happened.
 *
 * `alle` is the documents available to the caller. Anything not in it is simply absent from the
 * chain: this function never claims a link it cannot see, because "no replacement" and "the
 * replacement was not loaded" must not render identically. The caller says which it had.
 */
export function factuurketen(doc: KetenDocument, alle: readonly KetenDocument[]): Schakel[] {
  const schakel = (soort: Schakelsoort, d: KetenDocument): Schakel => ({
    soort,
    id: d.id,
    nummer: d.invoice_number,
    datum: d.invoice_date,
    bedrag: typeof d.total_inc_btw === "number" && Number.isFinite(d.total_inc_btw) ? d.total_inc_btw : null,
  });
  const isCreditnota = (d: KetenDocument) => String(d.invoice_type ?? "") === "creditnota";

  // The chain is the same chain from either end, so the head is the document that was CORRECTED —
  // never simply the one being looked at. Handed a creditnota, the first build called it the
  // "origineel" of a one-link chain, which is the one thing it certainly is not: a creditnota
  // exists only because another document does, and its screen is precisely where that other
  // document's number belongs (art. 219 Richtlijn 2006/112/EG asks the corrective document to
  // refer to the initial one; the PDF already did, the screen did not).
  const origineel = isCreditnota(doc)
    ? (doc.original_invoice_id ? alle.find((d) => d.id === doc.original_invoice_id) ?? null : null)
    : doc;

  const keten: Schakel[] = [];
  if (origineel) keten.push(schakel("origineel", origineel));

  // The creditnota that names the head. One at most — creditnota_one_per_original holds that in
  // the database, so finding a second here would be a database fault, not a case to merge.
  const credit = isCreditnota(doc)
    ? doc
    : origineel
      ? alle.find((d) => d.original_invoice_id === origineel.id && isCreditnota(d))
      : undefined;
  if (credit) keten.push(schakel("creditnota", credit));

  // The replacement, found by the NUMBER the head carries. A number and not an id, because that is
  // what the column holds — and because a replacement may have been issued before this app ever
  // saw the original.
  const vervangerNr = origineel?.superseded_by_number?.trim();
  if (origineel && vervangerNr) {
    const vervanger = alle.find((d) => (d.invoice_number ?? "").trim() === vervangerNr && d.id !== origineel.id);
    if (vervanger) keten.push(schakel("vervanger", vervanger));
  }

  return keten;
}

/**
 * Seen from the creditnota: the invoice it corrects, or null when the chain does not carry one.
 *
 * Null is a real answer and not a failure — a standalone creditnota against an invoice issued
 * outside this app has no row to point at, and the screen says so with the number the owner typed
 * rather than claiming a link that does not exist.
 */
export function origineelVan(keten: readonly Schakel[]): Schakel | null {
  return keten.find((s) => s.soort === "origineel") ?? null;
}

/** True when anything happened to this invoice after it was issued. */
export function isGecorrigeerd(keten: readonly Schakel[]): boolean {
  return keten.some((s) => s.soort !== "origineel");
}

/**
 * The one-line Dutch summary of the chain, or null when nothing happened.
 *
 * Says what the documents are, never what they mean for the money: whether the customer still owes
 * anything is factuurstaat's question, computed from the amounts, and answering it twice in two
 * places is how two screens come to disagree.
 */
export function ketenZin(keten: readonly Schakel[]): string | null {
  const credit = keten.find((s) => s.soort === "creditnota");
  const vervanger = keten.find((s) => s.soort === "vervanger");
  if (!credit && !vervanger) return null;
  const stukken: string[] = [];
  if (credit) stukken.push(`gecrediteerd met ${credit.nummer ?? "een creditnota"}`);
  if (vervanger) stukken.push(`vervangen door ${vervanger.nummer ?? "een nieuwe factuur"}`);
  return `Deze factuur is ${stukken.join(" en ")}.`;
}
