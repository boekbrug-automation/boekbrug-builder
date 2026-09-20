// src/lib/accountant-links.ts
// [VRAAG-EIGENAAR] An owner may have more than one accountant — and the code that assumed one.
//
// accountant_clients is UNIQUE(accountant_id, zzper_id) and nothing else: an owner with two offices
// (a bookkeeper for the day-to-day and an accountant for the year-end) has two rows, and that is the
// designed shape, not a corruption. Three screens on the owner's side nevertheless read "the"
// accountant with `.maybeSingle()`: /dashboard/vragen, the home's Berichten door and the rail's.
// With two rows supabase-js answers PGRST116 — an error the callers threw away — so the owner saw
// "no accountant linked" on the questions screen, with the questions from both offices listed above
// it and nowhere to answer them (audit VR-02).
//
// The fix is NOT to forbid the second row. A question row carries `accountant_id`; the answer goes
// to THAT accountant; the link table is read as the collection it is. This module holds the pure
// half of that: what a read of the collection means, and what follows from it for one question.
//
// [NO-SILENT-EMPTY] Four outcomes, never collapsed: the read FAILED (we do not know who is linked),
// ZERO links, ONE link, MANY links. A failed read is not "no accountant" — that reads as a revoked
// mandate — and many links is not "the first one".

export type AccountantLinks =
  | { state: "failed" }
  | { state: "known"; ids: string[] };

/** What a session read of `accountant_clients` for this owner (`.eq('zzper_id', me)`) means. */
export function classifyAccountantLinks(read: {
  data: ReadonlyArray<{ accountant_id: string | null }> | null;
  error: unknown;
}): AccountantLinks {
  if (read.error) return { state: "failed" };
  if (!Array.isArray(read.data)) return { state: "failed" };
  const ids = [...new Set(read.data.map((l) => l.accountant_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
  return { state: "known", ids };
}

/** Whether the accountant who asked a question is currently linked, as far as the read can tell. */
export type QuestionLinkState = "linked" | "unlinked" | "unknown";

export function linkStateOf(askerId: string | null | undefined, links: AccountantLinks): QuestionLinkState {
  if (links.state === "failed") return "unknown";
  if (!askerId) return "unlinked"; // a row without an asker can be answered by nobody
  return links.ids.includes(askerId) ? "linked" : "unlinked";
}

/**
 * Who an answer to this question goes to — or why it goes nowhere.
 *
 * The receiver is the ASKER, never "the accountant": with two offices, each question is answered
 * to the office that asked it. An asker who is no longer linked gets no answer button that would
 * pretend the relationship still exists (the server refuses that send anyway: /api/messages checks
 * the pair); a link read that failed gets none either, because "linked" is then a guess.
 */
export type AnswerTarget =
  | { ok: true; accountantId: string }
  | { ok: false; reason: "unlinked" | "unknown" };

export function answerTargetFor(askerId: string | null | undefined, links: AccountantLinks): AnswerTarget {
  const state = linkStateOf(askerId, links);
  if (state === "linked" && askerId) return { ok: true, accountantId: askerId };
  return { ok: false, reason: state === "unknown" ? "unknown" : "unlinked" };
}

/**
 * Where the owner's "Berichten" door opens. Exactly one accountant → that conversation, as the home
 * always did. Zero, several, or a read that failed → the inbox, where every conversation is listed
 * and the choice is the owner's. Never `.limit(1)`: a door that opens on whichever office the
 * database happened to return first is a door to the wrong room half the time.
 */
export function messagesDoorHref(links: AccountantLinks): string {
  if (links.state === "known" && links.ids.length === 1) {
    return `/dashboard/messages/${encodeURIComponent(links.ids[0])}`;
  }
  return "/dashboard/messages";
}

/**
 * The accountant ids whose NAMES the owner may be shown: the askers of the questions the owner can
 * already see (the rows came through the owner's own RLS) and the owner's current links. Names are
 * read with service_role because profiles has no policy the owner's way round — so the proof of
 * a relationship has to come from here, and never from the service role itself.
 */
export function provenAccountantIds(
  questions: ReadonlyArray<{ accountantId: string | null }>,
  links: AccountantLinks,
): string[] {
  const ids = new Set<string>();
  for (const q of questions) if (q.accountantId) ids.add(q.accountantId);
  if (links.state === "known") for (const id of links.ids) ids.add(id);
  return [...ids];
}
