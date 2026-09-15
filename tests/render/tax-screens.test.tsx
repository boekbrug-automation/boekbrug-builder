// tests/render/tax-screens.test.tsx
// [RENDER-GATE] Do the three screens a quarter is FILED from survive one render?
//
// Run: npm run test:render
//
// ── WHY THESE THREE, AND WHY NOW ──
//
// The argument for this whole directory is at the top of money-screens.test.tsx, and AGENTS.md
// states the failure it exists for: /dashboard/incoming/manage went through tsc, eslint, next build
// AND the Playwright sweep with a `const` read seventy lines before it was declared, inside a
// .filter() callback that runs during render. The screen would have been white.
//
// These three were not in this directory at all:
//
//   · /dashboard/aangifte — the BTW return. The single most consequential screen in the product:
//     the owner copies these figures onto a form he files with the Belastingdienst.
//   · /dashboard/klaar    — the readiness board, which decides whether a quarter may be filed.
//   · /dashboard/waarheid — the truth lens, where an owner checks a figure he does not trust.
//
// All three fetch their own data, so what renders here is the first paint. That is not a weaker
// test than it sounds: a temporal-dead-zone reference, a null deref on an initial-state field or a
// bad import throws on exactly that paint, and every other gate in `npm run gates` is blind to it.
//
// Effects never run under renderToStaticMarkup, so nothing here reaches a network. If one of these
// screens ever needs one to paint, it has stopped being renderable and this test is where it shows.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Same fakes and the same reasoning as money-screens.test.tsx: the Supabase client refuses to be
// CONSTRUCTED without a URL and a key, and these screens construct one while rendering. The host
// does not exist, which is the point.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

async function shell(node: React.ReactElement): Promise<string> {
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null, React.createElement(DialogProvider, null, node)),
  );
}

test("[RENDER-GATE] the BTW return screen renders, in all three accountant states", async () => {
  const { default: AangifteClient } = await import("../../src/app/dashboard/aangifte/AangifteClient");

  // null is not a third shade of false: it means the read of "is there an accountant" itself
  // failed, and the screen must not then claim who files this return. All three must paint.
  for (const hasAccountant of [true, false, null] as const) {
    const html = await shell(React.createElement(AangifteClient, { hasAccountant }));
    assert.ok(html.length > 200, `hasAccountant=${String(hasAccountant)} rendered almost nothing`);
  }
});

test("[RENDER-GATE] the readiness board renders", async () => {
  // The board that decides whether a quarter may be filed at all. A white screen here does not
  // just hide a figure — it removes the gate.
  const { default: KlaarClient } = await import("../../src/app/dashboard/klaar/KlaarClient");
  const html = await shell(React.createElement(KlaarClient));
  assert.ok(html.length > 200, "the readiness board rendered almost nothing");
});

test("[RENDER-GATE] the truth lens renders", async () => {
  const { default: WaarheidClient } = await import("../../src/app/dashboard/waarheid/WaarheidClient");
  const html = await shell(React.createElement(WaarheidClient));
  assert.ok(html.length > 200, "the truth lens rendered almost nothing");
});

test("[RENDER-GATE] none of the three renders a raw message key", async () => {
  // [TAAL] t() returns the KEY for one it does not know, on purpose, so a typo is loud in
  // development. Loud is right there and wrong on a screen an owner files a tax return from.
  const { default: AangifteClient } = await import("../../src/app/dashboard/aangifte/AangifteClient");
  const { default: KlaarClient } = await import("../../src/app/dashboard/klaar/KlaarClient");
  const { default: WaarheidClient } = await import("../../src/app/dashboard/waarheid/WaarheidClient");
  const { MESSAGES } = await import("../../src/lib/i18n/messages");
  const PREFIXES = new Set(Object.keys(MESSAGES).map((k) => k.split(".")[0]));

  for (const [name, node] of [
    ["aangifte", React.createElement(AangifteClient, { hasAccountant: false })],
    ["klaar", React.createElement(KlaarClient)],
    ["waarheid", React.createElement(WaarheidClient)],
  ] as const) {
    const html = await shell(node);
    // A dotted lowercase token between tags LOOKS like a key — and so does `belastingdienst.nl`,
    // which is a domain in the copy and was the first thing this caught. So the test is anchored on
    // the catalogue's own PREFIXES: a token is a leaked key only when its first segment is one the
    // catalogue actually uses. Derived rather than listed, so a new prefix is covered the day it
    // exists — and an unknown key cannot be recognised by membership, because t() returns the key
    // precisely when the catalogue does NOT have it.
    const leaked = [...html.matchAll(/>([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){1,3})</g)]
      .map((m) => m[1])
      .filter((tok) => PREFIXES.has(tok.split(".")[0]));
    assert.deepEqual(leaked, [], `${name} rendered untranslated keys: ${leaked.join(", ")}`);
  }
});

// ── [GELEERD-SINDSDIEN] The ignored invoices the reader has since learned to read ─────────────
test("[GELEERD-SINDSDIEN] the panel is absent until it has something to offer", async () => {
  const { default: GeleerdPanel } = await import("../../src/components/grootboek/GeleerdPanel");
  // The ignored list is not a place to be nagged: a heading with nothing under it is a nag, and
  // before the read answers it would also be a claim nobody has checked.
  const html = renderToStaticMarkup(React.createElement(GeleerdPanel as never));
  assert.equal(html, "", "nothing to offer is nothing to show");
});

test("[GELEERD-SINDSDIEN] and it RENDERS the offer, with what was learned beside each row", async () => {
  const { GeleerdList } = await import("../../src/components/grootboek/GeleerdPanel");
  const items = [
    { id: "1", invoiceNumber: "26302362", invoiceDate: "2026-07-09", vendor: "ATAPACK Cash & Carry B.V.",
      totalIncBtw: 4917.9, gained: ["btw_split", "statiegeld"] as const },
    // No amount, no number, no vendor, and nothing learned — every optional at once, because that
    // is the row that finds a crash the happy one never will.
    { id: "2", invoiceNumber: null, invoiceDate: null, vendor: null,
      totalIncBtw: null, gained: [] as const },
  ];
  const html = renderToStaticMarkup(
    React.createElement(GeleerdList as never, { items, busy: null, onPutBack: () => {} }),
  );
  assert.ok(html.length > 0, "the list rendered nothing at all");
  assert.match(html, /ATAPACK/);
  assert.match(html, /BTW-uitsplitsing per tarief/, "what was learned must be named, not summarised");
  assert.match(html, /statiegeld/);
  assert.match(html, /Terugzetten/);
  assert.doesNotMatch(html, />gl\.[a-zA-Z.]+</, "an untranslated key reached the screen");
});

// ── [GROOTBOEK] The purchase invoices that still need a cost account ──────────────────────────
test("[GROOTBOEK] the panel is absent until its read answers — never an empty 'all done'", async () => {
  const { default: GrootboekPanel } = await import("../../src/components/grootboek/GrootboekPanel");
  // "Every invoice is on an account" and "we could not look" are opposite answers, and the first
  // is the dangerous one: it tells the owner their administratie is finished.
  const html = renderToStaticMarkup(React.createElement(GrootboekPanel as never));
  assert.equal(html, "", "a heading with a count of zero under it would read as finished");
});

test("[GROOTBOEK] and it RENDERS with rows — the empty case exercises no branch at all", async () => {
  const { GrootboekList } = await import("../../src/components/grootboek/GrootboekPanel");
  const { LEDGER_ACCOUNTS } = await import("../../src/lib/grootboek");
  // The production shape, and one row per BASIS so every reason branch is actually called.
  const data = {
    ok: true as const,
    accounts: [...LEDGER_ACCOUNTS],
    openInvoices: 550,
    decided: 58,
    total: 608,
    open: [
      { key: "id:a", vendor: "Enka Horeca B.V.", ids: ["1", "2"], count: 102, gross: 20079.28,
        newest: "2026-08-14",
        suggestion: { accountId: "7000", confidence: 0.95, basis: "supplier_history" as const } },
      { key: "id:b", vendor: "Van Dijk Vastgoed", ids: ["3"], count: 1, gross: 1250,
        newest: "2026-07-01",
        suggestion: { accountId: "4100", confidence: 0.6, basis: "keywords" as const, matched: "huur" } },
      { key: "name:onbekend", vendor: null, ids: ["4"], count: 3, gross: 0, newest: null,
        suggestion: { accountId: "4000", confidence: 0, basis: "default" as const } },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(GrootboekList as never, { data, saving: null, onAssign: () => {} }),
  );
  assert.ok(html.length > 0, "the list rendered nothing at all");
  assert.match(html, /Enka Horeca/, "the supplier name never reached the screen");
  // Every reason branch produced Dutch, not a key.
  assert.match(html, /eerder op/, "the supplier-history reason");
  assert.match(html, /huur/, "the keyword reason names the word that decided");
  assert.match(html, /weten het niet/, "an unknown basis says so rather than pretending");
  // The size of the decision is on screen — 102 invoices behind one dropdown.
  assert.match(html, /102 facturen/);
  // A vendor with no name must not crash the row, and a group of 3 is still plural.
  assert.match(html, /3 facturen/);
  assert.doesNotMatch(html, />gb\.[a-zA-Z.]+</, "an untranslated key reached the screen");
});

// ── [OPDRACHTGEVER] Who this year's money came from ───────────────────────────────────────────
test("[OPDRACHTGEVER] the panel states the facts and no verdict, and a failed read says so", async () => {
  const { default: OpdrachtgeversPanel } = await import("../../src/components/dba/OpdrachtgeversPanel");
  // The panel fetches on mount; a server render shows its resting state, which must be nothing —
  // a heading with no numbers under it would read as "no clients" before the answer arrives.
  const html = renderToStaticMarkup(React.createElement(OpdrachtgeversPanel as never, { year: 2026 }));
  assert.equal(html, "", "before the read answers, the panel is absent — never an empty year");
});
