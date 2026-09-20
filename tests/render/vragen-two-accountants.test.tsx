// tests/render/vragen-two-accountants.test.tsx
// [VRAAG-EIGENAAR] The owner's questions screen with TWO accountants — does every card answer its
// own asker, and does a question from an office that is no longer linked stay honest?
//
// Run: npm run test:render
//
// Same shape as money-screens.test.tsx: react-dom/server, no browser, no session, no database. The
// component takes its rows as props; the link collection and the names travel in beside them. What
// the pure modules decide (accountant-links.test.ts, vragen.test.ts) is not re-tested here — this
// gate proves the screen RENDERS those decisions: the asker's name on each card, a composer only
// where the asker is linked, and the honest sentence where they are not.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/vragen",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const vraag = (over: Record<string, unknown>) => ({
  documentId: "doc-1", documentName: "bon-juni.pdf", documentTrashed: false, documentMissing: false,
  question: "Waar is deze bon van?", askedAt: "2026-07-01T10:00:00.000Z", subjectType: "document" as const,
  accountantId: A, fileUrl: null, invoiceHref: null, ...over,
});

test("[VRAAG-EIGENAAR] two accountants: each card names its asker and carries its own composer", async () => {
  const { default: VragenClient } = await import("../../src/app/dashboard/vragen/VragenClient");
  const html = renderToStaticMarkup(React.createElement(VragenClient, {
    vragen: [
      vraag({ documentId: "inv-1", accountantId: A, subjectType: "invoice", documentName: "Bakker BV · factuur 2026-014", question: "Tarief?", invoice: { id: "inv-1", invoice_number: "2026-014", client_name: "Bakker BV", total_inc_btw: 121, invoice_date: "2026-05-01" }, invoiceHref: "/dashboard/incoming/manage?focus=inv-1&from=vragen" }),
      vraag({ documentId: "inv-1", accountantId: B, subjectType: "invoice", documentName: "Bakker BV · factuur 2026-014", question: "Privé of zakelijk?", invoice: { id: "inv-1", invoice_number: "2026-014", client_name: "Bakker BV", total_inc_btw: 121, invoice_date: "2026-05-01" }, invoiceHref: "/dashboard/invoice/inv-1?from=vragen" }),
    ],
    links: { state: "known", ids: [A, B] },
    accountantNames: { [A]: "Kantoor Alpha", [B]: "Kantoor Beta" },
    accountantNaam: null,
    loadFailed: false,
  }));
  assert.match(html, /Gevraagd door Kantoor Alpha/, "the first card names its asker");
  assert.match(html, /Gevraagd door Kantoor Beta/, "the second card names ITS asker");
  assert.equal((html.match(/<textarea/g) ?? []).length, 2, "one composer per question — both askers are linked");
  assert.match(html, new RegExp(`id="antwoord-${A}-inv-1"`), "the composer is keyed on the asker, so two questions on one invoice do not collide");
  assert.match(html, new RegExp(`id="antwoord-${B}-inv-1"`));
  // [VRAAG-DEUR] the door the server decided is the one on the card — one incoming, one outgoing.
  assert.match(html, /href="\/dashboard\/incoming\/manage\?focus=inv-1&amp;from=vragen"/);
  assert.match(html, /href="\/dashboard\/invoice\/inv-1\?from=vragen"/);
  assert.doesNotMatch(html, /Er is op dit moment geen boekhouder/, "two linked offices are not 'no accountant linked'");
  // With two offices the intro does not pick one of them by name.
  assert.match(html, /Mist je boekhouder iets/);
});

test("[VRAAG-EIGENAAR] a question whose asker is no longer linked stays visible, says so, and has no composer", async () => {
  const { default: VragenClient } = await import("../../src/app/dashboard/vragen/VragenClient");
  const html = renderToStaticMarkup(React.createElement(VragenClient, {
    vragen: [vraag({ accountantId: GONE, question: "Nog een oude vraag" })],
    links: { state: "known", ids: [A] },
    accountantNames: { [A]: "Kantoor Alpha" },
    accountantNaam: "Kantoor Alpha",
    loadFailed: false,
  }));
  assert.match(html, /Nog een oude vraag/, "the question is not hidden");
  assert.match(html, /niet meer aan je account gekoppeld/, "…and the state is said");
  assert.doesNotMatch(html, /<textarea/, "no composer pretends the relationship exists");
  assert.doesNotMatch(html, /Gevraagd door/, "no name is invented for an id nobody could prove");
});

test("[VRAAG-EIGENAAR] a failed link read is 'could not check' — never 'no accountant', never a composer", async () => {
  const { default: VragenClient } = await import("../../src/app/dashboard/vragen/VragenClient");
  const html = renderToStaticMarkup(React.createElement(VragenClient, {
    vragen: [vraag({})],
    links: { state: "failed" },
    accountantNames: {},
    accountantNaam: null,
    loadFailed: false,
  }));
  assert.match(html, /konden niet controleren of deze boekhouder/);
  assert.match(html, /Opnieuw proberen/, "…with the way to try again");
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, /niet meer aan je account gekoppeld/, "a failed read is not a revoked link");

  // And the empty state under a failed read does not claim "no accountant linked" either.
  const leeg = renderToStaticMarkup(React.createElement(VragenClient, {
    vragen: [], links: { state: "failed" }, accountantNames: {}, accountantNaam: null, loadFailed: false,
  }));
  assert.match(leeg, /konden je koppeling met een boekhouder nu niet controleren/);
  assert.doesNotMatch(leeg, /Je hebt nog geen boekhouder gekoppeld/);
  assert.doesNotMatch(leeg, /href="\/boekhouders"/, "no office directory is pushed at an owner whose links we could not read");
});

test("[VRAAG-EIGENAAR] one linked accountant: the intro names them, and the card answers them", async () => {
  const { default: VragenClient } = await import("../../src/app/dashboard/vragen/VragenClient");
  const html = renderToStaticMarkup(React.createElement(VragenClient, {
    vragen: [vraag({})],
    links: { state: "known", ids: [A] },
    accountantNames: { [A]: "Kantoor Alpha" },
    accountantNaam: "Kantoor Alpha",
    loadFailed: false,
  }));
  assert.match(html, /Mist Kantoor Alpha iets/);
  assert.equal((html.match(/<textarea/g) ?? []).length, 1);
});
