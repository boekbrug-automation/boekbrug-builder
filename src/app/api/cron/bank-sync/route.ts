// src/app/api/cron/bank-sync/route.ts
// [ENABLEBANKING] The daily bank feed — what makes "we import your transactions automatically"
// actually true. Vercel Cron calls this once a day (see vercel.json); it walks every linked
// connection and runs the same per-connection sync the manual button uses.
//
// SECURITY: this reads bank transactions for EVERY connected user, so it must never be publicly
// callable. It requires `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sends this when
// CRON_SECRET is set. Without the secret set the route refuses to run (fail-closed) rather than
// exposing an open all-user trigger.
//
// ── Once a day, and no more ──────────────────────────────────────────────────────────────────
// The bank allows only a handful of transaction reads per day per account. This route therefore
// does NOT force: syncBankConnection's own 20-hour guard decides per account, so a run that
// fires twice (a retry, a manual trigger) is a cheap no-op rather than a burnt daily budget.
//
// ── Warning about an expiring consent ────────────────────────────────────────────────────────
// A PSD2 consent dies after at most 90 days and the feed then goes silent — not with an error
// the owner sees, but with nothing at all. The nudge below is the only thing standing between
// that and a quarter with a month missing, so it fires while there is still time to act.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
import { isEnableBankingConfigured } from "@/lib/enablebanking-client";
import { listBankConnections } from "@/lib/enablebanking-connection";
import { syncBankConnection } from "@/lib/enablebanking-sync";
import { createNotification } from "@/lib/notifications";
// [TZ] The owner's day, not the server's — see amsterdamToday().
import { amsterdamToday } from "@/lib/format-nl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The days before expiry on which the owner is nudged.
 *
 * A SET, not a threshold. This cron runs daily, so "warn when ten days or fewer remain" would
 * send eleven identical notifications — and a notification that arrives every day is one the
 * owner stops reading, which is the same as not sending it. Four, spaced out, each still land.
 *
 * Missing one is survivable by design: a truncated run would have to skip the same owner on all
 * four days for the warning to be lost entirely, and the fairness rotation below makes that
 * progressively unlikely.
 */
const EXPIRY_WARNING_DAYS = [10, 3, 1, 0];

/** Stop cleanly between connections rather than being killed mid-write. */
const DEADLINE_MS = 250_000;

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  let cronRunId: string | null = null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-BANK-SYNC] CRON_SECRET is not configured — the automatic bank feed is DISABLED for all users.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  // [SECURITY] Constant-time compare — a plain !== leaks, through response timing, how many
  // leading bytes a guessed token matched.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Only after the gate: an unauthorised probe must not write a heartbeat row. But BEFORE the
  // configuration check below, and that order is the whole fix.
  //
  // [HARTSLAG-NIETS-TE-DOEN] Die check zat hiervóór en gaf een vroege 200 terug. De bedoeling stond
  // er ook bij: "a server without bank credentials simply has no feed to run. Saying so plainly
  // beats a heartbeat that reads as a failure every single day." Het effect was precies andersom.
  // Zonder hartslagregel kan het beheerscherm niet zien dát hij draaide, dus stond er "heeft NOOIT
  // gedraaid" — in het rood, elke dag, over een taak die iedere ochtend om 05:00 keurig langskomt
  // en niets te doen heeft. Dat is dezelfde fout die dit project overal bestrijdt: een afwezig
  // spoor gelezen als een mislukking.
  //
  // Nu schrijft hij zijn regel wél, en sluit hem af met wat er is gebeurd: niets, omdat er niets
  // te doen was. Dat is een antwoord; "nooit gedraaid" was er geen.
  cronRunId = await beginCronRun(createPipelineClient(), "bank-sync", cronStartedAt);

  if (!isEnableBankingConfigured()) {
    const niets = { ok: true, configured: false, connections: 0 };
    await finishCronRun(createPipelineClient(), cronRunId, { ok: true, result: niets });
    return NextResponse.json(niets);
  }

  const pipeline = createPipelineClient();

  // Every user who holds a live connection. Ordered by user so the run is deterministic.
  const { data: rows, error } = await pipeline
    .from("bank_connections")
    .select("user_id")
    .in("status", ["linked", "error"])
    .order("user_id", { ascending: true });

  if (error) {
    console.error("[CRON-BANK-SYNC] could not load the connections", { error });
    await finishCronRun(createPipelineClient(), cronRunId, { ok: false, result: { error: error.message } });
    return NextResponse.json({ error: "kon koppelingen niet laden" }, { status: 500 });
  }

  const userIds = [...new Set((rows ?? []).map((r) => r.user_id).filter((x): x is string => !!x))];

  let synced = 0, failed = 0, inserted = 0, autoBooked = 0, expiring = 0, truncated = 0;
  // [EB-TELLING] The same numbers the manual door returns as JSON. They ride in the heartbeat
  // result, because this run answers a scheduler and nobody reads its response body: without them
  // the only daily evidence that the feed works is "inserted", which reads the same whether the
  // bank sent nothing or we dropped everything it sent.
  let pages = 0, fetched = 0, booked = 0, pending = 0, skipped = 0, unreadable = 0, busy = 0, claimUnavailable = 0;

  // [CRON-FAIRNESS] Rotate the start each run so a fixed tail never permanently starves when the
  // list cannot finish within maxDuration. Keyed off the epoch DAY, which advances once per
  // daily run, so every owner reaches the head within N days.
  const offset = userIds.length > 0 ? Math.floor(Date.now() / 86_400_000) % userIds.length : 0;
  const ordered = [...userIds.slice(offset), ...userIds.slice(0, offset)];
  const startedAt = Date.now();

  for (let i = 0; i < ordered.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ordered.length - i;
      console.warn("[CRON-BANK-SYNC] soft deadline hit — deferring the rest to the next run", { remaining: truncated });
      break;
    }
    const userId = ordered[i];
    try {
      for (const connection of await listBankConnections(userId)) {
        if (connection.status === "revoked") continue;

        // ── the expiry nudge ──
        // Sent BEFORE syncing, because an already-expired consent makes the sync fail and the
        // owner would then get an error instead of the one message that tells him what to do.
        const days = daysUntil(connection.accessValidUntil);
        if (days !== null && EXPIRY_WARNING_DAYS.includes(days)) {
          expiring++;
          try {
            await createNotification({
              userId,
              type: "status",
              title: "Je bankkoppeling verloopt binnenkort",
              body:
                days === 0
                  ? `De toestemming voor ${connection.institutionName ?? "je bank"} verloopt vandaag. Koppel opnieuw, anders komen er geen banktransacties meer binnen.`
                  : `De toestemming voor ${connection.institutionName ?? "je bank"} verloopt over ${days} ${days === 1 ? "dag" : "dagen"}. Banken mogen die maximaal 90 dagen laten staan — koppel opnieuw zodat je transacties blijven binnenkomen.`,
              link: "/dashboard/bank",
            });
          } catch (e) {
            console.warn("[CRON-BANK-SYNC] expiry notification failed (non-fatal)", { userId, error: String(e) });
          }
        }

        if (connection.status === "expired") continue;

        const result = await syncBankConnection({ connection, pipeline });
        inserted += result.inserted;
        autoBooked += result.autoBooked;
        for (const a of result.accounts) {
          pages += a.pages;
          fetched += a.fetched;
          booked += a.booked;
          pending += a.pending;
          skipped += a.skipped;
          unreadable += a.fetched - a.booked - a.pending;
          if (a.skippedBusy) busy += 1;
          if (a.skippedClaimUnavailable) claimUnavailable += 1;
        }
        if (result.error) failed++;
        else synced++;
      }
    } catch (e) {
      failed += 1;
      // A per-user failure is non-fatal to the batch, but it must not vanish into a log line the
      // cron returns 200 over — a feed that stops importing has to be visible to us, not only to
      // the owner who eventually notices a month is missing.
      console.error("[CRON-BANK-SYNC] user sync failed (non-fatal)", {
        userId,
        error: e instanceof Error ? e.message : String(e),
      });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
        tags: { cron: "bank-sync" },
        extra: { userId },
      });
    }
  }

  const result = {
    ok: failed === 0, users: userIds.length, synced, failed, inserted, autoBooked, expiring, truncated,
    pages, fetched, booked, pending, skipped, unreadable, busy, claimUnavailable,
  };
  await finishCronRun(createPipelineClient(), cronRunId, { ok: failed === 0, result });

  return NextResponse.json(result);
}

/** Whole days from today until `date` (YYYY-MM-DD); null when unreadable. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  // [TZ] Counted from the owner's day. The crons already work in Amsterdam time for this reason;
  // this one line still asked the server's.
  const today = Date.parse(`${amsterdamToday()}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}
