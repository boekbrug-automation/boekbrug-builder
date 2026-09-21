// src/lib/seller-completeness.ts
// [VERKOPER-COMPLEET] What the SELLER must have on file before an invoice may be issued — one
// definition, read by the send door and by the screen that asks for it. Pure, no I/O.
// Run: npx tsx --test src/lib/seller-completeness.test.ts
//
// ── WHY THIS IS ONE FILE AND NOT TWO OPINIONS ────────────────────────────────────────────────
//
// /api/invoice/send has always owned this rule (art. 35a sub a/b Wet OB 1968: the seller's own
// name, address, BTW-id and KvK are mandatory elements of a legal invoice). It enforced it with
// four inline `if`s and refused with a sentence telling the owner to go to Instellingen.
//
// This batch asks the owner for the missing fields inside the invoice flow instead of sending
// them away. That means a SECOND place now has to know what "complete" means — and the moment
// two places decide that independently, they drift: the screen lets a send through that the
// server refuses, or asks for a field the server does not want. Both are a first invoice that
// does not go out.
//
// So the definition lives here, the send route imports it, and the screen asks the server rather
// than re-deriving it. The server is still the authority — nothing here relaxes anything; it is
// the same four facts, written once.
//
// ── WHAT THIS DELIBERATELY DOES NOT DECIDE ───────────────────────────────────────────────────
//
// IBAN is not in this set. It is payment information, not a validity requirement, and the send
// door has never demanded it. An invoice without a bank account is legal and collectable (the
// customer can still pay by other means); an invoice without a BTW-id is not an invoice. Adding
// IBAN here would block a first send on a field the law does not ask for.
//
// Nor does this file decide whether a value is WELL-FORMED. `missingSellerFields` answers exactly
// the question the send door asks — "is there anything there at all?" — because that is the
// contract that already ships. Format is validated where a value is ENTERED (validation.ts), and
// that stays the one place, so a foreign BTW-id that the door accepts is not quietly rejected
// here.

import { validateBtw, validateKvk, normalizeBtw, normalizeKvk } from "./validation";

/**
 * The four facts, as stable machine keys.
 *
 * `company_name` is the key, but the FACT is "this seller has a name" — an eenmanszaak that never
 * filled in a company name is named by `full_name` on the invoice, and the send door has always
 * accepted either. One key, because the screen asks for one thing.
 */
export type SellerField = "btw_number" | "kvk_number" | "address" | "company_name";

/**
 * The order the refusal names them in, and therefore the order the form shows them in.
 *
 * Not alphabetical and not arbitrary: this is the order /api/invoice/send has always used in its
 * sentence ("Vul eerst je BTW-nummer, KvK-nummer, adres, bedrijfsnaam in"), and that sentence is
 * still produced from this list. Reordering it changes a message that is in production.
 */
export const SELLER_FIELD_ORDER: readonly SellerField[] = [
  "btw_number",
  "kvk_number",
  "address",
  "company_name",
] as const;

/**
 * The Dutch words the send door has always refused with.
 *
 * [TAAL] Dutch values inside an English file, and deliberately: these are not identifiers but the
 * exact wording of a message that is already live, reproduced here so the sentence survives the
 * move out of the route. The screen's own labels live in messages.ts, where they can be
 * translated; this map exists so the SERVER's refusal does not change by one character.
 */
export const SELLER_FIELD_LABEL_NL: Record<SellerField, string> = {
  btw_number: "BTW-nummer",
  kvk_number: "KvK-nummer",
  address: "adres",
  company_name: "bedrijfsnaam",
};

/** A seller profile as the database returns it — only the columns this decision reads. */
export interface SellerFacts {
  btw_number?: string | null;
  kvk_number?: string | null;
  address?: string | null;
  company_name?: string | null;
  full_name?: string | null;
}

/** Present = a non-empty value once trimmed. A field of spaces is not a field. */
function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Which of the four is not on file, in the order the refusal names them.
 *
 * `null`/`undefined` facts answer "all four" — that is a profile with nothing in it, which is
 * exactly what a brand-new account has. It is NOT the answer for a profile that could not be READ:
 * a failed read is not an empty profile ([PROFILE-READ]), and the caller must have refused before
 * it gets here. This function cannot tell the difference and must never be asked to.
 */
export function missingSellerFields(facts: SellerFacts | null | undefined): SellerField[] {
  const f = facts ?? {};
  const missing: SellerField[] = [];
  for (const field of SELLER_FIELD_ORDER) {
    if (field === "company_name") {
      // Either name carries the seller onto the invoice, so either one satisfies this.
      if (!filled(f.company_name) && !filled(f.full_name)) missing.push(field);
      continue;
    }
    if (!filled(f[field])) missing.push(field);
  }
  return missing;
}

/** Nothing missing. The same question the send door asks, phrased the way a caller wants it. */
export function isSellerComplete(facts: SellerFacts | null | undefined): boolean {
  return missingSellerFields(facts).length === 0;
}

/** The refusal sentence the send door has always produced, from the keys. */
export function sellerFieldLabels(fields: readonly SellerField[]): string[] {
  return fields.map((f) => SELLER_FIELD_LABEL_NL[f]);
}

// ── Prefill: what the owner already typed once, offered back ───────────────────────────────────

/**
 * The sender block from /factuur-maken, already flattened to the four fields.
 *
 * Built by `toOnboardingCompany()` in factuur-handoff.ts, which is the one place that knows how
 * the free generator's two address lines become the single `address` the profile stores. It is
 * taken as a plain object here so this module stays pure and knows nothing about localStorage.
 */
export interface SellerPrefillSource {
  company_name?: string | null;
  kvk_number?: string | null;
  btw_number?: string | null;
  address?: string | null;
}

/** Where a prefilled value came from — so a test can prove the precedence rather than infer it. */
export type PrefillOrigin = "profile" | "handoff" | "none";

export interface PrefillValue {
  value: string;
  origin: PrefillOrigin;
}

/**
 * Is this handoff value good enough to put in front of the owner as theirs?
 *
 * The handoff is a convenience, never an authority: it comes out of localStorage, where anything
 * can have written anything. A name or an address is free text and cannot be malformed, so those
 * pass on being non-empty. A KvK and a BTW-id have a shape, and the shape is checked by the SAME
 * validator the settings screen uses — so a value that would be refused on save is never offered
 * as though it were fine. A malformed one is simply not carried over; the owner types it, which
 * is the correction the invalid value needs anyway.
 */
export function handoffValueUsable(field: SellerField, raw: string | null | undefined): boolean {
  if (!filled(raw)) return false;
  if (field === "kvk_number") return validateKvk(normalizeKvk(raw)).valid;
  if (field === "btw_number") return validateBtw(normalizeBtw(raw)).valid;
  return true;
}

/**
 * What to put in each field of the completion form.
 *
 * THE PRECEDENCE, and it only runs one way:
 *
 *     an existing non-empty PROFILE value  >  a usable HANDOFF value  >  empty
 *
 * The profile wins because it is what this account has actually saved about itself; the handoff is
 * what someone typed into a public page before the account existed, possibly weeks ago and
 * possibly on a shared machine. Letting it overwrite a saved value would silently change a
 * seller's own BTW-id on the strength of a browser key — and the first anyone would notice is a
 * customer's invoice carrying the wrong number.
 *
 * In practice the profile branch is unreachable for a field that is being ASKED for (a field is
 * only asked for because the profile is empty). It is written out anyway, and tested, because the
 * rule must hold for a caller that hands over a wider field list than the one it asked about —
 * which is exactly the mistake that would put handoff data on top of saved data.
 */
export function prefillSellerFields(
  fields: readonly SellerField[],
  profile: SellerFacts | null | undefined,
  handoff: SellerPrefillSource | null | undefined,
): Record<SellerField, PrefillValue> {
  const p = profile ?? {};
  const h = handoff ?? {};
  const out = {} as Record<SellerField, PrefillValue>;

  for (const field of SELLER_FIELD_ORDER) {
    if (!fields.includes(field)) {
      out[field] = { value: "", origin: "none" };
      continue;
    }

    const own = field === "company_name" ? (filled(p.company_name) ? p.company_name : p.full_name) : p[field];
    if (filled(own)) {
      out[field] = { value: String(own).trim(), origin: "profile" };
      continue;
    }

    const carried = h[field];
    if (handoffValueUsable(field, carried)) {
      out[field] = { value: String(carried).trim(), origin: "handoff" };
      continue;
    }

    out[field] = { value: "", origin: "none" };
  }

  return out;
}

// ── The screen's side: what to DO with the server's answer ─────────────────────────────────────
//
// These two live here, next to the rule they serve, because they are the half of the contract the
// browser holds — and because a decision written inline in a 2400-line component is a decision no
// test can reach. Every branch below is a case that has to be right on the one irreversible button
// in this product, so every branch below is asserted in seller-completeness.test.ts.
//
// THE INVARIANT BOTH OF THEM EXIST FOR: only an explicit, understood "compleet" lets the send go
// ahead. A refusal, an outage, an answer in a shape we do not recognise, a field name we do not
// know — every one of those stops. The failure direction is always "do not issue an invoice",
// because that one costs a retry and the other one costs a number out of a legal sequence.

/** What the screen does after asking the server whether the seller is complete. */
export type SellerGate =
  | { action: "proceed" }
  | { action: "ask"; fields: SellerField[] }
  | { action: "stop" };

function knownFields(raw: unknown): SellerField[] {
  if (!Array.isArray(raw)) return [];
  // Ordered by the module, and filtered to fields this build knows. A name we cannot label would
  // render as a blank box the owner cannot fill in — and silently dropping it while proceeding
  // would send an invoice the door then refuses, so an empty result stops instead.
  return SELLER_FIELD_ORDER.filter((f) => raw.includes(f));
}

/**
 * The answer from GET /api/invoice/verkoper, turned into one of three moves.
 *
 * `403` is the sales member ([ACTING-FOR]) and is the one refusal that PROCEEDS: their employer's
 * profile is not theirs to read or fix, so the screen asks nothing and the send door checks the
 * real owner through service_role exactly as it did before this batch existed. Refusing the send
 * here would take invoicing away from the people whose job it is.
 */
export function classifySellerGate(status: number, body: unknown): SellerGate {
  if (status === 403) return { action: "proceed" };
  if (status < 200 || status >= 300) return { action: "stop" };

  const b = (body ?? {}) as { status?: unknown; missing?: unknown };
  if (b.status === "compleet") return { action: "proceed" };
  if (b.status === "onvolledig") {
    const fields = knownFields(b.missing);
    return fields.length > 0 ? { action: "ask", fields } : { action: "stop" };
  }
  return { action: "stop" };
}

/** What the screen does after trying to save the completion. */
export type SellerSaveOutcome =
  | { outcome: "complete" }
  | { outcome: "ask"; fields: SellerField[] }
  | { outcome: "problems"; problems: Record<string, string> }
  | { outcome: "failed" };

/**
 * The answer from POST /api/invoice/verkoper.
 *
 * `problems` is the per-field refusal (a KvK that is not eight digits), and it is kept apart from
 * `failed` for one reason: the owner can fix a problem and cannot fix an outage, so they get the
 * sentence that matches. Neither one sends. `ask` covers the save that landed but left something
 * still missing — the form comes back rather than the invoice going out.
 */
export function classifySellerSave(status: number, body: unknown): SellerSaveOutcome {
  const b = (body ?? {}) as { status?: unknown; missing?: unknown; problems?: unknown };

  if (status >= 200 && status < 300) {
    if (b.status === "compleet") return { outcome: "complete" };
    const fields = knownFields(b.missing);
    if (fields.length > 0) return { outcome: "ask", fields };
    return { outcome: "failed" };
  }

  const problems = b.problems;
  if (problems && typeof problems === "object" && !Array.isArray(problems)) {
    const entries = Object.entries(problems as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === "string");
    if (entries.length > 0) return { outcome: "problems", problems: Object.fromEntries(entries) };
  }
  return { outcome: "failed" };
}

/**
 * May an invoice be sent on the strength of this outcome?
 *
 * One line, and it exists so the rule can be asserted directly rather than inferred from four
 * call sites. `complete` and nothing else — a saved-but-incomplete profile, a per-field problem
 * and an outage all answer no.
 */
export function saveAllowsSend(outcome: SellerSaveOutcome): boolean {
  return outcome.outcome === "complete";
}
