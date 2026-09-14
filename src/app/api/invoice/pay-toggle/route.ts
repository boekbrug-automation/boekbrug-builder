// src/app/api/invoice/pay-toggle/route.ts
// [PAY-TOGGLE] The server-authoritative "mark paid" / "undo paid" for a manually-handled invoice
// (the Crediteuren + Facturen "Betaald" toggle). It replaces the old direct client-side write for
// two audited-truth reasons the audit surfaced:
//   [16] every money mutation must be AUDITED — the client write left no audit row.
//   [15] an UNDO of a bank-matched invoice must DETACH its bank transaction — the client toggle
//        undid the invoice side only, stranding the tx as 'matched' (invoice payable a second time,
//        the payment unreachable to re-link). Here the undo runs the same reversal the /bank/unlink
//        path does: detach the tx → pending, clear the join rows, recompute amount_paid.
// The invoice status write uses the SESSION client so the B.4 'verwerkt' trigger fires with a real
// auth.uid(); bank/join writes + audit use the service-role pipeline.

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
// [PAY-DATE-SANE] one tested answer to "could a person have paid on this day?" — see payment-date.ts
import { paymentDateOutOfWindow, PAYMENT_DATE_REFUSAL } from "@/lib/payment-date";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [PAYDATE-REDERIVE] After a reversal the invoice's payment date must describe the money that is
// still on it. The database does this too now; this stands beside it — see the module for why.
import { rederivePaymentDate } from "@/lib/payment-date-rederive";
// [CASH-RETRY] The retry wrapper moved to cash-settle.ts so every door that turns a cash payment
// into a drawer movement uses the same one — see its header for the four that did not.
import { reconcileCashWithRetry, cashInstalmentsSupported } from "@/lib/cash-settle";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [MANUAL-PARTIAL-PAY] one shape for a booked payment — the write path and the replay path
// must answer identically, or the clients cannot tell a deelbetaling from a settlement.
import { buildPaymentResult } from "@/lib/partial-payment";
import { requireOwnerPermission } from '@/lib/access/context'
// [HAND-DUBBEL] One definition of "these two rows are the same invoice" — the pay screen's own.
import { findPayableDuplicates, duplicateWarningText, type DuplicateCandidateRow } from "@/lib/duplicate-payable";
import { round2 } from "@/lib/invoice-totals";

export const dynamic = "force-dynamic";

// [PAY-DURATION] Marking paid is not one write: an undo walks every bank transaction linked to
// this invoice (per-tx reads, a scoped detach, a recompute RPC) and both directions finish with
// reconcileCashSettlements over the owner's kasboek. A kill midway through the undo is the bad
// case — the bank links are already detached while the invoice is still 'paid', and the rollback
// that repairs exactly that cannot run. A ceiling well above the real work keeps that shut.
export const maxDuration = 60;

// [MANUAL-PARTIAL-PAY] Idempotency keys are uuids — reject anything else rather than
// letting a junk key through as "no key" (which would silently re-enable double booking).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One payment link on an invoice, with everything a restore needs.
 *
 * [UNDO-EIGEN-WERK] Named because the undo now reads this shape twice — once as the opening
 * snapshot, and once as what the DELETE reports it actually removed. The rollback restores the
 * second. Two inline copies of the same shape is how they would drift into restoring different
 * columns, and `amount_applied` is the one recompute_invoice_amount_paid sums.
 */
type LinkRow = {
  id: string;
  transaction_id: string | null;
  amount_applied: number | null;
  paid_on: string | null;
  method: string | null;
  client_key: string | null;
};


export async function POST(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwnerPermission('payment.create', 'Een factuur op betaald zetten'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [HAND-DUBBEL] `force` is the owner saying "yes, I know, book it anyway" — see the check below.
  let body: { invoiceId?: string; action?: string; paymentMethod?: string; paymentDate?: string; force?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const invoiceId = body.invoiceId;
  const action = body.action;
  if (!invoiceId || (action !== "pay" && action !== "undo")) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // Ownership + state. The user must own the invoice (sender OR receiver).
  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    // [MANUAL-PARTIAL-PAY] amount_paid decides whether an undo is allowed on an invoice
    // that is partly settled but still open.
    // [HAND-DUBBEL] client_name + total_inc_btw ride along: the duplicate question is per SUPPLIER,
    // and the sentence the owner reads names the amounts of both rows.
    // [BON-DUBBEL] …and invoice_date, because a document with no readable number is paired on its
    // amount, and then the dates are what say whether these can be one document at all.
    .select("id, invoice_number, invoice_date, status, direction, accountant_status, sender_id, receiver_id, amount_paid, client_name, total_inc_btw")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
  }

  const isIncoming = inv.direction === "incoming";

  // [PAY-GUARD] 'paid' may only be entered from a genuinely PAYABLE state: a
  // verified incoming Crediteur ('received') or a delivered outgoing invoice
  // ('sent'; stored-'overdue' included defensively for legacy rows). A row in
  // the verify queue ('processing'), a never-sent 'draft', or an 'archived'
  // one must NEVER become paid — that would inject unverified AI-extracted
  // amounts straight into the BTW figures (voorbelasting/omzet count 'paid'),
  // and a later undo would launder it into a verified 'received'/'sent'.
  const PAYABLE = isIncoming ? ["received"] : ["sent", "overdue"];

  if (action === "pay") {
    if (inv.status === "paid") {
      return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
    }
    if (!inv.status || !PAYABLE.includes(inv.status)) {
      return NextResponse.json(
        { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
        { status: 409 }
      );
    }
    // ── [HAND-DUBBEL] Does this invoice NUMBER already stand paid on another row? ──
    //
    // Two of the three double bookings found in the live administration came through HERE, not
    // through any automatic pass: bank_tx_invoices rows written at 19:19 and 19:30 on 5 August by
    // this route — the owner tapping "betaald" on the pay list. FAMZFOOD "26 / 1876" booked € 665,02
    // twice; Doyum 26700385 booked € 239,47 on top of the € 222,05 the bank had already paid.
    //
    // The pay screen already warns about this pair ([DUP-ON-PAY]). It warned from a LIST, and a list
    // is always a subset — of a period, of a tab, of the rows that screen happened to load — so the
    // warning is missing at exactly the moment the twin was settled somewhere else. The database is
    // not a subset, and this is the door every manual payment goes through.
    //
    // It ASKS, it does not refuse. Which of two readings is the real invoice is a question about
    // paper, and on the Enka pair the copy our reader got wrong was the one that looked right. So
    // the owner is told what stands where, and `force` lets them book it anyway — deliberately,
    // once, instead of never knowing.
    if (body.force !== true) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: twins, error: twinErr } = await (pipeline as any)
          .rpc("invoice_number_twins", { p_owner: user.id, p_invoice_id: invoiceId });
        // [DEPLOY-SAFE] invoice_number_twins.sql is applied by hand; until it is, this fails and the
        // tap behaves exactly as it did before. A failed LOOK is logged, never turned into "no twin".
        if (twinErr) {
          console.warn("[HAND-DUBBEL] kon niet nakijken of dit nummer elders staat", {
            invoiceId, userId: user.id, error: twinErr.message,
          });
        } else {
          const rows = (Array.isArray(twins) ? twins : []) as DuplicateCandidateRow[];

          // ── [BON-DUBBEL] The rows the NUMBER can never find ────────────────────────────────
          //
          // A photographed kassabon carries a minted stand-in ("CAMERA-1784373753563"), one per
          // import, so the RPC above — which compares numbers — returns nothing for exactly the
          // intake path most likely to hold the same document twice. The second candidate list is
          // therefore read on the AMOUNT, and duplicate-payable.ts decides whether the pair is
          // real: it will only report one when at least one side has no usable number, which is
          // what keeps a monthly bill at a fixed price out of it.
          //
          // Deliberately NOT a second SQL function: this is one equality on the total plus the
          // owner and the direction, and a query that narrow needs no place of its own. What must
          // not move into SQL is the JUDGEMENT — that stays in the one module that holds it.
          //
          // The range is built on the SIGNED total, not its magnitude: a creditnota is stored
          // negative, so a range around the absolute value would return invoices when the row at
          // hand is a credit — and never the other credit that actually is its twin.
          //
          // [RLS-UIT] The owner filter uses LITERAL column names, and the first draft of it did
          // not: `.eq(isIncoming ? "receiver_id" : "sender_id", …)` reads correctly and is
          // unverifiable — the gate that walks every service-role query on the money line cannot
          // see which column a ternary picks, and a computed column name is exactly where an owner
          // filter can quietly stop being one. So it is the same `.or(...)` the ownership lookup at
          // the top of this route uses; with the direction pinned it selects precisely this owner's
          // rows on this side, and it can reach nobody else's — both halves demand this user's id.
          //
          // The reasoning lives HERE and not between the chained calls, which is where it was
          // written first: that gate reads the raw source in a 900-character window from `.from(`,
          // and eight lines of comment pushed the owner filter out of its view. A rule that is
          // enforced by reading has a budget, and prose inside the chain spends it.
          const bedrag = Number(inv.total_inc_btw ?? 0);
          const CAP = 200;
          const gelijkeBedragen = Math.abs(bedrag) > 0.005
            ? await pipeline
                .from("invoices")
                .select("id, invoice_number, invoice_date, client_name, total_inc_btw, status, amount_paid")
                .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
                .eq("direction", isIncoming ? "incoming" : "outgoing")
                .neq("id", invoiceId)
                .not("status", "in", '("archived","draft")')
                .gte("total_inc_btw", bedrag - 0.005)
                .lte("total_inc_btw", bedrag + 0.005)
                .limit(CAP)
            : { data: [], error: null };
          if (gelijkeBedragen.error) {
            // [NO-SILENT-EMPTY] A read that failed is not an answer of "no twin". Logged, and the
            // number pass below still runs on what it did get.
            console.warn("[BON-DUBBEL] kon niet nakijken of ditzelfde bedrag elders staat", {
              invoiceId, userId: user.id, error: gelijkeBedragen.error.message,
            });
          } else if ((gelijkeBedragen.data?.length ?? 0) >= CAP) {
            // A truncated look is not a complete one. It filters on the amount across every
            // supplier, so a round number in a busy administration can fill the page — and the
            // twin we are looking for may be the row that did not fit.
            console.warn("[BON-DUBBEL] de bedragvergelijking is afgekapt en dus niet volledig", {
              invoiceId, userId: user.id, bedrag, cap: CAP,
            });
          }
          const zelfdeBedrag = (Array.isArray(gelijkeBedragen.data) ? gelijkeBedragen.data : []) as DuplicateCandidateRow[];

          // The same judgement the pay screen uses — supplier key and all. Restating it here would
          // be a second definition of "the same invoice", and they would answer differently the
          // first time either is touched.
          const kandidaten = new Map<string, DuplicateCandidateRow>();
          for (const r of [...rows, ...zelfdeBedrag]) if (r?.id) kandidaten.set(r.id, r);
          const warn = findPayableDuplicates([
            { id: inv.id, invoice_number: inv.invoice_number, client_name: inv.client_name,
              invoice_date: inv.invoice_date, total_inc_btw: inv.total_inc_btw,
              status: inv.status, amount_paid: inv.amount_paid },
            ...kandidaten.values(),
          ]).get(inv.id);
          if (warn?.anyPaid) {
            return NextResponse.json({
              error: "duplicate_already_paid",
              detail: duplicateWarningText(warn, inv.invoice_number),
              invoiceNumber: inv.invoice_number,
              others: warn.others.map((o) => ({
                id: o.id, invoiceNumber: o.invoice_number, clientName: o.client_name,
                total: o.total_inc_btw, status: o.status, amountPaid: o.amount_paid ?? 0,
              })),
            }, { status: 409 });
          }
        }
      } catch (e) {
        console.warn("[HAND-DUBBEL] kon niet nakijken of dit nummer elders staat", {
          invoiceId, userId: user.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const paymentMethod = body.paymentMethod === "kas" ? "kas" : "bank";
    // [PAY-DATE-SANE] The shape test that stood here is not a date check: "2062-03-01" and
    // "1926-07-04" pass it, and a slipped digit in a date field is an ordinary mistake. What that
    // one digit moves is not cosmetic — payment_date decides the BTW quarter under the kasstelsel
    // (vat-scheme.ts:7), and a 'kas' payment becomes a DATED drawer movement (cash-settle.ts), so
    // an impossible day lands in the kasboek the accountant reads and in the negative-drawer
    // witness that blocks the aangifte. /api/cash has refused exactly this since [CASH-DATE-SANE];
    // this is the OTHER door into the same drawer, and it had no ceiling at all. One shared,
    // tested window now (payment-date.ts), Amsterdam's day on both sides.
    //
    // An absent/empty date still falls back to today, unchanged — most callers send none. A date
    // the caller DID fill in is answered honestly instead of being silently replaced by today:
    // booking on a day the owner did not choose is the same class of quiet error.
    const rawPaymentDate = typeof body.paymentDate === "string" && body.paymentDate.trim() !== ""
      ? body.paymentDate.trim()
      : null;
    if (rawPaymentDate && paymentDateOutOfWindow(rawPaymentDate, amsterdamToday())) {
      return NextResponse.json(
        { error: "invalid_payment_date", detail: PAYMENT_DATE_REFUSAL },
        { status: 400 }
      );
    }
    const paymentDate = rawPaymentDate ?? amsterdamToday();

    // [MANUAL-PARTIAL-PAY] An optional amount turns this into a DEELBETALING. Absent (the
    // empty field — the common case) it means "settle the whole remaining balance", which is
    // exactly what this toggle always did. Rejected here rather than silently coerced: a
    // number we cannot trust must never reach the money path.
    const rawAmount = (body as { amount?: unknown }).amount;
    let payAmount: number | null = null;
    if (rawAmount != null && rawAmount !== "") {
      const parsed = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
      }
      payAmount = round2(parsed);
    }

    // [CASH-INSTALMENT] A partial CASH payment used to be refused here. The reason was real: the
    // kasboek held exactly one settlement entry per invoice, so a second cash instalment
    // collapsed into that entry and re-dated it to the latest one — retroactively moving money
    // out of an already-filed quarter and leaving the daily drawer balance wrong in between.
    // cash_entries now carries settlement_id, one row per instalment with its own date and
    // amount (cash_settlement_per_instalment.sql), so the refusal is gone: paying a supplier
    // from the till in two handovers is recorded as the two movements it was.
    //
    // [DEPLOY-SAFE] …but only once that column really exists. Code ships before a migration is
    // applied, and accepting the payment in that window would be the worst of both: the
    // instalment is recorded on the invoice while the drawer never moves, so the kasboek silently
    // understates what left the till. Until the migration lands we keep the old, honest refusal.
    if (payAmount != null && paymentMethod === "kas" && !(await cashInstalmentsSupported(supabase))) {
      return NextResponse.json(
        { error: "partial_cash_unsupported", detail: "Een deelbetaling kan op dit moment alleen via bank worden genoteerd." },
        { status: 400 }
      );
    }
    // Idempotency key: LEAST() clamps over-payment but does NOT deduplicate, so without
    // this a double tap or a retried POST would book the instalment twice.
    const rawKey = (body as { clientKey?: unknown }).clientKey;
    const clientKey = typeof rawKey === "string" && UUID_RE.test(rawKey) ? rawKey : null;

    // Session client so the B.4 'verwerkt' trigger sees a real auth.uid(); the RPC also
    // re-checks verwerkt AND the payable status under its own row lock.
    const { data: applyRows, error } = await supabase.rpc("apply_manual_payment", {
      p_user_id: user.id,
      p_invoice_id: invoiceId,
      p_amount: payAmount,
      p_pay_date: paymentDate,
      p_method: paymentMethod,
      p_payable_statuses: PAYABLE,
      p_client_key: clientKey,
    });
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (msg.includes("already fully paid") || msg.includes("already covered")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      // [PAY-DATE-SANE] The database has the same rule as a backstop (bookkeeping_date_sane.sql).
      // It cannot fire from here — the window is checked above — but if it ever does, because a
      // future caller skips that check or the two windows drift, the owner gets the Dutch sentence
      // rather than a PL/pgSQL exception at a 500.
      if (msg.includes("[pay-date-sane]")) {
        return NextResponse.json({ error: "invalid_payment_date", detail: PAYMENT_DATE_REFUSAL }, { status: 400 });
      }
      if (msg.includes("not payable")) {
        return NextResponse.json(
          { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
          { status: 409 }
        );
      }
      // [PAY-KEY-SCOPE] The idempotency key the browser sent is spent on a DIFFERENT booking —
      // another invoice, or another user. It is not a replay of this payment, so the RPC refuses
      // rather than reporting someone else's figures back as a duplicate. Reachable from an
      // ordinary retry that reused its key, so it gets its own answer: a 409 with a sentence the
      // owner can act on, not a 500 carrying a PL/pgSQL string.
      if (msg.includes("idempotency key")) {
        return NextResponse.json(
          {
            error: "client_key_conflict",
            detail: "Deze betaling is met dezelfde referentie al op een andere factuur vastgelegd. Ververs de pagina en probeer het opnieuw.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "pay_failed", detail: error.message }, { status: 500 });
    }
    const row = Array.isArray(applyRows)
      ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean; duplicate: boolean } | undefined)
      : undefined;
    if (!row) return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });

    const fullyPaid = row.is_paid === true;
    const remaining = Math.max(0, round2((row.total ?? 0) - (row.amount_paid ?? 0)));

    // A replayed request changed nothing on the INVOICE — report the already-booked state, never a
    // second audit row. Same shape as the real booking below: both go through buildPaymentResult so
    // the two answers can never drift apart again.
    //
    // [CASH-RETRY] It does still reconcile the kasboek, and that is not a contradiction. A replay
    // exists precisely because the FIRST attempt did not finish: apply_manual_payment committed the
    // instalment and the handler was then cut off before its reconcile ran. The drawer entry for
    // that cash payment is exactly what would be missing. The pass is idempotent (it heals or
    // creates, it does not duplicate — cash-settle.ts), so running it here costs nothing and closes
    // the one gap a replay is for. Until now the only thing covering this branch was the manage
    // screen firing a second /api/cash/settle of its own — which no other caller of this route did.
    if (row.duplicate === true) {
      await reconcileCashWithRetry(supabase, user.id);
      return NextResponse.json(buildPaymentResult(row, inv.status));
    }

    // Only a COMPLETED payment clears the prepared marker; a partial one leaves the
    // invoice open, so the "Heb je betaald?" CTA must stay where the owner expects it.
    if (fullyPaid) {
      await supabase.from("invoices").update({ payment_prepared_at: null }).eq("id", invoiceId);
    }

    await logAuditAction({
      userId: user.id,
      action: fullyPaid ? "invoice.status_changed" : "invoice.partial_payment",
      entityType: "invoice", entityId: invoiceId,
      oldValue: { status: inv.status, amount_paid_before: Math.max(0, (row.amount_paid ?? 0) - (row.applied ?? 0)) },
      newValue: fullyPaid
        ? { status: "paid", payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle", applied: row.applied }
        : { status: inv.status, applied: row.applied, amount_paid: row.amount_paid, total: row.total, remaining, payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle" },
      ipAddress: getClientIP(req),
    });
    // Keep the kasboek in sync when paid in cash (create/heal the 'betaling' entry). Best-effort.
    // [CASH-RETRY] …but not deaf. reconcileCashSettlements NEVER throws — it catches internally and
    // reports `ok:false` (cash-settle.ts:167 bails on a failed id-chunk read, :261 after an internal
    // throw). That value was dropped on the floor here, so a bailed pass looked identical to a
    // successful one and this route still answered 200. The only thing that repaired it was the
    // SECOND reconcile the manage screen fired straight after — an accidental retry that the
    // client had no idea it was providing. Ask once more here instead, so the retry is deliberate
    // and every caller of this route gets it (not just the one screen that happened to double-call).
    await reconcileCashWithRetry(supabase, user.id);
    // [MANUAL-PARTIAL-PAY] Report what ACTUALLY happened. This used to be a bare
    // {ok, status:'paid'} — correct while the toggle was all-or-nothing, a lie the moment a
    // deelbetaling became possible: both clients read `partial` to decide between "still open
    // for the rest" and "settled", so an omitted flag made every first-time instalment render
    // as a completed payment (green chip, row out of the openstaand list, a "Factuur betaald"
    // notification) while the database correctly still said openstaand. Only the idempotent
    // REPLAY branch above returned the full shape — the one path that writes nothing.
    return NextResponse.json(buildPaymentResult(row, inv.status));
  }

  // ── action === 'undo' ──────────────────────────────────────────────────────
  // [PAY-GUARD] Undo is only meaningful on a PAID invoice. Guarding here also
  // prevents the destructive bank-link detach below from running for a row
  // that was never paid (a stray undo used to silently strip its links).
  // [MANUAL-PARTIAL-PAY] A PARTLY paid invoice must be undoable too — it is still 'sent' /
  // 'received', so the old `status !== 'paid'` guard made every deelbetaling permanent: one
  // mistyped instalment and the owner could never correct it. Undo is all-or-nothing by
  // design ("Deelbetalingen wissen" resets to zero paid, never half): the join rows for this
  // invoice are all removed below and amount_paid recomputes to 0.
  const paidSoFar = Math.max(0, Number((inv as { amount_paid?: number | null }).amount_paid ?? 0));
  const wasFullyPaid = inv.status === "paid";
  if (!wasFullyPaid && paidSoFar <= 0.005) {
    return NextResponse.json(
      { error: "not_paid", detail: "alleen een betaalde factuur kan worden teruggezet" },
      { status: 409 }
    );
  }

  // [BANK-UNLINK] If a bank transaction is matched to this invoice, DETACH it so we never leave
  // a paid-undone invoice beside a still-'matched' tx (which the pending-only matcher could
  // never resurface). Cover both the direct invoice_id link and any bank_tx_invoices join rows.
  //
  // [UNDO-SCOPED] Two hardenings over the old blunt detach:
  //  1. SCOPED to this invoice: a tx that also paid OTHER invoices (a batch booked via
  //     book_bank_batch) keeps its status and the siblings' join rows — only OUR link goes.
  //     The old clearPaymentLinks(tx) wiped the whole batch's reversal index and flipped a
  //     still-partially-valid payment back to 'pending'.
  //  2. ROLLBACK on a failed status write (mirrors /api/bank/unlink): the join rows are
  //     snapshotted WITH amount_applied and restored, tx status/invoice_id restored, and
  //     amount_paid recomputed — never "links destroyed but invoice still paid".

  // Snapshot this invoice's join rows (amount_applied included — a rollback must restore it,
  // it is what recompute_invoice_amount_paid sums).
  // [MANUAL-PARTIAL-PAY] `id` and the manual columns come along: a manual instalment has
  // transaction_id NULL, so a rollback keyed on (transaction_id, invoice_id) would be
  // meaningless for it — NULLs never conflict, so the upsert would INSERT duplicates and
  // inflate amount_paid. Keyed on the primary key instead, the restore is exact for both
  // kinds of row.
  // [UNDO-READ-CLOSED] Every read below is FAIL-CLOSED, and that is the whole point of doing them
  // first. They all ran with the error dropped, so a transient failure came back as an empty
  // snapshot — which does not mean "no links", it means "we do not know the links". The undo then
  // walked on anyway and did exactly the damage this route exists to prevent:
  //   · the delete further down runs unconditionally, so the join rows go — while the snapshot
  //     that the rollback restores from is empty, making the rollback a no-op;
  //   · a tx linked ONLY through the join table never reaches linkedTxIds, so it stays 'matched'
  //     with nothing pointing at it while the invoice returns to 'received' — the invoice is
  //     payable a second time and its payment is unreachable to re-link. That is defect [15] in
  //     this file's own header, reintroduced by a dropped error;
  //   · a failed `otherRows` read reads as "not a batch", so a tx that also pays OTHER invoices
  //     gets flipped back to 'pending' underneath them.
  // Nothing has been written at this point, so refusing here is genuinely free: the owner gets
  // "er is niets gewijzigd" and it is true.
  const readFailed = (what: string, message: string) => {
    console.error("[UNDO-READ-CLOSED] undo aborted before any write — could not read", { what, invoiceId, userId: user.id, message });
    return NextResponse.json(
      {
        error: "undo_read_failed",
        detail: "We konden de gekoppelde betalingen nu niet lezen. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
      },
      { status: 503 }
    );
  };

  const { data: myLinkRowsRaw, error: myLinksErr } = await pipeline
    .from("bank_tx_invoices")
    .select("id, transaction_id, amount_applied, paid_on, method, client_key")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  if (myLinksErr) return readFailed("bank_tx_invoices", myLinksErr.message);
  const myLinks = (myLinkRowsRaw ?? []) as LinkRow[];

  const { data: directTx, error: directTxErr } = await pipeline
    .from("bank_transactions").select("id").eq("user_id", user.id).eq("invoice_id", invoiceId).eq("status", "matched");
  if (directTxErr) return readFailed("bank_transactions", directTxErr.message);

  const linkedTxIds = new Set<string>();
  for (const t of directTx ?? []) if (t.id) linkedTxIds.add(t.id);
  for (const l of myLinks) if (l.transaction_id) linkedTxIds.add(l.transaction_id);

  // Per-tx prior state + "does it also pay other invoices?" (batch detection).
  const txPrev = new Map<string, { status: string | null; invoice_id: string | null; hasOthers: boolean; otherInvoiceId: string | null }>();
  for (const txId of linkedTxIds) {
    const [{ data: txRow, error: txErr }, { data: otherRows, error: othersErr }] = await Promise.all([
      pipeline.from("bank_transactions").select("status, invoice_id").eq("id", txId).eq("user_id", user.id).maybeSingle(),
      // [BATCH-DETACH] De zusterkoppeling levert nu haar invoice_id, niet alleen haar bestaan.
      // Die is nodig om de bankregel te HERWIJZEN in plaats van hem op null te zetten — zie de
      // toelichting bij de detach-tak zelf. Geordend zodat twee lezingen dezelfde zuster kiezen.
      pipeline.from("bank_tx_invoices").select("invoice_id").eq("user_id", user.id).eq("transaction_id", txId).neq("invoice_id", invoiceId).order("invoice_id", { ascending: true }).limit(1),
    ]);
    if (txErr) return readFailed("bank_transactions row", txErr.message);
    if (othersErr) return readFailed("bank_tx_invoices siblings", othersErr.message);
    // No error and no row: the transaction genuinely is not there any more (a deleted statement).
    // Nothing to detach, and nothing unknown about it.
    if (!txRow) continue;
    txPrev.set(txId, {
      status: (txRow as { status: string | null }).status,
      invoice_id: (txRow as { invoice_id: string | null }).invoice_id,
      hasOthers: (otherRows ?? []).length > 0,
      otherInvoiceId: ((otherRows ?? [])[0] as { invoice_id?: string | null } | undefined)?.invoice_id ?? null,
    });
  }

  // [UNDO-EIGEN-WERK] A rollback may only undo the writes THIS request actually made.
  //
  // The rollback used to restore from `myLinks` and `txPrev` — the snapshot taken at the START of
  // the request. Under two concurrent undos on the same invoice that resurrects a payment the owner
  // deliberately removed, through the branch that exists precisely FOR a lost race:
  //
  //   A snapshots [L1]; B snapshots [L1].
  //   A detaches, deletes L1, recomputes, flips the invoice paid → received. Done, correct.
  //   B detaches (already detached), deletes (0 rows — L1 is gone), recomputes (0), and then its
  //   invoice UPDATE carries `.eq('status','paid')`, which now matches nothing.
  //   B falls into the honest-zero-row branch, calls this rollback, and upserts L1 back FROM ITS
  //   OWN STALE SNAPSHOT — with the bank transaction restored to 'matched' pointing at the invoice.
  //
  // The invoice ends 'received' with amount_paid standing on a link the owner deleted, and the
  // transaction is 'matched' again so the matcher will never resurface it. Two taps on two devices
  // is enough; the undo path has no idempotency key, unlike the pay path.
  //
  // So the rollback restores `deletedLinks` — what the DELETE reported it actually removed — and
  // reverts only transactions this request actually wrote. B deleted nothing, so B restores
  // nothing. The other direction still works: an undo that really did delete the links and then
  // failed on the invoice write puts them back, which is what this rollback is for.
  //
  // These are filled in by the writes below, which is why they are `let`/mutable here: the rollback
  // has to be DEFINED before the first destructive write, but it must READ what those writes did.
  let deletedLinks: LinkRow[] = [];
  const wroteTx = new Map<string, { status: string | null; invoiceIdSetTo: string | null }>();

  const rollbackBankState = async () => {
    try {
      if (deletedLinks.length > 0) {
        // Restore by PRIMARY KEY — see the snapshot comment: a manual row's NULL
        // transaction_id makes the (transaction_id, invoice_id) target useless, and a
        // failed undo would then duplicate instalments instead of restoring them.
        await pipeline.from("bank_tx_invoices").upsert(
          deletedLinks.map((l) => ({
            id: l.id, user_id: user.id, transaction_id: l.transaction_id,
            invoice_id: invoiceId, amount_applied: l.amount_applied,
            paid_on: l.paid_on, method: l.method, client_key: l.client_key,
          })),
          { onConflict: "id" }
        );
      }
      for (const [txId, wrote] of wroteTx) {
        const prev = txPrev.get(txId);
        if (!prev) continue;
        // Only revert a row that is STILL carrying what we wrote. If someone else has moved it
        // since, ours is no longer the last word and putting our snapshot back would overwrite
        // their work with a value that was already stale when we read it.
        let revert = pipeline.from("bank_transactions")
          .update({ status: prev.status, invoice_id: prev.invoice_id })
          .eq("id", txId).eq("user_id", user.id);
        if (wrote.status !== null) revert = revert.eq("status", wrote.status);
        // Geguard op de WAARDE die we schreven, niet op "we schreven iets". De batch-tak zet de
        // regel niet meer op null maar wijst hem naar een overlevende zuster, dus `is null` zou
        // daar nooit meer matchen en de terugdraai stil niets doen.
        revert = wrote.invoiceIdSetTo === null
          ? revert.is("invoice_id", null)
          : revert.eq("invoice_id", wrote.invoiceIdSetTo);
        await revert;
      }
      // [PARTIAL-PAY-INVARIANT] Best-effort is right HERE — this is the rollback of an operation
      // that already failed, and there is nothing left to refuse to. But the error is read and
      // logged rather than dropped: supabase-js does not throw on an RPC, so the catch around this
      // never saw it, and a rollback that half-worked left no trace at all.
      const { error: rbRecomputeErr } = await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
      if (rbRecomputeErr) {
        console.error("[PARTIAL-PAY-INVARIANT] recompute failed during rollback — amount_paid may not match the surviving links", {
          invoiceId, userId: user.id, message: rbRecomputeErr.message,
        });
      }
      // [PAYDATE-REDERIVE] The rollback restores the amount; the date has to come back with it.
      await rederivePaymentDate(pipeline, user.id, invoiceId);
    } catch { /* the bank-state restore above is itself best-effort */ }
  };

  // Detach — scoped. Batch tx (hasOthers): keep it 'matched' for the siblings, only drop a
  // direct pointer at US. Single-invoice tx: full detach back to 'pending'.
  //
  // [UNDO-EIGEN-WERK] Each write records what it actually set, so the rollback can revert exactly
  // that and nothing else. And each write's error is READ: it used to be dropped, so a failed
  // detach was followed by deleting the links anyway — the invoice went unpaid while its
  // transaction stayed 'matched' and pointed at it, which is defect [15] in this file's own header
  // arriving through a different door. Nothing has been deleted yet at this point, so refusing is
  // still free.
  for (const [txId, prev] of txPrev) {
    if (prev.hasOthers) {
      if (prev.invoice_id === invoiceId) {
        // [BATCH-DETACH] HERWIJZEN, niet leegmaken.
        //
        // Deze tak liet de status op 'matched' staan — terecht, want de regel betaalt nog steeds
        // andere facturen — en zette tegelijk invoice_id op null. Die twee samen zijn een stand
        // die nergens meer thuishoort, en drie dingen gaan er tegelijk mis:
        //
        //   · financial-result telt een bankregel alleen NIET mee op `if (t.invoice_id) continue`.
        //     Geen status erbij. Met een lege pointer en een categorie (die de auto-categorisatie
        //     bij het importeren zet) boekt het volle bedrag van de regel een TWEEDE keer als kost
        //     of omzet, bovenop de facturen die hij betaalde en die gewoon blijven meetellen;
        //   · /api/bank/match haalt alleen status='pending' op, dus de regel komt nooit terug in
        //     "Te bevestigen";
        //   · /api/bank/unlink weigert met not_linked zodra invoice_id leeg is.
        //
        // De regel is daarmee eindstation: dubbel geteld en door geen enkele deur meer te
        // bereiken — terwijl bulk-undo-pay.ts de eigenaar belooft dat "de bankregel zich weer
        // aanbiedt om te koppelen".
        //
        // De juiste waarde is er gewoon: een van de koppelingen die blijft staan. book_bank_batch
        // kiest bij het BOEKEN op dezelfde manier een vertegenwoordiger; dit is de omkering ervan.
        //
        // bank_tx_invoices.invoice_id is NOT NULL, dus een zuster die bestaat draagt er altijd een.
        // Mocht die aanname ooit toch niet gelden, dan is leegmaken het ENE antwoord dat niet mag:
        // dat is precies de eindstandtoestand hierboven. Dan liever weigeren — er is op dit punt
        // nog niets verwijderd, dus weigeren kost niets.
        if (!prev.otherInvoiceId) {
          await rollbackBankState();
          console.error("[BATCH-DETACH] zusterkoppeling zonder factuur — niet losgekoppeld", { invoiceId, txId, userId: user.id });
          return NextResponse.json(
            { error: "undo_failed", detail: "De betaling kon niet worden losgekoppeld. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
            { status: 503 }
          );
        }
        const { error } = await pipeline.from("bank_transactions")
          .update({ invoice_id: prev.otherInvoiceId }).eq("id", txId).eq("user_id", user.id);
        if (error) {
          await rollbackBankState();
          console.error("[UNDO-EIGEN-WERK] batch detach failed — nothing deleted yet", { invoiceId, txId, userId: user.id, message: error.message });
          return NextResponse.json(
            { error: "undo_failed", detail: "De betaling kon niet worden losgekoppeld. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
            { status: 503 }
          );
        }
        // status untouched on this branch, so the revert is guarded on the pointer we wrote.
        wroteTx.set(txId, { status: null, invoiceIdSetTo: prev.otherInvoiceId });
      }
    } else {
      const { error } = await pipeline.from("bank_transactions")
        .update({ status: "pending", invoice_id: null })
        .eq("id", txId).eq("user_id", user.id);
      if (error) {
        await rollbackBankState();
        console.error("[UNDO-EIGEN-WERK] detach failed — nothing deleted yet", { invoiceId, txId, userId: user.id, message: error.message });
        return NextResponse.json(
          { error: "undo_failed", detail: "De betaling kon niet worden losgekoppeld. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
          { status: 503 }
        );
      }
      wroteTx.set(txId, { status: "pending", invoiceIdSetTo: null });
    }
  }
  // Remove ONLY this invoice's join rows (never the whole tx's set).
  // [UNDO-READ-CLOSED] The delete's own error was dropped too. If it fails, the transactions
  // above are already detached while their links survive — so put the bank state back and say so,
  // rather than continuing to mark the invoice unpaid on top of payments that still exist.
  //
  // [UNDO-EIGEN-WERK] `.select()` so the delete REPORTS what it removed. That list — not the
  // snapshot read at the top of the request — is what a rollback may put back. A concurrent undo
  // that lost the race deletes nothing here and therefore restores nothing.
  const { data: deletedRaw, error: delErr } = await pipeline
    .from("bank_tx_invoices").delete()
    .eq("user_id", user.id).eq("invoice_id", invoiceId)
    .select("id, transaction_id, amount_applied, paid_on, method, client_key");
  deletedLinks = (deletedRaw ?? []) as LinkRow[];
  if (delErr) {
    await rollbackBankState();
    console.error("[UNDO-READ-CLOSED] link delete failed — bank state restored", { invoiceId, userId: user.id, message: delErr.message });
    return NextResponse.json(
      { error: "undo_failed", detail: "De betaling kon niet worden losgekoppeld. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 }
    );
  }
  // Reconcile amount_paid from surviving links (0 once all are cleared). Atomic.
  // [UNDO-READ-CLOSED] The try/catch around this never fired (supabase-js reports an rpc failure
  // in `error`, it does not throw), so a failed recompute left amount_paid standing on links that
  // no longer exist: the invoice would return to 'received' still claiming "Deels betaald · € X
  // open" for money nobody paid, and the pay dialog would cap the owner at that invented
  // remainder. Roll back and refuse instead — the invoice write has not happened yet.
  const { error: recomputeErr } = await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
  if (recomputeErr) {
    await rollbackBankState();
    console.error("[UNDO-READ-CLOSED] recompute failed — bank state restored", { invoiceId, userId: user.id, message: recomputeErr.message });
    return NextResponse.json(
      { error: "undo_failed", detail: "De betaling kon niet worden teruggedraaid. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 }
    );
  }

  const restoredStatus = isIncoming ? "received" : "sent";
  // [MANUAL-PARTIAL-PAY] Two shapes of undo:
  //  · a FULLY paid invoice returns to its open status (unchanged behaviour, and the
  //    `.eq('status','paid')` keeps it race-proof: two undos, only one wins).
  //  · a PARTLY paid one is already open — only the payment traces are wiped. Requiring
  //    status 'paid' there would match zero rows and report a false failure, and the
  //    payment fields (a first instalment stamps payment_date) would linger on an
  //    invoice that is back to nothing-paid.
  // amount_paid itself is already recomputed to 0 by the RPC above, once its links are gone.
  const undoQuery = supabase
    .from("invoices")
    .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null, payment_prepared_at: null })
    .eq("id", invoiceId);
  const { data: undoData, error: undoErr } = await (wasFullyPaid
    ? undoQuery.eq("status", "paid")
    : undoQuery.in("status", isIncoming ? ["received"] : ["sent", "overdue"])
  ).select("id");
  if (undoErr) {
    await rollbackBankState();
    if (undoErr.message?.toLowerCase().includes("verwerkt")) {
      return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
    }
    return NextResponse.json({ error: "undo_failed", detail: undoErr.message }, { status: 500 });
  }
  // [PAY-GUARD] Honest zero-row report: if the row raced away from 'paid'
  // between the pre-check and this write, say so instead of claiming success.
  if (!undoData || undoData.length === 0) {
    await rollbackBankState();
    return NextResponse.json({ error: "status_conflict", detail: "factuur is niet (meer) betaald" }, { status: 409 });
  }

  // [PAYDATE-REDERIVE] The clear above is right for the case this path is written for — every link
  // is gone, so there is no payment left to be dated. It is wrong for any invoice where one
  // survived, and this restores the date for exactly that case: with nothing left to derive from,
  // the re-derive writes nothing at all and the null stands.
  await rederivePaymentDate(pipeline, user.id, invoiceId);

  await logAuditAction({
    userId: user.id, action: "invoice.status_changed", entityType: "invoice", entityId: invoiceId,
    oldValue: { status: "paid" }, newValue: { status: restoredStatus, via: "manual_undo_toggle", detached_transactions: [...linkedTxIds] },
    ipAddress: getClientIP(req),
  });
  await reconcileCashWithRetry(supabase, user.id);
  return NextResponse.json({ ok: true, status: restoredStatus, detached: linkedTxIds.size });
}
