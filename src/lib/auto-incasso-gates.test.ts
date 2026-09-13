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

/** Source with comments stripped — these files explain the very mistakes the gates look for. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const SETTLE = "src/lib/incasso-settle.ts";
const MANAGE = "src/app/dashboard/incoming/manage/IncomingManageClient.tsx";
const CRON = "src/app/api/cron/reconcile/route.ts";

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
  // The CALL, not the import. An import that nothing calls is exactly how this breaks — the line
  // stays at the top of the file, tsc is happy, and the pass simply never runs.
  assert.match(
    src, /settleIncassoForUser\([^)]*\buid\b/,
    "the cron no longer runs the incasso pass for its users — the switch would then work once, in " +
      "the request that flips it, and every invoice after that would stay open forever",
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

// ─── [DD-NAAR-MATCHER] …and it must reach the thing that decides where the money goes ────────
//
// The fourth place the same signal was dropped, and the most expensive. The three columns were
// parsed from four formats, stored by bank_tx_direct_debit.sql, selected by name on /bank and used
// to pair stornos — and then rowToTransaction, the single door every STORED row walks through on
// its way to being scored, left them behind. `tx.mandateId` was therefore `undefined` in every
// scorePair call the app has ever made.
//
// Measured cost, reproduced in bank-matching.test.ts: a supplier's bounced collection (money the
// bank RETURNED: +€242,00, NDDT, a machtigingskenmerk) scored 0.950 against an open sales invoice
// of the same amount to that same company, reached 'auto', and autoConfirmTier booked it
// 'amount_only'. A customer marked paid, unattended, off money that came back from a supplier.
//
// Every gate below guards a line that is one deletion away from restoring exactly that.

test("[DD-NAAR-MATCHER] the mapper into the matcher hands over all three markers", () => {
  const src = code("src/lib/bank-import.ts");
  const start = src.indexOf("export function rowToTransaction");
  assert.ok(start > 0, "rowToTransaction is gone — the mapper the gate measures no longer exists");
  const end = src.indexOf("}", src.indexOf("return {", start));
  assert.ok(end > start, "rowToTransaction no longer returns an object literal");
  const body = src.slice(start, end);
  for (const [field, column, why] of [
    ["typeCode", "type_code", "the bank's own classification (NDDT / RDDT / IC)"],
    ["mandateId", "mandate_id", "the machtigingskenmerk — the strongest signal any format carries"],
    ["creditorId", "creditor_id", "the incassant-ID of the collecting party"],
  ] as const) {
    assert.match(
      body, new RegExp(`${field}:\\s*r\\.${column}`),
      `rowToTransaction drops ${column} again — ${why} is stored, read by /bank, and then lost one ` +
        `line before the matcher, which is precisely how a returned collection booked a sales invoice`,
    );
  }
});

test("[DD-NAAR-MATCHER] both callers of the matcher actually read the three columns", () => {
  // A mapper that hands over `r.mandate_id` on a row whose SELECT never asked for it hands over
  // undefined, and reads as wired. Both doors, because the unattended one is where it costs money.
  for (const [path, why] of [
    ["src/app/api/bank/match/route.ts", "the screen the owner reconciles on"],
    ["src/lib/bank-auto-confirm.ts", "the hourly pass that books with nobody watching"],
  ] as const) {
    const src = code(path);
    const selects = src.match(/\.select\("[^"]*bank_transactions[^"]*"\)|\.select\("id, date, amount[^"]*"\)/g) ?? [];
    assert.ok(selects.length > 0, `${path}: the pending-transaction SELECT is not recognisable any more`);
    for (const column of ["type_code", "mandate_id", "creditor_id"]) {
      assert.ok(
        selects.some((sel) => sel.includes(column)),
        `${path} (${why}) no longer selects ${column} — the matcher is scoring incasso lines blind again`,
      );
    }
  }
});

test("[STORNO-GEEN-BETALING] a returned collection is capped to a human choice, never removed", () => {
  const matcher = code("src/lib/bank-matching.ts");
  assert.match(
    matcher, /isBankStatedReversal\(readDirectDebit\(\{/,
    "the matcher no longer asks direct-debit.ts whether the bank returned this money",
  );
  // A CAP, not a refusal. Removing the candidate would be one character shorter and would break
  // the owner who collects from their OWN customers by incasso — for whom that credit IS the
  // payment. 0.6 sits under autoConfidence (0.7) so nothing pre-selects or books, and over
  // choiceThreshold (0.5) so it stays listed with its reason.
  const at = matcher.indexOf("isBankStatedReversal(readDirectDebit({");
  const near = matcher.slice(at, at + 600);
  assert.match(
    near, /confidence = Math\.min\(confidence, 0\.6\);/,
    "the reversal rule stopped being a cap — a candidate that is removed instead of lowered is " +
      "invisible, and this file's own comments record what that costs every time",
  );
  assert.match(near, /reasons\.push\(/, "a capped candidate must say why it was capped");

  // The BATCH pass never asks scorePair, so that cap does not reach it: it goes from "the printed
  // numbers sum to the amount" straight to book_bank_batch, silently and all-or-nothing. There the
  // only honest lowering is to leave the line for the human.
  const auto = code("src/lib/bank-auto-confirm.ts");
  assert.match(
    auto, /if \(isBankStatedReversal\(readDirectDebit\(\{[\s\S]{0,300}?\}\)\)\) continue;/,
    "the unattended batch pass no longer refuses a returned collection — a storno whose description " +
      "prints numbers that happen to sum can book several invoices at once, with nobody watching",
  );

  // Only the BANK's fields may hold a payment back. A payer who types "terugbetaling incasso" in a
  // payment note must not be able to freeze their own transfer.
  const dd = code("src/lib/direct-debit.ts");
  assert.match(
    dd, /export function isBankStatedReversal\(read: DirectDebitRead\): boolean \{\s*return read\.reversal && read\.signal !== null && read\.signal !== 'wording'\s*\}/,
    "isBankStatedReversal now accepts free-text wording, or is gone — either way a payer's own " +
      "words can hold back a real payment",
  );
});

test("[INCASSO-IDENTITEIT] the mandate and the incassant-ID are handles the memory remembers by", () => {
  const mem = code("src/lib/match-memory.ts");
  for (const index of ["byMandate", "byCreditor"]) {
    assert.match(mem, new RegExp(`remember\\(${index},`), `the memory no longer folds ${index}`);
    assert.match(mem, new RegExp(`remembersOnly\\(memory\\.${index},`), `the memory no longer asks ${index}`);
  }
  // Same one-party rule as every other handle, and it is what makes remembering an incassant-ID
  // safe at all: one collector may serve several trade names, and such an ID must stop speaking.
  assert.match(mem, /parties != null && parties\.size === 1 && parties\.has\(party\)/);
  // The read half must actually fetch them, or the two indexes are permanently empty and the
  // wiring reads as done.
  const server = code("src/lib/match-memory-server.ts");
  assert.match(server, /\.select\("id, counterpart_name, counterpart_iban, mandate_id, creditor_id"\)/);
  assert.match(server, /mandateId: tx\.mandate_id \?\? null/);
  assert.match(server, /creditorId: tx\.creditor_id \?\? null/);
  // It identifies the PARTY, not the bill — so it must not have earned a cap of its own. The four
  // identity ceilings stay exactly as [BANK-IDENTITY-OUTRANKS] set them.
  const matcher = code("src/lib/bank-matching.ts");
  assert.match(
    matcher, /confidence = Math\.min\(confidence, ibanOk \? 0\.96 : supplierIbanOk \? 0\.955 : 0\.95\);/,
    "the identity hierarchy moved — a remembered mandate is the owner's own confirmation read " +
      "back, which is not stronger than the account printed on the document",
  );
});

test("[DD-SIGNAL] a proposal is a question, never a decision", () => {
  const src = code("src/app/api/cron/reconcile/route.ts");
  assert.match(src, /proposeIncassoMandates\([^)]*uid/, "the cron no longer looks for mandates in the statement");
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
