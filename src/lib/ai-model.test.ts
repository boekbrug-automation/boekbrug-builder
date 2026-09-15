// [MODEL-CONFIG] Pure node test — run: npx tsx --test src/lib/ai-model.test.ts
//
// Two properties carry this file:
//   1. AN UNAVAILABLE MODEL IS RECOGNISED. If not, the owner reads "try again later" on an error
//      where later is never coming — exactly how this outage went unnoticed for months, twice.
//   2. THE SPLIT DOES NOT CHANGE THE SYNC. isAiConfigError must give literally the same answer as
//      the regex email-integration.ts already used, or the automatic reader's watermark hold
//      shifts quietly along with this split.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CLAUDE_MODEL,
  resolveModel,
  isModelUnavailableError,
  isAiCredentialError,
  isAiConfigError,
  MODEL_UNAVAILABLE_MESSAGE,
  isAiCreditError,
  AI_CREDIT_MESSAGE,
} from "./ai-model";

/** The regex exactly as email-integration.ts had it, copied verbatim as the benchmark. */
const ORIGINAL_CONFIG_OUTAGE =
  /not_found_error|404|authentication_error|permission_error|invalid[_ ]?api|model:/i;

/** Real error texts as callClaude throws them: `Claude API error <status>: <body>`. */
const CLAUDE_ERRORS = [
  'Claude API error 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}',
  'Claude API error 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5"}}',
  'Claude API error 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  'Claude API error 403: {"type":"error","error":{"type":"permission_error","message":"not allowed"}}',
  'Claude API error 429: {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
  'Claude API error 529: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}',
  'Claude API error 500: {"type":"error","error":{"type":"api_error","message":"internal"}}',
  "fetch failed",
  "socket hang up",
  "[COST-GUARD] daily AI budget exhausted",
  "Claude API returned unexpected response shape",
];

test("the default is the model this app demonstrably runs on", () => {
  // Changing this is a decision — not a typo. See the header of ai-model.ts.
  assert.equal(DEFAULT_CLAUDE_MODEL, "claude-haiku-4-5-20251001");
});

test("an unavailable model is recognised — that IS the whole outage", () => {
  assert.equal(
    isModelUnavailableError(
      new Error('Claude API error 404: {"error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}'),
    ),
    true,
  );
  // Also when the text carries only the type, or only the status.
  assert.equal(isModelUnavailableError(new Error("not_found_error")), true);
  assert.equal(isModelUnavailableError(new Error("Claude API error 404: ")), true);
});

test("a key error is NOT a model error — otherwise you make a guaranteed pointless second attempt", () => {
  const auth = new Error('Claude API error 401: {"error":{"type":"authentication_error"}}');
  assert.equal(isAiCredentialError(auth), true);
  assert.equal(isModelUnavailableError(auth), false, "falling back to another model does not help here");
  // And conversely: a missing model is not a key problem.
  const missing = new Error('Claude API error 404: {"error":{"type":"not_found_error"}}');
  assert.equal(isAiCredentialError(missing), false);
});

test("a busy or broken API is not a configuration error", () => {
  // Here "try again in a moment" is exactly the right answer.
  for (const msg of ["Claude API error 429: rate_limit_error", "Claude API error 529: overloaded_error", "fetch failed", "socket hang up"]) {
    assert.equal(isAiConfigError(new Error(msg)), false, msg);
  }
});

test("[BENCHMARK] the split does not change the sync reader's verdict", () => {
  // isAiConfigError must be the exact union of the two halves, and exactly equal to the regex that
  // was already there. Without this test, a later refinement of one half could quietly shift the
  // automatic import's watermark hold.
  for (const msg of CLAUDE_ERRORS) {
    assert.equal(isAiConfigError(new Error(msg)), ORIGINAL_CONFIG_OUTAGE.test(msg), msg);
    assert.equal(
      isAiConfigError(new Error(msg)),
      isModelUnavailableError(new Error(msg)) || isAiCredentialError(new Error(msg)),
      msg,
    );
  }
});

test("nonsense does not get through", () => {
  for (const v of [null, undefined, "", 0, {}, []]) {
    assert.equal(isAiConfigError(v), false, String(v));
    assert.equal(isModelUnavailableError(v), false, String(v));
  }
  // A bare string counts too — the sync sometimes passes String(err).
  assert.equal(isModelUnavailableError("not_found_error"), true);
});

test("an empty or missing model id falls back to the proven value", () => {
  // An empty env var must NEVER pass as a model id: the API rejects it, and then you have built
  // exactly the outage this file prevents.
  assert.equal(resolveModel(undefined, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(null, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("   ", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  // Surrounding whitespace is a typo in a .env, not a different model.
  assert.equal(resolveModel("  claude-sonnet-5 ", DEFAULT_CLAUDE_MODEL), "claude-sonnet-5");
  // And a real value simply wins.
  assert.equal(resolveModel("claude-opus-5", DEFAULT_CLAUDE_MODEL), "claude-opus-5");
  // Chaining: REREAD_MODEL falls back to CLAUDE_MODEL, which falls back to the default.
  const base = resolveModel(undefined, DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(undefined, base), DEFAULT_CLAUDE_MODEL);
});

test("the message does not send the owner to a button that cannot work", () => {
  assert.ok(!/opnieuw proberen helpt/i.test("") && MODEL_UNAVAILABLE_MESSAGE.length > 0);
  // The word "opnieuw" may appear only to say that it does NOT help.
  assert.ok(/helpt hier niet/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
  assert.ok(!/probeer het later opnieuw/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
});

// ── [GEEN-KREDIET] The outage nobody had a predicate for, until it happened ──────────────────

/** Verbatim shape of what the three transports in ai.ts throw on an exhausted Anthropic account. */
const CREDIT_ERROR = new Error(
  'Claude API error 400: {"type":"error","error":{"type":"invalid_request_error",' +
  '"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
);

test("[GEEN-KREDIET] an exhausted account is recognised", () => {
  assert.equal(isAiCreditError(CREDIT_ERROR), true);
  assert.equal(isAiCreditError(new Error("Claude PDF API error 402: payment required")), true);
  assert.equal(isAiCreditError(new Error("insufficient_quota")), true);
});

test("[GEEN-KREDIET] and NONE of the older predicates saw it — which is why it buried invoices", () => {
  // This is the finding, pinned. Each of these returning false is what made the e-mail sync file a
  // real incoming invoice as could_not_read and advance the watermark past it.
  assert.equal(isModelUnavailableError(CREDIT_ERROR), false, "400 is not 404 and names no model");
  assert.equal(isAiCredentialError(CREDIT_ERROR), false, "invalid_request_error is not invalid_api");
  assert.equal(isAiConfigError(CREDIT_ERROR), false, "so the union of the two does not see it either");
});

test("[GEEN-KREDIET] and it stays out of the config union, which a test elsewhere pins", () => {
  // Folding it in would change what isAiConfigError means for every existing caller. It is wired
  // in at the one place that consumes it instead.
  assert.equal(isAiConfigError(new Error("Claude API error 402: payment required")), false);
});

test("[GEEN-KREDIET] an ordinary refusal is not a credit outage", () => {
  // The predicate must not swallow a real verdict about a file, or it would hold the watermark on
  // a document that genuinely cannot be read and freeze the sync forever.
  assert.equal(isAiCreditError(new Error("Claude API error 400: could not read this PDF")), false);
  assert.equal(isAiCreditError(new Error("Claude API error 429: rate limited")), false);
  assert.equal(isAiCreditError(new Error("Claude API error 404: not_found_error")), false);
  assert.equal(isAiCreditError(null), false);
  assert.equal(isAiCreditError(undefined), false);
});

test("[GEEN-KREDIET] the owner is never sent to a setting they do not own", () => {
  assert.match(AI_CREDIT_MESSAGE, /er gaat niets verloren/);
  assert.doesNotMatch(AI_CREDIT_MESSAGE, /instellingen|opnieuw proberen helpt/i);
});
