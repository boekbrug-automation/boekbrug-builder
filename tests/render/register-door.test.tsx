// tests/render/register-door.test.tsx
// [EERSTE-DEUR] What the registration door actually ASKS, asserted by rendering it.
//
// Run: npm run test:render
//
// ── WHY THIS IS A RENDER TEST AND NOT A SOURCE GATE ──
// A source gate can assert that a string is absent from a file. It cannot assert what a visitor is
// asked, because a field can be present in the source and absent from the screen (a branch that
// never runs), or absent from the source and present on the screen (a shared component). The thing
// this batch changed is what is ON THE SCREEN, so that is what is measured here: the page is
// called, and the markup it produces is read.
//
// It is also the one gate that keeps the promise from being quietly walked back. "Registration
// collects an identity, not a business administration" is a sentence; a rendered form with a
// KVK field in it is the fact. The next person to add "just one more field, it is optional
// anyway" turns this red — which is exactly how the three that were removed got there.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// DELIBERATELY FAKE — same reasoning as screens-render.test.tsx: the Supabase client refuses to be
// CONSTRUCTED without a URL and a key. This page only builds one inside an effect, and effects do
// not run under react-dom/server, but the import graph must not be able to trip over it either.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The App Router hooks throw outside a router. `search` is a live binding the mock closes over, so
// one process can walk the door with and without a carried role instead of one file per case.
let search = new URLSearchParams();
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => search,
    usePathname: () => "/register",
    useParams: () => ({}),
    notFound: () => { throw new Error("[EERSTE-DEUR] the door called notFound()"); },
    redirect: (to: string) => { throw new Error(`[EERSTE-DEUR] the door redirected to ${to}`); },
  },
});

async function deur(query = ""): Promise<string> {
  search = new URLSearchParams(query);
  const { default: RegisterPage } = await import("../../src/app/register/page");
  return renderToStaticMarkup(React.createElement(RegisterPage));
}

/** The three fields this batch removed, each by the id the form gave it and the words it showed. */
const WEG: readonly [string, string, RegExp][] = [
  ["bedrijfsnaam", "reg-company", /Bedrijfsnaam/i],
  ["KVK-nummer", "reg-kvk", /KVK-nummer/i],
  ["BTW-nummer", "reg-btw", /BTW-nummer/i],
];

test("[EERSTE-DEUR] the door asks for an identity: name, e-mail, password — and nothing else", async () => {
  // ?rol= carried, so this is the field step rather than the role step.
  const html = await deur("rol=zzper");

  // What creating an account genuinely needs.
  for (const [naam, id] of [["name", "reg-name"], ["e-mail", "reg-email"], ["password", "reg-password"]] as const) {
    assert.match(html, new RegExp(`id="${id}"`), `the door no longer asks for a ${naam}`);
  }

  // And what it must not ask for. Both the input and the words: an id could survive a relabel, and
  // a label could survive an id change, and either one alone is still the field being back.
  for (const [naam, id, woorden] of WEG) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${naam} is back on the registration form`);
    assert.doesNotMatch(html, woorden, `${naam} is back on the registration form, by its label`);
  }

  // The hint that made them feel harmless is gone with them. A field you are told you may skip is
  // a field that did not belong on the screen that creates the account.
  assert.doesNotMatch(html, /Kun je later invullen/, "the 'fill this in later' hint outlived its fields");
});

test("[EERSTE-DEUR] the role is asked once, at the door, and skipped when it already travelled", async () => {
  // No ?rol=: step 1, the one question this screen genuinely owns.
  const zonder = await deur();
  assert.match(zonder, /Wie ben jij\?|مَن أنت|Who are you/, "the role question is gone from the door");
  assert.doesNotMatch(zonder, /id="reg-email"/, "the fields are shown before the role is chosen");

  // ?rol= from /voor-boekhouders or an invitation: answered by clicking, so never asked again.
  const met = await deur("rol=accountant");
  assert.doesNotMatch(met, /Wie ben jij\?/, "a role that already travelled is asked for a second time");
  assert.match(met, /id="reg-email"/, "…and the visitor is taken straight to the fields");

  // [KLUIS] The archive door has no role question either — that visitor is an entrepreneur with
  // an administration, full stop — and it must not have regained the removed fields.
  const archief = await deur("doel=archief");
  assert.doesNotMatch(archief, /Wie ben jij\?/);
  assert.match(archief, /id="reg-email"/);
  for (const [naam, id] of WEG) {
    assert.doesNotMatch(archief, new RegExp(`id="${id}"`), `${naam} is back on the archive door`);
  }
});

test("[EERSTE-DEUR] the door still carries what the visitor brought", async () => {
  // [UITNODIGING] The invited address is prefilled — typing a different one is the failure the
  // acceptance route then has to refuse, so this is a correctness property and not a nicety.
  const uitgenodigd = await deur("rol=zzper&email=klant%40bedrijf.nl");
  assert.match(uitgenodigd, /value="klant@bedrijf\.nl"/, "the invited address is no longer prefilled");

  // [TAAL-POORT] And the language switch is still on the door, in front of the login, because the
  // only other way to leave Dutch lives behind it.
  assert.match(uitgenodigd, /العربية/, "the language switch fell off the door");
});
