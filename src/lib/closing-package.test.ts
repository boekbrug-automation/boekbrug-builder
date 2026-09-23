// src/lib/closing-package.test.ts
// [BTW-RATE-GUARD] + [BANK-COVERAGE] Tests for the closing-package assembly.
// Pure / node-testable (JSZip only, no network).
// Run:  npx tsx src/lib/closing-package.test.ts
// (extensionless imports like the app; tsx resolves + strips types)

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import {
  buildOverviewCsv,
  costWithoutInvoiceWarning,
  cashCostWithoutReceiptWarning,
  cashCostsWithoutReceipt,
  assembleClosingPackageZip,
  buildLeesmij,
  effectiveDirection,
  datelessWarning,
  sharedOutsideWarning,
  pickPaymentDate,
  type PackageInvoice,
  type PaymentDateInfo,
} from "./closing-package";
import { buildAangifte } from "./aangifte";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invoice(over: Partial<PackageInvoice>): PackageInvoice {
  return {
    id: over.id ?? "inv-1",
    invoice_number: over.invoice_number ?? "2026-001",
    client_name: over.client_name ?? "Test Klant",
    status: over.status ?? "sent",
    invoice_type: over.invoice_type ?? "factuur",
    direction: over.direction ?? "outgoing",
    total_ex_btw: over.total_ex_btw ?? 100,
    btw_amount: over.btw_amount ?? 21,
    total_inc_btw: over.total_inc_btw ?? 121,
    invoice_date: over.invoice_date ?? "2026-02-10",
    payment_date: over.payment_date ?? null,
    due_date: over.due_date ?? "2026-03-10",
    pdf_url: over.pdf_url ?? null,
    document_id: over.document_id ?? null,
    client_btw_number: over.client_btw_number ?? null,
    marked_paid_at: over.marked_paid_at ?? null,
    sender_id: over.sender_id ?? null,
    receiver_id: over.receiver_id ?? null,
  };
}

const noPayDates = new Map<string, PaymentDateInfo>();

// ─── [BTW-RATE-GUARD] A mixed/odd rate must NOT be silently dropped ────────────

test("buildOverviewCsv keeps a standard 21% rate row", () => {
  const csv = buildOverviewCsv("Q1 2026", [invoice({})], [], [], noPayDates);
  assert.match(csv, /Uitgaand \(verkoop\);21%;100,00;21,00/);
});

test("buildOverviewCsv surfaces a blended (mixed-rate) invoice instead of dropping it", () => {
  // total_ex_btw=100, btw_amount=17 → derived rate = 17% (not a standard NL
  // rate). Before the guard, the [21,9,0]-only loop dropped this from the
  // overview entirely. It must now appear as a 17% row so the accountant can
  // trace it back to the source invoice.
  const blended = invoice({ id: "inv-mixed", total_ex_btw: 100, btw_amount: 17, total_inc_btw: 117 });
  const csv = buildOverviewCsv("Q1 2026", [blended], [], [], noPayDates);
  assert.match(csv, /Uitgaand \(verkoop\);17%;100,00;17,00/);
});

test("buildOverviewCsv prints standard rates before non-standard ones", () => {
  const std = invoice({ id: "std", total_ex_btw: 200, btw_amount: 42, total_inc_btw: 242 }); // 21%
  const odd = invoice({ id: "odd", total_ex_btw: 100, btw_amount: 17, total_inc_btw: 117 }); // 17%
  const csv = buildOverviewCsv("Q1 2026", [std, odd], [], [], noPayDates);
  const idx21 = csv.indexOf("Uitgaand (verkoop);21%");
  const idx17 = csv.indexOf("Uitgaand (verkoop);17%");
  assert.ok(idx21 !== -1 && idx17 !== -1, "both rate rows present");
  assert.ok(idx21 < idx17, "standard 21% row comes before the non-standard 17% row");
});

// ─── [BANK-COVERAGE] Honest bank warnings ──────────────────────────────────────

async function warningsFor(opts: { hasBankData: boolean; withFile: boolean }) {
  const { summary } = await assembleClosingPackageZip({
    year: 2026,
    quarter: 1,
    clientName: "Test Klant",
    outgoing: [],
    incoming: [],
    pdfByInvoice: new Map(),
    bankFiles: opts.withFile
      ? [{ path: "p", name: "afschrift.pdf", bytes: new Uint8Array([1, 2, 3]) }]
      : [],
    kilometerFiles: [],
    sharedFiles: [],
    paymentDates: noPayDates,
    hasBankData: opts.hasBankData,
    warnings: [],
  });
  return summary.warnings.map((w) => w.code);
}

test("no bank data → 'bank_missing' (real gap)", async () => {
  const codes = await warningsFor({ hasBankData: false, withFile: false });
  assert.ok(codes.includes("bank_missing"), "warns bank_missing");
  assert.ok(!codes.includes("bank_file_missing"), "not the softer file-only warning");
});

test("bank data present but file not attached → 'bank_file_missing', NOT 'bank_missing'", async () => {
  const codes = await warningsFor({ hasBankData: true, withFile: false });
  assert.ok(codes.includes("bank_file_missing"), "warns bank_file_missing");
  assert.ok(!codes.includes("bank_missing"), "must not claim the data is missing");
});

test("bank file attached → no bank warning at all", async () => {
  const codes = await warningsFor({ hasBankData: true, withFile: true });
  assert.ok(!codes.includes("bank_missing"), "no bank_missing");
  assert.ok(!codes.includes("bank_file_missing"), "no bank_file_missing");
});

// ─── [FIN-4] Null-direction rows are attributed by ownership, not dropped ──────

test("effectiveDirection keeps a stored direction", () => {
  assert.equal(effectiveDirection({ direction: "incoming", receiver_id: "x" }, "owner"), "incoming");
  assert.equal(effectiveDirection({ direction: "outgoing", receiver_id: "owner" }, "owner"), "outgoing");
});

test("effectiveDirection infers incoming when the owner is the receiver", () => {
  // A verified purchase saved with a null direction must NOT be dropped: the
  // owner receiving it makes it incoming.
  assert.equal(effectiveDirection({ direction: null, receiver_id: "owner" }, "owner"), "incoming");
});

test("effectiveDirection infers outgoing when the owner is not the receiver", () => {
  assert.equal(effectiveDirection({ direction: null, receiver_id: "someone-else" }, "owner"), "outgoing");
  assert.equal(effectiveDirection({ direction: null, receiver_id: null }, "owner"), "outgoing");
});

// ─── Kilometers is not a tracked feature → never warn (was 100%-fire noise) ────

test("kilometers_missing is never warned", async () => {
  // Every combination — there is no kilometer feature, so the package must not
  // claim a kilometer registration is "missing" on any package.
  for (const hasBankData of [true, false]) {
    for (const withFile of [true, false]) {
      const codes = await warningsFor({ hasBankData, withFile });
      assert.ok(!codes.includes("kilometers_missing"), "no kilometers_missing warning");
    }
  }
});

// ─── [AANGIFTE] The concept BTW-aangifte travels in the ZIP, traceable ──────────

const emptyAssemble = {
  year: 2026,
  quarter: 1 as const,
  clientName: "Kiwi Food Market",
  outgoing: [] as PackageInvoice[],
  incoming: [] as PackageInvoice[],
  pdfByInvoice: new Map(),
  bankFiles: [],
  kilometerFiles: [],
  sharedFiles: [],
  paymentDates: noPayDates,
  hasBankData: true,
  warnings: [],
};

test("concept-btw-aangifte.csv is written when a concept is present, matching the app figures", async () => {
  // The REAL Kiwi Q1 sales/voorbelasting → the concept that must land in the ZIP.
  const concept = buildAangifte(
    {
      salesByRate: [
        { rate: 21, omzet: 1185, btw: 249 },
        { rate: 9, omzet: 176604, btw: 15894 },
        { rate: 0, omzet: 222, btw: 0 },
      ],
      btwVoorbelasting: 15130,
      cashOmzetZonderBtw: 0,
    },
    { turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 40, outgoingInvoiceCount: 0, hasEuPurchase: false },
    "Q1 2026",
  );
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, conceptAangifte: concept });
  const zip = await JSZip.loadAsync(zipBytes);
  const csv = await zip.file("concept-btw-aangifte.csv")!.async("string");
  assert.match(csv, /GEEN ingediende aangifte/);
  assert.match(csv, /5g;Concept te betalen;;1013,00/);

  // overzicht.json carries the same concept block (5g = 1013), for machine reading.
  const json = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(json.concept_btw_aangifte.saldo_5g, 1013);
  assert.equal(json.concept_btw_aangifte.is_concept, true);
});

test("no concept → no concept-btw-aangifte.csv (never an invented empty filing)", async () => {
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, conceptAangifte: null });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("concept-btw-aangifte.csv"), null, "no concept file when nothing to declare");
  const json = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(json.concept_btw_aangifte, null);
});

test("[TRIANGLE] card reconciliation is written to the ZIP and a gross mismatch warns", async () => {
  const cardReconciliation = {
    days: [
      { date: "2026-03-01", tillPin: 1000, eftGross: 1000, bankNet: 985, grossMatch: true, grossDiff: 0, commission: 15, status: "ok" as const, breaks: [], notes: [] },
      { date: "2026-03-02", tillPin: 800, eftGross: 750, bankNet: 745, grossMatch: false, grossDiff: -50, commission: null, status: "gross_mismatch" as const, breaks: [], notes: [] },
    ],
    totalCommission: 15,
    grossMismatchDays: 1,
    incompleteDays: 0,
    commissionIssueDays: 0,
    eftGrossByDay: new Map([["2026-03-01", 1000], ["2026-03-02", 750]]),
  };
  const { zipBytes, summary } = await assembleClosingPackageZip({ ...emptyAssemble, cardReconciliation });
  const zip = await JSZip.loadAsync(zipBytes);
  const csv = await zip.file("kaart-reconciliatie.csv")!.async("string");
  assert.match(csv, /1000,00;1000,00;;985,00;15,00;sluit aan/, "the reconciled day shows in the CSV");
  assert.match(csv, /verschil kassa\/terminal/, "the mismatch day is flagged");
  assert.ok(summary.warnings.some((w) => w.code === "card_gross_mismatch"), "a gross-mismatch warning is raised");
});

test("[TRIANGLE] no card reconciliation → no kaart-reconciliatie.csv", async () => {
  const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble, cardReconciliation: null });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("kaart-reconciliatie.csv"), null, "no card file when there is nothing to reconcile");
});

// ─── [NO-EMPTY-LEDGER] Een onleesbaar grootboek levert géén compleet ogend concept ────────────
//
// Het gevaarlijkste wat dit pakket kan doen is er compleet uitzien terwijl er een been ontbreekt.
// De kas- en banklezingen in buildClosingPackage eindigden op `.catch(() => [])`: een mislukte
// lezing werd een LEGE la, en de concept-BTW-aangifte rekende daar gewoon mee door — de
// boekhouder kreeg een aangifte waarin het contante kwartaal simpelweg niet bestond, zonder één
// teken dat er iets mis was.
//
// buildClosingPackage zelf heeft een Supabase-client nodig en valt buiten deze poort. Wat hier
// wél te bewaken is, is het CONTRACT dat de reparatie oplegt en dat een latere wijziging stil
// zou kunnen breken: verschijnt er een leesfout-waarschuwing, dan hoort er geen concept in de
// ZIP te zitten. De bewijsstukken blijven wél gewoon meegaan.
//
// [PACKAGE-FAIL-CLOSED] The builder no longer gets this far with an unread ledger: it refuses the
// package outright (closing-package-sources.test.ts). This stays as the assembler's own floor — a
// read-failure warning handed to it directly must still never travel with a concept.

const LEESFOUT_CODES = ["cash_read_failed", "bank_read_failed", "kasboek_unavailable"] as const;

test("[NO-EMPTY-LEDGER] een leesfout-waarschuwing gaat nooit samen met een concept in de ZIP", async () => {
  for (const code of LEESFOUT_CODES) {
    const { zipBytes, summary } = await assembleClosingPackageZip({
      year: 2026,
      quarter: 1,
      clientName: "Test Klant",
      outgoing: [],
      incoming: [],
      pdfByInvoice: new Map(),
      bankFiles: [{ path: "p", name: "afschrift.pdf", bytes: new Uint8Array([1, 2, 3]) }],
      kilometerFiles: [],
      sharedFiles: [],
      paymentDates: noPayDates,
      hasBankData: true,
      // Wat buildClosingPackage deed zodra een grootboeklezing faalde: de reden meesturen en het
      // concept weglaten. (Now it builds no package at all — see the note above.)
      conceptAangifte: null,
      warnings: [{ code, message: "De boekingen konden niet volledig worden gelezen." }],
    });

    const zip = await JSZip.loadAsync(zipBytes);
    assert.equal(
      zip.file("concept-btw-aangifte.csv"),
      null,
      `${code}: er mag geen concept-aangifte in het pakket zitten`,
    );
    assert.ok(
      summary.warnings.some((w) => w.code === code),
      `${code}: de reden moet de boekhouder bereiken, niet stilzwijgend verdwijnen`,
    );
    // En het bewijs gaat wél mee — kijken en exporteren blijft altijd werken.
    assert.ok(zip.file("bankafschrift/afschrift.pdf"), `${code}: het bankafschrift hoort gewoon mee te gaan`);
    assert.ok(zip.file("overzicht.csv"), `${code}: het overzicht hoort er te zijn`);
  }
});

test("[NO-EMPTY-LEDGER] de waarschuwing staat leesbaar in overzicht.csv", async () => {
  // De boekhouder opent overzicht.csv, niet de JSON. Staat de reden daar niet, dan is hij stil.
  const csv = buildOverviewCsv("Q1 2026", [], [], [
    { code: "cash_read_failed", message: "De kasboekingen konden niet volledig worden gelezen." },
  ], noPayDates);
  assert.ok(csv.includes("kasboekingen konden niet volledig worden gelezen"),
    "de reden hoort in het overzicht te staan dat de boekhouder daadwerkelijk opent");
});

// ─── [PACKAGE-VOORBELASTING] Costs paid by bank with no purchase invoice ──────
//
// THE SILENT LOSS THIS GUARDS
// Rent, telecom, insurance paid straight from the account. A bare bank line carries no BTW
// document, so the euro lands in the costs and the deductible BTW does NOT — the owner pays
// more BTW than they owe. Nothing looks wrong from the app's side: the line has a category,
// it is placed, every total adds up. That is exactly why it needs to be said out loud.
//
// readiness.ts warns the OWNER. This test is about the ACCOUNTANT: the warning has to reach
// the package too, because a risk does not block a hand-over.

test("[VOORBELASTING] costs without a purchase invoice produce a warning for the accountant", () => {
  const w = costWithoutInvoiceWarning(3, 1250.5);
  assert.ok(w, "three coded costs without an invoice must warn");
  assert.equal(w!.code, "bank_cost_without_invoice");
  assert.match(w!.message, /3 banktransactie/);
  assert.match(w!.message, /voorbelasting/, "the consequence must be named, not just the count");
  assert.match(w!.message, /5b/, "and the rubriek, so the accountant can place it");
});

test("[VOORBELASTING] the AMOUNT is in the message — a count alone does not convey the size", () => {
  // "2 transactions" reads the same whether it is €40 or €40.000. The euro figure is what makes
  // an owner go and look for the invoices.
  const w = costWithoutInvoiceWarning(2, 4000);
  assert.ok(w!.message.includes("4.000") || w!.message.includes("4000"), w!.message);
});

test("[VOORBELASTING] nothing to report stays silent — no invented warning", () => {
  // A package full of warnings that are not real teaches the owner to skip the list, and then
  // the ONE that matters is skipped too.
  assert.equal(costWithoutInvoiceWarning(0, 0), null);
  assert.equal(costWithoutInvoiceWarning(-1, 0), null, "a negative count is a bug, not a warning");
});

test("[VOORBELASTING] the message says the cost DID count — only the BTW did not", () => {
  // The trap in wording this: an owner who reads "no invoice" may conclude the amount fell out
  // of the books entirely and start correcting a thing that is already right. The cost counts;
  // the voorbelasting is what is missing.
  const w = costWithoutInvoiceWarning(1, 100);
  assert.match(w!.message, /telt wel mee in de kosten/);
});

// ─── [PACKAGE-VOORBELASTING-KAS] Cash costs booked without a receipt ──────────
//
// The same silent loss as the bank case, one drawer over: financial-result claims voorbelasting
// on a cash cost ONLY when a bon is linked AND a rate is set. Without both, the FULL GROSS books
// as cost and the BTW is gone. Correct behaviour — never invent a deduction — but nobody is told.

test("[VOORBELASTING-KAS] a cash cost without a bon is counted, with its amount", () => {
  const { count, total } = cashCostsWithoutReceipt([
    { direction: "out", amount: 60, category: "kosten", document_id: null },
    { direction: "out", amount: 40.5, category: "kosten" },
  ]);
  assert.equal(count, 2);
  assert.equal(total, 100.5);
  assert.match(cashCostWithoutReceiptWarning(count, total)!.message, /voorbelasting/);
});

test("[VOORBELASTING-KAS] a cost WITH a bon is not flagged — its BTW is already claimed", () => {
  const { count } = cashCostsWithoutReceipt([
    { direction: "out", amount: 60, category: "kosten", document_id: "doc-1" },
  ]);
  assert.equal(count, 0, "a documented cash cost has nothing to warn about");
});

test("[VOORBELASTING-KAS] sales and refunds are not costs", () => {
  // A cash SALE needs no purchase document, and money IN under 'kosten' is a refund OF a cost —
  // it has no voorbelasting of its own to reclaim. Counting either would be a false alarm, and a
  // false alarm in this list is what teaches an owner to stop reading it.
  const { count } = cashCostsWithoutReceipt([
    { direction: "in", amount: 200, category: "omzet", document_id: null },
    { direction: "in", amount: 25, category: "kosten", document_id: null },
    { direction: "out", amount: 50, category: "prive", document_id: null },
  ]);
  assert.equal(count, 0);
});

test("[VOORBELASTING-KAS] an empty drawer says nothing", () => {
  assert.equal(cashCostWithoutReceiptWarning(0, 0), null);
  assert.deepEqual(cashCostsWithoutReceipt([]), { count: 0, total: 0 });
});


// [NO-SILENT-EMPTY] A verified invoice with no invoice_date sits in NO quarter package and NO
// concept aangifte — Postgres range filters drop NULL rows — so its BTW simply vanishes. This
// warning exists to catch that. When its own query fails it used to report count 0, which the
// package then presented as "there are none": the invoices still vanished, and now the package had
// actively said they did not exist.
test("[NO-SILENT-EMPTY] a dateless check that could not run warns instead of reporting none", () => {
  const unchecked = datelessWarning({ count: 0, labels: [], checked: false });
  assert.ok(unchecked, "a failed check must still produce a warning");
  assert.equal(unchecked!.code, "invoice_no_date");
  assert.match(unchecked!.message, /konden niet nagaan/);

  // A check that RAN and found nothing stays silent — otherwise the warning is on every package
  // and means nothing.
  assert.equal(datelessWarning({ count: 0, labels: [], checked: true }), null);

  // And a real find still names the invoices, which is what makes it actionable.
  const found = datelessWarning({ count: 2, labels: ["F-1", "F-2"], checked: true });
  assert.match(found!.message, /F-1, F-2/);
  assert.doesNotMatch(found!.message, /konden niet nagaan/);
});

test("[NO-SILENT-EMPTY] shared documents that could not be read are named, not assumed absent", () => {
  // This read decides BOTH what goes into the ZIP and what the package warns about. A dropped error
  // shipped the accountant a quarter with its shared documents missing and nothing saying they were
  // ever expected.
  const unchecked = sharedOutsideWarning(0, false);
  assert.ok(unchecked, "a failed read must still produce a warning");
  assert.match(unchecked!.message, /konden de gedeelde bestanden nu niet ophalen/);

  // A read that RAN with everything in this quarter stays silent.
  assert.equal(sharedOutsideWarning(0, true), null);
  // And a real count still says how many sit outside.
  assert.match(sharedOutsideWarning(3, true)!.message, /3 gedeeld/);
});

// ─── [SLUIS] The supplier's own e-factuur, next to his PDF ────────────────────

// The one thing in this package that no accounting package has to SCAN. A purchase invoice in
// UBL/CII is read mechanically straight into a booking; a PDF is OCR'd and then corrected by a
// human. The supplier already sent the XML and the e-mail import already stored it — this is only
// about handing it over.
//
// The base name is the whole trick and it is easy to get subtly wrong: intake services pair a PDF
// and an XML BY FILENAME and treat the pair as one document. Two names make two documents out of
// one invoice, and then a failed XML no longer falls back to the PDF — it becomes a second,
// half-read record of a bill that exists once.

const incomingInvoice = (over: Partial<PackageInvoice> = {}) =>
  invoice({
    id: "in-1",
    direction: "incoming",
    invoice_number: "F-9911",
    client_name: "Sligro",
    invoice_date: "2026-02-04",
    status: "paid",
    document_id: "doc-1",
    ...over,
  });

const bytes = (s: string) => new TextEncoder().encode(s);

async function entriesOf(zipBytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipBytes);
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

test("[SLUIS] the e-factuur lands beside its PDF under the SAME base name", async () => {
  const inv = incomingInvoice();
  const { zipBytes, summary } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, { path: "u/incoming/1-f9911.pdf", name: "f9911.pdf", bytes: bytes("%PDF-1.7") }]]),
    xmlByInvoice: new Map([[inv.id, { path: "u/incoming/2-f9911.xml", name: "f9911.xml", bytes: bytes("<Invoice/>") }]]),
    paymentDates: noPayDates,
  });

  const names = await entriesOf(zipBytes);
  const pdf = names.find((n) => n.endsWith(".pdf") && n.startsWith("facturen-en-bonnen/"));
  const xml = names.find((n) => n.endsWith(".xml") && n.startsWith("facturen-en-bonnen/"));
  assert.ok(pdf, "the invoice PDF is missing from the package");
  assert.ok(xml, "the supplier's e-factuur was not added");
  assert.equal(
    xml!.replace(/\.xml$/, ""),
    pdf!.replace(/\.pdf$/, ""),
    "the two files must share one base name — a service that pairs them by name sees two documents otherwise",
  );
  // Same folder, so a drag-and-drop of one directory carries the pair together.
  assert.match(xml!, /^facturen-en-bonnen\/inkomend\/betaald\//);

  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1, "the count the accountant reads must say one");
  assert.equal(summary.filesIncluded, 2, "the XML is a file in the package, not a free rider");
});

test("[SLUIS] an e-factuur that IS the only evidence is written once, not twice", async () => {
  // A supplier who sends nothing but UBL. Then the invoice's stored document is that XML, so the
  // ordinary evidence line already wrote it — under its own .xml extension, thanks to
  // [EVIDENCE-EXT]. Writing it again would put a second entry with the identical name into the
  // archive: JSZip keeps the last, nothing looks broken, and the count would claim a file the ZIP
  // does not separately contain.
  const inv = incomingInvoice({ id: "in-2" });
  const same = { path: "u/incoming/3-only.xml", name: "only.xml", bytes: bytes("<Invoice/>") };
  const { zipBytes, summary } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, same]]),
    xmlByInvoice: new Map([[inv.id, same]]),
  });

  const names = await entriesOf(zipBytes);
  const inFolder = names.filter((n) => n.startsWith("facturen-en-bonnen/"));
  assert.equal(inFolder.length, 1, `expected one evidence file, got: ${inFolder.join(", ")}`);
  assert.match(inFolder[0], /\.xml$/, "and it keeps its real extension");
  assert.equal(summary.filesIncluded, 1);

  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1, "it still counts — it is simply not written twice");
});

test("[SLUIS] an invoice without an e-factuur gets none, and the count stays honest", async () => {
  const withXml = incomingInvoice({ id: "in-3", invoice_number: "F-1" });
  const without = incomingInvoice({ id: "in-4", invoice_number: "F-2" });
  const { zipBytes } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [withXml, without],
    pdfByInvoice: new Map([
      [withXml.id, { path: "u/incoming/a.pdf", name: "a.pdf", bytes: bytes("%PDF") }],
      [without.id, { path: "u/incoming/b.pdf", name: "b.pdf", bytes: bytes("%PDF") }],
    ]),
    xmlByInvoice: new Map([[withXml.id, { path: "u/incoming/a.xml", name: "a.xml", bytes: bytes("<Invoice/>") }]]),
  });

  const names = await entriesOf(zipBytes);
  assert.equal(names.filter((n) => n.endsWith(".xml")).length, 1);
  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 1);
});

test("[SLUIS] a package built without the map is unchanged, never broken", async () => {
  // Optional on purpose: every existing caller and every test above passes no map at all. It must
  // mean "there were none", and it must not mean a crash halfway through an accountant's download.
  const inv = incomingInvoice({ id: "in-5" });
  const { zipBytes } = await assembleClosingPackageZip({
    ...emptyAssemble,
    incoming: [inv],
    pdfByInvoice: new Map([[inv.id, { path: "u/incoming/c.pdf", name: "c.pdf", bytes: bytes("%PDF") }]]),
  });
  const names = await entriesOf(zipBytes);
  assert.equal(names.filter((n) => n.endsWith(".xml")).length, 0);
  const zip = await JSZip.loadAsync(zipBytes);
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.e_facturen_bijgevoegd, 0);
});

// ─── [SLUIS] The gate the value tests cannot be ────────────────────────────────

test("[SLUIS] the orchestrator really hands the e-facturen over, and really checks them", () => {
  // xmlByInvoice is OPTIONAL, which is right for callers that have none — and is exactly why this
  // gate exists. Drop the one line that passes the map and every test above still passes: they
  // call the assembler directly. What ships is a package with no e-facturen in it, identical in
  // every visible way to a quarter that genuinely had none.
  //
  // The other three claims are the ones that make the XML safe to put next to a PDF under that
  // PDF's name. Together they say: this file belongs to THIS invoice (documents.invoice_id), it
  // sits in THIS owner's folder, the owner has not thrown it away, and its CONTENT is an invoice
  // rather than a CAMT.053 statement that happens to end in .xml.
  const src = readFileSync("src/lib/closing-package.ts", "utf8");

  assert.match(
    src,
    /^\s*xmlByInvoice,\s*$/m,
    "the orchestrator no longer passes xmlByInvoice — every package now ships without e-facturen, silently",
  );
  assert.match(src, /looksLikeInvoiceXmlBytes\(/, "the content check is no longer CALLED — any .xml would be shipped as an e-factuur");
  assert.match(src, /xmlDocs = await fetchAllRowsForIds</, "[IN-CHUNK] the stored-e-factuur read is a bare .in() again — it truncates a busy quarter in silence");
  assert.match(src, /\.in\("invoice_id", chunk\)/, "the e-facturen are no longer tied to their own invoice");
  assert.match(src, /if \(!pathBelongsToOwner\(pad, ownerId\)\) continue;/, "[SEC-STORAGE-PATH] the owner-folder check on the e-factuur path is gone");
  assert.match(src, /\.eq\("trashed", false\)/, "a discarded file is being delivered to the accountant again");

  // And the outgoing half: OUR e-factuur, built here rather than only behind a download button
  // almost nobody presses. Through the shared mapper, never a second hand-written copy of it —
  // that mapping has silently dropped a column twice (see ubl-inputs.ts).
  assert.match(src, /buildInvoiceUbl\(/, "the package no longer generates the owner's own e-facturen");
  assert.match(src, /ublHeaderFrom\(/, "the header is being mapped somewhere other than the one shared place");
  assert.match(src, /ublLinesFrom\(/, "the lines are being mapped somewhere other than the one shared place");
  assert.match(src, /\{ korActive \}/, "[E-FACTUUR-VERLEGD] without kor_active a 0% invoice to an EU customer is called a verlegde prestatie");
  assert.match(src, /code: "efactuur_missing"/, "an invoice that could not become an e-factuur is being dropped without a word");

  // [AFLETTEREN] And the file that hands over WORK rather than documents. Its failure mode is the
  // quiet one: drop the line that builds it and every value test above still passes, because they
  // hand the assembler a reconciliation directly. What ships is a package without one, exactly
  // like a quarter that had no bank lines.
  assert.match(src, /buildBankHandoverCsv\(/, "the package no longer hands over the afletering");
  // [PACKAGE-FAIL-CLOSED] A failed bank read no longer reaches this file at all: no package is built
  // (closing-package-sources.test.ts fails the read and shows it). What is left to hold here is that
  // the afletering is built from the rows that were read in full, and from nothing else.
  assert.match(src, /const bankAllRows = await required\("bank_transactions"/, "the rows under the afletering are no longer a required read — an unread quarter reads as 'all matched'");
  assert.match(src, /const rows = bankAllRows as HandoverTx\[\];/, "the afletering is no longer built from the rows that were read");
  assert.match(src, /^\s*bankHandover,\s*$/m, "…and it is never built and then not passed on");

  // [VERANTWOORDING] The cover page is rendered inside the assembler, where the numbers are final.
  // Its own failure mode: a render that throws must cost a cover sheet, never the quarter — and it
  // must SAY so, because an absent page nobody can explain is worse than a stated gap.
  assert.match(src, /renderVerantwoordingPdf\(/, "the package no longer produces the page that can be filed");
  assert.match(src, /code: "verantwoording_failed"/, "a failed render is being swallowed");
  assert.match(src, /ownerKvk,/, "the owner's identifiers never reach the page it is filed against");

  // [DEKKING] The question the reconciliation's whole claim rests on. A quarter in which February
  // was never imported produces an afletering where every line is neatly matched and none of it is
  // true — and nothing else in this package can see that, because a gap-scan between statements is
  // structurally blind to a month missing at the edge.
  assert.match(src, /coverageOfPeriod\(periods, start, end\)/, "the package no longer asks whether the bank data covers the quarter");
  assert.match(src, /from\("bank_statement_periods"\)/, "…and it is asking it of nothing");
  assert.match(src, /code: "bank_coverage_incomplete"/, "a quarter with a month missing is being handed over without a word");
  // Both destinations, because they are two different readers: the CSV banner is for the person
  // working through the open lines, the cover-page line is for whoever is shown the page later.
  // One `coverage: coverageWarning` satisfies a loose match while the other is quietly null.
  assert.equal(
    (src.match(/coverage: coverageWarning,/g) ?? []).length, 2,
    "the qualification must reach BOTH the reconciliation CSV and the cover page",
  );

  // [DOORLOPEND] Art. 35 continuity, computed over the WHOLE administration and not over the
  // quarter. That distinction is the trap: the counter runs per (year, type), so held against Q1's
  // invoices alone a package built in December reports forty "burned" numbers that were in fact
  // issued in Q2 and Q3 — a false gap on the one check that may never be falsely alarming.
  assert.match(src, /checkContinuity\(\{ invoices: numberRows, formats, counters \}\)/, "the package no longer checks the numbering");
  assert.doesNotMatch(
    src,
    /invoices: numberRows[\s\S]{0,80}?invoice_date/,
    "the numbering read must not be filtered to the quarter",
  );
  assert.match(src, /code: "numbering_not_continuous"/, "a broken series is being handed over without a word");
  assert.match(src, /^\s*numbering,\s*$/m, "the verdict is computed and then not passed to the page");
});

// ─── [SLUIS] The reading instruction ──────────────────────────────────────────

// Unzipped, the machine feed and the human documents look alike, and there is one rule the
// accountant has to be TOLD rather than left to infer: a .pdf and the .xml beside it are one
// invoice, and separating or renaming either makes two out of one.

const leesmij = (over: Partial<Parameters<typeof buildLeesmij>[0]> = {}) =>
  buildLeesmij({
    quarterLabel: "Q1 2026", clientName: "Kiwi Food Market",
    outgoingCount: 12, incomingCount: 30, eInvoiceCount: 7,
    bankStatementIncluded: true, warnings: [], ...over,
  });

test("[SLUIS] the LEESMIJ says which folder goes into the program and which files are to be read", () => {
  const txt = leesmij();
  assert.match(txt, /facturen-en-bonnen\//);
  assert.match(txt, /bankafschrift\//);
  assert.match(txt, /overzicht\.csv/);
  assert.match(txt, /concept-btw-aangifte\.csv/);
  // And the sentence that keeps a concept from being read as a filing.
  assert.match(txt, /niet ingediend/i, "a concept aangifte must never read as a filed one");
  assert.match(txt, /Kiwi Food Market/);
  assert.match(txt, /Q1 2026/);
});

test("[SLUIS] the pairing rule is stated, and so is what the XML is worth per direction", () => {
  // THE ONE THAT MATTERS. An accountant who mails only the .xml of a SALES invoice into SnelStart
  // finds that nothing arrived — their mailbox does not read a verkoop-UBL and takes the PDF
  // beside it instead. Saying that here costs one line and is the only misunderstanding this file
  // could otherwise cause.
  const txt = leesmij({ eInvoiceCount: 7 });
  assert.match(txt, /dezelfde bestandsnaam/, "the pairing is by name — that is the whole rule");
  assert.match(txt, /hernoem ze niet/i);
  assert.match(txt, /INKOOPfactuur[\s\S]*?rechtstreeks ingelezen/, "a purchase UBL is read mechanically");
  assert.match(txt, /SnelStart[\s\S]*?verkoop-UBL \(nog\) niet/, "and a sales UBL is not, at that door");
  assert.match(txt, /nooit alleen de \.xml/);
});

test("[SLUIS] with no e-facturen it says so, instead of explaining a rule about nothing", () => {
  const txt = leesmij({ eInvoiceCount: 0 });
  assert.match(txt, /geen e-factuur \(UBL\)/);
  assert.doesNotMatch(txt, /hernoem ze niet/, "a pairing rule about zero pairs is noise on a page someone has to read");
});

test("[SLUIS] every warning is repeated where a person will actually see it", () => {
  // They stand in overzicht.csv and overzicht.json too. Repeated here because this is the file
  // that gets opened first, and a gap nobody read about is a gap that reaches the aangifte.
  const txt = leesmij({
    warnings: [
      { code: "bank_missing", message: "Geen banktransacties gevonden voor dit kwartaal." },
      { code: "efactuur_missing", message: "Van 2 facturen kon geen e-factuur worden gemaakt: 001, 002." },
    ],
  });
  assert.match(txt, /Geen banktransacties gevonden/);
  assert.match(txt, /Van 2 facturen kon geen e-factuur/);
  assert.match(txt, /NIET HEBBEN KUNNEN VASTSTELLEN/);

  // And when there is nothing to report it says THAT, rather than leaving a heading with a blank
  // under it that reads like a section somebody forgot to fill in.
  const clean = leesmij({ warnings: [] });
  assert.match(clean, /geen onvolkomenheden/);
  assert.doesNotMatch(clean, /NIET HEBBEN KUNNEN VASTSTELLEN/);
});

test("[SLUIS] a missing bank statement is called out on its own", () => {
  assert.match(leesmij({ bankStatementIncluded: false }), /bankafschrift zit niet in dit pakket/);
  assert.doesNotMatch(leesmij({ bankStatementIncluded: true }), /zit niet in dit pakket/);
});

test("[SLUIS] the LEESMIJ is in the ZIP, and is not counted as evidence", () => {
  return (async () => {
    const inv = incomingInvoice({ id: "in-9" });
    const { zipBytes, summary } = await assembleClosingPackageZip({
      ...emptyAssemble,
      incoming: [inv],
      pdfByInvoice: new Map([[inv.id, { path: "u/incoming/z.pdf", name: "z.pdf", bytes: bytes("%PDF") }]]),
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const txt = await zip.file("LEESMIJ.txt")!.async("string");
    assert.match(txt, /BoekBrug — kwartaalpakket/);
    // One evidence file went in. The instruction sheet is not one — same as overzicht.json — and
    // counting it would make this number disagree with the handoff screen's.
    assert.equal(summary.filesIncluded, 1);
    const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
    assert.equal(overzicht.bestanden_bijgevoegd, 1);
  })();
});

// ─── [AFLETTEREN] The reconciliation, in the package and in the LEESMIJ ───────

const totals = (over: Partial<import("./bank-handover").HandoverTotals> = {}) => ({
  lines: 40, matched: 34, unmatched: 6, matchedAmount: 4210, unmatchedAmount: 380, withDifference: 2, ...over,
});

test("[AFLETTEREN] the LEESMIJ leads with what is already done and names what is not", () => {
  // The only line in that file about the accountant's HOURS rather than about our filing. Stated
  // with a number and with the open lines in the same breath — a reconciliation that shows only
  // its successes tells a professional nothing, because he cannot tell whether he is seeing all
  // of them.
  const txt = leesmij({ handover: totals() });
  assert.match(txt, /Van de 40 bankregels/);
  assert.match(txt, /zijn er 34/);
  assert.match(txt, /6 regels staan nog open/);
  assert.match(txt, /bankafletering\.csv/);
  assert.match(txt, /Bij 2 gekoppelde regels wijkt het bedrag af/);
  assert.match(txt, /deelbetaling/, "…and that a difference is not automatically an error");
});

test("[AFLETTEREN] with nothing left open it says so, and singulars read like Dutch", () => {
  const done = leesmij({ handover: totals({ matched: 40, unmatched: 0, withDifference: 0 }) });
  assert.match(done, /geen enkele regel meer open/);
  assert.doesNotMatch(done, /wijkt het bedrag af/);

  const one = leesmij({ handover: totals({ lines: 1, matched: 1, unmatched: 0, withDifference: 1 }) });
  assert.match(one, /is er 1 al aan een factuur gekoppeld/);
  assert.match(one, /Bij 1 gekoppelde regel wijkt/);
});

test("[AFLETTEREN] a package with no reconciliation makes no claim about one", () => {
  // No bank lines at all, or a read that failed. Either way the sentence must be absent rather
  // than present with zeroes in it — "0 van 0 gekoppeld" reads as a finished job.
  const txt = leesmij({ handover: null });
  assert.doesNotMatch(txt, /bankregels in dit kwartaal/);
});

test("[AFLETTEREN] bankafletering.csv is in the ZIP, and overzicht.json carries its totals", () => {
  return (async () => {
    const inv = incomingInvoice({ id: "in-10" });
    const { zipBytes } = await assembleClosingPackageZip({
      ...emptyAssemble,
      incoming: [inv],
      pdfByInvoice: new Map([[inv.id, { path: "u/incoming/q.pdf", name: "q.pdf", bytes: bytes("%PDF") }]]),
      bankHandover: { csv: "Status;Datum\r\nNog te koppelen;2026-02-02", totals: totals() },
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const csv = await zip.file("bankafletering.csv")!.async("string");
    assert.match(csv, /Nog te koppelen/);
    const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
    assert.equal(overzicht.afletteren.bankregels, 40);
    assert.equal(overzicht.afletteren.nog_te_koppelen, 6);
    assert.equal(overzicht.afletteren.bedrag_nog_te_koppelen, 380);
  })();
});

test("[AFLETTEREN] no reconciliation → no file and a null in the JSON, never a zero", () => {
  return (async () => {
    const { zipBytes } = await assembleClosingPackageZip({ ...emptyAssemble });
    const zip = await JSZip.loadAsync(zipBytes);
    assert.equal(zip.file("bankafletering.csv"), null);
    const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
    assert.equal(overzicht.afletteren, null, "a zero here reads as 'nothing needed matching'");
  })();
});

// ─── [VERANTWOORDING] The page that leaves the archive ────────────────────────

test("[VERANTWOORDING] the cover page is in the ZIP, named for its quarter", () => {
  return (async () => {
    const inv = incomingInvoice({ id: "in-11" });
    const { zipBytes } = await assembleClosingPackageZip({
      ...emptyAssemble,
      incoming: [inv],
      pdfByInvoice: new Map([[inv.id, { path: "u/incoming/v.pdf", name: "v.pdf", bytes: bytes("%PDF") }]]),
      ownerKvk: "94386676",
      ownerBtw: "NL005079680B23",
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const file = zip.file("Verantwoording-Q1-2026.pdf");
    assert.ok(file, "the cover page is missing from the package");
    const head = await file!.async("string");
    assert.ok(head.startsWith("%PDF"), "it must be a real PDF, not a text file with a pdf name");
  })();
});

test("[VERANTWOORDING] the LEESMIJ points at it, in the list of things to read", () => {
  assert.match(leesmij(), /Verantwoording-…pdf/);
  assert.match(leesmij(), /in je dossier/, "and says what it is for — a page to file, not another export");
});

// ─── [XAF-IN-PAKKET] The auditfile the accountant's mail has been promising ────────────────────

test("[XAF-IN-PAKKET] the auditfile goes into the ZIP, named for its window", async () => {
  // The defect: email.ts told every accountant the package "bevat de PDF's, een CSV-overzicht en
  // het XAF 3.2-auditbestand", and told them in the next paragraph "je hebt hiervoor geen account
  // nodig" — while buildXafFile's only caller was /api/xaf, behind a login. A promise the reader
  // cannot collect.
  const { zipBytes, summary } = await assembleClosingPackageZip({
    ...emptyAssemble,
    quarter: 2 as const,
    auditfile: {
      xml: "<?xml version=\"1.0\"?><auditfile/>",
      entryCount: 143,
      skippedCount: 0,
      throughDate: "2026-06-30",
    },
  });
  const zip = await JSZip.loadAsync(zipBytes);

  // Named for the WINDOW, not for the quarter. "Auditfile-2026-Q2" invites a second import on top
  // of Q1's; "tm-Q2" says what it is.
  const file = zip.file("Auditfile-2026-tm-Q2.xaf");
  assert.ok(file, "the auditfile is in the archive under its window-bearing name");
  assert.match(await file!.async("string"), /auditfile/);

  // The manifest carries the same fact, so the mail can be checked against it rather than trusted.
  const overzicht = JSON.parse(await zip.file("overzicht.json")!.async("string"));
  assert.equal(overzicht.auditbestand.fileName, "Auditfile-2026-tm-Q2.xaf");
  assert.equal(overzicht.auditbestand.entryCount, 143);
  assert.equal(summary.auditfile?.throughDate, "2026-06-30");

  // And LEESMIJ.txt says the one thing that costs an accountant an evening if nobody says it.
  const leesmij = await zip.file("LEESMIJ.txt")!.async("string");
  assert.match(leesmij, /HET AUDITBESTAND/);
  assert.match(leesmij, /van 1 januari tot en met 2026-06-30/);
  assert.match(leesmij, /VERVANGT dit bestand/);
});

test("[XAF-IN-PAKKET] no auditfile means no file and a said-out-loud absence — never an empty one", async () => {
  // An empty .xaf imports as an empty administration. The absence is stated in the one file the
  // accountant actually opens, because the mail announced this file by name.
  const { zipBytes, summary } = await assembleClosingPackageZip({ ...emptyAssemble, auditfile: null });
  const zip = await JSZip.loadAsync(zipBytes);
  assert.equal(zip.file("Auditfile-2026-tm-Q1.xaf"), null, "no half auditfile ships");
  assert.equal(summary.auditfile, null);
  assert.equal(JSON.parse(await zip.file("overzicht.json")!.async("string")).auditbestand, null);
  assert.match(await zip.file("LEESMIJ.txt")!.async("string"), /kon voor dit kwartaal niet worden samengesteld/);
});

test("[XAF-IN-PAKKET] a refused booking is reported, not hidden", async () => {
  // xaf-export refuses an entry it cannot balance rather than patching it — the right call, and
  // invisible unless the count reaches a person. The document is still in the package, so the
  // accountant can book it by hand; they just have to know which.
  const leesmij = buildLeesmij({
    quarterLabel: "Q2 2026",
    clientName: "Kiwi Food Market",
    outgoingCount: 3,
    incomingCount: 40,
    eInvoiceCount: 0,
    bankStatementIncluded: true,
    auditfile: { entryCount: 143, skippedCount: 2, throughDate: "2026-06-30", fileName: "Auditfile-2026-tm-Q2.xaf" },
    warnings: [],
  });
  assert.match(leesmij, /2 boekingen zijn NIET in het bestand opgenomen/);
  assert.match(leesmij, /staan wel als document in dit pakket/);
});


// ── [PAYDATE-ECHT] Welke dag het pakket afdrukt, en of dat een schatting is ──
//
// De boekhouder leest deze datum op pagina 1 van elke betaalde factuur en in overzicht.csv, en
// onder het kasstelsel bepaalt hij in welk kwartaal de voorbelasting valt. Hij mag dus niet iets
// anders zeggen dan de aangifte die in dezelfde zip zit.

test("[PAYDATE-ECHT] een gekoppelde bankregel wint, en is geen schatting", () => {
  assert.deepEqual(
    pickPaymentDate("2026-06-30T00:00:00Z", { payment_date: "2026-06-28", marked_paid_at: "2026-07-03T09:00:00Z" }),
    { date: "2026-06-30", estimated: false },
  );
});

test("[PAYDATE-ECHT] zonder bankregel telt de ingevulde betaaldatum, niet het vastlegmoment", () => {
  // Het gemeten geval: contant betaald op 30 juni, ingevoerd op 3 juli. Hier stond 03-07 met
  // "(geschat)" erbij — een Q3-datum op een betaling die de aangifte in dezelfde zip in Q2 boekt.
  assert.deepEqual(
    pickPaymentDate(null, { payment_date: "2026-06-30", marked_paid_at: "2026-07-03T09:00:00Z" }),
    { date: "2026-06-30", estimated: false },
  );
});

test("[PAYDATE-ECHT] het vastlegmoment blijft de laatste terugval, en blijft geschat", () => {
  // Het IS een schatting: het zegt wanneer iemand het invoerde, niet wanneer het geld bewoog.
  assert.deepEqual(
    pickPaymentDate(null, { payment_date: null, marked_paid_at: "2026-07-03T09:00:00Z" }),
    { date: "2026-07-03", estimated: true },
  );
});

test("[PAYDATE-ECHT] en zonder enige bron liegt het pakket geen datum", () => {
  assert.deepEqual(pickPaymentDate(null, {}), { date: null, estimated: true });
  assert.deepEqual(pickPaymentDate(null, { payment_date: null, marked_paid_at: null }), { date: null, estimated: true });
});
