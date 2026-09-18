// src/lib/ontvangen-flag.ts
// [ONTVANGEN-VLAG] The one switch that decides which road a human document takes.
//
// ── WHY A FLAG AND NOT A DEPLOY ──────────────────────────────────────────────────────────────
//
// Receive-first needs five schema boundaries to be live before it can finish a single document.
// Without a flag, "merge" and "migrate" become one irreversible step, and the only way back from a
// problem is a revert — of code that other work has since been built on.
//
// With it, the two are separate: the code ships dark, the migrations go in underneath it, and the
// road changes when somebody decides it does. Going back is one environment variable, not a git
// operation.
//
// ── IT FAILS TO THE ROAD THAT WORKS TODAY ────────────────────────────────────────────────────
//
// Absent, empty, "false", "0", "yes", "TRUE", a typo, a trailing newline from a paste — every one
// of those is OFF. Only the exact string "true" turns it on.
//
// That strictness is the point. A flag that guesses is a flag that can turn itself on: an
// environment variable set to "1" by someone expecting the usual convention would enable
// receive-first against a database that cannot finish a document, and every photographed invoice
// would be accepted and then silently never read. Refusing to guess costs one confused minute and
// a log line that says exactly what to type.
//
// ── NOT NEXT_PUBLIC_ ─────────────────────────────────────────────────────────────────────────
//
// It decides server behaviour and belongs nowhere near a browser bundle. A client that could read
// it would be a client that could be lied to about which road its upload took.

/** The one accepted value. Anything else is OFF — see the header for why that is not pedantry. */
const ENABLED = "true"

export const RECEIVE_FIRST_FLAG = "ONTVANGEN_RECEIVE_FIRST_ENABLED"

/**
 * May a human PDF/photo take the receive-first road?
 *
 * `env` is a seam for the tests. Production passes nothing and reads process.env.
 */
export function receiveFirstEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[RECEIVE_FIRST_FLAG]
  if (raw === undefined || raw === "") return false
  if (raw === ENABLED) return true
  // Present but not the accepted value. Said out loud, because the alternative is an owner who set
  // the flag, watched nothing change, and had no way to find out why.
  console.error(
    `[ONTVANGEN-VLAG] ${RECEIVE_FIRST_FLAG} is set to something other than "${ENABLED}" — receive-first stays OFF. ` +
      `Set it to exactly "${ENABLED}" to enable it.`,
    { got: raw.length > 20 ? `${raw.slice(0, 20)}…` : raw },
  )
  return false
}
