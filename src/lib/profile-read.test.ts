// [PROFILE-READ] Pure node test — run: npx tsx --test src/lib/profile-read.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyProfileRead, NO_ROWS_CODE } from "./profile-read";

const row = { id: "u-1", onboarding_done: true };

test("a row is a row, exactly as stored", () => {
  assert.deepEqual(classifyProfileRead({ data: row, error: null }), { kind: "row", row });
});

test("no row and no error is 'missing' — the one case in which creating a profile is right", () => {
  assert.deepEqual(classifyProfileRead({ data: null, error: null }), { kind: "missing" });
  assert.deepEqual(classifyProfileRead({ data: undefined, error: undefined }), { kind: "missing" });
});

test("PGRST116 from .single() is the same 'missing', not a failure", () => {
  assert.deepEqual(
    classifyProfileRead({ data: null, error: { code: NO_ROWS_CODE, message: "JSON object requested, multiple (or no) rows returned" } }),
    { kind: "missing" },
  );
});

test("[NO-SILENT-EMPTY] every other error is 'failed' — never 'missing', never a row", () => {
  for (const error of [
    { code: "42501", message: "permission denied for table profiles" },
    { code: "PGRST301", message: "JWT expired" },
    { code: null, message: "TypeError: fetch failed" },
    { message: "upstream connect error" },
    {},
  ]) {
    const read = classifyProfileRead({ data: null, error });
    assert.equal(read.kind, "failed", `${JSON.stringify(error)} must be a failure`);
    if (read.kind === "failed") {
      assert.equal(read.code, error.code ?? null);
      assert.equal(read.message, error.message ?? "unknown error");
    }
  }
});

test("an error beside a row is judged as the error — a row nobody verified is not trusted", () => {
  assert.equal(classifyProfileRead({ data: row, error: { code: "42501", message: "denied" } }).kind, "failed");
});
