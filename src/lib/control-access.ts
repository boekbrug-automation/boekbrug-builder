// src/lib/control-access.ts
// [CONTROL] Who may see the commercial console. Pure: no I/O, no clock.
// Run: npx tsx --test src/lib/control-access.test.ts
//
// ── WHY AN ALLOWLIST AND NOT A ROLE ─────────────────────────────────────────────────────────
//
// A role lives in `profiles`, and `profiles.role` is chosen by the person signing up — that is
// how the accountant portal works and it is fine there, because the portal grants nothing but
// wider limits. An administrative console is a different kind of door: a role column would make
// "see every account in the product" reachable by writing a word into your own row, and the only
// thing standing between the two would be an UPDATE policy nobody reviews again.
//
// So membership lives OUTSIDE the database, in an environment variable that only the person with
// the Vercel project can set. Nothing in the app can grant it, no migration can widen it, and a
// database compromise does not include it.
//
// ── EMPTY MEANS NOBODY ──────────────────────────────────────────────────────────────────────
//
// Unset variable, empty string, whitespace: nobody gets in, and the screen 404s. The failure
// direction matters — the alternative ("no list configured, so allow everyone") is the classic
// way an internal console ends up open on a Sunday.

/** The ids that may open the console. Empty when the variable is unset — which means nobody. */
export function controlUserIds(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * May this user open the console?
 *
 * A missing user id is never allowed, whatever the list says: `undefined` matching an entry
 * would be the whole door opened by a logged-out request.
 */
export function mayOpenControl(userId: string | null | undefined, raw: string | null | undefined): boolean {
  if (typeof userId !== "string" || userId.trim() === "") return false;
  const ids = controlUserIds(raw);
  if (ids.length === 0) return false;
  return ids.includes(userId.trim());
}
