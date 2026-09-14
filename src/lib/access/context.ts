// src/lib/access/context.ts
// [EEN-POORT] The one place a request is turned into "who is acting, for whom". Server only.
//
// ── THIS IS NOT A NINTH MECHANISM ───────────────────────────────────────────────────────────
//
// The canonical resolver already exists and has existed since [ACTING-FOR]: resolveActingFor() is
// the pure rule, getActingFor()/getActingForClient() are its two server doors, and requireOwner()
// is a thin caller. Nothing about that is replaced here, and replacing it would be the single
// worst thing this file could do — a new resolver beside a working one is how eight mechanisms
// became eight.
//
// What this file adds is the PROMOTION: one exported shape the rest of the platform names, one
// decision API behind it, and — crucially — one place that a gate can point at when it asks "did
// this route reinvent authorization?".
//
// ── THE TWO DOORS, AND WHY THERE ARE TWO ────────────────────────────────────────────────────
//
// An owner and a sales member are AMBIENT: the session alone answers "who are you". An accountant
// is not. They are never "an accountant" in general — they are an accountant FOR ONE CLIENT, and
// the client is named in the request. Collapsing the two would mean an accountant with one
// mandate carries that mandate everywhere, which is exactly the grant nobody meant to give.
//
// So: no clientId → the ambient door. A clientId → the mandated door, and the resulting context
// carries exactly ONE mandated administration: the one that was asked for and proved.

import { NextResponse } from "next/server";
import { getActingFor, getActingForClient, canConfirmForClientServer } from "@/lib/acting-for-server";
import { getSessionUser } from "@/lib/session-user";
import type { ActingFor } from "@/lib/acting-for";
import { authorize, type AccessDecision, type AccessResource, type ActingContext } from "./decision";
import type { Permission } from "./permissions";

/**
 * Who is acting here, on whose behalf, and with what proof.
 *
 * Returns null when there is no session — and null is a DENY everywhere downstream, never a
 * "carry on without a context".
 */
export async function resolveActingContext(clientId?: string | null): Promise<ActingContext | null> {
  // The ambient question — an owner or a sales member. One query, exactly as before, and neither
  // mandate list can be anything but empty: neither of them holds a mandate from anybody.
  if (!clientId) {
    const acting: ActingFor | null = await getActingFor();
    if (!acting) return null;
    return { actorId: acting.actorId, ownerId: acting.ownerId, role: acting.role,
      mandatedOwnerIds: [], confirmMandatedOwnerIds: [] };
  }

  // The mandated question. Both switches are asked for, in parallel, because a client sets them
  // separately and an accountant may hold either, both or neither. Asking only for the invoicing
  // one is what made the catalogue unable to describe confirming at all.
  const [acting, mayConfirm] = await Promise.all([
    getActingForClient(clientId),
    canConfirmForClientServer(clientId),
  ]);

  if (acting) {
    const boekhouder = acting.role === "boekhouder";
    return {
      actorId: acting.actorId,
      ownerId: acting.ownerId,
      role: acting.role,
      // Exactly the administration that was asked for and proved, never "the accountant's clients".
      // An empty list denies every `mandated` scope, which is the correct answer for everyone else.
      mandatedOwnerIds: boekhouder ? [acting.ownerId] : [],
      confirmMandatedOwnerIds: boekhouder && mayConfirm ? [acting.ownerId] : [],
    };
  }

  // No invoicing mandate. That is not "no context" when the client granted the OTHER switch: an
  // accountant who may only confirm is still somebody with exactly one capability here, and
  // returning null would have denied the confirming door by pretending nobody was logged in.
  if (!mayConfirm) return null;
  const user = await getSessionUser();
  if (!user) return null;
  return {
    actorId: user.id,
    ownerId: clientId,
    role: "boekhouder",
    mandatedOwnerIds: [],
    confirmMandatedOwnerIds: [clientId],
  };
}

/** The decision, for a caller that wants to branch rather than refuse. */
export async function can(
  permission: Permission,
  resource?: AccessResource,
  clientId?: string | null,
): Promise<AccessDecision> {
  return authorize(await resolveActingContext(clientId), permission, resource);
}

/**
 * The door. Either the context, or a ready-made refusal.
 *
 * [SERVER-ZIN] The refusal carries a CODE, and the screen writes the sentence. It deliberately
 * does not say whether the resource exists or whose it is: a refused actor learns which capability
 * they lack, and nothing about the row they did not reach.
 *
 * Usage:
 *   const gate = await requirePermission("invoice.finalize", { ownerId: inv.sender_id })
 *   if (gate.response) return gate.response
 *   const ctx = gate.context
 */
export async function requirePermission(
  permission: Permission,
  resource?: AccessResource,
  clientId?: string | null,
): Promise<{ context?: ActingContext; response?: NextResponse }> {
  const context = await resolveActingContext(clientId);
  const decision = authorize(context, permission, resource);
  if (decision.allowed) return { context: context! };
  const status = decision.reasonCode === "access.no_session" ? 401 : 403;
  return {
    response: NextResponse.json(
      { error: decision.reasonCode, code: decision.reasonCode, permission: decision.permission },
      { status },
    ),
  };
}

/**
 * The same door, wearing the sentence requireOwner() has always said.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A NINTH MECHANISM ────────────────────────────────────
 *
 * Thirty-one routes are closed with requireOwner(subject) — a ROLE test, deliberate and correct
 * (owner-only.ts explains the choice route by route), answering with a Dutch sentence a sales
 * member reads: "Een betaling boeken kan alleen de eigenaar …". Every one of those routes moves
 * money or changes what the Belastingdienst will be told.
 *
 * Migrating them has to satisfy two things that pull against each other:
 *
 *   · the DECISION must become the canonical one — resolveActingContext() + authorize() — so the
 *     capability is NAMED (`payment.allocate`, not "not the owner") and there is one policy;
 *   · the ANSWER must not change, because a dozen screens already read `error` and show it. A
 *     migration that silently replaces a Dutch sentence with `access.missing_permission` on a
 *     money screen is a regression dressed as an improvement.
 *
 * So: the decision moves, the wording does not. The route names a permission from the catalogue;
 * this returns exactly the 401/403 bodies requireOwner() returns. When the screens are moved to
 * [SERVER-ZIN] codes, this collapses into requirePermission() and nothing else has to change.
 *
 * NOTE ON LANGUAGE: the sentence is Dutch for the same reason owner-only.ts gives — it is read by
 * a Dutch entrepreneur in the app, and it is content, not code.
 */
export async function requireOwnerPermission(
  permission: Permission,
  subject: string,
  resource?: AccessResource,
): Promise<{ context?: ActingContext; response?: NextResponse }> {
  const context = await resolveActingContext();
  const decision = authorize(context, permission, resource);
  if (decision.allowed) return { context: context! };
  if (decision.reasonCode === "access.no_session") {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return {
    response: NextResponse.json(
      {
        error: `${subject} kan alleen de eigenaar van de administratie doen. Jij maakt en verstuurt facturen; vraag je werkgever om dit te doen.`,
        // The code travels beside the sentence, so a caller that wants the vocabulary already has
        // it and the eventual [SERVER-ZIN] move is a deletion rather than a rewrite.
        code: decision.reasonCode,
        permission: decision.permission,
      },
      { status: 403 },
    ),
  };
}

/**
 * The canonical context for an ActingFor a route has ALREADY resolved and proved.
 *
 * The dual-path money routes (/api/invoice/send, /api/invoice/creditnota) resolve acting-for
 * themselves, because who the owner is decides the very first query they make. Re-resolving it a
 * second line later would mean two lookups and two answers to one question. This turns the proof
 * they hold into the shape authorize() reads — no I/O, no second opinion.
 *
 * It carries the INVOICING mandate only, because that is the one getActingForClient() proves. A
 * permission whose MANDATE_PROOF is 'bevestigen' therefore DENIES through this shape, which is the
 * correct failure direction: a function must not invent a proof it was not handed. Ask
 * resolveActingContext() when you need that switch.
 */
export function contextFromActing(acting: ActingFor): ActingContext {
  const boekhouder = acting.role === "boekhouder";
  return {
    actorId: acting.actorId,
    ownerId: acting.ownerId,
    role: acting.role,
    mandatedOwnerIds: boekhouder ? [acting.ownerId] : [],
    confirmMandatedOwnerIds: [],
  };
}
