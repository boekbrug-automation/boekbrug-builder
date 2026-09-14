// src/lib/context/query.ts
// [SAMENHANG] What is connected to what, for an actor who is allowed to see it. Server only.
//
// ── WHAT THIS LAYER IS, AND THE FOUR THINGS IT IS NOT ───────────────────────────────────────
//
// It answers one question: what is related to this thing? It does NOT answer what the thing is
// worth, what state it is in, or what should happen to it. Those belong to the domain engines, and
// the separation is not a slogan here — it is enforced by the shape of ContextNode, which has room
// for an id, a kind and a label and nowhere to put an amount.
//
//   not a CRM            — it stores no customer of its own
//   not a warehouse      — it stores nothing at all; every answer is derived at read time
//   not a graph database — it is five joins over foreign keys that already exist
//   not a source of truth — a projection cannot duplicate a fact, because it has nowhere to keep one
//
// That last line is why V1 is a projection and not a table. The repository already has 130 foreign
// keys with real referential integrity; a row in a generic `relationships` table would be a SECOND
// assertion of a fact the database already enforces, and keeping two assertions equal is exactly
// the duplication this engine was asked to remove rather than add.
//
// ── AUTHORIZATION IS NOT A FILTER APPLIED AFTERWARDS ────────────────────────────────────────
//
// Every function here takes an ActingContext and never resolves one. A module that could call
// resolveActingContext() itself would be a module that could be called without one, and
// "getInvoiceContext(invoiceId)" returning rows to whoever asks is precisely the door the
// specification forbids. The flow is fixed, and it starts outside this file:
//
//     resolveActingContext()  →  authorize()  →  Context query
//
// Inside, each EDGE is authorized separately, at resource level, against the entity it reaches.
// The rule is one sentence — an edge is visible when its far end is — and everything else follows
// from the permission catalogue without this file knowing what a sales member is.
//
// ── AND A PARTIAL ANSWER SAYS THAT IT IS PARTIAL ────────────────────────────────────────────
//
// [NO-SILENT-EMPTY] applies with a twist: an actor who may not see an edge must not learn what it
// was, and must still be told that something is there. So refused edges are COUNTED into
// `withheld` and never described. Zero relations with withheld = 3 is a different answer from zero
// relations with withheld = 0, and a screen that shows "niets gevonden" for the first one is lying.

// No "server-only" marker: the package is not a dependency of this repo (session-user.ts explains
// why), and this module needs no marker in any case. It creates NO database client — the caller
// hands it a reader. That is not only a purity nicety: it means every branch below, including the
// counting of what an actor may not see, is exercised by an ordinary unit test with a fake reader,
// instead of being the kind of authorization code that is only ever run in production.

import { authorize, type ActingContext } from "@/lib/access/decision";
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";
import {
  RELATIONSHIP_EDGES, readPermissionFor,
  type EntityType, type RelationshipType,
} from "./vocabulary";

/** A thing, as far as a relationship is concerned. Deliberately nothing else fits in here. */
export interface ContextNode {
  type: EntityType;
  id: string;
  /**
   * What to print. A DISPLAY HINT derived at read time from the domain row — an invoice number, a
   * customer name, a file name — never a state and never an amount. If a caller needs to know
   * what an invoice is worth it asks the Commercial Document engine, which owns that.
   */
  label: string;
}

/** Where a relationship came from, so that every edge can be traced. */
export type RelationshipSource =
  /** A foreign key the domain wrote as part of its own operation. */
  | "domain"
  /** The bank matcher proposed it and a human confirmed it. */
  | "matching"
  /** A file import created both ends. */
  | "import";

export interface ContextRelation {
  type: RelationshipType;
  from: ContextNode;
  to: ContextNode;
  /** The carrier this edge was read from, as table.column. Traceability is not optional here. */
  carrier: string;
  source: RelationshipSource;
}

export interface ContextAnswer {
  centre: ContextNode;
  relations: readonly ContextRelation[];
  /**
   * How many edges exist that this actor may not see. Counted, never described: a refusal tells
   * somebody that there is more, and nothing about what.
   */
  withheld: number;
  /** True when a limit cut the answer short. A silent cap reads as "that was everything". */
  truncated: boolean;
}

/** The reader Context is given. It never makes its own. */
export interface ContextReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

export interface ContextOptions {
  /** Hard cap on relations returned. There is no unbounded context query. */
  limit?: number;
}

/** The default and the ceiling. §23: every query is bounded, and the bound is visible. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

function boundedLimit(o?: ContextOptions): number {
  const asked = o?.limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(asked)));
}

type Resource = { ownerId: string | null | undefined; createdBy?: string | null };

/**
 * May this actor see the far end of this edge?
 *
 * Resource level, always. The action-level question ("could they ever?") is what a screen asks
 * before drawing a button; a door that answered it here would hand over rows.
 *
 * ── AND EVIDENCE INHERITS THE RESOURCE, NOT ONLY THE PERMISSION ─────────────────────────────
 *
 * The first version inherited only the permission and the member tests caught it: a sales member
 * could not see the source document of an invoice they made themselves. The reason is exact — a
 * documents row has no created_by, invoice.read is scoped `own` for a member, and `own` denies a
 * resource whose creator cannot be proved. Correctly so: decision.ts refuses to guess.
 *
 * So a document inherits the whole question. "May I see this invoice's document" IS "may I see
 * this invoice", asked of the invoice's own row. What the document keeps for itself is the TENANT
 * check: its user_id must still be inside the administration, because inheriting a right must
 * never mean inheriting it across a boundary.
 */
function mayReach(
  context: ActingContext,
  from: EntityType,
  to: EntityType,
  resource: Resource,
): boolean {
  return authorize(context, readPermissionFor(to, from), resource).allowed;
}

/**
 * The resource an edge is authorized against.
 *
 * For everything except a document that is the row at the far end. For a document it is the row the
 * document is evidence FOR, plus the document's own owner as a separate tenant gate.
 */
function reachResource(to: EntityType, farRow: Resource, nearRow: Resource): Resource {
  return to === "document" ? nearRow : farRow;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  created_by: string | null;
  client_id: string | null;
  supplier_id: string | null;
  document_id: string | null;
  original_invoice_id: string | null;
}

const INVOICE_COLUMNS =
  "id, invoice_number, client_name, sender_id, receiver_id, created_by, client_id, supplier_id, " +
  "document_id, original_invoice_id";

/** The administration an invoice belongs to: sender for outgoing, receiver for incoming. */
function invoiceOwner(row: { sender_id: string | null; receiver_id: string | null }, context: ActingContext): string | null {
  if (row.sender_id && row.sender_id === context.ownerId) return row.sender_id;
  if (row.receiver_id && row.receiver_id === context.ownerId) return row.receiver_id;
  return row.sender_id ?? row.receiver_id;
}

function carrierOf(type: RelationshipType, from: EntityType, to: EntityType): string {
  const edge = RELATIONSHIP_EDGES.find((e) => e.type === type && e.from === from && e.to === to);
  // Every relation this file emits must correspond to a declared edge. A carrier that is not in
  // the vocabulary is a relationship nobody decided on.
  if (!edge) throw new Error(`[SAMENHANG] no declared edge for ${from} ${type} ${to}`);
  return edge.carrier;
}

/**
 * Everything related to one invoice, one step out.
 *
 * Depth one on purpose. "Load the whole customer graph" is the query the specification names as
 * the thing not to build, and a caller that wants the payment's bank line asks for the payment's
 * context — which is a second bounded question rather than an unbounded first one.
 */
export async function getInvoiceContext(
  db: ContextReader,
  context: ActingContext,
  invoiceId: string,
  options?: ContextOptions,
): Promise<ContextAnswer | null> {
  const limit = boundedLimit(options);

  const { data: invoice } = await db
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("id", invoiceId)
    .maybeSingle();
  const row = invoice as InvoiceRow | null;
  if (!row) return null;

  const owner = invoiceOwner(row, context);
  // The centre itself is a resource-level question. Failing it returns null rather than an empty
  // answer: "no context" and "not yours" must not look the same to a caller that logs one of them.
  if (!authorize(context, "invoice.read", { ownerId: owner, createdBy: row.created_by }).allowed) {
    return null;
  }

  const centre: ContextNode = {
    type: "invoice",
    id: row.id,
    label: row.invoice_number ?? row.client_name ?? "factuur",
  };
  const relations: ContextRelation[] = [];
  let withheld = 0;

  // Which way the edge points. Not cosmetic: ALLOCATED_TO and REFERS_TO point AT the invoice, and
  // the first version of this helper assumed every edge pointed away from the centre — which asked
  // the vocabulary for a "payment ALLOCATED_TO payment" carrier and threw. The direction decides
  // the carrier; the FAR node always decides the permission.
  const centreResource: Resource = { ownerId: owner, createdBy: row.created_by };
  const push = (
    type: RelationshipType,
    node: ContextNode,
    resource: Resource,
    source: RelationshipSource,
    direction: "out" | "in" = "out",
  ) => {
    // A document is evidence for the centre and is authorized as the centre; its own owner is
    // still checked, so inheriting a right never means inheriting it across an administration.
    if (node.type === "document" && resource.ownerId !== owner) { withheld++; return; }
    if (!mayReach(context, centre.type, node.type, reachResource(node.type, resource, centreResource))) {
      withheld++; return;
    }
    if (relations.length >= limit) return;
    const from = direction === "out" ? centre : node;
    const to = direction === "out" ? node : centre;
    relations.push({ type, from, to, carrier: carrierOf(type, from.type, to.type), source });
  };

  // BELONGS_TO — the counterpart. A customer for what went out, a supplier for what came in.
  if (row.client_id) {
    const { data: client } = await db
      .from("clients").select("id, name, user_id").eq("id", row.client_id).maybeSingle();
    const c = client as { id: string; name: string | null; user_id: string } | null;
    if (c) push("BELONGS_TO", { type: "customer", id: c.id, label: c.name ?? "klant" }, { ownerId: c.user_id }, "domain");
  }
  if (row.supplier_id) {
    const { data: supplier } = await db
      .from("suppliers").select("id, name, user_id").eq("id", row.supplier_id).maybeSingle();
    const s = supplier as { id: string; name: string | null; user_id: string } | null;
    if (s) push("BELONGS_TO", { type: "supplier", id: s.id, label: s.name ?? "leverancier" }, { ownerId: s.user_id }, "domain");
  }

  // ALLOCATED_TO — the payments placed against this invoice. The allocation row IS the payment.
  const { data: allocations } = await db
    .from("bank_tx_invoices")
    .select("id, user_id, transaction_id, paid_on, method")
    .eq("invoice_id", row.id)
    .order("paid_on", { ascending: false })
    .limit(limit);
  for (const a of (allocations ?? []) as Array<{ id: string; user_id: string; transaction_id: string | null; paid_on: string | null; method: string | null }>) {
    // The label carries the DAY and the WAY, never the amount: the amount is the Payment engine's
    // to state, and an amount echoed here is a second place for it to be wrong.
    const label = [a.paid_on ?? "", a.method ?? ""].filter(Boolean).join(" · ") || "betaling";
    push("ALLOCATED_TO", { type: "payment", id: a.id, label }, { ownerId: a.user_id },
      a.transaction_id ? "matching" : "domain", "in");
  }

  // CREATED_FROM — the document this invoice was read from, and the invoice it credits.
  if (row.document_id) {
    const { data: doc } = await db
      .from("documents").select("id, file_name, user_id, ai_doc_type").eq("id", row.document_id).maybeSingle();
    const d = doc as { id: string; file_name: string | null; user_id: string; ai_doc_type: string | null } | null;
    // A reminder is never the source of an invoice — [HERINNERING-NOOIT], and the vocabulary keeps
    // the two edges apart for exactly this reason. Such a row is residue, not a relationship.
    if (d && d.ai_doc_type !== DOC_TYPE_REMINDER) {
      push("CREATED_FROM", { type: "document", id: d.id, label: d.file_name ?? "document" }, { ownerId: d.user_id }, "import");
    }
  }
  if (row.original_invoice_id) {
    const { data: orig } = await db
      .from("invoices").select("id, invoice_number, sender_id, receiver_id, created_by").eq("id", row.original_invoice_id).maybeSingle();
    const o = orig as InvoiceRow | null;
    if (o) {
      push("CREATED_FROM", { type: "invoice", id: o.id, label: o.invoice_number ?? "factuur" },
        { ownerId: invoiceOwner(o, context), createdBy: o.created_by }, "domain");
    }
  }

  // REFERS_TO — reminders chasing this invoice. The other meaning of documents.invoice_id.
  const { data: reminders } = await db
    .from("documents")
    .select("id, file_name, user_id")
    .eq("invoice_id", row.id)
    .eq("ai_doc_type", DOC_TYPE_REMINDER)
    .limit(limit);
  for (const r of (reminders ?? []) as Array<{ id: string; file_name: string | null; user_id: string }>) {
    push("REFERS_TO", { type: "document", id: r.id, label: r.file_name ?? "herinnering" },
      { ownerId: r.user_id }, "import", "in");
  }

  return { centre, relations, withheld, truncated: relations.length >= limit };
}

/**
 * Everything related to one payment: the invoice it settles and the bank line it came from.
 *
 * A payment here is a bank_tx_invoices row, because that is what a payment IS in this product —
 * 150 of the 442 have no bank line at all, so a model that defined a payment as a property of a
 * transaction would not be able to name a third of them.
 */
export async function getPaymentContext(
  db: ContextReader,
  context: ActingContext,
  paymentId: string,
  options?: ContextOptions,
): Promise<ContextAnswer | null> {
  const limit = boundedLimit(options);

  const { data } = await db
    .from("bank_tx_invoices")
    .select("id, user_id, transaction_id, invoice_id, paid_on, method")
    .eq("id", paymentId)
    .maybeSingle();
  const pay = data as { id: string; user_id: string; transaction_id: string | null; invoice_id: string; paid_on: string | null; method: string | null } | null;
  if (!pay) return null;
  if (!authorize(context, "payment.read", { ownerId: pay.user_id }).allowed) return null;

  const centre: ContextNode = {
    type: "payment",
    id: pay.id,
    label: [pay.paid_on ?? "", pay.method ?? ""].filter(Boolean).join(" · ") || "betaling",
  };
  const relations: ContextRelation[] = [];
  let withheld = 0;

  const { data: inv } = await db
    .from("invoices").select(INVOICE_COLUMNS).eq("id", pay.invoice_id).maybeSingle();
  const i = inv as InvoiceRow | null;
  if (i) {
    const resource = { ownerId: invoiceOwner(i, context), createdBy: i.created_by };
    if (mayReach(context, "payment", "invoice", resource)) {
      relations.push({
        type: "ALLOCATED_TO", from: centre,
        to: { type: "invoice", id: i.id, label: i.invoice_number ?? i.client_name ?? "factuur" },
        carrier: carrierOf("ALLOCATED_TO", "payment", "invoice"), source: "domain",
      });
    } else withheld++;
  }

  if (pay.transaction_id) {
    const { data: tx } = await db
      .from("bank_transactions")
      .select("id, user_id, date, counterpart_name, description")
      .eq("id", pay.transaction_id)
      .maybeSingle();
    const t = tx as { id: string; user_id: string; date: string | null; counterpart_name: string | null; description: string | null } | null;
    if (t) {
      if (mayReach(context, "payment", "bank_transaction", { ownerId: t.user_id })) {
        const label = t.counterpart_name || t.description || t.date || "bankregel";
        relations.push({
          type: "REPRESENTS",
          from: { type: "bank_transaction", id: t.id, label },
          to: centre,
          carrier: carrierOf("REPRESENTS", "bank_transaction", "payment"), source: "matching",
        });
      } else withheld++;
    }
  }

  return { centre, relations, withheld, truncated: relations.length >= limit };
}

/**
 * Where this thing came from, following CREATED_FROM upwards.
 *
 * Bounded by depth, and the bound is small. A lineage that walked until it ran out would be an
 * unbounded query wearing a friendly name, and [SAMENHANG] has none of those.
 */
export const MAX_LINEAGE_DEPTH = 4;

export async function getLineage(
  db: ContextReader,
  context: ActingContext,
  invoiceId: string,
  depth: number = MAX_LINEAGE_DEPTH,
): Promise<readonly ContextNode[]> {
  const steps = Math.max(1, Math.min(MAX_LINEAGE_DEPTH, Math.floor(depth)));
  const chain: ContextNode[] = [];
  const seen = new Set<string>();
  let currentId: string | null = invoiceId;

  for (let i = 0; i < steps && currentId; i++) {
    // A cycle is not impossible in a self-referencing column, and a lineage walk that met one
    // would loop until the request died.
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const { data } = await db
      .from("invoices").select(INVOICE_COLUMNS).eq("id", currentId).maybeSingle();
    const row = data as InvoiceRow | null;
    if (!row) break;
    const owner = invoiceOwner(row, context);
    if (!authorize(context, "invoice.read", { ownerId: owner, createdBy: row.created_by }).allowed) break;

    chain.push({ type: "invoice", id: row.id, label: row.invoice_number ?? row.client_name ?? "factuur" });
    currentId = row.original_invoice_id;
  }

  return chain;
}
