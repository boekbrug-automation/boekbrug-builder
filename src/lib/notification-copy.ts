// src/lib/notification-copy.ts
// [UPLOAD-TRUTH-1] A stored notification, in the language of the person reading it. Pure.
// Run: npx tsx --test src/lib/notification-copy.test.ts
//
// ── THE PROBLEM, AND WHY IT IS NOT SOLVED IN THE WRITER ──────────────────────────────────────
//
// A notification row is written by a BACKGROUND pass. There is no request, no session and no
// screen at that moment — the tab is closed, which is the entire point of receive-first. So the
// writer cannot know which language to write in, and every one of the ~40 existing call sites
// stores Dutch.
//
// That was invisible while the app was Dutch. It is not invisible now: an owner reading Arabic
// opens the bell and finds a Dutch sentence under an Arabic heading — the half-translated state
// AGENTS.md exists to forbid, arriving through the one surface that speaks without being asked.
//
// ── WHAT MAKES THE TRANSLATION POSSIBLE WITHOUT A SCHEMA CHANGE ──────────────────────────────
//
// `notifications.event_key` already exists and is already written for exactly the notifications
// this module cares about — the ones a machine raised. Its shape is `<domain>:<event>:<id>`, so
// the EVENT is recoverable from the row without storing anything new. The id on the end is the
// document; it plays no part in the wording, because the wording names no document.
//
// ── THE RULE: RECOGNISED KEYS TRANSLATE, EVERYTHING ELSE KEEPS ITS STORED TEXT ───────────────
//
// `null` is the normal answer. A notification a human triggered carries no event key at all, and
// a historical row carries one this map has never heard of. Both keep exactly the strings they
// were written with, which is what makes this safe to add to a bell rendering 1.134 existing rows.
//
// Title AND body travel together, on purpose. Translating only the title produces an Arabic
// heading over a Dutch paragraph, which is worse than leaving both in Dutch: it looks finished.

import type { MessageKey } from "@/lib/i18n/messages";

/** Both halves of one notification, as catalogue keys. Never one without the other. */
export interface NotificationCopy {
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

/**
 * The event prefixes this module can speak for, mapped to their copy.
 *
 * Matched on the PREFIX, because the key ends in a document id that varies per row. Written as
 * data rather than as an if-chain so the gate can assert the set, and so adding the next machine
 * notification is one entry and not a new branch.
 */
const COPY_BY_EVENT_PREFIX: ReadonlyArray<readonly [prefix: string, copy: NotificationCopy]> = [
  // [UPLOAD-TRUTH-1] see unreadable-notice.ts for the sentence and why it names no file.
  ["intake:unreadable:", { titleKey: "meld.onleesbaar.titel", bodyKey: "meld.onleesbaar.tekst" }],
];

/**
 * The presentation copy for a stored notification, or null to keep what the row holds.
 *
 * Takes the raw `event_key` value off the row, including the nulls and non-strings a row can
 * legitimately carry: this is called for every line in the bell, and a notification a person
 * triggered has no key at all.
 */
export function notificationCopy(eventKey: unknown): NotificationCopy | null {
  if (typeof eventKey !== "string") return null;
  const key = eventKey.trim();
  if (!key) return null;
  for (const [prefix, copy] of COPY_BY_EVENT_PREFIX) {
    // The id after the prefix must be non-empty: `intake:unreadable:` on its own names no
    // document, so it is not the event this copy describes and the stored text is the honest
    // fallback.
    if (key.startsWith(prefix) && key.length > prefix.length) return copy;
  }
  return null;
}

/** The prefixes, for the gate that keeps this map and the event-key builders in step. */
export const NOTIFICATION_COPY_PREFIXES: readonly string[] =
  COPY_BY_EVENT_PREFIX.map(([prefix]) => prefix);
