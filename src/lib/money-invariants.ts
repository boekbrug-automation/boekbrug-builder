// src/lib/money-invariants.ts
// [GELD-INVARIANT] The arithmetic that must hold in the books, whatever else happened. Pure.
// Run: npx tsx --test src/lib/money-invariants.test.ts
//
// ── WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER GATE ──
//
// Every money gate in this app guards a MOMENT: is this read right, does this payment fit, may this
// invoice auto-book. They are all about the euro that is arriving. None of them ever looks back at
// the euros that already landed.
//
// So the question nobody in this codebase can answer is the one an accountant asks first: do the
// books still add up? Not "was each write correct when it happened" — every write believed it was —
// but is the RESULT internally consistent right now. Those are different questions, and only the
// second survives a concurrent booking, a half-applied batch, a migration applied out of order, or
// a bug that has since been fixed but left its numbers behind.
//
// books-audit.ts already re-checks a stored amount against the DOCUMENT it came from. This is the
// other axis: the money tables against EACH OTHER. A figure can be perfectly grounded in its
// invoice and still be impossible next to its payments.
//
// ── IT REPORTS EUROS, NOT ROWS ──
//
// "3 invoices inconsistent" tells nobody anything. "€4.212 booked as paid that no payment covers"
// tells you whether to stop what you are doing. Every finding carries the amount at stake, because
// that is the number that decides whether it waits until Monday.
//
// ── AND IT NEVER FIXES ANYTHING ──
//
// Same rule as books-audit.ts, and for a sharper reason: a violation means two sources disagree,
// and an automatic repair has to pick one. Picking wrong writes a false number over a true one and
// destroys the evidence that they ever differed. On a quarter that is already filed that is not a
// bug, it is a correction nobody can trace. This states what it found. Deciding is human work.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); `message` is Dutch because
// the owner and their accountant read it.

import { round2 } from "./invoice-totals";
// [DUBBEL-GEBOEKT] One spelling rule for invoice numbers, shared with the import dedup —
// "26 / 3958" and "26/3958" are the same number, and that equality is exactly what this file
// needs to re-check after the fact.
import { normalizeInvoiceNumber } from "./safecore";

/** One cent. Below this, two money figures are the same number. */
export const MONEY_EPSILON = 0.005;

export interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  direction: "incoming" | "outgoing" | string | null;
  status: string | null;
  invoiceType?: string | null;
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
  amountPaid: number | null;
  /**
   * Supplier name, for the duplicate-pair check only. Optional: without it that check simply
   * does not run — two suppliers may legitimately hand the same owner the same invoice number
   * (every January is full of "2026-001"), so a pair without a same-supplier witness is not
   * judgeable, and a check that cannot run must not report.
   */
  clientName?: string | null;
}

export interface LinkRow {
  transactionId: string;
  invoiceId: string;
  /** NULL = a link from before the column existed, which settled its invoice in full. */
  amountApplied: number | null;
}

export interface TransactionRow {
  id: string;
  amount: number | null;
  /**
   * The direct link the Bank page renders its "afgehandeld" state from. Optional on purpose:
   * a caller that does not read these columns simply does not get the matched-line check —
   * a check that cannot run must not report a result (same rule as the unknown-invoice skip).
   */
  invoiceId?: string | null;
  status?: string | null;
}

export type ViolationKind =
  | "paid_without_payments"
  | "payments_without_paid"
  | "paid_amount_never_written"
  | "overpaid"
  | "negative_paid"
  | "status_paid_but_open"
  | "status_open_but_covered"
  | "btw_arithmetic"
  | "creditnota_sign"
  | "transaction_overallocated"
  | "matched_tx_unpaid_invoice"
  | "duplicate_live_pair";

export interface Violation {
  kind: ViolationKind;
  /** invoice id, or transaction id for transaction_overallocated. */
  entityId: string;
  /** What is at stake, in euros. This is the number that decides urgency. */
  euros: number;
  /** Dutch, owner-facing, and it names the two figures that disagree. */
  message: string;
  /**
   * [KANTOOR-RUST] The same finding for the boekhouder reading a CLIENT's books: every figure of
   * `message`, no "je"/"jouw", no route or button that exists only on the owner's screens, and
   * no consequence-for-the-owner sentence. Built beside `message` from the same numbers, so the
   * two can never disagree about a figure — see findingText().
   */
  accountantMessage: string;
}

/** Who is reading a finding: the owner about their own books, or the accountant about a client's. */
export type FindingAudience = "owner" | "accountant";

/**
 * The one place a finding's sentence is chosen by audience. A screen that picks `message` for the
 * accountant by hand is the wrong-role text this exists to end; a screen that edits the string is
 * the fragile string surgery a financial warning must never go through.
 */
export function findingText(f: { message: string; accountantMessage: string }, audience: FindingAudience): string {
  return audience === "accountant" ? f.accountantMessage : f.message;
}

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const eur = (n: number) =>
  `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function isCreditnota(inv: InvoiceRow): boolean {
  return (inv.invoiceType ?? "factuur") === "creditnota";
}

/**
 * A status that means "this invoice is settled". Only 'paid' does, and that is checked against the
 * live CHECK constraint rather than guessed: draft, sent, paid, overdue, received, processing,
 * processed, unclear, archived. There is no 'partial' — a partly-paid invoice keeps its status and
 * only amount_paid moves, which is exactly why the amount is the thing worth checking.
 */
function claimsPaid(inv: InvoiceRow): boolean {
  return inv.status === "paid";
}

/**
 * Check the books against themselves.
 *
 * `links` may be partial — pass only the links belonging to the invoices given, or all of them.
 * Anything not passed is simply not checked, and a check that did not run is never reported as one
 * that passed: findings are only ever produced from data actually present.
 */
export function findMoneyViolations(input: {
  invoices: readonly InvoiceRow[];
  links: readonly LinkRow[];
  transactions?: readonly TransactionRow[];
}): Violation[] {
  const out: Violation[] = [];
  const invoices = input.invoices ?? [];
  const links = input.links ?? [];

  // Σ per invoice. A NULL amountApplied means "settled this invoice in full", so its contribution
  // is the invoice's own total — reading it as 0 would report every pre-migration payment as money
  // that never arrived, which is a false alarm on the oldest and least verifiable rows there are.
  const byInvoice = new Map<string, { sum: number; hadNull: boolean }>();
  for (const l of links) {
    const cur = byInvoice.get(l.invoiceId) ?? { sum: 0, hadNull: false };
    if (l.amountApplied == null) cur.hadNull = true;
    else cur.sum += Math.abs(num(l.amountApplied));
    byInvoice.set(l.invoiceId, cur);
  }

  for (const inv of invoices) {
    const total = Math.abs(num(inv.totalIncBtw));
    const paid = num(inv.amountPaid);
    const linkInfo = byInvoice.get(inv.id);
    // [BEDRAG-NOOIT-GESCHREVEN] Set below. It suppresses exactly one FURTHER finding — the
    // status/amount one — because that is the same single cause said a second way, and two lines
    // for one unwritten column is how a panel starts looking worse than the books are. It
    // deliberately suppresses nothing else: the invoice's own arithmetic and its creditnota sign
    // have nothing to do with which payment column was written, and must still be checked here.
    let amountNeverWritten = false;

    // ── The money that is claimed paid, against the payments that exist ──
    if (paid < -MONEY_EPSILON) {
      out.push({
        kind: "negative_paid",
        entityId: inv.id,
        euros: Math.abs(paid),
        message: `Op ${inv.invoiceNumber ?? "een factuur"} staat een NEGATIEF betaald bedrag (${eur(paid)}). Dat kan niet.`,
        accountantMessage: `${inv.invoiceNumber ?? "Een factuur"}: het betaalde bedrag is NEGATIEF (${eur(paid)}).`,
      });
    }

    if (paid > total + MONEY_EPSILON) {
      out.push({
        kind: "overpaid",
        entityId: inv.id,
        euros: round2(paid - total),
        message:
          `Op ${inv.invoiceNumber ?? "een factuur"} van ${eur(total)} staat ${eur(paid)} als betaald — ` +
          `${eur(paid - total)} te veel. Meestal hoort dat geld bij een andere factuur.`,
        accountantMessage:
          `${inv.invoiceNumber ?? "Een factuur"} van ${eur(total)}: ${eur(paid)} als betaald — ${eur(paid - total)} te veel.`,
      });
    }

    // Only meaningful when this invoice HAS links in the data we were given. An invoice paid by
    // hand (pay-toggle, no bank line) legitimately has money paid and no links at all.
    if (linkInfo && !linkInfo.hadNull) {
      const gap = round2(paid - linkInfo.sum);

      // [BEDRAG-NOOIT-GESCHREVEN] One shape of that gap is not two sources disagreeing, and
      // reporting it as if it were costs more than it explains.
      //
      // The invoice says 'paid'. Its bank links cover the total EXACTLY. And amount_paid is zero.
      // All three of those agree that the money arrived in full; the only thing that happened is
      // that one column was never written. runBankAutoConfirm's pay write set status,
      // payment_method, marked_paid_at and payment_date and skipped amount_paid, while the link it
      // wrote on the next line recorded the whole sum. That cause is fixed — but the rows it left
      // behind do not heal themselves, because amount_paid is only ever re-derived per invoice, on
      // a pay-toggle, an unlink or a statement delete. Nothing sweeps.
      //
      // Why it earns its own kind rather than a footnote: this file's finding goes on
      // /dashboard/klaar, the screen where an owner decides whether to hand the quarter to their
      // accountant. Fourteen invoices and EUR 5.321,68 of "verschil" there, every euro of it
      // correctly received, is precisely the false alarm that teaches someone to stop reading the
      // panel — including on the day it means something. It is still reported, because a column
      // that disagrees with the books IS wrong and silence would be worse. It is reported for what
      // it is.
      //
      // Nothing is repaired here. That rule stands and scripts/money-audit.ts argues it in full.
      // What this changes is the argument's premise, honestly and only for this group: there is no
      // side to pick, so the decision in front of the human is small rather than forensic.
      const fullyCovered = total > MONEY_EPSILON && Math.abs(linkInfo.sum - total) <= MONEY_EPSILON;
      amountNeverWritten = claimsPaid(inv) && Math.abs(paid) <= MONEY_EPSILON && fullyCovered;
      if (amountNeverWritten) {
        out.push({
          kind: "paid_amount_never_written",
          entityId: inv.id,
          euros: round2(total),
          message:
            `${inv.invoiceNumber ?? "Een factuur"} van ${eur(total)} is volledig betaald en de bankregels ` +
            `dekken hem precies — alleen het veld "betaald bedrag" is nooit weggeschreven. Er ontbreekt geen geld.`,
          accountantMessage:
            `${inv.invoiceNumber ?? "Een factuur"} van ${eur(total)}: de bankregels dekken het bedrag precies, ` +
            `alleen het veld "betaald bedrag" is nooit weggeschreven. Er ontbreekt geen geld.`,
        });
      } else if (Math.abs(gap) > MONEY_EPSILON) {
        out.push({
          kind: gap > 0 ? "paid_without_payments" : "payments_without_paid",
          entityId: inv.id,
          euros: Math.abs(gap),
          message:
            gap > 0
              ? `${inv.invoiceNumber ?? "Een factuur"}: er staat ${eur(paid)} als betaald, maar de gekoppelde bankregels dekken maar ${eur(linkInfo.sum)}. Verschil ${eur(gap)}.`
              : `${inv.invoiceNumber ?? "Een factuur"}: er is ${eur(linkInfo.sum)} aan bankregels gekoppeld, maar er staat maar ${eur(paid)} als betaald. Verschil ${eur(gap)}.`,
          accountantMessage:
            gap > 0
              ? `${inv.invoiceNumber ?? "Een factuur"}: ${eur(paid)} als betaald, gekoppelde bankregels dekken ${eur(linkInfo.sum)}. Verschil ${eur(gap)}.`
              : `${inv.invoiceNumber ?? "Een factuur"}: ${eur(linkInfo.sum)} aan bankregels gekoppeld, ${eur(paid)} als betaald. Verschil ${eur(gap)}.`,
        });
      }
    }

    // ── The status, against the amount ──
    // These two are the ones a person actually notices: a "betaald" invoice that still owes money,
    // and an "open" invoice that has been fully covered and keeps chasing a customer who paid.
    if (total > MONEY_EPSILON) {
      const covered = paid >= total - MONEY_EPSILON;
      if (claimsPaid(inv) && !covered && !amountNeverWritten) {
        out.push({
          kind: "status_paid_but_open",
          entityId: inv.id,
          euros: round2(total - paid),
          message: `${inv.invoiceNumber ?? "Een factuur"} staat op betaald, maar er is ${eur(total - paid)} van open.`,
          accountantMessage: `${inv.invoiceNumber ?? "Een factuur"}: status betaald, ${eur(total - paid)} nog open.`,
        });
      }
      if (!claimsPaid(inv) && covered && inv.status !== "archived" && inv.status !== "draft") {
        // The consequence differs by direction, so the sentence does too. A sales invoice that is
        // paid but still open keeps chasing a customer who already paid — a relationship cost, and
        // the owner's most visible embarrassment. A purchase invoice that is paid but still open
        // makes the owner think he still owes money he already sent, and he may send it twice.
        // One sentence for both would have to be vague about the only part that matters.
        const outgoing = inv.direction === "outgoing";
        out.push({
          kind: "status_open_but_covered",
          entityId: inv.id,
          euros: total,
          message:
            `${inv.invoiceNumber ?? "Een factuur"} van ${eur(total)} is helemaal betaald, maar staat nog open. ` +
            (outgoing
              ? `Zo blijft er een herinnering gaan naar iemand die al betaald heeft.`
              : `Zo lijkt het alsof je dit nog moet betalen — het risico is dat je het twee keer doet.`),
          accountantMessage:
            `${inv.invoiceNumber ?? "Een factuur"} van ${eur(total)} (${outgoing ? "verkoop" : "inkoop"}): ` +
            `volledig betaald, status nog open.`,
        });
      }
    }

    // ── The invoice's own arithmetic ──
    // ex + btw must be inc. The import gate checks this on the way in; this checks it on what is
    // actually stored, which is what the aangifte reads. Skipped when a figure is missing: absent
    // is not wrong, and inventing a violation from a gap is how an audit stops being believed.
    if (inv.totalExBtw != null && inv.btwAmount != null && inv.totalIncBtw != null) {
      const gap = round2(num(inv.totalExBtw) + num(inv.btwAmount) - num(inv.totalIncBtw));
      // [SPLIT-ONBEKEND] Beide op nul naast een totaal dat er wél is, is GEEN rekenfout. Het is
      // dezelfde toestand als NULL — "we hebben alleen het totaal gelezen" — en de regel hierboven
      // zegt zelf dat afwezig niet fout is, "want een schending verzinnen uit een gat is hoe een
      // audit ophoudt geloofd te worden".
      //
      // Dat gebeurde ook. Gemeten in de productiedatabase: drie facturen stonden zo (nog in
      // verwerking, de lezer was er nog niet aan toe), en de audit meldde ze met de zin "Dit getal
      // staat in je aangifte" — over een splitsing die nog helemaal niet is gelezen. Eén enkele
      // echte rekenbreuk stond ertussen, en die verdient het om niet in drie valse te verdwijnen.
      //
      // Op een factuur die WEL meetelt is een ontbrekende splitsing overigens een echt probleem
      // (de voorbelasting leest dan stil nul) — maar dat is een ander feit met een andere zin, en
      // niet iets om onder "de optelling klopt niet" te verstoppen.
      const splitNeverRead =
        Math.abs(num(inv.totalExBtw)) <= MONEY_EPSILON &&
        Math.abs(num(inv.btwAmount)) <= MONEY_EPSILON &&
        Math.abs(num(inv.totalIncBtw)) > MONEY_EPSILON;
      if (Math.abs(gap) > 0.01 && !splitNeverRead) {
        out.push({
          kind: "btw_arithmetic",
          entityId: inv.id,
          euros: Math.abs(gap),
          message:
            `${inv.invoiceNumber ?? "Een factuur"}: ${eur(num(inv.totalExBtw))} + ${eur(num(inv.btwAmount))} btw ` +
            `is niet ${eur(num(inv.totalIncBtw))} — ${eur(gap)} verschil. Dit getal staat in je aangifte.`,
          accountantMessage:
            `${inv.invoiceNumber ?? "Een factuur"}: ${eur(num(inv.totalExBtw))} + ${eur(num(inv.btwAmount))} btw ` +
            `is niet ${eur(num(inv.totalIncBtw))} — ${eur(gap)} verschil; dit telt zo in de aangifte.`,
        });
      }
    }

    // ── A creditnota points the other way, and must say so ──
    // The sign is what tells every downstream sum whether this is money owed or money coming back.
    // A creditnota stored positive is added where it should be subtracted — twice wrong, in the
    // same direction, in every total it appears in.
    if (isCreditnota(inv) && num(inv.totalIncBtw) > MONEY_EPSILON) {
      out.push({
        kind: "creditnota_sign",
        entityId: inv.id,
        euros: Math.abs(num(inv.totalIncBtw)) * 2,
        message:
          `${inv.invoiceNumber ?? "Een creditnota"} staat als creditnota geboekt met een POSITIEF bedrag ` +
          `(${eur(num(inv.totalIncBtw))}). Die telt nu op waar hij eraf hoort — een verschil van ${eur(Math.abs(num(inv.totalIncBtw)) * 2)}.`,
        accountantMessage:
          `${inv.invoiceNumber ?? "Een creditnota"}: creditnota met een POSITIEF bedrag (${eur(num(inv.totalIncBtw))}); ` +
          `telt op in plaats van af — verschil ${eur(Math.abs(num(inv.totalIncBtw)) * 2)}.`,
      });
    }
  }

  // ── [DUBBEL-GEBOEKT] The same bill must not live twice ──
  //
  // The FAMZFOOD case, read straight from the audit trail: the reader spelled one invoice number
  // two ways ("26/3958" and "26 / 3958"), both rows reached the live books through a since-closed
  // dedup gap, the bank matcher paid ONE of them — correctly — and the twin stayed behind as an
  // "open, X days overdue" card the owner could not explain. Worse: invoice 26/1876 ended up PAID
  // twice, once by the matcher and once by hand. Every copy counts its total into kosten and its
  // btw into voorbelasting a second time — numbers that walk straight into the aangifte.
  //
  // The import door normalizes numbers today, so new twins are blocked ON THE WAY IN. This is the
  // other half: the pairs that already exist, re-checked after the fact — the whole reason this
  // file exists. Judged only for incoming, live (not archived/draft) rows of the SAME document
  // type — a creditnota legitimately carries its factuur's number — and only when the supplier
  // matches. The supplier compare is deliberately conservative (case/punctuation-insensitive
  // equality, so "FAMZFOOD BV" pairs with "FAMZFOOD B.V."): a same supplier spelled two truly
  // different ways stays unpaired, which is a missed finding — never a false alarm on two
  // suppliers who both numbered an invoice "2026-001".
  {
    const vendorKey = (name: string | null | undefined) =>
      String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const byDocKey = new Map<string, InvoiceRow[]>();
    for (const inv of invoices) {
      if (inv.direction !== "incoming") continue;
      if (inv.status === "archived" || inv.status === "draft") continue;
      const numKey = normalizeInvoiceNumber(inv.invoiceNumber);
      const ven = vendorKey(inv.clientName);
      if (!numKey || !ven) continue; // no number or no supplier witness → not judgeable
      const key = `${inv.invoiceType ?? "factuur"}|${ven}|${numKey}`;
      const group = byDocKey.get(key) ?? [];
      group.push(inv);
      byDocKey.set(key, group);
    }
    const statusWord = (s: string | null) =>
      s === "paid" ? "betaald" : s === "processing" ? "in de wachtrij" : "openstaand";
    for (const group of byDocKey.values()) {
      if (group.length < 2) continue;
      const totals = group.map((g) => Math.abs(num(g.totalIncBtw)));
      const hoogste = Math.max(...totals);
      const laagste = Math.min(...totals);
      // The biggest copy is the one that stays; everything beyond it is counted double.
      const extra = round2(totals.reduce((s, v) => s + v, 0) - hoogste);
      const counts = group.map((g) => statusWord(g.status));
      const wie =
        `${group[0].invoiceNumber ?? "Een factuur"} van ${group[0].clientName ?? "een leverancier"}`;

      // ── [KOPIE-ONEENS] Do the copies AGREE about the amount? ──
      //
      // Everything above this line treats a duplicate as one cost entered twice: keep the
      // original, ignore the copy, done. That advice is right exactly when the copies say the same
      // thing — and it is unsafe when they do not, because then one of the two READINGS is wrong
      // and there is no way to tell which by looking at the sizes.
      //
      // The old code resolved that silently: `extra = Σ − max` keeps the LARGEST as the survivor.
      // Measured live at the time of writing, on ten live duplicate groups: six agreed to the cent,
      // four did not, and the worst was ATAPACK 26302362 at € 579,63 against € 4.917,90 — a factor
      // 8,5, with one copy already booked as paid. "Keep the original" there can leave the books
      // carrying eight times the real cost, and the sentence would not have hinted at it.
      //
      // Material means BOTH a cent floor and a share of the invoice: € 12,46 on € 1.348 is a
      // line-level rounding difference between two reads of the same paper (that is Enka 26701681,
      // and it must stay quiet), while € 17,42 on € 239 is not. One threshold alone gets one of
      // those two wrong.
      const spreiding = round2(hoogste - laagste);
      const oneens = spreiding > Math.max(1, hoogste * 0.02);

      out.push({
        kind: "duplicate_live_pair",
        entityId: group[0].id,
        // Unchanged, and deliberately: whichever copy is right, the cost still appears more than
        // once, so Σ − max stays an honest LOWER bound on what is double-counted. What the
        // disagreement adds is that the surviving AMOUNT may also be wrong — a different problem,
        // which the sentence below states rather than folding into this number.
        euros: extra > MONEY_EPSILON ? extra : hoogste,
        message: oneens
          ? `${wie} staat ${group.length} keer in de administratie (${counts.join(" en ")}), en de ` +
            `versies zijn het ONEENS over het bedrag: ${eur(laagste)} tegenover ${eur(hoogste)}. ` +
            `Dat is geen dubbele boeking alleen — één van beide is verkeerd gelezen. Leg ze naast ` +
            `de papieren factuur voordat je er een weggooit: welke van de twee blijft staan bepaalt ` +
            `hier ook welk bedrag in je kosten en je voorbelasting terechtkomt.`
          : `${wie} staat ${group.length} keer in de administratie (${counts.join(" en ")}). ` +
            `Dezelfde kost telt zo dubbel mee in je kosten en je voorbelasting. Bewaar het origineel ` +
            `en zet de kopie bij Genegeerd; is de kopie al als betaald gemeld, draai die betaling ` +
            `daar eerst terug.`,
        // The same two facts, no instruction: which copies exist, and — when they disagree — the
        // two amounts. What to do with them is the owner's act on the owner's screens.
        accountantMessage: oneens
          ? `${wie} staat ${group.length} keer in de administratie (${counts.join(" en ")}); de versies ` +
            `verschillen in bedrag: ${eur(laagste)} tegenover ${eur(hoogste)}.`
          : `${wie} staat ${group.length} keer in de administratie (${counts.join(" en ")}); dezelfde kost ` +
            `telt dubbel in kosten en voorbelasting.`,
      });
    }
  }

  // ── A payment cannot give more than it moved ──
  // The database enforces this under a lock at booking time (allocate_bank_payment reads Σ of the
  // line's other links). This finds anything that predates that guard, or slipped past it.
  //
  // ── AND THE SIGN MATTERS HERE, WHERE IT DID NOT ABOVE ──
  //
  // amount_applied is stored as a MAGNITUDE, because per INVOICE that is what it means: this much
  // of it was settled, and a creditnota is settled by a positive amount just like anything else.
  // recompute_invoice_amount_paid and the unlink reversal both depend on that.
  //
  // Per TRANSACTION the question is different — how much of this payment went out — and there a
  // creditnota goes the other way. A supplier bills €1.000, credits €150, and debits €850; the
  // links hold 1.000 and 150, and summing their magnitudes gives 1.150 against a line of 850. That
  // reported a €300 over-allocation on a batch that was exactly right.
  //
  // A false alarm on correct books is not a smaller failure than a missed one. It is how the next
  // real finding gets ignored, and this audit's only value is that it is believed. So the sign is
  // re-derived here from the invoice the link points at.
  if (input.transactions) {
    const creditnotaIds = new Set(invoices.filter(isCreditnota).map((i) => i.id));
    const byTx = new Map<string, number>();
    const unknownInvoice = new Set<string>();
    for (const l of links) {
      if (l.amountApplied == null) continue;
      // A link to an invoice that was not passed in cannot be signed, and guessing "positive"
      // would recreate the same false alarm for anyone auditing a subset. Mark the transaction as
      // unsignable and skip it entirely — a check that cannot run must not report a result.
      const known = invoices.some((i) => i.id === l.invoiceId);
      if (!known) { unknownInvoice.add(l.transactionId); continue; }
      const signed = creditnotaIds.has(l.invoiceId)
        ? -Math.abs(num(l.amountApplied))
        : Math.abs(num(l.amountApplied));
      byTx.set(l.transactionId, (byTx.get(l.transactionId) ?? 0) + signed);
    }
    for (const id of unknownInvoice) byTx.delete(id);
    for (const t of input.transactions) {
      const spent = byTx.get(t.id);
      if (spent == null) continue;
      const moved = Math.abs(num(t.amount));
      if (spent > moved + MONEY_EPSILON) {
        out.push({
          kind: "transaction_overallocated",
          entityId: t.id,
          euros: round2(spent - moved),
          message:
            `Een bankregel van ${eur(moved)} is over facturen verdeeld voor ${eur(spent)} — ` +
            `${eur(spent - moved)} meer dan er is overgemaakt.`,
          accountantMessage:
            `Bankregel van ${eur(moved)} is over facturen verdeeld voor ${eur(spent)} — ` +
            `${eur(spent - moved)} meer dan er is overgemaakt.`,
        });
      }
    }

    // ── The Bank page and the invoice list must tell the same story ──
    //
    // A 'matched' transaction with an invoice_id is what the Bank page renders as "afgehandeld:
    // this money paid that invoice". Every booking path writes that pair atomically-with-rollback
    // (invoice → paid first, link second, loud rollback on failure), and every reversal detaches
    // the link before or with the un-pay. So in a healthy administration the pair cannot disagree.
    //
    // But nothing ever LOOKED. Damage from before those orderings existed — or from a crash
    // between two writes, or a hand-edit — persists silently: the Bank page keeps saying "betaald,
    // afgehandeld" while the invoice list keeps saying "openstaand, te laat". The owner sees both
    // screens and has no way to tell which one is lying; this is the split a person actually
    // found by eye, and the only invariant here that was checkable all along and never checked.
    //
    // Skips, each for the same reason as elsewhere in this file:
    //   · tx not 'matched' or no invoice_id — a pending line mid-multi-confirm legitimately
    //     carries an invoice_id while more of its money is still unbooked;
    //   · linked invoice not in the input — a check that cannot run must not report;
    //   · invoice 'paid' — the ordinary, correct case;
    //   · invoice fully covered by amount_paid — that shape is already reported as
    //     status_open_but_covered, and two findings saying opposite things about one row is how
    //     an audit stops being believed.
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    for (const t of input.transactions) {
      if ((t.status ?? "") !== "matched" || !t.invoiceId) continue;
      const linked = invoiceById.get(t.invoiceId);
      if (!linked) continue;
      if (claimsPaid(linked)) continue;
      const total = Math.abs(num(linked.totalIncBtw));
      const paid = Math.max(0, num(linked.amountPaid));
      if (total > MONEY_EPSILON && paid >= total - MONEY_EPSILON) continue; // status_open_but_covered's case
      const open = total > MONEY_EPSILON ? round2(total - paid) : Math.abs(num(t.amount));
      out.push({
        kind: "matched_tx_unpaid_invoice",
        entityId: t.id,
        euros: open,
        // Names the button as it is written on the Bank page ('Ontkoppelen'), so the owner is not
        // hunting for a word that is nowhere in the interface.
        message:
          `De Bank-pagina zegt: een regel van ${eur(Math.abs(num(t.amount)))} is afgehandeld en betaalde ` +
          `${linked.invoiceNumber ?? "een factuur"}. De facturenlijst zegt: die factuur staat nog ${eur(open)} open. ` +
          `Eén van de twee is onwaar — is de betaling echt, meld de factuur dan alsnog als betaald; ` +
          `zo niet, kies "Ontkoppelen" bij die bankregel en koppel opnieuw.`,
        accountantMessage:
          `Bankregel van ${eur(Math.abs(num(t.amount)))} staat als afgehandeld voor ` +
          `${linked.invoiceNumber ?? "een factuur"}; die factuur staat nog ${eur(open)} open.`,
      });
    }
  }

  // Biggest euros first: this list is read top-down and the top is where the decision is.
  return out.sort((a, b) => b.euros - a.euros);
}

// ─── [GELD-INVARIANT-KAS] The drawer, checked backwards ────────────────────────────────────────
//
// Everything above this line is about invoices, bank lines and the links between them. The CASH
// drawer was not in this file at all, and it is the one ledger where the module's own opening
// argument applies hardest: cash-settle.ts does not merely admit that its passes can fail, it
// NAMES the states they leave behind, in its own reportHandledFailure calls —
//
//   "cash settlement entry not created — the kas balance is now too high"
//   "orphaned cash settlements not removed — the kas balance is now too low"
//   "cash reconcile threw — the drawer may be left half-healed"
//
// — and then nothing ever looks again. Each of those is reported once, to Sentry, at the moment it
// happens. The drawer stays out of step until someone counts the money by hand, and the same drawer
// decides whether a BTW-aangifte may be filed at all (readiness.ts, /api/btw/file).
//
// ── IT ASKS THE RECONCILER, IT DOES NOT SECOND-GUESS IT ──
//
// The check is not a second opinion about what the drawer should hold. It runs the SAME pure
// function the app reconciles with (computeCashSettlementSync) over the live data and reports what
// that function still WANTS to change. In an administration in step it wants nothing: the reconcile
// runs on every kasboek read and hourly. So anything it wants is a state that survived those.
//
// A second implementation of "what the drawer should hold" would eventually disagree with the first
// one, and then this audit would report differences that exist only between the two spellings —
// which is how an audit stops being believed. Same reason loadCashSettlementState was extracted
// rather than re-read here.
//
// ── A SNAPSHOT, NOT A VERDICT ON THE PAST ──
//
// A finding can heal itself: open the Kas page and the reconcile runs. That is not a flaw, it is the
// signal — a finding that comes back on the NEXT run is one the self-healing cannot reach, and those
// are exactly the three states above.

export type DrawerViolationKind =
  | "drawer_settlement_missing"   // paid in cash, no drawer movement → the kas balance stands TOO HIGH
  | "drawer_settlement_orphan"    // a movement belonging to no cash payment → the balance stands TOO LOW
  | "drawer_settlement_stale"     // the invoice's amount/date/direction moved and the entry did not
  | "drawer_negative";            // the drawer goes below zero on a day — physically impossible

export interface DrawerViolation {
  kind: DrawerViolationKind;
  /** The invoice id for the settlement kinds; the ISO day for drawer_negative. */
  entityId: string;
  /** What is at stake, in euros — the number that decides urgency. */
  euros: number;
  /** Dutch, owner-facing, and it names which way the drawer is wrong. */
  message: string;
  /** The accountant's reading of the same finding — see Violation.accountantMessage. */
  accountantMessage: string;
}

/**
 * Is the cash book still in step with the invoices it claims to settle?
 *
 * `state` is what loadCashSettlementState read (one definition, see its header). `sync` is the
 * verdict of the app's own reconciler over that state — passed in rather than computed here so this
 * module keeps no opinion of its own about cash settlement.
 *
 * `lowestPoint` is the drawer's worst day for the audited quarter, from lowestDrawerPoint — the
 * exact witness readiness and the filing gate block on. Omitted → not checked, and a check that did
 * not run is never reported as one that passed.
 */
export function findDrawerViolations(input: {
  settlementEntries: readonly {
    id: string; invoice_id: string | null; amount?: number | null; entry_date?: string | null;
  }[];
  sync: {
    toCreate: readonly { invoice_id: string; amount: number; description: string }[];
    toUpdate: readonly { id: string; row: { invoice_id: string; amount: number; entry_date?: string; description: string } }[];
    toDeleteIds: readonly string[];
  };
  lowestPoint?: { date: string; balance: number } | null;
}): DrawerViolation[] {
  const out: DrawerViolation[] = [];
  const byId = new Map(input.settlementEntries.map((e) => [e.id, e]));

  // Wanted and absent: the invoice says cash left (or entered) the till and the drawer never moved.
  for (const row of input.sync.toCreate) {
    out.push({
      kind: "drawer_settlement_missing",
      entityId: row.invoice_id,
      euros: round2(Math.abs(num(row.amount))),
      message:
        `${row.description} — deze contante betaling van ${eur(row.amount)} staat niet in je ` +
        `kasboek. Je kassaldo staat daardoor ${eur(row.amount)} HOGER dan het geld dat er ligt.`,
      accountantMessage:
        `${row.description} — contante betaling van ${eur(row.amount)} ontbreekt in het kasboek; ` +
        `het kassaldo staat daardoor ${eur(row.amount)} HOGER dan de werkelijke kas.`,
    });
  }

  // Present and unwanted. Three shapes, one honest sentence: the invoice is no longer paid in cash,
  // OR the entry is a duplicate of another, OR it is a legacy aggregate whose instalments now each
  // have their own row. In all three the drawer is short by the amount that should not be there.
  for (const id of input.sync.toDeleteIds) {
    const entry = byId.get(id);
    const amount = Math.abs(num(entry?.amount));
    out.push({
      kind: "drawer_settlement_orphan",
      entityId: entry?.invoice_id ?? id,
      euros: round2(amount),
      message:
        `Een kasregel van ${eur(amount)}${entry?.entry_date ? ` op ${entry.entry_date}` : ""} hoort bij ` +
        `geen enkele contante betaling (meer). Je kassaldo staat daardoor ${eur(amount)} LAGER dan ` +
        `het geld dat er ligt.`,
      accountantMessage:
        `Kasregel van ${eur(amount)}${entry?.entry_date ? ` op ${entry.entry_date}` : ""} hoort bij geen ` +
        `contante betaling (meer); het kassaldo staat daardoor ${eur(amount)} LAGER dan de werkelijke kas.`,
    });
  }

  // The invoice was corrected after it was paid and the drawer did not follow. The delta is what is
  // at stake — not the whole amount, which is mostly right.
  for (const { id, row } of input.sync.toUpdate) {
    const entry = byId.get(id);
    const drift = round2(Math.abs(num(entry?.amount) - num(row.amount)));
    const dateMoved = !!row.entry_date && (entry?.entry_date ?? null) !== row.entry_date;
    out.push({
      kind: "drawer_settlement_stale",
      entityId: row.invoice_id,
      euros: drift,
      message: drift > MONEY_EPSILON
        ? `${row.description} — je kasboek houdt ${eur(num(entry?.amount))} aan, de factuur zegt ` +
          `${eur(row.amount)}. Verschil ${eur(drift)}.`
        : `${row.description} — het bedrag klopt, maar ${dateMoved
            ? `de datum in je kasboek (${entry?.entry_date ?? "onbekend"}) is niet de betaaldatum van de factuur (${row.entry_date})`
            : "de richting van de kasregel volgt de factuur niet"}. Het saldo per dag klopt daardoor niet.`,
      accountantMessage: drift > MONEY_EPSILON
        ? `${row.description} — kasboek ${eur(num(entry?.amount))}, factuur ${eur(row.amount)}. Verschil ${eur(drift)}.`
        : `${row.description} — het bedrag klopt, maar ${dateMoved
            ? `de datum in het kasboek (${entry?.entry_date ?? "onbekend"}) is niet de betaaldatum van de factuur (${row.entry_date})`
            : "de richting van de kasregel volgt de factuur niet"}. Het saldo per dag klopt daardoor niet.`,
    });
  }

  // The one violation that is not about a settlement: a drawer below zero. You cannot pay out cash
  // you never had, and this is the strongest signal the Belastingdienst uses to reject a cash
  // administration. Reported here too — not because readiness does not (it does), but because this
  // audit runs across every administration at once, which is the only way to see how many of them
  // currently cannot be filed.
  const lp = input.lowestPoint;
  if (lp && lp.balance < 0) {
    out.push({
      kind: "drawer_negative",
      entityId: lp.date,
      euros: round2(Math.abs(lp.balance)),
      message:
        `Het kassaldo stond op ${lp.date} ${eur(lp.balance)} ONDER nul. Dat kan fysiek niet, en het ` +
        `blokkeert de BTW-aangifte van dat kwartaal.`,
      accountantMessage:
        `Het kassaldo stond op ${lp.date} ${eur(lp.balance)} ONDER nul; dat blokkeert de BTW-aangifte van dat kwartaal.`,
    });
  }

  return out.sort((a, b) => b.euros - a.euros);
}

/** The one line that says whether anything needs doing today. */
export function moneyAuditHeadline(violations: readonly Violation[]): string {
  if (violations.length === 0) return "De boeken kloppen met zichzelf. Geen enkel verschil gevonden.";
  const total = round2(violations.reduce((s, v) => s + v.euros, 0));
  const n = violations.length;
  return `${n} ${n === 1 ? "verschil" : "verschillen"} gevonden, samen ${eur(total)}.`;
}
