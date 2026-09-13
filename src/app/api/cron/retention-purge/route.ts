// src/app/api/cron/retention-purge/route.ts
// [A1] The job that finally executes GDPR erasure.
//
// `api/account/delete` bans the user and stamps a 7-year timer. Nothing ever
// read that timer: `isEligibleForDeletion` had no caller and no purge job
// existed, so a deleted account's files lived in Storage forever and Article 17
// erasure was a promise the app never kept. This is the consumer.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS ROUTE DELETES DATA THAT CANNOT BE RECOVERED. Read before touching it.
//
// Four independent things must ALL be true before one byte is removed:
//   1. CRON_SECRET matches (constant-time, fail-closed) — same guard as the
//      other crons; this is never publicly callable.
//   2. RETENTION_PURGE_ENABLED === "true". Unset ⇒ DRY RUN: it reports exactly
//      what it would erase and erases nothing. This is the default, forever,
//      until a human deliberately turns it on.
//   3. decidePurge() returns true for the row — deactivated, timer stamped,
//      seven years genuinely up, not already purged (see retention-purge.ts,
//      19 tests, every one of them a refusal case).
//   4. The user id is a plain UUID, so the Storage prefix cannot widen beyond
//      one account.
//
// Nothing in this app is due before 2033, so in normal operation this job finds
// ZERO candidates for years. If a dry run ever reports a candidate before then,
// something stamped a wrong date — investigate, do not enable.
//
// WHAT IT ERASES: the user's Storage objects and their `documents` rows — the
// bulk of the personal data and all of the file storage.
// WHAT IT DOES NOT: it never hard-deletes the auth user, the profile, or any
// financial row (invoices, bank_transactions, cash entries). Those cascade
// across the whole schema and their removal is a deliberate, audited, one-off
// human action — not something an unattended cron does at 3am.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { DEMO_TENANT_ID } from "@/lib/demo-tenant";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import {
  partitionPurgeCandidates,
  storagePrefixForUser,
  type DeletionRequestRow,
} from "@/lib/retention-purge";
// [WAARSCHUWING] De 30-dagenbrief van §5.7.5 — zie sendRetentionWarnings() hieronder.
import {
  partitionWarningCandidates,
  WARNING_LEAD_DAYS,
  type WarnableRow,
} from "@/lib/retention-warning";
import { sendRetentionWarning } from "@/lib/email";
import { appUrl } from "@/lib/app-origin";
import { logAuditAction } from "@/lib/audit";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
import { listOriginals, removeOriginals } from "@/lib/document-storage"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = "documents";
/** Storage list() is paged; this is the page size, not a cap on what is erased. */
const LIST_PAGE = 100;
/** Users handled per run. A purge is never urgent — spreading it is free safety. */
const MAX_USERS_PER_RUN = 25;

type PurgeReport = {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  purged: number;
  skipped: Record<string, number>;
  failures: string[];
  /** [WAARSCHUWING] De 30-dagenbrief van §5.7.5 — wie er een kreeg, en wie niet. */
  warned: { scanned: number; sent: number; skipped: Record<string, number>; failures: string[] };
};

/**
 * [WAARSCHUWING] De 30-dagenbrief versturen — vóór er ook maar iets wordt gewist.
 *
 * DE EIGENSCHAP DIE DIT OPLEVERT, EN DIE IS HET HELE PUNT:
 * decidePurge() eist een brief van minstens 30 dagen oud. Deze pas verstuurt hem. Gevolg: op het
 * moment dat iemand RETENTION_PURGE_ENABLED voor het eerst aanzet, kan er dertig dagen lang
 * NIETS worden gewist — hoe oud de rijen ook zijn. Die vertraging is geen bijwerking maar de
 * bedoeling: de knop is niet gevaarlijk meer, want hij begint met brieven schrijven.
 *
 * WAAROM DE BRIEF AAN DEZELFDE SCHAKELAAR HANGT
 * Staat de purge uit, dan wordt er niets gewist, en dan is er ook niets aan te kondigen.
 * "Wij verwijderen je administratie over 30 dagen" mailen en het vervolgens niet doen, is
 * alarmerend én onwaar. Een droge run telt dus wel wie er een brief zou krijgen, en stuurt niets.
 *
 * HET STEMPEL STAAT NA DE MAIL, NOOIT ERVOOR. Mislukt de verzending, dan blijft
 * purge_warning_sent_at leeg en weigert de purge deze rij — precies de goede kant op. Andersom
 * zou een mislukte mail een verwijdering vrijgeven waarvan niemand ooit is verteld.
 */
async function sendRetentionWarnings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  now: Date,
  dryRun: boolean,
  origin: string,
): Promise<PurgeReport["warned"]> {
  const uit: PurgeReport["warned"] = { scanned: 0, sent: 0, skipped: {}, failures: [] };

  const horizon = new Date(now.getTime() + WARNING_LEAD_DAYS * 86_400_000).toISOString();
  let rows: WarnableRow[];
  try {
    rows = await fetchAllRows<WarnableRow>((from, to) =>
      pipeline
        .from("deletion_requests")
        .select("id, user_id, deleted_at, data_eligible_for_deletion_at, purged_at, purge_warning_sent_at")
        .is("purged_at", null)
        .is("purge_warning_sent_at", null)
        .not("deleted_at", "is", null)
        .lte("data_eligible_for_deletion_at", horizon)
        .order("data_eligible_for_deletion_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    // Ontbrekende kolom = migratie nog niet toegepast. Dan is er niets gewaarschuwd, en dus wist
    // de purge hieronder ook niets — de veilige kant, zonder 500.
    console.error("[CRON-RETENTION] waarschuwingsquery mislukt (migratie toegepast?):", err);
    uit.failures.push("query_failed");
    return uit;
  }

  uit.scanned = rows.length;
  if (rows.length === 0) return uit;

  // [KLUIS] Wie vooruit heeft betaald krijgt geen brief — er gaat niets weg. Faalt de query, dan
  // waarschuwen wij NIEMAND: een mail "wij verwijderen je administratie" naar iemand die voor
  // bewaring betaald heeft, is de meest alarmerende fout die dit bestand kan maken.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  if (userIds.length > 0) {
    try {
      const { data: kluizen, error: kluisErr } = await pipeline
        .from("kluis_subscriptions")
        .select("user_id, keep_through_year")
        .in("user_id", userIds)
        .is("cancelled_at", null);
      if (kluisErr) throw new Error(kluisErr.message);
      const langste = new Map<string, number>();
      for (const k of (kluizen ?? []) as Array<{ user_id: string; keep_through_year: number }>) {
        if (k.keep_through_year > (langste.get(k.user_id) ?? 0)) langste.set(k.user_id, k.keep_through_year);
      }
      for (const r of rows) if (r.user_id) r.kluis_keep_through_year = langste.get(r.user_id) ?? null;
    } catch (err) {
      console.error("[CRON-RETENTION] kluis-check mislukt — NIEMAND gewaarschuwd:", err);
      uit.failures.push("kluis_check_unavailable");
      return uit;
    }
  }

  const { warn, skip } = partitionWarningCandidates(rows, now);
  for (const s of skip) uit.skipped[s.reason] = (uit.skipped[s.reason] ?? 0) + 1;

  if (warn.length === 0) return uit;
  console.warn(
    `[CRON-RETENTION] ${warn.length} accounts krijgen de 30-dagenbrief (§5.7.5)` +
      (dryRun ? " — DROGE RUN, er wordt niets verstuurd." : " — VERSTUREN NU."),
  );
  if (dryRun) return uit;

  for (const { row, daysLeft } of warn) {
    try {
      const { data: profiel } = await pipeline
        .from("profiles")
        .select("email, full_name, company_name")
        // [DEMO-DICHT] Zie de andere crons: het demoaccount krijgt geen post.
        .neq("id", DEMO_TENANT_ID)
        .eq("id", row.user_id)
        .maybeSingle();
      const email = profiel?.email as string | undefined;
      if (!email) {
        // Geen adres = geen brief die aankomt. Niet stempelen: zonder stempel weigert de purge,
        // en dat is beter dan wissen na een brief die nergens heen ging.
        uit.skipped["no_email"] = (uit.skipped["no_email"] ?? 0) + 1;
        continue;
      }
      await sendRetentionWarning({
        toEmail: email,
        name: profiel?.company_name || profiel?.full_name || null,
        daysLeft,
        eligibleDate: row.data_eligible_for_deletion_at as string,
        loginUrl: appUrl(process.env, "/login", origin),
      });
      // Pas NU stempelen. Zie de kop.
      await pipeline
        .from("deletion_requests")
        .update({ purge_warning_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      uit.sent += 1;
      await logAuditAction({
        // row.user_id is hier gegarandeerd gevuld: decideWarning() weigert een rij zonder.
        userId: row.user_id as string,
        action: "retention.warning_sent",
        entityType: "deletion_request",
        entityId: row.id,
        newValue: { days_left: daysLeft, eligible_at: row.data_eligible_for_deletion_at },
      }).catch(() => {});
    } catch (err) {
      console.error("[CRON-RETENTION] waarschuwing mislukt", { id: row.id, err });
      uit.failures.push(row.id);
    }
  }
  return uit;
}

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  // ── Guard 1: never publicly callable ───────────────────────────────
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RETENTION] CRON_SECRET is not configured — purge is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "retention-purge", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Zie de gelijknamige uitleg in api/cron/reminders. Deze route had dezelfde
  // vorm en een scherper gevolg: `finishCronRun` stond alleen op het volledige pad, en de eerste
  // vroege uitgang hieronder is "geen kandidaten" — de NORMALE uitkomst voor een jonge
  // administratie. Deze cron meldde daardoor bij vrijwel elke run 'afgebroken'. Gemeten op
  // 15 augustus: laatste run 10 augustus, ok = NULL, terwijl er simpelweg niets te wissen was.
  //
  // `klaar()` sluit de regel én bouwt het antwoord, zodat de uitgang niet te vergeten valt.
  const klaar = async (body: Record<string, unknown>, ok = true) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body);
  };

  // ── Guard 2: the dark switch. Unset ⇒ dry run. ─────────────────────
  const dryRun = (process.env.RETENTION_PURGE_ENABLED || "").trim() !== "true";

  const pipeline = createPipelineClient();
  const now = new Date();

  const report: PurgeReport = {
    dryRun,
    scanned: 0,
    eligible: 0,
    purged: 0,
    skipped: {},
    failures: [],
    warned: { scanned: 0, sent: 0, skipped: {}, failures: [] },
  };

  // [WAARSCHUWING] EERST de brieven, dan pas het wissen — en in deze volgorde, altijd.
  // Wie vandaag zijn brief krijgt, kan pas over dertig dagen worden gewist (decidePurge eist dat),
  // dus de twee passen kunnen elkaar niet in dezelfde run inhalen.
  report.warned = await sendRetentionWarnings(pipeline, now, dryRun, new URL(req.url).origin);

  // ── Find rows whose timer has run out ──────────────────────────────
  // Filtered in SQL to the plausible set, then judged by the pure decision —
  // the SQL is an optimisation, never the authority.
  //
  // purged_at is added by retention_purge.sql, applied by hand. Until then this
  // query errors; that is caught and returned as a clean no-op so a missing
  // migration can never 500 a cron (the same defence the reminders cron uses).
  let rows: DeletionRequestRow[];
  try {
    rows = await fetchAllRows<DeletionRequestRow>((from, to) =>
      // purged_at is not in the generated types (added by retention_purge.sql)
      // → relaxed client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from("deletion_requests")
        // [WAARSCHUWING] purge_warning_sent_at MOET mee. decidePurge weigert elke rij zonder dit
        // stempel met `no_warning_sent` — het laatste hek, en het enige dat een belofte afdwingt in
        // plaats van een techniek. Het stond niet in deze SELECT, dus kwam het bij decidePurge
        // binnen als ONTBREKEND en werd élke rij geweigerd, elke nacht, voor altijd: de
        // AVG-verwijdering (art. 17) kon niets wissen en het rapport zei "niets te doen".
        // De brief zelf werd wél netjes verstuurd en gestempeld, honderd regels hierboven.
        .select("id, user_id, deleted_at, data_eligible_for_deletion_at, purged_at, purge_warning_sent_at")
        .is("purged_at", null)
        .not("deleted_at", "is", null)
        .lte("data_eligible_for_deletion_at", now.toISOString())
        // Oldest-due first, then id as the tiebreaker. fetchAllRows requires a
        // STABLE order: data_eligible_for_deletion_at is not unique, and two
        // rows sharing a timestamp can otherwise swap places between pages and
        // silently skip one — on this job, a skipped row is an erasure that
        // never happens and a GDPR request that stays unfulfilled.
        .order("data_eligible_for_deletion_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error("[CRON-RETENTION] candidate query failed (migration applied?):", err);
    // Kán twee dingen betekenen: niets te wissen, of de tabel bestaat nog niet. Het eerste is
    // een geslaagde run; het tweede ziet de ondernemer aan de note. Niet als fout melden — deze
    // route valt met opzet stil terug zolang de migratie open staat.
    return klaar({ ok: true, ...report, note: "no_candidates_or_migration_pending" });
  }

  report.scanned = rows.length;

  // ── [KLUIS] Wie heeft er een lopende Bewaarkluis? ──────────────────────────
  //
  // Dit is het hek dat RETENTION_PURGE_ENABLED eindelijk aan mág. Zonder deze verrijking
  // weet decidePurge() niet wie er vooruit heeft betaald voor bewaring, en zou een
  // afgelopen wettelijke termijn genoeg zijn om bestanden te wissen waar iemand geld voor
  // heeft neergelegd.
  //
  // ⚠️ FAALT DICHT, en dat is het enige punt in dit hele bestand waar dat zo is. Lukt deze
  // query niet, dan stoppen wij — want dan kunnen wij niet uitsluiten dat er een betaalde
  // kluis tussen zit. Bij twijfel niets wissen; wissen is onomkeerbaar en de cron draait
  // volgende week gewoon opnieuw.
  if (rows.length > 0) {
    const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
    if (userIds.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: kluizen, error: kluisErr } = await (pipeline as any)
          .from("kluis_subscriptions")
          .select("user_id, keep_through_year")
          .in("user_id", userIds)
          .is("cancelled_at", null);
        if (kluisErr) throw new Error(kluisErr.message);

        // Per gebruiker het LAATSTE jaar dat is gekocht: wie twee keer heeft verlengd,
        // houdt de langste belofte.
        const langste = new Map<string, number>();
        for (const k of (kluizen ?? []) as Array<{ user_id: string; keep_through_year: number }>) {
          const huidig = langste.get(k.user_id) ?? 0;
          if (k.keep_through_year > huidig) langste.set(k.user_id, k.keep_through_year);
        }
        for (const r of rows) {
          if (r.user_id) r.kluis_keep_through_year = langste.get(r.user_id) ?? null;
        }
      } catch (err) {
        console.error(
          "[CRON-RETENTION] kluis_subscriptions niet leesbaar — NIETS gewist. " +
            "Is kluis_subscriptions.sql toegepast?",
          err
        );
        // Er is NIETS gewist omdat de kluis-controle niet kon draaien. Dat is geen geslaagde
        // run: blijft dit staan, dan wordt er nooit meer iets opgeruimd en zegt niemand iets.
        return klaar({
          ok: false,
          ...report,
          note: "kluis_check_unavailable_nothing_purged",
        }, false);
      }
    }
  }

  const { purge, skip } = partitionPurgeCandidates(rows, now);
  report.eligible = purge.length;
  for (const s of skip) {
    report.skipped[s.reason] = (report.skipped[s.reason] ?? 0) + 1;
  }

  if (purge.length === 0) {
    return klaar({ ok: true, ...report });
  }

  // Loud: a real erasure becoming due is a compliance event, not routine noise.
  console.warn(
    `[CRON-RETENTION] ${purge.length} accounts past their 7-year retention window` +
      (dryRun ? " — DRY RUN, nothing will be erased." : " — ERASING NOW.")
  );

  for (const row of purge.slice(0, MAX_USERS_PER_RUN)) {
    // Guard 4: the prefix is the only thing bounding the blast radius.
    const prefix = storagePrefixForUser(row.user_id!);
    if (!prefix) {
      report.failures.push(`${row.id}: refused — user_id is not a plain uuid`);
      continue;
    }

    if (dryRun) {
      report.purged++; // "would have purged"
      continue;
    }

    // Per-user isolation: one failure never stops the rest, and a user whose
    // erasure failed keeps purged_at NULL so the next run retries them.
    try {
      await purgeOneUser(pipeline, row.user_id!, prefix);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: markErr } = await (pipeline as any)
        .from("deletion_requests")
        .update({ purged_at: new Date().toISOString() })
        .eq("id", row.id);
      if (markErr) throw new Error(`could not stamp purged_at: ${markErr.message}`);

      // The ONLY lasting record that this erasure happened — the files and rows
      // it describes no longer exist to be inspected.
      await logAuditAction({
        userId: row.user_id!,
        action: "user.data_purged",
        entityType: "deletion_request",
        entityId: row.id,
        newValue: { bucket: BUCKET, prefix, purged_at: new Date().toISOString() },
      }).catch(() => { /* the purge already succeeded — never undo it over a log */ });

      report.purged++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`[CRON-RETENTION] purge failed for ${row.id}:`, msg);
      report.failures.push(`${row.id}: ${msg}`);
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: report.failures.length === 0, result: { ok: report.failures.length === 0, ...report } });

  return NextResponse.json({ ok: true, ...report });
}

/**
 * Erase one user's files: Storage objects first, then their `documents` rows.
 *
 * ORDER IS DELIBERATE. Rows are the only index of what a user's objects are —
 * delete them first and any Storage failure leaves objects nobody can ever find
 * again (exactly the orphaning described in the report's A2). Objects first
 * means the worst case is a retryable row-delete failure, with the row still
 * pointing at storage that is already gone.
 */
async function purgeOneUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  userId: string,
  prefix: string
): Promise<void> {
  // ── 1. Storage objects under this user's prefix, page by page ──────
  // Recursive: keys are `${userId}/${year}/Q${q}/${file}`, and list() only
  // returns one level at a time.
  const removed = await removePrefixRecursive(pipeline, prefix);
  console.warn(`[CRON-RETENTION] removed ${removed} objects under ${prefix}`);

  // ── 2. The rows ────────────────────────────────────────────────────
  const { error: docErr } = await pipeline.from("documents").delete().eq("user_id", userId);
  if (docErr) throw new Error(`documents delete failed: ${docErr.message}`);

  const { error: folderErr } = await pipeline.from("folders").delete().eq("user_id", userId);
  if (folderErr) throw new Error(`folders delete failed: ${folderErr.message}`);
}

/**
 * Depth-first removal of everything under a Storage prefix. Returns the count.
 *
 * LIST THE WHOLE LEVEL FIRST, THEN DELETE. Do not "simplify" this back into a
 * delete-as-you-page loop: `list()` pages by OFFSET, so deleting a page shifts
 * every later entry forward by exactly the number just removed, and the next
 * request at offset+100 then starts 100 entries past where the data now begins.
 * With 250 files you would erase 100, skip 100, erase 50, and report success.
 *
 * Silent partial erasure is the worst possible outcome here: the row gets
 * stamped purged_at, so nothing ever comes back for the survivors, and we would
 * have told a person their data was deleted when it was not.
 */
async function removePrefixRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  prefix: string
): Promise<number> {
  const files: string[] = [];
  const folders: string[] = [];

  // ── Phase 1: read the entire level, deleting nothing ───────────────
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data: entries, error } = await listOriginals(pipeline, prefix.replace(/\/$/, ""), { limit: LIST_PAGE, offset });

    if (error) throw new Error(`storage list failed at ${prefix}: ${error.message}`);
    if (!entries || entries.length === 0) break;

    for (const entry of entries as Array<{ id: string | null; name: string }>) {
      // Supabase marks a synthetic "folder" with a null id; everything else is
      // a real object.
      if (entry.id === null) folders.push(entry.name);
      else files.push(`${prefix}${entry.name}`);
    }

    if (entries.length < LIST_PAGE) break;
    // Backstop against a pathological listing; a real account is nowhere near.
    if (offset > 1_000_000) {
      throw new Error(`storage listing at ${prefix} exceeded the safety bound`);
    }
  }

  // ── Phase 2: now it is safe to delete ──────────────────────────────
  let removed = 0;
  for (let i = 0; i < files.length; i += LIST_PAGE) {
    const batch = files.slice(i, i + LIST_PAGE);
    const { error: rmErr } = await removeOriginals(pipeline, batch);
    if (rmErr) throw new Error(`storage remove failed at ${prefix}: ${rmErr.message}`);
    removed += batch.length;
  }

  for (const folder of folders) {
    removed += await removePrefixRecursive(pipeline, `${prefix}${folder}/`);
  }

  return removed;
}
