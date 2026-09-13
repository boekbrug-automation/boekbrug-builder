// tests/render/control-center.test.tsx
// [CONTROL] Does the console render, on an empty product and on a real one?
//
// Run: npm run test:render
//
// It is a screen almost nobody opens, which is exactly why it needs this: a white page here is
// discovered late, by the one person who went looking for a number during a conversation.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ControlScherm from "../../src/app/dashboard/control/ControlScherm";
import { buildControlOverview, type ControlAccount } from "../../src/lib/control-overview";

const NU = Date.parse("2026-09-12T12:00:00Z");
const dag = (n: number) => new Date(NU + n * 86_400_000).toISOString();

const acc = (over: Partial<ControlAccount> = {}): ControlAccount => ({
  id: "a", name: "Kiwi Food Market", role: "zzper", createdAt: dag(-10),
  subscriptionStatus: null, currentPeriodEnd: null, grants: [], ...over,
});

test("[CONTROL] an empty product renders as an empty console, not a crash", () => {
  const html = renderToStaticMarkup(
    React.createElement(ControlScherm, { overzicht: buildControlOverview([], NU), grantsLeesbaar: true }),
  );
  assert.match(html, /Control Center/);
  assert.match(html, /Nog geen accounts/);
});

test("[CONTROL] real rows render, including the two states that have no date", () => {
  const overzicht = buildControlOverview([
    acc({ id: "1", name: "Kiwi", grants: [{ id: "g1", plan: "plus", starts_at: dag(-1), expires_at: null, revoked_at: null, reason: "Partnerafspraak" }] }),
    acc({ id: "2", name: "Moon Bv", grants: [{ id: "g2", plan: "plus", starts_at: dag(-1), expires_at: dag(40), revoked_at: null, reason: "Pilot" }] }),
    acc({ id: "3", name: "GO bv", role: "accountant" }),
    acc({ id: "4", name: "", subscriptionStatus: "active" }),
  ], NU);
  const html = renderToStaticMarkup(React.createElement(ControlScherm, { overzicht, grantsLeesbaar: true }));

  assert.match(html, /Kiwi/);
  assert.match(html, /boekhouder/);
  assert.match(html, /\(zonder naam\)/, "a nameless account rendered as an empty cell");
  assert.match(html, />open</, "an open-ended grant must not render as a date");
  assert.match(html, /betaalt/);
});

test("[CONTROL] an unreadable grant table is stated, never rendered as zero", () => {
  const html = renderToStaticMarkup(
    React.createElement(ControlScherm, { overzicht: buildControlOverview([acc()], NU), grantsLeesbaar: false }),
  );
  assert.match(html, /konden niet gelezen worden/,
    "a failed read looked exactly like a product where nobody has a grant");
});

test("[CONTROL] no revenue figure reaches the screen", () => {
  const html = renderToStaticMarkup(
    React.createElement(ControlScherm, {
      overzicht: buildControlOverview([acc({ subscriptionStatus: "active" })], NU), grantsLeesbaar: true,
    }),
  );
  // The sentence that says why, and no euro anywhere: betalend × prijs is wrong in both
  // directions on the day it is printed.
  assert.doesNotMatch(html, /€/, "the console printed an amount");
  assert.match(html, /Omzet staat hier bewust niet/);
});

// ── [TOEKENNING-DEUR] The console now has two buttons, and neither may reach the books ───────

test("[TOEKENNING-DEUR] every row offers the grant action, and the panel is closed at rest", () => {
  const overzicht = buildControlOverview([
    acc({ id: "1", name: "Kiwi" }),
    acc({ id: "2", name: "Moon Bv" }),
  ], NU);
  const html = renderToStaticMarkup(React.createElement(ControlScherm, { overzicht, grantsLeesbaar: true }));

  // One door per account…
  assert.strictEqual((html.match(/Toekenning</g) ?? []).length, 2);
  // …and [RUSTIG]: nothing of the form itself is on screen until somebody picks an account.
  assert.doesNotMatch(html, /Plus toekennen/, "the form was rendered before an account was chosen");
  assert.doesNotMatch(html, /geen einddatum/);
});

test("[TOEKENNING-DEUR] the empty product still renders, with the widened row", () => {
  // The colSpan moved from 6 to 7 when the action column arrived; a stale one silently narrows
  // the empty state and is exactly the kind of thing only a render catches.
  const html = renderToStaticMarkup(
    React.createElement(ControlScherm, { overzicht: buildControlOverview([], NU), grantsLeesbaar: true }),
  );
  assert.match(html, /colspan="7"/i, "the empty row no longer spans the whole table");
});
