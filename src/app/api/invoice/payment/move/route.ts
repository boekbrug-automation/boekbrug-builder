// src/app/api/invoice/payment/move/route.ts
// [MOVE-PAYMENT] Move one booked payment from the invoice that has it to the invoice that should.
//
//   GET  ?invoiceId=<id>  → the invoice's payments + the invoices each could move to
//   POST { linkId, targetInvoiceId } → move it
//
// Why this exists: money lands on the wrong invoice — a supplier's corrected re-issue, a matcher
// choosing the wrong one of two equal amounts, a tap on the wrong row. The answer used to be
// "undo the payment, find the bank line again, book it on the other invoice": three actions, and
// between the first and the last the money exists nowhere. An owner interrupted halfway leaves the
// books in that half state.
//
// The WRITE is one transaction and lives entirely in the move_invoice_payment RPC — this route
// never moves money in steps. It authenticates, hands over two ids, and translates the refusal.
// The pre-checks here (payment-move.ts) exist to keep the picker honest, never as the guard: the
// RPC re-reads and re-decides everything under a row lock, because a client answer is not a
// permission and the read below can be seconds stale.

import { NextRequest, NextResponse } from "next/server";
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  rankMoveTargets,
  moveFailureText,
  type MoveTargetCandidate,
  type MovablePayment,
} from "@/lib/payment-move";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { reconcileCashWithRetry } from "@/lib/cash-settle";
import { requireOwnerPermission } from '@/lib/access/context'

export const dynamic = "force-dynamic";

const INVOICE_FIELDS =
  // [MOVE-CREDITNOTA] invoice_type rides along, and it is not decoration: canReceivePayment reads
  // an ABSENT type as "not a creditnota", which is the permissive answer. A column we forget to
  // ask for therefore turns the guard off without failing anywhere.
  "id, status, direction, invoice_type, invoice_number, client_name, invoice_date, total_inc_btw, amount_paid, accountant_status";

// ── GET — what can move, and where to ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwnerPermission('payment.allocate', 'Een betaling verplaatsen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  // Two ways in, because the owner realises the mistake from two directions. From the INVOICE
  // ("this payment does not belong here") the caller knows the invoice. From the BANK page ("this
  // line is booked on the wrong invoice") it only knows the transaction, and which invoice that
  // line paid is precisely what it is asking. Resolving the transaction to its invoice here keeps
  // that lookup on the server, where the ownership check already lives.
  let invoiceId = req.nextUrl.searchParams.get("invoiceId");
  const transactionId = req.nextUrl.searchParams.get("transactionId");
  if (!invoiceId && transactionId) {
    const { data: txLinks, error: txLinksErr } = await pipeline
      .from("bank_tx_invoices")
      .select("invoice_id")
      .eq("user_id", user.id)
      .eq("transaction_id", transactionId)
      .limit(2);
    // [MOVE-READ-HONEST] A failed read here used to leave invoiceId null and fall out as
    // "missing_invoice" — a 400 that blames the request for a failure that was ours.
    if (txLinksErr) {
      console.error("[MOVE-READ-HONEST] transaction → invoice lookup failed", { transactionId, userId: user.id, error: txLinksErr.message });
      return NextResponse.json(
        { error: "move_lookup_failed", detail: "We konden nu niet zien bij welke factuur deze betaling hoort. Probeer het zo meteen opnieuw." },
        { status: 503 },
      );
    }
    const ids = [...new Set((txLinks ?? []).map((l) => l.invoice_id))];
    // A BATCH line pays several invoices, and "move the payment" is then ambiguous — which of
    // them? Say so instead of silently picking one; the owner can act per invoice from
    // Inkoopfacturen, where each share is visible on its own row.
    if (ids.length > 1) {
      return NextResponse.json(
        {
          error: "batch_payment",
          detail:
            "Deze betaling is over meerdere facturen verdeeld. Verplaats hem per factuur vanuit Inkoopfacturen, dan blijft zichtbaar welk deel waar hoort.",
        },
        { status: 409 },
      );
    }
    invoiceId = ids[0] ?? null;
  }
  if (!invoiceId) return NextResponse.json({ error: "missing_invoice" }, { status: 400 });

  // [MOVE-READ-HONEST] Every read in this handler answers a question about MONEY, so none of them
  // may fail into a confident sentence. They all did: the error was dropped and the empty result
  // became the answer.
  const readFailed = (what: string, message: string) => {
    console.error("[MOVE-READ-HONEST] payment lookup failed", { what, invoiceId, userId: user.id, message });
    return NextResponse.json(
      {
        error: "move_lookup_failed",
        detail: "We konden de betalingen van deze factuur nu niet lezen. Probeer het zo meteen opnieuw.",
      },
      { status: 503 },
    );
  };

  const { data: source, error: sourceErr } = await pipeline
    .from("invoices")
    .select(INVOICE_FIELDS)
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (sourceErr) return readFailed("source invoice", sourceErr.message);
  if (!source) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  // The payments actually booked on this invoice. A pre-[PARTIAL-PAY] row carries no amount and
  // cannot be moved (we would not know what we are moving) — it is returned WITH that fact rather
  // than hidden, so the screen can explain instead of silently offering less than the owner sees.
  //
  // [MOVE-READ-HONEST] This is the read that mattered most. A dropped error made `payments` empty,
  // the handler answered 200, and the screen said "Van deze betaling is geen boeking gevonden om
  // te verplaatsen" — a sentence reserved for one specific, permanent situation (a payment booked
  // before the join table existed). A transient failure was telling the owner their booked
  // payment does not exist.
  const { data: linkRows, error: linkRowsErr } = await pipeline
    .from("bank_tx_invoices")
    .select("id, invoice_id, amount_applied, transaction_id, paid_on, method")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  if (linkRowsErr) return readFailed("booked payments", linkRowsErr.message);
  const payments = ((linkRows ?? []) as MovablePayment[]).map((l) => ({
    ...l,
    amount_applied: Math.max(0, Number(l.amount_applied ?? 0)),
  }));

  if (payments.length === 0) {
    return NextResponse.json({ ok: true, source, payments: [], targets: [] });
  }

  // Candidates: the owner's own invoices in the SAME direction that can still receive money.
  // "Enough left over" cannot be asked of the database (it is total − amount_paid), so the set is
  // narrowed by direction and status here and decided in code (payment-move).
  //
  // TWO reads, not one uncapped one. An owner with thousands of open invoices would otherwise page
  // through all of them every time this sheet opens, and capping a single read would silently drop
  // the one candidate that matters. So: every invoice of the SAME SUPPLIER — the case this feature
  // exists for, and the one that must never be truncated — plus a bounded window of the most
  // recent others for the ordinary "wrong row" mistake. Anything older than that window is not
  // offered; the owner can still undo and re-book by hand.
  const dir = (source as MoveTargetCandidate).direction ?? "incoming";
  const base = () =>
    pipeline
      .from("invoices")
      .select(INVOICE_FIELDS)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq("direction", dir)
      .in("status", ["received", "sent", "overdue"])
      .neq("id", invoiceId);

  const vendor = ((source as MoveTargetCandidate).client_name ?? "").trim();
  const [sameVendor, recent] = await Promise.all([
    vendor
      ? base().eq("client_name", vendor).order("invoice_date", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as MoveTargetCandidate[], error: null }),
    base().order("invoice_date", { ascending: false }).limit(300),
  ]);

  // [MOVE-READ-HONEST] A failed candidate read is not "no invoice fits this payment" — and that
  // is exactly what the sheet would have said, in a sentence that reads like a considered answer
  // ("Geen factuur gevonden waar dit bedrag op past. Een factuur kan alleen…"). The owner would
  // then reasonably conclude the move is impossible and reach for the undo instead.
  const sameVendorErr = (sameVendor as { error?: { message: string } | null }).error;
  const recentErr = (recent as { error?: { message: string } | null }).error;
  if (sameVendorErr) return readFailed("same-vendor candidates", sameVendorErr.message);
  if (recentErr) return readFailed("recent candidates", recentErr.message);

  const byId = new Map<string, MoveTargetCandidate>();
  for (const row of [
    ...(((sameVendor as { data?: MoveTargetCandidate[] }).data ?? [])),
    ...(((recent as { data?: MoveTargetCandidate[] }).data ?? [])),
  ]) {
    byId.set(row.id, row);
  }
  const candidates = [...byId.values()];

  // Which invoices each payment's bank line already pays — a second link to the same pair would
  // collide with bank_tx_invoices_unique_pair, so those targets must not be offered.
  const txIds = [...new Set(payments.map((p) => p.transaction_id).filter(Boolean))] as string[];
  const linkedByTx = new Map<string, Set<string>>();
  if (txIds.length > 0) {
    // [MOVE-READ-HONEST] This read is what keeps an already-linked invoice OUT of the list. Losing
    // it silently offers targets the database will refuse (bank_tx_invoices_unique_pair), so the
    // owner picks, waits, and gets a refusal for a choice we should not have shown.
    //
    // [IN-CHUNK] Gechunkt: bij genoeg betalingen was de kale `.in()` zelf de manier waarop deze
    // lezing "stilletjes verloren" ging.
    // transaction_id is nullable in the schema; the rows we asked for are keyed on it, so the
    // filter below drops any that come back without one rather than asserting they cannot.
    let siblings: Array<{ transaction_id: string | null; invoice_id: string }>;
    try {
      siblings = await fetchAllRowsForIds(txIds, (chunk, from, to) =>
        pipeline
          .from("bank_tx_invoices")
          .select("transaction_id, invoice_id")
          .eq("user_id", user.id)
          .in("transaction_id", chunk)
          .order("invoice_id", { ascending: true })
          .range(from, to),
      );
    } catch (e) {
      return readFailed("existing links of this transaction", e instanceof Error ? e.message : "read failed");
    }
    for (const s of siblings) {
      if (!s.transaction_id) continue;
      const set = linkedByTx.get(s.transaction_id) ?? new Set<string>();
      set.add(s.invoice_id);
      linkedByTx.set(s.transaction_id, set);
    }
  }

  return NextResponse.json({
    ok: true,
    source,
    payments: payments.map((p) => ({
      ...p,
      movable: p.amount_applied > 0,
      targets: rankMoveTargets(
        p,
        source as MoveTargetCandidate,
        candidates,
        p.transaction_id ? (linkedByTx.get(p.transaction_id) ?? new Set()) : new Set(),
      ).slice(0, 50),
    })),
  });
}

// ── POST — move it ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwnerPermission('payment.allocate', 'Een betaling verplaatsen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { linkId?: string; targetInvoiceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { linkId, targetInvoiceId } = body;
  if (!linkId || !targetInvoiceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // ── [MOVE-CREDITNOTA] The second of two, and deliberately kept ───────────────────────────────
  //
  // A creditnota is money the business OWES back; it is settled by paying out or by offsetting,
  // never by RECEIVING. move_invoice_payment guarded direction, status, fit and ownership and read
  // the target's total through abs(), so a creditnota of -100 looked exactly like an invoice with
  // 100 still open. Measured: a EUR 100 payment moved onto a 'sent' creditnota came back
  // amount_paid=100, status='paid', while the sales invoice it really belonged to lost it.
  //
  // invoice_move_payment_creditnota_guard.sql is applied and verified byte-identical, so the RPC
  // now refuses this itself and this check is the second of two. It stays anyway, and the reason is
  // not caution in general: TWICE this week a function was believed deployed and was not — the
  // migration inventory's probe reads the NEW./OLD. references only a trigger function has, and
  // this very guard was one of the two it reported as applied. Both times the discovery was luck.
  // One SELECT in front of a booking that cannot be undone by looking at it is a fair price for
  // not depending on that luck again.
  //
  // It is safe to keep for the same reason it was safe to add: it can only REFUSE. A read seconds
  // stale costs a refusal of a move that would have been fine; it can never permit one the RPC
  // would not. And it says the same sentence the database does — moveFailureText matches the RPC's
  // own fragment, so one event never reads as two different problems.
  const { data: target, error: targetErr } = await supabase
    .from("invoices")
    .select("id, invoice_type")
    .eq("id", targetInvoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (targetErr) {
    // [NO-SILENT-EMPTY] A failed read is not "it is not a creditnota". Refuse rather than fall
    // through to an RPC that, today, cannot make this judgement itself.
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText(null) },
      { status: 409 },
    );
  }
  if (!target) {
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText("target invoice not found / not owned") },
      { status: 409 },
    );
  }
  if ((target as { invoice_type?: string | null }).invoice_type === "creditnota") {
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText("target is a creditnota") },
      { status: 409 },
    );
  }

  // Session client so the RPC's caller guard sees a real auth.uid() — the same contract
  // apply_manual_payment is called under. The function is SECURITY DEFINER because
  // bank_tx_invoices has no UPDATE policy at all: moving a link is precisely the operation RLS
  // does not grant, and it must only ever happen through these guards.
  const { data, error } = await supabase.rpc("move_invoice_payment", {
    p_user_id: user.id,
    p_link_id: linkId,
    p_target_invoice_id: targetInvoiceId,
  });

  if (error) {
    // The move is atomic: a failure always means NOTHING changed. Say which reason it was, in
    // words the owner can act on — never a bare code, never a shrug.
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText(error.message, (error as { code?: string }).code) },
      { status: 409 },
    );
  }

  // Typed by the generated definition now that the migration is applied — the shape below comes
  // from the function signature itself, so a change to it becomes a compile error here.
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row) {
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText(null) },
      { status: 409 },
    );
  }

  await logAuditAction({
    userId: user.id,
    action: "invoice.payment_moved",
    entityType: "invoice",
    entityId: targetInvoiceId,
    oldValue: { invoice_id: row.source_invoice_id },
    newValue: {
      link_id: linkId,
      applied: row.applied,
      from_invoice_id: row.source_invoice_id,
      to_invoice_id: targetInvoiceId,
      source_amount_paid: row.source_amount_paid,
      source_status: row.source_status,
      target_amount_paid: row.target_amount_paid,
      target_status: row.target_status,
    },
    ipAddress: getClientIP(req),
  });

  // The kasboek holds one entry per cash settlement; a moved 'kas' instalment now belongs to a
  // different invoice, so the drawer has to be re-derived. Called directly, as every sibling route
  // does — an internal HTTP hop back into our own API would depend on forwarding the cookie and
  // resolving the origin correctly, two ways to fail at a step that must not be able to fail
  // loudly. Best-effort: the money write already committed, and the kasboek reconciles on load.
  try {
    // [CASH-RETRY] A moved payment that was CASH has to drag its drawer entry to the other invoice;
    // a bailed pass leaves the entry pointing at the invoice the money no longer settles.
    await reconcileCashWithRetry(supabase, user.id);
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ ok: true, ...row });
}
