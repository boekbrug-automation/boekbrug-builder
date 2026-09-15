// src/app/api/cron/email-sync/route.ts
// [CRON] Scheduled background email import — makes the onboarding promise ("we import your
// invoices automatically in the background") TRUE. Vercel Cron calls this on a schedule
// (see vercel.json); it iterates every connected mailbox and runs the same per-user sync
// the manual /api/email/sync uses.
//
// SECURITY: this triggers AI-costing syncs for EVERY connected user, so it must NEVER be
// publicly callable. It requires `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sends
// this automatically when CRON_SECRET is set in the project env. Without the secret set, the
// route refuses to run (fail-closed) rather than exposing an open all-user trigger.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { syncUserEmails } from "@/lib/email-integration";
import { timingSafeEqualStr } from "@/lib/timing-safe";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
// [PAGINATE] The mailbox list is the WORK, not a report — see the read below.
import { fetchAllRows } from "@/lib/supabase-paginate";
// [GRENS-ZICHTBAAR] De reden waarom de drain stopt, in de woorden die bij de echte oorzaak horen.
import { drainStopReason } from '@/lib/fair-use-hold';

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the batch time (actual ceiling depends on the plan)

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // [CRON-OBSERVABILITY] Distinguish a MISCONFIG (secret not set → the whole circle silently
  // stops for everyone) from a bad caller token. A missing secret must SCREAM, not look like a
  // quiet week — it's the single env var the "we import automatically" promise hinges on.
  if (!secret) {
    console.error("[CRON-EMAIL-SYNC] CRON_SECRET is not configured — automatic email import is DISABLED for all users.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  // [SECURITY] Constant-time compare — a plain !== leaks, via response timing, how many leading
  // bytes a guessed token matched, which can recover the secret over many attempts.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "email-sync", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Zie de uitleg in api/cron/reminders. Deze route heeft één vroege uitgang,
  // en die is nooit opgevallen omdat hij zelden wordt gehaald — precies waarom een poort hem vond
  // en een mens niet. Kan de verbindingenlijst niet worden geladen, dan vertrok de route met een
  // 500 en bleef de hartslagregel voor eeuwig op ok = NULL staan: een echte storing die zich
  // vermomt als een afgebroken run, in plaats van als een mislukte.
  const klaar = async (body: Record<string, unknown>, ok: boolean, status?: number) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body, status ? { status } : undefined);
  };

  const pipeline = createPipelineClient();
  // Ordered by connected_at so the iteration order is deterministic across runs.
  //
  // [PAGINATE] Paged past the silent ~1000-row cap. PostgREST truncates a response at that size
  // and says nothing about it, and this list is not a report — it IS the work. Beyond a thousand
  // connected mailboxes the tail simply never syncs, and because the order is connected_at
  // ASCENDING the tail is the NEWEST connections: a customer who links their mailbox today would
  // watch nothing arrive, forever, with no error anywhere and a cron run reporting success.
  //
  // fetchAllRows throws on a failed page rather than returning a short one, which is the right
  // shape here for the same reason: a partial list is indistinguishable from "these are all the
  // mailboxes", and acting on it silently skips real owners.
  let conns: { user_id: string | null; connected_at: string | null }[];
  try {
    conns = await fetchAllRows<{ user_id: string | null; connected_at: string | null }>(
      (from, to) => pipeline
        .from("email_connections")
        .select("user_id, connected_at")
        .order("connected_at", { ascending: true })
        .range(from, to),
    );
  } catch {
    return klaar({ ok: false, error: "kon verbindingen niet laden" }, false, 500);
  }

  // [PORT-RESIDU] `const`, niet `let`. Dit stond hier als const (34fcd15) en werd bij het overnemen
  // uit de billing-tak (8a7483d) naar let gezet omdat DAAR een regel volgde die opnieuw toekende: het
  // rechtenfilter uit de toelichting hieronder. Dat filter is bewust niet meegekomen, de `let` wel —
  // een leesbaar restant van een tak die we niet volgen.
  //
  // En const is hier het veiligere antwoord, niet alleen het nettere. userIds voedt verderop
  // `connections: userIds.length` in zowel de cron-hartslag als het JSON-antwoord, en `connections`
  // betekent "aantal gekoppelde mailboxen". Wie ooit alsnog een filter toevoegt (de maandteller uit
  // het open punt hieronder) en dat doet door userIds opnieuw toe te kennen, laat dat getal stilletjes
  // "aantal dat door het filter kwam" betekenen — zelfde naam, andere waarheid, en een hartslag die
  // iets anders rapporteert dan hij zegt. Met const kan dat niet per ongeluk: filteren dwingt dan een
  // nieuwe naam af (`const eligible = userIds.filter(...)`) en de lus draait daarop.
  const userIds = [...new Set((conns ?? []).map((c) => c.user_id).filter((x): x is string => !!x))];

  // ── [COST-GUARD] Wat de kosten van dit script begrenst ─────────────────
  //
  // Dit is verreweg het duurste dat de app doet: syncUserEmails() classificeert
  // per ronde tot SYNC_BATCH_MAX (40) documenten met maximaal 5 drain-rondes —
  // ~240 betaalde Claude-calls per gebruiker per run, twaalf runs per dag.
  //
  // Op het billing-experiment werd hier een RECHTENFILTER gezet: alleen mailboxen
  // van accounts binnen hun proefperiode of abonnement werden nog gesynct. Dat
  // filter is hier bewust NIET overgenomen, want het hoort bij een model dat wij
  // niet voeren. Bij ons is de app gratis en is er niets om "geen toegang" van te
  // maken; wie te veel leest loopt tegen het eerlijk gebruik aan
  // (aiDocuments in src/lib/fair-use.ts), niet tegen een betaalmuur.
  //
  // ✅ DAT OPEN PUNT IS DICHT (augustus 2026). Hier stond: "een verlaten mailbox
  // van een gratis account blijft tot die maandteller er is meelopen in deze run.
  // De dagzekering maakt dat betaalbaar, maar niet gratis."
  //
  // De maandteller telt nu ook op dit pad mee. syncUserEmails() reserveert vóór
  // PHASE 1 zoveel classificaties als er nog binnen aiDocuments passen en laat de
  // rest staan — bewaard, niet gelezen, precies zoals onExceed het belooft. Wat
  // strandde op een storing wordt teruggegeven. Zie de poort daar; de uitleg
  // staat op de plek waar de beslissing valt, niet hier.
  //
  // Wat dat verandert voor deze lus: een gratis mailbox die niemand meer leest
  // kost hooguit zijn 50 documenten van die maand, en daarna alleen nog het
  // ophalen. De begrenzing rust dus nu op drie dingen in plaats van twee:
  //   1. de globale dagzekering in src/lib/ai-budget.ts, die ELKE weg naar
  //      Anthropic afdekt en dus ook deze — en die sinds ai_budget_settle.sql
  //      afrekent op het werkelijke verbruik in plaats van op max_tokens;
  //   2. de maandgrens per gebruiker, hierboven beschreven;
  //   3. de rondelimiet hierboven plus de zachte deadline hieronder.
  //
  // Eén gevolg om te kennen: een gebruiker die aan zijn maandgrens zit levert een
  // ronde op die niets classificeert. De drain-lus hieronder ziet dan geen
  // voortgang en stopt na één extra aanroep — dezelfde bescherming die daar voor
  // een vastzittende bijlage staat, en om dezelfde reden juist.

  let synced = 0, failed = 0, saved = 0, truncated = 0;
  // [LEZER-STIL] Mailboxes whose documents were HELD because the reader itself was unavailable.
  // Deliberately not folded into `failed`: those are per-mailbox errors that throw, and a held run
  // throws nothing at all — which is exactly why it needs a counter of its own.
  let readerOutages = 0;
  // [CRON-FAIRNESS] Rotate the start each run so a fixed tail of mailboxes never permanently starves
  // when the list can't finish within maxDuration. The cron fires once a day at a FIXED hour, so
  // getUTCHours() was constant → the same tail starved forever. Key the offset off the EPOCH DAY: it
  // advances one each daily run, so the start walks the whole list and every mailbox reaches the head
  // within N days. A soft deadline stops cleanly between users; one user's failure never stops the rest.
  const offset = userIds.length > 0 ? Math.floor(Date.now() / 86_400_000) % userIds.length : 0;
  const ordered = [...userIds.slice(offset), ...userIds.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;

  for (let i = 0; i < ordered.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ordered.length - i;
      console.warn("[CRON-EMAIL-SYNC] soft deadline hit — deferring remaining mailboxes to next run", { remaining: truncated });
      break;
    }
    const uid = ordered[i];
    try {
      let r = await syncUserEmails(uid);
      if (r) { synced += 1; saved += r.saved; }
      // [LEZER-STIL] A reader that refuses app-wide holds every attachment and throws nothing, so
      // without this the run is written ok:true and the heartbeat watchman reports a healthy
      // machine while not one document is being read.
      if (r?.readerOutage) readerOutages += 1;
      // [CRON-DRAIN] syncUserEmails caps NEW classifications per call (SYNC_BATCH_MAX). Keep
      // syncing while items remain, bounded by a round cap — BUT stop the moment a round makes NO
      // progress, so a poison-pill attachment (one that fails to import every round and keeps the
      // batch head) can't burn all 5 rounds re-processing the same failing slice every hour.
      // [GRENS-ZICHTBAAR] …en niet dóórdraaien op een MAANDgrens. `remaining > 0` alleen kon dat
      // niet zien: de bijlagen liggen er nog, dus het ziet eruit als werk dat wacht. Maar wat het
      // tegenhoudt is een maandteller, en die vult zich niet bij tussen twee aanroepen — elke
      // ronde haalt dan de hele mailbox opnieuw op om exact hetzelfde antwoord te krijgen. In de
      // gemeten log stonden de twee aanroepen zes seconden uit elkaar.
      if (r && r.heldByFairUse > 0) {
        console.warn(drainStopReason(r.heldByFairUse), {
          uid, remaining: r.remaining, heldByFairUse: r.heldByFairUse,
        });
      }
      let rounds = 0;
      while (r && r.remaining > 0 && r.heldByFairUse === 0 && rounds < 5) {
        rounds++;
        const prevSaved = r.saved;
        const next = await syncUserEmails(uid);
        if (next) saved += next.saved;
        const progressed = !!next && (next.saved > 0 || next.remaining < r.remaining);
        r = next;
        if (!progressed) {
          // [GRENS-ZICHTBAAR] Twee oorzaken zien er hier identiek uit, en er is er maar één waar
          // opnieuw proberen iets aan verandert.
          //
          // Gemeten in de log: wanted 10, granted 0, plan 'free' — de MAANDgrens was op. De drain
          // riep syncUserEmails zes seconden later nog eens, kreeg vanzelfsprekend hetzelfde
          // antwoord, en meldde toen "likely a stuck attachment". Er was geen bijlage die hing;
          // er was geen bijlage die überhaupt geprobeerd is. Wie die regel leest gaat een kapotte
          // PDF zoeken die niet bestaat, terwijl de echte oorzaak één regel hoger staat.
          //
          // Een maandgrens vult zich niet bij tussen twee aanroepen. Dus: eigen woorden, en
          // stoppen zonder de mailbox nog een keer op te halen.
          console.warn(drainStopReason(r?.heldByFairUse ?? 0), {
            uid,
            remaining: r?.remaining ?? null,
            prevSaved,
            heldByFairUse: r?.heldByFairUse ?? 0,
          });
          break;
        }
      }
    } catch (e) {
      failed += 1;
      // [OBSERVABILITY] A per-user sync failure is non-fatal to the batch, but it must not vanish
      // into a log line the cron returns 200 over — capture it so a mailbox that stops importing
      // is visible to us, not only to the (now-notified) owner.
      console.error("[CRON-EMAIL-SYNC] user sync failed (non-fatal)", { uid, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "email-sync" }, extra: { uid } });
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  // [LEZER-STIL] A held run is not a successful run. Marking it ok:false is what makes the EXISTING
  // watchman speak ([BEHEER-GEZOND] in the morning cron, and /dashboard/beheer) — no new alarm, no
  // new table, no second thing to keep alive. The reason travels with it, so the mail says WHICH
  // silence this is: nothing was READ, rather than nothing arrived.
  const gezond = failed === 0 && readerOutages === 0;
  await finishCronRun(createPipelineClient(), cronRunId, {
    ok: gezond,
    ...(readerOutages > 0
      ? { error: `de lezer was niet beschikbaar voor ${readerOutages} postbus(sen) — documenten zijn vastgehouden, niet overgeslagen` }
      : {}),
    result: { ok: gezond, connections: userIds.length, synced, failed, readerOutages, saved, truncated },
  });

  return NextResponse.json({ ok: gezond, connections: userIds.length, synced, failed, readerOutages, saved, truncated });
}
