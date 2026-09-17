// src/app/api/health/route.ts
// [DEPLOY-HEALTH] Eén URL die na een deploy zegt of de bedrading klopt.
//
// GET /api/health   met   Authorization: Bearer $CRON_SECRET
//
// WAT DIT WEL IS
// Een rookproef voor de BEHEERDER. Na een deploy weet je dat de code er staat; je weet niet of de
// omgeving compleet is, of de database bereikbaar is, of de crons daadwerkelijk draaien. De
// duurste variabelen zijn juist die waarvan het ontbreken NIETS zichtbaars doet — zonder
// CRON_SECRET antwoorden alle crons 401 en doet de app verder alsof er niets aan de hand is.
//
// WAT DIT NADRUKKELIJK NIET IS
// Geen beheerdersdashboard. Er is geen admin-rol in dit product en er komt er geen: het hele
// vertrouwensverhaal is dat alleen de eigenaar en zijn gekozen boekhouder bij de gegevens kunnen.
// Dit eindpunt raakt daarom GEEN klantgegevens, telt niets per gebruiker, en geeft NOOIT een
// waarde van een omgevingsvariabele terug — alleen aanwezig of niet. Een gezondheidsrapport dat
// sleutels lekt is zelf het lek.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { checkEnv, envVerdict, missingEnv } from "@/lib/deploy-health";
import { CRON_JOBS, judgeCron, cronHealthNote, type CronJob, type CronRunRow, type CronHealth } from "@/lib/cron-heartbeat";
import { SITE_URL, siteUrlIssue } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Dezelfde sleutel als de crons — dit is beheer, geen eigenaarsfunctie.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Dit is geen weigering maar HET antwoord: staat CRON_SECRET er niet, dan is dat precies wat
    // je zocht. Alle crons antwoorden dan 401 en doen niets, en niets op enig scherm verraadt
    // dat. Daarom zeggen we het hier hardop in plaats van een kale 401 terug te geven.
    return NextResponse.json(
      {
        ok: false,
        verdict: "kapot",
        diagnose:
          "CRON_SECRET staat niet in de omgeving. Dat betekent óók dat alle crons 401 antwoorden en niets doen: geen mailimport, geen herinneringen, geen kwartaalafsluiting. Zet hem, deploy opnieuw, en vraag deze pagina daarna nog eens op.",
      },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 1. De omgeving ───────────────────────────────────────────────────
  const env = checkEnv(process.env);
  const envOordeel = envVerdict(env);
  const envMist = missingEnv(env).map((m) => ({ key: m.key, ernst: m.severity, gevolg: m.gevolg }));

  // ── 1b. De canonieke host ────────────────────────────────────────────
  // [CANONIEK] NEXT_PUBLIC_BASE_URL is de duurste variabele die er is in precies de zin die
  // bovenaan dit bestand staat: staat hij verkeerd, dan gebeurt er NIETS zichtbaars. De schermen
  // kloppen, de build is groen, de rookproef slaagt — want die test paden tegen de server die
  // draait, niet de host die in de bestanden wordt gezet. Wat er stukgaat staat buiten de app:
  // sitemap.xml, robots.txt en elke canonical wijzen dan naar een host die doorstuurt, Google zet
  // alle pagina's onder "Pagina met omleiding" en indexeert er geen enkele.
  //
  // Daarom staat de opgeloste host hier LETTERLIJK in het antwoord. Dit is de enige plek waar dit
  // eindpunt een waarde van een omgevingsvariabele teruggeeft, en dat mag: deze staat al in de
  // HTML van elke publieke pagina. Wie zojuist heeft gedeployed leest hier in één verzoek welke
  // host hij aan zoekmachines belooft, in plaats van het weken later uit een console te moeten
  // afleiden.
  const canoniek = siteUrlIssue();

  // ── 2. Is de database bereikbaar, en staan de bestanden dicht? ───────
  const pipeline = createPipelineClient();

  let dbBereikbaar = false;
  let dbFout: string | null = null;
  try {
    // De goedkoopst mogelijke echte query: telt niets, leest niets van een gebruiker.
    const { error } = await pipeline.from("profiles").select("id", { count: "exact", head: true }).limit(1);
    dbBereikbaar = !error;
    dbFout = error ? error.message : null;
  } catch (e) {
    dbFout = e instanceof Error ? e.message : String(e);
  }

  // De bucket hoort privé te zijn. Staat hij open, dan zijn alle bonnen van alle klanten met een
  // geraden URL te lezen — dat is het ergste wat deze installatie kan overkomen.
  let bucketPrive: boolean | null = null;
  // [STORAGE-VERSIONED] Ook de bovengrens per bestand, want die komt gratis mee uit dezelfde
  // aanroep en storage_bucket_hardening.sql pint hem op 25 MiB. Stond hij op NULL, dan is de
  // opslag onbegrensd: één upload kan dan willekeurig groot zijn. Dat is geen lek, maar het is
  // wél een van de drie dingen die die migratie vastlegt — en zonder deze regel las 'gezond'
  // alsof ze alle drie gecontroleerd waren, terwijl alleen `public` werd gekeken.
  let bucketLimiet: number | null = null;
  try {
    const { data } = await pipeline.storage.getBucket("documents");
    bucketPrive = data ? data.public === false : null;
    bucketLimiet = data ? (data.file_size_limit ?? null) : null;
  } catch {
    bucketPrive = null;
  }

  // ── 3. Leeft de machine? ─────────────────────────────────────────────
  // Hier valt het meeste te zien: een cron die nooit heeft gedraaid verraadt een bedradingsfout
  // die verder nergens zichtbaar is.
  const nu = Date.now();
  // [HARTSLAG-BEWIJS] `job` en `health` als hun echte types, niet als string: de uitleg wordt na de
  // lus opgebouwd en cronHealthNote wil de union — met `string` zou dat een cast vragen, en een cast
  // hier zou precies de typefout verbergen die een verkeerde taaknaam in een diagnose zet.
  const crons: Array<{ job: CronJob; health: CronHealth; laatst: string | null; toelichting?: string }> = [];
  let cronsLeesbaar = true;

  // [MEETVENSTER] Sinds wanneer wordt er überhaupt vastgelegd? Zonder dat getal liegt het oordeel
  // hieronder: elf minuten na het toepassen van cron_runs meldde deze check dat reminders (07:00),
  // recurring (06:00), retention-purge (maandag) en quarter-close (5 oktober) "NOOIT GEDRAAID"
  // hadden — met CRON_SECRET als vermoedelijke oorzaak, terwijl email-sync en reconcile op dat
  // moment mét diezelfde sleutel netjes hadden gedraaid. Hun beurt was gewoon nog niet
  // langsgekomen. Eén extra query, en het antwoord wordt waar.
  let watchingSince: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (pipeline as any)
      .from("cron_runs")
      .select("started_at")
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const eerste = (data as { started_at?: string } | null)?.started_at;
    const ms = eerste ? Date.parse(eerste) : NaN;
    watchingSince = Number.isFinite(ms) ? ms : null;
  } catch {
    watchingSince = null;
  }
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    let run: CronRunRow | null = null;
    try {
      // [DEPLOY-SAFE] De gegenereerde types kennen cron_runs nog niet — die worden pas
      // bijgewerkt nadat de migratie is toegepast. Zelfde ontsnapping als elders in de codebase;
      // de 42P01-tak hieronder vangt het geval dat de tabel er echt nog niet is.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (pipeline as any)
        .from("cron_runs")
        .select("job, started_at, ok")
        .eq("job", job)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // 42P01 = cron_runs.sql is nog niet toegepast. Dan weten we het simpelweg niet, en dat is
      // iets anders dan "hij draait niet" — zeg dat dus ook zo.
      if (error && error.code === "42P01") { cronsLeesbaar = false; break; }
      run = (data as CronRunRow | null) ?? null;
    } catch {
      cronsLeesbaar = false;
      break;
    }
    const health = judgeCron(job, run, nu, watchingSince);
    crons.push({ job, health, laatst: run?.started_at ?? null });
  }

  // [HARTSLAG-BEWIJS] De uitleg pas NA de lus, want ze rust op een feit dat pas dan bekend is:
  // draaide er ÉÉN taak, dan zijn CRON_SECRET en vercel.json aantoonbaar in orde en mag de zin bij
  // een taak die nooit draaide de lezer niet naar de omgeving sturen. Het beheerscherm deed dat
  // wel — acht taken op "ok" met tijden van uren geleden, en ernaast de bewering dat de sleutel
  // waarmee die acht waren binnengekomen ontbrak.
  const anyCronRan = crons.some((c) => !!c.laatst);
  for (const c of crons) {
    if (c.health !== "ok") c.toelichting = cronHealthNote(c.job, c.health, anyCronRan);
  }

  // 'nog-niet-langs' is een lege waarneming, geen storing — zie judgeCron.
  const cronsMetProbleem = crons.filter((c) => c.health !== "ok" && c.health !== "nog-niet-langs");

  // ── Het eindoordeel ──────────────────────────────────────────────────
  const kapot = envOordeel === "kapot" || !dbBereikbaar || bucketPrive === false;
  const letOp =
    envOordeel === "let-op" || cronsMetProbleem.length > 0 || bucketPrive === null || canoniek !== null;
  const verdict = kapot ? "kapot" : letOp ? "let-op" : "gezond";

  return NextResponse.json(
    {
      ok: verdict === "gezond",
      verdict,
      omgeving: {
        oordeel: envOordeel,
        // Alleen wat mist. Wat er staat is niet interessant, en de waarden verlaten de server nooit.
        mist: envMist,
      },
      // [CANONIEK] De host die deze deploy aan zoekmachines belooft, plus wat er mis mee is.
      canoniek: {
        url: SITE_URL,
        ...(canoniek ? { probleem: canoniek.code, gevolg: canoniek.gevolg } : {}),
      },
      database: { bereikbaar: dbBereikbaar, ...(dbFout ? { fout: dbFout } : {}) },
      bestanden: {
        bucketPrive,
        bucketLimiet,
        ...(bucketPrive === null
          ? { let_op: "kon de bucket-instelling niet lezen — controleer met de hand dat 'documents' op privé staat" }
          : {}),
        ...(bucketPrive === true && bucketLimiet === null
          ? { let_op: "de bucket is privé, maar er staat geen maximale bestandsgrootte — draai storage_bucket_hardening.sql" }
          : {}),
        // [STORAGE-VERSIONED] Wat hier NIET uit af te lezen is, en dat expliciet, omdat een
        // groen vinkje anders meer lijkt te bewijzen dan het doet:
        //
        //   1. Of storage_bucket_hardening.sql ooit is toegepast. Die migratie CORRIGEERT alleen
        //      (public → false, en een grens die te ruim staat); op een database die al klopt
        //      verandert ze nul rijen en laat ze dus geen spoor achter. `bucketPrive: true`
        //      bewijst de TOESTAND, niet de HERKOMST — en die herkomst was het hele punt: een
        //      vinkje in een dashboard overleeft geen nieuwe omgeving.
        //   2. Of RLS aanstaat op storage.objects. Dat is de gevaarlijkste van de drie — zonder
        //      RLS betekenen de drie policies niets — maar het staat in pg_class, en daar komt
        //      PostgREST niet bij. Het CONTROLE-blok onderaan die migratie leest het wel.
        //
        // Dus: dit veld zegt "de deur staat dicht", niet "de deur is in code vastgelegd".
        herkomstNietMeetbaar: "of storage_bucket_hardening.sql is toegepast (en of RLS op storage.objects aanstaat) is hiervandaan niet te zien — draai het CONTROLE-blok onderaan dat bestand",
      },
      crons: cronsLeesbaar
        ? {
            leesbaar: true,
            aandacht: cronsMetProbleem.length,
            // Hoe lang er al wordt gemeten. Kort venster = een 'nog-niet-langs' zegt niets, en
            // het is eerlijker dat op te schrijven dan de lezer het te laten raden.
            metenSinds: watchingSince ? new Date(watchingSince).toISOString() : null,
            alle: crons,
          }
        : {
            leesbaar: false,
            reden:
              "cron_runs bestaat nog niet — pas supabase/migrations/cron_runs.sql toe. Tot die tijd is niet te zien óf de crons draaien; dat is iets anders dan dat ze stilliggen.",
          },
    },
    { status: verdict === "kapot" ? 503 : 200 },
  );
}
