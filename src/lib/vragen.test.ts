// [BRUG-RETOUR] Pure node test — run: npx tsx --test src/lib/vragen.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenVragen,
  vraagTekst,
  vraagAntwoordPrefix,
  bouwAntwoordBericht,
  vragenBannerRegel,
  openQuestionCount,
  VRAAG_STATUS,
  buildOpenInvoiceVragen,
  invoiceLabel,
} from "./vragen";

const doc = (id: string, name: string | null, trashed = false) => ({
  id,
  file_name: name,
  trashed,
});
const status = (
  subject_id: string,
  s: string,
  vraag_text: string | null = null,
  updated_at: string | null = "2026-07-01T10:00:00.000Z",
) => ({ subject_id, status: s, vraag_text, updated_at });

test("alleen status 'vraag' is een vraag aan de klant", () => {
  const rows = [
    status("a", "te_verwerken"),
    status("b", "in_behandeling"),
    status("c", "verwerkt"),
    status("d", VRAAG_STATUS, "Mist de bon van 3 juni?"),
  ];
  const open = buildOpenVragen(rows, [doc("a", "a.pdf"), doc("b", "b.pdf"), doc("c", "c.pdf"), doc("d", "d.pdf")]);
  assert.equal(open.length, 1);
  assert.equal(open[0].documentId, "d");
  assert.equal(open[0].question, "Mist de bon van 3 juni?");
});

test("een vraag zonder toelichting wordt niet verzonnen", () => {
  // De boekhouder MAG de status op 'vraag' zetten zonder tekst. Dan is het antwoord
  // "hij liet geen toelichting achter" — nooit een vraag die niemand stelde.
  const open = buildOpenVragen([status("a", VRAAG_STATUS, "   ")], [doc("a", "bon.jpg")]);
  assert.equal(open.length, 1);
  assert.equal(open[0].question, null);

  assert.equal(vraagTekst(null), null);
  assert.equal(vraagTekst(undefined), null);
  assert.equal(vraagTekst(""), null);
  assert.equal(vraagTekst("  \n "), null);
  assert.equal(vraagTekst("  Welke bon?  "), "Welke bon?");
});

test("een vraag over een onvindbaar document verdwijnt niet stil", () => {
  // Verbergen is óók een bewering: dan denkt de klant dat er niets openstaat terwijl de
  // boekhouder wacht. De rij blijft, gemarkeerd, zodat het scherm het eerlijk kan zeggen.
  const open = buildOpenVragen([status("weg", VRAAG_STATUS, "Waar is deze?")], []);
  assert.equal(open.length, 1);
  assert.equal(open[0].documentMissing, true);
  assert.equal(open[0].documentName, null);
});

test("een document in de prullenbak is gemarkeerd, niet weggelaten", () => {
  const open = buildOpenVragen([status("a", VRAAG_STATUS, "?")], [doc("a", "bon.jpg", true)]);
  assert.equal(open[0].documentTrashed, true);
  assert.equal(open[0].documentMissing, false);
  assert.equal(open[0].documentName, "bon.jpg");
});

test("oudste vraag eerst; een ontbrekende datum sluit achteraan aan", () => {
  const open = buildOpenVragen(
    [
      status("nieuw", VRAAG_STATUS, "?", "2026-07-20T10:00:00.000Z"),
      status("zonder", VRAAG_STATUS, "?", null),
      status("oud", VRAAG_STATUS, "?", "2026-05-01T10:00:00.000Z"),
    ],
    [doc("nieuw", "n.pdf"), doc("zonder", "z.pdf"), doc("oud", "o.pdf")],
  );
  assert.deepEqual(open.map((v) => v.documentId), ["oud", "nieuw", "zonder"]);
});

test("het antwoord noemt het document waar het over gaat", () => {
  // De boekhouder leest het antwoord in zijn berichtenscherm, los van het document.
  // Zonder deze kopregel is "ja die heb ik" onbruikbaar.
  assert.equal(vraagAntwoordPrefix("bon-juni.pdf"), 'Over je vraag bij "bon-juni.pdf":');
  assert.equal(vraagAntwoordPrefix(null), "Over je vraag:");
  assert.equal(vraagAntwoordPrefix("   "), "Over je vraag:");

  const lang = "x".repeat(200);
  const prefix = vraagAntwoordPrefix(lang);
  assert.ok(prefix.length < 100, "een absurde bestandsnaam mag het bericht niet opeten");
  assert.ok(prefix.includes("…"));
});

test("een leeg antwoord wordt nooit verstuurd", () => {
  // Anders krijgt de boekhouder een bericht dat alleen uit onze eigen kopregel bestaat.
  assert.equal(bouwAntwoordBericht("bon.pdf", "   "), null);
  assert.equal(bouwAntwoordBericht("bon.pdf", ""), null);
  assert.equal(
    bouwAntwoordBericht("bon.pdf", "  Die zit in de doos van juni.  "),
    'Over je vraag bij "bon.pdf":\nDie zit in de doos van juni.',
  );
});

test("de banner geeft een sleutel en een aantal, en zwijgt bij nul", () => {
  assert.equal(vragenBannerRegel(0), null);
  assert.equal(vragenBannerRegel(-1), null);
  assert.equal(vragenBannerRegel(Number.NaN), null);
  assert.deepEqual(vragenBannerRegel(1), { key: "start.vragen.een", params: {} });
  assert.deepEqual(vragenBannerRegel(3), { key: "start.vragen.meer", params: { n: 3 } });
});

test("[VRAGEN-TELLING] document, factuur, beide — en een mislukte lezing is geen nul", () => {
  const ok = (n: number) => ({ count: n, error: null });
  const fail = { count: null, error: { message: "permission denied for table accountant_subject_status" } };
  assert.deepEqual(openQuestionCount(ok(1), ok(0)), { known: true, count: 1 }, "alleen een documentvraag");
  assert.deepEqual(openQuestionCount(ok(0), ok(1)), { known: true, count: 1 }, "alleen een factuurvraag");
  assert.deepEqual(openQuestionCount(ok(2), ok(3)), { known: true, count: 5 }, "allebei");
  assert.deepEqual(openQuestionCount(ok(0), ok(0)), { known: true, count: 0 }, "niets open");
  // [NO-SILENT-EMPTY] de helft die mislukte maakt het hele antwoord onbekend — nooit een kleiner getal
  assert.deepEqual(openQuestionCount(fail, ok(4)), { known: false }, "documentlezing mislukt");
  assert.deepEqual(openQuestionCount(ok(4), fail), { known: false }, "factuurlezing mislukt");
  assert.deepEqual(openQuestionCount(fail, fail), { known: false }, "beide mislukt");
  // en een telling die als null binnenkwam is geen telling
  assert.deepEqual(openQuestionCount({ count: null, error: null }, ok(1)), { known: false });
});

test("de klant kan een vraag niet zelf afvinken — die weg bestaat hier niet", () => {
  // Vangnet tegen een latere 'handige' toevoeging: een status is een bewering van de
  // boekhouder. Zodra hier een functie verschijnt die een status zet, faalt deze test en
  // moet die keuze bewust worden gemaakt, niet per ongeluk.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./vragen") as Record<string, unknown>;
  for (const naam of Object.keys(mod)) {
    assert.ok(
      !/^(set|mark|update|resolve|close|beantwoord)/i.test(naam),
      `vragen.ts exporteert ${naam} — de klant mag de status van de boekhouder niet schrijven`,
    );
  }
});

// ─── [FACTUURVRAAG] Vragen over een FACTUUR ──────────────────────────────────
//
// De boekhouder kon een factuur al op 'vraag' zetten in de zin dat drie van zijn schermen die
// status TELDEN — de KPI "Open vraag", de rode stip bij een klant, het ❓-punt op het werkboard —
// terwijl geen enkele route hem schreef. Dit is de helft die ontbrak, met dezelfde eerlijkheids-
// regels als de documentkant: niets verzinnen, niets stil weglaten.

test('[FACTUURVRAAG] een factuurvraag komt terug met de factuur erbij', () => {
  const open = buildOpenInvoiceVragen(
    [{ subject_id: 'i1', status: VRAAG_STATUS, vraag_text: 'Is dit zakelijk of privé?', updated_at: '2026-08-01T10:00:00Z' }],
    [{ id: 'i1', invoice_number: '26302050', client_name: 'ATAPACK Cash & Carry B.V.', total_inc_btw: 2265.41, invoice_date: '2026-06-01' }],
  )
  assert.equal(open.length, 1)
  assert.equal(open[0].subjectType, 'invoice')
  assert.equal(open[0].question, 'Is dit zakelijk of privé?')
  assert.equal(open[0].invoice?.invoice_number, '26302050')
})

test('[FACTUURVRAAG] de factuur wordt genoemd zoals de eigenaar hem herkent', () => {
  // "Je factuur" is niets waard voor iemand met vierhonderd facturen. De leverancier is wat hij
  // het eerst herkent, het nummer maakt het er precies één, en het bedrag maakt dat hij hem zich
  // herinnert.
  const label = invoiceLabel({
    id: 'i1', invoice_number: '26302050', client_name: 'ATAPACK Cash & Carry B.V.',
    total_inc_btw: 2265.41, invoice_date: '2026-06-01',
  })
  assert.match(label, /ATAPACK/)
  assert.match(label, /26302050/)
  assert.match(label, /2\.265,41/)

  // Elk deel alleen als wij het ECHT hebben — nooit een plaatshouder die als gegeven leest.
  assert.equal(invoiceLabel({ id: 'x', invoice_number: null, client_name: null, total_inc_btw: null, invoice_date: null }), 'Factuur')
  assert.equal(invoiceLabel({ id: 'x', invoice_number: null, client_name: 'Sligro', total_inc_btw: null, invoice_date: null }), 'Sligro')
  // Een creditnota is negatief; het label toont de omvang, niet een minteken dat als typefout leest.
  assert.match(invoiceLabel({ id: 'x', invoice_number: 'CR1', client_name: null, total_inc_btw: -50, invoice_date: null }), /50,00/)
})

test('[FACTUURVRAAG] een vraag over een factuur die wij niet kunnen lezen verdwijnt niet stil', () => {
  // Dezelfde regel als aan de documentkant: hem verbergen is ook een bewering. De vraag staat
  // open, en het scherm moet kunnen zeggen dat wij het onderwerp niet meer kunnen tonen.
  const open = buildOpenInvoiceVragen(
    [{ subject_id: 'weg', status: VRAAG_STATUS, vraag_text: 'Welke klus was dit?', updated_at: '2026-08-01T10:00:00Z' }],
    [],
  )
  assert.equal(open.length, 1)
  assert.equal(open[0].documentMissing, true)
  assert.equal(open[0].invoice, null)
  assert.equal(open[0].documentName, null)
})

test('[FACTUURVRAAG] alleen status vraag telt, en oudste eerst', () => {
  const open = buildOpenInvoiceVragen(
    [
      { subject_id: 'nieuw', status: VRAAG_STATUS, vraag_text: 'b', updated_at: '2026-08-05T10:00:00Z' },
      { subject_id: 'verwerkt', status: 'verwerkt', vraag_text: null, updated_at: '2026-08-01T10:00:00Z' },
      { subject_id: 'oud', status: VRAAG_STATUS, vraag_text: 'a', updated_at: '2026-07-01T10:00:00Z' },
      { subject_id: 'zonderdatum', status: VRAAG_STATUS, vraag_text: 'c', updated_at: null },
    ],
    [],
  )
  assert.deepEqual(open.map((v) => v.documentId), ['oud', 'nieuw', 'zonderdatum'],
    'verwerkt is geen vraag; oudste eerst; zonder datum achteraan')
})

test('[FACTUURVRAAG] een lege toelichting wordt niet als vraag verzonnen', () => {
  const open = buildOpenInvoiceVragen(
    [{ subject_id: 'i1', status: VRAAG_STATUS, vraag_text: '   ', updated_at: null }],
    [{ id: 'i1', invoice_number: '1', client_name: 'X', total_inc_btw: 1, invoice_date: null }],
  )
  assert.equal(open[0].question, null, 'het scherm zegt dan "geen toelichting", niet een verzonnen zin')
})

test('[FACTUURVRAAG] de documentkant blijft precies wat hij was', () => {
  // Deze uitbreiding mag de bestaande helft niet verschuiven: subjectType wordt gezet, verder
  // verandert er niets aan wat buildOpenVragen teruggeeft.
  const open = buildOpenVragen(
    [{ subject_id: 'd1', status: VRAAG_STATUS, vraag_text: 'Mis ik hier een bon?', updated_at: '2026-08-01T10:00:00Z' }],
    [{ id: 'd1', file_name: 'bon.pdf', trashed: false }],
  )
  assert.equal(open[0].subjectType, 'document')
  assert.equal(open[0].documentName, 'bon.pdf')
  assert.equal(open[0].invoice, undefined, 'een documentvraag draagt geen factuur mee')
})

// ── [VRAAG-EIGENAAR] every question carries its asker ────────────────────────────────────────────
const ACC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("[VRAAG-EIGENAAR] a document question carries the accountant who asked it", () => {
  const open = buildOpenVragen([{ ...status("d", VRAAG_STATUS, "Bon?"), accountant_id: ACC_A }], [doc("d", "d.pdf")]);
  assert.equal(open[0].accountantId, ACC_A);
  const oud = buildOpenVragen([status("d", VRAAG_STATUS, "Bon?")], [doc("d", "d.pdf")]);
  assert.equal(oud[0].accountantId, null, "a row read without the column is honest about it, not defaulted to anyone");
});

test("[VRAAG-EIGENAAR] two accountants asking about the SAME invoice are two questions, each with its own asker", () => {
  const inv = { id: "inv-1", invoice_number: "2026-014", client_name: "Bakker BV", total_inc_btw: 121, invoice_date: "2026-05-01" };
  const open = buildOpenInvoiceVragen(
    [
      { subject_id: "inv-1", status: VRAAG_STATUS, vraag_text: "Tarief?", updated_at: "2026-07-01T10:00:00.000Z", accountant_id: ACC_A },
      { subject_id: "inv-1", status: VRAAG_STATUS, vraag_text: "Privé?", updated_at: "2026-07-02T10:00:00.000Z", accountant_id: ACC_B },
    ],
    [inv],
  );
  assert.equal(open.length, 2, "never merged under one accountant id");
  assert.deepEqual(open.map((q) => q.accountantId), [ACC_A, ACC_B]);
  assert.deepEqual(open.map((q) => q.question), ["Tarief?", "Privé?"]);
});

// ── [VRAAG-DEUR] the invoice's own direction decides the screen ──────────────────────────────────
import { invoiceQuestionHref } from "./vragen";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

test("[VRAAG-DEUR] an incoming invoice opens Inkomend, focused, with the way back to the questions", () => {
  assert.equal(
    invoiceQuestionHref({ id: "inv-in", direction: "incoming", sender_id: OTHER, receiver_id: OWNER }, OWNER),
    "/dashboard/incoming/manage?focus=inv-in&from=vragen",
  );
});

test("[VRAAG-DEUR] an outgoing invoice opens its own page — never the purchase list", () => {
  assert.equal(
    invoiceQuestionHref({ id: "inv-out", direction: "outgoing", sender_id: OWNER, receiver_id: null }, OWNER),
    "/dashboard/invoice/inv-out?from=vragen",
  );
});

test("[VRAAG-DEUR] a null direction is settled by ownership, the same rule the closing package uses", () => {
  assert.equal(invoiceQuestionHref({ id: "x", direction: null, sender_id: OTHER, receiver_id: OWNER }, OWNER), "/dashboard/incoming/manage?focus=x&from=vragen");
  assert.equal(invoiceQuestionHref({ id: "x", direction: null, sender_id: OWNER, receiver_id: OTHER }, OWNER), "/dashboard/invoice/x?from=vragen");
});

test("[VRAAG-DEUR] when neither the direction nor the ownership settles it, there is no door — never a guess", () => {
  assert.equal(invoiceQuestionHref({ id: "x", direction: null, sender_id: OTHER, receiver_id: OTHER }, OWNER), null);
  assert.equal(invoiceQuestionHref({ id: "x", direction: "sideways", sender_id: null, receiver_id: null }, OWNER), null);
  assert.equal(invoiceQuestionHref(null, OWNER), null);
  assert.equal(invoiceQuestionHref({ id: "a&b", direction: "outgoing" }, OWNER), "/dashboard/invoice/a%26b?from=vragen", "the id is encoded");
});
