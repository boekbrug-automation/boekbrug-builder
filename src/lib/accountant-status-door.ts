// src/lib/accountant-status-door.ts
// [BOEKHOUDER-DEUR] The one write path for invoices.accountant_status and its actor.
//
// ── WHY A DOOR AND NOT A RULE MODULE ─────────────────────────────────────────────────────────
//
// 'verwerkt' is the app's hardest money refusal — while it stands, eleven SQL guards and eighteen
// TypeScript sites refuse to move the invoice's paid state. It was written by a direct UPDATE from
// the browser, with no route, no permission check and no audit row, and nothing anywhere decided
// who may write it: the freeze trigger deliberately skips this column, the accountant guard exempts
// the owner, and PostgreSQL RLS cannot be scoped to a column, so admitting any UPDATE admits this
// one.
//
// This module is not a rule engine and holds no state machine. It is a door: the four checks that
// must happen before the column moves, in the order they must happen, in one place that the
// database will accept a write from and nothing else can impersonate.
//
//   acting context → accountant authorization → invoice access → allowed value → atomic write
//
// ── THE TWO CLIENTS, AND WHY BOTH ────────────────────────────────────────────────────────────
//
// `session` is the accountant's own client. It answers two questions nothing else can: WHO is
// calling (auth.getUser, below — never a parameter, see the actor note) and WHAT MAY THEY SEE (the
// invoice read runs through it, so the share policies decide readability once, in the database,
// instead of twice in code).
//
// `pipeline` is the service-role client, and it is the only client the database door admits:
// accountant_status_door_only refuses the write whenever auth.uid() is non-NULL, which is every
// browser and every session-client route. That is what makes this module the ONLY way in rather
// than merely the intended one.
//
// ── THE ACTOR IS DERIVED, NEVER PASSED ───────────────────────────────────────────────────────
//
// There is deliberately no accountantId parameter. A caller cannot hand this door an identity, so
// no request body, no header and no mistake in a caller can attribute an assertion to somebody who
// did not make it. It is read here, from the session, and written from what was read.
//
// ── WHAT THIS DOOR DOES NOT DO ───────────────────────────────────────────────────────────────
//
//   · It does not touch accountant_subject_status. No mirror, no sync.
//   · It does not restrict undo to the accountant who set the lock. Nothing in the product says
//     that today, and inventing it here would be a rule nobody decided.
//   · It is not delegation. accountant_id records who performed THIS act; it is not an identity
//     anyone may act under.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/**
 * The vocabulary, as the database holds it — see invoice_accountant_status_vocabulary.sql.
 * NULL is the fifth legal value and is expressed by the `| null` on the status argument.
 */
export const ACCOUNTANT_STATUSES = ["te_verwerken", "in_behandeling", "verwerkt", "vraag"] as const;
export type AccountantStatus = (typeof ACCOUNTANT_STATUSES)[number];

/** The value that locks money. Every guard in the app compares against this literal. */
export const LOCKED: AccountantStatus = "verwerkt";

export type DoorRefusal =
  | "not_authenticated"
  | "unknown_status"
  | "link_read_failed"
  | "not_linked"
  | "invoice_read_failed"
  | "invoice_not_visible"
  | "invoice_not_this_client"
  | "write_failed"
  | "nothing_written";

export type DoorResult =
  | { ok: true; status: AccountantStatus | null; accountantId: string | null }
  | { ok: false; reason: DoorRefusal; detail?: string };

export function isAccountantStatus(v: unknown): v is AccountantStatus {
  return typeof v === "string" && (ACCOUNTANT_STATUSES as readonly string[]).includes(v);
}

/**
 * Attribution follows the assertion, and only the assertion.
 *
 * 'verwerkt' is the one value that is a claim by a person; the other three and NULL are not, so
 * they carry no actor. Expressed as a function because two places must agree on it — the write
 * below and the test that proves it — and a second copy of a one-line rule is how they stop.
 */
export function attributionFor(status: AccountantStatus | null, actorId: string): string | null {
  return status === LOCKED ? actorId : null;
}

export async function setAccountantStatus(args: {
  /** The accountant's own client. Identity and visibility both come from it. */
  session: Client;
  /** Service-role. The database door admits no other. */
  pipeline: Client;
  invoiceId: string;
  /** The client whose books this invoice must belong to. */
  clientId: string;
  status: AccountantStatus | null;
}): Promise<DoorResult> {
  const { session, pipeline, invoiceId, clientId, status } = args;

  // ── 1. Acting context. Read, never received. ──
  const { data: auth } = await session.auth.getUser();
  const actorId = auth?.user?.id;
  if (!actorId) return { ok: false, reason: "not_authenticated" };

  // ── 2. Allowed value. NULL is legal — undo is an operation this product has, not a hole. ──
  if (status !== null && !isAccountantStatus(status)) {
    return { ok: false, reason: "unknown_status" };
  }

  // ── 3. Accountant authorization. The linkage is the boundary, and it is checked IN CODE rather
  // than as a filter value — the same shape /api/accountant/invoice-question uses, for the same
  // reason: a client-supplied id never reaches PostgREST's filter syntax.
  const { data: links, error: linkErr } = await session
    .from("accountant_clients")
    .select("accountant_id, zzper_id")
    .eq("accountant_id", actorId);
  if (linkErr) {
    // [NO-SILENT-EMPTY] A failed read must never arrive as "not linked" — that reads like a
    // withdrawn mandate, which is a different sentence from "try again".
    return { ok: false, reason: "link_read_failed", detail: linkErr.message };
  }
  if (!(links ?? []).some((l: { zzper_id?: string }) => l.zzper_id === clientId)) {
    return { ok: false, reason: "not_linked" };
  }

  // ── 4. Invoice access, through the SESSION client so the share policies answer once. ──
  const { data: inv, error: invErr } = await session
    .from("invoices")
    .select("id, sender_id, receiver_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return { ok: false, reason: "invoice_read_failed", detail: invErr.message };
  if (!inv) return { ok: false, reason: "invoice_not_visible" };
  if (inv.sender_id !== clientId && inv.receiver_id !== clientId) {
    // Visible is not enough: an accountant with ten clients sees ten administrations, and a status
    // landing in the wrong one is a claim about books this act was never about.
    return { ok: false, reason: "invoice_not_this_client" };
  }

  // ── 5. One atomic write, both columns together. The status and who asserted it are one fact;
  // written apart they can disagree, and the row that says 'verwerkt' with no actor is exactly the
  // state this door exists to end.
  const { data: written, error: writeErr } = await pipeline
    .from("invoices")
    .update({ accountant_status: status, accountant_id: attributionFor(status, actorId) })
    .eq("id", invoiceId)
    .select("id");
  if (writeErr) return { ok: false, reason: "write_failed", detail: writeErr.message };
  // An honest zero-row report. The row may have moved out of reach between the read and the write.
  if (!written || written.length === 0) return { ok: false, reason: "nothing_written" };

  return { ok: true, status, accountantId: attributionFor(status, actorId) };
}
