// src/app/dashboard/vandaag/page.tsx
// [TODAY-LISTS-V1] "Vandaag" — server component.
//
// Surfaces TASKS, not numbers. Two lists only (v1):
//   1. Te betalen        — incoming invoices you must pay      (direction='incoming', status='received')
//   2. Herinner je klant — outgoing invoices a client must pay (direction='outgoing', status IN ('sent','overdue'))
//
// GOVERNING PRINCIPLE (updated by owner decision — TODAY-UX-FIELDS): the card
// now shows the stored total alongside dates + invoice number, to act as a real
// daily control center. The amount is READ DIRECTLY from total_inc_btw — never
// computed, summed, or derived in "Vandaag". This is the same trusted number the
// invoices page shows; displaying a stored value is an honest read, not the kind
// of arithmetic claim the no-amount rule originally guarded against.
//
// Payment state is defined by `status` ONLY — never payment_date/marked_paid_at
// (the live data proved they disagree: paid invoices exist with no payment_date).
//
// This page READS only. The single in-screen action is "Negeren" (session-only,
// visual, no DB) handled in the client. Any real action (pay, mark-as-paid, QR)
// jumps to the invoice page where that logic already lives — one source, no copy.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/session-user";
import VandaagClient, { type VandaagInvoice } from "./VandaagClient";
// [CREDITNOTA-NO-CHASE] shared "is this still owed to me" rule — both sides of a credited pair
// must leave the list together (see src/lib/credited-invoices.ts)
import { fullyCreditedIdsFrom, filterOpenReceivables, refundableCreditnotas, type RefundOriginalRow } from "@/lib/credited-invoices";
// [PAGINATION] Past PostgREST's silent ~1000-row cap — see the creditnota read below.
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
// [AUTO-INCASSO] The same normalized supplier key the registry stores — see src/lib/auto-incasso.ts.
import { supplierNameKey } from "@/lib/supplier-registry";
// [OFFERTE-OPVOLGING] Welke offerte vandaag aandacht vraagt — één regel, zie dat bestand.
import { quotesNeedingFollowup } from "@/lib/offerte-followup";
import { amsterdamToday } from "@/lib/format-nl";
import { SELF_ACTIONS, HAND_ACTIONS } from "@/lib/zelfstandig";
// [WERK] The trade's own work counts: what is ready to invoice, what waits.
import { workSkin, type workCounts, type WorkSignal } from "@/lib/werk";
import { loadWorkStand } from "@/lib/werk-stand";

/** [ZIEL] Seven days back, as ISO. A function, so the page component itself calls no clock in render. */
function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

export const dynamic = "force-dynamic";

// [TODAY-UX-FIELDS] Per owner decision, the card now shows the invoice number,
// invoice date, due date, and the STORED total (total_inc_btw). The amount is
// READ DIRECTLY from the DB column — never computed/derived in "Vandaag" — so it
// is the same trusted number shown on the invoices page, not an arithmetic claim.
const SELECT =
  // [PARTIAL-PAY] amount_paid so a deelbetaling shows the REMAINING openstaand, not the full total.
  // [CREDITNOTA-NO-CHASE] invoice_type so a creditnota can be recognised: it is ALSO outgoing +
  // 'sent' and would otherwise sit in "Herinner je klant" as a negative amount to chase.
  "id, client_name, invoice_number, invoice_date, due_date, total_inc_btw, amount_paid, status, direction, invoice_type, offerte_response";

export default async function VandaagPage() {
  const supabase = await createServerSupabaseClient();

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();

  if (!user) redirect("/login");

  // ── [WATERVAL] Zes lezingen die niets van elkaar willen weten ───────────────────
  //
  // Dit is het scherm waar de ondernemer na het inloggen op landt, en het wachtte zes keer na
  // elkaar op de database voordat er iets te zien was. Niet omdat de tweede de eerste nodig had —
  // alle zes kennen alleen user.id — maar omdat een `await` op de regel eronder nu eenmaal wacht.
  //
  // Daarom staat er hieronder geen `await` meer voor de query's zelf: een Supabase-query is pas
  // een verzoek op het moment dat er iets op wacht. Zolang niemand dat doet is het een BESCHRIJVING
  // van een verzoek, en die kun je met z'n zessen tegelijk de deur uit doen (de Promise.all
  // verderop). Geen enkele query verandert daardoor, geen enkele filterregel verschuift, en elke
  // toelichting blijft staan bij wat hij toelicht — alleen de volgorde van het WACHTEN verandert.
  //
  // Wat er NIET in meegaat: de creditnota-lezing verderop. Die is gepagineerd (fetchAllRows) en
  // dus geen enkele query maar een reeks, en [CREDIT-TERUG] leest daarna nog de facturen die de
  // creditnota's corrigeren — een tweede stap die pas kan als de eerste binnen is.

  // [TODAY-LISTS-V1] List 1 — Te betalen: incoming invoices verified but unpaid.
  // status='received' = verified Crediteur awaiting payment (NOT 'processing',
  // which is still in the verification queue; NOT 'paid'). Payment state = status.
  const payableQ = supabase
    .from("invoices")
    .select(SELECT)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(100);

  // [TODAY-LISTS-V1] List 2 — Herinner je klant: outgoing invoices sent but unpaid.
  // status IN ('sent','overdue') — 'overdue' included defensively; if the app never
  // promotes sent→overdue automatically it simply matches nothing extra (safe).
  const remindQ = supabase
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"])
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(100);

  // [OFFERTE-OPVOLGING] List 3 — offertes die verlopen.
  //
  // "Geldig tot" staat op elke offerte-PDF en niets in de app wist ervan: geen badge, geen filter,
  // geen signaal, en de herinneringscron sluit offertes uit. Een offerte die stil verloopt is
  // omzet die nooit is opgehaald — en het is de goedkoopste omzet die er is, want het werk om
  // hem te winnen is al gedaan.
  //
  // Alleen VERSTUURDE offertes: een concept is nooit de deur uit geweest. Welke van deze rijen
  // vandaag aandacht vragen, beslist offerte-followup.ts — hier wordt niets gefilterd op datum,
  // zodat de regel op één plek staat en niet half in een query.
  const offertesQ = supabase
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("invoice_type", ["pro_forma", "offerte"])
    .eq("status", "sent")
    // [OFFERTE-AKKOORD] GEEN filter op due_date: een geaccepteerde offerte hoort op de lijst ook
    // zonder geldigheidsdatum — het antwoord van de klant zet hem daar, niet de datum. Wat er
    // overblijft beslist offerte-followup.ts, op één plek.
    .order("due_date", { ascending: true })
    .limit(100);

  // [P1-STUCK-PROCESSING] Incoming invoices sitting in the verify queue (status='processing')
  // — imported/photographed but not yet verified. A clean high-confidence one is auto-advanced
  // to 'received'; the AMBIGUOUS / low-confidence ones stay here, and with no reminder they rot
  // silently — their voorbelasting (BTW-aftrek) and cost never reach the books. Surface the count
  // on the daily control center so the owner is nudged to clear them. Head-count only (no rows).
  const toVerifyQ = supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "processing");

  // [DATELESS-TASK] A confirmed incoming bill with NO due date is excluded from the "Te betalen"
  // list above (it filters `due_date IS NOT NULL` to date-sort). So a real cost the owner still
  // owes appears on NO task list and can be silently forgotten. Surface a count nudge here so it is
  // never invisible — the owner opens it to add a date / pay. Head-count only (no rows).
  const datelessQ = supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .is("due_date", null)
    // Exclude incoming credit notes (NEGATIVE total): they REDUCE what's owed, so "controleer of
    // betaal" would mislabel them. Mirrors the InvoiceCard isCredit rule. A NULL total is NOT a
    // creditnota — it's a real dateless bill whose amount wasn't read — so keep it counted; a
    // plain `.gte(total,0)` dropped it (SQL: NULL >= 0 → NULL) and hid a genuine payable.
    .or("total_inc_btw.gte.0,total_inc_btw.is.null");

  // [AUTO-INCASSO] De leverancierslezing hoort bij de golf, de BEOORDELING ervan blijft staan waar
  // hij hoort (hieronder, bij de lijst die hij filtert). Hij vangt zijn eigen fout af — anders zou
  // één hikkende leverancierslezing de hele pagina omvertrekken, terwijl het blok hieronder er juist
  // op rekent dat het die fout zelf mag afhandelen en de lijst ongemoeid laat.
  //
  // auto_incasso is added by auto_incasso.sql and not yet in the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incassoQ = (supabase as any)
    .from("suppliers")
    .select("name_key")
    .eq("user_id", user.id)
    .eq("auto_incasso", true)
    .then(
      (r: { data: unknown; error: unknown }) => r,
      (e: unknown) => ({ data: null, error: e }),
    ) as Promise<{ data: { name_key: string | null }[] | null; error: unknown }>;

  // [ZIEL] What BoekBrug did by itself this week, and what waits for the owner — measured on the
  // audit trail (what HAPPENED), never on what a screen claims. Head counts only. A failed read
  // leaves the line off the screen: a made-up share on a money screen is worse than none.
  const weekAgo = weekAgoIso();
  const selfQ = supabase.from("audit_logs").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("action", [...SELF_ACTIONS]).gte("created_at", weekAgo);
  const handQ = supabase.from("audit_logs").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("action", [...HAND_ACTIONS]).gte("created_at", weekAgo);
  const pendingBankQ = supabase.from("bank_transactions").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("status", "pending");

  // [WERK] Read apart and in a try, like the vak read on the home: a missing column or table must
  // cost one sentence, never the screen.
  let werk: { pluralKey: string; counts: ReturnType<typeof workCounts>; signals: WorkSignal[] } | null = null;
  try {
    const { data: vakRow } = await supabase.from("profiles").select("vak").eq("id", user.id).maybeSingle();
    const skin = workSkin((vakRow as { vak?: string | null } | null)?.vak);
    if (skin) {
      // [WERK-STAND] The same reads the Werk screen opens on — one module, werk-stand.ts.
      werk = await loadWorkStand(supabase, user.id, skin, amsterdamToday());
    }
  } catch { /* no work layer on this deployment → no sentence */ }

  const [
    { data: payableRaw, error: payableErr },
    { data: remindRaw, error: remindErr },
    { data: offertesRaw, error: offertesErr },
    { count: toVerifyCount, error: toVerifyErr },
    { count: datelessPayableCount, error: datelessErr },
    incassoRes,
    selfRes,
    handRes,
    pendingBankRes,
  ] = await Promise.all([payableQ, remindQ, offertesQ, toVerifyQ, datelessQ, incassoQ, selfQ, handQ, pendingBankQ]);
  const zelf = selfRes.error || handRes.error || pendingBankRes.error
    ? null
    : { self: selfRes.count ?? 0, hand: handRes.count ?? 0, waiting: (toVerifyCount ?? 0) + (pendingBankRes.count ?? 0) };

  const payableAll = (payableRaw ?? []) as unknown as VandaagInvoice[];

  // [AUTO-INCASSO] Invoices the BANK pays do not belong on the list of things the owner has to do.
  //
  // This is the screen the whole feature was reported from: two WonenBreburg rent invoices sitting
  // in "Te betalen" wearing "2 dagen te laat", with a Betalen button, for money that had already
  // left the account. The owner was not late — the collection simply had not run — and the only
  // way to get them off the screen was "Verbergen", which is a useState and comes back on the next
  // load. They hid the same two rows every time they opened the app.
  //
  // Filtered here rather than in the client so this page keeps its one job: what still needs doing.
  //
  // A FAILED read leaves the list exactly as it is today. That is the deliberate direction to fail
  // in: showing an incasso invoice as payable is the state the app has always been in, while
  // dropping a genuinely payable invoice because a supplier lookup hiccuped would hide a bill.
  let incassoKeys: Set<string> | null = null;
  try {
    const { data, error } = incassoRes;
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    incassoKeys = new Set(
      ((data ?? []) as { name_key: string | null }[]).map((s) => s.name_key).filter((k): k is string => !!k),
    );
  } catch (e) {
    console.error("[AUTO-INCASSO] supplier read failed — Vandaag keeps listing incasso invoices as payable", { userId: user.id, error: e instanceof Error ? e.message : String(e) });
    incassoKeys = null;
  }
  const payable = incassoKeys === null || incassoKeys.size === 0
    ? payableAll
    : payableAll.filter((inv) => {
        const key = supplierNameKey(inv.client_name);
        return !(key.length > 0 && incassoKeys!.has(key));
      });
  // [CREDITNOTA-NO-CHASE] "Herinner je klant" must not list an invoice the owner WITHDREW with a
  // creditnota — nor the creditnota itself, which is also outgoing + 'sent' and so comes back from
  // the query above with a negative total. The home tile (/api/daily-truth) already filters both,
  // and its own comment says this page shows the same to-do; without this they contradict each
  // other, with the home saying "niets te doen" while this page shows a red "55 dagen te laat".
  // Same shared rule and the same honest degradation: an errored lookup keeps the old list.
  const remindAll = (remindRaw ?? []) as unknown as VandaagInvoice[];
  // [PAGINATION] Paged, like the two surfaces that read this very same set — and that is the
  // whole reason it has to be. PostgREST caps a plain .select() at ~1000 rows and says nothing.
  // /api/daily-truth pages this read (fetchAllRows) and so does the reminder cron
  // (fetchAllRowsForIds); this one did not, so past a thousand creditnota's the three quietly
  // stopped agreeing — and the comment directly above exists BECAUSE they must agree. The home
  // tile would drop a withdrawn invoice from "Herinner je klant" while this page kept it on the
  // list in red, which is the exact contradiction that comment was written to prevent.
  //
  // The direction of the error is the bad one too: a credit that falls off the end is a credit
  // that is not subtracted, so the owner chases a customer for money they took back in writing.
  //
  // [CREDIT-TERUG] List 4 — creditnota's die nog terugbetaald moeten worden — reads the SAME set.
  // A creditnota is money the owner OWES, and this page listed what to pay and what to chase and
  // never a credit note. So this read runs whenever the page does, not only when there is
  // something to remind, and it carries the standalone creditnotas too (no original): the
  // reminder question skips those, the refund rule flags them. No status filter, on purpose
  // ([CREDIT-BRON]): a settled creditnota still counts against its invoice, and the refund rule
  // keeps the unsettled ones itself. Whether and how much has to go back is decided in
  // credited-invoices.ts against the invoice each one corrects, read below — never here.
  const creditRows = await fetchAllRows<{
    id: string; original_invoice_id: string | null; total_inc_btw: number | null;
    invoice_number: string | null; invoice_date: string | null; client_name: string | null; status: string | null;
  }>((from, to) => supabase
        .from("invoices")
        // [DEEL-CREDIT] The amount too: a partial credit does not take the invoice off the list.
        .select("id, original_invoice_id, total_inc_btw, invoice_number, invoice_date, client_name, status")
        .eq("sender_id", user.id)
        .eq("direction", "outgoing")
        .eq("invoice_type", "creditnota")
        // [PAGE-KEY] by id: a stable, unique order, so no row is served twice or skipped across
        // .range() windows. The same key both sibling readers use.
        .order("id", { ascending: true })
        .range(from, to)
      ).catch(() => null);
  const remind = creditRows == null
    ? remindAll
    : filterOpenReceivables(remindAll, fullyCreditedIdsFrom(creditRows, remindAll));

  // [COHERENCE-ERRSTATE] A failed load must NEVER masquerade as a calm "all clear".
  // Supabase returns { data: null, error } without throwing, so `?? []` silently
  // coerces a DB/RLS/network failure into two empty lists → the owner is falsely
  // reassured that nothing is due or overdue, hiding real payment obligations. Pass
  // the failure through so the client can show an honest "we could not load" state
  // instead of the reassuring checkmark. (Locked constraint #3: no false reassurance.)
  // Fold the count-query errors in too: a lone count failure must not silently coerce to 0 and show
  // a false "all clear" (a dateless payable / a verify-queue item could be hidden). No false calm.
  const loadFailed = !!payableErr || !!remindErr || !!toVerifyErr || !!datelessErr || !!offertesErr;

  // [OFFERTE-OPVOLGING] De beslissing staat in de pure regel, niet hier: welke offerte aandacht
  // vraagt hangt af van vandaag, en die datum hoort één keer te worden vastgesteld.
  const offertes = quotesNeedingFollowup(
    (offertesRaw ?? []) as unknown as VandaagInvoice[],
    amsterdamToday(),
  ).map((r) => ({ ...r.quote, followupState: r.state, followupDays: r.days }));

  // [CREDIT-TERUG] The invoices the creditnotas correct: total and what the customer paid. The
  // creditnotas themselves are the paged read above. A failed read on either side is `null` —
  // the section then says it could not look, rather than listing a refund that is not due or
  // hiding one that is ([NO-SILENT-EMPTY]).
  let refunds: ReturnType<typeof refundableCreditnotas> | null = null;
  if (creditRows != null) {
    const correctedIds = [...new Set(creditRows.map((r) => r.original_invoice_id).filter((v): v is string => !!v))];
    const originals = new Map<string, RefundOriginalRow>();
    try {
      // [IN-CHUNK] Chunked and paged: an id list that grows with the owner's creditnotas never
      // travels in one URL, and a partial read throws instead of passing as complete.
      const origRows = await fetchAllRowsForIds<{ id: string; total_inc_btw: number | null; amount_paid: number | null }, string>(
        correctedIds,
        (chunk, from, to) => supabase
          .from("invoices")
          .select("id, total_inc_btw, amount_paid")
          .eq("sender_id", user.id)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const o of origRows) originals.set(o.id, { total_inc_btw: o.total_inc_btw, amount_paid: o.amount_paid });
      refunds = refundableCreditnotas(creditRows, originals);
    } catch {
      refunds = null;
    }
  }

  return <VandaagClient payable={payable} remind={remind} offertes={offertes} refunds={refunds} loadFailed={loadFailed} toVerifyCount={toVerifyCount ?? 0} datelessPayableCount={datelessPayableCount ?? 0} zelf={zelf} werk={werk} />;
}