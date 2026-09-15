// [AUTO-INCASSO] Pure node test — run: npx tsx --test src/lib/auto-incasso-gates.test.ts
//
// WHY THESE ARE SOURCE-LEVEL GATES
//
// This feature books payments nobody watched happen. What makes that acceptable is not the
// decision function — that one has its own tests and its own negative controls — but four pieces
// of wiring around it, every one of which fails SILENTLY when it breaks:
//
//   · the booking goes through apply_manual_payment. A direct `.update({ status: 'paid' })` is one
//     line shorter, reads perfectly, and breaks the invariant this whole app is built on
//     (invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)). Nothing on any screen turns
//     red; the number simply stops adding up, months later, in an accountant's export;
//   · it books on the VERVALDATUM. `amsterdamToday()` is the obvious thing to reach for and is
//     wrong in one specific way: under the kasstelsel the payment date picks the BTW-kwartaal, so
//     a collection that ran on 30 June booked "today" lands in Q3 instead of Q2;
//   · the QR pay sheet is closed on an incasso row. That button pre-fills the supplier's IBAN and
//     amount in the owner's banking app — on an already-collected invoice it is a second payment,
//     one tap away, with no warning anywhere. It sits in the EXPANDED card, which a static render
//     never opens, so the render gate cannot see it;
//   · the incasso pass runs from the hourly cron. Without that, the switch works exactly once (in
//     the request that flips it) and every invoice after that stays open forever — a feature that
//     appears to work on the day you turn it on and quietly does nothing from then on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// [RECONCILE-VOLGORDE] Which passes the hourly reconcile runs is declared data now, not a call
// spelled out in the cron. Two gates below ask it directly, which is stronger than the text match
// they used to do: an import that nothing calls could always satisfy a regex.
import { passesFor } from "./reconcile-sequence";

/** Source with comments stripped — these files explain the very mistakes the gates look for. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const SETTLE = "src/lib/incasso-settle.ts";
const MANAGE = "src/app/dashboard/incoming/manage/IncomingManageClient.tsx";
const CRON = "src/app/api/cron/reconcile/route.ts";
const SEQ = "src/lib/reconcile-sequence.ts";

test("[AUTO-INCASSO] the booking goes through the same door as every other payment", () => {
  const src = code(SETTLE);
  assert.match(
    src, /rpc\('apply_manual_payment'/,
    "the settle pass no longer calls apply_manual_payment — a direct status write leaves " +
      "amount_paid and bank_tx_invoices disagreeing, which is the one invariant this app has",
  );
  assert.doesNotMatch(
    src, /\.update\(\{[^}]*status:\s*['"]paid['"]/,
    "an invoice is being flipped to 'paid' directly, bypassing the RPC's row lock, its 'verwerkt' " +
      "re-check and the bank_tx_invoices row that keeps amount_paid true",
  );
});

test("[AUTO-INCASSO] it books on the day the money left, not the day it noticed", () => {
  const src = code(SETTLE);
  assert.match(
    src, /p_pay_date:\s*decision\.paymentDate/,
    "the payment date must come from the decision (the vervaldatum). Under the kasstelsel that " +
      "date decides which aangifte the voorbelasting lands in — 'today' is not a fact about the payment",
  );
  assert.doesNotMatch(
    src, /p_pay_date:\s*(today|amsterdamToday)/,
    "booking on today's date moves a collection that ran in the previous quarter into this one",
  );
  assert.match(
    src, /p_method:\s*['"]bank['"]/,
    "payment_method must stay 'bank' — the money did leave the bank account, and inventing a " +
      "third value would need every reader of that column to learn it",
  );
});

test("[AUTO-INCASSO] an assumed payment is still recorded as an assumption", () => {
  // Because payment_method is honestly 'bank', nothing else in the row separates a payment the app
  // watched arrive from one it inferred. Without the marker a storno — a collection reversed for
  // want of funds — leaves an invoice that says paid, with nothing anywhere saying who decided so.
  const src = code(SETTLE);
  assert.match(src, /withIncassoMark/, "the field_confidence marker write is gone");
  assert.match(
    src, /reportHandledFailure/,
    "a marker that failed to save must reach someone: the payment stands, and it now looks observed",
  );
});

test("[AUTO-INCASSO] neither pay button survives on an invoice the bank collects", () => {
  const src = code(MANAGE);
  // Both CTAs, and the second one is the expensive one: the QR sheet pre-fills the supplier's
  // IBAN and amount in the owner's banking app. The render gate can only see the first, because
  // the other lives in the expanded card and a static render never opens one.
  const guarded = [...src.matchAll(/inv\.status === 'received' && !incasso &&/g)];
  assert.equal(
    guarded.length, 2,
    `expected BOTH pay actions ("Heb je betaald?" and the QR "Betalen") to be closed on an incasso ` +
      `row, found ${guarded.length}. An unguarded one is a second payment of money that already left.`,
  );
});

test("[AUTO-INCASSO] the hourly reconcile keeps booking after the day you switch it on", () => {
  const src = code(CRON);
  // [RECONCILE-VOLGORDE] The call moved into the sequence; the property did not move at all. This
  // used to match settleIncassoForUser(... uid) in the cron's own source, and the note beside it
  // said why: an import that nothing calls leaves tsc happy while the pass never runs. Asking the
  // DECLARATION is the same guarantee without the text: a pass the cron does not run is not in
  // passesFor("cron"), whatever any file imports.
  assert.ok(
    passesFor("cron").some((p) => p.id === "incasso-settle"),
    "the cron no longer runs the incasso pass for its users — the switch would then work once, in " +
      "the request that flips it, and every invoice after that would stay open forever",
  );
  // …and the pass must still settle for the user the run was handed, not some other one.
  assert.match(
    code(SEQ), /settleIncassoForUser\([^)]*ctx\.userId/,
    "the incasso pass no longer settles for the user of the run it belongs to",
  );
  // An owner whose bills are all collected automatically has no pending bank lines, no cash-paid
  // invoices and no drawer entries — none of the three sets the cron discovers users from. Without
  // its own discovery query they are never visited at all.
  assert.match(
    src, /auto_incasso/,
    "the cron does not discover incasso owners; an owner with nothing but incasso invoices is " +
      "reached by none of its other three user queries",
  );
  assert.match(
    src, /createNotification\(\{[\s\S]{0,400}?automatisch afgeschreven/,
    "the owner is not told. This is the one pass in the reconcile that books a payment nobody " +
      "observed, so it may never be the quiet one",
  );
});

// ─── [DD-SIGNAL] The statement's own word for it must not be dropped again ────
//
// All three of these were captured-and-discarded before, in three different ways, and every one of
// them is a one-character edit away from being discarded again. None of it shows up at runtime: the
// import succeeds, the screen renders, and the app simply stops noticing incasso's.

test("[DD-SIGNAL] the MT940 type code leaves the function it is captured in", () => {
  const src = code("src/lib/bank-parser.ts");
  // The original bug in one line: `const [, dateStr, , creditDebit, , amountStr, , ownerRef, …]`.
  // Group 6 is the SWIFT transaction type code (NDDT = Direct Debit) and that bare comma threw it
  // away — the parser read the one field an MT940 file has for this question and dropped it.
  assert.match(
    src, /const \[, dateStr, , creditDebit, , amountStr, typeCode, ownerRef/,
    "the :61: type code is being skipped in the destructure again — NDDT never leaves the parser",
  );
  assert.match(src, /typeCode: typeCode \?\? null/, "…and it must actually reach the transaction");
});

test("[DD-SIGNAL] CAMT still asks for the three fields only it carries", () => {
  const src = code("src/lib/bank-parser.ts");
  for (const [tag, why] of [
    ["MndtId", "the machtigingskenmerk — the strongest signal any format has"],
    ["CdtrSchmeId", "the incassant-ID of the collecting party"],
    ["SubFmlyCd", "the ISO bank transaction code that classifies the entry"],
  ] as const) {
    assert.match(src, new RegExp(`<${tag}>`), `CAMT no longer reads <${tag}> — ${why}`);
  }
});

test("[DD-SIGNAL] the CSV mapper still has a role for the incasso columns", () => {
  const src = code("src/lib/bank-csv.ts");
  assert.match(src, /mutatiesoort/, "ING's Mutatiesoort column is unmapped again");
  assert.match(src, /machtigingskenmerk/, "Rabobank's Machtigingskenmerk column is unmapped again");
  assert.match(src, /incassant/, "Rabobank's Incassant ID column is unmapped again");
  // Finding a column and HANDING IT OVER are two different things: the three roles above were once
  // detected in mapColumns and then dropped on the floor by the return, which reads as working.
  //
  // Checked per role, not as one frozen tuple. The tuple version failed the day a fourth role
  // (currency) was added — a correct change, reported as "the mapper stopped returning them",
  // which is exactly the kind of false alarm that gets a gate deleted rather than read.
  const ret = /return \{([^}]*)\};/.exec(src.slice(src.indexOf("function mapColumns")));
  assert.ok(ret, "mapColumns no longer ends in an object literal — the roles cannot be checked");
  for (const role of ["typeCode", "mandate", "creditor"]) {
    // The role must carry a VALUE out, not merely appear. `mandate: -1` mentions the role and
    // hands over "no such column" forever — the same silence as dropping it, spelled so that a
    // presence check reads it as fine. So: shorthand, or a colon followed by a name.
    assert.match(
      ret[1], new RegExp(`(^|[,\\s])${role}\\s*(,|\\}|$|:\\s*[A-Za-z_$])`),
      `mapColumns detects ${role} but does not hand it over — the column is found and then dropped ` +
        `(or pinned to a literal), which looks like working code and reads like a bank that does ` +
        `not name its incasso's`,
    );
  }
});

test("[DD-SIGNAL] a proposal is a question, never a decision", () => {
  const src = code("src/app/api/cron/reconcile/route.ts");
  // [RECONCILE-VOLGORDE] Same move, same property: the cron runs this pass by declaring it, not by
  // naming it. The stamp below is NOT a pass — it is the cron's own follow-through on its own
  // notification — so it is still asked of the cron's source, where it still lives.
  assert.ok(
    passesFor("cron").some((p) => p.id === "incasso-propose"),
    "the cron no longer looks for mandates in the statement",
  );
  assert.match(
    code(SEQ), /proposeIncassoMandates\([^)]*ctx\.userId/,
    "the mandate proposal no longer asks for the user of the run it belongs to",
  );
  assert.match(src, /markIncassoSuggested/, "without the stamp the same question is asked every hour");
  // The line that would turn this from a question into a silent policy change. Turning the mandate
  // on decides how a supplier's invoices are booked from then on; this app's own rule for that
  // (bank-matching.ts, first paragraph) is that the system prepares and the human confirms.
  assert.doesNotMatch(
    src, /auto_incasso:\s*true/,
    "the cron is switching the mandate on by itself — a proposal became a decision the owner never made",
  );
});

test("[DD-SIGNAL] the owner who keeps their bank tidy is still visited", () => {
  // The reconcile only visits owners it discovers, and four of the five signals are about work
  // left UNDONE: a pending bank line, a cash-paid invoice, a drawer entry, an existing mandate.
  //
  // proposeIncassoMandates is the odd one out — it reads bank lines of ANY status, because the
  // evidence for "this supplier collects automatically" is a HISTORY of collections and a
  // collection the owner already confirmed is still evidence. So the owner who confirms everything
  // has none of the four signals, is never visited, and is never told that four of their suppliers
  // have been collecting for months.
  //
  // That is backwards: the diligent owner is the one still being asked to pay invoices the bank has
  // already taken, and they were the one the proposal could never reach. The fifth signal is the
  // statement's own markers — the predicate the partial index was built for.
  const src = code(CRON);
  assert.match(
    src,
    /mandate_id\.not\.is\.null,creditor_id\.not\.is\.null,type_code\.not\.is\.null/,
    "the reconcile must also discover owners from the direct-debit markers on their statement, " +
      "or proposeIncassoMandates never runs for anyone whose bank is already tidy",
  );
  // Tolerant, like the mandate discovery above it and unlike the three that decide who is
  // reconciled at all: these columns arrive with bank_tx_direct_debit.sql, and a run without this
  // pass is a reduced run rather than a broken one.
  // Position, not a regex across the file: the predicate must sit AFTER the try/catch that aborts
  // the run, not inside the Promise.all it guards.
  const fatalEnd = src.indexOf("user discovery failed");
  const ddAt = src.indexOf("mandate_id.not.is.null,creditor_id");
  assert.ok(fatalEnd > 0 && ddAt > fatalEnd,
    "a missing direct-debit column must not abort the whole reconcile for every owner — the " +
      "discovery belongs after the fatal block, with the tolerant mandate read");
  // And it is counted, so a run that discovers nobody this way is visible rather than assumed.
  assert.match(src, /ddUsers/, "the count belongs in the run's result, like incassoUsers");
});
