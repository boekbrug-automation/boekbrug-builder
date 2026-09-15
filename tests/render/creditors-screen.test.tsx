// tests/render/creditors-screen.test.tsx
// [RENDER-GATE] Does the creditors screen survive a render, with rows that reach every branch?
//
// Run: npm run test:render
//
// The gate exists because tsc, eslint, next build and the Playwright smoke sweep are all blind to
// a /dashboard/* screen that throws on every render — see the header of money-screens.test.tsx.
// This screen is exactly the shape that hides such a bug: every list it draws arrives as a prop,
// and against an empty balance `[].map(cb)` never calls `cb`. So it is handed a real balance, a
// real aging table, a real corroboration panel — and, separately, the failed-read state, which is
// the branch a screen about money must never get wrong.

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
    usePathname: () => "/dashboard/leveranciers",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

const TODAY = "2026-08-30";

test("[LEVERANCIER-SALDO] the screen draws the wholesaler's own subtotal, its aging and its warnings", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { corroboratePayments } = await import("../../src/lib/payment-corroboration");
  const { buildSupplierBalancePanel, buildCorroborationPanel } =
    await import("../../src/lib/supplier-balance-copy");

  // The two invoices off the photo, plus the rows that reach the other branches: an unverified
  // bill, an invoice with no supplier, a creditnota and an aged one.
  const balance = supplierBalances({
    asOf: TODAY,
    settlements: [],
    invoices: [
      { id: "a", invoiceNumber: "2034488", supplierKey: "can vleesgroothandel", supplierName: "CAN Vleesgroothandel B.V.",
        invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur",
        totalIncBtw: 1165.73, amountPaid: 0 },
      { id: "b", invoiceNumber: "2034534", supplierKey: "can vleesgroothandel", supplierName: "CAN Vleesgroothandel B.V.",
        invoiceDate: "2026-08-22", dueDate: "2026-09-05", status: "received", invoiceType: "factuur",
        totalIncBtw: 1217.92, amountPaid: 0 },
      { id: "c", invoiceNumber: "CN-9", supplierKey: "can vleesgroothandel", supplierName: "CAN Vleesgroothandel B.V.",
        invoiceDate: "2026-08-20", dueDate: "2026-09-03", status: "received", invoiceType: "creditnota",
        totalIncBtw: -80, amountPaid: 0 },
      { id: "d", invoiceNumber: "263183", supplierKey: "groothandel m h bal", supplierName: "GROOTHANDEL M.H. BAL V.O.F.",
        invoiceDate: "2026-01-06", dueDate: "2026-01-20", status: "received", invoiceType: "factuur",
        totalIncBtw: 1085.33, amountPaid: 0 },
      { id: "e", invoiceNumber: "X-1", supplierKey: "groothandel m h bal", supplierName: "GROOTHANDEL M.H. BAL V.O.F.",
        invoiceDate: "2026-08-25", dueDate: null, status: "processing", invoiceType: "factuur",
        totalIncBtw: 999, amountPaid: 0 },
      { id: "f", invoiceNumber: "Z-1", supplierKey: null, supplierName: null,
        invoiceDate: "2026-08-10", dueDate: "2026-08-24", status: "received", invoiceType: "factuur",
        totalIncBtw: 400, amountPaid: 0 },
    ],
  });

  // The live case: a payment ticked past the edge of the bank data, plus a real supplier gap.
  const corroboration = corroboratePayments({
    coverage: { from: "2026-01-01", to: "2026-08-21" },
    claims: [
      { invoiceId: "a", invoiceNumber: "2034488", supplierName: "CAN Vleesgroothandel B.V.",
        supplierKey: "can vleesgroothandel", amountApplied: 1165.73, paidOn: "2026-08-29",
        method: "bank", transactionId: null },
      { invoiceId: "d", invoiceNumber: "263183", supplierName: "GROOTHANDEL M.H. BAL V.O.F.",
        supplierKey: "groothandel m h bal", amountApplied: 1085.33, paidOn: "2026-08-05",
        method: "bank", transactionId: null },
    ],
    debits: [{ supplierKey: "groothandel m h bal", date: "2026-08-05", amount: 200 }],
  });

  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(balance, "nl", TODAY),
      corroboration: buildCorroborationPanel(corroboration, "nl"),
      asOf: TODAY,
      today: TODAY,
    }),
  );

  assert.ok(html.length > 400, "the screen rendered something");
  // The figure off the photo, minus the creditnota that belongs to the same supplier.
  assert.match(html, /€&nbsp;2\.303,65|€ 2\.303,65/, "the supplier subtotal is on the screen");
  assert.match(html, /CAN Vleesgroothandel/);
  assert.match(html, /GROOTHANDEL M\.H\. BAL/);
  assert.match(html, /Stand op 30-08-2026/, "an amount without its date is not a fact");
  assert.match(html, /Ouderdom/, "the aging table drew");
  assert.match(html, /90\+/, "…including the bucket the January invoice falls in");
  assert.match(html, /bevestiging/, "the unverified bill is counted beside the total");
  assert.match(html, /niet aan een leverancier koppelen/, "and the unkeyed one is named");
  // The two corroboration sentences, in the order that matters.
  const live = html.indexOf("nieuwste bankafschrift");
  const gap = html.indexOf("Verschil");
  assert.ok(live > 0 && gap > 0 && live < gap, "the live case leads the real gap");
});

test("[LEVERANCIER-SALDO] a failed read shows a reason, never a comfortable zero", async () => {
  // The most dangerous sentence this screen could print is "er staat niets open" on an
  // administration it could not read. That branch draws its own panel and no total at all.
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const html = renderToStaticMarkup(
    React.createElement(Client, { balance: null, corroboration: null, asOf: TODAY, today: TODAY }),
  );
  assert.match(html, /konden je inkoopfacturen nu niet lezen/);
  assert.doesNotMatch(html, /€/, "no amount is shown at all — not even a zero");
});

test("[LEVERANCIER-SALDO] an empty balance is a sentence, and the screen still draws", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY),
      corroboration: null, asOf: TODAY, today: TODAY,
    }),
  );
  assert.match(html, /niets open bij een leverancier/);
});

test("[TAAL] the Arabic screen carries its direction and none of the Dutch", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({
          asOf: TODAY, settlements: [],
          invoices: [{ id: "a", invoiceNumber: "1", supplierKey: "can", supplierName: "CAN Vleesgroothandel B.V.",
            invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur",
            totalIncBtw: 1165.73, amountPaid: 0 }],
        }), "ar", TODAY),
      corroboration: null, asOf: TODAY, today: TODAY,
    }),
  );
  assert.match(html, /dir="rtl"/, "the direction travels with the words");
  assert.doesNotMatch(html, /Wat je nog moet betalen/, "the heading is really translated");
  // The supplier's own name is data, not copy — it stays exactly as the invoice states it.
  assert.match(html, /CAN Vleesgroothandel/);
});

// ── [LEVERANCIER-SAMENVOEGEN] The one panel on this screen that WRITES ────────────────────────
//
// Everything else here reports. This offers a button that rewrites what already-booked invoices
// say about who sent them, so what the owner reads before pressing it is part of the safety
// argument, not decoration — and a render is the only thing that can see it.
const REGISTRY = {
  ketelsA: { id: "ka", name: "W.KETELS & ZN EIERHANDEL", kvk: "17123456", invoiceCount: 25 },
  ketelsB: { id: "kb", name: "W. Ketels en Zoon Eierhandel", kvk: "17123456", invoiceCount: 3 },
  bal: { id: "bal", name: "GROOTHANDEL M.H. BAL V.O.F.", kvk: "17123456", invoiceCount: 72 },
  balkip: { id: "balkip", name: "BALKIP B.V.", kvk: "34129873", invoiceCount: 7 },
};

test("[LEVERANCIER-SAMENVOEGEN] the offer shows the proof, and says under which name the invoices land", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const { findMergeCandidates } = await import("../../src/lib/supplier-merge");
  const { buildSupplierMergePanel } = await import("../../src/lib/supplier-merge-copy");

  const plans = findMergeCandidates([REGISTRY.ketelsA, REGISTRY.ketelsB]);
  assert.equal(plans.length, 1, "the fixture must reach the offer branch, or nothing below is tested");
  const merge = buildSupplierMergePanel(plans, "nl");
  assert.ok(merge, "…and produce a panel");

  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY),
      corroboration: null, merge, asOf: TODAY, today: TODAY,
    }),
  );
  // What the OWNER reads. Tags out, and the entities back to characters: React writes the & of
  // "W.KETELS & ZN" as &amp;, and asserting against the raw markup would be asserting against a
  // spelling no one is ever shown.
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

  // The identifier itself is on the screen. The owner checks it against the two invoices in front
  // of them rather than taking the app's word for who these two companies are.
  assert.match(text, /17123456/, "the proof is quoted, not summarised");
  assert.match(text, /3 facturen/, "how many move");
  assert.match(text, /W\.KETELS & ZN EIERHANDEL/, "and under which name they land");
  // And the panel states its own rule, so an owner can see it is not matching on names.
  assert.match(text, /KVK-nummer of hetzelfde rekeningnummer/);
  assert.match(html, /Samenvoegen/, "the button is there");
});

test("[LEVERANCIER-SAMENVOEGEN] the one pair that may never be offered, is not", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const { findMergeCandidates } = await import("../../src/lib/supplier-merge");
  const { buildSupplierMergePanel } = await import("../../src/lib/supplier-merge-copy");

  // BALKIP B.V. and GROOTHANDEL M.H. BAL V.O.F. — one family name, two Chamber-of-Commerce
  // numbers, two companies. vendor-grounding.ts exists because one was once read as the other.
  const merge = buildSupplierMergePanel(findMergeCandidates([REGISTRY.bal, REGISTRY.balkip]), "nl");
  assert.equal(merge, null, "no evidence, no offer");

  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY),
      corroboration: null, merge, asOf: TODAY, today: TODAY,
    }),
  );
  assert.doesNotMatch(html, /Samenvoegen/, "and no button anywhere on the screen");

  // A screen rendered before this panel existed passes null in the same way and looks unchanged.
  const zonder = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY),
      corroboration: null, asOf: TODAY, today: TODAY,
    }),
  );
  assert.equal(zonder, html, "an absent panel and a refused one look the same, because they are");
});

test("[TAAL] the merge panel carries its own direction and none of the Dutch", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const { findMergeCandidates } = await import("../../src/lib/supplier-merge");
  const { buildSupplierMergePanel } = await import("../../src/lib/supplier-merge-copy");

  const merge = buildSupplierMergePanel(findMergeCandidates([REGISTRY.ketelsA, REGISTRY.ketelsB]), "ar");
  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "ar", TODAY),
      corroboration: null, merge, asOf: TODAY, today: TODAY,
    }),
  );
  assert.doesNotMatch(html, /Samenvoegen/, "the button is really translated");
  assert.doesNotMatch(html, /Zelfde KVK-nummer/, "…and so is the proof line");
  // The number in it is not copy: it is the identifier, and it reads the same in every language.
  assert.match(html, /17123456/);
});

// ── [LEVERANCIER-BEWERKEN] The registry list, and the door into the edit sheet ───────────────
//
// The rows arrive as props, so this is the one place that can see them drawn: the identifiers on
// the line, the edit button beside every row AND beside the balance line it maps to, a failed
// read that says "storing" rather than drawing an empty list, and the sheet itself.
const CARDS = [
  { id: "s1", name: "CAN Vleesgroothandel B.V.", iban: "NL20ABNA0458266515", kvk: "63458357", btw: "NL852244872B01",
    autoIncasso: false, defaultBtwRate: 9, defaultCategory: "kosten", country: "DE", invoiceCount: 3, balanceKey: "can vleesgroothandel", updatedOn: "2026-08-03" },
  // No IBAN, on incasso, never edited — the other branches of the description line.
  { id: "s2", name: "Verhuurder Jansen", iban: null, kvk: null, btw: null,
    autoIncasso: true, defaultBtwRate: null, defaultCategory: null, country: null, invoiceCount: 1, balanceKey: "verhuurder jansen", updatedOn: null },
];

test("[LEVERANCIER-BEWERKEN] the registry list draws every row with its identifiers and an edit button", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({
          asOf: TODAY, settlements: [],
          invoices: [{ id: "a", invoiceNumber: "1", supplierKey: "can vleesgroothandel", supplierName: "CAN Vleesgroothandel B.V.",
            invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur",
            totalIncBtw: 1165.73, amountPaid: 0 }],
        }), "nl", TODAY),
      corroboration: null, suppliers: CARDS, asOf: TODAY, today: TODAY,
    }),
  );
  assert.match(html, /Alle leveranciers/, "the section is there");
  assert.match(html, /NL20ABNA0458266515/, "the account number is on the line");
  assert.match(html, /KVK 63458357/);
  // [LEVERANCIER-LAND] A supplier abroad shows its country on the line; a Dutch one shows nothing.
  assert.match(html, /NL852244872B01 · DE/, "the foreign supplier's country is on the identifier line");
  assert.match(html, /geen rekeningnummer bekend/, "a row without an IBAN says so");
  assert.match(html, /automatische incasso/, "the mandate is visible");
  assert.match(html, /Laatst aangepast op 3 aug 2026/, "an edited row shows when, in the owner's date form");
  // [LEVERANCIER-STANDAARD] The defaults the owner set are on the line, in words the picker uses.
  assert.match(html, /9% btw/, "the fixed rate is on the line");
  assert.match(html, /Zakelijke kost/, "the category is named as the categorise screen names it");
  // One button per registry row, plus one on the balance line that maps to a registry row.
  const buttons = html.match(/Gegevens aanpassen/g) ?? [];
  assert.equal(buttons.length, 3, `${buttons.length} edit buttons — expected 2 rows + 1 balance line`);
});

test("[LEVERANCIER-BEWERKEN] a failed registry read is a failure on the screen, not an empty list", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const paint = (suppliers: typeof CARDS | null) => renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY),
      corroboration: null, suppliers, asOf: TODAY, today: TODAY,
    }),
  );
  const broken = paint(null);
  const empty = paint([]);
  assert.match(broken, /storing, geen lege lijst/, "the failure names itself");
  assert.doesNotMatch(broken, /Nog geen leveranciers/, "…and does not promise there are none");
  assert.match(empty, /Nog geen leveranciers/, "a really empty registry says it is empty");
  assert.doesNotMatch(empty, /Gegevens aanpassen/, "nothing to edit, no button");
});

test("[LEVERANCIER-BEWERKEN] the sheet is pre-filled from the ROW and warns before a replaced IBAN is saved", async () => {
  const { default: Sheet } = await import("../../src/components/supplier/SupplierEditSheet");
  const html = renderToStaticMarkup(
    React.createElement(Sheet, { supplier: CARDS[0], onClose() {}, onSaved() {} }),
  );
  assert.match(html, /Leverancier aanpassen/);
  // Pre-filled from the stored row, all four — the pin modal starts KVK and btw empty; this must not.
  assert.match(html, /value="NL20ABNA0458266515"/);
  assert.match(html, /value="63458357"/);
  assert.match(html, /value="NL852244872B01"/);
  assert.match(html, /geldt voor de volgende facturen/, "it says the edit is forward-only");
  // [LEVERANCIER-STANDAARD] The two defaults are pre-selected from the row, with a "none" option.
  assert.match(html, /Vast btw-tarief/);
  assert.match(html, /<option value="9" selected="">9%<\/option>|<option selected="" value="9">9%<\/option>/, "the stored rate is selected");
  assert.match(html, /Geen vast tarief/, "…and clearing it is an option");
  assert.match(html, /<option value="kosten" selected="">Zakelijke kost<\/option>|<option selected="" value="kosten">Zakelijke kost<\/option>/, "the stored category is selected");
  assert.match(html, /Geen vaste categorie/);
  // With the stored number still in the field there is no fraud warning to show.
  assert.doesNotMatch(html, /Je vervangt het rekeningnummer/, "no warning while the number is unchanged");
});

test("[TAAL] the sheet reads Arabic with its direction, and the identifiers keep theirs", async () => {
  const { default: Sheet } = await import("../../src/components/supplier/SupplierEditSheet");
  const { translate } = await import("../../src/lib/i18n/t");
  // The component reads the cookie; on the server there is none, so the check is on the copy
  // module: every sentence the sheet renders has its Arabic.
  for (const key of ["lev.bewerk.titel", "lev.bewerk.uitleg", "lev.bewerk.ibanGewijzigd", "lev.bewerk.incasso", "lev.bewerk.opslaan"] as const) {
    const ar = translate("ar", key, { oud: "NL20ABNA0458266515" });
    assert.ok(/[؀-ۿ]/.test(ar), `${key} has Arabic`);
    assert.ok(!/[a-z]{4}/.test(ar.replace(/NL20ABNA0458266515|KVK|btw|IBAN/g, "")), `${key} is not the Dutch: ${ar}`);
  }
  const html = renderToStaticMarkup(React.createElement(Sheet, { supplier: CARDS[0], onClose() {}, onSaved() {} }));
  assert.match(html, /dir="ltr"[^>]*value="NL20ABNA0458266515"|value="NL20ABNA0458266515"[^>]*dir="ltr"/, "an IBAN field is left-to-right in every language");
});

// ── [LEVERANCIER-NIEUW] Every line the balance shows can be edited — or added ─────────────────
//
// Trimex had 29 invoices and no button: its invoices carried no supplier_id and no row spelled
// its name the same way. The screen now asks the LINK first (the id most of a line's invoices
// point at), the name key second, and where both are empty it offers to make the row.
test("[LEVERANCIER-NIEUW] a linked line edits, an unlinked line offers to add, and the list can add from nothing", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const invoices = [
    // Linked by id to a row whose name key differs from the printed name.
    { id: "a", invoiceNumber: "1", supplierKey: "trimex international", supplierName: "TRIMEX INTERNATIONAL B.V.",
      invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur", totalIncBtw: 500, amountPaid: 0 },
    // No row anywhere.
    { id: "b", invoiceNumber: "2", supplierKey: "w ketels zn eierhandel", supplierName: "W. Ketels & ZN Eierhandel",
      invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur", totalIncBtw: 300, amountPaid: 0 },
  ];
  const cards = [{ id: "trx", name: "Trimex", iban: null, kvk: null, btw: null, autoIncasso: false, defaultBtwRate: null,
    defaultCategory: null, country: null, invoiceCount: 1, balanceKey: "trimex", updatedOn: null }];
  const paint = (suppliers: typeof cards | null, lineSupplier: Record<string, string>) => renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(supplierBalances({ asOf: TODAY, settlements: [], invoices }), "nl", TODAY),
      corroboration: null, suppliers, lineSupplier, asOf: TODAY, today: TODAY,
    }),
  );

  const html = paint(cards, { "trimex international": "trx" });
  assert.equal((html.match(/Gegevens aanpassen/g) ?? []).length, 2, "Trimex edits from the balance line AND its registry row — the link wins over the name key");
  assert.equal((html.match(/Voeg toe als leverancier/g) ?? []).length, 1, "Ketels, with no row, is offered as a new supplier");
  assert.match(html, /Nieuwe leverancier/, "…and a supplier can be added from nothing");

  // [NO-SILENT-EMPTY] Against a failed registry read nothing is offered: every line would look
  // unregistered, and each button would found a second row.
  const broken = paint(null, {});
  assert.doesNotMatch(broken, /Voeg toe als leverancier|Nieuwe leverancier/);
});

test("[LEVERANCIER-NIEUW] the sheet in create mode says what it makes, and has no delete", async () => {
  const { default: Sheet } = await import("../../src/components/supplier/SupplierEditSheet");
  const html = renderToStaticMarkup(
    React.createElement(Sheet, { supplier: null, create: { name: "W. Ketels & ZN Eierhandel", adoptInvoices: true }, onClose() {}, onSaved() {} }),
  );
  assert.match(html, /Nieuwe leverancier/);
  assert.match(html, /value="W\. Ketels &amp; ZN Eierhandel"/, "the printed name is pre-filled");
  assert.match(html, /komen onder dit bedrijf te hangen/, "it says the loose invoices will be linked");
  assert.match(html, /Toevoegen/);
  assert.doesNotMatch(html, /Leverancier verwijderen/, "nothing to remove while making");
});

test("[LEVERANCIER-VERWIJDEREN] an existing row offers removal in two steps, with the count in the second", async () => {
  const { default: Sheet } = await import("../../src/components/supplier/SupplierEditSheet");
  const html = renderToStaticMarkup(
    React.createElement(Sheet, { supplier: { ...CARDS[0], invoiceCount: 23 }, onClose() {}, onSaved() {} }),
  );
  assert.match(html, /Leverancier verwijderen/, "the first step is there");
  assert.doesNotMatch(html, /Ja, verwijderen/, "…and the second is not, until it is asked for");
  assert.doesNotMatch(html, /Het gaat om 23 facturen/, "the count belongs to the confirm step only");
});

// ── [SAMENVOEGEN-EIGENAAR] / [LEVERANCIER-ZOEKEN] ────────────────────────────────────────────
test("[SAMENVOEGEN-EIGENAAR] the sheet offers the other suppliers, and names both sides before the button", async () => {
  const { default: Sheet } = await import("../../src/components/supplier/SupplierEditSheet");
  const others = [{ id: "s2", name: "Trimex Internationaal" }, { id: "s3", name: "Enka Horeca B.V." }];
  const html = renderToStaticMarkup(
    React.createElement(Sheet, { supplier: CARDS[0], others, onClose() {}, onSaved() {} }),
  );
  assert.match(html, /Samenvoegen met een andere leverancier/);
  assert.match(html, /Trimex Internationaal/, "every other supplier is offered as the row that stays");
  assert.match(html, /Enka Horeca B\.V\./);
  assert.doesNotMatch(html, /Ja, samenvoegen/, "the confirm appears only once a row is picked");
  // Nothing to merge with → the section is absent rather than an empty picker.
  const alone = renderToStaticMarkup(React.createElement(Sheet, { supplier: CARDS[0], others: [], onClose() {}, onSaved() {} }));
  assert.doesNotMatch(alone, /Samenvoegen met een andere leverancier/);
  // And a row being MADE has nothing to merge yet.
  const nieuw = renderToStaticMarkup(React.createElement(Sheet, { supplier: null, create: { name: "X B.V.", adoptInvoices: false }, others, onClose() {}, onSaved() {} }));
  assert.doesNotMatch(nieuw, /Samenvoegen met een andere leverancier/);
});

test("[LEVERANCIER-ZOEKEN] the search filters the registry list and never the totals", async () => {
  const { default: Client } = await import("../../src/app/dashboard/leveranciers/LeveranciersClient");
  const { supplierBalances } = await import("../../src/lib/supplier-balances");
  const { buildSupplierBalancePanel } = await import("../../src/lib/supplier-balance-copy");
  const html = renderToStaticMarkup(
    React.createElement(Client, {
      balance: buildSupplierBalancePanel(
        supplierBalances({
          asOf: TODAY, settlements: [],
          invoices: [{ id: "a", invoiceNumber: "1", supplierKey: "can vleesgroothandel", supplierName: "CAN Vleesgroothandel B.V.",
            invoiceDate: "2026-08-15", dueDate: "2026-08-29", status: "received", invoiceType: "factuur", totalIncBtw: 1165.73, amountPaid: 0 }],
        }), "nl", TODAY),
      corroboration: null, suppliers: CARDS, asOf: TODAY, today: TODAY,
    }),
  );
  assert.match(html, /placeholder="Zoek een leverancier"/, "the box is there");
  // The first paint has no query, so every row is drawn and the balance total is untouched.
  assert.match(html, /CAN Vleesgroothandel/);
  assert.match(html, /Verhuurder Jansen/);
  assert.match(html, /1\.165,73/, "the total above the list is a total, not a filtered one");
});
