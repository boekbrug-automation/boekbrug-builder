// tests/render/kantoorgids.test.tsx
// [KANTOORGIDS] Do the two directory screens render, and do they say the true thing on each branch?
//
// Run: npm run test:render
//
// ── WHY THESE TWO ──
// The public gids is read by an owner who does not have an account yet, and the panel is written
// for the accountant this product is sold through. Both are pure-props-and-state components once
// the data is in, and both have branches that are invisible to tsc: an EMPTY list, an UNREADABLE
// list, a listing that is on and one that is off. The empty and the unreadable branch render the
// same shape and mean opposite things — "niemand staat erin" versus "wij konden het niet lezen" —
// and getting them the wrong way round tells an office that the gids is deserted when it is not.
//
// The public page is an async server component that reads Supabase, so it is exercised through its
// pure parts instead: the module the page renders from. What is asserted here about the page
// itself is what a reader must never see — a paid position, or a promise of offices to come.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import KantoorgidsPaneel from "../../src/modules/accountant/pages/KantoorgidsPaneel";
import GidsLijst from "../../src/app/boekhouders/GidsLijst";
import {
  EMPTY_LIST,
  entryProblems,
  normaliseEntry,
  sortForOwner,
  type DirectoryEntry,
} from "../../src/lib/accountant-directory";

test("[KANTOORGIDS] the office's own panel renders before anything has loaded", () => {
  // The state it is in for the first few hundred milliseconds of every visit, and the one a
  // component that throws on undefined data never survives.
  const html = renderToStaticMarkup(React.createElement(KantoorgidsPaneel));
  assert.ok(html.length > 500, "the panel rendered almost nothing");
  assert.match(html, /Je kantoor in de gids/);
  assert.match(html, /Bezig met laden/, "the first paint claims a state it has not read yet");

  // The two promises that make the listing worth having, on the screen where the office decides.
  assert.match(html, /je kunt hem altijd weer uitzetten/);
  assert.match(html, /geen betaalde plek/);

  // And the public e-mail is named as public, next to the field. An office that discovers later
  // that its address is on a public page is an office that leaves.
  assert.match(html, /Dit adres staat openbaar/);
});

test("[KANTOORGIDS] every field the panel offers is one the rules know about", () => {
  const html = renderToStaticMarkup(React.createElement(KantoorgidsPaneel));
  for (const veld of ["kantoornaam", "plaats", "specialisaties", "mail", "site", "ruimte",
                      "taal-nl", "taal-en", "taal-ar", "taal-tr"]) {
    assert.match(html, new RegExp(`id="${veld}"`), `the panel lost the field ${veld}`);
  }
  // Publishing is one button and un-publishing is another: no single toggle that an office can
  // hit by accident on a page it opened to fix a typo.
  assert.match(html, /Zet mij in de gids/);
  assert.match(html, /Alles verwijderen/);
});

test("[KANTOORGIDS] the empty list and the unreadable list do not say the same thing", () => {
  // Same shape, opposite meanings. The public page renders one or the other; this pins that the
  // words differ, because the day they converge an office reads "leeg" for "kapot".
  const leeg = `${EMPTY_LIST.heading} ${EMPTY_LIST.body}`;
  assert.match(leeg, /Nog geen kantoren/);
  assert.doesNotMatch(leeg, /niet te lezen|misgegaan|probeer het zo nog eens/i,
    "the empty list borrowed the wording of the failure");
});

test("[KANTOORGIDS] the order the page renders is the module's order, availability first", () => {
  const maak = (id: string, naam: string, ruimte: boolean) =>
    normaliseEntry({
      accountantId: id, officeName: naam, city: "Utrecht",
      acceptingClients: ruimte, contactEmail: "a@b.nl",
    });
  const gesorteerd = sortForOwner([
    maak("1", "Zwart", false),
    maak("2", "Aalders", true),
  ]);
  assert.deepStrictEqual(gesorteerd.map((e) => e.officeName), ["Aalders", "Zwart"]);
  // Nothing in a rendered entry can carry a rank: the type has no field for one.
  assert.deepStrictEqual(
    Object.keys(gesorteerd[0]!).sort(),
    ["acceptingClients", "accountantId", "city", "contactEmail", "languages", "officeName", "specialisms", "website"],
    "a directory entry grew a field — check it is not a rank, a score or a paid position",
  );
});

test("[KANTOORGIDS] a listing that cannot be reached is never publishable", () => {
  // The reason the panel validates before sending: an owner writing to an address that is not
  // there never learns it did not arrive, and neither does the office.
  const zonderMail = normaliseEntry({
    accountantId: "a", officeName: "Kantoor", city: "Utrecht", contactEmail: "",
  });
  assert.ok(entryProblems(zonderMail).length > 0, "a listing with no e-mail passed as publishable");
});

test("[KANTOORGIDS-TAAL] the public list opens on EVERYTHING, and shows what each office claims", () => {
  // The branch that matters most and is invisible to tsc: the first paint, before anyone has
  // touched a filter. Every office must be there — see the header of GidsLijst for why the owner's
  // own account language is deliberately not pre-filled here.
  const maak = (over: Partial<DirectoryEntry>): DirectoryEntry =>
    normaliseEntry({
      accountantId: "x", officeName: "Kantoor", city: "Tilburg",
      acceptingClients: true, contactEmail: "a@b.nl", languages: ["nl"], ...over,
    });
  const entries = sortForOwner([
    maak({ accountantId: "1", officeName: "Al-Amana", languages: ["nl", "ar"] }),
    maak({ accountantId: "2", officeName: "Bakker", languages: ["nl"] }),
    maak({ accountantId: "3", officeName: "Cijfers", city: "Breda", languages: ["nl", "tr"], acceptingClients: false }),
  ]);
  const html = renderToStaticMarkup(React.createElement(GidsLijst, { entries }));

  assert.match(html, /Vind een boekhouder die bij jou past/);
  for (const naam of ["Al-Amana", "Bakker", "Cijfers"]) {
    assert.match(html, new RegExp(naam), `${naam} is missing from the unfiltered list`);
  }
  // "Alle talen" is the state the page opens in, so nothing is hidden from an owner who never
  // touched the filter — the whole point of the filter being a choice rather than a default.
  assert.match(html, /Alle talen/);
  assert.doesNotMatch(html, /van de 3 kantoren/,
    "the page opened already filtered — an owner would be shown a narrowed list he never asked for");

  // Every language is offered as a chip, written in its own script.
  for (const woord of ["Nederlands", "English", "العربية", "Türkçe"]) {
    assert.match(html, new RegExp(woord), `the filter cannot offer ${woord}`);
  }
  // And a claim is rendered as a claim.
  assert.match(html, /Dit kantoor zegt je te kunnen helpen in/);
  assert.doesNotMatch(html, /gecontroleerd door BoekBrug|geverifieerd/i,
    "the gids implied it checked a language nobody checked");
});

test("[KANTOORGIDS-TAAL] an office with no listing at all still renders the invitation", () => {
  const html = renderToStaticMarkup(React.createElement(GidsLijst, { entries: [] }));
  assert.ok(html.length > 200, "the empty gids rendered almost nothing");
  assert.match(html, /BoekBrug-portaal/, "the empty list stopped inviting offices to join it");
});
