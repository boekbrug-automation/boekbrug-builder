// src/lib/accountant-directory.ts
// [KANTOORGIDS] The public list of offices that work with BoekBrug. Pure — no I/O, no clock.
// Run: npx tsx --test src/lib/accountant-directory.test.ts
//
// The string VALUES here are Dutch because they are rendered verbatim; the arrangement in
// office-offer.ts, and for the same reason: this is copy, not code.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────
//
// [GEEN-PROVISIE] settled that BoekBrug does not pay an office for bringing a client. This is the
// other direction, and it is the reason that refusal is not simply a "no": an owner who signs up
// without a boekhouder is a lead the office would otherwise have paid for, and we have those
// every week. A referral running BOTH ways is worth more to an office than a share of a
// subscription, and it costs no part of the price a client pays.
//
// ── THE RULE THAT MAKES THE LIST WORTH BEING ON ─────────────────────────────────────────────
//
// The order is not for sale, and cannot become so by accident. `sortForOwner` orders by exactly
// two things — offices that say they have room come before offices that do not, and within that
// the order is stable by name. There is no score, no tier and no paid position, and nothing here
// reads a payment status: `DirectoryEntry` has no field to read. A directory whose first three
// rows can be bought is an advertisement, and everybody can tell the difference; the moment it
// becomes one, the refusal to pay for recommendations becomes a technicality.
//
// ── PUBLISHED IS AN ACT, NOT A DEFAULT ──────────────────────────────────────────────────────
//
// Nothing appears here because an office signed up. An office types what it wants shown and turns
// it on, and can turn it off again — its name, its town and its e-mail are its own to publish,
// and an accountant discovering their own listing they never made is an accountant who leaves.

/** What an office chose to show. Every field is typed by the office itself. */
export interface DirectoryEntry {
  accountantId: string;
  officeName: string;
  city: string;
  /** Optional and free-form-ish: what this office is used to. Rendered as-is, never scored. */
  specialisms: readonly string[];
  /** "Ik neem nieuwe klanten aan." The only thing that changes the order. */
  acceptingClients: boolean;
  contactEmail: string;
  website: string | null;
}

/** The most an office may put in each field. Long enough to be useful, short enough to be a list. */
export const LIMITS = {
  officeName: 80,
  city: 60,
  specialism: 40,
  specialisms: 6,
  contactEmail: 120,
  website: 200,
} as const;

/** Dutch, and about what the office must fix — this is shown next to the field. */
export type DirectoryProblem =
  | "Vul de naam van je kantoor in"
  | "Vul de plaats in"
  | "Vul een e-mailadres in waarop ondernemers je mogen benaderen"
  | "Dat e-mailadres klopt niet"
  | "Een website begint met https://"
  | "Naam van het kantoor is te lang"
  | "Plaats is te lang"
  | "Eén specialisatie is te lang"
  | "Kies er maximaal zes";

/**
 * Trim, drop the empties, and cap the list — before validation, so "  " is an empty field and not
 * a passing one. Returns a NEW object; the caller's input is never modified.
 */
export function normaliseEntry(raw: {
  accountantId: string;
  officeName?: string | null;
  city?: string | null;
  specialisms?: readonly (string | null | undefined)[] | null;
  acceptingClients?: boolean | null;
  contactEmail?: string | null;
  website?: string | null;
}): DirectoryEntry {
  const text = (v: string | null | undefined): string => (typeof v === "string" ? v.trim() : "");
  const site = text(raw.website);
  return {
    accountantId: raw.accountantId,
    officeName: text(raw.officeName),
    city: text(raw.city),
    specialisms: (raw.specialisms ?? [])
      .map((s) => text(s))
      .filter((s) => s.length > 0)
      .slice(0, LIMITS.specialisms),
    acceptingClients: raw.acceptingClients === true,
    contactEmail: text(raw.contactEmail).toLowerCase(),
    website: site.length > 0 ? site : null,
  };
}

/**
 * Everything wrong with the entry, in the order the form shows the fields. Empty means publishable.
 *
 * Deliberately not a boolean: an office that is told "er klopt iets niet" goes looking, and an
 * office that goes looking on a form it filled in once does not come back to it.
 */
export function entryProblems(entry: DirectoryEntry): DirectoryProblem[] {
  const problems: DirectoryProblem[] = [];
  if (entry.officeName.length === 0) problems.push("Vul de naam van je kantoor in");
  else if (entry.officeName.length > LIMITS.officeName) problems.push("Naam van het kantoor is te lang");

  if (entry.city.length === 0) problems.push("Vul de plaats in");
  else if (entry.city.length > LIMITS.city) problems.push("Plaats is te lang");

  if (entry.contactEmail.length === 0) {
    problems.push("Vul een e-mailadres in waarop ondernemers je mogen benaderen");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(entry.contactEmail) ||
             entry.contactEmail.length > LIMITS.contactEmail) {
    problems.push("Dat e-mailadres klopt niet");
  }

  // http:// is refused rather than upgraded: a link we rewrote is a link the office did not check,
  // and it is their name under it.
  if (entry.website !== null && !/^https:\/\/[^\s]+\.[^\s]{2,}/.test(entry.website)) {
    problems.push("Een website begint met https://");
  }
  if (entry.specialisms.some((s) => s.length > LIMITS.specialism)) problems.push("Eén specialisatie is te lang");
  if (entry.specialisms.length > LIMITS.specialisms) problems.push("Kies er maximaal zes");

  return problems;
}

/**
 * The order an owner sees. Offices with room first, then by name — and that is the whole ranking.
 *
 * `localeCompare` with "nl" so De Boer and de Boer sit together, and a stable tie-break on the id
 * so the list does not reshuffle between two page loads and look arbitrary.
 */
export function sortForOwner(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.acceptingClients !== b.acceptingClients) return a.acceptingClients ? -1 : 1;
    const byName = a.officeName.localeCompare(b.officeName, "nl", { sensitivity: "base" });
    return byName !== 0 ? byName : a.accountantId.localeCompare(b.accountantId);
  });
}

/**
 * What the public page says when the list is empty — which it is on the day this ships, and that
 * is not a failure to hide. An empty list dressed up as "binnenkort meer kantoren" is a claim
 * about offices that never agreed to be counted.
 */
export const EMPTY_LIST = {
  heading: "Nog geen kantoren in de gids",
  body:
    "Er staat nog niemand in. Werk je op een administratiekantoor en wil je hier staan? " +
    "Zet je kantoor aan in je BoekBrug-portaal — je bepaalt zelf wat er staat en kunt het altijd " +
    "weer uitzetten.",
} as const;
