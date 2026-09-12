// src/lib/mail-throttle.ts
// [THROTTLE] One polite wait-and-retry for BOTH mailbox providers. Pure decision + one wrapper.
// Run: npx tsx --test src/lib/mail-throttle.test.ts
//
// ── WHY THIS IS SHARED AND NOT TWO HELPERS ──
// Microsoft Graph got a retry because production demanded one: it throttles per mailbox
// (MailboxConcurrency ≈ 4, plus rate windows) and answered 429 with a Retry-After at pagination
// page 6. Gmail never got one, and the asymmetry is not a judgement about Gmail — nobody made a
// decision, the second provider was simply written later.
//
// What that costs is not a lost invoice. Both Gmail failure paths are already correct: a message
// that could not be read returns ok:false, the fetch is marked incomplete, and the WATERMARK HOLDS,
// so the next run re-reads that mail. Nothing is dropped.
//
// What it costs is FORWARD PROGRESS, and in a shape that can stick. Gmail fetches ten messages
// concurrently (messages.get, 5 quota units each, against a 250-unit per-user-second budget). One
// 429 anywhere in one chunk sets attachmentsOk = false for the whole run. The watermark then holds,
// the next cron starts from the same watermark, and issues the same burst against the same budget —
// so a throttle that is transient by nature can repeat deterministically. The import goes quiet and
// nothing says why, which is precisely the failure the attachment-bytes path warns about in its own
// comment while classifying 429 as transient.
//
// One shared helper rather than a second copy, for the reason this codebase gives about placementOf
// and groundingOf: two implementations of one rule are two chances for the copy nobody is reading to
// drift away from the one that decides.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──
// · It does not retry more than once. A second wait doubles the worst case against the route's
//   300-second ceiling, and the caller already has a correct answer for "still throttled": mark the
//   fetch incomplete and let the watermark hold it for the next run.
// · It does not retry a 4xx that is not 429. A 403 from Gmail is usually insufficient permission and
//   a 404 is a message that is gone; both fail identically forever, and retrying them spends the
//   budget to arrive at the same place.
// · It does not touch the token exchange. A refusal there is an answer about the grant, not weather.

/** The longest we will wait on one call. A minute of held connection is worse than a next run. */
export const THROTTLE_MAX_WAIT_MS = 15_000;

/** What to wait when the provider throttles us without saying for how long. Gmail rarely says. */
export const THROTTLE_DEFAULT_WAIT_MS = 4_000;

/**
 * [THROTTLE-BUDGET] The most one sync run may spend waiting, across every call it makes.
 *
 * Without this the retry would be a REGRESSION in the one case it is meant for. Sustained
 * throttling is not one 429; the Gmail path lists up to 4000 messages and fetches them ten at a
 * time, so it runs ~400 sequential chunks, and the list loop itself is up to 40 sequential pages.
 * At fifteen seconds each that is hours of waiting inside a route whose ceiling is 300 seconds —
 * so the run would be killed mid-flight having done less work than the version with no retry at
 * all, which at least failed fast.
 *
 * Sixty seconds is a fifth of the route's budget: enough to absorb the handful of throttles a busy
 * mailbox actually produces, and far too little to turn a bad afternoon at the provider into a run
 * that does nothing but sleep.
 */
export const THROTTLE_RUN_BUDGET_MS = 60_000;

/**
 * What is left of that budget. Module-level, and deliberately so — see beginThrottleBudget.
 *
 * Starting at zero matters: a module that has never been told a run began grants no waits at all,
 * which is exactly the behaviour that existed before this file. Nothing can be made WORSE by
 * forgetting to call the reset.
 */
let remainingWaitMs = 0;

/**
 * Open a fresh wait budget for one sync run. Called once, at the top of syncUserEmails.
 *
 * Module-level state in a serverless function is normally a mistake, because instances are reused
 * and a leftover value becomes a ghost in the next invocation. It is safe here for one reason,
 * and only that reason: this counter can only ever GRANT A WAIT OR NOT. A stale small value skips
 * a retry, which is precisely the pre-existing behaviour; a stale large value cannot exist, because
 * the counter only decreases between resets. The failure mode is "no retry", never "wrong data".
 */
export function beginThrottleBudget(totalMs: number = THROTTLE_RUN_BUDGET_MS): void {
  remainingWaitMs = Math.max(0, totalMs);
}

/** What the current run has left. Exported for the test — nothing in src reads it. */
export function throttleBudgetLeft(): number {
  return remainingWaitMs;
}

/**
 * Should this response be retried once, and after how long?
 *
 * `null` means no — the caller keeps the response it has. A number is the wait in milliseconds.
 *
 * Retried: 429 (both providers' throttle) and 5xx (the provider is unwell, not us). That is the same
 * pair the Gmail attachment-bytes path already calls `transient`, and using a different pair here
 * would mean one door treating a status as weather while the other calls it permanent.
 */
export function throttleWait(status: number, retryAfterHeader: string | null | undefined): number | null {
  if (status !== 429 && status < 500) return null;
  const ms = parseRetryAfter(retryAfterHeader);
  if (ms === null) return THROTTLE_DEFAULT_WAIT_MS;
  // A zero or negative value is the provider saying "now"; waiting nothing at all would re-send
  // into the same closed window, so the floor is the default rather than 0.
  if (ms <= 0) return THROTTLE_DEFAULT_WAIT_MS;
  return Math.min(ms, THROTTLE_MAX_WAIT_MS);
}

/**
 * RFC 7231 Retry-After: either delta-seconds or an HTTP-date. Graph sends seconds; the date form is
 * legal and costs three lines to honour, and getting it wrong means waiting the default when the
 * server told us exactly when to come back.
 *
 * Returns null when the header is absent or unparseable — never NaN, which `Math.min` would carry
 * silently into a wait of NaN milliseconds.
 */
function parseRetryAfter(header: string | null | undefined): number | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return at - Date.now();
}

/**
 * One bearer-token GET with one polite retry. The only fetch either provider's sync path should use.
 *
 * `label` names the provider in the log line, because "throttled" with no name is the one detail
 * you want at 3am and the one the shared helper would otherwise take away.
 */
export async function throttledFetch(
  url: string,
  accessToken: string,
  label: 'Gmail' | 'Graph',
): Promise<Response> {
  const once = () => fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const res = await once();
  const wait = throttleWait(res.status, res.headers.get('retry-after'));
  if (wait === null) return res;
  // [THROTTLE-BUDGET] Out of budget: hand back the throttled response. The caller already knows what
  // to do with it — mark the fetch incomplete, hold the watermark, and let the next run try. That is
  // the behaviour this whole file improves on, so falling back to it is safe by construction.
  if (wait > remainingWaitMs) {
    console.warn(`[THROTTLE] ${label} throttled (${res.status}) — no wait budget left this run, not retrying`);
    return res;
  }
  remainingWaitMs -= wait;
  console.warn(`[THROTTLE] ${label} throttled (${res.status}) — waiting ${wait}ms, then one retry`);
  await new Promise((r) => setTimeout(r, wait));
  return once();
}
