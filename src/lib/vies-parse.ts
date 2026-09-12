// src/lib/vies-parse.ts
// [EU-BTW] Read what VIES said — or refuse to. Pure: no I/O.
// Run: npx tsx --test src/lib/vies-parse.test.ts
//
// ── WHAT VIES IS AND IS NOT ─────────────────────────────────────────────────────────────────
//
// The European Commission's check on whether a VAT number is registered for intra-EU trade,
// right now. Free, no key, no contract. It answers three things: is it valid, and — depending on
// the member state — the name and address it belongs to. Several countries return the name as
// "---" because their law does not allow disclosure; that is a valid answer with no name in it,
// not a failed one.
//
// ── WHY THIS MATTERS MORE THAN A FORMAT CHECK ───────────────────────────────────────────────
//
// An intra-EU supply to a business with a VALID foreign VAT number is btw verlegd: 0% on the
// invoice and the customer declares the tax. If the number turns out not to be valid, the supply
// was never zero-rated and the Dutch supplier owes the btw himself — on an invoice he already
// sent without it. That is why the answer here is stored with the moment it was given: "valid on
// 12 September" is the defensible record, and "valid" without a date is not.
//
// ── AND WHY A FAILED CHECK IS NOT A FAILED NUMBER ───────────────────────────────────────────
//
// VIES is a fan-out to 27 national systems and any one of them can be down; the service itself
// documents member-state unavailability as normal. So MS_UNAVAILABLE, a timeout and a shape we do
// not recognise all mean the same thing to the owner — we could not ask — and none of them may
// read as "your customer's number is wrong".

import { euVatShape } from "./eu-vat-format";

/** What VIES holds about a number that exists. */
export interface ViesCompany {
  /** "NL822081297B01", as it was asked. */
  vatNumber: string;
  /** Empty when the member state does not disclose it — a legitimate answer, not a gap. */
  name: string;
  /** One blob, as VIES returns it: countries format it differently and we do not re-format. */
  address: string;
}

/** What the parser concluded, before the route turns it into a Verification. */
export type ViesReading =
  | { reading: "valid"; company: ViesCompany }
  | { reading: "invalid" }
  /** Could not ask, or did not understand. `why` is Dutch and goes on the screen. */
  | { reading: "unusable"; why: string };

function text(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  // VIES writes "---" where a member state does not disclose. Keeping it would print three
  // hyphens where a company name belongs.
  return s === "---" || s === "-" ? "" : s;
}

/**
 * The VIES answer → a reading.
 *
 * `requested` is what we asked about, and it is used rather than what came back: the response
 * echoes countryCode and vatNumber separately, and stitching them is one more place to get a
 * number wrong. If the echo disagrees with what we asked, the answer is unusable — a reply about
 * a different number is not an answer about this one.
 */
export function parseViesAnswer(json: unknown, requested: string): ViesReading {
  if (typeof json !== "object" || json === null) {
    return { reading: "unusable", why: "Het antwoord van VIES was niet leesbaar" };
  }
  const body = json as Record<string, unknown>;

  // VIES reports its own trouble in a field, with HTTP 200. MS_UNAVAILABLE, TIMEOUT, SERVICE_
  // UNAVAILABLE and friends are all "not now", never "not valid".
  const error = text(body.userError) || text(body.error);
  if (error !== "" && error.toUpperCase() !== "VALID") {
    if (/INVALID_INPUT/i.test(error)) {
      return { reading: "unusable", why: "VIES kon dit nummer niet in behandeling nemen" };
    }
    return { reading: "unusable", why: "VIES kon het nummer nu niet controleren" };
  }

  if (typeof body.valid !== "boolean") {
    return { reading: "unusable", why: "Het antwoord van VIES was niet leesbaar" };
  }
  if (!body.valid) return { reading: "invalid" };

  // The echo must be about the number we asked about.
  const echoed = `${text(body.countryCode)}${text(body.vatNumber)}`.toUpperCase().replace(/[\s.-]/g, "");
  const asked = euVatShape(requested);
  if (asked.shape !== "possible") {
    return { reading: "unusable", why: "Het nummer is niet in een vorm die VIES kan controleren" };
  }
  if (echoed !== "" && echoed !== asked.normalised) {
    return { reading: "unusable", why: "VIES antwoordde over een ander nummer" };
  }

  return {
    reading: "valid",
    company: { vatNumber: asked.normalised, name: text(body.name), address: text(body.address) },
  };
}
