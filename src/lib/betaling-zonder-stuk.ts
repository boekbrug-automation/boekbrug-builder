// src/lib/betaling-zonder-stuk.ts
// [BETAALD-GEEN-STUK] The money left the account and no document explains it.
//
// [RITME] (supplier-cadence.ts) already asks the other half of this question: which invoice did not
// arrive, on a supplier's own rhythm. That answer is an EXPECTATION — Adobe billed on the 4th for
// eleven months and it is now the 20th — and it is stated as one, deliberately.
//
// This is the half that is not a prediction at all. The bank line exists. The counterparty is a
// supplier this administration has invoices from. Nothing is linked to it. Money left, and the
// paperwork that justifies it is not here — that is an observation, and it is worth more than the
// rhythm precisely because nothing about it has to be guessed.
//
// What it costs when nobody notices: the cost is unbooked, so the result is overstated, and the
// voorbelasting on it is never reclaimed. Neither shows up anywhere as a contradiction — the
// administration is simply, quietly, smaller than the business was.
//
// ── THE RULE THAT KEEPS THIS QUIET ──
//
// Only counterparties we ALREADY have purchase invoices from. A debit to a shop that has never
// sent an invoice is the ordinary "this one needs a receipt" case, which needsDocument()
// (bank-identity.ts) already handles on the bank screen; repeating it here would bury the signal
// that matters under the one that is already answered somewhere else.
//
// So the sentence this module can defend is narrow and true: *you normally receive an invoice from
// these people, and for this payment there is none.*
//
// Pure. Run: npx tsx --test src/lib/betaling-zonder-stuk.test.ts

/** A bank line as this module needs it. `amount` is signed: negative is money leaving. */
export interface BankLine {
  id: string;
  date: string;
  amount: number;
  counterpartName: string | null;
  description: string | null;
  /** The invoice this line is linked to, when it is linked to one. */
  invoiceId: string | null;
  /** The row's own status — an ignored line is a decision the owner already made. */
  status: string | null;
}

export interface PaymentWithoutDocument {
  transactionId: string;
  date: string;
  /** POSITIVE euros: what left the account. A screen never has to flip a sign. */
  amount: number;
  supplier: string;
  description: string | null;
}

/** Statuses that mean the owner has already answered for this line. */
const ANSWERED = new Set(["ignored", "excluded", "matched", "confirmed"]);

/**
 * Payments to known suppliers that carry no document.
 *
 * `knownSuppliers` maps the supplier key (supplierNameKey of the counterparty) to the name as the
 * owner knows it, and is built from the purchase invoices this administration already has. A
 * counterparty absent from that map is silent here — see the header for why that narrowness is the
 * feature.
 *
 * `keyOf` is passed in rather than imported so this module keeps no opinion about what a supplier
 * key is: there is exactly one such function in the app ([ÉÉN-LEVERANCIERSSLEUTEL]) and a second
 * copy of it here would be a second answer to "is this the same company".
 */
export function paymentsWithoutDocument(input: {
  lines: readonly BankLine[];
  knownSuppliers: ReadonlyMap<string, string>;
  keyOf: (name: string) => string;
}): PaymentWithoutDocument[] {
  const out: PaymentWithoutDocument[] = [];
  for (const line of input.lines) {
    // Money coming IN is never a missing purchase invoice.
    if (!(line.amount < 0)) continue;
    if (line.invoiceId != null) continue;
    if (line.status != null && ANSWERED.has(line.status)) continue;
    const name = (line.counterpartName ?? "").trim();
    if (name.length === 0) continue;
    const known = input.knownSuppliers.get(input.keyOf(name));
    if (!known) continue;
    out.push({
      transactionId: line.id,
      date: line.date,
      amount: Math.abs(line.amount),
      supplier: known,
      description: line.description,
    });
  }
  // Largest first: the biggest unbooked cost is the one that moves the result and the aangifte most.
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * The Dutch sentence for one such payment.
 *
 * It states the fact and asks for the document. It does NOT say the invoice is missing — it may be
 * sitting unread in the owner's mailbox, or have arrived under a name we did not connect. What we
 * know is that nothing here is linked to it, and that is what it says.
 */
export function betalingZonderStukZin(p: PaymentWithoutDocument, euro: (n: number) => string): string {
  return `${euro(p.amount)} betaald aan ${p.supplier} — er is geen factuur aan gekoppeld`;
}
