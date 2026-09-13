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

// The language list is NOT a list of its own. It is the set of languages BoekBrug itself speaks
// (src/lib/i18n/locale.ts), so the gids can never offer a language the product cannot serve a
// client in, and can never fall behind one it learns.
import { LOCALES, type Locale } from "./i18n/locale";

/**
 * [KANTOORGIDS-TAAL] The languages an office may say it works in — a CLOSED set, and that is the
 * whole reason a filter is possible.
 *
 * Free text cannot be filtered: "Arabisch", "arabic", "العربية" and "AR" are four values for one
 * language, and an owner who ticks Arabisch would miss three quarters of the offices that speak it.
 * A directory that cannot answer "who understands me?" is a list you scroll, and scrolling is what
 * the owner was already doing on Google.
 *
 * What this set is NOT: every language on earth. An office that also speaks Pools cannot say so
 * here, and that is a real limit rather than an oversight — it can put it in its specialisms,
 * which are free text precisely because they are not filtered. The day BoekBrug speaks Polish,
 * this set gains it for free, because it is the same list.
 */
export const DIRECTORY_LANGUAGES: readonly Locale[] = LOCALES;

/**
 * Each language written IN that language. A chip that says "Arabisch" is for a Dutch reader
 * deciding about someone else; a chip that says «العربية» is for the person who was looking for it.
 */
export const LANGUAGE_LABEL: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
  ar: "العربية",
  tr: "Türkçe",
};

/** What an office chose to show. Every field is typed by the office itself. */
export interface DirectoryEntry {
  accountantId: string;
  officeName: string;
  city: string;
  /** Optional and free-form-ish: what this office is used to. Rendered as-is, never scored. */
  specialisms: readonly string[];
  /**
   * [KANTOORGIDS-TAAL] The languages this office SAYS it can help an ondernemer in. A claim, never
   * a checked fact — the gids shows "dit kantoor zegt", the same three-state honesty the KvK and
   * VIES doors use, and it must never be rendered as though we verified it.
   *
   * It FILTERS and never RANKS: sortForOwner does not read this field. A language that moved an
   * office up the page would be a ranking with a lever on it, and the one promise this list makes
   * is that its order cannot be bought or gamed.
   */
  languages: readonly Locale[];
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
  | "Kies er maximaal zes"
  | "Kies minstens één taal waarin je een ondernemer kunt helpen";

/**
 * Trim, drop the empties, and cap the list — before validation, so "  " is an empty field and not
 * a passing one. Returns a NEW object; the caller's input is never modified.
 */
export function normaliseLanguages(raw: unknown): Locale[] {
  const wanted = Array.isArray(raw) ? raw : [];
  // Walked in DIRECTORY_LANGUAGES order rather than the caller's, so two offices that ticked the
  // same boxes store the same array and the chips read the same way on every row. Anything not in
  // the set is dropped without comment — a language we cannot filter on is not a language here.
  return DIRECTORY_LANGUAGES.filter((code) => wanted.includes(code));
}

export function normaliseEntry(raw: {
  accountantId: string;
  officeName?: string | null;
  city?: string | null;
  specialisms?: readonly (string | null | undefined)[] | null;
  languages?: unknown;
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
    languages: normaliseLanguages(raw.languages),
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

  // [KANTOORGIDS-TAAL] Required, unlike the specialisms. An entry with no language cannot answer
  // the question the owner actually opened this page with, and it is invisible to every language
  // filter — so it would sit in the list being passed over, which is worse for the office than
  // not being listed. One tick is the whole cost.
  if (entry.languages.length === 0) {
    problems.push("Kies minstens één taal waarin je een ondernemer kunt helpen");
  }

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
/**
 * [KANTOORGIDS-TAAL] What the owner asked for. Every field is optional — an empty filter is the
 * whole list, which is what /boekhouders shows before anyone touches anything.
 *
 * `specialism` is deliberately absent for now. The specialisms are free text, and filtering free
 * text is the same trap the languages avoid: "horeca", "Horeca" and "horecazaken" would be three
 * answers to one question. It arrives when the specialisms become a closed set of their own; the
 * shape below has room for it and the panel has a slot for it.
 */
export interface DirectoryFilter {
  /** Matched loosely on the office's own town — the owner types "tilburg", the office wrote "Tilburg". */
  city?: string;
  /** One language the office must CLAIM. */
  language?: Locale | null;
  /** Only offices that say they have room. */
  onlyAccepting?: boolean;
}

/** Fold case and strip accents so "Den Bosch" finds "den bosch" and "Sint-Oedenrode" finds "sint oedenrode". */
function foldTown(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Does this office match what the owner asked for?
 *
 * Pure, and it FILTERS ONLY. It returns a yes or a no and never a score, so no combination of
 * answers can move an office up the page — sortForOwner still decides the order, on room and name,
 * exactly as it did before there were filters. That separation is not tidiness: the moment a
 * filter can also rank, the list has a lever, and a list with a lever is an advertisement.
 */
export function matchesFilter(entry: DirectoryEntry, filter: DirectoryFilter): boolean {
  const town = foldTown(filter.city ?? "");
  if (town.length > 0 && !foldTown(entry.city).includes(town)) return false;
  if (filter.language && !entry.languages.includes(filter.language)) return false;
  if (filter.onlyAccepting === true && !entry.acceptingClients) return false;
  return true;
}

/**
 * What to say when the filter emptied the list — naming what was asked, not "geen resultaten".
 *
 * An owner who filtered on Arabisch and sees a blank page learns nothing: they cannot tell whether
 * the gids is empty, broken, or simply has nobody yet. Saying which language came up empty is also
 * the honest answer, and it is the sentence that makes them try a different one instead of leaving.
 */
export function emptyAfterFilter(filter: DirectoryFilter): string {
  const parts: string[] = [];
  if (filter.language) parts.push(`dat ${LANGUAGE_LABEL[filter.language]} spreekt`);
  if ((filter.city ?? "").trim().length > 0) parts.push(`in ${filter.city!.trim()}`);
  if (filter.onlyAccepting === true) parts.push("dat nieuwe klanten aanneemt");
  if (parts.length === 0) return EMPTY_LIST.body;
  return `Er staat nog geen kantoor in de gids ${parts.join(" en ")}. Probeer het zonder dit filter.`;
}

export const EMPTY_LIST = {
  heading: "Nog geen kantoren in de gids",
  body:
    "Er staat nog niemand in. Werk je op een administratiekantoor en wil je hier staan? " +
    "Zet je kantoor aan in je BoekBrug-portaal — je bepaalt zelf wat er staat en kunt het altijd " +
    "weer uitzetten.",
} as const;
