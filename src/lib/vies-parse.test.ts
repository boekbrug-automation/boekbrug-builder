// src/lib/vies-parse.test.ts
// [EU-BTW] Run: npx tsx --test src/lib/vies-parse.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { parseViesAnswer } from "./vies-parse";

const BE = "BE0123456749";
const ok = (over: Record<string, unknown> = {}) => ({
  countryCode: "BE", vatNumber: "0123456749", requestDate: "2026-09-12+02:00",
  valid: true, name: "ABC BVBA", address: "Kerkstraat 1\n1000 Brussel", ...over,
});

test("[EU-BTW] a valid answer becomes a company", () => {
  const r = parseViesAnswer(ok(), BE);
  assert.strictEqual(r.reading, "valid");
  if (r.reading !== "valid") return;
  assert.strictEqual(r.company.vatNumber, "BE0123456749");
  assert.strictEqual(r.company.name, "ABC BVBA");
  assert.match(r.company.address, /Kerkstraat 1/);
});

test("[EU-BTW] a member state that does not disclose the name is still a valid answer", () => {
  // Several countries return "---" by law. Printing three hyphens where a company name belongs
  // is worse than printing nothing.
  const r = parseViesAnswer(ok({ name: "---", address: "---" }), BE);
  assert.strictEqual(r.reading, "valid");
  if (r.reading !== "valid") return;
  assert.strictEqual(r.company.name, "");
  assert.strictEqual(r.company.address, "");
});

test("[EU-BTW] valid:false is a refusal, and nothing else is", () => {
  assert.strictEqual(parseViesAnswer(ok({ valid: false }), BE).reading, "invalid");
});

test("[EU-BTW] VIES reporting its own trouble is never 'your number is wrong'", () => {
  // The service fans out to 27 national registers and documents member-state unavailability as
  // normal — with HTTP 200 and the trouble in a field. Reading that as invalid would tell an
  // owner his customer's number is wrong because a foreign system had maintenance.
  for (const err of ["MS_UNAVAILABLE", "TIMEOUT", "SERVICE_UNAVAILABLE", "MS_MAX_CONCURRENT_REQ", "GLOBAL_MAX_CONCURRENT_REQ"]) {
    const r = parseViesAnswer(ok({ userError: err }), BE);
    assert.strictEqual(r.reading, "unusable", `${err} was not read as "could not ask"`);
  }
  const invalidInput = parseViesAnswer(ok({ userError: "INVALID_INPUT" }), BE);
  assert.strictEqual(invalidInput.reading, "unusable");
  if (invalidInput.reading === "unusable") assert.match(invalidInput.why, /niet in behandeling/);
});

test("[EU-BTW] an answer about a DIFFERENT number is not an answer about this one", () => {
  const r = parseViesAnswer(ok({ vatNumber: "0999999999" }), BE);
  assert.strictEqual(r.reading, "unusable");
  if (r.reading === "unusable") assert.match(r.why, /ander nummer/);
});

test("[EU-BTW] garbage in is unusable out, never valid and never invalid", () => {
  for (const rommel of [null, undefined, 42, "valid", [], {}, { valid: "true" }, { valid: 1 }]) {
    const r = parseViesAnswer(rommel, BE);
    assert.strictEqual(r.reading, "unusable", JSON.stringify(rommel));
  }
});

test("[EU-BTW] a number we could not even shape is unusable, not valid", () => {
  assert.strictEqual(parseViesAnswer(ok(), "onzin").reading, "unusable");
});
