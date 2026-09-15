# Silent escape rate — how to measure it, and what it was on 12 September 2026

A bookkeeping system is not judged by how often its reader is right. It is judged by how often it
is **wrong without anyone being told** — because a wrong read that a human reviews costs time, and
a wrong read that books itself costs a corrected btw-aangifte.

So the release gate is two numbers, not one:

| metric | definition | target |
|---|---|---|
| **escape rate** | a wrong value that reached the ledger with no human in the loop | 0 on amount, btw, type, supplier — the date is open, see below |
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

Seventeen known-wrong reads, phrased as the signals the pipeline actually carries, handed to the
real `shouldAutoAdvanceInvoice`. All seventeen are held. The clean invoice still advances — asserted
separately, because a gate that refuses everything has an escape rate of zero and is worthless.

Negative-controlled: removing the zero-btw veto lets the silently-zeroed voorbelasting through,
removing the grounding veto lets a total the document never contained through, removing the
vendor-grounding veto lets the BALKIP case through, and a refuse-everything gate fails the
hold-rate half. Each surfaces by name.

### The coverage map

| critical field | witnesses outside the reader | a confidently-wrong read |
|---|---|---|
| amount | text grounding · placement on the page · e-invoice · arithmetic | **held** |
| btw | printed split · explicit-rate rule · arithmetic | **held** |
| document type | four independent flags + tax-kind | **held** |
| invoice number | placeholder detection · `verifyInvoiceNumber` (stored, read by nothing) | **held** on a placeholder |
| supplier | `vendor-grounding.ts` — is the name printed in the document's own text | **held** |
| **date** | `verifyDate` — **exists, sees the error, and no gate asks it** | **auto-books** |

### Correction to the first version of this map

Published on 12 September 2026 and wrong in both of its red rows. Re-checked against the code the
same day:

- **The supplier was never uncorroborated.** `src/lib/vendor-grounding.ts` asks whether the name
  the reader returned appears in the document's own characters, `ai.ts` stores the verdict as
  `field_confidence._vendorGrounding`, and `import-health.ts` turns `'absent'` into `flags.vendor`,
  which holds the invoice. Verified by handing that exact blob to the real decision:
  `_vendorGrounding.verdict = 'absent'` → `advance: false, reason: needs_review`. The case now sits
  in `MOETEN_WACHTEN` and is negative-controlled.
- **The date was never uncorroborated either** — and this is the more useful correction, because
  the remaining gap turns out to be a different and much smaller one.

### The date: a witness whose testimony never reaches the gate

`document-verify.ts::verifyDate` compares the stored date against every form a document might print
it in, and it **catches the day/month swap** — the classic silent date error, where 1 February is
read as 2 January: a valid date, a confident reader, and no amount changes, so nothing else in the
app can contradict it. Verified against the real function:

```
paper "Factuurdatum: 01-02-2026",  read 2026-01-02  →  absent   (the swap, seen)
paper "Factuurdatum: 01-02-2026",  read 2026-02-01  →  found    (the correct read, not flagged)
```

`ai.ts` stores that verdict as `_doccheck.date`. And then it stops:

| stored verdict | has a reader | reaches the owner | asked by the auto-booking door |
|---|---|---|---|
| `_doccheck.total` | `placementOf()` | yes | yes — `placementBlocksAutoBooking` |
| `_doccheck.btwContradiction` | `btwContradictionOf()` | yes | yes |
| `_doccheck.date` | none | yes — a sentence, no flag | **no** |
| `_doccheck.invoiceNumber` | none | **no** | no |
| `_doccheck.btw` | none | **no** | no |

The bottom two rows are computed on every import and read by nobody at all — not the gate, not the
screen. That is worth knowing rather than fixing on the spot: measured over the 86 invoices carrying
a `_doccheck`, neither has ever returned `absent` (56 `found`/`found`, 25 `unreadable`/`unreadable`,
5 `found`/`unreadable`). They have never once disagreed with the reader, so wiring them up today
would be free and would catch nothing. The date is the row where the verdict and the outcome differ.

`import-health.ts` pushes a sentence for the owner and sets no flag, so `shouldAutoAdvanceInvoice`
never sees it. The gap is not a missing check — it is a check that reaches the screen and not the
gate, which is a much cheaper thing to close.

### Why it was not simply wired up on the spot

Because the veto would have been wrong every time it fired. Measured on the production database:

```sql
select coalesce(field_confidence->'_doccheck'->>'date', '(no _doccheck)') as verdict,
       count(*) as rows,
       count(*) filter (where status = 'received') as booked
from invoices where direction = 'incoming' group by 1 order by 2 desc;
```

```
(no _doccheck) ... 522      found ... 54      unreadable ... 25      absent ... 7
```

All **seven** `absent` rows are US SaaS invoices — Anthropic, Vercel, Eleven Labs, Supabase — and
every one of them carries the same fingerprint: `total: anchored`, `invoiceNumber: found`,
`date: absent`. The text layer was read perfectly; only the date FORM was unmatched, because
`MONTHS_NL` held Dutch alone while `TOTAL_WORDS` two hundred lines above it had carried English and
German from the start.

So on the day the map was drawn, promoting `date === 'absent'` to a veto would have held **seven
correct invoices and caught zero wrong ones** — precisely the "queue full of correct invoices" that
`documentCheckBlocks` predicted in its own comment when it chose to report and not block. That
comment was right about the mechanism and wrong about the cause: the unpredictable format was not
exotic, it was every American software bill the owner receives.

Seven owners were also shown *"de factuurdatum staat niet zo op het document"* on an invoice whose
date was right. Those seven rows keep their stored verdict — the document text is not retained, so
it cannot be re-run from the database.

### What was done, and the condition for closing the gap

`verifyDate` now reads the languages the module already admitted it receives: English and German
month names, the `August 13, 2026` order that no previous form produced, and the German ordinal
`2. März 2026`. Two decisions inside it are deliberate and should not be re-opened casually:

- **Month-first NUMERIC is accepted only when the day is above 12.** `8/13/2026` has exactly one
  reading, so matching it is free; `01-02-2026` has two, and accepting the American one would throw
  away the single most valuable thing this witness does. Above 12 a swap is impossible; at or below
  it, refusing to match is what keeps the swap visible. `[DOCCHECK-VOLGORDE]` asserts both halves.
- **Short month names are listed, not sliced.** Slicing the Dutch name to three letters worked for
  nine months by coincidence and failed silently on maart/March, mei/May and oktober/October.

The veto itself waits on evidence rather than on argument. **Re-run the query above once new
invoices have flowed through.** When `absent` rows are no longer dominated by correct invoices,
`_doccheck.date` gets a reader beside `placementOf` and a veto beside it, and the pin in
`escape-rate.test.ts` goes red and says so.
