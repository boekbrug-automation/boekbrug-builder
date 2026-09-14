// src/lib/context/integrity.ts
// [SAMENHANG] Can the relationships in this administration be trusted? Pure data, no I/O.
// Run: npx tsx --test src/lib/context/integrity.test.ts
// Execute the checks: npx tsx scripts/context-integrity.mts
//
// ── WHY THE CHECKER COMES BEFORE THE ENGINE ─────────────────────────────────────────────────
//
// The Context / Relationship layer answers "what is connected to what". Every answer it gives is
// only as good as the edges underneath it, and an edge can be wrong in ways a foreign key does not
// catch: it can point across a TENANT boundary (both rows exist, they just belong to different
// people), it can be ORPHANED in the sense the product cares about (the target row is gone or the
// column was silently set to NULL by an ON DELETE rule), it can DISAGREE with a second carrier of
// the same relationship, or it can be UNREACHABLE — a link the domain says exists and the
// projection cannot see.
//
// So the checks are written first, and they are written over DOMAIN FACTS rather than over
// anything Context stores. That is deliberate twice over: it means the checker keeps working if
// the Context layer is rewritten, and it means Context can never be the thing that "proves" itself.
//
// ── A CHECK THAT CANNOT FAIL PROVES NOTHING ─────────────────────────────────────────────────
//
// scripts/verify-tenant-isolation.mts already says this better than a paraphrase would:
//
//     "Not '0 rows leaked' — zero is also what a broken probe returns, and a check that cannot
//      fail proves nothing. Every run first establishes how many rows there are TO hide and
//      refuses to call itself a pass if that number is small. Hiding 595 invoices is a result;
//      hiding none is a sentence with no subject."
//
// The same rule governs this file. Every VIOLATION check is paired with a POPULATION check that
// counts how many edges of that kind exist at all, and the runner refuses to report a pass when the
// population is below the floor. On 14 September 2026 the populations measured here were: 602
// invoice→document edges, 442 payment allocations (292 with a bank line, 150 without), 209 bank
// lines carrying the denormalised invoice_id, and 20 invoice→client edges. The last one is thin
// enough that its "zero violations" result is honestly weak, and the floor says so rather than
// letting it pass quietly.
//
// ── AND WHAT ZERO MEANT ON THE DAY THIS WAS WRITTEN ─────────────────────────────────────────
//
// All eight cross-tenant checks returned 0 against production. That number was measured across
// THREE tenants that actually own rows (measured: 3 distinct user_id values in bank_transactions,
// bank_tx_invoices and documents; 10 profiles exist, 5 have an invoice). Three is enough for the
// check to be real and not enough for it to be strong, which is exactly why it is a repeatable
// script and not a sentence in a commit message.

// ── WHAT A FOREIGN KEY CANNOT REACH, AND WHY IT IS NOT CHECKED HERE ─────────────────────────
//
// Measured on 14 September 2026: `audit_logs` holds 3.111 rows, and 589 of them point at
// something that no longer exists — 174 with entity_type 'invoice', 415 with 'document'. That is
// not carelessness. `audit_logs.entity_id` is a POLYMORPHIC reference with no foreign key, which
// is the only shape in this schema where a dangling pointer is even possible: everywhere a
// foreign key exists, the orphan count is zero, and that is the key working rather than anybody's
// discipline.
//
// It is deliberately NOT a check in this file, for two reasons that point the same way. The audit
// log is EVIDENCE of what happened, not a statement about what is — a row recording that an
// invoice was archived stays true after the invoice is deleted, and "repairing" it would destroy
// the record. And the relationship layer must never read it as an edge: a graph built on the
// audit log would answer "what is connected to what" with "what was once done", which are
// different questions. A gate asserts the layer never touches the table.
//
// A checker that reported 589 findings forever is also a checker nobody reads.

/** What a passing result looks like for this check. */
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";

export type IntegrityExpectation =
  /** A violation count. Anything above zero is a finding. */
  | "zero"
  /** A population count. It exists so that a zero-violation result can be believed. */
  | "population";

export interface IntegrityCheck {
  /** Stable id — it ends up in output somebody greps. */
  id: string;
  /** The relationship family this belongs to, in the vocabulary of the V1 scope. */
  family:
    | "customer-invoice"
    | "invoice-payment"
    | "payment-bank"
    | "invoice-document";
  /** What it looks for, in one sentence a non-author can act on. */
  title: string;
  expect: IntegrityExpectation;
  /**
   * For a "zero" check: the id of the population check that makes its zero meaningful.
   * Empty for a population check itself.
   */
  believableBecause: string;
  /**
   * The smallest population at which a zero result may be reported as a pass. Only meaningful on
   * a population check. Chosen from what was measured, not from a round number.
   */
  floor: number;
  /** Read-only SQL returning exactly one row with one integer column named n. */
  sql: string;
  /** Why this can go wrong, so that a finding is actionable rather than alarming. */
  why: string;
}

// ── Population checks — how many edges of each kind exist at all ─────────────────────────────

const POPULATIONS: readonly IntegrityCheck[] = [
  {
    id: "pop.customer-invoice",
    family: "customer-invoice",
    title: "invoices that name a customer from the owner's own customer book",
    expect: "population",
    believableBecause: "",
    // Measured 20 on 14 September 2026 (18 with client_id, 2 with only a name). Thin on purpose:
    // most invoices in this administration are INCOMING, where the counterpart is a supplier.
    floor: 10,
    sql: "SELECT count(*)::bigint AS n FROM invoices WHERE client_id IS NOT NULL",
    why: "A customer edge that nobody has is an edge nobody can check.",
  },
  {
    id: "pop.invoice-payment",
    family: "invoice-payment",
    title: "payment allocations",
    expect: "population",
    believableBecause: "",
    // Measured 442 (292 bank-originated, 150 manual).
    floor: 100,
    sql: "SELECT count(*)::bigint AS n FROM bank_tx_invoices",
    why: "The allocation row IS the payment in this product; there is no payments table.",
  },
  {
    id: "pop.payment-bank",
    family: "payment-bank",
    title: "allocations that carry a bank line",
    expect: "population",
    believableBecause: "",
    // Measured 292. The other 150 are manual payments with transaction_id NULL, and that is not a
    // defect — it is what "ik heb betaald" looks like.
    floor: 100,
    sql: "SELECT count(*)::bigint AS n FROM bank_tx_invoices WHERE transaction_id IS NOT NULL",
    why: "A bank edge nobody has cannot disagree with anything.",
  },
  {
    id: "pop.invoice-document",
    family: "invoice-document",
    title: "invoices that point at a source document",
    expect: "population",
    believableBecause: "",
    // Measured 602.
    floor: 200,
    sql: "SELECT count(*)::bigint AS n FROM invoices WHERE document_id IS NOT NULL",
    why: "The document edge is the densest relationship in this product.",
  },
];

// ── Violation checks — every one of these must answer zero ───────────────────────────────────

const VIOLATIONS: readonly IntegrityCheck[] = [
  // Cross-tenant. Both rows exist and a foreign key is satisfied; they belong to different people.
  {
    id: "tenant.allocation-vs-transaction",
    family: "payment-bank",
    title: "an allocation whose bank line belongs to somebody else",
    expect: "zero",
    believableBecause: "pop.payment-bank",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM bank_tx_invoices l " +
      "JOIN bank_transactions bt ON bt.id = l.transaction_id WHERE bt.user_id <> l.user_id",
    why:
      "bank_tx_invoices carries its OWN user_id, so this is checkable at all. The foreign key on " +
      "transaction_id says the row exists; it says nothing about whose it is.",
  },
  {
    id: "tenant.allocation-vs-invoice",
    family: "invoice-payment",
    title: "an allocation against an invoice that is neither sent nor received by its owner",
    expect: "zero",
    believableBecause: "pop.invoice-payment",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM bank_tx_invoices l JOIN invoices i ON i.id = l.invoice_id " +
      "WHERE l.user_id <> coalesce(i.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) " +
      "AND l.user_id <> coalesce(i.receiver_id, '00000000-0000-0000-0000-000000000000'::uuid)",
    why:
      "An invoice has TWO owner columns and either may be the tenant: sender_id for an outgoing " +
      "invoice, receiver_id for an incoming one. A check that looked at only one would call every " +
      "purchase invoice a violation.",
  },
  {
    id: "tenant.invoice-vs-client",
    family: "customer-invoice",
    title: "an invoice naming a customer from another administration's book",
    expect: "zero",
    believableBecause: "pop.customer-invoice",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM invoices i JOIN clients c ON c.id = i.client_id " +
      "WHERE c.user_id <> i.sender_id",
    why: "clients.user_id is the owner's customer book. Only the sender can have one.",
  },
  {
    id: "tenant.invoice-vs-document",
    family: "invoice-document",
    title: "an invoice pointing at a document owned by somebody else",
    expect: "zero",
    believableBecause: "pop.invoice-document",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM invoices i JOIN documents d ON d.id = i.document_id " +
      "WHERE d.user_id <> coalesce(i.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) " +
      "AND d.user_id <> coalesce(i.receiver_id, '00000000-0000-0000-0000-000000000000'::uuid)",
    why: "Same two-owner rule as the allocation check above.",
  },
  {
    id: "tenant.document-vs-invoice",
    family: "invoice-document",
    title: "a document pointing at an invoice owned by somebody else",
    expect: "zero",
    believableBecause: "pop.invoice-document",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM documents d JOIN invoices i ON i.id = d.invoice_id " +
      "WHERE d.user_id <> coalesce(i.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) " +
      "AND d.user_id <> coalesce(i.receiver_id, '00000000-0000-0000-0000-000000000000'::uuid)",
    why:
      "The SAME relationship in the other direction. Both sides are checked because both sides " +
      "are written, by different paths.",
  },
  {
    id: "tenant.banktx-vs-invoice",
    family: "payment-bank",
    title: "a bank line whose denormalised invoice_id points into another administration",
    expect: "zero",
    believableBecause: "pop.payment-bank",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM bank_transactions bt JOIN invoices i ON i.id = bt.invoice_id " +
      "WHERE bt.user_id <> coalesce(i.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) " +
      "AND bt.user_id <> coalesce(i.receiver_id, '00000000-0000-0000-0000-000000000000'::uuid)",
    why: "The shortcut column is still a pointer, and a pointer can still cross a boundary.",
  },

  // Disagreement between two carriers of ONE relationship.
  {
    id: "agree.banktx-invoice-id-has-no-allocation",
    family: "payment-bank",
    title: "a bank line says it belongs to an invoice, and no allocation says so",
    expect: "zero",
    believableBecause: "pop.payment-bank",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM bank_transactions bt WHERE bt.invoice_id IS NOT NULL " +
      "AND NOT EXISTS (SELECT 1 FROM bank_tx_invoices l WHERE l.transaction_id = bt.id)",
    why:
      "bank_transactions.invoice_id is a DENORMALISATION of the allocation table, and the " +
      "allocation table is the truth — it is the one the money functions write under a row lock, " +
      "and the one that carries amount_applied. A line claiming an invoice with no allocation " +
      "behind it is a claim about money that the ledger does not make.",
  },
  {
    id: "agree.banktx-invoice-id-contradicts-allocation",
    family: "payment-bank",
    title: "a bank line names one invoice while its allocations name others",
    expect: "zero",
    believableBecause: "pop.payment-bank",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM bank_transactions bt WHERE bt.invoice_id IS NOT NULL " +
      "AND EXISTS (SELECT 1 FROM bank_tx_invoices l WHERE l.transaction_id = bt.id) " +
      "AND NOT EXISTS (SELECT 1 FROM bank_tx_invoices l WHERE l.transaction_id = bt.id AND l.invoice_id = bt.invoice_id)",
    why:
      "This is the disagreement that matters, and note what it CANNOT catch: a payment split " +
      "across several invoices. 35 bank lines carry more than one allocation, and a single column " +
      "cannot represent 35 of them — so for those the shortcut is not wrong, it is incomplete. " +
      "That is why the shortcut may never be read as the answer.",
  },
  {
    id: "agree.invoice-document-one-way",
    family: "invoice-document",
    title: "an invoice points at a source document that does not point back",
    expect: "zero",
    believableBecause: "pop.invoice-document",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM invoices i JOIN documents d ON d.id = i.document_id " +
      `WHERE d.invoice_id IS NULL AND coalesce(d.ai_doc_type, '') <> '${DOC_TYPE_REMINDER}'`,
    why:
      "The two directions are kept in step by CONVENTION, not by a constraint — nothing in the " +
      "database enforces the pair. The reminder exclusion is not a loophole, it is the finding " +
      "that made this check honest: this column carries TWO DIFFERENT RELATIONSHIPS. On " +
      "601 invoice/receipt/ubl_invoice documents it means THIS DOCUMENT IS THE SOURCE OF THAT " +
      "INVOICE. On a document whose ai_doc_type is DOC_TYPE_REMINDER it means THIS REMINDER IS " +
      "ABOUT THAT INVOICE, and NULL there is a deliberate state, not a gap: reminder-file.ts:151 writes " +
      "`invoice_id: placed.original?.id ?? null` and its comment says so — a reminder with no " +
      "invoice_id is one whose original is not in the books, which is exactly what opens the " +
      "read-as-invoice door once, on the owner's tap. One column, two meanings, and only one of " +
      "them is the relationship this check is about.",
  },
  {
    id: "rule.invoice-sourced-from-a-reminder",
    family: "invoice-document",
    title: "an invoice whose source document is a DOC_TYPE_REMINDER document",
    expect: "zero",
    believableBecause: "pop.invoice-document",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM invoices i JOIN documents d ON d.id = i.document_id " +
      `WHERE d.ai_doc_type = '${DOC_TYPE_REMINDER}' AND i.status <> 'archived'`,
    why:
      "[HERINNERING-NOOIT]: such a document is never an invoice, on any door. This is the check " +
      "the one-way count above USED to be reporting without naming — a live invoice sourced from " +
      "one is a cost booked twice, once for the invoice and once for the letter chasing " +
      "it. Archived invoices are excluded deliberately: one exists in production from before the " +
      "rule was enforced, it is out of the books, and a permanent finding nobody can clear is how " +
      "a checker stops being read.",
  },
  {
    id: "agree.document-invoice-points-elsewhere",
    family: "invoice-document",
    title: "a document claims an invoice that claims a different document",
    expect: "zero",
    believableBecause: "pop.invoice-document",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM documents d JOIN invoices i ON i.id = d.invoice_id " +
      "WHERE i.document_id IS NOT NULL AND i.document_id <> d.id",
    why: "A contradiction rather than a gap: two documents cannot both be the source of one invoice.",
  },

  // Orphans and shape.
  {
    id: "shape.allocation-without-invoice",
    family: "invoice-payment",
    title: "an allocation with no invoice",
    expect: "zero",
    believableBecause: "pop.invoice-payment",
    floor: 0,
    sql: "SELECT count(*)::bigint AS n FROM bank_tx_invoices WHERE invoice_id IS NULL",
    why:
      "invoice_id is NOT NULL in the schema, so this should be structurally impossible. It is " +
      "checked anyway: a constraint that is asserted and never measured is a belief.",
  },
  {
    id: "shape.allocation-without-amount",
    family: "invoice-payment",
    title: "an allocation that records no amount",
    expect: "zero",
    believableBecause: "pop.invoice-payment",
    floor: 0,
    sql: "SELECT count(*)::bigint AS n FROM bank_tx_invoices WHERE amount_applied IS NULL",
    why:
      "amount_applied is nullable in the schema. A payment edge with no amount cannot be summed, " +
      "and the invariant invoices.amount_paid = SUM(amount_applied) is what the whole money line " +
      "rests on — reverse_invoice_payment refuses such a row for exactly this reason.",
  },
  {
    id: "shape.paid-invoice-without-allocation",
    family: "invoice-payment",
    title: "an invoice that stands paid with nothing allocated to it",
    expect: "zero",
    believableBecause: "pop.invoice-payment",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM invoices i WHERE i.status = 'paid' " +
      "AND NOT EXISTS (SELECT 1 FROM bank_tx_invoices l WHERE l.invoice_id = i.id)",
    why:
      "The cache says paid and the relationship says nothing was paid. Twenty-six invoices were in " +
      "this state before paid_without_allocation_repair.sql; the repair brought it to zero and this " +
      "check is what keeps it there.",
  },
  {
    id: "shape.amount-paid-disagrees-with-allocations",
    family: "invoice-payment",
    title: "the cached amount_paid does not equal the sum of the allocations",
    expect: "zero",
    believableBecause: "pop.invoice-payment",
    floor: 0,
    sql:
      "SELECT count(*)::bigint AS n FROM (" +
      "SELECT i.id FROM invoices i LEFT JOIN bank_tx_invoices l ON l.invoice_id = i.id " +
      "GROUP BY i.id, i.amount_paid " +
      "HAVING round(coalesce(i.amount_paid, 0)::numeric, 2) <> round(coalesce(sum(l.amount_applied), 0)::numeric, 2)" +
      ") x",
    why:
      "THE money invariant, asked as a relationship question. It belongs here because the " +
      "allocation rows ARE the Invoice↔Payment relationship: if the cache and the edges disagree, " +
      "every context answer built on those edges is telling a different story from the screen.",
  },
];

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [...POPULATIONS, ...VIOLATIONS];

export function checksFor(family: IntegrityCheck["family"]): readonly IntegrityCheck[] {
  return INTEGRITY_CHECKS.filter((c) => c.family === family);
}

/** The four relationships V1 covers. Named here so the test can demand a check for each. */
export const V1_FAMILIES: readonly IntegrityCheck["family"][] = [
  "customer-invoice", "invoice-payment", "payment-bank", "invoice-document",
];
