// src/lib/period-context.ts
// [KANTOOR-PERIODE] Which client-period a read is TRUE OF — carried with the read itself.
// Pure: no I/O, no React. Run: npx tsx --test src/lib/period-context.test.ts
//
// WHY THIS EXISTS
//
// The accountant's quarter screen re-reads five sources when the client, the year or the quarter
// changes. The reads are asynchronous and the heading is not: the moment `q` goes from 3 to 2 the
// screen already says "Q2 2026", while the state still holds everything Q3 answered. Without an
// identity travelling WITH each answer, a Q3 readiness gap, a Q3 open question and Q3's reconciled
// turnover all render for a few hundred milliseconds underneath a Q2 heading — and every one of
// them reads as a fact about Q2.
//
// Nothing here is about time. There is no debounce, no "the newest response wins", no assumption
// that a request started later also finishes later — a slow Q3 read can land long after a fast Q2
// read, and on a bad connection it does. Two rules, both about IDENTITY:
//
//   · readFor()      — a held answer is consumed only when it is about the period now on screen.
//                      Otherwise it is null, which the screen must render as STILL READING, never
//                      as a failed read and never as an empty result. See [NO-SILENT-EMPTY].
//   · acceptStamped()— an answer is written to state only when it is about the period now on
//                      screen. A late answer to an abandoned request is DROPPED, so it can never
//                      overwrite the newer period's result that is already there.
//
// The identity is not business identity and is never stored: it exists for the length of one
// render, to answer "is this answer about what I am looking at".

/** The three things that together decide which truth belongs on the screen. */
export interface PeriodContext {
  clientId: string;
  year: number;
  quarter: number;
}

/**
 * One comparable string per client-period.
 *
 * `|` because a uuid, a year and a quarter cannot contain it, so two different contexts cannot
 * collide into one identity by concatenation.
 */
export function periodIdentity(context: PeriodContext): string {
  return `${context.clientId}|${context.year}|${context.quarter}`;
}

/** An answer, plus the period it is an answer ABOUT. */
export interface Stamped<T> {
  identity: string;
  value: T;
}

/** Stamp an answer with the context that was asked — done at the call site, before awaiting. */
export function stampFor<T>(context: PeriodContext, value: T): Stamped<T> {
  return { identity: periodIdentity(context), value };
}

/**
 * The answer, but only if it answers the period on screen.
 *
 * `null` means "no answer for THIS period yet" — which is pending, not failure, and not emptiness.
 */
export function readFor<T>(held: Stamped<T> | null | undefined, identity: string): T | null {
  return held != null && held.identity === identity ? held.value : null;
}

/**
 * What the state becomes when an answer lands.
 *
 * An answer about a period nobody is looking at is dropped on the floor — it does not replace what
 * is held, and it does not become what is held. That is the whole of the race contract: the late
 * Q3 response cannot overwrite the Q2 result, whatever order the two requests happened to resolve
 * in.
 */
export function acceptStamped<T>(
  held: Stamped<T> | null,
  incoming: Stamped<T>,
  identity: string,
): Stamped<T> | null {
  return incoming.identity === identity ? incoming : held;
}
