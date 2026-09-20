// src/lib/notification-read.ts
// [MELDING-WAARHEID] The bell's local view of "read", and how it is taken back — pure, no I/O.
// Run: npx tsx --test src/lib/notification-read.test.ts
//
// The bell keeps an OVERRIDE beside the rows: a map of ids the owner has just marked read, so the
// badge and the highlight answer the tap at once instead of after a round-trip. That is right. What
// was wrong is that the override was never taken back. "Alles gelezen" wrote it before the store
// was asked, and a failed UPDATE left the bell cleared while the rows were still unread — the same
// notifications came back on the next visit, with nothing explaining why. The single-row tap did
// the same and never read the PATCH's answer at all.
//
// Optimistic with an explicit ROLLBACK, then: mark locally, ask the store, and on anything but a
// confirmed success remove exactly the ids that were marked — not older marks the store did accept —
// so the screen shows the row truth again, and says out loud that nothing was saved.

export type ReadOverride = Record<string, boolean>

/** The part of a notification row this decision needs. */
export interface ReadableRow {
  id: string
  read: boolean | null
}

/** Mark these ids read locally, on top of whatever the rows say. */
export function markedRead(override: ReadOverride, ids: readonly string[]): ReadOverride {
  if (ids.length === 0) return override
  const next = { ...override }
  for (const id of ids) next[id] = true
  return next
}

/** Take the local mark back for these ids: the rows speak for themselves again. */
export function rolledBack(override: ReadOverride, ids: readonly string[]): ReadOverride {
  if (ids.length === 0) return override
  const next = { ...override }
  for (const id of ids) delete next[id]
  return next
}

/** Is this row unread, as the screen should show it right now? A row with no answer counts as unread. */
export function isUnread(row: ReadableRow, override: ReadOverride): boolean {
  return !(override[row.id] ?? row.read)
}

/** The ids that would flip if "Alles gelezen" were pressed now — and their number is the badge. */
export function unreadIds(rows: readonly ReadableRow[], override: ReadOverride): string[] {
  return rows.filter((r) => isUnread(r, override)).map((r) => r.id)
}
