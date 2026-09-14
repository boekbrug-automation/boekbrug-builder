// src/app/api/bank/allocate/route.ts
// [BETAALPLAN] One bank line, several invoices, an amount per invoice — booked as ONE decision.
//
// ── WHY THIS ROUTE EXISTS NEXT TO /api/bank/confirm ──
// confirm books ONE invoice. A batch had to be N calls to it, and N independent calls cannot see
// the thing that actually matters: their sum. Each of three calls booking €3.000, €2.000 and
// €1.200 against a €5.000 debit is individually reasonable and collectively books €1.200 that never
// left the account. Nothing downstream — the P&L, the BTW return, the accountant's package — can
// tell that it did not.
//
// So the plan is validated as a WHOLE first (payment-plan.ts, 22 tests), and only then applied.
//
// That pre-flight check is NOT the last line of defence, and saying so matters. allocate_bank_payment
// re-reads Σ amount_applied of the line's other links UNDER the transaction lock and refuses there
// too — atomically, which nothing in TypeScript can be. The check here exists to tell the owner
// what is wrong BEFORE half a batch is booked; the database is what makes it true.
//
// ── WHAT "ATOMIC" MEANS HERE, HONESTLY ──
// Every line goes through allocate_bank_payment — one call per line, because that function is where
// the per-invoice locking, the amount_paid recompute and the 'verwerkt' guard live, and
// reimplementing that here would be a second source of truth for money.
//
// That means the loop is not one database transaction. The whole-plan validation runs BEFORE any
// write precisely because of that: by the time the first line is applied, the plan is known to fit
// the payment and every invoice. What can still fail mid-way is a concurrent booking claiming the
// same transaction — and then this route stops, reports exactly which lines landed, and leaves the
// rest alone. It never retries and never partially guesses: a half-applied batch that SAYS it is
// half-applied is recoverable, and one that claims success is not.
//
// ── AND WHAT IT REFUSES TO DECIDE ──
// The leftover. Money this plan does not explain is reported and left where it is. It could be a
// bank charge, an early-payment discount, or an invoice that was never imported, and those have
// different right answers. Naming the amount and leaving the reason to the owner is the honest
// shape; guessing it writes a number into an administration with our name on it.

import { NextRequest, NextResponse } from "next/server";
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwnerPermission } from "@/lib/access/context";
import { resolvePaymentPlan, remainderNote, type PlanInvoice, type PlanLine } from "@/lib/payment-plan";
import { round2 } from "@/lib/invoice-totals";
import { allocatedOnLine } from "@/lib/bank-line-budget";

export const dynamic = "force-dynamic";
// A ten-invoice batch is ten RPC calls, each locking and recomputing. Well above the real work.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A plan larger than this is not a batch, it is a mistake or a script. */
const MAX_LINES = 40;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [OWNER-ONLY] Booking money is the owner's own act — a linked accountant may look, never book.
  const { response: notOwner } = await requireOwnerPermission("payment.allocate", "Een betaling boeken");
  if (notOwner) return notOwner;

  let body: { transactionId?: string; lines?: PlanLine[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const transactionId = body.transactionId;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!transactionId || !UUID_RE.test(transactionId)) {
    return NextResponse.json({ error: "invalid_transaction" }, { status: 400 });
  }
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Kies eerst minstens één factuur." }, { status: 400 });
  }
  if (rawLines.length > MAX_LINES) {
    return NextResponse.json(
      { error: `Een betaling verdelen over meer dan ${MAX_LINES} facturen gaat niet in één keer.` },
      { status: 400 },
    );
  }
  for (const l of rawLines) {
    if (!l || typeof l.invoiceId !== "string" || !UUID_RE.test(l.invoiceId)) {
      return NextResponse.json({ error: "invalid_invoice_id" }, { status: 400 });
    }
  }

  const pipeline = createPipelineClient();

  // ── The bank line, scoped to its owner ────────────────────────────────────
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, user_id, amount, date, status")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr || !tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });

  // ── What this line already gave away ──────────────────────────────────────
  // amount_applied, NOT a column of our own: it is what apply_bank_payment itself writes, what the
  // unlink reversal reads, and what recompute_invoice_amount_paid derives amount_paid from. A
  // second column for the same fact was written here first and read by nothing — see the header of
  // bank_tx_invoices_amount.sql for how that happened and what it cost.
  //
  // NULL means a link from before that column existed, which by construction settled its invoice
  // in full — so the invoice's total is what it took. Reading NULL as 0 would let the same euros
  // be spent twice.
  // [CREDITNOTA] SIGNED, exactly as allocate_bank_payment computes the same sum under the lock.
  // A credit already linked to this line did not TAKE €150 from it, it GAVE €150 to it — summing
  // magnitudes reads that as −€300 of budget and refuses plans that fit perfectly well. The
  // pre-flight check and the database have to agree about what a line has left, or the screen
  // refuses what the database would accept (or, worse, the other way round).
  let alreadyAllocated = 0;
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links, error: linksErr } = await (pipeline as any)
      .from("bank_tx_invoices")
      .select("invoice_id, amount_applied")
      .eq("transaction_id", transactionId)
      .eq("user_id", user.id);
    // [KOPPELING-ONBEKEND] A failed read here is NOT "this line has given nothing away".
    //
    // The paragraph above states the rule twice — reading a link as zero "would let the same euros
    // be spent twice", and a budget that is too large is "the one direction this sum may never err
    // in". Three paths honour it: a NULL amount_applied, an invoice this user cannot read, and the
    // plan's own invoice read below (which returns 500 on its error). This one did not. On a failed
    // read `links` is null, so rows is empty, the whole guarded block is skipped, alreadyAllocated
    // stays 0 — and the owner is offered the FULL line to allocate again, silently.
    //
    // /api/bank/confirm computes the same sum at the sibling door and already answers this the
    // right way: it sets appliedElsewhereKnown = false, "which makes that guard stricter, never
    // looser". Two doors, one rule; this is the one that was missing it.
    if (linksErr) {
      return NextResponse.json(
        {
          error:
            "We konden niet nagaan wat er al aan deze betaling is gekoppeld. Ververs de pagina en " +
            "probeer het opnieuw — zolang dat onbekend is, kunnen we dit bedrag niet veilig verdelen.",
        },
        { status: 503 },
      );
    }
    const rows = (links ?? []) as Array<{ invoice_id: string; amount_applied: number | null }>;
    if (rows.length > 0) {
      // [IN-CHUNK] Gechunkt. De guard hieronder ving een onvolledige lezing al op — elke niet
      // gelezen id werd 'unknown' en de route weigerde — dus dit kostte geen verkeerd bedrag maar
      // een geweigerde boeking. Bij een regel die over veel facturen is verdeeld was de kale
      // `.in()` zélf de reden dat die weigering kwam.
      let linked: Array<{ id: string; direction: string | null; invoice_type: string | null; total_inc_btw: number | null }> = [];
      try {
        linked = await fetchAllRowsForIds(rows.map((r) => r.invoice_id), (chunk, from, to) =>
          pipeline
            .from("invoices")
            .select("id, direction, invoice_type, total_inc_btw")
            .in("id", chunk)
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .order("id", { ascending: true })
            .range(from, to),
        );
      } catch (e) {
        console.error("[ALLOCATE] gekoppelde facturen lezen mislukt", { txId: tx.id, e });
      }
      const sum = allocatedOnLine(rows, linked, Number(tx.amount) || 0);
      // A link whose invoice this user cannot read means the read is incomplete, not that the link
      // gave nothing. Counting it as zero makes the budget too large, which is the one direction
      // this sum may never err in — so the route refuses instead of booking against a number it
      // knows is wrong. allocate_bank_payment reads the same links under its lock and would refuse
      // too; saying so here means the owner learns it before half a batch is booked.
      if (sum.unknownInvoiceIds.length > 0) {
        return NextResponse.json(
          { error: "Deze betaling is gekoppeld aan een factuur die niet gelezen kan worden. Ververs de pagina." },
          { status: 409 },
        );
      }
      alreadyAllocated = sum.allocated;
    }
  }

  // ── The invoices the plan names ───────────────────────────────────────────
  const ids = rawLines.map((l) => l.invoiceId);
  // [IN-CHUNK] Gechunkt, en de fout blijft leiden tot 500: dit zijn de facturen waar het plan geld
  // op wil boeken, dus een halve lezing mag hier nooit als het geheel doorgaan.
  let invRows: Array<{
    id: string; direction: string | null; invoice_type: string | null; total_inc_btw: number | null
    amount_paid: number | null; invoice_number: string | null; accountant_status: string | null; status: string | null
  }>;
  try {
    invRows = await fetchAllRowsForIds(ids, (chunk, from, to) =>
      pipeline
        .from("invoices")
        .select("id, direction, invoice_type, total_inc_btw, amount_paid, invoice_number, accountant_status, status")
        .in("id", chunk)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch {
    return NextResponse.json({ error: "invoice_read_failed" }, { status: 500 });
  }

  // [STATUS-GUARD] The same exclusion every other booking door applies (bank-matching.ts
  // EXCLUDED_STATUSES, with the reason spelled out there): a 'processing' row is an UNVERIFIED
  // read — paying it promotes it out of the verify queue with no way back; an 'archived' row is
  // an invoice /supersede just took out of the books — paying it revives the duplicate; 'draft'
  // is not a debt; 'paid' has nothing left to receive. The screen filters these out of its
  // picker, but a screen filter is not a guard: this route accepts ids. The RPC behind it
  // refuses only 'paid', so without this check the other three walked through.
  const ineligible = invRows.find((r) => ["draft", "archived", "processing"].includes(r.status ?? ""));
  if (ineligible) {
    return NextResponse.json(
      {
        error: "invoice_not_bookable",
        invoiceNumber: ineligible.invoice_number,
        detail:
          ineligible.status === "processing"
            ? "Deze factuur staat nog in de controlewachtrij. Bevestig hem eerst; daarna kun je er een betaling aan toewijzen."
            : "Deze factuur is geen open post meer en kan geen betaling ontvangen.",
      },
      { status: 409 },
    );
  }

  const invoices: PlanInvoice[] = invRows.map((r) => ({
    id: r.id,
    direction: r.direction === "outgoing" ? "outgoing" : "incoming",
    invoiceType: r.invoice_type,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }));

  // [VERWERKT] An invoice the accountant has already processed is closed to new money. The RPC
  // enforces it too; refusing here means the owner learns it BEFORE half the batch is booked.
  const locked = invRows.find((r) => r.accountant_status === "verwerkt");
  if (locked) {
    return NextResponse.json(
      { error: "verwerkt", invoiceNumber: locked.invoice_number },
      { status: 409 },
    );
  }

  // ── The whole plan, before any write ──────────────────────────────────────
  const plan = resolvePaymentPlan({
    txAmount: Number(tx.amount) || 0,
    alreadyAllocated,
    lines: rawLines.map((l) => ({ invoiceId: l.invoiceId, amount: Number(l.amount) })),
    invoices,
  });
  if (!plan.ok) {
    return NextResponse.json({ error: plan.message, reason: plan.reason, invoiceId: plan.invoiceId }, { status: 400 });
  }

  // ── Apply, line by line, stopping honestly ────────────────────────────────
  //
  // [CREDITNOTA-VOLGORDE] Credit lines FIRST, and this is not a preference — the batch is wrong
  // without it. A credit does not spend the bank line, it raises what the line has to give: on a
  // €850 debit made of a €1.000 invoice and a €150 credit, the line is worth €850 until the credit
  // is booked and €1.000 after. Apply the invoice first and allocate_bank_payment caps it at the
  // €850 it can see — booking a €1.000 invoice as €850 paid, spending the line to the cent so it
  // flips to 'matched', and leaving the credit to return empty against a line that is no longer
  // pending. One ordinary supplier payment, wrong in three places.
  //
  // Sorting by the SIGNED amount puts every negative line in front. The database is sign-aware too
  // (allocate_bank_payment reads each linked invoice's own type), so this ordering makes the batch
  // possible rather than making it correct — correctness is the function's, as it has to be.
  const ordered = [...plan.lines].sort((a, b) => a.amount - b.amount);
  const applied: Array<{ invoiceId: string; amount: number; fullyPaid: boolean }> = [];
  for (const line of ordered) {
    // [BETAALPLAN] allocate_bank_payment, NOT apply_bank_payment.
    //
    // apply_bank_payment ends by setting the transaction to 'matched' unconditionally — its own
    // comment says "instalment semantics: one tx → one invoice, so the tx is fully consumed" — and
    // it opens by refusing any transaction that is not 'pending'. Looping it meant the first
    // invoice booked, the line locked itself, and every line after it returned empty. EVERY
    // multi-invoice allocation failed after its first invoice.
    //
    // allocate_bank_payment (allocate_bank_payment.sql) is that function's amount control joined to
    // confirm_bank_payment's line accounting: it flips the line to 'matched' only when the line is
    // spent to the cent, so the next line of the same plan can still reach it.
    const { data: rows, error } = await supabase.rpc("allocate_bank_payment", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: line.invoiceId,
      // A MAGNITUDE. The creditnota's minus lives in the plan's arithmetic, not on the link: per
      // INVOICE the link means "this much of it was settled", which is positive for a creditnota
      // too — that is what recompute_invoice_amount_paid and the unlink reversal both need. The
      // sign is re-derived where it is needed (money-invariants.ts) from the invoice's own type.
      p_amount: Math.abs(line.amount),
      p_pay_date: tx.date ?? null,
    });

    if (error || !Array.isArray(rows) || rows.length === 0) {
      // Stop. Report what landed rather than pressing on — a batch that says it is half-applied
      // can be finished by hand; one that claims success cannot be found again.
      return NextResponse.json(
        {
          error: error?.message?.toLowerCase().includes("verwerkt")
            ? "Een van deze facturen is intussen door je boekhouder verwerkt. De rest is niet geboekt."
            : "De verdeling is halverwege gestopt. Wat hieronder staat is wél geboekt — controleer de rest.",
          partial: true,
          applied,
          failedInvoiceId: line.invoiceId,
        },
        { status: 409 },
      );
    }

    // [BETAALPLAN] Report what the DATABASE booked, not what we asked it to book.
    //
    // The two can differ by up to two cents: allocate_bank_payment absorbs that much rounding
    // drift rather than blowing up a valid batch (beyond it, it refuses and we never get here).
    // Echoing line.amount back meant the screen and the audit trail both stated a number that is
    // not in the invoice — small, and precisely the kind of small that is impossible to find later
    // because nothing anywhere records that it was changed.
    //
    // The sign is ours to re-apply: the RPC deals in magnitudes per invoice, the plan in signed
    // amounts, and the caller reads this list as a plan.
    const row = rows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean };
    const booked = Number(row.applied);
    const bookedSigned = Number.isFinite(booked)
      ? Math.sign(line.amount) * Math.abs(booked)
      : line.amount;
    applied.push({ invoiceId: line.invoiceId, amount: bookedSigned, fullyPaid: row.is_paid === true });

    // [BETAALPLAN] Nothing is written to the link here, on purpose. allocate_bank_payment already
    // records amount_applied itself and accumulates it on conflict, which is also what the unlink
    // reversal reads. Writing a second column beside it was this route's first version and it was
    // dead on arrival — bank_tx_invoices_amount.sql now removes it and says why.
  }

  // [BETAALPLAN] The totals are re-derived from what LANDED, not from the plan. plan.allocated is
  // what the owner asked for and the two can differ by the cents the database absorbed — and the
  // remainder is the one number on this screen the owner is invited to go and explain. Reporting a
  // planned remainder next to a booked allocation sends them looking for a bank charge that is
  // really our own rounding.
  const booked = round2(applied.reduce((s, a) => s + a.amount, 0));
  const remainder = round2(plan.allocated + plan.remainder - booked);

  await logAuditAction({
    userId: user.id,
    action: "bank.payment_allocated",
    entityType: "bank_transaction",
    entityId: transactionId,
    newValue: {
      lines: applied.length,
      allocated: booked,
      remainder,
      // Kept only when it differs, so the trail says "this was not what was asked for" and stays
      // silent the other 99% of the time.
      ...(Math.abs(booked - plan.allocated) > 0.004 ? { requested: plan.allocated } : {}),
      invoiceIds: applied.map((a) => a.invoiceId),
    },
    ipAddress: getClientIP(req),
  }).catch(() => { /* an audit failure must never undo a correct booking */ });

  return NextResponse.json({
    ok: true,
    applied,
    allocated: booked,
    remainder,
    remainderNote: remainderNote(remainder),
  });
}
