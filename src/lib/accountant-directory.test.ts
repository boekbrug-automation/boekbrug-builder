// src/lib/accountant-directory.test.ts
// [KANTOORGIDS] Run: npx tsx --test src/lib/accountant-directory.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIRECTORY_LANGUAGES,
  EMPTY_LIST,
  LANGUAGE_LABEL,
  LIMITS,
  emptyAfterFilter,
  entryProblems,
  matchesFilter,
  normaliseEntry,
  normaliseLanguages,
  sortForOwner,
  type DirectoryEntry,
} from "./accountant-directory";

const heel = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  accountantId: "a1",
  officeName: "Kantoor De Boer",
  city: "Utrecht",
  specialisms: ["zzp"],
  languages: ["nl"],
  acceptingClients: true,
  contactEmail: "info@deboer.nl",
  website: null,
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

test("[KANTOORGIDS-TAAL] the language set is the product's own, and unknown languages are dropped", () => {
  // Not a list of its own: whatever BoekBrug speaks, the gids can offer — and nothing else, because
  // a language the product cannot serve a client in is a promise the app cannot keep.
  assert.deepStrictEqual([...DIRECTORY_LANGUAGES], ["nl", "en", "ar", "tr"]);
  for (const code of DIRECTORY_LANGUAGES) {
    assert.ok((LANGUAGE_LABEL[code] ?? "").length > 0, `${code} has no label to render`);
  }
  // Each language written IN that language — the chip is for the person looking for it.
  assert.strictEqual(LANGUAGE_LABEL.ar, "العربية");
  assert.strictEqual(LANGUAGE_LABEL.tr, "Türkçe");

  // Free text is the trap this closed set exists to avoid: four spellings of one language would
  // make a filter answer "no offices" while the offices are right there.
  assert.deepStrictEqual(normaliseLanguages(["Arabisch", "arabic", "العربية", "AR"]), []);
  assert.deepStrictEqual(normaliseLanguages(["ar", "nl"]), ["nl", "ar"], "stored in one fixed order, not the caller's");
  assert.deepStrictEqual(normaliseLanguages(["nl", "nl", "nl"]), ["nl"], "a language ticked twice is one language");
  assert.deepStrictEqual(normaliseLanguages(null), []);
  assert.deepStrictEqual(normaliseLanguages("ar"), [], "a bare string is not a list");
});

test("[KANTOORGIDS-TAAL] an entry with no language may not be published", () => {
  const zonder = normaliseEntry({
    accountantId: "a1", officeName: "Kantoor De Boer", city: "Utrecht", contactEmail: "info@deboer.nl",
  });
  assert.deepStrictEqual(entryProblems(zonder), ["Kies minstens één taal waarin je een ondernemer kunt helpen"]);
  // One tick is the whole cost, and it is the difference between being findable and being scrolled past.
  assert.deepStrictEqual(entryProblems({ ...zonder, languages: ["nl"] }), []);
});

test("[KANTOORGIDS-TAAL] the filter answers 'who understands me', and never reorders", () => {
  const arabisch = heel({ accountantId: "a", officeName: "Al-Amana", city: "Tilburg", languages: ["nl", "ar"] });
  const alleenNl = heel({ accountantId: "b", officeName: "Boekhouder Bakker", city: "Tilburg", languages: ["nl"] });
  const vol = heel({ accountantId: "c", officeName: "Cijfers & Co", city: "Breda", languages: ["nl", "ar"], acceptingClients: false });
  const alle = [arabisch, alleenNl, vol];

  // The owner's real first question, ahead of the town.
  assert.deepStrictEqual(alle.filter((e) => matchesFilter(e, { language: "ar" })).map((e) => e.accountantId), ["a", "c"]);
  // Tilburg + العربية — the case from the brief.
  assert.deepStrictEqual(
    alle.filter((e) => matchesFilter(e, { language: "ar", city: "tilburg" })).map((e) => e.accountantId), ["a"]);
  assert.deepStrictEqual(
    alle.filter((e) => matchesFilter(e, { language: "ar", onlyAccepting: true })).map((e) => e.accountantId), ["a"]);
  // An empty filter is the whole list — the page before anyone touches it.
  assert.strictEqual(alle.filter((e) => matchesFilter(e, {})).length, 3);

  // The town is matched the way people type it, not the way the office wrote it.
  const bosch = heel({ city: "Den Bosch" });
  for (const typed of ["den bosch", "DENBOSCH", "Den  Bosch", "bosch"]) {
    assert.ok(matchesFilter(bosch, { city: typed }), `"${typed}" did not find Den Bosch`);
  }
  assert.ok(!matchesFilter(bosch, { city: "utrecht" }));

  // THE RULE. Filtering must not be able to rank: the order of what survives is the order
  // sortForOwner already gave it — room first, then name — with the language changing nothing.
  const gefilterd = sortForOwner(alle.filter((e) => matchesFilter(e, { language: "ar" })));
  assert.deepStrictEqual(gefilterd.map((e) => e.accountantId), ["a", "c"],
    "the accepting office is still first because it has room, not because of its languages");
  assert.deepStrictEqual(
    sortForOwner(alle).map((e) => e.accountantId),
    sortForOwner([...alle].reverse()).map((e) => e.accountantId),
    "the order depends on the offices, not on the order they arrived in");
});

test("[KANTOORGIDS-TAAL] an empty result says what came up empty", () => {
  // A blank page cannot be told apart from a broken one. Naming the filter is both the honest
  // answer and the one that makes the owner try again instead of leaving.
  const zin = emptyAfterFilter({ language: "ar", city: "Tilburg" });
  assert.match(zin, /العربية/);
  assert.match(zin, /Tilburg/);
  assert.notStrictEqual(zin, EMPTY_LIST.body);
  // No filter at all is a different fact — nobody is listed yet — and keeps the invitation to offices.
  assert.strictEqual(emptyAfterFilter({}), EMPTY_LIST.body);
  assert.match(EMPTY_LIST.body, /BoekBrug-portaal/);
});
