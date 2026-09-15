// src/lib/verification.test.ts
// [DERDE-BRON] Run: npx tsx --test src/lib/verification.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { confirmed, isConfirmed, mayOverwriteInput, refused, unknown, verificationLabel } from "./verification";

const NU = "2026-09-12T12:00:00.000Z";

test("[DERDE-BRON] the three answers stay three", () => {
  assert.strictEqual(confirmed("VIES", { naam: "X" }, NU).outcome, "confirmed");
  assert.strictEqual(refused("VIES", "onbekend nummer", NU).outcome, "refused");
  assert.strictEqual(unknown("VIES", "niet bereikbaar").outcome, "unknown");
});

test("[DERDE-BRON] only a real yes counts as a yes", () => {
  assert.ok(isConfirmed(confirmed("PDOK", { straat: "X" }, NU)));
  // The two collapses this type exists to prevent, asserted rather than described.
  assert.ok(!isConfirmed(unknown("PDOK", "time-out")), "an unreachable register was read as a yes");
  assert.ok(!isConfirmed(refused("PDOK", "bestaat niet", NU)));
  assert.ok(!isConfirmed(null));
  assert.ok(!isConfirmed(undefined));
});

test("[DERDE-BRON] nothing but a confirmation may overwrite what the owner typed", () => {
  assert.ok(mayOverwriteInput(confirmed("PDOK", { straat: "Tilburgseweg" }, NU)));
  assert.ok(!mayOverwriteInput(unknown("PDOK", "time-out")),
    "a failed lookup would replace an address the owner is held to");
  assert.ok(!mayOverwriteInput(refused("PDOK", "bestaat niet", NU)));
});

test("[DERDE-BRON] an unknown carries no timestamp, and a confirmation carries no excuse", () => {
  // Nothing was established, so stamping a time would make an unanswered question look answered
  // in any list sorted by "last checked".
  assert.strictEqual(unknown("KvK", "geen sleutel").checkedAt, null);
  assert.strictEqual(unknown("KvK", "geen sleutel").data, null);
  const ok = confirmed("KvK", { kvk: "12345678" }, NU);
  assert.strictEqual(ok.reason, null);
  assert.strictEqual(ok.checkedAt, NU);
});

test("[DERDE-BRON] the label says which register, and never ticks for a failure", () => {
  assert.match(verificationLabel(confirmed("VIES", {}, NU)), /Gecontroleerd bij VIES/);
  assert.match(verificationLabel(unknown("VIES", "VIES was traag")), /Niet gecontroleerd/);
  assert.match(verificationLabel(unknown("VIES", "VIES was traag")), /VIES was traag/);
  assert.match(verificationLabel(refused("VIES", "VIES kent dit nummer niet", NU)), /kent dit nummer niet/);
  assert.strictEqual(verificationLabel(null), "Nog niet gecontroleerd");
  // The failure label may never read like a pass.
  assert.doesNotMatch(verificationLabel(unknown("VIES", "x")), /^Gecontroleerd/);
});
