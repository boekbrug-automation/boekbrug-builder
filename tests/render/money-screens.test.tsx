// tests/render/money-screens.test.tsx
// [RENDER-GATE] Do the money screens survive one render?
//
// Run: npm run test:render
//
// ── WHY THIS EXISTS ──
// The five gates this repo runs are all blind to a crashing screen.
//
//   · `tsc --noEmit` type-checks, and a temporal-dead-zone reference inside a `.filter()` callback
//     is perfectly typed — TypeScript does not model WHEN a closure runs.
//   · `eslint src/` has no rule for it (no-use-before-define fires on 32 places in this repo,
//     almost all of them the harmless kind: a module-scope const used inside a function that runs
//     later). Turning it on would drown the real one in noise.
//   · `next build` compiles the component. It does not call it.
//   · The Playwright smoke test sweeps the PUBLIC surface — every path the middleware lets through
//     without a session. /dashboard/* is by definition not on it.
//
// So a logged-in screen that throws on EVERY render passes all five. That is not hypothetical:
// [INVOICE-SCAN] shipped through the whole gate set with `displayed` reading `onlyFlagged` seventy
// lines before it was declared. Five green gates, and the pay screen would have been a white page
// with "Cannot access 'onlyFlagged' before initialization" in the console.
//
// One render is enough to catch that entire class, and it costs under a second.
//
// ── WHAT IT IS NOT ──
// Not a UI test. It asserts that the component RUNS and that its output is not empty — not how it
// looks, not what it does when you click. Behaviour lives in the pure modules, which have their own
// tests; this gate covers the one thing those cannot see, which is whether the screen that uses
// them survives being called.
//
// ── WHY react-dom/server AND NOT PLAYWRIGHT ──
// Playwright would need a real session, a database with rows in a known state, and a served build.
// This needs none of that: the components take their data as props, so we hand them rows and call
// them. Effects never run under renderToStaticMarkup, so nothing reaches the network.
//
// ── WHY IT LIVES IN tests/render/ AND NOT IN tests/ ──
// playwright.config.ts has testDir './tests'. Its testMatch is pinned to *.spec.ts precisely so
// this file is not picked up by a runner that would not understand it.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// DELIBERATELY FAKE, and set here rather than in the npm script so the gate runs the same way on
// every machine and no one has to remember them. Same reasoning as playwright.config.ts: the
// Supabase client library refuses to be CONSTRUCTED without a URL and a key, and these screens
// construct one while rendering. The host does not exist, which is exactly right — effects never
// run under renderToStaticMarkup, so nothing here may reach a network, and if a render ever starts
// needing real keys it has stopped being a render gate.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

// The App Router hooks throw outside a router ("invariant expected app router to be mounted").
// Stubbed rather than provided: this gate is about the component body, and a real router would
// only add a way for the gate to fail for a reason that is not the screen's fault.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard",
    // A client PAGE reads its own route parameter. Stubbing it lets /dashboard/invoice/[id] be
    // rendered like any other component.
    useParams: () => ({ id: "inv-1" }),
    // These throw in real Next too — a render that reaches them is a redirect, not a crash, and a
    // test asserting "it renders" should say so out loud rather than pass on a silent no-op.
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

/**
 * A confirmed purchase invoice, in the shape /dashboard/incoming/manage receives it.
 * Defaults describe a correct 9% invoice; every case below overrides only what it is about.
 */
const manageRow = (over: Record<string, unknown> = {}) => ({
  id: "a", invoice_number: "RE0801378", client_name: "Groothandel", status: "received",
  accountant_status: null, direction: "incoming", invoice_type: "factuur",
  total_inc_btw: 871.4, amount_paid: 0, total_ex_btw: 799.45, btw_amount: 71.95,
  invoice_date: "2026-03-12", due_date: "2026-04-11", payment_method: null, payment_date: null,
  created_at: "2026-03-12T10:00:00Z", document_id: null, pdf_url: null, vendor_iban: null,
  payment_reference: null, payment_prepared_at: null, field_confidence: null, ...over,
});

test("[RENDER-GATE] the pay screen renders, with rows that trip every warning it can show", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const rows = [
    // A credit note the supplier numbers CR…, booked positive — the credit-note signal.
    manageRow({ id: "cr", invoice_number: "CR0300343", total_inc_btw: 51.8, total_ex_btw: 47.52, btw_amount: 4.28, invoice_date: "2026-02-17" }),
    // The ordinary invoice from the same supplier — the evidence the signal needs.
    manageRow({ id: "re" }),
    // A broken breakdown: 985.87 + 88.73 ≠ 1078.46.
    manageRow({ id: "math", client_name: "Vlees", invoice_number: "2033161", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46, invoice_date: "2026-02-21" }),
    // A correctly booked credit note: all three amounts negative.
    manageRow({ id: "cn", client_name: "Vlees", invoice_number: "CN9", invoice_type: "creditnota", total_ex_btw: -100, btw_amount: -9, total_inc_btw: -109 }),
    // A paid invoice, so the paid tab and the settled-amount paths are exercised too.
    manageRow({ id: "paid", client_name: "Energie", invoice_number: "E-1", status: "paid", amount_paid: 871.4, payment_date: "2026-03-20" }),
    // [E-FACTUUR-ZICHTBAAR] A supplier's Peppol invoice: the figures are the supplier's own, so the
    // row must say the owner never has to check this one. Its badge only renders for a row that
    // carries a non-contradicting _einvoice, so without this row the assertion below would pass
    // over markup that was never produced.
    manageRow({
      id: "ubl", client_name: "Groothandel Noord B.V.", invoice_number: "2026-0418",
      field_confidence: {
        _einvoice: {
          totalIncBtw: 871.4, totalExBtw: 799.45, btwAmount: 71.95, syntax: "ubl",
          invoiceNumber: "2026-0418", vendorName: "Groothandel Noord B.V.",
          invoiceDate: "2026-03-12", dueDate: null, vendorIban: null, paymentReference: null,
          isCreditNote: false, contradicts: false,
        },
      },
    }),
    // …and one the supplier's own file CONTRADICTS. That already earns a warning, so the
    // reassuring badge must NOT appear beside it — a screen that argues with itself is worse than
    // one that says nothing.
    manageRow({
      id: "ublbad", client_name: "Tegenspraak B.V.", invoice_number: "2026-0999",
      total_inc_btw: 87.14,
      field_confidence: {
        _einvoice: {
          totalIncBtw: 871.4, totalExBtw: 799.45, btwAmount: 71.95, syntax: "ubl",
          invoiceNumber: "2026-0999", vendorName: "Tegenspraak B.V.",
          invoiceDate: "2026-03-12", dueDate: null, vendorIban: null, paymentReference: null,
          isCreditNote: false, contradicts: true,
        },
      },
    }),
    // [BON-AUTO] A kassabon the app marked PAID by itself, on the strength of the tender line the
    // till printed. Its badge only renders for a row that carries _auto_paid, so without this row
    // the assertion below would pass over markup that was never produced.
    manageRow({
      id: "bon", client_name: "Nettorama", invoice_number: null, status: "paid",
      total_ex_btw: 9.86, btw_amount: 0.88, total_inc_btw: 10.74, amount_paid: 10.74,
      invoice_date: "2026-03-18", payment_date: "2026-03-18", payment_method: "kas",
      field_confidence: {
        _intake_kind: "receipt",
        _auto_verified: { at: "2026-03-18T09:00:00Z", reason: "clean" },
        _auto_paid: { at: "2026-03-18T09:00:00Z", method: "kas", date: "2026-03-18", reason: "bon_tender_cash", evidence: "wisselgeld" },
      },
    }),
    // [DUP-ON-PAY] The Enka pair, verbatim: one supplier, one invoice number, two amounts, both
    // waiting to be paid. Without BOTH rows the grouping has nothing to group and the assertion
    // below would pass over an empty list.
    manageRow({ id: "dupA", client_name: "Enka Horeca B.V.", invoice_number: "26701681", total_ex_btw: 1213.5, btw_amount: 134.64, total_inc_btw: 1348.14, invoice_date: "2026-01-30" }),
    manageRow({ id: "dupB", client_name: "Enka Horeca B.V.", invoice_number: "26701681", total_ex_btw: 1213.5, btw_amount: 122.18, total_inc_btw: 1335.68, invoice_date: "2026-01-30" }),
    // [ACTIES-ALTIJD] One row with a stored PDF: "Bekijk PDF" renders only where there is one to
    // open, and every other fixture row has pdf_url: null.
    manageRow({ id: "pdf", client_name: "Met Bijlage B.V.", invoice_number: "P-1", pdf_url: "https://files.invalid/p-1.pdf" }),
  ];

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
      // The component's prop type is not exported; the rows above match what page.tsx selects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" },
        initialInvoices: rows,
        totalCount: rows.length,
        readFailed: [],
        filedQuarters: ["2026-Q1"],
      }))),
  );

  // Not just "it did not throw": a component that renders null also does not throw, and would pass
  // a bare smoke assertion while showing the owner an empty page.
  assert.ok(html.length > 1000, "the screen rendered something substantial");
  // [INVOICE-SCAN] The banner is the whole reason this file exists — assert it actually appears for
  // rows that are wrong, so a scan silently returning nothing cannot pass as a working screen.
  assert.match(html, /kloppen niet|klopt niet/, "the scan banner names the wrong invoices");
  // [AUTO-UITLEG] The badges the app awards on its own judgement are explained once above the
  // list. The fixture's bon row carries _auto_verified and _auto_paid — so both lines must be
  // there, in words and not keys, each led by the badge's own label. The e-invoice badge on the
  // ubl row gets NO line: the owner struck it.
  for (const [badge, clause] of [
    ["Automatisch</strong>", "controles slaagden"],
    ["Bon · al afgerekend</strong>", "de bon noemt de betaalwijze"],
  ]) {
    assert.ok(html.includes(badge), `the legend does not lead with the badge's own label: ${badge}`);
    assert.ok(html.includes(clause), `the legend lost its explanation: ${clause}`);
  }
  assert.ok(!html.includes("Cijfers van de leverancier</strong>"), "the struck e-invoice line is back above the list");
  assert.ok(!html.includes("ink.autoUitleg"), "the explanation reached the screen as a key");
  assert.ok(!html.includes("Zonder vervaldatum"), "the crossed-out chip is back");

  // [BETAALDATUM] A paid invoice says WHEN. The card carried "Betaald" plus the invoice date and
  // the vervaldatum — two dates that are not about the payment — while the one that is decided
  // which BTW quarter the cost falls in under the kasstelsel, and was nowhere on the screen.
  // Row 'paid' settled on 2026-03-20 and row 'bon' on 2026-03-18, both with a payment_date.
  assert.match(html, /betaald 20 mrt/, "a paid invoice shows the date it was paid");
  assert.match(html, /betaald 18 mrt/, "…including one the app booked from a kassabon");
  // And an UNPAID row must not claim one. There are several in this list; none has a payment_date,
  // so exactly two of these labels may exist.
  assert.equal(
    (html.match(/· betaald \d/g) ?? []).length, 2,
    "only the two rows that carry a payment_date say when they were paid",
  );

  // [CREDIT-NOT-PAYABLE] The row 'cn' is a correctly booked credit note (all three amounts
  // negative). It wore "Te betalen", a vervaldatum, "Heb je betaald?" and a QR Betalen button —
  // four claims about direction, all pointing the wrong way, and the last one prepares a real
  // transfer of money the supplier owes the OWNER. What has to be on screen instead is what
  // actually happens to it, because with the buttons gone the row would otherwise say nothing.
  assert.match(html, /Te ontvangen/, "a credit note is money coming in, and the chip must say so");

  // [DUP-ON-PAY] Two rows, one supplier, one invoice number, both "Te betalen", both counted in the
  // total at the top — reported three times by the owner, who found each pair by adding up their
  // own list. The warning has to be on the COLLAPSED row: that is where they were looking.
  assert.match(html, /staat 2× in je administratie/, "the pair is named on the row");

  // [BULK-UNDO] The reverse of "Meerdere betalen" has to be reachable, and as its own entry point:
  // the two modes select different rows (open vs settled), so one shared selection would let a tap
  // land on the opposite of what the owner meant, on the money core.
  assert.match(html, /Meerdere annuleren/, "bulk undo is offered");
  assert.match(html, /Meerdere betalen/, "…beside the one it mirrors, not instead of it");
  assert.match(html, /correctie of een dubbele import/, "…and says what that means");
  // The four payable affordances are gone from the LIST. The sentence explaining how a credit note
  // resolves lives in the opened card, where the detail belongs — the chip carries it here.
  assert.doesNotMatch(html, /Heb je betaald\?[\s\S]{0,40}CR0300343/, "no pay prompt beside a credit note");
  // [E-FACTUUR-ZICHTBAAR] The app was loud about problems and silent about its strongest certainty.
  // An owner who keeps the paper invoice open beside the screen could see which rows to doubt and
  // not which ones they never have to check again.
  assert.match(html, /Cijfers van de leverancier/, "the supplier's own figures are named on the row");
  assert.match(
    html, /Deze hoef je niet na te kijken/,
    "…and it says what that means, not merely that it happened",
  );
  // Exactly ONE row earns it: the contradicting one must not, or the screen argues with itself.
  assert.equal(
    // The BADGE — its glyph immediately followed by its label. The legend above the list prints
    // the same label once more ([AUTO-UITLEG]), inside <strong>, and must not count here.
    (html.match(/verified<\/span>Cijfers van de leverancier/g) ?? []).length, 1,
    "a contradicted e-invoice may never wear the reassuring badge",
  );

  // [BON-AUTO] A bon the app both booked AND paid needs its own badge. "Automatisch" alone reads
  // as "booked", and an owner who believes a settled bon is still open pays it a second time.
  assert.match(html, /Bon · al afgerekend/, "an auto-settled bon says so on the row");
  // And the basis is the WORD ON THE PAPER, not our conclusion — a claim the owner can check by
  // looking at the bon, with the way back named in the same breath.
  assert.match(html, /Op de bon staat &quot;wisselgeld&quot;/, "the tender line is quoted");
  assert.match(html, /Zet de betaling hieronder terug/, "…and undoing it is offered beside it");

  // [RUST] A filed quarter changes what the owner has to DO, and the scan panel says so — but the
  // panel now sits behind one line, because this screen's job is the list and a half-screen of
  // advice above it is advice nobody reads twice. What the screen still owes without a tap is that
  // there is something to look at AT ALL; the quarter detail travels with the panel it belongs to.
  assert.match(html, /Toon wat hierachter zit/, "the collapsed line offers the scan detail");
  assert.doesNotMatch(html, /aangifte al ingediend/, "the quarter detail comes with the panel, not without it");
  // [SCAN-WHOLE-BOOK] With no server scan, the count must NOT claim to have checked everything —
  // and that has to hold on the COLLAPSED line too, which is the only version most visits see.
  // "3 kloppen niet" over 200 visible rows reads as a total; "in deze lijst" is what stops it.
  assert.match(html, /kloppen niet in deze lijst|klopt niet in deze lijst/,
    "the collapsed line carries the scan's own boundary");

  // [ACTIES-ALTIJD] The ways out are on the CLOSED card. They used to live inside `expanded`,
  // which only a click opens — so this very render could not reach them, and the note on
  // CostAttribution says so in as many words. A static render is exactly the closed state, which
  // makes it the one place the claim "visible without a tap" can be held.
  assert.match(html, /Bekijk PDF/, "the PDF button is folded away again — nothing on the closed card offers it");
  assert.match(html, /Bedragen corrigeren/, "…and the correction door with it");
  // [KNOPPEN-OP-ORDE] On a card that carries them all, the actions come in ONE order — Betalen,
  // Bekijk PDF, Opnieuw inlezen, Bedragen corrigeren — and the bin is the last of them, inside
  // the card's row (after its chevron), not floating beside the card.
  const cards = html.split('class="inv-card inv-card--acties"').slice(1);
  const full = cards.find((c) => c.includes("Bekijk PDF") && c.includes("Bedragen corrigeren") && c.includes("Opnieuw inlezen"));
  assert.ok(full, "no card carries all four actions — the fixture no longer exercises the row");
  const at = (needle: string) => { const i = full!.indexOf(needle); assert.ok(i > 0, `${needle} is missing from the card`); return i; };
  const seq = [at(">Betalen<"), at("Bekijk PDF"), at("Opnieuw inlezen"), at("Bedragen corrigeren"), at(' verwijderen"')];
  assert.deepEqual([...seq].sort((a, b) => a - b), seq, "the actions are out of order on the rendered card");
  assert.ok(at('aria-controls="inv-detail-') < at(' verwijderen"'), "the bin stands before the chevron — outside the row");
  assert.match(html, /qr_code_2<\/span>Betalen/, "…and the pay button (asserted with its icon, so 'Meerdere betalen' cannot stand in for it)");
  // Every card carries the chevron, closed, pointing at a detail block that is NOT rendered yet.
  const chevrons = (html.match(/aria-controls="inv-detail-/g) ?? []).length;
  assert.ok(chevrons >= 2, `only ${chevrons} chevrons — is the strip on every card?`);
  assert.equal((html.match(/aria-expanded="false" aria-controls="inv-detail-/g) ?? []).length, chevrons,
    "a chevron says it is open on a card that has not been tapped");
  assert.doesNotMatch(html, /id="inv-detail-/, "the folded half rendered without a tap — the fold is gone");
  // [ALLEEN-DE-PIJL] The header no longer answers a click outside select mode, so it must not
  // advertise one: a pointer cursor on a row that does nothing is a promise the row breaks.
  const koppen = [...html.matchAll(/class="inv-row"[^>]*style="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(koppen.length >= 2, `only ${koppen.length} row headers found — the fixture stopped exercising the list`);
  for (const stijl of koppen) assert.match(stijl, /cursor:default/, "a row header still wears a pointer cursor");

  // [FILTERS-EEN-REGEL] Period, filter and sort share ONE flex row: the period is the first third,
  // directly inside the wrapping row, and there are exactly three thirds.
  assert.match(html, /display:flex;gap:8px;flex-wrap:wrap"><div style="position:relative;flex:1 1 150px;min-width:0"><button/,
    "the period selector is back on a row of its own above the other two");
  assert.equal((html.match(/flex:1 1 150px/g) ?? []).length, 3, "three filters, three equal thirds");
});

test("[BETAALBEWIJS] every \"Betaald\" carries the bank line that says so", async () => {
  // The pay screen showed the conclusion and never the evidence: it read amount_paid and
  // payment_date, and never once bank_tx_invoices. Checking it meant opening the bank in another
  // tab — the work the app exists to remove, handed back at the moment trust is asked for.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const paid = {
    id: "p1", invoice_number: "264091", client_name: "BALKIP B.V.", status: "paid",
    direction: "incoming", invoice_type: "factuur", total_inc_btw: 1224.75, amount_paid: 1224.75,
    total_ex_btw: 1123.62, btw_amount: 101.13, invoice_date: "2026-08-13", due_date: "2026-08-13",
    payment_date: "2026-08-20", payment_method: "bank", accountant_status: null,
    created_at: "2026-08-13T10:00:00Z", document_id: null, pdf_url: null, vendor_iban: null,
    payment_reference: null, payment_prepared_at: null, field_confidence: null,
  };
  const render = (paymentEvidence: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingManageClient as any, {
          profile: { id: "u1" }, initialInvoices: [paid], totalCount: 1,
          readFailed: [], filedQuarters: [], paymentEvidence,
        }))),
  );

  // Proven by the bank: the statement text, verbatim — recognition is the whole mechanism.
  const bank = render({ p1: { kind: "bank", total: 1224.75, links: [{
    transactionId: "tx-1", amountApplied: 1224.75, paidOn: "2026-08-20", method: "bank",
    transaction: { date: "2026-08-20", amount: -1224.75, description: "FACTUUR 264091 BALKIP",
      counterpartName: "BALKIP B.V.", counterpartIban: null },
  }] } });
  assert.match(bank, /afgeschreven/);
  // [AUTO-UITLEG] No such row on this screen → no legend for a badge nobody sees.
  for (const clause of ["controles slaagden", "de bon noemt de betaalwijze"]) {
    assert.ok(!bank.includes(clause), `the legend explains a badge that is not on screen: ${clause}`);
  }
  // Curly quotes, as the rest of the catalogue writes them. The QUOTES are the app's punctuation;
  // the string between them is the bank's, and only the second one may never be touched.
  assert.match(bank, /\u201cFACTUUR 264091 BALKIP\u201d/, "the owner's own statement line");
  // On the pay screen the money LEFT. The sales list asserts the opposite word — see below.
  assert.doesNotMatch(bank, /bijgeschreven/);

  // The owner's own tick reads differently — it may not borrow the bank's authority.
  const hand = render({ p1: { kind: "manual", total: 1224.75, links: [{
    transactionId: null, amountApplied: 1224.75, paidOn: "2026-08-20", method: "bank", transaction: null,
  }] } });
  assert.match(hand, /€\s?1\.224,75 door jou afgevinkt/);
  assert.doesNotMatch(hand, /afgeschreven/, "nothing was demonstrably debited");

  // Marked paid with nothing recording how — the state that keeps the other two worth believing.
  assert.match(render({ p1: { kind: "none" } }), /geen betaling aan gekoppeld/);
  // …and a failed read says that, instead of asserting there is no evidence.
  assert.match(render({ p1: { kind: "unknown" } }), /konden niet nakijken/);
  // An older render that sends nothing leaves the row exactly as it was.
  assert.doesNotMatch(render({}), /afgeschreven|door jou afgevinkt|geen betaling aan gekoppeld/i);
});

test("[OPENSTAAND-BEWIJS] the pay screen states what was checked, against what, and until when", async () => {
  // The owner knows the app read their invoices right and still does not quite believe the list of
  // what they owe. Every screen shows a conclusion; none shows its working. This panel is the only
  // thing on the pay screen that states the SEARCH — and the scope is the product, not the hits.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const render = (openProof: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingManageClient as any, {
          profile: { id: "u1" }, initialInvoices: [], totalCount: null,
          readFailed: [], filedQuarters: [], openProof,
        }))),
  );

  // The everyday answer, and the one that has to be worth reading: nothing found, said with the
  // three numbers that make it checkable against the owner's own bank in seconds.
  const clean = render({
    checkedInvoices: 12, checkedTransactions: 340, hits: [],
    bankThrough: "2026-08-15", readFailed: false, capped: { invoices: 0, transactions: 0 },
  });
  assert.match(clean, /12 openstaande inkoopfacturen/);
  assert.match(clean, /340 banktransacties/);
  assert.match(clean, /t\/m 15 augustus 2026/, "the horizon — where the app stops knowing");
  assert.match(clean, /Geen betaling gevonden/);

  // The exception: a bill we call open, with a payment sitting in the bank. Both numbers, and a
  // question — never an assertion, and never applied.
  const hit = render({
    checkedInvoices: 12, checkedTransactions: 340,
    hits: [{
      invoiceId: "a", invoiceNumber: "264091", clientName: "BALKIP B.V.", openAmount: 1224.75,
      transaction: { date: "2026-08-20", amount: -1224.75, description: "FACTUUR 264091 BALKIP", counterpartName: "BALKIP B.V." },
      confidence: 0.9, reason: "bedrag en tegenpartij komen overeen",
    }],
    bankThrough: "2026-08-15", readFailed: false, capped: { invoices: 0, transactions: 0 },
  });
  assert.match(hit, /264091/);
  assert.match(hit, /€\s?1\.224,75 open/, "what we call open");
  assert.match(hit, /20 augustus 2026/, "…and when the money left");
  assert.match(hit, /Klopt het dat deze factuur nog openstaat\?/, "a question, not a verdict");
  assert.match(hit, /12 openstaande inkoopfacturen vergeleken/, "the scope survives a finding");

  // [NO-SILENT-EMPTY] A proof that could not run may never read as one that found nothing. Over
  // this list that is the most convincing lie the app could tell.
  const broken = render({
    checkedInvoices: 0, checkedTransactions: 0, hits: [],
    bankThrough: null, readFailed: true, capped: { invoices: 0, transactions: 0 },
  });
  assert.doesNotMatch(broken, /Geen betaling gevonden/);
  assert.match(broken, /niet met je bank vergelijken/);

  // A bounded check presented as a complete one is the false reassurance this panel removes.
  const capped = render({
    checkedInvoices: 200, checkedTransactions: 2000, hits: [],
    bankThrough: "2026-08-15", readFailed: false, capped: { invoices: 14, transactions: 300 },
  });
  assert.match(capped, /Niet alles is meegenomen/);
  assert.match(capped, /14 facturen/);
  assert.match(capped, /300 banktransacties/);

  // …and an older render that sends nothing shows no panel rather than an empty claim.
  assert.doesNotMatch(render(null), /vergeleken met/);
});

test("[BETAALBEWIJS] one component paints the four claims, and each one differently", async () => {
  // The line itself is proved in the unit suite; what is held HERE is that it reaches a screen and
  // that the four states do not look alike. Rendering a bank-proven payment and the owner's own
  // tick identically borrows the bank's authority for the tick — and when the tick was a mistake,
  // nothing on the screen ever says so.
  const { default: PaymentEvidenceLine } = await import("../../src/components/invoice/PaymentEvidenceLine");
  const { buildPaymentEvidenceLine, classifyPayment } = await import("../../src/lib/payment-evidence");

  const paint = (ev: unknown, direction: "incoming" | "outgoing") => renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(PaymentEvidenceLine as any, {
      line: buildPaymentEvidenceLine(ev as never, direction),
    }),
  );

  const bankLink = {
    transactionId: "tx-1", amountApplied: 2420, paidOn: "2026-07-14", method: "bank",
    transaction: {
      date: "2026-07-14", amount: 2420, description: "FACTUUR 2026-014",
      counterpartName: "Kiwi Food Market", counterpartIban: null,
    },
  };

  // A customer's payment, on a SALES invoice: the money arrived.
  const verkoop = paint(classifyPayment([bankLink as never]), "outgoing");
  assert.match(verkoop, /bijgeschreven/);
  assert.match(verkoop, /van Kiwi Food Market/);
  assert.doesNotMatch(verkoop, /afgeschreven/, "that word describes the owner paying their customer");
  assert.match(verkoop, /#0B8043/, "bank green — a third party corroborates this");

  // The same link on the pay screen: the money left.
  assert.match(paint(classifyPayment([bankLink as never]), "incoming"), /afgeschreven/);

  // The owner's own tick is true, and is not the same claim — so it is not green.
  const hand = paint(classifyPayment([{ transactionId: null, amountApplied: 2420, paidOn: "2026-07-14", method: "bank" } as never]), "outgoing");
  assert.match(hand, /€\s?2\.420,00 door jou afgevinkt/, "the instalment names its own amount");
  assert.doesNotMatch(hand, /#0B8043/);

  // Marked paid with nothing recording how — amber, because on a sales invoice that is money the
  // owner believes came in and never chases again.
  const geen = paint(classifyPayment([]), "outgoing");
  assert.match(geen, /geen betaling aan gekoppeld/);
  assert.match(geen, /#7C5800/);

  // [NO-SILENT-EMPTY] A failed read is its own answer, and never the same one as "nothing linked".
  const onbekend = paint(classifyPayment(null), "outgoing");
  assert.match(onbekend, /konden niet nakijken/);
  assert.doesNotMatch(onbekend, /geen betaling aan gekoppeld/);

  // …and a row nobody sent evidence for paints nothing at all, rather than an empty claim.
  assert.equal(
    renderToStaticMarkup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(PaymentEvidenceLine as any, { line: null }),
    ),
    "",
  );
});

test("[DEELBETALING-BEWIJS] a partly settled invoice shows the terms, not just the remainder", async () => {
  // "Deels betaald · nog € 460" is the hardest number in this app to check by hand: the owner would
  // have to open their bank and add up, which is the work the product exists to remove. So the
  // instalments are named, each carrying its OWN evidence — a bank-proven term and a hand-recorded
  // one are never flattened into one claim about the whole invoice.
  const { default: PaymentEvidenceLine } = await import("../../src/components/invoice/PaymentEvidenceLine");
  const { buildPaymentEvidenceLine, classifyPayment } = await import("../../src/lib/payment-evidence");

  const invoice = { status: "sent", total_inc_btw: 1210, amount_paid: 750 };
  const links = [
    { transactionId: "tx-1", amountApplied: 500, paidOn: "2026-07-03", method: "bank",
      transaction: { date: "2026-07-03", amount: 500, description: "termijn 1",
        counterpartName: "Kiwi Food Market", counterpartIban: null } },
    { transactionId: null, amountApplied: 250, paidOn: "2026-07-14", method: "bank" },
  ];
  const paint = (inv: unknown) => renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(PaymentEvidenceLine as any, {
      line: buildPaymentEvidenceLine(
        classifyPayment(links as never, 1210), "outgoing", "nl", inv as never,
      ),
    }),
  );

  const html = paint(invoice);
  // The sum, against the invoice it is a part of — the arithmetic the chip only states the end of.
  assert.match(html, /€\s?750,00 van €\s?1\.210,00 voldaan, in 2 betalingen/);
  // Both terms, each with its own amount and its own kind of proof.
  assert.match(html, /€\s?500,00 bijgeschreven op 3 juli 2026 van Kiwi Food Market/);
  assert.match(html, /€\s?250,00 door jou afgevinkt op 14 juli 2026/);
  // Nothing is wrong here, so nothing shouts.
  assert.doesNotMatch(html, /Let op/);

  // [NO-SILENT-EMPTY] amount_paid is a CACHED sum of exactly those rows, maintained by a database
  // function that also CLAMPS at the invoice magnitude. Nothing had ever held the two against each
  // other, so a remainder no instalment supports rendered as fact. Both figures, never a silent
  // preference for one.
  const drift = paint({ ...invoice, amount_paid: 800 });
  assert.match(drift, /Let op/);
  assert.match(drift, /€\s?800,00 betaald/);
  assert.match(drift, /tellen op tot €\s?750,00/);

  // A single payment keeps the plain sentence — no lead, no bullets, nothing to add up.
  const one = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(PaymentEvidenceLine as any, {
      line: buildPaymentEvidenceLine(
        classifyPayment([links[0]] as never, 1210), "outgoing", "nl",
        { status: "sent", total_inc_btw: 1210, amount_paid: 500 } as never,
      ),
    }),
  );
  assert.doesNotMatch(one, /voldaan, in/);
  assert.match(one, /€\s?500,00 bijgeschreven/);
});

test("[BINNENGEKOMEN-BEWIJS] the panel says what came in that belongs to no invoice", async () => {
  // The mirror of the openstaand sentence, asked of the MONEY. Readiness already counts unexplained
  // receipts, and a count cannot tell three payments of € 5 from three of € 5.000 — only the second
  // is turnover that was never invoiced. So the SUM is named, and the day the last one arrived.
  const { default: OpenInvoiceProofPanel } = await import("../../src/components/invoice/OpenInvoiceProofPanel");
  const { buildProofPanel } = await import("../../src/lib/open-invoice-proof-text");
  const { proveIncomingPayments } = await import("../../src/lib/open-invoice-proof");

  const paint = (incoming: unknown) => renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(OpenInvoiceProofPanel as any, {
      panel: buildProofPanel({
        direction: "outgoing", checkedInvoices: 7, checkedTransactions: 210, hits: [],
        bankThrough: "2026-08-15", readFailed: false, capped: { invoices: 0, transactions: 0 },
        incoming,
      } as never, "nl"),
    }),
  );

  // Built by the ENGINE, not written out by hand. A literal would hold the SENTENCE and not the
  // arithmetic behind it — deleting the line that sums the unexplained payments left this test
  // green, because the number it printed was one the test had supplied. The negative control is
  // the only reason that is not still true.
  const sale = {
    id: "out-1", invoice_number: "2026-014", total_inc_btw: 2420, amount_paid: 0,
    invoice_date: "2026-07-01", due_date: "2026-07-15", client_name: "Kiwi Food Market",
    direction: "outgoing", status: "sent", accountant_status: null, vendor_iban: null,
  };
  const line = (over: Record<string, unknown>) => ({
    date: "2026-07-14", amount: 2420, currency: "EUR", description: "Factuur 2026-014",
    counterpartName: "Kiwi Food Market", counterpartIban: "NL91ABNA0417164300",
    reference: null, transactionId: "tx-1", rawLine: "", ...over,
  });
  const html = paint(proveIncomingPayments([sale] as never, [
    line({}),
    line({ transactionId: "tx-2", amount: 3000, description: "overboeking", counterpartName: "Onbekend BV", counterpartIban: "NL02RABO0123456789", date: "2026-08-11" }),
    line({ transactionId: "tx-3", amount: 1820, description: "contant", counterpartName: null, counterpartIban: null, date: "2026-07-05" }),
  ] as never));
  // The scope, again — held against a stated number of invoices.
  assert.match(html, /3 ontvangen betalingen nagekeken tegen 1 openstaande verkoopfactuur/);
  // Money already in, on invoices the app still calls open.
  assert.match(html, /1 daarvan lijkt bij een factuur te horen die nog openstaat/);
  // The figure a count cannot carry, and the day that says whether this is old or happening now.
  assert.match(html, /€\s?4\.820,00/, "€ 3.000 + € 1.820, summed by the engine and not by this test");
  assert.match(html, /11 augustus 2026/);
  // Never an accusation — it says what can be DONE.
  assert.match(html, /Koppel ze bij Bank/);
  assert.doesNotMatch(html, /zwart|fraude|verzwegen/i);

  // Nothing received → no sentence at all, rather than a reassuring one about a search over an
  // empty set. Silence here is the honest answer.
  const quiet = paint({ checkedPayments: 0, checkedInvoices: 7, matched: [], unexplained: { count: 0, total: 0, newest: null } });
  assert.doesNotMatch(quiet, /ontvangen betalingen nagekeken/);
  // …and so is a purchase-side panel, where the question does not apply.
  assert.doesNotMatch(paint(null), /ontvangen betalingen nagekeken/);

  // Everything received is placed → the scope is stated, and no alarm follows it.
  const clean = paint({ checkedPayments: 4, checkedInvoices: 7, matched: [{ transactionId: "a" }], unexplained: { count: 0, total: 0, newest: null } });
  assert.match(clean, /4 ontvangen betalingen nagekeken/);
  assert.doesNotMatch(clean, /hoort bij geen enkele factuur|horen bij geen enkele factuur/);
});

test("[CREDIT-BEWIJS] a refund is money leaving, and the credits behind the chip are named", async () => {
  // Two things about the documents that give money BACK.
  //
  // The direction first, because it was WRONG on screen: the evidence line took its direction from
  // the invoice's `direction` column, which describes the DOCUMENT. A creditnota moves money the
  // other way — the owner refunds the customer — so a € 500 refund rendered as "bijgeschreven …
  // van Kiwi Food Market" beside a bank line of −500. Money leaving, described as money arriving.
  const { default: PaymentEvidenceLine } = await import("../../src/components/invoice/PaymentEvidenceLine");
  const { default: CreditEvidenceLine } = await import("../../src/components/invoice/CreditEvidenceLine");
  const { buildPaymentEvidenceLine, classifyPayment } = await import("../../src/lib/payment-evidence");
  const { buildCreditEvidenceLine } = await import("../../src/lib/credit-evidence");
  const { moneyDirection } = await import("../../src/lib/credited-invoices");

  const creditnota = { direction: "outgoing", invoice_type: "creditnota", status: "paid", total_inc_btw: -500, amount_paid: 500 };
  const refund = classifyPayment([{
    transactionId: "tx-r", amountApplied: 500, paidOn: "2026-07-20", method: "bank",
    transaction: { date: "2026-07-20", amount: -500, description: "terugbetaling CR-2026-003",
      counterpartName: "Kiwi Food Market", counterpartIban: null },
  }] as never, -500);

  const paid = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(PaymentEvidenceLine as any, {
      line: buildPaymentEvidenceLine(refund, moneyDirection(creditnota), "nl", creditnota as never),
    }),
  );
  assert.match(paid, /afgeschreven op 20 juli 2026 naar Kiwi Food Market/, "the money LEFT");
  assert.doesNotMatch(paid, /bijgeschreven/, "…and saying otherwise contradicts the bank line beside it");

  // …and the sales list's own invoices are unaffected: an ordinary outgoing invoice still reads
  // as money arriving. A fix that flipped BOTH would just be the same bug the other way round.
  const factuur = { direction: "outgoing", invoice_type: "factuur", status: "paid", total_inc_btw: 2420, amount_paid: 2420 };
  const incoming = classifyPayment([{
    transactionId: "tx-1", amountApplied: 2420, paidOn: "2026-07-14", method: "bank",
    transaction: { date: "2026-07-14", amount: 2420, description: "FACTUUR 2026-014",
      counterpartName: "Kiwi Food Market", counterpartIban: null },
  }] as never, 2420);
  assert.match(
    renderToStaticMarkup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(PaymentEvidenceLine as any, {
        line: buildPaymentEvidenceLine(incoming, moneyDirection(factuur), "nl", factuur as never),
      }),
    ),
    /bijgeschreven op 14 juli 2026 van Kiwi Food Market/,
  );

  // Second: the credits behind "Deels gecrediteerd · € 250", by number and date. These are papers
  // the OWNER sent, and an accountant asks about them by number.
  const credits = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(CreditEvidenceLine as any, {
      line: buildCreditEvidenceLine([
        { invoiceNumber: "CR-2026-004", invoiceDate: "2026-07-20", amount: 100 },
        { invoiceNumber: "CR-2026-003", invoiceDate: "2026-07-14", amount: 150 },
      ]),
    }),
  );
  assert.match(credits, /€\s?250,00 teruggegeven met 2 creditnota/);
  assert.match(credits, /CR-2026-004 · 20 juli 2026 — €\s?100,00/);
  assert.match(credits, /CR-2026-003 · 14 juli 2026 — €\s?150,00/);

  // An invoice with no credits paints nothing at all, rather than an empty claim.
  assert.equal(
    renderToStaticMarkup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(CreditEvidenceLine as any, { line: buildCreditEvidenceLine([]) }),
    ),
    "",
  );
});

test("[DEELBETALING-BEWIJS] a link from before amount_applied existed is not 'no payment'", async () => {
  // bank_tx_invoices rows created before the column carry NULL, and by construction settled their
  // invoice IN FULL — the rule allocatedOnLine has always applied, where reading NULL as 0 would
  // let the same euros be spent twice. Read as zero here, the link was dropped and the invoice
  // rendered the amber "marked paid, no payment linked": a false alarm about an invoice with a
  // bank line on it, on the one line that may never cry wolf.
  const { default: PaymentEvidenceLine } = await import("../../src/components/invoice/PaymentEvidenceLine");
  const { buildPaymentEvidenceLine, classifyPayment } = await import("../../src/lib/payment-evidence");

  const legacy = [{
    transactionId: "tx-old", amountApplied: null, paidOn: "2025-11-04", method: "bank",
    transaction: { date: "2025-11-04", amount: -1210, description: "FACTUUR 2025-088",
      counterpartName: "BALKIP B.V.", counterpartIban: null },
  }];
  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(PaymentEvidenceLine as any, {
      line: buildPaymentEvidenceLine(
        classifyPayment(legacy as never, -1210), "incoming", "nl",
        { status: "paid", total_inc_btw: -1210, amount_paid: 1210 } as never,
      ),
    }),
  );
  assert.doesNotMatch(html, /geen betaling aan gekoppeld/, "it HAS a bank line");
  assert.match(html, /#0B8043/, "and a bank line is what green means");
  assert.match(html, /€\s?1\.210,00 afgeschreven op 4 november 2025 naar BALKIP B\.V\./);
});

// [GEEN-BEWIJSPANEEL] The test "the sales list proves the other direction, in its own words" stood
// here. It rendered /dashboard/facturen with a proof result and held three things: the scope
// sentence, the hit branch, and — the half that mattered — that a proof which could not run
// never read as one that found nothing. The owner asked for the panel to go from that screen.
// With nothing said, nothing can be said silently, so the [NO-SILENT-EMPTY] half has nothing
// left to hold; the pay screen's panel keeps its own coverage below.

test("[AUTO-INCASSO] an incasso invoice loses the two things that would cost money", async () => {
  // The screen this feature was reported from. Two WonenBreburg rent invoices, both past their
  // vervaldatum, both wearing "2 dagen te laat" and offering a Betalen button — for money the bank
  // had already taken. The badge is the annoyance; the button is a second payment.
  //
  // Rendered against the LIST, not an opened card, because that is where both of them stood.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { supplierNameKey } = await import("../../src/lib/supplier-registry");

  const rows = [
    // Two invoices from one supplier, DIFFERENT amounts — the pair that proves an amount rule
    // would have covered one and left the other behind.
    manageRow({ id: "h1", client_name: "WonenBreburg", invoice_number: "VHF0001107004", total_ex_btw: 83.70, btw_amount: 0, total_inc_btw: 83.70, invoice_date: "2026-07-15", due_date: "2026-08-01" }),
    manageRow({ id: "h2", client_name: "WonenBreburg", invoice_number: "VHF0001107657", total_ex_btw: 74.96, btw_amount: 0, total_inc_btw: 74.96, invoice_date: "2026-07-15", due_date: "2026-08-01" }),
    // A supplier NOT on incasso, equally overdue — the control. Everything this test asserts is
    // missing for the two above must still be present for this one, or the assertions would pass
    // just as well on a screen that lost its pay buttons entirely.
    manageRow({ id: "g1", client_name: "Groothandel", invoice_number: "263548", due_date: "2026-07-14" }),
  ];

  const render = (keys: string[] | null) => renderToStaticMarkup(
    React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: rows, totalCount: rows.length,
        readFailed: [], filedQuarters: [], incassoKeys: keys,
      }))),
  );

  const on = render([supplierNameKey("WonenBreburg")]);
  assert.ok(on.length > 1000, "the screen rendered something substantial");
  assert.match(on, /Automatisch afgeschreven/, "the incasso rows say who pays them");
  // The control is still late, so the badge itself has not been removed from the screen — only
  // from the rows the bank collects.
  assert.match(on, /dagen te laat/, "the ordinary overdue invoice is still marked late");
  // The em-dash form appears in the badge's title attribute, once per late row — the visible text
  // repeats the same words, so a bare /dagen te laat/ counts each row twice.
  assert.equal(
    (on.match(/— \d+ dagen? te laat/g) ?? []).length, 1,
    "only the non-incasso invoice may be late — the owner is not late for a collection that runs itself",
  );
  // The pay CTA: one, for the one invoice the owner actually has to pay.
  assert.equal(
    (on.match(/Heb je betaald\?/g) ?? []).length, 1,
    "an incasso invoice still offering to be marked paid is one tap away from a double payment",
  );

  // Switch the mandate off and the same three rows behave as they always did. Without this, a
  // component that simply never renders those elements would pass everything above.
  const off = render([]);
  assert.equal((off.match(/— \d+ dagen? te laat/g) ?? []).length, 3, "with no mandate, all three are late again");
  assert.equal((off.match(/Heb je betaald\?/g) ?? []).length, 3, "and all three can be paid by hand");
  assert.doesNotMatch(off, /Automatisch afgeschreven/);

  // And the read that could not run is its own state: it must not read as "nobody is on incasso"
  // in silence, because that silence is what puts the Betalen button back.
  const unknown = render(null);
  assert.match(unknown, /niet ophalen/, "a failed incasso read is said out loud");
  assert.match(unknown, /Betaal ze niet nog een keer/, "…and it names the actual risk");
});

test("[VRIJGESTELD] the cost-attribution control renders each of its three states", async () => {
  const { CostAttribution } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");

  // Rendered directly, not through the screen. Inside the row it lives behind `expanded`, which
  // only a click opens — a static render of the screen never reaches it, so asserting on the
  // screen would have been a test that passes without touching the code it names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (value: string | null) =>
    renderToStaticMarkup(React.createElement(CostAttribution as any, { value, onChange: () => {} }));

  for (const value of ["direct_taxed", "mixed", "direct_exempt", null]) {
    const html = render(value);
    assert.match(html, /Waarvoor is deze kost/, `${value ?? "null"}: the question is asked`);
    // All three choices are always offered — the control is how you CHANGE the answer, so hiding
    // the others would leave an owner who mis-tapped with no way back.
    assert.match(html, /Belast werk/, `${value ?? "null"}: the taxed choice is offered`);
    assert.match(html, /Allebei/, `${value ?? "null"}: the mixed choice is offered`);
    assert.match(html, /Vrijgesteld werk/, `${value ?? "null"}: the exempt choice is offered`);
  }

  // The case that matters most: null is what EVERY existing invoice looks like the day the
  // migration runs, and it must show the default the aangifte is already applying to it — not an
  // empty control that reads as an unanswered question.
  assert.match(render(null), /naar verhouding/, "an unclassified cost explains the pro-rata default");
  assert.equal(render(null), render("mixed"), "null and 'mixed' are the same state, shown the same");
  // A value from a future migration must not blank the control or drop the explanation.
  assert.match(render("something_else"), /naar verhouding/, "an unknown value falls back to mixed");

  assert.match(render("direct_taxed"), /volledig aftrekbaar/, "the taxed state says the BTW is fully deductible");
  assert.match(render("direct_exempt"), /geen recht op aftrek/, "the exempt state says there is no deduction");
});

test("[VRIJGESTELD] the pay screen is unchanged for an owner without exempt turnover", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const rows = [manageRow({ id: "energie", client_name: "Energie", invoice_number: "E-9" })];
  const render = (profile: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingManageClient as any, {
          profile, initialInvoices: rows, totalCount: rows.length, readFailed: [], filedQuarters: [],
        }))),
    );

  // The 99%: the screen still renders with the new branch compiled into it, and nothing about the
  // exemption reaches them — not when the column is absent, and not when they answered no.
  assert.ok(render({ id: "u1" }).length > 1000, "the ordinary screen is still substantial");
  assert.doesNotMatch(render({ id: "u1" }), /Waarvoor is deze kost/, "an ordinary owner is never asked");
  assert.doesNotMatch(render({ id: "u1", vat_exempt_activity: false }), /Waarvoor is deze kost/);
});

test("[SCAN-WHOLE-BOOK] the banner counts the whole book, and names what is out of reach", async () => {
  // The failure this guards is a bounded read presented as a complete answer. The pay screen loads
  // every OPEN invoice but only the 200 most recent PAID ones — and a wrongly booked invoice that
  // has since been paid went into the aangifte just as wrong. So the count comes from the server,
  // over the owner's whole history, and anything it found that is not on this screen is said out
  // loud rather than quietly dropped from a worklist that cannot reach it.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { scanInvoices } = await import("../../src/lib/invoice-scan");

  // One broken invoice IS on the screen; two more exist only in the server scan.
  const onScreen = manageRow({ id: "math", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46 });
  const bookScan = scanInvoices([
    { id: "math", invoice_number: "2033161", client_name: "Groothandel", invoice_date: "2026-02-21", invoice_type: "factuur", total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46 },
    { id: "old1", invoice_number: "OLD1", client_name: "Oud", invoice_date: "2025-05-02", invoice_type: "factuur", total_ex_btw: 100, btw_amount: 52, total_inc_btw: 152 },
    { id: "old2", invoice_number: "OLD2", client_name: "Oud", invoice_date: "2025-05-09", invoice_type: "factuur", total_ex_btw: 200, btw_amount: 9, total_inc_btw: 250 },
  ]);
  assert.equal(bookScan.total, 3, "the fixture really does hold three findings");

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: [onScreen], totalCount: 1,
        readFailed: [], filedQuarters: [], bookScan,
      }))),
  );

  // [RUST] The banner sits behind one collapsed line now. Two things had to survive that, and they
  // are what this test pins instead of the full sentences.
  //
  // FIRST: the COUNT stays on screen with no tap, and it is still the whole book's. That is the
  // failure this test was written for — a bounded read presented as a complete answer — and it
  // would come straight back if the collapsed line counted only the rows it can see.
  assert.match(html, /3 kloppen niet/, "the collapsed line carries the whole book's count");
  assert.doesNotMatch(html, /1 klopt niet/, "…and never the count of just this list");

  // SECOND: the caveat and the worklist button are behind the SAME toggle. That is the property
  // that replaces "always visible": an owner cannot reach a worklist which misses two findings
  // without being shown, in the same breath, that it misses them. Asserted together on purpose —
  // a change that let one of the two out without the other is the actual danger here.
  assert.doesNotMatch(html, /2 ervan staan niet in deze lijst/, "the caveat is behind the toggle");
  assert.doesNotMatch(html, /Toon alleen deze/, "…and so is the worklist button it qualifies");
});

test("[RENDER-GATE] the pay screen renders when the read failed, and says so", async () => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // [NO-SILENT-EMPTY] The path that matters most on this screen: no rows AND a failed read. It must
  // never render as "you owe nobody anything". Rendering it here also proves the empty-list branches
  // are reachable — they are the ones no manual test ever visits.
  //
  // This case is NOT a substitute for the one above, and the difference was measured: with the TDZ
  // bug reintroduced, the test above fails and THIS ONE STILL PASSES. `[].filter(cb)` never calls
  // cb, so an empty list walks straight past a crash that every real list hits. A render gate is
  // only as good as the rows it is handed.
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" },
        initialInvoices: [],
        totalCount: null,
        readFailed: ["openstaande inkoopfacturen"],
        filedQuarters: null,
      }))),
  );

  assert.ok(html.length > 500, "the screen still renders when the read failed");
  // The empty state must not assert that the list is complete.
  assert.doesNotMatch(html, /Geen inkoopfacturen<\/p>\s*<p[^>]*>Je hebt/, "no completeness claim after a failed read");
});

test("[RENDER-GATE] the verify queue renders", async () => {
  const { default: IncomingInvoicesClient } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  // health comes from the real classifier rather than a hand-built literal: a shape invented here
  // would keep passing after the classifier changed, which is the opposite of a gate.
  const queueRow = (over: Record<string, unknown> = {}) => {
    const base = {
      id: "q1", client_name: "Groothandel", client_email: null, invoice_type: "factuur",
      total_ex_btw: 985.87, btw_amount: 88.73, total_inc_btw: 1078.46, amount_paid: 0,
      invoice_date: "2026-02-21", invoice_number: "2033161", source: "email",
      pdf_url: null, document_id: null, created_at: "2026-02-21T10:00:00Z",
      folder_id: null, folder_name: null, field_confidence: null, ...over,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...base, health: classifyImportHealth(base as any) };
  };

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          // A broken breakdown and a clean one, so both the warning and the calm path render.
          initialInvoices: [queueRow(), queueRow({ id: "q2", invoice_number: "RE2", total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872 })],
          ignoredInvoices: [],
          confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper",
          // [READING-MEMORY] Keyed the way the server keys it: trimmed, lowercased.
          readingHints: { groothandel: "Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra." },
        }))),
  );

  assert.ok(html.length > 1000, "the queue rendered something substantial");
  // The list is here, and both suppliers reached it.
  assert.match(html, /Groothandel/);

  // [AANSLAG] A tax letter carries a badge naming the tax and where it books; a supplier that
  // merely has "belasting" in its name does not.
  const withLetter = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          initialInvoices: [
            queueRow({ id: "t1", client_name: "Belastingdienst", tax_kind: "inkomstenbelasting", total_ex_btw: 1200, btw_amount: 0, total_inc_btw: 1200, invoice_number: "A1" }),
            queueRow({ id: "t2", client_name: "Belastingdienst", tax_kind: null, total_ex_btw: 80, btw_amount: 0, total_inc_btw: 80, invoice_number: "A2" }),
            queueRow({ id: "t3", client_name: "Belastingadviseur Jansen", total_ex_btw: 400, btw_amount: 84, total_inc_btw: 484, invoice_number: "A3" }),
          ],
          ignoredInvoices: [], confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper", readingHints: {},
        }))),
  );
  assert.match(withLetter, /Aanslag inkomstenbelasting — privé, geen kost/, "the kind is named on the row");
  assert.match(withLetter, /Brief Belastingdienst — niet in de kosten/, "an unnamed tax-office letter is still badged");
  assert.equal((withLetter.match(/geen kost|niet in de kosten/g) ?? []).length, 2, "the adviser gets no badge");
});

test("[RENDER-GATE] the verify queue does not report an unread queue as finished", async () => {
  const { default: IncomingInvoicesClient } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // [NO-SILENT-EMPTY] The state that had no witness: no rows AND a failed read. The server's
  // `.catch(() => null)` is right — the page must still render — but `?? []` downstream made the
  // failure indistinguishable from success, and this screen's empty state is the sentence "Alles
  // verwerkt". On the ONLY surface where a 'processing' invoice can be confirmed, that tells the
  // owner every incoming invoice has been checked and passed on to the books.
  const render = (readFailed: string[]) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          initialInvoices: [], ignoredInvoices: [], confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper", readFailed,
        }))),
  );

  const failed = render(["controlewachtrij"]);
  assert.ok(failed.length > 500, "the screen still renders when the read failed");
  assert.doesNotMatch(failed, /Alles verwerkt/, "an unread queue is never reported as a finished one");
  assert.match(failed, /We konden je controlewachtrij niet ophalen/, "and it names the list it could not read");
  assert.match(failed, /Deze lijst is daardoor niet compleet/);

  // The other half, and without it the fix could be "never say it at all": a genuinely empty queue
  // that read fine still says so, because that IS the good news the owner comes here for.
  const clean = render([]);
  assert.match(clean, /Alles verwerkt/, "an empty queue that read fine still reports itself finished");
  assert.doesNotMatch(clean, /niet compleet/, "and claims nothing about a failure that did not happen");
});

test("[READING-MEMORY] the supplier memory reaches the open card", async () => {
  // Against the CARD, not the list. Every card in the list renders collapsed — the expanded body is
  // behind a click, and a static render never clicks — so a list-level assertion on this text can
  // only ever fail. That is not a reason to assert nothing: the prop being dropped somewhere between
  // the server and the card is exactly the failure this covers, and it is invisible to tsc because
  // an optional prop that never arrives is perfectly typed.
  const { InvoiceCard } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  // A CLEAN invoice on purpose. The memory must show where the reader is confident and wrong —
  // Elegance Brands read cleanly twice and was wrong both times — so if this only rendered next to
  // an existing warning it would be silent on the invoices it exists for.
  const base = {
    id: "q1", client_name: "Elegance Brands", client_email: null, invoice_type: "factuur",
    total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, amount_paid: 0,
    invoice_date: "2026-07-30", invoice_number: "2026070769", source: "email",
    pdf_url: null, document_id: null, created_at: "2026-07-30T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };
  assert.equal(invoice.health.level, "clean", "the fixture really is an invoice the app is happy with");

  const render = (hint: string | null) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoiceCard as any, {
          invoice, mode: "pending", expanded: true,
          onToggle() {}, onConfirmPaid() {}, onEdit() {}, onIgnore() {}, onRestore() {},
          readingHint: hint,
        }))),
  );

  const withHint = render("Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra.");
  assert.match(withHint, /Wat je hier vaker corrigeert/, "the heading is on the open card");
  assert.match(withHint, /meestal het btw-bedrag/, "and it names the field the owner keeps fixing");

  // Same card, no memory: the block is gone entirely, not an empty box with a heading.
  const without = render(null);
  assert.doesNotMatch(without, /Wat je hier vaker corrigeert/);
});

/**
 * The rest of the money line.
 *
 * These screens fetch their own data in an effect, so they take few props or none, and a static
 * render shows their loading state. That is much shallower than the two above — and still worth
 * having, because the bug this file was built for lived in the COMPONENT BODY, which runs in full
 * on every render regardless of what the effects would later fetch. Every derived const, every
 * useMemo, every `rows.filter(...)` over the initial empty state executes here.
 *
 * What it does NOT cover, stated rather than implied: the branches that only exist once data has
 * arrived. Handing these screens real rows would mean reaching into their internal state, which a
 * render gate cannot do. The two screens above take their data as props and are therefore tested
 * properly; these are covered against "it does not even start".
 */
const SELF_LOADING_SCREENS: Array<{
  name: string;
  path: string;
  props: Record<string, unknown>;
  /**
   * [MIN-REGEL] How much markup counts as "it rendered". 200 for every screen whose first render
   * is a real shell; lower only where the first render is honestly one line, and then with the
   * text it must contain, so the entry cannot pass on emptiness. See the edit screen below.
   */
  minChars?: number;
  mustContain?: string;
}> = [
  { name: "facturen (verkoopfacturen)", path: "../../src/app/dashboard/facturen/FacturenClient", props: { profile: { id: "u1" } } },
  { name: "bank", path: "../../src/app/dashboard/bank/BankClient", props: {} },
  { name: "kas", path: "../../src/app/dashboard/kas/KasClient", props: {} },
  { name: "aangifte", path: "../../src/app/dashboard/aangifte/AangifteClient", props: {} },
  // The second wave. Same reasoning, same shallow-but-real coverage — every one of these was
  // probed before it was wired, and none of them was broken. This buys protection against the next
  // change; it did not repair anything outstanding.
  { name: "dagomzet (kassa-omzet)", path: "../../src/app/dashboard/dagomzet/DagomzetImportClient", props: {} },
  { name: "waarheid", path: "../../src/app/dashboard/waarheid/WaarheidClient", props: {} },
  { name: "klaar (kwartaal-gereedheid)", path: "../../src/app/dashboard/klaar/KlaarClient", props: {} },
  // A client PAGE rather than a client component — it reads its id from useParams, which the mock
  // at the top of this file supplies.
  { name: "invoice detail", path: "../../src/app/dashboard/invoice/[id]/page", props: {} },
  // [VRIJGESTELD] The invoice form, which now builds its BTW-tarief dropdown from the owner's
  // profile. Added for the reason at the top of this file: the other five gates compile this
  // component without ever calling it. It renders in full here (~13k of markup, rate select
  // included), so a throw anywhere in the form body is caught.
  { name: "invoice form (nieuwe factuur)", path: "../../src/app/dashboard/invoice/new/page", props: {} },
  // [MIN-REGEL] The OTHER invoice form. The builder above was on this list and the edit screen was
  // not, which is the shape of the defect that put it here: a rule was added to one of the two and
  // the other kept refusing what the first had just started allowing. Same useParams mock as the
  // invoice detail entry.
  //
  // Its first render is `if (loading) return <p>Laden...</p>` — 120 characters, so the shared
  // threshold would fail it while the component body ran perfectly. What this entry proves is
  // exactly that: the body executes without throwing, up to the loading return. It says nothing
  // about the form below it, which needs an invoice this gate cannot fetch. Stated, not implied.
  {
    name: "invoice form (factuur bewerken)",
    path: "../../src/app/dashboard/invoice/[id]/edit/page",
    props: {},
    minChars: 60,
    mustContain: "Laden",
  },
];

// [BETALINGSVERSCHIL] dashboard/zzp/DailyTruth is deliberately NOT on the list above, for exactly
// the reason /dashboard/settings is not (see limit 2 below). It was tried: its first render is
// `if (loading) return <div style={{ height: 148 }} />` — a bare skeleton with no text at all, so
// it fails the "rendered something" assertion outright rather than passing hollowly. Either way
// the entry would say nothing about the screen.
//
// Its new branch — the payment-difference notice under "Te ontvangen" — is covered where the
// decision actually lives: paymentDifferenceNote and detectPaymentDifferences in
// payment-difference.test.ts, including that the sentence never claims to have written anything
// off. That is the split this file's own header argues for: render gates catch a screen that
// cannot start, and pure tests catch a screen that says the wrong thing.

/**
 * [VRIJGESTELD] Two limits of the line above, stated rather than left to be discovered:
 *
 *  1. The "Vrijgesteld" option itself is NOT exercised. It is gated on profile.vat_exempt_activity,
 *     and the form loads its profile in an effect — effects never run under renderToStaticMarkup,
 *     so `profile` is null here and the option is correctly absent. What this gate proves is that
 *     the form still renders with the new branch in it, not that the branch renders.
 *  2. /dashboard/settings is deliberately NOT on the list, even though the exemption declaration
 *     lives there. Its entire body sits behind a `loading` flag that only an effect can clear, so
 *     one render returns a 123-character "Laden..." and nothing else. Listing it would add a test
 *     that passes without ever reaching the code it claims to cover — the precise false green this
 *     file exists to prevent.
 *
 * Both are the same structural boundary: this gate calls components, it does not run their
 * effects. The exemption logic that MATTERS is pure and is tested where it lives —
 * vat-exemption.test.ts (26 cases) and financial-result.test.ts.
 */

/**
 * Not on the list, and stated rather than left to be noticed: /dashboard/resultaat and
 * /dashboard/quarterly are async SERVER components. They await a Supabase client and a session
 * before they render anything, so renderToStaticMarkup cannot call them without a database and a
 * logged-in user — which is the thing this gate exists to avoid needing. quarterly's actual
 * content is the client component QuarterlyOverview, and that one IS covered below.
 */

for (const screen of SELF_LOADING_SCREENS) {
  test(`[RENDER-GATE] ${screen.name} renders`, async () => {
    const mod = await import(screen.path);
    const { ToastProvider } = await import("../../src/components/ui/Toast");
    const { DialogProvider } = await import("../../src/components/ui/Dialog");
    const html = renderToStaticMarkup(
      React.createElement(DialogProvider, null,
        React.createElement(ToastProvider, null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          React.createElement(mod.default as any, screen.props))),
    );
    assert.ok(html.length > (screen.minChars ?? 200), `${screen.name} rendered something`);
    // A lowered threshold must come with the words that justify it, or it lowers to nothing.
    if (screen.mustContain) {
      assert.ok(
        html.includes(screen.mustContain),
        `${screen.name} rendered ${html.length} characters without "${screen.mustContain}" in them`,
      );
    }
  });
}

test("[RENDER-GATE] the quarter overview renders, for both roles", async () => {
  // The screen that says whether a quarter is ready to file. Its page wrapper is a server component,
  // so the client component is the reachable half — and it branches hard on the role: an accountant
  // sees a client list, a zzp'er sees their own quarter. Two renders, because a crash in one branch
  // is invisible from the other.
  const { QuarterlyOverview } = await import("../../src/components/quarterly/QuarterlyOverview");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  for (const isAccountant of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(DialogProvider, null,
        React.createElement(ToastProvider, null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          React.createElement(QuarterlyOverview as any, { isAccountant, role: isAccountant ? "accountant" : "zzper" }))),
    );
    assert.ok(html.length > 200, `the ${isAccountant ? "accountant" : "zzp"} branch rendered`);
  }
});

test("[RENDER-GATE] the accountant bridge renders a tree with money on it", async () => {
  // Takes its data as props, so unlike the self-loading screens above this one gets real nodes —
  // and the lesson from the bug that started this file applies directly: an empty array never calls
  // the callbacks that do the work, so the branches would go unvisited.
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const node = (over: Record<string, unknown> = {}) => ({
    source: "invoice", id: "n1", displayName: "RE0801378", path: ["2026", "Q1", "Voldaan"],
    date: "2026-03-12", amount: 871.4, badges: [], pdfUrl: null, hidden: false, clientId: null,
    ownerId: "u1", partyName: "Groothandel", direction: "incoming", hasLocation: true,
    folderId: null, docId: null, ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(BrugClient as any, {
          nodes: [
            node(),
            // A credit note: negative, and badged as such.
            node({ id: "n2", displayName: "CN9", amount: -109, badges: [{ label: "Creditnota", tone: "info" }] }),
            // An outgoing invoice, a hidden (archived) row, and a document with no amount at all.
            node({ id: "n3", displayName: "2026-001", direction: "outgoing", amount: 1210 }),
            node({ id: "n4", displayName: "Oud", hidden: true }),
            node({ id: "n5", source: "document", displayName: "bankafschrift.pdf", amount: null, partyName: null, direction: null, docId: "d1" }),
          ],
          role: "zzper",
          docStatus: { d1: { status: "verwerkt", vraag_text: null } },
          readFailed: [],
        }))),
  );
  assert.ok(html.length > 500, "the bridge rendered its tree");
});

test("[RENDER-GATE] the accountant bridge says when a read failed", async () => {
  // [NO-SILENT-EMPTY] An empty tree plus a failed read must never render as "there is nothing here".
  const { default: BrugClient } = await import("../../src/app/dashboard/brug/BrugClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(BrugClient as any, { nodes: [], role: "zzper", docStatus: {}, readFailed: ["facturen"] }))),
  );
  assert.ok(html.length > 200, "it still renders when the read failed");
});

test("[RENDER-GATE] Vandaag renders the lists it is famous for getting wrong", async () => {
  // The money dashboard: what is due, what is overdue, what is partly paid. It takes its rows as
  // props, so unlike the four above this one can be handed the cases that actually branch.
  const { default: VandaagClient } = await import("../../src/app/dashboard/vandaag/VandaagClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  // [HAND-DUBBEL] Dit scherm boekt sinds vandaag zelf een betaling af, en het moet dus kunnen
  // VRAGEN voordat het een tweede exemplaar van een al betaald factuurnummer afboekt. Daarvoor
  // gebruikt het useDialog, dat buiten zijn provider gooit — precies wat deze poort ving. De app
  // hangt hem in de root layout, dus zo hoort dit scherm ook hier te worden gemonteerd.
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const inv = (over: Record<string, unknown> = {}) => ({
    id: "v1", client_name: "Groothandel", invoice_number: "RE1", invoice_date: "2026-03-01",
    due_date: "2026-03-31", total_inc_btw: 872, amount_paid: 0, status: "received",
    direction: "incoming", ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(VandaagClient as any, {
        payable: [
          inv(),
          // Partly paid: the remaining amount is the one that must show, not the invoice total.
          inv({ id: "v2", amount_paid: 400 }),
          // Long overdue.
          inv({ id: "v3", due_date: "2025-11-01" }),
          // A credit note from a supplier: negative, and must not read as a debt.
          inv({ id: "v4", total_inc_btw: -109, invoice_number: "CN1" }),
          // No due date at all — the [DATELESS-TASK] case.
          inv({ id: "v5", due_date: null }),
        ],
        remind: [inv({ id: "o1", direction: "outgoing", status: "overdue", due_date: "2026-01-15" })],
        // [CREDIT-TERUG] A creditnota against a paid invoice: money the owner owes, with the amount
        // the pure rule decided — and a standalone one, flagged, so both row branches are reached.
        refunds: [
          { id: "cr1", invoiceNumber: "CR-2026-01", invoiceDate: "2026-08-01", clientName: "Bakkerij Jansen", amount: 121, standalone: false },
          { id: "cr2", invoiceNumber: "CR-2026-02", invoiceDate: "2026-08-02", clientName: "Slagerij de Vries", amount: 50, standalone: true },
        ],
        loadFailed: false,
        toVerifyCount: 3,
        datelessPayableCount: 1,
      }))),
  );
  assert.ok(html.length > 500, "Vandaag rendered its lists");

  // [CREDIT-TERUG] The refund section, with the amount the rule handed it — not a total it
  // recomputed — and the flag on the creditnota that had no invoice to compare with.
  assert.ok(html.includes("Terug te betalen aan je klant"), "the refund section must render");
  assert.ok(html.includes("€ 121,00") && html.includes("Bakkerij Jansen"), "…with the amount that has to go back");
  assert.ok(html.includes("Factuur buiten BoekBrug"), "…and the standalone creditnota flagged");
  assert.ok(html.includes("2 creditnota"), "…and counted");

  // [PARTIAL-PAY] Not just "it rendered" — the number it rendered. v2 is EUR 872 with EUR 400 paid,
  // so the amount on the card is the EUR 472 that is still owed. Showing the invoice total there
  // tells an owner to pay money they already paid, and this list is the one they work from.
  assert.ok(html.includes("€ 472,00"), "the partly-paid card must show what is still OPEN");
  assert.ok(
    html.includes("deels betaald") && html.includes("€ 872,00"),
    "…with the full total named beside it, so the smaller number is never a mystery",
  );
});

test("[KAS-DUBBELE-KOST] the double-cost panel renders every branch it has", async () => {
  // A panel whose rows arrive from a fetch renders EMPTY in every gate that exists — tsc, eslint
  // and next build never call a component, and the Kas screen needs a session the smoke test never
  // has. So the branch that formats money would be reached for the first time on an owner's
  // screen. Handed real rows here, exactly as [RENDER-GATE] in AGENTS.md asks.
  const { DoubleCostNotice } = await import("../../src/app/dashboard/kas/KasClient");
  const { translator } = await import("../../src/lib/i18n/t");
  const t = translator("nl");

  const row = (over: Record<string, unknown> = {}) => ({
    entryId: "k1", entryDate: "2026-05-12", entryAmount: 121, entryDescription: "Enka Horeca contant",
    invoiceId: "f1", invoiceNumber: "26701681", supplier: "Enka Horeca B.V.",
    basis: "gross" as const, daysApart: 0, nameMatched: true, drawerDoubled: false,
    doubleCountedCost: 100, doubleCountedBtw: 0, ...over,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (rows: any[], unknown = false) =>
    renderToStaticMarkup(React.createElement(DoubleCostNotice as any, { rows, unknown, t }));

  // Nothing found and nothing failed: the panel must be ABSENT, not an empty amber box.
  assert.equal(render([]), "", "a clean quarter shows no panel at all");

  // [NO-SILENT-EMPTY] Could not look ≠ nothing there. On this screen an absent warning is the only
  // signal the books are clean, so a failed check has to say so.
  const cannot = render([], true).replace(/[\u00a0\u202f]/g, " ");
  assert.ok(cannot.includes("konden niet nakijken"), "a failed check says so instead of nothing");

  // The ordinary pair: a hand-typed line and the invoice it duplicates.
  const one = render([row()]).replace(/[\u00a0\u202f]/g, " ");
  assert.ok(one.includes("26701681") && one.includes("Enka Horeca B.V."), "it names the invoice and the supplier");
  assert.ok(one.includes("€ 121,00"), "…the amount that left the till");
  assert.ok(one.includes("€ 100,00"), "…and the ex-BTW cost that is deducted twice");
  assert.ok(one.includes("/dashboard/invoice/f1"), "…with a way to look at the invoice");
  // A bare typed line claims no BTW of its own, so that half must be absent — not "€ 0,00".
  assert.ok(!one.includes("btw dubbel"), "no btw sentence when no btw was doubled");
  assert.ok(!one.includes("kassaldo"), "no drawer sentence when the drawer moved once");

  // The expensive shape: a bon + a rate (btw claimed twice) AND the invoice settled in cash too
  // (the drawer down twice). Both extra sentences must appear, with their own amounts.
  const worst = render([row({ doubleCountedBtw: 21, drawerDoubled: true })]).replace(/[\u00a0\u202f]/g, " ");
  assert.ok(worst.includes("€ 21,00"), "the doubled btw is named");
  assert.ok(worst.includes("kassaldo") && worst.includes("€ 121,00"), "…and the drawer that stands too low");

  // Two pairs render as two rows, and a partial answer still says it was partial.
  const two = render([row(), row({ entryId: "k2", invoiceId: "f2", invoiceNumber: "26701999" })], true);
  assert.ok(two.includes("26701681") && two.includes("26701999"), "both pairs are shown");
  assert.ok(two.includes("konden niet nakijken"), "…and the caveat rides UNDER them, not instead of them");

  // A row with nothing readable must still render rather than throw — the rows come from a DB.
  const bare = render([row({ invoiceNumber: null, supplier: null, entryDate: null, entryAmount: null })]);
  assert.ok(bare.length > 100, "a row with null columns still renders");

  // [GEEN-STILLE-CAP] A shop that types every cash purchase by hand is exactly the shop this is
  // for, and a seeded busy quarter produced 366 pairs. Three hundred amber rows are a wall, not a
  // warning — but a panel that silently shows ten of them reads as "there are ten".
  const many = render(Array.from({ length: 25 }, (_, i) =>
    row({ entryId: `k${i}`, invoiceId: `f${i}`, invoiceNumber: `AP${i}` })));
  const shown = (many.match(/\/dashboard\/invoice\//g) ?? []).length;
  assert.equal(shown, 10, "the list stops at ten rows");
  assert.ok(many.includes("nog 15 andere kasregels"), "…and says out loud how many it did not list");
  assert.ok(!render([row()]).includes("andere kasregels"), "no remainder line when nothing was dropped");
});

test("[RENDER-GATE] the sales overview renders", async () => {
  const { default: VerkoopClient } = await import("../../src/app/dashboard/verkoop/VerkoopClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const f = (over: Record<string, unknown> = {}) => ({
    id: "s1", invoice_number: "2026-001", client_name: "Klant", client_email: "k@example.com",
    invoice_date: "2026-03-01", due_date: "2026-03-31", total_inc_btw: 1210, amount_paid: 0,
    status: "sent", ...over,
  });

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(VerkoopClient as any, {
        // One of every state stateOf() can return, so no branch of the status colouring is unvisited.
        facturen: [
          f(),
          f({ id: "s2", status: "draft" }),
          f({ id: "s3", status: "paid", amount_paid: 1210 }),
          f({ id: "s4", status: "sent", due_date: "2025-12-01", reminder_count: 3, last_reminder_at: "2026-01-05T10:00:00Z" }),
          f({ id: "s5", status: "sent", amount_paid: 500 }),
          // [DEEL-CREDIT] A EUR 500 invoice, overdue, with EUR 50 credited against it…
          f({ id: "s6", invoice_number: "2026-014", status: "sent", total_inc_btw: 500, due_date: "2026-03-01" }),
          // …and the creditnota that did it. Both rows are handed over on purpose: the defect was
          // invisible against a list without them, which is exactly how it survived.
          f({ id: "s7", invoice_number: "C2026-003", invoice_type: "creditnota", total_inc_btw: -50,
              status: "sent", due_date: "2026-03-01" }),
        ],
        bedrijf: "Mijn Zaak",
        gecrediteerd: { s6: 50 },
        // Server time, passed in rather than read here — the component's own header says why.
        nu: Date.parse("2026-03-15T12:00:00Z"),
        // [MEDEWERKER] Zijn eigen profiel, voor de kop van dit bord. Die kop draagt de bel waarin
        // "je factuur is NIET verstuurd" aankomt en de enige uitlogknop die deze gebruiker heeft —
        // zie MedewerkerHeader. Meegeven, niet weglaten: het scherm moet er hier mét kop worden
        // gerenderd, want dat is wat de gebruiker ziet.
        profiel: { id: "u1", full_name: "Sam Verkoop", company_name: null, email: "sam@example.com", role: "zzper" },
      })),
  );
  assert.ok(html.length > 500, "the sales overview rendered its list");

  // [MEDEWERKER] De kop hoort erbij, en dat is geen cosmetiek: zonder haar heeft deze gebruiker
  // geen bel (waarin "je factuur is niet verstuurd" aankomt) en geen uitlogknop — op wat vaak een
  // gedeelde baliecomputer is.
  assert.ok(html.includes("BoekBrug"), "the sales board renders its header");

  // Intl puts a NARROW NO-BREAK SPACE after the euro sign, so a literal " " never matches an
  // amount. Normalised here rather than pasted into the assertions, where an invisible character
  // is the difference between a gate and a gate-shaped hole.
  const text = html.replace(/[\u00a0\u202f]/g, " ");

  // [CREDITNOTA-NO-CHASE] The creditnota is labelled as one. Before this it carried a red
  // "te laat", directly above the sentence saying a creditnota is not a receivable — a screen
  // contradicting itself about the only thing it is there to say.
  assert.ok(/€ 50,00<\/div><div[^>]*>creditnota</.test(text.replace(/[\u00a0\u202f]/g, " ")),
    "the creditnota is badged as a creditnota, not as a late invoice");

  // [DEEL-CREDIT] …and the invoice it corrects shows the REST. The reminder e-mail has always
  // named EUR 450; this screen named EUR 500, and the customer holds the paper for the difference.
  assert.ok(text.includes("te laat · nog € 450,00"), "the partly credited invoice shows what is still owed");
  assert.ok(!text.includes("nog € 500,00"), "…never the amount before the credit");

  // The totals at the top obey the same two rules. EUR 1.210 (s4) + EUR 450 (s6) = EUR 1.660 late,
  // and the EUR 50 creditnota is in neither the sum nor the count — it used to be in both.
  assert.ok(text.includes("€ 1.660,00"), "the 'te laat' total nets the credit and skips the creditnota");
  assert.ok(text.includes("2 facturen — hier kun je vandaag iets aan doen"),
    "…and two invoices are late, not three");
});

test("[READING-MEMORY] a supplier with no history renders the queue exactly as before", async () => {
  // The prop is optional and, for most owners, empty — nobody has a supplier past the threshold on
  // day one. The absence has to be SILENT: no empty box, no heading with nothing under it. Rendered
  // rather than reasoned about, because "it is falsy so it will not show" is the kind of claim that
  // is true right up until someone wraps it in a container div.
  const { default: IncomingInvoicesClient } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "q1", client_name: "Groothandel", client_email: null, invoice_type: "factuur",
    total_ex_btw: 800, btw_amount: 72, total_inc_btw: 872, amount_paid: 0,
    invoice_date: "2026-02-21", invoice_number: "RE1", source: "email",
    pdf_url: null, document_id: null, created_at: "2026-02-21T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = [{ ...base, health: classifyImportHealth(base as any) }];

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // No readingHints prop at all — the shape an older server render sends.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingInvoicesClient as any, {
          initialInvoices: rows, ignoredInvoices: [], confirmedInvoices: [],
          connectionStatus: { connected: false, provider: null, email: null, connected_at: null, needs_reauth: false, pending_count: 0 },
          userRole: "zzper",
        }))),
  );

  assert.ok(html.length > 1000, "the queue still renders without the prop");
  assert.doesNotMatch(html, /Wat je hier vaker corrigeert/, "no heading without a hint under it");
});

test("[ENABLEBANKING] the bank-connection panel renders in each of its states", async () => {
  // This panel is only ever reached behind a login, so the smoke test never opens it and the
  // static gates never call it. It also branches on FOUR things at once — configured, connected,
  // expiring, rate-limited — and three of those branches are the ones an owner meets on a bad
  // day, i.e. exactly when a white screen is least affordable.
  const { default: BankConnectPanel } = await import("../../src/app/dashboard/bank/BankConnectPanel");

  const account = (over: Record<string, unknown> = {}) => ({
    id: "acc-1", iban: "NL02ABNA0123456789", ownerName: "Jansen Bouw", currency: "EUR",
    status: "READY", lastSyncedAt: "2026-07-31T05:00:00Z", lastSyncedThrough: "2026-07-31",
    lastError: null, ...over,
  });
  const connection = (over: Record<string, unknown> = {}) => ({
    id: "c1", institutionName: "ING", institutionBic: "INGBNL2A", status: "linked",
    connectedAt: "2026-05-03T10:00:00Z", lastSyncedAt: "2026-07-31T05:00:00Z", lastError: null,
    accessValidUntil: "2026-08-01", daysUntilExpiry: 60, canSyncNow: true,
    accounts: [account()], ...over,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (state: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderToStaticMarkup(React.createElement(BankConnectPanel as any, { initialState: state }));

  // An unconfigured server hides the card entirely rather than offering a dead button.
  assert.equal(render({ configured: false, connections: [] }), "");

  const empty = render({ configured: true, connections: [] });
  assert.match(empty, /Koppel je bank/);

  const linked = render({ configured: true, connections: [connection()] });
  assert.match(linked, /ING/);
  assert.match(linked, /NL02ABNA0123456789/);
  assert.match(linked, /Vernieuwen/);

  // The two states that MUST still render, because they are what the owner sees when the feed
  // has stopped working — and a crash here would hide the very message telling him to reconnect.
  const expiring = render({ configured: true, connections: [connection({ daysUntilExpiry: 3 })] });
  assert.match(expiring, /verloopt over 3 dagen/);

  const expired = render({
    configured: true,
    connections: [connection({ status: "expired", daysUntilExpiry: -2 })],
  });
  assert.match(expired, /Opnieuw koppelen/);

  // Rate-limited: the refresh button has to be visibly disabled, not silently inert.
  const spent = render({ configured: true, connections: [connection({ canSyncNow: false })] });
  assert.match(spent, /disabled/);

  // A connection with no accounts yet (consent given, details still processing) must not throw
  // on the empty list — the branch a first-day owner hits.
  const bare = render({
    configured: true,
    connections: [connection({ accounts: [], status: "pending", daysUntilExpiry: null })],
  });
  assert.ok(bare.length > 100, "a pending connection still renders");
});

test("[FULL-CORRECTION] the shared correction editor renders, and shows the supplier memory", async () => {
  // ONE editor, opened from the pay screen and from /bank. It is rendered here directly because on
  // both screens it lives behind a click, and a static render never clicks — the same reason
  // InvoiceCard is exported. What matters is that every field the accountant reads is on it.
  const { default: InvoiceCorrectionModal } = await import("../../src/components/invoice/InvoiceCorrectionModal");
  // [SUPPLETIE] The provider stack src/app/layout.tsx mounts around every screen. This editor now
  // reaches for useDialog() — a correction that moves an already-filed quarter is acknowledged, not
  // faded — and a render test without the provider is rendering a tree the app never renders.
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceCorrectionModal as any, {
      invoice: {
        id: "inv-1", invoice_number: "26302050", client_name: "ATAPACK Cash & Carry B.V.",
        invoice_date: "2026-03-27", invoice_type: "factuur",
        total_ex_btw: 6112.66, btw_amount: 550.14, total_inc_btw: 6662.8,
      },
      readingHint: "Bij deze leverancier heb je 3 eerdere facturen zelf gecorrigeerd — meestal het btw-bedrag. Controleer dat hier extra.",
      onClose() {}, onSaved() {}, onMessage() {},
    })),
  );

  // The money fields, and the ones that carry no money and still decide where the invoice lands.
  assert.match(html, /Totaal \(incl\. BTW\)/);
  assert.match(html, /Factuurnummer/, "the number the duplicate gate and bank matcher key on");
  assert.match(html, /Leverancier/, "the name the supplier memory groups by");
  assert.match(html, /Factuurdatum/, "the date that picks the BTW quarter");
  // It opens on the invoice's CURRENT values — an editor that opens empty invites a retype, and a
  // retyped correct figure is how a correct figure becomes a typo.
  assert.match(html, /26302050/);
  assert.match(html, /ATAPACK Cash &amp; Carry B\.V\./);
  // [KOMMA-INVOER] The amounts render the way a Dutch owner writes them — comma decimal, in a
  // TEXT field (a number input refuses that comma on the browsers that decide per locale; the
  // NemaFood btw of 95,54 could not be typed at all). The stored 6662.8 must appear as 6662,8.
  assert.match(html, /value="6662,8"/);
  assert.match(html, /value="550,14"/);
  assert.doesNotMatch(html, /type="number"/, "a number input is back — the Dutch comma is untypeable there");
  assert.match(html, /inputMode="decimal"/, "the money fields lost the decimal keyboard hint");
  // [READING-MEMORY] travels with the editor, so it reaches /bank too.
  assert.match(html, /meestal het btw-bedrag/);
  // [KIND-CORRECTION] the one-way declaration, with the sentence that now describes what it does.
  assert.match(html, /Dit is een creditnota/);
  assert.match(html, /als minbedrag opgeslagen/);
});

test("[FULL-CORRECTION] a credit note is not offered the creditnota tick again", async () => {
  // The declaration is one-way ('factuur' → 'creditnota'). Offering it on a row that already IS one
  // would suggest a reverse that must never exist: it would quietly turn a credit into a debt.
  const { default: InvoiceCorrectionModal } = await import("../../src/components/invoice/InvoiceCorrectionModal");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceCorrectionModal as any, {
      invoice: {
        id: "cn-1", invoice_number: "CN9", client_name: "Sweets", invoice_date: "2026-02-17",
        invoice_type: "creditnota", total_ex_btw: -100, btw_amount: -9, total_inc_btw: -109,
      },
      onClose() {}, onSaved() {}, onMessage() {},
    })),
  );
  assert.doesNotMatch(html, /Dit is een creditnota/);
  assert.match(html, /-109/, "and it still opens on the stored negative amounts");
});

// ─── [CREDIT-SAFE] A suspected credit note is not dunned, and its badge is reachable ──────────
// CREDITFACTUUR CR0301267 from Dutch Sweets: printed "Totaal bedrag (EUR) : € -33,87", stored
// +33,87, badged "⚠ Lijkt een creditnota" — and beside that badge sat "2 dagen te laat", a
// "Heb je betaald?" button and a filled-in payment QR for € 33,87 to the supplier's IBAN.
//
// Two renders, because one proves nothing. The first shows the dunning is gone; the second shows
// it is gone BECAUSE of the credit signal and not because the fixture stopped being overdue.

const sweetsRows = (creditNumber: string) => [
  // Overdue by any clock: due 2026-04-11, and these tests run later than that.
  manageRow({
    id: "cr", client_name: "Dutch Sweets", invoice_number: creditNumber,
    total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
    invoice_date: "2026-07-02", due_date: "2026-08-01",
  }),
  // The contrast the signal needs — paid, so it cannot contribute a dunning badge of its own.
  manageRow({
    id: "re", client_name: "Dutch Sweets", invoice_number: "RE0802039",
    status: "paid", amount_paid: 740.47, total_ex_btw: 679.33, btw_amount: 61.14,
    total_inc_btw: 740.47, payment_date: "2026-05-01",
  }),
];

const renderManage = async (rows: unknown[]) => {
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  return renderToStaticMarkup(
    React.createElement(DialogProvider, null, React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IncomingManageClient as any, {
        profile: { id: "u1" }, initialInvoices: rows, totalCount: rows.length,
        readFailed: [], filedQuarters: [],
      }))),
  );
};

test("[CREDIT-SAFE] a suspected credit note loses its dunning badge and gains a tappable one", async () => {
  const html = await renderManage(sweetsRows("CR0301267"));

  assert.match(html, /Lijkt een creditnota/, "the signal still fires on the real case");
  assert.doesNotMatch(html, /te laat/, "money the supplier owes you is never late");
  // On a phone there is no hover, so a title attribute was the whole explanation and none of it was
  // reachable. The badge has to be something you can press.
  assert.match(
    html, /<button[^>]*>⚠ Lijkt een creditnota<\/button>/,
    "the warning badge is a button, not a tooltip nobody can open",
  );
});

test("[CREDIT-SAFE] the same overdue row IS dunned once it stops looking like a credit note", async () => {
  // Same fixture, same dates, only the number changes: RE… carries no credit prefix, so the signal
  // stays quiet and the row is an ordinary late bill again. Without this second render the first
  // one would also pass on a screen that had simply stopped dunning anything.
  const html = await renderManage(sweetsRows("RE0803119"));

  assert.doesNotMatch(html, /Lijkt een creditnota/, "no credit prefix, no signal");
  assert.match(html, /te laat/, "an ordinary overdue invoice must still say so");
});

// ─── [INTAKE-QUEUE] The button that is on nearly every screen ─────────────────
// This component gained state in the queue change — a counter, a ref, and a new summary sheet — and
// it renders on almost every dashboard surface. A bad hook order or a reference before declaration
// would not break one screen, it would white-page most of them, and the source-level gates in
// bundle-weight-gates.test.ts cannot see that: they read imports and shapes, never a render.
//
// This does not test the queue. Behaviour under three concurrent uploads needs a real device, and
// that is stated rather than pretended: renderToStaticMarkup never runs an effect and never fires a
// click. What it proves is the thing the other gates structurally cannot — that the component still
// RUNS, in each of its placements.

test("[RENDER-GATE] the intake button renders in every placement it is used in", async () => {
  const { default: IntakeButton } = await import("../../src/components/intake/IntakeButton");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  // The placements the app actually mounts it in. An unknown one is included on purpose: the prop
  // is a union today, and a component that throws on an unexpected value would take the page with
  // it rather than degrade.
  for (const placement of ["fab", "card", "inline", undefined]) {
    const html = renderToStaticMarkup(
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IntakeButton as any, { placement })),
    );
    assert.ok(html.length > 0, `placement ${String(placement)} rendered nothing at all`);
  }
});

test("[INTAKE-QUEUE] the idle button invites a capture and claims no work in progress", async () => {
  // The counter starts at zero, so the resting copy must be the invitation — not "1 wordt gelezen".
  // If inFlight ever initialised wrong, every screen carrying this button would greet the owner
  // with a progress line about an upload that does not exist.
  const { default: IntakeButton } = await import("../../src/components/intake/IntakeButton");
  const { ToastProvider } = await import("../../src/components/ui/Toast");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(IntakeButton as any, { placement: "card" })),
  );
  assert.match(html, /Maak een foto of upload/, "the resting state must invite a capture");
  assert.doesNotMatch(html, /wordt gelezen/, "an idle button must not claim something is processing");
});

test("[BLAD-EEN-SCROLLER] the two ways out of the sheet are not behind the document", async () => {
  // Reported from a phone. The sheet body scrolls; the document frame inside it is 58vh of embedded
  // PDF viewer, and an embedded viewer eats the scroll gesture the moment the finger is over it. So
  // the owner scrolled past our reading and past the checks, reached the paper — and stopped, with
  // "Klopt niet — corrigeren" and "Open in nieuw tabblad" below a wall they could not scroll past.
  //
  // The two ways out of a sheet are chrome. Their reachability may not depend on how tall the
  // document happens to be, so they now sit OUTSIDE the scrolling body.
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");
  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d9", client_name: "BALKIP B.V.", invoice_number: "264091", invoice_date: "2026-08-13",
        invoice_type: "factuur", total_ex_btw: 1123.62, btw_amount: 101.13, total_inc_btw: 1224.75,
        vendor_iban: "NL48INGB0000810658", field_confidence: null, vendorNumbers: [],
      },
      onClose() {}, onCorrect() {},
    }),
  );

  // The scrolling body is the flex child that can actually shrink. Without min-height:0 a flex item
  // refuses to go below its content, `overflow-y:auto` never engages, and the panel grows past its
  // own maxHeight instead of scrolling — the bug underneath the bug.
  assert.match(html, /flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain/,
    "exactly one scroller, and it is sized to scroll");
  // …and the panel itself no longer scrolls, or two nested `auto` scrollers compete for one gesture.
  //
  // Asserted on the CLASS, not on an inline style. This branch fixed it inline (92dvh + hidden) and
  // main fixed it in `.sheet-frame` in the same hour; the class is the right half, because an
  // inline limit silently outranks the MEASURED 88dvh the class carries. So the property to hold
  // here is "this panel wears the frame and sets no limit of its own" — the frame's own rules are
  // held in globals.css by the [BLAD-SCROLL] gate.
  assert.match(html, /class="sheet-frame"/, "the panel HOLDS a scroller, it is not one");
  const paneel = html.slice(html.indexOf('class="sheet-frame"'), html.indexOf('class="sheet-frame"') + 600);
  assert.doesNotMatch(paneel.slice(0, paneel.indexOf('">') + 2), /max-height/,
    "no inline limit beside the class — inline wins, and the measured number would lose");

  // The actions come AFTER the scrolling body CLOSES — matched on the real tag, not on an index
  // comparison. The first version compared offsets and passed with the actions still inside the
  // scroller, because a closing </div> sits before them either way. Walk the tree instead.
  const bodyStart = html.indexOf("<div", html.indexOf("flex:1;min-height:0;overflow-y:auto") - 200);
  assert.ok(bodyStart >= 0, "the scrolling body is in the markup");
  let depth = 0;
  let i = bodyStart;
  let bodyEnd = -1;
  for (; i < html.length; i++) {
    if (html.startsWith("<div", i)) depth++;
    else if (html.startsWith("</div>", i)) {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  assert.ok(bodyEnd > bodyStart, "the scrolling body is a balanced element");
  const scroller = html.slice(bodyStart, bodyEnd);
  assert.doesNotMatch(scroller, /Klopt niet/,
    "the actions may not live inside the scroller — that is the whole defect");
  assert.doesNotMatch(scroller, /nieuw tabblad/i);
  // …and they ARE on screen, after it. A fix that simply deleted them would satisfy the line above.
  assert.match(html.slice(bodyEnd), /Klopt niet/, "…and they are still rendered, after it");
  // The document frame stays inside the scroller, where it belongs.
  if (html.includes("<iframe")) {
    assert.match(scroller, /<iframe/, "the paper still scrolls with the rest of the body");
  }
});

test("[DOC-INLINE] the document sheet shows the paper, our numbers AND what was checked", async () => {
  // The sheet exists to make verifying cheap. All three parts have to be on screen at once — the
  // document alone is what the old window.open already gave, and it is not what made checking
  // expensive. What was missing is our reading beside it, and the checks stated instead of implied.
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");

  const clean = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d1", client_name: "Oz&er food", invoice_number: "26035350", invoice_date: "2026-06-24",
        invoice_type: "factuur", total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06,
        vendor_iban: "NL65RABO0171136276", field_confidence: null, vendorNumbers: [],
      },
      onClose() {}, onCorrect() {},
    }),
  );
  assert.match(clean, /Wat wij hebben gelezen/, "our reading is on screen next to the paper");
  assert.match(clean, /26035350/, "…with the number the owner is about to compare");
  assert.match(clean, /281,06/, "…and the total, formatted the Dutch way");
  // Nine since [LEVERANCIER-ID]: the IBAN checksum joined the list, and this fixture prints an
  // account number. Asserted on the RENDERED count rather than a literal 8, so the panel and the
  // pure list can never drift apart about how many checks the owner is being promised.
  // Nine since [LEVERANCIER-ID]. [CONTROLES-INKLAPPEN] then folded the settled rows away, so the
  // promise moved from nine printed lines to one sentence and a button that says how many are
  // behind it. Both numbers are still read from the RENDER, so the panel and the pure list cannot
  // drift apart about how many checks the owner is being promised.
  assert.match(clean, /Alle 9 controles gedaan/, "a clean invoice says what was checked instead of nothing");
  assert.match(clean, /toon alle 9/, "…and the nine are one tap away, with the count on the button");
  assert.match(clean, /aria-expanded="false"/, "collapsed by default — nine green ticks is a wall, not an answer");
  // The rows themselves are NOT printed while everything is settled. This assertion used to be the
  // opposite ("including the checksum row itself"), and that was the decision this change reverses:
  // the panel answers "why should I not look myself?", and it answered by making the owner look at
  // everything. Reachability is what matters, and the button above carries it.
  assert.doesNotMatch(clean, /Rekeningnummer klopt als IBAN/, "a settled row is printed anyway");
  assert.doesNotMatch(clean, /9% over het hele bedrag/, "…and so is its detail line");
  assert.match(clean, /Klopt niet — corrigeren/, "and the fix is one tap from the doubt");

  // The half that must never be cosmetic: a check that could not run says so, and the summary
  // stops claiming completeness. A green list that overstates is worse than no list.
  const unsure = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d2", client_name: "Oz&er food", invoice_number: "26035350", invoice_date: "2026-06-24",
        invoice_type: "factuur", total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06,
        vendor_iban: "NL65RABO0171136276", vendorNumbers: [],
        field_confidence: { _safecore: { iban_check_unavailable: true } },
      },
      onClose() {}, onCorrect: null,
    }),
  );
  assert.doesNotMatch(unsure, /Alle \d+ controles gedaan/, "a skipped check breaks the completeness claim");
  assert.match(unsure, /konden we niet nagaan/, "and it is said, not merely left quieter");

  // [BTW-SPLIT] The invoice this whole axis exists for, on the screen it lied on: Enka Horeca
  // 26701681, whose three amounts agree with each other and are € 0,46 wrong. Nothing else on this
  // sheet can tell — so the one row that CAN say "we did not check this" has to actually reach the
  // markup, greyed and worded, and the summary line above it has to stop claiming completeness.
  const mixed = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d3", client_name: "Enka Horeca B.V.", invoice_number: "26701681",
        invoice_date: "2026-01-30", invoice_type: "factuur",
        total_ex_btw: 1213.5, btw_amount: 122.18, total_inc_btw: 1335.68,
        vendor_iban: "NL65RABO0171136276", field_confidence: null, vendorNumbers: [],
      },
      onClose() {}, onCorrect() {},
    }),
  );
  assert.doesNotMatch(mixed, /Alle \d+ controles gedaan/, "seven green ticks over a wrong btw is the bug");
  assert.match(mixed, /mengt btw-tarieven/, "the reason the btw could not be verified is on screen");
  assert.match(mixed, /btw-specificatie/, "and it says where to look on the paper");

  // The colour is read before the sentence. Green over "1 konden we niet nagaan" says stop-looking
  // while the words say keep-looking, and at a glance the colour wins — the same overstatement in
  // a different medium. #137333 is the green reserved for a genuinely complete list.
  const summaryColour = (html: string) => /font-weight:700;color:(#[0-9A-Fa-f]{6})[^"]*">[^<]*controles/.exec(html)?.[1];
  assert.equal(summaryColour(clean), "#137333", "a complete list earns the green");
  assert.notEqual(summaryColour(mixed), "#137333", "an incomplete one must not wear it");
  assert.notEqual(summaryColour(unsure), "#137333");
});

test("[RENDER-GATE] factureren namens een klant renders, and says whose invoice it is", async () => {
  const { default: AccountantFactuur } = await import("../../src/modules/accountant/pages/AccountantFactuur");

  // With a mandate. Two clients, so the picker branch runs — one client auto-selects and would
  // skip the very code path that decides which name goes on the invoice.
  const html = renderToStaticMarkup(
    React.createElement(AccountantFactuur, {
      klanten: [
        { id: "c1", naam: "Bakkerij Yilmaz", btwNummer: "NL001234567B01" },
        { id: "c2", naam: "Loodgieter De Vries", btwNummer: null },
      ],
    }),
  );
  assert.match(html, /Factureren namens een klant/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…with the clients who granted a mandate");
  // Art. 35: the number series belongs to the client, and the screen has to say so before the
  // accountant presses a button that consumes one of their numbers.
  assert.match(html, /art\. 35 Wet OB/, "the irreversibility of an issued number is stated");

  // Without a mandate the screen must NOT look broken or empty — it has to name the one thing that
  // is missing and who can fix it, because the accountant cannot fix it himself.
  const leeg = renderToStaticMarkup(React.createElement(AccountantFactuur, { klanten: [] }));
  assert.match(leeg, /Nog geen enkele klant heeft je hiervoor gemachtigd/, "the empty state explains itself");
  assert.match(leeg, /Instellingen/, "…and points at where the CLIENT turns it on");
  assert.match(leeg, /35a/, "…and says the responsibility stays with the entrepreneur");
});

test("[ARTIKELEN-WIPE] the empty-the-catalogue action exists, and only when there is something to empty", async () => {
  // A destructive action on a screen full of rows: the render gate is where "it is on the page at
  // all" is held, since the manage screen's own gates cannot see this one.
  const { default: ArtikelenClient } = await import("../../src/app/dashboard/artikelen/ArtikelenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // Effects never run under renderToStaticMarkup, so the list starts empty and loading — which is
  // exactly the state that must NOT offer to delete everything.
  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ArtikelenClient as any, {}))),
  );
  assert.ok(html.length > 200, "the screen rendered");
  assert.doesNotMatch(
    html, /artikelen verwijderen/,
    "with nothing loaded there is nothing to empty — offering it would be a destructive button " +
      "over an unknown list",
  );
});

test("[CHECKLIST] the verify queue shows the checks too — it is where the invoice enters the books", async () => {
  // The pay screen got this first, and it is the SECOND-most important place for it. The queue is
  // where the owner decides to confirm an invoice INTO the books, which is the moment "what did we
  // check, and what could we not check" is worth anything at all.
  const { InvoiceCard } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "q9", client_name: "Oz&er food", client_email: null, invoice_type: "factuur",
    total_ex_btw: 257.85, btw_amount: 23.21, total_inc_btw: 281.06, amount_paid: 0,
    invoice_date: "2026-06-24", invoice_number: "26035350", source: "upload",
    pdf_url: "u1/x.pdf", document_id: null, created_at: "2026-06-24T10:00:00Z",
    folder_id: null, folder_name: null, field_confidence: null,
    vendor_iban: "NL65RABO0171136276",
    // [REREAD-CONFIRMED] What page.tsx now selects, and what reimportDecision reads. Left out, the
    // predicate answers "no" and the re-read offer silently never renders — which is exactly the
    // failure it exists to prevent, so the fixture has to carry them.
    direction: "incoming", status: "processing", accountant_status: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoiceCard as any, {
          invoice, mode: "pending", expanded: true,
          onToggle() {}, onConfirmPaid() {}, onEdit() {}, onIgnore() {}, onRestore() {},
        }))),
  );

  // The entry point. Its label has to promise both halves, because the checks are the reason to
  // open it — the document alone is what the old window.open already gave.
  assert.match(html, /Bekijk factuur en controles/, "the queue offers the document AND the checks");
  // And the old behaviour must be gone: handing the file to the operating system loses the queue
  // position, which on this screen means losing your place in the verification you were doing.
  assert.doesNotMatch(html, /Bekijk factuur<\/button>/, "the OS hand-off label is gone");

  // [REREAD-CONFIRMED] This invoice is CLEAN — classifyImportHealth finds nothing, so the amber
  // "Even controleren" block that used to hold the only "Opnieuw inlezen" button never renders.
  // That is the case the owner hit: told to press it, nothing to press. The offer has to be here
  // on a spotless card, with the sentence that says what it is for.
  assert.match(html, /Opnieuw inlezen/, "a clean invoice can be re-read too — that is where a misread amount hides");
  assert.match(html, /Klopt er iets niet/, "and the owner is told what the button is for");
});

test("[WAAROM-WACHT] a spotless card that still waits says why, and a flagged one does not say it twice", async () => {
  // Dit is de kaart waar het om gaat: classifyImportHealth vindt niets, het scherm zet er een
  // groen "klaar om te bevestigen" boven — en tóch staat hij te wachten. Met field_confidence:
  // null (elke rij van vóór deze meting) blijft dat onzichtbaar, dus de fixture draagt de reden.
  const { InvoiceCard } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const maak = (fc: Record<string, unknown> | null, over: Record<string, unknown> = {}) => {
    const base = {
      id: "w1", client_name: "Hano Groothandel", client_email: null, invoice_type: "factuur",
      total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, amount_paid: 0,
      invoice_date: "2026-08-20", invoice_number: "F-9001", source: "upload",
      pdf_url: "u1/x.pdf", document_id: null, created_at: "2026-08-20T10:00:00Z",
      folder_id: null, folder_name: null, field_confidence: fc,
      direction: "incoming", status: "processing", accountant_status: null, ...over,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...base, health: classifyImportHealth(base as any) };
  };
  const teken = (invoice: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(InvoiceCard as any, {
          invoice, mode: "pending", expanded: true,
          onToggle() {}, onConfirmPaid() {}, onEdit() {}, onIgnore() {}, onRestore() {},
        }))),
  );

  // 1. De schone kaart mét vastgelegde reden: de zin staat er, en het is een ZIN.
  const wacht = teken(maak({ _auto_hold: { at: "2026-08-20T10:00:01Z", reason: "no_reliable_total" } }));
  assert.match(wacht, /Waarom wacht deze op jou/, "the card must say why it is still here");
  assert.match(wacht, /Er is geen betrouwbaar totaalbedrag gelezen/);
  assert.doesNotMatch(wacht, /no_reliable_total/,
    "the machine tag may never reach the owner — it is the thing the sentence replaces");

  // 2. De eigen schakelaar noemt de schakelaar zoals hij op het instellingenscherm staat.
  const keuze = teken(maak({ _auto_hold: { at: "x", reason: "owner_reviews_everything" } }));
  assert.match(keuze, /Duidelijke facturen automatisch inboeken/,
    "an owner who forgot they flipped the switch has no other way to find out");

  // 3. Niets vastgelegd (elke oude rij) ⇒ geen regel, geen gok.
  assert.doesNotMatch(teken(maak(null)), /Waarom wacht deze op jou/);

  // 4. En een kaart die het al uitlegt, legt het niet twee keer uit. Deze rekent niet op: de
  //    amberen "Even controleren" staat er al, dus de tweede uitleg hoort te zwijgen.
  const gemarkeerd = teken(maak(
    { _auto_hold: { at: "x", reason: "no_reliable_total" } },
    { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 999 },
  ));
  assert.match(gemarkeerd, /Even controleren/, "the flagged card keeps its own amber panel");
  assert.doesNotMatch(gemarkeerd, /Waarom wacht deze op jou/,
    "two explanations of one delay is how a calm screen becomes a nagging one");
});

test("[WAAROM-WACHT-BANK] a line with no invoice says WHICH of the four things is going on", async () => {
  // Het tabblad had één alinea voor álle regels. Deze test bestaat om te bewijzen dat de vier
  // gevallen verschillende zinnen krijgen — met één regel als invoer klopt elke implementatie.
  const { TxCard } = await import("../../src/app/dashboard/bank/BankClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const teken = (over: Record<string, unknown>) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(TxCard as any, {
          s: {
            transactionId: "t1", date: "2026-08-20", amount: -450.5, description: "SEPA Overboeking",
            counterpart: "Hano Groothandel B.V.", reference: "26702781", outcome: "none",
            best: null, candidates: [], ...over,
          },
          selectedInvoiceId: undefined, processing: false, isIgnoredTab: false,
          confirmedNumbers: [], batchEligible: false, batchChecked: false,
          onBatchToggle() {}, onSelect() {}, onConfirm() {}, onAttach() {}, onIgnore() {},
          onRestore() {}, onOpenFile() {}, onCorrect() {},
        }))),
  );

  // 1. De duurste regel op dit scherm: de factuur ligt nog in een la.
  const ontbreekt = teken({ waitReason: "reference_not_in_administration" });
  assert.match(ontbreekt, /factuurnummer dat niet in je administratie staat/);
  assert.doesNotMatch(ontbreekt, /reference_not_in_administration/,
    "the machine tag may never reach the owner");

  // 2. Een ander geval krijgt een ANDERE zin — anders zegt het paneel niets nieuws.
  const kiezen = teken({ waitReason: "several_invoices_this_amount" });
  assert.match(kiezen, /meerdere facturen open met precies dit bedrag/);
  assert.notEqual(
    kiezen.includes("factuurnummer dat niet in je administratie staat"), true,
    "the four reasons must not collapse back into one paragraph",
  );

  // 3. Niets te zeggen ⇒ niets gezegd. Geen verzonnen uitleg op een geldscherm.
  assert.doesNotMatch(teken({ waitReason: null }), /Deze tegenpartij komt niet voor/);

  // 4. En naast een somsuggestie zwijgt hij: die IS al een uitleg, met een knop eronder.
  const som = teken({
    waitReason: "several_invoices_this_amount",
    sumMatch: { invoiceIds: ["a", "b"], invoiceNumbers: ["A1", "B1"], total: 450.5, amounts: [200.5, 250] },
  });
  assert.doesNotMatch(som, /meerdere facturen open met precies dit bedrag/,
    "two explanations of one line is how a calm screen becomes a nagging one");
});

test("[RENDER-GATE] the debtor board renders, and stays honest about what it cannot do", async () => {
  const { default: AccountantDebiteuren } = await import("../../src/modules/accountant/pages/AccountantDebiteuren");
  const { buildDebtorBoard } = await import("../../src/lib/accountant-debtors");

  const NOW = Date.parse("2026-08-04T12:00:00Z");
  const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
  const inv = (over: Record<string, unknown> = {}) => ({
    ownerId: "k1", id: "f1", invoice_number: "2026-001", client_name: "Afnemer BV",
    client_email: "afnemer@example.com", invoice_date: day(-40), due_date: day(-30),
    total_inc_btw: 500, amount_paid: 0, status: "sent", last_reminder_at: null,
    reminder_count: 0, ...over,
  });

  // Rows that exercise the BRANCHES — an empty list would render the same for any bug in them.
  const groepen = buildDebtorBoard(
    [
      inv({ id: "kan" }),                                            // the button path
      inv({ id: "geen-mail", client_email: null }),                  // refused: no address
      inv({ id: "stil", reminders_paused: true }),                   // refused: the owner said no
      inv({ id: "oud", due_date: day(-200), total_inc_btw: 120 }),   // the months-late wording
      inv({ id: "deel", total_inc_btw: 500, amount_paid: 180 }),     // a partial payment
    ] as never,
    { k1: "Bakkerij Yilmaz" },
    NOW,
  ).map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, paused: false })) }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen }));
  assert.match(html, /Openstaande facturen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…grouped by the client whose money it is");
  assert.match(html, /6 maanden te laat/, "…and the oldest debt is named in months, not raw days");
  // The half that must never be cosmetic: a row that cannot be mailed says WHY. A grey button with
  // no sentence teaches the accountant to stop reading the screen.
  assert.match(html, /Deze klant heeft geen e-mailadres/, "the refusal is spelled out");
  assert.match(html, /stilgezet/, "including the owner's own 'not this one'");
  // And the ceiling that is a decision rather than a next tap.
  assert.match(html, /art\. 6:96 BW/, "what comes after three reminders is not a button");

  // Nothing overdue is a different sentence from no mandate — a board that says "geen mandaat"
  // when everything is simply paid would send the accountant chasing a permission they have.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [] }));
  assert.match(leeg, /Niets te laat/, "all paid says so");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geen = renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [], geenMandaat: true }));
  assert.match(geen, /Nog geen enkele klant heeft je gemachtigd/, "no mandate says something else");
  assert.match(geen, /Instellingen/, "…and points at where the CLIENT turns it on");
});

test("[RENDER-GATE] stukken opvragen renders, and refuses to promise completeness", async () => {
  const { default: AccountantOpvragen } = await import("../../src/modules/accountant/pages/AccountantOpvragen");

  const props = {
    klanten: [{ id: "k1", naam: "Bakkerij Yilmaz" }, { id: "k2", naam: "Loodgieter De Vries" }],
    kwartalen: [
      { year: 2026, quarter: 2, label: "Q2 2026" },
      { year: 2026, quarter: 1, label: "Q1 2026" },
    ],
  };

  // Effects never run under renderToStaticMarkup, so the readiness fetch never fires — which is
  // the pre-selection state, and the one a bug in the picker would show first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantOpvragen as any, props));
  assert.match(html, /Stukken opvragen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…with the linked clients");
  assert.match(html, /Q2 2026/, "…and the quarters to pick from");

  // No linked clients is a different sentence from no gaps — one sends the accountant to the
  // invite screen, the other to a phone call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantOpvragen as any, { ...props, klanten: [] }));
  assert.match(leeg, /nog geen gekoppelde klanten/, "the empty state names the actual blocker");
  assert.match(leeg, /Klanten beheren/, "…and where to fix it");
});

test("[RENDER-GATE] the request text the client receives never claims the quarter is complete", async () => {
  // The pure builder is what BOTH the preview and the server use, so asserting it here covers the
  // sentence the client actually reads. readiness.ts cannot see a receipt that was never uploaded;
  // a request implying "then we are done" breaks at exactly the wrong moment.
  const { buildDocumentRequest } = await import("../../src/lib/document-request");
  const r = buildDocumentRequest({
    items: [{ title: "3 bankregels zonder bon", detail: "€ 412 aan kosten" }],
    quarterLabel: "Q2 2026",
    accountantName: "Administratiekantoor De Wit",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /wat er niet in staat, kan ik ook niet zien/);
    assert.doesNotMatch(r.text, /compleet|volledig/i);
  }
});

test("[RENDER-GATE] the confirm queue renders, and never hides what the reader was unsure about", async () => {
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");

  const rij = (over: Record<string, unknown> = {}) => ({
    id: "i1", clientId: "k1", clientNaam: "Bakkerij Yilmaz", leverancier: "Groothandel Bos",
    factuurnummer: "RE0801378", datum: "2026-06-24", totaalInc: 871.4, btw: 71.95,
    twijfels: [] as string[], ...over,
  });

  // Rows that exercise the branches — a clean one, one the reader was unsure about, and one with
  // nothing filled in at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, {
    rijen: [
      rij(),
      rij({ id: "i2", twijfels: ["het bedrag", "de datum"] }),
      rij({ id: "i3", leverancier: "", factuurnummer: null, datum: null, totaalInc: null, btw: null }),
    ],
  }));
  assert.match(html, /Bevestigen/, "the screen renders at all");
  assert.match(html, /Bakkerij Yilmaz/, "…saying whose books these are, on every row");
  assert.match(html, /871,40/, "…with the amount formatted the Dutch way");
  // The half that must never become decoration: a doubt is shown BEFORE the button, in words.
  // A confirm button above a hidden doubt turns the accountant into a rubber stamp.
  assert.match(html, /Dit konden wij niet zeker lezen: het bedrag · de datum/);
  // And the sentence that keeps the liability where the law puts it (art. 52 AWR).
  assert.match(html, /art\. 52 AWR/, "the responsibility is named on the screen, not only in the terms");
  // [FACTUURVRAAG] The alternative to confirming is one tap away — and it is now a QUESTION about
  // this invoice, not a link away to a quarter-level screen for missing documents that carried
  // neither the invoice nor the client.
  assert.match(html, /Klopt niet — vraag stellen/, "the alternative to confirming is one tap away");
  assert.doesNotMatch(
    html, /href="\/dashboard\/accountant\/opvragen"/,
    "the row's alternative navigates away again, carrying nothing about the invoice in front of it",
  );

  // No mandate is a different sentence from an empty queue — one sends the accountant to their
  // client, the other means there is genuinely nothing to do.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geen = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true }));
  assert.match(geen, /Nog geen enkele klant heeft je gemachtigd/);
  assert.match(geen, /andere machtiging dan die om te factureren/, "and it says the two are separate");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leeg = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [] }));
  assert.match(leeg, /Er staat niets te wachten/);

  // [NO-SILENT-EMPTY] And a THIRD empty state, which used to be rendered as one of the other two.
  // A failed read on the links gave `geenMandaat` — so the accountant read that nobody had
  // authorised them, over clients who had, and went to ask for a permission that was already
  // granted. A failed read on the invoices gave the empty queue — so they read that there was
  // nothing to confirm, while purchase invoices sat holding a quarter shut. Both sentences are
  // untrue and neither is recognisable as a guess, which is why this one names what it is NOT.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stuk = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], leesfout: true }));
  assert.match(stuk, /konden je stapel nu niet lezen/, "a failed read does not say so");
  assert.match(stuk, /betekent niet dat er niets wacht/, "…and does not deny that work is waiting");
  assert.match(stuk, /betekent niet dat je geen machtiging hebt/, "…or that the mandate is missing");
  // It must WIN over both other empty states — a page that passes leesfout has nothing true to say
  // about mandates or about the queue, so it may say neither.
  assert.doesNotMatch(stuk, /Nog geen enkele klant heeft je gemachtigd/, "it still claims there is no mandate");
  assert.doesNotMatch(stuk, /Er staat niets te wachten/, "it still claims the queue is empty");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stukMandaat = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], leesfout: true, geenMandaat: true }));
  assert.match(stukMandaat, /konden je stapel nu niet lezen/, "geenMandaat overrides the read failure again");

  // The 500-row cap says so instead of presenting itself as the whole pile: a count that is
  // silently truncated is not a missing number, it is a wrong one, and the accountant plans a
  // week on it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const veel = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [rij()], meer: 412 }));
  assert.match(veel, /oudste 500/, "the cap no longer names itself");
  assert.match(veel, /412/, "…nor how many are not on the screen");
});

test("[VRAAG-MACHTIGING] the empty states offer a way OUT of themselves", async () => {
  // The gap this closes: four screens waited on a permission and none of them could ask for one.
  // Their empty states said "your client turns it on in Settings" — instructions for a phone call
  // that has to happen outside the app. A feature that only starts after a phone call does not
  // start. So every one of those empty states now carries the ask, right under the explanation.
  const { default: AccountantFactuur } = await import("../../src/modules/accountant/pages/AccountantFactuur");
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");
  const { default: AccountantDebiteuren } = await import("../../src/modules/accountant/pages/AccountantDebiteuren");

  const gekoppeld = [{ id: "k1", naam: "Bakkerij Yilmaz" }, { id: "k2", naam: "Loodgieter De Vries" }];

  const schermen: Array<[string, string]> = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["factuur", renderToStaticMarkup(React.createElement(AccountantFactuur as any, { klanten: [], gekoppeld }))],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["bevestigen", renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true, gekoppeld }))],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["debiteuren", renderToStaticMarkup(React.createElement(AccountantDebiteuren as any, { groepen: [], geenMandaat: true, gekoppeld }))],
  ];

  for (const [naam, html] of schermen) {
    assert.match(html, /Vraag toestemming/, `${naam}: the ask is on the screen`);
    assert.match(html, /Bakkerij Yilmaz/, `${naam}: …with the linked clients to ask`);
    // It asks; it never grants. The client decides on their own screen — an accountant who could
    // grant themselves is the hole accountant_clients_insert_consent.sql closed.
    assert.match(html, /Beslissen doet hij zelf/, `${naam}: and says who decides`);
  }
});

test("[VRAAG-MACHTIGING] with no linked clients at all, the ask stays hidden", async () => {
  // Nothing to ask, and a picker with an empty dropdown is worse than no picker: it looks broken
  // rather than not-yet-applicable. The screen's own explanation already names the real blocker.
  const { default: AccountantBevestigen } = await import("../../src/modules/accountant/pages/AccountantBevestigen");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantBevestigen as any, { rijen: [], geenMandaat: true, gekoppeld: [] }));
  assert.doesNotMatch(html, /Vraag toestemming/);
  assert.match(html, /Nog geen enkele klant heeft je gemachtigd/, "the explanation is still there");
});

// ─────────────────────────────────────────────────────────────────────────────
// [WERKVOORRAAD] De boekhoudershome — het scherm dat vier tegels een getal geeft
//
// Dit is de eerste pagina die een boekhouder opent, en tot vandaag stond er op de vier
// werktegels niets. De regel die dat oplost rekent met bedragen en dagen, en die twee
// dingen zijn precies wat er in een lege lijst niet gebeurt: hand hem nul rijen en elke
// tak blijft ongemoeid. Dus wordt hij hier met ECHTE standen gerenderd — met mandaat en
// zonder, met werk en zonder — want de nul-zonder-mandaat en de nul-zonder-werk zijn twee
// verschillende zinnen en het scherm hoort ze allebei te kunnen uitspreken.
// ─────────────────────────────────────────────────────────────────────────────

const homeProfile = {
  id: "acc-1", full_name: "Sanne de Vries", company_name: "De Vries Administratie",
  email: "sanne@devries.nl", role: "accountant",
};
const homeOverview = { total_clients: 3, clients_with_open_questions: 1, clients_missing_bank: 0 };
const homeClients = [
  { id: "c1", full_name: "Jan Jansen", company_name: "Jansen Bouw", email: "jan@jansenbouw.nl" },
  { id: "c2", full_name: "Piet Pieters", company_name: null, email: "piet@example.nl" },
];

test("[WERKVOORRAAD] de home toont de werkvoorraad als getallen, niet als tegels zonder tekst", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(AccountantHome as any, {
      profile: homeProfile,
      overview: homeOverview,
      workQueues: {
        toConfirm: 12, overdueCount: 3, overdueTotal: 4231.55, worstDaysLate: 74,
        mandatedForInvoices: 2, mandatedForConfirm: 2, complete: true,
      },
      clients: homeClients,
      todos: [],
      notifications: [],
      unreadMessages: 0,
    }),
  );

  assert.ok(html.length > 500, "de home rendert");
  assert.match(html, /Wat er op jou ligt/);
  // Het getal zelf moet er staan — een tegel met alleen een label is precies wat hier weg moest.
  assert.match(html, />12</, "de stapel die een kwartaal tegenhoudt staat er als getal");
  assert.match(html, /4\.232|4\.231/, "het te late bedrag staat er in Nederlandse notatie");
  assert.match(html, /oudste 74 dagen/, "hoe oud de oudste schuld is, want dat is het echte signaal");
  assert.match(html, /3 facturen/);
});

test("[WERKVOORRAAD] nul-omdat-niets en nul-omdat-geen-machtiging zijn twee verschillende zinnen", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // Wél gemachtigd, niets te doen. Dit is een gerustheid en hoort zo te lezen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rustig = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 2, mandatedForConfirm: 2, complete: true,
    },
  }));
  assert.match(rustig, /Niets houdt een kwartaal tegen/);
  assert.match(rustig, /Niets te laat/);
  assert.doesNotMatch(rustig, /machtigde je hiervoor/, "wie gemachtigd is hoort daar niet over te lezen");

  // Gekoppeld maar niet gemachtigd voor bevestigen. Dezelfde nul, een heel ander bericht:
  // hier is niets te zien omdat je niets mág, en dat is oplosbaar — via /vraag-machtiging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const halfMandaat = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 1, overdueTotal: 250, worstDaysLate: 5,
      mandatedForInvoices: 1, mandatedForConfirm: 0, complete: true,
    },
  }));
  assert.match(halfMandaat, /Nog niemand machtigde je hiervoor/);
  assert.doesNotMatch(halfMandaat, /Niets houdt een kwartaal tegen/,
    "een nul zonder machtiging mag NOOIT als 'alles is in orde' lezen");
});

test("[WERKVOORRAAD] een onbekende stand toont geen geruststellende nul", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // complete=false betekent: een van de reads faalde. Nul is dan geen feit maar een gebrek aan
  // feiten, en een werkbord dat dat als "niets te doen" toont, liegt op de plek waar het niet mag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onbekend = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 2, mandatedForConfirm: 2, complete: false,
    },
  }));
  assert.ok(onbekend.length > 500, "de home rendert nog steeds");
  assert.doesNotMatch(onbekend, /Wat er op jou ligt/, "liever geen regel dan een onware regel");

  // En zonder de prop erbij — de home is ouder dan deze regel en hoort ook zo te openen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zonder = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
  }));
  assert.ok(zonder.length > 500);
  assert.doesNotMatch(zonder, /Wat er op jou ligt/);
});

test("[WERKVOORRAAD] een boekhouder zonder enige machtiging krijgt geen leeg werkbord te zien", async () => {
  const { default: AccountantHome } = await import("../../src/modules/accountant/pages/AccountantHome");

  // Nieuwe boekhouder: klanten gekoppeld, nog niets gemachtigd. Twee blokken met nul erin zeggen
  // hem niets — de weg naar een machtiging loopt via de schermen zelf, waar de knop staat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(AccountantHome as any, {
    profile: homeProfile, overview: homeOverview, clients: homeClients, todos: [],
    notifications: [], unreadMessages: 0,
    workQueues: {
      toConfirm: 0, overdueCount: 0, overdueTotal: 0, worstDaysLate: 0,
      mandatedForInvoices: 0, mandatedForConfirm: 0, complete: true,
    },
  }));
  assert.ok(html.length > 500);
  assert.doesNotMatch(html, /Wat er op jou ligt/);
  // De tegels naar die schermen blijven wél staan — daar staat de knop om het te vragen.
  assert.match(html, /Bevestigen/);
});


// ─────────────────────────────────────────────────────────────────────────────
// [BETAALPLAN] Het verdeelscherm — één betaling over meerdere facturen
//
// Dit scherm rekent tijdens het typen: elk bedrag dat de eigenaar intikt verschuift "nog te
// verdelen" en kan het plan omslaan van kan naar kan-niet. Precies het soort tak dat in een lege
// lijst nooit wordt aangeraakt, dus krijgt het echte facturen — inclusief een creditnota, want
// diens minteken is het detail waar een echte batch op klapt.
// ─────────────────────────────────────────────────────────────────────────────

const verdeelTx = {
  id: "tx-1", amount: -850, date: "2026-07-28",
  description: "SEPA overboeking", counterpartName: "Aardappelgroothandel Altena B.V.",
  alreadyAllocated: 0,
};
const verdeelFacturen = [
  { id: "f1", direction: "incoming" as const, invoiceType: "factuur", totalIncBtw: 1000, amountPaid: 0,
    invoiceNumber: "2026-441", partyName: "Aardappelgroothandel Altena B.V.", invoiceDate: "2026-07-01", open: 1000 },
  { id: "f2", direction: "incoming" as const, invoiceType: "creditnota", totalIncBtw: -150, amountPaid: 0,
    invoiceNumber: "CR-88", partyName: "Aardappelgroothandel Altena B.V.", invoiceDate: "2026-07-10", open: 150 },
  { id: "f3", direction: "incoming" as const, invoiceType: "factuur", totalIncBtw: 320, amountPaid: 120,
    invoiceNumber: "2026-python", partyName: "Hano Groothandel", invoiceDate: "2026-06-02", open: 200 },
];

test("[BETAALPLAN] het verdeelscherm opent met echte facturen en noemt het bedrag dat te verdelen is", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: verdeelTx, facturen: verdeelFacturen,
  }));
  assert.ok(html.length > 800, "het scherm rendert");
  assert.match(html, /Betaling verdelen/);
  assert.match(html, /Geld dat wegging/, "de richting staat er, want die bepaalt welke facturen mogen");
  assert.match(html, /Nog te verdelen/);
  assert.match(html, /850,00/, "het bedrag van de betaling zelf");
  // De creditnota moet als zodanig herkenbaar zijn VOOR je hem aanvinkt — anders vink je hem aan
  // in de verwachting dat hij optelt.
  assert.match(html, /creditnota — gaat eraf/);
  // Een half betaalde factuur toont wat er NOG open staat, niet zijn totaal.
  assert.match(html, /200,00/);
});

test("[BETAALPLAN] zonder openstaande inkoopfacturen wijst het scherm de weg in plaats van leeg te zijn", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: verdeelTx, facturen: [],
  }));
  assert.ok(html.length > 500);
  assert.match(html, /voeg hem dan eerst toe/, "een lege lijst die niets zegt is een doodlopende weg");
});

test("[BETAALPLAN] geld dat BINNENKWAM zegt dat ook, en toont het al gekoppelde deel", async () => {
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: { ...verdeelTx, amount: 2420, alreadyAllocated: 605 },
    facturen: [{ ...verdeelFacturen[0], direction: "outgoing" as const }],
  }));
  assert.match(html, /Geld dat binnenkwam/);
  assert.match(html, /was al gekoppeld/, "wat een eerdere koppeling nam, is weg — dat hoort te blijken");
});

test("[BETAALPLAN] een al volledig verdeelde betaling is een dichte deur, geen doodlopende weg", async () => {
  // Zonder deze tak opende het scherm gewoon: lijst, invulvelden, knop — en elk plan werd daarna
  // geweigerd met "nog € 0,00 te vergeven". Waar, en het antwoord op de verkeerde vraag.
  const { default: VerdeelClient } = await import("../../src/app/dashboard/bank/verdelen/[txId]/VerdeelClient");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(VerdeelClient as any, {
    transactie: { ...verdeelTx, alreadyAllocated: 850 }, facturen: verdeelFacturen,
  }));
  assert.match(html, /al helemaal verdeeld/);
  assert.doesNotMatch(html, /Nog te verdelen/, "geen invulvelden voor een verdeling die niet kan");
  assert.match(html, /ontkoppel dan eerst/, "en het zegt hoe je er wél weer bij komt");
});

test("[VERSTUURD] the send confirmation renders, and puts the irreversible part on the screen", async () => {
  // The panel that appears the instant an invoice becomes a legal document. Its words are tested
  // in invoice-sent-notice.test.ts; what a render cannot be replaced by is whether the component
  // that shows them survives being called — the whole reason this file exists.
  const { default: InvoiceSentModal } = await import("@/components/ui/InvoiceSentModal");
  const { invoiceSentNotice } = await import("@/lib/invoice-sent-notice");

  const notice = invoiceSentNotice({
    invoiceNumber: "2026-014",
    invoiceType: "factuur",
    clientName: "Stichting Contour de Twern",
    clientEmail: "info@example.nl",
    totalInc: 394.99,
    replyTo: "mo@boekbrug.nl",
  })!;

  const html = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, { notice, onView: () => {}, onNew: () => {} }),
  );

  assert.ok(html.length > 0, "the panel may not render empty");
  assert.ok(html.includes("2026-014"), "the number that was just minted");
  assert.ok(html.includes("info@example.nl"), "where it went");
  assert.ok(html.includes("394,99"), "the amount, in Dutch");
  // The sentence the modal exists for. A layout change that dropped `definitief` would still
  // render fine and would still look like a success panel.
  assert.ok(html.includes("ligt vast"), "what can no longer be changed must be visible");
  assert.ok(html.includes("creditnota"), "…and how to correct it");
  assert.ok(html.includes("Zo controleer je het zelf"), "the owner's own question, answered here");
  assert.ok(html.includes("Factuur bekijken") && html.includes("Nog een factuur"),
    "both exits — the panel must never be a dead end on a form that was already submitted");

  // A creditnota may never be announced as a factuur: at that moment the number becomes permanent.
  const credit = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice({ invoiceNumber: "2026-015", invoiceType: "creditnota" })!,
      onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(credit.includes("Creditnota verstuurd"));
});

test("[TAAL] the send confirmation renders in Arabic, right to left", async () => {
  // The first translated surface in the product. The blog has spoken Arabic for 53 articles; this
  // is the first thing inside the app that does. What a render proves and a unit test cannot: the
  // panel survives being called with Arabic, and the DIRECTION reaches the DOM — an Arabic panel
  // laid out left-to-right is legible word by word and unusable as a screen.
  const { default: InvoiceSentModal } = await import("@/components/ui/InvoiceSentModal");
  const { invoiceSentNotice } = await import("@/lib/invoice-sent-notice");

  const facts = {
    invoiceNumber: "2026-014",
    invoiceType: "factuur",
    clientName: "Stichting Contour de Twern",
    clientEmail: "info@example.nl",
    totalInc: 394.99,
    replyTo: "mo@boekbrug.nl",
  };

  const ar = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice(facts, "ar")!, onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(ar.includes('dir="rtl"'), "Arabic must be laid out right to left");
  assert.ok(ar.includes("تم إرسال الفاتورة"), "the title is Arabic");
  assert.ok(ar.includes("كيف تتحقّق بنفسك"), "and so is the heading over the checks");

  // The facts are data, not language: they must come through a translation unchanged, or the
  // owner is reading a confirmation about a different invoice than the one that was sent.
  assert.ok(ar.includes("2026-014"), "the number survives");
  assert.ok(ar.includes("394,99"), "the amount survives, in euros and Latin digits");
  assert.ok(ar.includes("info@example.nl"), "and the address it went to");
  // Rule 2, in its stronger form. This used to assert the literal words "Facturen" and
  // "Verzonden", which was right while the navigation bar and the status chip were Dutch. Both
  // are translated now, so the sentence must name what the screen ACTUALLY says — it fills itself
  // from nav.invoices and status.sent, the very keys the bar and the chip render.
  const { translate } = await import("@/lib/i18n/t");
  assert.ok(ar.includes(translate("ar", "nav.invoices")), "must name the tab as the bar labels it");
  assert.ok(ar.includes(translate("ar", "status.sent")), "must name the status as the chip labels it");
  assert.ok(!ar.includes("{tab}") && !ar.includes("{status}"), "no unfilled placeholder");

  // Dutch is unchanged and still ltr — the language of everyone using the app today.
  const nl = renderToStaticMarkup(
    React.createElement(InvoiceSentModal as any, {
      notice: invoiceSentNotice(facts, "nl")!, onView: () => {}, onNew: () => {},
    }),
  );
  assert.ok(nl.includes('dir="ltr"'));
  assert.ok(nl.includes("Factuur verstuurd") && nl.includes("Factuur bekijken"));
});

test("[TAAL] the language switch renders, and names each language in its own script", async () => {
  const { LanguageCard } = await import("@/components/settings/LanguageCard");
  const html = renderToStaticMarkup(React.createElement(LanguageCard as any, {}));
  assert.ok(html.length > 0);
  // Someone looking for their own language scans for the shape of their own script, so these are
  // never translated.
  for (const label of ["Nederlands", "English", "العربية", "Türkçe"]) {
    assert.ok(html.includes(label), `the switch must offer ${label}`);
  }
  // The promise the card must keep making: the documents do not follow the interface language.
  assert.ok(html.includes("Belastingdienst"), "it says which language the documents stay in");
});

test("[ANDER-TOTAAL] the document's own total reaches the confirm modal as one tap", async () => {
  // Against the MODAL, because that is where the number is edited and where the offer lives. The
  // card shows the warning; this is the screen the owner acts on.
  //
  // The invoice this came from: NemaFood B.V. 262697, three scanned pages with no text layer. The
  // app read € 1.149,56 with € 94,92 BTW — internally consistent, so every arithmetic gate passed —
  // while the document says € 1.065,14 + € 95,54 = € 1.160,68.
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  const base = {
    id: "n1", client_name: "NemaFood B.V.", client_email: null, invoice_type: "factuur",
    total_ex_btw: 1054.64, btw_amount: 94.92, total_inc_btw: 1149.56, amount_paid: 0,
    invoice_date: "2026-07-28", invoice_number: "262697", source: "upload",
    pdf_url: null, document_id: null, created_at: "2026-07-28T10:00:00Z",
    folder_id: null, folder_name: null,
    field_confidence: {
      _grounding: {
        totalIncBtw: "absent", totalExBtw: "absent", btwAmount: "absent", source: "ocr",
        alternative: { ex: 1065.14, btw: 95.54, inc: 1160.68 },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };
  assert.ok(invoice.health.alternativeTotals, "the verdict must carry it, or the modal has nothing to show");

  const render = (inv: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice: inv, onVerify() {}, onPay() {}, onCancel() {},
        }))),
  );

  const html = render(invoice);
  // The owner sees the document's total, and is asked rather than told.
  assert.match(html, /Staat dit bedrag op je factuur\?/, "the question is on the screen");
  assert.match(html, /1\.160,68/, "…and names the document's own total");
  // The warning sentence names all three figures, so the owner can match the totals block by eye.
  assert.match(html, /1\.065,14/);
  assert.match(html, /95,54/);
  // And the number the app read is still shown — the owner is comparing, not being overruled.
  assert.match(html, /1\.149,56/);

  // An invoice whose total IS corroborated must show none of this. A second figure on a correct
  // invoice is how a warning stops being read.
  const clean = { ...base, total_ex_btw: 1065.14, btw_amount: 95.54, total_inc_btw: 1160.68, field_confidence: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanInvoice = { ...clean, health: classifyImportHealth(clean as any) };
  const cleanHtml = render(cleanInvoice);
  assert.doesNotMatch(cleanHtml, /Staat dit bedrag op je factuur\?/, "no offer on an invoice that reads right");
});

// [DUBBEL-BEWIJS] The words on the screen, without the styles behind them.
//
// Asserting a number against raw markup reads the CSS too: `line-height:1.45` satisfies /4/, and
// `border-radius:10px` satisfies /10/. Both of this file's double-pay tests had an assertion that
// passed for that reason — "the search names how many it compared against" was being answered by a
// line-height. What the owner reads is the text nodes, so that is what these assert on.
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("[DUBBEL-BEWIJS] 'we could not look' does not render as 'we looked and found nothing'", async () => {
  // The whole point, painted. The no-double-pay check reached the screen as a warning or as
  // nothing at all, and "nothing at all" was doing two jobs: a completed search that found no
  // twin, and five separate paths where no search happened. Both opened the same pay dialog.
  //
  // Rendering the two side by side is the assertion: if they ever produce the same markup again,
  // the owner is once more one tap from paying a supplier twice with the app's blessing.
  const { default: DoublePayNotice } = await import("../../src/components/invoice/DoublePayNotice");
  const { buildDoublePayNotice } = await import("../../src/lib/double-pay-check");

  const paint = (result: unknown) => renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(DoublePayNotice as any, { notice: buildDoublePayNotice(result as never, "nl") }),
  );

  const searched = paint({
    outcome: "clear", match: null, reason: null,
    search: { candidates: 4, anchor: "iban", days: 120, capped: false, limit: 50 },
  });
  const unread = paint({ outcome: "unchecked", match: null, search: null, reason: "candidates_unreadable" });

  assert.notEqual(searched, unread, "a failed read and a completed search may never paint the same");
  assert.ok(searched.length > 0, "a completed check says what it compared against");
  assert.ok(unread.length > 0, "and a failed one says it failed — never an empty span");

  // The completed one names the size of the set and the window; the failed one names neither,
  // because there was none. A number on the failed line would be a search that never happened.
  assert.match(textOf(searched), /4/, "the completed check names the size of the set");
  assert.match(textOf(searched), /120/, "…and the window it looked back over");
  assert.doesNotMatch(textOf(unread), /120/, "a check that never ran names no window");

  // Nothing to report yet renders nothing at all — the dialog before the answer arrives.
  assert.equal(paint(null), "", "no result yet → no line, not an empty box");

  // Each of the five reasons paints, and paints its own sentence. A shared "er ging iets mis"
  // would tell the owner nothing they can act on, and two of the five they can fix themselves.
  const reasons = ["invoice_unreadable", "candidates_unreadable", "no_amount", "no_vendor", "network"];
  const painted = reasons.map((reason) => paint({ outcome: "unchecked", match: null, search: null, reason }));
  assert.ok(painted.every((h) => h.length > 0), "every reason reaches the screen");
  assert.equal(new Set(painted).size, 5, "five causes, five different lines");

  // [TAAL] The direction travels with the words, on the same object — so an Arabic-reading owner
  // cannot get the sentence in one direction and the layout in the other.
  const ar = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(DoublePayNotice as any, {
      notice: buildDoublePayNotice(
        { outcome: "unchecked", match: null, search: null, reason: "no_amount" } as never, "ar",
      ),
    }),
  );
  assert.match(ar, /dir="rtl"/);
  assert.doesNotMatch(ar, /border-left|padding-left|text-align:right/);
});

test("[DUBBEL-BUNDEL] one unreachable row is never absorbed into a clean set", async () => {
  // The bundle dialog pays N supplier invoices on one tap and never ran the duplicate check at
  // all. Now it does — and the thing that has to hold is the precedence: a row the sweep could not
  // reach may not be counted among the ones it cleared. "Alle 5 nagekeken" over a set where only
  // four were reachable is the original defect, multiplied by the number of invoices.
  const { default: DoublePayNotice } = await import("../../src/components/invoice/DoublePayNotice");
  const { buildBundleDoublePayNotice } = await import("../../src/lib/double-pay-check");

  const row = (invoiceNumber: string | null, outcome: string, reason: string | null = null) => ({
    invoiceNumber,
    result: {
      outcome, match: null, reason,
      search: outcome === "unchecked" ? null : { candidates: 2, anchor: "iban", days: 120, capped: false, limit: 50 },
    },
  });
  const paint = (findings: unknown, total: number) => renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(DoublePayNotice as any, {
      notice: buildBundleDoublePayNotice(findings as never, total, "nl"),
    }),
  );

  const allClear = paint([row("A", "clear"), row("B", "clear"), row("C", "clear")], 3);
  const oneUnread = paint([row("A", "clear"), row("B", "unchecked", "candidates_unreadable"), row("C", "clear")], 3);
  assert.notEqual(allClear, oneUnread, "a set with an unreachable row may not paint as a clean one");
  assert.match(textOf(allClear), /3/, "the clean one names how many it checked");
  assert.doesNotMatch(textOf(oneUnread), /Alle 3/, "…and the other one does not claim all three");

  // A twin leads, and the unreachable row beside it still appears — otherwise "1 lijkt al betaald"
  // quietly implies the rest were cleared.
  const both = paint([row("2026-014", "twin"), row("B", "unchecked", "network"), row("C", "clear")], 3);
  assert.match(textOf(both), /2026-014/, "the twin is named by its number");
  assert.match(textOf(both), /1 rekening/, "…and the row that could not be checked is still on the screen");

  // Still sweeping is its own state, not a blank: the confirm button is live the whole time.
  const busy = paint(null, 4);
  assert.ok(busy.length > 0, "a sweep in flight says so rather than showing nothing");
  assert.doesNotMatch(textOf(busy), /\d/, "…and claims no count it does not have yet");
  assert.equal(paint([], 0), "", "no bundle → no line at all");

  // 30 selected, 25 swept. The five never looked at are reported, not counted clean.
  const swept = Array.from({ length: 25 }, (_, i) => row(`A${i}`, "clear"));
  const bounded = paint(swept, 30);
  assert.match(textOf(bounded), /25/);
  assert.match(textOf(bounded), /30/);
  assert.notEqual(bounded, paint(swept, 25), "a bounded sweep and a complete one may not look alike");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// [UREN] De urenregistratie — het scherm waar niet-gefactureerd werk zichtbaar wordt.
// ═════════════════════════════════════════════════════════════════════════════════════════════

test("[URENCRITERIUM] elke stand van het criterium overleeft een render", async () => {
  // De takken zitten in de STAND, niet in de rijen: een paneel dat alleen tegen 'op koers' is
  // aangeroepen dekt de zin die de ondernemer in november leest niet. Alle negen standen, plus de
  // twee die geen getal hebben (unknown, waar hours null is en de balk niet mag verschijnen).
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { assessUrencriterium } = await import("../../src/lib/urencriterium");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const standen: Array<[string, { hoursSoFar: number | null; today: string; year: number }]> = [
    ["unknown", { hoursSoFar: null, today: "2026-08-28", year: 2026 }],
    ["met", { hoursSoFar: 1300, today: "2026-08-28", year: 2026 }],
    ["too_early", { hoursSoFar: 20, today: "2026-01-10", year: 2026 }],
    ["on_track", { hoursSoFar: 700, today: "2026-06-30", year: 2026 }],
    ["behind", { hoursSoFar: 900, today: "2026-09-30", year: 2026 }],
    ["critical", { hoursSoFar: 500, today: "2026-11-15", year: 2026 }],
    ["unreachable", { hoursSoFar: 1025, today: "2026-12-29", year: 2026 }],
    ["closed_met", { hoursSoFar: 1300, today: "2026-08-28", year: 2025 }],
    ["closed_missed", { hoursSoFar: 900, today: "2026-08-28", year: 2025 }],
  ];

  for (const [naam, invoer] of standen) {
    const stand = assessUrencriterium(invoer);
    assert.equal(stand.level, naam, `de fixture voor ${naam} levert stand ${stand.level} — dan dekt deze render iets anders`);

    const html = renderToStaticMarkup(
      React.createElement(ToastProvider, null,
        React.createElement(DialogProvider, null,
          React.createElement(UrenClient as never, {
            initialEntries: [] as never,
            clients: [],
            urencriterium: stand as never,
          }),
        ),
      ),
    );
    const text = textOf(html);
    assert.match(text, /Urencriterium/, `${naam}: het paneel is er niet`);
    // Geen enkele stand mag een sleutel op het scherm zetten. Een ontbrekende vertaling valt terug
    // op Nederlands; een ontbrekende SLEUTEL rendert 'uren.criterium.achter' aan de ondernemer.
    assert.doesNotMatch(text, /uren\.criterium\./, `${naam}: er staat een sleutel op het scherm`);
    // De twee zinnen die het rekenwerk niet kan zeggen, staan er bij ELKE stand — ook bij 'gehaald'.
    assert.match(text, /tellen mee/, `${naam}: de zin over niet-gefactureerde uren ontbreekt`);
    assert.match(text, /naar rato/, `${naam}: de zin over de starter zonder pro-rata ontbreekt`);

    if (naam === "unknown") {
      // [NO-SILENT-EMPTY] Geen getal en geen balk: een balk op nul zegt "je hebt niets gewerkt",
      // en dat is niet wat er gebeurd is.
      assert.doesNotMatch(text, /van de 1\.225 uur geregistreerd/, "een mislukte lezing toont toch een voortgang");
    } else {
      assert.match(text, /van de 1\.225 uur geregistreerd/, `${naam}: de voortgang ontbreekt`);
    }
  }
});


/** One recorded stretch of work, in the shape the screen receives it. */
const uur = (over: Record<string, unknown> = {}) => ({
  id: "u1", client_id: "c1", worked_on: "2026-08-03", description: "Analyse",
  hours: 2, hourly_rate: 95, invoice_id: null, ...over,
});

test("[UREN] het urenscherm rendert, met rijen die elke tak raken", async () => {
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // Rijen die de takken ÉCHT raken — tegen een lege lijst roept `[].map(cb)` de callback nooit aan
  // en zou deze gate niets dekken, precies de val die de kop van dit bestand beschrijft.
  const rows = [
    uur({ id: "a", worked_on: "2026-08-03", hours: 2, hourly_rate: 95 }),
    // Zonder tarief: telt in de uren, telt NIET in het bedrag, en moet dat zeggen.
    uur({ id: "b", worked_on: "2026-08-04", description: "Overleg", hours: 3, hourly_rate: null }),
    // Een tweede klant, zodat de groepering en de sortering op bedrag echt draaien.
    uur({ id: "c", client_id: "c2", worked_on: "2026-08-05", description: "Bouw", hours: 8, hourly_rate: 120 }),
    // Uren zonder klantkaart — een eigen groep, geen stille optelling bij iemand anders.
    uur({ id: "d", client_id: null, worked_on: "2026-08-06", description: "Losse klus", hours: 1, hourly_rate: 60 }),
    // Al gefactureerd: mag NIET in de te-factureren lijst staan.
    uur({ id: "e", worked_on: "2026-07-01", description: "Vorige maand", hours: 4, hourly_rate: 95, invoice_id: "inv-1" }),
  ];

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null,
        React.createElement(UrenClient as never, {
          initialEntries: rows as never,
          clients: [{ id: "c1", name: "Klant Een" }, { id: "c2", name: "Klant Twee" }],
        }),
      ),
    ),
  );
  assert.ok(html.length > 0, "het scherm rendert");

  const text = textOf(html);
  assert.match(text, /Klant Een/, "de klantnaam komt van de kaart, niet van een id");
  assert.match(text, /Klant Twee/);
  // De groep zonder klantkaart staat er onder zijn eigen kop — hij mag niet bij een klant belanden.
  assert.match(text, /Geen klant/);

  // [CENT] De bedragen zijn de som van de uren, niet iets dat erop lijkt. 8 × 120 = 960, en
  // 2 × 95 = 190 terwijl de drie uur zonder tarief er NIET in zitten.
  assert.match(text, /960/, "de duurste groep toont haar eigen bedrag");
  assert.match(text, /190/, "…en de andere telt alleen de uren mét tarief");

  // De regel waar dit scherm om draait: een uur dat al op een factuur staat is geen kandidaat.
  assert.doesNotMatch(text, /Vorige maand/, "een gefactureerd uur staat niet in de te-factureren lijst");

  // En een bedrag dat een uur weglaat ZEGT dat. Zonder deze zin is € 190 een getal dat de
  // ondernemer niet kan narekenen tegen de drie regels eronder.
  assert.match(text, /nog geen tarief/, "het onvolledige bedrag noemt wat het niet meetelt");
  assert.match(text, /Geen tarief/, "…en de regel zelf zegt het ook");
});

test("[UREN] een leesfout is geen lege urenlijst", async () => {
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const paint = (entries: unknown[], loadFailed: boolean) => renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null,
        React.createElement(UrenClient as never, {
          initialEntries: entries as never, clients: [], loadFailed,
        }),
      ),
    ),
  );

  const broken = paint([], true);
  const empty = paint([], false);
  // [NO-SILENT-EMPTY] De twee mogen niet op elkaar lijken. "Nog geen uren" op een kapotte database
  // is het ene bericht waarop iemand die zijn uren kwijt is nooit had moeten vertrouwen.
  assert.notEqual(broken, empty, "een storing schildert niet als een lege lijst");
  assert.match(textOf(broken), /storing/, "de storing noemt zichzelf");
  assert.doesNotMatch(textOf(broken), /Nog geen uren/, "…en belooft niet dat er niets openstaat");
  assert.match(textOf(empty), /Nog geen uren/, "een écht lege lijst zegt wél dat hij leeg is");
});

test("[UREN] de kolomladder staat in de stijl, niet een object dat erop lijkt", async () => {
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { COLUMN } = await import("../../src/lib/design/tokens");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null,
        React.createElement(UrenClient as never, {
          initialEntries: [uur({ id: "a" })] as never, clients: [{ id: "c1", name: "Klant Een" }],
        }),
      ),
    ),
  );

  // Gemeten, niet aangenomen: `{...COLUMN}` in een style-object schrijft `hub:480px;work:680px`
  // in de DOM. Dat is geen CSS, dus de pagina had gewoon GEEN kolom — op een breed scherm loopt de
  // regel dan van rand tot rand. tsc keurt het goed (het zijn geldige objectsleutels) en de build
  // ook; alleen een render laat het zien.
  assert.doesNotMatch(html, /hub:|work:/, "geen tokennaam als CSS-eigenschap");
  assert.match(html, new RegExp(`max-width:\\s*${COLUMN.work}px`), "de werkkolom staat er als echte CSS");

  // De richting bereikt de DOM. Onder renderToStaticMarkup is de taal altijd Nederlands (useLocale
  // geeft daar zijn serversnapshot terug), dus dit meet de bedrading en niet de vertaling — die
  // wordt statisch bewaakt door de [UREN-TAAL]-gate in lifecycle-gates.test.ts.
  assert.match(html, /dir="ltr"/, "de richting reist mee met de woorden");
  // Fysieke zijden zijn in precies één taal fout, en dat is de taal die niemand nakijkt.
  assert.doesNotMatch(html, /padding-left|padding-right|text-align:\s*(left|right)/,
    "geen fysieke zijde in de opmaak");
});

test("[BEWIJS-BEANTWOORDEN] de vraag krijgt een knop om hem mee te beantwoorden", async () => {
  // GEMELD: het paneel vroeg "Klopt het dat deze factuur nog openstaat?" en bood niets om dat mee
  // te beantwoorden — geen kruisje, geen bevestiging, geen later. Wie het één keer had nagekeken,
  // kreeg dezelfde vraag elke keer opnieuw.
  const { default: OpenInvoiceProofPanel } = await import("../../src/components/invoice/OpenInvoiceProofPanel");
  const { buildProofPanel } = await import("../../src/lib/open-invoice-proof-text");
  const { hitKey } = await import("../../src/lib/open-invoice-proof-ack");

  const treffer = {
    invoiceId: "inv-1", invoiceNumber: "FAC/2026/00296", clientName: "Coroama Stefan Daniel",
    openAmount: 40,
    transaction: { date: "2026-07-27", amount: -40, description: "26/00623", counterpartName: "COROAMA STEFAN DANIEL" },
    confidence: 0.7, reason: "bedrag en naam",
  };
  const proof = {
    direction: "incoming" as const, checkedInvoices: 83, checkedTransactions: 1183,
    bankThrough: "2026-07-28", hits: [treffer],
    capped: { invoices: 0, transactions: 0 }, incoming: null, readFailed: false,
  };
  const acties = { onAnswer: () => {}, onShowAgain: () => {} };
  const paint = (answered: Set<string>, withActions = true) => renderToStaticMarkup(
    React.createElement(OpenInvoiceProofPanel as never, {
      panel: buildProofPanel(proof as never, "nl", answered),
      ...(withActions ? { actions: acties } : {}),
    }),
  );

  const vragend = paint(new Set());
  assert.match(textOf(vragend), /Klopt het dat deze factuur nog openstaat/, "de vraag staat er");
  assert.match(textOf(vragend), /Ja, staat nog open/, "…en nu ook het antwoord");
  assert.match(vragend, /<button/, "als echte knop, dus bereikbaar met een toetsenbord");
  assert.match(vragend, /aria-label="[^"]+"/, "en aangekondigd — 'Ja' zegt op zichzelf niets");
  // Waarom een beantwoorde vraag tóch terug kan komen. Zonder die zin lijkt hij weg te blijven, en
  // dan is een nieuwe betaling die er wél bij past een verrassing die op een fout lijkt.
  assert.match(textOf(vragend), /andere betaling/, "het paneel zegt wanneer het opnieuw vraagt");

  // Beantwoord: de vraag is weg, de LEAD claimt niets meer, en dat er iets weg is staat er.
  const beantwoord = paint(new Set([hitKey(treffer as never)]));
  assert.doesNotMatch(textOf(beantwoord), /Klopt het dat deze factuur/, "de vraag wordt niet opnieuw gesteld");
  assert.doesNotMatch(textOf(beantwoord), /Bij 1 factuur vonden we/, "de kop claimt geen vondst zonder rij eronder");
  assert.match(textOf(beantwoord), /83/, "maar de SCOPE staat er nog — die zin is het hele product");
  assert.match(textOf(beantwoord), /1 eerdere vraag/, "wat weggelegd is, staat er");
  assert.match(textOf(beantwoord), /Toon ze weer/, "…met de weg terug");
  assert.notEqual(vragend, beantwoord);

  // Zonder acties (een scherm dat het antwoord nergens kan bewaren) is er geen knop — en ook geen
  // half werkende die niets doet.
  const zonder = paint(new Set(), false);
  assert.doesNotMatch(textOf(zonder), /Ja, staat nog open/);
  assert.match(textOf(zonder), /Klopt het dat deze factuur nog openstaat/, "de vraag zelf blijft staan");
});

test("[PRIJS-MODUS] het artikelenscherm overleeft een render", async () => {
  const { default: ArtikelenClient } = await import("../../src/app/dashboard/artikelen/ArtikelenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null, React.createElement(ArtikelenClient as never, {})),
    ),
  );
  assert.ok(html.length > 0, "het scherm rendert");

  // Het FORMULIER is hier niet te bereiken: het staat achter `showForm`, en onder
  // renderToStaticMarkup draait geen effect en klikt niemand. Deze gate dekt dus wat hij ziet —
  // dat het scherm niet ontploft op de nieuwe hooks en de nieuwe afgeleide waarde — en de
  // aanwezigheid van de keuze zelf wordt statisch bewaakt door [PRIJS-MODUS] in
  // lifecycle-gates.test.ts. Een render-test die beweert de knop te zien terwijl hij nooit
  // gerenderd wordt, is precies de lege bewering die dit bestand elders opspoort.
  assert.doesNotMatch(html, /aria-pressed/, "het formulier staat dicht — de knoppen horen er nog niet te zijn");
});

test("[CREDIT-AFHANDELEN] een creditnota krijgt de afsluitvraag — en nooit de betaalvraag", async () => {
  // GEMELD, twee keer: "hoe verwerk ik hem als klant?" Een verklaarde creditnota verborg "Heb je
  // betaald?" terecht ([CREDIT-NOT-PAYABLE]) en bood NIETS in de plaats — een rij zonder uitgang.
  const { default: IncomingManageClient } = await import("../../src/app/dashboard/incoming/manage/IncomingManageClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const paint = (rows: unknown[]) => renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null,
        // Same prop shape as the pay-screen test above: what page.tsx actually selects.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(IncomingManageClient as any, {
          profile: { id: "u1" },
          initialInvoices: rows,
          totalCount: rows.length,
          readFailed: [],
          filedQuarters: [],
        }),
      ),
    ),
  );

  // De rij uit het rapport: verklaarde creditnota, negatief geboekt, nog 'received'.
  const credit = manageRow({
    id: "cr", invoice_number: "CR0300343", client_name: "Dutch Sweets Company B.V.",
    invoice_type: "creditnota", total_inc_btw: -51.8, total_ex_btw: -47.52, btw_amount: -4.28,
  });
  const met = textOf(paint([credit]));
  assert.match(met, /Verrekend of terugontvangen\?/, "de afsluitvraag staat op de rij");
  assert.doesNotMatch(met, /Heb je betaald\?/, "…en de betaalvraag niet — dat geld mag nooit weg");

  // Een VERDACHTE rij (CR-prefix, maar positief geboekt) houdt haar correctievraag en krijgt de
  // afsluitknop NIET: haar als credit afsluiten zou een echte schuld als betaald markeren.
  const suspected = manageRow({ id: "sus", invoice_number: "CR0301267", total_inc_btw: 33.87 });
  const sus = textOf(paint([suspected]));
  assert.doesNotMatch(sus, /Verrekend of terugontvangen\?/, "een vermoeden is geen verklaring");

  // En een gewone factuur is onveranderd: betaalvraag ja, afsluitvraag nee.
  const gewoon = textOf(paint([manageRow({ id: "re" })]));
  assert.match(gewoon, /Heb je betaald\?/);
  assert.doesNotMatch(gewoon, /Verrekend of terugontvangen\?/);
});

// ─── [IB-JAAR] Het jaaroverzicht voor de IB-aangifte ─────────────────────────────────────────

test("[IB-JAAR] het paneel toont de W&V, het urencriterium en wat er NIET in zit", () => {
  return (async () => {
    const { JaarOverzichtPaneel } = await import("../../src/app/dashboard/jaar/JaarClient");
    const t = (k: string) => k;
    const html = renderToStaticMarkup(
      React.createElement(JaarOverzichtPaneel, {
        t: t as never,
        overzicht: {
          year: 2026,
          wv: { opbrengsten: 85000.5, kosten: 32000.25, saldo: 53000.25, afschrijvingen: 625 },
    bedrijfsmiddelen: { investeringen: 3000, boekwaardeEinde: 2375, aantal: 1, unreadable: false },
          uren: { total: 1400, threshold: 1225, met: true, sentence: "Je registreerde 1.400 uur in 2026 — het urencriterium (1.225 uur) is op basis van je registratie gehaald." },
          nietBijgehouden: ["afschrijvingen (investeringen boven € 450 schrijf je af)"],
          kanttekeningen: [],
        },
      }),
    );
    assert.match(html, /85\.000,50/);
    assert.match(html, /53\.000,25/);
    assert.match(html, /urencriterium \(1\.225 uur\) is op basis van je registratie gehaald/);
    assert.match(html, /afschrijvingen/, "de eerlijke lijst staat op het scherm");
  // [BEDRIJFSMIDDEL] De afschrijving staat als eigen regel onder de kosten, de boekwaarde op 31-12
  // staat op het scherm, en de investering die NIET in de kosten zit is genoemd.
  assert.match(html, /jaar\.wv\.afschrijvingen/);
  assert.match(html, /625,00/, "de afschrijving van het jaar");
  assert.match(html, /2\.375,00/, "de boekwaarde op 31 december");
  assert.match(html, /3\.000,00/, "de investering buiten de kosten");
  assert.match(html, /\/dashboard\/bedrijfsmiddelen/, "de deur naar het register");
  })();
});

test("[IB-JAAR] een kanttekening verschijnt, en zonder kanttekeningen geen leeg amberkader", () => {
  return (async () => {
    const { JaarOverzichtPaneel } = await import("../../src/app/dashboard/jaar/JaarClient");
    const basis = {
      year: 2026,
      wv: { opbrengsten: 100, kosten: 50, saldo: 50, afschrijvingen: 0 },
      bedrijfsmiddelen: { investeringen: 0, boekwaardeEinde: null, aantal: 0, unreadable: true },
      uren: { total: null, threshold: 1225, met: null, sentence: "We konden je urenregistratie nu niet lezen — het urencriterium is niet beoordeeld." },
      nietBijgehouden: ["voorraadmutatie"],
      kanttekeningen: ["€ 4.200,00 omzet staat nog zonder BTW-tarief."],
    };
    const met = renderToStaticMarkup(React.createElement(JaarOverzichtPaneel, { t: ((k: string) => k) as never, overzicht: basis }));
    assert.match(met, /4\.200,00 omzet staat nog zonder BTW-tarief/);
    assert.match(met, /niet beoordeeld/, "een mislukte urenlezing zegt dat, nooit 'niet gehaald'");
    const zonder = renderToStaticMarkup(React.createElement(JaarOverzichtPaneel, { t: ((k: string) => k) as never, overzicht: { ...basis, kanttekeningen: [] } }));
    assert.doesNotMatch(zonder, /FFF8E1/, "geen leeg amberkader");
    // [BEDRIJFSMIDDEL] Een register dat niet gelezen kon worden zegt dat, en toont géén boekwaarde.
    assert.match(met, /jaar\.balans\.onleesbaar/, "een mislukte registerlezing wordt gezegd");
    assert.doesNotMatch(met, /jaar\.balans\.boekwaarde/, "…en er staat geen € 0 als boekwaarde");
  })();
});


// ── [BETAALGEDRAG] The customer screen now states how a customer pays, instead of asking ────────
//
// This screen was already on this line's blind side: it is /dashboard/*, so the smoke test never
// logs in to it. What is new is a panel whose content is a LIST (`caveats`) mapped inside the
// render — exactly the shape AGENTS.md warns about, where `[].map(cb)` never calls `cb` and an
// empty fixture proves nothing. So both cases are handed in: a customer with every branch lit,
// and one with nothing to say at all.

test("[BETAALGEDRAG] the customer screen renders a measured pace, an overdue invoice and its caveats", async () => {
  const { default: KlantDetailClient } = await import("../../src/app/dashboard/klanten/[id]/KlantDetailClient");
  const { clientPaymentBehaviour } = await import("../../src/lib/client-payment-behaviour");
  const { dayNumberFromIso } = await import("../../src/lib/invoice-reminders");
  const today = dayNumberFromIso("2026-08-29") as number;

  const iv = (over: Record<string, unknown>) => ({
    id: String(Math.random()), invoice_number: "F-1", invoice_date: "2026-01-01",
    due_date: "2026-01-31", status: "paid", total_inc_btw: 121, payment_date: null, ...over,
  });
  const invoices = [
    iv({ id: "a", payment_date: "2026-02-10" }), // 10 days past the term
    iv({ id: "b", invoice_date: "2026-02-01", due_date: "2026-03-03", payment_date: "2026-03-13" }),
    iv({ id: "c", invoice_date: "2026-03-01", due_date: "2026-03-31", payment_date: "2026-06-29" }),
    iv({ id: "d", payment_date: null }), // paid, no date → a caveat line
    iv({ id: "e", invoice_date: "2026-05-10", due_date: "2026-06-09", payment_date: "2026-05-01" }), // impossible → a second caveat line
    iv({ id: "f", status: "sent", due_date: "2026-07-15", total_inc_btw: 500 }), // overdue right now
  ];
  const behaviour = clientPaymentBehaviour(invoices, today);

  const html = renderToStaticMarkup(
    React.createElement(KlantDetailClient as never, {
      client: {
        id: "k1", name: "Bakkerij Noord", email: null, kvk_number: null, btw_number: null,
        iban: null, address: null, postal_code: null, city: null, notes: null,
      },
      invoices,
      totals: { billed: 1226, open: 500, count: invoices.length },
      behaviour,
    }),
  );

  assert.ok(html.length > 0);
  assert.match(html, /BETAALGEDRAG/i, "the panel is on the screen (Card uppercases its title)");
  assert.match(html, /na de vervaldatum/, "and it says which side of the term this customer is on");
  assert.match(html, /90/, "the worst case is named");
  assert.match(html, /500,00/, "the invoice standing open right now is stated in euros");
  assert.match(html, /geen betaaldatum/, "the unmeasurable invoice is visible, not silently dropped");
  assert.match(html, /klopt niet/, "and so is the impossible one — both list items rendered");
  assert.doesNotMatch(html, /betaalgedrag…/, "the notes box no longer asks for what the app now states");
});

test("[BETAALGEDRAG] a customer with no invoices renders the absence, and never a '0 dagen'", async () => {
  const { default: KlantDetailClient } = await import("../../src/app/dashboard/klanten/[id]/KlantDetailClient");
  const { clientPaymentBehaviour } = await import("../../src/lib/client-payment-behaviour");

  const html = renderToStaticMarkup(
    React.createElement(KlantDetailClient as never, {
      client: {
        id: "k2", name: "Nieuwe klant", email: null, kvk_number: null, btw_number: null,
        iban: null, address: null, postal_code: null, city: null, notes: null,
      },
      invoices: [],
      totals: { billed: 0, open: 0, count: 0 },
      behaviour: clientPaymentBehaviour([], 20000),
    }),
  );

  assert.match(html, /Nog geen facturen voor deze klant/);
  assert.doesNotMatch(html, /0 dagen/, "an absence is never dressed up as a fast payer");
});

// ── [RENDER-GATE] De takken die deze ronde zijn bijgekomen ─────────────────────────────────────
//
// Elk van de drie hieronder is een NIEUWE vertakking, en een vertakking die nooit is aangeroepen
// is precies wat dit bestand bestaat om te vangen: tsc keurt hem goed, eslint zwijgt, next build
// compileert hem, en de smoke-test logt niet in. Een lege lijst rendert de tak niet — dus krijgen
// ze rijen die hem wél aanraken.

test("[RENDER-GATE] een klantkaart met een onleesbare stand rendert de derde stand, niet een nul", async () => {
  const { default: KlantenBeheer } = await import("../../src/modules/accountant/pages/KlantenBeheer");

  const klant = (id: string, naam: string, readFailed: boolean) => ({
    id, full_name: naam, company_name: naam, email: `${id}@voorbeeld.nl`, linked_at: "2026-01-05",
    readiness: {
      year: 2026, quarter: 2,
      sharedInvoices: readFailed ? 0 : 12,
      processedInvoices: readFailed ? 0 : 9,
      openQuestions: readFailed ? 0 : 2,
      hasBankData: !readFailed,
      lastUploadDaysAgo: readFailed ? null : 3,
      readFailed,
    },
  });

  // Beide naast elkaar: een klant waarvan we het weten en een waarvan we het niet weten. Alleen
  // met allebei kan het scherm laten zien dat het verschil ook echt te zien is.
  const html = renderToStaticMarkup(
    React.createElement(KlantenBeheer as never, {
      initialClients: [klant("k1", "Bakkerij Noord", false), klant("k2", "Loodgieter De Vries", true)],
    }),
  );

  assert.ok(html.length > 0, "het scherm overleeft één render");
  assert.match(html, /Bakkerij Noord/);
  assert.match(html, /Loodgieter De Vries/);
  // De zin uit de catalogus, niet de getallen. "0/0 verwerkt · Bank —" over een klant die keurig
  // aanlevert is precies de bewering die deze tak weghaalt.
  assert.match(html, /Stand niet te lezen/, "de onleesbare klant zegt dat, in plaats van nullen");
  assert.match(html, /9\/12 verwerkt/, "…en de leesbare klant toont gewoon zijn stand");
  // En hij valt niet door naar het grijze 'niets in behandeling'.
  assert.match(html, /#B3261E/, "onleesbaar draagt de waarschuwingskleur, geen rust");
});

test("[RENDER-GATE] het werkbord met een onleesbare klantenlijst zegt niet 'nog geen klanten'", async () => {
  const { default: AccountantWerkboard } = await import("../../src/modules/accountant/pages/AccountantWerkboard");

  const onleesbaar = renderToStaticMarkup(
    React.createElement(AccountantWerkboard as never, {
      clients: [], klantenOnleesbaar: true, year: 2026, quarter: 2,
    }),
  );
  assert.ok(onleesbaar.length > 0);
  assert.doesNotMatch(onleesbaar, /Nog geen klanten gekoppeld/,
    "dat is de ene zin die dit bord niet mag zeggen tegen een praktijk die het niet kan controleren");

  // En de echt lege praktijk krijgt hem nog steeds — anders is de eerste boekhouder de dupe van
  // een reparatie die voor de veertigste was bedoeld.
  const leeg = renderToStaticMarkup(
    React.createElement(AccountantWerkboard as never, {
      clients: [], klantenOnleesbaar: false, year: 2026, quarter: 2,
    }),
  );
  assert.match(leeg, /Nog geen klanten gekoppeld/);

  // En een gevulde lijst rendert gewoon.
  const gevuld = renderToStaticMarkup(
    React.createElement(AccountantWerkboard as never, {
      clients: [{ id: "k1", name: "Bakkerij Noord" }, { id: "k2", name: "Loodgieter De Vries" }],
      klantenOnleesbaar: false, year: 2026, quarter: 2,
    }),
  );
  assert.match(gevuld, /Bakkerij Noord/);
});

// ─── [BANK-WERK-EERST] Het bankscherm zelf ──────────────────────────────────────────────────────
//
// Het grootste scherm van de app (3.500 regels) stond in geen enkele rendertest. Het is er nu bij
// omdat de machinerie erboven — koppeling, sleepzone, afschriftenlijst — achter één inklapregel is
// gezet, en dat is precies het soort JSX-verbouwing waar tsc, eslint en next build niets van zien:
// een scheve fragment-haak of een label dat zijn invoer kwijt is, breekt pas bij het renderen.

test("[BANK-WERK-EERST] the bank screen renders, and its file input is always in the page", async () => {
  const { default: BankClient } = await import("../../src/app/dashboard/bank/BankClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null, React.createElement(BankClient))),
  );
  assert.ok(html.length > 400, "the bank screen rendered almost nothing");

  // Effecten draaien niet onder renderToStaticMarkup, dus dit is de eerste verf: nog geen gegevens,
  // dus geen werk, dus de machinerie hoort OPEN te staan — dan is de sleepzone het nuttigste ding
  // op het scherm en precies wat een lege administratie nodig heeft.
  assert.match(html, /bank-statement-file/, "the file input must be in the page for the header button to reach it");
  assert.match(html, /type="file"/, "…and it must still be a real file input");
  // Eén invoer, niet twee: het label wijst er met htmlFor naar in plaats van er een tweede te maken.
  assert.equal(
    (html.match(/id="bank-statement-file"/g) ?? []).length, 1,
    "two file inputs would mean the drop zone and the header button write to different fields",
  );
});

test("[BANK-STAND] the bank screen says what is waiting, and says nothing while it is still reading", async () => {
  const { default: BankClient } = await import("../../src/app/dashboard/bank/BankClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  // Effecten draaien niet onder renderToStaticMarkup, dus dit is de eerste verf: `data` is nog
  // null. Precies het geval dat fout zou zijn om iets over te beweren — "Alles afgehandeld" boven
  // een scherm dat nog laadt, is een geruststelling die een halve seconde later een leugen blijkt.
  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null, React.createElement(BankClient))),
  );
  assert.doesNotMatch(html, /Alles afgehandeld/, "it claims the queue is empty before it has read one");
  assert.doesNotMatch(html, /wachten op je bevestiging/, "it names a count it does not have yet");
  // En de oude vaste zin is weg: die beschreef wat het scherm DOET, elke dag hetzelfde.
  assert.doesNotMatch(html, /Koppel je bank of upload je bankafschrift\. We koppelen/, "the static intro is back");
});


// ── [NUL-POST] Het onbelaste bedrag staat op het correctiescherm ────────────────────────────────
//
// Statiegeld, emballage en europallets dragen geen btw. jortt, Silvasoft, SnelStart en Acumulus
// boeken zo'n post allemaal als een APARTE 0%-regel; deze app had er geen veld voor, dus verdween
// het bedrag in de grondslag en zakte het afgeleide tarief onder het laagste wettelijke tarief.
//
// Gemeten: 52 van 479 geboekte inkoopfacturen (€ 40.761) rekenen een tarief dat geen 0/9/21 is
// terwijl excl + btw exact het totaal is — Aardappelgroothandel Altena 6,50%, Elegance Brands
// 8,38%, Vars Foods 8,45%. Alle drie ONDER 9%, wat precies is wat een onbelaste post in de
// grondslag doet.
test("[NUL-POST] het veld voor een bedrag zonder btw staat op het correctiescherm", async () => {
  const { default: InvoiceCorrectionModal } = await import("../../src/components/invoice/InvoiceCorrectionModal");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");

  const render = (extra: Record<string, unknown>) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(InvoiceCorrectionModal as any, {
        invoice: {
          id: "eb-1", invoice_number: "2026080832", client_name: "Elegance Brands",
          invoice_date: "2026-08-08", invoice_type: "factuur",
          total_ex_btw: 1011.70, btw_amount: 75.22, total_inc_btw: 1086.92,
          ...(extra.invoice as object ?? {}),
        },
        onClose() {}, onSaved() {}, onMessage() {}, ...extra,
      })),
  );

  const html = render({});
  assert.match(html, /Bedrag zonder btw/,
    "het veld staat er niet, en dan kan een ondernemer een factuur met statiegeld nergens goed " +
      "krijgen: de bedragen kloppen al, alleen het tarief zakt onder 9%");
  assert.match(html, /statiegeld, emballage, pallets/i, "het label moet zeggen waar het over gaat");
  assert.match(html, /je totaal verandert er niet van/,
    "de uitleg moet zeggen dat dit bedrag AL in excl. BTW zit — anders leest het als nog een " +
      "bedrag dat erbij moet, en telt de ondernemer zijn factuur dubbel");

  // De opgeslagen waarde komt terug in het veld, met een Nederlandse komma.
  const metWaarde = render({ invoice: { untaxed_amount: 176.4 } });
  assert.match(metWaarde, /value="176,4"/,
    "een eerder ingevuld onbelast bedrag hoort terug te staan, anders wist elke volgende correctie het");
});

// ── [CONTROLES-INKLAPPEN] ─────────────────────────────────────────────────────────────────────
//
// Every check the app runs was printed on every invoice, which turns the one row that matters into
// the fifth of nine identical green lines. Reported on a CAN Vleesgroothandel invoice where all
// nine passed: the panel was a wall, and a wall is skipped.
//
// The rule is the same in both directions — show what is NOT settled. Nothing to report leaves the
// heading alone; something to report leaves exactly that something. No gate in this repo can click
// the arrow, so a render is the only place the COLLAPSED state can be held.

test("[CONTROLES-INKLAPPEN] a flagged invoice shows the flag, not the nine lines around it", async () => {
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");
  const { invoiceChecks } = await import("../../src/lib/invoice-checks");

  // The DELMO invoice this came from: the reader turned one 6 into a 0, so the checksum fails while
  // everything else on the paper is right.
  const invoice = {
    id: "d7", client_name: "DELMO GROOTHANDEL B.V.", invoice_number: "2607902",
    invoice_date: "2026-06-02", invoice_type: "factuur",
    total_ex_btw: 37.35, btw_amount: 7.84, total_inc_btw: 45.19,
    vendor_iban: "NL94INGB0066664293", field_confidence: null, vendorNumbers: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checks = invoiceChecks(invoice as any);
  const settled = checks.filter((c) => c.outcome === "passed");
  assert.ok(settled.length >= 5, `only ${settled.length} settled rows — the fixture stopped exercising the fold`);
  assert.ok(checks.some((c) => c.outcome !== "passed"), "…and nothing is flagged, so there is no flag to look for");

  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, { invoice, onClose() {}, onCorrect() {} }),
  );

  // The one that matters is on screen, with the number to hold against the paper.
  assert.match(html, /controlecijfers/, "the flagged row is folded away with the settled ones");
  assert.match(html, /NL94INGB0066664293/, "…and with it the number there is nothing to compare without");

  // The settled ones are not. Checked by LABEL, per row, rather than by counting ticks: a count
  // passes while the wrong rows are shown.
  for (const c of settled) {
    assert.doesNotMatch(html, new RegExp(c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `"${c.label}" is settled and printed anyway — the wall is back`);
  }

  // And the way to the full list is there, promising what is behind it.
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, new RegExp(`toon alle ${checks.length}`),
    "the button must promise the whole list, not the folded remainder");
});

test("[CONTROLES-INKLAPPEN] a check that could not run is not something to fold away", async () => {
  // [EERSTE-KEER] is a 'not-checked' row that says "this is the first account number we have seen
  // for this supplier — take it from the invoice before you pay". Folding that behind an arrow
  // would undo the reason it was written, so unsettled means flagged AND not-checked.
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");
  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: {
        id: "d8", client_name: "Nieuwe Leverancier B.V.", invoice_number: "2026-1",
        invoice_date: "2026-09-05", invoice_type: "factuur",
        total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
        vendor_iban: "NL94INGB0666664293", vendorNumbers: [],
        field_confidence: { _safecore: { iban_first_seen: true } },
      },
      onClose() {}, onCorrect() {},
    }),
  );
  assert.match(html, /eerste rekeningnummer dat we van deze leverancier zien/,
    "the one row with no history behind it is folded away with the settled ones");
  assert.doesNotMatch(html, /Bedragen kloppen met elkaar/, "…while a settled row is printed");
});


// ── [SPLIT-ALSNOG] De controle die niet kon lopen, met een handeling eronder ───────────────────
//
// Op een factuur die btw-tarieven mengt is de gedrukte specificatie het ENIGE wat het btw-bedrag
// kan tegenspreken: de somidentiteit en de tariefcontrole vallen daar allebei stil (btw-split.ts).
// Stond die specificatie er niet, dan zei dit blad "konden we niet nagaan" en verder niets — een
// doodlopende regel boven een bedrag dat de eigenaar aftrekt. Op de live administratie staan 29
// zulke facturen, samen € 2.758,01 aan voorbelasting.
//
// De poort in lifecycle-gates bewaakt dat de route niets anders schrijft. Wat zij niet kan zien is
// of de knop er staat, en of hij er alléén staat in de toestand waarin hij iets betekent.

const ENKA = {
  id: "enka-1", client_name: "Enka Horeca B.V.", invoice_number: "26710525",
  invoice_date: "2026-03-11", invoice_type: "factuur",
  // De echte cijfers: 2.591,71 tegen 9% en 822,21 tegen 21% — samen 11,89%, een legale menging.
  total_ex_btw: 3413.92, btw_amount: 405.9, total_inc_btw: 3819.82,
  vendor_iban: null, vendorNumbers: [],
};

async function blad(extra: Record<string, unknown>) {
  const { default: InvoiceDocumentSheet } = await import("../../src/components/invoice/InvoiceDocumentSheet");
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoiceDocumentSheet as any, {
      invoice: { ...ENKA, ...extra }, onClose() {}, onCorrect() {},
    }),
  );
}

test("[SPLIT-ALSNOG] een niet-uitgevoerde btw-controle biedt de handeling die haar alsnog laat lopen", async () => {
  const html = await blad({ field_confidence: null });
  assert.match(html, /Btw-bedrag nagerekend/, "de controleregel zelf hoort er te staan");
  assert.match(html, /mengt btw-tarieven/, "…in de toestand die deze knop bestaansrecht geeft");
  assert.match(html, /Btw-specificatie nalezen/,
    "de regel eindigt weer in 'vergelijk het zelf' — een doodlopende zin boven een bedrag dat " +
      "de ondernemer aftrekt, terwijl de app het papier vasthoudt");
});

test("[SPLIT-ALSNOG] tegenproef: op een ZICHTBARE btw-regel die wél is gelopen staat geen knop", async () => {
  // Zonder deze test slaagt de test hierboven ook als de knop onder ELKE btw-regel hangt — en dan
  // biedt het blad een tweede modellezing aan bovenop een specificatie die er al is, waarmee een
  // tweede mening stilletjes wint van wat de eigenaar zelf heeft ingevuld ([SPLIT-CORRECTIE]).
  //
  // Met een KLOPPENDE specificatie zou die test niets bewijzen: een geslaagde controle valt uit de
  // ingeklapte lijst en de knop is dan afwezig omdat de hele regel afwezig is. Dus een specificatie
  // die NIET klopt — dan is de regel gemarkeerd, staat hij er dus wél, en is het de voorwaarde die
  // de knop weghoudt en niet het inklappen.
  const html = await blad({
    field_confidence: { _btw_rows: [
      { rate: 9, base: 2591.71, btw: 233.2 },
      { rate: 21, base: 822.21, btw: 300.0 },
    ] },
  });
  assert.match(html, /Btw-bedrag nagerekend/, "de regel hoort zichtbaar te zijn — anders bewijst dit niets");
  assert.match(html, /btw-specificatie/i, "…met de reden waarom hij is gemarkeerd");
  assert.ok(!html.includes("Btw-specificatie nalezen"),
    "de knop hangt onder een btw-regel die al is nagerekend");
});

test("[SPLIT-ALSNOG] tegenproef: op een enkeltarief-factuur is de controle gewoon gelopen", async () => {
  // 21% over 1.000,00 — twee onafhankelijke constraints, dus corroboratie zonder specificatie.
  const html = await blad({
    total_ex_btw: 1000, btw_amount: 210, total_inc_btw: 1210, field_confidence: null,
  });
  assert.ok(!html.includes("Btw-specificatie nalezen"),
    "de knop staat op een factuur waar niets ontbreekt — dan kost hij de eigenaar een document " +
      "van zijn maandtegoed voor een controle die al is gelopen");
  // 21% is exact een legaal tarief: twee constraints, dus corroboratie zonder specificatie. De
  // niet-nagegaan-zin hoort hier helemaal niet te staan.
  assert.ok(!html.includes("mengt btw-tarieven"),
    "een enkeltarief-factuur leest als niet nagerekend");
});

// ─── [BEDRIJFSMIDDEL] Het register tekent zijn rijen, zijn lege stand en zijn vraag ─────────────
test("[RENDER-GATE] the asset register renders a row with its yearly amount and book value, its empty state, and a candidate", async () => {
  const { RegisterList, CandidateList } = await import("../../src/app/dashboard/bedrijfsmiddelen/BedrijfsmiddelenPanels");
  const t = ((k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k)) as never;
  const row = {
    id: "a1", description: "Koelvitrine", cost: 756, residual_value: 0, useful_life_years: 5, in_use_from: "2026-05-27",
    disposed_on: null, yearly: 151.2, book_value: 693, invoice_number: "INV 82910", supplier_name: "HorecaRama BV",
  };
  const html = renderToStaticMarkup(React.createElement(RegisterList, { assets: [row], t, onDispose: () => {}, onDelete: () => {} }));
  assert.match(html, /Koelvitrine/);
  assert.match(html, /HorecaRama BV · INV 82910/, "the invoice behind the asset is named");
  assert.match(html, /151,20/, "the yearly depreciation");
  assert.match(html, /693,00/, "the book value today");
  assert.match(html, /27-05-2026/, "in use since, in Dutch date order");
  assert.match(html, /bm\.afvoeren/, "a live asset can be disposed");
  assert.match(html, /bm\.verwijderen/);

  const sold = renderToStaticMarkup(React.createElement(RegisterList, { assets: [{ ...row, disposed_on: "2028-03-10" }], t, onDispose: () => {}, onDelete: () => {} }));
  assert.match(sold, /bm\.afgevoerd:10-03-2028/, "a disposed asset says so with its date");
  assert.doesNotMatch(sold, /bm\.afvoeren"|>bm\.afvoeren</, "…and cannot be disposed twice");

  const empty = renderToStaticMarkup(React.createElement(RegisterList, { assets: [], t }));
  assert.match(empty, /bm\.leeg/, "an empty register explains itself");

  const cand = renderToStaticMarkup(React.createElement(CandidateList, {
    candidates: [{ invoiceId: "i1", invoiceDate: "2026-05-27", invoiceNumber: "INV 82910", supplierName: "HorecaRama BV", amount: 756, supplierInvoices: 1 }], t,
  }));
  assert.match(cand, /bm\.kandidaten\.titel/);
  assert.match(cand, /756,00/);
  assert.match(cand, /bm\.kandidaat\.ja/);
  assert.match(cand, /bm\.kandidaat\.nee/);
  assert.equal(renderToStaticMarkup(React.createElement(CandidateList, { candidates: [], t })), "", "no candidates → no box, not an empty box");
});

test("[VOORUIT] the forecast panel renders the ordinary case, a shortfall, and an unknown balance", async () => {
  const { CashflowPanelView } = await import("../../src/components/cashflow/CashflowPanel");
  const { cashflowPanel } = await import("../../src/lib/cashflow-forecast-copy");
  const { forecastCashflow } = await import("../../src/lib/cashflow-forecast");
  const input = {
    today: "2026-09-07",
    bank: { balance: 5_000, asOf: "2026-08-01", partial: false, netSinceAsOf: 120.5 },
    kas: 250,
    payables: [
      { id: "p1", name: "Sligro", dueDate: "2026-09-10", open: 1_200, incasso: false },
      { id: "p2", name: "Verhuurder", dueDate: "2026-09-12", open: 800, incasso: true },
      { id: "p3", name: "Zonder datum", dueDate: null, open: 75, incasso: false },
    ],
    receivables: [{ id: "r1", name: "Klant A", invoiceDate: "2026-09-01", dueDate: "2026-09-15", open: 600, expectedDays: 10 }],
    takings: { perTradingDay: 100, tradingDaysPerWeek: 7, daysMeasured: 30 },
  };
  const noop = () => {};

  const panel = cashflowPanel(forecastCashflow(input))!;
  const html = renderToStaticMarkup(React.createElement(CashflowPanelView, { panel, selected: 7, onSelect: noop, onAction: noop }));
  assert.match(html, /5\.370,50/, "now = bank + lines since + drawer");
  assert.match(html, /-2\.000,00/, "what leaves carries its minus");
  assert.match(html, /800/, "the incasso share is named");
  assert.match(html, /Zonder datum|zonder vervaldatum/, "the undated invoice is named, not counted");
  assert.match(html, /01-08-2026/, "a stale balance says which statement it came from");
  assert.match(html, /aria-selected="true"/, "one horizon is open");
  assert.match(html, /30 dagen/, "…and the other is offered");

  const month = renderToStaticMarkup(React.createElement(CashflowPanelView, { panel, selected: 30, onSelect: noop, onAction: noop }));
  assert.notEqual(month, html, "the 30-day view is a different view");

  const shortPanel = cashflowPanel(forecastCashflow({ ...input, bank: { ...input.bank, balance: 500 }, takings: null }))!;
  const short = renderToStaticMarkup(React.createElement(CashflowPanelView, { panel: shortPanel, selected: 7, onSelect: noop, onAction: noop }));
  assert.match(short, /Tekort op 14-09-2026<\/div><div[^>]*>€ 529,50/, "the shortfall is a label with a magnitude");
  assert.doesNotMatch(short, /Tekort op[^€]*€ -/, "never a double minus");
  assert.match(short, /€ -2\.000,00/, "the outflow beside it still carries its own minus");

  const unknownPanel = cashflowPanel(forecastCashflow({ ...input, bank: { balance: null, asOf: null, partial: false, netSinceAsOf: null } }))!;
  const unknown = renderToStaticMarkup(React.createElement(CashflowPanelView, { panel: unknownPanel, selected: 7, onSelect: noop, onAction: noop }));
  assert.doesNotMatch(unknown, /Nu \(bank/, "no balance → no 'now' figure at all");
  assert.match(unknown, /banksaldo niet/, "…and the absence is said");
  assert.match(unknown, /-2\.000,00/, "the movements are still stated");
});

test("[VOORSTEL] the client's proposal card renders old → new per field, the reason, and both buttons", async () => {
  const { VoorstelKaart } = await import("../../src/app/dashboard/vragen/VragenClient");
  const html = renderToStaticMarkup(React.createElement(VoorstelKaart, {
    voorstel: {
      id: "p1",
      invoice: { id: "inv-1", invoice_number: "F-2026-118", client_name: "Sligro", total_inc_btw: 121, invoice_date: "2026-08-01" },
      changes: [
        { field: "total_ex_btw", from: 100, to: 111.01 },
        { field: "btw_amount", from: 21, to: 9.99 },
        { field: "due_date", from: "2026-08-31", to: null },
      ],
      reason: "Dit is 9%-goederen, geen 21%.",
      askedAt: "2026-09-07T10:00:00Z",
    },
  }));
  assert.match(html, /F-2026-118/);
  assert.match(html, /100,00/, "the old amount is shown");
  assert.match(html, /111,01/, "…and the new one");
  assert.match(html, /9,99/);
  assert.match(html, /31-08-2026/, "the old due date, in Dutch order");
  assert.match(html, />—</, "a cleared due date is a dash, not 'null'");
  assert.match(html, /9%-goederen/, "the reason is on the card");
  assert.match(html, /Akkoord/);
  assert.match(html, /Niet akkoord/);
  assert.match(html, /focus=inv-1/, "the card links to the invoice it is about");
  // An invoice that disappeared still renders a card the client can decline.
  const weg = renderToStaticMarkup(React.createElement(VoorstelKaart, {
    voorstel: { id: "p2", invoice: null, changes: [{ field: "invoice_date", from: "2026-08-01", to: "2026-07-31" }], reason: null, askedAt: null },
  }));
  assert.match(weg, /Niet akkoord/);
  assert.doesNotMatch(weg, /focus=/);
});

// ── [BESTE] The customer card, against what every package does with it ─────────────────────
test("[BESTE] the customer card opens each invoice, chips a late one as late, and offers its own edit", async () => {
  const { default: KlantDetailClient } = await import("../../src/app/dashboard/klanten/[id]/KlantDetailClient");
  const { clientPaymentBehaviour } = await import("../../src/lib/client-payment-behaviour");
  const { dayNumberFromIso } = await import("../../src/lib/invoice-reminders");
  const today = dayNumberFromIso("2026-08-29") as number;
  const invoices = [
    // sent, due date long past, still 'sent' in the column — the cron has not moved it
    { id: "late-1", invoice_number: "F-9", invoice_date: "2026-01-01", due_date: "2026-01-31", status: "sent", total_inc_btw: 500, payment_date: null, amount_paid: null, invoice_type: "factuur", original_invoice_id: null },
    // an offerte past its date is not late: nothing is owed on it
    { id: "off-1", invoice_number: "O-1", invoice_date: "2026-01-01", due_date: "2026-01-31", status: "sent", total_inc_btw: 100, payment_date: null, amount_paid: null, invoice_type: "pro_forma", original_invoice_id: null },
  ];
  const html = renderToStaticMarkup(
    React.createElement(KlantDetailClient as never, {
      client: { id: "k9", name: "Late Betaler", email: null, kvk_number: null, btw_number: null, iban: null, address: null, postal_code: null, city: null, notes: null, phone: "06 12345678", payment_term_days: 45 },
      invoices, totals: { billed: 600, open: 500, count: 2 }, behaviour: clientPaymentBehaviour(invoices, today),
    }),
  );
  assert.match(html, /href="\/dashboard\/invoice\/late-1"/, "the row opens ITS invoice, not the whole list");
  assert.doesNotMatch(html, /href="\/dashboard\/facturen"/, "no row points at the list any more");
  assert.match(html, /Verlopen/, "the late invoice wears the late chip although its status column says sent");
  assert.equal((html.match(/Verlopen/g) ?? []).length, 1, "and the offerte past its date does not");
  assert.match(html, /href="\/dashboard\/klanten\?bewerk=k9"/, "the card offers its own edit");
  assert.match(html, /06 12345678/, "the phone is on the card");
  assert.match(html, /45 dagen/, "and so is the agreed payment term");
});

test("[BESTE] the sales list shows what is still to come in and how much is late, and hides a row of zeros", async () => {
  const { default: FacturenClient } = await import("../../src/app/dashboard/facturen/FacturenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const render = (totals: unknown) => renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(FacturenClient as never, { profile: { id: "u1" }, totals }))),
  );
  const withMoney = render({ open: 3, outstanding: 1250.5, overdue: 1, overdueAmount: 300 });
  assert.match(withMoney, /Openstaand/);
  assert.match(withMoney, /1\.250,50/, "the outstanding sum is on the screen");
  assert.match(withMoney, /Te laat/);
  assert.match(withMoney, /300,00/, "and so is the late part");
  assert.match(withMoney, /4 facturen/, "open + late is the count the owner is chasing");
  const noMoney = render({ open: 0, outstanding: 0, overdue: 0, overdueAmount: 0 });
  assert.doesNotMatch(noMoney, /Openstaand ·/, "nothing open → no header");
});

// ── [DECLARABEL] Own time on the hours screen ────────────────────────────────────────────────
test("[DECLARABEL] own time is listed apart, never as billable work, and the criterion names both halves", async () => {
  const { default: UrenClient } = await import("../../src/app/dashboard/uren/UrenClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { assessUrencriterium } = await import("../../src/lib/urencriterium");

  const entries = [
    { id: "a", client_id: "k1", worked_on: "2026-09-01", description: "Advieswerk", hours: 4, hourly_rate: 110, invoice_id: null, billable: true },
    { id: "b", client_id: null, worked_on: "2026-09-02", description: "Acquisitie bij nieuwe klant", hours: 3, hourly_rate: null, invoice_id: null, billable: false },
  ];
  const html = renderToStaticMarkup(
    React.createElement(ToastProvider, null,
      React.createElement(DialogProvider, null,
        React.createElement(UrenClient as never, {
          initialEntries: entries as never,
          clients: [{ id: "k1", name: "Bakkerij Noord" }] as never,
          urencriterium: assessUrencriterium({ hoursSoFar: 900, today: "2026-09-09", year: 2026, everRegistered: true }) as never,
          declarabelThisYear: 640,
        }),
      ),
    ),
  );
  const text = textOf(html);
  assert.match(text, /Niet-declarabel/, "own time has its own section");
  assert.match(text, /Acquisitie bij nieuwe klant/, "and the hour itself is on the screen, not dropped");
  assert.match(text, /waarvan 640 declarabel/, "the criterion names the billable half beside the total");
  // The acquisition hour must not read as an hour whose rate is missing — that warning is about
  // work that WILL be invoiced.
  assert.doesNotMatch(text, /1 uur zonder tarief|zonder tarief/, "own time never raises the missing-rate warning");
});
