// [EEN-POORT] Pure node test — run: npx tsx --test src/lib/access/permissions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  PERMISSIONS, PROTECTED_OPERATIONS, ROLE_SCOPES, isPermission, scopeFor,
  type AccessRole, type Permission,
} from "./permissions";

const ROLES: AccessRole[] = ["eigenaar", "verkoop", "boekhouder"];

test("[EEN-POORT] every role names every permission — a gap is not a refusal", () => {
  // A role that OMITS a permission and a role that is REFUSED it look identical in a partial map,
  // and only one of them was decided by a person. So the maps are total, and this proves it.
  for (const role of ROLES) {
    for (const p of PERMISSIONS) {
      assert.ok(p in ROLE_SCOPES[role], `${role} has no entry for ${p}`);
    }
    assert.equal(Object.keys(ROLE_SCOPES[role]).length, PERMISSIONS.length,
      `${role} names a permission that is not in the catalogue`);
  }
});

test("[EEN-POORT] the catalogue has no duplicates and the protected list is part of it", () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length, "a permission is declared twice");
  for (const p of PROTECTED_OPERATIONS) {
    assert.ok(PERMISSIONS.includes(p), `${p} is protected but not a permission`);
  }
});

test("[EEN-POORT] no role may move money or close a period except the owner", () => {
  // The one asymmetry worth pinning: [GEEN-ACHTERDEUR] and the accountant-amount trigger both say
  // an accountant may change what the books say about themselves, never what they contain.
  const moneyMoves: Permission[] = [
    "payment.create", "payment.refund", "payment.allocate", "bank.match",
    "vat.submit", "period.close", "period.reopen",
  ];
  for (const p of moneyMoves) {
    assert.equal(scopeFor("boekhouder", p), "none", `an accountant may ${p}`);
    assert.equal(scopeFor("verkoop", p), "none", `a sales member may ${p}`);
    assert.equal(scopeFor("eigenaar", p), "administration", `the owner may not ${p}`);
  }
});

test("[EEN-POORT] an accountant never reaches further than a mandate", () => {
  // This used to read `s === "none" || s === "mandated"`, and it failed the day the catalogue was
  // corrected against the rules the product actually ships. The letter was wrong, not the code:
  // `own` is NARROWER than `mandated`, not wider. It requires the resource to belong to the
  // administration being acted for — which for an accountant is only ever the one
  // getActingForClient() proved — AND the row to have been created by this actor. A mandate is
  // permission to write invoices in someone's name; it was never permission to finish or re-price
  // the ones the client wrote themselves, and `own` is how the catalogue says that.
  //
  // The scope that WOULD reach past a mandate is `administration`: everything in the client's
  // books, regardless of who made it. That is the one an accountant may never hold.
  for (const p of PERMISSIONS) {
    const s = scopeFor("boekhouder", p);
    assert.notEqual(s, "administration",
      `an accountant holds ${p} over the whole administration — that reaches past the mandate`);
  }
});

test("[EEN-POORT] what an accountant may WRITE stays narrowed to what they made themselves", () => {
  // Pinned one by one rather than by a predicate, because the drift that matters here is from
  // `own` to `mandated` — still "inside the mandate", still a widening from "the invoices I typed
  // for this client" to "every invoice this client has". canAccessInvoice() draws that line, and
  // decision.test.ts asserts authorize() draws it in the same place.
  for (const p of ["invoice.finalize", "invoice.send", "invoice.credit",
    "invoice.create", "invoice.update"] as Permission[]) {
    assert.equal(scopeFor("boekhouder", p), "own",
      `${p} reaches past the invoices this accountant made for this client`);
  }
  // And approving an expense is deliberately NOT `own`: the purchase invoices an accountant signs
  // off are the CLIENT's, never the accountant's own typing. It rests on the other mandate kind —
  // MANDATE_PROOF — which is why it can be wider without being wider than a grant.
  assert.equal(scopeFor("boekhouder", "expense.approve"), "mandated");
});

test("[EEN-POORT] a sales member's invoices are their OWN, and access control is not theirs", () => {
  for (const p of ["invoice.create", "invoice.send", "invoice.finalize", "invoice.read"] as Permission[]) {
    assert.equal(scopeFor("verkoop", p), "own", `${p} reaches past what the member made`);
  }
  for (const p of PERMISSIONS.filter((x) => x.startsWith("access."))) {
    assert.equal(scopeFor("verkoop", p), "none", `a sales member may ${p}`);
    assert.equal(scopeFor("boekhouder", p), "none", `an accountant may ${p}`);
  }
});

test("[EEN-POORT] an unknown permission or role reaches nothing", () => {
  for (const bad of ["", "invoice", "invoice.explode", "INVOICE.SEND", null, 7]) {
    assert.equal(isPermission(bad), false, `${String(bad)} passed as a permission`);
  }
  assert.equal(scopeFor("wachtwoord" as AccessRole, "invoice.read"), "none");
});
