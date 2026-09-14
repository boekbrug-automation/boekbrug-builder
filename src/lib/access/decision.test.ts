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

// ── The catalogue is a READING of the shipped rules, and this is what makes that claim checkable ──
//
// permissions.ts used to say a boekhouder holds `invoice.send` NOWHERE. That was not a policy
// decision written down, it was an opinion written down — the product has shipped accountant
// invoicing since [CREDIT-NAMENS], and /api/invoice/send has carried `namens_klant_id` for as
// long. A route migrated onto the catalogue as it stood would have taken a live feature away from
// every mandated accountant, silently, on a door that mints invoice numbers.
//
// So the equivalence is asserted exhaustively rather than asserted in prose: for the three roles
// and every combination of "whose administration" and "who created it", authorize() and
// canAccessInvoice() must give the same answer. Whichever of the two moves first, this fails.

test("[EEN-POORT] authorize() and canAccessInvoice() are the same rule, on every combination", async () => {
  const { canAccessInvoice } = await import("../acting-for");

  const actors: Array<{ label: string; acting: import("../acting-for").ActingFor; ctx: ActingContext }> = [
    {
      label: "eigenaar",
      acting: { ownerId: "u1", actorId: "u1", role: "eigenaar" },
      ctx: { actorId: "u1", ownerId: "u1", role: "eigenaar", mandatedOwnerIds: [], confirmMandatedOwnerIds: [] },
    },
    {
      label: "verkoop",
      acting: { ownerId: "u1", actorId: "m1", role: "verkoop" },
      ctx: { actorId: "m1", ownerId: "u1", role: "verkoop", mandatedOwnerIds: [], confirmMandatedOwnerIds: [] },
    },
    {
      label: "boekhouder",
      acting: { ownerId: "u1", actorId: "a1", role: "boekhouder" },
      ctx: { actorId: "a1", ownerId: "u1", role: "boekhouder", mandatedOwnerIds: ["u1"], confirmMandatedOwnerIds: [] },
    },
  ];
  const rows = [
    { sender_id: "u1", created_by: "u1" },
    { sender_id: "u1", created_by: "m1" },
    { sender_id: "u1", created_by: "a1" },
    { sender_id: "u1", created_by: null },
    { sender_id: "other", created_by: "m1" },
    { sender_id: null, created_by: "m1" },
  ];
  // The three capabilities the two invoice money doors ask for. invoice.read is deliberately NOT
  // among them and is asserted separately below: canAccessInvoice() is the ISSUING rule, and
  // reading is wider on purpose for an accountant (canRemindInvoice explains why — a chase-list
  // scoped to the invoices the accountant happened to type is not a chase-list).
  const permissions = ["invoice.send", "invoice.finalize", "invoice.credit"] as const;

  let checked = 0;
  for (const { label, acting, ctx } of actors) {
    for (const row of rows) {
      const oud = canAccessInvoice(acting, row);
      for (const p of permissions) {
        const nieuw = authorize(ctx, p, { ownerId: row.sender_id, createdBy: row.created_by }).allowed;
        assert.equal(
          nieuw,
          oud,
          `${label} · ${p} · sender=${String(row.sender_id)} created_by=${String(row.created_by)}: ` +
            `catalogue says ${nieuw}, acting-for.ts says ${oud}`,
        );
        checked++;
      }
    }
  }
  assert.equal(checked, 3 * 6 * 3, "the equivalence was asserted over fewer cases than it claims");
});

test("[EEN-POORT] invoice.read is wider than canAccessInvoice, and exactly as wide as reminding", async () => {
  // The one place the catalogue deliberately does NOT mirror canAccessInvoice, so it is pinned
  // against the rule it DOES mirror. A mandated accountant reaches every invoice of that client —
  // canRemindInvoice says why in full — while a sales member stays on what they typed.
  const { canRemindInvoice } = await import("../acting-for");
  const actors = [
    { label: "eigenaar", acting: { ownerId: "u1", actorId: "u1", role: "eigenaar" as const },
      ctx: { actorId: "u1", ownerId: "u1", role: "eigenaar" as const, mandatedOwnerIds: [], confirmMandatedOwnerIds: [] } },
    { label: "verkoop", acting: { ownerId: "u1", actorId: "m1", role: "verkoop" as const },
      ctx: { actorId: "m1", ownerId: "u1", role: "verkoop" as const, mandatedOwnerIds: [], confirmMandatedOwnerIds: [] } },
    { label: "boekhouder", acting: { ownerId: "u1", actorId: "a1", role: "boekhouder" as const },
      ctx: { actorId: "a1", ownerId: "u1", role: "boekhouder" as const, mandatedOwnerIds: ["u1"], confirmMandatedOwnerIds: [] } },
  ];
  const rows = [
    { sender_id: "u1", created_by: "u1" },
    { sender_id: "u1", created_by: "m1" },
    { sender_id: "u1", created_by: "a1" },
    { sender_id: "other", created_by: "m1" },
  ];
  for (const { label, acting, ctx } of actors) {
    for (const row of rows) {
      // reminders_paused is left off: it is the owner overruling a decision, not a capability.
      const oud = canRemindInvoice(acting, row).allowed;
      const nieuw = authorize(ctx, "invoice.read", { ownerId: row.sender_id, createdBy: row.created_by }).allowed;
      assert.equal(nieuw, oud,
        `${label} · invoice.read · sender=${row.sender_id} created_by=${row.created_by}: ` +
          `catalogue says ${nieuw}, acting-for.ts says ${oud}`);
    }
  }
});

test("[EEN-POORT] an invoicing mandate is not a confirming mandate, and the reverse", () => {
  // Two switches a client sets separately. Reading either as the other is the widening
  // accountant-mandate.ts exists to prevent — and until MANDATE_PROOF existed the catalogue had
  // one notion of "mandated" and could not tell them apart at all.
  const invoicing: ActingContext = {
    actorId: "a1", ownerId: "c1", role: "boekhouder",
    mandatedOwnerIds: ["c1"], confirmMandatedOwnerIds: [],
  };
  const confirming: ActingContext = {
    actorId: "a1", ownerId: "c1", role: "boekhouder",
    mandatedOwnerIds: [], confirmMandatedOwnerIds: ["c1"],
  };
  const resource = { ownerId: "c1" };

  assert.equal(authorize(invoicing, "expense.approve", resource).allowed, false,
    "an invoicing mandate signed off the client's books");
  assert.equal(authorize(confirming, "expense.approve", resource).allowed, true,
    "the confirming mandate no longer reaches the capability it is the proof for");

  assert.equal(authorize(invoicing, "invoice.read", resource).allowed, true,
    "the invoicing mandate stopped reaching the client's invoices");
  assert.equal(authorize(confirming, "invoice.read", resource).allowed, false,
    "a confirming-only mandate reached the invoicing capabilities");

  // And a missing list is never a wildcard, in either direction.
  const naked: ActingContext = { actorId: "a1", ownerId: "c1", role: "boekhouder" };
  assert.equal(authorize(naked, "expense.approve", resource).allowed, false);
  assert.equal(authorize(naked, "invoice.read", resource).allowed, false);
});
