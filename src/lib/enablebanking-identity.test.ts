// [EB-IDENTITEIT] Which identifier may switch a transaction OFF at the database door.
// Run: npx tsx --test src/lib/enablebanking-identity.test.ts
//
// ── THE RULE THIS FILE EXISTS FOR ────────────────────────────────────────────────────────────
//
// A provider identifier may take part in hard database deduplication ONLY when it reliably
// identifies one transaction. It may never make a legitimate second money movement disappear.
//
// ── WHY THAT RULE NEEDED A TEST ──────────────────────────────────────────────────────────────
//
// Three true statements in this repo contradicted each other, and the contradiction cost money:
//
//   1. enablebanking-map.ts says entry_reference is NOT an identity, with counted evidence from
//      Enable Banking's own sample export: 611 transactions under 481 distinct entry_reference
//      values, "3845245274" shared by 44 unrelated MobilePay lines and "0000000000" by 21.
//   2. bank-import.ts nevertheless copied the mapper's transactionId into external_id.
//   3. bank_transactions carries UNIQUE (user_id, source, external_id) and the Enable Banking
//      sync upserts onConflict that key with ignoreDuplicates: true.
//
// Put together: two genuinely different transactions that happen to share an entry_reference both
// survive dedupTransactions (which compares incoming against EXISTING, never incoming against
// incoming), reach the upsert, collide on the unique index — and the second is silently ignored.
// No error, no warning, no row. The owner's money is simply not in the books, and on every later
// sync the same line is dropped again, so it never arrives.
//
// The counted vendor evidence is what decides it. Current Enable Banking prose calls
// entryReference unique; a sample export from the same vendor proves it is not, on real data.
// Between a promise and a measurement, the measurement wins — and the failure direction of
// trusting the promise is permanent, invisible loss.
//
// ── WHAT IS ASSERTED, AND WHERE ──────────────────────────────────────────────────────────────
//
// These tests stop at OUR side of the contract: the rows we hand to the database. A row set in
// which two DIFFERENT transactions carry the same non-null (source, external_id) is a row set the
// unique index will silently thin. That is checkable without a database and it is the exact
// property that was violated.

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapEnableBankingTransactions, type EnableBankingRawTransaction } from "./enablebanking-map";
import { canUseEnableBanking, enableBankingTesters, isEnableBankingConfigured } from "./enablebanking-client";
import { dedupTransactions, mapToRows, type ExistingTxKey } from "./bank-import";

const USER = "11111111-1111-1111-1111-111111111111";
const SOURCE = "enablebanking:ACCOUNT-KEY-A";

/** One booked Enable Banking transaction, with only the fields this question needs. */
function booked(o: {
  ref?: string | null;
  amount: string;
  credit?: boolean;
  date: string;
  text: string;
  party?: string;
}): EnableBankingRawTransaction {
  return {
    entry_reference: o.ref ?? null,
    status: "BOOK",
    booking_date: o.date,
    transaction_amount: { amount: o.amount, currency: "EUR" },
    credit_debit_indicator: o.credit === false ? "DBIT" : "CRDT",
    remittance_information: [o.text],
    creditor: o.credit === false ? { name: o.party ?? "Leverancier BV" } : null,
    debtor: o.credit === false ? null : { name: o.party ?? "Klant BV" },
  } as EnableBankingRawTransaction;
}

/** The identity pairs the database will see. Null external_id never collides in a btree unique. */
function identityPairs(rows: ReturnType<typeof mapToRows>): string[] {
  return rows
    .map((r) => (r.external_id ? `${r.source}|${r.external_id}` : null))
    .filter((k): k is string => k !== null);
}

/**
 * The stored shape the sync reads back, with exactly the columns it SELECTs:
 * "date, amount, description, counterpart_name, reference" plus source/external_id.
 * `reference` is not decoration here — contentKey is built from (date, amount, counterpart,
 * reference), so a harness that forgets it would prove a dedup that the product does not have.
 */
function storedFrom(rows: ReturnType<typeof mapToRows>): ExistingTxKey[] {
  return rows.map((r) => ({
    date: r.date,
    amount: r.amount,
    description: r.description,
    counterpart_name: r.counterpart_name,
    reference: r.reference ?? null,
    source: r.source ?? null,
    external_id: r.external_id ?? null,
  })) as unknown as ExistingTxKey[];
}

/** Map → dedup against what is already stored → the rows we would write. */
function ingest(raw: EnableBankingRawTransaction[], existing: ExistingTxKey[] = []) {
  const mapped = mapEnableBankingTransactions(raw);
  const dd = dedupTransactions(mapped.transactions, existing, SOURCE);
  return { mapped, dd, rows: mapToRows(dd.toInsert, USER, SOURCE) };
}

/** A ProcessEnv with one variable replaced. NODE_ENV is required on the type, so this starts
 *  from a real env rather than an object literal that only looks like one. */
function envWith(testers?: string): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  if (testers === undefined) delete e.ENABLEBANKING_TESTERS;
  else e.ENABLEBANKING_TESTERS = testers;
  delete e.ENABLEBANKING_APPLICATION_ID;
  delete e.ENABLEBANKING_PRIVATE_KEY;
  return e;
}

// ── 1. The bug itself ────────────────────────────────────────────────────────────────────────
test("[EB-IDENTITEIT] two different transactions sharing one entry_reference both survive", () => {
  const { rows } = ingest([
    booked({ ref: "3845245274", amount: "120.00", date: "2026-09-03", text: "Factuur 2026001", party: "Klant A" }),
    booked({ ref: "3845245274", amount: "340.50", date: "2026-09-04", text: "Factuur 2026002", party: "Klant B" }),
  ]);

  assert.equal(rows.length, 2, "one of the two movements was dropped before the database");

  const pairs = identityPairs(rows);
  assert.equal(
    new Set(pairs).size,
    pairs.length,
    "two DIFFERENT transactions carry the same (source, external_id) — uniq_bank_tx_source_identity " +
      "will silently discard the second, and the money never arrives",
  );
});

// ── 2. The same transaction twice is still one ───────────────────────────────────────────────
test("[EB-IDENTITEIT] the identical transaction synced twice inserts once", () => {
  const first = ingest([booked({ ref: "A1", amount: "120.00", date: "2026-09-03", text: "Factuur 2026001", party: "Klant A" })]);
  assert.equal(first.rows.length, 1);

  const stored = storedFrom(first.rows);

  const again = ingest(
    [booked({ ref: "A1", amount: "120.00", date: "2026-09-03", text: "Factuur 2026001", party: "Klant A" })],
    stored,
  );
  assert.equal(again.rows.length, 0, "a second sync of the same history wrote a second row");
  assert.equal(again.dd.skipped, 1);
});

// ── 3. Across pagination ─────────────────────────────────────────────────────────────────────
test("[EB-IDENTITEIT] a shared entry_reference split over two pages keeps both", () => {
  // getTransactions concatenates the pages, so what reaches the mapper is one array — the case
  // matters because the two halves never meet inside one page and nothing upstream compares them.
  const page1 = [booked({ ref: "0000000000", amount: "75.00", date: "2026-09-10", text: "Tankstation", party: "Shell 123" })];
  const page2 = [booked({ ref: "0000000000", amount: "92.40", date: "2026-09-11", text: "Tankstation", party: "Shell 456" })];
  const { rows } = ingest([...page1, ...page2]);

  assert.equal(rows.length, 2);
  const pairs = identityPairs(rows);
  assert.equal(new Set(pairs).size, pairs.length, "the second page's transaction collides with the first page's");
});

// ── 4. A later overlapping window ────────────────────────────────────────────────────────────
test("[EB-IDENTITEIT] a new transaction reusing a stored entry_reference still arrives", () => {
  // SYNC_OVERLAP_DAYS deliberately re-asks for days already imported. The old line must be
  // recognised (skipped) and the NEW one must be written, even though they share an id.
  const first = ingest([booked({ ref: "SHARED", amount: "200.00", date: "2026-09-01", text: "Termijn 1", party: "Klant A" })]);
  const stored = storedFrom(first.rows);

  const overlap = ingest(
    [
      booked({ ref: "SHARED", amount: "200.00", date: "2026-09-01", text: "Termijn 1", party: "Klant A" }),
      booked({ ref: "SHARED", amount: "350.00", date: "2026-09-05", text: "Termijn 2", party: "Klant A" }),
    ],
    stored,
  );

  assert.equal(overlap.dd.skipped, 1, "the already-imported line was not recognised");
  assert.equal(overlap.rows.length, 1, "the genuinely new transaction did not survive the overlap window");
  assert.equal(overlap.rows[0].amount, 350);
});

// ── 5. Multiset semantics ────────────────────────────────────────────────────────────────────
test("[EB-IDENTITEIT] two legitimate identical movements are two rows, not one", () => {
  // Same day, same amount, same counterpart, no distinguishing reference: a real pattern (two
  // identical top-ups). Collapsing them under-states the owner's money, which is the error
  // direction this repo refuses.
  const { rows } = ingest([
    booked({ ref: null, amount: "50.00", date: "2026-09-12", text: "Tegoed", party: "Kiosk" }),
    booked({ ref: null, amount: "50.00", date: "2026-09-12", text: "Tegoed", party: "Kiosk" }),
  ]);
  assert.equal(rows.length, 2, "two real movements collapsed into one");
});

// ── 7. The other doors are untouched ─────────────────────────────────────────────────────────
test("[EB-IDENTITEIT] a proven-unique file source keeps its identity dedup", () => {
  // MT940/CAMT ids are proven unique per statement and MUST keep their silent-skip authority:
  // this is the layer that makes a re-uploaded statement cheap. Nothing here may weaken it.
  const fileSource = "MT940:NL91ABNA0417164300";
  const tx = {
    date: "2026-09-02", amount: 100, description: "Factuur 7", counterpartName: "Klant",
    counterpartIban: null, reference: null, transactionId: "STMT-001-7",
  } as unknown as Parameters<typeof dedupTransactions>[0][number];

  const fresh = dedupTransactions([tx], [], fileSource);
  assert.equal(fresh.toInsert.length, 1);
  const rows = mapToRows(fresh.toInsert, USER, fileSource);
  assert.equal(rows[0].external_id, "STMT-001-7", "the file door lost its source identity");

  const stored = [{
    date: "2026-09-02", amount: 100, description: "IETS ANDERS", counterpart_name: null,
    counterpart_iban: null, source: fileSource, external_id: "STMT-001-7",
  }] as unknown as ExistingTxKey[];
  const repeat = dedupTransactions([tx], stored, fileSource);
  assert.equal(repeat.toInsert.length, 0, "a re-uploaded statement line is no longer recognised by its id");
  assert.equal(repeat.skipped, 1);
});

// ── [EB-TESTER] Who may reach a bank with these credentials ──────────────────────────────────
//
// A separate question from "are the credentials present", and the two must never merge: the
// callback has no browsing user to ask about, and it is precisely the door where ownership may
// not come from the request. It asks about the user_id on the connection row it found by state.
test("[EB-TESTER] an empty or absent list allows nobody", () => {
  for (const env of [envWith(undefined), envWith(""), envWith("   ")]) {
    assert.equal(canUseEnableBanking(USER, env), false,
      "an unset tester list let someone through — one forgotten variable and the Sandbox is public");
  }
});

test("[EB-TESTER] only a listed user id passes, and identity is compared case-insensitively", () => {
  const env = envWith(`other-id, ${USER.toUpperCase()}`);
  assert.equal(canUseEnableBanking(USER, env), true, "the listed tester was refused");
  assert.equal(canUseEnableBanking("22222222-2222-2222-2222-222222222222", env), false,
    "an account outside the list reached the bank");
  assert.equal(canUseEnableBanking(null, env), false);
  assert.equal(canUseEnableBanking("", env), false);
  assert.equal(canUseEnableBanking("   ", env), false);
});

test("[EB-TESTER] the list accepts what a dashboard paste actually looks like", () => {
  const env = envWith(`\n${USER};  other-id\n\n`);
  assert.equal(canUseEnableBanking(USER, env), true);
  assert.deepEqual([...enableBankingTesters(env)].sort(), ["other-id", USER].sort());
});

test("[EB-TESTER] configuration and authorization stay two questions", () => {
  // isEnableBankingConfigured must not learn about users: the callback calls one and not the
  // other, and a helper that answered both would have to invent a user to answer at all.
  assert.equal(isEnableBankingConfigured(envWith(undefined)), false);
  assert.equal(
    isEnableBankingConfigured(envWith(USER)),
    false,
    "a tester list made the integration look configured",
  );
});
