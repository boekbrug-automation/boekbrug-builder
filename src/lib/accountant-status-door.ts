// src/lib/accountant-status-door.ts
// [BOEKHOUDER-DEUR] The ONE application entry point for an accountant's statement about an invoice.
//
// ── WHAT IT DECIDES ──
//
// Who is asking (the session), whether they may say anything about THIS invoice (linked to the
// client, and the invoice visible to them under RLS), and what they may say (the four words of
// invoices.accountant_status, or nothing). Only then does it write — and it writes ONE thing.
//
// ── [VRAAG-SYNC] ONE thing is now two facts, moved together ──
//
// A question about an invoice lives in two rows: `invoices.accountant_status = 'vraag'` (what
// the accountant's own surfaces count) and the accountant's row in `accountant_subject_status`
// (the words, and what the client's /dashboard/vragen lists). Asking wrote both; resolving wrote
// only the first, so the client kept seeing an open question forever (audit finding VR-01).
//
// The write is therefore a single database function, `accountant_set_invoice_status`, which
// moves both rows in one transaction, scoped to this accountant and this invoice. Two separate
// writes from here would put the contradiction back on the day one of them fails. The function
// re-checks the link and the ownership on its own; the checks below stay in front of it because
// they run under the CALLER's RLS (visibility), which a service-role call cannot see.
//
// ── WHY THE DOOR, NOT THE TABLE ──
//
// The database refuses this column from every session client (`invoices_accountant_door`), and
// the function's EXECUTE is revoked from anon and authenticated. So the browser cannot set a
// status, cannot forge who set it, and cannot resolve a question — the client answers through
// /api/messages, and that path does not exist here.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export const ACCOUNTANT_STATUSES = ["te_verwerken", "in_behandeling", "verwerkt", "vraag"] as const;
export type AccountantStatus = (typeof ACCOUNTANT_STATUSES)[number];

/** The value that locks an invoice for the client: money and dates freeze under it. */
export const LOCKED: AccountantStatus = "verwerkt";

export const ACCOUNTANT_STATUS_RPC = "accountant_set_invoice_status";

export type DoorRefusal =
  | "not_authenticated"
  | "unknown_status"
  | "question_required"
  | "link_read_failed"
  | "not_linked"
  | "invoice_read_failed"
  | "invoice_not_visible"
  | "invoice_not_this_client"
  | "write_failed"
  | "nothing_written";

export interface DoorWritten {
  ok: true;
  status: AccountantStatus | null;
  accountantId: string | null;
  /** invoices.accountant_status before this statement, as the database reported it. */
  previousStatus: AccountantStatus | null;
  /** Whether THIS accountant's question on the invoice was open ('vraag') before this statement. */
  questionWasOpen: boolean;
  /** The accountant's question row after this statement; null when there is no such row. */
  questionStatus: AccountantStatus | null;
  /** A label for the invoice, for the sentence a caller may want to say about it. */
  invoiceLabel: string | null;
}

export type DoorResult =
  | DoorWritten
  | { ok: false; reason: DoorRefusal; detail?: string };

/**
 * Which refusals are the caller's fault and which are ours, as the HTTP status the routes in front
 * of the door answer with. A 503 invites a retry; a 403 does not. One map, shared by
 * /api/accountant/invoice-status and /api/accountant/invoice-question, so the two cannot drift.
 */
export const DOOR_REFUSAL_HTTP_STATUS: Record<DoorRefusal, number> = {
  not_authenticated: 401,
  unknown_status: 400,
  question_required: 400,
  link_read_failed: 503,
  not_linked: 403,
  invoice_read_failed: 503,
  invoice_not_visible: 404,
  invoice_not_this_client: 403,
  write_failed: 500,
  nothing_written: 409,
};

export function isAccountantStatus(v: unknown): v is AccountantStatus {
  return typeof v === "string" && (ACCOUNTANT_STATUSES as readonly string[]).includes(v);
}

/** Only the lock carries an actor; every other word (and the undo) clears the attribution. */
export function attributionFor(status: AccountantStatus | null, actorId: string): string | null {
  return status === LOCKED ? actorId : null;
}

/**
 * The refusals the database function raises by name, mapped back to the door's own vocabulary.
 * Anything else the function says is a write failure — reported, never guessed at.
 */
export function refusalFromRpcError(message: string | null | undefined): DoorRefusal {
  const m = (message ?? "").trim();
  if (m === "not_linked") return "not_linked";
  if (m === "invoice_not_this_client") return "invoice_not_this_client";
  if (m === "unknown_status") return "unknown_status";
  if (m === "question_required") return "question_required";
  return "write_failed";
}

/** How the invoice is named to a person: supplier · number, whichever parts exist. */
export function invoiceLabelOf(inv: { client_name?: string | null; invoice_number?: string | null } | null | undefined): string | null {
  const parts = [inv?.client_name?.trim(), inv?.invoice_number ? `factuur ${inv.invoice_number}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export async function setAccountantStatus(args: {
  session: Client;
  pipeline: Client;
  invoiceId: string;
  clientId: string;
  status: AccountantStatus | null;
  /** The accountant's words. Required for 'vraag'; ignored for every other statement. */
  question?: string | null;
}): Promise<DoorResult> {
  const { session, pipeline, invoiceId, clientId, status } = args;

  const { data: auth } = await session.auth.getUser();
  const actorId = auth?.user?.id;
  if (!actorId) return { ok: false, reason: "not_authenticated" };

  if (status !== null && !isAccountantStatus(status)) {
    return { ok: false, reason: "unknown_status" };
  }

  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (status === "vraag" && !question) {
    return { ok: false, reason: "question_required" };
  }

  const { data: links, error: linkErr } = await session
    .from("accountant_clients")
    .select("accountant_id, zzper_id")
    .eq("accountant_id", actorId);
  if (linkErr) {
    return { ok: false, reason: "link_read_failed", detail: linkErr.message };
  }
  if (!(links ?? []).some((l: { zzper_id?: string }) => l.zzper_id === clientId)) {
    return { ok: false, reason: "not_linked" };
  }

  // Under the CALLER's RLS: an invoice the accountant may not see is not theirs to talk about.
  const { data: inv, error: invErr } = await session
    .from("invoices")
    .select("id, sender_id, receiver_id, invoice_number, client_name")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return { ok: false, reason: "invoice_read_failed", detail: invErr.message };
  if (!inv) return { ok: false, reason: "invoice_not_visible" };
  if (inv.sender_id !== clientId && inv.receiver_id !== clientId) {
    return { ok: false, reason: "invoice_not_this_client" };
  }

  // [VRAAG-SYNC] Both facts, one transaction. The actor is the session's, never a parameter.
  const { data, error: writeErr } = await pipeline.rpc(ACCOUNTANT_STATUS_RPC, {
    p_accountant_id: actorId,
    p_client_id: clientId,
    p_invoice_id: invoiceId,
    p_status: status,
    p_question: status === "vraag" ? question : null,
  });
  if (writeErr) {
    return { ok: false, reason: refusalFromRpcError(writeErr.message), detail: writeErr.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { previous_status?: string | null; question_was_open?: boolean | null; question_status?: string | null }
    | null
    | undefined;
  if (!row) return { ok: false, reason: "nothing_written" };

  return {
    ok: true,
    status,
    accountantId: attributionFor(status, actorId),
    previousStatus: isAccountantStatus(row.previous_status) ? row.previous_status : null,
    questionWasOpen: row.question_was_open === true,
    questionStatus: isAccountantStatus(row.question_status) ? row.question_status : null,
    invoiceLabel: invoiceLabelOf(inv),
  };
}
