// src/app/api/btw/file/route.ts
// [TRUTH-FILED] Mark a quarter's BTW-aangifte as filed — freeze a snapshot of the figures as they
// stand now — or un-file it (reversible). The living truth keeps moving afterwards; the snapshot
// does not, so the truth surface can flag any later divergence (suppletie).
//
// POST   { year, quarter }  → compute the quarter's current result and upsert the frozen snapshot.
// DELETE ?year&quarter      → remove the filing (unlock the quarter).
// The btw_filings write goes through the SESSION client so RLS (auth.uid() = user_id) applies; the
// figure computation uses the service-role pipeline (same reconcile as /api/result).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResultForRange } from "@/lib/compute-result-range";
import { computeFilingDivergence, decideFilingWrite } from "@/lib/btw-filing";
import { quarterBounds, figuresOf, readFiling, readFilingWithCarry } from "@/lib/filed-quarter";
// [KAS-NEGATIEF] The same drawer witness /dashboard/klaar blocks on — see the gate below.
import { loadDrawerWitness } from "@/lib/drawer-witness";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requirePermission } from "@/lib/access/context";
// [TZ] "Has this quarter ended?" is an Amsterdam-day question — see the filing-window gate below.
import { amsterdamToday, formatDateNL } from "@/lib/format-nl";
import { telWoord, vervoeg } from "@/lib/nl-plural";

function parsePeriod(year: unknown, quarter: unknown): { year: number; quarter: number } | null {
  const y = Number(year);
  const q = Number(quarter);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(q) || q < 1 || q > 4) return null;
  return { year: y, quarter: q };
}

// [SUPPLETIE] quarterBounds / FILING_COLS / figuresOf / readFiling used to live here as private
// copies. They now come from lib/filed-quarter.ts, because the correction routes ask the SAME
// question ("is this quarter filed, and has it moved?") and two copies of that rule drift on the
// first change to either — which for this particular rule means one screen announcing a suppletie
// and another staying quiet about the same quarter.
/** One sentence for "we could not read your filing", used wherever that read is fail-closed. */
const READ_FAILED = {
  error: "filing_read_failed",
  reason:
    "We konden niet controleren of dit kwartaal al is ingediend. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
} as const;

// GET ?year&quarter → the filing snapshot for this quarter (if any) + the live divergence.
// Used by the Kwartaaloverzicht to show the "🔒 Ingediend" / suppletie state for any quarter.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const period = parsePeriod(sp.get("year"), sp.get("quarter"));
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });
  const { year, quarter } = period;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  // [FILING-NO-OVERWRITE] The error was dropped here too, so a hiccup answered `filed: null` — and
  // the screens that ask this question use the answer to decide whether to show a lock badge and a
  // "markeer als ingediend" button. Say we could not look instead.
  // [SUPPLETIE-EEN-ANTWOORD] Mét carried_saldo, want de banner die dit antwoord toont bepaalt
  // hiermee of hij "suppletie" of "doorschuiven" zegt — en dat moet hetzelfde bedrag zijn als
  // waarop de knop ernaast zijn route bepaalt. [DEPLOY-SAFE] valt terug op de kale lezing wanneer
  // de kolom er nog niet is; dan is er ook niets doorgeschoven en klopt het antwoord alsnog.
  const { row: fRow, failed } = await readFilingWithCarry(db, user.id, year, quarter);
  if (failed) return NextResponse.json(READ_FAILED, { status: 503 });
  if (!fRow) return NextResponse.json({ ok: true, filed: null });

  const figures = figuresOf(fRow);
  // Compare the frozen snapshot to the CURRENT live figures for this quarter.
  const { start, end } = quarterBounds(year, quarter);
  const pipeline = createPipelineClient();
  const { result } = await computeResultForRange({ pipeline, ownerId: user.id, start, end });
  const divergence = computeFilingDivergence(figures, {
    omzet: result.omzet, kosten: result.kosten,
    btwVerschuldigd: result.btwVerschuldigd, btwVoorbelasting: result.btwVoorbelasting, btwSaldo: result.btwSaldo,
  }, Number(fRow.carried_saldo) || 0);

  return NextResponse.json({ ok: true, filed: { filedAt: fRow.filed_at, figures, divergence } });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // [EEN-POORT] `vat.submit`. This is the declaration itself — the figures frozen here are what
  // the owner says they told the Belastingdienst, and the lock that follows is what makes every
  // later divergence read as a suppletie. Nobody but the owner of the administration declares it:
  // art. 52 AWR leaves that duty with the entrepreneur, which is also why a mandated accountant
  // holds `vat.submit` nowhere in the catalogue.
  {
    const gate = await requirePermission("vat.submit", { ownerId: user.id });
    if (gate.response) return gate.response;
  }

  const body = await req.json().catch(() => ({}));
  const period = parsePeriod(body?.year, body?.quarter);
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });
  const { year, quarter } = period;
  const { start, end } = quarterBounds(year, quarter);

  // Own filing only (no accountant dual-path here — filing is the owner's declaration).
  const pipeline = createPipelineClient();

  // The engine already surfaces every completeness signal we need — compute it once, up front, and
  // reuse it both for the readiness gate and for the frozen snapshot below.
  const range = await computeResultForRange({ pipeline, ownerId: user.id, start, end });
  const { result, datelessVerifiedCount, undatedPaidCount, unconfirmedIncomingCount } = range;

  // [FILING-WINDOW] A quarter that has not ENDED cannot have been filed with the Belastingdienst —
  // the aangifte for it does not exist yet. Freezing a snapshot mid-quarter is worse than useless:
  // every sale for the rest of the quarter then reads as a divergence against it, and once the
  // running total moves by more than €1.000 the screen tells the owner to file a suppletie for a
  // period nobody has asked them to declare. Unlike the completeness blockers below, this is not a
  // matter of the owner's own judgement, so `acknowledge` does not open it.
  if (end >= amsterdamToday()) {
    return NextResponse.json(
      {
        error: "quarter_not_ended",
        reason: `Kwartaal ${quarter} ${year} loopt nog tot en met ${end}. Je kunt een kwartaal pas als ingediend markeren nadat het is afgelopen.`,
      },
      { status: 409 },
    );
  }

  // [FILING-NO-OVERWRITE] Is there already a filing for this quarter? Asked BEFORE anything else
  // is decided, because replacing one is a different act from making one.
  //
  // The write below was a bare upsert, so a second POST silently replaced the frozen snapshot with
  // today's figures and today's filed_at. That erases the one thing this table exists for: the
  // difference between what was DECLARED and what the books say now — the entire basis for a
  // suppletie. And it was reachable by accident, not only by a determined double tap: every reader
  // of btw_filings dropped its error, so one failed read showed the quarter as never filed, put the
  // "Markeer als ingediend" button back on screen, and one tap then overwrote the record. The audit
  // recorded only the NEW figures, so nothing could be reconstructed afterwards.
  //
  // Re-filing after a suppletie is legitimate and stays possible — it just has to be MEANT:
  // `replace: true`, sent after the client has shown what is being replaced.
  // btw_filings is not yet in the generated types (added by btw_filings.sql) → relaxed client,
  // declared once here and reused by the write at the end of this handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const existing = await readFiling(db, user.id, year, quarter);
  // Fail-closed: not knowing whether a filing exists is exactly the state in which writing one is
  // destructive. Nothing has been written at this point, so refusing costs nothing.
  if (existing.failed) return NextResponse.json(READ_FAILED, { status: 503 });
  const write = decideFilingWrite({ hasExisting: existing.row !== null, replace: body?.replace === true });
  const replacing = write === "replace";
  if (write === "ask") {
    const figures = figuresOf(existing.row!);
    return NextResponse.json(
      {
        error: "already_filed",
        filed: {
          filedAt: existing.row!.filed_at,
          figures,
          // What replacing would cost the owner: the divergence they can currently still see.
          divergence: computeFilingDivergence(figures, {
            omzet: result.omzet, kosten: result.kosten,
            btwVerschuldigd: result.btwVerschuldigd,
            btwVoorbelasting: result.btwVoorbelasting,
            btwSaldo: result.btwSaldo,
          }),
        },
        // The owner reads this sentence in a dialog, so it names both facts they need to weigh:
        // WHEN they filed and WHAT they filed. Dutch date shape + Amsterdam zone (format-nl.ts).
        reason:
          `Dit kwartaal staat al als ingediend (${formatDateNL(existing.row!.filed_at)}), met een BTW-saldo van ` +
          `€ ${figures.btwSaldo.toFixed(2)}. Opnieuw indienen VERVANGT die vastgelegde cijfers ` +
          "door de cijfers van nu — daarna is niet meer te zien wat je destijds hebt aangegeven.",
      },
      { status: 409 },
    );
  }

  // [FILING-GATE] Don't freeze a quarter as "ingediend" while its figures are demonstrably
  // incomplete. The old gate checked ONLY unconfirmed ('processing') incoming invoices — but the
  // truth can be too low for several other reasons the readiness screen already blocks on. Gate on
  // the SAME engine signals so filing and "klaar" can never disagree:
  //   - processing incoming invoices in the window (cost/BTW not yet counted)
  //   - cashOmzetZonderBtw > 0 (omzet booked in NO BTW rubriek — 5a silently too low)
  //   - dateless verified invoices (dropped from the window entirely)
  //   - undatedPaidCount (kasstelsel: paid money that can't be placed in a quarter)
  // This is a WARNING, not a hard block: filing is the owner's own declaration, so the client
  // re-POSTs with { acknowledge: true } after seeing the reason (which we then audit, below).
  if (body?.acknowledge !== true) {
    const blockers: string[] = [];
    // [GATE-PARITY] The unconfirmed-purchase count now comes from the SAME engine call that
    // produced the figures, over the SAME rows, using the SAME effective-direction rule the money
    // uses (effDirOf). The old inline query filtered `.eq("direction", "incoming")`, which is a
    // column test — and a purchase invoice whose direction column is NULL is inferred from
    // ownership everywhere else ([FIN-4]). Those rows are excluded from the figures but were
    // invisible to the gate, so a quarter with unconfirmed purchases could pass it unchallenged.
    // It also removes a query and a fail-open/fail-closed branch: if the engine read fails, the
    // whole request fails, which is the correct fail-closed behaviour for a filing gate.
    if (unconfirmedIncomingCount > 0) blockers.push(`${telWoord(unconfirmedIncomingCount, "inkoopfactuur")} in dit kwartaal ${vervoeg(unconfirmedIncomingCount, "is", "zijn")} nog niet gecontroleerd — het bedrag en de BTW staan nog niet in de cijfers`);
    if (result.cashOmzetZonderBtw > 0) blockers.push(`er staat nog omzet zonder BTW-tarief (contant, bank of niet-gesplitste kassadag) — de verschuldigde BTW is daardoor mogelijk te laag`);
    if (datelessVerifiedCount > 0) blockers.push(`${telWoord(datelessVerifiedCount, "bevestigde factuur")} ${vervoeg(datelessVerifiedCount, "heeft", "hebben")} geen datum en ${vervoeg(datelessVerifiedCount, "telt", "tellen")} niet mee in dit kwartaal`);
    if (undatedPaidCount > 0) blockers.push(`${telWoord(undatedPaidCount, "betaalde factuur")} ${vervoeg(undatedPaidCount, "mist", "missen")} een betaaldatum — onder kasstelsel kan de BTW niet in het juiste kwartaal worden geplaatst`);

    // [KAS-NEGATIEF] …and the drawer. This gate listed four signals and not this one, while
    // /dashboard/klaar counts a below-zero drawer as a MISSING item (it cannot reach "klaar"
    // with one) and the Kas page tells the owner, in the app's own words, that "zolang dit
    // openstaat, blokkeert de app je BTW-aangifte". It did not: the quarter froze as ingediend
    // with nothing asked. A negative cash balance is physically impossible — you cannot pay out
    // money that was never in the till — and it is the single strongest reason the
    // Belastingdienst rejects a cash administration, so it belongs here more than most.
    //
    // Same witness the readiness verdict uses (loadDrawerWitness), so the two cannot drift, which
    // is what this gate's own comment above asks for. It throws rather than guessing on a failed
    // read: a filing gate that cannot see the drawer must not wave the quarter through.
    let drawerLowPoint: { date: string; balance: number } | null = null;
    try {
      drawerLowPoint = (await loadDrawerWitness({ client: pipeline, ownerId: user.id, year, quarter })).lowestPoint;
    } catch (e) {
      console.error("[KAS-NEGATIEF] drawer witness unavailable at filing", { userId: user.id, year, quarter, error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json(
        {
          error: "readiness_check_failed",
          reason: "We konden je kasboek nu niet controleren, en we markeren een kwartaal niet als ingediend zonder die controle. Probeer het zo meteen opnieuw.",
        },
        { status: 503 },
      );
    }
    if (drawerLowPoint) {
      blockers.push(
        `je kassaldo stond op ${drawerLowPoint.date} op € ${drawerLowPoint.balance.toFixed(2)} — een kas kan niet onder nul komen, dus er ontbreekt een contante ontvangst of het beginsaldo klopt niet`,
      );
    }

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: "quarter_not_ready",
          notReady: true,
          processingCount: unconfirmedIncomingCount,
          blockers,
          reason: blockers.join(". "),
        },
        { status: 409 },
      );
    }
  }

  const snapshot = {
    user_id: user.id,
    year,
    quarter,
    filed_at: new Date().toISOString(),
    omzet: result.omzet,
    kosten: result.kosten,
    btw_verschuldigd: result.btwVerschuldigd,
    btw_voorbelasting: result.btwVoorbelasting,
    btw_saldo: result.btwSaldo,
  };

  // [FILING-NO-OVERWRITE] INSERT when there is nothing to replace, UPSERT only when the owner said
  // `replace: true` after being shown what they were replacing. The insert is what makes this
  // race-proof rather than merely guarded: two tabs that both read "not filed" cannot both write —
  // the unique (user_id, year, quarter) constraint refuses the second, and 23505 is answered with
  // the same "already_filed" question the check above asks, on fresher facts.
  // [EEN-POORT] `period.close`, named at the line that actually closes. In this product filing a
  // quarter IS closing it — this row is the lock every other screen reads — so the two permissions
  // live on one handler rather than on two doors that do not exist. They are asked separately
  // because they are two different acts: `vat.submit` is the declaration, this is the freeze, and
  // `period.reopen` in the DELETE below is the only thing that undoes it.
  {
    const gate = await requirePermission("period.close", { ownerId: user.id });
    if (gate.response) return gate.response;
  }
  const { error } = replacing
    ? await db.from("btw_filings").upsert(snapshot, { onConflict: "user_id,year,quarter" })
    : await db.from("btw_filings").insert(snapshot);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          error: "already_filed",
          reason:
            "Dit kwartaal is zojuist al als ingediend gemarkeerd (misschien in een ander tabblad). " +
            "Ververs de pagina — er is niets overschreven.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "kon indiening niet opslaan" }, { status: 500 });
  }

  // [FILING-AUDIT] Record that this quarter was filed, and — crucially — WHETHER it was filed while
  // readiness blockers were still open (acknowledge:true). Previously the override left no trace, so
  // a later dispute couldn't show the owner was warned. Best-effort: never fail the filing on audit.
  await logAuditAction({
    userId: user.id,
    action: body?.acknowledge === true ? "btw.filed_despite_warnings" : "btw.filed",
    entityType: "btw_filing",
    entityId: `${year}-Q${quarter}`,
    // [FILING-NO-OVERWRITE] The snapshot that was REPLACED, when there was one. Without it the
    // audit trail recorded that a quarter was filed and never what filing it displaced, so the
    // figures the owner actually declared were gone from the system entirely. This is the copy
    // that survives — it is what a later dispute with the Belastingdienst is reconstructed from.
    oldValue: replacing
      ? { replaced_filing: { filedAt: existing.row!.filed_at, ...figuresOf(existing.row!) } }
      : undefined,
    newValue: {
      year, quarter, acknowledged: body?.acknowledge === true, replaced: replacing,
      btwSaldo: result.btwSaldo, cashOmzetZonderBtw: result.cashOmzetZonderBtw,
      datelessVerifiedCount, undatedPaidCount, unconfirmedIncomingCount,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, filing: snapshot });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // [EEN-POORT] `period.reopen`, and the header below says why it is exactly as consequential as
  // filing: the lock comes off, the divergence signal disappears, and the figures the owner
  // declared stop being recorded anywhere. A protected operation gets a named permission, not a
  // session check.
  {
    const gate = await requirePermission("period.reopen", { ownerId: user.id });
    if (gate.response) return gate.response;
  }

  const sp = req.nextUrl.searchParams;
  const period = parsePeriod(sp.get("year"), sp.get("quarter"));
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // [FILING-UNLOCK-AUDIT] Read the snapshot BEFORE removing it. Unlocking a quarter is exactly as
  // consequential as filing it — the lock comes off, the divergence signal disappears, and the
  // figures the owner declared stop being recorded anywhere — and yet this was the one handler in
  // the file that wrote nothing to the audit log while its sibling even distinguishes
  // btw.filed_despite_warnings. A deletion that cannot be recorded is one we do not perform: the
  // read is fail-closed, because "we could not read it" is the state in which the copy would be
  // lost for good.
  const existing = await readFiling(db, user.id, period.year, period.quarter);
  if (existing.failed) return NextResponse.json(READ_FAILED, { status: 503 });
  if (!existing.row) {
    // Nothing to unlock. Reported as such rather than as a success, so a client cannot show
    // "ongedaan gemaakt" for a filing that was never there (or that another tab just removed).
    return NextResponse.json({ error: "not_filed", reason: "Dit kwartaal staat niet als ingediend." }, { status: 409 });
  }

  const { data: removed, error } = await db
    .from("btw_filings")
    .delete()
    .eq("user_id", user.id)
    .eq("year", period.year)
    .eq("quarter", period.quarter)
    .select("id");
  if (error) return NextResponse.json({ error: "kon indiening niet verwijderen" }, { status: 500 });
  // [UI-HONESTY] .select() so "geen rij geraakt" is distinguishable from "verwijderd" — the row
  // can have gone in the window between the read and this write.
  if (!removed || removed.length === 0) {
    return NextResponse.json({ error: "not_filed", reason: "Dit kwartaal staat niet (meer) als ingediend." }, { status: 409 });
  }

  await logAuditAction({
    userId: user.id,
    action: "btw.filing_unlocked",
    entityType: "btw_filing",
    entityId: `${period.year}-Q${period.quarter}`,
    oldValue: { filedAt: existing.row.filed_at, ...figuresOf(existing.row) },
    newValue: { year: period.year, quarter: period.quarter, filed: false },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
