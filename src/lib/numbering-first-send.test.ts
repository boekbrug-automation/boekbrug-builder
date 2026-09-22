// src/lib/numbering-first-send.test.ts
// [NUMMER-EENMALIG] Run: npx tsx --test src/lib/numbering-first-send.test.ts
//
// Every case here calls the shipped decision. The stakes are unusual even for this codebase: the
// thing being decided is whether to show an owner an editable form over a numbering series that
// art. 35 Wet OB says must be sequential, gapless and forward-only. Getting "locked" wrong in the
// permissive direction is not a wrong screen — it is an invitation to reshape a series that has
// already issued.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyNumberingRead,
  classifyNumberingSave,
  firstSendNumbering,
  numberingChangeRequested,
  saveAllowsSend,
  type NumberingState,
} from "./numbering-first-send";

/** What GET /api/invoice/numbering answers for a fresh owner on the untouched default. */
const VERS = { ok: true, template: "{year}{seq}", isCustom: false, padding: 4, yearlyReset: true, locked: false, nextSeq: 1, next: "20260001" };

// ── Case 1: fresh owner, unlocked default ─────────────────────────────────────────────────────

test("[NUMMER-EENMALIG] a fresh owner sees the expected number and the one-time consequence", () => {
  const state = classifyNumberingRead(200, VERS);
  assert.deepEqual(state, { kind: "open", next: "20260001", isCustom: false });

  const notice = firstSendNumbering(state);
  assert.ok(notice, "a fresh owner on the default is told nothing at all");
  assert.equal(notice.next, "20260001", "the confirmation must name the number this invoice will carry");
  assert.equal(notice.explainOnce, true, "the one-time lock consequence is not stated");
  assert.equal(notice.adjustable, true, "…and there is no way to change it before issuing");
});

// ── Case 2: accepting the default costs nothing ───────────────────────────────────────────────

test("[NUMMER-EENMALIG] accepting the default sends no numbering request at all", () => {
  // THE ZERO-SETUP PATH. The owner reads the sentence and presses send. Nothing was opened,
  // nothing typed — so no POST, no counter seed, no profile write. The default stands because it
  // was already valid, not because anything confirmed it.
  assert.equal(numberingChangeRequested(false, ""), false, "an untouched confirmation would write numbering");
  assert.equal(numberingChangeRequested(false, "2026-001"), false,
    "a value left in state from a field the owner closed again would be written");
  assert.equal(numberingChangeRequested(true, ""), false, "an opened but empty field would be written");
  assert.equal(numberingChangeRequested(true, "   "), false, "whitespace would be written as a numbering choice");

  // And only an actual value asks the authority anything.
  assert.equal(numberingChangeRequested(true, "2026-001"), true);
  assert.equal(numberingChangeRequested(true, "  045-2026  "), true);
});

// ── Case 3: choosing to adjust goes through the existing authority ────────────────────────────

test("[NUMMER-EENMALIG] a saved change is the only outcome that lets the send continue", () => {
  const saved = classifyNumberingSave(200, { ok: true, template: "{seq}-{year}", padding: 3, startSeq: 45, first: "045-2026", next: "046-2026" });
  assert.deepEqual(saved, { outcome: "saved", next: "046-2026" });
  assert.equal(saveAllowsSend(saved), true);
  // The number shown afterwards is the AUTHORITY's, never what was typed: the route clamps a seed
  // forward-only and returns what landed.
  if (saveAllowsSend(saved)) assert.equal(saved.next, "046-2026");
});

// ── Case 4: invalid custom numbering → no send ────────────────────────────────────────────────

test("[NUMMER-EENMALIG] a refused number stops the send and says what is wrong", () => {
  const uit = classifyNumberingSave(400, { ok: false, error: "Dit nummer snappen we niet helemaal — probeer bijv. 045-2026 of 2026-045.", reason: "ambiguous_counter" });
  assert.equal(uit.outcome, "invalid");
  if (uit.outcome === "invalid") assert.match(uit.message, /045-2026/, "the owner is not told what to fix");
  assert.equal(saveAllowsSend(uit), false, "a refused numbering became an issued invoice");

  // A 400 with no sentence in it is an outage, not a field error — there is nothing to act on.
  for (const leeg of [{ ok: false }, { ok: false, error: "" }, { ok: false, error: "   " }, null]) {
    const u = classifyNumberingSave(400, leeg);
    assert.equal(u.outcome, "failed", `400 with body ${JSON.stringify(leeg)} claimed to be actionable`);
    assert.equal(saveAllowsSend(u), false);
  }
});

// ── Case 5: a failed save → no send ───────────────────────────────────────────────────────────

test("[NUMMER-EENMALIG] a failed save stops the send, whatever shape the failure has", () => {
  for (const [status, body] of [
    [503, { ok: false, code: "lock_check_unavailable", error: "We konden nu niet nagaan of je al facturen hebt verstuurd." }],
    [500, { ok: false, error: "Onbekende fout" }],
    [500, null],
    [401, { error: "Niet ingelogd" }],
    [200, { ok: true }],            // 2xx with no number in it is not a save
    [200, { ok: false }],
    [200, null],
  ] as Array<[number, unknown]>) {
    const u = classifyNumberingSave(status, body);
    assert.equal(u.outcome, "failed", `status ${status} produced ${u.outcome}`);
    assert.equal(saveAllowsSend(u), false, `status ${status} allowed a send after a failed numbering save`);
  }
});

test("[NUMMER-EENMALIG] a 409 is the series closing under the owner's feet, and it does not send", () => {
  // Someone issued while this dialog was open. The change cannot apply, and the owner has to be
  // told — sending now would issue under numbering they believe they just changed.
  const uit = classifyNumberingSave(409, { ok: false, locked: true, error: "Je nummering staat vast — er is al een factuur verstuurd." });
  assert.deepEqual(uit, { outcome: "locked" });
  assert.equal(saveAllowsSend(uit), false);
  // The route also flags `locked` on some non-409 refusals; that is the same fact.
  assert.deepEqual(classifyNumberingSave(400, { ok: false, locked: true }), { outcome: "locked" });
});

// ── Case 6: an unreadable lock state must never look editable ─────────────────────────────────

test("[NUMMER-EENMALIG] a lock state we cannot trust offers nothing — never an editable form", () => {
  // The GET already fails closed on an unreadable issued-invoice count ([LOCK-READ-HONEST]).
  // This keeps the discipline one step out: anything that is not an explicit boolean `false` with
  // a number beside it is unknown, and unknown offers nothing.
  const onleesbaar: unknown[] = [
    null, undefined, {}, "ok", 42, [],
    { ok: false },
    { ok: true },                                    // no locked field at all
    { ok: true, locked: "false", next: "20260001" }, // a STRING — truthiness would read this as open
    { ok: true, locked: 0, next: "20260001" },       // a number — same trap
    { ok: true, locked: null, next: "20260001" },
    { ok: true, locked: false },                     // open, but no number to name
    { ok: true, locked: false, next: "" },
    { ok: true, locked: false, next: "   " },
    { ok: true, locked: false, next: 20260001 },     // not a string
  ];
  for (const body of onleesbaar) {
    const state = classifyNumberingRead(200, body);
    assert.equal(state.kind, "unknown", `body ${JSON.stringify(body)} was read as ${state.kind}`);
    assert.equal(firstSendNumbering(state), null, `body ${JSON.stringify(body)} produced an offer`);
  }

  // A non-2xx read is unknown too, and offers nothing.
  for (const status of [400, 401, 429, 500, 503, 504]) {
    const state = classifyNumberingRead(status, { ok: true, locked: false, next: "20260001" });
    assert.equal(state.kind, "unknown", `status ${status} was trusted`);
    assert.equal(firstSendNumbering(state), null);
  }
});

// ── Case 7: already locked → nothing actionable ───────────────────────────────────────────────

test("[NUMMER-EENMALIG] a locked series is not offered a change", () => {
  const state = classifyNumberingRead(200, { ...VERS, locked: true, next: "20260007" });
  assert.deepEqual(state, { kind: "locked" });
  assert.equal(firstSendNumbering(state), null, "a fixed series was offered an edit");
});

// ── Case 8: a sales member has no numbering door ──────────────────────────────────────────────

test("[NUMMER-EENMALIG] a sales member is asked nothing, and is not blocked either", () => {
  // [ACTING-FOR] GET /api/invoice/numbering is requireOwner, so a member gets 403. The series is
  // their employer's, their session cannot read it, and a form here would configure the wrong
  // person. Their SEND is untouched — the send route numbers from the owner's counter as always.
  const state = classifyNumberingRead(403, { error: "De factuurnummering wijzigen kan alleen de eigenaar…" });
  assert.deepEqual(state, { kind: "not-owner" });
  assert.equal(firstSendNumbering(state), null, "a member was shown their employer's numbering form");
  // And 403 must not be mistaken for a transport failure that might be retried into an offer.
  assert.notEqual(classifyNumberingRead(403, {}).kind, "open");
  assert.notEqual(classifyNumberingRead(403, { ok: true, locked: false, next: "20260001" }).kind, "open");
});

// ── The owner who already configured it is not nagged ─────────────────────────────────────────

test("[NUMMER-EENMALIG] an owner who already set their numbering keeps the option, loses the lecture", () => {
  const state = classifyNumberingRead(200, { ...VERS, isCustom: true, template: "{seq}-{year}", next: "046-2026" });
  assert.deepEqual(state, { kind: "open", next: "046-2026", isCustom: true });

  const notice = firstSendNumbering(state);
  assert.ok(notice);
  assert.equal(notice.explainOnce, false,
    "an owner who deliberately configured their numbering is warned about it at every send");
  assert.equal(notice.adjustable, true, "…but the option itself must not be taken away from them");
  assert.equal(notice.next, "046-2026");
});

// ── The whole space, in one sweep ──────────────────────────────────────────────────────────────

test("[NUMMER-EENMALIG] exactly one of the four states is offered anything", () => {
  const alle: NumberingState[] = [
    { kind: "unknown" },
    { kind: "not-owner" },
    { kind: "locked" },
    { kind: "open", next: "20260001", isCustom: false },
  ];
  const aangeboden = alle.filter((s) => firstSendNumbering(s) !== null);
  assert.equal(aangeboden.length, 1, "more than one state produced an editable numbering offer");
  assert.equal(aangeboden[0].kind, "open");
});

test("[NUMMER-EENMALIG] exactly one save outcome in the whole space permits a send", () => {
  const alle = [
    classifyNumberingSave(200, { ok: true, next: "046-2026" }),
    classifyNumberingSave(400, { ok: false, error: "Vul een factuurnummer in, bijv. 045-2026." }),
    classifyNumberingSave(409, { ok: false, locked: true }),
    classifyNumberingSave(503, { ok: false, code: "lock_check_unavailable" }),
    classifyNumberingSave(200, null),
  ];
  assert.equal(alle.filter(saveAllowsSend).length, 1);
  assert.equal(alle.filter(saveAllowsSend)[0].outcome, "saved");
});

test("[NUMMER-EENMALIG] this module names no number of its own", () => {
  // It decides what may be SHOWN and OFFERED. Every number it hands back came from the server in
  // the response it was given — it parses nothing, formats nothing and increments nothing. If this
  // ever fails, a number is being invented in the browser.
  const src = readFileSync("src/lib/numbering-first-send.ts", "utf8");
  assert.doesNotMatch(src, /next_invoice_seq|formatInvoiceNumber|padStart|\+\s*1\b/,
    "the module started producing a number instead of relaying one");
  assert.doesNotMatch(src, /fetch\(|supabase/, "the module started doing I/O");
});
