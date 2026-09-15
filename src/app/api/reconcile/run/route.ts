// src/app/api/reconcile/run/route.ts
// [MATCH-BUTTON] "Matchen met bank & kas" — the ONE on-demand entry point that turns the whole
// matching circle for the signed-in owner, on a tap, instead of waiting for the hourly cron
// (/api/cron/reconcile) or for a browser to happen to sit on /dashboard/bank or /kas.
//
// [RECONCILE-VOLGORDE] WHICH passes run here, in what ORDER, and under whose AUTHORITY is not
// decided in this file — it is read from src/lib/reconcile-sequence.ts, the one owner of that
// list, which the hourly cron reads too. This header used to COUNT its passes and claim they were
// exactly the cron's, in the cron's order. That was true when it was written, and then the cron
// grew two more (incasso settle + mandate proposal) while this route did not. Nothing could see
// the difference, because the two lists were kept by hand in two files and no gate compared them.
// A route that names or counts its own passes is a route that can silently fall behind, so this
// one does neither: it walks passesFor("manual") and handles whatever comes back.
//
// What stays HERE, and deliberately: the failure semantics. Each pass is isolated, `failed` names
// the ones that broke, and `ok` is false whenever anything failed — the browser reads that array
// back. The cron answers failure a different way (per-user isolation, Sentry per phase), and
// flattening the two into one policy would be a retry framework nobody asked for.
// Then it returns the FRESH per-invoice reconciliation map (buildInvoiceReconciliationMap, the
// same builder the badges use) so the caller can update its rows and honestly report what is
// left for the human — without a second round trip that could disagree with itself.
//
// Money discipline is inherited, not re-invented. Nothing here decides what to book: the
// invoice→'paid' write goes through the SESSION client so the DB 'verwerkt' guard fires with a
// real auth.uid(), and only isEligible + autoConfirmTier matches are touched. Ambiguity still
// stops at the human — this button never books a 'choice'.
//
// Idempotent: every pass is safe to repeat, so double-tapping changes nothing the first tap
// didn't already do. Each pass is isolated so one failure still reports the others truthfully
// (`failed` names them; `ok` is false whenever anything failed).

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { passesFor, type ReconcilePassId, type AutoConfirmed, type CashSettleSummary } from "@/lib/reconcile-sequence";
import { buildInvoiceReconciliationMap } from "@/lib/bank-recon-map";
import { amsterdamToday } from "@/lib/format-nl";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// The passes are read-heavy on a busy account (paginated statements × open invoices). This line
// used to count them, which is the same hand-kept number the header above got wrong — found by the
// [RECONCILE-VOLGORDE] gate, a few lines away from the claim it was written for.
export const maxDuration = 120;

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cheap to tap, expensive to serve (the whole statement × every open invoice). The run is
  // idempotent so a blocked retry loses nothing — the hourly cron does the same work anyway.
  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/reconcile/run",
    ...RATE_LIMITS.RECONCILE_RUN,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const pipeline = createPipelineClient();
  const failed: string[] = [];

  const fail = (phase: string, e: unknown) => {
    failed.push(phase);
    console.error("[RECONCILE-RUN] phase failed", { phase, userId: user.id, error: e instanceof Error ? e.message : String(e) });
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
      tags: { route: "reconcile-run", phase },
      extra: { userId: user.id },
    });
  };

  // [RECONCILE-VOLGORDE] The phase names this route reports back. They are a PUBLIC contract —
  // IncomingManageClient reads `failed` and asks it whether 'map' is in there — so they are the
  // route's own words for a pass, not the pass ids, and they stay exactly as they were.
  //
  // A word for EVERY pass, including the two this route does not run. That is the tripwire, not an
  // oversight: a Record over every ReconcilePassId stops this file compiling the moment a sixth pass
  // is declared, so nobody can add one and leave the button with nothing to say about it.
  const PHASE: Record<ReconcilePassId, string> = {
    "bank-auto-confirm": "bank",
    "cash-settle": "kas",
    "auto-categorize": "categorize",
    "incasso-settle": "incasso",
    "incasso-propose": "incasso-voorstel",
  };

  // [RECONCILE-VOLGORDE] Clients named by the ROLE they play. `actorPay` is the SESSION client
  // here — that is what makes the invoice→'paid' write carry a real auth.uid(), so the
  // accountant-'verwerkt' trigger fires — while everything that is not the actor's own money
  // decision reads and writes through the service-role pipeline.
  const ctx = { actorPay: supabase, service: pipeline, userId: user.id, today: amsterdamToday() };

  let booked: AutoConfirmed[] = [];
  let cash: CashSettleSummary = { ok: false, created: 0, updated: 0, deleted: 0 };
  let categorized = 0;

  for (const pass of passesFor("manual")) {
    try {
      const r = await pass.run(ctx);
      switch (r.id) {
        case "bank-auto-confirm":
          // The bell notification is sent from inside the helper.
          booked = r.booked;
          break;
        case "cash-settle":
          // Self-healing and idempotent; reports what it actually changed so the button never
          // claims drawer work it did not do. A bail is a failure even though it never threw.
          cash = r.cash;
          if (!cash.ok) failed.push(PHASE["cash-settle"]);
          break;
        case "auto-categorize":
          // An automatic category lands in the P&L immediately, so it stays reviewable — see
          // /dashboard/bank/categoriseren.
          categorized = r.categorized.length;
          break;
        default:
          // A pass declared to run here that this route does not handle would otherwise succeed
          // silently and report nothing. It is named in `failed` instead. The compiler already
          // refuses a NEW pass id outright — PHASE is a Record over every ReconcilePassId, so a
          // sixth pass stops this file type-checking until someone gives it a word to report.
          fail(PHASE[r.id], new Error(`reconcile pass '${r.id}' ran here but this route does not handle it`));
      }
    } catch (e) {
      fail(PHASE[pass.id], e);
    }
  }

  // 4) The state AFTER the engine ran: which invoices are now in the statement, and which
  //    payments were found but still need the owner's confirm (ambiguity never auto-books).
  let byInvoice: Awaited<ReturnType<typeof buildInvoiceReconciliationMap>>["byInvoice"] = {};
  let pendingTransactions = 0;
  let pendingMatchCount = 0;
  try {
    const map = await buildInvoiceReconciliationMap({ pipeline, userId: user.id });
    byInvoice = map.byInvoice;
    pendingTransactions = map.pendingTransactions;
    pendingMatchCount = map.pendingMatchCount;
  } catch (e) {
    fail("map", e);
  }

  return NextResponse.json({
    ok: failed.length === 0,
    failed,
    booked,
    bookedCount: booked.length,
    // Booked on amount + counterpart name WITHOUT a printed invoice number — real bookings, but
    // the ones worth a second look. Surfaced separately so the summary stays honest.
    amountOnlyCount: booked.filter((b) => b.tier === "amount_only").length,
    cash,
    categorized,
    pendingTransactions,
    pendingMatchCount,
    byInvoice,
  });
}
