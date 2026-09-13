// [EEN-POORT] Pure node test — run: npx tsx --test src/lib/access/decision.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { authorize, type ActingContext } from "./decision";

const OWNER: ActingContext = { actorId: "u1", ownerId: "u1", role: "eigenaar" };
const MEMBER: ActingContext = { actorId: "m1", ownerId: "u1", role: "verkoop" };
const ACCOUNTANT: ActingContext = { actorId: "a1", ownerId: "c1", role: "boekhouder", mandatedOwnerIds: ["c1"] };

test("[EEN-POORT] no context is a DENY, never a pass-through", () => {
  for (const bad of [null, undefined, { actorId: "", ownerId: "u1", role: "eigenaar" } as ActingContext]) {
    const d = authorize(bad, "invoice.read");
    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.equal(d.reasonCode, "access.no_session");
  }
});

test("[EEN-POORT] an action-level question and a resource-level question are different", () => {
  // Without a resource: could this actor EVER do it (a screen deciding whether to draw a button).
  assert.equal(authorize(MEMBER, "invoice.send").allowed, true);
  // With one: may they do it HERE. Only a door may act on this answer.
  assert.equal(authorize(MEMBER, "invoice.send", { ownerId: "u1", createdBy: "m1" }).allowed, true);
  assert.equal(authorize(MEMBER, "invoice.send", { ownerId: "u1", createdBy: "someone-else" }).allowed, false);
});

test("[EEN-POORT] 'own' cannot be proved without a recorded creator, so it denies", () => {
  for (const createdBy of [null, undefined, ""]) {
    const d = authorize(MEMBER, "invoice.update", { ownerId: "u1", createdBy });
    assert.equal(d.allowed, false, `createdBy=${String(createdBy)} was read as the member's own`);
    if (d.allowed) return;
    assert.equal(d.reasonCode, "access.out_of_scope");
  }
});

test("[EEN-POORT] another administration is refused even with the permission", () => {
  const d = authorize(OWNER, "invoice.read", { ownerId: "someone-else" });
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reasonCode, "access.other_administration");
  // A resource with no owner cannot be placed in a tenant, and unplaceable is deny.
  assert.equal(authorize(OWNER, "invoice.read", { ownerId: null }).allowed, false);
});

test("[EEN-POORT] an accountant without a mandate for THIS administration reaches nothing", () => {
  assert.equal(authorize(ACCOUNTANT, "invoice.read", { ownerId: "c1" }).allowed, true);
  const other = authorize(ACCOUNTANT, "invoice.read", { ownerId: "c2" });
  assert.equal(other.allowed, false);
  if (other.allowed) return;
  assert.equal(other.reasonCode, "access.no_mandate");
  // An EMPTY mandate list is not a wildcard — that is the whole difference between holding the
  // accountant role and being allowed near a particular client.
  const bare = { ...ACCOUNTANT, mandatedOwnerIds: [] };
  assert.equal(authorize(bare, "invoice.read", { ownerId: "c1" }).allowed, false);
  const none = { ...ACCOUNTANT, mandatedOwnerIds: undefined };
  assert.equal(authorize(none, "invoice.read", { ownerId: "c1" }).allowed, false);
});

test("[EEN-POORT] a capability the role does not hold is refused before scope is considered", () => {
  const d = authorize(ACCOUNTANT, "payment.refund", { ownerId: "c1" });
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reasonCode, "access.missing_permission");
});

test("[EEN-POORT] an unknown permission and an unknown role both fail closed", () => {
  const p = authorize(OWNER, "invoice.explode");
  assert.equal(p.allowed, false);
  if (p.allowed) return;
  assert.equal(p.reasonCode, "access.unknown_permission");

  const r = authorize({ ...OWNER, role: "koning" as never }, "invoice.read");
  assert.equal(r.allowed, false);
  if (r.allowed) return;
  assert.equal(r.reasonCode, "access.unknown_role");
});

test("[EEN-POORT] a refusal never says whether the resource exists or whose it is", () => {
  const d = authorize(MEMBER, "bank.read", { ownerId: "someone-else", createdBy: "x" });
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.deepEqual(Object.keys(d).sort(), ["allowed", "permission", "reasonCode", "scope"]);
  assert.ok(!JSON.stringify(d).includes("someone-else"), "the refusal leaked the resource's owner");
});
