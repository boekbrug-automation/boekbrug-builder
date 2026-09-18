# [ONTVANGEN] At-most-once financial identity — measurement before mechanism

**Status:** measurement complete, no schema change applied, stored branch NOT wired.
**Measured against production (`cedrndplmydqcmbszfmp`) on 18 September 2026, read-only.**

The invariant we need:

> A stored document may be **executed** more than once.
> It may create **financial identity** at most once.

A live claim gives mutual exclusion while a worker breathes. It says nothing about a worker
that dies *after* the invoice row commits. That gap is what this document measures.

---

## A. Does any document already back more than one invoice?

```
invoices_total        643
with_document         613
shared_document_ids     0
excess_rows             0
```

`count(*) - count(distinct document_id) where document_id is not null` = **0**.

**No.** Not one document is shared today.

## B. Is there a legitimate flow where one document belongs to more than one invoice?

**No — and the doors say so four different ways.**

| door | what it does with `document_id` |
|---|---|
| `intake-processor` | inserts a **fresh** documents row in the same pass, passes its id |
| `email/upload` | idem |
| `bank/attach-invoice` | idem |
| `email-integration` (mail sync) | idem |
| `documents/[id]/read-as-invoice` | the **only** door that books from an existing document — and it refuses when `doc.invoice_id` is already set |
| `invoice/[id]/document` | attaches evidence to an existing invoice, but always inserts a **new** documents row, and its write is a compare-and-set on `document_id`. In `replace` mode the *old* document is orphaned — never shared |

Other `document_id` columns live on other tables (`bank_tx_attachments`, `cash_entries`,
`bank_statements.statement_document_id`) or are a different column on the same table
(`invoices.attachment_document_id`). A constraint on `invoices.document_id` does not touch them.

**Confirmed from the other side too:** `invoices_met_meerdere_documenten` = **0**, and
`documents(invoice_id)` has **0** uniqueness violations. The relation is one-to-one in both
directions in live data.

## C. Does every incoming invoice from this processor carry `document_id`?

```
direction   status       n    zonder_document
incoming    archived     58        0
incoming    paid        437        8
incoming    processing    9        0
incoming    received    118        1
outgoing    archived      1        1
outgoing    draft         1        1
outgoing    overdue       1        1
outgoing    paid         11       11
outgoing    sent          7        7
```

**From this processor, yes** — its insert carries `document_id: documentId` unconditionally,
as do the other three incoming doors.

The 9 incoming rows without one are the `[REGEL-FACTUUR]` flow: an invoice created from a bank
line where there is no file at all. All 21 outgoing rows have none by design — we generate those
PDFs ourselves and they live in `pdf_url`, never as a documents row.

**So `document_id IS NOT NULL` is not universal. That is exactly why the index must be PARTIAL.**

## D. Would a uniqueness rule break any current door?

**No door intends sharing, and the data holds.** One consequence is worth stating plainly rather
than discovering later:

`read-as-invoice` guards with a **non-atomic** `SELECT` (`if (doc.invoice_id) refuse`). Two
concurrent taps can both pass it. Today the loser silently mints a second invoice. Under the
constraint the loser gets a `23505` instead — **a gain, not a break** — but that door then needs a
`23505` branch, or it will answer 500 on a race it currently loses invisibly.

---

## Two findings nobody asked for

### 1. The forward and reverse links already disagree in production

```
forward_without_reverse   1
reverse_without_forward   0
documents_met_invoice   612   (vs 613 invoices with a document)
eigenaar_mismatch         0
```

One invoice (`8af90841…`, incoming, archived) points at a document (`0cbc765a…`) whose
`invoice_id` is `null`. The document is `ai_doc_type = 'reminder'`, source e-mail; both rows were
created within the same second on 7 September.

That shape is consistent with a later **reclassification** — `fileReminder` writes
`invoice_id: placed.original?.id ?? null`, so a reminder it could not link to an original clears
the reverse link — rather than with a crash. I am not claiming a crash produced it.

**But the operational conclusion is the same either way, and it is the important one:**

> `documents.invoice_id` is **not** a reliable "already booked" signal.

A retry that keyed on `documents.invoice_id IS NULL` would look at this row and conclude the
document was never booked. It must never be the at-most-once key.

`eigenaar_mismatch = 0`: no link crosses two owners today.

### 2. A downstream failure after a successful read does not give the allowance back

`intake-processor` calls `gate.release()` on exactly two exits — the reader-outage branch and a
pre-model judgement. There are ~17 exits after the gate. The ones that fail *downstream* of a
successful read — storage upload 502, documents insert 500, invoice insert 500 — release nothing.

Today that is bounded: the owner sees an error and decides whether to retry, so at worst they
spend a second document by choice. **After receive-first a drain retries on its own**, so an
infrastructure failure loop would spend one document per attempt, for our fault, with nobody
watching.

---

## The crash matrix

Eight points on the future stored path. "Durable fact" is what survives the process dying at that
instant.

| # | crash point | durable fact | retry behaviour needed | invoice dup? | payment dup? | quota twice? | notice dup? | evidence detached? |
|---|---|---|---|---|---|---|---|---|
| 1 | after AI read, before invoice insert | document + bytes + claim; reading is **not** persisted | re-read and insert | no | no | **yes, today** — must release on the way into the retryable state | no | no |
| 2 | after invoice insert, before `documents.invoice_id` | **invoice exists**; document still says waiting | must find the existing invoice by `document_id` and repair the link — never insert | **yes, today** — this is the hole | no | yes | no | yes, until repaired |
| 3 | after linkage, before auto-advance | invoice + both links | resume side effects only | no (link now proves identity) | no | yes | no | no |
| 4 | after `apply_manual_payment` | payment + allocation row | must not settle again | no | **yes unless guarded** — the RPC takes `p_client_key`; a retry must reuse it, not mint a new one | yes | no | no |
| 5 | after cash reconcile | kasboek line | reconcile is idempotent by design (`reconcileCashWithRetry`) | no | no | yes | no | no |
| 6 | after bank auto-confirm | bank allocation | same budget guard as the manual door | no | no | yes | no | no |
| 7 | after notification | bell row | a second run rings again | no | no | yes | **yes unless guarded** — same shape as the `wacht_op_limiet` notice: let the state write decide | no |
| 8 | before final classification | everything except `ai_doc_type` | the state is still waiting, so the whole tail repeats | see 2 | see 4 | yes | see 7 | no |

Read down the columns: **quota is chargeable twice at every single point**, invoice identity is
duplicable at point 2, payment at point 4, and the notification at point 7. Those are four
separate guards, not one.

Semantic duplicate detection is **not** on this table on purpose. It is defence in depth: it
compares vendor, number, amount and date and can legitimately answer "different invoice" for two
rows that came from one document. It cannot be the idempotency boundary.

---

## Recommended mechanism

**1. Partial UNIQUE index on `invoices(document_id) WHERE document_id IS NOT NULL`.**

It is the only boundary that survives point 2, it needs no new column and no new table, and the
data is compatible today (0 violations). Created `CONCURRENTLY` so it takes no write lock.

It turns the dangerous outcome into a readable one:

```
insert invoice  →  23505 on the document key
                →  SELECT the existing invoice by document_id
                →  continue from there: repair the reverse link, finish the classification
                →  never mint a second invoice
```

**Not applied.** Awaiting your word, per instruction.

**2. Keep "identity exists" and "reverse link complete" as two different truths.**
A missing `documents.invoice_id` is a **repair**, never a reason to create an invoice. The forward
link is what the closing package reads; the reverse link is a convenience that can be rebuilt from
it. Finding 1 above is the live proof that they can disagree.

**3. Release the allowance on every exit between a successful read and the final durable state.**
Otherwise the drain charges the owner for our infrastructure failures, once per attempt.

**4. Derive `p_client_key` from the document instead of generating it** (point 4).

Measured, not assumed: `apply_manual_payment` already implements full replay semantics. Given a
key it has seen before **on the same `(user_id, invoice_id)`**, it returns the original applied
amount and `replayed = true` without touching money. Given a key spent on *other* money it raises
`55000` with wording deliberately chosen to avoid the word "already", so the incasso triage cannot
mistake a refusal for a benign no-op.

So the machinery is already there and is already careful. The only defect is the argument: the
processor passes `randomUUID()`, which makes every retry a booking the RPC has never seen. A key
derived from the document — one document, one settlement — turns point 4 from a duplicate-payment
risk into a free replay.

**5. The notification is exactly-once by the same trick already in use** — let the state transition
decide who owes it, as `pauseDocumentForFairUse` does with its `neq`.

**6. `updateClassification` needs an expected-state guard for the stored path.** Owner scope is
necessary and not sufficient: a worker that loaded `wacht_op_lezen` must not overwrite a newer
state written while it was reading. Smallest sufficient form is a compare-and-set on the state it
loaded, alongside the document claim — the same rule `[EB-RACE]` follows for the release.

---

## What is NOT decided here

- no schema change applied;
- no stored-branch wiring;
- the exact derivation for `p_client_key` (a v5-style uuid over the document id is the obvious
  shape, but it must be stable across deploys and must not collide with a key the owner's manual
  "Markeer als betaald" could produce).
