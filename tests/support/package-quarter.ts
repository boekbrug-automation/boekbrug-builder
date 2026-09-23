// tests/support/package-quarter.ts
// [PACKAGE-FAIL-CLOSED] One ordinary quarter, Q1 2026, for a shop that also invoices: every
// source the quarter package reads holds real rows, so a test can take any ONE of them away and
// see what the package does without it.
//
// Every row belongs to OWNER unless it says otherwise. Storage keys sit in OWNER's folder, because
// the builder refuses any key it cannot attribute ([SEC-STORAGE-PATH]).

import type { Row } from "./package-fake-db";

export const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ACCOUNTANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const SHARE_TOKEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const YEAR = 2026;
export const QUARTER = 1 as const;

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% ${label}\n%%EOF\n`);

export const PATHS = {
  sale1: `${OWNER}/facturen/2026-0001.pdf`,
  sale2: `${OWNER}/facturen/2026-0002.pdf`,
  purchase1: `${OWNER}/inkoop/lev-1.pdf`,
  purchase2: `${OWNER}/inkoop/lev-2.pdf`,
  sale3: `${OWNER}/facturen/2026-0003.pdf`,
  purchase3: `${OWNER}/inkoop/de-77.pdf`,
  statement: `${OWNER}/bank/afschrift-q1.pdf`,
} as const;

export function quarterStorage(): Record<string, Uint8Array> {
  return Object.fromEntries(Object.values(PATHS).map((p) => [p, pdf(p)]));
}

const invoice = (over: Row): Row => ({
  invoice_type: "factuur", tax_kind: null, due_date: null, pdf_url: null, document_id: null,
  client_btw_number: null, supplier_id: null, client_address: "Straat 1", client_postal_code: "1000 AA",
  client_city: "Amsterdam", marked_paid_at: null, payment_method: null, payment_date: null, source: null,
  field_confidence: null, discount_type: null, discount_value: null, original_invoice_id: null,
  amount_paid: 0, vat_deduction: null, ...over,
});

/** The healthy quarter. A fresh copy per call — the fake writes into it. */
export function quarterTables(): Record<string, Row[]> {
  return {
    profiles: [
      {
        id: OWNER, role: "zzper", email: "eigenaar@example.invalid", company_name: "Bakkerij Voorbeeld",
        full_name: "Eva Voorbeeld", kvk_number: "12345678", btw_number: "NL001234567B01",
        iban: "NL91ABNA0417164300", address: "Dorpsstraat 1", postal_code: "1234 AB", city: "Utrecht",
        kor_active: false, vat_scheme: "factuur", vat_scheme_since: null, vat_exempt_activity: false,
        vat_exempt_since: null, kas_opening_balance: 150, invoice_number_template: null, invoice_number_padding: null,
      },
      { id: ACCOUNTANT, role: "accountant", email: "boekhouder@example.invalid", full_name: "Bram Boekhouder" },
      { id: STRANGER, role: "accountant", email: "vreemde@example.invalid", full_name: "Niet Gekoppeld" },
    ],
    invoices: [
      invoice({
        id: "out-1", invoice_number: "2026-0001", client_name: "Klant A", status: "paid", direction: "outgoing",
        total_ex_btw: 1000, btw_amount: 210, total_inc_btw: 1210, invoice_date: "2026-01-15", due_date: "2026-02-14",
        pdf_url: PATHS.sale1, sender_id: OWNER, receiver_id: null, payment_date: "2026-01-20", amount_paid: 1210,
      }),
      invoice({
        id: "out-2", invoice_number: "2026-0002", client_name: "Klant B", status: "sent", direction: "outgoing",
        total_ex_btw: 500, btw_amount: 45, total_inc_btw: 545, invoice_date: "2026-02-10", due_date: "2026-03-12",
        pdf_url: PATHS.sale2, sender_id: OWNER, receiver_id: null,
      }),
      invoice({
        id: "in-1", invoice_number: "LEV-1", client_name: "Leverancier Meel", status: "received", direction: "incoming",
        total_ex_btw: 200, btw_amount: 42, total_inc_btw: 242, invoice_date: "2026-02-03", due_date: "2026-03-05",
        document_id: "doc-in-1", sender_id: null, receiver_id: OWNER, supplier_id: "sup-1",
        client_btw_number: "NL009999999B01",
      }),
      invoice({
        id: "in-2", invoice_number: "LEV-2", client_name: "Leverancier Gas", status: "paid", direction: "incoming",
        total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-03-05", due_date: "2026-04-04",
        document_id: "doc-in-2", sender_id: null, receiver_id: OWNER, payment_date: "2026-03-06", amount_paid: 121,
      }),
      // Two rates on one invoice: the rubriek split comes from its lines ([RUBRIEK-SPLIT]).
      invoice({
        id: "out-3", invoice_number: "2026-0003", client_name: "Klant C", status: "sent", direction: "outgoing",
        total_ex_btw: 200, btw_amount: 30, total_inc_btw: 230, invoice_date: "2026-03-10", due_date: "2026-04-09",
        pdf_url: PATHS.sale3, sender_id: OWNER, receiver_id: null,
      }),
      // A supplier whose country is recorded and whose btw-nummer is not: rubriek 4b rests on the country alone.
      invoice({
        id: "in-3", invoice_number: "DE-77", client_name: "Lieferant GmbH", status: "received", direction: "incoming",
        total_ex_btw: 400, btw_amount: 0, total_inc_btw: 400, invoice_date: "2026-02-20", due_date: "2026-03-22",
        document_id: "doc-in-3", sender_id: null, receiver_id: OWNER, supplier_id: "sup-2", client_btw_number: null,
      }),
      // Art. 29: a sale and a purchase still open more than a year after their due date. Dated long
      // before this quarter, so only the art. 29 reads can see them.
      invoice({
        id: "out-old", invoice_number: "2024-0007", client_name: "Wanbetaler BV", status: "sent", direction: "outgoing",
        total_ex_btw: 500, btw_amount: 105, total_inc_btw: 605, invoice_date: "2024-03-01", due_date: "2024-03-31",
        sender_id: OWNER, receiver_id: null,
      }),
      invoice({
        id: "in-old", invoice_number: "OUD-3", client_name: "Leverancier Meel", status: "received", direction: "incoming",
        total_ex_btw: 300, btw_amount: 63, total_inc_btw: 363, invoice_date: "2024-02-01", due_date: "2024-03-01",
        sender_id: null, receiver_id: OWNER, supplier_id: "sup-1",
      }),
    ],
    invoice_lines: [
      { id: "il-1", invoice_id: "out-1", description: "Bruidstaart", quantity: 1, unit: "stuks", unit_price: 1000, btw_rate: 21, line_total: 1000, vat_treatment: null, position: 0 },
      { id: "il-2", invoice_id: "out-2", description: "Broodjes", quantity: 100, unit: "stuks", unit_price: 5, btw_rate: 9, line_total: 500, vat_treatment: null, position: 0 },
      { id: "il-3a", invoice_id: "out-3", description: "Tweedehands vitrine (margeregeling)", quantity: 1, unit: "stuks", unit_price: 100, btw_rate: 21, line_total: 100, vat_treatment: null, position: 0 },
      { id: "il-3b", invoice_id: "out-3", description: "Gebak", quantity: 20, unit: "stuks", unit_price: 5, btw_rate: 9, line_total: 100, vat_treatment: null, position: 1 },
    ],
    documents: [
      { id: "doc-in-1", user_id: OWNER, file_url: PATHS.purchase1, file_name: "lev-1.pdf", doc_type: "inkoop", period: null, shared: false, trashed: false, invoice_id: "in-1", created_at: "2026-02-03T09:00:00Z" },
      { id: "doc-in-2", user_id: OWNER, file_url: PATHS.purchase2, file_name: "lev-2.pdf", doc_type: "inkoop", period: null, shared: false, trashed: false, invoice_id: "in-2", created_at: "2026-03-05T09:00:00Z" },
      { id: "doc-in-3", user_id: OWNER, file_url: PATHS.purchase3, file_name: "de-77.pdf", doc_type: "inkoop", period: null, shared: false, trashed: false, invoice_id: "in-3", created_at: "2026-02-20T09:00:00Z" },
      { id: "doc-bank-1", user_id: OWNER, file_url: PATHS.statement, file_name: "afschrift-q1.pdf", doc_type: "bankafschrift", period: "2026-Q1", shared: false, trashed: false, invoice_id: null, created_at: "2026-04-02T09:00:00Z" },
    ],
    bank_transactions: [
      { id: "bt-001", user_id: OWNER, date: "2026-01-06", amount: 95.5, category: "pos_income", status: "matched", invoice_id: null, description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260105/1 AANT. 3", counterpart_name: "Worldline", reference: null, ignore_reason: null },
      { id: "bt-002", user_id: OWNER, date: "2026-01-20", amount: 1210, category: "omzet", status: "matched", invoice_id: "out-1", description: "Klant A 2026-0001", counterpart_name: "Klant A", reference: "2026-0001", ignore_reason: null },
      { id: "bt-003", user_id: OWNER, date: "2026-02-01", amount: -800, category: "kosten", status: "pending", invoice_id: null, description: "Huur februari", counterpart_name: "Verhuurder", reference: null, ignore_reason: null },
      { id: "bt-004", user_id: OWNER, date: "2026-02-03", amount: 150, category: "pos_income", status: "matched", invoice_id: null, description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260202/1 AANT. 5", counterpart_name: "Worldline", reference: null, ignore_reason: null },
      { id: "bt-005", user_id: OWNER, date: "2026-03-03", amount: 121, category: "pos_income", status: "matched", invoice_id: null, description: "AFREK. BETAALAUTOMAAT VISA DAT. 20260302/1 AANT. 2", counterpart_name: "Worldline", reference: null, ignore_reason: null },
      { id: "bt-006", user_id: OWNER, date: "2026-03-06", amount: -121, category: "kosten", status: "matched", invoice_id: "in-2", description: "Leverancier Gas LEV-2", counterpart_name: "Leverancier Gas", reference: "LEV-2", ignore_reason: null },
      { id: "bt-007", user_id: OWNER, date: "2026-03-15", amount: -45, category: null, status: "pending", invoice_id: null, description: "Onbekende afschrijving", counterpart_name: null, reference: null, ignore_reason: null },
      // Ignored as a duplicate: it stays out of every figure ([GENEGEERD-TELT]).
      { id: "bt-008", user_id: OWNER, date: "2026-03-20", amount: 250, category: "omzet", status: "not_found", invoice_id: null, description: "Dubbele bijschrijving", counterpart_name: "Klant A", reference: null, ignore_reason: "dubbel" },
    ],
    // February was never imported: the package has to say so ([DEKKING]).
    bank_statement_periods: [
      { document_id: "doc-bank-1", user_id: OWNER, iban: "NL91ABNA0417164300", period_start: "2026-01-01", period_end: "2026-01-31", opening_balance: 1000, closing_balance: 2305.5 },
      { document_id: "doc-bank-1", user_id: OWNER, iban: "NL91ABNA0417164300", period_start: "2026-03-01", period_end: "2026-03-31", opening_balance: 1655.5, closing_balance: 1610.5 },
    ],
    cash_entries: [
      { id: "ce-001", user_id: OWNER, entry_date: "2026-01-05", direction: "in", category: "omzet", amount: 13.5, btw_rate: null, document_id: null, description: "Kasomzet", deleted_at: null },
      { id: "ce-002", user_id: OWNER, entry_date: "2026-02-02", direction: "in", category: "omzet", amount: 68, btw_rate: null, document_id: null, description: "Kasomzet", deleted_at: null },
      { id: "ce-003", user_id: OWNER, entry_date: "2026-02-12", direction: "out", category: "kosten", amount: 24.2, btw_rate: 21, document_id: "doc-cash-1", description: "Schoonmaakmiddel", deleted_at: null },
    ],
    daily_turnover: [
      { user_id: OWNER, turnover_date: "2026-01-05", base_0: 0, base_9: 100.46, base_21: 0, btw_9: 9.04, btw_21: 0, total_incl: 109.5, pin_amount: 95.5, cash_amount: 14, other_amount: 0 },
      { user_id: OWNER, turnover_date: "2026-02-02", base_0: 0, base_9: 200, base_21: 0, btw_9: 18, btw_21: 0, total_incl: 218, pin_amount: 150, cash_amount: 68, other_amount: 0 },
      { user_id: OWNER, turnover_date: "2026-03-02", base_0: 0, base_9: 0, base_21: 100, btw_9: 0, btw_21: 21, total_incl: 121, pin_amount: 121, cash_amount: 0, other_amount: 0 },
    ],
    eft_settlements: [
      { id: "eft-001", user_id: OWNER, settlement_date: "2026-01-05", terminal_id: "T1", period_nr: 1, shift_nr: 1, period_start: "2026-01-05T08:00:00Z", period_end: "2026-01-05T18:00:00Z", first_trx: 1, last_trx: 3, gross_total: 95.5, tx_count: 3, by_scheme: [] },
    ],
    ledger_daily: [
      { id: "ld-001", user_id: OWNER, kind: "pin", ledger_date: "2026-01-05", received: 95.5, spent: 0 },
      { id: "ld-002", user_id: OWNER, kind: "pin", ledger_date: "2026-02-02", received: 150, spent: 0 },
      { id: "ld-003", user_id: OWNER, kind: "pin", ledger_date: "2026-03-02", received: 121, spent: 0 },
    ],
    suppliers: [
      { id: "sup-1", user_id: OWNER, country: "NL" },
      { id: "sup-2", user_id: OWNER, country: "DE" },
    ],
    invoice_counters: [{ user_id: OWNER, type: "factuur", year: 2026, last_seq: 3 }],
    audit_logs: [],
    bank_tx_invoices: [],
    accountant_clients: [{ id: "link-1", accountant_id: ACCOUNTANT, zzper_id: OWNER }],
    package_shares: [
      { id: "share-1", token: SHARE_TOKEN, user_id: OWNER, year: YEAR, quarter: QUARTER, expires_at: "2099-01-01T00:00:00Z", revoked_at: null, download_count: 0, sent_to_email: "kantoor@example.invalid" },
    ],
    package_deliveries: [],
    notifications: [],
    btw_filings: [],
    cron_runs: [],
    readiness_cache: [],
  };
}

/** The same owner with nothing in the quarter at all — every read succeeds and returns nothing. */
export function emptyQuarterTables(): Record<string, Row[]> {
  const t = quarterTables();
  for (const k of Object.keys(t)) {
    if (k === "profiles" || k === "accountant_clients" || k === "package_shares") continue;
    t[k] = [];
  }
  return t;
}

/** `count` card payouts in the quarter, so a paged read of them needs a second page. */
export function withManyCardPayouts(t: Record<string, Row[]>, count: number): Record<string, Row[]> {
  for (let i = 1; i <= count; i++) {
    t.bank_transactions.push({
      id: `bt-pos-${String(i).padStart(5, "0")}`, user_id: OWNER, date: "2026-02-03", amount: 1,
      category: "pos_income", status: "matched", invoice_id: null,
      description: "AFREK. BETAALAUTOMAAT VPAY DAT. 20260202/1 AANT. 1", counterpart_name: "Worldline",
      reference: null, ignore_reason: null,
    });
  }
  return t;
}
