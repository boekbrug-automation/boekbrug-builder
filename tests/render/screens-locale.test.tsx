// tests/render/screens-locale.test.tsx
// [TAAL-SCHERM] The walk again, in a language that is not Dutch.
//
// Run: npm run test:render
//
// ── WHY THIS IS A SEPARATE FILE, AND WHY NOTHING HAS EVER DONE IT ──
// useLocale is a useSyncExternalStore over the language cookie, and its SERVER snapshot is
// hard-coded to Dutch on purpose — the HTML says Dutch, so hydration matches. Every render test in
// this repo therefore renders Dutch and only Dutch, whatever the owner has chosen. The Arabic and
// Turkish screens exist exclusively in a browser, after hydration, where no gate has ever looked.
//
// That matters more here than the sentence suggests: AGENTS.md records that the first accountants
// using this product read Arabic. A screen that throws under `ar` — a per-locale table with no `ar`
// row, a direction lookup on an undefined entry, a plural helper handed a language it has no case
// for — would be invisible to tsc, eslint, next build, the smoke sweep AND every render test.
//
// So useLocale is mocked here, which is why this cannot live in screens-render.test.tsx: a module
// mock is process-wide, and that file must keep rendering Dutch.
//
// ── WHAT IT ASSERTS ──
//   1. The screen survives being called in each language.
//   2. No raw message KEY reaches the screen. A missing translation falls back to Dutch by design
//      (messages.ts), and Dutch under an Arabic interface is a small cost; `sent.action.view` on a
//      button is a broken app. This catches the second, which is the one fallback cannot fix.

import test from "node:test";
import { mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MESSAGES } from "../../src/lib/i18n/messages";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    useParams: () => ({ id: "x-1" }),
    notFound: () => { throw new Error("[TAAL-SCHERM] the screen called notFound()"); },
    redirect: (to: string) => { throw new Error(`[TAAL-SCHERM] the screen redirected to ${to}`); },
  },
});

// The mock closes over this, so one process can walk every language instead of one per file.
let locale = "nl";
mock.module(new URL("../../src/lib/i18n/use-locale.ts", import.meta.url).href, {
  namedExports: {
    useLocale: () => locale,
    readLocaleCookie: () => locale,
    hasLocaleCookie: () => true,
    writeLocaleCookie: () => {},
    LOCALE_COOKIE: "bb_locale",
  },
});

/** Every declared key, longest first — so a key that is a prefix of another cannot mask it. */
const KEYS = Object.keys(MESSAGES).sort((a, b) => b.length - a.length);

/** The words on the screen, with markup and entities stripped. */
function screenText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderIn(taal: string, spec: string, props: Record<string, unknown> = {}, named?: string): Promise<string> {
  locale = taal;
  const mod = await import(spec);
  const Screen = (named ? mod[named] : mod.default) as React.ComponentType<Record<string, unknown>>;
  assert.ok(typeof Screen === "function", `${spec} has no component ${named ?? "as default export"}`);
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null, React.createElement(DialogProvider, null, React.createElement(Screen, props))),
  );
}

const profile = { id: "u-1", full_name: "Jamal Haddad", company_name: "Haddad Klussen", email: "jamal@example.nl", role: "zzper", account_purpose: "boekhouden" };

/** The walk: the screens an owner and an accountant actually pass through. */
const WALK: readonly [string, string, Record<string, unknown>, string?][] = [
  ["the home screen", "../../src/app/dashboard/vandaag/VandaagClient", {
    payable: [{ id: "i-1", client_name: "Bouwmarkt Zuid", invoice_number: "2026-0041", invoice_date: "2026-08-20", due_date: "2026-09-19", total_inc_btw: 1210.55, amount_paid: 0, status: "received", direction: "incoming" }],
    remind: [{ id: "o-1", client_name: "Jansen BV", invoice_number: "2026-0007", invoice_date: "2026-07-01", due_date: "2026-07-31", total_inc_btw: 2662, amount_paid: 0, status: "overdue", direction: "outgoing" }],
    offertes: [], refunds: [], loadFailed: false, toVerifyCount: 2, datelessPayableCount: 1,
    zelf: { self: 9, hand: 2, waiting: 3 }, werk: null,
  }],
  ["the dashboard body", "../../src/app/dashboard/zzp/ZzpDashboard", { profile }, "ZzpDashboard"],
  ["making an invoice", "../../src/app/dashboard/invoice/new/page", {}],
  ["the invoice detail", "../../src/app/dashboard/invoice/[id]/page", {}],
  ["settings", "../../src/app/dashboard/settings/page", {}],
  ["the upload door", "../../src/app/dashboard/upload/UploadClient", {}],
  ["the files screen", "../../src/app/dashboard/bestanden/BestandenPage", { role: "zzper" }, "BestandenPage"],
  ["the till", "../../src/app/dashboard/kassa/KassaClient", {}],
  ["the work screen", "../../src/app/dashboard/werk/WerkClient", { vak: "automonteur" }],
  ["the logbook", "../../src/app/dashboard/logboek/LogboekClient", {}],
  ["the customer list", "../../src/app/dashboard/klanten/KlantenClient", { profile, openByClient: { "c-1": 1210.5 } }],
  ["search", "../../src/app/dashboard/zoeken/ZoekenClient", { initialQuery: "20260005", role: "zzper" }],
  ["the example dossier", "../../src/modules/accountant/pages/VoorbeeldDossier", {}],
  ["logging in", "../../src/app/login/page", {}],
  ["signing up", "../../src/app/register/page", {}],
];

// Dutch is walked too, and not as a formality: it is the control. If a key leaked in every
// language the assertion below would still fire, but a leak that appears ONLY under `ar` is the
// one this file exists for, and without the Dutch run there is nothing to compare it against.
for (const taal of ["ar", "tr", "en", "nl"]) {
  for (const [naam, spec, props, named] of WALK) {
    test(`[TAAL-SCHERM] ${naam} renders in ${taal}, with no key left on screen`, async () => {
      const html = await renderIn(taal, spec, props, named);
      assert.ok(typeof html === "string", `${naam} produced nothing in ${taal}`);
      const text = screenText(html);
      // A key only counts as leaked when it stands on its own — `bank.fout.laden` printed as words.
      // Substring matching would fire on ordinary prose containing a dot between two lower-case
      // words, which is most prose.
      const leaked = KEYS.filter((k) => new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(text));
      assert.deepEqual(leaked, [],
        `${naam} shows a message key instead of a sentence in ${taal}: ${leaked.join(", ")}`);
    });
  }
}
