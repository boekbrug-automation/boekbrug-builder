// tests/render/wachtkoppeling-panel.test.tsx
// [WACHTKOPPELING] Render the panel with rows that exercise every branch.
//
// AGENTS.md: hand it rows that exercise the branches — [].map(cb) never calls cb, so an empty
// payload proves nothing. This set carries a plain waiting payment, one with a proposal, one that
// is ambiguous, one expired, and the read-failed case.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WachtkoppelingView, type WachtPayload } from "../../src/components/bank/WachtkoppelingPanel";
import type { Wachtkoppeling } from "../../src/lib/wachtkoppeling";

const w = (over: Partial<Wachtkoppeling> = {}): Wachtkoppeling => ({
  id: "w-1", richting: "uit", bedrag: 121, betaaldOp: "2026-09-04",
  tegenpartij: "KPN", factuurIds: ["inv-1"], verlooptOp: "2026-09-25", ...over,
});

const payload = (over: Partial<WachtPayload> = {}): WachtPayload => ({
  wachtend: [], verlopen: [], voorstellen: [], ambigu: [], ...over,
});

test("[WACHTKOPPELING] an empty panel invites, rather than showing nothing", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload()} />);
  assert.ok(html.length > 100);
  assert.match(html, /Al betaald, wacht op de bankregel/);
  assert.match(html, /Betaling vastleggen/);
});

test("[WACHTKOPPELING] a waiting payment names the amount and who it went to", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({ wachtend: [w()] })} />);
  assert.match(html, /KPN/);
  assert.match(html, /betaald/);
  assert.match(html, /wachten nog op de bankregel/);
});

test("[WACHTKOPPELING] a found bank line offers to link, and says why it fits", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({
    wachtend: [w()],
    voorstellen: [{ wachtId: "w-1", transactionId: "tx-1", reasons: ["bedrag klopt (€ 121.00)", "datum ligt 1 dag uit elkaar"] }],
  })} />);
  assert.match(html, /Koppelen/);
  assert.match(html, /bedrag klopt/, "a proposal that cannot say why is a guess with a button");
});

test("[WACHTKOPPELING] an ambiguous match asks instead of choosing", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({
    wachtend: [w()], ambigu: [{ wachtId: "w-1" }],
  })} />);
  assert.match(html, /meerdere bankregels/);
  assert.doesNotMatch(html, /Koppelen<\/button>/, "a tie must not be offered as a one-tap answer");
});

test("[WACHTKOPPELING] an expired link says the window passed — it does not vanish", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({ verlopen: [w({ id: "w-9" })] })} />);
  assert.match(html, /geen passende bankregel gekomen/);
  assert.match(html, /Opruimen/);
});

test("[WACHTKOPPELING] a failed bank read is stated, never rendered as 'nothing is waiting'", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({ wachtend: [w()], bankUnavailable: true })} />);
  assert.match(html, /konden niet worden gelezen/);
});

test("[WACHTKOPPELING] money coming IN reads as received, not as paid", () => {
  const html = renderToStaticMarkup(<WachtkoppelingView data={payload({
    wachtend: [w({ richting: "in", tegenpartij: "Jansen" })],
  })} />);
  assert.match(html, /ontvangen van Jansen/);
});
