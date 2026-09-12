// src/lib/control-access.test.ts
// [CONTROL] Run: npx tsx --test src/lib/control-access.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { controlUserIds, mayOpenControl } from "./control-access";

const A = "ac22189e-7052-4c48-b4ec-90947cf92ecc";
const B = "46a6a3f1-3760-4f8e-a061-888ffd13a181";

test("[CONTROL] the list is read the way a person types it", () => {
  assert.deepStrictEqual(controlUserIds(`${A},${B}`), [A, B]);
  assert.deepStrictEqual(controlUserIds(` ${A} , ${B} `), [A, B]);
  assert.deepStrictEqual(controlUserIds(`${A}\n${B}`), [A, B]);
});

test("[CONTROL] unset means NOBODY, in every shape it can be unset", () => {
  // The failure direction that matters: "no list configured, so allow everyone" is how an
  // internal console ends up open on a Sunday.
  for (const leeg of [undefined, null, "", "   ", ",", " , , "]) {
    assert.deepStrictEqual(controlUserIds(leeg as string), [], JSON.stringify(leeg));
    assert.strictEqual(mayOpenControl(A, leeg as string), false, JSON.stringify(leeg));
  }
});

test("[CONTROL] only a listed id gets in", () => {
  assert.ok(mayOpenControl(A, `${A},${B}`));
  assert.ok(mayOpenControl(B, `${A},${B}`));
  assert.ok(!mayOpenControl("someone-else", `${A},${B}`));
});

test("[CONTROL] a missing user is never allowed, whatever the list says", () => {
  // `undefined` matching an entry would be the door opened by a logged-out request.
  for (const geen of [undefined, null, "", "   "]) {
    assert.strictEqual(mayOpenControl(geen as string, `${A},`), false, JSON.stringify(geen));
  }
});
