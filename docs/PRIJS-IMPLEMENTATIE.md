# PRICING — IMPLEMENTATION READY

September 2026. What the four blockers from the pricing measurement turned out to be, what was
built to close them, and the decisions that are still the owner's.

Written after the work, not before it. Every number below was read off production or off the
repository; where there is no evidence, it says so rather than estimating.

---

## Verdict

**READY for: Plus monthly, annual billing, mailbox limits, storage limits.**
**NOT READY for: lowering any published Free limit.** One new blocker, found while closing the
other four, and it is structural — see §6.

| Blocker | State |
|---|---|
| 1. AI counting bypass | **Closed.** `[EERLIJK-DEUR]` |
| 2. Per-account AI safeguard | **Closed.** `[EIGEN-AANDEEL]` — mechanism ships at 0, threshold is a decision |
| 3. Storage enforcement | **Closed for every owner-initiated door.** `[OPSLAG-DEUR]` — one named gap, §3 |
| 4. Mailbox | **Closed.** `[MAILBOX-WAAR]` |
| 5. §5.5.1 has no mechanism | **NEW, open.** Blocks lowering any Free limit |

---

## 1. AI counting bypass — closed

Eleven API routes import `@/lib/ai`, not the eight the first survey found. Exactly **one** was a
genuine bypass: `/api/invoice/audit` transcribed up to `MAX_PHOTOS_PER_RUN` (40) stored documents
per request at the `imageDocument` rate and never moved the allowance counter once.

It is now gated **inside the loop** — a single reservation at the top would charge for one document
and read forty — and releases the reservation when the transcription comes back unusable, which is
what /eerlijk-gebruik §3 promises.

Four routes are exempt with written reasons: `bestanden/classify`, `ai/draft-email`, `ai/translate`,
`draft-queue`. All four are `shortText` calls (1,200 tokens) that read no stored document. Charging
them against "documenten die de AI voor je leest" would invert `[E-FACTUUR-GRATIS]`: the owner would
pay a *reading* allowance for *writing*, and a real invoice would be pushed out of the month to pay
for an e-mail draft. **The owner has not ruled on these four.** They are gated by
`RATE_LIMITS` and the global fuse, which is the right pair of fences for what they are.

`[EERLIJK-DEUR]` states the invariant over the doors: importing the AI module and not accounting for
it is a decision that must be written down. Mutation-proved in both directions — removing the audit
gate, removing an EXEMPT entry, and gating an EXEMPT route each turn it RED.

## 2. Per-account AI safeguard — closed, and the threshold is yours

### The mechanism needed no new abstraction, and here is the proof

`usage_counters` already is a per-account, per-period, per-metric counter with an atomic
check-and-increment that **takes the limit as a parameter** (`fair_use_consume`) and refuses without
incrementing, plus a matching release. The period is part of its primary key and the column is free
text, so a UTC **day** is simply a different key in the same table. `count` is an `integer`, which
holds a day's spend in micro-euros with three orders of magnitude to spare (int4 tops out at
€2,147.48). No new table, no new function, no new migration for the counter itself.

### Where the daily share is stored

`usage_counters(user_id, period='YYYY-MM-DD', metric='internal.aiSpendDay', count=micro-euros)`.

Three independent reasons that row can never be read as a published fair-use number:

1. the metric is not in `COUNTED_METRICS`, so `measureUsage()` skips it;
2. the period is `'YYYY-MM-DD'` where `measureUsage()` asks for `'YYYY-MM'`;
3. `usage_counters_select_own` now excludes `internal.%` — a prefix rule, not an allowlist, so a
   published counter added tomorrow cannot silently vanish from the owner's own meter.

Reason 3 is the only one that holds against a client querying PostgREST directly, and it exists
because the row is **our cost model in micro-euros**. Without it, any logged-in owner could read what
each of their invoices costs us to the cent.

### The global fuse remains the safety net

`ai_budget_consume` is consulted on **every** call, outside the `if (userId)` branch, whether or not
a share is configured and whether or not there is an account at all. `[EIGEN-AANDEEL]` measures that
from the source rather than asserting it in prose. It is also still the only ceiling that can refuse
when the counter is unreachable — both fair-use counters fail open by design.

When the global fuse refuses, the share already taken is handed back, or a blown fuse would silently
eat the share of every account that asked afterwards.

### The hole this closed on the way

The three transports in `ai.ts` had **no idea whose money they were spending**. `userId` is now the
first and required parameter (`string | null`) on all three transports, the grounding helper and the
eleven exported AI functions — 25 internal calls and 13 route call sites, every one forced by the
compiler rather than by a convention. `null` is a legitimate answer in exactly one place: the
login-free scanner, which has no account and no `profiles` row for the counter's foreign key, and
which keeps its own per-IP ceiling.

Four exported AI functions have **no call site at all** — `matchTransaction`, `classifyExpense`,
`generateInvoiceFromPrompt`, `extractCompanyDetails`. They cannot spend money today, but they are
live doors the moment somebody imports them, and they are now gated like the rest.

### Threshold: a recommendation, not a decision

Production, 60 days:

| | |
|---|---|
| Busiest day ever (global) | **€1.02** — 53 calls, 20 August |
| Second and third | €0.96 (12 Sep), €0.95 (13 Sep) |
| Typical day | €0.05 – €0.35 |
| Highest single-account day, by documents | **101 documents**, 19 July (a backlog import) |
| Accounts | 11 |
| Global ceiling today | `AI_DAILY_BUDGET_EUR`, default €5.00 |

**Recommendation: `AI_DAILY_SHARE_EUR=1.50`.**

The arithmetic that matters is the ratio, not the number: `AI_DAILY_BUDGET_EUR / AI_DAILY_SHARE_EUR`
is the smallest number of accounts that can exhaust the app between them. At €5.00 / €1.50 that is
**four**. A share at or above the global ceiling is decoration.

€1.50 is roughly 210 settled document reads in a day (~€0.007 cold, ~€0.004 warm) — twice the
heaviest single day any account has ever had. It bounds the pathological case without touching
ordinary use, including a quarter of backlog imported in one afternoon.

**It ships at 0.** `AI_DAILY_SHARE_EUR` unset means count, do not limit — the same standing the
global fuse shipped in and the same standing Plus has in `fair_use_consume`. So this change alters
nothing an account can do today; it starts writing down what accounts actually spend per day. Set
the number after a week of that data, not before.

**Annual is sellable once this number is set.** The safeguard the owner required now exists.

## 3. Storage — closed at every owner-initiated door, one named gap

**Ten** places write into the `documents` bucket, not the six the first survey found. The tenth was
found by the gate itself, not by a grep. None of them measured anything: the allowance appeared on
the owner's meter and was enforced nowhere.

Six create a `documents` row and are therefore what the meter measures (`sum(documents.file_size)`
over rows not in the prullenbak). **Five are now gated**:

- `/api/bank/attachment`
- `/api/bank/attach-invoice`
- `/api/email/upload`
- `/api/intake` — **two** doors: the readable path and the unreadable-file path. The gate caught the
  second one; gating only the first would have left the cheapest way to fill an account wide open,
  which is uploading things the reader cannot read.
- `/api/invoice/[id]/document` — only in the branch that actually stores bytes; re-attaching a file
  the account already holds adds nothing and must not be charged twice.

`gateStorage()` measures with `measureUsage()` — the meter's own function, deliberately, so the
refusal and the number on the owner's screen quote the same megabytes. A gate that counted its own
way would tell him he has room on one screen and refuse him on another.

**The named gap: the e-mail sync** (`email-integration.ts`). It creates a documents row, so it can
carry an account past its allowance. It is not gated, and that is a decision rather than an
oversight: refusing there is not a 402 to a person waiting on a screen, it is a background job
holding somebody's incoming invoice, and the branch beside it already shows what a mishandled
failure costs — an invoice in the books with no reachable paper. The correct behaviour is the HOLD
that `isAiBudgetError` already earns in that same file. **That is its own change, with its own
evidence.** Until then: owner-initiated doors are bounded, the sync is not, and the gate says so.

Four doors are exempt with reasons: the offerte PDF and the feedback screenshot (neither makes a
documents row), plus the sync above. The invoice PDF and the creditnota are not listed at all —
they go to `PDF_BUCKET`, a different bucket the published allowance has never measured.

### Storage numbers

Published today: Free **2048 MB**, Plus **20480 MB**. Highest observed usage: **285 MB**. The gate
therefore changes nothing for anyone in practice; it bounds the pathological case.

**The 25 GB proposal stays a provisional product proposal**, not a decision. Nothing in this change
depends on it.

## 4. Mailbox — closed

Three layers said three different things:

- the Terms and /eerlijk-gebruik published Free 1 / **Plus 3**;
- `email_connections` allows at most **2** — `UNIQUE (user_id, provider)` with the provider limited
  to gmail and outlook — and a second Gmail *address* is not refused, it is **upserted over the
  first**. The owner loses a mailbox and is told nothing;
- the screen showed **1**: both connect buttons lived only in the not-connected branch, and the page
  read with `.limit(1).maybeSingle()`.

And nothing anywhere enforced it. Free 1 and Plus 3 were both decoration.

Now: Plus is **2** — the number the table can hold. Corrected down rather than up, because raising it
means a migration on the key the e-mail sync rides, which is a product decision and not a typo fix.
Verified on production before changing it: **no account holds more than one connection**, so nobody
loses a limit they already had.

`/api/email/connect` enforces it before the OAuth redirect — refusing afterwards would mean asking
someone to grant access to their mail and then telling them no. A **reconnect is never an addition**:
a dead grant on a provider already connected must reconnect on every plan, or an expired token would
lock a Free account out of the mailbox it already has.

The incoming page reads every connection and decides, on the server and against the same limit,
which provider is still available; the connected panel offers it.

`[MAILBOX-WAAR]` states the invariant between the published number and the code that can honour it:
**the Plus limit equals the number of providers the connect door accepts**, read from the door's own
refusal. Raising it now requires a new provider or a migration — neither a constant edited in
passing.

## 5. Downgrade — policy analysis, no code

Nothing was changed. What the code does today, stated so the decision can be made on facts:

- **Storage**: `gateStorage` refuses a *new* write over the limit. It never deletes. An account that
  drops from Plus to Free while holding more than the Free allowance keeps every file and simply
  cannot add more. That is the right default and it needs no further rule.
- **Mailboxes**: the connect door refuses an *additional* mailbox. It never disconnects. A Plus
  account with two mailboxes that drops to Free keeps both, and a reconnect of either still works —
  it is the same provider, not a new one. **Deliberate**: disconnecting someone's mail on a
  downgrade would silently stop invoices arriving, which is the one failure a bookkeeping app must
  never cause quietly.
- **aiDocuments / invoicesSent**: the counters are monthly and keyed by period. A downgrade
  mid-month means the *next* call is measured against the Free limit; nothing already counted is
  clawed back and nothing already read is undone.

**No deletion, no disconnection, no retroactive refusal on any downgrade path.** That is what the
code does now, and it is what it should keep doing.

## 6. NEW BLOCKER — §5.5.1 has no mechanism

Terms §5.5.1: *«Een grens die je al hebt, raak je niet meer kwijt… niet met aankondiging, niet na een
overgangstermijn, niet bij een latere herziening.»*

**Nothing in the code implements this.** `FAIR_USE_LIMITS` is one global constant table; every
account reads today's numbers. `plan_grants` grants a *plan*, not a historical *limit*. There is no
per-account record of what limit an account ever had. The only thing protecting §5.5.1 is a test that
checks the sentence still exists in the Terms.

The consequence is exact and it decides the Free-limit question:

> **Lowering any published Free limit silently breaks §5.5.1 for every existing account**, because
> the app has no way to keep the old number for them.

The proposed Free limits are all far below today's:

| | Today | Proposed | Highest observed |
|---|---|---|---|
| aiDocuments / month | 50 | 5 | **375** |
| invoicesSent / month | 100 | 10 | **10** |
| storage | 2048 MB | 50 MB | **285 MB** |
| mailboxes | 1 | 1 | 1 |

Two separate problems, and they compound:

1. **§5.5.1.** Every existing Free account would lose a limit it has. The promise says that cannot
   happen, in three ways, explicitly.
2. **The proposed numbers are below real usage.** 50 MB is a fifth of what one account already
   stores; 5 AI documents is a seventieth of the busiest observed month. These are not tight limits,
   they are limits the product has already exceeded.

### Three honest ways forward, and they are the owner's choice

- **(a) Apply the new limits to NEW accounts only**, and give every existing account a per-account
  grandfathered limit. This needs a mechanism: a per-account limit row consulted before
  `FAIR_USE_LIMITS`. It is the only option that keeps §5.5.1 true as written.
- **(b) Keep the Free limits where they are** and let Plus earn its price on capability rather than
  on a smaller Free tier. Costs nothing, breaks nothing, needs no code.
- **(c) Change §5.5.1** before changing the limits — publicly, as a Terms revision. Legal, but it
  spends the exact trust the clause was written to buy.

**Recommendation: (b) now, (a) when there is a reason to.** The measured cost of a Free account is
small — the busiest day the whole app has ever had was €1.02 — so a tighter Free tier buys very
little today and would cost a promise that is currently one of the sharpest things in the Terms.

## 7. Decisions still outstanding

| # | Decision | My recommendation |
|---|---|---|
| 1 | `AI_DAILY_SHARE_EUR` | €1.50 after a week of count-only data |
| 2 | Free limits | Leave at 50 / 100 / 2048 MB / 1 — see §6 |
| 3 | Annual price | €179.91 is sound once #1 is set; the coverage question is answered by the share, not by the Plus cap |
| 4 | Published Plus storage | Leave 20 GB; 25 GB stays provisional |
| 5 | The four EXEMPT AI routes | Leave exempt; gating them inverts `[E-FACTUUR-GRATIS]` |
| 6 | The e-mail sync storage gap | Its own change, with the HOLD pattern |
| 7 | §5.5.1 mechanism | Only needed if a limit is ever lowered |

**Nothing in Stripe, the Terms or the published prices has been touched.** `PLUS_PRICE_EUR` is
already 19.99 and was not changed by this work.

## 8. DEPLOYMENT ORDER — the migration goes FIRST

`supabase/migrations/usage_counters_internal_metrics.sql` is **not applied on production**
(verified 16 September 2026: `usage_counters_select_own` still reads
`user_id = (SELECT auth.uid())` with no metric filter).

**Apply it before the code deploys, not after.** The order is load-bearing and here is exactly why:

the per-account share writes an `internal.aiSpendDay` row on **every** AI call from the moment the
code is live — the threshold is 0, which means count, not count-nothing. Without the policy in
place, those rows fall under the existing select-own policy, and any logged-in owner could read our
cost model in micro-euros off their own account.

Deploying in the other order does no lasting damage — applying the migration afterwards closes the
window and the rows stay where they are — but the window is real and it is avoidable by doing one
thing before the other.

The migration itself deletes nothing, is idempotent, and changes exactly one thing: what a
logged-in browser may SELECT. `service_role` reads and writes these rows as before, which is the
only way they are ever written.

Nothing else in this work needs a migration.

---

## 8. What was measured, and where it came from

Production project `cedrndplmydqcmbszfmp`, read-only, 16 September 2026.

- `ai_spend_daily` — 30 days of global spend, above.
- `usage_counters` — 7 rows across 4 periods; highest `aiDocuments` = 375 (August), highest
  `invoicesSent` = 10 (August).
- `documents` grouped by user and day — highest single-account day 101 documents, 19 July.
- `email_connections` grouped by user — 2 accounts, 1 connection each, nobody at 2.
- `profiles` — 11 accounts, 4 created in the last 60 days.
- `pg_policies` / `information_schema.columns` — `ai_spend_daily` has no `user_id` and no RLS
  policies at all; `usage_counters` had a SELECT policy with no metric filter.

### Not measured, and deliberately not estimated

**Enable Banking / PSD2 cost.** There is no figure in the repository and no invoice to read. Any
number here would be invented, and a per-customer cost is exactly the kind of number a price should
not be built on top of a guess. It stays open until there is a real quote.
