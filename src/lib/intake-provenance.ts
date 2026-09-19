// src/lib/intake-provenance.ts
// [ONTVANGEN] Who started this run, and what an audit row may honestly say about it.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// Until #129 the intake processor ran inside the owner's own HTTP request, so `getClientIP(req)`
// was a true answer to "where did this action come from". Receive-first breaks that: the reading,
// the booking and the settlement happen after the browser is gone. There is no request, so there
// is no client IP — and the five audit rows the processor writes are financial events
// (invoice.dedup_override, invoice.duplicated, invoice.auto_verified, invoice.auto_paid, and the
// reminder filing).
//
// The tempting shortcut is to capture the IP at upload time and carry it forward. That is exactly
// the thing this module exists to prevent. `ip_address` on an audit row means "the address this
// action arrived from". Stamping a background booking with the address of an upload that happened
// minutes earlier is not a small inaccuracy: it is a financial event claiming a provenance it does
// not have, and it would be indistinguishable from one that really did come from that address.
//
// So a background run carries NO address. An absent address is true.
//
// ── BUT "NO ADDRESS" IS NOT ENOUGH ON ITS OWN ────────────────────────────────────────────────
//
// getClientIP() also returns undefined when a request simply has no x-forwarded-for header. If
// that were the whole answer, an automatic booking made by BoekBrug with nobody watching would be
// indistinguishable in the audit trail from one an owner made through a proxy that stripped the
// header. Those are different facts, and an auditor reading the row would have no way to tell.
//
// So every run also says out loud how it was started, in the audit row's own value, next to the
// `path` marker those rows already carry. Absent address + "in_background" is a complete answer;
// absent address alone is a shrug.

/** How the work reached the processor. There is no third kind, and no default. */
export type IntakeRun =
  | { kind: "request"; ip: string | undefined }
  | { kind: "background"; trigger: BackgroundTrigger }

/**
 * What woke the background pass.
 *
 * `after_receive` — the handoff just finished and processing was scheduled immediately.
 * `drain`         — a later sweep picked up a document that was still waiting on us.
 */
export type BackgroundTrigger = "after_receive" | "drain"

/**
 * The address for an audit row, or nothing.
 *
 * A background run has no client, so it has no address — and this function has no way to invent
 * one, which is the point. It takes no IP argument for a background run, so there is nowhere for
 * a stale upload-time address to be smuggled in.
 */
export function auditIpOf(run: IntakeRun): string | undefined {
  return run.kind === "request" ? run.ip : undefined
}

/**
 * The provenance marker written into the audit row's value, beside the existing `path`.
 *
 * Deliberately a flat string rather than a nested object: these rows are read by a human looking
 * at a value column, and "background:drain" answers "who did this" in one glance.
 */
export function runOriginOf(run: IntakeRun): string {
  return run.kind === "request" ? "request" : `background:${run.trigger}`
}

/**
 * True when nobody was watching — the runs whose audit rows must never carry an address.
 *
 * Exists so a test can state the rule once over every kind, instead of listing the kinds it
 * happens to know about today.
 */
export function isBackgroundRun(run: IntakeRun): boolean {
  return run.kind === "background"
}
