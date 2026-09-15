// tests/render/ritten.test.tsx
// [RITTEN] The kilometre log renders, with rows that exercise every branch it can show.
//
// The year figure is the reason this gate exists: a deduction on somebody's tax return is
// computed from these rows, and a screen that throws would take the whole hours page with it.
// Rows here cover a billed trip, a private one, and one with no rate — the three that behave
// differently — because [].map(cb) never calls cb and an empty log would prove nothing.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { amsterdamToday } from "../../src/lib/format-nl";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/uren",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

// [TZ] The panel reads the Amsterdam day, so the test does too. Between midnight and 02:00 the
// wall clock on this UTC machine is still yesterday, and on 1 January that is a different year —
// the rows would fall outside the year the screen adds up, and the suite would go red on nothing.
const thisYear = Number(amsterdamToday().slice(0, 4));
const trip = (over: Record<string, unknown> = {}) => ({
  id: "r1", client_id: "c1", driven_on: `${thisYear}-03-04`, from_place: "kantoor", to_place: "Zwolle",
  purpose: "Adviesgesprek", kilometers: 40, rate_per_km: 0.23, business: true, invoice_id: null, ...over,
});

async function render(entries: Array<Record<string, unknown>>, failed = false) {
  const { default: RittenPanel } = await import("../../src/app/dashboard/uren/RittenPanel");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(RittenPanel as any, {
          clients: [{ id: "c1", name: "Bakkerij De Jong" }],
          initialEntries: entries,
          initialFailed: failed,
        }))),
  );
}

test("[RITTEN] the year states the business kilometres and what they are worth", async () => {
  const html = await render([
    trip(),
    trip({ id: "r2", kilometers: 60, rate_per_km: null }),          // no rate: km count, value does not
    trip({ id: "r3", kilometers: 10, invoice_id: "inv-1" }),        // already billed
    trip({ id: "r4", kilometers: 25, business: false }),            // private: counts for nothing
  ]);
  assert.match(html, /110 km zakelijk/, "40 + 60 + 10 business kilometres, the private 25 left out");
  assert.match(html, /Aftrek € 25,30/, "110 × € 0,23");
  assert.match(html, /€ 9,20 reiskosten staat nog op geen factuur/, "only the unbilled, priced trip");
  assert.match(html, /Bij 1 rit staat geen tarief/);
  assert.match(html, /Staat op een factuur/);
  assert.match(html, /Privé/);
  // The trip that CAN be billed is offered as one, and only that one: € 9,20, not € 25,30.
  assert.match(html, /Klaar om te factureren/);
  assert.match(html, /Maak factuur/);
});

test("[RITTEN] nothing is offered for travel nobody owes", async () => {
  const html = await render([
    trip({ rate_per_km: null }),                       // no rate agreed
    trip({ id: "r2", client_id: null }),               // no customer to bill
    trip({ id: "r3", business: false }),               // private
    trip({ id: "r4", invoice_id: "inv-1" }),           // already billed
  ]);
  assert.doesNotMatch(html, /Maak factuur/,
    "a button that can only produce an empty invoice is worse than no button");
});

test("[RITTEN] an empty log says so, and claims no deduction", async () => {
  const html = await render([]);
  assert.match(html, /Nog geen ritten/);
  assert.doesNotMatch(html, /Aftrek/, "a zero deduction at rest is a claim about a year nobody drove");
});

test("[RITTEN] a failed read is said out loud, never shown as an empty log", async () => {
  const html = await render([], true);
  assert.match(html, /We konden je ritten nu niet ophalen/);
});
