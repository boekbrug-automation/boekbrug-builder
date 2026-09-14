// src/lib/access/permissions.ts
// [EEN-POORT] What may be done, by whom, and where. Pure, no I/O.
// Run: npx tsx --test src/lib/access/permissions.test.ts
//
// ── WHY A CATALOGUE, WHEN THE APP ALREADY "WORKS" ───────────────────────────────────────────
//
// Measured before this file existed: EIGHT parallel mechanisms answer "may this actor do this" —
// 156 RLS policies, requireOwner() at 46 call sites, the acting-for path, mayOpenControl(), the
// demo fence in middleware, accountant mandates, plan/fair-use gates, and the caller guards
// inside the SECURITY DEFINER money functions. None of them is wrong. The problem is that there
// are eight of them, so "may an accountant finalise an invoice" has eight places to look and no
// place to read.
//
// This file is the READING. It does not replace a single enforcement point — RLS stays, the
// caller guards stay, the money functions stay. Defence in depth is the design; what was missing
// is ONE POLICY DEFINITION behind the several enforcement layers.
//
// ── WHAT A PERMISSION IS ────────────────────────────────────────────────────────────────────
//
// A capability of the DOMAIN, named after the domain and never after a screen or a route. The
// screen may be renamed tomorrow; `invoice.finalize` will still mean the same thing in five
// years, which is what makes it worth writing in an audit row.
//
// ── AND WHAT A SCOPE IS ─────────────────────────────────────────────────────────────────────
//
// A permission alone is not an answer. A sales member may read invoices — the ones they made. An
// accountant may read invoices — of the clients who mandated them. The permission says WHAT, the
// scope says WHERE, and conflating them is how "accountant may read invoices" becomes "accountant
// may read every invoice in the database".
//
// There is deliberately no ALL. Nothing in this app has it, and a value that exists is a value
// somebody assigns.

/** The roles that can act inside one administration. Mirrors CompanyRole in acting-for.ts. */
export type AccessRole = "eigenaar" | "verkoop" | "boekhouder";

/**
 * Where a permission reaches.
 *
 *   own            — rows this actor created themselves (created_by), inside one administration.
 *   administration — every row of the administration being acted for.
 *   mandated       — the administrations that granted this actor a live mandate, and only those.
 *   none           — not at all. Written out rather than omitted, so a missing entry is a bug
 *                    and not a silent grant.
 */
export type AccessScope = "own" | "administration" | "mandated" | "none";

/**
 * Every capability the app grants or refuses.
 *
 * The financial operations at the top are the ones the specification calls PROTECTED: it is not
 * enough that a route exists and checks for a session. Each of them moves money, changes what the
 * Belastingdienst will be told, or changes who may do either.
 */
export type Permission =
  // ── protected financial operations ──
  | "invoice.finalize"
  | "invoice.send"
  | "invoice.credit"
  | "payment.create"
  | "payment.refund"
  | "payment.allocate"
  | "bank.match"
  | "vat.submit"
  | "period.close"
  | "period.reopen"
  // ── ordinary reads and writes ──
  | "invoice.read"
  | "invoice.create"
  | "invoice.update"
  | "customer.read"
  | "customer.create"
  | "customer.update"
  | "expense.read"
  | "expense.approve"
  | "payment.read"
  | "bank.read"
  // ── access control itself ──
  | "access.member_invite"
  | "access.member_revoke"
  | "access.mandate_grant"
  | "access.mandate_revoke";

export const PERMISSIONS: readonly Permission[] = [
  "invoice.finalize", "invoice.send", "invoice.credit",
  "payment.create", "payment.refund", "payment.allocate",
  "bank.match", "vat.submit", "period.close", "period.reopen",
  "invoice.read", "invoice.create", "invoice.update",
  "customer.read", "customer.create", "customer.update",
  "expense.read", "expense.approve",
  "payment.read", "bank.read",
  "access.member_invite", "access.member_revoke",
  "access.mandate_grant", "access.mandate_revoke",
];

/**
 * The operations that may never rest on "there is a session".
 *
 * Named as a set rather than left implicit, because the difference between this list and the rest
 * is the difference between a mistake that annoys somebody and a mistake that reaches the
 * Belastingdienst or somebody's bank account.
 */
export const PROTECTED_OPERATIONS: readonly Permission[] = [
  "invoice.finalize", "invoice.send", "invoice.credit",
  "payment.create", "payment.refund", "payment.allocate",
  "bank.match", "vat.submit", "period.close", "period.reopen",
  // Approving a purchase invoice is on this list although it is not a money MOVE: it is what puts
  // voorbelasting into an aangifte, and it is the act a client hands to an accountant with their
  // own switch. Both of those are reasons to name it rather than to let it rest on a session.
  "expense.approve",
  "access.member_invite", "access.member_revoke",
  "access.mandate_grant", "access.mandate_revoke",
];

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/**
 * What each role may do, and how far it reaches.
 *
 * COMPLETE BY CONSTRUCTION: every role names every permission, including the ones it does not
 * have, as "none". A role that simply omits a permission and a role that is refused it look the
 * same in a partial map, and only one of them was decided by a person. A test asserts the maps
 * are total.
 *
 * The three roles are the three the app really has (acting-for.ts). They are NOT a role system:
 * `eigenaar` is somebody in their own administration, `verkoop` is a member acting for their
 * employer, `boekhouder` is an accountant acting for a client who mandated them.
 */
export const ROLE_SCOPES: Readonly<Record<AccessRole, Readonly<Record<Permission, AccessScope>>>> = {
  // The owner of the administration. Everything, inside their own books and nowhere else.
  eigenaar: {
    "invoice.finalize": "administration", "invoice.send": "administration", "invoice.credit": "administration",
    "payment.create": "administration", "payment.refund": "administration", "payment.allocate": "administration",
    "bank.match": "administration", "vat.submit": "administration",
    "period.close": "administration", "period.reopen": "administration",
    "invoice.read": "administration", "invoice.create": "administration", "invoice.update": "administration",
    "customer.read": "administration", "customer.create": "administration", "customer.update": "administration",
    "expense.read": "administration", "expense.approve": "administration",
    "payment.read": "administration", "bank.read": "administration",
    "access.member_invite": "administration", "access.member_revoke": "administration",
    "access.mandate_grant": "administration", "access.mandate_revoke": "administration",
  },
  // A sales member. They make and send invoices FOR their employer, and see what they made
  // themselves. Everything that touches money truth, the books or access is the owner's —
  // owner-only.ts says the same thing at the door, in a sentence the member reads.
  verkoop: {
    "invoice.finalize": "own", "invoice.send": "own", "invoice.credit": "own",
    "payment.create": "none", "payment.refund": "none", "payment.allocate": "none",
    "bank.match": "none", "vat.submit": "none",
    "period.close": "none", "period.reopen": "none",
    "invoice.read": "own", "invoice.create": "own", "invoice.update": "own",
    "customer.read": "administration", "customer.create": "administration", "customer.update": "administration",
    "expense.read": "none", "expense.approve": "none",
    "payment.read": "none", "bank.read": "none",
    "access.member_invite": "none", "access.member_revoke": "none",
    "access.mandate_grant": "none", "access.mandate_revoke": "none",
  },
  // An accountant. Reaches only the administrations that mandated them, and even there does not
  // move money: [GEEN-ACHTERDEUR] and the accountant-amount trigger both say an accountant may
  // change what the books SAY about themselves, never what they contain.
  //
  // ── WHY THE INVOICE ROW SAYS `own` AND NOT `mandated` ────────────────────────────────────
  //
  // This map was written as a policy opinion and then MEASURED against the rules the product
  // actually ships, and it was wrong in five places. A mandated accountant does invoice for their
  // client — that is [CREDIT-NAMENS] and the whole `namens_klant_id` path on /api/invoice/send
  // and /api/invoice/creditnota. Writing "none" here would not have documented a restriction; it
  // would have taken a live feature away from every accountant the moment a route asked.
  //
  // But it is not `mandated` either, and the difference is the one canAccessInvoice() draws:
  // a mandate is permission to WRITE invoices in someone's name, never permission to finish or
  // re-price the ones the client wrote themselves. `own` says exactly that — inside the
  // administration proved by the mandate, the rows this actor created. A gate asserts authorize()
  // and canAccessInvoice() agree, so this row cannot drift away from the rule again.
  boekhouder: {
    "invoice.finalize": "own", "invoice.send": "own", "invoice.credit": "own",
    "payment.create": "none", "payment.refund": "none", "payment.allocate": "none",
    "bank.match": "none", "vat.submit": "none",
    "period.close": "none", "period.reopen": "none",
    "invoice.read": "mandated", "invoice.create": "own", "invoice.update": "own",
    "customer.read": "mandated", "customer.create": "none", "customer.update": "none",
    // [BEVESTIGEN] Confirming is granted by its OWN switch — a different mandate kind, and a
    // client who allowed invoicing has not thereby allowed sign-off. MANDATE_PROOF below says
    // which switch proves this one; canConfirmForClient() is the rule it mirrors.
    "expense.read": "mandated", "expense.approve": "mandated",
    "payment.read": "mandated", "bank.read": "mandated",
    "access.member_invite": "none", "access.member_revoke": "none",
    "access.mandate_grant": "none", "access.mandate_revoke": "none",
  },
};

/**
 * The kinds of mandate a client can grant an accountant. Mirrors accountant_invoice_mandates.kind
 * and mandateKindOf() — the database, the pure rule and this catalogue spell it one way.
 */
export type MandateKind = "facturen" | "bevestigen";

/**
 * Which mandate PROVES a `mandated` scope for this permission.
 *
 * `mandated` is not one grant. A client has two switches and they are separate on purpose: one
 * lets the accountant write invoices in their name (art. 35 lid 1 Wet OB explicitly allows a
 * third party to issue), the other lets them sign off what came in. Reading either as the other
 * is the silent widening accountant-mandate.ts exists to prevent, and until this map existed the
 * catalogue had exactly one notion of "mandated" and therefore could not tell them apart.
 *
 * Absent ⇒ the invoicing mandate, because that is what every other `mandated` row here means and
 * what getActingForClient() proves.
 */
export const MANDATE_PROOF: Readonly<Partial<Record<Permission, MandateKind>>> = {
  "expense.approve": "bevestigen",
};

/** Which mandate proves this permission. Defaults to the invoicing mandate. */
export function mandateProofFor(permission: Permission): MandateKind {
  return MANDATE_PROOF[permission] ?? "facturen";
}

/** How far this role reaches for this permission. `none` when it may not at all. */
export function scopeFor(role: AccessRole, permission: Permission): AccessScope {
  return ROLE_SCOPES[role]?.[permission] ?? "none";
}
