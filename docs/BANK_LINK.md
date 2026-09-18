# The bank link (Enable Banking, PSD2)

*August 2026 — the PSD2 road into `bank_transactions`.*

Until now a bank statement only entered BoekBrug because the owner exported an MT940 or CAMT file
from his bank and uploaded it. That is the step people forget, and everything downstream degrades
quietly when they do: a kwartaal that misses a month, invoices that stay "openstaand" because their
payment was never imported, an accountant who never sees the whole money line.

With the owner's consent at his own bank, the transactions now arrive by themselves.

This document is the map. The reasoning lives in the file headers — each one says why it is the way
it is; this says how the pieces fit and what to watch out for.

> **Why Enable Banking and not GoCardless.** This was first built against GoCardless Bank Account
> Data. GoCardless closed new Bank Account Data signups before a single credential was ever issued,
> so that stack could never be switched on and has been removed rather than left inert. What
> survived the move is everything that was about *our* correctness rather than *their* API: the
> mapper, the dedup guarantee, and the tests.

---

## 1. The road, end to end

```
  owner                    BoekBrug                          Enable Banking / his bank
  ─────                    ────────                          ─────────────────────────
  "Koppel je bank"  ──▶  GET  /aspsps?country=NL                list of NL banks
  picks his bank    ──▶  INSERT bank_connections (pending)      ← OUR row, with a nonce
                         POST /auth  {aspsp, state, valid_until}
                                                                → { url }
                    ◀──  redirect to `url`
  logs in at his bank ─────────────────────────────────────▶   authenticates, consents
                    ◀──  redirect to /callback?code=…&state=<nonce>
                         POST /sessions {code}                  → session_id + accounts[]
                         UPSERT bank_connection_accounts
                         UPDATE bank_connections (linked)
                    ◀──  redirect to /dashboard/bank?bank=gekoppeld
  page loads        ──▶  POST /api/bank/enablebanking/sync
                         GET  /accounts/{uid}/transactions      the booked lines, paginated
                         → map → dedup → insert → auto-confirm
```

From then on `/api/cron/bank-sync` runs daily and repeats the last step.

Two things about this shape are worth naming, because they differ from the usual aggregator flow:

- **Our row is written BEFORE the owner leaves.** If we stored it on the way back, a consent that
  succeeded at the bank but whose callback never arrived (a closed tab, a phone that finished the
  flow) would leave the owner having authorised something we have no record of.
- **Nothing exists upstream until the code is exchanged.** A connect attempt that dies after our
  insert leaves no orphaned authorisation anywhere — which is why, unlike the GoCardless flow, no
  compensating "withdraw the thing we just created" step is needed.

## 2. The files

| File | What it owns |
|---|---|
| `src/lib/enablebanking-client.ts` | Everything that touches the network. JWT minting, typed errors, pagination. |
| `src/lib/enablebanking-map.ts` | Berlin Group JSON → `BankTransaction`. Pure. **The correctness centre — see §3.** |
| `src/lib/enablebanking-connection.ts` | Reads and writes `bank_connections` / `bank_connection_accounts`. The only place that does. |
| `src/lib/enablebanking-sync.ts` | Pull → map → dedup → insert → auto-confirm. Plus the rate-limit guard and window arithmetic. |
| `src/app/api/bank/enablebanking/*` | banks · connect · callback · status · sync · disconnect. |
| `src/app/api/cron/bank-sync/route.ts` | The daily feed, and the consent-expiry warnings. |
| `src/app/dashboard/bank/BankConnectPanel.tsx` | The card above the upload zone. |
| `supabase/migrations/bank_connections.sql` | Two tables, RLS, and the CONTROLE block. |
| `src/lib/bank-parity.test.ts` | **The three-door regression guard — see §3.** |

## 3. The one property to never break

A transaction can enter through **three doors**: an uploaded MT940, an uploaded CAMT.053, and the
feed. Sooner or later two of them carry the same transaction — the owner connects his bank in March
and then uploads January–March for his accountant.

If the same transaction lands twice, **every figure built on it doubles**: omzet, kosten, the
btw-aangifte, the kwartaalpakket the accountant signs. That is a wrong tax return, not a display
bug. Three layers stand against it, cheapest and most certain first, because each answers a
question the next one cannot.

| | Layer | Answers | Where |
|---|---|---|---|
| 1 | **The file's bytes** | "Is this the same statement I already imported?" | `bank-ingest.ts`, checked *before* parse and insert |
| 2 | **The source's own id** | "Has this source already delivered this line?" | `sourceKey` + `UNIQUE (user_id, source, external_id)` — uploads only; see below |
| 3 | **The content fingerprint** | "Did this payment already arrive through a *different* door?" | `contentKey` |

**Layer 2 is what the bank gave us and we were throwing away.** Measured on one real ING quarter of
576 transactions: the MT940 `:61:` bank reference is **576 present, 576 distinct**; CAMT `<NtryRef>`
is **576 present, 576 distinct**. The parser had been reading it into `BankTransaction.transactionId`
all along and `mapToRows` dropped it on the floor. It is the only layer that survives the parser
changing its mind — re-uploading a statement imported before the MT940 reference fix below used to
insert **every line again** (measured: 576 of 576); keyed on the bank's own id it inserts none.

It is also the only layer Postgres can *enforce*. The other two are read-then-write, and two writers
in that window — an upload while the daily cron sync runs — both read an empty result and both
insert. A unique index does not have that window.

**Layer 2 is dark on the feed door, and that is deliberate.** `entry_reference` looked like the
feed's version of the same id and was used as one until [EB-IDENTITEIT]. The vendor sample proves it
is the bank's *entry* id, not the transaction's: 611 transactions under 481 distinct values, one
value covering 44 unrelated lines. Keyed on it, the unique index deleted real second transactions —
silent loss, which is worse than the duplication it was preventing. So every feed row now stores
`external_id` NULL, layer 2 is off for that door, and the fingerprint carries it.

That removed the feed's race backstop along with its false identity, so the feed got an explicit
one: **`[EB-RACE]`, an account-scoped claim** in `enablebanking-claim.ts`, taken in `syncOneAccount`
and held across read → dedup → insert. It is a claim in the existing `intake_claims` table keyed
`ebsync:<account row id>`, with a stale takeover (a compare-and-set, so two workers finding the same
dead claim cannot both take it) so a crashed worker cannot wedge an account. Two sync attempts on the
same account therefore run one after the other, and the second finds the first one's rows already
stored. See that file's header for why `last_synced_at`, an advisory lock and an in-memory mutex are
all wrong for this.

**It fails CLOSED, and that is a deliberate reversal.** The first version failed open — a missing
table, an unreadable error or a throw returned "you may run" — on the argument that a broken
backstop must not stop every owner's bank feed. That argument is wrong here. Failing open lets the
one mechanism against silent financial multiplication vanish *while the financial write proceeds
anyway*, exactly when we know least about what else is broken. The two outcomes are not comparable:

| | what happens |
|---|---|
| fail **closed** | this account is not read this run. `last_synced_at` and `last_synced_through` do not move, so the next run is due immediately, and the 7-day `SYNC_OVERLAP_DAYS` window means nothing is lost. A delay. |
| fail **open** | the same money may be imported twice — into omzet, kosten, the btw-aangifte and the quarter package an accountant signs. Silent, and expensive to find afterwards. |

So every branch that cannot ESTABLISH the guarantee refuses: missing table, insert error,
unreadable holder, failed takeover, corrupt stamp, throw. Each is logged loudly, because a refusal
nobody can see is its own silent stop. The owner sees a calm Dutch line saying we will try again —
**not** an error state and **not** a prompt to reconnect the bank, because this is our
infrastructure and there is nothing he can fix.

The refusals are two values, never one boolean: `skippedBusy` (another worker holds it — the
mechanism *working*) and `skippedClaimUnavailable` (the mechanism is broken). Collapsed into one,
a dead claim table would look exactly like a healthy busy account on every screen, in every counter
and in every log line.

**The release proves ownership.** A delete on `(user_id, claim_key)` alone identifies the account
lock, not this worker's version of it: if our claim went stale and a successor took it over, our
late release would delete the *successor's live* claim and let a third worker in beside it. So the
claim writes its own `created_at` explicitly at insert — that stamp is the version token — and the
release deletes only the row still carrying it.

**Deployment order, not a degradation path.** Because there is no open failure mode, `intake_claims`
and `uq_intake_claims_user_key` must be proven live **before** Enable Banking credentials are
enabled. We control that order; there is nothing to arrange for a half-applied schema.

### Still open: the CROSS-door race — `[FINANCIAL-TRUTH-AUDIT]`

`[EB-RACE]` closes one door against itself. It does **not** close an MT940 or CAMT upload running at
the same moment as a feed sync, and this note exists so nobody reads the paragraph above as if it
did.

The shape: the upload takes no claim, and the claim's key is one Enable Banking account, so the two
run together by design. They then both read the same date window of `bank_transactions`, both find
the other's rows absent, and both insert. Layer 2 cannot catch it — the two doors write **different
`source` values** (`enablebanking:<hash>` versus the upload's own), so `UNIQUE (user_id, source,
external_id)` can never collide across doors. That was true before `[EB-IDENTITEIT]` as well: the
unique index has never protected the cross-door case, and the vendor measurement in §3 is why —
the same 576 transactions carry **zero** ids in common between the two formats. Only the content
fingerprint bridges doors, and a fingerprint is read-then-write.

Why it is recorded rather than fixed here:

- **A per-owner claim would be wrong.** Keyed on the owner rather than the account, an upload would
  queue behind a cron sync that may run for five minutes — the owner presses "upload" and the screen
  waits on a background job he cannot see. Standing down instead would silently discard his file.
- **A unique constraint on the fingerprint would be wrong.** Two identical movements on one day are
  real money: the mock seed carries `BB-2026-1007` and `BB-2026-1008`, both Bakker Bouw, both
  € 121,00, both the same date. A constraint there deletes the second one — the exact failure
  `[EB-IDENTITEIT]` was removing.
- The window is narrow (the cron runs 05:00 UTC; the owner must upload the overlapping date range
  inside the same run) but it is not zero, and a doubled line is a wrong btw-aangifte.

It belongs with the other financial-truth questions rather than with the Enable Banking work,
because the answer has to hold for **every** pair of doors, not for this one.

**Layer 3 can never be retired, and layer 2 is why we know that.** The same 576 transactions carry a
completely different id in each format: overlap between the MT940 ids and the CAMT ids is **zero**.
ING does not name a payment the same way twice. So the bank's id says nothing whatsoever about the
cross-door case, and the fingerprint

```
contentKey = date | amount | dedupName(counterpartName) | norm(reference)
```

remains the only thing that bridges doors — which is exactly why the rest of this section exists.

If any door derives a counterpart name or a reference even slightly differently, layer 3 fails and
layer 2 cannot cover for it.

So no door re-implements those rules. The feed mapper reshapes the JSON into what
`parseCAMT053Entry` sees and calls the *same* helpers — `extractInvoiceReference`,
`deriveReadableName` — in the *same* order.

**This was not hypothetical, and it was not caught by review.** A real ING business quarter
downloaded twice, once as CAMT and once as MT940 — two buttons on the same ING page — imported its
576 transactions with **28 different fingerprints**. Every bank fixture in the suite until then had
been written by the same hand as the parser, so both sides agreed on the same misreading. The
causes, all now fixed and all now pinned in `bank-parity.test.ts`:

| Cause | Rows | What was wrong |
|---|---|---|
| MT940 used the remittance TEXT as a reference | 23 | `"deel salaris april 2026"` became a payment reference where CAMT correctly produced none, and the whole `"Incasso Huur Periode: …"` where CAMT produced the mandate's EREF. CAMT falls back to `<EndToEndId>` and nothing else; MT940 now does the same. |
| The `:61:` pattern ate the betalingskenmerk | 4 | The type code is four characters but was read as `N.{0,4}`, so `NTRF1583366271601210//…` lost `NTRF1` and the rest then failed the `//` that follows. |
| The counterparty name is not the same length in both files | 5 | ING writes the name whole in CAMT and cuts it in MT940's `/CNTP/`. The fingerprint now reads the first 40 normalized characters. |

CAMT ↔ MT940 on that quarter: **548 of 576 before, 576 of 576 after.**

The feed reaches **569 of 576** against the same CAMT. The seven that remain are documented below
and pinned as expected-to-differ, so nobody reads silence as agreement.

### 3a. The one field that inverts

Enable Banking and GoCardless serve the same Berlin Group model and disagree on the one field that
cannot be got wrong:

| | amount | direction |
|---|---|---|
| GoCardless | `transactionAmount.amount = "-15.00"` | already in the sign |
| Enable Banking | `transaction_amount.amount = "15.0"` | `credit_debit_indicator = "DBIT"` |
| CAMT.053 | `<Amt>15.00</Amt>` | `<CdtDbtInd>DBIT</CdtDbtInd>` |

Enable Banking follows CAMT. Checked against their own sample export: 611 transactions, 439 `DBIT`,
and **not one amount string carries a minus sign**. Reading it the GoCardless way would import every
expense as income — silently, on every line, in the direction that looks like a good quarter. On the
real ING quarter that is the difference between −€1.578,93 and +€361.165,81.

An unsigned amount with **no** usable indicator is refused with a warning rather than defaulted to
credit. The CAMT parser may default a missing `<CdtDbtInd>` because the schema makes the element
mandatory; here nothing guarantees it, and guessing turns expenses into revenue.

### 3b. What a bank actually sends, and how much of it we may assume

Two sources shaped the mapper, and they do **not** carry the same authority:

1. **Enable Banking's own sample export.** The vendor speaking. This is what the field names and the
   `credit_debit_indicator` convention rest on. It is Danish, so it exercises none of the Dutch text.
2. **A real ING business quarter, 576 transactions** — but reshaped into that JSON *from ING's CSV
   export*, not captured from a live API response. The money is real (its signed sum lands on the
   bank's own closing balance to the cent) and so are the Dutch strings. What it does **not**
   establish is how the live feed shapes those strings: a converter stood in between.

That distinction is load-bearing, because the CSV composes a statement line that the real files do
not. ING's CSV writes

```
Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501
Kenmerk: 260514RABONL2U080320000100001 Valutadatum: 25-05-2026
```

where its own MT940 writes `/CNTP/NL89RABO…/RABONL2U/W. Ketels…//REMI/USTD//26002148/` — the
counterparty in its own field and `26002148` alone as the remittance. `statementRemittance()`
un-composes the first form back to the second, narrowly (an explicit `Omschrijving:` label, or a
line opening with `Naam:`) and **inertly**: text that is not recognisably composed is returned
untouched, so if the live feed sends a clean remittance the branch never fires.

Three questions only a live `/accounts/{uid}/transactions` response can close, each marked at its
branch in the code:

- whether the live model carries an end-to-end id (the vendor sample has none, and the six
  remaining feed-vs-file differences are all direct debits whose mandate reference has nowhere to
  go — `entry_reference` cannot be used, because the vendor sample proves it is the bank's
  non-unique entry id there: 611 transactions under 481 values, one covering 44 unrelated lines);
- whether `remittance_information` is ever longer than one element;
- whether a Dutch bank really delivers its composed statement line as the remittance.

Two further findings from the vendor sample, both pinned by tests: `entry_reference` is **not** an
identity, and `other.identification` is **not** an IBAN (every one in that sample is a card PAN or a
domestic number, so it goes through the app's mod-97 `isValidIban` before it can reach
`counterpart_iban`).

## 4. Two limits that shape everything

**Rate limit.** Each account may be read only a handful of times per day. Consequences built in:

- `SYNC_MIN_INTERVAL_HOURS = 20` in `enablebanking-sync.ts` — under a day so the daily cron never
  skips by drifting a few minutes, while still leaving the manual button room to work.
- The status route computes `canSyncNow`, so the "Ververs" button is only offered when a read would
  actually happen. A button that spends the daily budget on a no-op is worse than one that is
  honestly disabled.
- `force` is **not** a parameter the browser can set. Letting it would put the owner one impatient
  double-click away from a feed that is silent until tomorrow.
- A failure that a retry cannot help counts as a spent read; our own network trouble does not — see
  `shouldBackOffAfter`.

**Consent expiry.** PSD2 caps a consent at 90 days. Enable Banking takes an absolute
`access.valid_until` timestamp rather than a day count, which is why `access_valid_until` is a
`timestamptz` and the status route reduces it to a day before subtracting. The cron warns at 10, 3
and 1 days and on the day itself — a set of thresholds, not a single one, so a cron that misses a
day cannot skip the warning entirely.

## 4a. Errors: who is being asked to fix this?

Every failure is classified into a code, and the code decides both the Dutch sentence and what
happens to the connection. The distinction that matters most is inside a single status: a **401**
is either "your JWT is wrong" (ours; every account is broken; the owner can do nothing) or "this
consent is over" (his; one tap fixes it). Telling him to wait for support when he could reconnect in
a minute wastes his day; telling him to reconnect when our key is broken wastes it differently.

The connection-level decision — dead consent, or a bank having a bad afternoon? — is made on the
**code**, never by comparing the Dutch sentence to a generated one. That comparison works exactly
until someone improves the wording, at which point every expired connection silently starts being
filed as a generic error and nobody is ever asked to reconnect.

### There is no token endpoint

The application signs its own bearer JWT with the private key whose public half was uploaded at
registration: `RS256`, `kid` = the application id, claims `iss=enablebanking.com`,
`aud=api.enablebanking.com`, `iat`, `exp`. Nothing is exchanged, so nothing can fail to exchange —
the entire class of refresh-token bugs that the GoCardless client had to be corrected for does not
exist here.

Two consequences worth knowing:

- **The private key is the whole credential.** It never leaves `enablebanking-client.ts`, is never
  logged, and never reaches a client bundle. A leak is not a password anyone can rotate quietly: it
  signs the tokens that read users' bank accounts.
- **The vendor's own JavaScript sample encodes the JWT wrongly** — its base64 helper strips only the
  first padding character and never converts to base64url, so it fails intermittently depending on
  what the timestamp encodes to. Their Python sample is correct and is what this follows. The test
  verifies a minted token against a real key pair rather than string-matching it.

## 4b. Pagination is not optional

`/accounts/{uid}/transactions` returns a `continuation_key` when there is more. Dropping it would
import the first page and report success — the worst shape a bug can take here, because the missing
money leaves no trace to notice. The client follows the key to the end and refuses past
`MAX_TRANSACTION_PAGES` with a loud error rather than looping.

## 5. What it deliberately does not do

- **Pending transactions are never imported.** A pending line has no final amount and no final date;
  when it books a day later it arrives again with different values and would import a second time —
  the fingerprint cannot save us, because the fingerprint itself changed. The mapper counts what it
  passed over so the number is visible rather than silently absent.
- **No passthrough document is stored.** There is no original file — the bank fed us JSON. The
  closing package says so out loud for such a quarter, which is the honest outcome; a generated file
  would *look* like a bank statement without being one, and an accountant cannot tell by eye.
- **No statement balance check.** That check proves an uploaded FILE is internally complete
  (opening + Σtx = closing). A feed has no statement boundaries, so there is nothing to reconcile
  against and a fabricated pass would be worse than no check at all.

## 6. Security notes

- **The redirect target trusts almost nothing.** `state` is a 256-bit nonce we generated and stored;
  it is a lookup key, never a claim. There is no user id in that URL — adding one would be the whole
  vulnerability. Whether the consent succeeded is decided by exchanging the code, never by believing
  a `success=true` in the query string. No session is required, because the owner may finish the
  flow on his phone while the session lives on his laptop.
- **Nothing in the database is a secret.** A session id or account uid grants nothing without
  `ENABLEBANKING_APPLICATION_ID` / `ENABLEBANKING_PRIVATE_KEY`, which live in the server environment.
  Hence no Vault dance, unlike the SnelStart maatwerksleutel.
- **RLS is read-only for the owner.** Writes go exclusively through service_role. A client that
  could set `status='linked'` or invent an `account_id` could attach an account uid of its choosing
  to its own row and read that account through our credentials.
- **Disconnect ends the session upstream first**, then marks our rows. A half-failure then leaves a
  dead row that syncs nothing (visible, harmless) rather than a live authorisation with no row to
  revoke it from.
- **Private keys are gitignored** by name and by extension (`*.key`, `*.crt`, `*.p12`, `*.pfx`),
  because Enable Banking's own instructions generate `private.key` in the working directory and
  `*.pem` does not match that.
- **No real statement goes in the repository, and that includes fixtures.** The MT940/CAMT/JSON
  exports this work was verified against are not committed. Neither are the identifiers inside them:
  the fixtures in `bank-parity.test.ts` and `enablebanking-map.test.ts` are reshaped from a real
  quarter with names, IBANs, mandate and incassant ids, terminal ids and addresses replaced. That is
  a deliberate rule, not tidiness — an IBAN plus a landlord plus a street name locates a person, and
  a regression test does not need any of it. Amounts, dates and byte layout ARE kept, because those
  are the structure being pinned. Substitute IBANs are mod-97 valid and the same length so the
  validation branches and the MT940 line layout behave identically. **When you add a fixture from a
  real file, anonymise it in the same commit.**

## 7. Turning it on

1. Register the application in the Enable Banking control panel. Request **Account Information
   only** — payment initiation is not used, and asking for it widens the blast radius of a key leak
   from "read the account" to "start payments".
2. Generate the key pair **outside the repository**:
   ```
   openssl genrsa -out private.key 4096
   openssl req -new -x509 -days 365 -key private.key -out public.crt
   ```
   Upload `public.crt`, keep `private.key`.
3. Set `ENABLEBANKING_APPLICATION_ID` (the uuid beside the app) and `ENABLEBANKING_PRIVATE_KEY` (the
   PEM). A single-line environment field is fine — literal `\n` is accepted and unescaped on read.
   Unset → the card hides itself, the routes answer 503, the cron reports `configured:false`.
   Uploading is unaffected.
4. Register the redirect URL `https://<your-domain>/api/bank/enablebanking/callback` in the control
   panel. An unregistered one is refused upstream.
5. Apply `supabase/migrations/bank_connections.sql` and run its CONTROLE block. Every column must
   come back `true`.
5b. Apply `supabase/migrations/bank_tx_source_identity.sql` and run its CONTROLE block too. Both
   halves matter and they fail differently: without the **columns** the import silently drops to
   the fingerprint alone (layer 2 off, no error); with the columns but without the **unique index**
   an insert would hit `42P10`, so the code falls back to a plain insert — money still lands, but
   the race backstop is not there for the UPLOAD doors. The CONTROLE block checks for both. The
   feed door does not depend on either half: it writes `external_id` NULL by design and is
   serialized by `[EB-RACE]`, which needs `supabase/migrations/intake_claims.sql` instead — and
   that one is a **precondition, not a nice-to-have**: without it every Enable Banking sync
   refuses, by design. Run its CONTROLE block before setting the credentials in step 3.
6. Confirm `CRON_SECRET` is set — without it the daily feed refuses to run (fail-closed) and says so
   loudly in the log.
7. `vercel.json` already schedules `/api/cron/bank-sync` at 05:00 UTC daily.

**Test it before trusting it with a real quarter.** Connect once from `/dashboard/bank` and check
that transactions land, that they are matched, and — the one test that matters most — that **running
the sync a second time inserts nothing**. That is the dedup working, and it is the difference between
a correct quarter and a doubled one.

The generated types in `src/types/database.types.ts` carry both tables by hand until the next
`supabase gen types` run; the header there lists them.
