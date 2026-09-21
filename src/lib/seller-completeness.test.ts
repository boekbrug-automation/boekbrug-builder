// src/lib/seller-completeness.test.ts
// [VERKOPER-COMPLEET] Run: npx tsx --test src/lib/seller-completeness.test.ts
//
// Every case here is a real call into the shipped decision, not an assertion about source text.
// That matters more than usual: this module decides what happens on the one button in the product
// that cannot be undone — a legal invoice number out of a gapless sequence (art. 35 Wet OB) and a
// document in a customer's inbox.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  missingSellerFields,
  isSellerComplete,
  sellerFieldLabels,
  prefillSellerFields,
  handoffValueUsable,
  classifySellerGate,
  classifySellerSave,
  saveAllowsSend,
  SELLER_FIELD_ORDER,
  SELLER_FIELD_LABEL_NL,
  type SellerField,
} from "./seller-completeness";

/** A seller with everything art. 35a asks for — and deliberately no IBAN. */
const COMPLETE = {
  btw_number: "NL123456789B01",
  kvk_number: "12345678",
  address: "Dorpsstraat 1, 1234 AB Utrecht",
  company_name: "Jansen Klussen",
  full_name: "Piet Jansen",
};

// ── What "complete" means ─────────────────────────────────────────────────────────────────────

test("[VERKOPER-COMPLEET] a complete profile has nothing missing, and the send may go ahead", () => {
  assert.deepEqual(missingSellerFields(COMPLETE), []);
  assert.equal(isSellerComplete(COMPLETE), true);

  // The gate the screen actually runs, on the answer the route actually gives for this profile.
  assert.deepEqual(classifySellerGate(200, { ok: true, status: "compleet" }), { action: "proceed" });
});

test("[VERKOPER-COMPLEET] only the fields that are genuinely empty are asked for", () => {
  // A brand-new account that has typed nothing: all four, in the order the refusal names them.
  assert.deepEqual(missingSellerFields(null), ["btw_number", "kvk_number", "address", "company_name"]);

  // One field short — and ONLY that field comes back. Asking for the other three would make the
  // owner retype what is already on file, which is the whole thing this batch removes.
  assert.deepEqual(missingSellerFields({ ...COMPLETE, kvk_number: null }), ["kvk_number"]);
  assert.deepEqual(missingSellerFields({ ...COMPLETE, btw_number: "" }), ["btw_number"]);
  assert.deepEqual(missingSellerFields({ ...COMPLETE, address: "   " }), ["address"],
    "a field holding only spaces counts as filled in");

  // Two short, still in the canonical order rather than the order they were discovered.
  assert.deepEqual(
    missingSellerFields({ ...COMPLETE, address: "", btw_number: "" }),
    ["btw_number", "address"],
  );
});

test("[VERKOPER-COMPLEET] either name carries the seller, so either one satisfies the name", () => {
  // An eenmanszaak that never filled in a company name is named by full_name on the invoice, and
  // the send door has always accepted that. Asking such an owner to invent a company name would
  // be this screen inventing a requirement the law does not have.
  assert.deepEqual(missingSellerFields({ ...COMPLETE, company_name: null }), []);
  assert.deepEqual(missingSellerFields({ ...COMPLETE, full_name: null }), []);
  assert.deepEqual(
    missingSellerFields({ ...COMPLETE, company_name: "", full_name: "  " }),
    ["company_name"],
    "with neither name there is nobody on the invoice",
  );
});

test("[VERKOPER-COMPLEET] IBAN is not part of this set, and its absence never blocks a send", () => {
  // The send door has never required it: payment information, not a validity requirement. If this
  // ever fails, a first invoice is being blocked on a field art. 35a does not ask for.
  assert.equal((SELLER_FIELD_ORDER as readonly string[]).includes("iban"), false);
  assert.equal(Object.keys(SELLER_FIELD_LABEL_NL).includes("iban"), false);

  // A complete seller with no bank account anywhere in the facts is still complete.
  assert.deepEqual(missingSellerFields({ ...COMPLETE, iban: null } as Record<string, unknown>), []);
  assert.deepEqual(classifySellerGate(200, { ok: true, status: "compleet" }), { action: "proceed" });
});

test("[VERKOPER-COMPLEET] the server's refusal still reads exactly as it always did", () => {
  // The sentence /api/invoice/send produces is built from these labels. It is live text; this
  // pins the words and their order so moving the rule into a module cannot reword a message in
  // production by one character.
  assert.deepEqual(
    sellerFieldLabels(missingSellerFields(null)),
    ["BTW-nummer", "KvK-nummer", "adres", "bedrijfsnaam"],
  );
  assert.equal(
    `Vul eerst je ${sellerFieldLabels(missingSellerFields(null)).join(", ")} in bij Instellingen`,
    "Vul eerst je BTW-nummer, KvK-nummer, adres, bedrijfsnaam in bij Instellingen",
  );
});

// ── Prefill, and the precedence that must only run one way ────────────────────────────────────

const HANDOFF = {
  company_name: "Jansen Klussen",
  kvk_number: "87654321",
  btw_number: "NL987654321B01",
  address: "Kerkweg 9, 4321 ZZ Tilburg",
};

test("[VERKOPER-COMPLEET] a usable handoff value fills a field the profile does not have", () => {
  const leeg = { btw_number: null, kvk_number: null, address: null, company_name: null, full_name: null };
  const missing = missingSellerFields(leeg);
  const prefill = prefillSellerFields(missing, leeg, HANDOFF);

  assert.equal(prefill.kvk_number.value, "87654321");
  assert.equal(prefill.kvk_number.origin, "handoff");
  assert.equal(prefill.btw_number.value, "NL987654321B01");
  assert.equal(prefill.address.value, "Kerkweg 9, 4321 ZZ Tilburg");
  assert.equal(prefill.company_name.value, "Jansen Klussen");
});

test("[VERKOPER-COMPLEET] an existing profile value beats the handoff, always", () => {
  // The case that matters: the owner saved a BTW-id months ago, and a stale browser key from the
  // free generator carries a different one. Letting that win would put the wrong number on a
  // customer's invoice, and nobody would see it happen.
  const prefill = prefillSellerFields(
    [...SELLER_FIELD_ORDER],          // deliberately WIDER than what is missing
    COMPLETE,
    HANDOFF,
  );
  assert.equal(prefill.btw_number.value, "NL123456789B01", "the handoff overwrote a saved BTW-id");
  assert.equal(prefill.btw_number.origin, "profile");
  assert.equal(prefill.kvk_number.value, "12345678");
  assert.equal(prefill.kvk_number.origin, "profile");
  assert.equal(prefill.address.value, "Dorpsstraat 1, 1234 AB Utrecht");
  assert.equal(prefill.company_name.value, "Jansen Klussen");

  // And the mixed case, which is the realistic one: one field saved, one field not.
  const half = { ...COMPLETE, kvk_number: "" };
  const mixed = prefillSellerFields(["btw_number", "kvk_number"], half, HANDOFF);
  assert.equal(mixed.btw_number.origin, "profile", "a saved field must not be reopened by a handoff");
  assert.equal(mixed.kvk_number.origin, "handoff");
  assert.equal(mixed.kvk_number.value, "87654321");
});

test("[VERKOPER-COMPLEET] full_name stands in for a missing company_name in the prefill too", () => {
  const p = prefillSellerFields(["company_name"], { company_name: "", full_name: "Piet Jansen" }, HANDOFF);
  assert.equal(p.company_name.value, "Piet Jansen");
  assert.equal(p.company_name.origin, "profile");
});

test("[VERKOPER-COMPLEET] a malformed handoff value is not carried over as though it were fine", () => {
  // localStorage is an external system: anything can have written anything. A KvK of five digits
  // or a BTW-id that is not NL…B.. would be refused on save, so offering it as the owner's own
  // data is offering them a form that is already wrong.
  assert.equal(handoffValueUsable("kvk_number", "1234"), false);
  assert.equal(handoffValueUsable("kvk_number", "12345678"), true);
  assert.equal(handoffValueUsable("btw_number", "BE0123456789"), false);
  assert.equal(handoffValueUsable("btw_number", "nl123456789b01"), true, "case and spacing are normalised, not rejected");
  assert.equal(handoffValueUsable("btw_number", "NL 123456789 B01"), true);
  // Free text cannot be malformed; empty still is not a value.
  assert.equal(handoffValueUsable("address", "Kerkweg 9"), true);
  assert.equal(handoffValueUsable("company_name", "   "), false);

  const leeg = { btw_number: null, kvk_number: null, address: null, company_name: null, full_name: null };
  const rommel = prefillSellerFields(
    [...SELLER_FIELD_ORDER],
    leeg,
    { ...HANDOFF, kvk_number: "1234", btw_number: "niet-een-nummer" },
  );
  assert.equal(rommel.kvk_number.value, "", "a five-digit KvK was offered as the owner's own");
  assert.equal(rommel.kvk_number.origin, "none");
  assert.equal(rommel.btw_number.value, "");
  assert.equal(rommel.btw_number.origin, "none");
  // …while the two that ARE usable in the same payload still come through.
  assert.equal(rommel.address.origin, "handoff");
  assert.equal(rommel.company_name.origin, "handoff");
});

test("[VERKOPER-COMPLEET] a field that was not asked for is never prefilled", () => {
  const leeg = { btw_number: null, kvk_number: null, address: null, company_name: null, full_name: null };
  const p = prefillSellerFields(["kvk_number"], leeg, HANDOFF);
  assert.equal(p.kvk_number.origin, "handoff");
  for (const f of ["btw_number", "address", "company_name"] as SellerField[]) {
    assert.equal(p[f].value, "", `${f} was filled in without being asked for`);
    assert.equal(p[f].origin, "none");
  }
});

test("[VERKOPER-COMPLEET] no handoff at all is an ordinary empty form, not a crash", () => {
  const leeg = { btw_number: null, kvk_number: null, address: null, company_name: null, full_name: null };
  for (const bron of [null, undefined, {}]) {
    const p = prefillSellerFields([...SELLER_FIELD_ORDER], leeg, bron);
    for (const f of SELLER_FIELD_ORDER) assert.equal(p[f].origin, "none");
  }
});

// ── The gate: three moves, and only one of them sends ─────────────────────────────────────────

test("[VERKOPER-COMPLEET] a complete answer proceeds; an incomplete one asks for exactly those fields", () => {
  assert.deepEqual(classifySellerGate(200, { ok: true, status: "compleet" }), { action: "proceed" });
  assert.deepEqual(
    classifySellerGate(200, { ok: true, status: "onvolledig", missing: ["address", "btw_number"] }),
    { action: "ask", fields: ["btw_number", "address"] },
    "the form must show the fields in the module's order, not the order they arrived in",
  );
});

test("[VERKOPER-COMPLEET] a sales member is not asked, and is not blocked either", () => {
  // [ACTING-FOR] Their employer's profile is not theirs to read or repair. The screen asks
  // nothing and the send door checks the real owner. Blocking here would take invoicing away
  // from the people whose job it is.
  assert.deepEqual(classifySellerGate(403, { error: "…alleen de eigenaar…" }), { action: "proceed" });
});

test("[VERKOPER-COMPLEET] an unreadable profile stops the send — it does not become a setup form", () => {
  // [PROFILE-READ] The non-negotiable one. A failed read is not an empty profile: turning a
  // database outage into "fill in your BTW-nummer" tells an owner their details are gone.
  assert.deepEqual(
    classifySellerGate(503, { ok: false, code: "profiel_onleesbaar", error: "We konden je bedrijfsgegevens nu niet lezen." }),
    { action: "stop" },
  );
  // And it must not be mistaken for an ASK, which is the failure that would produce the form.
  assert.notEqual(
    classifySellerGate(503, { ok: false, code: "profiel_onleesbaar" }).action,
    "ask",
  );
  for (const status of [401, 500, 502, 504]) {
    assert.deepEqual(classifySellerGate(status, { error: "x" }), { action: "stop" }, `status ${status} let a send through`);
  }
});

test("[VERKOPER-COMPLEET] an answer we do not understand is never a green light", () => {
  for (const body of [null, undefined, {}, { status: "iets-anders" }, { ok: true }, "compleet", 42, []]) {
    assert.deepEqual(classifySellerGate(200, body), { action: "stop" }, `body ${JSON.stringify(body)} proceeded`);
  }
  // "incomplete, but the list is empty / unusable" is the subtle one: proceeding would send an
  // invoice the door then refuses, and asking would show a form with no fields in it.
  assert.deepEqual(classifySellerGate(200, { status: "onvolledig", missing: [] }), { action: "stop" });
  assert.deepEqual(classifySellerGate(200, { status: "onvolledig", missing: "kvk_number" }), { action: "stop" });
  assert.deepEqual(classifySellerGate(200, { status: "onvolledig", missing: ["iban", "vak"] }), { action: "stop" },
    "a field name this build cannot label would render as a box nobody can fill in");
  // A mix: the known field is asked for, the unknown one is dropped rather than shown blank.
  assert.deepEqual(
    classifySellerGate(200, { status: "onvolledig", missing: ["iban", "address"] }),
    { action: "ask", fields: ["address"] },
  );
});

// ── The save: only "complete" may lead to a send ──────────────────────────────────────────────

test("[VERKOPER-COMPLEET] a successful save is the only outcome that lets the send continue", () => {
  const ok = classifySellerSave(200, { ok: true, status: "compleet" });
  assert.deepEqual(ok, { outcome: "complete" });
  assert.equal(saveAllowsSend(ok), true);
});

test("[VERKOPER-COMPLEET] a failed save keeps the form and sends nothing", () => {
  // §8: the entered values stay on screen, the failure is stated, SEND is not called and no
  // invoice number is asked for. saveAllowsSend is the half of that this module owns.
  for (const [status, body] of [
    [503, { ok: false, code: "opslaan_mislukt", error: "Opslaan is niet gelukt." }],
    [503, { ok: false, code: "profiel_onleesbaar" }],
    [500, null],
    [400, { ok: false }],
  ] as Array<[number, unknown]>) {
    const uit = classifySellerSave(status, body);
    assert.equal(uit.outcome, "failed", `status ${status} produced ${uit.outcome}`);
    assert.equal(saveAllowsSend(uit), false, `status ${status} allowed a send after a failed save`);
  }
});

test("[VERKOPER-COMPLEET] a per-field refusal is kept apart from an outage, and neither sends", () => {
  // The owner can fix a problem and cannot fix an outage, so the two get different sentences —
  // but they get the same answer to "may this invoice go out".
  const uit = classifySellerSave(400, {
    ok: false,
    problems: { kvk_number: "KVK-nummer moet uit 8 cijfers bestaan" },
    missing: ["kvk_number"],
  });
  assert.deepEqual(uit, { outcome: "problems", problems: { kvk_number: "KVK-nummer moet uit 8 cijfers bestaan" } });
  assert.equal(saveAllowsSend(uit), false);

  // A `problems` that is not a map of sentences is an outage, not a field error.
  for (const rommel of [{ problems: [] }, { problems: "kapot" }, { problems: { kvk_number: 7 } }]) {
    const u = classifySellerSave(400, rommel);
    assert.equal(u.outcome, "failed");
    assert.equal(saveAllowsSend(u), false);
  }
});

test("[VERKOPER-COMPLEET] a save that landed but left something missing asks again, never sends", () => {
  const uit = classifySellerSave(200, { ok: true, status: "onvolledig", missing: ["address"] });
  assert.deepEqual(uit, { outcome: "ask", fields: ["address"] });
  assert.equal(saveAllowsSend(uit), false);

  // A 2xx with nothing recognisable in it is a failure, not a green light.
  const leeg = classifySellerSave(200, { ok: true });
  assert.equal(leeg.outcome, "failed");
  assert.equal(saveAllowsSend(leeg), false);
});

test("[VERKOPER-COMPLEET] exactly one outcome in the whole space permits a send", () => {
  // Written as a sweep rather than four separate asserts, because the invariant is about the
  // WHOLE space: if a new outcome is ever added and forgotten here, this goes red.
  const alle = [
    classifySellerSave(200, { status: "compleet" }),
    classifySellerSave(200, { status: "onvolledig", missing: ["address"] }),
    classifySellerSave(400, { problems: { address: "verplicht" } }),
    classifySellerSave(503, { code: "opslaan_mislukt" }),
    classifySellerSave(200, null),
  ];
  assert.equal(alle.filter(saveAllowsSend).length, 1);
  assert.equal(alle.filter(saveAllowsSend)[0].outcome, "complete");
});
