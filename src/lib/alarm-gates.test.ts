// [ALARM] Pure node test — run: npx tsx --test src/lib/alarm-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// Sentry is installed and correctly wired: instrumentation.ts exports onRequestError, so a route
// that CRASHES is seen. This product is built not to crash. Its whole design is gates that refuse
// politely — a read that could not run, a duplicate check that did not happen, a booking held back,
// an invariant left bent. Each one catches the failure, tells the owner in Dutch, and logs a line.
//
// No exception is thrown, so Sentry sees nothing, and the line goes to a runtime log nobody opens.
// That is the same shape this codebase spends its comments on: a problem noticed and told to no one.
//
// A handful of those states are ones the code itself calls impossible — "the exact state this
// design promises never exists", "amount_paid drift", "reminders are DISABLED". Those must reach a
// person. This gate holds that wiring, because nothing else can: a console.error that should have
// been an alarm looks exactly like a console.error that is correctly just a log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** The failures whose own words say the state must not exist. Each must go through the channel. */
const MUST_ALARM: Array<{ file: string; needle: string }> = [
  // [EEN-GELDMUTATIE] This entry used to read "pay rollback FAILED" — the alarm on the hand-written
  // compensating update this pass performed when its second write failed. There is no compensator
  // any more: the booking is one confirm_bank_payment transaction that commits or rolls back whole,
  // so the state that alarm watched for cannot occur. The gate lost its subject for the right
  // reason, and it is re-aimed rather than dropped, because the file still has two states whose own
  // words say they must not exist:
  //   · the payment door refusing a write this pass had already re-verified under isEligible — the
  //     six contracted refusals are triaged out as ordinary skips first, so anything reaching this
  //     is a database saying no to money for a reason nothing in the code anticipated;
  //   · the booking committed while the "controleer" badge did not — the one deliberately
  //     out-of-transaction write the change introduced, and the only way an amount-only match can
  //     reach the screen looking as certain as a reference match.
  { file: "src/lib/bank-auto-confirm.ts", needle: "the payment door refused an auto-confirm" },
  { file: "src/lib/bank-auto-confirm.ts", needle: "the 'controleer' flag is not" },
  { file: "src/app/api/bank/delete-statement/route.ts", needle: "unhealed amount_paid drift" },
  { file: "src/app/api/cron/reminders/route.ts", needle: "reminders are DISABLED" },
  { file: "src/lib/iban-change.ts", needle: "supplier lookup failed" },
  { file: "src/lib/invoice-numbering.ts", needle: "numbering template read failed" },
  // The only wrong answer in this codebase that is delivered to somebody OUTSIDE the company: a
  // customer on the public payment page, told their real invoice's link does not exist.
  { file: "src/app/api/pay/[token]/route.ts", needle: "customer told to retry" },
  // A ceiling that has stopped existing. Failing open is the right call on a payment page; not
  // knowing it happened is not.
  { file: "src/lib/rate-limit.ts", needle: "rate limit unavailable" },
  // Sales side. [DEEL-CREDIT] renamed this check: it no longer asks "does one exist" but "how much
  // is already credited", because a credit may now be a part. A failure still has to be heard for
  // exactly the old reason — unheard, it credits a customer past the invoice AND burns an Art. 35
  // number doing it. The refusal happens before the number is minted; the alarm says it happened.
  { file: "src/app/api/invoice/creditnota/route.ts", needle: "existing-creditnota check failed" },
  // And the read of the lines that the ceiling is measured against. Without them the route cannot
  // know what it is crediting, and guessing is the one thing it must never do.
  { file: "src/app/api/invoice/creditnota/route.ts", needle: "invoice lines read failed" },
  { file: "src/app/api/invoice/[id]/betaalverzoek/route.ts", needle: "creditnota check failed" },
];

test("[ALARM] the failures the code calls impossible are reported, not just logged", () => {
  const missing: string[] = [];
  for (const { file, needle } of MUST_ALARM) {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf(needle);
    assert.notEqual(at, -1, `${file} no longer contains "${needle}" — this gate has lost its subject`);
    // Look BACKWARDS from the message: the call it belongs to must be the reporting one, not a bare
    // console.error. 600 chars covers the helper's argument object comfortably.
    const around = src.slice(Math.max(0, at - 600), at + 200);
    if (!around.includes("reportHandledFailure")) missing.push(`${file} → "${needle}"`);
  }
  assert.deepEqual(
    missing, [],
    `these failures still only reach a log file:\n` +
      missing.map((m) => `  · ${m}`).join("\n") +
      `\n\nUse reportHandledFailure() from @/lib/report-handled. A caught error that nobody is told ` +
      `about is the same silence the gate was written to remove, one layer further out.`,
  );
});

test("[ALARM] the channel still logs as well as reports", () => {
  // The console line is not redundant: it is what a runtime log and a local debug session show. If
  // reporting ever replaced logging, every existing way of reading these would go dark at once.
  const helper = readFileSync("src/lib/report-handled.ts", "utf8");
  assert.match(helper, /console\.error\(/, "the helper must keep writing the log line");
  assert.match(helper, /captureMessage\(/, "…and must actually send it to Sentry");
});

test("[ALARM] reporting can never become the second failure", () => {
  // These call sites are all inside a recovery path that has just handled something correctly. If
  // Sentry itself is unreachable, that must not turn a correct refusal into a crash.
  const helper = readFileSync("src/lib/report-handled.ts", "utf8");
  const at = helper.indexOf("captureMessage");
  assert.notEqual(at, -1);
  assert.match(helper.slice(Math.max(0, at - 200), at + 400), /catch\s*\{/, "the send must be wrapped");
});

test("[ALARM] Sentry is wired for the runtimes these run in", () => {
  // The reporting channel assumes an initialised Sentry. Server code runs through instrumentation.ts;
  // if onRequestError or the server config went away, every alarm above would be a silent no-op.
  const instr = readFileSync("src/instrumentation.ts", "utf8");
  assert.match(instr, /onRequestError/, "route-handler errors must still be captured");
  const server = readFileSync("sentry.server.config.ts", "utf8");
  assert.match(server, /dsn:/, "the server runtime must still be initialised");
});

test("[PAY-READ-HONEST] the public payment page never answers a failed read with 'unknown link'", () => {
  // The customer's next move depends entirely on which of the two they are told. "Unknown link"
  // means give up — and they are holding a real invoice. Every read on this page must therefore
  // separate the two, and there are four of them: the single-invoice lookup and three in the
  // bundle view.
  const src = readFileSync("src/app/api/pay/[token]/route.ts", "utf8");
  const reads = [...src.matchAll(/const \{ data: (\w+), error: (\w+) \}/g)].map((m) => m[1]);
  assert.ok(reads.length >= 4, `only ${reads.length} reads capture their error — one of them still cannot`);

  // …and every captured error must reach the 503, not fall through to notFound.
  for (const [, , errVar] of src.matchAll(/const \{ data: (\w+), error: (\w+) \}/g)) {
    const at = src.indexOf(`if (${errVar})`);
    assert.notEqual(at, -1, `${errVar} is destructured and then dropped — that is the same silence`);
    assert.match(src.slice(at, at + 160), /payUnavailable/, `${errVar} must answer 503, never notFound`);
  }
});

test("[PAY-READ-HONEST] a working payment link is never carried into an error tracker", () => {
  // The token IS the credential: anyone holding it can see the invoice. Reporting the failure must
  // not put a live one into Sentry, so only a tail fragment travels.
  const src = readFileSync("src/app/api/pay/[token]/route.ts", "utf8");
  assert.match(src, /token\.slice\(-6\)/, "only a fragment of the token may be reported");
  const calls = [...src.matchAll(/payUnavailable\([^)]*\)/g)].map((m) => m[0]);
  assert.ok(calls.length >= 4, `expected a call per read, found ${calls.length}`);
  for (const c of calls) {
    assert.doesNotMatch(c, /token:\s*token\b/, `a full token is being reported: ${c}`);
  }
});
