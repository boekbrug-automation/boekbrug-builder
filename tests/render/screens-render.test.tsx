// tests/render/screens-render.test.tsx
// [WIT-SCHERM] Every dashboard screen must survive being CALLED, not merely compiled.
//
// Run: npm run test:render
//
// ── THE HOLE THIS CLOSES ──
// The render gate existed, and it covered the four money screens. Measured across the rest:
// fifteen client screens — 5.317 lines, including /dashboard/upload, the door every document in
// this app comes through — were never called by any test. A screen that throws on every render
// passes tsc, eslint, next build and the Playwright smoke sweep, because none of those call a
// component and the smoke test never logs in (see money-screens.test.tsx for the case that proved
// it). So fifteen screens could have been white pages and every gate would have been green.
//
// That is not an abstract risk here. The owner demonstrates this app to accountants, on his own
// laptop, with no developer in the room. A screen that breaks during that meeting ends the meeting.
//
// ── WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ──
// It asserts each screen RUNS and produces markup. It is not a UI test: not how a screen looks, not
// what a click does. Behaviour lives in the pure modules with their own tests. This covers the one
// thing those cannot see — whether the screen that uses them survives being called.
//
// A screen that fetches its own rows can only be seen in its EMPTY state from here, and that limit
// is stated rather than hidden: renderToStaticMarkup runs no effects, so nothing reaches a network.
// Where a screen takes its rows as props, this file hands it rows that exercise the branches —
// [RENDER-GATE]'s own rule, because `[].filter(cb)` never calls `cb` and the bug hides in `cb`.
//
// The companion gate [WIT-SCHERM] in lifecycle-gates.test.ts holds the list closed: a new client
// screen with no render here turns it red.

import test from "node:test";
import { mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ProfileRow } from "../../src/types/rows";

// DELIBERATELY FAKE — the same reasoning as money-screens.test.tsx: the Supabase client refuses to
// be CONSTRUCTED without a URL and a key, and these screens construct one while rendering. The host
// does not exist, which is exactly right; if a render ever needs real keys it has stopped being a
// render gate.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The App Router hooks throw outside a router. Stubbed rather than provided: this gate is about the
// component body, and a real router would only add a way to fail for a reason that is not the
// screen's fault. notFound/redirect throw loudly — a screen that reaches them is redirecting, and a
// test asserting "it renders" must say so rather than pass on a silent no-op.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({ id: "x-1" }),
    notFound: () => { throw new Error("[WIT-SCHERM] the screen called notFound()"); },
    redirect: (to: string) => { throw new Error(`[WIT-SCHERM] the screen redirected to ${to}`); },
  },
});

/** The providers src/app/layout.tsx mounts above every screen. Five of these screens need them. */
async function inApp(node: React.ReactElement) {
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return React.createElement(ToastProvider, null, React.createElement(DialogProvider, null, node));
}

/**
 * Every screen this file actually rendered, as a repo-relative path.
 *
 * Filled by renderScreen itself and checked by the last test in this file against what is on disk.
 * A list written by hand would go stale the day a screen is added — and worse, a hand-written list
 * can name a screen nobody renders, which is a gate that passes for the wrong reason. Nothing gets
 * into this set except by surviving a render.
 */
const rendered = new Set<string>();

/** Renders a screen the way the app mounts it, and fails with the screen's own error if it throws. */
async function renderScreen(spec: string, props: Record<string, unknown> = {}, named?: string): Promise<string> {
  const mod = await import(spec);
  // A screen is not always a default export: the files screen and the dashboard body are named
  // ones that a server page.tsx mounts, which is how they stayed unwalked through two passes.
  const Screen = (named ? mod[named] : mod.default) as React.ComponentType<Record<string, unknown>>;
  assert.ok(typeof Screen === "function", `${spec} has no component ${named ?? "as default export"}`);
  const html = renderToStaticMarkup(await inApp(React.createElement(Screen, props)));
  rendered.add(spec.replace(/^(\.\.\/)+/, "") + ".tsx");
  return html;
}

/** A complete owner profile. Cast because the row has thirty columns and none of them is the point. */
const profile = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl",
  role: "zzper", account_purpose: "boekhouden", kvk_number: "87654321", btw_number: "NL003456789B01",
  iban: "NL91ABNA0417164300", address: "Kerkstraat 1", postal_code: "1012 AB", city: "Amsterdam",
  phone: "0612345678", preferred_language: "nl", onboarding_done: true, onboarding_step: 9,
  kor_active: false, vat_exempt_activity: false, vat_scheme: "kwartaal", invoice_number_padding: 4,
  kas_opening_balance: 0, reminders_enabled: true, reminder_offsets: [3, 14, 30], vak: "bouw-klus",
  created_at: "2026-01-04T09:00:00Z", ...over,
} as unknown as ProfileRow);

// ─────────────────────────────────────────────────────────────────────────────
// The screens that take their rows as props — handed rows that exercise branches
// ─────────────────────────────────────────────────────────────────────────────

test("[WIT-SCHERM] the customer list renders with balances, a customer at zero and one unread", async () => {
  // The three states must all be walked: a customer who owes, one who owes nothing (0 is a real
  // answer and must not read as "unknown"), and one absent from the map entirely.
  const html = await renderScreen("../../src/app/dashboard/klanten/KlantenClient", {
    profile: profile(),
    openByClient: { "c-1": 1210.5, "c-2": 0 },
  });
  assert.ok(html.length > 400, "the customer screen renders");
});

test("[WIT-SCHERM] the customer list also renders when the balances could not be read", async () => {
  // [NO-SILENT-EMPTY] null is "we could not look", which is a different screen from "nobody owes".
  const html = await renderScreen("../../src/app/dashboard/klanten/KlantenClient", {
    profile: profile(), openByClient: null,
  });
  assert.ok(html.length > 400, "the customer screen renders with no balance map");
});

test("[WIT-SCHERM] the retention vault renders a year inside and a year outside the keep period", async () => {
  const jaar = (year: number, within: boolean) => ({
    year, keepThroughYear: year + 7, withinRetention: within,
    outgoingCount: within ? 24 : 0, incomingCount: within ? 61 : 0, documentCount: within ? 58 : 0,
    bankStatements: within ? 4 : 0, outgoingTotal: within ? 48210.75 : 0,
    quarters: [1, 2, 3, 4].map((q) => ({
      quarter: q, outgoingCount: 6, incomingCount: 15, documentCount: 14, filed: q < 4,
    })),
    // A year with a gap and a year without: the gap list is where the honest sentence lives, and an
    // empty list must not render the same as a year nobody checked.
    gaps: within ? ["Over Q4 ontbreekt een bankafschrift"] : [],
  });
  const html = await renderScreen("../../src/app/dashboard/kluis/KluisClient", {
    summaries: [jaar(2026, true), jaar(2017, false)],
    currentYear: 2026, purpose: "boekhouden", justPaid: false,
  });
  assert.ok(html.length > 400, "the vault renders");
  assert.ok(html.includes("2026"), "the current year is on screen");
});

test("[WIT-SCHERM] the daily-takings import renders with card payouts and under the KOR", async () => {
  const html = await renderScreen("../../src/app/dashboard/dagomzet/DagomzetImportClient", {
    korActive: true,
    cardPayouts: [
      { date: "2026-09-08", gross: 412.55, fee: 4.12, net: 408.43, provider: "SumUp" },
      // A payout with no date: the row must survive a field the reader could not fill.
      { date: null, gross: 88.2, fee: 0.9, net: 87.3, provider: null },
    ],
  });
  assert.ok(html.length > 400, "the takings import renders");
});

test("[WIT-SCHERM] the search screen renders for each role, with a query already typed", async () => {
  for (const role of ["zzper", "accountant", "medewerker"] as const) {
    const html = await renderScreen("../../src/app/dashboard/zoeken/ZoekenClient", {
      initialQuery: "20260005", role,
    });
    assert.ok(html.length > 200, `the search screen renders for ${role}`);
  }
});

test("[WIT-SCHERM] the work screen renders for every trade that has a skin", async () => {
  // The trade decides the nouns, the statuses and which fields exist. A skin that throws on one
  // trade is invisible from any other, so every trade that HAS a work layer is walked.
  //
  // A trade WITHOUT one is deliberately not walked here, and that is a finding rather than a gap:
  // this screen does `workSkin(vak)!` and would throw on an unknown trade — but it cannot be
  // reached with one, because werk/page.tsx redirects to /dashboard before mounting it. Checked
  // rather than assumed; the gate [WIT-SCHERM] in lifecycle-gates.test.ts holds that redirect in
  // place, since without it this line becomes a white screen.
  for (const vak of ["automonteur", "transport", "bouw-klus", "schoonmaak", "fietsenmaker", "dienstverlening"]) {
    const html = await renderScreen("../../src/app/dashboard/werk/WerkClient", { vak });
    assert.ok(html.length > 100, `the work screen renders for ${vak}`);
  }
});

test("[WIT-SCHERM] the home screen renders every list it can show, and its four silences", async () => {
  // This is the screen the owner opens on, and the first thing an accountant is shown. Every list
  // on it is walked with a row that reaches the branch behind it — an empty list would render a
  // page whose entire body never ran.
  const inv = (over: Record<string, unknown> = {}) => ({
    id: "i-1", client_name: "Bouwmarkt Zuid", invoice_number: "2026-0041",
    invoice_date: "2026-08-20", due_date: "2026-09-19", total_inc_btw: 1210.55,
    amount_paid: 0, status: "received", direction: "incoming", ...over,
  });
  const html = await renderScreen("../../src/app/dashboard/vandaag/VandaagClient", {
    payable: [
      inv(),
      // Part-paid: the remaining amount is |total| − amount_paid, not the total.
      inv({ id: "i-2", client_name: "Energie Direct", total_inc_btw: 402.6, amount_paid: 200 }),
      // Long overdue, and a total the reader never got — the row must survive a null amount.
      inv({ id: "i-3", client_name: "Onbekend", due_date: "2026-06-01", total_inc_btw: null }),
    ],
    remind: [
      inv({ id: "o-1", direction: "outgoing", status: "sent", client_name: "Jansen BV", total_inc_btw: 2662 }),
      inv({ id: "o-2", direction: "outgoing", status: "overdue", client_name: "De Vries", due_date: "2026-07-02", total_inc_btw: 484 }),
    ],
    offertes: [
      { ...inv({ id: "q-1", direction: "outgoing", status: "sent" }), followupState: "verloopt-binnenkort", followupDays: 3 },
      { ...inv({ id: "q-2", direction: "outgoing", status: "sent" }), followupState: "verlopen", followupDays: -11 },
      { ...inv({ id: "q-3", direction: "outgoing", status: "sent" }), followupState: "geaccepteerd", followupDays: 5 },
    ],
    refunds: [
      { id: "cr-1", invoiceNumber: "CR-2026-3", invoiceDate: "2026-08-30", clientName: "Jansen BV", amount: 121, standalone: false },
      // A credit with no invoice to compare against: the whole amount is listed, and the row says so.
      { id: "cr-2", invoiceNumber: null, invoiceDate: null, clientName: null, amount: 60.5, standalone: true },
    ],
    toVerifyCount: 4,
    datelessPayableCount: 2,
    zelf: { self: 17, hand: 3, waiting: 4 },
    werk: {
      pluralKey: "werk.meervoud.werkorders",
      counts: { open: 3, bezig: 1, wacht: 2, klaar: 4, klaarExBtw: 2840 },
      signals: [
        { kind: "meerwerk_open", n: 2, amount: 380 },
        { kind: "hours_without_rate", n: 1 },
        { kind: "costs_unlinked", n: 3, amount: 96.4 },
        { kind: "over_budget", n: 1 },
        { kind: "contract_ending", n: 1 },
        { kind: "bundle_over", n: 1, hours: 6.5 },
        { kind: "hours_unbilled_old", n: 5, amount: 610, days: 44 },
      ],
    },
  });
  assert.ok(html.length > 1500, "the home screen renders its lists");
});

test("[WIT-SCHERM] the home screen renders when every read failed, and says nothing it cannot know", async () => {
  // [NO-SILENT-EMPTY] The dangerous half: a screen whose reads all failed must still open, and
  // must not draw the same page as one where there is genuinely nothing to do.
  const html = await renderScreen("../../src/app/dashboard/vandaag/VandaagClient", {
    payable: [], remind: [], offertes: [], refunds: null, loadFailed: true,
    toVerifyCount: 0, datelessPayableCount: 0, zelf: null, werk: null,
  });
  assert.ok(html.length > 200, "the home screen renders after a failed load");
});

test("[WIT-SCHERM] the dashboard shell renders for a trade with vehicles and one without", async () => {
  for (const [vehicleTrade, workPluralKey] of [[true, "werk.meervoud.werkorders"], [false, null]] as const) {
    const html = await renderScreen("../../src/app/dashboard/DashboardClient", {
      profile: { id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl", role: "zzper" },
      vehicleTrade, workPluralKey,
    });
    assert.ok(html.length > 50, "the dashboard shell renders");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The screens that fetch their own rows — seen here in the state the owner meets first
// ─────────────────────────────────────────────────────────────────────────────
//
// An empty render is a weaker assertion than a populated one and is written down as such. It still
// catches the whole import-time and body-level class: a bad import, a hook called conditionally, a
// const read before it is declared at the top level of the component. And it covers the first
// second of every one of these screens, which is the second an accountant is looking at.

const SELF_FETCHING: readonly [string, string][] = [
  ["the upload door", "../../src/app/dashboard/upload/UploadClient"],
  ["the logbook", "../../src/app/dashboard/logboek/LogboekClient"],
  ["the bank categorisation screen", "../../src/app/dashboard/bank/categoriseren/CategoriseClient"],
  ["the till", "../../src/app/dashboard/kassa/KassaClient"],
  ["the team screen", "../../src/app/dashboard/settings/team/TeamClient"],
  ["the vehicle register", "../../src/app/dashboard/voertuigen/VoertuigenClient"],
  ["the asset register", "../../src/app/dashboard/bedrijfsmiddelen/BedrijfsmiddelenClient"],
  ["the workplace screen", "../../src/app/dashboard/werkplek/WerkplekClient"],
  ["the ledger year screen", "../../src/app/dashboard/grootboek/GrootboekJaarClient"],
];

for (const [naam, spec] of SELF_FETCHING) {
  test(`[WIT-SCHERM] ${naam} renders`, async () => {
    const html = await renderScreen(spec);
    assert.ok(html.length > 20, `${naam} produced no markup at all`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The rest of the walk: every other screen a person can land on
// ─────────────────────────────────────────────────────────────────────────────
//
// The first pass of this file only looked for `*Client.tsx`, and that definition was too narrow by
// almost twenty thousand lines: the invoice screen, the invoice detail, its editor, settings, the
// quarter package an accountant opens, signup and login are all `page.tsx` files that are
// themselves client components. None of them was ever called by a test.

const REST: readonly [string, string][] = [
  ["making an invoice", "../../src/app/dashboard/invoice/new/page"],
  ["the invoice detail", "../../src/app/dashboard/invoice/[id]/page"],
  ["editing an invoice", "../../src/app/dashboard/invoice/[id]/edit/page"],
  ["settings", "../../src/app/dashboard/settings/page"],
  ["the quarter package an accountant opens", "../../src/app/dashboard/clients/[id]/kwartaal/page"],
  ["a client's dossier", "../../src/app/dashboard/clients/[id]/page"],
  ["signing up", "../../src/app/register/page"],
  ["logging in", "../../src/app/login/page"],
  ["forgot password", "../../src/app/wachtwoord-vergeten/page"],
  ["resetting a password", "../../src/app/wachtwoord-herstellen/page"],
  ["accepting an invitation", "../../src/app/invite/accept/page"],
  ["a team invitation", "../../src/app/team/accepteren/AccepterenClient"],
  ["e-mail verification", "../../src/app/verificatie/VerificatieClient"],
  ["the message list", "../../src/app/dashboard/messages/page"],
  ["one message", "../../src/app/dashboard/messages/[id]/page"],
  ["the day's truth panel", "../../src/app/dashboard/zzp/DailyTruth"],
  ["the turnover insights panel", "../../src/app/dashboard/dagomzet/TurnoverInsights"],
  // [AFREKENING-DEUR] Corner 2 of the reconciliation triangle. It renders with no data at all,
  // which is the state every owner meets first: the upload choice and the way to type it instead.
  ["the card-terminal settlement panel", "../../src/app/dashboard/dagomzet/AfrekeningImport"],
  ["the retention card", "../../src/app/dashboard/kluis/BewaarkluisCard"],
  ["the subscribe button", "../../src/app/prijzen/SubscribeButton"],
  ["the manage-subscription button", "../../src/app/dashboard/settings/facturering/ManageSubscriptionButton"],
  // The public doors. These are what a stranger meets first, and several of them are the reason
  // anyone arrives at all.
  ["the free invoice maker", "../../src/app/factuur-maken/GratisFactuur"],
  ["the invoice scanner", "../../src/app/factuur-scannen/FactuurScanner"],
  ["the quote a customer opens", "../../src/app/offerte/[token]/OfferteClient"],
  ["the BTW calculator", "../../src/app/btw-berekenen/BtwCalculator"],
  ["the BTW-return calculator", "../../src/app/btw-aangifte-berekenen/BtwAangifteCalculator"],
  ["the statement converter", "../../src/app/bankafschrift-naar-excel/BankConverter"],
  ["the mileage calculator", "../../src/app/kilometervergoeding/KmCalculator"],
  ["the net-income calculator", "../../src/app/netto-inkomen-zzp/NettoCalculator"],
  ["the hourly-rate calculator", "../../src/app/uurtarief-berekenen/UurtariefCalculator"],
];

for (const [naam, spec] of REST) {
  test(`[WIT-SCHERM] ${naam} renders`, async () => {
    const html = await renderScreen(spec);
    // Two of these are panels that deliberately render nothing until they have something to say,
    // so the assertion is that the component RAN, not that it drew. A throw is what this catches.
    assert.ok(typeof html === "string", `${naam} produced no markup at all`);
  });
}

// The error boundaries, which are the screens shown when something else has already gone wrong —
// and were themselves never called. A boundary that throws turns a handled error into a blank tab.
const BOUNDARIES: readonly [string, string][] = [
  ["the app-wide error boundary", "../../src/app/global-error"],
  ["the error boundary", "../../src/app/error"],
  ["the dashboard error boundary", "../../src/app/dashboard/error"],
  ["the dashboard not-found page", "../../src/app/dashboard/not-found"],
];

for (const [naam, spec] of BOUNDARIES) {
  test(`[WIT-SCHERM] ${naam} renders`, async () => {
    const html = await renderScreen(spec, { error: new Error("boom"), reset: () => {} });
    assert.ok(html.length > 20, `${naam} produced no markup at all`);
  });
}

// [PDF-LAZY] factuur-maken/PdfDownloadButton is deliberately NOT in the lists above. It imports
// @react-pdf/renderer, whose PDFDownloadLink is browser-only and throws under react-dom/server —
// which is exactly why GratisFactuur loads it with dynamic(…, { ssr: false }). Its absence here is
// the proof that boundary is real; a day it starts rendering on the server is a day it was pulled
// back into the first download of twelve public pages.

// ─────────────────────────────────────────────────────────────────────────────
// The screens that are NAMED exports, mounted by a server page.tsx
// ─────────────────────────────────────────────────────────────────────────────
//
// The third time the definition of "screen" turned out to be too narrow. `export default function`
// missed these: a client screen can be a named export that a server `page.tsx` mounts, and the
// largest of them is the whole files feature — 1.957 lines plus ten panels around it, which is the
// screen behind "Mijn bestanden" on the werkplek menu and was never called by anything.

test("[WIT-SCHERM] the files screen renders", async () => {
  const html = await renderScreen("../../src/app/dashboard/bestanden/BestandenPage", { role: "zzper" }, "BestandenPage");
  assert.ok(html.length > 1000, "the files screen renders");
});

test("[WIT-SCHERM] the files screen renders for an accountant and for a client too", async () => {
  // The role decides what may be moved, renamed and thrown away. A role whose branch throws is
  // invisible from any other, and the accountant is the role being demonstrated to.
  for (const role of ["accountant", "client", null]) {
    const html = await renderScreen("../../src/app/dashboard/bestanden/BestandenPage", { role }, "BestandenPage");
    assert.ok(html.length > 500, `the files screen renders for ${role ?? "no role"}`);
  }
});

test("[WIT-SCHERM] the dashboard body renders, for a trade with vehicles and without", async () => {
  for (const [vehicleTrade, workPluralKey] of [[true, "werk.meervoud.werkorders"], [false, null]] as const) {
    const html = await renderScreen("../../src/app/dashboard/zzp/ZzpDashboard", {
      profile: { id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl", role: "zzper" },
      vehicleTrade, workPluralKey,
    }, "ZzpDashboard");
    assert.ok(html.length > 2000, "the dashboard body renders");
  }
});

test("[WIT-SCHERM] the service-worker registrar renders — it sits in the root layout", async () => {
  // Renders nothing, and that is the point: it is mounted above every single screen in the app, so
  // a throw here is not one white screen but all of them.
  const html = await renderScreen("../../src/app/ServiceWorkerRegister", {}, "ServiceWorkerRegister");
  assert.equal(html, "", "the registrar must draw nothing at all");
});

test("[WIT-SCHERM] the accountant's correction proposal form renders, including on unreadable amounts", async () => {
  const { translator } = await import("../../src/lib/i18n/t");
  const DateField = ({ value }: { value: string }) => React.createElement("input", { defaultValue: value });
  const draai = async (invoice: Record<string, unknown>) => renderScreen(
    "../../src/app/dashboard/clients/[id]/VoorstelFormulier",
    {
      clientId: "c-1", invoice, t: translator("nl"), DateField,
      onClose: () => {}, onSent: () => {}, onError: () => {},
    },
    "VoorstelFormulier",
  );
  const vol = await draai({
    id: "i-1", total_ex_btw: 799.45, btw_amount: 71.95, total_inc_btw: 871.4,
    invoice_date: "2026-03-12", due_date: "2026-04-11",
  });
  assert.ok(vol.length > 400, "the proposal form renders");
  // Every amount null: the form the accountant opens on an invoice the reader could not read at
  // all. A zero here would be a proposal to change the figures to zero.
  const leeg = await draai({
    id: "i-2", total_ex_btw: null, btw_amount: null, total_inc_btw: null,
    invoice_date: null, due_date: null,
  });
  assert.ok(leeg.length > 400, "the proposal form renders on an invoice with no readable amounts");
});

// ─────────────────────────────────────────────────────────────────────────────
// The list closes itself
// ─────────────────────────────────────────────────────────────────────────────

test("[WIT-SCHERM] no dashboard screen exists that this file never rendered", () => {
  // Runs last, so `rendered` holds every screen the tests above actually got through. Comparing it
  // against what is on disk is what keeps this file honest as the app grows: a new screen is a red
  // gate on the day it is written, not a white page discovered in front of an accountant.
  // A SCREEN is any client component a person can land on: not just `*Client.tsx`, which was the
  // first and far too narrow definition — it missed the invoice screen, login and signup, twenty
  // thousand lines of them, because those are `page.tsx` files that carry 'use client' themselves.
  // Everything a server page.tsx or layout.tsx mounts. A screen is not always a DEFAULT export —
  // the files screen (1.957 lines) and the dashboard body are named ones behind a thin server
  // wrapper, and that is how they survived two passes of this check unwalked.
  const mountedByAPage = new Set<string>();
  const resolveFrom = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join("src", spec.slice(2))
      : spec.startsWith(".") ? join(dirname(from), spec)
        : null;
    if (!base) return null;
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
    }
    return null;
  };
  const readPages = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) readPages(p);
      else if (e.name === "page.tsx" || e.name === "layout.tsx") {
        for (const m of readFileSync(p, "utf8").matchAll(/from\s*["'`]([^"'`]+)["'`]/g)) {
          const target = resolveFrom(p, m[1]);
          if (target) mountedByAPage.add(target);
        }
      }
    }
  };
  readPages("src/app");

  const screens: string[] = [];
  const collect = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) {
        const src = readFileSync(p, "utf8");
        if (!/^\s*['"]use client['"]/m.test(src)) continue;
        if (/export default function/.test(src) || mountedByAPage.has(p)) screens.push(p);
      }
    }
  };
  collect("src/app");
  // The accountant's own screens count too, and for the sharpest reason: that module is the surface
  // shown to the accountants this product is sold through. They are all covered today by other
  // render tests — measured — and without them in this scan a NEW one could be added with none.
  for (const f of readdirSync("src/modules/accountant/pages")) {
    if (f.endsWith(".tsx")) screens.push(join("src/modules/accountant/pages", f));
  }
  assert.ok(screens.length >= 40, `only ${screens.length} screens found — the scan is broken, not the app`);

  // Screens covered by a render test OTHER than this one, found by reading their imports. Only
  // import POSITIONS count — `from "…"` and `import("…")` with a literal — never any path-shaped
  // string, because a path in a comment would make this pass for the wrong reason. The one place
  // that is not enough is this file, which imports through a variable; the `rendered` set above
  // covers exactly that, and nothing enters it without surviving a render.
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join("src", spec.slice(2))
      : spec.startsWith(".") ? join(dirname(from), spec)
        : null;
    if (!base) return null;
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
    }
    return null;
  };
  const elders = new Set<string>();
  const walk = (file: string) => {
    if (elders.has(file)) return;
    elders.add(file);
    let src: string;
    try { src = readFileSync(file, "utf8"); } catch { return; }
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)["'`]([^"'`]+)["'`]/g)) {
      const target = resolveImport(file, m[1]);
      if (target) walk(target);
    }
  };
  for (const f of readdirSync("tests/render")) {
    if (/\.tsx?$/.test(f) && f !== "screens-render.test.tsx") walk(join("tests/render", f));
  }

  // [PDF-LAZY] The one screen that CANNOT be server-rendered, exempted by name with its reason —
  // never by quietly dropping it from the scan. @react-pdf's PDFDownloadLink is browser-only and
  // throws under react-dom/server, which is precisely why GratisFactuur loads this file with
  // dynamic(…, { ssr: false }). The exemption is only valid while that is still true, so it is
  // checked here: the day someone imports it statically, the bundle grows by 1,4 MB on twelve
  // public pages AND the page starts throwing on the server, and this line goes red first.
  const PDF_KNOP = "src/app/factuur-maken/PdfDownloadButton.tsx";
  const gratis = readFileSync("src/app/factuur-maken/GratisFactuur.tsx", "utf8");
  assert.match(gratis, /dynamic\(\(\) => import\('\.\/PdfDownloadButton'\), \{ ssr: false \}\)/,
    "PdfDownloadButton is exempt from the render walk only because it is loaded with ssr:false");

  const missing = screens.filter((s) => !rendered.has(s) && !elders.has(s) && s !== PDF_KNOP);
  assert.deepEqual(missing, [],
    "these screens are never CALLED by any test, so they could be white pages with every gate " +
    "green:\n  \u00b7 " + missing.join("\n  \u00b7 "));

});
