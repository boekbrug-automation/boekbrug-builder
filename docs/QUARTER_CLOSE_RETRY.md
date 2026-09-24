# Re-running a partial quarter-close run

`/api/cron/quarter-close` runs four times a year (08:00 UTC on the 5th of January, April, July and
October). It tells every owner — and every accountant linked to them — that the quarter that just
ended is ready to review, or which gaps remain first. When a run cannot serve every owner, it says
so, and this page is what an operator does next.

## 1. How you know a run was partial

The run's heartbeat is the `quarter-close` row in `cron_runs` (see `LIVE_GAAN.md` §4).

| Heartbeat | Meaning |
|---|---|
| `ok = true` | Every owner was served. Nothing to do. |
| `ok = false`, `result.failed > 0` | Some owners failed. `error` starts with `1 owner failed` or `N owners failed`. |
| `ok = false`, `result.truncated > 0` | The run hit its soft deadline (250 s) and never reached the last `N` owners. `error` says `not reached before the soft deadline`. |
| `ok = null` | The run died before it finished (time-out, crash): *afgebroken*. |

The HTTP response carries the same `ok`, `failed` and `truncated`; it stays a 200 for a partial run,
like every other cron here.

## 2. Who got what

- **A failed owner got nothing:** no in-app notice, no notice to their accountant, no accountant
  mail. This includes every owner whose quarter could not be read in full — the cron refuses to
  announce a quarter it did not read (`[PACKAGE-FAIL-CLOSED]`).
- **An owner past the deadline got nothing** either.
- **Every other owner was served normally.**

To find the owners who got nothing:

- runtime logs: `[CRON-QUARTER-CLOSE] owner failed (non-fatal)` — each line carries the `ownerId`
  and the error. An unreadable quarter reads `[PACKAGE-FAIL-CLOSED] required source unreadable:
  <source>`, naming the read that failed;
- Sentry: events tagged `cron: quarter-close`, with the `ownerId` in `extra`;
- truncation: `soft deadline hit — deferring remaining owners`, with the number left.

## 3. How to re-run

Fix the cause first (an unreadable source fails again until it is readable). Then:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<production host>/api/cron/quarter-close?year=2026&quarter=3"
```

- Pass `year` and `quarter`. Without them the route takes the quarter before today's, which is only
  right in the first month of the following quarter.
- The same-day guard (`[CRON-EENMAAL]`) skips a run only when a run with `ok = true` already exists
  for this job today (Amsterdam day). A partial run does not block the re-run; a successful re-run
  does block a third call that day (`alreadyRan: true`).
- Afterwards, check the new `cron_runs` row: `ok = true`, `failed = 0`, `truncated = 0`.

## 4. The risk: repeated notices

**A re-run serves every owner of the quarter again, not only the ones that failed.** Nothing records
per owner that they were notified: `notifications` has no unique key, and the accountant mail carries
no idempotency key. So every owner and accountant the first run served receives the in-app notice
and the accountant mail a **second** time.

A re-run skips two groups: owners who have filed the quarter since (a `btw_filings` row), and
dormant quarters (no activity). Everyone else is notified again.

Weigh it before you run it: the owners who got nothing against the owners who will get a second
notice. When only a handful got nothing, telling them directly can be the better choice. Do not
re-run in a loop hoping a flaky source clears — every round repeats the notices for everyone else.

## 5. What does not exist

There is no parameter to re-run a single owner, and no per-owner dedup. Either would be a code
change, not an operation.
