// src/app/api/cron/quarter-close/route.ts
// [QUARTER-CLOSE] End-of-quarter handoff. The system already KNOWS a quarter has ended and how
// complete its invoice evidence is — but it did nothing with that. This cron turns it into an
// action: once, early in the first month of a new quarter, it notifies every active owner (and any
// linked accountant) that the just-closed quarter is ready to review — or which gaps remain first.
//
// SCHEDULE: run on a FIXED post-quarter date (see vercel.json: 5th of Jan/Apr/Jul/Oct) so it fires
// exactly once per quarter — that alone is the idempotency (no per-run dedup state needed).
//
// HONESTY: it does NOT claim an authoritative "klaar om in te dienen" verdict — that lives on the
// readiness screen. It reports the invoice-evidence completeness (summarizeClosingPackage) and nudges
// the owner to review + file. Never a green light the figures don't support.
//
// SECURITY: fail-closed on a missing CRON_SECRET; constant-time bearer compare (mirrors email-sync).
//
// OUTCOME: a run is ok only when every owner was served — no owner failed and none was left behind
// by the soft deadline. The response body and the heartbeat carry that same `ok`; /api/health
// judges the run by the heartbeat. A partial run is still HTTP 200 (the house style of every cron
// here); `ok: false`, `failed` and `truncated` say what it could not do.
//
// RETRY: a partial run is re-run by hand — see docs/QUARTER_CLOSE_RETRY.md. The same-day guard
// ([CRON-EENMAAL]) only counts runs that were ok, so it does not block that re-run. The re-run serves
// EVERY owner again: owners and accountants the first run already notified get the notice and the
// accountant mail a second time, because nothing here dedups per owner.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { DEMO_TENANT_ID } from "@/lib/demo-tenant";
import { summarizeClosingPackage, ClosingPackageSourceUnavailableError } from "@/lib/closing-package";
import { createNotification } from "@/lib/notifications";
import { previousQuarter, buildQuarterCloseNotice } from "@/lib/quarter-close";
import { sendQuarterReadyToAccountant } from "@/lib/email";
import { appOrigin } from "@/lib/app-origin";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun, alreadyRanToday } from "@/lib/cron-heartbeat";
import { amsterdamToday, amsterdamMidnightUtc } from "@/lib/format-nl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-QUARTER-CLOSE] CRON_SECRET is not configured — the quarter-end handoff is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-EENMAAL] Ten hoogste één GESLAAGDE ronde per Amsterdamse dag. De kop van dit bestand
  // stelde dat "runs exactly once per quarter IS its idempotency — no dedup state" — en dat is een
  // eigenschap van de PLANNER, niet van deze code. Een cron-platform levert 'at least once', een
  // functie die time-out krijgt wordt opnieuw geprobeerd, en met het secret is deze route ook met
  // de hand aan te roepen. Er is geen unieke index op `notifications` (nagekeken in de database),
  // dus een tweede ronde stuurt iedere ondernemer dezelfde herinnering nog een keer.
  //
  // Best effort en fail-open: een onleesbare cron_runs houdt een aangiftedeadline nooit tegen.
  if (await alreadyRanToday(createPipelineClient(), "quarter-close", amsterdamMidnightUtc(amsterdamToday()))) {
    return NextResponse.json({ ok: true, alreadyRan: true, notifiedOwners: 0, notifiedAccountants: 0 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "quarter-close", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Zie de uitleg in api/cron/reminders. Deze route draait vier keer per jaar,
  // dus haar vroege uitgang is de minst waarschijnlijke van allemaal om ontdekt te worden door hem
  // te zien gebeuren — en de duurste om te missen: valt hij om, dan blijft de regel op ok = NULL en
  // is niet te onderscheiden of het kwartaalbericht is uitgegaan of niet, tot drie maanden later.
  const klaar = async (body: Record<string, unknown>, ok: boolean, status?: number) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body, status ? { status } : undefined);
  };

  // Allow an explicit ?year&quarter override (manual re-run); otherwise the quarter that just ended.
  const sp = req.nextUrl.searchParams;
  const yParam = Number(sp.get("year"));
  const qParam = Number(sp.get("quarter"));
  const period =
    Number.isInteger(yParam) && Number.isInteger(qParam) && qParam >= 1 && qParam <= 4
      ? { year: yParam, quarter: qParam as 1 | 2 | 3 | 4 }
      : previousQuarter(new Date());

  const pipeline = createPipelineClient();

  // Every non-accountant profile is a potential owner. Once-per-quarter, so a full scan is fine.
  // `.neq("role","accountant")` alone drops NULL-role profiles (SQL: NULL <> 'accountant' → NULL,
  // not TRUE), silently excluding legacy/edge owners from the nudge. Include them explicitly.
  // [PAGINATION] fetchAllRows — a plain .select() truncates at ~1000 rows SILENTLY, which would
  // drop every owner past #1000 from the quarter-end handoff, every quarter. (This is the exact
  // rule supabase-paginate.ts exists to enforce; the sibling reconcile cron already uses it.)
  let profiles: { id: string | null; role: string | null }[];
  try {
    profiles = await fetchAllRows<{ id: string | null; role: string | null }>((from, to) =>
      // [DEMO-DICHT] Zonder het demoaccount: openbaar wachtwoord, en een cron draagt geen sessie
      // dus de middleware-fence ziet deze route niet. Mail naar een verzonnen adres levert een
      // bounce op, en bounces zijn precies wat [BEZORGING] net heeft opgeruimd.
      pipeline.from("profiles").select("id, role").or("role.is.null,role.neq.accountant")
        .neq("id", DEMO_TENANT_ID)
        .order("id", { ascending: true }).range(from, to));
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "quarter-close", phase: "profiles" } });
    return klaar({ ok: false, error: "kon profielen niet laden" }, false, 500);
  }
  const ownerIds = [...new Set((profiles ?? []).map((p) => p.id).filter((x): x is string => !!x))];

  // [ALREADY-FILED] Skip owners who already froze this quarter's aangifte — nudging them to "review
  // and file" a quarter they've filed is wrong, and this also makes a duplicate/manual re-run a
  // near-noop for prompt filers (one btw_filings row per user/year/quarter). Best-effort: on a fetch
  // error, fall through (don't block the whole handoff — worse to skip everyone than to re-nudge a few).
  const filedOwners = new Set<string>();
  try {
    const filed = await fetchAllRows<{ user_id: string | null }>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any).from("btw_filings").select("user_id")
        .eq("year", period.year).eq("quarter", period.quarter)
        .order("user_id", { ascending: true }).range(from, to));
    for (const r of filed) if (r.user_id) filedOwners.add(r.user_id);
  } catch { /* fall through — re-nudging a filer is a lesser evil than skipping everyone */ }

  let notifiedOwners = 0, notifiedAccountants = 0, skippedEmpty = 0, failed = 0, truncated = 0;
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;

  for (let i = 0; i < ownerIds.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ownerIds.length - i;
      console.warn("[CRON-QUARTER-CLOSE] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    const ownerId = ownerIds[i];
    if (filedOwners.has(ownerId)) { skippedEmpty += 1; continue; } // already filed → no review nudge
    try {
      const summary = await summarizeClosingPackage({ ownerId, year: period.year, quarter: period.quarter, supabase: pipeline });
      // [PACKAGE-FAIL-CLOSED] A quarter this run could not read in full is not announced at all.
      // The summary leaves out every warning an unread source would have decided, so the notice
      // built from it can come out "clean" — and then the accountant is mailed "het kwartaalpakket
      // staat klaar om te downloaden" about a quarter nobody read. Thrown into the catch below: the
      // owner counts as failed, the run is not ok, and a re-run (?year&quarter) picks it up.
      if (summary.unreadSources.length > 0) {
        throw new ClosingPackageSourceUnavailableError(summary.unreadSources.join(","));
      }
      const notice = buildQuarterCloseNotice(summary.quarter, summary);
      // Don't nag a dormant quarter (no invoice activity, no warnings).
      if (notice.empty) { skippedEmpty += 1; continue; }

      await createNotification({
        userId: ownerId,
        title: notice.ownerTitle,
        body: notice.ownerBody,
        type: "status",
        link: "/dashboard/quarterly",
      });
      notifiedOwners += 1;

      // Notify any linked accountant(s) so the handoff isn't a thing the owner must remember to trigger.
      const { data: links } = await pipeline
        .from("accountant_clients")
        .select("accountant_id")
        .eq("zzper_id", ownerId);
      // De klantnaam en de basis-URL één keer, niet per boekhouder.
      const { data: ownerProfile } = await pipeline
        .from("profiles")
        .select("full_name, company_name")
        .eq("id", ownerId)
        .single();
      const clientName =
        ownerProfile?.company_name || ownerProfile?.full_name || "je klant";
      // [ORIGIN] Las NEXT_PUBLIC_SITE_URL — een tweede naam die niet in .env.example stond, met
      // een hardgecodeerd domein als vangnet. Wie volgens .env.example inrichtte zette
      // NEXT_PUBLIC_APP_URL en kreeg hier stil boekbrug.nl, ook op een ander domein: de
      // boekhouder ontving dan een pakket-link naar een andere site. Nu één keten, beide namen.
      // Een cron heeft geen verzoek-origin, dus hier is het vangnet wél nodig.
      const origin = appOrigin(process.env) ?? "https://boekbrug.nl";
      const quarterPath = `/dashboard/clients/${ownerId}/kwartaal?q=${period.quarter}&year=${period.year}`;

      for (const link of links ?? []) {
        if (!link.accountant_id) continue;
        await createNotification({
          userId: link.accountant_id,
          title: notice.accountantTitle,
          body: notice.accountantBody,
          type: "status",
          // [BRUG] Wees de link die hij nodig heeft. Dit was '/dashboard/clients/beheer' —
          // het uitnodig-/ontkoppelformulier, niet het kwartaal. De kwartaalpagina rendert
          // de pakketknop als haar tweede element.
          link: quarterPath,
        });
        notifiedAccountants += 1;

        // [BRUG] En dezelfde mededeling per E-MAIL, want dáár leeft een eenmanskantoor.
        // De belofte "aan het eind van het kwartaal staat alles klaar voor je boekhouder"
        // werd tot nu toe afgeleverd als een badge in een scherm dat hij niet opent.
        //
        // Best effort en apart ingepakt: dit is de laatste stap van de cron en een
        // mailfout mag de al verstuurde notificatie niet ongedaan maken of de lus breken.
        try {
          const { data: accProfile } = await pipeline
            .from("profiles")
            .select("email, full_name")
            .eq("id", link.accountant_id)
            .single();
          if (accProfile?.email) {
            // [TRUST-DELIVERY-RETURN] Dit is de mail die het product maakt: "het kwartaal van je
            // klant staat klaar". Resend gooit niet bij een weigering maar lost op met { error },
            // dus deze catch ving alleen echte exceptions — een geweigerde mail liep er stil
            // langs. Dan denkt de ondernemer dat zijn boekhouder bericht heeft, denkt de
            // boekhouder dat er niets klaarstaat, en wacht iedereen op de ander.
            const mailDelivered = await sendQuarterReadyToAccountant({
              toEmail: accProfile.email,
              accountantName: accProfile.full_name || "boekhouder",
              clientName,
              quarterLabel: `Q${period.quarter} ${period.year}`,
              outgoingCount: summary.outgoingCount,
              incomingCount: summary.incomingCount,
              topGaps: notice.clean ? [] : summary.warnings.map((w) => w.message).slice(0, 3),
              packageUrl: `${origin}/api/closing-package?clientId=${ownerId}&year=${period.year}&quarter=${period.quarter}`,
              quarterUrl: `${origin}${quarterPath}`,
            });
            if (!mailDelivered) {
              console.error("[CRON-QUARTER-CLOSE] kwartaalmail geweigerd door de mailprovider", {
                ownerId, accountantId: link.accountant_id, quarter: `Q${period.quarter} ${period.year}`,
              });
              // De in-app melding aan de boekhouder is hierboven al weggeschreven en blijft staan:
              // het kwartaal staat écht klaar in zijn portaal, ook als de mail niet aankwam. Dit
              // maakt alleen vindbaar dat de attendering hem niet bereikte.
            }
          }
        } catch (mailErr) {
          console.error("[CRON-QUARTER-CLOSE] kwartaalmail naar boekhouder mislukt (niet fataal)", {
            ownerId,
            accountantId: link.accountant_id,
            error: mailErr instanceof Error ? mailErr.message : String(mailErr),
          });
        }
      }
    } catch (e) {
      failed += 1;
      console.error("[CRON-QUARTER-CLOSE] owner failed (non-fatal)", { ownerId, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "quarter-close" }, extra: { ownerId } });
    }
  }

  // [CRON-HONEST] One outcome, written in both places. The response said `ok: true` whatever
  // happened, while the heartbeat said `failed === 0` — which still called a run ok when the soft
  // deadline had left owners unserved. Both now carry the same verdict: every owner was served.
  // Owners with an unreadable quarter count as failed ([PACKAGE-FAIL-CLOSED]), so a run that could
  // not read a quarter is never "ok" — and those owners got no mail, which is the point.
  const ok = failed === 0 && truncated === 0;
  const outcome = {
    ok,
    quarter: `Q${period.quarter} ${period.year}`,
    owners: ownerIds.length,
    notifiedOwners,
    notifiedAccountants,
    skippedEmpty,
    failed,
    truncated,
  };
  // The plural is spelled out: [MEERVOUD] refuses a bracketed plural placeholder in any sentence.
  const owners = (n: number) => (n === 1 ? "1 owner" : `${n} owners`);
  const why = [
    failed > 0 ? `${owners(failed)} failed — nothing was sent to them or their accountant (see [CRON-QUARTER-CLOSE] owner failed)` : null,
    truncated > 0 ? `${owners(truncated)} not reached before the soft deadline` : null,
  ].filter((x): x is string => x !== null);

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, {
    ok,
    result: outcome,
    ...(why.length > 0 ? { error: `${why.join("; ")}. Re-run: docs/QUARTER_CLOSE_RETRY.md` } : {}),
  });

  return NextResponse.json(outcome);
}
