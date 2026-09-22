// src/lib/accountant-directory.test.ts
// [KANTOORGIDS] Run: npx tsx --test src/lib/accountant-directory.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIRECTORY_LANGUAGES,
  EMPTY_LIST,
  LIMITS,
  PUBLISH_ELIGIBILITY,
  draftProblems,
  entryProblems,
  isDirectoryLanguage,
  normaliseEntry,
  sortForOwner,
  type DirectoryEntry,
} from "./accountant-directory";
import { LOCALES } from "./i18n/locale";

const heel = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  accountantId: "a1",
  officeName: "Kantoor De Boer",
  city: "Utrecht",
  specialisms: ["zzp"],
  acceptingClients: true,
  contactEmail: "info@deboer.nl",
  website: null,
  // [KANTOORGIDS-TAAL] A COMPLETE entry now names at least one language — publishing without one
  // is refused by entryProblems and by accountant_directory_published_has_language. So the
  // fixture that stands for "nothing wrong with this listing" has to carry one.
  languages: ["nl"],
  ...over,
});

test("[KANTOORGIDS] whitespace is not a filled-in field", () => {
  const entry = normaliseEntry({ accountantId: "a1", officeName: "   ", city: "\t", contactEmail: " " });
  assert.strictEqual(entry.officeName, "");
  assert.deepStrictEqual(entryProblems(entry).slice(0, 3), [
    "Vul de naam van je kantoor in",
    "Vul de plaats in",
    "Vul een e-mailadres in waarop ondernemers je mogen benaderen",
  ]);
});

test("[KANTOORGIDS] normalising trims, drops empties, caps the list and never mutates the input", () => {
  const input = {
    accountantId: "a1",
    officeName: "  Kantoor De Boer ",
    city: " Utrecht",
    specialisms: [" zzp ", "", null, "transport", "horeca", "bouw", "winkel", "vervoer", "extra"],
    contactEmail: " INFO@DeBoer.NL ",
    website: "  ",
  };
  const bevroren = JSON.stringify(input);
  const entry = normaliseEntry(input);

  assert.strictEqual(entry.officeName, "Kantoor De Boer");
  assert.strictEqual(entry.city, "Utrecht");
  assert.strictEqual(entry.contactEmail, "info@deboer.nl", "an e-mail is compared lowercase or not at all");
  assert.strictEqual(entry.website, null, "a blank website is absent, not an empty link");
  assert.strictEqual(entry.specialisms.length, LIMITS.specialisms);
  assert.deepStrictEqual([...entry.specialisms].slice(0, 2), ["zzp", "transport"]);
  assert.strictEqual(JSON.stringify(input), bevroren, "the caller's object was modified");
});

test("[KANTOORGIDS] accepting clients is an explicit yes", () => {
  // Anything that is not true is false: a missing checkbox must not read as "ja, stuur maar".
  for (const v of [undefined, null, false]) {
    assert.strictEqual(
      normaliseEntry({ accountantId: "a1", acceptingClients: v as boolean | null | undefined }).acceptingClients,
      false,
      `${String(v)} was read as accepting new clients`,
    );
  }
  assert.strictEqual(normaliseEntry({ accountantId: "a1", acceptingClients: true }).acceptingClients, true);
});

test("[KANTOORGIDS] a complete entry has nothing to fix", () => {
  assert.deepStrictEqual(entryProblems(heel()), []);
  assert.deepStrictEqual(entryProblems(heel({ website: "https://deboer.nl" })), []);
  assert.deepStrictEqual(entryProblems(heel({ specialisms: [] })), [], "specialisms are optional");
});

test("[KANTOORGIDS] a website must be https, and is never silently rewritten", () => {
  assert.deepStrictEqual(entryProblems(heel({ website: "http://deboer.nl" })), ["Een website begint met https://"]);
  assert.deepStrictEqual(entryProblems(heel({ website: "deboer.nl" })), ["Een website begint met https://"]);
  // The one that matters: a link that would run script if a page ever rendered it unguarded.
  assert.deepStrictEqual(entryProblems(heel({ website: "javascript:alert(1)" })), ["Een website begint met https://"]);
});

test("[KANTOORGIDS] a bad e-mail is named as bad, not as missing", () => {
  for (const bad of ["info", "info@", "@deboer.nl", "info@deboer", "in fo@deboer.nl"]) {
    assert.deepStrictEqual(entryProblems(heel({ contactEmail: bad })), ["Dat e-mailadres klopt niet"], bad);
  }
});

test("[KANTOORGIDS] too long is refused per field", () => {
  assert.deepStrictEqual(entryProblems(heel({ officeName: "x".repeat(LIMITS.officeName + 1) })),
    ["Naam van het kantoor is te lang"]);
  assert.deepStrictEqual(entryProblems(heel({ city: "x".repeat(LIMITS.city + 1) })), ["Plaats is te lang"]);
  assert.deepStrictEqual(entryProblems(heel({ specialisms: ["x".repeat(LIMITS.specialism + 1)] })),
    ["Eén specialisatie is te lang"]);
});

test("[KANTOORGIDS] the order is availability, then name — and nothing else", () => {
  const lijst: DirectoryEntry[] = [
    heel({ accountantId: "c", officeName: "Zwart", acceptingClients: true }),
    heel({ accountantId: "a", officeName: "Aalders", acceptingClients: false }),
    heel({ accountantId: "b", officeName: "de Boer", acceptingClients: true }),
  ];
  assert.deepStrictEqual(sortForOwner(lijst).map((e) => e.officeName), ["de Boer", "Zwart", "Aalders"]);

  // Stable: the same input gives the same order, and the input itself is untouched.
  const eerste = sortForOwner(lijst).map((e) => e.accountantId);
  assert.deepStrictEqual(sortForOwner(lijst).map((e) => e.accountantId), eerste);
  assert.strictEqual(lijst[0]!.officeName, "Zwart", "sortForOwner sorted the caller's array in place");

  // Two offices with the same name do not swap places between page loads.
  const gelijk = [
    heel({ accountantId: "z", officeName: "Boekhouder" }),
    heel({ accountantId: "y", officeName: "Boekhouder" }),
  ];
  assert.deepStrictEqual(sortForOwner(gelijk).map((e) => e.accountantId), ["y", "z"]);
});

test("[KANTOORGIDS] an empty gids says it is empty, and promises nobody", () => {
  assert.deepStrictEqual(sortForOwner([]), []);
  assert.doesNotMatch(`${EMPTY_LIST.heading} ${EMPTY_LIST.body}`, /binnenkort|straks|meer kantoren volgen/i,
    "the empty list makes a claim about offices that never agreed to be counted");
});

// ─── [KANTOORGIDS-TAAL] The languages an office says it works in ──────────────────────────────
//
// This column exists in production since 20260913084506 and the repo did not know it. The write
// route therefore never sent it, the column took its '{}' default, and
// accountant_directory_published_has_language refused every publish the product ever made — as a
// bare 503, on the screen where an office decides whether to be listed. These tests hold the two
// halves of that contract in the domain, where the office is told what to fix in a sentence.
//
// The DATABASE half — that a non-accountant cannot write this table at all — is not provable here
// and is not faked here: it lives in tests/sql/accountant_directory_rls.test.sql, against a real
// PostgreSQL with RLS on.

test("[KANTOORGIDS-TAAL] a complete listing with a language publishes", () => {
  assert.deepStrictEqual(entryProblems(heel({ languages: ["nl"] })), []);
  assert.deepStrictEqual(entryProblems(heel({ languages: ["nl", "ar"] })), []);
});

test("[KANTOORGIDS-TAAL] a listing that names no language cannot be published", () => {
  // Everything else about it is right, which is the point: this is the exact row the route used to
  // send, and the database refused it with a code nobody could read.
  const problems = entryProblems(heel({ languages: [] }));
  assert.ok(problems.includes("Kies minstens één taal waarin je ondernemers kunt helpen"),
    "a listing with no language was publishable");
});

test("[KANTOORGIDS-TAAL] a DRAFT may name no language at all", () => {
  // A draft is allowed to be unfinished — that is what a draft is, and the database agrees:
  // accountant_directory_published_has_language is gated on `published`.
  assert.deepStrictEqual(draftProblems(heel({ languages: [] })), []);
  assert.deepStrictEqual(draftProblems(normaliseEntry({ accountantId: "a1" })), []);
});

test("[KANTOORGIDS-TAAL] a language we do not know is refused, in a draft as well", () => {
  // accountant_directory_languages_known is NOT conditional on `published`, so this has to be
  // refused before the write — otherwise a draft comes back as an unreadable 23514.
  const raar = heel({ languages: ["nl", "de"] });
  assert.deepStrictEqual(draftProblems(raar), ["Die taal kennen we niet"]);
  assert.ok(entryProblems(raar).includes("Die taal kennen we niet"),
    "publishing accepted a language the database will refuse");
});

test("[KANTOORGIDS-TAAL] normalising lower-cases, de-duplicates and keeps the unknown visible", () => {
  const entry = normaliseEntry({
    accountantId: "a1",
    languages: [" NL ", "nl", "AR", "", null, undefined, "xx"],
  });
  // Trimmed, lower-cased, de-duplicated, order kept — and "xx" SURVIVES, because a code that is
  // silently dropped is a code the office is never told about.
  assert.deepStrictEqual(entry.languages, ["nl", "ar", "xx"]);
  assert.deepStrictEqual(draftProblems(entry), ["Die taal kennen we niet"]);
});

test("[KANTOORGIDS-TAAL] nothing is ever chosen for the office", () => {
  // "Has not said" and "said Dutch" are different answers, and the second is not ours to invent.
  // A default here would put every office that never opened the form into the Dutch results.
  assert.deepStrictEqual(normaliseEntry({ accountantId: "a1" }).languages, []);
  assert.deepStrictEqual(normaliseEntry({ accountantId: "a1", languages: [] }).languages, []);
  assert.deepStrictEqual(normaliseEntry({ accountantId: "a1", languages: null }).languages, []);
});

test("[KANTOORGIDS-TAAL] the set is the product's own languages, and it is closed", () => {
  assert.deepStrictEqual([...DIRECTORY_LANGUAGES], [...LOCALES],
    "the gids offers a language the product does not speak, or misses one it does");
  for (const l of LOCALES) assert.ok(isDirectoryLanguage(l), `${l} is a product language but not a gids one`);
  for (const nee of ["de", "fr", "pl", "NL", "", "nl-NL"]) {
    assert.ok(!isDirectoryLanguage(nee), `${nee} passed as a known language`);
  }
});

test("[KANTOORGIDS-TAAL] language is listing data and never touches the order", () => {
  // The order is availability, then name. A field that can move it is a lever, and a list with a
  // lever is an advertisement — so adding a column must not have changed the sort at all.
  const maak = (id: string, naam: string, ruimte: boolean, talen: string[]) =>
    normaliseEntry({
      accountantId: id, officeName: naam, city: "Utrecht",
      acceptingClients: ruimte, contactEmail: "a@b.nl", languages: talen,
    });
  const gesorteerd = sortForOwner([
    maak("1", "Zwart", true, ["nl", "en", "ar", "tr"]),   // every language, and still second
    maak("2", "Aalders", true, []),                        // none at all, and still first
    maak("3", "Bakker", false, ["nl", "ar"]),
  ]);
  assert.deepStrictEqual(gesorteerd.map((e) => e.officeName), ["Aalders", "Zwart", "Bakker"],
    "the language list moved the order");
});

test("[KANTOORGIDS-TAAL] the other fields kept their meaning", () => {
  // A regression guard for the column being added: nothing above it changed behaviour.
  const entry = normaliseEntry({
    accountantId: "a1", officeName: "  Kantoor  ", city: " Utrecht ",
    specialisms: [" zzp ", "", "horeca"], acceptingClients: true,
    contactEmail: "  INFO@Deboer.NL ", website: " https://deboer.nl ", languages: ["nl"],
  });
  assert.strictEqual(entry.officeName, "Kantoor");
  assert.strictEqual(entry.city, "Utrecht");
  assert.deepStrictEqual([...entry.specialisms], ["zzp", "horeca"]);
  assert.strictEqual(entry.contactEmail, "info@deboer.nl");
  assert.strictEqual(entry.website, "https://deboer.nl");
  assert.strictEqual(entry.acceptingClients, true);
  assert.deepStrictEqual(entryProblems(entry), []);
});

test("[KANTOORGIDS-TAAL] a list longer than the set still reports its unknown", () => {
  // The cap must never swallow the thing it exists to report. Every known language plus a bad one
  // is exactly the case a cap of DIRECTORY_LANGUAGES.length would have dropped silently, leaving
  // the office with a listing it was never told was wrong.
  const entry = normaliseEntry({
    accountantId: "a1",
    languages: ["nl", "en", "ar", "tr", "xx"],
  });
  assert.ok(entry.languages.includes("xx"), "the unknown code was capped away and never reported");
  assert.deepStrictEqual(draftProblems(entry), ["Die taal kennen we niet"]);

  // …and the cap still bounds the input: repetition cannot grow the list.
  const veel = normaliseEntry({
    accountantId: "a1",
    languages: Array.from({ length: 5000 }, () => "nl"),
  });
  assert.deepStrictEqual(veel.languages, ["nl"], "de-duplication stopped bounding the list");
});

// ─── [KANTOORGIDS-BEWIJS] What an office is told when it may not publish yet ───────────────────
//
// The database refuses publication without a consented client link. That refusal is correct and
// authoritative, and on its own it reaches the screen as "Opslaan is niet gelukt." — which is the
// exact unexplained failure this batch was opened to remove. These two sentences are what arrives
// instead, and these tests hold the properties that make them worth having.

test("[KANTOORGIDS-BEWIJS] the two eligibility sentences do not mean the same thing", () => {
  // "you have no client yet" and "we could not read your links" are opposite facts. Saying the
  // first when the second is true sends an office looking for a link it already has — the same
  // failure the empty/unreadable split on the public gids exists to prevent.
  assert.notStrictEqual(PUBLISH_ELIGIBILITY.needsClient, PUBLISH_ELIGIBILITY.unknown);
  assert.match(PUBLISH_ELIGIBILITY.unknown, /niet lezen|weten niet/,
    "the unknown sentence does not say that we could not find out");
  assert.doesNotMatch(PUBLISH_ELIGIBILITY.unknown, /geen klant (gekoppeld|met je)/,
    "a failed read is worded as 'you have no client' — unknown is not zero");
});

test("[KANTOORGIDS-BEWIJS] the refusal says what to do, and is not a failure", () => {
  // A fixable state, not a breakage: it names the one condition and it is Dutch prose, not a code.
  assert.match(PUBLISH_ELIGIBILITY.needsClient, /minstens één klant/);
  assert.match(PUBLISH_ELIGIBILITY.needsClient, /gekoppeld/);
  for (const zin of [PUBLISH_ELIGIBILITY.needsClient, PUBLISH_ELIGIBILITY.unknown]) {
    assert.ok(zin.length > 40 && zin.length < 240, "a sentence this long is not read");
    assert.doesNotMatch(zin, /\b(error|failed|42501|23514|null|undefined)\b/i,
      "a machine word reached the sentence an office reads");
  }
});

test("[KANTOORGIDS-BEWIJS] neither sentence claims we verified anything", () => {
  // A client link is evidence of a RELATIONSHIP — somebody agreed to be this office's client. It
  // is not proof of certification, and the copy must never imply BoekBrug checked a qualification
  // it has never looked at.
  for (const zin of [PUBLISH_ELIGIBILITY.needsClient, PUBLISH_ELIGIBILITY.unknown]) {
    assert.doesNotMatch(zin, /geverifieerd|verifica|gecontroleerd|erkend|keurmerk|gecertificeerd|bevoegd/i,
      "the eligibility copy claims a verification that never happened");
  }
});

test("[KANTOORGIDS-BEWIJS] neither sentence claims the listing was saved", () => {
  // A refused publish makes NO write attempt, so "je vermelding is bewaard" would be false. The
  // office is told plainly that nothing was written, and that a draft is still possible.
  for (const zin of [PUBLISH_ELIGIBILITY.needsClient, PUBLISH_ELIGIBILITY.unknown]) {
    assert.match(zin, /niets opgeslagen/,
      "the sentence does not say that nothing was written — but nothing was");
  }
  // …and it does not name a button. [KNOP-IN-ZIN]: which save button is on screen depends on
  // whether the office is currently listed, so naming one would be wrong half the time.
  for (const zin of [PUBLISH_ELIGIBILITY.needsClient, PUBLISH_ELIGIBILITY.unknown]) {
    assert.doesNotMatch(zin, /Alleen opslaan|Zet mij in de gids|Haal mij uit de gids|Bijwerken/,
      "the sentence names a button that is not always on the screen");
  }
});
