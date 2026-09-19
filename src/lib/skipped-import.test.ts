// [OBSERVABILITY] Pure node test — run: npx tsx --test src/lib/skipped-import.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOC_TYPE_COULD_NOT_READ,
  DOC_TYPE_UNSUPPORTED,
  SKIPPED_DOC_TYPES,
  docTypeForStoredFile,
  isSkippedDocType,
  DOC_TYPE_WACHT_OP_LEZEN,
  DOC_TYPE_WACHT_OP_BESLUIT,
  WACHTENDE_DOC_TYPES,
  isWachtendDocType,
  mayDrainRetry,
  DOC_TYPE_REMINDER
} from "./skipped-import";

test("een onleesbaar bestand krijgt de reden, niet de gok van de AI", () => {
  // DE BUG: /api/intake schreef `v.document_kind ?? "other"` óók als couldNotRead waar was.
  // Een gefotografeerde bon die niet te lezen was, kwam als "other" in bestanden en werd door
  // niets geteld — waarna het paneel meldde "Niets overgeslagen".
  assert.equal(docTypeForStoredFile(true, "invoice"), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, "receipt"), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, null), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, "other"), DOC_TYPE_COULD_NOT_READ);
});

test("een wél gelezen bestand houdt zijn classificatie", () => {
  assert.equal(docTypeForStoredFile(false, "invoice"), "invoice");
  assert.equal(docTypeForStoredFile(false, "receipt"), "receipt");
  // Niets bruikbaars → 'other', zoals voorheen.
  assert.equal(docTypeForStoredFile(false, null), "other");
  assert.equal(docTypeForStoredFile(false, undefined), "other");
  assert.equal(docTypeForStoredFile(false, "   "), "other");
});

test("de lezer telt precies wat de schrijvers wegschrijven", () => {
  // Dit is het invariant dat de bug veroorzaakte: schrijver en lezer liepen uit elkaar.
  assert.equal(isSkippedDocType(DOC_TYPE_COULD_NOT_READ), true);
  assert.equal(isSkippedDocType(DOC_TYPE_UNSUPPORTED), true);
  assert.equal(isSkippedDocType(docTypeForStoredFile(true, "invoice")), true,
    "wat de schrijver bij een leesfout produceert, MOET de lezer tellen");
});

test("een normaal document telt niet als overgeslagen", () => {
  for (const t of ["invoice", "receipt", "other", "ubl_invoice", "", null, undefined]) {
    assert.equal(isSkippedDocType(t), false, `${String(t)} is niet overgeslagen`);
  }
});

test("de lijst is de enige bron — en hij is niet leeg", () => {
  // Zou iemand hem legen, dan meldt het paneel weer altijd "niets overgeslagen".
  assert.ok(SKIPPED_DOC_TYPES.length >= 2);
  assert.ok(SKIPPED_DOC_TYPES.includes(DOC_TYPE_COULD_NOT_READ));
  assert.ok(SKIPPED_DOC_TYPES.includes(DOC_TYPE_UNSUPPORTED));
});

// ── [ONTVANGEN] Waiting is not failure, and a question is not a retry ─────────────────────────
//
// #129 gives a document two states it never had: it is received but not yet read, or it is read
// and one question is open that only the owner can answer. Both are normal. Neither is a skip.
//
// The reason this is a test and not a comment is the history at the top of this file: the panel
// "Overgeslagen bij import" lied for months because the writer and the reader used different
// values. The cheapest way to repeat that is to let a new state drift into the skipped list —
// and then every ordinary upload reports itself as skipped, which is the sentence that makes an
// entrepreneur stop looking.

test("[ONTVANGEN] wachten is geen overslaan", () => {
  for (const wachtend of WACHTENDE_DOC_TYPES) {
    assert.equal(
      isSkippedDocType(wachtend), false,
      `${wachtend} telt mee in "Overgeslagen bij import" — dan meldt dat paneel bij elke gewone ` +
      `upload dat er iets is overgeslagen, en dat is precies de leugen waar dit bestand voor bestaat`,
    );
  }
  // en andersom: een echte leesfout is GEEN wachttoestand
  for (const overgeslagen of SKIPPED_DOC_TYPES) {
    assert.equal(isWachtendDocType(overgeslagen), false, `${overgeslagen} wordt als wachtend geteld`);
  }
});

test("[ONTVANGEN] de twee wachttoestanden zeggen verschillende dingen", () => {
  assert.equal(isWachtendDocType(DOC_TYPE_WACHT_OP_LEZEN), true);
  assert.equal(isWachtendDocType(DOC_TYPE_WACHT_OP_BESLUIT), true);
  assert.notEqual(DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_WACHT_OP_BESLUIT);
  // en geen van beide is de leesfout, want dat is het onderscheid waar alles op hangt
  assert.notEqual(DOC_TYPE_WACHT_OP_LEZEN, DOC_TYPE_COULD_NOT_READ);
  assert.notEqual(DOC_TYPE_WACHT_OP_BESLUIT, DOC_TYPE_COULD_NOT_READ);
});

test("[ONTVANGEN] de achtergrondpas probeert alleen opnieuw wat op ONS wacht", () => {
  // Een storing lost zichzelf soms op; een vraag aan een mens niet. Zou de drain een openstaande
  // eigenaarsvraag blijven oppakken, dan draait hij eeuwig op hetzelfde document en stopt telkens
  // op hetzelfde punt — werk zonder uitkomst, en een teller die nooit leegloopt.
  assert.equal(mayDrainRetry(DOC_TYPE_WACHT_OP_LEZEN), true, "een ongelezen document hoort opgepakt te worden");
  assert.equal(
    mayDrainRetry(DOC_TYPE_WACHT_OP_BESLUIT), false,
    "de drain pakt een openstaande eigenaarsvraag op — meer rekenen maakt dat antwoord niet anders",
  );
  for (const anders of [DOC_TYPE_COULD_NOT_READ, DOC_TYPE_UNSUPPORTED, DOC_TYPE_REMINDER, "invoice", "receipt", null, undefined, ""]) {
    assert.equal(mayDrainRetry(anders), false, `de drain pakt ${String(anders)} op, en dat is niet zijn werk`);
  }
});
