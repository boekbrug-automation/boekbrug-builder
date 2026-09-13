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
import { getActingFor, getActingForClient } from "@/lib/acting-for-server";
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
  const acting: ActingFor | null = clientId ? await getActingForClient(clientId) : await getActingFor();
  if (!acting) return null;
  return {
    actorId: acting.actorId,
    ownerId: acting.ownerId,
    role: acting.role,
    // Exactly the administration that was asked for and proved, never "the accountant's clients".
    // An empty list denies every `mandated` scope, which is the correct answer for everyone else.
    mandatedOwnerIds: acting.role === "boekhouder" ? [acting.ownerId] : [],
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
