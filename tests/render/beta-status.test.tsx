// tests/render/beta-status.test.tsx
// [BETA] BoekBrug says it is in bèta — calmly, in the owner's exact words, and only where it
// belongs.
//
// Rendered rather than grepped, because two of the three things that can go wrong here are not
// visible in the source: a paragraph that quietly loses a sentence when someone reformats it, and
// a colour that turns a statement of fact into a warning about the owner's administration.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BetaBadge, BetaNotice } from "@/components/beta";

/** The owner's own three lines. Word for word — this is copy, not a paraphrase. */
const LINES = [
  "BoekBrug is momenteel in bèta.",
  "We verbeteren BoekBrug actief op basis van gebruik in de praktijk. Daardoor kunnen onderdelen nog veranderen of verder worden verfijnd.",
  "Je administratie en documenten blijven daarbij ons uitgangspunt: veilig, duidelijk en zonder onnodig werk voor jou.",
];

test("[BETA] the homepage note says exactly what the owner wrote", () => {
  const html = renderToStaticMarkup(<BetaNotice />);
  for (const line of LINES) {
    assert.ok(html.includes(line), `the note lost or rewrote a line:\n  ${line}`);
  }
});

test("[BETA] it is never styled as a warning about the administration", () => {
  const html = renderToStaticMarkup(<BetaNotice />);
  // Bèta means "this product is still moving", not "your books may be unsafe". The reds and ambers
  // this app uses for real trouble ([M3] error, and the amber of a held document) may not appear
  // here, nor may the symbols that say the same thing without words.
  for (const alarm of ["#b3261e", "#d93025", "#c5221f", "#f9ab00", "#e37400", "⚠", "❗", "🚨"]) {
    assert.ok(!html.includes(alarm), `the note carries an alarm signal: ${alarm}`);
  }
  // And it is a note, so a screen reader announces it as one rather than as an alert.
  assert.match(html, /role="note"/);
});

test("[BETA] the badge holds no language of its own", () => {
  // The rule from AGENTS.md: copy lives outside the component, the component renders what it is
  // handed. Inside the app that word comes from messages.ts (kop.beta) and follows the owner's
  // language; on the Dutch public pages it is the Dutch word.
  assert.match(renderToStaticMarkup(<BetaBadge label="Bèta" />), />Bèta</);
  assert.match(renderToStaticMarkup(<BetaBadge label="بيتا" />), />بيتا</);
  assert.match(renderToStaticMarkup(<BetaBadge label="Beta" />), />Beta</);
});
