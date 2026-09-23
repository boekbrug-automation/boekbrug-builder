// src/app/api/cron/intake-drain/route.ts
// [ONTVANGEN-DRAIN] The recovery heartbeat for receive-first.
//
// The immediate kick after an upload is what makes the common case fast. This is what makes the
// promise true: a kick that never started, a worker killed at its ceiling, a platform that dropped
// the work — every one of them leaves a document in `wacht_op_lezen`, and this comes back for it.
//
// SECURITY: it walks every account, so it must never be publicly callable — Bearer CRON_SECRET,
// fail-closed, the same guard as /api/cron/reconcile and /api/cron/email-sync.
//
// ── SCHEDULED, AND STILL DARK ────────────────────────────────────────────────────────────────
//
// vercel.json runs this every 15 minutes. The preconditions it waited for are live and proven:
// the intake intent columns, the retry/fair-use columns and their two RPCs, uq_invoices_document_id,
// notifications.event_key with its partial UNIQUE, and intake_claims.
//
// Being scheduled is NOT being switched on. ONTVANGEN_RECEIVE_FIRST_ENABLED is still absent, so
// /api/intake keeps taking the synchronous road and nothing ever enters wacht_op_lezen — every
// pass selects nothing and does nothing. That is the point of wiring it first: the recovery loop
// is already running and proven empty on the day the flag flips, instead of being the last
// untested thing switched on at the same moment as the road it has to rescue.
//
// The quarter-hour is bounded from above by an hour: /api/intake sweeps every claim of that owner
// older than one hour without reading the key, so a drain that stayed away longer would meet
// documents whose claim had already been swept. Four passes per hour keeps a wide margin.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { runIntakeDrain } from "@/lib/intake-drain";
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
import { createPipelineClient } from "@/lib/supabase-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The three outside reaches, injectable — and nothing else.
 *
 * [READINESS-DEGRADE] is the precedent and the reason: what this door decides on a degraded pass
 * cannot be asserted from the source alone, and a decision that only exists inside an `if` in a
 * route is a decision no test can reach. Production passes none of these.
 */
export interface DrainRouteDeps {
  runDrain?: typeof runIntakeDrain;
  begin?: typeof beginCronRun;
  finish?: typeof finishCronRun;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: () => any;
}

export async function GET(req: NextRequest) {
  return drainResponse(req);
}

/** The whole door, seamed. GET is this function with the real world behind it. */
export async function drainResponse(req: NextRequest, deps: DrainRouteDeps = {}): Promise<NextResponse> {
  const runDrain = deps.runDrain ?? runIntakeDrain;
  const begin = deps.begin ?? beginCronRun;
  const finish = deps.finish ?? finishCronRun;
  const client = deps.client ?? createPipelineClient;
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[ONTVANGEN-DRAIN] CRON_SECRET is not configured — the drain is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  // [SECURITY] Constant-time compare — a plain !== leaks the secret through response timing over
  // repeated guesses. Same helper every other cron door uses.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Only AFTER the gate: an unauthorised probe may not write a heartbeat row, or
  // the health screen would report a cron as alive on the strength of someone knocking on it.
  //
  // The row is what makes this job's silence readable. A drain that does nothing looks exactly
  // like a drain that never ran — and once the flag is on, the difference between those two is a
  // document the owner was told we had. CRON_JOBS carries the matching entry.
  const cronRunId = await begin(client(), "intake-drain", new Date().toISOString());
  try {
    const report = await runDrain();
    // [NO-SILENT-EMPTY] A pass that could not READ one of its two work lists is a degraded run,
    // and the heartbeat is the one place a human looks to find that out. Recording ok:true over it
    // would launder the distinction both report types were shaped to preserve, one layer further
    // up: the row would say the drain ran cleanly, while nobody measured the backlog it owed.
    //
    // BOTH halves are named, and named SEPARATELY. They are two statements against the same table
    // and they fail apart — a reader scan can time out while the notice scan answers, and an
    // operator reading "degraded" needs to know which backlog was not measured, because only one
    // of the two costs an owner a document they were told we had.
    const degraded: string[] = [];
    if (report.reader.kind === "unavailable") degraded.push(`reader unavailable: ${report.reader.error}`);
    if (report.notices.kind === "unavailable") degraded.push(`notices unavailable: ${report.notices.error}`);
    const ok = degraded.length === 0;
    await finish(client(), cronRunId, ok
      ? { ok: true, result: report }
      : { ok: false, error: degraded.join("; "), result: report });
    return NextResponse.json({ ok, ...report });
  } catch (e) {
    // runIntakeDrain isolates each document, so reaching here means the SELECT itself failed. The
    // documents are untouched and still waiting; the next pass reads them again.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[ONTVANGEN-DRAIN] the pass could not run", { error: message });
    await finish(client(), cronRunId, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
