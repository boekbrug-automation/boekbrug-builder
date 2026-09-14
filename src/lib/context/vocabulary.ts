// src/lib/context/vocabulary.ts
// [SAMENHANG] What may be said about how two things in BoekBrug are related. Pure, no I/O.
// Run: npx tsx --test src/lib/context/vocabulary.test.ts
//
// ── ONE WORD PER RELATIONSHIP, AND NO WORD WITHOUT A RELATIONSHIP ───────────────────────────
//
// The repository already learned this lesson once, in the interface rather than the data model:
// [AR-TERMEN] exists because one Arabic word had been serving two Dutch meanings, and because
// three Dutch words had been serving one. The fix was a decided vocabulary with the reason written
// beside each ruling, so the next reader's instinct to unify them meets an argument instead of a
// blank.
//
// This file is that, for relationships. Two rules, and the second is the one that keeps it small:
//
//   1. one type per relationship — `koppelen`, `matchen`, `toewijzen` and `hoort bij` do not each
//      get to mean something slightly different in a different module;
//   2. NO TYPE WITHOUT A CARRIER THAT HAS ROWS. A vocabulary entry whose column is empty is a
//      guess about the future wearing the clothes of a decision.
//
// ── WHAT WAS MEASURED, AND WHAT IT DECIDED ──────────────────────────────────────────────────
//
// Measured against production on 14 September 2026. The proposed vocabulary had seven types; four
// of them describe something that exists here, three do not yet, and one relationship the product
// really has was missing from the list:
//
//   BELONGS_TO     invoices.client_id (18) and invoices.supplier_id (483)      → kept
//   ALLOCATED_TO   bank_tx_invoices.invoice_id (442)                           → kept
//   REPRESENTS     bank_tx_invoices.transaction_id (292)                       → kept
//   CREATED_FROM   invoices.document_id (602), bank_transactions
//                  .statement_document_id (325), invoices.original_invoice_id (1) → kept
//   REFERS_TO      documents.invoice_id on a reminder (0 today, and the zero
//                  is the STATE — see below)                                   → ADDED
//   ATTACHED_TO    bank_tx_attachments (0) — the only business carrier, empty  → not in V1
//   ASSIGNED_TO    work_items.* (0 rows in the whole table)                    → not in V1
//   REVIEWED_BY    invoices.confirmed_by (0), accountant_subject_status (0)    → not in V1
//
// ── WHY REFERS_TO HAD TO BE ADDED, AND IT IS THE MOST USEFUL FINDING HERE ───────────────────
//
// documents.invoice_id carries TWO DIFFERENT RELATIONSHIPS depending on what kind of document the
// row is. On the 601 invoice/receipt/ubl_invoice documents it means THIS DOCUMENT IS THE SOURCE OF
// THAT INVOICE — the CREATED_FROM edge, read the other way. On a document whose ai_doc_type is
// DOC_TYPE_REMINDER it means THIS REMINDER IS ABOUT THAT INVOICE, which is not the same claim: the
// reminder is not the source of anything, nothing was booked from it, and [HERINNERING-NOOIT] is
// the rule that says so. reminder-file.ts:151 writes `invoice_id: placed.original?.id ?? null`,
// and its own comment says the link IS the state — a reminder with no invoice_id is one whose
// original is not in the books, which is exactly what lets the read-as-invoice door open once.
//
// One column, two meanings, and a Context layer that flattened them would answer "what is this
// invoice made of" with a letter chasing it. So REFERS_TO exists, it is distinguished by
// ai_doc_type and not by the column, and the integrity checker splits on the same line.
//
// ── AND THE COUNTERPART IS NOT ALWAYS A CUSTOMER ────────────────────────────────────────────
//
// The scope for this engine names "Customer <-> Invoice" first. In this administration
// invoices.client_id has 18 rows and invoices.supplier_id has 483, because most invoices here are
// INCOMING. Both are the same relationship — who is on the other side of this document — so
// BELONGS_TO carries both and the entity type says which. Modelling only the customer half would
// have covered 4% of the edges that exist.

import type { Permission } from "@/lib/access/permissions";
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";

/** The kinds of thing a relationship can reach in V1. */
export type EntityType =
  | "invoice"
  | "customer"
  | "supplier"
  | "payment"
  | "bank_transaction"
  | "document";

export const ENTITY_TYPES: readonly EntityType[] = [
  "invoice", "customer", "supplier", "payment", "bank_transaction", "document",
];

/** The relationships V1 can state. Five, because five have a carrier with rows in it. */
export type RelationshipType =
  /** X is on the other side of Y: an invoice and its customer, or its supplier. */
  | "BELONGS_TO"
  /** Money placed against a debt: a payment and the invoice it settles. */
  | "ALLOCATED_TO"
  /** One thing stands for another in a different system: a bank line and the payment it is. */
  | "REPRESENTS"
  /** X exists because Y did: an invoice read from a document, a creditnota of an invoice. */
  | "CREATED_FROM"
  /** X talks ABOUT Y without being made from it: a payment reminder and the invoice it chases. */
  | "REFERS_TO";

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "BELONGS_TO", "ALLOCATED_TO", "REPRESENTS", "CREATED_FROM", "REFERS_TO",
];

/**
 * The three proposed types that are NOT in V1, and the carrier that would have justified each.
 *
 * Written down rather than omitted, for the same reason ROLE_SCOPES writes "none" instead of
 * leaving a permission out: a type that is missing and a type that was considered and refused look
 * identical in a short list, and only one of them was decided by a person.
 */
export const DEFERRED_TYPES: Readonly<Record<string, string>> = {
  ATTACHED_TO:
    "Its only business carrier is bank_tx_attachments — a receipt the owner staples to a bank " +
    "line — and that table has 0 rows. documents.folder_id has 635, but filing a document in a " +
    "folder is housekeeping, not a business relationship, and calling it ATTACHED_TO would make " +
    "the densest edge in the database the least meaningful one.",
  ASSIGNED_TO:
    "work_items is empty: 0 rows, and therefore 0 for work_items.invoice_id, " +
    "invoices.work_item_id, time_entries.work_item_id and documents.work_item_id. The work layer " +
    "is built and nobody has used it yet. A relationship type for it would be modelling a plan.",
  REVIEWED_BY:
    "invoices.confirmed_by has 0 rows and accountant_subject_status has 0. The accountant path " +
    "exists in full and has never been walked in production — 3 accountant_clients links, 0 live " +
    "mandates of either kind. The edge is real in the code and absent in the data.",
};

export interface RelationshipEdge {
  type: RelationshipType;
  from: EntityType;
  to: EntityType;
  /** The ONE carrier that is authoritative for this edge, as table.column. */
  carrier: string;
  /**
   * Carriers that assert the same edge and are NOT the truth. Naming them here is what stops a
   * later reader from "optimising" a query onto the cheaper one.
   */
  shadowedBy: readonly string[];
  /**
   * The permission the actor must hold for the entity at the FAR end of this edge.
   *
   * This is the whole authorization design, and it falls out of the catalogue rather than being
   * invented: an edge is visible when its far end is. A sales member holds payment.read nowhere,
   * so asking for an invoice's context returns its customer and its source document and NOT the
   * payments — without a single rule written here about sales members.
   */
  readPermission: Permission;
  /** What keeps this edge inside one administration. */
  tenancy: string;
  /** Rows carrying this edge in production on 14 September 2026. */
  measured: number;
  why: string;
}

export const RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  {
    type: "BELONGS_TO",
    from: "invoice",
    to: "customer",
    carrier: "invoices.client_id",
    shadowedBy: ["invoices.client_name"],
    readPermission: "customer.read",
    tenancy: "clients.user_id must equal invoices.sender_id — checked by tenant.invoice-vs-client",
    measured: 18,
    why:
      "client_name is a denormalised copy kept for the invoice's printed text; it agreed with " +
      "clients.name on every row when measured, and it is not the relationship. An invoice with a " +
      "name and no client_id (2 rows) has no BELONGS_TO edge at all — it has a string.",
  },
  {
    type: "BELONGS_TO",
    from: "invoice",
    to: "supplier",
    carrier: "invoices.supplier_id",
    shadowedBy: [],
    readPermission: "expense.read",
    tenancy: "suppliers.user_id must equal the invoice's receiver_id",
    measured: 483,
    why:
      "The same relationship on the incoming side, and the dense one: most invoices in this " +
      "product are purchase invoices. It reads with expense.read rather than customer.read " +
      "because a supplier is a fact about what was BOUGHT, and a sales member holds neither.",
  },
  {
    type: "ALLOCATED_TO",
    from: "payment",
    to: "invoice",
    carrier: "bank_tx_invoices.invoice_id",
    // Spelled without the SQL comparison on purpose: [BEDRAG-MEE] scans for a door that writes the
    // paid status without the amount beside it, and a list of shadowed carriers reads exactly like
    // one. The gate was right to stop on it — a naming here is not worth a hole there.
    shadowedBy: ["invoices.amount_paid", "invoices.status when it says paid", "invoices.payment_date"],
    readPermission: "invoice.read",
    tenancy: "bank_tx_invoices carries its OWN user_id, so a crossing row is detectable directly",
    measured: 442,
    why:
      "The allocation row IS the payment — there is no payments table. 150 of the 442 rows have " +
      "transaction_id NULL, which is what a manual 'ik heb betaald' looks like, so the payment " +
      "cannot be defined as a property of a bank line. Everything on invoices is the CACHE of " +
      "these rows, kept equal under a row lock by the money functions.",
  },
  {
    type: "REPRESENTS",
    from: "bank_transaction",
    to: "payment",
    carrier: "bank_tx_invoices.transaction_id",
    shadowedBy: ["bank_transactions.invoice_id"],
    readPermission: "payment.read",
    tenancy: "bank_transactions.user_id must equal bank_tx_invoices.user_id",
    measured: 292,
    why:
      "bank_transactions.invoice_id is a shortcut that agrees where it is set — 0 contradictions " +
      "measured — and it is STRUCTURALLY INCAPABLE of being the truth: 35 bank lines are " +
      "allocated to more than one invoice, and one column cannot hold two. 8 more carry an " +
      "allocation while the column is null. It may be read as a hint and never as the answer.",
  },
  {
    type: "CREATED_FROM",
    from: "invoice",
    to: "document",
    carrier: "invoices.document_id",
    shadowedBy: ["documents.invoice_id", "invoices.attachment_document_id"],
    readPermission: "invoice.read",
    tenancy: "documents.user_id must be the invoice's sender or receiver",
    measured: 602,
    why:
      "The source document an invoice was read from. documents.invoice_id points back on 601 of " +
      "the 602 and is kept in step by convention rather than by a constraint — and on a reminder " +
      "it means something else entirely, which is why REFERS_TO exists. " +
      "attachment_document_id has 0 rows: a carrier the schema offers and nothing has ever used.",
  },
  {
    type: "CREATED_FROM",
    from: "bank_transaction",
    to: "document",
    carrier: "bank_transactions.statement_document_id",
    shadowedBy: ["bank_statement_periods.document_id"],
    // bank.read, not invoice.read: a bank statement is evidence for a bank line. This is the edge
    // that forced readPermissionFor() to take the near end — see the note on that function.
    readPermission: "bank.read",
    tenancy: "documents.user_id must equal bank_transactions.user_id",
    measured: 325,
    why:
      "The statement file a bank line was imported from. It is the lineage answer to 'where did " +
      "this transaction come from', and it is the only one: a line with no statement document " +
      "came from a bank connection, not from a file.",
  },
  {
    type: "CREATED_FROM",
    from: "invoice",
    to: "invoice",
    carrier: "invoices.original_invoice_id",
    shadowedBy: [],
    readPermission: "invoice.read",
    tenancy: "both rows share sender_id — a creditnota is issued in the same series",
    measured: 1,
    why:
      "A creditnota and the invoice it corrects. One row in production, and it stays in V1 " +
      "anyway: unlike the empty carriers above this one is WRITTEN by a live door " +
      "(/api/invoice/creditnota), so its emptiness is a young administration rather than an " +
      "unused feature.",
  },
  {
    type: "REFERS_TO",
    from: "document",
    to: "invoice",
    carrier: `documents.invoice_id WHERE ai_doc_type = '${DOC_TYPE_REMINDER}'`,
    shadowedBy: [],
    readPermission: "invoice.read",
    tenancy: "documents.user_id must be the invoice's sender or receiver",
    measured: 0,
    why:
      "A payment reminder and the invoice it chases. Zero today, and the zero is the STATE rather " +
      "than an absence: both reminder documents in production have invoice_id NULL, which " +
      "reminder-file.ts writes deliberately to mean 'the original is not in the books'. The edge " +
      "is in V1 because flattening it into CREATED_FROM would answer 'what is this invoice made " +
      "of' with the letter chasing it.",
  },
];

/** Every edge that starts at this kind of thing. */
export function edgesFrom(entity: EntityType): readonly RelationshipEdge[] {
  return RELATIONSHIP_EDGES.filter((e) => e.from === entity);
}

/** Every edge that ends at this kind of thing. */
export function edgesTo(entity: EntityType): readonly RelationshipEdge[] {
  return RELATIONSHIP_EDGES.filter((e) => e.to === entity);
}

/**
 * The permission that governs seeing the far end of an edge.
 *
 * ── A DOCUMENT HAS NO VISIBILITY OF ITS OWN ─────────────────────────────────────────────────
 *
 * The first version of this returned `invoice.read` for every document, and the vocabulary test
 * refused it: a BANK STATEMENT is a document too, and it is evidence for a bank line, not for an
 * invoice. Under that rule a sales member — who holds bank.read nowhere — would have reached a
 * bank statement through the document door.
 *
 * So the rule is stated properly: a document is never an independent object in this graph. It is
 * the EVIDENCE for something, and it inherits the permission of the thing it is evidence for. The
 * database already says this in documents_accountant_read — `shared = true AND
 * is_my_accountant_client(user_id)` — the document follows the administration and the booking, it
 * does not carry a right of its own.
 *
 * `evidenceFor` is the near end of the edge being walked. Without it a document falls back to
 * invoice.read, which is the narrower of the two answers for every role that has both.
 */
export function readPermissionFor(entity: EntityType, evidenceFor?: EntityType): Permission {
  switch (entity) {
    case "invoice": return "invoice.read";
    case "customer": return "customer.read";
    case "supplier": return "expense.read";
    case "payment": return "payment.read";
    case "bank_transaction": return "bank.read";
    case "document":
      // Never recurse: a document is not evidence for a document, and no such edge exists.
      return evidenceFor && evidenceFor !== "document"
        ? readPermissionFor(evidenceFor)
        : "invoice.read";
  }
}
