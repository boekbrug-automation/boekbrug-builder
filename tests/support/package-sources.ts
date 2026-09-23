// tests/support/package-sources.ts
// [PACKAGE-FAIL-CLOSED] Each read the quarter package makes, recognisable in the fake client by its
// table plus what it selects or filters on. One name per read, so a test can fail exactly one.
//
// The names are the source names the builder reports (ClosingPackageSourceUnavailableError.source,
// summary.unreadSources). A read that is not listed here is one the package deliberately survives:
// see the classification at the top of the fail-closed section in src/lib/closing-package.ts.

import type { Failure, Query } from "./package-fake-db";

const has = (q: Query, op: string, col: string, val?: unknown) =>
  q.filters.some((f) => f.op === op && f.col === col && (val === undefined || f.val === val));

interface SourceRead {
  table: string;
  when: (q: Query) => boolean;
}

export const SOURCE_READS = {
  invoices: { table: "invoices", when: (q) => has(q, "gte", "invoice_date") },
  purchase_evidence: { table: "documents", when: (q) => has(q, "in", "id") },
  bank_statement_files: { table: "documents", when: (q) => has(q, "eq", "doc_type", "bankafschrift") },
  bank_coverage: { table: "bank_transactions", when: (q) => q.select === "id" && q.limit === 1 },
  bank_transactions: { table: "bank_transactions", when: (q) => /counterpart_name, reference, status/.test(q.select) },
  bank_cost_lines: { table: "bank_transactions", when: (q) => has(q, "eq", "category", "kosten") && has(q, "lt", "amount") },
  unresolved_bank_lines: { table: "bank_transactions", when: (q) => has(q, "is", "category", null) && has(q, "eq", "status", "pending") },
  excluded_bank_lines: { table: "bank_transactions", when: (q) => /ignore_reason/.test(q.select) },
  pos_income: { table: "bank_transactions", when: (q) => has(q, "eq", "category", "pos_income") },
  cash_turnover: { table: "cash_entries", when: (q) => has(q, "eq", "category", "omzet") },
  cash_entries: { table: "cash_entries", when: (q) => /btw_rate, entry_date, document_id/.test(q.select) },
  kasboek_entries: { table: "cash_entries", when: (q) => /entry_date, direction, amount, category, description/.test(q.select) },
  daily_turnover: { table: "daily_turnover", when: (q) => /base_0/.test(q.select) },
  kasboek_turnover: { table: "daily_turnover", when: (q) => q.select === "turnover_date, cash_amount" },
  eft_settlements: { table: "eft_settlements", when: (q) => /gross_total/.test(q.select) },
  eft_presence: { table: "eft_settlements", when: (q) => q.select === "id" },
  pin_ledger: { table: "ledger_daily", when: () => true },
  kor: { table: "profiles", when: (q) => q.select === "kor_active" },
  kas_opening_balance: { table: "profiles", when: (q) => q.select === "kas_opening_balance" },
  vat_exemption: { table: "profiles", when: (q) => /vat_exempt_activity/.test(q.select) },
  vat_scheme: { table: "profiles", when: (q) => /vat_scheme/.test(q.select) },
  rate_split: { table: "invoice_lines", when: (q) => q.select.startsWith("invoice_id, btw_rate, line_total") },
  regime_lines: { table: "invoice_lines", when: (q) => q.select === "invoice_id, description" },
  vat_clawback: { table: "invoices", when: (q) => has(q, "eq", "receiver_id") && has(q, "eq", "status", "received") },
  bad_debt: { table: "invoices", when: (q) => has(q, "eq", "sender_id") && has(q, "in", "status") },
  supplier_countries: { table: "suppliers", when: () => true },
  bank_statement_periods: { table: "bank_statement_periods", when: () => true },
} satisfies Record<string, SourceRead>;

export type SourceName = keyof typeof SOURCE_READS;

/** Fail one read: `{ error }` like PostgREST, or a rejected await like a dropped connection. */
export function failRead(name: SourceName, mode: "error" | "throw" = "error"): Failure {
  const r: SourceRead = SOURCE_READS[name];
  return { table: r.table, when: r.when, mode };
}

/** Fail only the SECOND page of a paged read: page one arrives, the rest does not. */
export function failSecondPage(name: SourceName, mode: "error" | "throw" = "error"): Failure {
  const r: SourceRead = SOURCE_READS[name];
  return { table: r.table, when: (q) => r.when(q) && q.range?.[0] === 1000, mode };
}
