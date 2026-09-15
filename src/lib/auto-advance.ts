// src/lib/auto-advance.ts
// [AUTO-ADVANCE] "Snap and throw" for real: a CONFIDENT, clean invoice moves itself from the
// verify queue (status 'processing') to 'received' — booked, unpaid, shared with the accountant —
// WITHOUT a manual tap. Only the ambiguous ones wait for the human. This is the single decision
// that turns the post-upload flow from ~70% automatic to hands-off.
//
// The safety contract (why this is safe to auto-book):
//   - 'received' is UNPAID — no money moves, no payment_method, no cash/bank write. It only
//     enters the accrual picture (accrual = invoice date), and it is FULLY REVERSIBLE
//     (received → processing, or → archived) and AUDITED.
//   - We NEVER auto-PAY. The pen-mark/"probably paid" signal stays a suggestion; a human always
//     confirms Bank/Contant. Money movement is never automatic.
//   - We advance ONLY when the SAME classifier the UI badge uses says 'clean' (arithmetic OK,
//     total present + non-zero, real date, real non-placeholder number, vendor/amount/date
//     confident, not a reminder) AND the case is an ORDINARY invoice — never a statement, a
//     reminder, or a credit note (those always need human eyes).
//   - For auto-BOOKING (no human in the loop) we raise the per-field confidence floor ABOVE the
//     0.7 review line to HIGH_CONF, so a merely-"not-flagged" read is not enough.
//
// The double-check is preserved but becomes OPT-IN, not mandatory-per-invoice: every auto-
// advanced invoice is tagged _auto_verified so the owner can review "wat is automatisch verwerkt"
// and undo any one. Pure + testable (run: npx tsx src/lib/auto-advance.test.ts).

import { classifyImportHealth, type HealthInput } from "./import-health";
import { isTaxKind } from "./tax-letter";
// [GEGROND]/[DOCCHECK] The two vetoes below are DEFINED in those modules, next to the reasoning
// that justifies them. This file used to restate them as `=== "absent"` and `=== "present"`, which
// left the versions carrying the explanation with no caller at all — so editing them would have
// changed nothing while looking exactly like changing what may auto-book.
import { verdictBlocksAutoBooking } from "./amount-grounding";
import { placementBlocksAutoBooking } from "./document-verify";
// [E-FACTUUR-BESLECHT] The one witness that is not a reading. See the gate below.
import { eInvoiceSettlesAmounts } from "./e-invoice";
// [NUL-BTW-STIL] The zero-BTW question, shared with the doors that never reach this queue.
import { zeroBtwUnexplained } from "./zero-btw";
// [VREEMDE-VALUTA] The euro assumption. A document in another currency is never auto-booked.
import { foreignCurrencyHold } from "./vreemde-valuta";

// Auto-booking bar — stricter than import-health's 0.7 review line. A present per-field score
// below this keeps the invoice in the queue for a human, even if it isn't otherwise "flagged".
export const HIGH_CONF = 0.8;
// Overall AI confidence floor. FAIL-CLOSED: auto-booking REQUIRES a confidence that clears this;
// a null/absent overall confidence is never enough (it would book on presence checks alone).
const MIN_OVERALL = 0.7;
// When the model gave NO amount-specific confidence, we lean on the overall score — but demand a
// much higher one, because the money field is the one that must never be wrong.
const VERY_HIGH_OVERALL = 0.9;

export interface AutoAdvanceSignals {
  is_invoice?: boolean | null;
  is_statement?: boolean | null;
  is_reminder?: boolean | null;
  is_credit_note?: boolean | null;
  document_kind?: string | null;
  invoice_type?: string | null;
  /** [AANSLAG] The effective tax kind (tax-letter.ts effectiveTaxKind); a tax letter never auto-books. */
  tax_kind?: string | null;
  confidence?: number | null; // overall AI confidence
  // [AUTO-ADVANCE] The RAW stored gross (total_inc_btw) — NOT the amount-fallback. Auto-booking
  // requires a real, finite, non-zero gross; an invoice priced only via a fallback 'amount' (so
  // the dedup gate that keys on total_inc_btw never ran) must stay in the queue.
  totalIncBtw?: number | null;
  // [AUTO-ADVANCE] The owner overrode a duplicate warning ("toch toevoegen"). Adding-anyway is
  // consent to ADD, never to skip verification — such a row must never auto-book.
  forcedDuplicate?: boolean;
  // [BTW-GATE] The read BTW rate (0 | 9 | 21 | null). Auto-booking a materially-priced invoice whose
  // btw_amount is 0 silently zeroes the voorbelasting; we only allow a zero BTW to auto-book when the
  // read EXPLICITLY says 0% (a genuine vrijgesteld / 0-rate invoice), never on a null/absent rate.
  btwRate?: number | null;
  // [GEGROND] What the DOCUMENT'S OWN TEXT says about the total the reader reported: was that exact
  // number found in it, is it demonstrably not in it, or was there no text to search (a photo).
  // Every other signal in this interface is the reader's opinion of the reader; this is the only
  // one from outside it. Optional — absent means the check did not run, which is treated exactly
  // like 'unreadable' and blocks nothing.
  totalGrounding?: "found" | "absent" | "unreadable" | null;
  // [DOCCHECK] WHERE that total sits on the document: labelled as the total ('anchored'), the
  // largest amount on the page ('largest'), or merely printed somewhere ('present') — which is the
  // subtotal-read-as-total shape. Optional; absent means the check did not run and blocks nothing.
  totalPlacement?: "anchored" | "largest" | "present" | "absent" | "unreadable" | null;
  // [DOCCHECK-SPLIT] True when the document prints a valid BTW split that differs from the one read.
  // Optional; absent means the check did not run and blocks nothing.
  btwContradictsDocument?: boolean | null;
  /**
   * [E-FACTUUR] The supplier's own structured figures disagree with what was read off the page.
   * Only `true` blocks — a document with no e-invoice in it answers null, and a check that could
   * not run must never read as one that failed.
   */
  eInvoiceContradicts?: boolean | null;
  /**
   * [GEGROND-STAAT-IN] Are excl, btw AND incl each literally printed in the document's own text?
   *
   * The one witness in this decision that is not the reader grading itself. It stands in for a
   * MISSING per-amount confidence and for nothing else — see the block further down, and the long
   * note on moneyGroundedInText() in amount-grounding.ts for why it is asked this narrowly.
   *
   * Optional and defaulting to absent, so every existing caller behaves exactly as it did.
   */
  moneyGroundedInText?: boolean | null;
  health: HealthInput; // the same input classifyImportHealth reads
}

export interface AutoAdvanceDecision {
  advance: boolean;
  reason: string; // machine tag for audit/telemetry
}

/**
 * Decide whether a freshly-extracted incoming invoice may skip the manual verify tap. Conservative
 * by construction and FAIL-CLOSED: any doubt, any missing signal → false (stays in the queue for
 * the human). Auto-booking sends a number into the P&L / BTW / accountant package with no human
 * in the loop, so the bar is deliberately high. Pure.
 */
export function shouldAutoAdvanceInvoice(s: AutoAdvanceSignals): AutoAdvanceDecision {
  // A duplicate the owner forced past the warning is never auto-booked.
  if (s.forcedDuplicate === true) return { advance: false, reason: "forced_duplicate" };

  // Ordinary invoice only — a statement/reminder/creditnota always needs human eyes.
  if (s.is_invoice === false) return { advance: false, reason: "not_invoice" };
  if (s.is_statement === true) return { advance: false, reason: "statement" };
  if (s.is_reminder === true) return { advance: false, reason: "reminder" };
  if (s.is_credit_note === true || s.invoice_type === "creditnota") return { advance: false, reason: "creditnota" };
  // [AANSLAG] A Belastingdienst letter decides where money books (privé, settlement, cost) —
  // that is the owner's call, never the app's.
  if (isTaxKind(s.tax_kind)) return { advance: false, reason: "tax_letter" };
  const kind = (s.document_kind ?? "").toLowerCase();
  if (kind === "statement" || kind === "reminder" || kind === "credit_note" || kind === "creditnota") {
    return { advance: false, reason: `kind_${kind}` };
  }

  // A REAL gross must exist — never auto-book a total derived only from the 'amount' fallback
  // (that path bypasses the total_inc_btw-keyed dedup gate).
  if (!(typeof s.totalIncBtw === "number" && Number.isFinite(s.totalIncBtw) && Math.abs(s.totalIncBtw) >= 0.005)) {
    return { advance: false, reason: "no_reliable_total" };
  }

  // [BTW-GATE] Never auto-book a materially-priced invoice with ZERO btw unless it is EXPLICITLY a
  // 0%-rate invoice. A 9%/21% invoice misread as ex==incl (btw 0) passes the arithmetic gate
  // (ex + 0 = incl) and the health "clean" check — and would auto-book with its voorbelasting
  // silently zeroed, the one number this app exists to protect, behind an "automatisch geverifieerd"
  // tag that reduces scrutiny. Fail-closed to human review; a genuine 0%/vrijgesteld invoice
  // (btwRate === 0) still auto-advances. Strictly stricter — this can only HOLD, never wrongly book.
  // [NUL-BTW-STIL] The question itself now lives in zero-btw.ts, because the doors that do NOT
  // pass through this queue must ask exactly the same one — and it gained the reverse-charge
  // answer on the way: a verlegde factuur carries no BTW and no rate BY DESIGN (see the note on
  // _btw_verlegd in ai.ts), so holding it here named a reading failure that never happened.
  // [VREEMDE-VALUTA] The document named a currency that is not the euro, so the amounts stored
  // are not euro amounts — nothing converted them, by design. Auto-booking them would put a
  // dollar figure in the base, the btw and the aangifte under an "automatisch geverifieerd" tag,
  // and every arithmetic gate below would pass, because the document is internally consistent in
  // its own money. Only a human can supply what their bank actually took. Absent currency reads
  // as no hold, so this changes nothing for a document that never named one.
  if (foreignCurrencyHold(s.health?.field_confidence?._valuta?.code).hold) {
    return { advance: false, reason: "foreign_currency" };
  }

  // [ZELFFACTUUR] The document says the CUSTOMER drew it up. If the owner is the seller, this is
  // their own turnover and auto-booking it as a cost doubles the sale and claims back btw they
  // OWE. If the owner is the buyer it is a genuine purchase invoice. Nothing on the paper says
  // which, so nothing here decides — it waits for the one person who knows.
  if (s.health?.field_confidence?._zelffactuur === true) {
    return { advance: false, reason: "self_billed" };
  }

  if (zeroBtwUnexplained({
    totalIncBtw: s.totalIncBtw,
    btwAmount: s.health?.btw_amount,
    btwRate: s.btwRate,
    shifted: s.health?.field_confidence?._btw_verlegd != null,
  })) {
    return { advance: false, reason: "zero_btw_not_explicit_zero_rate" };
  }

  // [ONGEGROND-AFGELEID] A gross WE computed is a gross the grounding gate never saw. When the
  // reader returned ex + btw but no total, the pipeline derives incl = ex + btw AFTER
  // groundMoneyFields ran — so the grounding verdict for the total is 'unreadable' (blocks
  // nothing, by design) while the identity holds by construction (checks nothing, by
  // construction). Every gate below then passes a booked gross that was never compared against
  // the paper. The [GEGROND] rule directly below refuses an ungrounded READ total; this refuses
  // the ungrounded DERIVED one, for exactly the same reason.
  if (s.health.field_confidence?._total_derived === "total") {
    return { advance: false, reason: "total_derived_never_grounded" };
  }

  // [GEGROND] The reader reported a total that is NOT printed anywhere in the document's own text.
  // That is not low confidence and it is not bad arithmetic — the other gates cannot see it at all,
  // because they only ever compare the read against itself. It is a figure the paper does not
  // contain, and booking it without a human is how a wrong number becomes a cost, a voorbelasting
  // claim and a line in an aangifte.
  //
  // Only 'absent' holds. 'unreadable' is a photographed receipt — the ordinary case this app exists
  // for — and refusing to automate those would take the product away in the name of protecting it.
  // The check adds a way to be CERTAIN; it never adds a way to be stuck.
  // [E-FACTUUR-BESLECHT] Read this line before the three gates below it.
  //
  // Those three — grounding, placement, and the money's own confidence score — exist for exactly
  // one reason: the amount was READ off a page and a reading can be wrong. When the supplier sent
  // his figures along in machine form and they match what was read to the cent, that reason is
  // gone. Not smaller. Gone. There is no page to have misread.
  //
  // This is where the app had it backwards. The strongest witness it will ever have was wired in
  // as a SIXTH check on the reading, when it is the thing that makes the reading unnecessary. An
  // invoice held out of the queue because the model was 0.72 sure of a number the supplier already
  // stated is a human being asked to verify something nobody is uncertain about.
  //
  // NARROW ON PURPOSE. It settles the money and nothing else. Everything above this line still
  // applies without exception — a statement, a reminder, a creditnota and a forced duplicate can
  // all carry perfectly valid XML — and so does every gate below it about the vendor, the number
  // and the date, which parseEInvoice does not vouch for. One axis, closed properly.
  const amountsSettled = eInvoiceSettlesAmounts(s.health.field_confidence);

  if (!amountsSettled && verdictBlocksAutoBooking(s.totalGrounding)) {
    return { advance: false, reason: "total_not_in_document_text" };
  }

  // [DOCCHECK] And the sharper form of the same question. 'present' means the figure IS printed on
  // the document but neither carries a total-label nor is the largest amount on the page — which is
  // exactly what a SUBTOTAL, a LINE ITEM and the BTW look like. Measured on a real layout, all three
  // of those wrong reads came back 'found' to the grounding check above and were booked.
  //
  // Only 'present' is added here; 'absent' is already held one line up, and 'unreadable' still holds
  // nothing.
  if (!amountsSettled && placementBlocksAutoBooking(s.totalPlacement)) {
    return { advance: false, reason: "total_not_where_a_total_is_printed" };
  }

  // [DOCCHECK-SPLIT] And the shape the whole line of work started from. The € 0,46 error had a
  // RIGHT total, consistent arithmetic and an invented split — so every gate above it, including the
  // two new ones, waved it through. This holds when the document prints a DIFFERENT valid split than
  // the one that was read: the paper contradicts the reader, in the reader's own units.
  //
  // Never merely because the BTW was not printed: a receipt stating a rate and a total leaves the
  // split to be computed, and holding those would fill the queue with correct documents.
  if (s.btwContradictsDocument === true) {
    return { advance: false, reason: "btw_contradicts_printed_split" };
  }

  // [E-FACTUUR] The strongest refusal in this function, and the one no other gate could reach.
  //
  // A Factur-X or ZUGFeRD PDF carries the invoice a second time as XML the SUPPLIER produced. When
  // that disagrees with what was read off the page, every check above is satisfied: the arithmetic
  // is consistent, the figure is printed, it sits exactly where a total belongs, the model is
  // confident. They are all examining the same reading. Only the supplier's own file can say the
  // reading is of the wrong number.
  //
  // Nothing is corrected here. The figure the document states is recorded on the row and named to
  // the owner, so the fix is one look instead of a hunt — see import-health.ts.
  if (s.eInvoiceContradicts === true) {
    return { advance: false, reason: "e_invoice_contradicts_read" };
  }

  // Overall confidence — FAIL-CLOSED: must be present AND clear the floor.
  if (!(typeof s.confidence === "number" && s.confidence >= MIN_OVERALL)) {
    return { advance: false, reason: "overall_confidence_missing_or_low" };
  }

  // Must be fully clean by the SAME classifier the queue badge uses (arithmetic, total present,
  // real date, real number, confident vendor/amount/date, not a reminder).
  const health = classifyImportHealth(s.health);
  if (health.level !== "clean") return { advance: false, reason: "needs_review" };

  const fc = s.health.field_confidence;
  // The MONEY field's own confidence is the one that must never be wrong. If the model reported
  // it, it must clear HIGH_CONF. If it did NOT report it, we don't skip the check — we demand a
  // VERY_HIGH overall confidence instead (fail-closed, never fail-open on a missing money score).
  //
  // [FIND-GAP] Take the MINIMUM across EVERY present money score, not the first present one. A
  // `.find` returned the first defined of [amount, total, total_inc_btw] — so a high `amount` score
  // masked a LOW `total_inc_btw` score (and total_inc_btw is the value that actually becomes the
  // booked gross). That auto-booked an invoice whose gross the model was NOT confident about. Any
  // present money score below the bar must block (fail-closed) — mirrors the Math.min over the other
  // per-field scores below.
  const moneyScores = fc
    ? [fc.amount, fc.total, fc.total_inc_btw].filter((n): n is number => typeof n === "number")
    : [];
  // [E-FACTUUR-BESLECHT] Skipped entirely when the supplier settled the amounts — this whole
  // block is the model grading its own reading of the money, and there is no reading to grade.
  // [GEGROND-STAAT-IN] Set when the DOCUMENT ITSELF, rather than a confidence score, carried the
  // money. Kept so the booking can say which door it came through — see the reason at the bottom.
  let grondedInPlaatsVanScore = false;
  if (!amountsSettled) {
    if (moneyScores.length > 0) {
      if (Math.min(...moneyScores) < HIGH_CONF) return { advance: false, reason: "amount_confidence_below_high_bar" };
    } else if (s.moneyGroundedInText === true) {
      // [GEGROND-STAAT-IN] No money score, but excl, btw AND incl are each literally printed in the
      // document's own characters — and classifyImportHealth has already proved they add up.
      //
      // This is not a lowered bar. The fallback it replaces asks the MODEL how sure it is about the
      // whole document; this asks the PAPER about the three numbers that become money, and gets
      // three yeses that also reconcile. Of the two, the self-report is the weaker witness — that is
      // the entire argument of amount-grounding.ts, written there before this door existed.
      //
      // What still refuses, unchanged and ahead of this line: a total the text does not contain, a
      // total in the wrong place on the page, a printed BTW split that disagrees, the supplier's own
      // e-invoice disagreeing, a duplicate, a changed IBAN, a statement, a reminder, a credit note,
      // an overall confidence under the floor, and any per-field score below the bar.
      grondedInPlaatsVanScore = true;
    } else if (!(typeof s.confidence === "number" && s.confidence >= VERY_HIGH_OVERALL)) {
      return { advance: false, reason: "no_amount_confidence_and_overall_not_very_high" };
    }
  }

  // Every OTHER present per-field score must also clear the HIGH bar.
  if (fc) {
    const scores = [fc.vendor, fc.invoice_number, fc.invoice_date].filter((n): n is number => typeof n === "number");
    if (scores.length > 0 && Math.min(...scores) < HIGH_CONF) {
      return { advance: false, reason: "field_confidence_below_high_bar" };
    }
  }

  // Two doors, two names. A booking that leaned on the document instead of on a money score is
  // countable from that moment on — so "how often did the new door fire, and did any of those come
  // back as a correction" is a query, not a guess. Widening a money gate without being able to ask
  // that afterwards is how you find out from a customer instead of from a dashboard.
  return { advance: true, reason: grondedInPlaatsVanScore ? "clean_grounded_in_document" : "clean_high_confidence" };
}
