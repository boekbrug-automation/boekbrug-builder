// src/lib/grote-stap.ts
// [GROTE-STAP] A step large enough that a slip costs real money gets one extra beat.
//
// ── WHAT THIS IS NOT ──
//
// The spec calls this an approval workflow: an employee drafts, a manager finalizes, a senior
// accountant refunds. That org chart does not exist here and inventing it would be theatre — a
// zzp'er IS the manager, and clicking your own approval dialog approves nothing.
//
// Where a second pair of eyes genuinely exists, this app already has it: an accountant acting for
// a client cannot change the books directly — they propose, and the owner taps OK ([VOORSTEL],
// correction-proposal.ts). That is a real approval and it is built.
//
// ── WHAT IS ACTUALLY MISSING ──
//
// A size check. Every destructive action in this app costs exactly the same number of taps whether
// it moves €12 or €12.000. There is no MAX on any of them — measured. And the actions below are
// the ones where an accidental extra zero, a wrong row, or a mis-tap is not an untidy screen but a
// customer credited for four figures, a payment unlinked from the wrong invoice, or forty rows
// changed at once.
//
// So: one extra beat, proportional to the amount, and nothing else. It does not block, it does not
// route to another human, it does not remember. It makes the size visible at the moment the finger
// is over the button — which is the only moment it can still be cheap.
//
// ── AND WHY IT IS NOT A CONFIRM DIALOG ON EVERYTHING ──
//
// The same argument [RUSTIG] makes about words and [RITME] makes about banners: a confirmation
// that appears on every action is clicked away on all of them, including the one that mattered.
// The thresholds are set so this stays rare.
//
// Pure. Run: npx tsx --test src/lib/grote-stap.test.ts

/** The actions where size changes what a mistake costs. */
export type StapSoort =
  | "creditnota"        // money handed back to a customer
  | "terugbetaling"     // money actually leaving the account
  | "betaling_ontkoppelen" // a settled invoice becomes open again
  | "afboeken"          // a receivable written off
  | "bulk";             // one tap changing many rows

/**
 * Above this, in euros, the step is large. One threshold per action, because the actions differ
 * in what they cost when wrong — undoing an unlink is a click; an unnecessary refund is a bank
 * transfer to ask back.
 */
export const DREMPEL: Readonly<Record<StapSoort, number>> = {
  creditnota: 1000,
  terugbetaling: 250,
  betaling_ontkoppelen: 2500,
  afboeken: 500,
  bulk: Number.POSITIVE_INFINITY, // a bulk step is judged on its COUNT, not its amount
};

/** Above this many rows, one tap is changing too much to take on trust. */
export const BULK_DREMPEL = 10;

export interface Stap {
  soort: StapSoort;
  /** Positive euros. The direction is in `soort`, never in a sign. */
  bedrag?: number | null;
  /** How many rows this one action changes. */
  aantal?: number | null;
}

export interface StapOordeel {
  groot: boolean;
  /** Why it is large — the number that crossed, for the sentence. Null when it is not large. */
  reden: { soort: "bedrag"; bedrag: number; drempel: number } | { soort: "aantal"; aantal: number; drempel: number } | null;
}

/**
 * Is this a big step?
 *
 * An amount that cannot be read is NOT large. That is deliberate and it is the only judgement call
 * in this file: treating an unknown amount as large would put the extra beat on every action whose
 * total the reader could not establish — which is precisely the set of invoices the owner is
 * already being asked most about. The check exists to be rare.
 */
export function beoordeelStap(stap: Stap): StapOordeel {
  const aantal = Number.isFinite(stap.aantal as number) ? (stap.aantal as number) : 0;
  if (aantal > BULK_DREMPEL) {
    return { groot: true, reden: { soort: "aantal", aantal, drempel: BULK_DREMPEL } };
  }
  const drempel = DREMPEL[stap.soort];
  const bedrag = Number.isFinite(stap.bedrag as number) ? Math.abs(stap.bedrag as number) : null;
  if (bedrag != null && bedrag > drempel) {
    return { groot: true, reden: { soort: "bedrag", bedrag, drempel } };
  }
  return { groot: false, reden: null };
}

const WOORD: Readonly<Record<StapSoort, string>> = {
  creditnota: "crediteren",
  terugbetaling: "terugbetalen",
  betaling_ontkoppelen: "de betaling ontkoppelen",
  afboeken: "afboeken",
  bulk: "deze stap",
};

/**
 * The sentence shown beside the button. Null when the step is ordinary — and it usually is.
 *
 * It states the size and nothing else. No warning words, no "are you sure": the owner knows what
 * they are doing, and the only thing they may have lost track of is how much.
 */
export function groteStapZin(stap: Stap, oordeel: StapOordeel, euro: (n: number) => string): string | null {
  if (!oordeel.groot || oordeel.reden == null) return null;
  if (oordeel.reden.soort === "aantal") {
    return `Je verandert hiermee ${oordeel.reden.aantal} regels in één keer.`;
  }
  return `Je gaat ${euro(oordeel.reden.bedrag)} ${WOORD[stap.soort]}.`;
}
