// src/lib/bestanden-deeplink.ts
// [BESTANDEN-WIJS] The link that says WHERE a file went. Pure — no I/O, no React.
//
// ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ──
//
// /dashboard/bestanden has read `?folder=` and `?focus=` for a while: it opens that folder, scrolls
// to the file and highlights it. /api/intake sends the target for exactly that purpose, and says so
// in its own comment:
//
//     // [INTAKE-FEEDBACK] structured target so the client can deep-link + focus
//     existing: { id, folder_id, folder_name }
//
// Both halves existed. Nothing joined them. The upload screen's "Bekijk bestand →" opened a
// `blob:` URL of the file the owner had just picked from their own disk — useful for checking the
// page, useless for the question they actually ask after an upload: *where did it go?* The screen
// printed the answer as plain text ("Dit bestand staat al in: 2026 / Q2 / april / Facturen") and
// left them to walk the folder tree by hand.
//
// This module is the join, and it is a separate file for one reason: the RULE about when a link may
// be offered is worth a test, and a rule written inline in JSX is a rule nobody tests.
//
// ── THE RULE ──
//
// A link is offered only when there is a real place to go. Without a document id there is nothing
// to focus, and a link to a folder-that-might-be-null lands the owner on the root of their file
// tree with no idea which of two hundred files was meant — worse than the sentence it replaced,
// because it looks like it worked.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). This module builds a URL; the
// words on the link live in messages.ts.

/** Where /api/intake says a file ended up. Either shape the route returns maps onto this. */
export interface FileTarget {
  /** documents.id — what gets focused and highlighted. */
  documentId: string;
  /** documents.folder_id — the folder to open. Null means the root. */
  folderId: string | null;
}

export const BESTANDEN_PATH = "/dashboard/bestanden";

/**
 * The deep link to a file in Bestanden, or null when there is nowhere useful to send the owner.
 *
 * Null on a missing or blank document id — see the rule in the header. A folder of null is fine and
 * is NOT the same case: a file legitimately lives in the root, and `focus` still finds it there.
 */
export function bestandenDeepLink(target: FileTarget | null | undefined): string | null {
  const id = typeof target?.documentId === "string" ? target.documentId.trim() : "";
  if (!id) return null;
  const params = new URLSearchParams();
  // `folder` first so the URL reads the way the screen acts: open the folder, then focus the file.
  if (target?.folderId) params.set("folder", target.folderId);
  params.set("focus", id);
  return `${BESTANDEN_PATH}?${params.toString()}`;
}

/**
 * Read the target out of an /api/intake response, whichever branch answered.
 *
 * The route has THREE shapes and they are not interchangeable:
 *   · a stored document   → `{ document_id, folder_id }` at the top level
 *   · a received handoff  → `{ received: true, documentId }` — camelCase, and no folder at all
 *   · a refused duplicate → `{ existing: { id, folder_id } }`, because the file that matters is the
 *     one ALREADY there, not the one just refused
 *
 * Reading all three here rather than at three call sites is what keeps the next one from being
 * forgotten — which is how the duplicate row came to print its folder path as dead text while the
 * response beside it carried the id all along.
 *
 * ── THE CAMELCASE ONE, AND WHY IT IS NOT A SPECIAL CASE IN THE SCREEN ──
 *
 * Receive-first answers `documentId`, not `document_id`. Every other branch of /api/intake speaks
 * snake_case, so this reader recognised none of it and returned null: the received row offered no
 * link at all, silently, on the ONE row where the link matters most — there is no invoice to go to
 * yet, so the stored file is the only thing the owner can follow. It failed as "no link rendered",
 * which looks like a deliberate design and not like a bug, and that is why it survived a full
 * gate run.
 *
 * The fix belongs HERE and not in the upload screen. A screen that patches a response shape is a
 * screen that disagrees with the next screen reading the same response.
 */
export function targetFromIntake(data: unknown): FileTarget | null {
  const d = (data ?? {}) as Record<string, unknown>;

  // snake_case first: it is what every pre-existing branch answers, so the established shape keeps
  // winning on a response that somehow carried both.
  const topId = typeof d.document_id === "string" ? d.document_id : "";
  if (topId) {
    return { documentId: topId, folderId: typeof d.folder_id === "string" ? d.folder_id : null };
  }

  // [ONTVANGEN-WAAR] The receive-first shape. `folderId` is read for symmetry, not because the
  // route sends it — a received file sits where RECEIVE put it and is filed by the reader later,
  // so null here is the honest answer and `focus` finds the file regardless of folder.
  const receivedId = typeof d.documentId === "string" ? d.documentId : "";
  if (receivedId) {
    return { documentId: receivedId, folderId: typeof d.folderId === "string" ? d.folderId : null };
  }

  const existing = (d.existing ?? null) as Record<string, unknown> | null;
  const dupId = typeof existing?.id === "string" ? existing.id : "";
  if (dupId) {
    return { documentId: dupId, folderId: typeof existing?.folder_id === "string" ? existing.folder_id : null };
  }

  return null;
}
