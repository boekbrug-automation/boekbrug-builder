// src/lib/accountant-invoice-question-flow.ts
// [VRAAG-EERST] The question comes first; then exactly one write.
//
// ── WHY THIS EXISTS ──
//
// The accountant's quarter screen used to treat "Vraag" like the other two chips: it posted
// `status: 'vraag'` to /api/accountant/invoice-status, and only once that had succeeded did it open
// the dialog for the words — which it then delivered on its own, as a plain notification. Since
// [VRAAG-SYNC] the status and the words are ONE fact, written together by the database function
// behind /api/accountant/invoice-question, and a status without words is refused
// (`question_required`). So the old order could never succeed again: the first write was refused,
// the screen reverted its optimistic chip and said "Status niet opgeslagen — probeer het opnieuw."
// Measured in production on 21 September 2026, the day after PR #371 was deployed; nothing had
// been written, which was right, and nothing could be asked, which was not.
//
// This module fixes the ORDER and nothing else: ask, then write once, then show. It is pure so the
// order can be proven without a browser — the dialog and the POST are handed in.
//
// What the flow guarantees:
//   1. no write before the dialog has closed with a non-empty question. Cancelling means nothing
//      happened: no fetch, no state, no notification;
//   2. one POST, to /api/accountant/invoice-question, with { clientId, invoiceId, question }. That
//      route owns the atomic write, the client's notification and the audit row, so the screen
//      sends no second notification of its own;
//   3. the caller shows 'vraag' only after the server has accepted it. The accountant must never
//      see a question state the database does not have.

export const INVOICE_QUESTION_ROUTE = "/api/accountant/invoice-question";

export type InvoiceQuestionBody = { clientId: string; invoiceId: string; question: string };

/** The dialog: resolves with the text, or null when dismissed. */
export type QuestionPrompt = () => Promise<string | null | undefined>;

/** The POST: only `ok` and `status` are read. A thrown error or a null counts as a failed write. */
export type QuestionPost = (body: InvoiceQuestionBody) => Promise<{ ok: boolean; status: number } | null>;

export type InvoiceQuestionOutcome =
  /** Dismissed, or closed without words: nothing was sent. */
  | { kind: "cancelled" }
  /** Accepted by the server: the status and the question row exist now. */
  | { kind: "asked"; question: string }
  /** Refused or unreachable: nothing exists, so nothing may be shown. */
  | { kind: "failed"; question: string; status: number | null };

export async function askInvoiceQuestion(args: {
  clientId: string;
  invoiceId: string;
  prompt: QuestionPrompt;
  post: QuestionPost;
}): Promise<InvoiceQuestionOutcome> {
  const raw = await args.prompt();
  const question = typeof raw === "string" ? raw.trim() : "";
  if (!question) return { kind: "cancelled" };

  let res: { ok: boolean; status: number } | null;
  try {
    res = await args.post({ clientId: args.clientId, invoiceId: args.invoiceId, question });
  } catch {
    res = null;
  }
  if (res && res.ok) return { kind: "asked", question };
  return { kind: "failed", question, status: res ? res.status : null };
}
