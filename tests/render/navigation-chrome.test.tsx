// tests/render/navigation-chrome.test.tsx
// [ZIJBALK] Does the navigation survive one render — on every role, at both ends of the width?
//
// Run: npm run test:render
//
// The rail and the phone bar are mounted in src/app/dashboard/layout.tsx, ABOVE all 56 dashboard
// screens. That makes them the only two components in this app whose crash is not one white
// screen but every one of them, and the gate set is blind to exactly that: tsc type-checks a
// component it never calls, next build compiles it, and the Playwright sweep never logs in.
//
// So they are rendered here for the same reason the money screens are — and with rows that
// exercise the branches, because an empty list renders fine and proves nothing.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The App Router hooks throw outside a router. Mutable so one file can render the same bar
// standing on different screens — which is the whole of what activeHref decides.
let pathname = "/dashboard";
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => pathname,
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

// Imported inside the tests, not at the top: the loader compiles this file to CJS, where a
// top-level await is a syntax error — the same shape money-screens.test.tsx uses.
// [MELDING-WAARHEID] The rail's bell and its way out speak through the app's toast when a store
// refuses, so the rail renders under the provider the root layout mounts — loaded here, with the
// components, for the same CJS reason as the imports above.
let ToastProvider: React.ComponentType<{ children: React.ReactNode }> | null = null;

const load = async () => {
  ToastProvider = (await import("../../src/components/ui/Toast")).ToastProvider;
  return {
    DashboardRail: (await import("../../src/components/nav/DashboardRail")).DashboardRail,
    BottomNav: (await import("../../src/components/nav/BottomNav")).BottomNav,
  };
};

const draw = (el: React.ReactElement): string =>
  renderToStaticMarkup(ToastProvider ? React.createElement(ToastProvider, null, el) : el);

/** The opening tag of each <a> in the markup — React does not emit attributes in source order. */
const links = (html: string): string[] => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
/** The opening tag of the <nav> itself, as distinct from the items inside it. */
const navTag = (html: string): string => /<nav\b[^>]*>/.exec(html)?.[0] ?? "";

test("[ZIJBALK] the rail renders every destination, for every role", async () => {
  const { DashboardRail } = await load();
  pathname = "/dashboard";
  const owner = draw(<DashboardRail role="zzper" />);
  assert.ok(owner.length > 0, "an empty rail is a dashboard with no navigation on it");
  // The whole home screen, not the phone bar's four.
  for (const href of [
    "/dashboard", "/dashboard/facturen", "/dashboard/incoming", "/dashboard/incoming/manage",
    "/dashboard/leveranciers", "/dashboard/bank", "/dashboard/kas", "/dashboard/dagomzet",
    "/dashboard/artikelen", "/dashboard/uren", "/dashboard/waarheid", "/dashboard/aangifte",
    "/dashboard/jaar", "/dashboard/werkplek", "/dashboard/bestanden", "/dashboard/settings/team",
  ]) {
    assert.ok(owner.includes(`href="${href}"`), `the owner's rail is missing ${href}`);
  }
  // The home screen's own group headings, in the home screen's own words.
  for (const kop of ["MIJN ADMINISTRATIE", "CIJFERS", "MEER"]) {
    assert.ok(owner.toUpperCase().includes(kop), `the rail lost the "${kop}" grouping`);
  }

  // [VAK-BRUG] The counter trade leads with the Kassa — and unlike the phone bar it does not have
  // to give anything up for it: a rail has room, and that owner still bills a fleet customer.
  const counter = draw(<DashboardRail role="zzper" counter />);
  assert.ok(counter.includes('href="/dashboard/kassa"'), "a counter trade leads with the Kassa");
  assert.ok(counter.includes('href="/dashboard/facturen"'), "…without losing Facturen, which the phone bar had to drop");
  assert.ok(counter.indexOf('href="/dashboard/kassa"') < counter.indexOf('href="/dashboard/facturen"'),
    "…and the Kassa comes first, which is the whole point for this owner");

  pathname = "/dashboard/accountant";
  const accountant = draw(<DashboardRail role="accountant" />);
  assert.ok(accountant.includes('href="/dashboard/clients/beheer"'), "the accountant's rail carries Klanten");
  assert.ok(!accountant.includes('href="/dashboard/facturen"'), "…and not the owner's invoice list");
});

test("[ZIJBALK] the rail says where you are, and admits when it does not know", async () => {
  const { DashboardRail } = await load();
  pathname = "/dashboard/facturen";
  const marked = links(draw(<DashboardRail role="zzper" />)).filter((a) => a.includes('aria-current="page"'));
  assert.equal(marked.length, 1, "exactly one destination is the current one");
  assert.ok(marked[0].includes('href="/dashboard/facturen"'),
    "the current destination is marked for a screen reader, not by colour alone");

  // The rail reaches Kas now, so it says so — this is what widening it bought.
  pathname = "/dashboard/kas";
  const onKas = links(draw(<DashboardRail role="zzper" />)).filter((a) => a.includes('aria-current="page"'));
  assert.equal(onKas.length, 1);
  assert.ok(onKas[0].includes('href="/dashboard/kas"'));

  // Longest match, ACROSS groups: /dashboard/incoming/manage is Inkoopfacturen in one group and a
  // child of Inkomend in another. Scoring per group would light both at once.
  pathname = "/dashboard/incoming/manage";
  const onManage = links(draw(<DashboardRail role="zzper" />)).filter((a) => a.includes('aria-current="page"'));
  assert.equal(onManage.length, 1, "two groups both claimed the screen");
  assert.ok(onManage[0].includes('href="/dashboard/incoming/manage"'), "the deeper destination wins");

  // A screen in no group at all still marks nothing — a bar that misreports your position is worse
  // than one that admits it does not cover this screen.
  pathname = "/dashboard/beveiliging";
  assert.ok(!draw(<DashboardRail role="zzper" />).includes('aria-current="page"'),
    "no destination may claim a screen it does not own");
});

test("[ZIJBALK] the rail holds no language and no physical side of its own", async () => {
  const { DashboardRail } = await load();
  pathname = "/dashboard";
  const html = draw(<DashboardRail role="zzper" />);
  // [TAAL] The words come from the catalogue. The default locale is Dutch, so these ARE the Dutch
  // labels — the point is that they arrived through t(), which is what makes another language
  // possible at all.
  assert.ok(html.includes("Start"), "the labels resolve to words, never to keys");
  // [RTL] Logical sides only. A physical `left` is wrong in exactly one language, which is the one
  // nobody checks — and this bar is on every screen.
  const tag = navTag(html);
  assert.match(tag, /inset-inline-start:/, "the rail is pinned to the start of the writing direction");
  assert.doesNotMatch(tag, /(^|[^-])left:/, "no physical left on the rail");
  assert.match(tag, /border-inline-end:/, "…and its edge is a logical side too");
});

test("[ZIJBALK] neither bar sets its own display, which is what once showed the phone bar at 1280px", async () => {
  const { DashboardRail, BottomNav } = await load();
  pathname = "/dashboard";
  // The media query in globals.css is what hides each bar outside its range. An inline `display`
  // outranks a class rule, so a bar that sets one is visible at every width no matter what the
  // stylesheet says. This happened, and was verified at 1280px.
  // The BAR's own tag, not the items inside it — those legitimately set display:flex on themselves,
  // and no media query hides them. (My first version of this check read the whole markup and
  // failed on exactly that; a gate that cannot tell the container from its contents is not a gate.)
  for (const [name, html] of [
    ["rail", draw(<DashboardRail role="zzper" />)],
    ["bottom bar", draw(<BottomNav role="zzper" />)],
  ] as const) {
    const tag = navTag(html);
    assert.ok(tag.length > 0, `the ${name} did not render a <nav> at all`);
    assert.doesNotMatch(tag, /display:/, `the ${name} sets display inline and escapes its breakpoint`);
  }
});

test("[ZIJBALK] the phone bar still renders too — the same destinations, the other end", async () => {
  const { DashboardRail, BottomNav } = await load();
  pathname = "/dashboard/incoming";
  const bar = draw(<BottomNav role="zzper" />);
  assert.ok(bar.length > 0);
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  // The rail is a SUPERSET, not a copy: the phone shows four because 320px allows four, and those
  // four must be part of the whole. A primary destination missing from the rail is the app meaning
  // different things at different widths, which is the drift this whole arrangement exists to stop.
  for (const [role, counter] of [["zzper", false], ["zzper", true], ["accountant", false]] as const) {
    const inBar = hrefs(draw(<BottomNav role={role} counter={counter} />));
    const inRail = new Set(hrefs(draw(<DashboardRail role={role} counter={counter} />)));
    for (const href of inBar) {
      assert.ok(inRail.has(href), `${role}${counter ? " (counter)" : ""}: ${href} is on the phone bar and not on the rail`);
    }
  }
});

// [KORTE-WEG] The bar is five wide for an owner now, and the fifth one is a screen that could not
// be opened on a phone at all until it was added. Two things can go wrong in the render and only
// here: the link is absent (a list edited on one branch of the trade and not the other), or the
// label prints its own KEY — because this destination deliberately borrows the sub-page header's
// `chrome.vandaag` rather than declaring a second key with the same word in it, and a key that has
// slipped out of the catalogue renders as itself in 11px type on every screen in the app.
test("[KORTE-WEG] the phone bar carries Vandaag, and prints it as a word", async () => {
  const { BottomNav } = await load();
  pathname = "/dashboard";
  for (const counter of [false, true]) {
    const html = draw(<BottomNav role="zzper" counter={counter} />);
    assert.ok(html.includes('href="/dashboard/vandaag"'),
      `the ${counter ? "counter " : ""}owner's phone bar has no way to today's work`);
    assert.ok(html.includes(">Vandaag<"),
      `the ${counter ? "counter " : ""}owner's bar shows no word for it — a label rendering as its key`);
    assert.ok(!html.includes("chrome.vandaag"), "the catalogue key reached the screen");
  }

  // Standing on it lights it, and standing anywhere else does not: an active pill on the wrong
  // item tells the owner they are somewhere they are not.
  // Read through links(), not with one regex: React does not emit attributes in source order, so
  // "href then aria-current" is a property of this render and not of the markup.
  const huidig = (html: string) =>
    links(html).filter((a) => a.includes('aria-current="page"')).find((a) => a.includes('href="/dashboard/vandaag"'));
  pathname = "/dashboard/vandaag";
  assert.ok(huidig(draw(<BottomNav role="zzper" />)),
    "the bar does not mark today's screen as the one you are on");
  pathname = "/dashboard/facturen";
  assert.ok(!huidig(draw(<BottomNav role="zzper" />)),
    "Vandaag is marked current while standing on Facturen");

  // The accountant's bar is four and does not carry it — the owner's day is not theirs.
  const kantoor = draw(<BottomNav role="accountant" />);
  assert.ok(!kantoor.includes('href="/dashboard/vandaag"'));
});

// [ZIJBALK-ACCOUNT] The account corner, rendered where the owner asked for it. The gate reads the
// source; only the markup can say whether the name, the bell and the way out actually come out —
// and that they come out ONLY when an account is handed in, which the accountant's rail, the
// render tests above and the medewerker's absence all rely on.
test("[ZIJBALK-ACCOUNT] the rail carries the account corner when handed one, above the navigation", async () => {
  const { DashboardRail } = await load();
  pathname = "/dashboard/facturen";
  const account = { id: "u1", name: "Basil Ibrahim", email: "eigenaar@example.com" };
  const html = draw(<DashboardRail role="zzper" account={account} />);
  assert.ok(html.includes("Basil Ibrahim"), "the name is not on the rail");
  assert.ok(html.includes("eigenaar@example.com"), "the e-mail is not on the rail");
  assert.ok(html.includes(">BI<"), "the avatar initials are missing");
  assert.ok(html.includes('aria-label="Meldingen"'), "the bell did not move into the rail");
  assert.ok(html.includes('href="/dashboard/messages"'), "Berichten did not move");
  assert.ok(html.includes('href="/dashboard/settings"'), "Instellingen did not move");
  assert.ok(html.includes('aria-label="Uitloggen"'), "there is no way out on the rail");
  // Words, never keys.
  for (const key of ["kop.meldingen", "kop.berichten", "kop.instellingen", "kop.uitloggen", "kop.profielmenu"]) {
    assert.ok(!html.includes(key), `${key} reached the screen as a key`);
  }
  // Above the navigation, where the owner put it.
  assert.ok(html.indexOf("Basil Ibrahim") < html.indexOf('href="/dashboard/facturen"'), "the account block is below the navigation");
  // The navigation is still all there beside it, and still marks the current screen.
  assert.equal(links(html).filter((a) => a.includes('aria-current="page"')).length, 1);

  // Without an account, none of it — the four-row accountant rail and the tests above rely on this.
  const bare = draw(<DashboardRail role="zzper" />);
  for (const s of ['aria-label="Uitloggen"', 'href="/dashboard/settings"', 'aria-label="Meldingen"', ">BI<"]) {
    assert.ok(!bare.includes(s), `${s} renders with no account handed in`);
  }
  // The accountant gets it too — their bell and their way out were in the same corner.
  pathname = "/dashboard/accountant";
  const kantoor = draw(<DashboardRail role="accountant" account={{ id: "a1", name: "Kantoor Jansen", email: null }} />);
  assert.ok(kantoor.includes("Kantoor Jansen") && kantoor.includes('aria-label="Uitloggen"'));
});

// [ZIJBALK-DEUR] The rail row is the tile in miniature: the tile's colour, in the rendered HTML.
test("[ZIJBALK-DEUR] every rail row is painted in its tile's colour", async () => {
  const { DashboardRail } = await load();
  pathname = "/dashboard";
  const html = draw(<DashboardRail role="zzper" />);
  const rows = links(html).length;
  const squares = (html.match(/background:#[0-9A-Fa-f]{6}/g) ?? []).length;
  assert.ok(rows >= 16, `only ${rows} rows`);
  assert.ok(squares >= rows, `${squares} tinted squares on ${rows} rows — a row is grey again`);
  // The teal Facturen tile, the orange Inkoopfacturen tile, the purple Dagomzet tile: the same
  // three colours, on the rail, on the right rows.
  for (const [href, tint, glyph] of [
    ["/dashboard/facturen", "#00897B", "description"],
    ["/dashboard/incoming/manage", "#E37400", "request_quote"],
    ["/dashboard/dagomzet", "#7B1FA2", "point_of_sale"],
  ]) {
    const at = html.indexOf(`href="${href}"`);
    assert.ok(at > 0, `${href} is not on the rail`);
    const row = html.slice(html.lastIndexOf("<a", at), html.indexOf("</a>", at));
    assert.ok(row.includes(`background:${tint}`), `${href} is not painted ${tint} on the rail`);
    assert.ok(row.includes(`>${glyph}<`), `${href} does not show the tile's glyph`);
  }
});
