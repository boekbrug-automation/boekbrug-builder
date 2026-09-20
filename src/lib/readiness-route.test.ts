// [READINESS-DEGRADE] Route-level test — run: npx tsx --test src/lib/readiness-route.test.ts
//
// "Availability may degrade. Financial truth may not." (audit KL-01)
//
// /api/readiness makes ~22 reads and used to let most of them fail into their zero: no gaps, no
// flags, KOR off, nothing excluded, no card mismatch — and then judged the quarter, sometimes green,
// over data nobody read. This test runs the REAL route (readinessResponse, with its two clients
// injected) against a fake PostgREST that holds a READY quarter, and then fails every read on its
// own. What each failure must do is the contract written in the route's header:
//
//   A · essential  → 503, no verdict at all;
//   B · supplemental → 200, but `ready` is false, `verified` is false, the unread input is named;
//   C · a column or table the schema does not have yet → the zero is the truth: still ready.
//
// Not a unit test of buildReadiness (readiness.test.ts has those): the point is that each read in
// the ROUTE reaches the verdict the way the classification says, including the reads that live
// inside the helpers it calls (the closing summary, the collectors, the witnesses).

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { readinessResponse, type ReadinessDeps } from "../app/api/readiness/route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const YEAR = 2026;
const QUARTER = 2; // Q2 2026 — completed long before this test can run, so it has certainly started

// ── A fake PostgREST: rows per table, simple filters, and failures injected per read ────────────

type Row = Record<string, unknown>;
interface Filter { op: string; col: string; val: unknown }
interface Query { table: string; select: string; filters: Filter[]; head: boolean; single: boolean; write: boolean }
interface Failure { table: string; when?: (q: Query) => boolean; error: { message: string; code?: string } }

const str = (v: unknown) => (v == null ? null : String(v));

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) => filters.every((f) => {
    const v = r[f.col];
    switch (f.op) {
      case "eq": return f.val == null ? v == null : str(v) === str(f.val);
      case "neq": return str(v) !== str(f.val);
      case "is": return f.val === null ? v == null : v === f.val;
      case "not_is": return f.val === null ? v != null : v !== f.val;
      case "in": return (f.val as unknown[]).map(str).includes(str(v));
      case "gte": return v != null && String(v) >= String(f.val);
      case "lte": return v != null && String(v) <= String(f.val);
      case "gt": return v != null && String(v) > String(f.val);
      case "lt": return v != null && String(v) < String(f.val);
      case "or": {
        // "a.eq.x,b.eq.y" — any of the clauses; enough for every .or() on this route.
        return String(f.val).split(",").some((clause) => {
          const [col, op, ...rest] = clause.split(".");
          const val = rest.join(".");
          return applyFilters([r], [{ op, col, val }]).length === 1;
        });
      }
      default: return true;
    }
  }));
}

function makeFake(tables: Record<string, Row[]>, failures: Failure[] = [], seen: Query[] = []) {
  const builder = (table: string) => {
    const q: Query = { table, select: "*", filters: [], head: false, single: false, write: false };
    let order: { col: string; asc: boolean } | null = null;
    let range: [number, number] | null = null;
    let limit: number | null = null;
    const self: Record<string, unknown> = {};
    const chain = (fn: () => void) => { fn(); return self; };
    Object.assign(self, {
      select: (cols = "*", opts?: { count?: string; head?: boolean }) => chain(() => { q.select = cols; q.head = !!opts?.head; }),
      eq: (col: string, val: unknown) => chain(() => q.filters.push({ op: "eq", col, val })),
      neq: (col: string, val: unknown) => chain(() => q.filters.push({ op: "neq", col, val })),
      is: (col: string, val: unknown) => chain(() => q.filters.push({ op: "is", col, val })),
      not: (col: string, op: string, val: unknown) => chain(() => q.filters.push({ op: `not_${op}`, col, val })),
      in: (col: string, val: unknown[]) => chain(() => q.filters.push({ op: "in", col, val })),
      gte: (col: string, val: unknown) => chain(() => q.filters.push({ op: "gte", col, val })),
      lte: (col: string, val: unknown) => chain(() => q.filters.push({ op: "lte", col, val })),
      gt: (col: string, val: unknown) => chain(() => q.filters.push({ op: "gt", col, val })),
      lt: (col: string, val: unknown) => chain(() => q.filters.push({ op: "lt", col, val })),
      or: (expr: string) => chain(() => q.filters.push({ op: "or", col: "", val: expr })),
      order: (col: string, opts?: { ascending?: boolean }) => chain(() => { order = { col, asc: opts?.ascending !== false }; }),
      range: (from: number, to: number) => chain(() => { range = [from, to]; }),
      limit: (n: number) => chain(() => { limit = n; }),
      maybeSingle: () => chain(() => { q.single = true; }),
      single: () => chain(() => { q.single = true; }),
      upsert: () => chain(() => { q.write = true; }),
      insert: () => chain(() => { q.write = true; }),
      update: () => chain(() => { q.write = true; }),
      delete: () => chain(() => { q.write = true; }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        seen.push(q);
        const failure = failures.find((f) => f.table === table && (!f.when || f.when(q)));
        let result: unknown;
        if (failure) {
          result = { data: null, error: failure.error, count: null };
        } else if (q.write) {
          result = { data: null, error: null };
        } else {
          let rows = applyFilters(tables[table] ?? [], q.filters);
          if (order) rows = [...rows].sort((a, b) => (str(a[order!.col]) ?? "").localeCompare(str(b[order!.col]) ?? "") * (order!.asc ? 1 : -1));
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (limit != null) rows = rows.slice(0, limit);
          result = q.head
            ? { data: null, error: null, count: rows.length }
            : q.single
              ? { data: rows[0] ?? null, error: null }
              : { data: rows, error: null, count: rows.length };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    });
    return self;
  };
  return { from: builder, seen };
}

// ── The READY quarter ───────────────────────────────────────────────────────────────────────────

// Sales well above the KOR yardstick (€20.000/year), so the baseline carries no KOR risk: a risk
// caps the score at 99 by design, and this test wants a clean 100 to measure every failure against.
const invoice = (over: Row): Row => ({
  id: "inv-x", invoice_number: "F-2026-000", client_name: "Klant", status: "sent", direction: "outgoing",
  invoice_type: "factuur", tax_kind: null, total_ex_btw: 12000, btw_amount: 2520, total_inc_btw: 14520,
  invoice_date: "2026-04-10", due_date: "2026-05-10", pdf_url: "https://files.invalid/x.pdf", document_id: null,
  client_btw_number: null, supplier_id: null, client_address: null, client_postal_code: null, client_city: null,
  marked_paid_at: null, payment_method: null, payment_date: null, source: null, sender_id: OWNER, receiver_id: null,
  field_confidence: null, discount_type: null, discount_value: null, original_invoice_id: null, amount_paid: 0,
  vat_deduction: null, created_at: "2026-04-10T10:00:00Z", ...over,
});

function readyTables(): Record<string, Row[]> {
  return {
    profiles: [{ id: OWNER, role: "zzper", kor_active: false, vat_scheme: "factuur", vat_scheme_since: null, vat_exempt_activity: false, vat_exempt_since: null, kas_opening_balance: 0 }],
    invoices: [
      invoice({ id: "inv-1", invoice_number: "F-2026-001", client_name: "Klant A" }),
      invoice({ id: "inv-2", invoice_number: "F-2026-002", client_name: "Klant B", invoice_date: "2026-05-20", due_date: "2026-06-19" }),
      invoice({ id: "inv-in-1", invoice_number: "LEV-77", client_name: "Leverancier B", status: "received", direction: "incoming", sender_id: null, receiver_id: OWNER, pdf_url: null, document_id: "doc-1", total_ex_btw: 50, btw_amount: 10.5, total_inc_btw: 60.5, invoice_date: "2026-05-02", due_date: "2026-06-01" }),
    ],
    documents: [{ id: "doc-1", user_id: OWNER, file_url: "https://files.invalid/doc-1.pdf", file_name: "bon.pdf", doc_type: "inkoop", period: null, trashed: false, created_at: "2026-05-02T10:00:00Z" }],
    bank_transactions: [
      { id: "bt-1", user_id: OWNER, amount: -60.5, category: "kosten", category_confirmed: true, invoice_id: "inv-in-1", date: "2026-05-05", status: "matched", description: "Leverancier B", counterpart_name: "Leverancier B", auto_match_reason: null, ignore_reason: null },
      { id: "bt-2", user_id: OWNER, amount: 14520, category: null, category_confirmed: null, invoice_id: "inv-1", date: "2026-04-20", status: "matched", description: "Klant A", counterpart_name: "Klant A", auto_match_reason: null, ignore_reason: null },
    ],
    daily_turnover: [], eft_settlements: [], ledger_daily: [], cash_entries: [], invoice_lines: [],
    bank_statement_periods: [], bank_tx_invoices: [], readiness_cache: [],
  };
}

const session = (userId: string | null = OWNER) => ({
  auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  from: () => { throw new Error("the session client is only for who-is-asking here"); },
}) as unknown as ReadinessDeps["session"];

async function run(opts: { failures?: Failure[]; tables?: Record<string, Row[]>; query?: string; userId?: string | null } = {}) {
  const fake = makeFake(opts.tables ?? readyTables(), opts.failures ?? []);
  const req = new NextRequest(`http://localhost/api/readiness?${opts.query ?? `year=${YEAR}&quarter=${QUARTER}`}`);
  const res = await readinessResponse(req, { session: session(opts.userId === undefined ? OWNER : opts.userId), pipeline: () => fake as unknown as ReturnType<ReadinessDeps["pipeline"]> });
  const body = await res.json();
  return { status: res.status, body, seen: fake.seen };
}

const quiet = () => { const orig = console.error; console.error = () => {}; return () => { console.error = orig; }; };

// ── Baseline ────────────────────────────────────────────────────────────────────────────────────

test("[READINESS-DEGRADE] the baseline quarter is READY, verified, 100%", async () => {
  const { status, body, seen } = await run();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.report.ready, true);
  assert.equal(body.report.verified, true);
  assert.equal(body.report.score, 100);
  assert.deepEqual(body.report.unverified, []);
  // The inventory this test exists for: every table the verdict read. Listed so a new read that
  // arrives later shows up here first.
  const tables = [...new Set(seen.filter((q) => !q.write).map((q) => q.table))].sort();
  assert.deepEqual(tables, ["bank_statement_periods", "bank_transactions", "cash_entries", "daily_turnover", "documents", "eft_settlements", "invoice_lines", "invoices", "profiles"]);
});

test("[READINESS-DEGRADE] nobody logged in → 401; a period that has not begun → 400, no verdict", async () => {
  assert.equal((await run({ userId: null })).status, 401);
  const future = await run({ query: "year=2100&quarter=4" });
  assert.equal(future.status, 400);
  assert.equal(future.body.error, "period_not_started");
  assert.equal(future.body.report, undefined, "no verdict travels with a refusal");
});

// ── Class B: the page stays up, the verdict is never green ─────────────────────────────────────

const boom = { message: "connection reset", code: "08006" };

async function expectIncomplete(name: string, key: string, failures: Failure[], tables?: Record<string, Row[]>) {
  const restore = quiet();
  try {
    const { status, body } = await run({ failures, tables });
    assert.equal(status, 200, `${name}: the page stays available (${JSON.stringify(body)})`);
    const r = body.report;
    assert.equal(r.ready, false, `${name}: ready must be false`);
    assert.notEqual(r.status, "ready", `${name}: status must not be ready`);
    assert.equal(r.verified, false, `${name}: verified must be false`);
    assert.ok(r.unverified.some((u: { key: string }) => u.key === key), `${name}: the unread input ${key} must be named — got ${JSON.stringify(r.unverified)}`);
    assert.equal(r.missing[0]?.title, "Niet alles kon worden gecontroleerd", `${name}: the gap is named first`);
    assert.ok(r.score < 100, `${name}: never a perfect score beside an unread input`);
    assert.equal(r.dimensions.length, 4, `${name}: the measured dimensions stay on the screen`);
  } finally { restore(); }
}

test("[READINESS-DEGRADE] B · the evidence lookup fails → unknown, not missing, and not ready", async () => {
  await expectIncomplete("evidence", "evidence", [{ table: "documents", when: (q) => /file_url/.test(q.select) && q.filters.some((f) => f.op === "in"), error: boom }]);
  const restore = quiet();
  try {
    const { body } = await run({ failures: [{ table: "documents", when: (q) => /file_url/.test(q.select) && q.filters.some((f) => f.op === "in"), error: boom }] });
    assert.ok(!body.report.missing.some((m: { title: string }) => /missen het originele document/.test(m.title)), "the invoice we could not look at is not accused");
  } finally { restore(); }
});

test("[READINESS-DEGRADE] B · the dateless-invoice check inside the summary fails → not ready, no invented risk", async () => {
  const when = (q: Query) => /pdf_url/.test(q.select) && q.filters.some((f) => f.op === "is" && f.col === "invoice_date");
  await expectIncomplete("dateless", "dateless_invoices", [{ table: "invoices", when, error: boom }]);
  const restore = quiet();
  try {
    const { body } = await run({ failures: [{ table: "invoices", when, error: boom }] });
    assert.ok(!body.report.risks.some((m: { title: string }) => /zonder datum|datum/.test(m.title)), "a check that did not run claims no dateless invoice");
  } finally { restore(); }
});

test("[READINESS-DEGRADE] B · the amount-only booking count fails → not zero reviews", async () => {
  await expectIncomplete("amount-only", "amount_only_bookings", [{ table: "bank_transactions", when: (q) => q.filters.some((f) => f.col === "auto_match_reason"), error: boom }]);
});

test("[READINESS-DEGRADE] B · the statement continuity read fails → not 'no gaps'", async () => {
  await expectIncomplete("continuity", "bank_continuity", [{ table: "bank_statement_periods", when: (q) => !q.filters.some((f) => f.col === "period_end"), error: boom }]);
});

test("[READINESS-DEGRADE] B · the statement coverage read fails → not 'covered'", async () => {
  await expectIncomplete("coverage", "bank_coverage", [{ table: "bank_statement_periods", when: (q) => q.filters.some((f) => f.col === "period_end"), error: boom }]);
});

test("[READINESS-DEGRADE] B · the exemption regime read fails → not 'regime off'", async () => {
  await expectIncomplete("exemption", "vat_exemption", [{ table: "profiles", when: (q) => /vat_exempt_activity/.test(q.select), error: boom }]);
});

test("[READINESS-DEGRADE] B · the rate-split read fails → not 'single rate'", async () => {
  await expectIncomplete("rate split", "rate_split", [{ table: "invoice_lines", when: (q) => /btw_rate/.test(q.select), error: boom }]);
});

test("[READINESS-DEGRADE] B · the excluded-bank-lines read fails → not 'nothing excluded'", async () => {
  await expectIncomplete("excluded", "excluded_bank_lines", [{ table: "bank_transactions", when: (q) => /ignore_reason/.test(q.select), error: boom }]);
});

test("[READINESS-DEGRADE] B · the regime line read fails → not 'no verlegd, no marge'", async () => {
  await expectIncomplete("regime", "regime_lines", [{ table: "invoice_lines", when: (q) => /description/.test(q.select), error: boom }]);
});

test("[READINESS-DEGRADE] B · the bad-debt and clawback reads fail → not 'none'", async () => {
  await expectIncomplete("bad debt", "bad_debt", [{ table: "invoices", when: (q) => q.filters.some((f) => f.col === "sender_id" && f.op === "eq") && q.filters.some((f) => f.col === "status" && f.op === "in"), error: boom }]);
  await expectIncomplete("clawback", "vat_clawback", [{ table: "invoices", when: (q) => q.filters.some((f) => f.col === "receiver_id" && f.op === "eq") && q.filters.some((f) => f.col === "status" && f.op === "eq" && f.val === "received"), error: boom }]);
});

test("[READINESS-DEGRADE] B · with a till, a failed terminal witness is not 'no card mismatch'", async () => {
  const tables = readyTables();
  tables.daily_turnover = [{ user_id: OWNER, turnover_date: "2026-05-05", base_0: 0, base_9: 0, base_21: 100, btw_9: 0, btw_21: 21, total_incl: 121, pin_amount: 0, cash_amount: 121, other_amount: 0 }];
  await expectIncomplete("triangle", "card_triangle", [{ table: "eft_settlements", when: (q) => /gross_total/.test(q.select), error: boom }], tables);
});

// ── Class C: the schema does not have it yet — the zero is the truth ───────────────────────────

const absentColumn = (column: string) => ({ message: `column bank_transactions.${column} does not exist`, code: "42703" });
const absentTable = { message: 'relation "public.bank_statement_periods" does not exist', code: "42P01" };

test("[READINESS-DEGRADE] C · a column whose absence proves non-applicability leaves the verdict ready", async () => {
  // Only these two: nothing can have been booked under auto_match_reason, and nothing excluded
  // under ignore_reason, before those columns existed. The zero is the truth there.
  const restore = quiet();
  try {
    for (const [name, failures] of [
      ["auto_match_reason absent", [{ table: "bank_transactions", when: (q: Query) => q.filters.some((f) => f.col === "auto_match_reason"), error: absentColumn("auto_match_reason") }]],
      ["ignore_reason absent", [{ table: "bank_transactions", when: (q: Query) => /ignore_reason/.test(q.select), error: absentColumn("ignore_reason") }]],
    ] as const) {
      const { status, body } = await run({ failures: [...failures] });
      assert.equal(status, 200, name);
      assert.equal(body.report.ready, true, `${name}: pre-migration, the zero is the truth`);
      assert.equal(body.report.verified, true, name);
    }
  } finally { restore(); }
});

test("[READINESS-DEGRADE] schema absence that proves nothing is NOT class C", async () => {
  // An absent evidence table does not mean the statements connect — they may have been imported
  // before the table existed. Class B: the page stays up, the verdict is incomplete, never green.
  await expectIncomplete("bank_statement_periods absent", "bank_continuity", [{ table: "bank_statement_periods", error: absentTable }]);
  await expectIncomplete("bank_statement_periods absent (coverage)", "bank_coverage", [{ table: "bank_statement_periods", error: absentTable }]);
  // An absent kor_active column does not mean KOR is off — this deployment cannot determine the
  // KOR state, and the KOR state decides the concept's figures. Class A: no verdict at all.
  const restore = quiet();
  try {
    const { status, body } = await run({ failures: [{ table: "profiles", when: (q: Query) => /kor_active/.test(q.select), error: { message: "column profiles.kor_active does not exist", code: "42703" } }] });
    assert.equal(status, 503, JSON.stringify(body));
    assert.equal(body.error, "readiness_unavailable");
    assert.equal(body.report, undefined, "no verdict travels with a refusal");
  } finally { restore(); }
});

// ── Class A: no verdict at all ─────────────────────────────────────────────────────────────────

test("[READINESS-DEGRADE] A · an essential read fails → 503 and no verdict", async () => {
  const restore = quiet();
  try {
    for (const [name, failures] of [
      ["the quarter's invoices", [{ table: "invoices", when: (q: Query) => /field_confidence, tax_kind/.test(q.select), error: boom }]],
      ["the summary's invoices", [{ table: "invoices", when: (q: Query) => /pdf_url/.test(q.select) && !q.filters.some((f) => f.op === "is"), error: boom }]],
      ["the bank lines", [{ table: "bank_transactions", when: (q: Query) => /counterpart_name/.test(q.select), error: boom }]],
      ["the cash movements", [{ table: "cash_entries", when: (q: Query) => /btw_rate/.test(q.select), error: boom }]],
      ["the turnover", [{ table: "daily_turnover", error: boom }]],
      ["the KOR flag", [{ table: "profiles", when: (q: Query) => /kor_active/.test(q.select), error: boom }]],
      ["the VAT basis (scheme)", [{ table: "profiles", when: (q: Query) => /vat_scheme/.test(q.select), error: boom }]],
      ["the route's own dateless read", [{ table: "invoices", when: (q: Query) => /^status, receiver_id, direction$/.test(q.select), error: boom }]],
      ["the drawer's opening balance", [{ table: "profiles", when: (q: Query) => /kas_opening_balance/.test(q.select), error: boom }]],
    ] as const) {
      const { status, body } = await run({ failures: [...failures] });
      assert.equal(status, 503, `${name}: ${JSON.stringify(body)}`);
      assert.equal(body.error, "readiness_unavailable", name);
      assert.equal(body.report, undefined, `${name}: no verdict travels with a refusal`);
    }
  } finally { restore(); }
});

test("[READINESS-DEGRADE] the cache write is not a read: its failure changes nothing about the verdict", async () => {
  const orig = console.warn; console.warn = () => {};
  try {
    const { status, body } = await run({ failures: [{ table: "readiness_cache", error: boom }] });
    assert.equal(status, 200);
    assert.equal(body.report.ready, true);
    assert.equal(body.report.verified, true);
  } finally { console.warn = orig; }
});
