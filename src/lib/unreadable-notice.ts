// src/lib/unreadable-notice.ts
// [UPLOAD-TRUTH-1] What the owner hears when the reader gave up on a file we already promised to keep.
// Pure — no I/O, no clock. Run: npx tsx --test src/lib/unreadable-notice.test.ts
//
// ── THE SILENCE THIS CLOSES ──────────────────────────────────────────────────────────────────
//
//   upload                    → "Ontvangen — je kunt verder."
//   the tab closes
//   the background reader runs → it cannot read the file
//   documents.ai_doc_type     → could_not_read          (terminal; the drain never returns)
//   the owner                 → hears nothing, ever
//
// Measured in production: ten such documents, the oldest from 31 July. Every one of them is safe
// in Bestanden and listed in "Overgeslagen bij import" with a working "Lees opnieuw" button — a
// recovery door nothing points at. The file was never lost; the OUTCOME was.
//
// ── WHY THE SENTENCE NAMES NO FILE ───────────────────────────────────────────────────────────
//
// Three facts and no machinery, the same shape pauseNotice() uses for the fair-use pause: the file
// is safe, we could not read it, and here is where to look. The filename is deliberately absent.
//
//   · The LINK carries the identity. It opens the panel with that exact row landed and its
//     "Lees opnieuw" button in reach, which is more useful than a name in a sentence.
//   · A filename in the sentence is a parameter inside a sentence, and AGENTS.md is explicit that
//     a noun dropped into a translated sentence breaks Arabic agreement and Turkish suffix
//     harmony. This notice is read in four languages.
//   · The stored Dutch and the rendered translation therefore say the SAME thing, which is what
//     lets the bell translate from the event key alone.
//
// ── WHAT IS STORED VERSUS WHAT IS RENDERED ───────────────────────────────────────────────────
//
// The row stores Dutch — the source language (AGENTS.md), the fallback for any screen that cannot
// resolve the key, and the text the push repeats. The in-app bell renders the owner's language
// from the event key (see notification-copy.ts). Push localisation is deliberately NOT here; it
// is UPLOAD-TRUTH-P2, because the push is built server-side at write time from these strings.

import { BESTANDEN_PATH } from "@/lib/bestanden-deeplink";

/** The query parameter Inkomend reads to open its skipped panel on one document. */
export const UNREADABLE_FOCUS_PARAM = "onleesbaar";

/**
 * The DOM id of one unreadable document's row in the skipped panel.
 *
 * Lives here, beside the parameter, because the two are one contract: the notification puts a
 * document id in the URL and the screen has to find that exact row. Written in two places they
 * drift, and the failure is the silent kind — the panel opens, nothing is landed, and the owner is
 * left to read a list looking for a file whose name the notification deliberately does not carry.
 */
export function unreadableRowDomId(documentId: string): string {
  return `onleesbaar-${documentId}`;
}

/** Where the notification sends the owner: the existing recovery door, landed on this document. */
export const INKOMEND_PATH = "/dashboard/incoming";

/**
 * The link for one unreadable document.
 *
 * Inkomend, not Bestanden. Bestanden shows the file; Inkomend shows the file WITH the thing to do
 * about it — the "Lees opnieuw" button that asks the reader we have today to try the bytes we
 * already hold. A notification that ends on a file the owner can only look at is the same silence
 * one step further along.
 */
export function unreadableNoticeLink(documentId: string): string {
  const params = new URLSearchParams();
  params.set(UNREADABLE_FOCUS_PARAM, documentId);
  return `${INKOMEND_PATH}?${params.toString()}`;
}

export interface UnreadableNotice {
  title: string;
  body: string;
  link: string;
}

/**
 * The single notification written when a stored document ends as `could_not_read`.
 *
 * Deliberately not "1 vraag voor jou": nothing is being ASKED. That phrasing belongs to the
 * semantic-duplicate decision, where the app genuinely cannot proceed without a human, and
 * borrowing it here would teach an owner that it sometimes means "have a look when you like".
 * This is a thing to check, not a thing that blocks.
 */
export function unreadableNotice(documentId: string): UnreadableNotice {
  return {
    title: "Een bestand konden we niet lezen",
    body:
      "Je bestand is ontvangen en staat veilig in je bestanden, maar we konden het niet uitlezen. " +
      "Bekijk het even — je kunt het opnieuw laten lezen, of het zelf verwerken.",
    link: unreadableNoticeLink(documentId),
  };
}

/** Kept honest: the link this notice builds is an in-app path, never an absolute URL. */
export const UNREADABLE_NOTICE_PATHS = { INKOMEND_PATH, BESTANDEN_PATH } as const;
