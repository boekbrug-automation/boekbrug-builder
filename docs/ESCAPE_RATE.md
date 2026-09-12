# Silent escape rate — how to measure it, and what it was on 12 September 2026

A bookkeeping system is not judged by how often its reader is right. It is judged by how often it
is **wrong without anyone being told** — because a wrong read that a human reviews costs time, and
a wrong read that books itself costs a corrected btw-aangifte.

So the release gate is two numbers, not one:

| metric | definition | target |
|---|---|---|
| **escape rate** | a wrong value that reached the ledger with no human in the loop | 0 on amount, btw, date |
| **hold rate** | a correct value that was held for review anyway | measured, not minimised to zero |

A hold is an automation cost. An escape is an accounting error. They are not the same failure and
must never be summed into one "accuracy" percentage.

---

## Duplicates — measured, because the data exists

The semantic duplicate detector (`assessPossibleDuplicate` in `safecore.ts`, wired through
`collectPossibleDuplicate` on all five ingestion paths) records every block in `audit_logs` as
`invoice.duplicated` / `semantic_duplicate_blocked`. That makes its escape rate computable from
production without any new instrumentation.

### The queries

```sql
-- 1) How many duplicates the detector actually stopped.
select count(*) from audit_logs
where action = 'invoice.duplicated'
  and new_value->>'reason' = 'semantic_duplicate_blocked';

-- 2) How many got past it and became rows anyway.
--    Key: owner + supplier identity + normalised invoice number. NOT the amount —
--    see "why the amount is not in the key" below.
select count(*) from (
  select receiver_id, supplier_id,
         regexp_replace(lower(coalesce(invoice_number,'')), '[^a-z0-9]', '', 'g') as nr
  from invoices
  where direction = 'incoming' and supplier_id is not null and coalesce(invoice_number,'') <> ''
  group by 1,2,3 having count(*) > 1) x;

-- 3) How many of those reached the LEDGER — both rows live.
--    'paid' and 'received' are the two statuses INCOMING_OK admits in financial-result.ts.
--    An archived or processing twin is not a cost and not a voorbelasting.
select count(*) from (
  select receiver_id, supplier_id,
         regexp_replace(lower(coalesce(invoice_number,'')), '[^a-z0-9]', '', 'g') as nr
  from invoices
  where direction = 'incoming' and supplier_id is not null and coalesce(invoice_number,'') <> ''
    and status in ('paid','received')
  group by 1,2,3 having count(*) > 1) y;
```

### The result on 12 September 2026

```
duplicates blocked ..................... 1110
escaped into a row ........................  9   → ~0.8%
escaped into the LEDGER ...................  0   → 0%
```

Monthly, from the same table: 5 blocks in June, 793 in July, 290 in August, 22 in September. The
detector is not dormant and has not regressed.

### Why the amount is not in the key

The obvious key is supplier + number + date + amount. The data says the amount is the field that
breaks it: of the 9 groups that escaped, **6 have differing totals**. The second copy of an invoice
is usually the one whose btw breakdown failed to read, and a derived total then differs by exactly
the amount that was not split out. Keying on the amount makes the detector blind to the case it
most needs to see.

An invoice number is unique per supplier by definition, so supplier + number is already a strong
identity. The detector agrees: its own `matched_on: "number"` tier is what fires in production, and
it carries a second lookup — *invoices already under this number, at ANY amount* — precisely for
the corrected re-issue.

### The one known miss, in full

Two rows, same owner, supplier, number (`26701681`), date and total (€1336.14), nine minutes apart,
both from the mail sync, on 18 July 2026 — in a month where the detector blocked 793 others. No
`invoice.duplicated` entry exists for either id.

It is not reconstructable from stored data why it missed, and that is itself the finding: the
duplicate signal lives in `field_confidence._safecore`, which later stages overwrite, so there is
no record of what the detector concluded at import time. **A block leaves a durable trace; a miss
leaves none.** Until that is symmetrical, the escape rate can be measured in aggregate (as above)
but a single miss cannot be diagnosed.

Neither row reached the ledger: a human archived one, and `INCOMING_OK = {paid, received}` in
`financial-result.ts` excludes `archived`.

---

## Extraction — NOT measured, and cannot be from production data

There is no ground truth in this repository. Without a set of documents carrying hand-verified
expected values, "accuracy" is an impression.

What can be built without a single real PDF is the half of the chain that is deterministic:

```
Document → OCR/AI → Extraction → │ Normalization → Rules → Accounting proposal → Auto-book → Ledger
                                 └── everything right of here is testable with known inputs
```

The escape-rate question — *can a wrong extraction book itself?* — lives almost entirely on the
right of that line. Feed known-WRONG extraction results through the real auto-book decision
(`auto-boeken.ts`, `auto-advance.ts`, the arithmetic checks in `safecore.ts`) and count how many
are auto-booked instead of held. That measures the guard, not the reader, and it needs no corpus.

Measuring the reader still needs the corpus. Both are real work; only one is blocked on documents.

### Built: `src/lib/escape-rate.test.ts`

Sixteen known-wrong reads, phrased as the signals the pipeline actually carries, handed to the real
`shouldAutoAdvanceInvoice`. All sixteen are held. The clean invoice still advances — asserted
separately, because a gate that refuses everything has an escape rate of zero and is worthless.

Negative-controlled: removing the zero-btw veto lets the silently-zeroed voorbelasting through,
removing the grounding veto lets a total the document never contained through, and a
refuse-everything gate fails the hold-rate half. Each surfaces by name.

### The coverage map, and it is not all green

| critical field | witnesses outside the reader | a confidently-wrong read |
|---|---|---|
| amount | text grounding · placement on the page · e-invoice · arithmetic | **held** |
| btw | printed split · explicit-rate rule · arithmetic | **held** |
| document type | four independent flags + tax-kind | **held** |
| invoice number | placeholder detection | **held** |
| **date** | **none** — only the reader's own confidence | **auto-books** |
| **supplier** | **none** — only the reader's own confidence | **auto-books** |

The money field has three witnesses from outside the reader. The date and the supplier have none:
they are checked against the reader's confidence in itself, and a reader that turns 01-02-2026 into
02-01-2026 is not unsure — it is confident and wrong. Nothing downstream contradicts it either,
because no amount changes.

A wrong date moves the cost and its voorbelasting into the wrong quarter, which surfaces as a
correction to an aangifte that was already filed. A wrong supplier lands it on the wrong crediteur.

Both gaps are **pinned by a test that asserts they currently escape**, not asserted away — so they
appear in the coverage map instead of being found by an accountant. When a witness is added, that
test goes red and says so.

**What a date witness would look like**, by analogy with the amount: the same three questions.
Is the date literally printed in the document's text? Is it where a date is printed (labelled
`factuurdatum`, not a delivery or payment-term date)? Does the supplier's e-invoice agree? The
machinery for all three already exists for the total — it is the questions that were never asked
of the date.
