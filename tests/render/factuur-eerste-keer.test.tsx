// tests/render/factuur-eerste-keer.test.tsx
// [VERKOPER-COMPLEET] A brand-new account opens the invoice form and gets AN INVOICE FORM.
//
// Run: npm run test:render
//
// ── WHY THIS IS A RENDER TEST AND NOT A SOURCE GATE ──
// The rule this batch is built on is a rule about a SCREEN: "enter and work; setup is asked for
// only when it is needed to finish the work". A source gate can prove the completion panel exists
// and that the send path passes through it — surface-audit-gates.test.ts does both. It cannot
// prove the negative that matters most: that on the way IN, with nothing filled in anywhere, the
// owner is not met by a company form instead of the thing they came for.
//
// That negative is one `useEffect` away from being false. An effect that ran the seller gate on
// mount, a `profile === null` branch that decided to show the panel, a redirect to Instellingen —
// each of those compiles, type-checks, lints and builds, and each turns the first-run flow back
// into the wizard this batch removed. renderToStaticMarkup runs no effects and fetches nothing,
// which is exactly the state of an account that has just been created: no profile loaded, no
// clients, no lines. What comes out is what such an owner sees first.
//
// It also holds the other half honestly: nothing here claims the completion panel WORKS. The panel
// only opens on an answer from the server, and this harness has no server. Every branch of that
// decision is executed for real in src/lib/seller-completeness.test.ts.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MESSAGES } from "../../src/lib/i18n/messages";

// DELIBERATELY FAKE — same reasoning as screens-render.test.tsx: the Supabase client refuses to be
// CONSTRUCTED without a URL and a key, and this screen constructs one while rendering.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

let search = new URLSearchParams();
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => search,
    usePathname: () => "/dashboard/invoice/new",
    useParams: () => ({}),
    notFound: () => { throw new Error("[VERKOPER-COMPLEET] the invoice form called notFound()"); },
    redirect: (to: string) => { throw new Error(`[VERKOPER-COMPLEET] the invoice form redirected to ${to}`); },
  },
});

async function formulier(query = ""): Promise<string> {
  search = new URLSearchParams(query);
  const { default: Page } = await import("../../src/app/dashboard/invoice/new/page");
  return renderToStaticMarkup(React.createElement(Page));
}

/** The Dutch a message key renders as — read from the catalogue, never retyped. */
const nl = (key: string): string => {
  const entry = (MESSAGES as unknown as Record<string, { nl?: string }>)[key];
  assert.ok(entry?.nl, `[VERKOPER-COMPLEET] '${key}' is not in the catalogue — the panel's copy moved`);
  return entry.nl as string;
};

test("[VERKOPER-COMPLEET] the invoice form opens as an invoice form, with no company setup in front of it", async () => {
  const html = await formulier();

  // It rendered at all. Without this the two negatives below would pass on an empty string, which
  // is the exact way a "nothing is shown" assertion lies.
  assert.ok(html.length > 500, "the invoice form produced almost nothing — it did not really render");

  // The thing the owner came for is there: a customer to bill and a line to bill them for.
  assert.match(html, /<input/, "the form has no fields at all");

  // And the thing that must NOT be there. No profile has been loaded (no effects run), so this is
  // precisely the state of an account created one minute ago — the state in which the old product
  // showed a wizard.
  assert.ok(
    !html.includes(nl("nieuw.verkoper.titel")),
    "the completion panel is open before the owner has pressed anything — setup moved back in front of the work",
  );
  assert.ok(
    !html.includes(nl("nieuw.verkoper.uitleg")),
    "the completion panel's explanation is on screen at entry",
  );

  // Not by a detour either: being sent to the 1238-line settings screen mid-invoice is the same
  // failure wearing a different shape, and it is what this batch replaced.
  assert.doesNotMatch(
    html, /href="\/dashboard\/settings"/,
    "the invoice form sends the owner to Instellingen to finish an invoice",
  );

  // [NUMMER-EENMALIG] NOT asserted here, and the reason is worth writing down rather than leaving
  // as a gap. The one-time numbering notice needs two things this harness cannot produce: a
  // confirmation the owner opened, and a lock state fetched by an effect. renderToStaticMarkup
  // gives neither, so "the notice is absent" is true here no matter what the code does — a
  // mutation that starts the numbering state at `open` leaves this file green. An assertion that
  // cannot fail is worse than no assertion, because it reads as coverage.
  //
  // Where it IS checked: every branch of the decision in numbering-first-send.test.ts, and the
  // containment (notice inside the confirmation, never in the form body) in the [NUMMER-EENMALIG]
  // wiring gate, which can see source order where a render cannot.
});

test("[VERKOPER-COMPLEET] the archive and carried-role doors reach the same form, unchanged", async () => {
  // The two query shapes an owner can arrive with from the first-run work. Neither may turn the
  // form into a setup screen — a visitor who came in through a different door is still an owner
  // making an invoice.
  for (const q of ["", "type=factuur", "client_name=Bakkerij%20de%20Vries"]) {
    const html = await formulier(q);
    assert.ok(html.length > 500, `?${q}: the form did not render`);
    assert.ok(
      !html.includes(nl("nieuw.verkoper.titel")),
      `?${q}: the completion panel opened on entry`,
    );
  }
});
