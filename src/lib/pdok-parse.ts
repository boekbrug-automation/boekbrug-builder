// src/lib/pdok-parse.ts
// [ADRES-ECHT] Read a PDOK/BAG answer — or say we could not. Pure: no I/O.
// Run: npx tsx --test src/lib/pdok-parse.test.ts
//
// ── WHY THE PARSER IS SEPARATE FROM THE FETCH ───────────────────────────────────────────────
//
// Because the fetch cannot be tested here and this can. The environment this was written in
// blocks api.pdok.nl, so the client could not be run against the real service even once. What
// CAN be made certain is the half that turns whatever came back into an address — and, more
// importantly, the half that refuses to.
//
// So this module is deliberately paranoid about shape. It reads an `unknown`, checks every field
// it uses, and returns null the moment anything is not what it expects. The consequence matters:
// if the real response looks different from what was assumed, the app says "we could not check
// this address" — never "your street is called something else". A wrong verdict would land on an
// invoice; a missing one only costs a second of typing.
//
// ── THE SHAPE THIS EXPECTS ──────────────────────────────────────────────────────────────────
//
// PDOK Locatieserver is Solr underneath, so the answer is:
//
//   { response: { numFound: 1, docs: [ { type: "adres", straatnaam, huisnummer, huisletter,
//                                        huisnummertoevoeging, postcode, woonplaatsnaam, … } ] } }
//
// Only `type: "adres"` counts. The same endpoint also returns streets, towns and postcode areas,
// and a "woonplaats" hit for a postcode search is not a confirmation that the house number
// exists — it is the register saying "that town exists", which is not the question.

import type { DutchAddress } from "./dutch-address";
import { normalisePostcode } from "./dutch-address";

/** A field that must be a non-empty string to be used at all. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A house number, from a number or a numeric string. 0 when it is neither. */
function houseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === "string" && /^\d{1,5}$/.test(value.trim())) {
    const n = Number.parseInt(value.trim(), 10);
    return n > 0 ? n : 0;
  }
  return 0;
}

/**
 * One address document → a DutchAddress, or null when it is not one we can use.
 *
 * Exported because it is the piece worth testing on its own; the route reads the envelope.
 */
export function parseAddressDoc(doc: unknown): DutchAddress | null {
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as Record<string, unknown>;

  // Only a house-level hit. A street or a town is not an answer to "does number 42 exist".
  if (text(d.type).toLowerCase() !== "adres") return null;

  const postcode = normalisePostcode(text(d.postcode));
  const number = houseNumber(d.huisnummer);
  const street = text(d.straatnaam);
  const city = text(d.woonplaatsnaam);

  // Every one of these is required: an address missing any of them cannot be printed on an
  // invoice, and half an answer is the kind that gets accepted without being read.
  if (postcode === "" || number === 0 || street === "" || city === "") return null;

  // The addition is two separate fields in the BAG — a letter and a number-addition — and either
  // may be absent. "42", "42A", "42-2" and "42A-2" are four different front doors.
  const letter = text(d.huisletter);
  const suffix = text(d.huisnummertoevoeging);
  const addition = [letter, suffix].filter((p) => p !== "").join("-");

  return { postcode, houseNumber: number, addition, street, city };
}

/**
 * The whole PDOK answer → the ONE address it identifies, or null.
 *
 * Null for zero hits AND for more than one, and the second is the important half: a postcode and
 * house number that resolve to several BAG objects is a building with more than one front door,
 * and picking the first would put a neighbour's addition on an invoice. Let the owner type it.
 */
export function parsePdokAnswer(json: unknown): DutchAddress | null {
  if (typeof json !== "object" || json === null) return null;
  const response = (json as Record<string, unknown>).response;
  if (typeof response !== "object" || response === null) return null;

  const docs = (response as Record<string, unknown>).docs;
  if (!Array.isArray(docs)) return null;

  const addresses = docs.map(parseAddressDoc).filter((a): a is DutchAddress => a !== null);
  return addresses.length === 1 ? addresses[0]! : null;
}

/**
 * How many usable addresses the answer holds. The route needs the difference between "nothing
 * there" (say so: the register does not know this address) and "several" (say that instead —
 * the owner has to pick, and a wrong pick is a wrong invoice).
 */
export function countAddresses(json: unknown): number {
  if (typeof json !== "object" || json === null) return 0;
  const response = (json as Record<string, unknown>).response;
  if (typeof response !== "object" || response === null) return 0;
  const docs = (response as Record<string, unknown>).docs;
  if (!Array.isArray(docs)) return 0;
  return docs.filter((d) => parseAddressDoc(d) !== null).length;
}

/**
 * The query PDOK is asked. Built here rather than in the route so it is testable, and so the
 * house number cannot be smuggled into the postcode field by a caller.
 */
export function pdokQuery(postcode: string, number: number): string {
  return `${normalisePostcode(postcode)} ${Math.trunc(number)}`.trim();
}
