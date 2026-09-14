// [SAMENHANG] Node test with a fake reader — run: npx tsx --test src/lib/context/query.test.ts
//
// The point of these is the REFUSALS. A context layer that returns the right rows to an owner is
// easy; one that returns the right SUBSET to a sales member, counts what it withheld, and never
// says what it withheld, is the thing worth testing. None of it needs a database, because
// query.ts creates no client — the reader is handed in.

import test from "node:test";
import assert from "node:assert/strict";

import { getInvoiceContext, getPaymentContext, getLineage, DEFAULT_LIMIT, MAX_LIMIT } from "./query";
import type { ActingContext } from "@/lib/access/decision";
// The fixture spells the marker through the constant, not by hand: a fixture that drifts from the
// column it stands for is a test that keeps passing about something that no longer happens.
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";

const OWNER = "owner-1";
const MEMBER = "member-1";
const ACCOUNTANT = "acc-1";

const asOwner: ActingContext = { actorId: OWNER, ownerId: OWNER, role: "eigenaar", mandatedOwnerIds: [], confirmMandatedOwnerIds: [] };
const asMember: ActingContext = { actorId: MEMBER, ownerId: OWNER, role: "verkoop", mandatedOwnerIds: [], confirmMandatedOwnerIds: [] };
const asAccountant: ActingContext = { actorId: ACCOUNTANT, ownerId: OWNER, role: "boekhouder", mandatedOwnerIds: [OWNER], confirmMandatedOwnerIds: [] };

/** Rows the fake database holds. One outgoing invoice with a customer, a payment and a document. */
function makeDb(overrides: Partial<Record<string, unknown[]>> = {}) {
  const tables: Record<string, unknown[]> = {
    invoices: [{
      id: "inv-1", invoice_number: "2026001", client_name: "Bakkerij Jansen",
      sender_id: OWNER, receiver_id: null, created_by: MEMBER,
      client_id: "cli-1", supplier_id: null, document_id: "doc-1", original_invoice_id: null,
    }],
    clients: [{ id: "cli-1", name: "Bakkerij Jansen", user_id: OWNER }],
    suppliers: [],
    bank_tx_invoices: [{
      id: "pay-1", user_id: OWNER, transaction_id: "tx-1", invoice_id: "inv-1",
      paid_on: "2026-03-01", method: "bank",
    }],
    documents: [{ id: "doc-1", file_name: "factuur.pdf", user_id: OWNER, ai_doc_type: "invoice", invoice_id: "inv-1" }],
    bank_transactions: [{ id: "tx-1", user_id: OWNER, date: "2026-03-01", counterpart_name: "Bakkerij Jansen", description: "betaling" }],
    ...overrides,
  };

  // A tiny query builder: enough of the supabase-js surface for the shapes query.ts uses.
  const build = (table: string) => {
    let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
    const api: Record<string, unknown> = {
      select: () => api,
      order: () => api,
      limit: (n: number) => { rows = rows.slice(0, n); return Promise.resolve({ data: rows }); },
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return api; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
      then: (res: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(res),
    };
    return api;
  };
  return { from: build };
}

test("[SAMENHANG] the owner sees the whole neighbourhood of an invoice", async () => {
  const answer = await getInvoiceContext(makeDb(), asOwner, "inv-1");
  assert.ok(answer, "the owner could not reach their own invoice");
  const kinds = answer!.relations.map((r) => `${r.type}:${r.to.type === "invoice" ? r.from.type : r.to.type}`);
  assert.ok(kinds.includes("BELONGS_TO:customer"), "the customer edge is missing");
  assert.ok(kinds.includes("ALLOCATED_TO:payment"), "the payment edge is missing");
  assert.ok(kinds.includes("CREATED_FROM:document"), "the source document edge is missing");
  assert.equal(answer!.withheld, 0, "something was withheld from the owner of the administration");
});

test("[SAMENHANG] a sales member sees the customer and not the money, and is told so", async () => {
  // The payoff: nothing in query.ts mentions roles. This subset comes out of the permission
  // catalogue through the far-end rule.
  const answer = await getInvoiceContext(makeDb(), asMember, "inv-1");
  assert.ok(answer, "a member could not reach the invoice they created themselves");
  const reached = answer!.relations.map((r) => (r.to.type === "invoice" ? r.from.type : r.to.type));
  assert.ok(reached.includes("customer"), "a member lost sight of the customer");
  assert.ok(reached.includes("document"), "a member cannot see the document of their own invoice");
  assert.ok(!reached.includes("payment"), "a member reached a payment");
  // And the answer does not pretend to be complete.
  assert.ok(answer!.withheld >= 1,
    "the member was shown a shorter answer with no sign that anything was withheld — that is the " +
      "silent-empty failure, one layer up");
  // What was withheld must not be described anywhere in the answer.
  assert.ok(!JSON.stringify(answer).includes("pay-1"), "a refused edge leaked its id");
});

test("[SAMENHANG] an invoice the member did not create is not theirs to open", async () => {
  const db = makeDb({
    invoices: [{
      id: "inv-2", invoice_number: "2026002", client_name: "X", sender_id: OWNER, receiver_id: null,
      created_by: "someone-else", client_id: "cli-1", supplier_id: null, document_id: null, original_invoice_id: null,
    }],
  });
  assert.equal(await getInvoiceContext(db, asMember, "inv-2"), null,
    "a member reached the context of an invoice a colleague made");
  // Null, not an empty answer: "no context" and "not yours" must not look the same to a caller.
  assert.ok(await getInvoiceContext(db, asOwner, "inv-2"), "the owner lost their own invoice");
});

test("[SAMENHANG] an invoice from another administration is invisible even to its own owner role", async () => {
  const db = makeDb({
    invoices: [{
      id: "inv-3", invoice_number: "X", client_name: "X", sender_id: "someone-else", receiver_id: null,
      created_by: null, client_id: null, supplier_id: null, document_id: null, original_invoice_id: null,
    }],
  });
  assert.equal(await getInvoiceContext(db, asOwner, "inv-3"), null, "a context crossed a tenant boundary");
  assert.equal(await getInvoiceContext(db, asAccountant, "inv-3"), null,
    "a mandated accountant reached outside the administration that mandated them");
});

test("[SAMENHANG] a reminder is never returned as the source of an invoice", async () => {
  // [HERINNERING-NOOIT] in the graph: documents.invoice_id means two things, and only one of them
  // is CREATED_FROM. A flattened layer would answer "what is this invoice made of" with the letter
  // chasing it.
  const db = makeDb({
    documents: [{ id: "doc-1", file_name: "Eerste herinnering.pdf", user_id: OWNER, ai_doc_type: DOC_TYPE_REMINDER, invoice_id: "inv-1" }],
  });
  const answer = await getInvoiceContext(db, asOwner, "inv-1");
  const created = answer!.relations.filter((r) => r.type === "CREATED_FROM" && r.to.type === "document");
  assert.equal(created.length, 0, "a payment reminder was returned as the document an invoice was made from");
  const refers = answer!.relations.filter((r) => r.type === "REFERS_TO");
  assert.equal(refers.length, 1, "the reminder did not come back as what it is");
  assert.equal(refers[0].from.type, "document", "REFERS_TO points the wrong way");
});

test("[SAMENHANG] a payment names its invoice and its bank line, and nothing about amounts", async () => {
  const answer = await getPaymentContext(makeDb(), asOwner, "pay-1");
  assert.ok(answer, "the owner could not reach their own payment");
  const types = answer!.relations.map((r) => r.type);
  assert.ok(types.includes("ALLOCATED_TO"), "the payment lost the invoice it settles");
  assert.ok(types.includes("REPRESENTS"), "the payment lost the bank line it came from");
  // One Fact -> One Owner, mechanically: nothing an amount could hide in.
  const serialised = JSON.stringify(answer);
  assert.doesNotMatch(serialised, /amount|bedrag|total|saldo/i,
    "a money field reached the context answer — the Payment engine owns that, and a second place " +
      "for it is a second place for it to be wrong");
  assert.doesNotMatch(serialised, /"status"|betaald|openstaand/i,
    "a domain STATE reached the context answer");
});

test("[SAMENHANG] a payment of another administration is not reachable", async () => {
  const db = makeDb({
    bank_tx_invoices: [{ id: "pay-9", user_id: "someone-else", transaction_id: null, invoice_id: "inv-1", paid_on: null, method: null }],
  });
  assert.equal(await getPaymentContext(db, asOwner, "pay-9"), null, "a payment crossed a tenant boundary");
});

test("[SAMENHANG] lineage is bounded, and a cycle cannot spin it", async () => {
  // A self-referencing column can hold a cycle, and a walk that met one would loop until the
  // request died.
  const db = makeDb({
    invoices: [
      { id: "a", invoice_number: "A", client_name: null, sender_id: OWNER, receiver_id: null, created_by: null, client_id: null, supplier_id: null, document_id: null, original_invoice_id: "b" },
      { id: "b", invoice_number: "B", client_name: null, sender_id: OWNER, receiver_id: null, created_by: null, client_id: null, supplier_id: null, document_id: null, original_invoice_id: "a" },
    ],
  });
  const chain = await getLineage(db, asOwner, "a");
  assert.deepEqual(chain.map((n) => n.id), ["a", "b"], "the walk did not stop at the cycle");

  // And the depth is capped no matter what a caller asks for.
  const deep = await getLineage(db, asOwner, "a", 9999);
  assert.ok(deep.length <= 4, "the lineage depth cap can be argued away by a caller");
});

test("[SAMENHANG] there is no unbounded context query", async () => {
  assert.ok(DEFAULT_LIMIT > 0 && DEFAULT_LIMIT <= MAX_LIMIT);
  const answer = await getInvoiceContext(makeDb(), asOwner, "inv-1", { limit: 100000 });
  assert.ok(answer!.relations.length <= MAX_LIMIT, "a caller raised the limit past the ceiling");
  const one = await getInvoiceContext(makeDb(), asOwner, "inv-1", { limit: 1 });
  assert.equal(one!.relations.length, 1, "the limit did not bind");
  assert.equal(one!.truncated, true, "a cut answer did not say it was cut");
});
