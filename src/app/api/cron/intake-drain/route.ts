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
// ── NOT SCHEDULED YET, AND THAT IS DELIBERATE ────────────────────────────────────────────────
//
// vercel.json is untouched. Adding the schedule is a production step that belongs with the other
// deployment preconditions — the intake intent columns, the retry/fair-use columns and RPCs,
// uq_invoices_document_id, notifications.event_key and its partial UNIQUE, and the claim table —
// all of which must be proven live BEFORE receive-first is switched on. A drain that runs against
// a database missing one of them would find waiting documents it cannot finish.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { runIntakeDrain } from "@/lib/intake-drain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
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

  // [CRON-HARTSLAG] No heartbeat row yet, and that is deliberate rather than an omission: the
  // heartbeat judges a cron by when it last ran, so registering a job that is not scheduled would
  // put a permanent "nooit gedraaid" on the health screen and teach everyone to ignore it. The
  // CRON_JOBS entry goes in together with the vercel.json schedule.
  try {
    const report = await runIntakeDrain();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    // runIntakeDrain isolates each document, so reaching here means the SELECT itself failed. The
    // documents are untouched and still waiting; the next pass reads them again.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[ONTVANGEN-DRAIN] the pass could not run", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
