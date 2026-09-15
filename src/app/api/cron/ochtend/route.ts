// src/app/api/cron/ochtend/route.ts
// [OCHTEND] The owner's morning mail — the ONE daily e-mail, and only on days it has something
// to say. The decision to speak (usually: not to) lives in ochtend-digest.ts; this route only
// fetches yesterday's facts and delivers.
//
// ── WHAT COUNTS AS "YESTERDAY" ──
// The owner's yesterday: the Amsterdam calendar day, bounded by amsterdamMidnightUtc ([TZ]). A
// payment booked at 23:30 Amsterdam belongs to that evening's mail, even though in UTC it already
// sits in tomorrow — and those around-midnight rows are exactly the ones a morning summary is for.
//
// ── WHAT COUNTS AS AN EVENT ──
//   · a payment RECORDED against an OUTGOING invoice (bank_tx_invoices is where every booking
//     lands, whatever the entry point: auto-confirm, manual, Mollie — one evidence table, so this
//     cron re-derives nothing and can never disagree with the money screens);
//   · an INCOMING invoice that arrived (e-mail sync, upload, intake).
// Standing state — open work, totals, streaks — is deliberately NOT an event. Nagging belongs
// nowhere, and standing state belongs on the dashboard.
//
// SECURITY: iterates every owner, so it must never be publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed — the identical guard the other crons use.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { DEMO_TENANT_ID } from "@/lib/demo-tenant";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { beginCronRun, finishCronRun, alreadyRanToday } from "@/lib/cron-heartbeat";
import { amsterdamToday, amsterdamMidnightUtc } from "@/lib/format-nl";
import { effectiveDirection } from "@/lib/closing-package";
import { planOchtendMail, type OchtendIncoming, type OchtendPayment, type OchtendTaak } from "@/lib/ochtend-digest";
import { sendOchtendMail, sendBeheerAlarm } from "@/lib/email";
// [BEHEER-GEZOND] Het oordeel over de andere crons bestond al en had geen enkele lezer.
import { readSystemHealth, healthAlarm } from "@/lib/beheer-health";
import { beheerEmails } from "@/lib/beheer";
import { isMissingColumn } from "@/lib/pg-missing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  let cronRunId: string | null = null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[OCHTEND] CRON_SECRET is not configured — the morning mail is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();

  // Yesterday as the owner's calendar day, and its exact UTC bounds.
  const vandaag = amsterdamToday();

  // [OCHTEND-EENMAAL] At most one delivered morning per day. A second firing — a manual curl
  // with the secret, a platform double-fire, a retry after a timeout that already sent hundreds
  // of mails — would re-mail every owner. The heartbeat table already records each successful
  // run; a green 'ochtend' row started on TODAY's Amsterdam day means the morning happened.
  // Best-effort: an unreadable/absent table never blocks the mail (the guard is a courtesy on a
  // courtesy), it only fails toward one extra send.
  if (await alreadyRanToday(pipeline, "ochtend", amsterdamMidnightUtc(vandaag))) {
    return NextResponse.json({ ok: true, alreadyRan: true, sent: 0 });
  }

  cronRunId = await beginCronRun(pipeline, "ochtend", cronStartedAt);
  const gisteren = amsterdamToday(new Date(amsterdamMidnightUtc(vandaag).getTime() - 1));
  const vanaf = amsterdamMidnightUtc(gisteren).toISOString();
  const tot = amsterdamMidnightUtc(vandaag).toISOString();

  try {
    // ── 1. Every payment recorded yesterday, app-wide, in one paginated read ──
    const linkRows = await fetchAllRows<{
      id: string; user_id: string | null; invoice_id: string | null; amount_applied: number | null;
    }>((from, to) => pipeline
      .from("bank_tx_invoices")
      .select("id, user_id, invoice_id, amount_applied")
      .gte("created_at", vanaf)
      .lt("created_at", tot)
      .order("id", { ascending: true }).range(from, to));

    // The invoices those payments settle — by id, because an invoice may be dated anywhere.
    const invIds = [...new Set(linkRows.map((r) => r.invoice_id).filter((x): x is string => !!x))];
    const invRows = await fetchAllRowsForIds<{
      id: string; invoice_number: string | null; client_name: string | null; invoice_type: string | null;
      direction: string | null; receiver_id: string | null; total_inc_btw: number | null;
    }, string>(
      invIds,
      (chunk, from, to) => pipeline
        .from("invoices")
        .select("id, invoice_number, client_name, invoice_type, direction, receiver_id, total_inc_btw")
        .in("id", chunk)
        .order("id", { ascending: true }).range(from, to),
    );
    const invById = new Map(invRows.map((r) => [r.id, r]));

    // Payments per owner — OUTGOING invoices only, through the one direction authority. A settle
    // of an incoming invoice is the owner paying a bill: real, but not this mail's news.
    const paymentsByUser = new Map<string, OchtendPayment[]>();
    for (const link of linkRows) {
      if (!link.user_id || !link.invoice_id) continue;
      const inv = invById.get(link.invoice_id);
      if (!inv) continue;
      if (effectiveDirection(inv, link.user_id) !== "outgoing") continue;
      // [OCHTEND-CREDIT] A settled creditnota is money that went OUT (the refund the owner paid),
      // and its amount_applied is stored as a magnitude — counted blind, the mail's subject
      // claimed "€ 650 binnengekomen" over a day where € 150 of that LEFT the account. The
      // day-end audit's money finding on this cron; a refund is not this mail's news.
      if (inv.invoice_type === "creditnota" || (inv.total_inc_btw ?? 0) < 0) continue;
      const amount = typeof link.amount_applied === "number" && link.amount_applied > 0
        ? link.amount_applied
        : Math.abs(inv.total_inc_btw ?? 0);
      if (!(amount > 0)) continue;
      const arr = paymentsByUser.get(link.user_id) ?? [];
      arr.push({ invoiceNumber: inv.invoice_number, clientName: inv.client_name, amount });
      paymentsByUser.set(link.user_id, arr);
    }

    // ── 2. Incoming invoices that arrived yesterday ──
    // [POST-WAARD] The FACTS of each arrival, not a count: the mail names who, how much and when
    // it is due, and its button opens that invoice. An archived row is not an arrival anyone
    // needs to hear about.
    type InkomendRij = {
      id: string; receiver_id: string | null; client_name: string | null;
      total_inc_btw: number | null; due_date: string | null; status: string | null;
    };
    const nieuweInkomend = await fetchAllRows<InkomendRij>((from, to) => pipeline
      .from("invoices")
      .select("id, receiver_id, client_name, total_inc_btw, due_date, status")
      .eq("direction", "incoming")
      .neq("status", "archived")
      .gte("created_at", vanaf)
      .lt("created_at", tot)
      .order("id", { ascending: true }).range(from, to));
    const incomingByUser = new Map<string, OchtendIncoming[]>();
    for (const r of nieuweInkomend) {
      if (!r.receiver_id) continue;
      const arr = incomingByUser.get(r.receiver_id) ?? [];
      arr.push({
        id: r.id,
        supplierName: r.client_name,
        amount: typeof r.total_inc_btw === "number" && Number.isFinite(r.total_inc_btw) ? r.total_inc_btw : null,
        dueDate: r.due_date,
      });
      incomingByUser.set(r.receiver_id, arr);
    }

    // ── 2b. [OCHTEND-TAKEN] What is waiting for each owner ──
    //
    // Counts only, and only for the owners who are already getting a mail — this read must never
    // decide WHO gets one. Tasks ride along; they never summon ([OCHTEND-TAKEN] in the digest).
    //
    // Every count here is a status this app already maintains, read once for everybody rather
    // than once per owner: the morning must not become N queries per mailbox.
    const takenByUser = new Map<string, OchtendTaak[]>();
    const ontvangers = new Set<string>([...paymentsByUser.keys(), ...incomingByUser.keys()]);
    if (ontvangers.size > 0) {
      const push = (uid: string, t: OchtendTaak) => {
        if (!ontvangers.has(uid)) return;
        const arr = takenByUser.get(uid) ?? [];
        arr.push(t);
        takenByUser.set(uid, arr);
      };

      // [NO-SILENT-EMPTY] A failed count must leave the task OUT, never show it as zero: "nothing
      // is waiting" is the one sentence this mail may not get wrong. Each read is guarded on its
      // own so one failure does not cost the others.
      type TaakRij = { receiver_id: string | null; status: string | null; ledger_account?: string | null; due_date?: string | null };
      try {
        const rijen = await fetchAllRows<TaakRij>((from, to) => pipeline
          .from("invoices")
          .select("receiver_id, status")
          .eq("direction", "incoming")
          .eq("status", "processing")
          .order("id", { ascending: true }).range(from, to));
        const per = new Map<string, number>();
        for (const r of rijen) if (r.receiver_id) per.set(r.receiver_id, (per.get(r.receiver_id) ?? 0) + 1);
        for (const [uid, n] of per) push(uid, { soort: "te_beoordelen", aantal: n, pad: "/dashboard/incoming" });
      } catch { /* the task stays out; the mail is still true without it */ }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rijen = await fetchAllRows<TaakRij>((from, to) => (pipeline as any)
          .from("invoices")
          .select("receiver_id, status, ledger_account")
          .eq("direction", "incoming")
          .in("status", ["received", "paid"])
          .is("ledger_account", null)
          .order("id", { ascending: true }).range(from, to));
        const per = new Map<string, number>();
        for (const r of rijen) if (r.receiver_id) per.set(r.receiver_id, (per.get(r.receiver_id) ?? 0) + 1);
        for (const [uid, n] of per) push(uid, { soort: "grootboek", aantal: n, pad: "/dashboard/grootboek" });
      } catch { /* [DEPLOY-SAFE] ledger_account arrives by a hand-applied migration */ }

      try {
        const rijen = await fetchAllRows<{ user_id: string | null }>((from, to) => pipeline
          .from("bank_transactions")
          .select("user_id")
          .eq("status", "pending")
          .is("invoice_id", null)
          .order("id", { ascending: true }).range(from, to));
        const per = new Map<string, number>();
        for (const r of rijen) if (r.user_id) per.set(r.user_id, (per.get(r.user_id) ?? 0) + 1);
        for (const [uid, n] of per) push(uid, { soort: "bank_te_beslissen", aantal: n, pad: "/dashboard/bank" });
      } catch { /* the task stays out */ }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rijen = await fetchAllRows<{ user_id: string | null }>((from, to) => (pipeline as any)
          .from("wachtkoppelingen")
          .select("user_id")
          .in("status", ["wachtend", "voorgesteld"])
          .order("id", { ascending: true }).range(from, to));
        const per = new Map<string, number>();
        for (const r of rijen) if (r.user_id) per.set(r.user_id, (per.get(r.user_id) ?? 0) + 1);
        for (const [uid, n] of per) push(uid, { soort: "wacht_op_bankregel", aantal: n, pad: "/dashboard/bank" });
      } catch { /* [DEPLOY-SAFE] wachtkoppelingen arrives by a hand-applied migration */ }
    }

    // ── 3. The owners this concerns, with their address and their choice ──
    const userIds = [...new Set([...paymentsByUser.keys(), ...incomingByUser.keys()])];
    type ProfielRij = { id: string; email: string | null; role: string | null; ochtend_mail?: boolean | null };
    let profielen: ProfielRij[] = [];
    if (userIds.length > 0) {
      // [DEPLOY-SAFE] ochtend_mail arrives by a hand-applied migration. Until it exists the
      // whole select would 42703 — so the read retries without the column, and everyone is
      // treated as opted IN (the migration's own default).
      //
      // Chunked + paginated like EVERY read in this route: a bare .in() with the app-wide id
      // list 414s past a few hundred uuids (killing the whole morning for everyone) and
      // silently truncates past ~1000 rows (dropping owners from neither sent nor failed).
      try {
        profielen = await fetchAllRowsForIds<ProfielRij, string>(
          userIds,
          // The generated types predate ochtend_mail — same relaxed cast every open-migration
          // column in this repo uses.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chunk, from, to) => (pipeline as any)
            .from("profiles")
            .select("id, email, role, ochtend_mail")
            // [DEMO-DICHT] Het demoaccount overslaan: openbaar wachtwoord, en een cron draagt geen
            // sessie zodat de middleware-fence deze route niet ziet.
            .neq("id", DEMO_TENANT_ID)
            .in("id", chunk)
            .order("id", { ascending: true }).range(from, to) as PromiseLike<{ data: ProfielRij[] | null; error: { message: string } | null }>,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isMissingColumn(msg)) throw e;
        profielen = await fetchAllRowsForIds<ProfielRij, string>(
          userIds,
          (chunk, from, to) => pipeline
            .from("profiles")
            .select("id, email, role")
            .in("id", chunk)
            .order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: ProfielRij[] | null; error: { message: string } | null }>,
        );
      }
    }

    // ── [BEHEER-GEZOND] Draaien de ándere taken nog? ────────────────────────
    //
    // cron-heartbeat legt elke run vast en judgeCron velt er een oordeel over. Dat oordeel had één
    // lezer — /api/health, dat je moet CURLEN — en cronsNeedingAttention had in de hele
    // productiecode geen enkele aanroeper. Het systeem meet dus dat een taak is gestopt, oordeelt
    // erover, en vertelt het aan niemand. Valt reminders om, dan worden er geen herinneringen meer
    // verstuurd; valt payment-due om, dan mist een ondernemer zijn betaaltermijnen — en het scherm
    // ziet er in beide gevallen normaal uit.
    //
    // Hier meeliftend en niet als twaalfde cron: deze draait al dagelijks, en een wachter die zelf
    // een aparte wachter nodig heeft is er een te veel. Best-effort in alles — het alarm mag de
    // ochtendmail nooit laten falen, en de beheerpagina toont dezelfde stand als tweede weg.
    //
    // [WACHTER-EERST] En hij staat VÓÓR de mailronde, niet erachter. Dat is geen ordening maar de
    // hele werking: de mailronde is het langste stuk van deze functie — één mail per eigenaar met
    // 300 ms ertussen — en dus verreweg het meest waarschijnlijke stuk om op maxDuration te
    // sneuvelen. Stond de wachter daarachter, dan zweeg hij precies op de ochtend dat er iets mis
    // wás. Dat is 12 september 2026 ook gebeurd: deze run stopte halverwege, en het alarm dat
    // gestopte taken meldt was het deel dat niet meer aan de beurt kwam. Een wachter die uitvalt
    // met datgene waarover hij moet waken, bewaakt niets.
    let alarmVerstuurd = false;
    try {
      alarmVerstuurd = await meldGestopteCrons(pipeline);
    } catch (e) {
      console.error("[BEHEER-GEZOND] cron-alarm mislukt", { error: e instanceof Error ? e.message : String(e) });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://boekbrug.nl";
    let sent = 0;
    let quiet = 0;
    let optedOut = 0;
    let failed = 0;

    for (const p of profielen) {
      try {
        // The accountant's morning is [DAGSTART] — two morning messages about one desk is noise.
        if (p.role === "accountant") { quiet++; continue; }
        if (p.ochtend_mail === false) { optedOut++; continue; }
        if (!p.email?.trim()) { quiet++; continue; }
        const mail = planOchtendMail({
          gisteren,
          payments: paymentsByUser.get(p.id) ?? [],
          newIncoming: incomingByUser.get(p.id) ?? [],
          taken: takenByUser.get(p.id) ?? [],
          baseUrl,
        });
        if (!mail) { quiet++; continue; }
        const ok = await sendOchtendMail({ toEmail: p.email.trim(), subject: mail.subject, html: mail.html });
        if (ok) sent++; else failed++;
        // [BULK-TEMPO] Adem tussen twee mails — dezelfde reden als de bulklus op KlantenBeheer:
        // een strakke lus loopt tegen Resend's limiet en dan faalt de STAART, en een gemiste
        // ochtend wordt nooit ingehaald (morgen gaat over morgen).
        if (sent + failed < profielen.length) await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        // [CRON-HONEST] One owner's failure is counted, never spread to the rest of the morning.
        failed++;
        console.error("[OCHTEND] one owner's mail failed", {
          userId: p.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await finishCronRun(pipeline, cronRunId, {
      ok: failed === 0,
      ...(failed > 0 ? { error: `${failed} owners failed` } : {}),
      result: { gisteren, sent, quiet, optedOut, failed, alarmVerstuurd },
    });
    return NextResponse.json({ ok: failed === 0, gisteren, sent, quiet, optedOut, failed, alarmVerstuurd });
  } catch (e) {
    // [CRON-HONEST] A total discovery failure must not read as a quiet green morning.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[OCHTEND] run failed", { message });
    await finishCronRun(pipeline, cronRunId, { ok: false, error: message });
    return NextResponse.json({ error: "ochtend_failed" }, { status: 500 });
  }
}

/**
 * [BEHEER-GEZOND] Read the heartbeat, judge it, and mail the operator when something stopped.
 *
 * Returns whether an alarm went out. Silent on a healthy machine — a daily "everything is fine" is
 * a mail people filter, and then the one that mattered is filtered with it. NOT silent when the
 * table could not be read: "we could not check" is not "nothing is wrong", and on the one signal
 * that says whether the machine runs, that difference is the whole point.
 */
async function meldGestopteCrons(pipeline: ReturnType<typeof createPipelineClient>): Promise<boolean> {
  const ontvangers = beheerEmails();
  // Geen beheerder ingesteld = de functie staat uit, net als de beheerpagina zelf. Dan is er geen
  // stille storing: er is niemand die hem zou lezen.
  if (ontvangers.length === 0) return false;

  // Dezelfde lezer als de beheerpagina — zie readSystemHealth.
  const alarm = healthAlarm(await readSystemHealth(pipeline));
  if (!alarm) return false;

  await sendBeheerAlarm({ toEmails: ontvangers, subject: alarm.subject, body: alarm.body });
  return true;
}
