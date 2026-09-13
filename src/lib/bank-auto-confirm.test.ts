// src/lib/bank-auto-confirm.test.ts
// [AUTO-BEVESTIG-GETEST] The pass that books the money, driven end to end.
//
// Run: npx tsx --test src/lib/bank-auto-confirm.test.ts
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
// runBankAutoConfirm is the only code in this app that moves money with nobody watching: it runs
// from cron, from intake, from an e-mail arriving. Until now no test had ever CALLED it. The pure
// parts underneath were well covered — planBatchAutoConfirm, scorePair, applyConfidenceVeto all
// have their own suites — but the COMPOSITION was covered by nothing, and the composition is where
// the order of the passes lives.
//
// That mattered, because the order is the safety property. [BANK-BATCH-FIRST] says the batch pass
// runs before the scored 1:1 pass, and the reason is written in the file: a same-supplier
// same-amount solo line could otherwise claim an invoice that a printed-number bundle provably
// owns — the bundle then never ties, and its invoice sits linked to the wrong payment. Before this
// file, swapping those two blocks broke nothing that any gate could see.
//
// ── HOW IT RUNS WITHOUT A DATABASE ──────────────────────────────────────────────────────────
// Both clients are arguments, so the pass takes a fake. The fake answers reads from a table map
// and RECORDS every write, which is what the assertions read: not "did it return something" but
// "which invoice did it mark paid, against which bank line".

import test from "node:test";
import assert from "node:assert/strict";

import { runBankAutoConfirm } from "./bank-auto-confirm";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

interface Recorded {
  updates: { table: string; patch: Row }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

/**
 * The smallest thing that behaves like the Supabase client this pass uses: chainable filters that
 * resolve to the table's rows, `.maybeSingle()` for the one profile read, and `.update()` /
 * `.rpc()` recorded rather than performed.
 *
 * Deliberately NOT a filter engine. It returns the whole table and lets the pass do its own
 * filtering in TypeScript, so a test that passes here is a test about the PASS's logic and not
 * about how faithfully a hand-written fake reimplements PostgREST.
 */
function fakeClient(tables: Tables, rec: Recorded, opts: { rpcRows?: (args: Record<string, unknown>) => Row[] } = {}) {
  const builder = (table: string) => {
    let pendingPatch: Row | null = null;
    const rows = () => tables[table] ?? [];
    const settle = (): { data: Row[]; error: null } => {
      if (pendingPatch) rec.updates.push({ table, patch: pendingPatch });
      // An update with .select() must return a row or the pass reads it as "someone else got there
      // first" and rolls back — the branch that would silently swallow every booking.
      return { data: pendingPatch ? [{ id: "written" }] : rows(), error: null };
    };
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "or", "is", "not", "in", "order", "limit", "gte", "lte", "lt", "gt"]) {
      self[m] = () => self;
    }
    self.update = (patch: Row) => { pendingPatch = patch; return self; };
    self.range = (from: number, to: number) => ({
      then: (res: (v: { data: Row[]; error: null }) => unknown) =>
        res({ data: rows().slice(from, to + 1), error: null }),
    });
    self.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    self.then = (res: (v: { data: Row[]; error: null }) => unknown) => res(settle());
    return self;
  };
  return {
    from: (t: string) => builder(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      rec.rpcs.push({ name, args });
      return Promise.resolve({ data: opts.rpcRows ? opts.rpcRows(args) : [], error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const LEVERANCIER = "Groothandel De Vries";
const inkoop = (id: string, nummer: string, bedrag: number, status = "received"): Row => ({
  id, invoice_number: nummer, total_inc_btw: bedrag, invoice_date: "2026-09-01", due_date: "2026-09-30",
  client_name: LEVERANCIER, direction: "incoming", status, accountant_status: null,
  vendor_iban: null, payment_reference: null, amount_paid: 0, payment_prepared_at: null, supplier_id: null,
});
const lijn = (id: string, bedrag: number, omschrijving: string, over: Row = {}): Row => ({
  id, date: "2026-09-10", amount: bedrag, description: omschrijving, counterpart_name: LEVERANCIER,
  counterpart_iban: null, reference: null, invoice_id: null, status: "pending", ...over,
});

async function draai(tables: Tables, opts?: { rpcRows?: (a: Record<string, unknown>) => Row[] }) {
  const rec: Recorded = { updates: [], rpcs: [] };
  const client = fakeClient(tables, rec, opts);
  const confirmed = await runBankAutoConfirm({ payClient: client, pipeline: client, userId: "u1" });
  return { confirmed, rec };
}

test("[BANK-BATCH-FIRST] a bundle claims its invoices before a solo line can take one", async () => {
  // The exact shape the ordering rule was written for. The debit of € 1.000 prints both numbers and
  // ties to the cent; the € 600 debit is the same supplier and the same amount as one of them, with
  // nothing quoted.
  //
  // Batch first  → the bundle books 401 + 402, and the solo has nothing left to take. Correct.
  // 1:1 first    → the solo takes 402 on amount+name alone, the bundle can no longer tie (only 401
  //                remains, € 400 ≠ € 1.000), and € 600 of a real payment sits on the wrong line
  //                while the bundle stays 'incomplete' forever.
  const { confirmed, rec } = await draai(
    {
      profiles: [{ vat_scheme: "factuur", vat_scheme_since: null }],
      btw_filings: [],
      bank_transactions: [
        lijn("tx-bundel", -1000, "Betaling facturen 2026-401 en 2026-402"),
        lijn("tx-solo", -600, "Overboeking"),
      ],
      invoices: [inkoop("inv-401", "2026-401", 400), inkoop("inv-402", "2026-402", 600)],
    },
    { rpcRows: (a) => (a.p_invoice_ids as string[]).map((id) => ({ invoice_id: id })) },
  );

  const bundel = confirmed.filter((c) => c.transactionId === "tx-bundel").map((c) => c.invoiceId).sort();
  assert.deepStrictEqual(bundel, ["inv-401", "inv-402"],
    "the printed-number bundle did not book both of its invoices");
  assert.deepStrictEqual(confirmed.filter((c) => c.transactionId === "tx-solo"), [],
    "the solo line claimed an invoice the bundle provably owns — the batch pass is no longer first");
  // And it went through the atomic RPC, not through two separate writes.
  assert.deepStrictEqual(rec.rpcs.map((r) => r.name), ["book_bank_batch"]);
  assert.deepStrictEqual((rec.rpcs[0]!.args.p_invoice_ids as string[]).sort(), ["inv-401", "inv-402"]);
  // A batch tie is 'certain' by construction; nothing here may be booked as a guess.
  assert.deepStrictEqual([...new Set(confirmed.map((c) => c.tier))], ["certain"]);
  // The settlement date is the BANK LINE's date, never "today" — it decides the quarter.
  assert.deepStrictEqual([...new Set(confirmed.map((c) => c.paymentDate))], ["2026-09-10"]);
});

test("[BUNDEL-DREMPEL] a draft invoice is not payable, not even inside a perfect tie", async () => {
  // Same cent-exact bundle, except 2026-402 was never issued. The arithmetic still works; the
  // document is not a bill yet, so nothing may book — and 401 must not book alone either, because
  // the payment was for both.
  const { confirmed, rec } = await draai(
    {
      profiles: [{ vat_scheme: "factuur", vat_scheme_since: null }],
      btw_filings: [],
      bank_transactions: [lijn("tx-bundel", -1000, "Betaling facturen 2026-401 en 2026-402")],
      invoices: [inkoop("inv-401", "2026-401", 400), inkoop("inv-402", "2026-402", 600, "draft")],
    },
    { rpcRows: (a) => (a.p_invoice_ids as string[]).map((id) => ({ invoice_id: id })) },
  );
  assert.deepStrictEqual(confirmed, [], "a draft was settled by a bank payment");
  assert.deepStrictEqual(rec.rpcs, [], "the batch RPC was called with an unpayable invoice in it");
});

test("[BANK-PARTLY-CONSUMED] a line that already paid something is left alone", async () => {
  // A pending bank line carrying an invoice_id has already spent part of itself. The 1:1 pass books
  // the FULL amount against another invoice with no idea what it already settled — the same euros
  // counted twice — so such a line must not be matched at all.
  const { confirmed, rec } = await draai({
    profiles: [{ vat_scheme: "factuur", vat_scheme_since: null }],
    btw_filings: [],
    bank_transactions: [lijn("tx-half", -400, "Overboeking", { invoice_id: "inv-eerder" })],
    invoices: [inkoop("inv-401", "2026-401", 400)],
  });
  assert.deepStrictEqual(confirmed, [], "a partly-consumed bank line was spent a second time");
  assert.deepStrictEqual(rec.updates, [], "something was written for a line that should have been skipped");
});

test("[AUTO-BEVESTIG-GETEST] nothing to do is not an error, and writes nothing", async () => {
  // The everyday case, and the one that must never write: it runs on every intake.
  const leeg = await draai({
    profiles: [{ vat_scheme: "factuur", vat_scheme_since: null }],
    btw_filings: [], bank_transactions: [], invoices: [],
  });
  assert.deepStrictEqual(leeg.confirmed, []);
  assert.deepStrictEqual(leeg.rec.updates, []);
  assert.deepStrictEqual(leeg.rec.rpcs, []);
});
