// src/lib/answer-notice.ts
// [KANTOOR-LINKS] Where the accountant's "Nieuw bericht" lands when the message is an ANSWER.
// Run: npx tsx --test src/lib/answer-notice.test.ts
//
// WHAT THIS DECIDES, AND WHAT IT REFUSES TO ASSUME
//
// An answer to a question about one invoice should open that invoice, not a chat window. The
// answering screen knows which invoice, and hands it over as a TYPED id — the Dutch sentence
// `bouwAntwoordBericht` writes ("Over je vraag bij …") is never parsed, because a link built out
// of prose breaks on the first rename, the first quote, the first translation.
//
// But a typed id the CLIENT chose is a claim, not a proof. Two things it does not establish, and
// both of them end with an accountant staring at the wrong row:
//
//   · OWNERSHIP IS NOT AN ANSWER. A client may name any invoice they own. Without more, a message
//     saying "ja hoor" could point the accountant's notification at an unrelated invoice — and
//     the accountant would read it as "this is the one I asked about".
//   · ONE ADMINISTRATION MAY HAVE TWO OFFICES. accountant_clients is UNIQUE(accountant_id,
//     zzper_id) and nothing else (see accountant-links.ts). So "an open question exists about this
//     invoice" does not mean THIS receiver asked it; the row is matched on accountant_id too.
//
// Hence: an exact open question — subject_type 'invoice', this invoice, this accountant, still
// `vraag` — or no deep link at all.
//
// AND WHAT IT NEVER DOES
//
// It never writes. The client answering a question does not resolve it: only the accountant clears
// their own (invoice_questions.sql gives the client SELECT and nothing else). It never throws
// either — every read is best-effort, and the caller sends the message regardless. A deep link is
// a convenience; the answer reaching the accountant is the product.

import { invoiceNoticeHref } from "./accountant-deep-links";
import { VRAAG_STATUS } from "./vragen";

// The supabase client shape, loosely — the same escape hatch accountant.repository.ts uses, for
// the same reason: the generated client type is enormous and this module only ever reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export interface AnswerNoticeInput {
  /** The client who is answering — the invoice's owner and the `clientId` of the target route. */
  senderId: string;
  /** The accountant receiving the answer. The question must be THEIRS. */
  receiverId: string;
  /** The invoice the answering screen named, already validated as a UUID by the caller. */
  invoiceId: string;
}

/**
 * The deep link for this answer, or null — and null is the normal, safe outcome.
 *
 * Null covers every reason: no question, someone else's question, a question the accountant has
 * already cleared, an invoice that is not the sender's, an unreadable invoice date, and a read
 * that FAILED. The caller then uses the conversation link it always wrote. They are deliberately
 * not distinguished in the return value: there is exactly one thing to do about all of them.
 */
export async function answerNoticeLink(supabase: Sb, input: AnswerNoticeInput): Promise<string | null> {
  const { senderId, receiverId, invoiceId } = input;
  if (!senderId || !receiverId || !invoiceId) return null;

  // 1. THE QUESTION. Read under the client's own session: acc_status_client_read_invoice lets an
  //    owner see the questions asked about invoices they own, which is exactly the proof needed
  //    and nothing wider.
  //
  //    `.limit(1)` rather than `.maybeSingle()`: the UNIQUE(accountant_id, subject_type,
  //    subject_id) arrived in a later migration, so a database that predates it can hold two rows
  //    and would answer PGRST116 — an error, which this would then read as "no question". Safe,
  //    but wrong for the wrong reason. One row is all this needs.
  const { data: questions, error: questionError } = await supabase
    .from("accountant_subject_status")
    .select("subject_id")
    .eq("subject_type", "invoice")
    .eq("subject_id", invoiceId)
    .eq("accountant_id", receiverId)
    .eq("status", VRAAG_STATUS)
    .limit(1);

  if (questionError) {
    // [NO-SILENT-EMPTY] "We could not check" is not "there is no question". The outcome is the
    // same — no deep link — but it is said out loud instead of inferred from an empty array.
    console.error("[KANTOOR-LINKS] openstaande vraag niet leesbaar", {
      senderId, receiverId, error: (questionError as { message?: string }).message ?? String(questionError),
    });
    return null;
  }
  if (!Array.isArray(questions) || questions.length === 0) return null;

  // 2. THE INVOICE, for its date and as a second, independent proof of ownership. RLS already
  //    scopes this read; the explicit filter says so in the query rather than relying on it.
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_date")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${senderId},receiver_id.eq.${senderId}`)
    .maybeSingle();

  if (invoiceError) {
    console.error("[KANTOOR-LINKS] factuur bij antwoord niet leesbaar", {
      senderId, error: (invoiceError as { message?: string }).message ?? String(invoiceError),
    });
    return null;
  }
  if (!invoice) return null;

  // 3. The period comes from the invoice's own date; an unreadable one yields null here, and the
  //    caller falls back rather than naming a quarter nobody computed.
  return invoiceNoticeHref(senderId, invoice.id, invoice.invoice_date);
}
