// [SAMENHANG] Pure node test — run: npx tsx --test src/lib/context/vocabulary.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  RELATIONSHIP_EDGES, RELATIONSHIP_TYPES, ENTITY_TYPES, DEFERRED_TYPES,
  edgesFrom, edgesTo, readPermissionFor, type RelationshipType,
} from "./vocabulary";
import { PERMISSIONS, scopeFor } from "@/lib/access/permissions";
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";

test("[SAMENHANG] no relationship type exists without an edge that uses it", () => {
  // The rule that keeps the vocabulary small. A type nobody carries is a guess about the future
  // wearing the clothes of a decision.
  for (const t of RELATIONSHIP_TYPES) {
    assert.ok(RELATIONSHIP_EDGES.some((e) => e.type === t),
      `${t} is declared and no edge uses it`);
  }
  for (const e of RELATIONSHIP_EDGES) {
    assert.ok((RELATIONSHIP_TYPES as readonly string[]).includes(e.type),
      `${e.carrier} uses ${e.type}, which is not a declared type`);
    assert.ok((ENTITY_TYPES as readonly string[]).includes(e.from), `${e.carrier}: unknown from`);
    assert.ok((ENTITY_TYPES as readonly string[]).includes(e.to), `${e.carrier}: unknown to`);
  }
});

test("[SAMENHANG] a refused type says which empty carrier refused it", () => {
  // Written down rather than omitted, for the same reason ROLE_SCOPES writes "none": a type that
  // is missing and a type that was considered and refused look identical in a short list.
  for (const [name, reason] of Object.entries(DEFERRED_TYPES)) {
    assert.ok(!(RELATIONSHIP_TYPES as readonly string[]).includes(name as RelationshipType),
      `${name} is both deferred and in use`);
    assert.ok(reason.length >= 80,
      `${name} was refused without naming the carrier that is empty — then nobody can tell when it ` +
        "stops being empty");
    assert.match(reason, /\b0\b|empty|zero/i, `${name} claims no measurement`);
  }
  assert.equal(Object.keys(DEFERRED_TYPES).length, 3,
    "the three refused types are ATTACHED_TO, ASSIGNED_TO and REVIEWED_BY — if one was promoted, " +
      "its carrier must have rows and the edge must be here");
});

test("[SAMENHANG] every edge names one authoritative carrier and the ones it shadows", () => {
  for (const e of RELATIONSHIP_EDGES) {
    assert.match(e.carrier, /^[a-z_]+\.[a-z_]+/, `${e.type} has no table.column carrier`);
    assert.ok(!e.shadowedBy.includes(e.carrier), `${e.carrier} shadows itself`);
    assert.ok(e.tenancy.length >= 20, `${e.carrier} does not say what keeps it inside one administration`);
    assert.ok(e.why.length >= 60, `${e.carrier} carries no reason a later reader can argue with`);
    assert.ok(Number.isInteger(e.measured) && e.measured >= 0, `${e.carrier} has no measurement`);
  }
  // One carrier may be authoritative for exactly one edge. Two edges claiming the same column is
  // the duplication this whole layer exists to refuse.
  const carriers = RELATIONSHIP_EDGES.map((e) => e.carrier);
  assert.equal(new Set(carriers).size, carriers.length, "two edges claim the same authoritative carrier");
});

test("[SAMENHANG] the shortcut on a bank line is named as shadowed, never as truth", () => {
  // 35 bank lines are allocated to more than one invoice, so bank_transactions.invoice_id cannot
  // hold the answer even in principle. If it ever becomes an edge's carrier, this fails.
  const represents = RELATIONSHIP_EDGES.find((e) => e.type === "REPRESENTS");
  assert.ok(represents, "the bank-to-payment edge is gone");
  assert.equal(represents!.carrier, "bank_tx_invoices.transaction_id");
  assert.ok(represents!.shadowedBy.includes("bank_transactions.invoice_id"),
    "the denormalised column stopped being marked as a shadow");
  for (const e of RELATIONSHIP_EDGES) {
    assert.notEqual(e.carrier, "bank_transactions.invoice_id",
      "a column that cannot represent 35 existing rows is being used as an authoritative carrier");
  }
  // And the paid-state cache may never be an edge either.
  const allocated = RELATIONSHIP_EDGES.find((e) => e.type === "ALLOCATED_TO");
  assert.equal(allocated!.carrier, "bank_tx_invoices.invoice_id");
  assert.ok(allocated!.shadowedBy.some((s) => s.startsWith("invoices.amount_paid")),
    "the amount_paid cache stopped being marked as a shadow of the allocation rows");
});

test("[SAMENHANG] the two meanings of documents.invoice_id stay two edges", () => {
  // One column, two relationships, split on ai_doc_type. A Context layer that flattened them would
  // answer "what is this invoice made of" with the letter chasing it.
  const source = RELATIONSHIP_EDGES.find((e) => e.type === "CREATED_FROM" && e.from === "invoice" && e.to === "document");
  const about = RELATIONSHIP_EDGES.find((e) => e.type === "REFERS_TO");
  assert.ok(source && about, "the source edge and the reminder edge are not both present");
  assert.ok(about!.carrier.includes(`= '${DOC_TYPE_REMINDER}'`),
    "the REFERS_TO edge no longer distinguishes itself by document kind — then it is the same " +
      "column saying two things again");
  assert.ok(source!.shadowedBy.includes("documents.invoice_id"),
    "the reverse direction of the source edge stopped being marked as a shadow");
});

test("[SAMENHANG] every edge is gated by a permission that exists, and the far end decides", () => {
  for (const e of RELATIONSHIP_EDGES) {
    assert.ok((PERMISSIONS as readonly string[]).includes(e.readPermission),
      `${e.carrier} is gated by ${e.readPermission}, which is not in the catalogue`);
    // The rule: the permission on the edge is the permission of the entity it REACHES — and for a
    // document, of the thing that document is evidence FOR. This assertion caught the first
    // version of the design, which gave every document invoice.read and would therefore have let
    // a sales member reach a bank statement through the document door.
    assert.equal(e.readPermission, readPermissionFor(e.to, e.from),
      `${e.carrier} is gated by ${e.readPermission} but reaches a ${e.to} from a ${e.from}, which ` +
        `is governed by ${readPermissionFor(e.to, e.from)}. An edge is visible when its far end ` +
        "is — that is the whole authorization design, and an exception to it is a second rule.");
  }
});

test("[SAMENHANG] a sales member reaches an invoice's customer and never its money", () => {
  // The payoff of the far-end rule: this falls out of the permission catalogue, and NOTHING in
  // this module mentions roles. If someone widens verkoop's payment.read, this test changes with
  // the product instead of guarding a copy of it.
  const reachable = (role: "eigenaar" | "verkoop" | "boekhouder") =>
    RELATIONSHIP_EDGES.filter((e) => scopeFor(role, e.readPermission) !== "none").map((e) => `${e.type}:${e.to}`);

  const verkoop = reachable("verkoop");
  assert.ok(verkoop.includes("BELONGS_TO:customer"), "a sales member lost sight of the customer");
  assert.ok(verkoop.includes("CREATED_FROM:document"), "a sales member cannot see their own invoice's document");
  assert.ok(!verkoop.some((r) => r.endsWith(":payment")), "a sales member reached a payment");
  assert.ok(!verkoop.some((r) => r.endsWith(":bank_transaction")), "a sales member reached the bank");
  assert.ok(!verkoop.includes("BELONGS_TO:supplier"), "a sales member reached a supplier");

  // An owner reaches everything inside their own administration.
  assert.equal(reachable("eigenaar").length, RELATIONSHIP_EDGES.length);
  // An accountant reaches the reading side of every edge — through a mandate, which authorize()
  // proves per resource; this only asserts the capability is not "none".
  assert.equal(reachable("boekhouder").length, RELATIONSHIP_EDGES.length);
});

test("[SAMENHANG] the lookups agree with the table", () => {
  assert.equal(edgesFrom("invoice").length, RELATIONSHIP_EDGES.filter((e) => e.from === "invoice").length);
  assert.equal(edgesTo("document").length, RELATIONSHIP_EDGES.filter((e) => e.to === "document").length);
  for (const t of ENTITY_TYPES) {
    assert.ok((PERMISSIONS as readonly string[]).includes(readPermissionFor(t)),
      `${t} maps to a permission that does not exist`);
    // And every near/far combination resolves, including the document inheritance.
    for (const from of ENTITY_TYPES) {
      assert.ok((PERMISSIONS as readonly string[]).includes(readPermissionFor(t, from)),
        `${t} reached from ${from} maps to a permission that does not exist`);
    }
  }
  // A document reached from a bank line is bank evidence; from an invoice it is invoice evidence.
  assert.equal(readPermissionFor("document", "bank_transaction"), "bank.read");
  assert.equal(readPermissionFor("document", "invoice"), "invoice.read");
  assert.equal(readPermissionFor("document"), "invoice.read", "the fallback stopped being the narrow one");
});
