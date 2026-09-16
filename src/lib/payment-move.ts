// src/lib/payment-move.ts
// [MOVE-PAYMENT] Which invoice may receive a booked payment, and what to say when one may not.
// Pure — the atomic write lives in the move_invoice_payment RPC (invoice_move_payment.sql), and
// this file is the SAME rules said twice on purpose: once so the picker can only offer invoices
// the database will accept, once so a refusal reaches the owner as a sentence instead of a code.
//
// The two must agree, and the dangerous direction is only one of them: a picker that offers MORE
// than the database accepts merely produces an error the owner did not deserve. A picker that
// offers what the database would wrongly accept cannot happen — the RPC re-checks everything
// under a row lock and is the only thing that writes. So this side may be conservative; it may
// never be permissive.

/** The fields of a candidate target invoice this decision needs. */
export interface MoveTargetCandidate {
  id: string;
  status?: string | null;
  direction?: string | null;
  /**
   * [MOVE-CREDITNOTA] 'creditnota' or not. Optional only because an older caller may not select
   * it — and an absent type reads as "not a creditnota", which is the permissive answer. That is
   * why the ROUTE selects it explicitly rather than relying on this default: a guard whose input
   * is missing does not fail loudly, it simply says yes.
   */
  invoice_type?: string | null;
  invoice_number?: string | null;
  client_name?: string | null;
  invoice_date?: string | null;
  total_inc_btw?: number | null;
  amount_paid?: number | null;
  accountant_status?: string | null;
}

/** The payment being moved: one bank_tx_invoices row. */
export interface MovablePayment {
  id: string;
  invoice_id: string;
  amount_applied: number;
  /** Null for a manual instalment — it carries paid_on/method instead. */
  transaction_id?: string | null;
  paid_on?: string | null;
  method?: string | null;
}

/** One cent of slack — the same epsilon apply_bank_payment and the RPC use. */
const EPS = 0.01;

/** What is still open on this invoice, never negative. */
export function remainingOn(inv: MoveTargetCandidate): number {
  const total = Math.abs(Number(inv.total_inc_btw ?? 0));
  const paid = Math.max(0, Number(inv.amount_paid ?? 0));
  return Math.max(0, total - paid);
}

/**
 * May this payment move onto this invoice? Mirrors move_invoice_payment's guards in the order the
 * RPC applies them, so the reason the picker gives is the reason the database would give.
 *
 * 'processing' is deliberately NOT payable: an incoming invoice still in the verify queue holds
 * amounts nobody has read yet, and 'paid' feeds the BTW figures. Moving money onto one would book
 * an unverified cost — the same gate /api/invoice/pay-toggle enforces with PAYABLE.
 */
export function canReceivePayment(
  payment: { amount_applied: number; invoice_id: string; transaction_id?: string | null },
  target: MoveTargetCandidate,
  sourceDirection: string | null | undefined,
  /** Invoice ids already linked to this payment's bank line — a second link would collide. */
  alreadyLinkedInvoiceIds: ReadonlySet<string> = new Set(),
): { ok: true } | { ok: false; reason: string } {
  if (target.id === payment.invoice_id) return { ok: false, reason: "same_invoice" };
  if ((target.direction ?? "") !== (sourceDirection ?? "")) return { ok: false, reason: "direction" };
  if (target.accountant_status === "verwerkt") return { ok: false, reason: "verwerkt" };
  if (!new Set(["received", "sent", "overdue"]).has(target.status ?? "")) {
    return { ok: false, reason: "not_payable" };
  }
  // [MOVE-CREDITNOTA] A creditnota is money the business OWES back — a NEGATIVE document, settled
  // by paying out or by offsetting, never by receiving. The guard below reads the total through
  // abs(), so a creditnota of −100 looks like an invoice with 100 still open, and a received
  // payment moved onto it marked it 'paid' while the sales invoice it really belonged to silently
  // lost the money. Measured against a real Postgres — see
  // supabase/migrations/invoice_move_payment_creditnota_guard.sql.
  //
  // Only the TARGET. A creditnota may still be the SOURCE, so a payment wrongly attached to one
  // can be moved back off it — which is the door out of exactly this mistake.
  if ((target.invoice_type ?? "") === "creditnota") return { ok: false, reason: "creditnota_target" };
  if (Math.abs(Number(target.total_inc_btw ?? 0)) <= 0) return { ok: false, reason: "no_total" };
  if (payment.transaction_id && alreadyLinkedInvoiceIds.has(target.id)) {
    return { ok: false, reason: "already_linked" };
  }
  if (Math.max(0, payment.amount_applied) > remainingOn(target) + EPS) {
    return { ok: false, reason: "too_small" };
  }
  return { ok: true };
}

/**
 * The invoices worth offering, best guess first. Ordering is not decoration: the picker's top row
 * is the one the owner will tap without reading, so it has to be the likely answer. For the case
 * this feature exists for — a supplier's corrected re-issue — that is the SAME supplier, and among
 * those the one nearest in time to the payment.
 */
export function rankMoveTargets(
  payment: MovablePayment,
  source: MoveTargetCandidate,
  candidates: readonly MoveTargetCandidate[],
  alreadyLinkedInvoiceIds: ReadonlySet<string> = new Set(),
): MoveTargetCandidate[] {
  const eligible = candidates.filter(
    (c) => canReceivePayment(payment, c, source.direction, alreadyLinkedInvoiceIds).ok,
  );
  const srcVendor = (source.client_name ?? "").trim().toLowerCase();
  const anchor = payment.paid_on ?? source.invoice_date ?? null;
  const days = (iso: string | null | undefined): number => {
    if (!anchor || typeof iso !== "string") return Number.MAX_SAFE_INTEGER;
    const a = Date.parse(anchor), b = Date.parse(iso);
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.MAX_SAFE_INTEGER;
    return Math.abs(a - b) / 86_400_000;
  };
  return [...eligible].sort((x, y) => {
    const xv = (x.client_name ?? "").trim().toLowerCase() === srcVendor ? 0 : 1;
    const yv = (y.client_name ?? "").trim().toLowerCase() === srcVendor ? 0 : 1;
    if (xv !== yv) return xv - yv;
    // An exact-amount match is the second-strongest hint: the payment settles it in full.
    const xa = Math.abs(remainingOn(x) - payment.amount_applied) <= EPS ? 0 : 1;
    const ya = Math.abs(remainingOn(y) - payment.amount_applied) <= EPS ? 0 : 1;
    if (xa !== ya) return xa - ya;
    return days(x.invoice_date) - days(y.invoice_date);
  });
}

/**
 * The RPC raises plain messages; this turns one into Dutch the owner can act on. Matched on the
 * stable fragment each RAISE carries, never on the whole string (it interpolates amounts).
 * An unrecognised failure gets an honest "it did not happen" rather than a reassuring guess —
 * the move is atomic, so a failure always means nothing changed.
 */
export function moveFailureText(rawMessage: string | null | undefined, code?: string | null): string {
  const m = (rawMessage ?? "").toLowerCase();
  // [DEPLOY-SAFE] invoice_move_payment.sql is applied by hand in this project, so code can ship
  // before the function exists. Postgres answers 42883 (undefined_function) and PostgREST PGRST202
  // (no matching function in the schema cache) — without this the owner would read "nothing was
  // changed, try again" forever and there is nothing to try. Name the real reason instead.
  if (code === "42883" || code === "PGRST202" || m.includes("could not find the function")) {
    return "Deze functie is nog niet ingeschakeld op de server. Er is niets gewijzigd — neem contact op zodat we hem aanzetten.";
  }
  if (m.includes("payment not found")) {
    return "Deze betaling bestaat niet meer — ververs de pagina.";
  }
  if (m.includes("same invoice")) {
    return "Die betaling staat al op deze factuur.";
  }
  if (m.includes("no recorded amount")) {
    return "Van deze betaling is geen bedrag vastgelegd, dus verplaatsen kan niet. Draai hem terug en boek hem opnieuw op de juiste factuur.";
  }
  if (m.includes("already linked to this transaction")) {
    return "Deze banktransactie is al aan die factuur gekoppeld.";
  }
  if (m.includes("locked by accountant") || m.includes("verwerkt")) {
    return "Je boekhouder heeft een van beide facturen al verwerkt — vraag hem de verwerking eerst ongedaan te maken.";
  }
  if (m.includes("direction mismatch")) {
    return "Een betaling aan een leverancier kan niet op een verkoopfactuur, en omgekeerd.";
  }
  if (m.includes("not payable")) {
    return "Die factuur kan nog geen betaling ontvangen. Controleer hem eerst in de wachtrij.";
  }
  // [MOVE-CREDITNOTA] Matched on the RPC's own fragment, so the sentence is the same whether the
  // refusal came from the database or from the route's own check ahead of it.
  if (m.includes("target is a creditnota")) {
    return "Dat is een creditnota: daarop krijg jij geen geld, die betaal je terug of verreken je. Kies de factuur waar deze betaling wél bij hoort.";
  }
  if (m.includes("has no total")) {
    return "Die factuur heeft geen bedrag om te voldoen.";
  }
  if (m.includes("is less than payment")) {
    return "Op die factuur staat minder open dan het bedrag van deze betaling. Verplaatsen zou hem overbetalen — kies een andere factuur, of draai de betaling terug en boek hem in delen.";
  }
  // [VERPLAATS-TEKEN] Matched on the RPC's own fragment, same convention as the creditnota sentence
  // above. Without a branch this refusal would reach the owner as the generic "probeer het opnieuw",
  // which is the one thing that is not true: retrying does exactly the same.
  if (m.includes("change what the bank line has spent")) {
    return "Deze betaling telt andersom mee op de bankregel dan de factuur die je kiest — een creditnota geeft geld terug aan die regel, een gewone factuur haalt het eraf. Verplaatsen zou de regel meer laten uitgeven dan erop staat. Draai de betaling terug en boek hem opnieuw op de juiste factuur.";
  }
  if (m.includes("bank line behind this payment is gone")) {
    return "De banktransactie van deze betaling bestaat niet meer — ververs de pagina.";
  }
  if (m.includes("not found") || m.includes("not owned")) {
    return "Een van beide facturen bestaat niet meer — ververs de pagina.";
  }
  return "Verplaatsen is niet gelukt. Er is niets gewijzigd — probeer het opnieuw.";
}
