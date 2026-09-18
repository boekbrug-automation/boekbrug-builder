// src/lib/reminder-file.ts
// [HERINNERING-NOOIT] File a payment reminder: link it to the invoice it is about, tell the owner
// the one thing worth telling, and write the trail. Server-only (service_role); the decision
// itself is pure and lives in reminder-original.ts.
//
// Called by every door that reads documents — /api/intake and the e-mail sync — AFTER the file has
// been stored as a document and INSTEAD of an invoices insert. It never inserts an invoice.

import type { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
import { logAuditAction } from "@/lib/audit";
import { formatEuroNL } from "@/lib/format-nl";
import { DOC_TYPE_REMINDER } from "@/lib/skipped-import";
import {
  placeReminder, reminderNumber,
  type OriginalCandidate, type ReminderFacts, type ReminderPlacement,
} from "@/lib/reminder-original";

type Pipeline = ReturnType<typeof createPipelineClient>;

export interface FileReminderInput {
  pipeline: Pipeline;
  userId: string;
  /** The stored document row of the reminder. */
  documentId: string;
  facts: ReminderFacts;
  /** Which door: shows in the audit row. */
  path: "intake" | "email";
  /**
   * [ONTVANGEN] How the run that filed this reminder was started — see intake-provenance.ts.
   * Optional because a door that still runs inside the owner's request has nothing to add beyond
   * its address; a background pass has no address, and this is what tells the two apart.
   */
  runOrigin?: string | null;
  ipAddress?: string | null;
}

export interface FileReminderResult {
  placement: Extract<ReminderPlacement, { action: "file" }>;
  /** The Dutch sentence for the screen that received the file. */
  message: string;
}

const BOOKED_STATUSES = ["processing", "received", "paid"] as const;

/** Only the digits of the number's first six, for a safe ilike prefix; empty when there are fewer. */
function prefixOf(number: string): string {
  const digits = number.replace(/\D+/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : "";
}

/**
 * The invoices this reminder could be about: the same amount, or a number that starts the same
 * way. Two small reads, merged by id; archived rows are not "in the books" and are left out.
 */
export async function loadReminderCandidates(
  pipeline: Pipeline, userId: string, facts: ReminderFacts,
): Promise<OriginalCandidate[]> {
  const select = "id, invoice_number, total_inc_btw, invoice_date, client_name, status, payment_date, due_date";
  const base = () => pipeline
    .from("invoices").select(select)
    .eq("receiver_id", userId).eq("direction", "incoming")
    .in("status", [...BOOKED_STATUSES]).limit(50);
  const byId = new Map<string, OriginalCandidate>();
  const take = (rows: unknown[] | null | undefined) => {
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.id);
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        invoiceNumber: (r.invoice_number as string | null) ?? null,
        totalIncBtw: r.total_inc_btw === null || r.total_inc_btw === undefined ? null : Number(r.total_inc_btw),
        invoiceDate: (r.invoice_date as string | null) ?? null,
        clientName: (r.client_name as string | null) ?? null,
        status: (r.status as string | null) ?? null,
        paymentDate: (r.payment_date as string | null) ?? null,
        dueDate: (r.due_date as string | null) ?? null,
      });
    }
  };
  const total = typeof facts.totalIncBtw === "number" && Number.isFinite(facts.totalIncBtw) ? Math.abs(facts.totalIncBtw) : null;
  if (total !== null) {
    const { data, error } = await base().eq("total_inc_btw", total);
    if (error) throw new Error(`reminder candidates by amount: ${error.message}`);
    take(data);
  }
  const prefix = prefixOf(reminderNumber(facts));
  if (prefix) {
    const { data, error } = await base().ilike("invoice_number", `${prefix}%`);
    if (error) throw new Error(`reminder candidates by number: ${error.message}`);
    take(data);
  }
  return [...byId.values()];
}

function dateNL(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/** The sentence the owner reads. Dutch: notification text, read by a Dutch entrepreneur. */
export function reminderNotice(facts: ReminderFacts, placement: Extract<ReminderPlacement, { action: "file" }>): {
  title: string; body: string; link: string;
} {
  const wie = (facts.vendor ?? "").trim() || "een leverancier";
  const nr = reminderNumber(facts);
  const bedrag = typeof facts.totalIncBtw === "number" ? formatEuroNL(Math.abs(facts.totalIncBtw)) : "";
  const o = placement.original;
  if (o) {
    const nummer = o.invoiceNumber || nr || "";
    const link = `/dashboard/incoming/manage?focus=${o.id}`;
    if (o.status === "paid") {
      const wanneer = dateNL(o.paymentDate);
      return {
        title: `${wie} herinnert aan factuur ${nummer}, maar die staat bij jou als betaald`,
        body: `${bedrag ? bedrag + " · " : ""}${wanneer ? `betaald op ${wanneer}. ` : ""}Controleer of die betaling is aangekomen. De herinnering staat in je bestanden.`,
        link,
      };
    }
    const vervalt = dateNL(o.dueDate);
    return {
      title: `${wie} herinnert aan factuur ${nummer} — die staat nog open`,
      body: `${bedrag ? bedrag + (vervalt ? ` · verviel op ${vervalt}` : "") + ". " : ""}Betaal hem, of zet hem op betaald als dat al is gebeurd. De herinnering staat in je bestanden.`,
      link,
    };
  }
  if (placement.ambiguous > 1) {
    return {
      title: `Herinnering van ${wie} voor factuur ${nr || "?"}`,
      body: `Er staan ${placement.ambiguous} facturen met dit bedrag in je boekhouding, dus we hebben hem niet gekoppeld. De herinnering staat in je bestanden.`,
      link: "/dashboard/incoming",
    };
  }
  return {
    title: `Herinnering van ${wie} voor factuur ${nr || "?"} die niet in je boekhouding staat`,
    body: `${bedrag ? bedrag + ". " : ""}Vraag de factuur op bij ${wie}, of boek de herinnering als factuur via Overgeslagen bij import. Zonder de factuur is er geen btw terug te vragen.`,
    link: "/dashboard/incoming",
  };
}

/**
 * File one reminder. Never throws for the caller's sake beyond the candidate read: a notification
 * or audit row that fails is logged, the filing stands.
 */
export async function fileReminder(input: FileReminderInput): Promise<FileReminderResult> {
  const { pipeline, userId, documentId, facts } = input;
  const candidates = await loadReminderCandidates(pipeline, userId, facts);
  const placed = placeReminder({ ...facts, isReminder: true }, candidates);
  if (placed.action !== "file") throw new Error("placeReminder must file a reminder");

  // The link IS the state: a reminder with invoice_id is one whose original is in the books, and
  // the read-as-invoice door refuses it ("hoort al bij een factuur"). Without it the door opens —
  // deliberately, once, on the owner's tap.
  const { error: updErr } = await pipeline
    .from("documents")
    .update({ ai_doc_type: DOC_TYPE_REMINDER, ai_processed: true, invoice_id: placed.original?.id ?? null })
    .eq("id", documentId).eq("user_id", userId);
  if (updErr) throw new Error(`reminder document update: ${updErr.message}`);

  const notice = reminderNotice(facts, placed);
  const sent = await createNotification({ userId, title: notice.title, body: notice.body, type: "invoice", link: notice.link });
  if (!sent.ok) console.error("[HERINNERING-NOOIT] notification not written", { userId, documentId, error: sent.error });

  await logAuditAction({
    userId,
    action: "document.reminder_filed",
    entityType: "document",
    entityId: documentId,
    newValue: {
      path: input.path,
      run_origin: input.runOrigin ?? null,
      reminder_number: reminderNumber(facts) || null,
      vendor: facts.vendor ?? null,
      total_inc_btw: facts.totalIncBtw ?? null,
      original_invoice_id: placed.original?.id ?? null,
      original_invoice_number: placed.original?.invoiceNumber ?? null,
      original_status: placed.original?.status ?? null,
      ambiguous: placed.ambiguous,
    },
    ipAddress: input.ipAddress ?? undefined,
  }).catch((e) => console.error("[HERINNERING-NOOIT] audit row not written", e));

  return { placement: placed, message: `${notice.title}. ${notice.body}` };
}
