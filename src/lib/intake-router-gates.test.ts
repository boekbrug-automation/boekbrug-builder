// [BON-BETAALWIJZE] Pure node test — run: npx tsx --test src/lib/intake-router-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// gokBetaalwijze reads what a till PRINTS — "Bankpas", "Kontant", "Wisselgeld", "Afronding" — and
// that reading outranks the model's opinion, because the paper is evidence and the opinion is an
// interpretation. It is a pure module with its own tests, all green, all meaningless: the intake
// route built its decideFromAi() argument by hand and left `paid_evidence` and `paid_card_last4`
// out of it. One call site, two absent lines, and gokBetaalwijze received `undefined` on every
// upload this app has ever processed.
//
// Nothing failed. The types were satisfied — every field on IntakeClassification is optional, and
// they have to be: the pen-mark path genuinely has no tender line. tsc cannot tell a field that is
// absent because it does not apply from one that is absent because someone forgot it. The unit
// tests passed because they call decideFromAi directly with a full object, which is exactly the
// object the route was not building. The feature was built, tested, shipped and switched off.
//
// THE CLASS, NOT THE INSTANCE
//
// The instance is fixed. What is not fixed by that is the next field: someone extends the reader,
// adds it to IntakeClassification, tests the router with it, and forgets the route again — and the
// silence will be just as complete. So this gate reads the SOURCE and asserts the bridge is whole:
// every field the router can act on is handed to it at the call site.
//
// It deliberately does not check HOW (`v.paid_evidence ?? null`, a variable, a spread — all fine).
// It checks that the name appears inside the decideFromAi(...) argument at all, which is precisely
// the thing that was missing and precisely the thing a reviewer's eye slides over.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join as joinPath } from "node:path";

const ROUTER = readFileSync("src/lib/intake-router.ts", "utf8");
// [ONTVANGEN] The intake DOOR is two files since #129: the route keeps the guards and the
// deterministic branches, intake-processor.ts holds everything that needs the reader. Reading
// both is reading the door — which is what this test was always asking about.
const ROUTE = readFileSync("src/app/api/intake/route.ts", "utf8") + "\n" + readFileSync("src/lib/intake-processor.ts", "utf8");

/** The fields declared on IntakeClassification — the router's whole input surface. */
function declaredFields(): string[] {
  const block = /export interface IntakeClassification \{([\s\S]*?)\n\}/.exec(ROUTER);
  assert.ok(block, "IntakeClassification must be findable — this gate is worthless if it is not");
  return [...block[1].matchAll(/^\s{2}([a-z0-9_]+)\??:/gm)].map((m) => m[1]);
}

/** The object literal the route passes to decideFromAi, as source text. */
function callArgument(): string {
  const call = /decideFromAi\(\{([\s\S]*?)\n\s*\}\)/.exec(ROUTE);
  assert.ok(call, "the intake route must call decideFromAi with an object literal");
  return call[1];
}

test("[BON-BETAALWIJZE] every field the router reads is actually handed to it", () => {
  const fields = declaredFields();
  // A sanity floor: if the interface parse silently returned nothing, an empty loop below would
  // pass while proving the opposite of what it claims. Same reason invoice-scan carries `scanned`.
  assert.ok(fields.length >= 8, `parsed ${fields.length} fields — the interface parse broke`);
  assert.ok(fields.includes("paid_evidence"), "the field that was dropped must be among them");

  const arg = callArgument();
  const missing = fields.filter((f) => !new RegExp(`(^|[^a-z0-9_])${f}\\s*:`).test(arg));
  assert.deepEqual(
    missing, [],
    `intake/route.ts calls decideFromAi without: ${missing.join(", ")}. ` +
      `The router cannot act on what it is not given, and it will not complain — ` +
      `every field on IntakeClassification is optional.`,
  );
});

test("[BON-BETAALWIJZE] the tender line is read from the paper, not re-derived here", () => {
  // The one shape that would defeat the gate above while looking like it passes: handing the field
  // a literal null at the call site. It satisfies the name check and delivers nothing, which is the
  // bug back again wearing the fix's clothes.
  const arg = callArgument();
  for (const f of ["paid_evidence", "paid_card_last4"]) {
    assert.doesNotMatch(
      arg, new RegExp(`${f}\\s*:\\s*null\\s*[,}]`),
      `${f} is passed as a literal null — that is the same silence, spelled differently`,
    );
  }
});

// ─── [MARKER-READ] A marker nobody reads is a feature that does not exist ─────
//
// bon-betaalwijze.ts reads the tender line a till PRINTS — "Bankpas 70,29", "KONTANT 120,00
// Wisselgeld 7,10" — and both intake doors stored the result in field_confidence as
// _intake_paid_method / _intake_paid_method_zeker / _intake_paid_evidence / _intake_paid_card4 /
// _intake_paid_date. Nothing anywhere read any of them back. The file's own header said so in
// passing — "een jsonb die geen enkele voorwaarde in de app leest" — and it stayed true.
//
// So the app read the answer off the paper, parsed it with a tested module, wrote it to the row,
// and then showed the owner two identical green buttons asking Bank or Contant. Every bon. The
// work was all there; the last wire was missing, and no gate could see it, because a write with no
// reader breaks nothing, types fine and passes every test.
//
// This is the same shape as the dropped decideFromAi fields above, one step further down the pipe:
// there a field was written and never PASSED, here it is passed and never READ. So it gets the
// same answer — a gate on the wiring itself.

const WRITERS = ["src/app/api/intake/route.ts", "src/lib/email-integration.ts"];

/** Source with comments removed, so a marker merely NAMED in prose never counts as a reader. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function tsxAndTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = joinPath(dir, entry);
    if (statSync(p).isDirectory()) tsxAndTs(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

test("[MARKER-READ] every _intake_ marker the doors write is read by something", () => {
  const written = new Set<string>();
  for (const w of WRITERS) {
    const src = code(w);
    for (const m of src.matchAll(/[.\[]"?(_intake_[a-z0-9_]+)"?\]?\s*=/g)) written.add(m[1]);
    for (const m of src.matchAll(/\b(_intake_[a-z0-9_]+)\s*:/g)) written.add(m[1]);
  }
  // The floor. An empty set would make the loop below pass while proving nothing.
  assert.ok(written.size >= 5, `found ${written.size} written markers — the scan broke`);

  const readers = tsxAndTs("src").filter((f) => !WRITERS.includes(f));
  const corpus = readers.map(code).join("\n");

  // Whole-key match, not a substring: `_intake_paid_method` occurs inside
  // `_intake_paid_method_zeker`, so `includes` would call the shorter one "read" on the strength of
  // the longer one appearing somewhere. That is the gate lying in exactly the direction it exists
  // to prevent, and it is why this is a regexp with a trailing boundary.
  const dead = [...written]
    .filter((k) => !new RegExp(`${k}(?![A-Za-z0-9_])`).test(corpus))
    .sort();
  assert.deepEqual(
    dead, [],
    `these markers are written and read by nothing: ${dead.join(", ")}.\n` +
      `A jsonb key with no reader is not a feature — it is the appearance of one. Either wire it ` +
      `into the screen or the gate that should act on it, or stop writing it.`,
  );
});
