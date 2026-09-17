// src/lib/enablebanking-map.ts
// [ENABLEBANKING] Berlin Group snake_case JSON → our canonical BankTransaction. Pure, no I/O.
//
// ── Read this before touching the amount ──────────────────────────────────────────────────────
//
// The amount here is a MAGNITUDE and the sign lives somewhere else:
//
//     transaction_amount.amount = "15.0"     ← no sign, ever
//     credit_debit_indicator    = "DBIT"     ← the direction
//
// Verified against the vendor's own sample export: 611 transactions, 439 of them DBIT, and not one
// amount string carries a minus sign. Aggregators differ on exactly this — GoCardless, which this
// integration first targeted, sends an already-signed amount and NO indicator — so a mapper written
// from memory of another provider imports every expense as income. Not a display bug: kosten become
// omzet, the btw-aangifte inverts, and every figure the accountant signs is wrong in the direction
// that looks like a good quarter. On a real ING quarter that is −€1.578,93 read as +€361.165,81.
//
// The split is exactly CAMT.053's <Amt> + <CdtDbtInd>, so parseCAMT053Entry is the template for
// this file — branch for branch, in the same order.
//
// ── The one property this file exists to protect ──────────────────────────────────────────────
//
// A transaction can enter BoekBrug by more than one door: the owner uploads an MT940/CAMT file,
// or his bank feeds it to us over PSD2. Sooner or later both doors carry the SAME transaction.
// Cross-upload dedup (bank-import.ts) keys on
//
//     contentKey = date | amount | dedupName(counterpartName) | norm(reference)
//
// so if this mapper derives a name or a reference even SLIGHTLY differently from bank-parser.ts,
// the same transaction lands in the table twice and every figure built on it doubles. That is
// why nothing below re-implements those rules: it reshapes the JSON into what parseCAMT053Entry
// sees and then calls the SAME helpers — extractInvoiceReference, deriveReadableName — in the
// SAME order. Every branch mirrors a numbered branch there; when you change one, change both.
//
// ── What this was written against ─────────────────────────────────────────────────────────────
//
// TWO sources, and they do not carry the same authority. Read this before citing either.
//
//   1. Enable Banking's own sample accounts-data export — the shape their mock ASPSP serves back.
//      This is the vendor speaking, and it is what the FIELD NAMES and the credit_debit_indicator
//      convention rest on. It is Danish, so it exercises none of the Dutch text patterns.
//   2. A real ING business quarter, 576 transactions — but reshaped into this JSON from ING's CSV
//      export, NOT captured from a live Enable Banking response. The money in it is real (its
//      signed sum lands on the bank's own closing balance to the cent) and so are the Dutch
//      strings, which is why the Dutch branches below are tuned against it. What it does NOT
//      establish is how the live PSD2 feed shapes those strings — a converter stood in between.
//
// So: field-level facts come from (1). Text-level behaviour is tuned against (2) and written to be
// INERT when the text does not look like that — see statementRemittance. Three things stay
// unverified until a real /accounts/{id}/transactions response is in hand, each called out at its
// branch: whether the live model carries an end-to-end id (the vendor sample has none), whether
// remittance_information is ever longer than one element, and whether a Dutch bank really delivers
// its composed statement line as the remittance.

import type { BankTransaction } from "./bank-parser";
import {
  extractInvoiceReference,
  deriveReadableName,
  isValidIsoDate,
  CARD_TERMINAL_MARKERS,
} from "./bank-parser";
import { isValidIban, normalizeIban } from "./epc-qr";

/** The Berlin Group amount object: a decimal STRING plus its currency. */
export interface EnableBankingAmount {
  amount?: string | number | null;
  currency?: string | null;
}

/** A related party. Only the name reaches our tables; the address/id blocks are not stored. */
export interface EnableBankingParty {
  name?: string | null;
}

/** An account reference: an IBAN, or a domestic id under `other` with the scheme that names it. */
export interface EnableBankingAccountRef {
  iban?: string | null;
  other?: {
    identification?: string | null;
    scheme_name?: string | null;
    issuer?: string | null;
  } | null;
}

/** One transaction as Enable Banking serves it. Every field optional — banks omit freely. */
export interface EnableBankingRawTransaction {
  entry_reference?: string | null;
  transaction_amount?: EnableBankingAmount | null;
  credit_debit_indicator?: string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: EnableBankingParty | null;
  debtor?: EnableBankingParty | null;
  creditor_account?: EnableBankingAccountRef | null;
  debtor_account?: EnableBankingAccountRef | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  bank_transaction_code?: {
    code?: string | null;
    sub_code?: string | null;
    description?: string | null;
  } | null;
  merchant_category_code?: string | null;
  balance_after_transaction?: EnableBankingAmount | null;
}

/** What a mapping run produced. */
export interface EnableBankingMapResult {
  transactions: BankTransaction[];
  /** Dutch, owner-facing: each one is a transaction we could NOT read, i.e. money not imported.
   *  Surfaced exactly like the parser's parseErrors — a silent drop is the thing we refuse. */
  warnings: string[];
  /** Not-yet-booked entries we deliberately passed over. Not a warning: a pending line is not
   *  lost money, it is money the bank has not committed yet and may still change or withdraw. */
  skipped: number;
}

/** The Berlin Group status of a committed entry. Anything else is not final money. */
export const BOOKED_STATUS = "BOOK";

const DEBIT = "DBIT";
const CREDIT = "CRDT";

/**
 * Is this entry booked?
 *
 * A pending entry may still change amount, or vanish. Importing one puts a figure in the books
 * that the bank never committed, and the booked twin arriving days later with a different amount
 * dedups against nothing — so the owner ends up with both. We import only BOOK.
 *
 * An ABSENT status counts as booked: the sync asks the API for booked transactions, so a missing
 * field there means "the one kind we requested", not "unknown".
 */
export function isBooked(tx: EnableBankingRawTransaction): boolean {
  const status = cleanString(tx.status);
  if (!status) return true;
  return status.toUpperCase() === BOOKED_STATUS;
}

/**
 * The signed amount in the account's currency, plus the direction that produced the sign.
 *
 * Returns null when the direction cannot be established, and that refusal is the point. The CAMT
 * parser defaults a missing <CdtDbtInd> to CRDT, which is safe there because the schema makes the
 * element mandatory. Here we have no such guarantee, and defaulting an unsigned magnitude to
 * "credit" would book expenses as income — silently, on every affected line. A dropped line the
 * owner is told about is recoverable; an expense filed as revenue is a wrong tax return.
 *
 * The direction is returned alongside the amount so the sign and the counterpart choice below can
 * never disagree — they are one decision, made once.
 */
export function readSignedAmount(
  tx: EnableBankingRawTransaction,
): { amount: number; isCredit: boolean } | null {
  const raw = tx.transaction_amount?.amount;
  if (raw === null || raw === undefined) return null;

  // Trim BEFORE the emptiness check: Number("") is 0, so a blank or whitespace-only amount that
  // slipped past would enter the books as a fabricated 0,00 rather than as a visible warning.
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  if (!text) return null;

  const parsed = Number(text);
  // A non-finite amount must never reach the database: it poisons every sum downstream
  // (reconciliation, kwartaaltotalen). Same guard as [H3] in the CAMT parser.
  if (!Number.isFinite(parsed)) return null;

  const indicator = cleanString(tx.credit_debit_indicator)?.toUpperCase() ?? null;
  if (indicator === DEBIT || indicator === CREDIT) {
    const magnitude = Math.abs(parsed);
    const isCredit = indicator === CREDIT;
    return { amount: signOf(magnitude, isCredit), isCredit };
  }

  // No usable indicator. A value that carries its own minus sign is still unambiguous — a bank
  // that signs its amounts has told us the direction — so honour it rather than drop money we can
  // read. An unsigned value with no indicator is genuinely undecidable and is refused above.
  if (parsed < 0) return { amount: parsed, isCredit: false };
  return null;
}

/** The signed amount alone. Thin wrapper over readSignedAmount for readability at call sites. */
export function parseSignedAmount(tx: EnableBankingRawTransaction): number | null {
  return readSignedAmount(tx)?.amount ?? null;
}

/**
 * Collect the remittance text, in document order, de-duplicated, line-break flattened.
 *
 * Mirrors parseCAMT053Entry's `ustrdParts`: the free text first, then [CAMT-STRD-REF]'s
 * structured creditor reference — which Enable Banking calls reference_number and which is often
 * the ONLY place a betaalverzoek's betalingskenmerk appears. Reading just one of the two would
 * lose an invoice number and leave the payment in "Geen factuur".
 *
 * The line-break flattening is not cosmetic. Enable Banking packs what a CAMT file splits across
 * several <Ustrd> elements into ONE string with embedded newlines ("Til Mad\nWe have transferred
 * the amount to:\n4092 3342223455" — 80 of 611 lines in the vendor sample). extractInvoiceReference
 * and deriveReadableName are written against the flat form the file door produces, so handing them
 * a multi-line string is handing them text no other door ever shows them. A line break becomes
 * exactly what the file door produces at the same place: the parser trims each <Ustrd> and joins
 * with ONE space, so `\s*[\r\n]+\s*` → " " reproduces it character for character.
 *
 * Runs of ordinary spaces are deliberately LEFT ALONE. [BANK-PARSE-FEE] below splits the charge
 * label on /\s{2,}/, and banks pad their statement text into columns ("otay-shop.dk     15423"),
 * so collapsing every whitespace run would make this door read a fee label — and therefore a
 * counterpart name, and therefore a dedup fingerprint — that the uploaded file does not.
 */
export function collectRemittance(tx: EnableBankingRawTransaction): string {
  const parts: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const part = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (part && !parts.includes(part)) parts.push(part);
  };

  if (Array.isArray(tx.remittance_information)) {
    for (const p of tx.remittance_information) push(p);
  }

  // Un-compose BEFORE appending the structured reference, and append only what the text does not
  // already carry. ING repeats that reference inside its own composed line — usually the whole
  // Omschrijving verbatim, but not always: two exports of the same quarter give
  // reference_number "Incasso Huur Periode: 01-04-2026 tot 01-05-2026" and plain "Incasso Huur"
  // for the same payment. An equality check catches the first and misses the second, so the text
  // gains a second copy of itself and extractInvoiceReference reads the same number twice.
  // Containment catches both, and still appends a reference the text genuinely lacks — the
  // [CAMT-STRD-REF] case this exists for, where a betaalverzoek carries its betalingskenmerk
  // ONLY in the structured field.
  const described = statementRemittance(parts.join(" "));
  const ref = tx.reference_number?.replace(/\s*[\r\n]+\s*/g, " ").trim();

  if (!ref) return described;
  if (!described) return ref;
  return described.includes(ref) ? described : `${described} ${ref}`;
}

/**
 * Un-compose a bank's ready-made statement line back to the remittance text alone.
 *
 * ING's own statement text is not a remittance — it is the line it prints, with the party, the
 * account, the mandate and the value date folded in as labelled segments:
 *
 *     Naam: W. Ketels en Zoon Eierhandel Omschrijving: 26002148 IBAN: NL89RABO0131703501
 *     Kenmerk: 260514RABONL2U080320000100001 Valutadatum: 25-05-2026
 *
 * Every one of those labels is data the CAMT file carries in its OWN element — `<Cdtr><Nm>`,
 * `<CdtrAcct><IBAN>`, `<Refs>` — and that we already read from this transaction's own fields. Only
 * `Omschrijving:` is the remittance. Leaving the rest in is not cosmetic: extractInvoiceReference
 * then scoops up the Kenmerk, the Machtiging ID and the account digits, so a real ING quarter
 * produced "TK10000001, 100001" where the file door produces nothing at all, and
 * "600000001, 5049NM, INC000000001, 5000000001, MID100000001" where it produces "600000001, 5049NM".
 * That is the [BANK-REF-ONE-SOURCE] triple failure exactly: a different reference is a different
 * contentKey (a double import), it makes parseReferenceNumbers count several invoices so
 * autoConfirmTier stops auto-booking the line, and isFullyCovered can then never be satisfied.
 *
 * WHERE THAT TEXT CAME FROM, precisely, because it decides how much this function may assume: it
 * is a real ING business quarter, but reshaped into this JSON from ING's CSV export — not a live
 * Enable Banking response. So the STRINGS are ING's and the failure above is real, while "the PSD2
 * feed delivers them this way" is NOT established. That is why the function is inert by default:
 * text that is not recognisably composed is returned untouched, so if the live feed sends a clean
 * remittance this branch never fires. Confirm it against a real /accounts/{id}/transactions
 * response before treating it as ING's wire format.
 *
 * A composition with no `Omschrijving:` at all is a transfer the payer left blank — the file door
 * has an empty `<Ustrd>` there, so this returns empty rather than handing the metadata downstream
 * as if it were the payer's text.
 *
 * Anything that is not recognisably composed is returned untouched. The recognition is deliberately
 * narrow — an explicit `Omschrijving:` label, or a line that OPENS with `Naam:` — because the
 * failure mode of guessing wrong is to throw away a payer's description, invoice number and all.
 * A remittance that itself contains "IBAN:" is the known limit: ING destroyed the boundary when it
 * composed the line, and no reader can put it back.
 */
export function statementRemittance(text: string): string {
  const described = text.match(
    /(?:^|\s)Omschrijving:\s*([\s\S]*?)(?=\s(?:IBAN|BIC|Kenmerk|Machtiging ID|Incassant ID|Datum\/Tijd|Valutadatum):|$)/,
  );
  if (described) return described[1].trim();
  if (/^Naam:\s/.test(text)) return "";
  return text;
}

/**
 * The booking date, as a plain ISO date.
 *
 * Prefers value_date over booking_date — the same order parseCAMT053Entry uses (<ValDt> before
 * <BookgDt>), and the reason matters for dedup: an MT940 upload of the same transaction carries
 * the value date, so choosing the booking date here would shift the date by a day or two on
 * weekend bookings and defeat the fingerprint.
 *
 * transaction_date is a last resort (it is null throughout the vendor sample). Datetimes are
 * truncated to their date part, since bank_transactions.date is a Postgres `date`.
 */
export function pickTransactionDate(tx: EnableBankingRawTransaction): string | null {
  const candidates = [tx.value_date, tx.booking_date, tx.transaction_date];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const date = raw.trim().slice(0, 10);
    if (isValidIsoDate(date)) return date;
  }
  return null;
}

/**
 * The counterpart's IBAN, or null.
 *
 * Two things are checked, and both were earned from real data.
 *
 * `other.identification` is NOT an IBAN and must never be stored as one. In the vendor's sample
 * every single one is either a card PAN (scheme_name "CPAN", e.g. "233111XXXXXX4455") or a
 * domestic account number ("BBAN"/"BANK"/"OTHI") — 364 of them, and zero IBANs. Writing a card
 * number into counterpart_iban would put a PAN in a column nobody expects one in, and would match
 * against the owner's own IBANs as if it were an account. It is accepted only when the scheme
 * itself says it is an IBAN.
 *
 * And `.iban` is not automatically an IBAN either. On a real ING quarter the three bank-charge
 * lines carry `"NL36INGB0007654321 Periode: 01-03-2026 / 31-03-2026"` in that field — the owner's
 * OWN account with a billing period stapled to it. Stored as-is it is junk in the column
 * [BANK-IBAN] matches suppliers on. So the value goes through the same mod-97 check as every other
 * IBAN in the app, and is stored in the same normalized form the file door produces.
 */
export function counterpartIbanOf(acc: EnableBankingAccountRef | null | undefined): string | null {
  const direct = cleanString(acc?.iban);
  if (direct) return isValidIban(direct) ? normalizeIban(direct) : null;
  const scheme = cleanString(acc?.other?.scheme_name)?.toUpperCase();
  if (scheme === "IBAN") {
    const other = cleanString(acc?.other?.identification);
    return other && isValidIban(other) ? normalizeIban(other) : null;
  }
  return null;
}

/**
 * Map ONE transaction. Returns null when the entry cannot be read; the caller records a warning
 * so a dropped line is always visible rather than silently missing from the owner's money.
 */
export function mapEnableBankingTransaction(
  tx: EnableBankingRawTransaction,
): BankTransaction | null {
  const signed = readSignedAmount(tx);
  if (!signed) return null;
  const { amount, isCredit } = signed;

  const date = pickTransactionDate(tx);
  if (!date) return null;

  const description = collectRemittance(tx);
  const currency = cleanString(tx.transaction_amount?.currency) ?? "EUR";

  // Counterpart. Money IN → the other party is the debtor (who paid us); money OUT → the creditor
  // (whom we paid). Exactly parseCAMT053Entry's isCredit ? "Dbtr" : "Cdtr", and deliberately so
  // even where a bank fills the other slot: the vendor sample has 13 card REFUNDS that arrive as
  // CRDT while still naming the shop as `creditor`. Reading that field would give a name the
  // uploaded file cannot give — the CAMT parser looks at <Dbtr> there too — and a name that
  // differs by door is a fingerprint that differs by door, which is a double import. Both doors
  // fall through to deriveReadableName on the same text instead, and agree.
  let counterpartName = cleanString(isCredit ? tx.debtor?.name : tx.creditor?.name);
  const counterpartIban = counterpartIbanOf(isCredit ? tx.debtor_account : tx.creditor_account);

  // [BANK-PARSE-FEE] Bank charges name no party at all. Same rescue as the CAMT parser: take the
  // clean charge label from the head of the description ("Kosten Zakelijk Betalingsverkeer …").
  if (!counterpartName && /Kosten|Betalingsverkeer/i.test(description)) {
    const label = description
      .split(/\s{2,}|Factuurnr\.|Betreft|Periode/i)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (label.length >= 3) counterpartName = label;
  }

  // [BANK-PARSE-REF] The reference comes from the remittance text through the SHARED extractor,
  // never from a re-implementation here.
  //
  // There is no endToEndId fallback, because this model has no end-to-end id: reference_number is
  // the structured creditor reference (CAMT's <CdtrRefInf><Ref>) and is already IN the description
  // above, so extractInvoiceReference has seen it — adding it again as a fallback would smuggle
  // past the POS guard and the bare-year drop that the extractor applies on purpose.
  // entry_reference is <NtryRef>, the bank's own entry id, and is not a reference in CAMT either.
  const isPosEntry = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(description);
  let reference = extractInvoiceReference(description || null, {
    isPos: isPosEntry,
    isCard: false,
  });

  // [BANK-PARSE-CARD] A card purchase names no party in a file, so the store has to be derived
  // from the terminal string — and derived the SAME way on both sides.
  //
  // Here the acceptor string arrives in a FIELD instead of in the text: the ING quarter carries
  // creditor.name = "BCK*OMUR MARKT AMERSFOORT NLD" where the CAMT file has no <Cdtr> at all and
  // the same string sits in the remittance. Taking that field as-is would store
  // "BCK*OMUR MARKT AMERSFOORT NLD" against the file door's "OMUR MARKT" — different name,
  // different dedupName(), different fingerprint, and the card line imports twice. Running the
  // provider's string through the file door's own rule closes that: on a real ING quarter all
  // eleven card lines came out identical to what the file door derives from the same text.
  //
  // The rescue is gated on the acceptor markers, not on "this looks like a card row", so an
  // ordinary supplier name is never shortened. On that quarter the gate matched exactly the
  // eleven Betaalautomaat rows and nothing else.

  const terminalText = CARD_TERMINAL_MARKERS.test(description);
  const acceptorName = counterpartName !== null && CARD_TERMINAL_MARKERS.test(counterpartName);

  if (!counterpartName && terminalText) {
    const store = deriveReadableName(description);
    if (store) counterpartName = store;
  } else if (acceptorName && counterpartName) {
    const store = deriveReadableName(counterpartName);
    if (store) counterpartName = store;
  }

  // Clearing the reference is separate from rescuing the name, because a terminal line can arrive
  // WITH a usable party. A cash deposit does: ING names the party "STORTING ING" and leaves the
  // Geldmaat location, the pasvolgnr and the RRN in the text, so the extractor offered
  // "800001, 001, 600000000001" as the invoice number of a €10.150 deposit. None of those three is
  // an invoice number, and booking one against a real invoice is the failure this branch exists to
  // stop — the same reason the file door clears it. On a real ING quarter this touched exactly one
  // line: the other eleven terminal rows already had no reference to lose.
  if (terminalText || acceptorName) reference = null;
  // [BANK-PARSE-READABLE] Still nothing? Derive the most recognisable text from the description
  // so the owner never faces a blank counterpart.
  if (!counterpartName) {
    counterpartName = deriveReadableName(description);
  }

  return {
    date,
    amount,
    currency,
    description,
    counterpartName,
    counterpartIban,
    reference,
    // [EB-IDENTITEIT] No source identity from this door. Deliberately null, and the reason is the
    // most expensive kind there is.
    //
    // entry_reference is the bank's own entry id and it does NOT identify one transaction: the
    // vendor sample holds 611 transactions under 481 distinct values — "3845245274" is shared by
    // 44 unrelated MobilePay lines and "0000000000" by 21. That was already written here, with
    // the conclusion "dedup keys on content".
    //
    // What the line underneath it did was hand that value to `transactionId` anyway — and
    // transactionId is not a debugging field. bank-import.ts copies it into external_id, and
    // bank_transactions carries UNIQUE (user_id, source, external_id) which the Enable Banking
    // sync upserts with ignoreDuplicates: true. So two genuinely different transactions sharing
    // an entry_reference both passed dedupTransactions (which compares incoming against EXISTING,
    // never incoming against incoming), collided at the index, and the SECOND ONE WAS SILENTLY
    // DROPPED. No error, no warning, no row — and every later sync dropped it again, so the money
    // never arrived. src/lib/enablebanking-identity.test.ts fails on exactly that if this line
    // returns.
    //
    // Current Enable Banking prose calls entryReference unique. A sample export from the same
    // vendor proves it is not, on real data. Between a promise and a measurement the measurement
    // decides, because the failure direction of believing the promise is permanent, invisible
    // loss — and the cost of not believing it is at worst a visible duplicate the owner can see
    // and unlink.
    //
    // Nothing else is weakened: the content fingerprint still recognises a re-read of the same
    // history (that is what the 7-day SYNC_OVERLAP_DAYS window relies on), it still catches the
    // same money arriving through an uploaded MT940/CAMT file, and a file door whose ids ARE
    // proven unique per statement keeps its own identity dedup untouched.
    transactionId: null,
    // [DD-SIGNAL] The feed's own ISO bank transaction code — the same family/sub-family a CAMT
    // file carries in <BkTxCd> (RDDT / ESDD for a direct debit). Sub-code first: it is the more
    // specific of the two, exactly as the file parser prefers <SubFmlyCd> over <Fmly><Cd>.
    typeCode: cleanString(tx.bank_transaction_code?.sub_code) ?? cleanString(tx.bank_transaction_code?.code),
    // [DD-SIGNAL] The machtiging and the incassant live in the COMPOSED statement line, and
    // statementRemittance deliberately cuts everything after "Machtiging ID:" off the description
    // — it is metadata, not the payer's text, and leaving it in poisons the invoice-number
    // extraction. So the raw composition is kept HERE, in rawLine, where it is the one field whose
    // job is "the original line". readDirectDebit reads it; nothing else does.
    rawLine: statementMetadata(tx),
  };
}

/**
 * [DD-SIGNAL] The labelled segments statementRemittance throws away, kept for the one reader that
 * needs them.
 *
 * enablebanking-map already knows "Machtiging ID" and "Incassant ID" — it names both as boundaries
 * where the remittance stops. Knowing where something ends and keeping it are different things,
 * and only the first was true. This is the second, and deliberately narrow: it returns the parts of
 * the composed line that name the INSTRUMENT, never the payer's own description.
 */
function statementMetadata(tx: EnableBankingRawTransaction): string {
  const parts = (tx.remittance_information ?? []).filter((p): p is string => typeof p === "string");
  const whole = parts.join(" ");
  const kept = [
    /(?:Machtiging(?:\s*ID)?):\s*([^\s]+)/i,
    /(?:Incassant(?:\s*ID)?):\s*([^\s]+)/i,
  ]
    .map((re) => re.exec(whole)?.[0] ?? null)
    .filter((v): v is string => !!v);
  return kept.join(" ");
}

/**
 * Map a whole list. Order is preserved; unreadable entries become a Dutch warning naming what we
 * could see of them, so "we imported 40 of 42 lines" is never a silent 40. Not-yet-booked entries
 * are counted separately — passed over on purpose, not lost.
 */
export function mapEnableBankingTransactions(
  raw: EnableBankingRawTransaction[],
): EnableBankingMapResult {
  const transactions: BankTransaction[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const tx of raw) {
    if (!isBooked(tx)) {
      skipped += 1;
      continue;
    }
    const mapped = mapEnableBankingTransaction(tx);
    if (mapped) {
      // [CSV-MUNT] Een regel in een andere munt dan de euro gaat NIET mee. bank_transactions heeft
      // geen valutakolom, dus $ 1.000,00 zou als € 1.000,00 in de kosten, de matching en de
      // afletterset landen — hetzelfde bedrag, de verkeerde munt, en na het boeken nergens meer
      // terug te zien. De uploaddeur weigert zo'n bestand al; deze deur deed dat niet, en die
      // draait op een cron waar niemand naar kijkt. Overslaan is verlies, maar het is ZICHTBAAR
      // verlies: de regel hieronder noemt hem met bedrag en munt.
      if ((mapped.currency || "EUR").toUpperCase() !== "EUR") {
        warnings.push(describeForeignCurrency(mapped));
        continue;
      }
      transactions.push(mapped);
      continue;
    }
    warnings.push(describeUnreadable(tx));
  }

  return { transactions, warnings, skipped };
}

/**
 * [CSV-MUNT] One Dutch line for a transaction we CAN read but must not book: it is not in euros.
 *
 * Deliberately different wording from `describeUnreadable`. "We could not read it" would send the
 * owner looking for a broken line at his bank; the truth is that we read it perfectly and this
 * administratie has nowhere to put a currency. He needs to know which line, and why.
 */
function describeForeignCurrency(tx: BankTransaction): string {
  const bits = [tx.date, `${tx.currency} ${Math.abs(tx.amount).toFixed(2)}`].filter(Boolean);
  const what = tx.counterpartName || (tx.description || "").slice(0, 40);
  return (
    `Een banktransactie in ${tx.currency} is niet geïmporteerd (${bits.join(", ")}` +
    (what ? `, "${what}"` : "") +
    `) — deze boekhouding werkt in euro's en zou het bedrag anders als euro's boeken.`
  );
}

/** One Dutch line describing a transaction we could not read, with whatever identified it. */
function describeUnreadable(tx: EnableBankingRawTransaction): string {
  const bits: string[] = [];
  const date = cleanString(tx.booking_date) ?? cleanString(tx.value_date);
  if (date) bits.push(date);
  const amount = tx.transaction_amount?.amount;
  if (amount !== null && amount !== undefined && amount !== "") {
    bits.push(`bedrag "${String(amount)}"`);
  }
  const remi = collectRemittance(tx);
  if (remi) bits.push(`"${remi.slice(0, 60)}"`);
  const id = cleanString(tx.entry_reference);
  if (!bits.length && id) bits.push(`id ${id}`);

  // Name the real cause when it is the DIRECTION rather than the figure. "We could read 88,00 but
  // not whether it went in or out" sends the owner (and support) somewhere quite different from
  // "we could not read the amount" — and it is the cause that says the bank, not the file, is odd.
  const amountText = amount === null || amount === undefined ? "" : String(amount).trim();
  const amountReadable = amountText !== "" && Number.isFinite(Number(amountText));
  const cause =
    amountReadable && !readSignedAmount(tx)
      ? "de bank gaf niet door of het een bij- of afschrijving is"
      : "datum of bedrag ontbreekt of is ongeldig";

  return bits.length
    ? `Een banktransactie kon niet gelezen worden (${bits.join(", ")}) — ${cause}.`
    : `Een banktransactie kon niet gelezen worden — ${cause}.`;
}

/** Zero has no sign in the books; -0 would round-trip through JSON as "-0". */
function signOf(magnitude: number, isCredit: boolean): number {
  if (magnitude === 0) return 0;
  return isCredit ? magnitude : -magnitude;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}
