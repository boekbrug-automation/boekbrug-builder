# What an accountant is actually asking, and where the answer is enforced

Five accountants asked the same question before putting a single client file in: *may I put a real
administration in here and be sure the data will not be lost, will not change wrongly, will not
produce wrong bookings, and that I can always find out what happened and who did it?*

This file is the answer. It is **not** a readiness specification with a status column, and that is
a deliberate choice made after a specific lesson.

## Why this is an index of gates and not a specification

The Verwerkersovereenkomst was written carefully, in full, and its sub-processor table was correct
on the day it was written. It then drifted **two integrations** out of date while nobody noticed,
and a third — Mollie, seven modules of it — shipped and appeared in no legal document at all. It
was not a bad document. It was a good document, and a document is a photograph.

Everything found in the audit that produced this file was **invisible to a document and visible to
a gate**: the upload door discarding a file the owner had just handed over; the reader with no clock
of its own; the bank door minting a paid invoice from a document nobody read; a reconciliation
triangle with an unreachable corner; the processing agreement itself returning 307 to the only
visitor who needs it; a date field that reads 9 March as 3 September.

So every requirement here names **the gate whose passing is its evidence**. `npm run gates` runs
them; a red one stops the build. The claim and its proof cannot drift apart, because they are the
same object.

**How to read a row.** *Requirement* is what an accountant is entitled to assume. *Enforced by* is
the gate or the mechanism; where it says a trigger, the rule lives in the database and not only in
the application. *Open* means exactly that, and says who has to close it.

## A. The document itself

| Requirement | Enforced by |
| --- | --- |
| The original file is kept, byte for byte | `content-hash.ts` — SHA-256 at intake; the file is stored, not just what was read from it |
| A file handed over is never lost because a reader was unavailable | `[BEWAAR-EERST]`, `[ELKE-DEUR]` — every door that takes a file from a person keeps it as `could_not_read`, through one shared helper |
| A stalled reader cannot silently swallow a document | `[LEZER-KLOK]` — a deadline for the whole call; a killed function runs no catch block |
| The same file cannot be booked twice | `content_hash` unique per owner, deliberately not forceable |

## B. The accounting

| Requirement | Enforced by |
| --- | --- |
| A paid outgoing invoice's money identity cannot be rewritten | `[VAST-IN-DE-DB]` — a Postgres trigger, not a route check. Proven on production against a real paid invoice: the rewrite is refused, recording the payment still works |
| An invoice the accountant marked verwerkt is frozen | `invoices_verwerkt_guard` (trigger) |
| An accountant cannot change a client's amounts | `prevent_accountant_amount_changes` (trigger) |
| A correction is a creditnota, never an overwrite | `[KETEN]`, `[CREDIT-REGELS-OF-NIETS]`, `[CREDIT-TEKEN]` |
| Invoice numbers are one unbroken series, drawn once | `next_invoice_seq()` — atomic, in Postgres, drawn at send |
| A reader outage never produces a booking | `[AANHECHT-EERST]` — the last door that accepted a confidence-0 outage verdict as a document |
| Nothing books itself without the owner | `[ZELF-EERST]` |

## C. Who may do what

| Requirement | Enforced by |
| --- | --- |
| One owner's data is never visible to another | Row-Level Security on every table |
| Seeing and acting are separate permissions | `[BOEKHOUDER-DOET]`, `[VOORSTEL]` — the accountant proposes, the owner approves |
| An employee may only touch a draft | `invoices_member_update_draft` — enforced in the policy, not the UI |
| Every act done on someone's behalf carries a name | the logbook, which the owner can read |

## D. Privacy, and who touches the data

| Requirement | Enforced by |
| --- | --- |
| A processing agreement exists, is complete, and is readable before signing up | `[DPA-BEREIKBAAR]` — published, linked, public without a session |
| Every party that processes customer data is named in BOTH documents | `[SUBVERWERKER-ECHT]` — held against the code; this is what found Mollie, Enable Banking and SnelStart missing |
| Our own identity on a legal document is never invented | `company.ts` + `company.test.ts` — reads `NEXT_PUBLIC_COMPANY_*`, and an unset value renders "(volgt)" rather than a plausible false KVK |

## D2. What the production database actually says

Not the repo — the live database, measured 12 September 2026 through the Supabase API.

| Question | Answer |
| --- | --- |
| Do the repo's guard triggers exist in production? | **10 of 10.** Including `invoices_paid_money_frozen`, applied and proven the same day |
| Do the repo's guard functions exist? | **33 of 34.** The one absence is `document_is_referenced`, scaffolding for a one-time dedup that the inventory already records as expected — its lasting result, `uq_documents_user_content_hash`, is there |
| Is RLS on for every table? | **Yes, every one.** Six carry RLS with no policies at all, which is deny-all: `ai_spend_daily`, `cron_runs`, `intake_claims`, `mollie_payment_links`, `readiness_cache`, `system_events`. All six are touched only by the server |
| Can a signed-in user pass someone else's id to a money RPC? | **No.** All nine `p_user_id` money functions check it against `auth.uid()`. The three that do not — the quota functions — are executable by neither `anon` nor `authenticated` |
| Can a visitor with no account read anything? | **No rows, and no error.** Verified as `anon`: 0 from invoices, 0 from documents, 0 from invoice_lines. Two SECURITY DEFINER oracles ARE reachable by `anon` and must stay so — five policies are declared `TO public`, and a policy expression runs with the caller's privileges. Neither leaks: both derive from `auth.uid()`, NULL there. See `[ANON-ORAKEL]` |

What the linter still reports, and why each is left:

- **6× RLS enabled, no policy** — INFO, and deliberate: deny-all is the most restrictive state there is.
- **`pg_trgm` in the public schema** — WARN. Moving it would need every fuzzy-search function's
  `search_path` moved with it; the risk of breaking search outweighs a schema-hygiene warning.
  Written down rather than done quietly.
- **12× SECURITY DEFINER callable by signed-in users** — expected. These are the RPCs the app calls,
  and the row above is the check that matters: every money one validates the caller.
- **2× SECURITY DEFINER callable by anon** — a false positive for these two, and an expensive one
  to learn. Revoking them was tried on production: the first attempt (`FROM anon`) applied cleanly
  and changed nothing, because anon inherits EXECUTE from PUBLIC; the second (`FROM PUBLIC`) took
  effect and turned an anonymous read of `invoices` into *permission denied for function* instead
  of zero rows. Rolled back within minutes and verified. `[ANON-ORAKEL]` now fails the build for
  anyone who tries it again — including the version that silently does nothing.
- **Leaked-password protection off** — a dashboard toggle, on the owner's list.

## E. Getting the data back out

| Requirement | Enforced by |
| --- | --- |
| The whole administration exports in a form another package reads | XAF 3.2 and 4.0 with RGS, UBL 2.1, CSV, the quarter package |
| Every string fits what the schema allows | `[XAF-GRENZEN]` — clipped per XSD length, code-point safe |

## F. Knowing where you stand

| Requirement | Enforced by |
| --- | --- |
| A quarter says whether it is ready, and what is missing | `/api/readiness` — one verdict over invoices, bank, till and btw |
| The owner sees the verdict without asking for it | `[KLAAR-STAND]` — and an unmeasured quarter renders the question, never a green |
| The office sees all clients at once | `/api/readiness/board` — one request, not one per client |

---

## What is open, and who closes it

**1. No restore has ever been tested.** Supabase takes backups; we have never performed a restore
and have no measured RPO or RTO. A backup that has not been restored is an assumption, not a
guarantee. **Needs the owner:** the Supabase plan and the decision to run a real restore drill.

**2. No independent accounting validation.** Every check above is one we wrote and grade ourselves.
The one piece of evidence that comes from outside is a real accountant putting a real
administration through: purchase invoices, bank lines, partial payments, credit notes, duplicates,
btw exceptions, a foreign invoice, a payment with no invoice, a correction, missing documents, a
wrong classification, a provider outage, and a full export. **Needs the owner:** one accountant
willing to hand over one administration.

**3. No formal certification.** No ISO 27001, no SOC 2, no penetration test, no DPIA. Nothing in
the published documents claims otherwise — that was measured, not assumed.

**4. Processing checkpoints are deferred**, with the trigger written down in
`docs/ONBEREIKBAAR.md`, alongside the circuit breaker and the second reader — both rejected there
with the measurements that settle them.

## What may honestly be said today

Not "fully production ready". What is true, and checkable:

> The bookkeeping never depends on the reader. Original documents are kept. A paid invoice cannot
> be rewritten — the database refuses it, not just the screen. Every change carries a name. An
> uncertain transaction is not booked automatically. And none of that is a claim about intent: it
> is 778 lifecycle gates, 4.555 unit tests and 427 render tests, measured on 12 September 2026, and
> the build stops when one of them disagrees.

Then the three open items above, named out loud. An accountant who is told what has *not* been
proven can weigh what has.
