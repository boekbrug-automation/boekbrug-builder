// src/lib/access/decision.ts
// [EEN-POORT] One authorization decision. Pure, no I/O, no clock of its own.
// Run: npx tsx --test src/lib/access/decision.test.ts
//
// ── THE ONE PROPERTY ────────────────────────────────────────────────────────────────────────
//
// There must not be two different answers in BoekBrug to the question: may this actor perform
// this operation? Today there are eight places that answer it. This module does not delete any of
// them — RLS, the caller guards inside the money functions, requireOwner(), the accountant
// mandate — they are ENFORCEMENT LAYERS and defence in depth is deliberate. What it replaces is
// the eight separate POLICIES behind them with one.
//
//   One policy definition. Several enforcement layers.
//   Not: several policy definitions.
//
// ── A BOOLEAN IS NOT A DECISION ─────────────────────────────────────────────────────────────
//
// `false` tells a screen nothing, tells an audit row nothing, and tells the owner nothing. Every
// refusal here carries a reason code, and the reason code is the same vocabulary the rest of the
// app refuses in (contracts/reason-codes.ts). That is what lets a workflow guard, a Today item,
// an exception list and a support question all read the same answer.
//
// What it must NOT carry is anything the refused actor should not learn. A DENY says which
// permission was missing; it never says whether the resource exists or whose it is.
//
// ── FAIL CLOSED, AND SAY SO IN CODE ─────────────────────────────────────────────────────────
//
// Every path that cannot PROVE the answer returns deny. No session, no membership, an unknown
// permission, a role we do not recognise, a resource with no owner: all deny. An authorization
// error must never become access, so there is no branch here that ends in allow by omission.

import {
  type AccessRole, type AccessScope, type Permission,
  isPermission, scopeFor,
} from "./permissions";

/** Why access was refused. Namespaced like every other refusal — see contracts/reason-codes.ts. */
export type AccessReasonCode =
  | "access.no_session"        // nobody is authenticated
  | "access.unknown_permission" // the caller asked for a capability that does not exist
  | "access.unknown_role"      // a role the catalogue has no entry for
  | "access.missing_permission" // the role holds this capability nowhere
  | "access.out_of_scope"      // it holds it, but not for this resource
  | "access.other_administration" // the resource belongs to an administration this actor is not in
  | "access.no_mandate";       // an accountant without a live mandate for this administration

export const ACCESS_REASON_CODES: readonly AccessReasonCode[] = [
  "access.no_session", "access.unknown_permission", "access.unknown_role",
  "access.missing_permission", "access.out_of_scope", "access.other_administration",
  "access.no_mandate",
];

/**
 * Who is acting, on whose behalf, and with what proof.
 *
 * Deliberately the shape acting-for.ts already produces, plus the accountant's mandate. There is
 * no second notion of identity here: inventing one would make this the NINTH mechanism instead of
 * the one that reads the other eight.
 */
export interface ActingContext {
  /** The human behind the keyboard. Ends up in created_by — a trail, never ownership. */
  actorId: string;
  /** The administration being acted for. Everything that touches the books hangs off this. */
  ownerId: string;
  role: AccessRole;
  /**
   * For an accountant: the administrations that granted a live invoice mandate. Empty for
   * everyone else, and empty is not a wildcard — a `mandated` scope with an empty list denies.
   */
  mandatedOwnerIds?: readonly string[];
}

/** The thing being acted on, as far as authorization is concerned. */
export interface AccessResource {
  /** Which administration the row belongs to (invoices.sender_id / receiver_id, and so on). */
  ownerId: string | null | undefined;
  /** Who created it, when the row records that. Needed only for the `own` scope. */
  createdBy?: string | null;
}

export type AccessDecision =
  | { allowed: true; permission: Permission; scope: AccessScope }
  | { allowed: false; reasonCode: AccessReasonCode; permission: string; scope: AccessScope };

const deny = (reasonCode: AccessReasonCode, permission: string, scope: AccessScope = "none"): AccessDecision =>
  ({ allowed: false, reasonCode, permission, scope });

/**
 * May this actor perform this permission, on this resource?
 *
 * `resource` is optional, and the difference matters. Without it the question is
 * ACTION-LEVEL — "could this actor ever finalise an invoice?" — which is what a screen asks when
 * it decides whether to render a button. With it the question is RESOURCE-LEVEL — "may they
 * finalise THIS one?" — which is the only question a door may act on. A route that authorizes at
 * action level and then writes a specific row has authorized the wrong question.
 */
export function authorize(
  context: ActingContext | null | undefined,
  permission: string,
  resource?: AccessResource,
): AccessDecision {
  if (!context || !context.actorId || !context.ownerId) return deny("access.no_session", permission);
  if (!isPermission(permission)) return deny("access.unknown_permission", permission);
  if (!isKnownRole(context.role)) return deny("access.unknown_role", permission);

  const scope = scopeFor(context.role, permission);
  if (scope === "none") return deny("access.missing_permission", permission, scope);

  // Action level. The caller is asking what this actor could ever do, not what they may do here.
  if (!resource) return { allowed: true, permission, scope };

  const resourceOwner = resource.ownerId;
  if (!resourceOwner) return deny("access.other_administration", permission, scope);

  if (scope === "mandated") {
    // Empty is not a wildcard. An accountant with no live mandate reaches nothing, which is the
    // whole difference between "has the accountant role" and "may see this client".
    const mandated = context.mandatedOwnerIds ?? [];
    if (!mandated.includes(resourceOwner)) return deny("access.no_mandate", permission, scope);
    return { allowed: true, permission, scope };
  }

  // Everything else is inside the administration being acted for, and nowhere else.
  if (resourceOwner !== context.ownerId) return deny("access.other_administration", permission, scope);

  if (scope === "own") {
    // A row with no recorded creator cannot be proved to be this actor's, and unprovable is deny.
    if (!resource.createdBy || resource.createdBy !== context.actorId) {
      return deny("access.out_of_scope", permission, scope);
    }
  }

  return { allowed: true, permission, scope };
}

function isKnownRole(role: unknown): role is AccessRole {
  return role === "eigenaar" || role === "verkoop" || role === "boekhouder";
}
