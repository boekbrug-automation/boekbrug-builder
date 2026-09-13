// src/lib/mollie-settlement-sync.ts
// [MOLLIE-AFREKENING] Read the owner's Mollie settlements and book what they prove. Server only.
//
// The decisions live in mollie-settlement.ts (pure, tested). This module is the pipeline around
// them: read the connection, page the API, keep one row per settlement, write the fee invoice
// through the one locked door (apply_manual_payment), and code the payout bank line as a transfer
// when — and only when — every payment in it settled a BoekBrug invoice.
//
// ── WHAT MAY DEGRADE, AND WHAT MAY NOT ──
// A settlement that does not reconcile, a link whose payments cannot be listed, a bank line that
// is not found: each is recorded on the settlement's row (status 'held' or 'refused', with the
// reason) and books nothing. Nothing here ever guesses a category or an amount. The cron survives
// every one of them and reports counts; the owner's Mollie card shows the last error.
//
// [ZELF-EERST] Under "ik kijk zelf naar alles" the fee invoice enters the queue as 'processing'
// and waits for the owner to confirm it. The deduction itself is a fact, not a booking decision:
// once the invoice is 'received' (at once, or after the owner confirmed it) the next run settles
// it on the settlement date through the locked door — there is no bank line for it and there
// never will be, and an open Mollie payable that nothing can ever pay is a false debt in the
// forecast. The row records the settlement (fee_paid_at); until then it stays 'held' and says why.
//
// ── ONE ANSWER PER SETTLEMENT ──
// 'booked' means: fee invoice exists AND is settled, the payout line is found AND coded transfer,
// and every payment in the settlement is a BoekBrug payment with nothing refunded or charged
// back. Anything short of that is 'held' with the reason, and a held row is looked at again on
// every run — so a fee that could not be settled today (the owner has not confirmed it yet, the
// RPC failed once) is retried, never forgotten.

import { amsterdamToday } from "@/lib/format-nl";
import { getMollieConnection, setMollieConnectionError } from "@/lib/mollie-connection";
import {
  listMollieSettlements, listMollieSettlementPayments, listMolliePaymentLinkPayments,
  listMollieSettlementRefunds, listMollieSettlementChargebacks,
} from "@/lib/mollie";
import {
  feeInvoiceFrom, isPayoutOf, payoutLineVerdict, splitPayments, summarizeSettlement, holdReason, feeClientKey,
  MOLLIE_SUPPLIER_NAME, type SettlementSummary,
} from "@/lib/mollie-settlement";
// [TERUGBETALING] Reading a refund, and deciding nothing about it — see that module's header for
// why a chargeback and a refund lead to two different bookings and only the owner knows which.
import {
  refundFactFrom, resolveRefunds, refundAlreadyReversed, refundHoldSentence,
  type RefundFact, type KnownPaymentLink, type ResolvedRefund,
} from "@/lib/mollie-refund";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { autoBoekenAllowed } from "@/lib/auto-boeken";
import { createNotification } from "@/lib/notifications";
import { reportHandledFailure } from "@/lib/report-handled";
import { readDoubleBookingGuard } from "@/lib/bank-double-booking";
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";

// mollie_settlements and mollie_payment_links are not in the generated types (mollie.sql is
// applied by hand) — the same relaxed client the webhook uses, for the same reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any;

export interface SettlementSyncResult {
  connected: boolean;
  seen: number;
  booked: number;
  held: number;
  refused: number;
  errors: string[];
}

/** How many settlements back one run looks. Mollie pays out daily at most; a month is plenty. */
const SETTLEMENTS_PER_RUN = 40;

type SettlementRow = { id: string; settlement_id: string; status: string; fee_invoice_id: string | null; fee_paid_at: string | null; payout_tx_id: string | null };

export async function syncMollieSettlementsForOwner(pipeline: Pipeline, userId: string): Promise<SettlementSyncResult> {
  const out: SettlementSyncResult = { connected: false, seen: 0, booked: 0, held: 0, refused: 0, errors: [] };
  const conn = await getMollieConnection(userId);
  if (!conn) return out;
  out.connected = true;

  const listed = await listMollieSettlements(conn.apiKey, SETTLEMENTS_PER_RUN);
  if ("error" in listed) {
    out.errors.push(listed.error);
    await setMollieConnectionError(userId, `Afrekeningen lezen mislukt: ${listed.error}`.slice(0, 500));
    return out;
  }

  const { data: knownRows, error: knownErr } = await pipeline
    .from("mollie_settlements")
    .select("id, settlement_id, status, fee_invoice_id, fee_paid_at, payout_tx_id")
    .eq("user_id", userId);
  if (knownErr) {
    out.errors.push(`mollie_settlements lezen mislukt: ${knownErr.message}`);
    return out;
  }
  const known = new Map<string, SettlementRow>((knownRows ?? []).map((r: SettlementRow) => [r.settlement_id, r]));

  const autoBoeken = await autoBoekenAllowed(pipeline, userId);

  for (const s of listed) {
    if (s.status !== "paidout") continue;
    const existing = known.get(s.id);
    // Done is done; a held row gets another look (the bank line may have arrived since).
    if (existing && existing.status === "booked") continue;
    out.seen++;
    try {
      const verdict = summarizeSettlement(s);
      if (!verdict.ok) {
        out.refused++;
        await upsertRow(pipeline, userId, s.id, { reference: s.reference ?? null, status: "refused", last_error: verdict.reason });
        continue;
      }
      const summary = verdict.summary;

      // ── The payments: ours or not ──
      const payments = await listMollieSettlementPayments(conn.apiKey, s.id);
      if ("error" in payments) {
        out.held++;
        await upsertRow(pipeline, userId, s.id, { ...figures(summary), status: "held", last_error: payments.error });
        continue;
      }
      // [TERUGBETALING] The links themselves, not only their payment ids: a refund is tied to an
      // invoice through exactly this mapping, and reading it twice would be two answers.
      const links = await ourPaymentLinks(pipeline, userId, conn.apiKey);
      const split = splitPayments(payments, new Set(links.map((l) => l.paymentId).filter(Boolean) as string[]));

      // ── Refunds and chargebacks: money in the settlement that is not a payment ──
      // A refund of one of OUR invoices leaves that invoice standing as paid while the money went
      // back; a chargeback the same. Either makes "every payment is ours" a false all-clear, so
      // the settlement is held and the owner is pointed at it. A failed read counts as "unknown",
      // which is a hold too — never a transfer on a question the API did not answer.
      const [refunds, chargebacks] = await Promise.all([
        listMollieSettlementRefunds(conn.apiKey, s.id),
        listMollieSettlementChargebacks(conn.apiKey, s.id),
      ]);
      if ("error" in refunds || "error" in chargebacks) {
        out.held++;
        const err = "error" in refunds ? refunds.error : (chargebacks as { error: string }).error;
        await upsertRow(pipeline, userId, s.id, { ...figures(summary), status: "held", last_error: `terugbetalingen/chargebacks lezen mislukt: ${err}` });
        continue;
      }

      // [TERUGBETALING] Until now this was `refunds.length + chargebacks.length` and nothing more:
      // the settlement was held and the event itself was never written down. So the invoice that
      // payment settled stayed 'paid' while the money had gone back, the hold sentence was
      // overwritten on the next run, and there was no way to find out WHICH sale it was about.
      // Each one is now a row in mollie_refunds, tied through its paymentId to the invoice it
      // un-pays, and it holds the settlement until the owner has answered it.
      const readings = [
        ...refunds.map((r) => refundFactFrom(r, "refund")),
        ...chargebacks.map((c) => refundFactFrom(c, "chargeback")),
      ];
      const facts = readings.filter((f): f is RefundFact => f !== null);
      const unreadable = readings.length - facts.length;
      if (unreadable > 0) {
        // Money moved back and we could not read it as money — a currency we do not book, an
        // amount that will not parse. That is strictly worse than a refund we recorded, so it
        // holds the settlement and says so, instead of being counted as nothing.
        out.held++;
        await upsertRow(pipeline, userId, s.id, {
          ...figures(summary), status: "held",
          last_error: `${unreadable} terugbetaling${unreadable === 1 ? "" : "en"} in deze afrekening kon ik niet lezen — beoordeel deze afrekening zelf`,
        });
        continue;
      }
      const recorded = await recordRefunds(pipeline, userId, s.id, resolveRefunds(facts, links));
      // What still holds the settlement is what is still OPEN. A refund the owner has answered —
      // reversed, credited, or "not mine" — has stopped being a question, and a settlement that
      // held on answered questions would hold forever.
      const adjustments = recorded.open.length;
      const refundHold = refundHoldSentence(recorded.open);

      // ── The fee: a purchase from Mollie, paid by deduction ──
      const rowId = existing?.id ?? (await upsertRow(pipeline, userId, s.id, { ...figures(summary), status: "held" }));
      const fee = feeInvoiceFrom(summary);
      let feeInvoiceId: string | null = existing?.fee_invoice_id ?? null;
      let feePaidAt: string | null = existing?.fee_paid_at ?? null;
      let feeReason: string | null = null;
      if (fee && !feePaidAt) {
        const booked = await bookFeeInvoice(pipeline, userId, rowId, fee, summary, autoBoeken, feeInvoiceId);
        feeInvoiceId = booked.invoiceId;
        feePaidAt = booked.paidAt;
        feeReason = booked.reason;
      }

      // ── The payout bank line ──
      const lineVerdict = payoutLineVerdict(split, { summary, adjustments });
      let payoutTxId: string | null = existing?.payout_tx_id ?? null;
      let lineBlocked: string | null = null;
      if (!payoutTxId) {
        const coded = await codePayoutLine(pipeline, userId, summary, lineVerdict);
        payoutTxId = coded.lineId;
        lineBlocked = coded.blocked;
      }

      const feeDone = fee === null || feePaidAt !== null;
      const complete = feeDone && payoutTxId !== null && lineBlocked === null && lineVerdict === "transfer";
      // The refund sentence wins when there is one: it names the thing the owner has to decide,
      // where holdReason() can only say that something is off about this settlement.
      const reason = refundHold ?? (lineVerdict === "hold"
        ? holdReason(split, summary, adjustments)
        : lineBlocked ?? (payoutTxId === null ? "bankregel van de uitbetaling nog niet gevonden" : feeReason));
      await upsertRow(pipeline, userId, s.id, {
        ...figures(summary),
        linked_gross: split.linkedGross,
        unlinked_gross: split.unlinkedGross,
        unlinked_count: split.unlinkedCount,
        fee_invoice_id: feeInvoiceId,
        fee_paid_at: feePaidAt,
        payout_tx_id: payoutTxId,
        status: complete ? "booked" : "held",
        last_error: reason,
      });
      if (complete) out.booked++; else out.held++;

      // [TERUGBETALING] Money going back is its own bell, and it rings on the REFUND being new —
      // not on the settlement being new. A refund often lands on a settlement we already knew and
      // had already held; under the old condition that bell would never have rung at all.
      if (recorded.inserted > 0) {
        await createNotification({
          userId,
          type: "payment",
          title: "Geld terug via Mollie",
          body: `${refundHold ?? "een terugbetaling werd verwerkt"} — afrekening ${summary.reference ?? s.id}`,
          link: "/dashboard/settings",
        });
      } else if (lineVerdict === "hold" && !existing) {
        // Say it once: revenue the app never saw is the owner's to book, and silence would leave a
        // bank credit that never explains itself.
        await createNotification({
          userId,
          type: "payment",
          title: "Mollie-uitbetaling met omzet buiten BoekBrug",
          body: `Afrekening ${summary.reference ?? s.id}: ${holdReason(split, summary, adjustments)}`,
          link: "/dashboard/bank",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${s.id}: ${msg}`);
      await upsertRow(pipeline, userId, s.id, { reference: s.reference ?? null, status: "held", last_error: msg.slice(0, 500) }).catch(() => undefined);
    }
  }
  return out;
}

function figures(summary: SettlementSummary) {
  return {
    reference: summary.reference,
    settled_on: summary.settledOn,
    revenue_gross: summary.revenueGross,
    costs_net: summary.costsNet,
    costs_vat: summary.costsVat,
    costs_gross: summary.costsGross,
    payout: summary.payout,
  };
}

/** Upsert the settlement's row; returns its id. */
async function upsertRow(pipeline: Pipeline, userId: string, settlementId: string, patch: Record<string, unknown>): Promise<string> {
  const { data, error } = await pipeline
    .from("mollie_settlements")
    .upsert({ user_id: userId, settlement_id: settlementId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id,settlement_id" })
    .select("id")
    .single();
  if (error) throw new Error(`mollie_settlements schrijven mislukt: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Our payment links, each with the Mollie payment it produced. Learned once per link from the
 * Payment Links API and stored on the link row, so the next settlement costs no calls.
 *
 * [TERUGBETALING] This used to return only the SET of payment ids, which was all splitPayments()
 * needed. A refund needs the whole mapping: from Mollie's payment, to our link row (whose id is
 * also the client_key of the bank_tx_invoices row that booked it), to the invoice. Returning the
 * links instead of a projection of them means both readers answer from the same query.
 */
async function ourPaymentLinks(pipeline: Pipeline, userId: string, apiKey: string): Promise<KnownPaymentLink[]> {
  const { data: links, error } = await pipeline
    .from("mollie_payment_links")
    .select("id, link_id, payment_id, invoice_id, status")
    .eq("user_id", userId)
    .in("status", ["paid", "superseded", "open"]);
  if (error) throw new Error(`mollie_payment_links lezen mislukt: ${error.message}`);
  type Row = { id: string; link_id: string; payment_id: string | null; invoice_id: string | null; status: string };
  const rows = (links ?? []) as Row[];
  const learned = new Map<string, string>();
  const unknown: Row[] = [];
  for (const l of rows) {
    if (!l.payment_id && l.status === "paid") unknown.push(l);
  }
  // Bounded per run; each link is looked up once ever, because the answer is stored below.
  for (const l of unknown.slice(0, 50)) {
    const payments = await listMolliePaymentLinkPayments(apiKey, l.link_id);
    if ("error" in payments) throw new Error(`betalingen van link ${l.link_id} lezen mislukt: ${payments.error}`);
    const paid = payments.find((p) => p.status === "paid") ?? payments[0];
    if (!paid) continue;
    learned.set(l.id, paid.id);
    // Remembered whenever it was found — a link's payment is its payment whichever settlement it
    // lands in. Remembering it only when it sat in THIS settlement re-fetched every older link on
    // every run, forever.
    await pipeline.from("mollie_payment_links").update({ payment_id: paid.id }).eq("id", l.id).eq("user_id", userId);
  }
  return rows.map((l) => ({
    id: l.id,
    paymentId: l.payment_id ?? learned.get(l.id) ?? null,
    invoiceId: l.invoice_id ?? null,
  }));
}

/** A mollie_refunds row as this file reads it back. */
type RefundRow = {
  id: string;
  refund_id: string;
  kind: "refund" | "chargeback";
  invoice_id: string | null;
  amount: number | string | null;
  paid_snapshot: number | string | null;
  resolution: string;
};

/**
 * [TERUGBETALING] Write down every refund and chargeback in this settlement, and report which of
 * them are still a question.
 *
 * Three things happen here, and the order matters:
 *   1. what we already know is read, so a re-run of the cron records nothing twice — the unique
 *      (user_id, refund_id) index is the backstop under a concurrent run, not the plan;
 *   2. a NEW fact is written with paid_snapshot = the invoice's amount_paid at this moment. That
 *      snapshot is the nulpunt that later makes "the reversal already happened" provable instead
 *      of guessed;
 *   3. an OPEN fact whose invoice has meanwhile dropped by at least the refunded amount is closed
 *      as 'reversed'. The owner may undo a payment through the ordinary "Betaald" toggle without
 *      ever seeing the refund panel, and a question that stays open after it has been answered
 *      elsewhere is exactly how a panel becomes something people click past.
 *
 * A fact we cannot tie to an invoice is recorded all the same and stays OPEN. Not resolvable is
 * not the same as not ours: payment ids are learned lazily (50 links per run above), so "we do not
 * know this payment" is sometimes only "we have not looked yet". Closing it on our own would be
 * the app answering a money question it was not able to read.
 */
async function recordRefunds(
  pipeline: Pipeline, userId: string, settlementId: string, resolved: ResolvedRefund[],
): Promise<{ open: RefundFact[]; inserted: number }> {
  if (resolved.length === 0) return { open: [], inserted: 0 };

  const read = async (): Promise<RefundRow[]> => {
    const { data, error } = await pipeline
      .from("mollie_refunds")
      .select("id, refund_id, kind, invoice_id, amount, paid_snapshot, resolution")
      .eq("user_id", userId)
      .eq("settlement_id", settlementId);
    if (error) throw new Error(`mollie_refunds lezen mislukt: ${error.message}`);
    return (data ?? []) as RefundRow[];
  };

  const before = await read();
  const known = new Set(before.map((r) => r.refund_id));

  // Every invoice these facts touch, read ONCE — the snapshot of a new row and the self-heal of an
  // open one are the same number, and reading it twice is how they would disagree.
  const invoiceIds = [...new Set(
    [...resolved.map((r) => r.invoiceId), ...before.map((r) => r.invoice_id)].filter(Boolean) as string[],
  )];
  const paidById = new Map<string, number | null>();
  if (invoiceIds.length > 0) {
    // [IN-CHUNK] The shape, not today's ceiling: an unchunked .in() dies at a few hundred ids with
    // a 414 that supabase-js reports as an ordinary error, and a read that failed would be taken
    // here for "no invoices" — which would write every snapshot as null.
    const invs = await fetchAllRowsForIds<{ id: string; amount_paid: number | string | null }, string>(
      invoiceIds,
      (chunk, from, to) => pipeline
        .from("invoices")
        .select("id, amount_paid")
        .in("id", chunk)
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("id")
        .range(from, to),
    );
    for (const i of invs) paidById.set(i.id, i.amount_paid === null ? null : Number(i.amount_paid));
  }

  let inserted = 0;
  for (const r of resolved) {
    if (known.has(r.fact.refundId)) continue;
    const { error: insErr } = await pipeline.from("mollie_refunds").insert({
      user_id: userId,
      settlement_id: settlementId,
      refund_id: r.fact.refundId,
      kind: r.fact.kind,
      payment_id: r.fact.paymentId,
      link_id: r.linkId,
      invoice_id: r.invoiceId,
      amount: r.fact.amount,
      created_on: r.fact.createdOn,
      paid_snapshot: r.invoiceId ? paidById.get(r.invoiceId) ?? null : null,
    });
    // A second run of the cron loses the unique (user_id, refund_id) race. That is the index doing
    // its job — the fact is recorded, just not by us — and never a reason to fail the settlement.
    if (insErr && !/duplicate key|already exists|23505/i.test(insErr.message ?? "")) {
      throw new Error(`terugbetaling vastleggen mislukt: ${insErr.message}`);
    }
    if (!insErr) inserted++;
  }

  const open: RefundFact[] = [];
  const now = new Date().toISOString();
  for (const row of inserted > 0 ? await read() : before) {
    if (row.resolution !== "open") continue;
    const amount = Number(row.amount);
    if (row.invoice_id && refundAlreadyReversed({
      paidSnapshot: row.paid_snapshot === null ? null : Number(row.paid_snapshot),
      paidNow: paidById.get(row.invoice_id) ?? null,
      amount,
    })) {
      // Scoped on resolution='open' so this cannot overwrite an answer the owner gave a second ago.
      await pipeline.from("mollie_refunds")
        .update({ resolution: "reversed", resolved_at: now, updated_at: now })
        .eq("id", row.id).eq("user_id", userId).eq("resolution", "open");
      continue;
    }
    open.push({ refundId: row.refund_id, kind: row.kind, paymentId: null, amount, createdOn: null });
  }
  return { open, inserted };
}

/**
 * The fee invoice, through the same doors every purchase invoice takes. Ensures the invoice
 * exists (finds it by number, or inserts it), then settles it through the locked door when it is
 * payable. Returns what it reached: the invoice id, the settlement moment, and — when the fee is
 * not settled yet — the reason, for the row.
 */
async function bookFeeInvoice(
  pipeline: Pipeline, userId: string, settlementRowId: string,
  fee: NonNullable<ReturnType<typeof feeInvoiceFrom>>, summary: SettlementSummary, autoBoeken: boolean,
  knownInvoiceId: string | null,
): Promise<{ invoiceId: string | null; paidAt: string | null; reason: string | null }> {
  // The same number twice is the same fee twice: never insert a second row for one settlement.
  // The row's own fee_invoice_id is checked too — it may have been cleared by a deletion (FK
  // ON DELETE SET NULL), in which case the invoice is recreated and paid under a fresh key.
  let invoiceId: string | null = null;
  if (knownInvoiceId) {
    const { data: still } = await pipeline.from("invoices").select("id, status").eq("id", knownInvoiceId).eq("receiver_id", userId).maybeSingle();
    if (still?.id) invoiceId = still.id as string;
  }
  if (!invoiceId) {
    const { data: dup } = await pipeline
      .from("invoices").select("id").eq("receiver_id", userId).eq("direction", "incoming")
      .eq("invoice_number", fee.invoiceNumber).limit(1).maybeSingle();
    if (dup?.id) invoiceId = dup.id as string;
  }
  if (!invoiceId) invoiceId = await insertFeeInvoice(pipeline, userId, fee, summary, autoBoeken);
  const paid = await settleFeeInvoice(pipeline, userId, settlementRowId, invoiceId, fee, summary);
  return { invoiceId, ...paid };
}

async function insertFeeInvoice(
  pipeline: Pipeline, userId: string,
  fee: NonNullable<ReturnType<typeof feeInvoiceFrom>>, summary: SettlementSummary, autoBoeken: boolean,
): Promise<string> {
  const supplier = await resolveSupplierForImport(pipeline, userId, { name: MOLLIE_SUPPLIER_NAME });
  const { data: inserted, error } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null, receiver_id: userId, direction: "incoming",
      status: autoBoeken ? "received" : "processing",
      source: "created",
      supplier_id: supplier?.id ?? null,
      client_name: supplier?.name ?? MOLLIE_SUPPLIER_NAME,
      invoice_date: fee.invoiceDate, due_date: fee.invoiceDate,
      invoice_number: fee.invoiceNumber, invoice_type: "factuur",
      total_ex_btw: fee.totalExBtw, btw_amount: fee.btwAmount, total_inc_btw: fee.totalIncBtw,
      field_confidence: {
        // The trail: which settlement, which Mollie invoices, and that the amounts came from the
        // API and not from a read — so no grounding gate looks for a document that does not exist.
        _mollie_settlement: summary.settlementId,
        _mollie_invoice_ids: fee.mollieInvoiceIds,
        _source_note: "Kosten uit de Mollie Settlements API — bedragen exact zoals Mollie ze meldde.",
        amount: 1, vendor: 1, date: 1,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`kostenfactuur Mollie schrijven mislukt: ${error.message}`);
  return (inserted as { id: string }).id;
}

/**
 * Settle the fee invoice by deduction on the settlement date — the one locked door, keyed on
 * (settlement row, invoice) so a second run replays rather than pays twice. Only a 'received'
 * invoice is payable: under [ZELF-EERST] the invoice waits in the queue until the owner
 * confirms it, and this returns the reason instead of a settlement moment. A failed RPC is
 * reported AND returned unsettled, so the next run tries again.
 */
async function settleFeeInvoice(
  pipeline: Pipeline, userId: string, settlementRowId: string, invoiceId: string,
  fee: NonNullable<ReturnType<typeof feeInvoiceFrom>>, summary: SettlementSummary,
): Promise<{ paidAt: string | null; reason: string | null }> {
  const { data: inv } = await pipeline.from("invoices").select("status").eq("id", invoiceId).eq("receiver_id", userId).maybeSingle();
  const status = (inv as { status?: string } | null)?.status ?? null;
  if (status === "paid") return { paidAt: new Date().toISOString(), reason: null };
  if (status !== "received") {
    return { paidAt: null, reason: "de Mollie-kostenfactuur wacht op je bevestiging in de controlewachtrij" };
  }
  const { error: payErr } = await pipeline.rpc("apply_manual_payment", {
    p_user_id: userId,
    p_invoice_id: invoiceId,
    p_amount: fee.totalIncBtw,
    p_pay_date: amsterdamToday(new Date(`${fee.invoiceDate}T12:00:00Z`)),
    p_method: "bank",
    p_payable_statuses: ["received"],
    p_client_key: feeClientKey(settlementRowId, invoiceId),
  });
  if (payErr && !/duplicate|already/i.test(payErr.message ?? "")) {
    reportHandledFailure({
      tag: "MOLLIE-AFREKENING", severity: "data-integrity",
      message: "Mollie-kostenfactuur aangemaakt maar niet op betaald gezet",
      context: { userId, invoiceId, settlement: summary.settlementId, error: payErr.message },
    });
    return { paidAt: null, reason: `kostenfactuur niet op betaald gezet: ${String(payErr.message ?? "").slice(0, 200)}` };
  }
  return { paidAt: new Date().toISOString(), reason: null };
}

/**
 * Find the payout bank line and, when every payment in it is ours, code it as a transfer. Returns
 * the line's id when found (coded or not), null when no line matched yet — and `blocked` with the
 * reason when the line was found but deliberately NOT coded, so the row is held, not booked.
 */
async function codePayoutLine(pipeline: Pipeline, userId: string, summary: SettlementSummary, verdict: "transfer" | "hold"): Promise<{ lineId: string | null; blocked: string | null }> {
  if (!summary.settledOn) return { lineId: null, blocked: null };
  const from = shiftDays(summary.settledOn, -6), to = shiftDays(summary.settledOn, 6);
  const { data: lines, error } = await pipeline
    .from("bank_transactions")
    .select("id, amount, date, description, counterpart_name, category, invoice_id")
    .eq("user_id", userId)
    .gte("date", from).lte("date", to)
    .eq("amount", summary.payout);
  if (error) throw new Error(`bankregels lezen mislukt: ${error.message}`);
  const line = ((lines ?? []) as { id: string; amount: number | null; date: string | null; description: string | null; counterpart_name: string | null; category: string | null; invoice_id: string | null }[])
    .find((l) => isPayoutOf(l, summary));
  if (!line) return { lineId: null, blocked: null };
  if (verdict === "transfer" && line.category === null && line.invoice_id === null) {
    // [DUBBEL-GEDEKT] Ask what is already booked before writing any category, like every other
    // machine writer. The "mollie-payout" hold is EXPECTED here — it is the hold this sync exists
    // to resolve, with the settlement as proof. A "paid-invoice" answer is not: it says a paid
    // invoice of exactly this amount sits near this date, so the line may be that invoice's own
    // payment rather than the payout, and the honest move is to code nothing.
    const guard = await readDoubleBookingGuard({ invoiceClient: pipeline, molliePipeline: pipeline, userId, lines: [line] });
    if (guard.hold("omzet", line) === "paid-invoice") {
      return { lineId: line.id, blocked: "de bankregel lijkt ook de betaling van een al betaalde factuur van dit bedrag te zijn — beoordeel zelf of dit de Mollie-uitbetaling is" };
    }
    // 'transfer' never touches revenue or cost ([BANK-IDENTITY]); source 'rule', unconfirmed, so
    // the owner still sees it and can overrule — the app coded it, the app says so.
    await pipeline
      .from("bank_transactions")
      .update({ category: "transfer", category_source: "rule", category_confirmed: false })
      .eq("id", line.id).eq("user_id", userId).is("category", null);
  }
  return { lineId: line.id, blocked: null };
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
