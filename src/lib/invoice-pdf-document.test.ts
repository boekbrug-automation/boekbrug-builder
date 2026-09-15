// [OFFERTE-IS-GEEN-PROFORMA] Behavioural test — run: npx tsx --test src/lib/invoice-pdf-document.test.ts
//
// WHY THIS RENDERS A REAL PDF INSTEAD OF READING THE SOURCE
//
// The defect this file exists for was invisible to every other kind of check. invoice-pdf.tsx had
// a complete, correct offerte: a "Geldig tot" row, a "Deze offerte is vrijblijvend" sentence, an
// "Offertenummer" label. All of it sat behind `const isOfferte = type === 'offerte'`, and EVERY
// quote this product creates is stored as 'pro_forma' (draft route, DB_TYPE). So not one of those
// branches had ever run on a real document.
//
// tsc type-checks it. eslint reads it. next build compiles it. A source-level gate asserting "the
// file contains a Geldig tot row" passes — the row is right there. The only thing that says the
// document is wrong is the document, so this test makes the document and reads it.
//
// It renders through the same server entry point the send routes use, and pulls the text back out
// with pdfjs-dist, which is already a direct dependency. Roughly two seconds for the whole file.
//
// NOTE ON LANGUAGE: identifiers, comments and test names are English (AGENTS.md). The strings
// being asserted are Dutch because they are what a customer reads.

import { test, before } from "node:test";
import assert from "node:assert/strict";

import { renderInvoicePdf } from "./invoice-pdf-server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getDocument: any;
before(async () => {
  // The legacy build is the one that runs outside a browser. Imported lazily so the cost lands on
  // this file rather than on every test run that does not touch a PDF.
  ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
});

/**
 * The text of a rendered PDF, in reading order.
 *
 * A home-made extractor was tried first and returned "not found" for EVERY string, including ones
 * that were certainly on the page — a broken instrument that reports absence is exactly the silent
 * failure this codebase keeps finding, so the assertions below would all have passed vacuously
 * had they been written as doesNotMatch. Hence a real parser, and hence the control test below it.
 */
async function pdfText(buf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out += content.items.map((it: any) => it.str + (it.hasEOL ? "\n" : "")).join("") + "\n";
  }
  return out;
}

/** The link annotations of a rendered PDF: what a reader will actually open. */
async function pdfLinks(buf: Buffer): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of (await (await doc.getPage(i)).getAnnotations()) as any[]) {
      if (a.subtype === "Link" && (a.url || a.unsafeUrl)) out.push(String(a.url ?? a.unsafeUrl));
    }
  }
  return out;
}

const PROFILE = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
  email: "info@kiwifoodmarket.nl",
  phone: "013-1234567",
};

// The lines from the quote that prompted all of this: prices typed inclusive of 9% btw, so every
// stored ex-price is a long fraction and every line_total is the rounded one.
const LINES = [
  { description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 123.85 },
  { description: "Kip spies", quantity: 100, unit_price: 1.9 / 1.09, btw_rate: 9, line_total: 174.31 },
  { description: "Broodjes", quantity: 38, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 61.01 },
  { description: "Sauzen", quantity: 2, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 3.21 },
];

const QUOTE = {
  invoice_type: "pro_forma",
  invoice_number: null,
  invoice_date: "2026-08-08",
  due_date: "2026-09-07",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  client_email: "romeline@r-newt.nl",
  total_ex_btw: 362.38,
  btw_amount: 32.61,
  total_inc_btw: 394.99,
};

test("the extractor finds text that IS on the page — control for every assertion below", async () => {
  // Without this, a parser that silently returns "" turns every assert.ok(!text.includes(...))
  // below into a test that can never fail.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.length > 200, `the extractor returned ${text.length} characters — it is broken`);
  assert.ok(text.includes("Kiwi Food Market"), "the sender name must come back out of the PDF");
  assert.ok(text.includes("Worstjes"), "and the line descriptions");
});

// [VOETTEKST-MERK] The product's name on the document that leaves the owner's circle.
//
// The invoice PDF is read by the customer and by that customer's bookkeeper, and it is kept for
// seven years. The credit line at its foot was the only place the product was named, and it was set
// in the same muted grey at the same size as the sentence beside it. It is now set like a name —
// and, being style, only the rendered document can say whether it survived.
test("[VOETTEKST-MERK] the document carries the product's name and where to find it", async () => {
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("BoekBrug"), "the name must come out of the rendered PDF");
  assert.ok(text.includes("boekbrug.nl"), "…with an address a reader can act on");
  assert.ok(text.includes("De brug tussen jou en je boekhouder"), "…and the promise under it");
  // It stays a credit line: the SENDER owns the document, and their name is what a customer must
  // read first. A brand that outgrew the letterhead would read as if BoekBrug sent the invoice.
  assert.ok(
    text.indexOf("Kiwi Food Market") < text.indexOf("BoekBrug"),
    "the owner's own company must still come first on the page",
  );
});

// [VOETTEKST-LINK] The address printed as bare text `boekbrug.nl` carried no scheme, so a reader
// that turns URL-looking text into a link had nothing absolute to work with and resolved it against
// the FOLDER the file sat in: the owner opened their own invoice from the desktop and the line
// pointed at …/OneDrive/Desktop/boekbrug.nl. The document goes to a customer and is kept seven
// years, so a link into a stranger's file system is worse than no link at all.
//
// Only the rendered file can answer this: the annotation is not in the text layer, and a source
// check would read the string `boekbrug.nl` and call it correct — which is exactly how it shipped.
test("[VOETTEKST-LINK] the address in the footer is an absolute link, not a path", async () => {
  const links = await pdfLinks(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  // Two: the name, which is the biggest thing down there and the first a reader reaches for, and
  // the address under it. Counted, so dropping one shows up here rather than under someone's cursor.
  const site = links.filter((u) => /^https:\/\/boekbrug\.nl\/?$/.test(u));
  assert.equal(site.length, 2, `the name and the address must both open the site — found: ${JSON.stringify(links)}`);
  // Nothing relative, ever: that is the whole defect, in the one place it can be measured.
  for (const u of links) {
    assert.match(u, /^https:\/\//, `a link without a scheme resolves against the reader's own folder: ${u}`);
  }
});

test("a quote calls itself an Offerte, not a Pro forma", async () => {
  // A pro-formafactuur is a different document: a preliminary invoice for a prepayment or for
  // customs, which says "this is what you will be billed". The customer got a mail titled Offerte
  // asking them to agree, and an attachment headed Pro forma with an IBAN in the corner.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Offerte"), "the heading must be the word the rest of the product uses");
  assert.ok(!text.includes("Pro forma"), "the heading must not say Pro forma");
  assert.ok(
    !text.includes("pro-formafactuur"),
    "the pro-forma disclaimer belongs to a prepayment invoice, not to an offer",
  );
});

test("a quote prints its validity date — the row that never once rendered", async () => {
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Geldig tot"), "the quote must state until when it holds");
  assert.ok(text.includes("07-09-2026"), "…with the date that was in the row all along");
  assert.ok(
    text.includes("Deze offerte is vrijblijvend en geldig tot 07-09-2026."),
    "…and say so in words as well, where the customer reads it",
  );
  assert.ok(!text.includes("Vervaldatum"), "a quote has nothing due — that word belongs on an invoice");
});

test("a quote with no validity date SAYS so instead of going quiet", async () => {
  // The sentence used to drop its clause and leave "Deze offerte is vrijblijvend." — an offer that
  // never expires, which the customer can accept a year later at last year's price.
  const text = await pdfText(await renderInvoicePdf({ ...QUOTE, due_date: null }, LINES, PROFILE));
  assert.ok(
    text.includes("Er is geen einddatum afgesproken"),
    "a missing expiry must be stated, not omitted",
  );
});

test("a quote tells the customer how to say yes", async () => {
  // "Vrijblijvend" says what is not required. Nothing said what to do.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("Ga je akkoord?"), "the quote must name the next step");
  assert.ok(
    text.includes("Laat het weten via info@kiwifoodmarket.nl of 013-1234567"),
    "…and name the route back inside that sentence, not merely somewhere on the page",
  );
});

test("the sender block itself carries a way to reply", async () => {
  // Separate from the sentence above, and the negative control is why. Asserting only that the
  // address appears SOMEWHERE stayed green with both sender lines deleted — the acceptance
  // sentence names the same address, so the page still contained the string. The labels are what
  // distinguishes the two, so the labels are what this asserts.
  //
  // It matters because the PDF outlives the mail: it gets printed, forwarded and filed on its own,
  // and the block that held an address, a KvK number, a BTW number and an IBAN had no e-mail and
  // no phone on the one document whose whole purpose is to be answered.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("E-mail: info@kiwifoodmarket.nl"), "the sender block must list the e-mail");
  assert.ok(text.includes("Tel.: 013-1234567"), "…and the phone number when the profile has one");
});

test("a sender without a phone number gets no empty label", async () => {
  // Only what is filled in. "Tel.: —" on a customer's document reads as a broken template.
  const noPhone = { ...PROFILE, phone: null };
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, noPhone));
  assert.ok(text.includes("E-mail: info@kiwifoodmarket.nl"), "the e-mail is still there");
  assert.ok(!text.includes("Tel.:"), "…and no dangling phone label");
  assert.ok(
    text.includes("Laat het weten via info@kiwifoodmarket.nl —"),
    "and the acceptance sentence drops the phone clause cleanly rather than trailing an 'of'",
  );
});

test("a quote carries no invoice number, and no empty label pretending it might", async () => {
  // A quote is deliberately never numbered — Art. 35 has one unbroken series and it is for
  // invoices. The label was printed anyway, above nothing.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(!text.includes("Factuurnummer"), "a quote must not print an invoice-number label");
  assert.ok(!text.includes("Offertenummer"), "…nor a quote-number label above an empty value");
});

test("the printed column adds up to the printed total", async () => {
  // [REGEL-AFRONDING] 123,85 + 174,31 + 61,01 + 3,21 = 362,38. The document used to state 362,39
  // under it, and a btw of 32,61 that is 9% of neither.
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.ok(text.includes("362,38"), "the subtotal must be the sum of the lines above it");
  assert.ok(!text.includes("362,39"), "…and not a second opinion about the same number");
  assert.ok(text.includes("9,00% BTW over € 362,38"), "the btw must be stated over that same base");
  assert.ok(text.includes("32,61"), "…and 9% of 362,38 is 32,61");
  assert.ok(text.includes("394,99"), "so the total is 394,99 — the amount issuance produces");
});

test("a real factuur is untouched by all of this", async () => {
  // Everything above is scoped to quotes. An invoice is a legal document and none of it may leak
  // in — no validity date, no "vrijblijvend", and its own payment demand still present.
  const invoice = { ...QUOTE, invoice_type: "factuur", invoice_number: "2026-001" };
  const text = await pdfText(await renderInvoicePdf(invoice, LINES, PROFILE));
  assert.ok(text.includes("Factuurnummer"), "an invoice states its number");
  assert.ok(text.includes("2026-001"), "…the real one");
  assert.ok(text.includes("Vervaldatum"), "…and when it is due");
  assert.ok(text.includes("Wij verzoeken u vriendelijk"), "…and asks to be paid");
  assert.ok(!text.includes("Geldig tot"), "an invoice does not expire");
  assert.ok(!text.includes("vrijblijvend"), "an invoice is not an offer");
  assert.ok(!text.includes("Ga je akkoord?"), "an invoice does not ask for agreement");
});

test("[PRIJS-KOLOM] every price on the page multiplies out to the total beside it", async () => {
  // The reported document showed "150 x € 0,83" against a line total of € 123,85 — 65 cents on one
  // row, and € 1,14 across the four. unit_price stores the exact fraction on purpose (price-mode.ts);
  // printing it at two decimals is what made the column lie.
  const lines = [
    ...LINES,
    // An ordinary line, to prove nothing moved for the invoices that were always right.
    { description: "Uren", quantity: 2, unit_price: 75, btw_rate: 21, line_total: 150 },
  ];
  const text = await pdfText(await renderInvoicePdf(QUOTE, lines, PROFILE));

  // Parse the table back out of the page and do the multiplication a customer would do.
  //
  // SCOPED to the table. An unbounded match ran straight on into the totals and read
  // "21,00% BTW over € 362,38 … € 31,50" as a line of 362,38 units — the same mistake that made
  // the first UBL reader in this repo report a failure that was not there. Read the region you
  // mean, not the page.
  const euro = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const from = text.indexOf("Aantal Omschrijving Prijs Totaal");
  const to = text.indexOf("Subtotaal", from);
  assert.ok(from > 0 && to > from, "the line table must be locatable on the page");
  const table = text.slice(from, to);
  const rows = [...table.matchAll(/(\d+(?:,\d+)?) (\S[^€]*?) € ([\d.,]+) € ([\d.,]+)/g)];
  assert.ok(rows.length >= 5, `the five line rows must be readable from the page — found ${rows.length}`);
  for (const [, qty, name, price, total] of rows) {
    const product = Math.round(euro(qty) * euro(price) * 100 + 1e-9) / 100;
    assert.ok(
      Math.abs(product - euro(total)) < 0.005,
      `${name.trim()}: ${qty} x € ${price} = ${product.toFixed(2)}, but the row says € ${total}`,
    );
  }

  // The precise shapes, so a future "let's just use two decimals everywhere" is caught by name.
  assert.ok(text.includes("€ 0,82569"), "the fractional price is printed with the precision it needs");
  assert.ok(!text.includes("€ 0,83"), "…and not as the rounded price that does not multiply out");
  assert.ok(text.includes("€ 75,00"), "a round price keeps exactly two decimals");
});

// ─── [BTW-VERKLARING] Why there is no btw ───────────────────────────────────────────────────────
//
// Four invoices were rendered, all with EUR 0,00 btw, and three printed text that was
// character-for-character identical: nothing. Only the EU reverse-charge case said anything. So a
// KOR invoice, an exempt supply and a plain 0% invoice were one document, and a customer's
// bookkeeper had no way to tell them apart.

const INVOICE = {
  invoice_type: "factuur",
  invoice_number: "2026-001",
  invoice_date: "2026-08-08",
  due_date: "2026-09-07",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  total_ex_btw: 1000,
  btw_amount: 0,
  total_inc_btw: 1000,
};
const ZERO_LINE = [{ description: "Advies", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000 }];

// ─── [KORTING-EENMAAL] A header-only invoice is already net of its discount ────────────
//
// With no lines the PDF synthesizes one rate row FROM the stored header total — and that total is
// what the owner's screen computed, discount included. Running the header discount over that row
// again printed a EUR 1.089 invoice (900 ex after 10%) as EUR 980,10, with no warning and a payment
// QR that quietly vanished because its amount no longer matched the page.
test("[KORTING-EENMAAL] a header-only invoice with a discount prints its stored total, once discounted", async () => {
  const kop = { ...INVOICE, invoice_number: "2026-014", total_ex_btw: 900, btw_amount: 189, total_inc_btw: 1089,
    discount_type: "percent", discount_value: 10 };
  const text = await pdfText(await renderInvoicePdf(kop, [], PROFILE));
  assert.ok(text.includes("1.089,00"), "the total the header carries — the customer's amount");
  assert.ok(!text.includes("980,10"), "not the header total discounted a second time");
  assert.ok(!text.includes("Korting"), "no lines, no discount row: the discount is already inside the header");
});

test("[KORTING-EENMAAL] …while an invoice WITH lines still shows and applies its discount, once", async () => {
  const kop = { ...INVOICE, invoice_number: "2026-015", total_ex_btw: 900, btw_amount: 189, total_inc_btw: 1089,
    discount_type: "percent", discount_value: 10 };
  const text = await pdfText(await renderInvoicePdf(kop,
    [{ description: "Advies", quantity: 10, unit_price: 100, btw_rate: 21, line_total: 1000 }], PROFILE));
  assert.ok(text.includes("Korting (10%)"), "the discount row is named");
  assert.ok(text.includes("1.089,00"), "…and the page adds up to the stored total");
});
const NOTE = "Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).";

test("[BTW-VERKLARING] a KOR invoice says why it charges nothing", async () => {
  const text = await pdfText(
    await renderInvoicePdf(INVOICE, ZERO_LINE, { ...PROFILE, kor_active: true }),
  );
  assert.ok(text.includes("kleineondernemersregeling (KOR)"), "the scheme must be named");
});

test("[BTW-VERKLARING] an exempt supply carries the owner's own legal ground", async () => {
  // The app knows THAT it is exempt, never WHICH exemption — art. 11 has a provision per trade.
  const text = await pdfText(
    await renderInvoicePdf(
      INVOICE,
      [{ ...ZERO_LINE[0], vat_treatment: "exempt" }],
      { ...PROFILE, vat_exempt_activity: true, vat_statement_note: NOTE },
    ),
  );
  assert.ok(text.includes(NOTE), "the sentence the owner wrote must be on the document");
});

test("[BTW-VERKLARING] an exempt supply without a note still says the true part", async () => {
  const text = await pdfText(
    await renderInvoicePdf(INVOICE, [{ ...ZERO_LINE[0], vat_treatment: "exempt" }], PROFILE),
  );
  assert.ok(text.includes("Vrijgesteld van btw."), "incomplete beats absent, and it is not false");
});

test("[BTW-VERKLARING] plain 0% with nothing to go on stays silent", async () => {
  // Export, intra-EU goods and several services are all 0%. Printing a guessed ground on a
  // customer's invoice is the one outcome worse than saying nothing.
  const text = await pdfText(await renderInvoicePdf(INVOICE, ZERO_LINE, PROFILE));
  assert.ok(!text.includes("Vrijgesteld"), "no exemption is claimed");
  assert.ok(!text.includes("kleineondernemersregeling"), "…nor a scheme the owner is not in");
});

test("[BTW-VERKLARING] the reverse-charge sentence is never spoken over", async () => {
  // icp.ts derives that from the customer's EU VAT number — the one zero the app can PROVE. Two
  // sentences giving different reasons for one zero is worse than either alone.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, client_btw_number: "DE123456789" },
      ZERO_LINE,
      { ...PROFILE, vat_statement_note: NOTE },
    ),
  );
  assert.ok(text.includes("Btw verlegd"), "the provable reason wins");
  assert.ok(!text.includes(NOTE), "…and the owner's note does not appear beside it");
});

test("[BTW-VERKLARING] KOR and an EU customer give the KOR sentence, not verlegging", async () => {
  // Written after the previous test failed on a premise I had not checked: the two cannot both
  // apply. icp.ts refuses to claim verlegging for an owner in the KOR — "a statement about a
  // regime the owner is not in" — so the reverse-charge line is absent and this one must fill the
  // gap rather than leave the customer with a bare zero.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, client_btw_number: "DE123456789" },
      ZERO_LINE,
      { ...PROFILE, kor_active: true, vat_statement_note: NOTE },
    ),
  );
  assert.ok(!text.includes("Btw verlegd"), "no verlegging is claimed under the KOR");
  assert.ok(text.includes("kleineondernemersregeling (KOR)"), "the real reason is stated");
  assert.ok(!text.includes(NOTE), "…and the scheme is a complete explanation on its own");
});

test("[BTW-VERKLARING] an invoice that DOES charge btw explains nothing", async () => {
  // The per-rate rows already say what was charged. "Geen btw" beside EUR 210,00 of btw is a
  // contradiction the customer would rightly phone about.
  const text = await pdfText(
    await renderInvoicePdf(
      { ...INVOICE, btw_amount: 210, total_inc_btw: 1210 },
      [{ ...ZERO_LINE[0], btw_rate: 21 }],
      { ...PROFILE, vat_statement_note: NOTE, kor_active: true },
    ),
  );
  assert.ok(text.includes("21,00% BTW"), "the rate row is there");
  assert.ok(!text.includes(NOTE), "and no explanation of an absence that is not happening");
  assert.ok(!text.includes("kleineondernemersregeling"));
});

// ─── [KLANT-EXTRA] The two free lines under the customer's name ────────────────────────────────
//
// Read off a rendered document, because the claim is about ORDER on a page: the lines have to sit
// between the customer's name and their street. A source-level check can see that the JSX exists;
// only the document can say where the text came out.

test("[KLANT-EXTRA] all four lines print between the customer name and the street", async () => {
  const text = await pdfText(await renderInvoicePdf(
    {
      ...INVOICE,
      client_extra_line1: "t.a.v. mevrouw Jansen",
      client_extra_line2: "Afdeling Inkoop",
      client_extra_line3: "PO-2026-114",
      client_extra_line4: "Summervibes Festival Tilburg noord",
    },
    ZERO_LINE, PROFILE,
  ));
  assert.match(text, /t\.a\.v\. mevrouw Jansen/, "the addressee must be on the page");
  assert.match(text, /Afdeling Inkoop/, "…the department");
  assert.match(text, /PO-2026-114/, "…the reference the customer's system needs");
  assert.match(text, /Summervibes Festival Tilburg noord/, "…and the fourth line");

  // ORDER is the whole point — under the name, above the address, in the order typed.
  const at = (s: string) => text.indexOf(s);
  const name = at("Stichting Contour de Twern");
  const seq = [at("t.a.v. mevrouw Jansen"), at("Afdeling Inkoop"), at("PO-2026-114"), at("Summervibes Festival Tilburg noord")];
  assert.ok(name >= 0 && seq[0] > name, "line 1 must follow the customer name");
  assert.ok(seq[1] > seq[0] && seq[2] > seq[1] && seq[3] > seq[2], "the four must keep the order they were typed");
  assert.ok(at("Spoorlaan 444") > seq[3], "…and the street must still come after all four");
});

test("[KLANT-EXTRA] a gap in the middle closes up on the page", async () => {
  // The third line arrived after the first two shipped. What must not change: a line left empty
  // does not leave a blank row in the address block of a document that goes to a customer.
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: "t.a.v. mevrouw Jansen", client_extra_line2: null, client_extra_line3: "PO-2026-114" },
    ZERO_LINE, PROFILE,
  ));
  const one = text.indexOf("t.a.v. mevrouw Jansen");
  const three = text.indexOf("PO-2026-114");
  assert.ok(one >= 0 && three > one);
  assert.doesNotMatch(
    text.slice(one + "t.a.v. mevrouw Jansen".length, three), /\S/,
    "an empty middle line must leave nothing between the two that are filled",
  );
});

test("[KLANT-EXTRA] only the second filled leaves no blank line above it", async () => {
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: null, client_extra_line2: "Afdeling Inkoop" },
    ZERO_LINE, PROFILE,
  ));
  const name = text.indexOf("Stichting Contour de Twern");
  const dept = text.indexOf("Afdeling Inkoop");
  const street = text.indexOf("Spoorlaan 444");
  assert.ok(dept > name && street > dept, "the filled line must sit directly under the name");
  // Nothing empty rendered between them: the text between the name and the department is only the
  // line break, never a second one for a row that was left blank.
  assert.doesNotMatch(text.slice(name + "Stichting Contour de Twern".length, dept), /\S/);
});

test("[KLANT-EXTRA] an invoice without them renders exactly the block it always had", async () => {
  // Every invoice that exists today has both columns null. This is the regression that matters.
  const before = await pdfText(await renderInvoicePdf(INVOICE, ZERO_LINE, PROFILE));
  const after = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: null, client_extra_line2: "", client_extra_line3: null }, ZERO_LINE, PROFILE,
  ));
  assert.equal(after, before, "a null/empty pair must change nothing on the page");
  assert.match(before, /Stichting Contour de Twern/);
});

test("[KLANT-EXTRA] a pasted paragraph cannot push the address block down the page", async () => {
  // Bounded at 60 characters — roughly one rendered line in a block that is 48% of an A4 page.
  const text = await pdfText(await renderInvoicePdf(
    { ...INVOICE, client_extra_line1: "R".repeat(400) }, ZERO_LINE, PROFILE,
  ));
  assert.doesNotMatch(text, /R{61}/, "the line must not reach the page unbounded");
  assert.match(text, /R{60}/, "…and what fits must still be printed");
  // The rest of the document must survive it.
  assert.match(text, /Spoorlaan 444/);
  assert.match(text, /Advies/);
});

// ─── [MIN-REGEL] A credit line on the paper the customer keeps ──────────────────────────────────
//
// ATAPACK Cash & Carry 26304787, 17-07-2026 — a real wholesaler invoice. Line AP290004 is a return
// of three boxes of knoopzakken from an earlier delivery, settled here instead of on a separate
// creditnota: −3 × € 23,95 = −71,85, netted against nine ordinary lines.
//
// The PDF is the document the customer checks by hand and the accountant books from. If the minus
// is dropped anywhere between the row and the totals, the page still looks like a finished invoice
// and asks for € 71,85 too much — a difference nothing in this app would ever report.

const ATAPACK_LINES = [
  { description: "Knoopzakken HDPE — credit over faktuur 26302362", quantity: -3, unit_price: 23.95, btw_rate: 21, line_total: -71.85 },
  { description: "Houtskool Elly 2kg", quantity: 2, unit_price: 15.95, btw_rate: 21, line_total: 31.9 },
  { description: "Briketten Elly 2kg", quantity: 2, unit_price: 13.95, btw_rate: 21, line_total: 27.9 },
  { description: "Bak aluminium 9950ml", quantity: 1, unit_price: 13.95, btw_rate: 21, line_total: 13.95 },
  { description: "Bak aluminium 2500ml", quantity: 1, unit_price: 5.5, btw_rate: 21, line_total: 5.5 },
  { description: "Prikker bamboe", quantity: 3, unit_price: 5.75, btw_rate: 21, line_total: 17.25 },
  { description: "Toiletpapier Only", quantity: 2, unit_price: 10.95, btw_rate: 21, line_total: 21.9 },
  { description: "Keukenrol Evo", quantity: 1, unit_price: 10.9, btw_rate: 21, line_total: 10.9 },
  { description: "Magnetronbak", quantity: 16, unit_price: 2.0208, btw_rate: 21, line_total: 32.33 },
  { description: "PB Dikbleek Javel", quantity: 1, unit_price: 11.4, btw_rate: 21, line_total: 11.4 },
];

const ATAPACK = {
  invoice_type: "factuur",
  invoice_number: "26304787",
  invoice_date: "2026-07-17",
  due_date: "2026-08-16",
  client_name: "Kiwi Food Market",
  client_address: "Verdiplein 13-14",
  client_postal_code: "5049NM",
  client_city: "Tilburg",
  total_ex_btw: 101.18,
  btw_amount: 21.25,
  total_inc_btw: 122.43,
};

test("[MIN-REGEL] the credit line prints as a credit, and the page still adds up", async () => {
  const text = await pdfText(await renderInvoicePdf(ATAPACK, ATAPACK_LINES, PROFILE));

  // The row itself: a negative amount and a positive price. The minus is the whole message of the
  // line, and it is carried by the quantity — see negative-line.ts.
  assert.ok(text.includes("Knoopzakken HDPE"), "the credit line must be on the page at all");
  assert.ok(text.includes("€ -71,85"), "the row must show money going back, not money owed");
  assert.ok(text.includes("€ 23,95"), "…at the price per box it was delivered for");
  assert.ok(text.includes("-3"), "and the return is three pieces, negative");

  // The totals are derived from the lines, so this is the assertion that the netting happened.
  // 173,03 of deliveries − 71,85 = 101,18, and 21% of that is 21,25.
  assert.ok(text.includes("€ 101,18"), "the subtotal must be the netted one, not the gross 173,03");
  assert.ok(!text.includes("€ 173,03"), "the gross must not be what the customer is asked to pay");
  assert.ok(text.includes("€ 21,25"), "the btw follows the netted base — 21% of 101,18");
  assert.ok(text.includes("€ 122,43"), "and the amount due is the one on the paper invoice");
  assert.ok(
    text.includes("het bovenstaande bedrag van € 122,43"),
    "the payment sentence names the same total as the totals block",
  );
});

test("[MIN-REGEL] the same invoice without the credit line is 71,85 more expensive", async () => {
  // The control. If the credit were silently dropped — a filter on quantity > 0, a Math.abs in a
  // total — the document above would be this one, and every assertion about a total in it would
  // still be about a plausible-looking invoice.
  const text = await pdfText(await renderInvoicePdf(ATAPACK, ATAPACK_LINES.slice(1), PROFILE));
  assert.ok(text.includes("€ 173,03"), "nine lines without the credit come to the gross figure");
  assert.ok(!text.includes("€ 101,18"), "…which is not the netted total");
  assert.ok(!text.includes("Knoopzakken HDPE"), "and the credit line is genuinely gone from this one");
});

// ─── [REGEL-KORTING] The discount the customer has to be able to check ────────

test("[REGEL-KORTING] a discounted line names its discount and still adds up on paper", async () => {
  // The whole point of printing it: a customer who multiplies the column has to arrive at the
  // amount beside it. 10 x EUR 12,50 = 125, minus 20% = 100 — with nothing on the page saying so,
  // that line reads as an arithmetic error on a document the customer keeps.
  const text = await pdfText(await renderInvoicePdf(
    { ...QUOTE, invoice_type: "factuur", invoice_number: "20260099",
      total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 },
    [{ description: "Aanbieding", quantity: 10, unit_price: 12.5, btw_rate: 21, line_total: 100,
       discount_type: "percent", discount_value: 20 }],
    PROFILE,
  ));
  assert.ok(text.includes("Korting (20%)"), "the discount is named, with the percentage agreed");
  assert.ok(text.includes("€ 25,00"), "…and with the amount it took off");
  assert.ok(text.includes("€ 12,50"), "the price column shows the AGREED price, not a derived one");
  assert.ok(text.includes("€ 100,00"), "and the line total is the net amount");
});

test("[REGEL-KORTING] a discount leaves the printed unit price untouched", async () => {
  // unitPriceDecimals hunts for the precision at which quantity x price equals the amount it is
  // handed. Hand it the NET total of a discounted line and NO precision reconciles, so it prints
  // the maximum six — a unit price nobody agreed, on the document the customer keeps. It has to be
  // handed the GROSS, because that is the amount the price column belongs to; the discount row
  // below the description accounts for the rest.
  //
  // This fixture is the one that made the rule: prices typed INCLUSIVE of 9% btw, so the ex-price
  // is a long fraction and the column already needs five decimals to reconcile at all.
  const geenKorting = await pdfText(await renderInvoicePdf(
    { ...QUOTE, invoice_type: "factuur", invoice_number: "20260100",
      total_ex_btw: 123.85, btw_amount: 11.15, total_inc_btw: 135 },
    [{ description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 123.85 }],
    PROFILE,
  ));
  // 123,85 gross, minus 10% (12,39) = 111,46 net — the amount the route stores.
  const metKorting = await pdfText(await renderInvoicePdf(
    { ...QUOTE, invoice_type: "factuur", invoice_number: "20260100",
      total_ex_btw: 111.46, btw_amount: 10.03, total_inc_btw: 121.49 },
    [{ description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 111.46,
       discount_type: "percent", discount_value: 10 }],
    PROFILE,
  ));
  const prijs = geenKorting.match(/€ 0,\d+/)![0];
  assert.equal(prijs, "€ 0,82569", "the column already needs five decimals to reconcile with 123,85");
  assert.ok(metKorting.includes(prijs), "the SAME price after a discount — a discount is not a new price");
  assert.ok(metKorting.includes("Korting (10%)") && metKorting.includes("€ 12,39"),
    "and the difference is spelled out instead of hidden in the price");
});

test("[REGEL-KORTING] an invoice without a discount prints exactly what it always printed", async () => {
  const zonder = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  const metNulls = await pdfText(await renderInvoicePdf(
    QUOTE,
    LINES.map((l) => ({ ...l, discount_type: null, discount_value: null })),
    PROFILE,
  ));
  assert.equal(metNulls, zonder);
  assert.ok(!zonder.includes("Korting"), "no discount, no discount row anywhere on the page");
});

// ─── [OCR-LEESBAAR] The PDF is the integration surface ───────────────────────────────

// The accountant's intake — SnelStart's mailbox, Basecone, TriFact365, Zenvoices, Exact's
// scan-en-herken — reads a SALES invoice by OCR'ing this PDF. It does not read the UBL beside it
// (SnelStart's mailbox does not read a verkoop-UBL at all). So the text layer of this document is
// the thing that decides how much retyping the accountant does, and that makes it an integration
// contract rather than a layout detail.
//
// The failure it guards against is invisible on screen: a totals block rendered as an image, a
// font substitution that breaks extraction, a number drawn glyph by glyph. The invoice still looks
// perfect to the owner and to his customer, and the accountant's tool suddenly reads nothing.
//
// Measured before this test was written: 1 page, a real text layer, every field below extractable.

const OCR_INVOICE = {
  invoice_type: "factuur",
  invoice_number: "20260046",
  invoice_date: "2026-08-03",
  due_date: "2026-09-02",
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  client_btw_number: "NL001234567B01",
  total_ex_btw: 362.38,
  btw_amount: 32.61,
  total_inc_btw: 394.99,
  status: "sent",
};

test("[OCR-LEESBAAR] every field the accountant's intake reads is in the text layer", async () => {
  const text = await pdfText(await renderInvoicePdf(OCR_INVOICE, LINES, PROFILE));

  // The four an intake tool keys a booking on. Any one of them missing means a human types it.
  assert.ok(text.includes("20260046"), "the invoice number is not extractable");
  assert.ok(text.includes("03-08-2026"), "the invoice date is not extractable");
  assert.ok(text.includes("Kiwi Food Market"), "the supplier's name is not extractable");
  assert.ok(text.includes("394,99"), "the total is not extractable");

  // The BTW split, which decides the rubriek the invoice is booked into. A total alone is not
  // enough: a 9% invoice booked at 21% is a wrong aangifte, not a formatting problem.
  assert.ok(text.includes("362,38"), "the amount excluding BTW is missing");
  assert.ok(text.includes("32,61"), "the BTW amount is missing");
  assert.ok(/9,00%|9%/.test(text), "the BTW rate is missing");

  // And the identifiers that let a tool recognise the SUPPLIER instead of asking every time.
  assert.ok(text.includes("94386676"), "the KVK number is missing");
  assert.ok(text.includes("NL005079680B23"), "the BTW number is missing");
  assert.ok(text.includes("NL73INGB0107197480"), "the IBAN is missing — the payment cannot be matched");
});

test("[OCR-LEESBAAR] the document is one page with a real text layer", async () => {
  // A PDF with no text layer is a scan as far as any intake tool is concerned, and gets the
  // treatment a photographed receipt gets. This asserts the shape rather than the words, so a
  // change that keeps the words but loses the layer still fails.
  const buf = await renderInvoicePdf(OCR_INVOICE, LINES, PROFILE);
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  assert.equal(doc.numPages, 1, "an ordinary four-line invoice must not spill onto a second page");
  const content = await (await doc.getPage(1)).getTextContent();
  assert.ok(content.items.length > 20, `only ${content.items.length} text items — this reads as a scan`);
});

// ── [EIGEN-MARKER] The paper names its own roles ────────────────────────────────────────────────
//
// Two unlabeled name blocks side by side read fine to a human and terribly to a machine: the
// owner's own invoice came back through the mail sync and the reader named the CUSTOMER as the
// supplier (Kiwi, EUR 394,99), which defeated the own-document identity guard entirely. One small
// caption above each block — KLANT, AFZENDER — ends that ambiguity for every reader of the
// document, including our own intake when the invoice is re-imported.
test("[EIGEN-MARKER] both party blocks carry their role caption", async () => {
  const invoice = { ...QUOTE, invoice_type: "standard", invoice_number: "2026-0042" };
  const text = await pdfText(await renderInvoicePdf(invoice, LINES, PROFILE));
  assert.match(text, /KLANT/, "the customer block must say it holds the customer");
  assert.match(text, /AFZENDER/, "the sender block must say it holds the sender");
  // The captions must sit with the right names: KLANT before the customer's name, AFZENDER
  // before the sender's — swapped captions would be worse than none.
  assert.ok(
    text.indexOf("KLANT") < text.indexOf("Stichting Contour de Twern"),
    "KLANT captions the customer's name",
  );
  assert.ok(
    text.indexOf("AFZENDER") < text.indexOf("Kiwi Food Market"),
    "AFZENDER captions the sender's name",
  );
})

test("[EIGEN-MARKER] the offerte carries the same captions", async () => {
  const text = await pdfText(await renderInvoicePdf(QUOTE, LINES, PROFILE));
  assert.match(text, /KLANT/);
  assert.match(text, /AFZENDER/);
})

// ─── [KORTING] Een creditnota met een documentkorting ─────────────────────────
//
// applyDiscount spiegelt de korting mee op een negatief document: `applied = sign * magnitude`,
// dus de aftrek per tarief is daar NEGATIEF. De PDF stelde de basis alleen bij als die aftrek
// groter dan nul was, dus op een creditnota werd het subtotaal wél verlaagd en de BTW niet.
//
// De creditnota-route zet de korting er echt op — geschaald naar het gecrediteerde deel
// (/api/invoice/creditnota, discount_type/discount_value) — dus dit is bereikbaar zodra een
// gekorte factuur wordt gecrediteerd. In de database staat vandaag geen enkele factuur met een
// korting, dus er is nog nooit zo'n document uitgegaan; dit is de deur, niet de schade.

test("[KORTING] een creditnota met documentkorting drukt een BTW die bij haar eigen basis hoort", async () => {
  // −1.000 ex, 10% documentkorting → −900 ex, en 21% daarvan is −189. Vóór de reparatie stond
  // er −900 naast −210: een document dat zichzelf tegenspreekt, en dat afwijkt van de opgeslagen
  // totalen én van de aangifte, die allebei via applyDiscount wél de gespiegelde korting dragen.
  const text = await pdfText(await renderInvoicePdf(
    {
      ...QUOTE, invoice_type: "creditnota", invoice_number: "20260099-C1",
      total_ex_btw: -900, btw_amount: -189, total_inc_btw: -1089,
      discount_type: "percent", discount_value: 10,
    } as never,
    [{ description: "Teruggenomen levering", quantity: 1, unit_price: -1000, btw_rate: 21, line_total: -1000 }],
    PROFILE,
  ));

  // De cijfers op het papier. De BTW hoort bij de VERLAAGDE basis.
  assert.ok(text.includes("900,00"), "het verlaagde subtotaal staat er");
  assert.ok(text.includes("189,00"), "en de BTW is 21% daarvan, niet van de onverlaagde 1.000");
  assert.ok(!text.includes("210,00"), "de onverlaagde BTW mag nergens op dit document staan");
  // En het document telt op met zichzelf: 900 + 189 = 1.089.
  assert.ok(text.includes("1.089,00"), "het totaal is de som van wat eronder staat");
});

test("[KORTING] een gewone factuur met documentkorting blijft precies zoals hij was", async () => {
  // De regressiecontrole bij de reparatie hierboven: `off !== 0` mag het positieve geval niet
  // veranderen, want daar werkte `off > 0` altijd al.
  const text = await pdfText(await renderInvoicePdf(
    {
      ...QUOTE, invoice_type: "factuur", invoice_number: "20260100",
      total_ex_btw: 900, btw_amount: 189, total_inc_btw: 1089,
      discount_type: "percent", discount_value: 10,
    } as never,
    [{ description: "Levering", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 }],
    PROFILE,
  ));
  assert.ok(text.includes("900,00"));
  assert.ok(text.includes("189,00"));
  assert.ok(text.includes("1.089,00"));
});

// ─── [VERLEGD-VERKOOP] The domestic verlegging on paper ────────────────────────────────────
//
// Art. 35a lid 1 Wet OB: the customer's btw-identificatienummer (sub d) and the words "btw verlegd"
// (sub j). Read back with pdfjs, like everything else in this file.
test("[VERLEGD-VERKOOP] a verlegde invoice prints the statutory sentence with the customer's number, and its own row", async () => {
  const kop = { ...INVOICE, invoice_number: "2026-021", client_btw_number: "nl 8123.45.678.b01", total_ex_btw: 1000, btw_amount: 0, total_inc_btw: 1000 };
  const text = await pdfText(await renderInvoicePdf(kop,
    [{ description: "Onderaanneming week 36", quantity: 40, unit_price: 25, btw_rate: 0, line_total: 1000, vat_treatment: "reverse_charge" }],
    PROFILE));
  assert.ok(text.includes("Btw verlegd — artikel 12 lid 5 Wet OB 1968. BTW-nummer afnemer: NL812345678B01."),
    "the sentence, with the number normalised the way the EU sentence normalises it");
  assert.ok(text.includes("Btw verlegd over € 1.000,00"), "the summary row names the category, not 0,00%");
  assert.ok(!text.includes("0,00% BTW over"), "…and no zero-rate row pretends it was an ordinary 0% supply");
});

test("[VERLEGD-VERKOOP] exempt, verlegd and 0% each get their own row on one invoice", async () => {
  const kop = { ...INVOICE, invoice_number: "2026-022", client_btw_number: "NL812345678B01", total_ex_btw: 1500, btw_amount: 0, total_inc_btw: 1500 };
  const text = await pdfText(await renderInvoicePdf(kop, [
    { description: "Cursus voedselveiligheid", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: "exempt" },
    { description: "Onderaanneming", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: "reverse_charge" },
    { description: "Export", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500 },
  ], PROFILE));
  assert.ok(text.includes("Vrijgesteld van btw over € 500,00"), "the exempt half is named");
  assert.ok(text.includes("Btw verlegd over € 500,00"), "the verlegde half is named");
  assert.ok(text.includes("0,00% BTW over € 500,00"), "the real 0% supply keeps its rate row");
  assert.ok(!text.includes("€ 1.500,00 —") && !text.includes("BTW over € 1.500,00"), "nothing merges the three");
  assert.ok(text.includes("1.500,00"), "…and the total still adds up");
});

test("[VERLEGD-VERKOOP] a quote prints no verlegd sentence — it is not an invoice", async () => {
  const text = await pdfText(await renderInvoicePdf(
    { ...QUOTE, client_btw_number: "NL812345678B01", total_ex_btw: 1000, btw_amount: 0, total_inc_btw: 1000 },
    [{ description: "Onderaanneming", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000, vat_treatment: "reverse_charge" }],
    PROFILE));
  assert.ok(!text.includes("artikel 12 lid 5"), "no statutory sentence on an offerte");
  assert.ok(text.includes("Btw verlegd over € 1.000,00"), "the row still says what the line is");
});

test("[VERLEGD-VERKOOP] a document discount over two rows at rate 0 is split, not subtracted twice", async () => {
  // € 500 exempt + € 500 verlegd, 10% off: each row € 450, total € 900 — not € 400 + € 400.
  const kop = { ...INVOICE, invoice_number: "2026-023", client_btw_number: "NL812345678B01", total_ex_btw: 900, btw_amount: 0, total_inc_btw: 900,
    discount_type: "percent", discount_value: 10 };
  const text = await pdfText(await renderInvoicePdf(kop, [
    { description: "Cursus", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: "exempt" },
    { description: "Onderaanneming", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500, vat_treatment: "reverse_charge" },
  ], PROFILE));
  assert.ok(text.includes("Vrijgesteld van btw over € 450,00"), "the exempt row carries its half of the discount");
  assert.ok(text.includes("Btw verlegd over € 450,00"), "…and the verlegde row the other half");
  assert.ok(!text.includes("over € 400,00"), "the whole rate-0 allowance was subtracted from one row");
  assert.ok(text.includes("900,00"), "the total is the header's");
});

// ─── [KLANT-LAND] The country under the city, for a foreign customer only ──────────────
test("[KLANT-LAND] a foreign customer's invoice names the country; a Dutch one prints the block it always did", async () => {
  const de = await pdfText(await renderInvoicePdf({ ...INVOICE, invoice_number: "2026-031", client_country: "DE", client_btw_number: "DE123456789" }, ZERO_LINE, PROFILE));
  assert.ok(de.includes("Duitsland"), "art. 35a: the address of a foreign customer includes the country");
  const nl = await pdfText(await renderInvoicePdf({ ...INVOICE, invoice_number: "2026-032", client_country: "NL" }, ZERO_LINE, PROFILE));
  assert.ok(!nl.includes("Nederland"), "a Dutch customer's block is unchanged");
  const geen = await pdfText(await renderInvoicePdf({ ...INVOICE, invoice_number: "2026-033" }, ZERO_LINE, PROFILE));
  assert.ok(!geen.includes("Nederland"), "…and so is one without a recorded country");
});
