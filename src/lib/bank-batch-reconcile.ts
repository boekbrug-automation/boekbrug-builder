// src/lib/bank-batch-reconcile.ts
// [BANK-BATCH-RECONCILE] Pure reconciliation of a multi-invoice bank payment.
//
// A single bank debit can pay SEVERAL invoices at once (a wholesaler batches a week of
// deliveries into one direct debit; the bank writes every invoice number in the
// reference). The card lists one slot per referenced number. The honest question the
// owner needs answered before confirming is NOT "does each amount appear in my
// statement" (it does NOT — only the SUM was debited) but "do the invoices I found add
// up to exactly what left my account".
//
// This module answers that, and ONLY asserts a tie when every referenced number has a
// matched invoice with a known amount AND their gross totals sum to the bank amount to
// the cent. Anything short of that is reported honestly as a mismatch or as incomplete
// (some invoices not yet in the administration) — never a false green.
//
// Run: npx tsx src/lib/bank-batch-reconcile.test.ts

import { normalizeRef, parseReferenceNumbers, referenceMatches, isStrongNameIdentity, ibanMatches, isPayableInvoiceState } from "./bank-matching";
import { round2 } from "./invoice-totals";

/** The payment text a batch is read from: the extracted reference AND the raw remittance. */
export interface BatchPaymentText {
  reference: string | null | undefined;
  /** The full statement line. REQUIRED in practice — see resolveBatchNumbers. */
  description?: string | null;
}

// [BANK-PSP-MATCH] Which of the invoice numbers we KNOW does this payment actually reference?
//
// This is the ONLY safe signal for "is this a genuine multi-invoice batch?". A PSP / order
// gateway (Mollie, webshop) writes a transaction hash + an order number in the remittance, so
// the reference has several fragments even though ZERO of them are invoice numbers. Counting
// fragments alone (the old bug) forced the slot view and hid a real amount-matched invoice.
// Counting FULL-amount candidates instead (the second bug an adversarial review caught) let an
// UNRELATED invoice that happened to equal the whole debit collapse a genuine batch and
// auto-select the wrong invoice. Resolving against real invoice numbers avoids both.
//
// [BUNDEL-REF-RECOVER] It reads the DESCRIPTION as well as the reference, and that is the whole
// point. `reference` is what extractInvoiceReference could carve out of the remittance, and its
// token regex cuts a number at every separator and drops a leading year as "a bare year":
//     "2026-045, 2026-046"  →  reference "045, 046"
//     "F-1001, F-1002"      →  reference "1001, 1002"
// Both are then unmatchable — "045" is below the 4-char safety floor, and "1001" is not the
// invoice's number ("F-1001"). So for every owner whose invoices are NOT on the app's default
// {year}{seq} template — which is EVERY supplier invoice, since the supplier numbers those —
// the app could not recognise the bundled payment IT asked the owner to make. Matching the
// invoice's own number against the full text with referenceMatches' whole-token rules recovers
// it: the raw "2026-045" is still in the description, and normalizeRef makes the separator
// irrelevant. The 4-char floor stays (a 3-digit "045" can never be identified safely).
/** How a number was recognised in the payment — the difference decides what may be booked
 *  unattended. 'reference' = it IS one of the fragments the extractor carved out of the
 *  remittance, compared whole to a whole invoice number (identity). 'text' = it was found inside
 *  the free statement line by a whole-token scan (strong, but a scan). */
export interface ResolvedBatchNumber {
  number: string;
  via: "reference" | "text";
}

export function resolveBatchNumbersDetailed(
  tx: BatchPaymentText,
  knownInvoiceNumbers: Array<string | null | undefined>,
): ResolvedBatchNumber[] {
  // The equality path splits the reference the way the extractor JOINED it ("num1, num2") and
  // applies NO length floor: comparing a whole fragment to a whole invoice number is exact
  // identity, so a short number like "501" is safe here (it is not a substring search). The
  // 4-char floor belongs to the text scan below — see referenceMatches — and the automatic
  // booking path applies its own rule on top, using the `via` this function reports.
  const refTokens = new Set(
    (tx.reference ?? "").split(",").map((part) => normalizeRef(part)).filter((t) => t.length > 0),
  );
  const scan = { reference: tx.reference ?? null, description: tx.description ?? "" };
  const seen = new Set<string>();
  const found: ResolvedBatchNumber[] = [];
  for (const raw of knownInvoiceNumbers) {
    const number = (raw ?? "").trim();
    if (!number) continue;
    const key = normalizeRef(number);
    if (key.length === 0 || seen.has(key)) continue; // dedup: a doubled number isn't two invoices
    // Either the extracted reference lists this exact number (the classic case), or the number
    // is printed as a whole token somewhere in the payment text (the recovery case above).
    if (refTokens.has(key)) {
      seen.add(key);
      found.push({ number, via: "reference" });
    } else if (referenceMatches(scan, number)) {
      seen.add(key);
      found.push({ number, via: "text" });
    }
  }
  return found;
}

/** The numbers alone — for callers that only need to know WHICH invoices a payment references
 *  (the slot view, the batch/PSP distinction). */
export function resolveBatchNumbers(
  tx: BatchPaymentText,
  knownInvoiceNumbers: Array<string | null | undefined>,
): string[] {
  return resolveBatchNumbersDetailed(tx, knownInvoiceNumbers).map((r) => r.number);
}

export interface BatchSlotInput {
  refNum: string;
  /**
   * What this payment can still SETTLE on the matched invoice: its gross total minus what
   * earlier instalments already covered ([PARTIAL-PAY] amount_paid), sign preserved. Null when
   * no invoice with this number is in the system yet (the slot shows "Koppelen").
   *
   * It is the OPEN amount, not the total, because that is what actually leaves the bank. The
   * app's own gebundeld betaalverzoek asks the customer for exactly the sum of the open amounts
   * (buildBundelBetaalverzoek), so summing TOTALS here would call the app's own, perfectly
   * correct payment a mismatch as soon as one invoice in the bundle had a prior instalment.
   * For a fully open invoice open == total, so the classic wholesale batch is unchanged.
   */
  amount: number | null;
  /** Already paid/confirmed against this transaction. */
  isConfirmed: boolean;
}

/**
 * The still-settleable amount of an invoice: its magnitude minus what is already paid, carrying
 * the invoice's own sign (a creditnota stays negative so it REDUCES a batch sum — see
 * [BATCH-SIGN] in reconcileBatch). Returns null when the total is unusable, so a corrupt value
 * can never silently pass as a slot amount.
 */
export function settleableAmount(
  totalIncBtw: number | null | undefined,
  amountPaid?: number | null,
): number | null {
  if (totalIncBtw == null || !Number.isFinite(totalIncBtw)) return null;
  const paid = Math.max(0, Number(amountPaid ?? 0));
  const open = Math.max(0, Math.abs(totalIncBtw) - paid);
  const signed = totalIncBtw < 0 ? -open : open;
  return round2(signed);
}

export type BatchStatus =
  | "ties" // every slot matched AND the sum equals the bank amount to the cent
  | "mismatch" // every slot matched BUT the sum differs from the bank amount
  | "incomplete"; // at least one slot has no matched invoice → sum can't be trusted

export interface BatchReconcile {
  slotCount: number;
  /** Slots whose invoice is in the system with a usable (finite) amount. */
  matchedCount: number;
  /** NET sum of matched invoice totals (a creditnota is negative), absolute euros. */
  total: number;
  /** The bank transaction amount, absolute euros. */
  bankAmount: number;
  /** total − bankAmount (can be negative), absolute-bank basis. Meaningful when allMatched. */
  diff: number;
  allMatched: boolean;
  anyConfirmed: boolean;
  status: BatchStatus;
}

/** Compare two euro amounts at cent precision, float-safe. */
function centsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Reconcile the slots of one multi-invoice payment against the bank amount.
 *
 * `bankAmount` may arrive signed (credit +, debit −) — only its magnitude matters, so a
 * −€2.902,60 debit reconciles against three positive invoice totals just the same.
 * A slot amount that is null / non-finite is treated as "not matched" (unknown), so a
 * corrupt value can never silently pass as a tie.
 */
export function reconcileBatch(
  slots: BatchSlotInput[],
  bankAmount: number,
): BatchReconcile {
  const bankAbs = Math.abs(bankAmount);
  const known = slots.filter(
    (s) => s.amount != null && Number.isFinite(s.amount),
  );
  const matchedCount = known.length;
  const allMatched = slots.length > 0 && matchedCount === slots.length;
  // [BATCH-SIGN] NET sum, not Σ|amount|. A creditnota slot carries a NEGATIVE total and REDUCES
  // what the supplier debits: invoice €300 + creditnota −€20 against a −€280 debit is the real
  // tie. The old magnitude sum showed "ties" for that batch against a −€320 debit (300+|−20|=320)
  // — a green light on a €40 over-charge. All-positive batches are unchanged (net == Σ|…|). The
  // magnitude of the net is compared, so credit(+) and debit(−) batches both reconcile.
  const total = Math.abs(known.reduce((sum, s) => sum + (s.amount as number), 0));
  const anyConfirmed = slots.some((s) => s.isConfirmed);

  let status: BatchStatus;
  if (!allMatched) status = "incomplete";
  else if (centsEqual(total, bankAbs)) status = "ties";
  else status = "mismatch";

  return {
    slotCount: slots.length,
    matchedCount,
    total,
    bankAmount: bankAbs,
    diff: total - bankAbs,
    allMatched,
    anyConfirmed,
    status,
  };
}

// ─── AUTOMATIC batch booking ──────────────────────────────────────────────────────────────
// The manual UI has always understood multi-invoice batches (reconcileBatch above); the
// AUTOMATIC path (runBankAutoConfirm) historically did not — it only booked 1:1 matches, so a
// wholesale shop whose supplier payments are ALL batched saw nothing auto-reconcile. This is the
// root fix: the same tested tie-logic, exposed as a PURE plan the auto-confirm path can act on.
//
// A batch is auto-bookable ONLY when it is provably unambiguous — the exact same bar as a green
// "ties" in the UI, plus the guards that make blind booking safe:
//   • ≥ 2 resolved invoice numbers in the reference (a real batch, not a 1:1 or a PSP hash),
//   • EVERY referenced number resolves to EXACTLY ONE unpaid invoice of the correct direction
//     (a debit pays purchases, a credit pays sales) — zero matches OR an ambiguous number aborts,
//   • no invoice used for two references, and all invoices from ONE supplier (block a coincidental
//     cross-vendor sum-tie),
//   • the matched gross totals sum to the bank amount TO THE CENT (reconcileBatch "ties").
// Anything short → null → the batch stays for the human (mismatch like a €2.000 short-payment, or
// incomplete like a not-yet-imported invoice). Pure: the caller does the guarded DB writes.

export interface BatchCandidateInvoice {
  id: string;
  invoice_number: string | null;
  total_inc_btw: number | null;
  /** [PARTIAL-PAY] Already settled by earlier instalments. Absent/0 = fully open. The batch
   *  ties on what is STILL OPEN, so a bundle whose customer was asked for the open sum
   *  reconciles against exactly what the bank shows. */
  amount_paid?: number | null;
  client_name: string | null;
  direction: "incoming" | "outgoing" | null;
  /** [BUNDEL-DREMPEL] Excluded here exactly as on the 1:1 door: paid, draft, archived, processing. */
  status: string | null;
  /** [BUNDEL-DREMPEL] B.4 — an invoice the accountant has locked is not payable by a bank line
   *  either. Optional so a caller that does not select the column simply does not assert it. */
  accountant_status?: string | null;
}

export interface BatchAutoPlan {
  /** The tie set — every one must be booked paid together, or none (the caller keeps it atomic-ish). */
  invoiceIds: string[];
}

export function planBatchAutoConfirm(args: {
  reference: string | null;
  /** [BUNDEL-REF-RECOVER] The raw statement line. Without it a bundle whose invoice numbers
   *  carry a prefix or a separator can never be recognised — see resolveBatchNumbers. */
  description?: string | null;
  bankAmount: number | null; // signed: debit negative, credit positive
  invoices: BatchCandidateInvoice[];
}): BatchAutoPlan | null {
  const { reference, description, bankAmount, invoices } = args;
  if (bankAmount == null || !Number.isFinite(bankAmount) || bankAmount === 0) return null;

  // A debit (money out) settles INCOMING (purchase) invoices; a credit settles OUTGOING (sales).
  const wantDirection: "incoming" | "outgoing" = bankAmount < 0 ? "incoming" : "outgoing";

  // Index unpaid, correctly-directed invoices by normalized number. A number that maps to MORE
  // THAN ONE invoice is ambiguous → the whole batch is unsafe to auto-book.
  const byNum = new Map<string, BatchCandidateInvoice[]>();
  for (const inv of invoices) {
    // [BUNDEL-DREMPEL] Not merely "not paid" — the same never-payable set the 1:1 door refuses.
    // A bundle carries stronger evidence than a lone line about WHICH invoices a payment names; it
    // carries none at all about whether those invoices may be paid at all.
    if (!isPayableInvoiceState(inv)) continue;
    if ((inv.direction ?? "") !== wantDirection) continue;
    const key = normalizeRef(inv.invoice_number ?? "");
    if (key.length === 0) continue;
    const arr = byNum.get(key) ?? [];
    arr.push(inv);
    byNum.set(key, arr);
  }

  // Which of those numbers does this payment actually print? (One representative per number —
  // they normalize equal, and an ambiguous number is rejected right below.)
  //
  // [BANK-BATCH-SHORT-NUMBER] What may be booked unattended depends on HOW the number was
  // recognised, not only on its length:
  //   · found by the free-text SCAN → the 4-character identity floor stands. "045" appearing
  //     somewhere in a statement line is a plausible order number, postcode fragment or item
  //     count, and no sum-tie makes acting on that safe without a human.
  //   · found as a REFERENCE fragment → the extractor already carved that token out of the
  //     remittance as a payment reference, and it is compared WHOLE to a whole invoice number.
  //     That is identity, not a substring search. A supplier who numbers "045, 046" is ordinary
  //     — their numbers are theirs, not ours — and refusing those meant the incoming bundles
  //     this app generates could never auto-reconcile for them.
  // Three characters remains the floor even there: "1, 2" as a reference is not identity, it is
  // a coincidence waiting to happen. Everything else that makes a batch bookable still has to
  // hold — ≥2 numbers, each resolving to exactly ONE unpaid invoice of the right direction, one
  // supplier, every reference token accounted for, and the open amounts summing to the payment
  // TO THE CENT. Those together are what make a short number safe here and nowhere else.
  const printed = resolveBatchNumbersDetailed(
    { reference, description },
    [...byNum.values()].map((group) => group[0].invoice_number),
  )
    .filter((r) => {
      const len = normalizeRef(r.number).length;
      return r.via === "reference" ? len >= 3 : len >= 4;
    })
    .map((r) => r.number);
  if (printed.length < 2) return null; // 1:1 is handled by the single-invoice safe pass

  const picked: BatchCandidateInvoice[] = [];
  const usedIds = new Set<string>();
  for (const number of printed) {
    const cands = byNum.get(normalizeRef(number));
    if (!cands || cands.length !== 1) return null; // ambiguous number → not auto-safe
    const inv = cands[0];
    if (inv.total_inc_btw == null || !Number.isFinite(inv.total_inc_btw)) return null;
    // [CREDIT-VERREKEN] A credit note MAY be part of an automatic batch now, and the reason it
    // could not is worth stating: this guard read "reconcileBatch sums by MAGNITUDE, so a credit
    // could satisfy a tie for the wrong amount". That was true when it was written and stopped
    // being true when [BATCH-SIGN] made reconcileBatch a NET sum — the arithmetic it protected
    // against no longer exists, and the guard went on refusing the one shape this trade uses:
    // an invoice paid short by a credit the supplier sent, both numbers on the transfer.
    //
    // Measured on the reported payment: invoice 26709711 € 1.764,76, creditnota 2671141810155
    // € 52,38, one debit of € 1.712,38. reconcileBatch already answered "ties"; this line alone
    // held the automatic booking back, so the owner reconciled it by hand every time.
    //
    // What replaces it is below the loop — at least one real invoice, and a net that runs the way
    // the money did. A batch of nothing but credit notes is not a payment.
    //
    // [PARTIAL-PAY] Nothing left to settle → this invoice cannot be part of what the bank paid.
    // Booking it would settle it for €0 and let the rest of the batch tie on a short amount.
    // Zero, not "≤ 0": a credit note's open balance is legitimately negative.
    const open = settleableAmount(inv.total_inc_btw, inv.amount_paid);
    if (open == null || open === 0) return null;
    if (usedIds.has(inv.id)) return null; // the same invoice can't satisfy two references
    usedIds.add(inv.id);
    picked.push(inv);
  }

  // [BANK-BATCH-UNRESOLVED] Every number-shaped token the extractor found must be accounted for.
  // A token that is neither one of the picked numbers nor a FRAGMENT of one (the extractor cuts
  // "2026-045" down to "045", so "045" ⊂ "2026045" is that same invoice) is a number this payment
  // references and we could not resolve — a not-yet-imported invoice, or a customer number that
  // makes the reference untrustworthy. Either way it is not provably-exact, so it stays for the
  // human. This is the guard the old number-driven loop got for free; keeping it means the wider
  // recognition above can only ever ADD batches that reconcile, never loosen the bar.
  const pickedKeys = picked.map((p) => normalizeRef(p.invoice_number ?? ""));
  const unresolved = parseReferenceNumbers(reference).filter(
    (token) => !pickedKeys.some((key) => key === token || key.includes(token)),
  );
  if (unresolved.length > 0) return null;

  // One batch = one supplier. Reject a coincidental cross-supplier sum-tie (blank names are
  // "unknown" and don't by themselves veto — the exact number+sum tie already carries it).
  const suppliers = new Set(picked.map((p) => normalizeRef(p.client_name ?? "")));
  suppliers.delete("");
  if (suppliers.size > 1) return null;

  // Tie on what is still OPEN per invoice — that is the money the bank line actually moved.
  const slots: BatchSlotInput[] = picked.map((p) => ({
    refNum: normalizeRef(p.invoice_number ?? ""),
    amount: settleableAmount(p.total_inc_btw, p.amount_paid),
    isConfirmed: false,
  }));

  // [CREDIT-VERREKEN] The guard that takes the place of "no credit notes here".
  //
  // The net must be something OWED. reconcileBatch compares MAGNITUDES, so a net of −€ 280 — the
  // credits outweighing the invoices — ties just as neatly against a −€ 280 debit, and booking
  // that would settle invoices out of a payment whose own arithmetic says the money should have
  // run the other way. Positive in both directions: settleableAmount is positive for a bill and
  // negative for a credit note whether the document is a purchase or a sale.
  //
  // It also covers "a batch of nothing but credit notes", which was written here as a second rule
  // until a negative control showed it could never fire on its own: every member negative means
  // the net is negative, so this line has already refused. One rule that can fire beats two where
  // one is decoration — a guard that cannot fail reads as protection and is none.
  const net = slots.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  if (net <= 0) return null;

  if (reconcileBatch(slots, bankAmount).status !== "ties") return null;

  return { invoiceIds: picked.map((p) => p.id) };
}

// ─── [BANK-SUM-SUGGEST] Same-supplier sum WITHOUT quoted numbers — a suggestion, never a booking ──
//
// The realistic gap this closes: a customer (or the owner, paying a supplier) transfers the sum
// of two or three open invoices in ONE payment and writes nothing usable in the description.
// No reference → resolveBatchNumbers finds nothing; no single invoice equals the amount → the
// matcher scores every pair below the floor. Outcome 'none': a payment that is EXACTLY the sum
// of open invoices from EXACTLY that counterparty renders as "Geen factuur", and the owner
// reconstructs the arithmetic by hand.
//
// Why this is a SUGGESTION and can never auto-book: a sum-tie without a printed number is
// arithmetic coincidence made likelier by combinatorics — with enough open invoices, SOME subset
// sums to almost anything. Every guard here narrows that space, and the human still confirms
// each invoice through the normal guarded path:
//   · the counterparty must IDENTIFY: strong name identity or the invoice's own IBAN — a bare
//     amount coincidence across suppliers never enters the pool;
//   · only balances that still move money (a creditnota carries its own NEGATIVE sign and
//     REDUCES the sum — see [CREDIT-VERREKEN] in the pool below; a settled invoice is out);
//   · subsets of 2..4 invoices, pool capped at 12 — beyond that the tie proves nothing;
//   · the tie must be UNIQUE: two different subsets summing to the same payment → no suggestion
//     (which one would it be?);
//   · cents-exact, in integer cents (no float lottery).

export interface SupplierSumCandidate extends BatchCandidateInvoice {
  /** The invoice's own counterpart account, for IBAN-based supplier identity. */
  vendor_iban?: string | null;
}

export interface SupplierSumMatch {
  invoiceIds: string[];
  invoiceNumbers: (string | null)[];
  /** Σ open balances of the members = the payment, absolute euros. */
  total: number;
  /**
   * [CREDIT-VERREKEN] The signed open balance of each member, in the order of invoiceNumbers — a
   * creditnota is negative.
   *
   * Carried because the card prints the arithmetic: "A + B = € 1.100" is honest for two invoices
   * and a lie the moment one of them is a credit note, where the same screen would show
   * "1.764,76 + 52,38 = 1.712,38". A screen that does not add up in front of the owner is the
   * defect this whole file keeps closing; the sign has to travel with the numbers.
   */
  amounts: number[];
}

const SUM_POOL_MAX = 12;
const SUM_SUBSET_MAX = 4;

export function findSupplierSumMatch(args: {
  /** Signed bank amount (credit +, debit −). */
  amount: number | null | undefined;
  counterpartName: string | null;
  counterpartIban?: string | null;
  invoices: SupplierSumCandidate[];
}): SupplierSumMatch | null {
  const { amount, counterpartName, counterpartIban, invoices } = args;
  if (amount == null || !Number.isFinite(amount) || amount === 0) return null;
  const targetCents = Math.round(Math.abs(amount) * 100);
  if (targetCents <= 0) return null;

  const wantDirection: "incoming" | "outgoing" = amount < 0 ? "incoming" : "outgoing";

  // The identified, usable pool. Identity is per-invoice: a strong NAME identity with the
  // payment's counterpart, or the invoice's own vendor IBAN equal to the payment's.
  //
  // [CREDIT-VERREKEN] Credit notes belong in this pool, with their SIGN. The header above used to
  // say "a creditnota in the mix makes the arithmetic ambiguous by sign" and kept them out with
  // `openCents > 0` — but the ambiguity was in the old positive-only walk, not in the money. A
  // wholesaler's credit is settled by deducting it from the next payment (bundel-betaling.ts), so
  // the everyday shape of a supplier debit is invoice − credit, and refusing to see it left the
  // one line the owner could not reconcile at all: "Geen factuur", nothing offered.
  const pool = invoices
    // [BUNDEL-DREMPEL] Same rule as planBatchAutoConfirm above and as the 1:1 door: a draft was
    // never issued, an archived invoice is closed, and a 'processing' row is still an unverified
    // reading. Suggesting one is not a small cosmetic error — the owner taps Bevestig on it.
    .filter(isPayableInvoiceState)
    .filter((i) => (i.direction ?? "") === wantDirection)
    .filter(
      (i) =>
        isStrongNameIdentity(counterpartName, i.client_name) ||
        ibanMatches(counterpartIban, i.vendor_iban),
    )
    .map((i) => ({ inv: i, openCents: Math.round((settleableAmount(i.total_inc_btw, i.amount_paid) ?? 0) * 100) }))
    .filter((x) => x.openCents !== 0);

  if (pool.length < 2 || pool.length > SUM_POOL_MAX) return null;

  // Exhaustive subset walk, sizes 2..SUM_SUBSET_MAX, integer cents. The pool cap bounds this to
  // C(12,2)+C(12,3)+C(12,4) ≈ 1.081 combinaties — trivial. Collect up to TWO ties: one is a
  // suggestion, two is an ambiguity (→ null), more is irrelevant.
  //
  // [CREDIT-VERREKEN] No arithmetic pruning any more. `sum >= targetCents` was a valid cut only
  // while every member was positive; with a credit in the pool a running sum may legitimately
  // overshoot and come back down, and pruning there would silently MISS the netted answer — the
  // worst kind of failure here, because it looks exactly like "no match". The cap on subset size
  // and pool size is what bounds the search, and it always was: the walk visits at most
  // C(12,2)+C(12,3)+C(12,4) sets either way.
  const ties: number[][] = [];
  const idxs = pool.map((_, i) => i);
  const walk = (start: number, chosen: number[], sum: number): void => {
    if (ties.length >= 2) return;
    if (chosen.length >= 2 && sum === targetCents) {
      ties.push([...chosen]);
      // Deliberately NOT returning: with a credit in the pool a superset can tie as well (add an
      // invoice and a credit that cancel), and that is a genuine ambiguity this must SEE rather
      // than hide. Two ties → no suggestion.
    }
    if (chosen.length >= SUM_SUBSET_MAX) return;
    for (let i = start; i < idxs.length; i++) {
      chosen.push(i);
      walk(i + 1, chosen, sum + pool[i].openCents);
      chosen.pop();
    }
  };
  walk(0, [], 0);

  if (ties.length !== 1) return null; // nothing, or ambiguous — either way: no suggestion
  const members = ties[0].map((i) => pool[i]);
  // [CREDIT-VERREKEN] No sign guard here, and that is a statement rather than an omission: the
  // walk compares the running sum to targetCents, which is |amount| — a POSITIVE number. A set of
  // nothing but credit notes sums negative and can never equal it, and neither can any set that
  // owes money the other way. The tie is sign-safe by construction.
  //
  // The automatic batch path above does need such a guard, because reconcileBatch compares
  // MAGNITUDES (|net| against |bank|) and a net of −€ 280 ties a −€ 280 debit there. Two ways of
  // asking the same question, and only one of them is one-sided; both are written down so the
  // next reader does not copy the wrong half.
  return {
    invoiceIds: members.map((m) => m.inv.id),
    invoiceNumbers: members.map((m) => m.inv.invoice_number),
    total: members.reduce((t, m) => t + m.openCents, 0) / 100,
    amounts: members.map((m) => m.openCents / 100),
  };
}

// ── [DECLARED-INVOICE] Numbers the payment CALLS invoices, whether or not we hold them ────────
//
// resolveBatchNumbers above answers "which of the invoices we KNOW does this payment reference?"
// — it matches the payment text against numbers already in the administration, so a number for an
// invoice that has not been imported yet is, by construction, invisible to it.
//
// That blind spot booked money wrongly. A real ATAPACK payment of €2.265,41 carried the description
// "Tweede deel factuur 26302050 , factuur 26302362". Only the first invoice was in the books, so
// exactly one number resolved, the multi-invoice slot view never appeared (it needs two), and the
// card offered to book the WHOLE payment as a deelbetaling on invoice 26302050 — which had room for
// it, being €4.662,80 open. The second invoice would then arrive with its money already spent: it
// stays fully open, it is dunned, and the owner can pay it a second time.
//
// The card even contradicted itself while doing so: its "2 facturen" badge counts resolved numbers
// PLUS unresolved leftovers, and it sat directly above a single-invoice chooser that only renders
// when the payment is NOT considered multi-invoice.
//
// So this reads the other side of the evidence: not "do we have it?" but "does the payment SAY it
// is an invoice?". The word in front of the number is what makes that a fact rather than a guess.
//
// ── CONSERVATIVE ON PURPOSE ──
// A false negative costs nothing — the app behaves exactly as it does today. A false positive holds
// up a legitimate booking. So this only recognises a number that a keyword introduces, and applies
// the same 4-character floor referenceMatches uses. A bare number floating in a description is NOT
// claimed: that is precisely the customer number / PSP hash / postcode that earlier work here went
// to some trouble to stop trusting.

/** Words a Dutch (or English) payment description uses to introduce an invoice number. */
const INVOICE_WORD = /\b(?:factuur|facturen|factuurnr|factuurnummer|fact|inv|invoice|invoices|nota|nota's)\b\.?\s*(?:nr\.?|nummer|no\.?|#)?\s*/giu;

/**
 * Every number this payment text explicitly calls an invoice, in the order printed.
 *
 * Handles the plural list ("facturen 26302050, 26302362"), because one keyword can introduce
 * several numbers and stopping at the first would silently drop the rest — the same class of miss
 * this whole function exists to close.
 */
export function declaredInvoiceNumbers(tx: BatchPaymentText): string[] {
  const text = `${tx.reference ?? ""} ${tx.description ?? ""}`;
  const out: string[] = [];
  const seen = new Set<string>();

  INVOICE_WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INVOICE_WORD.exec(text)) !== null) {
    // Walk the run of number-ish tokens that follows the keyword, across the separators a human
    // uses in a list: comma, "en", "&", "+", "/", or plain whitespace.
    let rest = text.slice(m.index + m[0].length);
    for (;;) {
      const token = /^([A-Za-z]{0,4}[0-9][0-9A-Za-z._/-]*)/u.exec(rest);
      if (!token) break;
      const printed = token[1].replace(/[.,;:]+$/u, "");
      const key = normalizeRef(printed);
      // Same floor as referenceMatches: shorter than four characters is not identity.
      if (key.length >= 4 && !seen.has(key)) {
        seen.add(key);
        out.push(printed);
      }
      rest = rest.slice(token[1].length);
      const sep = /^(?:\s*(?:,|&|\+|\/|\ben\b)\s*|\s+)/u.exec(rest);
      // No separator, or the keyword appears again → this list has ended.
      if (!sep || key.length < 4) break;
      rest = rest.slice(sep[0].length);
      if (/^(?:factuur|facturen|fact|inv|invoice|nota)/iu.test(rest)) break;
    }
  }
  return out;
}

/**
 * The numbers this payment calls invoices that we do NOT hold.
 *
 * This is the set that must stop a booking from quietly consuming the whole bank line: the money
 * for these invoices has already left the account, and spending it on the invoice we happen to
 * have is how the other one ends up paid twice.
 */
export function undeclaredMissingInvoices(
  tx: BatchPaymentText,
  knownInvoiceNumbers: Array<string | null | undefined>,
): string[] {
  const held = new Set(
    knownInvoiceNumbers.map((n) => normalizeRef(n ?? "")).filter((k) => k.length > 0),
  );
  return declaredInvoiceNumbers(tx).filter((n) => {
    const key = normalizeRef(n);
    // Held either exactly, or as the number a fragment was carved out of ("045" ⊂ "2026045") —
    // the same containment rule the slot view uses, so the two cannot disagree about what is held.
    return !held.has(key) && ![...held].some((h) => h.includes(key) || key.includes(h));
  });
}
