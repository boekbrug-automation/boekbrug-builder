// src/lib/accountant-directory.test.ts
// [KANTOORGIDS] Run: npx tsx --test src/lib/accountant-directory.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_LIST,
  LIMITS,
  entryProblems,
  normaliseEntry,
  sortForOwner,
  type DirectoryEntry,
} from "./accountant-directory";

const heel = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  accountantId: "a1",
  officeName: "Kantoor De Boer",
  city: "Utrecht",
  specialisms: ["zzp"],
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
