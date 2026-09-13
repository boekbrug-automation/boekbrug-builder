// src/app/api/cron/reminders/route.ts
// [REMINDERS] Scheduled payment-reminder heartbeat — the third cron of the app.
// For every owner who has OPTED IN (profiles.reminders_enabled), it finds their
// outgoing invoices that are still openstaand past the due date, and — for each
// invoice whose next reminder tier has come due — e-mails the client a gentle,
// escalating reminder. "The app chases your money for you, even with nobody
// logged in."
//
// SECURITY: iterates across users → never publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed (identical guard to /api/cron/reconcile).
//
// FINANCIAL-TRUTH / TRUST discipline (why this cron is safe):
//   * It NEVER writes to a financial record — no status, amount, match or filing
//     changes. It only reads invoices and writes to invoice_reminders (a send log).
//   * CLAIM-THEN-SEND: the reminder row is inserted FIRST with ignoreDuplicates on
//     UNIQUE(invoice_id, day_offset). An empty insert result = another run already
//     claimed this tier → we do NOT send. This makes a double-reminder impossible
//     even if two cron runs overlap — the worse failure (dunning a client twice)
//     can't happen.
//   * The decision (which tier, or none) is the pure reminderTierDue(); the amount
//     shown is the pure openstaandOf() (remaining, never the full total). Neither
//     touches I/O, both are unit-tested.
//   * Best-effort per owner AND per invoice: one failure never stops the rest, and
//     a failed send is recorded status='failed' (visible), never retried as a
//     double-send.
//   * [HERINNER-AAN] Sinds 3 september 2026 staat reminders_enabled standaard AAN. De rem zit
//     niet meer in de schakelaar maar in de tijd: reminders_enabled_at zegt sinds wanneer, en
//     reminderTierDue() jaagt alleen op facturen die NÁ dat moment vervielen. Zonder die regel
//     stuurt de eerste ronde van een net geregistreerd account de zwaarste trap — de
//     ingebrekestelling met incassokosten — naar iedereen in een geïmporteerde stapel.

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { DEMO_TENANT_ID } from "@/lib/demo-tenant";
import {
  reminderTierDue,
  openstaandOf,
  amsterdamTodayDayNumber,
  // [HERINNER-BEWIJS] Needed to tell the FIRST day a tier came due from every day after it — see
  // the hold below, where that difference decides whether the owner is interrupted again.
  dayNumberFromIso,
} from "@/lib/invoice-reminders";
// [CREDITNOTA-NO-CHASE] shared helper for the credited-ids set
// [DEEL-CREDIT] …and it is a COVERAGE question now, not a yes/no one. A partly credited invoice
// is still owed for the rest, so it must still be chased — for the remainder, never for the total.
import { creditedTotalsFrom, openAfterCredit } from "@/lib/credited-invoices";
import { sendInvoiceReminder } from "@/lib/email";
// [WIK] The final reminder is not a firmer nudge — it is the statutory aanmaning that gives the
// owner the right to charge collection costs at all. Pure law, no I/O: see incasso.ts.
import { buildWikNotice, claimableForWik, debtorTypeOf, isFinalTier, aggregateWikClaims } from "@/lib/incasso";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled"
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path"
// [HERINNER-BEWIJS] Before chasing a customer, ask the bank whether they already paid. Same
// engine and same rule as the panel on the sales list — see the block inside the owner loop.
// [BETAALBLOK] De betaalgegevens die elke herinnering hoort te dragen — zie src/lib/pay-block.ts.
import { payBlockForInvoice } from "@/lib/pay-link";
import { collectOpenInvoiceProof } from "@/lib/open-invoice-proof-collect";
import { describeHit } from "@/lib/open-invoice-proof-text";
import { getOriginal } from "@/lib/document-storage"

const EUR_NL = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
// [TZ] timeZone PINNED — same reason as lib/incasso.ts: formatDayNL builds midnight UTC from the
// ISO parts, which only renders the intended day while the runtime's zone is UTC. Identical output
// on a UTC host, correct on any other.
const DAY_NL = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
const formatEuroNL = (n: number) => EUR_NL.format(n);
const formatDayNL = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? DAY_NL.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))) : iso;
};

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Storage bucket that holds rendered invoice PDFs (see invoice/send route).

type OwnerProfile = {
  id: string;
  reminder_offsets: number[] | null;
  // [HERINNER-AAN] Sinds wanneer deze eigenaar herinneringen aan heeft staan.
  reminders_enabled_at?: string | null;
  company_name: string | null;
  email: string | null;
  full_name: string | null;
  /** [BETAALBLOK] The account the reminder asks the customer to transfer to. */
  iban: string | null;
};

type CandidateInvoice = {
  id: string;
  sender_id: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_number: string | null;
  due_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  pdf_url: string | null;
  invoice_type: string | null;
  status: string | null;
  /** [WIK] Present → a business debtor; absent → treated as a consumer (the stricter regime). */
  client_btw_number: string | null;
  /** [BETAALBLOK] Reused when the invoice already has a pay link; minted on first reminder. */
  pay_token: string | null;
  payment_reference: string | null;
};

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  // ── Auth — fail-closed, constant-time (same as reconcile/email-sync) ──
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    // [ALARM] Not an error in a run — a whole feature standing still. Every night it answers 401,
    // every night nothing is dunned, and the only trace is a log line in a job nobody opens. An
    // owner discovers it when a customer has not paid for three months.
    reportHandledFailure({
      tag: "CRON-REMINDERS",
      message: "CRON_SECRET is not configured — reminders are DISABLED",
      severity: "feature-off",
    });
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "reminders", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Vanaf hier is er een OPEN regel in cron_runs, en die moet dicht — langs
  // welke uitgang de route ook vertrekt.
  //
  // Dat ging mis, en niet zeldzaam: `finishCronRun` stond alleen op het volledige pad, en deze
  // route heeft vier vroege returns. "Geen ondernemers met herinneringen aan", "niets vervallen"
  // — dat zijn de GEWONE uitkomsten, dus bleef de regel structureel op ok = NULL staan en las de
  // gezondheidscheck 'afgebroken'. Gemeten: reminders stond op 15 augustus op AFGEROND NOOIT
  // terwijl hij om 07:00 keurig had gedraaid en niets te doen had.
  //
  // Een alarm dat altijd afgaat leert je alarmen wegklikken, en dan mis je de keer dat hij wél
  // ergens over gaat. Erger nog: een echte leesfout verliet deze route via precies dezelfde deur,
  // dus "niets te doen" en "ik kon niet kijken" waren van buiten niet te onderscheiden.
  //
  // Daarom sluit `klaar()` de regel én bouwt het antwoord: door de uitgang zelf te zijn, kan een
  // volgende vroege return hem niet meer vergeten.
  const klaar = async (body: Record<string, unknown>, ok = true) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body);
  };

  const pipeline = createPipelineClient();
  const today = amsterdamTodayDayNumber();

  // ── 1) Only owners who OPTED IN. No enabled owners → nothing to do (dark). ──
  //    A column-missing error (migration not yet applied) is caught and returned
  //    as a clean no-op, never a 500.
  let owners: OwnerProfile[];
  try {
    owners = await fetchAllRows<OwnerProfile>((from, to) =>
      pipeline
        .from("profiles")
        // [ANTWOORD-ADRES] `email` erbij — zie de herinneringsroute. Deze cron stuurt de meeste
        // herinneringen van het hele product; een antwoord daarop hoort bij de ondernemer.
        // [BETAALBLOK] `iban` erbij: elke herinneringstrap ging uit zonder één betaalgegeven, ook
        // de laatste — de wettelijke aanmaning die incassokosten aankondigt. Zonder dit veld is er
        // geen begunstigde en dus geen betaalblok.
        .select("id, reminder_offsets, reminders_enabled_at, company_name, full_name, email, iban")
        .eq("reminders_enabled", true)
        // [DEMO-DICHT] Het demoaccount niet. Zijn wachtwoord is openbaar, en de fence in de
        // middleware kijkt naar de SESSIEGEBRUIKER — een cron heeft er geen, dus die fence zag deze
        // route nooit. Gemeten op 3 september: het demoaccount was het ENIGE profiel met
        // herinneringen aan, met een openstaande "factuur" aan een verzonnen fysiopraktijk. Nu
        // herinneringen standaard aanstaan is dat geen theorie meer.
        .neq("id", DEMO_TENANT_ID)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[CRON-REMINDERS] enabled-owner lookup failed (migration applied?)", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Een leesfout is GEEN geslaagde run: hij hoort op te vallen als hij zich herhaalt.
    return klaar({ ok: false, enabledOwners: 0, note: "lookup_failed" }, false);
  }

  if (owners.length === 0) {
    return klaar({ ok: true, enabledOwners: 0, sent: 0 });
  }

  const ownerById = new Map<string, OwnerProfile>();
  for (const o of owners) ownerById.set(o.id, o);
  const ownerIds = [...ownerById.keys()];

  // ── 2) Their outgoing, still-open invoices (paginated, bounded to opted-in owners). ──
  // [ID-CHUNK] Keyed on the owner list, which travels in the URL at ~39 bytes per uuid. Paging
  // alone does not help with that: it is the REQUEST that outgrows the proxy's header buffer, not
  // the response. Today's opted-in owners fit; a few thousand would not, and the failure mode is a
  // 414 that supabase-js reports as an ordinary error — so fetchAllRows would throw and this cron
  // would simply stop sending, every night, with nobody looking. Chunking removes the cliff instead
  // of waiting for it. Same rows, same order, one bounded request per chunk.
  // [CRON-STIL] Set by the catch below; null means the read really did answer.
  let invoiceReadFailed: string | null = null;
  const invoices = await fetchAllRowsForIds<CandidateInvoice, string>(ownerIds, (chunk, from, to) =>
    pipeline
      .from("invoices")
      .select(
        // [WIK] client_btw_number decides consumer vs business — which decides whether the final
        // reminder must be the statutory fourteen-day aanmaning.
        // [BETAALBLOK] pay_token + payment_reference: de betaallink hergebruiken als hij al
        // bestaat, en het kenmerk noemen waarop de ondernemer afletter.
        "id, sender_id, client_name, client_email, invoice_number, due_date, total_inc_btw, amount_paid, pdf_url, invoice_type, status, client_btw_number, pay_token, payment_reference",
      )
      .in("sender_id", chunk)
      .eq("direction", "outgoing")
      // [WIK-VORDERING] Only a factuur can be owed. An offerte is 'sent' too, with its "geldig
      // tot" in due_date, and reminderTierDue already refused to write it a letter — but the
      // claims loop below sums the CANDIDATE set, and an expired quote walked into the hoofdsom.
      // Refused twice, here and in claimableForWik, because the sum is a legal amount.
      .eq("invoice_type", "factuur")
      .in("status", ["sent", "overdue"])
      .eq("reminders_paused", false)
      .not("due_date", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    // [CRON-STIL] Caught so one bad chunk does not kill the run — and REMEMBERED, because an empty
    // list from here is indistinguishable from "nothing is overdue tonight". Without the flag this
    // route answered ok:true, sent:0 on a failed read, so dunning could be dead every night while
    // the heartbeat reported the cron ran as intended and no owner was ever told.
    invoiceReadFailed = e instanceof Error ? e.message : String(e);
    console.error("[CRON-REMINDERS] candidate invoice fetch failed", { error: invoiceReadFailed });
    return [] as CandidateInvoice[];
  });

  if (invoiceReadFailed !== null) {
    // [ALARM] Not a quiet night: the question could not be asked. Through the reporter rather than
    // stdout, for the reason this file already gives about a cron writing to a log nobody opens —
    // and the run closes as FAILED, so the heartbeat says so too.
    reportHandledFailure({
      tag: "CRON-REMINDERS",
      message: "candidate invoice read failed — nobody was dunned tonight, and not because nothing was due",
      severity: "gate-unavailable",
      context: { enabledOwners: owners.length, error: invoiceReadFailed },
    });
    return klaar({ ok: false, enabledOwners: owners.length, sent: 0, note: "invoice_lookup_failed" }, false);
  }

  if (invoices.length === 0) {
    return klaar({ ok: true, enabledOwners: owners.length, sent: 0 });
  }

  // ── 3) Which tiers were already sent, per invoice (one batched read). ──
  const invoiceIds = invoices.map((i) => i.id);
  const sentRows = await fetchAllRows<{ invoice_id: string; day_offset: number }>((from, to) =>
    pipeline
      .from("invoice_reminders")
      .select("invoice_id, day_offset")
      .in("invoice_id", invoiceIds)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch(() => [] as { invoice_id: string; day_offset: number }[]);
  // [SPOOR-BEWIJS] That `.catch(() => [])` degrades an unreadable trail to "nothing sent yet",
  // which is the exact shape of the defect the manual route had. Here it is survivable, and it is
  // worth writing down WHY, because the reason lives two hundred lines away and in a database
  // index rather than in this function:
  //
  //   · the tier is chosen by AGE, not from the trail — reminderTierDue() takes the highest offset
  //     the invoice has reached, so an empty trail cannot escalate anyone early;
  //   · the send is CLAIM-THEN-SEND on UNIQUE(invoice_id, day_offset) with ignoreDuplicates, and an
  //     empty claim result means "already sent, do not send".
  //
  // So a re-send of a tier already sent is refused by the index, not by this read. The manual route
  // has no such backstop — its offset is DERIVED from the trail (nextManualOffset), so an empty
  // trail hands it a free number and the mail goes out. That is why the fix lives there and this
  // stays as it is. If the claim below ever loses ignoreDuplicates or its onConflict, this line
  // becomes a double-dunning bug the same afternoon — which is what the gate pins.

  // ── [CREDITNOTA-NO-CHASE] Which candidates were withdrawn with a creditnota? ──
  // A credited invoice KEEPS its 'sent'/'overdue' status, its positive total and its due date
  // (the +omzet must stay to be netted by the creditnota's −omzet), so nothing the query above
  // filters on reveals it. Without this read the cron mails the customer a payment demand for
  // an invoice the owner already withdrew.
  //
  // This read FAILS CLOSED. Degrading to "none credited" would quietly restore the exact
  // behaviour this guard exists to prevent — an automated demand sent to someone else's
  // customer — and nobody would know. A skipped run costs at most a day: the schedule is daily,
  // the tiers are day-offset based, and every tier is claimed idempotently, so tomorrow's run
  // sends precisely what today's would have.
  // Keyed on the OWNERS (the same bounded list the candidate query uses), not on the candidate
  // ids: an .in() over thousands of uuids would blow the URL length long before it broke
  // anything visible. A creditnota per owner is rare, so this stays a small read.
  // [ID-CHUNK] Same reason as the candidate query above — and it matters more here, because this
  // read is what stops a credited invoice being dunned. It already fails CLOSED on an error (see
  // below), so a URL that grew too long would silently halt every reminder rather than send a wrong
  // one; correct, and still a nightly outage nobody would notice.
  const creditNoteRows = await fetchAllRowsForIds<{ original_invoice_id: string | null; total_inc_btw: number | null }, string>(ownerIds, (chunk, from, to) =>
    pipeline
      .from("invoices")
      // [DEEL-CREDIT] The AMOUNT comes along: whether an invoice was withdrawn is no longer
      // answered by the existence of a creditnota but by whether the credits cover it.
      .select("original_invoice_id, total_inc_btw")
      .in("sender_id", chunk)
      .eq("invoice_type", "creditnota")
      .not("original_invoice_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    console.error("[CRON-REMINDERS] creditnota lookup failed — skipping this run", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  });
  if (creditNoteRows == null) {
    // Fail closed: send nothing rather than risk one wrong demand. Tomorrow's run repeats it.
    // Bewust niets verstuurd — maar de run deed zijn werk niet, dus zegt de regel dat ook.
    return klaar({ ok: false, enabledOwners: owners.length, sent: 0, skipped: "creditnota_lookup_failed" }, false);
  }
  const creditedByInvoice = creditedTotalsFrom(creditNoteRows);

  const sentByInvoice = new Map<string, number[]>();
  for (const r of sentRows) {
    const arr = sentByInvoice.get(r.invoice_id) ?? [];
    arr.push(r.day_offset);
    sentByInvoice.set(r.invoice_id, arr);
  }

  // Group candidate invoices by owner so we can rotate fairly across owners.
  const invoicesByOwner = new Map<string, CandidateInvoice[]>();
  for (const inv of invoices) {
    if (!inv.sender_id) continue;
    const arr = invoicesByOwner.get(inv.sender_id) ?? [];
    arr.push(inv);
    invoicesByOwner.set(inv.sender_id, arr);
  }

  // ── 4) Fairness rotation + soft deadline (same discipline as reconcile). ──
  const orderedOwners = [...invoicesByOwner.keys()];
  const epochHour = Math.floor(Date.now() / 3_600_000);
  const offset = orderedOwners.length > 0 ? epochHour % orderedOwners.length : 0;
  const rotated = [...orderedOwners.slice(offset), ...orderedOwners.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000; // stop ~50s before the 300s ceiling, between owners

  let sent = 0;
  let failed = 0;
  let skippedDuplicate = 0;
  // [HERINNER-BEWIJS] Two different holds, counted apart: `bankHeld` is "the bank says this may
  // already be paid" (a finding), `bankCheckHeld` is "we could not look" (an outage). Collapsing
  // them would hide a broken read inside a number that looks like the guard working.
  let bankHeld = 0;
  let bankCheckHeld = 0;
  let ownersProcessed = 0;
  let truncated = 0;

  for (const ownerId of rotated) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = rotated.length - ownersProcessed;
      console.warn("[CRON-REMINDERS] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    ownersProcessed += 1;

    const owner = ownerById.get(ownerId);
    if (!owner) continue;
    const offsets = owner.reminder_offsets && owner.reminder_offsets.length > 0
      ? owner.reminder_offsets
      : [14, 30];
    // [HERINNER-AAN] Eén keer per eigenaar: sinds wanneer mag er gejaagd worden, als day-number.
    // Null/ontbrekend → geen rem, precies het gedrag van vóór deze kolom bestond.
    const activeSinceDay = dayNumberFromIso(
      typeof owner.reminders_enabled_at === "string" ? owner.reminders_enabled_at.slice(0, 10) : null,
    );
    const maxTier = Math.max(...offsets);
    const zzperName = owner.company_name?.trim() || owner.full_name?.trim() || "BoekBrug";
    const ownerInvoices = invoicesByOwner.get(ownerId) ?? [];

    // ── [WIK-EEN-AANMANING] One aanmaning per DEBTOR, not per invoice ──
    //
    // Art. 6:96 lid 7 BW: where a debtor can be aanmaand for several claims, that happens in ONE
    // aanmaning with the hoofdsommen added together — and the staffel of lid 6, with its EUR 40
    // minimum, is then applied once. This loop sent a letter per invoice, each naming its own fee:
    // three EUR 100 invoices demanded 3 x EUR 40 instead of EUR 40. For a consumer lid 5 makes
    // that dwingend recht, and an over-stated fee is the classic ground on which the whole
    // incassokosten claim is struck — so the owner does not lose the difference, they lose the lot.
    //
    // Keyed on the e-mail address, because that is who actually receives the letter; the name is
    // the fallback for a debtor without one. Two customers sharing one mailbox genuinely receive
    // one demand, which is what art. 6:96 lid 7 asks for.
    const debiteurSleutel = (i: { client_email?: string | null; client_name?: string | null }) =>
      (i.client_email?.trim().toLowerCase() || i.client_name?.trim().toLowerCase() || "");
    const openstaandVan = (i: { total_inc_btw?: number | null; amount_paid?: number | null; id: string }) =>
      openAfterCredit(i.total_inc_btw, i.amount_paid, creditedByInvoice.get(i.id) ?? 0);
    // Which debtors already received THE letter in this run. The second final-tier invoice of the
    // same debtor still gets its ordinary reminder and its trail row — it simply does not carry a
    // second statutory demand, because the first one already covered it by name.
    const aangemaand = new Set<string>();

    // ── [HERINNER-BEWIJS] Nobody is watching this run ──────────────────────────────────────
    //
    // Every check above asks the BOOKS whether the invoice is open — status, amount_paid, the
    // creditnota's — and all three answer "open" for the one case that costs the most: the customer
    // paid, the bank line arrived, and nothing has attached it to the invoice yet. The books cannot
    // see that, so nothing here could, and the letter went out to somebody who owes nothing.
    //
    // On the manual button that is a bad moment. Here it is worse, because on the final tier this
    // cron does not send a nudge — it sends the statutory aanmaning that makes incassokosten
    // claimable (art. 6:96 BW), at a customer who paid three weeks ago, with no human in the loop
    // to notice.
    //
    // The tiers are computed first so the read below only happens for owners who are actually about
    // to send something, and so the LOOP and the CHECK can never disagree about which invoices are
    // in play.
    const tierByInvoice = new Map<string, number>();
    for (const inv of ownerInvoices) {
      const tier = reminderTierDue({
        dueDate: inv.due_date,
        todayDayNumber: today,
        offsets,
        sentOffsets: sentByInvoice.get(inv.id) ?? [],
        status: inv.status,
        invoiceType: inv.invoice_type,
        direction: "outgoing",
        totalIncBtw: inv.total_inc_btw,
        amountPaid: inv.amount_paid,
        clientEmail: inv.client_email,
        remindersPaused: false,
        // [HERINNER-AAN] De rem. Facturen die vervielen vóórdat deze eigenaar herinneringen
        // aanzette blijven met rust — zie invoice-reminders.ts. Ontbreekt de kolom nog (migratie
        // niet toegepast), dan is dit undefined en gedraagt de cron zich als voorheen.
        remindersActiveSinceDay: activeSinceDay,
        // [CREDITNOTA-NO-CHASE] Withdrawn with a creditnota → stop chasing the customer.
        // [DEEL-CREDIT] …but only when the credits cover the WHOLE invoice. Credit one disputed
        // line of five and the other four are still owed; stopping there would mean the owner is
        // never paid for them, on an invoice that keeps its 'sent' status and its full total, with
        // nothing on any screen saying why the reminders went quiet.
        hasCreditnota: openAfterCredit(inv.total_inc_btw, 0, creditedByInvoice.get(inv.id) ?? 0) <= 0,
      });
      if (tier != null) tierByInvoice.set(inv.id, tier);
    }

    // What the bank says about exactly those invoices. One read per owner, and only when there is
    // something to send.
    const bankHitById = new Map<string, string>();
    if (tierByInvoice.size > 0) {
      const bewijs = await collectOpenInvoiceProof({
        pipeline, ownerId, direction: "outgoing", invoiceIds: [...tierByInvoice.keys()],
      }).catch((e) => {
        console.error("[HERINNER-BEWIJS] bankcontrole mislukt", { ownerId, error: e instanceof Error ? e.message : String(e) });
        return null;
      });
      if (!bewijs || bewijs.readFailed) {
        // FAIL CLOSED, per owner — the same trade the creditnota guard already makes in this file,
        // and for the same reason: a held reminder costs a day (the schedule is daily and every
        // tier is claimed idempotently, so tomorrow's run sends exactly what today's would have),
        // while a wrong aanmaning costs a customer.
        //
        // Held, but never silently. The owner is the one who can act on it, and a cron that quietly
        // stops chasing money is indistinguishable from one that is broken.
        bankCheckHeld += tierByInvoice.size;
        console.warn("[HERINNER-BEWIJS] herinneringen aangehouden — bank niet te vergelijken", {
          ownerId, invoices: tierByInvoice.size,
        });
        // [TAAL-DB] Notification text is stored in the database and read back as data — Dutch, like
        // every other notification this app writes.
        await createNotification({
          userId: ownerId,
          title: "Herinneringen even niet verstuurd",
          body: `We konden ${tierByInvoice.size === 1 ? "1 factuur" : `${tierByInvoice.size} facturen`} niet met je bank vergelijken, dus hebben we vandaag geen herinnering gestuurd. Morgen proberen we het opnieuw — of stuur hem zelf vanaf Verkoop.`,
          type: "invoice",
          link: "/dashboard/verkoop",
        }).catch(() => {});
        continue;
      }
      for (const h of bewijs.hits) bankHitById.set(h.invoiceId, describeHit(h, "outgoing"));
    }

    // The claims that go INTO the statutory demand — built here, after the bank check, and never
    // before it.
    //
    // Art. 6:96 lid 7 adds one debtor's hoofdsommen into a single aanmaning, and lid 6 applies the
    // staffel once over that total. An invoice we are holding because its payment may already be
    // in the bank must therefore not be in the sum: it would overstate the hoofdsom, and an
    // over-stated fee is the classic ground on which the WHOLE incassokosten claim is struck — the
    // owner does not lose the difference, they lose the lot. For a consumer lid 5 makes that
    // dwingend recht.
    //
    // This is the second-order mistake the guard itself could have caused: invoice A is held, and
    // its amount rides into the demand for invoice B of the same debtor anyway.
    //
    // ── [WIK-VORDERING] Two things that are not claims, and were in the sum ─────────────────
    //
    // `ownerInvoices` is the CANDIDATE set — every outgoing invoice of this owner that is 'sent'
    // or 'overdue', not paused, with a due date. That is deliberately wider than the set that may
    // be demanded, because reminderTierDue narrows it afterwards. This loop did not narrow it at
    // all, so two kinds of row walked into the statutory hoofdsom:
    //
    //   1. A CREDITNOTA. It is an outgoing document with status 'sent' and a NEGATIVE total, and
    //      openAfterCredit takes the MAGNITUDE — so a € 500 credit the owner issued to settle a
    //      dispute was added to the demand as € 500 the customer owes. The exact opposite of what
    //      the document says, in a letter that names the amount.
    //   2. AN INVOICE THAT IS NOT YET DUE. Nothing here looked at the due date, so a € 2.000
    //      invoice payable next month was demanded today, "binnen 14 dagen", alongside the one
    //      that really is overdue.
    //
    // What that costs is not the difference. Art. 6:96 lid 6 BW applies the staffel once over the
    // debtor's total hoofdsom, and an aanmaning that OVERSTATES the hoofdsom is the standard ground
    // on which the whole incassokosten claim is struck — for a consumer lid 5 makes that dwingend
    // recht. So the owner does not lose the excess, they lose the entire fee, and they have sent a
    // demand for money that is not owed, by e-mail, in their own name, with no human in the loop.
    //
    // The narrowing below is the eligibility the tier engine already applies, restated in the two
    // places it is load-bearing for the SUM rather than for the sending. It is deliberately not a
    // call to reminderTierDue: that answers "is a letter due TODAY", and an invoice twenty days
    // overdue on a non-offset day is still perfectly good hoofdsom.
    const claimsPerDebiteur = new Map<string, Array<{ invoiceNumber: string | null; open: number }>>();
    for (const i of ownerInvoices) {
      if (bankHitById.has(i.id)) continue;
      const open = openstaandVan(i);
      // [WIK-VORDERING] The pure rule, in incasso.ts beside the staffel it feeds — because what may
      // stand in a statutory demand is a legal question, and it is worth asserting without a
      // database. A creditnota and an invoice that is not yet due are both refused there.
      if (!claimableForWik({
        invoiceType: i.invoice_type,
        dueDayNumber: dayNumberFromIso(i.due_date),
        todayDayNumber: today,
        open,
      })) continue;
      const k = debiteurSleutel(i);
      if (k === "") continue;
      const list = claimsPerDebiteur.get(k);
      if (list) list.push({ invoiceNumber: i.invoice_number, open });
      else claimsPerDebiteur.set(k, [{ invoiceNumber: i.invoice_number, open }]);
    }

    for (const inv of ownerInvoices) {
      // The pure decision, taken once above and read here. It used to be computed inside this loop;
      // the bank check needs the SAME answer a moment earlier, and two calls to a pure function
      // with the same inputs is one call too many to keep honest — the day somebody adds an
      // argument to one of them, the guard and the send disagree about which invoices are in play.
      const tier = tierByInvoice.get(inv.id);
      if (tier == null) continue;

      // [HERINNER-BEWIJS] A payment that looks like this invoice is sitting unattached in the bank.
      // The tier is NOT claimed — claiming it here would burn the reminder on a letter nobody sent,
      // and the invoice would then age silently toward the next tier having never been chased.
      const bankRegel = bankHitById.get(inv.id);
      if (bankRegel) {
        bankHeld += 1;
        console.warn("[HERINNER-BEWIJS] herinnering aangehouden — betaling lijkt al binnen", { invoiceId: inv.id, tier });
        // Told ONCE, on the day the reminder would have gone out — and then held quietly.
        //
        // The tier is deliberately not claimed, so it stays due every day until the owner attaches
        // the bank line. A notification per day would be the app nagging about its own uncertainty:
        // one stray unreconciled payment from a monthly customer would produce a message every
        // morning for as long as it sits there, and a daily message is one nobody reads by week two.
        //
        // The information is not lost by going quiet — the [OPENSTAAND-BEWIJS] panel on the sales
        // list states this same finding every time the owner opens the screen. The INTERRUPTION
        // happens once; the STANDING state is on the screen. (The outage branch above does repeat,
        // and should: there the reminders have stopped and nothing on any screen says so.)
        const dueDay = dayNumberFromIso(inv.due_date);
        if (dueDay != null && dueDay + tier === today) {
          // [TAAL-DB] Stored notification text — data, Dutch like every other one in this app. It
          // names the bank line, because "we hebben iets niet gedaan" without the evidence is a
          // message the owner cannot act on.
          await createNotification({
            userId: ownerId,
            title: "Herinnering niet verstuurd — betaling lijkt al binnen",
            body: `Factuur ${inv.invoice_number?.trim() || "—"} aan ${inv.client_name?.trim() || "je klant"} staat nog open, maar in je bank staat ${bankRegel}. Koppel die betaling bij Bank, of stuur de herinnering zelf vanaf Verkoop.`,
            type: "invoice",
            link: "/dashboard/bank",
          }).catch(() => {});
        }
        continue;
      }

      // CLAIM the tier atomically. ignoreDuplicates → an empty result means a
      // concurrent run already claimed it, so we send NOTHING (no double dunning).
      const { data: claimed, error: claimError } = await pipeline
        .from("invoice_reminders")
        .upsert(
          {
            invoice_id: inv.id,
            user_id: ownerId,
            day_offset: tier,
            email_to: inv.client_email,
            status: "sent",
          },
          { onConflict: "invoice_id,day_offset", ignoreDuplicates: true },
        )
        .select("id");

      if (claimError) {
        console.error("[CRON-REMINDERS] claim insert failed (non-fatal)", { invoiceId: inv.id, tier, error: claimError.message });
        failed += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        skippedDuplicate += 1; // already claimed by another run — do not send
        continue;
      }
      const claimId = claimed[0].id as string;

      // The ONLY amount a reminder may show — remaining, never the full total.
      // [DEEL-CREDIT] Minus what was credited. Asking for the full total on a partly credited
      // invoice demands money that was given back IN WRITING — the fastest way to lose the trust
      // a reminder needs in order to work at all.
      const gecrediteerd = creditedByInvoice.get(inv.id) ?? 0;
      const openstaand = gecrediteerd > 0
        ? openAfterCredit(inv.total_inc_btw, inv.amount_paid, gecrediteerd)
        : openstaandOf(inv.total_inc_btw, inv.amount_paid);
      // [REMINDER-TRUTH] Hoisted out of the try: the catch has to know whether the letter that
      // just failed was the statutory one, and `wik` itself is built inside.
      const finalTier = isFinalTier(tier, offsets);

      // Best-effort PDF re-attach from the stored invoice PDF. Any failure →
      // send without attachment (the template renders fine without it).
      let pdfBuffer: Buffer | undefined;
      // [SEC-STORAGE-PATH] The invoice row is this owner's, which says nothing about where its
      // pdf_url POINTS: that column is ordinary text on a row the owner may update, and `pipeline`
      // is service_role, which bypasses the bucket policy that would otherwise catch a key from
      // another tenant's folder. This attachment is then mailed to an address the same row carries.
      // See the header of storage-path.ts — written for this shape, already applied at four doors.
      const pdfPath = toStoragePath(inv.pdf_url);
      if (inv.pdf_url && pathBelongsToOwner(pdfPath, ownerId)) {
        try {
          const { data: blob } = await getOriginal(pipeline, pdfPath);
          if (blob) pdfBuffer = Buffer.from(await blob.arrayBuffer());
        } catch {
          /* non-blocking — reminder goes out without the PDF */
        }
      }

      try {
        // [WIK] On the LAST tier the letter becomes the legally effective one: it grants the
        // statutory fourteen days and names the exact incassokosten. Without those two elements
        // a consumer can never be charged those costs — so every polite reminder this app sent
        // before was helpful and legally worth nothing once the customer kept ignoring it. The
        // debtor type comes from the invoice itself (a BTW number means a business), defaulting
        // to consumer, which is the only mistake of the two that stays recoverable.
        // [WIK-EEN-AANMANING] The hoofdsom is this DEBTOR's total, not this invoice's, and the
        // letter names the invoices it adds up. A debtor who already had their one demand in this
        // run gets a plain reminder instead of a second one — see the grouping above.
        const debiteur = debiteurSleutel(inv);
        const samen = aggregateWikClaims(claimsPerDebiteur.get(debiteur) ?? []);
        const wik = finalTier && debiteur !== "" && !aangemaand.has(debiteur)
          ? buildWikNotice({
              // Falls back to this invoice alone when the grouping found nothing — a debtor with
              // no e-mail and no name cannot be grouped, and one claim is still a claim.
              openstaand: samen.principal > 0 ? samen.principal : openstaand,
              sentIso: amsterdamToday(),
              debtorType: debtorTypeOf({ client_btw_number: inv.client_btw_number }),
              covers: samen.numbers.length > 1 ? samen.numbers : [],
            })
          : null;
        if (wik) aangemaand.add(debiteur);
        // [BETAALBLOK] Waar het geld heen moet — tot nu toe stond dat in geen enkele herinnering.
        // Een aanmaning die incassokosten aankondigt en niet zegt waarheen over te maken levert
        // een telefoontje op, geen betaling. `openstaand` is hier al berekend en is precies het
        // bedrag dat boven in de mail staat, dus het blok kan nooit een ander bedrag noemen dan de
        // regel erboven. Faalt dit (geen IBAN, leesfout), dan is het blok null en gaat de
        // herinnering uit zoals hij altijd al ging.
        const payBlok = await payBlockForInvoice(pipeline, {
          invoice: {
            id: inv.id,
            direction: "outgoing",
            invoice_type: inv.invoice_type,
            status: inv.status,
            invoice_number: inv.invoice_number,
            payment_reference: inv.payment_reference,
            total_inc_btw: inv.total_inc_btw,
            amount_paid: inv.amount_paid,
            client_name: inv.client_name,
            pay_token: inv.pay_token,
            due_date: inv.due_date,
          },
          owner: {
            iban: owner.iban,
            company_name: owner.company_name,
            full_name: owner.full_name,
          },
          ownerId,
          openstaand,
        });
        const delivery = await sendInvoiceReminder({
          toEmail: inv.client_email as string, // guaranteed non-empty by reminderTierDue
          clientName: inv.client_name?.trim() || "klant",
          zzperName,
          senderEmail: owner.email ?? null,
          invoiceNumber: inv.invoice_number?.trim() || "—",
          openstaand,
          dueDate: inv.due_date as string,
          firm: offsets.length > 1 && tier === maxTier,
          wik,
          pdfBuffer,
          payBlock: payBlok,
        });
        // [REMINDER-TRUTH] A Resend rejection does not throw — it comes back as an error on the
        // send result. Until now that was logged and forgotten: the claimed tier stayed 'sent',
        // the owner was told the letter went out, and the tier could never be tried again (the
        // pre-read counts every invoice_reminders row, whatever its status). The customer simply
        // never received it — including, on the last tier, the statutory WIK aanmaning that is
        // the whole basis for charging incassokosten.
        //
        // Resend rejecting the message means it was NOT accepted, so retrying is safe here in a
        // way it is not after a THROW (see the catch below, where the outcome is unknowable).
        // Releasing the claim lets tomorrow's run try the same tier again.
        if (!delivery.delivered) {
          failed += 1;
          // [LINKS-WRITE-HONEST] The error is READ. This block already meant to say something when
          // the release failed — and could not: supabase-js reports a query error in the RESULT, it
          // does not throw, so that catch never fired and the delete's error was discarded. The
          // release silently not happening puts this invoice back in exactly the state the comment
          // above describes as the bug being fixed: the claim stays, the pre-read counts every
          // invoice_reminders row whatever its status, and the tier can NEVER be tried again. On
          // the last tier that is the statutory WIK aanmaning never reaching the customer while the
          // owner believes it went out — and with it the basis for charging incassokosten.
          const { error: releaseErr } = await pipeline
            .from("invoice_reminders").delete().eq("id", claimId);
          if (releaseErr) {
            console.error(
              "[CRON-REMINDERS] could NOT release a rejected claim — this tier can never be retried",
              { invoiceId: inv.id, tier, finalTier, error: releaseErr.message },
            );
          }
          console.error("[CRON-REMINDERS] reminder rejected by the mail provider — tier released for retry", {
            invoiceId: inv.id, tier, wik: !!wik,
          });
          continue;
        }

        sent += 1;
        // Reflect the send in the pre-read map so a later pass in THIS run can't re-pick it.
        const arr = sentByInvoice.get(inv.id) ?? [];
        arr.push(tier);
        sentByInvoice.set(inv.id, arr);

        // Notify the owner (best-effort) — visible proof the app acted for them.
        // [WIK] After the statutory letter the owner has something they did not have before:
        // the RIGHT to charge collection costs once the term passes. That right is invisible
        // unless it is said — and unsaid, the letter's whole purpose is lost on them.
        await createNotification({
          userId: ownerId,
          title: wik ? "Laatste aanmaning verstuurd" : "Herinnering verstuurd",
          body: wik
            ? `We hebben de laatste aanmaning gestuurd voor factuur ${inv.invoice_number ?? ""} aan ${inv.client_name ?? "je klant"}. ` +
              `Betaalt ${inv.client_name?.trim() || "je klant"} niet vóór ${formatDayNL(wik.deadline)}, dan mag je ${formatEuroNL(wik.costs)} aan incassokosten in rekening brengen.`
            : `We hebben een herinnering gestuurd voor factuur ${inv.invoice_number ?? ""} aan ${inv.client_name ?? "je klant"}.`,
          type: "invoice",
          link: `/dashboard/invoice/${inv.id}`,
        });
      } catch (sendErr) {
        // A THROW is the ambiguous case: the request may have reached the provider before the
        // connection died, so we cannot know whether the customer got a demand. The claim STAYS
        // (marked 'failed') and is never retried — a second dunning letter to someone who already
        // received one is the harm this cron must never cause.
        //
        // [REMINDER-TRUTH] But silence is its own harm. The app cannot resolve this, so it hands
        // it to the person who can: the owner is told the reminder may not have gone out, which
        // matters most on the final tier, where the letter is what makes incassokosten claimable.
        failed += 1;
        console.error("[CRON-REMINDERS] reminder send threw (non-fatal)", { invoiceId: inv.id, tier, error: sendErr instanceof Error ? sendErr.message : String(sendErr) });
        // [LINKS-WRITE-HONEST] The error is READ, same reason. invoice_reminders IS the send log:
        // a claim left on 'sent' after a send that may never have happened records a dunning letter
        // that was not demonstrably sent — and on the final tier that log is the basis on which
        // incassokosten are claimed. The tier stays unretryable either way (that is deliberate
        // after a throw: a second letter to someone who already got one is the worse harm), so
        // this failure costs the RECORD rather than the send, which is exactly why it may not
        // disappear.
        const { error: markErr } = await pipeline
          .from("invoice_reminders").update({ status: "failed" }).eq("id", claimId);
        if (markErr) {
          console.error(
            "[CRON-REMINDERS] could NOT mark a claim failed — the send log still reads 'sent'",
            { invoiceId: inv.id, tier, finalTier, error: markErr.message },
          );
        }
        await createNotification({
          userId: ownerId,
          title: finalTier ? "Laatste aanmaning mogelijk NIET verstuurd" : "Herinnering mogelijk niet verstuurd",
          body:
            `Het versturen van ${finalTier ? "de laatste aanmaning" : "een herinnering"} voor factuur ${inv.invoice_number ?? ""} ` +
            `aan ${inv.client_name ?? "je klant"} is misgegaan. We proberen het niet automatisch opnieuw — een dubbele ` +
            `aanmaning naar iemand die er al een kreeg is erger. ` +
            (finalTier
              ? "Let op: zonder deze aanmaning mag je (nog) geen incassokosten in rekening brengen. Stuur hem zelf, of neem contact op."
              : "Stuur hem zelf als je dat wilt."),
          type: "invoice",
          link: `/dashboard/invoice/${inv.id}`,
        });
      }
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: failed === 0, result: {
    ok: failed === 0,
    enabledOwners: owners.length,
    candidates: invoices.length,
    sent,
    failed,
    skippedDuplicate,
    // [HERINNER-BEWIJS] Both holds reach the run record, so a guard that starts firing on
    // everything — or a bank read that has quietly been failing for a week — is visible in
    // /dashboard/waarheid instead of only in a log nobody opens.
    bankHeld,
    bankCheckHeld,
    ownersProcessed,
    truncated,
  } });

  return NextResponse.json({
    ok: true,
    enabledOwners: owners.length,
    candidates: invoices.length,
    sent,
    failed,
    skippedDuplicate,
    // [HERINNER-BEWIJS] Both holds reach the run record, so a guard that starts firing on
    // everything — or a bank read that has quietly been failing for a week — is visible in
    // /dashboard/waarheid instead of only in a log nobody opens.
    bankHeld,
    bankCheckHeld,
    ownersProcessed,
    truncated,
  });
}
