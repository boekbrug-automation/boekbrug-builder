// src/app/api/email/confirm/[id]/route.ts
// [BOEK-011] Incoming invoice actions  ([BRIDGE-B] verify/pay split)
// POST   → action 'verify' (processing→received, becomes a shared Crediteur) or
//          action 'pay' (→paid, requires payment_method bank|kas) — both TRAIL 2/3
// DELETE → ignore (archive — recoverable, never hard-deleted)
// PATCH  → restore an ignored invoice back to the verification queue (→processing)

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
// [PAY-DATE-SANE] one tested answer to "could a person have paid on this day?" — see payment-date.ts
import { paymentDateOutOfWindow, PAYMENT_DATE_REFUSAL } from "@/lib/payment-date";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [BOEK-011 + BOEK-SECURITY Phase 2.5] notifications writes must use service_role
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
// [CASH-SETTLE] keep the kasboek in sync when an invoice is paid/undone in cash
import { reconcileCashWithRetry } from "@/lib/cash-settle";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
// [BRIDGE-B] legal trail for verify/pay state changes
import { logAuditAction, getClientIP } from "@/lib/audit";
// [EEN-SCHRIJFPAD] The payment goes through the locked door, with a derived idempotency key.
import { deriveKey } from "@/lib/contracts/idempotency";
import { requirePermission } from "@/lib/access/context";
import { reportHandledFailure } from "@/lib/report-handled";
// [MONEY-GUARD] The one predicate for "this invoice already holds money" — shared with the
// dedicated archive route so the two doors to the same act cannot disagree.
import { hasSettledMoney } from "@/lib/invoice-removal";
// [NEGEER-REDEN] De toegestane redenen staan in één lijst — gedeeld met het scherm en met de
// CHECK-constraint in invoice_archive_reason.sql, zodat die drie niet uit elkaar kunnen lopen.
import { normalizeArchiveReason } from "@/lib/archive-reason";
// [READING-MEMORY] Which fields the human changed about the reader's answer — the one signal that
// makes "this supplier keeps being misread" a fact instead of a feeling.
// [SUPPLIER-ALIAS] Learn what a corrected leverancier name means — see src/lib/supplier-alias.ts.
import { learnSupplierAlias } from "@/lib/supplier-alias-write";
import { correctedFields } from "@/lib/reading-memory";
// [CREDIT-SIGN] A credit note has to be STORED negative — nothing that counts money reads the type.
import { asCreditAmounts } from "@/lib/creditnota-signal";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
// ── POST — verify or pay an incoming invoice ──────────────────────────────────
// [BRIDGE-B] Two actions, driven by body.action (default 'verify'):
//   'verify' → status 'processing' → 'received'  (becomes a SHARED Crediteur;
//              NOT marked paid — payment is a separate, later step)
//   'pay'    → status → 'paid'  (REQUIRES payment_method: 'bank' | 'kas' — DB
//              constraint invoices_paid_requires_method; used when already paid)
// Both run TRAIL 2/3 on the reviewed amounts (arithmetic + legal BTW rate).
// TRAIL is a FLAG, not a hard block — the human is the authority (Pillar ⑤).
// Update runs in USER context: RLS invoices_receiver_update + B.4 Exception 3
// both allow the receiver of an incoming invoice to change status/amounts.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Verify ownership + load current amounts (TRAIL needs unchanged fields too)
  // [NO-SILENT-EMPTY] supabase-js answers a failed read with { data: null, error }, so without
  // checking `error` a database problem arrived here as "Factuur niet gevonden" — the owner is told
  // their invoice does not exist while they are looking at it, on the one screen where confirming is
  // the whole point. The same rule and the same 503 as /api/invoice/[id]/amounts, so the two doors
  // into the books cannot answer the same outage two different ways.
  const { data: invoice, error: readErr } = await supabase
    .from("invoices")
    // [SUPPLIER-ALIAS] supplier_id + vendor_iban: what says WHICH company a corrected name belongs
    // to. Without one of them a rename is one name pointing at another, and only the alias is safe.
    .select("id, receiver_id, direction, status, total_ex_btw, btw_amount, total_inc_btw, invoice_number, client_name, invoice_date, invoice_type, supplier_id, vendor_iban")
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    console.error("[NO-SILENT-EMPTY] confirm read failed — refusing to write", { invoiceId: id, userId: user.id, error: readErr.message });
    return NextResponse.json(
      { error: "We konden deze factuur nu niet ophalen. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (invoice.direction !== "incoming") {
    return NextResponse.json(
      { error: "Alleen inkomende facturen kunnen hier bevestigd worden" },
      { status: 400 }
    );
  }

  // [BRIDGE-B] body: action + user-reviewed/edited amounts (+ payment_method for pay)
  // [BRIDGE-EXTRACT] also accepts reviewed client_name / invoice_number / invoice_date
  let body: {
    action?: string;
    total_ex_btw?: number;
    btw_amount?: number;
    total_inc_btw?: number;
    payment_method?: string;
    client_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    // [BRIDGE-QUARTER] real payment date (Axis 2 / cash). Distinct from
    // marked_paid_at (in-system confirmation timestamp).
    payment_date?: string;
    // [AUTO-CONFIRM-ONCE] The caller promises to run ONE bank auto-confirm pass itself after this
    // request (a bulk verify runs one after the whole batch). Opt-IN on purpose: absent or false —
    // an older client, or the pay path, which has no client-side pass at all — keeps today's
    // inline behaviour exactly. See the gate further down.
    deferAutoConfirm?: boolean;
    // [KIND-CORRECTION] The reviewer declares this a credit note after all. This direction only —
    // see the note at isCredit below.
    is_credit_note?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    // No body — default action, keep amounts already in DB
  }

  // Default 'verify' protects the legacy modal (no action sent) from the 500:
  // verify never sets status='paid', so the payment_method constraint can't fire.
  const action = body.action ?? "verify";
  if (action !== "verify" && action !== "pay") {
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  }

  // [EEN-POORT] One word in the body, two capabilities behind it, and they are asked for by their
  // own names: 'verify' approves a purchase invoice into the books (`expense.approve` — it becomes
  // a Crediteur the accountant sees and voorbelasting the aangifte claims), 'pay' books money
  // against it (`payment.create`). The resource is the administration the invoice was addressed
  // to, which the read above already proved is this session's own.
  {
    const gate = await requirePermission(
      action === "pay" ? "payment.create" : "expense.approve",
      { ownerId: invoice.receiver_id },
    );
    if (gate.response) return gate.response;
  }

  // [BRIDGE-CREDITNOTA-SIGN] A normal invoice's amounts are ≥ 0. A creditnota follows the safecore
  // rule (evaluateCreditnotaArithmetic): only the NET total is negative — the ex/BTW signs are NOT
  // constrained (real Altena case: ex −123, BTW +13,42, totaal −109,58). So validNum only enforces
  // ≥ 0 for a normal invoice; for a creditnota it accepts any finite value, so a correctly-read
  // negative excl / positive BTW persists instead of being dropped back to the stored amount. The
  // old blanket `v >= 0` (with the client's Math.max(0)) turned every edited creditnota positive.
  // [KIND-CORRECTION] The reviewer may correct the KIND, because the reader does not always get it
  // right. The real case: a potato wholesaler sends an invoice where a returned container of
  // −408.00 makes the total net negative (Totaal te voldoen −109.58). The reader stored it as an
  // ordinary invoice at +39.42, and then the owner could NOT enter the truth: the clamp below
  // pushed every negative amount back to 0, leaving a debt on the books that is in reality a
  // credit — including too much input tax reclaimed.
  //
  // Deliberately one direction only: 'factuur' → 'creditnota'. That is the side where the app sees
  // too little (a positively printed credit note is by definition not recognised by the reader, see
  // HUNT-F2), and it is the side that takes money OFF the outstanding balance rather than adding to
  // it. The reverse — declaring a credit note an invoice — does not occur in practice and would
  // quietly turn a credit into a debt; that way stays shut.
  const declaredCredit = body.is_credit_note === true;
  const isCredit = invoice.invoice_type === "creditnota" || declaredCredit;
  const validNum = (v: unknown): v is number =>
    typeof v === "number" && isFinite(v) && (isCredit ? true : v >= 0);

  // Effective amounts = reviewed values where valid, else what's already stored
  const exBtw  = validNum(body.total_ex_btw)  ? body.total_ex_btw  : (invoice.total_ex_btw  ?? 0);
  const btw    = validNum(body.btw_amount)    ? body.btw_amount    : (invoice.btw_amount    ?? 0);
  const incBtw = validNum(body.total_inc_btw) ? body.total_inc_btw : (invoice.total_inc_btw ?? 0);

  // [BRIDGE-B] Verification trails — FLAG, never hard-block (Pillar ⑤: the eye
  // confirms, it doesn't enter). Returned as `warnings` for the UI to surface.
  const warnings: string[] = [];
  // TRAIL 2 — arithmetic: excl + btw must equal incl (catches Excl/Incl mix-ups)
  if (Math.abs(exBtw + btw - incBtw) > 0.02) warnings.push("trail2_amounts");
  // TRAIL 3 — legal BTW rate. Uses the magnitude ratio |BTW / excl| (mirrors safecore and the
  // client), so a blended 0–21% rate is accepted and only an impossible >21% is flagged. The abs
  // also lets a creditnota (negative base, possibly positive goods-BTW) be checked correctly
  // instead of being skipped by the old `exBtw > 0` guard or false-flagged by a signed ratio.
  if (Math.abs(exBtw) > 0.005) {
    const rate = Math.round(Math.abs(btw / exBtw) * 100);
    if (rate > 21) warnings.push("trail3_btw_rate");
  }

  // ── Status patch per action ──
  const updatePatch: InvoiceUpdate = { updated_at: new Date().toISOString() };

  // Persist reviewed amounts when the user actually sent valid numbers
  // [KIND-CORRECTION] The kind correction travels in the same write as the amounts. One update, so
  // the kind can never come loose from the sign that belongs with it.
  if (declaredCredit && invoice.invoice_type !== "creditnota") updatePatch.invoice_type = "creditnota";
  if (validNum(body.total_ex_btw)) updatePatch.total_ex_btw = body.total_ex_btw;
  if (validNum(body.btw_amount)) updatePatch.btw_amount = body.btw_amount;
  if (validNum(body.total_inc_btw)) updatePatch.total_inc_btw = body.total_inc_btw;

  // [CREDIT-SIGN] The tick has to move the MONEY, not just the label.
  //
  // "Dit is een creditnota" set invoice_type and stopped there, while the sentence under it promised
  // "gaat hij van je openstaande saldo af en wordt zijn btw afgetrokken in plaats van opgeteld".
  // Neither followed, because nothing in this codebase reads the type when money is counted:
  // openAmountSigned takes its sign from `total_inc_btw < 0`, and /api/aangifte selects
  // total_ex_btw and btw_amount without invoice_type and sums them raw. So a credit note ticked and
  // left at +51,80 kept counting as a debt AND kept adding 4,28 to the voorbelasting it should have
  // removed — and the screen then flagged it as the sign conflict we had just created.
  //
  // Applied to the EFFECTIVE amounts (typed where the reviewer typed, stored otherwise), so ticking
  // the box without retyping anything still fixes a row the reader booked positive. Already-negative
  // amounts are left alone — see asCreditAmounts.
  if (isCredit || declaredCredit) {
    const signed = asCreditAmounts({ totalExBtw: exBtw, btwAmount: btw, totalIncBtw: incBtw });
    if (signed.flipped) {
      updatePatch.total_ex_btw = signed.totalExBtw;
      updatePatch.btw_amount = signed.btwAmount;
      updatePatch.total_inc_btw = signed.totalIncBtw;
    }
  }

  // [BRIDGE-EXTRACT] Persist reviewed metadata when the user edited it inline.
  // Only write non-empty strings; ignore blanks so a cleared field can't wipe data.
  if (typeof body.client_name === "string" && body.client_name.trim()) {
    updatePatch.client_name = body.client_name.trim();
  }
  if (typeof body.invoice_number === "string" && body.invoice_number.trim()) {
    updatePatch.invoice_number = body.invoice_number.trim();
  }
  // invoice_date: accept only a valid YYYY-MM-DD (the <input type="date"> format)
  if (typeof body.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date)) {
    updatePatch.invoice_date = body.invoice_date;
  }

  // [READING-MEMORY] What did the reviewer actually CHANGE about what the reader produced?
  //
  // This is the moment the app can learn something, and until now it threw the answer away: the
  // audit below recorded the status change and the new metadata, never the pair. So the reader got
  // Elegance Brands wrong in June, the owner fixed it, the prompt was strengthened on 26 July, and
  // on 30 July the next Elegance Brands invoice arrived with the same field wrong — with nothing
  // anywhere that could have said "this keeps happening at this supplier".
  //
  // Computed against the STORED row, not against what the screen posted: the verify form sends
  // every field on every confirm, so "was it submitted" would record a correction each time and
  // teach the memory that the owner corrects everything, always.
  //
  // The vendor is the name AFTER the reviewer's edit — if they corrected the supplier name too,
  // the corrections belong to the company they say it is, not to the one the reader guessed.
  const correctedNow = correctedFields(
    {
      total_ex_btw: invoice.total_ex_btw,
      btw_amount: invoice.btw_amount,
      total_inc_btw: invoice.total_inc_btw,
      invoice_type: invoice.invoice_type,
      client_name: invoice.client_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
    },
    {
      total_ex_btw: validNum(body.total_ex_btw) ? body.total_ex_btw : undefined,
      btw_amount: validNum(body.btw_amount) ? body.btw_amount : undefined,
      total_inc_btw: validNum(body.total_inc_btw) ? body.total_inc_btw : undefined,
      invoice_type: updatePatch.invoice_type,
      client_name: updatePatch.client_name,
      invoice_number: updatePatch.invoice_number,
      invoice_date: updatePatch.invoice_date,
    },
  );
  const memoryVendor = updatePatch.client_name ?? invoice.client_name;

  // [DATE-GATE] An incoming invoice may not be confirmed (verified or paid)
  // without a real invoice date. The date sets the tax period (factuurstelsel),
  // so confirming a dateless invoice would silently book it in the wrong
  // quarter. Ingestion now stores null when the AI could not read the date; the
  // reviewer enters it in the modal, which sends it here. Block when neither the
  // reviewed value nor the stored value is a real date.
  const effectiveDate =
    typeof body.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date)
      ? body.invoice_date
      : invoice.invoice_date;
  if (!effectiveDate) {
    return NextResponse.json(
      { error: "Factuurdatum ontbreekt — voer eerst de factuurdatum in voordat je de factuur bevestigt." },
      { status: 400 }
    );
  }

  // [EEN-SCHRIJFPAD] What the payment IS, held aside — not written into the patch below.
  //
  // Confirming and paying are two facts, and this route used to write them as one: a single
  // UPDATE that set status 'paid', a method, a marked_paid_at and an amount, with no
  // bank_tx_invoices row anywhere. amount_paid is a CACHE of SUM(amount_applied), so such an
  // invoice is a row that contradicts the only money invariant this app has — measured in
  // production before this change: 18 paid invoices with no allocation row, EUR 10.192 of them
  // carrying an amount that nothing accounts for. The kasstelsel return reads settlement from the
  // LINK, so on that scheme the payment is simply invisible to the figures the Belastingdienst
  // sees.
  //
  // So the patch below confirms (processing -> received, race-guarded exactly as before), and the
  // PAYMENT goes through apply_manual_payment — the same locked door /api/invoice/pay-toggle
  // uses, which writes the invoice state and the allocation row in one transaction.
  //
  // The half state this can leave is 'received': confirmed, not paid. That is an honest state the
  // owner can finish with one tap, and it is strictly better than the half state it replaces,
  // which no screen could tell apart from a real payment.
  let payAmount = 0;
  let payDate: string | null = null;
  let payMethod: "bank" | "kas" | null = null;

  if (action === "pay") {
    // DB constraint invoices_paid_requires_method: paid REQUIRES a method.
    if (body.payment_method !== "bank" && body.payment_method !== "kas") {
      return NextResponse.json(
        { error: "Betaalmethode vereist (bank of kas)" },
        { status: 400 }
      );
    }
    // Confirmed here; PAID by the RPC below, which owns status, payment_method and marked_paid_at.
    updatePatch.status = "received";
    payMethod = body.payment_method;
    // [BEDRAG-MEE] En het BEDRAG, want anders zegt deze rij twee dingen tegelijk.
    //
    // Dit was de enige deur die 'paid' schreef zonder amount_paid mee te nemen. /api/invoice/
    // pay-toggle doet het wel (via apply_manual_payment), de bankbevestiging doet het, de
    // auto-confirm doet het — hier bleef de kolom op 0 staan naast een status die zegt dat alles
    // is voldaan. Eén feit, vier schrijvers, en één ervan schreef het half.
    //
    // Gemeten in de productiedatabase: vijf inkoopfacturen staan zo — 'paid', methode 'bank',
    // amount_paid 0, geen enkele bankkoppeling. De geldaudit van deze app meldt ze, en met een zin
    // die het verkeerde zegt: "staat op betaald, maar er is € 79,00 van open" terwijl er niets
    // openstaat en alleen de kolom niet is geschreven. Een controlepaneel dat vijf dingen verkeerd
    // benoemt, is een paneel dat de eigenaar niet meer leest.
    //
    // De MAGNITUDE, zoals overal: amount_paid is altijd positief, ook op een creditnota, want het
    // is "hoeveel geld er is bewogen" en niet "in welke richting" — dat zegt total_inc_btw al.
    // De effectieve waarde (getypt waar de beoordelaar iets typte, anders het opgeslagen totaal),
    // want dit is dezelfde schrijving die dat totaal bijwerkt.
    payAmount = Math.abs(Number(updatePatch.total_inc_btw ?? incBtw) || 0);
    // [BRIDGE-QUARTER] Real payment date (Axis 2 / cash). Prefer an explicit YYYY-MM-DD; else the
    // invoice's OWN date (a receipt uploaded weeks later is a far better accounting-day proxy than
    // "today", which would misattribute a cross-quarter payment to the wrong quarter); "today" is
    // only the last resort so a paid invoice never lacks a payment_date. marked_paid_at stays the
    // precise confirmation timestamp; payment_date is the accounting day. (Accrual BTW is on the
    // invoice date regardless, so this only fixes the settlement-quarter display.)
    // [PAY-DATE-SANE] The shape test (isoRe) accepts "2062-03-01" and "1926-07-04", and this is
    // the third door that writes payment_date — the field that decides the kasstelsel quarter
    // (vat-scheme.ts:7) and dates the kasboek entry for a cash payment. Two rules, because the
    // two cases are not the same thing:
    //   · a date the OWNER typed and that cannot be real is ANSWERED, not silently replaced by
    //     today — booking on a day they did not choose is the quiet error we are removing;
    //   · a FALLBACK (the reviewed or stored invoice date) that is out of window is simply not
    //     used. That date came from OCR, so an impossible one is a reading mistake, and it must
    //     not become the payment day — but it is no reason to refuse the confirmation itself.
    const today = amsterdamToday();
    const typedDate = typeof body.payment_date === "string" && body.payment_date.trim() !== "" ? body.payment_date.trim() : null;
    if (typedDate && paymentDateOutOfWindow(typedDate, today)) {
      // [SERVER-REASON] On this route's POST the SENTENCE lives in `error` (see the client's
      // confirmFailureMessage and the betaalmethode refusal above) — a machine code here would
      // reach the owner as "invalid_payment_date". The code rides along under its own key.
      return NextResponse.json({ error: PAYMENT_DATE_REFUSAL, code: "invalid_payment_date" }, { status: 400 });
    }
    const sane = (d: unknown): string | null =>
      typeof d === "string" && d !== "" && !paymentDateOutOfWindow(d, today) ? d : null;
    payDate = typedDate ?? sane(body.invoice_date) ?? sane(invoice.invoice_date) ?? today;
  } else {
    // verify → enters the accountant's world as a Crediteur (unpaid, shared)
    updatePatch.status = "received";
  }

  // [CONFIRM-GUARD] Only a QUEUE row ('processing') can be confirmed here. Without
  // this precondition a stale tab / double-submit could act on an already-handled
  // invoice: 'verify' on a PAID row rewrote status back to 'received' while its
  // payment fields stayed populated (inconsistent state), and 'pay' could re-pay.
  // Race-proof: the WHERE re-checks at write time; zero rows → honest conflict.
  if (invoice.status !== "processing") {
    return NextResponse.json(
      { error: "Deze factuur is al bevestigd — ververs de pagina." },
      { status: 409 }
    );
  }
  const { data: confirmData, error } = await supabase
    .from("invoices")
    .update(updatePatch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("status", "processing")
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!confirmData || confirmData.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur is al bevestigd — ververs de pagina." },
      { status: 409 }
    );
  }

  // [EEN-SCHRIJFPAD] The payment, through the one locked door.
  //
  // apply_manual_payment writes invoices.amount_paid, the status flip and the bank_tx_invoices
  // row inside ONE transaction under a row lock — which is what makes
  // amount_paid = SUM(amount_applied) a fact rather than a hope. p_payable_statuses is
  // ['received'] and nothing wider: the patch above just put this invoice there, and 'processing'
  // is deliberately not payable (its amounts came from the reader and this door is precisely the
  // moment a human took them over).
  //
  // [CONTRACT] The idempotency key is DERIVED from the invoice, not minted: a double submit, a
  // retried request and a second tab all arrive at the same key, and the partial unique index on
  // client_key refuses the second booking under the row lock. Keying on the invoice alone is
  // exact here because the guard above lets this door fire at most once per invoice — only a
  // 'processing' row may be confirmed, and this confirmation is what ends that.
  let paymentBooked = action !== "pay";
  if (action === "pay" && payMethod && payDate) {
    const { error: payErr } = await supabase.rpc("apply_manual_payment", {
      p_user_id: user.id,
      p_invoice_id: id,
      p_amount: payAmount > 0 ? payAmount : null,
      p_pay_date: payDate,
      p_method: payMethod,
      p_payable_statuses: ["received"],
      p_client_key: deriveKey("email-confirm-pay", id),
    });
    if (payErr) {
      // The confirmation stands and the payment does not. Said out loud, both to the owner and to
      // the alarm: a route that answered "betaald ✓" over an unbooked payment is exactly the
      // silence this change removes. The invoice is now an ordinary open crediteur, and the
      // "Betaald" toggle on that screen finishes it in one tap.
      reportHandledFailure({
        tag: "EEN-SCHRIJFPAD", severity: "data-integrity",
        message: "factuur bevestigd maar de betaling is niet geboekt",
        context: { userId: user.id, invoiceId: id, error: payErr.message },
      });
      return NextResponse.json(
        { error: "De factuur is bevestigd, maar de betaling is niet geboekt. Zet hem op betaald bij Crediteuren.", code: "payment_not_booked" },
        { status: 409 },
      );
    }
    paymentBooked = true;
  }

  // [BRIDGE-B] Audit the state change (legal trail: who confirmed what, when).
  // Non-fatal — never throws, never blocks the response.
  await logAuditAction({
    userId: user.id,
    action: "invoice.status_changed",
    entityType: "invoice",
    entityId: id,
    // [READING-MEMORY] The reader's side of the pair. Recorded only when something was actually
    // corrected, so an ordinary confirm does not grow the trail — and so a row that HAS these
    // fields is by construction a row where the human disagreed with the machine.
    oldValue: {
      status: invoice.status,
      ...(correctedNow.length
        ? {
            total_ex_btw: invoice.total_ex_btw,
            btw_amount: invoice.btw_amount,
            total_inc_btw: invoice.total_inc_btw,
            invoice_type: invoice.invoice_type,
            client_name: invoice.client_name,
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date,
          }
        : {}),
    },
    newValue: {
      // [EEN-SCHRIJFPAD] The status the invoice actually reached: the patch says 'received' for a
      // pay too, because the RPC above is what makes it 'paid'.
      status: action === "pay" && paymentBooked ? "paid" : updatePatch.status,
      action,
      // The human's side, plus WHICH fields moved — so reading the memory back is a lookup rather
      // than a diff of two jsonb blobs by every consumer that wants it.
      ...(correctedNow.length
        ? { reading_correction: { vendor: memoryVendor, fields: correctedNow } }
        : {}),
      ...(action === "pay" ? { payment_method: body.payment_method } : {}),
      ...(action === "pay" && payDate ? { payment_date: payDate } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(updatePatch.client_name ? { client_name: updatePatch.client_name } : {}),
      ...(updatePatch.invoice_number ? { invoice_number: updatePatch.invoice_number } : {}),
      ...(updatePatch.invoice_date ? { invoice_date: updatePatch.invoice_date } : {}),
    },
    ipAddress: getClientIP(req),
  });

  // [CASH-SETTLE] If this pay was in cash (or an earlier cash payment was just undone),
  // keep the kasboek in sync immediately — create the linked 'betaling' entry (balance-only,
  // never a cost) or remove an orphan. Self-healing + best-effort; the kasboek load also
  // reconciles, so this only makes it instant.
  // The kasboek settlement is UNCONDITIONAL and stays that way: it is what turns a
  // `payment_method: 'kas'` confirmation into a drawer movement, and the pay path has nothing else
  // that would do it. Only the bank scan below is skippable.
  // [CASH-RETRY] With the retry, because of what the paragraph above claims: this call is the only
  // thing that turns a payment_method 'kas' confirmation into a drawer movement. A bailed pass here
  // left the owner told their invoice was paid in cash while the drawer never moved — healed later by
  // the cron or the next Kas load, but this door had the strongest claim and the weakest handling.
  await reconcileCashWithRetry(supabase, user.id);
  // [BANK-LINK] A just-verified invoice may already have its payment sitting in an imported bank
  // statement — including as part of a multi-invoice batch. Run the SAME safe engine the cron runs
  // (only books provably-exact reference+amount / iban+amount / exact-batch matches), inline, so
  // the invoice flips to 'betaald · gekoppeld' IMMEDIATELY instead of waiting up to a day for the
  // daily cron. This is exactly the gap where an already-paid invoice showed "24 dagen te laat".
  // Best-effort: a failure just defers the link to the cron / the /bank page, never blocks verify.
  //
  // [AUTO-CONFIRM-ONCE] …but ONCE per user action, not once per invoice. runBankAutoConfirm is a
  // FULL-ACCOUNT pass: every pending bank line and every non-paid invoice of this owner, paginated,
  // then matched pairwise. Running it here on every confirm meant a bulk verify of N invoices did
  // N of those scans — while the client that drives that loop states the opposite in its own code
  // ("ONE auto-confirm pass after the whole batch — never per invoice, which would re-scan the full
  // set N times"), and then runs its single pass anyway. The client's intent was right; this call
  // silently defeated it. A caller that will run its own pass now says so and we skip ours.
  //
  // Deliberately opt-IN: an older client, and the pay path (which has no client-side pass), send
  // nothing and keep the inline scan exactly as before.
  if (!body.deferAutoConfirm) {
    try {
      await runBankAutoConfirm({ payClient: supabase, pipeline: createPipelineClient(), userId: user.id });
    } catch { /* non-fatal — cron / bank page still catches it */ }
  }

  // ── Notify (service_role — notifications has no authenticated INSERT policy) ──
  // [ZERO-ROWS-NORMAL] .maybeSingle(), because "no accountant linked" is the ordinary case for a
  // ZZP'er — .single() treats it as an error (PostgREST 406) that this call site then discards.
  // The .limit(1) STAYS: accountant_clients is UNIQUE(accountant_id, zzper_id), so an owner may
  // legitimately have two accountants, and maybeSingle() without a limit fetches a list and nulls
  // the result when it finds more than one row — which would silently stop notifying either of them.
  const { data: link } = await supabase
    .from("accountant_clients")
    .select("accountant_id")
    .eq("zzper_id", user.id)
    .limit(1)
    .maybeSingle();

  // ── [BRIDGE-NOTIF] Notification enrichment ──────────────────────────────────
  // A senior accountant wants WHO + WHAT + amount + a click that lands on the row.
  // All values are best-effort; every piece degrades gracefully if missing.

  // Effective incl amount for display (reviewed value where the user edited it).
  const fmtEur = (n: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
  const amountLabel = incBtw > 0 ? ` · ${fmtEur(incBtw)}` : "";

  // Invoice number + vendor (client_name on an INCOMING invoice = the supplier).
  const invNr = invoice.invoice_number ? `factuur ${invoice.invoice_number}` : "een factuur";
  const vendor =
    typeof invoice.client_name === "string" && invoice.client_name.trim()
      ? ` (${invoice.client_name.trim()})`
      : "";

  // Client (the ZZP'er) display name — for the ACCOUNTANT's notification only.
  let clientName = "Een klant";
  {
    const { data: me } = await supabase
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", user.id)
      .maybeSingle();
    if (me?.company_name?.trim()) clientName = me.company_name.trim();
    else if (me?.full_name?.trim()) clientName = me.full_name.trim();
  }

  // Quarter for the accountant deep-link, derived from invoice_date (fallback: today).
  // The row lives in /dashboard/clients/{zzper}/kwartaal?q=&year=&focus={id}.
  // [TZ] Read the year/month off the ISO STRING, not off a Date. `new Date("2026-01-01")` is UTC
  // midnight and .getFullYear()/.getMonth() then answer in the SERVER's zone — one hour west of
  // UTC and this invoice lands in Q4 of the previous year, so the accountant's notification opens
  // the wrong quarter and the row it promises to focus is not in it. The string already holds the
  // answer; falling back to the Amsterdam day (never the host's) when there is no invoice date.
  // `effectiveDate`, not invoice.invoice_date: that row was read BEFORE the update, and the whole
  // reason [DATE-GATE] exists is that ingestion stores null when the AI could not read a date — the
  // reviewer types it in the modal and this request writes it. Reading the stale row would send the
  // accountant to today's quarter for exactly the invoices whose date was just supplied. The gate
  // above already guarantees effectiveDate is a real ISO day, so the fallback is only a belt.
  const isoDay =
    typeof effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(effectiveDate)
      ? effectiveDate.slice(0, 10)
      : amsterdamToday();
  const dlYear = Number(isoDay.slice(0, 4));
  const dlQuarter = Math.ceil(Number(isoDay.slice(5, 7)) / 3);
  const accountantLink = `/dashboard/clients/${user.id}/kwartaal?q=${dlQuarter}&year=${dlYear}&focus=${id}`;

  // Client deep-link — always the management surface, focused on this row.
  const clientLink = `/dashboard/incoming/manage?focus=${id}`;

  if (link?.accountant_id) {
    const accNotif = await createNotification({
      userId: link.accountant_id,
      title: action === "pay" ? "Factuur betaald gemarkeerd" : "Nieuwe crediteur ter inzage",
      body:
        action === "pay"
          ? `${clientName} markeerde ${invNr}${vendor}${amountLabel} als betaald.`
          : `${clientName} verifieerde ${invNr}${vendor}${amountLabel} — nieuwe crediteur.`,
      type: "invoice",
      // [BRIDGE-NOTIF] deep-link: lands on the client's quarter and focuses the row.
      link: accountantLink,
    });
    if (!accNotif.ok) {
      console.error("[BRIDGE-B] accountant notification failed", accNotif.error);
      // Non-fatal — the confirmation already succeeded.
    }
  }

  // Notify the user themselves — confirmation
  const userNotif = await createNotification({
    userId: user.id,
    title: action === "pay" ? "Factuur betaald" : "Factuur geverifieerd",
    body:
      action === "pay"
        ? `${invNr.charAt(0).toUpperCase() + invNr.slice(1)}${vendor}${amountLabel} — betaald en doorgezet naar je boekhouder.`
        : `${invNr.charAt(0).toUpperCase() + invNr.slice(1)}${vendor}${amountLabel} — geverifieerd en doorgezet naar je boekhouder.`,
    type: action === "pay" ? "payment" : "invoice",
    // [BRIDGE-NOTIF] deep-link: management surface, focused on this row.
    link: clientLink,
  });
  if (!userNotif.ok) {
    console.error("[BRIDGE-B] user notification failed", userNotif.error);
  }

  // [SUPPLIER-ALIAS] The SAME lesson the pay screen's correction sheet learns. Both doors correct a
  // leverancier name, so a lesson learned at one and not the other is a feature the owner cannot
  // rely on — and this door is the one they use first, on every imported invoice.
  //
  // After the confirm, never before: a lesson drawn from a correction that did not save would teach
  // the app something that is not in the books.
  const aliasLearned = updatePatch.client_name
    ? await learnSupplierAlias(supabase, user.id, {
        printedName: invoice.client_name,
        correctedName: updatePatch.client_name,
        supplierId: (invoice as { supplier_id?: string | null }).supplier_id ?? null,
        vendorIban: (invoice as { vendor_iban?: string | null }).vendor_iban ?? null,
      })
    : null;

  return NextResponse.json({
    ok: true,
    // Null when nothing was learned — never a claimed memory that does not exist.
    supplier_memory: aliasLearned?.message ?? null,
    ...(warnings.length ? { warnings } : {}),
  });
}

// ── DELETE — ignore (archive) ─────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // [NEGEER-REDEN] Optioneel: waarom wordt hij genegeerd. Een NOTITIE, geen besluit — hij
  // verandert niets aan wat er gebeurt. Onbekende of ontbrekende waarde → null; een oude client
  // die niets stuurt werkt dus precies als voorheen.
  let reason: ReturnType<typeof normalizeArchiveReason> = null;
  try {
    const body = await req.json();
    reason = normalizeArchiveReason((body as { reason?: unknown })?.reason);
  } catch {
    // Geen body — dat mag. De vraag is vrijwillig.
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BOEK-011] Archive — never hard-delete. Recoverable via PATCH.
  // [CONFIRM-GUARD] Only from 'processing' (skip from the verify queue) or
  // 'received' (the manage page's archive-a-duplicate flow). Never from 'paid':
  // archiving a paid invoice would hide booked money from every ledger surface.
  //
  // [MONEY-GUARD] 'paid' is not the only state that holds money. An invoice PARTLY paid sits in
  // 'received' with amount_paid > 0, and a bank-linked one can too — both slipped straight
  // through the status filter. Archiving them is exactly the harm the comment above describes:
  // 'archived' is outside INCOMING_OK, so the invoice stops counting, while the bank line that
  // paid it is skipped by `if (t.invoice_id) continue` as "payment of an already-counted invoice"
  // — the debit is then counted NOWHERE, and the quarter's kosten and voorbelasting are quietly
  // too low. The dedicated archive route refuses both cases; this one is the same act by another
  // door, so it applies the same two gates.
  //
  // [MONEY-GUARD-CLOSED] Both reads dropped their error, and for a GUARD that is the dangerous
  // direction: supabase-js answers a failed read with `{ data: null, error }`, so `money` became
  // null and `money && …` skipped the whole check — a read we could not perform came out as
  // "no money on this invoice". The same for the link read one step below. This is the button the
  // manage screen calls "Deze dubbele verwijderen", so the invoice it points at is one the owner
  // has already been told is probably paid.
  const { data: money, error: moneyErr } = await supabase
    .from("invoices")
    .select("status, amount_paid")
    .eq("id", id)
    .eq("receiver_id", user.id)
    .maybeSingle();
  if (moneyErr) {
    console.error("[MONEY-GUARD-CLOSED] money check failed — refusing to archive", { invoiceId: id, userId: user.id, error: moneyErr.message });
    return NextResponse.json(
      {
        error: "money_check_failed",
        detail: "We konden nu niet controleren of er al betaald is op deze factuur. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
      },
      { status: 503 },
    );
  }
  if (money && hasSettledMoney(money)) {
    return NextResponse.json(
      { error: "money_settled", detail: "Er is al betaald op deze factuur — draai eerst de betaling terug." },
      { status: 409 },
    );
  }
  // A booked payment always leaves a join row. Refusing on its mere existence also covers rows
  // written before amount_applied existed, whose amounts cannot be read back.
  const { data: bankLinks, error: bankLinksErr } = await supabase
    .from("bank_tx_invoices")
    .select("transaction_id")
    .eq("user_id", user.id)
    .eq("invoice_id", id)
    .limit(1);
  if (bankLinksErr) {
    console.error("[MONEY-GUARD-CLOSED] bank-link check failed — refusing to archive", { invoiceId: id, userId: user.id, error: bankLinksErr.message });
    return NextResponse.json(
      {
        error: "money_check_failed",
        detail: "We konden nu niet controleren of er een betaling aan deze factuur hangt. Er is niets gewijzigd — probeer het zo meteen opnieuw.",
      },
      { status: 503 },
    );
  }
  if ((bankLinks ?? []).length > 0) {
    return NextResponse.json(
      { error: "bank_linked", detail: "Er is een banktransactie aan deze factuur gekoppeld — ontkoppel die eerst op de Bank-pagina." },
      { status: 409 },
    );
  }

  // [NEGEER-REDEN] De reden en het archiveringsmoment gaan mee in DEZELFDE update — één schrijf,
  // dus de notitie kan nooit los komen te staan van de archivering.
  //
  // De migratie invoice_archive_reason.sql wordt in dit project met de hand toegepast, dus er is
  // een venster waarin deze code al draait en de kolommen nog niet bestaan. Dan mag de ARCHIVERING
  // niet sneuvelen op een notitie: bij een ontbrekende-kolom-fout (PostgREST PGRST204 / Postgres
  // 42703) schrijven we hem opnieuw zonder de nieuwe velden. De eigenaar merkt alleen dat het
  // label ontbreekt — niet dat de knop stuk is.
  const archiveNow = new Date().toISOString();
  const basePatch: InvoiceUpdate = { status: "archived", updated_at: archiveNow };
  // [MONEY-GUARD-CLOSED] The WHERE clause re-asserts the money gate too, not just the status.
  // `.in('status', …)` keeps a 'paid' row out, but a PARTLY paid invoice sits in 'received' with
  // amount_paid > 0 and walked straight through it — the read above was the only thing stopping
  // it, and a read can be seconds stale (or, until a moment ago, failed). Re-asserting it in the
  // write is the same discipline /api/invoice/[id]/archive uses: a check that is not in the WHERE
  // clause is a check that can be raced.
  const archiveInvoice = (patch: InvoiceUpdate) =>
    supabase
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .in("status", ["processing", "received"])
      // 0.005 = the same cent of slack hasSettledMoney uses (invoice-removal.ts), so the SQL gate
      // and the pure rule can never disagree about what "niets betaald" means.
      .or("amount_paid.is.null,amount_paid.lte.0.005")
      .select("id");

  let { data: archData, error } = await archiveInvoice({
    ...basePatch,
    archive_reason: reason,
    archived_at: archiveNow,
  });
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    console.warn("[NEGEER-REDEN] archive_reason/archived_at ontbreken nog — migratie niet toegepast; archiveer zonder notitie");
    ({ data: archData, error } = await archiveInvoice(basePatch));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!archData || archData.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur kan niet worden verwijderd (al betaald of al verwerkt) — ververs de pagina." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}

// ── PATCH — restore an ignored invoice ────────────────────────────────────────

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BRIDGE-B] Restore: archived → processing (re-enters the verification queue).
  // Must NOT go to 'received' — that would push an unverified invoice straight to
  // the accountant via the restore path (shared=true). The queue is 'processing'.
  // [UI-HONESTY] .select() so "geen rij geraakt" is distinguishable from "teruggezet".
  // Without it this returned ok:true when the WHERE matched nothing (already restored,
  // wrong id, not archived) — and every caller that checks res.ok, including the
  // "Terugzetten" knop on a geweigerde upload, would claim a success that never happened.
  const restore = (patch: InvoiceUpdate) =>
    supabase
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "archived")
      .select("id");

  const basePatch = { status: "processing", updated_at: new Date().toISOString() };
  // [SUPERSEDE] Clear "vervangen door X" on the way back — this is the restore the Genegeerd tab
  // actually calls. That label is only true of an ARCHIVED row; an invoice back in the queue that
  // still claims something replaced it is a contradiction the owner would have to resolve from
  // memory. Superseding is meant to be reversible at the cost of one tap.
  // [DEPLOY-SAFE] The column arrives with invoice_superseded_by.sql (applied by hand) — until
  // then a missing-column error must not break restore itself.
  let { data: restored, error } = await restore({ ...basePatch, superseded_by_number: null });
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: restored, error } = await restore(basePatch));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!restored || restored.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur staat niet (meer) in Genegeerd — ververs de pagina." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}