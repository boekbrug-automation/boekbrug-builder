// src/lib/unreadable-notice.test.ts
// [UPLOAD-TRUTH-1] Run: npx tsx --test src/lib/unreadable-notice.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unreadableNotice, unreadableNoticeLink, UNREADABLE_FOCUS_PARAM, INKOMEND_PATH,
} from "./unreadable-notice";
import { safeNotificationLink } from "./notification-link";

test("[UPLOAD-TRUTH-1] the notice points at the recovery door, landed on the document", () => {
  const notice = unreadableNotice("a4f2c95e-31ed-4523-a9fa-6ff9f131af8f");
  const [path, query] = notice.link.split("?");
  assert.equal(path, INKOMEND_PATH, "Inkomend, where the 'Lees opnieuw' button is");
  assert.equal(
    new URLSearchParams(query).get(UNREADABLE_FOCUS_PARAM),
    "a4f2c95e-31ed-4523-a9fa-6ff9f131af8f",
    "…on the exact document, not on the panel in general",
  );
});

test("[UPLOAD-TRUTH-1] the link survives the check every stored notification link passes", () => {
  // createNotification runs safeNotificationLink on the way in and DROPS a link it refuses —
  // silently turning this notification into a dead tap. Proven here rather than discovered there.
  const link = unreadableNoticeLink("doc-1");
  assert.equal(safeNotificationLink(link), link, "an in-app path, kept intact");
});

test("[UPLOAD-TRUTH-1] an id that would break the URL is encoded, not pasted", () => {
  const link = unreadableNoticeLink("a&b=c");
  assert.equal(new URLSearchParams(link.split("?")[1]).get(UNREADABLE_FOCUS_PARAM), "a&b=c");
  assert.equal(safeNotificationLink(link), link);
});

test("[UPLOAD-TRUTH-1] the stored sentence says the three facts and names no file", () => {
  const notice = unreadableNotice("doc-1");
  assert.ok(notice.title.trim().length > 0 && notice.body.trim().length > 0);
  // The filename belongs to the link and to the panel the link opens — not to a sentence that is
  // rendered in four languages. See notification-copy.ts.
  assert.doesNotMatch(notice.body, /\{[^}]+\}/, "no interpolation");
  assert.doesNotMatch(notice.body + notice.title, /doc-1/, "the id never leaks into the words");
  // "safe" and "could not read" are the two facts that must both be there: either alone is a
  // different, wrong message.
  assert.match(notice.body, /veilig/, "says the file is safe");
  assert.match(notice.body, /niet (kunnen )?uitlezen|niet uitlezen|niet lezen/, "says we could not read it");
});

test("[UPLOAD-TRUTH-1] the notice is not borrowed from the question wording", () => {
  // "1 vraag voor jou" is reserved for the semantic-duplicate decision, where the app genuinely
  // cannot proceed without a human. Reusing it here teaches an owner that it sometimes means
  // "whenever you like", and the next time it really is a decision they leave it.
  const notice = unreadableNotice("doc-1");
  assert.doesNotMatch(notice.title + notice.body, /vraag voor jou/i);
});
