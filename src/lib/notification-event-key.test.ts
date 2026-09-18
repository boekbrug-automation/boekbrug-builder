// src/lib/notification-event-key.test.ts
// [ONTVANGEN-MELDING] One event, at most one bell — across a crash.
//
// Everything a background pass does to money was made crash-idempotent by the database: the
// invoice by a partial UNIQUE on invoices.document_id, the payment by its replay key, the AI
// allowance by a per-document mark. The notification had nothing, so a run that died after telling
// the owner told them again on the retry.
//
// The branch that decides what an insert error MEANT is a pure function, so it can be proved here
// rather than described. The rest is source-level, in notification-gates.test.ts, because
// createNotification deliberately builds its own service-role client and must keep doing so.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyNotificationInsert } from "./notifications";
import { autoFinishedEventKey } from "./stored-document";

const DOCUMENT = "0cbc765a-7244-4722-bbce-dc8e7ecfaeb3";

test("[ONTVANGEN-MELDING] a clean insert is 'written', with or without a key", () => {
  assert.equal(classifyNotificationInsert(null, true), "written");
  assert.equal(classifyNotificationInsert(null, false), "written");
  assert.equal(classifyNotificationInsert(undefined, true), "written");
});

test("[ONTVANGEN-MELDING] a key that was already used means the owner has already been told", () => {
  assert.equal(classifyNotificationInsert({ code: "23505" }, true), "already_reported");
});

test("[ONTVANGEN-MELDING] a 23505 on a notification that carries NO key is a failure, never a replay", () => {
  // The dangerous shortcut: reading any 23505 as "already reported" would hand a caller ok:true
  // for a row that was never written, the first time any other constraint on this table fires.
  assert.equal(classifyNotificationInsert({ code: "23505" }, false), "failed");
});

test("[ONTVANGEN-MELDING] a caller that asked for the guarantee is told when the column is absent", () => {
  // Not degraded to a plain notification. A row a retry will write again is exactly what the key
  // exists to prevent, and quietly writing one would make the guarantee a comment.
  assert.equal(classifyNotificationInsert({ code: "42703" }, true), "key_column_missing");
  // A caller that never asked has nothing to lose and must not be affected by this column at all.
  assert.equal(classifyNotificationInsert({ code: "42703" }, false), "failed");
});

test("[ONTVANGEN-MELDING] every other error is a failure", () => {
  for (const code of ["42501", "23514", "08006", undefined]) {
    assert.equal(classifyNotificationInsert({ code }, true), "failed", `code ${code}`);
    assert.equal(classifyNotificationInsert({ code }, false), "failed", `code ${code}`);
  }
});

test("[ONTVANGEN-MELDING] the key is derived from the document and nothing else", () => {
  // If it took the clock, the run, or what the reader concluded, a retry would mint a NEW key and
  // the unique index would never fire — the guarantee would be a comment rather than a constraint.
  assert.equal(autoFinishedEventKey(DOCUMENT), `intake:auto-finished:${DOCUMENT}`);
  assert.equal(autoFinishedEventKey(DOCUMENT), autoFinishedEventKey(DOCUMENT));
  assert.notEqual(autoFinishedEventKey(DOCUMENT), autoFinishedEventKey("andere-id"));
  // Namespaced, so a second event on the same document can get its own key without colliding.
  assert.ok(autoFinishedEventKey(DOCUMENT).startsWith("intake:"));
});
