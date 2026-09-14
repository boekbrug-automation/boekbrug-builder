// src/app/api/bank/confirm/route.ts
// [BOEK-016] Confirm a bank match (phase 4). The HUMAN confirms; this executes.
// [BANK-MULTI-CONFIRM] One transaction can cover SEVERAL invoices (a supplier
//   combines two invoices in one transfer; a customer pays a gebundeld
//   betaalverzoek). Confirming ONE invoice must NOT hide the transaction while
//   money of it still belongs to another invoice. So:
//     - We always pay + link the confirmed invoice (as before).
//     - Each booking may only spend what the payment still HAS: the euros this
//       bank line already put on other invoices (bank_tx_invoices.amount_applied)
//       are subtracted first.
//     - We only flip the transaction to 'matched' when every euro of it sits on an
//       invoice. Otherwise it stays 'pending' so it remains in "Te bevestigen"
//       with the rest of the money still assignable.
// [BANK-ONE-PAYMENT-MANY-INVOICES] That is arithmetic, deliberately. The old rule
//   counted number-shaped tokens in the reference to decide "single or batch?" and
//   then checked that every token had a paid invoice. It was wrong in both
//   directions — a customer number in the description made a €500 instalment book
//   as a full settlement, and a bundle whose numbers the extractor had mutilated
//   ("2026-045, 2026-046" is stored as "045, 046") let one invoice swallow a
//   payment meant for two. The amounts answer both questions without guessing.
//
// Writes two things, in legal-priority order:
//   (a) invoice → status 'paid' + payment_method 'bank' + marked_paid_at   (reuses B.3 semantics)
//   (b) bank_transactions → status 'matched' + invoice_id                  (only when allCovered)
//
// Atomicity: Supabase has no REST transaction. We write (a) first (legally the important one).
// If (b) fails, we DO NOT roll back (a) — same philosophy as B.11 ("email failure does not
// block invoice completion"). The only possible half-state is invoice=paid + tx=pending, which
// is benign and self-healing (re-running /api/bank/match surfaces it again). A true-atomic RPC
// can replace the two writes later if desired (no rollback gaps in Dutch tax law).
//
// ⚠️ CRITICAL: the invoice UPDATE uses the SESSION client, never the pipeline (service_role).
//    The verwerkt guard trigger early-returns when auth.uid() IS NULL, so a service_role write
//    would SILENTLY BYPASS the B.4 Conflict Guard. The session client sets auth.uid() → guard fires.

import { NextRequest, NextResponse } from "next/server";
// [IN-CHUNK] Een id-lijst reist in de URL — gechunkt, zie supabase-paginate.ts.
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
// [BANK-MULTI-LINK-PERSIST] Coverage logic (parseReferenceNumbers + isFullyCovered)
// now lives in bank-matching.ts so this confirm path and the match path share ONE
// definition — no drift between "is this tx done?" answered in two places.
import { isEligible, isPayableInvoiceState, normalizeRef, isFullyCovered, bankLineFullyApplied, parseReferenceNumbers } from "@/lib/bank-matching";
import { recordPaymentLinks } from "@/lib/bank-tx-links";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { resolveAllocation, openBalanceFromAmounts, paymentExceedsOpenBalance } from "@/lib/partial-payment";
import { allocatedOnLine } from "@/lib/bank-line-budget";
import { readOverApplied, overAppliedNotice } from "@/lib/bank-overapplied";
// [DECLARED-INVOICE] Invoice numbers the payment NAMES, whether or not we hold them.
import { undeclaredMissingInvoices } from "@/lib/bank-batch-reconcile";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { round2 } from "@/lib/invoice-totals";
import { requirePermission } from "@/lib/access/context";

export async function POST(req: NextRequest) {
  // 1. Auth
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // [EEN-POORT] Booking a bank line against an invoice is `bank.match` — it moves amount_paid and
  // decides what the quarter will say. Until now this door asked only "is somebody logged in",
  // which is exactly the shape §38 of the specification calls insufficient for a protected
  // operation. The administration is this session's own: a sales member reaching here would act
  // for their employer everywhere else in the app, and bank matching is not theirs to do.
  {
    const gate = await requirePermission("bank.match", { ownerId: user.id });
    if (gate.response) return gate.response;
  }

  // 2. Body
  let transactionId: string | undefined;
  let requestedAmount: number | null = null;
  let force = false;
  let invoiceId: string | undefined;
  // [SOM-KLOPT-ÉÉN] Several invoices at once — the same-supplier sum the matcher suggested. Booked
  // as ONE decision through book_bank_batch (locked, the tie re-proved on the current rows, signed
  // for a creditnota, all-or-nothing) instead of one confirm per invoice in list order. The loop
  // could not book a netted creditnota at all: invoice-first the line closed on the invoice alone
  // and the credit's turn answered "already processed" (counted as success); credit-first the
  // credit was refused as not eligible. Either way the invoice stood € 52,38 "open" under a toast
  // that said "2 samen gekoppeld".
  let invoiceIds: string[] | null = null;
  try {
    const body = await req.json();
    transactionId = body?.transactionId;
    invoiceId = body?.invoiceId;
    if (Array.isArray(body?.invoiceIds)) {
      const ids = (body.invoiceIds as unknown[]).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
      if (ids.length !== body.invoiceIds.length || ids.length < 2 || ids.length > 50) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
      }
      invoiceIds = [...new Set(ids)];
    }
    // [BANK-SPLIT] How much of this line to put on this invoice. Absent = "everything it has left",
    // which is what every caller sent before this existed.
    requestedAmount = typeof body?.amount === "number" ? body.amount : null;
    // [DECLARED-INVOICE] The owner looked at the warning and knows better.
    force = body?.force === true;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!transactionId || (!invoiceId && !invoiceIds)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. Ownership + state checks (point 3): the user must own BOTH rows.
  //    [BANK-MULTI-CONFIRM] Also fetch `reference` (the expected invoice numbers)
  //    so we can decide allCovered after the payment.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount, reference, date, description")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }
  if (tx.status !== "pending") {
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }

  if (invoiceIds) {
    // [BUNDEL-DREMPEL] The payability sweep the single-invoice door has always done, done here
    // too. Not the WHOLE of isEligible: a bundle the owner confirms by sum names no invoice
    // numbers, and isEligible's direction rule only lets a netted creditnota through when the
    // payment names it — so asking the whole question here would refuse exactly the credit notes
    // [CREDIT-VERREKEN] exists to settle. What is asked is the half that holds on every door:
    // paid, draft, archived, processing, verwerkt. book_bank_batch re-asks it under the row lock
    // (that is the real guard); this one turns a raised exception into a plain 409 and keeps a
    // database on which the newer migration is not yet applied exactly as safe as this route.
    // [IN-CHUNK] The id list travels in the URL — chunked, like every other id read here.
    let batchInvs: { id: string; invoice_number: string | null; status: string | null; accountant_status: string | null }[] = [];
    try {
      batchInvs = await fetchAllRowsForIds(invoiceIds, (chunk, from, to) =>
        pipeline
          .from("invoices")
          .select("id, invoice_number, status, accountant_status")
          .in("id", chunk)
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (e) {
      return NextResponse.json(
        { error: "invoice_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    if (batchInvs.length !== invoiceIds.length) {
      // Fewer rows than ids means at least one id is missing or belongs to someone else. Never a
      // partial book: the whole batch is refused, exactly as the RPC would.
      return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
    }
    const notPayable = batchInvs.filter((i) => !isPayableInvoiceState(i));
    if (notPayable.length > 0) {
      const verwerkt = notPayable.find((i) => i.accountant_status === "verwerkt");
      if (verwerkt) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: verwerkt.invoice_number }, { status: 409 });
      }
      if (notPayable.some((i) => i.status === "paid")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      return NextResponse.json({ error: "not_eligible" }, { status: 409 });
    }

    // [SOM-KLOPT-ÉÉN] The batch door. Everything the function checks — ownership, payability,
    // the 'verwerkt' guard, the cent-exact tie on the CURRENT open amounts with a creditnota
    // signed negative — it checks under the line's lock, and nothing half-books.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bookedRows, error: batchErr } = await (supabase.rpc as any)("book_bank_batch", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_ids: invoiceIds,
      p_pay_date: tx.date ?? null,
    }) as { data: unknown; error: { code?: string; message?: string } | null };
    if (batchErr) {
      const msg = (batchErr.message ?? "").toLowerCase();
      if (msg.includes("verwerkt")) return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      if (msg.includes("tie no longer exact")) {
        return NextResponse.json({ error: "batch_tie_broken", detail: batchErr.message }, { status: 409 });
      }
      if (msg.includes("no longer payable")) {
        return NextResponse.json({ error: "invoice_already_paid", detail: batchErr.message }, { status: 409 });
      }
      console.error("[SOM-KLOPT-ÉÉN] book_bank_batch refused", { userId: user.id, transactionId, error: batchErr.message });
      return NextResponse.json({ error: "payment_failed", detail: batchErr.message }, { status: 500 });
    }
    if (!bookedRows || (bookedRows as unknown[]).length === 0) {
      return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
    }
    await logAuditAction({
      userId: user.id,
      action: "bank.confirmed_batch",
      entityType: "bank_transaction",
      entityId: transactionId,
      newValue: { invoice_ids: invoiceIds, invoice_count: invoiceIds.length, amount: tx.amount ?? 0, reason: "owner_confirmed_sum" },
      ipAddress: getClientIP(req),
    });
    return NextResponse.json({ ok: true, booked: (bookedRows as unknown[]).length });
  }
  if (!invoiceId) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    // [PARTIAL-PAY] amount_paid decides what this invoice still has OPEN — the guard below
    // refuses to call a payment "full" when it cannot cover that balance.
    .select("id, invoice_number, status, accountant_status, sender_id, receiver_id, direction, total_inc_btw, amount_paid")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) {
    return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  }
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }
  if (inv.status === "paid") {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }
  // Pre-empt B.4 (the trigger is the real guard, but fail fast with a clear signal for the UI).
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json(
      { error: "verwerkt", invoiceNumber: inv.invoice_number },
      { status: 409 }
    );
  }

  // Defense-in-depth: the write path must enforce the SAME invariants the matcher used to
  // produce the suggestion. Reusing isEligible() (single source of truth) blocks a buggy or
  // crafted client from paying a draft/archived invoice, or pairing a credit with an incoming
  // invoice / a debit with an outgoing one. Legitimate confirmations always pass this.
  const eligible = isEligible(
    {
      // [CREDIT-NETTING-BEVESTIG] The reference and the description are REAL here, and they have
      // to be. isEligible's own escape for a netted credit note asks referenceMatches(tx, …),
      // which reads exactly these two fields — so blanking them meant the rule could never fire
      // and every netted creditnota was refused with `not_eligible`, on a "Bevestig" button the
      // matcher had just rendered. Measured on the Dutch Sweets case that rule was written for:
      // isEligible(real tx, creditnota) = true, isEligible(this synthetic tx, creditnota) = false.
      //
      // This is the SAME defect the note directly below records for total_inc_btw, one field over:
      // a guard built to re-check the matcher's own invariants, handed less than the matcher had.
      // The route already SELECTs both columns (line 91) and uses them for the guard further down.
      date: tx.date ?? "",
      amount: tx.amount ?? 0,
      currency: "EUR",
      description: tx.description ?? "",
      // Not selected by this route, and left null deliberately rather than guessed: isEligible
      // reads the counterparty for nothing, and a wrong name here would be a new claim.
      counterpartName: null,
      counterpartIban: null,
      reference: tx.reference ?? null,
      transactionId: tx.id,
      rawLine: "",
    },
    {
      id: inv.id,
      invoice_number: inv.invoice_number,
      // [M7-CREDITNOTA] The REAL total, never null. isEligible derives "is this a creditnota"
      // from the sign of this field; passing null made every creditnota look like a normal
      // invoice, flipped the required direction, and rejected every credit-note refund with
      // `not_eligible` — the matcher (which passes the real amount) suggested it, and this
      // guard then refused it. Auto-confirm passes the full row and worked; only the human
      // path was blocked.
      total_inc_btw: inv.total_inc_btw ?? null,
      invoice_date: null,
      due_date: null,
      client_name: null,
      direction: (inv.direction ?? null) as "outgoing" | "incoming" | null,
      status: inv.status,
      accountant_status: inv.accountant_status,
    }
  );
  if (!eligible) {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  // ── [BANK-CONFIRM-ATOMIC] One RPC, the whole decision under one lock ─────────────────────
  // confirm_bank_payment derives EVERYTHING under the bank line's row lock: what the line still
  // has (Σ sibling links read under the lock), what the invoice can absorb, whether this books a
  // deelbetaling, a completion, or an overpay-with-remainder, and whether the LINE is finished.
  // That closes the race the multi-statement path below can only detect after the fact: two
  // overlapping confirms of different invoices against one line each believed they had the full
  // line to spend. Deploy-safe: an undefined function (bank_confirm_atomic.sql not applied yet)
  // falls through to the previous path — which keeps its loud over-application detector, so an
  // un-migrated database is exactly as safe as it was yesterday.
  // [DECLARED-INVOICE] BEFORE any booking runs — which is the whole point, and was the bug.
  //
  // The atomic confirm_bank_payment call below books and RETURNS. This guard used to sit after
  // it, reachable only when that function was MISSING (the pre-migration fall-through). So the
  // migration that made confirmation atomic silently turned the double-payment refusal into dead
  // code: from the moment bank_confirm_atomic.sql was applied, a payment naming an invoice the
  // administration does not hold was booked in full onto the one invoice it did hold — the ATAPACK
  // case the comment below describes, refused in theory and booked in practice.
  //
  // The money it needs (payAvailable, moneyLeftOver) is computed here for the same reason: a guard
  // that runs after the write is not a guard.

  const refNumbers = parseReferenceNumbers(tx.reference);
  const payAmount = Math.abs(tx.amount ?? 0);
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Which path this booking takes is decided by the MONEY, not
  // by how many number-shaped tokens the reference happens to contain.
  //
  //   payment <= what this invoice still owes  → this one invoice absorbs the whole payment
  //                                              (in full, or as an honest deelbetaling)
  //   payment >  what this invoice still owes  → settle this invoice and keep the bank line OPEN
  //                                              for the rest of the money
  //
  // The reference-token count could not answer either question. It said "multi" for a single
  // payment whose description merely carried a customer number — booking a €500 instalment on a
  // €1.815 invoice as fully paid — and it said "single" for a real bundle whose numbers the
  // extractor had mutilated ("2026-045, 2026-046" is stored as "045, 046"), so the €1.100 that
  // paid two invoices was consumed by the first one and the second stayed open forever with its
  // money already spent. Both are the same mistake: guessing intent from text instead of
  // reading the amounts. (refNumbers survives below only as the legacy coverage fallback.)
  const invMoney = inv as { total_inc_btw?: number | null; amount_paid?: number | null };
  const invOpen = openBalanceFromAmounts(invMoney);

  // How much of this bank line is already spent on OTHER invoices. A payment can be confirmed
  // against several invoices one after another, and each booking may only spend what is LEFT —
  // otherwise the second confirmation of a €1.100 payment that already settled €605 would still
  // believe it has €1.100 to give, and would mark a €600 invoice fully paid with €105 that never
  // arrived. bank_tx_invoices.amount_applied records what each booking took, on every path.
  // Read BEFORE any write so a retry can never count our own link twice.
  let appliedElsewhere = 0;
  let appliedElsewhereKnown = true;
  // [DECLARED-INVOICE-EIGEN-CLAIM] The numbers of the invoices this bank line ALREADY settled —
  // the other half of "which invoices do we hold" for the guard further down. Empty when the link
  // read fails or the numbers cannot be resolved, which makes that guard stricter, never looser.
  const linkedInvoiceNumbers: string[] = [];
  {
    const { data: linkRows, error: linkReadErr } = await pipeline
      .from("bank_tx_invoices")
      .select("invoice_id, amount_applied")
      .eq("user_id", user.id)
      .eq("transaction_id", transactionId);
    if (linkReadErr) {
      appliedElsewhereKnown = false;
    } else {
      const others = ((linkRows ?? []) as { invoice_id: string; amount_applied: number | null }[])
        .filter((r) => r.invoice_id !== invoiceId);
      // A link with no amount is a pre-[PARTIAL-PAY] row: we cannot tell what it settled, so we do
      // not pretend to know what is left. The legacy reference rule takes over below.
      if (others.some((r) => r.amount_applied == null)) appliedElsewhereKnown = false;
      const priced = others.filter((r) => r.amount_applied != null);
      if (priced.length > 0) {
        // [CREDITNOTA] SIGNED, through the one module that owns this sum. A credit already on this
        // line did not spend €150 of it, it returned €150 to it — counted as a magnitude the line
        // looks €300 poorer, and this very route then caps the next invoice at the smaller number
        // and books an amount that was never agreed. Same rule as allocate_bank_payment applies
        // under its lock, which is the point of it living in one file.
        // [IN-CHUNK] Gechunkt. Beide gevolgen van een onvolledige lezing waren al de veilige kant
        // op — appliedElsewhereKnown wordt false, en de DECLARED-INVOICE-guard weigert eerder — dus
        // dit kostte geen verkeerd bedrag, maar wel een geweigerde boeking op precies de regel die
        // over de meeste facturen verdeeld is.
        let linkedInvoices: Array<{ id: string; direction: string | null; invoice_type: string | null; total_inc_btw: number | null; invoice_number: string | null }> = [];
        try {
          linkedInvoices = await fetchAllRowsForIds(priced.map((r) => r.invoice_id), (chunk, from, to) =>
            pipeline
              .from("invoices")
              // [DECLARED-INVOICE-EIGEN-CLAIM] invoice_number rides along for the guard below.
              .select("id, direction, invoice_type, total_inc_btw, invoice_number")
              .in("id", chunk)
              .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
              .order("id", { ascending: true })
              .range(from, to),
          );
        } catch (e) {
          console.error("[CONFIRM] gekoppelde facturen lezen mislukt", { txId: tx.id, e });
        }
        // [DECLARED-INVOICE-EIGEN-CLAIM] An invoice this line already settled IS held, so the
        // guard below must not report it as missing on the next booking against the same line.
        for (const r of linkedInvoices as Array<{ invoice_number?: string | null }>) {
          const n = (r.invoice_number ?? "").trim();
          if (n !== "") linkedInvoiceNumbers.push(n);
        }
        const sum = allocatedOnLine(priced, linkedInvoices, Number(tx.amount) || 0);
        // A sibling link whose invoice this user cannot read is the same situation as a missing
        // amount: the total is not measurable, so we say so rather than under-count it.
        if (sum.unknownInvoiceIds.length > 0) appliedElsewhereKnown = false;
        appliedElsewhere = sum.allocated;
      }
    }
  }
  // What this payment still has to give. Unknown sibling amounts ⇒ fall back to the full amount,
  // which is exactly how it behaved before per-link amounts existed.
  const payAvailable = appliedElsewhereKnown
    ? round2(Math.max(0, payAmount - appliedElsewhere))
    : payAmount;

  const moneyLeftOver = paymentExceedsOpenBalance(payAvailable, invMoney);

  // [DECLARED-INVOICE] Does this payment SAY it also pays an invoice we do not have?
  //
  // Booking now consumes the bank line. If the description names a second invoice that is not in
  // the administration yet, the money for it is spent here — and when that invoice arrives it
  // reads fully open, gets dunned, and can be paid a second time. That is the ATAPACK case:
  // "Tweede deel factuur 26302050 , factuur 26302362", where only the first was imported and the
  // first had room to absorb the entire €2.265,41.
  //
  // Refused rather than warned, and only when the booking would swallow the WHOLE line: waiting
  // is reversible and a wrong booking is not. An owner who knows better passes `force`. Skipped
  // entirely when an explicit amount was stated — stating one IS the owner allocating deliberately.
  if (requestedAmount == null && !force && !moneyLeftOver) {
    // ── [DECLARED-INVOICE-EIGEN-CLAIM] The guard was fed the payment's OWN claim ──
    //
    // `knownInvoiceNumbers` means "the numbers we HOLD". It was passed `[...refNumbers, …]`, and
    // refNumbers is parseReferenceNumbers(tx.reference) — the numbers this very payment NAMES.
    // undeclaredMissingInvoices computes declaredInvoiceNumbers(tx) minus that set, reading the
    // same reference+description text, so the claim was subtracted from itself and the set was
    // always empty. Measured on the ATAPACK remittance this guard's own header describes:
    //
    //     "Tweede deel factuur 26302050 , factuur 26302362"
    //     route's call    → []              (no 409, the whole € 2.265,41 books onto 26302050)
    //     correct call    → ["26302362"]    (the invoice that is then paid a second time)
    //
    // The file already says so twenty lines up — "(refNumbers survives below only as the legacy
    // coverage fallback.)" — and the sibling door attach-invoice:255 passes only the number it
    // holds, under a comment claiming the two doors cannot disagree. They did.
    //
    // Held = this invoice, plus every invoice ALREADY linked to this bank line: a payment booked
    // across two invoices one after the other must not have the first one reported as missing on
    // the second booking. When those numbers cannot be read the set is smaller, which makes the
    // guard fire more readily — a refusal is reversible and a double payment is not.
    const missing = undeclaredMissingInvoices(
      { reference: tx.reference, description: tx.description },
      [inv.invoice_number, ...linkedInvoiceNumbers],
    );
    if (missing.length > 0) {
      // [GENOEMD-STAAT-ER] "Staat nog niet in je administratie" was said of every number the
      // payment names, including one that IS there, open, one screen away. Look it up: a named
      // invoice that exists is a different instruction — book both (verdelen) — not "add it".
      const { data: openRows } = await pipeline
        .from("invoices")
        .select("invoice_number")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .in("status", ["sent", "overdue", "received"])
        .not("invoice_number", "is", null)
        .limit(2000);
      const openNums = new Set(((openRows ?? []) as { invoice_number: string | null }[]).map((r) => normalizeRef(r.invoice_number ?? "")).filter(Boolean));
      const present = missing.filter((n) => openNums.has(normalizeRef(n)));
      if (present.length > 0) {
        return NextResponse.json(
          {
            error: "declared_invoice_open",
            code: "declared_invoice_open",
            missingNumbers: present,
            canForce: true,
            detail:
              `Deze betaling noemt ook ${present.length === 1 ? "factuur" : "facturen"} ${present.join(", ")}, ` +
              `${present.length === 1 ? "die staat" : "die staan"} open in je administratie. Koppel ze samen via Verdelen, ` +
              `of vul hieronder in welk deel van dit bedrag op ${inv.invoice_number ?? "deze factuur"} hoort.`,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: "declared_invoice_missing",
          code: "declared_invoice_missing",
          missingNumbers: missing,
          canForce: true,
          detail:
            `Deze betaling noemt ook ${missing.length === 1 ? "factuur" : "facturen"} ${missing.join(", ")}, ` +
            `${missing.length === 1 ? "die staat" : "die staan"} nog niet in je administratie. Als we het hele bedrag nu op ` +
            `${inv.invoice_number ?? "deze factuur"} boeken, is het geld op zodra ${missing.length === 1 ? "die factuur" : "die facturen"} ` +
            `binnenkomt — en dan lijkt ${missing.length === 1 ? "hij" : "die"} onbetaald. Voeg ${missing.length === 1 ? "hem" : "ze"} eerst toe, ` +
            `of vul hieronder in welk deel van dit bedrag op deze factuur hoort.`,
        },
        { status: 409 },
      );
    }
  }

  {
    // ── [DEEL-BEDRAG] Which function, and why it is not always the same one ──
    //
    // confirm_bank_payment takes NO amount. It computes LEAST(available, open) and books that.
    // For the ordinary "this payment settles this invoice" tap that is exactly right, and it is
    // what this route did for every request — including the ones carrying an explicit amount.
    //
    // Which silently threw the owner's number away. The split sheet ("Alleen dit deel boeken")
    // opens only from the declared_invoice_missing 409, and that 409 requires payAvailable <=
    // invoiceOpen — under precisely that precondition LEAST(available, open) IS the whole
    // remaining line. So typing €1.000 on a €2.265,41 line booked €2.265,41, flipped the invoice
    // to 'paid' and answered "Bevestigd en gemarkeerd als betaald". "Alleen dit deel boeken" and
    // "Toch het hele bedrag" were the same button.
    //
    // The damage is not the wrong amount_paid. That guard exists for the ATAPACK case: a payment
    // whose description names TWO invoices of which only one is imported yet. The money meant for
    // the missing invoice was spent on the present one, and when the missing one arrived it read
    // fully open, got dunned, and would be paid a second time — by the escape hatch built to
    // prevent exactly that.
    //
    // allocate_bank_payment (allocate_bank_payment.sql) is the same atomic decision WITH an amount:
    // LEAST(requested, available, open), and it leaves the line 'pending' when money remains — so
    // the rest of this payment stays available for the invoice it was actually for.
    const withAmount = requestedAmount != null;
    const atomicFn = withAmount ? "allocate_bank_payment" : "confirm_bank_payment";
    // Neither function is in the generated types yet — same convention as auto_match_reason.
    // Regenerate after applying.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: atomicRows, error: atomicErr } = await (supabase.rpc as any)(atomicFn, {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: invoiceId,
      p_pay_date: tx.date ?? null,
      ...(withAmount ? { p_amount: requestedAmount } : {}),
    }) as { data: unknown; error: { code?: string; message?: string } | null };
    // Either name may be absent on a database where its migration has not run. Falling through is
    // the SAFE direction here and doubly so for the amount path: the older detector-guarded path
    // below is the one place that already honours resolveAllocation, so a missing function costs
    // atomicity, never the owner's stated number.
    const fnMissing =
      atomicErr &&
      ((atomicErr as { code?: string }).code === "42883" ||
        /confirm_bank_payment|allocate_bank_payment/i.test(atomicErr.message ?? "") &&
          /(does not exist|not find|schema cache)/i.test(atomicErr.message ?? ""));
    if (atomicErr && !fnMissing) {
      const msg = (atomicErr.message ?? "").toLowerCase();
      if (msg.includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (msg.includes("already fully paid") || msg.includes("already covered")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      if (msg.includes("fully applied")) {
        return NextResponse.json({ error: "payment_fully_applied" }, { status: 409 });
      }
      return NextResponse.json({ error: "payment_failed", detail: atomicErr.message }, { status: 500 });
    }
    if (!atomicErr) {
      const row = Array.isArray(atomicRows)
        ? (atomicRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean; all_covered: boolean; line_remaining: number } | undefined)
        : undefined;
      if (!row) {
        // Empty result ⇒ the tx was claimed between our checks and the lock. Nothing written.
        return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
      }
      const isPaid = row.is_paid === true;
      const remaining = Math.max(0, (row.total ?? 0) - (row.amount_paid ?? 0));
      const unassigned = row.all_covered ? 0 : Math.max(0, row.line_remaining ?? 0);
      // [NOTIFY-EERLIJK] createNotification is zelf non-blocking: hij gooit niet en geeft de fout
      // terug. De try/catch die hier stond ving iets wat supabase-js nooit gooide.
      await createNotification({
        userId: user.id,
        title: isPaid ? "Factuur betaald" : "Deelbetaling geboekt",
        body: isPaid
          ? `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`
          : `Deelbetaling van € ${(row.applied ?? 0).toFixed(2)} geboekt op factuur ${inv.invoice_number ?? ""}. Nog openstaand: € ${remaining.toFixed(2)}.`,
        type: "payment",
        // [MELDING-TIK] De DERDE tak. [NOTIF-DEADEND] repareerde dezelfde melding op regel 551 en
        // 903 en liet deze staan — de toelichting daar zegt zelfs "de enige melding over het geld
        // van de eigenaar was die je niet kon openen", en dat gold hier daarna nog steeds. Dit is
        // waarom het scriptje dat elke createNotification zonder link opzoekt nu in de gates staat:
        // met de hand "alle plekken" langsgaan miste er één van de drie, in hetzelfde bestand.
        link: inv.direction === "incoming"
          ? `/dashboard/incoming/manage?focus=${invoiceId}`
          : `/dashboard/invoice/${invoiceId}`,
      });
      if (unassigned > 0.01) {
        await createNotification({
          userId: user.id,
          title: "Nog een deel van deze betaling open",
          body: `Van deze betaling is € ${(row.applied ?? 0).toFixed(2)} op factuur ${inv.invoice_number ?? ""} geboekt. € ${unassigned.toFixed(2)} is nog niet toegewezen — koppel de volgende factuur.`,
          type: "payment",
          link: "/dashboard/bank",
        });
      }
      await logAuditAction({
        userId: user.id,
        action: isPaid ? "bank.confirmed" : "bank.partial_payment",
        entityType: "invoice",
        entityId: invoiceId,
        newValue: {
          transaction_id: transactionId,
          invoice_number: inv.invoice_number,
          applied: row.applied,
          amount_paid: row.amount_paid,
          total: row.total,
          remaining,
          fully_paid: isPaid,
          all_covered: row.all_covered === true,
          unassigned,
          atomic: true,
        },
      });
      return NextResponse.json({
        ok: true,
        allCovered: row.all_covered === true,
        partial: !isPaid,
        applied: row.applied,
        remaining,
        unassigned,
        residue: 0,
      });
    }
    // fnMissing → fall through to the previous, detector-guarded path below.
  }

  // [PARTIAL-PAY] When the money this payment still has fits inside the invoice → the atomic
  // apply_bank_payment RPC. It applies LEAST(payment, remaining), so an amount SMALLER than the
  // invoice balance is recorded as a DEELBETALING — the invoice stays openstaand with the rest
  // tracked (amount_paid), instead of the old behaviour that flipped it to fully 'paid' on the
  // first instalment (a wrong number). It only flips to 'paid' when the instalments together
  // cover the total. Everything the payment had left goes to this one invoice, so the bank line
  // is fully consumed → matched. Session client so the B.4 verwerkt trigger has auth context
  // (the RPC also re-checks verwerkt under its row lock).
  if (!moneyLeftOver) {
    if (payAvailable <= 0) {
      // Every euro of this bank line is already booked on other invoices — there is nothing left
      // to settle this one with. (The line should already be 'matched'; this is the honest answer
      // if a second confirm arrives anyway.)
      return NextResponse.json({ error: "payment_fully_applied" }, { status: 409 });
    }
    // [BANK-SPLIT] How much of this line goes on THIS invoice. Without a stated amount this is
    // payAvailable — byte-for-byte the behaviour every existing caller and the automatic booking
    // path had. With one, it is the owner's figure, checked against both ceilings first: money the
    // line does not have, and more than the invoice owes, are refused rather than clamped, because
    // a screen that says €500 while the books take €300 has told the owner something untrue.
    const alloc = resolveAllocation({ requested: requestedAmount, payAvailable, invoiceOpen: invOpen });
    if (!alloc.ok) {
      return NextResponse.json(
        {
          error: "bad_allocation",
          code: alloc.reason,
          detail:
            alloc.reason === "not_positive"
              ? "Vul een bedrag groter dan nul in."
              : alloc.reason === "exceeds_payment"
                ? `Van deze betaling is nog € ${alloc.available.toFixed(2)} te verdelen — meer kan er niet op.`
                : `Op deze factuur staat nog € ${alloc.open.toFixed(2)} open — meer kan er niet op.`,
        },
        { status: 400 },
      );
    }


    const { data: applyRows, error: applyErr } = await supabase.rpc("apply_bank_payment", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: invoiceId,
      p_amount: alloc.amount,
      p_pay_date: tx.date ?? null,
    });
    if (applyErr) {
      if (applyErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (applyErr.message?.toLowerCase().includes("already fully paid")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      return NextResponse.json({ error: "payment_failed", detail: applyErr.message }, { status: 500 });
    }
    // Empty result ⇒ the tx was claimed by a concurrent confirm/auto-book between our checks and
    // the RPC's lock (its mutex re-read saw status ≠ 'pending'). Nothing was written — 409, retryable.
    const row = Array.isArray(applyRows) ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean } | undefined) : undefined;
    if (!row) {
      return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
    }
    const isPaid = row.is_paid === true;
    const remaining = Math.max(0, (row.total ?? 0) - (row.amount_paid ?? 0));
    // [PARTIAL-PAY-RESIDUE] apply_bank_payment clamps with LEAST(payment, remaining), so a
    // payment BIGGER than the balance books only the balance — and the excess used to vanish
    // without a trace while the transaction was still marked fully consumed ('matched'). The
    // money is real: usually the line belongs to another invoice too, or to the wrong invoice
    // entirely. We do not invent a credit balance (a new concept with no screen); we make the
    // leftover VISIBLE so the owner can check it. The pre-tap warning in BankClient says the
    // same thing before the click; this is the record after it.
    // We only reach this branch when the payment does NOT exceed the balance, so a residue now
    // means the balance shrank between our read and the RPC's lock (a concurrent booking) —
    // rare, and exactly the case that must not stay invisible. Measured against what this
    // booking was allowed to spend (payAvailable), not the whole line: euros already booked on
    // other invoices of this same payment are accounted for, not "left over".
    const residue = round2(payAvailable - (row.applied ?? 0));
    const hasResidue = residue > 0.01;
    // [BANK-TX-INVOICES] The RPC already wrote the join row (with amount_applied) inside its
    // transaction — no recordPaymentLinks needed here.
    await createNotification({
      userId: user.id,
      title: isPaid ? "Factuur betaald" : "Deelbetaling geboekt",
      body: isPaid
        ? `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`
        : `Deelbetaling van € ${row.applied.toFixed(2)} geboekt op factuur ${inv.invoice_number ?? ""}. Nog openstaand: € ${remaining.toFixed(2)}.`,
      type: "payment",
      // [NOTIF-DEADEND] This bell announces a booking on ONE invoice but carried no
      // link, so the only notification about the owner's money was the one you could
      // not open — while its own sibling below ("Er bleef een bedrag over") did link.
      // Route by direction, exactly like the other invoice deep links in the app:
      // an inkoopfactuur lives on Inkoopfacturen, a sales invoice on its detail page.
      link: inv.direction === "incoming"
        ? `/dashboard/incoming/manage?focus=${invoiceId}`
        : `/dashboard/invoice/${invoiceId}`,
    });
    if (hasResidue) {
      await createNotification({
        userId: user.id,
        title: "Er bleef een bedrag over",
        body: `Van de betaling van € ${payAvailable.toFixed(2)} is € ${(row.applied ?? 0).toFixed(2)} op factuur ${inv.invoice_number ?? ""} geboekt. € ${residue.toFixed(2)} bleef over — controleer of deze betaling ook een andere factuur betreft.`,
        type: "payment",
        link: "/dashboard/bank",
      });
    }
    if (hasResidue) {
      await logAuditAction({
        userId: user.id,
        action: "bank.overpayment_residue",
        entityType: "invoice",
        entityId: invoiceId,
        newValue: {
          transaction_id: transactionId,
          invoice_number: inv.invoice_number,
          payment_amount: payAmount,
          applied: row.applied,
          residue,
        },
      });
    }
    await logAuditAction({
      userId: user.id,
      action: isPaid ? "bank.confirmed" : "bank.partial_payment",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: {
        transaction_id: transactionId,
        invoice_number: inv.invoice_number,
        applied: row.applied,
        amount_paid: row.amount_paid,
        total: row.total,
        remaining,
        fully_paid: isPaid,
      },
    });
    // allCovered = the TRANSACTION is done (fully consumed by this invoice); `partial` tells the UI
    // the INVOICE still has a balance so it can show "€X van €Y · €Z openstaand".
    // `residue` = what the clamp did NOT book (0 in the normal case).
    return NextResponse.json({ ok: true, allCovered: true, partial: !isPaid, applied: row.applied, remaining, residue });
  }

  // ── The payment still has more to give than this invoice can absorb: settle the invoice in
  //    full and keep the rest of the money reachable on the bank line.

  // 4. Write (a): invoice → paid. SESSION client so the verwerkt trigger fires (auth.uid() set).
  //    Never write `shared` (GENERATED) or 'voldaan' (UI-only).
  const { data: payData, error: payErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      payment_method: "bank", // known from a bank match — no Bank/Contant question
      marked_paid_at: new Date().toISOString(),
      // [PARTIAL-PAY] This multi-number-batch branch pays the invoice in FULL, so amount_paid must
      // reach the total — otherwise an invoice that was mid-instalment and is now completed via a
      // batch would keep a stale amount_paid < total. Openstaand is status-gated (paid ⇒ 0) so this
      // is only an internal-consistency fix, but it keeps amount_paid honest for a later unlink.
      amount_paid: Math.abs(inv.total_inc_btw ?? 0),
      // [BANK-PAYDATE] The REAL settlement date is the bank line's date, not now(). A Q1
      // invoice paid in Q2 must carry its true payment day/quarter so the owner and the
      // accountant both see "paid in Q2" — the cross-quarter case, recorded not guessed.
      payment_date: tx.date,
    })
    .eq("id", invoiceId)
    .neq("status", "paid") // idempotent: don't re-pay / reset marked_paid_at on double-submit
    .select("id"); // [BANK-PAY-RACE] know whether THIS request actually paid it

  if (payErr) {
    // B.4 trigger rejection surfaces here → let the UI show the "vraag boekhouder" dialog.
    if (payErr.message && payErr.message.toLowerCase().includes("verwerkt")) {
      return NextResponse.json(
        { error: "verwerkt", invoiceNumber: inv.invoice_number },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "payment_failed", detail: payErr.message }, { status: 500 });
  }

  // [BANK-PAY-RACE] The idempotent .neq("status","paid") no-ops (0 rows, no error) if a
  // CONCURRENT request paid this invoice between our fetch and this write. We must NOT then
  // treat the payment as ours — otherwise a later link failure would roll back a payment we
  // didn't make. Zero rows updated ⇒ someone else already paid it: bail like the pre-check,
  // never proceed to link or rollback.
  if (!payData || payData.length === 0) {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }

  // 5. Decide allCovered: is this BANK LINE finished?
  //
  //    [BANK-ONE-PAYMENT-MANY-INVOICES] The honest answer is arithmetic: a payment is finished
  //    when every euro of it sits on an invoice. We reach this branch only when the payment is
  //    bigger than the invoice we just settled, so there IS money left — unless earlier
  //    confirmations on this same bank line already took it. bank_tx_invoices.amount_applied
  //    records exactly that, on every booking path, so summing it answers the question without
  //    reading a single character of the reference. Money left ⇒ the line stays 'pending' and
  //    keeps its remaining invoices reachable; nothing left ⇒ 'matched'.
  //
  //    [BANK-MULTI-CONFIRM] The old presence rule stays as the fallback for links written before
  //    amount_applied existed (or when the read fails): is EVERY invoice number listed in the
  //    reference now backed by a PAID invoice of this user, in the direction the sign implies?
  //    Conservative by design — an unresolved number keeps the tx visible, never hides on doubt.
  //    [BANK-COVERAGE-BY-MONEY] The arithmetic now lives in bank-matching.bankLineFullyApplied, so
  //    /api/bank/match answers "is this line finished?" with the IDENTICAL rule on reload. It used
  //    to answer it from the reference tokens alone, which disagreed with this branch the moment a
  //    token was not a paid invoice number — and a line the money says is finished then never left
  //    "Te bevestigen".
  const settledByThisBooking = appliedElsewhere + invOpen;
  const moneyRemaining = round2(payAmount - settledByThisBooking);
  // [BANK-COVERED-FAIL-CLOSED] When the sibling links are NOT measurable (a failed read, or a
  // pre-amount_applied link) the default is `false` — the line stays visible. We are in the
  // overpay branch, so by arithmetic THIS booking leaves money on the line; only measured
  // sibling bookings could prove otherwise. The old default was `true`, which closed the line
  // and silently swallowed the remainder whenever the reference carried ≤1 token and the link
  // read hiccupped. Worst case of failing closed: an already-finished line lingers one more
  // round in "Te bevestigen" and the next confirm answers 409 — benign; the reverse hid money.
  // A multi-token reference still gets the legacy presence rule below (it can only ever KEEP a
  // line visible, never hide one).
  let allCovered = appliedElsewhereKnown
    ? bankLineFullyApplied(payAmount, settledByThisBooking) === true
    : false;

  if (!appliedElsewhereKnown && refNumbers.length > 1) {
    // Direction the bank movement implies (mirrors isEligible's sign guard):
    //   credit (amount > 0) → outgoing invoices (a customer paid us)
    //   debit  (amount < 0) → incoming invoices (we paid a supplier)
    const requiredDirection: "outgoing" | "incoming" =
      (tx.amount ?? 0) > 0 ? "outgoing" : "incoming";

    // [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap. A plain .select()
    // truncates without an error, and a truncated paid-set makes isFullyCovered answer "no"
    // for a transaction that IS fully settled — it then stays in "Te bevestigen" forever.
    let paidRows: { invoice_number: string | null }[] = [];
    let paidErr: { message: string } | null = null;
    try {
      paidRows = await fetchAllRows<{ invoice_number: string | null }>((from, to) =>
        pipeline
          .from("invoices")
          .select("invoice_number")
          .eq("status", "paid")
          .eq("direction", requiredDirection)
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order("id", { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      paidErr = { message: e instanceof Error ? e.message : String(e) };
    }

    if (paidErr) {
      // Don't fail the (completed) payment over a coverage read. Be conservative:
      // treat as not fully covered so the tx STAYS visible — never hide on doubt.
      console.error("[BANK-MULTI-CONFIRM] coverage lookup failed:", paidErr.message);
      allCovered = false;
    } else {
      const paidSet = new Set(
        (paidRows ?? [])
          .map((r) => normalizeRef(r.invoice_number ?? ""))
          .filter((n) => n.length > 0)
      );
      // [BANK-MULTI-LINK-PERSIST] Shared coverage rule (equality, not substring).
      allCovered = isFullyCovered(tx.reference, paidSet);
    }
  }

  // 6. Write (b): link the transaction. Pipeline (no trigger), user_id pinned.
  //    [BANK-MULTI-CONFIRM] Only flip to 'matched' when allCovered. Otherwise keep
  //    it 'pending' and just record invoice_id (the most recent link) so the tx
  //    remains in the active list with the open numbers still actionable.
  //    Failure here does NOT roll back the (legally complete) payment.
  const linkUpdate = allCovered
    ? { status: "matched" as const, invoice_id: invoiceId }
    : { invoice_id: invoiceId };

  // [HANDMATIG-OVERGENOMEN] auto_match_reason means one thing: the APP booked this line on amount
  // and supplier name alone, and nobody has checked it. readiness counts exactly the rows carrying
  // it while status='matched', and turns that count into "loop ze na vóór je de aangifte indient"
  // on the quarter-close board.
  //
  // The moment a human takes the row over, that sentence is false. Only the explicit "Klopt,
  // gecontroleerd" tap cleared it, so an unlink left the flag on the row and the next manual
  // confirm carried it back into 'matched' — and the board then warned the owner about a link the
  // owner made by hand. A false item on the one screen that exists to be believed.
  //
  // Its OWN update, deliberately, and best-effort. The column arrives with a hand-applied
  // migration (bank_auto_match_reason.sql), and folding it into the write above would turn a
  // lagging migration into a broken unlink — the same reasoning readiness gives for reading it
  // separately. A stale amber flag is a nuisance; a route that refuses to run is not.
  const clearAutoReason = async () => {
    await (pipeline
      .from("bank_transactions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ auto_match_reason: null } as any)
      .eq("id", transactionId)
      .eq("user_id", user.id) as unknown as PromiseLike<unknown>);
  };

  const { data: linkData, error: linkErr } = await pipeline
    .from("bank_transactions")
    .update(linkUpdate)
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending") // only touch a still-pending tx; never overwrite a matched link
    .select("id"); // [BANK-LINK-RACE] know whether the link actually landed (0 rows ⇒ tx grabbed)
  // [HANDMATIG-OVERGENOMEN] Only once the link really landed: a 0-row write means another
  // request took the line, and clearing the flag on somebody else's link would hide THEIR warning.
  if (!linkErr && linkData && linkData.length > 0) await clearAutoReason();

  if (linkErr) {
    console.error("[BOEK-016] transaction link failed after payment:", linkErr.message);
    // [BANK-LINK-ROLLBACK] The payment write succeeded but the bank link did not. Leaving
    // the invoice 'paid' with no linked bank line ORPHANS it: the matcher excludes paid
    // invoices, so the tx reappears as "geen factuur" and can never be re-confirmed
    // (invoice_already_paid). Roll the invoice back to its prior status so the state stays
    // consistent and the owner can simply retry — never a paid invoice with no proof.
    const { error: rollbackErr } = await supabase
      .from("invoices")
      .update({
        status: inv.status,
        payment_method: null,
        marked_paid_at: null,
        payment_date: null,
        // [PARTIAL-PAY] The payment write above also set amount_paid to the full total. Leaving
        // it there gives a 'sent' invoice an open balance of 0: it vanishes from the debtor list,
        // and a retry takes the wrong branch because invOpen reads 0. Restore the value this
        // request found, so the rollback returns the invoice to exactly its prior state.
        amount_paid: inv.amount_paid ?? 0,
      })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (rollbackErr) {
      console.error("[BANK-LINK-ROLLBACK] rollback also failed:", rollbackErr.message);
    }
    return NextResponse.json(
      { error: "transaction_link_failed", detail: linkErr.message, rolledBack: !rollbackErr },
      { status: 500 }
    );
  }

  // [BANK-LINK-RACE] A 0-row link with NO error means a concurrent confirm grabbed the tx
  // between our fetch and this write (the .eq("status","pending") no longer matched). Every
  // booking in THIS branch is one whose payment is larger than the invoice it settled, so the
  // money genuinely covers this invoice whatever else the bank line went on to pay: the payment
  // stands on its own and the join row below keeps it reversible by id. Rolling it back here
  // would un-pay an invoice that really was paid, so a no-op is benign and self-healing — we
  // only record it. (The hard-error path above still rolls back: there is no link at all then.)
  if (!linkData || linkData.length === 0) {
    console.warn("[BANK-LINK-RACE] transaction claimed concurrently; invoice stays paid", {
      transactionId, invoiceId, invoiceNumber: inv.invoice_number,
    });
  }
  // [BANK-TX-INVOICES] Record this (transaction → invoice) so a later reversal reverses by id, not
  // by number. A multi-invoice batch is confirmed one invoice per call, so successive confirms
  // accumulate every paid invoice onto the same tx here — the full, collision-free reversal set.
  // [PARTIAL-PAY] Record WHAT this payment applied to this invoice, not just that it did. This
  // branch settles the invoice in full, so the amount is the balance it had open a moment ago
  // (invOpen, read before the write above) — the same figure book_bank_batch records. Without it
  // the link counts as zero in recompute_invoice_amount_paid and a later unlink of any OTHER
  // payment on this invoice erases the money this one really settled.
  // [LINKS-WRITE-HONEST] Whether it landed is reported, not assumed. This row is what
  // /api/bank/match measures "is this line finished?" from ([BANK-COVERAGE-BY-MONEY]); without it
  // the route falls back to counting invoice numbers in the reference, and a line carrying any
  // token that is not a paid invoice number never leaves "Te bevestigen" — confirming it again
  // returns 409, the client reads that as done and re-fetches, and the card comes straight back.
  // The write used to swallow its error entirely, so that loop began in total silence.
  const linkRecorded = await recordPaymentLinks(
    pipeline, user.id, transactionId, [invoiceId], { [invoiceId]: invOpen },
  );

  // [BANK-OVERAPPLIED-LOUD] Two overlapping confirms of DIFFERENT invoices against the SAME bank
  // line can each read the sibling links before either has written — both then believe they have
  // the full line to spend, and Σ amount_applied ends ABOVE the line's own amount. The write
  // path has no cross-request mutex (only an atomic RPC could close that fully — documented as
  // deferred), so the next-best guarantee is that the state can never be silently wrong: re-read
  // the sum AFTER our link landed and, if the line is over-applied, say so loudly — an audit row
  // plus an owner notification naming the figures. Best-effort: a failed read changes nothing.
  //
  // [NO-SILENT-EMPTY] En de re-lezing leest haar eigen fout. Ze deed dat niet, en dat ondermijnde
  // precies de zin hierboven: supabase-js gooit niet, dus een mislukte re-lezing gaf `data: null`
  // → `?? []` → een som van 0 → 0 > payAmount is onwaar → géén auditregel, géén melding. De enige
  // waarborg tegen een race die dit bestand met zoveel woorden NIET kan sluiten, verdween dan in
  // stilte — en "de stand kan nooit stil verkeerd zijn" was de hele belofte.
  //
  // Blijft best-effort: de boekingen staan er al en mogen hier niet meer sneuvelen. Wat verandert
  // is dat een niet-uitgevoerde controle zélf een spoor achterlaat, zodat "geen alarm" niet twee
  // dingen tegelijk kan betekenen.
  try {
    // [LIJN-BUDGET] Via de gedeelde, GETEKENDE som. Hier stond een eigen optelling van
    // magnitudes (`t + Math.max(0, amount_applied)`) — per FACTUUR juist, per REGEL niet: een
    // creditnota geeft geld terug aan de regel, dus een regel van € 850 die bestaat uit een
    // inkoopfactuur van € 1.000 en een credit van € 150 telde € 1.150 en zou alarm slaan over een
    // boeking die precies klopt. Vandaag draagt geen enkele regel beide tegelijk, dus het was nog
    // geen vals alarm — maar een geldwaarschuwing die één keer ten onrechte afgaat, is de tweede
    // keer een die je wegklikt.
    const verdict = await readOverApplied({
      client: pipeline, userId: user.id, transactionId, txAmount: payAmount,
    });
    if (!verdict) throw new Error("over-application check could not run");
    if (verdict.over) {
      await logAuditAction({
        userId: user.id,
        action: "bank.overapplied",
        entityType: "bank_transaction",
        entityId: transactionId,
        newValue: { transaction_amount: payAmount, applied_sum: verdict.appliedSum, invoice_id: invoiceId },
      });
      const bericht = overAppliedNotice(verdict);
      await createNotification({
        userId: user.id,
        title: bericht.title,
        body: bericht.body,
        type: "payment",
        link: "/dashboard/bank",
      });
    }
  } catch (e) {
    // best-effort — the bookings themselves are already recorded and stay recorded. But the check
    // NOT having run is a fact about this transaction, so it is written down as one.
    console.error("[BANK-OVERAPPLIED-LOUD] over-application check did not run", { transactionId, e });
    await logAuditAction({
      userId: user.id,
      action: "bank.overapplied_check_failed",
      entityType: "bank_transaction",
      entityId: transactionId,
      newValue: {
        transaction_amount: payAmount,
        invoice_id: invoiceId,
        reason: e instanceof Error ? e.message : "sum read failed",
      },
    }).catch(() => { /* the trail is the last resort; it may not cost the booking either */ });
  }

  // 7. Notification (non-blocking) — notifications inserts use service_role by rule.
  const unassigned = appliedElsewhereKnown && !allCovered ? Math.max(0, moneyRemaining) : 0;
  await createNotification({
    userId: user.id,
    title: "Factuur betaald",
    body: `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`,
    type: "payment",
    // [NOTIF-DEADEND] Same fix as the partial-payment branch above: link to the
    // invoice this bell is about, by direction.
    link: inv.direction === "incoming"
      ? `/dashboard/incoming/manage?focus=${invoiceId}`
      : `/dashboard/invoice/${invoiceId}`,
  });
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Money of this payment is still unassigned. The bank line
  // stays in "Te bevestigen" so the next invoice can take it — say so, so the owner knows the
  // line is not stuck but waiting. (Before, that money was silently declared spent.)
  if (unassigned > 0.01) {
    await createNotification({
      userId: user.id,
      title: "Nog een deel van deze betaling open",
      body: `Van deze betaling van € ${payAmount.toFixed(2)} is € ${settledByThisBooking.toFixed(2)} op facturen geboekt. € ${unassigned.toFixed(2)} is nog niet toegewezen — koppel de volgende factuur.`,
      type: "payment",
      link: "/dashboard/bank",
    });
  }

  await logAuditAction({
    userId: user.id,
    action: "bank.confirmed",
    entityType: "invoice",
    entityId: invoiceId,
    newValue: {
      transaction_id: transactionId,
      invoice_number: inv.invoice_number,
      applied: invOpen,
      payment_amount: payAmount,
      applied_total: settledByThisBooking,
      unassigned,
      all_covered: allCovered,
    },
  });

  // [BANK-MULTI-CONFIRM] Return allCovered so the UI knows whether this transaction
  // is now fully done (→ Gekoppeld) or still has open numbers (→ stays in Te bevestigen).
  // `unassigned` is what is still waiting on this bank line after this booking.
  // [LINKS-WRITE-HONEST] The money is booked and the invoice is paid — so this is `ok`, not an
  // error. But if the index row did not land, this line may keep coming back to "Te bevestigen"
  // with nothing the owner can do about it. Answering a bare "Bevestigd ✓" over that is the app
  // knowing something the person in front of it does not.
  return NextResponse.json({
    ok: true, allCovered, applied: invOpen, unassigned,
    ...(linkRecorded ? {} : { warning: "payment_link_not_recorded" }),
  });
}