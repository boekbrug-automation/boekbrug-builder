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

import { LOCALES, type Locale } from "./i18n/locale";

/**
 * [KANTOORGIDS-TAAL] The languages an office may say it works in.
 *
 * Exactly the languages the PRODUCT speaks, and derived from that list rather than repeated, so
 * the gids can never offer one BoekBrug cannot serve a client in. The database holds the same set
 * in `accountant_directory_languages_known`, written out literally because a CHECK cannot import;
 * the [KANTOORGIDS-TAAL] gate asserts the two still agree, so adding a fifth locale goes red here
 * instead of turning into a 503 the day an office picks it.
 *
 * Free text was the alternative and it cannot be matched: "Arabisch", "arabic", "العربية" and "AR"
 * are four values for one language. An office that also speaks Polish says so in its specialisms,
 * which are free text precisely because they carry no closed-set promise.
 */
export const DIRECTORY_LANGUAGES: readonly Locale[] = LOCALES;

/** Is this one of the languages the gids knows? Narrows, so a caller can trust it after the check. */
export function isDirectoryLanguage(value: string): value is Locale {
  return (DIRECTORY_LANGUAGES as readonly string[]).includes(value);
}

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
  /**
   * [KANTOORGIDS-TAAL] The languages this office says it can help an ondernemer in.
   *
   * Typed as `string[]` and not `Locale[]` on purpose. normaliseEntry takes untrusted input, and a
   * code it does not know has to SURVIVE normalisation so that entryProblems can refuse it by
   * name. Narrowing here would mean dropping the unknown value silently, and an office told
   * nothing is an office that never learns why its listing will not save.
   *
   * Never read to sort. It is listing data, not a rank.
   */
  languages: readonly string[];
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
  | "Kies er maximaal zes"
  | "Kies minstens één taal waarin je ondernemers kunt helpen"
  | "Die taal kennen we niet";

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
  languages?: readonly (string | null | undefined)[] | null;
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
    // [KANTOORGIDS-TAAL] Lower-cased and de-duplicated, and NOT filtered against the known set —
    // an unknown code is carried through so entryProblems can name it.
    //
    // The cap is the size of the set PLUS ONE, and the plus one is load-bearing. Capping at
    // exactly the set size swallows the very thing this list exists to report: a caller sending
    // ['nl','en','ar','tr','xx'] would keep the four valid codes, drop 'xx', and the office would
    // be told nothing was wrong. One slot more guarantees the opposite — any list with more
    // distinct values than the set has MUST contain an unknown, so an unknown always survives the
    // cap and always gets named. It still bounds the input, which is the cap's actual job:
    // de-duplication already makes 'nl' ten thousand times into one.
    //
    // No default is chosen when the list is empty. Empty means "the office has not said", and the
    // difference between that and "the office said Dutch" is the difference between a question
    // unanswered and an answer we invented for them.
    languages: [...new Set(
      (raw.languages ?? [])
        .map((l) => text(l).toLowerCase())
        .filter((l) => l.length > 0),
    )].slice(0, DIRECTORY_LANGUAGES.length + 1),
  };
}

/**
 * [KANTOORGIDS-TAAL] What the database refuses whatever `published` says — so, what a DRAFT must
 * already satisfy.
 *
 * There is exactly one such rule and the asymmetry is the database's, not a choice made here:
 * `accountant_directory_languages_known` is unconditional, while
 * `accountant_directory_published_has_language` is gated on `published`. An unknown code in a
 * draft is therefore refused by Postgres with a 23514 the office cannot read, so it has to be
 * refused here first, in a sentence.
 *
 * A draft may still be as EMPTY as it likes — that is what a draft is. This refuses wrong, never
 * incomplete.
 */
export function draftProblems(entry: DirectoryEntry): DirectoryProblem[] {
  return entry.languages.some((l) => !isDirectoryLanguage(l)) ? ["Die taal kennen we niet"] : [];
}

/**
 * Everything wrong with the entry, in the order the form shows the fields. Empty means publishable.
 *
 * Deliberately not a boolean: an office that is told "er klopt iets niet" goes looking, and an
 * office that goes looking on a form it filled in once does not come back to it.
 *
 * Includes draftProblems, so a caller that is publishing needs this one call and not two.
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

  // [KANTOORGIDS-TAAL] A published listing that names no language cannot answer the question the
  // owner arrived with, so it would sit in the gids being passed over — worse for the office than
  // not being listed. The database says the same in
  // accountant_directory_published_has_language; this says it first, and in a sentence.
  if (entry.languages.length === 0) problems.push("Kies minstens één taal waarin je ondernemers kunt helpen");
  problems.push(...draftProblems(entry));

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
