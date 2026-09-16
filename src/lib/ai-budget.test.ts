// [COST-GUARD] Pure node test — run: npx tsx --test src/lib/ai-budget.test.ts
//
// The arithmetic of the fuse, without a database.
//
// WHY THESE TESTS AND NOT OTHERS
//
// The fuse is global: one number, shared by every user of the app. That makes its arithmetic
// unusually consequential in ONE direction — an estimate that is 3× too high does not cost money,
// it costs everyone else their automatic reading for the rest of the day. That is exactly what
// happened: €5 blew at ~260 documents while real spend was under €2, because the reservation
// charged max_tokens and the cache-write rate on every call.
//
// So the properties worth pinning are about the CORRECTION, and about the directions in which it
// must refuse to correct:
//
//   1. The refund is real and large. A settled batch call costs a fraction of its reservation.
//   2. A dearer-than-estimated call is CHARGED. A settlement that only ever refunds is a discount.
//   3. An unreadable usage block settles NOTHING. Never talk a fuse down from a response you could
//      not read — that is the one direction where being wrong ends in a bill.
//   4. A reservation that was never recorded is never settled. Fail-open on the guard must not
//      turn into subtracting money nobody charged.
//   5. The floor: no settlement can be constructed that drives a day negative on its own. (The
//      database clamps too — GREATEST(...,0) in ai_budget_settle.sql — but a fuse deserves both.)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  estimateCostMicros,
  actualCostMicros,
  settlementMicros,
  accountSharePeriod,
  accountShareMicros,
  MICROS_PER_KTOK,
  TOKEN_ESTIMATE,
  type ClaudeUsage,
} from "./ai-budget";

/** A reservation as reserveAiBudget() returns it for a document read. */
const RESERVED_DOCUMENT = {
  reservedMicros: estimateCostMicros(TOKEN_ESTIMATE.imageDocument, 2000),
  recorded: true,
};

/** What a COLD invoice read really reports: system prompt written to cache, short answer. */
const COLD: ClaudeUsage = {
  input_tokens: 1_700,
  cache_creation_input_tokens: 4_300,
  cache_read_input_tokens: 0,
  output_tokens: 420,
};

/** The same read inside a batch: the system prompt is a cache HIT. */
const WARM: ClaudeUsage = {
  input_tokens: 1_700,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 4_300,
  output_tokens: 420,
};

// ── The rates themselves ─────────────────────────────────────────────

test("[COST-GUARD] a cache read is a tenth of ordinary input, and output is five times it", () => {
  assert.equal(MICROS_PER_KTOK.cacheRead * 10, MICROS_PER_KTOK.input);
  assert.equal(MICROS_PER_KTOK.cacheWrite, Math.round(MICROS_PER_KTOK.input * 1.25));
  assert.equal(MICROS_PER_KTOK.output, MICROS_PER_KTOK.input * 5);
});

// ── 1. The refund is real, and big enough to matter ──────────────────

test("[COST-GUARD] the reservation for one document is what it always was", () => {
  // 6,000 in at the cache-write rate + 2,000 out. Pinned because the whole point of the
  // settlement is that this number stays conservative — it must not quietly get cheaper.
  assert.equal(RESERVED_DOCUMENT.reservedMicros, 19_250);
});

test("[COST-GUARD] a cold read settles to roughly a third of its reservation", () => {
  const actual = actualCostMicros(COLD);
  assert.ok(actual !== null);
  // 1700×1.100 + 4300×1.375 + 420×5.500 = 1870 + 5912.5 + 2310 = 10092.5 → 10093
  assert.equal(actual, 10_093);

  const delta = settlementMicros(RESERVED_DOCUMENT, COLD);
  assert.ok(delta < 0, "a cold read still costs less than the reservation");
  assert.equal(RESERVED_DOCUMENT.reservedMicros + delta, actual);
});

test("[COST-GUARD] a warm read — the normal case in a batch — settles to about a fifth", () => {
  const actual = actualCostMicros(WARM);
  assert.ok(actual !== null);
  // 1700×1.100 + 4300×0.110 + 420×5.500 = 1870 + 473 + 2310 = 4653
  assert.equal(actual, 4_653);

  // This is the number the whole change exists for: a €5 day is ~1,000 warm reads, not ~260.
  const perDay = Math.floor(5_000_000 / actual);
  assert.ok(perDay > 900, `a €5 day should be well past 900 warm reads, got ${perDay}`);
});

// ── 2. A dearer call is charged, not forgiven ────────────────────────

test("[COST-GUARD] a call that cost MORE than estimated is charged the difference", () => {
  // A long multi-page PDF that answers at the full 2,000 tokens with no cache hit.
  const expensive: ClaudeUsage = {
    input_tokens: 20_000,
    cache_creation_input_tokens: 4_300,
    cache_read_input_tokens: 0,
    output_tokens: 2_000,
  };
  const delta = settlementMicros(RESERVED_DOCUMENT, expensive);
  assert.ok(delta > 0, "settlement must add when the estimate was too low");
  assert.equal(
    RESERVED_DOCUMENT.reservedMicros + delta,
    actualCostMicros(expensive),
    "after settling, the day carries the real cost — not the estimate, in either direction",
  );
});

// ── 3. An unreadable usage block settles nothing ─────────────────────

test("[COST-GUARD] a missing or empty usage block leaves the conservative estimate standing", () => {
  for (const bad of [undefined, null, {}, { input_tokens: 0, output_tokens: 0 }]) {
    assert.equal(actualCostMicros(bad as ClaudeUsage | null | undefined), null);
    assert.equal(
      settlementMicros(RESERVED_DOCUMENT, bad as ClaudeUsage | null | undefined),
      0,
      "no usage → no settlement → the fuse keeps the high guess",
    );
  }
});

test("[COST-GUARD] nonsense token counts never make a call look cheaper than it was", () => {
  // NaN, negatives and strings all read as zero — but a block that is ONLY nonsense reads as
  // unreadable, not as a free call.
  const nonsense = {
    input_tokens: Number.NaN,
    output_tokens: -5,
    cache_read_input_tokens: null,
  } as unknown as ClaudeUsage;
  assert.equal(actualCostMicros(nonsense), null);

  // One good field among the nonsense is still a real reading of that field.
  const partly = { input_tokens: Number.NaN, output_tokens: 400 } as unknown as ClaudeUsage;
  assert.equal(actualCostMicros(partly), 400 * (MICROS_PER_KTOK.output / 1000));
});

// ── 4. Nothing recorded, nothing settled ─────────────────────────────

test("[COST-GUARD] a reservation the guard never recorded is never refunded", () => {
  // This is the fail-open path: reserveAiBudget allowed the call because the database was
  // unreachable, so NOTHING went on the tab. Refunding it here would drive the day's total down
  // by money that was never charged — and a fuse you can talk downwards is not a fuse.
  const unrecorded = { reservedMicros: 19_250, recorded: false };
  assert.equal(settlementMicros(unrecorded, WARM), 0);

  // Same for a refused call: ai_budget_consume() reserves nothing when it says no.
  const refused = { reservedMicros: 0, recorded: false };
  assert.equal(settlementMicros(refused, WARM), 0);
});

// ── 5. A settlement can never exceed its own reservation downwards ───

test("[COST-GUARD] a refund never exceeds what was reserved", () => {
  // The cheapest imaginable call against the biggest reservation: the refund is bounded by the
  // reservation itself, so one settlement can never push a day below zero on its own.
  const tiny: ClaudeUsage = { input_tokens: 1, output_tokens: 1 };
  const delta = settlementMicros(RESERVED_DOCUMENT, tiny);
  assert.ok(delta < 0);
  assert.ok(
    Math.abs(delta) < RESERVED_DOCUMENT.reservedMicros,
    "the refund is smaller than the reservation, always — the call cost SOMETHING",
  );
});

// ── The estimate itself, unchanged ───────────────────────────────────

test("[COST-GUARD] the estimate still refuses to be talked down by bad input", () => {
  assert.equal(estimateCostMicros(-1, -1), 0);
  assert.equal(estimateCostMicros(0, 2000), 11_000);
  // Rounded UP, never down: the reservation errs toward tripping early.
  assert.equal(estimateCostMicros(1, 0), Math.ceil(MICROS_PER_KTOK.cacheWrite / 1000));
});

// ── 6. A blown fuse is not a verdict about a document ────────────────
//
// The reader (verifyInvoiceFromPdf) turns every throw into a confidence-0 FALLBACK that says
// is_invoice:false, and re-throws only what it recognises as infrastructure. The fuse refuses
// BEFORE Anthropic is reached, so it carries no HTTP status and no network symptom, and neither of
// the two existing predicates recognised it. A blown daily ceiling therefore arrived downstream as
// a confident "this is not an invoice" — and on the e-mail sync that verdict is permanent
// (registered could_not_read, watermark past it). These tests pin the recognition and both wirings.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AI_BUDGET_EXHAUSTED_ERROR, isAiBudgetError, BUDGET_EXHAUSTED_MESSAGE } from "./ai-budget";
import { isTransientAiError, isAiApiError } from "./ai";
import { isAiConfigError } from "./ai-model";

test("[COST-GUARD] the fuse is recognised — and by nothing that existed before it", () => {
  const blown = new Error(AI_BUDGET_EXHAUSTED_ERROR);
  assert.equal(isAiBudgetError(blown), true);

  // THE WHOLE REASON THIS PREDICATE EXISTS. If any of these three ever answered true, the fuse
  // would already have been re-thrown and #26 would not have been a defect.
  assert.equal(isTransientAiError(blown), false, "no network symptom — it never reached the network");
  assert.equal(isAiApiError(blown), false, "no HTTP status — it never reached the API");
  assert.equal(isAiConfigError(blown), false, "the configuration is fine; the day's money is not");
});

test("[COST-GUARD] the predicate answers about the fuse and nothing else", () => {
  // A real document verdict is a normal return, never an exception — but the errors that DO reach
  // this predicate must not be mistaken for the fuse, or a genuine outage would hold forever.
  for (const msg of [
    "Claude API error 429: rate_limit_error",
    "Claude API error 404: not_found_error",
    "fetch failed",
    "Claude API returned unexpected response shape",
    "",
  ]) {
    assert.equal(isAiBudgetError(new Error(msg)), false, msg);
  }
  assert.equal(isAiBudgetError(null), false);
  assert.equal(isAiBudgetError(undefined), false);
  // Wrapped by a caller that prefixed its own context: still the fuse.
  assert.equal(isAiBudgetError(new Error(`classify failed: ${AI_BUDGET_EXHAUSTED_ERROR}`)), true);
  // A plain string, as a rejected non-Error would arrive.
  assert.equal(isAiBudgetError(AI_BUDGET_EXHAUSTED_ERROR), true);
});

test("[COST-GUARD] the message the fuse throws is the one the predicate looks for", () => {
  // Not a mention — the WIRING. The three transports must throw the shared constant, so the text
  // cannot be rewritten at one end while the predicate keeps matching the old words at the other.
  const ai = readFileSync(join(process.cwd(), "src/lib/ai.ts"), "utf8");
  const throwsConstant = ai.match(/throw new Error\(AI_BUDGET_EXHAUSTED_ERROR\)/g) ?? [];
  assert.equal(throwsConstant.length, 3, "callClaude, callClaudeWithPdf and callClaudeWithImage");
  assert.equal(
    ai.includes(`'${AI_BUDGET_EXHAUSTED_ERROR}'`) || ai.includes(`"${AI_BUDGET_EXHAUSTED_ERROR}"`),
    false,
    "no transport may throw the text literally — that is how the two ends drift apart",
  );
  // And the Dutch sentence a user reads when it blows is still a sentence, not a key.
  assert.match(BUDGET_EXHAUSTED_MESSAGE, /niet beschikbaar/);
});

test("[COST-GUARD] the reader re-throws the fuse instead of calling it a document verdict", () => {
  const ai = readFileSync(join(process.cwd(), "src/lib/ai.ts"), "utf8");
  // Slice to the ONE condition that decides re-throw vs FALLBACK, so this cannot pass on the
  // predicate merely being imported or named in a comment somewhere else in a 3000-line file.
  const line = ai.split("\n").find((l) => l.includes("opts?.throwOnTransient") && l.includes("throw error"));
  assert.ok(line, "the re-throw condition still exists");
  assert.match(line!, /isAiBudgetError\(error\)/, "a blown fuse must leave as an error, not as is_invoice:false");
});

test("[COST-GUARD] the e-mail sync holds on a blown fuse instead of burying the invoice", () => {
  // The second half, and the one with the permanent consequence: re-throwing alone would send the
  // attachment down the poison-pill path (isAiConfigError and isTransientAiError both say no), and
  // the fuse stays blown for the rest of the day — long enough to exhaust the attempts and register
  // a real invoice as could_not_read. It has to hold like a config outage.
  const sync = readFileSync(join(process.cwd(), "src/lib/email-integration.ts"), "utf8");

  const catchLine = sync.split("\n").find((l) => l.includes("const budgetOutage = isAiBudgetError("));
  assert.ok(catchLine, "the classify catch decides whether this was the fuse");

  const holdLine = sync.split("\n").find((l) => l.includes("const outageHold ="));
  assert.ok(holdLine, "the per-attachment outage decision still exists");
  assert.match(holdLine!, /budgetOutage/, "unconditionally, exactly like configOutage — it is app-wide");

  // And the hold must actually reach the give-up branch: the loop head has to destructure it.
  const loopHead = sync.split("\n").find((l) => l.includes("of classified) {"));
  assert.ok(loopHead, "the PHASE 2 loop still walks the classified attachments");
  assert.match(loopHead!, /budgetOutage/, "a flag the loop never unpacks is a guard that never runs");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [EIGEN-AANDEEL] The per-account share.
//
// The fuse above is global, so it is deliberately blind to WHO is spending. This half is the
// opposite question, and the properties worth pinning are the ones where being wrong is silent:
//
//   1. The share's day is the SAME day the global fuse uses. Two different notions of "today"
//      would refuse an account on a day the fuse thinks is already over, and nothing would say so.
//   2. It ships at 0 — count, never limit. Mechanism and threshold are separate decisions.
//   3. Junk in the environment does not become a ceiling. A malformed AI_DAILY_SHARE_EUR must read
//      as "not configured", never as a very small number that locks every account out.
//   4. The two settlements ask their own question. The share can be recorded while the global
//      guard was unreachable, and then the account's day is holding an estimate the global tab
//      never took — deriving both from one flag leaves that account over-charged until midnight.

test("[EIGEN-AANDEEL] the share's day is the fuse's day", () => {
  // ai_budget_consume() keys on (now() AT TIME ZONE 'UTC')::date. This must be the same instant.
  const justBeforeMidnightUtc = new Date("2026-09-16T23:59:59.999Z");
  const justAfter = new Date("2026-09-17T00:00:00.000Z");
  assert.equal(accountSharePeriod(justBeforeMidnightUtc), "2026-09-16");
  assert.equal(accountSharePeriod(justAfter), "2026-09-17");

  // A local-time implementation would get this wrong in either direction depending on the server's
  // zone; the assertion above is only meaningful because this one pins the format too.
  assert.match(accountSharePeriod(justAfter), /^\d{4}-\d{2}-\d{2}$/);
  // And it must NOT be the fair-use month key — that is a different counter in the same table.
  assert.notEqual(accountSharePeriod(justAfter).length, "2026-09".length);
});

test("[EIGEN-AANDEEL] the share ships counting, not limiting", () => {
  const saved = process.env.AI_DAILY_SHARE_EUR;
  try {
    delete process.env.AI_DAILY_SHARE_EUR;
    assert.equal(accountShareMicros(), 0, "unset means count, do not limit — the number is the owner's");

    process.env.AI_DAILY_SHARE_EUR = "";
    assert.equal(accountShareMicros(), 0, "empty is the same as unset, not a ceiling of zero euros");

    process.env.AI_DAILY_SHARE_EUR = "1.50";
    assert.equal(accountShareMicros(), 1_500_000);

    // 3. Junk fails to "no ceiling", never to a tiny one. The opposite default would refuse every
    //    paying account on a typo, and the log line would blame the account.
    for (const junk of ["abc", "-1", "NaN", "1,50"]) {
      process.env.AI_DAILY_SHARE_EUR = junk;
      assert.equal(accountShareMicros(), 0, `"${junk}" must read as unconfigured, not as a ceiling`);
    }
  } finally {
    if (saved === undefined) delete process.env.AI_DAILY_SHARE_EUR;
    else process.env.AI_DAILY_SHARE_EUR = saved;
  }
});

test("[EIGEN-AANDEEL] the two settlements are asked separately", () => {
  // The case that matters: the share was charged, the global guard was not reachable. The global
  // tab has nothing to correct — and the account's day must still be corrected, or it carries the
  // full conservative estimate for a failure that was ours.
  const reserved = { reservedMicros: estimateCostMicros(TOKEN_ESTIMATE.imageDocument, 2000), recorded: false };
  assert.equal(settlementMicros(reserved, WARM), 0, "nothing was charged globally → nothing to settle");
  assert.ok(
    settlementMicros({ ...reserved, recorded: true }, WARM) < 0,
    "the same usage, against a reservation that WAS recorded, is a real refund",
  );

  // And the mirror: a refused call recorded nothing on either counter, so neither may be settled.
  assert.equal(settlementMicros({ reservedMicros: 0, recorded: true }, WARM), 0);
});
