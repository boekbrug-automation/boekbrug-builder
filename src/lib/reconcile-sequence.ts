// src/lib/reconcile-sequence.ts
// [RECONCILE-VOLGORDE] One owner for WHICH reconcile passes run, in WHAT order, and under WHOSE
// authority. Nothing else.
//
// ── WHY THIS FILE EXISTS ──
// The reconcile circle had two orchestrators and no owner: the hourly cron
// (/api/cron/reconcile, every user, unattended) and the "Matchen met bank & kas" button
// (POST /api/reconcile/run, one signed-in owner). Each listed the passes itself, and the button's
// own header said:
//
//     "It runs exactly the same three passes the cron runs, in the same order"
//
// That was true when it was written. The cron has since grown two more passes — settleIncassoForUser
// and proposeIncassoMandates — and the word "incasso" appears nowhere in the button's route. Nothing
// could see the difference: no gate compared the two lists, so the claim stayed in the file and the
// drift stayed in production. A list kept by hand in two places is a list that is wrong in one of
// them, and nobody can tell which.
//
// ── WHAT THIS FILE OWNS, AND WHAT IT MUST NEVER OWN ──
// OWNS: the pass identities, their ORDER, the AUTHORITY each pass writes with, which orchestrator
// runs which pass, and the single place each underlying helper is invoked.
//
// NEVER OWNS — these stay exactly where they are, with their current owners:
//   · business rules, payment decisions, matching decisions  → bank-matching.ts, the SQL RPCs
//   · the database mutations themselves                      → the helpers and the RPCs below them
//   · failure handling, retry, notifications                 → the CALLERS, and deliberately so:
//     the two orchestrators have measurably different failure semantics (the cron isolates per
//     user and Sentry's per phase; the button collects a `failed[]` the browser reads back), and
//     flattening them into one policy here would be a retry framework nobody asked for.
//
// So a caller walks this list and executes it. It does not hand the whole run to a
// runReconcileSequence() that swallows everything — that would only rename the orchestrator.
//
// ── AUTHORITY IS (PASS × ACTOR), NOT A FIXED CLIENT ──
// The clients on the context are named by the ROLE they play, never by the library that produced
// them. That naming is the point. Before this file, the same money pass was handed a variable
// called `supabase` from five places, and in email-integration.ts that variable is
// `createPipelineClient()` — a service-role client wearing the name of a session one. A reader
// checking "does this book as the owner?" got the wrong answer from the variable name alone.
//
//   actorPay   — writes the actor's own money decisions. A SESSION client where a session exists
//                (the button), the service-role client where there is none (the unattended cron).
//                This is what lets the accountant-'verwerkt' trigger fire with a real auth.uid()
//                on the button, exactly as it does today.
//   service    — reads, and writes that are never the actor's own money decision. ALWAYS
//                service-role, in both orchestrators, today and after this change.
//
// Run: npx tsx --test src/lib/reconcile-sequence.test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { PipelineClient } from "./supabase-pipeline";
import { runBankAutoConfirm, type AutoConfirmed } from "./bank-auto-confirm";
import { reconcileCashSettlements, type CashSettleSummary } from "./cash-settle";
import { applyLearnedBankCategories, type AutoCategorized } from "./bank-auto-categorize";
import {
  settleIncassoForUser,
  proposeIncassoMandates,
  type IncassoSettleSummary,
  type IncassoProposal,
} from "./incasso-settle";

/** The two orchestrators that run the reconcile circle. Nothing else may claim to be one. */
export type ReconcileCaller = "cron" | "manual";

/**
 * Which client a pass performs its WRITES with.
 *
 * `actor-pay`    — the acting owner's own client. Service-role only where there is no session at
 *                  all (the cron), never as a convenience.
 * `service-role` — always the pipeline client, in every orchestrator. A pass declared this way
 *                  must not touch `actorPay`; the gate checks that against this file's source.
 */
export type PassAuthority = "actor-pay" | "service-role";

export type ReconcilePassId =
  | "bank-auto-confirm"
  | "cash-settle"
  | "auto-categorize"
  | "incasso-settle"
  | "incasso-propose";

/** Clients named by the role they play — never by the library that produced them. */
export interface ReconcileContext {
  /** The acting owner's client: the session client where there is a session, service-role in the cron. */
  actorPay: SupabaseClient<Database>;
  /** Always service-role. Reads, and writes that are never the actor's own money decision. */
  service: PipelineClient;
  userId: string;
  /** Amsterdam day, supplied by the caller. Only the incasso pass reads it. */
  today: string;
}

/**
 * A pass result, tagged with its own id.
 *
 * Tagged rather than `unknown` so a caller's switch is exhaustive at COMPILE time: add a pass to
 * this union and every orchestrator that does not handle it stops type-checking. That is the
 * mechanical half of "a pass added to the sequence cannot be silently ignored by a caller".
 */
export type ReconcilePassResult =
  | { id: "bank-auto-confirm"; booked: AutoConfirmed[] }
  | { id: "cash-settle"; cash: CashSettleSummary }
  | { id: "auto-categorize"; categorized: AutoCategorized[] }
  | { id: "incasso-settle"; incasso: IncassoSettleSummary }
  | { id: "incasso-propose"; proposals: IncassoProposal[] };

// Re-exported so an orchestrator can name a pass result WITHOUT importing the pass helper itself.
// That is not tidiness: the [RECONCILE-VOLGORDE] gates refuse a helper import in an orchestrator,
// because an import is the first half of a direct call, and a direct call is the drift.
export type { AutoConfirmed, CashSettleSummary, AutoCategorized, IncassoSettleSummary, IncassoProposal };

export interface ReconcilePass {
  readonly id: ReconcilePassId;
  readonly authority: PassAuthority;
  /** The orchestrators that run this pass. A pass the button does not run says so HERE, with its reason. */
  readonly runsIn: readonly ReconcileCaller[];
  /** Why this authority, and why this position. Written down because the next reader's instinct is to unify. */
  readonly why: string;
  run(ctx: ReconcileContext): Promise<ReconcilePassResult>;
}

/**
 * The reconcile circle, in order. THE ORDER IS PART OF THE CONTRACT — see each `why`.
 *
 * This list is the whole point of the file: it is the only place the membership, the order and the
 * authority of a reconcile pass are written down, and both orchestrators walk it.
 */
export const RECONCILE_PASSES: readonly ReconcilePass[] = [
  {
    id: "bank-auto-confirm",
    authority: "actor-pay",
    runsIn: ["cron", "manual"],
    why:
      "FIRST because a real bank line is evidence and everything after it is a weaker claim: wherever " +
      "two passes could settle the same invoice, the evidence must get there first and the assumption " +
      "must find it paid. Writes invoice→'paid' as the ACTOR so the accountant-'verwerkt' trigger " +
      "fires with a real auth.uid() on the button; the bank-line link uses the user-pinned service client.",
    async run(ctx) {
      return {
        id: "bank-auto-confirm",
        booked: await runBankAutoConfirm({ payClient: ctx.actorPay, pipeline: ctx.service, userId: ctx.userId }),
      };
    },
  },
  {
    id: "cash-settle",
    authority: "actor-pay",
    runsIn: ["cron", "manual"],
    why:
      "AFTER the bank pass: a payment that pass just booked as 'kas' becomes a dated kasboek entry, " +
      "and reconciling before it exists leaves the drawer one pass behind. Writes the owner's kasboek, " +
      "so it books with the same authority the bank pass paid with.",
    async run(ctx) {
      return { id: "cash-settle", cash: await reconcileCashSettlements(ctx.actorPay, ctx.userId) };
    },
  },
  {
    id: "auto-categorize",
    authority: "service-role",
    runsIn: ["cron", "manual"],
    why:
      "Never an actor money decision — it only writes a confident category onto a bank line from the " +
      "owner's own learned memory, which is why it is service-role in BOTH orchestrators today and " +
      "stays so. Last of the three shared passes: it codes what the two above have finished with.",
    async run(ctx) {
      return { id: "auto-categorize", categorized: await applyLearnedBankCategories({ pipeline: ctx.service, userId: ctx.userId }) };
    },
  },
  {
    id: "incasso-settle",
    authority: "actor-pay",
    // CRON ONLY, and this is a DECLARED difference, not the drift this file exists to end.
    runsIn: ["cron"],
    why:
      "Books a payment nobody observed — the bank collected it under a mandate — so it is the one pass " +
      "here that settles invoices on an assumption. It runs unattended, in an hourly pass whose " +
      "authority is service-role because there is no session at all. Putting it on the button would " +
      "mean choosing a NEW authority for it (the session client, or a service-role escalation on a " +
      "human tap); both change authorization semantics, so neither is this slice's to choose. Declared " +
      "cron-only here, where the difference is visible, instead of missing from a list nobody compared.",
    async run(ctx) {
      return { id: "incasso-settle", incasso: await settleIncassoForUser(ctx.service, ctx.actorPay, ctx.userId, ctx.today) };
    },
  },
  {
    id: "incasso-propose",
    authority: "service-role",
    // CRON ONLY — same reasoning as above; see also the caller's note on the stamp that follows it.
    runsIn: ["cron"],
    why:
      "Reads bank lines and PROPOSES a mandate; it books nothing, so it is service-role. Cron-only for " +
      "the same reason as the pass above, plus one of its own: the proposal is asked exactly once per " +
      "supplier (incasso_suggested_at), so a pass the owner can re-trigger by tapping a button is a " +
      "different question from an hourly one that asks once and remembers.",
    async run(ctx) {
      return { id: "incasso-propose", proposals: await proposeIncassoMandates(ctx.service, ctx.userId) };
    },
  },
] as const;

/**
 * The passes this orchestrator runs, in the declared order.
 *
 * The ONLY way an orchestrator should learn which passes it runs. A caller that filters this list
 * further, or calls a pass helper directly, has taken the ownership back — which is exactly what
 * the [RECONCILE-VOLGORDE] gates refuse.
 */
export function passesFor(caller: ReconcileCaller): readonly ReconcilePass[] {
  return RECONCILE_PASSES.filter((p) => p.runsIn.includes(caller));
}
