// src/lib/notification-copy.test.ts
// [UPLOAD-TRUTH-1] Run: npx tsx --test src/lib/notification-copy.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationCopy, NOTIFICATION_COPY_PREFIXES } from "./notification-copy";
import { unreadableEventKey, autoFinishedEventKey, duplicateQuestionEventKey } from "./stored-document";
import { MESSAGES } from "./i18n/messages";

test("[UPLOAD-TRUTH-1] an unreadable event resolves BOTH title and body", () => {
  const copy = notificationCopy(unreadableEventKey("doc-1"));
  assert.ok(copy, "the key the writer uses is the key the bell recognises");
  assert.equal(copy.titleKey, "meld.onleesbaar.titel");
  assert.equal(copy.bodyKey, "meld.onleesbaar.tekst");
  // Translating only the title leaves an Arabic heading over a Dutch paragraph — worse than
  // leaving both Dutch, because it looks finished.
  assert.notEqual(copy.titleKey, copy.bodyKey, "two keys, not one used twice");
});

test("[UPLOAD-TRUTH-1] both keys exist in the catalogue and carry the translations", () => {
  for (const key of ["meld.onleesbaar.titel", "meld.onleesbaar.tekst"] as const) {
    const entry = MESSAGES[key];
    assert.ok(entry, `${key} is in the catalogue`);
    assert.ok(entry.nl && entry.nl.trim().length > 0, `${key} has its Dutch source`);
    // The bell is the one surface that speaks without being asked; a gap here is the mixed
    // language this module exists to remove.
    assert.ok(entry.ar && entry.ar.trim().length > 0, `${key} has Arabic`);
    assert.ok(entry.en && entry.en.trim().length > 0, `${key} has English`);
  }
});

test("[UPLOAD-TRUTH-1] the sentence names no file — the link carries the identity", () => {
  // A noun dropped into a translated sentence breaks Arabic agreement and Turkish suffix harmony
  // (AGENTS.md). If a placeholder ever appears here, the copy needs its own key per case instead.
  for (const key of ["meld.onleesbaar.titel", "meld.onleesbaar.tekst"] as const) {
    for (const locale of ["nl", "ar", "en"] as const) {
      const text = MESSAGES[key][locale] ?? "";
      assert.doesNotMatch(text, /\{[^}]+\}/, `${key}.${locale} interpolates nothing`);
      assert.doesNotMatch(text, /\.pdf|\.jpg|\.png/i, `${key}.${locale} names no file`);
    }
  }
});

test("[UPLOAD-TRUTH-1] every other notification keeps the copy it was stored with", () => {
  // The whole safety of adding this to a bell that renders 1.134 existing rows.
  const untouched: unknown[] = [
    null, undefined, "", "   ", 42, {}, [],
    // A notification a person triggered carries no key at all.
    undefined,
    // Its two siblings are machine events too, and are NOT claimed by this map — they store
    // sentences that name a supplier and an invoice number, which no static key can reproduce.
    autoFinishedEventKey("doc-1"),
    duplicateQuestionEventKey("doc-1"),
    // A future or unknown domain.
    "billing:trial-ending:acc-9",
    "intake:something-new:doc-1",
    // The prefix with nothing after it names no document.
    "intake:unreadable:",
  ];
  for (const value of untouched) {
    assert.equal(notificationCopy(value), null, `${JSON.stringify(value)} keeps its stored text`);
  }
});

test("[UPLOAD-TRUTH-1] the recognised prefix is the one the key builder produces", () => {
  // The contradiction this forbids: a map keyed on a prefix the writer never writes. Both sides
  // are derived here rather than typed twice.
  const key = unreadableEventKey("any-id");
  assert.ok(
    NOTIFICATION_COPY_PREFIXES.some((p) => key.startsWith(p)),
    `${key} must be matched by one of ${NOTIFICATION_COPY_PREFIXES.join(", ")}`,
  );
});
