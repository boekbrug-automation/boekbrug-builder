// tests/render/kantoor-links.test.tsx
// Run: node --experimental-test-module-mocks --import tsx --test tests/render/kantoor-links.test.tsx
//
// [KANTOOR-LINKS] The other half of the proof. accountant-deep-links.test.ts asserts that the URLs
// are SPELLED right; these assert that the destinations actually READ them — which is the half a
// string test cannot see. A link carrying `?clientId=&q=&year=` to a screen that ignores all three
// looks perfect in a diff and still makes the accountant choose the client and the quarter again.
//
// No browser, no session, no database: every screen here takes its data as props, exactly like the
// rest of tests/render/.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The query string under test — swapped per case, read through the mocked hook.
let PARAMS = new URLSearchParams();

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => PARAMS,
    usePathname: () => "/dashboard",
    useParams: () => ({}),
    notFound: () => { throw new Error("notFound"); },
    redirect: (to: string) => { throw new Error("redirect " + to); },
  },
});

const KLANT = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const ANDERE = "88d752ab-ad59-4991-8f3d-280dafc42b61";

/** The text a reader would see, with the selected <option> marked so a preselect is visible. */
function visible(html: string): string {
  return html
    .replace(/<option([^>]*)selected=""([^>]*)>/g, "<option$1$2>[GEKOZEN] ")
    .replace(/<\/(p|div|h1|h2|li|section|summary|button|label|option|a|span)>/g, "$&\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

// ── Opvragen: does it open on the client and quarter it was handed? ──────────

const KWARTALEN = [
  { year: 2026, quarter: 3, label: "Q3 2026" },
  { year: 2026, quarter: 2, label: "Q2 2026" },
  { year: 2026, quarter: 1, label: "Q1 2026" },
  { year: 2025, quarter: 4, label: "Q4 2025" },
];
const KLANTEN = [{ id: KLANT, naam: "Kiwi" }, { id: ANDERE, naam: "Bakkerij Yilmaz" }];

async function opvragen(qs: string): Promise<string> {
  PARAMS = new URLSearchParams(qs);
  const { default: AccountantOpvragen } = await import("../../src/modules/accountant/pages/AccountantOpvragen");
  return renderToStaticMarkup(
    React.createElement(AccountantOpvragen as never, { klanten: KLANTEN, kwartalen: KWARTALEN }),
  );
}

test("[KANTOOR-LINKS] Opvragen opens on the client and quarter the gap named", async () => {
  const html = await opvragen(`clientId=${KLANT}&q=2&year=2026`);
  const text = visible(html);
  assert.match(text, /\[GEKOZEN\] Kiwi/, "the client the chip was about is not preselected");
  assert.match(text, /\[GEKOZEN\] Q2 2026/, "the quarter the chip was about is not preselected");
  // Two clients and only one may be chosen: a preselect that also left the other selected would
  // send the request to whichever the browser resolved first.
  assert.equal((text.match(/\[GEKOZEN\]/g) ?? []).length, 2, text);
});

test("[KANTOOR-LINKS] Q1 and the year before it survive the trip", async () => {
  assert.match(visible(await opvragen(`clientId=${KLANT}&q=1&year=2026`)), /\[GEKOZEN\] Q1 2026/);
  assert.match(visible(await opvragen(`clientId=${KLANT}&q=4&year=2025`)), /\[GEKOZEN\] Q4 2025/);
});

test("[KANTOOR-LINKS] a stale or impossible preselection leaves the screen as it was", async () => {
  // An unlinked client, a quarter that is not offered, a garbled pair: this screen MAILS an
  // entrepreneur, so it must never open half-set on a value nobody chose.
  for (const qs of [
    "clientId=00000000-0000-0000-0000-000000000000&q=2&year=2026",
    `clientId=${KLANT}&q=9&year=2026`,
    `clientId=${KLANT}&q=2&year=1999`,
    "q=2&year=2026",
    "",
  ]) {
    const text = visible(await opvragen(qs));
    // The default is what it always was: nothing chosen with two clients, newest quarter.
    assert.match(text, /\[GEKOZEN\] Q3 2026|\[GEKOZEN\] Q2 2026/, qs);
    assert.ok(!text.includes("[GEKOZEN] Bakkerij"), `${qs} preselected a client it was not given`);
    if (!qs.startsWith(`clientId=${KLANT}`)) {
      assert.ok(!text.includes("[GEKOZEN] Kiwi"), `${qs} preselected a client it was not given`);
    }
  }
});

// ── The Brug: does it open on the client's Documenten for that period? ───────

type Node = Record<string, unknown>;
const node = (path: string[], id: string): Node => ({
  source: "invoice", id, displayName: id, path, date: "2026-07-04", amount: 100,
  badges: [], pdfUrl: null, hidden: false, clientId: KLANT, ownerId: KLANT,
});
const NODES: Node[] = [
  node(["Klanten", "Kiwi", "2026", "Q3", "Crediteuren"], "q3-een"),
  node(["Klanten", "Kiwi", "2026", "Q2", "Crediteuren"], "q2-een"),
  node(["Klanten", "Bakkerij Yilmaz", "2026", "Q3", "Debiteuren"], "andere"),
];
const SUMMARIES = [
  { id: KLANT, label: "Kiwi", verified: 1, pending: 0, status: "ready" as const },
  { id: ANDERE, label: "Bakkerij Yilmaz", verified: 0, pending: 1, status: "review" as const },
];

async function brug(qs: string): Promise<string> {
  PARAMS = new URLSearchParams(qs);
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  return renderToStaticMarkup(
    React.createElement(BrugClient as never, {
      nodes: NODES, role: "accountant", clientSummaries: SUMMARIES, docStatus: {},
    }),
  );
}

/**
 * The breadcrumb, as a path — the ONE place `cwd` is visible.
 *
 * Asserted on its own and never on the whole page: the hub also renders a client dropdown holding
 * every client and a Q1–Q4 picker, so "Q4 appears somewhere" and "the other client appears
 * somewhere" are true on every render and prove nothing.
 */
function breadcrumb(text: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf("Alles");
  if (start === -1) return "";
  const rest = lines.slice(start);
  const end = rest.indexOf("search");
  return rest
    .slice(0, end === -1 ? undefined : end)
    .filter((l) => l !== "chevron_right")
    .join(" / ");
}

test("[KANTOOR-LINKS] the Brug opens on this client's Documenten, in this quarter", async () => {
  const text = visible(await brug(`clientId=${KLANT}&tab=documenten&q=3&year=2026`));
  assert.equal(breadcrumb(text), "Alles / Klanten / Kiwi / 2026 / Q3", text.slice(0, 800));
  // The client picker agrees with the tree — one selected client, and it is the one asked for.
  assert.match(text, /\[GEKOZEN\] Kiwi/);
  assert.equal((text.match(/\[GEKOZEN\]/g) ?? []).length, 1, text);
  // And what is IN that folder is this client's, not the other's.
  assert.ok(text.includes("Crediteuren"), "the Q3 folder rendered nothing");
  assert.ok(!text.includes("Debiteuren"), "the other client's branch is showing");
});

test("[KANTOOR-LINKS] the Brug lands as deep as there is something to land on", async () => {
  // Q4 2026 holds nothing for this client, but 2026 does. An empty folder reads as "the documents
  // are gone", so the walk stops at the last segment that EXISTS — here the year, with Q2 and Q3
  // in front of the accountant — rather than opening a blank Q4.
  const text = visible(await brug(`clientId=${KLANT}&tab=documenten&q=4&year=2026`));
  assert.equal(breadcrumb(text), "Alles / Klanten / Kiwi / 2026", JSON.stringify(breadcrumb(text)));

  // A year the client has nothing in at all stops one level earlier still.
  const leeg = visible(await brug(`clientId=${KLANT}&tab=documenten&q=1&year=2024`));
  assert.equal(breadcrumb(leeg), "Alles / Klanten / Kiwi", JSON.stringify(breadcrumb(leeg)));
});

test("[KANTOOR-LINKS] the Brug opened from the menu is exactly what it was", async () => {
  // No params → no client, no tree, the hub's own first tab: the behaviour every other caller has.
  assert.equal(breadcrumb(visible(await brug(""))), "", "a tree opened without being asked for");
  // A client the accountant does not have is ignored rather than half-applied. (The picker's own
  // "— Kies een klant —" placeholder is the selected option in that state, which is the point.)
  const stale = visible(await brug("clientId=00000000-0000-0000-0000-000000000000&tab=documenten&q=3&year=2026"));
  assert.equal(breadcrumb(stale), "", "a stale client id opened a tree");
  assert.ok(!stale.includes("[GEKOZEN] Kiwi"), "a stale client id selected a client");
  assert.ok(!stale.includes("[GEKOZEN] Bakkerij"), "a stale client id selected a client");
});

// ── Back-navigation and role ────────────────────────────────────────────────

test("[KANTOOR-LINKS] a deep link is an ordinary URL — back returns to the signal", async () => {
  // Every destination is reached with a full href/push, never by replacing history or by state
  // the URL does not carry: re-rendering the same query string must produce the same screen, or
  // the browser's Back (and a refresh) would land somewhere else than the accountant left.
  const first = await opvragen(`clientId=${KLANT}&q=2&year=2026`);
  const again = await opvragen(`clientId=${KLANT}&q=2&year=2026`);
  assert.equal(visible(first), visible(again), "the same URL rendered two different screens");

  const b1 = await brug(`clientId=${KLANT}&tab=documenten&q=3&year=2026`);
  const b2 = await brug(`clientId=${KLANT}&tab=documenten&q=3&year=2026`);
  assert.equal(visible(b1), visible(b2), "the same URL rendered two different bridges");
});

test("[KANTOOR-LINKS] a client id from the URL never reaches a tree the reader is not an accountant for", async () => {
  // An owner's bridge is built without the 'Klanten' dimension (bridge-tree.ts:470) — these are
  // the nodes that reader really has. A `clientId` in the URL must change nothing about it: the
  // seed is gated on the accountant role, not on the presence of a parameter.
  PARAMS = new URLSearchParams(`clientId=${KLANT}&tab=documenten&q=3&year=2026`);
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  const ownerNodes = [node(["2026", "Q3", "Crediteuren"], "eigen")];
  const html = renderToStaticMarkup(
    React.createElement(BrugClient as never, {
      nodes: ownerNodes, role: "zzp", clientSummaries: undefined, docStatus: {},
    }),
  );
  const text = visible(html);
  assert.equal(breadcrumb(text), "Alles", "an owner's bridge opened somewhere it was not");
  assert.ok(!text.includes("[GEKOZEN]"), "an owner's bridge selected a client");
});
