// src/lib/numbering-first-send.ts
// [NUMMER-EENMALIG] The one-time numbering choice, surfaced at the first send. Pure, no I/O.
// Run: npx tsx --test src/lib/numbering-first-send.test.ts
//
// ── THE GAP THIS CLOSES, AND WHO MADE IT ────────────────────────────────────────────────────
//
// Invoice numbering is configurable until the first invoice is ISSUED, and locked forever after
// (art. 35 Wet OB 1968: one sequential, gapless, forward-only series). That is correct and it
// stays exactly as it is.
//
// What changed is who ever SEES the choice. [EERSTE-DEUR] took the legacy wizard off the
// new-account path, on purpose — and the wizard was one of only two callers of
// POST /api/invoice/numbering. The other is the settings screen. So a new owner now reaches their
// first invoice without the choice ever having been put to them, and [VERKOPER-COMPLEET] made
// reaching that first invoice considerably easier. The default is valid and needs no setup; what
// was missing is that nobody was told the first issuance fixes it.
//
// This module is the decision half of the fix: what the confirmation may say, and what it may
// offer. It is NOT a numbering authority. It parses nothing, seeds nothing, and mints nothing.
//
// ── WHY THE BROWSER MAY NEVER CONCLUDE "UNLOCKED" ───────────────────────────────────────────
//
// GET /api/invoice/numbering already answers fail-closed: an unreadable issued-invoice count is
// reported as `locked` ([LOCK-READ-HONEST] in that route). This module keeps that discipline one
// step further out — a response whose `locked` field is not a boolean is `unknown`, never open.
// Showing an editable numbering form to an owner whose series has in fact already issued would
// invite the 409 at best, and at worst suggest that a fixed series is still theirs to reshape.
//
// The fail direction is always "offer nothing". A default that needs no setup costs the owner one
// glance; a numbering form that lies costs them a series they cannot repair.

/** What the confirmation knows about this owner's numbering, at the moment they press send. */
export type NumberingState =
  /** We could not tell. A failed read, a shape we do not recognise, or a lock we cannot trust. */
  | { kind: "unknown" }
  /**
   * [ACTING-FOR] A sales member. The series belongs to their employer, their session cannot read
   * it, and a form here would write the wrong person's configuration. Not an error — their send
   * is unaffected; the question simply is not theirs.
   */
  | { kind: "not-owner" }
  /** A number has already been drawn from this counter. Nothing to explain, nothing to offer. */
  | { kind: "locked" }
  /** Still open: `next` is what the first invoice will carry, and it can still be changed. */
  | { kind: "open"; next: string; isCustom: boolean };

/**
 * The answer from GET /api/invoice/numbering, turned into one of four states.
 *
 * Every branch that is not an explicit, well-formed "locked: false" with a number to name lands on
 * `unknown`. That includes a 200 whose body is missing, malformed, or carries `locked` as anything
 * other than a boolean — a truthiness test there ("locked" as the string "false", say) is exactly
 * how a browser starts believing a fixed series is editable.
 */
export function classifyNumberingRead(status: number, body: unknown): NumberingState {
  if (status === 403) return { kind: "not-owner" };
  if (status < 200 || status >= 300) return { kind: "unknown" };

  const b = (body ?? {}) as { ok?: unknown; locked?: unknown; next?: unknown; isCustom?: unknown };
  if (b.ok !== true) return { kind: "unknown" };
  if (typeof b.locked !== "boolean") return { kind: "unknown" };
  if (b.locked) return { kind: "locked" };

  // Open, but only if we can NAME the number. "You may still change it, to something, from
  // something we cannot show you" is not a choice anyone can make.
  const next = typeof b.next === "string" ? b.next.trim() : "";
  if (next.length === 0) return { kind: "unknown" };

  return { kind: "open", next, isCustom: b.isCustom === true };
}

/** What the first-send confirmation shows about numbering, or nothing at all. */
export interface FirstSendNumbering {
  /** The number this invoice is expected to carry. */
  next: string;
  /**
   * Say, once, that issuing this invoice fixes the series.
   *
   * Only for an owner still on the untouched default — they are the ones who never saw the
   * question. An owner who already configured their numbering MADE this choice; repeating the
   * warning at every send would be a nag about a decision they took deliberately.
   */
  explainOnce: boolean;
  /** May it be adjusted here and now? */
  adjustable: boolean;
}

/**
 * Nothing for `locked`, `unknown` or `not-owner` — and `null` means the confirmation renders
 * exactly what it rendered before this batch. That is the point: this adds a sentence for the
 * owner who needs it, and changes nothing for everyone else.
 */
export function firstSendNumbering(state: NumberingState): FirstSendNumbering | null {
  if (state.kind !== "open") return null;
  return { next: state.next, explainOnce: !state.isCustom, adjustable: true };
}

// ── The save ──────────────────────────────────────────────────────────────────────────────────

export type NumberingSave =
  /** Stored and seeded by the one authority. `next` is what IT says the series now starts at. */
  | { outcome: "saved"; next: string }
  /** The parser refused the input. The owner can fix this; the message is the route's own. */
  | { outcome: "invalid"; message: string }
  /** 409 — a number was drawn while this dialog was open. The series is fixed now. */
  | { outcome: "locked" }
  /** Anything else: a 503, a 500, an answer we do not recognise. */
  | { outcome: "failed" };

/**
 * The answer from POST /api/invoice/numbering.
 *
 * `invalid` and `locked` are kept apart from `failed` because the owner can act on the first,
 * must be told about the second, and can only retry the third. None of the three sends.
 */
export function classifyNumberingSave(status: number, body: unknown): NumberingSave {
  const b = (body ?? {}) as { ok?: unknown; next?: unknown; locked?: unknown; error?: unknown };

  if (status >= 200 && status < 300) {
    if (b.ok !== true) return { outcome: "failed" };
    const next = typeof b.next === "string" ? b.next.trim() : "";
    return next.length > 0 ? { outcome: "saved", next } : { outcome: "failed" };
  }

  if (status === 409 || b.locked === true) return { outcome: "locked" };
  if (status === 400) {
    const message = typeof b.error === "string" && b.error.trim().length > 0 ? b.error.trim() : "";
    return message.length > 0 ? { outcome: "invalid", message } : { outcome: "failed" };
  }
  return { outcome: "failed" };
}

/**
 * May the send continue on the strength of this outcome? `saved` and nothing else.
 *
 * One line, so the rule can be asserted directly rather than inferred from the call site. A
 * refused or failed numbering change must not become an issued invoice under numbering the owner
 * believes they changed — that is a worse outcome than not sending, because it cannot be undone.
 *
 * A type PREDICATE rather than a plain boolean, deliberately: past this check the caller may read
 * `save.next`, and nowhere else may. The compiler then refuses a call site that treats a refusal
 * as though it carried a number — the rule is enforced rather than merely documented.
 */
export function saveAllowsSend(save: NumberingSave): save is { outcome: "saved"; next: string } {
  return save.outcome === "saved";
}

/**
 * Is there anything to send to the authority at all?
 *
 * THE ZERO-SETUP PATH RUNS THROUGH HERE. An owner who reads the sentence and presses send has
 * touched nothing, so this answers false, no request is made, and the default stands. The POST
 * exists only for an owner who typed something — accepting the default must never cost a write.
 */
export function numberingChangeRequested(opened: boolean, input: string): boolean {
  return opened && input.trim().length > 0;
}
